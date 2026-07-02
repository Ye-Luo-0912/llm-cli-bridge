// LLM CLI Bridge — AgentBackend → AsyncIterable<NormalizedRuntimeEvent> adapter
// (V2.17-A Completion)
//
// 把现有 V2.17-A 过渡层的 AgentBackend（callback-based run）适配为 Bridge Core 的
// AsyncIterable<NormalizedRuntimeEvent>。这是 claude-sdk / claude-cli / mock provider
// adapter 的共享适配层。
//
// 适配流程：
// 1. provider.run() 内部构造 AgentTask（含 effectiveRunPlan + promptPackage 合成的 prompt）
// 2. 调用 backend.run(task, settings, onEvent, onWorkflowEvent) 拿到 AgentRunHandle
// 3. onEvent/onWorkflowEvent 回调把事件 push 到 async queue
// 4. async generator 从 queue yield NormalizedRuntimeEvent
// 5. 终态事件（completed/failed/stopped）后关闭 queue
//
// handle 通过 handleSink 回调同步暴露给 provider（用于 cancel）

import type {
  AgentBackend,
  AgentEvent,
  AgentEventHandler,
  AgentRunHandle,
  AgentTask,
} from "../../agentBackend";
import type {
  WorkflowEvent,
  WorkflowEventHandler,
} from "../../workflowEvent";
import type {
  NormalizedRuntimeEvent,
  ProviderId,
  RunContext,
} from "../core/types";
import { mapWorkflowEventToNormalized } from "./workflowEventMapper";

/**
 * AgentBackend 适配结果：异步事件流 + 句柄引用。
 */
export interface AgentBackendAdapterResult {
  /** NormalizedRuntimeEvent 异步流 */
  events: AsyncIterable<NormalizedRuntimeEvent>;
  /** backend run handle（cancel 用；同步可用） */
  handle: AgentRunHandle;
}

/**
 * AgentBackend 适配器：把 callback-based backend.run 转为 AsyncIterable。
 *
 * @param backend 具体 AgentBackend 实例（SdkBackend / ClaudeCliBackend / MockAgentBackend）
 * @param task 构造好的 AgentTask（含 effectiveRunPlan + prompt）
 * @param settings 插件设置
 * @param providerId provider 标识
 * @param developerMode 是否填充 rawProviderEvent
 */
export function adaptAgentBackendToProvider(
  backend: AgentBackend,
  task: AgentTask,
  settings: import("../../types").LLMBridgeSettings,
  providerId: ProviderId,
  developerMode: boolean,
): AgentBackendAdapterResult {
  const queue = new Array<NormalizedRuntimeEvent>();
  let resolveWait: (() => void) | null = null;
  let done = false;

  const push = (ev: NormalizedRuntimeEvent): void => {
    queue.push(ev);
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r();
    }
  };

  const signalDone = (): void => {
    done = true;
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r();
    }
  };

  const onEvent: AgentEventHandler = (event: AgentEvent): void => {
    const ts = new Date().toISOString();
    switch (event.type) {
      case "started":
        // started 不映射为 NormalizedRuntimeEvent（session_started 由 workflow event 提供）
        break;
      case "stdout_delta":
        push({
          providerId,
          timestamp: ts,
          rawProviderEvent: developerMode ? event : undefined,
          payload: { kind: "stdout_delta", data: event.data },
        });
        break;
      case "stderr_delta":
        push({
          providerId,
          timestamp: ts,
          rawProviderEvent: developerMode ? event : undefined,
          payload: { kind: "stderr_delta", data: event.data },
        });
        break;
      case "completed":
        push({
          providerId,
          timestamp: ts,
          rawProviderEvent: developerMode ? event : undefined,
          payload: {
            kind: "completed",
            text: event.stdout,
            durationMs: event.durationMs,
          },
        });
        signalDone();
        break;
      case "failed":
        push({
          providerId,
          timestamp: ts,
          rawProviderEvent: developerMode ? event : undefined,
          payload: {
            kind: "failed",
            message: event.stderr || `command failed: ${event.command}`,
            recoverable: false,
          },
        });
        signalDone();
        break;
      case "stopped":
        push({
          providerId,
          timestamp: ts,
          rawProviderEvent: developerMode ? event : undefined,
          payload: {
            kind: "failed",
            message: "stopped by user",
            recoverable: false,
          },
        });
        signalDone();
        break;
    }
  };

  const onWorkflowEvent: WorkflowEventHandler = (wfEvent: WorkflowEvent): void => {
    push(mapWorkflowEventToNormalized(wfEvent, providerId, developerMode));
  };

  // 启动 backend（同步返回 handle）
  const handle = backend.run(task, settings, onEvent, onWorkflowEvent);

  async function* events(): AsyncIterable<NormalizedRuntimeEvent> {
    while (!done) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      // 等待新事件
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }
    // flush 剩余
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  }

  return { events: events(), handle };
}

/**
 * 把 RunContext + BridgePromptPackage 合成为传给 AgentBackend 的 prompt 字符串。
 *
 * - claude-cli: bridgeSystemAppend + "\n\n" + userPrompt（合成 stdin）
 * - claude-sdk: userPrompt 作为 prompt；bridgeSystemAppend 由 SDK options systemPrompt append 处理
 */
export function composePromptForBackend(ctx: RunContext, mode: "cli" | "sdk"): string {
  if (mode === "cli") {
    return ctx.promptPackage.bridgeSystemAppend + "\n\n" + ctx.promptPackage.userPrompt;
  }
  return ctx.promptPackage.userPrompt;
}
