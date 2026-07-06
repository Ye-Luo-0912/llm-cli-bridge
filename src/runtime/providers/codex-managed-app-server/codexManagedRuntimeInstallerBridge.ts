// LLM CLI Bridge — Codex managed runtime first-run installer bridge.
//
// 主 bundle 不内联下载/解包实现；真实 installer 仍随 user-package 放在
// codex-managed-runtime/install-codex-managed-runtime.mjs，由插件按需动态导入。

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import type { CodexManagedRuntimeManifest } from "../../../types";
import { resolveManagedRuntime, resolveManifestPath } from "./codexManagedRuntimeResolver";

export interface ManagedRuntimeInstallStatus {
  required: boolean;
  version: string | null;
  size: number | null;
  source: string | null;
  sha256: string | null;
  installPath: string | null;
  status: string;
  error: string | null;
  installSource?: string | null;
  tarballSha256Valid?: boolean;
  binarySha256Valid?: boolean;
  binarySizeValid?: boolean;
  runtimeExecutable?: boolean;
  requiresSystemNpm?: boolean;
  requiresSystemTar?: boolean;
}

type InstallerModule = {
  ensureManagedRuntimeInstalled?: (options?: { confirm?: boolean }) => Promise<ManagedRuntimeInstallStatus>;
};

function getResolvedPluginDir(pluginDir?: string): string {
  const g = globalThis as { __dirname?: string };
  return pluginDir || g.__dirname || "";
}

function readInstallMetadata(pluginDir?: string): ManagedRuntimeInstallStatus {
  const resolvedPluginDir = getResolvedPluginDir(pluginDir);
  const manifestPath = resolveManifestPath(resolvedPluginDir);
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
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CodexManagedRuntimeManifest;
    const platformKey = `${process.platform}-${process.arch}`;
    const entry = manifest.platforms?.[platformKey];
    const installPath = entry ? resolve(dirname(manifestPath), entry.path) : null;
    const resolver = resolveManagedRuntime(manifestPath);
    return {
      required: resolver.reason === "path-not-exist" && manifest.fixture !== true,
      version: manifest.version || null,
      size: entry?.size ?? null,
      source: entry?.artifact?.tarball || entry?.artifact?.package || null,
      sha256: entry?.sha256 || null,
      installPath,
      status: resolver.available ? "installed" : resolver.reason,
      error: resolver.error,
      runtimeExecutable: resolver.available,
      binarySha256Valid: resolver.available,
      binarySizeValid: resolver.available,
      requiresSystemNpm: false,
      requiresSystemTar: false,
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

export function getManagedRuntimeInstallStatus(pluginDir?: string): ManagedRuntimeInstallStatus {
  return readInstallMetadata(pluginDir);
}

export async function ensureManagedRuntimeInstalledFromPlugin(
  pluginDir?: string,
  options: { confirm?: boolean } = {},
): Promise<ManagedRuntimeInstallStatus> {
  const metadata = readInstallMetadata(pluginDir);
  const resolvedPluginDir = getResolvedPluginDir(pluginDir);
  const manifestPath = resolveManifestPath(resolvedPluginDir);
  const installerPath = join(dirname(manifestPath), "install-codex-managed-runtime.mjs");
  if (!existsSync(installerPath)) {
    return {
      ...metadata,
      status: "installer-not-found",
      error: `installer not found: ${installerPath}`,
    };
  }

  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<InstallerModule>;
    const mod = await dynamicImport(`${pathToFileURL(installerPath).href}?bridge=${Date.now()}`);
    if (typeof mod.ensureManagedRuntimeInstalled !== "function") {
      return { ...metadata, status: "installer-invalid", error: "ensureManagedRuntimeInstalled export missing" };
    }
    return await mod.ensureManagedRuntimeInstalled({ confirm: options.confirm === true });
  } catch (e) {
    return {
      ...metadata,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
