// LLM CLI Bridge — Codex Run ViewModel (V17-G)
//
// Provider-neutral presentation model for the compact Codex-style run UI.
// It is derived from AgentRunDisplayModel / AssistantTurnView only; raw provider
// events remain an opaque developer debug payload and are not inspected here.

import type {
  AgentRunDebugView,
  AgentRunDisplayModel,
  ApprovalCard,
  FileChangeCard,
  ToolCallCard,
} from "./agentRunDisplayModel";
import type { AssistantTurnView, RuntimeSourceRef } from "./types";

export type CodexRunStatusKind = "running" | "blocked" | "completed" | "failed" | "stopped" | "idle";
export type CodexRunStepKind =
  | "thinking"
  | "command"
  | "file"
  | "mcp"
  | "dynamic"
  | "approval"
  | "user-input"
  | "status";

export type CodexRunFeedKind = CodexRunStepKind | "assistant";

export interface CodexRunHeader {
  readonly status: string;
  readonly statusKind: CodexRunStatusKind;
  readonly provider: string;
  readonly model: string;
  readonly elapsed: string;
  readonly fileChangeCount: number;
  readonly commandCount: number;
  readonly approvalCount: number;
  readonly diagnosticCount: number;
}

export interface CodexRunCurrentActivity {
  readonly label: string;
  readonly kind: CodexRunStatusKind;
}

export interface CodexRunChangeGroup {
  readonly id: string;
  readonly action: "create" | "modify" | "delete";
  readonly fileName: string;
  readonly relativePath: string;
  readonly fullPath: string;
  readonly diffSummary: string;
  readonly diff?: string;
  readonly approvalStatus?: "pending" | "approved" | "declined" | "cancelled" | "resolved";
  readonly durationMs?: number;
  readonly timestamp?: string;
  readonly sourceRef?: RuntimeSourceRef;
}

export interface CodexRunStepGroup {
  readonly id: string;
  readonly kind: CodexRunStepKind;
  readonly icon: string;
  readonly label: string;
  readonly status: "running" | "completed" | "failed" | "pending" | "idle";
  readonly durationMs?: number;
  readonly command?: string;
  readonly cwd?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly args?: string;
  readonly structuredResult?: unknown;
  readonly contentItems?: unknown;
  readonly sourceRef?: RuntimeSourceRef;
}

export interface CodexRunApprovalGate {
  readonly id: string;
  readonly requestId: string;
  readonly action: string;
  readonly risk: "low" | "medium" | "high";
  readonly riskReason?: string;
  readonly summary: string;
  readonly sourceRef?: RuntimeSourceRef;
}

export interface CodexRunDiagnosticsGroup {
  readonly id: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly count: number;
  readonly target?: string;
  readonly path?: string;
  readonly raw?: unknown;
}

export interface CodexRunFeedItem {
  readonly id: string;
  readonly kind: CodexRunFeedKind;
  readonly icon: string;
  readonly label: string;
  readonly status: "running" | "completed" | "failed" | "pending" | "idle";
  readonly summary?: string;
  readonly detail?: string;
  readonly timestamp?: string;
  readonly durationMs?: number;
  readonly step?: CodexRunStepGroup;
  readonly change?: CodexRunChangeGroup;
  readonly sourceRef?: RuntimeSourceRef;
}

export interface CodexRunViewModel {
  readonly runHeader: CodexRunHeader;
  readonly currentActivity: CodexRunCurrentActivity;
  readonly changeGroups: ReadonlyArray<CodexRunChangeGroup>;
  readonly stepGroups: ReadonlyArray<CodexRunStepGroup>;
  readonly feedItems: ReadonlyArray<CodexRunFeedItem>;
  readonly approvalGates: ReadonlyArray<CodexRunApprovalGate>;
  readonly diagnosticsGroups: ReadonlyArray<CodexRunDiagnosticsGroup>;
  readonly finalAnswer: string;
  readonly debugPanel?: AgentRunDebugView;
}

