// LLM CLI Bridge — V17-RG Managed ripgrep resolver。
//
// 解析我们管理的 pinned rg.exe（不依赖用户系统 PATH 上的 rg）。
//
// 热路径只做轻量校验：
//   manifest 合法 → 平台条目 → 文件存在 → size(stat) → executable → 完整性缓存命中
// 禁止在热路径上 readFileSync / 同步 SHA-256。
//
// 只有 integrityStatus === "verified" 时 available=true 才可执行。
// 完整 SHA-256 在安装阶段完成，并按 {路径、大小、mtime、manifest 版本、expectedSha} 写入
// 磁盘缓存（runtime 旁 .integrity.json），避免插件重载后再次扫描文件。

import { createReadStream, existsSync, readFileSync, writeFileSync, unlinkSync, accessSync, constants, statSync } from "fs";
import { createHash } from "crypto";
import { join, resolve, dirname } from "path";
import type { ManagedToolManifest } from "../../../types";

/**
 * Managed tool resolver 结果。
 */
export interface ManagedToolResolverResult {
  available: boolean;
  toolPath: string | null;
  version: string | null;
  /** 是否为 fixture（manifest.fixture=true） */
  fixture: boolean;
  reason: ManagedToolUnavailableReason | "ok";
  error: string | null;
  /**
   * 完整性校验状态：
   * - verified: SHA 已通过（安装期或磁盘缓存命中）→ 才可执行
   * - pending: 轻量校验通过，但尚未 verified（不可执行）
   * - failed: SHA/完整性失败
   * - skipped: 未走到 binary 校验（manifest/platform/path 失败，或 fixture）
   */
  integrityStatus: ToolIntegrityStatus;
}

export type ToolIntegrityStatus = "verified" | "pending" | "failed" | "skipped";

export type ManagedToolUnavailableReason =
  | "manifest-not-found"
  | "manifest-invalid"
  | "platform-not-found"
  | "path-not-exist"
  | "size-mismatch"
  | "sha256-mismatch"
  | "not-executable"
  | "integrity-unverified";

export interface ToolIntegrityCacheKey {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly manifestVersion: string;
  readonly expectedSha256: string;
}

export interface ToolIntegrityCacheEntry extends ToolIntegrityCacheKey {
  readonly status: "verified" | "failed" | "pending";
  readonly actualSha256?: string;
  readonly error?: string;
  readonly verifiedAt?: number;
}

/**
 * 默认 manifest 路径（相对于 pluginDir）。
 */
export const DEFAULT_RG_MANIFEST_RELATIVE_PATH = "managed-tools/rg/rg-manifest.json";

const integrityCache = new Map<string, ToolIntegrityCacheEntry>();
const verifyInFlight = new Map<string, Promise<ToolIntegrityCacheEntry>>();

/**
 * 获取当前平台 key（如 "win32-x64"、"darwin-arm64"、"linux-x64"）。
 */
export function getPlatformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

function unavailable(
  reason: ManagedToolUnavailableReason,
  partial: Partial<ManagedToolResolverResult> = {},
): ManagedToolResolverResult {
  return {
    available: false,
    toolPath: partial.toolPath ?? null,
    version: partial.version ?? null,
    fixture: partial.fixture ?? false,
    reason,
    error: partial.error ?? reason,
    integrityStatus: partial.integrityStatus ?? "skipped",
  };
}

/**
 * 解析 Managed ripgrep（热路径安全：不读完整 binary、不同步哈希）。
 */
