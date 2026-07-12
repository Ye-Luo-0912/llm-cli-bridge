// LLM CLI Bridge — Codex waterfall renderer (V19 unified cluster model)
//
// 唯一分段模型：将 feed 事件分成三种 cluster（execution / image / tool），
// thinking/assistant/approval/user-input/status 作为边界或独立行。
// 主路径：segmentCodexFeedEntries → keyed reconcile → operation cluster renderer。
//
// 操作块只有两层：外层一行摘要（含状态与展开箭头），展开后成员全部是扁平行。
// 增量更新使用统一 revision，运行中局部更新文字/状态/时间，保留 cluster 身份、
// 成员 DOM、展开状态和滚动位置。

import * as path from "path";
import { Menu, Notice, setIcon } from "obsidian";
import type { CodexRunFeedItem, CodexRunStepGroup, CodexRunViewModel } from "../runtime/core/codexRunViewModel";
import type { RuntimeSourceRef } from "../runtime/core/types";
import { resolveUiLocale } from "../runtime/core/toolPresentation";
import { truncateText } from "../workflowEvent";
import { sumCodexEventDuration } from "./codexProcessFeed";

// ---------- 分段模型 ----------

/** cluster 类型：由首个成员决定，后续追加事件不能改变 key */
type CodexClusterKind = "execution" | "image" | "tool";

type CodexFeedEntry =
  | { kind: "item"; key: string; item: CodexRunFeedItem }
  | { kind: "cluster"; key: string; clusterKind: CodexClusterKind; items: CodexRunFeedItem[] };

