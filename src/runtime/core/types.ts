// LLM CLI Bridge — Runtime Bridge Core Types (V2.17-A Completion)
//
// Bridge Core 是 UI 与具体 runtime（Codex app-server / Claude SDK / Claude CLI / mock）
// 之间的中立层。UI 只消费 AssistantTurnView，不直接接触 SDKMessage / JSON-RPC message /
// WorkflowEvent / AgentEvent 等任何 provider 私有事件模型。
//
// 本文件定义 Bridge Core 的全部核心类型：
// - RunInput / EffectiveRunPlan / BridgePromptPackage / AttachmentEntry
// - NormalizedRuntimeEvent（provider-neutral 事件模型）
// - ApprovalRequest / ApprovalResponse / PermissionBoundary
// - AssistantTurnView（UI 唯一消费的 turn 视图）
// - BridgeSession / RunContext / ProviderId
//
// 设计原则：
// 1. provider-neutral：所有类型不带任何 provider 私有字段名（不出现 thread.run /
//    stream_event / canUseTool / item/started 等）。
// 2. 单一真相源：EffectiveRunPlan 是每次运行的唯一派生源，所有 provider 从同一 plan
//    构造自己的 options/argv/env。
// 3. UI 安全：AssistantTurnView 字段固定（process/thought/tools/fileChanges/
//    approvals/finalAnswer/warnings/errors），raw provider events 仅在 developerMode
//    通过 rawProviderEvents 字段暴露。
// 4. 不破坏现有 V2.17-A 过渡层：EffectiveRunPlan 复用 src/types.ts 的定义，通过
//    re-export 保持单一真相源。

import type { ClaudePermissionMode, PermissionPolicy } from "../../types";
import type { EffectiveRunPlan } from "../../types";
import type { SdkStreamingInput } from "../../agentBackend";
import type { RuntimeFileToolAdapter } from "../../runtimeFileToolAdapter";

// re-export：EffectiveRunPlan / AttachmentPlan 是 Bridge Core 与现有过渡层共享的真相源
export type { EffectiveRunPlan, AttachmentPlan } from "../../types";

// ---------- Provider 标识 ----------

/**
 * Runtime provider 标识。
 *
 * - codex-app-server: 主目标 provider，通过 codex app-server JSON-RPC over stdio 通信
 * - claude-sdk:       Claude Agent SDK（@anthropic-ai/claude-agent-sdk），作为 provider adapter 保留
 * - claude-cli:       Claude Code CLI（claude -p），作为 provider adapter 保留
 * - mock:             开发/测试用 mock provider
 */
export type ProviderId = "codex-app-server" | "claude-sdk" | "claude-cli" | "mock";

// ---------- RunInput ----------

/**
 * 一次运行的输入（provider-neutral）。
 *
 * view 层构造 RunInput，交给 BridgeSession 选择 provider 并 buildPlan。
 * RunInput 不含 backend/model/effort/permission —— 这些由 settings + provider 共同决定，
 * 在 buildPlan 阶段聚合成 EffectiveRunPlan。
 */
export interface RunInput {
  /** 用户原始输入文本（不含 bridge-native 指令） */
  userMessage: string;
  /** 工作目录（Vault 根目录） */
  cwd: string;
  /** 是否包含活动笔记上下文 */
  includeActiveNote: boolean;
  /** 是否包含选区上下文 */
  includeSelection: boolean;
  /** V2.16-E: 有图片/blob 附件时 SDK/Codex 使用 streaming input；CLI 忽略 */
  sdkStreamingInput?: SdkStreamingInput;
  /** V2.14.0-K: runtime read-only file tool adapter */
  runtimeFileToolAdapter?: RuntimeFileToolAdapter;
  /** Provider-neutral prompt 拆分包（view 层构造，provider 从中派生 instructions/prompt/input） */
  promptPackage: BridgePromptPackage;
  /** 任务创建时间 ISO */
  createdAt: string;
}

