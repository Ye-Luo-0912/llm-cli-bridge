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
 * Backend 选择（V17-F1: Managed Codex App-Server Runtime）
 *
 * 主线策略：Managed runtime（不依赖用户安装 Codex CLI / Codex Desktop App）。
 * 主线依赖 App Server 协议 + 我们管理的 pinned runtime binary。
 *
 * - auto: codex-managed-app-server → codex-sdk → claude-sdk → pi-sdk → claude-cli
 * - codex-managed-app-server: V17-F1 主线，使用我们管理的 pinned runtime binary（manifest + sha256 + executable）
 * - codex-sdk: Codex Agent SDK（占位，本轮未完整实现）
 * - codex-app-server-external: 外部 codex app-server（高级/开发者 fallback，需 codex CLI 可执行）
 * - cli: Claude Code CLI
 * - sdk: Claude Agent SDK（strict，不可用时报错不 fallback）
 * - pi-sdk / pi-rpc: Pi provider（optional/advanced）
 * - mock-success / mock-failure: 离线测试
 *
 * V17-F1 任务 D：auto 默认改为 codex-managed-app-server 优先（不再依赖 external codex executable）。
 * V17-F0 任务 C：拆分原 "codex" → "codex-sdk" + "codex-app-server-external"。
 *
 * V17-E 任务 F：pi-sdk / pi-rpc 降级为 optional/advanced backend。
 * V17-E1 任务 B：portable auto 不再 Pi-first。
 */
export type BackendMode =
  | "auto"
  | "codex-managed-app-server"
  | "codex-sdk"
  | "codex-app-server-external"
  | "cli"
  | "sdk"
  | "mock-success"
  | "mock-failure"
  | "pi-rpc"
  | "pi-sdk";

/** V17-F0 任务 C：旧值迁移用（"codex" → "codex-app-server-external"） */
export type LegacyBackendMode = "codex";

/**
 * V17-F1 任务 A：Managed Codex App-Server Runtime manifest 类型。
 *
 * 描述我们管理的 pinned runtime binary（不依赖用户安装 Codex CLI / Desktop App）。
 * manifest 文件位于 src/runtime/providers/codex-managed-app-server/runtime-manifest.json，
 * 复制到 user-package 时随 dist/user-package/codex-managed-runtime/ 分发。
 *
 * 本轮为 fixture（fixture=true），后续接入真实 binary 时 fixture 改为 false。
 */
export interface CodexManagedRuntimeManifest {
  /** runtime 唯一标识 */
  runtimeId: string;
  /** runtime 版本（fixture 为 0.1.0-fixture） */
  version: string;
  /** App Server 协议版本 */
  protocolVersion: string;
  /** 是否为 fixture（本轮 true，真实 binary 接入后 false） */
  fixture: boolean;
  /** 启动 app-server 的参数（默认 ["app-server"]） */
  appServerArgs: string[];
  /** 真实 runtime 的固定 artifact/source；resolver 不下载，只用于安装脚本 */
  source?: {
    type: "npm-pack";
    packageName: string;
    packageVersion: string;
    artifactCacheDir: string;
  };
  /** 平台 -> binary 信息映射 */
  platforms: {
    [platformArch: string]: {
      /** 相对 manifest 目录的 binary 路径 */
      path: string;
      /** binary 文件的 sha256 校验值 */
      sha256: string;
      /** 文件大小（字节） */
      size: number;
      /** 可执行文件名（Windows 含 .exe/.bat，Unix 无扩展名） */
      executableName: string;
      /** 固定 artifact 来源；安装脚本用它安装 pinned binary */
      artifact?: {
        package: string;
        tarball: string;
        tarballSha256: string;
        integrity: string;
        vendorPath: string;
      };
    };
  };
}

/**
 * V17-A: 后端配置档（朋友版 portable vs 开发者 developer）。
 *
 * - developer: 全后端可选，auto 默认 SDK-first 链
 * - portable:  与 developer 相同的 auto 链；UI 精简不暴露实验选项
 *
 * 朋友版 UI 只显示后端状态/模型/权限模式/Agent Runtime，不暴露实验选项。
 *
 * V17-F0 任务 C：auto 不再依赖 external codex executable。
 * V17-E1 任务 B：portable auto 不再 Pi-first。
 * V17-E 任务 F：friendReady 字段废弃，改名为 piAdvancedReady。
 */
export type BackendProfile = "developer" | "portable";

// V17-C: Pi SDK 工具暴露模式
// - pi-native: 使用 Pi 默认 read/write/edit/bash（朋友版默认，Pi native trust 确认后启用）
// - bridge-controlled: bridge_write/bridge_edit/bridge_bash 走 Bridge approval（开发者默认）
// - read-only: 只启用 read（保守模式）
export type PiToolMode = "pi-native" | "bridge-controlled" | "read-only";

// V2.3: 权限策略（low=宽松 / medium=默认 / high=严格）
export type PermissionPolicy = "low" | "medium" | "high";

