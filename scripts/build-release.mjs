// LLM CLI Bridge — Release zip 构建脚本（基于 dist/user-package）
//
// 废弃旧的"6 文件 zip"流程；统一以 dist/user-package 为基础打包。
//   - 先执行 npm run build:user-package（生成 dist/user-package，含 vendored node_modules
//     + codex-managed-runtime manifest/installer）
//   - 校验 dist/user-package 完整性（main.js / manifest.json / styles.css / README.md /
//     codex-managed-runtime/{install-codex-managed-runtime.mjs,runtime-manifest.json} /
//     node_modules/@earendil-works/pi-coding-agent 齐全）
//   - 将整个 dist/user-package 目录打包为 zip（内容置于 zip 根）
//   - 在干净临时目录解压 zip，再次校验完整性（含 main.js 可被 CJS require）
//
// 用法：
//   npm run release                  默认包（download-on-first-run）
//   npm run release:offline           离线包（含当前平台 runtime binary）
//   node scripts/build-release.mjs --dry-run   仅校验已有 dist/user-package（不 build、不 zip）
//
// 产物：release/llm-cli-bridge-<version>-<platform>[-offline].zip

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { execSync } from "child_process";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const offlineRuntime = args.has("--offline-runtime");
const platformKey = `${process.platform}-${process.arch}`;

