// LLM CLI Bridge — Codex waterfall renderer (structure extract, no visual change)
//
// Owns keyed feed reconciliation, item/tool-group patch, feed-item render,
// batch/tool-group initial render, and in-place candidate upgrade.
// LLMBridgeView supplies Markdown, shell/diff helpers, path open, and duration formatting.

import * as path from "path";
import { Notice, setIcon } from "obsidian";
import type { CodexRunFeedItem, CodexRunStepGroup, CodexRunViewModel } from "../runtime/core/codexRunViewModel";
import type { RuntimeSourceRef } from "../runtime/core/types";
import { resolveUiLocale } from "../runtime/core/toolPresentation";
import { truncateText } from "../workflowEvent";
import {
  formatCodexToolGroupCount,
  formatCodexToolGroupTitle,
  isCodexFeedEvent,
  shouldGroupCodexToolEvents,
  sumCodexEventDuration,
} from "./codexProcessFeed";

type CodexWaterfallFeedEntry =
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

export interface CodexFeedItemRenderDeps {
  developerMode: boolean;
  formatDurationMs: (ms: number) => string;
  localizeRunStatus: (status: string) => string;
  renderMarkdownInto: (host: HTMLElement, text: string) => void;
  renderCodexDiffPreview: (parent: HTMLElement, diff: string, diffSummary?: string) => void;
  renderCodexStepPayload: (
    parent: HTMLElement,
    step: CodexRunStepGroup,
    developerMode: boolean,
    options?: { inlineShellPanel?: boolean },
  ) => void;
  renderCodexSourceRef: (parent: HTMLElement, sourceRef?: RuntimeSourceRef, developerMode?: boolean) => void;
  getVaultPath: () => string;
  openPathWithSystemDefault: (target: string) => void;
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

/** 单 item 的轻量签名：捕获 status / summary 长度 / duration 变化 */
function codexFeedItemSignature(item: CodexRunFeedItem): string {
  return `${item.status}|${(item.summary || "").length}|${item.durationMs ?? ""}|${item.step?.durationMs ?? ""}`;
}

/** 整个 feed 的签名：key + per-item signature，用于快速判断是否有变化 */
function computeFeedSignature(items: ReadonlyArray<CodexRunFeedItem>): string {
  return items.map((i) => `${codexFeedItemKey(i)}\t${codexFeedItemSignature(i)}`).join("\n");
}

/** 单个 entry（item 或 tool-group）的签名，用于判断该 entry 是否需要 patch */
function computeEntrySignature(entry: CodexWaterfallFeedEntry): string {
  if (entry.kind === "item") return codexFeedItemSignature(entry.item);
  return entry.items.map(codexFeedItemSignature).join("||");
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
      // Always use tool-group key (even for a single command) so a later sibling
      // command does not remount the first row under a different keyed entry.
      entries.push({ kind: "tool-group", key: `group:command:${startKey}`, groupKind: "command", items: group });
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
      const newMd = entry.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
      if (newMd) newMd.setAttribute("data-final-text", text);
    } else {
      let md = line.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
      // 终态 Markdown 只渲染一次：相同文本不重复 renderMarkdownInto
      if (md && md.getAttribute("data-final-text") === text) return;
      line.classList.remove("is-thinking-live");
      line.classList.add("is-thinking-done");
      const stream = line.querySelector<HTMLElement>(".llm-bridge-msg-stream-text");
      if (stream) stream.remove();
      if (!md) {
        md = line.createDiv({ cls: "llm-bridge-codex-answer-body llm-bridge-msg-markdown" });
      }
      deps.renderMarkdownInto(md, text);
      md.setAttribute("data-final-text", text);
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

function patchCodexToolGroupBody(
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
    // 成员状态签名：status / summary / duration 变化时需重新渲染
    const memberRev = `${item.status}|${item.summary || ""}|${item.durationMs ?? ""}|${item.step?.durationMs ?? ""}`;
    if (!node) {
      node = body.createDiv({ cls: "llm-bridge-codex-tool-group-member", attr: { "data-feed-key": key } });
      if (item.sourceRef?.itemId) node.setAttribute("data-item-id", item.sourceRef.itemId);
      deps.renderCodexFeedItem(node, item, developerMode, true);
      node.setAttribute("data-member-rev", memberRev);
      existingByKey.set(key, node);
    } else if (node.getAttribute("data-member-rev") !== memberRev) {
      // 已存在成员：status/summary/duration 变化时重新渲染（running → completed 等）
      node.empty();
      deps.renderCodexFeedItem(node, item, developerMode, true);
      node.setAttribute("data-member-rev", memberRev);
    }
    if (anchor !== node) body.insertBefore(node, anchor ?? null);
  }
  Array.from(body.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const key = child.getAttribute("data-feed-key") || child.getAttribute("data-item-id");
    if (!key || !desiredKeys.includes(key)) child.remove();
  });
}

