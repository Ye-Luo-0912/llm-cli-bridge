// LLM CLI Bridge — V17-RG Managed ripgrep installer bridge。
//
// 主 bundle 不内联下载/解包实现；真实 installer 随 user-package 放在
// managed-tools/rg/install-rg.mjs，由插件按需动态导入（B2 实现）。
//
// 本轮 B1：只提供状态读取（getManagedToolInstallStatus）和修复入口
// （ensureManagedToolInstalledFromPlugin），下载逻辑在 B2 补齐。

import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import type { ManagedToolManifest } from "../../../types";
import {
  invalidateManagedToolIntegrityCache,
  markManagedToolIntegrityVerified,
  resolveManagedTool,
  resolveRgManifestPath,
  scheduleManagedToolIntegrityVerify,
  type ToolIntegrityStatus,
} from "./rgManagedResolver";

export interface ManagedToolInstallStatus {
  required: boolean;
  version: string | null;
  size: number | null;
  source: string | null;
  sha256: string | null;
  installPath: string | null;
  status: string;
  error: string | null;
  installSource?: string | null;
  artifactSha256Valid?: boolean;
  binarySha256Valid?: boolean;
  binarySizeValid?: boolean;
  toolExecutable?: boolean;
  /** 热路径完整性状态：仅 verified（或 fixture skipped）才可执行 */
  integrityStatus?: ToolIntegrityStatus;
}

type InstallerModule = {
  ensureManagedToolInstalled?: (options?: { confirm?: boolean }) => Promise<ManagedToolInstallStatus>;
};

function getResolvedPluginDir(pluginDir?: string): string {
  const g = globalThis as { __dirname?: string };
  return pluginDir || g.__dirname || "";
}

function readInstallMetadata(pluginDir?: string): ManagedToolInstallStatus {
  const resolvedPluginDir = getResolvedPluginDir(pluginDir);
  const manifestPath = resolveRgManifestPath(resolvedPluginDir);
  if (!existsSync(manifestPath)) {
    return {
      required: false,
      version: null,
      size: null,
      source: null,
      sha256: null,
      installPath: null,
      status: "manifest-not-found",
      error: `manifest not found: ${manifestPath}`,
    };
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManagedToolManifest;
    const platformKey = `${process.platform}-${process.arch}`;
    const entry = manifest.platforms?.[platformKey];
    const installPath = entry ? resolve(dirname(manifestPath), entry.path) : null;
    // 热路径：resolveManagedTool 只用 stat + 完整性缓存，不读完整 binary
    const resolver = resolveManagedTool(manifestPath);
    const unverified = resolver.integrityStatus === "pending" || resolver.reason === "integrity-unverified";
    return {
      required: resolver.reason === "path-not-exist" && manifest.fixture !== true,
      version: manifest.version || null,
      size: entry?.size ?? null,
      source: entry?.artifact?.url || null,
      sha256: entry?.sha256 || null,
      installPath,
      status: unverified
        ? "verifying"
        : resolver.available
          ? "installed"
          : resolver.reason,
      error: resolver.error,
      toolExecutable: resolver.available,
      binarySha256Valid: resolver.integrityStatus === "verified",
      binarySizeValid: resolver.reason !== "size-mismatch" && resolver.reason !== "path-not-exist",
      integrityStatus: resolver.integrityStatus,
    };
  } catch (e) {
    return {
      required: false,
      version: null,
      size: null,
      source: null,
      sha256: null,
      installPath: null,
      status: "manifest-invalid",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function getManagedToolInstallStatus(pluginDir?: string): ManagedToolInstallStatus {
  return readInstallMetadata(pluginDir);
}

/**
 * 修复入口：触发完整性校验或调用外部 installer（B2 提供）。
 * fixture 模式下直接标记为已验证；真实 binary 模式下触发异步校验。
 */
export async function ensureManagedToolInstalledFromPlugin(
  pluginDir?: string,
  options: { confirm?: boolean } = {},
): Promise<ManagedToolInstallStatus> {
  const metadata = readInstallMetadata(pluginDir);
  const resolvedPluginDir = getResolvedPluginDir(pluginDir);
  const manifestPath = resolveRgManifestPath(resolvedPluginDir);
  const installerPath = join(dirname(manifestPath), "install-rg.mjs");

  // fixture：无需 installer，直接校验
  if (metadata.version?.endsWith("-fixture") || metadata.integrityStatus === "skipped") {
    return metadata;
  }

  // 已安装且 verified：无需操作
  if (metadata.status === "installed" && metadata.integrityStatus === "verified") {
    return metadata;
  }

  // 尝试动态导入外部 installer（B2 提供）
  if (existsSync(installerPath)) {
    try {
      const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<InstallerModule>;
      const mod = await dynamicImport(`${pathToFileURL(installerPath).href}?bridge=${Date.now()}`);
      if (typeof mod.ensureManagedToolInstalled === "function") {
        return await mod.ensureManagedToolInstalled({ confirm: options.confirm === true });
      }
    } catch (e) {
      return {
        ...metadata,
        status: "installer-error",
        error: `installer failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // 无外部 installer：触发后台校验（pending → verified）
  if (metadata.installPath && existsSync(metadata.installPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManagedToolManifest;
      const platformKey = `${process.platform}-${process.arch}`;
      const entry = manifest.platforms?.[platformKey];
      if (entry?.sha256) {
        const st = statSync(metadata.installPath);
        invalidateManagedToolIntegrityCache(metadata.installPath);
        await scheduleManagedToolIntegrityVerify({
          path: metadata.installPath,
          size: st.size,
          mtimeMs: st.mtimeMs,
          manifestVersion: manifest.version || "",
          expectedSha256: entry.sha256,
        });
        markManagedToolIntegrityVerified({
          path: metadata.installPath,
          size: st.size,
          mtimeMs: st.mtimeMs,
          manifestVersion: manifest.version || "",
          expectedSha256: entry.sha256,
        });
        return readInstallMetadata(pluginDir);
      }
    } catch (e) {
      return {
        ...metadata,
        status: "verify-failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return { ...metadata, status: "installer-not-found", error: `installer not found: ${installerPath}` };
}
