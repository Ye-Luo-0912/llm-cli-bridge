// LLM CLI Bridge — Runtime Provider Core (V2.17-A 续)
// 统一的 RuntimeProvider 抽象：UI 不再直接依赖 SdkBackend / ClaudeCliBackend。
//
// provider id 至少支持：claude-sdk / claude-cli / codex-sdk / mock
// - claude-sdk: Claude Agent SDK（query() 流式）
// - claude-cli: Claude Code CLI（spawn `claude -p`，stdin 传 prompt）
// - codex-sdk:  Codex runtime（skeleton，类型结构承载 CodexEffectiveRunPlan）
// - mock:       开发/测试用 MockAgentBackend
//
// 设计原则：
// - RuntimeProvider 是 UI 与 backend 之间的唯一接口；view.ts 通过 provider.id 判定运行时，
//   不再 instanceof SdkBackend / ClaudeCliBackend。
// - EffectiveRunPlan 是单一真相源；provider 从 plan 派生 options/args/env（见 effectiveRunPlan.ts）。
// - Codex 可先做 skeleton，但类型结构必须能承载 CodexEffectiveRunPlan，便于后续接入而不重写 UI。

import type { AgentBackend, AgentEventHandler, AgentRunHandle, AgentTask } from "./agentBackend";
import type { PermissionChoice } from "./sdkPermission";
import type { AttachmentPlan, ClaudePermissionMode, EffectiveRunPlan, LLMBridgeSettings, RuntimeProviderId } from "./types";

// ---------- Provider 标识 ----------

/**
 * RuntimeProvider 唯一标识（类型定义见 types.ts，避免循环依赖）。
 * - claude-sdk / codex-sdk: SDK 路径（流式 query）
 * - claude-cli: CLI 路径（spawn + stdin）
 * - mock: 测试用
 */

/** provider → backend 大类（sdk / cli），用于 EffectiveRunPlan.backend 派生与审计 */
export function providerBackendKind(provider: RuntimeProviderId): "sdk" | "cli" {
  return provider === "claude-sdk" || provider === "codex-sdk" ? "sdk" : "cli";
}

/** provider → 用户可读运行时标签（状态栏 / 消息头展示） */
export function providerDisplayName(provider: RuntimeProviderId): string {
  switch (provider) {
    case "claude-sdk": return "Claude SDK";
    case "claude-cli": return "Claude Code";
    case "codex-sdk": return "Codex";
    case "mock": return "Mock";
  }
}

// ---------- Codex EffectiveRunPlan skeleton ----------
//
// Codex runtime 与 Claude runtime 字段集合不同：
// - 无 claude_code systemPrompt/tools preset
// - approval policy / sandbox mode 是 Codex 专属字段
// - model/effort 取值空间不同（gpt-5.* / reasoning effort）
//
// 本接口为 skeleton：当前 CodexRuntimeProvider 仅占位，但类型结构必须能承载，
// 保证后续接入 Codex 时 UI 不需要重写（UI 只看 EffectiveRunPlan.provider + 通用字段）。

/** Codex 审批策略（与 Claude permissionMode 语义不同，独立枚举） */
export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

/** Codex 沙箱模式 */
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/**
 * Codex 专属运行计划字段。
 * 与 Claude EffectiveRunPlan 共享通用字段（provider/cwd/model/effort/session/promptPackageHash/attachmentPlan/createdAt），
 * 额外携带 approvalPolicy / sandboxMode。
 */
export interface CodexEffectiveRunPlan {
  readonly provider: "codex-sdk";
  readonly backend: "sdk";
  readonly cwd: string;
  readonly model: string;
  readonly effort: string;
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandboxMode: CodexSandboxMode;
  readonly session: { continueSession: boolean; resumeId?: string };
  readonly promptPackageHash: string;
  readonly attachmentPlan: AttachmentPlan;
  readonly createdAt: string;
}

// ---------- RuntimeProvider 接口 ----------

