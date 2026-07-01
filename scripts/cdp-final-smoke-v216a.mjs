#!/usr/bin/env node
// V2.16-A Final CDP Smoke — Deploy + UI checks
// SDK/CLI smoke 由 cdp-sdk-smoke-v216a.mjs 和 cdp-cli-smoke-v216a.mjs 独立运行
// 运行: node scripts/cdp-final-smoke-v216a.mjs

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
// Phase 0: Deploy main.js + styles.css + reload
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
      const mainStat = fs.statSync(path.join(pluginDir, 'main.js'));
      const cssStat = fs.statSync(path.join(pluginDir, 'styles.css'));
      return { ok: true, vaultPath, pluginDir, mainSize: mainStat.size, cssSize: cssStat.size };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const res = await client.evaluate(deployExpr, false);
  const r = res.result.value;
  if (r.error) { fail("Deploy main.js + styles.css", r.error); return null; }
  pass("Deploy main.js + styles.css", `main=${r.mainSize}B css=${r.cssSize}B vault=${r.vaultPath}`);

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
  if (rl.error) { fail("Reload plugin + open view", rl.error); return null; }
  pass("Reload plugin + open view", "OK");
  return r;
}

// ============================================================
// Phase 1: UI Smoke
// ============================================================
async function uiSmoke(client) {
  console.log("\n=== Phase 1: UI Smoke ===");

  // 1a. Tab switching (Chat/Files/Skills/History) — click nav buttons
  const tabExpr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const root = view.containerEl;
      const tabs = ["chat", "files", "skills", "history"];
      const results = [];
      for (const tab of tabs) {
        const navBtn = root.querySelector('.llm-bridge-nav-item[data-tab="' + tab + '"]');
        if (!navBtn) { results.push({ tab, match: false, reason: "nav button not found" }); continue; }
        navBtn.click();
        await new Promise(r => setTimeout(r, 250));
        const activePanel = root.querySelector(".llm-bridge-tab-panel.is-active");
        results.push({ tab, match: tab === activePanel?.getAttribute("data-panel") });
      }
      root.querySelector('.llm-bridge-nav-item[data-tab="chat"]')?.click();
      await new Promise(r => setTimeout(r, 200));
      return { results };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const tabRes = await client.evaluate(tabExpr, true);
  const tr = tabRes.result.value;
  if (tr.error) fail("Tab switching (Chat/Files/Skills/History)", tr.error);
  else if (tr.results.every(r => r.match)) pass("Tab switching (Chat/Files/Skills/History)", "4 tabs all match");
  else fail("Tab switching", JSON.stringify(tr.results));

  // 1b. Composer textarea min-height (88px → 112px fix)
  const composerExpr = `(() => {
    try {
      const view = (window.app || globalThis.app).workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const s = getComputedStyle(view.inputEl);
      return { inputMinHeight: s.minHeight, rows: view.inputEl.getAttribute("rows") };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const compRes = await client.evaluate(composerExpr, false);
  const cr = compRes.result.value;
  if (cr.error) fail("Composer textarea min-height", cr.error);
  else if (parseInt(cr.inputMinHeight) >= 112) pass("Composer textarea min-height", `minHeight=${cr.inputMinHeight} rows=${cr.rows}`);
  else fail("Composer textarea min-height", JSON.stringify(cr));

  // 1c. @ picker open + Escape close
  const mentionExpr = `(async () => {
    try {
      const view = (window.app || globalThis.app).workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const input = view.inputEl;
      input.value = "test @";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const picker = view.mentionPickerEl;
      const pickerOpen = picker && !picker.hasAttribute("hidden");
      const itemCount = picker ? picker.querySelectorAll(".llm-bridge-mention-picker-item").length : 0;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const pickerClosed = picker ? picker.hasAttribute("hidden") : true;
      input.value = "";
      view.closeMentionPicker();
      return { pickerOpen, itemCount, pickerClosed };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const menRes = await client.evaluate(mentionExpr, true);
  const mr = menRes.result.value;
  if (mr.error) fail("@ picker open/Escape close", mr.error);
  else if (mr.pickerOpen && mr.pickerClosed) pass("@ picker open/Escape close", `items=${mr.itemCount} closed=${mr.pickerClosed}`);
  else fail("@ picker open/Escape close", JSON.stringify(mr));

  // 1d. Model picker open + has model/effort columns + Escape close
  const modelExpr = `(async () => {
    try {
      const view = (window.app || globalThis.app).workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      view.modelEffortButtonEl.click();
      await new Promise(r => setTimeout(r, 300));
      const popover = view.modelEffortPopoverEl;
      const open = !popover.hasAttribute("hidden");
      const hasModel = !!popover.querySelector(".llm-bridge-model-list");
      const hasEffort = !!popover.querySelector(".llm-bridge-effort-list");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const closed = popover.hasAttribute("hidden");
      return { open, hasModel, hasEffort, closed };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const modRes = await client.evaluate(modelExpr, true);
  const modr = modRes.result.value;
  if (modr.error) fail("Model picker open/Escape close", modr.error);
  else if (modr.open && modr.hasModel && modr.hasEffort && modr.closed) pass("Model picker open/Escape close", `modelCol=${modr.hasModel} effortCol=${modr.hasEffort}`);
  else fail("Model picker open/Escape close", JSON.stringify(modr));

  // 1e. Skills tab: Agent Skills only, no Prompt Snippets — click nav button
  const skillsExpr = `(async () => {
    try {
      const view = (window.app || globalThis.app).workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      const root = view.containerEl;
      root.querySelector('.llm-bridge-nav-item[data-tab="skills"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      const panel = view.tabPanels.skills;
      const hasAgent = !!panel.querySelector(".llm-bridge-agent-skills-body");
      const hasSnippet = !!panel.querySelector(".llm-bridge-snippet-search, .llm-bridge-prompt-snippet-list");
      root.querySelector('.llm-bridge-nav-item[data-tab="chat"]')?.click();
      await new Promise(r => setTimeout(r, 200));
      return { hasAgent, hasSnippet };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const skRes = await client.evaluate(skillsExpr, true);
  const skr = skRes.result.value;
  if (skr.error) fail("Skills tab Agent Skills only", skr.error);
  else if (skr.hasAgent && !skr.hasSnippet) pass("Skills tab Agent Skills only", "agentSkills=yes snippets=no");
  else fail("Skills tab Agent Skills only", JSON.stringify(skr));

  // 1f. Composer input functional
  const inputExpr = `(() => {
    try {
      const view = (window.app || globalThis.app).workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view;
      view.inputEl.value = "smoke test input";
      view.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      const ok = view.inputEl.value === "smoke test input";
      view.inputEl.value = "";
      return { ok };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  const inRes = await client.evaluate(inputExpr, false);
  const inr = inRes.result.value;
  if (inr.error) fail("Composer input functional", inr.error);
  else if (inr.ok) pass("Composer input functional", "input accepts text");
  else fail("Composer input functional", JSON.stringify(inr));
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log("=== V2.16-A Final CDP Smoke (Deploy + UI) ===");
  const page = await findObsidianPage();
  if (!page) { console.error("未找到 Obsidian 页面"); process.exit(1); }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log("CDP 已连接");

  const deployInfo = await deploy(client);
  if (!deployInfo) { console.error("Deploy 失败，终止"); client.close(); process.exit(1); }

  await uiSmoke(client);
  client.close();

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n=== UI Smoke 结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("\n失败项:");
    results.filter(r => r.status === "FAIL").forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