function patchCodexFeedEntryToolGroup(
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
    // keyed 更新：避免 empty() + 重建导致的微小闪动
    let statusEl = meta.querySelector<HTMLElement>(".llm-bridge-codex-step-status");
    if (!statusEl) statusEl = meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${groupStatus}` });
    else statusEl.className = `llm-bridge-codex-step-status is-${groupStatus}`;
    if (statusEl.textContent !== groupStatus) statusEl.textContent = groupStatus;

    const totalDuration = sumCodexEventDuration(items);
    const durationEl = meta.querySelector<HTMLElement>(".llm-bridge-codex-step-duration");
    if (totalDuration) {
      const durationText = deps.formatDurationMs(totalDuration);
      if (!durationEl) {
        const inserted = meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: durationText });
        const countEl = meta.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-count");
        if (countEl) meta.insertBefore(inserted, countEl);
      } else if (durationEl.textContent !== durationText) {
        durationEl.textContent = durationText;
      }
    } else if (durationEl) {
      durationEl.remove();
    }

    const countText = formatCodexToolGroupCount(items);
    let countEl = meta.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-count");
    if (!countEl) countEl = meta.createEl("span", { cls: "llm-bridge-codex-tool-group-count", text: countText });
    else if (countEl.textContent !== countText) countEl.textContent = countText;
  }

  codexToolGroupMembers.set(group, { items, developerMode, deps });
  group.setAttribute("data-member-ids", items.map((item) => codexFeedItemKey(item)).join("|"));

  // revision：成员状态签名，用于判断是否需要重新 patch body
  const memberRevision = items.map((item) => `${codexFeedItemKey(item)}:${item.status}`).join("|");
  const prevRevision = entry.getAttribute("data-revision");
  const revisionChanged = prevRevision !== memberRevision;
  entry.setAttribute("data-revision", memberRevision);

  // 已展开：局部更新 body 成员（keyed），保留已渲染内容身份
  // 仅在 revision 变化或 body 尚未填充时才 patch，避免无谓重渲染
  if (group.open) {
    let body = group.querySelector<HTMLElement>(":scope > .llm-bridge-codex-tool-group-body");
    if (!body) body = group.createDiv({ cls: "llm-bridge-codex-tool-group-body" });
    if (revisionChanged || !body.childElementCount) {
      patchCodexToolGroupBody(body, items, developerMode, deps);
    }
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
function patchCodexFeedStable(
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
    node.setAttribute("data-entry-sig", computeEntrySignature(entry));
  }

  Array.from(list.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const key = child.getAttribute("data-feed-key");
    if (!key || !desiredKeys.has(key)) child.remove();
  });
}

/**
 * 非结构变化的增量 patch：仅更新 signature 变化的 entry。
 * 若检测到 key 顺序/数量不一致（结构变化），返回 false 以触发 full reconcile。
 * answer 变化（candidate summary 增长）→ 只 patch candidate entry 的 stream-text；
 * 状态变化（running→completed 等）→ 只 patch 对应 entry。
 */
function patchChangedFeedEntries(
  feedList: HTMLElement,
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): boolean {
  const entries = groupCodexFeedRenderEntries(items);
  const domChildren = Array.from(feedList.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  // key 顺序与数量必须完全一致，否则视为结构变化
  if (domChildren.length !== entries.length) return false;
  for (let i = 0; i < entries.length; i++) {
    if (domChildren[i].getAttribute("data-feed-key") !== entries[i].key) return false;
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const node = domChildren[i];
    const sig = computeEntrySignature(entry);
    if (sig === node.getAttribute("data-entry-sig")) continue;
    node.setAttribute("data-entry-sig", sig);
    if (entry.kind === "item") {
      patchCodexFeedEntryItem(node, entry.item, developerMode, deps);
    } else {
      patchCodexFeedEntryToolGroup(node, entry.groupKind, entry.items, developerMode, deps);
    }
  }
  return true;
}

/**
 * 独立最终回答区：在 process 之后的兄弟节点中渲染最终回答。
 * 过程区只保留中间说明和工具调用；最终回答由独立节点持有。
 * 流式期间更新纯文本，完成后原地升级 Markdown 一次。
 */
export function upgradeCodexCandidateAnswerInFeed(
  body: HTMLElement,
  text: string,
  streaming: boolean,
  deps: Pick<CodexWaterfallPatchDeps, "renderMarkdownInto">,
): void {
  const normalized = text.trim();
  if (!normalized) return;
  // 清理旧版在 process body 内的 candidate 节点
  body.querySelectorAll(".llm-bridge-codex-final-answer").forEach((el) => el.remove());

  // 独立最终回答区：process 之后的兄弟节点
  let answerSection = body.querySelector<HTMLElement>(".llm-bridge-codex-final-answer-section");
  if (!answerSection) {
    answerSection = body.createDiv({ cls: "llm-bridge-codex-final-answer-section" });
  }

  if (streaming) {
    let stream = answerSection.querySelector<HTMLElement>(".llm-bridge-msg-stream-text");
    const md = answerSection.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
    if (md) md.remove();
    if (!stream) {
      stream = answerSection.createEl("span", { cls: "llm-bridge-msg-stream-text llm-bridge-codex-thinking-summary is-multiline" });
    }
    stream.textContent = normalized.length > 1200 ? `${normalized.slice(0, 1200).trimEnd()}...` : normalized;
    stream.setAttribute("title", normalized);
    return;
  }

  // 终态：原地升级为 Markdown，只渲染一次
  answerSection.querySelectorAll(".llm-bridge-msg-stream-text").forEach((el) => el.remove());
  let md = answerSection.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
  if (md && md.getAttribute("data-final-text") === normalized) return;
  if (!md) md = answerSection.createDiv({ cls: "llm-bridge-codex-answer-body llm-bridge-msg-markdown" });
  deps.renderMarkdownInto(md, normalized);
  md.setAttribute("data-final-text", normalized);
}

/**
 * 初渲与增量共用的瀑布流 reconcile 主入口：
 * 确保 feed list 存在 → 增量 patch（非结构变化）/ full keyed patch（结构变化）→ 独立最终回答区升级 Markdown。
 * 过程区只渲染非 candidate 的 feed items（中间说明 + 工具调用）；
 * candidate 的最终回答由独立兄弟节点 `.llm-bridge-codex-final-answer-section` 持有。
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
  // 过程区排除 candidate：最终回答由独立最终回答区持有
  const items = run.feedItems.filter((item) => item.answerRole !== "candidate");
  const sig = computeFeedSignature(items);
  if (sig !== (feedList.dataset.lastSig || "")) {
    feedList.dataset.lastSig = sig;
    // 非结构变化时仅 patch 变化 entry；结构变化回退到 full keyed reconcile
    if (!patchChangedFeedEntries(feedList, items, options.developerMode, deps)) {
      patchCodexFeedStable(feedList, items, options.developerMode, deps);
    }
  }
  const text = run.finalAnswer.trim();
  if (!text) return;
  const body = processBody.closest<HTMLElement>(".llm-bridge-codex-run-body") || processBody;
  upgradeCodexCandidateAnswerInFeed(body, text, options.streaming, deps);
}

function formatCodexFeedSummary(item: CodexRunFeedItem, developerMode: boolean): string {
  let summary = item.summary ?? "";
  if (developerMode || !summary) return summary;
  if (item.step) {
    summary = summary
      .split(" · ")
      .filter((part) => !part.trim().startsWith("cwd="))
      .join(" · ");
  }
  return summary.replace(/[A-Za-z]:\\[^\s·]+/g, (match) => path.basename(match));
}

function shouldRenderExpandedThinkingLine(item: CodexRunFeedItem, developerMode: boolean): boolean {
  const summary = formatCodexFeedSummary(item, developerMode).trim();
  const detail = (item.detail || "").trim();
  if (developerMode) return !!(summary || detail);
  // 运行中：始终展开，即使无 reasoning 文本也显示"正在思考"光效占位
  if (item.status === "running" || item.status === "pending") {
    return true;
  }
  // 普通完成态：仅在有用户可读摘要时展开；空泛「正在推理」不渲染
  if (!summary) return false;
  if (detail && detail !== summary) return true;
  return summary.length > 40 || /\r?\n/.test(summary);
}

function renderCodexFeedThinking(
  parent: HTMLElement,
  item: CodexRunFeedItem,
  deps: CodexFeedItemRenderDeps,
  batch?: ReadonlyArray<CodexRunFeedItem>,
): void {
  const isLive = item.status === "running" || item.status === "pending";
  let summary = formatCodexFeedSummary(item, false).trim()
    || (batch ? formatCodexThinkingFallbackFromBatch(batch) : "");
  // 运行中且无 reasoning 文本时，显示"正在思考"光效占位，确保用户始终有运行反馈
  if (!summary && isLive) {
    summary = deps.localizeRunStatus("Thinking");
  }
  // 终态且无文本时不渲染空行
  if (!summary) return;
  const row = parent.createDiv({
    cls: `llm-bridge-codex-thinking-line is-${item.status}${isLive ? " is-thinking-live" : " is-thinking-done"}`,
  });
  row.setAttribute("data-step-kind", item.kind);
  if (item.sourceRef?.itemId) row.setAttribute("data-item-id", item.sourceRef.itemId);
  // 普通模式不显示 Thinking 标签；开发者模式保留
  if (deps.developerMode) {
    row.createEl("span", { cls: "llm-bridge-codex-thinking-label", text: deps.localizeRunStatus("Thinking") });
  }
  const isPlaceholder = isLive && summary === deps.localizeRunStatus("Thinking");
  row.createEl("span", {
    cls: `llm-bridge-codex-thinking-summary${isPlaceholder ? " llm-bridge-codex-thinking-placeholder" : " is-reasoning-text"}${isLive ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-glow is-thinking-faded" : ""}`,
    text: truncateText(summary, 360),
    attr: { title: summary },
  });
}

