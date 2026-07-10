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
  NativeSessionRef,
  RunContext,
} from "./types";
import type { PermissionBoundary } from "./types";
import { createPermissionBoundary, PermissionBoundaryImpl } from "./permissionBoundary";
import { createUserInputBoundary, UserInputBoundaryImpl } from "./userInputBoundary";
import { ClaudeSdkProvider } from "../providers/claude-sdk/claudeSdkProvider";
import { ClaudeCliProvider } from "../providers/claude-cli/claudeCliProvider";
import { MockProvider } from "../providers/mock/mockProvider";
import { CodexExternalAppServerProvider } from "../providers/codex-app-server/codexAppServerProvider";
import { CodexSdkProvider } from "../providers/codex-sdk/codexSdkProvider";
import { CodexManagedAppServerProvider } from "../providers/codex-managed-app-server/codexManagedAppServerProvider";
import { resolveManagedRuntime, resolveManifestPath } from "../providers/codex-managed-app-server/codexManagedRuntimeResolver";
import { PiRpcProvider } from "../providers/pi-rpc/piRpcProvider";
import { PiSdkProvider } from "../providers/pi-sdk/piSdkProvider";

/**
 * 选择 RuntimeProvider（按 settings.backendMode + provider 可用性）。
 *
 * V17-F1 任务 D：Managed runtime 主线。
 * - auto（不论 portable 还是 developer）：codex-managed-app-server → codex-sdk → claude-sdk → pi-sdk → claude-cli
 *   不依赖用户安装 Codex CLI / Desktop App，使用我们管理的 pinned runtime binary。
 * - codex-managed-app-server: V17-F1 主线，使用 manifest + sha256 + executable 校验的 pinned binary
 * - codex-sdk: 显式 Codex SDK（本轮占位，未完整实现时 unavailable）
 * - codex-app-server-external: 显式 external app-server（高级/开发者 fallback）
 * - cli / sdk / pi-sdk / pi-rpc: 各自显式 provider
 *
 * V17-F0 任务 C：SDK-first 方向。
 * V17-E1 任务 B：portable auto 不再 Pi-first。
 * V17-E 任务 F：Pi 降级为 optional/advanced backend；friendReady 改名为 piAdvancedReady。
 *
 * @param settings 插件设置
 * @param cwd Vault 根目录
 * @param pluginDir V17-F1.1 任务 C：插件目录（含 main.js + codex-managed-runtime/）；不传时 fallback 到 globalThis.__dirname
 * @returns provider 与显示 label
 */
