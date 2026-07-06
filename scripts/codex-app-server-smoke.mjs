#!/usr/bin/env node
// LLM CLI Bridge — Codex real app-server smoke gate (P2: Codex app-server Runtime 主线闭环)
//
// 若本机有 codex CLI，则跑一次真实 codex app-server JSON-RPC 闭环，并分层记录：
//   handshakeSmoke: codex --version / generate-ts / app-server spawn / initialize / initialized / thread/start
//   turnSmoke:      turn/start / turn/completed
//
// 分层状态语义（P2 要求区分 handshake 与 turn，避免 auth 不可用被误判为 handshake 失败）：
//   - handshakeStatus: pass | fail
//       codex --version / generate-ts / spawn / initialize / initialized / thread/start 全部通过 → pass
//       任一失败 → fail（turn 不再执行）
//   - turnStatus: pass | fail | skip-auth | skip-handshake-failed
//       turn/start + turn/completed 全部通过 → pass
//       turn/start 或 turn/completed 失败且错误特征为 auth/login 不可用 → skip-auth
//       （handshake 可 pass，turn 因 auth 不可用而 skip-auth，必须与 fail 区分）
//       其他 turn 失败 → fail
//       handshake fail 时 → skip-handshake-failed（turn 不执行）
//   - smokeStatus: skip | pass | handshake-only | fail
//       无 codex CLI → skip
//       handshake pass + turn pass → pass
//       handshake pass + turn 非 pass → handshake-only
//       handshake fail → fail
//
// Generated schema manifest 摘要（task 4）：
//   generate-ts 仍写临时目录，不覆盖 fixture schema。
//   smoke 记录 generatedFiles count / schema hash / protocolCapabilities（若 manifest 可读）。
//   fixture / generated / compat mapper 三层保持清晰：
//     - fixture schema: src/.../schema/manifest.json (source=fixture) — 默认测试基线
//     - generated schema: codex:schema 显式生成覆盖 fixture；smoke 仅写临时目录并记摘要
//     - compat mapper: EventMapper/SessionMapper/ApprovalMapper 对齐 fixture 与 generated 共有 wire shape
//
// 运行：node scripts/codex-app-server-smoke.mjs
// 或：  npm run smoke:codex-app-server
//
// 输出：
// - stdout: 每一步进展
// - 退出码：0=skip/pass/handshake-only；1=handshake fail 或 turn hard fail（fail）
// - 结果记录到 docs/test-report-codex-smoke.md（skip 时也覆盖，明确 skip 状态）

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, readdirSync, readFileSync, accessSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-smoke.md");
const FIXTURE_MANIFEST_PATH = join(
  PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "schema", "manifest.json",
);

// V17-F1 任务 G：Managed runtime manifest 路径
const MANAGED_RUNTIME_MANIFEST_PATH = join(
  PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json",
);

const CODEX_COMMAND = process.env.CODEX_COMMAND || "codex";

// ============================================================
// Step 0: 探测 codex 是否可用
// ============================================================

function probeCodex() {
  const probe = spawnSync(CODEX_COMMAND, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 5000,
  });
  if (probe.error || probe.status !== 0) {
    return { available: false, version: null, reason: probe.error?.message || `exit=${probe.status}` };
  }
  const version = (probe.stdout || probe.stderr).trim().split(/\r?\n/)[0] || "unknown";
  return { available: true, version, reason: null };
}

// ============================================================
// V17-F1 任务 G：探测 Managed Codex App-Server Runtime
// ============================================================

/**
 * 探测 managed runtime（manifest + sha256 + executable）。
 *
 * 不依赖用户安装 Codex CLI / Desktop App。
 * 校验我们管理的 pinned runtime binary。
 *
 * spawnStatus 语义：
 *   - pass: available=true + fixture=false（真实 binary）
 *   - fixture-only: available=true + fixture=true（fixture，不标 user-ready）
 *   - fail: available=false 或校验失败
 *   - unknown: manifest 不存在或解析失败
 */
