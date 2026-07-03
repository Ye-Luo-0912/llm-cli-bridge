// LLM CLI Bridge — Codex app-server schema (V2.17-A Completion)
//
// ⚠️ OFFICIAL-SCHEMA-ALIGNED（V2.17-A Completion 主线闭环）
//
// 本文件对齐 codex app-server 官方 JSON-RPC 协议（docs / generated schema）：
//   https://www.mintlify.com/openai/codex/api/items
//   https://www.codex-docs.com/automation/app-server/
// 当本机存在 codex CLI 时，应通过
//   codex app-server generate-ts --out ./src/runtime/providers/codex-app-server/schema
// 重新生成并覆盖本文件（参见 schema/manifest.json）。
//
// Wire 协议要点（与官方 docs/generated schema 一致）：
// 1. JSON-RPC wire 不发送 "jsonrpc":"2.0" 字段（codex app-server 约定）。
//    请求/通知/响应均为 bare object：{ id, method, params } / { method, params } /
//    { id, result } / { id, error }。
// 2. 每个连接必须先 send `initialize`，收到 result 后 notify `initialized`，
//    之后才能发 thread/start 等业务请求。
// 3. initialize.params 使用官方 shape：
//      { clientInfo: { name, title, version }, capabilities: { experimentalApi: bool } }
//    不再使用 clientName/clientVersion 顶层字段。
//    experimental fields 必须显式 experimentalApi=true。
// 4. thread/start response result shape: { thread: { id } }。
//    thread/start.params 使用 config: { model, sandboxPolicy, personality } 容器。
// 5. thread/resume 用于恢复已有 threadId（不再把 resumeSessionId 塞进 thread/start）。
// 6. turn/start.input 为 content item array，例如 [{ type:"text", text:userPrompt }]。
// 7. item 通知采用 nested params.item 结构：
//      item/started   params: { threadId, turnId, item: { type, id, ... } }
//      item/completed params: { threadId, turnId, item: { type, id, ...finalItem } }
//    不再使用 flat params（type/itemId 顶层字段）。
// 8. item delta 通知（官方 method 名）：
//      item/agentMessage/delta            → agent 文本流（驱动 finalAnswer）
//      item/reasoning/summaryTextDelta    → reasoning summary 流（→ thinking）
//      item/reasoning/textDelta           → reasoning raw text 流（→ thinking）
//      item/commandExecution/outputDelta  → 命令输出流（→ tool progress）
//      item/plan/delta                    → plan 流（experimental，→ thinking/progress）
//      item/fileChange/outputDelta        → file change 流（→ tool progress）
//    旧 item/text/delta 仅作为 fixture legacy alias，不作为主路径。
// 9. approval 不走 notification，而是 server-initiated request（带 id）：
//      item/commandExecution/requestApproval（带 id）
//      item/fileChange/requestApproval（带 id）
//    client 按原 id 返回 result（{ decision: ... }）。
//    官方 decision：
//      commandExecution: accept | acceptForSession | acceptWithExecpolicyAmendment
//                        | applyNetworkPolicyAmendment | decline | cancel
//      fileChange:       accept | decline
//    不再在 wire 层使用 allow/allowSession/deny。
// 10. serverRequest/resolved 通知：携带 requestId/threadId/turnId/itemId/decision，
//     用于 UI 同步（标记 approval 已落地）。
// 11. item/tool/requestUserInput 同为 server request，承载 agent 对用户的确认/选择请求。
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

// ---------- initialize handshake（官方 shape） ----------

/**
 * 客户端信息（官方 clientInfo 容器）。
 *
 * 替代旧 clientName/clientVersion 顶层字段。
 */
export interface CodexClientInfo {
  /** 客户端名称（如 "llm-cli-bridge"） */
  name: string;
  /** 客户端显示标题（如 "LLM CLI Bridge"） */
  title?: string;
  /** 客户端版本 */
  version: string;
}

/**
 * 客户端能力声明（官方 capabilities 容器）。
 *
 * experimentalApi=true 时才能使用 experimental fields（如 item/plan/delta）。
 * 默认 experimentalApi=false。
 */
export interface CodexClientCapabilities {
  /** 是否启用 experimental API；默认 false */
  experimentalApi?: boolean;
}

