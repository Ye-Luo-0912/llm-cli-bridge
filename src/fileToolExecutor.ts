import * as fs from "fs";
import * as path from "path";
import {
  FileAccessPolicy,
  PendingExternalReadRequest,
  isSensitivePath,
} from "./fileAccessPolicy";
import { FileRef, FileRefFileType, classifyFileTypeByPath } from "./fileRefs";
import { FileToolOperation, evaluateFileToolPolicy } from "./fileToolPolicy";

export const DEFAULT_FILE_TOOL_MAX_READ_BYTES = 64 * 1024;
export const DEFAULT_FILE_TOOL_MAX_READ_CHARS = 24 * 1024;
export const DEFAULT_FILE_TOOL_MAX_LIST_ENTRIES = 200;
export const DEFAULT_FILE_TOOL_MAX_LIST_DEPTH = 2;
export const DEFAULT_FILE_TOOL_MAX_SEARCH_FILES = 200;
export const DEFAULT_FILE_TOOL_MAX_SEARCH_RESULTS = 50;
export const DEFAULT_FILE_TOOL_SEARCH_BYTES_PER_FILE = 32 * 1024;

export type FileToolExecutionStatus = "allow" | "confirm" | "deny" | "error";
export type FileToolReadMode = "content" | "truncated" | "refs-only";

export interface FileToolExecutorLimits {
  maxReadBytes?: number;
  maxReadChars?: number;
  maxListEntries?: number;
  maxListDepth?: number;
  maxSearchFiles?: number;
  maxSearchResults?: number;
  maxSearchBytesPerFile?: number;
  searchExtensions?: string[];
}

export interface FileToolExecutionRequest {
  operation: FileToolOperation;
  path: string;
  query?: string;
  source?: string;
  fileRefs?: FileRef[];
  knownProjectRootMarkers?: string[];
  limits?: FileToolExecutorLimits;
}

export interface FileToolResultBase {
  operation: FileToolOperation;
  status: FileToolExecutionStatus;
  reason: string;
  path: string;
  resolvedPath: string | null;
  fileType?: FileRefFileType;
  pendingRequest?: PendingExternalReadRequest;
}

export interface FileToolStatResult extends FileToolResultBase {
  operation: "stat";
  stat?: {
    size: number;
    mtime: string;
    isFile: boolean;
    isDirectory: boolean;
    fileType: FileRefFileType;
  };
}

export interface FileToolReadResult extends FileToolResultBase {
  operation: "read";
  readMode?: FileToolReadMode;
  content?: string;
  bytesRead?: number;
  truncated?: boolean;
  handoffHint?: string;
}

export interface FileToolListResult extends FileToolResultBase {
  operation: "list";
  entries?: Array<{
    name: string;
    path: string;
    isFile: boolean;
    isDirectory: boolean;
    fileType: FileRefFileType;
    size: number | null;
    mtime: string | null;
  }>;
  truncated?: boolean;
}

export interface FileToolSearchResult extends FileToolResultBase {
  operation: "search";
  query?: string;
  matches?: Array<{
    path: string;
    line: number;
    preview: string;
  }>;
  filesScanned?: number;
  truncated?: boolean;
}

export type FileToolResult = FileToolStatResult | FileToolReadResult | FileToolListResult | FileToolSearchResult;

const READABLE_TEXT_TYPES = new Set<FileRefFileType>(["text", "markdown", "json"]);
export const DEFAULT_FILE_TOOL_SEARCH_EXTENSIONS = [".md", ".markdown", ".txt", ".log", ".json", ".jsonc", ".csv", ".tsv", ".yaml", ".yml", ".toml"];

export async function executeFileTool(policy: FileAccessPolicy, request: FileToolExecutionRequest): Promise<FileToolResult> {
  const gate = evaluateFileToolPolicy(policy, {
    operation: request.operation,
    path: request.path,
    source: request.source || "agent",
    pathKind: request.operation === "list" || request.operation === "search" ? "directory" : "file",
    knownProjectRootMarkers: request.knownProjectRootMarkers || [],
    fileRefs: request.fileRefs || [],
  });

  const base = {
    operation: request.operation,
    path: request.path,
    resolvedPath: gate.resolvedPath,
  };

  if (gate.decision === "confirm") {
    return {
      ...base,
      status: "confirm",
      reason: gate.reason,
      pendingRequest: gate.pendingRequest || undefined,
    } as FileToolResult;
  }

  if (gate.decision === "deny" || !gate.resolvedPath) {
    return {
      ...base,
      status: "deny",
      reason: gate.reason,
    } as FileToolResult;
  }

  try {
    const target = await resolveRealExecutionTarget(policy, request, gate.resolvedPath);
    if (target.status === "confirm") {
      return {
        ...base,
        resolvedPath: target.resolvedPath,
        status: "confirm",
        reason: target.reason,
        pendingRequest: target.pendingRequest || undefined,
      } as FileToolResult;
    }
    if (target.status === "deny") {
      return {
        ...base,
        resolvedPath: target.resolvedPath,
        status: "deny",
        reason: target.reason,
      } as FileToolResult;
    }

    const realBase = { ...base, resolvedPath: target.resolvedPath };
    if (request.operation === "stat") return await executeStat(realBase, target.resolvedPath);
    if (request.operation === "read") return await executeRead(realBase, target.resolvedPath, request.limits || {});
    if (request.operation === "list") return await executeList(realBase, target.resolvedPath, request.limits || {});
    return await executeSearch(realBase, target.resolvedPath, request.query || "", request.limits || {});
  } catch (error) {
    return {
      ...base,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      fileType: gate.resolvedPath ? classifyFileTypeByPath(gate.resolvedPath) : undefined,
    } as FileToolResult;
  }
}

