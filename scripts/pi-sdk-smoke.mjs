// LLM CLI Bridge — Pi SDK Real Smoke (V17-B1 任务 G)
//
// 真实 @earendil-works/pi-coding-agent 环境下验证：
// - createAgentSession
// - prompt
// - text_delta
// - read-only tool
// - abort
//
// 没环境时明确 skip：
// - piSdkSmokeStatus=skip
// - reason=package not installed / no auth
//
// 运行：npm run smoke:pi-sdk

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const PROJECT_ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\//, "").replace(/^[A-Za-z]:/, (m) => m.toUpperCase() || "C")).replace(/^[a-z]:/, (m) => m.toUpperCase());

console.log("=== Pi SDK Real Smoke ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log("");

// 1. 检查 package.json optionalDependencies
const pkgJson = JSON.parse(
  await import("node:fs").then(({ readFileSync }) => readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")),
);
const hasOptionalDep = pkgJson.optionalDependencies?.["@earendil-works/pi-coding-agent"];
console.log(`package.json optionalDependencies: ${hasOptionalDep || "(missing)"}`);

// 2. 尝试动态 import SDK
let sdk = null;
let importError = null;
try {
  sdk = require("@earendil-works/pi-coding-agent");
  console.log(`SDK loaded: ${typeof sdk.createAgentSession === "function" ? "ok" : "API surface missing"}`);
} catch (e) {
  importError = e;
  console.log(`SDK load failed: ${e?.code || e?.message || String(e)}`);
}

if (!sdk || typeof sdk.createAgentSession !== "function") {
  console.log("");
  console.log("=== SKIP: Pi SDK not installed ===");
  console.log("piSdkSmokeStatus=skip");
  console.log(`reason=${sdk ? "load-error (createAgentSession export missing)" : "package not installed"}`);
  console.log(`hint=npm install --ignore-scripts @earendil-works/pi-coding-agent`);
  process.exit(0);
}

// 3. 检查认证
let authStorage = null;
let hasAuth = false;
try {
  if (sdk.AuthStorage?.create) {
    authStorage = sdk.AuthStorage.create();
    if (typeof authStorage.hasConfiguredAuth === "function") {
      hasAuth = authStorage.hasConfiguredAuth();
    }
  }
} catch (e) {
  console.log(`Auth probe failed: ${e?.message || String(e)}`);
}

if (!hasAuth) {
  console.log("");
  console.log("=== SKIP: Pi SDK auth not configured ===");
  console.log("piSdkSmokeStatus=skip");
  console.log("reason=no auth (please run `pi login` or configure ~/.pi/agent API key)");
  process.exit(0);
}

// 4. 检查模型
let modelRegistry = null;
let hasModel = false;
try {
  if (sdk.ModelRegistry?.create && authStorage) {
    modelRegistry = sdk.ModelRegistry.create(authStorage);
    if (typeof modelRegistry.list === "function") {
      const models = modelRegistry.list();
      hasModel = models.length > 0;
      console.log(`Available models: ${models.length}`);
    }
  }
} catch (e) {
  console.log(`Model probe failed: ${e?.message || String(e)}`);
}

if (!hasModel) {
  console.log("");
  console.log("=== SKIP: Pi SDK model not selected ===");
  console.log("piSdkSmokeStatus=skip");
  console.log("reason=no model (please select model in plugin settings)");
  process.exit(0);
}

// 5. 真实 smoke：createAgentSession + prompt + subscribe + abort
console.log("");
console.log("=== Running real smoke ===");

let session = null;
let unsubscribe = null;
let textChunks = [];
let toolEvents = [];
let agentEnded = false;
let errors = [];

try {
  const sessionManager = sdk.SessionManager?.inMemory ? sdk.SessionManager.inMemory() : undefined;
  const settingsManager = sdk.SettingsManager?.inMemory ? sdk.SettingsManager.inMemory({ compaction: { enabled: false } }) : undefined;

  const result = await sdk.createAgentSession({
    cwd: PROJECT_ROOT,
    tools: ["read"],
    thinkingLevel: "minimal",
    sessionManager,
    authStorage,
    modelRegistry,
    settingsManager,
  });
  session = result.session;
  console.log(`Session created: ${session.sessionId}`);

  unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      textChunks.push(event.assistantMessageEvent.delta);
    } else if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
      toolEvents.push({ type: event.type, toolName: event.toolName });
    } else if (event.type === "agent_end") {
      agentEnded = true;
    } else if (event.type === "error") {
      errors.push(event.error || event.finalError || "unknown error");
    }
  });

  // 发送简单 prompt（read-only 任务）
  console.log("Sending prompt...");
  await session.prompt("列出当前目录的 package.json 文件名（使用 read 工具读取）");
  console.log("Prompt completed.");

  // 主动 abort（测试 abort 路径，不影响已完成 run）
  if (session.isStreaming) {
    console.log("Aborting streaming session...");
    await session.abort();
  }
} catch (e) {
  console.log(`Smoke failed: ${e?.stack || e?.message || String(e)}`);
  process.exit(1);
} finally {
  try { if (unsubscribe) unsubscribe(); } catch { /* ignore */ }
  try { if (session) session.dispose(); } catch { /* ignore */ }
}

// 6. 报告结果
console.log("");
console.log("=== Smoke Results ===");
console.log(`text_chunks: ${textChunks.length}`);
console.log(`text_preview: ${textChunks.join("").slice(0, 200)}`);
console.log(`tool_events: ${toolEvents.length}`);
console.log(`agent_ended: ${agentEnded}`);
console.log(`errors: ${errors.length}`);
if (errors.length > 0) {
  console.log(`error_details: ${errors.join("; ")}`);
}

const smokePassed = textChunks.length > 0 && agentEnded && errors.length === 0;
console.log("");
if (smokePassed) {
  console.log("=== PASS: Pi SDK real smoke ===");
  console.log("piSdkSmokeStatus=pass");
  process.exit(0);
} else {
  console.log("=== FAIL: Pi SDK real smoke ===");
  console.log(`piSdkSmokeStatus=fail (text=${textChunks.length}, agentEnded=${agentEnded}, errors=${errors.length})`);
  process.exit(1);
}
