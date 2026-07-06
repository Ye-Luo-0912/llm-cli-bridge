#!/usr/bin/env node
// LLM CLI Bridge — V17-F3.1 default-package runtime installer smoke.
//
// Runs the copied installer from dist/user-package/codex-managed-runtime and
// verifies that a default package with no runtime binary can install the pinned
// current-platform runtime without system npm or tar.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const USER_PACKAGE_DIR = join(PROJECT_ROOT, "dist", "user-package");
const RUNTIME_DIR = join(USER_PACKAGE_DIR, "codex-managed-runtime");
const INSTALLER_PATH = join(RUNTIME_DIR, "install-codex-managed-runtime.mjs");
const MANIFEST_PATH = join(RUNTIME_DIR, "runtime-manifest.json");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-runtime-install-default-package.md");

const report = {
  installerPresent: false,
  noRuntimeBefore: false,
  downloadOrLocalArtifactInstall: false,
  installSource: "unknown",
  tarballSha256Valid: false,
  binarySha256Valid: false,
  binarySizeValid: false,
  runtimeExecutable: false,
  noPartialArtifactsAfterFail: false,
  runtimeInstallSmokeStatus: "fail",
  runtimeInstallRequiresSystemNpm: "unknown",
  runtimeInstallRequiresSystemTar: "unknown",
  ensureFunctionPresent: false,
  version: null,
  size: null,
  source: null,
  sha256: null,
  installPath: null,
  error: null,
  timestamp: new Date().toISOString(),
};

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function findLocalArtifact(expectedSha256) {
  const candidates = [
    join(PROJECT_ROOT, ".tmp", "codex-managed-runtime-artifacts"),
    join(PROJECT_ROOT, ".tmp", "codex-pack"),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tgz")) continue;
      const fullPath = join(dir, entry.name);
      try {
        if (sha256(fullPath) === expectedSha256) return fullPath;
      } catch {
        // ignore stale cache entries
      }
    }
  }
  return null;
}

function hasPartialArtifacts(runtimePath, cacheDir, platformKey) {
  const runtimeParent = dirname(runtimePath);
  const runtimeName = runtimePath.split(/[\\/]/).pop() || "codex";
  const partialRuntime = existsSync(runtimeParent)
    && readdirSync(runtimeParent).some((name) => name.startsWith(`${runtimeName}.partial-`));
  const extractDir = existsSync(join(cacheDir, `extract-${platformKey}`));
  return partialRuntime || extractDir || existsSync(runtimePath);
}

function writeReport() {
  mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Codex Runtime Installer Default Package Smoke (V17-F3.1)",
    "",
    "> 本报告由 `scripts/codex-runtime-install-default-package-smoke.mjs` 自动生成。",
    "> 验证 dist/user-package 默认包不含 runtime binary 时，包内 installer 可不依赖系统 npm/tar 完成安装。",
    "",
    `- **测试时间**: ${report.timestamp}`,
    `- **installerPresent**: ${report.installerPresent}`,
    `- **noRuntimeBefore**: ${report.noRuntimeBefore}`,
    `- **downloadOrLocalArtifactInstall**: ${report.downloadOrLocalArtifactInstall}`,
    `- **installSource**: ${report.installSource}`,
    `- **tarballSha256Valid**: ${report.tarballSha256Valid}`,
    `- **binarySha256Valid**: ${report.binarySha256Valid}`,
    `- **binarySizeValid**: ${report.binarySizeValid}`,
    `- **runtimeExecutable**: ${report.runtimeExecutable}`,
    `- **noPartialArtifactsAfterFail**: ${report.noPartialArtifactsAfterFail}`,
    `- **runtimeInstallSmokeStatus**: ${report.runtimeInstallSmokeStatus}`,
    `- **runtimeInstallRequiresSystemNpm**: ${report.runtimeInstallRequiresSystemNpm}`,
    `- **runtimeInstallRequiresSystemTar**: ${report.runtimeInstallRequiresSystemTar}`,
    `- **ensureFunctionPresent**: ${report.ensureFunctionPresent}`,
    `- **version**: ${report.version || "null"}`,
    `- **size**: ${report.size || "null"}`,
    `- **source**: ${report.source || "null"}`,
    `- **sha256**: ${report.sha256 || "null"}`,
    `- **installPath**: ${report.installPath || "null"}`,
    `- **error**: ${report.error || "null"}`,
    "",
    "## 运行命令",
    "",
    "```bash",
    "npm run smoke:codex-runtime-install-default-package",
    "```",
    "",
    "*报告由 `scripts/codex-runtime-install-default-package-smoke.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
}

