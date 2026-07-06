// LLM CLI Bridge — Codex managed runtime first-run installer bridge.
//
// 主 bundle 不内联下载/解包实现；真实 installer 仍随 user-package 放在
// codex-managed-runtime/install-codex-managed-runtime.mjs，由插件按需动态导入。

import { createHash } from "crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { get as httpGet } from "http";
import { get as httpsGet } from "https";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { gunzipSync } from "zlib";
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

type RuntimePlatformEntry = NonNullable<CodexManagedRuntimeManifest["platforms"]>[string];

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

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(path: string): string {
  return sha256Buffer(readFileSync(path));
}

function fileNameFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.split("/").filter(Boolean).pop() || "codex-runtime.tgz";
}

function findCachedArtifact(cacheDir: string, expectedSha256: string): string | null {
  if (!existsSync(cacheDir)) return null;
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tgz")) continue;
    const fullPath = join(cacheDir, entry.name);
    try {
      if (sha256File(fullPath) === expectedSha256) return fullPath;
    } catch {
      // Ignore unreadable stale cache entries.
    }
  }
  return null;
}

function downloadFile(url: string, destPath: string, redirectLimit = 5): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const getter = url.startsWith("https:") ? httpsGet : httpGet;
    const req = getter(url, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectLimit > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        downloadFile(nextUrl, destPath, redirectLimit - 1).then(resolvePromise, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`download failed: HTTP ${status}`));
        return;
      }
      const out = createWriteStream(destPath);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolvePromise(destPath)));
      out.on("error", reject);
    });
    req.on("error", reject);
  });
}

function parseTarString(buffer: Buffer, start: number, length: number): string {
  return buffer.toString("utf8", start, start + length).replace(/\0.*$/s, "");
}

function parseTarSize(buffer: Buffer, start: number, length: number): number {
  const raw = parseTarString(buffer, start, length).trim();
  return raw ? parseInt(raw, 8) : 0;
}

function normalizeTarPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function extractFileFromTgz(tarballPath: string, vendorPath: string): Buffer {
  const tar = gunzipSync(readFileSync(tarballPath));
  const wanted = normalizeTarPath(`package/${vendorPath}`);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = parseTarString(header, 0, 100);
    const size = parseTarSize(header, 124, 12);
    const typeflag = parseTarString(header, 156, 1);
    const prefix = parseTarString(header, 345, 155);
    const fullName = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if ((typeflag === "0" || typeflag === "") && fullName === wanted) {
      return Buffer.from(tar.subarray(dataStart, dataEnd));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`artifact binary not found in tgz: ${wanted}`);
}

function checkExecutablePath(runtimePath: string, platformKey: string): boolean {
  if (platformKey.startsWith("win32-")) {
    const lower = runtimePath.toLowerCase();
    return lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".cmd") || lower.endsWith(".ps1");
  }
  try {
    chmodSync(runtimePath, 0o755);
    return true;
  } catch {
    return false;
  }
}

