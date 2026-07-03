// LLM CLI Bridge — ProviderLifecycleEvent (V16.4: SDK-native 阶段化执行视图)
//
// 将 Claude SDK / Codex app-server / CLI 的 raw event 转成统一生命周期事件。
// RunPhaseModel 消费 ProviderLifecycleEvent[] 来生成阶段化执行视图。
//
// 设计原则：
// 1. provider-neutral：所有 provider 的 raw event 都先转成 ProviderLifecycleEvent。
// 2. 保留 SDK 生命周期边界信息（messageId / itemId / toolUseId / parentToolUseId）。
// 3. rawEvent 仅 developerMode 可见。
//
// Claude SDK 映射规则：
// - SDKAssistantMessage → evaluation_started
// - assistant content text → assistant_text_delta / assistant_message
// - assistant content tool_use → tool_requested
// - PreToolUse hook → tool_started or approval_requested
// - PostToolUse hook → tool_completed
// - PostToolUseFailure → tool_failed
// - SDKUserMessage tool_use_result → observation_received
// - SDKPartialAssistantMessage → streaming delta only（不作为 phase 边界）
// - SDKResultMessage → result
//
// Codex app-server 映射规则：
// - thread/start/resume → session_started
// - turn/start → run_started
// - item/started → action_started
// - item/completed → action_completed
// - item/agentMessage/delta → assistant_text_delta
// - item/reasoning/summaryPartAdded → reasoning_section_started
// - item/reasoning/summaryTextDelta → reasoning_summary_delta
// - turn/completed → result

import type {
  AssistantTurnView,
  ThoughtSegment,
  ToolSegment,
  FileChangeSegment,
  ApprovalSegment,
  UserInputRequestSegment,
  ProviderId,
} from "./types";

// ---------- Lifecycle Event Types ----------

export type ProviderLifecycleEventType =
  | "session_started"
  | "run_started"
  | "evaluation_started"
  | "assistant_text_delta"
  | "assistant_message"
  | "reasoning_section_started"
  | "reasoning_summary_delta"
  | "tool_requested"
  | "tool_started"
  | "approval_requested"
  | "approval_resolved"
  | "user_input_requested"
  | "user_input_resolved"
  | "tool_completed"
  | "tool_failed"
  | "tool_batch_completed"
  | "observation_received"
  | "command_output_delta"
  | "background_task"
  | "compact_boundary"
  | "result"
  | "action_started"
  | "action_completed";

export interface ProviderLifecycleEvent {
  readonly type: ProviderLifecycleEventType;
  readonly providerId: ProviderId;
  readonly sessionId?: string;
  readonly messageId?: string;
  readonly itemId?: string;
  readonly toolUseId?: string;
  readonly parentToolUseId?: string;
  readonly timestamp: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly toolInput?: string;
  readonly toolOutput?: string;
  readonly toolStatus?: "running" | "done" | "error";
  readonly fileAction?: "create" | "modify" | "delete";
  readonly filePath?: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly approvalId?: string;
  readonly approvalResolution?: "accept" | "acceptForSession" | "decline" | "cancel";
  readonly label?: string;
  readonly detail?: string;
  readonly category?: string;
  readonly error?: string;
  readonly rawEvent?: unknown;
}

// ---------- Build from AssistantTurnView ----------
//
// 从 AssistantTurnView 的聚合数据重建 lifecycle events。
// 这是一种推导式重建：AssistantTurnViewBuilder 已将 NormalizedRuntimeEvent 聚合为
// thoughts/tools/fileChanges/approvals，我们按时间戳重新排序并推断生命周期边界。
//
// 边界推断规则（与 SDK agent loop 一致）：
// - 每个 thought segment（V16.4 多段）标志一个新的 evaluation_started（新 assistant message）
// - thought 后的 tools 属于该 evaluation 的 actions
// - tool_result（endTime）标志 observation_received
// - 若无 thoughts，用 tool 类型变化作为 fallback 边界

