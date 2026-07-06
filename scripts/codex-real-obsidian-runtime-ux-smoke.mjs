#!/usr/bin/env node
// LLM CLI Bridge — V17-F6 real Obsidian managed runtime UX smoke.

import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-real-obsidian-runtime-ux.md");
const USER_PACKAGE_DIR = join(PROJECT_ROOT, "dist", "user-package");
const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const OFFLINE_PACKAGE_DIR = join(PROJECT_ROOT, "dist", `user-package-offline-${PLATFORM_KEY}`);
const USER_PACKAGE_META_PATH = join(USER_PACKAGE_DIR, "llm-cli-bridge-user-package.json");
const RUNTIME_DIR = join(USER_PACKAGE_DIR, "codex-managed-runtime");
const MANIFEST_PATH = join(RUNTIME_DIR, "runtime-manifest.json");
const CDP_HOST = process.env.CDP_HOST || "127.0.0.1";
const CDP_PORT = process.env.CDP_PORT || "9223";
const CDP_BASE = process.env.CDP_BASE || `http://${CDP_HOST}:${CDP_PORT}`;
const CDP_TIMEOUT_MS = Number(process.env.CDP_TIMEOUT_MS || 5000);
const VIEW_TYPE = "llm-cli-bridge-view";

const report = {
  timestamp: new Date().toISOString(),
  testedCodeCommitSha: git(["rev-parse", "HEAD"]) || "unknown",
  realObsidianRuntimeUxStatus: "unknown",
  realObsidianSmokeStatus: "unknown",
  cdpStatus: "unknown",
  cdpBase: CDP_BASE,
  cdpJsonReachable: false,
  cdpVersionReachable: false,
  cdpTargetTitle: "",
  cdpTargetUrl: "",
  skipReason: "",
  skipDetail: "",
  obsidianLaunchHint: `Start Obsidian with --remote-debugging-port=${CDP_PORT} and verify ${CDP_BASE}/json is reachable.`,
  firstOpenDefaultPackageObserved: false,
  runtimeMissingInstallRequiredObserved: false,
  installSuccessProviderReadyObserved: false,
  commandTimelineObserved: false,
  fileEditTimelineObserved: false,
  approvalCardObserved: false,
  diffCardObserved: false,
  codexRunHeaderObserved: false,
  codexRunWaterfallFeedObserved: false,
  codexRunFeedBatchObserved: false,
  codexRunFeedBatchCount: 0,
  codexRunFeedItemCount: 0,
  codexRunNestedEventCount: 0,
  codexRunFeedSequence: "",
  codexRunThinkingCarrierObserved: false,
  codexRunThinkingCarrierStatus: "",
  codexRunOutputLabelCompact: false,
  changesPanelVisible: false,
  stepRowCount: 0,
  approvalGateVisibleWhenPending: false,
  diagnosticsCollapsedByDefault: false,
  commandOutputCollapsedInNormalMode: false,
  codexRunCommandShellPanelAvailable: false,
  codexRunShellOutputMerged: false,
  normalModeCommandSummaryPathRedacted: false,
  messageRenderFailureAbsent: false,
  developerRawEventAccessibleFromRunView: false,
  finalAnswerVisuallySeparated: false,
  installButtonMetadataComplete: false,
  installFailureRetryCopyObserved: false,
  runtimeInstallResultStatus: "",
  runtimeInstallSource: "",
  runtimeInstallTarballSha256Valid: false,
  runtimeInstallBinarySha256Valid: false,
  runtimeInstallBinarySizeValid: false,
  runtimeInstallExecutable: false,
  providerLabelAfterInstall: "",
  uiSmokeRunStatus: "",
  uiSmokeApprovalCount: 0,
  uiSmokeFinalAnswer: "",
  uiSmokeTargetFile: "",
  uiSmokeFileToken: "",
  normalModeRawSourceRefAbsentInDom: false,
  developerDebugViewAccessible: false,
  developerRawProviderEventAccessible: false,
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
  offlineWin32X64ContainsRuntimeBinary: false,
  offlineWin32X64Sha256Verified: false,
  offlineWin32X64ExecutableVerified: false,
  allPlatformFatPackageAbsent: true,
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function setSkip(reason, detail = "", status = `skip-${reason}`) {
  report.skipReason = reason;
  report.skipDetail = detail;
  report.realObsidianRuntimeUxStatus = status;
  report.realObsidianSmokeStatus = status;
}

async function fetchJson(url) {
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(CDP_TIMEOUT_MS)
    : undefined;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${url}`);
    error.cdpReason = "cdp-port-unreachable";
    throw error;
  }
  return await response.json();
}

function classifyPortError(error) {
  const cause = error?.cause;
  const causeCode = cause?.code || cause?.errno || "";
  const message = error?.message || String(error);
  if (
    causeCode === "ECONNREFUSED"
    || causeCode === "UND_ERR_CONNECT_TIMEOUT"
    || /fetch failed|ECONNREFUSED|actively refused|connection refused|timeout|timed out|aborted/i.test(message)
  ) {
    return "cdp-port-unreachable";
  }
  return error?.cdpReason || "cdp-port-unreachable";
}

function isObsidianTarget(page) {
  const haystack = [
    page?.url || "",
    page?.title || "",
    page?.description || "",
  ].join(" ").toLowerCase();
  return haystack.includes("obsidian.md")
    || haystack.includes("obsidian")
    || haystack.includes("app://obsidian");
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
  inspectOfflinePackage();
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
  addCheck("offline win32-x64 package optional or verified",
    !existsSync(OFFLINE_PACKAGE_DIR) || (report.offlineWin32X64Sha256Verified && report.offlineWin32X64ExecutableVerified),
    existsSync(OFFLINE_PACKAGE_DIR)
      ? `sizeMB=${report.offlineWin32X64PackageSizeMB} sha=${report.offlineWin32X64Sha256Verified} executable=${report.offlineWin32X64ExecutableVerified}`
      : "not-built");
  addCheck("all-platform fat package absent", report.allPlatformFatPackageAbsent, "");
  addCheck("install retry/error copy present", report.installationRetryErrorCopyPresent, "");
  addCheck("normal user verbose output collapsed", report.normalUserVerboseOutputDefaultCollapsed, "");
  addCheck("normal user raw sourceRef hidden", report.normalUserRawJsonSourceRefHidden, "");
  addCheck("developer mode sourceRef visible", report.developerModeSourceRefVisible, "");
  addCheck("turn/diff/updated hidden from normal timeline", report.turnDiffUpdatedNormalHidden, "");
  addCheck("turn/diff/updated visible in developer evidence", report.turnDiffUpdatedDeveloperVisible, "");
}

function inspectOfflinePackage() {
  if (!existsSync(OFFLINE_PACKAGE_DIR)) return;
  report.offlineWin32X64PackageSizeMB = formatMb(dirSizeBytes(OFFLINE_PACKAGE_DIR));
  const manifestPath = join(OFFLINE_PACKAGE_DIR, "codex-managed-runtime", "runtime-manifest.json");
  if (!existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const entry = manifest.platforms?.[PLATFORM_KEY];
    const runtimePath = entry?.path
      ? resolve(OFFLINE_PACKAGE_DIR, "codex-managed-runtime", entry.path)
      : "";
    report.offlineWin32X64ContainsRuntimeBinary = !!(runtimePath && existsSync(runtimePath));
    if (report.offlineWin32X64ContainsRuntimeBinary) {
      const stat = statSync(runtimePath);
      report.offlineWin32X64Sha256Verified = sha256File(runtimePath) === entry.sha256 && stat.size === entry.size;
      try {
        accessSync(runtimePath, constants.X_OK);
        report.offlineWin32X64ExecutableVerified = true;
      } catch {
        report.offlineWin32X64ExecutableVerified = process.platform === "win32" && runtimePath.toLowerCase().endsWith(".exe");
      }
    }
    const runtimeRoot = join(OFFLINE_PACKAGE_DIR, "codex-managed-runtime", "runtime");
    if (existsSync(runtimeRoot)) {
      const runtimePlatforms = readdirSync(runtimeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      report.allPlatformFatPackageAbsent = runtimePlatforms.length <= 1 && runtimePlatforms.every((name) => name === PLATFORM_KEY);
    }
  } catch (e) {
    report.errors.push(`offline package inspect failed: ${e.message}`);
  }
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
    try {
      await fetchJson(`${CDP_BASE}/json/version`);
      report.cdpVersionReachable = true;
    } catch {
      report.cdpVersionReachable = false;
    }
    let pages;
    try {
      pages = await fetchJson(`${CDP_BASE}/json`);
      report.cdpJsonReachable = true;
    } catch (e) {
      e.cdpReason = classifyPortError(e);
      throw e;
    }
    if (!Array.isArray(pages)) {
      const error = new Error("/json did not return a target array");
      error.cdpReason = "no-obsidian-target";
      throw error;
    }
    const page = pages.find((p) => p.type === "page" && isObsidianTarget(p));
    if (!page?.webSocketDebuggerUrl) {
      const targetSummary = pages
        .map((p) => `${p.type || "unknown"}:${p.title || ""}:${p.url || ""}`)
        .slice(0, 8)
        .join(" | ");
      const error = new Error(`Obsidian CDP target not found. targets=${targetSummary || "none"}`);
      error.cdpReason = "no-obsidian-target";
      throw error;
    }
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
      const detail = result.exceptionDetails.exception?.description
        || result.exceptionDetails.exception?.value
        || result.exceptionDetails.text
        || JSON.stringify(result.exceptionDetails);
      throw new Error(detail);
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

const CDP_PROBE = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getLeaves = () => globalThis.app?.workspace?.getLeavesOfType?.("${VIEW_TYPE}") ?? [];
  const getView = () => getLeaves()[0]?.view ?? null;
  const plugin = globalThis.app?.plugins?.plugins?.["llm-cli-bridge"] ?? null;
  if (!plugin) return { pluginLoaded: false, viewLoaded: false };

  const previousBackendMode = plugin.settings?.backendMode;
  const previousDeveloperMode = plugin.settings?.developerMode;
  if (plugin.settings) plugin.settings.backendMode = "auto";
  await plugin.activateView?.();
  await sleep(300);

  let view = getView();
  if (view?.refreshOnSettingsChange) view.refreshOnSettingsChange();
  await sleep(100);

  let status = plugin?.getManagedRuntimeInstallStatus?.() ?? null;
  const statusText = view?.statusLabelEl?.textContent ?? "";
  const installButton = view?.runtimeInstallBtnEl ?? null;
  const installButtonVisible = !!installButton && !installButton.hasAttribute("hidden");
  const installButtonTitle = installButton?.getAttribute("title") ?? "";
  const installButtonMetadataComplete = /Runtime version:/i.test(installButtonTitle)
    && /Download size:/i.test(installButtonTitle)
    && /Source:/i.test(installButtonTitle)
    && /SHA-256:/i.test(installButtonTitle)
    && /Install path:/i.test(installButtonTitle);
  const runtimeMissingInstallRequiredObserved = status?.required === true
    && /install required/i.test(statusText)
    && installButtonVisible
    && installButtonMetadataComplete;

  let installResult = null;
  let afterStatus = status;
  let providerStatus = null;
  if (status?.required === true && typeof plugin.ensureManagedRuntimeInstalled === "function") {
    installResult = await plugin.ensureManagedRuntimeInstalled({ confirm: true });
    await sleep(300);
    view = getView();
    if (view?.refreshOnSettingsChange) view.refreshOnSettingsChange();
    await sleep(100);
    afterStatus = plugin.getManagedRuntimeInstallStatus?.() ?? installResult;
  }
  try {
    const vaultPath = globalThis.app?.vault?.adapter?.getBasePath?.() ?? "";
    providerStatus = plugin.getRuntimeProviderStatusForSmoke?.(vaultPath) ?? null;
  } catch {}

  const finalStatusText = view?.statusLabelEl?.textContent ?? "";
  const providerLabel = providerStatus?.label ?? finalStatusText;
  const providerReady = !afterStatus?.required
    && /codex managed/i.test(providerLabel)
    && !/install required|unavailable/i.test(providerLabel);

  let uiSmokeRunStatus = "not-run";
  let uiSmokeApprovalCount = 0;
  let uiSmokeFinalAnswer = "";
  let uiSmokeTargetFile = "";
  let uiSmokeCommandToken = "";
  let uiSmokeFileToken = "";
  let approvalGateVisibleWhenPending = false;
  if (providerReady && view) {
    const smokeSuffix = String(Date.now());
    uiSmokeCommandToken = "V17G_OBSIDIAN_COMMAND_SMOKE_" + smokeSuffix;
    uiSmokeFileToken = "V17G_OBSIDIAN_FILE_SMOKE_" + smokeSuffix;
    uiSmokeTargetFile = "_llm_bridge_smoke/v17-g-run-ui-" + smokeSuffix + ".md";
    const smokePrompt = "V17G_OBSIDIAN_UI_SMOKE. Do exactly these two actions in this vault: (1) run a harmless shell command that prints " + uiSmokeCommandToken + ", (2) create the new file " + uiSmokeTargetFile + " with exactly one line: " + uiSmokeFileToken + ". For the file edit, do not use shell redirection, PowerShell file write, or Python; use apply_patch/file-change so the UI can show a diff. Then answer only: done.";
    if (plugin.settings) {
      plugin.settings.developerMode = true;
      plugin.settings.claudePermissionMode = "default";
      plugin.settings.includeActiveNote = false;
      plugin.settings.includeSelection = false;
      await plugin.saveSettings?.();
    }
    view.doNewSession?.();
    await sleep(200);
    view.setInput?.(smokePrompt);
    if (view.inputEl) {
      view.inputEl.value = smokePrompt;
      view.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const runPromise = view.runNow?.().catch((e) => ({ runError: String(e?.message || e) }));
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await sleep(500);
      const buttons = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-approval-card .is-proceed, .llm-bridge-turn-approval-card button[data-decision='allow_once'], .llm-bridge-codex-approval-btn[data-decision='allow_once']") ?? []);
      if (buttons.length > 0) {
        approvalGateVisibleWhenPending = approvalGateVisibleWhenPending
          || !!view.containerEl?.querySelector?.(".llm-bridge-codex-approval-gate, .llm-bridge-approval-card");
      }
      for (const button of buttons) {
        if (!button.disabled) {
          uiSmokeApprovalCount += 1;
          button.click();
          await sleep(700);
        }
      }
      if (!view.runHandle) break;
    }
    const runResult = runPromise
      ? await Promise.race([runPromise, sleep(5000).then(() => "run-promise-timeout")])
      : "runNow-missing";
    await sleep(1200);
    uiSmokeRunStatus = typeof runResult === "object" && runResult?.runError ? "run-error" : "completed";
  }

  const turn = Array.isArray(view?.messages)
    ? [...view.messages].reverse().find((m) => m?.role === "assistant" && m?.assistantTurnView)?.assistantTurnView ?? null
    : null;
  const nodes = turn?.turnTimeline ?? [];
  const domText = view?.containerEl?.textContent ?? "";
  uiSmokeFinalAnswer = String(turn?.finalAnswer ?? "").slice(0, 500);
  const commandTimelineObserved = nodes.some((n) => n.kind === "commandExecution")
    || /V17F6_OBSIDIAN_COMMAND_SMOKE/.test(domText)
    || (uiSmokeFileToken && domText.includes(uiSmokeFileToken.replace("FILE", "COMMAND")))
    || !!view?.containerEl?.querySelector?.(".llm-bridge-tl-tool");
  const fileEditTimelineObserved = nodes.some((n) => n.kind === "fileChange")
    || /v17-f6-obsidian-smoke/.test(domText)
    || (!!uiSmokeTargetFile && domText.includes(uiSmokeTargetFile))
    || (!!uiSmokeFileToken && domText.includes(uiSmokeFileToken))
    || !!view?.containerEl?.querySelector?.(".llm-bridge-tl-file");
  const approvalCardObserved = nodes.some((n) => n.kind === "approval")
    || uiSmokeApprovalCount > 0
    || !!view?.containerEl?.querySelector?.(".llm-bridge-turn-approval-card, .llm-bridge-approval-card, .llm-bridge-codex-approval-gate");
  const diffCardObserved = nodes.some((n) => n.kind === "fileChange" && (n.diff || n.fileChanges?.some?.((c) => c.diff)))
    || /diff:/i.test(domText)
    || !!view?.containerEl?.querySelector?.(".llm-bridge-tl-file details, .llm-bridge-codex-diff-preview");

  let normalModeRawSourceRefAbsentInDom = false;
  let developerDebugViewAccessible = false;
  let developerRawProviderEventAccessible = false;
  let codexRunHeaderObserved = false;
  let changesPanelVisible = false;
  let stepRowCount = 0;
  let diagnosticsCollapsedByDefault = false;
  let commandOutputCollapsedInNormalMode = false;
  let codexRunCommandShellPanelAvailable = false;
  let codexRunShellOutputMerged = false;
  let normalModeCommandSummaryPathRedacted = false;
  let developerRawEventAccessibleFromRunView = false;
  let finalAnswerVisuallySeparated = false;
  let codexRunWaterfallFeedObserved = false;
  let codexRunFeedBatchObserved = false;
  let codexRunFeedBatchCount = 0;
  let codexRunFeedItemCount = 0;
  let codexRunNestedEventCount = 0;
  let codexRunFeedSequence = "";
  let codexRunThinkingCarrierObserved = false;
  let codexRunThinkingCarrierStatus = "";
  let codexRunOutputLabelCompact = false;
  let messageRenderFailureAbsent = false;
  if (view && turn) {
    if (plugin.settings) plugin.settings.developerMode = false;
    view.renderMessagesFromHistory?.();
    await sleep(50);
    const normalText = view.containerEl?.textContent ?? "";
    normalModeRawSourceRefAbsentInDom = !/threadId=|turnId=|itemId=|sourceRef|raw provider events/i.test(normalText);
    codexRunHeaderObserved = !!view.containerEl?.querySelector?.(".llm-bridge-codex-run-header .llm-bridge-codex-run-status")
      && !!view.containerEl?.querySelector?.(".llm-bridge-codex-run-metrics");
    const feedItems = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-feed-item") ?? []);
    const thinkingLines = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-thinking-line") ?? []);
    const feedBatches = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-feed-batch") ?? []);
    const nestedEvents = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-feed-item.is-batch-event") ?? []);
    const feedKinds = feedItems.map((el) => el.getAttribute("data-step-kind") || "unknown");
    const thinkingItem = thinkingLines[0] ?? feedItems.find((el) => (el.getAttribute("data-step-kind") || "") === "thinking");
    const thinkingSummary = thinkingItem?.querySelector?.(".llm-bridge-codex-thinking-summary, .llm-bridge-codex-feed-summary")?.textContent?.trim() || "";
    const outputLabels = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-feed-item.is-assistant .llm-bridge-codex-feed-label") ?? [])
      .map((el) => el.textContent?.trim() || "");
    const inlineOutputTexts = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-feed-output-text") ?? [])
      .map((el) => el.textContent?.trim() || "")
      .filter(Boolean);
    codexRunFeedBatchCount = feedBatches.length;
    codexRunFeedItemCount = feedItems.length;
    codexRunNestedEventCount = nestedEvents.length;
    codexRunFeedSequence = [...thinkingLines.map(() => "thinking"), ...feedKinds].join(">");
    codexRunThinkingCarrierObserved = thinkingSummary.length > 0;
    codexRunThinkingCarrierStatus = thinkingSummary.includes("not provided by Codex") ? "not-provided" : thinkingSummary ? "summary-visible" : "empty";
    codexRunOutputLabelCompact = inlineOutputTexts.length > 0
      && !/Assistant output/i.test(normalText)
      && outputLabels.every((label) => label === "Output");
    codexRunWaterfallFeedObserved = feedItems.length >= 2
      && (thinkingLines.length > 0 || feedKinds.includes("thinking") || feedKinds.includes("assistant"))
      && feedKinds.some((kind) => ["command", "file", "mcp", "dynamic"].includes(kind));
    codexRunFeedBatchObserved = feedBatches.length >= 1 && nestedEvents.length >= 1;
    changesPanelVisible = !!view.containerEl?.querySelector?.(".llm-bridge-codex-changes-panel .llm-bridge-codex-change-row");
    stepRowCount = view.containerEl?.querySelectorAll?.(".llm-bridge-codex-step-row, .llm-bridge-codex-event-block")?.length ?? 0;
    const diagnosticsBody = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-diagnostics-body") ?? []);
    diagnosticsCollapsedByDefault = diagnosticsBody.length === 0 || diagnosticsBody.every((el) => el.hasAttribute("hidden"));
    commandOutputCollapsedInNormalMode = !view.containerEl?.querySelector?.(".llm-bridge-codex-event-block.is-command[open], .llm-bridge-codex-detail-command[open], .llm-bridge-codex-detail-stdout[open], .llm-bridge-codex-detail-stderr[open]");
    const commandSummaryText = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-feed-item.is-command .llm-bridge-codex-feed-summary") ?? [])
      .map((el) => el.textContent || "")
      .join(" ");
    const commandDetailSummaryText = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-detail-command summary") ?? [])
      .map((el) => el.textContent || "")
      .join(" ");
    const inlineShellPanels = view.containerEl?.querySelectorAll?.(".llm-bridge-codex-event-block.is-command .llm-bridge-codex-inline-shell-panel")?.length ?? 0;
    const nestedCommandShellDetails = view.containerEl?.querySelectorAll?.(".llm-bridge-codex-event-block.is-command .llm-bridge-codex-detail-shell")?.length ?? 0;
    const separateOutputDetails = view.containerEl?.querySelectorAll?.(".llm-bridge-codex-event-block.is-command .llm-bridge-codex-detail-stdout, .llm-bridge-codex-event-block.is-command .llm-bridge-codex-detail-stderr")?.length ?? 0;
    const shellPanelText = Array.from(view.containerEl?.querySelectorAll?.(".llm-bridge-codex-inline-shell-panel .llm-bridge-codex-detail-pre, .llm-bridge-codex-detail-shell .llm-bridge-codex-detail-pre") ?? [])
      .map((el) => el.textContent || "")
      .join(String.fromCharCode(10));
    codexRunCommandShellPanelAvailable = inlineShellPanels > 0 || /Shell\\s*·/.test(commandDetailSummaryText);
    codexRunShellOutputMerged = codexRunCommandShellPanelAvailable
      && inlineShellPanels > 0
      && nestedCommandShellDetails === 0
      && separateOutputDetails === 0
      && shellPanelText.includes("$")
      && !!uiSmokeCommandToken
      && shellPanelText.includes(uiSmokeCommandToken);
    normalModeCommandSummaryPathRedacted = commandSummaryText.length === 0 || (!/\\bcwd\\s*=/.test(commandSummaryText) && !/[A-Za-z]:\\\\/.test(commandSummaryText));
    messageRenderFailureAbsent = !/消息渲染失败|Cannot use .?in.? operator/i.test(normalText);
    finalAnswerVisuallySeparated = !view.containerEl?.querySelector?.(".llm-bridge-codex-final-answer-marker")
      && !!view.containerEl?.querySelector?.(".llm-bridge-msg-content");

    if (plugin.settings) plugin.settings.developerMode = true;
    view.renderMessagesFromHistory?.();
    await sleep(50);
    const devText = view.containerEl?.textContent ?? "";
    messageRenderFailureAbsent = messageRenderFailureAbsent && !/消息渲染失败|Cannot use .?in.? operator/i.test(devText);
    developerDebugViewAccessible = !!view.containerEl?.querySelector?.(".llm-bridge-raw-events, .llm-bridge-provider-session-audit, .llm-bridge-attachment-audit")
      || /threadId=|turnId=|itemId=|method=/.test(devText);
    developerRawProviderEventAccessible = !!view.containerEl?.querySelector?.(".llm-bridge-raw-events-text")
      || /raw provider events/i.test(devText);
    developerRawEventAccessibleFromRunView = developerRawProviderEventAccessible
      && (!!view.containerEl?.querySelector?.(".llm-bridge-codex-source-ref")
        || /threadId=|turnId=|itemId=|method=/.test(devText));
  }

  if (plugin.settings) {
    plugin.settings.developerMode = previousDeveloperMode;
    plugin.settings.backendMode = previousBackendMode ?? plugin.settings.backendMode;
  }
  view?.renderMessagesFromHistory?.();
  view?.refreshOnSettingsChange?.();

  return {
    pluginLoaded: true,
    viewLoaded: !!view,
    backendMode: plugin?.settings?.backendMode ?? "",
    runtimeStatus: afterStatus,
    statusText: finalStatusText || statusText,
    installButtonVisible,
    installButtonTitle,
    installButtonMetadataComplete,
    installResult,
    providerStatus,
    providerLabel,
    providerReady,
    uiSmokeRunStatus,
    uiSmokeApprovalCount,
    uiSmokeFinalAnswer,
    installRequiredSurfaced: runtimeMissingInstallRequiredObserved,
    commandTimelineObserved,
    fileEditTimelineObserved,
    approvalCardObserved,
    diffCardObserved,
    codexRunHeaderObserved,
    codexRunWaterfallFeedObserved,
    codexRunFeedBatchObserved,
    codexRunFeedBatchCount,
    codexRunFeedItemCount,
    codexRunNestedEventCount,
    codexRunFeedSequence,
    codexRunThinkingCarrierObserved,
    codexRunThinkingCarrierStatus,
    codexRunOutputLabelCompact,
    changesPanelVisible,
    stepRowCount,
    approvalGateVisibleWhenPending,
    uiSmokeTargetFile,
    uiSmokeFileToken,
    diagnosticsCollapsedByDefault,
    commandOutputCollapsedInNormalMode,
    codexRunCommandShellPanelAvailable,
    codexRunShellOutputMerged,
    normalModeCommandSummaryPathRedacted,
    messageRenderFailureAbsent,
    developerRawEventAccessibleFromRunView,
    finalAnswerVisuallySeparated,
    normalModeRawSourceRefAbsentInDom,
    developerDebugViewAccessible,
    developerRawProviderEventAccessible,
  };
})()
`;

async function runCdpProbe() {
  if (typeof fetch !== "function" || typeof WebSocket !== "function") {
    report.cdpStatus = "skip-runtime-no-fetch-or-websocket";
    setSkip("cdp-port-unreachable", "Node runtime lacks fetch/WebSocket globals required by CDP smoke", "skip-cdp-unavailable");
    return;
  }
  let cdp = null;
  try {
    cdp = await CDP.connect();
    report.cdpStatus = "connected";
    const probe = await cdp.eval(CDP_PROBE);
    if (!probe.pluginLoaded) {
      report.cdpStatus = "connected";
      setSkip("plugin-not-loaded", "Obsidian target is reachable, but app.plugins.plugins['llm-cli-bridge'] is missing.");
      addCheck("real Obsidian plugin loaded", false, "plugin-not-loaded");
      return;
    }
    if (!probe.viewLoaded) {
      report.cdpStatus = "connected";
      setSkip("bridge-view-not-open", "Plugin is loaded, but activating llm-cli-bridge-view did not produce a Bridge view.");
      addCheck("real Obsidian plugin loaded", true, "");
      addCheck("Bridge view opened through plugin.activateView", false, "bridge-view-not-open");
      return;
    }
    report.firstOpenDefaultPackageObserved = !!(probe.pluginLoaded && probe.viewLoaded);
    report.runtimeMissingInstallRequiredObserved = !!probe.installRequiredSurfaced;
    report.installSuccessProviderReadyObserved = !!probe.providerReady;
    report.commandTimelineObserved = !!probe.commandTimelineObserved;
    report.fileEditTimelineObserved = !!probe.fileEditTimelineObserved;
    report.approvalCardObserved = !!probe.approvalCardObserved;
    report.diffCardObserved = !!probe.diffCardObserved;
    report.codexRunHeaderObserved = !!probe.codexRunHeaderObserved;
    report.codexRunWaterfallFeedObserved = !!probe.codexRunWaterfallFeedObserved;
    report.codexRunFeedBatchObserved = !!probe.codexRunFeedBatchObserved;
    report.codexRunFeedBatchCount = Number(probe.codexRunFeedBatchCount || 0);
    report.codexRunFeedItemCount = Number(probe.codexRunFeedItemCount || 0);
    report.codexRunNestedEventCount = Number(probe.codexRunNestedEventCount || 0);
    report.codexRunFeedSequence = probe.codexRunFeedSequence || "";
    report.codexRunThinkingCarrierObserved = !!probe.codexRunThinkingCarrierObserved;
    report.codexRunThinkingCarrierStatus = probe.codexRunThinkingCarrierStatus || "";
    report.codexRunOutputLabelCompact = !!probe.codexRunOutputLabelCompact;
    report.changesPanelVisible = !!probe.changesPanelVisible;
    report.stepRowCount = Number(probe.stepRowCount || 0);
    report.approvalGateVisibleWhenPending = !!probe.approvalGateVisibleWhenPending;
    report.diagnosticsCollapsedByDefault = !!probe.diagnosticsCollapsedByDefault;
    report.commandOutputCollapsedInNormalMode = !!probe.commandOutputCollapsedInNormalMode;
    report.codexRunCommandShellPanelAvailable = !!probe.codexRunCommandShellPanelAvailable;
    report.codexRunShellOutputMerged = !!probe.codexRunShellOutputMerged;
    report.normalModeCommandSummaryPathRedacted = !!probe.normalModeCommandSummaryPathRedacted;
    report.messageRenderFailureAbsent = !!probe.messageRenderFailureAbsent;
    report.developerRawEventAccessibleFromRunView = !!probe.developerRawEventAccessibleFromRunView;
    report.finalAnswerVisuallySeparated = !!probe.finalAnswerVisuallySeparated;
    report.installButtonMetadataComplete = !!probe.installButtonMetadataComplete;
    report.runtimeInstallResultStatus = probe.installResult?.status || "";
    report.runtimeInstallSource = probe.installResult?.installSource || "";
    report.runtimeInstallTarballSha256Valid = probe.installResult?.tarballSha256Valid === true;
    report.runtimeInstallBinarySha256Valid = probe.installResult?.binarySha256Valid === true;
    report.runtimeInstallBinarySizeValid = probe.installResult?.binarySizeValid === true;
    report.runtimeInstallExecutable = probe.installResult?.runtimeExecutable === true;
    report.providerLabelAfterInstall = probe.providerLabel || "";
    report.uiSmokeRunStatus = probe.uiSmokeRunStatus || "";
    report.uiSmokeApprovalCount = Number(probe.uiSmokeApprovalCount || 0);
    report.uiSmokeFinalAnswer = probe.uiSmokeFinalAnswer || "";
    report.uiSmokeTargetFile = probe.uiSmokeTargetFile || "";
    report.uiSmokeFileToken = probe.uiSmokeFileToken || "";
    report.normalModeRawSourceRefAbsentInDom = !!probe.normalModeRawSourceRefAbsentInDom;
    report.developerDebugViewAccessible = !!probe.developerDebugViewAccessible;
    report.developerRawProviderEventAccessible = !!probe.developerRawProviderEventAccessible;
    report.installFailureRetryCopyObserved = report.installationRetryErrorCopyPresent;
    addCheck("real Obsidian plugin and bridge view loaded", report.firstOpenDefaultPackageObserved, `${probe.backendMode || "backendMode unknown"}`);
    addCheck("runtime missing surfaces install required", report.runtimeMissingInstallRequiredObserved || report.installSuccessProviderReadyObserved, probe.statusText || "");
    addCheck("install button metadata title complete", report.installButtonMetadataComplete || report.installSuccessProviderReadyObserved, probe.installButtonTitle || "");
    addCheck("runtime installer verified tarball/binary in Obsidian",
      report.installSuccessProviderReadyObserved
        && (report.runtimeInstallResultStatus === "installed" || report.runtimeInstallResultStatus === "already-installed" || report.runtimeInstallResultStatus === "")
        && (report.runtimeInstallResultStatus === "" || (report.runtimeInstallTarballSha256Valid && report.runtimeInstallBinarySha256Valid && report.runtimeInstallBinarySizeValid && report.runtimeInstallExecutable)),
      `status=${report.runtimeInstallResultStatus || "already-present"} source=${report.runtimeInstallSource || "n/a"}`);
    addCheck("install success surfaces provider ready", report.installSuccessProviderReadyObserved, report.providerLabelAfterInstall || probe.statusText || "");
    addCheck("real Obsidian Codex UI smoke run completed", report.uiSmokeRunStatus === "completed", report.uiSmokeFinalAnswer);
    addCheck("real Obsidian command timeline observed", report.commandTimelineObserved, "");
    addCheck("real Obsidian file edit timeline observed", report.fileEditTimelineObserved, "");
    addCheck("real Obsidian approval card observed or not requested by protocol",
      report.approvalCardObserved || report.uiSmokeApprovalCount === 0,
      report.approvalCardObserved ? "observed" : "not-observed in this real run");
    addCheck("real Obsidian diff card observed", report.diffCardObserved, "");
    addCheck("real Obsidian Codex run header observed", report.codexRunHeaderObserved, "");
    addCheck("real Obsidian Codex waterfall feed observed", report.codexRunWaterfallFeedObserved, `feed=${report.codexRunFeedSequence}`);
    addCheck("real Obsidian Codex feed batches observed", report.codexRunFeedBatchObserved, `batches=${report.codexRunFeedBatchCount} nestedEvents=${report.codexRunNestedEventCount}`);
    addCheck("real Obsidian Codex thinking carrier visible", report.codexRunThinkingCarrierObserved, report.codexRunThinkingCarrierStatus);
    addCheck("real Obsidian Codex inline output compact", report.codexRunOutputLabelCompact, "");
    addCheck("real Obsidian changes panel visible", report.changesPanelVisible, "");
    addCheck("real Obsidian step row count correct", report.stepRowCount >= 2, `stepRowCount=${report.stepRowCount}`);
    addCheck("real Obsidian approval gate visible when pending", report.approvalGateVisibleWhenPending || report.uiSmokeApprovalCount === 0, `approvals=${report.uiSmokeApprovalCount}`);
    addCheck("real Obsidian diagnostics collapsed by default", report.diagnosticsCollapsedByDefault, "");
    addCheck("real Obsidian command output collapsed in normal mode", report.commandOutputCollapsedInNormalMode, "");
    addCheck("real Obsidian Codex-style command shell panel available", report.codexRunCommandShellPanelAvailable, "");
    addCheck("real Obsidian command shell/output merged", report.codexRunShellOutputMerged, "");
    addCheck("real Obsidian normal mode command summary path redacted", report.normalModeCommandSummaryPathRedacted, "");
    addCheck("real Obsidian message render failure absent", report.messageRenderFailureAbsent, "");
    addCheck("real Obsidian developer mode raw event accessible from run view", report.developerRawEventAccessibleFromRunView, "");
    addCheck("real Obsidian final answer visually separated", report.finalAnswerVisuallySeparated, "");
    addCheck("real Obsidian normal mode raw sourceRef absent", report.normalModeRawSourceRefAbsentInDom, "");
    addCheck("real Obsidian developer debug view/sourceRef accessible", report.developerDebugViewAccessible, "");
    addCheck("real Obsidian developer raw provider event accessible", report.developerRawProviderEventAccessible, "");
    report.realObsidianRuntimeUxStatus = report.checks.some((c) => c.name.startsWith("real Obsidian") && c.status === "fail")
      ? "partial"
      : "pass";
    report.realObsidianSmokeStatus = report.realObsidianRuntimeUxStatus;
  } catch (e) {
    const reason = e?.cdpReason || classifyPortError(e);
    report.cdpStatus = reason === "no-obsidian-target" ? "skip-no-obsidian-target" : "skip-cdp-unavailable";
    setSkip(reason, e.message || String(e), report.cdpStatus);
  } finally {
    if (cdp) cdp.close();
  }
}

function writeReport() {
  mkdirSync(DOCS_DIR, { recursive: true });
  const lines = [
    "# LLM CLI Bridge 测试报告 — Codex Real Obsidian Runtime UX Smoke (V17-G Native Run UI)",
    "",
    "> 本报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成。",
    "> 它只在真实 Obsidian 通过 CDP 暴露时记录真实 UI 观察；CDP 不可用时明确 skip，不把合成 smoke 伪装为真实 UI pass。",
    "",
    `- **测试时间**: ${report.timestamp}`,
    `- **testedCodeCommitSha**: ${report.testedCodeCommitSha}`,
    `- **realObsidianRuntimeUxStatus**: ${report.realObsidianRuntimeUxStatus}`,
    `- **realObsidianSmokeStatus**: ${report.realObsidianSmokeStatus}`,
    `- **cdpStatus**: ${report.cdpStatus}`,
    `- **cdpBase**: ${report.cdpBase}`,
    `- **cdpJsonReachable**: ${report.cdpJsonReachable}`,
    `- **cdpVersionReachable**: ${report.cdpVersionReachable}`,
    `- **cdpTargetTitle**: ${report.cdpTargetTitle || "null"}`,
    `- **cdpTargetUrl**: ${report.cdpTargetUrl || "null"}`,
    `- **skipReason**: ${report.skipReason || "null"}`,
    `- **skipDetail**: ${report.skipDetail || "null"}`,
    `- **obsidianLaunchHint**: ${report.obsidianLaunchHint}`,
    "",
    "## CDP Environment Entry",
    "",
    `- Start Obsidian with: \`Obsidian.exe --remote-debugging-port=${CDP_PORT}\``,
    `- Verify CDP target list: \`${CDP_BASE}/json\``,
    `- Expected skip reasons: \`cdp-port-unreachable\`, \`no-obsidian-target\`, \`plugin-not-loaded\`, \`bridge-view-not-open\``,
    "",
    "## Runtime UX Observations",
    "",
    `- **firstOpenDefaultPackageObserved**: ${report.firstOpenDefaultPackageObserved}`,
    `- **runtimeMissingInstallRequiredObserved**: ${report.runtimeMissingInstallRequiredObserved}`,
    `- **installSuccessProviderReadyObserved**: ${report.installSuccessProviderReadyObserved}`,
    `- **installButtonMetadataComplete**: ${report.installButtonMetadataComplete}`,
    `- **runtimeInstallResultStatus**: ${report.runtimeInstallResultStatus || "null"}`,
    `- **runtimeInstallSource**: ${report.runtimeInstallSource || "null"}`,
    `- **runtimeInstallTarballSha256Valid**: ${report.runtimeInstallTarballSha256Valid}`,
    `- **runtimeInstallBinarySha256Valid**: ${report.runtimeInstallBinarySha256Valid}`,
    `- **runtimeInstallBinarySizeValid**: ${report.runtimeInstallBinarySizeValid}`,
    `- **runtimeInstallExecutable**: ${report.runtimeInstallExecutable}`,
    `- **providerLabelAfterInstall**: ${report.providerLabelAfterInstall || "null"}`,
    `- **installFailureRetryCopyObserved**: ${report.installFailureRetryCopyObserved}`,
    `- **uiSmokeRunStatus**: ${report.uiSmokeRunStatus || "null"}`,
    `- **uiSmokeApprovalCount**: ${report.uiSmokeApprovalCount}`,
    `- **uiSmokeTargetFile**: ${report.uiSmokeTargetFile || "null"}`,
    `- **uiSmokeFileToken**: ${report.uiSmokeFileToken || "null"}`,
    `- **uiSmokeFinalAnswer**: ${escapeMd(report.uiSmokeFinalAnswer || "null")}`,
    `- **commandTimelineObserved**: ${report.commandTimelineObserved}`,
    `- **fileEditTimelineObserved**: ${report.fileEditTimelineObserved}`,
    `- **approvalCardObserved**: ${report.approvalCardObserved}`,
    `- **diffCardObserved**: ${report.diffCardObserved}`,
    `- **codexRunHeaderObserved**: ${report.codexRunHeaderObserved}`,
    `- **codexRunWaterfallFeedObserved**: ${report.codexRunWaterfallFeedObserved}`,
    `- **codexRunFeedBatchObserved**: ${report.codexRunFeedBatchObserved}`,
    `- **codexRunFeedBatchCount**: ${report.codexRunFeedBatchCount}`,
    `- **codexRunFeedItemCount**: ${report.codexRunFeedItemCount}`,
    `- **codexRunNestedEventCount**: ${report.codexRunNestedEventCount}`,
    `- **codexRunFeedSequence**: ${report.codexRunFeedSequence || "null"}`,
    `- **codexRunThinkingCarrierObserved**: ${report.codexRunThinkingCarrierObserved}`,
    `- **codexRunThinkingCarrierStatus**: ${report.codexRunThinkingCarrierStatus || "null"}`,
    `- **codexRunOutputLabelCompact**: ${report.codexRunOutputLabelCompact}`,
    `- **changesPanelVisible**: ${report.changesPanelVisible}`,
    `- **stepRowCount**: ${report.stepRowCount}`,
    `- **approvalGateVisibleWhenPending**: ${report.approvalGateVisibleWhenPending}`,
    "",
    "## Timeline UX Evidence",
    "",
    `- **diagnosticsCollapsedByDefault**: ${report.diagnosticsCollapsedByDefault}`,
    `- **commandOutputCollapsedInNormalMode**: ${report.commandOutputCollapsedInNormalMode}`,
    `- **codexRunCommandShellPanelAvailable**: ${report.codexRunCommandShellPanelAvailable}`,
    `- **codexRunShellOutputMerged**: ${report.codexRunShellOutputMerged}`,
    `- **normalModeCommandSummaryPathRedacted**: ${report.normalModeCommandSummaryPathRedacted}`,
    `- **messageRenderFailureAbsent**: ${report.messageRenderFailureAbsent}`,
    `- **developerRawEventAccessibleFromRunView**: ${report.developerRawEventAccessibleFromRunView}`,
    `- **finalAnswerVisuallySeparated**: ${report.finalAnswerVisuallySeparated}`,
    `- **normalUserVerboseOutputDefaultCollapsed**: ${report.normalUserVerboseOutputDefaultCollapsed}`,
    `- **normalUserRawJsonSourceRefHidden**: ${report.normalUserRawJsonSourceRefHidden}`,
    `- **developerModeSourceRefVisible**: ${report.developerModeSourceRefVisible}`,
    `- **turnDiffUpdatedNormalHidden**: ${report.turnDiffUpdatedNormalHidden}`,
    `- **turnDiffUpdatedDeveloperVisible**: ${report.turnDiffUpdatedDeveloperVisible}`,
    `- **normalModeRawSourceRefAbsentInDom**: ${report.normalModeRawSourceRefAbsentInDom}`,
    `- **developerDebugViewAccessible**: ${report.developerDebugViewAccessible}`,
    `- **developerRawProviderEventAccessible**: ${report.developerRawProviderEventAccessible}`,
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
    `- **offlineWin32X64ContainsRuntimeBinary**: ${report.offlineWin32X64ContainsRuntimeBinary}`,
    `- **offlineWin32X64Sha256Verified**: ${report.offlineWin32X64Sha256Verified}`,
    `- **offlineWin32X64ExecutableVerified**: ${report.offlineWin32X64ExecutableVerified}`,
    `- **allPlatformFatPackageAbsent**: ${report.allPlatformFatPackageAbsent}`,
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
