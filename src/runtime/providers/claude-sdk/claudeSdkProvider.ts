// LLM CLI Bridge — ClaudeSdkProvider (V2.17-A Completion)
//
// 把现有 SdkBackend 包装为 RuntimeProvider。作为 provider adapter 保留：
// Claude SDK（@anthropic-ai/claude-agent-sdk）通过此 adapter 接入 Bridge Core。
//
// 职责：
// - isAvailable: 委托 SdkBackend 的 SDK 可用性探测（tryLoadSdk）
// - buildPlan:   委托 buildEffectiveRunPlan（backend="sdk"）
// - run:         构造 AgentTask（prompt = userPrompt；bridgeSystemAppend 走 systemPrompt append）
//                调用 SdkBackend.run，通过 agentBackendAdapter 转为 AsyncIterable
// - cancel:      委托 AgentRunHandle.stop()
// - resume:      复用 run 路径（SDK 内部通过 continue/resume options 处理）
//
// Prompt 拆分映射：
// - claude-sdk: userPrompt 作为 task.prompt；bridgeSystemAppend 由 SDK options 的
//   systemPrompt append 承载（V2.17-A §2 已实施 claude_code preset + append）

import type { AgentTask } from "../../../agentBackend";
import type { LLMBridgeSettings } from "../../../types";
import { SdkBackend, isSdkAvailable, buildSdkAgentSkillsOptions } from "../../../sdkBackend";
import { buildAttachmentPlan, buildEffectiveRunPlan } from "../../../effectiveRunPlan";
import type {
  NormalizedRuntimeEvent,
  RunContext,
  RunInput,
  RuntimeProvider,
} from "../../core/types";
import { adaptAgentBackendToProvider, composePromptForBackend } from "../agentBackendAdapter";

/**
 * ClaudeSdkProvider：包装 SdkBackend 为 RuntimeProvider。
 *
 * @param strict SDK 不可用时是否报错不 fallback（显式选 sdk 时 true；auto 时 false）
 */
export class ClaudeSdkProvider implements RuntimeProvider {
  readonly providerId = "claude-sdk" as const;
  readonly displayName = "Claude SDK";
  private readonly backend: SdkBackend;
  private currentHandle: import("../../../agentBackend").AgentRunHandle | null = null;

  constructor(private readonly strict: boolean = false) {
    this.backend = new SdkBackend(strict);
  }

  isAvailable(cwd: string): boolean {
    return isSdkAvailable(cwd);
  }

  buildPlan(input: RunInput, settings: LLMBridgeSettings): import("../../core/types").EffectiveRunPlan {
    const agentSkillsOptions = buildSdkAgentSkillsOptions(input.cwd);
    // attachmentPlan 从 promptPackage.attachmentEntries 聚合（counts + entry-level 审计）
    const attachmentPlan = buildAttachmentPlan(input.promptPackage.attachmentEntries);
    return buildEffectiveRunPlan({
      backend: "sdk",
      settings,
      cwd: input.cwd,
      promptPackageText: input.promptPackage.auditHash,
      settingSources: agentSkillsOptions.settingSources,
      skills: agentSkillsOptions.skills,
      attachmentPlan,
    });
  }

  async *run(ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const developerMode = !!settings.developerMode;
    const prompt = composePromptForBackend(ctx, "sdk");
    const task: AgentTask = {
      id: ctx.runId,
      userMessage: ctx.promptPackage.userPrompt,
      prompt,
      cwd: ctx.plan.cwd,
      createdAt: new Date().toISOString(),
      includeActiveNote: false, // 已在 userPrompt 中
      includeSelection: false,  // 已在 userPrompt 中
      sdkStreamingInput: ctx.sdkStreamingInput,
      runtimeFileToolAdapter: ctx.runtimeFileToolAdapter,
      effectiveRunPlan: ctx.plan,
    };
    const { events, handle } = adaptAgentBackendToProvider(
      this.backend, task, settings, this.providerId, developerMode,
    );
    this.currentHandle = handle;
    yield* events;
    this.currentHandle = null;
  }

  cancel(runId: string): void {
    if (this.currentHandle) {
      this.currentHandle.stop();
      this.currentHandle = null;
    }
  }

  async *resume(sessionId: string, ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // SDK 通过 settings.claudeResumeSessionId / claudeContinueSession 处理 resume
    // 这里复用 run 路径（plan.session 已含 resume 语义）
    yield* this.run(ctx, settings);
  }

  /** 暴露底层 SdkBackend 供 resolvePermission 等迁移期 API 使用 */
  getSdkBackend(): SdkBackend {
    return this.backend;
  }
}