// ---------- BridgePromptPackage ----------

/**
 * Provider-neutral prompt 拆分包。
 *
 * 每次运行由 BridgePromptPackageBuilder 构造一次，所有 provider 从同一包派生自己的
 * instructions/prompt/input：
 * - claude-sdk:  claude_code preset + bridgeSystemAppend 追加到 systemPrompt append
 * - claude-cli:  bridgeSystemAppend + userPrompt 合成 stdin
 * - codex-app-server: userPrompt 作为 turn/start input；bridgeSystemAppend 映射到 Codex
 *   instructions/config/rules 层；若暂不可用则作为 provider preamble，但必须单独标记来源
 *
 * auditHash 用于跨 provider 一致性审计（同一输入下所有 provider 的 auditHash 必须一致）。
 */
export interface BridgePromptPackage {
  /** bridge-native 指令（native handoff / sensitive path / attachment policy / tool steering） */
  bridgeSystemAppend: string;
  /** 用户正文（用户输入 + 用户附件 inline 内容 + 上下文片段） */
  userPrompt: string;
  /** 附件条目（entry-level 审计：每条附件的 refId/kind/scope/fileType/packing） */
  attachmentEntries: ReadonlyArray<AttachmentEntry>;
  /** 整包审计哈希（djb2 变体，跨 provider 一致性校验用） */
  auditHash: string;
}

/**
 * 附件条目（entry-level 审计）。
 *
 * 每个附件单独记录其 packing 决策，便于审计与跨 provider 一致性校验。
 */
export interface AttachmentEntry {
  refId: string;
  displayName: string;
  kind: "vault" | "external" | "attachment";
  scope: "message" | "pinned" | "session";
  fileType: "image" | "text" | "markdown" | "json" | "pdf" | "binary" | "unknown";
  packing: "inline-snippet" | "sdk-streaming-block" | "native-ref-only";
  bytesRead?: number;
  truncated?: boolean;
}

// ---------- NormalizedRuntimeEvent ----------

/**
 * Provider-neutral 运行时事件。
 *
 * 所有 provider（codex-app-server / claude-sdk / claude-cli / mock）都把各自的私有事件
 * 模型映射为 NormalizedRuntimeEvent 后再喂给 BridgeSession。UI 只消费 AssistantTurnView，
 * 不直接接触 NormalizedRuntimeEvent —— 但 AssistantTurnViewBuilder 从 NormalizedRuntimeEvent
 * 聚合出 AssistantTurnView。
 *
 * rawProviderEvent 仅在 developerMode 下填充，供 raw log 展示；普通用户态不渲染。
 */
export interface NormalizedRuntimeEvent {
  /** 事件来源 provider */
  readonly providerId: ProviderId;
  /** 事件时间戳 ISO */
  readonly timestamp: string;
  /** 事件负载（判别联合） */
  readonly payload: NormalizedRuntimeEventPayload;
  /**
   * 原始 provider 事件（仅 developerMode 填充；JSON-RPC message / SDKMessage /
   * CLI stdout line 等）。UI 不直接消费，只在 raw log 面板展示。
   */
  readonly rawProviderEvent?: unknown;
}

