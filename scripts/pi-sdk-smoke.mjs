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
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== Pi SDK Real Smoke (V17-C) ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log("");

// 1. 检查 package.json optionalDependencies
const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
const hasOptionalDep = pkgJson.optionalDependencies?.["@earendil-works/pi-coding-agent"];
console.log(`package.json optionalDependencies: ${hasOptionalDep || "(missing)"}`);

// 2. 尝试动态 import SDK（SDK 是纯 ESM，必须用 await import，不能用 require）
let sdk = null;
let importError = null;
try {
  sdk = await import("@earendil-works/pi-coding-agent");
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

// 3. V17-D：检查认证（标准 Pi auth 优先，fallback 到 env var / Claude Code settings）
//    支持环境变量覆盖：
//      PI_SMOKE_PROVIDER (default "anthropic")
//      PI_SMOKE_API_KEY   (e.g. sk-...)
//      PI_SMOKE_BASE_URL  (e.g. https://us.pinai-cn.com)
//      PI_SMOKE_MODEL     (e.g. claude-haiku-4-5)
//    Fallback：~/.claude/settings.json 的 env.ANTHROPIC_AUTH_TOKEN + env.ANTHROPIC_BASE_URL
let authStorage = null;
let modelRegistry = null;
let hasAuth = false;
let hasModel = false;
let explicitModel = null; // 显式指定 model（覆盖 SDK 默认选择）
const smokeProvider = process.env.PI_SMOKE_PROVIDER || "anthropic";

try {
  if (sdk.AuthStorage?.create) {
    authStorage = sdk.AuthStorage.create();
  }
  if (sdk.ModelRegistry?.create && authStorage) {
    modelRegistry = sdk.ModelRegistry.create(authStorage);
  }

  // 3a. 标准 Pi auth（~/.pi/agent/auth.json）
  if (modelRegistry && typeof modelRegistry.getAvailable === "function") {
    const available = modelRegistry.getAvailable();
    hasModel = available.length > 0;
    hasAuth = hasModel;
    console.log(`Pi auth getAvailable() returned ${available.length} models`);
  }

  // 3b. Fallback 1：环境变量 PI_SMOKE_API_KEY / PI_SMOKE_BASE_URL
  if (!hasAuth) {
    const envKey = process.env.PI_SMOKE_API_KEY;
    const envBaseUrl = process.env.PI_SMOKE_BASE_URL;
    const envModel = process.env.PI_SMOKE_MODEL;
    if (envKey && authStorage) {
      console.log(`Using PI_SMOKE_API_KEY (provider=${smokeProvider}, baseUrl=${envBaseUrl || "(default)"}, model=${envModel || "(auto)"})`);
      authStorage.setRuntimeApiKey(smokeProvider, envKey);
      if (envBaseUrl && modelRegistry && typeof modelRegistry.registerProvider === "function") {
        modelRegistry.registerProvider(smokeProvider, { baseUrl: envBaseUrl });
      }
      if (envModel && modelRegistry && typeof modelRegistry.find === "function") {
        explicitModel = modelRegistry.find(smokeProvider, envModel);
      }
      const available = modelRegistry?.getAvailable?.() ?? [];
      hasModel = available.length > 0;
      hasAuth = hasModel;
      console.log(`env var auth getAvailable() returned ${available.length} models`);
    }
  }

  // 3c. Fallback 2：~/.claude/settings.json 的 env 字段（Claude Code 兼容）
  if (!hasAuth) {
    const claudeSettingsPath = join(homedir(), ".claude", "settings.json");
    if (existsSync(claudeSettingsPath)) {
      try {
        const claudeSettings = JSON.parse(readFileSync(claudeSettingsPath, "utf8"));
        const env = claudeSettings.env || {};
        // Anthropic provider: ANTHROPIC_AUTH_TOKEN (Claude Code 命名) → setRuntimeApiKey("anthropic", ...)
        const authToken = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
        const baseUrl = env.ANTHROPIC_BASE_URL;
        if (authToken && authStorage && smokeProvider === "anthropic") {
          console.log(`Using ~/.claude/settings.json env (ANTHROPIC_AUTH_TOKEN present, baseUrl=${baseUrl || "(default)"})`);
          authStorage.setRuntimeApiKey("anthropic", authToken);
          if (baseUrl && modelRegistry && typeof modelRegistry.registerProvider === "function") {
            modelRegistry.registerProvider("anthropic", { baseUrl });
          }
          const available = modelRegistry?.getAvailable?.() ?? [];
          hasModel = available.length > 0;
          hasAuth = hasModel;
          console.log(`Claude settings auth getAvailable() returned ${available.length} models`);
        }
      } catch (e) {
        console.log(`~/.claude/settings.json parse failed: ${e?.message || String(e)}`);
      }
    }
  }
} catch (e) {
  console.log(`Auth/model probe failed: ${e?.message || String(e)}`);
}

if (!hasAuth || !hasModel) {
  console.log("");
  console.log("=== SKIP: Pi SDK auth/model not configured ===");
  console.log("piSdkSmokeStatus=skip");
  console.log(`reason=${!hasAuth && !hasModel ? "no auth and no model" : (!hasAuth ? "no auth" : "no model")}`);
  console.log("hint=配置方式任选其一：");
  console.log("  1) ~/.pi/agent/auth.json 配置 API Key");
  console.log("  2) 环境变量 PI_SMOKE_API_KEY / PI_SMOKE_BASE_URL / PI_SMOKE_MODEL");
  console.log("  3) ~/.claude/settings.json 的 env.ANTHROPIC_AUTH_TOKEN + env.ANTHROPIC_BASE_URL");
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
      ...(explicitModel ? { model: explicitModel } : {}),
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
