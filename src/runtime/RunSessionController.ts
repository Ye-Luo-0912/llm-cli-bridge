// LLM CLI Bridge — RunSessionController
//
// Owns the run lifecycle: session creation, run(), stop(), watchdog,
// normalized event processing, run completion, resume/native session updates,
// and runtime install status changes.
//
// The controller receives a RunSessionHost (implemented by LLMBridgeView) for
// all DOM/UI concerns and outputs state changes via host callbacks.
// view.ts does NOT import AssistantTurnViewBuilder / buildAgentRunDisplayModel /
// buildCodexRunViewModel — those are encapsulated here and consumed via
// runtime/core/viewModels.

import { Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type { App, TFile } from "obsidian";
import type LLMBridgePlugin from "../../main";
import { exportState } from "../state";
import { diffSnapshots, FileSnapshot, snapshotVaultMarkdownFiles } from "../fileDiff";
import { buildPromptPackage, StateSnapshot } from "../promptPackage";
import { SdkStreamingInput, AgentRunHandle } from "../agentBackend";
import { AttachmentPlan, ChatMessage, RunResult, RunStatus } from "../types";
import type { LLMBridgeSettings } from "../types";
import { buildCommandPreview, previewToRows } from "../commandProfile";
import { buildTimeline, TimelineEventType } from "../runTimeline";
import { buildWorkflowTrace, WorkflowTraceStage, WorkflowTraceEvent, WorkflowTraceEntry } from "../workflowTrace";
import { buildErrorSummary } from "../preflightStatus";
import { WorkflowEvent, PermissionEvent } from "../workflowEvent";
import { FileRef, buildPromptFileRefIndex } from "../fileRefs";
import { AttachmentTextSnippet } from "../fileIngestion";
import { DEFAULT_ATTACHMENT_PACKING_POLICY } from "../attachmentPackingPolicy";
import { AgentFileToolRouteRequest, AgentFileToolRouteResult } from "../agentFileToolBridge";
import { createRuntimeFileToolAdapter } from "../runtimeFileToolAdapter";
import { SessionState, generateSessionTitle, updateSession } from "../session";
import { saveSession, SessionExtras } from "../sessions";
import { PreflightResult } from "../agentProfile";
import { mapAgentApprovalProfileToClaudePermissionMode, type AgentApprovalProfile } from "../agentApprovalProfile";
import { createBridgeSession, type BridgeSessionImpl } from "./core/bridgeSession";
import type { RunInput, NormalizedRuntimeEvent, AssistantTurnView, NativeSessionRef } from "./core/types";
import type { ManagedRuntimeInstallStatus } from "./providers/codex-managed-app-server/codexManagedRuntimeInstallerBridge";
import {
  ensureManagedRuntimeIntegrityVerified,
  resolveManifestPath,
} from "./providers/codex-managed-app-server/codexManagedRuntimeResolver";
import { mapNormalizedToWorkflowEvent } from "./providers/workflowEventMapper";
import { presentProvider } from "./core/toolPresentation";
import type { ProviderCapabilityInfo } from "./core/bridgePromptContract";
import { buildBridgePromptPackage } from "./core/promptPackage";
import {
  AssistantTurnViewBuilder,
  buildAgentRunDisplayModel,
  buildCodexRunViewModel,
  type AgentRunDisplayModel,
  type AgentRunDebugView,
  type CodexRunViewModel,
} from "./core/viewModels";
import { getActiveProvider } from "./config/activeProvider";

// Status label lookup (mirrors view.ts STATUS_LABEL)
const STATUS_LABEL: Record<RunStatus, string> = {
  idle: "Idle",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * Host interface implemented by LLMBridgeView. The controller accesses all
 * DOM/UI concerns through this interface — it never touches the DOM directly.
 * No DOM element types or query methods appear here; all UI mutations go
 * through semantic callbacks.
 */
export interface RunSessionHost {
  // --- Plugin / App ---
  readonly plugin: LLMBridgePlugin;
  readonly app: App;

  // --- Composer input (replaces inputEl) ---
  /** Read the current composer input value. */
  getComposerInput(): string;
  /** Clear the composer input (called after a run starts). */
  clearComposerInput(): void;
  /** Clear Tool/Skill selection for this turn (called after a run starts). */
  clearRuntimeCapabilitySelection(): void;

  // --- Runtime install UI (replaces runtimeInstallBtnEl) ---
  /** Disable the install button and show the installing state. */
  setRuntimeInstallUi(state: "installing" | "idle", title?: string): void;
  /** Returns true if the install button is currently interactive (not disabled). */
  isRuntimeInstallActionAvailable(): boolean;

  // --- Assistant watchdog hint (replaces messagesEl.querySelector) ---
  /** Update the assistant watchdog status text in-place (no rebuild). */
  setAssistantWatchdogHint(assistantId: string, text: string): void;

  // --- Data (read) ---
  readonly messages: ChatMessage[];
  readonly messageFileRefs: FileRef[];
  readonly pinnedFileRefs: FileRef[];
  readonly currentAssistantId: string | null;
  readonly lastPreflightResult: PreflightResult | null;
  readonly pendingPermissions: Map<string, PermissionEvent>;
  readonly staleApprovalRequestIds: Set<string>;
  readonly pendingUserInputDrafts: Map<string, unknown>;

  // --- Data (read/write) ---
  sessionState: SessionState;
  currentSessionId: string | null;
  selectedRuntimeCapabilities: unknown[];

  // --- Input / context ---
  getActiveFile(): TFile | null;
  getSelection(): string | null;
  getFileRefPreviewText(ref: FileRef): string | null;
  getPromptFileRefs(refs: ReadonlyArray<FileRef>): FileRef[];
  getPromptAttachmentSnippets(refs: ReadonlyArray<FileRef>): AttachmentTextSnippet[];
  getVaultPath(): string;

  // --- Messages ---
  appendUserMessage(text: string, fileRefs?: FileRef[]): string;
  appendAssistantPlaceholder(): string;
  updateAssistantMessage(id: string, patch: Partial<ChatMessage>): void;

  // --- Status ---
  setGlobalStatus(status: RunStatus): void;
  refreshStatusBar(): void;
  refreshPermissionModeChip(): void;

  // --- Approval / UserInput ---
  refreshPermissionPanel(): void;
  refreshUserInputPanel(): void;
  clearPendingPermissions(): void;
  clearPendingUserInputRequests(): void;
  clearApprovalUiState(): void;

  // --- Streaming helpers ---
  flushStreamDetailsRefresh(): void;
  scheduleStreamDetailsRefresh(id: string): void;
  scheduleAssistantContentPaint(id: string): void;
  patchRunningStatusLine(id: string): void;
  isStructuralTurnChange(prev: AssistantTurnView | undefined, next: AssistantTurnView): boolean;
  appendLiveSdkEvent(ev: WorkflowEvent): void;

  // --- Run flow ---
  showRunFlowStarted(promptLength: number): void;
  showRunFlowTrace(trace: WorkflowTraceEntry[], finalStatus: string): void;

  // --- Composer ---
  autoGrowInput(): void;
  closeMentionPicker(): void;
  clearMessageContext(): void;
  renderComposerRuntimeCapabilityChips(): void;

  // --- Runtime capabilities ---
  buildRuntimeCapabilities(providerId: string, settings: LLMBridgeSettings): ProviderCapabilityInfo;
  buildUserInputWithRuntimeCapabilityHints(text: string): string;
  buildSdkStreamingInput(userPrompt: string, refs: ReadonlyArray<FileRef>): Promise<SdkStreamingInput | undefined>;
  ensureManagedCodexPluginsCached(): void;
  ensureCodexSkillsPreparedCached(vaultPath: string): Promise<{ ok: boolean; reason?: string }>;
  getManagedRuntimeInstallStatusForCurrentMode(): ManagedRuntimeInstallStatus | null;
  refreshManagedRuntimeInstallAction(status: ManagedRuntimeInstallStatus | null): void;

  // --- Misc ---
  commandLine(): string;
  executeAgentFileToolRoute(request: AgentFileToolRouteRequest): Promise<AgentFileToolRouteResult>;
  localizeRunStatus(status: string): string;
  displayApprovalProfile(): AgentApprovalProfile;
  refreshHistory(force?: boolean): void;
  refreshSessionState(): void;
  /** Codex thread/tokenUsage/updated → 上下文占用环（精确 runtime 数据） */
  applyRuntimeTokenUsage(usedTokens: number, contextWindow: number | null): void;
}

/**
 * Controls the run lifecycle: session creation, run/stop, watchdog,
 * normalized event handling, run completion, and runtime install.
 *
 * State owned by this controller:
 * - session / sessionMode / restoredActiveNativeSessionRef
 * - runHandle / finishingRun / beforeFiles / lastRunHadFileChanges
 */
export class RunSessionController {
  private host: RunSessionHost;

  // --- Session state (owned by controller) ---
  private _session: BridgeSessionImpl | null = null;
  private _sessionKey: string | null = null;
  private _restoredActiveNativeSessionRef: NativeSessionRef | undefined = undefined;
  private _runHandle: AgentRunHandle | null = null;
  private _finishingRun = false;
  private _beforeFiles: Map<string, FileSnapshot> = new Map();
  private _lastRunHadFileChanges = false;
  // 运行生命周期状态：idle → preparing → running → finalizing → idle
  // _runHandle 在 finalizing 阶段不清空，直到所有收尾工作完成，避免下一轮覆盖上一轮共享状态
  private _lifecycleState: "idle" | "preparing" | "running" | "finalizing" = "idle";

  constructor(host: RunSessionHost) {
    this.host = host;
  }

  // ===========================================================================
  // Public getters — view.ts accesses session/run state through these
  // ===========================================================================

  get session(): BridgeSessionImpl | null { return this._session; }
  get runHandle(): AgentRunHandle | null { return this._runHandle; }
  get finishingRun(): boolean { return this._finishingRun; }
  get restoredActiveNativeSessionRef(): NativeSessionRef | undefined { return this._restoredActiveNativeSessionRef; }
  get beforeFiles(): Map<string, FileSnapshot> { return this._beforeFiles; }
  get lastRunHadFileChanges(): boolean { return this._lastRunHadFileChanges; }

  // ===========================================================================
  // Public setters for cleanup / restore
  // ===========================================================================

  /** Clear session for doNewSession / restoreSession */
  clearSession(): void {
    this._session = null;
    this._sessionKey = null;
  }

  setRestoredActiveNativeSessionRef(ref: NativeSessionRef | undefined): void {
    this._restoredActiveNativeSessionRef = ref;
  }

  setBeforeFiles(files: Map<string, FileSnapshot>): void {
    this._beforeFiles = files;
  }

  // ===========================================================================
  // Session creation
  // ===========================================================================

  /**
   * 获取/缓存 BridgeSession（按 backendMode + Vault active provider）。
   * 任一变化时重建；重建时回填 restoredActiveNativeSessionRef。
   */
  getSession(): BridgeSessionImpl {
    const mode = this.host.plugin.settings.backendMode;
    const vaultPath = (this.host.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const sessionKey = `${mode}:${mode === "auto" ? getActiveProvider(vaultPath) : "explicit"}`;
    if (this._session && this._sessionKey === sessionKey) {
      this._session.rebuildPermissionBoundary(this.host.plugin.settings);
      return this._session;
    }
    const sess = createBridgeSession(
      `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      this.host.plugin.settings,
      vaultPath,
      this.host.plugin.pluginDir,
    );
    if (this._restoredActiveNativeSessionRef) {
      sess.restoreActiveNativeSessionRef(this._restoredActiveNativeSessionRef);
    }
    this._session = sess;
    this._sessionKey = sessionKey;
    return sess;
  }

  // ===========================================================================
  // Runtime install
  // ===========================================================================

  async installManagedRuntimeFromUi(): Promise<void> {
    if (!this.host.isRuntimeInstallActionAvailable()) return;
    const before = this.host.getManagedRuntimeInstallStatusForCurrentMode();
    if (!before?.required) {
      this.host.refreshStatusBar();
      return;
    }
    this.host.setRuntimeInstallUi("installing", this.formatRuntimeInstallTitle(before));
    const result = await this.host.plugin.ensureManagedRuntimeInstalled({ confirm: true });
    if (result.status === "installed" || result.status === "already-installed") {
      this._session = null;
      this._sessionKey = null;
      this._restoredActiveNativeSessionRef = undefined;
      new Notice("Codex runtime installed");
    } else {
      new Notice(`Codex runtime install failed: ${result.error || result.status}`);
    }
    this.host.refreshStatusBar();
  }

  private formatRuntimeInstallTitle(status: ManagedRuntimeInstallStatus): string {
    const sizeMb = typeof status.size === "number" ? `${(status.size / 1024 / 1024).toFixed(1)} MB` : "unknown";
    return [
      `Runtime version: ${status.version || "unknown"}`,
      `Download size: ${sizeMb}`,
      `Source: ${status.source || "unknown"}`,
      `SHA-256: ${status.sha256 || "unknown"}`,
      `Install path: ${status.installPath || "unknown"}`,
      `Status: ${status.status}`,
      status.error ? `Error: ${status.error}` : "",
    ].filter(Boolean).join("\n");
  }

  // ===========================================================================
  // Run lifecycle
  // ===========================================================================

  async run(): Promise<void> {
    // P0: 生命周期锁——仅在 idle 时允许新一轮，覆盖 preparing/running/finalizing 全程
    if (this._lifecycleState !== "idle") return;
    this._lifecycleState = "preparing";
    const userInput = this.host.getComposerInput().trim();
    // V20: 允许附件-only 消息——有文字或有本轮附件任一成立即可发送
    const hasMessageRefs = this.host.messageFileRefs.length > 0;
    if (!userInput && !hasMessageRefs) {
      new Notice("请输入请求");
      this._lifecycleState = "idle";
      return;
    }

    const settings = this.host.plugin.settings;

    // V20.8: 发送前 readiness 检查（统一走 runtimeRouter 链路）。
    // 缺配置/缺 Key 时不创建 assistant 失败消息，只弹 Notice。
    const vaultPathForGuard = this.host.getVaultPath();
    if (vaultPathForGuard) {
      const { checkRuntimeReadiness } = await import("./config/runtimeRouter");
      const readiness = checkRuntimeReadiness(vaultPathForGuard);
      if (!readiness.ok && readiness.preSendBlock) {
        new Notice(readiness.reason || "Runtime 未就绪，请在设置页检查配置。", 8000);
        // 缺 Key/配置时直接打开设置页，避免用户对着弹窗找不到入口
        try {
          const setting = (this.host.plugin.app as unknown as {
            setting?: { open: () => void; openTabById: (id: string) => void };
          }).setting;
          setting?.open();
          setting?.openTabById(this.host.plugin.manifest.id);
        } catch {
          /* 打开设置失败不阻断 Notice */
        }
        this._lifecycleState = "idle";
        return;
      }
    }

    const activeFile = this.host.getActiveFile();
    const selection = settings.includeSelection ? this.host.getSelection() : null;
    const messageRefsForRun = this.host.messageFileRefs.map((ref) => {
      const previewText = this.host.getFileRefPreviewText(ref);
      return {
        ...ref,
        scope: "message" as const,
        ...(previewText ? { previewText } : {}),
      };
    });

    // P0: 用户消息 + assistant 占位在第一段同步逻辑中立刻写入 UI（目标 <150ms）
    this.host.appendUserMessage(userInput, messageRefsForRun);
    const assistantId = this.host.appendAssistantPlaceholder();
    this.host.clearComposerInput();
    this.host.autoGrowInput();
    this.host.closeMentionPicker();
    this.host.clearMessageContext();
    this.host.clearRuntimeCapabilitySelection();

    if (this.host.sessionState.messageCount === 0) {
      // V20: 附件-only 消息用首个附件名作为会话标题
      const titleSource = userInput || messageRefsForRun[0]?.displayName || "";
      this.host.sessionState = updateSession(this.host.sessionState, {
        title: generateSessionTitle(titleSource),
        startedAt: new Date().toISOString(),
      });
    }
    this.host.sessionState = updateSession(this.host.sessionState, {
      messageCount: this.host.sessionState.messageCount + 1,
    });

    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let cancelled = false;
    let terminalStatus: RunStatus | null = null;
    let terminalResult: RunResult | null = null;
    let sessionRef: BridgeSessionImpl | null = null;
    // stop/watchdog 已落入终态时置位，避免后续 catch 覆盖成 failed
    let settledByStop = false;

    // 占位 runHandle：阻止重入；真正 cancel 在 session 就绪后绑定
    this._runHandle = {
      get running(): boolean { return terminalStatus === null; },
      stop: () => {
        cancelled = true;
        if (sessionRef) sessionRef.cancel(sessionRef.currentRunId ?? "");
        if (!terminalStatus) {
          terminalStatus = "stopped";
          terminalResult = {
            exitCode: null,
            signal: null,
            durationMs: Date.now() - startedAtMs,
            stdout: "",
            stderr: "",
            command: "",
            args: [],
          };
          settledByStop = true;
        }
      },
    };
    this.host.setGlobalStatus("running");

    const timelineEvents: Array<{ type: TimelineEventType; detail: string; timestamp: string }> = [];
    const workflowEvents: WorkflowTraceEvent[] = [];
    const sdkEvents: WorkflowEvent[] = [];
    let sawStdout = false;
    let sawStderr = false;
    let promptLength = 0;
    let vaultPath = "";

    void (async () => {
      const host = this.host;
      let turnBuilder: AssistantTurnViewBuilder | null = null;
      let watchdogTimer: ReturnType<typeof setInterval> | null = null;
      try {
        // 安装探测只读缓存/stat；未 verified 时等待一次校验，失败则阻止启动
        const installStatus = host.getManagedRuntimeInstallStatusForCurrentMode();
        if (installStatus?.required) {
          host.refreshManagedRuntimeInstallAction(installStatus);
          await this.failRunBeforeStart(assistantId, "Codex managed runtime needs to be installed first", startedAt);
          return;
        }
        if (installStatus && (installStatus.integrityStatus === "pending" || installStatus.status === "verifying")) {
          this.setAssistantWatchdogHint(assistantId, "正在验证 runtime…");
          const pluginDir = host.plugin.pluginDir || "";
          const manifestPath = resolveManifestPath(pluginDir);
          const verified = await ensureManagedRuntimeIntegrityVerified(manifestPath);
          if (!verified.ok) {
            await this.failRunBeforeStart(
              assistantId,
              `Codex managed runtime integrity check failed: ${verified.result.error || verified.result.reason}`,
              startedAt,
            );
            return;
          }
          this.setAssistantWatchdogHint(assistantId, "");
        }

        try {
          const result = await exportState(host.app, host.app.vault, activeFile, { selection }, settings);
          vaultPath = result.vaultPath;
        } catch (e) {
          await this.failRunBeforeStart(assistantId, "导出 Obsidian 状态失败：" + (e as Error).message, startedAt);
          return;
        }
        if (cancelled) return;

        // Vault 快照改为与后续准备并行，不挡首帧
        const beforeFilesPromise = snapshotVaultMarkdownFiles(vaultPath);

        const promptFileRefsForRun = host.getPromptFileRefs(messageRefsForRun);
        const promptAttachmentSnippetsForRun = host.getPromptAttachmentSnippets(promptFileRefsForRun);

        const snapshot: StateSnapshot = {
          vaultPath,
          activeFilePath: activeFile?.path || null,
          activeFileContent: null,
          selection,
          fileRefIndex: buildPromptFileRefIndex({ refs: promptFileRefsForRun }),
          attachmentTextSnippets: promptAttachmentSnippetsForRun,
          attachmentPackingPolicy: DEFAULT_ATTACHMENT_PACKING_POLICY,
          timestamp: new Date().toISOString(),
        };

        if (settings.includeActiveNote && activeFile) {
          try {
            snapshot.activeFileContent = await host.app.vault.read(activeFile);
          } catch (e) {
            console.warn("Failed to read active file:", e);
          }
        }

        const session = this.getSession();
        sessionRef = session;

        // P0: plugin 列表 / Skill 物化 — 缓存去重，不每次发送全量 await
        if (session.providerId === "codex-managed-app-server") {
          host.ensureManagedCodexPluginsCached();
          const skillPrep = await host.ensureCodexSkillsPreparedCached(vaultPath);
          if (!skillPrep.ok) {
            new Notice(`Codex Skills 物化失败：${skillPrep.reason || "unknown error"}`);
          }
        }
        if (cancelled) return;

        // vault-context 通过 runtime Skill metadata 渐进披露：provider 先看到 name/description，
        // 命中场景后才读取 SKILL.md 与相关子文件。这里不再每轮重复拼入用户 prompt。
        const promptUserInput = host.buildUserInputWithRuntimeCapabilityHints(userInput);
        const runtimeCapabilities = host.buildRuntimeCapabilities(session.providerId, settings);
        const promptPackage = buildBridgePromptPackage(promptUserInput, snapshot, settings, runtimeCapabilities);
        const sdkStreamingInput = await host.buildSdkStreamingInput(promptPackage.userPrompt, promptFileRefsForRun);
        const prompt = buildPromptPackage(promptUserInput, snapshot, settings);
        promptLength = prompt.length;

        const imageBlockCount = sdkStreamingInput?.content.filter((b) => b.type === "image").length ?? 0;
        const attachmentPlan: AttachmentPlan = {
          messageScopedRefs: messageRefsForRun.length,
          pinnedRefs: host.pinnedFileRefs.length,
          inlineSnippets: promptAttachmentSnippetsForRun.length,
          imageStreamingBlocks: imageBlockCount,
          nativeRefOnly: Math.max(0, promptFileRefsForRun.length - promptAttachmentSnippetsForRun.length - imageBlockCount),
          entries: [],
        };

        const commandPreviewRows = previewToRows(buildCommandPreview(settings, vaultPath, {
          hasSelection: !!selection,
          selectionLength: selection?.length ?? 0,
          hasActiveNote: settings.includeActiveNote && !!activeFile,
          activeFileName: activeFile?.path ?? null,
          promptLength: prompt.length,
          activeNoteContentLength: snapshot.activeFileContent?.length ?? 0,
        }));

        host.showRunFlowStarted(prompt.length);

        const runInput: RunInput = {
          userMessage: userInput,
          cwd: vaultPath,
          includeActiveNote: settings.includeActiveNote,
          includeSelection: settings.includeSelection,
          sdkStreamingInput: sdkStreamingInput ?? undefined,
          promptPackage,
          createdAt: startedAt,
        };
        const effectiveRunPlan = session.provider.buildPlan(runInput, settings);
        host.updateAssistantMessage(assistantId, {
          log: `$ ${host.commandLine()}\ncwd: ${vaultPath}\nprompt 通过 stdin 传入（${prompt.length} 字符）`,
          commandPreview: commandPreviewRows,
          effectiveRunPlan,
          attachmentPlan,
        });
        host.refreshPermissionModeChip();
        host.refreshStatusBar();

        const runtimeFileToolAdapter = createRuntimeFileToolAdapter(
          session.providerId === "claude-sdk" ? "sdk" : "cli",
          (request) => host.executeAgentFileToolRoute(request),
        );
        runInput.runtimeFileToolAdapter = runtimeFileToolAdapter;

        this._beforeFiles = await beforeFilesPromise;

        const activeRef = session.activeNativeSessionRef;
        const canResume = activeRef && activeRef.providerId === session.providerId;
        const runIter = canResume
          ? session.resume(activeRef, runInput, settings)
          : session.start(runInput, settings);
        turnBuilder = new AssistantTurnViewBuilder(assistantId, session.providerId, startedAt);

        this._runHandle = {
          get running(): boolean { return terminalStatus === null; },
          stop(): void {
            cancelled = true;
            session.cancel(session.currentRunId ?? "");
            turnBuilder?.markStopped();
            if (!terminalStatus) {
              terminalStatus = "stopped";
              terminalResult = {
                exitCode: null,
                signal: null,
                durationMs: Date.now() - startedAtMs,
                stdout: "",
                stderr: "",
                command: "",
                args: [],
              };
              settledByStop = true;
            }
          },
        };
        // session 已启动并进入流式阶段
        this._lifecycleState = "running";

        // P1: 流式 watchdog — 12s 提示等待；90s 无事件则取消并落盘失败
        const WATCHDOG_SOFT_MS = 12_000;
        const WATCHDOG_HARD_MS = 90_000;
        let lastEventAt = Date.now();
        let lastEventKind = "none";
        let softWarned = false;
        watchdogTimer = setInterval(() => {
          if (terminalStatus || cancelled) return;
          const idleMs = Date.now() - lastEventAt;
          if (idleMs >= WATCHDOG_HARD_MS) {
            const threadId = session.activeNativeSessionRef?.threadId
              || session.activeNativeSessionRef?.sessionId
              || "";
            const detail = [
              `流式超时：${Math.round(idleMs / 1000)}s 无原生事件`,
              `lastEvent=${lastEventKind}`,
              `provider=${session.providerId}`,
              threadId ? `thread=${threadId}` : "",
              `elapsedMs=${Date.now() - startedAtMs}`,
            ].filter(Boolean).join(" · ");
            console.warn("[llm-cli-bridge] stream watchdog hard timeout", detail);
            cancelled = true;
            session.cancel(session.currentRunId ?? "");
            turnBuilder?.markStopped();
            terminalStatus = "failed";
            terminalResult = {
              exitCode: null,
              signal: null,
              durationMs: Date.now() - startedAtMs,
              stdout: "",
              stderr: detail,
              command: "",
              args: [],
            };
            settledByStop = true;
            this.setAssistantWatchdogHint(assistantId, "连接超时，已取消。可重试发送。");
            return;
          }
          if (idleMs >= WATCHDOG_SOFT_MS && !softWarned) {
            softWarned = true;
            this.setAssistantWatchdogHint(assistantId, "连接仍在等待响应…");
          }
        }, 1000);

        for await (const ev of runIter) {
          if (cancelled || terminalStatus) break;
          lastEventAt = Date.now();
          lastEventKind = ev.payload?.kind || "unknown";
          softWarned = false;
          this.handleNormalizedEvent(ev, {
            assistantId,
            vaultPath,
            startedAt,
            timelineEvents,
            workflowEvents,
            sdkEvents,
            sawStdoutRef: () => sawStdout,
            setSawStdout: (v: boolean) => { sawStdout = v; },
            sawStderrRef: () => sawStderr,
            setSawStderr: (v: boolean) => { sawStderr = v; },
            promptLength,
            turnBuilder: turnBuilder!,
            onTerminal: (status: RunStatus, result: RunResult) => {
              terminalStatus = status;
              terminalResult = result;
            },
          });
        }
      } catch (e) {
        // stop/watchdog 已落入终态时，不覆盖其结果（避免把 stopped/超时 detail 改写成 failed）
        if (!settledByStop) {
          const errMsg = (e as Error)?.message || String(e);
          terminalStatus = "failed";
          terminalResult = {
            exitCode: null,
            signal: null,
            durationMs: Date.now() - startedAtMs,
            stdout: "",
            stderr: errMsg,
            command: "",
            args: [],
          };
        }
      } finally {
        if (watchdogTimer) clearInterval(watchdogTimer);
        // 进入收尾阶段：_runHandle 保留至 onRunFinished 全部完成，防止下一轮覆盖共享状态
        this._lifecycleState = "finalizing";
        if (!terminalStatus) {
          terminalStatus = cancelled ? "stopped" : "failed";
          terminalResult = terminalResult || {
            exitCode: null,
            signal: null,
            durationMs: Date.now() - startedAtMs,
            stdout: "",
            stderr: cancelled ? "" : "Stream ended without terminal event",
            command: "",
            args: [],
          };
        }
        if (terminalStatus && terminalResult && vaultPath) {
          await this.onRunFinished(
            terminalResult, vaultPath, assistantId, terminalStatus,
            startedAt, timelineEvents, workflowEvents, promptLength, sdkEvents,
          );
        } else {
          if (terminalStatus === "failed" || terminalStatus === "stopped") {
            this.host.setGlobalStatus(terminalStatus);
          }
          // onRunFinished 未执行（无 vaultPath 的早期失败）：直接回到 idle 并清空 _runHandle
          this._lifecycleState = "idle";
          this._runHandle = null;
        }
      }
    })();
  }

  /**
   * 处理单个 NormalizedRuntimeEvent。
   * - 事件先 ingest 到 turnBuilder（主 UI 状态源）
   * - final answer 由 turnBuilder.finalAnswer 输出
   * - process/thoughts/tools/fileChanges/approvals 从 turnBuilder 渲染
   * - completed/failed 触发终态
   */
  private handleNormalizedEvent(
    ev: NormalizedRuntimeEvent,
    ctx: {
      assistantId: string;
      vaultPath: string;
      startedAt: string;
      timelineEvents: Array<{ type: TimelineEventType; detail: string; timestamp: string }>;
      workflowEvents: WorkflowTraceEvent[];
      sdkEvents: WorkflowEvent[];
      sawStdoutRef: () => boolean;
      setSawStdout: (v: boolean) => void;
      sawStderrRef: () => boolean;
      setSawStderr: (v: boolean) => void;
      promptLength: number;
      turnBuilder: AssistantTurnViewBuilder;
      onTerminal: (status: RunStatus, result: RunResult) => void;
    },
  ): void {
    const host = this.host;
    const p = ev.payload;

    // latest native session only: native_session_bound → 绑定 activeNativeSessionRef
    if (p.kind === "native_session_bound") {
      const ref = p.ref;
      if (this._session) {
        this._session.restoreActiveNativeSessionRef(ref);
      }
    }

    // 上下文占用：仅更新 ring，不进 timeline / process feed
    if (p.kind === "token_usage") {
      host.applyRuntimeTokenUsage(p.usedTokens, p.contextWindow);
      return;
    }

    // 1. 首次 stdout/stderr 记录到 timeline/workflow log（legacy 兼容）
    if (p.kind === "stdout_delta" && !ctx.sawStdoutRef()) {
      ctx.setSawStdout(true);
      const detail = p.data.replace(/\s+/g, " ").trim().slice(0, 60);
      const ts = new Date().toISOString();
      ctx.timelineEvents.push({ type: "stdout", detail, timestamp: ts });
      ctx.workflowEvents.push({ stage: "stdout", detail, timestamp: ts });
    }
    if (p.kind === "stderr_delta" && !ctx.sawStderrRef()) {
      ctx.setSawStderr(true);
      const detail = p.data.replace(/\s+/g, " ").trim().slice(0, 60);
      const ts = new Date().toISOString();
      ctx.timelineEvents.push({ type: "stderr", detail, timestamp: ts });
      ctx.workflowEvents.push({ stage: "stderr", detail, timestamp: ts });
    }

    // 2. ingest 到 turnBuilder（主 UI 状态源）
    const turnView = ctx.turnBuilder.ingest(ev);

    // 3. 从 turnView 渲染到 ChatMessage
    const msg = host.messages.find((m) => m.id === ctx.assistantId);
    const prevTurn = msg?.assistantTurnView;
    const structuralChanged = host.isStructuralTurnChange(prevTurn, turnView);
    if (msg) {
      msg.content = turnView.finalAnswer;
      msg.assistantTurnView = turnView;
      if (host.plugin.settings.showStderr) {
        msg.stderr = turnView.warnings.filter((w) => w).join("\n");
      }
    }

    const isTerminal = p.kind === "completed" || p.kind === "failed";
    if (isTerminal) {
      host.flushStreamDetailsRefresh();
      host.updateAssistantMessage(ctx.assistantId, {
        content: turnView.finalAnswer,
        stderr: host.plugin.settings.showStderr
          ? turnView.warnings.filter((w) => w).join("\n")
          : undefined,
        assistantTurnView: turnView,
      });
    } else if (structuralChanged) {
      host.scheduleStreamDetailsRefresh(ctx.assistantId);
      host.scheduleAssistantContentPaint(ctx.assistantId);
      host.patchRunningStatusLine(ctx.assistantId);
    } else {
      host.scheduleAssistantContentPaint(ctx.assistantId);
      host.patchRunningStatusLine(ctx.assistantId);
    }

    // 4. approval pending 面板（从 turnView.approvals 驱动）
    let approvalCacheChanged = false;
    for (const ap of turnView.approvals) {
      if (ap.pending) {
        if (!host.pendingPermissions.has(ap.requestId)) {
          host.pendingPermissions.set(ap.requestId, {
            type: "permission",
            timestamp: new Date().toISOString(),
            toolName: ap.toolName,
            description: ap.description,
            granted: false,
            pending: true,
            requestId: ap.requestId,
            riskLevel: ap.riskLevel,
            riskReason: ap.riskReason,
            highRiskFlags: ap.highRiskFlags,
            inputSummary: ap.inputSummary,
            mergeKey: ap.mergeKey,
            parentToolUseId: ap.parentToolUseId,
            subagentRisk: ap.subagentRisk,
          } as PermissionEvent);
          approvalCacheChanged = true;
        }
      } else {
        if (host.pendingPermissions.has(ap.requestId) || host.staleApprovalRequestIds.has(ap.requestId)) {
          host.pendingPermissions.delete(ap.requestId);
          host.staleApprovalRequestIds.delete(ap.requestId);
          approvalCacheChanged = true;
        }
      }
    }
    if (approvalCacheChanged) {
      host.refreshPermissionPanel();
    }

    for (const req of (turnView.userInputRequests ?? [])) {
      if (!req.pending) {
        host.pendingUserInputDrafts.delete(req.requestId);
      }
    }
    if (p.kind === "user_input_request" || p.kind === "user_input_resolved") {
      host.refreshUserInputPanel();
    }

    // 5. completed/failed 触发终态
    if (p.kind === "completed") {
      const result: RunResult = {
        exitCode: 0,
        signal: null,
        durationMs: p.durationMs ?? 0,
        stdout: turnView.finalAnswer || p.text,
        stderr: "",
        command: "",
        args: [],
      };
      ctx.onTerminal("completed", result);
      return;
    }
    if (p.kind === "failed") {
      const result: RunResult = {
        exitCode: 1,
        signal: null,
        durationMs: 0,
        stdout: "",
        stderr: p.message,
        command: "",
        args: [],
      };
      ctx.onTerminal("failed", result);
      return;
    }

    // 6. LEGACY LOG: 把事件映射为 WorkflowEvent 存入 sdkEvents
    const developerMode = !!host.plugin.settings.developerMode;
    const wfEvent = developerMode ? mapNormalizedToWorkflowEvent(ev) : null;
    if (wfEvent) {
      ctx.sdkEvents.push(wfEvent);
      host.appendLiveSdkEvent(wfEvent);
    }
  }

  stop(): void {
    if (this._runHandle) {
      this._runHandle.stop();
      this.host.clearPendingPermissions();
      this.host.clearPendingUserInputRequests();
      const msg = this.host.messages.find((m) => m.id === this.host.currentAssistantId);
      if (msg) {
        this.host.updateAssistantMessage(this.host.currentAssistantId!, {
          log: msg.log + "\n[stop] 已发送 kill 信号",
        });
      }
    }
  }

  private async onRunFinished(
    result: RunResult,
    vaultPath: string,
    assistantId: string,
    status: RunStatus,
    startedAt: string,
    timelineEvents: ReadonlyArray<{ type: TimelineEventType; detail: string; timestamp: string }>,
    workflowEvents: ReadonlyArray<WorkflowTraceEvent>,
    promptLength: number,
    sdkEvents: ReadonlyArray<WorkflowEvent>,
  ): Promise<void> {
    const host = this.host;
    // F-03: 标记收尾中，防止 restore 在 onRunFinished 的 await 期间竞态
    this._finishingRun = true;
    try {
      host.clearApprovalUiState();

      const msg = host.messages.find((m) => m.id === assistantId);
      const newLog = (msg?.log || "") +
        `\nexit code: ${result.exitCode ?? "null"}  signal: ${result.signal ?? "-"}\nduration: ${result.durationMs} ms`;
      let finalStatus = status;
      let finalResult = result;
      const isCodexAssistantTurn = /codex/i.test(msg?.assistantTurnView?.providerId ?? "")
        || /codex/i.test(msg?.effectiveRunPlan?.backend ?? "");
      const completedWithoutVisibleCodexOutput = status === "completed"
        && isCodexAssistantTurn
        && !String(msg?.content ?? "").trim()
        && (!msg?.assistantTurnView || !this.assistantTurnHasVisibleRunContent(msg.assistantTurnView));
      if (completedWithoutVisibleCodexOutput) {
        finalStatus = "failed";
        finalResult = {
          ...result,
          exitCode: 1,
          stderr: "Codex runtime completed without visible output. The app-server ended the turn without an assistant answer, tool step, file change, approval, or user-input request.",
        };
      }
      let debugLogPath = "";
      if (host.plugin.settings.saveLogs) {
        try {
          debugLogPath = await this.saveLogFile(finalResult, vaultPath);
        } catch {
          /* 忽略 */
        }
      }

      let newStderr = host.plugin.settings.showStderr ? (finalResult.stderr || "") : "";
      const errorSummary = finalStatus === "failed" ? buildErrorSummary(finalResult.stderr, finalResult.exitCode) : "";
      if (finalStatus === "failed") {
        if (errorSummary) {
          newStderr = newStderr ? `${newStderr}\n---\n摘要: ${errorSummary}` : `摘要: ${errorSummary}`;
        }
        const logPath = debugLogPath || path.join(vaultPath, ".llm-bridge", "logs");
        newStderr = `${newStderr}\nDebug log: ${logPath}`;
      }

      const finalDetail = finalStatus === "failed"
        ? (errorSummary || `exit ${finalResult.exitCode ?? "null"}`)
        : finalStatus === "stopped"
          ? "stopped by user"
          : `exit ${finalResult.exitCode ?? 0} · ${finalResult.durationMs}ms`;
      const timeline = buildTimeline(startedAt, timelineEvents, finalStatus, finalDetail);

      host.setGlobalStatus(finalStatus);
      host.updateAssistantMessage(assistantId, {
        status: finalStatus,
        stderr: newStderr,
        log: newLog,
        exitCode: finalResult.exitCode,
        durationMs: finalResult.durationMs,
        timeline,
        sdkEvents: sdkEvents.length > 0 ? sdkEvents : undefined,
      });

      await new Promise((r) => setTimeout(r, 300));
      const afterFiles = await snapshotVaultMarkdownFiles(vaultPath);
      const newFiles = diffSnapshots(this._beforeFiles, afterFiles);
      this._lastRunHadFileChanges = newFiles.length > 0;
      if (newFiles.length > 0) {
        host.updateAssistantMessage(assistantId, { generatedFiles: newFiles });
      }

      const preflightOk = host.lastPreflightResult ? host.lastPreflightResult.available : null;
      const workflowFinalDetail = finalDetail;
      const workflowTrace = buildWorkflowTrace(
        startedAt,
        preflightOk,
        promptLength,
        workflowEvents,
        newFiles.length,
        finalStatus,
        workflowFinalDetail,
      );
      host.updateAssistantMessage(assistantId, { workflowTrace });
      host.showRunFlowTrace(workflowTrace, finalStatus);

      // V2.5: 运行结束后保存会话到历史
      try {
        const s = host.plugin.settings;
        const extras: SessionExtras = {
          pinnedContextRefs: host.pinnedFileRefs.map((r) => ({
            id: r.id, kind: r.kind, displayName: r.displayName,
            requestedPath: r.requestedPath, resolvedPath: r.resolvedPath,
            pathKind: r.pathKind, fileType: r.fileType, previewText: r.previewText, source: r.source,
            grantScope: r.grantScope, scope: r.scope, createdAt: r.createdAt, status: r.status,
          })),
          sessionMode: s.sessionMode,
          model: s.model,
          effortLevel: s.effortLevel,
          backendMode: s.backendMode,
          approvalProfile: host.displayApprovalProfile() === "full-access" ? "ask" : host.displayApprovalProfile(),
          permissionMode: host.displayApprovalProfile() === "full-access"
            ? mapAgentApprovalProfileToClaudePermissionMode("ask")
            : s.claudePermissionMode,
          nativeSessionRef: this._session?.activeNativeSessionRef,
        };
        const nativeThreadId = this._session?.activeNativeSessionRef?.threadId;
        const sessionIdToUse = host.currentSessionId || nativeThreadId || undefined;
        const savedId = await saveSession(
          vaultPath,
          host.sessionState,
          host.messages,
          s.agentType,
          sessionIdToUse,
          extras,
        );
        if (savedId) {
          host.currentSessionId = savedId;
          if (s.keepLastSession) {
            s.lastActiveSessionId = savedId;
            await host.plugin.saveSettings();
          }
          void host.refreshHistory(true);
        }
      } catch {
        // 保存失败不阻断主流程
      }

      // VC-2/VC-3/VC-4: 旧的 Vault Context 后台自动维护链路已移除（原 autoMaintainVaultContext
      // 是 no-op，却挂着 UI 记录/冲突/撤销的假后台）。Vault Context 的去重/备份/日志/INDEX
      // 更新改由隐式触发的 vault-context Skill 在合适时调用结构化工具完成。
    } finally {
      this._finishingRun = false;
      // 所有收尾工作完成（文件扫描、历史保存等）后才回到 idle 并清空 _runHandle，
      // 确保下一轮 run() 不会在收尾期间覆盖上一轮共享状态
      this._lifecycleState = "idle";
      this._runHandle = null;
    }
  }

  // ===========================================================================
  // Log file
  // ===========================================================================

  private async saveLogFile(result: RunResult, vaultPath: string): Promise<string> {
    const logsDir = path.join(vaultPath, ".llm-bridge", "logs");
    await fs.promises.mkdir(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const agent = this.host.plugin.settings.agentType;
    const file = path.join(logsDir, `${ts}-${agent}.log`);
    const content =
      `# LLM CLI Bridge log\n` +
      `command: ${result.command} ${result.args.join(" ")}\n` +
      `cwd: ${vaultPath}\n` +
      `exit code: ${result.exitCode ?? "null"}\n` +
      `signal: ${result.signal ?? "-"}\n` +
      `duration ms: ${result.durationMs}\n` +
      `timestamp: ${new Date().toISOString()}\n` +
      `\n---- stdout ----\n${result.stdout}\n` +
      `\n---- stderr ----\n${result.stderr}\n`;
    await fs.promises.writeFile(file, content, "utf8");
    return file;
  }

  // ===========================================================================
  // Watchdog / pre-start helpers
  // ===========================================================================

  private setAssistantWatchdogHint(assistantId: string, text: string): void {
    this.host.setAssistantWatchdogHint(assistantId, text);
  }

  private async failRunBeforeStart(
    assistantId: string,
    message: string,
    startedAt: string,
  ): Promise<void> {
    this._runHandle = null;
    this.host.updateAssistantMessage(assistantId, {
      content: message,
      status: "failed",
      stderr: message,
    });
    this.host.setGlobalStatus("failed");
    new Notice(message);
    void startedAt;
  }

  // ===========================================================================
  // View-model builders — encapsulated here so view.ts doesn't import them
  // ===========================================================================

  /**
   * 判断 AssistantTurnView 是否包含可见的 run 内容（finalAnswer/feed/changes/approvals）。
   */
  assistantTurnHasVisibleRunContent(turnView: AssistantTurnView): boolean {
    const model = buildAgentRunDisplayModel(turnView, {
      isRunning: false,
      statusLabel: "Completed",
      developerMode: false,
    });
    const codexRun = buildCodexRunViewModel(model, turnView, {
      status: "completed",
      developerMode: false,
      providerLabel: turnView.providerId,
    });
    return codexRun.finalAnswer.trim().length > 0
      || codexRun.feedItems.length > 0
      || codexRun.changeGroups.length > 0
      || codexRun.approvalGates.length > 0;
  }

  /**
   * 从 ChatMessage 构建 { run: CodexRunViewModel, model: AgentRunDisplayModel }。
   * 供 view.ts 的 patchCodexFinalAnswerSurface / patchCodexRunViewInPlace 复用。
   */
  buildCodexRunForMessage(msg: ChatMessage): { run: CodexRunViewModel; model: AgentRunDisplayModel } | null {
    if (!msg.assistantTurnView) return null;
    const turnView = msg.assistantTurnView;
    const developerMode = !!this.host.plugin.settings.developerMode;
    const model = buildAgentRunDisplayModel(turnView, {
      isRunning: msg.status === "running",
      statusLabel: STATUS_LABEL[msg.status],
      developerMode,
    });
    const rawProviderLabel = msg.effectiveRunPlan?.backend ?? turnView.providerId;
    const providerLabel = developerMode ? rawProviderLabel : presentProvider(rawProviderLabel).userLabel;
    const run = buildCodexRunViewModel(model, turnView, {
      status: msg.status,
      developerMode,
      providerLabel,
      modelLabel: msg.effectiveRunPlan?.model ?? "",
      cwd: msg.effectiveRunPlan?.cwd ?? this.host.getVaultPath(),
    });
    return { run, model };
  }

  /**
   * 从 AssistantTurnView 构建 display models（AgentRunDisplayModel + 可选 CodexRunViewModel）。
   * 供 view.ts 的 renderAgentRunDisplayModel 调用，避免 view.ts 直接导入 builder。
   */
  buildDisplayModels(
    turnView: AssistantTurnView,
    status: RunStatus,
    options: { developerMode: boolean; debug?: AgentRunDebugView },
  ): {
    model: AgentRunDisplayModel;
    codexRun: CodexRunViewModel | null;
    providerLabel: string;
    shouldUseCodexRunView: boolean;
  } {
    const model = buildAgentRunDisplayModel(turnView, {
      isRunning: status === "running",
      statusLabel: STATUS_LABEL[status],
      developerMode: options.developerMode,
      debug: options.debug,
    });
    const rawProviderLabel = options.debug?.effectiveRunPlan?.backend ?? turnView.providerId;
    const modelLabel = options.debug?.effectiveRunPlan?.model ?? "";
    const providerLabel = options.developerMode ? rawProviderLabel : presentProvider(rawProviderLabel).userLabel;
    const shouldUseCodexRunView = /codex/i.test(turnView.providerId)
      || /codex/i.test(rawProviderLabel)
      || turnView.turnTimeline.length > 0;
    let codexRun: CodexRunViewModel | null = null;
    if (shouldUseCodexRunView) {
      codexRun = buildCodexRunViewModel(model, turnView, {
        status,
        developerMode: options.developerMode,
        providerLabel,
        modelLabel,
        cwd: options.debug?.effectiveRunPlan?.cwd ?? this.host.getVaultPath(),
      });
    }
    return { model, codexRun, providerLabel, shouldUseCodexRunView };
  }
}
