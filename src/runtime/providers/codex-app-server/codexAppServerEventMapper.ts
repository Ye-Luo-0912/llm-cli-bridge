// LLM CLI Bridge — Codex app-server event mapper (V2.17-A Completion)
//
// 把 codex app-server 的 JSON-RPC 通知（thread/start 响应、item/started、
// item/completed、item/agentMessage/delta、item/reasoning/* delta、
// item/commandExecution/outputDelta、item/plan/delta、approval request、
// turn/completed、turn/failed）映射为 provider-neutral NormalizedRuntimeEvent。
//
// 映射规则（与 Bridge Core types 对齐，对齐官方 codex app-server schema）：
// - item/started (item.type=agentMessage)        → message(partial=true)（首段空文本，等 delta 累积）
// - item/agentMessage/delta                      → message(partial=true)（delta 文本，驱动 finalAnswer）
// - item/completed (item.type=agentMessage)      → message(partial=false, 完整文本)
// - item/started (item.type=reasoning)           → thinking（首段；后续 delta 也走 thinking）
// - item/reasoning/summaryTextDelta              → thinking delta
// - item/reasoning/textDelta                     → thinking delta（raw）
// - item/started (item.type=commandExecution)    → tool_start
// - item/commandExecution/outputDelta            → tool progress（output 累积）
// - item/completed (item.type=commandExecution)  → tool_result
// - item/started (item.type=mcpToolCall)         → tool_start
// - item/completed (item.type=mcpToolCall)       → tool_result
// - item/completed (item.type=fileChange)        → file_change（每个 change 一条）
// - item/plan/delta (experimental)               → thinking delta（plan 文本流）
// - item/fileChange/outputDelta                  → tool progress
// - commandExecution/fileChange approval request → approval_request
// - serverRequest/resolved（已解决）             → approval_resolved（携带真实 requestId/threadId/turnId/itemId）
// - turn/started                                 → progress（turn 启动）
// - turn/completed                               → completed
// - turn/failed                                  → failed
//
// ⚠️ 旧 fixture 兼容路径（flat params + item/text/delta + item/argument/delta）
//    仍保留作为 legacy alias，不作为主路径。新 schema 走 nested params.item +
//    item/agentMessage/delta 等官方 method 名。
//
// rawProviderEvent 仅在 developerMode 下填充。

import type {
  CodexCommandExecutionItem,
  CodexDynamicToolCallItem,
  CodexFileChangeItem,
  CodexInitializeResult,
  CodexItemAgentMessageDeltaParams,
  CodexItemArgumentDeltaParams,
  CodexItemCommandExecutionOutputDeltaParams,
  CodexItemCompletedParams,
  CodexFileChangeOutputDeltaParams,
  CodexItemPlanDeltaParams,
  CodexItemReasoningSummaryTextDeltaParams,
  CodexItemReasoningTextDeltaParams,
  CodexItemStartedParams,
  CodexItemTextDeltaParams,
  CodexMcpToolCallItem,
  CodexServerRequestResolvedParams,
  CodexThreadItem,
  CodexTurnCompletedParams,
  CodexTurnDiffUpdatedParams,
  CodexTurnFailedParams,
  CodexTurnStartedParams,
} from "./schema";
import type { NormalizedRuntimeEvent, ProviderId } from "../../core/types";

function mapPatchChangeKind(kind: unknown): "create" | "modify" | "delete" {
  if (kind === "create" || kind === "add") return "create";
  if (kind === "delete") return "delete";
  if (kind === "modify" || kind === "update") return "modify";
  if (kind && typeof kind === "object") {
    const type = (kind as { type?: unknown }).type;
    if (type === "add") return "create";
    if (type === "delete") return "delete";
    if (type === "update") return "modify";
  }
  return "modify";
}

/**
 * Codex app-server → NormalizedRuntimeEvent 映射器。
 *
 * 无状态：每个方法纯函数返回 NormalizedRuntimeEvent（或 null 表示忽略）。
 */
export class CodexAppServerEventMapper {
  private sequence = 0;

  constructor(
    private readonly providerId: ProviderId,
    private readonly developerMode: boolean,
  ) {}