export interface CodexWaterfallPatchDeps {
  renderCodexFeedItem: (
    parent: HTMLElement,
    item: CodexRunFeedItem,
    developerMode: boolean,
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
  /** VC-4: 打开 vault 内文件（Obsidian 新标签页）；返回 false 表示文件不在 vault 内 */
  openVaultFile: (fullPath: string) => Promise<boolean>;
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

export function formatCodexImageGroupTitle(items: ReadonlyArray<CodexRunFeedItem>): string {
  const loc = resolveUiLocale() === "en" ? "en" : "zh";
  const active = items.some((item) => item.status === "running" || item.status === "pending");
  if (loc === "zh") return active ? "正在分析图片" : items.length > 1 ? `已查看 ${items.length} 张图片` : "已查看图片";
  return active ? "Viewing image" : items.length > 1 ? `Viewed ${items.length} images` : "Viewed image";
}

// ---------- 边界与分类判定 ----------

/** 思考文本（thinking/assistant）作为 cluster 边界，单独渲染 */
function isClusterBoundary(item: CodexRunFeedItem): boolean {
  return item.kind === "thinking" || item.kind === "assistant";
}

/** approval/user-input/status/context-compaction 是边界或独立行 */
function isStandaloneItem(item: CodexRunFeedItem): boolean {
  return item.kind === "approval" || item.kind === "user-input" || item.kind === "status";
}

/** 判断 item 属于哪种 cluster 类型；非 cluster 成员返回 null */
function classifyClusterMember(item: CodexRunFeedItem): CodexClusterKind | null {
  if (isCodexImageFeedItem(item)) return "image";
  if (item.kind === "command" || item.kind === "file") return "execution";
  if (item.kind === "mcp" || item.kind === "dynamic") return "tool";
  return null;
}

/**
 * 唯一分段函数：按时间线顺序分组。
 * - thinking/assistant/approval/user-input/status 作为边界，单独 item
 * - 连续的 execution 成员（command+file）组成一个 execution cluster
 * - 连续的 image 成员组成一个 image cluster
 * - 连续的 tool 成员（mcp+dynamic）组成一个 tool cluster
 * - cluster 类型由首个成员决定，后续追加同类成员合入同一 cluster
 * - 不同类型成员相遇时开启新 cluster
 */
export function segmentCodexFeedEntries(
  items: ReadonlyArray<CodexRunFeedItem>,
): CodexFeedEntry[] {
  const entries: CodexFeedEntry[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    // 边界或独立行：单独 item，关闭当前 cluster
    if (isClusterBoundary(item) || isStandaloneItem(item)) {
      entries.push({ kind: "item", key: codexFeedItemKey(item), item });
      i += 1;
      continue;
    }
    // cluster：连续同类型成员合入
    const firstKind = classifyClusterMember(item);
    if (firstKind) {
      const group: CodexRunFeedItem[] = [];
      const startKey = codexFeedItemKey(item);
      while (i < items.length) {
        const next = items[i];
        // 边界终止 cluster
        if (isClusterBoundary(next) || isStandaloneItem(next)) break;
        const nextKind = classifyClusterMember(next);
        // 同类型合入；不同类型或非 cluster 成员终止
        if (nextKind !== firstKind) break;
        group.push(next);
        i += 1;
      }
      // Always use cluster key (even for a single item) so a later sibling
      // does not remount the first row under a different keyed entry.
      entries.push({
        kind: "cluster",
        key: `cluster:${firstKind}:${startKey}`,
        clusterKind: firstKind,
        items: group,
      });
      continue;
    }
    // 其他未分类 item：单独渲染
    entries.push({ kind: "item", key: codexFeedItemKey(item), item });
    i += 1;
  }
  return entries;
}

// ---------- 签名与 revision ----------

/** 单 item 的轻量签名：捕获 status / summary 内容摘要 / duration 变化 */
function codexFeedItemSignature(item: CodexRunFeedItem): string {
  const summaryDigest = (item.summary || "").slice(0, 80);
  return `${item.status}|${summaryDigest}|${item.durationMs ?? ""}|${item.step?.durationMs ?? ""}`;
}

/** 整个 feed 的签名：key + per-item signature，用于快速判断是否有变化 */
function computeFeedSignature(items: ReadonlyArray<CodexRunFeedItem>): string {
  return items.map((i) => `${codexFeedItemKey(i)}\t${codexFeedItemSignature(i)}`).join("\n");
}

/**
 * 统一 cluster revision：至少包含 status / summary / duration / stdout/stderr 长度 / diffSummary / approvalStatus。
 * 用于判断 cluster 是否需要 patch body。revision 不变时跳过 body patch。
 */
function computeClusterRevision(items: ReadonlyArray<CodexRunFeedItem>): string {
  return items.map((item) => {
    const stdoutLen = (item.step?.stdout || "").length;
    const stderrLen = (item.step?.stderr || "").length;
    const diffSummary = item.change?.diffSummary || "";
    const approvalStatus = item.change?.approvalStatus || "";
    const summaryDigest = (item.summary || "").slice(0, 80);
    return `${codexFeedItemKey(item)}:${item.status}|${summaryDigest}|${item.durationMs ?? ""}|${item.step?.durationMs ?? ""}|${stdoutLen}|${stderrLen}|${diffSummary}|${approvalStatus}`;
  }).join("||");
}

/** 单个 entry 的签名，用于判断该 entry 是否需要 patch */
function computeEntrySignature(entry: CodexFeedEntry): string {
  if (entry.kind === "item") return codexFeedItemSignature(entry.item);
  return computeClusterRevision(entry.items);
}

// ---------- cluster 摘要与标题 ----------

function formatExecutionClusterTitle(items: ReadonlyArray<CodexRunFeedItem>): string {
  const commandCount = items.filter((item) => item.kind === "command").length;
  const fileCount = items.filter((item) => item.kind === "file" || !!item.change).length;
  const parts: string[] = [];
  if (commandCount) parts.push(`${commandCount} 条命令`);
  if (fileCount) parts.push(`${fileCount} 个文件`);
  return parts.length > 0 ? `已处理 ${parts.join(" · ")}` : `已处理 ${items.length} 个操作`;
}

function formatToolClusterTitle(items: ReadonlyArray<CodexRunFeedItem>): string {
  const labels = items.map((item) => item.label).filter(Boolean);
  if (labels.length === 1) return labels[0];
  return `已使用 ${items.length} 个工具`;
}

function formatClusterTitle(clusterKind: CodexClusterKind, items: ReadonlyArray<CodexRunFeedItem>): string {
  if (clusterKind === "image") return formatCodexImageGroupTitle(items);
  if (clusterKind === "tool") return formatToolClusterTitle(items);
  return formatExecutionClusterTitle(items);
}

function clusterGroupStatus(items: ReadonlyArray<CodexRunFeedItem>): "running" | "failed" | "completed" {
  const hasActive = items.some((item) => item.status === "running" || item.status === "pending");
  const hasFailed = items.some((item) => item.status === "failed");
  return hasActive ? "running" : hasFailed ? "failed" : "completed";
}

// ---------- 单 item 渲染（独立行：thinking/assistant/approval 等）----------

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
  if (item.status === "running" || item.status === "pending") return true;
  if (!summary) return false;
  if (detail && detail !== summary) return true;
  return summary.length > 40 || /\r?\n/.test(summary);
}

function renderCodexFeedThinking(
  parent: HTMLElement,
  item: CodexRunFeedItem,
  deps: CodexFeedItemRenderDeps,
): void {
  // 普通模式不显示 Thinking 标签，仅展示摘要文本
  const isLive = item.status === "running" || item.status === "pending";
  let summary = formatCodexFeedSummary(item, false).trim();
  if (!summary && isLive) {
    summary = deps.localizeRunStatus("Thinking");
  }
  if (!summary) return;
  const row = parent.createDiv({
    cls: `llm-bridge-codex-thinking-line is-${item.status}${isLive ? " is-thinking-live" : " is-thinking-done"}`,
  });
  row.setAttribute("data-step-kind", item.kind);
  if (item.sourceRef?.itemId) row.setAttribute("data-item-id", item.sourceRef.itemId);
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
  row.createEl("span", {
    cls: `llm-bridge-msg-stream-text llm-bridge-codex-thinking-summary is-multiline${isLive ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-glow is-thinking-faded" : ""}${isReasoning ? " is-reasoning-text" : ""}`,
    text: text.length > 1200 ? `${text.slice(0, 1200).trimEnd()}...` : text,
    attr: { title: text },
  });
}

/**
 * 渲染单个 feed item 作为扁平成员行（cluster body 内）或独立行。
 * 不再使用 nestedEvent 分支；成员行全部扁平，不嵌套 <details>。
 */
export function renderCodexFeedItem(
  parent: HTMLElement,
  item: CodexRunFeedItem,
  developerMode: boolean,
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
  const changeCls = item.change ? ` llm-bridge-codex-change-row is-${item.change.action}` : "";
  const row = parent.createDiv({
    cls: `llm-bridge-codex-feed-item llm-bridge-codex-step-row is-${item.kind} is-${item.status}${changeCls}`,
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
    // 文件路径渲染为可点击链接：左键 Obsidian 打开，右键复制路径/系统打开
    const pathLink = main.createEl("a", {
      cls: `llm-bridge-codex-change-path is-${item.change.action}`,
      text: item.change.relativePath,
      attr: { title: item.change.fullPath, href: "#" },
    });
    if (item.change.action === "delete") {
      pathLink.addClass("is-deleted");
      pathLink.setAttribute("aria-disabled", "true");
    } else {
      attachFilePathLinkHandlers(pathLink, item.change, deps);
    }
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

  // raw stdout / 完整 diff 只在开发者模式或失败场景展示
  const showFullOutput = developerMode || item.status === "failed";
  if (item.change && item.change.diff && showFullOutput) {
    deps.renderCodexDiffPreview(row, item.change.diff, item.change.diffSummary);
  }
  if (item.step && showFullOutput) {
    deps.renderCodexStepPayload(row, item.step, developerMode);
  }

  deps.renderCodexSourceRef(row, item.sourceRef, developerMode);
}

function attachFilePathLinkHandlers(
  pathLink: HTMLElement,
  change: { fullPath: string; relativePath: string; action: string } | undefined,
  deps: CodexFeedItemRenderDeps,
): void {
  if (!change) return;
  pathLink.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!change) return;
    const target = path.isAbsolute(change.fullPath)
      ? change.fullPath
      : path.join(deps.getVaultPath(), change.fullPath || change.relativePath);
    const opened = await deps.openVaultFile(target);
    if (!opened) {
      deps.openPathWithSystemDefault(target);
    }
  });
  pathLink.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!change) return;
    const menu = new Menu();
    menu.addItem((mi) => {
      mi.setTitle("复制路径").setIcon("copy");
      mi.onClick(() => {
        void navigator.clipboard.writeText(change?.relativePath || change?.fullPath || "").then(() => new Notice("路径已复制"));
      });
    });
    menu.addItem((mi) => {
      mi.setTitle("在系统中打开").setIcon("external-link");
      mi.onClick(() => {
        if (!change) return;
        const target = path.isAbsolute(change.fullPath)
          ? change.fullPath
          : path.join(deps.getVaultPath(), change.fullPath || change.relativePath);
        deps.openPathWithSystemDefault(target);
      });
    });
    menu.showAtPosition({ x: event.clientX, y: event.clientY });
  });
}

