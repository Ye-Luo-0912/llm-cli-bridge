// LLM CLI Bridge — Message renderer (structure extract, no visual change)
//
// Owns message block shell, content, actions, error fallback, file-ref chips,
// and process-details shell. LLMBridgeView supplies markdown, run-display,
// collapsible helpers, and action callbacks.

import { setIcon } from "obsidian";
import type { ChatMessage, EffectiveRunPlan, RunStatus } from "../types";
import type { FileRef } from "../fileRefs";
import type { AssistantTurnView, TurnTimelineNode } from "../runtime/core/types";
import type { AgentRunDebugView } from "../runtime/core/agentRunDisplayModel";
import type { MessageActionId, MessagePresentation } from "../messagePresentation";
import type { WorkflowEvent } from "../workflowEvent";

export interface MessageRendererDeps {
  developerMode: boolean;
  renderMarkdownInto: (host: HTMLElement, text: string) => void;
  renderFileRefs: (parent: HTMLElement, refs: ReadonlyArray<FileRef>) => void;
  onMessageAction: (action: MessageActionId, msg: ChatMessage) => void;
  appendMsgDetails: (block: HTMLElement, msg: ChatMessage, beforeEl?: Element | null) => void;
  scrollToBottom: (force?: boolean) => void;
}

interface MessageFileRefsDeps {
  getFileRefThumbnailUrl: (ref: FileRef) => string | null;
  getSmartImageThumbnailCacheKey: (ref: FileRef, url: string) => string;
  maybeApplySmartImageThumbnail: (img: HTMLImageElement, cacheKey: string) => void;
  renderDocumentPreviewThumb: (
    parent: HTMLElement,
    thumbClass: string,
    lineClass: string,
    ref: FileRef,
    maxLines: number,
    maxChars: number,
  ) => void;
  shortAttachmentName: (name: string) => string;
  closeAttachmentContextMenu: () => void;
  openFileRefPreview: (ref: FileRef) => void;
  showAttachmentContextMenu: (
    event: MouseEvent,
    ref: FileRef,
    options: { allowRemove: boolean; allowOpen: boolean },
  ) => void;
}

export interface MessageDetailsDeps {
  developerMode: boolean;
  buildDebugView: (msg: ChatMessage) => AgentRunDebugView | undefined;
  hasLiveAggregatorRawEvents: () => boolean;
  renderAgentRunDisplayModel: (
    parent: HTMLElement,
    turnView: AssistantTurnView,
    status: RunStatus,
    options: { developerMode: boolean; debug?: AgentRunDebugView },
  ) => void;
  appendRunningProcessPlaceholder: (parent: HTMLElement) => void;
  appendCommandPreview: (parent: HTMLElement, rows: ReadonlyArray<{ label: string; value: string }>) => void;
  appendEffectiveRunPlan: (parent: HTMLElement, plan: EffectiveRunPlan) => void;
  appendWorkflowTrace: (
    parent: HTMLElement,
    trace: ReadonlyArray<{ stage: string; timestamp: string; detail: string; status: string }>,
  ) => void;
  appendTimeline: (
    parent: HTMLElement,
    timeline: ReadonlyArray<{ type: string; timestamp: string; detail: string }>,
  ) => void;
  appendSdkWorkflow: (parent: HTMLElement, events: ReadonlyArray<WorkflowEvent>) => void;
  updateLastSdkStats: (events: ReadonlyArray<WorkflowEvent>) => void;
  appendCollapsible: (
    parent: HTMLElement,
    title: string,
    text: string,
    textCls: string,
    startOpen: boolean,
    emphasize: boolean,
  ) => void;
  createCollapsibleSection: (parent: HTMLElement, title: string, cls: string, startOpen?: boolean) => HTMLElement;
  appendDebugLogPath: (parent: HTMLElement, logPath: string) => void;
  openGeneratedFile: (name: string) => void;
}

function coerceMessageContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactPreviewText(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function flattenTurnTimelineNodes(nodes: ReadonlyArray<TurnTimelineNode>): TurnTimelineNode[] {
  const flattened: TurnTimelineNode[] = [];
  const visit = (items: ReadonlyArray<TurnTimelineNode>) => {
    for (const item of items) {
      flattened.push(item);
      if (item.children?.length) visit(item.children);
    }
  };
  visit(nodes);
  return flattened;
}

function codexTurnHasFinalAnswerCarrier(turnView: AssistantTurnView): boolean {
  if (turnView.finalAnswer.trim().length > 0) return true;
  return flattenTurnTimelineNodes(turnView.turnTimeline).some((node) =>
    node.kind === "agentMessage" && [node.text, node.summary, node.detail].some((value) => (value ?? "").trim().length > 0),
  );
}

function shouldSuppressCodexStandaloneAnswer(
  msg: ChatMessage,
  text: string,
  developerMode: boolean,
): boolean {
  if (msg.role !== "assistant" || !text.trim() || developerMode) return false;
  const turnView = msg.assistantTurnView;
  if (!turnView || !/codex/i.test(turnView.providerId)) return false;
  return codexTurnHasFinalAnswerCarrier(turnView);
}

function renderUserMessageContent(content: HTMLElement, text: string): void {
  const normalized = text.trim();
  const lineCount = normalized.split(/\r?\n/).length;
  const shouldCollapse = normalized.length > 1200 || lineCount > 12;
  if (!shouldCollapse) {
    content.createEl("span", { cls: "llm-bridge-user-message-text", text: normalized });
    return;
  }
  const details = content.createEl("details", { cls: "llm-bridge-user-prompt-collapse" });
  const summary = details.createEl("summary", { cls: "llm-bridge-user-prompt-summary" });
  summary.createEl("span", { cls: "llm-bridge-user-prompt-label", text: "Request" });
  summary.createEl("span", { cls: "llm-bridge-user-prompt-preview", text: compactPreviewText(normalized, 180) });
  summary.createEl("span", { cls: "llm-bridge-user-prompt-count", text: `${lineCount} lines · ${normalized.length} chars` });
  details.createEl("div", { cls: "llm-bridge-user-prompt-body", text: normalized });
}

function renderStreamingMessageContent(content: HTMLElement, text: string): void {
  content.removeClass("llm-bridge-msg-markdown");
  content.empty();
  content.createEl("span", { cls: "llm-bridge-msg-stream-text", text });
}

export function renderMessageContent(
  content: HTMLElement,
  msg: ChatMessage,
  deps: Pick<MessageRendererDeps, "developerMode" | "renderMarkdownInto" | "renderFileRefs">,
): void {
  const text = coerceMessageContentText(msg.content) || (msg.role === "assistant" && msg.status === "running" ? "" : "");
  content.empty();
  content.removeClass("llm-bridge-msg-content-suppressed");
  content.removeAttribute("hidden");
  if (shouldSuppressCodexStandaloneAnswer(msg, text, deps.developerMode)) {
    content.addClass("llm-bridge-msg-content-suppressed");
    content.setAttribute("hidden", "");
    return;
  }
  if (msg.role === "user") {
    const hasAttachments = !!(msg.fileRefs && msg.fileRefs.length > 0);
    const hasText = !!text.trim();
    if (!hasAttachments && !hasText) return;
    // Attachments + text share one bubble chrome (not floating outside).
    const bubble = content.createDiv({ cls: "llm-bridge-user-bubble" });
    if (hasAttachments) deps.renderFileRefs(bubble, msg.fileRefs!);
    if (hasText) renderUserMessageContent(bubble, text);
    return;
  }
  if (!text) {
    // P4-D: 不显示 "正在等待首次输出..."，spinner + currentActivity 已提供反馈
    return;
  }

  if (msg.status === "running") {
    renderStreamingMessageContent(content, text);
    return;
  }

  content.addClass("llm-bridge-msg-markdown");
  deps.renderMarkdownInto(content, text);
}

export function renderMessageActions(
  block: HTMLElement,
  msg: ChatMessage,
  presentation: MessagePresentation,
  deps: Pick<MessageRendererDeps, "onMessageAction">,
): void {
  if (!presentation.actions.length) return;
  const actions = block.createDiv({ cls: "llm-bridge-msg-actions" });
  const addIcon = (id: MessageActionId, iconName: string, title: string) => {
    const btn = actions.createEl("button", {
      cls: "llm-bridge-msg-action-btn",
      attr: { type: "button", title, "aria-label": title, "data-action": id },
    });
    setIcon(btn, iconName);
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      void deps.onMessageAction(id, msg);
    });
  };
  for (const action of presentation.actions) {
    if (action === "copy") addIcon("copy", "copy", msg.role === "user" ? "复制" : "复制回答");
    if (action === "retry") addIcon("retry", "refresh-cw", "再次发送");
    if (action === "fork") addIcon("fork", "git-branch", "分叉");
  }
}

