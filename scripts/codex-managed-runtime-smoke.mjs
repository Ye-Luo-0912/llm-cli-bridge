#!/usr/bin/env node
// LLM CLI Bridge — V17-F2: Managed Codex Runtime binary/protocol smoke.
//
// Default path is production runtime-manifest.json (fixture=false). Fixture
// manifests may be passed explicitly through CODEX_MANAGED_RUNTIME_MANIFEST;
// fixture-only may skip protocol, production may not.

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-managed-runtime.md");
const DEFAULT_MANIFEST_PATH = join(
  PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json",
);
const MANIFEST_PATH = process.env.CODEX_MANAGED_RUNTIME_MANIFEST
  ? resolve(PROJECT_ROOT, process.env.CODEX_MANAGED_RUNTIME_MANIFEST)
  : DEFAULT_MANIFEST_PATH;
const SMOKE_VAULT_DIR = join(PROJECT_ROOT, ".tmp", "codex-managed-runtime-smoke-vault");
const USER_CODEX_HOME = process.env.CODEX_HOME
  || (process.env.USERPROFILE ? join(process.env.USERPROFILE, ".codex") : "~/.codex");

console.log("=== Managed Codex Runtime Smoke (V17-F2) ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log(`MANIFEST_PATH: ${MANIFEST_PATH}`);
console.log("");

const report = {
  resolverSmokeStatus: "fail",
  runtimeSmokeStatus: "skip",
  managedAppServerProtocolStatus: "fail",
  codexUserReady: false,
  manifestLoaded: false,
  manifestVersion: null,
  manifestProtocolVersion: null,
  manifestFixture: false,
  supportedPlatforms: [],
  testedPlatform: `${process.platform}-${process.arch}`,
  crossPlatformReady: false,
  platformSelected: false,
  platformKey: `${process.platform}-${process.arch}`,
  runtimePath: null,
  pathExists: false,
  sizeValid: false,
  sha256Valid: false,
  executableValid: false,
  codexRuntimePinnedVersion: null,
  appServerSpawnStatus: "unknown",
  initializeStatus: "unknown",
  initializedStatus: "unknown",
  threadStartStatus: "unknown",
  turnStartStatus: "unknown",
  turnCompletedStatus: "unknown",
  // 任务4: 区分 binary verified / protocol ready / turn smoke ready
  // initialized + turn/started + completed(empty) 必须显示为 turn smoke failed
  turnSmokeReady: "unknown",
  turnSmokeFailureReason: null,
  // 强化 managed smoke：记录 agent 实际产出的 final answer
  // turnSmokeReady 必须要求 observedFinalAnswer 包含 SMOKE_OK
  // 仅有 item/completed 但无目标文本不得 pass
  observedFinalAnswer: null,
  // provider-wire smoke：用 buildCodexAppServerRunOptions() 生成真实 provider options
  // 发送完全相同的 initialize/threadStart/turnStart payload 到 managed runtime
  providerWireSmokeStatus: "unknown",
  providerWireSmokeFailureReason: null,
  providerWireObservedFinalAnswer: null,
  stopCancelStatus: "unknown",
  noVaultRootPollution: "unknown",
  selectedModel: null,
  binaryDependency: "managed,pinned,bundled",
  authConfigDependency: "user-level Codex/OpenAI credentials or env",
  managedRuntimeReadsUserCodexHome: "true",
  codexHome: USER_CODEX_HOME,
  reason: null,
  error: null,
  steps: [],
  timestamp: new Date().toISOString(),
};

function step(name, ok, detail = "") {
  const status = ok ? "pass" : "fail";
  report.steps.push({ name, status, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) throw new Error(`manifest not found: ${MANIFEST_PATH}`);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  report.manifestLoaded = true;
  report.manifestVersion = manifest.version || null;
  report.manifestProtocolVersion = manifest.protocolVersion || null;
  report.manifestFixture = !!manifest.fixture;
  report.supportedPlatforms = Object.keys(manifest.platforms || {});
  report.crossPlatformReady = false;
  report.codexRuntimePinnedVersion = manifest.version || null;
  return manifest;
}

function ensureProductionRuntimeInstalled(manifest) {
  if (manifest.fixture) return;
  if (MANIFEST_PATH !== DEFAULT_MANIFEST_PATH) {
    throw new Error("production install only supports the default managed runtime manifest");
  }
  execFileSync("node", ["scripts/install-codex-managed-runtime.mjs"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
}

function verifyResolverChain(manifest) {
  const platformEntry = manifest.platforms?.[report.platformKey];
  if (!platformEntry) throw new Error(`platform ${report.platformKey} not in manifest`);
  report.platformSelected = true;
  step("platform selected", true, `${report.platformKey} (${platformEntry.executableName})`);

  const runtimePath = resolve(dirname(MANIFEST_PATH), platformEntry.path);
  report.runtimePath = runtimePath;
  if (!existsSync(runtimePath)) throw new Error(`runtime binary not found: ${runtimePath}`);
  report.pathExists = true;
  step("runtime binary exists", true, runtimePath);

  const stat = statSync(runtimePath);
  if (stat.size !== platformEntry.size) {
    throw new Error(`size mismatch: expected ${platformEntry.size}, got ${stat.size}`);
  }
  report.sizeValid = true;
  step("size valid", true, `${stat.size}`);

  const actualSha = sha256(runtimePath);
  if (actualSha !== platformEntry.sha256) {
    throw new Error(`sha256 mismatch: expected ${platformEntry.sha256}, got ${actualSha}`);
  }
  report.sha256Valid = true;
  step("sha256 valid", true, actualSha);

  if (process.platform === "win32") {
    const lower = runtimePath.toLowerCase();
    if (!lower.endsWith(".exe") && !lower.endsWith(".bat") && !lower.endsWith(".cmd") && !lower.endsWith(".ps1")) {
      throw new Error(`Windows executable must have .exe/.bat/.cmd/.ps1 extension: ${runtimePath}`);
    }
  } else {
    accessSync(runtimePath, constants.X_OK);
  }
  report.executableValid = true;
  step("executable valid", true);
  report.resolverSmokeStatus = "pass";
  report.runtimeSmokeStatus = manifest.fixture ? "fixture-only" : "pass";
  report.reason = "ok";
  return { runtimePath, appServerArgs: manifest.appServerArgs?.length ? manifest.appServerArgs : ["app-server"] };
}

function createJsonRpcClient(proc) {
  let buf = "";
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of handlers.get(msg.method) || []) {
          try { h(msg.params || {}, msg.id); } catch {}
        }
      }
    }
  });

  return {
    request(method, params, timeout = 30000) {
      return new Promise((resolvePromise, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolvePromise, reject });
        proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`${method} timeout`));
        }, timeout);
      });
    },
    notify(method, params) {
      proc.stdin.write(JSON.stringify({ method, params }) + "\n");
    },
    on(method, handler) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(handler);
    },
  };
}

