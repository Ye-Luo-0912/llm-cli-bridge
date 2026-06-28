// LLM CLI Bridge — SDK Backend (V1.6 Experimental)
// 实验性 Claude Agent SDK 接入：尝试加载真实 SDK，不可用时 fallback mock workflow
// 不破坏 AgentEvent v0.1；工具级事件通过 onWorkflowEvent 传递（UI-only）
//
// 策略：
// 1. 尝试从 LLM-AgentRuntime/node_modules 动态加载 @anthropic-ai/claude-code
// 2. 若可用：使用真实 SDK，映射 structured events → WorkflowEvent
// 3. 若不可用：fallback 到 mock workflow（模拟工具调用序列），UI 仍可展示流程

import { AgentBackend, AgentEventHandler, AgentRunHandle, AgentTask } from "./agentBackend";
import { LLMBridgeSettings } from "./types";
import {
  MessageEvent,
  ToolStartEvent,
  ToolResultEvent,
  FileChangeEvent,
  PermissionEvent,
  ErrorEvent,
  WorkflowEvent,
  WorkflowEventHandler,
  redactWorkflowEvent,
} from "./workflowEvent";

// ---------- SDK 可用性探测 ----------

/**
 * 尝试从 Vault 局部 LLM-AgentRuntime/node_modules 加载 Claude Agent SDK
 * @returns SDK 模块（若有），否则 null
 */
export function tryLoadSdk(cwd: string): unknown | null {
  try {
    // 尝试从 Vault 局部 node_modules 加载
    const sdkPath = `${cwd}/LLM-AgentRuntime/node_modules/@anthropic-ai/claude-code`;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(sdkPath);
    return mod;
  } catch {
    // 尝试全局 require（某些环境可能已安装）
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("@anthropic-ai/claude-code");
    } catch {
      return null;
    }
  }
}

/**
 * 检测 SDK 是否可用（不实际调用）
 */
export function isSdkAvailable(cwd: string): boolean {
  return tryLoadSdk(cwd) !== null;
}

// ---------- Mock Workflow 事件生成 ----------

/**
 * 生成 mock workflow 事件序列（模拟真实工具调用流程）
 * 用于无真实 SDK 时测试 UI 渲染
 *
 * 序列：
 *   message(assistant) → tool_start(Read) → tool_result(Read)
 *   → tool_start(Write) → permission(Write) → tool_result(Write)
 *   → file_change(create) → message(assistant)
 */