export type NormalizedRuntimeEventPayload =
  | { kind: "session_started"; text: string; sessionId?: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "message";
      role: "assistant" | "system";
      text: string;
      /** partial=true 表示流式增量；false/undefined 表示完整快照 */
      partial?: boolean;
      sessionId?: string;
      parentToolUseId?: string;
    }
  | {
      kind: "tool_start";
      toolName: string;
      toolInput: string;
      callId: string;
      sessionId?: string;
      parentToolUseId?: string;
    }
  | {
      kind: "tool_result";
      callId: string;
      toolName: string;
      output: string;
      isError: boolean;
    }
  | { kind: "file_change"; action: "create" | "modify" | "delete"; path: string; additions?: number; deletions?: number }
  | {
      kind: "progress";
      label: string;
      detail?: string;
      category?: "request" | "thinking" | "tool" | "status" | "notice";
    }
  | {
      kind: "approval_request";
      requestId: string;
      toolName: string;
      description: string;
      riskLevel: "low" | "medium" | "high";
      riskReason?: string;
      highRiskFlags?: ReadonlyArray<string>;
      inputSummary?: string;
      mergeKey?: string;
      sessionId?: string;
      parentToolUseId?: string;
      subagentRisk?: string;
    }
  | {
      kind: "user_input_request";
      requestId: string;
      toolName: string;
      prompt: string;
      inputType?: "text" | "secret";
      questions?: ReadonlyArray<UserInputQuestion>;
      placeholder?: string;
    }
  | {
      kind: "approval_resolved";
      requestId: string;
      response: ApprovalResponse;
      source: "user" | "session_allow" | "session_deny" | "mode";
    }
  | {
      kind: "user_input_resolved";
      requestId: string;
      response: UserInputResponse;
      source: "user" | "cancel";
    }
  | { kind: "error"; message: string; recoverable: boolean }
  | { kind: "stdout_delta"; data: string }
  | { kind: "stderr_delta"; data: string }
  | { kind: "completed"; text: string; durationMs?: number; sessionId?: string }
  | { kind: "failed"; message: string; recoverable: boolean; sessionId?: string };

// ---------- Approval / PermissionBoundary ----------

/**
 * 用户对 approval 请求的响应（provider-neutral）。
 *
 * - accept:             允许本次（allow once）
 * - acceptForSession:   本会话允许（allow session）
 * - decline:            只拒绝本次，不写 deniesList（deny once）
 * - declineForSession:  本会话拒绝，写 deniesList，下次同 mergeKey auto-deny
 * - cancel:             取消整个 run（用户点停止按钮时）
 */
export type ApprovalResponse =
  | { type: "accept" }
  | { type: "acceptForSession" }
  | { type: "decline" }
  | { type: "declineForSession" }
  | { type: "cancel" };

export interface UserInputOption {
  readonly label: string;
  readonly description?: string;
  readonly value?: string;
}

export interface UserInputQuestion {
  readonly id: string;
  readonly header?: string;
  readonly question: string;
  readonly options: ReadonlyArray<UserInputOption>;
  readonly multiSelect?: boolean;
  readonly selectionType?: "single" | "multiple";
}

export type UserInputAnswerValue = string | ReadonlyArray<string>;

export type UserInputResponse =
  | {
      type: "submit";
      value: string;
      answers?: Readonly<Record<string, UserInputAnswerValue>>;
      supplement?: string;
    }
  | { type: "cancel" };

/**
 * 统一 approval 请求（由 provider 发出，PermissionBoundary 暂存等待用户决策）。
 *
 * 取代 Claude SDK 的 PermissionEvent 与 Codex app-server 的 commandExecution/fileChange
 * approval request —— UI 只看到 ApprovalRequest。
 */
export interface ApprovalRequest {
  readonly requestId: string;
  readonly providerId: ProviderId;
  readonly toolName: string;
  readonly description: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly riskReason?: string;
  readonly highRiskFlags?: ReadonlyArray<string>;
  readonly inputSummary?: string;
  readonly mergeKey?: string;
  readonly sessionId?: string;
  readonly parentToolUseId?: string;
  readonly subagentRisk?: string;
  /** provider 私有上下文（如 codex request_id / sdk requestId），resolveApproval 时回传给 provider */
  readonly providerContext?: unknown;
}

/**
 * 统一 user input 请求（如 Codex item/tool/requestUserInput）。
 *
 * 与 PermissionBoundary 分离：这类中断要求用户提供答案，而不是授权某个动作。
 */
export interface UserInputRequest {
  readonly requestId: string;
  readonly providerId: ProviderId;
  readonly toolName: string;
  readonly prompt: string;
  readonly inputType?: "text" | "secret";
  readonly questions?: ReadonlyArray<UserInputQuestion>;
  readonly placeholder?: string;
  readonly providerContext?: unknown;
}

