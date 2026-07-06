// LLM CLI Bridge — User Package Build (V17-D 任务 A)
//
// 构建零安装发行包：dist/user-package
//   - main.js / manifest.json / styles.css / README.md
//   - node_modules/@earendil-works/pi-coding-agent 及其运行依赖（vendor 策略）
// 不要求终端用户执行 npm install。
//
// 用法：npm run build:user-package
// 产物：dist/user-package/

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
  console.error("[user-package] manifest.json 缺少 version 字段");
  process.exit(1);
}

const OUT_DIR = path.join(PROJECT_ROOT, "dist", "user-package");
const SDK_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

// 必须包含的顶层文件
const REQUIRED_FILES = [
  { src: "main.js", dest: "main.js" },
  { src: "manifest.json", dest: "manifest.json" },
  { src: "styles.css", dest: "styles.css" },
  { src: "README.md", dest: "README.md" },
];

console.log(`[user-package] 版本: ${version}`);
console.log(`[user-package] 项目根: ${PROJECT_ROOT}`);

// 1. 先执行 npm run build（含 tsc 类型检查 + esbuild；V17-E1 任务 G：不允许跳过 tsc）
console.log("\n[user-package] 步骤 1: 执行 npm run build（含 tsc）...");
try {
  execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "inherit" });
} catch (e) {
  console.error("[user-package] npm run build 失败，终止");
  process.exit(1);
}

// 2. 清理旧的 user-package 目录
console.log("\n[user-package] 步骤 2: 清理旧产物...");
try { fs.rmSync(OUT_DIR, { recursive: true, force: true }); } catch {}
fs.mkdirSync(OUT_DIR, { recursive: true });

