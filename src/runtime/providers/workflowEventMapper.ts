// LLM CLI Bridge — WorkflowEvent → NormalizedRuntimeEvent mapper (V2.17-A Completion)
//
// 把现有 V2.17-A 过渡层的 WorkflowEvent（SDK 工作流事件）映射为 Bridge Core 的
// NormalizedRuntimeEvent。这是 claude-sdk / claude-cli provider adapter 的共享映射层。
//
// 映射规则见 assistantTurnView.ts 注释。

import type { WorkflowEvent, PermissionEvent } from "../../workflowEvent";
import type { NormalizedRuntimeEvent, ProviderId } from "../core/types";

/**
 * 把单个 WorkflowEvent 映射为 NormalizedRuntimeEvent。
 *
 * @param ev WorkflowEvent
 * @param providerId 事件来源 provider
 * @param developerMode 是否填充 rawProviderEvent（仅 developerMode）
 */
export function mapWorkflowEventToNormalized(
  ev: WorkflowEvent,
  providerId: ProviderId,
  developerMode: boolean,
): NormalizedRuntimeEvent {
  const base = {
    providerId,
    timestamp: ev.timestamp,
    rawProviderEvent: developerMode ? ev : undefined,
  };

  switch (ev.type) {
    case "thinking":
      return { ...base, payload: { kind: "thinking", text: ev.text } };

    case "message":
      return {
        ...base,
        payload: {
          kind: "message",
          role: ev.role,
          text: ev.text,
          partial: ev.partial,
          sessionId: ev.sessionId,
          parentToolUseId: ev.parentToolUseId,
        },
      };

    case "tool_start":
      return {
        ...base,
        payload: {
          kind: "tool_start",
          toolName: ev.toolName,
          toolInput: ev.toolInput,
          callId: ev.callId,
          sessionId: ev.sessionId,
          parentToolUseId: ev.parentToolUseId,
        },
      };

    case "tool_result":
      return {
        ...base,
        payload: {
          kind: "tool_result",
          callId: ev.callId,
          toolName: ev.toolName,
          output: ev.output,
          isError: ev.isError,
        },
      };

    case "file_change":
      return {
        ...base,
        // V16.4: 透传 additions/deletions（若 WorkflowEvent 提供）
        payload: {
          kind: "file_change",
          action: ev.action,
          path: ev.path,
          ...(ev.additions !== undefined ? { additions: ev.additions } : {}),
          ...(ev.deletions !== undefined ? { deletions: ev.deletions } : {}),
        },
      };

    case "permission":
      return mapPermissionEvent(ev, providerId, developerMode);

    case "progress":
      return {
        ...base,
        payload: {
          kind: "progress",
          label: ev.label,
          detail: ev.detail,
          category: ev.category,
        },
      };

    case "error":
      return {
        ...base,
        payload: { kind: "error", message: ev.message, recoverable: ev.recoverable },
      };

    case "completed":
      return {
        ...base,
        payload: {
          kind: "completed",
          text: ev.text,
          durationMs: ev.durationMs,
          sessionId: ev.sessionId,
        },
      };

    case "failed":
      return {
        ...base,
        payload: {
          kind: "failed",
          message: ev.message,
          recoverable: ev.recoverable,
          sessionId: ev.sessionId,
        },
      };
  }
}

/**
 * 把 PermissionEvent 映射为 NormalizedRuntimeEvent。
 *
 * - pending=true：映射为 approval_request
 * - pending=false 且 requestId 存在：映射为 approval_resolved（已被用户/缓存决策）
 * - 无 requestId：legacy 静态 permission 事件，映射为 approval_request(pending=false)
 */
