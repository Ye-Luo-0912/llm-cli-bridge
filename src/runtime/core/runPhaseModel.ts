// LLM CLI Bridge — RunPhaseModel (V16.4: SDK-native 阶段化执行视图)
//
// 纯数据模型：从 AssistantTurnView + ProviderLifecycleEvent[] 聚合出阶段化执行视图。
// 普通用户态主链路消费 phaseModel；developer mode 仍走 timelineCards + debugView。
//
// 设计原则：
// 1. 阶段边界基于 SDK 生命周期（evaluation_started），不是 toolName 文本匹配。
// 2. 每个 thought segment（多段 thinking）标志一个新的 evaluation/phase。
// 3. tool_start 后无 thought 时，用 tool 类型变化作为 fallback 边界。
// 4. 多段 thinking 在阶段内保留为 phase.thoughts[]，不被压成单个 thinkingBlock。
// 5. 普通用户态不显示 TaskCreate/TaskUpdate/Preparing tool input；仅作为阶段切分依据。
// 6. 文件变更统计透传 additions/deletions。

import type {
  ApprovalSegment,
  AssistantTurnView,
  FileChangeSegment,
  ThoughtSegment,
  ToolSegment,
  UserInputRequestSegment,
} from "./types";
import type { ProviderLifecycleEvent } from "./providerLifecycleEvent";

// ---------- Phase Types ----------

export type RunPhaseType =
  | "planning"
  | "reading"
  | "editing"
  | "checking"
  | "verifying"
  | "waiting-input"
  | "waiting-approval"
  | "failed"
  | "completed";

export type RunPhaseStatus = "running" | "completed" | "failed" | "pending";

/** 单个执行阶段 */
export interface RunPhase {
  readonly id: string;
  readonly type: RunPhaseType;
  readonly status: RunPhaseStatus;
  readonly label: string;
  readonly thoughts: ReadonlyArray<ThoughtSegment>;
  readonly tools: ReadonlyArray<ToolSegment>;
  readonly fileChanges: ReadonlyArray<FileChangeSegment>;
  readonly approvals: ReadonlyArray<ApprovalSegment>;
  readonly userInputRequests: ReadonlyArray<UserInputRequestSegment>;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  /** 默认展开（running/failed/pending 阶段展开；completed 折叠） */
  readonly defaultExpanded: boolean;
}

/** 文件变更统计来源优先级（高 → 低） */
export type FileChangeStatSource = "provider" | "snapshot" | "fallback";

/** 文件变更统计项 */
export interface FileChangeStat {
  readonly path: string;
  readonly action: "create" | "modify" | "delete";
  readonly additions?: number;
  readonly deletions?: number;
  /** V16.4: 统计来源（developer mode 可见；普通用户态不显示） */
  readonly source?: FileChangeStatSource;
}

// ---------- RunPhaseModel ----------

export interface RunPhaseModel {
  readonly phases: ReadonlyArray<RunPhase>;
  readonly currentPhase: RunPhase | null;
  readonly currentActivity: string;
  readonly resultSummary: string;
  readonly fileChangeStats: ReadonlyArray<FileChangeStat>;
  readonly durationMs?: number;
  readonly status: AssistantTurnView["status"];
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly pendingApprovals: ReadonlyArray<ApprovalSegment>;
  readonly pendingUserInputRequests: ReadonlyArray<UserInputRequestSegment>;
}

// ---------- Build Options ----------

export interface BuildRunPhaseModelOptions {
  durationMs?: number;
  isRunning?: boolean;
  /** V16.4-C: provider 直接提供的精确文件统计（最高优先级，如 codex change.diff / SDK 文件 diff） */
  providerStats?: ReadonlyArray<FileChangeStat>;
  /** V16.4-C: vault snapshot diff 统计（中优先级，before/after snapshot 对比） */
  snapshotStats?: ReadonlyArray<FileChangeStat>;
}

// ---------- Tool Categorization ----------

/**
 * 工具名 → 阶段类型。
 * - TaskCreate / TaskUpdate / TodoWrite → planning
 * - Read / Search / Glob / Grep → reading
 * - Write / Edit / MultiEdit → editing
 * - Bash / test / lint / command / shell → checking
 */
