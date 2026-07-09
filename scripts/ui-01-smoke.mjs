// UI-01 Smoke: 对话与运行过程重做验收
// 验证普通模式不泄露内部名、状态文本双语、metrics 条件显示、运行详情 toggle、Developer Mode 保留 raw
// 独立于 run-tests.mjs，按 spec 要求作为独立 UI 收尾 smoke 的一部分

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-ui-01-smoke.md");
const VIEW_SRC = readFileSync(join(PROJECT_ROOT, "src", "view.ts"), "utf8");
const STYLES_SRC = readFileSync(join(PROJECT_ROOT, "styles.css"), "utf8");

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const results = [];
function add(name, ok, detail = "") {
  results.push({ name, status: ok ? "pass" : "fail", detail });
}

// === 1. 普通模式不泄露 raw tool name ===
// renderTimelineNode: tool name 经 toolDisplayLabel，developerMode 才保留 raw
{
  const hasDevGuard = VIEW_SRC.includes('this.plugin.settings.developerMode ? (node.toolName ?? "unknown") : toolDisplayLabel(node.toolName ?? "", node.toolInput)');
  add("UI-01 renderTimelineNode: 普通模式 tool name 经 toolDisplayLabel，devMode 保留 raw", hasDevGuard, hasDevGuard ? "ok" : "未找到 developerMode 守卫");
}

// renderToolCallCard: 兜底用 toolDisplayLabel 而非 raw card.toolName
{
  const hasSafeFallback = VIEW_SRC.includes("?? toolDisplayLabel(card.toolName, card.toolInput)");
  add("UI-01 renderToolCallCard: 兜底用 toolDisplayLabel 而非 raw toolName", hasSafeFallback, hasSafeFallback ? "ok" : "未找到安全兜底");
}

// renderApprovalCard: 兜底用 toolDisplayLabel
{
  const hasSafeApproval = VIEW_SRC.includes("card.label || card.summary || toolDisplayLabel(card.toolName)");
  add("UI-01 renderApprovalCard: 兜底用 toolDisplayLabel 而非 raw toolName", hasSafeApproval, hasSafeApproval ? "ok" : "未找到安全兜底");
}

// 已解决审批卡也用 toolDisplayLabel
{
  const hasResolvedSafe = VIEW_SRC.includes("card.label || toolDisplayLabel(card.toolName)} →");
  add("UI-01 已解决审批卡: 兜底用 toolDisplayLabel", hasResolvedSafe, hasResolvedSafe ? "ok" : "未找到安全兜底");
}

// === 2. providerId 不泄露 ===
// renderAgentRunDisplayModel: 普通模式用 presentProvider 归一化
{
  const hasProviderNorm = VIEW_SRC.includes("presentProvider(rawProviderLabel).userLabel")
    && VIEW_SRC.includes('const providerLabel = options.developerMode ? rawProviderLabel : presentProvider(rawProviderLabel).userLabel');
  add("UI-01 providerId 归一化: 普通模式用 presentProvider（codex-managed-app-server → Codex runtime）", hasProviderNorm, hasProviderNorm ? "ok" : "未找到 presentProvider 归一化");
}

// === 3. getToolIconAndCategory 委托到 toolPresentation ===
{
  const hasDelegation = VIEW_SRC.includes("return getToolIconCategory(toolName);")
    && !VIEW_SRC.includes('if (n === "bash") return { icon: "$", category: "bash" };');
  add("UI-01 getToolIconAndCategory: 委托到 getToolIconCategory（识别 property_get 等）", hasDelegation, hasDelegation ? "ok" : "仍存在重复图标逻辑");
}

// === 4. 状态文本双语映射 ===
{
  const hasLocalize = VIEW_SRC.includes("private localizeRunStatus(text: string): string")
    && VIEW_SRC.includes('"Answered": "已完成"')
    && VIEW_SRC.includes('"Running": "正在处理"')
    && VIEW_SRC.includes('"Thinking": "正在处理"')
    && VIEW_SRC.includes('"Needs approval": "需要你的确认"')
    && VIEW_SRC.includes('"Needs input": "需要输入"')
    && VIEW_SRC.includes('"Failed": "失败"')
    && VIEW_SRC.includes('"Stopped": "已停止"');
  add("UI-01 localizeRunStatus: 双语状态映射（Answered→已完成, Thinking→正在处理, Needs approval→需要你的确认）", hasLocalize, hasLocalize ? "ok" : "映射不完整");
}

// renderRunStatusText 调用 localizeRunStatus
{
  const hasRenderLocalize = VIEW_SRC.includes("text: this.localizeRunStatus(text)");
  add("UI-01 renderRunStatusText: 状态文本经 localizeRunStatus 本地化", hasRenderLocalize, hasRenderLocalize ? "ok" : "未本地化");
}

// Developer Mode 保留原始英文
{
  const hasDevPreserve = VIEW_SRC.includes("if (this.plugin.settings.developerMode) return text;");
  add("UI-01 Developer Mode: 状态文本保留原始英文", hasDevPreserve, hasDevPreserve ? "ok" : "未找到 devMode 守卫");
}

// === 5. Codex run header 状态本地化 ===
{
  const hasCodexStatusLocalize = VIEW_SRC.includes("text: this.localizeRunStatus(run.runHeader.status)");
  add("UI-01 Codex run header: 状态文本经 localizeRunStatus", hasCodexStatusLocalize, hasCodexStatusLocalize ? "ok" : "未本地化");
}