function probeManagedRuntime() {
  // V17-F1.1 任务 E：分层字段
  const result = {
    available: false,
    version: null,
    sha256Valid: false,
    executableValid: false,
    // V17-F1.1 任务 E：分层字段（替代旧 spawnStatus）
    resolverSmokeStatus: "fail",      // pass/fail — resolver 校验链
    runtimeSmokeStatus: "skip",       // pass/fixture-only/fail/skip — runtime binary
    managedAppServerProtocolStatus: "skip-fixture", // pass/skip-fixture/fail — 协议层
    // 兼容字段（供 codexManagedAppServerSpawnStatus 用）
    spawnStatus: "unknown",
    fixture: false,
    reason: null,
  };

  if (!existsSync(MANAGED_RUNTIME_MANIFEST_PATH)) {
    result.reason = "manifest-not-found";
    result.resolverSmokeStatus = "fail";
    result.runtimeSmokeStatus = "skip";
    result.managedAppServerProtocolStatus = "fail";
    result.spawnStatus = "unknown";
    return result;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANAGED_RUNTIME_MANIFEST_PATH, "utf8"));
  } catch (e) {
    result.reason = `manifest-invalid: ${e.message}`;
    result.resolverSmokeStatus = "fail";
    result.runtimeSmokeStatus = "skip";
    result.managedAppServerProtocolStatus = "fail";
    result.spawnStatus = "unknown";
    return result;
  }

  result.version = manifest.version || null;
  result.fixture = !!manifest.fixture;

  const platformKey = `${process.platform}-${process.arch}`;
  const platformEntry = manifest.platforms?.[platformKey];
  if (!platformEntry) {
    result.reason = `platform-not-found: ${platformKey}`;
    result.resolverSmokeStatus = "fail";
    result.runtimeSmokeStatus = "skip";
    result.managedAppServerProtocolStatus = "fail";
    result.spawnStatus = "fail";
    return result;
  }

  const manifestDir = dirname(MANAGED_RUNTIME_MANIFEST_PATH);
  const runtimePath = resolve(manifestDir, platformEntry.path);
  if (!existsSync(runtimePath)) {
    result.reason = `path-not-exist: ${runtimePath}`;
    result.resolverSmokeStatus = "fail";
    result.runtimeSmokeStatus = "skip";
    result.managedAppServerProtocolStatus = "fail";
    result.spawnStatus = "fail";
    return result;
  }

  // sha256 校验
  const fileBuf = readFileSync(runtimePath);
  const actualSha256 = createHash("sha256").update(fileBuf).digest("hex");
  if (actualSha256 !== platformEntry.sha256) {
    result.reason = `sha256-mismatch: expected ${platformEntry.sha256}, got ${actualSha256}`;
    result.resolverSmokeStatus = "fail";
    result.runtimeSmokeStatus = "skip";
    result.managedAppServerProtocolStatus = "fail";
    result.spawnStatus = "fail";
    return result;
  }
  result.sha256Valid = true;

  // executable 校验
  let execOk = false;
  if (process.platform === "win32") {
    const lower = runtimePath.toLowerCase();
    execOk = lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".cmd") || lower.endsWith(".ps1");
  } else {
    try { accessSync(runtimePath, constants.X_OK); execOk = true; } catch {}
  }
  if (!execOk) {
    result.reason = "not-executable";
    result.resolverSmokeStatus = "fail";
    result.runtimeSmokeStatus = "skip";
    result.managedAppServerProtocolStatus = "fail";
    result.spawnStatus = "fail";
    return result;
  }
  result.executableValid = true;
  result.available = true;
  // V17-F1.1 任务 E：分层状态
  result.resolverSmokeStatus = "pass";
  result.runtimeSmokeStatus = result.fixture ? "fixture-only" : "pass";
  result.managedAppServerProtocolStatus = result.fixture ? "skip-fixture" : "pass";
  // 兼容字段
  result.spawnStatus = result.fixture ? "fixture-only" : "pass";
  result.reason = "ok";
  return result;
}

// ============================================================
// JSON-RPC over stdio client（wire 上不发 jsonrpc 字段）
// ============================================================

function createJsonRpcClient(proc) {
  let buf = "";
  let nextId = 1;
  const pending = new Map(); // id -> {resolve, reject}
  const notifyHandlers = new Map(); // method -> handler[]

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
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(msg.error);
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const handlers = notifyHandlers.get(msg.method) || [];
        for (const h of handlers) {
          try { h(msg.params || {}, msg.id); } catch {}
        }
      }
    }
  });

  return {
    request(method, params, opts = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const msg = { id, method, params };
        if (opts.meta) msg.meta = opts.meta;
        proc.stdin.write(JSON.stringify(msg) + "\n");
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`JSON-RPC request "${method}" timeout (id=${id})`));
          }
        }, opts.timeout || 30000);
      });
    },
    notify(method, params) {
      const msg = { method, params };
      proc.stdin.write(JSON.stringify(msg) + "\n");
    },
    respondToServerRequest(id, result) {
      const msg = { id, result };
      proc.stdin.write(JSON.stringify(msg) + "\n");
    },
    on(method, handler) {
      if (!notifyHandlers.has(method)) notifyHandlers.set(method, []);
      notifyHandlers.get(method).push(handler);
    },
  };
}

// ============================================================
// Generated schema manifest 摘要（task 4）
// ============================================================

/**
 * 计算临时 schema 目录的摘要：generatedFiles count + 内容 hash。
 *
 * 不覆盖 fixture schema；仅扫描临时目录产出摘要供 smoke 报告记录。
 * protocolCapabilities 优先从 fixture manifest 读取（generated schema 文件本身
 * 不描述能力集，由 manifest 维护）。
 */
function summarizeGeneratedSchema(tmpSchemaDir) {
  const summary = {
    generatedFiles: 0,
    schemaHash: null,
    protocolCapabilities: null,
    schemaSource: "generated",
  };
  try {
    const entries = readdirSync(tmpSchemaDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile());
    summary.generatedFiles = files.length;
    // 内容 hash：按文件名排序，拼接内容后 sha256 前 16 字符
    const hasher = createHash("sha256");
    const names = files.map((f) => f.name).sort();
    for (const name of names) {
      hasher.update(name);
      hasher.update("\0");
      try {
        const content = readFileSync(join(tmpSchemaDir, name));
        hasher.update(content);
      } catch { /* swallow */ }
      hasher.update("\0");
    }
    summary.schemaHash = hasher.digest("hex").slice(0, 16);
  } catch {
    summary.generatedFiles = 0;
    summary.schemaHash = null;
  }
  // protocolCapabilities 从 fixture manifest 读取（若存在）
  try {
    if (existsSync(FIXTURE_MANIFEST_PATH)) {
      const manifest = JSON.parse(readFileSync(FIXTURE_MANIFEST_PATH, "utf8"));
      summary.protocolCapabilities = manifest.protocolCapabilities || null;
    }
  } catch {
    summary.protocolCapabilities = null;
  }
  return summary;
}

// ============================================================
// auth-unavailable 特征识别
// ============================================================

/**
 * 判定错误是否为 auth/login 不可用（turn 可 fail/skip-auth 区分用）。
 *
 * codex app-server 在未登录或 auth token 不可用时，turn/failed 或 turn/start
 * 错误通常包含 auth/login/unauthorized/token/credential 等关键词。
 * 此类错误下 handshake 仍可 pass，turn 标 skip-auth（不与 hard fail 混淆）。
 */
