// LLM CLI Bridge — Codex app-server schema (V2.17-A Completion)
//
// ⚠️ PRELIMINARY / FIXTURE SCHEMA
//
// 本文件为 codex app-server JSON-RPC 协议的初步手写类型，仅用于 V2.17-A Bridge Core
// provider skeleton 编译与 fixture 测试。当本机存在 codex CLI 时，应通过
//   codex app-server generate-ts --out ./src/runtime/providers/codex-app-server/schema
// 重新生成并覆盖本文件（参见 schema/manifest.json）。
//
// 当前类型基于公开已知的 codex app-server JSON-RPC 约定（thread/turn/item 命名），
// 字段名不具权威性；与真实 codex 协议不一致时以生成版本为准。
//
// 这些类型只被 codex-app-server provider 内部消费；UI 永远不直接 import 本文件。

// ---------- 通用 JSON-RPC 2.0 包装 ----------

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: P;
}

export interface JsonRpcResponseSuccess<R = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result: R;
}

export interface JsonRpcResponseError {
  jsonrpc: "2.0";
  id: number | string;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage<R = unknown> =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponseSuccess<R>
  | JsonRpcResponseError;

// ---------- thread / turn ----------

export interface CodexThreadStartParams {
  /** 模型 id（如 gpt-5.5）；省略时由 codex 自行选默认 */
  model?: string;
  /** provider 私有 session 标识（resume 用） */
  resumeSessionId?: string;
  /** Codex instructions 层（对应 BridgePromptPackage.bridgeSystemAppend 的映射目标之一） */
  instructions?: string;
  /** Codex config/rules 层（key-value；bridgeSystemAppend 可拆解到此） */
  config?: Record<string, unknown>;
  /** 工作目录 */
  cwd?: string;
}

export interface CodexThreadStartResult {
  threadId: string;
  /** 服务端 session id（resume 用，可能与 threadId 同） */
  sessionId?: string;
}

export interface CodexTurnStartParams {
  /** 用户输入（对应 BridgePromptPackage.userPrompt） */
  input: string;
  /** 已存在的 thread id（resume 场景由 provider 注入） */
  threadId: string;
  /** 附件条目（codex 原生 attachment block；bridgeSystemAppend 中内联的 attachment snippet 仍走 input） */
  attachments?: Array<CodexAttachmentBlock>;
  /** effort 等级（codex 自有字段；映射自 plan.effort） */
  effort?: string;
}

export interface CodexAttachmentBlock {
  type: "text" | "image" | "file";
  refId?: string;
  path?: string;
  content?: string;
  mediaType?: string;
}

// ---------- item 事件（thread/start/turn/start 后由 codex 推送的通知） ----------

export interface CodexItemStartedParams {
  threadId: string;
  /** item 唯一 id（用于配对 delta/completed） */
  itemId: string;
  /** item 类型：message / tool_call / tool_result / file_change / thinking 等 */
  type: CodexItemType;
  /** tool 名（type=tool_call 时） */
  toolName?: string;
  /** tool call id（type=tool_call 时；用于配对 tool_result） */
  callId?: string;
  /** 子会话 id（subagent 场景） */
  sessionId?: string;
  parentToolUseId?: string;
}

export type CodexItemType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "file_change"
  | "thinking"
  | "command_execution"
  | "approval_request";

export interface CodexItemTextDeltaParams {
  threadId: string;
  itemId: string;
  /** 增量文本（assistant 文本流） */
  delta: string;
}

export interface CodexItemArgumentDeltaParams {
  threadId: string;
  itemId: string;
  /** tool call argument 增量（JSON 字符串片段） */
  delta: string;
}

export interface CodexItemCompletedParams {
  threadId: string;
  itemId: string;
  type: CodexItemType;
  /** 完整输出（type=message 时为完整文本；type=tool_result 时为输出文本） */
  text?: string;
  /** tool call 完整 input（type=tool_call 时，已组装好的 JSON 字符串） */
  toolInput?: string;
  /** tool name（type=tool_call/tool_result 时） */
  toolName?: string;
  /** callId（type=tool_call/tool_result 时） */
  callId?: string;
  /** tool 执行是否出错（type=tool_result 时） */
  isError?: boolean;
  /** file_change action + path（type=file_change 时） */
  fileAction?: "create" | "modify" | "delete";
  filePath?: string;
  /** item 总耗时（ms） */
  durationMs?: number;
}

// ---------- approval 请求 ----------

export interface CodexApprovalRequestParams {
  threadId: string;
  /** codex 服务端 approval request id */
  requestId: string;
  /** 审批类型：commandExecution / fileChange */
  kind: "commandExecution" | "fileChange";
  /** 命令/文件路径摘要 */
  description: string;
  /** 命令字符串（kind=commandExecution 时） */
  command?: string;
  /** 文件路径（kind=fileChange 时） */
  filePath?: string;
  /** file change action（kind=fileChange 时） */
  fileAction?: "create" | "modify" | "delete";
  /** 工具名（codex 视角） */
  toolName?: string;
  /** 输入摘要 */
  inputSummary?: string;
}

export interface CodexApprovalResponse {
  requestId: string;
  /** accept / acceptForSession / decline / cancel */
  outcome: "allow" | "allowSession" | "deny" | "cancel";
  /** 用户备注（可选） */
  note?: string;
}

// ---------- turn / thread 终态 ----------

export interface CodexTurnCompletedParams {
  threadId: string;
  /** turn 唯一 id */
  turnId: string;
  /** 最终 assistant 文本（与 item/completed itemId=message 一致） */
  finalText?: string;
  durationMs?: number;
  /** 终态 session id（审计用） */
  sessionId?: string;
}

export interface CodexTurnFailedParams {
  threadId: string;
  turnId: string;
  message: string;
  recoverable?: boolean;
  sessionId?: string;
}
