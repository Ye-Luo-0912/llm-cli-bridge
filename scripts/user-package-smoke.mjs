// LLM CLI Bridge — User Package Smoke (V17-D 任务 C)
//
// 在 dist/user-package 下验证：
// - Pi SDK 文件存在
// - createAgentSession 可 require/import
// - 不依赖全局 node_modules
// - userNeedsNpmInstall=false
//
// 输出：
//   userPackageStatus=pass|fail
//   containsPiSdk=true|false
//   canRequirePiSdk=true|false
//   userNeedsNpmInstall=true|false
//
// 运行：node scripts/user-package-smoke.mjs
// 前置：npm run build:user-package

import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USER_PKG_DIR = join(PROJECT_ROOT, "dist", "user-package");

console.log("=== User Package Smoke (V17-D) ===");
console.log(`PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log(`USER_PKG_DIR: ${USER_PKG_DIR}`);
console.log("");

// 1. 检查 user-package 目录存在
if (!existsSync(USER_PKG_DIR)) {
  console.log("=== FAIL: dist/user-package 不存在 ===");
  console.log("提示：先运行 npm run build:user-package");
  console.log("userPackageStatus=fail");
  console.log("containsPiSdk=false");
  console.log("canRequirePiSdk=false");
  console.log("userNeedsNpmInstall=true");
  process.exit(1);
}

// 2. 检查顶层文件齐全
const requiredTopFiles = ["main.js", "manifest.json", "styles.css", "README.md"];
const missingTop = requiredTopFiles.filter((f) => !existsSync(join(USER_PKG_DIR, f)));
if (missingTop.length > 0) {
  console.log(`=== FAIL: 顶层文件缺失：${missingTop.join(", ")} ===`);
  console.log("userPackageStatus=fail");
  console.log("containsPiSdk=false");
  console.log("canRequirePiSdk=false");
  console.log("userNeedsNpmInstall=true");
  process.exit(1);
}
console.log(`✓ 顶层文件齐全：${requiredTopFiles.join(", ")}`);

// 3. 检查 Pi SDK 文件存在
const sdkPath = join(USER_PKG_DIR, "node_modules", "@earendil-works", "pi-coding-agent");
const sdkPkgJsonPath = join(sdkPath, "package.json");
const sdkEntryPath = join(sdkPath, "dist", "index.js");

let containsPiSdk = false;
let sdkVersion = null;
if (existsSync(sdkPkgJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(sdkPkgJsonPath, "utf8"));
    sdkVersion = pkg.version;
    containsPiSdk = !!pkg.exports?.["."] || !!pkg.main;
  } catch {
    /* ignore */
  }
}
console.log(`containsPiSdk=${containsPiSdk}${sdkVersion ? ` (version=${sdkVersion})` : ""}`);

if (!containsPiSdk) {
  console.log("");
  console.log("=== FAIL: Pi SDK 未 vendor 到 user-package ===");
  console.log("userPackageStatus=fail");
  console.log("containsPiSdk=false");
  console.log("canRequirePiSdk=false");
  console.log("userNeedsNpmInstall=true");
  process.exit(1);
}

// 4. 验证 createAgentSession 可加载
//    SDK 是纯 ESM，用 dynamic import 加载
let canRequirePiSdk = false;
let loadError = null;
try {
  const sdkUrl = pathToFileURL(sdkEntryPath).href;
  const mod = await import(sdkUrl);
  if (typeof mod.createAgentSession === "function") {
    canRequirePiSdk = true;
    console.log(`✓ createAgentSession 可加载 (typeof=${typeof mod.createAgentSession})`);
  } else {
    loadError = "createAgentSession export missing";
    console.log(`✗ createAgentSession export missing`);
  }
} catch (e) {
  loadError = e?.message || String(e);
  console.log(`✗ import 失败：${loadError}`);
}
console.log(`canRequirePiSdk=${canRequirePiSdk}`);

// 5. 验证不依赖全局 node_modules（关键 transitive deps 都在 user-package 内）
const criticalDeps = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "chalk",
  "undici",
];
const missingDeps = criticalDeps.filter(
  (dep) => !existsSync(join(USER_PKG_DIR, "node_modules", dep))
);
const userNeedsNpmInstall = missingDeps.length > 0;
console.log(`关键 transitive deps 检查：${missingDeps.length === 0 ? "✓ 全部存在" : "✗ 缺失：" + missingDeps.join(", ")}`);
console.log(`userNeedsNpmInstall=${userNeedsNpmInstall}`);

// 6. 统计 user-package 大小
function dirSize(p) {
  let total = 0;
  const stat = statSync(p);
  if (stat.isFile()) return stat.size;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const fullPath = join(p, entry.name);
    if (entry.isDirectory()) total += dirSize(fullPath);
    else if (entry.isFile()) total += statSync(fullPath).size;
  }
  return total;
}
const totalSize = dirSize(USER_PKG_DIR);
console.log(`user-package 总大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

// 7. 最终状态
const userPackageStatus = containsPiSdk && canRequirePiSdk && !userNeedsNpmInstall ? "pass" : "fail";

console.log("");
if (userPackageStatus === "pass") {
  console.log("=== PASS: User Package Smoke ===");
  console.log("userPackageStatus=pass");
  console.log("containsPiSdk=true");
  console.log("canRequirePiSdk=true");
  console.log("userNeedsNpmInstall=false");
  process.exit(0);
} else {
  console.log("=== FAIL: User Package Smoke ===");
  console.log(`userPackageStatus=fail`);
  console.log(`containsPiSdk=${containsPiSdk}`);
  console.log(`canRequirePiSdk=${canRequirePiSdk}`);
  console.log(`userNeedsNpmInstall=${userNeedsNpmInstall}`);
  if (loadError) console.log(`loadError=${loadError}`);
  if (missingDeps.length > 0) console.log(`missingDeps=${missingDeps.join(",")}`);
  process.exit(1);
}
