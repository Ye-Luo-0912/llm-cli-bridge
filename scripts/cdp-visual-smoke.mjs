#!/usr/bin/env node
// V2.12.1 UI Refactor — CDP Visual Smoke (Tab 布局)
// 验证：tab-bar 存在 + 三个 tab 按钮 + 默认 Chat + 切换 Skills/History + 各 tab 内关键元素可见 + 无重叠
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const VAULT_PLUGIN_DIR = "D:\\Users\\Ye_Luo\\APP\\Obsidian\\LLM-Wiki\\.obsidian\\plugins\\llm-cli-bridge";
const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const REPORT_PATH = path.resolve(PLUGIN_DIR, 'docs', 'V2.12.1_UI_SMOKE.md');
const PLUGIN_ID = "llm-cli-bridge";

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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function copyBuildToVault() {
  const files = ["main.js", "styles.css", "manifest.json"];
  const copied = [];
  for (const f of files) {
    const src = path.join(PLUGIN_DIR, f);
    const dst = path.join(VAULT_PLUGIN_DIR, f);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, dst);
    copied.push(f);
  }
  return copied;
}

// 布局检查 JS（指定 active tab）
function layoutCheckJS(tab) {
  return `
(() => {
  try {
    const app = window.app || globalThis.app;
    if (!app) return { error: "app 不可用" };
    let leaves = app.workspace.getLeavesOfType("llm-cli-bridge-view");
    if (!leaves || leaves.length === 0) return { error: "Bridge View 未打开" };
    const view = leaves[0].view;
    if (!view || !view.contentEl) return { error: "view/contentEl 不可用" };
    const root = view.contentEl;

    // 切换到指定 tab
    const tabBtn = root.querySelector('.llm-bridge-tab[data-tab=${JSON.stringify(tab)}]');
    if (tabBtn) tabBtn.click();

    const selectors = [
      { name: "tabBar", sel: ".llm-bridge-tab-bar" },
      { name: "chatTab", sel: '.llm-bridge-tab[data-tab=chat]' },
      { name: "skillsTab", sel: '.llm-bridge-tab[data-tab=skills]' },
      { name: "historyTab", sel: '.llm-bridge-tab[data-tab=history]' },
      { name: "chatPanel", sel: '.llm-bridge-tab-panel[data-panel=chat]' },
      { name: "skillsPanel", sel: '.llm-bridge-tab-panel[data-panel=skills]' },
      { name: "historyPanel", sel: '.llm-bridge-tab-panel[data-panel=history]' },
      { name: "header", sel: ".llm-bridge-header" },
      { name: "newBtn", sel: ".llm-bridge-sb-new-session" },
      { name: "advancedToggle", sel: ".llm-bridge-sb-advanced-toggle" },
      { name: "preflightBtn", sel: ".llm-bridge-sb-btn" },
      { name: "presets", sel: ".llm-bridge-presets" },
      { name: "presetBtns", sel: ".llm-bridge-preset-btn" },
      { name: "skillsHead", sel: ".llm-bridge-skills-head" },
      { name: "skillsImportBtn", sel: ".llm-bridge-skills-import-btn" },
      { name: "historyHead", sel: ".llm-bridge-history-head" },
      { name: "historyRefreshBtn", sel: ".llm-bridge-history-refresh-btn" },
      { name: "composer", sel: ".llm-bridge-composer" },
      { name: "inputEl", sel: ".llm-bridge-input" },
      { name: "sendBtn", sel: ".llm-bridge-send-btn" },
    ];

    const results = [];
    for (const { name, sel } of selectors) {
      const els = root.querySelectorAll(sel);
      if (els.length === 0) { results.push({ name, found: false, count: 0 }); continue; }
      const el = els[0];
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      results.push({
        name, found: true, count: els.length,
        visible: r.width > 0 && r.height > 0,
        display: cs.display,
        isActive: el.classList.contains("is-active"),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) },
      });
    }

    // 检查当前 active tab/panel
    const activeTab = root.querySelector(".llm-bridge-tab.is-active");
    const activePanel = root.querySelector(".llm-bridge-tab-panel.is-active");
    const activeTabName = activeTab ? activeTab.getAttribute("data-tab") : null;
    const activePanelName = activePanel ? activePanel.getAttribute("data-panel") : null;
    const activePanelVisible = activePanel ? activePanel.getBoundingClientRect().height > 0 : false;

    // root 级子元素 y 重叠检查（tab-bar + 三个 panel + header）
    const rootChildren = [
      { name: "header", sel: ".llm-bridge-header" },
      { name: "tabBar", sel: ".llm-bridge-tab-bar" },
      { name: "chatPanel", sel: '.llm-bridge-tab-panel[data-panel=chat]' },
      { name: "skillsPanel", sel: '.llm-bridge-tab-panel[data-panel=skills]' },
      { name: "historyPanel", sel: '.llm-bridge-tab-panel[data-panel=history]' },
    ];
    const childRects = [];
    for (const { name, sel } of rootChildren) {
      const el = root.querySelector(sel);
      if (!el) { childRects.push({ name, found: false }); continue; }
      const r = el.getBoundingClientRect();
      childRects.push({ name, found: true, y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), display: window.getComputedStyle(el).display });
    }
    const childOverlaps = [];
    const foundChildren = childRects.filter(c => c.found);
    for (let i = 0; i < foundChildren.length - 1; i++) {
      const a = foundChildren[i], b = foundChildren[i + 1];
      if (a.display === "none" || b.display === "none") continue;
      if (a.bottom > b.y + 1 && b.bottom > a.y + 1) {
        childOverlaps.push({ a: a.name, b: b.name, aBottom: a.bottom, bTop: b.y, overlap: a.bottom - b.y });
      }
    }

    return {
      tab: ${JSON.stringify(tab)}, activeTabName, activePanelName, activePanelVisible,
      results, childRects, childOverlaps,
      viewportW: window.innerWidth, viewportH: window.innerHeight,
    };
  } catch (e) { return { error: String(e && e.message || e), stack: e && e.stack }; }
})()
`;
}

