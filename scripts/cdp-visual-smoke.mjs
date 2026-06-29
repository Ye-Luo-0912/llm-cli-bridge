#!/usr/bin/env node
// V2.12.1 UI Recovery — CDP Visual Smoke
// 功能：复制最新 main.js + styles.css 到 Vault 插件目录 → 热重载插件 → 检查布局（折叠+展开）→ 输出 PASS/FAIL + 报告
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const VAULT_PLUGIN_DIR = "D:\\Users\\Ye_Luo\\APP\\Obsidian\\LLM-Wiki\\.obsidian\\plugins\\llm-cli-bridge";
const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const REPORT_PATH = path.resolve(PLUGIN_DIR, 'docs', 'V2.12.1_UI_SMOKE.md');
const PLUGIN_ID = "obsidian-llm-cli-bridge";

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

// 复制构建产物到 Vault 插件目录
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

// 布局检查 JS（可指定是否展开 Skills/History）
function layoutCheckJS(expand) {
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

    ${expand ? `
    // 展开状态：点击 Skills/History toggle
    const skillsToggle = root.querySelector(".llm-bridge-skills-toggle");
    const historyToggle = root.querySelector(".llm-bridge-history-toggle");
    if (skillsToggle) {
      const skillsHead = root.querySelector(".llm-bridge-skills-head");
      const skillsBody = root.querySelector(".llm-bridge-skills-body");
      if (skillsBody && skillsBody.hasAttribute("hidden")) skillsHead.click();
    }
    if (historyToggle) {
      const historyHead = root.querySelector(".llm-bridge-history-head");
      const historyBody = root.querySelector(".llm-bridge-history-body");
      if (historyBody && historyBody.hasAttribute("hidden")) historyHead.click();
    }
    ` : ""}

    const selectors = [
      { name: "header", sel: ".llm-bridge-header" },
      { name: "newBtn", sel: ".llm-bridge-sb-new-session" },
      { name: "advancedToggle", sel: ".llm-bridge-sb-advanced-toggle" },
      { name: "preflightBtn", sel: ".llm-bridge-sb-btn" },
      { name: "presets", sel: ".llm-bridge-presets" },
      { name: "presetBtns", sel: ".llm-bridge-preset-btn" },
      { name: "skillsHead", sel: ".llm-bridge-skills-head" },
      { name: "skillsToggle", sel: ".llm-bridge-skills-toggle" },
      { name: "skillsImportBtn", sel: ".llm-bridge-skills-import-btn" },
      { name: "historyHead", sel: ".llm-bridge-history-head" },
      { name: "historyToggle", sel: ".llm-bridge-history-toggle" },
      { name: "historyRefreshBtn", sel: ".llm-bridge-history-refresh-btn" },
      { name: "runFlowHead", sel: ".llm-bridge-run-flow-head" },
      { name: "runFlowToggle", sel: ".llm-bridge-run-flow-toggle" },
      { name: "composer", sel: ".llm-bridge-composer" },
      { name: "inputEl", sel: ".llm-bridge-input" },
      { name: "sendBtn", sel: ".llm-bridge-send-btn" },
    ];

    const results = [];
    // view 自身检查（root 即 .llm-bridge-view）
    const viewR = root.getBoundingClientRect();
    const viewCs = window.getComputedStyle(root);
    results.push({
      name: "view", found: root.classList.contains("llm-bridge-view"), count: 1,
      visible: viewR.width > 0 && viewR.height > 0,
      rect: { x: Math.round(viewR.x), y: Math.round(viewR.y), w: Math.round(viewR.width), h: Math.round(viewR.height), bottom: Math.round(viewR.bottom), right: Math.round(viewR.right) },
      display: viewCs.display,
    });
    for (const { name, sel } of selectors) {
      const els = root.querySelectorAll(sel);
      if (els.length === 0) { results.push({ name, found: false, count: 0 }); continue; }
      const el = els[0];
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      results.push({
        name, found: true, count: els.length,
        visible: r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) },
        display: cs.display,
      });
    }

    // header 内按钮对齐检查
    const headerBtnChecks = [];
    const headerPairs = [
      { name: "skills", header: ".llm-bridge-skills-head", btn: ".llm-bridge-skills-import-btn" },
      { name: "history", header: ".llm-bridge-history-head", btn: ".llm-bridge-history-refresh-btn" },
      { name: "runFlow", header: ".llm-bridge-run-flow-head", btn: ".llm-bridge-run-flow-toggle" },
    ];
    for (const { name, header, btn } of headerPairs) {
      const hEl = root.querySelector(header);
      const bEl = root.querySelector(btn);
      if (!hEl || !bEl) { headerBtnChecks.push({ name, found: false, inside: false }); continue; }
      const hR = hEl.getBoundingClientRect();
      const bR = bEl.getBoundingClientRect();
      const inside = bR.x >= hR.x && bR.right <= hR.right + 1 && bR.y >= hR.y - 1 && bR.bottom <= hR.bottom + 1;
      headerBtnChecks.push({
        name, found: true, inside,
        hRect: { y: Math.round(hR.y), h: Math.round(hR.height), bottom: Math.round(hR.bottom), x: Math.round(hR.x), w: Math.round(hR.width) },
        bRect: { y: Math.round(bR.y), h: Math.round(bR.height), bottom: Math.round(bR.bottom), x: Math.round(bR.x), w: Math.round(bR.width) },
      });
    }

    // root 级子元素 y 重叠检查
    const rootChildren = [
      { name: "header", sel: ".llm-bridge-header" },
      { name: "pendingWrap", sel: ".llm-bridge-pending-wrap" },
      { name: "statusBar", sel: ".llm-bridge-status-bar" },
      { name: "presets", sel: ".llm-bridge-presets" },
      { name: "skillsPanel", sel: ".llm-bridge-skills-panel" },
      { name: "historyPanel", sel: ".llm-bridge-history-panel" },
      { name: "runFlowPanel", sel: ".llm-bridge-run-flow" },
      { name: "messages", sel: ".llm-bridge-messages" },
      { name: "permPanel", sel: ".llm-bridge-perm-panel" },
      { name: "composer", sel: ".llm-bridge-composer" },
    ];
    const childRects = [];
    for (const { name, sel } of rootChildren) {
      const el = root.querySelector(sel);
      if (!el) { childRects.push({ name, found: false }); continue; }
      const r = el.getBoundingClientRect();
      childRects.push({ name, found: true, y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), x: Math.round(r.x), w: Math.round(r.width) });
    }
    const childOverlaps = [];
    const foundChildren = childRects.filter(c => c.found);
    for (let i = 0; i < foundChildren.length - 1; i++) {
      const a = foundChildren[i], b = foundChildren[i + 1];
      if (a.bottom > b.y + 1 && b.bottom > a.y + 1) {
        childOverlaps.push({ a: a.name, b: b.name, aBottom: a.bottom, bTop: b.y, overlap: a.bottom - b.y });
      }
    }

    return {
      results,
      headerBtnChecks,
      childRects,
      childOverlaps,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    };
  } catch (e) { return { error: String(e && e.message || e), stack: e && e.stack }; }
})()
`;
}

// 判定 PASS/FAIL
function judge(result) {
  const checks = [];
  if (result.error) return { pass: false, checks: [{ name: "runtime", pass: false, reason: result.error }] };

  // 1. 关键元素全部 found
  const required = ["view", "header", "newBtn", "advancedToggle", "preflightBtn", "presets",
    "skillsHead", "skillsToggle", "skillsImportBtn", "historyHead", "historyToggle", "historyRefreshBtn",
    "runFlowHead", "runFlowToggle", "composer", "inputEl", "sendBtn"];
  for (const name of required) {
    const r = result.results.find(x => x.name === name);
    checks.push({ name: `found:${name}`, pass: !!(r && r.found), reason: r && r.found ? "" : "元素未找到" });
  }

  // 2. 关键元素 visible（width/height > 0）
  for (const name of required) {
    const r = result.results.find(x => x.name === name);
    if (r && r.found) {
      checks.push({ name: `visible:${name}`, pass: !!r.visible, reason: r.visible ? "" : "元素不可见（0 尺寸）" });
    }
  }

  // 3. preset 按钮至少 3 个
  const presetBtns = result.results.find(x => x.name === "presetBtns");
  checks.push({ name: "presetBtns>=3", pass: !!(presetBtns && presetBtns.count >= 3), reason: `实际 ${presetBtns ? presetBtns.count : 0} 个` });

  // 4. header 内按钮对齐
  for (const hc of result.headerBtnChecks) {
    if (hc.found) {
      checks.push({ name: `headerBtnInside:${hc.name}`, pass: !!hc.inside, reason: hc.inside ? "" : "按钮不在 header 内" });
    }
  }

  // 5. root 级子元素无 y 重叠
  checks.push({ name: "noChildOverlaps", pass: result.childOverlaps.length === 0, reason: result.childOverlaps.length === 0 ? "" : `${result.childOverlaps.length} 处重叠` });

  const pass = checks.every(c => c.pass);
  return { pass, checks };
}

async function main() {
  console.log("[V2.12.1 UI Smoke] 开始...");
  const startTime = new Date().toISOString();

  // 1. 复制构建产物到 Vault
  console.log("[1/5] 复制构建产物到 Vault 插件目录...");
  const copied = copyBuildToVault();
  console.log("  已复制:", copied.join(", "));

  // 2. 连接 CDP
  console.log("[2/5] 连接 CDP...");
  const page = await findObsidianPage();
  if (!page) { console.error("[CDP] 未找到 Obsidian 页面"); process.exit(2); }
  console.log(`  页面: ${page.title}`);
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  // 3. 热重载插件
  console.log("[3/5] 热重载插件...");
  await client.evaluate(`app.disablePlugin(${JSON.stringify(PLUGIN_ID)})`, true);
  await sleep(300);
  await client.evaluate(`app.enablePlugin(${JSON.stringify(PLUGIN_ID)})`, true);
  await sleep(1500);

  // 4. 折叠状态检查
  console.log("[4/5] 折叠状态布局检查...");
  const collapsedResult = await client.evaluate(layoutCheckJS(false), false);
  const collapsed = collapsedResult.result.value;
  const collapsedJudge = judge(collapsed);
  console.log(`  折叠状态: ${collapsedJudge.pass ? "PASS" : "FAIL"} (${collapsedJudge.checks.filter(c => c.pass).length}/${collapsedJudge.checks.length})`);

  // 5. 展开状态检查
  console.log("[5/5] 展开状态布局检查...");
  const expandedResult = await client.evaluate(layoutCheckJS(true), false);
  const expanded = expandedResult.result.value;
  const expandedJudge = judge(expanded);
  console.log(`  展开状态: ${expandedJudge.pass ? "PASS" : "FAIL"} (${expandedJudge.checks.filter(c => c.pass).length}/${expandedJudge.checks.length})`);

  const endTime = new Date().toISOString();
  const overallPass = collapsedJudge.pass && expandedJudge.pass;
  client.close();

  // 生成报告
  const report = generateReport({
    startTime, endTime, overallPass,
    copied, page: page.title,
    collapsed, collapsedJudge,
    expanded, expandedJudge,
  });
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`\n报告已输出: ${path.relative(process.cwd(), REPORT_PATH)}`);
  console.log(`\n=== V2.12.1 UI Smoke: ${overallPass ? "PASS" : "FAIL"} ===`);

  process.exit(overallPass ? 0 : 1);
}

function generateReport(d) {
  const failCheck = (judge) => judge.checks.filter(c => !c.pass).map(c => `- ❌ ${c.name}: ${c.reason}`).join("\n");
  const passCheck = (judge) => judge.checks.filter(c => c.pass).map(c => `- ✅ ${c.name}`).join("\n");

  return `# V2.12.1 UI Recovery — CDP Visual Smoke 报告

