// LLM CLI Bridge — Message renderer (structure extract, no visual change)
//
// Owns message block shell, content, actions, and error fallback.
// LLMBridgeView supplies markdown, file-ref, details, and action callbacks.

import { setIcon } from "obsidian";
import type { ChatMessage } from "../types";
import type { FileRef } from "../fileRefs";
import type { AssistantTurnView, TurnTimelineNode } from "../runtime/core/types";
import type { MessageActionId, MessagePresentation } from "../messagePresentation";

export interface MessageRendererDeps {
  developerMode: boolean;
  renderMarkdownInto: (host: HTMLElement, text: string) => void;
  renderFileRefs: (parent: HTMLElement, refs: ReadonlyArray<FileRef>) => void;
  onMessageAction: (action: MessageActionId, msg: ChatMessage) => void;
  appendMsgDetails: (block: HTMLElement, msg: ChatMessage, beforeEl?: Element | null) => void;
  scrollToBottom: (force?: boolean) => void;
}

export function coerceMessageContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function compactPreviewText(text: string, maxChars: number): string {
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

export function codexTurnHasFinalAnswerCarrier(turnView: AssistantTurnView): boolean {
  if (turnView.finalAnswer.trim().length > 0) return true;
  return flattenTurnTimelineNodes(turnView.turnTimeline).some((node) =>
    node.kind === "agentMessage" && [node.text, node.summary, node.detail].some((value) => (value ?? "").trim().length > 0),
  );
}

export function shouldSuppressCodexStandaloneAnswer(
  msg: ChatMessage,
  text: string,
  developerMode: boolean,
): boolean {
  if (msg.role !== "assistant" || !text.trim() || developerMode) return false;
  const turnView = msg.assistantTurnView;
  if (!turnView || !/codex/i.test(turnView.providerId)) return false;
  return codexTurnHasFinalAnswerCarrier(turnView);
}

export function renderUserMessageContent(content: HTMLElement, text: string): void {
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

export function renderStreamingMessageContent(content: HTMLElement, text: string): void {
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
  if (msg.role === "user" && msg.fileRefs && msg.fileRefs.length > 0) {
    deps.renderFileRefs(content, msg.fileRefs);
  }
  if (!text) {
    // P4-D: 不显示 "正在等待首次输出..."，spinner + currentActivity 已提供反馈
    return;
  }
  if (msg.role !== "assistant") {
    renderUserMessageContent(content, text);
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
    if (action === "copy") addIcon("copy", "copy", "复制回答");
    if (action === "retry") addIcon("retry", "refresh-cw", "再次运行");
  }
}

export function renderMessageError(
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
