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
 * Backend 选择（V0.2 UI Mock Wiring / Demo Mode）
 * - auto: 默认生产行为，使用 ClaudeCliBackend
 * - mock-success: 开发/测试用，使用 MockAgentBackend(success)
 * - mock-failure: 开发/测试用，使用 MockAgentBackend(failure)
 * - sdk-experimental: V1.6 实验性，使用 SdkBackend（尝试真实 SDK，不可用时 fallback mock workflow）
 */
export type BackendMode = "auto" | "mock-success" | "mock-failure" | "sdk-experimental";

// V2.3: 权限策略（low=宽松 / medium=默认 / high=严格）
export type PermissionPolicy = "low" | "medium" | "high";

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
  // 仅 sdk-experimental backend 产生；CLI/mock backend 不产生
  sdkEvents?: ReadonlyArray<import("./workflowEvent").WorkflowEvent>;
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
