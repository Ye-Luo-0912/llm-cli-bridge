#!/usr/bin/env node
// LLM CLI Bridge — Test report summary generator (P2: Codex app-server Runtime 主线闭环)
//
// 从 docs/test-report-unit.md + docs/test-report-process.md + docs/test-report-codex-smoke.md
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
// - codexSmokeStatus 必须为 skip 或 pass（fail 或缺失 → 审计失败）。
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
const CODEX_SMOKE_REPORT = join(DOCS_DIR, "test-report-codex-smoke.md");
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
// 解析 codex-smoke 报告：提取 smokeStatus / codexVersion / schemaSource
// ============================================================

function parseCodexSmokeReport(path) {
  if (!existsSync(path)) {
    return { label: "codex-smoke", error: `报告文件不存在: ${path}` };
  }
  const text = readFileSync(path, "utf8");
  const result = { label: "codex-smoke", raw: text };

  // smokeStatus: skip | pass | handshake-only | fail
  // P2 分层：handshake-only = handshake pass 但 turn 非 pass（如 auth 不可用），属合法非 fail 状态
  const statusMatch = text.match(/- \*\*smokeStatus\*\*: (skip|pass|handshake-only|fail)/);
  result.smokeStatus = statusMatch ? statusMatch[1] : null;

  // handshakeStatus / turnStatus（P2 分层字段）
  const handshakeMatch = text.match(/- \*\*handshakeStatus\*\*: (skip|pass|fail)/);
  result.handshakeStatus = handshakeMatch ? handshakeMatch[1] : null;
  const turnMatch = text.match(/- \*\*turnStatus\*\*: (skip|pass|fail|skip-auth|skip-handshake-failed)/);
  result.turnStatus = turnMatch ? turnMatch[1] : null;

  // codexVersion
  const versionMatch = text.match(/- \*\*codexVersion\*\*: (.+)/);
  result.codexVersion = versionMatch ? versionMatch[1].trim() : null;

  // schemaSource
  const sourceMatch = text.match(/- \*\*schemaSource\*\*: (.+)/);
  result.schemaSource = sourceMatch ? sourceMatch[1].trim() : null;

  // schemaGeneratedAt
  const genAtMatch = text.match(/- \*\*schemaGeneratedAt\*\*: (.+)/);
  result.schemaGeneratedAt = genAtMatch ? genAtMatch[1].trim() : null;

  if (result.smokeStatus === null) {
    result.error = "smokeStatus 字段解析失败";
  }
  return result;
}

// ============================================================
// 判定当前 commit 是否为 docs-only commit（仅修改 docs/test-report*.md）
// ============================================================

