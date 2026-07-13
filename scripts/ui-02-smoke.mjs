// UI-02 Smoke: Composer 与上下文工作台验收
// 验证紧凑态输入框、自动增高、上下文分组、布局防竖排、"需要你操作"状态、文件 chip 键盘删除
// 独立 UI 收尾 smoke

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-ui-02-smoke.md");
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

// === 1. autoGrowInput 方法存在 ===
{
  const hasMethod = VIEW_SRC.includes("private autoGrowInput(): void")
    && VIEW_SRC.includes('el.style.height = "auto";')
    && VIEW_SRC.includes("Math.min(el.scrollHeight, max)")
    && VIEW_SRC.includes('el.addClass("is-auto-grown")')
    && VIEW_SRC.includes('el.removeClass("is-auto-grown")');
  add("UI-02 autoGrowInput 方法: 存在且实现完整（auto/scrollHeight/is-auto-grown）", hasMethod, hasMethod ? "ok" : "方法不完整");
}

// === 2. autoGrowInput 在 input 事件中调用 ===
{
  const hasInputCall = VIEW_SRC.includes("this.handleMentionInput();")
    && VIEW_SRC.includes("this.autoGrowInput();");
  add("UI-02 input 事件: 调用 autoGrowInput", hasInputCall, hasInputCall ? "ok" : "未在 input 事件中调用");
}

// === 3. autoGrowInput 在 setInput/clear/selectMention 中调用 ===
{
  const hasSetInputCall = VIEW_SRC.includes("this.inputEl.value = text;\n    this.autoGrowInput();");
  const hasClearCall = VIEW_SRC.includes('this.inputEl.value = "";\n    this.autoGrowInput();');
  const hasSelectMentionCall = VIEW_SRC.includes("this.autoGrowInput();\n    this.inputEl.focus();\n    void this.addAttachmentPathWithNotice");
  add("UI-02 autoGrowInput 接入: setInput/clear/selectMention 均调用", hasSetInputCall && hasClearCall && hasSelectMentionCall, `setInput=${hasSetInputCall} clear=${hasClearCall} selectMention=${hasSelectMentionCall}`);
}

// === 4. textarea rows="1"（紧凑态） ===
{
  const hasRows1 = VIEW_SRC.includes('rows: "1"');
  const noRows3 = !VIEW_SRC.includes('rows: "3"');
  add("UI-02 textarea rows: '1'（紧凑态，非 '3'）", hasRows1 && noRows3, hasRows1 && noRows3 ? "ok" : `rows="1"=${hasRows1} rows="3"存在=${!noRows3}`);
}

// === 5. CSS: 紧凑态输入框 min-height 52px, max-height 180px ===
{
  const hasCompact = STYLES_SRC.includes("min-height: 52px;")
    && STYLES_SRC.includes("max-height: 180px;")
    && STYLES_SRC.includes(".llm-bridge-input.is-auto-grown");
  add("UI-02 CSS 紧凑态: min-height 52px, max-height 180px, is-auto-grown 64px", hasCompact, hasCompact ? "ok" : "CSS 不完整");
}

// === 6. CSS: grid-template-rows 允许 180px ===
{
  const hasGridRows = STYLES_SRC.includes("grid-template-rows: auto auto minmax(52px, 180px) 32px !important;");
  add("UI-02 CSS grid: 允许输入行增高到 180px", hasGridRows, hasGridRows ? "ok" : "未找到 grid-template-rows 覆盖");
}

// === 7. CSS: 左侧工具防竖排 ===
{
  const hasNoWrap = STYLES_SRC.includes(".llm-bridge-composer-tools-left {")
    && STYLES_SRC.includes("flex-wrap: nowrap !important;")
    && STYLES_SRC.includes("white-space: nowrap;");
  add("UI-02 CSS 防竖排: left tools flex-wrap:nowrap + white-space:nowrap", hasNoWrap, hasNoWrap ? "ok" : "防竖排 CSS 不完整");
}

