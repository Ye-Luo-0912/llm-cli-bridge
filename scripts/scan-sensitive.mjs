// LLM CLI Bridge — 敏感信息扫描
// V1.3: 扫描 release 内容，确保无 token / API key / .env / credentials 进入 zip
// V2.10 (B-010): 跳过 node_modules / .git 等目录；测试假数据识别（--strict 关闭识别）
//
// 用法：node scripts/scan-sensitive.mjs <目录> [--strict]
// 退出码：0 通过，1 发现敏感信息

import * as fs from "fs";
import * as path from "path";

// V2.10 (B-010): 解析 --strict 标志（默认 false，启用测试假数据识别；--strict 时全扫描不识别假数据）
const argv = process.argv.slice(2);
const strictMode = argv.includes("--strict");
const target = argv.find((a) => !a.startsWith("-"));
if (!target) {
  console.error("[scan] 用法: node scripts/scan-sensitive.mjs <目录> [--strict]");
  process.exit(1);
}
if (!fs.existsSync(target)) {
  console.error(`[scan] 目录不存在: ${target}`);
  process.exit(1);
}

// V2.10 (B-010): 扫描时跳过的目录（node_modules 含第三方二进制/源码，.git 含历史，.llm-bridge 含运行时数据）
const SCAN_EXCLUDE_DIRS = new Set(["node_modules", ".git", ".llm-bridge", "dist", "build"]);

// V2.10 (B-010): 测试假数据标记——匹配行附近含这些关键词时识别为测试 fixture，非 --strict 模式跳过
const TEST_FIXTURE_MARKERS = ["test", "fixture", "假数据", "测试用例", "redact", "脱敏", "mock"];

// 敏感模式（正则，区分大小写）
// 注意：排除占位符 <redacted> / <token> / <api-key>，避免误报脱敏函数本身
const PATTERNS = [
  { name: "sk-ant API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Bearer token", re: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: "48-hex token", re: /\b[a-f0-9]{48}\b/ },
  { name: "ANTHROPIC_API_KEY 值", re: /ANTHROPIC_API_KEY\s*=\s*["']?(?!(?:<redacted>|<token>|<api-key>))[A-Za-z0-9_\-]{10,}(?=[;\s"']|$)/ },
  { name: "CLAUDE_API_KEY 值", re: /CLAUDE_API_KEY\s*=\s*["']?(?!(?:<redacted>|<token>|<api-key>))[A-Za-z0-9_\-]{10,}(?=[;\s"']|$)/ },
  { name: ".env 变量赋值", re: /^[A-Z_]{3,}=(?!(?:<redacted>|<token>|<api-key>)|\$)[^\s]{20,}/m },
];

// 敏感文件名
const SENSITIVE_FILE_NAMES = [
  ".env", ".env.local", ".env.production",
  "credentials.json", "credentials.yml",
  ".bridge-token", "token.json",
  "secrets.json", "secrets.yml",
];

// V2.10 (B-010): walk 跳过 SCAN_EXCLUDE_DIRS 中的目录
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过 node_modules / .git / .llm-bridge / dist / build
      if (SCAN_EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// V2.10 (B-010): 判断文件是否为测试文件（文件级判断，避免对大文件每个匹配反复扫描上下文）
// 测试文件整体识别为 fixture，非 --strict 模式下跳过其中的假数据匹配
function isTestFile(rel, base) {
  const relLower = rel.toLowerCase();
  const baseLower = base.toLowerCase();
  // 文件名或路径含 test / fixture / .test. 前缀；run-tests 本体也视为测试文件
  if (baseLower.includes(".test.") || baseLower.includes("test-") || baseLower.startsWith("test") || baseLower.includes("run-tests")) return true;
  if (relLower.includes("/test/") || relLower.includes("/tests/") || relLower.includes("/fixture")) return true;
  return false;
}

// V2.10 (B-010): 判断匹配是否为测试假数据（匹配行 ±5 行内含测试标记关键词）
// 优化：直接用 index 找前后换行符定位上下文，避免对大文件反复 split
function isTestFixture(content, matchIndex) {
  // 向前找 5 个换行符
  let lineStart = matchIndex;
  for (let i = 0; i < 5; i++) {
    const idx = content.lastIndexOf("\n", lineStart - 1);
    if (idx < 0) { lineStart = 0; break; }
    lineStart = idx;
  }
  // 向后找 5 个换行符
  let lineEnd = matchIndex;
  for (let i = 0; i < 5; i++) {
    const idx = content.indexOf("\n", lineEnd + 1);
    if (idx < 0) { lineEnd = content.length; break; }
    lineEnd = idx;
  }
  const context = content.slice(lineStart, lineEnd).toLowerCase();
  return TEST_FIXTURE_MARKERS.some((m) => context.includes(m));
}

const files = walk(target);
let hits = 0;
let skippedFixtures = 0;

for (const file of files) {
  const rel = path.relative(target, file);
  const base = path.basename(file);

  // 文件名检查
  if (SENSITIVE_FILE_NAMES.includes(base)) {
    console.error(`[scan] ✗ 敏感文件名: ${rel}`);
    hits++;
    continue;
  }

  // 内容检查
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    // 二进制等无法读取的文件跳过
    continue;
  }

  // V2.10 (B-010): 非 --strict 模式下，测试文件整体跳过 PATTERN 扫描（避免大文件逐匹配循环）
  const skipFileAsFixture = !strictMode && isTestFile(rel, base);
  if (skipFileAsFixture) {
    skippedFixtures++;
    continue;
  }

  for (const p of PATTERNS) {
    // V2.11: 强制添加 g 标志，否则 re.exec 在 while 循环中总是返回同一匹配 → 死循环
    const flags = p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g";
    const re = new RegExp(p.re.source, flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      // V2.10 (B-010): 非 --strict 模式下，用上下文识别零散假数据（非测试文件中的测试片段）
      if (!strictMode && isTestFixture(content, m.index)) {
        skippedFixtures++;
        continue;
      }
      console.error(`[scan] ✗ ${rel}: 命中 ${p.name} → ${m[0].slice(0, 40)}...`);
      hits++;
    }
  }
}

if (hits > 0) {
  console.error(`[scan] 发现 ${hits} 处敏感信息，发布终止`);
  process.exit(1);
}

const fixtureNote = skippedFixtures > 0 ? `，跳过 ${skippedFixtures} 处测试假数据（--strict 可全扫描）` : "";
console.log(`[scan] ✓ 扫描 ${files.length} 个文件，无敏感信息${fixtureNote}`);
process.exit(0);