export function toolToPhaseType(toolName: string): RunPhaseType {
  const n = toolName.toLowerCase();
  if (n.includes("taskcreate") || n.includes("taskupdate") || n.includes("todowrite") || n.includes("todo_write") || n === "plan" || n.includes("planning")) {
    return "planning";
  }
  // checking 必须在 editing 之前判断（避免 "test" 误命中 editing 的其他规则）
  if (n.includes("bash") || n.includes("execute") || n.includes("run") || n.includes("command") || n.includes("shell") || n.includes("terminal") || n.includes("check") || n.includes("test") || n.includes("lint") || n.includes("dotnet") || n.includes("npm") || n.includes("pytest") || n.includes("jest") || n.includes("cargo")) {
    return "checking";
  }
  if (n.includes("read") || n.includes("getfile") || n.includes("view") || n.includes("search") || n.includes("grep") || n.includes("glob") || n.includes("list") || n.includes("ls")) {
    return "reading";
  }
  if (n.includes("write") || n.includes("edit") || n.includes("str_replace") || n.includes("patch") || n.includes("create_file") || n.includes("update_file") || n.includes("insert") || n.includes("delete") || n.includes("remove") || n.includes("rm")) {
    return "editing";
  }
  return "reading";
}

/**
 * 判断工具是否应作为普通用户态可见 tool card。
 * TaskCreate / TaskUpdate / TodoWrite / Preparing tool input 等不直接展示。
 */
export function isUserVisibleTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  if (n.includes("taskcreate") || n.includes("taskupdate") || n.includes("todowrite") || n.includes("todo_write")) return false;
  if (n === "askuserquestion" || n === "request_user_input") return false;
  if (n === "preparing tool input" || n.includes("preparing_tool_input") || n.includes("preparingtoolinput")) return false;
  return true;
}

/**
 * 工具名 → 用户友好阶段标签。
 * - Read {"file_path":"AGENTS.md"} → "Reading AGENTS.md"
 * - Write {"file_path":"x.md"} → "Editing x.md"
 * - Bash → "Running command"
 * - planning → "Planning"
 */
export function phaseLabel(type: RunPhaseType, firstTool?: ToolSegment): string {
  if (type === "planning") return "Planning";
  if (type === "waiting-input") return "Waiting for input";
  if (type === "waiting-approval") return "Waiting approval";
  if (type === "failed") return "Failed";
  if (type === "completed") return "Completed";
  if (!firstTool) {
    if (type === "reading") return "Reading";
    if (type === "editing") return "Editing";
    if (type === "checking") return "Running checks";
    if (type === "verifying") return "Verifying";
    return type;
  }
  const basename = extractPathBasename(firstTool.toolInput);
  const tn = firstTool.toolName.toLowerCase();
  if (type === "reading") {
    if (tn.includes("search") || tn.includes("grep") || tn.includes("glob")) return basename ? `Searching ${basename}` : "Searching";
    return basename ? `Reading ${basename}` : "Reading";
  }
  if (type === "editing") {
    if (tn.includes("delete") || tn.includes("remove")) return basename ? `Deleted ${basename}` : "Deleted";
    if (tn.includes("create_file") || tn === "write") return basename ? `Created ${basename}` : "Created";
    return basename ? `Editing ${basename}` : "Editing";
  }
  if (type === "checking") {
    if (tn.includes("test")) return "Running tests";
    if (tn.includes("lint")) return "Running lint";
    if (tn.includes("bash") || tn.includes("execute") || tn.includes("run") || tn.includes("command") || tn.includes("shell")) return "Running command";
    return "Running checks";
  }
  if (type === "verifying") {
    return basename ? `Verifying ${basename}` : "Verifying";
  }
  return type;
}

/** 从 toolInput JSON 中提取 basename（仅文件名，不含目录） */
function extractPathBasename(toolInput?: string): string | null {
  if (!toolInput) return null;
  try {
    const parsed = JSON.parse(toolInput);
    const p = parsed.file_path ?? parsed.notebook_path ?? parsed.path ?? parsed.pattern;
    if (typeof p === "string" && p.length > 0) {
      const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
      return parts[parts.length - 1] ?? p;
    }
  } catch {
    if (/[/\\]/.test(toolInput)) {
      const parts = toolInput.replace(/\\/g, "/").split("/").filter(Boolean);
      return parts[parts.length - 1] ?? null;
    }
  }
  return null;
}

