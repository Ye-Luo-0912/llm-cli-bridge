// LLM CLI Bridge — 语义消息展示层
// 单一真相源：决定对话气泡展示什么，避免 renderMessage / renderCodexRunView 各自重复状态。

import type { ChatMessage, RunStatus } from "./types";
import type { AssistantTurnView } from "./runtime/core/types";
import type { CodexRunViewModel } from "./runtime/core/codexRunViewModel";

export type MessagePresentationKind =
  | "user"
  | "assistant-running"
  | "assistant-answer"
  | "assistant-summary"
  | "assistant-failed"
  | "assistant-stopped";

/** 普通模式 copy / retry / fork；copy-md 已废弃（与 copy 同为原始 Markdown） */
export type MessageActionId = "copy" | "retry" | "fork";

export interface MessagePresentation {
  readonly kind: MessagePresentationKind;
  /** 普通完成态不显示角色名 */
  readonly showRole: boolean;
  readonly roleLabel: string;
  /** 运行中单行状态；完成态为 null */
  readonly statusLine: string | null;
  readonly showTime: boolean;
  /** 完成态时间淡化 */
  readonly timeFaded: boolean;
  /** 是否渲染 Answer / ANSWER 标题 */
  readonly showAnswerTitle: boolean;
  /** 是否渲染 runtime / provider 徽章 */
  readonly showProviderBadge: boolean;
  /** 是否渲染「已完成 / Answered」状态徽章 */
  readonly showCompletedBadge: boolean;
  /** 有文件/命令/授权时的一行摘要（普通模式已改由过程流承载，通常为 null） */
  readonly resultSummary: string | null;
  /**
   * @deprecated 使用 showProcessFeed；保留以兼容旧调用点。
   * 含义：是否展示过程内容（不等于展示运行标题/开发者元信息）。
   */
  readonly showProcessDetails: boolean;
  /** 是否渲染现有 process feed（工具组/文件/授权等） */
  readonly showProcessFeed: boolean;
  /** 是否渲染 run header / provider / metrics /「运行详情」等开发者向 chrome */
  readonly showRunChrome: boolean;
  /** 失败/停止错误摘要 */
  readonly errorSummary: string | null;
  readonly actions: ReadonlyArray<MessageActionId>;
}

export interface PresentationOptions {
  readonly developerMode: boolean;
  readonly locale: "zh" | "en";
  readonly runtimeLabel?: string;
}

const OCCUPANCY_CHIP_THRESHOLD = 0.35;

/**
 * V18-FORK: 仅 Codex app-server 系列 provider 且存在 nativeTurnId 时才支持分叉。
 * 旧会话无 nativeTurnId（仅本地 turnId）时隐藏 fork 按钮。
 */
function forkableActions(msg: ChatMessage): ReadonlyArray<MessageActionId> {
  const turn = msg.assistantTurnView;
  const isCodex = turn?.providerId === "codex-managed-app-server" || turn?.providerId === "codex-app-server";
  const hasNativeTurnId = !!(turn?.nativeTurnId);
  return isCodex && hasNativeTurnId ? ["copy", "fork"] : ["copy"];
}

export function shouldShowContextOccupancyChip(usedRatio: number): boolean {
  return usedRatio >= OCCUPANCY_CHIP_THRESHOLD;
}

function basePresentation(
  partial: Omit<MessagePresentation, "showProcessDetails"> & { showProcessFeed: boolean; showRunChrome: boolean },
): MessagePresentation {
  return {
    ...partial,
    // 兼容旧字段：过程内容可见性跟 showProcessFeed
    showProcessDetails: partial.showProcessFeed,
  };
}

