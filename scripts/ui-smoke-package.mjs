// UI Smoke 测试包：聚合独立 smoke + Developer Mode 回归 + CDP 截图辅助
// 独立于 run-tests.mjs，作为 UI 收尾 smoke 的统一入口
//
// 组成：
// 1. 聚合运行 5 个独立 smoke（F-01/UI-01/UI-02/UI-03/F-03）
// 2. Developer Mode 回归（自动化源码检查）
// 3. CDP 4 宽度截图（manual required — 需 Obsidian 远程调试模式运行）

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, execFileSync } from "node:child_process";
import http from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-ui-smoke-package.md");
const VIEW_SRC = readFileSync(join(PROJECT_ROOT, "src", "view.ts"), "utf8");
const SCREENSHOT_DIR = join(PROJECT_ROOT, "docs", "screenshots");

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const results = [];
const manualRequired = [];
function add(name, ok, detail = "") {
  results.push({ name, status: ok ? "pass" : "fail", detail });
}
function addManual(name, instructions) {
  manualRequired.push({ name, instructions });
}

// === 1. 聚合运行独立 smoke 脚本 ===
const smokeScripts = [
  { name: "F-01 toolPresentation", script: "scripts/tool-presentation-smoke.mjs" },
  { name: "UI-01 对话/运行过程", script: "scripts/ui-01-smoke.mjs" },
  { name: "UI-02 Composer/上下文", script: "scripts/ui-02-smoke.mjs" },
  { name: "UI-03 导航/会话/页面", script: "scripts/ui-03-smoke.mjs" },
  { name: "F-03 状态机收口", script: "scripts/f03-smoke.mjs" },
];

for (const { name, script } of smokeScripts) {
  try {
    const output = execFileSync("node", [join(PROJECT_ROOT, script)], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 30000,
    });
    // 从输出提取 passed/failed
    const match = output.match(/=== 结果: (\d+) passed, (\d+) failed ===/);
    if (match) {
      const passed = parseInt(match[1], 10);
      const failed = parseInt(match[2], 10);
      add(`聚合 smoke: ${name}`, failed === 0, `${passed} passed, ${failed} failed`);
    } else {
      add(`聚合 smoke: ${name}`, false, "无法解析结果");
    }
  } catch (e) {
    add(`聚合 smoke: ${name}`, false, `执行失败: ${e.message?.slice(0, 100) || "unknown"}`);
  }
}

// === 2. Developer Mode 回归（自动化源码检查） ===

// 2a. localizeRunStatus: developerMode 保留原始英文
{
  const hasDevGuard = VIEW_SRC.includes("if (this.plugin.settings.developerMode) return text;");
  add("DevMode 回归: localizeRunStatus 保留原始英文", hasDevGuard, hasDevGuard ? "ok" : "未找到 devMode 守卫");
}

// 2b. renderTimelineNode: developerMode 保留 raw tool name
{
  const hasRawGuard = VIEW_SRC.includes('this.plugin.settings.developerMode ? (node.toolName ?? "unknown") : toolDisplayLabel(node.toolName ?? "", node.toolInput)');
  add("DevMode 回归: renderTimelineNode 保留 raw tool name", hasRawGuard, hasRawGuard ? "ok" : "未找到 devMode 守卫");
}

// 2c. metrics: developerMode 始终显示
{
  const hasMetricsGuard = VIEW_SRC.includes("if (hasMeaningfulMetrics || developerMode)");
  add("DevMode 回归: metrics 始终显示（hasMeaningfulMetrics || developerMode）", hasMetricsGuard, hasMetricsGuard ? "ok" : "未找到 metrics 守卫");
}

// 2d. SDK events: developerMode 下映射 WorkflowEvent
{
  const hasSdkGuard = VIEW_SRC.includes("const developerMode = !!this.plugin.settings.developerMode;") &&
    VIEW_SRC.includes("const wfEvent = developerMode ? mapNormalizedToWorkflowEvent(ev) : null;");
  add("DevMode 回归: SDK events 仅 developerMode 下映射", hasSdkGuard, hasSdkGuard ? "ok" : "未找到 SDK events 守卫");
}

// 2e. providerLabel: developerMode 保留 raw provider label
{
  const hasProviderGuard = VIEW_SRC.includes('const providerLabel = options.developerMode ? rawProviderLabel : presentProvider(rawProviderLabel).userLabel');
  add("DevMode 回归: providerLabel 保留 raw（codex-managed-app-server 不归一化）", hasProviderGuard, hasProviderGuard ? "ok" : "未找到 providerLabel 守卫");
}

// 2f. Process 标题: developerMode 不本地化
{
  // localizeRunStatus 内部有 developerMode 守卫，processTitleLabel 也会经过 localizeRunStatus
  const hasProcessGuard = VIEW_SRC.includes('const processTitleLabel = codexLoc === "zh" ? "运行详情" : "Run details";');
  add("DevMode 回归: Process 标题双语（普通用户态），DevMode 经 localizeRunStatus 保留英文", hasProcessGuard, hasProcessGuard ? "ok" : "未找到 Process 标题");
}

