import * as path from "path";

export type FileAccessOperation = "read" | "write" | "delete" | "rename";
export type FileAccessDecision = "allow" | "confirm" | "deny";
export type FileAccessRisk = "low" | "medium" | "high";

export type FileAccessReason =
  | "inside_read_root"
  | "inside_write_root"
  | "outside_read_roots"
  | "outside_write_roots"
  | "sensitive_path"
  | "path_traversal"
  | "invalid_path"
  | "rename_target_denied";

export interface FileAccessRoot {
  input: string;
  resolvedPath: string;
  kind: "vault" | "output" | "external";
}

export interface FileAccessPolicyConfig {
  vaultPath: string;
  outputDir?: string | null;
  externalReadRoots?: string[];
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

interface ParsedPath {
  input: string;
  resolvedPath: string;
  flavor: "win32" | "posix";
}

export function createFileAccessPolicy(config: FileAccessPolicyConfig): FileAccessPolicy {
  const vault = parseRootPath(config.vaultPath);
  const readRoots = dedupeRoots([
    { input: config.vaultPath, resolvedPath: vault.resolvedPath, kind: "vault" as const },
    ...(config.externalReadRoots || []).map((root) => {
      const parsed = parseRootPath(root);
      return { input: root, resolvedPath: parsed.resolvedPath, kind: "external" as const };
    }),
  ]);

  const writeRoots: FileAccessRoot[] = [
    { input: config.vaultPath, resolvedPath: vault.resolvedPath, kind: "vault" },
  ];

  const outputDir = (config.outputDir || "").trim();
  if (outputDir) {
    const outputPath = resolveCandidatePath(config.vaultPath, outputDir);
    if (outputPath && isPathInside(outputPath.resolvedPath, vault.resolvedPath)) {
      writeRoots.push({ input: outputDir, resolvedPath: outputPath.resolvedPath, kind: "output" });
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
    return buildDecision(
      request.operation,
      policy.sensitivePathMode === "confirm" ? "confirm" : "deny",
      "sensitive_path",
      "high",
      parsed.resolvedPath,
    );
  }

  if (request.operation === "read") {
    const readRoot = findContainingRoot(parsed.resolvedPath, policy.readRoots);
    return readRoot
      ? buildDecision("read", "allow", "inside_read_root", readRoot.kind === "external" ? "medium" : "low", parsed.resolvedPath, readRoot)
      : buildDecision("read", "deny", "outside_read_roots", "medium", parsed.resolvedPath);
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
  return roots.find((root) => isPathInside(candidatePath, root.resolvedPath));
}

function dedupeRoots(roots: FileAccessRoot[]): FileAccessRoot[] {
  const seen = new Set<string>();
  const out: FileAccessRoot[] = [];
  for (const root of roots) {
    const key = root.resolvedPath;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
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
