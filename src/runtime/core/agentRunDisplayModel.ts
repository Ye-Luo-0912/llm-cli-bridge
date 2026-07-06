// LLM CLI Bridge — AgentRunDisplayModel (P3 Agent UX 主链路收敛)
//
// 纯数据模型：从 AssistantTurnView 构造，不依赖 UI/View/DOM。
// view.ts 消费端通过 renderAgentRunDisplayModel/renderAgentRunCard 渲染。
//
// 设计原则：
// 1. 输入只接受 AssistantTurnView 和少量 options，不直接依赖 NormalizedRuntimeEvent / WorkflowEvent。
// 2. 输出按普通用户态信息架构分层：header/finalAnswer/currentActivity/timelineCards/approvalCards/userInputCards/
//    fileChangeCards/diagnosticCards/debugView。
// 3. developer mode 信息汇总到 debugView，不散落在业务字段。

import type { AssistantTurnView, ApprovalResponse, RuntimeSourceRef, TurnTimelineNode, UserInputQuestion, UserInputResponse } from "./types";
import type { AttachmentPlan, EffectiveRunPlan } from "../../types";
import { redactSecrets } from "../../workflowEvent";
import { buildLifecycleEventsFromTurnView, type ProviderLifecycleEvent } from "./providerLifecycleEvent";
import { buildRunPhaseModel, type RunPhaseModel } from "./runPhaseModel";

// ---------- Card Types ----------

export type AgentRunCardKind =
  | "thinking"
  | "tool-call"
  | "file-change"
  | "approval"
  | "user-input"
  | "warning"
  | "error"
  | "final-answer"
  | "debug-raw-event";

export type AgentRunCardStatus = "running" | "completed" | "failed" | "pending" | "idle";
export type FinalAnswerDisposition = "completed" | "needs-input" | "needs-approval" | "answered" | "failed";

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
  /** Developer-mode source identity for provider-native timeline nodes. */
  sourceRef?: RuntimeSourceRef;
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
  command?: string | readonly string[];
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  structuredResult?: unknown;
  contentItems?: unknown;
  isError: boolean;
  progress: ReadonlyArray<{ label: string; detail?: string; timestamp: string }>;
}

export interface FileChangeCard extends AgentRunCardBase {
  kind: "file-change";
  action: "create" | "modify" | "delete";
  path: string;
  /** V16.4: 新增行数（若 provider 提供） */
  additions?: number;
  /** V16.4: 删除行数（若 provider 提供） */
  deletions?: number;
  diff?: string;
  approvalStatus?: "pending" | "approved" | "declined" | "cancelled" | "resolved";
  changes?: ReadonlyArray<{
    readonly action: "create" | "modify" | "delete";
    readonly path: string;
    readonly diff?: string;
    readonly approvalStatus?: "pending" | "approved" | "declined" | "cancelled" | "resolved";
  }>;
}

export interface ApprovalCard extends AgentRunCardBase {
  kind: "approval";
  requestId: string;
  toolName: string;
  label: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  riskReason?: string;
  highRiskFlags?: ReadonlyArray<string>;
  inputSummary?: string;
  mergeKey?: string;
  subagentRisk?: string;
  resolution?: ApprovalResponse;
  resolutionSource?: "user" | "session_allow" | "session_deny" | "mode";
  pending: boolean;
}

