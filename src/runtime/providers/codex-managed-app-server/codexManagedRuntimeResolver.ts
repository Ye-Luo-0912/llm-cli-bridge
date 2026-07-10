// LLM CLI Bridge — V17-F1 任务 B：CodexManagedRuntimeResolver
//
// 解析我们管理的 pinned runtime binary（不依赖用户安装 Codex CLI / Desktop App）。
//
// 热路径（发送 / 状态栏 / Provider 创建 / 插件列表）只做轻量校验：
//   manifest 合法 → 平台条目 → 文件存在 → size(stat) → executable
// 禁止在热路径上 readFileSync(runtimePath) / 同步 SHA-256 / execFileSync。
//
// 完整 SHA-256 校验改为后台异步，并按 {路径、大小、mtime、manifest 版本} 缓存。
// 安装完成或运行时文件变化时才重新校验；发送时只读缓存。

import { createReadStream, existsSync, readFileSync, accessSync, constants, statSync } from "fs";
import { createHash } from "crypto";
import { join, resolve, dirname } from "path";
import type { CodexManagedRuntimeManifest } from "../../../types";

/**
 * Managed runtime resolver 结果。
 */
export interface ManagedRuntimeResolverResult {
  available: boolean;
  runtimePath: string | null;
  version: string | null;
  protocolVersion: string | null;
  /** 从 manifest 读取的 app-server 启动参数 */
  appServerArgs: string[];
  /** 是否为 fixture runtime（manifest.fixture=true） */
  fixture: boolean;
  reason: ManagedRuntimeUnavailableReason | "ok";
  error: string | null;
  /**
   * 完整性校验状态：
   * - verified: 后台 SHA 已通过且缓存命中
   * - pending: 轻量校验通过，SHA 正在/等待后台验证（不阻塞 UI）
   * - failed: SHA/完整性失败
   * - skipped: 未走到 binary 校验（manifest/platform/path 失败）
   */
  integrityStatus: RuntimeIntegrityStatus;
}

export type RuntimeIntegrityStatus = "verified" | "pending" | "failed" | "skipped";

export type ManagedRuntimeUnavailableReason =
  | "manifest-not-found"
  | "manifest-invalid"
  | "platform-not-found"
  | "path-not-exist"
  | "size-mismatch"
  | "sha256-mismatch"
  | "not-executable";

export interface RuntimeIntegrityCacheKey {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly manifestVersion: string;
  readonly expectedSha256: string;
}

export interface RuntimeIntegrityCacheEntry extends RuntimeIntegrityCacheKey {
  readonly status: "verified" | "failed" | "pending";
  readonly actualSha256?: string;
  readonly error?: string;
  readonly verifiedAt?: number;
}

/**
 * 默认 manifest 路径（相对于 pluginDir）。
 */
export const DEFAULT_MANIFEST_RELATIVE_PATH = "codex-managed-runtime/runtime-manifest.json";

const integrityCache = new Map<string, RuntimeIntegrityCacheEntry>();
const verifyInFlight = new Map<string, Promise<RuntimeIntegrityCacheEntry>>();

/**
 * 获取当前平台 key（如 "win32-x64"、"darwin-arm64"、"linux-x64"）。
 */
export function getPlatformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

function unavailable(
  reason: ManagedRuntimeUnavailableReason,
  partial: Partial<ManagedRuntimeResolverResult> = {},
): ManagedRuntimeResolverResult {
  return {
    available: false,
    runtimePath: partial.runtimePath ?? null,
    version: partial.version ?? null,
    protocolVersion: partial.protocolVersion ?? null,
    appServerArgs: partial.appServerArgs ?? ["app-server"],
    fixture: partial.fixture ?? false,
    reason,
    error: partial.error ?? reason,
    integrityStatus: partial.integrityStatus ?? "skipped",
  };
}

/**
 * 解析 Managed Codex App-Server Runtime（热路径安全：不读完整 binary、不同步哈希）。
 */
