// LLM CLI Bridge — Timeline Adapter (V2.16-C Claude-style Runtime UI)
// 纯函数：将 SDK WorkflowEvent[] 转换为现代 Claude/Codex 风格垂直 timeline node 列表
//
// 分类规则：
// - session_started: SDKSystemMessage(init) 映射的 system message（含 model/cwd）
// - progress:        SDK status/partial/tool progress（保留原始运行过程）
// - thought:         thinking event（模型思考过程）
// - agent:           assistant message（非最终结果，中间思考摘要）
// - tool_call:       tool_start + 配对 tool_result 合并（含工具名/输入/输出/耗时/错误）
// - file_change:     用户可见 Vault 文件变更（internal/private 路径过滤）
// - warning:         recoverable error 降级
// - error:           不可恢复错误
// - completed:       成功完成摘要（含 durationMs）
// - failed:          失败摘要
//
// 合并规则：
// - tool_start + tool_result 按 callId 配对合并为单个 tool_call node
// - 相邻相同文本的 assistant message 合并（避免 SDKAssistantMessage + SDKResultMessage 重复）
// - thinking_delta + thinking_tokens 聚合为单个 thought node，避免刷屏
// - recoverable=true 的 error 降级为 warning
// - internal/private 文件写入不显示在主 timeline（.obsidian/.llm-bridge/.claude/LLM-AgentRuntime 等）
//
// V2.17-A: SDK 路径优先使用 src/runtimeTranscript.ts 的 RunStateAggregator
// （单 thinking block / tool_progress 合并 / 无重复 final message）。
// 本文件作为历史消息回放与向后兼容路径保留。

import { WorkflowEvent } from "./workflowEvent";

// ---------- Timeline Node 类型 ----------

export type TimelineNodeKind =
  | "session_started"
  | "progress"
  | "thought"
  | "agent"
  | "tool_call"
  | "file_change"
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
  /** 文本内容（thought / agent / session_started / completed / failed） */
  readonly text?: string;
  /** 运行中状态（progress） */
  readonly progressLabel?: string;
  readonly progressDetail?: string;
  readonly progressCategory?: string;
  /** 工具名（tool_call） */
  readonly toolName?: string;
  /** 工具输入（tool_call，已脱敏 JSON 字符串） */
  readonly toolInput?: string;
  /** 工具输出（tool_call，已脱敏） */
  readonly toolOutput?: string;
  /** 工具是否出错（tool_call） */
  readonly toolError?: boolean;
  /**
   * 工具进度条目（tool_call，V2.17-A 续）。
   * tool_progress 合并到工具节点后，UI 在工具节点内折叠展示 progress，
   * 不刷成独立节点，也不丢弃。
   */
  readonly toolProgress?: ReadonlyArray<{ label: string; detail?: string; timestamp: string }>;
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
  const appendThinkingText = (timestamp: string, text: string) => {
    const last = nodes[nodes.length - 1];
    if (last?.kind === "thought") {
      nodes[nodes.length - 1] = {
        ...last,
        timestamp,
        text: `${last.text ?? ""}${text}`,
      };
      return;
    }
    if (text.trim().length === 0) return;
    nodes.push({
      id: nextId(),
      kind: "thought",
      timestamp,
      text,
    });
  };
  const upsertThinkingState = (timestamp: string, label?: string, detail?: string) => {
    const last = nodes[nodes.length - 1];
    if (last?.kind === "thought") {
      nodes[nodes.length - 1] = {
        ...last,
        timestamp,
        progressLabel: label ?? last.progressLabel,
        progressDetail: detail ?? last.progressDetail,
        progressCategory: "thinking",
      };
      return;
    }
    nodes.push({
      id: nextId(),
      kind: "thought",
      timestamp,
      text: "",
      progressLabel: label,
      progressDetail: detail,
      progressCategory: "thinking",
    });
  };
  const pushProgressNode = (ev: Extract<WorkflowEvent, { type: "progress" }>) => {
    const last = nodes[nodes.length - 1];
    if (last?.kind === "progress" && last.progressLabel === ev.label && last.progressCategory === ev.category) {
      nodes[nodes.length - 1] = {
        ...last,
        timestamp: ev.timestamp,
        progressDetail: ev.detail ?? last.progressDetail,
      };
      return;
    }
    nodes.push({
      id: nextId(),
      kind: "progress",
      timestamp: ev.timestamp,
      progressLabel: ev.label,
      progressDetail: ev.detail,
      progressCategory: ev.category,
    });
  };

  for (const ev of events) {
    switch (ev.type) {
      case "progress": {
        if (ev.category === "thinking") {
          upsertThinkingState(ev.timestamp, ev.label, ev.detail);
          lastAgentText = "";
          break;
        }
        pushProgressNode(ev);
        lastAgentText = "";
        break;
      }
      case "thinking": {
        appendThinkingText(ev.timestamp, ev.text);
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
  readonly progressCount: number;
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
  let progressCount = 0;
  let thoughtCount = 0;
  let fileChangeCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let durationMs: number | undefined;
  for (const n of nodes) {
    switch (n.kind) {
      case "progress": progressCount++; break;
      case "tool_call": toolCount++; break;
      case "thought": thoughtCount++; break;
      case "file_change": fileChangeCount++; break;
      case "warning": warningCount++; break;
      case "error": errorCount++; break;
      case "completed": durationMs = n.durationMs; break;
    }
  }
  return { toolCount, progressCount, thoughtCount, fileChangeCount, warningCount, errorCount, durationMs };
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

/**
 * V2.16-D: 提取路径的 basename（最后一段），用于紧凑展示。
 * title 属性仍保留完整路径。
 */
export function pathBasename(filePath: string): string {
  if (!filePath) return "";
  const norm = filePath.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : filePath;
}

/**
 * V2.16-D: 从 toolInput JSON 提取结构化关键参数（用于 key-value 展示）。
 * 仅返回人类可读的重要参数，跳过 file_path（已单独展示为路径）。
 * 返回数组顺序稳定，便于渲染。
 */
export interface ToolParam {
  key: string;
  value: string;
}

export function extractToolParams(toolName: string, toolInput: string): ToolParam[] {
  if (!toolInput) return [];
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(toolInput);
  } catch {
    return [];
  }
  const params: ToolParam[] = [];
  const skipKeys = new Set(["file_path", "notebook_path", "path", "_type"]);
  const addParam = (key: string, value: unknown): void => {
    if (value === undefined || value === null || value === "") return;
    let v: string;
    if (typeof value === "string") v = value;
    else if (typeof value === "number" || typeof value === "boolean") v = String(value);
    else {
      try { v = JSON.stringify(value); } catch { return; }
    }
    if (v.length > 120) v = v.slice(0, 117) + "…";
    params.push({ key, value: v });
  };
  // 按稳定顺序提取常见重要参数
  const priorityKeys = ["command", "cmd", "pattern", "query", "url", "search", "regex", "replace_all", "old_string", "new_string", "content", "prompt", "description", "language", "limit", "offset", "glob", "type"];
  for (const k of priorityKeys) {
    if (k in input && !skipKeys.has(k)) addParam(k, input[k]);
  }
  // 其余非跳过参数（最多 4 个，避免刷屏）
  let extra = 0;
  for (const k of Object.keys(input)) {
    if (skipKeys.has(k) || priorityKeys.includes(k)) continue;
    if (extra >= 4) break;
    addParam(k, input[k]);
    extra++;
  }
  return params;
}

/**
 * V2.16-D: 统计文本行数（用于结果折叠时的 "N lines" 提示）。
 */
export function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}
