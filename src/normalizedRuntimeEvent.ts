// LLM CLI Bridge — Normalized Runtime Event + AssistantTurnView (V2.17-A 续)
//
// Provider 原始事件先转 NormalizedRuntimeEvent；RunStateAggregator 直接消费 NormalizedRuntimeEvent；
// UI 只消费 AssistantTurnView。final answer 不再由 stdout_delta 旁路驱动。
//
// 设计原则：
// - NormalizedRuntimeEvent 是 provider-agnostic 的事件模型；SDK 的 WorkflowEvent 与 CLI/mock 的
//   AgentEvent 都先归一化为 NormalizedRuntimeEvent，再进入聚合器。
// - AssistantTurnView 是 UI 唯一消费的"一轮 assistant 回合"视图，含 finalAnswer / thinking / toolCalls /
//   fileChanges / warnings / errors / 终态。UI 不再读 raw SDK event log。
// - WorkflowEvent 保留为 legacy adapter（normalizeWorkflowEvent），但不再作为主 UI 模型。
// - final answer 来源：
//   - SDK 路径：assistant_text_delta（来自 SDK message partial text_delta），不读 stdout_delta。
//   - CLI/mock 路径：stdout_delta 归一化为 assistant_text_delta（CLI 无结构化事件，stdout 即最终答案）。
//     这不是"旁路驱动"，而是 CLI 的唯一来源。
// - tool_progress 合并到 toolCalls[i].progress，不作为独立节点，也不丢弃。

import type { AgentEvent } from "./agentBackend";
import type { RuntimeProviderId } from "./types";
import type {
  WorkflowEvent,
  MessageEvent,
  ToolStartEvent,
  ToolResultEvent,
  FileChangeEvent,
  PermissionEvent,
  ProgressEvent,
  ErrorEvent,
  CompletedEvent,
  FailedEvent,
} from "./workflowEvent";

// ---------- NormalizedRuntimeEvent ----------

/**
 * Provider-agnostic 归一化运行时事件。
 *
 * 所有 provider（claude-sdk / claude-cli / codex-sdk / mock）的原始事件都先归一化为本类型，
 * 再由 NormalizedRunStateAggregator 消费，产出 AssistantTurnView。
 */
export type NormalizedRuntimeEvent =
  | { readonly kind: "turn_started"; readonly timestamp: string }
  | { readonly kind: "thinking_delta"; readonly text: string; readonly timestamp: string }
  | { readonly kind: "thinking_tokens"; readonly tokens?: number; readonly label: string; readonly detail?: string; readonly timestamp: string }
  | { readonly kind: "assistant_text_delta"; readonly text: string; readonly timestamp: string }
  | { readonly kind: "assistant_text_snapshot"; readonly text: string; readonly timestamp: string }
  | { readonly kind: "tool_start"; readonly callId: string; readonly toolName: string; readonly toolInput: string; readonly parentToolUseId?: string; readonly sessionId?: string; readonly timestamp: string }
  | { readonly kind: "tool_progress"; readonly callId?: string; readonly label: string; readonly detail?: string; readonly timestamp: string }
  | { readonly kind: "tool_result"; readonly callId: string; readonly toolName: string; readonly output: string; readonly isError: boolean; readonly timestamp: string }
  | { readonly kind: "file_change"; readonly path: string; readonly action: "create" | "modify" | "delete"; readonly timestamp: string }
  | { readonly kind: "permission"; readonly toolName: string; readonly granted: boolean; readonly timestamp: string }
  | { readonly kind: "system_message"; readonly text: string; readonly timestamp: string }
  | { readonly kind: "subagent_message"; readonly text: string; readonly parentToolUseId?: string; readonly timestamp: string }
  | { readonly kind: "warning"; readonly message: string; readonly timestamp: string }
  | { readonly kind: "error"; readonly message: string; readonly timestamp: string }
  | { readonly kind: "turn_completed"; readonly text?: string; readonly durationMs?: number; readonly timestamp: string }
  | { readonly kind: "turn_failed"; readonly message: string; readonly recoverable: boolean; readonly timestamp: string };

