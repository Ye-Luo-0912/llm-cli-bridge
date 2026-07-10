// UI-03 Smoke: 导航、会话与页面层级验收
// 验证左 rail active label、键盘焦点、History 首条+最后答复分行、Skills 分组、恢复提示
// 独立于 run-tests.mjs，按 spec 要求作为独立 UI 收尾 smoke 的一部分

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-ui-03-smoke.md");
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

// === 1. 左 rail nav-label 存在 ===
{
  const hasLabels = VIEW_SRC.includes('chatTab.createEl("span", { cls: "llm-bridge-nav-label", text: "Chat" })')
    && VIEW_SRC.includes('filesTab.createEl("span", { cls: "llm-bridge-nav-label", text: "Files" })')
    && VIEW_SRC.includes('skillsTab.createEl("span", { cls: "llm-bridge-nav-label", text: "Skills" })')
    && VIEW_SRC.includes('historyTab.createEl("span", { cls: "llm-bridge-nav-label", text: "History" })');
  add("UI-03 左 rail nav-label: 4 个导航项均有 label span", hasLabels, hasLabels ? "ok" : "nav-label 不完整");
}

// === 2. CSS: nav-label 默认隐藏，active 项显示 ===
{
  const hasLabelCSS = STYLES_SRC.includes(".llm-bridge-nav-label {")
    && STYLES_SRC.includes("display: none;")
    && STYLES_SRC.includes(".llm-bridge-nav-item.is-active .llm-bridge-nav-label {")
    && STYLES_SRC.includes("display: inline;");
  add("UI-03 CSS nav-label: 默认 display:none，is-active 时 display:inline", hasLabelCSS, hasLabelCSS ? "ok" : "nav-label CSS 不完整");
}

// === 3. CSS: nav-item 键盘焦点 ===
{
  const hasFocusCSS = STYLES_SRC.includes(".llm-bridge-nav-item:focus-visible {")
    && STYLES_SRC.includes("outline: 2px solid var(--interactive-accent);");
  add("UI-03 CSS nav-item 键盘焦点: focus-visible outline", hasFocusCSS, hasFocusCSS ? "ok" : "未找到 focus-visible 样式");
}

// === 4. History 分开显示首条请求 + 最后答复 ===
{
  const hasSplitDisplay = VIEW_SRC.includes("// UI-03: 分开显示首条请求 + 最后答复（而非单一 preview）")
    && VIEW_SRC.includes("llm-bridge-history-first-user")
    && VIEW_SRC.includes("llm-bridge-history-last-reply")
    && VIEW_SRC.includes('text: `首条：${firstUser}`')
    && VIEW_SRC.includes('text: `答复：${lastReply}`');
  add("UI-03 History 首条+最后答复: 分开显示而非单一 preview", hasSplitDisplay, hasSplitDisplay ? "ok" : "分行显示不完整");
}

// === 5. History 不再使用 sessionSummaryText 单一 preview ===
{
  const noSinglePreview = !VIEW_SRC.includes("const preview = this.sessionSummaryText(item);");
  add("UI-03 History 无单一 preview: 移除 sessionSummaryText 调用", noSinglePreview, noSinglePreview ? "ok" : "仍存在单一 preview 变量");
}

// === 6. CSS: History 首条/最后答复样式 ===
{
  const hasHistoryCSS = STYLES_SRC.includes(".llm-bridge-history-first-user,")
    && STYLES_SRC.includes(".llm-bridge-history-last-reply {")
    && STYLES_SRC.includes("display: block;")
    && STYLES_SRC.includes("text-overflow: ellipsis;");
  add("UI-03 CSS History 分行: block + ellipsis 样式", hasHistoryCSS, hasHistoryCSS ? "ok" : "History 分行 CSS 不完整");
}

// === 7. Skills 页区分"本轮已启用"和"可用但未启用" ===
{
  const hasSkillsSplit = VIEW_SRC.includes('// UI-03: Skills 页区分"本轮已启用能力"和"可用但未启用能力"')
    && VIEW_SRC.includes("const enabledSkills = sorted.filter((s) => s.enabled);")
    && VIEW_SRC.includes("const disabledSkills = sorted.filter((s) => !s.enabled);")
    && VIEW_SRC.includes("is-enabled-group")
    && VIEW_SRC.includes("is-disabled-group");
  add("UI-03 Skills 分组: 本轮已启用 vs 可用但未启用", hasSkillsSplit, hasSkillsSplit ? "ok" : "Skills 分组不完整");
}

