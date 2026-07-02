// LLM CLI Bridge — Codex app-server session mapper (V2.17-A Completion)
//
// 维护 BridgeSession.sessionId ↔ codex threadId/sessionId 的双向映射。
//
// Codex app-server 协议中：
// - threadId：一次会话线程（turn 序列），turn/start 必须携带
// - sessionId：服务端可能额外给出的会话 id（resume 时用）
//
// Bridge Core 的 BridgeSession.sessionId 是插件侧生成的不透明 id（如 "sess-..."），
// 与 codex threadId 解耦。本 mapper 维护两者映射，供 provider resume 时构造
// turn/start 的 threadId 参数。
//
// 当前为 skeleton：仅维护内存映射。后续可持久化到 .llm-bridge/state 以跨会话 resume。

/**
 * Codex app-server 会话映射器。
 */
export class CodexAppServerSessionMapper {
  private readonly bridgeToCodex = new Map<string, { threadId: string; sessionId?: string }>();
  private readonly codexToBridge = new Map<string, string>();

  /**
   * 注册一次会话映射。
   */
  register(bridgeSessionId: string, codexThreadId: string, codexSessionId?: string): void {
    this.bridgeToCodex.set(bridgeSessionId, { threadId: codexThreadId, sessionId: codexSessionId });
    this.codexToBridge.set(codexThreadId, bridgeSessionId);
    if (codexSessionId && codexSessionId !== codexThreadId) {
      this.codexToBridge.set(codexSessionId, bridgeSessionId);
    }
  }

  /**
   * 按 bridgeSessionId 取 codex threadId（turn/start threadId 用）。
   */
  getCodexThread(bridgeSessionId: string): string | undefined {
    return this.bridgeToCodex.get(bridgeSessionId)?.threadId;
  }

  /**
   * 按 bridgeSessionId 取 codex sessionId（resume thread/start 时用）。
   */
  getCodexSession(bridgeSessionId: string): string | undefined {
    return this.bridgeToCodex.get(bridgeSessionId)?.sessionId;
  }

  /**
   * 按 codex threadId 取 bridgeSessionId（事件路由用）。
   */
  getBridgeSession(codexThreadId: string): string | undefined {
    return this.codexToBridge.get(codexThreadId);
  }

  /**
   * 注销一次会话映射。
   */
  unregister(bridgeSessionId: string): void {
    const codex = this.bridgeToCodex.get(bridgeSessionId);
    if (!codex) return;
    this.bridgeToCodex.delete(bridgeSessionId);
    this.codexToBridge.delete(codex.threadId);
    if (codex.sessionId && codex.sessionId !== codex.threadId) {
      this.codexToBridge.delete(codex.sessionId);
    }
  }

  /**
   * 清空所有映射（会话切换/重置时用）。
   */
  clear(): void {
    this.bridgeToCodex.clear();
    this.codexToBridge.clear();
  }
}
