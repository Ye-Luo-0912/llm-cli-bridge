// LLM CLI Bridge — CodexSdkProvider (V17-F0 任务 B — Codex SDK-first Direction Correction)
//
// 主线占位 provider：使用 Codex Agent SDK / 嵌入式 runtime（而非 external codex app-server）。
//
// V17-F0 目标：把 Codex 线定性为 SDK-first，与 Claude/Pi 一致使用 SDK/runtime provider。
// 不再依赖用户安装 codex CLI / 打开 Codex Desktop App 作为普通用户主线。
//
// 本轮为最小占位骨架：
// - isAvailable() 返回 false（SDK 未实现）
// - run() 发 failed 事件，说明 Codex SDK 尚未实现
// - readiness 以 smoke 报告为准（codexSdkAvailable / codexSdkAuthAvailable）
//
// 后续完整实现应使用 @openai/codex-sdk（或类似嵌入式 SDK）加载 agent runtime，
// 不再 spawn 子进程。

import type {
  EffectiveRunPlan,
  NormalizedRuntimeEvent,
  RunContext,
  RunInput,
  RuntimeProvider,
} from "../../core/types";
import type { CodexSdkEffectiveRunPlan, LLMBridgeSettings } from "../../../types";

/**
 * CodexSdkProvider：Codex Agent SDK 嵌入式 runtime（主线占位）。
 *
 * V17-F0 任务 B：作为 Codex 线主线占位，与 CodexExternalAppServerProvider 区分。
 * - providerId = "codex-sdk"
 * - 本轮 isAvailable() 返回 false（SDK 未实现）
 * - 后续实现应使用 dynamic import 加载 @openai/codex-sdk（或同等嵌入式 runtime）
 */
export class CodexSdkProvider implements RuntimeProvider {
  readonly providerId = "codex-sdk" as const;
  readonly displayName = "Codex SDK (mainline placeholder)";

  isAvailable(_cwd: string): boolean {
    // V17-F0 任务 B：占位 — SDK 未完整实现，readiness 以 smoke 报告为准
    return false;
  }

  buildPlan(_input: RunInput, _settings: LLMBridgeSettings): EffectiveRunPlan {
    // 占位：返回最小 plan（实际实现时替换为 CodexSdkEffectiveRunPlan 完整字段）
    const plan: CodexSdkEffectiveRunPlan = {
      backend: "codex-sdk",
      cwd: _input.cwd || "",
      model: "codex-sdk-placeholder",
      systemPrompt: "",
      toolsPreset: "read-only",
      bridgeSystemAppend: "",
      attachmentPlan: {
        messageScopedRefs: 0,
        pinnedRefs: 0,
        inlineSnippets: 0,
        imageStreamingBlocks: 0,
        nativeRefOnly: 0,
        entries: [],
      },
      sdkConfigSource: "placeholder",
      settingSources: [],
      skills: [],
      effort: "medium",
      session: { continueSession: false },
      promptPackageHash: "",
      createdAt: new Date().toISOString(),
    } as unknown as CodexSdkEffectiveRunPlan;
    return plan;
  }

  async *run(_ctx: RunContext, _settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // V17-F0 任务 B：占位 — 未实现时发 failed 事件
    yield {
      providerId: "codex-sdk",
      timestamp: new Date().toISOString(),
      payload: { kind: "failed", message: "Codex SDK 尚未实现（V17-F0 主线占位）。请使用 codex-app-server-external 作为高级 fallback，或等待 SDK 实现。", recoverable: false },
    };
  }

  cancel(_runId: string): void {
    // 占位 — 无操作
  }

  async *resume(_sessionId: string, _ctx: RunContext, _settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    yield {
      providerId: "codex-sdk",
      timestamp: new Date().toISOString(),
      payload: { kind: "failed", message: "Codex SDK resume 尚未实现（V17-F0 主线占位）。", recoverable: false },
    };
  }

  restoreProviderSession?(_bridgeSessionId: string, _providerThreadId?: string, _providerSessionId?: string): void {
    // 占位 — 无操作
  }
}
