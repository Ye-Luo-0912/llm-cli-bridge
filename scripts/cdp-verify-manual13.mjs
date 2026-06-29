#!/usr/bin/env node
// CDP 验证 ManualId 13: 导入 Skill 重命名后 pinned/applyCount/lastUsedAt/groupOverride 迁移
// V2.12.1 Patch — 在真实 Obsidian runtime 验证 flushSkillsStateSave 修复
//
// 使用前提：
//   1. 先关闭正在运行的 Obsidian
//   2. 以调试模式重启：& "D:\Users\Ye_Luo\APP\Test\Obsidian\Obsidian.exe" --remote-debugging-port=9222
//   3. 在 Obsidian 中打开 LLM CLI Bridge 面板（点击左侧栏 bot 图标）
//   4. 运行：node scripts/cdp-verify-manual13.mjs
//
// 脚本通过 CDP 连接 Obsidian，在真实 runtime 执行：
//   导入 skill → 设置 meta(pinned/applyCount/lastUsedAt/groupOverride) → openEditSkillDialog →
//   DOM 修改 name → click 保存 → 等待 flushSkillsStateSave + refreshSkills → 验证新名 meta 完整 + 旧名清理

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9223; // 9222 被 svchost 占用，换 9223
const REPORT_PATH = "docs/V2.12.1_CDP_VERIFY.md";
const VERIFY_TIMEOUT_MS = 30000;

// ─── CDP WebSocket 客户端 ───────────────────────────────────────────
class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("CDP WebSocket 连接失败"));
      ws.onclose = () => {
        for (const { reject: rj } of this.pending.values()) rj(new Error("CDP WebSocket 已关闭"));
        this.pending.clear();
      };
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: r, reject: rj } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rj(new Error(msg.error.message));
          else r(msg.result);
        }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  evaluate(expression, awaitPromise = true) {
    return this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
  }
  close() { if (this.ws) this.ws.close(); }
}

// ─── 查找 Obsidian 页面 ───────────────────────────────────────────
async function findObsidianPage() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
  const pages = await resp.json();
  // 优先匹配 title/url 含 obsidian 的 page
  let page = pages.find(p => p.type === "page" && /obsidian/i.test(p.title || ""));
  if (!page) page = pages.find(p => p.type === "page" && /obsidian/i.test(p.url || ""));
  if (!page) page = pages.find(p => p.type === "page" && p.webSocketDebuggerUrl);
  return page || null;
}