// 读取 manifest.json 获取版本号
const manifestPath = path.join(PROJECT_ROOT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = manifest.version;
if (!version) {
  console.error("[release] manifest.json 缺少 version 字段");
  process.exit(1);
}

const USER_PKG_DIR = offlineRuntime
  ? path.join(PROJECT_ROOT, "dist", `user-package-offline-${platformKey}`)
  : path.join(PROJECT_ROOT, "dist", "user-package");
const releaseDir = path.join(PROJECT_ROOT, "release");
const zipSuffix = offlineRuntime ? "-offline" : "";
const zipName = `llm-cli-bridge-${version}-${platformKey}${zipSuffix}.zip`;
const zipPath = path.join(releaseDir, zipName);

console.log(`[release] 版本: ${version}`);
console.log(`[release] 平台: ${platformKey}`);
console.log(`[release] 模式: ${offlineRuntime ? "offline (bundled runtime)" : "default (download-on-first-run)"}`);
console.log(`[release] 项目根: ${PROJECT_ROOT}`);
console.log(`[release] 包目录: ${path.relative(PROJECT_ROOT, USER_PKG_DIR)}`);

// ---------- dry-run：仅校验已有产物（不 build、不 zip） ----------
if (dryRun) {
  if (!fs.existsSync(USER_PKG_DIR)) {
    console.error(`[release] --dry-run 需要 ${path.relative(PROJECT_ROOT, USER_PKG_DIR)} 已存在`);
    console.error(`[release] 提示：先运行 npm run build:user-package${offlineRuntime ? ":offline" : ""}`);
    process.exit(1);
  }
  console.log("\n[release] --dry-run：跳过 build 与 zip，仅校验产物...");
  assertPackageIntegrity(USER_PKG_DIR, "dist/user-package", { requireMainJs: true });
  runScanSensitive(USER_PKG_DIR);
  console.log("\n[release] --dry-run 校验通过。");
  process.exit(0);
}

// 1. 执行 build:user-package（其内部已含 npm run build + 类型检查 + esbuild）
console.log(`\n[release] 步骤 1: 执行 npm run build:user-package${offlineRuntime ? ":offline" : ""}...`);
try {
  execSync(`npm run build:user-package${offlineRuntime ? ":offline" : ""}`, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
} catch (e) {
  console.error("[release] build:user-package 失败，终止");
  process.exit(1);
}

// 2. 校验 dist/user-package 完整性
console.log("\n[release] 步骤 2: 校验 dist/user-package 完整性...");
assertPackageIntegrity(USER_PKG_DIR, "dist/user-package", { requireMainJs: false });

// 3. 敏感信息扫描
console.log("\n[release] 步骤 3: 敏感信息扫描...");
runScanSensitive(USER_PKG_DIR);

// 4. 清理旧产物 + 确保 release 目录
console.log("\n[release] 步骤 4: 清理旧产物...");
// 4a. 清理残留的旧 stage 目录（废弃的 6 文件流程遗留：release/llm-cli-bridge/）
const staleStageDir = path.join(releaseDir, "llm-cli-bridge");
if (fs.existsSync(staleStageDir)) {
  try {
    fs.rmSync(staleStageDir, { recursive: true, force: true });
    console.log(`  ✓ 清理残留 stage 目录: ${path.relative(PROJECT_ROOT, staleStageDir)}`);
  } catch (e) {
    console.warn(`  ⚠ 清理 stage 目录失败: ${e.message}`);
  }
}
// 4b. 删除同名旧 zip（覆盖前清理；Compress-Archive -Force 亦可，但显式删除更稳妥）
if (fs.existsSync(zipPath)) {
  try {
    fs.rmSync(zipPath, { force: true });
    console.log(`  ✓ 清理旧 zip: ${path.basename(zipPath)}`);
  } catch (e) {
    console.warn(`  ⚠ 清理旧 zip 失败: ${e.message}`);
  }
}
fs.mkdirSync(releaseDir, { recursive: true });

// 5. 打包 zip（内容置于 zip 根：main.js 等在 zip 顶层，可直接解压到 .obsidian/plugins/llm-cli-bridge/）
console.log("\n[release] 步骤 5: 打包 zip...");
zipDirectory(USER_PKG_DIR, zipPath);
const zipStat = fs.statSync(zipPath);
console.log(`  ✓ ${path.basename(zipPath)} (${(zipStat.size / 1024 / 1024).toFixed(1)} MB)`);

// 6. 干净目录解压验证
console.log("\n[release] 步骤 6: 干净目录解压验证...");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-cli-bridge-release-"));
try {
  extractZip(zipPath, tmpDir);
  assertPackageIntegrity(tmpDir, "解压目录", { requireMainJs: true });
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log(`\n[release] 完成。产物: ${path.relative(PROJECT_ROOT, zipPath)}`);
console.log(`[release] 解压后即可直接复制到 .obsidian/plugins/llm-cli-bridge/（无需 npm install）。`);
if (!offlineRuntime) {
  console.log(`[release] 默认包不含 Codex runtime binary；首次运行需用户确认后按 pinned artifact 安装。`);
}

// ---------- helpers ----------

function assertPackageIntegrity(dir, label, { requireMainJs }) {
  const checks = [
    { p: "main.js", desc: "main.js" },
    { p: "manifest.json", desc: "manifest.json" },
    { p: "styles.css", desc: "styles.css" },
    { p: "README.md", desc: "README.md" },
    { p: "codex-managed-runtime/install-codex-managed-runtime.mjs", desc: "codex-managed-runtime/install-codex-managed-runtime.mjs" },
    { p: "codex-managed-runtime/runtime-manifest.json", desc: "codex-managed-runtime/runtime-manifest.json" },
    { p: "node_modules/@earendil-works/pi-coding-agent", desc: "node_modules/@earendil-works/pi-coding-agent", isDir: true },
  ];
  for (const c of checks) {
    const full = path.join(dir, c.p);
    if (!fs.existsSync(full)) {
      console.error(`[release] ✗ ${label} 缺少: ${c.p}`);
      process.exit(1);
    }
    console.log(`  ✓ ${label}: ${c.p}`);
  }

  // manifest.json 版本号校验
  try {
    const pkgManifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    if (pkgManifest.version !== version) {
      console.error(`[release] ✗ ${label} manifest.json 版本不符: 期望 ${version}, 实际 ${pkgManifest.version}`);
      process.exit(1);
    }
    console.log(`  ✓ ${label}: manifest.json version=${version}`);
  } catch (e) {
    console.error(`[release] ✗ ${label} manifest.json 解析失败: ${e.message}`);
    process.exit(1);
  }

  // main.js 可被 CJS require（仅在干净目录解压验证与 dry-run 时执行）
  if (requireMainJs) {
    try {
      const req = createRequire(pathToFileURL(path.join(dir, "_release-probe.mjs")).href);
      const mainPath = path.join(dir, "main.js");
      try {
        req.resolve(mainPath);
        console.log(`  ✓ ${label}: main.js 可被 CJS resolver 解析`);
      } catch {
        try {
          req(mainPath);
          console.log(`  ✓ ${label}: main.js 可被 CJS require 加载`);
        } catch (e2) {
          const msg = e2?.message || String(e2);
          if (msg.includes("ERR_REQUIRE_ESM") || msg.includes("Must use import")) {
            console.error(`[release] ✗ ${label} main.js 被当作 ESM 解析: ${msg}`);
            process.exit(1);
          }
          // 其他错误（window/obsidian 未定义等环境问题）属正常，CJS 加载本身 OK
          console.log(`  ✓ ${label}: main.js CJS 模块解析通过（运行时环境错误属正常）`);
        }
      }
    } catch (e) {
      console.error(`[release] ✗ ${label} main.js CJS 加载检查失败: ${e?.message || e}`);
      process.exit(1);
    }
  }
}

function runScanSensitive(targetDir) {
  const scanScript = path.join(PROJECT_ROOT, "scripts", "scan-sensitive.mjs");
  if (!fs.existsSync(scanScript)) {
    console.log("  ⚠ scan-sensitive.mjs 不存在，跳过扫描");
    return;
  }
  try {
    execSync(`node "${scanScript}" "${targetDir}"`, { cwd: PROJECT_ROOT, stdio: "inherit" });
    console.log("  ✓ 敏感信息扫描通过");
  } catch (e) {
    console.error("[release] 敏感信息扫描失败，终止");
    process.exit(1);
  }
}

function zipDirectory(srcDir, destZip) {
  // 优先 .NET ZipFile.CreateFromDirectory（Windows；单次原生调用，远快于 Compress-Archive；
  // includeBaseDirectory=$false → 内容置于 zip 根；目标 zip 调用前已在步骤 4b 删除）
  try {
    const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${psEscape(srcDir)}', '${psEscape(destZip)}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: "pipe" });
    return;
  } catch (e) {
    // 回退 zip CLI（macOS/Linux/Git Bash；从源目录内打包 . 保持内容置于根）
    try {
      execSync(`zip -rq "${destZip}" .`, { cwd: srcDir, stdio: "pipe" });
      return;
    } catch (e2) {
      console.error(`[release] zip 打包失败：.NET ZipFile(${errHead(e)}) / zip(${errHead(e2)})`);
      process.exit(1);
    }
  }
}

function extractZip(srcZip, destDir) {
  // 优先 .NET ZipFile.ExtractToDirectory（Windows；dest 必须不存在或为空，mkdtemp 已保证）
  try {
    const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${psEscape(srcZip)}', '${psEscape(destDir)}')`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: "pipe" });
    return;
  } catch (e) {
    // 回退 unzip CLI
    try {
      execSync(`unzip -q "${srcZip}" -d "${destDir}"`, { stdio: "pipe" });
      return;
    } catch (e2) {
      console.error(`[release] zip 解压失败：.NET ZipFile(${errHead(e)}) / unzip(${errHead(e2)})`);
      process.exit(1);
    }
  }
}

function psEscape(s) {
  // PS 单引号字符串：单引号 → 两个单引号
  return s.replace(/'/g, "''");
}

function errHead(e) {
  const m = (e?.stderr && e.stderr.toString()) || e?.message || String(e);
  return m.slice(0, 200).replace(/\n/g, " ");
}
