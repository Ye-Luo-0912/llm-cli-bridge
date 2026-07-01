// LLM CLI Bridge — Timeline Adapter (V2.16-C Claude-style Runtime UI)
// 纯函数：将 SDK WorkflowEvent[] 转换为现代 Claude/Codex 风格垂直 timeline node 列表
//
// 分类规则：
// - session_started: SDKSystemMessage(init) 映射的 system message（含 model/cwd）
// - thought:         thinking event（模型思考过程）
// - agent:           assistant message（非最终结果，中间思考摘要）
// - tool_call:       tool_start + 配对 tool_result 合并（含工具名/输入/输出/耗时/错误）
// - file_change:     用户可见 Vault 文件变更（internal/private 路径过滤）
// - final_message:   completed 前的最终结果文本（SDKResultMessage success result）
// - warning:         recoverable error 降级
// - error:           不可恢复错误
// - completed:       成功完成摘要（含 durationMs）
// - failed:          失败摘要
//
// 合并规则：
// - tool_start + tool_result 按 callId 配对合并为单个 tool_call node
// - 相邻相同文本的 assistant message 合并（避免 SDKAssistantMessage + SDKResultMessage 重复）
// - recoverable=true 的 error 降级为 warning
// - internal/private 文件写入不显示在主 timeline（.obsidian/.llm-bridge/.claude/LLM-AgentRuntime 等）

import { WorkflowEvent } from "./workflowEvent";

// ---------- Timeline Node 类型 ----------

export type TimelineNodeKind =
  | "session_started"
  | "thought"
  | "agent"
  | "tool_call"
  | "file_change"
  | "final_message"
  | "warning"
  | "error"
  | "completed"
  | "failed";

export interface TimelineNode {
  readonly id: string;
  readonly kind: TimelineNodeKind;
  readonly timestamp: string;
  /** 结束时间（tool_call 的 tool_result 时间戳） */
  readonly endTime?: string;
  /** 持续时长（毫秒，tool_call / completed） */
  readonly durationMs?: number;
  /** 文本内容（thought / agent / final_message / session_started / completed / failed） */
  readonly text?: string;
  /** 工具名（tool_call） */
  readonly toolName?: string;
  /** 工具输入（tool_call，已脱敏 JSON 字符串） */
  readonly toolInput?: string;
  /** 工具输出（tool_call，已脱敏） */
  readonly toolOutput?: string;
  /** 工具是否出错（tool_call） */
  readonly toolError?: boolean;
  /** 文件路径（file_change） */
  readonly filePath?: string;
  /** 文件操作（file_change: create/modify/delete） */
  readonly fileAction?: string;
  /** 错误/警告消息（warning / error / failed） */
  readonly message?: string;
  /** agent 标签（"Main agent" / "Subagent"） */
  readonly agentLabel?: string;
  /** 是否为 subagent */
  readonly isSubagent?: boolean;
  /** 是否可恢复（warning / failed） */
  readonly recoverable?: boolean;
}

// ---------- Internal 路径过滤 ----------

/**
 * internal/private 文件路径正则：这些路径的 file_change 不显示在主 timeline
 * - .obsidian / .llm-bridge / .claude / .git / .env / node_modules / LLM-AgentRuntime
 */
const INTERNAL_PATH_RE = /\.(obsidian|llm-bridge|claude|git|env)/i;
const INTERNAL_PATH_KEYWORDS = /node_modules|LLM-AgentRuntime/i;

/**
 * 判断文件路径是否为 internal（不显示在主 timeline）
 */
export function isInternalFilePath(filePath: string): boolean {
  if (INTERNAL_PATH_RE.test(filePath)) return true;
  if (INTERNAL_PATH_KEYWORDS.test(filePath)) return true;
  return false;
}

// ---------- 工具配对 ----------

interface ToolPair {
  readonly start: Extract<WorkflowEvent, { type: "tool_start" }>;
  readonly result: Extract<WorkflowEvent, { type: "tool_result" }> | null;
}

/**
 * 将 tool_start 与 tool_result 按 callId 配对
 */
function pairTools(events: ReadonlyArray<WorkflowEvent>): ReadonlyArray<ToolPair> {
  const starts: Array<Extract<WorkflowEvent, { type: "tool_start" }>> = [];
  const resultMap = new Map<string, Extract<WorkflowEvent, { type: "tool_result" }>>();
  for (const ev of events) {
    if (ev.type === "tool_start") starts.push(ev);
    else if (ev.type === "tool_result") resultMap.set(ev.callId, ev);
  }
  return starts.map((start) => ({ start, result: resultMap.get(start.callId) ?? null }));
}