/**
 * RuntimeProvider：UI 与运行时之间的唯一接口。
 *
 * 继承 AgentBackend（保留 run/name），新增：
 * - id: RuntimeProviderId（canonical 标识，UI 用此判定，不 instanceof）
 * - displayName: 用户可读标签
 * - isAvailable(cwd): 当前环境是否可用（SDK 是否安装等）
 * - resolvePermission?/clearSessionPermissions?: SDK 路径的权限管理（CLI/mock/Codex 不实现）
 *
 * 实现者：ClaudeSdkRuntimeProvider / ClaudeCliRuntimeProvider / CodexRuntimeProvider / MockRuntimeProvider
 */
export interface RuntimeProvider extends AgentBackend {
  /** canonical provider 标识 */
  readonly id: RuntimeProviderId;
  /** 用户可读运行时标签 */
  readonly displayName: string;
  /** 当前环境是否可用（SDK 安装探测 / CLI 可执行性等） */
  isAvailable(cwd: string): boolean;
  /**
   * V2.3s: 解析待决策的权限请求（仅 claude-sdk 实现此方法）。
   * UI 通过 provider.id === "claude-sdk" 判定是否可调用，不 instanceof SdkBackend。
   */
  resolvePermission?(requestId: string, choice: PermissionChoice): boolean;
  /** V2.3s: 清空会话级权限缓存与待决策请求（仅 claude-sdk 实现此方法） */
  clearSessionPermissions?(): void;
}

// ---------- Provider 工厂 ----------

/**
 * Provider 工厂选项。
 * - strict: SDK 路径显式选择时为 true（不可用时不静默 fallback mock）
 */
export interface CreateRuntimeProviderOptions {
  /** mock 模式（success/failure），仅 mock provider 使用 */
  mockMode?: "success" | "failure";
  /** SDK strict 模式（显式选 sdk 时不可用直接 failed，不 fallback mock） */
  strict?: boolean;
}

/**
 * 延迟导入实现模块，避免 view.ts 直接 import SdkBackend / ClaudeCliBackend。
 * 工厂内部封装具体 backend 构造，UI 只持有 RuntimeProvider 引用。
 *
 * 注：为保持本文件可被 effectiveRunPlan.ts / normalizedRuntimeEvent.ts 等无副作用模块引用，
 * 具体实现类通过动态 require 按需加载，避免循环依赖与 UI 层硬编码。
 */
export function createRuntimeProvider(id: RuntimeProviderId, options: CreateRuntimeProviderOptions = {}): RuntimeProvider {
  switch (id) {
    case "claude-sdk": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SdkBackend } = require("./sdkBackend");
      const backend = new SdkBackend(!!options.strict);
      return wrapAsProvider(backend, "claude-sdk", providerDisplayName("claude-sdk"), (cwd: string) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { isSdkAvailable } = require("./sdkBackend");
        return isSdkAvailable(cwd);
      });
    }
    case "claude-cli": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ClaudeCliBackend } = require("./claudeCliBackend");
      const backend = new ClaudeCliBackend();
      return wrapAsProvider(backend, "claude-cli", providerDisplayName("claude-cli"), (_cwd: string) => true);
    }
    case "codex-sdk": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { CodexRuntimeProvider } = require("./codexRuntimeProvider");
      return new CodexRuntimeProvider();
    }
    case "mock": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { MockAgentBackend } = require("./mockAgentBackend");
      const backend = new MockAgentBackend(options.mockMode || "success");
      return wrapAsProvider(backend, "mock", providerDisplayName("mock"), (_cwd: string) => true);
    }
  }
}

/**
 * 将已有 AgentBackend 包装为 RuntimeProvider（补充 id / displayName / isAvailable）。
 * 用于 claude-sdk / claude-cli / mock：复用现有 backend 实现，仅补充 provider 元数据。
 *
 * V2.17-A 续: 若 backend 实现 resolvePermission / clearSessionPermissions（SdkBackend），
 * 则转发到 provider，使 UI 通过 provider 接口调用权限管理，不 instanceof SdkBackend。
 */