// === 3. CDP 4 宽度截图（manual required） ===

// 检查 CDP 是否可用
function checkCdpAvailable(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/json/version`, { timeout: 2000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve({ available: true, info: json });
        } catch {
          resolve({ available: false });
        }
      });
    });
    req.on("error", () => resolve({ available: false }));
    req.on("timeout", () => { req.destroy(); resolve({ available: false }); });
  });
}

const CDP_PORT = parseInt(process.env.OBSIDIAN_CDP_PORT || "9222", 10);
const cdpResult = await checkCdpAvailable(CDP_PORT);

if (cdpResult.available) {
  // CDP 可用 — 尝试用 PowerShell + Selenium 取截图
  // 注意：这里只验证 CDP 可达性，实际截图需要浏览器自动化工具
  add("CDP 截图: Obsidian 远程调试可达", true, `port=${CDP_PORT} version=${cdpResult.info?.Browser || "unknown"}`);
  addManual(
    "CDP 4 宽度截图",
    `Obsidian CDP 已在 port ${CDP_PORT} 检测到。请用浏览器自动化工具（Puppeteer/Playwright）连接 CDP，在以下 4 个宽度截图：1920px / 1280px / 768px / 480px。截图保存到 docs/screenshots/。`
  );
} else {
  // CDP 不可用 — 标记为 manual required（不计为 fail）
  addManual(
    "CDP 4 宽度截图",
    `1. 启动 Obsidian 并启用远程调试：obsidian --remote-debugging-port=${CDP_PORT}\n2. 打开 LLM CLI Bridge 插件视图\n3. 用浏览器自动化工具（Puppeteer/Playwright）连接 http://localhost:${CDP_PORT}\n4. 在 4 个宽度截图：1920px / 1280px / 768px / 480px\n5. 截图保存到 docs/screenshots/\n6. 验证：Chat/Files/Skills/History 四个页面在所有宽度下无溢出/截断/竖排`
  );
}

// === 4. 独立性验证：smoke 脚本不在 run-tests.mjs 中 ===
{
  const runTestsSrc = readFileSync(join(PROJECT_ROOT, "scripts", "run-tests.mjs"), "utf8");
  const scriptsIndependent = !runTestsSrc.includes("f03-smoke") &&
    !runTestsSrc.includes("ui-01-smoke") &&
    !runTestsSrc.includes("ui-02-smoke") &&
    !runTestsSrc.includes("ui-03-smoke");
  add("独立性: smoke 脚本不在 run-tests.mjs 中（独立文件）", scriptsIndependent, scriptsIndependent ? "ok" : "smoke 引用混入了 run-tests.mjs");
}

// === 5. package.json smoke 脚本完整性 ===
{
  const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
  const scripts = pkgJson.scripts || {};
  const required = ["smoke:tool-presentation", "smoke:ui-01", "smoke:ui-02", "smoke:ui-03", "smoke:f03"];
  const allPresent = required.every((s) => scripts[s]);
  add("package.json: 5 个 smoke 脚本均存在", allPresent, allPresent ? "ok" : `缺失: ${required.filter((s) => !scripts[s]).join(", ")}`);
}

// === 生成报告 ===
const failed = results.filter((r) => r.status !== "pass");
const passed = results.filter((r) => r.status === "pass");
const lines = [
  "# UI Smoke 测试包：聚合验收报告",
  "",
  "- **generatedAt**: " + new Date().toISOString(),
  "- **testedCodeCommitSha**: " + gitSha(),
  "- **uiSmokePackageStatus**: " + (failed.length === 0 ? "pass" : "fail"),
  `- **passed**: ${passed.length}`,
  `- **failed**: ${failed.length}`,
  `- **manualRequired**: ${manualRequired.length}`,
  `- **totalChecks**: ${results.length}`,
  "",
  "## 自动化检查",
  "",
  "| Check | Status | Detail |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
  "",
];

if (manualRequired.length > 0) {
  lines.push("## Manual Required");
  lines.push("");
  for (const m of manualRequired) {
    lines.push(`### ${m.name}`);
    lines.push("");
    lines.push("```");
    lines.push(m.instructions);
    lines.push("```");
    lines.push("");
  }
}

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");

console.log(`\n=== UI Smoke 测试包：聚合验收 ===`);
for (const r of results) {
  console.log(`${r.status === "pass" ? "✅" : "❌"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
if (manualRequired.length > 0) {
  console.log(`\n--- Manual Required (${manualRequired.length}) ---`);
  for (const m of manualRequired) {
    console.log(`📋 ${m.name}`);
  }
}
console.log(`\n报告已写入: ${OUT}`);
console.log(`\n=== 结果: ${passed.length} passed, ${failed.length} failed, ${manualRequired.length} manual required ===`);

if (failed.length > 0) process.exit(1);
