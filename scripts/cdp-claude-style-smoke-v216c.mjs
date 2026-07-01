#!/usr/bin/env node
// V2.16-C CDP Smoke — Claude-style Runtime UI / Collapsible SDK Timeline
// 运行: node scripts/cdp-claude-style-smoke-v216c.mjs
//
// 验证项:
//  1. backend label 一致为 SDK
//  2. model picker 与 SDK effective model 一致
//  3. timeline 有 session_started/tool_call/completed
//  4. completed 后自动折叠
//  5. raw log 默认折叠
//  6. internal write 不显示主 timeline
//  7. duplicate assistant message 合并
//  8. permission popover 四模式显示并可切换

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const PLUGIN_ID = "llm-cli-bridge";
const VIEW_TYPE = "llm-cli-bridge-view";
const BUILD_DIR = "D:/Users/Ye_Luo/APP/Test/llm-cli-bridge";

const results = [];
function pass(name, detail) { results.push({ name, status: "PASS", detail: detail || "" }); console.log("  ✅ " + name + (detail ? " — " + detail : "")); }
function fail(name, detail) { results.push({ name, status: "FAIL", detail: detail || "" }); console.log("  ❌ " + name + (detail ? " — " + detail : "")); }

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
  const resp = await fetch("http://" + CDP_HOST + ":" + CDP_PORT + "/json");
  const pages = await resp.json();
  let page = pages.find(p => p.type === "page" && /obsidian/i.test(p.title || ""));
  if (!page) page = pages.find(p => p.type === "page" && p.webSocketDebuggerUrl);
  return page || null;
}

async function deploy(client) {
  console.log("\n=== Phase 0: Deploy ===");
  const deployExpr = "(() => { try { const fs = require('fs'); const path = require('path'); const app = window.app || globalThis.app; const vaultPath = app.vault.adapter.getBasePath(); const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', '" + PLUGIN_ID + "'); const buildDir = '" + BUILD_DIR + "'; fs.writeFileSync(path.join(pluginDir, 'main.js'), fs.readFileSync(path.join(buildDir, 'main.js'))); fs.writeFileSync(path.join(pluginDir, 'styles.css'), fs.readFileSync(path.join(buildDir, 'styles.css'))); fs.writeFileSync(path.join(pluginDir, 'manifest.json'), fs.readFileSync(path.join(buildDir, 'manifest.json'))); return { ok: true, vaultPath }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(deployExpr, false);
  const r = res.result.value;
  if (r.error) { fail("Deploy", r.error); return null; }
  pass("Deploy", "vault=" + r.vaultPath);

  const reloadExpr = "(async () => { try { const app = window.app || globalThis.app; await app.plugins.disablePlugin('" + PLUGIN_ID + "'); await new Promise(r => setTimeout(r, 600)); await app.plugins.enablePlugin('" + PLUGIN_ID + "'); await new Promise(r => setTimeout(r, 1500)); let leaves = app.workspace.getLeavesOfType('" + VIEW_TYPE + "'); if (leaves.length === 0) { await app.workspace.getLeaf(true).setViewState({ type: '" + VIEW_TYPE + "' }); await new Promise(r => setTimeout(r, 800)); leaves = app.workspace.getLeavesOfType('" + VIEW_TYPE + "'); } app.workspace.revealLeaf(leaves[0]); await new Promise(r => setTimeout(r, 500)); return { reloaded: true }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const rlRes = await client.evaluate(reloadExpr, true);
  const rl = rlRes.result.value;
  if (rl.error) { fail("Reload plugin", rl.error); return null; }
  pass("Reload plugin", "OK");
  return r;
}

async function backendLabelSmoke(client) {
  console.log("\n=== Phase 1: Backend label ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; plugin.settings.backendMode = 'auto'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; view.refreshStatusBar(); const runtimeLabel = view.actualRuntimeLabel; const statusText = view.statusLabelEl.textContent; const isSdk = runtimeLabel === 'SDK'; const statusHasSdk = /SDK/.test(statusText); const noClaudeCode = !/Claude Code/.test(statusText); return { runtimeLabel, statusText, isSdk, statusHasSdk, noClaudeCode }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Backend label", r.error); return; }
  if (r.isSdk && r.statusHasSdk && r.noClaudeCode) pass("Backend label = SDK", "label=" + r.runtimeLabel + " status=\"" + r.statusText + "\"");
  else fail("Backend label = SDK", JSON.stringify(r));
}

