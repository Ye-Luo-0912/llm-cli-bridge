// LLM CLI Bridge — Live Timeline 渲染（从 view.ts 渐进拆分 P2-C）
// 纯渲染：renderLiveTimeline（运行中）+ appendSdkWorkflow（终态/历史）+ renderTimelineNode（单节点核心）。
// 状态（liveAggregator / timerId）保留在 view，通过 deps 回调访问。
import { setIcon } from "obsidian";
import { WorkflowEvent, truncateText } from "../workflowEvent";
import {
  computeTimelineStats,
  formatCompletedSummary,
  formatFailedSummary,
  extractToolPath,
  extractToolParams,
  pathBasename,
  countLines,
  type TimelineNode,
} from "../timelineAdapter";
import { RunStateAggregator, aggregateEventsToTimeline } from "../runtimeTranscript";
import { toolDisplayLabel } from "../runtime/core/agentRunDisplayModel";
import {
  filterUserFacingTimelineNodes,
  getToolIconAndCategory,
  formatProcessSummary,
  formatDurationMs,
} from "./timelineUtil";

/** Live timeline 渲染依赖注入 */
export interface LiveTimelineRendererDeps {
  /** Developer Mode 开关（影响节点过滤、工具名展示、raw log 渲染） */
  isDeveloperMode: () => boolean;
  /** 本地化运行状态文本（如 "Thinking" → "正在思考"） */
  localizeRunStatus: (text: string) => string;
  /** 渲染后滚动到底部（view 侧负责 rAF 合并） */
  scrollToBottom: () => void;
  /** 获取 live aggregator 的当前 timeline nodes（供 completed/failed 分支使用） */
  getLiveAggregatorNodes: () => TimelineNode[];
  /** V17-APPEND: 获取运行中追加的持久时间线项 */
  getAppendTimelineItems: () => AppendTimelineItem[];
}

/** V17-APPEND: 运行中追加的持久时间线项（正在追加 → 已追加 → 追加失败） */
export interface AppendTimelineItem {
  readonly id: string;
  readonly text: string;
  readonly timestamp: string;
  status: "pending" | "completed" | "failed";
  error?: string;
  endedAt?: string;
}

/**
 * V2.16-C: 渲染实时 timeline（运行中，始终展开当前步骤）
 * 对应原 view.renderLiveTimeline
 */
export function renderLiveTimeline(
  block: HTMLElement,
  aggregator: RunStateAggregator,
  deps: LiveTimelineRendererDeps,
): void {
  block.querySelector<HTMLElement>(".llm-bridge-process-placeholder")?.remove();
  let liveEl = Array.from(block.children).find((el) => el instanceof HTMLElement && el.hasClass("llm-bridge-timeline-live")) as HTMLElement | undefined;
  if (!liveEl) {
    liveEl = block.createDiv({ cls: "llm-bridge-timeline llm-bridge-timeline-live", attr: { "data-live": "true" } });
  }
  const contentEl = block.querySelector<HTMLElement>(".llm-bridge-msg-content");
  if (contentEl && liveEl.parentElement === block && liveEl.nextElementSibling !== contentEl) {
    block.insertBefore(liveEl, contentEl);
  }
  const nodes = filterUserFacingTimelineNodes(aggregator.toTimelineNodes(), deps.isDeveloperMode());
  const appendItems = deps.getAppendTimelineItems();
  liveEl.empty();
  liveEl.createDiv({
    cls: "llm-bridge-timeline-live-head",
    text: `过程 · 运行中${nodes.length > 0 ? ` · ${nodes.length} steps` : ""}`,
  });
  const nodeHost = liveEl.createDiv({ cls: "llm-bridge-timeline-live-nodes" });
  // V17-APPEND: 渲染持久追加时间线项（在 SDK 节点之前，按时间顺序体现用户追加）
  for (const item of appendItems) {
    renderAppendTimelineItem(nodeHost, item);
  }
  if (nodes.length === 0 && appendItems.length === 0) {
    nodeHost.createDiv({
      cls: "llm-bridge-timeline-waiting",
      text: "正在等待 SDK 首个 stream/progress 事件...",
    });
  } else {
    for (const node of nodes) {
      renderTimelineNode(nodeHost, node, true, deps);
    }
  }
  deps.scrollToBottom();
}

/**
 * V17-APPEND: 渲染持久追加时间线项（正在追加 → 已追加 → 追加失败）。
 * 不依赖 Notice，用户可在时间线中看到追加状态迁移。
 */
