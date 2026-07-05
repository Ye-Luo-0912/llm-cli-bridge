// LLM CLI Bridge — BridgeSession 实现 (V2.17-A Completion)
//
// UI 与 provider 之间的会话编排器。职责：
// 1. 按 settings.backendMode + provider 可用性选择 RuntimeProvider
// 2. 构造 RunInput → BridgePromptPackage → EffectiveRunPlan（通过 provider.buildPlan）
// 3. 调用 provider.run(ctx) 返回 AsyncIterable<NormalizedRuntimeEvent>
// 4. cancel(runId) / resume(sessionId)
//
// UI 不直接接触 provider 实例，只通过 BridgeSession 交互。
//
// provider 选择策略（V17-E 任务 B：codex-first；V17-E 任务 F：Pi 降级为 optional/advanced backend；
//                    V17-E1 任务 B：portable auto 也改为 Codex-first，Pi 仅显式选择）：
// - auto（不论 portable 还是 developer）：codex-app-server → claude-sdk → claude-cli（Codex-first，普通用户默认主线）
// - codex:            强制 Codex app-server（不可用时不静默 fallback）
// - cli:              claude-cli
// - sdk:              claude-sdk（strict，不可用时报错不 fallback）
// - pi-sdk / pi-rpc:  对应 Pi provider（optional/advanced backend；仅显式选择才进入 Pi；不可用时不静默 fallback）
// - mock-success / mock-failure: mock
//
// V17-E1 任务 B：portable profile 不再默认 Pi-first。Pi 降级为 optional/advanced backend，
// 普通用户（无论 developer 还是 portable）的 auto 默认主线是 Codex-first。
// V17-E 任务 F：friendReady 字段废弃，改名为 piAdvancedReady。
// Pi provider ESM dynamic import 修复作为独立修复项，不阻塞 Codex-first audit。

import type { LLMBridgeSettings } from "../../types";
import type {
  BridgeSession,
  NormalizedRuntimeEvent,
  RunInput,
  RuntimeProvider,
  ProviderId,
} from "./types";
import type { PermissionBoundary } from "./types";
import { createPermissionBoundary, PermissionBoundaryImpl } from "./permissionBoundary";
import { createUserInputBoundary, UserInputBoundaryImpl } from "./userInputBoundary";
import { ClaudeSdkProvider } from "../providers/claude-sdk/claudeSdkProvider";
import { ClaudeCliProvider } from "../providers/claude-cli/claudeCliProvider";
import { MockProvider } from "../providers/mock/mockProvider";
import { CodexAppServerProvider } from "../providers/codex-app-server/codexAppServerProvider";
import { PiRpcProvider } from "../providers/pi-rpc/piRpcProvider";
import { PiSdkProvider } from "../providers/pi-sdk/piSdkProvider";

/**
 * 选择 RuntimeProvider（按 settings.backendMode + provider 可用性）。
 *
 * V17-E1 任务 B：portable auto 不再 Pi-first。auto（不论 portable 还是 developer）
 * 统一走 codex-app-server → claude-sdk → claude-cli 链（Codex-first）。
 * Pi 仅在显式选择 pi-sdk / pi-rpc 时才进入（optional/advanced backend）。
 *
 * V17-E 任务 F：Pi 降级为 optional/advanced backend；friendReady 改名为 piAdvancedReady。
 * V17-E 任务 A：selectProvider 传 settings.codexCommand 给 CodexAppServerProvider。
 *
 * @param settings 插件设置
 * @param cwd Vault 根目录
 * @returns provider 与显示 label
 */
