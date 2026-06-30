import {
  FileToolExecutionRequest,
  FileToolExecutionStatus,
  FileToolResult,
} from "./fileToolExecutor";
import { FileRef } from "./fileRefs";

export type AgentFileToolName = "stat" | "read" | "list" | "search";

export interface AgentFileToolRouteRequest {
  toolName: string;
  path: string;
  query?: string;
  source?: string;
  fileRefs?: FileRef[];
  knownProjectRootMarkers?: string[];
  limits?: FileToolExecutionRequest["limits"];
}

export interface AgentFileToolRouteResult {
  toolName: string;
  status: FileToolExecutionStatus | "deny";
  reason: string;
  result?: FileToolResult;
}

export type AgentFileToolRunner = (request: FileToolExecutionRequest) => Promise<FileToolResult>;

const READ_ONLY_AGENT_FILE_TOOLS = new Set<AgentFileToolName>(["stat", "read", "list", "search"]);

export function isReadOnlyAgentFileTool(toolName: string): toolName is AgentFileToolName {
  return READ_ONLY_AGENT_FILE_TOOLS.has(toolName.trim().toLowerCase() as AgentFileToolName);
}

export async function executeAgentFileToolRoute(
  request: AgentFileToolRouteRequest,
  runner: AgentFileToolRunner,
): Promise<AgentFileToolRouteResult> {
  const toolName = request.toolName.trim().toLowerCase();
  if (!isReadOnlyAgentFileTool(toolName)) {
    return { toolName: request.toolName, status: "deny", reason: "unsupported_file_tool" };
  }

  if (!request.path || request.path.trim().length === 0) {
    return { toolName, status: "deny", reason: "invalid_path" };
  }

  const result = await runner({
    operation: toolName,
    path: request.path,
    query: toolName === "search" ? request.query || "" : undefined,
    source: request.source || "agent-file-tool-route",
    fileRefs: request.fileRefs,
    knownProjectRootMarkers: request.knownProjectRootMarkers || [],
    limits: request.limits || {},
  });

  return {
    toolName,
    status: result.status,
    reason: result.reason,
    result,
  };
}

export function formatAgentFileToolRouteResult(routeResult: AgentFileToolRouteResult): string {
  const payload = routeResult.result || {
    toolName: routeResult.toolName,
    status: routeResult.status,
    reason: routeResult.reason,
  };
  return JSON.stringify(payload, null, 2);
}