// ---------- 主适配函数 ----------

/**
 * 将 SDK WorkflowEvent[] 转换为现代 timeline node 列表
 *
 * @param events SDK 工作流事件（已脱敏）
 * @returns timeline node 列表（按时间顺序，已合并配对与去重）
 */
export function adaptEventsToTimeline(events: ReadonlyArray<WorkflowEvent>): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let nodeIndex = 0;
  const nextId = () => `tl-${nodeIndex++}`;

  // 1. tool_start + tool_result 配对
  const toolPairs = pairTools(events);
  const pairedResultCallIds = new Set(toolPairs.filter((p) => p.result).map((p) => p.result!.callId));
  const pairedStartCallIds = new Set(toolPairs.map((p) => p.start.callId));

  // 2. 遍历事件，按顺序生成 node
  let lastAgentText = ""; // 用于合并相邻相同 assistant message
  let hasFinalMessage = false;

  for (const ev of events) {
    switch (ev.type) {
      case "thinking": {
        nodes.push({
          id: nextId(),
          kind: "thought",
          timestamp: ev.timestamp,
          text: ev.text,
        });
        lastAgentText = "";
        break;
      }
      case "message": {
        if (ev.role === "system") {
          // SDK session started (init)
          nodes.push({
            id: nextId(),
            kind: "session_started",
            timestamp: ev.timestamp,
            text: ev.text,
          });
        } else {
          // assistant message
          // 合并相邻相同文本（SDKAssistantMessage text == SDKResultMessage result）
          if (ev.text === lastAgentText && ev.text.length > 0) {
            break;
          }
          lastAgentText = ev.text;
          nodes.push({
            id: nextId(),
            kind: "agent",
            timestamp: ev.timestamp,
            text: ev.text,
            agentLabel: ev.parentToolUseId ? "Subagent" : "Main agent",
            isSubagent: !!ev.parentToolUseId,
          });
        }
        break;
      }
      case "tool_start": {
        // 跳过已配对的（由配对逻辑统一处理）
        if (pairedStartCallIds.has(ev.callId)) break;
        // 未配对的 tool_start（无 result）
        nodes.push({
          id: nextId(),
          kind: "tool_call",
          timestamp: ev.timestamp,
          toolName: ev.toolName,
          toolInput: ev.toolInput,
          toolError: false,
          agentLabel: ev.parentToolUseId ? "Subagent" : "Main agent",
          isSubagent: !!ev.parentToolUseId,
        });
        lastAgentText = "";
        break;
      }
      case "tool_result": {
        // 跳过已配对的
        if (pairedResultCallIds.has(ev.callId)) break;
        // 未配对的 tool_result（孤儿，理论上少见）
        nodes.push({
          id: nextId(),
          kind: "tool_call",
          timestamp: ev.timestamp,
          toolName: ev.toolName || "unknown",
          toolOutput: ev.output,
          toolError: ev.isError,
        });
        lastAgentText = "";
        break;
      }
      case "file_change": {
        // internal/private 路径过滤：不显示在主 timeline
        if (isInternalFilePath(ev.path)) break;
        nodes.push({
          id: nextId(),
          kind: "file_change",
          timestamp: ev.timestamp,
          filePath: ev.path,
          fileAction: ev.action,
        });
        lastAgentText = "";
        break;
      }
      case "permission": {
        // permission 事件不直接生成 node（权限历史在独立区域展示）
        // 但 denied 权限可作为 warning
        if (!ev.granted) {
          nodes.push({
            id: nextId(),
            kind: "warning",
            timestamp: ev.timestamp,
            message: `Permission denied: ${ev.toolName}`,
          });
        }
        lastAgentText = "";
        break;
      }
      case "error": {
        if (ev.recoverable) {
          // 可恢复错误降级为 warning
          nodes.push({
            id: nextId(),
            kind: "warning",
            timestamp: ev.timestamp,
            message: ev.message,
            recoverable: true,
          });
        } else {
          nodes.push({
            id: nextId(),
            kind: "error",
            timestamp: ev.timestamp,
            message: ev.message,
            recoverable: false,
          });
        }
        lastAgentText = "";
        break;
      }
      case "completed": {
        // 提取 final_message（如果 text 非空且与上一个 agent message 不同）
        if (ev.text && ev.text.length > 0 && ev.text !== lastAgentText) {
          nodes.push({
            id: nextId(),
            kind: "final_message",
            timestamp: ev.timestamp,
            text: ev.text,
          });
          hasFinalMessage = true;
        }
        nodes.push({
          id: nextId(),
          kind: "completed",
          timestamp: ev.timestamp,
          text: ev.text,
          durationMs: ev.durationMs,
        });
        lastAgentText = "";
        break;
      }
      case "failed": {
        nodes.push({
          id: nextId(),
          kind: "failed",
          timestamp: ev.timestamp,
          message: ev.message,
          recoverable: ev.recoverable,
        });
        lastAgentText = "";
        break;
      }
    }
  }

  // 3. 插入配对的 tool_call node（在 start 时间戳位置）
  // 重新构建：按时间戳排序
  const pairedNodes: TimelineNode[] = [];
  for (const pair of toolPairs) {
    const start = pair.start;
    const result = pair.result;
    const durationMs = result
      ? Math.max(0, new Date(result.timestamp).getTime() - new Date(start.timestamp).getTime())
      : undefined;
    pairedNodes.push({
      id: nextId(),
      kind: "tool_call",
      timestamp: start.timestamp,
      endTime: result?.timestamp,
      durationMs,
      toolName: start.toolName,
      toolInput: start.toolInput,
      toolOutput: result?.output,
      toolError: result?.isError ?? false,
      agentLabel: start.parentToolUseId ? "Subagent" : "Main agent",
      isSubagent: !!start.parentToolUseId,
    });
  }

  // 合并非配对 node 与配对 node，按时间戳排序
  const allNodes = [...nodes, ...pairedNodes];
  allNodes.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return ta - tb;
  });

  // 4. 重新分配 id（排序后）
  return allNodes.map((n, i) => ({ ...n, id: `tl-${i}` }));
}