function judge(result, expectedTab) {
  const checks = [];
  if (result.error) return { pass: false, checks: [{ name: "runtime", pass: false, reason: result.error }] };

  // tab-bar + 三个 tab 按钮存在
  const tabBar = result.results.find(x => x.name === "tabBar");
  checks.push({ name: "found:tabBar", pass: !!(tabBar && tabBar.found), reason: tabBar && tabBar.found ? "" : "tab-bar 未找到" });
  for (const t of ["chatTab", "skillsTab", "historyTab"]) {
    const r = result.results.find(x => x.name === t);
    checks.push({ name: `found:${t}`, pass: !!(r && r.found), reason: r && r.found ? "" : "tab 按钮未找到" });
  }

  // 当前 active tab 正确
  checks.push({ name: `activeTab=${expectedTab}`, pass: result.activeTabName === expectedTab, reason: `期望 ${expectedTab}，实际 ${result.activeTabName}` });
  checks.push({ name: `activePanel=${expectedTab}`, pass: result.activePanelName === expectedTab, reason: `期望 ${expectedTab}，实际 ${result.activePanelName}` });
  checks.push({ name: "activePanelVisible", pass: !!result.activePanelVisible, reason: "active panel 不可见" });

  // tab 特定检查
  if (expectedTab === "chat") {
    for (const name of ["header", "newBtn", "advancedToggle", "preflightBtn", "presets", "composer", "inputEl", "sendBtn"]) {
      const r = result.results.find(x => x.name === name);
      if (r && r.found) checks.push({ name: `visible:${name}`, pass: !!r.visible, reason: r.visible ? "" : "不可见" });
    }
    const presetBtns = result.results.find(x => x.name === "presetBtns");
    checks.push({ name: "presetBtns>=3", pass: !!(presetBtns && presetBtns.count >= 3), reason: `实际 ${presetBtns ? presetBtns.count : 0} 个` });
  } else if (expectedTab === "skills") {
    for (const name of ["skillsHead", "skillsImportBtn"]) {
      const r = result.results.find(x => x.name === name);
      if (r && r.found) checks.push({ name: `visible:${name}`, pass: !!r.visible, reason: r.visible ? "" : "不可见" });
    }
  } else if (expectedTab === "history") {
    for (const name of ["historyHead", "historyRefreshBtn"]) {
      const r = result.results.find(x => x.name === name);
      if (r && r.found) checks.push({ name: `visible:${name}`, pass: !!r.visible, reason: r.visible ? "" : "不可见" });
    }
  }

  // 无 root 级 y 重叠
  checks.push({ name: "noChildOverlaps", pass: result.childOverlaps.length === 0, reason: result.childOverlaps.length === 0 ? "" : `${result.childOverlaps.length} 处重叠` });

  const pass = checks.every(c => c.pass);
  return { pass, checks };
}