function renderMessageError(
  messagesEl: HTMLElement,
  msg: ChatMessage,
  error: unknown,
  deps: Pick<MessageRendererDeps, "developerMode" | "scrollToBottom">,
): void {
  try {
    const block = messagesEl.createDiv({
      cls: "llm-bridge-msg llm-bridge-msg-error",
      attr: { "data-msg-id": msg.id },
    });
    block.createEl("div", {
      cls: "llm-bridge-msg-content",
      text: deps.developerMode
        ? `Message render fallback · ${msg.role} · ${msg.timestamp}`
        : "This response could not be rendered inline. The answer text is still preserved.",
    });
    if (deps.developerMode && error instanceof Error && error.message) {
      const details = block.createEl("details", { cls: "llm-bridge-message-render-error-detail" });
      details.createEl("summary", { text: "Render error detail" });
      details.createEl("pre", { cls: "llm-bridge-error-detail", text: error.message });
    }
    deps.scrollToBottom(true);
  } catch {
    // 连错误块都渲染失败，静默忽略（避免无限抛出）
  }
}

/**
 * 消息块初渲主入口：head + content + details hook + actions。
 * appendMsgDetails / markdown / fileRefs 由 View 注入。
 */
export function renderMessage(
  messagesEl: HTMLElement,
  msg: ChatMessage,
  presentation: MessagePresentation,
  deps: MessageRendererDeps,
): void {
  try {
    const empty = messagesEl.querySelector(".llm-bridge-empty");
    if (empty) empty.remove();

    const kindClass = presentation.kind === "user"
      ? ""
      : presentation.kind === "assistant-running"
        ? " is-running"
        : presentation.kind === "assistant-answer"
          ? " is-answer is-completed"
          : presentation.kind === "assistant-summary"
            ? " is-summary is-completed"
            : presentation.kind === "assistant-failed"
              ? " is-failed"
              : presentation.kind === "assistant-stopped"
                ? " is-stopped"
                : ` is-${msg.status}`;

    const block = messagesEl.createDiv({
      cls: `llm-bridge-msg llm-bridge-msg-${msg.role}${kindClass}`,
      attr: { "data-msg-id": msg.id },
    });

    const head = block.createDiv({ cls: "llm-bridge-msg-head" });
    if (presentation.showRole) {
      head.createEl("span", { cls: "llm-bridge-msg-role", text: presentation.roleLabel });
    }
    if (presentation.statusLine) {
      head.createEl("span", {
        cls: "llm-bridge-msg-status-line llm-bridge-run-status-text is-running llm-bridge-run-glow",
        text: presentation.statusLine,
      });
    }
    if (presentation.showTime) {
      head.createEl("span", {
        cls: `llm-bridge-msg-time${presentation.timeFaded ? " is-faded" : ""}`,
        text: new Date(msg.timestamp).toLocaleTimeString(),
      });
    }

    const content = block.createEl("div", { cls: "llm-bridge-msg-content" });
    renderMessageContent(content, msg, deps);

    if (presentation.errorSummary) {
      block.createDiv({ cls: "llm-bridge-msg-error-summary", text: presentation.errorSummary });
    }

    if (msg.role === "assistant") {
      if (presentation.resultSummary) {
        const summaryBtn = block.createEl("button", {
          cls: "llm-bridge-msg-result-summary",
          attr: { type: "button" },
          text: `▸ ${presentation.resultSummary}`,
        });
        summaryBtn.addEventListener("click", () => {
          const details = block.querySelector(".llm-bridge-msg-details") as HTMLElement | null;
          if (!details) return;
          const hidden = details.hasAttribute("hidden");
          if (hidden) {
            details.removeAttribute("hidden");
            summaryBtn.textContent = `▾ ${presentation.resultSummary}`;
          } else {
            details.setAttribute("hidden", "");
            summaryBtn.textContent = `▸ ${presentation.resultSummary}`;
          }
        });
      }
      deps.appendMsgDetails(block, msg, content);
      const details = block.querySelector(".llm-bridge-msg-details") as HTMLElement | null;
      if (details && presentation.kind === "assistant-answer" && !presentation.showProcessFeed) {
        // 无工具的普通问答：过程区可空
        const processOnly = details.querySelector(".llm-bridge-codex-process, .llm-bridge-timeline-body");
        if (processOnly && !msg.content && !msg.assistantTurnView) {
          details.setAttribute("hidden", "");
        }
      }
      // 有工具调用时过程流默认可见（工具组自身折叠），不再用 resultSummary 把 details 整块藏起
      if (details && presentation.kind === "assistant-running" && !presentation.showProcessFeed) {
        // 兼容旧路径
      }
    }

    renderMessageActions(block, msg, presentation, deps);
    deps.scrollToBottom(true);
  } catch (e) {
    renderMessageError(messagesEl, msg, e, deps);
  }
}

