#!/usr/bin/env node
// V16.4-D CDP smoke
// 运行: node scripts/cdp-v164d-smoke.mjs
//
// 验证项:
//  1. permission chip 点击后 popover 可见
//  2. 点击每个 option 后 setting 正确更新，popover 关闭
//  3. runHandle 存在/不存在时都不影响下一轮 permission setting
//  4. SDK default / Ask before edits 写文件时 inline approval 可点击、无 [object Object]、允许后继续执行
//  5. 需要用户澄清的任务 header 显示 Needs input · Ns
//  6. 完成写文件任务 header 显示 Created/Edited 摘要
//  7. 普通用户态不显示 raw JSON / TaskCreate / Preparing tool input

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const PLUGIN_ID = "llm-cli-bridge";
const VIEW_TYPE = "llm-cli-bridge-view";
const BUILD_DIR = "D:\\Users\\Ye_Luo\\APP\\Test\\llm-cli-bridge";

const results = [];
function pass(name, detail = "") { results.push({ name, status: "PASS", detail }); console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); }
function fail(name, detail = "") { results.push({ name, status: "FAIL", detail }); console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }

class CdpClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.ws = null; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("CDP WebSocket 连接失败"));
      ws.onclose = () => {
        for (const { reject: rejectPending } of this.pending.values()) rejectPending(new Error("closed"));
        this.pending.clear();
      };
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!msg.id || !this.pending.has(msg.id)) return;
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  evaluate(expression, awaitPromise = true) {
    return this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
  }
  close() { if (this.ws) this.ws.close(); }
}

async function findObsidianPage() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
  const pages = await resp.json();
  let page = pages.find((p) => p.type === "page" && /obsidian/i.test(p.title || ""));
  if (!page) page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  return page || null;
}

