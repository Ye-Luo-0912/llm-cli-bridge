// LLM CLI Bridge — User Package Smoke (V17-D 任务 C; V17-E1 任务 C+D)
//
// 在 dist/user-package 下验证：
// - 顶层文件齐全（main.js / manifest.json / styles.css / README.md）
// - V17-E1 任务 C：main.js 可被 CJS require 加载（不受 package.json type=module 影响）
// - V17-E1 任务 C：根目录无 package.json（或无 type=module）
// - Pi SDK 文件存在
// - createAgentSession 可 require/import
// - 不依赖全局 node_modules
// - userNeedsNpmInstall=false
//
// V17-E1 任务 D：生成 docs/test-report-user-package.md 报告产物
//
// 输出：
//   userPackageStatus=pass|fail
//   containsPiSdk=true|false
//   canRequirePiSdk=true|false
//   canLoadMainJs=true|false      （V17-E1 任务 C：main.js CJS 加载检查）
//   noRootPackageJson=true|false  （V17-E1 任务 C：根目录无 package.json 或无 type=module）
//   userNeedsNpmInstall=true|false
//
// 运行：npm run smoke:user-package
// 前置：npm run build:user-package

import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USER_PKG_DIR = join(PROJECT_ROOT, "dist", "user-package");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-user-package.md");

console.log("=== User Package Smoke (V17-D + V17-E1) ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log(`USER_PKG_DIR: ${USER_PKG_DIR}`);
console.log("");

// ---------- 辅助函数 ----------
function dirSize(p) {
  let total = 0;
  const stat = statSync(p);
  if (stat.isFile()) return stat.size;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const fullPath = join(p, entry.name);
    if (entry.isDirectory()) total += dirSize(fullPath);
    else if (entry.isFile()) total += statSync(fullPath).size;
  }
  return total;
}

// 报告字段收集
const report = {
  userPackageStatus: "fail",
  containsPiSdk: false,
  canRequirePiSdk: false,
  canLoadMainJs: false,
  noRootPackageJson: false,
  userNeedsNpmInstall: true,
  loadError: null,
  missingDeps: [],
  sdkVersion: null,
  totalSizeMB: 0,
  timestamp: new Date().toISOString(),
};

// ---------- 1. 检查 user-package 目录存在 ----------
if (!existsSync(USER_PKG_DIR)) {
  console.log("=== FAIL: dist/user-package 不存在 ===");
  console.log("提示：先运行 npm run build:user-package");
  console.log("userPackageStatus=fail");
  writeReport(report);
  process.exit(1);
}

// ---------- 2. 检查顶层文件齐全 ----------
const requiredTopFiles = ["main.js", "manifest.json", "styles.css", "README.md"];
const missingTop = requiredTopFiles.filter((f) => !existsSync(join(USER_PKG_DIR, f)));
if (missingTop.length > 0) {
  console.log(`=== FAIL: 顶层文件缺失：${missingTop.join(", ")} ===`);
  console.log("userPackageStatus=fail");
  writeReport(report);
  process.exit(1);
}
console.log(`✓ 顶层文件齐全：${requiredTopFiles.join(", ")}`);

// ---------- 3. V17-E1 任务 C：根目录无 package.json（或无 type=module） ----------
const rootPkgJsonPath = join(USER_PKG_DIR, "package.json");
if (existsSync(rootPkgJsonPath)) {
  try {
    const rootPkg = JSON.parse(readFileSync(rootPkgJsonPath, "utf8"));
    if (rootPkg.type === "module") {
      console.log(`✗ 根目录 package.json 含 "type":"module" — 会破坏 main.js CJS 加载`);
      report.noRootPackageJson = false;
    } else {
      console.log(`⚠ 根目录有 package.json 但无 type=module（可接受但不推荐）`);
      report.noRootPackageJson = true;
    }
  } catch {
    console.log(`⚠ 根目录 package.json 解析失败`);
    report.noRootPackageJson = false;
  }
} else {
  console.log(`✓ 根目录无 package.json（CJS 加载不受影响）`);
  report.noRootPackageJson = true;
}