export function selectProvider(
  settings: LLMBridgeSettings,
  cwd: string,
): { provider: RuntimeProvider; label: string } {
  const mode = settings.backendMode;

  if (mode === "mock-success") {
    return { provider: new MockProvider("success"), label: "Mock" };
  }
  if (mode === "mock-failure") {
    return { provider: new MockProvider("failure"), label: "Mock" };
  }
  // V17-E 任务 B：显式 codex BackendMode — 强制使用 Codex app-server（不可用时不静默 fallback）
  if (mode === "codex") {
    const codex = new CodexAppServerProvider(false, settings.codexCommand || "codex");
    if (codex.isAvailable(cwd)) {
      return { provider: codex, label: "Codex app-server" };
    }
    return { provider: codex, label: "Codex app-server (unavailable)" };
  }
  if (mode === "cli") {
    return { provider: new ClaudeCliProvider(), label: "Claude Code" };
  }
  if (mode === "sdk") {
    return { provider: new ClaudeSdkProvider(true), label: "SDK" };
  }
  if (mode === "pi-rpc") {
    const pi = new PiRpcProvider(settings.piCommand, { cwd });
    if (pi.isAvailable(cwd)) {
      return { provider: pi, label: "Pi RPC" };
    }
    // Pi 显式选择但不可用：返回 Pi（run 时发 failed 提示），不静默 fallback
    return { provider: pi, label: "Pi RPC (unavailable)" };
  }
  if (mode === "pi-sdk") {
    const piSdk = new PiSdkProvider();
    if (piSdk.isAvailable(cwd)) {
      return { provider: piSdk, label: "Pi SDK" };
    }
    // 显式选 pi-sdk 但不可用：返回 pi-sdk（run 时发 failed），不静默 fallback
    return { provider: piSdk, label: "Pi SDK (unavailable)" };
  }

  // V17-E1 任务 B：auto（不论 portable 还是 developer）统一走 Codex-first 链
  // Pi 不再作为 portable auto 的默认；仅显式 pi-sdk / pi-rpc 才进入 Pi。
  const codex = new CodexAppServerProvider(false, settings.codexCommand || "codex");
  if (codex.isAvailable(cwd)) {
    return { provider: codex, label: "Codex app-server" };
  }
  const sdk = new ClaudeSdkProvider(false);
  if (sdk.isAvailable(cwd)) {
    return { provider: sdk, label: "SDK" };
  }
  return { provider: new ClaudeCliProvider(), label: "Claude Code fallback" };
}

/**
 * BridgeSession 默认实现。
 */
export class BridgeSessionImpl implements BridgeSession {
  readonly sessionId: string;
  readonly provider: RuntimeProvider;
  readonly providerId: ProviderId;
  /** V16.4-F2: 非 readonly，rebuildPermissionBoundary 可重建（接口仍 readonly 约束外部赋值） */
  permission: PermissionBoundaryImpl;
  readonly userInput: UserInputBoundaryImpl;
  readonly displayLabel: string;

  /**
   * provider 侧 thread id（codex app-server threadId）。
   * run/resume 完成后由 syncProviderThreadFromMapper() 同步。
   */
  private _providerThreadId: string | undefined;
  /**
   * provider 侧 session id（codex app-server sessionId）。
   * run/resume 完成后由 syncProviderThreadFromMapper() 同步。
   */
  private _providerSessionId: string | undefined;

  private currentRunId: string | null = null;

  constructor(sessionId: string, provider: RuntimeProvider, label: string, settings: LLMBridgeSettings) {
    this.sessionId = sessionId;
    this.provider = provider;
    this.providerId = provider.providerId;
    this.displayLabel = label;
    this.permission = createPermissionBoundary(settings.claudePermissionMode, settings.permissionPolicy);
    this.userInput = createUserInputBoundary();
  }

  get providerThreadId(): string | undefined {
    return this._providerThreadId;
  }

  get providerSessionId(): string | undefined {
    return this._providerSessionId;
  }

  async *start(input: RunInput, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentRunId = runId;
    try {
      const plan = this.provider.buildPlan(input, settings);
      const ctx = {
        plan,
        promptPackage: input.promptPackage,
        permission: this.permission,
        userInput: this.userInput,
        runId,
        bridgeSessionId: this.sessionId,
        resumeSessionId: undefined as string | undefined,
        sdkStreamingInput: input.sdkStreamingInput,
        runtimeFileToolAdapter: input.runtimeFileToolAdapter,
      };
      yield* this.provider.run(ctx, settings);
    } finally {
      // V2.17-A Completion: run 完成后同步 provider thread/session（供 keepLastSession resume 用）
      this.syncProviderThreadFromMapper();
      // P5: currentRunId 清理移进 finally，确保 buildPlan/run 抛错时也清理（避免泄漏）
      this.currentRunId = null;
    }
  }

  cancel(runId: string): void {
    this.provider.cancel(runId);
    this.permission.cancelAllPending();
    this.userInput.cancelAllPending();
    // P5: 清理 session 侧 currentRunId（provider.cancel 已清理 provider 侧）
    this.currentRunId = null;
  }