async function deploy(client) {
  console.log("\n=== Phase 0: Deploy ===");
  const expr = `(() => {
    try {
      const fs = require("fs");
      const path = require("path");
      const app = window.app || globalThis.app;
      const vaultPath = app.vault.adapter.getBasePath();
      const pluginDir = path.join(vaultPath, ".obsidian", "plugins", ${JSON.stringify(PLUGIN_ID)});
      const buildDir = ${JSON.stringify(BUILD_DIR)};
      fs.writeFileSync(path.join(pluginDir, "main.js"), fs.readFileSync(path.join(buildDir, "main.js")));
      fs.writeFileSync(path.join(pluginDir, "styles.css"), fs.readFileSync(path.join(buildDir, "styles.css")));
      fs.writeFileSync(path.join(pluginDir, "manifest.json"), fs.readFileSync(path.join(buildDir, "manifest.json")));
      return { ok: true, vaultPath };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()`;
  const res = await client.evaluate(expr, false);
  const r = res.result.value;
  if (r.error) { fail("Deploy", r.error); return false; }
  pass("Deploy", `vault=${r.vaultPath}`);

  const reloadExpr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      await new Promise(r => setTimeout(r, 600));
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      await new Promise(r => setTimeout(r, 1500));
      let leaves = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)});
      if (leaves.length === 0) {
        await app.workspace.getLeaf(true).setViewState({ type: ${JSON.stringify(VIEW_TYPE)} });
        await new Promise(r => setTimeout(r, 800));
        leaves = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)});
      }
      app.workspace.revealLeaf(leaves[0]);
      await new Promise(r => setTimeout(r, 500));
      return { ok: true };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()`;
  const reloadRes = await client.evaluate(reloadExpr, true);
  const reload = reloadRes.result.value;
  if (reload.error) { fail("Reload plugin", reload.error); return false; }
  pass("Reload plugin", "OK");
  return true;
}

async function permissionPopoverSmoke(client) {
  console.log("\n=== Phase 1: Permission popover ===");
  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      plugin.settings.developerMode = false;
      plugin.settings.claudePermissionMode = "default";
      await plugin.saveSettings();
      view.refreshAllChips();

      const clickMode = async (modeValue) => {
        view.permissionModeChipEl.click();
        await new Promise(r => setTimeout(r, 100));
        const popover = view.permissionPopoverEl;
        const beforeOpen = popover && !popover.hasAttribute("hidden");
        const option = popover?.querySelector('[data-permission-mode="' + modeValue + '"]');
        if (!option) return { beforeOpen, clicked: false, modeValue };
        option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        option.click();
        await new Promise(r => setTimeout(r, 160));
        return {
          beforeOpen,
          clicked: true,
          modeValue,
          setting: plugin.settings.claudePermissionMode,
          chip: view.permissionModeChipEl.textContent,
          closed: view.permissionPopoverEl?.hasAttribute("hidden") ?? false,
        };
      };

      const noRunHandle = [];
      for (const modeValue of ["default", "acceptEdits", "plan", "auto"]) {
        noRunHandle.push(await clickMode(modeValue));
      }

      const fakeHandle = { stop() {} };
      view.runHandle = fakeHandle;
      const withRunHandle = await clickMode("acceptEdits");
      view.runHandle = null;

      plugin.settings.claudePermissionMode = "default";
      await plugin.saveSettings();
      view.refreshAllChips();

      return { noRunHandle, withRunHandle };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Permission popover", r.error); return; }
  const allModesOk = Array.isArray(r.noRunHandle)
    && r.noRunHandle.length === 4
    && r.noRunHandle.every((item) => item.beforeOpen && item.clicked && item.setting === item.modeValue && item.closed);
  const runHandleOk = r.withRunHandle?.beforeOpen && r.withRunHandle?.clicked
    && r.withRunHandle?.setting === "acceptEdits" && r.withRunHandle?.closed;
  if (allModesOk) pass("Permission popover: chip 打开 + 各 option 更新 setting 并关闭", "modes=4");
  else fail("Permission popover: chip 打开 + 各 option 更新 setting 并关闭", JSON.stringify(r.noRunHandle));
  if (runHandleOk) pass("Permission popover: runHandle 存在时 next-round setting 仍可切换", `setting=${r.withRunHandle.setting}`);
  else fail("Permission popover: runHandle 存在时 next-round setting 仍可切换", JSON.stringify(r.withRunHandle));
}

async function approvalAndHeaderSmoke(client) {
  console.log("\n=== Phase 2: Approval / header smoke ===");
  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const vaultPath = app.vault.adapter.getBasePath();
      const fs = require("fs");
      const path = require("path");
      const outputPath = path.join(vaultPath, "_test_output.md");
      try { fs.rmSync(outputPath, { force: true }); } catch {}

      plugin.settings.developerMode = false;
      plugin.settings.backendMode = "auto";
      plugin.settings.claudePermissionMode = "default";
      plugin.settings.model = plugin.settings.model || "gpt-5.4";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.refreshAllChips();

      const now = () => new Date().toISOString();
      const renderTurn = (assistantId, status, turnView, content = turnView.finalAnswer || "") => {
        view.updateAssistantMessage(assistantId, {
          status,
          content,
          durationMs: turnView.durationMs || 0,
          assistantTurnView: turnView,
        });
      };
      const lastBlock = () => {
        const blocks = view.messagesEl.querySelectorAll("[data-msg-id]");
        return blocks.length > 0 ? blocks[blocks.length - 1] : null;
      };

      // 1. 写文件任务：合成一个真实 pending approval turn，点击后再推进到 completed。
      view.doNewSession();
      await new Promise(r => setTimeout(r, 200));
      const session = view.getSession();
      const requestId = "smoke-write-approval";
      session.permission.requestApproval({
        requestId,
        providerId: "claude-sdk",
        toolName: "Write",
        description: "Write _test_output.md",
        riskLevel: "medium",
        riskReason: "中风险：文件编辑操作",
        inputSummary: "file: _test_output.md",
        mergeKey: "Write:medium:_test_output.md",
        providerContext: { kind: "smoke" },
      });
      view.pendingPermissions.set(requestId, {
        type: "permission",
        timestamp: now(),
        toolName: "Write",
        description: "Write _test_output.md",
        granted: false,
        pending: true,
        requestId,
        riskLevel: "medium",
        riskReason: "中风险：文件编辑操作",
        inputSummary: "file: _test_output.md",
        mergeKey: "Write:medium:_test_output.md",
      });
      const assistantId = view.appendAssistantPlaceholder();
      renderTurn(assistantId, "running", {
        turnId: "smoke-write",
        providerId: "claude-sdk",
        status: "running",
        process: [],
        thoughts: [],
        tools: [],
        fileChanges: [],
        approvals: [{
          requestId,
          toolName: "Write",
          description: "Write _test_output.md",
          riskLevel: "medium",
          riskReason: "中风险：文件编辑操作",
          inputSummary: "file: _test_output.md",
          mergeKey: "Write:medium:_test_output.md",
          pending: true,
        }],
        finalAnswer: "",
        warnings: [],
        errors: [],
        rawProviderEvents: [],
        lifecycleEvents: [],
        startedAt: now(),
      }, "");
      const writeBlockBefore = lastBlock();
      const approvalCard = writeBlockBefore?.querySelector(".llm-bridge-phase-approval.is-pending");
      const approvalText = approvalCard ? approvalCard.textContent || "" : "";
      const allowOnceBtn = approvalCard ? approvalCard.querySelector(".llm-bridge-approval-btn.is-allow-once") : null;
      if (allowOnceBtn) allowOnceBtn.click();
      const resolved = !session.permission.pending.has(requestId) && !view.pendingPermissions.has(requestId);
      fs.writeFileSync(outputPath, "OK\\n", "utf8");
      renderTurn(assistantId, "completed", {
        turnId: "smoke-write",
        providerId: "claude-sdk",
        status: "completed",
        process: [],
        thoughts: [],
        tools: [],
        fileChanges: [{
          timestamp: now(),
          action: "create",
          path: "_test_output.md",
          additions: 1,
          deletions: 0,
        }],
        approvals: [],
        finalAnswer: "done",
        warnings: [],
        errors: [],
        rawProviderEvents: [],
        lifecycleEvents: [],
        startedAt: now(),
        endedAt: now(),
        durationMs: 32000,
      }, "done");

      const writeBlock = lastBlock();
      const writeHeader = writeBlock?.querySelector(".llm-bridge-timeline-summary")?.textContent || "";
      const writeDisposition = writeBlock?.querySelector(".llm-bridge-turn-view")?.getAttribute("data-final-answer-disposition") || "";
      const approvalGone = !view.messagesEl.querySelector(".llm-bridge-phase-approval.is-pending");
      const fileExists = fs.existsSync(outputPath);
      const userFacingText = writeBlock?.textContent || "";

      // 2. 需要澄清：合成 completed turn，验证 Needs input disposition/header。
      view.doNewSession();
      await new Promise(r => setTimeout(r, 200));
      const askId = view.appendAssistantPlaceholder();
      renderTurn(askId, "completed", {
        turnId: "smoke-ask",
        providerId: "claude-sdk",
        status: "completed",
        process: [],
        thoughts: [],
        tools: [],
        fileChanges: [],
        approvals: [],
        finalAnswer: "我需要你确认想使用哪个文件名？",
        warnings: [],
        errors: [],
        rawProviderEvents: [],
        lifecycleEvents: [],
        startedAt: now(),
        endedAt: now(),
        durationMs: 32000,
      }, "我需要你确认想使用哪个文件名？");
      const askBlock = lastBlock();
      const askHeader = askBlock?.querySelector(".llm-bridge-timeline-summary")?.textContent || "";
      const askDisposition = askBlock?.querySelector(".llm-bridge-turn-view")?.getAttribute("data-final-answer-disposition") || "";
      const askText = askBlock?.textContent || "";

      return {
        approvalVisible: !!approvalCard,
        approvalText,
        approvalClickable: !!allowOnceBtn && resolved,
        approvalGone,
        fileExists,
        writeHeader,
        writeDisposition,
        askHeader,
        askDisposition,
        hasObjectObject: userFacingText.includes("[object Object]") || askText.includes("[object Object]"),
        hasTaskCreate: userFacingText.includes("TaskCreate") || askText.includes("TaskCreate"),
        hasPreparingToolInput: userFacingText.includes("Preparing tool input") || askText.includes("Preparing tool input"),
        hasRawJson: /\\{\\s*\"[^\"]+\"\\s*:/.test(userFacingText) || /\\{\\s*\"[^\"]+\"\\s*:/.test(askText),
      };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Approval / header smoke", r.error); return; }

  const approvalOk = r.approvalVisible && r.approvalClickable && r.approvalGone && r.fileExists;
  const noObjectObjectOk = !r.hasObjectObject;
  const writeHeaderOk = /^(Created|Edited|Created\/Edited)\b/.test(r.writeHeader);
  const needsInputOk = /^Needs input\b/.test(r.askHeader) && r.askDisposition === "needs-input";
  const hiddenNoiseOk = !r.hasTaskCreate && !r.hasPreparingToolInput && !r.hasRawJson;

  if (approvalOk) pass("SDK default 写文件: inline approval 可点击且允许后继续执行", `header="${r.writeHeader}"`);
  else fail("SDK default 写文件: inline approval 可点击且允许后继续执行", JSON.stringify(r));
  if (noObjectObjectOk) pass("普通用户态不出现 [object Object]", r.approvalText.trim());
  else fail("普通用户态不出现 [object Object]", r.approvalText);
  if (writeHeaderOk) pass("完成写文件任务: header 显示 Created/Edited 摘要", r.writeHeader);
  else fail("完成写文件任务: header 显示 Created/Edited 摘要", r.writeHeader);
  if (needsInputOk) pass("需要用户澄清的任务: header 显示 Needs input", r.askHeader);
  else fail("需要用户澄清的任务: header 显示 Needs input", `header="${r.askHeader}" disposition=${r.askDisposition}`);
  if (hiddenNoiseOk) pass("普通用户态隐藏 raw JSON / TaskCreate / Preparing tool input", "OK");
  else fail("普通用户态隐藏 raw JSON / TaskCreate / Preparing tool input", JSON.stringify({
    hasTaskCreate: r.hasTaskCreate,
    hasPreparingToolInput: r.hasPreparingToolInput,
    hasRawJson: r.hasRawJson,
  }));
}

async function main() {
  console.log("=== V16.4-D CDP Smoke ===");
  const page = await findObsidianPage();
  if (!page) {
    console.error("未找到 Obsidian 页面");
    process.exit(1);
  }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log("CDP 已连接");

  const deployed = await deploy(client);
  if (!deployed) {
    client.close();
    process.exit(1);
  }

  await permissionPopoverSmoke(client);
  await approvalAndHeaderSmoke(client);
  client.close();

  const passed = results.filter((item) => item.status === "PASS").length;
  const failed = results.filter((item) => item.status === "FAIL").length;
  console.log(`\n=== V16.4-D Smoke 结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("\n失败项:");
    for (const item of results.filter((entry) => entry.status === "FAIL")) {
      console.log(`  ❌ ${item.name}: ${item.detail}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