export function generateMockWorkflowEvents(
  task: AgentTask,
  onWorkflowEvent: WorkflowEventHandler,
  timers: ReturnType<typeof setTimeout>[],
  startedAt: number,
): void {
  const now = () => new Date().toISOString();
  let delay = 50;

  const schedule = (fn: () => void) => {
    const t = setTimeout(fn, delay);
    timers.push(t);
    delay += 150;
  };

  // 1. assistant 消息
  schedule(() => {
    const ev: MessageEvent = {
      type: "message",
      timestamp: now(),
      role: "assistant",
      text: `我来处理你的请求：${task.userMessage.slice(0, 40)}`,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 2. tool_start: Read
  const readCallId = `call_read_${startedAt}`;
  schedule(() => {
    const ev: ToolStartEvent = {
      type: "tool_start",
      timestamp: now(),
      toolName: "Read",
      toolInput: JSON.stringify({ file_path: "notes/example.md" }),
      callId: readCallId,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 3. tool_result: Read
  schedule(() => {
    const ev: ToolResultEvent = {
      type: "tool_result",
      timestamp: now(),
      callId: readCallId,
      toolName: "Read",
      output: "# 示例笔记\n这是文件内容...",
      isError: false,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 4. tool_start: Write
  const writeCallId = `call_write_${startedAt}`;
  schedule(() => {
    const ev: ToolStartEvent = {
      type: "tool_start",
      timestamp: now(),
      toolName: "Write",
      toolInput: JSON.stringify({ file_path: `${task.cwd}/output/summary.md`, content: "..." }),
      callId: writeCallId,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 5. permission: Write
  schedule(() => {
    const ev: PermissionEvent = {
      type: "permission",
      timestamp: now(),
      toolName: "Write",
      description: "写入文件 output/summary.md",
      granted: true,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 6. tool_result: Write
  schedule(() => {
    const ev: ToolResultEvent = {
      type: "tool_result",
      timestamp: now(),
      callId: writeCallId,
      toolName: "Write",
      output: "文件已写入",
      isError: false,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 7. file_change: create
  schedule(() => {
    const ev: FileChangeEvent = {
      type: "file_change",
      timestamp: now(),
      action: "create",
      path: "output/summary.md",
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 8. assistant 最终消息
  schedule(() => {
    const ev: MessageEvent = {
      type: "message",
      timestamp: now(),
      role: "assistant",
      text: "已完成处理，生成了摘要文件。",
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });
}

/**
 * 生成 mock 失败 workflow 事件序列
 */
export function generateMockFailureWorkflowEvents(
  task: AgentTask,
  onWorkflowEvent: WorkflowEventHandler,
  timers: ReturnType<typeof setTimeout>[],
): void {
  const now = () => new Date().toISOString();
  let delay = 50;

  const schedule = (fn: () => void) => {
    const t = setTimeout(fn, delay);
    timers.push(t);
    delay += 150;
  };

  schedule(() => {
    const ev: MessageEvent = {
      type: "message",
      timestamp: now(),
      role: "assistant",
      text: `尝试处理：${task.userMessage.slice(0, 40)}`,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  const readCallId = `call_read_fail_${Date.now()}`;
  schedule(() => {
    const ev: ToolStartEvent = {
      type: "tool_start",
      timestamp: now(),
      toolName: "Read",
      toolInput: JSON.stringify({ file_path: "nonexistent.md" }),
      callId: readCallId,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  schedule(() => {
    const ev: ToolResultEvent = {
      type: "tool_result",
      timestamp: now(),
      callId: readCallId,
      toolName: "Read",
      output: "ENOENT: no such file or directory",
      isError: true,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  schedule(() => {
    const ev: ErrorEvent = {
      type: "error",
      timestamp: now(),
      message: "无法读取所需文件，任务终止",
      recoverable: false,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });
}

// ---------- SdkBackend 实现 ----------

/**
 * SDK Backend（实验性）
 *
 * 行为：
 * - 尝试加载真实 Claude Agent SDK
 * - 若可用：调用 SDK，映射 structured events → WorkflowEvent + AgentEvent v0.1
 * - 若不可用：fallback mock workflow，模拟工具调用序列 + AgentEvent v0.1
 *
 * AgentEvent v0.1 不变；工具级事件通过 onWorkflowEvent 传递
 */
export class SdkBackend implements AgentBackend {
  readonly name = "sdk-experimental";

  run(
    task: AgentTask,
    _settings: LLMBridgeSettings,
    onEvent: AgentEventHandler,
    onWorkflowEvent?: WorkflowEventHandler,
  ): AgentRunHandle {
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const startedAt = Date.now();

    const cleanup = () => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    };

    // 发出 started 事件
    onEvent({ type: "started", task });

    // 尝试加载 SDK
    const sdk = tryLoadSdk(task.cwd);
    const sdkAvailable = sdk !== null;

    if (sdkAvailable && onWorkflowEvent) {
      // 真实 SDK 路径：调用 SDK 并映射事件
      // TODO: V1.6 原型阶段先用 mock workflow，真实 SDK 映射在 SDK 安装后接入
      // 当前与 mock 路径一致，确保 UI 可测试
      generateMockWorkflowEvents(task, onWorkflowEvent, timers, startedAt);
    } else if (onWorkflowEvent) {
      // Mock fallback 路径：生成模拟工具调用事件
      // 发一条系统消息说明 SDK 不可用
      const now = () => new Date().toISOString();
      const sysMsg: MessageEvent = {
        type: "message",
        timestamp: now(),
        role: "system",
        text: sdkAvailable ? "SDK 已加载（原型阶段使用 mock workflow）" : "SDK 不可用，使用 mock workflow 演示",
      };
      onWorkflowEvent(redactWorkflowEvent(sysMsg));
      generateMockWorkflowEvents(task, onWorkflowEvent, timers, startedAt);
    }

    // 模拟 stdout 输出（AgentEvent v0.1）
    const stdoutTimer = setTimeout(() => {
      if (stopped) return;
      const output = sdkAvailable
        ? `[sdk] 任务 ${task.id} 已处理（mock workflow）`
        : `[sdk-mock] 任务 ${task.id} 已处理（SDK 不可用，fallback mock）`;
      onEvent({ type: "stdout_delta", data: output });
    }, 1200);
    timers.push(stdoutTimer);

    // 模拟完成
    const completeTimer = setTimeout(() => {
      if (stopped) return;
      stopped = true; // 标记不再运行（完成后 handle.running 应为 false）
      cleanup();
      const durationMs = Date.now() - startedAt;
      const stdout = sdkAvailable
        ? `[sdk] 任务 ${task.id} 已处理（mock workflow）`
        : `[sdk-mock] 任务 ${task.id} 已处理（SDK 不可用，fallback mock）`;
      onEvent({
        type: "completed",
        exitCode: 0,
        durationMs,
        stdout,
        stderr: "",
        command: "sdk-experimental",
        args: [],
      });
    }, 1500);
    timers.push(completeTimer);

    return {
      get running(): boolean {
        return !stopped;
      },
      stop(): void {
        if (stopped) return;
        stopped = true;
        cleanup();
        onEvent({
          type: "stopped",
          exitCode: null,
          durationMs: Date.now() - startedAt,
          stdout: "",
          stderr: "",
          command: "sdk-experimental",
          args: [],
        });
      },
    };
  }
}