export function buildMessagePresentation(
  msg: ChatMessage,
  options: PresentationOptions,
): MessagePresentation {
  if (msg.role === "user") {
    return basePresentation({
      kind: "user",
      showRole: false,
      roleLabel: options.locale === "zh" ? "你" : "You",
      statusLine: null,
      showTime: true,
      timeFaded: true,
      showAnswerTitle: false,
      showProviderBadge: false,
      showCompletedBadge: false,
      resultSummary: null,
      showProcessFeed: false,
      showRunChrome: false,
      errorSummary: null,
      actions: [],
    });
  }

  if (options.developerMode) {
    return buildDeveloperPresentation(msg, options);
  }

  if (msg.status === "running") {
    return basePresentation({
      kind: "assistant-running",
      showRole: false,
      roleLabel: "",
      statusLine: deriveRunningStatusLine(msg, options.locale),
      showTime: false,
      timeFaded: false,
      showAnswerTitle: false,
      showProviderBadge: false,
      showCompletedBadge: false,
      resultSummary: null,
      // 运行中显示过程流，但不显示 run chrome
      showProcessFeed: true,
      showRunChrome: false,
      errorSummary: null,
      actions: [],
    });
  }

  if (msg.status === "failed" || msg.status === "stopped") {
    const failed = msg.status === "failed";
    return basePresentation({
      kind: failed ? "assistant-failed" : "assistant-stopped",
      showRole: false,
      roleLabel: "",
      statusLine: null,
      showTime: true,
      timeFaded: true,
      showAnswerTitle: false,
      showProviderBadge: false,
      showCompletedBadge: false,
      resultSummary: null,
      showProcessFeed: true,
      showRunChrome: false,
      errorSummary: deriveErrorSummary(msg, options.locale, failed),
      actions: ["retry", "copy"],
    });
  }

  const counts = deriveResultCounts(msg);
  const hasOps = counts.files > 0 || counts.commands > 0 || counts.approvals > 0;
  const hasTurnProcess = !!(msg.assistantTurnView && (
    (msg.assistantTurnView.thoughts?.length ?? 0) > 0
    || (msg.assistantTurnView.tools?.length ?? 0) > 0
    || (msg.assistantTurnView.fileChanges?.length ?? 0) > 0
    || (msg.assistantTurnView.approvals?.length ?? 0) > 0
    || (msg.assistantTurnView.turnTimeline?.length ?? 0) > 0
  ));
  if (hasOps || hasTurnProcess) {
    return basePresentation({
      kind: "assistant-summary",
      showRole: false,
      roleLabel: "",
      statusLine: null,
      showTime: true,
      timeFaded: true,
      showAnswerTitle: false,
      showProviderBadge: false,
      showCompletedBadge: false,
      // 过程由 feed 承载，不再用外层「▸ 编辑了 N 个文件」按钮藏起详情
      resultSummary: null,
      showProcessFeed: true,
      showRunChrome: false,
      errorSummary: null,
      actions: forkableActions(msg),
    });
  }

  return basePresentation({
    kind: "assistant-answer",
    showRole: false,
    roleLabel: "",
    statusLine: null,
    showTime: true,
    timeFaded: true,
    showAnswerTitle: false,
    showProviderBadge: false,
    showCompletedBadge: false,
    resultSummary: null,
    showProcessFeed: false,
    showRunChrome: false,
    errorSummary: null,
    actions: forkableActions(msg),
  });
}