// ---------- AssistantTurnView（UI 唯一消费） ----------

export interface AssistantToolCallProgressEntry {
  readonly label: string;
  readonly detail?: string;
  readonly timestamp: string;
}

export interface AssistantToolCallView {
  readonly callId: string;
  readonly toolName: string;
  readonly toolInput: string;
  readonly output?: string;
  readonly isError: boolean;
  readonly status: "running" | "done" | "error";
  readonly progress: ReadonlyArray<AssistantToolCallProgressEntry>;
  readonly startTime: string;
  readonly endTime?: string;
  readonly durationMs?: number;
  readonly parentToolUseId?: string;
  readonly sessionId?: string;
}

export interface AssistantThinkingView {
  readonly text: string;
  readonly tokens?: number;
  readonly meta?: string;
  readonly lastTimestamp: string;
}

export interface AssistantFileChangeView {
  readonly path: string;
  readonly action: "create" | "modify" | "delete";
  readonly timestamp: string;
}

export interface AssistantProcessNodeView {
  readonly label: string;
  readonly detail?: string;
  readonly category?: "request" | "thinking" | "tool" | "status" | "notice";
  readonly timestamp: string;
}

/**
 * 一轮 assistant 回合的 UI 视图。
 *
 * UI 只消费此类型；不再读 raw SDK event log / stdout_delta。
 * - finalAnswer: 来自 assistant_text_delta 累加（SDK=message partial text_delta；CLI=stdout_delta 归一化）
 * - toolCalls[i].progress: tool_progress 合并到工具节点，不作为独立节点
 * - rawProviderEvents: Developer mode 可见的原始事件（普通用户隐藏）
 */
export interface AssistantTurnView {
  readonly finalAnswer: string;
  readonly thinking: AssistantThinkingView | null;
  readonly toolCalls: ReadonlyArray<AssistantToolCallView>;
  readonly toolCallOrder: ReadonlyArray<string>;
  readonly fileChanges: ReadonlyArray<AssistantFileChangeView>;
  readonly permissionDenied: ReadonlyArray<{ readonly toolName: string; readonly timestamp: string }>;
  readonly warnings: ReadonlyArray<{ readonly message: string; readonly timestamp: string }>;
  readonly errors: ReadonlyArray<{ readonly message: string; readonly timestamp: string }>;
  readonly systemMessages: ReadonlyArray<{ readonly text: string; readonly timestamp: string }>;
  readonly subagentMessages: ReadonlyArray<{ readonly text: string; readonly parentToolUseId?: string; readonly timestamp: string }>;
  readonly processNodes: ReadonlyArray<AssistantProcessNodeView>;
  readonly status: "running" | "completed" | "failed";
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly durationMs?: number;
  /** Developer mode 可见的原始 provider 事件（普通用户隐藏） */
  readonly rawProviderEvents: ReadonlyArray<unknown>;
}

// ---------- Provider 归一化适配器 ----------

/**
 * 将 SDK 路径的 WorkflowEvent 归一化为 NormalizedRuntimeEvent。
 * WorkflowEvent 保留为 legacy adapter；新路径通过本函数桥接。
 */
