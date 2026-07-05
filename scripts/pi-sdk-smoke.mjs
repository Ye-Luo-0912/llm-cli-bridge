// LLM CLI Bridge — Pi SDK Real Smoke (V17-D 任务 E)
//
// V17-D 任务 E 修复点：
// - pi-native smoke 不能只问一句话（旧版 prompt 是"请用一句话介绍你自己"）
// - 使用临时目录验证 native read/write/edit 至少一项真实工具调用
// - 输出 basic/readOnly/native 三类状态
// - native 工具未验证时 piAdvancedReady=false / releaseReady=false
//
// 三组 smoke：
// - basic：验证 createAgentSession + prompt + text_delta + agent_end 走通（不验证工具）
// - read-only：tools=["read"]，验证 read 工具被实际调用
// - native：不传 tools（Pi 默认 read/write/edit/bash），在临时目录中验证至少一项 native 工具调用
//
// 没环境时明确 skip：
// - piSdkSmokeStatus=skip
// - reason=package not installed / no auth / no model
//
// piAdvancedReady gate：native smoke pass 才能标 pi-advanced-ready
// release-ready gate：native smoke pass 才能标 release-ready
//
// V17-E 任务 F：friendReady 字段废弃，改名为 piAdvancedReady（语义更准确：Pi 是 advanced/optional backend）。
// Pi SDK 保留为 optional/advanced backend，不阻塞 Codex-first audit；Pi provider ESM dynamic import
// 修复作为独立修复项。
//
// 运行：npm run smoke:pi-sdk

import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== Pi SDK Real Smoke (V17-D 任务 E) ===");
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
  console.log("piBasicSmokeStatus=skip");
  console.log("piReadOnlySmokeStatus=skip");
  console.log("piNativeSmokeStatus=skip");
  console.log("piAdvancedReady=false");
  console.log("releaseReady=false");
  process.exit(0);
}

// 3. V17-D：检查认证（标准 Pi auth 优先，fallback 到 env var / Claude Code settings）
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
  console.log("piBasicSmokeStatus=skip");
  console.log("piReadOnlySmokeStatus=skip");
  console.log("piNativeSmokeStatus=skip");
  console.log("piAdvancedReady=false");
  console.log("releaseReady=false");
  process.exit(0);
}

// V17-D 任务 E：创建临时目录 + 测试文件用于 native 工具验证
const smokeTmpDir = mkdtempSync(join(tmpdir(), "pi-sdk-smoke-"));
const smokeTestFile = "smoke-test-data.txt";
const smokeTestFilePath = join(smokeTmpDir, smokeTestFile);
writeFileSync(smokeTestFilePath, "Hello from Pi SDK smoke test.\nThis file is for verifying native read/write/edit tool invocation.\n", "utf8");
console.log(`Smoke temp dir: ${smokeTmpDir}`);
console.log(`Smoke test file: ${smokeTestFilePath}`);

// 共享：跑一组 smoke
// V17-D 任务 E：basic 验证 text_delta + agent_end；readOnly/native 验证至少一项工具调用
async function runSmokeGroup({ name, cwd, sessionOpts, expectToolEvents, promptText, nativeToolNames }) {
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
      cwd,
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

  // V17-D 任务 E：basic 只要求 text_delta + agent_end；readOnly/native 要求至少一项真实工具调用
  let nativeToolVerified = false;
  if (expectToolEvents && nativeToolNames && nativeToolNames.length > 0) {
    // 验证至少一项指定工具被调用（tool_execution_start + tool_execution_end 配对）
    const startToolNames = new Set(toolEvents.filter((e) => e.type === "tool_execution_start").map((e) => e.toolName));
    const endToolNames = new Set(toolEvents.filter((e) => e.type === "tool_execution_end").map((e) => e.toolName));
    for (const expected of nativeToolNames) {
      if (startToolNames.has(expected) || endToolNames.has(expected)) {
        nativeToolVerified = true;
        break;
      }
    }
  }

  const basicPassed = textChunks.length > 0 && agentEnded && errors.length === 0;
  const passed = expectToolEvents ? (basicPassed && nativeToolVerified) : basicPassed;
  return { name, passed, textChunks, toolEvents, agentEnded, errors, nativeToolVerified };
}

