// LLM CLI Bridge — Workflow Event (V2.0 SDK Workflow Deepening)
// UI-only 工具级事件模型，不混入 AgentEvent v0.1
// 用于 sdk backend 展示结构化工具调用流程
//
// 事件类型：
// - thinking:      模型思考过程摘要（V2.0 新增）
// - message:       模型思考摘要 / 系统消息
// - tool_start:    工具调用开始（工具名 + 输入）
// - tool_result:   工具调用结束（输出 + 是否出错）
// - file_change:   文件创建/修改/删除
// - permission:    权限请求（只展示，不自动批准）
// - progress:      SDK 运行中状态（partial/status/thinking token/tool progress）
// - error:         错误（可恢复 / 不可恢复）
// - completed:     工作流成功完成（V2.0 新增 UI-only 终态）
// - failed:        工作流失败终止（V2.0 新增 UI-only 终态）

/**
 * 工作流事件类型判别符
 */
export type WorkflowEventType =
  | "thinking"
  | "message"
  | "tool_start"
  | "tool_result"
  | "file_change"
  | "permission"
  | "progress"
  | "error"
  | "completed"
  | "failed";

/**
 * 事件公共字段
 */
export interface WorkflowEventBase {
  readonly type: WorkflowEventType;
  readonly timestamp: string;
}

/** 模型思考过程摘要（V2.0：thinking block 映射，UI-only，不混入 AgentEvent） */
export interface ThinkingEvent extends WorkflowEventBase {
  readonly type: "thinking";
  readonly text: string;
}

/** 模型思考摘要 / 系统消息 */
export interface MessageEvent extends WorkflowEventBase {
  readonly type: "message";
  readonly role: "assistant" | "system";
  readonly text: string;
  /** V2.3: SDK 会话 ID（标识 agent 实例，可选） */
  readonly sessionId?: string;
  /** V2.3: 父工具调用 ID（标识 subagent；主 agent 为 undefined） */
  readonly parentToolUseId?: string;
}

/** 工具调用开始 */
export interface ToolStartEvent extends WorkflowEventBase {
  readonly type: "tool_start";
  readonly toolName: string;
  /** 工具输入（JSON 字符串，已脱敏） */
  readonly toolInput: string;
  /** 调用 ID，用于与 tool_result 配对 */
  readonly callId: string;
  /** V2.3: SDK 会话 ID（标识 agent 实例，可选） */
  readonly sessionId?: string;
  /** V2.3: 父工具调用 ID（标识 subagent；主 agent 为 undefined） */
  readonly parentToolUseId?: string;
}

/** 工具调用结束 */
export interface ToolResultEvent extends WorkflowEventBase {
  readonly type: "tool_result";
  readonly callId: string;
  readonly toolName: string;
  /** 工具输出（已脱敏） */
  readonly output: string;
  readonly isError: boolean;
}

/** 文件变更 */
export interface FileChangeEvent extends WorkflowEventBase {
  readonly type: "file_change";
  readonly action: "create" | "modify" | "delete";
  readonly path: string;
}

/** 权限请求（只展示，不自动批准） */
export interface PermissionEvent extends WorkflowEventBase {
  readonly type: "permission";
  readonly toolName: string;
  readonly description: string;
  readonly granted: boolean;
  /** V2.3s: 风险等级（low/medium/high） */
  readonly riskLevel?: "low" | "medium" | "high";
  /** V2.3s: 中文风险说明 */
  readonly riskReason?: string;
  /** V2.3s: 命中的高风险标记（删除/Shell/网络/Vault外等） */
  readonly highRiskFlags?: ReadonlyArray<string>;
  /** V2.3s: 决策来源（user/session_allow/session_deny/mode） */
  readonly source?: "user" | "session_allow" | "session_deny" | "mode";
  /** V2.3s: SDK 会话 ID（标识 agent 实例） */
  readonly sessionId?: string;
  /** V2.3s: 父工具调用 ID（标识 subagent） */
  readonly parentToolUseId?: string;
  /** V2.3s: 请求 ID（用于异步用户决策配对） */
  readonly requestId?: string;
  /** V2.3s: 请求合并键（相同工具+风险+路径前缀合并） */
  readonly mergeKey?: string;
  /** V2.3s: 是否待用户决策（true=等待用户点击允许/拒绝） */
  readonly pending?: boolean;
  /** V2.3s: 工具参数摘要（已脱敏，用于 UI 展示） */
  readonly inputSummary?: string;
  /** V2.3s: subagent 权限继承风险提示（非空时表示有继承风险） */
  readonly subagentRisk?: string;
}

