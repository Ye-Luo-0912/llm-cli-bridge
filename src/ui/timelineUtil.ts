// LLM CLI Bridge — Timeline 工具函数（从 view.ts 渐进拆分 P2-B）
// 纯函数：耗时格式化 + 过程摘要 + 用户可见节点过滤 + 工具图标分类。
import { getToolIconCategory } from "../runtime/core/agentRunDisplayModel";
import { computeTimelineStats, extractToolPath, isInternalFilePath, type TimelineNode } from "../timelineAdapter";

/** V2.0: 格式化耗时（ms → 可读字符串） */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 过程统计摘要（progress/thinking/tool/file-change 计数 + 耗时） */
export function formatProcessSummary(stats: ReturnType<typeof computeTimelineStats>): string {
  const parts = ["过程"];
  if (stats.progressCount > 0) parts.push(`${stats.progressCount} progress`);
  if (stats.thoughtCount > 0) parts.push(`${stats.thoughtCount} thinking`);
  if (stats.toolCount > 0) parts.push(`${stats.toolCount} tool${stats.toolCount > 1 ? "s" : ""}`);
  if (stats.fileChangeCount > 0) parts.push(`${stats.fileChangeCount} file change${stats.fileChangeCount > 1 ? "s" : ""}`);
  if (stats.durationMs !== undefined && stats.durationMs > 0) {
    const secs = Math.round(stats.durationMs / 1000);
    if (secs > 0) parts.push(`${secs}s`);
  }
  return parts.join(" · ");
}

/** 工具名 → 图标 + 分类（透传到 agentRunDisplayModel） */
export function getToolIconAndCategory(toolName: string): { icon: string; category: string } {
  return getToolIconCategory(toolName);
}

/**
 * V2.16-C: 过滤用户可见的 timeline 节点。
 * developerMode=true 时全部保留；否则隐藏 session_started/agent 节点、
 * 已完成工具的 "Preparing" progress、内部文件路径的 tool_call/file_change。
 */
export function filterUserFacingTimelineNodes(nodes: TimelineNode[], developerMode: boolean): TimelineNode[] {
  if (developerMode) return nodes;
  const completedToolNames = new Set(
    nodes
      .filter((node) => node.kind === "tool_call" && node.toolName)
      .map((node) => (node.toolName ?? "").toLowerCase()),
  );
  return nodes.filter((node) => {
    if (node.kind === "session_started") return false;
    if (node.kind === "agent") return false;
    if (node.kind === "progress" && node.progressCategory === "tool") {
      if (node.progressLabel === "Preparing tool input") return false;
      const preparingMatch = node.progressLabel?.match(/^Preparing\s+(.+)$/i);
      if (preparingMatch && completedToolNames.has(preparingMatch[1].toLowerCase())) return false;
    }
    if (node.kind === "tool_call" && node.toolInput) {
      const toolPath = extractToolPath(node.toolName ?? "", node.toolInput);
      if (toolPath && isInternalFilePath(toolPath)) return false;
    }
    if (node.kind === "file_change" && node.filePath && isInternalFilePath(node.filePath)) return false;
    return true;
  });
}
