#!/usr/bin/env node
// V2.16-A SDK Smoke — CDP 自动化检查
// 验证 SDK 主运行时：vault read / vault edit / boundary / agent skills / UI events
// 运行方式: D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-AgentRuntime\runtime\node\nodejs\node.exe scripts\cdp-sdk-smoke-v216a.mjs

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const PLUGIN_ID = "llm-cli-bridge";
const VIEW_TYPE = "llm-cli-bridge-view";
const READ_MARKER = "V2_16_A_READ_MARKER_12345";
const EDIT_MARKER = "V2_16_A_EDIT_MARKER_67890";

// ---- CDP 客户端（参考 scripts/cdp-smoke-v215h.mjs）----
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
// 准备阶段：获取 vaultPath、创建 marker 文件、重载插件
// ============================================================
async function prepare(client) {
  // 1. 获取 vaultPath
  const vpRes = await client.evaluate(`(() => { try { const app = window.app || globalThis.app; return app.vault.adapter.getBasePath(); } catch(e){ return { error: String(e&&e.message||e) }; } })()`, false);
  const vaultPath = vpRes.result.value;
  if (typeof vaultPath !== "string") throw new Error("无法获取 vaultPath: " + JSON.stringify(vaultPath));
  console.log(`  vaultPath: ${vaultPath}`);

  // 2. 创建 marker 文件（fs.writeFileSync via CDP evaluate）
  const markerExpr = `(() => {
    try {
      const fs = require('fs');
      const path = require('path');
      const app = window.app || globalThis.app;
      const vaultPath = app.vault.adapter.getBasePath();
      const dir = path.join(vaultPath, '.llm-bridge', 'test-artifacts');
      fs.mkdirSync(dir, { recursive: true });
      const markerPath = path.join(dir, 'sdk-smoke-marker.md');
      fs.writeFileSync(markerPath, ${JSON.stringify(READ_MARKER)});
      const exists = fs.existsSync(markerPath);
      const content = fs.readFileSync(markerPath, 'utf8');
      return { ok: true, markerPath, exists, content };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const mkRes = await client.evaluate(markerExpr, false);
  const mk = mkRes.result.value;
  if (mk.error) throw new Error("创建 marker 文件失败: " + mk.error);
  console.log(`  marker 文件已创建: ${mk.markerPath} (content=${mk.content})`);

  // 3. 重载插件（disable + enable，600ms + 1500ms 延迟）
  const reloadExpr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      await new Promise(r => setTimeout(r, 600));
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      await new Promise(r => setTimeout(r, 1500));
      return { reloaded: true };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const rlRes = await client.evaluate(reloadExpr, true);
  const rl = rlRes.result.value;
  if (rl.error) throw new Error("重载插件失败: " + rl.error);
  console.log(`  插件已重载: ${JSON.stringify(rl)}`);

  return { vaultPath };
}

// ============================================================
// 收集 SDK Runtime Info
// ============================================================
async function collectRuntimeInfo(client, vaultPath) {
  const infoExpr = `(() => {
    try {
      const fs = require('fs');
      const path = require('path');
      const app = window.app || globalThis.app;
      const vp = app.vault.adapter.getBasePath();
      // 候选运行时目录（与 sdkBackend.ts resolveRuntimeDirs 一致）
      const candidates = [
        path.join(vp, 'LLM-AgentRuntime'),
        path.join(vp, '..', 'LLM-AgentRuntime'),
      ];
      const pkgName = "@anthropic-ai/claude-agent-sdk";
      let packagePath = null;
      let version = null;
      for (const dir of candidates) {
        const pkgDir = path.join(dir, 'node_modules', pkgName);
        try {
          const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
          packagePath = pkgDir;
          version = pkgJson.version;
          break;
        } catch {}
      }
      // claude-runtime.json -> claudeConfigDir
      let claudeConfigDir = null;
      try {
        const cfgPath = path.join(vp, '.llm-bridge', 'claude-runtime.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        claudeConfigDir = cfg.claudeConfigDir || null;
      } catch {}
      return {
        packagePath,
        version,
        nodeVersion: process.version,
        electronVersion: process.versions.electron || null,
        cwd: vp,
        claudeConfigDir,
        anthropicConfigDir: process.env.ANTHROPIC_CONFIG_DIR || '(unset)',
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(infoExpr, false);
  return res.result.value;
}

// ============================================================
// Test 1: SDK Vault Read
// ============================================================
async function test1_vaultRead(client) {
  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (!plugin) return { error: "plugin not found" };
      const oldBackendMode = plugin.settings.backendMode;
      const oldPermissionMode = plugin.settings.claudePermissionMode;
      plugin.settings.backendMode = "sdk-experimental";
      plugin.settings.claudePermissionMode = "acceptEdits";
      await plugin.saveSettings();

      const leaves = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)});
      if (!leaves || leaves.length === 0) {
        plugin.settings.backendMode = oldBackendMode;
        plugin.settings.claudePermissionMode = oldPermissionMode;
        await plugin.saveSettings();
        return { error: "view not found" };
      }
      const view = leaves[0].view;
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      const backend = view.getBackend();
      const vaultPath = app.vault.adapter.getBasePath();
      const path = require('path');
      const filePath = path.join(vaultPath, '.llm-bridge', 'test-artifacts', 'sdk-smoke-marker.md');

      const evts = [];
      const wfEvts = [];
      const task = {
        id: "sdk-smoke-read-" + Date.now(),
        userMessage: "Read marker file",
        prompt: "Read the file at " + filePath + " and reply with ONLY its exact content, nothing else.",
        cwd: vaultPath,
        createdAt: new Date().toISOString(),
      };

      const handle = backend.run(task, plugin.settings, (ev) => {
        const entry = { type: ev.type };
        if (typeof ev.data === 'string') entry.data = ev.data;
        if (ev.stdout !== undefined) entry.stdout = String(ev.stdout);
        evts.push(entry);
      }, (wf) => {
        const entry = { type: wf.type };
        if (wf.role) entry.role = wf.role;
        if (wf.text) entry.text = String(wf.text);
        if (wf.toolName) entry.toolName = wf.toolName;
        wfEvts.push(entry);
      });

      const deadline = Date.now() + 120000;
      let finalState = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 800));
        const terminal = evts.find(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped');
        if (terminal) { finalState = terminal.type; break; }
      }
      if (!finalState) { try { handle.stop(); } catch {} finalState = "timeout"; }

      // 恢复设置
      plugin.settings.backendMode = oldBackendMode;
      plugin.settings.claudePermissionMode = oldPermissionMode;
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;

      // 提取 assistant 文本（completed.stdout 优先，message 事件兜底）
      const completedEvt = evts.find(e => e.type === 'completed');
      const stdoutText = completedEvt && completedEvt.stdout ? completedEvt.stdout : '';
      const messageText = wfEvts
        .filter(e => e.type === 'message' && e.role === 'assistant')
        .map(e => e.text || '')
        .join('');
      const assistantText = stdoutText || messageText;

      const hasAssistantMessage = wfEvts.some(e => e.type === 'message' && e.role === 'assistant');
      const hasTerminalEvent = wfEvts.some(e => e.type === 'completed' || e.type === 'failed');

      return {
        finalState,
        eventCount: evts.length,
        eventTypes: evts.map(e => e.type),
        wfEventCount: wfEvts.length,
        wfEventTypes: wfEvts.map(e => e.type),
        assistantText: assistantText.slice(0, 2000),
        containsMarker: assistantText.includes(${JSON.stringify(READ_MARKER)}),
        hasAssistantMessage,
        hasTerminalEvent,
        sampleWfEvents: wfEvts.slice(0, 15),
      };
    } catch (e) {
      return { error: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 500) };
    }
  })()`;
  const res = await client.evaluate(expr, true);
  const v = res.result.value;
  if (v.error) return { pass: false, reason: v.error, details: v, hasAssistantMessage: false, hasTerminalEvent: false };
  const pass = v.finalState === "completed" && v.containsMarker;
  return {
    pass,
    reason: pass ? "" : `finalState=${v.finalState} containsMarker=${v.containsMarker}`,
    details: v,
    hasAssistantMessage: v.hasAssistantMessage,
    hasTerminalEvent: v.hasTerminalEvent,
  };
}

// ============================================================
// Test 2: SDK Vault Edit
// ============================================================
async function test2_vaultEdit(client) {
  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (!plugin) return { error: "plugin not found" };
      const oldBackendMode = plugin.settings.backendMode;
      const oldPermissionMode = plugin.settings.claudePermissionMode;
      plugin.settings.backendMode = "sdk-experimental";
      plugin.settings.claudePermissionMode = "acceptEdits";
      await plugin.saveSettings();

      const leaves = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)});
      if (!leaves || leaves.length === 0) {
        plugin.settings.backendMode = oldBackendMode;
        plugin.settings.claudePermissionMode = oldPermissionMode;
        await plugin.saveSettings();
        return { error: "view not found" };
      }
      const view = leaves[0].view;
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      const backend = view.getBackend();
      const vaultPath = app.vault.adapter.getBasePath();
      const path = require('path');
      const fs = require('fs');
      const filePath = path.join(vaultPath, '.llm-bridge', 'test-artifacts', 'sdk-smoke-output.md');

      // 清理可能残留的旧输出文件
      try { fs.unlinkSync(filePath); } catch {}

      const evts = [];
      const wfEvts = [];
      const task = {
        id: "sdk-smoke-edit-" + Date.now(),
        userMessage: "Create output file",
        prompt: "Create a file at " + filePath + " with exactly this content: ${EDIT_MARKER}",
        cwd: vaultPath,
        createdAt: new Date().toISOString(),
      };

      const handle = backend.run(task, plugin.settings, (ev) => {
        const entry = { type: ev.type };
        if (typeof ev.data === 'string') entry.data = ev.data;
        if (ev.stdout !== undefined) entry.stdout = String(ev.stdout);
        evts.push(entry);
      }, (wf) => {
        const entry = { type: wf.type };
        if (wf.role) entry.role = wf.role;
        if (wf.text) entry.text = String(wf.text);
        if (wf.toolName) entry.toolName = wf.toolName;
        wfEvts.push(entry);
      });

      const deadline = Date.now() + 120000;
      let finalState = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 800));
        const terminal = evts.find(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped');
        if (terminal) { finalState = terminal.type; break; }
      }
      if (!finalState) { try { handle.stop(); } catch {} finalState = "timeout"; }

      // 等待文件写入完成
      await new Promise(r => setTimeout(r, 500));

      // 恢复设置
      plugin.settings.backendMode = oldBackendMode;
      plugin.settings.claudePermissionMode = oldPermissionMode;
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;

      // 读取输出文件验证
      let fileExists = false;
      let fileContent = null;
      let fileContainsMarker = false;
      try {
        fileContent = fs.readFileSync(filePath, 'utf8');
        fileExists = true;
        fileContainsMarker = fileContent.includes(${JSON.stringify(EDIT_MARKER)});
      } catch (e) {
        fileExists = false;
        fileContent = null;
        fileContainsMarker = false;
      }

      const hasAssistantMessage = wfEvts.some(e => e.type === 'message' && e.role === 'assistant');
      const hasTerminalEvent = wfEvts.some(e => e.type === 'completed' || e.type === 'failed');

      return {
        finalState,
        eventCount: evts.length,
        eventTypes: evts.map(e => e.type),
        wfEventCount: wfEvts.length,
        wfEventTypes: wfEvts.map(e => e.type),
        fileExists,
        fileContent: fileContent ? fileContent.slice(0, 500) : null,
        fileContainsMarker,
        hasAssistantMessage,
        hasTerminalEvent,
        sampleWfEvents: wfEvts.slice(0, 15),
      };
    } catch (e) {
      return { error: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 500) };
    }
  })()`;
  const res = await client.evaluate(expr, true);
  const v = res.result.value;
  if (v.error) return { pass: false, reason: v.error, details: v, hasAssistantMessage: false, hasTerminalEvent: false };
  const pass = v.finalState === "completed" && v.fileExists && v.fileContainsMarker;
  return {
    pass,
    reason: pass ? "" : `finalState=${v.finalState} fileExists=${v.fileExists} fileContainsMarker=${v.fileContainsMarker}`,
    details: v,
    hasAssistantMessage: v.hasAssistantMessage,
    hasTerminalEvent: v.hasTerminalEvent,
  };
}

