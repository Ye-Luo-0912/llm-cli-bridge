// LLM CLI Bridge — MockProvider (V2.17-A Completion)
//
// 把现有 MockAgentBackend 包装为 RuntimeProvider。
// 用于 dev/demo（backendMode = mock-success / mock-failure）与单元测试。
//
// 与 ClaudeSdkProvider / ClaudeCliProvider 共享 agentBackendAdapter：
// - run() 内部构造 AgentTask，调用 MockAgentBackend.run
// - 事件流通过 adaptAgentBackendToProvider 转为 AsyncIterable<NormalizedRuntimeEvent>

import type { AgentTask, AgentRunHandle } from "../../../agentBackend";
import type { LLMBridgeSettings } from "../../../types";
import { MockAgentBackend, type MockMode } from "../../../mockAgentBackend";
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
 * MockProvider：包装 MockAgentBackend 为 RuntimeProvider。
 *
 * @param mode "success" / "failure"
 */
export class MockProvider implements RuntimeProvider {
  readonly providerId = "mock" as const;
  readonly displayName = "Mock";
  private readonly mode: MockMode;
  private readonly backend: MockAgentBackend;
  private currentHandle: AgentRunHandle | null = null;

  constructor(mode: MockMode = "success") {
    this.mode = mode;
    this.backend = new MockAgentBackend(mode);
  }

  isAvailable(_cwd: string): boolean {
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
    // Mock 复用 cli backend 字段（plan.backend 为 "cli" 因为 MockAgentBackend 行为更接近 CLI）
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

  async *resume(_sessionId: string, ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // Mock 不支持 resume，直接复用 run 路径
    yield* this.run(ctx, settings);
  }

  /** 暴露 mock 模式（测试用） */
  getMode(): MockMode {
    return this.mode;
  }
}