export function resolveManagedTool(
  manifestPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  options: { scheduleVerify?: boolean } = {},
): ManagedToolResolverResult {
  const scheduleVerify = options.scheduleVerify !== false;

  if (!existsSync(manifestPath)) {
    return unavailable("manifest-not-found", { error: `manifest not found: ${manifestPath}` });
  }

  let manifest: ManagedToolManifest;
  try {
    const raw = readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(raw) as ManagedToolManifest;
  } catch (e) {
    return unavailable("manifest-invalid", {
      error: `manifest JSON parse failed: ${(e as Error).message}`,
    });
  }

  const platformKey = getPlatformKey(platform, arch);
  const platformEntry = manifest.platforms?.[platformKey];
  const fixture = !!manifest.fixture;
  const version = manifest.version || null;

  if (!platformEntry) {
    return unavailable("platform-not-found", {
      version,
      fixture,
      error: `platform ${platformKey} not in manifest (available: ${Object.keys(manifest.platforms || {}).join(", ")})`,
    });
  }

  const manifestDir = dirname(manifestPath);
  const toolPath = resolve(manifestDir, platformEntry.path);
  if (!existsSync(toolPath)) {
    return unavailable("path-not-exist", {
      version,
      fixture,
      error: `tool binary not found: ${toolPath}`,
    });
  }

  let st: { size: number; mtimeMs: number };
  try {
    const s = statSync(toolPath);
    st = { size: s.size, mtimeMs: s.mtimeMs };
  } catch (e) {
    return unavailable("path-not-exist", {
      version,
      fixture,
      error: `tool binary stat failed: ${(e as Error).message}`,
    });
  }

  if (platformEntry.size !== st.size) {
    return unavailable("size-mismatch", {
      toolPath,
      version,
      fixture,
      error: `size mismatch: expected ${platformEntry.size}, got ${st.size}`,
    });
  }

  const execCheck = checkExecutable(toolPath, platform);
  if (!execCheck.ok) {
    return unavailable("not-executable", {
      toolPath,
      version,
      fixture,
      error: execCheck.reason || "not executable",
    });
  }

  // fixture：跳过 SHA，允许执行（测试/开发桩）
  if (fixture) {
    return {
      available: true,
      toolPath,
      version,
      fixture,
      reason: "ok",
      error: null,
      integrityStatus: "skipped",
    };
  }

  const key: ToolIntegrityCacheKey = {
    path: toolPath,
    size: st.size,
    mtimeMs: st.mtimeMs,
    manifestVersion: manifest.version || "",
    expectedSha256: platformEntry.sha256,
  };
  const cached = getCachedIntegrity(key);

  if (cached?.status === "failed") {
    return {
      available: false,
      toolPath,
      version,
      fixture,
      reason: "sha256-mismatch",
      error: cached.error || `sha256 mismatch: expected ${platformEntry.sha256}`,
      integrityStatus: "failed",
    };
  }

  if (cached?.status === "verified") {
    return {
      available: true,
      toolPath,
      version,
      fixture,
      reason: "ok",
      error: null,
      integrityStatus: "verified",
    };
  }

  if (scheduleVerify) {
    void scheduleManagedToolIntegrityVerify(key);
  }

  return unavailable("integrity-unverified", {
    toolPath,
    version,
    fixture,
    error: "tool integrity not verified; install or wait for verification to finish",
    integrityStatus: "pending",
  });
}

function integrityDiskPath(toolPath: string): string {
  return `${toolPath}.integrity.json`;
}

