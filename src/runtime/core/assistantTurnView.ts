// LLM CLI Bridge — AssistantTurnView Builder (V2.17-A Completion)
//
// 从 NormalizedRuntimeEvent[] 聚合出 AssistantTurnView（UI 唯一消费的 turn 视图）。
//
// 聚合规则（与现有 RunStateAggregator 一致，但产出 AssistantTurnView 而非 TimelineNode）：
// - message partial=true (assistant, main agent)：累加到 finalAnswer
// - thinking：V16.4 多段 — 连续 thinking_delta 累加到当前段；穿插 tool/file_change 后再
//   出现 thinking 则开新段（不再压成单个 thinkingBlock）
// - progress category=thinking：更新最近一段 thinking 的 meta/tokens（不产生新段）
// - progress category=tool：附加到最近 running tool 段
// - progress 其他：作为 process 段
// - tool_start：upsert tool 段（status=running）
// - tool_result：更新 tool 段（status=done/error）
// - file_change：作为 fileChange 段（internal 路径过滤；V16.4 含 additions/deletions 若可获取）
// - approval_request：作为 approval 段（pending=true）
// - approval_resolved：更新 approval 段（pending=false, resolution）
// - user_input_request：作为 user input 段（pending=true）
// - user_input_resolved：更新 user input 段（pending=false, response）
// - error：recoverable→warnings，不可恢复→errors
// - stdout_delta：累加到 finalAnswer（CLI 路径，若 SDK 无 partial 时兜底）
//   注：final answer 始终由聚合器输出，不再由 stdout_delta 旁路直接写 content
// - completed/failed：标记终态
//
// UI 通过 toView() 拿到当前快照渲染；rawProviderEvents 仅在 developerMode 填充。

import type {
  ApprovalResponse,
  ApprovalSegment,
  AssistantTurnView,
  FileChangeSegment,
  NormalizedRuntimeEvent,
  ProcessSegment,
  ThoughtSegment,
  ToolSegment,
  UserInputRequestSegment,
} from "./types";
import type { ProviderLifecycleEvent } from "./providerLifecycleEvent";
import { isInternalFilePath } from "../../timelineAdapter";
import { CodexItemTimelineReducer } from "../providers/codex-app-server/codexItemTimeline";

function isUserInputApprovalTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "askuserquestion" || normalized === "request_user_input";
}

/**
 * AssistantTurnView 聚合器：从 NormalizedRuntimeEvent 流增量构建 AssistantTurnView。
 *
 * 每次 ingest 返回最新 AssistantTurnView 快照（UI 增量渲染用）。
 */
export class AssistantTurnViewBuilder {
  private readonly turnId: string;
  private readonly providerId: import("./types").ProviderId;
  private readonly startedAt: string;
  private status: AssistantTurnView["status"] = "running";

  private finalAnswerBuffer = "";
  private hasPartialMessages = false;
  // P4-D: 追踪是否已有 message 事件填充了 finalAnswer（partial 或 full snapshot）。
  // 用于 stdout_delta 去重：有 message 事件时 stdout_delta 是冗余副本，跳过。
  private hasMessageEvents = false;
  // V16.4-D: 多段 thinking — 基于稳定 key (messageId) 聚合
  // 规则：同一 messageId 的 thinking_delta 合并为一个 ThoughtSegment；
  //       progress / input_json_delta / tool progress 不打断同一 thinking block；
  //       新 SDKAssistantMessage（lastWasObservation=true）→ 新 messageId → 新段。
  private readonly thoughtsList: ThoughtSegment[] = [];
  // V16.4-D: 当前 thinking block 所属 messageId（稳定 key）。
  // null = 尚未有 thinking block；非 null = 当前可合并的 thinking block id。
  private currentThinkingMessageId: string | null = null;
  private readonly toolMap = new Map<string, ToolSegment>();
  private readonly toolOrder: string[] = [];
  private readonly processList: ProcessSegment[] = [];
  private readonly fileChangeList: FileChangeSegment[] = [];
  private readonly approvalMap = new Map<string, ApprovalSegment>();
  private readonly userInputMap = new Map<string, UserInputRequestSegment>();
  private readonly warnings: string[] = [];
  private readonly errors: string[] = [];
  private readonly rawProviderEvents: unknown[] = [];
  /**
   * V16.4: provider-native 生命周期事件。
   * 在 ingest() 时从 NormalizedRuntimeEvent 直接派生，保留 SDK agent loop 边界。
   * RunPhaseModel 优先消费此数组；buildLifecycleEventsFromTurnView 仅作 fallback。
   */
  private readonly lifecycleEventsList: ProviderLifecycleEvent[] = [];
  private readonly codexTimelineReducer: CodexItemTimelineReducer | null;
  // V16.4: 追踪上一个 lifecycle event 是否为 observation（tool_result）。
  // 用于判定下一个 thinking/tool_start 是否开启新的 SDKAssistantMessage（新 evaluation）。
  // 初始 true → 第一个 thinking/tool_start 发出 evaluation_started。
  private lastWasObservation = true;
  private thoughtMessageIdx = 0;