/** 从纯路径字符串提取 basename（用于 fileChange.path） */
function pathBasename(p: string): string | null {
  if (!p) return null;
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * V16.4-D: 重算 phase type + label — 基于全部已绑定 tools/fileChanges/approvals/status。
 *
 * 优先级：failed > waiting-input > waiting-approval > editing > checking > verifying > reading > planning
 *
 * 修复问题：
 * - "Write 不得出现在 Reading phase"：若阶段含 editing tool，type 升级为 editing
 * - "Created phase 不重复显示 Write + Read"：label 基于 fileChange 优先级计算
 * - "Verifying phase 只显示验证 Read"：verifying 类型保持（lifecycle 处理时已检测）
 */
function recomputePhaseTypesAndLabels(
  phases: MutablePhase[],
  _allEditedPaths: Set<string>,
): void {
  for (const phase of phases) {
    // 1. failed status → "failed"
    if (phase.status === "failed") {
      phase.type = "failed";
      phase.label = "Failed";
      continue;
    }
    // 2. waiting-input / waiting-approval → 保持
    if (phase.type === "waiting-input") {
      phase.label = "Waiting for input";
      continue;
    }
    if (phase.type === "waiting-approval") {
      phase.label = "Waiting approval";
      continue;
    }
    // 3. 基于 tools 确定 type（优先级 editing > checking > verifying > reading > planning）
    const tools = phase.tools;
    const hasEditing = tools.some((t) => toolToPhaseType(t.toolName) === "editing");
    const hasChecking = tools.some((t) => toolToPhaseType(t.toolName) === "checking");
    const hasReading = tools.some((t) => toolToPhaseType(t.toolName) === "reading");

    let finalType: RunPhaseType = phase.type;
    if (hasEditing) {
      finalType = "editing";
    } else if (hasChecking) {
      finalType = "checking";
    } else if (phase.type === "verifying") {
      finalType = "verifying"; // 保持（lifecycle 处理时已检测 Read after Write）
    } else if (hasReading) {
      finalType = "reading";
    } else if (tools.length === 0 && phase.thoughts.length > 0) {
      finalType = "planning";
    }

    phase.type = finalType;
    phase.label = computePhaseLabel(finalType, tools, phase.fileChanges);
  }
}

/**
 * V16.4-D: 基于 type + tools + fileChanges 计算阶段标签。
 *
 * 优先级：
 * - create fileChange → "Created filename"
 * - modify fileChange → "Modified filename"
 * - editing tool → "Created/Editing/Deleted filename"
 * - checking tool → "Running tests/Running command"
 * - verifying → "Verifying filename"
 * - reading → "Reading filename"
 * - planning → "Planning"
 */
function computePhaseLabel(
  type: RunPhaseType,
  tools: ReadonlyArray<ToolSegment>,
  fileChanges: ReadonlyArray<FileChangeSegment>,
): string {
  if (type === "failed") return "Failed";
  if (type === "waiting-input") return "Waiting for input";
  if (type === "waiting-approval") return "Waiting approval";
  if (type === "planning") return "Planning";

  // 有 create fileChange → "Created filename"
  const createFc = fileChanges.find((fc) => fc.action === "create");
  if (createFc) {
    const bn = pathBasename(createFc.path);
    return bn ? `Created ${bn}` : "Created";
  }
  // 有 modify fileChange → "Modified filename"
  const modifyFc = fileChanges.find((fc) => fc.action === "modify");
  if (modifyFc) {
    const bn = pathBasename(modifyFc.path);
    return bn ? `Modified ${bn}` : "Modified";
  }

  // 有 editing tool → "Created/Editing/Deleted filename"
  const editingTool = tools.find((t) => toolToPhaseType(t.toolName) === "editing");
  if (editingTool) {
    const tn = editingTool.toolName.toLowerCase();
    const bn = extractPathBasename(editingTool.toolInput);
    if (tn.includes("delete") || tn.includes("remove")) return bn ? `Deleted ${bn}` : "Deleted";
    if (tn.includes("create_file") || tn === "write") return bn ? `Created ${bn}` : "Created";
    return bn ? `Editing ${bn}` : "Editing";
  }

  // 有 checking tool → "Running tests/Running command"
  const checkingTool = tools.find((t) => toolToPhaseType(t.toolName) === "checking");
  if (checkingTool) {
    const tn = checkingTool.toolName.toLowerCase();
    if (tn.includes("test")) return "Running tests";
    if (tn.includes("lint")) return "Running lint";
    return "Running command";
  }

  // verifying
  if (type === "verifying") {
    const readTool = tools.find((t) => toolToPhaseType(t.toolName) === "reading");
    const bn = readTool ? extractPathBasename(readTool.toolInput) : null;
    return bn ? `Verifying ${bn}` : "Verifying";
  }

  // reading
  if (type === "reading") {
    const readTool = tools.find((t) => toolToPhaseType(t.toolName) === "reading");
    if (readTool) {
      const tn = readTool.toolName.toLowerCase();
      const bn = extractPathBasename(readTool.toolInput);
      if (tn.includes("search") || tn.includes("grep") || tn.includes("glob")) return bn ? `Searching ${bn}` : "Searching";
      return bn ? `Reading ${bn}` : "Reading";
    }
    return "Reading";
  }

  return type;
}

// ---------- Internal mutable phase (build-time) ----------

interface MutablePhase {
  id: string;
  type: RunPhaseType;
  status: RunPhaseStatus;
  label: string;
  thoughts: ThoughtSegment[];
  tools: ToolSegment[];
  fileChanges: FileChangeSegment[];
  approvals: ApprovalSegment[];
  userInputRequests: UserInputRequestSegment[];
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  /** V16.4-D: 此阶段绑定的 toolUseId 集合（tool_started 时绑定，替代时间窗口匹配） */
  toolUseIds: Set<string>;
}

// ---------- Builder ----------

/**
 * 从 AssistantTurnView + lifecycle events 构建 RunPhaseModel。
 *
 * 阶段切分算法（基于 SDK 生命周期）：
 * 1. 遍历 lifecycle events，按 evaluation_started 边界切分阶段
 * 2. 每个 thought segment 标志一个新的 evaluation（SDK: 新 SDKAssistantMessage）
 * 3. tool_started 后若无 thought，用 tool 类型变化作为 fallback 边界
 * 4. tool_result = observation_received，归入当前阶段
 * 5. file_change 归入最近的 editing 阶段
 * 6. pending user input / approval → waiting-input / waiting-approval 阶段
 * 7. failed 终态追加 failed 阶段
 *
 * Verifying 规则：读取曾写入的文件 → verifying（覆盖 reading）
 */
export function buildRunPhaseModel(
  turnView: AssistantTurnView,
  lifecycleEvents: ReadonlyArray<ProviderLifecycleEvent>,
  options: BuildRunPhaseModelOptions = {},
): RunPhaseModel {
  const isRunning = options.isRunning ?? turnView.status === "running";
  const dur = options.durationMs ?? turnView.durationMs;
  const userInputRequests = turnView.userInputRequests ?? [];
  const pendingApprovals = turnView.approvals.filter((a) => a.pending);
  const pendingUserInputRequests = userInputRequests.filter((r) => r.pending);
  const hasPendingApproval = pendingApprovals.length > 0;
  const hasPendingUserInput = pendingUserInputRequests.length > 0;

  // V16.4: 是否有 provider-native 边界（evaluation_started）。
  // 有时以 SDK 生命周期为权威边界；fallback tool-type-change 边界仅在无 native 边界时启用，
  // 避免同一 SDKAssistantMessage 内多个 tool_use 被误拆成多个 phase。
  const hasNativeBoundary = lifecycleEvents.some((e) => e.type === "evaluation_started");

  const phases: MutablePhase[] = [];
  let phaseIdx = 0;
  // 记录所有 editing 阶段写入的文件 basename（用于 verifying 检测）
  const allEditedPaths: Set<string> = new Set();
  // V16.4-D: approvalId → ApprovalSegment 映射（用于将 approval 附加到当前 phase）
  const approvalByRequestId = new Map<string, ApprovalSegment>();
  for (const ap of turnView.approvals) {
    approvalByRequestId.set(ap.requestId, ap);
  }
  const userInputByRequestId = new Map<string, UserInputRequestSegment>();
  for (const req of userInputRequests) {
    userInputByRequestId.set(req.requestId, req);
  }

  let currentPhase: MutablePhase | null = null;

  const newPhase = (type: RunPhaseType, firstTool?: ToolSegment, startedAt?: string): MutablePhase => ({
    id: `phase-${phaseIdx++}`,
    type,
    status: "running",
    label: phaseLabel(type, firstTool),
    thoughts: [],
    tools: [],
    fileChanges: [],
    approvals: [],
    userInputRequests: [],
    startedAt: startedAt ?? firstTool?.startTime ?? turnView.startedAt,
    toolUseIds: new Set<string>(),
  });

  // closePhase: 关闭阶段并设置 endedAt/durationMs。
  // 注意：closePhase 会把 status="running" 的阶段标记为 "completed"。
  // 运行中的 currentPhase 不应调用 closePhase —— 由 buildRunPhaseModel 末尾的 running 分支处理
  // （仅设 endedAt/durationMs 供 UI 显示 elapsed，保持 status="running"）。
  const closePhase = (phase: MutablePhase, endedAt?: string) => {
    if (!phase) return;
    if (endedAt) phase.endedAt = endedAt;
    if (phase.startedAt && phase.endedAt) {
      const ms = new Date(phase.endedAt).getTime() - new Date(phase.startedAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) phase.durationMs = ms;
    }
    if (phase.status === "running") phase.status = "completed";
  };

  // 遍历 lifecycle events 切分阶段
  for (const ev of lifecycleEvents) {
    switch (ev.type) {
      case "evaluation_started": {
        // SDK 生命周期边界：新 evaluation = 新阶段
        // 关闭当前阶段（若有），新阶段类型待第一个 tool 确定
        if (currentPhase) {
          closePhase(currentPhase, ev.timestamp);
          phases.push(currentPhase);
          currentPhase = null;
        }
        // 创建一个临时 planning 阶段（类型后续根据 tool 调整）
        currentPhase = newPhase("planning", undefined, ev.timestamp);
        break;
      }
      case "reasoning_section_started":
      case "reasoning_summary_delta": {
        // reasoning 事件归入当前阶段（evaluation_started 已创建阶段）
        if (!currentPhase) {
          currentPhase = newPhase("planning", undefined, ev.timestamp);
        }
        // V16.4-D: 基于 messageId 稳定 key 聚合 — 同一 message 的 delta 合并为一个 ThoughtSegment
        // 不再按 timestamp 判断（每个 delta 时间戳不同 → 会导致逐词灰块）
        if (ev.type === "reasoning_summary_delta" && ev.text) {
          const msgId = ev.messageId;
          const lastThought = currentPhase.thoughts[currentPhase.thoughts.length - 1];
          if (lastThought && lastThought.messageId === msgId && msgId !== undefined) {
            // 同一 messageId → 合并
            lastThought.text += ev.text;
          } else if (lastThought && msgId === undefined && lastThought.messageId === undefined) {
            // fallback：无 messageId 时合并到最后一段（同阶段短时间窗口）
            lastThought.text += ev.text;
          } else {
            currentPhase.thoughts.push({
              timestamp: ev.timestamp,
              text: ev.text,
              messageId: msgId,
              contentBlockIndex: 0,
            });
          }
        }
        break;
      }
      case "tool_started": {
        // tool 事件归入当前阶段
        if (!currentPhase) {
          currentPhase = newPhase("planning", undefined, ev.timestamp);
        }
        // 根据工具类型调整阶段类型（若当前是 planning 且有 tool）
        const toolType = toolToPhaseType(ev.toolName ?? "");
        if (currentPhase.tools.length === 0 && currentPhase.thoughts.length > 0) {
          // 第一个 tool 到来，确定阶段类型
          // verifying 检测：读取曾写入的文件
          let finalType = toolType;
          if (toolType === "reading") {
            const basename = extractPathBasename(ev.toolInput);
            if (basename && allEditedPaths.has(basename)) {
              finalType = "verifying";
            }
          }
          currentPhase.type = finalType;
          currentPhase.label = phaseLabel(finalType, {
            callId: ev.toolUseId ?? "",
            toolName: ev.toolName ?? "",
            toolInput: ev.toolInput ?? "",
            startTime: ev.timestamp,
            isError: false,
            status: "running",
            progress: [],
          });
        } else if (currentPhase.tools.length === 0 && currentPhase.thoughts.length === 0) {
          // 无 thought 的阶段，根据 tool 类型确定
          let finalType = toolType;
          if (toolType === "reading") {
            const basename = extractPathBasename(ev.toolInput);
            if (basename && allEditedPaths.has(basename)) {
              finalType = "verifying";
            }
          }
          currentPhase.type = finalType;
          currentPhase.label = phaseLabel(finalType, {
            callId: ev.toolUseId ?? "",
            toolName: ev.toolName ?? "",
            toolInput: ev.toolInput ?? "",
            startTime: ev.timestamp,
            isError: false,
            status: "running",
            progress: [],
          });
        }
        // V16.4: fallback tool-type-change 边界 —— 仅在无 provider-native 边界时启用。
        // 有 evaluation_started 时，同一 SDKAssistantMessage 内的多个 tool_use 应在同一 phase，
        // 即使 tool 类型不同也不拆分（SDK 允许一条 assistant message 含 Read+Write+Bash）。
        if (!hasNativeBoundary && currentPhase.tools.length > 0 && toolType !== currentPhase.type && !(toolType === "reading" && currentPhase.type === "verifying")) {
          closePhase(currentPhase, ev.timestamp);
          phases.push(currentPhase);
          let finalType = toolType;
          if (toolType === "reading") {
            const basename = extractPathBasename(ev.toolInput);
            if (basename && allEditedPaths.has(basename)) {
              finalType = "verifying";
            }
          }
          currentPhase = newPhase(finalType, {
            callId: ev.toolUseId ?? "",
            toolName: ev.toolName ?? "",
            toolInput: ev.toolInput ?? "",
            startTime: ev.timestamp,
            isError: false,
            status: "running",
            progress: [],
          }, ev.timestamp);
        }
        // 记录 editing 阶段写入的文件
        if (toolType === "editing") {
          const basename = extractPathBasename(ev.toolInput);
          if (basename) allEditedPaths.add(basename);
        }
        // V16.4-D: 绑定 toolUseId → currentPhase（替代时间窗口匹配）
        // tool_completed / observation_received / file_change 通过 toolUseId 回填同一个 phase
        if (ev.toolUseId && currentPhase) {
          currentPhase.toolUseIds.add(ev.toolUseId);
        }
        break;
      }
      case "tool_completed":
      case "tool_failed": {
        // tool 完成/失败 → 更新阶段状态
        if (currentPhase && ev.type === "tool_failed") {
          currentPhase.status = "failed";
        }
        break;
      }
      case "observation_received": {
        // tool result 归入当前阶段（不改变阶段类型）
        break;
      }
      case "action_completed": {
        // file_change → 归入当前阶段或最近 editing 阶段
        if (!currentPhase) {
          currentPhase = newPhase("editing", undefined, ev.timestamp);
        }
        // file change 归入当前阶段
        const fcSeg: FileChangeSegment = {
          timestamp: ev.timestamp,
          action: ev.fileAction ?? "modify",
          path: ev.filePath ?? "",
          ...(typeof ev.additions === "number" ? { additions: ev.additions } : {}),
          ...(typeof ev.deletions === "number" ? { deletions: ev.deletions } : {}),
        };
        currentPhase.fileChanges.push(fcSeg);
        break;
      }
      case "approval_requested": {
        // V16.4-D: pending approval 嵌入当前 phase（轻量化 — 不常驻大面板）
        // 将 ApprovalSegment 附加到 currentPhase.approvals，UI 在 phase 内渲染内联 chips
        if (!currentPhase) {
          currentPhase = newPhase("waiting-approval", undefined, ev.timestamp);
        }
        if (ev.approvalId) {
          const apSeg = approvalByRequestId.get(ev.approvalId);
          if (apSeg && !currentPhase.approvals.some((a) => a.requestId === apSeg.requestId)) {
            currentPhase.approvals.push(apSeg);
          }
        }
        break;
      }
      case "approval_resolved": {
        // V16.4-D: 更新 phase 内 approval 状态（pending → resolved）
        if (ev.approvalId) {
          for (const phase of phases) {
            const ap = phase.approvals.find((a) => a.requestId === ev.approvalId);
            if (ap) {
              ap.pending = false;
              break;
            }
          }
          if (currentPhase) {
            const ap = currentPhase.approvals.find((a) => a.requestId === ev.approvalId);
            if (ap) ap.pending = false;
          }
        }
        break;
      }
      case "user_input_requested": {
        if (currentPhase) {
          closePhase(currentPhase, ev.timestamp);
          phases.push(currentPhase);
        }
        currentPhase = newPhase("waiting-input", undefined, ev.timestamp);
        if (ev.approvalId) {
          const reqSeg = userInputByRequestId.get(ev.approvalId);
          if (reqSeg && !currentPhase.userInputRequests.some((r) => r.requestId === reqSeg.requestId)) {
            currentPhase.userInputRequests.push(reqSeg);
          }
        }
        currentPhase.status = "pending";
        break;
      }
      case "user_input_resolved": {
        if (ev.approvalId) {
          for (const phase of phases) {
            const req = phase.userInputRequests.find((r) => r.requestId === ev.approvalId);
            if (req) {
              req.pending = false;
              if (phase.status === "pending") phase.status = "completed";
              break;
            }
          }
          if (currentPhase) {
            const req = currentPhase.userInputRequests.find((r) => r.requestId === ev.approvalId);
            if (req) {
              req.pending = false;
              if (currentPhase.status === "pending") currentPhase.status = "completed";
            }
          }
        }
        break;
      }
      case "result": {
        // run 终态
        if (currentPhase) {
          closePhase(currentPhase, ev.timestamp);
          phases.push(currentPhase);
          currentPhase = null;
        }
        if (ev.error) {
          phases.push({
            id: `phase-${phaseIdx++}`,
            type: "failed",
            status: "failed",
            label: "Failed",
            thoughts: [],
            tools: [],
            fileChanges: [],
            approvals: [],
            userInputRequests: [],
            startedAt: ev.timestamp,
            endedAt: ev.timestamp,
            toolUseIds: new Set<string>(),
          });
        }
        break;
      }
      default:
        // 其他事件类型不改变阶段
        break;
    }
  }

  // V16.4: 关闭最后一个未关闭的阶段。
  // - run 仍在运行（turnView.status === "running" 且无 endedAt）：保持 status="running"，
  //   仅设 endedAt/durationMs 供 UI 显示 elapsed，不标记 completed。
  // - run 已终态：正常关闭为 completed。
  if (currentPhase) {
    if (isRunning && !turnView.endedAt) {
      // 运行中：保持 running 状态，不设 endedAt（阶段仍在进行）
      phases.push(currentPhase);
    } else {
      closePhase(currentPhase, turnView.endedAt);
      phases.push(currentPhase);
    }
    currentPhase = null;
  }

  // V16.4-D: 关联实际的 ToolSegment 数据 — 基于 toolUseId 绑定（不再时间窗口匹配）。
  // tool_started 时已将 toolUseId 绑定到 phase.toolUseIds；
  // 此处从 turnView.tools 按 callId 查找完整 ToolSegment 填充到对应阶段。
  const toolByCallId = new Map<string, ToolSegment>();
  for (const t of turnView.tools) {
    toolByCallId.set(t.callId, t);
  }
  for (const phase of phases) {
    const visibleTools: ToolSegment[] = [];
    for (const toolUseId of phase.toolUseIds) {
      const tool = toolByCallId.get(toolUseId);
      if (tool && isUserVisibleTool(tool.toolName)) {
        visibleTools.push(tool);
      }
    }
    // 按 startTime 排序，保持工具执行顺序
    visibleTools.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    phase.tools = visibleTools;
  }

  // V16.4-D: 重算 phase type + label — 基于全部已绑定 tools/fileChanges/userInput/approvals/status
  // 优先级：failed > waiting-input > waiting-approval > editing > checking > verifying > reading > planning
  // 修复 "Write 不得出现在 Reading phase"：若阶段含 editing tool，type 升级为 editing
  recomputePhaseTypesAndLabels(phases, allEditedPaths);

  const hasPendingUserInputPhase = phases.some((p) => p.userInputRequests.some((r) => r.pending));
  // pending user inputs → waiting-input 阶段
  if (hasPendingUserInput && !hasPendingUserInputPhase) {
    phases.push({
      id: `phase-${phaseIdx++}`,
      type: "waiting-input",
      status: "pending",
      label: "Waiting for input",
      thoughts: [],
      tools: [],
      fileChanges: [],
      approvals: [],
      userInputRequests: pendingUserInputRequests.slice(),
      startedAt: turnView.endedAt ?? turnView.startedAt,
      toolUseIds: new Set<string>(),
    });
  }

  const hasPendingApprovalPhase = phases.some((p) => p.approvals.some((a) => a.pending));
  // pending approvals → waiting-approval 阶段
  if (hasPendingApproval && !hasPendingApprovalPhase) {
    phases.push({
      id: `phase-${phaseIdx++}`,
      type: "waiting-approval",
      status: "pending",
      label: "Waiting approval",
      thoughts: [],
      tools: [],
      fileChanges: [],
      approvals: pendingApprovals.slice(),
      userInputRequests: [],
      startedAt: turnView.endedAt ?? turnView.startedAt,
      toolUseIds: new Set<string>(),
    });
  }

  // 关联 thoughts 到阶段（按时间区间）
  for (const thought of turnView.thoughts) {
    const ts = new Date(thought.timestamp).getTime();
    let found = false;
    for (const p of phases) {
      const start = new Date(p.startedAt).getTime();
      const end = p.endedAt ? new Date(p.endedAt).getTime() : Infinity;
      if (ts >= start && ts <= end) {
        // 避免重复添加（evaluation_started 阶段可能已添加）
        if (!p.thoughts.includes(thought)) {
          p.thoughts.push(thought);
        }
        found = true;
        break;
      }
    }
    if (!found && phases.length > 0) {
      // 归入第一个阶段
      if (!phases[0].thoughts.includes(thought)) {
        phases[0].thoughts.push(thought);
      }
    }
  }

  // 计算 currentPhase
  const currentRunningPhase = isRunning
    ? phases.find((p) => p.status === "running") ?? null
    : null;

  // V16.4-C: fileChangeStats —— tool input 估算作为 fallback（source="fallback"）
  const fallbackStats: FileChangeStat[] = turnView.fileChanges.map((fc) => ({
    path: fc.path,
    action: fc.action,
    additions: fc.additions,
    deletions: fc.deletions,
    source: "fallback" as FileChangeStatSource,
  }));
  // V16.4-C: 合并 provider/snapshot stats（优先级 provider > snapshot > fallback）
  const fileChangeStats = mergeFileChangeStats(
    options.providerStats ?? [],
    fallbackStats,
    options.snapshotStats,
  );
  // 建立 path → 合并后 stat 映射，用于更新 phase.fileChanges 的 additions/deletions
  const statsByPath = new Map<string, FileChangeStat>();
  for (const s of fileChangeStats) statsByPath.set(s.path, s);

  // 转 RunPhase（设 defaultExpanded；fileChanges 用合并后的 stats 覆盖 additions/deletions）
  const finalPhases: RunPhase[] = phases.map((p) => ({
    id: p.id,
    type: p.type,
    status: p.status,
    label: p.label,
    thoughts: p.thoughts,
    tools: p.tools,
    fileChanges: p.fileChanges.map((fc) => {
      const stat = statsByPath.get(fc.path);
      return stat
        ? { ...fc, additions: stat.additions ?? fc.additions, deletions: stat.deletions ?? fc.deletions }
        : fc;
    }),
    approvals: p.approvals,
    userInputRequests: p.userInputRequests,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    durationMs: p.durationMs,
    defaultExpanded: p.status === "running" || p.status === "failed" || p.status === "pending",
  }));

  // currentActivity
  let currentActivity = "";
  if (isRunning) {
    if (hasPendingUserInput) {
      currentActivity = "Waiting for input";
    } else if (hasPendingApproval) {
      currentActivity = "Waiting approval";
    } else if (currentRunningPhase) {
      currentActivity = currentRunningPhase.label;
    } else {
      currentActivity = "Thinking";
    }
  }

  // resultSummary
  const resultSummary = buildResultSummary(turnView, fileChangeStats, dur);

  return {
    phases: finalPhases,
    currentPhase: currentRunningPhase ? finalPhases[phases.indexOf(currentRunningPhase)] : null,
    currentActivity,
    resultSummary,
    fileChangeStats,
    durationMs: dur,
    status: turnView.status,
    errors: turnView.errors,
    warnings: turnView.warnings,
    pendingApprovals,
    pendingUserInputRequests,
  };
}

/**
 * V16.4: 合并文件变更统计 —— 优先级 provider > snapshot > fallback。
 *
 * 同一 path 的统计取最高优先级来源；低优先级来源的条目被丢弃。
 * 调用方可传入 providerStats（来自 codex change.diff / SDK 文件 diff）和 snapshotStats
 * （来自 vault before/after snapshot diff），与 fallback（tool input 估算）合并。
 *
 * @param providerStats provider 直接提供的精确统计（最高优先级）
 * @param fallbackStats tool input 估算的 fallback 统计（最低优先级）
 * @param snapshotStats vault snapshot diff 统计（中优先级，可选）
 */
export function mergeFileChangeStats(
  providerStats: ReadonlyArray<FileChangeStat>,
  fallbackStats: ReadonlyArray<FileChangeStat>,
  snapshotStats?: ReadonlyArray<FileChangeStat>,
): FileChangeStat[] {
  const byPath = new Map<string, FileChangeStat>();
  // 低优先级先入，高优先级覆盖
  for (const s of fallbackStats) byPath.set(s.path, s);
  if (snapshotStats) {
    for (const s of snapshotStats) byPath.set(s.path, { ...s, source: "snapshot" });
  }
  for (const s of providerStats) byPath.set(s.path, { ...s, source: "provider" });
  return Array.from(byPath.values());
}

/**
 * 构建 run 完成后的摘要文案。
 * - "Created 1 file · +42 -0 · 4m18s"
 * - "Edited 3 files · +12 -5 · 30s"
 * - "4m18s"（无文件变更）
 * - "Failed · 4m18s"
 */
function buildResultSummary(
  turnView: AssistantTurnView,
  fileChangeStats: ReadonlyArray<FileChangeStat>,
  dur?: number,
): string {
  if (turnView.status === "failed") {
    const parts: string[] = ["Failed"];
    if (dur != null && dur > 0) parts.push(formatDuration(dur));
    return parts.join(" · ");
  }
  if (turnView.status === "stopped") {
    const parts: string[] = ["Stopped"];
    if (dur != null && dur > 0) parts.push(formatDuration(dur));
    return parts.join(" · ");
  }
  const parts: string[] = [];
  if (fileChangeStats.length > 0) {
    const created = fileChangeStats.filter((f) => f.action === "create").length;
    const modified = fileChangeStats.filter((f) => f.action === "modify").length;
    const deleted = fileChangeStats.filter((f) => f.action === "delete").length;
    const segs: string[] = [];
    if (created > 0) segs.push(`Created ${created} file${created > 1 ? "s" : ""}`);
    if (modified > 0) segs.push(`Edited ${modified} file${modified > 1 ? "s" : ""}`);
    if (deleted > 0) segs.push(`Deleted ${deleted} file${deleted > 1 ? "s" : ""}`);
    if (segs.length > 0) parts.push(segs.join(", "));

    const totalAdd = fileChangeStats.reduce((sum, f) => sum + (f.additions ?? 0), 0);
    const totalDel = fileChangeStats.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
    if (totalAdd > 0 || totalDel > 0) {
      parts.push(`+${totalAdd} -${totalDel}`);
    }
  }
  if (parts.length === 0) parts.push("Completed");
  if (dur != null && dur > 0) parts.push(formatDuration(dur));
  return parts.join(" · ");
}

/** 格式化耗时（ms → "4m18s" / "30s"） */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}
