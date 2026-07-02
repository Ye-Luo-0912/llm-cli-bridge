#!/usr/bin/env node
// LLM CLI Bridge — Codex app-server schema generator (V2.17-A Completion)
//
// 运行 codex app-server generate-ts，把生成的 TypeScript 类型写入
//   src/runtime/providers/codex-app-server/schema/
//
// 用法：node scripts/generate-codex-schema.mjs
// 或：  npm run codex:schema
//
// 若 codex 不可用，脚本会输出提示并退出（不修改 fixture schema）。
// 生成的 schema 会更新 schema/manifest.json 的 codexVersion/schemaGeneratedAt。
//
// ⚠️ 当 codex 真实可用时，应运行此脚本覆盖 fixture schema。
// 当前环境（CI/sandbox）通常无 codex，所以默认使用 fixture schema 进行测试。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const SCHEMA_DIR = join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "schema");
const MANIFEST_PATH = join(SCHEMA_DIR, "manifest.json");

const CODEX_COMMAND = process.env.CODEX_COMMAND || "codex";

function fail(msg, code = 1) {
  console.error(`[generate-codex-schema] ${msg}`);
  process.exit(code);
}

function main() {
  // 1. 探测 codex 是否可用
  const probe = spawnSync(CODEX_COMMAND, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 5000,
  });
  if (probe.status !== 0) {
    fail(
      `codex 命令不可用（status=${probe.status}, error=${probe.error?.message || "n/a"}）。\n` +
      `当前 schema 仍是 fixture（参见 ${MANIFEST_PATH}）。\n` +
      `若需真实 schema，请先安装 codex CLI（PATH 中可执行 \`${CODEX_COMMAND} --version\`）。`,
      0, // 退出码 0：fixture 是合法状态，CI 不应失败
    );
    return;
  }
  const codexVersion = probe.stdout.trim() || probe.stderr.trim() || "unknown";

  // 2. 确保 schema 目录存在
  if (!existsSync(SCHEMA_DIR)) {
    mkdirSync(SCHEMA_DIR, { recursive: true });
  }

  // 3. 调用 codex app-server generate-ts
  console.log(`[generate-codex-schema] running: ${CODEX_COMMAND} app-server generate-ts --out ${SCHEMA_DIR}`);
  const gen = spawnSync(CODEX_COMMAND, ["app-server", "generate-ts", "--out", SCHEMA_DIR], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 60000,
  });

  if (gen.status !== 0) {
    fail(
      `codex app-server generate-ts 失败（status=${gen.status}）。\n` +
      `stdout: ${gen.stdout}\nstderr: ${gen.stderr}`,
    );
    return;
  }

  // 4. 更新 manifest.json（不手改 generated schema 文件本身，仅维护 manifest 元信息）
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.schemaVersion = "1.0.0-generated";
  manifest.codexVersion = codexVersion;
  manifest.schemaGeneratedAt = new Date().toISOString();
  manifest.generatorCommand = `${CODEX_COMMAND} app-server generate-ts --out ./src/runtime/providers/codex-app-server/schema`;
  manifest.source = "generated";
  manifest.sourceReason = `Generated from ${codexVersion} via ${CODEX_COMMAND} app-server generate-ts. 不要手改 generated schema 字段；如需更新请重新运行 \`npm run codex:schema\`。`;
  // generated schema 默认 experimentalApi=false（除非 manifest 已显式标 true 且 audit 记录在案）
  manifest.experimentalApi = manifest.experimentalApi === true ? true : false;
  // protocolCapabilities 保持 fixture 已声明的官方能力集（generated schema 文件本身不描述能力集）
  // 仅在缺失时补一个最小 stub，避免 generated 状态下丢字段
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
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`[generate-codex-schema] ✅ schema generated from codex ${codexVersion}`);
  console.log(`[generate-codex-schema] ✅ manifest updated: ${MANIFEST_PATH}`);
}

main();
