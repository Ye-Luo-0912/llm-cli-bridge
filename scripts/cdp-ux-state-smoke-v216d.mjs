#!/usr/bin/env node
// V2.16-D CDP Smoke — UX State Persistence / Context Visualization / Compact Header
// 运行: node scripts/cdp-ux-state-smoke-v216d.mjs
//
// 前置: 已运行 Obsidian 并开启 CDP 远程调试 (端口 9223)
//
// 验证项 (9 项):
//  1. reload 后恢复 last active session (消息 / 会话 id / 运行时 model)
//  2. 新聊天后才新建 session (messages=0 / currentSessionId=null / lastActiveSessionId="")
//  3. topbar 不溢出 (scrollWidth <= clientWidth + 1)
//  4. 长 session title 截断 (scrollWidth > clientWidth / selector 有 title)
//  5. context ring 显示 (ringEl / "Context:" / "estimated" / refresh 更新)
//  6. no compression 状态正确 (无 .llm-bridge-context-compression)
//  7. SDK context metrics 显示 (backendMode=auto)
//  8. CLI context metrics 显示 (backendMode=cli)
//  9. completed timeline 自动折叠 (live body hidden)

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223;
const PLUGIN_ID = "llm-cli-bridge";
const VIEW_TYPE = "llm-cli-bridge-view";
const BUILD_DIR = "D:\\Users\\Ye_Luo\\APP\\Test\\llm-cli-bridge";
// 嵌入 CDP 表达式时使用正斜杠, 避免 JS 字符串反斜杠转义问题 (Node 在 Windows 接受正斜杠)
const BUILD_DIR_FWD = BUILD_DIR.replace(/\\/g, "/");

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
  console.log("\n=== Phase 0: Deploy + reload ===");
  const deployExpr = "(() => { try { const fs = require('fs'); const path = require('path'); const app = window.app || globalThis.app; const vaultPath = app.vault.adapter.getBasePath(); const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', '" + PLUGIN_ID + "'); const buildDir = '" + BUILD_DIR_FWD + "'; fs.writeFileSync(path.join(pluginDir, 'main.js'), fs.readFileSync(path.join(buildDir, 'main.js'))); fs.writeFileSync(path.join(pluginDir, 'styles.css'), fs.readFileSync(path.join(buildDir, 'styles.css'))); fs.writeFileSync(path.join(pluginDir, 'manifest.json'), fs.readFileSync(path.join(buildDir, 'manifest.json'))); return { ok: true, vaultPath }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
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

async function reloadPluginOnly(client) {
  // 仅 disable + enable + 等待 1500ms, 用于 Phase 1 的 reload 验证
  const reloadExpr = "(async () => { try { const app = window.app || globalThis.app; await app.plugins.disablePlugin('" + PLUGIN_ID + "'); await new Promise(r => setTimeout(r, 600)); await app.plugins.enablePlugin('" + PLUGIN_ID + "'); await new Promise(r => setTimeout(r, 1500)); let leaves = app.workspace.getLeavesOfType('" + VIEW_TYPE + "'); if (leaves.length === 0) { await app.workspace.getLeaf(true).setViewState({ type: '" + VIEW_TYPE + "' }); await new Promise(r => setTimeout(r, 800)); leaves = app.workspace.getLeavesOfType('" + VIEW_TYPE + "'); } app.workspace.revealLeaf(leaves[0]); await new Promise(r => setTimeout(r, 500)); return { ok: true }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(reloadExpr, true);
  return res.result.value;
}

