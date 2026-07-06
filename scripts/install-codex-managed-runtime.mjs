#!/usr/bin/env node
// LLM CLI Bridge — install pinned Codex managed runtime artifact.
//
// NPM-free / tar-CLI-free installer:
// - downloads the pinned .tgz artifact with Node https/http, or uses a verified
//   local artifact when CODEX_MANAGED_RUNTIME_ARTIFACT_FILE points to one
// - verifies tarball sha256
// - extracts the declared vendor binary with JS gzip/tar parsing
// - verifies binary size + sha256
// - atomically writes the runtime binary

import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = resolveManifestPath();

function resolveManifestPath() {
  if (process.env.CODEX_MANAGED_RUNTIME_MANIFEST) {
    return resolve(PROJECT_ROOT, process.env.CODEX_MANAGED_RUNTIME_MANIFEST);
  }
  const packageLocalManifest = join(__dirname, "runtime-manifest.json");
  if (existsSync(packageLocalManifest)) return packageLocalManifest;
  return join(PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json");
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function fileNameFromUrl(url) {
  const parsed = new URL(url);
  return parsed.pathname.split("/").filter(Boolean).pop() || "codex-runtime.tgz";
}

function findCachedArtifact(cacheDir, expectedSha256) {
  if (!existsSync(cacheDir)) return null;
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tgz")) continue;
    const fullPath = join(cacheDir, entry.name);
    try {
      if (sha256File(fullPath) === expectedSha256) return fullPath;
    } catch {
      // ignore unreadable stale cache entries
    }
  }
  return null;
}

function downloadFile(url, destPath, redirectLimit = 5) {
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

function parseTarString(buffer, start, length) {
  return buffer.toString("utf8", start, start + length).replace(/\0.*$/s, "");
}

function parseTarSize(buffer, start, length) {
  const raw = parseTarString(buffer, start, length).trim();
  return raw ? parseInt(raw, 8) : 0;
}

function normalizeTarPath(path) {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function extractFileFromTgz(tarballPath, vendorPath) {
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

function checkExecutablePath(runtimePath, platformKey) {
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

function getInstallerContext() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const platformKey = `${process.platform}-${process.arch}`;
  const entry = manifest.platforms?.[platformKey];
  const manifestDir = dirname(MANIFEST_PATH);
  const runtimePath = entry ? resolve(manifestDir, entry.path) : null;
  const cacheBaseDir = existsSync(join(PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json"))
    && MANIFEST_PATH.includes(join("src", "runtime", "providers", "codex-managed-app-server"))
    ? PROJECT_ROOT
    : manifestDir;
  const cacheDir = resolve(cacheBaseDir, manifest.source?.artifactCacheDir || ".tmp/codex-managed-runtime-artifacts");
  return { manifest, platformKey, entry, manifestDir, runtimePath, cacheDir };
}

export async function ensureManagedRuntimeInstalled(options = {}) {
  const { confirm = true } = options;
  let ctx;
  try {
    ctx = getInstallerContext();
  } catch (e) {
    return { required: false, version: null, size: null, source: null, sha256: null, installPath: null, status: "manifest-error", error: e?.message || String(e) };
  }

  const { manifest, platformKey, entry, runtimePath, cacheDir } = ctx;
  const base = {
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
  if (!entry) return { ...base, status: "platform-not-found", error: `platform ${platformKey} not in production manifest` };
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

  if (!confirm) return { ...base, status: "confirmation-required" };

  const extractDir = join(cacheDir, `extract-${platformKey}`);
  const tarballPath = join(cacheDir, fileNameFromUrl(entry.artifact.tarball));
  const partialRuntimePath = `${runtimePath}.partial-${process.pid}-${Date.now()}`;
  let activeTarballPath = null;
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
    return { ...base, status: "failed", error: e?.message || String(e) };
  }
}

async function main() {
  const result = await ensureManagedRuntimeInstalled({ confirm: true });
  console.log(`[codex-managed-runtime] runtime version: ${result.version}`);
  console.log(`[codex-managed-runtime] download size: ${result.size} bytes`);
  console.log(`[codex-managed-runtime] source package: ${result.source}`);
  console.log(`[codex-managed-runtime] sha256: ${result.sha256}`);
  console.log(`[codex-managed-runtime] install path: ${result.installPath}`);
  console.log(`[codex-managed-runtime] status: ${result.status}`);
  console.log(`[codex-managed-runtime] requiresSystemNpm=${result.requiresSystemNpm}`);
  console.log(`[codex-managed-runtime] requiresSystemTar=${result.requiresSystemTar}`);
  if (result.error) console.error(`[codex-managed-runtime] error: ${result.error}`);
  if (!["already-installed", "installed", "fixture-skip"].includes(result.status)) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error(`[codex-managed-runtime] install failed: ${e?.message || e}`);
    process.exit(1);
  });
}
