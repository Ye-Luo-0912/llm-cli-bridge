// LLM CLI Bridge — SDK Message Mapper (V2.0 SDK Workflow Deepening)
// 纯函数：将 Claude Agent SDK 的 SDKMessage 映射为 UI-only WorkflowEvent
// 不依赖真实 SDK 安装：使用最小鸭子类型接口，测试可用 mock 对象验证
//
// 映射规则：
// - SDKSystemMessage(init)     → message(system) + 可选 permission/info
// - SDKAssistantMessage        → thinking(thinking blocks) + message(assistant, text blocks) + tool_start(tool_use blocks)
// - SDKUserMessage(tool_result)→ tool_result(配对 tool_use_id)
// - SDKResultMessage(success)  → message(assistant, result text) + completed(UI-only 终态)；调用方另发 AgentEvent completed
// - SDKResultMessage(error)    → error(fatal) + failed(UI-only 终态)；调用方另发 AgentEvent failed
// - SDKPermissionDeniedMessage → permission(denied)
// - 文件变更：从 tool_use 的 Edit/Write/MultiEdit/NotebookEdit 检测 → file_change
// - SDKPartialAssistantMessage → 映射 partial text/thinking/progress，保留 SDK 原始过程
//
// 不改 AgentEvent v0.1；所有映射结果为 WorkflowEvent（UI-only）

import {
  MessageEvent,
  ToolStartEvent,
  ToolResultEvent,
  FileChangeEvent,
  PermissionEvent,
  ProgressEvent,
  ErrorEvent,
  ThinkingEvent,
  CompletedEvent,
  FailedEvent,
  WorkflowEvent,
} from "./workflowEvent";

// ---------- 最小 SDK 消息类型（鸭子类型，不依赖真实 SDK 安装） ----------

/** SDK content block: tool_use（模型请求调用工具） */
export interface SdkToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** SDK content block: tool_result（工具调用结果） */
export interface SdkToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string | ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly is_error?: boolean;
}

/** SDK content block: text */
export interface SdkTextBlock {
  readonly type: "text";
  readonly text: string;
}

/** SDK content block: thinking（V2.0：模型思考过程） */
export interface SdkThinkingBlock {
  readonly type: "thinking" | "redacted_thinking";
  readonly thinking?: string;
  readonly summary?: string;
  readonly text?: string;
  readonly summaries?: ReadonlyArray<string | { readonly text?: string; readonly summary?: string }>;
}

export type SdkContentBlock = SdkToolUseBlock | SdkToolResultBlock | SdkTextBlock | SdkThinkingBlock | { readonly type: string };

/** SDKAssistantMessage：模型响应（含 text/tool_use/thinking blocks） */
export interface SdkAssistantMessage {
  readonly type: "assistant";
  readonly message: {
    readonly content: ReadonlyArray<SdkContentBlock>;
  };
  readonly error?: string;
  readonly session_id?: string;
  /** V2.3: 父工具调用 ID（subagent 响应时由 Task 工具触发，主 agent 为 undefined） */
  readonly parent_tool_use_id?: string;
}

/** SDKUserMessage：用户输入 + tool_result */
export interface SdkUserMessage {
  readonly type: "user";
  readonly message: {
    readonly content: string | ReadonlyArray<SdkContentBlock>;
  };
  readonly tool_use_result?: unknown;
  readonly session_id?: string;
  /** V2.3: 父工具调用 ID（subagent 上下文中的 user 消息） */
  readonly parent_tool_use_id?: string;
}

/** SDKSystemMessage：会话初始化 / 状态 / 权限拒绝等 */
export interface SdkSystemMessage {
  readonly type: "system";
  readonly subtype: string; // init / status / permission_denied / compact_boundary / ...
  readonly model?: string;
  readonly cwd?: string;
  readonly tools?: ReadonlyArray<string>;
  readonly permissionMode?: string;
  readonly tool_name?: string; // permission_denied 时
  readonly tool_use_id?: string;
  readonly message?: string; // permission_denied 时
  readonly session_id?: string;
}

