// LLM CLI Bridge — Codex run shell renderer (structure extract, no visual change)
//
// Owns run mount + in-place patch: header chrome, approval gates, process head,
// diagnostics drawer, and waterfall/debug wiring. LLMBridgeView supplies
// Markdown/shell/diff/permission resolve via CodexRunRenderDeps.

import { setIcon } from "obsidian";
import type { AgentRunDebugView } from "../runtime/core/agentRunDisplayModel";
import {
  formatCodexRunValue,
  type CodexRunApprovalGate,
  type CodexRunDiagnosticsGroup,
  type CodexRunViewModel,
} from "../runtime/core/codexRunViewModel";
import type { RuntimeSourceRef } from "../runtime/core/types";
import { resolveUiLocale } from "../runtime/core/toolPresentation";
import {
  buildPresentationFromCodexRun,
  mapRunningActivityToStatusLine,
} from "../messagePresentation";
import { type PermissionChoice } from "../sdkPermission";
import { truncateText } from "../workflowEvent";
import { groupCodexFeedBatches, isCodexFeedEvent } from "./codexProcessFeed";

export interface CodexRunRenderDeps {
  localizeRunStatus: (status: string) => string;
  renderRunStatusText: (el: HTMLElement, label: string, kind: "blocked" | "running" | "completed") => void;
  resolvePermissionRequests: (requestIds: string[], choice: PermissionChoice) => void;
  renderCodexSourceRef: (parent: HTMLElement, sourceRef?: RuntimeSourceRef, developerMode?: boolean) => void;
  renderCodexCollapsedText: (parent: HTMLElement, label: string, value?: string) => void;
  renderAgentRunDebugDrawer: (parent: HTMLElement, debug: AgentRunDebugView) => void;
  reconcileCodexRunWaterfall: (
    processBody: HTMLElement,
    run: CodexRunViewModel,
    options: { streaming: boolean; developerMode: boolean },
  ) => void;
  upgradeCodexCandidateAnswerInFeed: (
    body: HTMLElement,
    finalAnswer: string,
    streaming: boolean,
  ) => void;
}

export type CodexRunMountOrPatchTarget =
  | { mode: "mount"; parent: HTMLElement }
  | { mode: "patch"; wrap: HTMLElement };

export interface CodexRunMountOrPatchArgs {
  run: CodexRunViewModel;
  developerMode: boolean;
  /** mount: required for disposition attrs; patch: optional update */
  sourceModel?: { finalAnswerDisposition: string };
  /** mount: used by buildPresentationFromCodexRun */
  runtimeLabel?: string;
  /** patch: presentation from View message presentation */
  presentation?: { kind: string; showRunChrome: boolean };
  streaming?: boolean;
  /** patch: for glow cleanup on terminal */
  messageStatus?: string;
}

export function mountOrReconcileCodexRun(
  target: CodexRunMountOrPatchTarget,
  args: CodexRunMountOrPatchArgs,
  deps: CodexRunRenderDeps,
): HTMLElement {
  if (target.mode === "mount") {
    return mountCodexRunView(
      target.parent,
      args.run,
      args.sourceModel ?? { finalAnswerDisposition: "none" },
      args.developerMode,
      args.runtimeLabel ?? "",
      deps,
    );
  }
  reconcileCodexRunView(
    target.wrap,
    args.run,
    args.developerMode,
    args.presentation ?? { kind: "assistant-summary", showRunChrome: false },
    {
      streaming: !!args.streaming,
      messageStatus: args.messageStatus,
      sourceModel: args.sourceModel,
    },
    deps,
  );
  return target.wrap;
}