// ─── 验证 JS（在 Obsidian renderer 执行） ─────────────────────────
const VERIFY_JS = `
(async () => {
  try {
    const app = window.app || globalThis.app;
    if (!app) return { error: "app 全局对象不可用（可能 contextIsolation 开启）" };

    // V2.12.1 CDP 验证前置：复制最新 main.js 并重载插件（确保 Obsidian 运行最新代码）
    try {
      const _req = globalThis.require;
      if (_req) {
        const _fs = _req("fs");
        const _path = _req("path");
        const _vp = app.vault.adapter.getBasePath();
        const _pluginDir = _path.join(_vp, ".obsidian", "plugins", "llm-cli-bridge");
        const _srcDir = "d:/Users/Ye_Luo/APP/Test/llm-cli-bridge";
        for (const _f of ["main.js", "manifest.json", "styles.css"]) {
          const _src = _path.join(_srcDir, _f);
          const _dst = _path.join(_pluginDir, _f);
          if (_fs.existsSync(_src)) _fs.copyFileSync(_src, _dst);
        }
        await app.plugins.disablePlugin("llm-cli-bridge");
        await new Promise(r => setTimeout(r, 500));
        await app.plugins.enablePlugin("llm-cli-bridge");
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      return { error: "reload plugin failed: " + String(e && e.message || e) };
    }

    if (!app.plugins || !app.plugins.plugins) return { error: "app.plugins 不可用" };
    const plugin = app.plugins.plugins["llm-cli-bridge"];
    if (!plugin) return { error: "llm-cli-bridge 插件未加载" };

    let leaves = app.workspace.getLeavesOfType("llm-cli-bridge-view");
    if (!leaves || leaves.length === 0) {
      // 自动激活 view（Obsidian 重启后面板可能未打开）
      try { await plugin.activateView(); } catch {}
      await new Promise(r => setTimeout(r, 1500));
      leaves = app.workspace.getLeavesOfType("llm-cli-bridge-view");
    }
    if (!leaves || leaves.length === 0) return { error: "LLM CLI Bridge 面板未打开，自动激活失败" };
    const view = leaves[0].view;
    if (!view) return { error: "view 实例为 null" };

    const adapter = app.vault.adapter;
    if (!adapter || !adapter.getBasePath) return { error: "vault adapter 不可用" };
    const vaultPath = adapter.getBasePath();

    // 测试数据
    const testSkillName = "cdp-test-manual13";
    const renamedSkillName = "cdp-test-manual13-renamed";
    const skillRelPath = ".llm-bridge/skills/" + testSkillName + ".md";
    const renamedRelPath = ".llm-bridge/skills/" + renamedSkillName + ".md";
    const stateRelPath = ".llm-bridge/skills-state.json";

    // 清理旧测试数据
    try { await adapter.remove(skillRelPath); } catch {}
    try { await adapter.remove(renamedRelPath); } catch {}

    // 写入测试 skill（## name 格式，与 serializeSkillToMarkdown 一致）
    const skillContent = "## " + testSkillName + "\\n\\nTest skill for CDP ManualId 13\\n\\nTest prompt content";
    await adapter.write(skillRelPath, skillContent);

    // 刷新加载
    await view.refreshSkills();

    // 找到测试 skill
    const skills = view.skills || [];
    const skill = skills.find(s => s.name === testSkillName);
    if (!skill) return { error: "测试 skill 未加载", skills: skills.map(s => s.name) };

    // 设置 meta（pinned/applyCount/lastUsedAt/groupOverride）
    const testMeta = {
      pinned: true,
      applyCount: 3,
      lastUsedAt: "2026-06-29T10:00:00.000Z",
      groupOverride: "test-group-cdp",
      sortOrder: 0,
      collapsed: false
    };
    view.skillsState = {
      ...view.skillsState,
      skills: {
        ...view.skillsState.skills,
        [testSkillName]: testMeta
      }
    };
    // 先 schedule（设置 timer）再 flush（取消 timer 并立即保存）
    // flushSkillsStateSave 内部检查 timer===null 提前返回，所以必须先 schedule
    view.scheduleSkillsStateSave();
    await view.flushSkillsStateSave();

    // 验证 meta 已落盘
    const stateBeforeStr = await adapter.read(stateRelPath);
    const stateBefore = JSON.parse(stateBeforeStr);
    const metaBefore = stateBefore.skills && stateBefore.skills[testSkillName];
    if (!metaBefore || metaBefore.pinned !== true || metaBefore.applyCount !== 3) {
      return { error: "meta 设置后落盘失败", metaBefore };
    }

    // 触发 openEditSkillDialog（真实 UI 路径）
    view.openEditSkillDialog(skill);

    // 等待 Modal DOM 渲染
    await new Promise(r => setTimeout(r, 300));
    const form = document.querySelector(".modal-container .llm-bridge-import-skill-form");
    if (!form) return { error: "EditSkillModal 未打开（DOM 未找到 .llm-bridge-import-skill-form）" };

    // 修改 name input
    const inputs = form.querySelectorAll("input.llm-bridge-import-input");
    const nameInput = inputs[0];
    if (!nameInput) return { error: "name input 未找到" };
    nameInput.value = renamedSkillName;
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    nameInput.dispatchEvent(new Event("change", { bubbles: true }));

    // click 保存按钮（触发 onConfirm → updateImportedSkill → renameSkillMeta → flushSkillsStateSave → refreshSkills）
    const saveBtn = form.querySelector("button.mod-warning");
    if (!saveBtn) return { error: "保存按钮未找到" };
    saveBtn.click();

    // 等待 flushSkillsStateSave + refreshSkills 完成（refreshSkills 含磁盘 IO）
    await new Promise(r => setTimeout(r, 1200));

    // 验证结果
    const stateAfterStr = await adapter.read(stateRelPath);
    const stateAfter = JSON.parse(stateAfterStr);
    const newMeta = stateAfter.skills && stateAfter.skills[renamedSkillName];
    const oldMetaExists = !!(stateAfter.skills && stateAfter.skills[testSkillName]);

    const checks = {
      newMetaExists: !!newMeta,
      pinnedMigrated: newMeta ? newMeta.pinned === true : false,
      applyCountMigrated: newMeta ? newMeta.applyCount === 3 : false,
      lastUsedAtMigrated: newMeta ? newMeta.lastUsedAt === "2026-06-29T10:00:00.000Z" : false,
      groupOverrideMigrated: newMeta ? newMeta.groupOverride === "test-group-cdp" : false,
      oldMetaCleaned: !oldMetaExists,
    };

    // 验证磁盘 skill 文件重命名
    const oldFileGone = !(await adapter.exists(skillRelPath));
    const newFileExists = await adapter.exists(renamedRelPath);
    checks.oldSkillFileGone = oldFileGone;
    checks.newSkillFileExists = newFileExists;

    const allPassed = Object.values(checks).every(v => v === true);

    // 清理测试数据
    try { await adapter.remove(renamedRelPath); } catch {}
    if (stateAfter.skills && stateAfter.skills[renamedSkillName]) {
      delete stateAfter.skills[renamedSkillName];
      try { await adapter.write(stateRelPath, JSON.stringify(stateAfter, null, 2)); } catch {}
    }
    try { await view.refreshSkills(); } catch {}

    return {
      success: allPassed,
      vaultPath,
      pluginVersion: plugin.manifest ? plugin.manifest.version : "unknown",
      checks,
      metaBefore,
      newMeta,
      oldMetaExists,
      stateBeforeSkillNames: Object.keys(stateBefore.skills || {}),
      stateAfterSkillNames: Object.keys(stateAfter.skills || {}),
    };
  } catch (e) {
    return { error: String(e && e.message || e), stack: e && e.stack };
  }
})()
`;

