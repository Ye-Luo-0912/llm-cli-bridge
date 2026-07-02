// LLM CLI Bridge — 类型与默认设置

export type AgentType = "claude" | "codex" | "custom";

// V2.17-A 续: RuntimeProvider canonical 标识（UI 不再 instanceof SdkBackend/ClaudeCliBackend）
// 定义在 types.ts 避免与 runtimeProvider.ts 循环依赖
export type RuntimeProviderId = "claude-sdk" | "claude-cli" | "codex-sdk" | "mock";

// 会话模式：fresh=新会话；continue=继续最近会话；resume=恢复指定会话
// 本轮只启用 fresh，continue/resume 为预留
export type SessionMode = "fresh" | "continue" | "resume";

export type RunStatus = "idle" | "running" | "completed" | "failed" | "stopped";

// V1.5: Claude Code permission 模式（--permission-mode 参数）
// V2.3s: 扩展到 6 种，覆盖 SDK 原生 permissionMode
// - default: 默认询问
// - acceptEdits: 自动接受文件编辑
// - plan: 只读规划模式
// - auto: 自动决策（SDK 自行判断风险等级）
// - dontAsk: 不询问（静默允许，但仍受 canUseTool 回调观测）
// - bypassPermissions: 跳过所有权限检查（危险）
export type ClaudePermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";

/**
 * Backend 选择（V2.16-B: SDK primary runtime）
 * - auto: SDK-first + Claude Code CLI fallback（默认生产行为）
 * - cli: 始终使用 ClaudeCliBackend（显式选择，不走 SDK）
 * - sdk: 始终使用 SdkBackend（显式选择，SDK 不可用时显示明确错误，不静默 fallback）
 * - mock-success: 开发/测试用，使用 MockAgentBackend(success)
 * - mock-failure: 开发/测试用，使用 MockAgentBackend(failure)
 *
 * V2.16-B 迁移：旧的 "sdk-experimental" 自动迁移为 "sdk"
 */
export type BackendMode = "auto" | "cli" | "sdk" | "mock-success" | "mock-failure";

// V2.3: 权限策略（low=宽松 / medium=默认 / high=严格）
export type PermissionPolicy = "low" | "medium" | "high";

// V2.17-A 续: 附件打包计划（entry-level 审计，可比较 SDK/CLI attachment mapping）
// 每个附件记录 refId/scope/fileType/mode/pathHash/contentHash/reason
export type AttachmentMode = "inline-snippet" | "image-streaming-block" | "native-ref-only";

export interface AttachmentEntry {
  /** 对应 FileRef.id（跨 SDK/CLI 可比较） */
  readonly refId: string;
  /** message / pinned / session */
  readonly scope: "message" | "pinned" | "session";
  /** image / text / markdown / json / pdf / binary / unknown */
  readonly fileType: "image" | "text" | "markdown" | "json" | "pdf" | "binary" | "unknown";
  /** 该附件在本轮的打包模式 */
  readonly mode: AttachmentMode;
  /** resolvedPath 的稳定哈希（审计用，非加密） */
  readonly pathHash: string;
  /** 内联文本内容哈希（inline-snippet 模式有值；其它模式为空串） */
  readonly contentHash: string;
  /** 该模式的原因（人类可读，用于审计） */
  readonly reason: string;
}

export interface AttachmentPlan {
  // 聚合计数（向后兼容；entry-level 审计见 entries）
  messageScopedRefs: number;
  pinnedRefs: number;
  inlineSnippets: number;
  imageStreamingBlocks: number;
  nativeRefOnly: number;
  // V2.17-A 续: entry-level 审计（每个附件一条记录，SDK/CLI mapping 可比较）
  entries: ReadonlyArray<AttachmentEntry>;
}

