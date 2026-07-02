// LLM CLI Bridge — Codex Runtime Provider (V2.17-A 续 skeleton)
// Codex runtime 接入骨架：当前不调用真实 Codex SDK/CLI，仅保证类型结构可承载
// CodexEffectiveRunPlan，使 UI 不依赖 Claude-only 类型，后续接入 Codex 无需重写 UI。
//
// 非目标（本轮不做）：
// - 不接入真实 Codex SDK（@openai/codex 等）
// - 不实现 Codex 专属工具调用映射
// - 不实现 Codex 流式事件解析
//
// 本轮目标：
// - CodexRuntimeProvider 可编译、可作为 adapter 接入（run() 发 failed 事件说明未实现）
// - 类型结构承载 CodexEffectiveRunPlan（approvalPolicy / sandboxMode）
// - UI 通过 RuntimeProvider.id === "codex-sdk" 判定，不 instanceof Claude-only 类型

import type { AgentEventHandler, AgentRunHandle, AgentTask } from "./agentBackend";
import type { LLMBridgeSettings } from "./types";
import type { RuntimeProvider } from "./runtimeProvider";
import type { WorkflowEventHandler } from "./workflowEvent";

/**
 * CodexRuntimeProvider — skeleton 实现。
 *
 * run() 当前直接发 failed 事件（"Codex runtime not yet implemented"），
 * 不调用任何真实 Codex 能力。后续接入时替换 run() 内部实现即可，
 * UI / EffectiveRunPlan / AssistantTurnView 路径无需改动。
 */
export class CodexRuntimeProvider implements RuntimeProvider {
  readonly id = "codex-sdk" as const;
  readonly name = "codex-sdk";
  readonly displayName = "Codex";

  isAvailable(_cwd: string): boolean {
    // skeleton: 当前不可用（未接入真实 Codex SDK）
    return false;
  }

  run(
    task: AgentTask,
    _settings: LLMBridgeSettings,
    onEvent: AgentEventHandler,
    onWorkflowEvent?: WorkflowEventHandler,
  ): AgentRunHandle {
    const startedAt = Date.now();
    onEvent({ type: "started", task });

    const errMsg = "Codex runtime not yet implemented (skeleton). Switch provider to claude-sdk / claude-cli / mock.";
    if (onWorkflowEvent) {
      const now = () => new Date().toISOString();
      onWorkflowEvent({
        type: "error",
        timestamp: now(),
        message: errMsg,
        recoverable: false,
      });
      onWorkflowEvent({
        type: "failed",
        timestamp: now(),
        message: errMsg,
        recoverable: false,
      });
    }

    onEvent({
      type: "failed",
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: errMsg,
      command: "codex",
      args: [],
    });

    return {
      get running(): boolean { return false; },
      stop(): void { /* no-op, already failed synchronously */ },
    };
  }
}