async function main() {
  console.log("[V2.12.1 UI Refactor Smoke] 开始...");
  const startTime = new Date().toISOString();

  console.log("[1/7] 复制构建产物到 Vault 插件目录...");
  const copied = copyBuildToVault();
  console.log("  已复制:", copied.join(", "));

  console.log("[2/7] 连接 CDP...");
  const page = await findObsidianPage();
  if (!page) { console.error("[CDP] 未找到 Obsidian 页面"); process.exit(2); }
  console.log(`  页面: ${page.title}`);
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  console.log("[3/7] 热重载插件...");
  // 正确 API：app.plugins.disablePlugin/enablePlugin；先 detach view leaves 再重新打开
  await client.evaluate(`(async () => { try { await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)}); return "ok"; } catch (e) { return "ERROR: " + e.message; } })()`, true);
  await sleep(800);
  await client.evaluate(`(() => { const ls = app.workspace.getLeavesOfType("llm-cli-bridge-view"); for (const l of ls) l.detach(); return ls.length; })()`, true);
  await sleep(300);
  await client.evaluate(`(async () => { try { await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)}); return "ok"; } catch (e) { return "ERROR: " + e.message; } })()`, true);
  await sleep(1500);
  // 重新打开 view（enablePlugin 后 view leaf 已 detach，需要重新打开）
  await client.evaluate(`(async () => { try { const leaf = app.workspace.getRightLeaf(false); await leaf.setViewState({ type: "llm-cli-bridge-view", active: true }); return "ok"; } catch (e) { return "ERROR: " + e.message; } })()`, true);
  await sleep(1000);

  console.log("[4/7] Chat tab 检查...");
  const chatResult = await client.evaluate(layoutCheckJS("chat"), false);
  const chat = chatResult.result.value;
  const chatJudge = judge(chat, "chat");
  console.log(`  Chat tab: ${chatJudge.pass ? "PASS" : "FAIL"} (${chatJudge.checks.filter(c => c.pass).length}/${chatJudge.checks.length})`);

  console.log("[5/7] Skills tab 检查...");
  const skillsResult = await client.evaluate(layoutCheckJS("skills"), false);
  const skills = skillsResult.result.value;
  const skillsJudge = judge(skills, "skills");
  console.log(`  Skills tab: ${skillsJudge.pass ? "PASS" : "FAIL"} (${skillsJudge.checks.filter(c => c.pass).length}/${skillsJudge.checks.length})`);

  console.log("[6/7] History tab 检查...");
  const historyResult = await client.evaluate(layoutCheckJS("history"), false);
  const history = historyResult.result.value;
  const historyJudge = judge(history, "history");
  console.log(`  History tab: ${historyJudge.pass ? "PASS" : "FAIL"} (${historyJudge.checks.filter(c => c.pass).length}/${historyJudge.checks.length})`);

  // 切回 Chat
  await client.evaluate(layoutCheckJS("chat"), false);

  const endTime = new Date().toISOString();
  const overallPass = chatJudge.pass && skillsJudge.pass && historyJudge.pass;
  client.close();

  const report = generateReport({
    startTime, endTime, overallPass, copied, page: page.title,
    chat, chatJudge, skills, skillsJudge, history, historyJudge,
  });
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`\n报告已输出: ${path.relative(process.cwd(), REPORT_PATH)}`);
  console.log(`\n=== V2.12.1 UI Refactor Smoke: ${overallPass ? "PASS" : "FAIL"} ===`);
  process.exit(overallPass ? 0 : 1);
}