- **验证时间**: ${d.startTime} → ${d.endTime}
- **CDP 页面**: ${d.page}
- **复制的文件**: ${d.copied.join(", ")}
- **总体结果**: ${d.overallPass ? "✅ PASS" : "❌ FAIL"}

## 1. 折叠状态检查: ${d.collapsedJudge.pass ? "✅ PASS" : "❌ FAIL"}

### 通过项
${passCheck(d.collapsedJudge) || "-（无）"}

### 失败项
${failCheck(d.collapsedJudge) || "-（无）"}

### 布局详情（关键元素）
| 元素 | found | visible | x | y | w | h | display |
|---|---|---|---|---|---|---|---|
${d.collapsed.results.filter(r => r.found).map(r => `| ${r.name} | ✅ | ${r.visible ? "✅" : "❌"} | ${r.rect.x} | ${r.rect.y} | ${r.rect.w} | ${r.rect.h} | ${r.display} |`).join("\n")}

### Header 按钮对齐
| Section | inside | header(y/h) | btn(y/h) |
|---|---|---|---|
${d.collapsed.headerBtnChecks.filter(h => h.found).map(h => `| ${h.name} | ${h.inside ? "✅" : "❌"} | ${h.hRect.y}/${h.hRect.h} | ${h.bRect.y}/${h.bRect.h} |`).join("\n")}

