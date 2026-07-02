// LLM CLI Bridge — ClaudeCliProvider (V2.17-A Completion)
//
// 把现有 ClaudeCliBackend 包装为 RuntimeProvider。作为 provider adapter 保留：
// Claude Code CLI（claude -p）通过此 adapter 接入 Bridge Core。
//
// Prompt 拆分映射：
// - claude-cli: bridgeSystemAppend + "\n\n" + userPrompt 合成 stdin（CLI 无 systemPrompt
//   append 能力，bridge-native 指令必须进入 stdin 头部）

import type { AgentTask, AgentRunHandle } from "../../../agentBackend";
import type { LLMBridgeSettings } from "../../../types";
import { ClaudeCliBackend } from "../../../claudeCliBackend";
import { buildEffectiveRunPlan } from "../../../effectiveRunPlan";
import type {
  EffectiveRunPlan,
  NormalizedRuntimeEvent,
  RunContext,
  RunInput,
  RuntimeProvider,
} from "../../core/types";
import { adaptAgentBackendToProvider, composePromptForBackend } from "../agentBackendAdapter";

/**
 * ClaudeCliProvider：包装 ClaudeCliBackend 为 RuntimeProvider。
 */
export class ClaudeCliProvider implements RuntimeProvider {
  readonly providerId = "claude-cli" as const;
  readonly displayName = "Claude Code";
  private readonly backend: ClaudeCliBackend;
  private currentHandle: AgentRunHandle | null = null;

  constructor() {
    this.backend = new ClaudeCliBackend();
  }

  isAvailable(_cwd: string): boolean {
    // CLI 始终可用（实际可用性由 spawn 时的 preflight 决定）
    return true;
  }

  buildPlan(input: RunInput, settings: LLMBridgeSettings): EffectiveRunPlan {
    const entries = input.promptPackage.attachmentEntries;
    const attachmentPlan = {
      messageScopedRefs: entries.filter((e) => e.scope === "message").length,
      pinnedRefs: entries.filter((e) => e.scope === "pinned").length,
      inlineSnippets: entries.filter((e) => e.packing === "inline-snippet").length,
      imageStreamingBlocks: entries.filter((e) => e.packing === "sdk-streaming-block").length,
      nativeRefOnly: entries.filter((e) => e.packing === "native-ref-only").length,
    };
    // CLI 无 settingSources/skills 概念，传空数组保持 plan 字段完整
    return buildEffectiveRunPlan({
      backend: "cli",
      settings,
      cwd: input.cwd,
      promptPackageText: input.promptPackage.auditHash,
      settingSources: [],
      skills: [],
      attachmentPlan,
    });
  }

  async *run(ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const developerMode = !!settings.developerMode;
    const prompt = composePromptForBackend(ctx, "cli");
    const task: AgentTask = {
      id: ctx.runId,
      userMessage: ctx.promptPackage.userPrompt,
      prompt,
      cwd: ctx.plan.cwd,
      createdAt: new Date().toISOString(),
      includeActiveNote: false,
      includeSelection: false,
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

  cancel(_runId: string): void {
    if (this.currentHandle) {
      this.currentHandle.stop();
      this.currentHandle = null;
    }
  }

  async *resume(sessionId: string, ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // CLI resume 通过 --resume <sessionId> 参数（commandProfile 已支持 claudeResumeSessionId）
    yield* this.run(ctx, settings);
  }
}