function generateReport(d) {
  const fmtJudge = (j) => {
    const pass = j.checks.filter(c => c.pass).map(c => `- ✅ ${c.name}`).join("\n");
    const fail = j.checks.filter(c => !c.pass).map(c => `- ❌ ${c.name}: ${c.reason}`).join("\n");
    return { pass, fail };
  };
  const fmtResults = (r) => !r || r.error || !Array.isArray(r.results) ? "-（无数据）" : r.results.filter(x => x.found).map(x => `| ${x.name} | ✅ | ${x.visible ? "✅" : "❌"} | ${x.isActive ? "✅" : "-"} | ${x.rect.x} | ${x.rect.y} | ${x.rect.w} | ${x.rect.h} | ${x.display} |`).join("\n");
  const fmtOverlaps = (r) => !r || r.error || !Array.isArray(r.childOverlaps) ? "-（无数据）" : r.childOverlaps.length === 0 ? "无重叠 ✅" : r.childOverlaps.map(o => `- ❌ ${o.a} ↔ ${o.b}: 重叠 ${o.overlap}px`).join("\n");
  const fmtChildRects = (r) => !r || r.error || !Array.isArray(r.childRects) ? "-（无数据）" : r.childRects.filter(c => c.found).map(c => `| ${c.name} | ${c.y} | ${c.h} | ${c.bottom} | ${c.display} |`).join("\n");
  const errNote = (r) => r && r.error ? `\n\n> ⚠️ Runtime 错误: ${r.error}\n` : "";

  const cj = fmtJudge(d.chatJudge);
  const sj = fmtJudge(d.skillsJudge);
  const hj = fmtJudge(d.historyJudge);

  return `# V2.12.1 UI Refactor — CDP Visual Smoke 报告

- **验证时间**: ${d.startTime} → ${d.endTime}
- **CDP 页面**: ${d.page}
- **复制的文件**: ${d.copied.join(", ")}
- **总体结果**: ${d.overallPass ? "✅ PASS" : "❌ FAIL"}

## 1. Chat tab 检查: ${d.chatJudge.pass ? "✅ PASS" : "❌ FAIL"}

### 通过项
${cj.pass || "-（无）"}

### 失败项
${cj.fail || "-（无）"}

### 元素详情
| 元素 | found | visible | active | x | y | w | h | display |
|---|---|---|---|---|---|---|---|---|
${fmtResults(d.chat)}${errNote(d.chat)}

### Root 级子元素
| 元素 | y | h | bottom | display |
|---|---|---|---|---|
${fmtChildRects(d.chat)}

### Y 重叠
${fmtOverlaps(d.chat)}

## 2. Skills tab 检查: ${d.skillsJudge.pass ? "✅ PASS" : "❌ FAIL"}

### 通过项
${sj.pass || "-（无）"}

### 失败项
${sj.fail || "-（无）"}

### 元素详情
| 元素 | found | visible | active | x | y | w | h | display |
|---|---|---|---|---|---|---|---|---|
${fmtResults(d.skills)}${errNote(d.skills)}

### Root 级子元素
| 元素 | y | h | bottom | display |
|---|---|---|---|---|
${fmtChildRects(d.skills)}

### Y 重叠
${fmtOverlaps(d.skills)}

## 3. History tab 检查: ${d.historyJudge.pass ? "✅ PASS" : "❌ FAIL"}

### 通过项
${hj.pass || "-（无）"}

### 失败项
${hj.fail || "-（无）"}

### 元素详情
| 元素 | found | visible | active | x | y | w | h | display |
|---|---|---|---|---|---|---|---|---|
${fmtResults(d.history)}${errNote(d.history)}

### Root 级子元素
| 元素 | y | h | bottom | display |
|---|---|---|---|---|
${fmtChildRects(d.history)}

### Y 重叠
${fmtOverlaps(d.history)}

## 4. 验证项清单

| 验证项 | Chat | Skills | History |
|---|---|---|---|
| tab-bar 存在 | ${d.chatJudge.checks.find(c => c.name === "found:tabBar")?.pass ? "✅" : "❌"} | - | - |
| Chat tab 按钮 | ${d.chatJudge.checks.find(c => c.name === "found:chatTab")?.pass ? "✅" : "❌"} | - | - |
| Skills tab 按钮 | ${d.chatJudge.checks.find(c => c.name === "found:skillsTab")?.pass ? "✅" : "❌"} | - | - |
| History tab 按钮 | ${d.chatJudge.checks.find(c => c.name === "found:historyTab")?.pass ? "✅" : "❌"} | - | - |
| active tab 正确 | ${d.chatJudge.checks.find(c => c.name === "activeTab=chat")?.pass ? "✅" : "❌"} | ${d.skillsJudge.checks.find(c => c.name === "activeTab=skills")?.pass ? "✅" : "❌"} | ${d.historyJudge.checks.find(c => c.name === "activeTab=history")?.pass ? "✅" : "❌"} |
| active panel 可见 | ${d.chatJudge.checks.find(c => c.name === "activePanelVisible")?.pass ? "✅" : "❌"} | ${d.skillsJudge.checks.find(c => c.name === "activePanelVisible")?.pass ? "✅" : "❌"} | ${d.historyJudge.checks.find(c => c.name === "activePanelVisible")?.pass ? "✅" : "❌"} |
| New 按钮可见 | ${d.chatJudge.checks.find(c => c.name === "visible:newBtn")?.pass ? "✅" : "❌"} | - | - |
| Preflight 按钮可见 | ${d.chatJudge.checks.find(c => c.name === "visible:preflightBtn")?.pass ? "✅" : "❌"} | - | - |
| Advanced 按钮可见 | ${d.chatJudge.checks.find(c => c.name === "visible:advancedToggle")?.pass ? "✅" : "❌"} | - | - |
| 3 个 preset 按钮 | ${d.chatJudge.checks.find(c => c.name === "presetBtns>=3")?.pass ? "✅" : "❌"} | - | - |
| Skills 导入按钮可见 | - | ${d.skillsJudge.checks.find(c => c.name === "visible:skillsImportBtn")?.pass ? "✅" : "❌"} | - |
| History 刷新按钮可见 | - | - | ${d.historyJudge.checks.find(c => c.name === "visible:historyRefreshBtn")?.pass ? "✅" : "❌"} |
| 底部输入框可见 | ${d.chatJudge.checks.find(c => c.name === "visible:inputEl")?.pass ? "✅" : "❌"} | - | - |
| 发送按钮可见 | ${d.chatJudge.checks.find(c => c.name === "visible:sendBtn")?.pass ? "✅" : "❌"} | - | - |
| 无 root 级 y 重叠 | ${d.chatJudge.checks.find(c => c.name === "noChildOverlaps")?.pass ? "✅" : "❌"} | ${d.skillsJudge.checks.find(c => c.name === "noChildOverlaps")?.pass ? "✅" : "❌"} | ${d.historyJudge.checks.find(c => c.name === "noChildOverlaps")?.pass ? "✅" : "❌"} |

---
*本报告由 V2.12.1 UI Refactor CDP Visual Smoke 自动生成*
`;
}

main().catch(e => { console.error(e); process.exit(1); });
