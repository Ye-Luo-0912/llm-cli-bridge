import * as path from "path";
import {
  FileAccessEvaluation,
  FileAccessPathKind,
  FileAccessPolicy,
  FileAccessRisk,
  PendingExternalReadRequest,
  createPendingExternalReadRequest,
  evaluateFileAccess,
  isPathInside,
  normalizeFileAccessPath,
} from "./fileAccessPolicy";
import { FileRef } from "./fileRefs";

export type FileToolOperation = "read" | "stat" | "list" | "search";

export interface FileToolPolicyRequest {
  operation: FileToolOperation;
  path: string;
  source?: string;
  pathKind?: FileAccessPathKind;
  knownProjectRootMarkers?: string[];
  fileRefs?: FileRef[];
}

export interface FileToolPolicyDecision {
  operation: FileToolOperation;
  decision: "allow" | "confirm" | "deny";
  reason:
    | "fileref_allowed"
    | "inside_authorized_directory"
    | "pending_read_request"
    | "outside_authorized_roots"
    | "sensitive_path"
    | "path_traversal"
    | "invalid_path";
  risk: FileAccessRisk;
  resolvedPath: string | null;
  pendingRequest: PendingExternalReadRequest | null;
  matchedRefId?: string;
}

export function evaluateFileToolPolicy(policy: FileAccessPolicy, request: FileToolPolicyRequest): FileToolPolicyDecision {
  if (request.operation === "read" || request.operation === "stat") {
    return evaluateReadLikeTool(policy, request);
  }
  return evaluateDirectoryTool(policy, request);
}

function evaluateReadLikeTool(policy: FileAccessPolicy, request: FileToolPolicyRequest): FileToolPolicyDecision {
  const readEval = evaluateFileAccess(policy, { operation: "read", path: request.path });
  const fileRef = findActiveAuthorizedRef(policy, request.path, request.fileRefs || []);
  if (readEval.decision === "allow" && readEval.resolvedPath && fileRef) {
    return buildDecision(request.operation, "allow", "fileref_allowed", readEval.risk, readEval.resolvedPath, null, fileRef.id);
  }
  if (readEval.decision === "allow") {
    return fromReadEvaluation(request.operation, readEval, null);
  }
  if (readEval.decision === "confirm" && readEval.reason === "pending_read_request") {
    const pending = createPendingExternalReadRequest(
      policy,
      { operation: "read", path: request.path },
      {
        source: request.source || "agent",
        pathKind: request.pathKind || "file",
        knownProjectRootMarkers: request.knownProjectRootMarkers || [],
      },
    );
    return buildDecision(request.operation, "confirm", "pending_read_request", "medium", readEval.resolvedPath, pending);
  }
  return fromReadEvaluation(request.operation, readEval, null);
}

function evaluateDirectoryTool(policy: FileAccessPolicy, request: FileToolPolicyRequest): FileToolPolicyDecision {
  const readEval = evaluateFileAccess(policy, { operation: "read", path: request.path });
  if (!readEval.resolvedPath) {
    return fromReadEvaluation(request.operation, readEval, null);
  }
  if (readEval.decision !== "allow") {
    if (readEval.reason === "sensitive_path" || readEval.reason === "path_traversal" || readEval.reason === "invalid_path") {
      return fromReadEvaluation(request.operation, readEval, null);
    }
    return buildDecision(request.operation, "deny", "outside_authorized_roots", "high", readEval.resolvedPath, null);
  }
  const authorizedDirectory = policy.readRoots.some((root) => root.match === "directory" && isPathInside(readEval.resolvedPath!, root.resolvedPath));
  return authorizedDirectory
    ? buildDecision(request.operation, "allow", "inside_authorized_directory", readEval.risk, readEval.resolvedPath, null)
    : buildDecision(request.operation, "deny", "outside_authorized_roots", "high", readEval.resolvedPath, null);
}

function findActiveAuthorizedRef(policy: FileAccessPolicy, requestedPath: string, fileRefs: FileRef[]): FileRef | null {
  const resolvedPath = normalizeFileAccessPath(requestedPath, policy.vaultPath);
  if (!resolvedPath) return null;
  return fileRefs.find((ref) =>
    ref.status === "active"
    && (ref.kind === "vault" || ref.kind === "attachment" || ref.grantScope === "session")
    && normalizeForCompare(ref.resolvedPath) === normalizeForCompare(resolvedPath)
  ) || null;
}

function fromReadEvaluation(operation: FileToolOperation, evaluation: FileAccessEvaluation, pendingRequest: PendingExternalReadRequest | null): FileToolPolicyDecision {
  const reason = evaluation.reason === "sensitive_path"
    ? "sensitive_path"
    : evaluation.reason === "path_traversal"
      ? "path_traversal"
      : evaluation.reason === "invalid_path"
        ? "invalid_path"
        : evaluation.reason === "pending_read_request"
          ? "pending_read_request"
          : evaluation.decision === "allow"
            ? "inside_authorized_directory"
            : "outside_authorized_roots";
  return buildDecision(operation, evaluation.decision, reason, evaluation.risk, evaluation.resolvedPath, pendingRequest);
}

function buildDecision(
  operation: FileToolOperation,
  decision: FileToolPolicyDecision["decision"],
  reason: FileToolPolicyDecision["reason"],
  risk: FileAccessRisk,
  resolvedPath: string | null,
  pendingRequest: PendingExternalReadRequest | null,
  matchedRefId?: string,
): FileToolPolicyDecision {
  return { operation, decision, reason, risk, resolvedPath, pendingRequest, matchedRefId };
}

function normalizeForCompare(input: string): string {
  const normalized = input.includes("\\") || /^[a-zA-Z]:[\\/]/.test(input)
    ? path.win32.normalize(input).toLowerCase()
    : path.posix.normalize(input);
  return normalized;
}