export function mountCodexRunView(
  parent: HTMLElement,
  run: CodexRunViewModel,
  sourceModel: { finalAnswerDisposition: string },
  developerMode: boolean,
  runtimeLabel: string,
  deps: CodexRunRenderDeps,
): HTMLElement {
  const loc = resolveUiLocale() === "en" ? "en" : "zh";
  const presentation = buildPresentationFromCodexRun(run, {
    developerMode,
    locale: loc,
    runtimeLabel,
  });
  const diagnosticsForDisplay = filterCodexDiagnosticsForDisplay(run.diagnosticsGroups, developerMode);
  const processFeedItems = run.feedItems;
  const processFeedBatches = groupCodexFeedBatches(processFeedItems);
  const hasDeveloperDebug = developerMode && !!run.debugPanel;
  const hasProcessContent = processFeedItems.length > 0
    || diagnosticsForDisplay.length > 0;
  const hasAnswer = !!run.finalAnswer.trim();
  // 终态禁止自动折叠过程：运行中看到的节点完成后原样保留
  const showFeed = hasProcessContent; // 有过程内容就展示，不因 presentation 标志清空
  const showChrome = presentation.showRunChrome || developerMode;
  const hasBodyContent = run.approvalGates.length > 0
    || showFeed
    || hasDeveloperDebug
    || hasAnswer;

  const semanticClass = presentation.kind === "assistant-answer"
    ? " is-semantic-answer"
    : presentation.kind === "assistant-running"
      ? " is-semantic-running"
      : presentation.kind === "assistant-summary"
        ? " is-semantic-summary"
        : presentation.kind === "assistant-failed" || presentation.kind === "assistant-stopped"
          ? " is-semantic-failed"
          : "";

  const wrap = parent.createDiv({
    cls: `llm-bridge-timeline-wrap llm-bridge-turn-view llm-bridge-codex-run-view is-${run.runHeader.statusKind}${developerMode ? " is-developer" : ""}${semanticClass}${showChrome ? " is-run-chrome" : " is-process-quiet"}`,
  });
  wrap.setAttribute("data-final-answer-disposition", sourceModel.finalAnswerDisposition);
  wrap.addClass(`is-disposition-${sourceModel.finalAnswerDisposition}`);

  const head = wrap.createDiv({ cls: "llm-bridge-timeline-head llm-bridge-codex-run-header" });
  const summary = head.createDiv({ cls: "llm-bridge-codex-run-summary" });
  if (showChrome && (presentation.showCompletedBadge || developerMode)) {
    const statusEl = summary.createEl("span", {
      cls: `llm-bridge-codex-run-status llm-bridge-timeline-summary is-${run.runHeader.statusKind}`,
      text: deps.localizeRunStatus(run.runHeader.status),
    });
    statusEl.setAttribute("data-run-status", run.runHeader.statusKind);
  }
  if (showChrome && (presentation.showProviderBadge || developerMode)) {
    const providerText = [run.runHeader.provider, run.runHeader.model].filter(Boolean).join(" · ");
    if (providerText) summary.createEl("span", { cls: "llm-bridge-codex-run-provider", text: providerText, attr: { title: providerText } });
  }

  const hasMeaningfulMetrics = run.runHeader.fileChangeCount > 0
    || run.runHeader.commandCount > 0
    || run.runHeader.approvalCount > 0;
  if (showChrome && developerMode && (hasMeaningfulMetrics || true)) {
    const metrics = head.createDiv({ cls: "llm-bridge-codex-run-metrics" });
    renderCodexMetric(metrics, "clock", run.runHeader.elapsed || "0s", "Elapsed time");
    if (run.runHeader.fileChangeCount > 0 || developerMode) {
      renderCodexMetric(metrics, "file-text", String(run.runHeader.fileChangeCount), "File changes");
    }
    if (run.runHeader.commandCount > 0 || developerMode) {
      renderCodexMetric(metrics, "terminal", String(run.runHeader.commandCount), "Commands");
    }
    if (run.runHeader.approvalCount > 0 || developerMode) {
      renderCodexMetric(metrics, "shield", String(run.runHeader.approvalCount), "Approvals");
    }
  }

  const body = wrap.createDiv({ cls: "llm-bridge-timeline-body llm-bridge-codex-run-body" });
  // 普通模式运行态：状态行已在 msg-head；此处仅在 blocked / 开发者模式重复展示
  if (run.runHeader.statusKind === "blocked") {
    renderCodexCurrentActivity(body, run, deps);
  } else if (presentation.kind === "assistant-running" && developerMode) {
    const line = mapRunningActivityToStatusLine(run.currentActivity?.label || "", loc);
    const activity = body.createDiv({ cls: "llm-bridge-codex-current-activity is-running" });
    activity.createEl("span", { cls: "llm-bridge-codex-current-activity-text llm-bridge-run-status-text is-running llm-bridge-run-glow", text: line });
  }
  if (run.approvalGates.length > 0) reconcileCodexApprovalGates(body, run.approvalGates, developerMode, deps);

  const process = body.createDiv({ cls: "llm-bridge-codex-process" });
  if (showFeed) {
    const processHead = process.createDiv({ cls: "llm-bridge-codex-section-head llm-bridge-codex-process-head" });
    const processTitle = processHead.createDiv({ cls: "llm-bridge-codex-section-title-row" });
    if (showChrome) {
      const processTitleLabel = loc === "zh" ? "运行详情" : "Run details";
      processTitle.createDiv({ cls: "llm-bridge-codex-section-title", text: processTitleLabel });
      const processMeta = processTitle.createDiv({ cls: "llm-bridge-codex-process-head-meta" });
      if (run.runHeader.elapsed) {
        processMeta.createEl("span", { cls: "llm-bridge-codex-process-head-meta-item", text: run.runHeader.elapsed });
      }
      if (processFeedBatches.length > 1) {
        processMeta.createEl("span", {
          cls: "llm-bridge-codex-process-head-meta-item",
          text: `${processFeedBatches.length} batches`,
        });
      }
      const processEventCount = processFeedItems.filter((item) => isCodexFeedEvent(item)).length;
      if (processEventCount > 0) {
        processMeta.createEl("span", {
          cls: "llm-bridge-codex-process-head-meta-item",
          text: `${processEventCount} ${processEventCount === 1 ? "step" : "steps"}`,
        });
      }
    } else if (presentation.kind !== "assistant-running") {
      // 普通完成态：每轮最多一个简短状态入口，例如「已处理 6m42s」
      const elapsed = (run.runHeader.elapsed || "").trim();
      const quietLabel = loc === "zh"
        ? (elapsed ? `已处理 ${elapsed}` : "已处理")
        : (elapsed ? `Processed ${elapsed}` : "Processed");
      processTitle.createDiv({
        cls: "llm-bridge-codex-section-title llm-bridge-codex-process-quiet-title",
        text: quietLabel,
      });
    } else {
      // 运行中：不显示「运行详情」标题，过程流直接铺开
      processHead.setAttribute("hidden", "");
    }
    const processToggle = processHead.createEl("span", {
      cls: "llm-bridge-codex-process-toggle",
      text: showFeed && presentation.kind !== "assistant-running" ? "▾" : "",
    });
    const processBody = process.createDiv({ cls: "llm-bridge-codex-process-body" });
    // 禁止自动折叠：过程体始终可见
    // 初渲与增量共用 reconcileCodexRunWaterfall（keyed feed + candidate 原地升级）
    if (processFeedItems.length > 0) {
      deps.reconcileCodexRunWaterfall(processBody, run, {
        streaming: presentation.kind === "assistant-running",
        developerMode,
      });
    }
    if (diagnosticsForDisplay.length > 0) renderCodexDiagnosticsDrawer(processBody, diagnosticsForDisplay, developerMode, deps);

    const canToggle = showFeed && presentation.kind !== "assistant-running" && !processHead.hasAttribute("hidden");
    if (canToggle) {
      processHead.addClass("is-collapsible");
      processHead.setAttribute("role", "button");
      processHead.setAttribute("tabindex", "0");
      processHead.setAttribute("aria-expanded", "true");
      const toggleProcessBody = () => {
        const hidden = processBody.hasAttribute("hidden");
        if (hidden) {
          processBody.removeAttribute("hidden");
          processHead.setAttribute("aria-expanded", "true");
          processToggle.textContent = "▾";
        } else {
          processBody.setAttribute("hidden", "");
          processHead.setAttribute("aria-expanded", "false");
          processToggle.textContent = "▸";
        }
      };
      processHead.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest?.("button")) return;
        toggleProcessBody();
      });
      processHead.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleProcessBody();
      });
    }
  } else {
    process.setAttribute("hidden", "");
  }

  // candidate 升级已并入 reconcileCodexRunWaterfall；无 feed 时仍兜底一次
  if (hasAnswer && processFeedItems.length === 0) {
    deps.upgradeCodexCandidateAnswerInFeed(body, run.finalAnswer, presentation.kind === "assistant-running");
  }
  if (hasDeveloperDebug) deps.renderAgentRunDebugDrawer(body, run.debugPanel!);

  // 普通模式始终隐藏 run header chrome
  if (!showChrome || !hasBodyContent || presentation.kind === "assistant-answer" || presentation.kind === "assistant-running") {
    head.removeClass("llm-bridge-timeline-head");
    head.addClass("llm-bridge-timeline-head-noclick");
    if (!showChrome || presentation.kind === "assistant-answer" || presentation.kind === "assistant-running") {
      head.setAttribute("hidden", "");
    }
  }

  return wrap;
}