// === 8. 上下文分组: Skill 标签 ===
{
  const hasSkillLabel = VIEW_SRC.includes('// UI-02: 分组标签 — Skill')
    && VIEW_SRC.includes('container.createDiv({ cls: "llm-bridge-composer-context-group-label", text: loc === "zh" ? "Skill" : "Skill" });');
  add("UI-02 上下文分组 Skill: renderComposerRuntimeCapabilityChips 加分组标签", hasSkillLabel, hasSkillLabel ? "ok" : "未找到 Skill 分组标签");
}

// === 9. 上下文分组: Pin/External/File 标签 ===
{
  const hasFileGroup = VIEW_SRC.includes('// UI-02: 分组展示 — Pin / External / File')
    && VIEW_SRC.includes('{ label: "Pin", refs: refs.filter((r) => r.scope === "pinned") }')
    && VIEW_SRC.includes('label: loc === "zh" ? "外部读取" : "External"')
    && VIEW_SRC.includes('label: loc === "zh" ? "文件" : "File"');
  add("UI-02 上下文分组 Pin/External/File: renderComposerFileRefs 分组展示", hasFileGroup, hasFileGroup ? "ok" : "未找到文件分组逻辑");
}

// === 10. Note tag 加 "Note ·" 前缀 ===
{
  const hasNotePrefix = VIEW_SRC.includes('const displayName = fname ? `Note · ${fname}` : "No active note";');
  add("UI-02 Note 前缀: tag 显示 'Note · 文件名' 让用户区分上下文类型", hasNotePrefix, hasNotePrefix ? "ok" : "未找到 Note 前缀");
}

// === 11. 文件 chip 删除按钮键盘可操作 ===
{
  const hasKeyboardDelete = VIEW_SRC.includes('tabindex: "0", role: "button", "aria-label": `移除 ${ref.displayName}`')
    && VIEW_SRC.includes('remove.addEventListener("keydown", (event) => {')
    && VIEW_SRC.includes('if (event.key !== "Enter" && event.key !== " ") return;');
  add("UI-02 文件 chip 键盘删除: tabindex+role+aria-label+keydown", hasKeyboardDelete, hasKeyboardDelete ? "ok" : "键盘删除不完整");
}

// === 12. CSS: 文件 chip 删除按钮 focus-visible ===
{
  const hasFocusVisible = STYLES_SRC.includes(".llm-bridge-composer-file-remove:focus-visible {")
    && STYLES_SRC.includes("outline: 2px solid var(--interactive-accent);");
  add("UI-02 CSS 文件 chip 删除: focus-visible 样式", hasFocusVisible, hasFocusVisible ? "ok" : "未找到 focus-visible 样式");
}

// === 13. CSS: "需要你操作" accent 左边框 ===
{
  const hasAccentBorder = STYLES_SRC.includes('UI-02: "需要你操作"状态')
    && STYLES_SRC.includes(".llm-bridge-composer .llm-bridge-approval-card,")
    && STYLES_SRC.includes(".llm-bridge-composer .llm-bridge-clarification-card {")
    && STYLES_SRC.includes("border-left: 3px solid var(--interactive-accent) !important;");
  add("UI-02 CSS 需要你操作: approval/clarification 卡片 accent 左边框", hasAccentBorder, hasAccentBorder ? "ok" : "未找到 accent 左边框");
}

// === 14. CSS: 上下文分组标签样式 ===
{
  const hasGroupLabelCSS = STYLES_SRC.includes(".llm-bridge-composer-context-group-label {")
    && STYLES_SRC.includes("text-transform: uppercase;")
    && STYLES_SRC.includes("letter-spacing: 0.04em;");
  add("UI-02 CSS 上下文分组标签: uppercase + letter-spacing 样式", hasGroupLabelCSS, hasGroupLabelCSS ? "ok" : "未找到分组标签样式");
}

