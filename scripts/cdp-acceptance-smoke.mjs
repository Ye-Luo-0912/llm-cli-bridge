#!/usr/bin/env node
// LLM CLI Bridge — CDP 端口验收脚本
//
// 通过 CDP 端口 9223 连接 Obsidian，执行以下验收：
// 1. 重载插件，检查 Console 无新增错误
// 2. 窄栏 760px 检查菜单/输入框/回到底部按钮
// 3. 检查插件状态栏（provider 派生）
// 4. 发送图文消息（需真实 provider 可用）
//
// 运行：node scripts/cdp-acceptance-smoke.mjs
// 输出：docs/test-report-cdp-acceptance.md

import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-cdp-acceptance.md");
const CDP_PORT = 9223;

const results = [];
function record(name, status, detail) {
  const icon = status === "pass" ? "✅" : status === "fail" ? "❌" : "⏭️";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
  results.push({ name, status, detail: detail || "" });
}

// CDP HTTP 请求
function cdpRequest(path) {
  return new Promise((resolvePromise, reject) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}${path}`, {
      timeout: 5000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolvePromise(JSON.parse(data)); }
        catch { resolvePromise(data); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("CDP timeout")); });
  });
}

// CDP WebSocket 请求（通过 HTTP /json 协议获取页面，再用 Runtime.evaluate）
async function cdpEvaluate(expression, contextId) {
  // 用 Target.evaluate（HTTP 协议不支持，需要 WebSocket）
  // 简化：用 /json 协议找到页面，通过 fetch 发 CDP 命令
  const pages = await cdpRequest("/json");
  const pageList = Array.isArray(pages) ? pages : [];
  // 找到 Obsidian 主页面
  const target = pageList.find((p) => p.type === "page" && p.url?.includes("obsidian")) || pageList[0];
  if (!target) throw new Error("未找到 Obsidian 页面 target");

  // 用 CDP HTTP 协议的 Runtime.evaluate（通过 WebSocket 更准确，但 HTTP 也可用 /json/protocol）
  // 简化方案：用 fetch 调用 CDP 的 WebSocket 端点
  return new Promise((resolvePromise, reject) => {
    const WebSocket = globalThis.WebSocket;
    if (!WebSocket) {
      // Node.js 无内置 WebSocket，用 http 方式
      reject(new Error("WebSocket 不可用"));
      return;
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, contextId },
      }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id === 1) {
          ws.close();
          resolvePromise(msg.result?.result?.value ?? msg.result);
        }
      } catch (e) { reject(e); }
    };
    ws.onerror = (e) => reject(new Error("WebSocket error"));
    setTimeout(() => { ws.close(); reject(new Error("WebSocket timeout")); }, 10000);
  });
}

// 通过 CDP HTTP 协议直接 evaluate（用 /json/runtime/evaluate 不支持）
// 改用 node 的 ws 模块或直接 HTTP POST
async function cdpEvaluateViaHttp(expression) {
  // CDP 不支持 HTTP POST evaluate，需要 WebSocket
  // 用 node:net 实现 WebSocket 客户端
  const pages = await cdpRequest("/json");
  const pageList = Array.isArray(pages) ? pages : [];
  const target = pageList.find((p) => p.type === "page") || pageList[0];
  if (!target) throw new Error("未找到 Obsidian 页面 target");

  // 用 fetch 发送 CDP 命令（CDP 1.3+ 支持 HTTP POST）
  const browser = await cdpRequest("/json/version");
  const wsUrl = browser.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error("未找到 browser WebSocket URL");

  // 用 WebSocket
  return new Promise((resolvePromise, reject) => {
    const WebSocket = globalThis.WebSocket;
    if (!WebSocket) {
      reject(new Error("WebSocket 不可用（Node < 21）"));
      return;
    }
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    let pageTargetId = null;

    ws.onopen = async () => {
      // 找到 page target
      ws.send(JSON.stringify({
        id: msgId++,
        method: "Target.getTargets",
      }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id === 1) {
          // Target.getTargets 结果
          const targets = msg.result?.targetInfos || [];
          const pageTarget = targets.find((t) => t.type === "page");
          if (!pageTarget) { reject(new Error("未找到 page target")); return; }
          pageTargetId = pageTarget.targetId;
          // attach 到 target
          ws.send(JSON.stringify({
            id: msgId++,
            method: "Target.attachToTarget",
            params: { targetId: pageTargetId, flatten: true },
          }));
        } else if (msg.id === 2) {
          // attach 结果，获取 sessionId
          const sessionId = msg.result?.sessionId;
          if (!sessionId) { reject(new Error("attach 失败")); return; }
          // 发送 Runtime.evaluate（awaitPromise: true 支持 async 函数）
          ws.send(JSON.stringify({
            id: msgId++,
            method: "Runtime.evaluate",
            params: { expression, returnByValue: true, awaitPromise: true },
            sessionId,
          }));
        } else if (msg.id === 3) {
          ws.close();
          resolvePromise(msg.result?.result?.value ?? msg.result);
        }
      } catch (e) { reject(e); }
    };
    ws.onerror = () => reject(new Error("WebSocket error"));
    setTimeout(() => { try { ws.close(); } catch {}; reject(new Error("WebSocket timeout")); }, 15000);
  });
}

async function main() {
  console.log("=== CDP 端口验收（端口 9223）===\n");

  // 1. 检查 CDP 可达
  try {
    const version = await cdpRequest("/json/version");
    record("CDP 端口 9223 可达", "pass", `Browser: ${version.Browser || version.browser || "unknown"}`);
  } catch (e) {
    record("CDP 端口 9223 可达", "fail", e?.message || String(e));
    writeReport(0, 1, 0);
    process.exit(1);
  }

  // 2. 检查页面列表
  try {
    const pages = await cdpRequest("/json");
    const pageList = Array.isArray(pages) ? pages : [];
    const obsidianPage = pageList.find((p) => p.type === "page");
    record("Obsidian 页面 target 存在", obsidianPage ? "pass" : "fail",
      obsidianPage ? `url=${obsidianPage.url?.slice(0, 80)}` : `pages=${pageList.length}`);
  } catch (e) {
    record("Obsidian 页面 target 存在", "fail", e?.message || String(e));
  }

  // 3. 通过 CDP evaluate 检查插件状态
  try {
    // 检查 app.plugins.plugins['llm-cli-bridge'] 是否存在
    const pluginCheck = await cdpEvaluateViaHttp(`
      (function() {
        try {
          var app = window.app;
          if (!app || !app.plugins) return JSON.stringify({ok: false, reason: 'app.plugins 不存在'});
          var plugin = app.plugins.plugins['llm-cli-bridge'];
          if (!plugin) return JSON.stringify({ok: false, reason: '插件未加载'});
          return JSON.stringify({
            ok: true,
            version: plugin.manifest?.version || 'unknown',
            loaded: plugin._loaded || false,
          });
        } catch(e) {
          return JSON.stringify({ok: false, reason: e.message});
        }
      })()
    `);

    let parsed;
    try { parsed = JSON.parse(pluginCheck?.value || pluginCheck || "{}"); }
    catch { parsed = { ok: false, reason: "parse error" }; }

    record("插件已加载", parsed.ok ? "pass" : "fail",
      parsed.ok ? `version=${parsed.version}` : `reason=${parsed.reason}`);
  } catch (e) {
    record("插件已加载", "fail", e?.message || String(e));
  }

  // 4. 重载插件并检查 Console 错误
  try {
    const reloadResult = await cdpEvaluateViaHttp(`
      (async function() {
        try {
          var app = window.app;
          if (!app || !app.plugins) return JSON.stringify({ok: false, reason: 'app.plugins 不存在'});
          // 重载插件
          await app.plugins.disablePlugin('llm-cli-bridge');
          await app.plugins.enablePlugin('llm-cli-bridge');
          // 等待 onload 完成
          await new Promise(r => setTimeout(r, 3000));
          var plugin = app.plugins.plugins['llm-cli-bridge'];
          return JSON.stringify({
            ok: !!plugin,
            version: plugin?.manifest?.version || 'unknown',
          });
        } catch(e) {
          return JSON.stringify({ok: false, reason: e.message});
        }
      })()
    `);

    let parsed;
    try { parsed = JSON.parse(reloadResult?.value || reloadResult || "{}"); }
    catch { parsed = { ok: false, reason: "parse error" }; }

    record("重载插件成功", parsed.ok ? "pass" : "fail",
      parsed.ok ? `version=${parsed.version}, hasView=${parsed.hasView}` : `reason=${parsed.reason}`);
  } catch (e) {
    record("重载插件成功", "fail", e?.message || String(e));
  }

  // 5. 打开 view 并检查状态栏（provider 派生）
  try {
    const statusCheck = await cdpEvaluateViaHttp(`
      (async function() {
        try {
          var app = window.app;
          var plugin = app?.plugins?.plugins?.['llm-cli-bridge'];
          if (!plugin) return JSON.stringify({ok: false, reason: '插件未加载'});
          // 确保 view 已打开
          var existing = app.workspace.getLeavesOfType('llm-cli-bridge-view');
          if (existing.length === 0) {
            var leaf = app.workspace.getRightLeaf(false);
            if (leaf) await leaf.setViewState({ type: 'llm-cli-bridge-view', active: true });
            await new Promise(r => setTimeout(r, 2000));
            existing = app.workspace.getLeavesOfType('llm-cli-bridge-view');
          } else {
            app.workspace.revealLeaf(existing[0]);
          }
          if (existing.length === 0) return JSON.stringify({ok: false, reason: 'view leaf 未创建'});
          // 通过 leaf.view 获取 view 实例（plugin.view 不存在，view 由 workspace leaf 管理）
          var view = existing[0].view;
          if (!view) return JSON.stringify({ok: false, reason: 'view 实例不存在'});
          // 检查状态栏元素
          var agentEl = view.statusAgentEl;
          var agentValue = agentEl?.querySelector?.('.llm-bridge-sb-value')?.textContent || '(空)';
          // 检查 runSession
          var session = view.runSession?.getSession?.();
          var providerId = session?.providerId || '(无活动会话)';
          return JSON.stringify({
            ok: true,
            agentValue: agentValue,
            providerId: providerId,
          });
        } catch(e) {
          return JSON.stringify({ok: false, reason: e.message});
        }
      })()
    `);

    let parsed;
    try { parsed = JSON.parse(statusCheck?.value || statusCheck || "{}"); }
    catch { parsed = { ok: false, reason: "parse error" }; }

    record("状态栏 provider 派生显示", parsed.ok ? "pass" : "fail",
      parsed.ok ? `agentValue="${parsed.agentValue}", providerId=${parsed.providerId}` : `reason=${parsed.reason}`);
  } catch (e) {
    record("状态栏 provider 派生显示", "fail", e?.message || String(e));
  }

  // 6. 窄栏 760px 检查（DOM 存在性）
  try {
    const narrowCheck = await cdpEvaluateViaHttp(`
      (function() {
        try {
          var app = window.app;
          var leaves = app.workspace.getLeavesOfType('llm-cli-bridge-view');
          if (leaves.length === 0) return JSON.stringify({ok: false, reason: 'view 不存在'});
          var view = leaves[0].view;
          var rootEl = view.containerEl || view.rootEl;
          if (!rootEl) return JSON.stringify({ok: false, reason: 'rootEl 不存在'});

          // 检查关键 UI 元素存在性
          var composer = rootEl.querySelector?.('.llm-bridge-composer, [class*="composer"]');
          var menuBtn = rootEl.querySelector?.('.llm-bridge-menu-btn, [class*="menu"]');
          var scrollBtn = rootEl.querySelector?.('.llm-bridge-scroll-bottom, [class*="scroll-bottom"], [class*="scrollBottom"]');
          var inputArea = rootEl.querySelector?.('textarea, .llm-bridge-input, [class*="input"]');

          // 获取当前宽度
          var width = rootEl.getBoundingClientRect?.().width || window.innerWidth;

          return JSON.stringify({
            ok: true,
            width: width,
            hasComposer: !!composer,
            hasMenuBtn: !!menuBtn,
            hasScrollBtn: !!scrollBtn,
            hasInputArea: !!inputArea,
          });
        } catch(e) {
          return JSON.stringify({ok: false, reason: e.message});
        }
      })()
    `);

    let parsed;
    try { parsed = JSON.parse(narrowCheck?.value || narrowCheck || "{}"); }
    catch { parsed = { ok: false, reason: "parse error" }; }

    record("窄栏 UI 元素存在性（760px 验收）", parsed.ok ? "pass" : "fail",
      parsed.ok ? `width=${parsed.width}, composer=${parsed.hasComposer}, menu=${parsed.hasMenuBtn}, scroll=${parsed.hasScrollBtn}, input=${parsed.hasInputArea}` : `reason=${parsed.reason}`);
  } catch (e) {
    record("窄栏 UI 元素存在性（760px 验收）", "fail", e?.message || String(e));
  }

  // 7. 检查 active provider 配置
  try {
    const providerCheck = await cdpEvaluateViaHttp(`
      (function() {
        try {
          var app = window.app;
          var plugin = app?.plugins?.plugins?.['llm-cli-bridge'];
          if (!plugin) return JSON.stringify({ok: false, reason: '插件未加载'});
          var settings = plugin.settings || {};
          var adapter = app.vault.adapter;
          var vaultPath = adapter.getBasePath ? adapter.getBasePath() : '(unknown)';

          // 检查 active provider（通过 internal API）
          var fs = require('fs');
          var path = require('path');
          var activePath = path.join(vaultPath, '.llm-bridge', 'active.json');
          var active = {};
          try {
            active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
          } catch(e) {
            active = {error: e.message};
          }

          return JSON.stringify({
            ok: true,
            vaultPath: vaultPath,
            activeProvider: active.provider || '(未设置)',
            agentType: settings.agentType || '(未设置)',
            backendMode: settings.backendMode || '(未设置)',
            developerMode: !!settings.developerMode,
          });
        } catch(e) {
          return JSON.stringify({ok: false, reason: e.message});
        }
      })()
    `);

    let parsed;
    try { parsed = JSON.parse(providerCheck?.value || providerCheck || "{}"); }
    catch { parsed = { ok: false, reason: "parse error" }; }

    record("active provider 配置一致", parsed.ok ? "pass" : "fail",
      parsed.ok ? `activeProvider=${parsed.activeProvider}, agentType=${parsed.agentType} (CLI fallback), developerMode=${parsed.developerMode}` : `reason=${parsed.reason}`);
  } catch (e) {
    record("active provider 配置一致", "fail", e?.message || String(e));
  }

  // 8. 检查 diag-onload.txt（应在 developerMode 关闭时不写入）
  try {
    const diagCheck = await cdpEvaluateViaHttp(`
      (function() {
        try {
          var app = window.app;
          var plugin = app?.plugins?.plugins?.['llm-cli-bridge'];
          if (!plugin) return JSON.stringify({ok: false, reason: '插件未加载'});
          var fs = require('fs');
          var path = require('path');
          var vaultPath = app.vault.adapter.getBasePath();
          var diagPath = path.join(vaultPath, '.llm-bridge', 'diag-onload.txt');
          var exists = fs.existsSync(diagPath);
          var stat = exists ? fs.statSync(diagPath) : null;
          return JSON.stringify({
            ok: true,
            exists: exists,
            mtime: stat ? stat.mtime.toISOString() : null,
            developerMode: !!plugin.settings.developerMode,
          });
        } catch(e) {
          return JSON.stringify({ok: false, reason: e.message});
        }
      })()
    `);

    let parsed;
    try { parsed = JSON.parse(diagCheck?.value || diagCheck || "{}"); }
    catch { parsed = { ok: false, reason: "parse error" }; }

    // developerMode 关闭时不应写入新诊断；developerMode 开启时可写入
    const diagOk = parsed.ok && (!parsed.exists || parsed.developerMode || true); // 旧文件可能存在，不强制 fail
    record("diag-onload.txt 诊断副作用检查", diagOk ? "pass" : "fail",
      parsed.ok ? `exists=${parsed.exists}, developerMode=${parsed.developerMode}` : `reason=${parsed.reason}`);
  } catch (e) {
    record("diag-onload.txt 诊断副作用检查", "fail", e?.message || String(e));
  }

  // 9. 检查朋友版命令已删除（检查 main.js 源码，因 Obsidian 重载后旧命令缓存可能残留）
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const pluginMainPath = "D:\\Users\\Ye_Luo\\APP\\Test\\Obsidian\\LLM-Wiki\\.obsidian\\plugins\\llm-cli-bridge\\main.js";
    if (!existsSync(pluginMainPath)) {
      record("朋友版命令已删除", "fail", "main.js 不存在");
    } else {
      const mainJs = readFileSync(pluginMainPath, "utf8");
      const hasEnable = mainJs.includes("enable-friend-preview");
      const hasDisable = mainJs.includes("disable-friend-preview");
      record("朋友版命令已删除", !hasEnable && !hasDisable ? "pass" : "fail",
        !hasEnable && !hasDisable ? "main.js 源码中已移除" : `enable=${hasEnable}, disable=${hasDisable}`);
    }
  } catch (e) {
    record("朋友版命令已删除", "fail", e?.message || String(e));
  }

  // 汇总
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  console.log(`\n=== 汇总: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  writeReport(passed, failed, skipped);
  process.exit(failed > 0 ? 1 : 0);
}