export interface BuildCodexRunViewModelOptions {
  readonly status: AssistantTurnView["status"] | string;
  readonly providerLabel?: string;
  readonly modelLabel?: string;
  readonly cwd?: string;
  readonly developerMode?: boolean;
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function relativizePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedPath.toLowerCase().startsWith(`${normalizedCwd.toLowerCase()}/`)) {
    return normalizedPath.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function stringifyCompact(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringifyCommand(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => String(part)).join(" ");
  return stringifyCompact(value);
}

function actionLabel(action: "create" | "modify" | "delete"): string {
  if (action === "create") return "Created";
  if (action === "delete") return "Deleted";
  return "Modified";
}

function diffSummary(diff?: string): string {
  if (!diff) return "No diff preview";
  const lines = diff.split(/\r?\n/).filter((line) => line.length > 0);
  const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deletions = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  if (additions === 0 && deletions === 0) return `${lines.length} line${lines.length === 1 ? "" : "s"}`;
  return `+${additions} -${deletions}`;
}

function statusKind(status: string, model: AgentRunDisplayModel): CodexRunStatusKind {
  if (model.approvalCards.some((card) => card.pending) || model.userInputCards.some((card) => card.pending)) return "blocked";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  if (status === "completed") return "completed";
  return "idle";
}

function statusLabel(kind: CodexRunStatusKind, model: AgentRunDisplayModel): string {
  if (kind === "blocked") return model.userInputCards.some((card) => card.pending) ? "Waiting input" : "Waiting approval";
  if (kind === "running") return "Running";
  if (kind === "failed") return "Failed";
  if (kind === "stopped") return "Stopped";
  if (kind === "completed") return model.finalAnswerDisposition === "answered" ? "Answered" : "Completed";
  return "Idle";
}

function normalizeActivity(
  model: AgentRunDisplayModel,
  steps: ReadonlyArray<CodexRunStepGroup>,
  kind: CodexRunStatusKind,
  changes: ReadonlyArray<CodexRunChangeGroup>,
): CodexRunCurrentActivity {
  if (model.approvalCards.some((card) => card.pending)) return { label: "Waiting approval", kind: "blocked" };
  if (model.userInputCards.some((card) => card.pending)) return { label: "Waiting input", kind: "blocked" };

  const runningStep = [...steps].reverse().find((step) => step.status === "running");
  if (runningStep) {
    if (runningStep.kind === "command") return { label: "Running command", kind: "running" };
    if (runningStep.kind === "file") return { label: "Applying patch", kind: "running" };
    if (runningStep.kind === "thinking") return { label: "Thinking", kind: "running" };
    return { label: runningStep.label, kind: "running" };
  }

  if (kind !== "running" && kind !== "blocked") {
    if (kind === "completed") {
      const lastChange = [...changes].reverse()[0];
      if (lastChange) return { label: `${actionLabel(lastChange.action)} ${lastChange.fileName}`, kind };
      const lastStep = [...steps].reverse().find((step) => step.status === "completed" && step.kind !== "status");
      if (lastStep) return { label: lastStep.label, kind };
    }
    return { label: statusLabel(kind, model), kind };
  }

  const activity = model.currentActivity || model.header || "Completed";
  if (/approval/i.test(activity)) return { label: "Waiting approval", kind: "blocked" };
  if (/input/i.test(activity)) return { label: "Waiting input", kind: "blocked" };
  if (/command|check|test|shell|bash/i.test(activity)) return { label: "Running command", kind: "running" };
  if (/edit|write|patch|file/i.test(activity)) return { label: "Editing file", kind: "running" };
  if (/thinking|reason/i.test(activity)) return { label: "Thinking", kind: "running" };
  return { label: activity, kind: "completed" };
}

function stepIcon(kind: CodexRunStepKind): string {
  switch (kind) {
    case "thinking": return "brain";
    case "command": return "terminal";
    case "file": return "file-text";
    case "mcp": return "plug";
    case "dynamic": return "wrench";
    case "approval": return "shield";
    case "user-input": return "message-square";
    default: return "circle";
  }
}

function toolStepKind(card: ToolCallCard): CodexRunStepKind {
  if (card.toolName === "mcpToolCall" || card.summary.includes(".")) return "mcp";
  if (card.toolName === "dynamicToolCall") return "dynamic";
  if (card.command || /command|bash|shell|terminal|execute/i.test(card.toolName)) return "command";
  return "dynamic";
}

function thinkingSummary(card: Extract<import("./agentRunDisplayModel").AgentRunCard, { kind: "thinking" }>): string {
  const value = (card.text || card.detail || card.summary || "").trim();
  const title = card.title.trim();
  if (value && value !== title) return value;
  return "Reasoning summary not provided by Codex.";
}

function buildChangeGroups(model: AgentRunDisplayModel, turnView: AssistantTurnView, cwd?: string): CodexRunChangeGroup[] {
  const root = cwd ?? model.debugView?.effectiveRunPlan?.cwd;
  const groups: CodexRunChangeGroup[] = [];
  const seen = new Map<string, number>();

  const addChange = (
    baseId: string,
    action: "create" | "modify" | "delete",
    fullPath: string,
    diff?: string,
    approvalStatus?: CodexRunChangeGroup["approvalStatus"],
    durationMs?: number,
    timestamp?: string,
    sourceRef?: RuntimeSourceRef,
  ) => {
    if (!fullPath) return;
    const relativePath = relativizePath(fullPath, root);
    const key = `${action}:${relativePath}`;
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      const existing = groups[existingIndex];
      if (!existing.diff && diff) {
        groups[existingIndex] = {
          ...existing,
          diff,
          diffSummary: diffSummary(diff),
          approvalStatus: approvalStatus ?? existing.approvalStatus,
          durationMs: durationMs ?? existing.durationMs,
          timestamp: timestamp ?? existing.timestamp,
          sourceRef: sourceRef ?? existing.sourceRef,
        };
      }
      return;
    }
    seen.set(key, groups.length);
    groups.push({
      id: `${baseId}-${groups.length}`,
      action,
      fileName: basename(relativePath),
      relativePath,
      fullPath,
      diffSummary: diffSummary(diff),
      diff,
      approvalStatus,
      durationMs,
      timestamp,
      sourceRef,
    });
  };

  for (const card of model.timelineCards) {
    if (card.kind !== "file-change") continue;
    if (card.changes && card.changes.length > 0) {
      for (const change of card.changes) {
        addChange(card.id, change.action, change.path, change.diff, change.approvalStatus ?? card.approvalStatus, undefined, card.timestamp, card.sourceRef);
      }
    } else {
      addChange(card.id, card.action, card.path, card.diff, card.approvalStatus, undefined, card.timestamp, card.sourceRef);
    }
  }

  for (const card of model.fileChangeCards as FileChangeCard[]) {
    addChange(card.id, card.action, card.path, card.diff, card.approvalStatus, undefined, card.timestamp, card.sourceRef);
  }

  for (const fc of turnView.fileChanges) {
    addChange(`segment-${fc.timestamp}`, fc.action, fc.path, undefined, undefined, undefined, fc.timestamp, undefined);
  }

  return groups;
}

