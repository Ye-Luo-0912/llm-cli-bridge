#!/usr/bin/env node
// LLM CLI Bridge — V17-F3 runtime distribution report.
//
// Reads the default user-package, optional current-platform offline package,
// and the pinned managed runtime manifest. Does not download artifacts.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-runtime-distribution.md");
const DEFAULT_PACKAGE_DIR = join(PROJECT_ROOT, "dist", "user-package");
const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const OFFLINE_PACKAGE_DIR = join(PROJECT_ROOT, "dist", `user-package-offline-${PLATFORM_KEY}`);
const MANIFEST_PATH = join(PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json");

function dirSize(p) {
  if (!existsSync(p)) return 0;
  const stat = statSync(p);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const fullPath = join(p, entry.name);
    if (entry.isDirectory()) total += dirSize(fullPath);
    else if (entry.isFile()) total += statSync(fullPath).size;
  }
  return total;
}

function mb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readPackageMode(dir) {
  const metaPath = join(dir, "llm-cli-bridge-user-package.json");
  if (!existsSync(metaPath)) return "missing";
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")).releasePackageMode || "unknown";
  } catch {
    return "metadata-invalid";
  }
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const win32X64Entry = manifest.platforms?.["win32-x64"];
  const currentEntry = manifest.platforms?.[PLATFORM_KEY];
  const currentRuntimePath = currentEntry ? resolve(dirname(MANIFEST_PATH), currentEntry.path) : null;
  const runtimeBinarySizeMB = win32X64Entry ? mb(win32X64Entry.size) : 0;
  const defaultPackageSizeMB = mb(dirSize(DEFAULT_PACKAGE_DIR));
  const offlinePackageExists = existsSync(OFFLINE_PACKAGE_DIR);
  const offlineWin32X64PackageSizeMB = existsSync(join(PROJECT_ROOT, "dist", "user-package-offline-win32-x64"))
    ? mb(dirSize(join(PROJECT_ROOT, "dist", "user-package-offline-win32-x64")))
    : 0;

  const defaultManifestExists = existsSync(join(DEFAULT_PACKAGE_DIR, "codex-managed-runtime", "runtime-manifest.json"));
  const defaultInstallerExists = existsSync(join(DEFAULT_PACKAGE_DIR, "codex-managed-runtime", "install-codex-managed-runtime.mjs"));
  const defaultRuntimeBinaryPath = currentEntry
    ? resolve(join(DEFAULT_PACKAGE_DIR, "codex-managed-runtime"), currentEntry.path)
    : null;
  const containsRuntimeBinary = !!(defaultRuntimeBinaryPath && existsSync(defaultRuntimeBinaryPath));
  const runtimeDownloadRequired = !containsRuntimeBinary;
  const artifactMetadataComplete = !!(
    currentEntry?.artifact?.package
    && currentEntry.artifact.tarballSha256
    && currentEntry.artifact.vendorPath
    && currentEntry.sha256
    && currentEntry.size
  );
  const currentRuntimeVerified = !!(
    currentRuntimePath
    && existsSync(currentRuntimePath)
    && statSync(currentRuntimePath).size === currentEntry.size
    && sha256(currentRuntimePath) === currentEntry.sha256
  );
  const runtimePinnedArtifactVerified = artifactMetadataComplete && currentRuntimeVerified;
  const crossPlatformPackageStrategy = "platform-specific-packages-only:no-all-platform-fat-package";
  const platformPackageNames = [
    "llm-cli-bridge-win32-x64",
    "llm-cli-bridge-win32-arm64",
    "llm-cli-bridge-darwin-arm64",
    "llm-cli-bridge-linux-x64",
  ];

  mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Runtime Distribution Strategy (V17-F3)",
    "",
    "> 本报告由 `scripts/generate-runtime-distribution-report.mjs` 自动生成。",
    "> 默认包采用 download-on-first-run，不复制 Codex runtime 大 binary；offline package 才 bundling 当前平台 binary。",
    "",
    `- **测试时间**: ${new Date().toISOString()}`,
    `- **defaultPackageDir**: ${DEFAULT_PACKAGE_DIR}`,
    `- **defaultPackageMode**: ${readPackageMode(DEFAULT_PACKAGE_DIR)}`,
    `- **defaultPackageSizeMB**: ${defaultPackageSizeMB}`,
    `- **offlinePackageDir**: ${OFFLINE_PACKAGE_DIR}`,
    `- **offlinePackageMode**: ${readPackageMode(OFFLINE_PACKAGE_DIR)}`,
    `- **offlineWin32X64PackageSizeMB**: ${offlineWin32X64PackageSizeMB}`,
    `- **offlineCurrentPlatformPackageExists**: ${offlinePackageExists}`,
    `- **runtimeBinarySizeMB**: ${runtimeBinarySizeMB}`,
    `- **runtimeDownloadRequired**: ${runtimeDownloadRequired}`,
    `- **containsRuntimeBinary**: ${containsRuntimeBinary}`,
    `- **runtimePinnedArtifactVerified**: ${runtimePinnedArtifactVerified}`,
    `- **runtimeCanInstallFromPinnedArtifact**: ${defaultManifestExists && defaultInstallerExists && artifactMetadataComplete}`,
    `- **defaultManifestExists**: ${defaultManifestExists}`,
    `- **defaultInstallerExists**: ${defaultInstallerExists}`,
    `- **runtimeVersion**: ${manifest.version}`,
    `- **testedPlatform**: ${PLATFORM_KEY}`,
    `- **supportedPlatformsInManifest**: ${Object.keys(manifest.platforms || {}).join(",")}`,
    `- **crossPlatformPackageStrategy**: ${crossPlatformPackageStrategy}`,
    `- **platformPackageNames**: ${platformPackageNames.join(",")}`,
    "",
    "## Distribution Modes",
    "",
    "| mode | purpose | runtime binary policy |",
    "|------|---------|-----------------------|",
    "| bundled-platform-runtime | offline friend build / platform-specific release | include current platform binary only |",
    "| download-on-first-run | default ordinary-user package | include manifest + installer; download after user confirmation |",
    "| external-fallback-dev | developer compatibility path | use external codex app-server explicitly; not a user-ready gate |",
    "",
    "## Installer UX Contract",
    "",
    "- 首次启动发现 runtime missing 时，应显示 runtime version、download size、source package、sha256、install path。",
    "- 用户确认后才下载安装。",
    "- 下载后必须校验 size + sha256。",
    "- 校验失败必须删除下载 artifact / extract 目录 / 目标 runtime binary，并提示错误。",
    "- default 普通用户模式优先 download-on-first-run；离线朋友版使用 bundled-platform-runtime。",
    "- 不再发布 all-platform fat package；跨平台通过平台专用包或 CI 后续生成。",
    "",
    "```bash",
    "npm run build:user-package",
    "npm run build:user-package:offline",
    "npm run report:runtime-distribution",
    "```",
    "",
    "*报告由 `scripts/generate-runtime-distribution-report.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`runtime distribution 报告已写入: ${REPORT_PATH}`);

  if (!defaultManifestExists || !defaultInstallerExists || !artifactMetadataComplete || !runtimePinnedArtifactVerified) {
    process.exit(1);
  }
}

main();