// V2.17-A: 附件打包计划（审计用，记录本轮附件分布）
// V2.17-A Completion: 从 count-only 升级到 entry-level（每条附件单独审计）。
export interface AttachmentPlan {
  messageScopedRefs: number;
  pinnedRefs: number;
  inlineSnippets: number;
  imageStreamingBlocks: number;
  nativeRefOnly: number;
  /** entry-level 审计：每条附件的 refId/scope/fileType/packing/pathHash/contentHash/reason */
  entries: ReadonlyArray<AttachmentAuditEntry>;
}

/**
 * 单条附件的审计条目（entry-level）。
 *
 * 记录每个附件的 packing 决策与内容指纹，便于：
 * - 跨 provider 一致性校验（同一附件在 Claude/Codex 路径下 packing 是否一致）
 * - prompt split 闭环验证（inline-snippet 必须出现在 userPrompt；sdk-streaming-block 必须进 image block）
 * - 审计回溯（哪个附件走了哪条路径，原因是什么）
 */
export interface AttachmentAuditEntry {
  refId: string;
  scope: "message" | "pinned" | "session";
  fileType: "image" | "text" | "markdown" | "json" | "pdf" | "binary" | "unknown";
  packing: "inline-snippet" | "sdk-streaming-block" | "native-ref-only";
  /** 路径指纹（djb2 变体，非加密强度；用于跨 run 比对同一附件） */
  pathHash: string;
  /** 内容指纹（djb2 变体；inline-snippet 记录实际内容哈希，ref-only 记录空串） */
  contentHash: string;
  /** packing 决策原因（为何走该 packing 路径） */
  reason: string;
}

// V2.17-A: EffectiveRunPlan —— 每次运行的单一真相源
// CLI 与 SDK 都从同一个 plan 派生 options / env；Developer mode 可查看，普通用户隐藏。
//
// V2.17-A Completion: 拆分为 Base / Claude / Codex 三层，去掉 Claude-only 顶层语义。
// - BaseEffectiveRunPlan: provider-neutral 公共字段
// - ClaudeEffectiveRunPlan: backend=sdk|cli，含 permission/systemPrompt/tools preset
// - CodexAppServerEffectiveRunPlan: backend=codex-app-server，含 codex 专用 instructionsSource
// EffectiveRunPlan 是两者的联合；消费方按 backend 收窄。

/** provider-neutral 公共字段（CLI/SDK/Codex 共享） */
export interface BaseEffectiveRunPlan {
  cwd: string;
  model: string;
  // 官方字段名 effort（不再用未确认的 reasoningEffort）
  effort: string;
  session: { continueSession: boolean; resumeId?: string };
  settingSources: readonly string[];
  skills: readonly string[];
  promptPackageHash: string;
  attachmentPlan: AttachmentPlan;
  createdAt: string;
}

/** Claude SDK/CLI 专用 plan（含 Claude-only 顶层语义：permission/systemPrompt/tools preset） */
export interface ClaudeEffectiveRunPlan extends BaseEffectiveRunPlan {
  backend: "sdk" | "cli";
  permission: ClaudePermissionMode;
  // 显式 claude_code preset
  systemPrompt: { preset: "claude_code" };
  tools: { preset: "claude_code" };
}

/**
 * Codex app-server 专用 plan。
 *
 * codex-app-server 不读 systemPrompt/tools preset 字段（这些是 Claude 专用），
 * 由 CodexAppServerEffectiveRunPlan.buildRunOptions 派生 codex instructions/config/rules。
 * bridgeSystemAppend 走 developerInstructions 层（见 codexAppServerEffectiveRunPlan.ts）。
 *
 * V17-F0 任务 B：CodexAppServerProvider 重命名为 CodexExternalAppServerProvider（向后兼容别名保留）。
 *           此 plan 类型保留 codex-app-server backend 标识（external fallback）。
 */
export interface CodexAppServerEffectiveRunPlan extends BaseEffectiveRunPlan {
  backend: "codex-app-server";
  /** Bridge 薄指令的承载层（审计用） */
  instructionsSource: "developerInstructions" | "instructions" | "config" | "rules" | "provider-preamble";
  /** 实际生效的审批画像（provider-neutral） */
  approvalProfile: import("./agentApprovalProfile").AgentApprovalProfile;
  /** 映射后的 Codex approvalPolicy */
  approvalPolicy: string;
  /** 映射后的 approvalsReviewer */
  approvalsReviewer: string;
  /** 映射后的 sandbox 字符串 */
  sandbox: string;
}

/**
 * V17-F0 任务 B：Codex SDK 主线 plan 占位。
 *
 * 后续完整实现时，由 CodexSdkProvider.buildPlan 构造此 plan。
 */
export interface CodexSdkEffectiveRunPlan extends BaseEffectiveRunPlan {
  backend: "codex-sdk";
  /** SDK 嵌入式 runtime 的配置来源（占位，实际实现时替换） */
  sdkConfigSource: "placeholder" | "configured";
}