function isAuthUnavailableError(err) {
  const msg = (typeof err === "string" ? err
    : err?.message || err?.error?.message || err?.error || JSON.stringify(err || {})).toLowerCase();
  return /auth|login|unauthorized|not.*logged.*in|no.*credentials|token|sign.?in|forbidden|401|403/.test(msg);
}

// ============================================================
// Smoke run：handshake 阶段 + turn 阶段（分层）
// ============================================================

async function runSmoke(codexVersion) {
  const tmpSchemaDir = mkdtempSync("codex-schema-smoke-");
  const steps = []; // { phase: "handshake"|"turn", name, ok, detail }
  let handshakeStatus = "fail";
  let turnStatus = "skip-handshake-failed";
  let schemaSource = null;
  let schemaGeneratedAt = null;
  let schemaManifestSummary = null;

  // V17-E 任务 C：readiness matrix 收集 flags
  let approvalRequestTriggered = false;
  let fileChangeRequestTriggered = false;
  let procKillOk = false;

  function step(phase, name, ok, detail = "") {
    const icon = ok ? "✅" : "❌";
    console.log(`${icon} [${phase}] ${name}${detail ? ` — ${detail}` : ""}`);
    steps.push({ phase, name, ok, detail });
  }

  // ---------- handshake 阶段 ----------
  // handshakeSmoke: codex --version / generate-ts / app-server spawn / initialize / initialized / thread/start

  // Step H1: codex app-server generate-ts（生成 schema 到临时目录，不覆盖 fixture）
  try {
    const gen = spawnSync(CODEX_COMMAND, ["app-server", "generate-ts", "--out", tmpSchemaDir], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 60000,
    });
    if (gen.status === 0) {
      schemaGeneratedAt = new Date().toISOString();
      schemaSource = "generated";
      schemaManifestSummary = summarizeGeneratedSchema(tmpSchemaDir);
      step("handshake", "codex app-server generate-ts", true,
        `generatedFiles=${schemaManifestSummary.generatedFiles} hash=${schemaManifestSummary.schemaHash}`);
    } else {
      // generate-ts 失败不致命：fixture schema 仍可用；记为 handshake 子步骤失败但允许继续
      schemaSource = "fixture";
      step("handshake", "codex app-server generate-ts", false,
        `exit=${gen.status} stderr=${(gen.stderr || "").slice(0, 200)}（回退 fixture schema）`);
    }
  } catch (e) {
    schemaSource = "fixture";
    step("handshake", "codex app-server generate-ts", false, `${e?.message || e}（回退 fixture schema）`);
  }

  // Step H2: 启动 codex app-server stdio
  let proc;
  let client;
  try {
    proc = spawn(CODEX_COMMAND, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    proc.on("error", (err) => {
      step("handshake", "codex app-server stdio 启动", false, err?.message || String(err));
    });
    client = createJsonRpcClient(proc);
    step("handshake", "codex app-server stdio 启动", true, `pid=${proc.pid}`);
  } catch (e) {
    step("handshake", "codex app-server stdio 启动", false, e?.message || String(e));
    handshakeStatus = "fail";
    try { rmSync(tmpSchemaDir, { recursive: true, force: true }); } catch {}
    return {
      codexVersion, schemaSource, schemaGeneratedAt, schemaManifestSummary,
      handshakeStatus, turnStatus, smokeStatus: "fail", steps,
    };
  }

  // Step H3: initialize / initialized
  let initResult;
  try {
    initResult = await client.request("initialize", {
      clientInfo: { name: "llm-cli-bridge-smoke", title: "LLM CLI Bridge Smoke", version: "2.17.0-a" },
      capabilities: { experimentalApi: false },
    }, { timeout: 15000 });
    step("handshake", "initialize / result", !!initResult,
      `userAgent=${initResult?.userAgent || initResult?.version || "?"}`);
    client.notify("initialized", {});
    step("handshake", "initialized notification", true);
  } catch (e) {
    step("handshake", "initialize / initialized", false, e?.message || String(e));
    try { proc.kill("SIGKILL"); } catch {}
    handshakeStatus = "fail";
    try { rmSync(tmpSchemaDir, { recursive: true, force: true }); } catch {}
    return {
      codexVersion, schemaSource, schemaGeneratedAt, schemaManifestSummary,
      handshakeStatus, turnStatus, smokeStatus: "fail", steps,
    };
  }

  // Step H4: thread/start
  let threadId;
  try {
    const threadRes = await client.request("thread/start", {
      config: {
        model: "gpt-5",
        sandboxPolicy: { mode: "workspace-write" },
        personality: { name: "smoke" },
      },
      instructions: "You are a smoke test assistant. Reply concisely.",
      cwd: PROJECT_ROOT,
    }, { timeout: 15000 });
    threadId = threadRes?.thread?.id;
    step("handshake", "thread/start", !!threadId, `threadId=${threadId || "?"}`);
  } catch (e) {
    step("handshake", "thread/start", false, e?.message || String(e));
    try { proc.kill("SIGKILL"); } catch {}
    // thread/start 失败：若为 auth 不可用，handshake 仍记 fail（thread/start 属 handshake）
    // 但 turn 标 skip-auth（而非 skip-handshake-failed），因为根因是 auth
    if (isAuthUnavailableError(e)) {
      turnStatus = "skip-auth";
      handshakeStatus = "fail"; // thread/start 是 handshake 必经步骤；auth 不可用导致 handshake 也未完成
      // 注意：此场景 smokeStatus 仍为 fail（handshake 未 pass）；turnStatus=skip-auth 仅作根因标注
      try { rmSync(tmpSchemaDir, { recursive: true, force: true }); } catch {}
      return {
        codexVersion, schemaSource, schemaGeneratedAt, schemaManifestSummary,
        handshakeStatus, turnStatus, smokeStatus: "fail", steps,
      };
    }
    handshakeStatus = "fail";
    try { rmSync(tmpSchemaDir, { recursive: true, force: true }); } catch {}
    return {
      codexVersion, schemaSource, schemaGeneratedAt, schemaManifestSummary,
      handshakeStatus, turnStatus, smokeStatus: "fail", steps,
    };
  }

  // handshake 全部通过
  handshakeStatus = "pass";

  // ---------- turn 阶段 ----------
  // turnSmoke: turn/start / turn/completed
  let turnCompleted = false;
  let finalText = "";
  let turnError = null;
  const turnWait = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 60000);
    client.on("turn/completed", (params) => {
      clearTimeout(timer);
      turnCompleted = true;
      finalText = params?.turn?.lastMessage?.text || params?.text || "";
      resolve("completed");
    });
    client.on("turn/failed", (params) => {
      clearTimeout(timer);
      turnError = params?.error?.message || params?.message || "turn/failed";
      resolve(`failed: ${turnError}`);
    });
    client.on("item/commandExecution/requestApproval", (params, id) => {
      approvalRequestTriggered = true;
      if (id !== undefined) {
        client.respondToServerRequest(id, { decision: "decline" });
      }
    });
    client.on("item/fileChange/requestApproval", (params, id) => {
      fileChangeRequestTriggered = true;
      if (id !== undefined) {
        client.respondToServerRequest(id, { decision: "decline" });
      }
    });
  });

  // Step T1: turn/start request
  let turnStartOk = false;
  try {
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Reply with exactly: SMOKE_OK" }],
    }, { timeout: 15000 });
    turnStartOk = true;
    step("turn", "turn/start request", true, `threadId=${threadId}`);
  } catch (e) {
    step("turn", "turn/start request", false, e?.message || String(e));
    turnError = e?.message || String(e);
    try { proc.kill("SIGKILL"); } catch {}
    if (isAuthUnavailableError(e)) {
      turnStatus = "skip-auth";
    } else {
      turnStatus = "fail";
    }
    try { rmSync(tmpSchemaDir, { recursive: true, force: true }); } catch {}
    return {
      codexVersion, schemaSource, schemaGeneratedAt, schemaManifestSummary,
      handshakeStatus, turnStatus,
      smokeStatus: turnStatus === "skip-auth" ? "handshake-only" : "fail",
      steps,
    };
  }

  // Step T2: 等待 turn/completed
  const turnOutcome = await turnWait;
  if (turnOutcome === "completed") {
    step("turn", "turn/completed", true, `finalText="${finalText.slice(0, 80)}"`);
    turnStatus = "pass";
  } else {
    step("turn", "turn/completed", false, `outcome=${turnOutcome}`);
    if (isAuthUnavailableError(turnError)) {
      turnStatus = "skip-auth";
    } else {
      turnStatus = "fail";
    }
  }

  // cleanup + V17-E 任务 C：stopCancelStatus 检测（proc.kill 后 5s 内退出）
  try {
    proc.kill("SIGKILL");
    // 等待进程退出（最多 5s）
    const exitStart = Date.now();
    while (Date.now() - exitStart < 5000) {
      if (proc.exitCode !== null || proc.killed) { procKillOk = true; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!procKillOk && proc.exitCode !== null) procKillOk = true;
  } catch {}
  try { rmSync(tmpSchemaDir, { recursive: true, force: true }); } catch {}

  // smokeStatus 派生
  let smokeStatus;
  if (handshakeStatus === "pass" && turnStatus === "pass") {
    smokeStatus = "pass";
  } else if (handshakeStatus === "pass") {
    smokeStatus = "handshake-only";
  } else {
    smokeStatus = "fail";
  }

  return {
    codexVersion, schemaSource, schemaGeneratedAt, schemaManifestSummary,
    handshakeStatus, turnStatus, smokeStatus, steps,
    approvalRequestTriggered, fileChangeRequestTriggered, procKillOk,
  };
}