export function normalizeWorkflowEvent(event: WorkflowEvent): NormalizedRuntimeEvent {
  const ts = event.timestamp;
  switch (event.type) {
    case "thinking":
      return { kind: "thinking_delta", text: event.text, timestamp: ts };
    case "message": {
      const me = event as MessageEvent;
      if (me.role === "system") {
        return { kind: "system_message", text: me.text, timestamp: ts };
      }
      if (me.parentToolUseId) {
        return { kind: "subagent_message", text: me.text, parentToolUseId: me.parentToolUseId, timestamp: ts };
      }
      // 主 agent message：partial → assistant_text_delta；快照 → assistant_text_snapshot
      if (me.partial) {
        return { kind: "assistant_text_delta", text: me.text, timestamp: ts };
      }
      return { kind: "assistant_text_snapshot", text: me.text, timestamp: ts };
    }
    case "tool_start": {
      const te = event as ToolStartEvent;
      return {
        kind: "tool_start",
        callId: te.callId,
        toolName: te.toolName,
        toolInput: te.toolInput,
        ...(te.parentToolUseId ? { parentToolUseId: te.parentToolUseId } : {}),
        ...(te.sessionId ? { sessionId: te.sessionId } : {}),
        timestamp: ts,
      };
    }
    case "tool_result": {
      const te = event as ToolResultEvent;
      return {
        kind: "tool_result",
        callId: te.callId,
        toolName: te.toolName,
        output: te.output,
        isError: te.isError,
        timestamp: ts,
      };
    }
    case "file_change": {
      const fe = event as FileChangeEvent;
      return { kind: "file_change", path: fe.path, action: fe.action, timestamp: ts };
    }
    case "permission": {
      const pe = event as PermissionEvent;
      return { kind: "permission", toolName: pe.toolName, granted: pe.granted, timestamp: ts };
    }
    case "progress": {
      const pe = event as ProgressEvent;
      if (pe.category === "thinking") {
        const tokenMatch = pe.detail?.match(/~?(\d+)\s*tokens/i);
        const tokens = tokenMatch ? parseInt(tokenMatch[1], 10) : undefined;
        return {
          kind: "thinking_tokens",
          ...(tokens !== undefined ? { tokens } : {}),
          label: pe.label,
          ...(pe.detail ? { detail: pe.detail } : {}),
          timestamp: ts,
        };
      }
      // tool / status / request / notice → tool_progress 或 process node
      return {
        kind: "tool_progress",
        label: pe.label,
        ...(pe.detail ? { detail: pe.detail } : {}),
        timestamp: ts,
      };
    }
    case "error": {
      const ee = event as ErrorEvent;
      return ee.recoverable
        ? { kind: "warning", message: ee.message, timestamp: ts }
        : { kind: "error", message: ee.message, timestamp: ts };
    }
    case "completed": {
      const ce = event as CompletedEvent;
      return {
        kind: "turn_completed",
        ...(ce.text ? { text: ce.text } : {}),
        ...(ce.durationMs !== undefined ? { durationMs: ce.durationMs } : {}),
        timestamp: ts,
      };
    }
    case "failed": {
      const fe = event as FailedEvent;
      return { kind: "turn_failed", message: fe.message, recoverable: fe.recoverable, timestamp: ts };
    }
  }
}

/**
 * 将 CLI/mock 路径的 AgentEvent 归一化为 NormalizedRuntimeEvent。
 *
 * CLI/mock 无结构化 WorkflowEvent；stdout_delta 归一化为 assistant_text_delta（CLI 的最终答案来源），
 * stderr_delta 归一化为 warning，终态归一化为 turn_completed / turn_failed。
 *
 * @returns NormalizedRuntimeEvent 或 null（started/stopped 不产生归一化事件，由调用方单独处理生命周期）
 */
export function normalizeAgentEvent(
  event: AgentEvent,
  provider: RuntimeProviderId,
): NormalizedRuntimeEvent | null {
  const ts = new Date().toISOString();
  switch (event.type) {
    case "started":
      return { kind: "turn_started", timestamp: ts };
    case "stdout_delta":
      // CLI/mock 路径：stdout 即最终答案文本（非旁路驱动，是 CLI 唯一来源）
      return { kind: "assistant_text_delta", text: event.data, timestamp: ts };
    case "stderr_delta":
      return { kind: "warning", message: event.data, timestamp: ts };
    case "completed":
      return {
        kind: "turn_completed",
        ...(event.stdout ? { text: event.stdout } : {}),
        durationMs: event.durationMs,
        timestamp: ts,
      };
    case "failed":
      return { kind: "turn_failed", message: event.stderr || `exit code ${event.exitCode}`, recoverable: false, timestamp: ts };
    case "stopped":
      return { kind: "turn_failed", message: "stopped by user", recoverable: false, timestamp: ts };
  }
  // provider 参数用于未来 codex-sdk 等差异化归一化（当前 CLI/mock 共用同一逻辑）
  void provider;
}

