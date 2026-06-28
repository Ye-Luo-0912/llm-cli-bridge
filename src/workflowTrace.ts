// LLM CLI Bridge — Workflow Trace (V1.5)
// UI-only 工作流追踪：展示 preflight → build_prompt → spawn → stdout/stderr → file_diff_scan → 终态
// 纯函数模块，便于单元测试；不改 AgentEvent v0.1，不新增 tool event
// 为后续 SDK structured events 预留 UI 槽位

import type { RunStatus } from "./types";

/**
 * Workflow Trace 阶段类型
 * 对应一次运行的生命周期阶段（比 V1.2 timeline 更细粒度）
 */
export type WorkflowTraceStage =
  | "preflight"
  | "build_prompt"
  | "spawn"
  | "stdout"
  | "stderr"
  | "file_diff_scan"
  | "completed"
  | "failed"
  | "stopped";

/**
 * 单条 trace 条目
 * status: running=进行中 / done=已完成 / skipped=已跳过
 */
export interface WorkflowTraceEntry {
  readonly stage: WorkflowTraceStage;
  readonly timestamp: string;
  readonly detail: string;
  readonly status: "running" | "done" | "skipped";
}

/**
 * 运行过程中收集的中间事件（用于构造完整 trace）
 */
export interface WorkflowTraceEvent {
  readonly stage: WorkflowTraceStage;
  readonly detail: string;
  readonly timestamp: string;
}

/**
 * 将 RunStatus 映射为终态阶段
 * - running / idle → null（无终态）
 * - completed → "completed"
 * - failed → "failed"
 * - stopped → "stopped"
 */
export function mapStatusToWorkflowStage(status: RunStatus): WorkflowTraceStage | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  return null;
}

/**
 * 阶段 → 用户可读标签
 */
export function workflowStageLabel(stage: WorkflowTraceStage): string {
  const labels: Record<WorkflowTraceStage, string> = {
    preflight: "Preflight",
    build_prompt: "Build prompt",
    spawn: "Spawn process",
    stdout: "stdout",
    stderr: "stderr",
    file_diff_scan: "File diff scan",
    completed: "Completed",
    failed: "Failed",
    stopped: "Stopped",
  };
  return labels[stage];
}

/**
 * 阶段 → CSS 状态类名（用于着色）
 */
export function workflowStageClass(stage: WorkflowTraceStage): string {
  const classes: Record<WorkflowTraceStage, string> = {
    preflight: "is-preflight",
    build_prompt: "is-build",
    spawn: "is-spawn",
    stdout: "is-stdout",
    stderr: "is-stderr",
    file_diff_scan: "is-diff",
    completed: "is-completed",
    failed: "is-failed",
    stopped: "is-stopped",
  };
  return classes[stage];
}

/**
 * 判断阶段是否为终态
 */
export function isTerminalWorkflowStage(stage: WorkflowTraceStage): boolean {
  return stage === "completed" || stage === "failed" || stage === "stopped";
}

/**
 * 构造完整 Workflow Trace
 *
 * 阶段顺序：
 *   preflight → build_prompt → spawn → [stdout/stderr 中间事件] → file_diff_scan → 终态
 *
 * - preflight / build_prompt / spawn 三个阶段在运行开始时即记录
 * - stdout / stderr 仅在首次收到对应 delta 时记录（保持简洁）
 * - file_diff_scan 在终态前记录（扫描生成文件）
 * - 终态根据 finalStatus 追加
 *
 * @param startedAt       运行开始时间 ISO 字符串
 * @param preflightOk     preflight 是否通过（false 时记录失败详情）
 * @param promptLength    构造的 prompt 长度
 * @param events          运行过程中收集的中间事件（stdout/stderr）
 * @param fileDiffCount   文件 diff 扫描结果数量（新增/修改文件数）
 * @param finalStatus     终态
 * @param finalDetail     终态详情
 */
export function buildWorkflowTrace(
  startedAt: string,
  preflightOk: boolean | null,
  promptLength: number,
  events: ReadonlyArray<WorkflowTraceEvent>,
  fileDiffCount: number | null,
  finalStatus: RunStatus,
  finalDetail: string,
): WorkflowTraceEntry[] {
  const entries: WorkflowTraceEntry[] = [];
  const now = () => new Date().toISOString();

  // 1. preflight（null 表示未执行 / 跳过）
  if (preflightOk === null) {
    entries.push({
      stage: "preflight",
      timestamp: startedAt,
      detail: "skipped",
      status: "skipped",
    });
  } else if (preflightOk) {
    entries.push({
      stage: "preflight",
      timestamp: startedAt,
      detail: "available",
      status: "done",
    });
  } else {
    entries.push({
      stage: "preflight",
      timestamp: startedAt,
      detail: "unavailable",
      status: "done",
    });
  }

  // 2. build_prompt
  entries.push({
    stage: "build_prompt",
    timestamp: startedAt,
    detail: `${promptLength} chars via stdin`,
    status: "done",
  });

  // 3. spawn
  entries.push({
    stage: "spawn",
    timestamp: startedAt,
    detail: "process started",
    status: "done",
  });

  // 4. 中间事件（stdout / stderr，按时间顺序）
  for (const e of events) {
    entries.push({
      stage: e.stage,
      timestamp: e.timestamp,
      detail: e.detail,
      status: "done",
    });
  }

  // 5. file_diff_scan（null 表示未执行扫描，如失败时可能跳过）
  if (fileDiffCount === null) {
    entries.push({
      stage: "file_diff_scan",
      timestamp: now(),
      detail: "skipped",
      status: "skipped",
    });
  } else {
    entries.push({
      stage: "file_diff_scan",
      timestamp: now(),
      detail: fileDiffCount > 0 ? `${fileDiffCount} file(s) changed` : "no changes",
      status: "done",
    });
  }

  // 6. 终态
  const terminalStage = mapStatusToWorkflowStage(finalStatus);
  if (terminalStage) {
    entries.push({
      stage: terminalStage,
      timestamp: now(),
      detail: finalDetail,
      status: "done",
    });
  }

  return entries;
}