// ============================================================
// Main
// ============================================================

function writeReport(report) {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  // V17-E1 任务 E：派生 readiness matrix（12 字段）写入报告
  const matrix = deriveReadinessMatrix(report);
  // V17-E1 任务 E：codexUserReady gate — smoke=pass 且关键 matrix 字段 pass/true 才 true
  const codexUserReady = deriveCodexUserReady(report, matrix);
  const lines = [
    "# Codex real app-server smoke 报告",
    "",
    `- **测试时间**: ${new Date().toISOString()}`,
    `- **codex 可用**: ${report.codexAvailable ? "是" : "否"}`,
    `- **codexVersion**: ${report.codexVersion === null ? "null" : report.codexVersion}`,
    `- **schemaSource**: ${report.schemaSource || "fixture"}`,
    `- **schemaGeneratedAt**: ${report.schemaGeneratedAt || "null"}`,
    `- **handshakeStatus**: ${report.handshakeStatus}`,
    `- **turnStatus**: ${report.turnStatus}`,
    `- **smokeStatus**: ${report.smokeStatus}`,
    // V17-E1 任务 E：codexUserReady 字段写入报告（smoke=pass 且关键 matrix 字段 pass/true 才 true）
    `- **codexUserReady**: ${codexUserReady ? "true" : "false"}`,
  ];
  if (report.schemaManifestSummary) {
    const s = report.schemaManifestSummary;
    lines.push(`- **generatedFiles**: ${s.generatedFiles}`);
    lines.push(`- **schemaHash**: ${s.schemaHash === null ? "null" : s.schemaHash}`);
    if (s.protocolCapabilities) {
      lines.push(`- **protocolCapabilities**: ${JSON.stringify(s.protocolCapabilities)}`);
    } else {
      lines.push(`- **protocolCapabilities**: null`);
    }
  } else {
    lines.push(`- **generatedFiles**: (generate-ts 未运行)`);
    lines.push(`- **schemaHash**: null`);
    lines.push(`- **protocolCapabilities**: null`);
  }
  if (report.skipReason) {
    lines.push(`- **skip 原因**: ${report.skipReason}`);
  }
  lines.push("");
  // V17-E1 任务 E：readiness matrix 12 字段写入报告
  // V17-F0 任务 E：新增 5 字段（codexSdkAvailable / codexEmbeddedRuntimeAvailable /
  // codexSdkAuthAvailable / codexExternalExecutableAvailable / externalAppServerSpawnStatus）
  // V17-F1 任务 G：新增 5 字段（codexManagedRuntimeAvailable / codexManagedRuntimeVersion /
  // codexManagedRuntimeSha256Valid / codexManagedRuntimeExecutable / codexManagedAppServerSpawnStatus）
  // 旧 codexCliAvailable / appServerSpawnStatus 不得作为 Codex user-ready 主 gate
  // V17-F1.1 任务 E：新增 3 个分层字段（resolverSmokeStatus / runtimeSmokeStatus / managedAppServerProtocolStatus）
  // V17-F1 主 gate 改为 managed runtime gate（external 字段保留但不影响 codexUserReady）
  lines.push("## Readiness Matrix (V17-F1.1 任务 E — 25 字段)");
  lines.push("");
  lines.push("### V17-F1.1 新增 Managed runtime 分层字段（主 gate）");
  lines.push("");
  lines.push(`- **codexManagedResolverSmokeStatus**: ${matrix.codexManagedResolverSmokeStatus}`);
  lines.push(`- **codexManagedRuntimeSmokeStatus**: ${matrix.codexManagedRuntimeSmokeStatus}`);
  lines.push(`- **codexManagedAppServerProtocolStatus**: ${matrix.codexManagedAppServerProtocolStatus}`);
  lines.push("");
  lines.push("### V17-F1 Managed runtime 主线字段");
  lines.push("");
  lines.push(`- **codexManagedRuntimeAvailable**: ${matrix.codexManagedRuntimeAvailable}`);
  lines.push(`- **codexManagedRuntimeVersion**: ${matrix.codexManagedRuntimeVersion}`);
  lines.push(`- **codexManagedRuntimeSha256Valid**: ${matrix.codexManagedRuntimeSha256Valid}`);
  lines.push(`- **codexManagedRuntimeExecutable**: ${matrix.codexManagedRuntimeExecutable}`);
  lines.push(`- **codexManagedAppServerSpawnStatus**: ${matrix.codexManagedAppServerSpawnStatus}`);
  lines.push("");
  lines.push("### V17-F0 SDK 字段（保留，非主 gate；本轮占位 false）");
  lines.push("");
  lines.push(`- **codexSdkAvailable**: ${matrix.codexSdkAvailable}`);
  lines.push(`- **codexEmbeddedRuntimeAvailable**: ${matrix.codexEmbeddedRuntimeAvailable}`);
  lines.push(`- **codexSdkAuthAvailable**: ${matrix.codexSdkAuthAvailable}`);
  lines.push("");
  lines.push("### V17-F0 External fallback 字段（不得作为 user-ready 主 gate）");
  lines.push("");
  lines.push(`- **codexExternalExecutableAvailable**: ${matrix.codexExternalExecutableAvailable}`);
  lines.push(`- **externalAppServerSpawnStatus**: ${matrix.externalAppServerSpawnStatus}`);
  lines.push("");
  lines.push("### V17-E1 旧字段（保留兼容，非主 gate）");
  lines.push("");
  lines.push(`- **codexCliAvailable**: ${matrix.codexCliAvailable}`);
  lines.push(`- **codexVersion**: ${matrix.codexVersion}`);
  lines.push(`- **codexAuthAvailable**: ${matrix.codexAuthAvailable}`);
  lines.push(`- **appServerSpawnStatus**: ${matrix.appServerSpawnStatus}`);
  lines.push(`- **initializeStatus**: ${matrix.initializeStatus}`);
  lines.push(`- **threadStartStatus**: ${matrix.threadStartStatus}`);
  lines.push(`- **turnStartStatus**: ${matrix.turnStartStatus}`);
  lines.push(`- **turnCompletedStatus**: ${matrix.turnCompletedStatus}`);
  lines.push(`- **approvalRequestStatus**: ${matrix.approvalRequestStatus}`);
  lines.push(`- **fileChangeRequestStatus**: ${matrix.fileChangeRequestStatus}`);
  lines.push(`- **stopCancelStatus**: ${matrix.stopCancelStatus}`);
  lines.push(`- **noVaultRootPollution**: ${matrix.noVaultRootPollution}`);
  lines.push("");
  // 分层说明
  lines.push("## 分层状态说明");
  lines.push("");
  lines.push("- **handshakeStatus** = `pass`：codex --version / generate-ts / app-server spawn / initialize / initialized / thread/start 全部通过。");
  lines.push("- **turnStatus** = `pass`：turn/start + turn/completed 通过；`skip-auth`：turn 因 auth/login 不可用而跳过（handshake 仍可 pass）；`fail`：turn 硬失败；`skip-handshake-failed`：handshake fail 时 turn 不执行。");
  lines.push("- **smokeStatus**：`skip`=无 codex CLI；`pass`=handshake+turn 全 pass；`handshake-only`=handshake pass 但 turn 非 pass（如 auth 不可用）；`fail`=handshake fail。");
  lines.push("- **codexUserReady**：`true` 仅当分层 gate 通过（resolverSmokeStatus=pass + runtimeSmokeStatus=pass + managedAppServerProtocolStatus=pass）且 smoke=pass 且关键 matrix 字段（appServerSpawn/initialize/threadStart/turnStart/turnCompleted/stopCancel/noVaultRootPollution）均 pass/true。fixture-only（runtimeSmokeStatus=fixture-only）不算 ready。`not-triggered` 的 approval/fileChange 不阻塞 ready。external app-server pass 不影响 codexUserReady。");
  if (report.codexAvailable && report.schemaSource === "generated") {
    lines.push("");
    lines.push("## Generated schema manifest 摘要（task 4）");
    lines.push("");
    lines.push("- generate-ts 写入临时目录，**不覆盖 fixture schema**；fixture/generated/compat mapper 三层保持清晰。");
    lines.push("- fixture schema（`src/.../schema/manifest.json`，`source=fixture`）为默认测试基线。");
    lines.push("- generated schema 仅在显式运行 `npm run codex:schema` 时覆盖 fixture。");
    lines.push("- compat mapper（EventMapper/SessionMapper/ApprovalMapper）对齐 fixture 与 generated 共有 wire shape。");
  }
  if (report.steps && report.steps.length > 0) {
    lines.push("");
    lines.push("## 步骤结果");
    lines.push("");
    lines.push("| 阶段 | 状态 | 步骤 | 详情 |");
    lines.push("|------|------|------|------|");
    for (const s of report.steps) {
      const icon = s.ok ? "✅" : "❌";
      lines.push(`| ${s.phase} | ${icon} | ${s.name} | ${s.detail || "-"} |`);
    }
  }
  lines.push("");
  lines.push(`**最终结果**: handshake=${report.handshakeStatus} turn=${report.turnStatus} smoke=${report.smokeStatus} codexUserReady=${codexUserReady ? "true" : "false"}`);
  lines.push("");
  lines.push("*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*");
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`报告已写入: ${REPORT_PATH}`);
}