// V2.17-A: EffectiveRunPlan —— 每次运行的单一真相源
// CLI 与 SDK 都从同一个 plan 派生 options / env；Developer mode 可查看，普通用户隐藏。
// V2.17-A 续: 新增 provider (RuntimeProviderId) 作为 canonical 标识；backend 保留为派生字段。
export interface EffectiveRunPlan {
  /** canonical provider 标识（UI 据此判定运行时，不 instanceof backend 类） */
  provider: RuntimeProviderId;
  /** backend 大类（sdk/cli），由 provider 派生，保留以兼容现有审计/测试 */
  backend: "sdk" | "cli";
  cwd: string;
  model: string;
  // 官方字段名 effort（不再用未确认的 reasoningEffort）
  effort: string;
  permission: ClaudePermissionMode;
  session: { continueSession: boolean; resumeId?: string };
  // 显式 claude_code preset（Codex provider 时为空字符串表示不适用）
  systemPrompt: { preset: "claude_code" | "" };
  tools: { preset: "claude_code" | "" };
  settingSources: readonly string[];
  skills: readonly string[];
  /** V2.17-A 续: extra args 从 plan 派生（不再由 backend 直接读 settings.claudeExtraArgs） */
  extraArgs: ReadonlyArray<string>;
  promptPackageHash: string;
  attachmentPlan: AttachmentPlan;
  // V2.17-A 续: BridgePromptPackage 拆分后的脱敏审计文本（Developer mode 展示用）
  bridgePrompt?: BridgePromptPackageAudit;
  createdAt: string;
}

/**
 * BridgePromptPackage 拆分结构（V2.17-A 续）。
 * 用户请求不再被 bridge-native 规则包围：bridgeSystemAppend 与 userPrompt 分离。
 * - SDK 路径：systemPrompt = claude_code preset + append bridgeSystemAppend；
 *   prompt/streaming input 只放干净 userPrompt + message-scoped attachments。
 * - CLI fallback：stdin = bridgeSystemAppend + userPrompt 组合。
 */
export interface BridgePromptPackage {
  /** bridge-native 指令段（Native Handoff / Attachment Policy / Tool Steering / Output 规则） */
  bridgeSystemAppend: string;
  /** 干净用户请求正文（仅用户输入，不含 bridge-native 指令） */
  userPrompt: string;
  /** entry-level 附件审计条目（与 AttachmentPlan.entries 同源） */
  attachmentEntries: ReadonlyArray<AttachmentEntry>;
  /** 整包审计哈希（基于 bridgeSystemAppend + userPrompt + attachmentEntries 计算） */
  auditHash: string;
}

/**
 * BridgePromptPackage 的脱敏审计视图（写入 EffectiveRunPlan 供 Developer mode 展示）。
 * 不含附件正文内容，仅含结构化摘要，避免 secret/长文本进入 plan JSON。
 */
export interface BridgePromptPackageAudit {
  bridgeSystemAppendHash: string;
  bridgeSystemAppendLength: number;
  userPromptLength: number;
  userPromptPreview: string;
  attachmentEntryCount: number;
  auditHash: string;
}

// 单条聊天消息
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: RunStatus;
  stderr: string;
  log: string;
  generatedFiles: string[];
  exitCode: number | null;
  durationMs: number;
  timestamp: string;
  // V1.2: 运行过程时间线（assistant 消息专用）
  timeline?: ReadonlyArray<{ type: string; timestamp: string; detail: string }>;
  // V1.2: 运行过程中收集的中间事件（stdout/stderr 片段），用于构造时间线
  timelineEvents?: Array<{ type: string; detail: string; timestamp: string }>;
  // V1.5: 命令预览（UI-only，不进 AgentEvent；展示本次实际执行的 command/args/cwd/上下文）
  commandPreview?: ReadonlyArray<{ label: string; value: string }>;
  // V1.5: Workflow Trace（UI-only，不进 AgentEvent；展示 preflight → build_prompt → spawn → stdout/stderr → file_diff_scan → 终态）
  workflowTrace?: ReadonlyArray<{ stage: string; timestamp: string; detail: string; status: string }>;
  // V1.5: 运行过程中收集的 workflow 事件，用于构造 workflowTrace
  workflowEvents?: Array<{ stage: string; detail: string; timestamp: string }>;
  // V1.6: SDK 工作流事件（UI-only，工具级：tool_start/tool_result/file_change/permission/error/message）
  // 仅 sdk backend 产生；CLI/mock backend 不产生
  sdkEvents?: ReadonlyArray<import("./workflowEvent").WorkflowEvent>;
  // V2.16-E: 用户本轮附件/refs。普通附件只绑定到这条 user message，不跨轮保留。
  fileRefs?: ReadonlyArray<import("./fileRefs").FileRef>;
  // V2.17-A: 本次运行的 EffectiveRunPlan（Developer mode 审计用；普通用户态不渲染）
  effectiveRunPlan?: EffectiveRunPlan;
}