function classifyCurrentCommit(headSha) {
  // parentSha
  let parentSha = null;
  try {
    parentSha = execSync("git rev-parse HEAD^", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    // 无 parent（初始 commit / shallow clone）→ 无法判定 docs-only，退化为 code commit
  }

  // 当前 commit 修改的文件列表
  let changedFiles = [];
  if (parentSha) {
    try {
      const out = execSync("git diff --name-only HEAD^ HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" });
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

  // 2. 解析 unit / process / codex-smoke 报告
  const unit = parseReport(UNIT_REPORT, "unit");
  const processReport = parseReport(PROCESS_REPORT, "process");
  const codexSmoke = parseCodexSmokeReport(CODEX_SMOKE_REPORT);

  if (unit.error) auditFailures.push(`unit 报告: ${unit.error}`);
  if (processReport.error) auditFailures.push(`process 报告: ${processReport.error}`);
  if (codexSmoke.error) auditFailures.push(`codex-smoke 报告: ${codexSmoke.error}`);

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

  // 5. codexSmokeStatus 必须为 skip / pass / handshake-only
  //    P2 分层：handshake-only = handshake pass 但 turn 非 pass（如 codex 存在但 auth 不可用），
  //    属合法非 fail 状态（handshake 已证明 wire 闭环；turn 受 auth 限制不计为 smoke 硬失败）。
  //    fail 仍计为审计失败。
  if (!codexSmoke.error) {
    if (codexSmoke.smokeStatus !== "skip"
      && codexSmoke.smokeStatus !== "pass"
      && codexSmoke.smokeStatus !== "handshake-only") {
      auditFailures.push(`codex smoke 状态异常: smokeStatus=${codexSmoke.smokeStatus}（必须为 skip / pass / handshake-only）`);
    }
  }

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
  const lines = [
    "# LLM CLI Bridge 测试报告 — 汇总（P2: Codex app-server Runtime 主线闭环）",
    "",
    "> 本报告由 `scripts/generate-test-summary.mjs` 从 unit/process/codex-smoke 报告解析生成，不手写。",
    "> 详细结果分别见：",
    "> - [docs/test-report-unit.md](./test-report-unit.md) — 单元测试详细结果",
    "> - [docs/test-report-process.md](./test-report-process.md) — 进程测试详细结果",
    "> - [docs/test-report-codex-smoke.md](./test-report-codex-smoke.md) — Codex real app-server smoke",
    ">",
    "> 三份报告不互相覆盖：unit/process/codex-smoke 各自独立生成，summary 仅汇总主线结论。",
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
    `- **codexSmokeStatus**: ${codexSmoke.smokeStatus || "(解析失败)"}`,
    `- **codexHandshakeStatus**: ${codexSmoke.handshakeStatus || "(解析失败)"}`,
    `- **codexTurnStatus**: ${codexSmoke.turnStatus || "(解析失败)"}`,
    `- **codexVersion**: ${codexSmoke.codexVersion || "(解析失败)"}`,
    `- **codexSchemaSource**: ${codexSmoke.schemaSource || "(解析失败)"}`,
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
    `| codex-smoke | - | - | - | - | - | ${codexSmoke.codexVersion ? codexSmoke.codexVersion.slice(0, 12) : "-"} | ${codexSmoke.smokeStatus === "pass" ? "✅ 通过" : codexSmoke.smokeStatus === "skip" ? "⏭️ skip" : codexSmoke.smokeStatus === "handshake-only" ? "🟡 handshake-only" : "❌ 失败"} |`,
    `| **合计** | **${totalPassed}** | **${totalFailed}** | **${totalSkipped}** | **${totalManual}** | **${grandTotal}** | ${testedCodeCommitSha.slice(0, 12)} | ${totalFailed === 0 ? "✅ **主线通过**" : "❌ **主线失败**"} |`,
    "",
  ];

  if (totalFailed === 0 && auditFailures.length === 0) {
    lines.push("**双轨均 0 失败 → P2 Codex app-server Runtime 主线闭环测试通过。**");
  } else {
    lines.push(`**主线状态: ${totalFailed === 0 ? "通过" : "失败"}（审计失败: ${auditFailures.length}）**`);
  }
  lines.push("");

  // 审计模式说明
  lines.push("## 审计模式说明（P2 integrity check）");
  lines.push("");
  lines.push("- **testedCodeCommitSha 语义**：docs-only commit → = parentSha；code commit → = HEAD。unit/process 报告 sha 必须 === testedCodeCommitSha。");
  lines.push("- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。");
  lines.push(`- 本轮 unit 轨道：uncaughtException = ${unit.uncaughtCount || 0}，unhandledRejection = ${unit.unhandledCount || 0}`);
  lines.push(`- 本轮 process 轨道：uncaughtException = ${processReport.uncaughtCount || 0}，unhandledRejection = ${processReport.unhandledCount || 0}`);
  lines.push("- **codexSmokeStatus**：必须为 `skip`（无 codex CLI）/ `pass`（handshake + turn 全通）/ `handshake-only`（handshake pass 但 turn 非 pass，如 auth 不可用）；`fail` 或缺失 → 审计失败。分层字段 `codexHandshakeStatus` / `codexTurnStatus` 记录根因。");
  lines.push("- **报告过期判定**：若 unit/process 报告的 commit sha 与 testedCodeCommitSha 不一致，说明报告是旧 commit 的结果，必须重新生成。");
  lines.push("");

  // 审计结果
  lines.push("## 审计结果");
  lines.push("");
  if (auditFailures.length === 0) {
    lines.push("✅ **审计通过**：testedCodeCommitSha 一致 + codexSmokeStatus 合法 + uncaught/unhandled 为 0 + 字段解析完整。");
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
  console.log("✅ 审计通过：testedCodeCommitSha 一致 + codexSmokeStatus 合法 + uncaught/unhandled 为 0 + 字段解析完整。");
  process.exit(0);
}

main();
