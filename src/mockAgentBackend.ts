// LLM CLI Bridge — Mock AgentBackend
// 用于 UI 测试和 demo，不调用真实 Claude CLI
// 支持 success / failure 两种模式，按 AgentBackend 接口产出事件

import { AgentBackend, AgentEventHandler, AgentRunHandle, AgentTask } from "./agentBackend";
import { LLMBridgeSettings } from "./types";

export type MockMode = "success" | "failure";

/**
 * Mock AgentBackend
 * 不调用真实 CLI，模拟事件流供 UI 测试和 demo 使用
 * - success 模式：started → stdout_delta → completed(exitCode=0)
 * - failure 模式：started → stderr_delta → failed(exitCode=1)
 */
export class MockAgentBackend implements AgentBackend {
  readonly name = "mock";

  constructor(private readonly mode: MockMode = "success") {}

  run(task: AgentTask, _settings: LLMBridgeSettings, onEvent: AgentEventHandler): AgentRunHandle {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    // 异步产出事件，模拟真实 CLI 的行为
    const produce = () => {
      onEvent({ type: "started", task });

      timer = setTimeout(() => {
        if (stopped) return;
        const durationMs = Date.now() - startedAt;

        if (this.mode === "success") {
          const sampleOutput = `[mock] 已处理任务 ${task.id}\n用户输入: ${task.userMessage}\n模拟完成。`;
          onEvent({ type: "stdout_delta", data: sampleOutput });
          if (stopped) return;
          onEvent({
            type: "completed",
            exitCode: 0,
            durationMs,
            stdout: sampleOutput,
            stderr: "",
            command: "mock",
            args: [],
          });
        } else {
          const sampleErr = `[mock] 模拟失败：无法处理任务 ${task.id}`;
          onEvent({ type: "stderr_delta", data: sampleErr });
          if (stopped) return;
          onEvent({
            type: "failed",
            exitCode: 1,
            durationMs,
            stdout: "",
            stderr: sampleErr,
            command: "mock",
            args: [],
          });
        }
      }, 100);
    };

    produce();

    return {
      get running(): boolean {
        return timer !== null && !stopped;
      },
      stop(): void {
        if (stopped) return;
        stopped = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        // 产出 stopped 事件
        onEvent({
          type: "stopped",
          exitCode: null,
          durationMs: Date.now() - startedAt,
          stdout: "",
          stderr: "",
          command: "mock",
          args: [],
        });
      },
    };
  }
}
