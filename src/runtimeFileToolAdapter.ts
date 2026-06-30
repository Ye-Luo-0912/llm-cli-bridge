import {
  AgentFileToolName,
  AgentFileToolRouteRequest,
  AgentFileToolRouteResult,
  formatAgentFileToolRouteResult,
  isReadOnlyAgentFileTool,
} from "./agentFileToolBridge";
import {
  DEFAULT_FILE_TOOL_MAX_LIST_DEPTH,
  DEFAULT_FILE_TOOL_MAX_LIST_ENTRIES,
  DEFAULT_FILE_TOOL_MAX_READ_BYTES,
  DEFAULT_FILE_TOOL_MAX_READ_CHARS,
  DEFAULT_FILE_TOOL_MAX_SEARCH_FILES,
  DEFAULT_FILE_TOOL_MAX_SEARCH_RESULTS,
  DEFAULT_FILE_TOOL_SEARCH_BYTES_PER_FILE,
  DEFAULT_FILE_TOOL_SEARCH_EXTENSIONS,
  FileToolExecutorLimits,
} from "./fileToolExecutor";

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
  return `runtime file tools: ${adapter.kind} read-only policy gate [${adapter.toolNames.join(", ")}]; native runtime handles Vault file operations; no write/delete/rename routes`;
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
    maxReadBytes: extractClampedPositiveInteger(input, "maxReadBytes", DEFAULT_FILE_TOOL_MAX_READ_BYTES),
    maxReadChars: extractClampedPositiveInteger(input, "maxReadChars", DEFAULT_FILE_TOOL_MAX_READ_CHARS),
    maxListEntries: extractClampedPositiveInteger(input, "maxListEntries", DEFAULT_FILE_TOOL_MAX_LIST_ENTRIES),
    maxListDepth: extractClampedPositiveInteger(input, "maxListDepth", DEFAULT_FILE_TOOL_MAX_LIST_DEPTH),
    maxSearchFiles: extractClampedPositiveInteger(input, "maxSearchFiles", DEFAULT_FILE_TOOL_MAX_SEARCH_FILES),
    maxSearchResults: extractClampedPositiveInteger(input, "maxSearchResults", DEFAULT_FILE_TOOL_MAX_SEARCH_RESULTS),
    maxSearchBytesPerFile: extractClampedPositiveInteger(input, "maxSearchBytesPerFile", DEFAULT_FILE_TOOL_SEARCH_BYTES_PER_FILE),
    searchExtensions: extractAllowedSearchExtensions(input),
  };
}

function extractClampedPositiveInteger(input: Record<string, unknown>, key: string, max: number): number | undefined {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return Math.min(value, max);
}

function extractAllowedSearchExtensions(input: Record<string, unknown>): string[] | undefined {
  const requested = extractStringArray(input, "searchExtensions");
  if (!requested) return undefined;
  const allowed = new Set(DEFAULT_FILE_TOOL_SEARCH_EXTENSIONS.map((ext) => ext.toLowerCase()));
  const filtered = requested
    .map((ext) => normalizeExtension(ext))
    .filter((ext): ext is string => !!ext && allowed.has(ext));
  return [...new Set(filtered)];
}

function normalizeExtension(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