### Root 级子元素
| 元素 | y | h | bottom |
|---|---|---|---|
${d.collapsed.childRects.filter(c => c.found).map(c => `| ${c.name} | ${c.y} | ${c.h} | ${c.bottom} |`).join("\n")}

### Y 重叠
${d.collapsed.childOverlaps.length === 0 ? "无重叠 ✅" : d.collapsed.childOverlaps.map(o => `- ❌ ${o.a} ↔ ${o.b}: 重叠 ${o.overlap}px`).join("\n")}

## 2. 展开状态检查: ${d.expandedJudge.pass ? "✅ PASS" : "❌ FAIL"}

### 通过项
${passCheck(d.expandedJudge) || "-（无）"}

### 失败项
${failCheck(d.expandedJudge) || "-（无）"}

### 布局详情（关键元素）
| 元素 | found | visible | x | y | w | h | display |
|---|---|---|---|---|---|---|---|
${d.expanded.results.filter(r => r.found).map(r => `| ${r.name} | ✅ | ${r.visible ? "✅" : "❌"} | ${r.rect.x} | ${r.rect.y} | ${r.rect.w} | ${r.rect.h} | ${r.display} |`).join("\n")}

### Header 按钮对齐
| Section | inside | header(y/h) | btn(y/h) |
|---|---|---|---|
${d.expanded.headerBtnChecks.filter(h => h.found).map(h => `| ${h.name} | ${h.inside ? "✅" : "❌"} | ${h.hRect.y}/${h.hRect.h} | ${h.bRect.y}/${h.bRect.h} |`).join("\n")}