export interface UserInputCard extends AgentRunCardBase {
  kind: "user-input";
  requestId: string;
  toolName: string;
  prompt: string;
  inputType?: "text" | "secret";
  questions?: ReadonlyArray<UserInputQuestion>;
  placeholder?: string;
  response?: UserInputResponse;
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
  | UserInputCard
  | WarningCard
  | ErrorCard
  | FinalAnswerCard
  | DebugRawEventCard;

// ---------- Display Model ----------

/**
 * V16.4-D: Run-level permission snapshot — 记录 run 开始时的权限配置。
 * developer mode 审计用；解释自动批准来源。
 */
export interface PermissionSnapshot {
  /** 用户配置的 permissionMode（settings.claudePermissionMode） */
  readonly configuredPermissionMode?: string;
  /** 实际生效的 permissionMode（PermissionBoundary.mode，可能被 provider 覆盖） */
  readonly effectivePermissionMode?: string;
  /** SDK 初始化时的 permissionMode（provider 启动 SDK 时传入） */
  readonly sdkInitPermissionMode?: string;
  /** 允许的工具列表（PermissionBoundary.policy） */
  readonly allowedTools?: ReadonlyArray<string>;
  /** 禁止的工具列表 */
  readonly disallowedTools?: ReadonlyArray<string>;
  /** canUseTool 是否被调用（codex app-server 路径） */
  readonly canUseToolCalled?: boolean;
  /** approval 事件列表（pending + resolved） */
  readonly approvalEvents?: ReadonlyArray<{ requestId: string; toolName: string; pending: boolean; resolutionSource?: string }>;
}

export interface AgentRunDebugView {
  commandPreview?: ReadonlyArray<{ label: string; value: string }>;
  effectiveRunPlan?: EffectiveRunPlan;
  providerThreadId?: string;
  providerSessionId?: string;
  sessionResumed?: boolean;
  attachmentPlan?: AttachmentPlan;
  rawProviderEvents: ReadonlyArray<unknown>;
  /** V16.4: lifecycle events（developer mode 调试用） */
  lifecycleEvents?: ReadonlyArray<ProviderLifecycleEvent>;
  /** legacy: Workflow Trace / SDK events（仅 developer mode 展示） */
  workflowTrace?: ReadonlyArray<{ stage: string; timestamp: string; detail: string; status: string }>;
  sdkEvents?: ReadonlyArray<unknown>;
  /** V16.4-D: Run-level permission snapshot（developer mode 审计） */
  permissionSnapshot?: PermissionSnapshot;
}

export interface AgentRunDisplayModel {
  /** 摘要头：如 "过程 · 运行中 · 2 tools · 3 file changes · 30s" */
  header: string;
  /** 最终回答落点：完成/需确认/需授权/普通回答/失败 */
  finalAnswerDisposition: FinalAnswerDisposition;
  /** 最终答案（普通用户态主内容） */
  finalAnswer: string;
  /** 当前活动摘要（运行中时显示，如 "运行中: Read file..."） */
  currentActivity: string;
  /** V16.4: 阶段化执行模型（普通用户态主链路） */
  phaseModel: RunPhaseModel;
  /** 时间线卡片（thoughts / tools / resolved approvals / errors；developer mode 用） */
  timelineCards: AgentRunCard[];
  /** 待审批卡片（pending approvals，驱动 pending panel） */
  approvalCards: ApprovalCard[];
  /** 待回答卡片（pending user input requests） */
  userInputCards: UserInputCard[];
  /** 文件变更卡片（单独区域展示；developer mode 用） */
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
  /** V16.4-C: provider 直接提供的精确文件统计（最高优先级） */
  providerStats?: ReadonlyArray<import("./runPhaseModel").FileChangeStat>;
  /** V16.4-C: vault snapshot diff 统计（中优先级） */
  snapshotStats?: ReadonlyArray<import("./runPhaseModel").FileChangeStat>;
}

// ---------- Builder ----------

const EMPTY_CARDS: readonly AgentRunCard[] = [];

function mapTimelineStatus(status: TurnTimelineNode["status"]): AgentRunCardStatus {
  switch (status) {
    case "running": return "running";
    case "failed": return "failed";
    case "blocked": return "pending";
    case "resolved":
    case "completed": return "completed";
  }
}

function formatTimelineArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function truncateInline(value: string, max = 240): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function buildTimelineToolLabel(node: TurnTimelineNode): string {
  if (node.kind === "commandExecution") return node.command ? "Run command" : (node.tool ?? node.title);
  if (node.kind === "mcpToolCall") return node.server ? `${node.server}.${node.tool ?? "tool"}` : (node.tool ?? node.title);
  if (node.kind === "dynamicToolCall") return node.tool ?? node.title;
  return node.tool ?? node.title;
}

function mapTurnTimelineNodeToCard(node: TurnTimelineNode, developerMode: boolean): AgentRunCard {
  const status = mapTimelineStatus(node.status);
  const summary = node.summary ?? node.text?.slice(0, 120) ?? node.detail ?? node.title;
  const base = {
    id: `timeline-${node.sourceRef?.sequence ?? node.id}`,
    title: node.title,
    status,
    summary,
    detail: node.detail,
    timestamp: node.startedAt,
    defaultExpanded: status === "running" || status === "failed" || status === "pending",
    sourceRef: developerMode ? node.sourceRef : undefined,
  };

  if (node.kind === "agentMessage") {
    return {
      ...base,
      kind: "final-answer",
      title: "Assistant message",
      text: node.text ?? "",
      detail: node.text,
    };
  }

  if (node.kind === "reasoning" || node.kind === "plan" || node.kind === "contextCompaction" || node.kind === "reviewMode") {
    return {
      ...base,
      kind: "thinking",
      title: node.title,
      text: node.text ?? node.detail ?? summary,
      meta: node.kind,
    };
  }

  if (node.kind === "fileChange") {
    const changes = node.fileChanges ?? (node.path ? [{
      action: node.action ?? "modify",
      path: node.path,
      diff: node.diff,
      approvalStatus: node.approvalStatus,
    }] : []);
    const diffPreview = changes.map((change) => change.diff).filter((d): d is string => !!d).join("\n");
    return {
      ...base,
      kind: "file-change",
      title: changes.length > 1 ? `File changes (${changes.length})` : node.path ? `${node.action ?? "modify"} ${node.path}` : node.title,
      summary: [
        changes.length > 1 ? changes.map((c) => `${c.action} ${c.path}`).join(", ") : node.path ?? summary,
        node.approvalStatus ? `approval=${node.approvalStatus}` : "",
      ].filter(Boolean).join(" · "),
      detail: truncateInline(diffPreview || node.detail || node.stdout || "", 500),
      action: node.action ?? "modify",
      path: node.path ?? "",
      diff: diffPreview || node.diff,
      approvalStatus: node.approvalStatus,
      changes,
    };
  }

  if (node.kind === "approval") {
    return {
      ...base,
      kind: "approval",
      title: node.title,
      requestId: String(node.sourceRef?.serverRequestId ?? node.id),
      toolName: node.tool ?? "approval",
      label: summary,
      description: node.detail ?? summary,
      riskLevel: "medium",
      pending: node.status === "blocked",
    };
  }

  if (node.kind === "userInput") {
    return {
      ...base,
      kind: "user-input",
      title: node.title,
      requestId: String(node.sourceRef?.serverRequestId ?? node.id),
      toolName: node.tool ?? "request_user_input",
      prompt: summary,
      response: node.result as UserInputResponse | undefined,
      pending: node.status === "blocked",
    };
  }

  if (node.kind === "commandExecution" || node.kind === "mcpToolCall" || node.kind === "dynamicToolCall" || node.kind === "webSearch" || node.kind === "imageView") {
    const label = buildTimelineToolLabel(node);
    const input = node.kind === "commandExecution"
      ? formatTimelineArgs(node.command ?? node.args)
      : formatTimelineArgs(node.args);
    const output = node.stdout || node.stderr || formatTimelineArgs(node.result ?? node.contentItems);
    const sourceLabel = node.kind === "mcpToolCall" && node.server ? `${node.server}.${node.tool ?? "tool"}`
      : node.kind === "dynamicToolCall" ? node.tool ?? label
      : label;
    return {
      ...base,
      kind: "tool-call",
      title: sourceLabel,
      summary: [
        sourceLabel,
        node.cwd ? `cwd=${node.cwd}` : "",
        typeof node.exitCode === "number" ? `exit=${node.exitCode}` : "",
        typeof node.durationMs === "number" ? `${node.durationMs}ms` : "",
      ].filter(Boolean).join(" · "),
      detail: output || node.detail,
      toolName: node.tool ?? node.kind,
      label: sourceLabel,
      toolInput: input,
      durationMs: node.durationMs,
      output,
      command: node.command,
      cwd: node.cwd,
      stdout: node.stdout,
      stderr: node.stderr,
      exitCode: node.exitCode,
      structuredResult: node.result,
      contentItems: node.contentItems,
      isError: node.status === "failed",
      progress: node.stdout || node.stderr
        ? [
            node.stdout ? { label: "stdout", detail: node.stdout, timestamp: node.startedAt ?? "" } : null,
            node.stderr ? { label: "stderr", detail: node.stderr, timestamp: node.startedAt ?? "" } : null,
          ].filter((p): p is { label: string; detail: string; timestamp: string } => !!p)
        : [],
    };
  }

  return {
    ...base,
    kind: node.status === "failed" ? "error" : "warning",
    message: summary,
  };
}

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

function extractApprovalPath(inputSummary?: string): string | null {
  if (!inputSummary) return null;
  const match = inputSummary.match(/(?:^|\|\s*)(?:file|path|notebook):\s*([^|]+)/i);
  if (!match?.[1]) return null;
  return match[1].trim();
}

export function approvalDisplayLabel(toolName: string, inputSummary?: string, description?: string): string {
  const path = extractApprovalPath(inputSummary);
  if (path) {
    return toolDisplayLabel(toolName, JSON.stringify({ path }));
  }
  const toolLabel = toolDisplayLabel(toolName);
  if (toolLabel !== toolName) return toolLabel;
  if (description && description.length <= 80 && !/^tool:\s*/i.test(description)) return description;
  return toolName;
}

function looksLikeNeedsInput(finalAnswer: string): boolean {
  const trimmed = finalAnswer.trim();
  if (!trimmed) return false;
  const explicitPatterns = [
    /我需要你确认/u,
    /需要你确认/u,
    /请确认/u,
    /请先确认/u,
    /请选择/u,
    /请告诉我/u,
    /告诉我你/u,
    /你希望我/u,
    /please confirm/i,
    /confirm (?:which|whether|if)/i,
    /choose (?:one|an option)/i,
    /which (?:one|option|file|path)/i,
    /what would you like/i,
    /let me know/i,
  ];
  if (explicitPatterns.some((pattern) => pattern.test(trimmed))) return true;
  const lastLine = trimmed.split(/\r?\n/).filter(Boolean).pop() ?? trimmed;
  return /[?？]\s*$/.test(lastLine) && /(你|your|you|which|what|whether|要|希望|选择|确认)/i.test(lastLine);
}

function isUserInputApprovalTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "askuserquestion" || normalized === "request_user_input";
}

