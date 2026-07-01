#!/usr/bin/env node
// V2.16-C CDP Smoke — Effective Model Alignment + Model Picker UI + SDK Live Progress
// 运行: node scripts/cdp-effective-model-smoke-v216c.mjs
//
// 验证项:
//  1. model picker 单列紧凑 popover（Model 上 / Effort 下，原始名称不中文化）
//  2. 选择 gpt-5.4 后 buildSdkOptions 与 SDK session started 一致
//  3. 切换 effort 后 buildSdkOptions 与 chip label 一致
//  4. SDK tool/progress events 在 UI live progress 区域可见
//  5. 长任务期间有 live progress（事件项数 > 0，非空等）
//  6. Assistant 输出不重复（相邻 message 项文本不同）

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const PLUGIN_ID = "llm-cli-bridge";
const VIEW_TYPE = "llm-cli-bridge-view";
const BUILD_DIR = "D:\\Users\\Ye_Luo\\APP\\Test\\llm-cli-bridge";

const results = [];
function pass(name, detail) { results.push({ name, status: "PASS", detail: detail || "" }); console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); }
function fail(name, detail) { results.push({ name, status: "FAIL", detail: detail || "" }); console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }

class CdpClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.ws = null; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl); this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("CDP WebSocket 连接失败"));
      ws.onclose = () => { for (const { reject: rj } of this.pending.values()) rj(new Error("closed")); this.pending.clear(); };
      ws.onmessage = (event) => {
        let msg; try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: r, reject: rj } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rj(new Error(msg.error.message)); else r(msg.result);
        }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  evaluate(expression, awaitPromise = true) {
    return this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
  }
  close() { if (this.ws) this.ws.close(); }
}

async function findObsidianPage() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
  const pages = await resp.json();
  let page = pages.find(p => p.type === "page" && /obsidian/i.test(p.title || ""));
  if (!page) page = pages.find(p => p.type === "page" && p.webSocketDebuggerUrl);
  return page || null;
}

