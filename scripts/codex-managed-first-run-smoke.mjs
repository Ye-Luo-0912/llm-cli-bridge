#!/usr/bin/env node
// LLM CLI Bridge — V17-F3.2 managed runtime first-run integration smoke.

import Module from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const USER_PACKAGE_DIR = join(PROJECT_ROOT, "dist", "user-package");
const MAIN_PATH = join(USER_PACKAGE_DIR, "main.js");
const RUNTIME_DIR = join(USER_PACKAGE_DIR, "codex-managed-runtime");
const MANIFEST_PATH = join(RUNTIME_DIR, "runtime-manifest.json");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-managed-first-run.md");

const report = {
  runtimeFirstRunIntegrationStatus: "fail",
  resolverBeforeInstallStatus: "unknown",
  installRequiredSurfaced: false,
  installerStatus: "unknown",
  resolverAfterInstallStatus: "unknown",
  providerBeforeInstall: "unknown",
  providerAfterInstall: "unknown",
  error: null,
  timestamp: new Date().toISOString(),
};

function installObsidianMock() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request !== "obsidian") return originalLoad.apply(this, arguments);
    class Plugin {
      constructor(app, manifest) {
        this.app = app;
        this.manifest = manifest || {};
      }
      addRibbonIcon() {}
      addCommand() {}
      addSettingTab() {}
      registerView() {}
      registerCommands() {}
    }
    class ItemView {
      constructor(leaf) {
        this.leaf = leaf;
        this.contentEl = { empty() {}, addClass() {}, createDiv() { return this; }, createEl() { return this; } };
      }
    }
    class PluginSettingTab {}
    class Modal {}
    class Notice {
      constructor(message) {
        this.message = message;
      }
    }
    return {
      App: class {},
      Plugin,
      ItemView,
      PluginSettingTab,
      Modal,
      Notice,
      TFile: class {},
      TFolder: class {},
      MarkdownView: class {},
      MarkdownRenderer: { render: async () => undefined },
      normalizePath: (value) => value,
      setIcon: () => undefined,
    };
  };
  return () => {
    Module._load = originalLoad;
  };
}

function writeReport() {
  mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Codex Managed First-run Integration Smoke (V17-F3.2)",
    "",
    "> 本报告由 `scripts/codex-managed-first-run-smoke.mjs` 自动生成。",
    "> 加载 dist/user-package/main.js 的插件类，验证 runtime missing → install required → install → resolver pass → managed provider selected。",
    "",
    `- **测试时间**: ${report.timestamp}`,
    `- **runtimeFirstRunIntegrationStatus**: ${report.runtimeFirstRunIntegrationStatus}`,
    `- **resolverBeforeInstallStatus**: ${report.resolverBeforeInstallStatus}`,
    `- **installRequiredSurfaced**: ${report.installRequiredSurfaced}`,
    `- **installerStatus**: ${report.installerStatus}`,
    `- **resolverAfterInstallStatus**: ${report.resolverAfterInstallStatus}`,
    `- **providerBeforeInstall**: ${report.providerBeforeInstall}`,
    `- **providerAfterInstall**: ${report.providerAfterInstall}`,
    `- **error**: ${report.error || "null"}`,
    "",
    "## 运行命令",
    "",
    "```bash",
    "npm run smoke:codex-managed-first-run",
    "```",
    "",
    "*报告由 `scripts/codex-managed-first-run-smoke.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
}

async function main() {
  let restoreMock = null;
  let cleanupRuntimeDir = null;
  let cleanupCacheDir = null;
  try {
    if (!existsSync(MAIN_PATH)) throw new Error(`user package main.js missing: ${MAIN_PATH}`);
    if (!existsSync(MANIFEST_PATH)) throw new Error(`runtime manifest missing: ${MANIFEST_PATH}`);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const platformKey = `${process.platform}-${process.arch}`;
    const entry = manifest.platforms?.[platformKey];
    if (!entry) throw new Error(`platform missing from default package manifest: ${platformKey}`);
    const runtimePath = resolve(RUNTIME_DIR, entry.path);
    cleanupRuntimeDir = dirname(runtimePath);
    cleanupCacheDir = resolve(RUNTIME_DIR, manifest.source?.artifactCacheDir || ".tmp/codex-managed-runtime-artifacts");
    rmSync(dirname(runtimePath), { recursive: true, force: true });

    restoreMock = installObsidianMock();
    const mainModule = await import(pathToFileURL(MAIN_PATH).href);
    const PluginClass = mainModule.default?.default || mainModule.default;
    if (typeof PluginClass !== "function") throw new Error("plugin default export missing");
    const fakeApp = {
      vault: { adapter: { getBasePath: () => PROJECT_ROOT } },
      workspace: { getLeavesOfType: () => [] },
    };
    const plugin = new PluginClass(fakeApp, { dir: USER_PACKAGE_DIR, version: "smoke" });
    plugin.pluginDir = USER_PACKAGE_DIR;
    plugin.settings = { ...plugin.settings, backendMode: "auto" };

    const before = plugin.getManagedRuntimeInstallStatus();
    report.resolverBeforeInstallStatus = before.status;
    const selectedBefore = plugin.getRuntimeProviderStatusForSmoke(PROJECT_ROOT);
    report.providerBeforeInstall = selectedBefore.providerId;
    report.installRequiredSurfaced = before.required === true
      && before.status === "path-not-exist"
      && selectedBefore.providerId === "codex-managed-app-server"
      && /install required/i.test(selectedBefore.label);

    const installed = await plugin.ensureManagedRuntimeInstalled({ confirm: true });
    report.installerStatus = installed.status;
    const after = plugin.getManagedRuntimeInstallStatus();
    report.resolverAfterInstallStatus = after.status === "installed" ? "pass" : after.status;
    const selectedAfter = plugin.getRuntimeProviderStatusForSmoke(PROJECT_ROOT);
    report.providerAfterInstall = selectedAfter.providerId;

    report.runtimeFirstRunIntegrationStatus = before.status === "path-not-exist"
      && report.installRequiredSurfaced
      && installed.status === "installed"
      && report.resolverAfterInstallStatus === "pass"
      && report.providerAfterInstall === "codex-managed-app-server"
        ? "pass"
        : "fail";
  } catch (e) {
    report.error = e?.message || String(e);
    report.runtimeFirstRunIntegrationStatus = "fail";
  } finally {
    if (restoreMock) restoreMock();
    writeReport();
    if (cleanupRuntimeDir) rmSync(cleanupRuntimeDir, { recursive: true, force: true });
    if (cleanupCacheDir) rmSync(cleanupCacheDir, { recursive: true, force: true });
  }

  console.log(`runtimeFirstRunIntegrationStatus=${report.runtimeFirstRunIntegrationStatus}`);
  console.log(`resolverBeforeInstallStatus=${report.resolverBeforeInstallStatus}`);
  console.log(`installRequiredSurfaced=${report.installRequiredSurfaced}`);
  console.log(`installerStatus=${report.installerStatus}`);
  console.log(`resolverAfterInstallStatus=${report.resolverAfterInstallStatus}`);
  console.log(`providerAfterInstall=${report.providerAfterInstall}`);
  console.log(`报告已写入: ${REPORT_PATH}`);
  process.exit(report.runtimeFirstRunIntegrationStatus === "pass" ? 0 : 1);
}

main();