/**
 * initialize 请求参数（官方 shape）。
 *
 * 使用 clientInfo + capabilities 容器，不再使用 clientName/clientVersion 顶层字段。
 */
export interface CodexInitializeParams {
  /** 客户端信息（官方容器，替代 clientName/clientVersion） */
  clientInfo: CodexClientInfo;
  /** 客户端能力声明（experimentalApi 默认 false） */
  capabilities?: CodexClientCapabilities;
  /** 协议版本（codex app-server 约定；可选） */
  protocolVersion?: string;
  /** 工作目录 */
  cwd?: string;
}

/**
 * initialize 响应 result（官方 shape）。
 *
 * 官方字段：userAgent / codexHome / platformFamily / platformOs。
 */
export interface CodexInitializeResult {
  /** 服务端协议版本（部分版本返回） */
  protocolVersion?: string;
  /** 服务端 user-agent 字符串（如 "probe/0.124.0 (Arch Linux ...) ghostty/1.3.1"） */
  userAgent?: string;
  /** codex home 目录（如 "/home/user/.codex"） */
  codexHome?: string;
  /** 平台 family（如 "unix" / "windows"） */
  platformFamily?: string;
  /** 平台 OS（如 "linux" / "macos"） */
  platformOs?: string;
  /** 服务端名称（旧字段，部分版本返回；保留兼容） */
  name?: string;
  /** 服务端版本（旧字段，部分版本返回；保留兼容） */
  version?: string;
  /** 服务端能力声明 */
  capabilities?: Record<string, unknown>;
}

// ---------- thread / turn ----------

/**
 * thread/start.config 容器（官方 shape）。
 *
 * codex app-server 把 model / sandboxPolicy / personality 等放在 config 子对象内。
 */
export interface CodexThreadConfig {
  /** 模型 id（如 gpt-5.5）；省略时由 codex 自行选默认 */
  model?: string;
  /** 沙箱策略（如 "workspaceWrite" / "readOnly" / "dangerFullAccess"） */
  sandboxPolicy?: string;
  /** personality（如 "pragmatic"） */
  personality?: string;
  /** 其他官方 config 字段（forward-compatible） */
  [key: string]: unknown;
}

/**
 * thread/start 请求参数（官方 shape：config 容器）。
 *
 * bridgeSystemAppend 走 instructions 字段（codex app-server 文档明确支持）。
 * 不再把 resumeSessionId 塞进 thread/start；resume 走 thread/resume。
 */
export interface CodexThreadStartParams {
  /** 官方 config 容器（model/sandboxPolicy/personality） */
  config?: CodexThreadConfig;
  /** Codex instructions 层（对应 BridgePromptPackage.bridgeSystemAppend 的映射目标之一） */
  instructions?: string;
  /** Codex config/rules 层（key-value；bridgeSystemAppend 可拆解到此） */
  configRules?: Record<string, unknown>;
  /** 工作目录 */
  cwd?: string;

  // ---------- 兼容字段（旧 fixture 用；新代码应使用 config 容器） ----------
  /** @deprecated 改用 config.model */
  model?: string;
}

/**
 * thread/start response result shape：{ thread: { id } }。
 *
 * codex app-server 把 thread 包在 result.thread 内。
 * sessionId 仅在部分版本返回（resume 时优先用 thread/resume 而非依赖此字段）。
 */
export interface CodexThreadStartResult {
  thread: {
    id: string;
    /** 服务端 session id（部分版本返回；resume 用，可能与 thread.id 同） */
    sessionId?: string;
  };
}

/**
 * thread/resume 请求参数（官方 shape）。
 *
 * 用于恢复已有 threadId。不再把 resumeSessionId 塞进 thread/start 伪恢复。
 */
export interface CodexThreadResumeParams {
  /** 要恢复的 thread id（来自前一次 thread/start result.thread.id） */
  threadId: string;
  /** 可选 config 覆盖（如覆盖 model/sandboxPolicy） */
  config?: CodexThreadConfig;
  /** 工作目录 */
  cwd?: string;
}

/**
 * thread/resume response result shape：与 thread/start 一致。
 */
