// LLM CLI Bridge — 敏感信息扫描
// V1.3: 扫描 release 内容，确保无 token / API key / .env / credentials 进入 zip
//
// 用法：node scripts/scan-sensitive.mjs <目录>
// 退出码：0 通过，1 发现敏感信息

import * as fs from "fs";
import * as path from "path";

const target = process.argv[2];
if (!target) {
  console.error("[scan] 用法: node scripts/scan-sensitive.mjs <目录>");
  process.exit(1);
}
if (!fs.existsSync(target)) {
  console.error(`[scan] 目录不存在: ${target}`);
  process.exit(1);
}

// 敏感模式（正则，区分大小写）
// 注意：排除占位符 <redacted> / <token> / <api-key>，避免误报脱敏函数本身
const PATTERNS = [
  { name: "sk-ant API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Bearer token", re: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: "48-hex token", re: /\b[a-f0-9]{48}\b/ },
  { name: "ANTHROPIC_API_KEY 值", re: /ANTHROPIC_API_KEY\s*=\s*["']?(?!(?:<redacted>|<token>|<api-key>))[A-Za-z0-9_\-]{10,}/ },
  { name: "CLAUDE_API_KEY 值", re: /CLAUDE_API_KEY\s*=\s*["']?(?!(?:<redacted>|<token>|<api-key>))[A-Za-z0-9_\-]{10,}/ },
  { name: ".env 变量赋值", re: /^[A-Z_]{3,}=(?!(?:<redacted>|<token>|<api-key>)|\$)[^\s]{20,}/m },
];

// 敏感文件名
const SENSITIVE_FILE_NAMES = [
  ".env", ".env.local", ".env.production",
  "credentials.json", "credentials.yml",
  ".bridge-token", "token.json",
  "secrets.json", "secrets.yml",
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(target);
let hits = 0;

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

  for (const p of PATTERNS) {
    const m = content.match(p.re);
    if (m) {
      console.error(`[scan] ✗ ${rel}: 命中 ${p.name} → ${m[0].slice(0, 40)}...`);
      hits++;
    }
  }
}

if (hits > 0) {
  console.error(`[scan] 发现 ${hits} 处敏感信息，发布终止`);
  process.exit(1);
}

console.log(`[scan] ✓ 扫描 ${files.length} 个文件，无敏感信息`);
process.exit(0);