// ---------- NormalizedRunStateAggregator ----------

interface ToolCallAccumulator {
  callId: string;
  toolName: string;
  toolInput: string;
  output?: string;
  isError: boolean;
  status: "running" | "done" | "error";
  progress: AssistantToolCallProgressEntry[];
  startTime: string;
  endTime?: string;
  parentToolUseId?: string;
  sessionId?: string;
}

/**
 * 归一化运行时状态聚合器：消费 NormalizedRuntimeEvent，产出 AssistantTurnView。
 *
 * 替代 RunStateAggregator 在新路径的角色：
 * - final answer 来自 assistant_text_delta 累加（不读 stdout_delta）
 * - tool_progress 合并到 toolCalls[i].progress（不作为独立节点，也不丢弃）
 * - thinking 始终保持单个 block
 * - rawProviderEvents 保留原始事件供 Developer mode
 */
export class NormalizedRunStateAggregator {
  private finalAnswerBuffer = "";
  private thinking: AssistantThinkingView | null = null;
  private readonly toolCalls = new Map<string, ToolCallAccumulator>();
  private readonly toolCallOrder: string[] = [];
  private readonly fileChanges: AssistantFileChangeView[] = [];
  private readonly permissionDenied: Array<{ toolName: string; timestamp: string }> = [];
  private readonly warnings: Array<{ message: string; timestamp: string }> = [];
  private readonly errors: Array<{ message: string; timestamp: string }> = [];
  private readonly systemMessages: Array<{ text: string; timestamp: string }> = [];
  private readonly subagentMessages: Array<{ text: string; parentToolUseId?: string; timestamp: string }> = [];
  private readonly processNodes: AssistantProcessNodeView[] = [];
  private status: "running" | "completed" | "failed" = "running";
  private completedAt: string | undefined;
  private failedAt: string | undefined;
  private durationMs: number | undefined;
  private readonly rawProviderEvents: unknown[] = [];

  /** 摄入一个 NormalizedRuntimeEvent（不可逆） */
  ingest(event: NormalizedRuntimeEvent): void {
    this.rawProviderEvents.push(event);

    switch (event.kind) {
      case "turn_started":
        this.status = "running";
        break;

      case "thinking_delta":
        if (!this.thinking) {
          this.thinking = { text: event.text, lastTimestamp: event.timestamp };
        } else {
          this.thinking = {
            ...this.thinking,
            text: this.thinking.text + event.text,
            lastTimestamp: event.timestamp,
          };
        }
        break;

      case "thinking_tokens": {
        if (!this.thinking) {
          this.thinking = { text: "", lastTimestamp: event.timestamp };
        }
        const meta = [event.label, event.detail].filter(Boolean).join(" · ") || undefined;
        this.thinking = {
          ...this.thinking,
          ...(meta ? { meta } : {}),
          ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
          lastTimestamp: event.timestamp,
        };
        break;
      }

      case "assistant_text_delta":
        this.finalAnswerBuffer += event.text;
        break;

      case "assistant_text_snapshot":
        // 快照：若 buffer 为空则作为最终文本；若 buffer 是快照前缀则替换为完整快照；重复则跳过
        if (this.finalAnswerBuffer.length === 0) {
          this.finalAnswerBuffer = event.text;
        } else if (this.finalAnswerBuffer === event.text) {
          // 重复，跳过
        } else if (event.text.endsWith(this.finalAnswerBuffer)) {
          this.finalAnswerBuffer = event.text;
        } else if (this.finalAnswerBuffer.endsWith(event.text)) {
          // buffer 已包含快照，跳过
        } else {
          // 不同文本：作为附加 subagent 消息（罕见）
          this.subagentMessages.push({ text: event.text, timestamp: event.timestamp });
        }
        break;

      case "tool_start":
        if (!this.toolCalls.has(event.callId)) {
          const node: ToolCallAccumulator = {
            callId: event.callId,
            toolName: event.toolName,
            toolInput: event.toolInput,
            isError: false,
            status: "running",
            progress: [],
            startTime: event.timestamp,
            ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}),
            ...(event.sessionId ? { sessionId: event.sessionId } : {}),
          };
          this.toolCalls.set(event.callId, node);
          this.toolCallOrder.push(event.callId);
        }
        break;