function renderAppendTimelineItem(parent: HTMLElement, item: AppendTimelineItem): void {
  const cls = `llm-bridge-tl-node llm-bridge-tl-append is-${item.status}`;
  const node = parent.createDiv({ cls, attr: { "data-append-id": item.id } });
  const icon = node.createEl("span", { cls: "llm-bridge-tl-node-icon" });
  const iconEl = icon.createEl("span", { cls: "llm-bridge-tl-append-icon" });
  let iconName = "loader";
  let statusLabel = "正在追加";
  if (item.status === "completed") {
    iconName = "check";
    statusLabel = "已追加";
  } else if (item.status === "failed") {
    iconName = "alert-triangle";
    statusLabel = "追加失败";
  }
  setIcon(iconEl, iconName);
  if (item.status === "pending") iconEl.addClass("is-spinning");

  const body = node.createDiv({ cls: "llm-bridge-tl-node-body" });
  const head = body.createDiv({ cls: "llm-bridge-tl-node-head" });
  head.createEl("span", { cls: "llm-bridge-tl-append-label", text: statusLabel });
  head.createEl("span", { cls: "llm-bridge-tl-append-time", text: item.timestamp.slice(11, 19) });

  const content = body.createDiv({ cls: "llm-bridge-tl-node-content" });
  const preview = item.text.length > 120 ? item.text.slice(0, 120) + "…" : item.text;
  content.createEl("span", { cls: "llm-bridge-tl-append-text", text: preview, attr: { title: item.text } });

  if (item.status === "failed" && item.error) {
    content.createDiv({ cls: "llm-bridge-tl-append-error", text: item.error });
  }
}

/**
 * V2.17-A: 终态/历史 timeline 渲染（用 RunStateAggregator 聚合）
 * 对应原 view.appendSdkWorkflow
 */
export function appendSdkWorkflow(
  parent: HTMLElement,
  events: ReadonlyArray<WorkflowEvent>,
  options: { processOnly?: boolean },
  deps: LiveTimelineRendererDeps,
): void {
  const nodes = filterUserFacingTimelineNodes(aggregateEventsToTimeline(events), deps.isDeveloperMode());
  const visibleNodes = nodes;
  if (visibleNodes.length === 0 && options.processOnly) return;
  const stats = computeTimelineStats(nodes);
  const hasFailed = nodes.some((n) => n.kind === "failed" || n.kind === "error");
  const summary = options.processOnly
    ? formatProcessSummary(stats)
    : hasFailed ? formatFailedSummary(nodes) : formatCompletedSummary(stats);

  const wrap = parent.createDiv({ cls: "llm-bridge-timeline-wrap" });
  const block = parent.parentElement;
  if (block) {
    const liveSibling = block.querySelector<HTMLElement>(".llm-bridge-timeline-live");
    if (liveSibling) liveSibling.setAttribute("hidden", "");
  }
  const headEl = wrap.createDiv({ cls: "llm-bridge-timeline-head" });
  headEl.createEl("span", { cls: "llm-bridge-timeline-toggle", text: hasFailed ? "▼ " : "▶ " });
  headEl.createEl("span", { cls: "llm-bridge-timeline-summary", text: summary });

  const bodyEl = wrap.createDiv({ cls: "llm-bridge-timeline-body" });
  if (!hasFailed) bodyEl.setAttribute("hidden", "");

  const timelineEl = bodyEl.createDiv({ cls: "llm-bridge-timeline llm-bridge-timeline-final" });
  for (const node of visibleNodes) {
    renderTimelineNode(timelineEl, node, false, deps);
  }

  let rawToggle: Element | null = null;
  let rawContent: HTMLElement | null = null;
  if (deps.isDeveloperMode()) {
    const rawBody = bodyEl.createDiv({ cls: "llm-bridge-timeline-raw" });
    const rawHead = rawBody.createDiv({ cls: "llm-bridge-timeline-raw-head" });
    rawHead.createEl("span", { cls: "llm-bridge-timeline-raw-toggle", text: "▶ Raw log" });
    rawContent = rawBody.createDiv({ cls: "llm-bridge-timeline-raw-body", attr: { hidden: "" } });
    rawContent.createEl("pre", { cls: "llm-bridge-timeline-raw-text", text: JSON.stringify(events, null, 2) });
    rawToggle = rawHead.querySelector(".llm-bridge-timeline-raw-toggle");
  }

  const toggle = headEl.querySelector(".llm-bridge-timeline-toggle")!;
  headEl.addEventListener("click", () => {
    const hidden = bodyEl.hasAttribute("hidden");
    if (hidden) {
      bodyEl.removeAttribute("hidden");
      toggle.textContent = "▼ ";
    } else {
      bodyEl.setAttribute("hidden", "");
      toggle.textContent = "▶ ";
    }
  });
  rawToggle?.addEventListener("click", () => {
    if (!rawContent) return;
    const hidden = rawContent.hasAttribute("hidden");
    if (hidden) {
      rawContent.removeAttribute("hidden");
      rawToggle.textContent = "▼ Raw log";
    } else {
      rawContent.setAttribute("hidden", "");
      rawToggle.textContent = "▶ Raw log";
    }
  });
}