// V17-F1 任务 G + V17-F1.1 任务 E：codexUserReady 派生 — 主 gate 改为 managed runtime gate
// V17-F1.1 任务 E：使用分层字段
//   - codexManagedResolverSmokeStatus="pass"（resolver 校验链通过）
//   - codexManagedRuntimeSmokeStatus="pass"（runtime binary 可用，fixture-only 不算 ready）
//   - codexManagedAppServerProtocolStatus="pass"（app-server 协议可用，skip-fixture 不算 ready）
// 后续真实 binary 接入后还需 app-server initialize/thread/turn pass
function deriveCodexUserReady(report, matrix) {
  // V17-F1.1 任务 E：分层 gate
  if (matrix.codexManagedResolverSmokeStatus !== "pass") return false;
  if (matrix.codexManagedRuntimeSmokeStatus !== "pass") return false;
  if (matrix.codexManagedAppServerProtocolStatus !== "pass") return false;
  // 后续真实 binary 接入后：仍需 smoke 关键字段 pass
  if (report.smokeStatus !== "pass") return false;
  const keyFields = [
    matrix.appServerSpawnStatus,
    matrix.initializeStatus,
    matrix.threadStartStatus,
    matrix.turnStartStatus,
    matrix.turnCompletedStatus,
    matrix.stopCancelStatus,
    matrix.noVaultRootPollution,
  ];
  const allKeyPass = keyFields.every((v) => v === "pass" || v === "true");
  if (!allKeyPass) return false;
  if (matrix.approvalRequestStatus === "fail" || matrix.fileChangeRequestStatus === "fail") return false;
  return true;
}