/** SDKResultMessage：终态（success / error） */
export interface SdkResultMessage {
  readonly type: "result";
  readonly subtype: "success" | "error_during_execution" | "error_max_turns" | "error_max_budget_usd" | "error_max_structured_output_retries";
  readonly is_error: boolean;
  readonly result?: string; // success 时的最终文本
  readonly errors?: ReadonlyArray<string>; // error 时的错误信息
  readonly duration_ms?: number;
  readonly total_cost_usd?: number;
  readonly session_id?: string;
}

/** SDKPartialAssistantMessage：流式增量（V2.16-G 映射 text/thinking/progress） */
export interface SdkPartialAssistantMessage {
  readonly type: "stream_event";
  readonly event?: {
    readonly type?: string;
    readonly index?: number;
    readonly delta?: {
      readonly type?: string;
      readonly text?: string;
      readonly thinking?: string;
      readonly estimated_tokens?: number | null;
      readonly partial_json?: string;
    };
    readonly content_block?: {
      readonly type?: string;
      readonly id?: string;
      readonly name?: string;
    };
  };
  readonly parent_tool_use_id?: string | null;
  readonly session_id?: string;
  readonly ttft_ms?: number;
}

/** 所有 SDK 消息的联合类型（鸭子类型子集） */
export type SdkMessage =
  | SdkAssistantMessage
  | SdkUserMessage
  | SdkSystemMessage
  | SdkResultMessage
  | SdkPartialAssistantMessage
  | { readonly type: string }; // 兜底：其他未知消息类型

// ---------- 文件变更检测 ----------

/** 可能产生文件变更的内置工具名 */
const FILE_WRITING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * 从 tool_use 的 input 中提取文件路径
 * 支持 file_path / notebook_path / path 字段
 */
function extractFilePath(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const path = obj.file_path ?? obj.notebook_path ?? obj.path;
  if (typeof path === "string" && path.length > 0) return path;
  return null;
}

/**
 * 检测 tool_use 是否产生文件变更
 * @returns FileChangeEvent 或 null（非文件写入工具）
 */
export function detectFileChangeFromToolUse(toolName: string, input: unknown, timestamp: string): FileChangeEvent | null {
  if (!FILE_WRITING_TOOLS.has(toolName)) return null;
  const filePath = extractFilePath(toolName, input);
  if (!filePath) return null;
  // Edit/MultiEdit = modify; Write = create（Write 也可能覆盖已有文件，但 SDK 层面无法区分，统一用 modify 保守标记）
  const action: FileChangeEvent["action"] = toolName === "Write" ? "create" : "modify";
  return {
    type: "file_change",
    timestamp,
    action,
    path: filePath,
  };
}

// ---------- 工具输入序列化 ----------

/**
 * 将 tool_use input 序列化为字符串（用于 UI 展示）
 * 截断超长输入
 */
export function serializeToolInput(input: unknown, maxLen = 200): string {
  if (input === null || input === undefined) return "";
  try {
    const json = JSON.stringify(input);
    if (json.length <= maxLen) return json;
    return json.slice(0, maxLen - 1) + "…";
  } catch {
    return String(input).slice(0, maxLen);
  }
}

/**
 * 将 tool_result content 序列化为字符串
 */
export function serializeToolResultContent(
  content: string | ReadonlyArray<{ readonly type: string; readonly text?: string }>,
  maxLen = 200,
): string {
  if (typeof content === "string") {
    return content.length <= maxLen ? content : content.slice(0, maxLen - 1) + "…";
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string);
    const joined = texts.join("\n");
    return joined.length <= maxLen ? joined : joined.slice(0, maxLen - 1) + "…";
  }
  return "";
}

function truncateDetail(text: string, maxLen = 120): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + "…";
}

function createProgressEvent(
  timestamp: string,
  label: string,
  detail?: string,
  category: ProgressEvent["category"] = "status",
): ProgressEvent {
  return {
    type: "progress",
    timestamp,
    label,
    ...(detail ? { detail } : {}),
    category,
  };
}

