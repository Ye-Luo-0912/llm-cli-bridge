// LLM CLI Bridge — AgentRun 卡片渲染辅助（从 view.ts 渐进拆分 P2-A）
// 纯函数：折叠文本/JSON + sourceRef 详情 + 工具标签透传。
import { toolDisplayLabel } from "../runtime/core/agentRunDisplayModel";
import type { AgentRunCard } from "../runtime/core/agentRunDisplayModel";
import { truncateText } from "../workflowEvent";

/** 工具名 + 输入 → 显示标签（透传到 agentRunDisplayModel） */
export function toolDisplayLabelForPhase(toolName: string, toolInput?: string): string {
  return toolDisplayLabel(toolName, toolInput);
}

/** 渲染折叠文本块（summary + pre 内容） */
export function renderCollapsedText(parent: HTMLElement, label: string, value?: string): void {
  if (!value) return;
  const details = parent.createEl("details", { cls: "llm-bridge-tl-details" });
  details.createEl("summary", { text: `${label}: ${truncateText(value.replace(/\s+/g, " "), 120)}` });
  details.createEl("pre", { cls: "llm-bridge-tl-pre", text: value });
}

/** 渲染折叠 JSON 块（自动 stringify，失败退化为 String()） */
export function renderCollapsedJson(parent: HTMLElement, label: string, value: unknown): void {
  if (value === undefined || value === null) return;
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  renderCollapsedText(parent, label, text);
}

/** 渲染 sourceRef 详情行（threadId/turnId/itemId/serverRequestId/method/sequence） */
export function renderSourceRefDetail(parent: HTMLElement, card: AgentRunCard): void {
  if (!card.sourceRef) return;
  const parts = [
    card.sourceRef.threadId ? `threadId=${card.sourceRef.threadId}` : "",
    card.sourceRef.turnId ? `turnId=${card.sourceRef.turnId}` : "",
    card.sourceRef.itemId ? `itemId=${card.sourceRef.itemId}` : "",
    card.sourceRef.serverRequestId !== undefined ? `serverRequestId=${card.sourceRef.serverRequestId}` : "",
    card.sourceRef.method ? `method=${card.sourceRef.method}` : "",
    card.sourceRef.sequence !== undefined ? `sequence=${card.sourceRef.sequence}` : "",
  ].filter(Boolean).join(" · ");
  if (parts) parent.createEl("div", { cls: "llm-bridge-tl-detail", text: parts });
}
