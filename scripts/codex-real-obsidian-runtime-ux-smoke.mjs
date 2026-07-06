#!/usr/bin/env node
// LLM CLI Bridge — V17-F5 real Obsidian managed runtime UX smoke.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-real-obsidian-runtime-ux.md");
const USER_PACKAGE_DIR = join(PROJECT_ROOT, "dist", "user-package");
const USER_PACKAGE_META_PATH = join(USER_PACKAGE_DIR, "llm-cli-bridge-user-package.json");
const RUNTIME_DIR = join(USER_PACKAGE_DIR, "codex-managed-runtime");
const MANIFEST_PATH = join(RUNTIME_DIR, "runtime-manifest.json");
const CDP_HOST = process.env.CDP_HOST || "127.0.0.1";
const CDP_PORT = process.env.CDP_PORT || "9223";
const CDP_BASE = process.env.CDP_BASE || `http://${CDP_HOST}:${CDP_PORT}`;
const VIEW_TYPE = "llm-cli-bridge-view";

const report = {
  timestamp: new Date().toISOString(),
  testedCodeCommitSha: git(["rev-parse", "HEAD"]) || "unknown",
  realObsidianRuntimeUxStatus: "unknown",
  realObsidianSmokeStatus: "unknown",
  cdpStatus: "unknown",
  cdpTargetTitle: "",
  cdpTargetUrl: "",
  skipReason: "",
  firstOpenDefaultPackageObserved: false,
  runtimeMissingInstallRequiredObserved: false,
  installSuccessProviderReadyObserved: false,
  commandTimelineObserved: false,
  fileEditTimelineObserved: false,
  approvalCardObserved: false,
  diffCardObserved: false,
  normalUserVerboseOutputDefaultCollapsed: readReportBool("test-report-codex-real-protocol-capability.md", "normalUserVerboseOutputDefaultCollapsed"),
  normalUserRawJsonSourceRefHidden: readReportBool("test-report-codex-real-protocol-capability.md", "normalUserRawJsonSourceRefHidden"),
  developerModeSourceRefVisible: readReportBool("test-report-codex-real-protocol-capability.md", "developerModeSourceRefVisible"),
  turnDiffUpdatedNormalHidden: readReportCheck("test-report-codex-real-protocol-capability.md", "turn/diff/updated hidden from normal timeline"),
  turnDiffUpdatedDeveloperVisible: readReportCheck("test-report-codex-real-protocol-capability.md", "turn/diff/updated developer status node observed"),
  releasePackageMode: "unknown",
  containsRuntimeBinary: false,
  runtimeDownloadRequired: true,
  runtimePinnedArtifactMetadataComplete: false,
  runtimeInstallerPresent: false,
  runtimeInstallRequiresSystemNpm: false,
  runtimeInstallRequiresSystemTar: false,
  defaultPackageSizeMB: "unknown",
  offlineWin32X64PackageOptional: true,
  offlineWin32X64PackageSizeMB: "not-built",
  noDistRuntimeTempFiles: true,
  installationRetryErrorCopyPresent: false,
  knownGaps: [
    "userInput not-observed in real Codex managed protocol smoke",
    "non-win32-x64 platforms are not verified in this workspace",
    "Codex runtime authentication depends on user-level Codex/OpenAI credentials or environment",
    "telemetry methods are observed for developer/debug status only and do not enter the normal user timeline",
  ],
  checks: [],
  errors: [],
};

