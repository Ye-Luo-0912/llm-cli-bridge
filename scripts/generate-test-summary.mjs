#!/usr/bin/env node
// LLM CLI Bridge — Test report summary generator (Managed Codex Runtime 主线)
//
// 从 docs/test-report-unit.md + docs/test-report-process.md +
// docs/test-report-codex-managed-runtime.md + docs/test-report-user-package.md
// 解析生成 docs/test-report-summary.md。不手写：所有数字/commit sha/运行命令均来自
// 上游报告的解析结果。
//
// P2 审计模式（integrity check）：
// - testedCodeCommitSha 语义：
//   - 若当前 commit 只修改 docs/test-report*.md（docs-only commit），
//     则 testedCodeCommitSha = parentSha（报告证明的是父 commit 的代码）。
//   - 若当前 commit 修改 src/scripts/package.json/schema 等主线文件，
//     则 testedCodeCommitSha = current HEAD（报告必须证明当前 commit）。
// - unit / process 报告的 commit sha 必须一致，且等于 testedCodeCommitSha。
// - Managed Codex Runtime gate 必须通过（resolver/runtime/protocol/codexUserReady）。
// - 任一报告缺失 / 字段解析失败 / uncaught-unhandled 非 0 → 标记 fail，退出码 1。
//
// 运行：node scripts/generate-test-summary.mjs
// 或：  npm run test:summary

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const UNIT_REPORT = join(DOCS_DIR, "test-report-unit.md");
const PROCESS_REPORT = join(DOCS_DIR, "test-report-process.md");
const CODEX_MANAGED_RUNTIME_REPORT = join(DOCS_DIR, "test-report-codex-managed-runtime.md");
const USER_PACKAGE_REPORT = join(DOCS_DIR, "test-report-user-package.md"); // V17-E1 任务 D
const CODEX_RUNTIME_INSTALL_REPORT = join(DOCS_DIR, "test-report-codex-runtime-install-default-package.md");
const CODEX_RUNTIME_DOWNLOAD_REPORT = join(DOCS_DIR, "test-report-codex-runtime-install-download.md");
const CODEX_FIRST_RUN_REPORT = join(DOCS_DIR, "test-report-codex-managed-first-run.md");
const SUMMARY_REPORT = join(DOCS_DIR, "test-report-summary.md");

// ============================================================
// 解析单份报告：提取 commit sha / 运行命令 / 通过/失败/跳过/总计
// ============================================================

function parseReport(path, label) {
  if (!existsSync(path)) {
    return { label, error: `报告文件不存在: ${path}` };
  }
  const text = readFileSync(path, "utf8");
  const result = { label, raw: text };

  // commit sha
  const shaMatch = text.match(/- \*\*commit sha\*\*: ([a-f0-9]+)/);
  result.commitSha = shaMatch ? shaMatch[1] : null;

  // 运行命令
  const cmdMatch = text.match(/- \*\*运行命令\*\*: (.+)/);
  result.runCommand = cmdMatch ? cmdMatch[1].trim() : null;

  // 测试时间
  const tsMatch = text.match(/- \*\*测试时间\*\*: (.+)/);
  result.timestamp = tsMatch ? tsMatch[1].trim() : null;

  // 通过/失败/跳过/需人工验证/总计（匹配 "- ✅ **通过**: N" 等）
  const passMatch = text.match(/- ✅ \*\*通过\*\*: (\d+)/);
  const failMatch = text.match(/- ❌ \*\*失败\*\*: (\d+)/);
  const skipMatch = text.match(/- ⏭️ \*\*跳过\*\*: (\d+)/);
  const manualMatch = text.match(/- ⚪ \*\*需人工验证\*\*: (\d+)/);
  const totalMatch = text.match(/- \*\*总计\*\*: (\d+)/);
  result.passed = passMatch ? parseInt(passMatch[1], 10) : null;
  result.failed = failMatch ? parseInt(failMatch[1], 10) : null;
  result.skipped = skipMatch ? parseInt(skipMatch[1], 10) : null;
  result.manualRequired = manualMatch ? parseInt(manualMatch[1], 10) : null;
  result.total = totalMatch ? parseInt(totalMatch[1], 10) : null;

  // uncaughtException / unhandledRejection 计数
  const uncaughtMatch = text.match(/本轮 uncaughtException 次数\*\*: (\d+)/);
  const unhandledMatch = text.match(/本轮 unhandledRejection 次数\*\*: (\d+)/);
  result.uncaughtCount = uncaughtMatch ? parseInt(uncaughtMatch[1], 10) : 0;
  result.unhandledCount = unhandledMatch ? parseInt(unhandledMatch[1], 10) : 0;

  // 校验所有数字字段都解析到
  const missing = [];
  if (result.commitSha === null) missing.push("commitSha");
  if (result.runCommand === null) missing.push("runCommand");
  if (result.passed === null) missing.push("passed");
  if (result.failed === null) missing.push("failed");
  if (result.skipped === null) missing.push("skipped");
  if (result.total === null) missing.push("total");
  if (missing.length > 0) {
    result.error = `字段解析失败: ${missing.join(", ")}`;
  }

  return result;
}

// ============================================================
// V17-E1 任务 D：解析 user-package smoke 报告
// ============================================================

