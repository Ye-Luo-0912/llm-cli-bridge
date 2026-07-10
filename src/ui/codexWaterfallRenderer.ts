// LLM CLI Bridge — Codex waterfall renderer (structure extract, no visual change)
//
// Owns keyed feed reconciliation, item/tool-group patch, and in-place candidate upgrade.
// LLMBridgeView supplies feed-item render, Markdown, and duration formatting.

import { setIcon } from "obsidian";
import type { CodexRunFeedItem, CodexRunViewModel } from "../runtime/core/codexRunViewModel";
import { resolveUiLocale } from "../runtime/core/toolPresentation";
import { truncateText } from "../workflowEvent";
import {
  formatCodexToolGroupCount,
  formatCodexToolGroupTitle,
  sumCodexEventDuration,
} from "./codexProcessFeed";

export type CodexWaterfallFeedEntry =
  | { kind: "item"; key: string; item: CodexRunFeedItem }
  | { kind: "tool-group"; key: string; groupKind: "command" | "image"; items: CodexRunFeedItem[] };

export interface CodexWaterfallPatchDeps {
  renderCodexFeedItem: (
    parent: HTMLElement,
    item: CodexRunFeedItem,
    developerMode: boolean,
    nestedEvent: boolean,
  ) => void;
  renderMarkdownInto: (host: HTMLElement, text: string) => void;
  formatDurationMs: (ms: number) => string;
}

/** 工具组懒展开时读取最新成员（保留 details 身份） */
const codexToolGroupMembers = new WeakMap<HTMLElement, {
  items: ReadonlyArray<CodexRunFeedItem>;
  developerMode: boolean;
  deps: CodexWaterfallPatchDeps;
}>();

export function codexFeedItemKey(item: CodexRunFeedItem): string {
  const itemId = item.sourceRef?.itemId || item.id;
  const seq = item.sourceRef?.sequence;
  return seq !== undefined ? `seq:${seq}:${itemId}` : itemId;
}

export function isCodexImageFeedItem(item: CodexRunFeedItem): boolean {
  if (item.icon === "image") return true;
  const blob = `${item.label} ${item.summary || ""} ${item.step?.label || ""}`;
  return /imageview|viewing image|viewed image|分析图片|查看图片/i.test(blob);
}

export function formatCodexImageGroupTitle(items: ReadonlyArray<CodexRunFeedItem>): string {
  const loc = resolveUiLocale() === "en" ? "en" : "zh";
  const active = items.some((item) => item.status === "running" || item.status === "pending");
  if (loc === "zh") return active ? "正在分析图片" : items.length > 1 ? `已查看 ${items.length} 张图片` : "已查看图片";
  return active ? "Viewing image" : items.length > 1 ? `Viewed ${items.length} images` : "Viewed image";
}

/** 初渲/增量共用：按时间线顺序分组，不按类型重排 */
export function groupCodexFeedRenderEntries(
  items: ReadonlyArray<CodexRunFeedItem>,
): CodexWaterfallFeedEntry[] {
  const entries: CodexWaterfallFeedEntry[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.kind === "command") {
      const group: CodexRunFeedItem[] = [];
      const startKey = codexFeedItemKey(item);
      while (i < items.length && items[i].kind === "command") {
        group.push(items[i]);
        i += 1;
      }
      if (group.length >= 2) {
        entries.push({ kind: "tool-group", key: `group:command:${startKey}`, groupKind: "command", items: group });
      } else {
        entries.push({ kind: "item", key: startKey, item: group[0] });
      }
      continue;
    }
    if (isCodexImageFeedItem(item)) {
      const group: CodexRunFeedItem[] = [];
      const startKey = codexFeedItemKey(item);
      while (i < items.length && isCodexImageFeedItem(items[i])) {
        group.push(items[i]);
        i += 1;
      }
      entries.push({ kind: "tool-group", key: `group:image:${startKey}`, groupKind: "image", items: group });
      continue;
    }
    entries.push({ kind: "item", key: codexFeedItemKey(item), item });
    i += 1;
  }
  return entries;
}