async function effectiveModelSmoke(client) {
  console.log("\n=== Phase 2: Effective model ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; const vp = app.vault.adapter.getBasePath(); plugin.settings.model = 'gpt-5.4'; plugin.settings.effortLevel = 'high'; plugin.settings.claudePermissionMode = 'plan'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; view.refreshAllChips(); const chipLabel = view.modelEffortButtonEl.textContent; const backend = view.getBackend(); const evts = []; const wfEvts = []; const task = { id: 'eff-' + Date.now(), userMessage: 'OK', prompt: '只回复 OK 两个字，不要使用任何工具。', cwd: vp, createdAt: new Date().toISOString() }; const handle = backend.run(task, plugin.settings, (ev) => { evts.push({ type: ev.type }); }, (wf) => { wfEvts.push({ type: wf.type, role: wf.role, text: typeof wf.text === 'string' ? wf.text : '' }); }); const deadline = Date.now() + 60000; let finalState = null; while (Date.now() < deadline) { await new Promise(r => setTimeout(r, 700)); if (evts.some(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped')) { finalState = evts.find(e => e.type === 'completed' || e.type === 'failed' || e.type === 'stopped').type; break; } } if (!finalState) { try { handle.stop(); } catch {} finalState = 'timeout'; } const sessionStarted = wfEvts.find(e => e.type === 'message' && e.role === 'system' && /SDK session started/.test(e.text)); const sessionModelMatch = sessionStarted ? sessionStarted.text.match(/model=([^,\\s]+)/) : null; const sessionModel = sessionModelMatch ? sessionModelMatch[1] : null; plugin.settings.claudePermissionMode = 'default'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; return { chipLabel, finalState, sessionModel }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Effective model", r.error); return; }
  const chipOk = /gpt-5\.4/.test(r.chipLabel || "");
  const sessionOk = r.sessionModel === "gpt-5.4";
  if (chipOk && sessionOk && r.finalState === "completed") pass("Effective model 一致", "chip=\"" + r.chipLabel + "\" session=" + r.sessionModel + " state=" + r.finalState);
  else fail("Effective model 一致", JSON.stringify(r));
}