// ---------- 单 item patch（独立行）----------

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
      deps.renderCodexFeedItem(entry, item, developerMode);
      const newMd = entry.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
      if (newMd) newMd.setAttribute("data-final-text", text);
    } else {
      let md = line.querySelector<HTMLElement>(".llm-bridge-codex-answer-body");
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
    deps.renderCodexFeedItem(entry, item, developerMode);
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

// ---------- cluster body patch（局部更新，保留成员 DOM 与滚动）----------

/**
 * cluster body 局部 patch：keyed reconciliation，保留成员 DOM 身份、展开状态、滚动位置。
 * 运行中不 empty() 重建；仅更新文字、状态、时间。
 */
function patchClusterBody(
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

  // 记录 patch 前用户是否在底部，用于流式追加时自动跟随
  const wasAtBottom = isScrolledToBottom(body);

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const key = codexFeedItemKey(item);
    const anchor = body.children[index] as HTMLElement | undefined;
    let node = existingByKey.get(key);
    // 统一 revision：status / summary / duration / stdout/stderr 长度 / diffSummary / approvalStatus
    const stdoutLen = (item.step?.stdout || "").length;
    const stderrLen = (item.step?.stderr || "").length;
    const memberRev = `${item.status}|${(item.summary || "").slice(0, 80)}|${item.durationMs ?? ""}|${item.step?.durationMs ?? ""}|${stdoutLen}|${stderrLen}|${item.change?.diffSummary || ""}|${item.change?.approvalStatus || ""}`;
    if (!node) {
      node = body.createDiv({ cls: "llm-bridge-codex-tool-group-member", attr: { "data-feed-key": key } });
      if (item.sourceRef?.itemId) node.setAttribute("data-item-id", item.sourceRef.itemId);
      deps.renderCodexFeedItem(node, item, developerMode);
      node.setAttribute("data-member-rev", memberRev);
      existingByKey.set(key, node);
    } else if (node.getAttribute("data-member-rev") !== memberRev) {
      // 已存在成员：revision 变化时局部更新（不 empty 重建整行，避免闪烁/滚动跳动）
      // 仅当 status 或结构变化时才重新渲染；文字/时间局部更新
      const prevRev = node.getAttribute("data-member-rev") || "";
      const prevParts = prevRev.split("|");
      const prevStatus = prevParts[0] || "";
      // status 变化或 stdout/stderr 长度显著变化时重新渲染该成员
      const statusChanged = prevStatus !== item.status;
      const outputGrew = Math.abs((Number(prevParts[4]) || 0) - stdoutLen) > 0
        || Math.abs((Number(prevParts[5]) || 0) - stderrLen) > 0;
      if (statusChanged || outputGrew) {
        node.empty();
        deps.renderCodexFeedItem(node, item, developerMode);
      } else {
        // 仅 summary/duration 变化：局部更新文字与 meta，不重建
        updateMemberTextInPlace(node, item, developerMode, deps);
      }
      node.setAttribute("data-member-rev", memberRev);
    }
    if (anchor !== node) body.insertBefore(node, anchor ?? null);
  }

  // 移除不再存在的成员
  Array.from(body.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const key = child.getAttribute("data-feed-key") || child.getAttribute("data-item-id");
    if (!key || !desiredKeys.includes(key)) child.remove();
  });

  // 流式追加：用户仍在底部时自动跟随；向上滚动后不抢滚动位置
  if (wasAtBottom) stickScrollToBottom(body);
}

