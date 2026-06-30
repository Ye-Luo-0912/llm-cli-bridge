import * as path from "path";
import {
  FileAccessPathKind,
  FileAccessPolicy,
  FileAccessReadGrant,
  PendingExternalReadRequest,
  evaluateFileAccess,
  isPathInside,
  normalizeFileAccessPath,
} from "./fileAccessPolicy";

export type FileRefKind = "vault" | "external" | "attachment";
export type FileRefSource = "agent" | "user" | "attachment" | string;
export type FileRefGrantScope = "none" | "session" | "attachment";
export type FileRefStatus = "active" | "pending" | "denied";
export type FileRefFileType = "image" | "text" | "markdown" | "json" | "pdf" | "binary" | "unknown";

export interface FileRef {
  id: string;
  kind: FileRefKind;
  displayName: string;
  requestedPath: string;
  resolvedPath: string;
  pathKind: FileAccessPathKind;
  fileType: FileRefFileType;
  source: FileRefSource;
  grantScope: FileRefGrantScope;
  createdAt: string;
  status: FileRefStatus;
}

export interface WorkingSet {
  refs: FileRef[];
}

export interface AttachmentFileRefResult {
  ref: FileRef;
  readGrant: FileAccessReadGrant;
}

export function createWorkingSet(): WorkingSet {
  return { refs: [] };
}

export function addFileRefToWorkingSet(workingSet: WorkingSet, ref: FileRef | null): WorkingSet {
  if (!ref) return workingSet;
  const refs = workingSet.refs.filter((item) => item.id !== ref.id);
  return { refs: [...refs, ref] };
}

export function createVaultFileRef(
  policy: FileAccessPolicy,
  requestedPath: string,
  options: { pathKind?: FileAccessPathKind; source?: FileRefSource; now?: string } = {},
): FileRef | null {
  const evaluation = evaluateFileAccess(policy, { operation: "read", path: requestedPath });
  if (evaluation.decision !== "allow" || evaluation.matchedRoot?.kind !== "vault" || !evaluation.resolvedPath) {
    return null;
  }

  return buildFileRef({
    kind: "vault",
    requestedPath,
    resolvedPath: evaluation.resolvedPath,
    pathKind: options.pathKind || "file",
    fileType: classifyFileTypeByPath(evaluation.resolvedPath),
    source: options.source || "user",
    grantScope: "none",
    status: "active",
    createdAt: options.now,
  });
}

export function createAttachmentFileRef(
  vaultPath: string,
  requestedPath: string,
  options: { pathKind?: FileAccessPathKind; source?: FileRefSource; now?: string } = {},
): AttachmentFileRefResult | null {
  const resolvedPath = normalizeFileAccessPath(requestedPath, vaultPath);
  if (!resolvedPath) return null;
  const createdAt = options.now || new Date().toISOString();
  const source = options.source || "attachment";
  const ref = buildFileRef({
    kind: "attachment",
    requestedPath,
    resolvedPath,
    pathKind: options.pathKind || "file",
    fileType: classifyFileTypeByPath(resolvedPath),
    source,
    grantScope: "attachment",
    status: "active",
    createdAt,
  });

  return {
    ref,
    readGrant: {
      path: resolvedPath,
      scope: "attachment",
      match: "file",
      grantedAt: createdAt,
      source,
    },
  };
}

export function createExternalFileRefFromApprovedRequest(
  pending: PendingExternalReadRequest,
  sessionReadGrants: FileAccessReadGrant[],
  options: { now?: string } = {},
): FileRef | null {
  const grant = findReadGrantForPath(sessionReadGrants, pending.resolvedPath);
  if (!grant || grant.scope !== "session") return null;
  return buildFileRef({
    kind: "external",
    requestedPath: pending.requestedPath,
    resolvedPath: pending.resolvedPath,
    pathKind: pending.pathKind,
    fileType: classifyFileTypeByPath(pending.resolvedPath),
    source: pending.source,
    grantScope: "session",
    status: "active",
    createdAt: options.now,
  });
}

export function createPendingExternalFileRef(pending: PendingExternalReadRequest): FileRef {
  return buildFileRef({
    kind: "external",
    requestedPath: pending.requestedPath,
    resolvedPath: pending.resolvedPath,
    pathKind: pending.pathKind,
    fileType: classifyFileTypeByPath(pending.resolvedPath),
    source: pending.source,
    grantScope: "none",
    status: "pending",
    createdAt: pending.createdAt,
  });
}

export function classifyFileTypeByPath(filePath: string): FileRefFileType {
  const ext = path.extname(filePath).toLowerCase();
  if ([".md", ".markdown", ".mdown", ".mkd"].includes(ext)) return "markdown";
  if (ext === ".json" || ext === ".jsonc") return "json";
  if ([".txt", ".text", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf"].includes(ext)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if ([".zip", ".7z", ".rar", ".gz", ".tar", ".exe", ".dll", ".bin", ".wasm", ".class"].includes(ext)) return "binary";
  return "unknown";
}

export function workingSetContainsFileContent(workingSet: WorkingSet): boolean {
  return workingSet.refs.some((ref) =>
    Object.prototype.hasOwnProperty.call(ref, "content")
    || Object.prototype.hasOwnProperty.call(ref, "text")
    || Object.prototype.hasOwnProperty.call(ref, "body")
  );
}

function findReadGrantForPath(grants: FileAccessReadGrant[], resolvedPath: string): FileAccessReadGrant | null {
  for (const grant of grants) {
    const match = grant.match || "directory";
    if (match === "file" && normalizeFileAccessPath(grant.path) === resolvedPath) return grant;
    if (match === "directory" && isPathInside(resolvedPath, grant.path)) return grant;
  }
  return null;
}

function buildFileRef(input: Omit<FileRef, "id" | "displayName" | "createdAt"> & { createdAt?: string }): FileRef {
  const createdAt = input.createdAt || new Date().toISOString();
  return {
    ...input,
    id: stableFileRefId(input.kind, input.resolvedPath, input.source, input.grantScope),
    displayName: displayNameForPath(input.resolvedPath),
    createdAt,
  };
}

function displayNameForPath(resolvedPath: string): string {
  const normalized = resolvedPath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized);
  return basename || resolvedPath;
}

function stableFileRefId(kind: FileRefKind, resolvedPath: string, source: FileRefSource, grantScope: FileRefGrantScope): string {
  const raw = `${kind}|${resolvedPath}|${source}|${grantScope}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fileref-${kind}-${(hash >>> 0).toString(16)}`;
}
