// LLM CLI Bridge — Agent Backend 抽象层
// 定义统一的 AgentBackend 接口，为后续 SDK backend 预留结构
// 当前仅实现 ClaudeCliBackend，UI 层通过此接口与 agent 交互

import { LLMBridgeSettings } from "./types";
import type { WorkflowEventHandler } from "./workflowEvent";

/**
 * 一次 agent 任务的定义
 */
export interface AgentTask {
  /** 任务唯一 ID（用于消息关联） */
  id: string;
  /** 用户原始输入文本 */
  userMessage: string;
  /** 发送给 agent 的完整 prompt（含系统指令 + 上下文） */
  prompt: string;
  /** 工作目录（Vault 根目录） */
  cwd: string;
  /** 任务创建时间 ISO */
  createdAt: string;
  /** 是否包含活动笔记上下文 */
  includeActiveNote: boolean;
  /** 是否包含选区上下文 */
  includeSelection: boolean;
}

/**
 * Agent 事件 — 判别联合类型
 *
 * @version v0.1（已冻结）
 *
 * v0.1 事件类型（不新增 tool event，如需扩展请升级到 v0.2）：
 * - started: 任务已启动
 * - stdout_delta: stdout 增量数据
 * - stderr_delta: stderr 增量数据
 * - completed: 任务成功完成（exit code 0）
 * - failed: 任务失败（exit code != 0 或 spawn error）
 * - stopped: 用户手动停止
 */
export type AgentEvent =
  | { type: "started"; task: AgentTask }
  | { type: "stdout_delta"; data: string }
  | { type: "stderr_delta"; data: string }
  | {
      type: "completed";
      exitCode: number | null;
      durationMs: number;
      stdout: string;
      stderr: string;
      command: string;
      args: string[];
    }
  | {
      type: "failed";
      exitCode: number | null;
      durationMs: number;
      stdout: string;
      stderr: string;
      command: string;
      args: string[];
    }
  | {
      type: "stopped";
      exitCode: number | null;
      durationMs: number;
      stdout: string;
      stderr: string;
      command: string;
      args: string[];
    };

/**
 * 事件回调
 */
export type AgentEventHandler = (event: AgentEvent) => void;

/**
 * 运行中的任务句柄，用于控制生命周期
 */
export interface AgentRunHandle {
  /** 是否仍在运行 */
  readonly running: boolean;
  /** 停止当前任务（kill 进程树） */
  stop(): void;
}

/**
 * Agent Backend 接口
 * 不同实现（CLI / SDK）均实现此接口，UI 层通过接口调用
 */
export interface AgentBackend {
  /** backend 名称（如 "claude-cli"） */
  readonly name: string;
  /**
   * 启动一次 agent 任务
   * @param task 任务定义
   * @param settings 插件设置
   * @param onEvent AgentEvent v0.1 事件回调（started/stdout_delta/stderr_delta/completed/failed/stopped）
   * @param onWorkflowEvent 可选：V1.6 SDK 工作流事件回调（message/tool_start/tool_result/file_change/permission/error）
   *        CLI backend 忽略此参数；SDK backend 调用以传递结构化工具调用信息
   * @returns 任务句柄
   */
  run(
    task: AgentTask,
    settings: LLMBridgeSettings,
    onEvent: AgentEventHandler,
    onWorkflowEvent?: WorkflowEventHandler,
  ): AgentRunHandle;
}

/**
 * 将终态 AgentEvent 映射为 UI RunStatus（纯函数，便于单元测试）
 * - completed → completed
 * - failed → failed
 * - stopped → stopped
 * - 其他（非终态）→ running
 */
export function eventToRunStatus(event: AgentEvent): "running" | "completed" | "failed" | "stopped" {
  switch (event.type) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return "running";
  }
}

/**
 * 判断事件是否为终态（completed / failed / stopped）
 */
export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === "completed" || event.type === "failed" || event.type === "stopped";
}
