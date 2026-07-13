// LLM CLI Bridge — Codex app-server schema adapter (Round 2 SSOT)
//
// 官方 generate-ts 输出在 schema/generated/（顶层 = 官方 wire envelope + 少量公共类型）与
// schema/generated/v2/（具体 method 的 params/response/notification 类型），source=generated，
// 见 manifest.json。真实 codex-cli app-server 的 ClientRequest/ServerNotification/ServerRequest
// 三个判别联合（见 schema/generated/{ClientRequest,ServerNotification,ServerRequest}.ts）证实：
// 顶层与 v2 属于同一套协议——顶层是 wire envelope（method 判别式），v2 是具体 payload 类型，
// 不是"新旧两套协议"。
//
// 本文件是 Bridge 薄适配层：
// 1. 重新导出 generated 与 generated/v2 的全部类型（`export type *`）。
// 2. 只保留 Bridge JsonRpc wire 包装（不带 jsonrpc 字段）。
// 3. 提供 Codex* 别名 → 映射到 generated 类型，保持向后兼容（6 个 provider 内部消费者）。
//    别名优先直接等于 generated 类型；当真实 wire/legacy fixture 需要 generated 未覆盖的
//    字段（如 flat itemId/type/callId 等旧 fixture 字段）时，用 `Generated & { ... }` 的
//    thin 扩展承载，不再手写整套平行定义。
//
// 重新生成 generated/*：npm run codex:schema
// 校验 Codex* 别名字段是否与 generated 类型保持同步：npm run codex:schema:check
//
// Wire 协议要点（与官方 docs/generated schema 一致）：
// 1. JSON-RPC wire 不发送 "jsonrpc":"2.0" 字段（codex app-server 约定）。
//    请求/通知/响应均为 bare object：{ id, method, params } / { method, params } /
//    { id, result } / { id, error }。
// 2. 每个连接必须先 send `initialize`，收到 result 后 notify `initialized`，
//    之后才能发 thread/start 等业务请求。
// 3. initialize.params 使用官方 shape：
//      { clientInfo: { name, title, version }, capabilities: { experimentalApi: bool } }
// 4. thread/start response result shape: { thread: Thread }（Thread.id / Thread.sessionId）。
//    thread/start.params 为 generated ThreadStartParams（model/personality/... 顶层字段，
//    非 config 容器——config 字段仅用于 forward-compat 的自由 key-value，Bridge 侧审计用，
//    实际发送 wire 时会被剥离）。
// 5. thread/resume 用于恢复已有 threadId（不再把 resumeSessionId 塞进 thread/start）。
// 6. turn/start.input 为 UserInput content item array。
// 7. item 通知采用 nested params.item 结构（ItemStartedNotification / ItemCompletedNotification）。
// 8. item delta 通知（官方 method 名，见 ServerNotification 判别式）：
//      item/agentMessage/delta, item/reasoning/summaryTextDelta, item/reasoning/textDelta,
//      item/commandExecution/outputDelta, item/plan/delta, item/fileChange/outputDelta。
//    旧 item/text/delta 仅作为 fixture legacy alias，不作为主路径。
// 9. approval 不走 notification，而是 server-initiated request（带 id）：
//      item/commandExecution/requestApproval, item/fileChange/requestApproval
//    （见 ServerRequest 判别式）。client 按原 id 返回 result。
//      commandExecution decision: accept | acceptForSession | decline | cancel
//        （acceptWithExecpolicyAmendment / applyNetworkPolicyAmendment 为官方扩展对象变体，
//         Bridge 当前 UI 不支持发起这两种复杂流程，故 CodexCommandExecutionDecision 只暴露字符串子集）。
//      fileChange decision: accept | acceptForSession | decline | cancel
// 10. serverRequest/resolved 通知：官方只携带 threadId/requestId；itemId/decision 为
//     Bridge 扩展字段（server 侧未必回填，provider 用本地 bookkeeping 回填，见
//     CodexAppServerProvider.serverRequestBookkeeping）。
// 11. item/tool/requestUserInput 同为 server request，承载 agent 对用户的确认/选择请求。
//
// ⚠️ 已知偏差（见 docs 或 PR 说明，留待后续验证真实 wire 后收紧类型）：
// - 官方 turn/completed 判别式为 { threadId, turn: Turn }（Turn 内含 items/status/error），
//   不是 Bridge 目前解析的 flat { turnId, finalText, durationMs, sessionId }。
//   本轮只做类型级扩展保证编译通过与旧 fixture 兼容，未改写 mapper 的语义解析——
//   在没有真实 runtime 抓包验证前，改写解析逻辑有回归风险。
// - 官方 ServerNotification 判别式没有独立的 turn/failed 通知；失败态经由
//   turn/completed 携带 turn.status==="failed" + turn.error 表达。Bridge 仍保留
//   turn/failed handler（真实 runtime 若不发送，该 handler 只是永不触发，不影响其它路径）。
//
// 这些类型只被 codex-app-server / codex-managed-app-server provider 内部消费；
// UI 永远不直接 import 本文件。