async function main() {
  try {
    report.installerPresent = existsSync(INSTALLER_PATH);
    if (!report.installerPresent) throw new Error(`installer missing: ${INSTALLER_PATH}`);
    if (!existsSync(MANIFEST_PATH)) throw new Error(`manifest missing: ${MANIFEST_PATH}`);

    const installerSource = readFileSync(INSTALLER_PATH, "utf8");
    report.runtimeInstallRequiresSystemNpm = /\bnpm\s+pack\b|execSync\([^)]*npm/.test(installerSource) ? "true" : "false";
    report.runtimeInstallRequiresSystemTar = /\btar\s+-xzf\b|execSync\([^)]*tar/.test(installerSource) ? "true" : "false";

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const platformKey = `${process.platform}-${process.arch}`;
    const entry = manifest.platforms?.[platformKey];
    if (!entry) throw new Error(`platform missing from default package manifest: ${platformKey}`);
    const runtimePath = resolve(RUNTIME_DIR, entry.path);
    const cacheDir = resolve(RUNTIME_DIR, manifest.source?.artifactCacheDir || ".tmp/codex-managed-runtime-artifacts");
    rmSync(dirname(runtimePath), { recursive: true, force: true });
    report.noRuntimeBefore = !existsSync(runtimePath);

    const mod = await import(pathToFileURL(INSTALLER_PATH).href + `?smoke=${Date.now()}`);
    report.ensureFunctionPresent = typeof mod.ensureManagedRuntimeInstalled === "function";
    if (!report.ensureFunctionPresent) throw new Error("ensureManagedRuntimeInstalled export missing");

    const badArtifact = join(RUNTIME_DIR, "bad-runtime-artifact.tgz");
    writeFileSync(badArtifact, Buffer.from("bad artifact"));
    process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE = badArtifact;
    const failed = await mod.ensureManagedRuntimeInstalled({ confirm: true });
    rmSync(badArtifact, { force: true });
    report.noPartialArtifactsAfterFail = failed.status === "failed" && !hasPartialArtifacts(runtimePath, cacheDir, platformKey);

    const localArtifact = findLocalArtifact(entry.artifact.tarballSha256);
    if (localArtifact) process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE = localArtifact;
    else delete process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE;

    const result = await mod.ensureManagedRuntimeInstalled({ confirm: true });
    report.installSource = result.installSource || "download";
    report.downloadOrLocalArtifactInstall = ["download", "local-artifact"].includes(report.installSource)
      && result.status === "installed";
    report.tarballSha256Valid = result.tarballSha256Valid === true;
    report.binarySha256Valid = result.binarySha256Valid === true;
    report.binarySizeValid = result.binarySizeValid === true;
    report.runtimeExecutable = result.runtimeExecutable === true;
    report.version = result.version;
    report.size = result.size;
    report.source = result.source;
    report.sha256 = result.sha256;
    report.installPath = result.installPath;
    report.error = result.error;
    report.runtimeInstallSmokeStatus = report.installerPresent
      && report.noRuntimeBefore
      && report.downloadOrLocalArtifactInstall
      && report.tarballSha256Valid
      && report.binarySha256Valid
      && report.binarySizeValid
      && report.runtimeExecutable
      && report.noPartialArtifactsAfterFail
      && report.runtimeInstallRequiresSystemNpm === "false"
      && report.runtimeInstallRequiresSystemTar === "false"
        ? "pass"
        : "fail";
  } catch (e) {
    report.error = e?.message || String(e);
    report.runtimeInstallSmokeStatus = "fail";
  } finally {
    delete process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE;
    writeReport();
  }

  console.log(`installerPresent=${report.installerPresent}`);
  console.log(`noRuntimeBefore=${report.noRuntimeBefore}`);
  console.log(`downloadOrLocalArtifactInstall=${report.downloadOrLocalArtifactInstall}`);
  console.log(`tarballSha256Valid=${report.tarballSha256Valid}`);
  console.log(`binarySha256Valid=${report.binarySha256Valid}`);
  console.log(`binarySizeValid=${report.binarySizeValid}`);
  console.log(`runtimeExecutable=${report.runtimeExecutable}`);
  console.log(`noPartialArtifactsAfterFail=${report.noPartialArtifactsAfterFail}`);
  console.log(`runtimeInstallSmokeStatus=${report.runtimeInstallSmokeStatus}`);
  console.log(`runtimeInstallRequiresSystemNpm=${report.runtimeInstallRequiresSystemNpm}`);
  console.log(`runtimeInstallRequiresSystemTar=${report.runtimeInstallRequiresSystemTar}`);
  console.log(`报告已写入: ${REPORT_PATH}`);
  process.exit(report.runtimeInstallSmokeStatus === "pass" ? 0 : 1);
}

main();