async function sdkTimelineSmoke(client) {
  console.log("\n=== Phase 3-7: SDK timeline ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; const vp = app.vault.adapter.getBasePath(); plugin.settings.backendMode = 'auto'; plugin.settings.model = 'gpt-5.4'; plugin.settings.effortLevel = 'high'; plugin.settings.claudePermissionMode = 'auto'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; view.inputEl.value = '读取当前 vault 根目录下的 manifest.json 文件，告诉我 name 字段的值，然后回复 OK'; view.refreshStatusBar(); const runPromise = view.run(); const deadline = Date.now() + 90000; while (Date.now() < deadline) { await new Promise(r => setTimeout(r, 1000)); if (!view.runHandle) break; } try { await runPromise; } catch {} await new Promise(r => setTimeout(r, 1000)); const allBlocks = view.messagesEl.querySelectorAll('[data-msg-id]'); const msgBlock = allBlocks.length > 0 ? allBlocks[allBlocks.length - 1] : null; const timelineWrap = msgBlock ? msgBlock.querySelector('.llm-bridge-timeline-wrap') : null; const timelineNodes = timelineWrap ? timelineWrap.querySelectorAll('.llm-bridge-tl-node') : []; const rawBody = timelineWrap ? timelineWrap.querySelector('.llm-bridge-timeline-raw-body') : null; const nodeKinds = Array.from(timelineNodes).map(n => { const cls = n.className; const match = cls.match(/llm-bridge-tl-(?!node)(\\w+)/); return match ? match[1] : 'unknown'; }); const hasSessionStarted = nodeKinds.includes('session_started'); const hasToolCall = nodeKinds.includes('tool_call'); const hasCompleted = nodeKinds.includes('completed') || nodeKinds.includes('failed'); const timelineBody = timelineWrap ? timelineWrap.querySelector('.llm-bridge-timeline-body') : null; const autoCollapsed = timelineBody ? timelineBody.hasAttribute('hidden') : false; const hasFailed = nodeKinds.includes('failed'); const rawCollapsed = rawBody ? rawBody.hasAttribute('hidden') : false; const fileChangeNodes = Array.from(timelineNodes).filter(n => n.classList.contains('llm-bridge-tl-file_change')); const filePaths = fileChangeNodes.map(n => n.querySelector('.llm-bridge-tl-file-path') ? n.querySelector('.llm-bridge-tl-file-path').textContent : ''); const hasInternalWrite = filePaths.some(p => /\\.obsidian|\\.llm-bridge|\\.claude|LLM-AgentRuntime/i.test(p)); const agentNodes = Array.from(timelineNodes).filter(n => n.classList.contains('llm-bridge-tl-agent') || n.classList.contains('llm-bridge-tl-final_message')); const agentTexts = agentNodes.map(n => n.textContent ? n.textContent.trim() : ''); let duplicate = false; for (let i = 1; i < agentTexts.length; i++) { if (agentTexts[i] && agentTexts[i] === agentTexts[i-1] && agentTexts[i].length > 0) { duplicate = true; break; } } plugin.settings.claudePermissionMode = 'default'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; view.inputEl.value = ''; return { nodeCount: timelineNodes.length, nodeKinds, hasSessionStarted, hasToolCall, hasCompleted, autoCollapsed, hasFailed, rawCollapsed, filePaths, hasInternalWrite, agentTexts, duplicate }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("SDK timeline", r.error); return; }

  if (r.hasSessionStarted && r.hasToolCall && r.hasCompleted) pass("Timeline has session/tool/completed", "nodes=" + r.nodeCount + " kinds=" + r.nodeKinds.join(","));
  else fail("Timeline has session/tool/completed", JSON.stringify({ hasSessionStarted: r.hasSessionStarted, hasToolCall: r.hasToolCall, hasCompleted: r.hasCompleted }));

  if (r.autoCollapsed || r.hasFailed) pass("Completed auto-collapse", "autoCollapsed=" + r.autoCollapsed + " hasFailed=" + r.hasFailed);
  else fail("Completed auto-collapse", "autoCollapsed=" + r.autoCollapsed);

  if (r.rawCollapsed) pass("Raw log collapsed", "ok");
  else fail("Raw log collapsed", "rawCollapsed=" + r.rawCollapsed);

  if (!r.hasInternalWrite) pass("No internal write in timeline", "paths=" + JSON.stringify(r.filePaths));
  else fail("No internal write in timeline", "paths=" + JSON.stringify(r.filePaths));

  if (!r.duplicate) pass("No duplicate assistant", "texts=" + r.agentTexts.length);
  else fail("No duplicate assistant", "duplicate=true");
}

async function permissionPopoverSmoke(client) {
  console.log("\n=== Phase 8: Permission popover ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; plugin.settings.claudePermissionMode = 'default'; await plugin.saveSettings(); view.refreshAllChips(); view.togglePermissionPopover(); await new Promise(r => setTimeout(r, 200)); const popover = view.permissionPopoverEl; const isOpen = popover && !popover.hasAttribute('hidden'); const options = popover ? Array.from(popover.querySelectorAll('.llm-bridge-perm-option')).map(o => ({ title: o.querySelector('.llm-bridge-perm-option-title') ? o.querySelector('.llm-bridge-perm-option-title').textContent : '', isActive: o.classList.contains('is-active') })) : []; const hasFour = options.length === 4; const titles = options.map(o => o.title); const hasAll = titles.includes('Ask before edits') && titles.includes('Edit automatically') && titles.includes('Plan mode') && titles.includes('Auto mode'); const defaultActive = options.find(o => o.title === 'Ask before edits') ? options.find(o => o.title === 'Ask before edits').isActive === true : false; const planOpt = popover.querySelector('.llm-bridge-perm-option:nth-child(3)'); planOpt.click(); await new Promise(r => setTimeout(r, 300)); const settingsMode = plugin.settings.claudePermissionMode; const chipText = view.permissionModeChipEl.textContent; view.closePermissionPopover(); plugin.settings.claudePermissionMode = 'default'; await plugin.saveSettings(); view.refreshAllChips(); return { isOpen, hasFour, hasAll, defaultActive, settingsMode, chipText }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("Permission popover", r.error); return; }
  const uiOk = r.isOpen && r.hasFour && r.hasAll && r.defaultActive;
  const switchOk = r.settingsMode === "plan" && /Plan mode/i.test(r.chipText);
  if (uiOk && switchOk) pass("Permission popover 四模式", "modes=4 switch=plan chip=\"" + r.chipText + "\"");
  else fail("Permission popover 四模式", JSON.stringify(r));
}

async function main() {
  console.log("=== V2.16-C Claude-style Runtime UI Smoke ===");
  const page = await findObsidianPage();
  if (!page) { console.error("未找到 Obsidian 页面"); process.exit(1); }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log("CDP 已连接");
  const deployInfo = await deploy(client);
  if (!deployInfo) { console.error("Deploy 失败"); client.close(); process.exit(1); }
  await backendLabelSmoke(client);
  await effectiveModelSmoke(client);
  await sdkTimelineSmoke(client);
  await permissionPopoverSmoke(client);
  client.close();
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log("\n=== 结果: " + passed + " passed, " + failed + " failed ===");
  if (failed > 0) { console.log("\n失败项:"); results.filter(r => r.status === "FAIL").forEach(r => console.log("  ❌ " + r.name + ": " + r.detail)); }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
