// LLM CLI Bridge — Codex process feed pure helpers (Agent A extract)
//
// DOM-free batching / labeling for the process feed.
// LLMBridgeView keeps rendering; these helpers own feed structure semantics.

import type { CodexRunFeedItem } from "../runtime/core/codexRunViewModel";

export function isCodexFeedEvent(item: CodexRunFeedItem): boolean {
  return item.kind !== "thinking" && item.kind !== "assistant";
}

export function groupCodexFeedBatches(items: ReadonlyArray<CodexRunFeedItem>): CodexRunFeedItem[][] {
  const batches: CodexRunFeedItem[][] = [];
  let current: CodexRunFeedItem[] = [];
  let currentStartsWithNarrative = false;
  for (const item of items) {
    const startsNewBatch = item.kind === "thinking" || item.kind === "assistant";
    if (startsNewBatch) {
      if (current.length > 0) batches.push(current);
      current = [item];
      currentStartsWithNarrative = true;
      continue;
    }
    if (current.length > 0 && !currentStartsWithNarrative) {
      batches.push(current);
      current = [];
    }
    current.push(item);
    if (current.length === 1) currentStartsWithNarrative = false;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function shouldGroupCodexToolEvents(items: ReadonlyArray<CodexRunFeedItem>): boolean {
  const events = items.filter((item) => isCodexFeedEvent(item));
  return events.length > 1 && events.length === items.length;
}

export function formatCodexToolGroupTitle(items: ReadonlyArray<CodexRunFeedItem>): string {
  const commandCount = items.filter((item) => item.kind === "command").length;
  const fileCount = items.filter((item) => item.kind === "file" || !!item.change).length;
  const approvalCount = items.filter((item) => item.kind === "approval").length;
  const toolCount = items.length - commandCount - fileCount - approvalCount;
  if (commandCount > 0 && fileCount === 0 && approvalCount === 0 && toolCount === 0) {
    return `已运行 ${commandCount} 条命令`;
  }
  if (fileCount > 0 && commandCount === 0 && approvalCount === 0 && toolCount === 0) {
    return `已编辑 ${fileCount} 个文件`;
  }
  const parts: string[] = [];
  if (commandCount) parts.push(`${commandCount} 条命令`);
  if (fileCount) parts.push(`${fileCount} 个文件`);
  if (approvalCount) parts.push(`${approvalCount} 个确认`);
  if (toolCount) parts.push(`${toolCount} 个工具`);
  return parts.length > 0 ? `已处理 ${parts.join(" · ")}` : `已处理 ${items.length} 个操作`;
}

export function formatCodexToolGroupCount(items: ReadonlyArray<CodexRunFeedItem>): string {
  const commandCount = items.filter((item) => item.kind === "command").length;
  const fileCount = items.filter((item) => item.kind === "file" || !!item.change).length;
  if (commandCount > 0 && fileCount === 0) return `${commandCount} commands`;
  if (fileCount > 0 && commandCount === 0) return `${fileCount} files`;
  return `${items.length} events`;
}

export function sumCodexEventDuration(items: ReadonlyArray<CodexRunFeedItem>): number {
  return items.reduce((total, item) => total + (item.durationMs || item.step?.durationMs || 0), 0);
}

/** Batch lead label for developer chrome — never call process assistant "Thinking". */
export function codexFeedLeadDevLabel(lead: CodexRunFeedItem, syntheticNarrative: boolean): string {
  if (lead.kind === "thinking") return "Thinking";
  if (lead.kind === "assistant") return lead.label || "说明";
  if (syntheticNarrative) return "Thinking";
  return lead.label || "Step";
}