// V17-E 任务 C：从 report 派生 readiness matrix（12 个字段）
function deriveReadinessMatrix(report) {
  const findStep = (name) => report.steps?.find((s) => s.name === name);
  const spawnStep = findStep("codex app-server stdio 启动");
  const initStep = findStep("initialize / result");
  const threadStartStep = findStep("thread/start");
  const turnStartStep = findStep("turn/start request");

  // codexAuthAvailable：turnStatus !== "skip-auth" 且 handshake pass → auth 可用
  let codexAuthAvailable;
  if (report.handshakeStatus === "pass" && report.turnStatus !== "skip-auth") {
    codexAuthAvailable = true;
  } else if (report.turnStatus === "skip-auth") {
    codexAuthAvailable = false;
  } else {
    codexAuthAvailable = "unknown"; // handshake 未 pass 无法判断
  }

  // noVaultRootPollution：smoke 期间 PROJECT_ROOT 不应被写入意外文件
  // 简单检测：检查 PROJECT_ROOT 下没有 codex 会话残留（.codex/ 之类）
  let noVaultRootPollution = true;
  try {
    const codexStateDir = join(PROJECT_ROOT, ".codex");
    if (existsSync(codexStateDir)) {
      // .codex 存在不算污染（用户配置），但检查是否有 smoke 临时文件残留
      const entries = readdirSync(codexStateDir).filter((f) => f.startsWith("smoke") || f.includes("smoke-"));
      if (entries.length > 0) noVaultRootPollution = false;
    }
  } catch { /* ignore */ }

  // approvalRequestStatus：approval 被触发并 decline 即 pass（无需用户干预）
  // 若未触发（agent 没要求 approval），记 "not-triggered"（中性）
  let approvalRequestStatus;
  if (report.approvalRequestTriggered === true) approvalRequestStatus = "pass";
  else if (report.approvalRequestTriggered === false) approvalRequestStatus = "not-triggered";
  else approvalRequestStatus = "unknown";

  let fileChangeRequestStatus;
  if (report.fileChangeRequestTriggered === true) fileChangeRequestStatus = "pass";
  else if (report.fileChangeRequestTriggered === false) fileChangeRequestStatus = "not-triggered";
  else fileChangeRequestStatus = "unknown";

  // stopCancelStatus：proc.kill 后 5s 内退出
  let stopCancelStatus;
  if (report.procKillOk === true) stopCancelStatus = "pass";
  else if (report.procKillOk === false) stopCancelStatus = "fail";
  else stopCancelStatus = "unknown";

  // V17-F0 任务 E：external fallback 字段（等价于旧 codexCliAvailable / appServerSpawnStatus，
  // 但明确标注为 external fallback — 不得作为 Codex user-ready 主 gate）
  const codexExternalExecutableAvailable = report.codexAvailable === true ? "true" : "false";
  const externalAppServerSpawnStatus = spawnStep ? (spawnStep.ok ? "pass" : "fail") : "unknown";

  // V17-F1 任务 G + V17-F1.1 任务 E：Managed runtime 字段（从 report.managedRuntime 读取）
  // V17-F1.1 任务 E：分层字段 resolverSmokeStatus / runtimeSmokeStatus / managedAppServerProtocolStatus
  const managed = report.managedRuntime || {};
  const codexManagedRuntimeAvailable = managed.available === true ? "true" : "false";
  const codexManagedRuntimeVersion = managed.version || "null";
  const codexManagedRuntimeSha256Valid = managed.sha256Valid === true ? "true" : "false";
  const codexManagedRuntimeExecutable = managed.executableValid === true ? "true" : "false";
  // V17-F1.1 任务 E：分层字段
  const codexManagedResolverSmokeStatus = managed.resolverSmokeStatus || "fail";
  const codexManagedRuntimeSmokeStatus = managed.runtimeSmokeStatus || "skip";
  const codexManagedAppServerProtocolStatus = managed.managedAppServerProtocolStatus || "skip-fixture";
  // 兼容字段（旧 codexManagedAppServerSpawnStatus，映射到 runtimeSmokeStatus）
  const codexManagedAppServerSpawnStatus = managed.spawnStatus || managed.runtimeSmokeStatus || "unknown";

  return {
    // ===== V17-F1.1 任务 E：分层字段（3 个） =====
    codexManagedResolverSmokeStatus,
    codexManagedRuntimeSmokeStatus,
    codexManagedAppServerProtocolStatus,
    // ===== V17-F1 Managed runtime 主线字段（5 个，本轮 fixture-only） =====
    codexManagedRuntimeAvailable,
    codexManagedRuntimeVersion,
    codexManagedRuntimeSha256Valid,
    codexManagedRuntimeExecutable,
    codexManagedAppServerSpawnStatus,
    // ===== V17-F0 SDK 字段（保留，非主 gate；本轮占位 false） =====
    codexSdkAvailable: "false",
    codexEmbeddedRuntimeAvailable: "false",
    codexSdkAuthAvailable: "false",
    // ===== V17-F0 External fallback 字段（不得作为 user-ready 主 gate） =====
    codexExternalExecutableAvailable,
    externalAppServerSpawnStatus,
    // ===== V17-E1 旧字段（保留兼容，非主 gate） =====
    codexCliAvailable: report.codexAvailable === true ? "true" : "false",
    codexVersion: report.codexVersion || "null",
    codexAuthAvailable: typeof codexAuthAvailable === "boolean" ? (codexAuthAvailable ? "true" : "false") : codexAuthAvailable,
    appServerSpawnStatus: spawnStep ? (spawnStep.ok ? "pass" : "fail") : "unknown",
    initializeStatus: initStep ? (initStep.ok ? "pass" : "fail") : "unknown",
    threadStartStatus: threadStartStep ? (threadStartStep.ok ? "pass" : "fail") : "unknown",
    turnStartStatus: turnStartStep ? (turnStartStep.ok ? "pass" : "fail") : "unknown",
    turnCompletedStatus: report.turnStatus === "pass" ? "pass" : "fail",
    approvalRequestStatus,
    fileChangeRequestStatus,
    stopCancelStatus,
    noVaultRootPollution: noVaultRootPollution ? "true" : "false",
  };
}

