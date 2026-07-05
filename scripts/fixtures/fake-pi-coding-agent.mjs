// LLM CLI Bridge — Fake @earendil-works/pi-coding-agent fixture (V17-D 任务 D)
//
// 用途：在测试中真实执行 PiSdkProvider.run()，断言 createAgentSession 收到的 options。
// 不依赖真实 SDK，不发起网络请求。
//
// 用法（测试中）：
//   1. 设置 PI_SDK_FAKE_CAPTURE 数组
//   2. import 此 fixture（覆盖 @earendil-works/pi-coding-agent）
//   3. 构造 PiSdkProvider 注入 fake probe
//   4. run() 后检查 PI_SDK_FAKE_CAPTURE[0].sessionOpts

const capture = {
  createAgentSessionCalls: [], // [{ sessionOpts, }]
  promptCalls: [], // [{ text, options }]
  abortCalls: 0,
  subscribeListeners: [],
  setRuntimeApiKeyCalls: [], // V17-D 任务 F：[{ provider, key }]
  registerProviderCalls: [], // V17-D 任务 F：[{ provider, opts }]
};

// V17-D 任务 D：slowMode 让 cancel 测试有时间在 prompt 进行中触发 abort
let slowMode = false;

export function resetFakeCapture() {
  capture.createAgentSessionCalls = [];
  capture.promptCalls = [];
  capture.abortCalls = 0;
  capture.subscribeListeners = [];
  capture.setRuntimeApiKeyCalls = [];
  capture.registerProviderCalls = [];
  slowMode = false;
}

export function getFakeCapture() {
  return capture;
}

export function setFakeSlowMode(enabled) {
  slowMode = !!enabled;
}

// fake AgentSession
class FakeAgentSession {
  constructor() {
    this.sessionId = "fake-session-" + Math.random().toString(36).slice(2, 8);
    this.isStreaming = false;
    this._listener = null;
  }
  async prompt(text, options) {
    capture.promptCalls.push({ text, options });
    // 模拟发 text_delta + agent_end；slowMode 时在两者之间留窗口给 cancel
    if (this._listener) {
      this._listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "fake response" } });
      if (slowMode) {
        await new Promise((r) => setTimeout(r, 50));
      }
      this._listener({ type: "agent_end" });
    }
  }
  subscribe(listener) {
    this._listener = listener;
    capture.subscribeListeners.push(listener);
    return () => { this._listener = null; };
  }
  async abort() {
    capture.abortCalls++;
  }
  dispose() { /* mock */ }
}

// fake createAgentSession：捕获 options + 返回 fake session
export async function createAgentSession(sessionOpts) {
  capture.createAgentSessionCalls.push({ sessionOpts: { ...sessionOpts } });
  return { session: new FakeAgentSession() };
}

// fake AuthStorage / ModelRegistry / SessionManager / SettingsManager
export const AuthStorage = {
  create() {
    return {
      hasConfiguredAuth() { return true; },
      setRuntimeApiKey(provider, key) { capture.setRuntimeApiKeyCalls.push({ provider, key }); },
      getRuntimeApiKey(_p) { return "fake-key"; },
    };
  },
};

export const ModelRegistry = {
  create(_authStorage) {
    return {
      getAvailable() {
        return [{ id: "fake-model", provider: "anthropic" }];
      },
      find(_p, _id) { return { id: "fake-model", provider: "anthropic" }; },
      list() { return [{ id: "fake-model", provider: "anthropic" }]; },
      registerProvider(provider, opts) { capture.registerProviderCalls.push({ provider, opts: { ...opts } }); },
    };
  },
};

export const SessionManager = {
  inMemory() { return { _fake: true }; },
  create(_cwd) { return { _fake: true }; },
};

export const SettingsManager = {
  inMemory(_overrides) { return { _fake: true }; },
};

export function defineTool(definition) {
  return { ...definition, _fakeDefined: true };
}

export const DefaultResourceLoader = class {
  constructor(_opts) {}
  async reload() { /* mock */ }
};