export type * from "./generated";
export type * from "./generated/v2";
// generated/index.ts 与 generated/v2/index.ts 对以下 5 个类型各自重复 export 了一份
// （ts-rs 生成器把顶层与 v2 共享的枚举类型各生成一次），`export type *` 对同名类型会报
// TS2308 ambiguous export；显式重新导出以消除歧义（explicit export 优先于 `export *`）。
// 两处定义结构一致（见 generated/ExecPolicyAmendment.ts vs generated/v2/ExecPolicyAmendment.ts），
// 取 v2 版本无实质差异。
export type {
  ExecPolicyAmendment,
  NetworkPolicyAmendment,
  NetworkPolicyRuleAction,
  SessionSource,
  WebSearchAction,
} from "./generated/v2";

import type {
  ClientInfo,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
} from "./generated";
import type {
  AgentMessageDeltaNotification,
  CommandExecutionApprovalDecision,
  CommandExecutionOutputDeltaNotification,
  CommandExecutionRequestApprovalParams,
  FileChangeApprovalDecision,
  FileChangeOutputDeltaNotification,
  FileChangeRequestApprovalParams,
  ItemCompletedNotification,
  ItemStartedNotification,
  PlanDeltaNotification,
  ReasoningSummaryTextDeltaNotification,
  ReasoningTextDeltaNotification,
  ServerRequestResolvedNotification,
  Thread,
  ThreadItem,
  ThreadResumeParams,
  ThreadStartParams,
  ThreadTokenUsageUpdatedNotification,
  ToolRequestUserInputParams,
  TurnCompletedNotification,
  TurnDiffUpdatedNotification,
  TurnStartedNotification,
  TurnStartParams,
  UserInput,
} from "./generated/v2";

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

// ---------- initialize handshake（官方 shape，generated 别名） ----------

/** 客户端信息（官方 clientInfo 容器）。直接等于 generated ClientInfo。 */
export type CodexClientInfo = ClientInfo;

/**
 * 客户端能力声明（官方 capabilities 容器）。
 *
 * generated InitializeCapabilities 把 experimentalApi/requestAttestation 都设为必填；
 * Bridge 目前只声明 experimentalApi，其余能力位保留为可选 forward-compat 扩展点。
 */
export type CodexClientCapabilities = Partial<InitializeCapabilities>;

/**
 * initialize 请求参数。
 *
 * generated InitializeParams 的 capabilities 为必填 `InitializeCapabilities | null`；
 * Bridge 侧用可选 CodexClientCapabilities 覆盖，并保留 protocolVersion/cwd 兼容字段
 * （真实 codex-cli app-server 接受顶层 cwd，generated schema 未声明）。
 */
export type CodexInitializeParams = Omit<InitializeParams, "capabilities"> & {
  capabilities?: CodexClientCapabilities;
  /** 协议版本（codex app-server 约定；可选） */
  protocolVersion?: string;
  /** 工作目录 */
  cwd?: string;
};