function waitForExit(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
  });
}

async function runProtocolSmoke(runtimePath, appServerArgs) {
  rmSync(SMOKE_VAULT_DIR, { recursive: true, force: true });
  mkdirSync(SMOKE_VAULT_DIR, { recursive: true });
  const projectCodexBefore = existsSync(join(PROJECT_ROOT, ".codex"))
    ? readdirSync(join(PROJECT_ROOT, ".codex")).join("\n")
    : null;
  let stderr = "";
  const proc = spawn(runtimePath, appServerArgs, {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const client = createJsonRpcClient(proc);
  report.appServerSpawnStatus = proc.pid ? "pass" : "fail";
  step("spawn managed runtime", !!proc.pid, `pid=${proc.pid || "?"}`);
  if (!proc.pid) throw new Error("managed app-server did not spawn");

  try {
    const init = await client.request("initialize", {
      clientInfo: { name: "llm-cli-bridge-managed-smoke", title: "LLM CLI Bridge Managed Smoke", version: "17-f2" },
      capabilities: { experimentalApi: false },
    }, 15000);
    report.codexHome = init?.codexHome || USER_CODEX_HOME;
    report.managedRuntimeReadsUserCodexHome = "true";
    report.initializeStatus = init ? "pass" : "fail";
    step("initialize", !!init, init?.userAgent || init?.version || "");
    client.notify("initialized", {});
    report.initializedStatus = "pass";
    step("initialized", true);

    const modelList = await client.request("model/list", {}, 15000);
    const models = Array.isArray(modelList?.data) ? modelList.data : [];
    const selected = models.find((m) => m?.isDefault && (m.model || m.id)) || models.find((m) => m?.model || m?.id);
    const selectedModel = selected?.model || selected?.id || "gpt-5.5";
    report.selectedModel = selectedModel;
    step("model/list", true, `selected=${selectedModel}`);

    const thread = await client.request("thread/start", {
      model: selectedModel,
      cwd: SMOKE_VAULT_DIR,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      baseInstructions: "You are a managed runtime smoke test assistant. Reply concisely.",
      personality: "pragmatic",
      ephemeral: true,
      sessionStartSource: "clear",
    }, 20000);
    const threadId = thread?.thread?.id;
    report.threadStartStatus = threadId ? "pass" : "fail";
    step("thread/start", !!threadId, `threadId=${threadId || "?"}`);
    if (!threadId) throw new Error("thread/start returned no thread id");

    let turnError = null;
    // 任务4: 收集 turn 期间的有效输出事件，用于 turn smoke readiness 判定
    // initialized + turn/started + completed(empty) 不算 turn smoke ready
    const meaningfulEvents = [];
    // 强化 managed smoke：拼接 agentMessage delta 作为 observedFinalAnswer
    const agentMessageChunks = [];
    let completedFinalText = "";
    const isMeaningful = (method) => {
      // 与 provider 的 isMeaningfulCodexRuntimeEvent 对齐：
      // message / tool / fileChange / approval / user-input / error 算有效
      return method === "item/agentMessage/delta"
        || method === "item/completed"
        || method === "item/commandExecution/requestApproval"
        || method === "item/fileChange/requestApproval"
        || method === "item/tool/requestUserInput"
        || method === "turn/failed";
    };
    const turnWait = new Promise((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise("timeout"), 90000);
      client.on("turn/completed", (params) => {
        clearTimeout(timer);
        if (typeof params?.finalText === "string") completedFinalText = params.finalText;
        resolvePromise({ status: "completed", params });
      });
      client.on("turn/failed", (params) => {
        clearTimeout(timer);
        resolvePromise({ status: "failed", params });
      });
      client.on("error", (params) => {
        turnError = params?.error?.message || params?.message || JSON.stringify(params);
      });
      // 任务4: 收集有效事件（item/completed 含 agentMessage/tool_result/file_change）
      client.on("item/agentMessage/delta", (params) => {
        meaningfulEvents.push("message");
        if (typeof params?.delta === "string") agentMessageChunks.push(params.delta);
      });
      client.on("item/completed", (params) => {
        const itemType = params?.item?.type ?? params?.type;
        if (itemType === "agentMessage" || itemType === "commandExecution"
          || itemType === "fileChange" || itemType === "mcpToolCall"
          || itemType === "dynamicToolCall") {
          meaningfulEvents.push(`item:${itemType}`);
        }
        // agentMessage item 完成时把 item.text 作为 fallback（delta 可能缺失）
        if (itemType === "agentMessage" && typeof params?.item?.text === "string" && params.item.text) {
          if (agentMessageChunks.length === 0) agentMessageChunks.push(params.item.text);
        }
      });
    });
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Reply with exactly: SMOKE_OK" }],
    }, 20000);
    report.turnStartStatus = "pass";
    step("turn/start", true);

    const turnResult = await turnWait;
    if (turnResult === "timeout") throw new Error(`turn/completed timeout${turnError ? `; last error: ${turnError}` : ""}`);
    report.turnCompletedStatus = turnResult.status === "completed" ? "pass" : "fail";
    step("turn/completed", turnResult.status === "completed", `status=${turnResult.status}`);

    // 任务4: turn smoke readiness —— 必须收到有效输出（message/tool/file/approval/error）
    // initialized + turn/started + completed(empty) 不算 turn smoke ready
    const hasMeaningfulOutput = meaningfulEvents.length > 0;
    // 强化 managed smoke：拼接 final answer，优先用 agentMessage delta，fallback 用 finalText
    const observedFinalAnswer = (agentMessageChunks.join("").trim()
      || completedFinalText.trim() || "").trim();
    report.observedFinalAnswer = observedFinalAnswer || null;
    // turnSmokeReady 必须要求 observedFinalAnswer 包含 SMOKE_OK
    // 仅有 item/completed 但无目标文本不得 pass
    const hasTargetToken = /SMOKE_OK/i.test(observedFinalAnswer);
    const turnSmokePass = hasMeaningfulOutput && hasTargetToken;
    report.turnSmokeReady = turnSmokePass ? "pass" : "fail";
    report.turnSmokeFailureReason = turnSmokePass ? null
      : (!hasMeaningfulOutput
        ? (turnResult.status === "failed"
          ? "turn/failed reached without any assistant message, tool, file, approval, or error event"
          : "turn/completed reached without any assistant message, tool, file, approval, or error event")
        : !hasTargetToken
          ? `turn smoke missing target token SMOKE_OK in final answer (observed="${observedFinalAnswer.slice(0, 200)}")`
          : "unknown turn smoke failure");
    step("turn smoke (meaningful output + SMOKE_OK)", turnSmokePass,
      report.turnSmokeFailureReason || `${meaningfulEvents.length} event(s), final="${observedFinalAnswer.slice(0, 60)}"`);
  } finally {
    try { proc.stdin.end(); } catch {}
    let exited = await waitForExit(proc, 3000);
    if (!exited) {
      try { proc.kill("SIGKILL"); } catch {}
      exited = await waitForExit(proc, 5000);
    }
    report.stopCancelStatus = exited ? "pass" : "fail";
    step("clean shutdown / cancel", exited, stderr.slice(0, 200));

    const projectCodexAfter = existsSync(join(PROJECT_ROOT, ".codex"))
      ? readdirSync(join(PROJECT_ROOT, ".codex")).join("\n")
      : null;
    const noProjectPollution = projectCodexBefore === projectCodexAfter;
    const noSmokeVaultPollution = !existsSync(join(SMOKE_VAULT_DIR, ".codex"));
    report.noVaultRootPollution = noProjectPollution && noSmokeVaultPollution ? "true" : "false";
    step("no vault root pollution", report.noVaultRootPollution === "true");
  }

  const protocolPass = report.appServerSpawnStatus === "pass"
    && report.initializeStatus === "pass"
    && report.initializedStatus === "pass"
    && report.threadStartStatus === "pass"
    && report.turnStartStatus === "pass"
    && report.turnCompletedStatus === "pass"
    && report.stopCancelStatus === "pass"
    && report.noVaultRootPollution === "true";
  report.managedAppServerProtocolStatus = protocolPass ? "pass" : "fail";
}