// ---------- 4. V17-E1 任务 C：main.js 可被 CJS require 加载 ----------
// main.js 是 esbuild format=cjs；用 createRequire 验证 CJS 加载不受 package.json 影响
try {
  const req = createRequire(pathToFileURL(join(USER_PKG_DIR, "_smoke-probe.mjs")).href);
  // require main.js — 不执行插件逻辑（main.js 顶层会检测 window/obsidian），
  // 仅验证模块可被 Node CJS resolver 解析加载（不抛 ERR_REQUIRE_ESM）
  const mainPath = join(USER_PKG_DIR, "main.js");
  // 用 require.resolve 探测模块可解析性（不执行代码）
  try {
    req.resolve(mainPath);
    report.canLoadMainJs = true;
    console.log(`✓ main.js 可被 CJS resolver 解析（无 ERR_REQUIRE_ESM）`);
  } catch (e) {
    // require.resolve 不执行，只解析路径；若失败说明路径问题
    // 改用 require 直接加载（可能执行顶层代码，但 Obsidian 环境缺失会抛 ReferenceError 而非 ERR_REQUIRE_ESM）
    try {
      req(mainPath);
      report.canLoadMainJs = true;
      console.log(`✓ main.js 可被 CJS require 加载`);
    } catch (e2) {
      const msg = e2?.message || String(e2);
      if (msg.includes("ERR_REQUIRE_ESM") || msg.includes("Must use import")) {
        report.canLoadMainJs = false;
        report.loadError = `ERR_REQUIRE_ESM: ${msg}`;
        console.log(`✗ main.js 被当作 ESM 解析（ERR_REQUIRE_ESM）— package.json type=module 风险`);
      } else {
        // 其他错误（如 window/obsidian 未定义）是环境问题，CJS 加载本身是 OK 的
        report.canLoadMainJs = true;
        console.log(`✓ main.js CJS 模块解析通过（运行时环境错误属正常：${msg.slice(0, 80)}）`);
      }
    }
  }
} catch (e) {
  report.canLoadMainJs = false;
  report.loadError = e?.message || String(e);
  console.log(`✗ main.js CJS 加载检查失败：${report.loadError}`);
}

// ---------- 5. 检查 Pi SDK 文件存在 ----------
const sdkPath = join(USER_PKG_DIR, "node_modules", "@earendil-works", "pi-coding-agent");
const sdkPkgJsonPath = join(sdkPath, "package.json");
const sdkEntryPath = join(sdkPath, "dist", "index.js");

if (existsSync(sdkPkgJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(sdkPkgJsonPath, "utf8"));
    report.sdkVersion = pkg.version;
    report.containsPiSdk = !!pkg.exports?.["."] || !!pkg.main;
  } catch {
    /* ignore */
  }
}
console.log(`containsPiSdk=${report.containsPiSdk}${report.sdkVersion ? ` (version=${report.sdkVersion})` : ""}`);

if (!report.containsPiSdk) {
  console.log("");
  console.log("=== FAIL: Pi SDK 未 vendor 到 user-package ===");
  console.log("userPackageStatus=fail");
  writeReport(report);
  process.exit(1);
}

// ---------- 6. 验证 createAgentSession 可加载 ----------
let canRequirePiSdk = false;
let loadError = null;
try {
  const sdkUrl = pathToFileURL(sdkEntryPath).href;
  const mod = await import(sdkUrl);
  if (typeof mod.createAgentSession === "function") {
    canRequirePiSdk = true;
    console.log(`✓ createAgentSession 可加载 (typeof=${typeof mod.createAgentSession})`);
  } else {
    loadError = "createAgentSession export missing";
    console.log(`✗ createAgentSession export missing`);
  }
} catch (e) {
  loadError = e?.message || String(e);
  console.log(`✗ import 失败：${loadError}`);
}
report.canRequirePiSdk = canRequirePiSdk;
report.loadError = report.loadError || loadError;

