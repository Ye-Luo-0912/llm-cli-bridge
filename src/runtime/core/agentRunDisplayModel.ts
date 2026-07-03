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
import { redactSecrets } from "../../workflowEvent";

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
  /** P4-D: 普通用户态简洁标签（如 "Read AGENTS.md"），不含 raw JSON */
  label: string;
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
 * Map tool name to user-friendly activity label.
 * Read/Write/Bash etc. → Reading files / Editing files / Running checks
 */
export function toolToActivity(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (/read|getfile|file_read|view|cat|grep|glob|search|ls/.test(lower)) return "Reading files";
  if (/write|edit|str_replace|patch|create_file|update_file|insert|delete_file/.test(lower)) return "Editing files";
  if (/bash|execute|run|command|shell|check|test|lint/.test(lower)) return "Running checks";
  return toolName;
}

/**
 * P4-D: 工具调用 → 普通用户态简洁标签（不含 raw JSON input）。
 * - Read {"file_path":"AGENTS.md"} → "Read AGENTS.md"
 * - Write {"file_path":"TASKS_Summary.md"} → "Write TASKS_Summary.md"
 * - Create {"file_path":"x.md"} → "Created x.md"
 * - Bash {"command":"ls"} → "Run command"（不暴露 command 内容）
 * - 其他 → 原始 toolName
 */
export function toolDisplayLabel(toolName: string, toolInput?: string): string {
  const lower = toolName.toLowerCase();
  const extractPath = (input?: string): string | null => {
    if (!input) return null;
    try {
      const parsed = JSON.parse(input);
      const p = parsed.file_path ?? parsed.notebook_path ?? parsed.path ?? parsed.pattern;
      if (typeof p === "string" && p.length > 0) {
        // basename only, avoid leaking full path in normal user UI
        const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
        return parts[parts.length - 1] ?? p;
      }
    } catch {
      // 非 JSON：如果本身像路径，取 basename
      if (/[/\\]/.test(input)) {
        const parts = input.replace(/\\/g, "/").split("/").filter(Boolean);
        return parts[parts.length - 1] ?? null;
      }
    }
    return null;
  };
  if (/^read|getfile|file_read|view$/.test(lower) || lower === "read") {
    const p = extractPath(toolInput);
    return p ? `Read ${p}` : "Read";
  }
  if (/write|edit|str_replace|patch|update_file|insert/.test(lower)) {
    const p = extractPath(toolInput);
    return p ? `Write ${p}` : "Write";
  }
  if (/create_file/.test(lower)) {
    const p = extractPath(toolInput);
    return p ? `Created ${p}` : "Created";
  }
  if (/delete_file|remove/.test(lower)) {
    const p = extractPath(toolInput);
    return p ? `Deleted ${p}` : "Deleted";
  }
  if (/bash|execute|run|command|shell/.test(lower)) {
    // 不暴露 command 内容，避免噪音
    return "Run command";
  }
  if (/grep|glob|search|ls|list/.test(lower)) {
    return "Search";
  }
  return toolName;
}

/**
 * P5: 脱敏 debugView 中的敏感信息（API key / token / Bearer / password）。
 *
 * debugView 是 developer mode 唯一调试入口，其中 rawProviderEvents / commandPreview /
 * effectiveRunPlan / attachmentPlan 可能包含敏感信息（命令行 env、API key、文件路径等）。
 * 本函数对字符串字段走 redactSecrets，对对象字段走 JSON.stringify → redactSecrets → JSON.parse。
 * providerThreadId / providerSessionId / sessionResumed 敏感度低，保留原值。
 */