export function renderMessageFileRefs(
  parent: HTMLElement,
  refs: ReadonlyArray<FileRef>,
  deps: MessageFileRefsDeps,
): void {
  const wrap = parent.createDiv({ cls: "llm-bridge-msg-attachments" });
  parent.addClass("has-attachments");
  parent.prepend(wrap);
  for (const ref of refs) {
    const chip = wrap.createDiv({
      cls: `llm-bridge-msg-attachment-chip is-${ref.kind} is-${ref.fileType}`,
      attr: { title: `${ref.displayName}\n${ref.resolvedPath}` },
    });
    const preview = chip.createEl("button", {
      cls: "llm-bridge-msg-attachment-preview",
      attr: {
        type: "button",
        title: `预览 ${ref.displayName}`,
        "aria-label": `预览 ${ref.displayName}`,
      },
    });
    const visual = preview.createEl("span", { cls: "llm-bridge-msg-attachment-visual" });
    const thumbnailUrl = ref.fileType === "image" ? deps.getFileRefThumbnailUrl(ref) : null;
    if (thumbnailUrl) {
      chip.addClass("has-preview");
      chip.addClass("is-preview-only");
      visual.addClass("has-image-preview");
      const previewImg = visual.createEl("img", {
        cls: "llm-bridge-msg-attachment-image",
        attr: { src: thumbnailUrl, alt: ref.displayName },
      });
      previewImg.addEventListener("load", () => {
        deps.maybeApplySmartImageThumbnail(
          previewImg,
          deps.getSmartImageThumbnailCacheKey(ref, thumbnailUrl),
        );
      });
      previewImg.addEventListener("error", () => {
        chip.addClass("is-preview-missing");
        visual.removeClass("has-image-preview");
        visual.addClass("is-image-placeholder");
        previewImg.remove();
        const placeholder = visual.createEl("span", { cls: "llm-bridge-msg-attachment-image-placeholder" });
        setIcon(placeholder, "image");
      });
    } else if (ref.fileType === "image") {
      chip.addClass("is-preview-only");
      chip.addClass("is-preview-missing");
      visual.addClass("is-image-placeholder");
      const placeholder = visual.createEl("span", { cls: "llm-bridge-msg-attachment-image-placeholder" });
      setIcon(placeholder, "image");
    } else {
      chip.addClass("is-preview-only");
      chip.addClass("has-document-preview");
      visual.addClass("has-document-preview");
      deps.renderDocumentPreviewThumb(
        visual,
        "llm-bridge-msg-attachment-doc-thumb",
        "llm-bridge-msg-attachment-doc-line",
        ref,
        3,
        16,
      );
      preview.createEl("span", {
        cls: "llm-bridge-attachment-token-name",
        text: deps.shortAttachmentName(ref.displayName),
      });
    }
    preview.addEventListener("click", () => {
      deps.closeAttachmentContextMenu();
      void deps.openFileRefPreview(ref);
    });
    // 已发送附件：左键预览；右键复制/打开；不提供删除
    chip.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      deps.showAttachmentContextMenu(event, ref, {
        allowRemove: false,
        allowOpen: true,
      });
    });
  }
}