/**
 * provider-wire smoke：用 buildCodexAppServerRunOptions() 生成真实 provider options，
 * 发送完全相同的 initialize/threadStart/turnStart payload 到 managed runtime。
 *
 * 验证目标：
 * - final answer 非空且包含目标 token SMOKE_OK
 * - provider wire shape：text item 含 schema 必填的 text_elements 数组（空数组 OK）
 * - thread/start payload 用 provider 实际生成的 config/instructions/cwd（非手动拼）
 */
async function runProviderWireSmoke(runtimePath, appServerArgs) {
  const PROVIDER_WIRE_VAULT_DIR = join(PROJECT_ROOT, ".tmp", "codex-provider-wire-smoke-vault");
  rmSync(PROVIDER_WIRE_VAULT_DIR, { recursive: true, force: true });
  mkdirSync(PROVIDER_WIRE_VAULT_DIR, { recursive: true });

  // 动态 bundle buildCodexAppServerRunOptions（TS 源码）
  const esbuild = (await import("esbuild")).default;
  const tempBundle = join(PROJECT_ROOT, ".tmp-codex-provider-wire-smoke-bundle.mjs");
  await esbuild.build({
    entryPoints: [join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "codexAppServerEffectiveRunPlan.ts")],
    bundle: true, format: "esm", platform: "node", outfile: tempBundle, logLevel: "silent",
  });
  const { buildCodexAppServerRunOptions } = await import(pathToFileURL(tempBundle).href);

  // 构造与 provider 真实 run() 一致的 plan + promptPackage
  const plan = {
    backend: "codex-app-server",
    cwd: PROVIDER_WIRE_VAULT_DIR,
    model: report.selectedModel || "gpt-5.5",
    effort: "high",
    session: { continueSession: false },
    settingSources: [],
    skills: [],
    promptPackageHash: "provider-wire-smoke",
    attachmentPlan: { entries: [] },
    createdAt: new Date().toISOString(),
    instructionsSource: "developerInstructions",
  };
  const promptPackage = {
    userPrompt: "Reply with exactly: SMOKE_OK",
    bridgeSystemAppend: "You are a provider-wire smoke test assistant. Reply concisely.",
    attachmentEntries: [],
    auditHash: "provider-wire-smoke",
  };
  const options = buildCodexAppServerRunOptions(plan, promptPackage);

  // 验证 wire shape：text item 含 schema 必填的 text_elements 数组（空数组 OK）；
  // Round 1 含 developerInstructions、不含 baseInstructions；turnStart 无 attachments 字段。
  const firstInputItem = options.turnStart.input?.[0];
  const threadStartHasDeveloper = typeof options.threadStart.developerInstructions === "string"
    && options.threadStart.developerInstructions.length > 0;
  const threadStartNoBase = options.threadStart.baseInstructions === undefined;
  const threadStartHasWireFields = "model" in options.threadStart
    && "approvalPolicy" in options.threadStart && "sandbox" in options.threadStart
    && threadStartHasDeveloper && threadStartNoBase
    && options.bridgeSystemAppendSource === "developerInstructions";
  const wireShapeOk = !!firstInputItem
    && firstInputItem.type === "text"
    && typeof firstInputItem.text === "string"
    && Array.isArray(firstInputItem.text_elements)
    && !("attachments" in options.turnStart)
    && threadStartHasWireFields;
  step("provider-wire smoke: wire shape (developerInstructions only, no baseInstructions, text_elements 数组, turnStart 无 attachments)",
    wireShapeOk, wireShapeOk ? "" : `firstInput=${JSON.stringify(firstInputItem)}, turnStart keys=${Object.keys(options.turnStart).join(",")}, threadStart keys=${Object.keys(options.threadStart).join(",")}`);

  const proc = spawn(runtimePath, appServerArgs, {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  let providerWireStderr = "";
  proc.stderr.on("data", (chunk) => { providerWireStderr += chunk.toString("utf8"); });
  const client = createJsonRpcClient(proc);
  step("provider-wire smoke: spawn", !!proc.pid, `pid=${proc.pid || "?"}`);
  if (!proc.pid) {
    try { rmSync(tempBundle, { force: true }); } catch { /* ignore */ }
    report.providerWireSmokeStatus = "fail";
    report.providerWireSmokeFailureReason = "managed app-server did not spawn for provider-wire smoke";
    return;
  }

  try {
    // 1. initialize（用 provider 生成的真实 payload）
    const init = await client.request("initialize", options.initialize, 15000);
    step("provider-wire smoke: initialize", !!init, init?.userAgent || init?.version || "");
    client.notify("initialized", {});

    // 2. thread/start（发送与 provider 完全一致的 wire shape）
    // Round 1：剥离 config/instructions/baseInstructions；发送 developerInstructions。
    const {
      config: _dropConfig,
      instructions: _dropInstr,
      baseInstructions: _dropBase,
      ...threadStartWirePayload
    } = options.threadStart;
    delete threadStartWirePayload.baseInstructions;
    const threadStartPayload = threadStartWirePayload;
    const thread = await client.request("thread/start", threadStartPayload, 20000);
    const threadId = thread?.thread?.id;
    step("provider-wire smoke: thread/start", !!threadId, `threadId=${threadId || "?"}`);
    if (!threadId) throw new Error("provider-wire smoke: thread/start returned no thread id");

    // 3. turn/start（用 provider 生成的真实 input + effort）
    const turnStartPayload = { ...options.turnStart, threadId };
    const agentMessageChunks = [];
    let completedFinalText = "";
    let turnError = null;
    const turnWait = new Promise((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise("timeout"), 90000);
      client.on("turn/completed", (params) => {
        clearTimeout(timer);
        if (typeof params?.finalText === "string") completedFinalText = params.finalText;
        resolvePromise({ status: "completed", params });
      });
      client.on("turn/failed", (params) => {
        clearTimeout(timer);
        resolvePromise({ status: "failed", params });
      });
      client.on("error", (params) => {
        turnError = params?.error?.message || params?.message || JSON.stringify(params);
      });
      client.on("item/agentMessage/delta", (params) => {
        if (typeof params?.delta === "string") agentMessageChunks.push(params.delta);
      });
      client.on("item/completed", (params) => {
        const itemType = params?.item?.type ?? params?.type;
        if (itemType === "agentMessage" && typeof params?.item?.text === "string" && params.item.text) {
          if (agentMessageChunks.length === 0) agentMessageChunks.push(params.item.text);
        }
      });
    });
    await client.request("turn/start", turnStartPayload, 20000);
    step("provider-wire smoke: turn/start", true);

    const turnResult = await turnWait;
    if (turnResult === "timeout") {
      throw new Error(`provider-wire smoke: turn/completed timeout${turnError ? `; last error: ${turnError}` : ""}`);
    }
    step("provider-wire smoke: turn/completed", turnResult.status === "completed", `status=${turnResult.status}`);

    // 验证 final answer 非空且包含 SMOKE_OK
    const observed = (agentMessageChunks.join("").trim()
      || completedFinalText.trim() || "").trim();
    report.providerWireObservedFinalAnswer = observed || null;
    const hasTarget = /SMOKE_OK/i.test(observed);
    const wireSmokePass = turnResult.status === "completed" && !!observed && hasTarget && wireShapeOk;
    report.providerWireSmokeStatus = wireSmokePass ? "pass" : "fail";
    report.providerWireSmokeFailureReason = wireSmokePass ? null
      : (!wireShapeOk ? "provider wire shape mismatch (text_elements 非数组 或 turnStart 含 attachments)"
        : turnResult.status !== "completed" ? `turn did not complete: ${turnResult.status}`
        : !observed ? "provider-wire smoke: final answer empty"
        : !hasTarget ? `provider-wire smoke missing target token SMOKE_OK (observed="${observed.slice(0, 200)}")`
        : "unknown provider-wire smoke failure");
    step("provider-wire smoke: final answer 含 SMOKE_OK", wireSmokePass,
      report.providerWireSmokeFailureReason || `final="${observed.slice(0, 60)}"`);
  } catch (e) {
    report.providerWireSmokeStatus = "fail";
    report.providerWireSmokeFailureReason = e?.message || String(e);
    step("provider-wire smoke: failed", false, report.providerWireSmokeFailureReason);
    if (providerWireStderr.trim()) {
      console.error("[provider-wire debug] app-server stderr:\n", providerWireStderr.slice(-2000));
    }
  } finally {
    try { proc.stdin.end(); } catch { /* ignore */ }
    let exited = await waitForExit(proc, 3000);
    if (!exited) {
      try { proc.kill("SIGKILL"); } catch { /* ignore */ }
      exited = await waitForExit(proc, 5000);
    }
    step("provider-wire smoke: clean shutdown", exited);
    try { rmSync(tempBundle, { force: true }); } catch { /* ignore */ }
  }
}