function parseUserPackageReport(path) {
  if (!existsSync(path)) {
    return { label: "user-package", error: `报告文件不存在: ${path}` };
  }
  const text = readFileSync(path, "utf8");
  const result = { label: "user-package", raw: text };

  const statusMatch = text.match(/- \*\*userPackageStatus\*\*: (pass|fail)/);
  result.userPackageStatus = statusMatch ? statusMatch[1] : null;

  const containsSdkMatch = text.match(/- \*\*containsPiSdk\*\*: (true|false)/);
  result.containsPiSdk = containsSdkMatch ? containsSdkMatch[1] : null;

  const canRequireMatch = text.match(/- \*\*canRequirePiSdk\*\*: (true|false)/);
  result.canRequirePiSdk = canRequireMatch ? canRequireMatch[1] : null;

  // V17-E1 任务 C：canLoadMainJs + noRootPackageJson
  const canLoadMatch = text.match(/- \*\*canLoadMainJs\*\*: (true|false)/);
  result.canLoadMainJs = canLoadMatch ? canLoadMatch[1] : null;

  const noPkgMatch = text.match(/- \*\*noRootPackageJson\*\*: (true|false)/);
  result.noRootPackageJson = noPkgMatch ? noPkgMatch[1] : null;

  const needsNpmMatch = text.match(/- \*\*userNeedsNpmInstall\*\*: (true|false)/);
  result.userNeedsNpmInstall = needsNpmMatch ? needsNpmMatch[1] : null;

  const sizeMatch = text.match(/- \*\*totalSizeMB\*\*: ([\d.]+)/);
  result.totalSizeMB = sizeMatch ? sizeMatch[1] : null;

  // V17-F1.1 任务 D：解析 managed runtime 字段
  const containsManagedMatch = text.match(/- \*\*containsCodexManagedRuntime\*\*: (true|false)/);
  result.containsCodexManagedRuntime = containsManagedMatch ? containsManagedMatch[1] : null;

  const shaValidMatch = text.match(/- \*\*codexRuntimeSha256Valid\*\*: (true|false)/);
  result.codexRuntimeSha256Valid = shaValidMatch ? shaValidMatch[1] : null;

  const execMatch = text.match(/- \*\*codexRuntimeExecutable\*\*: (true|false)/);
  result.codexRuntimeExecutable = execMatch ? execMatch[1] : null;

  const pinnedVerMatch = text.match(/- \*\*codexRuntimePinnedVersion\*\*: ([^\r\n]+)/);
  result.codexRuntimePinnedVersion = pinnedVerMatch ? pinnedVerMatch[1] : null;

  const fixtureMatch = text.match(/- \*\*codexRuntimeFixture\*\*: (true|false)/);
  result.codexRuntimeFixture = fixtureMatch ? fixtureMatch[1] : null;

  const releaseContainsMatch = text.match(/- \*\*releasePackageContainsCodexRuntime\*\*: (true|false)/);
  result.releasePackageContainsCodexRuntime = releaseContainsMatch ? releaseContainsMatch[1] : null;

  const modeMatch = text.match(/- \*\*releasePackageMode\*\*: ([^\r\n]+)/);
  result.releasePackageMode = modeMatch ? modeMatch[1].trim() : null;

  const containsBinaryMatch = text.match(/- \*\*containsRuntimeBinary\*\*: (true|false)/);
  result.containsRuntimeBinary = containsBinaryMatch ? containsBinaryMatch[1] : null;

  const downloadRequiredMatch = text.match(/- \*\*runtimeDownloadRequired\*\*: (true|false)/);
  result.runtimeDownloadRequired = downloadRequiredMatch ? downloadRequiredMatch[1] : null;

  const metadataMatch = text.match(/- \*\*runtimePinnedArtifactMetadataComplete\*\*: (true|false)/);
  result.runtimePinnedArtifactMetadataComplete = metadataMatch ? metadataMatch[1] : null;

  const installerExecMatch = text.match(/- \*\*runtimeInstallerExecutable\*\*: (true|false)/);
  result.runtimeInstallerExecutable = installerExecMatch ? installerExecMatch[1] : null;

  const npmReqMatch = text.match(/- \*\*runtimeInstallRequiresSystemNpm\*\*: (true|false)/);
  result.runtimeInstallRequiresSystemNpm = npmReqMatch ? npmReqMatch[1] : null;

  const tarReqMatch = text.match(/- \*\*runtimeInstallRequiresSystemTar\*\*: (true|false)/);
  result.runtimeInstallRequiresSystemTar = tarReqMatch ? tarReqMatch[1] : null;

  const releaseSizeMatch = text.match(/- \*\*releasePackageSizeMB\*\*: ([\d.]+)/);
  result.releasePackageSizeMB = releaseSizeMatch ? releaseSizeMatch[1] : null;

  const runtimeShaVerifiedMatch = text.match(/- \*\*runtimeBinarySha256Verified\*\*: (true|false)/);
  result.runtimeBinarySha256Verified = runtimeShaVerifiedMatch ? runtimeShaVerifiedMatch[1] : null;

  if (result.userPackageStatus === null) {
    result.error = "userPackageStatus 字段解析失败";
  }
  return result;
}

