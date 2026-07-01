#!/usr/bin/env node
// V2.16-B CDP Smoke — Deploy + Runtime Status + auto SDK-first + CLI + SDK
// 运行: node scripts/cdp-runtime-smoke-v216b.mjs

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

  // Reload plugin
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
// Phase 1: Runtime status UI
// ============================================================
async function runtimeStatusSmoke(client) {
  console.log("\n=== Phase 1: Runtime Status UI ===");

  // 1a. auto mode → SDK-first (SDK available in this vault)
  const autoExpr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      plugin.settings.backendMode = "auto";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.refreshStatusBar();
      await new Promise(r => setTimeout(r, 300));
      const statusText = view.statusLabelEl.textContent;
      const backendValue = view.statusBackendEl.querySelector(".llm-bridge-sb-value").textContent;
      const actualLabel = view.actualRuntimeLabel;
      return { statusText, backendValue, actualLabel };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const autoRes = await client.evaluate(autoExpr, true);
  const ar = autoRes.result.value;
  if (ar.error) fail("auto mode runtime status (SDK-first)", ar.error);
  else if (/SDK/.test(ar.actualLabel)) pass("auto mode runtime status (SDK-first)", `label=${ar.actualLabel} status="${ar.statusText}" backend=${ar.backendValue}`);
  else fail("auto mode runtime status (SDK-first)", JSON.stringify(ar));

  // 1b. cli mode → Claude Code
  const cliExpr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      plugin.settings.backendMode = "cli";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.refreshStatusBar();
      await new Promise(r => setTimeout(r, 300));
      const statusText = view.statusLabelEl.textContent;
      const backendValue = view.statusBackendEl.querySelector(".llm-bridge-sb-value").textContent;
      const actualLabel = view.actualRuntimeLabel;
      // restore to auto
      plugin.settings.backendMode = "auto";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.refreshStatusBar();
      return { statusText, backendValue, actualLabel };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const cliRes = await client.evaluate(cliExpr, true);
  const cr = cliRes.result.value;
  if (cr.error) fail("cli mode runtime status", cr.error);
  else if (/Claude Code/.test(cr.actualLabel) && !/fallback/.test(cr.actualLabel)) pass("cli mode runtime status", `label=${cr.actualLabel} status="${cr.statusText}"`);
  else fail("cli mode runtime status", JSON.stringify(cr));

  // 1c. sdk mode → SDK (available)
  const sdkExpr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      plugin.settings.backendMode = "sdk";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.refreshStatusBar();
      await new Promise(r => setTimeout(r, 300));
      const statusText = view.statusLabelEl.textContent;
      const backendValue = view.statusBackendEl.querySelector(".llm-bridge-sb-value").textContent;
      const actualLabel = view.actualRuntimeLabel;
      // restore to auto
      plugin.settings.backendMode = "auto";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      view.refreshStatusBar();
      return { statusText, backendValue, actualLabel };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const sdkRes = await client.evaluate(sdkExpr, true);
  const sr = sdkRes.result.value;
  if (sr.error) fail("sdk mode runtime status", sr.error);
  else if (sr.actualLabel === "SDK") pass("sdk mode runtime status", `label=${sr.actualLabel} status="${sr.statusText}"`);
  else fail("sdk mode runtime status", JSON.stringify(sr));
}

// ============================================================
// Phase 2: auto SDK-first real query
// ============================================================
async function autoSdkFirstSmoke(client) {
  console.log("\n=== Phase 2: auto SDK-first real query ===");
  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const vp = app.vault.adapter.getBasePath();

      plugin.settings.backendMode = "auto";
      plugin.settings.claudePermissionMode = "plan";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      const backend = view.getBackend();
      const backendType = backend.constructor.name;
      const backendName = backend.name;

      const evts = [];
      const wfEvts = [];
      const task = {
        id: "auto-sdk-" + Date.now(),
        userMessage: "只回复 OK",
        prompt: "只回复 OK 两个字，不要使用任何工具。",
        cwd: vp,
        createdAt: new Date().toISOString(),
      };
      const handle = backend.run(task, plugin.settings, (ev) => {
        evts.push({ type: ev.type, data: typeof ev.data === 'string' ? ev.data.slice(0, 200) : null });
      }, (wf) => { wfEvts.push({ type: wf.type, text: typeof wf.text === 'string' ? wf.text : '' }); });
      const deadline = Date.now() + 60000;
      let finalState = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 800));
        if (evts.some(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped')) {
          finalState = evts.find(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped').type;
          break;
        }
      }
      if (!finalState) { try { handle.stop(); } catch {} finalState = "timeout"; }
      const assistantText = wfEvts.filter(e => e.type === 'message' && e.text).map(e => e.text).join('').slice(0, 200);
      const ok = finalState === 'completed' && /OK/i.test(assistantText) && backendType === 'SdkBackend';

      // restore
      plugin.settings.claudePermissionMode = "default";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;

      return { backendType, backendName, finalState, assistantText, ok };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) fail("auto SDK-first real query", r.error);
  else if (r.ok) pass("auto SDK-first real query", `backend=${r.backendType} state=${r.finalState} text="${r.assistantText}"`);
  else fail("auto SDK-first real query", JSON.stringify(r));
}

// ============================================================
// Phase 3: CLI explicit
// ============================================================
async function cliExplicitSmoke(client) {
  console.log("\n=== Phase 3: CLI explicit ===");
  const expr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const vp = app.vault.adapter.getBasePath();

      plugin.settings.backendMode = "cli";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      const backend = view.getBackend();
      const backendType = backend.constructor.name;
      const backendName = backend.name;

      const evts = [];
      const task = {
        id: "cli-explicit-" + Date.now(),
        userMessage: "只回复 OK",
        prompt: "只回复 OK 两个字。",
        cwd: vp,
        createdAt: new Date().toISOString(),
      };
      const handle = backend.run(task, plugin.settings, (ev) => {
        evts.push({ type: ev.type, data: typeof ev.data === 'string' ? ev.data.slice(0, 200) : null });
      });
      const deadline = Date.now() + 60000;
      let finalState = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 800));
        if (evts.some(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped')) {
          finalState = evts.find(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped').type;
          break;
        }
      }
      if (!finalState) { try { handle.stop(); } catch {} finalState = "timeout"; }
      const assistantText = evts.filter(e => e.type === 'assistant').map(e => e.data).join('').slice(0, 200);
      const ok = finalState === 'completed' && backendType === 'ClaudeCliBackend';

      // restore to auto
      plugin.settings.backendMode = "auto";
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;

      return { backendType, backendName, finalState, assistantText, ok };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) fail("CLI explicit query", r.error);
  else if (r.ok) pass("CLI explicit query", `backend=${r.backendType} state=${r.finalState} text="${r.assistantText}"`);
  else fail("CLI explicit query", JSON.stringify(r));
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log("=== V2.16-B Runtime Smoke ===");
  const page = await findObsidianPage();
  if (!page) { console.error("未找到 Obsidian 页面"); process.exit(1); }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log("CDP 已连接");

  const deployInfo = await deploy(client);
  if (!deployInfo) { console.error("Deploy 失败，终止"); client.close(); process.exit(1); }

  await runtimeStatusSmoke(client);
  await autoSdkFirstSmoke(client);
  await cliExplicitSmoke(client);
  client.close();

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n=== Runtime Smoke 结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("\n失败项:");
    results.filter(r => r.status === "FAIL").forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
