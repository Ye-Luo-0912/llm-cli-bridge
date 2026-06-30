import * as path from "path";

export type FileAccessOperation = "read" | "write" | "delete" | "rename";
export type FileAccessDecision = "allow" | "confirm" | "deny";
export type FileAccessRisk = "low" | "medium" | "high";
export type FileAccessPathKind = "file" | "directory";
export type GrantRootSafety = "allow" | "confirm" | "deny";

export type FileAccessReason =
  | "inside_read_root"
  | "inside_write_root"
  | "pending_read_request"
  | "outside_read_roots"
  | "outside_write_roots"
  | "sensitive_path"
  | "path_traversal"
  | "invalid_path"
  | "rename_target_denied";

export interface FileAccessRoot {
  input: string;
  resolvedPath: string;
  kind: "vault" | "output" | "session-grant" | "attachment-grant";
  match: "file" | "directory";
}

export interface FileAccessReadGrant {
  path: string;
  scope: "session" | "attachment";
  match?: "file" | "directory";
  grantedAt?: string;
  source?: string;
}

export interface FileAccessPolicyConfig {
  vaultPath: string;
  outputDir?: string | null;
  sessionReadGrants?: FileAccessReadGrant[];
  attachmentReadGrants?: FileAccessReadGrant[];
  sensitivePathMode?: "deny" | "confirm";
}

export interface FileAccessPolicy {
  vaultPath: string;
  readRoots: FileAccessRoot[];
  writeRoots: FileAccessRoot[];
  sensitivePathMode: "deny" | "confirm";
}

export interface FileAccessRequest {
  operation: FileAccessOperation;
  path: string;
  targetPath?: string;
}

export interface FileAccessEvaluation {
  operation: FileAccessOperation;
  decision: FileAccessDecision;
  reason: FileAccessReason;
  risk: FileAccessRisk;
  resolvedPath: string | null;
  matchedRoot?: FileAccessRoot;
}

export interface PendingExternalReadRequest {
  id: string;
  requestedPath: string;
  resolvedPath: string;
  proposedGrantRoot: string | null;
  operation: "read";
  risk: FileAccessRisk;
  reason: FileAccessReason;
  createdAt: string;
  source: string;
  grantRootSafety: GrantRootSafety;
}

export interface PendingReadRequestOptions {
  pathKind?: FileAccessPathKind;
  source?: string;
  now?: string;
  knownProjectRootMarkers?: string[];
}

export interface SessionReadGrantStore {
  sessionReadGrants: FileAccessReadGrant[];
  pendingReadRequests: PendingExternalReadRequest[];
}

export interface PendingExternalReadApprovalOptions {
  grantedAt?: string;
  forceFileScope?: boolean;
  strongConfirm?: boolean;
  allowConfirmRoot?: boolean;
}

interface ParsedPath {
  input: string;
  resolvedPath: string;
  flavor: "win32" | "posix";
}

export function createFileAccessPolicy(config: FileAccessPolicyConfig): FileAccessPolicy {
  const vault = parseRootPath(config.vaultPath);
  const readRoots = dedupeRoots([
    { input: config.vaultPath, resolvedPath: vault.resolvedPath, kind: "vault" as const, match: "directory" as const },
    ...readGrantRoots(config.sessionReadGrants || [], "session-grant"),
    ...readGrantRoots(config.attachmentReadGrants || [], "attachment-grant"),
  ]);

  const writeRoots: FileAccessRoot[] = [
    { input: config.vaultPath, resolvedPath: vault.resolvedPath, kind: "vault", match: "directory" },
  ];

  const outputDir = (config.outputDir || "").trim();
  if (outputDir) {
    const outputPath = resolveCandidatePath(config.vaultPath, outputDir);
    if (outputPath && isPathInside(outputPath.resolvedPath, vault.resolvedPath)) {
      writeRoots.push({ input: outputDir, resolvedPath: outputPath.resolvedPath, kind: "output", match: "directory" });
    }
  }

  return {
    vaultPath: vault.resolvedPath,
    readRoots,
    writeRoots: dedupeRoots(writeRoots),
    sensitivePathMode: config.sensitivePathMode || "deny",
  };
}