function renderCodexFeedNarrative(
  parent: HTMLElement,
  item: CodexRunFeedItem,
  deps: CodexFeedItemRenderDeps,
): void {
  const text = formatCodexFeedSummary(item, false).trim();
  if (!text) return;
  const isReasoning = item.kind === "thinking";
  const role = item.answerRole || "process";
  const isCandidate = role === "candidate";
  const isLive = isReasoning && (item.status === "running" || item.status === "pending");
  const row = parent.createDiv({
    cls: `llm-bridge-codex-thinking-line is-${item.status} is-narrative is-answer-${role}${isLive ? " is-thinking-live" : ""}${isCandidate ? " is-final-candidate" : ""}`,
  });
  row.setAttribute("data-step-kind", item.kind);
  row.setAttribute("data-answer-role", role);
  if (item.sourceRef?.itemId) row.setAttribute("data-item-id", item.sourceRef.itemId);
  if (deps.developerMode) {
    row.createEl("span", {
      cls: "llm-bridge-codex-thinking-label",
      text: isReasoning ? deps.localizeRunStatus("Thinking") : (item.label || (isCandidate ? "Answer" : "说明")),
    });
  }
  if (isCandidate && (item.status === "completed" || item.status === "failed")) {
    const md = row.createDiv({ cls: "llm-bridge-codex-answer-body llm-bridge-msg-markdown" });
    deps.renderMarkdownInto(md, text);
    md.setAttribute("data-final-text", text);
    return;
  }
  // 流式 / 过程说明：普通文字，无外框底色（仅 white-space: pre-wrap）
  row.createEl("span", {
    cls: `llm-bridge-msg-stream-text llm-bridge-codex-thinking-summary is-multiline${isLive ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-glow is-thinking-faded" : ""}${isReasoning ? " is-reasoning-text" : ""}`,
    text: text.length > 1200 ? `${text.slice(0, 1200).trimEnd()}...` : text,
    attr: { title: text },
  });
}