/** 运行状态文案：具体动作；真实 reasoning → 正在思考，图片 → 正在分析图片 */
export function mapRunningActivityToStatusLine(label: string, locale: "zh" | "en"): string {
  const raw = (label || "").trim();
  const lower = raw.toLowerCase();
  if (/needs approval|waiting approval|需要.*确认|等待.*确认/.test(lower) || /needs input|waiting input|需要输入|waiting for user/.test(lower)) {
    return locale === "zh" ? "等待确认" : "Waiting for confirmation";
  }
  if (/compact|压缩|context.*compress|compressing context/.test(lower)) {
    return locale === "zh" ? "正在压缩上下文" : "Compressing context";
  }
  if (/queuing follow-up|follow-up|追加|queued/.test(lower)) {
    return locale === "zh" ? "正在追加" : "Queuing follow-up";
  }
  if (/imageview|viewing image|analyzing image|分析图片|查看图片|图片/.test(lower) || /\bimage\b/.test(lower)) {
    return locale === "zh" ? "正在分析图片" : "Analyzing image";
  }
  if (/search|grep|find|glob|搜索/.test(lower)) {
    return locale === "zh" ? "正在搜索" : "Searching";
  }
  if (/read|reading|读取|查看/.test(lower)) {
    return locale === "zh" ? "正在读取文件" : "Reading files";
  }
  if (/writ|edit|patch|apply|修改|写入|编辑/.test(lower)) {
    return locale === "zh" ? "正在修改文件" : "Editing files";
  }
  if (/command|shell|bash|terminal|running command|执行|命令|check|test/.test(lower)) {
    return locale === "zh" ? "正在执行命令" : "Running command";
  }
  if (/thinking|推理|reasoning|thought/.test(lower)) {
    return locale === "zh" ? "正在思考" : "Thinking";
  }
  if (/prepar|准备|start|启动|context|上下文|init/.test(lower) || !raw) {
    return locale === "zh" ? "正在准备" : "Preparing";
  }
  // 未知但非空：尽量保留可读原文的短形式，中文环境仍给具体动作兜底
  return locale === "zh" ? "正在准备" : (raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
}

export function buildPresentationFromCodexRun(
  run: CodexRunViewModel,
  options: PresentationOptions,
): MessagePresentation {
  const status = mapCodexStatus(run.runHeader.statusKind);
  if (options.developerMode) {
    return buildMessagePresentation({
      id: "codex",
      role: "assistant",
      content: run.finalAnswer || "",
      status,
      stderr: "",
      log: "",
      generatedFiles: [],
      exitCode: null,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    }, options);
  }

  if (status === "running") {
    // 首段回答 delta 到来后结束状态光效，进入正文流式
    const answerStarted = !!(run.finalAnswer || "").trim();
    let activityLabel = run.currentActivity?.label || "";
    // 真实 reasoning 文本到来前，不把空 thinking 标成「正在思考」
    if (/thinking|reason/i.test(activityLabel)) {
      // 只有真正的 reasoning 事件才算 Thinking；中间 assistant 过程说明不冒充
      const hasReasoning = (run.feedItems ?? []).some((item) =>
        item.kind === "thinking"
        && ((item.summary || item.detail || "").trim().length > 0),
      );
      if (!hasReasoning) activityLabel = "Preparing";
    }
    return basePresentation({
      kind: "assistant-running",
      showRole: false,
      roleLabel: "",
      statusLine: answerStarted
        ? null
        : mapRunningActivityToStatusLine(activityLabel, options.locale),
      showTime: false,
      timeFaded: false,
      showAnswerTitle: false,
      showProviderBadge: false,
      showCompletedBadge: false,
      resultSummary: null,
      showProcessFeed: true,
      showRunChrome: false,
      errorSummary: null,
      actions: [],
    });
  }

  if (status === "failed" || status === "stopped") {
    const failed = status === "failed";
    return basePresentation({
      kind: failed ? "assistant-failed" : "assistant-stopped",
      showRole: false,
      roleLabel: "",
      statusLine: null,
      showTime: true,
      timeFaded: true,
      showAnswerTitle: false,
      showProviderBadge: false,
      showCompletedBadge: false,
      resultSummary: null,
      showProcessFeed: true,
      showRunChrome: false,
      errorSummary: failed
        ? (options.locale === "zh" ? "运行失败" : "Run failed")
        : (options.locale === "zh" ? "已停止" : "Stopped"),
      actions: ["retry", "copy"],
    });
  }

  const counts = {
    files: run.runHeader.fileChangeCount || 0,
    commands: run.runHeader.commandCount || 0,
    approvals: run.runHeader.approvalCount || 0,
  };
  const hasOps = counts.files > 0 || counts.commands > 0 || counts.approvals > 0
    || (run.feedItems?.some((item) =>
      item.kind === "command"
      || item.kind === "file"
      || item.kind === "mcp"
      || item.kind === "dynamic"
      || item.kind === "approval"
      || item.kind === "thinking"
      || item.kind === "assistant"
      || item.kind === "user-input"
      || !!item.change
    ) ?? false);
  // 运行中已展示的过程节点完成后必须保留；有过程内容时始终 showProcessFeed
  if (hasOps) {
    return basePresentation({
      kind: "assistant-summary",
      showRole: false,
      roleLabel: "",
      statusLine: null,
      showTime: true,
      timeFaded: true,
      showAnswerTitle: false,
      showProviderBadge: false,
      showCompletedBadge: false,
      resultSummary: null,
      showProcessFeed: true,
      showRunChrome: false,
      errorSummary: null,
      actions: ["copy", "fork"],
    });
  }

  return basePresentation({
    kind: "assistant-answer",
    showRole: false,
    roleLabel: "",
    statusLine: null,
    showTime: true,
    timeFaded: true,
    showAnswerTitle: false,
    showProviderBadge: false,
    showCompletedBadge: false,
    resultSummary: null,
    // 纯问答无过程节点：可不展示过程区；一旦有 feed 已在上方 hasOps 分支保留
    showProcessFeed: false,
    showRunChrome: false,
    errorSummary: null,
    actions: ["copy", "fork"],
  });
}

function buildDeveloperPresentation(msg: ChatMessage, options: PresentationOptions): MessagePresentation {
  return basePresentation({
    kind: msg.status === "running"
      ? "assistant-running"
      : msg.status === "failed"
        ? "assistant-failed"
        : msg.status === "stopped"
          ? "assistant-stopped"
          : "assistant-summary",
    showRole: true,
    roleLabel: options.runtimeLabel || "Assistant",
    statusLine: msg.status === "running" ? deriveRunningStatusLine(msg, options.locale) : null,
    showTime: true,
    timeFaded: false,
    showAnswerTitle: true,
    showProviderBadge: true,
    showCompletedBadge: true,
    resultSummary: null,
    showProcessFeed: true,
    showRunChrome: true,
    errorSummary: msg.status === "failed" || msg.status === "stopped"
      ? deriveErrorSummary(msg, options.locale, msg.status === "failed")
      : null,
    actions: msg.status === "running"
      ? []
      : msg.status === "failed" || msg.status === "stopped"
        ? ["retry", "copy"]
        : forkableActions(msg),
  });
}

function deriveRunningStatusLine(msg: ChatMessage, locale: "zh" | "en"): string | null {
  const turn = msg.assistantTurnView;
  // 首段回答已到：结束光效状态行，正文自行流式
  if ((msg.content || turn?.finalAnswer || "").trim()) return null;

  const timeline = turn?.turnTimeline ?? [];
  const flat: Array<(typeof timeline)[number]> = [];
  const visit = (nodes: typeof timeline) => {
    for (const n of nodes) {
      flat.push(n);
      if (n.children?.length) visit(n.children);
    }
  };
  visit(timeline);
  const activeNode = [...flat].reverse().find((n) => n.status === "running" || n.status === "blocked");
  if (activeNode?.kind === "imageView") {
    return mapRunningActivityToStatusLine("Viewing image", locale);
  }
  if (activeNode?.kind === "reasoning" || activeNode?.kind === "plan") {
    const hasThought = (turn?.thoughts ?? []).some((t) => (t.text || "").trim().length > 0)
      || !!(activeNode.text || activeNode.summary || "").trim();
    if (hasThought) return mapRunningActivityToStatusLine("Thinking", locale);
  }

  const activity = turn
    ? (turn as AssistantTurnView & { currentActivity?: string }).currentActivity
    : undefined;
  if (typeof activity === "string" && activity.trim()) {
    return mapRunningActivityToStatusLine(activity, locale);
  }
  const approvals = turn?.approvals?.some((a) => a.pending);
  if (approvals) return locale === "zh" ? "等待确认" : "Waiting for confirmation";
  // 无 partial 流式时保持准备态，不伪造打字机
  return locale === "zh" ? "正在准备" : "Preparing";
}

function deriveErrorSummary(msg: ChatMessage, locale: "zh" | "en", failed: boolean): string {
  const stderr = (msg.stderr || "").trim();
  if (stderr) return stderr.split(/\r?\n/).find((l) => l.trim())?.slice(0, 240) || stderr.slice(0, 240);
  if (failed) return locale === "zh" ? "运行失败" : "Run failed";
  return locale === "zh" ? "已停止" : "Stopped";
}

function deriveResultCounts(msg: ChatMessage): { files: number; commands: number; approvals: number } {
  const turn = msg.assistantTurnView;
  const files = Math.max(
    msg.generatedFiles?.length ?? 0,
    turn?.fileChanges?.length ?? 0,
  );
  const commands = turn?.tools?.length
    ?? (turn as { processSteps?: unknown[] } | undefined)?.processSteps?.length
    ?? 0;
  const approvals = turn?.approvals?.length ?? 0;
  return { files, commands, approvals };
}

function mapCodexStatus(kind: string): RunStatus {
  if (kind === "running" || kind === "blocked") return "running";
  if (kind === "failed") return "failed";
  if (kind === "stopped") return "stopped";
  return "completed";
}

export const NAV_TAB_LABELS = {
  chat: { zh: "对话", en: "Chat" },
  files: { zh: "上下文", en: "Context" },
  skills: { zh: "能力", en: "Skills" },
  history: { zh: "历史", en: "History" },
} as const;