async function resolveRealExecutionTarget(
  policy: FileAccessPolicy,
  request: FileToolExecutionRequest,
  resolvedPath: string,
): Promise<{
  status: "allow" | "confirm" | "deny";
  reason: string;
  resolvedPath: string;
  pendingRequest?: PendingExternalReadRequest | null;
}> {
  const lstat = await fs.promises.lstat(resolvedPath);
  const realPath = await fs.promises.realpath(resolvedPath);
  if (isSensitivePath(resolvedPath) || isSensitivePath(realPath)) {
    return { status: "deny", reason: "sensitive_path", resolvedPath: realPath };
  }

  const pathChanged = normalizeForCompare(realPath) !== normalizeForCompare(resolvedPath);
  const isSymlink = lstat.isSymbolicLink();
  if (!pathChanged && !isSymlink) {
    return { status: "allow", reason: "realpath_authorized", resolvedPath: realPath };
  }

  const realGate = evaluateFileToolPolicy(policy, {
    operation: request.operation,
    path: realPath,
    source: request.source || "agent",
    pathKind: request.operation === "list" || request.operation === "search" ? "directory" : "file",
    knownProjectRootMarkers: request.knownProjectRootMarkers || [],
    fileRefs: request.fileRefs || [],
  });
  if (realGate.decision === "confirm") {
    return {
      status: "confirm",
      reason: realGate.reason,
      resolvedPath: realGate.resolvedPath || realPath,
      pendingRequest: realGate.pendingRequest,
    };
  }
  if (realGate.decision === "deny" || !realGate.resolvedPath) {
    return { status: "deny", reason: realGate.reason, resolvedPath: realGate.resolvedPath || realPath };
  }
  return { status: "allow", reason: "realpath_authorized", resolvedPath: realGate.resolvedPath };
}

async function executeStat(base: Pick<FileToolResultBase, "operation" | "path" | "resolvedPath">, resolvedPath: string): Promise<FileToolStatResult> {
  const stat = await fs.promises.stat(resolvedPath);
  const fileType = classifyFileTypeByPath(resolvedPath);
  return {
    ...base,
    operation: "stat",
    status: "allow",
    reason: "executed",
    fileType,
    stat: {
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      fileType,
    },
  };
}

async function executeRead(
  base: Pick<FileToolResultBase, "operation" | "path" | "resolvedPath">,
  resolvedPath: string,
  limits: FileToolExecutorLimits,
): Promise<FileToolReadResult> {
  const fileType = classifyFileTypeByPath(resolvedPath);
  if (isSensitivePath(resolvedPath)) {
    return { ...base, operation: "read", status: "deny", reason: "sensitive_path", fileType };
  }
  if (!READABLE_TEXT_TYPES.has(fileType)) {
    return {
      ...base,
      operation: "read",
      status: "allow",
      reason: "refs_only",
      fileType,
      readMode: "refs-only",
      handoffHint: `Refs-only file. Ask Claude Code to use Read on this path if inspection is needed: ${resolvedPath}`,
    };
  }

  const stat = await fs.promises.stat(resolvedPath);
  if (!stat.isFile()) {
    return { ...base, operation: "read", status: "deny", reason: "not_file", fileType };
  }

  const maxBytes = limits.maxReadBytes ?? DEFAULT_FILE_TOOL_MAX_READ_BYTES;
  const maxChars = limits.maxReadChars ?? DEFAULT_FILE_TOOL_MAX_READ_CHARS;
  const bytesToRead = Math.min(stat.size, maxBytes);
  const handle = await fs.promises.open(resolvedPath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const decoded = buffer.subarray(0, bytesRead).toString("utf8");
    const charTruncated = decoded.length > maxChars;
    const byteTruncated = stat.size > maxBytes;
    const content = charTruncated ? decoded.slice(0, maxChars) : decoded;
    return {
      ...base,
      operation: "read",
      status: "allow",
      reason: "executed",
      fileType,
      readMode: byteTruncated || charTruncated ? "truncated" : "content",
      content,
      bytesRead,
      truncated: byteTruncated || charTruncated,
    };
  } finally {
    await handle.close();
  }
}