// ---------- Timeline 统计 ----------

export interface TimelineStats {
  readonly toolCount: number;
  readonly thoughtCount: number;
  readonly fileChangeCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly durationMs?: number;
}

/**
 * 从 timeline node 列表提取统计摘要（用于 completed 后的折叠摘要）
 */
export function computeTimelineStats(nodes: ReadonlyArray<TimelineNode>): TimelineStats {
  let toolCount = 0;
  let thoughtCount = 0;
  let fileChangeCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let durationMs: number | undefined;
  for (const n of nodes) {
    switch (n.kind) {
      case "tool_call": toolCount++; break;
      case "thought": thoughtCount++; break;
      case "file_change": fileChangeCount++; break;
      case "warning": warningCount++; break;
      case "error": errorCount++; break;
      case "completed": durationMs = n.durationMs; break;
    }
  }
  return { toolCount, thoughtCount, fileChangeCount, warningCount, errorCount, durationMs };
}

/**
 * 生成 completed 摘要文本（如 "Completed · 6 tools · 25s"）
 */
export function formatCompletedSummary(stats: TimelineStats): string {
  const parts: string[] = ["Completed"];
  if (stats.toolCount > 0) parts.push(`${stats.toolCount} tool${stats.toolCount > 1 ? "s" : ""}`);
  if (stats.durationMs !== undefined && stats.durationMs > 0) {
    const secs = Math.round(stats.durationMs / 1000);
    if (secs > 0) parts.push(`${secs}s`);
  }
  return parts.join(" · ");
}

/**
 * 生成 failed 摘要文本
 */
export function formatFailedSummary(nodes: ReadonlyArray<TimelineNode>): string {
  const failedNode = nodes.find((n) => n.kind === "failed");
  if (failedNode?.message) {
    return `Failed: ${failedNode.message.slice(0, 100)}`;
  }
  return "Failed";
}

// ---------- 工具节点展示辅助 ----------

/**
 * 提取工具输入中的文件路径（用于 timeline 展示，长路径截断）
 */
export function extractToolPath(toolName: string, toolInput: string): string | null {
  try {
    const input = JSON.parse(toolInput);
    const path = input.file_path ?? input.notebook_path ?? input.path ?? input.pattern;
    if (typeof path === "string" && path.length > 0) return path;
  } catch {
    // 非 JSON，尝试直接匹配
  }
  return null;
}

/**
 * 截断长路径（中间省略，保留首尾）
 */
export function truncatePath(filePath: string, maxLen = 48): string {
  if (filePath.length <= maxLen) return filePath;
  const half = Math.floor((maxLen - 3) / 2);
  return filePath.slice(0, half) + "…" + filePath.slice(-half);
}
