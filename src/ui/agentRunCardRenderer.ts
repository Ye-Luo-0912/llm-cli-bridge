// LLM CLI Bridge — AgentRun 卡片渲染器（从 view.ts 渐进拆分 P2-A）
// 纯渲染：dispatcher + 7 个子卡片（thinking/tool-call/file-change/approval/user-input/warning/error）。
import {
  getToolIconCategory,
  toolDisplayLabel,
  type AgentRunCard,
} from "../runtime/core/agentRunDisplayModel";
import { truncateText } from "../workflowEvent";
import type { PermissionChoice } from "../sdkPermission";
import {
  renderCollapsedText,
  renderCollapsedJson,
  renderSourceRefDetail,
} from "./agentRunCardHelpers";

/** AgentRun 卡片渲染依赖注入 */
export interface AgentRunCardDeps {
  /** 格式化耗时（ms → 可读字符串） */
  formatDurationMs: (ms: number) => string;
  /** 解析权限请求（approval card 的按钮回调） */
  resolvePermissionRequests: (requestIds: string[], choice: PermissionChoice) => void;
}

/** P3: 渲染单个 AgentRunCard。纯 DOM 渲染，不含业务分类逻辑。 */
export function renderAgentRunCard(parent: HTMLElement, card: AgentRunCard, deps: AgentRunCardDeps): void {
  switch (card.kind) {
    case "thinking":
      renderThinkingCard(parent, card);
      break;
    case "tool-call":
      renderToolCallCard(parent, card, deps);
      break;
    case "file-change":
      renderFileChangeCard(parent, card);
      break;
    case "approval":
      renderApprovalCard(parent, card, deps);
      break;
    case "user-input":
      renderUserInputCard(parent, card);
      break;
    case "warning":
      renderWarningCard(parent, card);
      break;
    case "error":
      renderErrorCard(parent, card);
      break;
    case "final-answer":
    case "debug-raw-event":
      // final-answer 由 msg content 渲染；debug-raw-event 由 debugView 渲染
      break;
  }
}

/** 渲染思考卡片 */
export function renderThinkingCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "thinking" }>): void {
  const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-thinking" });
  node.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = node.createDiv({ cls: "llm-bridge-tl-content" });
  content.createEl("div", { cls: "llm-bridge-tl-title", text: card.title });
  if (card.meta) content.createEl("div", { cls: "llm-bridge-tl-detail", text: card.meta });
  if (card.text) content.createEl("div", { cls: "llm-bridge-tl-thought-text", text: truncateText(card.text, 280) });
}

/** 渲染工具调用卡片 */
export function renderToolCallCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "tool-call" }>, deps: AgentRunCardDeps): void {
  const iconCat = getToolIconCategory(card.toolName);
  const node = parent.createDiv({ cls: `llm-bridge-tl-node llm-bridge-tl-tool is-${card.status}` });
  node.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = node.createDiv({ cls: "llm-bridge-tl-content" });
  const titleRow = content.createDiv({ cls: "llm-bridge-tl-tool-head" });
  titleRow.createEl("span", { cls: `llm-bridge-tl-tool-icon is-${iconCat.category}`, text: iconCat.icon });
  // P4-D: 普通用户态用简洁 label（如 "Read AGENTS.md"），developer mode 显示 raw toolName
  // F-01: 兜底也用 toolDisplayLabel 而非 raw toolName，防止 label 未设置时泄露内部名
  const displayLabel = (card as { label?: string }).label ?? toolDisplayLabel(card.toolName, card.toolInput);
  titleRow.createEl("span", { cls: "llm-bridge-tl-tool-name", text: displayLabel });
  if (card.durationMs !== undefined) {
    titleRow.createEl("span", { cls: "llm-bridge-tl-tool-duration", text: deps.formatDurationMs(card.durationMs) });
  }
  if (card.exitCode !== undefined) {
    titleRow.createEl("span", { cls: "llm-bridge-tl-tool-duration", text: `exit ${card.exitCode}` });
  }
  if (card.command) {
    const commandText = typeof card.command === "string" ? card.command : card.command.join(" ");
    content.createEl("div", { cls: "llm-bridge-tl-tool-input", text: `command: ${truncateText(commandText, 160)}`, attr: { title: commandText } });
  }
  if (card.cwd) {
    content.createEl("div", { cls: "llm-bridge-tl-tool-input", text: `cwd: ${truncateText(card.cwd, 160)}`, attr: { title: card.cwd } });
  }
  if (card.toolInput && !card.command) {
    const inputLabel = card.toolName === "mcpToolCall" || card.toolName === "dynamicToolCall" ? "args" : "input";
    content.createEl("div", { cls: "llm-bridge-tl-tool-input", text: `${inputLabel}: ${truncateText(card.toolInput, 160)}`, attr: { title: card.toolInput } });
  }
  for (const prog of card.progress) {
    const progEl = content.createDiv({ cls: "llm-bridge-tl-tool-progress" });
    const progText = prog.detail ? `${prog.label}: ${prog.detail}` : prog.label;
    progEl.createEl("span", { cls: "llm-bridge-tl-tool-progress-text", text: truncateText(progText, 120) });
  }
  renderCollapsedText(content, "stdout", card.stdout);
  renderCollapsedText(content, "stderr", card.stderr);
  if (!card.stdout && !card.stderr) {
    renderCollapsedText(content, "output", card.output);
  }
  renderCollapsedJson(content, "structured result", card.structuredResult);
  renderCollapsedJson(content, "content items", card.contentItems);
  renderSourceRefDetail(content, card);
}