      case "tool_progress": {
        // 优先匹配 callId；否则匹配最近 running 工具；否则作为 process node
        const targetById = event.callId ? this.toolCalls.get(event.callId) : undefined;
        const target = targetById ?? this.findRunningToolForProgress(event.label);
        if (target) {
          target.progress.push({
            label: event.label,
            ...(event.detail ? { detail: event.detail } : {}),
            timestamp: event.timestamp,
          });
        } else {
          this.pushProcessNode({
            label: event.label,
            ...(event.detail ? { detail: event.detail } : {}),
            timestamp: event.timestamp,
          });
        }
        break;
      }

      case "tool_result": {
        const existing = this.toolCalls.get(event.callId);
        if (existing) {
          existing.endTime = event.timestamp;
          existing.output = event.output;
          existing.isError = event.isError;
          existing.status = event.isError ? "error" : "done";
          if (!existing.toolName) existing.toolName = event.toolName;
        } else {
          // 孤儿 tool_result：创建补全节点
          const node: ToolCallAccumulator = {
            callId: event.callId,
            toolName: event.toolName || "unknown",
            toolInput: "",
            isError: event.isError,
            status: event.isError ? "error" : "done",
            progress: [],
            startTime: event.timestamp,
            endTime: event.timestamp,
            output: event.output,
          };
          this.toolCalls.set(event.callId, node);
          this.toolCallOrder.push(event.callId);
        }
        break;
      }

      case "file_change":
        this.fileChanges.push({ path: event.path, action: event.action, timestamp: event.timestamp });
        break;

      case "permission":
        if (!event.granted) {
          this.permissionDenied.push({ toolName: event.toolName, timestamp: event.timestamp });
        }
        break;

      case "system_message":
        this.systemMessages.push({ text: event.text, timestamp: event.timestamp });
        break;