async function restoreLastSessionSmoke(client) {
  console.log("\n=== Phase 1: reload 后恢复 last active session ===");
  // Step 1: 设置 keepLastSession + 运行时状态, 跑一个简短任务, 记录 savedId / lastActiveSessionId
  const step1Expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; plugin.settings.keepLastSession = true; plugin.settings.model = 'gpt-5.4'; plugin.settings.effortLevel = 'high'; plugin.settings.claudePermissionMode = 'auto'; plugin.settings.backendMode = 'auto'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; view.refreshStatusBar(); view.inputEl.value = '只回复 OK 两个字，不要使用任何工具。'; const runPromise = view.run(); const deadline = Date.now() + 60000; while (Date.now() < deadline) { await new Promise(r => setTimeout(r, 700)); if (!view.runHandle) break; } try { await runPromise; } catch {} await new Promise(r => setTimeout(r, 500)); const savedId = view.currentSessionId; const lastActiveSessionId = plugin.settings.lastActiveSessionId; return { savedId, lastActiveSessionId, messagesLength: view.messages.length }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res1 = await client.evaluate(step1Expr, true);
  const r1 = res1.result.value;
  if (r1.error) { fail("reload 后恢复 last active session", r1.error); return; }
  const savedId = r1.savedId;
  const lastActiveSessionId = r1.lastActiveSessionId;

  // Step 2: reload 插件
  const rl = await reloadPluginOnly(client);
  if (rl.error) { fail("reload 后恢复 last active session", "reload: " + rl.error); return; }

  // Step 3: 检查恢复后的状态
  const step3Expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; await new Promise(r => setTimeout(r, 500)); return { messagesLength: view.messages.length, currentSessionId: view.currentSessionId, model: plugin.settings.model }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res3 = await client.evaluate(step3Expr, true);
  const r3 = res3.result.value;
  if (r3.error) { fail("reload 后恢复 last active session", r3.error); return; }

  const messagesOk = r3.messagesLength > 0;
  const sessionOk = r3.currentSessionId === savedId;
  const modelOk = r3.model === "gpt-5.4";
  if (messagesOk && sessionOk && modelOk) {
    pass("reload 后恢复 last active session", "messages=" + r3.messagesLength + " sessionId=" + r3.currentSessionId + " lastActive=" + lastActiveSessionId + " model=" + r3.model);
  } else {
    fail("reload 后恢复 last active session", JSON.stringify({ savedId, after: r3, messagesOk, sessionOk, modelOk }));
  }
}

async function newSessionSmoke(client) {
  console.log("\n=== Phase 2: 新聊天后才新建 session ===");
  // 直接调用 doNewSession() 绕过确认弹窗（newSession 在 messages>0 时会弹确认框）
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; if (typeof view.doNewSession === 'function') { view.doNewSession(); } else if (typeof view.newSession === 'function') { view.newSession(); } await new Promise(r => setTimeout(r, 300)); return { messagesLength: view.messages.length, currentSessionId: view.currentSessionId, lastActiveSessionId: plugin.settings.lastActiveSessionId }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("新聊天后才新建 session", r.error); return; }
  const ok = r.messagesLength === 0 && r.currentSessionId === null && r.lastActiveSessionId === "";
  if (ok) pass("新聊天后才新建 session", "messages=" + r.messagesLength + " currentSessionId=" + r.currentSessionId + " lastActive=\"" + r.lastActiveSessionId + "\"");
  else fail("新聊天后才新建 session", JSON.stringify(r));
}

async function topbarOverflowSmoke(client) {
  console.log("\n=== Phase 3: topbar 不溢出 ===");
  const expr = "(() => { try { const app = window.app || globalThis.app; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; const header = view.containerEl.querySelector('.llm-bridge-topbar'); if (!header) return { error: 'topbar not found' }; return { scrollWidth: header.scrollWidth, clientWidth: header.clientWidth }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, false);
  const r = res.result.value;
  if (r.error) { fail("topbar 不溢出", r.error); return; }
  const ok = r.scrollWidth <= r.clientWidth + 1;
  if (ok) pass("topbar 不溢出", "scrollWidth=" + r.scrollWidth + " clientWidth=" + r.clientWidth);
  else fail("topbar 不溢出", JSON.stringify(r));
}