// 3. 复制顶层文件
console.log("\n[user-package] 步骤 3: 复制交付文件...");
for (const f of REQUIRED_FILES) {
  const srcPath = path.join(PROJECT_ROOT, f.src);
  const destPath = path.join(OUT_DIR, f.dest);
  if (!fs.existsSync(srcPath)) {
    console.error(`[user-package] 缺少文件: ${f.src}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  const stat = fs.statSync(destPath);
  console.log(`  ✓ ${f.dest} (${stat.size} bytes)`);
}

// 4. Vendor Pi SDK 及其运行依赖
console.log("\n[user-package] 步骤 4: Vendor Pi SDK 及运行依赖...");

const sourceSdkPath = path.join(PROJECT_ROOT, "node_modules", SDK_PACKAGE_NAME);
if (!fs.existsSync(sourceSdkPath)) {
  console.error(`[user-package] 错误：${SDK_PACKAGE_NAME} 未安装`);
  console.error(`[user-package] 提示：npm install --save-optional --ignore-scripts ${SDK_PACKAGE_NAME}@latest`);
  process.exit(1);
}

// 4a. 递归收集所有运行依赖（读 package.json dependencies + optionalDependencies）
//     npm ls 不展开 optionalDependencies 的 transitive deps，故手动遍历
const vendorPaths = new Map(); // packageName → source path
const visiting = new Set(); // 防止循环

function collectDeps(pkgName, pkgPath) {
  if (vendorPaths.has(pkgName) || visiting.has(pkgName)) return;
  visiting.add(pkgName);
  vendorPaths.set(pkgName, pkgPath);

  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, "package.json"), "utf8"));
  } catch {
    visiting.delete(pkgName);
    return;
  }

  // 收集 dependencies + optionalDependencies + peerDependencies（不含 devDependencies）
  const deps = {
    ...(pkgJson.dependencies || {}),
    ...(pkgJson.optionalDependencies || {}),
    ...(pkgJson.peerDependencies || {}),
  };

  for (const depName of Object.keys(deps)) {
    // 跳过 dev/test 工具
    if (depName.startsWith("@types/")) continue;
    if (depName === "shx" || depName === "vitest") continue;
    // 在项目 node_modules 解析 dep 路径（含 workspace 路径回退）
    const depPath = resolveNodeModulePath(depName, pkgPath);
    if (depPath && fs.existsSync(depPath)) {
      collectDeps(depName, depPath);
    }
  }
  visiting.delete(pkgName);
}

// 解析包的依赖：从子包 node_modules 向上回退查找
function resolveNodeModulePath(depName, fromPath) {
  // 从 fromPath 向上找 node_modules/<depName>
  let dir = fromPath;
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(dir, "node_modules", depName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 最后用 PROJECT_ROOT/node_modules
  const rootCandidate = path.join(PROJECT_ROOT, "node_modules", depName);
  return fs.existsSync(rootCandidate) ? rootCandidate : null;
}

// 从 SDK 开始递归收集
collectDeps(SDK_PACKAGE_NAME, sourceSdkPath);

console.log(`  收集到 ${vendorPaths.size} 个包需 vendor`);

// 4b. 复制每个包到 dist/user-package/node_modules/<name>
let copiedCount = 0;
let skippedCount = 0;
for (const [pkgName, srcPath] of vendorPaths) {
  const destPath = path.join(OUT_DIR, "node_modules", pkgName);
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    copyDirSync(srcPath, destPath);
    copiedCount++;
  } catch (e) {
    console.log(`  ⚠ 跳过 ${pkgName}: ${e.message}`);
    skippedCount++;
  }
}
console.log(`  ✓ vendor 完成：${copiedCount} 包复制，${skippedCount} 跳过`);

// 4b. V17-F2 任务 C：安装并复制 Codex Managed Runtime manifest + pinned binary
console.log("\n[user-package] 步骤 4b: 安装并复制 Codex Managed Runtime manifest + pinned binary...");
const managedRuntimeSrcDir = path.join(PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server");
const managedRuntimeDestDir = path.join(OUT_DIR, "codex-managed-runtime");
const managedManifestSrc = path.join(managedRuntimeSrcDir, "runtime-manifest.json");
const managedManifestDest = path.join(managedRuntimeDestDir, "runtime-manifest.json");
const managedRuntimeBinarySrcDir = path.join(managedRuntimeSrcDir, "runtime");
const managedRuntimeBinaryDestDir = path.join(managedRuntimeDestDir, "runtime");

if (!fs.existsSync(managedManifestSrc)) {
  console.error(`[user-package] 错误：managed runtime manifest 不存在: ${managedManifestSrc}`);
  process.exit(1);
}

try {
  execSync("node scripts/install-codex-managed-runtime.mjs", { cwd: PROJECT_ROOT, stdio: "inherit" });
} catch {
  console.error("[user-package] managed runtime 安装失败，终止");
  process.exit(1);
}

// 复制 manifest
fs.mkdirSync(managedRuntimeDestDir, { recursive: true });
fs.copyFileSync(managedManifestSrc, managedManifestDest);
console.log(`  ✓ runtime-manifest.json 已复制`);

// 复制 runtime binary 目录（所有平台）
if (fs.existsSync(managedRuntimeBinarySrcDir)) {
  copyDirSync(managedRuntimeBinarySrcDir, managedRuntimeBinaryDestDir);
  console.log(`  ✓ runtime/ 目录已复制（含 pinned managed binary + fixture manifests）`);
} else {
  console.log(`  ⚠ runtime/ 目录不存在（managed binary 缺失）`);
}
console.log(`  ✓ managed runtime 已集成到 user-package`);

// 5. 写元数据文件（V17-E1 任务 C：不写 package.json，避免 type=module 影响 main.js CJS 加载）
//    main.js 是 esbuild format=cjs；若根目录有 package.json 含 "type":"module"，
//    Node 会把 main.js 当 ESM 解析，导致 require() 失败。
//    改为写 llm-cli-bridge-user-package.json 作为纯元数据，不影响模块解析。
console.log("\n[user-package] 步骤 5: 写元数据文件（不写 package.json，避免 type=module 风险）...");
const userPkgMeta = {
  name: "obsidian-llm-cli-bridge-user-package",
  version: version,
  description: "User distribution package (zero-install) for obsidian-llm-cli-bridge",
  private: true,
  // 注意：不写 "type": "module"。main.js 是 CJS（esbuild format=cjs）。
  // 元数据文件名为 llm-cli-bridge-user-package.json，不干扰 Node 模块解析。
};
fs.writeFileSync(
  path.join(OUT_DIR, "llm-cli-bridge-user-package.json"),
  JSON.stringify(userPkgMeta, null, 2) + "\n",
  "utf8"
);
console.log("  ✓ llm-cli-bridge-user-package.json 已写入（元数据，不影响 CJS 加载）");

// 确保根目录没有 package.json（防止旧构建残留）
const rootPkgJsonPath = path.join(OUT_DIR, "package.json");
if (fs.existsSync(rootPkgJsonPath)) {
  fs.rmSync(rootPkgJsonPath, { force: true });
  console.log("  ✓ 清理残留的 package.json");
}

// 6. 敏感信息扫描
console.log("\n[user-package] 步骤 6: 敏感信息扫描...");
const scanScript = path.join(PROJECT_ROOT, "scripts", "scan-sensitive.mjs");
if (fs.existsSync(scanScript)) {
  try {
    execSync(`node "${scanScript}" "${OUT_DIR}"`, { cwd: PROJECT_ROOT, stdio: "inherit" });
    console.log("  ✓ 敏感信息扫描通过");
  } catch (e) {
    console.error("[user-package] 敏感信息扫描失败，终止");
    process.exit(1);
  }
} else {
  console.log("  ⚠ scan-sensitive.mjs 不存在，跳过扫描");
}

// 7. 统计输出大小
console.log("\n[user-package] 步骤 7: 统计产物大小...");
const totalSize = dirSize(OUT_DIR);
console.log(`  ✓ 总大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

console.log(`\n[user-package] 完成。产物: ${path.relative(PROJECT_ROOT, OUT_DIR)}`);
console.log(`[user-package] 该目录可直接复制到 .obsidian/plugins/llm-cli-bridge/，无需 npm install。`);

// ---------- helpers ----------

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // 跳过无用目录减少体积
    if (entry.name === "test" || entry.name === "tests" || entry.name === "__tests__") continue;
    if (entry.name === ".git" || entry.name === ".github") continue;
    if (entry.name === "docs" && entry.isDirectory()) continue;
    if (entry.name === "examples" && entry.isDirectory()) continue;
    if (entry.name === "node_modules" && entry.isDirectory()) continue;
    // 跳过 source map 和 typescript 源码（保留 .js / .json / .wasm / .png / .css / .html）
    if (entry.isFile()) {
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) continue;
      if (entry.name.endsWith(".tsbuildinfo")) continue;
      if (entry.name.endsWith(".tar.gz") || entry.name.endsWith(".tgz")) continue;
    }
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function dirSize(p) {
  let total = 0;
  const stat = fs.statSync(p);
  if (stat.isFile()) return stat.size;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const fullPath = path.join(p, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(fullPath);
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size;
    }
  }
  return total;
}