function mapPermissionEvent(
  ev: PermissionEvent,
  providerId: ProviderId,
  developerMode: boolean,
): NormalizedRuntimeEvent {
  const base = {
    providerId,
    timestamp: ev.timestamp,
    rawProviderEvent: developerMode ? ev : undefined,
  };

  if (ev.requestId && ev.pending === false) {
    // 已解决
    return {
      ...base,
      payload: {
        kind: "approval_resolved",
        requestId: ev.requestId,
        response: ev.granted ? { type: "accept" } : { type: "decline" },
        source: ev.source ?? "user",
      },
    };
  }

  // pending 或 legacy 静态事件
  return {
    ...base,
    payload: {
      kind: "approval_request",
      requestId: ev.requestId ?? `legacy-${ev.timestamp}`,
      toolName: ev.toolName,
      description: ev.description,
      riskLevel: ev.riskLevel ?? "low",
      riskReason: ev.riskReason,
      highRiskFlags: ev.highRiskFlags,
      inputSummary: ev.inputSummary,
      mergeKey: ev.mergeKey,
      sessionId: ev.sessionId,
      parentToolUseId: ev.parentToolUseId,
      subagentRisk: ev.subagentRisk,
    },
  };
}

/**
 * 反向映射：把 NormalizedRuntimeEvent 还原为 WorkflowEvent。
 *
 * 用于 view.ts 过渡期：BridgeSession 产出 NormalizedRuntimeEvent，但现有 UI
 * 渲染管线（RunStateAggregator / appendLiveSdkEvent / sdkEvents）仍消费 WorkflowEvent。
 * 后续 UI 全量迁移到 AssistantTurnView 后此函数可移除。
 *
 * - stdout_delta / stderr_delta / session_started：无对应 WorkflowEvent，返回 null
 *   （这些由 view.ts 直接处理，不走 workflow 管线）
 * - approval_request → PermissionEvent(pending=true)
 * - approval_resolved → PermissionEvent(pending=false)
 */
export function mapNormalizedToWorkflowEvent(
  ev: NormalizedRuntimeEvent,
): WorkflowEvent | null {
  const ts = ev.timestamp;
  const p = ev.payload;
  switch (p.kind) {
    case "thinking":
      return { type: "thinking", timestamp: ts, text: p.text };

    case "message":
      return {
        type: "message",
        timestamp: ts,
        role: p.role,
        text: p.text,
        partial: p.partial,
        sessionId: p.sessionId,
        parentToolUseId: p.parentToolUseId,
      };

    case "tool_start":
      return {
        type: "tool_start",
        timestamp: ts,
        toolName: p.toolName,
        toolInput: p.toolInput,
        callId: p.callId,
        sessionId: p.sessionId,
        parentToolUseId: p.parentToolUseId,
      };

    case "tool_result":
      return {
        type: "tool_result",
        timestamp: ts,
        callId: p.callId,
        toolName: p.toolName,
        output: p.output,
        isError: p.isError,
      };

    case "file_change":
      return {
        type: "file_change",
        timestamp: ts,
        action: p.action,
        path: p.path,
      };

    case "approval_request":
      return {
        type: "permission",
        timestamp: ts,
        toolName: p.toolName,
        description: p.description,
        granted: false,
        riskLevel: p.riskLevel,
        riskReason: p.riskReason,
        highRiskFlags: p.highRiskFlags,
        requestId: p.requestId,
        mergeKey: p.mergeKey,
        pending: true,
        inputSummary: p.inputSummary,
        sessionId: p.sessionId,
        parentToolUseId: p.parentToolUseId,
        subagentRisk: p.subagentRisk,
      };

    case "approval_resolved":
      return {
        type: "permission",
        timestamp: ts,
        toolName: "",
        description: "",
        granted: p.response.type === "accept" || p.response.type === "acceptForSession",
        requestId: p.requestId,
        pending: false,
        source: p.source,
      };

    case "user_input_request":
    case "user_input_resolved":
      return null;

    case "progress":
      return {
        type: "progress",
        timestamp: ts,
        label: p.label,
        detail: p.detail,
        category: p.category,
      };

    case "error":
      return {
        type: "error",
        timestamp: ts,
        message: p.message,
        recoverable: p.recoverable,
      };

    case "completed":
      return {
        type: "completed",
        timestamp: ts,
        text: p.text,
        durationMs: p.durationMs,
        sessionId: p.sessionId,
      };

    case "failed":
      return {
        type: "failed",
        timestamp: ts,
        message: p.message,
        recoverable: p.recoverable,
        sessionId: p.sessionId,
      };

    case "stdout_delta":
    case "stderr_delta":
    case "session_started":
    case "native_session_bound":
    case "token_usage":
      return null;
  }
}