/**
 * PermissionBoundary：会话级权限边界。
 *
 * 聚合 permissionMode + permissionPolicy + 会话级 allow/deny 缓存 + pending approvals。
 * UI 通过 PermissionBoundary 观察 pending approvals 并提交用户决策；provider 通过
 * PermissionBoundary 查询决策（同步 mode 决策或异步等待用户）。
 *
 * 取代 view.ts 中分散的 pendingPermissions Map + SdkBackend.resolvePermission 调用。
 */
export interface PermissionBoundary {
  readonly mode: ClaudePermissionMode;
  readonly policy: PermissionPolicy;
  /** 当前 pending 的 approval 请求（按 requestId 索引） */
  readonly pending: ReadonlyMap<string, ApprovalRequest>;
  /** 会话级允许缓存（按 toolName + riskLevel + pathPattern） */
  readonly sessionAllows: ReadonlyArray<SessionAllowEntry>;
  /** 会话级拒绝缓存 */
  readonly sessionDenies: ReadonlyArray<SessionDenyEntry>;
  /** 提交一个 approval 请求（provider 调用；返回 false 表示已被 mode 自动决策） */
  requestApproval(req: ApprovalRequest): "pending" | "auto-allow" | "auto-deny";
  /** 用户决策（UI 调用）；返回 true=成功解析 */
  resolveApproval(requestId: string, response: ApprovalResponse): boolean;
  /** P4: 重置会话级 allow/deny 缓存（新会话时调用，避免跨会话泄漏） */
  resetSessionCache(): void;
  /** 取消所有 pending（stop/新会话时调用） */
  cancelAllPending(): ReadonlyArray<{ requestId: string; providerContext: unknown }>;
  /**
   * Provider 在 requestApproval 返回 "pending" 后调用，挂起当前事件产出直到 UI 决策。
   *
   * 返回决策结果（response + source）。cancelAllPending 时返回 { type: "cancel" }。
   * 这是 PermissionBoundary 接口的一部分，因为 provider 必须通过它等待用户决策
   * （PermissionBoundaryImpl 提供默认实现）。
   */
  waitForApproval(requestId: string): Promise<{ response: ApprovalResponse; source: "user" | "session_allow" | "session_deny" | "mode" }>;
}

export interface UserInputBoundary {
  /** 当前 pending 的 user input 请求（按 requestId 索引） */
  readonly pending: ReadonlyMap<string, UserInputRequest>;
  /** 提交一个 user input 请求（provider 调用） */
  requestInput(req: UserInputRequest): "pending";
  /** 用户提交答案（UI 调用）；返回 true=成功解析 */
  resolveInput(requestId: string, response: UserInputResponse): boolean;
  /** 取消所有 pending（stop/新会话时调用） */
  cancelAllPending(): ReadonlyArray<{ requestId: string; providerContext: unknown }>;
  /** Provider 在 requestInput 后调用，挂起直到 UI 回复 */
  waitForInput(requestId: string): Promise<{ response: UserInputResponse; source: "user" | "cancel" }>;
}

/** 会话级允许缓存条目 */
export interface SessionAllowEntry {
  readonly toolName: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly pathPattern: string;
  readonly grantedAt: string;
}

/** 会话级拒绝缓存条目 */
export interface SessionDenyEntry {
  readonly toolName: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly pathPattern: string;
  readonly deniedAt: string;
}

// ---------- AssistantTurnView ----------

