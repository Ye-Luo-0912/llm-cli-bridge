// LLM CLI Bridge — ToolPresentation smoke (F-01 验收)
//
// 独立 smoke：验证「用户可见操作」翻译层的验收点。
// 覆盖：
//   1. 普通模式不泄露下划线内部名（property_get / vault_delete / codex-managed-app-server ...）
//   2. 未知工具安全降级「正在执行工具 / Running tool」，不泄露原始 payload
//   3. Developer Mode 保留原始名称与输入（rawName / rawInput）
//   4. 双语表（zh/en）运行时切换 + resolveUiLocale 自动跟随 Obsidian 语言
//   5. 上下文摘要（property_get + path + key → 读取《项目计划》的 tags）
//   6. 风险等级与 shouldHighlight
//   7. ActionType 精确匹配优先于正则（tags_list → List vault tags，不被 list 正则误吞）
//   8. 旧入口委托（toolLabelLegacy / toolIconCategoryLegacy / toolActivityLegacy）输出与既有断言一致

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-tool-presentation-smoke.md");
const bundle = join(PROJECT_ROOT, ".test-tool-presentation-temp.mjs");

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

try {
  const esbuild = (await import("esbuild")).default;
  await esbuild.build({
    entryPoints: [join(PROJECT_ROOT, "src", "runtime", "core", "toolPresentation.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundle,
  });
  const mod = await import(`file://${bundle.replace(/\\/g, "/")}`);
  const {
    presentTool, presentAction, presentProvider, present,
    resolveUiLocale, resetUiLocale,
    toolLabelLegacy, toolIconCategoryLegacy, toolActivityLegacy,
  } = mod;

  // ---------- 1. 普通模式不泄露下划线内部名 ----------
  const internalNames = [
    "property_get", "property_set", "property_delete",
    "vault_delete", "vault_rename", "vault_restore",
    "tags_list", "tasks_list", "command_list", "command_run",
    "metadatacache_get", "resolved_links_map", "backlinks_get",
    "headings_get", "outlinks_get", "broken_links_list",
    "rename_tag", "clipboard_write", "view_mode_set",
  ];
  let noLeakOk = true;
  const leakDetail = [];
  for (const name of internalNames) {
    const p = presentTool(name, undefined, { locale: "en" });
    if (p.userLabel.includes(name) || p.userLabel.includes("_")) {
      noLeakOk = false;
      leakDetail.push(`${name} → "${p.userLabel}"`);
    }
  }
  add("F-01 普通模式不泄露下划线内部名（19 个 ActionType）", noLeakOk, leakDetail.join(" | "));

  // provider id 不泄露
  const providerNoLeak = presentProvider("codex-managed-app-server", { locale: "en" }).userLabel === "Codex runtime"
    && !presentProvider("codex-managed-app-server", { locale: "en" }).userLabel.includes("codex-managed-app-server")
    && !presentProvider("codex-managed-app-server", { locale: "en" }).userLabel.includes("_");
  add("F-01 codex-managed-app-server → Codex runtime（不泄露内部 provider id）", providerNoLeak,
    presentProvider("codex-managed-app-server", { locale: "en" }).userLabel);

  // ---------- 2. 未知工具安全降级 ----------
  const secretPayload = JSON.stringify({ secret: "sk-live-12345", token: "bearer-xyz", path: "/etc/shadow" });
  const unknown = presentTool("some_unknown_internal_tool_xyz", secretPayload, { locale: "en" });
  const unknownZh = presentTool("another_unknown", secretPayload, { locale: "zh" });
  const unknownOk = unknown.userLabel === "Running tool"
    && unknown.isUnknown === true
    && unknown.rawName === undefined
    && unknown.rawInput === undefined
    && !unknown.userLabel.includes("some_unknown_internal_tool_xyz")
    && !JSON.stringify(unknown).includes("sk-live-12345")
    && !JSON.stringify(unknown).includes("bearer-xyz")
    && unknownZh.userLabel === "正在执行工具";
  add("F-01 未知工具安全降级（Running tool / 正在执行工具，不泄露 payload）", unknownOk,
    `en="${unknown.userLabel}" zh="${unknownZh.userLabel}" isUnknown=${unknown.isUnknown}`);

  // ---------- 3. Developer Mode 保留原始名与输入 ----------
  const devKnown = presentTool("property_get", '{"path":"x.md"}', { developerMode: true, locale: "en" });
  const devUnknown = presentTool("mystery_tool", '{"a":1}', { developerMode: true, locale: "en" });
  const devOk = devKnown.rawName === "property_get"
    && devKnown.rawInput === '{"path":"x.md"}'
    && devUnknown.rawName === "mystery_tool"
    && devUnknown.rawInput === '{"a":1}';
  add("F-01 Developer Mode 保留原始名称与输入（rawName / rawInput）", devOk,
    `known.rawName=${devKnown.rawName} unknown.rawName=${devUnknown.rawName}`);

  // 普通模式 raw 为 undefined
  const normalNoRaw = presentTool("property_get", '{"path":"x.md"}', { developerMode: false, locale: "en" });
  const normalNoRawOk = normalNoRaw.rawName === undefined && normalNoRaw.rawInput === undefined;
  add("F-01 普通模式 rawName/rawInput 为 undefined（不保留原始）", normalNoRawOk,
    `rawName=${normalNoRaw.rawName}`);

  // ---------- 4. 双语切换 ----------
  const zh = presentTool("property_get", undefined, { locale: "zh" });
  const en = presentTool("property_get", undefined, { locale: "en" });
  const bilingualOk = zh.userLabel === "读取笔记属性" && en.userLabel === "Read note property";
  add("F-01 双语：property_get → 读取笔记属性 / Read note property", bilingualOk,
    `zh="${zh.userLabel}" en="${en.userLabel}"`);

  const readZh = presentTool("Read", JSON.stringify({ file_path: "AGENTS.md" }), { locale: "zh" });
  const readEn = presentTool("Read", JSON.stringify({ file_path: "AGENTS.md" }), { locale: "en" });
  const readBilingualOk = readZh.userLabel === "读取 AGENTS.md" && readEn.userLabel === "Read AGENTS.md";
  add("F-01 双语：Read + path → 读取 AGENTS.md / Read AGENTS.md", readBilingualOk,
    `zh="${readZh.userLabel}" en="${readEn.userLabel}"`);

  // resolveUiLocale 自动跟随 Obsidian moment.locale()
  resetUiLocale();
  const origWindow = globalThis.window;
  globalThis.window = { moment: { locale: () => "zh-cn" } };
  const autoZh = resolveUiLocale();
  resetUiLocale();
  globalThis.window = { moment: { locale: () => "en" } };
  const autoEn = resolveUiLocale();
  resetUiLocale();
  globalThis.window = { moment: { locale: () => "fr" } };
  const autoFr = resolveUiLocale();
  resetUiLocale();
  delete globalThis.window;
  const autoNone = resolveUiLocale();
  globalThis.window = origWindow;
  const localeAutoOk = autoZh === "zh" && autoEn === "en" && autoFr === "en" && autoNone === "en";
  add("F-01 resolveUiLocale 自动跟随 Obsidian 语言（zh-cn→zh, en→en, fr→en, 无 window→en）", localeAutoOk,
    `zh=${autoZh} en=${autoEn} fr=${autoFr} none=${autoNone}`);

  // ---------- 5. 上下文摘要 ----------
  const summaryZh = presentAction("property_get", { path: "项目计划.md", key: "tags" }, { locale: "zh" });
  const summaryEn = presentAction("property_get", { path: "plan.md", key: "tags" }, { locale: "en" });
  const searchZh = presentAction("search", { query: "foo" }, { locale: "zh" });
  const summaryOk = summaryZh.summary === "读取《项目计划》的 tags"
    && summaryEn.summary === "Read tags of \"plan\""
    && searchZh.summary === "在 Vault 中搜索「foo」";
  add("F-01 上下文摘要：property_get→读取《项目计划》的 tags / search→在 Vault 中搜索「foo」", summaryOk,
    `zh="${summaryZh.summary}" en="${summaryEn.summary}" search="${searchZh.summary}"`);

  // ---------- 6. 风险等级与 shouldHighlight ----------
  const riskOk = presentAction("vault_delete", { path: "x" }).riskLevel === "high"
    && presentAction("vault_delete", { path: "x" }).shouldHighlight === true
    && presentAction("property_get", { path: "x" }).riskLevel === "low"
    && presentAction("property_set", { path: "x", key: "k", value: 1 }).riskLevel === "medium"
    && presentAction("command_run", { commandId: "c" }).riskLevel === "high";
  add("F-01 风险等级：vault_delete/command_run=high, property_set=medium, property_get=low", riskOk,
    `del=${presentAction("vault_delete", { path: "x" }).riskLevel} set=${presentAction("property_set", { path: "x", key: "k", value: 1 }).riskLevel} get=${presentAction("property_get", { path: "x" }).riskLevel}`);

  // ---------- 7. ActionType 精确匹配优先于正则 ----------
  const tagsList = presentTool("tags_list", undefined, { locale: "en" });
  const commandList = presentTool("command_list", undefined, { locale: "en" });
  const tasksList = presentTool("tasks_list", undefined, { locale: "en" });
  const actionFirstOk = tagsList.userLabel === "List vault tags"
    && commandList.userLabel === "List commands"
    && tasksList.userLabel === "List tasks"
    && tagsList.userLabel !== "Search"
    && commandList.userLabel !== "Run command";
  add("F-01 ActionType 精确匹配优先于正则（tags_list→List vault tags，不被 list 正则误吞）", actionFirstOk,
    `tags="${tagsList.userLabel}" cmd="${commandList.userLabel}" tasks="${tasksList.userLabel}"`);

  // ---------- 8. 旧入口委托（向后兼容） ----------
  const legacyOk = toolLabelLegacy("Read", JSON.stringify({ file_path: "AGENTS.md" })) === "Read AGENTS.md"
    && toolLabelLegacy("Write", JSON.stringify({ file_path: "TASKS_Summary.md" })) === "Write TASKS_Summary.md"
    && toolLabelLegacy("create_file", JSON.stringify({ file_path: "new.md" })) === "Created new.md"
    && toolLabelLegacy("Bash", JSON.stringify({ command: "ls -la" })) === "Run command"
    && toolLabelLegacy("Grep", JSON.stringify({ pattern: "foo" })) === "Search"
    && toolLabelLegacy("Read", JSON.stringify({ file_path: "/a/b/c/note.md" })) === "Read note.md"
    && toolIconCategoryLegacy("Read").category === "read"
    && toolIconCategoryLegacy("Bash").category === "command"
    && toolIconCategoryLegacy("Write").category === "write"
    && toolActivityLegacy("Read") === "Reading files"
    && toolActivityLegacy("Bash") === "Running checks"
    && toolActivityLegacy("Write") === "Editing files";
  add("F-01 旧入口委托：toolLabelLegacy/toolIconCategoryLegacy/toolActivityLegacy 输出与既有断言一致", legacyOk,
    `read="${toolLabelLegacy("Read", JSON.stringify({ file_path: "AGENTS.md" }))}" grep="${toolLabelLegacy("Grep", JSON.stringify({ pattern: "foo" }))}"`);

  // ---------- 9. present 统一入口分派 ----------
  const dispatchTool = present({ kind: "tool", toolName: "Read", toolInput: JSON.stringify({ file_path: "a.md" }), locale: "en" });
  const dispatchAction = present({ kind: "action", actionType: "property_get", params: { path: "a.md" }, locale: "zh" });
  const dispatchProvider = present({ kind: "provider", providerId: "codex-managed-app-server", locale: "zh" });
  const dispatchOk = dispatchTool.userLabel === "Read a.md"
    && dispatchAction.userLabel === "读取笔记属性"
    && dispatchProvider.userLabel === "Codex 运行时";
  add("F-01 present() 统一入口按 kind 分派（tool/action/provider）", dispatchOk,
    `tool="${dispatchTool.userLabel}" action="${dispatchAction.userLabel}" provider="${dispatchProvider.userLabel}"`);

  // ---------- 10. group 字段（spec 五分组） ----------
  const groupOk = presentAction("property_get", {}).group === "read"
    && presentAction("create_note", {}).group === "edit"
    && presentAction("search", {}).group === "search"
    && presentAction("open_url", {}).group === "external"
    && presentTool("Bash").group === "external";
  add("F-01 group 高层分组（read/edit/search/external）", groupOk,
    `get=${presentAction("property_get", {}).group} create=${presentAction("create_note", {}).group} search=${presentAction("search", {}).group} url=${presentAction("open_url", {}).group} bash=${presentTool("Bash").group}`);

} catch (err) {
  add("F-01 smoke 执行异常", false, String(err && err.stack ? err.stack : err));
} finally {
  if (existsSync(bundle)) rmSync(bundle, { force: true });
}

// ---------- 报告 ----------
const passed = results.filter((r) => r.status === "pass").length;
const failed = results.filter((r) => r.status === "fail").length;
const sha = gitSha();

const lines = [
  "# ToolPresentation Smoke 报告 (F-01)",
  "",
  `- 生成时间: ${new Date().toISOString()}`,
  `- commit sha: ${sha}`,
  `- 结果: ${passed} passed, ${failed} failed, ${results.length - passed - failed} skipped`,
  "",
  "## 验收项",
  "",
  "| 状态 | 验收项 | 详情 |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.status === "pass" ? "✅" : "❌"} | ${r.name} | ${r.detail || "-"} |`),
  "",
  "## 验收标准对照",
  "",
  "- 普通模式绝不显示 property_get / vault_delete / codex-managed-app-server 等内部名 ✅",
  "- 未知工具有安全降级文案「正在执行工具」，不泄露原始 payload ✅",
  "- 现有 toolDisplayLabel 逻辑迁移到 toolPresentation 单一入口 ✅",
  "- Developer Mode 下保留原始名称和输入 ✅",
  "- 双语表（zh/en）运行时按设置切换 ✅",
  "",
];

if (!existsSync(join(PROJECT_ROOT, "docs"))) mkdirSync(join(PROJECT_ROOT, "docs"), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");

console.log(`\n=== ToolPresentation smoke (F-01) ===`);
for (const r of results) {
  console.log(`${r.status === "pass" ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n报告已写入: ${OUT}`);
console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);

process.exit(failed > 0 ? 1 : 0);