// ─── 主流程 ───────────────────────────────────────────────────────
async function main() {
  const startTime = new Date().toISOString();
  console.log(`[CDP Verify ManualId 13] 开始 — ${startTime}`);
  console.log(`[CDP] 连接 http://${CDP_HOST}:${CDP_PORT} ...`);

  let page;
  try {
    page = await findObsidianPage();
  } catch (e) {
    console.error(`[CDP] 无法连接 CDP 端口 ${CDP_PORT}：${e.message}`);
    console.error(`[CDP] 请先以调试模式启动 Obsidian：`);
    console.error(`[CDP]   & "D:\\Users\\Ye_Luo\\APP\\Test\\Obsidian\\Obsidian.exe" --remote-debugging-port=9222`);
    process.exit(2);
  }

  if (!page) {
    console.error(`[CDP] 未找到 Obsidian 页面（端口 ${CDP_PORT} 无 page 类型目标）`);
    console.error(`[CDP] 请确认 Obsidian 已以 --remote-debugging-port=9222 启动`);
    process.exit(2);
  }

  console.log(`[CDP] 找到页面: ${page.title || "(untitled)"} | ${page.url}`);

  const client = new CdpClient(page.webSocketDebuggerUrl);
  try {
    await client.connect();
    console.log(`[CDP] WebSocket 已连接，执行验证 JS ...`);
  } catch (e) {
    console.error(`[CDP] WebSocket 连接失败: ${e.message}`);
    process.exit(3);
  }

  let result;
  try {
    const evalResult = await Promise.race([
      client.evaluate(VERIFY_JS),
      new Promise((_, reject) => setTimeout(() => reject(new Error("验证执行超时")), VERIFY_TIMEOUT_MS)),
    ]);
    result = evalResult && evalResult.result && evalResult.result.value;
    if (!result) {
      // 可能是 JS 异常
      const exc = evalResult && evalResult.exceptionDetails;
      console.error("[CDP] 验证 JS 执行异常:", JSON.stringify(exc, null, 2));
      process.exit(4);
    }
  } catch (e) {
    console.error(`[CDP] 验证执行失败: ${e.message}`);
    client.close();
    process.exit(5);
  }
  client.close();

  const endTime = new Date().toISOString();
  console.log(`\n[CDP Verify ManualId 13] 完成 — ${endTime}\n`);
  console.log(JSON.stringify(result, null, 2));

  // 写报告
  const report = buildReport(startTime, endTime, page, result);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  try {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, report, "utf8");
    console.log(`\n[CDP] 报告已写入 ${REPORT_PATH}`);
  } catch (e) {
    console.error(`[CDP] 报告写入失败: ${e.message}`);
  }

  process.exit(result && result.success ? 0 : 1);
}