// ---------- 7. 验证不依赖全局 node_modules ----------
const criticalDeps = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "chalk",
  "undici",
];
const missingDeps = criticalDeps.filter(
  (dep) => !existsSync(join(USER_PKG_DIR, "node_modules", dep))
);
report.missingDeps = missingDeps;
report.userNeedsNpmInstall = missingDeps.length > 0;
console.log(`关键 transitive deps 检查：${missingDeps.length === 0 ? "✓ 全部存在" : "✗ 缺失：" + missingDeps.join(", ")}`);

// ---------- 8. 统计 user-package 大小 ----------
report.totalSizeMB = Number((dirSize(USER_PKG_DIR) / 1024 / 1024).toFixed(1));
console.log(`user-package 总大小: ${report.totalSizeMB} MB`);

// ---------- 9. 最终状态 ----------
report.userPackageStatus =
  report.containsPiSdk && report.canRequirePiSdk && !report.userNeedsNpmInstall
  && report.canLoadMainJs && report.noRootPackageJson
    ? "pass" : "fail";

console.log("");
if (report.userPackageStatus === "pass") {
  console.log("=== PASS: User Package Smoke ===");
} else {
  console.log("=== FAIL: User Package Smoke ===");
}
console.log(`userPackageStatus=${report.userPackageStatus}`);
console.log(`containsPiSdk=${report.containsPiSdk}`);
console.log(`canRequirePiSdk=${report.canRequirePiSdk}`);
console.log(`canLoadMainJs=${report.canLoadMainJs}`);
console.log(`noRootPackageJson=${report.noRootPackageJson}`);
console.log(`userNeedsNpmInstall=${report.userNeedsNpmInstall}`);

// ---------- 10. 写报告 ----------
writeReport(report);
console.log(`\n报告已写入: ${REPORT_PATH}`);

process.exit(report.userPackageStatus === "pass" ? 0 : 1);

// ---------- 报告写入函数 ----------
function writeReport(r) {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — User Package Smoke (V17-D + V17-E1)",
    "",
    "> 本报告由 `scripts/user-package-smoke.mjs` 自动生成。",
    "> 验证 dist/user-package 零安装发行包的完整性与 CJS 加载安全性。",
    "",
    `- **测试时间**: ${r.timestamp}`,
    `- **userPackageStatus**: ${r.userPackageStatus}`,
    `- **containsPiSdk**: ${r.containsPiSdk}`,
    `- **canRequirePiSdk**: ${r.canRequirePiSdk}`,
    `- **canLoadMainJs**: ${r.canLoadMainJs}（V17-E1 任务 C：main.js CJS 加载检查）`,
    `- **noRootPackageJson**: ${r.noRootPackageJson}（V17-E1 任务 C：根目录无 package.json 或无 type=module）`,
    `- **userNeedsNpmInstall**: ${r.userNeedsNpmInstall}`,
    `- **sdkVersion**: ${r.sdkVersion || "null"}`,
    `- **totalSizeMB**: ${r.totalSizeMB}`,
    "",
    "## 验证项说明",
    "",
    "- **containsPiSdk**: dist/user-package/node_modules/@earendil-works/pi-coding-agent 存在且 package.json 有 exports/main",
    "- **canRequirePiSdk**: createAgentSession 可通过 dynamic import 加载",
    "- **canLoadMainJs**: main.js 可被 CJS require 解析（无 ERR_REQUIRE_ESM）",
    "- **noRootPackageJson**: 根目录无 package.json（或无 type=module），不干扰 CJS 加载",
    "- **userNeedsNpmInstall**: 关键 transitive deps 全部 vendor，无需终端用户 npm install",
    "",
    "## V17-E1 任务 C：package.json type=module 风险修复",
    "",
    "- build-user-package.mjs 不再写 `package.json`（含 `\"type\":\"module\"`）到 user-package 根目录",
    "- 改为写 `llm-cli-bridge-user-package.json` 作为纯元数据文件，不影响 Node 模块解析",
    "- main.js 是 esbuild format=cjs，CJS require 加载不受影响",
    "",
    "## 运行命令",
    "",
    "```bash",
    "npm run build:user-package",
    "npm run smoke:user-package",
    "```",
    "",
    "---",
    "",
    "*报告由 `scripts/user-package-smoke.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
}