function stepFromToolCard(card: ToolCallCard): CodexRunStepGroup {
  const kind = toolStepKind(card);
  return {
    id: card.id,
    kind,
    icon: stepIcon(kind),
    label: card.label || card.title,
    status: card.status,
    durationMs: card.durationMs,
    command: stringifyCommand(card.command),
    cwd: card.cwd,
    stdout: card.stdout,
    stderr: card.stderr,
    exitCode: card.exitCode,
    args: card.toolInput,
    structuredResult: card.structuredResult,
    contentItems: card.contentItems,
    sourceRef: card.sourceRef,
  };
}

function findMatchingChange(
  changes: ReadonlyArray<CodexRunChangeGroup>,
  usedChangeIds: Set<string>,
  action: "create" | "modify" | "delete",
  fullPath: string,
  diff?: string,
  sourceRef?: RuntimeSourceRef,
): CodexRunChangeGroup | undefined {
  const normalizedPath = fullPath.replace(/\\/g, "/").toLowerCase();
  const sourceItemId = sourceRef?.itemId;
  return changes.find((change) => {
    if (usedChangeIds.has(change.id)) return false;
    if (sourceItemId && change.sourceRef?.itemId === sourceItemId) return true;
    return change.action === action
      && change.fullPath.replace(/\\/g, "/").toLowerCase() === normalizedPath
      && (!diff || change.diff === diff);
  });
}

