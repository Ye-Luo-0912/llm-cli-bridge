// LLM CLI Bridge — Runtime Transcript (V2.17-A Runtime Semantics & Agent UX Consolidation)
// 聚合 WorkflowEvent[] 为 RuntimeTranscript，避免直接 WorkflowEvent[] -> TimelineNode[]
//
// 聚合规则：
// - text_delta (message partial=true, role=assistant, main agent)：累加到 finalAnswerBuffer
// - thinking_delta (thinking event)：累加到单个 thinking block（始终保持 1 个）
// - thinking_tokens (progress category=thinking)：只更新 thinking 标题 meta
// - tool_start：按 callId upsert 工具节点（status=running）
// - tool_progress (progress category=tool)：附加到最近 running 工具节点（合并到同一 node）
// - tool_result：按 callId 更新工具节点（status=done/error）
// - SDKResultMessage success：只标记 completed，不生成重复 message（mapper 已修正）
// - session_started / runtime file tools / raw log：默认仅 Developer mode 可见
//
// 输出：
// - toTimelineNodes()：聚合后的 TimelineNode[]（用于 UI 渲染）
// - toTranscript()：聚合状态快照（包含 finalAnswerBuffer / thinkingBlock / toolNodes 等）
// - toRawEvents()：原始 WorkflowEvent[]（用于 Developer mode raw log）

import {
  WorkflowEvent,
  MessageEvent,
  ProgressEvent,
  FileChangeEvent,
  PermissionEvent,
  ErrorEvent,
  CompletedEvent,
  FailedEvent,
} from "./workflowEvent";
import { TimelineNode, isInternalFilePath } from "./timelineAdapter";
import type { AssistantTurnView, AssistantToolCallView } from "./normalizedRuntimeEvent";

// ---------- 聚合状态类型 ----------

export interface ThinkingBlockState {
  text: string;
  /** thinking_tokens（latest estimated_tokens） */
  tokens?: number;
  /** 标题附加 meta（如 "~120 tokens · +5"） */
  meta?: string;
  lastTimestamp: string;
}

export interface ToolNodeState {
  callId: string;
  toolName: string;
  toolInput: string;
  startTime: string;
  endTime?: string;
  output?: string;
  isError: boolean;
  status: "running" | "done" | "error";
  /** tool_progress 条目（按时间顺序） */
  progress: ReadonlyArray<{ label: string; detail?: string; timestamp: string }>;
  parentToolUseId?: string;
  sessionId?: string;
}

export interface RuntimeTranscript {
  /** partial text_delta 累加的主 agent 最终答案 buffer */
  finalAnswerBuffer: string;
  /** 单个 thinking block（始终 0 或 1 个） */
  thinkingBlock: ThinkingBlockState | null;
  /** 工具节点（按 callId 索引） */
  toolNodes: ReadonlyMap<string, ToolNodeState>;
  /** 工具 callId 插入顺序（保证渲染稳定） */
  toolOrder: ReadonlyArray<string>;
  /** 非 tool/thinking 的进度节点（status/request/notice） */
  processNodes: ReadonlyArray<ProgressEvent>;
  /** SDK session started（init）消息，仅 Developer mode 可见 */
  sessionStarted: MessageEvent | null;
  /** 其他系统消息（status / compact_boundary 等） */
  systemMessages: ReadonlyArray<MessageEvent>;
  /** subagent 文本消息（parentToolUseId != null） */
  subagentMessages: ReadonlyArray<MessageEvent>;
  /** 文件变更（含 internal 路径，由 toTimelineNodes 过滤） */
  fileChanges: ReadonlyArray<FileChangeEvent>;
  /** 权限拒绝事件 */
  permissionDenied: ReadonlyArray<PermissionEvent>;
  /** 可恢复错误（降级为 warning） */
  warnings: ReadonlyArray<ErrorEvent>;
  /** 不可恢复错误 */
  errors: ReadonlyArray<ErrorEvent>;
  /** 工作流成功终态 */
  completed: CompletedEvent | null;
  /** 工作流失败终态 */
  failed: FailedEvent | null;
  /** 是否已收到终态事件（completed 或 failed） */
  isTerminal: boolean;
}

// ---------- RunStateAggregator ----------

/**
 * 状态聚合器：将 WorkflowEvent[] 聚合为 RuntimeTranscript / TimelineNode[]
 *
 * 替代 timelineAdapter.adaptEventsToTimeline 的脆弱文本去重与多 thinking block 问题：
 * - thinking 始终保持单个 block（即使多次 thinking_delta）
 * - tool_progress 合并到对应工具节点，不再作为独立 progress 节点
 * - SDKResultMessage success 不生成重复 message（mapper 层修正）
 */