/**
 * initialize 响应 result。
 *
 * generated InitializeResponse 已含 userAgent/codexHome/platformFamily/platformOs；
 * 额外保留 name/version/protocolVersion/capabilities 供旧版本 runtime 兼容读取。
 */
export type CodexInitializeResult = InitializeResponse & {
  protocolVersion?: string;
  name?: string;
  version?: string;
  capabilities?: Record<string, unknown>;
};

// ---------- thread / turn ----------

/** thread/start.config 自由 key-value 容器（审计用；wire 发送前会被剥离）。 */
export type CodexThreadConfig = Record<string, unknown>;

/**
 * thread/start 请求参数。
 *
 * 直接基于 generated ThreadStartParams（model/personality/approvalPolicy/sandbox/
 * developerInstructions/ephemeral/sessionStartSource 等官方顶层字段全部对齐）。
 * config 字段覆盖为宽松 Record（generated 要求 JsonValue，审计侧用 unknown 更方便）。
 */
export type CodexThreadStartParams = Omit<ThreadStartParams, "config"> & {
  config?: CodexThreadConfig;
};

/**
 * thread/start response result shape。
 *
 * 真实 codex-cli app-server 观测到的最小 shape 是 `{ thread: { id, sessionId? } }`；
 * generated ThreadStartResponse（v2 API 面）额外要求 model/modelProvider/cwd/
 * instructionSources/approvalPolicy/approvalsReviewer/sandbox/reasoningEffort 等字段，
 * 与 manifest.wireProtocolCalibration.threadStartResultShape 记录的真实观测不符，
 * 因此这里只从 generated Thread 抽取 id/sessionId 两个字段类型，不强制其余字段存在。
 */
export interface CodexThreadStartResult {
  thread: Pick<Thread, "id"> & Partial<Pick<Thread, "sessionId">>;
}

/**
 * thread/resume 请求参数。
 *
 * 基于 generated ThreadResumeParams；config 字段覆盖同 CodexThreadStartParams。
 */
export type CodexThreadResumeParams = Omit<ThreadResumeParams, "config"> & {
  config?: CodexThreadConfig;
};

/** thread/resume response result shape：与 thread/start 一致。 */
export type CodexThreadResumeResult = CodexThreadStartResult;

/**
 * turn/start 输入 content item（数组元素）。
 *
 * 直接等于 generated UserInput（text/image/localImage/skill/mention）。
 * "text" 变体的 text_elements 为必填数组（无特殊 UI 元素时传空数组）。
 */
export type CodexTurnInputItem = UserInput;

/** turn/start 请求参数。直接等于 generated TurnStartParams。 */
export type CodexTurnStartParams = TurnStartParams;

/** turn/started 通知参数（官方 shape：{ threadId, turn: { id } }）。 */
export interface CodexTurnStartedParams {
  threadId: string;
  turn: { id: string };
}

// ---------- ThreadItem（官方 nested item 结构，generated 别名） ----------

/** ThreadItem 判别联合。直接等于 generated ThreadItem（userMessage/agentMessage/plan/... 全量变体）。 */
export type CodexThreadItem = ThreadItem;

/**
 * ThreadItem.type 字面量联合，从 generated ThreadItem 派生（不再手写平行枚举），
 * 联合旧 fixture legacy 别名字符串（message/thinking/tool_call/tool_result/file_change）
 * ——mapper 仍需在 switch/case 中兼容这些旧 flat params.type 取值。
 */
export type CodexItemType =
  | ThreadItem["type"]
  | "message"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "file_change";

export type CodexCommandExecutionItem = Extract<ThreadItem, { type: "commandExecution" }>;
export type CodexFileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;
export type CodexMcpToolCallItem = Extract<ThreadItem, { type: "mcpToolCall" }>;
export type CodexDynamicToolCallItem = Extract<ThreadItem, { type: "dynamicToolCall" }>;

// ---------- item 事件通知（官方 nested params.item 结构） ----------