async function longTitleTruncationSmoke(client) {
  console.log("\n=== Phase 4: 长 session title 截断 ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; view.sessionState.title = '这是一个非常长的会话标题用于测试截断功能是否正常工作abcdef1234567890'; if (typeof view.refreshSessionState === 'function') view.refreshSessionState(); else if (typeof view.onSessionStateChange === 'function') view.onSessionStateChange(); await new Promise(r => setTimeout(r, 200)); const titleEl = view.sessionTitleEl; const selector = view.containerEl.querySelector('.llm-bridge-session-selector') || view.containerEl.querySelector('.llm-bridge-session-title') || titleEl; return { scrollWidth: titleEl ? titleEl.scrollWidth : 0, clientWidth: titleEl ? titleEl.clientWidth : 0, selectorTitle: selector ? selector.getAttribute('title') : null }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("长 session title 截断", r.error); return; }
  const truncOk = r.scrollWidth > r.clientWidth;
  const titleAttrOk = r.selectorTitle !== null && r.selectorTitle !== "";
  if (truncOk && titleAttrOk) pass("长 session title 截断", "scrollWidth=" + r.scrollWidth + " clientWidth=" + r.clientWidth + " title=\"" + r.selectorTitle + "\"");
  else fail("长 session title 截断", JSON.stringify({ truncOk, titleAttrOk, ...r }));
}

async function contextRingSmoke(client) {
  console.log("\n=== Phase 5: context ring 显示 ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; const ringExists = !!(view.contextRingEl); const beforeLabel = view.contextLabelEl ? view.contextLabelEl.textContent : ''; await view.refreshContextMetrics(); await new Promise(r => setTimeout(r, 300)); const afterLabel = view.contextLabelEl ? view.contextLabelEl.textContent : ''; const detailText = view.contextDetailEl ? view.contextDetailEl.textContent : ''; const unavailableClass = view.contextRingEl ? view.contextRingEl.classList.contains('is-unavailable') : false; return { ringExists, beforeLabel, afterLabel, detailText, unavailableClass }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("context ring 显示", r.error); return; }
  const hasContext = (r.afterLabel || "").indexOf("Context:") !== -1;
  const hasUnavailable = /unavailable/i.test(r.afterLabel || "");
  const detailHasEstimated = /estimated/i.test(r.detailText || "");
  // V2.16-D: 主显示不能把本地估算当 exact；估算只允许出现在 detail。
  const labelOk = !!(r.afterLabel && r.afterLabel.length > 0);
  if (r.ringExists && hasContext && hasUnavailable && detailHasEstimated && r.unavailableClass && labelOk) pass("context ring 显示", "ring=" + r.ringExists + " label=\"" + r.afterLabel + "\"");
  else fail("context ring 显示", JSON.stringify({ ringExists: r.ringExists, hasContext, hasUnavailable, detailHasEstimated, unavailableClass: r.unavailableClass, labelOk, before: r.beforeLabel, after: r.afterLabel }));
}

async function noCompressionSmoke(client) {
  console.log("\n=== Phase 6: no compression 状态正确 ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; await view.refreshContextMetrics(); await new Promise(r => setTimeout(r, 300)); const detail = view.contextDetailEl; const hasCompression = detail ? !!detail.querySelector('.llm-bridge-context-compression') : false; return { hasCompression, detailExists: !!detail }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("no compression 状态正确", r.error); return; }
  if (!r.hasCompression) pass("no compression 状态正确", "detailExists=" + r.detailExists + " compression=false");
  else fail("no compression 状态正确", JSON.stringify(r));
}

async function sdkContextSmoke(client) {
  console.log("\n=== Phase 7: SDK context metrics 显示 ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; plugin.settings.backendMode = 'auto'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; await view.refreshContextMetrics(); await new Promise(r => setTimeout(r, 300)); const label = view.contextLabelEl ? view.contextLabelEl.textContent : ''; return { label }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("SDK context metrics 显示", r.error); return; }
  const ok = (r.label || "").indexOf("Context:") !== -1;
  if (ok) pass("SDK context metrics 显示", "label=\"" + r.label + "\"");
  else fail("SDK context metrics 显示", JSON.stringify(r));
}

async function cliContextSmoke(client) {
  console.log("\n=== Phase 8: CLI context metrics 显示 ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; plugin.settings.backendMode = 'cli'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; await view.refreshContextMetrics(); await new Promise(r => setTimeout(r, 300)); const label = view.contextLabelEl ? view.contextLabelEl.textContent : ''; plugin.settings.backendMode = 'auto'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; return { label }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("CLI context metrics 显示", r.error); return; }
  const ok = (r.label || "").indexOf("Context:") !== -1;
  if (ok) pass("CLI context metrics 显示", "label=\"" + r.label + "\"");
  else fail("CLI context metrics 显示", JSON.stringify(r));
}

async function completedTimelineCollapseSmoke(client) {
  console.log("\n=== Phase 9: completed timeline 自动折叠 ===");
  // 最终折叠 timeline 在 .llm-bridge-timeline-wrap > .llm-bridge-timeline-body（body hidden）
  // 且 completed 后 live timeline (.llm-bridge-timeline-live) 应被隐藏
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; plugin.settings.claudePermissionMode = 'auto'; plugin.settings.backendMode = 'auto'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; view.inputEl.value = '只回复 OK 两个字，不要使用任何工具。'; const runPromise = view.run(); const deadline = Date.now() + 60000; while (Date.now() < deadline) { await new Promise(r => setTimeout(r, 700)); if (!view.runHandle) break; } try { await runPromise; } catch {} await new Promise(r => setTimeout(r, 800)); const allBlocks = view.messagesEl.querySelectorAll('[data-msg-id]'); const msgBlock = allBlocks.length > 0 ? allBlocks[allBlocks.length - 1] : null; const wrap = msgBlock ? msgBlock.querySelector('.llm-bridge-timeline-wrap') : null; const body = wrap ? wrap.querySelector('.llm-bridge-timeline-body') : null; const bodyHidden = body ? body.hasAttribute('hidden') : false; const liveEl = msgBlock ? msgBlock.querySelector('.llm-bridge-timeline-live') : null; const liveHidden = liveEl ? liveEl.hasAttribute('hidden') : false; plugin.settings.claudePermissionMode = 'default'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; view.inputEl.value = ''; return { wrapFound: !!wrap, bodyFound: !!body, bodyHidden, liveFound: !!liveEl, liveHidden }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) { fail("completed timeline 自动折叠", r.error); return; }
  // 最终 timeline body 折叠 + live 被隐藏 = completed 后仅保留摘要
  if (r.bodyFound && r.bodyHidden && r.liveHidden) pass("completed timeline 自动折叠", "wrap=" + r.wrapFound + " bodyHidden=" + r.bodyHidden + " liveHidden=" + r.liveHidden);
  else fail("completed timeline 自动折叠", JSON.stringify(r));
}

async function restoreSettings(client) {
  console.log("\n=== Cleanup: 恢复 backendMode=auto, claudePermissionMode=default ===");
  const expr = "(async () => { try { const app = window.app || globalThis.app; const plugin = app.plugins.plugins['" + PLUGIN_ID + "']; const view = app.workspace.getLeavesOfType('" + VIEW_TYPE + "')[0].view; plugin.settings.backendMode = 'auto'; plugin.settings.claudePermissionMode = 'default'; await plugin.saveSettings(); view.cachedBackend = null; view.cachedBackendMode = null; if (typeof view.refreshStatusBar === 'function') view.refreshStatusBar(); if (typeof view.refreshAllChips === 'function') view.refreshAllChips(); return { ok: true }; } catch (e) { return { error: String(e && e.message || e) }; } })()";
  const res = await client.evaluate(expr, true);
  const r = res.result.value;
  if (r.error) console.log("  恢复设置失败: " + r.error);
  else console.log("  已恢复 backendMode=auto, claudePermissionMode=default");
}

async function main() {
  console.log("=== V2.16-D UX State / Context / Header Smoke ===");
  const page = await findObsidianPage();
  if (!page) { console.error("未找到 Obsidian 页面 (CDP " + CDP_HOST + ":" + CDP_PORT + ")"); process.exit(1); }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log("CDP 已连接");
  const deployInfo = await deploy(client);
  if (!deployInfo) { console.error("Deploy 失败"); client.close(); process.exit(1); }
  await restoreLastSessionSmoke(client);
  await newSessionSmoke(client);
  await topbarOverflowSmoke(client);
  await longTitleTruncationSmoke(client);
  await contextRingSmoke(client);
  await noCompressionSmoke(client);
  await sdkContextSmoke(client);
  await cliContextSmoke(client);
  await completedTimelineCollapseSmoke(client);
  await restoreSettings(client);
  client.close();
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log("\n=== 结果: " + passed + " passed, " + failed + " failed ===");
  if (failed > 0) { console.log("\n失败项:"); results.filter(r => r.status === "FAIL").forEach(r => console.log("  ❌ " + r.name + ": " + r.detail)); }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
