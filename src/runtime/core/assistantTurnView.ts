// LLM CLI Bridge — AssistantTurnView Builder (V2.17-A Completion)
//
// 从 NormalizedRuntimeEvent[] 聚合出 AssistantTurnView（UI 唯一消费的 turn 视图）。
//
// 聚合规则（与现有 RunStateAggregator 一致，但产出 AssistantTurnView 而非 TimelineNode）：
// - message partial=true (assistant, main agent)：累加到 finalAnswer
// - thinking：累加到单个 thinking block（始终 0 或 1 个）
// - progress category=thinking：只更新 thinking 标题 meta（不产生新段）
// - progress category=tool：附加到最近 running tool 段
// - progress 其他：作为 process 段
// - tool_start：upsert tool 段（status=running）
// - tool_result：更新 tool 段（status=done/error）
// - file_change：作为 fileChange 段（internal 路径过滤）
// - approval_request：作为 approval 段（pending=true）
// - approval_resolved：更新 approval 段（pending=false, resolution）
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
} from "./types";
import { isInternalFilePath } from "../../timelineAdapter";

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
  private thinkingBlock: ThoughtSegment | null = null;
  private readonly toolMap = new Map<string, ToolSegment>();
  private readonly toolOrder: string[] = [];
  private readonly processList: ProcessSegment[] = [];
  private readonly fileChangeList: FileChangeSegment[] = [];
  private readonly approvalMap = new Map<string, ApprovalSegment>();
  private readonly warnings: string[] = [];
  private readonly errors: string[] = [];
  private readonly rawProviderEvents: unknown[] = [];

  private endedAt: string | undefined;
  private durationMs: number | undefined;
  private terminalSessionId: string | undefined;

  constructor(turnId: string, providerId: import("./types").ProviderId, startedAt: string) {
    this.turnId = turnId;
    this.providerId = providerId;
    this.startedAt = startedAt;
  }

  ingest(event: NormalizedRuntimeEvent): AssistantTurnView {
    if (event.rawProviderEvent !== undefined) {
      this.rawProviderEvents.push(event.rawProviderEvent);
    }

    const p = event.payload;
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
        if (!this.thinkingBlock) {
          this.thinkingBlock = {
            timestamp: event.timestamp,
            text: p.text,
          };
        } else {
          this.thinkingBlock = {
            ...this.thinkingBlock,
            text: this.thinkingBlock.text + p.text,
          };
        }
        break;
      }

      case "progress": {
        if (p.category === "thinking") {
          // thinking_tokens：只更新 thinking 标题 meta
          if (!this.thinkingBlock) {
            this.thinkingBlock = { timestamp: event.timestamp, text: "" };
          }
          const meta = [p.label, p.detail].filter(Boolean).join(" · ") || undefined;
          this.thinkingBlock = {
            ...this.thinkingBlock,
            meta: meta ?? this.thinkingBlock.meta,
          };
          const tokenMatch = p.detail?.match(/~?(\d+)\s*tokens/i);
          if (tokenMatch) {
            this.thinkingBlock = {
              ...this.thinkingBlock,
              tokens: parseInt(tokenMatch[1], 10),
            };
          }
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
          this.finalAnswerBuffer += p.text;
        } else {
          // 完整快照
          if (this.finalAnswerBuffer.length === 0) {
            this.finalAnswerBuffer = p.text;
          } else if (this.finalAnswerBuffer === p.text) {
            // 重复快照：跳过
          } else if (p.text.endsWith(this.finalAnswerBuffer)) {
            this.finalAnswerBuffer = p.text;
          } else if (this.finalAnswerBuffer.endsWith(p.text)) {
            // buffer 已包含快照：跳过
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
        break;
      }

      case "file_change": {
        if (isInternalFilePath(p.path)) break;
        this.fileChangeList.push({
          timestamp: event.timestamp,
          action: p.action,
          path: p.path,
        });
        break;
      }

      case "approval_request": {
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
        break;
      }

      case "error": {
        if (p.recoverable) this.warnings.push(p.message);
        else this.errors.push(p.message);
        break;
      }

      case "stdout_delta": {
        // CLI 路径：stdout 增量累加到 finalAnswer（CLI 无 partial stream）
        // 注：final answer 始终由聚合器输出，不再由 view 旁路直接写 content
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
        // 若 completed 携带 text 且 finalAnswer 为空，用 completed text 兜底
        if (p.text && this.finalAnswerBuffer.length === 0) {
          this.finalAnswerBuffer = p.text;
        }
        break;
      }

      case "failed": {
        this.status = "failed";
        this.endedAt = event.timestamp;
        if (p.sessionId) this.terminalSessionId = p.sessionId;
        if (p.message) this.errors.push(p.message);
        break;
      }
    }

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
    const thoughts: ThoughtSegment[] = [];
    if (this.thinkingBlock && (this.thinkingBlock.text.trim().length > 0 || this.thinkingBlock.meta)) {
      thoughts.push(this.thinkingBlock);
    }
    return {
      turnId: this.turnId,
      providerId: this.providerId,
      status: this.status,
      process: this.processList,
      thoughts,
      tools: this.toolOrder.map((id) => this.toolMap.get(id)!).filter(Boolean),
      fileChanges: this.fileChangeList,
      approvals: Array.from(this.approvalMap.values()),
      finalAnswer: this.finalAnswerBuffer,
      warnings: this.warnings,
      errors: this.errors,
      rawProviderEvents: this.rawProviderEvents,
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
export function approvalResponseToLegacyChoice(response: ApprovalResponse): "allow_once" | "allow_session" | "deny_session" {
  switch (response.type) {
    case "accept": return "allow_once";
    case "acceptForSession": return "allow_session";
    case "decline": return "deny_session";
    case "cancel": return "deny_session";
  }
}