async function executeList(
  base: Pick<FileToolResultBase, "operation" | "path" | "resolvedPath">,
  resolvedPath: string,
  limits: FileToolExecutorLimits,
): Promise<FileToolListResult> {
  const maxEntries = limits.maxListEntries ?? DEFAULT_FILE_TOOL_MAX_LIST_ENTRIES;
  const maxDepth = limits.maxListDepth ?? DEFAULT_FILE_TOOL_MAX_LIST_DEPTH;
  const entries: NonNullable<FileToolListResult["entries"]> = [];
  await collectListEntries(resolvedPath, resolvedPath, 0, maxDepth, maxEntries, entries);
  return {
    ...base,
    operation: "list",
    status: "allow",
    reason: "executed",
    fileType: "unknown",
    entries,
    truncated: entries.length >= maxEntries,
  };
}

async function collectListEntries(
  root: string,
  current: string,
  depth: number,
  maxDepth: number,
  maxEntries: number,
  entries: NonNullable<FileToolListResult["entries"]>,
): Promise<void> {
  if (depth > maxDepth || entries.length >= maxEntries || isSensitivePath(current)) return;
  const dirents = await fs.promises.readdir(current, { withFileTypes: true });
  for (const dirent of dirents) {
    if (entries.length >= maxEntries) break;
    const childPath = path.join(current, dirent.name);
    if (isSensitivePath(childPath)) continue;
    const stat = await safeLstat(childPath);
    if (!stat || stat.isSymbolicLink()) continue;
    entries.push({
      name: dirent.name,
      path: childPath,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      fileType: classifyFileTypeByPath(childPath),
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    });
    if (stat.isDirectory() && depth + 1 <= maxDepth) {
      await collectListEntries(root, childPath, depth + 1, maxDepth, maxEntries, entries);
    }
  }
}

async function executeSearch(
  base: Pick<FileToolResultBase, "operation" | "path" | "resolvedPath">,
  resolvedPath: string,
  query: string,
  limits: FileToolExecutorLimits,
): Promise<FileToolSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { ...base, operation: "search", status: "deny", reason: "empty_query", query, fileType: "unknown" };
  }

  const maxFiles = limits.maxSearchFiles ?? DEFAULT_FILE_TOOL_MAX_SEARCH_FILES;
  const maxResults = limits.maxSearchResults ?? DEFAULT_FILE_TOOL_MAX_SEARCH_RESULTS;
  const maxBytes = limits.maxSearchBytesPerFile ?? DEFAULT_FILE_TOOL_SEARCH_BYTES_PER_FILE;
  const allowedExts = new Set((limits.searchExtensions || DEFAULT_FILE_TOOL_SEARCH_EXTENSIONS).map((ext) => ext.toLowerCase()));
  const files = await collectSearchFiles(resolvedPath, allowedExts, maxFiles);
  const matches: NonNullable<FileToolSearchResult["matches"]> = [];

  for (const filePath of files) {
    if (matches.length >= maxResults) break;
    if (isSensitivePath(filePath)) continue;
    const stat = await safeStat(filePath);
    if (!stat?.isFile() || stat.size > maxBytes) continue;
    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) break;
      if (!lines[i].toLowerCase().includes(trimmedQuery.toLowerCase())) continue;
      matches.push({ path: filePath, line: i + 1, preview: lines[i].slice(0, 240) });
    }
  }

  return {
    ...base,
    operation: "search",
    status: "allow",
    reason: "executed",
    fileType: "unknown",
    query,
    matches,
    filesScanned: files.length,
    truncated: files.length >= maxFiles || matches.length >= maxResults,
  };
}

async function collectSearchFiles(root: string, allowedExts: Set<string>, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    if (out.length >= maxFiles || isSensitivePath(current)) return;
    const stat = await safeLstat(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (allowedExts.has(path.extname(current).toLowerCase())) out.push(current);
      return;
    }
    if (!stat.isDirectory()) return;
    const dirents = await fs.promises.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      if (out.length >= maxFiles) break;
      await walk(path.join(current, dirent.name));
    }
  }
  await walk(root);
  return out;
}

function normalizeForCompare(input: string): string {
  const normalized = input.includes("\\") || /^[a-zA-Z]:[\\/]/.test(input)
    ? path.win32.normalize(input).toLowerCase()
    : path.posix.normalize(input);
  return normalized;
}

async function safeStat(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}

async function safeLstat(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.lstat(filePath);
  } catch {
    return null;
  }
}
