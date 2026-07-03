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
} from "./types";
import type { ProviderLifecycleEvent } from "./providerLifecycleEvent";

// ---------- Phase Types ----------

export type RunPhaseType =
  | "planning"
  | "reading"
  | "editing"
  | "checking"
  | "verifying"
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
}

// ---------- Build Options ----------

export interface BuildRunPhaseModelOptions {
  durationMs?: number;
  isRunning?: boolean;
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
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
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
 * 6. pending approval → waiting-approval 阶段
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
  const pendingApprovals = turnView.approvals.filter((a) => a.pending);
  const hasPendingApproval = pendingApprovals.length > 0;

  // V16.4: 是否有 provider-native 边界（evaluation_started）。
  // 有时以 SDK 生命周期为权威边界；fallback tool-type-change 边界仅在无 native 边界时启用，
  // 避免同一 SDKAssistantMessage 内多个 tool_use 被误拆成多个 phase。
  const hasNativeBoundary = lifecycleEvents.some((e) => e.type === "evaluation_started");

  const phases: MutablePhase[] = [];
  let phaseIdx = 0;
  // 记录所有 editing 阶段写入的文件 basename（用于 verifying 检测）
  const allEditedPaths: Set<string> = new Set();

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
    startedAt: startedAt ?? firstTool?.startTime ?? turnView.startedAt,
  });

  const closePhase = (phase: MutablePhase, endedAt?: string) => {
    if (!phase) return;
    if (endedAt) phase.endedAt = endedAt;
    if (phase.startedAt && phase.endedAt) {
      const ms = new Date(phase.endedAt).getTime() - new Date(phase.startedAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) phase.durationMs = ms;
    }
    // V16.4: running 阶段不在此处标记 completed —— 由调用方在 run 终态时显式关闭。
    // 这避免运行中 currentPhase 被误标记 completed。
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
        // reasoning_summary_delta 携带 text → 记录为 thought
        if (ev.type === "reasoning_summary_delta" && ev.text) {
          // 尝试合并到最近一个 thought（若时间戳接近）
          const lastThought = currentPhase.thoughts[currentPhase.thoughts.length - 1];
          if (lastThought && lastThought.timestamp === ev.timestamp) {
            lastThought.text += ev.text;
          } else {
            currentPhase.thoughts.push({
              timestamp: ev.timestamp,
              text: ev.text,
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
        // pending approval → 当前阶段标记
        if (!currentPhase) {
          currentPhase = newPhase("waiting-approval", undefined, ev.timestamp);
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
            startedAt: ev.timestamp,
            endedAt: ev.timestamp,
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

  // 关联实际的 ToolSegment 数据（lifecycle events 只有 tool 元数据，不含完整 ToolSegment）
  // 从 turnView.tools 按 callId 匹配并填充到对应阶段
  const toolByCallId = new Map<string, ToolSegment>();
  for (const t of turnView.tools) {
    toolByCallId.set(t.callId, t);
  }
  for (const phase of phases) {
    // 清空 placeholder tools，用实际 ToolSegment 填充
    const visibleTools: ToolSegment[] = [];
    // 遍历该阶段时间区间内的工具
    const phaseStart = new Date(phase.startedAt).getTime();
    const phaseEnd = phase.endedAt ? new Date(phase.endedAt).getTime() : Infinity;
    for (const tool of turnView.tools) {
      const toolStart = new Date(tool.startTime).getTime();
      if (toolStart >= phaseStart && toolStart <= phaseEnd) {
        if (isUserVisibleTool(tool.toolName)) {
          visibleTools.push(tool);
        }
      }
    }
    phase.tools = visibleTools;
  }

  // pending approvals → waiting-approval 阶段
  if (hasPendingApproval) {
    phases.push({
      id: `phase-${phaseIdx++}`,
      type: "waiting-approval",
      status: "pending",
      label: "Waiting approval",
      thoughts: [],
      tools: [],
      fileChanges: [],
      approvals: pendingApprovals.slice(),
      startedAt: turnView.endedAt ?? turnView.startedAt,
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

  // 转 RunPhase（设 defaultExpanded）
  const finalPhases: RunPhase[] = phases.map((p) => ({
    id: p.id,
    type: p.type,
    status: p.status,
    label: p.label,
    thoughts: p.thoughts,
    tools: p.tools,
    fileChanges: p.fileChanges,
    approvals: p.approvals,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    durationMs: p.durationMs,
    defaultExpanded: p.status === "running" || p.status === "failed" || p.status === "pending",
  }));

  // currentActivity
  let currentActivity = "";
  if (isRunning) {
    if (hasPendingApproval) {
      currentActivity = "Waiting approval";
    } else if (currentRunningPhase) {
      currentActivity = currentRunningPhase.label;
    } else {
      currentActivity = "Thinking";
    }
  }

  // fileChangeStats —— tool input 估算作为 fallback（source="fallback"）
  const fallbackStats: FileChangeStat[] = turnView.fileChanges.map((fc) => ({
    path: fc.path,
    action: fc.action,
    additions: fc.additions,
    deletions: fc.deletions,
    source: "fallback" as FileChangeStatSource,
  }));
  // V16.4: 合并 provider/snapshot stats（优先级 provider > snapshot > fallback）
  const fileChangeStats = mergeFileChangeStats([], fallbackStats);

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