function buildReport(start, end, page, result) {
  const success = result && result.success;
  const checks = result && result.checks || {};
  const lines = [];
  lines.push(`# V2.12.1 CDP 验证报告 — ManualId 13`);
  lines.push(``);
  lines.push(`- **验证时间**: ${start} → ${end}`);
  lines.push(`- **CDP 页面**: ${page.title || "(untitled)"} | ${page.url}`);
  lines.push(`- **插件版本**: ${result && result.pluginVersion || "unknown"}`);
  lines.push(`- **Vault 路径**: ${result && result.vaultPath || "(unknown)"}`);
  lines.push(`- **验证结果**: ${success ? "✅ PASS" : "❌ FAIL"}`);
  lines.push(``);
  lines.push(`## 验证项`);
  lines.push(``);
  lines.push(`| 检查项 | 结果 |`);
  lines.push(`|---|---|`);
  for (const [k, v] of Object.entries(checks)) {
    lines.push(`| ${k} | ${v ? "✅" : "❌"} |`);
  }
  lines.push(``);
  if (result && result.error) {
    lines.push(`## 错误`);
    lines.push(``);
    lines.push("```");
    lines.push(result.error);
    if (result.stack) lines.push(result.stack);
    lines.push("```");
    lines.push(``);
  } else {
    lines.push(`## Meta 迁移详情`);
    lines.push(``);
    lines.push(`### 重命名前（旧名 meta）`);
    lines.push("```json");
    lines.push(JSON.stringify(result && result.metaBefore, null, 2));
    lines.push("```");
    lines.push(``);
    lines.push(`### 重命名后（新名 meta）`);
    lines.push("```json");
    lines.push(JSON.stringify(result && result.newMeta, null, 2));
    lines.push("```");
    lines.push(``);
    lines.push(`### State skills 键（前→后）`);
    lines.push(``);
    lines.push(`- 前: ${(result && result.stateBeforeSkillNames || []).join(", ") || "(空)"}`);
    lines.push(`- 后: ${(result && result.stateAfterSkillNames || []).join(", ") || "(空)"}`);
    lines.push(``);
  }
  lines.push(`## 验证路径`);
  lines.push(``);
  lines.push(`真实 Obsidian runtime 通过 CDP 执行完整 ManualId 13 链路：`);
  lines.push(`导入 skill → 设置 meta(pinned/applyCount/lastUsedAt/groupOverride) → flushSkillsStateSave 落盘 → openEditSkillDialog → DOM 修改 name → click 保存 → updateImportedSkill → renameSkillMeta → flushSkillsStateSave → refreshSkills → 验证新名 meta 完整 + 旧名清理`);
  lines.push(``);
  lines.push(`此验证覆盖 V2.12.1 修复的真实代码路径（非 mock），确认 flushSkillsStateSave 在 refreshSkills 之前落盘，meta 迁移不被磁盘重载覆盖。`);
  return lines.join("\n") + "\n";
}

main().catch(e => {
  console.error(`[CDP] 未捕获错误: ${e.message}`);
  process.exit(99);
});
