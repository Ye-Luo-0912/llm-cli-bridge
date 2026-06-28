// LLM CLI Bridge — 类型与默认设置

export type AgentType = "claude" | "codex" | "custom";

// 会话模式：fresh=新会话；continue=继续最近会话；resume=恢复指定会话
// 本轮只启用 fresh，continue/resume 为预留
export type SessionMode = "fresh" | "continue" | "resume";

export type RunStatus = "idle" | "running" | "completed" | "failed" | "stopped";

/**
 * Backend 选择（V0.2 UI Mock Wiring / Demo Mode）
 * - auto: 默认生产行为，使用 ClaudeCliBackend
 * - mock-success: 开发/测试用，使用 MockAgentBackend(success)
 * - mock-failure: 开发/测试用，使用 MockAgentBackend(failure)
 */
export type BackendMode = "auto" | "mock-success" | "mock-failure";

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