  private sourceRef(method: string, params: {
    threadId?: string;
    turnId?: string;
    itemId?: string;
    item?: { id?: string; parentItemId?: string };
    parentItemId?: string;
    requestId?: string | number;
  } = {}): import("../../core/types").RuntimeSourceRef {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.item?.id ?? params.itemId,
      parentItemId: params.item?.parentItemId ?? params.parentItemId,
      serverRequestId: params.requestId,
      method,
      sequence: this.sequence++,
    };
  }

  // ---------- item/started（官方 nested params.item） ----------

  /**
   * item/started → message/thinking/tool_start（按 item.type 分发）。
   *
   * 支持官方 nested params.item 结构；旧 flat params（type/itemId 顶层）作为 legacy alias 兼容。
   */
  mapItemStarted(params: CodexItemStartedParams): NormalizedRuntimeEvent | null {
    const ts = new Date().toISOString();
    const base = {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/started", params),
      rawProviderEvent: this.developerMode ? { method: "item/started", params } : undefined,
    };

    // 提取 item type / id（官方 nested 优先；flat 兼容）
    const item = params.item;
    const itemType = item?.type ?? params.type;
    const itemId = item?.id ?? params.itemId;
    if (!itemType) return null;

    switch (itemType) {
      case "agentMessage":
      case "message": {
        // agentMessage 官方 type；message 为 legacy alias
        const amItem = item as Extract<CodexThreadItem, { type: "agentMessage" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "message",
            role: "assistant",
            text: amItem?.text ?? "",
            partial: true,
            sessionId: params.sessionId,
            parentToolUseId: params.parentToolUseId,
          },
        };
      }
      case "reasoning":
      case "thinking": {
        // reasoning 官方 type；thinking 为 legacy alias
        return {
          ...base,
          payload: { kind: "thinking", text: "" },
        };
      }
      case "commandExecution":
      case "tool_call": {
        // commandExecution 官方 type；tool_call 为 legacy alias
        const cmdItem = item as Extract<CodexThreadItem, { type: "commandExecution" }> | undefined;
        const mcpItem = item as Extract<CodexThreadItem, { type: "mcpToolCall" }> | undefined;
        const dynItem = item as Extract<CodexThreadItem, { type: "dynamicToolCall" }> | undefined;
        // 工具名：commandExecution 用 "Bash"；mcpToolCall 用 server.tool；dynamicToolCall 用 tool
        const toolName = cmdItem ? "Bash"
          : mcpItem ? (mcpItem.tool || "mcp")
          : dynItem ? (dynItem.tool || "dynamic")
          : (params.toolName ?? "unknown");
        // callId：用 itemId 作为 callId（codex 无独立 callId 字段）
        const callId = itemId ?? params.callId ?? "";
        return {
          ...base,
          payload: {
            kind: "tool_start",
            toolName,
            toolInput: cmdItem?.command ? JSON.stringify(cmdItem.command) : "",
            callId,
            command: cmdItem?.command,
            cwd: cmdItem?.cwd,
            sessionId: params.sessionId,
            parentToolUseId: params.parentToolUseId,
          },
        };
      }
      case "mcpToolCall":
      case "dynamicToolCall": {
        // 走 tool_start 路径（与 commandExecution 共用 case 已处理）
        const mcpItem = item as CodexMcpToolCallItem | undefined;
        const dynItem = item as CodexDynamicToolCallItem | undefined;
        const toolName = mcpItem ? (mcpItem.tool || "mcp") : (dynItem?.tool || "dynamic");
        const callId = itemId ?? params.callId ?? "";
        return {
          ...base,
          payload: {
            kind: "tool_start",
            toolName,
            toolInput: mcpItem?.arguments ? JSON.stringify(mcpItem.arguments)
              : dynItem?.arguments ? JSON.stringify(dynItem.arguments) : "",
            callId,
            server: mcpItem?.server,
            args: mcpItem?.arguments ?? dynItem?.arguments,
            sessionId: params.sessionId,
            parentToolUseId: params.parentToolUseId,
          },
        };
      }
      case "fileChange": {
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "fileChange",
            detail: "started",
            category: "tool",
          },
        };
      }
      case "plan": {
        const planItem = item as Extract<CodexThreadItem, { type: "plan" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "plan",
            detail: planItem?.text ?? "started",
            category: "thinking",
          },
        };
      }
      case "webSearch": {
        const webItem = item as Extract<CodexThreadItem, { type: "webSearch" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "webSearch",
            detail: webItem?.query ?? "started",
            category: "tool",
          },
        };
      }
      case "imageView": {
        const imageItem = item as Extract<CodexThreadItem, { type: "imageView" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "imageView",
            detail: imageItem?.path ?? "started",
            category: "tool",
          },
        };
      }
      case "enteredReviewMode":
      case "exitedReviewMode": {
        const reviewItem = item as Extract<CodexThreadItem, { type: "enteredReviewMode" | "exitedReviewMode" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: itemType,
            detail: reviewItem?.review ?? itemType,
            category: "status",
          },
        };
      }
      case "contextCompaction": {
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "contextCompaction",
            detail: "started",
            category: "status",
          },
        };
      }
      case "userMessage": {
        // userMessage 是 turn input 的镜像，不进入 assistant timeline，避免把用户气泡重复渲染为过程节点。
        return null;
      }
      default:
        // 其他 legacy 类型（file_change/approval_request/tool_result 等）
        // 在 item/completed 时统一处理（started 时不发）
        return null;
    }
  }

  // ---------- item delta（官方 method 名，主路径） ----------

  /**
   * item/agentMessage/delta → message partial delta（驱动 finalAnswer 的主路径）。
   */
  mapItemAgentMessageDelta(params: CodexItemAgentMessageDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/agentMessage/delta", params),
      rawProviderEvent: this.developerMode ? { method: "item/agentMessage/delta", params } : undefined,
      payload: {
        kind: "message",
        role: "assistant",
        text: params.delta,
        partial: true,
      },
    };
  }

  /**
   * item/reasoning/summaryTextDelta → thinking delta。
   */
  mapItemReasoningSummaryTextDelta(params: CodexItemReasoningSummaryTextDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/reasoning/summaryTextDelta", params),
      rawProviderEvent: this.developerMode ? { method: "item/reasoning/summaryTextDelta", params } : undefined,
      payload: { kind: "thinking", text: params.delta },
    };
  }

  /**
   * item/reasoning/textDelta → thinking delta（raw reasoning）。
   */
  mapItemReasoningTextDelta(params: CodexItemReasoningTextDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/reasoning/textDelta", params),
      rawProviderEvent: this.developerMode ? { method: "item/reasoning/textDelta", params } : undefined,
      payload: { kind: "thinking", text: params.delta },
    };
  }

  /**
   * item/commandExecution/outputDelta → tool progress（命令输出流累积）。
   *
   * 映射为 progress(category=tool) 供 AssistantTurnViewBuilder 附加到最近 running tool 段。
   */
  mapItemCommandExecutionOutputDelta(params: CodexItemCommandExecutionOutputDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/commandExecution/outputDelta", params),
      rawProviderEvent: this.developerMode ? { method: "item/commandExecution/outputDelta", params } : undefined,
      payload: {
        kind: "progress",
        label: "output",
        detail: params.delta,
        category: "tool",
      },
    };
  }

  /**
   * item/plan/delta → thinking delta（plan 文本流，experimental）。
   *
   * plan 是 experimental item type；仅当 experimentalApi=true 时 server 才会推送。
   * 这里统一映射为 thinking（plan 文本作为 reasoning 展示），不引入新的 segment kind。
   */
  mapItemPlanDelta(params: CodexItemPlanDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/plan/delta", params),
      rawProviderEvent: this.developerMode ? { method: "item/plan/delta", params } : undefined,
      payload: { kind: "thinking", text: params.delta },
    };
  }

  /**
   * item/fileChange/outputDelta → tool progress（file change 输出流累积）。
   */
  mapItemFileChangeOutputDelta(params: CodexFileChangeOutputDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/fileChange/outputDelta", params),
      rawProviderEvent: this.developerMode ? { method: "item/fileChange/outputDelta", params } : undefined,
      payload: {
        kind: "progress",
        label: "fileChange",
        detail: params.delta,
        category: "tool",
      },
    };
  }

  /**
   * turn/diff/updated → status/diff observation.
   *
   * 该通知是 turn-level telemetry，不带 itemId；普通用户态不把它渲染为主 timeline，
   * developer mode 可通过 provider-native status node / rawProviderEvents 审计 diff 更新。
   */
  mapTurnDiffUpdated(params: CodexTurnDiffUpdatedParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    const diff = params.diff ?? params.patch ?? "";
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("turn/diff/updated", params),
      rawProviderEvent: this.developerMode ? { method: "turn/diff/updated", params } : undefined,
      payload: {
        kind: "progress",
        label: "turnDiff",
        detail: diff || params.summary || "diff updated",
        category: "status",
      },
    };
  }

  // ---------- 旧 delta legacy alias（fixture 兼容；不作为主路径） ----------

  /**
   * item/text/delta → message partial delta（⚠️ legacy alias only）。
   *
   * 仅作为 fixture legacy alias；新 schema 使用 item/agentMessage/delta。
   */
  mapItemTextDelta(params: CodexItemTextDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/text/delta", params),
      rawProviderEvent: this.developerMode ? { method: "item/text/delta (legacy)", params } : undefined,
      payload: {
        kind: "message",
        role: "assistant",
        text: params.delta,
        partial: true,
      },
    };
  }

  /**
   * item/text/delta（thinking 上下文）→ thinking delta（⚠️ legacy alias only）。
   */
  mapThinkingDelta(params: CodexItemTextDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/thinking/delta", params),
      rawProviderEvent: this.developerMode ? { method: "item/thinking/delta (legacy)", params } : undefined,
      payload: { kind: "thinking", text: params.delta },
    };
  }

  /**
   * item/argument/delta → tool_start toolInput 累积（⚠️ legacy alias only）。
   */
  mapItemArgumentDelta(params: CodexItemArgumentDeltaParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/argument/delta", params),
      rawProviderEvent: this.developerMode ? { method: "item/argument/delta (legacy)", params } : undefined,
      payload: {
        kind: "tool_start",
        toolName: "",
        toolInput: params.delta,
        callId: params.itemId,
      },
    };
  }

  // ---------- item/completed（官方 nested params.item） ----------

  /**
   * item/completed → message/tool_result/file_change（按 item.type 分发）。
   *
   * 支持官方 nested params.item 结构；旧 flat params 作为 legacy alias 兼容。
   */
  mapItemCompleted(params: CodexItemCompletedParams, changeIndex?: number): NormalizedRuntimeEvent | null {
    const ts = new Date().toISOString();
    const base = {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("item/completed", params),
      rawProviderEvent: this.developerMode ? { method: "item/completed", params } : undefined,
    };

    const item = params.item;
    const itemType = item?.type ?? params.type;
    const itemId = item?.id ?? params.itemId;
    if (!itemType) return null;

    switch (itemType) {
      case "agentMessage":
      case "message": {
        const amItem = item as Extract<CodexThreadItem, { type: "agentMessage" }> | undefined;
        const text = amItem?.text ?? params.text ?? "";
        return {
          ...base,
          payload: {
            kind: "message",
            role: "assistant",
            text,
            partial: false,
          },
        };
      }
      case "commandExecution": {
        const cmdItem = item as CodexCommandExecutionItem | undefined;
        const callId = itemId ?? params.callId ?? "";
        return {
          ...base,
          payload: {
            kind: "tool_result",
            callId,
            toolName: "Bash",
            output: cmdItem?.aggregatedOutput ?? params.text ?? "",
            isError: cmdItem?.status === "failed" || !!params.isError,
            exitCode: cmdItem?.exitCode,
            durationMs: cmdItem?.durationMs ?? params.durationMs,
          },
        };
      }
      case "tool_result": {
        // legacy alias
        return {
          ...base,
          payload: {
            kind: "tool_result",
            callId: params.callId ?? itemId ?? "",
            toolName: params.toolName ?? "unknown",
            output: params.text ?? "",
            isError: !!params.isError,
          },
        };
      }
      case "mcpToolCall": {
        const mcpItem = item as CodexMcpToolCallItem | undefined;
        const callId = itemId ?? params.callId ?? "";
        return {
          ...base,
          payload: {
            kind: "tool_result",
            callId,
            toolName: mcpItem?.tool ?? "mcp",
            output: mcpItem?.result !== undefined ? JSON.stringify(mcpItem.result) : "",
            isError: mcpItem?.status === "failed",
            durationMs: mcpItem?.durationMs,
            result: mcpItem?.result ?? mcpItem?.error,
          },
        };
      }
      case "dynamicToolCall": {
        const dynItem = item as CodexDynamicToolCallItem | undefined;
        const callId = itemId ?? params.callId ?? "";
        return {
          ...base,
          payload: {
            kind: "tool_result",
            callId,
            toolName: dynItem?.tool ?? "dynamic",
            output: dynItem?.contentItems !== undefined ? JSON.stringify(dynItem.contentItems) : "",
            isError: dynItem?.status === "failed" || dynItem?.success === false,
            durationMs: dynItem?.durationMs,
            contentItems: dynItem?.contentItems,
          },
        };
      }
      case "fileChange": {
        const fcItem = item as CodexFileChangeItem | undefined;
        // fileChange item 含 changes 数组（每条 path+kind+diff）；每个 change 映射为一条 file_change 事件。
        // mapper 保持纯函数 + 单事件语义：provider 在 onNotification 时遍历 changes 调多次，
        // 通过 changeIndex 指定本次返回第几条（默认 0）。
        if (fcItem?.changes && fcItem.changes.length > 0) {
          const change = fcItem.changes[changeIndex ?? 0];
          if (!change) return null;
          return {
            ...base,
            payload: {
              kind: "file_change",
              action: mapPatchChangeKind(change.kind),
              path: change.path,
              diff: change.diff,
              approvalStatus: fcItem.status === "declined" ? "declined" : fcItem.status === "completed" ? "approved" : undefined,
            },
          };
        }
        // flat 兼容
        return {
          ...base,
          payload: {
            kind: "file_change",
            action: params.fileAction ?? "modify",
            path: params.filePath ?? "",
          },
        };
      }
      case "file_change": {
        // legacy alias
        return {
          ...base,
          payload: {
            kind: "file_change",
            action: params.fileAction ?? "modify",
            path: params.filePath ?? "",
          },
        };
      }
      case "plan": {
        const planItem = item as Extract<CodexThreadItem, { type: "plan" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "plan",
            detail: planItem?.text ?? "completed",
            category: "thinking",
          },
        };
      }
      case "reasoning": {
        const reasoningItem = item as Extract<CodexThreadItem, { type: "reasoning" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "thinking",
            text: [...(reasoningItem?.summary ?? []), ...(reasoningItem?.content ?? [])].join("\n"),
          },
        };
      }
      case "webSearch": {
        const webItem = item as Extract<CodexThreadItem, { type: "webSearch" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "webSearch",
            detail: webItem?.query ?? "completed",
            category: "tool",
          },
        };
      }
      case "imageView": {
        const imageItem = item as Extract<CodexThreadItem, { type: "imageView" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "imageView",
            detail: imageItem?.path ?? "completed",
            category: "tool",
          },
        };
      }
      case "enteredReviewMode":
      case "exitedReviewMode": {
        const reviewItem = item as Extract<CodexThreadItem, { type: "enteredReviewMode" | "exitedReviewMode" }> | undefined;
        return {
          ...base,
          payload: {
            kind: "progress",
            label: itemType,
            detail: reviewItem?.review ?? itemType,
            category: "status",
          },
        };
      }
      case "contextCompaction": {
        return {
          ...base,
          payload: {
            kind: "progress",
            label: "contextCompaction",
            detail: "completed",
            category: "status",
          },
        };
      }
      case "tool_call":
        // tool_call completed 主要用于补全 toolInput；不再产生新事件
        //（tool_start 已在 item/started 时发出）
        return null;
      default:
        // plan/reasoning/webSearch/imageView/enteredReviewMode/exitedReviewMode/contextCompaction
        // completed 时不发独立事件（其 delta 已在 thinking 中累积）
        return null;
    }
  }

  // ---------- initialize / turn / thread 事件 ----------

  /** initialize 响应 → progress（handshake 完成） */
  mapInitialized(result: CodexInitializeResult): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    const detail = result.userAgent
      ?? result.version
      ?? result.protocolVersion
      ?? "initialized";
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("initialize", {}),
      rawProviderEvent: this.developerMode ? { method: "initialize", result } : undefined,
      payload: {
        kind: "progress",
        label: "initialized",
        detail,
        category: "status",
      },
    };
  }

  /** turn/started → progress（turn 启动） */
  mapTurnStarted(params: CodexTurnStartedParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("turn/started", { threadId: params.threadId, turnId: params.turn?.id }),
      rawProviderEvent: this.developerMode ? { method: "turn/started", params } : undefined,
      payload: {
        kind: "progress",
        label: "turn",
        detail: params.turn?.id,
        category: "status",
      },
    };
  }

  /**
   * serverRequest/resolved 通知 → approval_resolved（UI 同步）。
   *
   * 使用真实 requestId/threadId/turnId/itemId 更新 UI。
   * 官方 decision：accept/acceptForSession/decline/cancel 等。
   */
  mapServerRequestResolved(params: CodexServerRequestResolvedParams): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    const mapped = this.mapDecisionToApprovalResponse(params.decision ?? params.outcome);
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("serverRequest/resolved", params),
      rawProviderEvent: this.developerMode ? { method: "serverRequest/resolved", params } : undefined,
      payload: {
        kind: "approval_resolved",
        requestId: `codex-req-${params.requestId}`,
        response: mapped,
        source: "user",
      },
    };
  }

  /**
   * approval 已解决 → approval_resolved（由 provider 在回复 server-request 后调用）。
   *
   * response 参数沿用旧 allow/allowSession/deny/cancel 命名（内部表示），mapper 映射为 ApprovalResponse。
   */
  mapApprovalResolved(
    requestId: string,
    response: "allow" | "allowSession" | "deny" | "cancel",
    source: "user" | "session_allow" | "session_deny" | "mode",
  ): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    const mapped = this.mapLegacyOutcomeToApprovalResponse(response);
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("approval-resolved", { requestId }),
      rawProviderEvent: this.developerMode ? { method: "approval-resolved", requestId, response } : undefined,
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
      sourceRef: this.sourceRef("turn/completed", { threadId: params.threadId, turnId: params.turnId }),
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
      sourceRef: this.sourceRef("turn/failed", { threadId: params.threadId, turnId: params.turnId }),
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
      sourceRef: this.sourceRef("thread/start", { threadId }),
      rawProviderEvent: this.developerMode ? { method: "thread/start", threadId, sessionId } : undefined,
      payload: {
        kind: "session_started",
        text: threadId,
        sessionId,
      },
    };
  }

  /** thread/resume 响应 → session_started（resume 路径） */
  mapThreadResumed(threadId: string, sessionId?: string): NormalizedRuntimeEvent {
    const ts = new Date().toISOString();
    return {
      providerId: this.providerId,
      timestamp: ts,
      sourceRef: this.sourceRef("thread/resume", { threadId }),
      rawProviderEvent: this.developerMode ? { method: "thread/resume", threadId, sessionId } : undefined,
      payload: {
        kind: "session_started",
        text: threadId,
        sessionId,
      },
    };
  }

  // ---------- 内部：decision 映射 ----------

  /**
   * 把官方 decision（accept/acceptForSession/acceptWithExecpolicyAmendment/...）
   * 映射为 provider-neutral ApprovalResponse。
   *
   * - accept / acceptWithExecpolicyAmendment / applyNetworkPolicyAmendment → accept
   * - acceptForSession → acceptForSession
   * - decline → decline
   * - cancel → cancel
   * - 旧 outcome（allow/allowSession/deny）兼容映射
   */
  private mapDecisionToApprovalResponse(
    decision: string | undefined,
  ): import("../../core/types").ApprovalResponse {
    if (!decision) return { type: "decline" };
    switch (decision) {
      case "accept":
      case "acceptWithExecpolicyAmendment":
      case "applyNetworkPolicyAmendment":
        return { type: "accept" };
      case "acceptForSession":
        return { type: "acceptForSession" };
      case "decline":
        return { type: "decline" };
      case "cancel":
        return { type: "cancel" };
      // 旧 outcome 兼容
      case "allow":
        return { type: "accept" };
      case "allowSession":
        return { type: "acceptForSession" };
      case "deny":
        return { type: "decline" };
      default:
        return { type: "decline" };
    }
  }

  /**
   * 把旧 outcome（allow/allowSession/deny/cancel）映射为 ApprovalResponse。
   *
   * 内部表示沿用旧命名（provider handleApprovalRequest 回调用），mapper 统一映射。
   *
   * 任务3: 当 decision 缺失时返回 decline 仅作为最后安全兜底。
   * provider 层（serverRequest/resolved handler）已用本地 bookkeeping 回填 decision，
   * 禁止缺 decision 时把已 accept 的请求映射为 decline。
   * 此处的 decline 兜底只在本地无记录的异常情况下触发。
   */
  private mapLegacyOutcomeToApprovalResponse(
    outcome: "allow" | "allowSession" | "deny" | "cancel",
  ): import("../../core/types").ApprovalResponse {
    switch (outcome) {
      case "allow":
        return { type: "accept" };
      case "allowSession":
        return { type: "acceptForSession" };
      case "deny":
        return { type: "decline" };
      case "cancel":
        return { type: "cancel" };
    }
  }
}
