import {
  AgentFileToolName,
  AgentFileToolRouteRequest,
  AgentFileToolRouteResult,
  formatAgentFileToolRouteResult,
  isReadOnlyAgentFileTool,
} from "./agentFileToolBridge";
import { FileToolExecutorLimits } from "./fileToolExecutor";

export type RuntimeFileToolAdapterKind = "cli" | "sdk";

export interface RuntimeFileToolCall {
  toolName: string;
  input: Record<string, unknown>;
  callId?: string;
}

export interface RuntimeFileToolAdapterResult {
  adapterKind: RuntimeFileToolAdapterKind;
  toolName: string;
  status: AgentFileToolRouteResult["status"];
  reason: string;
  output: string;
  isError: boolean;
  routeResult: AgentFileToolRouteResult;
}

export interface RuntimeFileToolAdapter {
  readonly kind: RuntimeFileToolAdapterKind;
  readonly toolNames: ReadonlyArray<AgentFileToolName>;
  execute(call: RuntimeFileToolCall): Promise<RuntimeFileToolAdapterResult>;
}

export type RuntimeFileToolRouteRunner = (request: AgentFileToolRouteRequest) => Promise<AgentFileToolRouteResult>;

const TOOL_NAMES: ReadonlyArray<AgentFileToolName> = ["stat", "read", "list", "search"];

export function createRuntimeFileToolAdapter(
  kind: RuntimeFileToolAdapterKind,
  routeRunner: RuntimeFileToolRouteRunner,
): RuntimeFileToolAdapter {
  return {
    kind,
    toolNames: TOOL_NAMES,
    async execute(call: RuntimeFileToolCall): Promise<RuntimeFileToolAdapterResult> {
      return executeRuntimeFileToolAdapterCall(kind, call, routeRunner);
    },
  };
}

export async function executeRuntimeFileToolAdapterCall(
  kind: RuntimeFileToolAdapterKind,
  call: RuntimeFileToolCall,
  routeRunner: RuntimeFileToolRouteRunner,
): Promise<RuntimeFileToolAdapterResult> {
  const routeRequest = normalizeRuntimeFileToolCall(kind, call);
  const routeResult = await routeRunner(routeRequest);
  const output = formatAgentFileToolRouteResult(routeResult);
  return {
    adapterKind: kind,
    toolName: routeResult.toolName,
    status: routeResult.status,
    reason: routeResult.reason,
    output,
    isError: routeResult.status !== "allow",
    routeResult,
  };
}

export function normalizeRuntimeFileToolCall(
  kind: RuntimeFileToolAdapterKind,
  call: RuntimeFileToolCall,
): AgentFileToolRouteRequest {
  const toolName = call.toolName.trim().toLowerCase();
  if (!isReadOnlyAgentFileTool(toolName)) {
    return {
      toolName: call.toolName,
      path: extractPath(call.input) || "",
      source: `${kind}-runtime-file-tool`,
    };
  }

  return {
    toolName,
    path: extractPath(call.input) || "",
    query: toolName === "search" ? extractString(call.input, ["query", "pattern", "text"]) || "" : undefined,
    source: `${kind}-runtime-file-tool`,
    knownProjectRootMarkers: extractStringArray(call.input, "knownProjectRootMarkers"),
    limits: extractLimits(call.input),
  };
}

export function describeRuntimeFileToolAdapter(adapter: RuntimeFileToolAdapter | undefined): string {
  if (!adapter) return "runtime file tools: disabled";
  return `runtime file tools: ${adapter.kind} [${adapter.toolNames.join(", ")}]`;
}

function extractPath(input: Record<string, unknown>): string | null {
  return extractString(input, ["path", "file_path", "filePath", "requestedPath", "dir", "directory"]);
}

function extractString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function extractStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function extractLimits(input: Record<string, unknown>): FileToolExecutorLimits {
  return {
    maxReadBytes: extractPositiveInteger(input, "maxReadBytes"),
    maxReadChars: extractPositiveInteger(input, "maxReadChars"),
    maxListEntries: extractPositiveInteger(input, "maxListEntries"),
    maxListDepth: extractPositiveInteger(input, "maxListDepth"),
    maxSearchFiles: extractPositiveInteger(input, "maxSearchFiles"),
    maxSearchResults: extractPositiveInteger(input, "maxSearchResults"),
    maxSearchBytesPerFile: extractPositiveInteger(input, "maxSearchBytesPerFile"),
    searchExtensions: extractStringArray(input, "searchExtensions"),
  };
}

function extractPositiveInteger(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
