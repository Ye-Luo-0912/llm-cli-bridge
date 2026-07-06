#!/usr/bin/env node
// LLM CLI Bridge — V17-F3.2 remote download runtime installer smoke.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const USER_PACKAGE_DIR = join(PROJECT_ROOT, "dist", "user-package");
const RUNTIME_DIR = join(USER_PACKAGE_DIR, "codex-managed-runtime");
const INSTALLER_PATH = join(RUNTIME_DIR, "install-codex-managed-runtime.mjs");
const MANIFEST_PATH = join(RUNTIME_DIR, "runtime-manifest.json");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-runtime-install-download.md");

const report = {
  runtimeInstallSource: "unknown",
  runtimeRemoteDownloadSmokeStatus: "fail",
  tarballSha256Valid: false,
  binarySha256Valid: false,
  binarySizeValid: false,
  runtimeExecutable: false,
  runtimeInstallRequiresSystemNpm: "unknown",
  runtimeInstallRequiresSystemTar: "unknown",
  noPartialArtifactsAfterFail: false,
  error: null,
  timestamp: new Date().toISOString(),
};

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
    "# LLM CLI Bridge 测试报告 — Codex Runtime Remote Download Smoke (V17-F3.2)",
    "",
    "> 本报告由 `scripts/codex-runtime-install-download-smoke.mjs` 自动生成。",
    "> 强制清空 local artifact env/cache/runtime binary，验证 installer 走远程 tarball 下载。",
    "",
    `- **测试时间**: ${report.timestamp}`,
    `- **runtimeInstallSource**: ${report.runtimeInstallSource}`,
    `- **runtimeRemoteDownloadSmokeStatus**: ${report.runtimeRemoteDownloadSmokeStatus}`,
    `- **tarballSha256Valid**: ${report.tarballSha256Valid}`,
    `- **binarySha256Valid**: ${report.binarySha256Valid}`,
    `- **binarySizeValid**: ${report.binarySizeValid}`,
    `- **runtimeExecutable**: ${report.runtimeExecutable}`,
    `- **runtimeInstallRequiresSystemNpm**: ${report.runtimeInstallRequiresSystemNpm}`,
    `- **runtimeInstallRequiresSystemTar**: ${report.runtimeInstallRequiresSystemTar}`,
    `- **noPartialArtifactsAfterFail**: ${report.noPartialArtifactsAfterFail}`,
    `- **error**: ${report.error || "null"}`,
    "",
    "## 运行命令",
    "",
    "```bash",
    "npm run smoke:codex-runtime-install-download",
    "```",
    "",
    "*报告由 `scripts/codex-runtime-install-download-smoke.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
}

async function main() {
  try {
    if (!existsSync(INSTALLER_PATH)) throw new Error(`installer missing: ${INSTALLER_PATH}`);
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

    delete process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE;
    rmSync(dirname(runtimePath), { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });

    const mod = await import(pathToFileURL(INSTALLER_PATH).href + `?download=${Date.now()}`);
    if (typeof mod.ensureManagedRuntimeInstalled !== "function") {
      throw new Error("ensureManagedRuntimeInstalled export missing");
    }

    const badArtifact = join(RUNTIME_DIR, "bad-runtime-artifact.tgz");
    writeFileSync(badArtifact, Buffer.from("bad artifact"));
    process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE = badArtifact;
    const failed = await mod.ensureManagedRuntimeInstalled({ confirm: true });
    delete process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE;
    rmSync(badArtifact, { force: true });
    report.noPartialArtifactsAfterFail = failed.status === "failed" && !hasPartialArtifacts(runtimePath, cacheDir, platformKey);

    rmSync(dirname(runtimePath), { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
    const result = await mod.ensureManagedRuntimeInstalled({ confirm: true });
    report.runtimeInstallSource = result.installSource || "unknown";
    report.tarballSha256Valid = result.tarballSha256Valid === true;
    report.binarySha256Valid = result.binarySha256Valid === true;
    report.binarySizeValid = result.binarySizeValid === true;
    report.runtimeExecutable = result.runtimeExecutable === true;
    report.runtimeRemoteDownloadSmokeStatus = result.status === "installed"
      && report.runtimeInstallSource === "download"
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
    report.runtimeRemoteDownloadSmokeStatus = "fail";
  } finally {
    delete process.env.CODEX_MANAGED_RUNTIME_ARTIFACT_FILE;
    writeReport();
  }

  console.log(`runtimeInstallSource=${report.runtimeInstallSource}`);
  console.log(`runtimeRemoteDownloadSmokeStatus=${report.runtimeRemoteDownloadSmokeStatus}`);
  console.log(`tarballSha256Valid=${report.tarballSha256Valid}`);
  console.log(`binarySha256Valid=${report.binarySha256Valid}`);
  console.log(`binarySizeValid=${report.binarySizeValid}`);
  console.log(`runtimeExecutable=${report.runtimeExecutable}`);
  console.log(`runtimeInstallRequiresSystemNpm=${report.runtimeInstallRequiresSystemNpm}`);
  console.log(`runtimeInstallRequiresSystemTar=${report.runtimeInstallRequiresSystemTar}`);
  console.log(`noPartialArtifactsAfterFail=${report.noPartialArtifactsAfterFail}`);
  console.log(`报告已写入: ${REPORT_PATH}`);
  process.exit(report.runtimeRemoteDownloadSmokeStatus === "pass" ? 0 : 1);
}

main();
