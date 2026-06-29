// LLM CLI Bridge — Session Context (V2.7)
// 统一会话上下文抽象：CLI continue/resume、SDK sessionId、本地历史恢复
// 纯类型 + 工厂函数，便于单元测试；不改 AgentEvent v0.1，不启用真实联调
//
// 设计原则：
// - 铺路模块：为未来 SDK 真实联调提供统一会话上下文表示
// - 当前 CLI 主线仍直接读 settings.claudeContinueSession/claudeResumeSessionId
// - 本地历史恢复（source=local）不接 CLI/SDK 会话，仅 UI 恢复

import type { LLMBridgeSettings } from "./types";

/** 会话上下文模式 */
export type SessionContextMode = "fresh" | "continue" | "resume";

/** 会话上下文来源 */
export type SessionContextSource = "cli" | "sdk" | "local";

/**
 * 统一会话上下文（V2.7 铺路）
 * - mode: fresh=新会话；continue=继续最近会话；resume=恢复指定会话
 * - sessionId: resume 模式下的会话 id（CLI 的 claudeResumeSessionId / SDK 的 sessionId / 本地历史 id）；fresh/continue 为 null
 * - source: 上下文来源（cli/sdk/local）
 */
export interface SessionContext {
  readonly mode: SessionContextMode;
  readonly sessionId: string | null;
  readonly source: SessionContextSource;
}

/**
 * 从 LLMBridgeSettings 构造 CLI 会话上下文
 * - claudeContinueSession=true → continue 模式
 * - claudeResumeSessionId 非空 → resume 模式
 * - 否则 → fresh 模式
 */
export function buildCliSessionContext(settings: LLMBridgeSettings): SessionContext {
  if (settings.claudeContinueSession) {
    return { mode: "continue", sessionId: null, source: "cli" };
  }
  if (settings.claudeResumeSessionId && settings.claudeResumeSessionId.trim()) {
    return { mode: "resume", sessionId: settings.claudeResumeSessionId.trim(), source: "cli" };
  }
  return { mode: "fresh", sessionId: null, source: "cli" };
}

/**
 * 构造 SDK 会话上下文（V2.7 铺路，未来 SDK 真实联调用）
 * @param sessionId SDK 会话 id（null 表示新会话）
 */
export function buildSdkSessionContext(sessionId: string | null): SessionContext {
  if (sessionId && sessionId.trim()) {
    return { mode: "resume", sessionId: sessionId.trim(), source: "sdk" };
  }
  return { mode: "fresh", sessionId: null, source: "sdk" };
}

/**
 * 构造本地历史恢复上下文（UI 本地历史恢复，不接 CLI/SDK 会话）
 */
export function buildLocalSessionContext(): SessionContext {
  return { mode: "fresh", sessionId: null, source: "local" };
}

/**
 * 判断上下文是否需要透传会话 id（用于决定是否给 backend 传 resume 参数）
 */
export function needsSessionResume(ctx: SessionContext): boolean {
  return ctx.mode === "resume" && ctx.sessionId !== null;
}

/**
 * 判断上下文是否为继续最近会话（CLI --continue 语义）
 */
export function isContinueMode(ctx: SessionContext): boolean {
  return ctx.mode === "continue";
}

/**
 * 会话上下文可读标签（用于 UI/日志）
 */
export function sessionContextLabel(ctx: SessionContext): string {
  const modeLabel = ctx.mode === "fresh" ? "新会话" : ctx.mode === "continue" ? "继续最近" : "恢复指定";
  const sourceLabel = ctx.source === "cli" ? "CLI" : ctx.source === "sdk" ? "SDK" : "本地";
  if (ctx.sessionId) {
    return `${sourceLabel}·${modeLabel}(${ctx.sessionId.slice(0, 12)})`;
  }
  return `${sourceLabel}·${modeLabel}`;
}