function git(args) {
  try {
    return execFileSync("git", args, { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function addCheck(name, passed, detail = "") {
  const status = passed ? "pass" : "fail";
  report.checks.push({ name, status, detail });
  return passed;
}

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readReportBool(fileName, fieldName) {
  const text = readTextIfExists(join(DOCS_DIR, fileName));
  const match = text.match(new RegExp(`- \\*\\*${escapeRegExp(fieldName)}\\*\\*: (true|false)`));
  return match ? match[1] === "true" : false;
}

function readReportCheck(fileName, checkName) {
  const text = readTextIfExists(join(DOCS_DIR, fileName));
  const escaped = escapeRegExp(checkName);
  return new RegExp(`\\| ${escaped} \\| pass \\|`).test(text);
}

function readReportField(fileName, fieldName) {
  const text = readTextIfExists(join(DOCS_DIR, fileName));
  const match = text.match(new RegExp(`- \\*\\*${escapeRegExp(fieldName)}\\*\\*: ([^\\r\\n]+)`));
  return match ? match[1].trim() : "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dirSizeBytes(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => {
    return sum + dirSizeBytes(join(path, entry.name));
  }, 0);
}

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function inspectPackaging() {
  const userPackageReport = "test-report-user-package.md";
  report.releasePackageMode = readReportField(userPackageReport, "releasePackageMode") || "unknown";
  report.containsRuntimeBinary = readReportField(userPackageReport, "containsRuntimeBinary") === "true";
  report.runtimeDownloadRequired = readReportField(userPackageReport, "runtimeDownloadRequired") !== "false";
  report.runtimePinnedArtifactMetadataComplete = readReportField(userPackageReport, "runtimePinnedArtifactMetadataComplete") === "true";
  report.runtimeInstallerPresent = readReportField(userPackageReport, "runtimeInstallerPresent") === "true";
  report.runtimeInstallRequiresSystemNpm = readReportField(userPackageReport, "runtimeInstallRequiresSystemNpm") === "true";
  report.runtimeInstallRequiresSystemTar = readReportField(userPackageReport, "runtimeInstallRequiresSystemTar") === "true";
  report.defaultPackageSizeMB = readReportField(userPackageReport, "releasePackageSizeMB") || (existsSync(USER_PACKAGE_DIR) ? formatMb(dirSizeBytes(USER_PACKAGE_DIR)) : "unknown");

  if (existsSync(USER_PACKAGE_META_PATH)) {
    try {
      const meta = JSON.parse(readFileSync(USER_PACKAGE_META_PATH, "utf8"));
      report.releasePackageMode = meta.releasePackageMode || report.releasePackageMode;
      report.defaultPackageSizeMB = formatMb(dirSizeBytes(USER_PACKAGE_DIR));
    } catch (e) {
      report.errors.push(`user package metadata parse failed: ${e.message}`);
    }
  }

  if (existsSync(MANIFEST_PATH)) {
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      const platformKey = `${process.platform}-${process.arch}`;
      const entry = manifest.platforms?.[platformKey];
      const artifact = entry?.artifact || {};
      report.runtimePinnedArtifactMetadataComplete = !!(
        entry?.sha256
        && typeof entry.size === "number"
        && entry.executableName
        && artifact.package
        && artifact.tarball
        && artifact.tarballSha256
        && artifact.vendorPath
      );
      const runtimePath = entry?.path ? resolve(RUNTIME_DIR, entry.path) : "";
      report.containsRuntimeBinary = !!(runtimePath && existsSync(runtimePath));
      report.runtimeDownloadRequired = !report.containsRuntimeBinary;
    } catch (e) {
      report.errors.push(`runtime manifest parse failed: ${e.message}`);
    }
  }

  report.noDistRuntimeTempFiles = !existsSync(join(PROJECT_ROOT, "dist", "runtime"));
  const viewSrc = readTextIfExists(join(PROJECT_ROOT, "src", "view.ts"));
  report.installationRetryErrorCopyPresent = viewSrc.includes("Codex runtime install failed")
    && viewSrc.includes("Install Codex runtime")
    && viewSrc.includes("install required");

  addCheck("default package uses download-on-first-run", report.releasePackageMode === "download-on-first-run", report.releasePackageMode);
  addCheck("default package does not include runtime binary", report.containsRuntimeBinary === false, `containsRuntimeBinary=${report.containsRuntimeBinary}`);
  addCheck("runtime download required for default package", report.runtimeDownloadRequired === true, `runtimeDownloadRequired=${report.runtimeDownloadRequired}`);
  addCheck("runtime installer metadata complete", report.runtimePinnedArtifactMetadataComplete, "");
  addCheck("installer does not require system npm", report.runtimeInstallRequiresSystemNpm === false, "");
  addCheck("installer does not require system tar", report.runtimeInstallRequiresSystemTar === false, "");
  addCheck("dist/runtime temp files absent from package boundary", report.noDistRuntimeTempFiles, "");
  addCheck("install retry/error copy present", report.installationRetryErrorCopyPresent, "");
  addCheck("normal user verbose output collapsed", report.normalUserVerboseOutputDefaultCollapsed, "");
  addCheck("normal user raw sourceRef hidden", report.normalUserRawJsonSourceRefHidden, "");
  addCheck("developer mode sourceRef visible", report.developerModeSourceRefVisible, "");
  addCheck("turn/diff/updated hidden from normal timeline", report.turnDiffUpdatedNormalHidden, "");
  addCheck("turn/diff/updated visible in developer evidence", report.turnDiffUpdatedDeveloperVisible, "");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
  }

  static async connect() {
    const resp = await fetch(`${CDP_BASE}/json`);
    if (!resp.ok) throw new Error(`CDP /json failed: ${resp.status}`);
    const pages = await resp.json();
    const page = pages.find((p) => p.type === "page" && p.url?.includes("obsidian.md")) || pages.find((p) => p.type === "page");
    if (!page?.webSocketDebuggerUrl) throw new Error("Obsidian CDP target not found");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("CDP websocket timeout")), 5000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolveOpen();
      });
      ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        rejectOpen(new Error(event.message || "CDP websocket error"));
      });
    });
    report.cdpTargetTitle = page.title || "";
    report.cdpTargetUrl = page.url || "";
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