  private endedAt: string | undefined;
  private durationMs: number | undefined;
  private terminalSessionId: string | undefined;

  constructor(turnId: string, providerId: import("./types").ProviderId, startedAt: string) {
    this.turnId = turnId;
    this.providerId = providerId;
    this.codexTimelineReducer = providerId === "codex-app-server" || providerId === "codex-managed-app-server"
      ? new CodexItemTimelineReducer()
      : null;
    this.startedAt = startedAt;
    // session_started + run_started 作为 lifecycle 序列的起始
    this.lifecycleEventsList.push(
      { type: "session_started", providerId, timestamp: startedAt },
      { type: "run_started", providerId, timestamp: startedAt },
    );
  }

  ingest(event: NormalizedRuntimeEvent): AssistantTurnView {
    this.codexTimelineReducer?.ingest(event);
    if (event.rawProviderEvent !== undefined) {
      this.rawProviderEvents.push(event.rawProviderEvent);
    }

    const p = event.payload;
    // V16.4-D: thinking 聚合基于稳定 key (messageId)，不再依赖 lastThinkingTick。
    // progress / input_json_delta / tool progress 不打断同一 thinking block。
    switch (p.kind) {
      case "session_started":
        // session_started 不直接展示在普通用户态；作为 process 段记录
        this.processList.push({
          timestamp: event.timestamp,
          label: "Session started",
          detail: p.text,
          category: "status",
        });
        break;

      case "thinking": {
        // V16.4-D: 基于稳定 key (messageId) 聚合。
        // 新 messageId 仅在 lastWasObservation=true（新 SDKAssistantMessage）时合成。
        // progress / input_json_delta / tool progress 不打断同一 thinking block。
        const isNewThinkingMessage = this.lastWasObservation || this.currentThinkingMessageId === null;
        if (isNewThinkingMessage) {
          this.currentThinkingMessageId = `msg-${this.thoughtMessageIdx++}`;
          this.lifecycleEventsList.push(
            { type: "evaluation_started", providerId: this.providerId, timestamp: event.timestamp, messageId: this.currentThinkingMessageId },
            { type: "reasoning_section_started", providerId: this.providerId, timestamp: event.timestamp, messageId: this.currentThinkingMessageId },
          );
          this.thoughtsList.push({
            timestamp: event.timestamp,
            text: p.text,
            messageId: this.currentThinkingMessageId,
            contentBlockIndex: 0,
          });
        } else {
          // 同一 messageId 内的 thinking_delta → 合并到最后一段（稳定 key 保证不被 progress 切碎）
          const last = this.thoughtsList[this.thoughtsList.length - 1];
          if (last && last.messageId === this.currentThinkingMessageId) {
            last.text = last.text + p.text;
          } else {
            // fallback：messageId 不匹配（理论不应发生），开新段
            this.thoughtsList.push({
              timestamp: event.timestamp,
              text: p.text,
              messageId: this.currentThinkingMessageId ?? undefined,
              contentBlockIndex: 0,
            });
          }
        }
        this.lifecycleEventsList.push({
          type: "reasoning_summary_delta",
          providerId: this.providerId,
          timestamp: event.timestamp,
          text: p.text,
          messageId: this.currentThinkingMessageId ?? undefined,
        });
        this.lastWasObservation = false;
        break;
      }

      case "progress": {
        if (p.category === "thinking") {
          // V16.4-D: thinking_tokens — 更新最近一段 thinking 的 meta/tokens（不产生新段，不打断 thinking block）
          // 若无 thinking 段，创建一个占位段（synth messageId 以保持稳定 key）
          if (this.thoughtsList.length === 0) {
            if (this.currentThinkingMessageId === null) {
              this.currentThinkingMessageId = `msg-${this.thoughtMessageIdx++}`;
              this.lifecycleEventsList.push(
                { type: "evaluation_started", providerId: this.providerId, timestamp: event.timestamp, messageId: this.currentThinkingMessageId },
                { type: "reasoning_section_started", providerId: this.providerId, timestamp: event.timestamp, messageId: this.currentThinkingMessageId },
              );
            }
            this.thoughtsList.push({
              timestamp: event.timestamp,
              text: "",
              messageId: this.currentThinkingMessageId,
              contentBlockIndex: 0,
            });
          }
          const last = this.thoughtsList[this.thoughtsList.length - 1];
          const meta = [p.label, p.detail].filter(Boolean).join(" · ") || undefined;
          last.meta = meta ?? last.meta;
          const tokenMatch = p.detail?.match(/~?(\d+)\s*tokens/i);
          if (tokenMatch) {
            last.tokens = parseInt(tokenMatch[1], 10);
          }
          // V16.4-D: progress-thinking 不改变 currentThinkingMessageId / lastWasObservation
          // （thinking block 保持连续，不被 progress 切碎）
        } else if (p.category === "tool") {
          const target = this.findRunningTool();
          if (target) {
            const updated: ToolSegment = {
              ...target,
              progress: [...target.progress, { label: p.label, detail: p.detail, timestamp: event.timestamp }],
            };
            this.toolMap.set(target.callId, updated);
          } else {
            this.pushProcess({
              timestamp: event.timestamp,
              label: p.label,
              detail: p.detail,
              category: p.category,
            });
          }
        } else {
          this.pushProcess({
            timestamp: event.timestamp,
            label: p.label,
            detail: p.detail,
            category: p.category,
          });
        }
        break;
      }

      case "message": {
        if (p.role === "system") {
          this.processList.push({
            timestamp: event.timestamp,
            label: "System",
            detail: p.text,
            category: "notice",
          });
        } else if (p.parentToolUseId) {
          // subagent 文本：作为 process 段
          this.processList.push({
            timestamp: event.timestamp,
            label: "Subagent",
            detail: p.text,
            category: "status",
          });
        } else if (p.partial) {
          // 主 agent partial text_delta：累加到 finalAnswer
          this.hasPartialMessages = true;
          this.hasMessageEvents = true;
          this.finalAnswerBuffer += p.text;
        } else {
          // 完整快照
          if (this.finalAnswerBuffer.length === 0) {
            this.finalAnswerBuffer = p.text;
            this.hasMessageEvents = true;
          } else if (this.finalAnswerBuffer === p.text) {
            // 重复快照：跳过
          } else if (p.text.startsWith(this.finalAnswerBuffer)) {
            // 累积快照：新快照以 buffer 为前缀（累积增长），替换
            this.finalAnswerBuffer = p.text;
            this.hasMessageEvents = true;
          } else if (this.finalAnswerBuffer.startsWith(p.text)) {
            // buffer 已包含新快照（新快照是旧前缀）：跳过
          } else {
            // 不同文本：作为 process 段
            this.processList.push({
              timestamp: event.timestamp,
              label: "Assistant",
              detail: p.text,
              category: "status",
            });
          }
        }
        break;
      }

      case "tool_start": {
        if (!this.toolMap.has(p.callId)) {
          const seg: ToolSegment = {
            callId: p.callId,
            toolName: p.toolName,
            toolInput: p.toolInput,
            startTime: event.timestamp,
            isError: false,
            status: "running",
            progress: [],
            parentToolUseId: p.parentToolUseId,
            sessionId: p.sessionId,
          };
          this.toolMap.set(p.callId, seg);
          this.toolOrder.push(p.callId);
        }
        // V16.4-D: provider-native lifecycle —— 若上一事件是 observation（tool_result），
        // 此 tool_start 属于新的 SDKAssistantMessage，发出 evaluation_started 边界并更新 currentThinkingMessageId。
        // 同一 SDKAssistantMessage 内的多个 tool_use（连续 tool_start 无 tool_result）不发新边界。
        if (this.lastWasObservation) {
          this.currentThinkingMessageId = `msg-${this.thoughtMessageIdx++}`;
          this.lifecycleEventsList.push(
            { type: "evaluation_started", providerId: this.providerId, timestamp: event.timestamp, messageId: this.currentThinkingMessageId },
          );
        }
        this.lifecycleEventsList.push({
          type: "tool_started",
          providerId: this.providerId,
          timestamp: event.timestamp,
          toolUseId: p.callId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          parentToolUseId: p.parentToolUseId,
          sessionId: p.sessionId,
          toolStatus: "running",
        });
        this.lastWasObservation = false;
        break;
      }

      case "tool_result": {
        const existing = this.toolMap.get(p.callId);
        if (existing) {
          const durationMs = new Date(event.timestamp).getTime() - new Date(existing.startTime).getTime();
          this.toolMap.set(p.callId, {
            ...existing,
            endTime: event.timestamp,
            durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
            output: p.output,
            isError: p.isError,
            status: p.isError ? "error" : "done",
            toolName: existing.toolName || p.toolName,
          });
        } else {
          // 孤儿 tool_result
          const seg: ToolSegment = {
            callId: p.callId,
            toolName: p.toolName || "unknown",
            toolInput: "",
            startTime: event.timestamp,
            endTime: event.timestamp,
            output: p.output,
            isError: p.isError,
            status: p.isError ? "error" : "done",
            progress: [],
          };
          this.toolMap.set(p.callId, seg);
          this.toolOrder.push(p.callId);
        }
        // V16.4: provider-native lifecycle —— tool_result = observation_received
        this.lifecycleEventsList.push(
          {
            type: p.isError ? "tool_failed" : "tool_completed",
            providerId: this.providerId,
            timestamp: event.timestamp,
            toolUseId: p.callId,
            toolName: p.toolName,
            toolOutput: p.output,
            toolStatus: p.isError ? "error" : "done",
          },
          {
            type: "observation_received",
            providerId: this.providerId,
            timestamp: event.timestamp,
            toolUseId: p.callId,
            toolName: p.toolName,
            text: p.output,
          },
        );
        this.lastWasObservation = true;
        break;
      }

      case "file_change": {
        if (isInternalFilePath(p.path)) break;
        // V16.4: 透传 additions/deletions（来自 provider mapper；可能 undefined）
        const additions = (p as { additions?: number }).additions;
        const deletions = (p as { deletions?: number }).deletions;
        const fcSeg: FileChangeSegment = {
          timestamp: event.timestamp,
          action: p.action,
          path: p.path,
          ...(typeof additions === "number" && additions >= 0 ? { additions } : {}),
          ...(typeof deletions === "number" && deletions >= 0 ? { deletions } : {}),
        };
        this.fileChangeList.push(fcSeg);
        // V16.4: provider-native lifecycle —— file_change = action_completed
        this.lifecycleEventsList.push({
          type: "action_completed",
          providerId: this.providerId,
          timestamp: event.timestamp,
          fileAction: p.action,
          filePath: p.path,
          additions: typeof additions === "number" ? additions : undefined,
          deletions: typeof deletions === "number" ? deletions : undefined,
        });
        break;
      }

      case "approval_request": {
        if (isUserInputApprovalTool(p.toolName)) {
          const seg: UserInputRequestSegment = {
            requestId: p.requestId,
            toolName: p.toolName,
            prompt: p.description || p.inputSummary || p.toolName,
            timestamp: event.timestamp,
            pending: true,
          };
          this.userInputMap.set(p.requestId, seg);
          this.lifecycleEventsList.push({
            type: "user_input_requested",
            providerId: this.providerId,
            timestamp: event.timestamp,
            approvalId: p.requestId,
            toolName: p.toolName,
            label: seg.prompt,
          });
          break;
        }

        const seg: ApprovalSegment = {
          requestId: p.requestId,
          toolName: p.toolName,
          description: p.description,
          riskLevel: p.riskLevel,
          riskReason: p.riskReason,
          highRiskFlags: p.highRiskFlags,
          inputSummary: p.inputSummary,
          mergeKey: p.mergeKey,
          parentToolUseId: p.parentToolUseId,
          subagentRisk: p.subagentRisk,
          pending: true,
        };
        this.approvalMap.set(p.requestId, seg);
        // V16.4: provider-native lifecycle —— approval_request = approval_requested
        this.lifecycleEventsList.push({
          type: "approval_requested",
          providerId: this.providerId,
          timestamp: event.timestamp,
          approvalId: p.requestId,
          toolName: p.toolName,
          label: p.description,
        });
        break;
      }

      case "approval_resolved": {
        const existing = this.approvalMap.get(p.requestId);
        if (existing) {
          this.approvalMap.set(p.requestId, {
            ...existing,
            pending: false,
            resolution: p.response,
            resolutionSource: p.source,
          });
        }
        // V16.4: provider-native lifecycle —— approval_resolved
        this.lifecycleEventsList.push({
          type: "approval_resolved",
          providerId: this.providerId,
          timestamp: event.timestamp,
          approvalId: p.requestId,
          approvalResolution: p.response?.type,
          toolName: existing?.toolName,
        });
        break;
      }

      case "user_input_request": {
        const seg: UserInputRequestSegment = {
          requestId: p.requestId,
          toolName: p.toolName,
          prompt: p.prompt,
          timestamp: event.timestamp,
          inputType: p.inputType,
          questions: p.questions,
          placeholder: p.placeholder,
          pending: true,
        };
        this.userInputMap.set(p.requestId, seg);
        this.lifecycleEventsList.push({
          type: "user_input_requested",
          providerId: this.providerId,
          timestamp: event.timestamp,
          approvalId: p.requestId,
          toolName: p.toolName,
          label: p.prompt,
        });
        break;
      }

      case "user_input_resolved": {
        const existing = this.userInputMap.get(p.requestId);
        if (existing) {
          this.userInputMap.set(p.requestId, {
            ...existing,
            pending: false,
            response: p.response,
            resolutionSource: p.source,
          });
        }
        this.lifecycleEventsList.push({
          type: "user_input_resolved",
          providerId: this.providerId,
          timestamp: event.timestamp,
          approvalId: p.requestId,
          label: p.response.type === "submit" ? p.response.value : "cancelled",
          toolName: existing?.toolName,
        });
        break;
      }

      case "error": {
        if (p.recoverable) this.warnings.push(p.message);
        else this.errors.push(p.message);
        break;
      }

      case "stdout_delta": {
        // CLI 路径：stdout 增量累加到 finalAnswer（CLI 无 message stream）
        // SDK 路径：message 事件已是 source of truth，stdout_delta 是冗余副本，跳过
        // P4-D: 用 hasMessageEvents 覆盖 partial 和 full snapshot 两种情况
        if (this.hasMessageEvents) break;
        this.finalAnswerBuffer += p.data;
        break;
      }

      case "stderr_delta": {
        // stderr 作为 warning 段
        this.warnings.push(p.data);
        break;
      }

      case "completed": {
        this.status = "completed";
        this.endedAt = event.timestamp;
        if (p.durationMs !== undefined) this.durationMs = p.durationMs;
        if (p.sessionId) this.terminalSessionId = p.sessionId;
        if (p.text) {
          if (this.finalAnswerBuffer.length === 0) {
            // 无文本：用 completed text 兜底
            this.finalAnswerBuffer = p.text;
          } else if (this.hasPartialMessages && p.text.startsWith(this.finalAnswerBuffer)) {
            // SDK 路径 reconcile：completed text 是 partial 累加的超集，替换为完整快照
            this.finalAnswerBuffer = p.text;
          }
        }
        // V16.4: provider-native lifecycle —— 终态 assistant_message + result
        if (this.finalAnswerBuffer.length > 0) {
          this.lifecycleEventsList.push({
            type: "assistant_message",
            providerId: this.providerId,
            timestamp: event.timestamp,
            text: this.finalAnswerBuffer,
          });
        }
        this.lifecycleEventsList.push({
          type: "result",
          providerId: this.providerId,
          timestamp: event.timestamp,
          sessionId: p.sessionId,
        });
        break;
      }

      case "failed": {
        this.status = "failed";
        this.endedAt = event.timestamp;
        if (p.sessionId) this.terminalSessionId = p.sessionId;
        if (p.message) this.errors.push(p.message);
        // V16.4: provider-native lifecycle —— 终态 result（含 error）
        this.lifecycleEventsList.push({
          type: "result",
          providerId: this.providerId,
          timestamp: event.timestamp,
          error: p.message,
          sessionId: p.sessionId,
        });
        break;
      }
    }

    // V16.4-D: thinking 聚合基于稳定 key (messageId)，无需 lastThinkingTick 维护。
    return this.toView();
  }

