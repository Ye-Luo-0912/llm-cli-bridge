#!/usr/bin/env node
// LLM CLI Bridge — install pinned Codex managed runtime artifact.
//
// Reads a pinned runtime-manifest.json, downloads the current platform artifact
// from its pinned npm package, extracts the declared vendor binary, and verifies
// tarball sha256 + binary sha256/size before installing it.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.fixture === true) {
    console.log("[codex-managed-runtime] fixture manifest; install skipped");
    return;
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const entry = manifest.platforms?.[platformKey];
  if (!entry) {
    throw new Error(`platform ${platformKey} not in production manifest`);
  }
  if (!entry.artifact?.package || !entry.artifact.vendorPath || !entry.artifact.tarballSha256) {
    throw new Error(`platform ${platformKey} missing pinned artifact metadata`);
  }

  const manifestDir = dirname(MANIFEST_PATH);
  const runtimePath = resolve(manifestDir, entry.path);
  if (existsSync(runtimePath)) {
    const current = statSync(runtimePath);
    const currentHash = sha256(runtimePath);
    if (current.size === entry.size && currentHash === entry.sha256) {
      console.log(`[codex-managed-runtime] already installed: ${runtimePath}`);
      return;
    }
    console.log("[codex-managed-runtime] existing runtime does not match manifest; reinstalling");
    rmSync(runtimePath, { force: true });
  }

  const cacheBaseDir = existsSync(join(PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json"))
    && MANIFEST_PATH.includes(join("src", "runtime", "providers", "codex-managed-app-server"))
    ? PROJECT_ROOT
    : manifestDir;
  const cacheDir = resolve(cacheBaseDir, manifest.source?.artifactCacheDir || ".tmp/codex-managed-runtime-artifacts");
  const extractDir = join(cacheDir, `extract-${platformKey}`);
  let tarballPath = null;
  mkdirSync(cacheDir, { recursive: true });
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  try {
    console.log(`[codex-managed-runtime] runtime version: ${manifest.version}`);
    console.log(`[codex-managed-runtime] download size: ${entry.size} bytes`);
    console.log(`[codex-managed-runtime] source package: ${entry.artifact.package}`);
    console.log(`[codex-managed-runtime] sha256: ${entry.sha256}`);
    console.log(`[codex-managed-runtime] install path: ${runtimePath}`);
    console.log(`[codex-managed-runtime] npm pack ${entry.artifact.package}`);
    const packOut = execSync(`npm pack "${entry.artifact.package}" --pack-destination "${cacheDir}"`, {
      cwd: dirname(MANIFEST_PATH),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim().split(/\r?\n/).filter(Boolean).pop();
    if (!packOut) throw new Error("npm pack did not return a tarball name");

    tarballPath = join(cacheDir, packOut);
    const tarballHash = sha256(tarballPath);
    if (tarballHash !== entry.artifact.tarballSha256) {
      throw new Error(`artifact sha256 mismatch: expected ${entry.artifact.tarballSha256}, got ${tarballHash}`);
    }

    execSync(`tar -xzf "${tarballPath}" -C "${extractDir}"`, { cwd: dirname(MANIFEST_PATH), stdio: "inherit" });
    const sourceBinary = join(extractDir, "package", ...entry.artifact.vendorPath.split("/"));
    if (!existsSync(sourceBinary)) {
      throw new Error(`artifact binary not found: ${sourceBinary}`);
    }

    const size = statSync(sourceBinary).size;
    const binaryHash = sha256(sourceBinary);
    if (size !== entry.size) throw new Error(`binary size mismatch: expected ${entry.size}, got ${size}`);
    if (binaryHash !== entry.sha256) throw new Error(`binary sha256 mismatch: expected ${entry.sha256}, got ${binaryHash}`);

    mkdirSync(dirname(runtimePath), { recursive: true });
    copyFileSync(sourceBinary, runtimePath);
    rmSync(extractDir, { recursive: true, force: true });
    console.log(`[codex-managed-runtime] installed ${platformKey}: ${runtimePath}`);
  } catch (e) {
    rmSync(extractDir, { recursive: true, force: true });
    if (tarballPath) rmSync(tarballPath, { force: true });
    rmSync(runtimePath, { force: true });
    throw e;
  }
}

try {
  main();
} catch (e) {
  console.error(`[codex-managed-runtime] install failed: ${e?.message || e}`);
  process.exit(1);
}
