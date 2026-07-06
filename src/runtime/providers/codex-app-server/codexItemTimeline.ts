// LLM CLI Bridge — Codex item timeline reducer.
//
// Codex app-server 的真实数据源是 thread/turn/item。这里把带 sourceRef 的
// NormalizedRuntimeEvent 还原为 provider-neutral TurnTimelineNode，供 UI 渲染。

import type { NormalizedRuntimeEvent, RuntimeSourceRef, TurnTimelineNode } from "../../core/types";

interface CodexItemRecord {
  readonly itemId: string;
  readonly kind: TurnTimelineNode["kind"];
  sourceRef?: RuntimeSourceRef;
  node: TurnTimelineNode;
}

function sourceKey(ref?: RuntimeSourceRef): string | null {
  return ref?.itemId ?? null;
}

function requestIdMatches(a: string | number | undefined, b: string | number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (String(a) === String(b)) return true;
  return `codex-req-${a}` === String(b) || String(a) === `codex-req-${b}`;
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function inferKind(method: string | undefined, payload: NormalizedRuntimeEvent["payload"]): TurnTimelineNode["kind"] {
  const payloadKind = payload.kind;
  if (method?.includes("reasoning")) return "reasoning";
  if (method?.includes("plan")) return "plan";
  if (method?.includes("commandExecution")) return "commandExecution";
  if (method?.includes("fileChange")) return "fileChange";
  if (method?.includes("requestUserInput")) return "userInput";
  if (payloadKind === "progress") {
    if (payload.label === "plan") return "plan";
    if (payload.label === "fileChange") return "fileChange";
    if (payload.label === "webSearch") return "webSearch";
    if (payload.label === "imageView") return "imageView";
    if (payload.label === "enteredReviewMode" || payload.label === "exitedReviewMode") return "reviewMode";
    if (payload.label === "contextCompaction") return "contextCompaction";
  }
  if (payloadKind === "tool_start") {
    if (payload.server) return "mcpToolCall";
    if (payload.toolName !== "Bash" && payload.toolName !== "unknown") return "dynamicToolCall";
  }
  if (payloadKind === "message") return "agentMessage";
  if (payloadKind === "thinking") return "reasoning";
  if (payloadKind === "tool_start" || payloadKind === "tool_result") return "commandExecution";
  if (payloadKind === "file_change") return "fileChange";
  if (payloadKind === "approval_request" || payloadKind === "approval_resolved") return "approval";
  return "status";
}

function titleForKind(kind: TurnTimelineNode["kind"], fallback: string): string {
  switch (kind) {
    case "agentMessage": return "Assistant message";
    case "reasoning": return "Reasoning";
    case "plan": return "Plan";
    case "commandExecution": return "Command";
    case "fileChange": return "File change";
    case "mcpToolCall": return "MCP tool";
    case "dynamicToolCall": return "Dynamic tool";
    case "webSearch": return "Web search";
    case "imageView": return "Image";
    case "reviewMode": return "Review mode";
    case "contextCompaction": return "Context compaction";
    case "approval": return "Approval";
    case "userInput": return "User input";
    default: return fallback || "Status";
  }
}

export class CodexItemTimelineReducer {
  private readonly itemMap = new Map<string, CodexItemRecord>();
  private readonly order: string[] = [];
  private sequence = 0;
  private turnClosed = false;

  ingest(event: NormalizedRuntimeEvent): ReadonlyArray<TurnTimelineNode> {
    if (event.providerId !== "codex-app-server" && event.providerId !== "codex-managed-app-server") {
      return this.toNodes();
    }
    const ref = event.sourceRef;
    const method = ref?.method;
    const itemId = sourceKey(ref);
    const payload = event.payload;

    if (method === "turn/completed" || payload.kind === "completed") {
      this.turnClosed = true;
      for (const record of this.itemMap.values()) {
        if (record.node.status === "running") {
          record.node.status = "completed";
          record.node.endedAt = event.timestamp;
        }
      }
      return this.toNodes();
    }

    if (method === "turn/failed" || payload.kind === "failed") {
      this.turnClosed = true;
      for (const record of this.itemMap.values()) {
        if (record.node.status === "running" || record.node.status === "blocked") {
          record.node.status = "failed";
          record.node.endedAt = event.timestamp;
        }
      }
      return this.toNodes();
    }

    if (payload.kind === "approval_resolved") {
      const requestId = payload.requestId;
      for (const record of this.itemMap.values()) {
        const sameRequest = requestIdMatches(record.node.sourceRef?.serverRequestId, requestId);
        const sameItem = !!itemId && record.itemId === itemId;
        if (sameRequest || sameItem) {
          record.node.approvalStatus = payload.response.type === "accept" || payload.response.type === "acceptForSession"
            ? "approved"
            : payload.response.type === "cancel" ? "cancelled" : "declined";
          record.node.status = "resolved";
          record.node.endedAt = event.timestamp;
        }
      }
      return this.toNodes();
    }

    if (payload.kind === "user_input_resolved") {
      const requestId = payload.requestId;
      for (const record of this.itemMap.values()) {
        const sameRequest = requestIdMatches(record.node.sourceRef?.serverRequestId, requestId);
        const sameItem = !!itemId && record.itemId === itemId;
        if (sameRequest || sameItem) {
          record.node.status = "resolved";
          record.node.endedAt = event.timestamp;
          record.node.result = payload.response;
        }
      }
      return this.toNodes();
    }

    if (!itemId && payload.kind === "progress" && payload.category === "status") {
      const statusId = `${method ?? "status"}:${ref?.turnId ?? ref?.threadId ?? ref?.sequence ?? this.sequence++}`;
      const record = this.ensureRecord(statusId, "status", event, titleForKind("status", payload.label));
      record.node.status = "completed";
      record.node.summary = payload.label;
      record.node.detail = payload.detail;
      record.node.endedAt = event.timestamp;
      return this.toNodes();
    }

    if (!itemId && payload.kind !== "approval_request" && payload.kind !== "user_input_request") {
      return this.toNodes();
    }

    if (payload.kind === "approval_request") {
      const approvalId = itemId || payload.requestId;
      const approvalKind = itemId ? inferKind(method, payload) : "approval";
      const record = this.ensureRecord(approvalId, approvalKind, event, titleForKind(approvalKind, "Approval"));
      record.node.status = "blocked";
      record.node.approvalStatus = "pending";
      record.node.summary = payload.description || payload.inputSummary || payload.toolName;
      record.node.detail = payload.inputSummary || payload.riskReason;
      record.node.sourceRef = { ...ref, serverRequestId: payload.requestId };
      return this.toNodes();
    }

    if (payload.kind === "user_input_request") {
      const inputId = itemId || payload.requestId;
      const record = this.ensureRecord(inputId, "userInput", event, "User input");
      record.node.status = "blocked";
      record.node.summary = payload.prompt;
      record.node.detail = payload.placeholder;
      record.node.sourceRef = { ...ref, serverRequestId: payload.requestId };
      return this.toNodes();
    }

    const kind = inferKind(method, payload);
    const record = this.ensureRecord(itemId!, kind, event, titleForKind(kind, payload.kind));

    switch (payload.kind) {
      case "message":
        record.node.text = (record.node.text || "") + (payload.partial ? payload.text : "");
        if (!payload.partial) record.node.text = payload.text;
        record.node.summary = record.node.text?.slice(0, 120);
        break;
      case "thinking":
        record.node.text = (record.node.text || "") + payload.text;
        record.node.summary = record.node.text?.slice(0, 120);
        break;
      case "tool_start":
        record.node.tool = payload.toolName;
        record.node.args = payload.args ?? payload.toolInput;
        record.node.server = payload.server;
        record.node.cwd = payload.cwd;
        record.node.summary = payload.toolName;
        if (payload.command !== undefined) {
          record.node.command = payload.command;
        } else if (payload.toolName === "Bash") {
          try {
            record.node.command = JSON.parse(payload.toolInput);
          } catch {
            record.node.command = payload.toolInput;
          }
        }
        break;
      case "progress":
        if (kind === "commandExecution" || kind === "fileChange") {
          if (/stderr/i.test(payload.label)) {
            record.node.stderr = `${record.node.stderr || ""}${payload.detail || ""}`;
          } else {
            record.node.stdout = `${record.node.stdout || ""}${payload.detail || ""}`;
          }
          record.node.summary = payload.label;
        } else if (kind === "plan" || kind === "reasoning") {
          record.node.text = `${record.node.text || ""}${payload.detail || ""}`;
          record.node.summary = record.node.text?.slice(0, 120);
        } else {
          record.node.detail = [record.node.detail, payload.detail || payload.label].filter(Boolean).join("\n");
          record.node.summary = payload.detail || payload.label;
        }
        break;
      case "tool_result":
        record.node.result = payload.output;
        if (payload.result !== undefined) record.node.result = payload.result;
        if (payload.contentItems !== undefined) record.node.contentItems = payload.contentItems;
        record.node.durationMs = payload.durationMs;
        record.node.exitCode = payload.exitCode;
        record.node.status = payload.isError ? "failed" : "completed";
        record.node.endedAt = event.timestamp;
        record.node.summary = payload.toolName;
        if (kind === "commandExecution") {
          record.node.stdout = record.node.stdout || payload.output;
        }
        break;
      case "file_change":
        record.node.path = payload.path;
        record.node.action = payload.action;
        record.node.diff = payload.diff;
        record.node.approvalStatus = payload.approvalStatus ?? record.node.approvalStatus;
        record.node.fileChanges = [
          ...(record.node.fileChanges ?? []),
          {
            path: payload.path,
            action: payload.action,
            diff: payload.diff,
            approvalStatus: payload.approvalStatus ?? record.node.approvalStatus,
          },
        ];
        record.node.summary = `${payload.action} ${payload.path}`;
        record.node.status = "completed";
        record.node.endedAt = event.timestamp;
        break;
      default:
        record.node.detail = stringifyValue(payload);
        break;
    }

    if (method === "item/completed" && record.node.status === "running") {
      record.node.status = "completed";
      record.node.endedAt = event.timestamp;
    }
    return this.toNodes();
  }

  toNodes(): ReadonlyArray<TurnTimelineNode> {
    const nodes = this.order.map((id) => this.itemMap.get(id)?.node).filter((n): n is TurnTimelineNode => !!n);
    if (this.turnClosed) return nodes.map((node) => ({ ...node }));
    return nodes.map((node) => ({ ...node }));
  }

  private ensureRecord(
    itemId: string,
    kind: TurnTimelineNode["kind"],
    event: NormalizedRuntimeEvent,
    title: string,
  ): CodexItemRecord {
    const existing = this.itemMap.get(itemId);
    if (existing) return existing;
    const sourceRef = {
      ...event.sourceRef,
      sequence: event.sourceRef?.sequence ?? this.sequence++,
    };
    const node: TurnTimelineNode = {
      id: itemId,
      kind,
      status: "running",
      title,
      sourceRef,
      startedAt: event.timestamp,
    };
    const record = { itemId, kind, sourceRef, node };
    this.itemMap.set(itemId, record);
    this.order.push(itemId);
    return record;
  }
}