export class RunStateAggregator {
  private finalAnswerBuffer = "";
  private thinkingBlock: ThinkingBlockState | null = null;
  private readonly toolNodes = new Map<string, ToolNodeState>();
  private readonly toolOrder: string[] = [];
  private readonly processNodes: ProgressEvent[] = [];
  private sessionStarted: MessageEvent | null = null;
  private readonly systemMessages: MessageEvent[] = [];
  private readonly subagentMessages: MessageEvent[] = [];
  private readonly fileChanges: FileChangeEvent[] = [];
  private readonly permissionDenied: PermissionEvent[] = [];
  private readonly warnings: ErrorEvent[] = [];
  private readonly errors: ErrorEvent[] = [];
  private completed: CompletedEvent | null = null;
  private failed: FailedEvent | null = null;
  private readonly rawEvents: WorkflowEvent[] = [];

  /** 摄入一个 WorkflowEvent，更新聚合状态（不可逆） */
  ingest(event: WorkflowEvent): void {
    this.rawEvents.push(event);

    switch (event.type) {
      case "thinking": {
        // 始终累加到同一个 thinking block（保持单个）
        if (!this.thinkingBlock) {
          this.thinkingBlock = {
            text: event.text,
            lastTimestamp: event.timestamp,
          };
        } else {
          this.thinkingBlock = {
            ...this.thinkingBlock,
            text: this.thinkingBlock.text + event.text,
            lastTimestamp: event.timestamp,
          };
        }
        break;
      }

      case "progress": {
        if (event.category === "thinking") {
          // thinking_tokens：只更新 thinking 标题 meta，不产生新节点
          if (!this.thinkingBlock) {
            this.thinkingBlock = { text: "", lastTimestamp: event.timestamp };
          }
          const meta = [event.label, event.detail].filter(Boolean).join(" · ") || undefined;
          this.thinkingBlock = {
            ...this.thinkingBlock,
            meta: meta ?? this.thinkingBlock.meta,
            lastTimestamp: event.timestamp,
          };
          // 尝试从 detail 解析 token 数（如 "~120 tokens"）
          const tokenMatch = event.detail?.match(/~?(\d+)\s*tokens/i);
          if (tokenMatch) {
            this.thinkingBlock = {
              ...this.thinkingBlock,
              tokens: parseInt(tokenMatch[1], 10),
            };
          }
        } else if (event.category === "tool") {
          // tool_progress：附加到最近 running 工具节点（合并到同一 node）
          const targetTool = this.findRunningToolForProgress(event);
          if (targetTool) {
            const updated: ToolNodeState = {
              ...targetTool,
              progress: [...targetTool.progress, {
                label: event.label,
                detail: event.detail,
                timestamp: event.timestamp,
              }],
            };
            this.toolNodes.set(targetTool.callId, updated);
          } else {
            // 无匹配 running tool：作为普通 progress 节点
            this.pushProcessNode(event);
          }
        } else {
          this.pushProcessNode(event);
        }
        break;
      }

      case "message": {
        if (event.role === "system") {
          // SDK init → sessionStarted；其他 system 消息（compact_boundary 等）→ systemMessages
          if (!this.sessionStarted && /SDK session started/i.test(event.text)) {
            this.sessionStarted = event;
          } else {
            this.systemMessages.push(event);
          }
        } else if (event.parentToolUseId) {
          // subagent 文本：作为 agent 节点展示
          this.subagentMessages.push(event);
        } else if (event.partial) {
          // 主 agent partial text_delta：累加到 finalAnswerBuffer
          this.finalAnswerBuffer += event.text;
        } else {
          // 主 agent 完整快照（SDKAssistantMessage text block）
          if (this.finalAnswerBuffer.length === 0) {
            // 非流式模式：快照作为最终文本
            this.finalAnswerBuffer = event.text;
          } else if (this.finalAnswerBuffer === event.text) {
            // 流式累加 + 快照重复：跳过
          } else if (event.text.endsWith(this.finalAnswerBuffer)) {
            // 快照包含 buffer（流式可能丢失部分 delta）：用完整快照替换
            this.finalAnswerBuffer = event.text;
          } else if (this.finalAnswerBuffer.endsWith(event.text)) {
            // buffer 已包含快照（罕见）：跳过
          } else {
            // 不同文本：作为附加消息（罕见，subagent 场景已分流）
            this.subagentMessages.push(event);
          }
        }
        break;
      }

      case "tool_start": {
        if (!this.toolNodes.has(event.callId)) {
          const node: ToolNodeState = {
            callId: event.callId,
            toolName: event.toolName,
            toolInput: event.toolInput,
            startTime: event.timestamp,
            isError: false,
            status: "running",
            progress: [],
            parentToolUseId: event.parentToolUseId,
            sessionId: event.sessionId,
          };
          this.toolNodes.set(event.callId, node);
          this.toolOrder.push(event.callId);
        }
        break;
      }

      case "tool_result": {
        const existing = this.toolNodes.get(event.callId);
        if (existing) {
          this.toolNodes.set(event.callId, {
            ...existing,
            endTime: event.timestamp,
            output: event.output,
            isError: event.isError,
            status: event.isError ? "error" : "done",
            toolName: existing.toolName || event.toolName,
          });
        } else {
          // 孤儿 tool_result（无 start）：创建补全节点
          const node: ToolNodeState = {
            callId: event.callId,
            toolName: event.toolName || "unknown",
            toolInput: "",
            startTime: event.timestamp,
            endTime: event.timestamp,
            output: event.output,
            isError: event.isError,
            status: event.isError ? "error" : "done",
            progress: [],
          };
          this.toolNodes.set(event.callId, node);
          this.toolOrder.push(event.callId);
        }
        break;
      }

      case "file_change": {
        this.fileChanges.push(event);
        break;
      }

      case "permission": {
        if (!event.granted) this.permissionDenied.push(event);
        break;
      }

      case "error": {
        if (event.recoverable) this.warnings.push(event);
        else this.errors.push(event);
        break;
      }

      case "completed": {
        this.completed = event;
        break;
      }

      case "failed": {
        this.failed = event;
        break;
      }
    }
  }