  /** 批量摄入，返回最终 view */
  ingestAll(events: Iterable<NormalizedRuntimeEvent>): AssistantTurnView {
    let view: AssistantTurnView | null = null;
    for (const ev of events) {
      view = this.ingest(ev);
    }
    return view ?? this.toView();
  }

  /** 标记为 stopped（用户取消） */
  markStopped(): AssistantTurnView {
    this.status = "stopped";
    this.endedAt = new Date().toISOString();
    return this.toView();
  }

  /** 当前快照 */
  toView(): AssistantTurnView {
    // V16.4: 多段 thoughts — 仅保留有 text 或 meta 的段（过滤空 meta 占位）
    const thoughts: ThoughtSegment[] = this.thoughtsList.filter(
      (t) => t.text.trim().length > 0 || (t.meta !== undefined && t.meta.length > 0),
    );
    return {
      turnId: this.turnId,
      providerId: this.providerId,
      status: this.status,
      process: this.processList,
      thoughts,
      tools: this.toolOrder.map((id) => this.toolMap.get(id)!).filter(Boolean),
      fileChanges: this.fileChangeList,
      approvals: Array.from(this.approvalMap.values()),
      userInputRequests: Array.from(this.userInputMap.values()),
      turnTimeline: this.codexTimelineReducer?.toNodes() ?? [],
      finalAnswer: this.finalAnswerBuffer,
      warnings: this.warnings,
      errors: this.errors,
      rawProviderEvents: this.rawProviderEvents,
      lifecycleEvents: this.lifecycleEventsList,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: this.durationMs,
      terminalSessionId: this.terminalSessionId,
    };
  }

