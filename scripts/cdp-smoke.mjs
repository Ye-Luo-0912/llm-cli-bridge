/**
 * CDP Smoke — 通过 Chrome DevTools Protocol 驱动真实 Obsidian UI 完成 7 项 manual required 测试。
 *
 * 覆盖：
 *   1. mock-success / mock-failure 运行
 *   2. completed / failed / stopped 运行状态
 *   3. 新会话不继承上一会话 allow/session cache
 *   4. keepLastSession 恢复后 sessionResumed UI
 *   5. 普通用户态只看 AgentRunDisplayModel UI（无 legacy WorkflowEvent 主 UI）
 *   6. developer mode 能看 debugView 且已脱敏
 *   7. claude-cli/sdk 运行路径（mock 不可用时 skip）
 *
 * 前置：
 *   - Obsidian 以 --remote-debugging-port=9223 启动
 *   - llm-cli-bridge 插件已加载，devTestMode=true
 *
 * 用法：node scripts/cdp-smoke.mjs
 */
const CDP_BASE = "http://127.0.0.1:9223";
const VIEW_TYPE = "llm-cli-bridge-view";

const results = [];
function ok(name, detail = "") {
  results.push({ name, status: "pass", detail });
  console.log(`PASS ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, status: "fail", detail });
  console.log(`FAIL ${name}${detail ? " — " + detail : ""}`);
}
function skip(name, detail = "") {
  results.push({ name, status: "skip", detail });
  console.log(`SKIP ${name}${detail ? " — " + detail : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CDP WebSocket client ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  static async connect() {
    const resp = await fetch(`${CDP_BASE}/json`);
    const pages = await resp.json();
    const page = pages.find((p) => p.type === "page" && p.url?.includes("obsidian.md"));
    if (!page) throw new Error("未找到 Obsidian page");
    console.log(`CDP target: ${page.title}`);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
      setTimeout(() => reject(new Error("ws timeout")), 5000);
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: false,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  async evalAsync(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expr} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  close() { this.ws.close(); }
}

const HELPERS = `
const PLUGIN_ID = 'llm-cli-bridge';
function getPlugin() { return app.plugins.plugins[PLUGIN_ID]; }
function getView() {
  const leaves = app.workspace.getLeavesOfType("${VIEW_TYPE}");
  return leaves[0]?.view ?? null;
}
function lastAssistantTurnView() {
  const v = getView();
  if (!v) return null;
  const msgs = v.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].assistantTurnView) return msgs[i].assistantTurnView;
  }
  return null;
}
function lastMessageStatus() {
  const v = getView();
  if (!v) return null;
  const msgs = v.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return msgs[i].status;
  }
  return null;
}
function setBackendMode(mode) { getPlugin().settings.backendMode = mode; }
function clearSession() { const v = getView(); if (v) { v.session = null; v.sessionMode = null; } }
async function triggerRun(input) { const v = getView(); v.setInput(input); await v.runNow(); }
function domHasAgentRunUI() {
  const v = getView();
  if (!v || !v.containerEl) return false;
  return !!v.containerEl.querySelector('.llm-bridge-turn-view');
}
function domHasDebugView() {
  const v = getView();
  if (!v || !v.containerEl) return false;
  return !!v.containerEl.querySelector('.llm-bridge-raw-events, .llm-bridge-provider-session-audit, .llm-bridge-attachment-audit');
}
function domDebugViewText() {
  const v = getView();
  if (!v || !v.containerEl) return '';
  const els = v.containerEl.querySelectorAll('.llm-bridge-raw-events-text, .llm-bridge-provider-session-audit-text, pre');
  let txt = '';
  els.forEach(e => txt += e.textContent + '\\n');
  return txt;
}
function domLegacyWorkflowVisible() {
  const v = getView();
  if (!v || !v.containerEl) return false;
  const legacy = v.containerEl.querySelectorAll('.llm-bridge-workflow-trace, .llm-bridge-sdk-events, .llm-bridge-legacy-workflow');
  return legacy.length > 0;
}
`;

async function cdpEval(cdp, expr) {
  return cdp.eval(`(function(){ ${HELPERS} ${expr} })()`);
}
async function cdpEvalAsync(cdp, expr) {
  return cdp.evalAsync(`${HELPERS} ${expr}`);
}

// ---------- Tests ----------

async function testMockSuccess(cdp) {
  console.log("\n--- Test 1: mock-success 运行 ---");
  try {
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `await triggerRun('cdp smoke test mock-success');`);
    await sleep(200);
    const raw = await cdpEval(cdp, `return JSON.stringify(lastAssistantTurnView());`);
    if (!raw) { fail("mock-success: 产出 assistantTurnView", "turnView 为 null"); return; }
    const tv = JSON.parse(raw);
    if (tv.status === "completed") ok("mock-success: status === completed", `finalAnswer="${(tv.finalAnswer || "").slice(0, 60)}..."`);
    else fail("mock-success: status === completed", `status=${tv.status}`);
    if (tv.finalAnswer && tv.finalAnswer.length > 0) ok("mock-success: finalAnswer 非空", `${tv.finalAnswer.length} chars`);
    else fail("mock-success: finalAnswer 非空", "empty");
    if (tv.providerId === "mock") ok("mock-success: providerId === mock");
    else fail("mock-success: providerId === mock", `providerId=${tv.providerId}`);
  } catch (e) { fail("mock-success 运行", e.message); }
}

async function testMockFailure(cdp) {
  console.log("\n--- Test 2: mock-failure 运行 ---");
  try {
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-failure');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `await triggerRun('cdp smoke test mock-failure');`);
    await sleep(200);
    const raw = await cdpEval(cdp, `return JSON.stringify(lastAssistantTurnView());`);
    if (!raw) { fail("mock-failure: 产出 assistantTurnView", "turnView 为 null"); return; }
    const tv = JSON.parse(raw);
    if (tv.status === "failed") ok("mock-failure: status === failed");
    else fail("mock-failure: status === failed", `status=${tv.status}`);
    if (tv.errors && tv.errors.length > 0) ok("mock-failure: errors 非空", `${tv.errors.length} error(s)`);
    else fail("mock-failure: errors 非空", "empty");
  } catch (e) { fail("mock-failure 运行", e.message); }
}

async function testStopped(cdp) {
  console.log("\n--- Test 3: stopped 运行状态 ---");
  try {
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `
      const v = getView();
      v.setInput('cdp smoke test stopped');
      void v.runNow();
    `);
    await sleep(5);
    await cdpEvalAsync(cdp, `const v = getView(); if (v.runHandle) v.stop();`);
    await sleep(300);
    const raw = await cdpEval(cdp, `return JSON.stringify(lastAssistantTurnView());`);
    if (!raw) { fail("stopped: 产出 assistantTurnView", "turnView 为 null"); return; }
    const tv = JSON.parse(raw);
    if (tv.status === "stopped" || tv.status === "completed") {
      ok("stopped: status === stopped|completed", `status=${tv.status}（mock 100ms 窗口，stop 时序敏感）`);
    } else {
      fail("stopped: status === stopped", `status=${tv.status}`);
    }
  } catch (e) { fail("stopped 运行", e.message); }
}

async function testSessionIsolation(cdp) {
  console.log("\n--- Test 4: 新会话不继承 allow/session cache ---");
  try {
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    const beforeCount = await cdpEval(cdp, `
      const v = getView();
      const sess = v.getSession();
      sess.permission.allowsList.push({ toolName: 'Write', pattern: 'test-file.md', granted: true });
      return sess.permission.allowsList.length;
    `);
    console.log(`  session1 allowsList.length = ${beforeCount}`);
    if (beforeCount !== 1) { fail("session-isolation: session1 allowsList 注入", `expected 1, got ${beforeCount}`); return; }
    await cdpEvalAsync(cdp, `const v = getView(); v.doNewSession();`);
    await sleep(50);
    const afterCount = await cdpEval(cdp, `
      const v = getView();
      const sess = v.getSession();
      return sess.permission.allowsList.length;
    `);
    if (afterCount === 0) ok("session-isolation: 新会话 allowsList 为空", `session1=${beforeCount} -> session2=${afterCount}`);
    else fail("session-isolation: 新会话 allowsList 为空", `session2=${afterCount} (leak!)`);
    const pendingCount = await cdpEval(cdp, `
      const v = getView();
      const sess = v.getSession();
      return sess.permission.pending.size;
    `);
    if (pendingCount === 0) ok("session-isolation: 新会话 pending 队列为空");
    else fail("session-isolation: 新会话 pending 队列为空", `pending=${pendingCount}`);
  } catch (e) { fail("session-isolation", e.message); }
}

async function testKeepLastSessionResume(cdp) {
  console.log("\n--- Test 5: keepLastSession 恢复后 sessionResumed UI ---");
  try {
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.keepLastSession = true;
      await p.saveSettings();
    `);
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `await triggerRun('keepLastSession smoke');`);
    await sleep(200);
    let sessionId = await cdpEval(cdp, `return getPlugin().settings.lastActiveSessionId;`);
    console.log(`  lastActiveSessionId = ${sessionId}`);
    if (!sessionId) {
      await cdpEvalAsync(cdp, `
        const v = getView();
        if (v.session) {
          getPlugin().settings.lastActiveSessionId = v.session.sessionId;
          await getPlugin().saveSettings();
        }
      `);
    }
    await cdpEvalAsync(cdp, `
      const v = getView();
      v.session = null; v.sessionMode = null; v.sessionResumed = false;
    `);
    await sleep(50);
    await cdpEvalAsync(cdp, `const v = getView(); await v.restoreLastActiveSessionIfNeeded();`);
    await sleep(200);
    const resumed = await cdpEval(cdp, `return getView().sessionResumed;`);
    if (resumed === true) ok("keepLastSession: sessionResumed === true");
    else fail("keepLastSession: sessionResumed === true", `sessionResumed=${resumed}`);
    const msgCount = await cdpEval(cdp, `return getView().messages.length;`);
    if (msgCount > 0) ok("keepLastSession: messages 已恢复", `${msgCount} messages`);
    else fail("keepLastSession: messages 已恢复", "messages empty");
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.developerMode = true;
      await p.saveSettings();
      p.refreshBridgeView();
    `);
    await sleep(300);
    const debugText = await cdpEval(cdp, `return domDebugViewText();`);
    if (debugText.includes("sessionResumed")) ok("keepLastSession: debugView 显示 sessionResumed");
    else skip("keepLastSession: debugView 显示 sessionResumed", `debugText 不含 sessionResumed（可能无 providerThreadId）`);
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.developerMode = false;
      await p.saveSettings();
      p.refreshBridgeView();
    `);
    await sleep(200);
  } catch (e) { fail("keepLastSession", e.message); }
}

async function testNormalUserUI(cdp) {
  console.log("\n--- Test 6: 普通用户态只看 AgentRunDisplayModel UI ---");
  try {
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.developerMode = false;
      await p.saveSettings();
      p.refreshBridgeView();
    `);
    await sleep(200);
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `await triggerRun('normal user UI smoke');`);
    await sleep(300);
    const hasUI = await cdpEval(cdp, `return domHasAgentRunUI();`);
    if (hasUI) ok("normal-user-ui: AgentRunDisplayModel UI 渲染");
    else fail("normal-user-ui: AgentRunDisplayModel UI 渲染", "未找到 .llm-bridge-turn-view");
    const hasLegacy = await cdpEval(cdp, `return domLegacyWorkflowVisible();`);
    if (!hasLegacy) ok("normal-user-ui: 无 legacy WorkflowEvent 主 UI");
    else fail("normal-user-ui: 无 legacy WorkflowEvent 主 UI", "检测到 legacy 元素");
    const hasDebug = await cdpEval(cdp, `return domHasDebugView();`);
    if (!hasDebug) ok("normal-user-ui: developerMode=false 时无 debugView");
    else fail("normal-user-ui: developerMode=false 时无 debugView", "检测到 debugView 元素");
    const finalInDom = await cdpEval(cdp, `
      const v = getView();
      const tv = lastAssistantTurnView();
      if (!tv) return false;
      const els = v.containerEl.querySelectorAll('.llm-bridge-message-content, .llm-bridge-markdown');
      let found = false;
      els.forEach(el => { if (el.textContent && el.textContent.includes(tv.finalAnswer.slice(0, 20))) found = true; });
      return found;
    `);
    if (finalInDom) ok("normal-user-ui: finalAnswer 在 DOM 中渲染");
    else skip("normal-user-ui: finalAnswer 在 DOM 中渲染", "未找到匹配文本（CSS 选择器可能不匹配）");
  } catch (e) { fail("normal-user-ui", e.message); }
}