export function buildLifecycleEventsFromTurnView(
  turnView: AssistantTurnView,
): ProviderLifecycleEvent[] {
  const events: ProviderLifecycleEvent[] = [];
  const providerId = turnView.providerId;

  // session_started
  events.push({
    type: "session_started",
    providerId,
    timestamp: turnView.startedAt,
    sessionId: turnView.terminalSessionId,
  });

  // run_started
  events.push({
    type: "run_started",
    providerId,
    timestamp: turnView.startedAt,
  });

  // 合并 thoughts + tools + fileChanges + approvals，按时间戳排序
  type TimelineItem =
    | { kind: "thought"; ts: string; data: ThoughtSegment }
    | { kind: "tool_start"; ts: string; data: ToolSegment }
    | { kind: "tool_end"; ts: string; data: ToolSegment }
    | { kind: "file_change"; ts: string; data: FileChangeSegment }
    | { kind: "approval"; ts: string; data: ApprovalSegment }
    | { kind: "user_input"; ts: string; data: UserInputRequestSegment };

  const timeline: TimelineItem[] = [];

  for (const t of turnView.thoughts) {
    timeline.push({ kind: "thought", ts: t.timestamp, data: t });
  }
  for (const tool of turnView.tools) {
    timeline.push({ kind: "tool_start", ts: tool.startTime, data: tool });
    if (tool.endTime) {
      timeline.push({ kind: "tool_end", ts: tool.endTime, data: tool });
    }
  }
  for (const fc of turnView.fileChanges) {
    timeline.push({ kind: "file_change", ts: fc.timestamp, data: fc });
  }
  for (const ap of turnView.approvals) {
    // approval 使用 turnView.startedAt 作为 fallback 时间戳（ApprovalSegment 无独立时间戳）
    timeline.push({ kind: "approval", ts: turnView.startedAt, data: ap });
  }
  for (const req of (turnView.userInputRequests ?? [])) {
    timeline.push({ kind: "user_input", ts: req.timestamp, data: req });
  }

  // 按时间戳排序（稳定排序：相同时间戳保持插入顺序）
  timeline.sort((a, b) => {
    const ta = new Date(a.ts).getTime();
    const tb = new Date(b.ts).getTime();
    return ta - tb;
  });

  // 遍历 timeline 生成 lifecycle events
  let thoughtIdx = 0;
  // V16.4: 用 lastWasObservation 判定新 SDKAssistantMessage 边界。
  // 初始 true → 第一个 thinking/tool_start 发出 evaluation_started。
  // tool_end 后置 true → 下一个 thinking/tool_start 是新 assistant message。
  // 同一 assistant message 内的连续 tool_start（无 tool_result）不发新边界。
  let lastWasObservation = true;

  for (const item of timeline) {
    switch (item.kind) {
      case "thought": {
        // V16.4: 新 thought segment = 新 evaluation_started（新 assistant message）
        // 仅在上一事件是 observation 或首个事件时发边界；连续 thinking 累加同段不发新边界。
        if (lastWasObservation) {
          events.push({
            type: "evaluation_started",
            providerId,
            timestamp: item.data.timestamp,
            messageId: `msg-${thoughtIdx}`,
          });
          events.push({
            type: "reasoning_section_started",
            providerId,
            timestamp: item.data.timestamp,
            messageId: `msg-${thoughtIdx}`,
          });
        }
        if (item.data.text) {
          events.push({
            type: "reasoning_summary_delta",
            providerId,
            timestamp: item.data.timestamp,
            text: item.data.text,
            messageId: `msg-${thoughtIdx}`,
          });
        }
        thoughtIdx++;
        lastWasObservation = false;
        break;
      }
      case "tool_start": {
        // V16.4: 若上一事件是 observation（tool_result），此 tool_start 属于新 SDKAssistantMessage
        if (lastWasObservation) {
          events.push({
            type: "evaluation_started",
            providerId,
            timestamp: item.data.startTime,
            messageId: `msg-${thoughtIdx}`,
          });
        }
        events.push({
          type: "tool_started",
          providerId,
          timestamp: item.data.startTime,
          toolUseId: item.data.callId,
          toolName: item.data.toolName,
          toolInput: item.data.toolInput,
          parentToolUseId: item.data.parentToolUseId,
          sessionId: item.data.sessionId,
          toolStatus: "running",
        });
        lastWasObservation = false;
        break;
      }
      case "tool_end": {
        events.push({
          type: item.data.isError ? "tool_failed" : "tool_completed",
          providerId,
          timestamp: item.data.endTime!,
          toolUseId: item.data.callId,
          toolName: item.data.toolName,
          toolOutput: item.data.output,
          toolStatus: item.data.isError ? "error" : "done",
        });
        events.push({
          type: "observation_received",
          providerId,
          timestamp: item.data.endTime!,
          toolUseId: item.data.callId,
          toolName: item.data.toolName,
          text: item.data.output,
        });
        // V16.4: 下一个 thinking/tool_start 是新 SDKAssistantMessage
        lastWasObservation = true;
        break;
      }
      case "file_change": {
        events.push({
          type: "action_completed",
          providerId,
          timestamp: item.data.timestamp,
          fileAction: item.data.action,
          filePath: item.data.path,
          additions: item.data.additions,
          deletions: item.data.deletions,
        });
        break;
      }
      case "approval": {
        if (item.data.pending) {
          events.push({
            type: "approval_requested",
            providerId,
            timestamp: turnView.startedAt,
            approvalId: item.data.requestId,
            toolName: item.data.toolName,
            label: item.data.description,
          });
        } else {
          events.push({
            type: "approval_resolved",
            providerId,
            timestamp: turnView.startedAt,
            approvalId: item.data.requestId,
            approvalResolution: item.data.resolution?.type,
            toolName: item.data.toolName,
          });
        }
        break;
      }
      case "user_input": {
        if (item.data.pending) {
          events.push({
            type: "user_input_requested",
            providerId,
            timestamp: item.data.timestamp,
            approvalId: item.data.requestId,
            toolName: item.data.toolName,
            label: item.data.prompt,
          });
        } else {
          events.push({
            type: "user_input_resolved",
            providerId,
            timestamp: item.data.timestamp,
            approvalId: item.data.requestId,
            toolName: item.data.toolName,
            label: item.data.response?.type === "submit" ? item.data.response.value : "cancelled",
          });
        }
        break;
      }
    }
  }

  // finalAnswer → assistant_message
  if (turnView.finalAnswer) {
    events.push({
      type: "assistant_message",
      providerId,
      timestamp: turnView.endedAt ?? turnView.startedAt,
      text: turnView.finalAnswer,
    });
  }

  // result
  if (turnView.status === "completed") {
    events.push({
      type: "result",
      providerId,
      timestamp: turnView.endedAt ?? turnView.startedAt,
      sessionId: turnView.terminalSessionId,
    });
  } else if (turnView.status === "failed") {
    events.push({
      type: "result",
      providerId,
      timestamp: turnView.endedAt ?? turnView.startedAt,
      error: turnView.errors.join("; "),
      sessionId: turnView.terminalSessionId,
    });
  } else if (turnView.status === "stopped") {
    events.push({
      type: "result",
      providerId,
      timestamp: turnView.endedAt ?? turnView.startedAt,
      sessionId: turnView.terminalSessionId,
    });
  }

  return events;
}