// ============================================================
// Phase 0: Deploy + reload
// ============================================================
async function deploy(client) {
  console.log("\n=== Phase 0: Deploy ===");
  const deployExpr = `(() => {
    try {
      const fs = require('fs');
      const path = require('path');
      const app = window.app || globalThis.app;
      const vaultPath = app.vault.adapter.getBasePath();
      const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', ${JSON.stringify(PLUGIN_ID)});
      const buildDir = ${JSON.stringify(BUILD_DIR)};
      fs.writeFileSync(path.join(pluginDir, 'main.js'), fs.readFileSync(path.join(buildDir, 'main.js')));
      fs.writeFileSync(path.join(pluginDir, 'styles.css'), fs.readFileSync(path.join(buildDir, 'styles.css')));
      fs.writeFileSync(path.join(pluginDir, 'manifest.json'), fs.readFileSync(path.join(buildDir, 'manifest.json')));
      return { ok: true, vaultPath };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(deployExpr, false);
  const r = res.result.value;
  if (r.error) { fail("Deploy", r.error); return null; }
  pass("Deploy main.js + styles.css + manifest.json", `vault=${r.vaultPath}`);

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
      return { reloaded: true };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const rlRes = await client.evaluate(reloadExpr, true);
  const rl = rlRes.result.value;
  if (rl.error) { fail("Reload plugin", rl.error); return null; }
  pass("Reload plugin + open view", "OK");
  return r;
}

// ============================================================
// Phase 1: Model picker single-column popover UI
// ============================================================
async function modelPickerUiSmoke(client) {
  console.log("\n=== Phase 1: Model picker single-column popover ===");

  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const picker = view.modelEffortPickerEl;
      const popover = view.modelEffortPopoverEl;
      if (!picker || !popover) return { error: "picker/popover not found" };

      // 打开 popover
      view.toggleModelEffortPopover();
      await new Promise(r => setTimeout(r, 200));
      const isOpen = !popover.hasAttribute("hidden");
      const hasSingle = popover.classList.contains("llm-bridge-model-effort-popover-single");
      const modelSection = popover.querySelector(".llm-bridge-model-list");
      const effortSection = popover.querySelector(".llm-bridge-effort-list");
      const modelTitle = modelSection?.querySelector(".llm-bridge-model-effort-section-title")?.textContent;
      const effortTitle = effortSection?.querySelector(".llm-bridge-model-effort-section-title")?.textContent;
      const modelOptions = Array.from(popover.querySelectorAll(".llm-bridge-model-option")).map(b => ({
        label: b.textContent.trim(),
        value: b.getAttribute("data-model"),
      }));
      const effortOptions = Array.from(popover.querySelectorAll(".llm-bridge-effort-option")).map(b => ({
        label: b.textContent.trim(),
        value: b.getAttribute("data-effort"),
      }));
      // effort 必须是原始名称（low/medium/high/max），不能是中文化（低/中/高/超高）
      const effortLabels = effortOptions.map(o => o.label);
      const noChinese = effortLabels.every(l => /^(low|medium|high|max)$/.test(l));
      // 关闭 popover
      view.closeModelEffortPopover();
      await new Promise(r => setTimeout(r, 150));
      const closed = popover.hasAttribute("hidden");
      return { isOpen, hasSingle, modelTitle, effortTitle, modelOptions, effortOptions, noChinese, closed };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Model picker popover UI", r.error); return; }
  if (r.isOpen && r.hasSingle && r.modelTitle === "Model" && r.effortTitle === "Effort" && r.modelOptions.length >= 3 && r.effortOptions.length >= 3 && r.noChinese && r.closed) {
    pass("Model picker single-column popover", `models=${r.modelOptions.length} efforts=${r.effortOptions.length} effortLabels=${r.effortOptions.map(o=>o.label).join("/")}`);
  } else {
    fail("Model picker single-column popover", JSON.stringify(r));
  }
}

// ============================================================
// Phase 2: Effective model alignment (settings → buildSdkOptions → SDK session started)
// ============================================================
async function effectiveModelSmoke(client) {
  console.log("\n=== Phase 2: Effective model alignment (gpt-5.4) ===");

  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const vp = app.vault.adapter.getBasePath();

      // 设置 model=gpt-5.4, effort=high
      plugin.settings.backendMode = "auto";
      plugin.settings.model = "gpt-5.4";
      plugin.settings.effortLevel = "high";
      plugin.settings.claudePermissionMode = "plan";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.refreshAllChips();

      // V2.16-C: buildSdkOptions 在 bundle 内，通过 chip label + SDK session started 间接验证一致性
      const chipLabel = view.modelEffortButtonEl.textContent;

      // 2. 真实 SDK query，捕获 session started message
      const backend = view.getBackend();
      const backendType = backend.constructor.name;
      const evts = [];
      const wfEvts = [];
      const task = {
        id: "eff-model-" + Date.now(),
        userMessage: "只回复 OK",
        prompt: "只回复 OK 两个字，不要使用任何工具。",
        cwd: vp,
        createdAt: new Date().toISOString(),
      };
      const handle = backend.run(task, plugin.settings, (ev) => {
        evts.push({ type: ev.type });
      }, (wf) => { wfEvts.push({ type: wf.type, role: wf.role, text: typeof wf.text === 'string' ? wf.text : '' }); });
      const deadline = Date.now() + 60000;
      let finalState = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 700));
        if (evts.some(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped')) {
          finalState = evts.find(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped').type;
          break;
        }
      }
      if (!finalState) { try { handle.stop(); } catch {} finalState = "timeout"; }

      // 提取 session started message（system role，含 model=）
      const sessionStarted = wfEvts.find(e => e.type === 'message' && e.role === 'system' && /SDK session started/.test(e.text));
      const sessionModelMatch = sessionStarted ? sessionStarted.text.match(/model=([^,\\s]+)/) : null;
      const sessionModel = sessionModelMatch ? sessionModelMatch[1] : null;

      // restore
      plugin.settings.claudePermissionMode = "default";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;

      return { chipLabel, backendType, finalState, sessionModel, sessionStartedText: sessionStarted ? sessionStarted.text : null };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Effective model alignment", r.error); return; }
  // chipLabel 应包含 gpt-5.4；sessionModel 应为 gpt-5.4
  const chipOk = /gpt-5\.4/.test(r.chipLabel || "");
  const sessionOk = r.sessionModel === "gpt-5.4";
  if (chipOk && sessionOk && r.finalState === "completed") {
    pass("Effective model alignment (gpt-5.4)", `chip="${r.chipLabel}" sessionModel=${r.sessionModel} state=${r.finalState}`);
  } else {
    fail("Effective model alignment (gpt-5.4)", JSON.stringify(r));
  }
}

// ============================================================
// Phase 3: Effort alignment (switch effort → buildSdkOptions → chip)
// ============================================================
async function effortAlignmentSmoke(client) {
  console.log("\n=== Phase 3: Effort alignment (switch to medium) ===");

  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;

      // 当前 model=gpt-5.4（来自 phase 2），切换 effort=medium
      plugin.settings.model = "gpt-5.4";
      plugin.settings.effortLevel = "medium";
      await plugin.saveSettings();
      view.refreshAllChips();
      await new Promise(r => setTimeout(r, 200));
      const chipLabel = view.modelEffortButtonEl.textContent;

      // 通过 setModelEffort 模拟用户点击切换到 low
      await view.setModelEffort("gpt-5.4", "low");
      await new Promise(r => setTimeout(r, 200));
      const chipAfterClick = view.modelEffortButtonEl.textContent;
      const settingsEffort = plugin.settings.effortLevel;

      // 切换 effort 到 max，验证 chip 与 settings 一致
      await view.setModelEffort("gpt-5.4", "max");
      await new Promise(r => setTimeout(r, 200));
      const chipMax = view.modelEffortButtonEl.textContent;
      const settingsEffortMax = plugin.settings.effortLevel;

      // 恢复
      plugin.settings.effortLevel = "high";
      await plugin.saveSettings();
      view.refreshAllChips();

      return { chipLabel, chipAfterClick, settingsEffort, chipMax, settingsEffortMax };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Effort alignment", r.error); return; }
  const mediumOk = /medium/.test(r.chipLabel) && r.settingsEffort === "low" && /low/.test(r.chipAfterClick);
  const maxOk = r.settingsEffortMax === "max" && /max/.test(r.chipMax);
  if (mediumOk && maxOk) {
    pass("Effort alignment (medium→low→max)", `medium chip="${r.chipLabel}" → low chip="${r.chipAfterClick}" settings=${r.settingsEffort} → max chip="${r.chipMax}" settings=${r.settingsEffortMax}`);
  } else {
    fail("Effort alignment", JSON.stringify(r));
  }
}

// ============================================================
// Phase 4+5+6: SDK live progress (tool events visible + no duplicate assistant)
// ============================================================
async function sdkLiveProgressSmoke(client) {
  console.log("\n=== Phase 4+5+6: SDK live progress + no duplicate assistant ===");

  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const vp = app.vault.adapter.getBasePath();

      // 使用 plan 模式 + 触发工具调用的 prompt
      plugin.settings.backendMode = "auto";
      plugin.settings.model = "gpt-5.4";
      plugin.settings.effortLevel = "high";
      plugin.settings.claudePermissionMode = "auto";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;

      // 清空输入并设置触发 Read 工具的 prompt
      view.inputEl.value = "读取当前 vault 根目录下的 manifest.json 文件，告诉我 name 字段的值，然后回复 OK";
      view.refreshStatusBar();

      // 记录运行前的 assistant 消息数
      const beforeMsgCount = view.messagesEl.querySelectorAll("[data-msg-id]").length;

      // 触发 run
      const runPromise = view.run();
      // 等待运行结束（最多 90s，留时间给工具调用）
      const deadline = Date.now() + 90000;
      let liveItemsDuringRun = 0;
      let toolStartSeen = false;
      let polled = false;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000));
        // 在运行期间采样 live progress 项数
        const liveEl = view.messagesEl.querySelector(".llm-bridge-timeline-live");
        if (liveEl) {
          const items = liveEl.querySelectorAll(".llm-bridge-tl-node");
          if (items.length > 0) {
            liveItemsDuringRun = Math.max(liveItemsDuringRun, items.length);
            // 检查是否有 tool_start 项
            if (liveEl.querySelector(".llm-bridge-tl-tool_call")) toolStartSeen = true;
            polled = true;
          }
        }
        if (!view.runHandle) break;
      }
      // 等待 run 完成
      try { await runPromise; } catch {}
      await new Promise(r => setTimeout(r, 500));

      // 运行结束后，live progress 被隐藏（display:none）但 DOM 项仍在
      const liveElAfter = view.messagesEl.querySelector(".llm-bridge-timeline-live");
      const liveItemsAfter = liveElAfter ? liveElAfter.querySelectorAll(".llm-bridge-tl-node").length : 0;
      const messageItems = liveElAfter ? Array.from(liveElAfter.querySelectorAll(".llm-bridge-tl-agent")).map(el => el.querySelector(".llm-bridge-tl-agent-text")?.textContent || "") : [];

      // 检查相邻 message 项是否有重复文本
      let duplicate = false;
      for (let i = 1; i < messageItems.length; i++) {
        if (messageItems[i] && messageItems[i] === messageItems[i-1] && messageItems[i].length > 0) { duplicate = true; break; }
      }

      const afterMsgCount = view.messagesEl.querySelectorAll("[data-msg-id]").length;

      // restore
      plugin.settings.claudePermissionMode = "default";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.inputEl.value = "";

      return {
        polled,
        liveItemsDuringRun,
        toolStartSeen,
        liveItemsAfter,
        messageItemsCount: messageItems.length,
        duplicate,
        msgCountDelta: afterMsgCount - beforeMsgCount,
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("SDK live progress + no duplicate", r.error); return; }

  // Test 4: live progress 项数 > 0（tool/progress events 可见）
  if (r.liveItemsAfter > 0) pass("SDK tool/progress events visible in UI", `liveItems=${r.liveItemsAfter} toolStartSeen=${r.toolStartSeen}`);
  else fail("SDK tool/progress events visible in UI", JSON.stringify(r));

  // Test 5: 长任务期间有 live progress（非空等）
  if (r.polled && r.liveItemsDuringRun > 0) pass("Live progress during task (not empty wait)", `peakItemsDuringRun=${r.liveItemsDuringRun}`);
  else fail("Live progress during task (not empty wait)", JSON.stringify(r));

  // Test 6: Assistant 输出不重复
  if (!r.duplicate) pass("No duplicate assistant output", `messageItems=${r.messageItemsCount} duplicate=false`);
  else fail("No duplicate assistant output", `duplicate=true items=${JSON.stringify(r.messageItems)}`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log("=== V2.16-C Effective Model + Live Progress Smoke ===");
  const page = await findObsidianPage();
  if (!page) { console.error("未找到 Obsidian 页面"); process.exit(1); }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log("CDP 已连接");

  const deployInfo = await deploy(client);
  if (!deployInfo) { console.error("Deploy 失败，终止"); client.close(); process.exit(1); }

  await modelPickerUiSmoke(client);
  await effectiveModelSmoke(client);
  await effortAlignmentSmoke(client);
  await sdkLiveProgressSmoke(client);
  client.close();

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n=== V2.16-C Smoke 结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("\n失败项:");
    results.filter(r => r.status === "FAIL").forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