function renderCodexFeedEventBlock(
  parent: HTMLElement,
  item: CodexRunFeedItem,
  developerMode: boolean,
  deps: CodexFeedItemRenderDeps,
): void {
  const changeCls = item.change ? ` llm-bridge-codex-change-row is-${item.change.action}` : "";
  const block = parent.createEl("details", {
    cls: `llm-bridge-codex-feed-item llm-bridge-codex-event-block is-batch-event is-${item.kind} is-${item.status}${changeCls}`,
  });
  block.setAttribute("data-step-kind", item.kind);
  if (item.sourceRef?.itemId) block.setAttribute("data-item-id", item.sourceRef.itemId);

  const isCommandEvent = item.kind === "command" && !!item.step;
  const summary = block.createEl("summary", { cls: "llm-bridge-codex-event-summary" });
  const icon = summary.createEl("span", { cls: "llm-bridge-codex-feed-icon llm-bridge-codex-step-icon" });
  setIcon(icon, item.icon);
  const main = summary.createDiv({ cls: "llm-bridge-codex-event-main" });
  const title = main.createDiv({ cls: "llm-bridge-codex-event-title" });
  const label = item.change
    ? "已编辑 1 个文件"
    : item.kind === "command"
      ? "已运行 1 条命令"
      : item.label;
  title.createEl("span", { cls: "llm-bridge-codex-feed-label llm-bridge-codex-step-label", text: label, attr: { title: label } });
  if (item.change?.approvalStatus) {
    title.createEl("span", {
      cls: `llm-bridge-codex-change-approval is-${item.change.approvalStatus}`,
      text: item.change.approvalStatus,
    });
  }
  const summaryText = item.change
    ? ""
    : isCommandEvent
      ? ""
      : formatCodexFeedSummary(item, developerMode);
  if (summaryText) {
    main.createDiv({ cls: "llm-bridge-codex-event-hint", text: truncateText(summaryText, developerMode ? 260 : 150), attr: { title: summaryText } });
  }

  const meta = summary.createDiv({ cls: "llm-bridge-codex-feed-meta llm-bridge-codex-event-meta" });
  if (developerMode) {
    meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${item.status}`, text: item.status });
    if (item.durationMs) meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: deps.formatDurationMs(item.durationMs) });
    if (item.step?.exitCode !== undefined) meta.createEl("span", { cls: "llm-bridge-codex-step-exit", text: `exit ${item.step.exitCode}` });
  }
  if (item.change) meta.createEl("span", { cls: "llm-bridge-codex-change-diff-summary", text: item.change.diffSummary });

  const renderBody = () => {
    if (block.querySelector(":scope > .llm-bridge-codex-event-body")) return;
    const body = block.createDiv({ cls: "llm-bridge-codex-event-body" });
    if (item.change) {
      const changeInfo = body.createDiv({ cls: "llm-bridge-codex-event-change-info" });
      changeInfo.createDiv({ cls: "llm-bridge-codex-change-path", text: item.change.relativePath, attr: { title: item.change.fullPath } });
      const actions = changeInfo.createDiv({ cls: "llm-bridge-codex-change-actions" });
      const copyBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "复制路径" } });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(item.change?.relativePath || item.change?.fullPath || "");
          new Notice("路径已复制");
        } catch {
          new Notice("复制失败");
        }
      });
      const openBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "打开文件" } });
      setIcon(openBtn, "external-link");
      openBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!item.change) return;
        const target = path.isAbsolute(item.change.fullPath)
          ? item.change.fullPath
          : path.join(deps.getVaultPath(), item.change.fullPath || item.change.relativePath);
        void deps.openPathWithSystemDefault(target);
      });
      if (item.change.diff) {
        deps.renderCodexDiffPreview(body, item.change.diff, item.change.diffSummary);
      }
    }
    if (item.step) {
      deps.renderCodexStepPayload(body, item.step, developerMode, { inlineShellPanel: item.kind === "command" });
    } else if (!item.change && (item.summary || item.detail)) {
      body.createDiv({ cls: "llm-bridge-codex-event-text", text: truncateText([item.summary, item.detail].filter(Boolean).join("\n"), 420) });
    }
    deps.renderCodexSourceRef(body, item.sourceRef, developerMode);
  };
  block.addEventListener("toggle", () => {
    if (block.open) renderBody();
  });
}

export function renderCodexFeedItem(
  parent: HTMLElement,
  item: CodexRunFeedItem,
  developerMode: boolean,
  nestedEvent: boolean,
  deps: CodexFeedItemRenderDeps,
): void {
  if (item.kind === "thinking" && !developerMode) {
    renderCodexFeedThinking(parent, item, deps);
    return;
  }
  if (item.kind === "assistant" && !developerMode) {
    renderCodexFeedNarrative(parent, item, deps);
    return;
  }
  if (nestedEvent && isCodexFeedEvent(item)) {
    renderCodexFeedEventBlock(parent, item, developerMode, deps);
    return;
  }
  const changeCls = item.change ? ` llm-bridge-codex-change-row is-${item.change.action}` : "";
  const nestedCls = nestedEvent ? " is-batch-event" : "";
  const row = parent.createDiv({
    cls: `llm-bridge-codex-feed-item llm-bridge-codex-step-row is-${item.kind} is-${item.status}${changeCls}${nestedCls}`,
  });
  row.setAttribute("data-step-kind", item.kind);
  if (item.sourceRef?.itemId) row.setAttribute("data-item-id", item.sourceRef.itemId);

  const icon = row.createEl("span", { cls: "llm-bridge-codex-feed-icon llm-bridge-codex-step-icon" });
  setIcon(icon, item.icon);

  const main = row.createDiv({ cls: "llm-bridge-codex-feed-main" });
  const title = main.createDiv({ cls: "llm-bridge-codex-feed-title" });
  title.createEl("span", { cls: "llm-bridge-codex-feed-label llm-bridge-codex-step-label", text: item.label, attr: { title: item.label } });
  if (item.change) {
    title.createEl("span", {
      cls: `llm-bridge-codex-change-approval is-${item.change.approvalStatus ?? "resolved"}`,
      text: item.change.approvalStatus ?? "changed",
    });
    main.createDiv({ cls: "llm-bridge-codex-change-path", text: item.change.relativePath, attr: { title: item.change.fullPath } });
  } else if (item.summary) {
    const feedSummary = formatCodexFeedSummary(item, developerMode);
    if (feedSummary) {
      const summaryText = item.kind === "assistant" ? truncateText(feedSummary, 420) : truncateText(feedSummary, 180);
      main.createDiv({ cls: "llm-bridge-codex-feed-summary", text: summaryText, attr: { title: feedSummary } });
    }
  }

  const meta = row.createDiv({ cls: "llm-bridge-codex-feed-meta" });
  meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${item.status}`, text: item.status });
  if (item.durationMs) meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: deps.formatDurationMs(item.durationMs) });
  if (item.step?.exitCode !== undefined) meta.createEl("span", { cls: "llm-bridge-codex-step-exit", text: `exit ${item.step.exitCode}` });
  if (item.change) meta.createEl("span", { cls: "llm-bridge-codex-change-diff-summary", text: item.change.diffSummary });

  if (item.change) {
    const actions = row.createDiv({ cls: "llm-bridge-codex-change-actions" });
    const copyBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "复制路径" } });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(item.change?.relativePath || item.change?.fullPath || "");
        new Notice("路径已复制");
      } catch {
        new Notice("复制失败");
      }
    });
    const openBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "打开文件" } });
    setIcon(openBtn, "external-link");
    openBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!item.change) return;
      const target = path.isAbsolute(item.change.fullPath)
        ? item.change.fullPath
        : path.join(deps.getVaultPath(), item.change.fullPath || item.change.relativePath);
      void deps.openPathWithSystemDefault(target);
    });
    if (item.change.diff) {
      deps.renderCodexDiffPreview(row, item.change.diff, item.change.diffSummary);
    }
  }

  if (item.step) {
    deps.renderCodexStepPayload(row, item.step, developerMode);
  }

  deps.renderCodexSourceRef(row, item.sourceRef, developerMode);
}

