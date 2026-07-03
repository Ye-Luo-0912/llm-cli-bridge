// LLM CLI Bridge — AgentRunDisplayModel (P3 Agent UX 主链路收敛)
//
// 纯数据模型：从 AssistantTurnView 构造，不依赖 UI/View/DOM。
// view.ts 消费端通过 renderAgentRunDisplayModel/renderAgentRunCard 渲染。
//
// 设计原则：
// 1. 输入只接受 AssistantTurnView 和少量 options，不直接依赖 NormalizedRuntimeEvent / WorkflowEvent。
// 2. 输出按普通用户态信息架构分层：header/finalAnswer/currentActivity/timelineCards/approvalCards/
//    fileChangeCards/diagnosticCards/debugView。
// 3. developer mode 信息汇总到 debugView，不散落在业务字段。

import type { AssistantTurnView, ApprovalResponse } from "./types";
import type { AttachmentPlan, EffectiveRunPlan } from "../../types";

// ---------- Card Types ----------

export type AgentRunCardKind =
  | "thinking"
  | "tool-call"
  | "file-change"
  | "approval"
  | "warning"
  | "error"
  | "final-answer"
  | "debug-raw-event";

export type AgentRunCardStatus = "running" | "completed" | "failed" | "pending" | "idle";

export interface AgentRunCardBase {
  id: string;
  kind: AgentRunCardKind;
  title: string;
  status: AgentRunCardStatus;
  summary: string;
  detail?: string;
  timestamp?: string;
  /** 默认展开（running/error 卡片默认展开） */
  defaultExpanded?: boolean;
}

export interface ThinkingCard extends AgentRunCardBase {
  kind: "thinking";
  text: string;
  tokens?: number;
  meta?: string;
}

export interface ToolCallCard extends AgentRunCardBase {
  kind: "tool-call";
  toolName: string;
  toolInput: string;
  durationMs?: number;
  output?: string;
  isError: boolean;
  progress: ReadonlyArray<{ label: string; detail?: string; timestamp: string }>;
}

export interface FileChangeCard extends AgentRunCardBase {
  kind: "file-change";
  action: "create" | "modify" | "delete";
  path: string;
}

export interface ApprovalCard extends AgentRunCardBase {
  kind: "approval";
  toolName: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  riskReason?: string;
  inputSummary?: string;
  resolution?: ApprovalResponse;
  resolutionSource?: "user" | "session_allow" | "session_deny" | "mode";
  pending: boolean;
}

export interface WarningCard extends AgentRunCardBase {
  kind: "warning";
  message: string;
}

export interface ErrorCard extends AgentRunCardBase {
  kind: "error";
  message: string;
}

export interface FinalAnswerCard extends AgentRunCardBase {
  kind: "final-answer";
  text: string;
}

export interface DebugRawEventCard extends AgentRunCardBase {
  kind: "debug-raw-event";
  rawEvent: unknown;
}

export type AgentRunCard =
  | ThinkingCard
  | ToolCallCard
  | FileChangeCard
  | ApprovalCard
  | WarningCard
  | ErrorCard
  | FinalAnswerCard
  | DebugRawEventCard;

// ---------- Display Model ----------

export interface AgentRunDebugView {
  commandPreview?: ReadonlyArray<{ label: string; value: string }>;
  effectiveRunPlan?: EffectiveRunPlan;
  providerThreadId?: string;
  providerSessionId?: string;
  sessionResumed?: boolean;
  attachmentPlan?: AttachmentPlan;
  rawProviderEvents: ReadonlyArray<unknown>;
  /** legacy: Workflow Trace / SDK events（仅 developer mode 展示） */
  workflowTrace?: ReadonlyArray<{ stage: string; timestamp: string; detail: string; status: string }>;
  sdkEvents?: ReadonlyArray<unknown>;
}

export interface AgentRunDisplayModel {
  /** 摘要头：如 "过程 · 运行中 · 2 tools · 3 file changes · 30s" */
  header: string;
  /** 最终答案（普通用户态主内容） */
  finalAnswer: string;
  /** 当前活动摘要（运行中时显示，如 "运行中: Read file..."） */
  currentActivity: string;
  /** 时间线卡片（thoughts / tools / resolved approvals / errors） */
  timelineCards: AgentRunCard[];
  /** 待审批卡片（pending approvals，驱动 pending panel） */
  approvalCards: ApprovalCard[];
  /** 文件变更卡片（单独区域展示） */
  fileChangeCards: FileChangeCard[];
  /** 诊断卡片（warnings） */
  diagnosticCards: WarningCard[];
  /** developer mode 调试信息 */
  debugView?: AgentRunDebugView;
}

// ---------- Build Options ----------

export interface BuildDisplayModelOptions {
  durationMs?: number;
  isRunning?: boolean;
  statusLabel?: string;
}

