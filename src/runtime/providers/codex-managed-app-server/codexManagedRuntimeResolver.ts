// LLM CLI Bridge — V17-F1 任务 B：CodexManagedRuntimeResolver
//
// 解析我们管理的 pinned runtime binary（不依赖用户安装 Codex CLI / Desktop App）。
//
// 输入：manifestPath（runtime-manifest.json 路径）
// 输出：ManagedRuntimeResolverResult
//   - available
//   - runtimePath
//   - version
//   - protocolVersion
//   - reason
//   - error
//
// 校验链：
//   1. manifest 存在且 JSON 合法
//   2. 当前平台在 manifest.platforms 中有对应条目
//   3. binary 文件存在
//   4. size 匹配
//   5. sha256 匹配
//   6. executable 权限（Windows: .exe/.bat/.cmd 扩展名；Unix: access X_OK）
//
// 本轮 manifest.fixture=true，fixture runtime 不是真实 app-server；
// resolver 只校验 manifest/sha256/executable，不验证 app-server 协议。

import { existsSync, readFileSync, accessSync, constants } from "fs";
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
}

export type ManagedRuntimeUnavailableReason =
  | "manifest-not-found"
  | "manifest-invalid"
  | "platform-not-found"
  | "path-not-exist"
  | "size-mismatch"
  | "sha256-mismatch"
  | "not-executable";

/**
 * 默认 manifest 路径（相对于 pluginDir）。
 */
export const DEFAULT_MANIFEST_RELATIVE_PATH = "codex-managed-runtime/runtime-manifest.json";

/**
 * 获取当前平台 key（如 "win32-x64"、"darwin-arm64"、"linux-x64"）。
 */
export function getPlatformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

/**
 * 解析 Managed Codex App-Server Runtime。
 *
 * @param manifestPath runtime-manifest.json 的绝对路径
 * @param platform 平台（默认 process.platform）
 * @param arch 架构（默认 process.arch）
 */
export function resolveManagedRuntime(
  manifestPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ManagedRuntimeResolverResult {
  // 1. manifest 存在
  if (!existsSync(manifestPath)) {
    return {
      available: false,
      runtimePath: null,
      version: null,
      protocolVersion: null,
      appServerArgs: ["app-server"],
      fixture: false,
      reason: "manifest-not-found",
      error: `manifest not found: ${manifestPath}`,
    };
  }

  // 2. manifest JSON 合法
  let manifest: CodexManagedRuntimeManifest;
  try {
    const raw = readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(raw) as CodexManagedRuntimeManifest;
  } catch (e) {
    return {
      available: false,
      runtimePath: null,
      version: null,
      protocolVersion: null,
      appServerArgs: ["app-server"],
      fixture: false,
      reason: "manifest-invalid",
      error: `manifest JSON parse failed: ${(e as Error).message}`,
    };
  }

  // 3. 当前平台在 manifest.platforms 中
  const platformKey = getPlatformKey(platform, arch);
  const platformEntry = manifest.platforms?.[platformKey];
  const appServerArgs = manifest.appServerArgs && manifest.appServerArgs.length > 0 ? manifest.appServerArgs : ["app-server"];
  const fixture = !!manifest.fixture;
  if (!platformEntry) {
    return {
      available: false,
      runtimePath: null,
      version: manifest.version || null,
      protocolVersion: manifest.protocolVersion || null,
      appServerArgs,
      fixture,
      reason: "platform-not-found",
      error: `platform ${platformKey} not in manifest (available: ${Object.keys(manifest.platforms || {}).join(", ")})`,
    };
  }

  // 4. binary 文件存在
  const manifestDir = dirname(manifestPath);
  const runtimePath = resolve(manifestDir, platformEntry.path);
  if (!existsSync(runtimePath)) {
    return {
      available: false,
      runtimePath: null,
      version: manifest.version || null,
      protocolVersion: manifest.protocolVersion || null,
      appServerArgs,
      fixture,
      reason: "path-not-exist",
      error: `runtime binary not found: ${runtimePath}`,
    };
  }

  // 5. size 匹配
  const fileBuf = readFileSync(runtimePath);
  if (platformEntry.size !== fileBuf.length) {
    return {
      available: false,
      runtimePath: null,
      version: manifest.version || null,
      protocolVersion: manifest.protocolVersion || null,
      appServerArgs,
      fixture,
      reason: "size-mismatch",
      error: `size mismatch: expected ${platformEntry.size}, got ${fileBuf.length}`,
    };
  }

  // 6. sha256 匹配
  const actualSha256 = createHash("sha256").update(fileBuf).digest("hex");
  if (actualSha256 !== platformEntry.sha256) {
    return {
      available: false,
      runtimePath: null,
      version: manifest.version || null,
      protocolVersion: manifest.protocolVersion || null,
      appServerArgs,
      fixture,
      reason: "sha256-mismatch",
      error: `sha256 mismatch: expected ${platformEntry.sha256}, got ${actualSha256}`,
    };
  }

  // 7. executable 权限
  const execCheck = checkExecutable(runtimePath, platform);
  if (!execCheck.ok) {
    return {
      available: false,
      runtimePath: null,
      version: manifest.version || null,
      protocolVersion: manifest.protocolVersion || null,
      appServerArgs,
      fixture,
      reason: "not-executable",
      error: execCheck.reason || "not executable",
    };
  }

  return {
    available: true,
    runtimePath,
    version: manifest.version || null,
    protocolVersion: manifest.protocolVersion || null,
    appServerArgs,
    fixture,
    reason: "ok",
    error: null,
  };
}

/**
 * 校验可执行权限。
 *
 * Windows: 检查扩展名（.exe/.bat/.cmd）— Windows 不依赖 X_OK 位
 * Unix: fs.access(runtimePath, X_OK)
 */
function checkExecutable(runtimePath: string, platform: NodeJS.Platform): { ok: boolean; reason?: string } {
  if (platform === "win32") {
    // Windows: 检查扩展名（.exe/.bat/.cmd/.ps1）
    const lower = runtimePath.toLowerCase();
    if (lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".cmd") || lower.endsWith(".ps1")) {
      return { ok: true };
    }
    return { ok: false, reason: `Windows executable must have .exe/.bat/.cmd extension: ${runtimePath}` };
  }
  // Unix: access X_OK
  try {
    accessSync(runtimePath, constants.X_OK);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `not executable (X_OK): ${(e as Error).message}` };
  }
}

/**
 * 从 pluginDir 解析 manifest 路径。
 *
 * pluginDir 是 Obsidian 插件目录（含 main.js）。
 * manifest 位于 pluginDir/codex-managed-runtime/runtime-manifest.json。
 */
export function resolveManifestPath(pluginDir: string): string {
  return join(pluginDir, DEFAULT_MANIFEST_RELATIVE_PATH);
}
