// 敏感值精确扫描脚本（Node.js 版，避免 PowerShell 转义问题）
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const releaseDir = join(process.cwd(), "release", "llm-cli-bridge");
const issues = [];

const patterns = [
  { name: "48 字符 hex token", re: /[0-9a-f]{48}/ },
  { name: "ANTHROPIC API key (sk-ant-...)", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { name: "Windows 用户绝对路径", re: /[A-Z]:\\Users\\[A-Za-z_]/ },
  { name: "真实 Bearer token 值", re: /Bearer\s+[A-Za-z0-9]{20,}/ },
  { name: "API key 赋值", re: /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9]{20,}/i },
  { name: "CLAUDE_API_KEY 环境变量赋值", re: /CLAUDE_API_KEY\s*[:=]\s*["'][^"']{10,}/i },
];

const files = readdirSync(releaseDir).filter(f => statSync(join(releaseDir, f)).isFile());
for (const f of files) {
  const content = readFileSync(join(releaseDir, f), "utf8");
  for (const { name, re } of patterns) {
    if (re.test(content)) {
      issues.push(`${f}: 疑似 ${name}`);
    }
  }
}

console.log("=== 精确敏感值扫描 ===");
if (issues.length === 0) {
  console.log("OK: 未发现真实敏感值（48-hex token / API key / 用户绝对路径 / 真实 Bearer 值）");
  process.exit(0);
} else {
  console.log("FAIL: 发现疑似真实敏感值:");
  for (const i of issues) console.log("  - " + i);
  process.exit(1);
}