### Root 级子元素
| 元素 | y | h | bottom |
|---|---|---|---|
${d.expanded.childRects.filter(c => c.found).map(c => `| ${c.name} | ${c.y} | ${c.h} | ${c.bottom} |`).join("\n")}

### Y 重叠
${d.expanded.childOverlaps.length === 0 ? "无重叠 ✅" : d.expanded.childOverlaps.map(o => `- ❌ ${o.a} ↔ ${o.b}: 重叠 ${o.overlap}px`).join("\n")}

## 3. 验证项清单

| 验证项 | 折叠 | 展开 |
|---|---|---|
| New 按钮存在且可见 | ${d.collapsedJudge.checks.find(c => c.name === "visible:newBtn")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "visible:newBtn")?.pass ? "✅" : "❌"} |
| Preflight 按钮存在且可见 | ${d.collapsedJudge.checks.find(c => c.name === "visible:preflightBtn")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "visible:preflightBtn")?.pass ? "✅" : "❌"} |
| Advanced 按钮存在且可见 | ${d.collapsedJudge.checks.find(c => c.name === "visible:advancedToggle")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "visible:advancedToggle")?.pass ? "✅" : "❌"} |
| 3 个 preset 按钮 | ${d.collapsedJudge.checks.find(c => c.name === "presetBtns>=3")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "presetBtns>=3")?.pass ? "✅" : "❌"} |
| Skills header 按钮对齐 | ${d.collapsedJudge.checks.find(c => c.name === "headerBtnInside:skills")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "headerBtnInside:skills")?.pass ? "✅" : "❌"} |
| History header 按钮对齐 | ${d.collapsedJudge.checks.find(c => c.name === "headerBtnInside:history")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "headerBtnInside:history")?.pass ? "✅" : "❌"} |
| Workflow header 按钮对齐 | ${d.collapsedJudge.checks.find(c => c.name === "headerBtnInside:runFlow")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "headerBtnInside:runFlow")?.pass ? "✅" : "❌"} |
| 底部输入框存在且可见 | ${d.collapsedJudge.checks.find(c => c.name === "visible:inputEl")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "visible:inputEl")?.pass ? "✅" : "❌"} |
| 发送按钮存在且可见 | ${d.collapsedJudge.checks.find(c => c.name === "visible:sendBtn")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "visible:sendBtn")?.pass ? "✅" : "❌"} |
| 无 root 级 y 重叠 | ${d.collapsedJudge.checks.find(c => c.name === "noChildOverlaps")?.pass ? "✅" : "❌"} | ${d.expandedJudge.checks.find(c => c.name === "noChildOverlaps")?.pass ? "✅" : "❌"} |

---
*本报告由 V2.12.1 UI Recovery CDP Visual Smoke 自动生成*
`;
}

main().catch(e => { console.error(e); process.exit(1); });