function buildFileChangeSummary(
  fileChanges: ReadonlyArray<{ action: "create" | "modify" | "delete" }>,
): string {
  const created = fileChanges.filter((fc) => fc.action === "create").length;
  const edited = fileChanges.filter((fc) => fc.action === "modify").length;
  const deleted = fileChanges.filter((fc) => fc.action === "delete").length;
  if (created > 0 && edited === 0 && deleted === 0) {
    return `Created ${created} file${created > 1 ? "s" : ""}`;
  }
  if (created === 0 && edited > 0 && deleted === 0) {
    return `Edited ${edited} file${edited > 1 ? "s" : ""}`;
  }
  if (created === 0 && edited === 0 && deleted > 0) {
    return `Deleted ${deleted} file${deleted > 1 ? "s" : ""}`;
  }
  return `Created/Edited +${created + edited} -${deleted}`;
}

export function inferFinalAnswerDisposition(turnView: AssistantTurnView): FinalAnswerDisposition {
  const userInputRequests = turnView.userInputRequests ?? [];
  const pendingApprovals = turnView.approvals.filter((a) => a.pending && !isUserInputApprovalTool(a.toolName));
  if (turnView.status === "failed") return "failed";
  if (userInputRequests.some((r) => r.pending)) return "needs-input";
  if (looksLikeNeedsInput(turnView.finalAnswer)) return "needs-input";
  if (pendingApprovals.length > 0) return "needs-approval";
  if (turnView.fileChanges.length > 0) return "completed";
  if (turnView.finalAnswer.trim().length > 0) return "answered";
  return "completed";
}