function readIntegrityDiskCache(toolPath: string): ToolIntegrityCacheEntry | null {
  const diskPath = integrityDiskPath(toolPath);
  if (!existsSync(diskPath)) return null;
  try {
    const raw = readFileSync(diskPath, "utf8");
    const parsed = JSON.parse(raw) as ToolIntegrityCacheEntry;
    if (!parsed || typeof parsed.path !== "string" || typeof parsed.expectedSha256 !== "string") return null;
    if (parsed.status !== "verified" && parsed.status !== "failed" && parsed.status !== "pending") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeIntegrityDiskCache(entry: ToolIntegrityCacheEntry): void {
  try {
    writeFileSync(integrityDiskPath(entry.path), JSON.stringify(entry), "utf8");
  } catch {
    // best-effort
  }
}

function removeIntegrityDiskCache(toolPath: string): void {
  try {
    const diskPath = integrityDiskPath(toolPath);
    if (existsSync(diskPath)) unlinkSync(diskPath);
  } catch {
    // ignore
  }
}

function putIntegrityCache(entry: ToolIntegrityCacheEntry): void {
  integrityCache.set(entry.path, entry);
  if (entry.status === "verified" || entry.status === "failed") {
    writeIntegrityDiskCache(entry);
  }
}

/**
 * 读取完整性缓存（仅当 key 完全匹配时命中）。
 */
export function getCachedIntegrity(key: ToolIntegrityCacheKey): ToolIntegrityCacheEntry | null {
  let entry = integrityCache.get(key.path) ?? null;
  if (!entry) {
    entry = readIntegrityDiskCache(key.path);
    if (entry) integrityCache.set(key.path, entry);
  }
  if (!entry) return null;
  if (
    entry.size !== key.size
    || entry.mtimeMs !== key.mtimeMs
    || entry.manifestVersion !== key.manifestVersion
    || entry.expectedSha256 !== key.expectedSha256
  ) {
    return null;
  }
  return entry;
}

/**
 * 安装完成或文件变化时使缓存失效。
 */
export function invalidateManagedToolIntegrityCache(toolPath?: string): void {
  if (toolPath) {
    integrityCache.delete(toolPath);
    verifyInFlight.delete(toolPath);
    removeIntegrityDiskCache(toolPath);
    return;
  }
  for (const pathKey of [...integrityCache.keys()]) {
    removeIntegrityDiskCache(pathKey);
  }
  integrityCache.clear();
  verifyInFlight.clear();
}

/**
 * 后台异步 SHA-256 校验；同 path 去重。
 */
export function scheduleManagedToolIntegrityVerify(key: ToolIntegrityCacheKey): Promise<ToolIntegrityCacheEntry> {
  const existing = verifyInFlight.get(key.path);
  if (existing) return existing;

  integrityCache.set(key.path, { ...key, status: "pending" });

  const promise = verifyManagedToolIntegrity(key).finally(() => {
    verifyInFlight.delete(key.path);
  });
  verifyInFlight.set(key.path, promise);
  return promise;
}

/**
 * 流式计算文件 SHA-256（不一次性读入内存）。
 */
export function hashFileSha256Async(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

export async function verifyManagedToolIntegrity(key: ToolIntegrityCacheKey): Promise<ToolIntegrityCacheEntry> {
  try {
    const s = statSync(key.path);
    if (s.size !== key.size || s.mtimeMs !== key.mtimeMs) {
      const entry: ToolIntegrityCacheEntry = {
        ...key,
        size: s.size,
        mtimeMs: s.mtimeMs,
        status: "failed",
        error: "tool file changed during verify (size/mtime)",
      };
      putIntegrityCache(entry);
      return entry;
    }

    const actualSha256 = await hashFileSha256Async(key.path);
    if (actualSha256 !== key.expectedSha256) {
      const entry: ToolIntegrityCacheEntry = {
        ...key,
        status: "failed",
        actualSha256,
        error: `sha256 mismatch: expected ${key.expectedSha256}, got ${actualSha256}`,
      };
      putIntegrityCache(entry);
      return entry;
    }

    const entry: ToolIntegrityCacheEntry = {
      ...key,
      status: "verified",
      actualSha256,
      verifiedAt: Date.now(),
    };
    putIntegrityCache(entry);
    return entry;
  } catch (e) {
    const entry: ToolIntegrityCacheEntry = {
      ...key,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
    putIntegrityCache(entry);
    return entry;
  }
}

/**
 * 标记已验证（安装器在刚写完并校验过 binary 后调用）。
 */
export function markManagedToolIntegrityVerified(key: ToolIntegrityCacheKey, actualSha256?: string): void {
  putIntegrityCache({
    ...key,
    status: "verified",
    actualSha256: actualSha256 || key.expectedSha256,
    verifiedAt: Date.now(),
  });
}

/**
 * 解析 rg 托管目录（用于 PATH 前置）。
 * 返回 binary 所在目录；不可用时返回 null。
 */
export function resolveManagedToolDir(pluginDir: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
  const manifestPath = resolveRgManifestPath(pluginDir);
  const result = resolveManagedTool(manifestPath, platform, arch, { scheduleVerify: false });
  if (!result.toolPath) return null;
  return dirname(result.toolPath);
}

/**
 * 从 pluginDir 解析 manifest 路径。
 */
export function resolveRgManifestPath(pluginDir: string): string {
  return join(pluginDir, DEFAULT_RG_MANIFEST_RELATIVE_PATH);
}

/** 测试钩子：窥视缓存大小 */
export function getManagedToolIntegrityCacheSizeForTest(): number {
  return integrityCache.size;
}

/**
 * 校验可执行权限。
 */
function checkExecutable(toolPath: string, platform: NodeJS.Platform): { ok: boolean; reason?: string } {
  if (platform === "win32") {
    const lower = toolPath.toLowerCase();
    if (lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".cmd") || lower.endsWith(".ps1")) {
      return { ok: true };
    }
    return { ok: false, reason: `Windows executable must have .exe/.bat/.cmd extension: ${toolPath}` };
  }
  try {
    accessSync(toolPath, constants.X_OK);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `not executable (X_OK): ${(e as Error).message}` };
  }
}
