// LLM CLI Bridge — Codex process feed pure helpers (V19 unified cluster model)
//
// DOM-free helpers for the process feed. Segmentation logic now lives in
// codexWaterfallRenderer.ts (segmentCodexFeedEntries). This file only keeps
// duration summation used by the cluster renderer.

import type { CodexRunFeedItem } from "../runtime/core/codexRunViewModel";

export function isCodexFeedEvent(item: CodexRunFeedItem): boolean {
  return item.kind !== "thinking" && item.kind !== "assistant";
}

export function sumCodexEventDuration(items: ReadonlyArray<CodexRunFeedItem>): number {
  return items.reduce((total, item) => total + (item.durationMs || item.step?.durationMs || 0), 0);
}