export function patchCodexFeedEntryItem(
  entry: HTMLElement,
  item: CodexRunFeedItem,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): void {
  const answerRole = item.kind === "assistant" ? (item.answerRole || "process") : "";
  const roleClass = answerRole ? ` is-answer-${answerRole}` : "";
  entry.className = `llm-bridge-codex-feed-entry is-item is-${item.kind} is-${item.status}${roleClass}`;
  entry.setAttribute("data-feed-kind", item.kind);
  if (item.sourceRef?.itemId) entry.setAttribute("data-item-id", item.sourceRef.itemId);
  if (item.sourceRef?.sequence !== undefined) {
    entry.setAttribute("data-sequence", String(item.sourceRef.sequence));
  }
  if (answerRole) entry.setAttribute("data-answer-role", answerRole);
  else entry.removeAttribute("data-answer-role");

  const text = (item.summary || "").trim();
  const isCandidate = item.kind === "assistant" && answerRole === "candidate";
  const isComplete = item.status === "completed" || item.status === "failed";

  // candidate 完成后原地升级 Markdown（不重建节点）
  if (isCandidate && isComplete && text) {
    let line = entry.querySelector<HTMLElement>(".llm-bridge-codex-thinking-line.is-final-candidate");
    if (!line) {
      entry.empty();
      entry.dataset.renderItemKey = `${item.id}|${item.kind}|${answerRole}|md`;
      deps.renderCodexFeedItem(entry, item, developerMode, false);
    } else {
      line.classList.remove("is-thinking-live");
      line.classList.add("is-thinking-done");
      let md = line.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
      const stream = line.querySelector<HTMLElement>(".llm-bridge-msg-stream-text");
      if (stream) stream.remove();
      if (!md) {
        md = line.createDiv({ cls: "llm-bridge-codex-answer-body llm-bridge-msg-markdown" });
      }
      deps.renderMarkdownInto(md, text);
    }
    return;
  }

  const renderedKey = entry.dataset.renderItemKey;
  const nextRenderKey = `${item.id}|${item.kind}|${answerRole}`;
  if (renderedKey !== nextRenderKey || entry.childElementCount === 0) {
    entry.empty();
    entry.dataset.renderItemKey = nextRenderKey;
    deps.renderCodexFeedItem(entry, item, developerMode, false);
  } else {
    const streamEl = entry.querySelector<HTMLElement>(".llm-bridge-msg-stream-text, .llm-bridge-codex-thinking-summary");
    const nextSummary = text || (item.label || "").trim();
    if (streamEl && nextSummary) {
      const clipped = streamEl.classList.contains("llm-bridge-msg-stream-text")
        || streamEl.classList.contains("llm-bridge-codex-thinking-summary")
        ? (nextSummary.length > 1200 ? `${nextSummary.slice(0, 1200).trimEnd()}...` : nextSummary)
        : truncateText(nextSummary, 180);
      if (streamEl.textContent !== clipped) {
        streamEl.textContent = clipped;
        streamEl.setAttribute("title", nextSummary);
      }
    }
  }

  if (isComplete) {
    entry.querySelectorAll(".llm-bridge-run-glow").forEach((el) => {
      el.classList.remove("llm-bridge-run-glow", "is-running");
    });
    entry.querySelectorAll(".is-thinking-live").forEach((el) => {
      el.classList.remove("is-thinking-live");
      el.classList.add("is-thinking-done");
    });
  }
}

export function patchCodexToolGroupBody(
  body: HTMLElement,
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): void {
  const desiredKeys = items.map((item) => codexFeedItemKey(item));
  const existingByKey = new Map<string, HTMLElement>();
  Array.from(body.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const key = child.getAttribute("data-feed-key") || child.getAttribute("data-item-id");
    if (key) existingByKey.set(key, child);
  });
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const key = codexFeedItemKey(item);
    const anchor = body.children[index] as HTMLElement | undefined;
    let node = existingByKey.get(key);
    if (!node) {
      node = body.createDiv({ cls: "llm-bridge-codex-tool-group-member", attr: { "data-feed-key": key } });
      if (item.sourceRef?.itemId) node.setAttribute("data-item-id", item.sourceRef.itemId);
      deps.renderCodexFeedItem(node, item, developerMode, true);
      existingByKey.set(key, node);
    }
    if (anchor !== node) body.insertBefore(node, anchor ?? null);
  }
  Array.from(body.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const key = child.getAttribute("data-feed-key") || child.getAttribute("data-item-id");
    if (!key || !desiredKeys.includes(key)) child.remove();
  });
}

