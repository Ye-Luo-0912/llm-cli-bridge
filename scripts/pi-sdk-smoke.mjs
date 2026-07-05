// LLM CLI Bridge — Pi SDK Real Smoke (V17-C 任务 F)
//
// 两组 smoke：
// - read-only smoke：tools=["read"]，验证 createAgentSession + prompt + text_delta + agent_end
// - pi-native smoke：不传 tools（用 Pi 默认），验证 native tool execution
//
// 没环境时明确 skip：
// - piSdkSmokeStatus=skip
// - reason=package not installed / no auth / no model
//
// friend-ready gate：pi-native smoke pass 才能标 friend-ready
//
// 运行：npm run smoke:pi-sdk

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== Pi SDK Real Smoke (V17-C) ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log("");

// 1. 检查 package.json optionalDependencies
const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
const hasOptionalDep = pkgJson.optionalDependencies?.["@earendil-works/pi-coding-agent"];
console.log(`package.json optionalDependencies: ${hasOptionalDep || "(missing)"}`);

// 2. 尝试动态 import SDK
//    SDK 是 ESM-only（package.json type=module + exports 仅 import），不能用 require()。
//    先用 require.resolve 探测安装状态（穿透 exports map），失败则再探测包目录是否存在。
let sdk = null;
let sdkLoadError = null;
let sdkInstalled = false;
try {
  require.resolve("@earendil-works/pi-coding-agent");
  sdkInstalled = true;
} catch {
  // require.resolve 在纯 ESM 包上也可能失败；用 node_modules 物理路径作 fallback。
  const candidate = join(PROJECT_ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  if (existsSync(candidate)) {
    sdkInstalled = true;
    console.log(`SDK package.json found at ${candidate}`);
  }
}

if (sdkInstalled) {
  try {
    sdk = await import("@earendil-works/pi-coding-agent");
    console.log(`SDK loaded: ${typeof sdk.createAgentSession === "function" ? "ok" : "API surface missing"}`);
  } catch (e) {
    sdkLoadError = e;
    console.log(`SDK load failed: ${e?.code || e?.message || String(e)}`);
  }
} else {
  console.log("SDK not installed (require.resolve + node_modules fallback both failed)");
}

if (!sdk || typeof sdk.createAgentSession !== "function") {
  console.log("");
  console.log("=== SKIP: Pi SDK not installed ===");
  console.log("piSdkSmokeStatus=skip");
  console.log("piReadOnlySmokeStatus=skip");
  console.log("piNativeSmokeStatus=skip");
  console.log("friendReady=false");
  const reason = !sdkInstalled
    ? "package not installed"
    : (sdkLoadError ? `load-error (${sdkLoadError.code || sdkLoadError.message})` : "load-error (createAgentSession export missing)");
  console.log(`reason=${reason}`);
  console.log(`hint=npm install --ignore-scripts @earendil-works/pi-coding-agent`);
  process.exit(0);
}

// 3. V17-C 任务 C：检查认证（用 getAvailable 或 list）
let authStorage = null;
let modelRegistry = null;
let hasAuth = false;
let hasModel = false;
try {
  if (sdk.AuthStorage?.create) {
    authStorage = sdk.AuthStorage.create();
  }
  if (sdk.ModelRegistry?.create && authStorage) {
    modelRegistry = sdk.ModelRegistry.create(authStorage);
  }
  // V17-C 任务 C：优先用 getAvailable()
  if (modelRegistry && typeof modelRegistry.getAvailable === "function") {
    const available = modelRegistry.getAvailable();
    hasModel = available.length > 0;
    hasAuth = hasModel; // getAvailable 返回已配置 auth 的模型
    console.log(`getAvailable() returned ${available.length} models`);
  } else if (modelRegistry && typeof modelRegistry.list === "function") {
    const all = modelRegistry.list();
    hasModel = all.length > 0;
    if (hasModel && authStorage && typeof authStorage.hasConfiguredAuth === "function") {
      const first = all[0];
      try {
        hasAuth = authStorage.hasConfiguredAuth({ provider: first.provider, id: first.id });
      } catch {
        hasAuth = false;
      }
    }
    console.log(`list() returned ${all.length} models`);
  }
} catch (e) {
  console.log(`Auth/model probe failed: ${e?.message || String(e)}`);
}

if (!hasAuth || !hasModel) {
  console.log("");
  console.log("=== SKIP: Pi SDK auth/model not configured ===");
  console.log("piSdkSmokeStatus=skip");
  console.log("piReadOnlySmokeStatus=skip");
  console.log("piNativeSmokeStatus=skip");
  console.log("friendReady=false");
  console.log(`reason=${!hasAuth && !hasModel ? "no auth and no model" : (!hasAuth ? "no auth" : "no model")}`);
  console.log("hint=请在 ~/.pi/agent 配置 API Key 或运行 pi login，并在插件设置中选择 model");
  process.exit(0);
}

// 共享：跑一组 smoke
async function runSmokeGroup({ name, sessionOpts, expectToolEvents }) {
  console.log("");
  console.log(`=== Running smoke: ${name} ===`);
  let session = null;
  let unsubscribe = null;
  const textChunks = [];
  const toolEvents = [];
  let agentEnded = false;
  const errors = [];
  try {
    const sessionManager = sdk.SessionManager?.inMemory ? sdk.SessionManager.inMemory() : undefined;
    const settingsManager = sdk.SettingsManager?.inMemory ? sdk.SettingsManager.inMemory({ compaction: { enabled: false } }) : undefined;
    const result = await sdk.createAgentSession({
      cwd: PROJECT_ROOT,
      thinkingLevel: "minimal",
      sessionManager,
      authStorage,
      modelRegistry,
      settingsManager,
      ...sessionOpts,
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

    const promptText = expectToolEvents
      ? "使用 read 工具读取 package.json 文件名，然后简要说明"
      : "请用一句话介绍你自己";
    console.log(`Sending prompt: ${promptText}`);
    await session.prompt(promptText);
    console.log("Prompt completed.");

    if (session.isStreaming) {
      console.log("Aborting streaming session...");
      await session.abort();
    }
  } catch (e) {
    console.log(`Smoke ${name} failed: ${e?.stack || e?.message || String(e)}`);
    return { name, passed: false, textChunks, toolEvents, agentEnded, errors, error: String(e) };
  } finally {
    try { if (unsubscribe) unsubscribe(); } catch { /* ignore */ }
    try { if (session) session.dispose(); } catch { /* ignore */ }
  }

  const passed = textChunks.length > 0 && agentEnded && errors.length === 0;
  return { name, passed, textChunks, toolEvents, agentEnded, errors };
}

// 4. 跑两组 smoke
const results = [];

// 4a. read-only smoke
results.push(await runSmokeGroup({
  name: "read-only",
  sessionOpts: { tools: ["read"] },
  expectToolEvents: true,
}));

// 4b. pi-native smoke（不传 tools，用 Pi 默认配置）
results.push(await runSmokeGroup({
  name: "pi-native",
  sessionOpts: {},
  expectToolEvents: false,
}));

// 5. 报告结果
console.log("");
console.log("=== Smoke Results ===");
for (const r of results) {
  console.log(`[${r.name}] passed=${r.passed} text_chunks=${r.textChunks.length} tool_events=${r.toolEvents.length} agent_ended=${r.agentEnded} errors=${r.errors.length}${r.error ? " error=" + r.error : ""}`);
  if (r.textChunks.length > 0) {
    console.log(`  text_preview: ${r.textChunks.join("").slice(0, 120)}`);
  }
  if (r.errors.length > 0) {
    console.log(`  error_details: ${r.errors.join("; ")}`);
  }
}

const allPassed = results.every((r) => r.passed);
const readOnlyPassed = results[0]?.passed === true;
const piNativePassed = results[1]?.passed === true;

console.log("");
if (allPassed) {
  console.log("=== PASS: Pi SDK real smoke (both groups) ===");
  console.log("piSdkSmokeStatus=pass");
  console.log("piReadOnlySmokeStatus=" + (readOnlyPassed ? "pass" : "fail"));
  console.log("piNativeSmokeStatus=" + (piNativePassed ? "pass" : "fail"));
  console.log("friendReady=" + (piNativePassed ? "true" : "false"));
  process.exit(0);
} else {
  console.log("=== FAIL: Pi SDK real smoke (one or more groups failed) ===");
  console.log("piSdkSmokeStatus=fail");
  console.log("piReadOnlySmokeStatus=" + (readOnlyPassed ? "pass" : "fail"));
  console.log("piNativeSmokeStatus=" + (piNativePassed ? "pass" : "fail"));
  console.log("friendReady=false");
  process.exit(1);
}