export function evaluateFileAccess(policy: FileAccessPolicy, request: FileAccessRequest): FileAccessEvaluation {
  const parsed = resolveCandidatePath(policy.vaultPath, request.path);
  if (!parsed) {
    return buildDecision(request.operation, "deny", "invalid_path", "high", null);
  }

  if (hasPathTraversal(request.path)) {
    return buildDecision(request.operation, "deny", "path_traversal", "high", parsed.resolvedPath);
  }

  const sensitive = isSensitivePath(parsed.resolvedPath);
  if (sensitive) {
    const decision = request.operation === "read" && policy.sensitivePathMode === "confirm"
      ? "confirm"
      : "deny";
    return buildDecision(
      request.operation,
      decision,
      "sensitive_path",
      "high",
      parsed.resolvedPath,
    );
  }

  if (request.operation === "read") {
    const readRoot = findContainingRoot(parsed.resolvedPath, policy.readRoots);
    return readRoot
      ? buildDecision("read", "allow", "inside_read_root", readRoot.kind === "vault" ? "low" : "medium", parsed.resolvedPath, readRoot)
      : buildDecision("read", "confirm", "pending_read_request", "medium", parsed.resolvedPath);
  }

  const writeRoot = findContainingRoot(parsed.resolvedPath, policy.writeRoots);
  if (!writeRoot) {
    return buildDecision(request.operation, "deny", "outside_write_roots", "high", parsed.resolvedPath);
  }

  if (request.operation === "rename" && request.targetPath) {
    const target = resolveCandidatePath(policy.vaultPath, request.targetPath);
    if (!target || hasPathTraversal(request.targetPath) || isSensitivePath(target.resolvedPath)) {
      return buildDecision("rename", "deny", "rename_target_denied", "high", parsed.resolvedPath, writeRoot);
    }
    const targetRoot = findContainingRoot(target.resolvedPath, policy.writeRoots);
    if (!targetRoot) {
      return buildDecision("rename", "deny", "rename_target_denied", "high", parsed.resolvedPath, writeRoot);
    }
  }

  return buildDecision(request.operation, "allow", "inside_write_root", writeRoot.kind === "output" ? "low" : "medium", parsed.resolvedPath, writeRoot);
}

export function createSessionReadGrantStore(): SessionReadGrantStore {
  return { sessionReadGrants: [], pendingReadRequests: [] };
}

export function createPendingExternalReadRequest(
  policy: FileAccessPolicy,
  request: FileAccessRequest,
  options: PendingReadRequestOptions = {},
): PendingExternalReadRequest | null {
  const evaluation = evaluateFileAccess(policy, request);
  if (request.operation !== "read" || evaluation.decision !== "confirm" || evaluation.reason !== "pending_read_request" || !evaluation.resolvedPath) {
    return null;
  }

  const proposed = inferProposedGrantRoot(evaluation.resolvedPath, {
    pathKind: options.pathKind || "file",
    knownProjectRootMarkers: options.knownProjectRootMarkers || [],
  });
  const safety = proposed ? assessGrantRootSafety(proposed) : "deny";
  const risk: FileAccessRisk = safety === "allow" ? "medium" : "high";
  const createdAt = options.now || new Date().toISOString();
  const source = options.source || "agent";

  return {
    id: stablePendingReadRequestId(evaluation.resolvedPath, createdAt, source),
    requestedPath: request.path,
    resolvedPath: evaluation.resolvedPath,
    proposedGrantRoot: proposed,
    operation: "read",
    risk,
    reason: evaluation.reason,
    createdAt,
    source,
    grantRootSafety: safety,
  };
}

export function enqueuePendingExternalReadRequest(
  store: SessionReadGrantStore,
  pending: PendingExternalReadRequest | null,
): SessionReadGrantStore {
  if (!pending) return store;
  if (store.pendingReadRequests.some((item) => item.id === pending.id)) return store;
  return {
    sessionReadGrants: [...store.sessionReadGrants],
    pendingReadRequests: [...store.pendingReadRequests, pending],
  };
}