// === 6. headerText 本地化 ===
{
  const hasHeaderLocalize = VIEW_SRC.includes('rawHeaderText.split(" · ").map((part) => this.localizeRunStatus(part)).join(" · ")');
  add("UI-01 headerText: 状态部分本地化（Answered · 12s → 已完成 · 12s）", hasHeaderLocalize, hasHeaderLocalize ? "ok" : "未本地化");
}

// === 7. metrics 条件显示 ===
{
  const hasConditionalMetrics = VIEW_SRC.includes("const hasMeaningfulMetrics = run.runHeader.fileChangeCount > 0")
    && VIEW_SRC.includes("if (hasMeaningfulMetrics || developerMode)");
  add("UI-01 metrics 条件显示: 简单问答不显示 metrics（无文件改动/命令/审批时隐藏）", hasConditionalMetrics, hasConditionalMetrics ? "ok" : "未找到条件守卫");
}

// === 8. "运行详情" toggle 标签 ===
{
  const hasDetailsLabel = VIEW_SRC.includes('const detailsLabel = loc === "zh" ? "运行详情" : "Run details";')
    && VIEW_SRC.includes("▶ ${detailsLabel}")
    && VIEW_SRC.includes("▼ ${detailsLabel}");
  add("UI-01 toggle 标签: '运行详情'/'Run details'（双语）", hasDetailsLabel, hasDetailsLabel ? "ok" : "未找到双语 toggle 标签");
}

// === 9. Process 标题双语 ===
{
  const hasProcessBilingual = VIEW_SRC.includes('const processTitleLabel = codexLoc === "zh" ? "运行详情" : "Run details";')
    && VIEW_SRC.includes("text: processTitleLabel");
  add("UI-01 Process 标题: '运行详情'/'Run details'（双语，替换 'Process'）", hasProcessBilingual, hasProcessBilingual ? "ok" : "未找到双语 Process 标题");
}

// === 10. "Thinking" 直接渲染全部经过本地化 ===
{
  // 不应存在未经 localizeRunStatus 的 "Thinking" 直接渲染
  const rawThinkingCount = (VIEW_SRC.match(/text:\s*"Thinking"/g) || []).length;
  const localizedThinkingCount = (VIEW_SRC.match(/text:\s*this\.localizeRunStatus\("Thinking"\)/g) || []).length;
  add("UI-01 Thinking 本地化: 所有 text:'Thinking' 均经 localizeRunStatus", rawThinkingCount === 0 && localizedThinkingCount > 0, `raw=${rawThinkingCount} localized=${localizedThinkingCount}`);
}

// === 11. 确认不再有 "Process" 硬编码（已替换为 processTitleLabel）===
{
  const hasRawProcess = VIEW_SRC.includes('text: "Process"');
  add("UI-01 无 'Process' 硬编码: 已替换为双语 processTitleLabel", !hasRawProcess, hasRawProcess ? "仍存在 text:'Process' 硬编码" : "ok");
}

// === 12. presentProvider/resolveUiLocale 导入存在 ===
{
  const hasImport = VIEW_SRC.includes('import { presentProvider, resolveUiLocale, type Locale } from "./runtime/core/toolPresentation";');
  add("UI-01 导入: presentProvider + resolveUiLocale 从 toolPresentation 导入", hasImport, hasImport ? "ok" : "未找到导入");
}

// === 13. CSS 样式存在性回归 ===
{
  const hasProcessBody = STYLES_SRC.includes(".llm-bridge-codex-process-body[hidden]")
    && STYLES_SRC.includes(".llm-bridge-codex-run-header")
    && STYLES_SRC.includes(".llm-bridge-codex-run-metrics")
    && STYLES_SRC.includes(".llm-bridge-run-status-text");
  add("UI-01 CSS 回归: process-body/run-header/run-metrics/run-status-text 样式存在", hasProcessBody, hasProcessBody ? "ok" : "样式缺失");
}

// === 14. 折叠交互保留运行详情标签 ===
{
  const hasToggleUpdate = VIEW_SRC.includes('toggle.textContent = `▼ ${detailsLabel}`')
    && VIEW_SRC.includes('toggle.textContent = `▶ ${detailsLabel}`');
  add("UI-01 折叠交互: toggle 文本更新保留 '运行详情' 标签", hasToggleUpdate, hasToggleUpdate ? "ok" : "toggle 更新未保留标签");
}

// === 生成报告 ===
const failed = results.filter((r) => r.status !== "pass");
const lines = [
  "# UI-01 Smoke: 对话与运行过程重做验收",
  "",
  "- **generatedAt**: " + new Date().toISOString(),
  "- **testedCodeCommitSha**: " + gitSha(),
  "- **ui01SmokeStatus**: " + (failed.length === 0 ? "pass" : "fail"),
  "- **totalChecks**: " + results.length,
  "",
  "| Check | Status | Detail |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
  "",
];

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`\n=== UI-01 Smoke: 对话与运行过程重做验收 ===`);
for (const r of results) {
  console.log(`${r.status === "pass" ? "✅" : "❌"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
console.log(`\n报告已写入: ${OUT}`);
console.log(`\n=== 结果: ${results.length - failed.length} passed, ${failed.length} failed ===`);

if (failed.length > 0) process.exit(1);