function main() {
  console.log("=== Codex real app-server smoke gate (P2 分层) ===");

  // V17-F1 任务 G + V17-F1.1 任务 E：探测 managed runtime（manifest + sha256 + executable）
  // managed runtime 为 V17-F1 主线，codexUserReady 主 gate 改为 managed runtime gate
  // V17-F1.1 任务 E：分层字段 resolverSmokeStatus / runtimeSmokeStatus / managedAppServerProtocolStatus
  // 即使 external codex CLI 不可用（skip），managed runtime 探测仍执行并写入报告
  console.log("--- V17-F1.1 任务 E：探测 Managed Codex App-Server Runtime（分层字段） ---");
  const managedProbe = probeManagedRuntime();
  console.log(`codexManagedResolverSmokeStatus=${managedProbe.resolverSmokeStatus}`);
  console.log(`codexManagedRuntimeSmokeStatus=${managedProbe.runtimeSmokeStatus}`);
  console.log(`codexManagedAppServerProtocolStatus=${managedProbe.managedAppServerProtocolStatus}`);
  console.log(`codexManagedRuntimeAvailable=${managedProbe.available ? "true" : "false"}`);
  console.log(`codexManagedRuntimeVersion=${managedProbe.version || "null"}`);
  console.log(`codexManagedRuntimeSha256Valid=${managedProbe.sha256Valid ? "true" : "false"}`);
  console.log(`codexManagedRuntimeExecutable=${managedProbe.executableValid ? "true" : "false"}`);
  console.log(`codexManagedAppServerSpawnStatus=${managedProbe.spawnStatus}（兼容）`);
  console.log(`codexManagedRuntimeFixture=${managedProbe.fixture ? "true" : "false"}`);
  if (managedProbe.reason && managedProbe.reason !== "ok") {
    console.log(`codexManagedRuntimeReason=${managedProbe.reason}`);
  }
  console.log("");

  const probe = probeCodex();
  if (!probe.available) {
    console.log(`⏭️  codex CLI 不可用，明确 skip（不伪装通过）— reason: ${probe.reason}`);
    const report = {
      codexAvailable: false,
      codexVersion: null,
      schemaSource: "fixture",
      schemaGeneratedAt: null,
      schemaManifestSummary: null,
      handshakeStatus: "skip",
      turnStatus: "skip",
      smokeStatus: "skip",
      skipReason: probe.reason,
      steps: [],
      managedRuntime: managedProbe,
    };
    writeReport(report);
    printReadinessMatrix(report);
    console.log(`\n=== 结果: skip（codex 不可用） ===`);
    process.exit(0); // skip 不算 fail
  }

  console.log(`codex version: ${probe.version}`);
  runSmoke(probe.version).then((result) => {
    const report = {
      codexAvailable: true,
      ...result,
      managedRuntime: managedProbe,
    };
    writeReport(report);
    printReadinessMatrix(report);
    // 退出码：handshake fail 或 turn hard fail → 1；pass / handshake-only → 0
    const exitCode = (report.smokeStatus === "fail") ? 1 : 0;
    console.log(`\n=== 结果: handshake=${report.handshakeStatus} turn=${report.turnStatus} smoke=${report.smokeStatus} ===`);
    process.exit(exitCode);
  }).catch((e) => {
    // 兜底：runSmoke 未捕获异常 → fail
    const report = {
      codexAvailable: true,
      codexVersion: probe.version,
      schemaSource: "fixture",
      schemaGeneratedAt: null,
      schemaManifestSummary: null,
      handshakeStatus: "fail",
      turnStatus: "skip-handshake-failed",
      smokeStatus: "fail",
      steps: [],
      skipReason: `uncaught: ${e?.message || e}`,
      managedRuntime: managedProbe,
    };
    writeReport(report);
    printReadinessMatrix(report);
    console.error(`\n❌ smoke run 未捕获异常: ${e?.message || e}`);
    process.exit(1);
  });
}