// === 15. CSS: 响应式 480px 隐藏模型选择器 ===
{
  const hasResponsive = STYLES_SRC.includes("@media (max-width: 480px)")
    && STYLES_SRC.includes(".llm-bridge-model-effort-picker {")
    && STYLES_SRC.includes("display: none;")
    && STYLES_SRC.includes(".llm-bridge-command-menu-summary .llm-bridge-command-menu-label {");
  add("UI-02 CSS 响应式 480px: 隐藏模型选择器+工具标签", hasResponsive, hasResponsive ? "ok" : "响应式 CSS 不完整");
}

// === 16. CSS: 响应式 360px 极窄 ===
{
  const hasNarrow = STYLES_SRC.includes("@media (max-width: 360px)")
    && STYLES_SRC.includes("width: 32px;")
    && STYLES_SRC.includes("height: 32px;");
  add("UI-02 CSS 响应式 360px: 极窄宽度发送/停止按钮 32px", hasNarrow, hasNarrow ? "ok" : "极窄宽度 CSS 不完整");
}

// === 17. CSS: 响应式 760px 权限模式 — 旧 compact 规则已移除 ===
{
  // 旧规则在窄栏下隐藏左侧权限入口并显示已取消的 compact 按钮，已移除。
  // 权限入口应在所有宽度下保持可见；compact 按钮由 composer.css 统一隐藏。
  const noOldHidingRule = !STYLES_SRC.includes(".llm-bridge-composer-tools-left .llm-bridge-permission-picker {\n    display: none;")
    && !STYLES_SRC.includes(".llm-bridge-composer-tools-right .llm-bridge-permission-picker-compact {\n    display: inline-flex;");
  const compactHidden = STYLES_SRC.includes(".llm-bridge-composer-tools-right .llm-bridge-permission-picker-compact {\n  display: none;\n}");
  add("UI-02 CSS 响应式 760px: 旧 compact 隐藏规则已移除，权限入口不再被隐藏", noOldHidingRule && compactHidden, (noOldHidingRule && compactHidden) ? "ok" : "旧规则残留或 compact 未隐藏");
}

// === 18. resolveUiLocale 导入存在（UI-02 复用） ===
{
  const hasImport = VIEW_SRC.includes('resolveUiLocale');
  add("UI-02 resolveUiLocale: 复用 F-01 的 locale 解析", hasImport, hasImport ? "ok" : "未使用 resolveUiLocale");
}

// === 19. CSS: UI-02 section 标记存在 ===
{
  const hasSection = STYLES_SRC.includes("UI-02: Composer 与上下文工作台重做");
  add("UI-02 CSS section: 标记存在", hasSection, hasSection ? "ok" : "未找到 UI-02 section 标记");
}

// === 20. 现有 is-approval-active / is-user-input-active 机制保留 ===
{
  const hasExistingMechanism = VIEW_SRC.includes('this.composerBarEl?.addClass("is-approval-active")')
    && VIEW_SRC.includes('this.composerBarEl?.addClass("is-user-input-active")')
    && STYLES_SRC.includes(".llm-bridge-composer-bar.is-user-input-active,")
    && STYLES_SRC.includes(".llm-bridge-composer-bar.is-approval-active {");
  add("UI-02 现有机制保留: approval/user-input active 时隐藏 composer bar", hasExistingMechanism, hasExistingMechanism ? "ok" : "现有机制被破坏");
}

// === 生成报告 ===
const failed = results.filter((r) => r.status !== "pass");
const lines = [
  "# UI-02 Smoke: Composer 与上下文工作台验收",
  "",
  "- **generatedAt**: " + new Date().toISOString(),
  "- **testedCodeCommitSha**: " + gitSha(),
  "- **ui02SmokeStatus**: " + (failed.length === 0 ? "pass" : "fail"),
  "- **totalChecks**: " + results.length,
  "",
  "| Check | Status | Detail |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
  "",
];

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`\n=== UI-02 Smoke: Composer 与上下文工作台验收 ===`);
for (const r of results) {
  console.log(`${r.status === "pass" ? "✅" : "❌"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
console.log(`\n报告已写入: ${OUT}`);
console.log(`\n=== 结果: ${results.length - failed.length} passed, ${failed.length} failed ===`);

if (failed.length > 0) process.exit(1);
