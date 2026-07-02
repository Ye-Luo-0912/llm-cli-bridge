// LLM CLI Bridge — Codex app-server schema (V2.17-A Completion)
//
// ⚠️ PRELIMINARY / FIXTURE SCHEMA（V2.17-A Completion wire-protocol 校准版）
//
// 本文件为 codex app-server JSON-RPC 协议的初步手写类型，仅用于 V2.17-A Bridge Core
// provider skeleton 编译与 fixture 测试。当本机存在 codex CLI 时，应通过
//   codex app-server generate-ts --out ./src/runtime/providers/codex-app-server/schema
// 重新生成并覆盖本文件（参见 schema/manifest.json）。
//
// Wire 协议要点（已对齐 codex app-server 实际行为，fixture 测试覆盖）：
// 1. JSON-RPC wire 不发送 "jsonrpc":"2.0" 字段（codex app-server 约定）。
//    请求/通知/响应均为 bare object：{ id, method, params } / { method, params } /
//    { id, result } / { id, error }。
// 2. 每个连接必须先 send `initialize`，收到 result 后 notify `initialized`，
//    之后才能发 thread/start 等业务请求。
// 3. thread/start response result shape: { thread: { id, sessionId? } }。
// 4. turn/start.input 为 content item array，例如 [{ type:"text", text:userPrompt }]。
// 5. approval 不走 notification，而是 server-initiated request（带 id）：
//    - item/commandExecution/requestApproval（带 id）
//    - item/fileChange/requestApproval（带 id）
//    client 必须按原 request id 返回 decision response（{ id, result: { ... } }）。
// 6. item/tool/requestUserInput 同为 server request，当前转 unsupported/pending。
// 7. serverRequest/resolved 为 server 在收到 decision 后推送的通知（用于 UI 同步）。
//
// 这些类型只被 codex-app-server provider 内部消费；UI 永远不直接 import 本文件。

// ---------- 通用 JSON-RPC wire 包装（不带 jsonrpc 字段） ----------

/**
 * 客户端 → 服务端请求（wire 上不带 jsonrpc 字段）。
 */
export interface JsonRpcRequest<P = unknown> {
  id: number | string;
  method: string;
  params?: P;
}

/**
 * 客户端 → 服务端通知（无 id，无响应；wire 上不带 jsonrpc 字段）。
 */
export interface JsonRpcNotification<P = unknown> {
  method: string;
  params?: P;
}

/**
 * 服务端 → 客户端响应（成功；wire 上不带 jsonrpc 字段）。
 */
export interface JsonRpcResponseSuccess<R = unknown> {
  id: number | string;
  result: R;
}

/**
 * 服务端 → 客户端响应（失败；wire 上不带 jsonrpc 字段）。
 */
export interface JsonRpcResponseError {
  id: number | string;
  error: { code: number; message: string; data?: unknown };
}

/**
 * 客户端 → 服务端响应（针对 server-initiated request 的回复；wire 上不带 jsonrpc 字段）。
 */
export interface JsonRpcClientResponse<R = unknown> {
  id: number | string;
  result: R;
}

export type JsonRpcMessage<R = unknown> =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponseSuccess<R>
  | JsonRpcResponseError
  | JsonRpcClientResponse<R>;

// ---------- initialize handshake ----------

export interface CodexInitializeParams {
  /** 客户端名称（如 "llm-cli-bridge"） */
  clientName?: string;
  /** 客户端版本 */
  clientVersion?: string;
  /** 协议版本（codex app-server 约定；可选） */
  protocolVersion?: string;
  /** 工作目录 */
  cwd?: string;
}

export interface CodexInitializeResult {
  /** 服务端协议版本 */
  protocolVersion?: string;
  /** 服务端名称 */
  name?: string;
  /** 服务端版本 */
  version?: string;
  /** 服务端能力声明 */
  capabilities?: Record<string, unknown>;
}

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

/**
 * thread/start response result shape：{ thread: { id, sessionId? } }。
 *
 * codex app-server 把 thread 包在 result.thread 内，thread 自身含 id 与可选 sessionId。
 */
