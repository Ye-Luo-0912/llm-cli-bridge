#!/usr/bin/env node
// CDP 布局检查 V2：使用正确的 class 名检查 Bridge View 布局
const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;

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

const CHECK_JS = `
(() => {
  try {
    const app = window.app || globalThis.app;
    if (!app) return { error: "app 不可用" };
    let leaves = app.workspace.getLeavesOfType("llm-cli-bridge-view");
    if (!leaves || leaves.length === 0) return { error: "Bridge View 未打开" };
    const view = leaves[0].view;
    if (!view || !view.contentEl) return { error: "view/contentEl 不可用" };
    const root = view.contentEl;

    const selectors = [
      { name: "view", sel: ".llm-bridge-view" },
      { name: "header", sel: ".llm-bridge-header" },
      { name: "headerRight", sel: ".llm-bridge-header-right" },
      { name: "statusBar", sel: ".llm-bridge-status-bar" },
      { name: "sbTitleRow", sel: ".llm-bridge-sb-title-row" },
      { name: "newBtn", sel: ".llm-bridge-sb-new-session" },
      { name: "sbItems", sel: ".llm-bridge-sb-items" },
      { name: "advancedToggle", sel: ".llm-bridge-sb-advanced-toggle" },
      { name: "preflightBtn", sel: ".llm-bridge-sb-btn" },
      { name: "presets", sel: ".llm-bridge-presets" },
      { name: "presetBtns", sel: ".llm-bridge-preset-btn" },
      { name: "skillsPanel", sel: ".llm-bridge-skills-panel" },
      { name: "skillsHead", sel: ".llm-bridge-skills-head" },
      { name: "skillsToggle", sel: ".llm-bridge-skills-toggle" },
      { name: "skillsImportBtn", sel: ".llm-bridge-skills-import-btn" },
      { name: "historyPanel", sel: ".llm-bridge-history-panel" },
      { name: "historyHead", sel: ".llm-bridge-history-head" },
      { name: "historyToggle", sel: ".llm-bridge-history-toggle" },
      { name: "historyRefreshBtn", sel: ".llm-bridge-history-refresh-btn" },
      { name: "runFlowPanel", sel: ".llm-bridge-run-flow" },
      { name: "runFlowHead", sel: ".llm-bridge-run-flow-head" },
      { name: "runFlowToggle", sel: ".llm-bridge-run-flow-toggle" },
      { name: "messages", sel: ".llm-bridge-messages" },
      { name: "permPanel", sel: ".llm-bridge-perm-panel" },
      { name: "composer", sel: ".llm-bridge-composer" },
      { name: "inputRow", sel: ".llm-bridge-input-row" },
      { name: "inputEl", sel: ".llm-bridge-input" },
      { name: "actionCol", sel: ".llm-bridge-action-col" },
      { name: "sendBtn", sel: ".llm-bridge-send-btn" },
      { name: "stopBtn", sel: ".llm-bridge-stop-btn" },
      { name: "chipsRow", sel: ".llm-bridge-chips-row" },
    ];

    const results = [];
    for (const { name, sel } of selectors) {
      const els = root.querySelectorAll(sel);
      if (els.length === 0) { results.push({ name, sel, found: false, count: 0 }); continue; }
      // 对于多个元素的（如 presetBtns），取第一个 + count
      const el = els[0];
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      results.push({
        name, sel, found: true, count: els.length,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) },
        display: cs.display, position: cs.position, overflow: cs.overflow,
        zIndex: cs.zIndex, mt: cs.marginTop, mb: cs.marginBottom,
      });
    }

    // 检查 header 内按钮对齐
    const headerBtnChecks = [];
    const headerPairs = [
      { name: "skills", header: ".llm-bridge-skills-head", btn: ".llm-bridge-skills-import-btn" },
      { name: "history", header: ".llm-bridge-history-head", btn: ".llm-bridge-history-refresh-btn" },
      { name: "runFlow", header: ".llm-bridge-run-flow-head", btn: ".llm-bridge-run-flow-toggle" },
    ];
    for (const { name, header, btn } of headerPairs) {
      const hEl = root.querySelector(header);
      const bEl = root.querySelector(btn);
      if (!hEl || !bEl) { headerBtnChecks.push({ name, found: false }); continue; }
      const hR = hEl.getBoundingClientRect();
      const bR = bEl.getBoundingClientRect();
      const inside = bR.x >= hR.x && bR.right <= hR.right && bR.y >= hR.y && bR.bottom <= hR.bottom;
      headerBtnChecks.push({
        name, found: true, inside,
        hRect: { y: Math.round(hR.y), h: Math.round(hR.height), bottom: Math.round(hR.bottom), x: Math.round(hR.x), w: Math.round(hR.width) },
        bRect: { y: Math.round(bR.y), h: Math.round(bR.height), bottom: Math.round(bR.bottom), x: Math.round(bR.x), w: Math.round(bR.width) },
      });
    }

    // 检查关键 root 级子元素的 y 重叠
    const rootChildren = [
      { name: "header", sel: ".llm-bridge-header" },
      { name: "pendingWrap", sel: ".llm-bridge-pending-wrap" },
      { name: "statusBar", sel: ".llm-bridge-status-bar" },
      { name: "presets", sel: ".llm-bridge-presets" },
      { name: "skillsPanel", sel: ".llm-bridge-skills-panel" },
      { name: "historyPanel", sel: ".llm-bridge-history-panel" },
      { name: "runFlowPanel", sel: ".llm-bridge-run-flow" },
      { name: "messages", sel: ".llm-bridge-messages" },
      { name: "composer", sel: ".llm-bridge-composer" },
    ];
    const childRects = [];
    for (const { name, sel } of rootChildren) {
      const el = root.querySelector(sel);
      if (!el) { childRects.push({ name, found: false }); continue; }
      const r = el.getBoundingClientRect();
      childRects.push({ name, found: true, y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), x: Math.round(r.x), w: Math.round(r.width) });
    }

    // 检查 root 级子元素的 y 重叠（相邻元素）
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
      rootRect: { x: Math.round(root.getBoundingClientRect().x), y: Math.round(root.getBoundingClientRect().y), w: Math.round(root.getBoundingClientRect().width), h: Math.round(root.getBoundingClientRect().height) },
    };
  } catch (e) { return { error: String(e && e.message || e), stack: e && e.stack }; }
})()
`;

async function main() {
  console.log("[CDP Layout Check V2] 开始...");
  const page = await findObsidianPage();
  if (!page) { console.error("[CDP] 未找到 Obsidian 页面"); process.exit(2); }
  console.log(`[CDP] 页面: ${page.title}`);
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  const result = await client.evaluate(CHECK_JS, false);
  console.log(JSON.stringify(result.result.value, null, 2));
  client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
