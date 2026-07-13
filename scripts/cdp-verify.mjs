#!/usr/bin/env node
// CDP Obsidian 实机验收脚本
// 用法: node scripts/cdp-verify.mjs
//
// 通过 CDP 端口 9223 连接到运行中的 Obsidian,自动执行以下验收项:
// 1. 重载插件 + 控制台无异常
// 2. nav labels 数量
// 3. provider 配置读取(Codex/Claude/Pi)
// 4. settings 内部状态
// 5. 关键 DOM 元素存在性(侧边栏图标、chat view 容器)
// 6. 翻译资源加载
//
// 不验证(需真实模型调用): 流式输出、thinking 过程、执行块折叠、文件链接打开

import http from "http";

const CDP_PORT = 9223;

function getPages() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  const pages = await getPages();
  const page = pages.find((p) => p.url && p.url.includes("obsidian"));
  if (!page) {
    console.log("FAIL: No obsidian page found");
    process.exit(1);
  }

  console.log(`Connected: ${page.title}`);
  console.log("");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const consoleErrors = [];
  const consoleWarnings = [];

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = id++;
      ws.send(JSON.stringify({ id: msgId, method, params }));
      const handler = (ev) => {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
        if (msg.id === msgId) {
          ws.removeEventListener("message", handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener("message", handler);
    });

  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    return r.result?.value;
  };

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  // 启用 Runtime + Log,捕获 console 消息
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Log.startViolationsReport", { config: [{ name: "consoleAPI", threshold: -1 }] });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
    if (msg.method === "Runtime.consoleAPICalled") {
      const type = msg.params.type;
      const text = (msg.params.args || []).map((a) => a.value || a.description || "").join(" ");
      if (type === "error") consoleErrors.push(text);
      else if (type === "warning") consoleWarnings.push(text);
    }
    // 捕获未捕获异常
    if (msg.method === "Runtime.exceptionThrown") {
      const details = msg.params.exceptionDetails;
      const text = details.exception?.description || details.text || "unknown exception";
      consoleErrors.push(`[exception] ${text}`);
    }
  });

  const results = [];
  const record = (name, ok, detail = "") => {
    const status = ok ? "PASS" : "FAIL";
    results.push({ name, ok, detail, status });
    console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    // ========== 1. 重载插件 + 捕获控制台 ==========
    console.log("=== 阶段 1: 重载插件 + 控制台监控 ===");

    // 清空已收集的错误
    consoleErrors.length = 0;
    consoleWarnings.length = 0;

    // 重载插件
    const reloadResult = await evalJs(
      `(async function(){
        try {
          await app.plugins.disablePlugin('llm-cli-bridge');
          await app.plugins.enablePlugin('llm-cli-bridge');
          return 'RELOADED';
        } catch(e) {
          return 'ERROR:' + e.message;
        }
      })()`,
      true,
    );
    record("插件重载", reloadResult === "RELOADED", reloadResult);

    // 等待 5 秒让插件初始化完成
    await new Promise((r) => setTimeout(r, 5000));

    // ========== 2. 插件版本 ==========
    console.log("\n=== 阶段 2: 插件状态 ===");
    const version = await evalJs(
      `(function(){
        try {
          const p = app.plugins.plugins['llm-cli-bridge'];
          return p ? 'v' + p.manifest.version : 'plugin_not_loaded';
        } catch(e) { return 'EXC:' + e.message; }
      })()`,
    );
    record("插件已加载", version === "v2.18.0", version);

    // ========== 3. nav labels(侧边栏图标) ==========
    const navCount = await evalJs(`document.querySelectorAll('.llm-bridge-nav-label').length`);
    record("侧边栏 nav labels", navCount >= 1, `count=${navCount}`);

    // ========== 4. provider 配置状态 ==========
    console.log("\n=== 阶段 3: Provider 配置 ===");
    const providerState = await evalJs(
      `(function(){
        try {
          const p = app.plugins.plugins['llm-cli-bridge'];
          if (!p || !p.settings) return 'no_settings';
          const s = p.settings;
          return JSON.stringify({
            agentType: s.agentType,
            hasApiKey: !!(s.codexApiKey || s.claudeApiKey || s.piApiKey),
            codexKey: !!s.codexApiKey,
            claudeKey: !!s.claudeApiKey,
            piKey: !!s.piApiKey,
            model: s.model || null,
            effortLevel: s.effortLevel || null,
          });
        } catch(e) { return 'EXC:' + e.message; }
      })()`,
    );

    let providerOk = false;
    let providerDetail = providerState;
    try {
      const parsed = JSON.parse(providerState);
      providerOk = !!parsed.agentType;
      providerDetail = `agent=${parsed.agentType} keys={codex:${parsed.codexKey},claude:${parsed.claudeKey},pi:${parsed.piKey}} model=${parsed.model || "default"}`;
    } catch { /* keep raw */ }
    record("Provider 配置可读", providerOk, providerDetail);

    // ========== 5. settings 完整结构 + runtime 配置文件存在性 ==========
    console.log("\n=== 阶段 4: Settings 完整结构 ===");
    const settingsDetail = await evalJs(
      `(function(){
        try {
          const p = app.plugins.plugins['llm-cli-bridge'];
          if (!p || !p.settings) return 'no_settings';
          const s = p.settings;
          return JSON.stringify({
            agentType: s.agentType,
            backendMode: s.backendMode,
            model: s.model,
            effortLevel: s.effortLevel,
            hasCodexKey: !!s.codexApiKey,
            hasClaudeKey: !!s.claudeApiKey,
            hasPiKey: !!s.piApiKey,
            outputDir: s.outputDir,
            devTestMode: !!s.devTestMode,
            keysCount: Object.keys(s).length,
          });
        } catch(e) { return 'EXC:' + e.message; }
      })()`,
    );
    let settingsOk = false;
    let settingsDetailStr = settingsDetail;
    try {
      const parsed = JSON.parse(settingsDetail);
      settingsOk = !!parsed.agentType && !!parsed.backendMode;
      settingsDetailStr = `agent=${parsed.agentType} backend=${parsed.backendMode} model=${parsed.model} keys=${parsed.keysCount} fields`;
    } catch { /* keep raw */ }
    record("Settings 结构完整", settingsOk, settingsDetailStr);

    // ========== 5b. runtime 配置文件存在性(sidecar 验证) ==========
    console.log("\n=== 阶段 4b: Runtime 配置文件 ===");
    const runtimeFiles = await evalJs(
      `(async function(){
        try {
          const { existsSync, readFileSync } = require('fs');
          const { join } = require('path');
          const vault = app.vault.adapter.getBasePath();
          const root = join(vault, '.llm-bridge', 'private', 'runtime');
          const files = {
            codexConfig: existsSync(join(root, 'codex', 'config.toml')),
            claudeConfig: existsSync(join(root, 'claude', 'settings.json')),
            piSettings: existsSync(join(root, 'pi', 'settings.json')),
            piModels: existsSync(join(root, 'pi', 'models.json')),
            bridgeOwned: existsSync(join(root, 'bridge-owned.json')),
          };
          let sidecar = null;
          if (files.bridgeOwned) {
            try {
              sidecar = JSON.parse(readFileSync(join(root, 'bridge-owned.json'), 'utf8'));
            } catch(e) { sidecar = { error: e.message }; }
          }
          return JSON.stringify({ root, files, sidecar });
        } catch(e) { return 'EXC:' + e.message; }
      })()`,
      true,
    );
    let runtimeOk = false;
    let runtimeDetail = runtimeFiles;
    try {
      const parsed = JSON.parse(runtimeFiles);
      runtimeOk = !!parsed.files;
      const f = parsed.files;
      runtimeDetail = `codex=${f.codexConfig} claude=${f.claudeConfig} pi=${f.piSettings} sidecar=${f.bridgeOwned}`;
      if (parsed.sidecar) {
        runtimeDetail += ` | sidecar.providers=${JSON.stringify(parsed.sidecar.providers)}`;
      }
    } catch { /* keep raw */ }
    record("Runtime 配置文件状态", runtimeOk, runtimeDetail);

    // ========== 6. 控制台错误检查 ==========
    console.log("\n=== 阶段 5: 控制台错误 ===");
    // 过滤掉已知无关警告(Obsidian 自身、deprecation 等)
    const realErrors = consoleErrors.filter((e) =>
      !/deprecated|DeprecationWarning|electron|DevTools|Download the React/i.test(e)
      && !/llm-cli-bridge/.test(e) === false || /llm-cli-bridge/i.test(e)
    );
    record("重载后无 llm-cli-bridge 相关错误", realErrors.length === 0, realErrors.length > 0 ? realErrors.slice(0, 3).join(" | ").substring(0, 200) : `errors=${consoleErrors.length} warnings=${consoleWarnings.length}`);

    // ========== 7. 打开 chat view 测试 ==========
    console.log("\n=== 阶段 6: Chat View ===");
    const chatViewResult = await evalJs(
      `(async function(){
        try {
          // 尝试激活侧边栏图标打开 chat view
          const navIcon = document.querySelector('.llm-bridge-nav-label');
          if (navIcon) navIcon.click();
          await new Promise(r => setTimeout(r, 1500));
          const chatView = document.querySelector('.llm-bridge-chat-view, .llm-bridge-view');
          const composer = document.querySelector('.llm-bridge-composer, .llm-bridge-input, textarea.llm-bridge-input');
          return JSON.stringify({
            chatViewExists: !!chatView,
            composerExists: !!composer,
            chatViewClass: chatView ? chatView.className.substring(0, 80) : null,
          });
        } catch(e) { return 'EXC:' + e.message; }
      })()`,
      true,
    );

    let chatOk = false;
    let chatDetail = chatViewResult;
    try {
      const parsed = JSON.parse(chatViewResult);
      chatOk = parsed.chatViewExists;
      chatDetail = `chatView=${parsed.chatViewExists} composer=${parsed.composerExists}`;
    } catch { /* keep raw */ }
    record("Chat view 可打开", chatOk, chatDetail);

    // ========== 8. 翻译资源(通过 view 实例的 localizeRunStatus) ==========
    console.log("\n=== 阶段 7: 翻译资源 ===");
    const i18nResult = await evalJs(
      `(async function(){
        try {
          const p = app.plugins.plugins['llm-cli-bridge'];
          if (!p) return 'no_plugin';
          // 查找 LLMBridgeView 实例(正确 view type: llm-cli-bridge-view)
          let leaves = app.workspace.getLeavesOfType('llm-cli-bridge-view');
          if (!leaves || leaves.length === 0) {
            // 若未打开,通过 plugin 的 activateView 打开
            if (p.activateView) {
              await p.activateView();
              await new Promise(r => setTimeout(r, 1500));
            }
            leaves = app.workspace.getLeavesOfType('llm-cli-bridge-view');
          }
          if (!leaves || leaves.length === 0) return 'no_view_leaf';
          const view = leaves[0].view;
          if (!view || !view.localizeRunStatus) return 'no_localize_method';
          // 测试翻译几个已知 key
          const tests = {
            'Thinking': view.localizeRunStatus('Thinking'),
            'Running command': view.localizeRunStatus('Running command'),
            'completed': view.localizeRunStatus('completed'),
          };
          return JSON.stringify({ hasLocalize: true, tests });
        } catch(e) { return 'EXC:' + e.message; }
      })()`,
      true,
    );
    let i18nOk = false;
    let i18nDetail = i18nResult;
    try {
      const parsed = JSON.parse(i18nResult);
      i18nOk = parsed.hasLocalize === true && !!parsed.tests;
      i18nDetail = `Thinking="${parsed.tests.Thinking}" Running="${parsed.tests['Running command']}" completed="${parsed.tests.completed}"`;
    } catch { /* keep raw */ }
    record("翻译资源(view.localizeRunStatus)", i18nOk, i18nDetail);

    // ========== 9. 二次控制台错误检查(chat view 打开后) ==========
    console.log("\n=== 阶段 8: 二次控制台检查 ===");
    await new Promise((r) => setTimeout(r, 2000));
    const realErrors2 = consoleErrors.filter((e) =>
      !/deprecated|DeprecationWarning|electron|DevTools|Download the React/i.test(e)
      && /llm-cli-bridge/i.test(e)
    );
    record("Chat view 打开后无新错误", realErrors2.length === 0, realErrors2.length > 0 ? realErrors2.slice(0, 3).join(" | ").substring(0, 200) : `累计 errors=${consoleErrors.length}`);

  } catch (e) {
    record("CDP 执行", false, `exception: ${e.message}`);
  } finally {
    ws.close();

    // ========== 汇总 ==========
    console.log("\n" + "=".repeat(60));
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    console.log(`验收结果: ${passed} passed, ${failed} failed, 共 ${results.length} 项`);
    if (failed > 0) {
      console.log("\n失败项:");
      results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
    }
    console.log("\n未自动验证项(需真实模型调用):");
    console.log("  - 文字流式输出");
    console.log("  - 图片流式输出");
    console.log("  - thinking/工具过程保留");
    console.log("  - 执行块可折叠");
    console.log("  - 文件链接可打开");
    console.log("  - 缺 Key 只提示一次(需切换 provider)");
    console.log("=".repeat(60));

    setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
  }
}

main().catch((e) => {
  console.log("Fatal:", e.message);
  process.exit(1);
});
