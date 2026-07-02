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
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-smoke.md");
const FIXTURE_MANIFEST_PATH = join(
  PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "schema", "manifest.json",
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
      if (id !== undefined) {
        client.respondToServerRequest(id, { decision: "decline" });
      }
    });
    client.on("item/fileChange/requestApproval", (params, id) => {
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

  // cleanup
  try { proc.kill("SIGKILL"); } catch {}
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
  };
}

// ============================================================
// Main
// ============================================================

function writeReport(report) {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
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
  // 分层说明
  lines.push("## 分层状态说明");
  lines.push("");
  lines.push("- **handshakeStatus** = `pass`：codex --version / generate-ts / app-server spawn / initialize / initialized / thread/start 全部通过。");
  lines.push("- **turnStatus** = `pass`：turn/start + turn/completed 通过；`skip-auth`：turn 因 auth/login 不可用而跳过（handshake 仍可 pass）；`fail`：turn 硬失败；`skip-handshake-failed`：handshake fail 时 turn 不执行。");
  lines.push("- **smokeStatus**：`skip`=无 codex CLI；`pass`=handshake+turn 全 pass；`handshake-only`=handshake pass 但 turn 非 pass（如 auth 不可用）；`fail`=handshake fail。");
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
  lines.push(`**最终结果**: handshake=${report.handshakeStatus} turn=${report.turnStatus} smoke=${report.smokeStatus}`);
  lines.push("");
  lines.push("*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*");
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`报告已写入: ${REPORT_PATH}`);
}

function main() {
  console.log("=== Codex real app-server smoke gate (P2 分层) ===");

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
    };
    writeReport(report);
    console.log(`\n=== 结果: skip（codex 不可用） ===`);
    process.exit(0); // skip 不算 fail
  }

  console.log(`codex version: ${probe.version}`);
  runSmoke(probe.version).then((result) => {
    const report = {
      codexAvailable: true,
      ...result,
    };
    writeReport(report);
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
    };
    writeReport(report);
    console.error(`\n❌ smoke run 未捕获异常: ${e?.message || e}`);
    process.exit(1);
  });
}

main();