/**
 * P3: appendMsgDetails 尾部共享逻辑（stderr + debug log + log + generatedFiles）。
 * 被 turnView 分支和回退分支共同调用，避免重复代码。
 */
export function appendMsgDetailsTail(
  details: HTMLElement,
  msg: ChatMessage,
  failed: boolean,
  developerMode: boolean,
  deps: MessageDetailsDeps,
): void {
  if (msg.stderr && (failed || developerMode)) {
    const startOpen = false;
    deps.appendCollapsible(details, failed ? "查看详情" : "stderr", msg.stderr, "llm-bridge-stderr-text", startOpen, failed);
    // V1.2/V1.5: 失败时提取 debug log 路径，提供可点击/复制/打开按钮
    if (failed && developerMode) {
      const logPathMatch = msg.stderr.match(/Debug log:\s*(.+)/);
      if (logPathMatch && logPathMatch[1]) {
        const debugLogBody = deps.createCollapsibleSection(details, "debug log", "llm-bridge-debug-log-collapse", false);
        deps.appendDebugLogPath(debugLogBody, logPathMatch[1].trim());
      }
    }
  }
  if (developerMode && msg.log) {
    deps.appendCollapsible(details, "log", msg.log, "llm-bridge-log-text", false, false);
  }
  if (msg.generatedFiles.length > 0 && (developerMode || !msg.assistantTurnView)) {
    const filesWrap = details.createDiv({ cls: "llm-bridge-gen-wrap" });
    filesWrap.createEl("div", { cls: "llm-bridge-gen-title", text: "新增/修改的 Markdown 文件" });
    const files = filesWrap.createDiv({ cls: "llm-bridge-gen-list" });
    for (const name of msg.generatedFiles) {
      const item = files.createDiv({ cls: "llm-bridge-gen-item" });
      item.createEl("span", { cls: "llm-bridge-gen-name", text: name });
      item.addEventListener("click", () => void deps.openGeneratedFile(name));
    }
  }
}