/**
 * 过程区 append-only 局部更新：保留已渲染节点，只更新状态/文本并追加新 item。
 * 终态停止光效、弱化思考，不自动折叠、不清空。
 */
export function reconcileCodexRunView(
  wrap: HTMLElement,
  run: CodexRunViewModel,
  developerMode: boolean,
  presentation: { kind: string; showRunChrome: boolean },
  options: {
    streaming: boolean;
    messageStatus?: string;
    sourceModel?: { finalAnswerDisposition: string };
  },
  deps: CodexRunRenderDeps,
): void {
  const loc = resolveUiLocale() === "en" ? "en" : "zh";

  const showChrome = presentation.showRunChrome || developerMode;
  wrap.className = `llm-bridge-timeline-wrap llm-bridge-turn-view llm-bridge-codex-run-view is-${run.runHeader.statusKind}${developerMode ? " is-developer" : ""}${
    presentation.kind === "assistant-answer" ? " is-semantic-answer"
      : presentation.kind === "assistant-running" ? " is-semantic-running"
        : presentation.kind === "assistant-summary" ? " is-semantic-summary"
          : presentation.kind === "assistant-failed" || presentation.kind === "assistant-stopped" ? " is-semantic-failed"
            : ""
  }${showChrome ? " is-run-chrome" : " is-process-quiet"}`;
  if (options.sourceModel) {
    wrap.setAttribute("data-final-answer-disposition", options.sourceModel.finalAnswerDisposition);
  }

  // 终态：去掉运行光效
  if (options.messageStatus !== "running") {
    wrap.querySelectorAll(".llm-bridge-run-glow").forEach((el) => {
      el.classList.remove("llm-bridge-run-glow", "is-running");
    });
    wrap.querySelectorAll(".llm-bridge-codex-thinking-line.is-thinking-live").forEach((el) => {
      el.classList.remove("is-thinking-live");
      el.classList.add("is-thinking-done");
    });
  }

  const body = wrap.querySelector<HTMLElement>(".llm-bridge-codex-run-body");
  if (!body) return;

  // 授权门：复用固定 host，避免每次刷新遗留空 .approval-gates-host
  reconcileCodexApprovalGates(body, run.approvalGates, developerMode, deps);

  let process = body.querySelector<HTMLElement>(".llm-bridge-codex-process");
  if (!process) {
    process = body.createDiv({ cls: "llm-bridge-codex-process" });
  }
  process.removeAttribute("hidden");

  // 完成态过程头：更新「已处理 Xs」，不自动折叠
  if (presentation.kind !== "assistant-running" && run.feedItems.length > 0) {
    let processHead = process.querySelector<HTMLElement>(".llm-bridge-codex-process-head");
    if (!processHead) {
      processHead = process.createDiv({ cls: "llm-bridge-codex-section-head llm-bridge-codex-process-head" });
      const processTitle = processHead.createDiv({ cls: "llm-bridge-codex-section-title-row" });
      processTitle.createDiv({ cls: "llm-bridge-codex-section-title llm-bridge-codex-process-quiet-title", text: "" });
    }
    processHead.removeAttribute("hidden");
    const quietTitle = processHead.querySelector(".llm-bridge-codex-process-quiet-title");
    if (quietTitle) {
      const elapsed = (run.runHeader.elapsed || "").trim();
      quietTitle.textContent = loc === "zh"
        ? (elapsed ? `已处理 ${elapsed}` : "已处理")
        : (elapsed ? `Processed ${elapsed}` : "Processed");
    }
  }

  let processBody = process.querySelector<HTMLElement>(".llm-bridge-codex-process-body");
  if (!processBody) {
    processBody = process.createDiv({ cls: "llm-bridge-codex-process-body" });
  }
  // 禁止自动折叠：确保过程体可见
  processBody.removeAttribute("hidden");

  deps.reconcileCodexRunWaterfall(processBody, run, {
    streaming: options.streaming,
    developerMode,
  });
}

