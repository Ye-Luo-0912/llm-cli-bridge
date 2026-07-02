// LLM CLI Bridge — 类型与默认设置

export type AgentType = "claude" | "codex" | "custom";

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

// V2.17-A: 附件打包计划（审计用，记录本轮附件分布）
export interface AttachmentPlan {
  messageScopedRefs: number;
  pinnedRefs: number;
  inlineSnippets: number;
  imageStreamingBlocks: number;
  nativeRefOnly: number;
}

// V2.17-A: EffectiveRunPlan —— 每次运行的单一真相源
// CLI 与 SDK 都从同一个 plan 派生 options / env；Developer mode 可查看，普通用户隐藏。
// V2.17-A Completion: backend 联合扩展 "codex-app-server"（Codex app-server primary provider）。
//   注：codex-app-server 不读 systemPrompt/tools preset 字段（这些是 Claude 专用），
//   由 CodexAppServerEffectiveRunPlan.buildRunOptions 派生 codex instructions/config/rules。
export interface EffectiveRunPlan {
  backend: "sdk" | "cli" | "codex-app-server";
  cwd: string;
  model: string;
  // 官方字段名 effort（不再用未确认的 reasoningEffort）
  effort: string;
  permission: ClaudePermissionMode;
  session: { continueSession: boolean; resumeId?: string };
  // 显式 claude_code preset（Claude SDK/CLI 用；codex-app-server provider 忽略此字段）
  systemPrompt: { preset: "claude_code" };
  tools: { preset: "claude_code" };
  settingSources: readonly string[];
  skills: readonly string[];
  promptPackageHash: string;
  attachmentPlan: AttachmentPlan;
  createdAt: string;
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