export interface CodexThreadResumeResult {
  thread: {
    id: string;
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
  /** 已存在的 thread id（resume 场景由 provider 在 thread/start 或 thread/resume 后注入） */
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

/**
 * turn/started 通知参数（官方 shape）。
 */
export interface CodexTurnStartedParams {
  threadId: string;
  turn: { id: string };
}

// ---------- ThreadItem（官方 nested item 结构） ----------
//
// item/started 与 item/completed 的 params.item 是 ThreadItem。
// 每个 item 有明确的 type 与 id，其余字段按 type 不同。
// 官方 item 类型：userMessage / agentMessage / plan / reasoning / commandExecution /
// fileChange / mcpToolCall / dynamicToolCall / webSearch / imageView /
// enteredReviewMode / exitedReviewMode / contextCompaction。

export type CodexItemType =
  | "userMessage"
  | "agentMessage"
  | "plan"
  | "reasoning"
  | "commandExecution"
  | "fileChange"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "webSearch"
  | "imageView"
  | "enteredReviewMode"
  | "exitedReviewMode"
  | "contextCompaction"
  // 旧 fixture 兼容类型（仅 legacy alias 路径用；新 schema 用驼峰）
  | "message"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "approval_request"
  | "file_change";

/**
 * ThreadItem 基础字段（所有 type 共有）。
 */
export interface CodexThreadItemBase {
  type: CodexItemType;
  /** item 唯一 id（用于配对 delta/completed） */
  id: string;
}

/**
 * agentMessage item（官方 type）。
 *
 * text 为累积的 agent 回复文本；item/agentMessage/delta 的 delta 拼接应等于 completed 时的 text。
 */
export interface CodexAgentMessageItem extends CodexThreadItemBase {
  type: "agentMessage";
  text: string;
  phase?: string;
}

/**
 * plan item（EXPERIMENTAL）。
 */
export interface CodexPlanItem extends CodexThreadItemBase {
  type: "plan";
  text: string;
}

/**
 * reasoning item。
 *
 * summary 为 reasoning 摘要数组（OpenAI 模型）；content 为 raw reasoning blocks（开源模型）。
 */
export interface CodexReasoningItem extends CodexThreadItemBase {
  type: "reasoning";
  summary?: string[];
  content?: string[];
}

/**
 * commandExecution item。
 */
export interface CodexCommandExecutionItem extends CodexThreadItemBase {
  type: "commandExecution";
  command: string | string[];
  cwd?: string;
  processId?: string;
  status?: "inProgress" | "completed" | "failed" | "declined";
  commandActions?: unknown[];
  aggregatedOutput?: string;
  exitCode?: number;
  durationMs?: number;
}

/**
 * fileChange item。
 */
export interface CodexFileChangeChange {
  path: string;
  kind: "create" | "modify" | "delete";
  diff?: string;
}

export interface CodexFileChangeItem extends CodexThreadItemBase {
  type: "fileChange";
  changes: CodexFileChangeChange[];
  status?: "inProgress" | "completed" | "failed" | "declined";
}

/**
 * mcpToolCall item。
 */
export interface CodexMcpToolCallItem extends CodexThreadItemBase {
  type: "mcpToolCall";
  server: string;
  tool: string;
  status?: "inProgress" | "completed" | "failed";
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  durationMs?: number;
}

/**
 * dynamicToolCall item。
 */
export interface CodexDynamicToolCallItem extends CodexThreadItemBase {
  type: "dynamicToolCall";
  tool: string;
  arguments?: Record<string, unknown>;
  status?: "inProgress" | "completed" | "failed";
  contentItems?: unknown[];
  success?: boolean;
  durationMs?: number;
}

/**
 * webSearch item。
 */
export interface CodexWebSearchItem extends CodexThreadItemBase {
  type: "webSearch";
  query: string;
  action?: unknown;
}

/**
 * imageView item。
 */
export interface CodexImageViewItem extends CodexThreadItemBase {
  type: "imageView";
  path: string;
}

/**
 * enteredReviewMode / exitedReviewMode item。
 */
export interface CodexReviewModeItem extends CodexThreadItemBase {
  type: "enteredReviewMode" | "exitedReviewMode";
  review: string;
}

/**
 * contextCompaction item。
 */
export interface CodexContextCompactionItem extends CodexThreadItemBase {
  type: "contextCompaction";
}

/**
 * userMessage item。
 */
export interface CodexUserInputItem {
  type: "text" | "image" | "localImage" | "skill" | "mention";
  text?: string;
  [key: string]: unknown;
}

export interface CodexUserMessageItem extends CodexThreadItemBase {
  type: "userMessage";
  content: CodexUserInputItem[];
}

/**
 * ThreadItem 联合类型（官方 item 结构）。
 */
export type CodexThreadItem =
  | CodexAgentMessageItem
  | CodexPlanItem
  | CodexReasoningItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexDynamicToolCallItem
  | CodexWebSearchItem
  | CodexImageViewItem
  | CodexReviewModeItem
  | CodexContextCompactionItem
  | CodexUserMessageItem;

// ---------- item 事件通知（官方 nested params.item 结构） ----------

/**
 * item/started 通知参数（官方 shape：nested params.item）。
 *
 * 官方：params: { threadId, turnId, item: { type, id, ... } }
 * 旧 fixture 使用 flat params（type/itemId 顶层）；mapper 同时支持两种。
 */
export interface CodexItemStartedParams {
  threadId: string;
  turnId?: string;
  /** nested item（官方 shape） */
  item?: CodexThreadItem;
  // ---------- flat 兼容字段（旧 fixture；新 schema 走 item.*） ----------
  /** @deprecated 改用 item.id */
  itemId?: string;
  /** @deprecated 改用 item.type */
  type?: CodexItemType;
  /** @deprecated 改用 item.command / item.tool 等 */
  toolName?: string;
  callId?: string;
  sessionId?: string;
  parentToolUseId?: string;
}

/**
 * item/completed 通知参数（官方 shape：nested params.item）。
 */
export interface CodexItemCompletedParams {
  threadId: string;
  turnId?: string;
  /** nested item（官方 shape，含最终字段） */
  item?: CodexThreadItem;
  // ---------- flat 兼容字段（旧 fixture；新 schema 走 item.*） ----------
  /** @deprecated 改用 item.id */
  itemId?: string;
  /** @deprecated 改用 item.type */
  type?: CodexItemType;
  /** @deprecated 改用 item.text（agentMessage）/ item.aggregatedOutput（commandExecution） */
  text?: string;
  /** @deprecated 改用 item.arguments（mcpToolCall/dynamicToolCall） */
  toolInput?: string;
  toolName?: string;
  callId?: string;
  isError?: boolean;
  /** @deprecated 改用 item.changes[].kind / item.changes[].path */
  fileAction?: "create" | "modify" | "delete";
  filePath?: string;
  durationMs?: number;
}

// ---------- item delta 通知（官方 method 名） ----------

/**
 * item/agentMessage/delta 通知参数（官方）。
 *
 * delta 为 agent 文本流增量；按 itemId 拼接得到完整 agentMessage.text。
 * 这是驱动 AssistantTurnView.finalAnswer 的主路径。
 */
export interface CodexItemAgentMessageDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  delta: string;
}

/**
 * item/reasoning/summaryTextDelta 通知参数（官方）。
 *
 * delta 为 reasoning summary 流增量；summaryIndex 标记 summary 段索引。
 */
export interface CodexItemReasoningSummaryTextDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  summaryIndex: number;
  delta: string;
}