function deriveCodexUserReady() {
  // 任务4: UI ready 只能在 turn smoke 通过后显示。
  // binary verified != protocol ready != turn smoke ready
  // provider-wire smoke: 验证真实 provider payload 与 runtime 兼容
  return report.resolverSmokeStatus === "pass"
    && report.runtimeSmokeStatus === "pass"
    && report.managedAppServerProtocolStatus === "pass"
    && report.appServerSpawnStatus === "pass"
    && report.initializeStatus === "pass"
    && report.initializedStatus === "pass"
    && report.threadStartStatus === "pass"
    && report.turnStartStatus === "pass"
    && report.turnCompletedStatus === "pass"
    && report.turnSmokeReady === "pass"
    && report.providerWireSmokeStatus === "pass"
    && report.stopCancelStatus === "pass"
    && report.noVaultRootPollution === "true";
}

function writeReport() {
  mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Managed Codex Runtime Smoke (V17-F2)",
    "",
    "> 本报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成。",
    "> 验证 production manifest + pinned binary + app-server protocol proof。",
    "",
    `- **测试时间**: ${report.timestamp}`,
    `- **resolverSmokeStatus**: ${report.resolverSmokeStatus}`,
    `- **runtimeSmokeStatus**: ${report.runtimeSmokeStatus}`,
    `- **managedAppServerProtocolStatus**: ${report.managedAppServerProtocolStatus}`,
    `- **codexUserReady**: ${report.codexUserReady ? "true" : "false"}`,
    `- **manifestLoaded**: ${report.manifestLoaded}`,
    `- **manifestVersion**: ${report.manifestVersion || "null"}`,
    `- **manifestProtocolVersion**: ${report.manifestProtocolVersion || "null"}`,
    `- **manifestFixture**: ${report.manifestFixture}`,
    `- **supportedPlatforms**: ${report.supportedPlatforms.length ? report.supportedPlatforms.join(",") : "none"}`,
    `- **testedPlatform**: ${report.testedPlatform}`,
    `- **crossPlatformReady**: ${report.crossPlatformReady ? "true" : "false"}`,
    `- **platformSelected**: ${report.platformSelected}`,
    `- **platformKey**: ${report.platformKey || "null"}`,
    `- **runtimePath**: ${report.runtimePath || "null"}`,
    `- **pathExists**: ${report.pathExists}`,
    `- **sizeValid**: ${report.sizeValid}`,
    `- **sha256Valid**: ${report.sha256Valid}`,
    `- **executableValid**: ${report.executableValid}`,
    `- **codexRuntimePinnedVersion**: ${report.codexRuntimePinnedVersion || "null"}`,
    `- **appServerSpawnStatus**: ${report.appServerSpawnStatus}`,
    `- **initializeStatus**: ${report.initializeStatus}`,
    `- **initializedStatus**: ${report.initializedStatus}`,
    `- **threadStartStatus**: ${report.threadStartStatus}`,
    `- **turnStartStatus**: ${report.turnStartStatus}`,
    `- **turnCompletedStatus**: ${report.turnCompletedStatus}`,
    `- **turnSmokeReady**: ${report.turnSmokeReady}`,
    `- **turnSmokeFailureReason**: ${report.turnSmokeFailureReason || "null"}`,
    `- **observedFinalAnswer**: ${report.observedFinalAnswer ? JSON.stringify(report.observedFinalAnswer) : "null"}`,
    `- **providerWireSmokeStatus**: ${report.providerWireSmokeStatus}`,
    `- **providerWireSmokeFailureReason**: ${report.providerWireSmokeFailureReason || "null"}`,
    `- **providerWireObservedFinalAnswer**: ${report.providerWireObservedFinalAnswer ? JSON.stringify(report.providerWireObservedFinalAnswer) : "null"}`,
    `- **stopCancelStatus**: ${report.stopCancelStatus}`,
    `- **noVaultRootPollution**: ${report.noVaultRootPollution}`,
    `- **selectedModel**: ${report.selectedModel || "null"}`,
    `- **binaryDependency**: ${report.binaryDependency}`,
    `- **authConfigDependency**: ${report.authConfigDependency}`,
    `- **managedRuntimeReadsUserCodexHome**: ${report.managedRuntimeReadsUserCodexHome}`,
    `- **codexHome**: ${report.codexHome || "null"}`,
    `- **reason**: ${report.reason || "null"}`,
    `- **error**: ${report.error || "null"}`,
    "",
    "## 步骤结果",
    "",
    "| 状态 | 步骤 | 详情 |",
    "|------|------|------|",
    ...report.steps.map((s) => `| ${s.status === "pass" ? "PASS" : "FAIL"} | ${s.name} | ${s.detail || "-"} |`),
    "",
    "## codexUserReady gate",
    "",
    "- `codexUserReady=true` 只允许 resolver/runtime/protocol/turnSmoke/providerWire 五层均 pass。",
    "- binary verified != protocol ready != turn smoke ready != provider-wire ready。",
    "- initialized + turn/started + completed(empty) 必须显示为 turn smoke failed。",
    "- turn smoke 必须收到目标 token SMOKE_OK；仅有 item/completed 但无目标文本不得 pass。",
    "- provider-wire smoke 用 buildCodexAppServerRunOptions() 生成真实 payload 验证 wire 兼容性。",
    "- production manifest 下 `skip-fixture` 不允许通过。",
    "- external codex CLI/app-server 不参与本报告 gate。",
    "- 当前 production manifest 仅声明本机已验证平台；`crossPlatformReady=false`，不得表述为 all-platform release-ready。",
    "- Binary dependency 为 managed/pinned/bundled，不依赖用户安装 CLI/App；auth/config 仍依赖可用的 user-level Codex/OpenAI credentials 或环境变量。",
    "",
    "```bash",
    "npm run smoke:codex-managed-runtime",
    "```",
    "",
    "*报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`\n报告已写入: ${REPORT_PATH}`);
}