export interface CodexThreadStartResult {
  thread: {
    id: string;
    /** 服务端 session id（resume 用，可能与 thread.id 同） */
    sessionId?: string;
  };
}

/**
 * turn/start 输入 content item（数组元素）。
 *
 * codex app-server 的 turn/start.input 为 content item array，而非裸字符串。
 * 当前支持 text / image / file 三种 type。
 */
export type CodexTurnInputItem =
  | { type: "text"; text: string }
  | { type: "image"; refId?: string; path?: string; mediaType?: string; data?: string }
  | { type: "file"; refId?: string; path?: string; mediaType?: string };

export interface CodexTurnStartParams {
  /** 用户输入（content item array；对应 BridgePromptPackage.userPrompt 打包为 text item） */
  input: CodexTurnInputItem[];
  /** 已存在的 thread id（resume 场景由 provider 在 thread/start 后注入） */
  threadId: string;
  /** 附件条目（codex 原生 attachment block；与 input 数组互补，用于 image/file ref） */
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

// ---------- approval：server-initiated request（带 id） ----------
//
// codex app-server 的 approval 不走 notification，而是 server 主动发起的 request
// （消息带 id + method）。client 必须按原 id 返回 result（不是 notify）。
//
// 三种 server request：
// - item/commandExecution/requestApproval：命令执行审批
// - item/fileChange/requestApproval：文件变更审批
// - item/tool/requestUserInput：工具需要用户输入（当前转 unsupported/pending）

export interface CodexCommandExecutionApprovalRequestParams {
  threadId: string;
  /** 命令字符串 */
  command: string;
  /** 命令摘要（可选） */
  description?: string;
  /** 工作目录（可选） */
  cwd?: string;
  /** 输入摘要（可选） */
  inputSummary?: string;
}

export interface CodexFileChangeApprovalRequestParams {
  threadId: string;
  /** 文件路径 */
  filePath: string;
  /** file change action */
  fileAction: "create" | "modify" | "delete";
  /** 摘要（可选） */
  description?: string;
  /** 输入摘要（可选） */
  inputSummary?: string;
}

export interface CodexToolUserInputRequestParams {
  threadId: string;
  /** 工具名 */
  toolName: string;
  /** 提示语 */
  prompt: string;
  /** 输入类型（如 "text" / "secret"） */
  inputType?: string;
}

/**
 * 客户端返回给 server 的 approval/user-input 响应 result。
 *
 * - approval：{ decision: "allow"|"allowSession"|"deny", note? }
 * - user input：{ value: string } 或 { cancelled: true }
 */
export type CodexServerRequestResult =
  | { decision: "allow" | "allowSession" | "deny"; note?: string }
  | { value: string }
  | { cancelled: true };

/**
 * serverRequest/resolved 通知：server 在处理完 client 返回的 decision 后推送，
 * 用于 UI 同步（标记 approval 已最终落地）。
 */
export interface CodexServerRequestResolvedParams {
  /** 原 server request id */
  requestId: number | string;
  /** 最终落地决策（与 client 返回一致或经 server 调整） */
  decision: "allow" | "allowSession" | "deny";
  /** 备注（可选） */
  note?: string;
}

// ---------- 旧 approval notification 类型（已废弃，仅保留供迁移参考） ----------
//
// ⚠️ approval/request notification 与 approval/respond notification 已废弃。
// 新 wire 协议下 approval 走 server-initiated request + client response。
// 以下类型仅供 EventMapper/ApprovalMapper 内部旧逻辑迁移参考，不再在 wire 上出现。

/** @deprecated 改用 CodexCommandExecutionApprovalRequestParams / CodexFileChangeApprovalRequestParams */
export interface CodexApprovalRequestParams {
  threadId: string;
  requestId: string;
  kind: "commandExecution" | "fileChange";
  description: string;
  command?: string;
  filePath?: string;
  fileAction?: "create" | "modify" | "delete";
  toolName?: string;
  inputSummary?: string;
}

/** @deprecated 改用 CodexServerRequestResult */
export interface CodexApprovalResponse {
  requestId: string;
  outcome: "allow" | "allowSession" | "deny" | "cancel";
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
