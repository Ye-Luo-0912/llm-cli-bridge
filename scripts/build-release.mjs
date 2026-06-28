// LLM CLI Bridge — Release zip 构建脚本
// V1.3: 统一 release 流程，确保 zip 只含交付文件
//
// 用法：npm run release
// 产物：release/llm-cli-bridge-<version>.zip
//
// zip 内容（固定 6 个文件）：
//   main.js / manifest.json / styles.css / README.md / RELEASE_CHECKLIST.md / USER_GUIDE.md
//
// 不包含：源码 / node_modules / .llm-bridge / docs/test-report.md / 测试临时文件 / .git

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// 读取 manifest.json 获取版本号
const manifestPath = path.join(PROJECT_ROOT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = manifest.version;
if (!version) {
  console.error("[release] manifest.json 缺少 version 字段");
  process.exit(1);
}

const releaseDir = path.join(PROJECT_ROOT, "release");
const stageDir = path.join(releaseDir, `llm-cli-bridge-${version}`);
const zipPath = path.join(releaseDir, `llm-cli-bridge-${version}.zip`);

// 必须包含的 6 个交付文件
const REQUIRED_FILES = [
  { src: "main.js", dest: "main.js" },
  { src: "manifest.json", dest: "manifest.json" },
  { src: "styles.css", dest: "styles.css" },
  { src: "README.md", dest: "README.md" },
  { src: "RELEASE_CHECKLIST.md", dest: "RELEASE_CHECKLIST.md" },
  { src: "docs/USER_GUIDE.md", dest: "USER_GUIDE.md" },
];

console.log(`[release] 版本: ${version}`);
console.log(`[release] 项目根: ${PROJECT_ROOT}`);

// 1. 先执行 build，确保 main.js 是最新的
console.log("\n[release] 步骤 1: 执行 npm run build...");
try {
  execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "inherit" });
} catch (e) {
  console.error("[release] build 失败，终止");
  process.exit(1);
}

// 2. 清理旧的 stage 目录与 zip
console.log("\n[release] 步骤 2: 清理旧产物...");
try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
try { fs.rmSync(zipPath, { force: true }); } catch {}
fs.mkdirSync(stageDir, { recursive: true });

// 3. 校验并复制文件
console.log("\n[release] 步骤 3: 校验并复制交付文件...");
for (const f of REQUIRED_FILES) {
  const srcPath = path.join(PROJECT_ROOT, f.src);
  const destPath = path.join(stageDir, f.dest);
  if (!fs.existsSync(srcPath)) {
    console.error(`[release] 缺少文件: ${f.src}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  const stat = fs.statSync(destPath);
  console.log(`  ✓ ${f.dest} (${stat.size} bytes)`);
}

// 4. 校验 stage 目录只含 6 个文件（不含子目录）
console.log("\n[release] 步骤 4: 校验 stage 目录内容...");
const stageEntries = fs.readdirSync(stageDir, { withFileTypes: true });
const unexpected = stageEntries.filter((e) => !REQUIRED_FILES.some((f) => f.dest === e.name));
if (unexpected.length > 0) {
  console.error(`[release] stage 目录含意外条目: ${unexpected.map((e) => e.name).join(", ")}`);
  process.exit(1);
}
if (stageEntries.length !== REQUIRED_FILES.length) {
  console.error(`[release] stage 目录文件数不符: 期望 ${REQUIRED_FILES.length}, 实际 ${stageEntries.length}`);
  process.exit(1);
}
console.log(`  ✓ stage 目录含 ${stageEntries.length} 个文件，无意外条目`);

// 5. 敏感信息扫描
console.log("\n[release] 步骤 5: 敏感信息扫描...");
const scanScript = path.join(PROJECT_ROOT, "scripts", "scan-sensitive.mjs");
if (fs.existsSync(scanScript)) {
  try {
    execSync(`node "${scanScript}" "${stageDir}"`, { cwd: PROJECT_ROOT, stdio: "inherit" });
    console.log("  ✓ 敏感信息扫描通过");
  } catch (e) {
    console.error("[release] 敏感信息扫描失败，终止");
    process.exit(1);
  }
} else {
  console.log("  ⚠ scan-sensitive.mjs 不存在，跳过扫描");
}

// 6. 打包 zip（用 PowerShell Compress-Archive，跨 Windows/macOS/Linux 需调用系统 zip）
console.log("\n[release] 步骤 6: 打包 zip...");
try {
  // 优先尝试系统 zip 命令（macOS/Linux/Git Bash）
  try {
    execSync(`zip -j "${zipPath}" "${stageDir}"/*`, { stdio: "pipe" });
  } catch {
    // 回退到 PowerShell Compress-Archive（Windows）
    const psCmd = `Compress-Archive -Path "${stageDir}/*" -DestinationPath "${zipPath}" -Force`;
    execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: "inherit" });
  }
} catch (e) {
  console.error("[release] zip 打包失败，终止");
  process.exit(1);
}

const zipStat = fs.statSync(zipPath);
console.log(`  ✓ ${path.basename(zipPath)} (${(zipStat.size / 1024).toFixed(1)} KB)`);

// 7. 清理 stage 目录
try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}

console.log(`\n[release] 完成。产物: ${path.relative(PROJECT_ROOT, zipPath)}`);
console.log(`[release] 解压后应含 6 个文件，直接复制到 .obsidian/plugins/llm-cli-bridge/ 即可。`);