function formatCodexThinkingFallbackAction(item: CodexRunFeedItem): string {
  const loc = resolveUiLocale() === "en" ? "en" : "zh";
  if (item.kind === "assistant") {
    const text = formatCodexFeedSummary(item, false).trim();
    return text ? truncateText(text, 120) : "";
  }
  if (item.kind === "command") return loc === "zh" ? "执行命令" : "run a command";
  if (item.change) {
    const fileLabel = item.change.fileName || item.change.relativePath || (loc === "zh" ? "文件" : "a file");
    if (item.change.action === "create") return loc === "zh" ? `创建 ${fileLabel}` : `create ${fileLabel}`;
    if (item.change.action === "delete") return loc === "zh" ? `删除 ${fileLabel}` : `delete ${fileLabel}`;
    return loc === "zh" ? `编辑 ${fileLabel}` : `edit ${fileLabel}`;
  }
  if (item.kind === "approval") return loc === "zh" ? "等待确认" : "wait for approval";
  if (item.kind === "user-input") return loc === "zh" ? "等待输入" : "wait for input";
  if (item.kind === "mcp") return item.label ? (loc === "zh" ? `使用 ${item.label}` : `use ${item.label}`) : (loc === "zh" ? "使用工具" : "use an MCP tool");
  if (item.kind === "dynamic") return item.label ? (loc === "zh" ? `使用 ${item.label}` : `use ${item.label}`) : (loc === "zh" ? "使用工具" : "use a tool");
  if (item.label) return item.label.replace(/\.$/, "");
  return "";
}