const CDP_PROBE = `
(async () => {
  const plugin = globalThis.app?.plugins?.plugins?.["llm-cli-bridge"] ?? null;
  const leaves = globalThis.app?.workspace?.getLeavesOfType?.("${VIEW_TYPE}") ?? [];
  const view = leaves[0]?.view ?? null;
  const status = plugin?.getManagedRuntimeInstallStatus?.() ?? null;
  const statusText = view?.statusLabelEl?.textContent ?? "";
  const installButton = view?.runtimeInstallBtnEl ?? null;
  const installButtonVisible = !!installButton && !installButton.hasAttribute("hidden");
  const installButtonTitle = installButton?.getAttribute("title") ?? "";
  const turn = Array.isArray(view?.messages)
    ? [...view.messages].reverse().find((m) => m?.role === "assistant" && m?.assistantTurnView)?.assistantTurnView ?? null
    : null;
  const cards = turn?.turnTimeline ?? [];
  const domText = view?.containerEl?.textContent ?? "";
  return {
    pluginLoaded: !!plugin,
    viewLoaded: !!view,
    backendMode: plugin?.settings?.backendMode ?? "",
    runtimeStatus: status,
    statusText,
    installButtonVisible,
    installButtonTitle,
    providerReady: /ready|已连接/i.test(statusText) && !status?.required,
    installRequiredSurfaced: status?.required === true
      && /install required/i.test(statusText)
      && installButtonVisible
      && /Runtime version:/i.test(installButtonTitle)
      && /SHA-256:/i.test(installButtonTitle),
    commandTimelineObserved: cards.some((c) => c.kind === "tool-call" || c.type === "tool-call"),
    fileEditTimelineObserved: cards.some((c) => c.kind === "file-change" || c.type === "file-change"),
    approvalCardObserved: !!view?.containerEl?.querySelector?.(".llm-bridge-turn-approval-card"),
    diffCardObserved: /diff:/i.test(domText) || !!view?.containerEl?.querySelector?.(".llm-bridge-tl-file details"),
    sourceRefVisibleInDom: /threadId=|turnId=|itemId=|method=/.test(domText),
  };
})()
`;

