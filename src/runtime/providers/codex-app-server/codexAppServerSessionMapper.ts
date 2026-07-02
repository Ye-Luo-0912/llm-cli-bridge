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
// thread/resume 的 threadId 参数。
//
// V2.17-A Completion 主线闭环：
// - thread/start 用于新 thread（不再塞 resumeSessionId）
// - thread/resume 用于恢复已有 threadId
// - BridgeSession 保存 providerThreadId / providerSessionId
// - keepLastSession 恢复时 provider thread/session 同步恢复
//
// 当前为 skeleton：仅维护内存映射。后续可持久化到 .llm-bridge/state 以跨会话 resume。

/**
 * Codex app-server 会话映射条目。
 */
export interface CodexSessionMapping {
  /** codex thread id（turn/start threadId 用） */
  threadId: string;
  /** codex session id（resume 时用，可能与 threadId 相同） */
  sessionId?: string;
  /** 最近一次 turn 终态的 turnId（审计/UI 同步用） */
  lastTurnId?: string;
}

/**
 * Codex app-server 会话映射器。
 *
 * 维护 BridgeSession.sessionId ↔ codex threadId/sessionId 的双向映射，
 * 并支持 keepLastSession 恢复时同步 provider thread/session。
 */
export class CodexAppServerSessionMapper {
  private readonly bridgeToCodex = new Map<string, CodexSessionMapping>();
  private readonly codexToBridge = new Map<string, string>();

  /**
   * 注册一次会话映射（thread/start 成功后调用）。
   */
  register(bridgeSessionId: string, codexThreadId: string, codexSessionId?: string): void {
    this.bridgeToCodex.set(bridgeSessionId, { threadId: codexThreadId, sessionId: codexSessionId });
    this.codexToBridge.set(codexThreadId, bridgeSessionId);
    if (codexSessionId && codexSessionId !== codexThreadId) {
      this.codexToBridge.set(codexSessionId, bridgeSessionId);
    }
  }

  /**
   * 更新已有映射的 lastTurnId（turn 终态后调用）。
   *
   * 若 bridgeSessionId 未注册，忽略。
   */
  updateLastTurn(bridgeSessionId: string, turnId: string): void {
    const existing = this.bridgeToCodex.get(bridgeSessionId);
    if (!existing) return;
    this.bridgeToCodex.set(bridgeSessionId, { ...existing, lastTurnId: turnId });
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
   * 按 bridgeSessionId 取完整映射条目（含 lastTurnId）。
   */
  getMapping(bridgeSessionId: string): CodexSessionMapping | undefined {
    return this.bridgeToCodex.get(bridgeSessionId);
  }

  /**
   * 取 providerThreadId（与 getCodexThread 等价，命名对齐 task spec）。
   */
  getProviderThreadId(bridgeSessionId: string): string | undefined {
    return this.getCodexThread(bridgeSessionId);
  }

  /**
   * 取 providerSessionId（与 getCodexSession 等价，命名对齐 task spec）。
   */
  getProviderSessionId(bridgeSessionId: string): string | undefined {
    return this.getCodexSession(bridgeSessionId);
  }

  /**
   * 按 codex threadId 取 bridgeSessionId（事件路由用）。
   */
  getBridgeSession(codexThreadId: string): string | undefined {
    return this.codexToBridge.get(codexThreadId);
  }

  /**
   * 判断 bridgeSessionId 是否已有 codex thread 映射（resume 决策用）。
   *
   * 有映射 → thread/resume 路径；无映射 → thread/start 路径。
   */
  hasCodexThread(bridgeSessionId: string): boolean {
    return this.bridgeToCodex.has(bridgeSessionId);
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