function extractDisplayableThinking(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const record = block as Record<string, unknown>;
  for (const key of ["thinking", "summary", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  const summaries = record.summaries;
  if (Array.isArray(summaries)) {
    const parts = summaries
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const entry = item as Record<string, unknown>;
          if (typeof entry.text === "string") return entry.text;
          if (typeof entry.summary === "string") return entry.summary;
        }
        return "";
      })
      .filter((part) => part.trim().length > 0);
    if (parts.length > 0) return parts.join("\n");
  }
  return "";
}

function mapPartialStreamEvent(pm: SdkPartialAssistantMessage, timestamp: string): WorkflowEvent[] {
  const events: WorkflowEvent[] = [];
  const raw = pm.event;
  if (!raw) {
    events.push(createProgressEvent(timestamp, "Receiving stream event"));
    return events;
  }

  if (raw.type === "message_start") {
    const detail = typeof pm.ttft_ms === "number" ? `first token ${pm.ttft_ms}ms` : undefined;
    events.push(createProgressEvent(timestamp, "Response started", detail, "request"));
    return events;
  }

  if (raw.type === "content_block_start") {
    const block = raw.content_block;
    if (block?.type === "thinking" || block?.type === "redacted_thinking") {
      // P4-D: 不再发 "Thinking started" progress 事件，避免普通用户态噪声
    } else if (block?.type === "tool_use" || block?.type === "server_tool_use" || block?.type === "mcp_tool_use") {
      events.push(createProgressEvent(timestamp, `Preparing ${block.name ?? "tool"}`, undefined, "tool"));
    } else {
      events.push(createProgressEvent(timestamp, `Receiving ${block?.type ?? "content"}`));
    }
    return events;
  }

  if (raw.type === "content_block_delta") {
    const delta = raw.delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
      // V2.17-A: partial text_delta 标记为 partial=true，由 RunStateAggregator 累加到 finalAnswerBuffer
      // （非完整快照，避免 SDKAssistantMessage 重复）
      events.push({
        type: "message",
        timestamp,
        role: "assistant",
        text: delta.text,
        partial: true,
        parentToolUseId: typeof pm.parent_tool_use_id === "string" ? pm.parent_tool_use_id : undefined,
        sessionId: typeof pm.session_id === "string" ? pm.session_id : undefined,
      });
    } else if (delta?.type === "thinking_delta") {
      if (typeof delta.thinking === "string" && delta.thinking.length > 0) {
        events.push({ type: "thinking", timestamp, text: delta.thinking });
      }
      if (typeof delta.estimated_tokens === "number") {
        events.push(createProgressEvent(timestamp, "Thinking", `~${delta.estimated_tokens} tokens`, "thinking"));
      }
    } else if (delta?.type === "input_json_delta") {
      const detail = typeof delta.partial_json === "string" ? truncateDetail(delta.partial_json) : undefined;
      events.push(createProgressEvent(timestamp, "Preparing tool input", detail, "tool"));
    }
    return events;
  }

  if (raw.type === "message_delta") {
    events.push(createProgressEvent(timestamp, "Receiving response", undefined, "request"));
    return events;
  }

  if (raw.type === "message_stop" || raw.type === "content_block_stop") {
    return events;
  }

  events.push(createProgressEvent(timestamp, `Stream: ${raw.type ?? "event"}`));
  return events;
}

// ---------- 主映射函数 ----------

/**
 * 映射结果：WorkflowEvent 列表 + 终态标记（供调用方决定发哪个 AgentEvent）
 */
export interface SdkMappingResult {
  readonly events: WorkflowEvent[];
  /** null=非终态；"completed"=SDK 成功完成；"failed"=SDK 出错 */
  readonly terminal: "completed" | "failed" | null;
  /** 终态时的最终文本（result 或 error message） */
  readonly terminalText: string;
  /** 终态时的退出码（completed=0，failed=1） */
  readonly terminalExitCode: number | null;
  /** 是否为 partial（stream_event，未完整） */
  readonly partial: boolean;
}

/**
 * 将单个 SDKMessage 映射为 WorkflowEvent 列表 + 终态标记
 *
 * @param msg SDK 消息（鸭子类型）
 * @param timestamp 事件时间戳（默认 now）
 * @returns 映射结果（events 可能为空，如未知消息类型）
 */