/**
 * item/started 通知参数。
 *
 * generated ItemStartedNotification 为 { item, threadId, turnId, startedAtMs }（全部必填）。
 * 旧 fixture 用 flat params（type/itemId/toolName/callId/sessionId/parentToolUseId 顶层）；
 * 以下字段作为 legacy alias 扩展保留，mapper 同时支持两种。
 */
export type CodexItemStartedParams = ItemStartedNotification & {
  /** @deprecated 改用 item.id */
  itemId?: string;
  /** @deprecated 改用 item.type */
  type?: CodexItemType;
  /** @deprecated 改用 item.command / item.tool 等 */
  toolName?: string;
  callId?: string;
  sessionId?: string;
  parentToolUseId?: string;
};

/**
 * item/completed 通知参数。
 *
 * generated ItemCompletedNotification 为 { item, threadId, turnId, completedAtMs }。
 * 旧 fixture flat 字段作为 legacy alias 扩展保留。
 */
export type CodexItemCompletedParams = ItemCompletedNotification & {
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
};

// ---------- item delta 通知（官方 method 名，generated 别名） ----------

/** item/agentMessage/delta 通知参数。直接等于 generated AgentMessageDeltaNotification。 */
export type CodexItemAgentMessageDeltaParams = AgentMessageDeltaNotification;

/** item/reasoning/summaryTextDelta 通知参数。直接等于 generated ReasoningSummaryTextDeltaNotification。 */
export type CodexItemReasoningSummaryTextDeltaParams = ReasoningSummaryTextDeltaNotification;

/** item/reasoning/textDelta 通知参数（raw reasoning）。直接等于 generated ReasoningTextDeltaNotification。 */
export type CodexItemReasoningTextDeltaParams = ReasoningTextDeltaNotification;

/** item/commandExecution/outputDelta 通知参数。直接等于 generated CommandExecutionOutputDeltaNotification。 */
export type CodexItemCommandExecutionOutputDeltaParams = CommandExecutionOutputDeltaNotification;

/** item/plan/delta 通知参数（EXPERIMENTAL）。直接等于 generated PlanDeltaNotification。 */
export type CodexItemPlanDeltaParams = PlanDeltaNotification;

/**
 * item/fileChange/outputDelta 通知参数。
 *
 * generated FileChangeOutputDeltaNotification 标注为 deprecated legacy 通知
 * （server 已不再发送），但 Bridge fixture/legacy runtime 仍可能收到，保留映射。
 */
export type CodexFileChangeOutputDeltaParams = FileChangeOutputDeltaNotification;

/** turn/diff/updated 通知参数。直接等于 generated TurnDiffUpdatedNotification，补充 legacy 字段。 */
export type CodexTurnDiffUpdatedParams = TurnDiffUpdatedNotification & {
  patch?: string;
  summary?: string;
};

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

// ---------- approval：server-initiated request（带 id，generated 别名） ----------
//
// codex app-server 的 approval 不走 notification，而是 server 主动发起的 request
// （消息带 id + method）。client 必须按原 id 返回 result（不是 notify）。
//
// 三种 server request（见 generated ServerRequest 判别式）：
// - item/commandExecution/requestApproval：命令执行审批
// - item/fileChange/requestApproval：文件变更审批
// - item/tool/requestUserInput：工具需要用户输入

/**
 * item/commandExecution/requestApproval 请求参数。
 *
 * 基于 generated CommandExecutionRequestApprovalParams；description/inputSummary 为
 * 旧 fixture legacy 字段（官方走 reason），保留兼容。
 */
export type CodexCommandExecutionApprovalRequestParams = CommandExecutionRequestApprovalParams & {
  /** @deprecated 旧 fixture 字段；官方走 reason */
  description?: string;
  inputSummary?: string;
};

/**
 * item/fileChange/requestApproval 请求参数。
 *
 * 基于 generated FileChangeRequestApprovalParams；filePath/fileAction/description/
 * inputSummary 为旧 fixture legacy 字段，保留兼容。
 */
export type CodexFileChangeApprovalRequestParams = FileChangeRequestApprovalParams & {
  /** @deprecated 旧 fixture 字段 */
  filePath?: string;
  fileAction?: "create" | "modify" | "delete";
  description?: string;
  inputSummary?: string;
};

