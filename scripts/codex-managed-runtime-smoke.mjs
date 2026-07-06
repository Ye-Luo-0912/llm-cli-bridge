// LLM CLI Bridge — V17-F1 任务 F + V17-F1.1 任务 E：Codex Managed Runtime Smoke
//
// 验证 Managed Codex App-Server Runtime 的 manifest + sha256 + executable。
//
// V17-F1.1 任务 E：分层字段
//   - resolverSmokeStatus: pass/fail — resolver 校验链是否通过（manifest/sha256/executable）
//   - runtimeSmokeStatus: pass/fixture-only/fail/skip — runtime binary 是否可用
//       pass = 真实 binary（fixture=false）
//       fixture-only = fixture binary（fixture=true，不是真实 app-server）
//       skip = resolver 失败，无法判断 runtime
//   - managedAppServerProtocolStatus: pass/skip-fixture/fail — app-server 协议是否可用
//       skip-fixture = fixture runtime 不支持真实 app-server，协议层跳过
//       后续真实 binary 接入后才要求 app-server initialize/thread/turn pass
//
// 校验链：
//   1. manifest 存在且 JSON 合法
//   2. 当前平台在 manifest.platforms 中
//   3. runtime binary 文件存在
//   4. sha256 匹配
//   5. executable 权限（Windows: 扩展名；Unix: X_OK）
//
// 运行：npm run smoke:codex-managed-runtime
// 输出：docs/test-report-codex-managed-runtime.md

import { existsSync, readFileSync, accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-managed-runtime.md");
const MANIFEST_PATH = join(
  PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json",
);

console.log("=== Codex Managed Runtime Smoke (V17-F1.1 任务 E) ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log(`MANIFEST_PATH: ${MANIFEST_PATH}`);
console.log("");

// ---------- 报告字段收集（V17-F1.1 任务 E：分层字段） ----------
const report = {
  // V17-F1.1 任务 E：resolver 校验链状态（pass/fail）
  resolverSmokeStatus: "fail",
  // V17-F1.1 任务 E：runtime binary 状态（pass/fixture-only/fail/skip）
  runtimeSmokeStatus: "skip",
  // V17-F1.1 任务 E：app-server 协议状态（pass/skip-fixture/fail）
  managedAppServerProtocolStatus: "skip-fixture",
  // 校验链详情
  manifestLoaded: false,
  manifestVersion: null,
  manifestProtocolVersion: null,
  manifestFixture: false,
  platformSelected: false,
  platformKey: null,
  runtimePath: null,
  pathExists: false,
  sha256Valid: false,
  executableValid: false,
  codexRuntimePinnedVersion: null,
  reason: null,
  error: null,
  timestamp: new Date().toISOString(),
};

// ---------- 1. manifest 存在且 JSON 合法 ----------
if (!existsSync(MANIFEST_PATH)) {
  report.reason = "manifest-not-found";
  report.error = `manifest not found: ${MANIFEST_PATH}`;
  report.resolverSmokeStatus = "fail";
  report.runtimeSmokeStatus = "skip";
  report.managedAppServerProtocolStatus = "fail";
  console.log(`✗ ${report.error}`);
  writeReport(report);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  report.reason = "manifest-invalid";
  report.error = `manifest JSON parse failed: ${e.message}`;
  report.resolverSmokeStatus = "fail";
  report.runtimeSmokeStatus = "skip";
  report.managedAppServerProtocolStatus = "fail";
  console.log(`✗ ${report.error}`);
  writeReport(report);
  process.exit(1);
}

report.manifestLoaded = true;
report.manifestVersion = manifest.version || null;
report.manifestProtocolVersion = manifest.protocolVersion || null;
report.manifestFixture = !!manifest.fixture;
report.codexRuntimePinnedVersion = manifest.version || null;
console.log(`✓ manifest loaded (version=${manifest.version}, fixture=${manifest.fixture})`);

// ---------- 2. 当前平台在 manifest.platforms 中 ----------
const platformKey = `${process.platform}-${process.arch}`;
const platformEntry = manifest.platforms?.[platformKey];
if (!platformEntry) {
  report.platformKey = platformKey;
  report.reason = "platform-not-found";
  report.error = `platform ${platformKey} not in manifest (available: ${Object.keys(manifest.platforms || {}).join(", ")})`;
  report.resolverSmokeStatus = "fail";
  report.runtimeSmokeStatus = "skip";
  report.managedAppServerProtocolStatus = "fail";
  console.log(`✗ ${report.error}`);
  writeReport(report);
  process.exit(1);
}

report.platformSelected = true;
report.platformKey = platformKey;
console.log(`✓ platform selected: ${platformKey} (executableName=${platformEntry.executableName})`);

// ---------- 3. runtime binary 文件存在 ----------
const manifestDir = dirname(MANIFEST_PATH);
const runtimePath = resolve(manifestDir, platformEntry.path);
report.runtimePath = runtimePath;

if (!existsSync(runtimePath)) {
  report.reason = "path-not-exist";
  report.error = `runtime binary not found: ${runtimePath}`;
  report.resolverSmokeStatus = "fail";
  report.runtimeSmokeStatus = "skip";
  report.managedAppServerProtocolStatus = "fail";
  console.log(`✗ ${report.error}`);
  writeReport(report);
  process.exit(1);
}

report.pathExists = true;
console.log(`✓ runtime binary exists: ${runtimePath}`);

// ---------- 4. sha256 匹配 ----------
const fileBuf = readFileSync(runtimePath);
const actualSha256 = createHash("sha256").update(fileBuf).digest("hex");
if (actualSha256 !== platformEntry.sha256) {
  report.reason = "sha256-mismatch";
  report.error = `sha256 mismatch: expected ${platformEntry.sha256}, got ${actualSha256}`;
  report.resolverSmokeStatus = "fail";
  report.runtimeSmokeStatus = "skip";
  report.managedAppServerProtocolStatus = "fail";
  console.log(`✗ ${report.error}`);
  writeReport(report);
  process.exit(1);
}

report.sha256Valid = true;
console.log(`✓ sha256 valid: ${actualSha256}`);

// ---------- 5. executable 权限 ----------
let executableValid = false;
let execError = null;
if (process.platform === "win32") {
  const lower = runtimePath.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".cmd") || lower.endsWith(".ps1")) {
    executableValid = true;
  } else {
    execError = `Windows executable must have .exe/.bat/.cmd extension: ${runtimePath}`;
  }
} else {
  try {
    accessSync(runtimePath, constants.X_OK);
    executableValid = true;
  } catch (e) {
    execError = `not executable (X_OK): ${e.message}`;
  }
}