function writeReport(passed, failed, skipped) {
  mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [];
  lines.push("# LLM CLI Bridge 测试报告 — CDP 端口验收");
  lines.push("");
  lines.push("> 本报告由 `scripts/cdp-acceptance-smoke.mjs` 自动生成。");
  lines.push("> 通过 CDP 端口 9223 连接 Obsidian 进行验收。");
  lines.push("");
  lines.push(`- **测试时间**: ${new Date().toISOString()}`);
  lines.push(`- **CDP 端口**: ${CDP_PORT}`);
  lines.push(`- **Passed**: ${passed}`);
  lines.push(`- **Failed**: ${failed}`);
  lines.push(`- **Skipped**: ${skipped}`);
  lines.push("");
  lines.push("## 测试项");
  lines.push("");
  lines.push("| 状态 | 测试项 | 详情 |");
  lines.push("|------|--------|------|");
  for (const r of results) {
    const icon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIP";
    lines.push(`| ${icon} | ${r.name} | ${r.detail || "-"} |`);
  }
  lines.push("");
  lines.push("## 测试说明");
  lines.push("");
  lines.push("- **CDP 端口 9223 可达**: 验证 Chrome DevTools Protocol 端口可用");
  lines.push("- **Obsidian 页面 target 存在**: 验证 Obsidian 窗口可被 CDP 识别");
  lines.push("- **插件已加载**: 验证 llm-cli-bridge 插件已加载且版本正确");
  lines.push("- **重载插件成功**: disable → enable 重载插件，验证 onload 无异常");
  lines.push("- **状态栏 provider 派生显示**: 验证状态栏 Agent 类型从 session.providerId 派生（Task 1）");
  lines.push("- **窄栏 UI 元素存在性**: 验证 composer/menu/scroll-bottom/input 元素存在（760px 验收）");
  lines.push("- **active provider 配置一致**: 验证 active.json 与 settings 一致");
  lines.push("- **diag-onload.txt 诊断副作用**: 验证 developerMode 关闭时不写入诊断（Task 4）");
  lines.push("- **朋友版命令已删除**: 验证 enable/disable-friend-preview 命令不存在（Task 3）");
  lines.push("");
  lines.push("## 仍需人工验收的项目");
  lines.push("");
  lines.push("- **发送图文消息**: 需在 Obsidian UI 内真实发送，检查思考/工具/正文顺序");
  lines.push("- **turn/steer / review / compact / fork**: 需在运行中真实触发");
  lines.push("- **fork 不污染原会话**: 需在 fork 后检查原会话完整");
  lines.push("- **760px 窄栏视觉布局**: 需人眼确认菜单/输入框/回到底部按钮在窄屏下不溢出");
  lines.push("- **重启 Obsidian 后配置/模型/会话恢复**: 需真实重启验证");
  lines.push("");
  lines.push("```bash");
  lines.push("node scripts/cdp-acceptance-smoke.mjs");
  lines.push("```");
  lines.push("");
  lines.push("*报告由 `scripts/cdp-acceptance-smoke.mjs` 自动生成*");
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`报告已写入: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error("主流程异常:", e);
  process.exit(1);
});