function buildFeedItems(
  model: AgentRunDisplayModel,
  changes: ReadonlyArray<CodexRunChangeGroup>,
): CodexRunFeedItem[] {
  const feed: CodexRunFeedItem[] = [];
  const usedChangeIds = new Set<string>();

  const pushChange = (
    id: string,
    action: "create" | "modify" | "delete",
    fullPath: string,
    diff?: string,
    approvalStatus?: CodexRunChangeGroup["approvalStatus"],
    timestamp?: string,
    sourceRef?: RuntimeSourceRef,
  ) => {
    const existing = findMatchingChange(changes, usedChangeIds, action, fullPath, diff, sourceRef);
    const change: CodexRunChangeGroup = existing ?? {
      id,
      action,
      fileName: basename(fullPath),
      relativePath: fullPath,
      fullPath,
      diffSummary: diffSummary(diff),
      diff,
      approvalStatus,
      timestamp,
      sourceRef,
    };
    usedChangeIds.add(change.id);
    feed.push({
      id: `feed-change-${change.id}`,
      kind: "file",
      icon: stepIcon("file"),
      label: `${actionLabel(change.action)} ${change.fileName}`,
      status: "completed",
      summary: [change.relativePath, change.diffSummary, change.approvalStatus ? `approval ${change.approvalStatus}` : ""].filter(Boolean).join(" · "),
      timestamp: change.timestamp ?? timestamp,
      durationMs: change.durationMs,
      change,
      sourceRef: change.sourceRef ?? sourceRef,
    });
  };

  for (const card of model.timelineCards) {
    if (card.kind === "warning" || card.kind === "error" || card.kind === "debug-raw-event") continue;
    if (card.kind === "thinking") {
      feed.push({
        id: `feed-${card.id}`,
        kind: "thinking",
        icon: stepIcon("thinking"),
        label: card.text ? "Thinking" : card.title,
        status: card.status,
        summary: thinkingSummary(card),
        detail: card.detail,
        timestamp: card.timestamp,
        sourceRef: card.sourceRef,
      });
      continue;
    }
    if (card.kind === "tool-call") {
      const step = stepFromToolCard(card);
      feed.push({
        id: `feed-${card.id}`,
        kind: step.kind,
        icon: step.icon,
        label: step.label,
        status: step.status,
        summary: card.summary,
        detail: card.detail,
        timestamp: card.timestamp,
        durationMs: step.durationMs,
        step,
        sourceRef: step.sourceRef,
      });
      continue;
    }
    if (card.kind === "file-change") {
      const nestedChanges = card.changes && card.changes.length > 0
        ? card.changes
        : card.path ? [{ action: card.action, path: card.path, diff: card.diff, approvalStatus: card.approvalStatus }] : [];
      nestedChanges.forEach((change, index) => {
        pushChange(
          `${card.id}-${index}`,
          change.action,
          change.path,
          change.diff,
          change.approvalStatus,
          card.timestamp,
          card.sourceRef,
        );
      });
      continue;
    }
    if (card.kind === "approval") {
      feed.push({
        id: `feed-${card.id}`,
        kind: "approval",
        icon: stepIcon("approval"),
        label: card.pending ? `Waiting approval: ${card.label}` : `Approval resolved: ${card.label}`,
        status: card.pending ? "pending" : "completed",
        summary: card.summary,
        detail: card.detail,
        timestamp: card.timestamp,
        sourceRef: card.sourceRef,
      });
      continue;
    }
    if (card.kind === "user-input") {
      feed.push({
        id: `feed-${card.id}`,
        kind: "user-input",
        icon: stepIcon("user-input"),
        label: card.pending ? "Waiting for user input" : "User input resolved",
        status: card.pending ? "pending" : "completed",
        summary: card.summary,
        detail: card.detail,
        timestamp: card.timestamp,
        sourceRef: card.sourceRef,
      });
      continue;
    }
    if (card.kind === "final-answer" && card.text.trim().length > 0) {
      feed.push({
        id: `feed-${card.id}`,
        kind: "assistant",
        icon: "message-square",
        label: "Output",
        status: card.status,
        summary: card.text,
        detail: card.detail,
        timestamp: card.timestamp,
        sourceRef: card.sourceRef,
      });
    }
  }

  for (const change of changes) {
    if (usedChangeIds.has(change.id)) continue;
    feed.push({
      id: `feed-change-${change.id}`,
      kind: "file",
      icon: stepIcon("file"),
      label: `${actionLabel(change.action)} ${change.fileName}`,
      status: "completed",
      summary: [change.relativePath, change.diffSummary, change.approvalStatus ? `approval ${change.approvalStatus}` : ""].filter(Boolean).join(" · "),
      timestamp: change.timestamp,
      durationMs: change.durationMs,
      change,
      sourceRef: change.sourceRef,
    });
    usedChangeIds.add(change.id);
  }

  return feed;
}