function formatCodexThinkingFallbackFromBatch(
  batch: ReadonlyArray<CodexRunFeedItem>,
): string {
  const items = batch[0] && (batch[0].kind === "thinking" || batch[0].kind === "assistant")
    ? batch.slice(1)
    : batch;
  const actions = items
    .map((item) => formatCodexThinkingFallbackAction(item))
    .filter(Boolean);
  if (actions.length === 0) return "";
  const loc = resolveUiLocale() === "en" ? "en" : "zh";
  if (actions.length === 1) return actions[0];
  if (loc === "zh") {
    if (actions.length === 2) return `${actions[0]}，然后${actions[1]}`;
    return `${actions.slice(0, 2).join("，")}，以及另外 ${actions.length - 2} 步`;
  }
  if (actions.length === 2) return `${actions[0]}, then ${actions[1]}`;
  return `${actions.slice(0, 2).join(", ")}, then ${actions.length - 2} more step${actions.length - 2 === 1 ? "" : "s"}`;
}

function formatCodexBatchSummary(
  batch: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
): string {
  for (const item of batch) {
    const summary = formatCodexFeedSummary(item, developerMode).trim();
    if (summary) return summary;
  }
  const firstEvent = batch.find((item) => isCodexFeedEvent(item));
  return firstEvent?.label ?? batch[0]?.label ?? "";
}

