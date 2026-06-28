// LLM CLI Bridge — Run Timeline
// V1.2 Interaction Foundation: 将运行状态映射为时间线事件（纯函数，便于单元测试）
// 不新增 tool event，不改 AgentEvent v0.1 contract

import type { RunStatus } from "./types";

/**
 * 时间线事件类型（基于现有 RunStatus，不新增 AgentEvent 类型）
 */
export type TimelineEventType =
  | "started"
  | "stdout"
  | "stderr"
  | "completed"
  | "failed"
  | "stopped";

/**
 * 时间线事件条目
 */
export interface TimelineEntry {
  readonly type: TimelineEventType;
  readonly timestamp: string;
  readonly detail: string;
}

/**
 * 将 RunStatus 映射为时间线终态事件类型
 * - running → 不产生终态（运行中）
 * - completed → "completed"
 * - failed → "failed"
 * - stopped → "stopped"
 * - idle → 不产生事件
 */
export function mapStatusToTimelineType(status: RunStatus): TimelineEventType | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  return null; // idle / running 不产生终态事件
}

/**
 * 时间线事件类型 → 用户可读标签
 */
export function timelineTypeLabel(type: TimelineEventType): string {
  const labels: Record<TimelineEventType, string> = {
    started: "Started",
    stdout: "stdout",
    stderr: "stderr",
    completed: "Completed",
    failed: "Failed",
    stopped: "Stopped",
  };
  return labels[type];
}

/**
 * 时间线事件类型 → CSS 状态类名（用于着色）
 */
export function timelineTypeClass(type: TimelineEventType): string {
  const classes: Record<TimelineEventType, string> = {
    started: "is-started",
    stdout: "is-stdout",
    stderr: "is-stderr",
    completed: "is-completed",
    failed: "is-failed",
    stopped: "is-stopped",
  };
  return classes[type];
}

/**
 * 从运行结果构造完整时间线
 * - 接收运行过程中的事件列表 + 终态
 * - 返回用于 UI 展示的时间线条目数组
 *
 * @param startedAt  运行开始时间 ISO 字符串
 * @param events     运行过程中收集的事件（stdout/stderr 片段）
 * @param finalStatus 终态
 * @param finalDetail 终态详情（如 exit code / duration）
 */
export function buildTimeline(
  startedAt: string,
  events: ReadonlyArray<{ type: TimelineEventType; detail: string; timestamp: string }>,
  finalStatus: RunStatus,
  finalDetail: string,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  // started
  entries.push({
    type: "started",
    timestamp: startedAt,
    detail: "",
  });
  // 中间事件
  for (const e of events) {
    entries.push({
      type: e.type,
      timestamp: e.timestamp,
      detail: e.detail,
    });
  }
  // 终态
  const terminalType = mapStatusToTimelineType(finalStatus);
  if (terminalType) {
    entries.push({
      type: terminalType,
      timestamp: new Date().toISOString(),
      detail: finalDetail,
    });
  }
  return entries;
}

/**
 * 判断时间线事件类型是否为终态
 */
export function isTerminalTimelineType(type: TimelineEventType): boolean {
  return type === "completed" || type === "failed" || type === "stopped";
}