// stderr / log / 生成文件，默认折叠；失败或有新文件时显著
export function appendMsgDetails(
  block: HTMLElement,
  msg: ChatMessage,
  beforeEl: Element | null | undefined,
  deps: MessageDetailsDeps,
): void {
  const failed = msg.status === "failed";
  const developerMode = deps.developerMode;
  const terminalSuccess = msg.status === "completed" || msg.status === "stopped";

  // P3: 普通用户态 + developer mode 都优先从 AgentRunDisplayModel 渲染
  if (msg.role === "assistant" && (terminalSuccess || msg.status === "running") && msg.assistantTurnView) {
    block.querySelector<HTMLElement>(".llm-bridge-timeline-live")?.remove();
    const details = block.createDiv({ cls: "llm-bridge-msg-details llm-bridge-msg-process" });
    if (beforeEl) block.insertBefore(details, beforeEl);

    // P3-C: debugView 是 developer mode 的唯一调试入口。
    // 汇总 rawProviderEvents / effectiveRunPlan / provider session / attachmentPlan /
    // commandPreview / workflowTrace / sdkEvents，不散落在 appendMsgDetails。
    // 普通用户态不显示 nativeSessionRef / raw events / effectiveRunPlan。
    const debug = deps.buildDebugView(msg);

    deps.renderAgentRunDisplayModel(details, msg.assistantTurnView, msg.status, { developerMode, debug });

    appendMsgDetailsTail(details, msg, failed, developerMode, deps);
    return;
  }

  // HISTORICAL FALLBACK: 无 assistantTurnView 时走旧路径（向后兼容历史消息）。
  // fallback 不得影响新 run；新 run 必须写入 assistantTurnView。
  // legacy renderer 仅在 developerMode 下调用；普通用户态只显示 placeholder。
  const details = block.createDiv({ cls: "llm-bridge-msg-details llm-bridge-msg-process" });
  if (beforeEl) block.insertBefore(details, beforeEl);
  if (msg.role === "assistant" && msg.status === "running") {
    if (!developerMode) {
      // 普通用户态：不调用 legacy renderer，只显示 placeholder
      deps.appendRunningProcessPlaceholder(details);
    } else if (!msg.sdkEvents || msg.sdkEvents.length === 0) {
      // developerMode 运行中无 turnView：保留 liveAggregator live timeline 路径
      // (keep as developer log; remove or migrate in P4)
      if (!deps.hasLiveAggregatorRawEvents()) {
        deps.appendRunningProcessPlaceholder(details);
      }
    }
  }

  // historical fallback: developer mode legacy（无 turnView 时才走到这里）
  // (keep as developer log; remove or migrate in P4)
  if (developerMode && msg.role === "assistant" && msg.commandPreview && msg.commandPreview.length > 0) {
    deps.appendCommandPreview(details, msg.commandPreview);
  }
  if (developerMode && msg.role === "assistant" && msg.effectiveRunPlan) {
    deps.appendEffectiveRunPlan(details, msg.effectiveRunPlan);
  }
  // historical fallback: Workflow Trace（keep as developer log; remove or migrate in P4）
  if (developerMode && msg.role === "assistant" && msg.workflowTrace && msg.workflowTrace.length > 0) {
    deps.appendWorkflowTrace(details, msg.workflowTrace);
  } else if (developerMode && msg.role === "assistant" && msg.timeline && msg.timeline.length > 0) {
    deps.appendTimeline(details, msg.timeline);
  }
  // historical fallback: SDK events（keep as developer log; remove or migrate in P4）
  // 普通用户态不得调用 appendSdkWorkflow 作为主 UI
  if (developerMode && msg.role === "assistant" && msg.sdkEvents && msg.sdkEvents.length > 0) {
    deps.appendSdkWorkflow(details, msg.sdkEvents);
    deps.updateLastSdkStats(msg.sdkEvents);
  }

  appendMsgDetailsTail(details, msg, failed, developerMode, deps);
}

/** updateAssistantMessage 的 presentation chrome（class / status / statusLine），不含过程区 patch。 */
export function applyAssistantMessagePresentationChrome(
  block: HTMLElement,
  msg: ChatMessage,
  presentation: MessagePresentation,
  developerMode: boolean,
  statusLabel: string,
): void {
  block.removeClass("is-idle", "is-running", "is-completed", "is-failed", "is-stopped", "is-answer", "is-summary");
  if (presentation.kind === "assistant-answer") block.addClass("is-answer", "is-completed");
  else if (presentation.kind === "assistant-summary") block.addClass("is-summary", "is-completed");
  else block.addClass(`is-${msg.status}`);

  const statusEl = block.querySelector(".llm-bridge-msg-status");
  if (statusEl) {
    if (developerMode) {
      statusEl.textContent = statusLabel;
      statusEl.className = `llm-bridge-msg-status is-${msg.status}`;
    } else {
      statusEl.remove();
    }
  }
  // 限定在 msg-head 内查询，避免命中瀑布流里复用同 class 的 Thinking 过程节点
  const existingRunStatus = block.querySelector(".llm-bridge-msg-head .llm-bridge-msg-status-line, .llm-bridge-msg-head .llm-bridge-run-status-text");
  if (presentation.statusLine) {
    if (existingRunStatus) {
      existingRunStatus.textContent = presentation.statusLine;
      existingRunStatus.classList.add("is-running", "llm-bridge-run-glow");
    } else {
      const head = block.querySelector(".llm-bridge-msg-head");
      if (head) {
        head.createEl("span", {
          cls: "llm-bridge-msg-status-line llm-bridge-run-status-text is-running llm-bridge-run-glow",
          text: presentation.statusLine,
        });
      }
    }
  } else if (existingRunStatus) {
    // 终态：仅移除 head 内的状态行，不影响过程节点
    existingRunStatus.remove();
  }
}