function formatCodexThinkingBatchSummary(
  batch: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
): string {
  const lead = batch[0];
  if (!lead) return "";
  const summary = formatCodexFeedSummary(lead, developerMode).trim();
  if (summary) return summary;
  return formatCodexThinkingFallbackFromBatch(batch);
}

function formatCodexProcessPreview(
  batches: ReadonlyArray<ReadonlyArray<CodexRunFeedItem>>,
  developerMode: boolean,
): string {
  for (const batch of batches) {
    if (!batch.length) continue;
    const lead = batch[0];
    const leadIsThinking = lead.kind === "thinking";
    const label = leadIsThinking
      ? "Thinking"
      : lead.kind === "assistant"
        ? (lead.label || "说明")
        : lead.label || "Step";
    const batchSummary = leadIsThinking
      ? formatCodexThinkingBatchSummary(batch, developerMode)
      : formatCodexBatchSummary(batch, developerMode).trim();
    if (label === "Thinking") return batchSummary ? `Thinking · ${batchSummary}` : "Thinking";
    if (batchSummary) return batchSummary;
  }
  return "";
}

function renderCodexFeedBatchSummary(
  parent: HTMLElement,
  batch: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  eventCount: number,
): void {
  const lead = batch[0];
  const leadIsThinking = lead.kind === "thinking";
  const leadIsNarrative = lead.kind === "thinking" || lead.kind === "assistant";
  const syntheticNarrative = !leadIsNarrative
    && (lead.kind === "command" || lead.kind === "file" || lead.kind === "mcp" || lead.kind === "dynamic");
  const batchSummary = leadIsThinking
    ? formatCodexThinkingBatchSummary(batch, developerMode)
    : lead.kind === "assistant"
      ? formatCodexFeedSummary(lead, developerMode).trim() || formatCodexThinkingFallbackFromBatch(batch)
    : syntheticNarrative
      ? formatCodexThinkingFallbackFromBatch(batch) || formatCodexBatchSummary(batch, developerMode)
    : formatCodexBatchSummary(batch, developerMode);

  const textWrap = parent.createDiv({ cls: "llm-bridge-codex-feed-batch-summary-main" });
  if (developerMode) {
    const label = leadIsThinking
      ? "Thinking"
      : lead.kind === "assistant"
        ? (lead.label || "说明")
        : lead.label || "Step";
    textWrap.createEl("span", { cls: "llm-bridge-codex-feed-batch-label", text: label });
    if (batchSummary) {
      textWrap.createEl("span", {
        cls: "llm-bridge-codex-feed-batch-text",
        text: truncateText(batchSummary, 420),
        attr: { title: batchSummary },
      });
    } else if (!leadIsNarrative) {
      textWrap.createEl("span", {
        cls: "llm-bridge-codex-feed-batch-text",
        text: truncateText(lead.label || "", 180),
        attr: { title: lead.label || "" },
      });
    }
  } else if (batchSummary) {
    // 普通模式：仅真实 reasoning 带思考光效；assistant narrative 是普通文字
    const isLiveThinking = leadIsThinking
      && (lead.status === "running" || lead.status === "pending");
    textWrap.createEl("span", {
      cls: `llm-bridge-codex-feed-batch-text is-quiet-narrative${isLiveThinking ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-glow" : ""}${lead.kind === "assistant" ? " is-assistant-narrative" : ""}`,
      text: truncateText(batchSummary, 420),
      attr: { title: batchSummary },
    });
  } else if (!leadIsNarrative && !syntheticNarrative) {
    textWrap.createEl("span", {
      cls: "llm-bridge-codex-feed-batch-text",
      text: truncateText(lead.label || "", 180),
      attr: { title: lead.label || "" },
    });
  } else {
    // 无摘要的 Thinking 行：不渲染空泛标签
    parent.addClass("is-empty-narrative");
    parent.setAttribute("hidden", "");
  }

  if (developerMode) {
    const meta = parent.createDiv({ cls: "llm-bridge-codex-feed-batch-meta" });
    if (eventCount > 0) {
      meta.createEl("span", {
        cls: "llm-bridge-codex-feed-batch-count",
        text: `${eventCount} ${eventCount === 1 ? "step" : "steps"}`,
      });
    }
    meta.createEl("span", { cls: `llm-bridge-codex-feed-batch-status is-${lead.status}`, text: lead.status });
  }
}