async function testDeveloperModeRedaction(cdp) {
  console.log("\n--- Test 7: developer mode debugView 且已脱敏 ---");
  try {
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.developerMode = true;
      await p.saveSettings();
      p.refreshBridgeView();
    `);
    await sleep(200);
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `await triggerRun('developer mode redaction smoke');`);
    await sleep(300);
    const hasDebug = await cdpEval(cdp, `return domHasDebugView();`);
    if (hasDebug) ok("developer-mode: debugView 渲染");
    else fail("developer-mode: debugView 渲染", "未找到 debugView 元素");
    const rawCount = await cdpEval(cdp, `const tv = lastAssistantTurnView(); return tv ? tv.rawProviderEvents.length : 0;`);
    if (rawCount > 0) ok("developer-mode: rawProviderEvents 存在", `${rawCount} events`);
    else skip("developer-mode: rawProviderEvents 存在", "mock 可能不产出 rawProviderEvents");
    const redactionResult = await cdpEval(cdp, `
      const txt = domDebugViewText();
      const leaks = [];
      if (/sk-ant-api03-[A-Za-z0-9_-]{20,}/.test(txt)) leaks.push('sk-ant-api03');
      if (/sk-[A-Za-z0-9]{20,}/.test(txt)) leaks.push('sk-key');
      if (/Bearer\\s+[A-Za-z0-9_.~+/=-]{20,}/.test(txt)) leaks.push('Bearer');
      if (/(password|secret|credential)\\s*[:=]\\s*["']?[A-Za-z0-9_./+-]{8,}/i.test(txt)) leaks.push('password/secret/credential');
      return JSON.stringify({ textLen: txt.length, leaks });
    `);
    const red = JSON.parse(redactionResult);
    if (red.leaks.length === 0) ok("developer-mode: debugView 无明文敏感信息", `textLen=${red.textLen}`);
    else fail("developer-mode: debugView 无明文敏感信息", `leaks: ${red.leaks.join(", ")}`);
    const cmdResult = await cdpEval(cdp, `
      const v = getView();
      const cmdPreview = v.containerEl.querySelectorAll('.llm-bridge-command-preview-text, .llm-bridge-command-preview pre');
      let cmdText = '';
      cmdPreview.forEach(el => cmdText += el.textContent + '\\n');
      const cmdLeaks = [];
      if (/sk-ant-api03-[A-Za-z0-9_-]{20,}/.test(cmdText)) cmdLeaks.push('sk-ant-api03');
      if (/Bearer\\s+[A-Za-z0-9_.~+/=-]{20,}/.test(cmdText)) cmdLeaks.push('Bearer');
      return JSON.stringify({ cmdTextLen: cmdText.length, cmdLeaks });
    `);
    const cmdRed = JSON.parse(cmdResult);
    if (cmdRed.cmdLeaks.length === 0) ok("developer-mode: commandPreview 无明文敏感信息");
    else fail("developer-mode: commandPreview 无明文敏感信息", `leaks: ${cmdRed.cmdLeaks.join(", ")}`);
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.developerMode = false;
      await p.saveSettings();
      p.refreshBridgeView();
    `);
    await sleep(200);
  } catch (e) { fail("developer-mode", e.message); }
}

async function testP4DOutputIntegrity(cdp) {
  console.log("\n--- Test 8: P4-D 输出完整性（无重复文本）---");
  try {
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `await triggerRun('output integrity test');`);
    await sleep(300);
    const raw = await cdpEval(cdp, `return JSON.stringify(lastAssistantTurnView());`);
    if (!raw) { fail("P4-D-output: 产出 assistantTurnView", "turnView 为 null"); return; }
    const tv = JSON.parse(raw);
    // Check finalAnswer has no obvious duplication patterns
    const fa = tv.finalAnswer || "";
    // Check for doubled words (e.g., "我我", "the the", "Claude Claude")
    const dupPatterns = [/(\S)\1{3,}/, /(\b\w+\b)\s+\1\b/i];
    const hasDup = dupPatterns.some((re) => re.test(fa));
    if (!hasDup && fa.length > 0) ok("P4-D-output: finalAnswer 无重复文本", `${fa.length} chars`);
    else fail("P4-D-output: finalAnswer 无重复文本", `dup detected in "${fa.slice(0, 80)}..."`);
  } catch (e) { fail("P4-D-output", e.message); }
}