function parseRuntimeInstallReport(path) {
  if (!existsSync(path)) {
    return { label: "codex-runtime-install-default-package", error: `报告文件不存在: ${path}` };
  }
  const text = readFileSync(path, "utf8");
  const result = { label: "codex-runtime-install-default-package", raw: text };
  const fields = [
    "installerPresent",
    "noRuntimeBefore",
    "downloadOrLocalArtifactInstall",
    "tarballSha256Valid",
    "binarySha256Valid",
    "binarySizeValid",
    "runtimeExecutable",
    "noPartialArtifactsAfterFail",
    "runtimeInstallSmokeStatus",
    "runtimeInstallRequiresSystemNpm",
    "runtimeInstallRequiresSystemTar",
  ];
  for (const field of fields) {
    const m = text.match(new RegExp(`- \\*\\*${field}\\*\\*: ([^\\r\\n]+)`));
    result[field] = m ? m[1].trim() : null;
  }
  if (!result.runtimeInstallSmokeStatus) result.error = "runtimeInstallSmokeStatus 字段解析失败";
  return result;
}

function parseRuntimeDownloadReport(path) {
  if (!existsSync(path)) {
    return { label: "codex-runtime-install-download", error: `报告文件不存在: ${path}` };
  }
  const text = readFileSync(path, "utf8");
  const result = { label: "codex-runtime-install-download", raw: text };
  const fields = [
    "runtimeInstallSource",
    "runtimeRemoteDownloadSmokeStatus",
    "tarballSha256Valid",
    "binarySha256Valid",
    "binarySizeValid",
    "runtimeExecutable",
    "runtimeInstallRequiresSystemNpm",
    "runtimeInstallRequiresSystemTar",
    "noPartialArtifactsAfterFail",
  ];
  for (const field of fields) {
    const m = text.match(new RegExp(`- \\*\\*${field}\\*\\*: ([^\\r\\n]+)`));
    result[field] = m ? m[1].trim() : null;
  }
  if (!result.runtimeRemoteDownloadSmokeStatus) result.error = "runtimeRemoteDownloadSmokeStatus 字段解析失败";
  return result;
}

function parseFirstRunReport(path) {
  if (!existsSync(path)) {
    return { label: "codex-managed-first-run", error: `报告文件不存在: ${path}` };
  }
  const text = readFileSync(path, "utf8");
  const result = { label: "codex-managed-first-run", raw: text };
  const fields = [
    "runtimeFirstRunIntegrationStatus",
    "resolverBeforeInstallStatus",
    "installRequiredSurfaced",
    "installerStatus",
    "resolverAfterInstallStatus",
    "providerAfterInstall",
  ];
  for (const field of fields) {
    const m = text.match(new RegExp(`- \\*\\*${field}\\*\\*: ([^\\r\\n]+)`));
    result[field] = m ? m[1].trim() : null;
  }
  if (!result.runtimeFirstRunIntegrationStatus) result.error = "runtimeFirstRunIntegrationStatus 字段解析失败";
  return result;
}

// ============================================================
// V17-F2：解析 Managed Codex Runtime production smoke 报告
// ============================================================

function parseManagedRuntimeReport(path) {
  if (!existsSync(path)) {
    return { label: "codex-managed-runtime", error: `报告文件不存在: ${path}` };
  }
  const text = readFileSync(path, "utf8");
  const result = { label: "codex-managed-runtime", raw: text };
  const fields = [
    "resolverSmokeStatus",
    "runtimeSmokeStatus",
    "managedAppServerProtocolStatus",
    "codexUserReady",
    "manifestVersion",
    "manifestFixture",
    "supportedPlatforms",
    "testedPlatform",
    "crossPlatformReady",
    "sha256Valid",
    "executableValid",
    "appServerSpawnStatus",
    "initializeStatus",
    "initializedStatus",
    "threadStartStatus",
    "turnStartStatus",
    "turnCompletedStatus",
    "stopCancelStatus",
    "noVaultRootPollution",
    "binaryDependency",
    "authConfigDependency",
    "managedRuntimeReadsUserCodexHome",
    "codexHome",
  ];
  for (const field of fields) {
    const m = text.match(new RegExp(`- \\*\\*${field}\\*\\*: ([^\\r\\n]+)`));
    result[field] = m ? m[1].trim() : null;
  }
  const missing = ["resolverSmokeStatus", "runtimeSmokeStatus", "managedAppServerProtocolStatus", "codexUserReady"]
    .filter((field) => result[field] === null);
  if (missing.length > 0) {
    result.error = `字段解析失败: ${missing.join(", ")}`;
  }
  return result;
}

// ============================================================
// 判定当前 commit 是否为 docs-only commit（仅修改 docs/test-report*.md）
// ============================================================