function buildStepGroups(model: AgentRunDisplayModel): CodexRunStepGroup[] {
  const steps: CodexRunStepGroup[] = [];
  for (const card of model.timelineCards) {
    if (card.kind === "warning" || card.kind === "error" || card.kind === "file-change" || card.kind === "final-answer" || card.kind === "debug-raw-event") continue;
    if (card.kind === "thinking") {
      steps.push({
        id: card.id,
        kind: "thinking",
        icon: stepIcon("thinking"),
        label: card.text ? "Reasoning" : card.title,
        status: card.status,
        sourceRef: card.sourceRef,
      });
      continue;
    }
    if (card.kind === "tool-call") {
      steps.push(stepFromToolCard(card));
      continue;
    }
    if (card.kind === "approval") {
      steps.push({
        id: card.id,
        kind: "approval",
        icon: stepIcon("approval"),
        label: card.pending ? `Approval requested: ${card.label}` : `Approval resolved: ${card.label}`,
        status: card.pending ? "pending" : "completed",
        sourceRef: card.sourceRef,
      });
      continue;
    }
    if (card.kind === "user-input") {
      steps.push({
        id: card.id,
        kind: "user-input",
        icon: stepIcon("user-input"),
        label: card.pending ? "User input requested" : "User input resolved",
        status: card.pending ? "pending" : "completed",
        sourceRef: card.sourceRef,
      });
    }
  }
  for (const change of model.fileChangeCards) {
    steps.push({
      id: `step-${change.id}`,
      kind: "file",
      icon: stepIcon("file"),
      label: `${actionLabel(change.action)} ${basename(change.path)}`,
      status: change.status,
      sourceRef: change.sourceRef,
    });
  }
  return steps;
}

function buildApprovalGates(model: AgentRunDisplayModel): CodexRunApprovalGate[] {
  return model.approvalCards.map((card: ApprovalCard) => ({
    id: card.id,
    requestId: card.requestId,
    action: card.label || card.toolName,
    risk: card.riskLevel,
    riskReason: card.riskReason,
    summary: card.inputSummary || card.description || card.summary,
    sourceRef: card.sourceRef,
  }));
}

function diagnosticKey(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildDiagnosticsGroups(model: AgentRunDisplayModel): CodexRunDiagnosticsGroup[] {
  const byKey = new Map<string, CodexRunDiagnosticsGroup>();
  const add = (severity: "warning" | "error", message: string) => {
    const key = `${severity}:${diagnosticKey(message)}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, count: existing.count + 1 });
    } else {
      byKey.set(key, {
        id: `diagnostic-${byKey.size}`,
        severity,
        message,
        count: 1,
      });
    }
  };
  for (const card of model.diagnosticCards) add("warning", card.message);
  for (const card of model.timelineCards) {
    if (card.kind === "error") add("error", card.message);
  }
  return Array.from(byKey.values());
}

export function buildCodexRunViewModel(
  model: AgentRunDisplayModel,
  turnView: AssistantTurnView,
  options: BuildCodexRunViewModelOptions,
): CodexRunViewModel {
  const stepGroups = buildStepGroups(model);
  const changeGroups = buildChangeGroups(model, turnView, options.cwd);
  const feedItems = buildFeedItems(model, changeGroups);
  const approvalGates = buildApprovalGates(model);
  const diagnosticsGroups = buildDiagnosticsGroups(model);
  const kind = statusKind(options.status, model);
  const commandCount = stepGroups.filter((step) => step.kind === "command").length;
  const approvalCount = model.approvalCards.length
    + stepGroups.filter((step) => step.kind === "approval").length;
  const durationMs = turnView.durationMs ?? (
    model.debugView?.effectiveRunPlan?.createdAt
      ? Math.max(0, Date.now() - new Date(model.debugView.effectiveRunPlan.createdAt).getTime())
      : undefined
  );
  return {
    runHeader: {
      status: statusLabel(kind, model),
      statusKind: kind,
      provider: options.providerLabel || turnView.providerId,
      model: options.modelLabel || model.debugView?.effectiveRunPlan?.model || "",
      elapsed: formatDuration(durationMs),
      fileChangeCount: changeGroups.length,
      commandCount,
      approvalCount,
      diagnosticCount: diagnosticsGroups.reduce((sum, group) => sum + group.count, 0),
    },
    currentActivity: normalizeActivity(model, stepGroups, kind, changeGroups),
    changeGroups,
    stepGroups,
    feedItems,
    approvalGates,
    diagnosticsGroups,
    finalAnswer: model.finalAnswer,
    debugPanel: options.developerMode ? model.debugView : undefined,
  };
}

export function formatCodexRunDuration(ms?: number): string {
  return formatDuration(ms);
}

export function formatCodexRunValue(value: unknown): string {
  return stringifyCompact(value);
}