export function resolveManagedRuntime(
  manifestPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  options: { scheduleVerify?: boolean } = {},
): ManagedRuntimeResolverResult {
  const scheduleVerify = options.scheduleVerify !== false;

  if (!existsSync(manifestPath)) {
    return unavailable("manifest-not-found", { error: `manifest not found: ${manifestPath}` });
  }

  let manifest: CodexManagedRuntimeManifest;
  try {
    const raw = readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(raw) as CodexManagedRuntimeManifest;
  } catch (e) {
    return unavailable("manifest-invalid", {
      error: `manifest JSON parse failed: ${(e as Error).message}`,
    });
  }

  const platformKey = getPlatformKey(platform, arch);
  const platformEntry = manifest.platforms?.[platformKey];
  const appServerArgs = manifest.appServerArgs && manifest.appServerArgs.length > 0 ? manifest.appServerArgs : ["app-server"];
  const fixture = !!manifest.fixture;
  const version = manifest.version || null;
  const protocolVersion = manifest.protocolVersion || null;

  if (!platformEntry) {
    return unavailable("platform-not-found", {
      version,
      protocolVersion,
      appServerArgs,
      fixture,
      error: `platform ${platformKey} not in manifest (available: ${Object.keys(manifest.platforms || {}).join(", ")})`,
    });
  }

  const manifestDir = dirname(manifestPath);
  const runtimePath = resolve(manifestDir, platformEntry.path);
  if (!existsSync(runtimePath)) {
    return unavailable("path-not-exist", {
      version,
      protocolVersion,
      appServerArgs,
      fixture,
      error: `runtime binary not found: ${runtimePath}`,
    });
  }

  let st: { size: number; mtimeMs: number };
  try {
    const s = statSync(runtimePath);
    st = { size: s.size, mtimeMs: s.mtimeMs };
  } catch (e) {
    return unavailable("path-not-exist", {
      version,
      protocolVersion,
      appServerArgs,
      fixture,
      error: `runtime binary stat failed: ${(e as Error).message}`,
    });
  }

  if (platformEntry.size !== st.size) {
    return unavailable("size-mismatch", {
      runtimePath,
      version,
      protocolVersion,
      appServerArgs,
      fixture,
      error: `size mismatch: expected ${platformEntry.size}, got ${st.size}`,
    });
  }

  const execCheck = checkExecutable(runtimePath, platform);
  if (!execCheck.ok) {
    return unavailable("not-executable", {
      runtimePath,
      version,
      protocolVersion,
      appServerArgs,
      fixture,
      error: execCheck.reason || "not executable",
    });
  }

  const key: RuntimeIntegrityCacheKey = {
    path: runtimePath,
    size: st.size,
    mtimeMs: st.mtimeMs,
    manifestVersion: manifest.version || "",
    expectedSha256: platformEntry.sha256,
  };
  const cached = getCachedIntegrity(key);

  if (cached?.status === "failed") {
    return {
      available: false,
      runtimePath,
      version,
      protocolVersion,
      appServerArgs,
      fixture,
      reason: "sha256-mismatch",
      error: cached.error || `sha256 mismatch: expected ${platformEntry.sha256}`,
      integrityStatus: "failed",
    };
  }

  if (cached?.status === "verified") {
    return {
      available: true,
      runtimePath,
      version,
      protocolVersion,
      appServerArgs,
      fixture,
      reason: "ok",
      error: null,
      integrityStatus: "verified",
    };
  }

  if (scheduleVerify) {
    void scheduleManagedRuntimeIntegrityVerify(key);
  }

  return {
    available: true,
    runtimePath,
    version,
    protocolVersion,
    appServerArgs,
    fixture,
    reason: "ok",
    error: null,
    integrityStatus: "pending",
  };
}

/**
 * 读取完整性缓存（仅当 key 完全匹配时命中）。
 */