/** EffectiveRunPlan 联合类型（按 backend 收窄） */
export type EffectiveRunPlan = ClaudeEffectiveRunPlan | CodexAppServerEffectiveRunPlan | CodexSdkEffectiveRunPlan;

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
  // P3: AssistantTurnView 快照（普通用户态主 UI 状态源）。
  // 运行中每次 ingest 更新；终态后保存最终快照供历史消息渲染。
  // 普通用户态 process/thoughts/tools/fileChanges/approvals 从此字段渲染，
  // 不再从 sdkEvents/workflowTrace 派生。
  assistantTurnView?: import("./runtime/core/types").AssistantTurnView;
  // P3: attachment audit (Developer mode only). Records packing decisions.
  attachmentPlan?: AttachmentPlan;
}

export interface LLMBridgeSettings {
  settingsVersion: number;
  agentType: AgentType;
  claudeCommand: string;
  claudeArgs: string;
  codexCommand: string;
  codexArgs: string;
  // V17-A: Pi portable backend spike（pi --mode rpc）
  piCommand: string;
  piArgs: string;
  // V17-A: 后端配置档（朋友版 portable 优先 Pi；开发者 developer 全可选）
  backendProfile: BackendProfile;
  // V17-C: Pi SDK 工具暴露模式（pi-native / bridge-controlled / read-only）
  piToolMode: PiToolMode;
  // V17-C: Pi native tools 首次确认状态（portable + pi-native 启动前需确认一次）
  piNativeTrustConfirmed: boolean;
  customCommand: string;
  customArgs: string;
  includeActiveNote: boolean;
  includeSelection: boolean;
  maxActiveNoteChars: number;
  maxSelectionChars: number;
  outputDir: string;
  showStderr: boolean;
  saveLogs: boolean;
  /** V20.8: safeStorage 不可用时允许明文持久化（用户明确同意后开启） */
  allowPlaintextSecretsFallback: boolean;
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
  /**
   * provider-neutral 审批画像（请求批准 / 替我审批 / 完全访问）。
   * Codex 由此映射 approvalPolicy/sandbox；不再用 claudePermissionMode 驱动 Codex。
   */
  agentApprovalProfile: import("./agentApprovalProfile").AgentApprovalProfile;
  /**
   * Round 5: Codex personality（用户可配置；默认 pragmatic）。
   * 直接对应 generated Personality（"none" | "friendly" | "pragmatic"）。
   */
  codexPersonality: "none" | "friendly" | "pragmatic";
  /**
   * Round 5: Codex reasoning summary（用户可配置；默认 auto）。
   * 直接对应 generated ReasoningSummary（"auto" | "concise" | "detailed" | "none"）。
   */
  codexReasoningSummary: "auto" | "concise" | "detailed" | "none";
  // V2.1: 被禁用的 skill 名称列表（数据驱动，skills 从 .llm-bridge/skills.md 读取）
  disabledSkills: string[];
  // V2.3: 权限策略（low/medium/high，控制修改类操作的授权门槛）
  permissionPolicy: PermissionPolicy;
  // V2.16-D: 会话保持 — 插件重载/视图重开/Obsidian 重启后恢复上次活动会话
  keepLastSession: boolean;
  // V2.16-D: 上次活动会话 id（运行/保存时更新；onOpen 时据此恢复）
  // latest native session only: nativeSessionRef 只存在 session 文件（1:1 绑定），
  // 不在 settings 维护，避免双源导致 session 和 native ref 错位。
  lastActiveSessionId: string;
  // V2.16-D: 开发者模式。默认关闭；开启后才展示 raw command/workflow/log。
  developerMode: boolean;
}

export const DEFAULT_SETTINGS: LLMBridgeSettings = {
  settingsVersion: 2,
  agentType: "claude",
  claudeCommand: "claude",
  claudeArgs: "-p",
  codexCommand: "codex",
  codexArgs: "exec -",
  // V17-A: Pi portable backend spike 默认命令（pi 未安装时 unavailable，不崩溃）
  piCommand: "pi",
  piArgs: "--mode rpc",
  backendProfile: "developer",
  // V17-C: portable profile 朋友版默认 pi-native；developer 用户可手动切换为 bridge-controlled
  piToolMode: "pi-native",
  // V17-C: Pi native tools 首次确认状态（默认未确认）
  piNativeTrustConfirmed: false,
  customCommand: "",
  customArgs: "",
  includeActiveNote: false,
  includeSelection: true,
  maxActiveNoteChars: 6000,
  maxSelectionChars: 3000,
  outputDir: "90_AI整理待确认",
  showStderr: true,
  saveLogs: true,
  allowPlaintextSecretsFallback: false,
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
  agentApprovalProfile: "ask",
  // Round 5: Codex personality/summary 默认值（用户可在设置中覆盖）
  codexPersonality: "pragmatic",
  codexReasoningSummary: "auto",
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
