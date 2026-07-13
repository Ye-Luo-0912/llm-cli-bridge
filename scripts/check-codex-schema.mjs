#!/usr/bin/env node
// LLM CLI Bridge — Codex app-server schema SSOT 校验（Round 2）
//
// 目的：schema/index.ts 是 generated/*（codex app-server 官方 ts-rs 输出）之上的薄适配层。
// 本脚本静态校验这个"薄适配层"约定没有腐化，而不是重新跑 `codex app-server generate-ts`
// （那需要本机装有 codex CLI，不适合作为一般 CI/pre-commit 校验）：
//
// 1. schema/generated/ 与 schema/generated/v2/ 存在且非空（SSOT 源已生成）。
// 2. schema/manifest.json 存在且 source === "generated"（不是 fixture 占位）。
// 3. 除 schema/index.ts 自身外，src/ 下没有文件绕过适配层直接 import "schema/generated/*"
//    （consumer 必须走 Codex* 别名，不能直接依赖 generated 内部路径，否则未来重新生成时
//    没有单一收口点）。
// 4. schema/index.ts 导出的 Codex* 名称集合覆盖已知 6 个 provider 内部消费者实际用到的名称
//    （防止重命名/删除时漏改消费者却未报错——TS 编译已能捕获大部分场景，这里做一层
//    快速静态兜底，不依赖完整 tsc 跑一遍项目）。
//
// 用法：node scripts/check-codex-schema.mjs
// 退出码：0 通过，1 校验失败
// 也见：npm run codex:schema:check

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, "..", "..");
const SRC_DIR = join(PROJECT_ROOT, "src");
const SCHEMA_DIR = join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "schema");
const SCHEMA_INDEX = join(SCHEMA_DIR, "index.ts");
const GENERATED_DIR = join(SCHEMA_DIR, "generated");
const GENERATED_V2_DIR = join(GENERATED_DIR, "v2");
const MANIFEST_PATH = join(SCHEMA_DIR, "manifest.json");

let failed = false;
function fail(msg) {
  console.error(`[check-codex-schema] FAIL: ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`[check-codex-schema] OK: ${msg}`);
}

function countTsFiles(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) n += countTsFiles(p);
    else if (name.endsWith(".ts")) n += 1;
  }
  return n;
}

function walkTsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkTsFiles(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

// ---------- 1. generated/ 存在且非空 ----------

const generatedCount = countTsFiles(GENERATED_DIR);
if (!existsSync(GENERATED_DIR) || generatedCount === 0) {
  fail(`schema/generated/ 不存在或为空（${GENERATED_DIR}）。请先运行 npm run codex:schema。`);
} else {
  ok(`schema/generated/ 存在（${generatedCount} 个 .ts 文件）`);
}
if (!existsSync(GENERATED_V2_DIR) || countTsFiles(GENERATED_V2_DIR) === 0) {
  fail(`schema/generated/v2/ 不存在或为空（${GENERATED_V2_DIR}）。`);
} else {
  ok(`schema/generated/v2/ 存在`);
}

// ---------- 2. manifest.json source === "generated" ----------

if (!existsSync(MANIFEST_PATH)) {
  fail(`manifest.json 不存在（${MANIFEST_PATH}）。`);
} else {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    if (manifest.source !== "generated") {
      fail(`manifest.json source=${JSON.stringify(manifest.source)}，期望 "generated"（当前可能仍是 fixture 占位，需运行 npm run codex:schema）。`);
    } else {
      ok(`manifest.json source="generated"（codexVersion=${manifest.codexVersion ?? "unknown"}）`);
    }
  } catch (err) {
    fail(`manifest.json 解析失败：${err.message}`);
  }
}

// ---------- 3. 除 schema/index.ts 外，src/ 下不得直接 import schema/generated 内部路径 ----------

const GENERATED_IMPORT_RE = /from\s+["']([^"']*schema\/generated[^"']*)["']/g;
const allTsFiles = walkTsFiles(SRC_DIR);
const violations = [];
for (const file of allTsFiles) {
  if (resolve(file) === resolve(SCHEMA_INDEX)) continue; // 适配层自身允许直接 import generated
  if (resolve(file).startsWith(resolve(GENERATED_DIR))) continue; // generated 内部互相 import 不算违规
  const text = readFileSync(file, "utf8");
  let m;
  while ((m = GENERATED_IMPORT_RE.exec(text))) {
    violations.push({ file: relative(PROJECT_ROOT, file), spec: m[1] });
  }
}
if (violations.length > 0) {
  fail(
    `发现 ${violations.length} 处绕过适配层直接 import schema/generated 的引用（应改为 import from ".../schema"）：\n` +
      violations.map((v) => `  - ${v.file}: "${v.spec}"`).join("\n"),
  );
} else {
  ok(`src/ 下没有文件绕过 schema/index.ts 直接 import schema/generated 内部路径`);
}

// ---------- 4. schema/index.ts 导出的 Codex* 名称覆盖已知消费者用到的名称 ----------

const KNOWN_CONSUMERS = [
  "runtime/providers/codex-app-server/jsonRpcClient.ts",
  "runtime/providers/codex-app-server/codexAppServerEventMapper.ts",
  "runtime/providers/codex-app-server/codexAppServerEffectiveRunPlan.ts",
  "runtime/providers/codex-app-server/codexAppServerApprovalMapper.ts",
  "runtime/providers/codex-app-server/codexAppServerUserInputMapper.ts",
  "runtime/providers/codex-app-server/codexAppServerProvider.ts",
].map((p) => join(SRC_DIR, p));

if (!existsSync(SCHEMA_INDEX)) {
  fail(`schema/index.ts 不存在（${SCHEMA_INDEX}）。`);
} else {
  const indexText = readFileSync(SCHEMA_INDEX, "utf8");
  // 收集 index.ts 导出的顶层类型/接口名（export type X / export interface X）
  const exportedNames = new Set();
  for (const m of indexText.matchAll(/export\s+(?:type|interface)\s+([A-Za-z0-9_]+)/g)) {
    exportedNames.add(m[1]);
  }

  const missing = [];
  for (const consumerPath of KNOWN_CONSUMERS) {
    if (!existsSync(consumerPath)) continue;
    const text = readFileSync(consumerPath, "utf8");
    // 匹配 `import type { A, B, C } from "./schema"`（可能跨多行）
    const importBlocks = text.matchAll(/import\s+type\s*\{([^}]*)\}\s*from\s*["']\.\/schema["']/g);
    for (const block of importBlocks) {
      const names = block[1]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      for (const name of names) {
        if (name.startsWith("Codex") && !exportedNames.has(name)) {
          missing.push({ consumer: relative(PROJECT_ROOT, consumerPath), name });
        }
      }
    }
  }
  if (missing.length > 0) {
    fail(
      `以下消费者引用的 Codex* 类型未在 schema/index.ts 中找到导出（可能已被误删或改名）：\n` +
        missing.map((v) => `  - ${v.consumer}: ${v.name}`).join("\n"),
    );
  } else {
    ok(`已知 6 个消费者引用的 Codex* 类型均能在 schema/index.ts 中找到导出`);
  }
}

if (failed) {
  console.error("[check-codex-schema] 校验失败，见上方 FAIL 项。");
  process.exit(1);
}
console.log("[check-codex-schema] 全部通过。");