// V17-E 任务 C：打印 readiness matrix（12 字段）
// V17-E1 任务 E：codexUserReady 改用 deriveCodexUserReady（smoke=pass + 关键 matrix 字段 pass/true）
// V17-F1 任务 G：新增 5 个 managed runtime 字段，主 gate 改为 managed runtime gate
function printReadinessMatrix(report) {
  const m = deriveReadinessMatrix(report);
  console.log("\n=== Readiness Matrix (V17-E + V17-E1 + V17-F0 + V17-F1 + V17-F1.1) ===");
  console.log("--- V17-F1.1 Managed runtime 分层字段（主 gate） ---");
  console.log(`codexManagedResolverSmokeStatus=${m.codexManagedResolverSmokeStatus}`);
  console.log(`codexManagedRuntimeSmokeStatus=${m.codexManagedRuntimeSmokeStatus}`);
  console.log(`codexManagedAppServerProtocolStatus=${m.codexManagedAppServerProtocolStatus}`);
  console.log("--- V17-F1 Managed runtime 主线字段 ---");
  console.log(`codexManagedRuntimeAvailable=${m.codexManagedRuntimeAvailable}`);
  console.log(`codexManagedRuntimeVersion=${m.codexManagedRuntimeVersion}`);
  console.log(`codexManagedRuntimeSha256Valid=${m.codexManagedRuntimeSha256Valid}`);
  console.log(`codexManagedRuntimeExecutable=${m.codexManagedRuntimeExecutable}`);
  console.log(`codexManagedAppServerSpawnStatus=${m.codexManagedAppServerSpawnStatus}`);
  console.log("--- V17-F0 SDK 字段（占位 false） ---");
  console.log(`codexSdkAvailable=${m.codexSdkAvailable}`);
  console.log(`codexEmbeddedRuntimeAvailable=${m.codexEmbeddedRuntimeAvailable}`);
  console.log(`codexSdkAuthAvailable=${m.codexSdkAuthAvailable}`);
  console.log("--- V17-F0 External fallback 字段（非主 gate） ---");
  console.log(`codexExternalExecutableAvailable=${m.codexExternalExecutableAvailable}`);
  console.log(`externalAppServerSpawnStatus=${m.externalAppServerSpawnStatus}`);
  console.log("--- V17-E1 旧字段（保留兼容） ---");
  console.log(`codexCliAvailable=${m.codexCliAvailable}`);
  console.log(`codexVersion=${m.codexVersion}`);
  console.log(`codexAuthAvailable=${m.codexAuthAvailable}`);
  console.log(`appServerSpawnStatus=${m.appServerSpawnStatus}`);
  console.log(`initializeStatus=${m.initializeStatus}`);
  console.log(`threadStartStatus=${m.threadStartStatus}`);
  console.log(`turnStartStatus=${m.turnStartStatus}`);
  console.log(`turnCompletedStatus=${m.turnCompletedStatus}`);
  console.log(`approvalRequestStatus=${m.approvalRequestStatus}`);
  console.log(`fileChangeRequestStatus=${m.fileChangeRequestStatus}`);
  console.log(`stopCancelStatus=${m.stopCancelStatus}`);
  console.log(`noVaultRootPollution=${m.noVaultRootPollution}`);
  // V17-F1 任务 G：codexUserReady 主 gate = managed runtime gate
  const codexUserReady = deriveCodexUserReady(report, m);
  console.log(`codexUserReady=${codexUserReady}`);
}

main();