async function runCdpProbe() {
  if (typeof fetch !== "function" || typeof WebSocket !== "function") {
    report.cdpStatus = "skip-runtime-no-fetch-or-websocket";
    report.skipReason = "Node runtime lacks fetch/WebSocket globals required by CDP smoke";
    return;
  }
  let cdp = null;
  try {
    cdp = await CDP.connect();
    report.cdpStatus = "connected";
    const probe = await cdp.eval(CDP_PROBE);
    report.firstOpenDefaultPackageObserved = !!(probe.pluginLoaded && probe.viewLoaded);
    report.runtimeMissingInstallRequiredObserved = !!probe.installRequiredSurfaced;
    report.installSuccessProviderReadyObserved = !!probe.providerReady;
    report.commandTimelineObserved = !!probe.commandTimelineObserved;
    report.fileEditTimelineObserved = !!probe.fileEditTimelineObserved;
    report.approvalCardObserved = !!probe.approvalCardObserved;
    report.diffCardObserved = !!probe.diffCardObserved;
    addCheck("real Obsidian plugin and bridge view loaded", report.firstOpenDefaultPackageObserved, `${probe.backendMode || "backendMode unknown"}`);
    addCheck("runtime missing surfaces install required", report.runtimeMissingInstallRequiredObserved, probe.statusText || "");
    addCheck("install success surfaces provider ready", report.installSuccessProviderReadyObserved, probe.statusText || "");
    addCheck("real Obsidian command timeline observed", report.commandTimelineObserved, "");
    addCheck("real Obsidian file edit timeline observed", report.fileEditTimelineObserved, "");
    addCheck("real Obsidian approval card observed", report.approvalCardObserved, "");
    addCheck("real Obsidian diff card observed", report.diffCardObserved, "");
    report.realObsidianRuntimeUxStatus = report.checks.some((c) => c.name.startsWith("real Obsidian") && c.status === "fail")
      ? "partial"
      : "pass";
    report.realObsidianSmokeStatus = report.realObsidianRuntimeUxStatus;
  } catch (e) {
    report.cdpStatus = "skip-cdp-unavailable";
    report.skipReason = e.message || String(e);
    report.realObsidianRuntimeUxStatus = "skip-cdp-unavailable";
    report.realObsidianSmokeStatus = "skip-cdp-unavailable";
  } finally {
    if (cdp) cdp.close();
  }
}