/**
 * UI 唯一消费的 turn 视图（固定四段式）。
 *
 * 由 AssistantTurnViewBuilder 从 NormalizedRuntimeEvent[] 聚合产出。final answer 始终
 * 由聚合器输出，不再由 stdout_delta 旁路直接写 content。
 *
 * 结构固定：
 * - process:     运行中状态/进度（status/notice/request）
 * - thoughts:    思考段数组（V16.4: 多段 — 每次新 reasoning block 产生新段；旧版 0/1 个）
 * - tools:       工具调用（按 callId，含 progress 子条目）
 * - fileChanges: 用户可见文件变更（internal 路径过滤）
 * - approvals:   approval 请求（pending 与已解决）
 * - userInputRequests: agent 询问/澄清请求（pending 与已解决）
 * - finalAnswer: 最终答案（单 buffer，流式累加）
 * - warnings:    可恢复错误
 * - errors:      不可恢复错误
 * - rawProviderEvents: 仅 developerMode 展示
 */
export interface AssistantTurnView {
  readonly turnId: string;
  readonly providerId: ProviderId;
  status: "running" | "completed" | "failed" | "stopped";
  readonly process: ReadonlyArray<ProcessSegment>;
  thoughts: ReadonlyArray<ThoughtSegment>;
  tools: ReadonlyArray<ToolSegment>;
  fileChanges: ReadonlyArray<FileChangeSegment>;
  approvals: ReadonlyArray<ApprovalSegment>;
  userInputRequests: ReadonlyArray<UserInputRequestSegment>;
  finalAnswer: string;
  warnings: ReadonlyArray<string>;
  errors: ReadonlyArray<string>;
  /** 原始 provider 事件（仅 developerMode；UI raw log 面板用） */
  rawProviderEvents: ReadonlyArray<unknown>;
  /**
   * V16.4: provider-native 生命周期事件（RunPhaseModel 主链路输入）。
   * 由 AssistantTurnViewBuilder 在 ingest() 时从 NormalizedRuntimeEvent 直接派生，
   * 保留 SDK agent loop 边界（evaluation_started / tool_started / observation_received / result）。
   * buildLifecycleEventsFromTurnView 仅作为无 provider-native 事件时的 fallback。
   */
  lifecycleEvents: ReadonlyArray<import("./providerLifecycleEvent").ProviderLifecycleEvent>;
  readonly startedAt: string;
  endedAt?: string;
  durationMs?: number;
  /** 终态 sessionId（审计用，Developer mode 可见） */
  terminalSessionId?: string;
}

/** 进度段（status/notice/request，非 tool/thinking） */
export interface ProcessSegment {
  readonly timestamp: string;
  readonly label: string;
  readonly detail?: string;
  readonly category?: "request" | "thinking" | "tool" | "status" | "notice";
}

/**
 * 思考段（V16.4-D: 基于稳定 key 聚合 — 同一 content block 的 delta 合并为一个段）。
 *
 * 旧版 V2.17-A 始终 0 或 1 个 thinkingBlock；V16.4 改为 thoughts[] 多段：
 * - 同一 messageId + contentBlockIndex 的 thinking_delta 累加到同一段
 * - progress / input_json_delta / tool progress 不打断同一 thinking block
 * - 新 SDKAssistantMessage（新 evaluation）→ 新 messageId → 新段
 * - progress category=thinking 更新最近一段的 meta/tokens
 *
 * 稳定 key（V16.4-D）:
 * - messageId: 标识所属 SDKAssistantMessage（一个 evaluation）
 * - contentBlockIndex: 标识 message 内的 content block（thinking block 索引）
 * - phaseId: 标识所属 RunPhase（RunPhaseModel 填充）
 */
export interface ThoughtSegment {
  readonly timestamp: string;
  text: string;
  tokens?: number;
  meta?: string;
  /** V16.4-D: 稳定 key — 所属 SDKAssistantMessage id（同一 message 内 thinking 合并） */
  messageId?: string;
  /** V16.4-D: 稳定 key — content block 索引（同一 block 的 delta 合并） */
  contentBlockIndex?: number;
  /** V16.4-D: RunPhaseModel 填充 — 所属 phase id */
  phaseId?: string;
}