function classifyCurrentCommit(headSha) {
  // parentSha（V16.3: Windows cmd 会把 ^ 当转义字符吃掉，改用 HEAD~1）
  let parentSha = null;
  try {
    parentSha = execSync("git rev-parse HEAD~1", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    // 无 parent（初始 commit / shallow clone）→ 无法判定 docs-only，退化为 code commit
  }

  // 当前 commit 修改的文件列表
  let changedFiles = [];
  if (parentSha) {
    try {
      const out = execSync("git diff --name-only HEAD~1 HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" });
      changedFiles = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch {
      // diff 失败 → 退化为 code commit
    }
  }

  // docs-only：所有改动文件都匹配 docs/test-report*.md
  const docsOnlyPattern = /^docs\/test-report[^/]*\.md$/;
  const isDocsOnlyCommit = changedFiles.length > 0
    && changedFiles.every((f) => docsOnlyPattern.test(f));

  return {
    parentSha,
    changedFiles,
    isDocsOnlyCommit,
  };
}

// ============================================================
// 生成 summary
// ============================================================

function main() {
  const auditFailures = [];

  // 1. 当前 HEAD commit sha（= reportCommitSha，报告所在的 commit）
  let reportCommitSha = "unknown";
  try {
    reportCommitSha = execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch (e) {
    auditFailures.push(`无法获取当前 HEAD commit sha: ${e?.message || e}`);
  }

  // 2. 解析 unit / process / managed-runtime / user-package 报告
  const unit = parseReport(UNIT_REPORT, "unit");
  const processReport = parseReport(PROCESS_REPORT, "process");
  const managedRuntime = parseManagedRuntimeReport(CODEX_MANAGED_RUNTIME_REPORT);
  const userPackage = parseUserPackageReport(USER_PACKAGE_REPORT); // V17-E1 任务 D
  const runtimeInstall = parseRuntimeInstallReport(CODEX_RUNTIME_INSTALL_REPORT);
  const runtimeDownload = parseRuntimeDownloadReport(CODEX_RUNTIME_DOWNLOAD_REPORT);
  const firstRun = parseFirstRunReport(CODEX_FIRST_RUN_REPORT);

  if (unit.error) auditFailures.push(`unit 报告: ${unit.error}`);
  if (processReport.error) auditFailures.push(`process 报告: ${processReport.error}`);
  if (managedRuntime.error) auditFailures.push(`managed-runtime 报告: ${managedRuntime.error}`);
  if (userPackage.error) auditFailures.push(`user-package 报告: ${userPackage.error}`);
  if (runtimeInstall.error) auditFailures.push(`runtime-install 报告: ${runtimeInstall.error}`);
  if (runtimeDownload.error) auditFailures.push(`runtime-download 报告: ${runtimeDownload.error}`);
  if (firstRun.error) auditFailures.push(`first-run 报告: ${firstRun.error}`);

  // 3. 判定 docs-only commit → 计算 testedCodeCommitSha
  const commitClass = classifyCurrentCommit(reportCommitSha);
  const reportParentSha = commitClass.parentSha || "unknown";
  const testedCodeCommitSha = commitClass.isDocsOnlyCommit
    ? (commitClass.parentSha || reportCommitSha)
    : reportCommitSha;
  const commitKind = commitClass.isDocsOnlyCommit ? "docs-only（报告证明父 commit 代码）" : "code commit（报告证明当前 HEAD）";

  // 4. commit sha 一致性校验（P2 条件逻辑）
  if (!unit.error && !processReport.error) {
    // 4a. unit 与 process 必须一致
    if (unit.commitSha !== processReport.commitSha) {
      auditFailures.push(`commit sha 不一致: unit=${unit.commitSha} vs process=${processReport.commitSha}`);
    }
    // 4b. unit/process 必须 === testedCodeCommitSha
    if (testedCodeCommitSha !== "unknown" && unit.commitSha !== testedCodeCommitSha) {
      auditFailures.push(`unit commit sha 与 testedCodeCommitSha 不匹配: unit=${unit.commitSha} vs testedCode=${testedCodeCommitSha}（commitKind=${commitKind}）`);
    }
    if (testedCodeCommitSha !== "unknown" && processReport.commitSha !== testedCodeCommitSha) {
      auditFailures.push(`process commit sha 与 testedCodeCommitSha 不匹配: process=${processReport.commitSha} vs testedCode=${testedCodeCommitSha}（commitKind=${commitKind}）`);
    }
  }

  // 5. V17-F2.1：external Codex CLI/app-server 仅为兼容路径，本 summary 不解析
  // external local smoke 报告，避免引用未提交或过期的兼容路径结果。
  const externalCodexSmokeStatus = "not-evaluated";
  const externalCodexHandshakeStatus = "not-evaluated";
  const externalCodexCompatibilityStatus = "not-main-gate";

  // 6. 审计模式：uncaughtException / unhandledRejection 必须为 0（否则计为 fail）
  if (!unit.error && (unit.uncaughtCount > 0 || unit.unhandledCount > 0)) {
    auditFailures.push(`unit 审计异常: uncaught=${unit.uncaughtCount} unhandled=${unit.unhandledCount}`);
  }
  if (!processReport.error && (processReport.uncaughtCount > 0 || processReport.unhandledCount > 0)) {
    auditFailures.push(`process 审计异常: uncaught=${processReport.uncaughtCount} unhandled=${processReport.unhandledCount}`);
  }

  // 7. 汇总数字（即使有 audit failure 也尽量输出，便于诊断）
  const totalPassed = (unit.passed || 0) + (processReport.passed || 0);
  const totalFailed = (unit.failed || 0) + (processReport.failed || 0);
  const totalSkipped = (unit.skipped || 0) + (processReport.skipped || 0);
  const totalManual = (unit.manualRequired || 0) + (processReport.manualRequired || 0);
  const grandTotal = (unit.total || 0) + (processReport.total || 0);

  // 8. 生成 summary 报告
  const managedCodexUserReady = managedRuntime.codexUserReady || null;
  const managedResolverSmokeStatus = managedRuntime.resolverSmokeStatus || null;
  const managedRuntimeSmokeStatus = managedRuntime.runtimeSmokeStatus || null;
  const managedProtocolStatus = managedRuntime.managedAppServerProtocolStatus || null;
  if (!managedRuntime.error) {
    if (managedResolverSmokeStatus !== "pass"
      || managedRuntimeSmokeStatus !== "pass"
      || managedProtocolStatus !== "pass"
      || managedCodexUserReady !== "true") {
      auditFailures.push(
        `managed runtime gate 未通过: resolver=${managedResolverSmokeStatus} runtime=${managedRuntimeSmokeStatus} protocol=${managedProtocolStatus} codexUserReady=${managedCodexUserReady}`,
      );
    }
    if (managedRuntime.crossPlatformReady !== "false") {
      auditFailures.push(`platform boundary 字段异常: crossPlatformReady=${managedRuntime.crossPlatformReady}`);
    }
  }
  if (!userPackage.error) {
    if (userPackage.releasePackageContainsCodexRuntime !== "true"
      || userPackage.runtimePinnedArtifactMetadataComplete !== "true"
      || userPackage.runtimeInstallerExecutable !== "true"
      || !userPackage.releasePackageSizeMB) {
      auditFailures.push(
        `release packaging gate 未通过: containsRuntime=${userPackage.releasePackageContainsCodexRuntime} mode=${userPackage.releasePackageMode} metadata=${userPackage.runtimePinnedArtifactMetadataComplete} installerExecutable=${userPackage.runtimeInstallerExecutable} sizeMB=${userPackage.releasePackageSizeMB}`,
      );
    }
  }
  if (!runtimeInstall.error) {
    if (runtimeInstall.runtimeInstallSmokeStatus !== "pass"
      || runtimeInstall.runtimeInstallRequiresSystemNpm !== "false"
      || runtimeInstall.runtimeInstallRequiresSystemTar !== "false") {
      auditFailures.push(
        `runtime installer smoke 未通过: status=${runtimeInstall.runtimeInstallSmokeStatus} npm=${runtimeInstall.runtimeInstallRequiresSystemNpm} tar=${runtimeInstall.runtimeInstallRequiresSystemTar}`,
      );
    }
  }
  if (!runtimeDownload.error) {
    if (runtimeDownload.runtimeRemoteDownloadSmokeStatus !== "pass"
      || runtimeDownload.runtimeInstallSource !== "download"
      || runtimeDownload.runtimeInstallRequiresSystemNpm !== "false"
      || runtimeDownload.runtimeInstallRequiresSystemTar !== "false") {
      auditFailures.push(
        `runtime remote download smoke 未通过: status=${runtimeDownload.runtimeRemoteDownloadSmokeStatus} source=${runtimeDownload.runtimeInstallSource} npm=${runtimeDownload.runtimeInstallRequiresSystemNpm} tar=${runtimeDownload.runtimeInstallRequiresSystemTar}`,
      );
    }
  }
  if (!firstRun.error) {
    if (firstRun.runtimeFirstRunIntegrationStatus !== "pass"
      || firstRun.installRequiredSurfaced !== "true"
      || firstRun.resolverAfterInstallStatus !== "pass"
      || firstRun.providerAfterInstall !== "codex-managed-app-server") {
      auditFailures.push(
        `first-run integration smoke 未通过: status=${firstRun.runtimeFirstRunIntegrationStatus} surfaced=${firstRun.installRequiredSurfaced} resolverAfter=${firstRun.resolverAfterInstallStatus} providerAfter=${firstRun.providerAfterInstall}`,
      );
    }
  }
  const managedRuntimePassed = managedCodexUserReady === "true"
    && managedResolverSmokeStatus === "pass"
    && managedRuntimeSmokeStatus === "pass"
    && managedProtocolStatus === "pass";
  const managedRuntimeSkipped = managedRuntimeSmokeStatus === "fixture-only" || managedProtocolStatus === "skip-fixture";

  const lines = [
    "# LLM CLI Bridge 测试报告 — 汇总（Managed Codex Runtime 主线）",
    "",
    "> 本报告由 `scripts/generate-test-summary.mjs` 从 unit/process/managed-runtime/user-package 报告解析生成，不手写。",
    "> 详细结果分别见：",
    "> - [docs/test-report-unit.md](./test-report-unit.md) — 单元测试详细结果",
    "> - [docs/test-report-process.md](./test-report-process.md) — 进程测试详细结果",
    "> - [docs/test-report-codex-managed-runtime.md](./test-report-codex-managed-runtime.md) — Managed Codex Runtime smoke",
    ">",
    "> 报告不互相覆盖：unit/process/managed-runtime/user-package 各自独立生成，summary 仅汇总主线结论。",
    "> external Codex CLI/app-server 是兼容路径；本 summary 不解析旧 codex-smoke 报告，也不把 external 状态作为主 gate。",
    "",
    `- **生成时间**: ${new Date().toISOString()}`,
    `- **reportCommitSha**: ${reportCommitSha}`,
    `- **reportCommitSha 短**: ${reportCommitSha.slice(0, 12)}`,
    `- **reportParentSha**: ${reportParentSha}`,
    `- **reportParentSha 短**: ${reportParentSha.slice(0, 12)}`,
    `- **testedCodeCommitSha**: ${testedCodeCommitSha}`,
    `- **testedCodeCommitSha 短**: ${testedCodeCommitSha.slice(0, 12)}`,
    `- **commitKind**: ${commitKind}`,
    `- **unitReportCommitSha**: ${unit.commitSha || "(解析失败)"}`,
    `- **processReportCommitSha**: ${processReport.commitSha || "(解析失败)"}`,
    `- **externalCodexSmokeStatus**: ${externalCodexSmokeStatus}`,
    `- **externalCodexHandshakeStatus**: ${externalCodexHandshakeStatus}`,
    `- **externalCodexCompatibilityStatus**: ${externalCodexCompatibilityStatus}`,
    // V17-E 任务 E：新增 codexUserReady 字段（smoke=pass 才 true；skip/fail/handshake-only 均 false）
    // V17-F1 任务 G：codexUserReady 主 gate 改为 managed runtime gate
    // V17-F1.1 任务 E：使用分层字段 gate
    `- **codexUserReady**: ${managedCodexUserReady || "(解析失败)"}`,
    // V17-F1.1 任务 E：分层字段（3 个，主 gate）
    `- **codexManagedResolverSmokeStatus**: ${managedResolverSmokeStatus || "(解析失败)"}`,
    `- **codexManagedRuntimeSmokeStatus**: ${managedRuntimeSmokeStatus || "(解析失败)"}`,
    `- **codexManagedAppServerProtocolStatus**: ${managedProtocolStatus || "(解析失败)"}`,
    // V17-F1 任务 G：Managed runtime 主线字段（主 gate，5 个）
    `- **codexManagedRuntimeAvailable**: ${managedRuntime.runtimeSmokeStatus === "pass" ? "true" : "false"}`,
    `- **codexManagedRuntimeVersion**: ${managedRuntime.manifestVersion || "(解析失败)"}`,
    `- **codexManagedRuntimeSha256Valid**: ${managedRuntime.sha256Valid || "(解析失败)"}`,
    `- **codexManagedRuntimeExecutable**: ${managedRuntime.executableValid || "(解析失败)"}`,
    `- **codexManagedAppServerSpawnStatus**: ${managedRuntime.appServerSpawnStatus || "(解析失败)"}`,
    `- **supportedPlatforms**: ${managedRuntime.supportedPlatforms || "(解析失败)"}`,
    `- **testedPlatform**: ${managedRuntime.testedPlatform || "(解析失败)"}`,
    `- **crossPlatformReady**: ${managedRuntime.crossPlatformReady || "(解析失败)"}`,
    `- **binaryDependency**: ${managedRuntime.binaryDependency || "(解析失败)"}`,
    `- **authConfigDependency**: ${managedRuntime.authConfigDependency || "(解析失败)"}`,
    `- **managedRuntimeReadsUserCodexHome**: ${managedRuntime.managedRuntimeReadsUserCodexHome || "(解析失败)"}`,
    `- **codexHome**: ${managedRuntime.codexHome || "(解析失败)"}`,
    `- **initializeStatus**: ${managedRuntime.initializeStatus || "(解析失败)"}`,
    `- **threadStartStatus**: ${managedRuntime.threadStartStatus || "(解析失败)"}`,
    `- **turnStartStatus**: ${managedRuntime.turnStartStatus || "(解析失败)"}`,
    `- **turnCompletedStatus**: ${managedRuntime.turnCompletedStatus || "(解析失败)"}`,
    `- **stopCancelStatus**: ${managedRuntime.stopCancelStatus || "(解析失败)"}`,
    `- **noVaultRootPollution**: ${managedRuntime.noVaultRootPollution || "(解析失败)"}`,
    // V17-E1 任务 D：user-package smoke 字段
    `- **userPackageStatus**: ${userPackage.userPackageStatus || "(解析失败)"}`,
    `- **containsPiSdk**: ${userPackage.containsPiSdk || "(解析失败)"}`,
    `- **canRequirePiSdk**: ${userPackage.canRequirePiSdk || "(解析失败)"}`,
    `- **canLoadMainJs**: ${userPackage.canLoadMainJs || "(解析失败)"}`,
    `- **noRootPackageJson**: ${userPackage.noRootPackageJson || "(解析失败)"}`,
    `- **userNeedsNpmInstall**: ${userPackage.userNeedsNpmInstall || "(解析失败)"}`,
    // V17-F1.1 任务 D：user-package managed runtime 字段
    `- **containsCodexManagedRuntime**: ${userPackage.containsCodexManagedRuntime || "(解析失败)"}`,
    `- **codexRuntimeSha256Valid**: ${userPackage.codexRuntimeSha256Valid || "(解析失败)"}`,
    `- **codexRuntimeExecutable**: ${userPackage.codexRuntimeExecutable || "(解析失败)"}`,
    `- **codexRuntimePinnedVersion**: ${userPackage.codexRuntimePinnedVersion || "(解析失败)"}`,
    `- **codexRuntimeFixture**: ${userPackage.codexRuntimeFixture || "(解析失败)"}`,
    `- **userPackageSizeMB**: ${userPackage.totalSizeMB || "(解析失败)"}`,
    `- **releasePackageMode**: ${userPackage.releasePackageMode || "(解析失败)"}`,
    `- **containsRuntimeBinary**: ${userPackage.containsRuntimeBinary || "(解析失败)"}`,
    `- **runtimeDownloadRequired**: ${userPackage.runtimeDownloadRequired || "(解析失败)"}`,
    `- **runtimePinnedArtifactMetadataComplete**: ${userPackage.runtimePinnedArtifactMetadataComplete || "(解析失败)"}`,
    `- **runtimeInstallerExecutable**: ${userPackage.runtimeInstallerExecutable || "(解析失败)"}`,
    `- **runtimeInstallSmokeStatus**: ${runtimeInstall.runtimeInstallSmokeStatus || "(解析失败)"}`,
    `- **runtimeInstallSource**: ${runtimeDownload.runtimeInstallSource || "(解析失败)"}`,
    `- **runtimeRemoteDownloadSmokeStatus**: ${runtimeDownload.runtimeRemoteDownloadSmokeStatus || "(解析失败)"}`,
    `- **runtimeFirstRunIntegrationStatus**: ${firstRun.runtimeFirstRunIntegrationStatus || "(解析失败)"}`,
    `- **installRequiredSurfaced**: ${firstRun.installRequiredSurfaced || "(解析失败)"}`,
    `- **resolverAfterInstallStatus**: ${firstRun.resolverAfterInstallStatus || "(解析失败)"}`,
    `- **providerAfterInstall**: ${firstRun.providerAfterInstall || "(解析失败)"}`,
    `- **runtimeInstallRequiresSystemNpm**: ${runtimeInstall.runtimeInstallRequiresSystemNpm || "(解析失败)"}`,
    `- **runtimeInstallRequiresSystemTar**: ${runtimeInstall.runtimeInstallRequiresSystemTar || "(解析失败)"}`,
    `- **releasePackageContainsCodexRuntime**: ${userPackage.releasePackageContainsCodexRuntime || "(解析失败)"}`,
    `- **releasePackageSizeMB**: ${userPackage.releasePackageSizeMB || "(解析失败)"}`,
    `- **runtimeBinarySha256Verified**: ${userPackage.runtimeBinarySha256Verified || "(解析失败)"}`,
    `- **unit 运行命令**: ${unit.runCommand || "(解析失败)"}`,
    `- **process 运行命令**: ${processReport.runCommand || "(解析失败)"}`,
    `- **unit 测试时间**: ${unit.timestamp || "(解析失败)"}`,
    `- **process 测试时间**: ${processReport.timestamp || "(解析失败)"}`,
    "",
    "## testedCodeCommitSha 语义说明",
    "",
    "- **docs-only commit**（当前 commit 只修改 `docs/test-report*.md`）：`testedCodeCommitSha = reportParentSha`，即报告证明的是父 commit（代码 commit）的测试结果。",
    "- **code commit**（当前 commit 修改 `src/` / `scripts/` / `package.json` / `schema/` 等主线文件）：`testedCodeCommitSha = reportCommitSha`（= HEAD），报告必须证明当前 commit。",
    `- **本次判定**：${commitKind}；testedCodeCommitSha=${testedCodeCommitSha.slice(0, 12)}。`,
    `- **当前 commit 改动文件**：${commitClass.changedFiles.length === 0 ? "(无改动 / 无法获取)" : commitClass.changedFiles.join(", ")}`,
    "",
    "## 主线结论",
    "",
    "| 轨道 | 通过 | 失败 | 跳过 | 需人工 | 总计 | commit sha | 主线状态 |",
    "|------|------|------|------|--------|------|------------|----------|",
    `| unit | ${unit.passed ?? "?"} | ${unit.failed ?? "?"} | ${unit.skipped ?? "?"} | ${unit.manualRequired ?? "?"} | ${unit.total ?? "?"} | ${(unit.commitSha || "?").slice(0, 12)} | ${unit.failed === 0 ? "✅ 通过" : "❌ 失败"} |`,
    `| process | ${processReport.passed ?? "?"} | ${processReport.failed ?? "?"} | ${processReport.skipped ?? "?"} | ${processReport.manualRequired ?? "?"} | ${processReport.total ?? "?"} | ${(processReport.commitSha || "?").slice(0, 12)} | ${processReport.failed === 0 ? "✅ 通过" : "❌ 失败"} |`,
    `| managed-runtime | - | - | - | - | - | ${(managedRuntime.manifestVersion || "?").slice(0, 12)} | ${managedRuntimePassed ? "✅ 通过" : "❌ 未通过"} |`,
    `| **合计** | **${totalPassed}** | **${totalFailed}** | **${totalSkipped}** | **${totalManual}** | **${grandTotal}** | ${testedCodeCommitSha.slice(0, 12)} | ${totalFailed === 0 ? "✅ **主线通过**" : "❌ **主线失败**"} |`,
    "",
  ];

  // V17-F2.1：拆分 fixture/unit pass 与 Managed Codex Runtime pass：
  // - unit/process 0 失败 = fixture/unit 层 pass
  // - managed runtime 三层 gate pass = 主线 pass
  if (totalFailed === 0 && auditFailures.length === 0 && managedRuntimePassed) {
    lines.push("**双轨均 0 失败 + Managed Codex Runtime smoke pass → Managed Codex Runtime 主线通过。**");
  } else if (totalFailed === 0 && auditFailures.length === 0 && managedRuntimeSkipped) {
    lines.push("**双轨均 0 失败（fixture/unit 层 pass），但 Managed Codex Runtime 未完整验证。codexUserReady=false。**");
  } else if (totalFailed === 0 && auditFailures.length === 0 && !managedRuntimePassed) {
    lines.push(`**双轨均 0 失败（fixture/unit 层 pass），但 Managed Codex Runtime 未 pass（${managedProtocolStatus || "unknown"}）。codexUserReady=false。**`);
  } else {
    lines.push(`**主线状态: ${totalFailed === 0 ? "通过" : "失败"}（审计失败: ${auditFailures.length}；managed protocol: ${managedProtocolStatus || "?"}）**`);
  }
  lines.push("");

  // 审计模式说明
  lines.push("## 审计模式说明（P2 integrity check）");
  lines.push("");
  lines.push("- **testedCodeCommitSha 语义**：docs-only commit → = parentSha；code commit → = HEAD。unit/process 报告 sha 必须 === testedCodeCommitSha。");
  lines.push("- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。");
  lines.push(`- 本轮 unit 轨道：uncaughtException = ${unit.uncaughtCount || 0}，unhandledRejection = ${unit.unhandledCount || 0}`);
  lines.push(`- 本轮 process 轨道：uncaughtException = ${processReport.uncaughtCount || 0}，unhandledRejection = ${processReport.unhandledCount || 0}`);
  lines.push("- **Managed Codex Runtime gate**：resolver/runtime/protocol/codexUserReady 必须全部通过；external Codex compatibility 字段不影响审计。");
  lines.push("- **平台边界**：当前 production manifest 只声明已验证平台，`crossPlatformReady=false`，不得表述为 all-platform release-ready。");
  lines.push("- **依赖边界**：binary 为 managed/pinned/bundled，不依赖用户安装 CLI/App；auth/config 仍需要可用 user-level Codex/OpenAI credentials 或环境变量。");
  lines.push("- **Release packaging gate**：dist/user-package 默认包含 manifest + installer/downloader，不打包大 binary；必须能从 pinned artifact 安装，记录包大小。");
  lines.push("- **报告过期判定**：若 unit/process 报告的 commit sha 与 testedCodeCommitSha 不一致，说明报告是旧 commit 的结果，必须重新生成。");
  lines.push("");

  // 审计结果
  lines.push("## 审计结果");
  lines.push("");
  if (auditFailures.length === 0) {
    lines.push("✅ **审计通过**：testedCodeCommitSha 一致 + Managed Codex Runtime gate 通过 + uncaught/unhandled 为 0 + 字段解析完整。");
  } else {
    lines.push("❌ **审计失败**：");
    for (const f of auditFailures) {
      lines.push(`- ${f}`);
    }
  }
  lines.push("");

  // skip 策略
  lines.push("## skip 策略与覆盖替代");
  lines.push("");
  lines.push("当前环境 skip 项保留，但每项必须标明原因并有覆盖替代测试。skip 原因分类：");
  lines.push("");
  lines.push("| skip 原因 | 说明 | 覆盖替代 |");
  lines.push("|-----------|------|----------|");
  lines.push("| 环境假失败（非 Windows） | `cmd /c` 类命令在 Linux 沙箱不可用 | process 轨道的 fixture 测试覆盖等价路径 |");
  lines.push("| 模式不匹配 | unit 模式跳过 process/claude/integration 段；process 模式跳过 unit 段 | unit ↔ process 互补：unit 测 mapper/aggregator 纯函数，process 测真实子进程 |");
  lines.push("| Obsidian 未运行 | integration 测试需真实 Obsidian HTTP bridge | unit 轨道的 ACTION_SCHEMAS / validateAction 覆盖 schema 验证 |");
  lines.push("| claude/codex CLI 不可用 | 沙箱未安装 claude/codex 命令 | Preflight fixture + EventMapper fixture 覆盖协议映射；real codex smoke 在 codex 可用环境运行 `npm run smoke:codex-app-server` |");
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("*报告由 `scripts/generate-test-summary.mjs` 自动生成（解析 unit/process/codex-smoke 报告，不手写）*");

  writeFileSync(SUMMARY_REPORT, lines.join("\n") + "\n", "utf8");
  console.log(`summary 报告已写入: ${SUMMARY_REPORT}`);

  // 退出码：审计失败 → 1
  if (auditFailures.length > 0) {
    console.error("\n❌ 审计失败：");
    for (const f of auditFailures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("✅ 审计通过：testedCodeCommitSha 一致 + Managed Codex Runtime gate 通过 + uncaught/unhandled 为 0 + 字段解析完整。");
  process.exit(0);
}

main();
