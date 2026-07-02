#!/usr/bin/env node
// LLM CLI Bridge — Codex real app-server smoke gate (V2.17-A Completion)
//
// 若本机有 codex CLI，则跑一次真实 codex app-server JSON-RPC 闭环：
//   codex --version
//   codex app-server generate-ts --out ...（生成的 schema 暂存临时目录，不覆盖 fixture）
//   启动 codex app-server stdio
//   initialize / initialized
//   thread/start
//   turn/start 简单只读请求
//   等待 turn/completed
//
// 若本机无 codex CLI，明确 skip（不伪装通过）。
//
// 运行：node scripts/codex-app-server-smoke.mjs
// 或：  npm run smoke:codex-app-server
//
// 输出：
// - stdout: 每一步进展
// - 退出码：0=通过/skip；1=有 codex 但跑不通（fail）
// - 结果记录到 docs/test-report-codex-smoke.md（仅 real smoke run，skip 时不覆盖）

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-smoke.md");

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
    // 按行解析（codex app-server 每条 message 一行 JSON）
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
        // notification 或 server-initiated request（有 id）
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
// Smoke run
// ============================================================

async function runSmoke(codexVersion) {
  const tmpSchemaDir = mkdtempSync("codex-schema-smoke-");
  const results = { steps: [], codexVersion, schemaGeneratedAt: null, schemaSource: null };
  let exitCode = 0;

  function step(name, ok, detail = "") {
    const icon = ok ? "✅" : "❌";
    console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
    results.steps.push({ name, ok, detail });
    if (!ok) exitCode = 1;
  }

  // Step 1: codex app-server generate-ts（生成 schema 到临时目录）
  try {
    const gen = spawnSync(CODEX_COMMAND, ["app-server", "generate-ts", "--out", tmpSchemaDir], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 60000,
    });
    if (gen.status === 0) {
      results.schemaGeneratedAt = new Date().toISOString();
      results.schemaSource = "generated";
      step("codex app-server generate-ts", true, `生成到 ${tmpSchemaDir}`);
    } else {
      step("codex app-server generate-ts", false, `exit=${gen.status} stderr=${(gen.stderr || "").slice(0, 200)}`);
    }
  } catch (e) {
    step("codex app-server generate-ts", false, e?.message || String(e));
  }

  // Step 2: 启动 codex app-server stdio
  let proc;
  let client;
  try {
    proc = spawn(CODEX_COMMAND, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    proc.on("error", (err) => {
      step("codex app-server stdio 启动", false, err?.message || String(err));
    });
    client = createJsonRpcClient(proc);
    step("codex app-server stdio 启动", true, `pid=${proc.pid}`);
  } catch (e) {
    step("codex app-server stdio 启动", false, e?.message || String(e));
    return { results, exitCode: 1 };
  }

  // Step 3: initialize / initialized
  let initResult;
  try {
    initResult = await client.request("initialize", {
      clientInfo: { name: "llm-cli-bridge-smoke", title: "LLM CLI Bridge Smoke", version: "2.17.0-a" },
      capabilities: { experimentalApi: false },
    }, { timeout: 15000 });
    step("initialize / result", !!initResult, `userAgent=${initResult?.userAgent || initResult?.version || "?"}`);
    client.notify("initialized", {});
    step("initialized notification", true);
  } catch (e) {
    step("initialize / initialized", false, e?.message || String(e));
    proc.kill("SIGKILL");
    return { results, exitCode: 1 };
  }

  // Step 4: thread/start
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
    step("thread/start", !!threadId, `threadId=${threadId || "?"}`);
  } catch (e) {
    step("thread/start", false, e?.message || String(e));
    proc.kill("SIGKILL");
    return { results, exitCode: 1 };
  }

  // Step 5: turn/start（简单只读请求）
  let turnCompleted = false;
  let finalText = "";
  let approvalSeen = false;
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
      resolve(`failed: ${params?.error?.message || params?.message || "?"}`);
    });
    client.on("item/commandExecution/requestApproval", (params, id) => {
      approvalSeen = true;
      // 只读 smoke 不应触发命令执行 approval；若触发，自动 decline 以避免副作用
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

  try {
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Reply with exactly: SMOKE_OK" }],
    }, { timeout: 15000 });
    step("turn/start request", true, `threadId=${threadId}`);
  } catch (e) {
    step("turn/start request", false, e?.message || String(e));
    proc.kill("SIGKILL");
    return { results, exitCode: 1 };
  }

  const turnOutcome = await turnWait;
  step("turn/completed", turnOutcome === "completed", `outcome=${turnOutcome} finalText="${finalText.slice(0, 80)}"`);

  // cleanup
  try { proc.kill("SIGKILL"); } catch {}
  try { rmSync(tmpSchemaDir, { recursive: true, force: true }); } catch {}

  return { results, exitCode };
}

// ============================================================
// Main
// ============================================================

function main() {
  console.log("=== Codex real app-server smoke gate ===");

  const probe = probeCodex();
  if (!probe.available) {
    console.log(`⏭️  codex CLI 不可用，明确 skip（不伪装通过）— reason: ${probe.reason}`);
    if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
    const report = [
      "# Codex real app-server smoke 报告",
      "",
      `- **测试时间**: ${new Date().toISOString()}`,
      `- **codex 可用**: 否`,
      `- **codexVersion**: null`,
      `- **schemaSource**: fixture`,
      `- **schemaGeneratedAt**: null`,
      `- **smokeStatus**: skip`,
      `- **skip 原因**: ${probe.reason}`,
      `- **说明**: 本机无 codex CLI，real app-server smoke 明确 skip（smokeStatus=skip，不伪装 pass）。`,
      `  fixture schema tests 仍覆盖协议映射；real smoke 在 codex 可用环境（CI 装有 codex / 开发者本机）运行 \`npm run smoke:codex-app-server\`。`,
      "",
      "*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*",
    ].join("\n");
    writeFileSync(REPORT_PATH, report + "\n", "utf8");
    console.log(`报告已写入: ${REPORT_PATH}`);
    process.exit(0); // skip 不算 fail
  }

  console.log(`codex version: ${probe.version}`);
  runSmoke(probe.version).then(({ results, exitCode }) => {
    if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
    const lines = [
      "# Codex real app-server smoke 报告",
      "",
      `- **测试时间**: ${new Date().toISOString()}`,
      `- **codex 可用**: 是`,
      `- **codexVersion**: ${results.codexVersion}`,
      `- **schemaSource**: ${results.schemaSource || "未生成"}`,
      `- **schemaGeneratedAt**: ${results.schemaGeneratedAt || "null"}`,
      `- **smokeStatus**: ${exitCode === 0 ? "pass" : "fail"}`,
      "",
      "## 步骤结果",
      "",
      "| 状态 | 步骤 | 详情 |",
      "|------|------|------|",
    ];
    for (const s of results.steps) {
      const icon = s.ok ? "✅" : "❌";
      lines.push(`| ${icon} | ${s.name} | ${s.detail || "-"} |`);
    }
    lines.push("");
    lines.push(`**最终结果**: ${exitCode === 0 ? "✅ 通过" : "❌ 失败"}`);
    lines.push("");
    lines.push("*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*");
    writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
    console.log(`报告已写入: ${REPORT_PATH}`);
    console.log(`\n=== 结果: ${exitCode === 0 ? "通过" : "失败"} ===`);
    process.exit(exitCode);
  });
}

main();