// ---------- Builder ----------

const EMPTY_CARDS: readonly AgentRunCard[] = [];

/**
 * 从 AssistantTurnView 构建 AgentRunDisplayModel。
 *
 * 纯数据转换，不涉及任何 UI/DOM 操作。
 * - timelineCards: thoughts + tools + resolved approvals + errors
 * - approvalCards: pending approvals
 * - fileChangeCards: file changes（与 timeline 分离便于 UI 单独展示）
 * - diagnosticCards: warnings
 * - debugView: developer mode 信息（仅设选项开启时填充）
 */
export function buildAgentRunDisplayModel(
  turnView: AssistantTurnView,
  options: BuildDisplayModelOptions & { developerMode?: boolean; debug?: AgentRunDebugView },
): AgentRunDisplayModel {
  const isRunning = options.isRunning ?? turnView.status === "running";
  const toolCount = turnView.tools.length;
  const fileChangeCount = turnView.fileChanges.length;
  const thoughtCount = turnView.thoughts.length;
  const resolvedApprovalCount = turnView.approvals.filter((a) => !a.pending).length;
  const warningCount = turnView.warnings.length;
  const errorCount = turnView.errors.length;
  const dur = options.durationMs ?? turnView.durationMs;

  // --- header ---
  const parts: string[] = ["过程"];
  parts.push(options.statusLabel ?? (isRunning ? "运行中" : turnView.status === "completed" ? "完成" : turnView.status === "failed" ? "失败" : turnView.status));
  if (thoughtCount > 0) parts.push(`${thoughtCount} thinking`);
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? "s" : ""}`);
  if (fileChangeCount > 0) parts.push(`${fileChangeCount} file change${fileChangeCount > 1 ? "s" : ""}`);
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
  if (dur != null && dur > 0) {
    const secs = Math.round(dur / 1000);
    if (secs > 0) parts.push(`${secs}s`);
  }
  const header = parts.join(" · ");

  // --- currentActivity ---
  let currentActivity = "";
  if (isRunning) {
    // Find first running tool
    const runningTool = turnView.tools.find((t) => t.status === "running");
    if (runningTool) {
      currentActivity = `运行中: ${runningTool.toolName}`;
      if (runningTool.toolInput) {
        const truncated = runningTool.toolInput.length > 60
          ? runningTool.toolInput.slice(0, 60) + "..."
          : runningTool.toolInput;
        currentActivity += ` ${truncated}`;
      }
    } else if (turnView.thoughts.length > 0) {
      currentActivity = "思考中...";
    } else if (turnView.process.length > 0) {
      const last = turnView.process[turnView.process.length - 1];
      currentActivity = last.label;
      if (last.detail) currentActivity += `: ${last.detail}`;
    } else {
      currentActivity = "运行中...";
    }
  }

  // --- timelineCards ---
  const timelineCards: AgentRunCard[] = [];

  // thoughts → ThinkingCard
  for (let i = 0; i < turnView.thoughts.length; i++) {
    const t = turnView.thoughts[i];
    timelineCards.push({
      id: `thought-${i}`,
      kind: "thinking",
      title: "思考",
      status: "completed",
      summary: t.meta ?? (t.text ? t.text.slice(0, 80) : "思考中"),
      detail: t.text,
      timestamp: t.timestamp,
      text: t.text,
      tokens: t.tokens,
      meta: t.meta,
      defaultExpanded: false,
    });
  }

  // tools → ToolCallCard
  const callIdCounter = new Map<string, number>();
  for (const tool of turnView.tools) {
    const count = callIdCounter.get(tool.callId) ?? 0;
    callIdCounter.set(tool.callId, count + 1);
    const isToolError = tool.status === "error";
    timelineCards.push({
      id: `tool-${tool.callId}${count > 0 ? `-${count}` : ""}`,
      kind: "tool-call",
      title: tool.toolName,
      status: tool.status === "running" ? "running" : isToolError ? "failed" : "completed",
      summary: tool.toolInput ? `${tool.toolName}: ${tool.toolInput.slice(0, 80)}` : tool.toolName,
      detail: tool.output,
      timestamp: tool.startTime,
      defaultExpanded: tool.status === "running" || isToolError,
      toolName: tool.toolName,
      toolInput: tool.toolInput,
      durationMs: tool.durationMs,
      output: tool.output,
      isError: isToolError,
      progress: tool.progress,
    });
  }

  // resolved approvals → ApprovalCard（timeline）
  for (const ap of turnView.approvals) {
    if (ap.pending) continue;
    timelineCards.push({
      id: `approval-resolved-${ap.requestId}`,
      kind: "approval",
      title: `权限: ${ap.toolName}`,
      status: "completed",
      summary: buildApprovalResolutionSummary(ap.resolution, ap.resolutionSource),
      detail: ap.inputSummary,
      timestamp: undefined,
      toolName: ap.toolName,
      description: ap.description,
      riskLevel: ap.riskLevel,
      riskReason: ap.riskReason,
      inputSummary: ap.inputSummary,
      resolution: ap.resolution,
      resolutionSource: ap.resolutionSource,
      pending: false,
      defaultExpanded: false,
    });
  }

  // errors → ErrorCard
  for (let i = 0; i < turnView.errors.length; i++) {
    timelineCards.push({
      id: `error-${i}`,
      kind: "error",
      title: "错误",
      status: "failed",
      summary: turnView.errors[i].slice(0, 120),
      detail: turnView.errors[i],
      timestamp: undefined,
      message: turnView.errors[i],
      defaultExpanded: true,
    });
  }

  // --- approvalCards (pending) ---
  const approvalCards: ApprovalCard[] = [];
  for (const ap of turnView.approvals) {
    if (!ap.pending) continue;
    approvalCards.push({
      id: `approval-pending-${ap.requestId}`,
      kind: "approval",
      title: `权限请求: ${ap.toolName}`,
      status: "pending",
      summary: ap.description,
      detail: ap.inputSummary,
      timestamp: undefined,
      toolName: ap.toolName,
      description: ap.description,
      riskLevel: ap.riskLevel,
      riskReason: ap.riskReason,
      inputSummary: ap.inputSummary,
      resolution: undefined,
      resolutionSource: undefined,
      pending: true,
    });
  }

  // --- fileChangeCards ---
  const fileChangeCards: FileChangeCard[] = [];
  for (let i = 0; i < turnView.fileChanges.length; i++) {
    const fc = turnView.fileChanges[i];
    const actionLabel = fc.action === "create" ? "新建" : fc.action === "modify" ? "修改" : "删除";
    fileChangeCards.push({
      id: `filechange-${i}`,
      kind: "file-change",
      title: `${actionLabel}文件`,
      status: "completed",
      summary: fc.path,
      detail: fc.path,
      timestamp: fc.timestamp,
      action: fc.action,
      path: fc.path,
    });
  }

  // --- diagnosticCards (warnings) ---
  const diagnosticCards: WarningCard[] = [];
  for (let i = 0; i < turnView.warnings.length; i++) {
    diagnosticCards.push({
      id: `warning-${i}`,
      kind: "warning",
      title: "警告",
      status: "completed",
      summary: turnView.warnings[i].slice(0, 120),
      detail: turnView.warnings[i],
      timestamp: undefined,
      message: turnView.warnings[i],
    });
  }

  return {
    header,
    finalAnswer: turnView.finalAnswer,
    currentActivity,
    timelineCards,
    approvalCards,
    fileChangeCards,
    diagnosticCards,
    debugView: options.developerMode ? options.debug : undefined,
  };
}

/** 构建审批决议文案（accept/acceptForSession/decline/cancel → 中文） */
function buildApprovalResolutionSummary(
  resolution: ApprovalResponse | undefined,
  source: string | undefined,
): string {
  const resolutionLabel = resolution?.type === "accept" ? "允许一次"
    : resolution?.type === "acceptForSession" ? "本会话允许"
    : resolution?.type === "decline" ? "已拒绝"
    : "已取消";
  const sourceLabel = source === "session_allow" ? "（会话允许）"
    : source === "session_deny" ? "（会话拒绝）"
    : source === "mode" ? "（模式自动）"
    : "";
  return `${resolutionLabel}${sourceLabel}`;
}

/** 工具名 → 图标与分类（纯数据映射，与 view.ts 一致） */
export function getToolIconCategory(toolName: string): { icon: string; category: string } {
  const name = toolName.toLowerCase();
  if (name.includes("read") || name.includes("list") || name.includes("search") || name.includes("grep") || name.includes("stat") || name.includes("glob")) {
    return { icon: "📖", category: "read" };
  }
  if (name.includes("write") || name.includes("create") || name.includes("edit") || name.includes("replace") || name.includes("insert") || name.includes("patch")) {
    return { icon: "✏️", category: "write" };
  }
  if (name.includes("delete") || name.includes("remove") || name.includes("rm")) {
    return { icon: "🗑️", category: "delete" };
  }
  if (name.includes("bash") || name.includes("command") || name.includes("execute") || name.includes("run") || name.includes("shell") || name.includes("terminal")) {
    return { icon: ">_", category: "command" };
  }
  if (name.includes("think") || name.includes("reason")) {
    return { icon: "💭", category: "think" };
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("curl") || name.includes("http") || name.includes("browse")) {
    return { icon: "🌐", category: "web" };
  }
  if (name.includes("notify") || name.includes("notice") || name.includes("toast")) {
    return { icon: "🔔", category: "notify" };
  }
  return { icon: "⚙️", category: "tool" };
}

export { EMPTY_CARDS };