/** SDK 运行中状态（UI-only，不混入 AgentEvent） */
export interface ProgressEvent extends WorkflowEventBase {
  readonly type: "progress";
  readonly label: string;
  readonly detail?: string;
  readonly category?: "request" | "thinking" | "tool" | "status" | "notice";
}

/** 错误 */
export interface ErrorEvent extends WorkflowEventBase {
  readonly type: "error";
  readonly message: string;
  readonly recoverable: boolean;
}

/** 工作流成功完成（V2.0 UI-only 终态；AgentEvent completed 由调用方单独发） */
export interface CompletedEvent extends WorkflowEventBase {
  readonly type: "completed";
  readonly text: string;
  readonly durationMs?: number;
}

/** 工作流失败终止（V2.0 UI-only 终态；AgentEvent failed 由调用方单独发） */
export interface FailedEvent extends WorkflowEventBase {
  readonly type: "failed";
  readonly message: string;
  readonly recoverable: boolean;
}

/**
 * 工作流事件判别联合（UI-only，不进 AgentEvent v0.1）
 */
export type WorkflowEvent =
  | ThinkingEvent
  | MessageEvent
  | ToolStartEvent
  | ToolResultEvent
  | FileChangeEvent
  | PermissionEvent
  | ProgressEvent
  | ErrorEvent
  | CompletedEvent
  | FailedEvent;

/**
 * 工作流事件回调
 */
export type WorkflowEventHandler = (event: WorkflowEvent) => void;

// ---------- 脱敏工具 ----------