/**
 * V16.4-D: 解释自动批准来源 — 当 editing tool 完成且无 pending approval 时，说明为何未弹窗。
 *
 * 返回值：
 * - "auto-approved by acceptEdits" — acceptEdits 模式自动允许写入
 * - "auto-approved by bypass" — bypassPermissions 模式跳过所有权限
 * - "auto-approved by auto mode" — auto 模式自动允许低风险
 * - "approved by session" — 会话级 allow 缓存
 * - "approved by allow rule" — permission policy allow
 * - undefined — 无法判定（需 pending approval 或未知模式）
 */
export function explainAutoApprovalSource(
  permissionMode: string | undefined,
  resolutionSource?: string,
): string | undefined {
  // 优先使用 resolutionSource（来自 ApprovalSegment，精确）
  if (resolutionSource === "mode") {
    if (permissionMode === "acceptEdits") return "auto-approved by acceptEdits";
    if (permissionMode === "bypassPermissions") return "auto-approved by bypass";
    if (permissionMode === "auto") return "auto-approved by auto mode";
    if (permissionMode === "dontAsk") return "auto-approved by dontAsk";
    return `auto-approved by ${permissionMode ?? "mode"}`;
  }
  if (resolutionSource === "session_allow") return "approved by session";
  if (resolutionSource === "user") return "user approved";
  if (resolutionSource === "session_deny") return "denied by session";
  // 无 resolutionSource 时，基于 mode 推断（tool 无 pending approval = 被 mode 自动决策）
  if (!resolutionSource) {
    if (permissionMode === "acceptEdits") return "auto-approved by acceptEdits";
    if (permissionMode === "bypassPermissions") return "auto-approved by bypass";
    if (permissionMode === "auto") return "auto-approved by auto mode";
    if (permissionMode === "dontAsk") return "auto-approved by dontAsk";
  }
  return undefined;
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
    lifecycleEvents: debug.lifecycleEvents?.map((e) => redactObject(e)),
    workflowTrace: debug.workflowTrace?.map((t) => ({ ...t, detail: redactSecrets(t.detail) })),
    sdkEvents: debug.sdkEvents?.map((e) => redactObject(e)),
    permissionSnapshot: debug.permissionSnapshot ? redactObject(debug.permissionSnapshot) : debug.permissionSnapshot,
  };
}