export function redactDebugView(debug: AgentRunDebugView): AgentRunDebugView {
  const redactObject = <T>(obj: T): T => {
    try {
      return JSON.parse(redactSecrets(JSON.stringify(obj))) as T;
    } catch {
      return obj;
    }
  };
  return {
    ...debug,
    commandPreview: debug.commandPreview?.map((row) => ({ ...row, value: redactSecrets(row.value) })),
    effectiveRunPlan: debug.effectiveRunPlan ? redactObject(debug.effectiveRunPlan) : debug.effectiveRunPlan,
    attachmentPlan: debug.attachmentPlan ? redactObject(debug.attachmentPlan) : debug.attachmentPlan,
    rawProviderEvents: debug.rawProviderEvents.map((e) => redactObject(e)),
    workflowTrace: debug.workflowTrace?.map((t) => ({ ...t, detail: redactSecrets(t.detail) })),
    sdkEvents: debug.sdkEvents?.map((e) => redactObject(e)),
  };
}

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
  const durSecs = dur != null && dur > 0 ? Math.round(dur / 1000) : 0;
  const pendingApproval = turnView.approvals.some((a) => a.pending);
  const headerParts: string[] = [];

  if (isRunning) {
    // Running: show activity label + elapsed time
    if (pendingApproval) {
      headerParts.push("Waiting approval");
    } else {
      const runningTool = turnView.tools.find((t) => t.status === "running");
      headerParts.push(runningTool ? toolToActivity(runningTool.toolName) : "Thinking");
    }
    if (durSecs > 0) headerParts.push(`${durSecs}s`);
  } else if (turnView.status === "completed") {
    // P4-D: Completed 轻量摘要 —— 仅显示高价值信息（文件变化、耗时）。
    // 无文件变化时：有耗时显示 "Xs"，无耗时则 header 留空（不显示 "Done"）。
    const summaryParts: string[] = [];
    if (fileChangeCount > 0) summaryParts.push(`Edited ${fileChangeCount} file${fileChangeCount > 1 ? "s" : ""}`);
    if (summaryParts.length > 0) {
      headerParts.push(summaryParts.join(" · "));
      if (durSecs > 0) headerParts.push(`${durSecs}s`);
    } else if (durSecs > 0) {
      headerParts.push(`${durSecs}s`);
    }
    // else: 无文件变化且无耗时 → headerParts 留空，不显示 "Done"
  } else if (turnView.status === "failed") {
    headerParts.push("Failed");
    if (durSecs > 0) headerParts.push(`${durSecs}s`);
  } else if (turnView.status === "stopped") {
    headerParts.push("Stopped");
    if (durSecs > 0) headerParts.push(`${durSecs}s`);
  } else {
    headerParts.push(options.statusLabel ?? turnView.status);
  }
  const header = headerParts.join(" · ");

  // --- currentActivity ---
  let currentActivity = "";
  if (isRunning) {
    if (pendingApproval) {
      currentActivity = "Waiting approval";
    } else {
      const runningTool = turnView.tools.find((t) => t.status === "running");
      if (runningTool) {
        currentActivity = toolToActivity(runningTool.toolName);
      } else if (turnView.thoughts.length > 0) {
        currentActivity = "Thinking";
      } else {
        currentActivity = "Thinking";
      }
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
    // P4-D: 普通用户态用简洁 label（如 "Read AGENTS.md"），developer mode 保留 raw toolName
    const label = options.developerMode ? tool.toolName : toolDisplayLabel(tool.toolName, tool.toolInput);
    // P4-D: 普通用户态不显示 raw JSON toolInput 和 output（降噪）；developer mode 保留
    const showRawIO = options.developerMode === true;
    timelineCards.push({
      id: `tool-${tool.callId}${count > 0 ? `-${count}` : ""}`,
      kind: "tool-call",
      title: label,
      status: tool.status === "running" ? "running" : isToolError ? "failed" : "completed",
      summary: label,
      detail: showRawIO ? tool.output : undefined,
      timestamp: tool.startTime,
      defaultExpanded: tool.status === "running" || isToolError,
      toolName: tool.toolName,
      label,
      toolInput: showRawIO ? tool.toolInput : "",
      durationMs: tool.durationMs,
      output: showRawIO ? tool.output : undefined,
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
    debugView: options.developerMode && options.debug ? redactDebugView(options.debug) : undefined,
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