/**
 * item/reasoning/textDelta 通知参数（官方，raw reasoning）。
 *
 * delta 为 raw reasoning text 流增量（开源模型）。
 */
export interface CodexItemReasoningTextDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  delta: string;
}

/**
 * item/commandExecution/outputDelta 通知参数（官方）。
 *
 * delta 为命令 stdout/stderr 流增量；累加为 tool progress。
 */
export interface CodexItemCommandExecutionOutputDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  delta: string;
}

/**
 * item/plan/delta 通知参数（官方，EXPERIMENTAL）。
 *
 * 需要 experimentalApi=true。delta 为 plan 文本流增量。
 * completed plan item 是权威的，可能与 delta 拼接不一致。
 */
export interface CodexItemPlanDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  delta: string;
}

/**
 * item/fileChange/outputDelta 通知参数（官方）。
 */
export interface CodexFileChangeOutputDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  delta: string;
}

/**
 * item/text/delta 通知参数（⚠️ legacy alias only）。
 *
 * 仅作为 fixture legacy alias，不作为主路径。新 schema 使用 item/agentMessage/delta。
 */
export interface CodexItemTextDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  /** 增量文本（assistant 文本流） */
  delta: string;
}

/**
 * item/argument/delta 通知参数（旧 fixture；官方走 mcpToolCall/dynamicToolCall item 字段）。
 */
export interface CodexItemArgumentDeltaParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  /** tool call argument 增量（JSON 字符串片段） */
  delta: string;
}

// ---------- approval：server-initiated request（带 id） ----------
//
// codex app-server 的 approval 不走 notification，而是 server 主动发起的 request
// （消息带 id + method）。client 必须按原 id 返回 result（不是 notify）。
//
// 三种 server request：
// - item/commandExecution/requestApproval：命令执行审批
// - item/fileChange/requestApproval：文件变更审批
// - item/tool/requestUserInput：工具需要用户输入

export interface CodexCommandExecutionApprovalRequestParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  /** 命令（官方为数组形式，如 ["rm", "-rf", "/tmp/test"]；兼容字符串） */
  command: string[] | string;
  /** 工作目录 */
  cwd?: string;
  /** 命令动作解析 */
  commandActions?: unknown[];
  /** 原因（可选） */
  reason?: string;
  /** @deprecated 旧 fixture 字段 */
  description?: string;
  inputSummary?: string;
}

export interface CodexFileChangeApprovalRequestParams {
  threadId: string;
  turnId?: string;
  itemId: string;
  /** 原因（可选） */
  reason?: string;
  /** @deprecated 旧 fixture 字段 */
  filePath?: string;
  fileAction?: "create" | "modify" | "delete";
  description?: string;
  inputSummary?: string;
}

export interface CodexToolUserInputRequestParams {
  threadId: string;
  turnId?: string;
  itemId?: string;
  /** 工具名 */
  toolName: string;
  /** 提示语 */
  prompt: string;
  /** 输入类型（如 "text" / "secret"） */
  inputType?: string;
  /** 可选：输入框占位 */
  placeholder?: string;
  /** 可选：结构化问题（兼容 request_user_input 工具形状） */
  questions?: unknown[];
  /** 可选：单题简写 */
  question?: string;
  /** 可选：单题选项简写 */
  options?: unknown[];
}

/**
 * 官方 approval decision（commandExecution）。
 *
 * - accept:                           允许本次
 * - acceptForSession:                 本会话允许
 * - acceptWithExecpolicyAmendment:    允许并持久化规则（commandExecution 专用扩展位）
 * - applyNetworkPolicyAmendment:      应用网络策略规则
 * - decline:                          拒绝
 * - cancel:                           拒绝并中断 turn
 */
export type CodexCommandExecutionDecision =
  | "accept"
  | "acceptForSession"
  | "acceptWithExecpolicyAmendment"
  | "applyNetworkPolicyAmendment"
  | "decline"
  | "cancel";

/**
 * 官方 approval decision（fileChange）。
 *
 * - accept:  允许
 * - decline: 拒绝
 */
export type CodexFileChangeDecision = "accept" | "decline";

/**
 * 客户端返回给 server 的 approval/user-input 响应 result（官方 shape）。
 *
 * - commandExecution approval：{ decision: CodexCommandExecutionDecision, note? }
 * - fileChange approval：       { decision: CodexFileChangeDecision, note? }
 * - user input：                { value: string } 或 { cancelled: true }
 *
 * 不再在 wire 层使用 allow/allowSession/deny。
 */
export type CodexServerRequestResult =
  | { decision: CodexCommandExecutionDecision; note?: string }
  | { decision: CodexFileChangeDecision; note?: string }
  | { value: string }
  | { cancelled: true };

/**
 * serverRequest/resolved 通知：server 在处理完 client 返回的 decision 后推送，
 * 用于 UI 同步（标记 approval 已最终落地）。
 *
 * 携带真实 requestId/threadId/turnId/itemId/decision，UI 据此同步。
 */
export interface CodexServerRequestResolvedParams {
  /** 原 server request id */
  requestId: number | string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  /** 最终落地决策（与 client 返回一致或经 server 调整） */
  decision: CodexCommandExecutionDecision | CodexFileChangeDecision;
  /** 备注（可选） */
  note?: string;
  // ---------- 旧 fixture 字段（allow/allowSession/deny；仅 legacy alias 用） ----------
  /** @deprecated 改用 decision（accept/acceptForSession/decline/cancel） */
  outcome?: "allow" | "allowSession" | "deny";
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
  /** 最终 assistant 文本（与 item/completed itemId=agentMessage 一致） */
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