/**
 * 从 AssistantTurnView 构建 AgentRunDisplayModel。
 *
 * 纯数据转换，不涉及任何 UI/DOM 操作。
 * - timelineCards: thoughts + tools + resolved approvals + errors
 * - approvalCards: pending approvals
 * - userInputCards: pending user input requests
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
  const finalAnswerDisposition = inferFinalAnswerDisposition(turnView);
  const userInputRequests = turnView.userInputRequests ?? [];

  // V16.4: 构建 lifecycle events + phase model（普通用户态主链路）
  // 优先使用 provider-native lifecycleEvents（由 AssistantTurnViewBuilder 从 NormalizedRuntimeEvent 派生）；
  // 仅在无 provider-native 事件时 fallback 到 buildLifecycleEventsFromTurnView（从聚合 view 反推）。
  const nativeLifecycle = turnView.lifecycleEvents;
  const lifecycleEvents = nativeLifecycle && nativeLifecycle.length > 0
    ? nativeLifecycle
    : buildLifecycleEventsFromTurnView(turnView);
  const phaseModel = buildRunPhaseModel(turnView, lifecycleEvents, {
    durationMs: dur,
    isRunning,
    providerStats: options.providerStats,
    snapshotStats: options.snapshotStats,
  });

  // --- header ---
  const durSecs = dur != null && dur > 0 ? Math.round(dur / 1000) : 0;
  const pendingApproval = turnView.approvals.some((a) => a.pending && !isUserInputApprovalTool(a.toolName));
  const pendingUserInput = userInputRequests.some((r) => r.pending) || looksLikeNeedsInput(turnView.finalAnswer);
  const headerParts: string[] = [];

  if (isRunning) {
    // V16.4-C: running header 优先使用 phaseModel.currentActivity（具体阶段标签，如 "Reading AGENTS.md"），
    // 不再使用旧的 runningTool -> toolToActivity 泛化状态（如 "Reading files"）。
    if (pendingUserInput) {
      headerParts.push("Needs input");
    } else if (pendingApproval) {
      headerParts.push("Needs approval");
    } else {
      headerParts.push(phaseModel.currentActivity || "Thinking");
    }
    if (durSecs > 0) headerParts.push(`${durSecs}s`);
  } else if (turnView.status === "completed") {
    if (finalAnswerDisposition === "needs-approval") {
      headerParts.push("Needs approval");
    } else if (finalAnswerDisposition === "needs-input") {
      headerParts.push("Needs input");
    } else if (finalAnswerDisposition === "answered") {
      headerParts.push("Answered");
    } else if (fileChangeCount > 0) {
      headerParts.push(buildFileChangeSummary(turnView.fileChanges));
    } else {
      headerParts.push("Completed");
    }
    if (durSecs > 0) headerParts.push(`${durSecs}s`);
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
  // V16.4-C: currentActivity 优先使用 phaseModel.currentActivity（具体阶段标签），
  // fallback 才用 Thinking。不再使用旧的 runningTool -> toolToActivity 作为普通用户态主状态。
  let currentActivity = "";
  if (isRunning) {
    if (pendingUserInput) {
      currentActivity = "Needs input";
    } else if (pendingApproval) {
      currentActivity = "Needs approval";
    } else {
      currentActivity = phaseModel.currentActivity || "Thinking";
    }
  }

  // --- timelineCards ---
  const timelineCards: AgentRunCard[] = [];
  const providerTimeline = turnView.turnTimeline ?? [];
  const hasProviderTimeline = providerTimeline.some((node) =>
    !!node.sourceRef?.itemId && node.kind !== "approval" && node.kind !== "userInput");

  if (hasProviderTimeline) {
    timelineCards.push(...providerTimeline.map((node) => mapTurnTimelineNodeToCard(node, options.developerMode === true)));
  }
  const legacyTools = hasProviderTimeline ? [] : turnView.tools;
  const legacyApprovals = hasProviderTimeline ? [] : turnView.approvals;
  const legacyUserInputRequests = hasProviderTimeline ? [] : userInputRequests;

  // thoughts → ThinkingCard
  for (let i = 0; !hasProviderTimeline && i < turnView.thoughts.length; i++) {
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
  for (const tool of legacyTools) {
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
  for (const ap of legacyApprovals) {
    if (ap.pending) continue;
    const label = approvalDisplayLabel(ap.toolName, ap.inputSummary, ap.description);
    timelineCards.push({
      id: `approval-resolved-${ap.requestId}`,
      kind: "approval",
      title: `权限: ${label}`,
      status: "completed",
      summary: buildApprovalResolutionSummary(ap.resolution, ap.resolutionSource),
      detail: ap.inputSummary,
      timestamp: undefined,
      requestId: ap.requestId,
      toolName: ap.toolName,
      label,
      description: ap.description,
      riskLevel: ap.riskLevel,
      riskReason: ap.riskReason,
      highRiskFlags: ap.highRiskFlags,
      inputSummary: ap.inputSummary,
      mergeKey: ap.mergeKey,
      subagentRisk: ap.subagentRisk,
      resolution: ap.resolution,
      resolutionSource: ap.resolutionSource,
      pending: false,
      defaultExpanded: false,
    });
  }

  // resolved user inputs → UserInputCard（timeline）
  for (const req of legacyUserInputRequests) {
    if (req.pending) continue;
    timelineCards.push({
      id: `user-input-${req.requestId}`,
      kind: "user-input",
      title: "User input",
      status: "completed",
      summary: req.prompt,
      detail: req.response?.type === "submit" ? req.response.value : "cancelled",
      timestamp: req.timestamp,
      defaultExpanded: false,
      requestId: req.requestId,
      toolName: req.toolName,
      prompt: req.prompt,
      inputType: req.inputType,
      questions: req.questions,
      placeholder: req.placeholder,
      response: req.response,
      pending: false,
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
    if (isUserInputApprovalTool(ap.toolName)) continue;
    const label = approvalDisplayLabel(ap.toolName, ap.inputSummary, ap.description);
    approvalCards.push({
      id: `approval-pending-${ap.requestId}`,
      kind: "approval",
      title: label,
      status: "pending",
      summary: label,
      detail: ap.inputSummary,
      timestamp: undefined,
      requestId: ap.requestId,
      toolName: ap.toolName,
      label,
      description: ap.description,
      riskLevel: ap.riskLevel,
      riskReason: ap.riskReason,
      highRiskFlags: ap.highRiskFlags,
      inputSummary: ap.inputSummary,
      mergeKey: ap.mergeKey,
      subagentRisk: ap.subagentRisk,
      resolution: undefined,
      resolutionSource: undefined,
      pending: true,
    });
  }

  // --- userInputCards (pending) ---
  const userInputCards: UserInputCard[] = [];
  for (const req of userInputRequests) {
    if (!req.pending) continue;
    userInputCards.push({
      id: `user-input-pending-${req.requestId}`,
      kind: "user-input",
      title: req.toolName,
      status: "pending",
      summary: req.prompt,
      detail: req.prompt,
      timestamp: req.timestamp,
      requestId: req.requestId,
      toolName: req.toolName,
      prompt: req.prompt,
      inputType: req.inputType,
      questions: req.questions,
      placeholder: req.placeholder,
      response: undefined,
      pending: true,
    });
  }

  // --- fileChangeCards ---
  // V16.4-C: 用合并后的 stats（provider > snapshot > fallback）覆盖 additions/deletions
  const fcStatsByPath = new Map<string, typeof phaseModel.fileChangeStats[number]>();
  for (const s of phaseModel.fileChangeStats) fcStatsByPath.set(s.path, s);
  const fileChangeCards: FileChangeCard[] = [];
  for (let i = 0; i < turnView.fileChanges.length; i++) {
    const fc = turnView.fileChanges[i];
    const mergedStat = fcStatsByPath.get(fc.path);
    const additions = mergedStat?.additions ?? fc.additions;
    const deletions = mergedStat?.deletions ?? fc.deletions;
    const actionLabel = fc.action === "create" ? "新建" : fc.action === "modify" ? "修改" : "删除";
    // V16.4: 构建 +N -M 统计文案
    const statsParts: string[] = [];
    if (typeof additions === "number" && additions >= 0) statsParts.push(`+${additions}`);
    if (typeof deletions === "number" && deletions >= 0) statsParts.push(`-${deletions}`);
    const statsLabel = statsParts.length > 0 ? ` · ${statsParts.join(" ")}` : "";
    fileChangeCards.push({
      id: `filechange-${i}`,
      kind: "file-change",
      title: `${actionLabel}文件`,
      status: "completed",
      summary: `${fc.path}${statsLabel}`,
      detail: fc.path,
      timestamp: fc.timestamp,
      action: fc.action,
      path: fc.path,
      additions,
      deletions,
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
    finalAnswerDisposition,
    finalAnswer: turnView.finalAnswer,
    currentActivity,
    phaseModel,
    timelineCards,
    approvalCards,
    userInputCards,
    fileChangeCards,
    diagnosticCards,
    debugView: options.developerMode && options.debug
      ? redactDebugView({ ...options.debug, lifecycleEvents })
      : undefined,
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

/**
 * V16.4: 工具名 → Lucide 图标名 + 分类。
 * 不再返回 emoji；view.ts 用 setIcon() 渲染单色 Lucide 图标。
 * - read → file-text
 * - search → search
 * - write/edit → pencil
 * - delete → trash-2
 * - command → terminal
 * - think → brain
 * - web → globe
 * - notify → bell
 * - default → settings
 */