export function mapSdkMessageToWorkflowEvents(
  msg: SdkMessage,
  timestamp: string = new Date().toISOString(),
): SdkMappingResult {
  // 1. SDKAssistantMessage：text blocks → message；tool_use blocks → tool_start + file_change
  if (msg.type === "assistant") {
    const am = msg as SdkAssistantMessage;
    const events: WorkflowEvent[] = [];
    // V2.3: 提取 agent 标识字段（sessionId / parentToolUseId）
    const sessionId = typeof am.session_id === "string" ? am.session_id : undefined;
    const parentToolUseId = typeof am.parent_tool_use_id === "string" ? am.parent_tool_use_id : undefined;

    // API 错误（per-turn）
    if (am.error) {
      events.push({
        type: "error",
        timestamp,
        message: `API error: ${am.error}`,
        recoverable: am.error === "rate_limit" || am.error === "overloaded",
      });
    }

    const content = am.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "thinking" || block.type === "redacted_thinking") {
          // V2.16-H: thinking.display=summarized can return a displayable
          // summary instead of raw thinking. Show whatever the SDK exposes.
          const thinkingText = extractDisplayableThinking(block);
          if (thinkingText.length > 0) {
            events.push({
              type: "thinking",
              timestamp,
              text: thinkingText,
            });
          }
        } else if (block.type === "text" && typeof (block as SdkTextBlock).text === "string") {
          const textBlock = block as SdkTextBlock;
          if (textBlock.text.length > 0) {
            events.push({
              type: "message",
              timestamp,
              role: "assistant",
              text: textBlock.text,
              // V2.3: 标识产生此消息的 agent 实例
              sessionId,
              parentToolUseId,
            });
          }
        } else if (block.type === "tool_use") {
          const toolBlock = block as SdkToolUseBlock;
          // tool_start 事件
          events.push({
            type: "tool_start",
            timestamp,
            toolName: toolBlock.name,
            toolInput: serializeToolInput(toolBlock.input),
            callId: toolBlock.id,
            // V2.3: 标识发起此工具调用的 agent 实例
            sessionId,
            parentToolUseId,
          });
          // 文件变更检测
          const fc = detectFileChangeFromToolUse(toolBlock.name, toolBlock.input, timestamp);
          if (fc) events.push(fc);
        }
      }
    }

    return { events, terminal: null, terminalText: "", terminalExitCode: null, partial: false };
  }

  // 2. SDKUserMessage：tool_result blocks → tool_result
  if (msg.type === "user") {
    const um = msg as SdkUserMessage;
    const events: WorkflowEvent[] = [];
    const content = um.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          const resultBlock = block as SdkToolResultBlock;
          events.push({
            type: "tool_result",
            timestamp,
            callId: resultBlock.tool_use_id,
            toolName: "", // SDKUserMessage 不含工具名，由 buildToolTimeline 从 tool_start 配对补全
            output: serializeToolResultContent(resultBlock.content),
            isError: resultBlock.is_error === true,
          });
        }
      }
    }
    return { events, terminal: null, terminalText: "", terminalExitCode: null, partial: false };
  }

  // 3. SDKSystemMessage：init → message(system)；permission_denied → permission(denied)
  if (msg.type === "system") {
    const sm = msg as SdkSystemMessage;
    const events: WorkflowEvent[] = [];

    if (sm.subtype === "init") {
      events.push({
        type: "message",
        timestamp,
        role: "system",
        text: `SDK session started (model=${sm.model ?? "unknown"}, cwd=${sm.cwd ?? "unknown"}, tools=${sm.tools?.length ?? 0})`,
      });
    } else if (sm.subtype === "permission_denied") {
      events.push({
        type: "permission",
        timestamp,
        toolName: sm.tool_name ?? "unknown",
        description: sm.message ?? "Permission denied",
        granted: false,
      });
    } else if (sm.subtype === "status") {
      const record = sm as unknown as Record<string, unknown>;
      const status = record.status;
      if (status === "requesting") {
        events.push(createProgressEvent(timestamp, "Requesting model", undefined, "request"));
      } else if (status === "compacting") {
        const detail = typeof record.compact_error === "string" ? record.compact_error : undefined;
        events.push(createProgressEvent(timestamp, "Compacting context", detail, "status"));
      }
    } else if (sm.subtype === "thinking_tokens") {
      const record = sm as unknown as Record<string, unknown>;
      const estimated = record.estimated_tokens;
      const delta = record.estimated_tokens_delta;
      const detailParts: string[] = [];
      if (typeof estimated === "number") detailParts.push(`~${estimated} tokens`);
      if (typeof delta === "number" && delta > 0) detailParts.push(`+${delta}`);
      events.push(createProgressEvent(timestamp, "Thinking", detailParts.join(" · ") || undefined, "thinking"));
    } else if (sm.subtype === "task_progress") {
      const record = sm as unknown as Record<string, unknown>;
      const description = typeof record.description === "string" && record.description.length > 0
        ? record.description
        : "Task progress";
      const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : null;
      const detailParts: string[] = [];
      if (usage && typeof usage.total_tokens === "number") detailParts.push(`${usage.total_tokens} tokens`);
      if (usage && typeof usage.tool_uses === "number") detailParts.push(`${usage.tool_uses} tools`);
      if (typeof record.last_tool_name === "string") detailParts.push(record.last_tool_name);
      events.push(createProgressEvent(timestamp, description, detailParts.join(" · ") || undefined, "tool"));
    } else if (sm.subtype === "informational") {
      const record = sm as unknown as Record<string, unknown>;
      const content = typeof record.content === "string" ? record.content : "";
      const level = typeof record.level === "string" ? record.level : "";
      if (content.length > 0) {
        events.push(createProgressEvent(timestamp, truncateDetail(content, 100), level || undefined, "notice"));
      }
    }
    return { events, terminal: null, terminalText: "", terminalExitCode: null, partial: false };
  }

  // 4. SDKResultMessage：终态
  if (msg.type === "result") {
    const rm = msg as SdkResultMessage;
    const events: WorkflowEvent[] = [];
    // V2.17-A: 终态不再发 message(assistant, resultText)，避免与 partial 文本重复
    // - sessionId 附加到 completed/failed 终端事件，供 Developer mode 审计
    const terminalSessionId = typeof rm.session_id === "string" ? rm.session_id : undefined;

    if (rm.subtype === "success" && !rm.is_error) {
      // 成功完成
      // V2.17-A: result success 只标记 completed，不生成重复 message(assistant, resultText)
      // - 最终答案文本由 partial text_delta 已累加到 RunStateAggregator.finalAnswerBuffer
      // - sdkBackend 的 terminalText fallback 逻辑保证非流式模式下也能落地最终文本
      // - 避免与已累加的 partial 文本重复，消除 timelineAdapter 的 lastAgentText 去重
      const resultText = rm.result ?? "";
      const completedEv: CompletedEvent = {
        type: "completed",
        timestamp,
        text: resultText || "SDK 任务完成",
        durationMs: typeof rm.duration_ms === "number" ? rm.duration_ms : undefined,
        ...(terminalSessionId ? { sessionId: terminalSessionId } : {}),
      };
      events.push(completedEv);
      return {
        events,
        terminal: "completed",
        terminalText: resultText,
        terminalExitCode: 0,
        partial: false,
      };
    } else {
      // 错误完成
      const errorMsg = rm.errors?.join("; ") ?? `SDK error: ${rm.subtype}`;
      events.push({
        type: "error",
        timestamp,
        message: errorMsg,
        recoverable: false,
      });
      // V2.0: UI-only 终态事件（AgentEvent failed 由调用方另发）
      const failedEv: FailedEvent = {
        type: "failed",
        timestamp,
        message: errorMsg,
        recoverable: false,
        ...(terminalSessionId ? { sessionId: terminalSessionId } : {}),
      };
      events.push(failedEv);
      return {
        events,
        terminal: "failed",
        terminalText: errorMsg,
        terminalExitCode: 1,
        partial: false,
      };
    }
  }

  // 5. SDKPartialAssistantMessage：partial text/thinking/progress 映射为 UI-only WorkflowEvent
  if (msg.type === "stream_event") {
    return {
      events: mapPartialStreamEvent(msg as SdkPartialAssistantMessage, timestamp),
      terminal: null,
      terminalText: "",
      terminalExitCode: null,
      partial: true,
    };
  }

  // 6. SDK 运行中工具进度：保留原始过程，不执行任何自研工具逻辑
  if (msg.type === "tool_progress") {
    const record = msg as unknown as Record<string, unknown>;
    const toolName = typeof record.tool_name === "string" && record.tool_name.length > 0 ? record.tool_name : "tool";
    const elapsed = typeof record.elapsed_time_seconds === "number"
      ? `${Math.round(record.elapsed_time_seconds)}s`
      : undefined;
    return {
      events: [createProgressEvent(timestamp, `${toolName} running`, elapsed, "tool")],
      terminal: null,
      terminalText: "",
      terminalExitCode: null,
      partial: false,
    };
  }

  if (msg.type === "tool_use_summary") {
    const record = msg as unknown as Record<string, unknown>;
    const summary = typeof record.summary === "string" ? truncateDetail(record.summary, 160) : undefined;
    return {
      events: [createProgressEvent(timestamp, "Tool summary", summary, "tool")],
      terminal: null,
      terminalText: "",
      terminalExitCode: null,
      partial: false,
    };
  }

  // 7. 未知消息类型：忽略
  return { events: [], terminal: null, terminalText: "", terminalExitCode: null, partial: false };
}