/** 工具段（按 callId；含 progress 子条目） */
export interface ToolSegment {
  readonly callId: string;
  readonly toolName: string;
  readonly toolInput: string;
  readonly startTime: string;
  endTime?: string;
  durationMs?: number;
  output?: string;
  isError: boolean;
  status: "running" | "done" | "error";
  readonly progress: ReadonlyArray<{ label: string; detail?: string; timestamp: string }>;
  readonly parentToolUseId?: string;
  readonly sessionId?: string;
}

/**
 * 文件变更段（internal 路径已过滤）。
 *
 * V16.4: 扩展 additions/deletions（可选 — 来自 tool input 或 codex change.diff）：
 * - create: additions = 新文件行数，deletions = 0
 * - delete: additions = 0，deletions = 旧文件行数（若可获取）
 * - modify: additions/deletions 由 line diff 得出
 * 未提供时为 undefined（UI 降级为只显示 action + path）。
 */
export interface FileChangeSegment {
  readonly timestamp: string;
  readonly action: "create" | "modify" | "delete";
  readonly path: string;
  readonly additions?: number;
  readonly deletions?: number;
}

/** approval 段（pending 与已解决） */
export interface ApprovalSegment {
  readonly requestId: string;
  readonly toolName: string;
  readonly description: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly riskReason?: string;
  readonly highRiskFlags?: ReadonlyArray<string>;
  readonly inputSummary?: string;
  readonly mergeKey?: string;
  readonly parentToolUseId?: string;
  readonly subagentRisk?: string;
  pending: boolean;
  resolution?: ApprovalResponse;
  resolutionSource?: "user" | "session_allow" | "session_deny" | "mode";
}

export interface UserInputRequestSegment {
  readonly requestId: string;
  readonly toolName: string;
  readonly prompt: string;
  readonly timestamp: string;
  readonly inputType?: "text" | "secret";
  readonly questions?: ReadonlyArray<UserInputQuestion>;
  readonly placeholder?: string;
  pending: boolean;
  response?: UserInputResponse;
  resolutionSource?: "user" | "cancel";
}

// ---------- BridgeSession / RunContext ----------

/**
 * RunContext：provider run() 的上下文。
 *
 * 携带 EffectiveRunPlan、BridgePromptPackage、PermissionBoundary、settings 引用，
 * 以及 provider resume 所需的 sessionId。
 */
export interface RunContext {
  readonly plan: EffectiveRunPlan;
  readonly promptPackage: BridgePromptPackage;
  readonly permission: PermissionBoundary;
  readonly userInput: UserInputBoundary;
  /** run 唯一 id（用于 cancel 配对） */
  readonly runId: string;
  /**
   * BridgeSession.sessionId（V2.17-A Completion 主线闭环）。
   *
   * provider 据此在 sessionMapper 中注册 codex threadId/sessionId 映射，
   * 供后续 resume(sessionId) 查找。与 runId 解耦：runId 每次 run 变化，
   * bridgeSessionId 在会话生命周期内稳定。
   */
  readonly bridgeSessionId?: string;
  /** 要 resume 的会话 id（undefined=新会话） */
  readonly resumeSessionId?: string;
  /** V2.16-E: SDK streaming input（image blocks）；CLI/Codex provider 忽略 */
  readonly sdkStreamingInput?: SdkStreamingInput;
  /** V2.14.0-K: runtime read-only file tool adapter */
  readonly runtimeFileToolAdapter?: RuntimeFileToolAdapter;
}

/**
 * BridgeSession：UI 与 provider 之间的会话编排器。
 *
 * 职责：
 * 1. 选择 provider（按 settings.backendMode + provider 可用性）
 * 2. 构造 RunInput → BridgePromptPackage → EffectiveRunPlan
 * 3. 调用 provider.run(plan) 返回 AsyncIterable<NormalizedRuntimeEvent>
 * 4. cancel(runId) / resume(sessionId)
 *
 * UI 不直接接触 provider 实例，只通过 BridgeSession 交互。
 */
