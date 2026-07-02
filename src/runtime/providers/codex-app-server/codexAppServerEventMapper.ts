// LLM CLI Bridge — Codex app-server event mapper (V2.17-A Completion)
//
// 把 codex app-server 的 JSON-RPC 通知（thread/start 响应、item/started、
// item/completed、item/text/delta、item/argument/delta、approval request、
// turn/completed、turn/failed）映射为 provider-neutral NormalizedRuntimeEvent。
//
// 映射规则（与 Bridge Core types 对齐）：
// - item/started (type=message)            → message(partial=true)（首段空文本，等 delta 累积）
// - item/text/delta                         → message(partial=true)（delta 文本）
// - item/completed (type=message)           → message(partial=false, 完整文本)
// - item/started (type=thinking)            → thinking（首段；后续 delta 也走 thinking）
// - item/started (type=tool_call)           → tool_start
// - item/argument/delta                     → tool_start toolInput 累积（已通过 ItemDeltaAccumulator 处理）
// - item/completed (type=tool_call)         → tool_start（补完整 toolInput）
// - item/completed (type=tool_result)       → tool_result
// - item/completed (type=file_change)       → file_change
// - commandExecution/approval request       → approval_request
// - fileChange/approval request             → approval_request
// - approval/respond 通知（已解决）          → approval_resolved
// - turn/completed                          → completed
// - turn/failed                             → failed
//
// rawProviderEvent 仅在 developerMode 下填充。

import type {
  CodexApprovalRequestParams,
  CodexItemCompletedParams,
  CodexItemStartedParams,
  CodexItemArgumentDeltaParams,
  CodexItemTextDeltaParams,
  CodexTurnCompletedParams,
  CodexTurnFailedParams,
} from "./schema";
import type { NormalizedRuntimeEvent, ProviderId } from "../../core/types";

/**
 * Codex app-server → NormalizedRuntimeEvent 映射器。
 *
 * 无状态：每个方法纯函数返回 NormalizedRuntimeEvent（或 null 表示忽略）。
 */
export class CodexAppServerEventMapper {
  constructor(
    private readonly providerId: ProviderId,
    private readonly developerMode: boolean,
  ) {}

  /** item/started → message/thinking/tool_start */
  mapItemStarted(params: CodexItemStartedParams): NormalizedRuntimeEvent | null {
    const ts = new Date().toISOString();
    const base = {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "item/started", params } : undefined,
    };
    switch (params.type) {
      case "message":
        return {
          ...base,
          payload: {
            kind: "message",
            role: "assistant",
            text: "",
            partial: true,
            sessionId: params.sessionId,
            parentToolUseId: params.parentToolUseId,
          },
        };
      case "thinking":
        return {
          ...base,
          payload: { kind: "thinking", text: "" },
        };
      case "tool_call":
        return {
          ...base,
          payload: {
            kind: "tool_start",
            toolName: params.toolName ?? "unknown",
            toolInput: "",
            callId: params.callId ?? params.itemId,
            sessionId: params.sessionId,
            parentToolUseId: params.parentToolUseId,
          },
        };
      default:
        // 其他类型（file_change/approval_request/tool_result/command_execution）
        // 在 item/completed 时统一处理（started 时不发）
        return null;
    }
  }

  /** item/text/delta → message partial delta */
  mapItemTextDelta(params: CodexItemTextDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "item/text/delta", params } : undefined,
      payload: {
        kind: "message",
        role: "assistant",
        text: params.delta,
        partial: true,
      },
    };
  }

  /** item/text/delta（thinking 上下文）→ thinking delta */
  mapThinkingDelta(params: CodexItemTextDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "item/thinking/delta", params } : undefined,
      payload: { kind: "thinking", text: params.delta },
    };
  }

  /** item/argument/delta → tool_start toolInput 累积 */
  mapItemArgumentDelta(params: CodexItemArgumentDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "item/argument/delta", params } : undefined,
      payload: {
        kind: "tool_start",
        toolName: "",
        toolInput: params.delta,
        callId: params.itemId,
      },
    };
  }

  /** item/completed → message/tool_result/file_change（按 type 分发） */
  mapItemCompleted(params: CodexItemCompletedParams): NormalizedRuntimeEvent | null {
    const ts = new Date().toISOString();
    const base = {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "item/completed", params } : undefined,
    };
    switch (params.type) {
      case "message":
        return {
          ...base,
          payload: {
            kind: "message",
            role: "assistant",
            text: params.text ?? "",
            partial: false,
          },
        };
      case "tool_result":
        return {
          ...base,
          payload: {
            kind: "tool_result",
            callId: params.callId ?? params.itemId,
            toolName: params.toolName ?? "unknown",
            output: params.text ?? "",
            isError: !!params.isError,
          },
        };
      case "file_change":
        return {
          ...base,
          payload: {
            kind: "file_change",
            action: params.fileAction ?? "modify",
            path: params.filePath ?? "",
          },
        };
      case "tool_call":
        // tool_call completed 主要用于补全 toolInput；不再产生新事件
        //（tool_start 已在 item/started 时发出）
        return null;
      default:
        return null;
    }
  }

  /** commandExecution/fileChange approval request → approval_request */
  mapApprovalRequest(params: CodexApprovalRequestParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    const toolName = params.toolName
      ?? (params.kind === "commandExecution" ? "Bash" : "Write");
    const riskLevel = params.kind === "commandExecution" ? "high" : "medium";
    const description = params.description
      ?? (params.kind === "commandExecution"
        ? `Execute command: ${params.command ?? ""}`
        : `${params.fileAction ?? "modify"} ${params.filePath ?? ""}`);
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "approval/request", params } : undefined,
      payload: {
        kind: "approval_request",
        requestId: params.requestId,
        toolName,
        description,
        riskLevel,
        riskReason: params.kind === "commandExecution" ? "Shell execution" : "File modification",
        inputSummary: params.inputSummary ?? params.command ?? params.filePath,
      },
    };
  }

  /** approval/respond → approval_resolved */
  mapApprovalResolved(requestId: string, response: "allow" | "allowSession" | "deny" | "cancel", source: "user" | "session_allow" | "session_deny" | "mode"): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    const mapped = response === "allow" ? { type: "accept" as const }
      : response === "allowSession" ? { type: "acceptForSession" as const }
      : response === "deny" ? { type: "decline" as const }
      : { type: "cancel" as const };
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "approval/respond", requestId, response } : undefined,
      payload: {
        kind: "approval_resolved",
        requestId,
        response: mapped,
        source,
      },
    };
  }

  /** turn/completed → completed */
  mapTurnCompleted(params: CodexTurnCompletedParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "turn/completed", params } : undefined,
      payload: {
        kind: "completed",
        text: params.finalText ?? "",
        durationMs: params.durationMs,
        sessionId: params.sessionId,
      },
    };
  }

  /** turn/failed → failed */
  mapTurnFailed(params: CodexTurnFailedParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "turn/failed", params } : undefined,
      payload: {
        kind: "failed",
        message: params.message,
        recoverable: params.recoverable ?? false,
        sessionId: params.sessionId,
      },
    };
  }

  /** thread/start 响应 → session_started */
  mapThreadStarted(threadId: string, sessionId?: string): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      rawProviderEvent: this.developerMode ? { method: "thread/start", threadId, sessionId } : undefined,
      payload: {
        kind: "session_started",
        text: threadId,
        sessionId,
      },
    };
  }
}