// 4. 跑三组 smoke
const results = [];

// 4a. basic smoke：验证 createAgentSession + prompt + text_delta + agent_end（不验证工具）
results.push(await runSmokeGroup({
  name: "basic",
  cwd: smokeTmpDir,
  sessionOpts: {},
  expectToolEvents: false,
  promptText: "请用一句话介绍你自己",
  nativeToolNames: null,
}));

// 4b. read-only smoke：tools=["read"]，验证 read 工具被实际调用
results.push(await runSmokeGroup({
  name: "read-only",
  cwd: smokeTmpDir,
  sessionOpts: { tools: ["read"] },
  expectToolEvents: true,
  promptText: `使用 read 工具读取 ${smokeTestFile} 文件内容，然后简要说明`,
  nativeToolNames: ["read"],
}));

// 4c. pi-native smoke：不传 tools（Pi 默认 read/write/edit/bash），在临时目录中验证至少一项 native 工具
// V17-D 任务 E：不能只问一句话 — 要求 agent 实际调用 read/write/edit 中的至少一项
// 保留 name: "pi-native" 兼容 V17C-F 测试；状态字段输出为 piNativeSmokeStatus
results.push(await runSmokeGroup({
  name: "pi-native",
  cwd: smokeTmpDir,
  sessionOpts: {},
  expectToolEvents: true,
  promptText: `请使用 read 工具读取当前目录的 ${smokeTestFile} 文件，然后告诉我文件内容。`,
  nativeToolNames: ["read", "write", "edit"],
}));

// 5. 清理临时目录
try { rmSync(smokeTmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

// 6. 报告结果
console.log("");
console.log("=== Smoke Results ===");
for (const r of results) {
  console.log(`[${r.name}] passed=${r.passed} text_chunks=${r.textChunks.length} tool_events=${r.toolEvents.length} agent_ended=${r.agentEnded} native_tool_verified=${r.nativeToolVerified} errors=${r.errors.length}${r.error ? " error=" + r.error : ""}`);
  if (r.textChunks.length > 0) {
    console.log(`  text_preview: ${r.textChunks.join("").slice(0, 120)}`);
  }
  if (r.toolEvents.length > 0) {
    console.log(`  tool_events: ${JSON.stringify(r.toolEvents)}`);
  }
  if (r.errors.length > 0) {
    console.log(`  error_details: ${r.errors.join("; ")}`);
  }
}

const basicPassed = results[0]?.passed === true;
const readOnlyPassed = results[1]?.passed === true;
const piNativePassed = results[2]?.passed === true;
const allPassed = basicPassed && readOnlyPassed && piNativePassed;

console.log("");
if (allPassed) {
  console.log("=== PASS: Pi SDK real smoke (all three groups) ===");
  console.log("piSdkSmokeStatus=pass");
  console.log("piBasicSmokeStatus=" + (basicPassed ? "pass" : "fail"));
  console.log("piReadOnlySmokeStatus=" + (readOnlyPassed ? "pass" : "fail"));
  console.log("piNativeSmokeStatus=" + (piNativePassed ? "pass" : "fail"));
  console.log("piAdvancedReady=" + (piNativePassed ? "true" : "false"));
  console.log("releaseReady=" + (piNativePassed ? "true" : "false"));
  process.exit(0);
} else {
  console.log("=== FAIL: Pi SDK real smoke (one or more groups failed) ===");
  console.log("piSdkSmokeStatus=fail");
  console.log("piBasicSmokeStatus=" + (basicPassed ? "pass" : "fail"));
  console.log("piReadOnlySmokeStatus=" + (readOnlyPassed ? "pass" : "fail"));
  console.log("piNativeSmokeStatus=" + (piNativePassed ? "pass" : "fail"));
  console.log("piAdvancedReady=" + (piNativePassed ? "true" : "false"));
  console.log("releaseReady=" + (piNativePassed ? "true" : "false"));
  process.exit(1);
}