/**
 * item/tool/requestUserInput 请求参数。
 *
 * 基于 generated ToolRequestUserInputParams；toolName/prompt/inputType/placeholder/
 * question/options 为旧 fixture legacy 字段（兼容 request_user_input 工具简写形状）。
 */
export type CodexToolUserInputRequestParams = ToolRequestUserInputParams & {
  toolName?: string;
  prompt?: string;
  inputType?: string;
  placeholder?: string;
  /** @deprecated 单题简写；官方走 questions[] */
  question?: string;
  /** @deprecated 单题选项简写；官方走 questions[].options */
  options?: unknown[];
};

/**
 * 官方 approval decision（commandExecution）。
 *
 * generated CommandExecutionApprovalDecision 还包含 acceptWithExecpolicyAmendment /
 * applyNetworkPolicyAmendment 两个携带 amendment payload 的对象变体；Bridge 当前审批 UI
 * 只支持简单三档（批准/替我审批/完全访问），不发起这两种复杂 amendment 流程，
 * 因此这里从 generated 类型中派生出字符串子集，不手写平行枚举。
 */
export type CodexCommandExecutionDecision = Extract<CommandExecutionApprovalDecision, string>;

/** 官方 approval decision（fileChange）。直接等于 generated FileChangeApprovalDecision。 */
export type CodexFileChangeDecision = FileChangeApprovalDecision;

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
  | { value: string; answers?: Record<string, string | readonly string[] | { answers: readonly string[] }>; supplement?: string }
  | { cancelled: true };

/**
 * serverRequest/resolved 通知：server 在处理完 client 返回的 decision 后推送，
 * 用于 UI 同步（标记 approval 已最终落地）。
 *
 * generated ServerRequestResolvedNotification 只有 { threadId, requestId }；
 * turnId/itemId/decision/note/outcome 为 Bridge 扩展字段——server 是否回填因版本而异，
 * provider 用本地 bookkeeping（serverRequestBookkeeping）回填缺失的 itemId/decision。
 */
export type CodexServerRequestResolvedParams = ServerRequestResolvedNotification & {
  turnId?: string;
  itemId?: string;
  /** 最终落地决策（与 client 返回一致或经 server 调整） */
  decision?: CodexCommandExecutionDecision | CodexFileChangeDecision;
  /** 备注（可选） */
  note?: string;
  // ---------- 旧 fixture 字段（allow/allowSession/deny；仅 legacy alias 用） ----------
  /** @deprecated 改用 decision（accept/acceptForSession/decline/cancel） */
  outcome?: "allow" | "allowSession" | "deny";
};

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
//
// ⚠️ 已知偏差：generated TurnCompletedNotification 为 { threadId, turn: Turn }
// （turn.items/turn.status/turn.error 承载最终结果），不是下面的 flat shape。
// 本轮只做类型扩展保证编译通过，未改写 mapper 解析语义（见文件头「已知偏差」说明）。

export type CodexTurnCompletedParams = Partial<TurnCompletedNotification> & {
  threadId: string;
  /** turn 唯一 id */
  turnId: string;
  /** 最终 assistant 文本（与 item/completed itemId=agentMessage 一致） */
  finalText?: string;
  durationMs?: number;
  /** 终态 session id（审计用） */
  sessionId?: string;
};

export interface CodexTurnFailedParams {
  threadId: string;
  turnId: string;
  message: string;
  recoverable?: boolean;
  sessionId?: string;
}

/** turn/started 通知参数别名（Bridge 内部命名沿用 CodexTurnStartedParams，见上方定义）。 */
export type CodexTurnStartedNotification = TurnStartedNotification;

// ---------- thread/tokenUsage/updated（上下文占用，非 timeline） ----------

/** `thread/tokenUsage/updated` notification params。直接等于 generated ThreadTokenUsageUpdatedNotification。 */
export type CodexThreadTokenUsageUpdatedParams = ThreadTokenUsageUpdatedNotification;