export function filterCodexDiagnosticsForDisplay(
  diagnostics: ReadonlyArray<CodexRunDiagnosticsGroup>,
  developerMode: boolean,
): ReadonlyArray<CodexRunDiagnosticsGroup> {
  if (developerMode) return diagnostics;
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

function renderCodexMetric(parent: HTMLElement, icon: string, value: string, title: string): void {
  const chip = parent.createEl("span", { cls: "llm-bridge-codex-run-metric", attr: { title } });
  const iconEl = chip.createEl("span", { cls: "llm-bridge-codex-run-metric-icon" });
  setIcon(iconEl, icon);
  chip.createEl("span", { cls: "llm-bridge-codex-run-metric-value", text: value });
}

function renderCodexCurrentActivity(parent: HTMLElement, run: CodexRunViewModel, deps: CodexRunRenderDeps): void {
  const activity = parent.createDiv({ cls: `llm-bridge-codex-current-activity is-${run.currentActivity.kind}` });
  const text = activity.createEl("span", { cls: "llm-bridge-codex-current-activity-text" });
  deps.renderRunStatusText(text, run.currentActivity.label, run.currentActivity.kind === "blocked" ? "blocked" : run.currentActivity.kind === "running" ? "running" : "completed");
}

/** 复用固定 approval-gates-host，避免增量刷新堆积空 host */
function ensureCodexApprovalGatesHost(body: HTMLElement): HTMLElement {
  let host = body.querySelector<HTMLElement>(":scope > .llm-bridge-codex-approval-gates-host");
  if (!host) {
    host = body.createDiv({ cls: "llm-bridge-codex-approval-gates-host" });
    const process = body.querySelector(":scope > .llm-bridge-codex-process");
    if (process) body.insertBefore(host, process);
  }
  return host;
}

function reconcileCodexApprovalGates(
  body: HTMLElement,
  gates: ReadonlyArray<CodexRunApprovalGate>,
  developerMode: boolean,
  deps: CodexRunRenderDeps,
): void {
  const host = ensureCodexApprovalGatesHost(body);
  // 清掉历史直接挂在 body 上的 gates（旧初渲路径）
  body.querySelectorAll(":scope > .llm-bridge-codex-approval-gates").forEach((el) => el.remove());
  host.empty();
  if (gates.length === 0) {
    host.setAttribute("hidden", "");
    return;
  }
  host.removeAttribute("hidden");
  renderCodexApprovalGates(host, gates, developerMode, deps);
}

function renderCodexApprovalGates(
  parent: HTMLElement,
  gates: ReadonlyArray<CodexRunApprovalGate>,
  developerMode: boolean,
  deps: CodexRunRenderDeps,
): void {
  const section = parent.createDiv({ cls: "llm-bridge-codex-approval-gates" });
  section.createDiv({ cls: "llm-bridge-codex-section-title", text: "Approvals" });
  for (const gate of gates) {
    const card = section.createDiv({ cls: `llm-bridge-codex-approval-gate is-risk-${gate.risk}` });
    card.setAttribute("data-request-id", gate.requestId);
    const head = card.createDiv({ cls: "llm-bridge-codex-approval-gate-head" });
    const icon = head.createEl("span", { cls: "llm-bridge-codex-approval-gate-icon" });
    setIcon(icon, gate.risk === "high" ? "shield-alert" : "shield");
    head.createEl("span", { cls: "llm-bridge-codex-approval-gate-action", text: gate.action, attr: { title: gate.action } });
    head.createEl("span", { cls: `llm-bridge-codex-approval-gate-risk is-${gate.risk}`, text: gate.risk === "high" ? "高风险" : gate.risk === "medium" ? "需确认" : "低风险" });
    if (gate.summary) card.createDiv({ cls: "llm-bridge-codex-approval-gate-summary", text: truncateText(gate.summary, 220), attr: { title: gate.summary } });
    if (gate.riskReason) card.createDiv({ cls: "llm-bridge-codex-approval-gate-reason", text: gate.riskReason });
    const actions = card.createDiv({ cls: "llm-bridge-codex-approval-gate-actions" });
    const addButton = (label: string, choice: PermissionChoice, cls: string) => {
      const button = actions.createEl("button", { cls: `llm-bridge-codex-approval-btn ${cls}`, text: label, attr: { type: "button", "data-decision": choice } });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deps.resolvePermissionRequests([gate.requestId], choice);
      });
    };
    addButton("允许一次", "allow_once", "is-allow-once");
    addButton("本会话允许", "allow_session", "is-allow-session");
    addButton("拒绝", "deny_once", "is-deny");
    deps.renderCodexSourceRef(card, gate.sourceRef, developerMode);
  }
}