async function main() {
  try {
    const manifest = loadManifest();
    step("manifest loaded", true, `version=${manifest.version} fixture=${manifest.fixture}`);
    ensureProductionRuntimeInstalled(manifest);
    const resolvedRuntime = verifyResolverChain(manifest);
    if (manifest.fixture) {
      report.managedAppServerProtocolStatus = "skip-fixture";
      report.turnSmokeReady = "skip-fixture";
      report.turnSmokeFailureReason = "fixture manifest skips protocol/turn smoke";
      report.providerWireSmokeStatus = "skip-fixture";
      report.providerWireSmokeFailureReason = "fixture manifest skips provider-wire smoke";
      step("protocol smoke", true, "skip-fixture");
      step("turn smoke (meaningful output + SMOKE_OK)", true, "skip-fixture");
      step("provider-wire smoke", true, "skip-fixture");
    } else {
      await runProtocolSmoke(resolvedRuntime.runtimePath, resolvedRuntime.appServerArgs);
      await runProviderWireSmoke(resolvedRuntime.runtimePath, resolvedRuntime.appServerArgs);
    }
    report.codexUserReady = deriveCodexUserReady();
  } catch (e) {
    report.error = e?.message || String(e);
    report.reason = report.reason || "fail";
    step("managed runtime smoke failed", false, report.error);
  } finally {
    writeReport();
  }

  console.log("");
  console.log(`resolverSmokeStatus=${report.resolverSmokeStatus}`);
  console.log(`runtimeSmokeStatus=${report.runtimeSmokeStatus}`);
  console.log(`managedAppServerProtocolStatus=${report.managedAppServerProtocolStatus}`);
  console.log(`turnSmokeReady=${report.turnSmokeReady}`);
  console.log(`providerWireSmokeStatus=${report.providerWireSmokeStatus}`);
  console.log(`codexUserReady=${report.codexUserReady ? "true" : "false"}`);

  if (report.manifestFixture) {
    process.exit(report.resolverSmokeStatus === "pass" && report.managedAppServerProtocolStatus === "skip-fixture" ? 0 : 1);
  }
  process.exit(report.codexUserReady ? 0 : 1);
}

main();