// ---------- SDK 诊断 ----------

/**
 * SDK 诊断信息（不含 secret）
 */
export interface SdkDiagnostics {
  /** SDK 是否可用 */
  readonly available: boolean;
  /** 加载的包名（@anthropic-ai/claude-agent-sdk 或 @anthropic-ai/claude-code） */
  readonly packageName: string | null;
  /** SDK 版本（若可获取） */
  readonly version: string | null;
  /** 使用的 cwd */
  readonly cwd: string;
  /** 使用的 model */
  readonly model: string | null;
  /** permissionMode */
  readonly permissionMode: string | null;
  /** 接收的 SDK 消息总数 */
  readonly messageCount: number;
  /** 映射的 WorkflowEvent 总数 */
  readonly workflowEventCount: number;
  /** partial 消息数 */
  readonly partialCount: number;
  /** fallback 原因（SDK 不可用时） */
  readonly fallbackReason: string | null;
  /** V2.0: 错误摘要（最后一次错误，已脱敏，不含 secret） */
  readonly errorSummary: string | null;
}

/**
 * 构造初始 SdkDiagnostics
 */
export function createInitialDiagnostics(cwd: string, model: string | null, permissionMode: string | null): SdkDiagnostics {
  return {
    available: false,
    packageName: null,
    version: null,
    cwd,
    model,
    permissionMode,
    messageCount: 0,
    workflowEventCount: 0,
    partialCount: 0,
    fallbackReason: null,
    errorSummary: null,
  };
}

/**
 * 更新诊断信息（不可变，返回新对象）
 */
export function updateDiagnostics(diagnostics: SdkDiagnostics, updates: Partial<SdkDiagnostics>): SdkDiagnostics {
  return { ...diagnostics, ...updates };
}

/**
 * 将诊断信息格式化为日志字符串（不含 secret）
 */
export function formatDiagnosticsForLog(diagnostics: SdkDiagnostics): string {
  return [
    `available=${diagnostics.available}`,
    `package=${diagnostics.packageName ?? "null"}`,
    `version=${diagnostics.version ?? "null"}`,
    `model=${diagnostics.model ?? "null"}`,
    `permissionMode=${diagnostics.permissionMode ?? "null"}`,
    `messages=${diagnostics.messageCount}`,
    `workflowEvents=${diagnostics.workflowEventCount}`,
    `partial=${diagnostics.partialCount}`,
    `fallbackReason=${diagnostics.fallbackReason ?? "null"}`,
    `errorSummary=${diagnostics.errorSummary ?? "null"}`,
  ].join(" ");
}