export function patchCodexFeedEntryToolGroup(
  entry: HTMLElement,
  groupKind: "command" | "image",
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): void {
  const hasActive = items.some((item) => item.status === "running" || item.status === "pending");
  const hasFailed = items.some((item) => item.status === "failed");
  const groupStatus = hasActive ? "running" : hasFailed ? "failed" : "completed";
  entry.className = `llm-bridge-codex-feed-entry is-tool-group is-${groupKind} is-${groupStatus}`;
  entry.setAttribute("data-feed-kind", "tool-group");
  entry.setAttribute("data-group-kind", groupKind);
  entry.setAttribute("data-step-count", String(items.length));

  let group = entry.querySelector<HTMLDetailsElement>(":scope > details.llm-bridge-codex-tool-group");
  const wasOpen = !!group?.open;
  if (!group) {
    group = entry.createEl("details", { cls: `llm-bridge-codex-tool-group is-${groupStatus}` });
    const summary = group.createEl("summary", { cls: "llm-bridge-codex-tool-group-summary" });
    const icon = summary.createEl("span", { cls: "llm-bridge-codex-tool-group-icon" });
    setIcon(icon, groupKind === "image" ? "image" : "terminal");
    const main = summary.createDiv({ cls: "llm-bridge-codex-tool-group-main" });
    main.createEl("span", { cls: "llm-bridge-codex-tool-group-title", text: "" });
    summary.createDiv({ cls: "llm-bridge-codex-tool-group-meta" });
    group.addEventListener("toggle", () => {
      if (!group?.open) return;
      if (group.querySelector(":scope > .llm-bridge-codex-tool-group-body")) return;
      const cached = codexToolGroupMembers.get(group);
      if (!cached) return;
      const nextBody = group.createDiv({ cls: "llm-bridge-codex-tool-group-body" });
      patchCodexToolGroupBody(nextBody, cached.items, cached.developerMode, cached.deps);
    });
  }
  group.className = `llm-bridge-codex-tool-group is-${groupStatus}`;
  if (wasOpen) group.open = true;

  const titleEl = group.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-title");
  const title = groupKind === "image"
    ? formatCodexImageGroupTitle(items)
    : formatCodexToolGroupTitle(items);
  if (titleEl && titleEl.textContent !== title) {
    titleEl.textContent = title;
    titleEl.setAttribute("title", title);
  }

  const meta = group.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-meta");
  if (meta && developerMode) {
    meta.empty();
    meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${groupStatus}`, text: groupStatus });
    const totalDuration = sumCodexEventDuration(items);
    if (totalDuration) meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: deps.formatDurationMs(totalDuration) });
    meta.createEl("span", {
      cls: "llm-bridge-codex-tool-group-count",
      text: formatCodexToolGroupCount(items),
    });
  }

  codexToolGroupMembers.set(group, { items, developerMode, deps });
  group.setAttribute("data-member-ids", items.map((item) => codexFeedItemKey(item)).join("|"));

  // 已展开：局部更新 body 成员（keyed），保留已渲染内容身份
  if (group.open) {
    let body = group.querySelector<HTMLElement>(":scope > .llm-bridge-codex-tool-group-body");
    if (!body) body = group.createDiv({ cls: "llm-bridge-codex-tool-group-body" });
    patchCodexToolGroupBody(body, items, developerMode, deps);
  }

  if (groupStatus === "completed" || groupStatus === "failed") {
    entry.querySelectorAll(".llm-bridge-run-glow").forEach((el) => {
      el.classList.remove("llm-bridge-run-glow", "is-running");
    });
  }
}

/**
 * 真正的 keyed reconciliation：
 * - 顺序 = sourceRef.sequence + itemId（由 feed 原序 + 稳定 key 保证）
 * - 已有节点 insertBefore 移到正确位置，保留 DOM 身份/展开态/内容
 */
export function patchCodexFeedStable(
  list: HTMLElement,
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): void {
  const entries = groupCodexFeedRenderEntries(items);
  const desiredKeys = new Set(entries.map((entry) => entry.key));
  const existingByKey = new Map<string, HTMLElement>();
  Array.from(list.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const key = child.getAttribute("data-feed-key");
    if (key) existingByKey.set(key, child);
  });

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const anchor = list.children[index] as HTMLElement | undefined;
    let node = existingByKey.get(entry.key);
    if (!node) {
      node = list.createDiv({
        cls: "llm-bridge-codex-feed-entry",
        attr: { "data-feed-key": entry.key },
      });
      existingByKey.set(entry.key, node);
    }
    if (anchor !== node) {
      list.insertBefore(node, anchor ?? null);
    }
    if (entry.kind === "item") {
      patchCodexFeedEntryItem(node, entry.item, developerMode, deps);
    } else {
      patchCodexFeedEntryToolGroup(node, entry.groupKind, entry.items, developerMode, deps);
    }
  }

  Array.from(list.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const key = child.getAttribute("data-feed-key");
    if (!key || !desiredKeys.has(key)) child.remove();
  });
}

/**
 * 单瀑布流：在 feed 的 candidate 节点上更新/升级最终回答。
 * 不创建独立 Final Answer 副本。
 */
export function upgradeCodexCandidateAnswerInFeed(
  body: HTMLElement,
  text: string,
  streaming: boolean,
  deps: Pick<CodexWaterfallPatchDeps, "renderMarkdownInto">,
): void {
  const normalized = text.trim();
  if (!normalized) return;
  body.querySelectorAll(".llm-bridge-codex-final-answer").forEach((el) => el.remove());

  const candidate = body.querySelector<HTMLElement>(
    '.llm-bridge-codex-feed-entry.is-answer-candidate, .llm-bridge-codex-thinking-line.is-final-candidate, [data-answer-role="candidate"]',
  );
  if (!candidate) return;

  const line = candidate.classList.contains("llm-bridge-codex-thinking-line")
    ? candidate
    : candidate.querySelector<HTMLElement>(".llm-bridge-codex-thinking-line") || candidate;

  if (streaming) {
    let stream = line.querySelector<HTMLElement>(".llm-bridge-msg-stream-text");
    const md = line.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
    if (md) md.remove();
    if (!stream) {
      stream = line.createEl("span", { cls: "llm-bridge-msg-stream-text llm-bridge-codex-thinking-summary is-multiline" });
    }
    stream.textContent = normalized.length > 1200 ? `${normalized.slice(0, 1200).trimEnd()}...` : normalized;
    stream.setAttribute("title", normalized);
    return;
  }

  line.querySelectorAll(".llm-bridge-msg-stream-text").forEach((el) => el.remove());
  line.classList.remove("is-thinking-live");
  line.classList.add("is-thinking-done");
  let md = line.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
  if (!md) md = line.createDiv({ cls: "llm-bridge-codex-answer-body llm-bridge-msg-markdown" });
  deps.renderMarkdownInto(md, normalized);
}

/**
 * 初渲与增量共用的瀑布流 reconcile 主入口：
 * 确保 feed list 存在 → keyed patch → candidate 原地升级 Markdown。
 */
export function reconcileCodexRunWaterfall(
  processBody: HTMLElement,
  run: CodexRunViewModel,
  options: { streaming: boolean; developerMode: boolean },
  deps: CodexWaterfallPatchDeps,
): void {
  let feedList = processBody.querySelector<HTMLElement>(".llm-bridge-codex-feed-list");
  if (!feedList) {
    const section = processBody.createDiv({ cls: "llm-bridge-codex-feed llm-bridge-codex-changes-panel" });
    feedList = section.createDiv({ cls: "llm-bridge-codex-feed-list llm-bridge-codex-step-list" });
  }
  patchCodexFeedStable(feedList, run.feedItems, options.developerMode, deps);
  const text = run.finalAnswer.trim();
  if (!text) return;
  const body = processBody.closest<HTMLElement>(".llm-bridge-codex-run-body") || processBody;
  upgradeCodexCandidateAnswerInFeed(body, text, options.streaming, deps);
}