export interface BridgeSession {
  readonly sessionId: string;
  readonly providerId: ProviderId;
  /** 当前活动 provider（供 UI 显示 runtime label / 诊断） */
  readonly provider: RuntimeProvider;
  /** 会话级 PermissionBoundary（UI 观察 pending approvals） */
  readonly permission: PermissionBoundary;
  /** 会话级 UserInputBoundary（UI 观察 pending 澄清请求） */
  readonly userInput: UserInputBoundary;
  /**
   * provider 侧 thread id（V2.17-A Completion 主线闭环）。
   *
   * codex app-server 的 threadId（thread/start 或 thread/resume 返回）。
   * keepLastSession 恢复时据此同步 provider thread/session。
   * 非 codex provider 时为 undefined。
   */
  readonly providerThreadId?: string;
  /**
   * provider 侧 session id（V2.17-A Completion 主线闭环）。
   *
   * codex app-server 的 sessionId（thread/start 或 thread/resume 返回）。
   * keepLastSession 恢复时据此同步 provider thread/session。
   * 非 codex provider 时为 undefined。
   */
  readonly providerSessionId?: string;
  /** 启动一次 run（settings 由 view 传入，保证实时读取用户最新设置） */
  start(input: RunInput, settings: import("../../types").LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent>;
  /** 取消当前 run */
  cancel(runId: string): void;
  /** 恢复会话 */
  resume(sessionId: string, input: RunInput, settings: import("../../types").LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent>;
  /**
   * V2.17-A Completion: 从持久化的 providerThreadId/providerSessionId 回填 provider session 状态。
   *
   * keepLastSession 恢复时由 UI 调用：把 session 文件中保存的 codex threadId/sessionId
   * 注入 provider 的 sessionMapper，使后续 resume() 命中 thread/resume 路径。
   */
  restoreProviderSession(providerThreadId?: string, providerSessionId?: string): void;
  /**
   * V16.4-F2: 用最新 settings 重建 PermissionBoundary（permissionMode 切换后下一次 run 生效）。
   *
   * 当前 run 不受影响（ctx.permission 已持有旧 boundary 引用）；
   * 仅在无 run 进行时（currentRunId === null）才重建，下一次 run 使用新 mode。
   * session allow/deny 缓存会随重建丢失（mode 切换意味着权限策略改变）。
   */
  rebuildPermissionBoundary(settings: import("../../types").LLMBridgeSettings): void;
}

// ---------- RuntimeProvider 接口（前向声明，实现在 runtimeProvider.ts） ----------

/**
 * RuntimeProvider 接口：所有 runtime（codex-app-server / claude-sdk / claude-cli / mock）
 * 实现此接口。BridgeSession 通过此接口调用 provider，不接触具体实现。
 *
 * 实现详见 src/runtime/core/runtimeProvider.ts。
 */
export interface RuntimeProvider {
  readonly providerId: ProviderId;
  /** provider 显示名（UI runtime label 用） */
  readonly displayName: string;
  /** provider 是否可用（codex 命令是否存在 / SDK 包是否加载等） */
  isAvailable(cwd: string): boolean;
  /** 从 RunInput + settings 构造 EffectiveRunPlan（单一真相源） */
  buildPlan(input: RunInput, settings: import("../../types").LLMBridgeSettings): EffectiveRunPlan;
  /** 启动一次 run，返回 NormalizedRuntimeEvent 异步流 */
  run(ctx: RunContext, settings: import("../../types").LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent>;
  /** 取消 run */
  cancel(runId: string): void;
  /** 恢复会话 */
  resume(sessionId: string, ctx: RunContext, settings: import("../../types").LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent>;
  /**
   * V2.17-A Completion: 从持久化的 providerThreadId/providerSessionId 回填 provider session 状态。
   *
   * keepLastSession 恢复时由 BridgeSession 调用，使后续 resume() 命中 thread/resume 路径。
   * 非 codex provider 无此方法时静默跳过（可选方法）。
   */
  restoreProviderSession?(bridgeSessionId: string, providerThreadId?: string, providerSessionId?: string): void;
}