  /**
   * V2.17-A Completion: 从持久化的 providerThreadId/providerSessionId 回填 provider session 状态。
   *
   * keepLastSession 恢复时由 UI 调用：把 session 文件中保存的 codex threadId/sessionId
   * 注入 provider 的 sessionMapper（若 provider 支持），使后续 resume() 命中 thread/resume 路径。
   * 同时更新本会话的 _providerThreadId/_providerSessionId 缓存。
   * 非 codex provider 无 restoreProviderSession 方法时静默跳过。
   */
  restoreProviderSession(providerThreadId?: string, providerSessionId?: string): void {
    if (providerThreadId) this._providerThreadId = providerThreadId;
    if (providerSessionId) this._providerSessionId = providerSessionId;
    const providerWithRestore = this.provider as RuntimeProvider & {
      restoreProviderSession?(bridgeSessionId: string, threadId?: string, sessionId?: string): void;
    };
    if (typeof providerWithRestore.restoreProviderSession === "function") {
      providerWithRestore.restoreProviderSession(this.sessionId, providerThreadId, providerSessionId);
    }
  }

  /**
   * V16.4-F2: 用最新 settings 重建 PermissionBoundary。
   *
   * 仅在无 run 进行时（currentRunId === null）且 mode 变化时才重建：
   * - 当前 run 已持有 ctx.permission（旧 boundary 引用），不受影响；
   * - 下一次 run 调用 start/resume 时读取 this.permission（新 boundary），使用新 mode；
   * - session allow/deny 缓存随重建丢失（mode 切换意味着权限策略改变）。
   */
  rebuildPermissionBoundary(settings: LLMBridgeSettings): void {
    if (this.currentRunId !== null) return;
    if (this.permission.mode === settings.claudePermissionMode) return;
    this.permission = createPermissionBoundary(settings.claudePermissionMode, settings.permissionPolicy);
  }

  async *resume(sessionId: string, input: RunInput, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const runId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentRunId = runId;
    try {
      const plan = this.provider.buildPlan(input, settings);
      const ctx = {
        plan,
        promptPackage: input.promptPackage,
        permission: this.permission,
        userInput: this.userInput,
        runId,
        bridgeSessionId: this.sessionId,
        resumeSessionId: sessionId,
        sdkStreamingInput: input.sdkStreamingInput,
        runtimeFileToolAdapter: input.runtimeFileToolAdapter,
      };
      yield* this.provider.resume(sessionId, ctx, settings);
    } finally {
      // V2.17-A Completion: resume 完成后同步 provider thread/session（thread/resume 返回的新 threadId）
      this.syncProviderThreadFromMapper();
      // P5: currentRunId 清理移进 finally，确保 buildPlan/resume 抛错时也清理（避免泄漏）
      this.currentRunId = null;
    }
  }

  /**
   * 从 provider 的 sessionMapper 同步 providerThreadId/providerSessionId。
   *
   * codex-app-server provider 暴露 getSessionMapper()；非 codex provider 无此方法时跳过。
   * 同步后 BridgeSession.providerThreadId / providerSessionId 可供 UI 持久化与 keepLastSession resume 用。
   */
  private syncProviderThreadFromMapper(): void {
    const providerWithMapper = this.provider as RuntimeProvider & {
      getSessionMapper?: () => {
        getProviderThreadId?(bridgeSessionId: string): string | undefined;
        getProviderSessionId?(bridgeSessionId: string): string | undefined;
      };
    };
    if (typeof providerWithMapper.getSessionMapper !== "function") return;
    const mapper = providerWithMapper.getSessionMapper();
    if (!mapper) return;
    this._providerThreadId = mapper.getProviderThreadId?.(this.sessionId);
    this._providerSessionId = mapper.getProviderSessionId?.(this.sessionId);
  }
}

/**
 * 创建 BridgeSession（按 settings 选择 provider）。
 */
export function createBridgeSession(
  sessionId: string,
  settings: LLMBridgeSettings,
  cwd: string,
): BridgeSessionImpl {
  const { provider, label } = selectProvider(settings, cwd);
  return new BridgeSessionImpl(sessionId, provider, label, settings);
}