  /** 批量摄入 */
  ingestAll(events: Iterable<WorkflowEvent>): void {
    for (const ev of events) this.ingest(ev);
  }

  /**
   * V2.17-A 续: 读取当前 finalAnswerBuffer（不拷贝整个 transcript）。
   *
   * 用于 view.ts 在 SDK 路径下从 WorkflowEvent message 派生 final answer 增量，
   * 不再由 stdout_delta 旁路驱动。ingest 前后两次 peek 的差值即为 UI 应追加的 delta。
   */
  peekFinalAnswer(): string {
    return this.finalAnswerBuffer;
  }

  /** 查找最近一个 running 工具节点（用于附加 tool_progress） */
  private findRunningToolForProgress(progress: ProgressEvent): ToolNodeState | null {
    // 从后往前找最近一个 running 工具
    for (let i = this.toolOrder.length - 1; i >= 0; i--) {
      const t = this.toolNodes.get(this.toolOrder[i]);
      if (t && t.status === "running") {
        // 如果 progress label 含工具名，验证匹配
        const labelLower = progress.label.toLowerCase();
        const toolNameLower = t.toolName.toLowerCase();
        if (!toolNameLower || labelLower.includes(toolNameLower) || toolNameLower.includes(labelLower)) {
          return t;
        }
      }
    }
    // 无明确匹配：返回最后一个 running 工具（若有）
    for (let i = this.toolOrder.length - 1; i >= 0; i--) {
      const t = this.toolNodes.get(this.toolOrder[i]);
      if (t && t.status === "running") return t;
    }
    return null;
  }

  /** 合并连续同 label 的 progress 节点 */
  private pushProcessNode(ev: ProgressEvent): void {
    const last = this.processNodes[this.processNodes.length - 1];
    if (last && last.label === ev.label && last.category === ev.category) {
      this.processNodes[this.processNodes.length - 1] = {
        ...last,
        timestamp: ev.timestamp,
        detail: ev.detail ?? last.detail,
      };
    } else {
      this.processNodes.push(ev);
    }
  }

  // ---------- 输出：聚合状态快照 ----------

  toTranscript(): RuntimeTranscript {
    return {
      finalAnswerBuffer: this.finalAnswerBuffer,
      thinkingBlock: this.thinkingBlock,
      toolNodes: this.toolNodes,
      toolOrder: this.toolOrder,
      processNodes: this.processNodes,
      sessionStarted: this.sessionStarted,
      systemMessages: this.systemMessages,
      subagentMessages: this.subagentMessages,
      fileChanges: this.fileChanges,
      permissionDenied: this.permissionDenied,
      warnings: this.warnings,
      errors: this.errors,
      completed: this.completed,
      failed: this.failed,
      isTerminal: this.completed !== null || this.failed !== null,
    };
  }

