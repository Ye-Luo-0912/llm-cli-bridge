#!/usr/bin/env node
// LLM CLI Bridge — Codex app-server schema generator (Round 1)
//
// 优先顺序：CODEX_COMMAND → managed codex.exe（runtime-manifest）→ PATH `codex`
// 生成物写入 schema/generated/；Bridge 适配层仍为 schema/index.ts。
//
// 用法：node scripts/generate-codex-schema.mjs
// 或：  npm run codex:schema

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  cpSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const SCHEMA_DIR = join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "schema");
const GENERATED_DIR = join(SCHEMA_DIR, "generated");
const MANIFEST_PATH = join(SCHEMA_DIR, "manifest.json");
const MANAGED_RUNTIME_MANIFEST = join(
  PROJECT_ROOT,
  "src",
  "runtime",
  "providers",
  "codex-managed-app-server",
  "runtime-manifest.json",
);

function fail(msg, code = 1) {
  console.error(`[generate-codex-schema] ${msg}`);
  process.exit(code);
}

function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") return "win32-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  return `${platform}-${arch}`;
}

/** 在常见 Obsidian 插件安装目录中查找已安装的 managed runtime */
function findInstalledManagedCodex() {
  const homes = [
    process.env.OBSIDIAN_VAULT_PLUGIN_DIR,
    join("D:", "Users", "Ye_Luo", "APP", "Obsidian", "LLM-Wiki", ".obsidian", "plugins", "llm-cli-bridge"),
    join("D:", "Users", "Ye_Luo", "APP", "Test", "Obsidian", "LLM-Wiki", ".obsidian", "plugins", "llm-cli-bridge"),
  ].filter(Boolean);

  for (const pluginDir of homes) {
    const manifestPath = join(pluginDir, "codex-managed-runtime", "runtime-manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const entry = manifest.platforms?.[platformKey()];
      if (!entry?.path) continue;
      const exe = resolve(dirname(manifestPath), entry.path);
      if (existsSync(exe)) {
        return { command: exe, version: manifest.version || null, source: "installed-managed-runtime" };
      }
    } catch {
      // continue
    }
  }
  return null;
}

function resolveCodexCommand() {
  if (process.env.CODEX_COMMAND) {
    return { command: process.env.CODEX_COMMAND, version: null, source: "CODEX_COMMAND" };
  }

  // 仓库内 runtime-manifest（可能尚未下载 binary）
  if (existsSync(MANAGED_RUNTIME_MANIFEST)) {
    try {
      const manifest = JSON.parse(readFileSync(MANAGED_RUNTIME_MANIFEST, "utf8"));
      const entry = manifest.platforms?.[platformKey()];
      if (entry?.path) {
        const candidates = [
          resolve(dirname(MANAGED_RUNTIME_MANIFEST), entry.path),
          resolve(PROJECT_ROOT, "codex-managed-runtime", entry.path),
          resolve(PROJECT_ROOT, "dist", "user-package", "codex-managed-runtime", entry.path),
        ];
        for (const exe of candidates) {
          if (existsSync(exe)) {
            return { command: exe, version: manifest.version || null, source: "repo-managed-runtime" };
          }
        }
      }
    } catch {
      // fall through
    }
  }

  const installed = findInstalledManagedCodex();
  if (installed) return installed;

  return { command: "codex", version: null, source: "PATH" };
}

function main() {
  const resolved = resolveCodexCommand();
  const CODEX_COMMAND = resolved.command;

  const probe = spawnSync(CODEX_COMMAND, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 15000,
  });
  if (probe.status !== 0) {
    fail(
      `codex 不可用（source=${resolved.source}, status=${probe.status}, error=${probe.error?.message || "n/a"}）。\n` +
        `当前 schema 仍是 fixture（参见 ${MANIFEST_PATH}）。\n` +
        `请安装 managed runtime 或设置 CODEX_COMMAND。`,
      0,
    );
    return;
  }
  const codexVersion = (probe.stdout.trim() || probe.stderr.trim() || resolved.version || "unknown").split(/\r?\n/)[0];

  const tmpOut = join(tmpdir(), `codex-schema-gen-${Date.now()}`);
  mkdirSync(tmpOut, { recursive: true });

  console.log(`[generate-codex-schema] source=${resolved.source}`);
  console.log(`[generate-codex-schema] running: ${CODEX_COMMAND} app-server generate-ts --out ${tmpOut}`);
  const gen = spawnSync(CODEX_COMMAND, ["app-server", "generate-ts", "--out", tmpOut], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120000,
  });

  if (gen.status !== 0) {
    fail(
      `codex app-server generate-ts 失败（status=${gen.status}）。\n` +
        `stdout: ${gen.stdout}\nstderr: ${gen.stderr}`,
    );
    return;
  }

  // 覆盖 schema/generated/（保留 schema/index.ts 适配层与 manifest.json）
  if (existsSync(GENERATED_DIR)) {
    rmSync(GENERATED_DIR, { recursive: true, force: true });
  }
  mkdirSync(GENERATED_DIR, { recursive: true });
  cpSync(tmpOut, GENERATED_DIR, { recursive: true });
  try {
    rmSync(tmpOut, { recursive: true, force: true });
  } catch {
    // ignore
  }

  const fileCount = countTsFiles(GENERATED_DIR);
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    manifest = {};
  }
  manifest.schemaVersion = "1.0.0-generated";
  manifest.codexVersion = codexVersion;
  manifest.schemaGeneratedAt = new Date().toISOString();
  manifest.generatorCommand = `${CODEX_COMMAND} app-server generate-ts --out ./src/runtime/providers/codex-app-server/schema/generated`;
  manifest.source = "generated";
  manifest.sourceReason =
    `Generated from ${codexVersion} (${resolved.source}). Official types live under schema/generated/; Bridge adapter is schema/index.ts. Re-run \`npm run codex:schema\` after runtime upgrades.`;
  manifest.experimentalApi = manifest.experimentalApi === true;
  manifest.generatedFileCount = fileCount;
  manifest.officialThreadStartFields = [
    "model",
    "developerInstructions",
    "baseInstructions",
    "personality",
    "serviceTier",
    "approvalPolicy",
    "sandbox",
  ];
  if (!manifest.protocolCapabilities) {
    manifest.protocolCapabilities = {
      wireJsonrpcOmitted: true,
      initializeHandshake: true,
      threadResume: true,
      itemDeltas: [],
      approvalDecisions: [],
      serverInitiatedRequests: [],
    };
  }
  // 校准说明：Bridge 不传 baseInstructions；Obsidian 规则走 developerInstructions
  manifest.wireProtocolCalibration = {
    ...(manifest.wireProtocolCalibration || {}),
    developerInstructionsOnly:
      "thread/start 与 thread/resume：不传 baseInstructions（由 runtime 选模型基础指令）；Bridge 薄规则走 developerInstructions。",
    turnStartOverrides: "turn/start 可传 effort / summary / personality / model / serviceTier（以 generated TurnStartParams 为准）。",
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`[generate-codex-schema] schema generated from codex ${codexVersion} (${fileCount} .ts files → ${GENERATED_DIR})`);
  console.log(`[generate-codex-schema] manifest updated: ${MANIFEST_PATH}`);
}

function countTsFiles(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) n += countTsFiles(p);
    else if (name.endsWith(".ts")) n += 1;
  }
  return n;
}

main();