export interface LLMBridgeSettings {
  agentType: AgentType;
  claudeCommand: string;
  claudeArgs: string;
  codexCommand: string;
  codexArgs: string;
  customCommand: string;
  customArgs: string;
  includeActiveNote: boolean;
  includeSelection: boolean;
  maxActiveNoteChars: number;
  maxSelectionChars: number;
  outputDir: string;
  showStderr: boolean;
  saveLogs: boolean;
  sessionMode: SessionMode;
  model: string;
  effortLevel: string;
  devTestMode: boolean;
  backendMode: BackendMode;
  // V1.5: Claude Code command profile（continue/resume/permission/extra args）
  claudeContinueSession: boolean;
  claudeResumeSessionId: string;
  claudePermissionMode: ClaudePermissionMode;
  claudeExtraArgs: string;
  // V2.1: 被禁用的 skill 名称列表（数据驱动，skills 从 .llm-bridge/skills.md 读取）
  disabledSkills: string[];
  // V2.3: 权限策略（low/medium/high，控制修改类操作的授权门槛）
  permissionPolicy: PermissionPolicy;
  // V2.16-D: 会话保持 — 插件重载/视图重开/Obsidian 重启后恢复上次活动会话
  keepLastSession: boolean;
  // V2.16-D: 上次活动会话 id（运行/保存时更新；onOpen 时据此恢复）
  lastActiveSessionId: string;
  // V2.16-D: 开发者模式。默认关闭；开启后才展示 raw command/workflow/log。
  developerMode: boolean;
}

export const DEFAULT_SETTINGS: LLMBridgeSettings = {
  agentType: "claude",
  claudeCommand: "claude",
  claudeArgs: "-p",
  codexCommand: "codex",
  codexArgs: "exec -",
  customCommand: "",
  customArgs: "",
  includeActiveNote: false,
  includeSelection: true,
  maxActiveNoteChars: 6000,
  maxSelectionChars: 3000,
  outputDir: "90_AI整理待确认",
  showStderr: true,
  saveLogs: true,
  sessionMode: "fresh",
  model: "gpt-5.5",
  effortLevel: "high",
  devTestMode: false,
  backendMode: "auto",
  // V1.5: Claude Code command profile 默认值（普通用户无需修改）
  claudeContinueSession: false,
  claudeResumeSessionId: "",
  claudePermissionMode: "default",
  claudeExtraArgs: "",
  // V2.1: 默认所有 skill 启用
  disabledSkills: [],
  // V2.3: 默认标准策略（medium 风险需本轮授权，读操作自动允许）
  permissionPolicy: "medium",
  // V2.16-D: 默认启用会话保持
  keepLastSession: true,
  lastActiveSessionId: "",
  developerMode: false,
};

// 写入到 .llm-bridge/state/current.json 的内容
export interface BridgeState {
  vaultPath: string;
  activeFilePath: string | null;
  hasActiveFile: boolean;
  hasSelection: boolean;
  selectionLength: number;
  timestamp: string;
}

// 运行结束后返回给 View 的结果
export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
}