/** 敏感信息正则：API key / token / Bearer / password */
const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; replacement: string }> = [
  { re: /sk-ant-api03-[A-Za-z0-9_-]{20,}/g, replacement: "sk-ant-api03-***" },
  { re: /sk-[A-Za-z0-9]{20,}/g, replacement: "sk-***" },
  { re: /Bearer\s+[A-Za-z0-9_.~+/=-]{20,}/gi, replacement: "Bearer ***" },
  { re: /(api[_-]?key|token|password|secret|credential)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{8,}["']?/gi, replacement: "$1=***" },
];

/**
 * 脱敏字符串中的敏感信息（API key / token / Bearer / password）
 */
export function redactSecrets(input: string): string {
  let result = input;
  for (const { re, replacement } of SECRET_PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}

/**
 * 脱敏 WorkflowEvent 中的敏感字段（返回新事件，不修改原事件）
 */
export function redactWorkflowEvent(event: WorkflowEvent): WorkflowEvent {
  switch (event.type) {
    case "thinking":
      return { ...event, text: redactSecrets(event.text) };
    case "message":
      return { ...event, text: redactSecrets(event.text) };
    case "tool_start":
      return { ...event, toolInput: redactSecrets(event.toolInput) };
    case "tool_result":
      return { ...event, output: redactSecrets(event.output) };
    case "progress":
      return {
        ...event,
        label: redactSecrets(event.label),
        detail: event.detail ? redactSecrets(event.detail) : event.detail,
      };
    case "error":
      return { ...event, message: redactSecrets(event.message) };
    case "completed":
      return { ...event, text: redactSecrets(event.text) };
    case "failed":
      return { ...event, message: redactSecrets(event.message) };
    case "permission":
      // V2.3s: 脱敏 description 和 inputSummary
      return {
        ...event,
        description: redactSecrets(event.description),
        inputSummary: event.inputSummary ? redactSecrets(event.inputSummary) : event.inputSummary,
      };
    default:
      // file_change 无敏感字段
      return event;
  }
}

// ---------- 标签与图标 ----------

/**
 * 事件 → 用户可读标签
 */
export function workflowEventLabel(event: WorkflowEvent): string {
  switch (event.type) {
    case "thinking":
      return "Thinking";
    case "message":
      return event.role === "assistant" ? "Assistant" : "System";
    case "tool_start":
      return `Tool: ${event.toolName}`;
    case "tool_result":
      return event.isError ? `Tool error: ${event.toolName}` : `Tool done: ${event.toolName}`;
    case "file_change": {
      const verb = event.action === "create" ? "Created" : event.action === "modify" ? "Modified" : "Deleted";
      return `${verb} file`;
    }
    case "permission":
      return event.granted ? `Permission granted: ${event.toolName}` : `Permission denied: ${event.toolName}`;
    case "progress":
      return event.label;
    case "error":
      return event.recoverable ? "Recoverable error" : "Fatal error";
    case "completed":
      return "Workflow completed";
    case "failed":
      return event.recoverable ? "Workflow failed (recoverable)" : "Workflow failed";
  }
}

/**
 * 事件 → 图标字符（单字符，纯文本风格）
 */
export function workflowEventIcon(event: WorkflowEvent): string {
  switch (event.type) {
    case "thinking":
      return "💭";
    case "message":
      return event.role === "assistant" ? "💬" : "ℹ";
    case "tool_start":
      return "🔧";
    case "tool_result":
      return event.isError ? "✗" : "✓";
    case "file_change":
      return "📄";
    case "permission":
      return event.granted ? "🔓" : "🔒";
    case "progress":
      return "•";
    case "error":
      return event.recoverable ? "⚠" : "✗";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
  }
}

/**
 * 事件 → CSS 状态类名
 */
export function workflowEventClass(event: WorkflowEvent): string {
  switch (event.type) {
    case "thinking":
      return "is-thinking";
    case "message":
      return "is-message";
    case "tool_start":
      return "is-tool-start";
    case "tool_result":
      return event.isError ? "is-tool-error" : "is-tool-done";
    case "file_change":
      return "is-file-change";
    case "permission":
      return event.granted ? "is-perm-granted" : "is-perm-denied";
    case "progress":
      return `is-progress-${event.category ?? "status"}`;
    case "error":
      return event.recoverable ? "is-error-recoverable" : "is-error-fatal";
    case "completed":
      return "is-completed";
    case "failed":
      return event.recoverable ? "is-failed-recoverable" : "is-failed-fatal";
  }
}

// ---------- Tool Timeline 构造 ----------

/**
 * 工具调用时间线条目（tool_start 与 tool_result 配对）
 */
export interface ToolTimelineEntry {
  readonly toolName: string;
  readonly callId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** V2.0: 工具耗时（ms），未配对时为 null */
  readonly durationMs: number | null;
  readonly input: string;
  readonly output: string | null;
  readonly isError: boolean;
  readonly status: "running" | "done" | "error";
  /** V2.9: 所属 agent 标识（undefined=主 agent，字符串=subagent 的 parentToolUseId），用于 O(1) 分组，替代下游线性扫描 */
  readonly parentToolUseId: string | undefined;
}

/**
 * 将 WorkflowEvent 列表构造为工具调用时间线
 * - tool_start 创建条目（status=running）
 * - tool_result 配对更新条目（status=done/error），计算 durationMs
 * - 未配对的 tool_start 保持 running 状态（durationMs=null）
 *
 * @param events 工作流事件列表（按时间顺序）
 * @returns 工具调用时间线
 */
export function buildToolTimeline(events: ReadonlyArray<WorkflowEvent>): ToolTimelineEntry[] {
  const entries: ToolTimelineEntry[] = [];
  const byCallId = new Map<string, number>();

  for (const event of events) {
    if (event.type === "tool_start") {
      const entry: ToolTimelineEntry = {
        toolName: event.toolName,
        callId: event.callId,
        startedAt: event.timestamp,
        finishedAt: null,
        durationMs: null,
        input: event.toolInput,
        output: null,
        isError: false,
        status: "running",
        // V2.9: 顺手记录 parentToolUseId，避免下游为每个 tool 重新线性扫描 events
        parentToolUseId: event.parentToolUseId,
      };
      byCallId.set(event.callId, entries.length);
      entries.push(entry);
    } else if (event.type === "tool_result") {
      const idx = byCallId.get(event.callId);
      if (idx !== undefined) {
        const startedMs = new Date(entries[idx].startedAt).getTime();
        const finishedMs = new Date(event.timestamp).getTime();
        const durationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs) && finishedMs >= startedMs
          ? finishedMs - startedMs
          : null;
        entries[idx] = {
          ...entries[idx],
          finishedAt: event.timestamp,
          durationMs,
          output: event.output,
          isError: event.isError,
          status: event.isError ? "error" : "done",
        };
      }
    }
  }

  return entries;
}

/**
 * 从工作流事件中提取文件变更列表
 */
export function extractFileChanges(events: ReadonlyArray<WorkflowEvent>): ReadonlyArray<FileChangeEvent> {
  return events.filter((e): e is FileChangeEvent => e.type === "file_change");
}

/**
 * 判断事件是否为终态错误（不可恢复）
 */
export function isFatalError(event: WorkflowEvent): boolean {
  return event.type === "error" && !event.recoverable;
}

/**
 * 截断字符串到指定长度，超长加省略号
 */
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}
