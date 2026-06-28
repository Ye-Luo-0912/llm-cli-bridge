// LLM CLI Bridge — SDK Message Mapper (V1.7)
// 纯函数：将 Claude Agent SDK 的 SDKMessage 映射为 UI-only WorkflowEvent
// 不依赖真实 SDK 安装：使用最小鸭子类型接口，测试可用 mock 对象验证
//
// 映射规则：
// - SDKSystemMessage(init)     → message(system) + 可选 permission/info
// - SDKAssistantMessage        → message(assistant, text blocks) + tool_start(tool_use blocks)
// - SDKUserMessage(tool_result)→ tool_result(配对 tool_use_id)
// - SDKResultMessage(success)  → 标记完成（由调用方发 AgentEvent completed）+ message(assistant, result text)
// - SDKResultMessage(error)    → 标记失败（由调用方发 AgentEvent failed）+ error(fatal)
// - SDKPermissionDeniedMessage → permission(denied)
// - 文件变更：从 tool_use 的 Edit/Write/MultiEdit/NotebookEdit 检测 → file_change
//
// 不改 AgentEvent v0.1；所有映射结果为 WorkflowEvent（UI-only）

import {
  MessageEvent,
  ToolStartEvent,
  ToolResultEvent,
  FileChangeEvent,
  PermissionEvent,
  ErrorEvent,
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

export type SdkContentBlock = SdkToolUseBlock | SdkToolResultBlock | SdkTextBlock | { readonly type: string };

/** SDKAssistantMessage：模型响应（含 text/tool_use/thinking blocks） */
export interface SdkAssistantMessage {
  readonly type: "assistant";
  readonly message: {
    readonly content: ReadonlyArray<SdkContentBlock>;
  };
  readonly error?: string;
  readonly session_id?: string;
}

/** SDKUserMessage：用户输入 + tool_result */
export interface SdkUserMessage {
  readonly type: "user";
  readonly message: {
    readonly content: string | ReadonlyArray<SdkContentBlock>;
  };
  readonly tool_use_result?: unknown;
  readonly session_id?: string;
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

/** SDKPartialAssistantMessage：流式增量（V1.7 标记 partial，不深度解析） */
export interface SdkPartialAssistantMessage {
  readonly type: "stream_event";
  readonly parent_tool_use_id?: string;
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
        if (block.type === "text" && typeof (block as SdkTextBlock).text === "string") {
          const textBlock = block as SdkTextBlock;
          if (textBlock.text.length > 0) {
            events.push({
              type: "message",
              timestamp,
              role: "assistant",
              text: textBlock.text,
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
          });
          // 文件变更检测
          const fc = detectFileChangeFromToolUse(toolBlock.name, toolBlock.input, timestamp);
          if (fc) events.push(fc);
        }
        // thinking blocks 暂不映射（V1.7 不展示思考过程，避免噪音）
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
    }
    // 其他 system 子类型（status/compact_boundary 等）暂不映射，避免噪音
    return { events, terminal: null, terminalText: "", terminalExitCode: null, partial: false };
  }

  // 4. SDKResultMessage：终态
  if (msg.type === "result") {
    const rm = msg as SdkResultMessage;
    const events: WorkflowEvent[] = [];

    if (rm.subtype === "success" && !rm.is_error) {
      // 成功完成
      const resultText = rm.result ?? "";
      if (resultText) {
        events.push({
          type: "message",
          timestamp,
          role: "assistant",
          text: resultText,
        });
      }
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
      return {
        events,
        terminal: "failed",
        terminalText: errorMsg,
        terminalExitCode: 1,
        partial: false,
      };
    }
  }

  // 5. SDKPartialAssistantMessage：标记 partial，不产出事件（V1.7 不深度解析流式增量）
  if (msg.type === "stream_event") {
    return { events: [], terminal: null, terminalText: "", terminalExitCode: null, partial: true };
  }

  // 6. 未知消息类型：忽略
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
  ].join(" ");
}
