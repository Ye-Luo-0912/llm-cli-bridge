// LLM CLI Bridge — V17-F1 任务 F：Codex Managed Runtime Smoke
//
// 验证 Managed Codex App-Server Runtime 的 manifest + sha256 + executable。
//
// 校验链：
//   1. manifest 存在且 JSON 合法
//   2. 当前平台在 manifest.platforms 中
//   3. runtime binary 文件存在
//   4. sha256 匹配
//   5. executable 权限（Windows: 扩展名；Unix: X_OK）
//
// runtimeSmokeStatus:
//   - pass: 所有校验通过 + fixture=false（真实 binary）
//   - fixture-only: 所有校验通过 + fixture=true（fixture，不是真实 app-server，不标 user-ready）
//   - fail: 任一校验失败
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

console.log("=== Codex Managed Runtime Smoke (V17-F1 任务 F) ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log(`MANIFEST_PATH: ${MANIFEST_PATH}`);
console.log("");

// ---------- 报告字段收集 ----------
const report = {
  runtimeSmokeStatus: "fail",
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
  console.log(`✗ ${report.error}`);
  writeReport(report);
  process.exit(1);
}

report.executableValid = true;
console.log(`✓ executable permission valid`);

// ---------- 最终状态 ----------
// fixture=true → fixture-only（不标 user-ready）
// fixture=false → pass（真实 binary）
report.runtimeSmokeStatus = manifest.fixture ? "fixture-only" : "pass";
report.reason = "ok";

console.log("");
if (report.runtimeSmokeStatus === "pass") {
  console.log("=== PASS: Codex Managed Runtime Smoke ===");
} else {
  console.log("=== FIXTURE-ONLY: Codex Managed Runtime Smoke ===");
  console.log("  fixture runtime 不支持真实 app-server；不标 user-ready。");
  console.log("  后续真实 binary 接入后才要求 app-server initialize/thread/turn pass。");
}
console.log(`runtimeSmokeStatus=${report.runtimeSmokeStatus}`);
console.log(`manifestLoaded=${report.manifestLoaded}`);
console.log(`platformSelected=${report.platformSelected}`);
console.log(`pathExists=${report.pathExists}`);
console.log(`sha256Valid=${report.sha256Valid}`);
console.log(`executableValid=${report.executableValid}`);
console.log(`codexRuntimePinnedVersion=${report.codexRuntimePinnedVersion}`);
console.log(`fixture=${report.manifestFixture}`);

writeReport(report);
console.log(`\n报告已写入: ${REPORT_PATH}`);

// fixture-only 退出码 0（校验通过，只是 fixture），fail 退出码 1
process.exit(report.runtimeSmokeStatus === "fail" ? 1 : 0);

// ---------- 报告写入函数 ----------
function writeReport(r) {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Codex Managed Runtime Smoke (V17-F1 任务 F)",
    "",
    "> 本报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成。",
    "> 验证 Managed Codex App-Server Runtime 的 manifest + sha256 + executable。",
    "",
    `- **测试时间**: ${r.timestamp}`,
    `- **runtimeSmokeStatus**: ${r.runtimeSmokeStatus}`,
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
    "## runtimeSmokeStatus 语义",
    "",
    "- **pass**: 所有校验通过 + fixture=false（真实 binary，可标 user-ready）",
    "- **fixture-only**: 所有校验通过 + fixture=true（fixture，不是真实 app-server，不标 user-ready）",
    "- **fail**: 任一校验失败",
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
    "- codexUserReady 的主 gate 改为 managed runtime gate（runtimeSmokeStatus=pass）",
    "- fixture-only 不标 user-ready（fixture runtime 不支持真实 app-server）",
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