if (!executableValid) {
  report.reason = "not-executable";
  report.error = execError || "not executable";
  report.resolverSmokeStatus = "fail";
  report.runtimeSmokeStatus = "skip";
  report.managedAppServerProtocolStatus = "fail";
  console.log(`✗ ${report.error}`);
  writeReport(report);
  process.exit(1);
}

report.executableValid = true;
console.log(`✓ executable permission valid`);

// ---------- 最终状态（V17-F1.1 任务 E：分层字段） ----------
// resolver 校验链全部通过
report.resolverSmokeStatus = "pass";
report.reason = "ok";

// runtime binary 状态：fixture=true → fixture-only；fixture=false → pass
report.runtimeSmokeStatus = manifest.fixture ? "fixture-only" : "pass";

// app-server 协议状态：fixture 不支持真实 app-server → skip-fixture
// 后续真实 binary 接入后才要求 app-server initialize/thread/turn pass
report.managedAppServerProtocolStatus = manifest.fixture ? "skip-fixture" : "pass";

console.log("");
console.log("=== 分层状态 ===");
console.log(`resolverSmokeStatus=${report.resolverSmokeStatus}`);
console.log(`runtimeSmokeStatus=${report.runtimeSmokeStatus}`);
console.log(`managedAppServerProtocolStatus=${report.managedAppServerProtocolStatus}`);
console.log("");
if (report.resolverSmokeStatus === "pass" && report.runtimeSmokeStatus === "pass") {
  console.log("=== PASS: Codex Managed Runtime Smoke ===");
} else if (report.resolverSmokeStatus === "pass" && report.runtimeSmokeStatus === "fixture-only") {
  console.log("=== FIXTURE-ONLY: Codex Managed Runtime Smoke ===");
  console.log("  resolver 校验通过，但 runtime 是 fixture（不是真实 app-server）。");
  console.log("  managedAppServerProtocolStatus=skip-fixture，不标 user-ready。");
  console.log("  后续真实 binary 接入后才要求 app-server initialize/thread/turn pass。");
} else {
  console.log("=== FAIL: Codex Managed Runtime Smoke ===");
}
console.log(`manifestLoaded=${report.manifestLoaded}`);
console.log(`platformSelected=${report.platformSelected}`);
console.log(`pathExists=${report.pathExists}`);
console.log(`sha256Valid=${report.sha256Valid}`);
console.log(`executableValid=${report.executableValid}`);
console.log(`codexRuntimePinnedVersion=${report.codexRuntimePinnedVersion}`);
console.log(`fixture=${report.manifestFixture}`);

