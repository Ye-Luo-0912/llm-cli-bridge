// LLM CLI Bridge — Session State (V2.0)
// UI-only 会话概念：当前会话标题、状态、消息数；不做复杂历史管理，不持久化
// 纯函数模块，便于单元测试；不改 AgentEvent v0.1，不新增 tool event

import type { RunStatus } from "./types";

/**
 * 会话状态（UI-only，view 内持有，不写入 settings / 不持久化）
 */
export interface SessionState {
  /** 会话标题：首条用户消息前 30 字符；未发送时为 "新会话" */
  readonly title: string;
  /** 当前运行状态 */
  readonly status: RunStatus;
  /** 已发送的用户消息数（不含 assistant） */
  readonly messageCount: number;
  /** 当前会话首条消息时间（ISO），用于会话状态展示 */
  readonly startedAt: string | null;
}

/**
 * 创建新会话状态（标题 "新会话"，状态 idle）
 */
export function createNewSession(): SessionState {
  return {
    title: "新会话",
    status: "idle",
    messageCount: 0,
    startedAt: null,
  };
}

/**
 * 从首条用户消息生成会话标题
 * - 去除多余空白
 * - 超过 30 字符截断加 "…"
 * - 空消息返回 "新会话"
 */
export function generateSessionTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "新会话";
  if (trimmed.length <= 30) return trimmed;
  return trimmed.slice(0, 30) + "…";
}

/**
 * RunStatus → 会话状态可读标签
 */
export function sessionStatusLabel(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    idle: "Idle",
    running: "Running",
    completed: "Done",
    failed: "Failed",
    stopped: "Stopped",
  };
  return labels[status];
}

/**
 * RunStatus → CSS 状态类名（用于着色，与 status dot 一致）
 */
export function sessionStatusClass(status: RunStatus): string {
  return `is-${status}`;
}

/**
 * 更新会话状态（返回新对象，不可变更新）
 */
export function updateSession(
  prev: SessionState,
  patch: Partial<SessionState>,
): SessionState {
  return { ...prev, ...patch };
}