function wrapAsProvider(
  backend: AgentBackend,
  id: RuntimeProviderId,
  displayName: string,
  isAvailable: (cwd: string) => boolean,
): RuntimeProvider {
  const provider: RuntimeProvider = {
    name: backend.name,
    id,
    displayName,
    isAvailable,
    run: (task: AgentTask, settings: LLMBridgeSettings, onEvent: AgentEventHandler, onWorkflowEvent?) => {
      const handle = backend.run(task, settings, onEvent, onWorkflowEvent);
      return handle;
    },
  };
  // 转发 SDK 权限方法（若 backend 实现了）
  const withPermission = backend as AgentBackend & {
    resolvePermission?: (requestId: string, choice: PermissionChoice) => boolean;
    clearSessionPermissions?: () => void;
  };
  if (typeof withPermission.resolvePermission === "function") {
    provider.resolvePermission = withPermission.resolvePermission.bind(backend);
  }
  if (typeof withPermission.clearSessionPermissions === "function") {
    provider.clearSessionPermissions = withPermission.clearSessionPermissions.bind(backend);
  }
  return provider;
}

// ---------- BackendMode → RuntimeProviderId 映射 ----------

/**
 * 将 LLMBridgeSettings.backendMode（auto/cli/sdk/mock-success/mock-failure）映射到 RuntimeProviderId。
 * auto 模式由调用方在探测 SDK 可用性后决定 claude-sdk 或 claude-cli。
 */
export function resolveProviderFromBackendMode(
  mode: LLMBridgeSettings["backendMode"],
  sdkAvailable: boolean,
): RuntimeProviderId {
  switch (mode) {
    case "sdk": return "claude-sdk";
    case "cli": return "claude-cli";
    case "mock-success": return "mock";
    case "mock-failure": return "mock";
    case "auto":
    default:
      return sdkAvailable ? "claude-sdk" : "claude-cli";
  }
}

// ---------- Provider 能力声明（UI 决策用，不依赖具体 backend 类） ----------

/**
 * provider 是否支持 SDK Streaming Input（image content block 等）。
 * CLI/mock 路径忽略 sdkStreamingInput，全走 path ref。
 */
export function providerSupportsStreamingInput(provider: RuntimeProviderId): boolean {
  return provider === "claude-sdk" || provider === "codex-sdk";
}

/**
 * provider 是否产生结构化 WorkflowEvent（tool_start/tool_result/thinking 等）。
 * CLI/mock 仅产出 stdout_delta；UI 据此决定是否走 RunStateAggregator timeline。
 */
export function providerProducesWorkflowEvents(provider: RuntimeProviderId): boolean {
  return provider === "claude-sdk" || provider === "codex-sdk";
}

/**
 * provider 是否为 Codex 系（用于 EffectiveRunPlan 字段集合判定）。
 */
export function isCodexProvider(provider: RuntimeProviderId): boolean {
  return provider === "codex-sdk";
}

// ---------- Provider 适用的 permission 语义（用于跨 provider 一致性校验） ----------

/**
 * 将 Claude permissionMode 映射到 Codex approvalPolicy（跨 provider 一致性审计用）。
 * Codex skeleton 阶段不实际执行，仅保证类型结构与映射可比较。
 */
export function claudePermissionToCodexApproval(mode: ClaudePermissionMode): CodexApprovalPolicy {
  switch (mode) {
    case "default": return "on-request";
    case "acceptEdits": return "on-failure";
    case "plan": return "untrusted";
    case "auto": return "on-failure";
    case "dontAsk": return "never";
    case "bypassPermissions": return "never";
  }
}

/**
 * 判断 EffectiveRunPlan 是否为 Codex 类型（类型守卫）。
 */
export function isCodexEffectiveRunPlan(plan: EffectiveRunPlan | CodexEffectiveRunPlan): plan is CodexEffectiveRunPlan {
  return (plan as CodexEffectiveRunPlan).provider === "codex-sdk";
}