// === 8. Skills 分组标签文案 ===
{
  const hasLabels = VIEW_SRC.includes('text: `本轮已启用（${enabledSkills.length}）`')
    && VIEW_SRC.includes('text: `可用但未启用（${disabledSkills.length}）`');
  add("UI-03 Skills 分组标签: '本轮已启用（N）' + '可用但未启用（N）'", hasLabels, hasLabels ? "ok" : "分组标签文案不完整");
}

// === 9. renderAgentSkillItem 抽取为独立方法 ===
{
  const hasMethod = VIEW_SRC.includes("private renderAgentSkillItem(parent: HTMLElement, skill: AgentSkillRecord): void");
  add("UI-03 renderAgentSkillItem: 抽取为独立方法（AgentSkillRecord 类型）", hasMethod, hasMethod ? "ok" : "方法不存在或类型不匹配");
}

// === 10. CSS: Skills 分组标签样式 ===
{
  const hasSkillsCSS = STYLES_SRC.includes(".llm-bridge-agent-skills-group-label {")
    && STYLES_SRC.includes("text-transform: uppercase;")
    && STYLES_SRC.includes(".llm-bridge-agent-skills-group.is-enabled-group .llm-bridge-agent-skills-group-label {")
    && STYLES_SRC.includes("color: var(--interactive-accent);");
  add("UI-03 CSS Skills 分组: uppercase + accent 色标签", hasSkillsCSS, hasSkillsCSS ? "ok" : "Skills 分组 CSS 不完整");
}

// === 11. 恢复会话提示恢复了哪些状态 ===
{
  const hasRestoreNotice = VIEW_SRC.includes("// UI-03: 恢复时提示恢复了哪些状态")
    && VIEW_SRC.includes("const restoredParts: string[]")
    && VIEW_SRC.includes('restoredParts.push(`模型 ${session.model}`)')
    && VIEW_SRC.includes('restoredParts.push(`权限 ${session.permissionMode}`)')
    && VIEW_SRC.includes("session.pinnedContextRefs")
    && VIEW_SRC.includes("session.nativeSessionRef")
    && VIEW_SRC.includes("恢复状态：${restoredParts.join");
  add("UI-03 恢复提示: 消息数 + 模型 + 权限 + Pin + 原生会话", hasRestoreNotice, hasRestoreNotice ? "ok" : "恢复提示不完整");
}

// === 12. Files 页已分三段（已有，验证保留） ===
{
  const hasThreeSections = VIEW_SRC.includes('variant: "current"')
    && VIEW_SRC.includes('variant: "pinned"')
    && VIEW_SRC.includes('variant: "session"');
  add("UI-03 Files 三段: 本轮上下文 / Pin / 外部读取请求（已有，验证保留）", hasThreeSections, hasThreeSections ? "ok" : "Files 三段缺失");
}

// === 13. 顶栏保留会话标题、新聊天、设置、runtime 状态（已有，验证保留） ===
{
  const hasTopbarElements = VIEW_SRC.includes("llm-bridge-session-selector")
    && VIEW_SRC.includes("llm-bridge-new-chat-btn")
    && VIEW_SRC.includes("llm-bridge-settings-btn")
    && VIEW_SRC.includes("llm-bridge-runtime-status");
  add("UI-03 顶栏: 会话标题 + 新聊天 + 设置 + runtime 状态（已有，验证保留）", hasTopbarElements, hasTopbarElements ? "ok" : "顶栏元素缺失");
}

// === 14. nav-item 仍保留 tooltip/aria-label ===
{
  const hasTooltips = VIEW_SRC.includes('"aria-label": "Chat"')
    && VIEW_SRC.includes('"aria-label": "Files"')
    && VIEW_SRC.includes('"aria-label": "History"');
  add("UI-03 nav-item tooltip/aria-label: 保留（键盘可访问）", hasTooltips, hasTooltips ? "ok" : "aria-label 缺失");
}

// === 生成报告 ===
const failed = results.filter((r) => r.status !== "pass");
const lines = [
  "# UI-03 Smoke: 导航、会话与页面层级验收",
  "",
  "- **generatedAt**: " + new Date().toISOString(),
  "- **testedCodeCommitSha**: " + gitSha(),
  "- **ui03SmokeStatus**: " + (failed.length === 0 ? "pass" : "fail"),
  "- **totalChecks**: " + results.length,
  "",
  "| Check | Status | Detail |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
  "",
];

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`\n=== UI-03 Smoke: 导航、会话与页面层级验收 ===`);
for (const r of results) {
  console.log(`${r.status === "pass" ? "✅" : "❌"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
console.log(`\n报告已写入: ${OUT}`);
console.log(`\n=== 结果: ${results.length - failed.length} passed, ${failed.length} failed ===`);

if (failed.length > 0) process.exit(1);
