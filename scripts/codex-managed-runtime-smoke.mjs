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
import { fileURLToPath } from "node:url";

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
  stopCancelStatus: "unknown",
  noVaultRootPollution: "unknown",
  selectedModel: null,
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
    const turnWait = new Promise((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise("timeout"), 90000);
      client.on("turn/completed", (params) => {
        clearTimeout(timer);
        resolvePromise(params);
      });
      client.on("error", (params) => {
        turnError = params?.error?.message || params?.message || JSON.stringify(params);
      });
    });
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Reply with exactly: SMOKE_OK", text_elements: [] }],
    }, 20000);
    report.turnStartStatus = "pass";
    step("turn/start", true);

    const turnResult = await turnWait;
    if (turnResult === "timeout") throw new Error(`turn/completed timeout${turnError ? `; last error: ${turnError}` : ""}`);
    report.turnCompletedStatus = "pass";
    step("turn/completed", true);
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

function deriveCodexUserReady() {
  return report.resolverSmokeStatus === "pass"
    && report.runtimeSmokeStatus === "pass"
    && report.managedAppServerProtocolStatus === "pass"
    && report.appServerSpawnStatus === "pass"
    && report.initializeStatus === "pass"
    && report.initializedStatus === "pass"
    && report.threadStartStatus === "pass"
    && report.turnStartStatus === "pass"
    && report.turnCompletedStatus === "pass"
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
    `- **stopCancelStatus**: ${report.stopCancelStatus}`,
    `- **noVaultRootPollution**: ${report.noVaultRootPollution}`,
    `- **selectedModel**: ${report.selectedModel || "null"}`,
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
    "- `codexUserReady=true` 只允许 resolver/runtime/protocol 三层均 pass。",
    "- production manifest 下 `skip-fixture` 不允许通过。",
    "- external codex CLI/app-server 不参与本报告 gate。",
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
      step("protocol smoke", true, "skip-fixture");
    } else {
      await runProtocolSmoke(resolvedRuntime.runtimePath, resolvedRuntime.appServerArgs);
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
  console.log(`codexUserReady=${report.codexUserReady ? "true" : "false"}`);

  if (report.manifestFixture) {
    process.exit(report.resolverSmokeStatus === "pass" && report.managedAppServerProtocolStatus === "skip-fixture" ? 0 : 1);
  }
  process.exit(report.codexUserReady ? 0 : 1);
}

main();