/** 局部更新成员文字与 meta（不 empty 重建） */
function updateMemberTextInPlace(
  node: HTMLElement,
  item: CodexRunFeedItem,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): void {
  // 更新 summary 文字
  const summaryEl = node.querySelector<HTMLElement>(".llm-bridge-codex-feed-summary");
  if (summaryEl) {
    const feedSummary = formatCodexFeedSummary(item, developerMode);
    const text = item.kind === "assistant" ? truncateText(feedSummary, 420) : truncateText(feedSummary, 180);
    if (summaryEl.textContent !== text) {
      summaryEl.textContent = text;
      summaryEl.setAttribute("title", feedSummary);
    }
  }
  // 更新 duration
  const durationEl = node.querySelector<HTMLElement>(".llm-bridge-codex-step-duration");
  const durationText = item.durationMs ? deps.formatDurationMs(item.durationMs) : "";
  if (durationText) {
    if (!durationEl) {
      const meta = node.querySelector<HTMLElement>(".llm-bridge-codex-feed-meta");
      if (meta) meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: durationText });
    } else if (durationEl.textContent !== durationText) {
      durationEl.textContent = durationText;
    }
  } else if (durationEl) {
    durationEl.remove();
  }
  // 更新 status 文字
  const statusEl = node.querySelector<HTMLElement>(".llm-bridge-codex-step-status");
  if (statusEl) {
    statusEl.className = `llm-bridge-codex-step-status is-${item.status}`;
    if (statusEl.textContent !== item.status) statusEl.textContent = item.status;
  }
}

function isScrolledToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

function stickScrollToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

// ---------- cluster patch（外层摘要 + 状态 + 展开 + body）----------

/**
 * cluster patch：外层一行摘要（标题 + 状态 + 展开箭头），展开后 body 扁平行。
 * 运行中不 empty() 重建整行；局部更新文字、状态和时间，保留 cluster 身份、
 * 成员 DOM、展开状态和滚动位置。
 */
function patchCodexFeedEntryCluster(
  entry: HTMLElement,
  clusterKind: CodexClusterKind,
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): void {
  const groupStatus = clusterGroupStatus(items);
  entry.className = `llm-bridge-codex-feed-entry is-cluster is-${clusterKind} is-${groupStatus}`;
  entry.setAttribute("data-feed-kind", "cluster");
  entry.setAttribute("data-cluster-kind", clusterKind);
  entry.setAttribute("data-step-count", String(items.length));

  let group = entry.querySelector<HTMLDetailsElement>(":scope > details.llm-bridge-codex-tool-group");
  const wasOpen = !!group?.open;
  if (!group) {
    group = entry.createEl("details", { cls: `llm-bridge-codex-tool-group is-${groupStatus}` });
    const summary = group.createEl("summary", { cls: "llm-bridge-codex-tool-group-summary" });
    const icon = summary.createEl("span", { cls: "llm-bridge-codex-tool-group-icon" });
    setIcon(icon, clusterKind === "image" ? "image" : clusterKind === "tool" ? "wrench" : "terminal");
    const main = summary.createDiv({ cls: "llm-bridge-codex-tool-group-main" });
    main.createEl("span", { cls: "llm-bridge-codex-tool-group-title", text: "" });
    // 状态指示器：运行中"正在思考"+光效，完成"· {duration}"，失败"· 失败"
    main.createEl("span", { cls: "llm-bridge-codex-tool-group-status" });
    // V19: 展开箭头 ">" 放在文字右侧，通过旋转表现展开状态
    main.createEl("span", { cls: "llm-bridge-codex-tool-group-chevron", text: "›" });
    summary.createDiv({ cls: "llm-bridge-codex-tool-group-meta" });
  }
  group.className = `llm-bridge-codex-tool-group is-${groupStatus}`;
  if (wasOpen) group.open = true;

  // 更新标题
  const titleEl = group.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-title");
  const title = formatClusterTitle(clusterKind, items);
  if (titleEl && titleEl.textContent !== title) {
    titleEl.textContent = title;
    titleEl.setAttribute("title", title);
  }

  // 更新状态指示器
  const statusIndicator = group.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-status");
  if (statusIndicator) {
    const totalDuration = sumCodexEventDuration(items);
    let statusText = "";
    let statusCls = "llm-bridge-codex-tool-group-status";
    if (groupStatus === "running") {
      statusText = "正在思考";
      statusCls = "llm-bridge-codex-tool-group-status is-running llm-bridge-run-glow";
    } else if (groupStatus === "failed") {
      statusText = "· 失败";
      statusCls = "llm-bridge-codex-tool-group-status is-failed";
    } else {
      statusText = totalDuration ? `· ${deps.formatDurationMs(totalDuration)}` : "· 已处理";
      statusCls = "llm-bridge-codex-tool-group-status is-done";
    }
    if (statusIndicator.className !== statusCls) statusIndicator.className = statusCls;
    if (statusIndicator.textContent !== statusText) statusIndicator.textContent = statusText;
  }

  // 更新展开箭头旋转状态
  const chevron = group.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-chevron");
  if (chevron) {
    chevron.classList.toggle("is-expanded", group.open);
  }

  // 开发者模式 meta
  const meta = group.querySelector<HTMLElement>(".llm-bridge-codex-tool-group-meta");
  if (meta && developerMode) {
    let statusEl = meta.querySelector<HTMLElement>(".llm-bridge-codex-step-status");
    if (!statusEl) statusEl = meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${groupStatus}` });
    else statusEl.className = `llm-bridge-codex-step-status is-${groupStatus}`;
    if (statusEl.textContent !== groupStatus) statusEl.textContent = groupStatus;

    const totalDuration = sumCodexEventDuration(items);
    const durationEl = meta.querySelector<HTMLElement>(".llm-bridge-codex-step-duration");
    if (totalDuration) {
      const durationText = deps.formatDurationMs(totalDuration);
      if (!durationEl) {
        meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: durationText });
      } else if (durationEl.textContent !== durationText) {
        durationEl.textContent = durationText;
      }
    } else if (durationEl) {
      durationEl.remove();
    }
  }

  group.setAttribute("data-member-ids", items.map((item) => codexFeedItemKey(item)).join("|"));

  // 统一 revision：成员状态签名，用于判断是否需要 patch body
  const memberRevision = computeClusterRevision(items);
  const prevRevision = entry.getAttribute("data-revision");
  const revisionChanged = prevRevision !== memberRevision;
  entry.setAttribute("data-revision", memberRevision);

  // 已展开：局部更新 body 成员（keyed），保留已渲染内容身份与滚动位置
  if (group.open) {
    let body = group.querySelector<HTMLElement>(":scope > .llm-bridge-codex-tool-group-body");
    if (!body) body = group.createDiv({ cls: "llm-bridge-codex-tool-group-body" });
    if (revisionChanged || !body.childElementCount) {
      patchClusterBody(body, items, developerMode, deps);
    }
  }

  // 终态去掉 glow
  if (groupStatus === "completed" || groupStatus === "failed") {
    entry.querySelectorAll(".llm-bridge-run-glow").forEach((el) => {
      el.classList.remove("llm-bridge-run-glow", "is-running");
    });
  }
}

// ---------- keyed reconciliation ----------

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
  const entries = segmentCodexFeedEntries(items);
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
      patchCodexFeedEntryCluster(node, entry.clusterKind, entry.items, developerMode, deps);
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
 */
function patchChangedFeedEntries(
  feedList: HTMLElement,
  items: ReadonlyArray<CodexRunFeedItem>,
  developerMode: boolean,
  deps: CodexWaterfallPatchDeps,
): boolean {
  const entries = segmentCodexFeedEntries(items);
  const domChildren = Array.from(feedList.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
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
      patchCodexFeedEntryCluster(node, entry.clusterKind, entry.items, developerMode, deps);
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
  body.querySelectorAll(".llm-bridge-codex-final-answer").forEach((el) => el.remove());

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
  const items = run.feedItems.filter((item) => item.answerRole !== "candidate");
  const sig = computeFeedSignature(items);
  if (sig !== (feedList.dataset.lastSig || "")) {
    feedList.dataset.lastSig = sig;
    if (!patchChangedFeedEntries(feedList, items, options.developerMode, deps)) {
      patchCodexFeedStable(feedList, items, options.developerMode, deps);
    }
  }
  const text = run.finalAnswer.trim();
  if (!text) return;
  const body = processBody.closest<HTMLElement>(".llm-bridge-codex-run-body") || processBody;
  upgradeCodexCandidateAnswerInFeed(body, text, options.streaming, deps);
}