export function approvePendingExternalReadRequest(
  store: SessionReadGrantStore,
  requestId: string,
  options: PendingExternalReadApprovalOptions = {},
): SessionReadGrantStore {
  const pending = store.pendingReadRequests.find((item) => item.id === requestId);
  const confirmApproved = pending?.grantRootSafety === "confirm" && (options.strongConfirm === true || options.allowConfirmRoot === true);
  if (!pending || !pending.proposedGrantRoot || (pending.grantRootSafety !== "allow" && !confirmApproved)) {
    return store;
  }

  const grant: FileAccessReadGrant = {
    path: options.forceFileScope ? pending.resolvedPath : pending.proposedGrantRoot,
    scope: "session",
    match: options.forceFileScope ? "file" : "directory",
    grantedAt: options.grantedAt || new Date().toISOString(),
    source: pending.source,
  };

  return {
    sessionReadGrants: dedupeReadGrants([...store.sessionReadGrants, grant]),
    pendingReadRequests: store.pendingReadRequests.filter((item) => item.id !== requestId),
  };
}

export function inferProposedGrantRoot(
  resolvedPath: string,
  options: { pathKind?: FileAccessPathKind; knownProjectRootMarkers?: string[] } = {},
): string {
  if (options.pathKind === "directory") {
    return parseRootPath(resolvedPath).resolvedPath;
  }

  const filePath = parseRootPath(resolvedPath);
  const pathApi = filePath.flavor === "win32" ? path.win32 : path.posix;
  const parentDir = pathApi.dirname(filePath.resolvedPath);
  const projectRoot = inferKnownProjectRoot(parentDir, options.knownProjectRootMarkers || []);
  return projectRoot || parentDir;
}

export function assessGrantRootSafety(rootPath: string): GrantRootSafety {
  const parsed = parseRootPath(rootPath);
  const pathApi = parsed.flavor === "win32" ? path.win32 : path.posix;
  const root = pathApi.parse(parsed.resolvedPath).root;
  if (parsed.resolvedPath === normalizeCase(root, parsed.flavor)) return "deny";

  const normalized = parsed.resolvedPath.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts[parts.length - 1] || "";
  if (parsed.flavor === "win32" && /^c:$/.test(parts[0] || "")) {
    const systemDirs = ["windows", "program files", "program files (x86)", "programdata"];
    if (systemDirs.includes((parts[1] || "").toLowerCase())) return "deny";
    if ((parts[1] || "").toLowerCase() === "users" && parts.length === 3) return "confirm";
  }
  if (parsed.flavor === "posix" && ["/home", "/users"].includes(normalized)) return "deny";
  if (["desktop", "downloads"].includes(basename)) return "confirm";
  return "allow";
}

export function normalizeFileAccessPath(input: string, basePath?: string): string | null {
  const parsed = resolveCandidatePath(basePath || "", input);
  return parsed?.resolvedPath || null;
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const candidate = parseRootPath(candidatePath);
  const root = parseRootPath(rootPath);
  if (candidate.flavor !== root.flavor) return false;

  const pathApi = candidate.flavor === "win32" ? path.win32 : path.posix;
  const rel = pathApi.relative(root.resolvedPath, candidate.resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !pathApi.isAbsolute(rel));
}

export function isSensitivePath(candidatePath: string): boolean {
  const normalized = candidatePath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] || "";
  const joined = `/${segments.join("/")}`;

  if (segments.includes(".ssh")) return true;
  if (segments.includes(".obsidian")) return true;
  if (joined.endsWith("/.git/config") || joined.includes("/.git/config/")) return true;
  if (segments.includes(".llm-bridge") && /(bridge\.json|token|credential|secret)/i.test(normalized)) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (/(^|[-_.])(token|credentials?|secrets?)([-_.]|$)/i.test(basename)) return true;
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/i.test(basename) && !basename.endsWith(".pub")) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(basename)) return true;
  return false;
}

function resolveCandidatePath(basePath: string, input: string): ParsedPath | null {
  const trimmed = (input || "").trim();
  if (!trimmed || trimmed.includes("\0")) return null;

  const flavor = inferPathFlavor(trimmed, basePath);
  const pathApi = flavor === "win32" ? path.win32 : path.posix;
  const base = basePath ? parseRootPath(basePath).resolvedPath : "";
  const resolvedPath = pathApi.isAbsolute(trimmed)
    ? pathApi.normalize(trimmed)
    : pathApi.resolve(base || pathApi.sep, trimmed);
  return { input, resolvedPath: normalizeCase(resolvedPath, flavor), flavor };
}