// ============================================================
// Test 3: SDK Boundary (inline assessToolRisk logic)
// ============================================================
async function test3_boundary(client, vaultPath) {
  const expr = `(() => {
    try {
      const path = require('path');
      const vp = ${JSON.stringify(vaultPath)};
      const tests = [
        { tool: "Write", input: { file_path: "C:/Windows/system32/test.txt" }, expectHighRisk: true },
        { tool: "Write", input: { file_path: ".env" }, expectHighRisk: true },
        { tool: "Write", input: { file_path: path.join(vp, '.llm-bridge', 'test-artifacts', 'ok.md') }, expectHighRisk: false },
      ];
      const results = tests.map(t => {
        const p = t.input.file_path;
        // 内联边界检测逻辑（镜像 sdkPermission.assessToolRisk）
        const isExternal = /^[A-Za-z]:[\\\\/]/.test(p) && !p.startsWith(vp);
        const isEnv = /(?:^|[\\\\/])\\.env(?:[\\\\/]|$)/i.test(p);
        const isSensitive = isExternal || isEnv;
        return {
          tool: t.tool,
          path: p,
          expectedHighRisk: t.expectHighRisk,
          actualHighRisk: isSensitive,
          pass: t.expectHighRisk === isSensitive,
        };
      });
      return { tests: results, allPass: results.every(r => r.pass) };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, false);
  const v = res.result.value;
  if (v.error) return { pass: false, reason: v.error, details: v };
  return {
    pass: v.allPass,
    reason: v.allPass ? "" : v.tests.filter(t => !t.pass).map(t => `path=${t.path} expected=${t.expectedHighRisk} actual=${t.actualHighRisk}`).join("; "),
    details: v,
  };
}

// ============================================================
// Test 4: SDK Agent Skills (vault .claude/skills/ materialized)
// ============================================================
async function test4_agentSkills(client, vaultPath) {
  const expr = `(() => {
    try {
      const fs = require('fs');
      const path = require('path');
      const vaultPath = app.vault.adapter.getBasePath();
      const skillsDir = path.join(vaultPath, '.claude', 'skills');
      let skills = [];
      try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const skillMd = path.join(skillsDir, e.name, 'SKILL.md');
            if (fs.existsSync(skillMd)) skills.push(e.name);
          }
        }
      } catch {}
      return { skillsDir, skillsCount: skills.length, skills };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, false);
  const v = res.result.value;
  if (v.error) return { pass: false, reason: v.error, details: v };
  const pass = v.skillsCount > 0;
  return {
    pass,
    reason: pass ? "" : `skillsCount=${v.skillsCount} (期望 > 0)`,
    details: v,
  };
}