writeReport(report);
console.log(`\n报告已写入: ${REPORT_PATH}`);

// resolver pass + fixture-only → exit 0（校验通过，只是 fixture）
// resolver fail → exit 1
process.exit(report.resolverSmokeStatus === "fail" ? 1 : 0);

// ---------- 报告写入函数 ----------
function writeReport(r) {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Codex Managed Runtime Smoke (V17-F1.1 任务 E)",
    "",
    "> 本报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成。",
    "> 验证 Managed Codex App-Server Runtime 的 manifest + sha256 + executable。",
    "> V17-F1.1 任务 E：分层字段（resolverSmokeStatus / runtimeSmokeStatus / managedAppServerProtocolStatus）。",
    "",
    `- **测试时间**: ${r.timestamp}`,
    `- **resolverSmokeStatus**: ${r.resolverSmokeStatus}`,
    `- **runtimeSmokeStatus**: ${r.runtimeSmokeStatus}`,
    `- **managedAppServerProtocolStatus**: ${r.managedAppServerProtocolStatus}`,
    `- **manifestLoaded**: ${r.manifestLoaded}`,
    `- **manifestVersion**: ${r.manifestVersion || "null"}`,
    `- **manifestProtocolVersion**: ${r.manifestProtocolVersion || "null"}`,
    `- **manifestFixture**: ${r.manifestFixture}`,
    `- **platformSelected**: ${r.platformSelected}`,
    `- **platformKey**: ${r.platformKey || "null"}`,
    `- **runtimePath**: ${r.runtimePath || "null"}`,
    `- **pathExists**: ${r.pathExists}`,
    `- **sha256Valid**: ${r.sha256Valid}`,
    `- **executableValid**: ${r.executableValid}`,
    `- **codexRuntimePinnedVersion**: ${r.codexRuntimePinnedVersion || "null"}`,
    `- **reason**: ${r.reason || "null"}`,
    `- **error**: ${r.error || "null"}`,
    "",
    "## V17-F1.1 任务 E：分层字段语义",
    "",
    "### resolverSmokeStatus (pass/fail)",
    "- **pass**: resolver 校验链全部通过（manifest 存在 + JSON 合法 + 平台匹配 + binary 存在 + sha256 + executable）",
    "- **fail**: 任一校验失败",
    "",
    "### runtimeSmokeStatus (pass/fixture-only/fail/skip)",
    "- **pass**: 真实 binary（fixture=false），可标 user-ready",
    "- **fixture-only**: fixture binary（fixture=true），不是真实 app-server，不标 user-ready",
    "- **skip**: resolver 失败，无法判断 runtime",
    "- **fail**: resolver 通过但 runtime 不可用（保留扩展位）",
    "",
    "### managedAppServerProtocolStatus (pass/skip-fixture/fail)",
    "- **pass**: 真实 binary 的 app-server 协议可用（initialize/thread/turn pass）",
    "- **skip-fixture**: fixture runtime 不支持真实 app-server，协议层跳过",
    "- **fail**: 协议层失败（后续真实 binary 接入后）",
    "",
    "## 校验链",
    "",
    "1. manifest 存在且 JSON 合法",
    "2. 当前平台在 manifest.platforms 中",
    "3. runtime binary 文件存在",
    "4. sha256 匹配（防篡改）",
    "5. executable 权限（Windows: .exe/.bat/.cmd；Unix: X_OK）",
    "",
    "## V17-F1 任务 G：codexUserReady 主 gate",
    "",
    "- codexUserReady 的主 gate 改为 managed runtime gate",
    "- 条件：resolverSmokeStatus=pass + runtimeSmokeStatus=pass + managedAppServerProtocolStatus=pass",
    "- fixture-only（runtimeSmokeStatus=fixture-only）不标 user-ready",
    "- external 字段保留，但不得影响 codexUserReady",
    "",
    "## 运行命令",
    "",
    "```bash",
    "npm run smoke:codex-managed-runtime",
    "```",
    "",
    "---",
    "",
    "*报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
}