export function getCachedIntegrity(key: RuntimeIntegrityCacheKey): RuntimeIntegrityCacheEntry | null {
  const entry = integrityCache.get(key.path);
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
export function invalidateManagedRuntimeIntegrityCache(runtimePath?: string): void {
  if (runtimePath) {
    integrityCache.delete(runtimePath);
    verifyInFlight.delete(runtimePath);
    return;
  }
  integrityCache.clear();
  verifyInFlight.clear();
}

/**
 * 后台异步 SHA-256 校验；同 path 去重。
 */
export function scheduleManagedRuntimeIntegrityVerify(key: RuntimeIntegrityCacheKey): Promise<RuntimeIntegrityCacheEntry> {
  const existing = verifyInFlight.get(key.path);
  if (existing) return existing;

  integrityCache.set(key.path, { ...key, status: "pending" });

  const promise = verifyManagedRuntimeIntegrity(key).finally(() => {
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

export async function verifyManagedRuntimeIntegrity(key: RuntimeIntegrityCacheKey): Promise<RuntimeIntegrityCacheEntry> {
  try {
    // 再次确认文件未变
    const s = statSync(key.path);
    if (s.size !== key.size || s.mtimeMs !== key.mtimeMs) {
      const entry: RuntimeIntegrityCacheEntry = {
        ...key,
        size: s.size,
        mtimeMs: s.mtimeMs,
        status: "failed",
        error: `runtime file changed during verify (size/mtime)`,
      };
      integrityCache.set(key.path, entry);
      return entry;
    }

    const actualSha256 = await hashFileSha256Async(key.path);
    if (actualSha256 !== key.expectedSha256) {
      const entry: RuntimeIntegrityCacheEntry = {
        ...key,
        status: "failed",
        actualSha256,
        error: `sha256 mismatch: expected ${key.expectedSha256}, got ${actualSha256}`,
      };
      integrityCache.set(key.path, entry);
      return entry;
    }

    const entry: RuntimeIntegrityCacheEntry = {
      ...key,
      status: "verified",
      actualSha256,
      verifiedAt: Date.now(),
    };
    integrityCache.set(key.path, entry);
    return entry;
  } catch (e) {
    const entry: RuntimeIntegrityCacheEntry = {
      ...key,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
    integrityCache.set(key.path, entry);
    return entry;
  }
}

/**
 * 标记已验证（安装器在刚写完并校验过 binary 后调用，避免立刻再扫一遍）。
 */
export function markManagedRuntimeIntegrityVerified(key: RuntimeIntegrityCacheKey, actualSha256?: string): void {
  integrityCache.set(key.path, {
    ...key,
    status: "verified",
    actualSha256: actualSha256 || key.expectedSha256,
    verifiedAt: Date.now(),
  });
}

/** 测试钩子：窥视缓存大小 */
export function getManagedRuntimeIntegrityCacheSizeForTest(): number {
  return integrityCache.size;
}

/**
 * 校验可执行权限。
 *
 * Windows: 检查扩展名（.exe/.bat/.cmd）— Windows 不依赖 X_OK 位
 * Unix: fs.access(runtimePath, X_OK)
 */
function checkExecutable(runtimePath: string, platform: NodeJS.Platform): { ok: boolean; reason?: string } {
  if (platform === "win32") {
    const lower = runtimePath.toLowerCase();
    if (lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".cmd") || lower.endsWith(".ps1")) {
      return { ok: true };
    }
    return { ok: false, reason: `Windows executable must have .exe/.bat/.cmd extension: ${runtimePath}` };
  }
  try {
    accessSync(runtimePath, constants.X_OK);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `not executable (X_OK): ${(e as Error).message}` };
  }
}

/**
 * 从 pluginDir 解析 manifest 路径。
 */
export function resolveManifestPath(pluginDir: string): string {
  return join(pluginDir, DEFAULT_MANIFEST_RELATIVE_PATH);
}