/** 渲染文件变更卡片 */
export function renderFileChangeCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "file-change" }>): void {
  const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-file" });
  node.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = node.createDiv({ cls: "llm-bridge-tl-content" });
  content.createEl("div", { cls: "llm-bridge-tl-title", text: card.title });
  if (card.approvalStatus) {
    content.createEl("div", { cls: "llm-bridge-tl-detail", text: `approval: ${card.approvalStatus}` });
  }
  if (card.changes && card.changes.length > 0) {
    for (const change of card.changes) {
      content.createEl("div", { cls: "llm-bridge-tl-detail", text: `${change.action} ${change.path}` });
    }
  } else {
    content.createEl("div", { cls: "llm-bridge-tl-detail", text: `${card.action} ${card.path}` });
  }
  renderCollapsedText(content, "diff", card.diff);
  renderSourceRefDetail(content, card);
}

/** 渲染权限审批卡片（pending 显示按钮，resolved 显示结果） */
export function renderApprovalCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "approval" }>, deps: AgentRunCardDeps): void {
  if (card.pending) {
    const approval = parent.createDiv({ cls: `llm-bridge-turn-approval-card is-risk-${card.riskLevel}` });
    approval.setAttribute("data-request-id", card.requestId);
    const row = approval.createDiv({ cls: "llm-bridge-turn-approval-row" });
    row.createEl("span", { cls: "llm-bridge-turn-approval-title", text: card.label || card.summary || toolDisplayLabel(card.toolName) });
    if (card.riskLevel !== "low") {
      row.createEl("span", {
        cls: `llm-bridge-turn-approval-risk is-${card.riskLevel}`,
        text: card.riskLevel === "high" ? "高风险" : "需确认",
      });
    }

    const actions = approval.createDiv({ cls: "llm-bridge-turn-approval-actions" });
    const createActionButton = (label: string, choice: PermissionChoice, extraClass: string): void => {
      const button = actions.createEl("button", {
        cls: `llm-bridge-turn-approval-btn ${extraClass}`,
        text: label,
        attr: { type: "button", "data-decision": choice },
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deps.resolvePermissionRequests([card.requestId], choice);
      });
    };
    createActionButton("允许一次", "allow_once", "is-allow-once");
    createActionButton("本会话允许", "allow_session", "is-allow-session");
    createActionButton("拒绝", "deny_session", "is-deny");

    const detailItems: string[] = [];
    if (card.riskReason) detailItems.push(`风险：${card.riskReason}`);
    if (card.highRiskFlags && card.highRiskFlags.length > 0) {
      detailItems.push(`标记：${card.highRiskFlags.join(", ")}`);
    }
    if (card.inputSummary) detailItems.push(card.inputSummary);
    if (card.subagentRisk) detailItems.push(card.subagentRisk);
    if (detailItems.length > 0) {
      const details = approval.createDiv({ cls: "llm-bridge-turn-approval-details" });
      const toggle = details.createEl("button", {
        cls: "llm-bridge-turn-approval-details-toggle",
        text: "详情",
        attr: { type: "button" },
      });
      const detailBody = details.createDiv({
        cls: "llm-bridge-turn-approval-details-body",
        attr: { hidden: "" },
      });
      for (const line of detailItems) {
        detailBody.createEl("div", { cls: "llm-bridge-turn-approval-detail-item", text: line, attr: { title: line } });
      }
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const hidden = detailBody.hasAttribute("hidden");
        if (hidden) {
          detailBody.removeAttribute("hidden");
          toggle.textContent = "Hide details";
        } else {
          detailBody.setAttribute("hidden", "");
          toggle.textContent = "Details";
        }
      });
    }
    return;
  }

  const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-approval" });
  node.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = node.createDiv({ cls: "llm-bridge-tl-content" });
  const resolutionLabel = card.resolution?.type === "accept" ? "允许一次"
    : card.resolution?.type === "acceptForSession" ? "本会话允许"
    : card.resolution?.type === "decline" ? "已拒绝"
    : "已取消";
  const sourceLabel = card.resolutionSource === "session_allow" ? "（会话允许）"
    : card.resolutionSource === "session_deny" ? "（会话拒绝）"
    : card.resolutionSource === "mode" ? "（模式自动）"
    : "";
  content.createEl("div", { cls: "llm-bridge-tl-title", text: `权限: ${card.label || toolDisplayLabel(card.toolName)} → ${resolutionLabel}${sourceLabel}` });
  if (card.inputSummary) {
    content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.inputSummary, 120) });
  }
}

/** 渲染用户输入请求卡片 */
export function renderUserInputCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "user-input" }>): void {
  const node = parent.createDiv({ cls: `llm-bridge-tl-node llm-bridge-tl-user-input is-${card.status}` });
  node.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = node.createDiv({ cls: "llm-bridge-tl-content" });
  content.createEl("div", { cls: "llm-bridge-tl-title", text: card.pending ? "Needs input" : "Input received" });
  content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.prompt, 240) });
  if (!card.pending && card.response?.type === "submit") {
    const responseText = card.inputType === "secret" ? "Response submitted" : card.response.value;
    content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(responseText, 180) });
  }
}

/** 渲染警告卡片 */
export function renderWarningCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "warning" }>): void {
  const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-warning" });
  node.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = node.createDiv({ cls: "llm-bridge-tl-content" });
  content.createEl("div", { cls: "llm-bridge-tl-title", text: card.title });
  content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.message, 280) });
}

/** 渲染错误卡片 */
export function renderErrorCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "error" }>): void {
  const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-error" });
  node.createDiv({ cls: "llm-bridge-tl-dot" });
  const content = node.createDiv({ cls: "llm-bridge-tl-content" });
  content.createEl("div", { cls: "llm-bridge-tl-title is-error", text: card.title });
  content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.message, 280) });
}