/**
 * V2.16-C: 渲染单个 timeline node（现代 Claude/Codex 风格垂直节点）
 * 对应原 view.renderTimelineNode
 */
export function renderTimelineNode(
  parent: HTMLElement,
  node: TimelineNode,
  isLive: boolean,
  deps: LiveTimelineRendererDeps,
): void {
  const item = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-" + node.kind });
  item.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = item.createDiv({ cls: "llm-bridge-tl-content" });
  if (node.kind === "session_started") {
    content.createEl("div", { cls: "llm-bridge-tl-title", text: "Session started" });
    if (node.text) content.createEl("div", { cls: "llm-bridge-tl-detail", text: node.text, attr: { title: node.text } });
  } else if (node.kind === "progress") {
    content.createEl("div", { cls: "llm-bridge-tl-title", text: node.progressLabel ?? "Progress" });
    if (node.progressDetail) {
      content.createEl("div", {
        cls: "llm-bridge-tl-detail",
        text: truncateText(node.progressDetail, 160),
        attr: { title: node.progressDetail },
      });
    }
  } else if (node.kind === "thought") {
    const detailText = node.text ?? "";
    const hasDetail = detailText.trim().length > 0;
    const titleEl = content.createDiv({ cls: "llm-bridge-tl-title llm-bridge-tl-thinking-title llm-bridge-tl-expandable" });
    titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-icon", text: "💭" });
    titleEl.createEl("span", { text: deps.localizeRunStatus("Thinking") });
    if (isLive) titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-star", text: "•" });
    if (node.progressDetail) {
      titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-meta", text: `· ${node.progressDetail}` });
    } else if (hasDetail) {
      const firstLine = detailText.split(/\r?\n/)[0] ?? "";
      const summary = truncateText(firstLine, 80);
      titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-meta", text: `· ${summary}` });
    }
    if (hasDetail) {
      const thoughtEl = content.createEl("div", { cls: "llm-bridge-tl-thought-body", attr: { hidden: "" } });
      thoughtEl.createEl("div", { cls: "llm-bridge-tl-thought-text", text: detailText });
      titleEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const hidden = thoughtEl.hasAttribute("hidden");
        if (hidden) { thoughtEl.removeAttribute("hidden"); titleEl.addClass("is-expanded"); }
        else { thoughtEl.setAttribute("hidden", ""); titleEl.removeClass("is-expanded"); }
      });
    } else {
      content.createEl("div", {
        cls: "llm-bridge-tl-thought-text is-placeholder",
        text: isLive ? "Reasoning in progress..." : "Reasoning details were not provided by the SDK.",
      });
    }
  } else if (node.kind === "agent") {
    if (node.isSubagent) content.createEl("span", { cls: "llm-bridge-tl-agent-tag is-subagent", text: "Subagent" });
    content.createEl("div", { cls: "llm-bridge-tl-agent-text", text: truncateText(node.text ?? "", 200), attr: { title: node.text ?? "" } });
  } else if (node.kind === "tool_call") {
    const toolInfo = getToolIconAndCategory(node.toolName ?? "");
    item.addClass("llm-bridge-tl-tool-cat-" + toolInfo.category);
    const headEl = content.createDiv({ cls: "llm-bridge-tl-tool-head" });
    headEl.createEl("span", { cls: "llm-bridge-tl-tool-badge", text: toolInfo.icon });
    headEl.createEl("span", { cls: "llm-bridge-tl-tool-name", text: deps.isDeveloperMode() ? (node.toolName ?? "unknown") : toolDisplayLabel(node.toolName ?? "", node.toolInput) });
    if (node.toolError) headEl.createEl("span", { cls: "llm-bridge-tl-tool-err", text: "✗" });
    if (node.toolInput) {
      const toolPath = extractToolPath(node.toolName ?? "", node.toolInput);
      if (toolPath) {
        headEl.createEl("code", { cls: "llm-bridge-tl-tool-path-inline", text: pathBasename(toolPath), attr: { title: toolPath } });
      }
    }
    if (node.durationMs !== undefined && node.durationMs > 0) {
      headEl.createEl("span", { cls: "llm-bridge-tl-tool-duration", text: formatDurationMs(node.durationMs) });
    }
    if (node.toolInput) {
      const params = extractToolParams(node.toolName ?? "", node.toolInput);
      if (params.length > 0) {
        const paramsEl = content.createDiv({ cls: "llm-bridge-tl-tool-params" });
        for (const p of params) {
          const row = paramsEl.createDiv({ cls: "llm-bridge-tl-tool-param-row" });
          row.createEl("span", { cls: "llm-bridge-tl-tool-param-key", text: p.key });
          row.createEl("span", { cls: "llm-bridge-tl-tool-param-val", text: p.value, attr: { title: p.value } });
        }
      }
    }
    if (node.toolOutput) {
      const lineCount = countLines(node.toolOutput);
      const outputWrap = content.createDiv({ cls: "llm-bridge-tl-tool-output-wrap llm-bridge-tl-expandable" });
      const outputHead = outputWrap.createDiv({ cls: "llm-bridge-tl-tool-output-head" });
      outputHead.createEl("span", { cls: "llm-bridge-tl-tool-output-toggle", text: "▶" });
      outputHead.createEl("span", { cls: "llm-bridge-tl-tool-output-label", text: `Output${lineCount > 1 ? ` · ${lineCount} lines` : ""}` });
      const outputBody = outputWrap.createDiv({ cls: "llm-bridge-tl-tool-output-body", attr: { hidden: "" } });
      const pre = outputBody.createEl("pre", { cls: "llm-bridge-tl-tool-output" });
      pre.textContent = node.toolOutput;
      if (node.toolError) pre.addClass("is-error");
      outputHead.addEventListener("click", (e) => {
        e.stopPropagation();
        const hidden = outputBody.hasAttribute("hidden");
        if (hidden) {
          outputBody.removeAttribute("hidden");
          outputHead.querySelector(".llm-bridge-tl-tool-output-toggle")!.textContent = "▼";
        } else {
          outputBody.setAttribute("hidden", "");
          outputHead.querySelector(".llm-bridge-tl-tool-output-toggle")!.textContent = "▶";
        }
      });
    }
  } else if (node.kind === "file_change") {
    const symbol = node.fileAction === "create" ? "+" : node.fileAction === "modify" ? "~" : "-";
    const verb = node.fileAction === "create" ? "Created" : node.fileAction === "modify" ? "Modified" : "Deleted";
    const headEl = content.createDiv({ cls: "llm-bridge-tl-file-head llm-bridge-tl-file-action-" + (node.fileAction ?? "modify") });
    headEl.createEl("span", { cls: "llm-bridge-tl-file-symbol", text: symbol });
    headEl.createEl("span", { cls: "llm-bridge-tl-file-action", text: verb });
    const full = node.filePath ?? "";
    headEl.createEl("code", { cls: "llm-bridge-tl-file-path", text: pathBasename(full), attr: { title: full } });
  } else if (node.kind === "warning") {
    content.createEl("span", { cls: "llm-bridge-tl-warning-icon", text: "⚠" });
    content.createEl("span", { cls: "llm-bridge-tl-warning-text", text: truncateText(node.message ?? "", 120), attr: { title: node.message ?? "" } });
  } else if (node.kind === "error") {
    content.createEl("span", { cls: "llm-bridge-tl-error-icon", text: "✗" });
    content.createEl("span", { cls: "llm-bridge-tl-error-text", text: truncateText(node.message ?? "", 200), attr: { title: node.message ?? "" } });
  } else if (node.kind === "completed") {
    const stats = computeTimelineStats(deps.getLiveAggregatorNodes());
    const chipsEl = content.createDiv({ cls: "llm-bridge-tl-completed-chips" });
    chipsEl.createEl("span", { cls: "llm-bridge-tl-chip llm-bridge-tl-chip-success", text: "✓ Completed" });
    if (stats.toolCount > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${stats.toolCount} tool${stats.toolCount > 1 ? "s" : ""}` });
    if (stats.fileChangeCount > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${stats.fileChangeCount} file${stats.fileChangeCount > 1 ? "s" : ""}` });
    if (stats.thoughtCount > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${stats.thoughtCount} thinking` });
    if (stats.durationMs !== undefined && stats.durationMs > 0) {
      const secs = Math.round(stats.durationMs / 1000);
      if (secs > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${secs}s` });
    }
  } else if (node.kind === "failed") {
    const allNodes = deps.getLiveAggregatorNodes();
    content.createEl("div", { cls: "llm-bridge-tl-failed", text: formatFailedSummary(allNodes), attr: { title: node.message ?? "" } });
  }
}