export function renderCodexDiagnosticsDrawer(
  parent: HTMLElement,
  diagnostics: ReadonlyArray<CodexRunDiagnosticsGroup>,
  developerMode: boolean,
  deps: CodexRunRenderDeps,
): void {
  const total = diagnostics.reduce((sum, group) => sum + group.count, 0);
  const hasError = diagnostics.some((group) => group.severity === "error");
  const section = parent.createDiv({ cls: "llm-bridge-codex-diagnostics" });
  const head = section.createDiv({ cls: "llm-bridge-codex-diagnostics-head" });
  const toggle = head.createEl("span", { cls: "llm-bridge-codex-diagnostics-toggle", text: "▶" });
  const icon = head.createEl("span", { cls: "llm-bridge-codex-diagnostics-icon" });
  setIcon(icon, "triangle-alert");
  head.createEl("span", { cls: "llm-bridge-codex-diagnostics-summary", text: `${hasError ? "Issues" : "Warnings"} · ${total}` });
  const body = section.createDiv({ cls: "llm-bridge-codex-diagnostics-body", attr: { hidden: "" } });
  for (const diagnostic of diagnostics) {
    const item = body.createDiv({ cls: `llm-bridge-codex-diagnostic-item is-${diagnostic.severity}` });
    item.createDiv({ cls: "llm-bridge-codex-diagnostic-message", text: diagnostic.count > 1 ? `${diagnostic.message} (${diagnostic.count})` : diagnostic.message });
    if (developerMode) {
      deps.renderCodexCollapsedText(item, "raw", formatCodexRunValue(diagnostic.raw ?? diagnostic));
    }
  }
  head.addEventListener("click", () => {
    const hidden = body.hasAttribute("hidden");
    if (hidden) {
      body.removeAttribute("hidden");
      toggle.textContent = "▼";
    } else {
      body.setAttribute("hidden", "");
      toggle.textContent = "▶";
    }
  });
}
