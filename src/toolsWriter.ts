// LLM CLI Bridge — 写出 helper mjs 到 .llm-bridge/tools/obsidian-action.mjs
// Claude Code 可直接 import 或 CLI 调用该 helper 与 Obsidian 交互

import * as fs from "fs";
import * as path from "path";

export const TOOLS_DIR_REL = ".llm-bridge/tools";
export const HELPER_FILE_NAME = "obsidian-action.mjs";

// helper 的源码（ESM）。保持自包含、零外部依赖，仅用 node 内置模块 + 全局 fetch。
const HELPER_SOURCE = `// LLM CLI Bridge — Obsidian Action Helper
// 由 llm-cli-bridge 插件自动生成。读取 .llm-bridge/bridge.json，向插件 HTTP server 发请求。
// 用法：
//   import { createClient } from "./.llm-bridge/tools/obsidian-action.mjs";
//   const client = createClient();            // 默认读取 process.cwd()/.llm-bridge/bridge.json
//   await client.health();
//   await client.state();
//   await client.action("show_notice", { message: "hi" });
//   await client.createNote("90_AI整理待确认/x.md", "# title");
// CLI：
//   node .llm-bridge/tools/obsidian-action.mjs health
//   node .llm-bridge/tools/obsidian-action.mjs state
//   node .llm-bridge/tools/obsidian-action.mjs show_notice '{"message":"hi"}'
//   node .llm-bridge/tools/obsidian-action.mjs create_note '{"path":"a.md","content":"# a"}'

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

// V1.0.1: 每次调用都读取最新 bridge.json，避免使用陈旧 port/token
export function loadBridge(vaultPath) {
  const root = vaultPath || process.env.BRIDGE_VAULT || process.cwd();
  const bridgePath = join(root, ".llm-bridge", "bridge.json");
  try {
    return JSON.parse(readFileSync(bridgePath, "utf8"));
  } catch (e) {
    throw new Error("无法读取 " + bridgePath + " : " + (e && e.message || e) + "。请确认 Obsidian 与 llm-cli-bridge 插件已启动。");
  }
}

// V1.0.1: 判断是否需要重读 bridge.json 重试（401/403/ECONNREFUSED/timeout）
function shouldRetry(status, err) {
  // HTTP 401/403：token 陈旧
  if (status === 401 || status === 403) return true;
  // 网络错误：ECONNREFUSED（端口陈旧）/ timeout（abort）
  if (err) {
    const msg = (err && err.message) || String(err);
    if (msg.includes("ECONNREFUSED")) return true;
    if (msg.includes("aborted") || msg.includes("timeout") || msg.includes("ETIMEDOUT")) return true;
  }
  return false;
}

async function reqOnce(bridge, method, pathname, body, timeoutMs) {
  const url = "http://" + bridge.host + ":" + bridge.port + pathname;
  const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + bridge.token };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
  const init = { method, headers, signal: controller.signal };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    const res = await fetch(url, init);
    clearTimeout(timer);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    clearTimeout(timer);
    // 重新抛出，让外层判断是否重试
    const err = new Error((e && e.message) || String(e));
    err.cause = e;
    err.isNetworkError = true;
    throw err;
  }
}

// V1.0.1: 带重试的请求 —— 遇到 401/403/ECONNREFUSED/timeout 时重读 bridge.json 重试一次
async function reqWithRetry(vaultPath, method, pathname, body, timeoutMs) {
  let bridge = loadBridge(vaultPath);
  try {
    return await reqOnce(bridge, method, pathname, body, timeoutMs);
  } catch (e) {
    if (shouldRetry(null, e)) {
      // 重读 bridge.json 并重试一次
      bridge = loadBridge(vaultPath);
      return await reqOnce(bridge, method, pathname, body, timeoutMs);
    }
    throw e;
  }
}

// 包装返回响应以支持重试检测
async function reqWithRetryHandleStatus(vaultPath, method, pathname, body, timeoutMs) {
  let bridge = loadBridge(vaultPath);
  let res;
  try {
    res = await reqOnce(bridge, method, pathname, body, timeoutMs);
  } catch (e) {
    if (shouldRetry(null, e)) {
      bridge = loadBridge(vaultPath);
      res = await reqOnce(bridge, method, pathname, body, timeoutMs);
    } else {
      throw e;
    }
  }
  // 检查 HTTP 状态码是否需要重试
  if (shouldRetry(res.status, null)) {
    bridge = loadBridge(vaultPath);
    res = await reqOnce(bridge, method, pathname, body, timeoutMs);
  }
  return res;
}

export function createClient(vaultPath) {
  const _vaultPath = vaultPath;
  // V1.0.1: 每次调用都重新读取 bridge.json（通过 reqWithRetryHandleStatus）
  const action = (type, params, id) => reqWithRetryHandleStatus(_vaultPath, "POST", "/action", { type, params, id });
  const actionStatus = (actionId) => reqWithRetryHandleStatus(_vaultPath, "GET", "/action-status?id=" + encodeURIComponent(actionId));
  return {
    // 暴露当前 bridge 信息（每次访问都读最新）
    get bridge() { return loadBridge(_vaultPath); },
    health: () => reqWithRetryHandleStatus(_vaultPath, "GET", "/health"),
    state: () => reqWithRetryHandleStatus(_vaultPath, "GET", "/state"),
    action,
    actionStatus,
    batch: (actions) => reqWithRetryHandleStatus(_vaultPath, "POST", "/batch", { actions }),
    // 便捷方法
    showNotice: (message) => action("show_notice", { message }),
    openNote: (path) => action("open_note", { path }),
    getState: () => action("get_state"),
    getActiveNote: () => action("get_active_note"),
    getSelection: () => action("get_selection"),
    createNote: (path, content) => action("create_note", { path, content }),
    appendToNote: (path, content) => action("append_to_note", { path, content }),
    insertAtCursor: (content) => action("insert_at_cursor", { content }),
    replaceSelection: (content) => action("replace_selection", { content }),
  };
}

// CLI 入口
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const client = createClient();
  const args = process.argv.slice(2);
  const flags = { wait: false, json: false, timeout: null };
  const posArgs = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--wait") { flags.wait = true; }
    else if (a === "--json") { flags.json = true; }
    else if (a === "--timeout" && i + 1 < args.length) { flags.timeout = parseInt(args[++i], 10) * 1000; }
    else if (a === "--help" || a === "-h") {
      console.error("用法:");
      console.error("  node obsidian-action.mjs health                       # 健康检查");
      console.error("  node obsidian-action.mjs state                        # 获取状态");
      console.error("  node obsidian-action.mjs <type> [json]                # 执行 action");
      console.error("  node obsidian-action.mjs --wait <type> [json]        # 执行并等待确认结果");
      console.error("  node obsidian-action.mjs --timeout <sec> <type> [json] # 等待超时（秒）");
      console.error("  node obsidian-action.mjs --json <type> [json]          # 输出原始 JSON");
      console.error("");
      console.error('示例:');
      console.error('  node obsidian-action.mjs show_notice ' + "'" + '{"message":"hi"}' + "'");
      console.error('  node obsidian-action.mjs create_note ' + "'" + '{"path":"a.md","content":"# a"}' + "'");
      console.error('  node obsidian-action.mjs --wait create_note ' + "'" + '{"path":"a.md","content":"# a"}' + "'");
      console.error('  node obsidian-action.mjs --timeout 60 --wait create_note ' + "'" + '{"path":"a.md","content":"# a"}' + "'");
      process.exit(0);
    } else {
      posArgs.push(a);
    }
  }

  const type = posArgs[0];
  const paramsStr = posArgs[1];
  if (!type) {
    console.error("用法: node obsidian-action.mjs <health|state|<type>> [--wait] [--timeout N] [--json] [json-params]");
    console.error("用 --help 查看完整帮助");
    process.exit(1);
  }
  try {
    let r;
    if (type === "health") r = await client.health();
    else if (type === "state") r = await client.state();
    else {
      const params = paramsStr ? JSON.parse(paramsStr) : {};
      r = await client.action(type, params);
    }
    const outputJson = () => console.log(JSON.stringify(r, null, 2));
    // 非修改类 action 或 --json：直接输出
    // 修改类 action（与 actions.ts MODIFYING_ACTIONS 同步，否则 --wait 失效）
    const modifying = ["create_note","append_to_note","insert_at_cursor","replace_selection","property_set","daily_append","vault_delete","vault_rename","vault_restore","rename_tag","command_run"].includes(type);
    if (!modifying || flags.json) {
      if (r && r.ok === false) { if (!flags.json) console.error("Action 失败:", r.data?.error || r.data); outputJson(); process.exit(1); }
      outputJson();
      process.exit(0);
    }
    // 修改类 action，无 --wait：直接输出 pending 信息
    if (!flags.wait) {
      if (r && r.ok === true && r.data?.status === "pending_approval") {
        if (flags.json) { outputJson(); }
        else { console.log("Action 已提交，等待确认。actionId:", r.data.id); }
        process.exit(0);
      }
      outputJson();
      process.exit(r && r.ok === false ? 1 : 0);
    }
    // --wait：轮询直到终态
    if (r && r.ok === true && r.data?.status === "pending_approval") {
      const actionId = r.data.id;
      const startMs = Date.now();
      const maxMs = flags.timeout || 300000; // 默认 5 分钟
      while (Date.now() - startMs < maxMs) {
        await new Promise((res) => setTimeout(res, 1500));
        const s = await client.actionStatus(actionId);
        if (s && s.data && s.data.status !== "pending_approval") {
          const finalResult = s.data;
          if (flags.json) { console.log(JSON.stringify(finalResult, null, 2)); }
          else {
            if (finalResult.status === "completed" && !finalResult.error) {
              console.log("Action 已完成。actionId:", actionId);
            } else if (finalResult.error) {
              console.error("Action 失败:", finalResult.error, "| actionId:", actionId);
            } else {
              console.log("Action 状态:", finalResult.status, "| actionId:", actionId);
            }
          }
          process.exit(finalResult.status === "completed" && !finalResult.error ? 0 : 1);
        }
      }
      console.error("等待超时（" + (maxMs / 1000) + "s）。actionId:", actionId);
      process.exit(1);
    }
    outputJson();
    process.exit(r && r.ok === false ? 1 : 0);
  } catch (e) {
    const msg = e && e.message || String(e);
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("aborted")) {
      console.error("无法连接到 Obsidian Bridge（网络错误或请求超时）。");
      console.error("请确认:");
      console.error("  1. Obsidian 已启动");
      console.error("  2. llm-cli-bridge 插件已启用");
      console.error("  3. 插件 HTTP Server 已正常启动");
    } else if (msg.includes("bridge.json")) {
      console.error("未找到 Bridge 配置。请确认插件已启动。");
    } else {
      console.error("错误:", msg);
    }
    process.exit(1);
  }
}
`;

export async function writeHelper(vaultPath: string): Promise<string> {
  const dir = path.join(vaultPath, TOOLS_DIR_REL);
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, HELPER_FILE_NAME);
  await fs.promises.writeFile(filePath, HELPER_SOURCE, "utf8");
  return filePath;
}