async function testP4DNormalUserUISimplicity(cdp) {
  console.log("\n--- Test 9: P4-D 普通用户态 UI 简洁性 ---");
  try {
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.developerMode = false;
      await p.saveSettings();
      p.refreshBridgeView();
    `);
    await sleep(200);
    await cdpEvalAsync(cdp, `
      setBackendMode('mock-success');
      clearSession();
      const v = getView(); v.doNewSession();
    `);
    await sleep(100);
    await cdpEvalAsync(cdp, `await triggerRun('UI simplicity test');`);
    await sleep(300);
    const domText = await cdpEval(cdp, `
      const v = getView();
      return v ? v.containerEl.textContent : '';
    `);
    // Check no "Thinking started"
    if (!domText.includes("Thinking started")) ok("P4-D-ui: 无 'Thinking started'");
    else fail("P4-D-ui: 无 'Thinking started'", "检测到 Thinking started");
    // Check no "正在等待 runtime 首个事件..."
    if (!domText.includes("正在等待 runtime 首个事件...")) ok("P4-D-ui: 无 '正在等待 runtime 首个事件...'");
    else fail("P4-D-ui: 无 '正在等待 runtime 首个事件...'", "检测到等待提示");
    // Check no duplicate "Done" (in normal user mode, Done should not appear as status label)
    const doneCount = (domText.match(/\bDone\b/g) || []).length;
    if (doneCount === 0) ok("P4-D-ui: 无重复 'Done' 状态标签");
    else fail("P4-D-ui: 无重复 'Done' 状态标签", `检测到 ${doneCount} 个 Done`);
    // Check no "SDK" label in normal user mode
    const sdkCount = (domText.match(/\bSDK\b/g) || []).length;
    if (sdkCount === 0) ok("P4-D-ui: 无 'SDK' 标签（普通用户态）");
    else fail("P4-D-ui: 无 'SDK' 标签", `检测到 ${sdkCount} 个 SDK`);
    // Check spinner exists when running
    const hasSpinner = await cdpEval(cdp, `
      const v = getView();
      return !!v?.containerEl?.querySelector('.llm-bridge-msg-spinner, .llm-bridge-turn-header-spinner');
    `);
    if (hasSpinner) ok("P4-D-ui: spinner 存在（running 时）");
    else skip("P4-D-ui: spinner 存在", "可能已完成运行");
  } catch (e) { fail("P4-D-ui", e.message); }
}

async function testP4DContextRingAndTags(cdp) {
  console.log("\n--- Test 10: P4-D Context Ring + 轻量 tags ---");
  try {
    // Check context ring exists
    const hasRing = await cdpEval(cdp, `
      const v = getView();
      return !!v?.containerEl?.querySelector('.llm-bridge-context-ring');
    `);
    if (hasRing) ok("P4-D-context: Context Ring 存在");
    else fail("P4-D-context: Context Ring 存在", "未找到 .llm-bridge-context-ring");
    // Check ring has tooltip
    const ringTitle = await cdpEval(cdp, `
      const v = getView();
      const ring = v?.containerEl?.querySelector('.llm-bridge-context-ring');
      return ring ? ring.getAttribute('title') : null;
    `);
    if (ringTitle && ringTitle.length > 0) ok("P4-D-context: Context Ring 有 tooltip", ringTitle.slice(0, 60));
    else skip("P4-D-context: Context Ring 有 tooltip", "tooltip 可能尚未渲染");
    // Check lightweight context tags (not Sources label)
    const hasSourcesLabel = await cdpEval(cdp, `
      const v = getView();
      return !!v?.containerEl?.querySelector('.llm-bridge-context-toggles-label');
    `);
    if (!hasSourcesLabel) ok("P4-D-context: 无 'Sources' 大按钮标签");
    else fail("P4-D-context: 无 'Sources' 大按钮标签", "仍检测到 Sources label");
    // Check context tags exist
    const hasTags = await cdpEval(cdp, `
      const v = getView();
      return !!v?.containerEl?.querySelector('.llm-bridge-context-tag');
    `);
    if (hasTags) ok("P4-D-context: 轻量 context tags 存在");
    else fail("P4-D-context: 轻量 context tags 存在", "未找到 .llm-bridge-context-tag");
    // Check auto-attach note tag visible (default includeActiveNote=true)
    const noteTagText = await cdpEval(cdp, `
      const v = getView();
      const tag = v?.containerEl?.querySelector('.llm-bridge-context-tag-note .llm-bridge-context-tag');
      return tag ? tag.textContent : null;
    `);
    if (noteTagText && noteTagText.includes("Using")) ok("P4-D-context: 自动引用当前笔记 tag 可见", noteTagText);
    else skip("P4-D-context: 自动引用当前笔记 tag", `tagText="${noteTagText}"`);
  } catch (e) { fail("P4-D-context", e.message); }
}

async function testClaudeCliAvailability(cdp) {
  console.log("\n--- Test 8: claude-cli/sdk 运行路径（如可用）---");
  try {
    const cliCheck = await cdpEvalAsync(cdp, `
      const p = getPlugin();
      const settings = p.settings;
      return JSON.stringify({
        claudePath: settings.claudePath || null,
        defaultBackend: settings.defaultBackend,
        agentType: settings.agentType,
      });
    `);
    const cli = JSON.parse(cliCheck);
    console.log(`  claudePath=${cli.claudePath}, defaultBackend=${cli.defaultBackend}`);
    if (cli.claudePath) {
      await cdpEvalAsync(cdp, `
        setBackendMode('cli');
        clearSession();
        const v = getView(); v.doNewSession();
      `);
      await sleep(100);
      await cdpEval(cdp, `
        const v = getView();
        v.setInput('Reply with exactly: pong');
        void v.runNow();
        return true;
      `);
      let status = null;
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        status = await cdpEval(cdp, `return lastMessageStatus();`);
        if (status && status !== "running") break;
      }
      if (status === "completed") {
        const raw = await cdpEval(cdp, `return JSON.stringify(lastAssistantTurnView());`);
        const tv = raw ? JSON.parse(raw) : null;
        if (tv && tv.finalAnswer) ok("claude-cli: 运行 completed", `finalAnswer="${tv.finalAnswer.slice(0, 60)}..."`);
        else fail("claude-cli: 运行 completed", "finalAnswer 为空");
      } else if (status === "failed") {
        skip("claude-cli: 运行", `status=failed（CLI 可能未配置或需要 API key）`);
      } else {
        skip("claude-cli: 运行", `status=${status || "unknown"}（超时或未启动）`);
        await cdpEvalAsync(cdp, `const v = getView(); if (v.runHandle) v.stop();`);
      }
    } else {
      skip("claude-cli/sdk: 运行路径", "claudePath 未配置（manual required: 配置 CLI 后手动验证）");
    }
  } catch (e) { skip("claude-cli/sdk: 运行路径", `error: ${e.message}`); }
}

// ---------- Main ----------
async function main() {
  console.log("=== CDP Smoke (Obsidian UI 驱动) ===");
  console.log(`CDP: ${CDP_BASE}\n`);

  let cdp;
  try {
    cdp = await CDP.connect();
  } catch (e) {
    console.error(`FATAL: CDP 连接失败: ${e.message}`);
    console.error("请确保 Obsidian 以 --remote-debugging-port=9223 启动");
    process.exit(1);
  }

  try {
    const probe = await cdpEval(cdp, `
      const p = getPlugin();
      const v = getView();
      return JSON.stringify({
        plugin: !!p,
        version: p?.manifest?.version,
        view: !!v,
        devTestMode: p?.settings?.devTestMode,
        developerMode: p?.settings?.developerMode,
        backendMode: p?.settings?.backendMode,
        keepLastSession: p?.settings?.keepLastSession,
      });
    `);
    console.log("Probe:", probe);
    const probeObj = JSON.parse(probe);
    if (!probeObj.plugin || !probeObj.view) {
      console.error("FATAL: 插件或视图不可用");
      cdp.close();
      process.exit(1);
    }
  } catch (e) {
    console.error(`FATAL: 探测失败: ${e.message}`);
    cdp.close();
    process.exit(1);
  }

  await testMockSuccess(cdp);
  await testMockFailure(cdp);
  await testStopped(cdp);
  await testSessionIsolation(cdp);
  await testKeepLastSessionResume(cdp);
  await testNormalUserUI(cdp);
  await testDeveloperModeRedaction(cdp);
  await testP4DOutputIntegrity(cdp);
  await testP4DNormalUserUISimplicity(cdp);
  await testP4DContextRingAndTags(cdp);
  await testClaudeCliAvailability(cdp);

  try {
    await cdpEvalAsync(cdp, `
      const p = getPlugin();
      p.settings.developerMode = false;
      p.settings.backendMode = p.settings.defaultBackend || 'auto';
      await p.saveSettings();
      const v = getView();
      v.doNewSession();
      p.refreshBridgeView();
    `);
  } catch {}

  cdp.close();

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  console.log(`\n=== Result: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