function renderCodexToolGroup(
  parent: HTMLElement,
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexFeedItemRenderDeps,
): void {
  const events = items.filter((item) => isCodexFeedEvent(item));
  if (events.length === 0) return;
  const hasActive = events.some((item) => item.status === "running" || item.status === "pending");
  const hasFailed = events.some((item) => item.status === "failed");
  const groupStatus = hasActive ? "running" : hasFailed ? "failed" : "completed";
  const group = parent.createEl("details", {
    cls: `llm-bridge-codex-tool-group is-${groupStatus}`,
  });
  group.setAttribute("data-step-count", String(events.length));

  const summary = group.createEl("summary", { cls: "llm-bridge-codex-tool-group-summary" });
  const icon = summary.createEl("span", { cls: "llm-bridge-codex-tool-group-icon" });
  setIcon(icon, "terminal");
  const main = summary.createDiv({ cls: "llm-bridge-codex-tool-group-main" });
  const groupTitle = formatCodexToolGroupTitle(events);
  main.createEl("span", {
    cls: "llm-bridge-codex-tool-group-title",
    text: groupTitle,
    attr: { title: groupTitle },
  });
  const meta = summary.createDiv({ cls: "llm-bridge-codex-tool-group-meta" });
  if (developerMode) {
    meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${groupStatus}`, text: groupStatus });
    const totalDuration = sumCodexEventDuration(events);
    if (totalDuration) meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: deps.formatDurationMs(totalDuration) });
    meta.createEl("span", {
      cls: "llm-bridge-codex-tool-group-count",
      text: formatCodexToolGroupCount(events),
    });
  }

  let bodyRendered = false;
  const renderBody = () => {
    if (bodyRendered) return;
    bodyRendered = true;
    const body = group.createDiv({ cls: "llm-bridge-codex-tool-group-body" });
    events.forEach((item) => renderCodexFeedItem(body, item, developerMode, true, deps));
  };
  group.addEventListener("toggle", () => {
    if (group.open) renderBody();
  });
}

function renderCodexFeedBatch(
  parent: HTMLElement,
  batch: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexFeedItemRenderDeps,
): void {
  if (batch.length === 0) return;
  const lead = batch[0];
  const leadIsNarrative = lead.kind === "thinking" || lead.kind === "assistant";
  const bodyItems = leadIsNarrative ? batch.slice(1) : batch;
  const eventCount = bodyItems.filter((item) => isCodexFeedEvent(item)).length;
  const batchEl = parent.createDiv({
    cls: `llm-bridge-codex-feed-batch is-${lead.status}${bodyItems.length === 0 ? " is-summary-only" : ""}`,
  });
  const summary = batchEl.createDiv({ cls: "llm-bridge-codex-feed-batch-summary" });
  renderCodexFeedBatchSummary(summary, batch, developerMode, eventCount);
  if (bodyItems.length === 0) return;
  const body = batchEl.createDiv({ cls: "llm-bridge-codex-feed-batch-body" });
  if (lead.kind === "thinking" && shouldRenderExpandedThinkingLine(lead, developerMode)) {
    renderCodexFeedThinking(body, lead, deps, batch);
  } else if (lead.kind === "assistant" && developerMode) {
    renderCodexFeedNarrative(body, lead, deps);
  }
  if (shouldGroupCodexToolEvents(bodyItems)) {
    renderCodexToolGroup(body, bodyItems, developerMode, deps);
    return;
  }
  bodyItems.forEach((item) => {
    renderCodexFeedItem(body, item, developerMode, isCodexFeedEvent(item), deps);
  });
}
