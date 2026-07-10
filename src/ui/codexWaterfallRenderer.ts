// LLM CLI Bridge — Codex waterfall renderer (structure extract, no visual change)
//
// Owns keyed feed reconciliation + in-place candidate upgrade.
// LLMBridgeView supplies item/tool-group patch callbacks and Markdown rendering.

import type { CodexRunFeedItem, CodexRunViewModel } from "../runtime/core/codexRunViewModel";

export type CodexWaterfallFeedEntry =
  | { kind: "item"; key: string; item: CodexRunFeedItem }
  | { kind: "tool-group"; key: string; groupKind: "command" | "image"; items: CodexRunFeedItem[] };

export interface CodexWaterfallPatchDeps {
  patchEntryItem: (entry: HTMLElement, item: CodexRunFeedItem, developerMode: boolean) => void;
  patchEntryToolGroup: (
    entry: HTMLElement,
    groupKind: "command" | "image",
    items: ReadonlyArray<CodexRunFeedItem>,
    developerMode: boolean,
  ) => void;
  renderMarkdownInto: (host: HTMLElement, text: string) => void;
}

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

/**
 * 真正的 keyed reconciliation：
 * - 顺序 = sourceRef.sequence + itemId（由 feed 原序 + 稳定 key 保证）
 * - 已有节点 insertBefore 移到正确位置，保留 DOM 身份/展开态/内容
 */
export function patchCodexFeedStable(
  list: HTMLElement,
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: Pick<CodexWaterfallPatchDeps, "patchEntryItem" | "patchEntryToolGroup">,
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
      deps.patchEntryItem(node, entry.item, developerMode);
    } else {
      deps.patchEntryToolGroup(node, entry.groupKind, entry.items, developerMode);
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