  // ---------- 输出：TimelineNode[] ----------

  /**
   * 生成聚合后的 TimelineNode[]（按时间戳排序，id 重排）
   *
   * 与 adaptEventsToTimeline 的差异：
   * - thinking 始终 0 或 1 个节点（累加所有 thinking_delta）
   * - tool_progress 合并到 tool_call 节点（不作为独立 progress 节点）
   * - 不产生 final_message 节点（mapper 已删除重复 message）
   * - 不依赖 lastAgentText 文本去重（用 partial 标志区分增量/快照）
   */
  toTimelineNodes(): TimelineNode[] {
    const nodes: TimelineNode[] = [];
    let idx = 0;
    const nextId = () => `tl-${idx++}`;

    // 1. session_started（仅 Developer mode 由 filter 决定是否展示）
    if (this.sessionStarted) {
      nodes.push({
        id: nextId(),
        kind: "session_started",
        timestamp: this.sessionStarted.timestamp,
        text: this.sessionStarted.text,
      });
    }

    // 2. process nodes（status / request / notice，时间顺序，已合并）
    for (const ev of this.processNodes) {
      nodes.push({
        id: nextId(),
        kind: "progress",
        timestamp: ev.timestamp,
        progressLabel: ev.label,
        progressDetail: ev.detail,
        progressCategory: ev.category,
      });
    }

    // 3. thinking block（始终单个节点）
    if (this.thinkingBlock && (this.thinkingBlock.text.trim().length > 0 || this.thinkingBlock.meta)) {
      nodes.push({
        id: nextId(),
        kind: "thought",
        timestamp: this.thinkingBlock.lastTimestamp,
        text: this.thinkingBlock.text,
        progressDetail: this.thinkingBlock.meta,
        progressCategory: "thinking",
      });
    }

    // 4. subagent 文本消息作为 agent 节点
    for (const ev of this.subagentMessages) {
      nodes.push({
        id: nextId(),
        kind: "agent",
        timestamp: ev.timestamp,
        text: ev.text,
        agentLabel: "Subagent",
        isSubagent: true,
      });
    }

    // 5. tool_call 节点（按插入顺序，时间戳为 start）
    for (const callId of this.toolOrder) {
      const t = this.toolNodes.get(callId);
      if (!t) continue;
      const durationMs = t.endTime
        ? Math.max(0, new Date(t.endTime).getTime() - new Date(t.startTime).getTime())
        : undefined;
      nodes.push({
        id: nextId(),
        kind: "tool_call",
        timestamp: t.startTime,
        endTime: t.endTime,
        durationMs,
        toolName: t.toolName,
        toolInput: t.toolInput,
        toolOutput: t.output,
        toolError: t.isError,
        // V2.17-A 续: tool_progress 合并到工具节点，UI 在工具节点内折叠展示
        toolProgress: t.progress,
        agentLabel: t.parentToolUseId ? "Subagent" : "Main agent",
        isSubagent: !!t.parentToolUseId,
      });
    }

    // 6. file_change（过滤 internal 路径）
    for (const ev of this.fileChanges) {
      if (isInternalFilePath(ev.path)) continue;
      nodes.push({
        id: nextId(),
        kind: "file_change",
        timestamp: ev.timestamp,
        filePath: ev.path,
        fileAction: ev.action,
      });
    }

    // 7. permission denied → warning
    for (const ev of this.permissionDenied) {
      if (!ev.granted) {
        nodes.push({
          id: nextId(),
          kind: "warning",
          timestamp: ev.timestamp,
          message: `Permission denied: ${ev.toolName}`,
        });
      }
    }

    // 8. warnings（可恢复错误）
    for (const ev of this.warnings) {
      nodes.push({
        id: nextId(),
        kind: "warning",
        timestamp: ev.timestamp,
        message: ev.message,
        recoverable: true,
      });
    }

    // 9. errors（不可恢复）
    for (const ev of this.errors) {
      nodes.push({
        id: nextId(),
        kind: "error",
        timestamp: ev.timestamp,
        message: ev.message,
        recoverable: false,
      });
    }

    // 10. 终态节点
    if (this.completed) {
      nodes.push({
        id: nextId(),
        kind: "completed",
        timestamp: this.completed.timestamp,
        text: this.completed.text,
        durationMs: this.completed.durationMs,
      });
    }
    if (this.failed) {
      nodes.push({
        id: nextId(),
        kind: "failed",
        timestamp: this.failed.timestamp,
        message: this.failed.message,
        recoverable: this.failed.recoverable,
      });
    }

    // 按时间戳稳定排序，重新分配 id
    nodes.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta - tb;
    });
    return nodes.map((n, i) => ({ ...n, id: `tl-${i}` }));
  }

  /** 原始事件流（Developer mode raw log 用） */
  toRawEvents(): WorkflowEvent[] {
    return this.rawEvents.slice();
  }

  /**
   * 产出 AssistantTurnView（V2.17-A 续：UI 唯一消费的视图）。
   *
   * 将已聚合的 WorkflowEvent 状态映射为 AssistantTurnView，供新 UI 路径消费。
   * final answer 来自 finalAnswerBuffer（partial text_delta 累加），不读 stdout_delta。
   * tool_progress 已合并到 toolNodes[i].progress，此处直接输出。
   */
  toAssistantTurnView(): AssistantTurnView {
    const toolCallViews: AssistantToolCallView[] = this.toolOrder.map((callId) => {
      const t = this.toolNodes.get(callId);
      if (!t) return null;
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
    }).filter((x): x is AssistantToolCallView => x !== null);

    let status: "running" | "completed" | "failed" = "running";
    if (this.completed) status = "completed";
    else if (this.failed) status = "failed";

    return {
      finalAnswer: this.finalAnswerBuffer,
      thinking: this.thinkingBlock,
      toolCalls: toolCallViews,
      toolCallOrder: this.toolOrder,
      fileChanges: this.fileChanges.map((ev) => ({
        path: ev.path,
        action: ev.action,
        timestamp: ev.timestamp,
      })),
      permissionDenied: this.permissionDenied.map((ev) => ({
        toolName: ev.toolName,
        timestamp: ev.timestamp,
      })),
      warnings: this.warnings.map((ev) => ({ message: ev.message, timestamp: ev.timestamp })),
      errors: this.errors.map((ev) => ({ message: ev.message, timestamp: ev.timestamp })),
      systemMessages: this.systemMessages.map((ev) => ({ text: ev.text, timestamp: ev.timestamp })),
      subagentMessages: this.subagentMessages.map((ev) => ({
        text: ev.text,
        ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}),
        timestamp: ev.timestamp,
      })),
      processNodes: this.processNodes.map((ev) => ({
        label: ev.label,
        ...(ev.detail ? { detail: ev.detail } : {}),
        ...(ev.category ? { category: ev.category } : {}),
        timestamp: ev.timestamp,
      })),
      status,
      ...(this.completed ? { completedAt: this.completed.timestamp } : {}),
      ...(this.failed ? { failedAt: this.failed.timestamp } : {}),
      ...(this.completed?.durationMs !== undefined ? { durationMs: this.completed.durationMs } : {}),
      rawProviderEvents: this.rawEvents,
    };
  }

  /** 重置聚合器（新一轮运行前调用） */
  reset(): void {
    this.finalAnswerBuffer = "";
    this.thinkingBlock = null;
    this.toolNodes.clear();
    this.toolOrder.length = 0;
    this.processNodes.length = 0;
    this.sessionStarted = null;
    this.systemMessages.length = 0;
    this.subagentMessages.length = 0;
    this.fileChanges.length = 0;
    this.permissionDenied.length = 0;
    this.warnings.length = 0;
    this.errors.length = 0;
    this.completed = null;
    this.failed = null;
    this.rawEvents.length = 0;
  }
}

// ---------- 工具函数：从 events 数组构建聚合 transcript ----------

/**
 * 便利函数：从 WorkflowEvent[] 一次性构建 RuntimeTranscript（用于历史消息渲染）
 */
export function buildRuntimeTranscriptFromEvents(events: ReadonlyArray<WorkflowEvent>): RuntimeTranscript {
  const agg = new RunStateAggregator();
  agg.ingestAll(events);
  return agg.toTranscript();
}

/**
 * 便利函数：从 WorkflowEvent[] 一次性生成 TimelineNode[]（替代 adaptEventsToTimeline 用于 SDK 路径）
 */
export function aggregateEventsToTimeline(events: ReadonlyArray<WorkflowEvent>): TimelineNode[] {
  const agg = new RunStateAggregator();
  agg.ingestAll(events);
  return agg.toTimelineNodes();
}