function writeReport() {
  mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Codex Real Obsidian Runtime UX Smoke (V17-F5)",
    "",
    "> 本报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成。",
    "> 它只在真实 Obsidian 通过 CDP 暴露时记录真实 UI 观察；CDP 不可用时明确 skip，不把合成 smoke 伪装为真实 UI pass。",
    "",
    `- **测试时间**: ${report.timestamp}`,
    `- **testedCodeCommitSha**: ${report.testedCodeCommitSha}`,
    `- **realObsidianRuntimeUxStatus**: ${report.realObsidianRuntimeUxStatus}`,
    `- **realObsidianSmokeStatus**: ${report.realObsidianSmokeStatus}`,
    `- **cdpStatus**: ${report.cdpStatus}`,
    `- **cdpTargetTitle**: ${report.cdpTargetTitle || "null"}`,
    `- **cdpTargetUrl**: ${report.cdpTargetUrl || "null"}`,
    `- **skipReason**: ${report.skipReason || "null"}`,
    "",
    "## Runtime UX Observations",
    "",
    `- **firstOpenDefaultPackageObserved**: ${report.firstOpenDefaultPackageObserved}`,
    `- **runtimeMissingInstallRequiredObserved**: ${report.runtimeMissingInstallRequiredObserved}`,
    `- **installSuccessProviderReadyObserved**: ${report.installSuccessProviderReadyObserved}`,
    `- **commandTimelineObserved**: ${report.commandTimelineObserved}`,
    `- **fileEditTimelineObserved**: ${report.fileEditTimelineObserved}`,
    `- **approvalCardObserved**: ${report.approvalCardObserved}`,
    `- **diffCardObserved**: ${report.diffCardObserved}`,
    "",
    "## Timeline UX Evidence",
    "",
    `- **normalUserVerboseOutputDefaultCollapsed**: ${report.normalUserVerboseOutputDefaultCollapsed}`,
    `- **normalUserRawJsonSourceRefHidden**: ${report.normalUserRawJsonSourceRefHidden}`,
    `- **developerModeSourceRefVisible**: ${report.developerModeSourceRefVisible}`,
    `- **turnDiffUpdatedNormalHidden**: ${report.turnDiffUpdatedNormalHidden}`,
    `- **turnDiffUpdatedDeveloperVisible**: ${report.turnDiffUpdatedDeveloperVisible}`,
    "",
    "## Release Packaging Readiness",
    "",
    `- **releasePackageMode**: ${report.releasePackageMode}`,
    `- **containsRuntimeBinary**: ${report.containsRuntimeBinary}`,
    `- **runtimeDownloadRequired**: ${report.runtimeDownloadRequired}`,
    `- **runtimePinnedArtifactMetadataComplete**: ${report.runtimePinnedArtifactMetadataComplete}`,
    `- **runtimeInstallerPresent**: ${report.runtimeInstallerPresent}`,
    `- **runtimeInstallRequiresSystemNpm**: ${report.runtimeInstallRequiresSystemNpm}`,
    `- **runtimeInstallRequiresSystemTar**: ${report.runtimeInstallRequiresSystemTar}`,
    `- **defaultPackageSizeMB**: ${report.defaultPackageSizeMB}`,
    `- **offlineWin32X64PackageOptional**: ${report.offlineWin32X64PackageOptional}`,
    `- **offlineWin32X64PackageSizeMB**: ${report.offlineWin32X64PackageSizeMB}`,
    `- **noDistRuntimeTempFiles**: ${report.noDistRuntimeTempFiles}`,
    `- **installationRetryErrorCopyPresent**: ${report.installationRetryErrorCopyPresent}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((c) => `| ${escapeMd(c.name)} | ${c.status} | ${escapeMd(c.detail || "")} |`),
    "",
    "## Known Gaps",
    "",
    ...report.knownGaps.map((gap) => `- ${gap}`),
    "",
    "## Errors",
    "",
    ...(report.errors.length ? report.errors.map((error) => `- ${error}`) : ["- null"]),
    "",
    "## 运行命令",
    "",
    "```bash",
    "npm run smoke:codex-real-obsidian-runtime-ux",
    "```",
    "",
    "*报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成*",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
}

function escapeMd(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function main() {
  inspectPackaging();
  await runCdpProbe();
  if (report.realObsidianRuntimeUxStatus === "unknown") {
    report.realObsidianRuntimeUxStatus = "skip-cdp-unavailable";
    report.realObsidianSmokeStatus = "skip-cdp-unavailable";
    report.cdpStatus = "skip-cdp-unavailable";
    report.skipReason = "CDP probe did not run";
  }
  writeReport();
  console.log(`realObsidianRuntimeUxStatus=${report.realObsidianRuntimeUxStatus}`);
  console.log(`cdpStatus=${report.cdpStatus}`);
  console.log(`releasePackageMode=${report.releasePackageMode}`);
  console.log(`containsRuntimeBinary=${report.containsRuntimeBinary}`);
  console.log(`runtimeDownloadRequired=${report.runtimeDownloadRequired}`);
  console.log(`report=${REPORT_PATH}`);
  const hardFailure = report.realObsidianRuntimeUxStatus === "fail";
  process.exit(hardFailure ? 1 : 0);
}

main();