async function installManagedRuntimeBundled(
  manifestPath: string,
  options: { confirm?: boolean },
): Promise<ManagedRuntimeInstallStatus> {
  let manifest: CodexManagedRuntimeManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CodexManagedRuntimeManifest;
  } catch (e) {
    return {
      required: false,
      version: null,
      size: null,
      source: null,
      sha256: null,
      installPath: null,
      status: "manifest-error",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const entry: RuntimePlatformEntry | undefined = manifest.platforms?.[platformKey];
  const manifestDir = dirname(manifestPath);
  const runtimePath = entry ? resolve(manifestDir, entry.path) : null;
  const cacheDir = resolve(manifestDir, manifest.source?.artifactCacheDir || ".tmp/codex-managed-runtime-artifacts");
  const base: ManagedRuntimeInstallStatus = {
    required: true,
    version: manifest.version || null,
    size: entry?.size || null,
    source: entry?.artifact?.tarball || entry?.artifact?.package || null,
    sha256: entry?.sha256 || null,
    installPath: runtimePath,
    status: "unknown",
    error: null,
    tarballSha256Valid: false,
    binarySha256Valid: false,
    binarySizeValid: false,
    runtimeExecutable: false,
    installSource: null,
    requiresSystemNpm: false,
    requiresSystemTar: false,
  };

  if (manifest.fixture === true) return { ...base, required: false, status: "fixture-skip" };
  if (!entry || !runtimePath) return { ...base, status: "platform-not-found", error: `platform ${platformKey} not in production manifest` };
  if (!entry.artifact?.tarball || !entry.artifact?.vendorPath || !entry.artifact?.tarballSha256) {
    return { ...base, status: "artifact-metadata-incomplete", error: `platform ${platformKey} missing pinned artifact metadata` };
  }

  if (existsSync(runtimePath)) {
    const sizeValid = statSync(runtimePath).size === entry.size;
    const hashValid = sizeValid && sha256File(runtimePath) === entry.sha256;
    const executable = hashValid && checkExecutablePath(runtimePath, platformKey);
    if (sizeValid && hashValid && executable) {
      return {
        ...base,
        required: false,
        status: "already-installed",
        binarySizeValid: true,
        binarySha256Valid: true,
        runtimeExecutable: true,
      };
    }
  }

  if (options.confirm !== true) return { ...base, status: "confirmation-required" };

  const extractDir = join(cacheDir, `extract-${platformKey}`);
  const tarballPath = join(cacheDir, fileNameFromUrl(entry.artifact.tarball));
  const partialRuntimePath = `${runtimePath}.partial-${process.pid}-${Date.now()}`;
  let activeTarballPath: string | null = null;
  mkdirSync(cacheDir, { recursive: true });
  rmSync(extractDir, { recursive: true, force: true });
  rmSync(partialRuntimePath, { force: true });

  try {
    const localArtifact = process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE
      ? resolve(process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE)
      : findCachedArtifact(cacheDir, entry.artifact.tarballSha256);
    if (localArtifact && existsSync(localArtifact)) {
      if (resolve(localArtifact) !== resolve(tarballPath)) {
        rmSync(tarballPath, { force: true });
        copyFileSync(localArtifact, tarballPath);
      }
      activeTarballPath = tarballPath;
      base.installSource = "local-artifact";
    } else {
      activeTarballPath = tarballPath;
      base.installSource = "download";
      rmSync(tarballPath, { force: true });
      await downloadFile(entry.artifact.tarball, tarballPath);
    }

    const tarballHash = sha256File(activeTarballPath);
    if (tarballHash !== entry.artifact.tarballSha256) {
      throw new Error(`artifact sha256 mismatch: expected ${entry.artifact.tarballSha256}, got ${tarballHash}`);
    }
    base.tarballSha256Valid = true;

    const binary = extractFileFromTgz(activeTarballPath, entry.artifact.vendorPath);
    base.binarySizeValid = binary.length === entry.size;
    if (!base.binarySizeValid) throw new Error(`binary size mismatch: expected ${entry.size}, got ${binary.length}`);
    const binaryHash = sha256Buffer(binary);
    base.binarySha256Valid = binaryHash === entry.sha256;
    if (!base.binarySha256Valid) throw new Error(`binary sha256 mismatch: expected ${entry.sha256}, got ${binaryHash}`);

    mkdirSync(dirname(runtimePath), { recursive: true });
    writeFileSync(partialRuntimePath, binary);
    if (process.platform !== "win32") chmodSync(partialRuntimePath, 0o755);
    if (existsSync(runtimePath)) rmSync(runtimePath, { force: true });
    renameSync(partialRuntimePath, runtimePath);
    base.runtimeExecutable = checkExecutablePath(runtimePath, platformKey);
    if (!base.runtimeExecutable) throw new Error(`runtime is not executable: ${runtimePath}`);
    rmSync(extractDir, { recursive: true, force: true });
    return { ...base, required: true, status: "installed" };
  } catch (e) {
    rmSync(extractDir, { recursive: true, force: true });
    rmSync(partialRuntimePath, { force: true });
    rmSync(runtimePath, { force: true });
    if (activeTarballPath && activeTarballPath === tarballPath) rmSync(activeTarballPath, { force: true });
    return { ...base, status: "failed", error: e instanceof Error ? e.message : String(e) };
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
    const bundledResult = await installManagedRuntimeBundled(manifestPath, options);
    if (bundledResult.status !== "failed") return bundledResult;
    return {
      ...bundledResult,
      error: `${bundledResult.error || "bundled installer failed"}; dynamic import failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
