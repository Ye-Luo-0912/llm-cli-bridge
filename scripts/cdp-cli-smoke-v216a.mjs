// V2.16-A CLI fallback regression smoke
// Tests: CLI minimal prompt (auto mode), verify no regression
import path from 'node:path';

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const PLUGIN_ID = "llm-cli-bridge";
const VIEW_TYPE = "llm-cli-bridge-view";

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

async function main() {
  console.log("[CLI fallback regression] 开始...");
  const page = await findObsidianPage();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  // Test 1: CLI minimal prompt (auto mode)
  console.log("\n=== Test 1: CLI minimal prompt (auto mode) ===");
  const queryExpr = `(async () => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins["${PLUGIN_ID}"];
      const oldMode = plugin.settings.backendMode;
      plugin.settings.backendMode = "auto";
      await plugin.saveSettings();
      const leaves = app.workspace.getLeavesOfType("${VIEW_TYPE}");
      if (leaves.length === 0) return { error: "view not found" };
      const view = leaves[0].view;
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      const backend = view.getBackend();
      const vaultPath = app.vault.adapter.getBasePath();
      const evts = [];
      const task = {
        id: "cli-smoke-" + Date.now(),
        userMessage: "只回复 OK",
        prompt: "只回复 OK 两个字，不要使用任何工具。",
        cwd: vaultPath,
        createdAt: new Date().toISOString(),
      };
      const handle = backend.run(task, plugin.settings, (ev) => {
        evts.push({ type: ev.type, data: typeof ev.data === 'string' ? ev.data.slice(0, 300) : null });
      });

      const deadline = Date.now() + 120000;
      let finalState = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 800));
        const terminal = evts.find(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped');
        if (terminal) { finalState = terminal.type; break; }
      }
      if (!finalState) { try { handle.stop(); } catch {} finalState = "timeout"; }

      plugin.settings.backendMode = oldMode;
      await plugin.saveSettings();
      view.cachedBackend = null;
      view.cachedBackendMode = null;

      const stdoutData = evts.find(e => e.type === 'stdout_delta');
      return {
        finalState,
        eventCount: evts.length,
        eventTypes: evts.map(e => e.type),
        stdoutSnippet: stdoutData ? stdoutData.data : null,
        sampleEvents: evts.slice(0, 15),
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`;
  let r = await client.evaluate(queryExpr, true);
  console.log("CLI query:", JSON.stringify(r.result.value, null, 2));

  const result = r.result.value;
  const cliPass = result && !result.error && result.finalState === "completed" &&
    result.stdoutSnippet && result.stdoutSnippet.includes("OK");
  console.log(`\nTest 1 (CLI minimal): ${cliPass ? 'PASS' : 'FAIL'}`);

  // Test 2: Verify CLI backend type
  console.log("\n=== Test 2: Verify CLI backend type ===");
  const verifyExpr = `(() => {
    try {
      const app = window.app || globalThis.app;
      const plugin = app.plugins.plugins["${PLUGIN_ID}"];
      const oldMode = plugin.settings.backendMode;
      plugin.settings.backendMode = "auto";
      const leaves = app.workspace.getLeavesOfType("${VIEW_TYPE}");
      const view = leaves[0].view;
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      const backend = view.getBackend();
      const backendType = backend.constructor.name;
      plugin.settings.backendMode = oldMode;
      view.cachedBackend = null;
      view.cachedBackendMode = null;
      return { backendType, isCli: backendType.includes('Cli') || backendType.includes('CLI') };
    } catch (e) { return { error: e.message }; }
  })()`;
  r = await client.evaluate(verifyExpr, false);
  console.log("backend type:", JSON.stringify(r.result.value, null, 2));
  const typePass = r.result.value && r.result.value.isCli;
  console.log(`Test 2 (CLI backend type): ${typePass ? 'PASS' : 'FAIL'}`);

  console.log(`\n=== CLI Regression Summary ===`);
  console.log(`Test 1 (CLI minimal): ${cliPass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 2 (CLI backend type): ${typePass ? 'PASS' : 'FAIL'}`);
  console.log(`Overall: ${(cliPass ? 1 : 0) + (typePass ? 1 : 0)}/2 PASS`);

  client.close();
  console.log("\n[CLI fallback regression] 完成");
}

main().catch(e => { console.error(e); process.exit(1); });