export function getToolIconCategory(toolName: string): { icon: string; category: string } {
  const name = toolName.toLowerCase();
  if (name.includes("read") || name.includes("list") || name.includes("grep") || name.includes("stat") || name.includes("glob")) {
    return { icon: "file-text", category: "read" };
  }
  if (name.includes("search")) {
    return { icon: "search", category: "search" };
  }
  if (name.includes("write") || name.includes("create") || name.includes("edit") || name.includes("replace") || name.includes("insert") || name.includes("patch")) {
    return { icon: "pencil", category: "write" };
  }
  if (name.includes("delete") || name.includes("remove") || name.includes("rm")) {
    return { icon: "trash-2", category: "delete" };
  }
  if (name.includes("bash") || name.includes("command") || name.includes("execute") || name.includes("run") || name.includes("shell") || name.includes("terminal")) {
    return { icon: "terminal", category: "command" };
  }
  if (name.includes("think") || name.includes("reason")) {
    return { icon: "brain", category: "think" };
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("curl") || name.includes("http") || name.includes("browse")) {
    return { icon: "globe", category: "web" };
  }
  if (name.includes("notify") || name.includes("notice") || name.includes("toast")) {
    return { icon: "bell", category: "notify" };
  }
  return { icon: "settings", category: "tool" };
}

/**
 * V16.4: 阶段类型 → Lucide 图标名。
 * - planning → list-checks
 * - reading → file-text
 * - editing → pencil
 * - checking → terminal
 * - verifying → check-circle
 * - waiting-input → message-square
 * - waiting-approval → shield
 * - failed → x-circle
 * - completed → check
 */
export function getPhaseIconName(phaseType: string): string {
  switch (phaseType) {
    case "planning": return "list-checks";
    case "reading": return "file-text";
    case "editing": return "pencil";
    case "checking": return "terminal";
    case "verifying": return "check-circle";
    case "waiting-input": return "message-square";
    case "waiting-approval": return "shield";
    case "failed": return "x-circle";
    case "completed": return "check";
    default: return "circle";
  }
}

export { EMPTY_CARDS };