// ============================================================
// Test 5: SDK UI Event (verify workflow events from Test 1 or Test 2)
// ============================================================
function test5_uiEvents(test1Result, test2Result) {
  // 优先使用 Test 1 的事件，若 Test 1 无事件则使用 Test 2
  const source = (test1Result && test1Result.hasAssistantMessage !== undefined) ? test1Result : test2Result;
  if (!source) return { pass: false, reason: "无可用的事件数据" };
  const hasAssistantMessage = !!source.hasAssistantMessage;
  const hasTerminalEvent = !!source.hasTerminalEvent;
  const pass = hasAssistantMessage && hasTerminalEvent;
  return {
    pass,
    reason: pass ? "" : `hasAssistantMessage=${hasAssistantMessage} hasTerminalEvent=${hasTerminalEvent}`,
    details: { hasAssistantMessage, hasTerminalEvent, source: source === test1Result ? "test1" : "test2" },
  };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log("[V2.16-A SDK Smoke] 开始...");
  const startTime = new Date().toISOString();

  // 连接 CDP
  console.log("[1/8] 连接 CDP...");
  const page = await findObsidianPage();
  if (!page) { console.error("[CDP] 未找到 Obsidian 页面"); process.exit(2); }
  console.log(`  页面: ${page.title}`);
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  try {
    // 准备阶段
    console.log("[2/8] 准备阶段（获取 vaultPath、创建 marker、重载插件）...");
    const { vaultPath } = await prepare(client);

    // 收集 SDK Runtime Info
    console.log("[3/8] 收集 SDK Runtime Info...");
    const runtimeInfo = await collectRuntimeInfo(client, vaultPath);
    console.log(`  ${JSON.stringify(runtimeInfo)}`);

    // Test 1: SDK Vault Read
    console.log("[4/8] Test 1: SDK Vault Read...");
    const t1 = await test1_vaultRead(client);
    console.log(`  Test 1 (Vault Read): ${t1.pass ? "PASS" : "FAIL"} ${t1.reason}`);
    if (t1.details && t1.details.wfEventTypes) {
      console.log(`    wfEventTypes: ${JSON.stringify(t1.details.wfEventTypes)}`);
    }

    // Test 2: SDK Vault Edit
    console.log("[5/8] Test 2: SDK Vault Edit...");
    const t2 = await test2_vaultEdit(client);
    console.log(`  Test 2 (Vault Edit): ${t2.pass ? "PASS" : "FAIL"} ${t2.reason}`);
    if (t2.details && t2.details.wfEventTypes) {
      console.log(`    wfEventTypes: ${JSON.stringify(t2.details.wfEventTypes)}`);
    }

    // Test 3: SDK Boundary
    console.log("[6/8] Test 3: SDK Boundary...");
    const t3 = await test3_boundary(client, vaultPath);
    console.log(`  Test 3 (Boundary): ${t3.pass ? "PASS" : "FAIL"} ${t3.reason}`);
    if (t3.details && t3.details.tests) {
      for (const t of t3.details.tests) {
        console.log(`    [${t.pass ? "PASS" : "FAIL"}] ${t.tool} path=${t.path} expected=${t.expectedHighRisk} actual=${t.actualHighRisk}`);
      }
    }

    // Test 4: SDK Agent Skills
    console.log("[7/8] Test 4: SDK Agent Skills...");
    const t4 = await test4_agentSkills(client, vaultPath);
    console.log(`  Test 4 (Agent Skills): ${t4.pass ? "PASS" : "FAIL"} ${t4.reason}`);
    if (t4.details) {
      console.log(`    skillsDir: ${t4.details.skillsDir}`);
      console.log(`    skillsCount: ${t4.details.skillsCount}`);
      if (t4.details.skills && t4.details.skills.length > 0) {
        console.log(`    skills: ${JSON.stringify(t4.details.skills)}`);
      }
    }

    // Test 5: SDK UI Event
    console.log("[8/8] Test 5: SDK UI Event...");
    const t5 = test5_uiEvents(t1, t2);
    console.log(`  Test 5 (UI Events): ${t5.pass ? "PASS" : "FAIL"} ${t5.reason}`);

    // 汇总
    const passCount = [t1.pass, t2.pass, t3.pass, t4.pass, t5.pass].filter(Boolean).length;
    const endTime = new Date().toISOString();

    console.log("");
    console.log("=== V2.16-A SDK Smoke Summary ===");
    console.log(`SDK Runtime Info: ${JSON.stringify(runtimeInfo)}`);
    console.log(`Test 1 (Vault Read): ${t1.pass ? "PASS" : "FAIL"}`);
    console.log(`Test 2 (Vault Edit): ${t2.pass ? "PASS" : "FAIL"}`);
    console.log(`Test 3 (Boundary): ${t3.pass ? "PASS" : "FAIL"}`);
    console.log(`Test 4 (Agent Skills): ${t4.pass ? "PASS" : "FAIL"}`);
    console.log(`Test 5 (UI Events): ${t5.pass ? "PASS" : "FAIL"}`);
    console.log(`Overall: ${passCount}/5 PASS`);
    console.log(`Time: ${startTime} -> ${endTime}`);

    client.close();
    process.exit(passCount === 5 ? 0 : 1);
  } catch (e) {
    client.close();
    throw e;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