export function selectProvider(
  settings: LLMBridgeSettings,
  cwd: string,
  pluginDir?: string,
): { provider: RuntimeProvider; label: string } {
  const mode = settings.backendMode;

  if (mode === "mock-success") {
    return { provider: new MockProvider("success"), label: "Mock" };
  }
  if (mode === "mock-failure") {
    return { provider: new MockProvider("failure"), label: "Mock" };
  }
  // V17-F1 任务 D：codex-managed-app-server 为主线（使用我们管理的 pinned runtime binary）
  if (mode === "codex-managed-app-server") {
    const managed = createManagedProvider(pluginDir);
    if (managed.resolver.available) {
      return { provider: managed.provider, label: managed.fixture ? "Codex managed (fixture)" : "Codex managed" };
    }
    if (managed.resolver.reason === "path-not-exist") {
      return { provider: managed.provider, label: "Codex runtime install required" };
    }
    return { provider: managed.provider, label: `Codex managed (unavailable: ${managed.resolver.reason})` };
  }
  // V17-F0 任务 C：codex-sdk 为主线占位（本轮未完整实现，readiness 以 smoke 报告为准）
  if (mode === "codex-sdk") {
    const codexSdk = new CodexSdkProvider();
    if (codexSdk.isAvailable(cwd)) {
      return { provider: codexSdk, label: "Codex SDK" };
    }
    return { provider: codexSdk, label: "Codex SDK (unavailable — mainline placeholder)" };
  }
  // V17-F0 任务 C：codex-app-server-external 为高级/开发者 fallback（不作为普通用户主线）
  if (mode === "codex-app-server-external") {
    const codex = new CodexExternalAppServerProvider(false, settings.codexCommand || "codex");
    if (codex.isAvailable(cwd)) {
      return { provider: codex, label: "Codex app-server (external)" };
    }
    return { provider: codex, label: "Codex app-server (external, unavailable)" };
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

  // V17-F1 任务 D + V17-F3.2 任务 A：auto = Managed runtime first 链。
  // 若 managed runtime manifest 存在但 binary 缺失，普通用户需要 first-run installer，
  // 不静默 fallback 到 Claude/Pi；其它不可用原因才继续兼容链。
  const managed = createManagedProvider(pluginDir);
  if (managed.resolver.available) {
    return { provider: managed.provider, label: managed.fixture ? "Codex managed (fixture)" : "Codex managed" };
  }
  if (managed.resolver.reason === "path-not-exist") {
    return { provider: managed.provider, label: "Codex runtime install required" };
  }
  const codexSdk = new CodexSdkProvider();
  if (codexSdk.isAvailable(cwd)) {
    return { provider: codexSdk, label: "Codex SDK" };
  }
  const sdk = new ClaudeSdkProvider(false);
  if (sdk.isAvailable(cwd)) {
    return { provider: sdk, label: "Claude SDK" };
  }
  const piSdk = new PiSdkProvider();
  if (piSdk.isAvailable(cwd)) {
    return { provider: piSdk, label: "Pi SDK" };
  }
  return { provider: new ClaudeCliProvider(), label: "Claude Code fallback" };
}

/**
 * V17-F1 任务 D + V17-F1.1 任务 C：创建 CodexManagedAppServerProvider。
 *
 * V17-F1.1 任务 C：pluginDir 注入路径优先级：
 *   1. 显式传入的 pluginDir 参数（main.ts onload 时从 this.manifest.dir 获取）
 *   2. globalThis.__dirname（esbuild CJS 打包后注入）
 *   3. 空字符串（resolver 会返回 manifest-not-found）
 */
function createManagedProvider(pluginDir?: string): {
  provider: CodexManagedAppServerProvider;
  resolver: import("../providers/codex-managed-app-server/codexManagedRuntimeResolver").ManagedRuntimeResolverResult;
  fixture: boolean;
} {
  // V17-F1.1 任务 C：优先用显式 pluginDir，fallback 到 globalThis.__dirname
  const g = globalThis as { __dirname?: string };
  const resolvedPluginDir = pluginDir || g.__dirname || "";
  const manifestPath = resolveManifestPath(resolvedPluginDir);
  const resolver = resolveManagedRuntime(manifestPath);
  const provider = new CodexManagedAppServerProvider(resolver, resolver.appServerArgs);
  return { provider, resolver, fixture: resolver.fixture };
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
   * 当前活动的 native session 引用（latest native session only 模型）。
   * thread/start 或 thread/resume 成功后由 native_session_bound 事件绑定。
   */
  private _activeNativeSessionRef: NativeSessionRef | undefined;

  private currentRunId: string | null = null;

  constructor(sessionId: string, provider: RuntimeProvider, label: string, settings: LLMBridgeSettings) {
    this.sessionId = sessionId;
    this.provider = provider;
    this.providerId = provider.providerId;
    this.displayLabel = label;
    this.permission = createPermissionBoundary(
      settings.claudePermissionMode,
      settings.permissionPolicy,
      /codex/i.test(provider.providerId) ? "native-pending" : "claude-mode",
    );
    this.userInput = createUserInputBoundary();
  }

  get activeNativeSessionRef(): NativeSessionRef | undefined {
    return this._activeNativeSessionRef;
  }

  async *start(input: RunInput, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentRunId = runId;
    // 新 run：清除旧 ref（start = 新 thread）
    this._activeNativeSessionRef = undefined;
    try {
      const plan = this.provider.buildPlan(input, settings);
      const ctx: RunContext = {
        plan,
        promptPackage: input.promptPackage,
        permission: this.permission,
        userInput: this.userInput,
        runId,
        bridgeSessionId: this.sessionId,
        activeNativeSessionRef: undefined,
        sdkStreamingInput: input.sdkStreamingInput,
        runtimeFileToolAdapter: input.runtimeFileToolAdapter,
      };
      yield* this.provider.run(ctx, settings);
    } finally {
      this.currentRunId = null;
    }
  }

  cancel(runId: string): void {
    this.permission.cancelAllPending();
    this.userInput.cancelAllPending();
    this.provider.cancel(runId);
    this.currentRunId = null;
  }

  /**
   * 从持久化的 lastNativeSessionRef 回填 activeNativeSessionRef。
   *
   * keepLastSession 恢复时由 UI 调用。
   * 传入 undefined 时清空（transcript-only 恢复）。
   */
  restoreActiveNativeSessionRef(ref?: NativeSessionRef): void {
    this._activeNativeSessionRef = ref;
    if (ref) {
      const providerWithRestore = this.provider as RuntimeProvider & {
        restoreActiveNativeSessionRef?(r?: NativeSessionRef): void;
      };
      if (typeof providerWithRestore.restoreActiveNativeSessionRef === "function") {
        providerWithRestore.restoreActiveNativeSessionRef(ref);
      }
    }
  }

  /**
   * V16.4-F2: 用最新 settings 重建 PermissionBoundary。
   */
  rebuildPermissionBoundary(settings: LLMBridgeSettings): void {
    if (this.currentRunId !== null) return;
    const strategy = /codex/i.test(this.providerId) ? "native-pending" : "claude-mode";
    const current = this.permission as PermissionBoundaryImpl;
    if (strategy === "native-pending") {
      // Codex：边界策略固定 native-pending；画像变更由下一轮 turn/start wire 生效
      if (current.strategy === "native-pending") return;
    } else if (current.mode === settings.claudePermissionMode && current.strategy === "claude-mode") {
      return;
    }
    this.permission = createPermissionBoundary(settings.claudePermissionMode, settings.permissionPolicy, strategy);
  }

  async *resume(ref: NativeSessionRef, input: RunInput, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const runId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentRunId = runId;
    this._activeNativeSessionRef = ref;
    try {
      const plan = this.provider.buildPlan(input, settings);
      const ctx: RunContext = {
        plan,
        promptPackage: input.promptPackage,
        permission: this.permission,
        userInput: this.userInput,
        runId,
        bridgeSessionId: this.sessionId,
        activeNativeSessionRef: ref,
        sdkStreamingInput: input.sdkStreamingInput,
        runtimeFileToolAdapter: input.runtimeFileToolAdapter,
      };
      yield* this.provider.resume(ref, ctx, settings);
    } finally {
      this.currentRunId = null;
    }
  }
}

/**
 * 创建 BridgeSession（按 settings 选择 provider）。
 *
 * V17-F1.1 任务 C：pluginDir 由调用方（view.ts → main.ts onload）注入。
 */
export function createBridgeSession(
  sessionId: string,
  settings: LLMBridgeSettings,
  cwd: string,
  pluginDir?: string,
): BridgeSessionImpl {
  const { provider, label } = selectProvider(settings, cwd, pluginDir);
  return new BridgeSessionImpl(sessionId, provider, label, settings);
}