function parseRootPath(input: string): ParsedPath {
  const flavor = inferPathFlavor(input);
  const pathApi = flavor === "win32" ? path.win32 : path.posix;
  const resolvedPath = pathApi.resolve(pathApi.normalize(input));
  return { input, resolvedPath: normalizeCase(resolvedPath, flavor), flavor };
}

function inferPathFlavor(input: string, fallback = ""): "win32" | "posix" {
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.includes("\\")) return "win32";
  if (/^[a-zA-Z]:[\\/]/.test(fallback) || fallback.includes("\\")) return "win32";
  return "posix";
}

function normalizeCase(input: string, flavor: "win32" | "posix"): string {
  return flavor === "win32" ? input.toLowerCase() : input;
}

function hasPathTraversal(input: string): boolean {
  return input.replace(/\\/g, "/").split("/").some((segment) => segment === "..");
}

function findContainingRoot(candidatePath: string, roots: FileAccessRoot[]): FileAccessRoot | undefined {
  return roots.find((root) => {
    if (root.match === "file") {
      return parseRootPath(candidatePath).resolvedPath === root.resolvedPath;
    }
    return isPathInside(candidatePath, root.resolvedPath);
  });
}

function dedupeRoots(roots: FileAccessRoot[]): FileAccessRoot[] {
  const seen = new Set<string>();
  const out: FileAccessRoot[] = [];
  for (const root of roots) {
    const key = `${root.kind}:${root.match}:${root.resolvedPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

function readGrantRoots(grants: FileAccessReadGrant[], kind: "session-grant" | "attachment-grant"): FileAccessRoot[] {
  const roots: FileAccessRoot[] = [];
  for (const grant of grants) {
    if (grant.scope === "session" && kind !== "session-grant") continue;
    if (grant.scope === "attachment" && kind !== "attachment-grant") continue;
    const parsed = parseRootPath(grant.path);
    roots.push({
      input: grant.path,
      resolvedPath: parsed.resolvedPath,
      kind,
      match: grant.match || "file",
    });
  }
  return roots;
}

function dedupeReadGrants(grants: FileAccessReadGrant[]): FileAccessReadGrant[] {
  const seen = new Set<string>();
  const out: FileAccessReadGrant[] = [];
  for (const grant of grants) {
    const parsed = parseRootPath(grant.path);
    const key = `${grant.scope}:${grant.match || "file"}:${parsed.resolvedPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(grant);
  }
  return out;
}

function inferKnownProjectRoot(parentDir: string, knownProjectRootMarkers: string[]): string | null {
  const parent = parseRootPath(parentDir);
  const pathApi = parent.flavor === "win32" ? path.win32 : path.posix;
  let bestRoot: string | null = null;

  for (const marker of knownProjectRootMarkers) {
    const markerPath = parseRootPath(marker);
    if (markerPath.flavor !== parent.flavor) continue;
    const markerName = pathApi.basename(markerPath.resolvedPath).toLowerCase();
    if (![".git", "package.json", ".sln", ".csproj", "pyproject.toml", "go.mod", "cargo.toml"].some((name) => markerName === name || markerName.endsWith(name))) {
      continue;
    }
    const markerRoot = pathApi.dirname(markerPath.resolvedPath);
    if (!isPathInside(parent.resolvedPath, markerRoot)) continue;
    if (!bestRoot || markerRoot.length > bestRoot.length) {
      bestRoot = markerRoot;
    }
  }

  return bestRoot;
}

function stablePendingReadRequestId(resolvedPath: string, createdAt: string, source: string): string {
  let hash = 2166136261;
  const input = `${resolvedPath}|${createdAt}|${source}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `read-${(hash >>> 0).toString(16)}`;
}

function buildDecision(
  operation: FileAccessOperation,
  decision: FileAccessDecision,
  reason: FileAccessReason,
  risk: FileAccessRisk,
  resolvedPath: string | null,
  matchedRoot?: FileAccessRoot,
): FileAccessEvaluation {
  return { operation, decision, reason, risk, resolvedPath, matchedRoot };
}