      case "subagent_message":
        this.subagentMessages.push({
          text: event.text,
          ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}),
          timestamp: event.timestamp,
        });
        break;

      case "warning":
        this.warnings.push({ message: event.message, timestamp: event.timestamp });
        break;

      case "error":
        this.errors.push({ message: event.message, timestamp: event.timestamp });
        break;

      case "turn_completed":
        this.status = "completed";
        this.completedAt = event.timestamp;
        if (event.durationMs !== undefined) this.durationMs = event.durationMs;
        break;

      case "turn_failed":
        this.status = "failed";
        this.failedAt = event.timestamp;
        this.errors.push({ message: event.message, timestamp: event.timestamp });
        break;
    }
  }

  /** 批量摄入 */
  ingestAll(events: Iterable<NormalizedRuntimeEvent>): void {
    for (const ev of events) this.ingest(ev);
  }

  /** 查找最近一个 running 工具节点（用于附加 tool_progress） */
  private findRunningToolForProgress(label: string): ToolCallAccumulator | null {
    const labelLower = label.toLowerCase();
    // 优先匹配 label 含工具名的 running 工具
    for (let i = this.toolCallOrder.length - 1; i >= 0; i--) {
      const t = this.toolCalls.get(this.toolCallOrder[i]);
      if (t && t.status === "running") {
        const toolNameLower = t.toolName.toLowerCase();
        if (!toolNameLower || labelLower.includes(toolNameLower) || toolNameLower.includes(labelLower)) {
          return t;
        }
      }
    }
    // 无明确匹配：返回最后一个 running 工具
    for (let i = this.toolCallOrder.length - 1; i >= 0; i--) {
      const t = this.toolCalls.get(this.toolCallOrder[i]);
      if (t && t.status === "running") return t;
    }
    return null;
  }

  /** 合并连续同 label 的 process 节点 */
  private pushProcessNode(node: AssistantProcessNodeView): void {
    const last = this.processNodes[this.processNodes.length - 1];
    if (last && last.label === node.label) {
      const detail = node.detail ?? last.detail;
      this.processNodes[this.processNodes.length - 1] = {
        ...last,
        timestamp: node.timestamp,
        ...(detail ? { detail } : {}),
      };
    } else {
      this.processNodes.push(node);
    }
  }

  /** 产出 AssistantTurnView（UI 唯一消费） */
  toAssistantTurnView(): AssistantTurnView {
    const toolCalls: AssistantToolCallView[] = this.toolCallOrder.map((callId) => {
      const t = this.toolCalls.get(callId)!;
      const durationMs = t.endTime
        ? Math.max(0, new Date(t.endTime).getTime() - new Date(t.startTime).getTime())
        : undefined;
      return {
        callId: t.callId,
        toolName: t.toolName,
        toolInput: t.toolInput,
        ...(t.output !== undefined ? { output: t.output } : {}),
        isError: t.isError,
        status: t.status,
        progress: t.progress,
        startTime: t.startTime,
        ...(t.endTime ? { endTime: t.endTime } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(t.parentToolUseId ? { parentToolUseId: t.parentToolUseId } : {}),
        ...(t.sessionId ? { sessionId: t.sessionId } : {}),
      };
    });

    return {
      finalAnswer: this.finalAnswerBuffer,
      thinking: this.thinking,
      toolCalls,
      toolCallOrder: this.toolCallOrder,
      fileChanges: this.fileChanges,
      permissionDenied: this.permissionDenied,
      warnings: this.warnings,
      errors: this.errors,
      systemMessages: this.systemMessages,
      subagentMessages: this.subagentMessages,
      processNodes: this.processNodes,
      status: this.status,
      ...(this.completedAt ? { completedAt: this.completedAt } : {}),
      ...(this.failedAt ? { failedAt: this.failedAt } : {}),
      ...(this.durationMs !== undefined ? { durationMs: this.durationMs } : {}),
      rawProviderEvents: this.rawProviderEvents,
    };
  }

  /** 重置聚合器（新一轮运行前调用） */
  reset(): void {
    this.finalAnswerBuffer = "";
    this.thinking = null;
    this.toolCalls.clear();
    this.toolCallOrder.length = 0;
    this.fileChanges.length = 0;
    this.permissionDenied.length = 0;
    this.warnings.length = 0;
    this.errors.length = 0;
    this.systemMessages.length = 0;
    this.subagentMessages.length = 0;
    this.processNodes.length = 0;
    this.status = "running";
    this.completedAt = undefined;
    this.failedAt = undefined;
    this.durationMs = undefined;
    this.rawProviderEvents.length = 0;
  }
}

// ---------- 便利函数 ----------

/**
 * 从 WorkflowEvent[] 构建一次性的 AssistantTurnView（SDK 历史消息渲染用）。
 */
export function buildAssistantTurnViewFromWorkflowEvents(
  events: ReadonlyArray<WorkflowEvent>,
): AssistantTurnView {
  const agg = new NormalizedRunStateAggregator();
  for (const ev of events) {
    agg.ingest(normalizeWorkflowEvent(ev));
  }
  return agg.toAssistantTurnView();
}

/**
 * 从 AgentEvent[] 构建一次性的 AssistantTurnView（CLI/mock 历史消息渲染用）。
 */
export function buildAssistantTurnViewFromAgentEvents(
  events: ReadonlyArray<AgentEvent>,
  provider: RuntimeProviderId,
): AssistantTurnView {
  const agg = new NormalizedRunStateAggregator();
  for (const ev of events) {
    const normalized = normalizeAgentEvent(ev, provider);
    if (normalized) agg.ingest(normalized);
  }
  return agg.toAssistantTurnView();
}