  private findRunningTool(): ToolSegment | null {
    for (let i = this.toolOrder.length - 1; i >= 0; i--) {
      const t = this.toolMap.get(this.toolOrder[i]);
      if (t && t.status === "running") return t;
    }
    return null;
  }

  private pushProcess(seg: ProcessSegment): void {
    const last = this.processList[this.processList.length - 1];
    if (last && last.label === seg.label && last.category === seg.category) {
      this.processList[this.processList.length - 1] = {
        ...last,
        timestamp: seg.timestamp,
        detail: seg.detail ?? last.detail,
      };
    } else {
      this.processList.push(seg);
    }
  }
}

/**
 * 便利函数：从 NormalizedRuntimeEvent[] 一次性构建 AssistantTurnView。
 */
export function buildAssistantTurnViewFromEvents(
  turnId: string,
  providerId: import("./types").ProviderId,
  events: Iterable<NormalizedRuntimeEvent>,
  startedAt: string,
): AssistantTurnView {
  const builder = new AssistantTurnViewBuilder(turnId, providerId, startedAt);
  return builder.ingestAll(events);
}

/**
 * 把 ApprovalResponse 映射回旧 PermissionChoice（兼容现有 view.ts resolvePermissionRequests）。
 *
 * 迁移期辅助；新代码应直接用 ApprovalResponse。
 */
export function approvalResponseToLegacyChoice(response: ApprovalResponse): "allow_once" | "allow_session" | "deny_once" | "deny_session" {
  switch (response.type) {
    case "accept": return "allow_once";
    case "acceptForSession": return "allow_session";
    case "decline": return "deny_once";
    case "declineForSession": return "deny_session";
    case "cancel": return "deny_session";
  }
}
