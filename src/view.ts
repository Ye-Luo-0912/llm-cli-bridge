// LLM CLI Bridge — 右侧 Chat View（Codex / Claude Code 风格紧凑工作台）

import { App, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, normalizePath, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type LLMBridgePlugin from "../main";
import { buildPrompt } from "./prompt";
import { buildPromptPackage, StateSnapshot } from "./promptPackage";
import { AgentRunHandle, SdkImageContentBlock, SdkStreamingInput } from "./agentBackend";
import { exportState } from "./state";
import { diffSnapshots, extractRelPath, FileSnapshot, snapshotVaultMarkdownFiles } from "./fileDiff";
import { AgentType, AttachmentPlan, BackendMode, ChatMessage, EffectiveRunPlan, RunResult, RunStatus, SessionMode } from "./types";
import type { LLMBridgeSettings } from "./types";
import type { PendingActionEntry } from "./httpServer";
import { runPreflight, PreflightResult } from "./agentProfile";
import { mapPreflightToStatus, buildErrorSummary } from "./preflightStatus";
import { buildFirstUseGuide, shouldShowFirstUseGuide } from "./firstUseGuide";
import { buildTimeline, isTerminalTimelineType, timelineTypeClass, timelineTypeLabel, TimelineEventType } from "./runTimeline";
import { buildCommandLine, buildCommandPreview, buildRedactedCommandDisplay, previewToRows, CommandPreview } from "./commandProfile";
import { buildWorkflowTrace, workflowStageLabel, workflowStageClass, isTerminalWorkflowStage, WorkflowTraceStage, WorkflowTraceEvent } from "./workflowTrace";
import { formatEffectiveRunPlan } from "./effectiveRunPlan";
import { createBridgeSession, type BridgeSessionImpl } from "./runtime/core/bridgeSession";
import type { BridgeSession, RunInput, NormalizedRuntimeEvent, ApprovalResponse, UserInputQuestion, UserInputResponse, UserInputRequestSegment, AssistantTurnView, TurnTimelineNode } from "./runtime/core/types";
import { buildAgentRunDisplayModel, getToolIconCategory, getPhaseIconName, explainAutoApprovalSource, approvalDisplayLabel, type AgentRunDisplayModel, type AgentRunCard, type AgentRunDebugView } from "./runtime/core/agentRunDisplayModel";
import { buildCodexRunViewModel, formatCodexRunValue, type CodexRunApprovalGate, type CodexRunChangeGroup, type CodexRunDiagnosticsGroup, type CodexRunFeedItem, type CodexRunStepGroup, type CodexRunViewModel } from "./runtime/core/codexRunViewModel";
import type { RunPhase, RunPhaseModel } from "./runtime/core/runPhaseModel";
import { buildBridgePromptPackage } from "./runtime/core/promptPackage";
import { DEFAULT_PROVIDER_CAPABILITIES, type ProviderCapabilityInfo, type ObsidianCliAvailability, type ProviderRuntimeSkillEntry } from "./runtime/core/bridgePromptContract";
import type { ManagedRuntimeInstallStatus } from "./runtime/providers/codex-managed-app-server/codexManagedRuntimeInstallerBridge";
import { listManagedCodexPlugins, type CodexManagedPluginCatalog, type CodexManagedPluginEntry } from "./runtime/providers/codex-managed-app-server/codexManagedPluginCatalog";
import { AssistantTurnViewBuilder } from "./runtime/core/assistantTurnView";
import { mapNormalizedToWorkflowEvent } from "./runtime/providers/workflowEventMapper";
import { getRuntimeModelCatalogForAgent, normalizeModelValue, normalizeEffortValue, findModelEntry, findEffortEntry, type RuntimeModelCatalog } from "./runtimeModelCatalog";
import { WorkflowEvent, PermissionEvent, buildToolTimeline, workflowEventLabel, workflowEventIcon, workflowEventClass, truncateText, extractFileChanges } from "./workflowEvent";
import { computeTimelineStats, formatCompletedSummary, formatFailedSummary, extractToolPath, extractToolParams, pathBasename, countLines, truncatePath, isInternalFilePath, type TimelineNode, type TimelineNodeKind } from "./timelineAdapter";
import { RunStateAggregator, aggregateEventsToTimeline } from "./runtimeTranscript";
import { computeContextMetrics, formatTokens, formatCompressionRatio, type ContextMetrics, type CompressionInfo } from "./contextMetrics";
import { SessionState, createNewSession, generateSessionTitle, sessionStatusLabel, sessionStatusClass, updateSession } from "./session";
import { PersistedSession, SessionListItem, SessionExtras, saveSession, listSessions, loadSession, deleteSession, renameSession } from "./sessions";
import {
  AgentSkillRecord,
  loadAgentSkillsManifest,
  loadAgentSkillsManifestSync,
  prepareAgentSkillsForCodexRuntimeSync,
  saveAgentSkillsManifest,
} from "./agentSkills";
import { getPermissionModeInfo, normalizeToolName, type PermissionChoice } from "./sdkPermission";
import {
  approvePendingExternalReadRequest,
  createFileAccessPolicy,
  createPendingExternalReadRequest,
  createSessionReadGrantStore,
  enqueuePendingExternalReadRequest,
  FileAccessPathKind,
  FileAccessReadGrant,
  PendingExternalReadRequest,
  SessionReadGrantStore,
  FileAccessOperation,
} from "./fileAccessPolicy";
import {
  createAttachmentFileRef,
  createExternalFileRefFromApprovedRequest,
  createVaultFileRef,
  classifyFileTypeByPath,
  buildPromptFileRefIndex,
  FileRef,
} from "./fileRefs";
import { AttachmentTextSnippet, ingestAttachmentTextSnippet, isBoundedTextAttachmentType } from "./fileIngestion";
import { DEFAULT_ATTACHMENT_PACKING_POLICY } from "./attachmentPackingPolicy";
import { FileToolExecutionRequest, FileToolResult, executeFileTool } from "./fileToolExecutor";
import { AgentFileToolRouteRequest, AgentFileToolRouteResult, executeAgentFileToolRoute as routeAgentFileTool } from "./agentFileToolBridge";
import { createRuntimeFileToolAdapter } from "./runtimeFileToolAdapter";
import {
  CLIPBOARD_TEXT_ATTACHMENT_MIN_CHARS,
  CLIPBOARD_TEXT_ATTACHMENT_MIN_LINES,
  defaultClipboardTextAttachmentFileName as chooseClipboardTextAttachmentFileName,
  isClipboardTextBlobDescriptor,
  shouldPersistLargeClipboardText as shouldPersistClipboardTextAttachment,
} from "./clipboardPastePolicy";

export const VIEW_TYPE_LLM_BRIDGE = "llm-cli-bridge-view";
export const VIEW_TYPE_AGENT_SKILL_DOCUMENT = "llm-cli-bridge-agent-skill-document";

interface AgentSkillDocumentState {
  skillPath?: string;
  displayPath?: string;
  title?: string;
}

interface UserInputDraft {
  value: string;
  supplement: string;
  selections: Record<string, string | string[]>;
  customInputs: Record<string, string>;
  optionPages: Record<string, number>;
  stepIndex: number;
}

const USER_INPUT_OPTIONS_PER_PAGE = 6;
export class AgentSkillDocumentView extends ItemView {
  private state: AgentSkillDocumentState = {};

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = true;
    this.icon = "sparkles";
  }

  getViewType(): string {
    return VIEW_TYPE_AGENT_SKILL_DOCUMENT;
  }

  getDisplayText(): string {
    return this.state.title ? `Skill: ${this.state.title}` : "Agent Skill";
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    await super.setState(state, result);
    const next = (state && typeof state === "object" ? state : {}) as AgentSkillDocumentState;
    this.state = {
      skillPath: typeof next.skillPath === "string" ? next.skillPath : "",
      displayPath: typeof next.displayPath === "string" ? next.displayPath : "",
      title: typeof next.title === "string" ? next.title : "Agent Skill",
    };
    await this.renderSkillDocument();
  }

  protected async onOpen(): Promise<void> {
    await this.renderSkillDocument();
  }

  private async renderSkillDocument(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("llm-bridge-agent-skill-doc");
    const skillPath = this.state.skillPath || "";
    const displayPath = this.state.displayPath || skillPath;
    const header = root.createDiv({ cls: "llm-bridge-agent-skill-doc-head" });
    header.createEl("span", { cls: "llm-bridge-agent-skill-doc-kicker", text: "Agent Skill" });
    header.createEl("h2", { text: this.state.title || path.basename(path.dirname(displayPath)) || "Agent Skill" });
    header.createEl("div", {
      cls: "llm-bridge-agent-skill-doc-path",
      text: displayPath || "No SKILL.md path",
      attr: { title: displayPath || "" },
    });

    const body = root.createDiv({ cls: "llm-bridge-agent-skill-doc-body" });
    if (!skillPath) {
      body.createDiv({ cls: "llm-bridge-list-error", text: "缺少 SKILL.md 路径" });
      return;
    }
    try {
      const markdown = await this.readSkillMarkdown(skillPath);
      await MarkdownRenderer.render(this.app, markdown, body, skillPath.replace(/\\/g, "/"), this);
    } catch (error) {
      const err = body.createDiv({ cls: "llm-bridge-list-error" });
      err.createEl("span", { text: "无法读取 Agent Skill 文档" });
      err.createEl("span", {
        cls: "llm-bridge-agent-skill-doc-error-path",
        text: displayPath || skillPath,
        attr: { title: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async readSkillMarkdown(skillPath: string): Promise<string> {
    const normalized = skillPath.replace(/\\/g, "/");
    if (!path.isAbsolute(skillPath)) {
      return this.app.vault.adapter.read(normalized);
    }
    return fs.promises.readFile(skillPath, "utf8");
  }
}

// V0.9: FileSnapshot / snapshotVaultMarkdownFiles / diffSnapshots 已抽取到 fileDiff.ts

interface ExternalFileAccessRequestOptions {
  source?: string;
  pathKind?: FileAccessPathKind;
  knownProjectRootMarkers?: string[];
}

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: "Idle",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const AGENT_OPTIONS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
  { value: "custom", label: "Custom" },
];

const MODE_OPTIONS = [
  { value: "fresh", label: "Fresh" },
  { value: "continue", label: "Continue", disabled: true },
  { value: "resume", label: "Resume", disabled: true },
];

let msgIdSeq = 0;
function nextMsgId(): string {
  msgIdSeq += 1;
  return `m${Date.now()}_${msgIdSeq}`;
}

type ComposerRuntimeCapabilitySelection = {
  readonly kind: "plugin" | "skill";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly visualKey: string;
};

export class LLMBridgeView extends ItemView {
  private plugin: LLMBridgePlugin;
  // V2.17-A Completion: BridgeSession 替代 cachedBackend。
  // UI 不再直接持有 SdkBackend/ClaudeCliBackend/MockAgentBackend，只通过 BridgeSession
  // 与 RuntimeProvider 交互。session 按 settings.backendMode 缓存，mode 变化时重建。
  private session: BridgeSessionImpl | null = null;
  private sessionMode: BackendMode | null = null;
  /**
   * V2.17-A Completion: provider session persistence
   *
   * 从持久化 session 文件恢复出来的 providerThreadId/providerSessionId。
   * getSession() 重建 BridgeSession 时调用 restoreProviderSession(...) 回填到 provider sessionMapper，
   * 使下一次 resume() 命中 thread/resume 路径而不是隐式新开 thread。
   * 新会话 / doNewSession 时清空。
   */
  private restoredProviderThreadId: string | undefined = undefined;
  private restoredProviderSessionId: string | undefined = undefined;
  /** P3: 当前会话是否为恢复的历史会话（true=恢复，false=fresh）。用于 UI 标注"恢复的会话"。 */
  private sessionResumed: boolean = false;
  /** V2.16-B: 实际 runtime 标签（供 UI 显示，区分 auto→SDK / auto→CLI fallback） */
  private actualRuntimeLabel: string = "Claude Code";
  private runHandle: AgentRunHandle | null = null;
  private messages: ChatMessage[] = [];
  private currentAssistantId: string | null = null;
  /**
   * V2.17-A: 实时运行状态聚合器（替代 liveTimelineEvents 数组）
   * - 单 thinking block / tool_progress 合并 / 无重复 final message
   * - 历史消息渲染用 aggregateEventsToTimeline(events) 一次性构建
   */
  private liveAggregator: RunStateAggregator = new RunStateAggregator();
  private beforeFiles: Map<string, FileSnapshot> = new Map();
  private pendingActions: PendingActionEntry[] = [];

  // V1.1: preflight 结果缓存
  private lastPreflightResult: PreflightResult | null = null;
  // V1.2: 首次使用提示 DOM
  private guideEl: HTMLElement | null = null;

  // V2.0: 会话状态（UI-only，不持久化）
  private sessionState: SessionState = createNewSession();
  // V2.0: 运行流程区（最新一次运行的 workflow trace）
  private runFlowEl: HTMLElement | null = null;
  private runFlowBody: HTMLElement | null = null;
  private runFlowToggle: HTMLElement | null = null;
  // V2.0: 会话标题展示
  private sessionTitleEl!: HTMLElement;
  // V2.13.0-F / V17-G71: Agent Skills 是 runtime capability；composer 只显示轻量选择 chip。
  private agentSkills: AgentSkillRecord[] = [];
  private agentSkillsToggleEl!: HTMLElement;
  private agentSkillsToggleChevronEl!: HTMLElement;
  private agentSkillsToggleCountEl!: HTMLElement;
  private agentSkillsBodyEl!: HTMLElement;
  private agentSkillsListEl!: HTMLElement;
  private managedCodexPlugins: ReadonlyArray<CodexManagedPluginEntry> = [];
  private managedCodexPluginCatalog: CodexManagedPluginCatalog | null = null;
  private managedCodexPluginsListEl!: HTMLElement;
  private selectedRuntimeCapabilities: ComposerRuntimeCapabilitySelection[] = [];
  private composerRuntimeCapabilitiesEl!: HTMLElement;
  // V2.9: scrollToBottom rAF 批处理定时器（合并同帧多次调用，避免每个 delta 触发 reflow）
  private scrollRafId: number | null = null;
  private streamContentRafId: number | null = null;
  private streamContentAssistantId: string | null = null;
  private liveTimelineTimerId: number | null = null;
  // V2.5: 历史会话列表
  private historyListEl!: HTMLElement;
  private historyToggleEl!: HTMLElement;
  private historyToggleChevronEl!: HTMLElement;
  private historyToggleLabelEl!: HTMLElement;
  private historyToggleCountEl!: HTMLElement;
  private historyItems: SessionListItem[] = [];
  private historySortMode: "time" | "messages" = "time"; // V2.8: 历史会话排序模式
  // V2.9: 历史会话搜索 + 列表缓存（避免频繁展开/收起重复全量读盘）
  private historyBodyEl!: HTMLElement;
  private historySearchEl!: HTMLInputElement;
  private historySearchQuery = "";
  private historySearchDebounceTimer: number | null = null;
  private historyLastLoadAt = 0;
  // V2.5: 当前活动会话 id（保存后赋值；用于后续运行更新同一会话文件）
  private currentSessionId: string | null = null;

  // DOM
  private statusDotEl!: HTMLElement;
  private statusLabelEl!: HTMLElement;
  private runtimeInstallBtnEl!: HTMLButtonElement;
  private activeFileLabelEl!: HTMLElement;
  private selectionLabelEl!: HTMLElement;
  private agentChipGroup!: HTMLElement;
  private agentChipTextEl!: HTMLElement;
  private modelChipGroup!: HTMLElement;
  private effortChipGroup!: HTMLElement;
  private modelEffortPickerEl!: HTMLElement;
  private modelEffortButtonEl!: HTMLButtonElement;
  private effortChipEl!: HTMLButtonElement;
  private modelEffortPopoverEl!: HTMLElement;
  private modelOptionsEl!: HTMLElement;
  private effortOptionsEl!: HTMLElement;
  /** V2.16-C: 运行时模型目录（不再硬编码） */
  private modelCatalog: RuntimeModelCatalog = getRuntimeModelCatalogForAgent("claude");
  private permissionModePickerEl!: HTMLElement;
  private permissionModeChipEl!: HTMLButtonElement;
  /** V2.16-C: permission mode popover 容器 */
  private permissionPopoverEl!: HTMLDivElement;
  private includeNoteCheckEl!: HTMLInputElement;
  private includeSelectionCheckEl!: HTMLInputElement;
  private messagesEl!: HTMLElement;
  // V2.15-A: Chat shell 页面分区。Files 只展示 refs/approval 状态，不执行文件 runtime。
  private tabPanels!: { chat: HTMLElement; files: HTMLElement; skills: HTMLElement; history: HTMLElement };
  private activeTab: "chat" | "files" | "skills" | "history" = "chat";
  private pageTitleEl!: HTMLElement;
  // V2.7: 长会话旧消息折叠（false=折叠显示最近 N 条；true=展开全部）
  private messagesFoldExpanded = false;
  private inputEl!: HTMLTextAreaElement;
  private composerBarEl!: HTMLElement;
  // V2.15-H: @ 提及文件选择器（输入框上方 inline popup）
  private mentionPickerEl: HTMLElement | null = null;
  private mentionPickerRange: { start: number; end: number } | null = null;
  private mentionPickerActiveIndex = -1;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;
  private pendingActionsEl!: HTMLElement;
  private pendingActionsCountEl!: HTMLElement;
  private pendingActionsBody!: HTMLElement;
  // V1.1: 状态栏 + preflight + 常用操作 DOM
  private statusBarEl!: HTMLElement;
  private statusBackendEl!: HTMLElement;
  private statusAgentEl!: HTMLElement;
  private statusCwdEl!: HTMLElement;
  private statusPreflightEl!: HTMLElement;
  private preflightBtn!: HTMLButtonElement;
  // V2.3: 状态栏新增字段（权限策略 / 工具步骤 / agent 计数）
  private statusPermissionEl!: HTMLElement;
  private statusToolsEl!: HTMLElement;
  private statusAgentsEl!: HTMLElement;
  // V2.3s: 权限模式状态栏字段（SDK permissionMode + 中文风险）
  private statusPermModeEl!: HTMLElement;
  // V2.3s: 待决策权限请求面板（运行中实时展示 pending 权限请求，用户点击允许/拒绝）
  private permissionPanelEl!: HTMLElement;
  private userInputPanelEl!: HTMLElement;
  private pendingPermissions: Map<string, PermissionEvent> = new Map();
  /**
   * V16.5-B: Approval UI 主数据源切换为 PermissionBoundary.pending。
   * pendingPermissions 降级为兼容显示缓存（保留 description/inputSummary 等 UI 字段，
   * ApprovalRequest 不携带这些字段，需从 provider event 同步补充）。
   */
  private pendingUserInputDrafts = new Map<string, UserInputDraft>();
  /**
   * V16.5-B: 正在 resolve 中的 requestId（点击按钮后立即设置，resolve 完成后清除）。
   * 用于按钮 is-resolving 视觉状态（禁用 + 显示 Approving/Skipping/Declining）。
   */
  private resolvingApprovalRequestId: string | null = null;
  /**
   * V16.5-B: resolveApproval 返回 false 时加入此集合，UI 显示 stale card。
   * 用户点击 Dismiss 后从集合移除（不重新触发 resolve）。
   */
  private staleApprovalRequestIds: Set<string> = new Set();
  // V2.14.0-E: 外部 read 授权仅存在于当前 Bridge View/session 生命周期
  private externalReadGrantStore: SessionReadGrantStore = createSessionReadGrantStore();
  private externalReadPanelEl!: HTMLElement;
  // V2.16-E: 普通附件只属于本轮消息；只有 pinned context 跨轮保留。
  private messageFileRefs: FileRef[] = [];
  private pinnedFileRefs: FileRef[] = [];
  private sessionFileRefs: FileRef[] = [];
  private attachmentReadGrants: FileAccessReadGrant[] = [];
  private attachmentTextSnippets: AttachmentTextSnippet[] = [];
  private fileThumbnailCache = new Map<string, string | null>();
  private smartImageThumbnailCache = new Map<string, string | null>();
  private fileInlinePreviewCache = new Map<string, string | null>();
  private attachmentFileInputEl!: HTMLInputElement;
  private pinnedContextEl!: HTMLElement;
  private composerFileRefsEl!: HTMLElement;
  private filesContextEl!: HTMLElement;
  private filePreviewLeaf: WorkspaceLeaf | null = null;
  private filePreviewModal: Modal | null = null;
  private lastActiveMarkdownFile: TFile | null = null;
  // V2.16-D: Context metrics UI 元素
  private contextRingEl!: HTMLElement;
  private contextLabelEl!: HTMLElement;
  private contextDetailEl!: HTMLElement;
  private composerStatusRailEl!: HTMLElement;
  private composerStatusTextEl!: HTMLElement;
  private composerStepPillEl!: HTMLElement;
  private lastContextMetrics: ContextMetrics | null = null;
  // V16.3: active note 三态 — "full"（路径+内容）/ "path-only"（仅路径，内容读取失败）/ "off"（未注入）
  private activeNoteAttachState: "full" | "path-only" | "off" = "off";
  // V2.3: 最近一次 SDK 运行的工具数与 agent 数（用于状态栏展示）
  private lastSdkToolCount = 0;
  private lastSdkAgentCount = 0;

  constructor(leaf: WorkspaceLeaf, plugin: LLMBridgePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LLM_BRIDGE;
  }
  getDisplayText(): string {
    return "LLM CLI Bridge";
  }
  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("llm-bridge-view");

    const shell = root.createDiv({ cls: "llm-bridge-shell" });
    const nav = shell.createDiv({ cls: "llm-bridge-nav-rail" });

    const main = shell.createDiv({ cls: "llm-bridge-main" });

    // ===== 顶部栏：会话 / 新聊天 / 设置 / compact runtime status =====
    const header = main.createDiv({ cls: "llm-bridge-header llm-bridge-topbar" });
    const topbarBrand = header.createDiv({ cls: "llm-bridge-topbar-brand" });
    const topbarLogo = topbarBrand.createEl("span", { cls: "llm-bridge-topbar-logo" });
    setIcon(topbarLogo, "message-square");
    topbarBrand.createEl("span", { cls: "llm-bridge-topbar-title", text: "Bridge" });
    this.pageTitleEl = topbarBrand.createEl("span", { cls: "llm-bridge-page-title", text: "Chat" });
    const sessionPreview = header.createEl("button", {
      cls: "llm-bridge-session-selector",
      attr: { title: "打开最近会话下拉；完整历史在 History 页面" },
    });
    const sessionIcon = sessionPreview.createEl("span", { cls: "llm-bridge-session-icon" });
    setIcon(sessionIcon, "history");
    sessionPreview.createEl("span", { cls: "llm-bridge-session-kicker", text: "Session" });
    this.sessionTitleEl = sessionPreview.createEl("span", { cls: "llm-bridge-sb-session-title", text: this.sessionState.title });
    const sessionCaret = sessionPreview.createEl("span", { cls: "llm-bridge-session-caret" });
    setIcon(sessionCaret, "chevron-down");
    const sessionDropdown = header.createDiv({ cls: "llm-bridge-session-dropdown" });
    sessionDropdown.setAttribute("hidden", "");

    const headerRight = header.createDiv({ cls: "llm-bridge-header-right" });
    this.clearBtn = headerRight.createEl("button", {
      cls: "llm-bridge-new-chat-btn",
      attr: { title: "新建会话（清空消息）" },
    });
    setIcon(this.clearBtn.createEl("span", { cls: "llm-bridge-icon" }), "plus");
    this.clearBtn.createEl("span", { cls: "llm-bridge-new-chat-label", text: "新聊天" });
    this.clearBtn.addEventListener("click", () => this.newSession());
    const settingsBtn = headerRight.createEl("button", { cls: "llm-bridge-icon-btn llm-bridge-settings-btn", attr: { title: "打开插件设置" } });
    setIcon(settingsBtn.createEl("span", { cls: "llm-bridge-icon" }), "settings");
    settingsBtn.addEventListener("click", () => this.openPluginSettings());
    const runtimeStatus = headerRight.createDiv({ cls: "llm-bridge-runtime-status", attr: { title: "Runtime status" } });
    this.statusDotEl = runtimeStatus.createEl("span", {
      cls: "llm-bridge-status-dot llm-bridge-status-dot-idle",
      attr: { title: STATUS_LABEL.idle },
    });
    this.statusLabelEl = runtimeStatus.createEl("span", {
      cls: "llm-bridge-status-text",
      text: "SDK · ready",
    });
    this.runtimeInstallBtnEl = headerRight.createEl("button", {
      cls: "llm-bridge-runtime-install-btn",
      text: "Install Codex runtime",
      attr: { type: "button", title: "Install the pinned Codex managed runtime" },
    });
    this.runtimeInstallBtnEl.setAttribute("hidden", "");
    this.runtimeInstallBtnEl.addEventListener("click", () => void this.installManagedRuntimeFromUi());

    // agent selector 迁入 composer 右侧；header 只保留 compact runtime status。
    const agentSelect = document.createElement("select");
    agentSelect.className = "llm-bridge-agent-select";
    for (const a of AGENT_OPTIONS) {
      agentSelect.createEl("option", { value: a.value, text: a.label });
    }
    agentSelect.addEventListener("change", async () => {
      if (this.runHandle) return;
      this.plugin.settings.agentType = agentSelect.value as AgentType;
      this.syncModelCatalogForCurrentAgent(true);
      await this.plugin.saveSettings();
      this.lastPreflightResult = null; // V2.4: 切换 agent 后失效 preflight 缓存
      this.refreshModeOptions();
      this.refreshAllChips();
    });
    this.agentChipGroup = agentSelect;

    // ===== V2.15-A: 左侧 slim navigation rail（无 Settings 入口） =====
    const chatTab = nav.createEl("button", { cls: "llm-bridge-nav-item is-active", attr: { "data-tab": "chat", title: "Chat", "aria-label": "Chat" } });
    setIcon(chatTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "message-square");
    const filesTab = nav.createEl("button", { cls: "llm-bridge-nav-item", attr: { "data-tab": "files", title: "Files", "aria-label": "Files" } });
    setIcon(filesTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "files");
    const skillsTab = nav.createEl("button", { cls: "llm-bridge-nav-item", attr: { "data-tab": "skills", title: "Capabilities", "aria-label": "Capabilities" } });
    setIcon(skillsTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "sparkles");
    const historyTab = nav.createEl("button", { cls: "llm-bridge-nav-item", attr: { "data-tab": "history", title: "History", "aria-label": "History" } });
    setIcon(historyTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "history");

    const pageStack = main.createDiv({ cls: "llm-bridge-page-stack" });
    const chatPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-chat-page is-active", attr: { "data-panel": "chat" } });
    const filesPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-files-page", attr: { "data-panel": "files" } });
    const skillsPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-skills-page", attr: { "data-panel": "skills" } });
    const historyPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-history-page", attr: { "data-panel": "history" } });
    this.tabPanels = { chat: chatPanel, files: filesPanel, skills: skillsPanel, history: historyPanel };
    const switchTab = (tab: "chat" | "files" | "skills" | "history") => {
      this.closeModelEffortPopover();
      for (const t of [chatTab, filesTab, skillsTab, historyTab]) t.classList.remove("is-active");
      for (const p of [chatPanel, filesPanel, skillsPanel, historyPanel]) p.classList.remove("is-active");
      if (tab === "chat") { chatTab.classList.add("is-active"); chatPanel.classList.add("is-active"); }
      else if (tab === "files") { filesTab.classList.add("is-active"); filesPanel.classList.add("is-active"); }
      else if (tab === "skills") { skillsTab.classList.add("is-active"); skillsPanel.classList.add("is-active"); }
      else { historyTab.classList.add("is-active"); historyPanel.classList.add("is-active"); }
      this.activeTab = tab;
      this.setPageTitleForTab(tab);
      if (tab === "skills") {
        const agentBody = skillsPanel.querySelector(".llm-bridge-agent-skills-body") as HTMLElement | null;
        if (agentBody && agentBody.hasAttribute("hidden")) agentBody.removeAttribute("hidden");
        this.updateAgentSkillsToggle();
      } else if (tab === "history") {
        this.setHistoryPanelExpanded(true);
        void this.refreshHistory();
      } else if (tab === "files") {
        this.refreshContextRefs();
        this.refreshPendingActions();
        this.refreshExternalReadPanel();
      }
    };
    sessionPreview.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.toggleSessionDropdown(sessionDropdown, () => switchTab("history"));
    });
    sessionDropdown.addEventListener("click", (e) => e.stopPropagation());
    chatTab.addEventListener("click", () => switchTab("chat"));
    filesTab.addEventListener("click", () => switchTab("files"));
    skillsTab.addEventListener("click", () => switchTab("skills"));
    historyTab.addEventListener("click", () => switchTab("history"));
    this.setPageTitleForTab("chat");

    // ===== Files page: attachments / pinned context / FileRef index / approvals =====
    const filesHead = filesPanel.createDiv({ cls: "llm-bridge-secondary-head" });
    filesHead.createEl("span", { cls: "llm-bridge-secondary-kicker", text: "Files" });
    filesHead.createEl("strong", { text: "文件与授权" });
    filesHead.createEl("small", { text: "下一条消息附件、跨轮引用和外部读取授权。" });
    this.filesContextEl = filesPanel.createDiv({ cls: "llm-bridge-context-refs llm-bridge-context-refs-page" });

    // ===== Pending Actions 区域（在 Files 页默认折叠） =====
    this.pendingActionsEl = filesPanel.createDiv({ cls: "llm-bridge-pending-wrap" });
    const pendingHead = this.pendingActionsEl.createDiv({ cls: "llm-bridge-pending-head" });
    const pendingToggle = pendingHead.createEl("span", { cls: "llm-bridge-pending-toggle", text: "▶ 待处理授权 (0)" });
    this.pendingActionsCountEl = pendingHead.createEl("span", { cls: "llm-bridge-pending-count", text: "" });
    const pendingBody = this.pendingActionsEl.createDiv({ cls: "llm-bridge-pending-body" });
    pendingBody.setAttribute("hidden", "");
    this.pendingActionsBody = pendingBody;
    pendingToggle.addEventListener("click", () => {
      const hidden = pendingBody.hasAttribute("hidden");
      if (hidden) {
        pendingBody.removeAttribute("hidden");
        pendingToggle.textContent = "▼ 待处理授权";
      } else {
        pendingBody.setAttribute("hidden", "");
        pendingToggle.textContent = "▶ 待处理授权";
      }
    });

    // ===== V2.0: 会话状态区（Session State） =====
    // 保留隐藏 diagnostics 状态栏供现有状态刷新逻辑使用；不常驻展示 backend/cwd/preflight 细节。
    this.statusBarEl = chatPanel.createDiv({ cls: "llm-bridge-status-bar llm-bridge-diagnostics-strip" });
    const sbTitleRow = this.statusBarEl.createDiv({ cls: "llm-bridge-sb-title-row" });
    sbTitleRow.createEl("span", { cls: "llm-bridge-sb-session-title-shadow", text: this.sessionState.title });
    const sbItems = this.statusBarEl.createDiv({ cls: "llm-bridge-sb-items" });
    this.statusBackendEl = sbItems.createEl("span", { cls: "llm-bridge-sb-item", attr: { title: "Backend 模式" } });
    this.statusBackendEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Backend" });
    this.statusBackendEl.createEl("span", { cls: "llm-bridge-sb-value" });
    this.statusAgentEl = sbItems.createEl("span", { cls: "llm-bridge-sb-item", attr: { title: "Agent 类型" } });
    this.statusAgentEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Agent" });
    this.statusAgentEl.createEl("span", { cls: "llm-bridge-sb-value" });
    this.statusCwdEl = sbItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-cwd", attr: { title: "当前 Vault / cwd" } });
    this.statusCwdEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Cwd" });
    this.statusCwdEl.createEl("span", { cls: "llm-bridge-sb-value" });
    // V2.4: 高级指标折叠区（减少首屏噪音，默认折叠；运行中可展开查看 SDK 调试指标）
    const sbAdvancedToggle = sbItems.createEl("button", {
      cls: "llm-bridge-sb-advanced-toggle",
      text: "▶ Advanced",
      attr: { title: "展开高级指标（Preflight/权限/工具/Agents/模式）" },
    });
    const sbAdvancedItems = sbItems.createDiv({ cls: "llm-bridge-sb-advanced-items", attr: { hidden: "" } });
    sbAdvancedToggle.addEventListener("click", () => {
      const hidden = sbAdvancedItems.hasAttribute("hidden");
      if (hidden) {
        sbAdvancedItems.removeAttribute("hidden");
        sbAdvancedToggle.textContent = "▼ Advanced";
      } else {
        sbAdvancedItems.setAttribute("hidden", "");
        sbAdvancedToggle.textContent = "▶ Advanced";
      }
    });
    this.statusPreflightEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-preflight", attr: { title: "最近一次 preflight 状态" } });
    this.statusPreflightEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Preflight" });
    this.statusPreflightEl.createEl("span", { cls: "llm-bridge-sb-value", text: "未检测" });
    // V2.3: 权限策略 / 工具步骤 / agent 计数
    this.statusPermissionEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-permission", attr: { title: "当前权限策略" } });
    this.statusPermissionEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Perm" });
    this.statusPermissionEl.createEl("span", { cls: "llm-bridge-sb-value", text: "medium" });
    this.statusToolsEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-tools", attr: { title: "最近一次 SDK 运行的工具步骤数" } });
    this.statusToolsEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Tools" });
    this.statusToolsEl.createEl("span", { cls: "llm-bridge-sb-value", text: "0" });
    this.statusAgentsEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-agents", attr: { title: "最近一次 SDK 运行的 agent 实例数" } });
    this.statusAgentsEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Agents" });
    this.statusAgentsEl.createEl("span", { cls: "llm-bridge-sb-value", text: "0" });
    // V2.3s: 权限模式（SDK permissionMode + 中文风险解释）
    this.statusPermModeEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-perm-mode", attr: { title: "SDK 权限模式" } });
    this.statusPermModeEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Mode" });
    this.statusPermModeEl.createEl("span", { cls: "llm-bridge-sb-value", text: "默认询问" });

    // ===== Agent Skills runtime capabilities：不插入 composer，不拼接 promptPackage =====
    this.renderAgentSkillsPanel(skillsPanel);

    const historyHead = historyPanel.createDiv({ cls: "llm-bridge-secondary-head llm-bridge-history-page-head" });
    historyHead.createEl("span", { cls: "llm-bridge-secondary-kicker", text: "History" });
    historyHead.createEl("strong", { text: "会话与恢复" });
    historyHead.createEl("small", { text: "最近运行、摘要和恢复入口保持在同一页。" });

    // ===== V2.5: 历史会话入口（可折叠，默认折叠） =====
    this.renderHistoryPanel(historyPanel);

    // ===== V1.2: 首次使用提示（可关闭，关闭后不再显示） =====
    this.renderFirstUseGuide(chatPanel);

    // V17-C1 任务 C：Pi Native Trust onboarding 卡片（首次 portable + pi-native + 未确认）
    this.renderPiNativeTrustOnboarding(chatPanel);

    // V17-C1 任务 D：Pi SDK 不可用时提示安装步骤（portable profile）
    this.renderPiSdkUnavailableHint(chatPanel);

    // Developer mode keeps the legacy global Run Flow; user mode shows process inside each assistant turn.
    if (this.plugin.settings.developerMode) {
      this.renderRunFlowPanel(chatPanel);
    }

    // ===== 消息流（对话区） =====
    this.messagesEl = chatPanel.createDiv({ cls: "llm-bridge-messages" });
    this.renderEmptyState();

    // V2.14.0-E: 外部读取授权请求面板（只管理授权，不读取文件内容）
    this.externalReadPanelEl = filesPanel.createDiv({ cls: "llm-bridge-external-read-panel" });
    this.externalReadPanelEl.style.display = "none";

    // P4-D: 轻量 Context tags（替代 Sources 大按钮条）
    this.pinnedContextEl = chatPanel.createEl("details", { cls: "llm-bridge-pinned-context" });
    this.pinnedContextEl.setAttribute("hidden", "");

    // ===== 底部 composer =====
    const composer = chatPanel.createDiv({ cls: "llm-bridge-composer" });
    // V16.4-F: permission approval dock 与 AskUserQuestion dock 同级，均在 composer 内部、composerBar 上方
    this.permissionPanelEl = composer.createDiv({ cls: "llm-bridge-perm-panel llm-bridge-approval-dock" });
    this.permissionPanelEl.style.display = "none";
    this.userInputPanelEl = composer.createDiv({ cls: "llm-bridge-user-input-panel llm-bridge-user-input-dock" });
    this.userInputPanelEl.style.display = "none";

    this.composerStatusRailEl = composer.createDiv({ cls: "llm-bridge-composer-status-rail", attr: { hidden: "" } });
    const composerStatusLine = this.composerStatusRailEl.createDiv({ cls: "llm-bridge-composer-status-line" });
    composerStatusLine.createEl("span", { cls: "llm-bridge-composer-status-rule", attr: { "aria-hidden": "true" } });
    this.composerStatusTextEl = composerStatusLine.createEl("span", { cls: "llm-bridge-composer-status-text" });
    composerStatusLine.createEl("span", { cls: "llm-bridge-composer-status-rule", attr: { "aria-hidden": "true" } });
    this.composerStepPillEl = this.composerStatusRailEl.createEl("span", { cls: "llm-bridge-composer-step-pill" });

    const composerContextRow = composer.createDiv({ cls: "llm-bridge-composer-context" });
    const contextTagsRow = composerContextRow.createDiv({ cls: "llm-bridge-context-tags" });
    // V2.16-D: Context indicator（V16.3: 普通用户态只显示 ring，developer mode 点击展开明细）
    const contextStrip = composerContextRow.createDiv({ cls: "llm-bridge-context-strip" });
    this.contextRingEl = contextStrip.createDiv({ cls: "llm-bridge-context-ring" });
    this.contextLabelEl = contextStrip.createDiv({ cls: "llm-bridge-context-label", text: "Context estimate" });
    this.contextDetailEl = contextStrip.createDiv({ cls: "llm-bridge-context-detail" });
    this.contextDetailEl.setAttribute("hidden", "");
    contextStrip.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".llm-bridge-context-detail")) return;
      // V16.3: 普通用户态不展开明细，只 hover/title 看 used/total；developer mode 可点击展开
      if (!this.plugin.settings.developerMode) return;
      if (this.contextDetailEl.hasAttribute("hidden")) {
        this.contextDetailEl.removeAttribute("hidden");
      } else {
        this.contextDetailEl.setAttribute("hidden", "");
      }
    });

    const composerBar = composer.createDiv({ cls: "llm-bridge-composer-bar" });
    this.composerBarEl = composerBar;
    composerBar.appendChild(composerContextRow);
    composerBar.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, select, summary, details, input, textarea")) return;
      this.inputEl.focus();
    });
    const leftTools = composerBar.createDiv({ cls: "llm-bridge-composer-tools llm-bridge-composer-tools-left" });
    const attachmentBtn = leftTools.createEl("button", {
      cls: "llm-bridge-composer-tool-btn llm-bridge-attach-file-btn",
      attr: { title: "添加文件或图片；也可以拖拽/粘贴文件，或输入 @ 选择 Vault 文件" },
    });
    setIcon(attachmentBtn, "plus");
    attachmentBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.inputEl.focus();
      this.attachmentFileInputEl?.click();
    });
    const commandMenu = leftTools.createEl("details", { cls: "llm-bridge-command-menu" });
    const commandSummary = commandMenu.createEl("summary", {
      cls: "llm-bridge-composer-tool-btn llm-bridge-command-menu-summary",
      attr: { title: "工具、上下文与辅助操作" },
    });
    setIcon(commandSummary.createEl("span", { cls: "llm-bridge-command-menu-summary-icon" }), "wrench");
    commandSummary.createEl("span", { cls: "llm-bridge-command-menu-label", text: "工具" });
    const commandMenuBody = commandMenu.createDiv({ cls: "llm-bridge-command-menu-body" });
    const planModeBtn = commandMenuBody.createEl("button", {
      cls: "llm-bridge-command-menu-item",
      text: "计划模式",
      attr: { title: "切换到只读规划模式" },
    });
    this.decorateCommandMenuItem(planModeBtn, "list-checks", "计划模式", "切换到只读规划模式，不直接改文件");
    planModeBtn.addEventListener("click", async () => {
      commandMenu.removeAttribute("open");
      await this.setPermissionMode("plan");
    });
    const commandPlugins = commandMenuBody.createDiv({ cls: "llm-bridge-command-menu-plugins" });
    const commandPluginsHead = commandPlugins.createDiv({ cls: "llm-bridge-command-menu-plugins-head" });
    commandPluginsHead.createEl("span", { cls: "llm-bridge-command-menu-section-title", text: "插件" });
    commandPluginsHead.createEl("span", { cls: "llm-bridge-command-menu-section-hint", text: "选择本轮能力" });
    const commandPluginsList = commandPlugins.createDiv({ cls: "llm-bridge-command-menu-plugins-list" });
    commandPluginsList.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "打开菜单后读取插件与 Skills。" });
    let commandPluginsRequest = 0;
    const refreshCommandPlugins = async () => {
      const request = ++commandPluginsRequest;
      commandPluginsList.empty();
      commandPluginsList.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "正在读取..." });
      await this.refreshManagedCodexPlugins();
      await this.refreshAgentSkillsManifestOnly();
      if (request !== commandPluginsRequest) return;
      this.renderComposerRuntimeToolsList(commandPluginsList);
      this.renderAgentSkillsList();
    };
    commandMenu.addEventListener("toggle", () => {
      if (!commandMenu.hasAttribute("open")) return;
      void refreshCommandPlugins();
    });
    this.preflightBtn = document.createElement("button");
    this.permissionModePickerEl = leftTools.createDiv({ cls: "llm-bridge-permission-picker" });
    this.permissionModeChipEl = this.permissionModePickerEl.createEl("button", {
      cls: "llm-bridge-permission-chip",
      attr: { title: "切换权限模式：受限 / 默认 / acceptEdits", "aria-haspopup": "true", "aria-expanded": "false" },
    });
    this.permissionModeChipEl.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.togglePermissionPopover();
    });

    this.composerRuntimeCapabilitiesEl = composerBar.createDiv({ cls: "llm-bridge-composer-runtime-capabilities" });
    this.composerRuntimeCapabilitiesEl.setAttribute("hidden", "");
    this.composerFileRefsEl = composerBar.createDiv({ cls: "llm-bridge-composer-file-refs" });
    const inputRow = composerBar.createDiv({ cls: "llm-bridge-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "llm-bridge-input",
      attr: { placeholder: "要求后续变更", rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this.mentionPickerEl && !this.mentionPickerEl.hasAttribute("hidden")) {
        if (this.handleMentionKeydown(e)) return;
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.run();
      }
    });
    // V2.15-H: 监听 input 事件，检测 @ 提及触发 inline 文件选择器
    this.inputEl.addEventListener("input", () => this.handleMentionInput());
    this.inputEl.addEventListener("paste", (event) => {
      void this.handleComposerPaste(event);
    });
    this.registerDomEvent(document, "pointerdown", (event) => {
      if (!this.mentionPickerEl || this.mentionPickerEl.hasAttribute("hidden")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".llm-bridge-mention-picker")) return;
      if (target === this.inputEl) return;
      this.closeMentionPicker();
    });

    const rightTools = composerBar.createDiv({ cls: "llm-bridge-composer-tools llm-bridge-composer-tools-right" });
    this.agentChipTextEl = agentSelect;
    this.renderModelEffortPicker(rightTools);
    const actionCol = rightTools.createDiv({ cls: "llm-bridge-action-col" });
    // 停止按钮：只在运行中显示
    this.stopBtn = actionCol.createEl("button", {
      cls: "llm-bridge-stop-btn",
      attr: { title: "停止", "aria-label": "停止" },
    });
    this.stopBtn.createEl("span", { cls: "llm-bridge-stop-icon", text: "■" });
    this.stopBtn.style.display = "none";
    this.stopBtn.addEventListener("click", () => this.stop());
    // 发送按钮
    this.sendBtn = actionCol.createEl("button", {
      cls: "llm-bridge-send-btn",
      attr: { title: "发送 (Ctrl/Cmd+Enter)", "aria-label": "发送" },
    });
    setIcon(this.sendBtn.createEl("span", { cls: "llm-bridge-send-icon" }), "send");
    this.sendBtn.addEventListener("click", () => void this.run());

    // P4-D: 轻量 context tags（替代 Note/Selection 大按钮）
    // Note tag renders as plain text; color/strikethrough indicate attach state.
    this.includeNoteCheckEl = this.buildContextTag(contextTagsRow, "note", () => this.plugin.settings.includeActiveNote, async (on) => {
      this.plugin.settings.includeActiveNote = on;
      await this.plugin.saveSettings();
    });
    // V16.3 Round 3: 文件名合并进 chip 按钮文案，独立 span 仅作隐藏存储
    this.activeFileLabelEl = this.includeNoteCheckEl.parentElement!.createEl("span", { cls: "llm-bridge-context-tag-file", text: "", attr: { hidden: "" } });

    // Selection tag: only visible when there's a selection
    this.includeSelectionCheckEl = this.buildContextTag(contextTagsRow, "selection", () => this.plugin.settings.includeSelection, async (on) => {
      this.plugin.settings.includeSelection = on;
      await this.plugin.saveSettings();
    });
    this.selectionLabelEl = this.includeSelectionCheckEl.parentElement!.createEl("span", { cls: "llm-bridge-context-tag-file", text: "" });
    this.attachmentFileInputEl = composer.createEl("input", {
      attr: { type: "file", multiple: "true", tabindex: "-1" },
    });
    this.attachmentFileInputEl.addClass("llm-bridge-native-file-input");
    this.attachmentFileInputEl.addEventListener("change", () => void this.addNativeSelectedAttachments());

    composer.addEventListener("dragover", (event) => {
      const hasFiles = !!event.dataTransfer?.files?.length || Array.from(event.dataTransfer?.types ?? []).some((type) => /files|uri-list/i.test(type));
      if (!hasFiles) return;
      event.preventDefault();
      composer.addClass("is-dragging-file");
    });
    composer.addEventListener("dragleave", () => composer.removeClass("is-dragging-file"));
    composer.addEventListener("drop", (event) => {
      event.preventDefault();
      composer.removeClass("is-dragging-file");
      void this.handleComposerDrop(event);
    });
    this.refreshContextRefs();

    // 初始化
    this.syncControlsFromSettings();
    this.updateContextDisplay();
    this.setGlobalStatus("idle");
    this.refreshStatusBar();
    this.refreshSessionState();
    void this.refreshAgentSkills();
    void this.refreshHistory();
    // V2.16-D: 会话保持 — onOpen 时若启用 keepLastSession 且存在 lastActiveSessionId，自动恢复
    void this.restoreLastActiveSessionIfNeeded();
    // V2.16-D: 初始 context metrics 估算
    void this.refreshContextMetrics();

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.rememberActiveFile(this.app.workspace.getActiveFile());
      this.updateContextDisplay();
      this.refreshStatusBar();
      void this.refreshContextMetrics();
    }));
    // V2.10 (B-001): 订阅 file-open 事件，确保同一 pane 内切换文件时 chip 立即更新
    // active-leaf-change 在某些场景（如快速切换同 pane 文件）可能延迟或不触发，file-open 更可靠
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.rememberActiveFile(file instanceof TFile ? file : null);
      this.updateContextDisplay();
      void this.refreshContextMetrics();
    }));

    // 注册 pending action 回调到 httpBridge
    this.registerPendingActionCallback();
  }

  // 向 httpBridge 注册 pending action 确认 UI 回调
  private registerPendingActionCallback(): void {
    const bridge = this.plugin.getHttpBridge();
    if (!bridge) return;
    bridge.setPendingConfirmCallback((entry, approve, reject) => {
      // 添加到本地队列（去重）
      if (!this.pendingActions.find((a) => a.id === entry.id)) {
        this.pendingActions.push(entry);
      }
      this.refreshPendingActions();
      // approve/reject 函数已在 promptConfirmation 中注册到 pendingConfirms
      // 这里无需额外操作，等待用户点击按钮
    });
  }

  // 刷新 Pending Actions 列表显示
  // V2.3: 按 actionType 分组，多 entry 时显示批量授权按钮；count=0 时隐藏面板
  private refreshPendingActions(): void {
    const bridge = this.plugin.getHttpBridge();
    if (!bridge) return;
    // 同步最新 pending 状态
    const latest = bridge.getPendingActions();
    // 合并最新状态到本地队列
    for (const entry of latest) {
      const idx = this.pendingActions.findIndex((a) => a.id === entry.id);
      if (idx >= 0) {
        this.pendingActions[idx] = entry;
      } else {
        this.pendingActions.push(entry);
      }
    }
    // 清理已不在 pendingActions 中的项（终态）
    this.pendingActions = this.pendingActions.filter((a) =>
      latest.find((e) => e.id === a.id),
    );

    const count = this.pendingActions.length;
    this.pendingActionsCountEl.textContent = `(${count})`;

    // V2.3: count=0 时隐藏整个面板（减少首屏噪音，解决 B-013 部分）
    if (count === 0) {
      this.pendingActionsEl.style.display = "none";
      this.pendingActionsBody.empty();
      return;
    }
    this.pendingActionsEl.style.display = "";

    // V2.3: 按 actionType 分组（合并展示，避免每个 tool 弹一次）
    const groups = new Map<string, PendingActionEntry[]>();
    for (const entry of this.pendingActions) {
      const arr = groups.get(entry.type) || [];
      arr.push(entry);
      groups.set(entry.type, arr);
    }

    this.pendingActionsBody.empty();

    for (const [actionType, entries] of groups) {
      const groupWrap = this.pendingActionsBody.createDiv({ cls: "llm-bridge-pending-group" });

      // 批量操作行（仅当该类型有 >1 个 pending 时显示）
      if (entries.length > 1) {
        const batchRow = groupWrap.createDiv({ cls: "llm-bridge-pending-batch" });
        batchRow.createEl("span", {
          cls: "llm-bridge-pending-batch-label",
          text: `${actionType} ×${entries.length}`,
        });
        const batchBtns = batchRow.createDiv({ cls: "llm-bridge-pending-batch-btns" });
        const batchAllowBtn = batchBtns.createEl("button", {
          cls: "llm-bridge-pending-btn-approve llm-bridge-pending-btn-batch",
          text: "✓ 全部允许（本会话）",
          attr: { title: `本会话内允许所有 ${actionType} 操作` },
        });
        batchAllowBtn.addEventListener("click", () => {
          bridge.batchApproveSession(actionType);
          this.pendingActions = this.pendingActions.filter((a) => a.type !== actionType);
          this.refreshPendingActions();
        });
        const batchRejectBtn = batchBtns.createEl("button", {
          cls: "llm-bridge-pending-btn-reject llm-bridge-pending-btn-batch",
          text: "✗ 全部拒绝",
        });
        batchRejectBtn.addEventListener("click", () => {
          bridge.batchRejectSession(actionType);
          this.pendingActions = this.pendingActions.filter((a) => a.type !== actionType);
          this.refreshPendingActions();
        });
      }

      // 单个 entry 渲染
      for (const entry of entries) {
        const item = groupWrap.createDiv({ cls: "llm-bridge-pending-item" });
        // 行1: type chip + actionId
        const row1 = item.createDiv({ cls: "llm-bridge-pending-row1" });
        row1.createEl("span", { cls: "llm-bridge-pending-type", text: entry.type });
        row1.createEl("span", { cls: "llm-bridge-pending-id", text: entry.id.slice(0, 16) + "…" });
        // 行2: 目标路径或说明
        const row2 = item.createDiv({ cls: "llm-bridge-pending-row2" });
        const p = entry.params;
        let desc = "";
        if (p.path) desc = String(p.path);
        else if (p.message) desc = String(p.message).slice(0, 40);
        else if (p.content) desc = String(p.content).slice(0, 40);
        row2.createEl("span", { cls: "llm-bridge-pending-desc", text: desc });
        // 行3: source + createdAt
        const row3 = item.createDiv({ cls: "llm-bridge-pending-row3" });
        row3.createEl("span", { cls: "llm-bridge-pending-meta", text: "http" });
        const createdAt = new Date(entry.ts).toLocaleTimeString();
        row3.createEl("span", { cls: "llm-bridge-pending-meta", text: createdAt });
        // V2.3: 按钮行（本次允许 + 本会话允许 + 拒绝）
        const btnRow = item.createDiv({ cls: "llm-bridge-pending-btns" });
        const allowOnceBtn = btnRow.createEl("button", {
          cls: "llm-bridge-pending-btn-approve",
          text: "允许一次",
          attr: { title: "仅本次允许，不缓存" },
        });
        allowOnceBtn.addEventListener("click", () => {
          bridge.approvePendingActionWithDecision(entry.id, "allow_once");
          this.pendingActions = this.pendingActions.filter((a) => a.id !== entry.id);
          this.refreshPendingActions();
        });
        const allowSessionBtn = btnRow.createEl("button", {
          cls: "llm-bridge-pending-btn-approve llm-bridge-pending-btn-session",
          text: "本会话允许",
          attr: { title: "本会话内允许同类操作，不再询问" },
        });
        allowSessionBtn.addEventListener("click", () => {
          bridge.approvePendingActionWithDecision(entry.id, "allow_session");
          this.pendingActions = this.pendingActions.filter((a) => a.id !== entry.id);
          this.refreshPendingActions();
        });
        const rejectBtn = btnRow.createEl("button", {
          cls: "llm-bridge-pending-btn-reject",
          text: "拒绝",
        });
        rejectBtn.addEventListener("click", () => {
          bridge.rejectPendingActionWithDecision(entry.id, "deny_session");
          this.pendingActions = this.pendingActions.filter((a) => a.id !== entry.id);
          this.refreshPendingActions();
        });
      }
    }
  }

  // ---------- chip 组件 ----------

  // 单个 chip：点击循环到下一个选项；紧凑单按钮形态
  private buildChipGroup(
    parent: HTMLElement,
    options: { value: string; label: string; disabled?: boolean }[],
    getCurrent: () => string,
    onSelect: (v: string) => Promise<void>,
  ): HTMLElement {
    const enabled = options.filter((o) => !o.disabled);
    const wrap = parent.createDiv({ cls: "llm-bridge-chip-wrap" });
    const chip = wrap.createEl("button", {
      cls: "llm-bridge-chip",
      text: this.labelForValue(options, getCurrent()),
      attr: { "data-group": "cycle" },
    });
    chip.addEventListener("click", async () => {
      if (this.runHandle) return;
      const cur = getCurrent();
      const idx = enabled.findIndex((o) => o.value === cur);
      const next = enabled[(idx + 1) % enabled.length];
      await onSelect(next.value);
      this.refreshAllChips();
    });
    wrap.dataset.values = options.map((o) => o.value).join(",");
    return wrap;
  }

  // 上下文 chip：点击切换开关态
  /**
   * P4-D: Build a lightweight context tag (replaces bulky chip buttons).
   * Note tag: shows "Using" label + filename, clickable to toggle.
   * Selection tag: shows "Selection" + char count, only visible when selection exists.
   */
  private buildContextTag(
    parent: HTMLElement,
    kind: "note" | "selection",
    getCurrent: () => boolean,
    onToggle: (on: boolean) => Promise<void>,
  ): HTMLInputElement {
    const wrap = parent.createDiv({ cls: `llm-bridge-context-tag-wrap llm-bridge-context-tag-${kind}` });
    const check = wrap.createEl("input", { type: "checkbox", cls: "llm-bridge-chip-check" });
    check.checked = getCurrent();
    const tag = wrap.createEl("span", {
      cls: `llm-bridge-context-tag ${kind === "note" ? "is-active-file" : "is-selection-ref"}`,
      text: kind === "note" ? "" : "Selection",
      attr: { "aria-pressed": String(check.checked), "data-context-kind": kind, tabindex: "0" },
    });
    const toggle = async (e: Event) => {
      e.preventDefault();
      if (this.runHandle) return;
      check.checked = !check.checked;
      tag.setAttribute("aria-pressed", String(check.checked));
      await onToggle(check.checked);
      this.refreshAllChips();
    };
    tag.addEventListener("click", toggle);
    tag.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      void toggle(e);
    });
    return check;
  }

  private setPageTitleForTab(tab: "chat" | "files" | "skills" | "history"): void {
    if (!this.pageTitleEl) return;
    const label = tab === "chat" ? "Chat" : tab === "files" ? "Files" : tab === "skills" ? "Capabilities" : "History";
    this.pageTitleEl.textContent = label;
    this.pageTitleEl.toggleAttribute("hidden", tab === "chat");
  }

  private decorateCommandMenuItem(button: HTMLButtonElement, iconName: string, title: string, description: string): void {
    button.empty();
    const icon = button.createEl("span", { cls: "llm-bridge-command-menu-item-icon" });
    setIcon(icon, iconName);
    const text = button.createDiv({ cls: "llm-bridge-command-menu-item-text" });
    text.createEl("span", { cls: "llm-bridge-command-menu-item-title", text: title });
    text.createEl("span", { cls: "llm-bridge-command-menu-item-desc", text: description });
  }

  private renderComposerRuntimeToolsList(parent: HTMLElement): void {
    parent.empty();
    this.renderComposerManagedCodexPluginsList(parent);
    this.renderComposerAgentSkillsList(parent);
  }

  private renderComposerRuntimeCapabilityChips(): void {
    const container = this.composerRuntimeCapabilitiesEl;
    if (!container) return;
    container.empty();
    if (this.selectedRuntimeCapabilities.length === 0) {
      container.setAttribute("hidden", "");
      return;
    }
    container.removeAttribute("hidden");
    for (const selection of this.selectedRuntimeCapabilities) {
      const chip = container.createEl("button", {
        cls: "llm-bridge-composer-runtime-chip",
        attr: {
          title: `${selection.kind === "plugin" ? "Plugin" : "Skill"} · ${selection.description || selection.id}。点击移除。`,
          "data-plugin-key": selection.visualKey,
        },
      });
      const icon = chip.createEl("span", { cls: "llm-bridge-composer-runtime-chip-icon" });
      setIcon(icon, selection.icon);
      chip.createEl("span", { cls: "llm-bridge-composer-runtime-chip-label", text: selection.label });
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectedRuntimeCapabilities = this.selectedRuntimeCapabilities.filter((item) =>
          !(item.kind === selection.kind && item.id === selection.id)
        );
        this.renderComposerRuntimeCapabilityChips();
        this.inputEl.focus();
      });
    }
  }

  private toggleComposerRuntimeCapability(selection: ComposerRuntimeCapabilitySelection): void {
    const exists = this.selectedRuntimeCapabilities.some((item) => item.kind === selection.kind && item.id === selection.id);
    this.selectedRuntimeCapabilities = exists
      ? this.selectedRuntimeCapabilities.filter((item) => !(item.kind === selection.kind && item.id === selection.id))
      : [...this.selectedRuntimeCapabilities.filter((item) => item.kind !== selection.kind || item.id !== selection.id), selection];
    this.renderComposerRuntimeCapabilityChips();
  }

  private renderComposerManagedCodexPluginsList(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "llm-bridge-command-menu-runtime-section" });
    section.createDiv({ cls: "llm-bridge-command-menu-subtitle", text: "Installed plugins" });
    if (!this.managedCodexPluginCatalog?.available) {
      section.createDiv({
        cls: "llm-bridge-command-menu-plugin-empty is-error",
        text: this.managedCodexPluginCatalog?.error || "managed runtime unavailable",
      });
      return;
    }
    if (this.managedCodexPlugins.length === 0) {
      section.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "当前 runtime 没有已安装插件。" });
      return;
    }
    for (const plugin of this.managedCodexPlugins) {
      const presentation = this.describeComposerManagedCodexPlugin(plugin);
      const item = section.createEl("button", {
        cls: `llm-bridge-command-menu-plugin${plugin.enabled ? "" : " is-disabled"}`,
        attr: {
          "data-plugin-key": this.composerToolVisualKey(presentation.label, plugin.pluginId),
          title: plugin.enabled
            ? `使用 ${presentation.label} 插件`
            : `${presentation.label} 已安装但当前未启用`,
        },
      });
      item.disabled = !plugin.enabled;
      item.addEventListener("click", () => this.useComposerManagedCodexPlugin(plugin));
      const icon = item.createEl("span", { cls: "llm-bridge-command-menu-plugin-icon" });
      setIcon(icon, presentation.icon);
      const main = item.createDiv({ cls: "llm-bridge-command-menu-plugin-main" });
      const title = main.createDiv({ cls: "llm-bridge-command-menu-plugin-title" });
      title.createEl("span", { cls: "llm-bridge-command-menu-plugin-name", text: presentation.label });
      main.createDiv({
        cls: "llm-bridge-command-menu-plugin-desc",
        text: presentation.description,
      });
    }
  }

  private renderComposerAgentSkillsList(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "llm-bridge-command-menu-runtime-section" });
    section.createDiv({ cls: "llm-bridge-command-menu-subtitle", text: "Agent Skills" });
    const sorted = this.agentSkills
      .filter((skill) => skill.enabled)
      .slice()
      .sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug));
    if (sorted.length === 0) {
      section.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "当前 Vault 没有启用 Agent Skills。" });
      return;
    }
    for (const skill of sorted) {
      const label = skill.name || skill.slug;
      const item = section.createEl("button", {
        cls: "llm-bridge-command-menu-plugin is-skill",
        attr: {
          "data-plugin-key": this.composerToolVisualKey(label, skill.slug),
          title: `使用 ${label} Skill`,
        },
      });
      item.addEventListener("click", () => this.useComposerAgentSkill(skill));
      const icon = item.createEl("span", { cls: "llm-bridge-command-menu-plugin-icon" });
      setIcon(icon, "sparkles");
      const main = item.createDiv({ cls: "llm-bridge-command-menu-plugin-main" });
      const title = main.createDiv({ cls: "llm-bridge-command-menu-plugin-title" });
      title.createEl("span", { cls: "llm-bridge-command-menu-plugin-name", text: label });
      main.createDiv({
        cls: "llm-bridge-command-menu-plugin-desc",
        text: skill.description || skill.slug,
      });
    }
  }

  private composerToolVisualKey(label: string, id: string): string {
    const key = `${label} ${id}`.toLowerCase();
    if (key.includes("chrome")) return "chrome";
    if (key.includes("document")) return "documents";
    if (key.includes("pdf")) return "pdf";
    if (key.includes("spreadsheet") || key.includes("sheet")) return "spreadsheets";
    if (key.includes("presentation") || key.includes("slide")) return "presentations";
    if (key.includes("template")) return "template";
    if (key.includes("computer")) return "computer";
    if (key.includes("github")) return "github";
    if (key.includes("gmail")) return "gmail";
    if (key.includes("google-drive") || key.includes("drive")) return "google-drive";
    if (key.includes("imagegen") || key.includes("image")) return "imagegen";
    if (key.includes("skill")) return "skill";
    return "plugin";
  }

  private describeComposerManagedCodexPlugin(plugin: CodexManagedPluginEntry): { label: string; description: string; icon: string } {
    const key = `${plugin.pluginId} ${plugin.name} ${plugin.marketplaceName}`.toLowerCase();
    if (key.includes("document")) return { label: "Documents", description: "Create and edit document artifacts", icon: "file-text" };
    if (key.includes("pdf")) return { label: "PDF", description: "Read, create, and verify PDF files", icon: "file-type" };
    if (key.includes("spreadsheet") || key.includes("sheet")) return { label: "Spreadsheets", description: "Create and edit spreadsheet files", icon: "table-2" };
    if (key.includes("presentation") || key.includes("slide")) return { label: "Presentations", description: "Create and edit presentations", icon: "presentation" };
    if (key.includes("template")) return { label: "Template Creator", description: "Create or update personal artifact templates", icon: "blocks" };
    if (key.includes("computer")) return { label: "电脑", description: "Control Windows apps from Codex", icon: "monitor" };
    if (key.includes("github")) return { label: "GitHub", description: "Triage PRs, issues, CI, and publish flows", icon: "github" };
    if (key.includes("gmail")) return { label: "Gmail", description: "Read and manage Gmail", icon: "mail" };
    if (key.includes("google-drive")) return { label: "Google Drive", description: "Search and work with Drive files", icon: "folder-sync" };
    if (key.includes("google-doc")) return { label: "Google Docs", description: "Create and edit Google Docs", icon: "file-text" };
    if (key.includes("google-sheet")) return { label: "Google Sheets", description: "Analyze and edit Google Sheets", icon: "table-2" };
    if (key.includes("google-slide")) return { label: "Google Slides", description: "Create and edit Google Slides", icon: "presentation" };
    if (key.includes("chrome")) return { label: "Chrome", description: "Use the local browser session", icon: "globe" };
    const label = plugin.name || plugin.marketplaceName || plugin.pluginId;
    return {
      label,
      description: plugin.marketplaceName && plugin.marketplaceName !== "unknown"
        ? plugin.marketplaceName
        : `Installed Codex plugin · ${plugin.version}`,
      icon: plugin.enabled ? "plug" : "plug-zap",
    };
  }

  private useComposerManagedCodexPlugin(plugin: CodexManagedPluginEntry): void {
    if (!plugin.enabled) {
      new Notice(`${plugin.name} 已安装但当前未启用`);
      return;
    }
    const presentation = this.describeComposerManagedCodexPlugin(plugin);
    this.toggleComposerRuntimeCapability({
      kind: "plugin",
      id: plugin.pluginId,
      label: presentation.label,
      description: presentation.description,
      icon: presentation.icon,
      visualKey: this.composerToolVisualKey(presentation.label, plugin.pluginId),
    });
    const menu = this.inputEl.closest(".llm-bridge-composer-bar")?.querySelector(".llm-bridge-command-menu") as HTMLDetailsElement | null;
    menu?.removeAttribute("open");
    this.inputEl.focus();
  }

  private useComposerAgentSkill(skill: AgentSkillRecord): void {
    if (!skill.enabled) {
      new Notice(`${skill.name || skill.slug} 当前未启用`);
      return;
    }
    const label = skill.name || skill.slug;
    this.toggleComposerRuntimeCapability({
      kind: "skill",
      id: skill.slug,
      label,
      description: skill.description || skill.slug,
      icon: "sparkles",
      visualKey: this.composerToolVisualKey(label, skill.slug),
    });
    const menu = this.inputEl.closest(".llm-bridge-composer-bar")?.querySelector(".llm-bridge-command-menu") as HTMLDetailsElement | null;
    menu?.removeAttribute("open");
    this.inputEl.focus();
  }

  private buildUserInputWithRuntimeCapabilityHints(userInput: string): string {
    if (this.selectedRuntimeCapabilities.length === 0) return userInput;
    const hints = this.selectedRuntimeCapabilities.map((selection) =>
      `- ${selection.kind === "plugin" ? "Plugin" : "Skill"}: ${selection.label} (${selection.id}) — ${selection.description}`
    ).join("\n");
    return `Preferred runtime capabilities for this turn:\n${hints}\n\nUser request:\n${userInput}`;
  }

  private insertComposerText(text: string): void {
    const input = this.inputEl;
    const value = input.value;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const prefix = value.slice(0, start);
    const suffix = value.slice(end);
    const spacerBefore = prefix.length === 0 || /\s$/.test(prefix) ? "" : "\n";
    const spacerAfter = suffix.length === 0 || /^\s/.test(suffix) ? "" : "\n";
    const next = `${prefix}${spacerBefore}${text}${spacerAfter}${suffix}`;
    const cursor = prefix.length + spacerBefore.length + text.length;
    input.value = next;
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private labelForValue(options: { value: string; label: string }[], v: string): string {
    return options.find((o) => o.value === v)?.label ?? v;
  }

  private refreshAllChips(): void {
    // composer agent 下拉
    (this.agentChipGroup as HTMLSelectElement).value = this.plugin.settings.agentType;

    // V2.15-E: composer 只保留一个 compact 模型/思考强度组合控件。
    this.refreshModelEffortPicker();
    this.refreshPermissionModeChip();
    this.renderPermissionPopover();
    // V2.4: Mode chip 已移除（仅 Fresh 可用，无需 refresh）

    // 上下文 tag 勾选态
    const noteTag = this.includeNoteCheckEl.parentElement?.querySelector(".llm-bridge-context-tag");
    if (noteTag) {
      const on = this.plugin.settings.includeActiveNote;
      const noteWrap = this.includeNoteCheckEl.parentElement;
      const fname = this.activeFileLabelEl.dataset.value || "";
      if (noteWrap) noteWrap.removeAttribute("hidden");
      if (noteWrap) noteWrap.classList.toggle("is-empty", !fname);
      noteTag.classList.toggle("is-active", on && !!fname);
      noteTag.classList.toggle("is-off", !on && !!fname);
      noteTag.classList.toggle("is-empty", !fname);
      noteTag.classList.toggle("is-path-only", on && this.activeNoteAttachState === "path-only");
      noteTag.setAttribute("aria-pressed", String(on && !!fname));
      // V17-G2: 活动笔记 tag 只显示当前文件名；状态通过颜色/删除线表达。
      const displayName = fname || "No active note";
      noteTag.textContent = displayName;
      if (!fname) {
        noteTag.setAttribute("title", "No active note. Open a markdown file and it will appear here.");
      } else if (!on) {
        noteTag.setAttribute("title", `${fname}：当前未引用，点击开启`);
      } else if (this.activeNoteAttachState === "full") {
        noteTag.setAttribute("title", `${fname}：路径 + 内容已引用，点击关闭`);
      } else if (this.activeNoteAttachState === "path-only") {
        noteTag.setAttribute("title", `${fname}：仅路径已引用，内容读取失败，点击关闭`);
      } else {
        noteTag.setAttribute("title", `${fname}：已开启自动引用，点击关闭`);
      }
    }
    const selTag = this.includeSelectionCheckEl.parentElement?.querySelector(".llm-bridge-context-tag");
    if (selTag) {
      const on = this.plugin.settings.includeSelection;
      const selectionText = this.selectionLabelEl.dataset.value || "";
      const selWrap = this.includeSelectionCheckEl.parentElement;
      if (selWrap) selWrap.toggleAttribute("hidden", !selectionText);
      selTag.textContent = selectionText ? `Selection ${selectionText}` : "Selection";
      selTag.classList.toggle("is-active", on);
      selTag.classList.toggle("is-off", !on);
      selTag.setAttribute("aria-pressed", String(on));
    }
  }

  private refreshCycleChip(wrap: HTMLElement, options: { value: string; label: string }[], v: string): void {
    const chip = wrap.querySelector(".llm-bridge-chip") as HTMLButtonElement | null;
    if (chip) chip.textContent = this.labelForValue(options, v);
  }

  private eventTargetElement(event: Event): HTMLElement | null {
    const target = event.target;
    if (target instanceof HTMLElement) return target;
    if (target instanceof Text) return target.parentElement;
    return target instanceof Element ? target as HTMLElement : null;
  }

  private isEventInsideSelector(event: Event, selector: string): boolean {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node instanceof HTMLElement && (node.matches(selector) || !!node.closest(selector))) {
        return true;
      }
    }
    const target = this.eventTargetElement(event);
    return !!target?.closest(selector);
  }

  private sanitizeUserFacingSummaryText(text?: string): string | undefined {
    if (!text) return text;
    return text.replace(/\[object Object\](\s*,\s*\[object Object\])*/g, (match) => {
      const count = match.match(/\[object Object\]/g)?.length ?? 0;
      return count > 1 ? `${count} items` : "{ object }";
    });
  }

  private getUserInputDraft(requestId: string): UserInputDraft {
    const existing = this.pendingUserInputDrafts.get(requestId);
    if (existing) return existing;
    const created: UserInputDraft = {
      value: "",
      supplement: "",
      selections: {},
      customInputs: {},
      optionPages: {},
      stepIndex: 0,
    };
    this.pendingUserInputDrafts.set(requestId, created);
    return created;
  }

  private getClarificationQuestions(req: UserInputRequestSegment): ReadonlyArray<UserInputQuestion> {
    return req.questions && req.questions.length > 0
      ? req.questions
      : [{ id: "answer", question: req.prompt, options: [] }];
  }

  private isMultiSelectQuestion(question: UserInputQuestion): boolean {
    return question.multiSelect === true || question.selectionType === "multiple";
  }

  private normalizeUserInputSelection(value: string | string[] | undefined): string[] {
    if (Array.isArray(value)) return value.filter((item) => item.trim().length > 0);
    return typeof value === "string" && value.trim().length > 0 ? [value] : [];
  }

  private composeUserInputDraftValue(
    questions: ReadonlyArray<UserInputQuestion>,
    selections: Record<string, string | string[]>,
    customInputs: Record<string, string> = {},
  ): string {
    return questions
      .map((q) => {
        const custom = customInputs[q.id]?.trim();
        if (custom) return custom;
        const selected = this.normalizeUserInputSelection(selections[q.id]);
        return selected.join(", ");
      })
      .filter((value) => value.trim().length > 0)
      .join(" + ");
  }

  private composeUserInputAnswers(
    questions: ReadonlyArray<UserInputQuestion>,
    draft: UserInputDraft,
  ): Record<string, string | string[]> {
    const answers: Record<string, string | string[]> = {};
    for (const question of questions) {
      const custom = draft.customInputs[question.id]?.trim();
      if (custom) {
        answers[question.id] = custom;
        continue;
      }
      const selected = this.normalizeUserInputSelection(draft.selections[question.id]);
      if (this.isMultiSelectQuestion(question)) {
        answers[question.id] = selected;
      } else {
        answers[question.id] = selected[0] ?? "";
      }
    }
    return answers;
  }

  private renderModelEffortPicker(parent: HTMLElement): void {
    this.modelEffortPickerEl = parent.createDiv({ cls: "llm-bridge-model-effort-picker" });
    // V16.3 Round 3: 拆成两个独立轻量 inline chip（model / effort），共享一个 popover
    this.modelEffortButtonEl = this.modelEffortPickerEl.createEl("button", {
      cls: "llm-bridge-model-effort-chip llm-bridge-model-chip-inline",
      attr: { title: "选择模型", "aria-haspopup": "true", "aria-expanded": "false" },
    });
    this.modelEffortButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.runHandle) return;
      this.toggleModelEffortPopover();
    });
    this.effortChipEl = this.modelEffortPickerEl.createEl("button", {
      cls: "llm-bridge-model-effort-chip llm-bridge-effort-chip-inline",
      attr: { title: "选择推理等级", "aria-haspopup": "true", "aria-expanded": "false" },
    });
    this.effortChipEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.runHandle) return;
      this.toggleModelEffortPopover();
    });

    // V2.16-C: 单列紧凑 popover，上半模型下半推理等级
    this.modelEffortPopoverEl = this.modelEffortPickerEl.createDiv({
      cls: "llm-bridge-model-effort-popover llm-bridge-model-effort-popover-single",
      attr: { hidden: "" },
    });
    // 上半部分：模型
    const modelSection = this.modelEffortPopoverEl.createDiv({ cls: "llm-bridge-model-effort-section llm-bridge-model-list" });
    modelSection.createEl("div", { cls: "llm-bridge-model-effort-section-title", text: "Model" });
    this.modelOptionsEl = modelSection.createDiv({ cls: "llm-bridge-model-options" });
    // 下半部分：推理等级（使用原始名称，不中文化）
    const effortSection = this.modelEffortPopoverEl.createDiv({ cls: "llm-bridge-model-effort-section llm-bridge-effort-list" });
    effortSection.createEl("div", { cls: "llm-bridge-model-effort-section-title", text: "Effort" });
    this.effortOptionsEl = effortSection.createDiv({ cls: "llm-bridge-effort-options" });
    this.syncModelCatalogForCurrentAgent(false);
    this.renderModelEffortOptions();
    this.modelEffortPickerEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeModelEffortPopover();
    });
    this.registerDomEvent(document, "pointerdown", (event) => {
      if (this.isEventInsideSelector(event, ".llm-bridge-model-effort-picker")) return;
      this.closeModelEffortPopover();
      if (this.isEventInsideSelector(event, ".llm-bridge-permission-chip")) return;
      if (this.isEventInsideSelector(event, ".llm-bridge-perm-popover")) return;
      this.closePermissionPopover();
    });
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape") {
        this.closeModelEffortPopover();
        this.closePermissionPopover();
      }
    });
  }

  private async setModelEffort(model: string, effort: string): Promise<void> {
    if (this.runHandle) return;
    this.syncModelCatalogForCurrentAgent(false);
    // V2.16-C: 使用 catalog 归一化，不再依赖硬编码 MODEL_OPTIONS/EFFORT_OPTIONS
    const nextModel = normalizeModelValue(this.modelCatalog, model);
    const nextEffort = normalizeEffortValue(this.modelCatalog, effort);
    this.plugin.settings.model = nextModel;
    this.plugin.settings.effortLevel = nextEffort;
    await this.plugin.saveSettings();
    this.refreshAllChips();
  }

  private syncModelCatalogForCurrentAgent(normalizeSettings: boolean): boolean {
    this.modelCatalog = getRuntimeModelCatalogForAgent(this.getEffectiveModelCatalogAgent());
    if (!normalizeSettings) return false;
    const nextModel = normalizeModelValue(this.modelCatalog, this.plugin.settings.model);
    const nextEffort = normalizeEffortValue(this.modelCatalog, this.plugin.settings.effortLevel);
    const changed = nextModel !== this.plugin.settings.model || nextEffort !== this.plugin.settings.effortLevel;
    if (changed) {
      this.plugin.settings.model = nextModel;
      this.plugin.settings.effortLevel = nextEffort;
    }
    this.renderModelEffortOptions();
    return changed;
  }

  private getEffectiveModelCatalogAgent(): "claude" | "codex" | "custom" {
    const providerId = this.session?.providerId;
    if (providerId && /codex/.test(providerId)) return "codex";
    const mode = this.plugin.settings.backendMode;
    if (mode === "codex-managed-app-server" || mode === "codex-app-server-external" || mode === "codex-sdk") return "codex";
    if (mode === "auto" && /codex/i.test(this.actualRuntimeLabel)) return "codex";
    return this.plugin.settings.agentType;
  }

  private renderModelEffortOptions(): void {
    if (!this.modelOptionsEl || !this.effortOptionsEl) return;
    this.modelOptionsEl.empty();
    this.effortOptionsEl.empty();
    for (const model of this.modelCatalog.models) {
      const option = this.modelOptionsEl.createEl("button", {
        cls: "llm-bridge-model-option",
        text: model.label,
        attr: { "data-model": model.value },
      });
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closeModelEffortPopover();
        void this.setModelEffort(model.value, this.plugin.settings.effortLevel);
      });
    }
    for (const effort of this.modelCatalog.efforts) {
      const option = this.effortOptionsEl.createEl("button", {
        cls: "llm-bridge-effort-option",
        text: effort.label,
        attr: { "data-effort": effort.value },
      });
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closeModelEffortPopover();
        void this.setModelEffort(this.plugin.settings.model, effort.value);
      });
    }
  }

  private toggleModelEffortPopover(): void {
    if (!this.modelEffortPopoverEl) return;
    if (this.modelEffortPopoverEl.hasAttribute("hidden")) {
      this.modelEffortPopoverEl.removeAttribute("hidden");
      this.modelEffortPopoverEl.classList.add("is-open");
      this.modelEffortButtonEl?.setAttribute("aria-expanded", "true");
      this.effortChipEl?.setAttribute("aria-expanded", "true");
    } else {
      this.closeModelEffortPopover();
    }
  }

  private closeModelEffortPopover(): void {
    if (!this.modelEffortPopoverEl) return;
    this.modelEffortPopoverEl.setAttribute("hidden", "");
    this.modelEffortPopoverEl.classList.remove("is-open");
    this.modelEffortButtonEl?.setAttribute("aria-expanded", "false");
    this.effortChipEl?.setAttribute("aria-expanded", "false");
  }

  private refreshModelEffortPicker(): void {
    if (!this.modelEffortButtonEl) return;
    this.syncModelCatalogForCurrentAgent(false);
    this.renderModelEffortOptions();
    // V2.16-C: 从 catalog 读取 label，不再依赖硬编码列表
    const model = findModelEntry(this.modelCatalog, this.plugin.settings.model);
    const effort = findEffortEntry(this.modelCatalog, this.plugin.settings.effortLevel);
    const modelLabel = model?.label ?? this.plugin.settings.model ?? "unknown";
    const effortLabel = effort?.label ?? this.plugin.settings.effortLevel ?? "unknown";
    // V16.3 Round 3: 两个独立 chip 分别显示 model / effort
    this.modelEffortButtonEl.textContent = modelLabel;
    this.effortChipEl.textContent = effortLabel;
    const currentModelValue = model?.value ?? this.plugin.settings.model;
    const currentEffortValue = effort?.value ?? this.plugin.settings.effortLevel;
    this.modelEffortPopoverEl?.querySelectorAll<HTMLElement>(".llm-bridge-model-option").forEach((option) => {
      option.classList.toggle("is-active", option.getAttribute("data-model") === currentModelValue);
    });
    this.modelEffortPopoverEl?.querySelectorAll<HTMLElement>(".llm-bridge-effort-option").forEach((option) => {
      option.classList.toggle("is-active", option.getAttribute("data-effort") === currentEffortValue);
    });
  }

  private permissionModeShortLabel(): string {
    const mode = this.plugin.settings.claudePermissionMode ?? "default";
    if (mode === "plan") return "只读";
    if (mode === "default") return "询问";
    if (mode === "acceptEdits") return "自动编辑";
    if (mode === "auto") return "自动";
    if (mode === "bypassPermissions") return "完全访问";
    if (mode === "dontAsk") return "不询问";
    return mode;
  }

  private permissionModeIconName(mode: string): string {
    if (mode === "plan") return "lock";
    if (mode === "acceptEdits") return "file-check-2";
    if (mode === "auto") return "zap";
    if (mode === "bypassPermissions" || mode === "dontAsk") return "shield-alert";
    return "shield-question";
  }

  /**
   * V16.4-D: 渲染 permission mode popover（五模式，轻量 chip + popover）
   * 修复：popover 挂载到 leftTools 容器（按钮外部），避免 click 事件冒泡和 pointer-events 问题。
   */
  private renderPermissionPopover(): void {
    if (!this.permissionModePickerEl) return;
    // 移除旧 popover
    this.permissionPopoverEl?.remove();
    // V16.4-D: 挂载到 chip 的父容器（leftTools），不挂在 button 内部
    // 避免 click 冒泡到 button 导致 popover 关闭、pointer-events 被吞等问题
    const mountEl = this.permissionModeChipEl.parentElement ?? this.permissionModeChipEl;
    this.permissionPopoverEl = mountEl.createDiv({
      cls: "llm-bridge-perm-popover",
      attr: { hidden: "" },
    });
    this.permissionPopoverEl.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.permissionPopoverEl.addEventListener("click", (event) => event.stopPropagation());
    const modes: Array<{ value: string; icon: string; title: string; desc: string }> = [
      { value: "plan", icon: "lock", title: "计划模式", desc: "只读、规划、检查" },
      { value: "default", icon: "shield-question", title: "询问后编辑", desc: "编辑或高风险命令先确认" },
      { value: "acceptEdits", icon: "file-check-2", title: "自动接受编辑", desc: "文件修改自动通过，命令仍受控" },
      { value: "auto", icon: "zap", title: "低风险自动", desc: "低风险自动允许，敏感操作仍拦截" },
      { value: "bypassPermissions", icon: "shield-alert", title: "完全访问", desc: "跳过权限确认，仅用于可信任务" },
    ];
    const current = this.plugin.settings.claudePermissionMode ?? "default";
    const currentMode = modes.find((mode) => mode.value === current) ?? modes[1];
    const currentInfo = getPermissionModeInfo(current);
    const head = this.permissionPopoverEl.createDiv({ cls: "llm-bridge-perm-popover-head" });
    const headIcon = head.createEl("span", { cls: "llm-bridge-perm-popover-head-icon" });
    setIcon(headIcon, currentMode.icon);
    const headText = head.createDiv({ cls: "llm-bridge-perm-popover-head-text" });
    headText.createEl("strong", { text: "Codex 模式" });
    headText.createEl("span", { text: `${currentMode.title} · ${currentMode.desc}` });
    head.createEl("span", { cls: `llm-bridge-perm-popover-risk is-${currentInfo.level}`, text: currentInfo.level === "danger" ? "高风险" : currentInfo.level === "caution" ? "需确认" : "安全" });
    for (const mode of modes) {
      const opt = this.permissionPopoverEl.createEl("button", {
        cls: "llm-bridge-perm-option" + (current === mode.value ? " is-active" : ""),
        attr: { type: "button", "data-permission-mode": mode.value },
      });
      const optIcon = opt.createEl("span", { cls: "llm-bridge-perm-option-icon" });
      setIcon(optIcon, mode.icon);
      const text = opt.createDiv({ cls: "llm-bridge-perm-option-text" });
      text.createEl("div", { cls: "llm-bridge-perm-option-title", text: mode.title });
      text.createEl("div", { cls: "llm-bridge-perm-option-desc", text: mode.desc });
      opt.createEl("span", { cls: "llm-bridge-perm-option-check", text: "✓" });
      opt.addEventListener("pointerdown", (event) => event.stopPropagation());
      opt.addEventListener("click", async (event) => {
        event.stopPropagation();
        this.closePermissionPopover();
        await this.setPermissionMode(mode.value);
      });
    }
  }

  /**
   * V16.4-D: 打开/关闭 permission mode popover
   */
  private togglePermissionPopover(): void {
    if (!this.permissionPopoverEl) return;
    const hidden = this.permissionPopoverEl.hasAttribute("hidden");
    if (hidden) {
      this.closeModelEffortPopover();
      this.renderPermissionPopover();
      this.permissionPopoverEl.removeAttribute("hidden");
      this.permissionModeChipEl.setAttribute("aria-expanded", "true");
    } else {
      this.closePermissionPopover();
    }
  }

  /**
   * V16.4-D: 关闭 permission mode popover
   */
  private closePermissionPopover(): void {
    this.permissionPopoverEl?.setAttribute("hidden", "");
    this.permissionModeChipEl?.setAttribute("aria-expanded", "false");
  }

  /**
   * V16.4-D: 设置 permission mode — 允许在 run 进行中切换（影响下一次 run）
   */
  private async setPermissionMode(mode: string): Promise<void> {
    // V16.4-D: 移除 runHandle 阻塞 — 允许在 run 进行中切换权限（影响下一次 run）
    this.plugin.settings.claudePermissionMode = mode as never;
    await this.plugin.saveSettings();
    this.refreshPermissionModeChip();
    this.refreshStatusBar();
  }

  private refreshPermissionModeChip(): void {
    if (!this.permissionModeChipEl) return;
    const mode = this.plugin.settings.claudePermissionMode ?? "default";
    const info = getPermissionModeInfo(mode);
    const claudeLabel = this.permissionModeShortLabel();
    const iconName = this.permissionModeIconName(mode);
    this.permissionModeChipEl.empty();
    setIcon(this.permissionModeChipEl.createEl("span", { cls: "llm-bridge-permission-chip-icon" }), iconName);
    this.permissionModeChipEl.createEl("span", { cls: "llm-bridge-permission-chip-label", text: claudeLabel });
    this.permissionModeChipEl.setAttribute("aria-label", claudeLabel);
    this.permissionModeChipEl.setAttribute("title", `权限模式：${info.label}\n${info.risk}\n点击切换`);
    this.permissionModeChipEl.classList.remove("is-safe", "is-caution", "is-danger");
    this.permissionModeChipEl.classList.add(`is-${info.level}`);
  }

  private async cyclePermissionMode(): Promise<void> {
    // V16.4-D: 移除 runHandle 阻塞
    const modes: Array<"plan" | "default" | "acceptEdits" | "auto" | "bypassPermissions"> = ["plan", "default", "acceptEdits", "auto", "bypassPermissions"];
    const current = this.plugin.settings.claudePermissionMode ?? "default";
    const index = modes.indexOf(current as "plan" | "default" | "acceptEdits" | "auto" | "bypassPermissions");
    const next = modes[(index + 1 + modes.length) % modes.length];
    this.plugin.settings.claudePermissionMode = next;
    await this.plugin.saveSettings();
    this.refreshPermissionModeChip();
    this.refreshStatusBar();
  }

  async onClose(): Promise<void> {
    this.closeModelEffortPopover();
    this.closePermissionPopover();
    this.closeMentionPicker();
    if (this.runHandle) {
      this.runHandle.stop();
      this.runHandle = null;
    }
    // V2.9: 清理 pending 定时器，避免视图关闭后回调仍触发
    if (this.scrollRafId !== null) {
      window.cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }
    if (this.streamContentRafId !== null) {
      window.cancelAnimationFrame(this.streamContentRafId);
      this.streamContentRafId = null;
    }
    if (this.liveTimelineTimerId !== null) {
      window.clearTimeout(this.liveTimelineTimerId);
      this.liveTimelineTimerId = null;
    }
    if (this.historySearchDebounceTimer !== null) {
      window.clearTimeout(this.historySearchDebounceTimer);
      this.historySearchDebounceTimer = null;
    }
    this.clearExternalReadRequests();
    this.clearFileContext();
  }

  // ---------- 控件同步 ----------

  private syncControlsFromSettings(): void {
    this.refreshAllChips();
    this.includeNoteCheckEl.checked = this.plugin.settings.includeActiveNote;
    this.includeSelectionCheckEl.checked = this.plugin.settings.includeSelection;
  }

  // V2.10 (B-019): 设置页切换 backendMode 等关键设置后通知 view 刷新状态栏与控件
  // 解决 settings.ts onChange 只 saveSettings 不触发 view 刷新、状态栏 Backend 值不立即更新的问题
  public refreshOnSettingsChange(): void {
    this.syncControlsFromSettings();
    this.syncDeveloperRunFlowPanel();
    this.refreshStatusBar();
    this.refreshComposerStatusRail();
    if (this.messagesEl) this.renderMessagesFromHistory();
  }

  private syncDeveloperRunFlowPanel(): void {
    const chatPanel = this.tabPanels?.chat;
    if (!chatPanel) return;
    if (!this.plugin.settings.developerMode) {
      this.runFlowEl?.remove();
      this.runFlowEl = null;
      this.runFlowBody = null;
      this.runFlowToggle = null;
      return;
    }
    if (this.runFlowEl?.isConnected) return;
    const anchor = this.messagesEl?.isConnected ? this.messagesEl : null;
    this.renderRunFlowPanel(chatPanel);
    if (anchor && this.runFlowEl) chatPanel.insertBefore(this.runFlowEl, anchor);
  }

  private refreshModeOptions(): void {
    // 当前只 claude 支持模式概念；codex/custom 暂只 fresh
    if (this.plugin.settings.agentType !== "claude") {
      this.plugin.settings.sessionMode = "fresh";
      this.refreshAllChips();
    }
  }

  private openPluginSettings(): void {
    const appWithSettings = this.app as App & { setting?: { open: () => void; openTabById?: (id: string) => void } };
    appWithSettings.setting?.open();
    appWithSettings.setting?.openTabById?.(this.plugin.manifest.id);
  }

  private updateContextDisplay(): void {
    const f = this.getActiveFile();
    const activeFileName = f ? path.basename(f.path) : "";
    this.activeFileLabelEl.dataset.value = activeFileName;
    this.activeFileLabelEl.textContent = "";
    const sel = this.getSelection();
    if (sel) {
      this.selectionLabelEl.dataset.value = `${sel.length}c`;
      this.selectionLabelEl.textContent = "";
    } else {
      this.selectionLabelEl.dataset.value = "";
      this.selectionLabelEl.textContent = "";
    }
    // V16.3 Round 3: note tag title/文案统一由 refreshAllChips 处理（合并单 chip 语义）
    // 这里只刷新 chip 文案以立即反映文件名变化（不等异步 refreshContextMetrics）
    this.refreshAllChips();
    this.refreshComposerStatusRail();
    // P4-D: Selection tag — hide when no selection
    const selWrap = this.includeSelectionCheckEl.parentElement;
    if (selWrap) {
      if (sel) {
        selWrap.removeAttribute("hidden");
        const selTag = selWrap.querySelector<HTMLElement>(".llm-bridge-context-tag");
        if (selTag) selTag.setAttribute("title", `当前选区：${sel.length} chars`);
      } else {
        selWrap.setAttribute("hidden", "");
      }
    }
  }

  // V2.17-A Completion: 获取/缓存 BridgeSession（替代旧 getBackend）。
  // UI 不再直接构造 SdkBackend/ClaudeCliBackend/MockAgentBackend；provider 选择由
  // createBridgeSession 按 settings.backendMode + provider 可用性决定。
  // codex-app-server 在 auto 模式下优先（primary target）。
  private getSession(): BridgeSessionImpl {
    const mode = this.plugin.settings.backendMode;
    if (this.session && this.sessionMode === mode) {
      // V16.4-F2: permissionMode 切换后，在无 run 进行时重建 PermissionBoundary（下一次 run 生效）
      this.session.rebuildPermissionBoundary(this.plugin.settings);
      return this.session;
    }
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const sess = createBridgeSession(
      `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      this.plugin.settings,
      vaultPath,
      // V17-F1.1 任务 C：注入 pluginDir（main.ts onload 时从 manifest.dir 获取）
      this.plugin.pluginDir,
    );
    // V2.17-A Completion: provider session persistence
    // 重建 BridgeSession 时把持久化的 providerThreadId/SessionId 回填到 provider sessionMapper，
    // 使下一次 resume() 命中 thread/resume 路径而不是隐式新开 thread。
    if (this.restoredProviderThreadId || this.restoredProviderSessionId) {
      sess.restoreProviderSession(this.restoredProviderThreadId, this.restoredProviderSessionId);
    }
    this.session = sess;
    this.sessionMode = mode;
    this.actualRuntimeLabel = sess.displayLabel;
    return sess;
  }

  private getManagedRuntimeInstallStatusForCurrentMode(): ManagedRuntimeInstallStatus | null {
    const mode = this.plugin.settings.backendMode;
    if (mode !== "auto" && mode !== "codex-managed-app-server") return null;
    if (typeof this.plugin.getManagedRuntimeInstallStatus !== "function") return null;
    return this.plugin.getManagedRuntimeInstallStatus();
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

  private refreshManagedRuntimeInstallAction(status: ManagedRuntimeInstallStatus | null): void {
    if (!this.runtimeInstallBtnEl) return;
    if (status?.required) {
      this.runtimeInstallBtnEl.removeAttribute("hidden");
      this.runtimeInstallBtnEl.disabled = false;
      this.runtimeInstallBtnEl.textContent = "Install Codex runtime";
      this.runtimeInstallBtnEl.setAttribute("title", this.formatRuntimeInstallTitle(status));
    } else {
      this.runtimeInstallBtnEl.setAttribute("hidden", "");
      this.runtimeInstallBtnEl.disabled = false;
      this.runtimeInstallBtnEl.textContent = "Install Codex runtime";
      if (status) this.runtimeInstallBtnEl.setAttribute("title", this.formatRuntimeInstallTitle(status));
    }
  }

  private async installManagedRuntimeFromUi(): Promise<void> {
    if (!this.runtimeInstallBtnEl || this.runtimeInstallBtnEl.disabled) return;
    const before = this.getManagedRuntimeInstallStatusForCurrentMode();
    if (!before?.required) {
      this.refreshStatusBar();
      return;
    }
    this.runtimeInstallBtnEl.disabled = true;
    this.runtimeInstallBtnEl.textContent = "Installing...";
    this.runtimeInstallBtnEl.setAttribute("title", this.formatRuntimeInstallTitle(before));
    const result = await this.plugin.ensureManagedRuntimeInstalled({ confirm: true });
    if (result.status === "installed" || result.status === "already-installed") {
      this.session = null;
      this.sessionMode = null;
      new Notice("Codex runtime installed");
    } else {
      new Notice(`Codex runtime install failed: ${result.error || result.status}`);
    }
    this.refreshStatusBar();
  }

  private setGlobalStatus(status: RunStatus): void {
    const runtimeLabel = this.actualRuntimeLabel;
    const installStatus = this.getManagedRuntimeInstallStatusForCurrentMode();
    const runtimeState = installStatus?.required
      ? "install required"
      : status === "failed" ? "失败" : status === "running" ? "运行中" : "已连接";
    this.statusLabelEl.textContent = `${installStatus?.required ? "Codex runtime" : runtimeLabel} · ${runtimeState}`;
    this.statusDotEl.className = `llm-bridge-status-dot llm-bridge-status-dot-${status}`;
    this.statusDotEl.setAttribute("title", installStatus?.required ? this.formatRuntimeInstallTitle(installStatus) : STATUS_LABEL[status]);
    this.refreshManagedRuntimeInstallAction(installStatus);
    const running = status === "running";
    // 停止按钮只在运行中显示，发送按钮反之
    this.stopBtn.style.display = running ? "inline-flex" : "none";
    this.sendBtn.style.display = running ? "none" : "inline-flex";
    this.sendBtn.disabled = running;
    // 禁用所有 chip 与 agent 下拉
    const allChips = this.contentEl.querySelectorAll(".llm-bridge-chip, .llm-bridge-agent-select, .llm-bridge-composer-tool-btn, .llm-bridge-command-menu-item, .llm-bridge-permission-chip, .llm-bridge-model-effort-chip, .llm-bridge-model-option, .llm-bridge-effort-option");
    allChips.forEach((c) => {
      (c as HTMLButtonElement).disabled = running;
    });
    this.includeNoteCheckEl.disabled = running;
    this.includeSelectionCheckEl.disabled = running;
    this.clearBtn.disabled = running;
    // V1.1: 运行中禁用 preflight 按钮
    this.preflightBtn.disabled = running;
    // V2.0: 同步会话状态
    this.sessionState = updateSession(this.sessionState, { status });
    this.refreshSessionState();
  }

  // V1.1: 刷新状态栏（Backend 模式 / Agent / cwd / Preflight 状态）
  // V2.3: 新增权限策略 / 工具步骤 / agent 计数
  // V2.16-B: runtime status 显示实际 backend（SDK / Claude Code fallback / Claude Code / SDK unavailable）
  private refreshStatusBar(): void {
    const s = this.plugin.settings;
    // Backend 模式（配置值）
    const backendLabel = s.backendMode;
    this.statusBackendEl.querySelector(".llm-bridge-sb-value")!.textContent = backendLabel;
    // Agent 类型
    const agentLabel = AGENT_OPTIONS.find((a) => a.value === s.agentType)?.label ?? s.agentType;
    this.statusAgentEl.querySelector(".llm-bridge-sb-value")!.textContent = agentLabel;
    // V2.17-A Completion: runtime label 由 BridgeSession.selectProvider 决定
    // （codex-app-server 在 auto 模式下优先；不可用回退 SDK / CLI）。
    // 不再在 view.ts 直接探测 isSdkAvailable。
    const runtimeLabel = this.getSession().displayLabel;
    this.actualRuntimeLabel = runtimeLabel;
    // V2.16-D: runtime status 缩成 pill（简短英文：SDK · ready / running / error）
    const installStatus = this.getManagedRuntimeInstallStatusForCurrentMode();
    const runtimeState = installStatus?.required
      ? "install required"
      : this.sessionState.status === "failed" ? "error" : this.sessionState.status === "running" ? "running" : "ready";
    this.statusLabelEl.textContent = `${installStatus?.required ? "Codex runtime" : runtimeLabel} · ${runtimeState}`;
    this.statusDotEl.setAttribute("title", installStatus?.required ? this.formatRuntimeInstallTitle(installStatus) : STATUS_LABEL[this.sessionState.status] || "Runtime status");
    this.refreshManagedRuntimeInstallAction(installStatus);
    // Cwd（Vault 根目录）— getBasePath 运行时存在但类型未声明，用 as 绕过
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    // 只显示最后两级目录，避免过长
    const shortPath = vaultPath.split(/[/\\]/).slice(-2).join("/");
    this.statusCwdEl.querySelector(".llm-bridge-sb-value")!.textContent = shortPath;
    this.statusCwdEl.setAttribute("title", vaultPath);
    // Preflight 状态
    const pfStatus = mapPreflightToStatus(this.lastPreflightResult);
    const pfValueEl = this.statusPreflightEl.querySelector(".llm-bridge-sb-value")!;
    pfValueEl.textContent = pfStatus.label;
    this.statusPreflightEl.setAttribute("title", pfStatus.detail);
    // 状态着色
    this.statusPreflightEl.classList.remove("is-available", "is-unavailable", "is-unknown");
    this.statusPreflightEl.classList.add(`is-${pfStatus.kind}`);
    // V2.3: 权限策略
    const policy = s.permissionPolicy ?? "medium";
    this.statusPermissionEl.querySelector(".llm-bridge-sb-value")!.textContent = policy;
    const policyDesc = policy === "low" ? "宽松（medium 自动允许）" : policy === "high" ? "严格（读操作需确认）" : "默认（读允许，写本轮授权）";
    this.statusPermissionEl.setAttribute("title", `权限策略：${policyDesc}`);
    this.statusPermissionEl.classList.remove("is-low", "is-medium", "is-high");
    this.statusPermissionEl.classList.add(`is-${policy}`);
    // V2.3s: 权限模式（SDK permissionMode + 中文风险解释）
    const permMode = s.claudePermissionMode ?? "default";
    const permModeInfo = getPermissionModeInfo(permMode);
    this.statusPermModeEl.querySelector(".llm-bridge-sb-value")!.textContent = permModeInfo.label;
    this.statusPermModeEl.setAttribute("title", `权限模式：${permModeInfo.label}\n${permModeInfo.risk}`);
    this.statusPermModeEl.classList.remove("is-safe", "is-caution", "is-danger");
    this.statusPermModeEl.classList.add(`is-${permModeInfo.level}`);
    // V2.3: 最近一次 SDK 运行的工具步骤与 agent 数
    this.statusToolsEl.querySelector(".llm-bridge-sb-value")!.textContent = String(this.lastSdkToolCount);
    this.statusToolsEl.setAttribute("title", `最近一次 SDK 运行：${this.lastSdkToolCount} 个工具步骤`);
    this.statusAgentsEl.querySelector(".llm-bridge-sb-value")!.textContent = String(this.lastSdkAgentCount);
    this.statusAgentsEl.setAttribute("title", `最近一次 SDK 运行：${this.lastSdkAgentCount} 个 agent 实例（主+子）`);
  }

  // V2.3: 更新最近一次 SDK 运行统计（工具步骤数 + agent 实例数）
  private updateLastSdkStats(events: ReadonlyArray<WorkflowEvent>): void {
    this.lastSdkToolCount = events.filter((e) => e.type === "tool_start").length;
    // agent 实例数：从 tool_start + message 事件的 (sessionId, parentToolUseId) 去重
    const agentKeys = new Set<string>();
    for (const e of events) {
      if (e.type !== "message" && e.type !== "tool_start") continue;
      const isMain = !e.parentToolUseId;
      const key = isMain ? `main:${e.sessionId ?? ""}` : `sub:${e.sessionId ?? ""}:${e.parentToolUseId ?? ""}`;
      agentKeys.add(key);
    }
    this.lastSdkAgentCount = agentKeys.size;
    this.refreshStatusBar();
  }

  // V2.3s: 刷新权限请求面板（实时展示 pending 权限请求）
  // V16.4-E: approval 决策固定在 composer 上方，assistant turn 只展示状态。
  // V16.5-B: 主数据源切换为 PermissionBoundary.pending；pendingPermissions 仅作 UI 显示缓存。
  private refreshPermissionPanel(): void {
    const panel = this.permissionPanelEl;
    panel.empty();

    // V16.5-B: PermissionBoundary.pending 作为主状态源；同步 pendingPermissions 缓存
    const permission = this.getSession().permission;
    const boundaryPending = permission.pending;

    if (!this.runHandle && boundaryPending.size === 0 && this.staleApprovalRequestIds.size > 0) {
      this.staleApprovalRequestIds.clear();
      this.pendingPermissions.clear();
    }

    // 清理 staleApprovalRequestIds 中已不在 boundary pending 的项（避免累积）
    // 同时同步 pendingPermissions：boundary 中已消失的 requestId 从缓存删除
    for (const cachedId of Array.from(this.pendingPermissions.keys())) {
      if (!boundaryPending.has(cachedId) && !this.staleApprovalRequestIds.has(cachedId)) {
        this.pendingPermissions.delete(cachedId);
      }
    }
    // boundary 中存在但 pendingPermissions 未缓存的：从 ApprovalRequest 派生 PermissionEvent
    for (const [id, req] of boundaryPending) {
      if (!this.pendingPermissions.has(id)) {
        this.pendingPermissions.set(id, {
          type: "permission",
          timestamp: new Date().toISOString(),
          toolName: req.toolName,
          description: req.description,
          granted: false,
          pending: true,
          requestId: req.requestId,
          riskLevel: req.riskLevel,
          riskReason: req.riskReason,
          highRiskFlags: req.highRiskFlags ? Array.from(req.highRiskFlags) : undefined,
          inputSummary: req.inputSummary,
          mergeKey: req.mergeKey,
          parentToolUseId: req.parentToolUseId,
          subagentRisk: req.subagentRisk,
        } as PermissionEvent);
      }
    }

    // V16.5-B: 渲染 stale card（独立于主 approval card，便于用户 dismiss）
    if (this.staleApprovalRequestIds.size > 0) {
      const staleIds = Array.from(this.staleApprovalRequestIds);
      for (const staleId of staleIds) {
        const cached = this.pendingPermissions.get(staleId);
        const toolName = cached?.toolName ?? "unknown";
        const staleCard = panel.createDiv({ cls: "llm-bridge-approval-card is-stale" });
        const header = staleCard.createDiv({ cls: "llm-bridge-approval-card-header" });
        const titleEl = header.createDiv({ cls: "llm-bridge-approval-card-title" });
        const titleIcon = titleEl.createEl("span", { cls: "llm-bridge-approval-card-title-icon" });
        setIcon(titleIcon, "alert-triangle");
        titleEl.createEl("span", { text: `Stale approval: ${this.buildApprovalCardTitle(toolName)}` });
        const body = staleCard.createDiv({ cls: "llm-bridge-approval-card-body" });
        body.createDiv({
          cls: "llm-bridge-approval-card-row llm-bridge-approval-card-row-stale",
          text: "This approval request is no longer active. It may have been resolved by another path or the run was cancelled.",
        });
        const btns = staleCard.createDiv({ cls: "llm-bridge-approval-card-btns" });
        const dismissBtn = btns.createEl("button", { cls: "llm-bridge-approval-btn is-dismiss-stale", text: "Dismiss" });
        dismissBtn.addEventListener("click", () => {
          this.staleApprovalRequestIds.delete(staleId);
          this.pendingPermissions.delete(staleId);
          this.refreshPermissionPanel();
        });
        const stopBtn = btns.createEl("button", { cls: "llm-bridge-approval-btn is-stop-run", text: "Stop" });
        stopBtn.addEventListener("click", () => {
          this.staleApprovalRequestIds.delete(staleId);
          this.pendingPermissions.delete(staleId);
          this.getSession().permission.cancelAllPending();
          this.refreshPermissionPanel();
          this.stop();
        });
      }
    }

    // 主 approval card：boundary pending 为空且无 stale 时隐藏
    if (boundaryPending.size === 0) {
      // V16.5-B: 仅当无 stale card 时才隐藏面板
      if (this.staleApprovalRequestIds.size === 0) {
        panel.style.display = "none";
        this.composerBarEl?.removeClass("is-approval-active");
      } else {
        panel.style.display = "block";
        this.composerBarEl?.addClass("is-approval-active");
      }
      return;
    }

    // V16.4-H: user input 优先级守卫 — 若 user input 同时 pending，则隐藏 approval panel
    // （pending request 仍保留在 boundary.pending，不丢失；user input 解析后再刷新）
    if (this.getSession().userInput.pending.size > 0) {
      panel.style.display = "none";
      this.composerBarEl?.removeClass("is-approval-active");
      return;
    }

    panel.style.display = "block";
    this.composerBarEl?.addClass("is-approval-active");

    // 按 mergeKey 合并展示（相同工具+风险+路径前缀合并）
    const mergeGroups = new Map<string, PermissionEvent[]>();
    for (const [, ev] of this.pendingPermissions) {
      // V16.5-B: 只渲染 boundary 中仍 pending 的 requestId（stale 的已单独渲染）
      if (!boundaryPending.has(ev.requestId ?? "")) continue;
      const key = ev.mergeKey ?? ev.requestId ?? "unknown";
      if (!mergeGroups.has(key)) mergeGroups.set(key, []);
      mergeGroups.get(key)!.push(ev);
    }

    if (mergeGroups.size === 0) {
      // boundary 有 pending 但缓存未同步（理论不应发生），不渲染主卡片
      return;
    }

    const groups = Array.from(mergeGroups.values());
    const totalGroups = groups.length;

    // V16.4-F: Codex-style approval card（单卡片为主，多卡片显示 queue count）
    const card = panel.createDiv({ cls: "llm-bridge-approval-card" });

    // ---- Card header: title + queue count + Cancel × ----
    const cardHeader = card.createDiv({ cls: "llm-bridge-approval-card-header" });
    const titleEl = cardHeader.createDiv({ cls: "llm-bridge-approval-card-title" });
    const titleIcon = titleEl.createEl("span", { cls: "llm-bridge-approval-card-title-icon" });
    const first = groups[0][0];
    const riskLevel = first.riskLevel ?? "low";
    setIcon(titleIcon, riskLevel === "high" ? "alert-triangle" : "shield");
    const cardTitle = this.buildApprovalCardTitle(first.toolName);
    titleEl.createEl("span", { text: cardTitle });
    if (totalGroups > 1) {
      cardHeader.createEl("span", { cls: "llm-bridge-approval-card-queue", text: `1 of ${totalGroups}` });
    }
    // V16.5-B: 右上角 Cancel × 按钮（映射为 decline）
    const cancelBtn = cardHeader.createEl("button", { cls: "llm-bridge-approval-card-cancel", attr: { "aria-label": "取消请求", title: "取消本次请求（拒绝一次）" } });
    setIcon(cancelBtn, "x");
    cancelBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const requestIds = groups[0].map((g) => g.requestId!).filter(Boolean);
      this.resolvePermissionRequests(requestIds, "deny_once");
    });

    // ---- Card body: command/path/reason/risk 直接展示 ----
    const body = card.createDiv({ cls: "llm-bridge-approval-card-body" });
    const inputSummary = this.sanitizeUserFacingSummaryText(first.inputSummary);
    const label = approvalDisplayLabel(first.toolName, inputSummary, first.description);
    if (!inputSummary || label.trim().toLowerCase() !== inputSummary.trim().toLowerCase()) {
      body.createDiv({ cls: "llm-bridge-approval-card-row llm-bridge-approval-card-row-label", text: label });
    }
    if (inputSummary) {
      body.createDiv({ cls: "llm-bridge-approval-card-row llm-bridge-approval-card-row-command", text: inputSummary, attr: { title: inputSummary } });
    }
    const badges = body.createDiv({ cls: "llm-bridge-approval-card-badges" });
    badges.createEl("span", {
      cls: `llm-bridge-approval-card-badge is-risk-${riskLevel}`,
      text: riskLevel === "high" ? "高风险" : riskLevel === "medium" ? "需确认" : "低风险",
    });
    for (const flag of first.highRiskFlags ?? []) {
      badges.createEl("span", {
        cls: "llm-bridge-approval-card-badge is-flag",
        text: flag.replace(/[_-]+/g, " "),
      });
    }
    if (first.parentToolUseId) {
      badges.createEl("span", { cls: "llm-bridge-approval-card-badge is-subagent", text: "subagent" });
    }
    if (first.riskReason) {
      body.createDiv({
        cls: `llm-bridge-approval-card-row llm-bridge-approval-card-row-risk is-risk-${riskLevel}`,
        text: first.riskReason,
      });
    }
    if (first.subagentRisk) {
      body.createDiv({ cls: "llm-bridge-approval-card-row llm-bridge-approval-card-row-subagent", text: first.subagentRisk });
    }
    if (first.parentToolUseId) {
      body.createDiv({ cls: "llm-bridge-approval-card-row llm-bridge-approval-card-row-subagent", text: `Parent tool: ${first.parentToolUseId}` });
    }

    // ---- Developer mode: raw/provider details ----
    if (this.plugin.settings.developerMode) {
      const devDetails = card.createEl("details", { cls: "llm-bridge-approval-card-dev-details" });
      devDetails.createEl("summary", { text: "Raw details (developer)" });
      const devBody = devDetails.createDiv({ cls: "llm-bridge-approval-card-dev-body" });
      devBody.createDiv({ cls: "llm-bridge-approval-card-dev-line", text: `tool: ${first.toolName}` });
      devBody.createDiv({ cls: "llm-bridge-approval-card-dev-line", text: `requestId: ${first.requestId ?? "n/a"}` });
      devBody.createDiv({ cls: "llm-bridge-approval-card-dev-line", text: `mergeKey: ${first.mergeKey ?? "n/a"}` });
      devBody.createDiv({ cls: "llm-bridge-approval-card-dev-line", text: `riskLevel: ${riskLevel}` });
      if (first.inputSummary) devBody.createDiv({ cls: "llm-bridge-approval-card-dev-line", text: `inputSummary: ${first.inputSummary}` });
    }

    // ---- Decision buttons: 语义化文案 + V16.5-B resolving 状态 ----
    const btns = card.createDiv({ cls: "llm-bridge-approval-card-btns" });
    const requestIds = groups[0].map((g) => g.requestId!).filter(Boolean);
    const isResolving = this.resolvingApprovalRequestId !== null
      && requestIds.includes(this.resolvingApprovalRequestId);

    const createApprovalButton = (cls: string, label: string, resolvingLabel: string, choice: PermissionChoice): HTMLButtonElement => {
      const btn = btns.createEl("button", {
        cls: `llm-bridge-approval-btn ${cls}${isResolving ? " is-resolving" : ""}`,
        text: isResolving ? resolvingLabel : label,
        attr: isResolving ? { disabled: "true" } : {},
      });
      if (!isResolving) {
        btn.addEventListener("click", () => this.resolvePermissionRequests(requestIds, choice));
      }
      return btn;
    };

    createApprovalButton("is-proceed", "允许一次", "正在允许…", "allow_once");
    createApprovalButton("is-proceed-session", "本会话允许", "正在允许…", "allow_session");
    createApprovalButton("is-decline", "拒绝一次", "正在跳过…", "deny_once");
    createApprovalButton("is-decline-session", "本会话拒绝", "正在拒绝…", "deny_session");
  }

  /**
   * V16.4-G: 统一运行状态文本渲染（Codex-style glow text）。
   *
   * - kind="running": shimmer/glow text（Thinking / Reading <file> / Running command / Editing <file>）
   * - kind="blocked": 无 shimmer（Needs approval / Needs input）
   * - kind="completed": 无 shimmer（静态文本）
   *
   * 取代旧 .llm-bridge-msg-spinner / .llm-bridge-turn-header-spinner 旋转圈。
   * prefers-reduced-motion: reduce 时由 CSS 降级为静态文字。
   */
  private renderRunStatusText(parent: HTMLElement, text: string, kind: "running" | "blocked" | "completed"): void {
    const statusEl = parent.createEl("span", {
      cls: `llm-bridge-run-status-text is-${kind}`,
      text,
    });
    if (kind === "running") {
      statusEl.addClass("llm-bridge-run-glow");
    }
  }

  /**
   * V16.5-D: 从当前 session/provider/settings 派生真实 runtime capabilities。
   *
   * 主路径在 buildBridgePromptPackage 调用前构造一次，注入 prompt 作为 facts。
   * 不臆造可用性；Obsidian CLI 默认 "unknown"（未探测），由 LLM 按需 probe。
   */
  private buildRuntimeCapabilities(providerId: string, settings: LLMBridgeSettings): ProviderCapabilityInfo {
    // provider-native file tools: claude-sdk / codex-app-server / claude-cli 都提供
    // Read/Write/Edit/Glob/Grep；mock 保守返回 true（测试可控）。
    // V17-A: pi-rpc 是 portable backend spike，不提供 native write/edit/bash 直通
    // （写操作必须回到 Bridge approval card），providerNativeFileTools=false。
    // V17-B: pi-sdk 同样不提供 native write 直通 — 写操作走 Bridge-controlled custom tools。
    const providerNativeFileTools = providerId === "claude-sdk"
      || providerId === "codex-app-server"
      || providerId === "codex-managed-app-server"
      || providerId === "claude-cli"
      || providerId === "mock";
    // bridge runtime file tools: 由 createRuntimeFileToolAdapter 提供（read-only adapter）
    const bridgeRuntimeFileTools = true;
    // shell: PermissionBoundary 支持 command execution approval（host approval 拦截）
    const shellAvailable = true;
    // Obsidian CLI: 不做启动期 probe（避免阻塞 run）；默认 unknown，LLM 按需 probe
    const obsidianCliAvailable: ObsidianCliAvailability = "unknown";
    // AskUserQuestion: UserInputBoundary 始终可用
    const askUserQuestionAvailable = true;
    const managedCodexPlugins: ProviderRuntimeSkillEntry[] = providerId === "codex-managed-app-server"
      ? this.managedCodexPlugins.map((plugin) => {
        const presentation = this.describeComposerManagedCodexPlugin(plugin);
        return {
          id: plugin.pluginId,
          name: presentation.label,
          description: presentation.description,
          source: `${plugin.marketplaceName} · ${plugin.version}`,
          enabled: plugin.enabled,
        };
      })
      : [];
    const managedCodexPluginSkills: ProviderRuntimeSkillEntry[] = providerId === "codex-managed-app-server"
      ? this.managedCodexPlugins.flatMap((plugin) =>
        plugin.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: `${plugin.name} · ${plugin.marketplaceName}`,
          enabled: plugin.enabled,
        }))
      )
      : [];
    const exposeRuntimeSkillsInPrompt = providerId !== "codex-managed-app-server";
    return {
      providerNativeFileTools,
      bridgeRuntimeFileTools,
      shellAvailable,
      obsidianCliAvailable,
      askUserQuestionAvailable,
      runtimeSkills: exposeRuntimeSkillsInPrompt && (managedCodexPlugins.length > 0 || managedCodexPluginSkills.length > 0)
        ? {
          managedCodexPlugins,
          managedCodexPluginSkills,
          agentSkills: [],
          evidence: "managed runtime plugin list + plugin skills/SKILL.md",
        }
        : undefined,
      evidence: {
        provider: providerId,
        runtimeFileToolAdapter: bridgeRuntimeFileTools ? "available" : "unavailable",
        shellApprovalSupported: shellAvailable,
        obsidianCliProbe: "not-probed",
      },
    };
  }

  private getAgentSkillsForRuntimeCapabilities(): AgentSkillRecord[] {
    try {
      const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      const manifest = loadAgentSkillsManifestSync(vaultPath);
      if (manifest.skills.length > 0) {
        this.agentSkills = manifest.skills.slice();
        return this.agentSkills;
      }
    } catch {
      // Keep the in-memory cache as a fallback; prompt construction should not fail on manifest IO.
    }
    return this.agentSkills.slice();
  }

  /** V16.4-F: 按工具类型生成语义化 card title（V16.5-C: 复用 normalizeToolName 归一 command execution） */
  private buildApprovalCardTitle(toolName: string): string {
    // V16.5-C: 复用 sdkPermission.normalizeToolName — bash/Bash/command/shell/terminal/
    // RunCommand/CommandExecution/command_execution/exec/execute 都归一为 "Bash"。
    const normalized = normalizeToolName(toolName);
    if (normalized === "Bash") {
      return "运行这条命令？";
    }
    const lower = normalized.toLowerCase();
    if (lower === "write" || lower === "edit" || lower === "multiedit" || lower === "filechange" || lower === "create_file" || lower === "edit_file" || lower === "str_replace" || lower === "insert") {
      return "应用这些编辑？";
    }
    if (lower === "permission" || lower === "grant") {
      return "授予这些权限？";
    }
    return "继续执行？";
  }

  private refreshUserInputPanel(): void {
    const panel = this.userInputPanelEl;
    panel.empty();

    const pending = Array.from(this.getSession().userInput.pending.values());
    if (pending.length === 0) {
      panel.style.display = "none";
      this.composerBarEl?.removeClass("is-user-input-active");
      return;
    }

    panel.style.display = "block";
    this.composerBarEl?.addClass("is-user-input-active");

    for (const req of pending) {
      const seg: UserInputRequestSegment = {
        requestId: req.requestId,
        toolName: req.toolName,
        prompt: req.prompt,
        timestamp: new Date().toISOString(),
        inputType: req.inputType,
        questions: req.questions,
        placeholder: req.placeholder,
        pending: true,
      };
      this.renderClarificationUserInputRequest(panel, seg, pending.length);
    }
  }

  private renderClarificationUserInputRequest(
    parent: HTMLElement,
    req: UserInputRequestSegment,
    total: number,
  ): void {
    const draft = this.getUserInputDraft(req.requestId);
    const questions = this.getClarificationQuestions(req);
    const totalSteps = questions.length + 1;
    draft.stepIndex = Math.max(0, Math.min(draft.stepIndex, totalSteps - 1));
    const isSupplementStep = draft.stepIndex >= questions.length;
    const currentQuestion = isSupplementStep ? undefined : questions[draft.stepIndex];
    const card = parent.createDiv({ cls: `llm-bridge-clarification-card is-step-${draft.stepIndex + 1}` });
    const header = card.createDiv({ cls: "llm-bridge-clarification-head" });
    const title = header.createEl("div", {
      cls: "llm-bridge-clarification-title",
      text: isSupplementStep
        ? "补充信息（可选）"
        : currentQuestion?.header ?? req.prompt,
    });
    title.setAttribute("title", isSupplementStep ? req.prompt : currentQuestion?.question ?? req.prompt);
    const nav = header.createDiv({ cls: "llm-bridge-clarification-nav" });
    const up = nav.createEl("button", { cls: "llm-bridge-clarification-icon-btn", attr: { type: "button", title: "上一步" } });
    setIcon(up, "chevron-up");
    up.toggleAttribute("disabled", draft.stepIndex === 0);
    up.addEventListener("click", (event) => {
      event.stopPropagation();
      draft.stepIndex = Math.max(0, draft.stepIndex - 1);
      this.refreshUserInputPanel();
    });
    nav.createEl("span", { cls: "llm-bridge-clarification-step", text: `${draft.stepIndex + 1} of ${totalSteps}` });
    const down = nav.createEl("button", { cls: "llm-bridge-clarification-icon-btn", attr: { type: "button", title: "下一步" } });
    setIcon(down, "chevron-down");
    down.toggleAttribute("disabled", draft.stepIndex >= totalSteps - 1);
    down.addEventListener("click", (event) => {
      event.stopPropagation();
      draft.stepIndex = Math.min(totalSteps - 1, draft.stepIndex + 1);
      this.refreshUserInputPanel();
    });
    const close = nav.createEl("button", { cls: "llm-bridge-clarification-close", attr: { type: "button", title: "取消" } });
    setIcon(close, "x");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      this.resolveUserInputRequest(req.requestId, { type: "cancel" });
    });

    if (total > 1) {
      card.createDiv({ cls: "llm-bridge-clarification-count", text: `${total} pending questions` });
    }

    if (currentQuestion) {
      this.renderClarificationChoiceStep(card, req, draft, questions, currentQuestion, totalSteps);
    } else {
      this.renderClarificationSupplementStep(card, req, draft, questions);
    }
  }

  private renderClarificationChoiceStep(
    card: HTMLElement,
    req: UserInputRequestSegment,
    draft: UserInputDraft,
    questions: ReadonlyArray<UserInputQuestion>,
    question: UserInputQuestion,
    totalSteps: number,
  ): void {
    const body = card.createDiv({ cls: "llm-bridge-clarification-choice-body" });
    if (question.question && question.question !== req.prompt) {
      body.createDiv({ cls: "llm-bridge-clarification-question", text: question.question });
    }

    const multiSelect = this.isMultiSelectQuestion(question);
    const pageCount = Math.max(1, Math.ceil(question.options.length / USER_INPUT_OPTIONS_PER_PAGE));
    const pageIndex = Math.max(0, Math.min(draft.optionPages[question.id] ?? 0, pageCount - 1));
    draft.optionPages[question.id] = pageIndex;
    const visibleOptions = question.options.slice(
      pageIndex * USER_INPUT_OPTIONS_PER_PAGE,
      (pageIndex + 1) * USER_INPUT_OPTIONS_PER_PAGE,
    );

    for (const option of visibleOptions) {
      const optionValue = option.value ?? option.label;
      const selectedValues = this.normalizeUserInputSelection(draft.selections[question.id]);
      const selected = selectedValues.includes(optionValue);
      const row = body.createEl("button", {
        cls: `llm-bridge-clarification-option${selected ? " is-selected" : ""}${multiSelect ? " is-multi" : " is-single"}`,
        attr: { type: "button" },
      });
      row.createEl("span", { cls: "llm-bridge-clarification-option-label", text: option.label });
      if (option.description) {
        row.createEl("span", { cls: "llm-bridge-clarification-option-desc", text: option.description });
      }
      const enter = row.createEl("span", { cls: "llm-bridge-clarification-option-enter" });
      setIcon(enter, selected ? "check" : multiSelect ? "plus" : "corner-down-left");
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        draft.customInputs[question.id] = "";
        if (multiSelect) {
          const nextValues = selected
            ? selectedValues.filter((value) => value !== optionValue)
            : [...selectedValues, optionValue];
          draft.selections[question.id] = nextValues;
        } else {
          draft.selections[question.id] = optionValue;
          draft.value = this.composeUserInputDraftValue(questions, draft.selections, draft.customInputs);
          draft.stepIndex = Math.min(totalSteps - 1, draft.stepIndex + 1);
        }
        draft.value = this.composeUserInputDraftValue(questions, draft.selections, draft.customInputs);
        this.refreshUserInputPanel();
      });
    }

    if (pageCount > 1) {
      const pager = body.createDiv({ cls: "llm-bridge-clarification-option-pages" });
      const prev = pager.createEl("button", { cls: "llm-bridge-clarification-page-btn", text: "上一组选项", attr: { type: "button" } });
      prev.toggleAttribute("disabled", pageIndex === 0);
      prev.addEventListener("click", () => {
        draft.optionPages[question.id] = Math.max(0, pageIndex - 1);
        this.refreshUserInputPanel();
      });
      pager.createEl("span", { cls: "llm-bridge-clarification-page-count", text: `${pageIndex + 1}/${pageCount}` });
      const nextPage = pager.createEl("button", { cls: "llm-bridge-clarification-page-btn", text: "下一组选项", attr: { type: "button" } });
      nextPage.toggleAttribute("disabled", pageIndex >= pageCount - 1);
      nextPage.addEventListener("click", () => {
        draft.optionPages[question.id] = Math.min(pageCount - 1, pageIndex + 1);
        this.refreshUserInputPanel();
      });
    }

    const otherRow = body.createDiv({ cls: "llm-bridge-clarification-other-row" });
    otherRow.createEl("span", { cls: "llm-bridge-clarification-other-label", text: "其他" });
    const otherInput = otherRow.createEl("input", {
      cls: "llm-bridge-clarification-other-input",
      attr: {
        type: "text",
        placeholder: req.placeholder ?? "请输入",
        maxlength: "500",
        value: draft.customInputs[question.id] ?? "",
      },
    });
    otherRow.createEl("span", {
      cls: "llm-bridge-clarification-char-count",
      text: `${otherInput.value.length}/500`,
    });
    otherInput.addEventListener("input", () => {
      draft.customInputs[question.id] = otherInput.value.slice(0, 500);
      delete draft.selections[question.id];
      draft.value = this.composeUserInputDraftValue(questions, draft.selections, draft.customInputs);
      const count = otherRow.querySelector<HTMLElement>(".llm-bridge-clarification-char-count");
      if (count) count.setText(`${draft.customInputs[question.id].length}/500`);
    });
    otherInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        draft.stepIndex = Math.min(totalSteps - 1, draft.stepIndex + 1);
        this.refreshUserInputPanel();
      }
    });

    const footer = card.createDiv({ cls: "llm-bridge-clarification-footer" });
    const cancel = footer.createEl("button", { cls: "llm-bridge-clarification-btn is-secondary", text: "取消", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.resolveUserInputRequest(req.requestId, { type: "cancel" }));
    const next = footer.createEl("button", { cls: "llm-bridge-clarification-btn is-primary", text: "下一步", attr: { type: "button" } });
    next.addEventListener("click", () => {
      draft.value = this.composeUserInputDraftValue(questions, draft.selections, draft.customInputs);
      draft.stepIndex = Math.min(totalSteps - 1, draft.stepIndex + 1);
      this.refreshUserInputPanel();
    });
  }

  private renderClarificationSupplementStep(
    card: HTMLElement,
    req: UserInputRequestSegment,
    draft: UserInputDraft,
    questions: ReadonlyArray<UserInputQuestion>,
  ): void {
    const body = card.createDiv({ cls: "llm-bridge-clarification-supplement-body" });
    const textarea = body.createEl("textarea", {
      cls: "llm-bridge-clarification-supplement-textarea",
      attr: {
        placeholder: "添加补充信息",
        maxlength: "1000",
      },
    });
    textarea.value = draft.supplement;
    const count = body.createDiv({ cls: "llm-bridge-clarification-supplement-count", text: `${textarea.value.length}/1000` });
    textarea.addEventListener("input", () => {
      draft.supplement = textarea.value.slice(0, 1000);
      count.setText(`${draft.supplement.length}/1000`);
    });

    const footer = card.createDiv({ cls: "llm-bridge-clarification-footer" });
    const cancel = footer.createEl("button", { cls: "llm-bridge-clarification-btn is-secondary", text: "取消", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.resolveUserInputRequest(req.requestId, { type: "cancel" }));
    const prev = footer.createEl("button", { cls: "llm-bridge-clarification-btn is-secondary", text: "上一步", attr: { type: "button" } });
    prev.addEventListener("click", () => {
      draft.stepIndex = Math.max(0, draft.stepIndex - 1);
      this.refreshUserInputPanel();
    });
    const submit = footer.createEl("button", { cls: "llm-bridge-clarification-btn is-primary", text: "提交", attr: { type: "button" } });
    submit.addEventListener("click", () => {
      const answers = this.composeUserInputAnswers(questions, draft);
      const primary = (draft.value || this.composeUserInputDraftValue(questions, draft.selections, draft.customInputs)).trim();
      const supplement = draft.supplement.trim();
      const value = supplement
        ? `${primary || "未选择"}\n\n补充信息：${supplement}`
        : primary || "未选择";
      this.resolveUserInputRequest(req.requestId, {
        type: "submit",
        value,
        answers,
        supplement: supplement || undefined,
      });
    });
  }

  // V2.17-A Completion: 解析权限请求通过 PermissionBoundary（provider-neutral）
  // 不再调用 SdkBackend.resolvePermission；所有 provider 的 approval 都走统一路径。
  private resolvePermissionRequests(requestIds: string[], choice: PermissionChoice): void {
    const permission = this.getSession().permission;
    // V16.4-G: deny_once -> decline (no deniesList); deny_session -> declineForSession (writes deniesList)
    const response: ApprovalResponse = choice === "allow_once"
      ? { type: "accept" }
      : choice === "allow_session"
        ? { type: "acceptForSession" }
        : choice === "deny_session"
          ? { type: "declineForSession" }
          : { type: "decline" };
    // V16.5-B: 设置 resolving 状态并立即刷新 UI（按钮显示 Approving/Skipping/Declining + 禁用）
    const firstId = requestIds[0];
    if (firstId) {
      this.resolvingApprovalRequestId = firstId;
      this.refreshPermissionPanel();
    }
    let resolved = 0;
    for (const id of requestIds) {
      const wasKnownPending = permission.pending.has(id) || this.pendingPermissions.has(id);
      const result = permission.resolveApprovalDetailed(id, response);
      if (result.ok) {
        this.pendingPermissions.delete(id);
        resolved++;
      } else if (wasKnownPending && this.runHandle) {
        // V16.5-B: resolve 失败 — 加入 stale 集合，UI 显示 stale card
        this.staleApprovalRequestIds.add(id);
      } else {
        this.pendingPermissions.delete(id);
      }
    }
    // V16.5-B: 清除 resolving 状态并刷新 UI
    this.resolvingApprovalRequestId = null;
    this.refreshPermissionPanel();
  }

  private resolveUserInputRequest(requestId: string, response: UserInputResponse): void {
    if (this.getSession().userInput.resolveInput(requestId, response)) {
      this.pendingUserInputDrafts.delete(requestId);
      this.refreshUserInputPanel();
      // V16.4-H: user input 解析后刷新 approval panel，显示之前被延迟的 approval
      this.refreshPermissionPanel();
    }
  }

  // V2.3s: 清空待决策权限请求（新会话/停止时调用）
  private clearPendingPermissions(): void {
    // V16.5-B: 即使 pendingPermissions 为空，stale/resolving 状态也需清除
    // V2.17-A Completion: 通过 PermissionBoundary.cancelAllPending 唤醒所有等待的 provider
    // （provider 收到 cancel 后回传 deny/cancel 给底层 runtime）。
    this.getSession().permission.cancelAllPending();
    this.pendingPermissions.clear();
    this.staleApprovalRequestIds.clear();
    this.resolvingApprovalRequestId = null;
    this.refreshPermissionPanel();
  }

  private clearApprovalUiState(): void {
    // V17-G: terminal UI cleanup only; do not cancel provider promises here.
    this.pendingPermissions.clear();
    this.staleApprovalRequestIds.clear();
    this.resolvingApprovalRequestId = null;
    this.refreshPermissionPanel();
  }

  private clearPendingUserInputRequests(): void {
    this.getSession().userInput.cancelAllPending();
    this.pendingUserInputDrafts.clear();
    this.refreshUserInputPanel();
  }

  // V2.14.0-E: 将外部文件访问请求转换为 pending read request；非 read 不进入 pending。
  public queueExternalFileAccessRequest(
    operation: FileAccessOperation,
    requestedPath: string,
    options: ExternalFileAccessRequestOptions | string = {},
  ): PendingExternalReadRequest | null {
    const requestOptions = typeof options === "string" ? { source: options } : options;
    const pending = createPendingExternalReadRequest(
      this.createCurrentFileAccessPolicy(),
      { operation, path: requestedPath },
      {
        source: requestOptions.source || "agent",
        pathKind: requestOptions.pathKind || "file",
        knownProjectRootMarkers: requestOptions.knownProjectRootMarkers || [],
      },
    );
    this.externalReadGrantStore = enqueuePendingExternalReadRequest(this.externalReadGrantStore, pending);
    this.refreshExternalReadPanel();
    return pending;
  }

  public addVaultFileRef(requestedPath: string, options: { pathKind?: FileAccessPathKind; source?: string; scope?: "message" | "pinned" | "session" } = {}): FileRef | null {
    const ref = createVaultFileRef(this.createCurrentFileAccessPolicy(), requestedPath, {
      pathKind: options.pathKind || "file",
      source: options.source || "user",
      scope: options.scope || "message",
    });
    this.addScopedFileRef(ref);
    this.refreshContextRefs();
    return ref;
  }

  public addAttachmentFileRef(requestedPath: string, options: { pathKind?: FileAccessPathKind; source?: string; scope?: "message" | "pinned" | "session" } = {}): FileRef | null {
    const result = createAttachmentFileRef(this.getVaultPath(), requestedPath, {
      pathKind: options.pathKind || "file",
      source: options.source || "attachment",
      scope: options.scope || "message",
    });
    if (!result) return null;
    this.attachmentReadGrants = this.attachmentReadGrants
      .filter((grant) => grant.path !== result.readGrant.path || grant.scope !== result.readGrant.scope);
    this.attachmentReadGrants.push(result.readGrant);
    this.addScopedFileRef(result.ref);
    this.refreshContextRefs();
    return result.ref;
  }

  public async addAttachmentFileRefWithIngestion(
    requestedPath: string,
    options: { pathKind?: FileAccessPathKind; source?: string } = {},
  ): Promise<FileRef | null> {
    const ref = this.addAttachmentFileRef(requestedPath, {
      pathKind: options.pathKind || "file",
      source: options.source || "attachment",
    });
    if (!ref) return null;
    const result = await ingestAttachmentTextSnippet(ref);
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((snippet) => snippet.refId !== ref.id);
    if (result.snippet) {
      this.attachmentTextSnippets.push(result.snippet);
    }
    const enrichedRef = result.snippet?.content ? { ...ref, previewText: result.snippet.content } : ref;
    if (enrichedRef !== ref) this.addScopedFileRef(enrichedRef);
    this.refreshContextRefs();
    return enrichedRef;
  }

  public async addAttachmentFilesWithIngestion(requestedPaths: string[]): Promise<FileRef[]> {
    const refs: FileRef[] = [];
    for (const requestedPath of requestedPaths) {
      const trimmed = requestedPath.trim();
      if (!trimmed) continue;
      const ref = await this.addAttachmentFileRefWithIngestion(trimmed);
      if (ref) refs.push(ref);
    }
    return refs;
  }

  public getWorkingSetFileRefs(): FileRef[] {
    return this.getAllContextFileRefs();
  }

  public async executeFileToolRequest(request: FileToolExecutionRequest): Promise<FileToolResult> {
    const result = await executeFileTool(this.createCurrentFileAccessPolicy(), {
      ...request,
      fileRefs: request.fileRefs || this.getAllContextFileRefs(),
    });
    if (result.status === "confirm" && result.pendingRequest) {
      this.externalReadGrantStore = enqueuePendingExternalReadRequest(this.externalReadGrantStore, result.pendingRequest);
      this.refreshExternalReadPanel();
    }
    return result;
  }

  public async executeAgentFileToolRoute(request: AgentFileToolRouteRequest): Promise<AgentFileToolRouteResult> {
    return await routeAgentFileTool(request, (toolRequest) => this.executeFileToolRequest(toolRequest));
  }

  private createCurrentFileAccessPolicy() {
    return createFileAccessPolicy({
      vaultPath: this.getVaultPath(),
      outputDir: this.plugin.settings.outputDir,
      sessionReadGrants: this.externalReadGrantStore.sessionReadGrants,
      attachmentReadGrants: this.attachmentReadGrants,
    });
  }

  private getVaultPath(): string {
    return (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
  }

  private async promptAndAddAttachmentFile(): Promise<void> {
    const input = await this.promptDialog("添加文件附件", "输入文件路径。小型 text / markdown / json 会进入 bounded text；图片/PDF/binary 只作为 native handoff 引用。", "");
    const requestedPath = (input || "").trim();
    if (!requestedPath) return;
    await this.addAttachmentPathWithNotice(requestedPath);
  }

  private async addAttachmentPathWithNotice(requestedPath: string): Promise<void> {
    const refs = await this.addUserFilePathsToContext([requestedPath], "path");
    const ref = refs[0];
    if (!ref) {
      new Notice(`文件路径无效或不可访问，未加入本轮附件：${requestedPath}`);
      return;
    }
    const snippet = this.attachmentTextSnippets.find((item) => item.refId === ref.id);
    const type = classifyFileTypeByPath(ref.resolvedPath);
    const kindLabel = ref.kind === "vault" ? "Vault 文件" : "附件引用";
    new Notice(snippet ? `已添加本轮${kindLabel}并读取 bounded snippet：${ref.displayName}` : `已添加本轮${kindLabel}：${ref.displayName} (${type})`);
  }

  // V2.15-H: @ 提及文件选择器 —— 输入框上方 inline popup（替代独立 Modal）
  private triggerMentionAtCursor(): void {
    const ta = this.inputEl;
    const start = ta.selectionStart ?? ta.value.length;
    const value = ta.value;
    const needSpace = start > 0 && !/\s$/.test(value.slice(0, start)) && value[start - 1] !== "@";
    const insert = needSpace ? " @" : "@";
    ta.value = value.slice(0, start) + insert + value.slice(start);
    const cursor = start + insert.length;
    ta.setSelectionRange(cursor, cursor);
    ta.focus();
    this.handleMentionInput();
  }

  private handleMentionInput(): void {
    const ta = this.inputEl;
    const value = ta.value;
    const cursor = ta.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (!match) {
      this.closeMentionPicker();
      return;
    }
    this.mentionPickerRange = { start: cursor - match[0].length, end: cursor };
    this.openMentionPicker(match[1]);
  }

  private openMentionPicker(query: string): void {
    const inputRow = this.inputEl.parentElement as HTMLElement | null;
    if (!inputRow) return;
    if (!this.mentionPickerEl) {
      this.mentionPickerEl = inputRow.createDiv({ cls: "llm-bridge-mention-picker" });
      this.mentionPickerEl.setAttribute("hidden", "");
    }
    this.renderMentionList(query);
    if (this.mentionPickerEl.hasAttribute("hidden")) {
      this.mentionPickerEl.removeAttribute("hidden");
      this.mentionPickerEl.classList.add("is-open");
    }
  }

  private renderMentionList(query: string): void {
    const picker = this.mentionPickerEl;
    if (!picker) return;
    picker.empty();
    const q = query.trim().toLowerCase();
    const files = this.app.vault.getFiles()
      .filter((file) => file instanceof TFile)
      .sort((a, b) => a.path.localeCompare(b.path))
      .filter((file) => !q || file.path.toLowerCase().includes(q))
      .slice(0, 50);
    if (files.length === 0) {
      picker.createDiv({ cls: "llm-bridge-mention-picker-empty", text: "无匹配 Vault 文件" });
      this.mentionPickerActiveIndex = -1;
      return;
    }
    files.forEach((file, index) => {
      const row = picker.createEl("button", {
        cls: "llm-bridge-mention-picker-item",
        text: file.path,
        attr: { title: file.path, "data-index": String(index), "data-path": file.path },
      });
      row.addEventListener("click", (e) => {
        e.preventDefault();
        this.selectMention(file.path);
      });
      row.addEventListener("mouseenter", () => {
        this.mentionPickerActiveIndex = index;
        this.updateMentionActive();
      });
    });
    this.mentionPickerActiveIndex = 0;
    this.updateMentionActive();
  }

  private updateMentionActive(): void {
    const picker = this.mentionPickerEl;
    if (!picker) return;
    picker.querySelectorAll<HTMLElement>(".llm-bridge-mention-picker-item").forEach((item, i) => {
      item.classList.toggle("is-active", i === this.mentionPickerActiveIndex);
    });
  }

  private handleMentionKeydown(e: KeyboardEvent): boolean {
    const picker = this.mentionPickerEl;
    if (!picker || picker.hasAttribute("hidden")) return false;
    const items = Array.from(picker.querySelectorAll<HTMLElement>(".llm-bridge-mention-picker-item"));
    if (e.key === "ArrowDown") {
      if (items.length === 0) return false;
      e.preventDefault();
      this.mentionPickerActiveIndex = (this.mentionPickerActiveIndex + 1) % items.length;
      this.updateMentionActive();
      items[this.mentionPickerActiveIndex]?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (e.key === "ArrowUp") {
      if (items.length === 0) return false;
      e.preventDefault();
      this.mentionPickerActiveIndex = (this.mentionPickerActiveIndex - 1 + items.length) % items.length;
      this.updateMentionActive();
      items[this.mentionPickerActiveIndex]?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (items.length === 0) return false;
      e.preventDefault();
      const active = items[this.mentionPickerActiveIndex];
      const path = active?.getAttribute("data-path") ?? "";
      if (path) this.selectMention(path);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeMentionPicker();
      return true;
    }
    return false;
  }

  private selectMention(filePath: string): void {
    const range = this.mentionPickerRange;
    this.closeMentionPicker();
    if (range) {
      const value = this.inputEl.value;
      this.inputEl.value = value.slice(0, range.start) + value.slice(range.end);
      this.inputEl.setSelectionRange(range.start, range.start);
    }
    this.inputEl.focus();
    void this.addAttachmentPathWithNotice(filePath);
  }

  private closeMentionPicker(): void {
    const picker = this.mentionPickerEl;
    if (!picker) return;
    picker.setAttribute("hidden", "");
    picker.classList.remove("is-open");
    this.mentionPickerRange = null;
    this.mentionPickerActiveIndex = -1;
  }

  private openNativeAttachmentPicker(): void {
    if (!this.attachmentFileInputEl) return;
    this.attachmentFileInputEl.value = "";
    this.attachmentFileInputEl.click();
  }

  private async addNativeSelectedAttachments(): Promise<void> {
    if (!this.attachmentFileInputEl?.files?.length) return;
    await this.addFilesFromFileList(this.attachmentFileInputEl.files);
    this.attachmentFileInputEl.value = "";
  }

  private async addFilesFromFileList(files: FileList, source = "native-picker"): Promise<FileRef[]> {
    const paths = await this.collectPathsAndCacheBlobsFromFileList(files, source);
    if (paths.length === 0) {
      new Notice("未拿到可附加的文件对象；请使用 @ 选择 Vault 文件，或拖拽/选择本地文件。");
      return [];
    }
    const refs = await this.addUserFilePathsToContext(paths, source);
    new Notice(`已添加 ${refs.length}/${paths.length} 个本轮附件`);
    return refs;
  }

  private async handleComposerPaste(event: ClipboardEvent): Promise<void> {
    const data = event.clipboardData;
    const plainText = data?.getData("text/plain") ?? "";
    const shouldAutoAttachText = this.shouldPersistLargeClipboardText(plainText);
    const paths = this.collectFilePathsFromClipboardEvent(event);
    for (const cachedPath of await this.cachePathlessFilesFromFileList(data?.files, "paste", { clipboardText: plainText })) {
      if (!paths.includes(cachedPath)) paths.push(cachedPath);
    }
    const hasBinaryClipboardFile = this.hasNonTextClipboardFileBlob(data?.files);
    if (paths.length === 0 && !hasBinaryClipboardFile && shouldAutoAttachText) {
      const textPath = await this.persistClipboardTextToVault(plainText, "paste");
      if (textPath) paths.push(textPath);
    }
    if (paths.length === 0 && !plainText.trim()) {
      const imagePath = await this.persistElectronClipboardImageToVault();
      if (imagePath) paths.push(imagePath);
    }
    // 普通复制文本保持 textarea 默认粘贴行为；只有真实文件 / 图片 / 超大文本才接管为附件。
    if (paths.length === 0) return;
    event.preventDefault();
    const refs = await this.addUserFilePathsToContext(paths, "paste");
    if (refs.length === 0) {
      new Notice(`未能添加粘贴的文件路径：${paths[0]}`);
      return;
    }
    new Notice(`已从粘贴内容添加 ${refs.length}/${paths.length} 个本轮附件`);
  }

  private hasNonTextClipboardFileBlob(files: FileList | null | undefined): boolean {
    if (!files?.length) return false;
    return Array.from(files).some((file) => {
      if (this.extractNativeFilePath(file)) return true;
      return !this.isClipboardTextBlob(file);
    });
  }

  private async handleComposerDrop(event: DragEvent): Promise<void> {
    const paths = this.collectFilePathsFromDataTransfer(event.dataTransfer);
    for (const cachedPath of await this.cachePathlessFilesFromFileList(event.dataTransfer?.files, "drop")) {
      if (!paths.includes(cachedPath)) paths.push(cachedPath);
    }
    if (paths.length === 0) {
      new Notice("拖拽内容没有可用文件 path。");
      return;
    }
    const refs = await this.addUserFilePathsToContext(paths, "drop");
    new Notice(`已从拖拽添加 ${refs.length}/${paths.length} 个本轮附件`);
  }

  private collectFilePathsFromClipboardEvent(event: ClipboardEvent): string[] {
    const paths = this.collectFilePathsFromDataTransfer(event.clipboardData);
    for (const filePath of this.readElectronClipboardFilePaths()) {
      if (!paths.includes(filePath)) paths.push(filePath);
    }
    return paths;
  }

  private collectFilePathsFromDataTransfer(data: DataTransfer | null): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    const addPath = (filePath: string | null | undefined) => {
      const trimmed = filePath?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      paths.push(trimmed);
    };

    if (!data) return paths;
    for (const filePath of this.extractPathsFromFileList(data.files)) addPath(filePath);

    // 只从原生 file / uri-list 通道提取文件；普通 text/plain 即使像路径，也保持原文本输入。
    const uriList = data.getData("text/uri-list");
    for (const filePath of this.extractPastedFilePaths(uriList)) addPath(filePath);

    return paths;
  }

  private extractPathsFromFileList(files: FileList | null | undefined): string[] {
    if (!files?.length) return [];
    return Array.from(files)
      .map((file) => this.extractNativeFilePath(file))
      .filter((filePath): filePath is string => !!filePath);
  }

  private async collectPathsAndCacheBlobsFromFileList(files: FileList | null | undefined, source: string): Promise<string[]> {
    const paths = this.extractPathsFromFileList(files);
    for (const cachedPath of await this.cachePathlessFilesFromFileList(files, source)) {
      if (!paths.includes(cachedPath)) paths.push(cachedPath);
    }
    return paths;
  }

  private async cachePathlessFilesFromFileList(
    files: FileList | null | undefined,
    source: string,
    options: { clipboardText?: string } = {},
  ): Promise<string[]> {
    if (!files?.length) return [];
    const paths: string[] = [];
    for (const file of Array.from(files)) {
      if (this.extractNativeFilePath(file)) continue;
      if (!this.shouldPersistPathlessAttachmentBlob(file, source, options)) continue;
      const cachedPath = await this.persistBlobAttachmentToVault(file, source);
      if (cachedPath) paths.push(cachedPath);
    }
    return paths;
  }

  private shouldPersistPathlessAttachmentBlob(
    file: File,
    source: string,
    options: { clipboardText?: string } = {},
  ): boolean {
    if (file.size <= 0) return false;
    if (!/^paste$/i.test(source)) return true;
    if (!this.isClipboardTextBlob(file)) return true;
    return this.shouldPersistLargeClipboardText(options.clipboardText);
  }

  private isClipboardTextBlob(file: File): boolean {
    return isClipboardTextBlobDescriptor(file);
  }

  // 普通粘贴文本应保持原文输入；只有“特别大”的文本才退化为临时 txt/json/md 附件。
  private shouldPersistLargeClipboardText(text?: string): boolean {
    return shouldPersistClipboardTextAttachment(text);
  }

  private async persistClipboardTextToVault(text: string, source: string): Promise<string | null> {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return null;
    try {
      const folder = normalizePath("LLM-Bridge Attachments");
      await this.ensureVaultFolder(folder);
      const safeName = this.sanitizeAttachmentFileName(this.defaultClipboardTextAttachmentFileName(normalized));
      const relPath = await this.allocateAttachmentPath(folder, safeName);
      await this.app.vault.create(relPath, normalized);
      new Notice(`已缓存 ${source} 文本附件：${safeName}`, 2500);
      return relPath;
    } catch (error) {
      new Notice(`缓存文本附件失败：${error instanceof Error ? error.message : String(error)}`, 5000);
      return null;
    }
  }

  private defaultClipboardTextAttachmentFileName(text: string): string {
    return chooseClipboardTextAttachmentFileName(text);
  }

  private async persistBlobAttachmentToVault(file: File, source: string): Promise<string | null> {
    if (!file || file.size <= 0) return null;
    try {
      const folder = normalizePath("LLM-Bridge Attachments");
      await this.ensureVaultFolder(folder);
      const safeName = this.sanitizeAttachmentFileName(file.name || this.defaultAttachmentFileName(file.type));
      const relPath = await this.allocateAttachmentPath(folder, safeName);
      const data = await file.arrayBuffer();
      await this.app.vault.createBinary(relPath, data);
      new Notice(`已缓存 ${source} 附件：${safeName}`, 2500);
      return relPath;
    } catch (error) {
      new Notice(`缓存附件失败：${error instanceof Error ? error.message : String(error)}`, 5000);
      return null;
    }
  }

  private async persistElectronClipboardImageToVault(): Promise<string | null> {
    try {
      const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
      const electron = requireFn?.("electron") as {
        clipboard?: {
          readImage?: () => {
            isEmpty?: () => boolean;
            toPNG?: () => Buffer;
          };
        };
      } | undefined;
      const image = electron?.clipboard?.readImage?.();
      if (!image || image.isEmpty?.()) return null;
      const png = image.toPNG?.();
      if (!png || png.length === 0) return null;
      return await this.persistBinaryAttachmentToVault(png, `screenshot-${Date.now()}.png`, "paste");
    } catch {
      return null;
    }
  }

  private async persistBinaryAttachmentToVault(data: ArrayBuffer | Uint8Array, fileName: string, source: string): Promise<string | null> {
    try {
      const folder = normalizePath("LLM-Bridge Attachments");
      await this.ensureVaultFolder(folder);
      const safeName = this.sanitizeAttachmentFileName(fileName);
      const relPath = await this.allocateAttachmentPath(folder, safeName);
      const binary = data instanceof ArrayBuffer
        ? data
        : new Uint8Array(data).slice().buffer;
      await this.app.vault.createBinary(relPath, binary);
      new Notice(`已缓存 ${source} 图片：${safeName}`, 2500);
      return relPath;
    } catch (error) {
      new Notice(`缓存图片失败：${error instanceof Error ? error.message : String(error)}`, 5000);
      return null;
    }
  }

  private async ensureVaultFolder(folder: string): Promise<void> {
    const parts = folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (this.app.vault.getAbstractFileByPath(current)) continue;
      try {
        await this.app.vault.createFolder(current);
      } catch {
        // Another event may have created it between the existence check and createFolder.
      }
    }
  }

  private async allocateAttachmentPath(folder: string, fileName: string): Promise<string> {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext) || "attachment";
    for (let index = 0; index < 1000; index++) {
      const suffix = index === 0 ? "" : `-${index + 1}`;
      const relPath = normalizePath(`${folder}/${Date.now()}-${base}${suffix}${ext}`);
      if (!this.app.vault.getAbstractFileByPath(relPath)) return relPath;
    }
    return normalizePath(`${folder}/${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`);
  }

  private sanitizeAttachmentFileName(fileName: string): string {
    const trimmed = fileName.trim() || "attachment";
    return trimmed
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 120);
  }

  private defaultAttachmentFileName(mimeType: string): string {
    if (/png/i.test(mimeType)) return "pasted-image.png";
    if (/jpe?g/i.test(mimeType)) return "pasted-image.jpg";
    if (/gif/i.test(mimeType)) return "pasted-image.gif";
    if (/webp/i.test(mimeType)) return "pasted-image.webp";
    if (/pdf/i.test(mimeType)) return "pasted-document.pdf";
    if (/json/i.test(mimeType)) return "pasted-data.json";
    if (/text|plain/i.test(mimeType)) return "pasted-text.txt";
    return "pasted-file.bin";
  }

  private async addUserFilePathsToContext(requestedPaths: string[], source: string): Promise<FileRef[]> {
    const refs: FileRef[] = [];
    for (const rawPath of requestedPaths) {
      const requestedPath = rawPath.trim();
      if (!requestedPath) continue;
      const vaultRef = this.addVaultFileRef(requestedPath, { source });
      if (vaultRef) {
        refs.push(vaultRef);
        continue;
      }
      const attachmentRef = await this.addAttachmentFileRefWithIngestion(requestedPath, { source });
      if (attachmentRef) refs.push(attachmentRef);
    }
    return refs;
  }

  private addScopedFileRef(ref: FileRef | null): void {
    if (!ref) return;
    if (ref.scope === "pinned") {
      this.pinnedFileRefs = this.upsertFileRef(this.pinnedFileRefs, ref);
    } else if (ref.scope === "session") {
      this.sessionFileRefs = this.upsertFileRef(this.sessionFileRefs, ref);
    } else {
      this.messageFileRefs = this.upsertFileRef(this.messageFileRefs, ref);
    }
  }

  private upsertFileRef(refs: FileRef[], ref: FileRef): FileRef[] {
    return [...refs.filter((item) => item.id !== ref.id), ref];
  }

  private withFileRefScope(ref: FileRef, scope: "message" | "pinned" | "session"): FileRef {
    return { ...ref, id: `${ref.id}-${scope}`, scope };
  }

  private getAllContextFileRefs(): FileRef[] {
    return [...this.pinnedFileRefs, ...this.messageFileRefs, ...this.sessionFileRefs];
  }

  private getPromptFileRefs(messageRefs: ReadonlyArray<FileRef> = this.messageFileRefs): FileRef[] {
    return [...this.pinnedFileRefs, ...messageRefs].filter((ref) => ref.status === "active");
  }

  private getPromptAttachmentSnippets(refs: ReadonlyArray<FileRef>): AttachmentTextSnippet[] {
    const ids = new Set(refs.map((ref) => ref.id.replace(/-(message|pinned|session)$/, "")));
    return this.attachmentTextSnippets.filter((snippet) => ids.has(snippet.refId) || refs.some((ref) => ref.id === snippet.refId));
  }

  /**
   * V2.17-A Completion: 构造 SDK streaming input（image content blocks）。
   *
   * ⚠️ Prompt split 闭环：text block 使用 BridgePromptPackage.userPrompt（用户正文 +
   * 用户附件 inline 内容 + 上下文片段），不再使用旧 buildPromptPackage 字符串。
   * bridge 系统附加内容只进入 systemPrompt / provider instructions 层（由
   * ClaudeSdkProvider 单独处理），不混入 streaming text block。
   *
   * 非 image 的 binary blob（PDF/document 等）按 AttachmentPackingPolicy.binaryAsNativeRef=true
   * 退化为 path ref / native tool，不进 streaming input（由 attachmentPlan.nativeRefOnly 审计）。
   */
  private async buildSdkStreamingInput(userPrompt: string, refs: ReadonlyArray<FileRef>): Promise<SdkStreamingInput | undefined> {
    const imageBlocks: SdkImageContentBlock[] = [];
    for (const ref of refs) {
      if (ref.fileType !== "image" || ref.status !== "active") continue;
      const block = await this.createSdkImageContentBlock(ref);
      if (block) imageBlocks.push(block);
    }
    if (imageBlocks.length === 0) return undefined;
    return {
      reason: "message attachments include image refs; SDK query uses Streaming Input with image content blocks",
      content: [
        { type: "text", text: userPrompt },
        ...imageBlocks,
      ],
    };
  }

  private async createSdkImageContentBlock(ref: FileRef): Promise<SdkImageContentBlock | null> {
    const mediaType = this.getImageMediaType(ref.resolvedPath);
    if (!mediaType) return null;
    const filePath = this.resolveFileRefAbsolutePath(ref);
    if (!filePath) return null;
    try {
      const data = await fs.promises.readFile(filePath);
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: data.toString("base64"),
        },
      };
    } catch {
      return null;
    }
  }

  private resolveFileRefAbsolutePath(ref: FileRef): string | null {
    if (path.isAbsolute(ref.resolvedPath)) return ref.resolvedPath;
    const vaultRelPath = this.resolveFileRefVaultPath(ref);
    if (vaultRelPath) return path.join(this.getVaultPath(), vaultRelPath);
    return null;
  }

  private getImageMediaType(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".gif") return "image/gif";
    if (ext === ".webp") return "image/webp";
    return null;
  }

  private extractPastedFilePaths(text: string, options?: { allowRawAbsolutePaths?: boolean }): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      let candidate = rawLine.trim();
      if (!candidate) continue;
      candidate = candidate.replace(/^["'`]+|["'`]+$/g, "");
      const isFileUri = /^file:\/\//i.test(candidate);
      if (isFileUri) {
        candidate = this.parseFileUriToPath(candidate);
      } else {
        try {
          candidate = decodeURIComponent(candidate);
        } catch {
          // Keep the original text if it is not URL encoded.
        }
      }
      const looksLikePath = path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate);
      if (!looksLikePath) continue;
      if (!isFileUri && !options?.allowRawAbsolutePaths) continue;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        paths.push(candidate);
      }
    }
    return paths;
  }

  private parseFileUriToPath(rawUri: string): string {
    try {
      const uri = new URL(rawUri);
      if (uri.protocol !== "file:") return rawUri;
      const decodedPath = decodeURIComponent(uri.pathname || "");
      if (uri.hostname) {
        return `\\\\${uri.hostname}${decodedPath.replace(/\//g, "\\")}`;
      }
      if (/^\/[A-Za-z]:/.test(decodedPath)) {
        return decodedPath.slice(1).replace(/\//g, "\\");
      }
      return decodedPath.replace(/\//g, path.sep);
    } catch {
      return rawUri.replace(/^file:\/+/i, "").replace(/\//g, path.sep);
    }
  }

  private readElectronClipboardFilePaths(): string[] {
    try {
      const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
      const electron = requireFn?.("electron") as {
        clipboard?: {
          availableFormats?: () => string[];
          readText?: (type?: string) => string;
          readBuffer?: (format: string) => Buffer;
        };
      } | undefined;
      const clipboard = electron?.clipboard;
      if (!clipboard) return [];

      const values: string[] = [];
      const addText = (text: string | undefined, options?: { allowRawAbsolutePaths?: boolean }) => {
        if (!text) return;
        for (const filePath of this.extractPastedFilePaths(text, options)) values.push(filePath);
      };

      for (const format of clipboard.availableFormats?.() ?? []) {
        if (/text\/uri-list/i.test(format)) {
          try {
            addText(clipboard.readText?.(format));
          } catch {
            // Some native formats are buffer-only.
          }
        }
      }

      for (const format of ["FileNameW", "FileName", "text/uri-list"]) {
        try {
          const buffer = clipboard.readBuffer?.(format);
          if (!buffer || buffer.length === 0) continue;
          const text = format === "FileNameW" ? buffer.toString("utf16le") : buffer.toString("utf8");
          addText(text.replace(/\0/g, "\n"), { allowRawAbsolutePaths: format !== "text/uri-list" });
        } catch {
          // Native clipboard formats vary by OS/Electron version.
        }
      }

      return Array.from(new Set(values));
    } catch {
      return [];
    }
  }

  private extractNativeFilePath(file: File): string | null {
    const electronFile = file as File & { path?: string };
    if (typeof electronFile.path === "string" && electronFile.path.trim().length > 0) {
      return electronFile.path;
    }
    try {
      const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
      const electron = requireFn?.("electron") as { webUtils?: { getPathForFile?: (file: File) => string } } | undefined;
      const filePath = electron?.webUtils?.getPathForFile?.(file);
      return typeof filePath === "string" && filePath.trim().length > 0 ? filePath : null;
    } catch {
      return null;
    }
  }

  private refreshContextRefs(): void {
    if (this.pinnedContextEl) this.renderPinnedContext();
    if (this.filesContextEl) this.renderFilesContext();
    if (this.composerFileRefsEl) this.renderComposerFileRefs();
  }

  private renderComposerFileRefs(): void {
    const container = this.composerFileRefsEl;
    container.empty();
    const refs = this.messageFileRefs.filter((ref) => ref.kind === "vault" || ref.kind === "attachment" || ref.kind === "external");
    if (refs.length === 0) {
      container.setAttribute("hidden", "");
      return;
    }
    container.removeAttribute("hidden");
    for (const ref of refs) {
      const chip = container.createEl("button", {
        cls: `llm-bridge-composer-file-chip is-${ref.kind} is-${ref.fileType}`,
        attr: { type: "button", title: `预览：${ref.displayName}\n${ref.resolvedPath}`, "aria-label": `预览 ${ref.displayName}` },
      });
      const thumb = chip.createEl("span", { cls: "llm-bridge-composer-file-thumb" });
      const thumbnailUrl = ref.fileType === "image" ? this.getFileRefThumbnailUrl(ref) : null;
      if (thumbnailUrl) {
        chip.addClass("has-preview");
        chip.addClass("is-preview-only");
        thumb.addClass("has-image-preview");
        const previewEl = thumb.createEl("img", {
          cls: "llm-bridge-composer-file-image",
          attr: { src: thumbnailUrl, alt: ref.displayName },
        });
        const fallback = thumb.createEl("span", { cls: "llm-bridge-composer-file-icon is-fallback", attr: { hidden: "" } });
        setIcon(fallback, this.getFileRefIconName(ref));
        previewEl.addEventListener("load", () => {
          thumb.addClass("is-preview-loaded");
          fallback.setAttribute("hidden", "");
          this.maybeApplySmartImageThumbnail(previewEl, this.getSmartImageThumbnailCacheKey(ref, thumbnailUrl));
        });
        previewEl.addEventListener("error", () => {
          previewEl.remove();
          thumb.removeClass("has-image-preview");
          thumb.removeClass("is-preview-loaded");
          thumb.addClass("is-preview-missing");
          chip.addClass("is-thumbnail-fallback");
          fallback.removeAttribute("hidden");
          fallback.empty();
          setIcon(fallback, "image");
        });
      } else {
        chip.addClass("is-preview-only");
        chip.addClass("has-document-preview");
        thumb.addClass("has-document-preview");
        this.renderDocumentPreviewThumb(thumb, "llm-bridge-composer-file-doc-thumb", "llm-bridge-composer-file-doc-line", ref, 3, 14);
      }
      const fileText = chip.createEl("span", { cls: "llm-bridge-composer-file-text" });
      fileText.createEl("span", { cls: "llm-bridge-composer-file-name", text: ref.displayName });
      fileText.createEl("span", {
        cls: "llm-bridge-composer-file-meta",
        text: this.fileRefMetaLabel(ref),
        attr: { title: ref.resolvedPath },
      });
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.openFileRefPreview(ref);
      });
      const remove = chip.createEl("span", { cls: "llm-bridge-composer-file-remove", text: "×", attr: { title: "移除" } });
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.removeMessageFileRef(ref.id);
      });
      const pin = chip.createEl("span", { cls: "llm-bridge-composer-file-pin", attr: { title: "Pin 到后续对话" } });
      setIcon(pin, "pin");
      pin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.pinFileRef(ref.id);
      });
    }
  }

  private getFileRefShortLabel(ref: FileRef): string {
    return this.shortLabelForPath(ref.displayName, ref.fileType);
  }

  private shortLabelForPath(displayPath: string, fileType: string): string {
    const ext = path.extname(displayPath).replace(".", "").trim();
    if (ext) return ext.slice(0, 4).toUpperCase();
    if (fileType === "markdown") return "MD";
    if (fileType === "text") return "TXT";
    if (fileType === "json") return "JSON";
    if (fileType === "pdf") return "PDF";
    if (fileType === "binary") return "BIN";
    return "FILE";
  }

  private getFileRefIconName(ref: FileRef): string {
    return this.fileTypeIconName(ref.fileType);
  }

  private fileTypeIconName(fileType: string): string {
    if (fileType === "image") return "image";
    if (fileType === "markdown" || fileType === "text" || fileType === "pdf") return "file-text";
    if (fileType === "json") return "braces";
    if (fileType === "binary") return "file";
    return "file";
  }

  private getFileRefThumbnailUrl(ref: FileRef): string | null {
    const vaultRelPath = this.resolveFileRefVaultPath(ref);
    if (vaultRelPath) {
      const file = this.app.vault.getAbstractFileByPath(vaultRelPath);
      if (file instanceof TFile) return this.app.vault.getResourcePath(file);
      return this.filePathToUrl(path.join(this.getVaultPath(), vaultRelPath));
    }
    if (path.isAbsolute(ref.resolvedPath)) {
      return this.imageFilePathToDataUrl(ref.resolvedPath) || this.filePathToUrl(ref.resolvedPath);
    }
    return null;
  }

  private imageFilePathToDataUrl(filePath: string): string | null {
    const normalized = path.resolve(filePath);
    try {
      const stat = fs.statSync(normalized);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return null;
      const cacheKey = `${normalized}:${stat.size}:${stat.mtimeMs}`;
      if (this.fileThumbnailCache.has(cacheKey)) return this.fileThumbnailCache.get(cacheKey) || null;
      const dataUrl = `data:${this.imageMimeTypeForPath(normalized)};base64,${fs.readFileSync(normalized).toString("base64")}`;
      this.fileThumbnailCache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch {
      return null;
    }
  }

  private imageMimeTypeForPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".gif") return "image/gif";
    if (ext === ".webp") return "image/webp";
    if (ext === ".svg") return "image/svg+xml";
    if (ext === ".bmp") return "image/bmp";
    return "image/png";
  }

  private getSmartImageThumbnailCacheKey(ref: FileRef, thumbnailUrl: string): string {
    return [ref.id, ref.resolvedPath, thumbnailUrl].join("::");
  }

  private maybeApplySmartImageThumbnail(previewEl: HTMLImageElement, cacheKey: string): void {
    if (previewEl.dataset.smartThumbPending === "true" || previewEl.dataset.smartThumbApplied === "true") return;
    if (this.smartImageThumbnailCache.has(cacheKey)) {
      const cached = this.smartImageThumbnailCache.get(cacheKey);
      previewEl.dataset.smartThumbApplied = "true";
      if (cached && previewEl.src !== cached) previewEl.src = cached;
      return;
    }
    previewEl.dataset.smartThumbPending = "true";
    window.setTimeout(() => {
      try {
        const cropped = this.buildSmartImageThumbnailDataUrl(previewEl);
        this.smartImageThumbnailCache.set(cacheKey, cropped);
        previewEl.dataset.smartThumbApplied = "true";
        if (cropped && previewEl.isConnected && previewEl.src !== cropped) {
          previewEl.src = cropped;
        }
      } catch {
        this.smartImageThumbnailCache.set(cacheKey, null);
        previewEl.dataset.smartThumbApplied = "true";
      } finally {
        delete previewEl.dataset.smartThumbPending;
      }
    }, 0);
  }

  private buildSmartImageThumbnailDataUrl(imageEl: HTMLImageElement): string | null {
    const sourceWidth = imageEl.naturalWidth;
    const sourceHeight = imageEl.naturalHeight;
    if (!sourceWidth || !sourceHeight) return null;

    const sampleMax = 256;
    const sampleScale = Math.min(1, sampleMax / Math.max(sourceWidth, sourceHeight));
    const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
    const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = sampleWidth;
    sampleCanvas.height = sampleHeight;
    const sampleCtx = sampleCanvas.getContext("2d");
    if (!sampleCtx) return null;
    sampleCtx.imageSmoothingEnabled = true;
    sampleCtx.imageSmoothingQuality = "high";
    sampleCtx.drawImage(imageEl, 0, 0, sampleWidth, sampleHeight);

    const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const significant = new Uint8Array(sampleWidth * sampleHeight);
    let significantCount = 0;
    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const offset = (y * sampleWidth + x) * 4;
        const alpha = pixels[offset + 3];
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const nearWhite = red >= 248 && green >= 248 && blue >= 248;
        if (alpha < 24 || nearWhite) continue;
        significant[y * sampleWidth + x] = 1;
        significantCount += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) return null;
    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    const coverage = (cropWidth * cropHeight) / (sampleWidth * sampleHeight);
    let cropSampleX = minX;
    let cropSampleY = minY;
    let cropSampleWidth = cropWidth;
    let cropSampleHeight = cropHeight;
    let usedDenseSquareCrop = false;
    const overallDensity = significantCount / (sampleWidth * sampleHeight);
    const aspect = sourceWidth / sourceHeight;
    if (sampleWidth >= 40 && sampleHeight >= 40 && (aspect >= 1.25 || aspect <= 0.8 || coverage >= 0.75)) {
      const minDimension = Math.min(sampleWidth, sampleHeight);
      const candidateSizes = Array.from(new Set([
        Math.max(20, Math.floor(minDimension * 0.42)),
        Math.max(24, Math.floor(minDimension * 0.58)),
        Math.max(24, Math.floor(minDimension * 0.72)),
        Math.max(24, Math.floor(minDimension * 0.86)),
      ])).filter((size) => size <= minDimension);
      let bestDensity = 0;
      let bestScore = -1;
      let bestX = 0;
      let bestY = 0;
      let bestSize = 0;
      for (const squareSize of candidateSizes) {
        const step = Math.max(2, Math.floor(squareSize / 12));
        for (let y = 0; y <= sampleHeight - squareSize; y += step) {
          for (let x = 0; x <= sampleWidth - squareSize; x += step) {
            let score = 0;
            for (let yy = y; yy < y + squareSize; yy += 1) {
              const rowOffset = yy * sampleWidth;
              for (let xx = x; xx < x + squareSize; xx += 1) {
                score += significant[rowOffset + xx];
              }
            }
            const density = score / (squareSize * squareSize);
            const rankedDensity = density + (squareSize / minDimension) * 0.06;
            if (rankedDensity > bestDensity || (rankedDensity === bestDensity && score > bestScore)) {
              bestDensity = rankedDensity;
              bestScore = score;
              bestX = x;
              bestY = y;
              bestSize = squareSize;
            }
          }
        }
      }
      const bestActualDensity = bestSize > 0 ? bestScore / (bestSize * bestSize) : 0;
      if (bestActualDensity > overallDensity * 1.12 && bestScore >= 20) {
        cropSampleX = bestX;
        cropSampleY = bestY;
        cropSampleWidth = bestSize;
        cropSampleHeight = bestSize;
        usedDenseSquareCrop = true;
      } else if (coverage > 0.9) {
        return null;
      }
    } else if (coverage > 0.9) {
      return null;
    }

    const padding = usedDenseSquareCrop ? 4 : 8;
    const cropX = Math.max(0, Math.floor((cropSampleX - padding) / sampleScale));
    const cropY = Math.max(0, Math.floor((cropSampleY - padding) / sampleScale));
    const cropRight = Math.min(sourceWidth, Math.ceil((cropSampleX + cropSampleWidth + padding) / sampleScale));
    const cropBottom = Math.min(sourceHeight, Math.ceil((cropSampleY + cropSampleHeight + padding) / sampleScale));
    const finalCropWidth = Math.max(1, cropRight - cropX);
    const finalCropHeight = Math.max(1, cropBottom - cropY);

    const thumbSize = 96;
    const inset = usedDenseSquareCrop ? 2 : 4;
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = thumbSize;
    thumbCanvas.height = thumbSize;
    const thumbCtx = thumbCanvas.getContext("2d");
    if (!thumbCtx) return null;
    thumbCtx.fillStyle = "#f3f5f7";
    thumbCtx.fillRect(0, 0, thumbSize, thumbSize);
    const innerSize = thumbSize - inset * 2;
    const scale = usedDenseSquareCrop
      ? Math.max(innerSize / finalCropWidth, innerSize / finalCropHeight)
      : Math.min(innerSize / finalCropWidth, innerSize / finalCropHeight);
    const drawWidth = Math.max(1, Math.round(finalCropWidth * scale));
    const drawHeight = Math.max(1, Math.round(finalCropHeight * scale));
    const drawX = Math.round((thumbSize - drawWidth) / 2);
    const drawY = Math.round((thumbSize - drawHeight) / 2);
    thumbCtx.imageSmoothingEnabled = true;
    thumbCtx.imageSmoothingQuality = "high";
    thumbCtx.filter = "contrast(1.14) saturate(1.04)";
    thumbCtx.drawImage(
      imageEl,
      cropX,
      cropY,
      finalCropWidth,
      finalCropHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
    thumbCtx.filter = "none";
    return thumbCanvas.toDataURL("image/png");
  }

  private fileRefMetaLabel(ref: FileRef): string {
    const source = this.fileRefSourceLabel(ref);
    const mode = this.fileRefModeLabel(ref);
    const type = ref.fileType === "binary" ? this.getFileRefShortLabel(ref).toLowerCase() : ref.fileType;
    const pathText = this.fileRefDisplayPath(ref);
    const parts = pathText.split("/").filter(Boolean);
    const folder = parts.length > 1 ? parts.slice(Math.max(0, parts.length - 3), -1).join("/") : "";
    const attachmentLabel = mode === "attached" ? type : mode;
    return folder ? `${source} · ${attachmentLabel} · ${folder}` : `${source} · ${attachmentLabel}`;
  }

  private fileRefSourceLabel(ref: FileRef): string {
    if (ref.scope === "pinned") return "pinned";
    if (ref.scope === "session") return "session";
    if (ref.kind === "external") return "external";
    if (ref.kind === "attachment") return "attachment";
    return "vault";
  }

  private fileRefDisplayPath(ref: FileRef): string {
    const vaultRelPath = this.resolveFileRefVaultPath(ref);
    if (vaultRelPath) return vaultRelPath;
    const raw = (ref.requestedPath || ref.resolvedPath || ref.displayName).replace(/\\/g, "/");
    const parts = raw.split("/").filter(Boolean);
    if (parts.length <= 3) return raw || ref.displayName;
    return `.../${parts.slice(-3).join("/")}`;
  }

  private fileRefModeLabel(ref: FileRef): string {
    if (this.getFileRefPreviewText(ref)) return "text preview";
    if (ref.scope === "pinned") return "pinned";
    if (ref.scope === "session") return "session grant";
    return "attached";
  }

  private filePathToUrl(filePath: string): string {
    const normalized = path.resolve(filePath);
    try {
      return pathToFileURL(normalized).href;
    } catch {
      const portablePath = normalized.replace(/\\/g, "/");
      if (/^[A-Za-z]:\//.test(portablePath)) {
        const [drive, ...rest] = portablePath.split("/");
        return `file:///${drive}/${rest.map((part) => encodeURIComponent(part)).join("/")}`;
      }
      return `file://${portablePath.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
    }
  }

  private findAttachmentSnippet(ref: FileRef): AttachmentTextSnippet | null {
    return this.attachmentTextSnippets.find((item) => item.refId === ref.id || ref.id.startsWith(item.refId)) ?? null;
  }

  private getFileRefPreviewText(ref: FileRef): string | null {
    if (typeof ref.previewText === "string" && ref.previewText.trim()) return ref.previewText;
    const snippet = this.findAttachmentSnippet(ref);
    if (snippet?.content?.trim()) return snippet.content;
    return this.readInlineFileRefPreviewText(ref);
  }

  private readInlineFileRefPreviewText(ref: FileRef): string | null {
    if (!isBoundedTextAttachmentType(ref.fileType)) return null;
    const filePath = this.resolveFileRefAbsolutePath(ref);
    if (!filePath) return null;
    const maxBytes = 64 * 1024;
    const maxChars = 12_000;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > maxBytes) return null;
      const cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
      if (this.fileInlinePreviewCache.has(cacheKey)) {
        return this.fileInlinePreviewCache.get(cacheKey) ?? null;
      }
      const text = fs.readFileSync(filePath, "utf8");
      const previewText = text.trim()
        ? (text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}\n...` : text)
        : null;
      this.fileInlinePreviewCache.set(cacheKey, previewText);
      return previewText;
    } catch {
      return null;
    }
  }

  private getDocumentPreviewLines(ref: FileRef, maxLines: number, maxChars: number): string[] {
    const previewText = this.getFileRefPreviewText(ref);
    if (!previewText?.trim()) return [];
    const cleaned = previewText
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .map((line) => line.replace(/^[#>*+\-`\[\]\(\)\d.\s]+/, "").trim())
      .filter(Boolean);
    const source = cleaned.length > 0 ? cleaned : [previewText.replace(/\s+/g, " ").trim()];
    return source
      .slice(0, maxLines)
      .map((line) => truncateText(line, maxChars))
      .filter(Boolean);
  }

  private renderDocumentPreviewThumb(
    parent: HTMLElement,
    thumbClass: string,
    lineClass: string,
    ref: FileRef,
    maxLines: number,
    maxChars: number,
  ): void {
    const docThumb = parent.createEl("span", { cls: `${thumbClass} is-${ref.fileType}` });
    const lines = this.getDocumentPreviewLines(ref, maxLines, maxChars);
    if (lines.length > 0) {
      docThumb.addClass("has-text-preview");
    } else {
      docThumb.addClass("is-icon-fallback");
      const fallback = docThumb.createEl("span", { cls: "llm-bridge-doc-thumb-fallback" });
      setIcon(fallback, this.getFileRefIconName(ref));
      return;
    }
    for (let i = 0; i < maxLines; i += 1) {
      const text = lines[i] ?? "";
      docThumb.createEl("span", {
        cls: `${lineClass}${text ? ` is-text ${i === 0 ? "is-primary" : "is-secondary"}` : " is-placeholder"}`,
        text: text || undefined,
        attr: text ? { title: text } : undefined,
      });
    }
  }

  private renderPinnedContext(): void {
    const container = this.pinnedContextEl;
    container.empty();
    if (this.pinnedFileRefs.length === 0) {
      container.setAttribute("hidden", "");
      return;
    }
    container.removeAttribute("hidden");
    container.createEl("summary", { text: `Pinned context (${this.pinnedFileRefs.length})` });
    const body = container.createDiv({ cls: "llm-bridge-pinned-context-body" });
    for (const ref of this.pinnedFileRefs) {
      this.renderContextRefChip(body, ref, { allowUnpin: true, allowRemove: true });
    }
  }

  private renderFilesContext(): void {
    const container = this.filesContextEl;
    container.empty();
    this.renderFileContextSection(container, {
      variant: "current",
      icon: "paperclip",
      title: "Next message",
      description: "Files attached to the next request.",
      refs: this.messageFileRefs,
      emptyText: "Drop files, paste files, or type @ to attach a file.",
      actions: { allowPin: true, allowRemove: true },
    });
    this.renderFileContextSection(container, {
      variant: "pinned",
      icon: "pin",
      title: "Pinned context",
      description: "Files kept across turns.",
      refs: this.pinnedFileRefs,
      emptyText: "Pin an attachment to keep it across future turns.",
      actions: { allowUnpin: true, allowRemove: true },
    });
    this.renderFileContextSection(container, {
      variant: "session",
      icon: "shield-check",
      title: "Session grants",
      description: "External file access allowed for this session.",
      refs: this.sessionFileRefs,
      emptyText: "External read grants appear here after approval.",
      actions: { allowPin: true, allowRemove: true },
    });
  }

  private renderFileContextSection(
    container: HTMLElement,
    options: {
      variant: string;
      icon: string;
      title: string;
      description: string;
      refs: FileRef[];
      emptyText: string;
      actions: { allowPin?: boolean; allowUnpin?: boolean; allowRemove?: boolean };
    },
  ): void {
    const section = container.createDiv({ cls: `llm-bridge-context-section is-${options.variant}` });
    const head = section.createDiv({ cls: "llm-bridge-context-section-head" });
    const icon = head.createEl("span", { cls: "llm-bridge-context-section-icon" });
    setIcon(icon, options.icon);
    const titleWrap = head.createDiv({ cls: "llm-bridge-context-section-title" });
    titleWrap.createEl("strong", { text: options.title });
    titleWrap.createEl("span", { text: options.description });
    head.createEl("span", { cls: "llm-bridge-context-section-count", text: String(options.refs.length) });

    const body = section.createDiv({ cls: "llm-bridge-context-section-body" });
    if (options.refs.length === 0) {
      body.createEl("span", { cls: "llm-bridge-context-empty", text: options.emptyText });
      return;
    }
    for (const ref of options.refs) this.renderContextRefChip(body, ref, options.actions);
  }

  private renderContextRefChip(container: HTMLElement, ref: FileRef, options: { allowPin?: boolean; allowUnpin?: boolean; allowRemove?: boolean }): void {
    const chip = container.createDiv({
      cls: `llm-bridge-context-ref-chip is-${ref.kind} is-${ref.status} is-${ref.fileType}`,
      attr: { title: `${ref.displayName}\n${this.fileRefDisplayPath(ref)}\n${this.fileRefBadgeLabel(ref)}` },
    });
    chip.addEventListener("click", () => void this.openFileRefPreview(ref));
    this.renderContextRefVisual(chip, ref);
    const text = chip.createDiv({ cls: "llm-bridge-context-ref-text" });
    text.createEl("span", { cls: "llm-bridge-context-ref-name", text: ref.displayName, attr: { title: ref.resolvedPath } });
    text.createEl("span", { cls: "llm-bridge-context-ref-meta", text: this.fileRefDisplayPath(ref), attr: { title: ref.resolvedPath } });
    chip.createEl("span", { cls: "llm-bridge-context-ref-mode", text: this.fileRefBadgeLabel(ref) });
    if (options.allowPin) {
      const pinActionBtn = chip.createEl("button", { cls: "llm-bridge-context-ref-action is-pin", attr: { title: "Pin to future turns", "aria-label": "Pin to future turns" } });
      setIcon(pinActionBtn, "pin");
      pinActionBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.pinFileRef(ref.id);
      });
    }
    if (options.allowUnpin) {
      const unpinActionBtn = chip.createEl("button", { cls: "llm-bridge-context-ref-action is-unpin", attr: { title: "Unpin from future turns", "aria-label": "Unpin from future turns" } });
      setIcon(unpinActionBtn, "pin-off");
      unpinActionBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.unpinFileRef(ref.id);
      });
    }
    if (options.allowRemove) {
      const removeBtn = chip.createEl("button", { cls: "llm-bridge-context-ref-remove is-remove", attr: { title: "Remove", "aria-label": "Remove" } });
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.removeContextFileRef(ref.id);
      });
    }
  }

  private renderContextRefVisual(parent: HTMLElement, ref: FileRef): void {
    const visual = parent.createEl("span", { cls: "llm-bridge-context-ref-icon llm-bridge-context-ref-thumb" });
    const thumbnailUrl = ref.fileType === "image" ? this.getFileRefThumbnailUrl(ref) : null;
    if (thumbnailUrl) {
      visual.addClass("has-image-preview");
      visual.style.setProperty("background-image", `url("${thumbnailUrl.replace(/"/g, '\\"')}")`);
      const fallback = visual.createEl("span", { cls: "llm-bridge-context-ref-visual-icon is-fallback" });
      setIcon(fallback, this.getFileRefIconName(ref));
      const preview = new Image();
      preview.addEventListener("load", () => visual.addClass("is-preview-loaded"));
      preview.addEventListener("error", () => {
        visual.removeClass("has-image-preview");
        visual.removeClass("is-preview-loaded");
        visual.addClass("is-preview-missing");
        visual.style.removeProperty("background-image");
      });
      preview.src = thumbnailUrl;
      return;
    }
    if (ref.fileType !== "image") {
      visual.addClass("has-document-preview");
      this.renderDocumentPreviewThumb(visual, "llm-bridge-context-ref-doc-thumb", "llm-bridge-context-ref-doc-line", ref, 4, 18);
      return;
    }
    const fileIcon = visual.createEl("span", { cls: "llm-bridge-context-ref-visual-icon" });
    setIcon(fileIcon, this.getFileRefIconName(ref));
  }

  private fileRefBadgeLabel(ref: FileRef): string {
    const type = this.getFileRefShortLabel(ref).toLowerCase();
    if (ref.scope === "pinned") return `pinned · ${type}`;
    if (ref.scope === "session") return `session · ${type}`;
    if (ref.kind === "external") return `external · ${type}`;
    if (this.getFileRefPreviewText(ref)) {
      return `preview · ${type}`;
    }
    return `attached · ${type}`;
  }

  private removeMessageFileRef(refId: string): void {
    const ref = this.messageFileRefs.find((item) => item.id === refId) || null;
    this.messageFileRefs = this.messageFileRefs.filter((item) => item.id !== refId);
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((snippet) => snippet.refId !== refId);
    if (ref?.kind === "attachment") {
      this.attachmentReadGrants = this.attachmentReadGrants.filter((grant) => grant.path !== ref.resolvedPath || grant.scope !== "attachment");
    }
    this.refreshContextRefs();
  }

  private removeContextFileRef(refId: string): void {
    this.messageFileRefs = this.messageFileRefs.filter((item) => item.id !== refId);
    this.pinnedFileRefs = this.pinnedFileRefs.filter((item) => item.id !== refId);
    this.sessionFileRefs = this.sessionFileRefs.filter((item) => item.id !== refId);
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((snippet) => snippet.refId !== refId);
    this.refreshContextRefs();
  }

  private pinFileRef(refId: string): void {
    const ref = this.getAllContextFileRefs().find((item) => item.id === refId);
    if (!ref) return;
    const pinnedRef = this.withFileRefScope(ref, "pinned");
    this.pinnedFileRefs = this.upsertFileRef(this.pinnedFileRefs, pinnedRef);
    const snippet = this.attachmentTextSnippets.find((item) => item.refId === ref.id);
    if (snippet && !this.attachmentTextSnippets.some((item) => item.refId === pinnedRef.id)) {
      this.attachmentTextSnippets.push({ ...snippet, refId: pinnedRef.id });
    }
    this.refreshContextRefs();
    new Notice(`已 Pin：${ref.displayName}`);
  }

  private unpinFileRef(refId: string): void {
    this.pinnedFileRefs = this.pinnedFileRefs.filter((item) => item.id !== refId);
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((snippet) => snippet.refId !== refId);
    this.refreshContextRefs();
  }

  private async openFileRefPreview(ref: FileRef): Promise<void> {
    if (this.filePreviewModal) {
      this.filePreviewModal.close();
      this.filePreviewModal = null;
    }
    const modal = new Modal(this.app);
    this.filePreviewModal = modal;
    const originalOnClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      if (this.filePreviewModal === modal) this.filePreviewModal = null;
      originalOnClose();
    };
    modal.containerEl.addClass("llm-bridge-file-preview-container");
    modal.titleEl.setText(ref.displayName);
    modal.contentEl.empty();
    modal.contentEl.addClass("llm-bridge-file-preview-modal");
    modal.contentEl.createDiv({
      cls: "llm-bridge-file-preview-path",
      text: this.fileRefDisplayPath(ref),
      attr: { title: ref.resolvedPath },
    });

    const preview = modal.contentEl.createDiv({ cls: `llm-bridge-file-preview is-${ref.fileType}` });
    const thumbnailUrl = ref.fileType === "image" ? this.getFileRefThumbnailUrl(ref) : null;
    if (thumbnailUrl) {
      preview.createEl("img", {
        cls: "llm-bridge-file-preview-image",
        attr: { src: thumbnailUrl, alt: ref.displayName },
      });
    } else {
      const previewText = await this.readFileRefPreviewText(ref);
      if (previewText) {
        preview.createEl("pre", { cls: "llm-bridge-file-preview-text", text: previewText });
      } else {
        const empty = preview.createDiv({ cls: "llm-bridge-file-preview-empty" });
        const icon = empty.createSpan({ cls: "llm-bridge-file-preview-icon" });
        setIcon(icon, this.getFileRefIconName(ref));
        empty.createEl("span", { text: "此文件类型暂不支持轻量预览。" });
      }
    }

    modal.open();
  }

  private async openFileRefExternally(ref: FileRef): Promise<void> {
    const vaultRelPath = this.resolveFileRefVaultPath(ref);
    if (!vaultRelPath) {
      await this.openPathWithSystemDefault(ref.resolvedPath);
      return;
    }

    const file = await this.getIndexedVaultFile(vaultRelPath);
    if (!(file instanceof TFile)) {
      new Notice(`Obsidian 尚未索引该 Vault 文件，暂无法预览：${vaultRelPath}`, 5000);
      return;
    }

    try {
      const existingLeaf = this.findLeafForFile(file);
      const cachedLeafStillUsable = this.filePreviewLeaf && this.filePreviewLeaf.view.getViewType() !== VIEW_TYPE_LLM_BRIDGE;
      const leaf = existingLeaf ?? (cachedLeafStillUsable ? this.filePreviewLeaf : null) ?? this.app.workspace.getLeaf("tab");
      this.filePreviewLeaf = leaf;
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      const opened = await this.openPathWithSystemDefault(path.join(this.getVaultPath(), file.path), false);
      if (!opened) {
        new Notice(`Obsidian 预览失败：${error instanceof Error ? error.message : String(error)}`, 5000);
      }
    }
  }

  private async readFileRefPreviewText(ref: FileRef): Promise<string | null> {
    if (!isBoundedTextAttachmentType(ref.fileType)) return null;
    const maxBytes = 256 * 1024;
    const maxChars = 12000;
    const inlinePreview = this.getFileRefPreviewText(ref);
    if (inlinePreview) {
      return inlinePreview.length > maxChars ? `${inlinePreview.slice(0, maxChars).trimEnd()}\n...` : inlinePreview;
    }
    const vaultRelPath = this.resolveFileRefVaultPath(ref);
    try {
      if (vaultRelPath) {
        const file = await this.getIndexedVaultFile(vaultRelPath);
        if (!(file instanceof TFile) || file.stat.size > maxBytes) return null;
        const text = await this.app.vault.read(file);
        return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}\n...` : text;
      }
      const filePath = this.resolveFileRefAbsolutePath(ref);
      if (!filePath) return null;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > maxBytes) return null;
      const text = fs.readFileSync(filePath, "utf8");
      return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}\n...` : text;
    } catch {
      return null;
    }
  }

  private async getIndexedVaultFile(vaultRelPath: string): Promise<TFile | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const file = this.app.vault.getAbstractFileByPath(vaultRelPath);
      if (file instanceof TFile) return file;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return null;
  }

  private findLeafForFile(file: TFile): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    const workspace = this.app.workspace as unknown as { iterateAllLeaves?: (callback: (leaf: WorkspaceLeaf) => void) => void };
    workspace.iterateAllLeaves?.((leaf) => {
      const view = leaf.view as unknown as { file?: TFile | null };
      if (!found && view.file?.path === file.path) found = leaf;
    });
    if (found) return found;
    return this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const view = leaf.view as unknown as { file?: TFile | null };
      return view.file?.path === file.path;
    }) ?? null;
  }

  private async openPathWithSystemDefault(filePath: string, showNotice = true): Promise<boolean> {
    try {
      const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
      const electron = requireFn?.("electron") as { shell?: { openPath?: (path: string) => Promise<string> } } | undefined;
      const result = await electron?.shell?.openPath?.(filePath);
      if (result === "") {
        if (showNotice) new Notice(`已用系统默认应用打开：${filePath}`, 3000);
        return true;
      }
    } catch {
      // Fall through to the quiet failure path below.
    }

    if (showNotice) new Notice(`无法预览该文件：${filePath}`, 5000);
    return false;
  }

  private resolveFileRefVaultPath(ref: FileRef): string | null {
    const vaultPath = this.getVaultPath();
    const candidates = [ref.requestedPath, ref.resolvedPath].filter((value) => value && value.trim().length > 0);
    let fallbackRelPath: string | null = null;
    for (const rawPath of candidates) {
      if (!path.isAbsolute(rawPath)) {
        const rel = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
        if (this.app.vault.getAbstractFileByPath(rel) instanceof TFile) return rel;
        fallbackRelPath ??= rel;
        continue;
      }
      const relative = path.relative(vaultPath, rawPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const rel = relative.replace(/\\/g, "/");
      if (this.app.vault.getAbstractFileByPath(rel) instanceof TFile) return rel;
      fallbackRelPath ??= rel;
    }
    return fallbackRelPath;
  }

  private refreshExternalReadPanel(): void {
    const panel = this.externalReadPanelEl;
    panel.empty();
    const pending = this.externalReadGrantStore.pendingReadRequests;
    if (pending.length === 0) {
      panel.style.display = "none";
      return;
    }

    panel.style.display = "block";
    const header = panel.createDiv({ cls: "llm-bridge-external-read-header" });
    header.createEl("span", { cls: "llm-bridge-external-read-title", text: "外部文件访问" });
    header.createEl("span", { cls: "llm-bridge-external-read-count", text: `${pending.length} 个待确认` });

    for (const req of pending) {
      const card = panel.createDiv({ cls: `llm-bridge-external-read-card is-risk-${req.risk} is-safety-${req.grantRootSafety}` });
      const title = card.createDiv({ cls: "llm-bridge-external-read-card-title" });
      title.createEl("span", { text: "Read external file" });
      title.createEl("span", { cls: "llm-bridge-external-read-source", text: req.source });

      this.renderExternalReadTarget(card, req);

      const fields = card.createDiv({ cls: "llm-bridge-external-read-fields" });
      this.renderExternalReadField(fields, "原因", this.externalReadReasonLabel(req.reason));

      if (req.grantRootSafety === "deny") {
        card.createDiv({ cls: "llm-bridge-external-read-warning", text: "范围过大，已禁用文件夹授权。" });
      } else if (req.grantRootSafety === "confirm") {
        card.createDiv({ cls: "llm-bridge-external-read-warning", text: "授权范围较大，请确认路径后再允许文件夹访问。" });
      }

      const btns = card.createDiv({ cls: "llm-bridge-external-read-actions" });
      if (req.grantRootSafety !== "deny") {
        const allowDirText = req.grantRootSafety === "confirm" ? "确认后允许目录" : "允许目录";
        const allowDirBtn = btns.createEl("button", { cls: "llm-bridge-external-read-allow-dir", text: allowDirText });
        allowDirBtn.addEventListener("click", () => this.approveExternalReadRequest(req.id, false, req.grantRootSafety === "confirm"));
        const allowFileText = req.grantRootSafety === "confirm" ? "确认后允许此文件" : "允许此文件";
        const allowFileBtn = btns.createEl("button", { cls: "llm-bridge-external-read-allow-file", text: allowFileText });
        allowFileBtn.addEventListener("click", () => this.approveExternalReadRequest(req.id, true, req.grantRootSafety === "confirm"));
      }
      const denyBtn = btns.createEl("button", { cls: "llm-bridge-external-read-deny", text: "拒绝" });
      denyBtn.addEventListener("click", () => this.denyExternalReadRequest(req.id));
    }
  }

  private renderExternalReadTarget(parent: HTMLElement, req: PendingExternalReadRequest): void {
    const fileType = classifyFileTypeByPath(req.requestedPath);
    const displayName = path.basename(req.requestedPath.replace(/\\/g, "/")) || req.requestedPath;
    const target = parent.createDiv({
      cls: `llm-bridge-external-read-target is-${fileType} is-risk-${req.risk}`,
      attr: { title: `${req.requestedPath}\n${req.proposedGrantRoot || ""}`.trim() },
    });
    const thumb = target.createEl("span", { cls: "llm-bridge-external-read-target-thumb" });
    setIcon(thumb.createEl("span", { cls: "llm-bridge-external-read-target-icon" }), this.fileTypeIconName(fileType));
    thumb.createEl("span", { cls: "llm-bridge-external-read-target-ext", text: this.shortLabelForPath(displayName, fileType) });

    const text = target.createDiv({ cls: "llm-bridge-external-read-target-text" });
    text.createEl("span", { cls: "llm-bridge-external-read-target-name", text: displayName });
    text.createEl("span", { cls: "llm-bridge-external-read-target-path", text: req.requestedPath, attr: { title: req.requestedPath } });

    const badges = target.createDiv({ cls: "llm-bridge-external-read-target-badges" });
    badges.createEl("span", { cls: `llm-bridge-external-read-target-risk is-${req.risk}`, text: req.risk === "high" ? "high risk" : req.risk === "medium" ? "medium risk" : "low risk" });
    badges.createEl("span", { cls: "llm-bridge-external-read-target-scope", text: req.grantRootSafety === "deny" ? "file only" : req.proposedGrantRoot ? "file or folder" : "file" });
  }

  private renderExternalReadField(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "llm-bridge-external-read-field" });
    row.createEl("span", { cls: "llm-bridge-external-read-field-label", text: label });
    row.createEl("span", { cls: "llm-bridge-external-read-field-value", text: value, attr: { title: value } });
  }

  private externalReadReasonLabel(reason: string): string {
    if (reason === "pending_read_request") return "需要确认后读取外部文件。";
    if (reason === "outside_read_roots") return "该路径不在当前允许读取范围内。";
    if (reason === "high_risk_path") return "路径风险较高，请确认后继续。";
    if (reason === "sensitive_path") return "路径可能包含敏感配置或凭据。";
    return reason.replace(/[_-]+/g, " ");
  }

  private approveExternalReadRequest(requestId: string, forceFileScope: boolean, strongConfirm = false): void {
    const pending = this.externalReadGrantStore.pendingReadRequests.find((req) => req.id === requestId) || null;
    const nextStore = approvePendingExternalReadRequest(this.externalReadGrantStore, requestId, { forceFileScope, strongConfirm });
    if (pending && nextStore !== this.externalReadGrantStore) {
      const ref = createExternalFileRefFromApprovedRequest(pending, nextStore.sessionReadGrants);
      this.addScopedFileRef(ref);
      this.refreshContextRefs();
    }
    this.externalReadGrantStore = nextStore;
    this.refreshExternalReadPanel();
  }

  private denyExternalReadRequest(requestId: string): void {
    this.externalReadGrantStore = {
      sessionReadGrants: this.externalReadGrantStore.sessionReadGrants.slice(),
      pendingReadRequests: this.externalReadGrantStore.pendingReadRequests.filter((req) => req.id !== requestId),
    };
    this.refreshExternalReadPanel();
  }

  private clearExternalReadRequests(): void {
    this.externalReadGrantStore = createSessionReadGrantStore();
    if (this.externalReadPanelEl) this.refreshExternalReadPanel();
  }

  private clearFileContext(): void {
    this.messageFileRefs = [];
    this.pinnedFileRefs = [];
    this.sessionFileRefs = [];
    this.attachmentReadGrants = [];
    this.attachmentTextSnippets = [];
    this.refreshContextRefs();
  }

  private clearMessageContext(): void {
    const messageAttachmentPaths = new Set(this.messageFileRefs.filter((ref) => ref.kind === "attachment").map((ref) => ref.resolvedPath));
    const messageIds = new Set(this.messageFileRefs.map((ref) => ref.id));
    this.messageFileRefs = [];
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((snippet) => !messageIds.has(snippet.refId));
    this.attachmentReadGrants = this.attachmentReadGrants.filter((grant) => !messageAttachmentPaths.has(grant.path));
    this.refreshContextRefs();
  }

  // V1.1: 运行 preflight 检测（不调用真实模型）
  private async runPreflightCheck(): Promise<void> {
    if (this.runHandle) return;
    this.preflightBtn.disabled = true;
    this.preflightBtn.textContent = "检测中…";
    try {
      const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      this.lastPreflightResult = await runPreflight(this.plugin.settings, vaultPath);
      this.refreshStatusBar();
      const status = mapPreflightToStatus(this.lastPreflightResult);
      new Notice(`Preflight: ${status.label} — ${status.detail}`);
    } catch (e) {
      new Notice(`Preflight 失败: ${(e as Error)?.message || e}`);
    } finally {
      this.preflightBtn.disabled = false;
      this.preflightBtn.textContent = "检测 runtime";
    }
  }

  // V1.2: 渲染首次使用提示（可关闭）
  private renderFirstUseGuide(parent: HTMLElement): void {
    // 读取本地存储的关闭标志
    const dismissed = localStorage.getItem("llm-bridge-guide-dismissed") === "1";
    if (!shouldShowFirstUseGuide(dismissed)) return;

    const guide = buildFirstUseGuide();
    this.guideEl = parent.createDiv({ cls: "llm-bridge-guide" });
    // 标题行 + 关闭按钮
    const head = this.guideEl.createDiv({ cls: "llm-bridge-guide-head" });
    head.createEl("span", { cls: "llm-bridge-guide-title", text: guide.title });
    const closeBtn = head.createEl("button", { cls: "llm-bridge-guide-close", text: "×", attr: { title: "关闭，不再显示" } });
    closeBtn.addEventListener("click", () => {
      localStorage.setItem("llm-bridge-guide-dismissed", "1");
      if (this.guideEl) {
        this.guideEl.remove();
        this.guideEl = null;
      }
    });
    // 步骤列表
    const body = this.guideEl.createDiv({ cls: "llm-bridge-guide-body" });
    for (const step of guide.steps) {
      const item = body.createDiv({ cls: "llm-bridge-guide-step" });
      item.createEl("span", { cls: "llm-bridge-guide-step-index", text: String(step.index) });
      const text = item.createDiv({ cls: "llm-bridge-guide-step-text" });
      text.createEl("div", { cls: "llm-bridge-guide-step-title", text: step.title });
      text.createEl("div", { cls: "llm-bridge-guide-step-detail", text: step.detail });
    }
    // footer
    this.guideEl.createDiv({ cls: "llm-bridge-guide-footer", text: guide.footer });
  }

  // V17-C1 任务 C：Pi Native Trust onboarding 卡片
  // 首次 portable + pi-native + 未确认时在普通 UI（chatPanel 顶部）展示确认卡片
  // 文案明确：Pi Native Tools 会以本机用户权限读写当前 Vault；建议先备份；确认后才运行
  private piNativeTrustEl: HTMLElement | null = null;

  private renderPiNativeTrustOnboarding(parent: HTMLElement): void {
    // 仅在 portable + pi-native + 未确认时展示
    const isPortablePiNative =
      this.plugin.settings.backendProfile === "portable" &&
      this.plugin.settings.piToolMode === "pi-native";
    if (!isPortablePiNative || this.plugin.settings.piNativeTrustConfirmed) {
      if (this.piNativeTrustEl) {
        this.piNativeTrustEl.remove();
        this.piNativeTrustEl = null;
      }
      return;
    }

    // 已存在则不重复渲染
    if (this.piNativeTrustEl && this.piNativeTrustEl.parentNode === parent) return;

    // 清理旧 DOM
    if (this.piNativeTrustEl) this.piNativeTrustEl.remove();

    const card = parent.createDiv({ cls: "llm-bridge-pi-native-trust-card" });
    this.piNativeTrustEl = card;

    // header
    const header = card.createDiv({ cls: "llm-bridge-pi-native-trust-header" });
    header.createEl("span", { cls: "llm-bridge-pi-native-trust-title", text: "Pi Native Tools — Trust 确认" });
    const closeBtn = header.createEl("button", { cls: "llm-bridge-pi-native-trust-close", text: "×" });
    closeBtn.title = "暂时关闭（不确认，下次启动仍会提示）";
    closeBtn.onclick = () => {
      card.remove();
      this.piNativeTrustEl = null;
    };

    // body — 文案明确风险
    const body = card.createDiv({ cls: "llm-bridge-pi-native-trust-body" });
    body.createEl("p", {
      cls: "llm-bridge-pi-native-trust-warn",
      text: "Pi Native Tools 将以本机用户权限读写当前 Vault。",
    });
    body.createEl("p", {
      cls: "llm-bridge-pi-native-trust-tip",
      text: "建议先备份 Vault。确认前 pi-native 模式将不启动。",
    });

    // actions
    const actions = card.createDiv({ cls: "llm-bridge-pi-native-trust-actions" });
    const confirmBtn = actions.createEl("button", {
      cls: "llm-bridge-pi-native-trust-confirm",
      text: "我已了解风险并备份，确认启用",
    });
    confirmBtn.onclick = async () => {
      this.plugin.settings.piNativeTrustConfirmed = true;
      await this.plugin.saveSettings();
      card.remove();
      this.piNativeTrustEl = null;
      this.refreshPermissionPanel?.();
    };
    const switchModeBtn = actions.createEl("button", {
      cls: "llm-bridge-pi-native-trust-switch",
      text: "切换到 bridge-controlled（更安全）",
    });
    switchModeBtn.onclick = async () => {
      this.plugin.settings.piToolMode = "bridge-controlled";
      await this.plugin.saveSettings();
      card.remove();
      this.piNativeTrustEl = null;
      this.refreshPermissionPanel?.();
    };
  }

  // V17-C1 任务 D：Pi SDK 不可用时提示安装步骤
  // portable profile 下若 SDK 未安装，展示可执行安装命令的提示卡片
  private piSdkHintEl: HTMLElement | null = null;

  private renderPiSdkUnavailableHint(parent: HTMLElement): void {
    // 仅在 portable profile 下展示（developer profile 用户可自行处理）
    if (this.plugin.settings.backendProfile !== "portable") {
      if (this.piSdkHintEl) {
        this.piSdkHintEl.remove();
        this.piSdkHintEl = null;
      }
      return;
    }

    // 动态探测 SDK 是否可用（避免阻塞渲染）
    void this.refreshPiSdkHintCard(parent);
  }

  private async refreshPiSdkHintCard(parent: HTMLElement): Promise<void> {
    let probeAvailable = true;
    let hint = "";
    try {
      const { tryLoadPiSdkAsync, probePiSdkAuth } = await import("./runtime/providers/pi-sdk/piSdkProvider");
      const probe = await tryLoadPiSdkAsync(true);
      if (!probe.available) {
        probeAvailable = false;
        hint = "Pi SDK 未安装。当前发行包可能缺 Pi SDK，请重新下载完整 user-package；或在 Vault 根目录运行：npm install --ignore-scripts @earendil-works/pi-coding-agent";
      } else {
        const authProbe = probePiSdkAuth(probe);
        if (!authProbe.hasAuth || !authProbe.hasModel) {
          probeAvailable = false;
          hint = authProbe.hint;
        }
      }
    } catch (e) {
      probeAvailable = false;
      hint = `Pi SDK 探测失败：${e instanceof Error ? e.message : String(e)}`;
    }

    if (probeAvailable) {
      if (this.piSdkHintEl) {
        this.piSdkHintEl.remove();
        this.piSdkHintEl = null;
      }
      return;
    }

    // 已存在则更新文案
    if (this.piSdkHintEl && this.piSdkHintEl.parentNode === parent) {
      const body = this.piSdkHintEl.querySelector(".llm-bridge-pi-sdk-hint-body");
      if (body) body.textContent = hint;
      return;
    }
    if (this.piSdkHintEl) this.piSdkHintEl.remove();

    const card = parent.createDiv({ cls: "llm-bridge-pi-sdk-hint-card" });
    this.piSdkHintEl = card;
    card.createDiv({ cls: "llm-bridge-pi-sdk-hint-title", text: "Pi SDK 不可用" });
    const body = card.createDiv({ cls: "llm-bridge-pi-sdk-hint-body", text: hint });
    body.style.whiteSpace = "pre-wrap";
    card.createDiv({ cls: "llm-bridge-pi-sdk-hint-tip", text: "安装完成后重启 Obsidian 或重新打开面板。" });
  }

  // ---------- Obsidian 状态 ----------

  private getActiveFile(): TFile | null {
    const current = this.app.workspace.getActiveFile();
    if (current) return this.rememberActiveFile(current);
    const markdownLeafFile = this.getVisibleMarkdownFile();
    if (markdownLeafFile) return this.rememberActiveFile(markdownLeafFile);
    return this.lastActiveMarkdownFile;
  }

  private rememberActiveFile(file: TFile | null): TFile | null {
    if (file) this.lastActiveMarkdownFile = file;
    return file;
  }

  private getVisibleMarkdownFile(): TFile | null {
    const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdown?.file) return activeMarkdown.file;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file) return view.file;
    }
    return null;
  }

  private getSelection(): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    const sel = view.editor.getSelection();
    return sel && sel.length > 0 ? sel : null;
  }

  private commandLine(): string {
    // V1.5: 使用 commandProfile.buildCommandLine 统一构造（含 Claude 动态参数）
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const { command, args } = buildCommandLine(this.plugin.settings, vaultPath);
    return [command, ...args].join(" ").trim();
  }

  // ---------- 消息渲染 ----------

  private renderEmptyState(): void {
    this.messagesEl.empty();
    const wrap = this.messagesEl.createDiv({ cls: "llm-bridge-empty" });
    // V2.2 UX Gap: 简化空状态，不与 firstUseGuide 3 步引导冲突
    // firstUseGuide 已在上方显示详细 3 步引导，这里只显示简洁提示
    wrap.createEl("div", { cls: "llm-bridge-empty-title", text: "在底部输入框输入问题" });
    wrap.createEl("div", { cls: "llm-bridge-empty-subtitle", text: "或点击上方按钮选择预设功能（自由提问 / 解释选区 / 总结当前笔记）" });
  }

  private appendUserMessage(text: string, fileRefs: ReadonlyArray<FileRef> = []): string {
    const id = nextMsgId();
    const msg: ChatMessage = {
      id,
      role: "user",
      content: text,
      status: "idle",
      stderr: "",
      log: "",
      generatedFiles: [],
      exitCode: null,
      durationMs: 0,
      timestamp: new Date().toISOString(),
      fileRefs: fileRefs.length > 0 ? fileRefs.map((ref) => ({ ...ref })) : undefined,
    };
    this.messages.push(msg);
    this.renderMessage(msg);
    return id;
  }

  private appendAssistantPlaceholder(): string {
    const id = nextMsgId();
    const msg: ChatMessage = {
      id,
      role: "assistant",
      content: "",
      status: "running",
      stderr: "",
      log: "",
      generatedFiles: [],
      exitCode: null,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(msg);
    this.currentAssistantId = id;
    this.liveAggregator.reset(); // V2.17-A: 重置聚合器，清空实时 timeline 状态
    this.renderMessage(msg);
    return id;
  }

  private renderMessage(msg: ChatMessage): void {
    try {
      const empty = this.messagesEl.querySelector(".llm-bridge-empty");
      if (empty) empty.remove();

      const block = this.messagesEl.createDiv({
        cls: `llm-bridge-msg llm-bridge-msg-${msg.role}${msg.role === "assistant" ? ` is-${msg.status}` : ""}`,
        attr: { "data-msg-id": msg.id },
      });

      // 消息头：角色 + 状态（失败时高亮）+ 时间
      const head = block.createDiv({ cls: "llm-bridge-msg-head" });
      const devMode = !!this.plugin.settings.developerMode;
      head.createEl("span", { cls: "llm-bridge-msg-role", text: msg.role === "user" ? "You" : (devMode ? this.actualRuntimeLabel : "Assistant") });
      if (msg.role === "assistant") {
        // Normal user mode: no "Done"/"Running" status label (shown in turn view header)
        // Developer mode: keep legacy status label for debugging
        if (devMode) {
          head.createEl("span", {
            cls: `llm-bridge-msg-status is-${msg.status}`,
            text: STATUS_LABEL[msg.status],
          });
        } else if (msg.status === "running") {
          // V16.4-G: Codex-style glow text 取代旋转圈
          this.renderRunStatusText(head, "Thinking", "running");
        }
      }
      head.createEl("span", { cls: "llm-bridge-msg-time", text: new Date(msg.timestamp).toLocaleTimeString() });

      const content = block.createEl("div", { cls: "llm-bridge-msg-content" });
      this.renderMessageContent(content, msg);
      if (msg.role === "user" && msg.fileRefs && msg.fileRefs.length > 0) {
        this.renderMessageFileRefs(content, msg.fileRefs);
      }

      if (msg.role === "assistant") {
        this.appendMsgDetails(block, msg, content);
      }
      this.scrollToBottom(true);
    } catch (e) {
      // V2.7: 单条消息渲染失败不影响其他消息
      this.renderMessageError(msg, e);
    }
  }

  private renderMessageContent(content: HTMLElement, msg: ChatMessage): void {
    const text = this.coerceMessageContentText(msg.content) || (msg.role === "assistant" && msg.status === "running" ? "" : "");
    content.empty();
    content.removeClass("llm-bridge-msg-content-suppressed");
    content.removeAttribute("hidden");
    if (this.shouldSuppressCodexStandaloneAnswer(msg, text)) {
      content.addClass("llm-bridge-msg-content-suppressed");
      content.setAttribute("hidden", "");
      return;
    }
    if (!text) {
      // P4-D: 不显示 "正在等待首次输出..."，spinner + currentActivity 已提供反馈
      return;
    }
    if (msg.role !== "assistant") {
      this.renderUserMessageContent(content, text);
      return;
    }

    if (msg.status === "running") {
      this.renderStreamingMessageContent(content, text);
      return;
    }

    content.addClass("llm-bridge-msg-markdown");
    const fallback = () => {
      content.empty();
      content.textContent = text;
    };
    try {
      void MarkdownRenderer.render(this.app, text, content, "", this)
        .then(() => this.bindAssistantMarkdownVaultLinks(content))
        .catch(fallback);
    } catch {
      fallback();
    }
  }

  private bindAssistantMarkdownVaultLinks(content: HTMLElement): void {
    if (content.dataset.llmBridgeVaultLinksBound === "true") return;
    content.dataset.llmBridgeVaultLinksBound = "true";
    content.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const targetFile = this.resolveAssistantMarkdownVaultLink(anchor);
      if (!targetFile) return;
      event.preventDefault();
      event.stopPropagation();
      if (!targetFile.file) {
        new Notice(`未在 Vault 中找到可打开的文件：${targetFile.path}`, 4000);
        return;
      }
      void this.openVaultFileFromAssistantLink(targetFile.file);
    }, true);
  }

  private resolveAssistantMarkdownVaultLink(anchor: HTMLAnchorElement): { file: TFile | null; path: string } | null {
    const rawTarget = anchor.getAttribute("data-href")
      || anchor.getAttribute("href")
      || anchor.textContent
      || "";
    const linkText = this.normalizeAssistantMarkdownLinkTarget(rawTarget);
    if (!linkText) return null;
    if (/^(?:https?:|mailto:|tel:|#)/i.test(linkText)) return null;

    const sourcePath = this.getActiveFile()?.path || "";
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
    if (linkedFile instanceof TFile) return { file: linkedFile, path: linkedFile.path };

    const directPath = normalizePath(linkText.replace(/^\/+/, ""));
    const directFile = this.app.vault.getAbstractFileByPath(directPath);
    if (directFile instanceof TFile) return { file: directFile, path: directFile.path };

    if (!/\.[^/\\]+$/.test(directPath)) {
      const markdownFile = this.app.vault.getAbstractFileByPath(`${directPath}.md`);
      if (markdownFile instanceof TFile) return { file: markdownFile, path: markdownFile.path };
    }
    return { file: null, path: directPath || linkText };
  }

  private normalizeAssistantMarkdownLinkTarget(value: string): string {
    let text = value.trim();
    if (!text) return "";
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the raw link if it is not URI encoded.
    }
    if (/^app:\/\/obsidian\.md\//i.test(text)) {
      text = text.replace(/^app:\/\/obsidian\.md\//i, "");
    }
    const obsidianOpen = text.match(/^obsidian:\/\/open\?(.+)$/i);
    if (obsidianOpen?.[1]) {
      const params = new URLSearchParams(obsidianOpen[1]);
      text = params.get("path") || params.get("file") || text;
    }
    return text
      .replace(/[?#].*$/, "")
      .replace(/\\/g, "/")
      .trim();
  }

  private async openVaultFileFromAssistantLink(file: TFile): Promise<void> {
    try {
      const existingLeaf = this.findLeafForFile(file);
      const leaf = existingLeaf ?? this.app.workspace.getLeaf("tab");
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
      this.rememberActiveFile(file);
    } catch (error) {
      new Notice(`无法打开文件：${file.path} (${error instanceof Error ? error.message : String(error)})`, 5000);
    }
  }

  private renderUserMessageContent(content: HTMLElement, text: string): void {
    const normalized = text.trim();
    const lineCount = normalized.split(/\r?\n/).length;
    const shouldCollapse = normalized.length > 1200 || lineCount > 12;
    if (!shouldCollapse) {
      content.textContent = normalized;
      return;
    }
    const details = content.createEl("details", { cls: "llm-bridge-user-prompt-collapse" });
    const summary = details.createEl("summary", { cls: "llm-bridge-user-prompt-summary" });
    summary.createEl("span", { cls: "llm-bridge-user-prompt-label", text: "Request" });
    summary.createEl("span", { cls: "llm-bridge-user-prompt-preview", text: this.compactPreviewText(normalized, 180) });
    summary.createEl("span", { cls: "llm-bridge-user-prompt-count", text: `${lineCount} lines · ${normalized.length} chars` });
    details.createEl("div", { cls: "llm-bridge-user-prompt-body", text: normalized });
  }

  private compactPreviewText(text: string, maxChars: number): string {
    const oneLine = text.replace(/\s+/g, " ").trim();
    if (oneLine.length <= maxChars) return oneLine;
    return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }

  private renderStreamingMessageContent(content: HTMLElement, text: string): void {
    content.removeClass("llm-bridge-msg-markdown");
    content.empty();
    content.createEl("span", { cls: "llm-bridge-msg-stream-text", text });
  }

  private renderMessageFileRefs(parent: HTMLElement, refs: ReadonlyArray<FileRef>): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-msg-attachments" });
    parent.addClass("has-attachments");
    parent.prepend(wrap);
    for (const ref of refs) {
      const chip = wrap.createEl("button", {
        cls: `llm-bridge-msg-attachment-chip is-${ref.kind} is-${ref.fileType}`,
        attr: {
          type: "button",
          title: `${ref.displayName}\n${ref.resolvedPath}`,
          "aria-label": `预览 ${ref.displayName}`,
        },
      });
      const visual = chip.createEl("span", { cls: "llm-bridge-msg-attachment-visual" });
      const thumbnailUrl = ref.fileType === "image" ? this.getFileRefThumbnailUrl(ref) : null;
      if (thumbnailUrl) {
        chip.addClass("has-preview");
        chip.addClass("is-preview-only");
        visual.addClass("has-image-preview");
        const preview = visual.createEl("img", { cls: "llm-bridge-msg-attachment-image", attr: { src: thumbnailUrl, alt: ref.displayName } });
        preview.addEventListener("load", () => {
          this.maybeApplySmartImageThumbnail(preview, this.getSmartImageThumbnailCacheKey(ref, thumbnailUrl));
        });
        preview.addEventListener("error", () => {
          chip.addClass("is-preview-missing");
          visual.removeClass("has-image-preview");
          visual.addClass("is-image-placeholder");
          preview.remove();
          const placeholder = visual.createEl("span", { cls: "llm-bridge-msg-attachment-image-placeholder" });
          setIcon(placeholder, "image");
        });
      } else if (ref.fileType === "image") {
        chip.addClass("is-preview-only");
        chip.addClass("is-preview-missing");
        visual.addClass("is-image-placeholder");
        const placeholder = visual.createEl("span", { cls: "llm-bridge-msg-attachment-image-placeholder" });
        setIcon(placeholder, "image");
      } else {
        chip.addClass("is-preview-only");
        chip.addClass("has-document-preview");
        visual.addClass("has-document-preview");
        this.renderDocumentPreviewThumb(visual, "llm-bridge-msg-attachment-doc-thumb", "llm-bridge-msg-attachment-doc-line", ref, 3, 16);
      }
      chip.addEventListener("click", () => void this.openFileRefPreview(ref));
    }
  }

  // V2.7: 消息渲染失败的 fallback 块（避免单条消息异常导致整个列表白屏）
  private renderMessageError(msg: ChatMessage, error: unknown): void {
    try {
      const block = this.messagesEl.createDiv({
        cls: "llm-bridge-msg llm-bridge-msg-error",
        attr: { "data-msg-id": msg.id },
      });
      const developerMode = !!this.plugin.settings.developerMode;
      block.createEl("div", {
        cls: "llm-bridge-msg-content",
        text: developerMode
          ? `Message render fallback · ${msg.role} · ${msg.timestamp}`
          : "This response could not be rendered inline. The answer text is still preserved.",
      });
      if (developerMode && error instanceof Error && error.message) {
        const details = block.createEl("details", { cls: "llm-bridge-message-render-error-detail" });
        details.createEl("summary", { text: "Render error detail" });
        details.createEl("pre", { cls: "llm-bridge-error-detail", text: error.message });
      }
      this.scrollToBottom(true);
    } catch {
      // 连错误块都渲染失败，静默忽略（避免无限抛出）
    }
  }

  private coerceMessageContentText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private shouldSuppressCodexStandaloneAnswer(msg: ChatMessage, text: string): boolean {
    if (msg.role !== "assistant" || !text.trim() || this.plugin.settings.developerMode) return false;
    const turnView = msg.assistantTurnView;
    if (!turnView || !/codex/i.test(turnView.providerId)) return false;
    return this.codexTurnHasFinalAnswerCarrier(turnView);
  }

  private codexTurnHasFinalAnswerCarrier(turnView: AssistantTurnView): boolean {
    if (turnView.finalAnswer.trim().length > 0) return true;
    return this.flattenTurnTimeline(turnView.turnTimeline).some((node) =>
      node.kind === "agentMessage" && [node.text, node.summary, node.detail].some((value) => (value ?? "").trim().length > 0)
    );
  }

  // stderr / log / 生成文件，默认折叠；失败或有新文件时显著
  private appendMsgDetails(block: HTMLElement, msg: ChatMessage, beforeEl?: Element | null): void {
    const failed = msg.status === "failed";
    const developerMode = !!this.plugin.settings.developerMode;
    const terminalSuccess = msg.status === "completed" || msg.status === "stopped";

    // P3: 普通用户态 + developer mode 都优先从 AgentRunDisplayModel 渲染
    if (msg.role === "assistant" && (terminalSuccess || msg.status === "running") && msg.assistantTurnView) {
      block.querySelector<HTMLElement>(".llm-bridge-timeline-live")?.remove();
      const details = block.createDiv({ cls: "llm-bridge-msg-details llm-bridge-msg-process" });
      if (beforeEl) block.insertBefore(details, beforeEl);

      // P3-C: debugView 是 developer mode 的唯一调试入口。
      // 汇总 rawProviderEvents / effectiveRunPlan / provider session / attachmentPlan /
      // commandPreview / workflowTrace / sdkEvents，不散落在 appendMsgDetails。
      // 普通用户态不显示 providerThreadId / providerSessionId / raw events / effectiveRunPlan。
      const debug: AgentRunDebugView | undefined = developerMode ? {
        commandPreview: msg.commandPreview,
        effectiveRunPlan: msg.effectiveRunPlan,
        providerThreadId: this.session?.providerThreadId,
        providerSessionId: this.session?.providerSessionId,
        sessionResumed: this.sessionResumed,
        attachmentPlan: msg.attachmentPlan,
        rawProviderEvents: msg.assistantTurnView.rawProviderEvents,
        workflowTrace: msg.workflowTrace,
        sdkEvents: msg.sdkEvents,
        // V16.4-D: Run-level permission snapshot
        permissionSnapshot: {
          configuredPermissionMode: this.plugin.settings.claudePermissionMode,
          effectivePermissionMode: this.session?.permission.mode,
          // permission 字段仅 Claude SDK/CLI plan 存在；Codex app-server 走 canUseTool，不在 plan 层
          sdkInitPermissionMode:
            msg.effectiveRunPlan && (msg.effectiveRunPlan.backend === "sdk" || msg.effectiveRunPlan.backend === "cli")
              ? msg.effectiveRunPlan.permission
              : undefined,
          canUseToolCalled: (msg.sdkEvents?.length ?? 0) > 0,
          approvalEvents: msg.assistantTurnView.approvals.map((ap) => ({
            requestId: ap.requestId,
            toolName: ap.toolName,
            pending: ap.pending,
            resolutionSource: ap.resolutionSource,
          })),
        },
      } : undefined;

      this.renderAgentRunDisplayModel(details, msg.assistantTurnView, msg.status, { developerMode, debug });

      this.appendMsgDetailsTail(details, msg, failed, developerMode);
      return;
    }

    // HISTORICAL FALLBACK: 无 assistantTurnView 时走旧路径（向后兼容历史消息）。
    // fallback 不得影响新 run；新 run 必须写入 assistantTurnView。
    // legacy renderer 仅在 developerMode 下调用；普通用户态只显示 placeholder。
    const details = block.createDiv({ cls: "llm-bridge-msg-details llm-bridge-msg-process" });
    if (beforeEl) block.insertBefore(details, beforeEl);
    if (msg.role === "assistant" && msg.status === "running") {
      if (!developerMode) {
        // 普通用户态：不调用 legacy renderer，只显示 placeholder
        this.appendRunningProcessPlaceholder(details);
      } else if (!msg.sdkEvents || msg.sdkEvents.length === 0) {
        // developerMode 运行中无 turnView：保留 liveAggregator live timeline 路径
        // (keep as developer log; remove or migrate in P4)
        if (this.liveAggregator.toRawEvents().length === 0) {
          this.appendRunningProcessPlaceholder(details);
        }
      }
    }

    // historical fallback: developer mode legacy（无 turnView 时才走到这里）
    // (keep as developer log; remove or migrate in P4)
    if (developerMode && msg.role === "assistant" && msg.commandPreview && msg.commandPreview.length > 0) {
      this.appendCommandPreview(details, msg.commandPreview);
    }
    if (developerMode && msg.role === "assistant" && msg.effectiveRunPlan) {
      this.appendEffectiveRunPlan(details, msg.effectiveRunPlan);
    }
    // historical fallback: Workflow Trace（keep as developer log; remove or migrate in P4）
    if (developerMode && msg.role === "assistant" && msg.workflowTrace && msg.workflowTrace.length > 0) {
      this.appendWorkflowTrace(details, msg.workflowTrace);
    } else if (developerMode && msg.role === "assistant" && msg.timeline && msg.timeline.length > 0) {
      this.appendTimeline(details, msg.timeline);
    }
    // historical fallback: SDK events（keep as developer log; remove or migrate in P4）
    // 普通用户态不得调用 appendSdkWorkflow 作为主 UI
    if (developerMode && msg.role === "assistant" && msg.sdkEvents && msg.sdkEvents.length > 0) {
      this.appendSdkWorkflow(details, msg.sdkEvents);
      this.updateLastSdkStats(msg.sdkEvents);
    }

    this.appendMsgDetailsTail(details, msg, failed, developerMode);
  }

  /**
   * P3: appendMsgDetails 尾部共享逻辑（stderr + debug log + log + generatedFiles）。
   * 被 turnView 分支和回退分支共同调用，避免重复代码。
   */
  private appendMsgDetailsTail(details: HTMLElement, msg: ChatMessage, failed: boolean, developerMode: boolean): void {
    if (msg.stderr && (failed || developerMode)) {
      const startOpen = false;
      this.appendCollapsible(details, failed ? "查看详情" : "stderr", msg.stderr, "llm-bridge-stderr-text", startOpen, failed);
      // V1.2/V1.5: 失败时提取 debug log 路径，提供可点击/复制/打开按钮
      if (failed && developerMode) {
        const logPathMatch = msg.stderr.match(/Debug log:\s*(.+)/);
        if (logPathMatch && logPathMatch[1]) {
          const debugLogBody = this.createCollapsibleSection(details, "debug log", "llm-bridge-debug-log-collapse", false);
          this.appendDebugLogPath(debugLogBody, logPathMatch[1].trim());
        }
      }
    }
    if (developerMode && msg.log) {
      this.appendCollapsible(details, "log", msg.log, "llm-bridge-log-text", false, false);
    }
    if (msg.generatedFiles.length > 0 && (developerMode || !msg.assistantTurnView)) {
      const filesWrap = details.createDiv({ cls: "llm-bridge-gen-wrap" });
      filesWrap.createEl("div", { cls: "llm-bridge-gen-title", text: "新增/修改的 Markdown 文件" });
      const files = filesWrap.createDiv({ cls: "llm-bridge-gen-list" });
      for (const name of msg.generatedFiles) {
        const item = files.createDiv({ cls: "llm-bridge-gen-item" });
        item.createEl("span", { cls: "llm-bridge-gen-name", text: name });
        item.addEventListener("click", () => void this.openGeneratedFile(name));
      }
    }
  }


  private appendWorkflowProcess(
    parent: HTMLElement,
    trace: ReadonlyArray<{ stage: string; timestamp: string; detail: string; status: string }>,
    status: RunStatus,
  ): void {
    const visible = trace.filter((entry) => entry.stage !== "preflight" && entry.stage !== "build_prompt");
    if (visible.length === 0) return;
    const summary = `过程 · ${status === "completed" ? "Completed" : STATUS_LABEL[status]} · ${visible.length} steps`;
    const wrap = parent.createDiv({ cls: "llm-bridge-timeline-wrap" });
    const head = wrap.createDiv({ cls: "llm-bridge-timeline-head" });
    const toggle = head.createEl("span", { cls: "llm-bridge-timeline-toggle", text: "▶ " });
    head.createEl("span", { cls: "llm-bridge-timeline-summary", text: summary });
    const body = wrap.createDiv({ cls: "llm-bridge-timeline-body", attr: { hidden: "" } });
    const timeline = body.createDiv({ cls: "llm-bridge-timeline llm-bridge-timeline-final" });
    const stepLabels: Record<string, string> = {
      spawn: "启动 agent",
      stdout: "读取输出",
      stderr: "读取错误",
      file_diff_scan: "检测文件变化",
      completed: "完成",
      failed: "失败",
      stopped: "停止",
    };
    for (const entry of visible) {
      const item = timeline.createDiv({ cls: `llm-bridge-tl-node llm-bridge-tl-${entry.status}` });
      item.createDiv({ cls: "llm-bridge-tl-dot" });
      const content = item.createDiv({ cls: "llm-bridge-tl-content" });
      content.createEl("div", { cls: "llm-bridge-tl-title", text: stepLabels[entry.stage] ?? workflowStageLabel(entry.stage as WorkflowTraceStage) });
      if (entry.detail) {
        content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(entry.detail, 160), attr: { title: entry.detail } });
      }
    }
    head.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggle.textContent = "▼ ";
      } else {
        body.setAttribute("hidden", "");
        toggle.textContent = "▶ ";
      }
    });
  }

  private appendRunningProcessPlaceholder(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-timeline-wrap llm-bridge-process-placeholder" });
    const head = wrap.createDiv({ cls: "llm-bridge-timeline-head llm-bridge-timeline-head-noclick" });
    // V16.4-H: 避免重复 Thinking，仅用 timeline-summary + run-glow class（CSS 控制是否 shimmer）
    const summary = head.createEl("span", { cls: "llm-bridge-timeline-summary llm-bridge-run-status-text is-running llm-bridge-run-glow", text: "Thinking" });
    summary.setAttribute("data-run-status", "running");
  }

/**
 * P3: 从 AssistantTurnView 构建 AgentRunDisplayModel 并渲染普通用户态主链路。
 *
 * 业务分类逻辑由 buildAgentRunDisplayModel 承担；此方法只做 DOM 渲染。
 * developer mode 的 audit/raw/legacy 信息通过 debugView 汇总渲染，不散落在 appendMsgDetails。
 *
 * legacy: WorkflowEvent / RunStateAggregator 不参与普通用户主 UI（keep as developer log）。
 */
  private renderAgentRunDisplayModel(
    parent: HTMLElement,
    turnView: import("./runtime/core/types").AssistantTurnView,
    status: RunStatus,
    options: { developerMode: boolean; debug?: AgentRunDebugView },
  ): void {
    const model = buildAgentRunDisplayModel(turnView, {
      isRunning: status === "running",
      statusLabel: STATUS_LABEL[status],
      developerMode: options.developerMode,
      debug: options.debug,
    });
    const providerLabel = options.debug?.effectiveRunPlan?.backend ?? turnView.providerId;
    const modelLabel = options.debug?.effectiveRunPlan?.model ?? "";
    const shouldUseCodexRunView = /codex/i.test(turnView.providerId)
      || /codex/i.test(providerLabel)
      || turnView.turnTimeline.length > 0;
    if (shouldUseCodexRunView) {
      const codexRun = buildCodexRunViewModel(model, turnView, {
        status,
        developerMode: options.developerMode,
        providerLabel,
        modelLabel,
        cwd: options.debug?.effectiveRunPlan?.cwd ?? this.getVaultPath(),
      });
      this.renderCodexRunView(parent, codexRun, model, options.developerMode);
      return;
    }

    const isRunning = status === "running";
    const isFailed = status === "failed";
    const developerMode = options.developerMode;
    const hasPhases = model.phaseModel.phases.length > 0;
    const hasTimelineContent = model.timelineCards.length > 0;
    const hasFileChanges = model.fileChangeCards.length > 0;
    const hasDiagnostics = model.diagnosticCards.length > 0;
    const hasPendingApprovals = model.approvalCards.some((a) => a.status === "pending");
    const hasPendingUserInputs = model.userInputCards.some((c) => c.status === "pending");
    const hasDebugView = developerMode && options.debug;
    // V16.4: 普通用户态有 phases 就算有过程内容
    const hasProcessContent = developerMode
      ? (hasTimelineContent || hasFileChanges || hasDiagnostics || hasPendingApprovals || hasPendingUserInputs || hasDebugView)
      : (hasPhases || hasPendingApprovals || hasPendingUserInputs || hasDiagnostics);

    // --- header (折叠头) ---
    const wrap = parent.createDiv({ cls: "llm-bridge-timeline-wrap llm-bridge-turn-view" });
    wrap.setAttribute("data-final-answer-disposition", model.finalAnswerDisposition);
    wrap.addClass(`is-disposition-${model.finalAnswerDisposition}`);
    const head = wrap.createDiv({ cls: "llm-bridge-timeline-head" });
    // V16.4: completed 时用 phaseModel.resultSummary 作为 header
    const headerText = (!isRunning && !isFailed && model.finalAnswerDisposition === "completed" && model.phaseModel.resultSummary)
      ? model.phaseModel.resultSummary
      : model.header;
    const toggle = hasProcessContent
      ? head.createEl("span", { cls: "llm-bridge-timeline-toggle", text: isRunning ? "▼ " : "▶ " })
      : head.createEl("span", { cls: "llm-bridge-timeline-toggle", text: "" });
    // V16.4-G/H: Running 状态用 Codex-style glow text 取代旋转圈
    // V16.4-H: blocked 状态（Needs approval / Needs input）不用 running glow，用 kind="blocked"
    if (isRunning) {
      const statusText = model.currentActivity || "Thinking";
      const isBlocked = statusText === "Needs approval" || statusText === "Needs input";
      this.renderRunStatusText(head, statusText, isBlocked ? "blocked" : "running");
    }
    head.createEl("span", { cls: "llm-bridge-timeline-summary", text: headerText });

    const body = wrap.createDiv({ cls: "llm-bridge-timeline-body" });
    // 运行中始终展开；终态默认折叠（failed 时展开）
    if (!isRunning && !isFailed) body.setAttribute("hidden", "");

    // --- currentActivity (运行中显示在 header 下方，单行轻量反馈) ---
    // V16.4-G: blocked 状态（Needs approval / Needs input）不用 shimmer
    if (isRunning && model.currentActivity) {
      const isBlocked = model.currentActivity === "Needs approval" || model.currentActivity === "Needs input";
      this.renderRunStatusText(body, model.currentActivity, isBlocked ? "blocked" : "running");
    }

    if (developerMode) {
      if (model.phaseModel.pendingUserInputRequests.length > 0) {
        const inputSection = body.createDiv({ cls: "llm-bridge-turn-user-inputs" });
        inputSection.createEl("div", { cls: "llm-bridge-turn-section-label", text: "User input" });
        for (const req of model.phaseModel.pendingUserInputRequests) {
          this.renderPhaseUserInputRequest(inputSection, req);
        }
      }

      // --- Developer mode: raw timeline + file changes + diagnostics ---
      // --- fileChangeCards (单独区域) ---
      if (hasFileChanges) {
        const fcSection = body.createDiv({ cls: "llm-bridge-turn-file-changes" });
        fcSection.createEl("div", { cls: "llm-bridge-turn-section-label", text: "文件变更" });
        for (const card of model.fileChangeCards) {
          this.renderAgentRunCard(fcSection, card);
        }
      }

      // --- diagnosticCards (warnings) ---
      if (hasDiagnostics) {
        const diagSection = body.createDiv({ cls: "llm-bridge-turn-diagnostics" });
        diagSection.createEl("div", { cls: "llm-bridge-turn-section-label", text: "警告" });
        for (const card of model.diagnosticCards) {
          this.renderAgentRunCard(diagSection, card);
        }
      }

      // --- timelineCards (raw thoughts/tools/resolved approvals/errors) ---
      if (hasTimelineContent) {
        const timeline = body.createDiv({ cls: "llm-bridge-timeline llm-bridge-timeline-final" });
        for (const card of model.timelineCards) {
          this.renderAgentRunCard(timeline, card);
        }
      }

      // --- debugView (developer mode only) ---
      if (hasDebugView) {
        this.renderAgentRunDebugView(body, options.debug!);
      }
    } else {
      // --- V16.4: Normal user mode — phase view ---
      if (hasPhases) {
        this.renderPhaseView(body, model.phaseModel);
      }

      // --- diagnosticCards (warnings，普通用户态仍显示) ---
      if (hasDiagnostics) {
        const diagSection = body.createDiv({ cls: "llm-bridge-turn-diagnostics" });
        diagSection.createEl("div", { cls: "llm-bridge-turn-section-label", text: "警告" });
        for (const card of model.diagnosticCards) {
          this.renderAgentRunCard(diagSection, card);
        }
      }
    }

    // --- 折叠交互（仅有过程内容时可折叠）---
    if (hasProcessContent) {
      head.addEventListener("click", () => {
        const hidden = body.hasAttribute("hidden");
        if (hidden) {
          body.removeAttribute("hidden");
          toggle.textContent = "▼ ";
        } else {
          body.setAttribute("hidden", "");
          toggle.textContent = "▶ ";
        }
      });
    } else {
      // 无过程内容：不可折叠，移除 toggle 指针样式
      head.removeClass("llm-bridge-timeline-head");
      head.addClass("llm-bridge-timeline-head-noclick");
    }
  }

  private renderCodexRunView(
    parent: HTMLElement,
    run: CodexRunViewModel,
    sourceModel: AgentRunDisplayModel,
    developerMode: boolean,
  ): void {
    const diagnosticsForDisplay = this.filterCodexDiagnosticsForDisplay(run.diagnosticsGroups, developerMode);
    const processFeedItems = run.feedItems;
    const processFeedBatches = this.groupCodexFeedBatches(processFeedItems);
    const processEventCount = processFeedItems.filter((item) => this.isCodexFeedEvent(item)).length;
    const hasProcessContent = processFeedItems.length > 0
      || diagnosticsForDisplay.length > 0
      || !!run.debugPanel;
    const hasAnswer = !!run.finalAnswer.trim();
    const processCollapsedByDefault = !developerMode && run.runHeader.statusKind === "completed" && hasAnswer;
    const hasToggleContent = hasProcessContent;
    const hasBodyContent = run.approvalGates.length > 0
      || processFeedItems.length > 0
      || diagnosticsForDisplay.length > 0
      || !!run.debugPanel
      || hasAnswer;
    const wrap = parent.createDiv({
      cls: `llm-bridge-timeline-wrap llm-bridge-turn-view llm-bridge-codex-run-view is-${run.runHeader.statusKind}${developerMode ? " is-developer" : ""}`,
    });
    wrap.setAttribute("data-final-answer-disposition", sourceModel.finalAnswerDisposition);
    wrap.addClass(`is-disposition-${sourceModel.finalAnswerDisposition}`);

    const head = wrap.createDiv({ cls: "llm-bridge-timeline-head llm-bridge-codex-run-header" });
    const summary = head.createDiv({ cls: "llm-bridge-codex-run-summary" });
    const statusEl = summary.createEl("span", {
      cls: `llm-bridge-codex-run-status llm-bridge-timeline-summary is-${run.runHeader.statusKind}`,
      text: run.runHeader.status,
    });
    statusEl.setAttribute("data-run-status", run.runHeader.statusKind);
    const providerText = [run.runHeader.provider, run.runHeader.model].filter(Boolean).join(" · ");
    if (providerText) summary.createEl("span", { cls: "llm-bridge-codex-run-provider", text: providerText, attr: { title: providerText } });

    const metrics = head.createDiv({ cls: "llm-bridge-codex-run-metrics" });
    this.renderCodexMetric(metrics, "clock", run.runHeader.elapsed || "0s", "Elapsed time");
    this.renderCodexMetric(metrics, "file-text", String(run.runHeader.fileChangeCount), "File changes");
    this.renderCodexMetric(metrics, "terminal", String(run.runHeader.commandCount), "Commands");
    this.renderCodexMetric(metrics, "shield", String(run.runHeader.approvalCount), "Approvals");

    const body = wrap.createDiv({ cls: "llm-bridge-timeline-body llm-bridge-codex-run-body" });
    if (run.runHeader.statusKind === "running" || run.runHeader.statusKind === "blocked" || run.runHeader.statusKind === "failed") {
      this.renderCodexCurrentActivity(body, run);
    }
    if (run.approvalGates.length > 0) this.renderCodexApprovalGates(body, run.approvalGates, developerMode);

    const process = body.createDiv({ cls: "llm-bridge-codex-process" });
    if (hasProcessContent) {
      const processHead = process.createDiv({ cls: "llm-bridge-codex-section-head llm-bridge-codex-process-head" });
      const processTitle = processHead.createDiv({ cls: "llm-bridge-codex-section-title-row" });
      processTitle.createDiv({ cls: "llm-bridge-codex-section-title", text: "Process" });
      const processMeta = processTitle.createDiv({ cls: "llm-bridge-codex-process-head-meta" });
      if (run.runHeader.elapsed) {
        processMeta.createEl("span", { cls: "llm-bridge-codex-process-head-meta-item", text: run.runHeader.elapsed });
      }
      if (processFeedBatches.length > 1) {
        processMeta.createEl("span", {
          cls: "llm-bridge-codex-process-head-meta-item",
          text: `${processFeedBatches.length} batches`,
        });
      }
      if (processEventCount > 0) {
        processMeta.createEl("span", {
          cls: "llm-bridge-codex-process-head-meta-item",
          text: `${processEventCount} ${processEventCount === 1 ? "step" : "steps"}`,
        });
      }
      const processToggle = processHead.createEl("span", {
        cls: "llm-bridge-codex-process-toggle",
        text: hasToggleContent ? (processCollapsedByDefault ? "▶" : "▼") : "",
      });
      const processBody = process.createDiv({ cls: "llm-bridge-codex-process-body" });
      if (processCollapsedByDefault) processBody.setAttribute("hidden", "");
      if (processFeedItems.length > 0) this.renderCodexFeed(processBody, processFeedBatches, developerMode);
      if (diagnosticsForDisplay.length > 0) this.renderCodexDiagnosticsDrawer(processBody, diagnosticsForDisplay, developerMode);
      if (developerMode && run.debugPanel) this.renderAgentRunDebugView(processBody, run.debugPanel);

      if (hasToggleContent) {
        processHead.addClass("is-collapsible");
        processHead.setAttribute("role", "button");
        processHead.setAttribute("tabindex", "0");
        processHead.setAttribute("aria-expanded", processCollapsedByDefault ? "false" : "true");
        const toggleProcessBody = () => {
          const hidden = processBody.hasAttribute("hidden");
          if (hidden) {
            processBody.removeAttribute("hidden");
            processHead.setAttribute("aria-expanded", "true");
            processToggle.textContent = "▼";
          } else {
            processBody.setAttribute("hidden", "");
            processHead.setAttribute("aria-expanded", "false");
            processToggle.textContent = "▶";
          }
        };
        processHead.addEventListener("click", (event) => {
          if ((event.target as HTMLElement | null)?.closest?.("button")) return;
          toggleProcessBody();
        });
        processHead.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggleProcessBody();
        });
      }
    } else {
      process.setAttribute("hidden", "");
    }

    if (hasAnswer) this.renderCodexFinalAnswer(body, run.finalAnswer);

    if (!hasBodyContent) {
      head.removeClass("llm-bridge-timeline-head");
      head.addClass("llm-bridge-timeline-head-noclick");
    }
  }

  private filterCodexDiagnosticsForDisplay(
    diagnostics: ReadonlyArray<CodexRunDiagnosticsGroup>,
    developerMode: boolean,
  ): ReadonlyArray<CodexRunDiagnosticsGroup> {
    if (developerMode) return diagnostics;
    return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  }

  private renderCodexMetric(parent: HTMLElement, icon: string, value: string, title: string): void {
    const chip = parent.createEl("span", { cls: "llm-bridge-codex-run-metric", attr: { title } });
    const iconEl = chip.createEl("span", { cls: "llm-bridge-codex-run-metric-icon" });
    setIcon(iconEl, icon);
    chip.createEl("span", { cls: "llm-bridge-codex-run-metric-value", text: value });
  }

  private renderCodexCurrentActivity(parent: HTMLElement, run: CodexRunViewModel): void {
    const activity = parent.createDiv({ cls: `llm-bridge-codex-current-activity is-${run.currentActivity.kind}` });
    const text = activity.createEl("span", { cls: "llm-bridge-codex-current-activity-text" });
    this.renderRunStatusText(text, run.currentActivity.label, run.currentActivity.kind === "blocked" ? "blocked" : run.currentActivity.kind === "running" ? "running" : "completed");
  }

  private renderCodexFinalAnswer(parent: HTMLElement, text: string): void {
    const normalized = text.trim();
    if (!normalized) return;
    const section = parent.createDiv({ cls: "llm-bridge-codex-final-answer" });
    section.createDiv({ cls: "llm-bridge-codex-section-title llm-bridge-codex-final-answer-title", text: "Answer" });
    const body = section.createDiv({ cls: "llm-bridge-codex-final-answer-body llm-bridge-msg-markdown" });
    const fallback = () => {
      body.empty();
      body.textContent = normalized;
    };
    try {
      void MarkdownRenderer.render(this.app, normalized, body, "", this)
        .then(() => this.bindAssistantMarkdownVaultLinks(body))
        .catch(fallback);
    } catch {
      fallback();
    }
  }

  private renderCodexApprovalGates(parent: HTMLElement, gates: ReadonlyArray<CodexRunApprovalGate>, developerMode: boolean): void {
    const section = parent.createDiv({ cls: "llm-bridge-codex-approval-gates" });
    section.createDiv({ cls: "llm-bridge-codex-section-title", text: "Approvals" });
    for (const gate of gates) {
      const card = section.createDiv({ cls: `llm-bridge-codex-approval-gate is-risk-${gate.risk}` });
      card.setAttribute("data-request-id", gate.requestId);
      const head = card.createDiv({ cls: "llm-bridge-codex-approval-gate-head" });
      const icon = head.createEl("span", { cls: "llm-bridge-codex-approval-gate-icon" });
      setIcon(icon, gate.risk === "high" ? "shield-alert" : "shield");
      head.createEl("span", { cls: "llm-bridge-codex-approval-gate-action", text: gate.action, attr: { title: gate.action } });
      head.createEl("span", { cls: `llm-bridge-codex-approval-gate-risk is-${gate.risk}`, text: gate.risk === "high" ? "高风险" : gate.risk === "medium" ? "需确认" : "低风险" });
      if (gate.summary) card.createDiv({ cls: "llm-bridge-codex-approval-gate-summary", text: truncateText(gate.summary, 220), attr: { title: gate.summary } });
      if (gate.riskReason) card.createDiv({ cls: "llm-bridge-codex-approval-gate-reason", text: gate.riskReason });
      const actions = card.createDiv({ cls: "llm-bridge-codex-approval-gate-actions" });
      const addButton = (label: string, choice: PermissionChoice, cls: string) => {
        const button = actions.createEl("button", { cls: `llm-bridge-codex-approval-btn ${cls}`, text: label, attr: { type: "button", "data-decision": choice } });
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.resolvePermissionRequests([gate.requestId], choice);
        });
      };
      addButton("允许一次", "allow_once", "is-allow-once");
      addButton("本会话允许", "allow_session", "is-allow-session");
      addButton("拒绝", "deny_once", "is-deny");
      this.renderCodexSourceRef(card, gate.sourceRef, developerMode);
    }
  }

  private renderCodexFeed(
    parent: HTMLElement,
    batches: ReadonlyArray<ReadonlyArray<CodexRunFeedItem>>,
    developerMode: boolean,
  ): void {
    const section = parent.createDiv({ cls: "llm-bridge-codex-feed llm-bridge-codex-changes-panel" });
    const list = section.createDiv({ cls: "llm-bridge-codex-feed-list llm-bridge-codex-step-list" });
    for (const batch of batches) {
      this.renderCodexFeedBatch(list, batch, developerMode);
    }
  }

  private groupCodexFeedBatches(items: ReadonlyArray<CodexRunFeedItem>): CodexRunFeedItem[][] {
    const batches: CodexRunFeedItem[][] = [];
    let current: CodexRunFeedItem[] = [];
    let currentStartsWithNarrative = false;
    for (const item of items) {
      const startsNewBatch = item.kind === "thinking" || item.kind === "assistant";
      if (startsNewBatch) {
        if (current.length > 0) batches.push(current);
        current = [item];
        currentStartsWithNarrative = true;
        continue;
      }
      if (current.length > 0 && !currentStartsWithNarrative) {
        batches.push(current);
        current = [];
      }
      current.push(item);
      if (current.length === 1) currentStartsWithNarrative = false;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  private isCodexFeedEvent(item: CodexRunFeedItem): boolean {
    return item.kind !== "thinking" && item.kind !== "assistant";
  }

  private renderCodexFeedBatch(
    parent: HTMLElement,
    batch: ReadonlyArray<CodexRunFeedItem>,
    developerMode: boolean,
  ): void {
    if (batch.length === 0) return;
    const lead = batch[0];
    const leadIsNarrative = lead.kind === "thinking" || lead.kind === "assistant";
    const bodyItems = leadIsNarrative ? batch.slice(1) : batch;
    const eventCount = bodyItems.filter((item) => this.isCodexFeedEvent(item)).length;
    const batchEl = parent.createDiv({
      cls: `llm-bridge-codex-feed-batch is-${lead.status}${bodyItems.length === 0 ? " is-summary-only" : ""}`,
    });
    const summary = batchEl.createDiv({ cls: "llm-bridge-codex-feed-batch-summary" });
    this.renderCodexFeedBatchSummary(summary, batch, developerMode, eventCount);
    if (bodyItems.length === 0) return;
    const body = batchEl.createDiv({ cls: "llm-bridge-codex-feed-batch-body" });
    if (lead.kind === "thinking" && this.shouldRenderExpandedThinkingLine(lead, developerMode)) {
      this.renderCodexFeedThinking(body, lead, batch);
    } else if (lead.kind === "assistant" && developerMode) {
      this.renderCodexFeedNarrative(body, lead);
    }
    if (this.shouldGroupCodexToolEvents(bodyItems)) {
      this.renderCodexToolGroup(body, bodyItems, developerMode);
      return;
    }
    bodyItems.forEach((item) => {
      this.renderCodexFeedItem(body, item, developerMode, this.isCodexFeedEvent(item));
    });
  }

  private shouldGroupCodexToolEvents(items: ReadonlyArray<CodexRunFeedItem>): boolean {
    const events = items.filter((item) => this.isCodexFeedEvent(item));
    return events.length > 1 && events.length === items.length;
  }

  private renderCodexToolGroup(
    parent: HTMLElement,
    items: ReadonlyArray<CodexRunFeedItem>,
    developerMode: boolean,
  ): void {
    const events = items.filter((item) => this.isCodexFeedEvent(item));
    if (events.length === 0) return;
    const hasActive = events.some((item) => item.status === "running" || item.status === "pending");
    const hasFailed = events.some((item) => item.status === "failed");
    const groupStatus = hasActive ? "running" : hasFailed ? "failed" : "completed";
    const group = parent.createEl("details", {
      cls: `llm-bridge-codex-tool-group is-${groupStatus}`,
    });
    group.setAttribute("data-step-count", String(events.length));

    const summary = group.createEl("summary", { cls: "llm-bridge-codex-tool-group-summary" });
    const icon = summary.createEl("span", { cls: "llm-bridge-codex-tool-group-icon" });
    setIcon(icon, "terminal");
    const main = summary.createDiv({ cls: "llm-bridge-codex-tool-group-main" });
    main.createEl("span", {
      cls: "llm-bridge-codex-tool-group-title",
      text: this.formatCodexToolGroupTitle(events),
      attr: { title: this.formatCodexToolGroupTitle(events) },
    });
    const firstCommand = events.find((item) => item.kind === "command" && item.step?.command);
    const commandPreview = firstCommand?.step?.command ? this.formatCodexShellCommandPreview(firstCommand.step.command) : "";
    if (commandPreview) {
      main.createEl("span", {
        cls: "llm-bridge-codex-tool-group-preview",
        text: truncateText(commandPreview, developerMode ? 180 : 120),
        attr: { title: commandPreview },
      });
    }
    const meta = summary.createDiv({ cls: "llm-bridge-codex-tool-group-meta" });
    meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${groupStatus}`, text: groupStatus });
    meta.createEl("span", {
      cls: "llm-bridge-codex-tool-group-count",
      text: `${events.length} ${events.length === 1 ? "step" : "steps"}`,
    });

    let bodyRendered = false;
    const renderBody = () => {
      if (bodyRendered) return;
      bodyRendered = true;
      const body = group.createDiv({ cls: "llm-bridge-codex-tool-group-body" });
      events.forEach((item) => this.renderCodexFeedItem(body, item, developerMode, true));
    };
    group.addEventListener("toggle", () => {
      if (group.open) renderBody();
    });
  }

  private formatCodexToolGroupTitle(items: ReadonlyArray<CodexRunFeedItem>): string {
    const commandCount = items.filter((item) => item.kind === "command").length;
    const fileCount = items.filter((item) => item.kind === "file" || !!item.change).length;
    const approvalCount = items.filter((item) => item.kind === "approval").length;
    const toolCount = items.length - commandCount - fileCount - approvalCount;
    const parts: string[] = [];
    if (commandCount) parts.push(`${commandCount} command${commandCount === 1 ? "" : "s"}`);
    if (fileCount) parts.push(`${fileCount} file change${fileCount === 1 ? "" : "s"}`);
    if (approvalCount) parts.push(`${approvalCount} approval${approvalCount === 1 ? "" : "s"}`);
    if (toolCount) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(" · ") : `${items.length} steps`;
  }

  private renderCodexFeedBatchSummary(
    parent: HTMLElement,
    batch: ReadonlyArray<CodexRunFeedItem>,
    developerMode: boolean,
    eventCount: number,
  ): void {
    const lead = batch[0];
    const leadIsThinking = lead.kind === "thinking";
    const leadIsNarrative = lead.kind === "thinking" || lead.kind === "assistant";
    const syntheticNarrative = !leadIsNarrative
      && (lead.kind === "command" || lead.kind === "file" || lead.kind === "mcp" || lead.kind === "dynamic");
    const label = leadIsThinking
      ? "Thinking"
      : lead.kind === "assistant"
        ? "Thinking"
        : syntheticNarrative
          ? "Thinking"
        : lead.label || "Step";
    const batchSummary = leadIsThinking
      ? this.formatCodexThinkingBatchSummary(batch, developerMode)
      : lead.kind === "assistant"
        ? this.formatCodexFeedSummary(lead, developerMode).trim() || this.formatCodexThinkingFallbackFromBatch(batch)
      : syntheticNarrative
        ? this.formatCodexThinkingFallbackFromBatch(batch) || this.formatCodexBatchSummary(batch, developerMode)
      : this.formatCodexBatchSummary(batch, developerMode);

    const textWrap = parent.createDiv({ cls: "llm-bridge-codex-feed-batch-summary-main" });
    textWrap.createEl("span", { cls: "llm-bridge-codex-feed-batch-label", text: label });
    if (batchSummary) {
      textWrap.createEl("span", {
        cls: "llm-bridge-codex-feed-batch-text",
        text: truncateText(batchSummary, 420),
        attr: { title: batchSummary },
      });
    } else if (!leadIsNarrative) {
      textWrap.createEl("span", {
        cls: "llm-bridge-codex-feed-batch-text",
        text: truncateText(lead.label || "", 180),
        attr: { title: lead.label || "" },
      });
    }

    const meta = parent.createDiv({ cls: "llm-bridge-codex-feed-batch-meta" });
    if (eventCount > 0) {
      meta.createEl("span", {
        cls: "llm-bridge-codex-feed-batch-count",
        text: `${eventCount} ${eventCount === 1 ? "step" : "steps"}`,
      });
    }
    meta.createEl("span", { cls: `llm-bridge-codex-feed-batch-status is-${lead.status}`, text: lead.status });
  }

  private formatCodexBatchSummary(
    batch: ReadonlyArray<CodexRunFeedItem>,
    developerMode: boolean,
  ): string {
    for (const item of batch) {
      const summary = this.formatCodexFeedSummary(item, developerMode).trim();
      if (summary) return summary;
    }
    const firstEvent = batch.find((item) => this.isCodexFeedEvent(item));
    return firstEvent?.label ?? batch[0]?.label ?? "";
  }

  private formatCodexThinkingBatchSummary(
    batch: ReadonlyArray<CodexRunFeedItem>,
    developerMode: boolean,
  ): string {
    const lead = batch[0];
    if (!lead) return "";
    const summary = this.formatCodexFeedSummary(lead, developerMode).trim();
    if (summary) return summary;
    return this.formatCodexThinkingFallbackFromBatch(batch);
  }

  private formatCodexThinkingFallbackFromBatch(
    batch: ReadonlyArray<CodexRunFeedItem>,
  ): string {
    const items = batch[0] && (batch[0].kind === "thinking" || batch[0].kind === "assistant")
      ? batch.slice(1)
      : batch;
    const actions = items
      .map((item) => this.formatCodexThinkingFallbackAction(item))
      .filter(Boolean);
    if (actions.length === 0) return "";
    if (actions.length === 1) return actions[0];
    if (actions.length === 2) return `${actions[0]}, then ${actions[1]}`;
    return `${actions.slice(0, 2).join(", ")}, then ${actions.length - 2} more step${actions.length - 2 === 1 ? "" : "s"}`;
  }

  private formatCodexThinkingFallbackAction(item: CodexRunFeedItem): string {
    if (item.kind === "assistant") {
      const text = this.formatCodexFeedSummary(item, false).trim();
      return text ? truncateText(text, 120) : "";
    }
    if (item.kind === "command") return "run a command";
    if (item.change) {
      const fileLabel = item.change.fileName || item.change.relativePath || "a file";
      if (item.change.action === "create") return `create ${fileLabel}`;
      if (item.change.action === "delete") return `delete ${fileLabel}`;
      return `edit ${fileLabel}`;
    }
    if (item.kind === "approval") return "wait for approval";
    if (item.kind === "user-input") return "wait for input";
    if (item.kind === "mcp") return item.label ? `use ${item.label}` : "use an MCP tool";
    if (item.kind === "dynamic") return item.label ? `use ${item.label}` : "use a tool";
    if (item.label) return item.label.replace(/\.$/, "");
    return "";
  }

  private formatCodexProcessPreview(
    batches: ReadonlyArray<ReadonlyArray<CodexRunFeedItem>>,
    developerMode: boolean,
  ): string {
    for (const batch of batches) {
      if (!batch.length) continue;
      const lead = batch[0];
      const leadIsThinking = lead.kind === "thinking";
      const label = leadIsThinking
        ? "Thinking"
        : lead.kind === "assistant"
          ? "Thinking"
          : lead.label || "Step";
      const batchSummary = leadIsThinking
        ? this.formatCodexThinkingBatchSummary(batch, developerMode)
        : this.formatCodexBatchSummary(batch, developerMode).trim();
      if (label === "Thinking") return batchSummary ? `Thinking · ${batchSummary}` : "Thinking";
      if (batchSummary) return batchSummary;
    }
    return "";
  }

  private renderCodexFeedItem(parent: HTMLElement, item: CodexRunFeedItem, developerMode: boolean, nestedEvent: boolean): void {
    if (item.kind === "thinking" && !developerMode) {
      this.renderCodexFeedThinking(parent, item);
      return;
    }
    if (item.kind === "assistant" && !developerMode) {
      this.renderCodexFeedNarrative(parent, item);
      return;
    }
    if (nestedEvent && this.isCodexFeedEvent(item)) {
      this.renderCodexFeedEventBlock(parent, item, developerMode);
      return;
    }
    const changeCls = item.change ? ` llm-bridge-codex-change-row is-${item.change.action}` : "";
    const nestedCls = nestedEvent ? " is-batch-event" : "";
    const row = parent.createDiv({
      cls: `llm-bridge-codex-feed-item llm-bridge-codex-step-row is-${item.kind} is-${item.status}${changeCls}${nestedCls}`,
    });
    row.setAttribute("data-step-kind", item.kind);
    if (item.sourceRef?.itemId) row.setAttribute("data-item-id", item.sourceRef.itemId);

    const icon = row.createEl("span", { cls: "llm-bridge-codex-feed-icon llm-bridge-codex-step-icon" });
    setIcon(icon, item.icon);

    const main = row.createDiv({ cls: "llm-bridge-codex-feed-main" });
    const title = main.createDiv({ cls: "llm-bridge-codex-feed-title" });
    title.createEl("span", { cls: "llm-bridge-codex-feed-label llm-bridge-codex-step-label", text: item.label, attr: { title: item.label } });
    if (item.change) {
      title.createEl("span", {
        cls: `llm-bridge-codex-change-approval is-${item.change.approvalStatus ?? "resolved"}`,
        text: item.change.approvalStatus ?? "changed",
      });
      main.createDiv({ cls: "llm-bridge-codex-change-path", text: item.change.relativePath, attr: { title: item.change.fullPath } });
    } else if (item.summary) {
      const feedSummary = this.formatCodexFeedSummary(item, developerMode);
      if (feedSummary) {
        const summaryText = item.kind === "assistant" ? truncateText(feedSummary, 420) : truncateText(feedSummary, 180);
        main.createDiv({ cls: "llm-bridge-codex-feed-summary", text: summaryText, attr: { title: feedSummary } });
      }
    }

    const meta = row.createDiv({ cls: "llm-bridge-codex-feed-meta" });
    meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${item.status}`, text: item.status });
    if (item.durationMs) meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: this.formatDurationMs(item.durationMs) });
    if (item.step?.exitCode !== undefined) meta.createEl("span", { cls: "llm-bridge-codex-step-exit", text: `exit ${item.step.exitCode}` });
    if (item.change) meta.createEl("span", { cls: "llm-bridge-codex-change-diff-summary", text: item.change.diffSummary });

    if (item.change) {
      const actions = row.createDiv({ cls: "llm-bridge-codex-change-actions" });
      const copyBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "复制路径" } });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(item.change?.relativePath || item.change?.fullPath || "");
          new Notice("路径已复制");
        } catch {
          new Notice("复制失败");
        }
      });
      const openBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "打开文件" } });
      setIcon(openBtn, "external-link");
      openBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!item.change) return;
        const target = path.isAbsolute(item.change.fullPath) ? item.change.fullPath : path.join(this.getVaultPath(), item.change.fullPath || item.change.relativePath);
        void this.openPathWithSystemDefault(target);
      });
      if (item.change.diff) {
        this.renderCodexDiffPreview(row, item.change.diff, item.change.diffSummary);
      }
    }

    if (item.step) {
      this.renderCodexStepPayload(row, item.step, developerMode);
    }

    this.renderCodexSourceRef(row, item.sourceRef, developerMode);
  }

  private renderCodexFeedThinking(parent: HTMLElement, item: CodexRunFeedItem, batch?: ReadonlyArray<CodexRunFeedItem>): void {
    const summary = this.formatCodexFeedSummary(item, false).trim()
      || (batch ? this.formatCodexThinkingFallbackFromBatch(batch) : "");
    const row = parent.createDiv({ cls: `llm-bridge-codex-thinking-line is-${item.status}` });
    row.setAttribute("data-step-kind", item.kind);
    if (item.sourceRef?.itemId) row.setAttribute("data-item-id", item.sourceRef.itemId);
    row.createEl("span", { cls: "llm-bridge-codex-thinking-label", text: "Thinking" });
    if (summary) {
      row.createEl("span", {
        cls: "llm-bridge-codex-thinking-summary",
        text: truncateText(summary, 360),
        attr: { title: summary },
      });
    }
  }

  private shouldRenderExpandedThinkingLine(item: CodexRunFeedItem, developerMode: boolean): boolean {
    const summary = this.formatCodexFeedSummary(item, developerMode).trim();
    const detail = (item.detail || "").trim();
    if (developerMode) return !!(summary || detail);
    if (detail && detail !== summary) return true;
    return summary.length > 140 || /\r?\n/.test(summary);
  }

  private renderCodexFeedNarrative(parent: HTMLElement, item: CodexRunFeedItem): void {
    const text = this.formatCodexFeedSummary(item, false).trim();
    if (!text) return;
    const row = parent.createDiv({ cls: `llm-bridge-codex-thinking-line is-${item.status} is-narrative` });
    row.setAttribute("data-step-kind", item.kind);
    if (item.sourceRef?.itemId) row.setAttribute("data-item-id", item.sourceRef.itemId);
    row.createEl("span", { cls: "llm-bridge-codex-thinking-label", text: "Thinking" });
    row.createEl("span", {
      cls: "llm-bridge-codex-thinking-summary is-multiline",
      text: text.length > 1200 ? `${text.slice(0, 1200).trimEnd()}...` : text,
      attr: { title: text },
    });
  }

  private renderCodexFeedEventBlock(parent: HTMLElement, item: CodexRunFeedItem, developerMode: boolean): void {
    const changeCls = item.change ? ` llm-bridge-codex-change-row is-${item.change.action}` : "";
    const block = parent.createEl("details", {
      cls: `llm-bridge-codex-feed-item llm-bridge-codex-event-block is-batch-event is-${item.kind} is-${item.status}${changeCls}`,
    });
    block.setAttribute("data-step-kind", item.kind);
    if (item.sourceRef?.itemId) block.setAttribute("data-item-id", item.sourceRef.itemId);

    const isCommandEvent = item.kind === "command" && !!item.step;
    const summary = block.createEl("summary", { cls: "llm-bridge-codex-event-summary" });
    const icon = summary.createEl("span", { cls: "llm-bridge-codex-feed-icon llm-bridge-codex-step-icon" });
    setIcon(icon, item.icon);
    const main = summary.createDiv({ cls: "llm-bridge-codex-event-main" });
    const title = main.createDiv({ cls: "llm-bridge-codex-event-title" });
    const changeActionText = item.change?.action === "create" ? "Created"
      : item.change?.action === "delete" ? "Deleted"
      : item.change ? "Modified" : "";
    const commandPreview = isCommandEvent ? this.formatCodexShellCommandPreview(item.step?.command) : "";
    const label = item.change
      ? `File · ${changeActionText} ${item.change.fileName}`
      : item.kind === "command"
        ? commandPreview
          ? `Shell · ${truncateText(commandPreview, developerMode ? 150 : 110)}`
          : "Shell"
        : item.label;
    title.createEl("span", { cls: "llm-bridge-codex-feed-label llm-bridge-codex-step-label", text: label, attr: { title: label } });
    if (item.change?.approvalStatus) {
      title.createEl("span", {
        cls: `llm-bridge-codex-change-approval is-${item.change.approvalStatus}`,
        text: item.change.approvalStatus,
      });
    }
    const summaryText = item.change
      ? ""
      : isCommandEvent
        ? ""
        : this.formatCodexFeedSummary(item, developerMode);
    if (summaryText) {
      main.createDiv({ cls: "llm-bridge-codex-event-hint", text: truncateText(summaryText, developerMode ? 260 : 150), attr: { title: summaryText } });
    }

    const meta = summary.createDiv({ cls: "llm-bridge-codex-feed-meta llm-bridge-codex-event-meta" });
    meta.createEl("span", { cls: `llm-bridge-codex-step-status is-${item.status}`, text: item.status });
    if (item.durationMs) meta.createEl("span", { cls: "llm-bridge-codex-step-duration", text: this.formatDurationMs(item.durationMs) });
    if (item.step?.exitCode !== undefined) meta.createEl("span", { cls: "llm-bridge-codex-step-exit", text: `exit ${item.step.exitCode}` });
    if (item.change) meta.createEl("span", { cls: "llm-bridge-codex-change-diff-summary", text: item.change.diffSummary });

    const renderBody = () => {
      if (block.querySelector(":scope > .llm-bridge-codex-event-body")) return;
      const body = block.createDiv({ cls: "llm-bridge-codex-event-body" });
      if (item.change) {
        const changeInfo = body.createDiv({ cls: "llm-bridge-codex-event-change-info" });
        changeInfo.createDiv({ cls: "llm-bridge-codex-change-path", text: item.change.relativePath, attr: { title: item.change.fullPath } });
        const actions = changeInfo.createDiv({ cls: "llm-bridge-codex-change-actions" });
        const copyBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "复制路径" } });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(item.change?.relativePath || item.change?.fullPath || "");
            new Notice("路径已复制");
          } catch {
            new Notice("复制失败");
          }
        });
        const openBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "打开文件" } });
        setIcon(openBtn, "external-link");
        openBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!item.change) return;
          const target = path.isAbsolute(item.change.fullPath) ? item.change.fullPath : path.join(this.getVaultPath(), item.change.fullPath || item.change.relativePath);
          void this.openPathWithSystemDefault(target);
        });
        if (item.change.diff) {
          this.renderCodexDiffPreview(body, item.change.diff, item.change.diffSummary);
        }
      }
      if (item.step) {
        this.renderCodexStepPayload(body, item.step, developerMode, { inlineShellPanel: item.kind === "command" });
      } else if (!item.change && (item.summary || item.detail)) {
        body.createDiv({ cls: "llm-bridge-codex-event-text", text: truncateText([item.summary, item.detail].filter(Boolean).join("\n"), 420) });
      }
      this.renderCodexSourceRef(body, item.sourceRef, developerMode);
    };
    block.addEventListener("toggle", () => {
      if (block.open) renderBody();
    });
  }

  private formatCodexFeedSummary(item: CodexRunFeedItem, developerMode: boolean): string {
    let summary = item.summary ?? "";
    if (developerMode || !summary) return summary;
    if (item.step) {
      summary = summary
        .split(" · ")
        .filter((part) => !part.trim().startsWith("cwd="))
        .join(" · ");
    }
    return summary.replace(/[A-Za-z]:\\[^\s·]+/g, (match) => path.basename(match));
  }

  private renderCodexChangesPanel(parent: HTMLElement, changes: ReadonlyArray<CodexRunChangeGroup>, developerMode: boolean): void {
    const section = parent.createDiv({ cls: "llm-bridge-codex-changes-panel" });
    const head = section.createDiv({ cls: "llm-bridge-codex-section-head" });
    head.createDiv({ cls: "llm-bridge-codex-section-title", text: "Changes" });
    head.createDiv({ cls: "llm-bridge-codex-section-count", text: String(changes.length) });
    const list = section.createDiv({ cls: "llm-bridge-codex-change-list" });
    for (const change of changes) {
      const row = list.createDiv({ cls: `llm-bridge-codex-change-row is-${change.action}` });
      const icon = row.createEl("span", { cls: "llm-bridge-codex-change-icon" });
      setIcon(icon, change.action === "create" ? "file-plus" : change.action === "delete" ? "file-minus" : "file-pen-line");
      const main = row.createDiv({ cls: "llm-bridge-codex-change-main" });
      const title = main.createDiv({ cls: "llm-bridge-codex-change-title" });
      const actionText = change.action === "create" ? "Created" : change.action === "delete" ? "Deleted" : "Modified";
      title.createEl("span", { cls: "llm-bridge-codex-change-action", text: actionText });
      title.createEl("span", { cls: "llm-bridge-codex-change-name", text: change.fileName, attr: { title: change.relativePath } });
      main.createDiv({ cls: "llm-bridge-codex-change-path", text: change.relativePath, attr: { title: change.fullPath } });
      const meta = row.createDiv({ cls: "llm-bridge-codex-change-meta" });
      meta.createEl("span", { cls: "llm-bridge-codex-change-diff-summary", text: change.diffSummary });
      if (change.approvalStatus) meta.createEl("span", { cls: `llm-bridge-codex-change-approval is-${change.approvalStatus}`, text: change.approvalStatus });
      if (change.durationMs) meta.createEl("span", { cls: "llm-bridge-codex-change-duration", text: this.formatDurationMs(change.durationMs) });
      const actions = row.createDiv({ cls: "llm-bridge-codex-change-actions" });
      const copyBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "复制路径" } });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(change.relativePath || change.fullPath);
          new Notice("路径已复制");
        } catch {
          new Notice("复制失败");
        }
      });
      const openBtn = actions.createEl("button", { cls: "llm-bridge-codex-icon-btn", attr: { type: "button", title: "打开文件" } });
      setIcon(openBtn, "external-link");
      openBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = path.isAbsolute(change.fullPath) ? change.fullPath : path.join(this.getVaultPath(), change.fullPath || change.relativePath);
        void this.openPathWithSystemDefault(target);
      });
      if (change.diff) {
        this.renderCodexDiffPreview(row, change.diff, change.diffSummary);
      }
      this.renderCodexSourceRef(row, change.sourceRef, developerMode);
    }
  }

  private renderCodexDiffPreview(parent: HTMLElement, diff: string, diffSummary?: string): void {
    const summaryText = diffSummary?.trim();
    const details = parent.createEl("details", { cls: "llm-bridge-codex-diff-preview" });
    const label = summaryText ? `Diff · ${truncateText(summaryText, 72)}` : "Diff";
    details.createEl("summary", {
      text: label,
      attr: { title: summaryText ? `Diff preview: ${summaryText}` : "Diff preview" },
    });
    details.createEl("pre", { cls: "llm-bridge-codex-diff-pre", text: diff });
  }

  private renderCodexStepsTimeline(parent: HTMLElement, steps: ReadonlyArray<CodexRunStepGroup>, developerMode: boolean): void {
    const section = parent.createDiv({ cls: "llm-bridge-codex-steps" });
    const head = section.createDiv({ cls: "llm-bridge-codex-section-head" });
    head.createDiv({ cls: "llm-bridge-codex-section-title", text: `Steps · ${steps.length}` });
    const list = section.createDiv({ cls: "llm-bridge-codex-step-list" });
    for (const step of steps) {
      const row = list.createDiv({ cls: `llm-bridge-codex-step-row is-${step.kind} is-${step.status}` });
      row.setAttribute("data-step-kind", step.kind);
      if (step.sourceRef?.itemId) row.setAttribute("data-item-id", step.sourceRef.itemId);
      const icon = row.createEl("span", { cls: "llm-bridge-codex-step-icon" });
      setIcon(icon, step.icon);
      const label = row.createDiv({ cls: "llm-bridge-codex-step-label", text: step.label, attr: { title: step.label } });
      const status = row.createDiv({ cls: `llm-bridge-codex-step-status is-${step.status}`, text: step.status });
      if (step.durationMs) row.createDiv({ cls: "llm-bridge-codex-step-duration", text: this.formatDurationMs(step.durationMs) });
      if (step.exitCode !== undefined) row.createDiv({ cls: "llm-bridge-codex-step-exit", text: `exit ${step.exitCode}` });
      this.renderCodexStepPayload(row, step, developerMode);
      if (developerMode) this.renderCodexSourceRef(row, step.sourceRef, developerMode);
      label.toggleClass("is-running", step.status === "running");
      status.toggleClass("is-hidden", false);
    }
  }

  private renderCodexDiagnosticsDrawer(
    parent: HTMLElement,
    diagnostics: ReadonlyArray<CodexRunDiagnosticsGroup>,
    developerMode: boolean,
  ): void {
    const total = diagnostics.reduce((sum, group) => sum + group.count, 0);
    const hasError = diagnostics.some((group) => group.severity === "error");
    const section = parent.createDiv({ cls: "llm-bridge-codex-diagnostics" });
    const head = section.createDiv({ cls: "llm-bridge-codex-diagnostics-head" });
    const toggle = head.createEl("span", { cls: "llm-bridge-codex-diagnostics-toggle", text: "▶" });
    const icon = head.createEl("span", { cls: "llm-bridge-codex-diagnostics-icon" });
    setIcon(icon, "triangle-alert");
    head.createEl("span", { cls: "llm-bridge-codex-diagnostics-summary", text: `${hasError ? "Issues" : "Warnings"} · ${total}` });
    const body = section.createDiv({ cls: "llm-bridge-codex-diagnostics-body", attr: { hidden: "" } });
    for (const diagnostic of diagnostics) {
      const item = body.createDiv({ cls: `llm-bridge-codex-diagnostic-item is-${diagnostic.severity}` });
      item.createDiv({ cls: "llm-bridge-codex-diagnostic-message", text: diagnostic.count > 1 ? `${diagnostic.message} (${diagnostic.count})` : diagnostic.message });
      if (developerMode) {
        this.renderCodexCollapsedText(item, "raw", formatCodexRunValue(diagnostic.raw ?? diagnostic));
      }
    }
    head.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggle.textContent = "▼";
      } else {
        body.setAttribute("hidden", "");
        toggle.textContent = "▶";
      }
    });
  }

  private renderCodexCollapsedText(parent: HTMLElement, label: string, value?: string): void {
    if (!value) return;
    const slug = label.replace(/\s+/g, "-");
    const displayLabel = label === "command" ? "Shell" : label === "stdout" ? "Output" : label === "stderr" ? "Error output" : label;
    const bodyText = label === "command" ? `$ ${value}` : value;
    const details = parent.createEl("details", { cls: `llm-bridge-codex-detail llm-bridge-codex-detail-${slug}` });
    const lines = value.split(/\r?\n/).filter((line) => line.length > 0).length || 1;
    const bytes = new TextEncoder().encode(value).length;
    const sizeText = bytes >= 1024 ? `${Math.round(bytes / 102.4) / 10} KB` : `${bytes} B`;
    details.createEl("summary", { text: `${displayLabel} · ${lines} line${lines === 1 ? "" : "s"} · ${sizeText}` });
    const panel = details.createDiv({ cls: "llm-bridge-codex-detail-panel" });
    panel.createDiv({ cls: "llm-bridge-codex-detail-panel-title", text: displayLabel });
    panel.createEl("pre", { cls: "llm-bridge-codex-detail-pre", text: bodyText });
  }

  private renderCodexStepPayload(
    parent: HTMLElement,
    step: CodexRunStepGroup,
    developerMode: boolean,
    options: { inlineShellPanel?: boolean } = {},
  ): void {
    if (step.kind === "command" || step.command) {
      if (options.inlineShellPanel) {
        this.renderCodexShellPanel(parent, step);
      } else {
        this.renderCodexShellDetails(parent, step);
      }
    } else {
      this.renderCodexCollapsedText(parent, "stdout", step.stdout);
      this.renderCodexCollapsedText(parent, "stderr", step.stderr);
    }
    if (step.cwd && developerMode) parent.createDiv({ cls: "llm-bridge-codex-step-cwd", text: `cwd: ${step.cwd}`, attr: { title: step.cwd } });
    if (developerMode) {
      this.renderCodexCollapsedText(parent, "args", step.args);
      this.renderCodexCollapsedText(parent, "structured result", formatCodexRunValue(step.structuredResult));
      this.renderCodexCollapsedText(parent, "content items", formatCodexRunValue(step.contentItems));
    }
  }

  private formatCodexShellCommandPreview(command?: string): string {
    if (!command?.trim()) return "";
    let preview = command
      .replace(/\s+/g, " ")
      .trim();
    const isWrappedShell = /^(?:"[^"]*(?:powershell|pwsh)(?:\.exe)?"|(?:powershell|pwsh)(?:\.exe)?)(?:\s|$)/i.test(preview);
    if (isWrappedShell) {
      const commandArgMatch = preview.match(/\s-(?:Command|c)\s+([\s\S]+)$/i);
      if (commandArgMatch?.[1]) {
        preview = commandArgMatch[1].trim();
      }
    }
    if ((preview.startsWith("'") && preview.endsWith("'")) || (preview.startsWith("\"") && preview.endsWith("\""))) {
      preview = preview.slice(1, -1).trim();
    }
    return preview
      .replace(/[A-Za-z]:\\[^\s·]+/g, (match) => path.basename(match))
      .trim();
  }

  private renderCodexShellDetails(parent: HTMLElement, step: CodexRunStepGroup): void {
    const commandText = this.formatCodexShellCommandPreview(step.command);
    const panelText = this.buildCodexShellPanelText(step);
    if (!panelText) return;
    const details = parent.createEl("details", { cls: "llm-bridge-codex-detail llm-bridge-codex-detail-command llm-bridge-codex-detail-shell" });
    const summaryText = commandText || panelText;
    const { lines, sizeText } = this.getCodexShellTextStats(panelText);
    details.createEl("summary", {
      text: commandText
        ? `Shell · ${truncateText(commandText, 72)}`
        : `Shell · ${lines} line${lines === 1 ? "" : "s"} · ${sizeText}`,
      attr: { title: commandText || summaryText },
    });
    const panel = details.createDiv({ cls: "llm-bridge-codex-detail-panel llm-bridge-codex-shell-panel" });
    this.renderCodexShellPanelContents(panel, step);
  }

  private renderCodexShellPanel(parent: HTMLElement, step: CodexRunStepGroup): void {
    const panelText = this.buildCodexShellPanelText(step);
    if (!panelText) return;
    const panel = parent.createDiv({ cls: "llm-bridge-codex-shell-panel llm-bridge-codex-inline-shell-panel" });
    this.renderCodexShellPanelContents(panel, step);
    const footer = panel.createDiv({ cls: "llm-bridge-codex-shell-footer" });
    const ok = step.status !== "failed" && (step.exitCode === undefined || step.exitCode === 0);
    footer.createEl("span", { cls: ok ? "is-success" : "is-failed", text: ok ? "✓ 成功" : "失败" });
  }

  private renderCodexShellPanelContents(parent: HTMLElement, step: CodexRunStepGroup): void {
    const commandText = this.formatCodexShellCommandPreview(step.command);
    const panelText = this.buildCodexShellPanelText(step);
    if (!panelText) return;
    this.renderCodexShellPanelHead(parent, commandText, panelText);
    parent.createEl("pre", {
      cls: "llm-bridge-codex-detail-pre llm-bridge-codex-shell-pre",
      text: panelText,
      attr: { title: panelText.length > 240 ? panelText : "" },
    });
  }

  private renderCodexShellPanelHead(parent: HTMLElement, commandText: string, panelText: string): void {
    const { lines, sizeText } = this.getCodexShellTextStats(panelText);
    const head = parent.createDiv({ cls: "llm-bridge-codex-shell-panel-head" });
    head.createDiv({ cls: "llm-bridge-codex-detail-panel-title", text: "Shell" });
    head.createDiv({
      cls: "llm-bridge-codex-shell-panel-meta",
      text: panelText
        ? `${lines} line${lines === 1 ? "" : "s"} · ${sizeText}`
        : commandText
          ? "command only"
          : "",
    });
  }

  private getCodexShellTextStats(bodyText: string): { lines: number; sizeText: string } {
    const lines = bodyText.split(/\r?\n/).filter((line) => line.length > 0).length || 1;
    const bytes = new TextEncoder().encode(bodyText).length;
    const sizeText = bytes >= 1024 ? `${Math.round(bytes / 102.4) / 10} KB` : `${bytes} B`;
    return { lines, sizeText };
  }

  private buildCodexShellOutputText(step: CodexRunStepGroup): string {
    const sections: string[] = [];
    if (step.stdout?.trim()) sections.push(step.stdout.trimEnd());
    if (step.stderr?.trim()) sections.push(step.stderr.trimEnd());
    return sections.join("\n\n").trim();
  }

  private buildCodexShellPanelText(step: CodexRunStepGroup): string {
    const commandText = this.formatCodexShellCommandPreview(step.command);
    const outputText = this.buildCodexShellOutputText(step);
    if (commandText && outputText) return `$ ${commandText}\n${outputText}`.trim();
    if (commandText) return `$ ${commandText}`;
    return outputText;
  }

  private renderCodexSourceRef(parent: HTMLElement, sourceRef?: import("./runtime/core/types").RuntimeSourceRef, developerMode = false): void {
    if (!developerMode || !sourceRef) return;
    const parts = [
      sourceRef.threadId ? `threadId=${sourceRef.threadId}` : "",
      sourceRef.turnId ? `turnId=${sourceRef.turnId}` : "",
      sourceRef.itemId ? `itemId=${sourceRef.itemId}` : "",
      sourceRef.parentItemId ? `parentItemId=${sourceRef.parentItemId}` : "",
      sourceRef.serverRequestId !== undefined ? `serverRequestId=${sourceRef.serverRequestId}` : "",
      sourceRef.method ? `method=${sourceRef.method}` : "",
      sourceRef.sequence !== undefined ? `sequence=${sourceRef.sequence}` : "",
    ].filter(Boolean).join(" · ");
    if (parts) parent.createDiv({ cls: "llm-bridge-codex-source-ref", text: parts });
  }

  /**
   * V16.4: 渲染阶段化执行视图（普通用户态主链路）。
   * completed phase 默认折叠；running/failed phase 默认展开。
   */
  private renderPhaseView(parent: HTMLElement, phaseModel: RunPhaseModel): void {
    const phaseList = parent.createDiv({ cls: "llm-bridge-phase-list" });
    for (const phase of phaseModel.phases) {
      this.renderPhaseCard(phaseList, phase);
    }
  }

  /**
   * V16.4: 渲染单个阶段卡片。
   */
  private renderPhaseCard(parent: HTMLElement, phase: RunPhase): void {
    const card = parent.createDiv({ cls: `llm-bridge-phase-card is-${phase.type} is-${phase.status}` });
    const head = card.createDiv({ cls: "llm-bridge-phase-head" });

    // 折叠箭头
    const toggle = head.createEl("span", {
      cls: "llm-bridge-phase-toggle",
      text: phase.defaultExpanded ? "▼ " : "▶ ",
    });

    // Lucide 图标
    const iconSpan = head.createEl("span", { cls: "llm-bridge-phase-icon" });
    setIcon(iconSpan, getPhaseIconName(phase.type));

    // 标签
    head.createEl("span", { cls: "llm-bridge-phase-label", text: phase.label });

    // 状态
    const statusLabel = phase.status === "running" ? "running"
      : phase.status === "failed" ? "failed"
      : phase.status === "pending" ? "pending"
      : "completed";
    head.createEl("span", { cls: `llm-bridge-phase-status is-${phase.status}`, text: statusLabel });

    // 耗时
    if (phase.durationMs !== undefined && phase.durationMs > 0) {
      head.createEl("span", { cls: "llm-bridge-phase-duration", text: this.formatDurationMs(phase.durationMs) });
    }

    // body（折叠区域）
    const body = card.createDiv({ cls: "llm-bridge-phase-body" });
    if (!phase.defaultExpanded) body.setAttribute("hidden", "");

    // V16.4-D: thoughts — 连续 Markdown 块（不再每个 ThoughtSegment 一个灰块）
    // 合并同阶段所有 thoughts 为一个可折叠文本块，默认 ≤160px，点击展开完整内容
    if (phase.thoughts.length > 0) {
      const mergedText = phase.thoughts
        .map((t) => t.text)
        .filter((t) => t.trim().length > 0)
        .join("\n\n");
      if (mergedText.trim().length > 0) {
        const totalTokens = phase.thoughts.reduce((sum, t) => sum + (t.tokens ?? 0), 0);
        const thoughtWrap = body.createDiv({ cls: "llm-bridge-phase-reasoning" });
        // header: Reasoning · optional token count
        const reasoningHead = thoughtWrap.createDiv({ cls: "llm-bridge-phase-reasoning-head" });
        reasoningHead.createEl("span", { cls: "llm-bridge-phase-reasoning-label", text: "Reasoning" });
        if (totalTokens > 0) {
          reasoningHead.createEl("span", { cls: "llm-bridge-phase-reasoning-tokens", text: ` · ${totalTokens} tokens` });
        }
        const expandHint = reasoningHead.createEl("span", { cls: "llm-bridge-phase-reasoning-hint", text: " · click to expand" });
        expandHint.setAttribute("hidden", "");
        // content: 连续 pre-wrap 文本块（默认 ≤160px，超出截断）
        const contentEl = thoughtWrap.createDiv({ cls: "llm-bridge-phase-reasoning-content" });
        contentEl.setText(mergedText);
        // 点击 header 切换展开/折叠
        reasoningHead.style.cursor = "pointer";
        reasoningHead.addEventListener("click", () => {
          const isExpanded = thoughtWrap.classList.toggle("is-expanded");
          if (isExpanded) expandHint.removeAttribute("hidden");
          else expandHint.setAttribute("hidden", "");
        });
      }
    }

    // file changes（带 +N -M）
    for (const fc of phase.fileChanges) {
      const fcEl = body.createDiv({ cls: `llm-bridge-phase-file-change is-${fc.action}` });
      const fcHead = fcEl.createDiv({ cls: "llm-bridge-phase-file-change-head" });
      const fcIconSpan = fcHead.createEl("span", { cls: "llm-bridge-phase-file-change-icon" });
      const fcIconName = fc.action === "create" ? "file-plus" : fc.action === "delete" ? "file-minus" : "file-text";
      setIcon(fcIconSpan, fcIconName);
      const actionLabel = fc.action === "create" ? "Created" : fc.action === "delete" ? "Deleted" : "Modified";
      const basename = fc.path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? fc.path;
      // V16.4: +N -M 统计
      const statsParts: string[] = [];
      if (typeof fc.additions === "number" && fc.additions >= 0) statsParts.push(`+${fc.additions}`);
      if (typeof fc.deletions === "number" && fc.deletions >= 0) statsParts.push(`-${fc.deletions}`);
      const statsLabel = statsParts.length > 0 ? ` · ${statsParts.join(" ")}` : "";
      fcHead.createEl("span", { cls: "llm-bridge-phase-file-change-label", text: `${actionLabel} ${basename}${statsLabel}` });
    }

    // tools（普通用户态可见的；简洁标签）
    for (const tool of phase.tools) {
      const toolEl = body.createDiv({ cls: `llm-bridge-phase-tool is-${tool.status}` });
      const toolHead = toolEl.createDiv({ cls: "llm-bridge-phase-tool-head" });
      const toolIconSpan = toolHead.createEl("span", { cls: "llm-bridge-phase-tool-icon" });
      const iconCat = getToolIconCategory(tool.toolName);
      setIcon(toolIconSpan, iconCat.icon);
      // 普通用户态用简洁 label
      const label = this.toolDisplayLabelForPhase(tool.toolName, tool.toolInput);
      toolHead.createEl("span", { cls: "llm-bridge-phase-tool-label", text: label });
      if (tool.durationMs !== undefined && tool.durationMs > 0) {
        toolHead.createEl("span", { cls: "llm-bridge-phase-tool-duration", text: this.formatDurationMs(tool.durationMs) });
      }
      // V16.4-D: editing tool 无 pending approval → 显示自动批准来源
      const lowerToolName = tool.toolName.toLowerCase();
      const isEditingTool = /write|edit|str_replace|patch|create_file|update_file|insert|delete_file/.test(lowerToolName);
      if (isEditingTool && tool.status === "done") {
        const permMode = this.session?.permission.mode;
        const source = explainAutoApprovalSource(permMode);
        if (source) {
          toolHead.createEl("span", { cls: "llm-bridge-phase-tool-auto-approval", text: source, attr: { title: `权限模式 ${permMode} 自动批准此写入操作` } });
        }
      }
    }

    for (const req of phase.userInputRequests) {
      this.renderPhaseUserInputRequest(body, req);
    }

    // 折叠交互
    head.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggle.textContent = "▼ ";
      } else {
        body.setAttribute("hidden", "");
        toggle.textContent = "▶ ";
      }
    });
  }

  private renderPhaseUserInputRequest(
    parent: HTMLElement,
    req: UserInputRequestSegment,
  ): void {
    const draft = this.getUserInputDraft(req.requestId);
    const card = parent.createDiv({ cls: `llm-bridge-phase-user-input ${req.pending ? "is-pending" : "is-resolved"}` });
    const row = card.createDiv({ cls: "llm-bridge-phase-user-input-row" });
    row.createEl("span", {
      cls: "llm-bridge-phase-user-input-title",
      text: req.pending ? "Needs input" : "Input received",
    });
    row.createEl("span", {
      cls: "llm-bridge-phase-user-input-tool",
      text: req.pending ? "Clarification" : (req.response?.type === "submit" ? "Answered" : "Cancelled"),
    });

    const promptEl = card.createDiv({ cls: "llm-bridge-phase-user-input-prompt" });
    void MarkdownRenderer.render(this.app, req.prompt, promptEl, "", this).catch(() => {
      promptEl.empty();
      promptEl.setText(req.prompt);
    });

    let inputEl: HTMLInputElement | null = null;
    if (req.questions && req.questions.length > 0) {
      const questionsEl = card.createDiv({ cls: "llm-bridge-phase-user-input-questions" });
      for (const question of req.questions) {
        const qEl = questionsEl.createDiv({ cls: "llm-bridge-phase-user-input-question" });
        if (question.header) {
          qEl.createEl("div", { cls: "llm-bridge-phase-user-input-question-header", text: question.header });
        }
        qEl.createEl("div", { cls: "llm-bridge-phase-user-input-question-text", text: question.question });
        if (question.options.length > 0) {
          const optionsEl = qEl.createDiv({ cls: "llm-bridge-phase-user-input-options" });
          const selectedValue = draft.selections[question.id];
          for (const option of question.options) {
            const optionValue = option.value ?? option.label;
            const btn = optionsEl.createEl("button", {
              cls: `llm-bridge-phase-user-input-option${selectedValue === optionValue ? " is-selected" : ""}`,
              text: option.label,
              attr: {
                type: "button",
                ...(option.description ? { title: option.description } : {}),
              },
            });
            btn.addEventListener("click", (event) => {
              event.stopPropagation();
              draft.selections[question.id] = optionValue;
              const nextValue = this.composeUserInputDraftValue(req.questions ?? [], draft.selections);
              if (nextValue) {
                draft.value = nextValue;
                if (inputEl) inputEl.value = nextValue;
              }
              for (const el of Array.from(optionsEl.querySelectorAll(".llm-bridge-phase-user-input-option"))) {
                if (el instanceof HTMLElement) el.classList.remove("is-selected");
              }
              btn.classList.add("is-selected");
            });
          }
        }
      }
    }

    if (req.pending) {
      const composeEl = card.createDiv({ cls: "llm-bridge-phase-user-input-compose" });
      inputEl = composeEl.createEl("input", {
        cls: "llm-bridge-phase-user-input-input",
        attr: {
          type: req.inputType === "secret" ? "password" : "text",
          placeholder: req.placeholder ?? "Reply to continue",
          value: draft.value,
        },
      });
      const actions = composeEl.createDiv({ cls: "llm-bridge-phase-user-input-actions" });
      const submitBtn = actions.createEl("button", {
        cls: "llm-bridge-phase-user-input-btn is-submit",
        text: "Submit",
        attr: { type: "button" },
      });
      const cancelBtn = actions.createEl("button", {
        cls: "llm-bridge-phase-user-input-btn is-cancel",
        text: "Cancel",
        attr: { type: "button" },
      });
      const syncSubmitState = () => {
        if (!inputEl) return;
        submitBtn.toggleAttribute("disabled", inputEl.value.trim().length === 0);
      };
      inputEl.addEventListener("input", () => {
        draft.value = inputEl?.value ?? "";
        syncSubmitState();
      });
      inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (!submitBtn.hasAttribute("disabled")) submitBtn.click();
        }
      });
      submitBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const value = inputEl?.value.trim() ?? "";
        if (!value) return;
        this.resolveUserInputRequest(req.requestId, { type: "submit", value });
      });
      cancelBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.resolveUserInputRequest(req.requestId, { type: "cancel" });
      });
      syncSubmitState();
    } else if (req.response) {
      const resolvedText = req.response.type === "submit"
        ? (req.inputType === "secret" ? "Response submitted" : req.response.value)
        : "Request cancelled";
      card.createDiv({ cls: "llm-bridge-phase-user-input-response", text: resolvedText });
    }
  }

  /**
   * V16.4: 普通用户态阶段视图内的工具简洁标签。
   * 不含 raw JSON input/output。
   */
  private toolDisplayLabelForPhase(toolName: string, toolInput?: string): string {
    const lower = toolName.toLowerCase();
    const extractPath = (input?: string): string | null => {
      if (!input) return null;
      try {
        const parsed = JSON.parse(input);
        const p = parsed.file_path ?? parsed.notebook_path ?? parsed.path ?? parsed.pattern;
        if (typeof p === "string" && p.length > 0) {
          const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
          return parts[parts.length - 1] ?? p;
        }
      } catch {
        if (/[/\\]/.test(input)) {
          const parts = input.replace(/\\/g, "/").split("/").filter(Boolean);
          return parts[parts.length - 1] ?? null;
        }
      }
      return null;
    };
    if (/^read|getfile|file_read|view$/.test(lower) || lower === "read") {
      const p = extractPath(toolInput);
      return p ? `Read ${p}` : "Read";
    }
    if (/write|edit|str_replace|patch|update_file|insert/.test(lower)) {
      const p = extractPath(toolInput);
      return p ? `Write ${p}` : "Write";
    }
    if (/create_file/.test(lower)) {
      const p = extractPath(toolInput);
      return p ? `Created ${p}` : "Created";
    }
    if (/delete_file|remove/.test(lower)) {
      const p = extractPath(toolInput);
      return p ? `Deleted ${p}` : "Deleted";
    }
    if (/bash|execute|run|command|shell/.test(lower)) {
      return "Run command";
    }
    if (/grep|glob|search|ls|list/.test(lower)) {
      return "Search";
    }
    return toolName;
  }

  /**
   * P3: 渲染单个 AgentRunCard。纯 DOM 渲染，不含业务分类逻辑。
   */
  private renderAgentRunCard(parent: HTMLElement, card: AgentRunCard): void {
    switch (card.kind) {
      case "thinking":
        this.renderThinkingCard(parent, card);
        break;
      case "tool-call":
        this.renderToolCallCard(parent, card);
        break;
      case "file-change":
        this.renderFileChangeCard(parent, card);
        break;
      case "approval":
        this.renderApprovalCard(parent, card);
        break;
      case "user-input":
        this.renderUserInputCard(parent, card);
        break;
      case "warning":
        this.renderWarningCard(parent, card);
        break;
      case "error":
        this.renderErrorCard(parent, card);
        break;
      case "final-answer":
      case "debug-raw-event":
        // final-answer 由 msg content 渲染；debug-raw-event 由 debugView 渲染
        break;
    }
  }

  private renderThinkingCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "thinking" }>): void {
    const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-thinking" });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    content.createEl("div", { cls: "llm-bridge-tl-title", text: card.title });
    if (card.meta) content.createEl("div", { cls: "llm-bridge-tl-detail", text: card.meta });
    if (card.text) content.createEl("div", { cls: "llm-bridge-tl-thought-text", text: truncateText(card.text, 280) });
  }

  private renderToolCallCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "tool-call" }>): void {
    const iconCat = getToolIconCategory(card.toolName);
    const node = parent.createDiv({ cls: `llm-bridge-tl-node llm-bridge-tl-tool is-${card.status}` });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    const titleRow = content.createDiv({ cls: "llm-bridge-tl-tool-head" });
    titleRow.createEl("span", { cls: `llm-bridge-tl-tool-icon is-${iconCat.category}`, text: iconCat.icon });
    // P4-D: 普通用户态用简洁 label（如 "Read AGENTS.md"），developer mode 显示 raw toolName
    const displayLabel = (card as { label?: string }).label ?? card.toolName;
    titleRow.createEl("span", { cls: "llm-bridge-tl-tool-name", text: displayLabel });
    if (card.durationMs !== undefined) {
      titleRow.createEl("span", { cls: "llm-bridge-tl-tool-duration", text: this.formatDurationMs(card.durationMs) });
    }
    if (card.exitCode !== undefined) {
      titleRow.createEl("span", { cls: "llm-bridge-tl-tool-duration", text: `exit ${card.exitCode}` });
    }
    if (card.command) {
      const commandText = typeof card.command === "string" ? card.command : card.command.join(" ");
      content.createEl("div", { cls: "llm-bridge-tl-tool-input", text: `command: ${truncateText(commandText, 160)}`, attr: { title: commandText } });
    }
    if (card.cwd) {
      content.createEl("div", { cls: "llm-bridge-tl-tool-input", text: `cwd: ${truncateText(card.cwd, 160)}`, attr: { title: card.cwd } });
    }
    if (card.toolInput && !card.command) {
      const inputLabel = card.toolName === "mcpToolCall" || card.toolName === "dynamicToolCall" ? "args" : "input";
      content.createEl("div", { cls: "llm-bridge-tl-tool-input", text: `${inputLabel}: ${truncateText(card.toolInput, 160)}`, attr: { title: card.toolInput } });
    }
    for (const prog of card.progress) {
      const progEl = content.createDiv({ cls: "llm-bridge-tl-tool-progress" });
      const progText = prog.detail ? `${prog.label}: ${prog.detail}` : prog.label;
      progEl.createEl("span", { cls: "llm-bridge-tl-tool-progress-text", text: truncateText(progText, 120) });
    }
    this.renderCollapsedText(content, "stdout", card.stdout);
    this.renderCollapsedText(content, "stderr", card.stderr);
    if (!card.stdout && !card.stderr) {
      this.renderCollapsedText(content, "output", card.output);
    }
    this.renderCollapsedJson(content, "structured result", card.structuredResult);
    this.renderCollapsedJson(content, "content items", card.contentItems);
    this.renderSourceRefDetail(content, card);
  }

  private renderCollapsedText(parent: HTMLElement, label: string, value?: string): void {
    if (!value) return;
    const details = parent.createEl("details", { cls: "llm-bridge-tl-details" });
    details.createEl("summary", { text: `${label}: ${truncateText(value.replace(/\s+/g, " "), 120)}` });
    details.createEl("pre", { cls: "llm-bridge-tl-pre", text: value });
  }

  private renderCollapsedJson(parent: HTMLElement, label: string, value: unknown): void {
    if (value === undefined || value === null) return;
    let text = "";
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
    this.renderCollapsedText(parent, label, text);
  }

  private renderSourceRefDetail(parent: HTMLElement, card: AgentRunCard): void {
    if (!card.sourceRef) return;
    const parts = [
      card.sourceRef.threadId ? `threadId=${card.sourceRef.threadId}` : "",
      card.sourceRef.turnId ? `turnId=${card.sourceRef.turnId}` : "",
      card.sourceRef.itemId ? `itemId=${card.sourceRef.itemId}` : "",
      card.sourceRef.serverRequestId !== undefined ? `serverRequestId=${card.sourceRef.serverRequestId}` : "",
      card.sourceRef.method ? `method=${card.sourceRef.method}` : "",
      card.sourceRef.sequence !== undefined ? `sequence=${card.sourceRef.sequence}` : "",
    ].filter(Boolean).join(" · ");
    if (parts) parent.createEl("div", { cls: "llm-bridge-tl-detail", text: parts });
  }

  private renderFileChangeCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "file-change" }>): void {
    const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-file" });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    content.createEl("div", { cls: "llm-bridge-tl-title", text: card.title });
    if (card.approvalStatus) {
      content.createEl("div", { cls: "llm-bridge-tl-detail", text: `approval: ${card.approvalStatus}` });
    }
    if (card.changes && card.changes.length > 0) {
      for (const change of card.changes) {
        content.createEl("div", { cls: "llm-bridge-tl-detail", text: `${change.action} ${change.path}` });
      }
    } else {
      content.createEl("div", { cls: "llm-bridge-tl-detail", text: `${card.action} ${card.path}` });
    }
    this.renderCollapsedText(content, "diff", card.diff);
    this.renderSourceRefDetail(content, card);
  }

  private renderApprovalCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "approval" }>): void {
    if (card.pending) {
      const approval = parent.createDiv({ cls: `llm-bridge-turn-approval-card is-risk-${card.riskLevel}` });
      approval.setAttribute("data-request-id", card.requestId);
      const row = approval.createDiv({ cls: "llm-bridge-turn-approval-row" });
      row.createEl("span", { cls: "llm-bridge-turn-approval-title", text: card.label || card.summary || card.toolName });
      if (card.riskLevel !== "low") {
        row.createEl("span", {
          cls: `llm-bridge-turn-approval-risk is-${card.riskLevel}`,
          text: card.riskLevel === "high" ? "高风险" : "需确认",
        });
      }

      const actions = approval.createDiv({ cls: "llm-bridge-turn-approval-actions" });
      const createActionButton = (label: string, choice: PermissionChoice, extraClass: string): void => {
        const button = actions.createEl("button", {
          cls: `llm-bridge-turn-approval-btn ${extraClass}`,
          text: label,
          attr: { type: "button", "data-decision": choice },
        });
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.resolvePermissionRequests([card.requestId], choice);
        });
      };
      createActionButton("允许一次", "allow_once", "is-allow-once");
      createActionButton("本会话允许", "allow_session", "is-allow-session");
      createActionButton("拒绝", "deny_session", "is-deny");

      const detailItems: string[] = [];
      if (card.riskReason) detailItems.push(`风险：${card.riskReason}`);
      if (card.highRiskFlags && card.highRiskFlags.length > 0) {
        detailItems.push(`标记：${card.highRiskFlags.join(", ")}`);
      }
      if (card.inputSummary) detailItems.push(card.inputSummary);
      if (card.subagentRisk) detailItems.push(card.subagentRisk);
      if (detailItems.length > 0) {
        const details = approval.createDiv({ cls: "llm-bridge-turn-approval-details" });
        const toggle = details.createEl("button", {
          cls: "llm-bridge-turn-approval-details-toggle",
          text: "详情",
          attr: { type: "button" },
        });
        const detailBody = details.createDiv({
          cls: "llm-bridge-turn-approval-details-body",
          attr: { hidden: "" },
        });
        for (const line of detailItems) {
          detailBody.createEl("div", { cls: "llm-bridge-turn-approval-detail-item", text: line, attr: { title: line } });
        }
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          const hidden = detailBody.hasAttribute("hidden");
          if (hidden) {
            detailBody.removeAttribute("hidden");
            toggle.textContent = "Hide details";
          } else {
            detailBody.setAttribute("hidden", "");
            toggle.textContent = "Details";
          }
        });
      }
      return;
    }

    const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-approval" });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    const resolutionLabel = card.resolution?.type === "accept" ? "允许一次"
      : card.resolution?.type === "acceptForSession" ? "本会话允许"
      : card.resolution?.type === "decline" ? "已拒绝"
      : "已取消";
    const sourceLabel = card.resolutionSource === "session_allow" ? "（会话允许）"
      : card.resolutionSource === "session_deny" ? "（会话拒绝）"
      : card.resolutionSource === "mode" ? "（模式自动）"
      : "";
    content.createEl("div", { cls: "llm-bridge-tl-title", text: `权限: ${card.label || card.toolName} → ${resolutionLabel}${sourceLabel}` });
    if (card.inputSummary) {
      content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.inputSummary, 120) });
    }
  }

  private renderUserInputCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "user-input" }>): void {
    const node = parent.createDiv({ cls: `llm-bridge-tl-node llm-bridge-tl-user-input is-${card.status}` });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    content.createEl("div", { cls: "llm-bridge-tl-title", text: card.pending ? "Needs input" : "Input received" });
    content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.prompt, 240) });
    if (!card.pending && card.response?.type === "submit") {
      const responseText = card.inputType === "secret" ? "Response submitted" : card.response.value;
      content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(responseText, 180) });
    }
  }

  private renderWarningCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "warning" }>): void {
    const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-warning" });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    content.createEl("div", { cls: "llm-bridge-tl-title", text: card.title });
    content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.message, 280) });
  }

  private renderErrorCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "error" }>): void {
    const node = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-error" });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    content.createEl("div", { cls: "llm-bridge-tl-title is-error", text: card.title });
    content.createEl("div", { cls: "llm-bridge-tl-detail", text: truncateText(card.message, 280) });
  }

  /**
   * P3: 渲染 debugView（developer mode only）。汇总 provider session audit / attachment audit /
   * effectiveRunPlan / raw events，不散落在 appendMsgDetails。
   */
  private renderAgentRunDebugView(parent: HTMLElement, debug: AgentRunDebugView): void {
    // commandPreview
    if (debug.commandPreview && debug.commandPreview.length > 0) {
      this.appendCommandPreview(parent, debug.commandPreview);
    }
    // effectiveRunPlan
    if (debug.effectiveRunPlan) {
      this.appendEffectiveRunPlan(parent, debug.effectiveRunPlan);
    }
    // provider session audit
    if (debug.providerThreadId || debug.providerSessionId) {
      const auditBody = this.createCollapsibleSection(parent, "provider session", "llm-bridge-provider-session-audit", false);
      const lines: string[] = [];
      if (debug.providerThreadId) lines.push(`providerThreadId: ${debug.providerThreadId}`);
      if (debug.providerSessionId) lines.push(`providerSessionId: ${debug.providerSessionId}`);
      if (debug.sessionResumed) lines.push("sessionResumed: true（恢复的会话）");
      auditBody.createEl("pre", { cls: "llm-bridge-provider-session-audit-text", text: lines.join("\n") });
    }
    // attachment audit
    if (debug.attachmentPlan) {
      const ap = debug.attachmentPlan;
      const apBody = this.createCollapsibleSection(parent, "attachment audit", "llm-bridge-attachment-audit", false);
      const apLines = [
        `message-scoped refs: ${ap.messageScopedRefs}`,
        `pinned refs: ${ap.pinnedRefs}`,
        `inline snippets: ${ap.inlineSnippets}`,
        `image streaming blocks: ${ap.imageStreamingBlocks}`,
        `native ref only: ${ap.nativeRefOnly}`,
      ];
      if (ap.entries && ap.entries.length > 0) {
        apLines.push("", "entries:");
        for (const entry of ap.entries) {
          apLines.push(`  ${entry.refId} | ${entry.scope} | ${entry.fileType} | ${entry.packing} | ${entry.reason}`);
        }
      }
      apBody.createEl("pre", { cls: "llm-bridge-attachment-audit-text", text: apLines.join("\n") });
    }
    // V16.4-D: permission snapshot（developer mode 审计）
    if (debug.permissionSnapshot) {
      const ps = debug.permissionSnapshot;
      const psBody = this.createCollapsibleSection(parent, "sdk permission audit", "llm-bridge-perm-snapshot", false);
      const psLines: string[] = [];
      if (ps.configuredPermissionMode) psLines.push(`configured: ${ps.configuredPermissionMode}`);
      if (ps.effectivePermissionMode) psLines.push(`effective: ${ps.effectivePermissionMode}`);
      if (ps.sdkInitPermissionMode) psLines.push(`sdkInit: ${ps.sdkInitPermissionMode}`);
      if (ps.canUseToolCalled !== undefined) psLines.push(`canUseToolCalled: ${ps.canUseToolCalled}`);
      if (ps.approvalEvents && ps.approvalEvents.length > 0) {
        psLines.push("", "approvals:");
        for (const ev of ps.approvalEvents) {
          const src = ev.resolutionSource ? ` → ${ev.resolutionSource}` : "";
          psLines.push(`  ${ev.toolName} | ${ev.pending ? "pending" : "resolved"}${src}`);
        }
      }
      psBody.createEl("pre", { cls: "llm-bridge-perm-snapshot-text", text: psLines.join("\n") });
    }
    // raw provider events (developer-only)
    if (debug.rawProviderEvents && debug.rawProviderEvents.length > 0) {
      const rawBody = this.createCollapsibleSection(parent, `raw provider events (${debug.rawProviderEvents.length})`, "llm-bridge-raw-events", false);
      rawBody.createEl("pre", { cls: "llm-bridge-raw-events-text", text: debug.rawProviderEvents.map((e) => JSON.stringify(e)).slice(0, 50).join("\n") });
    }
    // legacy: Workflow Trace（keep as developer log; remove or migrate in P4）
    if (debug.workflowTrace && debug.workflowTrace.length > 0) {
      this.appendWorkflowTrace(parent, debug.workflowTrace);
    }
    // legacy: SDK events（keep as developer log; remove or migrate in P4）
    if (debug.sdkEvents && debug.sdkEvents.length > 0) {
      this.appendSdkWorkflow(parent, debug.sdkEvents as ReadonlyArray<import("./workflowEvent").WorkflowEvent>);
      this.updateLastSdkStats(debug.sdkEvents as ReadonlyArray<import("./workflowEvent").WorkflowEvent>);
    }
  }


  // V1.5: 渲染命令预览区（command / args / cwd / model / stdin / selection / note / env）
  private appendCommandPreview(
    parent: HTMLElement,
    rows: ReadonlyArray<{ label: string; value: string }>,
  ): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-cmd-preview" });
    const head = wrap.createDiv({ cls: "llm-bridge-cmd-preview-head" });
    head.createEl("span", { cls: "llm-bridge-cmd-preview-toggle", text: "▶ Command" });
    // 复制命令按钮
    const copyCmdBtn = head.createEl("button", {
      cls: "llm-bridge-cmd-preview-copy",
      text: "复制命令",
      attr: { title: "复制脱敏命令行（不含 secret / prompt 内容）" },
    });
    copyCmdBtn.addEventListener("click", async () => {
      try {
        const line = this.buildRedactedCommandLineFromRows(rows);
        await navigator.clipboard.writeText(line);
        new Notice("已复制命令行");
      } catch {
        new Notice("复制失败");
      }
    });

    // V2.4: Command Preview 默认折叠（与 Workflow Trace / SDK Workflow 一致，减少首屏噪音）
    const body = wrap.createDiv({ cls: "llm-bridge-cmd-preview-body", attr: { hidden: "" } });
    for (const row of rows) {
      const rowEl = body.createDiv({ cls: "llm-bridge-cmd-preview-row" });
      rowEl.createEl("span", { cls: "llm-bridge-cmd-preview-label", text: row.label });
      rowEl.createEl("code", { cls: "llm-bridge-cmd-preview-value", text: row.value });
    }
    // 折叠交互
    const toggle = head.querySelector(".llm-bridge-cmd-preview-toggle")!;
    toggle.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggle.textContent = "▼ Command";
      } else {
        body.setAttribute("hidden", "");
        toggle.textContent = "▶ Command";
      }
    });
  }

  // V2.17-A: 渲染 EffectiveRunPlan 面板（Developer mode 审计用）
  private appendEffectiveRunPlan(parent: HTMLElement, plan: EffectiveRunPlan): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-cmd-preview llm-bridge-effective-plan" });
    const head = wrap.createDiv({ cls: "llm-bridge-cmd-preview-head" });
    head.createEl("span", { cls: "llm-bridge-cmd-preview-toggle", text: "▶ Effective options" });
    const body = wrap.createDiv({ cls: "llm-bridge-cmd-preview-body", attr: { hidden: "" } });
    for (const row of formatEffectiveRunPlan(plan)) {
      const rowEl = body.createDiv({ cls: "llm-bridge-cmd-preview-row" });
      rowEl.createEl("span", { cls: "llm-bridge-cmd-preview-label", text: row.label });
      rowEl.createEl("code", { cls: "llm-bridge-cmd-preview-value", text: row.value });
    }
    const toggle = head.querySelector(".llm-bridge-cmd-preview-toggle")!;
    toggle.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggle.textContent = "▼ Effective options";
      } else {
        body.setAttribute("hidden", "");
        toggle.textContent = "▶ Effective options";
      }
    });
  }

  // V1.5: 从 preview rows 构造脱敏命令行字符串（用于复制）
  private buildRedactedCommandLineFromRows(rows: ReadonlyArray<{ label: string; value: string }>): string {
    const get = (label: string) => rows.find((r) => r.label === label)?.value ?? "";
    const command = get("command");
    const args = get("args");
    const cwd = get("cwd");
    const model = get("model");
    const stdin = get("stdin");
    const parts = [command, args === "(none)" ? "" : args].filter((s) => s.length > 0);
    return `${parts.join(" ")}  # cwd: ${cwd} | model: ${model} | stdin: ${stdin}`;
  }

  // V1.8: 创建默认折叠的可展开区域（减少噪音，AI 最终答案已在 content 优先显示）
  // 用于 workflow trace / timeline / sdk workflow，默认 startOpen=false
  private createCollapsibleSection(
    parent: HTMLElement,
    title: string,
    cls: string,
    startOpen = false,
  ): HTMLElement {
    const wrap = parent.createDiv({ cls: `llm-bridge-collapse-section ${cls}` });
    const head = wrap.createDiv({ cls: "llm-bridge-collapse-section-head" });
    const toggle = head.createEl("span", {
      cls: "llm-bridge-collapse-section-toggle",
      text: `${startOpen ? "▼" : "▶"} ${title}`,
    });
    const body = wrap.createDiv({ cls: "llm-bridge-collapse-section-body" });
    if (!startOpen) body.setAttribute("hidden", "");
    toggle.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggle.textContent = `▼ ${title}`;
      } else {
        body.setAttribute("hidden", "");
        toggle.textContent = `▶ ${title}`;
      }
    });
    return body;
  }

  // V1.5: 渲染 Workflow Trace 区域（preflight → build_prompt → spawn → stdout/stderr → file_diff_scan → 终态）
  // V1.8: 默认折叠（减少噪音），点击 ▶ 展开
  private appendWorkflowTrace(
    parent: HTMLElement,
    trace: ReadonlyArray<{ stage: string; timestamp: string; detail: string; status: string }>,
  ): void {
    const body = this.createCollapsibleSection(parent, "Workflow Trace", "llm-bridge-workflow-trace");
    for (const entry of trace) {
      const stage = entry.stage as WorkflowTraceStage;
      const item = body.createDiv({
        cls: `llm-bridge-workflow-trace-item ${workflowStageClass(stage)} is-${entry.status}`,
      });
      item.createEl("span", { cls: "llm-bridge-workflow-trace-dot" });
      const text = item.createDiv({ cls: "llm-bridge-workflow-trace-text" });
      text.createEl("span", { cls: "llm-bridge-workflow-trace-label", text: workflowStageLabel(stage) });
      if (entry.detail) {
        // V2.10 (B-002): 加 title 属性，CSS 截断后鼠标悬停可看完整内容
        text.createEl("span", { cls: "llm-bridge-workflow-trace-detail", text: entry.detail, attr: { title: entry.detail } });
      }
      const time = new Date(entry.timestamp).toLocaleTimeString();
      text.createEl("span", { cls: "llm-bridge-workflow-trace-time", text: time });
    }
  }

  // V2.0: 渲染 SDK 工作流事件（按阶段分组：thinking/message/tool/file/permission/error/terminal）
  // V1.8: 默认折叠（SDK experimental 为开发者功能，减少主 UI 噪音）
  // V2.3: 按 agent/subagent 分组展示（主 agent vs subagent，工具与消息附带 agent 标签）
  /**
   * V2.16-C: 实时追加 SDK 事件到当前 assistant message 的 timeline 区域
   *
   * 基于 timelineAdapter 将事件分类合并为现代 Claude/Codex 风格垂直 timeline
   * 运行中 timeline 始终展开；终态后由 appendSdkWorkflow 渲染折叠摘要
   */
  private appendLiveSdkEvent(ev: WorkflowEvent): void {
    if (!this.currentAssistantId) return;
    this.liveAggregator.ingest(ev);
    if (ev.type === "completed" || ev.type === "failed") return;
    this.scheduleLiveTimelineRender();
  }

  private scheduleLiveTimelineRender(): void {
    if (this.liveTimelineTimerId !== null) return;
    this.liveTimelineTimerId = window.setTimeout(() => {
      this.liveTimelineTimerId = null;
      this.renderLiveTimeline();
    }, 120);
  }

  /**
   * V2.16-C: 渲染实时 timeline（运行中，始终展开当前步骤）
   */
  private renderLiveTimeline(): void {
    if (!this.currentAssistantId) return;
    const block = this.messagesEl.querySelector<HTMLElement>('[data-msg-id="' + this.currentAssistantId + '"]');
    if (!block) return;
    block.querySelector<HTMLElement>(".llm-bridge-process-placeholder")?.remove();
    let liveEl = Array.from(block.children).find((el) => el instanceof HTMLElement && el.hasClass("llm-bridge-timeline-live")) as HTMLElement | undefined;
    if (!liveEl) {
      liveEl = block.createDiv({ cls: "llm-bridge-timeline llm-bridge-timeline-live", attr: { "data-live": "true" } });
    }
    const contentEl = block.querySelector<HTMLElement>(".llm-bridge-msg-content");
    if (contentEl && liveEl.parentElement === block && liveEl.nextElementSibling !== contentEl) {
      block.insertBefore(liveEl, contentEl);
    }
    const nodes = this.filterUserFacingTimelineNodes(this.liveAggregator.toTimelineNodes());
    liveEl.empty();
    liveEl.createDiv({
      cls: "llm-bridge-timeline-live-head",
      text: `过程 · 运行中${nodes.length > 0 ? ` · ${nodes.length} steps` : ""}`,
    });
    const nodeHost = liveEl.createDiv({ cls: "llm-bridge-timeline-live-nodes" });
    if (nodes.length === 0) {
      nodeHost.createDiv({
        cls: "llm-bridge-timeline-waiting",
        text: "正在等待 SDK 首个 stream/progress 事件...",
      });
    } else {
      for (const node of nodes) {
        this.renderTimelineNode(nodeHost, node, true);
      }
    }
    this.scrollToBottom();
  }

  /** V2.16-C: 工具图标 + 颜色分类（read/write/bash/search/skill/other） */
  private getToolIconAndCategory(toolName: string): { icon: string; category: string } {
    const n = (toolName || "").toLowerCase();
    if (n === "bash") return { icon: "$", category: "bash" };
    if (n === "read") return { icon: "R", category: "read" };
    if (n === "write") return { icon: "W", category: "write" };
    if (n === "edit" || n === "multiedit") return { icon: "E", category: "write" };
    if (n === "glob") return { icon: "G", category: "search" };
    if (n === "grep") return { icon: "F", category: "search" };
    if (n === "skill") return { icon: "S", category: "skill" };
    if (n === "notebookedit") return { icon: "N", category: "write" };
    return { icon: "\u2022", category: "other" };
  }

  /** V2.16-C: 让元素可点击展开/收起（shortText 截断版，fullText 全文） */
  private makeExpandable(el: HTMLElement, shortText: string, fullText: string): void {
    if (fullText.length <= shortText.length) return;
    el.textContent = shortText;
    el.addClass("is-collapsed");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (el.hasClass("is-collapsed")) {
        el.textContent = fullText;
        el.removeClass("is-collapsed");
        el.addClass("is-expanded");
      } else {
        el.textContent = shortText;
        el.removeClass("is-expanded");
        el.addClass("is-collapsed");
      }
    });
  }

  /**
   * V2.16-C: 渲染单个 timeline node（现代 Claude/Codex 风格垂直节点）
   */
  private filterUserFacingTimelineNodes(nodes: TimelineNode[]): TimelineNode[] {
    if (this.plugin.settings.developerMode) return nodes;
    const completedToolNames = new Set(
      nodes
        .filter((node) => node.kind === "tool_call" && node.toolName)
        .map((node) => (node.toolName ?? "").toLowerCase()),
    );
    return nodes.filter((node) => {
      if (node.kind === "session_started") return false;
      if (node.kind === "agent") return false;
      if (node.kind === "progress" && node.progressCategory === "tool") {
        if (node.progressLabel === "Preparing tool input") return false;
        const preparingMatch = node.progressLabel?.match(/^Preparing\s+(.+)$/i);
        if (preparingMatch && completedToolNames.has(preparingMatch[1].toLowerCase())) return false;
      }
      if (node.kind === "tool_call" && node.toolInput) {
        const toolPath = extractToolPath(node.toolName ?? "", node.toolInput);
        if (toolPath && isInternalFilePath(toolPath)) return false;
      }
      if (node.kind === "file_change" && node.filePath && isInternalFilePath(node.filePath)) return false;
      return true;
    });
  }

  private renderTimelineNode(parent: HTMLElement, node: TimelineNode, isLive: boolean): void {
    const item = parent.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-" + node.kind });
    item.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = item.createDiv({ cls: "llm-bridge-tl-content" });
    if (node.kind === "session_started") {
      content.createEl("div", { cls: "llm-bridge-tl-title", text: "Session started" });
      if (node.text) content.createEl("div", { cls: "llm-bridge-tl-detail", text: node.text, attr: { title: node.text } });
    } else if (node.kind === "progress") {
      content.createEl("div", { cls: "llm-bridge-tl-title", text: node.progressLabel ?? "Progress" });
      if (node.progressDetail) {
        content.createEl("div", {
          cls: "llm-bridge-tl-detail",
          text: truncateText(node.progressDetail, 160),
          attr: { title: node.progressDetail },
        });
      }
    } else if (node.kind === "thought") {
      // V2.16-D: 思考过程默认折叠为一行摘要，点击展开全文（Claude Code 风格）
      const detailText = node.text ?? "";
      const hasDetail = detailText.trim().length > 0;
      const titleEl = content.createDiv({ cls: "llm-bridge-tl-title llm-bridge-tl-thinking-title llm-bridge-tl-expandable" });
      titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-icon", text: "💭" });
      titleEl.createEl("span", { text: "Thinking" });
      if (isLive) titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-star", text: "•" });
      if (node.progressDetail) {
        titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-meta", text: `· ${node.progressDetail}` });
      } else if (hasDetail) {
        // 摘要：取首行前 80 字符
        const firstLine = detailText.split(/\r?\n/)[0] ?? "";
        const summary = truncateText(firstLine, 80);
        titleEl.createEl("span", { cls: "llm-bridge-tl-thinking-meta", text: `· ${summary}` });
      }
      if (hasDetail) {
        const thoughtEl = content.createEl("div", { cls: "llm-bridge-tl-thought-body", attr: { hidden: "" } });
        thoughtEl.createEl("div", { cls: "llm-bridge-tl-thought-text", text: detailText });
        // 点击标题切换展开
        titleEl.addEventListener("click", (e) => {
          e.stopPropagation();
          const hidden = thoughtEl.hasAttribute("hidden");
          if (hidden) { thoughtEl.removeAttribute("hidden"); titleEl.addClass("is-expanded"); }
          else { thoughtEl.setAttribute("hidden", ""); titleEl.removeClass("is-expanded"); }
        });
      } else {
        content.createEl("div", {
          cls: "llm-bridge-tl-thought-text is-placeholder",
          text: isLive ? "Reasoning in progress..." : "Reasoning details were not provided by the SDK.",
        });
      }
    } else if (node.kind === "agent") {
      if (node.isSubagent) content.createEl("span", { cls: "llm-bridge-tl-agent-tag is-subagent", text: "Subagent" });
      content.createEl("div", { cls: "llm-bridge-tl-agent-text", text: truncateText(node.text ?? "", 200), attr: { title: node.text ?? "" } });
    } else if (node.kind === "tool_call") {
      // V2.16-D: 工具调用卡片化 — head 紧凑一行 + 结构化参数 + 折叠结果
      const toolInfo = this.getToolIconAndCategory(node.toolName ?? "");
      item.addClass("llm-bridge-tl-tool-cat-" + toolInfo.category);
      const headEl = content.createDiv({ cls: "llm-bridge-tl-tool-head" });
      headEl.createEl("span", { cls: "llm-bridge-tl-tool-badge", text: toolInfo.icon });
      headEl.createEl("span", { cls: "llm-bridge-tl-tool-name", text: node.toolName ?? "unknown" });
      // 状态标记：运行中无标记；成功无标记；错误 ✗
      if (node.toolError) headEl.createEl("span", { cls: "llm-bridge-tl-tool-err", text: "✗" });
      // 路径直接放 head 行（basename 紧凑，title 全路径）
      if (node.toolInput) {
        const path = extractToolPath(node.toolName ?? "", node.toolInput);
        if (path) {
          headEl.createEl("code", { cls: "llm-bridge-tl-tool-path-inline", text: pathBasename(path), attr: { title: path } });
        }
      }
      // 耗时右对齐
      if (node.durationMs !== undefined && node.durationMs > 0) {
        headEl.createEl("span", { cls: "llm-bridge-tl-tool-duration", text: this.formatDurationMs(node.durationMs) });
      }
      // 结构化参数（key-value，跳过已展示的 path）
      if (node.toolInput) {
        const params = extractToolParams(node.toolName ?? "", node.toolInput);
        if (params.length > 0) {
          const paramsEl = content.createDiv({ cls: "llm-bridge-tl-tool-params" });
          for (const p of params) {
            const row = paramsEl.createDiv({ cls: "llm-bridge-tl-tool-param-row" });
            row.createEl("span", { cls: "llm-bridge-tl-tool-param-key", text: p.key });
            row.createEl("span", { cls: "llm-bridge-tl-tool-param-val", text: p.value, attr: { title: p.value } });
          }
        }
      }
      // 结果：默认折叠，显示行数提示
      if (node.toolOutput) {
        const lineCount = countLines(node.toolOutput);
        const outputWrap = content.createDiv({ cls: "llm-bridge-tl-tool-output-wrap llm-bridge-tl-expandable" });
        const outputHead = outputWrap.createDiv({ cls: "llm-bridge-tl-tool-output-head" });
        outputHead.createEl("span", { cls: "llm-bridge-tl-tool-output-toggle", text: "▶" });
        outputHead.createEl("span", { cls: "llm-bridge-tl-tool-output-label", text: `Output${lineCount > 1 ? ` · ${lineCount} lines` : ""}` });
        const outputBody = outputWrap.createDiv({ cls: "llm-bridge-tl-tool-output-body", attr: { hidden: "" } });
        const pre = outputBody.createEl("pre", { cls: "llm-bridge-tl-tool-output" });
        pre.textContent = node.toolOutput;
        if (node.toolError) pre.addClass("is-error");
        outputHead.addEventListener("click", (e) => {
          e.stopPropagation();
          const hidden = outputBody.hasAttribute("hidden");
          if (hidden) {
            outputBody.removeAttribute("hidden");
            outputHead.querySelector(".llm-bridge-tl-tool-output-toggle")!.textContent = "▼";
          } else {
            outputBody.setAttribute("hidden", "");
            outputHead.querySelector(".llm-bridge-tl-tool-output-toggle")!.textContent = "▶";
          }
        });
      }
    } else if (node.kind === "file_change") {
      // V2.16-D: 文件变更用符号图标 + basename + 动词颜色
      const symbol = node.fileAction === "create" ? "+" : node.fileAction === "modify" ? "~" : "-";
      const verb = node.fileAction === "create" ? "Created" : node.fileAction === "modify" ? "Modified" : "Deleted";
      const headEl = content.createDiv({ cls: "llm-bridge-tl-file-head llm-bridge-tl-file-action-" + (node.fileAction ?? "modify") });
      headEl.createEl("span", { cls: "llm-bridge-tl-file-symbol", text: symbol });
      headEl.createEl("span", { cls: "llm-bridge-tl-file-action", text: verb });
      const full = node.filePath ?? "";
      headEl.createEl("code", { cls: "llm-bridge-tl-file-path", text: pathBasename(full), attr: { title: full } });
    } else if (node.kind === "warning") {
      content.createEl("span", { cls: "llm-bridge-tl-warning-icon", text: "⚠" });
      content.createEl("span", { cls: "llm-bridge-tl-warning-text", text: truncateText(node.message ?? "", 120), attr: { title: node.message ?? "" } });
    } else if (node.kind === "error") {
      content.createEl("span", { cls: "llm-bridge-tl-error-icon", text: "✗" });
      content.createEl("span", { cls: "llm-bridge-tl-error-text", text: truncateText(node.message ?? "", 200), attr: { title: node.message ?? "" } });
    } else if (node.kind === "completed") {
      const stats = computeTimelineStats(this.liveAggregator.toTimelineNodes());
      // V2.16-D: chip 形式摘要
      const chipsEl = content.createDiv({ cls: "llm-bridge-tl-completed-chips" });
      chipsEl.createEl("span", { cls: "llm-bridge-tl-chip llm-bridge-tl-chip-success", text: "✓ Completed" });
      if (stats.toolCount > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${stats.toolCount} tool${stats.toolCount > 1 ? "s" : ""}` });
      if (stats.fileChangeCount > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${stats.fileChangeCount} file${stats.fileChangeCount > 1 ? "s" : ""}` });
      if (stats.thoughtCount > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${stats.thoughtCount} thinking` });
      if (stats.durationMs !== undefined && stats.durationMs > 0) {
        const secs = Math.round(stats.durationMs / 1000);
        if (secs > 0) chipsEl.createEl("span", { cls: "llm-bridge-tl-chip", text: `${secs}s` });
      }
    } else if (node.kind === "failed") {
      const allNodes = this.liveAggregator.toTimelineNodes();
      content.createEl("div", { cls: "llm-bridge-tl-failed", text: formatFailedSummary(allNodes), attr: { title: node.message ?? "" } });
    }
  }

  private appendSdkWorkflow(
    parent: HTMLElement,
    events: ReadonlyArray<WorkflowEvent>,
    options: { processOnly?: boolean } = {},
  ): void {
    // V2.17-A: 用 RunStateAggregator 聚合（单 thinking block / tool_progress 合并 / 无重复 final message）
    // 历史消息 / 完成态渲染均走此路径，与实时 renderLiveTimeline 一致
    const nodes = this.filterUserFacingTimelineNodes(aggregateEventsToTimeline(events));
    const visibleNodes = nodes;
    if (visibleNodes.length === 0 && options.processOnly) return;
    const stats = computeTimelineStats(nodes);
    const hasFailed = nodes.some((n) => n.kind === "failed" || n.kind === "error");
    const summary = options.processOnly
      ? this.formatProcessSummary(stats)
      : hasFailed ? formatFailedSummary(nodes) : formatCompletedSummary(stats);

    // 折叠区容器：completed 后默认折叠（只保留摘要），failed 时展开错误
    const wrap = parent.createDiv({ cls: "llm-bridge-timeline-wrap" });
    // V2.16-D: completed 后隐藏 live timeline（仅保留折叠摘要），避免过程与摘要同时展示
    const block = parent.parentElement;
    if (block) {
      const liveSibling = block.querySelector<HTMLElement>(".llm-bridge-timeline-live");
      if (liveSibling) liveSibling.setAttribute("hidden", "");
    }
    const headEl = wrap.createDiv({ cls: "llm-bridge-timeline-head" });
    headEl.createEl("span", { cls: "llm-bridge-timeline-toggle", text: hasFailed ? "▼ " : "▶ " });
    headEl.createEl("span", { cls: "llm-bridge-timeline-summary", text: summary });

    // timeline body：completed 默认折叠，failed 默认展开
    const bodyEl = wrap.createDiv({ cls: "llm-bridge-timeline-body" });
    if (!hasFailed) bodyEl.setAttribute("hidden", "");

    // 渲染完整 timeline
    const timelineEl = bodyEl.createDiv({ cls: "llm-bridge-timeline llm-bridge-timeline-final" });
    for (const node of visibleNodes) {
      this.renderTimelineNode(timelineEl, node, false);
    }

    let rawToggle: Element | null = null;
    let rawContent: HTMLElement | null = null;
    if (this.plugin.settings.developerMode) {
      // raw log 默认折叠；普通用户态不渲染
      const rawBody = bodyEl.createDiv({ cls: "llm-bridge-timeline-raw" });
      const rawHead = rawBody.createDiv({ cls: "llm-bridge-timeline-raw-head" });
      rawHead.createEl("span", { cls: "llm-bridge-timeline-raw-toggle", text: "▶ Raw log" });
      rawContent = rawBody.createDiv({ cls: "llm-bridge-timeline-raw-body", attr: { hidden: "" } });
      rawContent.createEl("pre", { cls: "llm-bridge-timeline-raw-text", text: JSON.stringify(events, null, 2) });
      rawToggle = rawHead.querySelector(".llm-bridge-timeline-raw-toggle");
    }

    // 折叠交互
    const toggle = headEl.querySelector(".llm-bridge-timeline-toggle")!;
    headEl.addEventListener("click", () => {
      const hidden = bodyEl.hasAttribute("hidden");
      if (hidden) {
        bodyEl.removeAttribute("hidden");
        toggle.textContent = "▼ ";
      } else {
        bodyEl.setAttribute("hidden", "");
        toggle.textContent = "▶ ";
      }
    });
    rawToggle?.addEventListener("click", () => {
      if (!rawContent) return;
      const hidden = rawContent.hasAttribute("hidden");
      if (hidden) {
        rawContent.removeAttribute("hidden");
        rawToggle.textContent = "▼ Raw log";
      } else {
        rawContent.setAttribute("hidden", "");
        rawToggle.textContent = "▶ Raw log";
      }
    });
  }

  private formatProcessSummary(stats: ReturnType<typeof computeTimelineStats>): string {
    const parts = ["过程"];
    if (stats.progressCount > 0) parts.push(`${stats.progressCount} progress`);
    if (stats.thoughtCount > 0) parts.push(`${stats.thoughtCount} thinking`);
    if (stats.toolCount > 0) parts.push(`${stats.toolCount} tool${stats.toolCount > 1 ? "s" : ""}`);
    if (stats.fileChangeCount > 0) parts.push(`${stats.fileChangeCount} file change${stats.fileChangeCount > 1 ? "s" : ""}`);
    if (stats.durationMs !== undefined && stats.durationMs > 0) {
      const secs = Math.round(stats.durationMs / 1000);
      if (secs > 0) parts.push(`${secs}s`);
    }
    return parts.join(" · ");
  }

  // V2.3: 从事件中提取 agent 实例列表（主 agent + subagent）
  private extractAgentInstances(events: ReadonlyArray<WorkflowEvent>): ReadonlyArray<{
    readonly sessionId: string | undefined;
    readonly parentToolUseId: string | undefined;
    readonly isMain: boolean;
    readonly eventCount: number;
  }> {
    const map = new Map<string, { sessionId: string | undefined; parentToolUseId: string | undefined; isMain: boolean; eventCount: number }>();
    for (const event of events) {
      // 仅 MessageEvent 和 ToolStartEvent 携带 agent 标识
      if (event.type !== "message" && event.type !== "tool_start") continue;
      const sessionId = event.sessionId;
      const parentToolUseId = event.parentToolUseId;
      // 主 agent 键：sessionId 或 "main"；subagent 键：sessionId + parentToolUseId
      const isMain = !parentToolUseId;
      const key = isMain ? `main:${sessionId ?? ""}` : `sub:${sessionId ?? ""}:${parentToolUseId ?? ""}`;
      const existing = map.get(key);
      if (existing) {
        existing.eventCount += 1;
      } else {
        map.set(key, { sessionId, parentToolUseId, isMain, eventCount: 1 });
      }
    }
    // 主 agent 排在前
    return Array.from(map.values()).sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return 0;
    });
  }

  // V2.9: findToolParentAgent 已移除——buildToolTimeline 现将 parentToolUseId 直接写入 ToolTimelineEntry，
  // appendSdkWorkflow 用 entry.parentToolUseId 做 O(1) 分组，无需再对每个 tool 线性扫描 events。

  // V2.3: 渲染工具时间线分组（用于 main / subagent 分组展示）
  private renderToolTimelineGroup(body: HTMLElement, title: string, tools: ReadonlyArray<import("./workflowEvent").ToolTimelineEntry>): void {
    const groupBody = this.createSdkGroup(body, title, tools.length);
    const toolList = groupBody.createDiv({ cls: "llm-bridge-sdk-tool-list" });
    for (const tool of tools) {
      const item = toolList.createDiv({ cls: `llm-bridge-sdk-tool-item is-${tool.status}` });
      item.createEl("span", { cls: "llm-bridge-sdk-tool-icon", text: tool.status === "error" ? "✗" : tool.status === "done" ? "✓" : "…" });
      const text = item.createDiv({ cls: "llm-bridge-sdk-tool-text" });
      text.createEl("span", { cls: "llm-bridge-sdk-tool-name", text: tool.toolName });
      if (tool.durationMs !== null) {
        text.createEl("span", { cls: "llm-bridge-sdk-tool-duration", text: this.formatDurationMs(tool.durationMs) });
      }
      if (tool.input) {
        text.createEl("span", { cls: "llm-bridge-sdk-tool-input", text: truncateText(tool.input, 80), attr: { title: tool.input } });
      }
      if (tool.output) {
        text.createEl("span", { cls: "llm-bridge-sdk-tool-output", text: truncateText(tool.output, 80), attr: { title: tool.output } });
      }
    }
  }

  // V2.0: 创建 SDK workflow 分组容器（带标题 + 计数）
  private createSdkGroup(body: HTMLElement, title: string, count: number): HTMLElement {
    const group = body.createDiv({ cls: "llm-bridge-sdk-group" });
    group.createEl("div", { cls: "llm-bridge-sdk-group-title", text: `${title} (${count})` });
    return group.createDiv({ cls: "llm-bridge-sdk-group-items" });
  }

  // V2.0: 渲染一个事件分组（空则跳过）
  private appendSdkEventGroup(body: HTMLElement, title: string, groupEvents: ReadonlyArray<WorkflowEvent>): void {
    if (groupEvents.length === 0) return;
    const groupBody = this.createSdkGroup(body, title, groupEvents.length);
    for (const event of groupEvents) {
      this.appendSdkEventItem(groupBody, event);
    }
  }

  // V2.3s: 渲染权限事件历史（展示工具名/风险等级/决策来源/来源 agent/参数摘要/高风险标记）
  private renderPermissionHistory(body: HTMLElement, permEvents: ReadonlyArray<PermissionEvent>): void {
    if (permEvents.length === 0) return;
    const groupBody = this.createSdkGroup(body, "Permissions", permEvents.length);
    for (const ev of permEvents) {
      const item = groupBody.createDiv({ cls: `llm-bridge-sdk-event-item is-permission is-risk-${ev.riskLevel ?? "low"} ${ev.granted ? "is-perm-granted" : "is-perm-denied"}` });

      // 第一行：图标 + 工具名 + 决策结果 + 来源 agent
      const row1 = item.createDiv({ cls: "llm-bridge-perm-hist-row1" });
      row1.createEl("span", { cls: "llm-bridge-sdk-event-icon", text: ev.granted ? "🔓" : "🔒" });
      row1.createEl("span", { cls: "llm-bridge-perm-hist-tool", text: ev.toolName });
      // 决策来源标签
      const sourceLabel = ev.source === "session_allow" ? "会话允许"
        : ev.source === "session_deny" ? "会话拒绝"
        : ev.source === "mode" ? "模式自动"
        : ev.pending ? "待决策"
        : "用户决策";
      row1.createEl("span", { cls: `llm-bridge-perm-hist-source is-${ev.source ?? "user"}`, text: sourceLabel });
      // 来源 agent
      if (ev.parentToolUseId) {
        row1.createEl("span", { cls: "llm-bridge-perm-hist-agent is-subagent", text: "Subagent", attr: { title: `parent: ${ev.parentToolUseId}` } });
      } else {
        row1.createEl("span", { cls: "llm-bridge-perm-hist-agent is-main", text: "Main" });
      }
      const time = new Date(ev.timestamp).toLocaleTimeString();
      row1.createEl("span", { cls: "llm-bridge-sdk-event-time", text: time });

      // 第二行：风险等级 + 风险说明
      if (ev.riskLevel || ev.riskReason) {
        const row2 = item.createDiv({ cls: "llm-bridge-perm-hist-row2" });
        if (ev.riskLevel) {
          row2.createEl("span", { cls: `llm-bridge-perm-risk-level is-${ev.riskLevel}`, text: ev.riskLevel });
        }
        if (ev.riskReason) {
          row2.createEl("span", { cls: "llm-bridge-perm-risk-reason", text: ev.riskReason });
        }
      }

      // 高风险标记
      if (ev.highRiskFlags && ev.highRiskFlags.length > 0) {
        const flagsEl = item.createDiv({ cls: "llm-bridge-perm-hist-flags" });
        flagsEl.createEl("span", { cls: "llm-bridge-perm-flags-label", text: "高风险：" });
        for (const flag of ev.highRiskFlags) {
          flagsEl.createEl("span", { cls: "llm-bridge-perm-flag", text: flag });
        }
      }

      // 参数摘要
      if (ev.inputSummary) {
        item.createDiv({ cls: "llm-bridge-perm-hist-input", text: ev.inputSummary, attr: { title: ev.inputSummary } });
      }

      // subagent 权限继承风险提示
      if (ev.subagentRisk) {
        item.createDiv({ cls: "llm-bridge-perm-hist-subagent-warn", text: ev.subagentRisk });
      }
    }
  }

  // V2.0: 渲染单个 SDK workflow 事件项（error/failed 含复制按钮）
  private appendSdkEventItem(parent: HTMLElement, event: WorkflowEvent): void {
    const item = parent.createDiv({ cls: `llm-bridge-sdk-event-item ${workflowEventClass(event)}` });
    item.createEl("span", { cls: "llm-bridge-sdk-event-icon", text: workflowEventIcon(event) });
    const text = item.createDiv({ cls: "llm-bridge-sdk-event-text" });
    text.createEl("span", { cls: "llm-bridge-sdk-event-label", text: workflowEventLabel(event) });
    // 事件详情
    let detail = "";
    if (event.type === "thinking") detail = truncateText(event.text, 120);
    else if (event.type === "message") detail = truncateText(event.text, 120);
    else if (event.type === "file_change") detail = `${event.action}: ${event.path}`;
    else if (event.type === "permission") detail = event.description;
    else if (event.type === "error") detail = event.message;
    else if (event.type === "completed") detail = event.text;
    else if (event.type === "failed") detail = event.message;
    if (detail) {
      text.createEl("span", { cls: "llm-bridge-sdk-event-detail", text: detail, attr: { title: detail } });
    }
    const time = new Date(event.timestamp).toLocaleTimeString();
    text.createEl("span", { cls: "llm-bridge-sdk-event-time", text: time });
    // V2.0: error / failed 事件加复制按钮（便于复制错误信息用于诊断）
    if (event.type === "error" || event.type === "failed") {
      const copyText = event.message;
      const copyBtn = item.createEl("button", { cls: "llm-bridge-sdk-event-copy", text: "复制", attr: { title: "复制错误信息" } });
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(copyText);
          new Notice("已复制错误信息");
        } catch {
          new Notice("复制失败");
        }
      });
    }
  }

  // V2.0: 格式化耗时（ms → 可读字符串）
  private formatDurationMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  // V1.2: 渲染运行过程时间线
  // V1.8: 默认折叠（减少噪音，AI 最终答案已在 content 优先显示）
  private appendTimeline(parent: HTMLElement, timeline: ReadonlyArray<{ type: string; timestamp: string; detail: string }>): void {
    const body = this.createCollapsibleSection(parent, "运行过程", "llm-bridge-timeline");
    for (const entry of timeline) {
      const type = entry.type as TimelineEventType;
      const item = body.createDiv({ cls: `llm-bridge-timeline-item ${timelineTypeClass(type)}` });
      item.createEl("span", { cls: "llm-bridge-timeline-dot" });
      const text = item.createDiv({ cls: "llm-bridge-timeline-text" });
      text.createEl("span", { cls: "llm-bridge-timeline-label", text: timelineTypeLabel(type) });
      if (entry.detail) {
        // V2.10 (B-002): 加 title 属性，CSS 截断后鼠标悬停可看完整内容
        text.createEl("span", { cls: "llm-bridge-timeline-detail", text: entry.detail, attr: { title: entry.detail } });
      }
      const time = new Date(entry.timestamp).toLocaleTimeString();
      text.createEl("span", { cls: "llm-bridge-timeline-time", text: time });
    }
  }

  // V1.2/V1.5: 渲染 debug log 路径（可点击复制 / 复制按钮 / 打开按钮）
  private appendDebugLogPath(parent: HTMLElement, logPath: string): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-debug-path" });
    wrap.createEl("span", { cls: "llm-bridge-debug-path-label", text: "Debug log:" });
    const pathEl = wrap.createEl("code", { cls: "llm-bridge-debug-path-value", text: logPath });
    // 点击复制到剪贴板
    pathEl.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(logPath);
        new Notice("已复制 debug log 路径");
      } catch {
        new Notice("复制失败，请手动选中复制");
      }
    });
    pathEl.setAttribute("title", "点击复制路径");
    // 复制按钮
    const copyBtn = wrap.createEl("button", { cls: "llm-bridge-debug-path-copy", text: "复制", attr: { title: "复制路径" } });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(logPath);
        new Notice("已复制");
      } catch {
        new Notice("复制失败");
      }
    });
    // V1.5: 打开按钮（在系统文件管理器中打开 debug log 所在目录）
    const openBtn = wrap.createEl("button", { cls: "llm-bridge-debug-path-open", text: "打开", attr: { title: "在文件管理器中打开" } });
    openBtn.addEventListener("click", () => {
      try {
        // 优先使用 electron shell 在系统文件管理器中打开
        // electron 在 Obsidian 运行时可用
        const electron = require("electron");
        if (electron?.shell?.openPath) {
          electron.shell.openPath(logPath).then((err: string) => {
            if (err) new Notice(`打开失败: ${err}`);
          });
          return;
        }
        if (electron?.shell?.showItemInFolder) {
          electron.shell.showItemInFolder(logPath);
          return;
        }
        new Notice("当前环境不支持打开文件管理器，请手动复制路径");
      } catch (e) {
        new Notice(`打开失败: ${(e as Error).message}`);
      }
    });
  }

  private appendCollapsible(
    parent: HTMLElement,
    title: string,
    text: string,
    textCls: string,
    startOpen: boolean,
    emphasize: boolean,
  ): void {
    const wrap = parent.createDiv({ cls: `llm-bridge-collapse${emphasize ? " is-emphasized" : ""}` });
    const head = wrap.createDiv({ cls: "llm-bridge-collapse-head" });
    const toggle = head.createEl("span", { cls: "llm-bridge-collapse-toggle", text: `${startOpen ? "▼" : "▶"} ${title}` });
    const body = wrap.createDiv({ cls: "llm-bridge-collapse-body" });
    if (!startOpen) body.setAttribute("hidden", "");
    const pre = body.createEl("pre", { cls: `llm-bridge-collapse-text ${textCls}` });
    pre.appendChild(document.createTextNode(text));
    toggle.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggle.textContent = `▼ ${title}`;
      } else {
        body.setAttribute("hidden", "");
        toggle.textContent = `▶ ${title}`;
      }
    });
  }

  private updateAssistantMessage(id: string, patch: Partial<ChatMessage>): void {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return;
    const patchKeys = Object.keys(patch) as Array<keyof ChatMessage>;
    const contentOnly = patchKeys.length === 1 && patchKeys[0] === "content";
    Object.assign(msg, patch);
    const block = this.messagesEl.querySelector(`[data-msg-id="${id}"]`);
    if (!block) return;
    if (msg.role === "assistant" && block instanceof HTMLElement) {
      block.removeClass("is-idle", "is-running", "is-completed", "is-failed", "is-stopped");
      block.addClass(`is-${msg.status}`);
    }

    // 状态
    const devMode = !!this.plugin.settings.developerMode;
    const statusEl = block.querySelector(".llm-bridge-msg-status");
    if (statusEl) {
      if (devMode) {
        statusEl.textContent = STATUS_LABEL[msg.status];
        statusEl.className = `llm-bridge-msg-status is-${msg.status}`;
      } else {
        // Normal user mode: remove status text, show spinner only for running
        statusEl.remove();
      }
    }
    // V16.4-G: Add/remove Codex-style glow text for normal user mode running state
    const existingRunStatus = block.querySelector(".llm-bridge-run-status-text");
    if (msg.status === "running" && !devMode && !existingRunStatus) {
      const head = block.querySelector(".llm-bridge-msg-head");
      if (head) this.renderRunStatusText(head as HTMLElement, "Thinking", "running");
    } else if (msg.status !== "running" && existingRunStatus) {
      existingRunStatus.remove();
    }

    // 内容
    const contentEl = block.querySelector<HTMLElement>(".llm-bridge-msg-content");
    if (contentEl) {
      this.renderMessageContent(contentEl, msg);
    }

    if (contentOnly) {
      this.scrollToBottom();
      return;
    }

    // 重建 details（stderr / log / files）
    const oldDetails = block.querySelector(".llm-bridge-msg-details");
    if (oldDetails) oldDetails.remove();
    this.appendMsgDetails(block as HTMLElement, msg, contentEl);
    this.scrollToBottom();
  }

  private appendAssistantContentDelta(id: string, delta: string): void {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return;
    msg.content += delta;
    this.streamContentAssistantId = id;
    if (this.streamContentRafId !== null) return;
    this.streamContentRafId = window.requestAnimationFrame(() => {
      this.streamContentRafId = null;
      const nextId = this.streamContentAssistantId;
      this.streamContentAssistantId = null;
      if (!nextId) return;
      const nextMsg = this.messages.find((m) => m.id === nextId);
      const block = this.messagesEl.querySelector(`[data-msg-id="${nextId}"]`);
      const contentEl = block?.querySelector<HTMLElement>(".llm-bridge-msg-content");
      if (!nextMsg || !contentEl) return;
      this.renderMessageContent(contentEl, nextMsg);
      this.scrollToBottom();
    });
  }

  private isNearBottom(thresholdPx = 96): boolean {
    const el = this.messagesEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
  }

  private scrollToBottom(force = false): void {
    if (!force && !this.isNearBottom()) return;
    // V2.9: 用 requestAnimationFrame 合并同帧多次调用，避免每个 delta 都同步触发 reflow
    if (this.scrollRafId !== null) return;
    this.scrollRafId = window.requestAnimationFrame(() => {
      this.scrollRafId = null;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  private clearMessages(): void {
    if (this.runHandle) {
      new Notice("运行中无法清空");
      return;
    }
    this.messages = [];
    this.currentAssistantId = null;
    this.renderEmptyState();
  }

  // V2.0: 新建会话（清空消息 + 重置会话状态 + 清空运行流程区）
  // V2.5: 若当前有消息，先确认；重置 currentSessionId（新会话不绑定旧 id）
  private newSession(): void {
    if (this.runHandle) {
      new Notice("运行中无法新建会话");
      return;
    }
    // V2.5: 有消息时确认（避免误清空）
    if (this.messages.length > 0) {
      void this.confirmDialog(
        "新建会话",
        `确认新建会话？当前 ${this.messages.length} 条消息将被清空（已保存到历史则不影响历史记录）。`,
      ).then((ok) => {
        if (ok) this.doNewSession();
      });
      return;
    }
    this.doNewSession();
  }

  // V2.5: 实际执行新建会话（剥离确认逻辑）
  private doNewSession(): void {
    // P4: 置空 session，使下一次 getSession() 创建新 BridgeSession + 新 PermissionBoundary，
    // 避免上一会话的 sessionAllows/sessionDenies 跨会话泄漏（auto-allow/auto-deny 误作用到新会话）。
    this.session = null;
    this.sessionMode = null;
    this.messages = [];
    this.currentAssistantId = null;
    this.currentSessionId = null; // 新会话不绑定旧 id，下次运行将生成新 id
    this.messagesFoldExpanded = false; // V2.7: 重置折叠状态
    this.sessionState = createNewSession();
    // V2.17-A Completion: provider session persistence — 新会话清空回填缓存，
    // 避免把旧会话的 codex threadId 带到新 BridgeSession 导致误 resume。
    this.restoredProviderThreadId = undefined;
    this.restoredProviderSessionId = undefined;
    this.sessionResumed = false; // P3: 新会话是 fresh
    // V2.16-D: 新聊天清除 lastActiveSessionId（新会话不自动恢复）
    if (this.plugin.settings.keepLastSession) {
      this.plugin.settings.lastActiveSessionId = "";
      void this.plugin.saveSettings();
    }
    this.renderEmptyState();
    this.refreshSessionState();
    this.clearRunFlow();
    // 重置 SDK 统计
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    // V2.3s: 清空待决策权限请求
    this.clearPendingPermissions();
    this.clearPendingUserInputRequests();
    this.clearExternalReadRequests();
    this.clearFileContext();
    this.refreshStatusBar();
  }

  // V2.0: 刷新会话状态展示（标题 + 状态 + 消息数 + 上下文指标）
  private refreshSessionState(): void {
    // P3: 恢复的会话在标题后追加标记，让用户持久感知当前是恢复上下文而非新会话
    const displayTitle = this.sessionResumed
      ? `${this.sessionState.title}（恢复的会话）`
      : this.sessionState.title;
    if (this.sessionTitleEl) {
      this.sessionTitleEl.textContent = displayTitle;
    }
    const shadowTitle = this.statusBarEl?.querySelector(".llm-bridge-sb-session-title-shadow");
    if (shadowTitle) {
      shadowTitle.textContent = displayTitle;
    }
    const sessionSelector = this.sessionTitleEl?.closest(".llm-bridge-session-selector");
    if (sessionSelector) {
      sessionSelector.className = `llm-bridge-session-selector ${sessionStatusClass(this.sessionState.status)}`;
      // V2.16-D: title 属性显示完整 session title（hover 查看截断的完整内容）
      (sessionSelector as HTMLElement).setAttribute("title", displayTitle || "当前会话");
    }
    // 会话标题行着色（按状态）
    const titleRow = this.statusBarEl.querySelector(".llm-bridge-sb-title-row");
    if (titleRow) {
      titleRow.className = `llm-bridge-sb-title-row ${sessionStatusClass(this.sessionState.status)}`;
    }
  }

  // V2.16-D/E: 刷新 context metrics（估算 prompt/active note/selection/attachments/history/remaining）
  // - 异步：需要读取 active note 内容
  // - 标注 estimated（字符估算，非精确 token）
  // - 更新 ring + label + detail
  private async refreshContextMetrics(): Promise<void> {
    if (!this.contextLabelEl || !this.contextRingEl || !this.contextDetailEl) return;
    try {
      const settings = this.plugin.settings;
      const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      const activeFile = this.getActiveFile();
      const selection = this.getSelection();
      let activeNoteContent = "";
      let activeNoteReadOk = false;
      if (settings.includeActiveNote && activeFile) {
        try {
          activeNoteContent = await this.app.vault.read(activeFile);
          activeNoteReadOk = activeNoteContent.length > 0;
        } catch { /* 读取失败用空字符串 */ }
      }
      // V16.3: 计算 active note 三态
      if (!settings.includeActiveNote || !activeFile) {
        this.activeNoteAttachState = "off";
      } else if (activeNoteReadOk) {
        this.activeNoteAttachState = "full";
      } else {
        this.activeNoteAttachState = "path-only";
      }
      const snapshot: StateSnapshot = {
        vaultPath,
        activeFilePath: activeFile?.path || null,
        activeFileContent: activeNoteContent || null,
        selection,
        fileRefIndex: buildPromptFileRefIndex({ refs: this.getPromptFileRefs() }),
        attachmentTextSnippets: this.getPromptAttachmentSnippets(this.getPromptFileRefs()),
        timestamp: new Date().toISOString(),
      };
      const promptPackageText = buildPromptPackage("", snapshot, settings);
      // V2.17-A: 拆分 message-scoped 附件与 pinned context 两段（不再合并为单一 workingSet）
      const messageAttachmentsText = this.messageFileRefs.filter((r) => r.status === "active").map((r) => r.resolvedPath).join("\n");
      const pinnedContextText = this.pinnedFileRefs.filter((r) => r.status === "active").map((r) => r.resolvedPath).join("\n");
      const historyText = this.messages.map((m) => m.content || "").join("\n");
      const metrics = computeContextMetrics(
        promptPackageText, activeNoteContent, selection || "",
        messageAttachmentsText, pinnedContextText, historyText, settings.model,
      );
      // V2.17-A: 不强制覆盖 precision 为 unavailable；让 computeContextMetrics 的 estimated 自然显示。
      // - 当前运行时无 exact token usage 信号，按 estimated 展示本地估算（标明精度，不冒充 exact）
      // - compression 无信号时不传，不伪造
      this.lastContextMetrics = metrics;
      this.renderContextMetrics(metrics);
      this.refreshComposerStatusRail();
      // V16.3: chip 三态刷新（依赖 activeNoteAttachState，在异步读取后设置）
      this.refreshAllChips();
    } catch {
      this.contextLabelEl.textContent = "Context estimate";
      this.refreshComposerStatusRail();
    }
  }

  // V2.16-D: 渲染 context metrics 到 UI
  // V16.3 Round 3: 普通用户态只显示 ring + 简短标签；developerMode=true 才填充明细
  private renderContextMetrics(metrics: ContextMetrics): void {
    const total = metrics.total.tokens;
    const win = metrics.contextWindow;
    const pct = win > 0 ? Math.min(100, (total / win) * 100) : 0;
    const color = metrics.precision === "unavailable" ? "var(--text-faint)" : pct > 80 ? "#e53935" : pct > 50 ? "#f59e0b" : "var(--interactive-accent)";
    this.contextRingEl.classList.remove("is-exact", "is-estimated", "is-unavailable", "is-compressed");
    this.contextRingEl.classList.add(`is-${metrics.precision}`);
    if (metrics.compression) this.contextRingEl.classList.add("is-compressed");
    this.contextRingEl.style.cssText = `background: conic-gradient(${color} ${pct * 3.6}deg, var(--background-modifier-border) ${pct * 3.6}deg);`;
    const isDev = !!this.plugin.settings.developerMode;
    // V16.3 Round 3: 普通用户态 title 简化为 "Context used: X / total tokens"；
    // developerMode 保留完整 breakdown（含 compression）
    if (isDev) {
      const tipParts = [`${formatTokens(total)} / ${formatTokens(win)} tokens (${Math.round(pct)}%)`];
      if (metrics.compression) {
        tipParts.push(`Compression: ${formatTokens(metrics.compression.beforeTokens)} → ${formatTokens(metrics.compression.afterTokens)}`);
      }
      this.contextRingEl.setAttribute("title", tipParts.join("\n"));
    } else {
      this.contextRingEl.setAttribute("title", `Context used: ${formatTokens(total)} / ${formatTokens(win)} tokens`);
    }
    // V16.3 Round 3: 普通用户态短标签 "Context 0.5%"；developerMode 显示完整比例
    if (isDev) {
      if (metrics.precision === "exact") {
        this.contextLabelEl.textContent = `Context ${formatTokens(total)} / ${formatTokens(win)}`;
      } else {
        this.contextLabelEl.textContent = "Context estimate";
      }
      this.contextLabelEl.setAttribute("title", `Exact runtime usage: ${metrics.precision === "exact" ? "available" : "unavailable"}\nLocal estimate: ${metrics.total.tokens} tokens (${metrics.total.chars} chars)\nWindow: ${formatTokens(win)}\nPrecision: ${metrics.precision}`);
    } else {
      this.contextLabelEl.textContent = `${pct > 0 && pct < 0.1 ? "<0.1" : Math.round(pct * 10) / 10}%`;
      this.contextLabelEl.setAttribute("title", `Context used: ${formatTokens(total)} / ${formatTokens(win)} tokens (${Math.round(pct)}%)`);
    }
    // V16.3 Round 3: 普通用户态不填充明细；developerMode 保留完整明细
    this.contextDetailEl.empty();
    if (!isDev) {
      // 普通用户态：明细区保持空且隐藏（click handler 已 gate developerMode）
      return;
    }
    const precisionRow = this.contextDetailEl.createDiv({ cls: "llm-bridge-context-detail-row" });
    precisionRow.createEl("span", { cls: "llm-bridge-context-detail-label", text: "Source" });
    precisionRow.createEl("span", {
      cls: "llm-bridge-context-detail-value",
      text: metrics.precision === "exact" ? "exact runtime usage" : metrics.precision === "estimated" ? "local estimate" : "unavailable; showing local estimated breakdown",
    });
    // V2.17-A: 分开渲染 message attachments / pinned context / note / selection / history
    const parts = [metrics.promptPackage, metrics.activeNote, metrics.selection, metrics.messageAttachments, metrics.pinnedContext, metrics.history, metrics.remaining];
    for (const part of parts) {
      const row = this.contextDetailEl.createDiv({ cls: "llm-bridge-context-detail-row" });
      row.createEl("span", { cls: "llm-bridge-context-detail-label", text: part.label });
      // V16.3: path-only active note 明确标注 0 content tokens 但路径已附带
      let valueText = `${formatTokens(part.tokens)} tokens estimated`;
      if (part.label === "Active note" && this.activeNoteAttachState === "path-only") {
        valueText = "0 content tokens（路径已附带，内容读取失败）";
      } else if (part.label === "Active note" && this.activeNoteAttachState === "off") {
        valueText = "off（未注入）";
      }
      row.createEl("span", { cls: "llm-bridge-context-detail-value", text: valueText });
      if (part.chars > 0) {
        row.createEl("span", { cls: "llm-bridge-context-detail-chars", text: `${part.chars} chars` });
      }
    }
    if (metrics.compression) {
      const comp = metrics.compression;
      const compRow = this.contextDetailEl.createDiv({ cls: "llm-bridge-context-detail-row llm-bridge-context-compression" });
      compRow.createEl("span", { cls: "llm-bridge-context-detail-label", text: "Compression" });
      compRow.createEl("span", {
        cls: "llm-bridge-context-detail-value",
        text: `${formatTokens(comp.beforeTokens)} → ${formatTokens(comp.afterTokens)} (${formatCompressionRatio(comp.ratio)})`,
      });
      compRow.setAttribute("title", `Source: ${comp.source}\nReason: ${comp.reason}`);
    }
  }

  private refreshComposerStatusRail(): void {
    if (!this.composerStatusRailEl || !this.composerStatusTextEl || !this.composerStepPillEl) return;

    const latestTurn = this.getLatestAssistantTurnView();
    const turnStatus = latestTurn ? this.getComposerTurnStatus(latestTurn) : null;
    const compressionText = this.getContextCompressionStatusText();
    const shouldShow = !!turnStatus?.isActive || !!turnStatus?.isContextCompaction || !!compressionText;

    if (!shouldShow) {
      this.composerStatusRailEl.setAttribute("hidden", "");
      this.composerStatusTextEl.textContent = "";
      this.composerStepPillEl.textContent = "";
      this.composerStatusRailEl.className = "llm-bridge-composer-status-rail";
      return;
    }

    const useTurnStatus = !!turnStatus && (turnStatus.isActive || turnStatus.isContextCompaction);
    const kind = useTurnStatus ? turnStatus.kind : "compressed";
    const label = useTurnStatus ? turnStatus.label : compressionText ?? "";
    this.composerStatusRailEl.removeAttribute("hidden");
    this.composerStatusRailEl.className = `llm-bridge-composer-status-rail is-${kind}`;
    this.composerStatusTextEl.textContent = label;
    this.composerStatusTextEl.setAttribute("title", label);

    const stepText = useTurnStatus ? turnStatus.stepText : "";
    this.composerStepPillEl.textContent = stepText;
    this.composerStepPillEl.toggleAttribute("hidden", !stepText);
  }

  private getLatestAssistantTurnView(): AssistantTurnView | null {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const msg = this.messages[i];
      if (msg.role === "assistant" && msg.assistantTurnView) return msg.assistantTurnView;
    }
    return null;
  }

  private flattenTurnTimeline(nodes: ReadonlyArray<TurnTimelineNode>): TurnTimelineNode[] {
    const flattened: TurnTimelineNode[] = [];
    const visit = (items: ReadonlyArray<TurnTimelineNode>) => {
      for (const item of items) {
        flattened.push(item);
        if (item.children?.length) visit(item.children);
      }
    };
    visit(nodes);
    return flattened;
  }

  private getComposerTurnStatus(turn: AssistantTurnView): { label: string; stepText: string; kind: string; isActive: boolean; isContextCompaction: boolean } | null {
    const nodes = this.flattenTurnTimeline(turn.turnTimeline)
      .filter((node) => node.kind !== "status" && node.kind !== "agentMessage");
    if (nodes.length === 0) return null;

    const activeIndex = nodes.findIndex((node) => node.status === "running" || node.status === "blocked");
    const currentIndex = activeIndex >= 0 ? activeIndex : nodes.length - 1;
    const current = nodes[currentIndex];
    const isActive = turn.status === "running" || current.status === "running" || current.status === "blocked";
    const isContextCompaction = current.kind === "contextCompaction";
    const label = this.getComposerStatusLabel(turn, current, isActive);
    const stepText = this.formatComposerStepText(currentIndex, nodes.length, label, isActive, isContextCompaction);
    const kind = current.status === "blocked"
      ? "blocked"
      : turn.status === "failed" || current.status === "failed"
        ? "failed"
        : isContextCompaction
          ? "compressed"
          : isActive ? "running" : "completed";

    return { label, stepText, kind, isActive, isContextCompaction };
  }

  private formatComposerStepText(
    currentIndex: number,
    total: number,
    label: string,
    active: boolean,
    contextCompaction: boolean,
  ): string {
    if (active) return `${Math.max(1, currentIndex + 1)}/${total} · ${label}`;
    if (contextCompaction) return `Context compressed · ${total} steps`;
    return "";
  }

  private getComposerStatusLabel(turn: AssistantTurnView, node: TurnTimelineNode, active: boolean): string {
    switch (node.kind) {
      case "contextCompaction":
        return active ? "Compressing context" : "Context compressed";
      case "reasoning":
      case "plan":
        return active ? "Thinking" : "Thought";
      case "commandExecution":
        return active ? "Running command" : "Ran command";
      case "fileChange":
        return active ? "Editing file" : "Edited file";
      case "approval":
        return node.status === "blocked" || active ? "Waiting approval" : "Approval handled";
      case "userInput":
        return node.status === "blocked" || active ? "Waiting input" : "Input handled";
      case "mcpToolCall":
      case "dynamicToolCall":
        return active ? "Calling tool" : "Tool completed";
      case "webSearch":
        return active ? "Searching" : "Search complete";
      case "imageView":
        return active ? "Viewing image" : "Viewed image";
      case "reviewMode":
        return active ? "Reviewing" : "Review complete";
      default:
        if (turn.status === "failed") return "Run failed";
        return active ? "Processing" : "Processed";
    }
  }

  private getContextCompressionStatusText(): string | null {
    const comp = this.lastContextMetrics?.compression;
    if (!comp) return null;
    return `Context compressed ${formatTokens(comp.beforeTokens)} → ${formatTokens(comp.afterTokens)}`;
  }

  // Agent Skills panel: runtime capabilities only; no composer insertion.
  private renderAgentSkillsPanel(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-agent-skills-panel" });
    const head = wrap.createDiv({ cls: "llm-bridge-skills-head" });
    this.agentSkillsToggleEl = head.createEl("button", {
      cls: "llm-bridge-skills-toggle",
      attr: { type: "button", title: "Agent 可发现/可调用的 runtime capabilities；不会插入输入框", "aria-expanded": "false" },
    });
    this.agentSkillsToggleChevronEl = this.agentSkillsToggleEl.createEl("span", { cls: "llm-bridge-skills-toggle-chevron", text: "›" });
    this.agentSkillsToggleEl.createEl("span", { cls: "llm-bridge-skills-toggle-label", text: "Plugins & Skills" });
    this.agentSkillsToggleCountEl = this.agentSkillsToggleEl.createEl("span", { cls: "llm-bridge-skills-toggle-count", text: "0/0P · 0/0S" });
    const refreshBtn = head.createEl("button", {
      cls: "llm-bridge-skills-refresh-btn",
      text: "↻",
      attr: { title: "刷新 Agent Skills manifest" },
    });
    refreshBtn.addEventListener("click", () => void this.refreshAgentSkills());

    const body = wrap.createDiv({ cls: "llm-bridge-skills-body llm-bridge-agent-skills-body" });
    body.setAttribute("hidden", "");
    this.agentSkillsBodyEl = body;
    const help = body.createDiv({ cls: "llm-bridge-agent-skills-boundary" });
    help.createEl("span", { text: "Plugins 来自 managed Codex runtime；Skills 来自本地 Agent Skills manifest。启用项会作为 runtime capability 进入 provider instructions，菜单选择只生成 composer 内轻量 chip。" });
    this.managedCodexPluginsListEl = body.createDiv({ cls: "llm-bridge-agent-skills-list-container llm-bridge-codex-plugins-list-container" });
    this.agentSkillsListEl = body.createDiv({ cls: "llm-bridge-agent-skills-list-container" });

    this.agentSkillsToggleEl.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
      } else {
        body.setAttribute("hidden", "");
      }
      this.agentSkillsToggleEl.setAttribute("aria-expanded", hidden ? "true" : "false");
      this.updateAgentSkillsToggle();
    });
  }

  // V2.5: 渲染历史会话面板（可折叠，默认折叠）
  private renderHistoryPanel(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-history-panel" });
    const head = wrap.createDiv({ cls: "llm-bridge-history-head" });
    this.historyToggleEl = head.createEl("button", {
      cls: "llm-bridge-history-toggle",
      attr: {
        type: "button",
        title: "展开历史会话列表（从 .llm-bridge/sessions/ 读取）",
        "aria-expanded": "false",
      },
    });
    this.historyToggleChevronEl = this.historyToggleEl.createEl("span", { cls: "llm-bridge-history-toggle-chevron", text: "▶" });
    this.historyToggleLabelEl = this.historyToggleEl.createEl("span", { cls: "llm-bridge-history-toggle-label", text: "Sessions" });
    this.historyToggleCountEl = this.historyToggleEl.createEl("span", { cls: "llm-bridge-history-toggle-count", text: "0" });
    const refreshHistBtn = head.createEl("button", {
      cls: "llm-bridge-history-refresh-btn",
      attr: { title: "刷新历史会话列表" },
    });
    setIcon(refreshHistBtn.createEl("span", { cls: "llm-bridge-icon" }), "refresh-cw");
    refreshHistBtn.addEventListener("click", () => void this.refreshHistory(true));
    // V2.8: 排序下拉（时间/消息数）
    const sortSelect = head.createEl("select", {
      cls: "llm-bridge-history-sort",
      attr: { title: "排序方式" },
    });
    sortSelect.createEl("option", { value: "time", text: "按时间" });
    sortSelect.createEl("option", { value: "messages", text: "按消息数" });
    sortSelect.value = this.historySortMode;
    sortSelect.addEventListener("change", () => {
      this.historySortMode = sortSelect.value as "time" | "messages";
      this.renderHistoryList();
    });
    const body = wrap.createDiv({ cls: "llm-bridge-history-body" });
    body.setAttribute("hidden", "");
    this.historyBodyEl = body;
    // V2.9: 搜索框（复用 Skills 300ms 防抖模式，按标题子串过滤）
    const searchBar = body.createDiv({ cls: "llm-bridge-history-search" });
    this.historySearchEl = searchBar.createEl("input", {
      type: "text",
      cls: "llm-bridge-history-search-input",
      attr: { placeholder: "搜索会话标题…", title: "按标题子串过滤历史会话（大小写不敏感）" },
    }) as HTMLInputElement;
    this.historySearchEl.addEventListener("input", () => {
      if (this.historySearchDebounceTimer !== null) {
        window.clearTimeout(this.historySearchDebounceTimer);
      }
      const value = this.historySearchEl.value;
      this.historySearchDebounceTimer = window.setTimeout(() => {
        this.historySearchQuery = value;
        this.renderHistoryList();
        this.historySearchDebounceTimer = null;
      }, 300);
    });
    // 列表容器独立于搜索框，renderHistoryList 的 empty() 只清空列表，不影响搜索框
    const listContainer = body.createDiv({ cls: "llm-bridge-history-list-container" });
    this.historyListEl = listContainer;
    this.historyToggleEl.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        this.setHistoryPanelExpanded(true);
        void this.refreshHistory();
      } else {
        this.setHistoryPanelExpanded(false);
      }
    });
    // 初始空状态
    this.updateHistoryCountLabel(0, 0);
    listContainer.createDiv({ cls: "llm-bridge-history-empty", text: "暂无历史会话" });
  }

  private setHistoryPanelExpanded(expanded: boolean): void {
    if (!this.historyBodyEl || !this.historyToggleEl) return;
    this.historyBodyEl.toggleAttribute("hidden", !expanded);
    this.historyToggleEl.setAttribute("aria-expanded", String(expanded));
    if (this.historyToggleChevronEl) this.historyToggleChevronEl.textContent = expanded ? "▼" : "▶";
  }

  private updateHistoryCountLabel(visibleCount: number, totalCount: number): void {
    if (!this.historyToggleCountEl) return;
    if (totalCount <= 0) {
      this.historyToggleCountEl.textContent = "0";
      this.historyToggleCountEl.setAttribute("title", "0 sessions");
      return;
    }
    const label = visibleCount === totalCount ? String(totalCount) : `${visibleCount}/${totalCount}`;
    this.historyToggleCountEl.textContent = label;
    this.historyToggleCountEl.setAttribute("title", `${visibleCount} visible / ${totalCount} total`);
  }

  private async toggleSessionDropdown(dropdown: HTMLElement, openHistory: () => void): Promise<void> {
    if (!dropdown.hasAttribute("hidden")) {
      dropdown.setAttribute("hidden", "");
      return;
    }
    await this.refreshHistory();
    this.renderRecentSessionDropdown(dropdown, openHistory);
    dropdown.removeAttribute("hidden");
  }

  private renderRecentSessionDropdown(dropdown: HTMLElement, openHistory: () => void): void {
    dropdown.empty();
    dropdown.createEl("div", { cls: "llm-bridge-session-dropdown-title", text: "Sessions" });
    const recent = this.historyItems.slice(0, 6);
    if (recent.length === 0) {
      dropdown.createEl("div", { cls: "llm-bridge-session-dropdown-empty", text: "暂无历史会话" });
    } else {
      for (const item of recent) {
        const summary = this.sessionSummaryText(item);
        const meta = `${this.formatHistoryTime(item.savedAt)} · ${item.messageCount} 条`;
        const row = dropdown.createEl("button", {
          cls: `llm-bridge-session-dropdown-item${item.id === this.currentSessionId ? " is-current" : ""}`,
          attr: { title: `${item.title}\n${summary}\n${item.messageCount} 条消息 · ${item.savedAt}` },
        });
        const titleRow = row.createDiv({ cls: "llm-bridge-session-dropdown-title-row" });
        titleRow.createEl("span", { cls: "llm-bridge-session-dropdown-name", text: item.title });
        if (item.id === this.currentSessionId) {
          titleRow.createEl("span", { cls: "llm-bridge-session-dropdown-current", text: "当前" });
        }
        titleRow.createEl("span", { cls: "llm-bridge-session-dropdown-inline-meta", text: meta });
        row.createEl("span", { cls: "llm-bridge-session-dropdown-summary", text: summary });
        row.addEventListener("click", async () => {
          dropdown.setAttribute("hidden", "");
          await this.restoreSession(item.id);
        });
      }
    }
    const historyBtn = dropdown.createEl("button", { cls: "llm-bridge-session-dropdown-history" });
    const historyIcon = historyBtn.createEl("span", { cls: "llm-bridge-session-dropdown-history-icon" });
    setIcon(historyIcon, "history");
    historyBtn.createEl("span", { text: "查看全部会话" });
    historyBtn.addEventListener("click", () => {
      dropdown.setAttribute("hidden", "");
      openHistory();
    });
  }

  // V2.5: 从 .llm-bridge/sessions/ 加载历史会话列表并渲染
  // V2.9: 加 5s 缓存守卫——非强制调用在缓存有效期内跳过全量读盘，仅重渲染；↻ 按钮与运行后保存传 force=true
  private async refreshHistory(force = false): Promise<void> {
    // 缓存命中：5s 内不重复 readdir + 逐文件 stat + readFile
    if (!force && Date.now() - this.historyLastLoadAt < 5000) {
      this.renderHistoryList();
      return;
    }
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    try {
      this.historyItems = await listSessions(vaultPath);
    } catch {
      this.historyItems = [];
    }
    this.historyLastLoadAt = Date.now();
    this.renderHistoryList();
  }

  // V2.5: 渲染历史会话列表
  // V2.8: 支持排序（时间/消息数）+ 每项加编辑按钮
  private renderHistoryList(): void {
    if (!this.historyListEl) return;
    try {
    this.historyListEl.empty();
    // V2.9: 按搜索词过滤（标题子串，大小写不敏感）；filter 返回新数组，可直接排序不修改原 historyItems
    const query = this.historySearchQuery.trim().toLowerCase();
    const filtered = this.historyItems.filter((it) => !query || it.title.toLowerCase().includes(query));
    if (this.historyItems.length === 0) {
      this.historyListEl.createDiv({ cls: "llm-bridge-history-empty", text: "暂无历史会话" });
      this.updateHistoryCountLabel(0, 0);
      return;
    }
    if (filtered.length === 0) {
      this.historyListEl.createDiv({ cls: "llm-bridge-history-empty", text: `无匹配「${this.historySearchQuery.trim()}」的会话` });
      this.updateHistoryCountLabel(0, this.historyItems.length);
      return;
    }
    // V2.8: 按 sortMode 排序（filtered 已是新数组，直接排序不修改原 historyItems）
    if (this.historySortMode === "messages") {
      filtered.sort((a, b) => b.messageCount - a.messageCount);
    } else {
      // time: 按 savedAt 降序（最新在前，listSessions 已排但副本后稳定排序）
      filtered.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
    }
    const list = this.historyListEl.createDiv({ cls: "llm-bridge-history-list" });
    for (const item of filtered) {
      const preview = this.sessionSummaryText(item);
      const row = list.createDiv({
        cls: `llm-bridge-history-item is-${item.status}${item.id === this.currentSessionId ? " is-current" : ""}`,
        attr: { title: `${item.title} · ${item.messageCount} 条消息 · ${item.savedAt}` },
      });
      // 主信息（点击恢复）
      const main = row.createEl("button", { cls: "llm-bridge-history-main" });
      const titleRow = main.createDiv({ cls: "llm-bridge-history-title-row" });
      titleRow.createEl("span", { cls: "llm-bridge-history-title", text: item.title });
      if (item.id === this.currentSessionId) {
        titleRow.createEl("span", { cls: "llm-bridge-history-current", text: "Current" });
      }
      const meta = `${this.formatHistoryTime(item.savedAt)} · ${item.messageCount} 条`;
      titleRow.createEl("span", { cls: "llm-bridge-history-inline-meta", text: meta });
      main.createEl("span", { cls: "llm-bridge-history-preview", text: preview });
      main.addEventListener("click", () => void this.restoreSession(item.id));
      const actions = row.createDiv({ cls: "llm-bridge-history-actions" });
      // V2.8: 编辑按钮（重命名标题）
      const editBtn = actions.createEl("button", {
        cls: "llm-bridge-history-edit-btn",
        attr: { title: "重命名会话标题" },
      });
      setIcon(editBtn.createEl("span", { cls: "llm-bridge-icon" }), "pencil");
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.renameHistorySession(item.id, item.title);
      });
      // 删除按钮
      const delBtn = actions.createEl("button", {
        cls: "llm-bridge-history-del-btn",
        attr: { title: "删除此历史会话" },
      });
      setIcon(delBtn.createEl("span", { cls: "llm-bridge-icon" }), "trash-2");
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.deleteHistorySession(item.id, item.title);
      });
    }
    // V2.9: 搜索时显示「匹配数/总数」，否则显示总数
    this.updateHistoryCountLabel(filtered.length, this.historyItems.length);
    } catch (e) {
      this.renderListError(this.historyListEl, "history", e);
    }
  }

  // V2.5: 格式化历史会话时间（简化展示）
  private formatHistoryTime(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      if (sameDay) return `今天 ${hh}:${mm}`;
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${mo}-${dd} ${hh}:${mm}`;
    } catch {
      return iso;
    }
  }

  private sessionSummaryText(item: SessionListItem): string {
    return item.lastAssistantSummary || item.firstUserSummary || "无摘要";
  }

  // V2.5: 恢复历史会话（确认后加载消息 + 状态 + workflow trace）
  private async restoreSession(sessionId: string): Promise<void> {
    if (this.runHandle) {
      new Notice("运行中无法恢复历史会话");
      return;
    }
    // 确认对话框（若当前有消息，提示将清空）
    if (this.messages.length > 0) {
      const confirmed = await this.confirmDialog(
        "恢复历史会话",
        `恢复会话将清空当前 ${this.messages.length} 条消息，是否继续？`,
      );
      if (!confirmed) return;
    }
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const session = await loadSession(vaultPath, sessionId);
    if (!session) {
      new Notice("恢复失败：会话文件不存在或版本不兼容");
      return;
    }
    // 恢复消息、状态、当前会话 id
    this.messages = session.messages.slice();
    this.currentAssistantId = null;
    this.currentSessionId = session.id;
    this.messagesFoldExpanded = false; // V2.7: 恢复后默认折叠旧消息
    this.sessionState = {
      title: session.title,
      status: session.status,
      messageCount: session.messageCount,
      startedAt: session.startedAt,
    };
    // V2.16-D/V2.17-A: 还原运行时状态 + pinned context（保留类型）+ 重算 message 附件 snippet
    const s = this.plugin.settings;
    if (session.model) s.model = session.model;
    if (session.effortLevel) s.effortLevel = session.effortLevel;
    if (session.backendMode) s.backendMode = session.backendMode as typeof s.backendMode;
    if (session.permissionMode) s.claudePermissionMode = session.permissionMode as typeof s.claudePermissionMode;
    if (session.sessionMode) s.sessionMode = session.sessionMode as typeof s.sessionMode;
    await this.restoreContextAndSnippets(session);
    this.session = null;
    this.sessionMode = null;
    // V2.17-A Completion: provider session persistence
    // P3: 标记为恢复的会话
    this.sessionResumed = true;
    // 重置 session 后立即把持久化的 providerThreadId/SessionId 回填到新 BridgeSession，
    // 使下一次 resume() 命中 thread/resume 路径而不是隐式新开 thread。
    this.restoredProviderThreadId = session.providerThreadId;
    this.restoredProviderSessionId = session.providerSessionId;
    this.refreshAllChips();
    if (s.keepLastSession) {
      s.lastActiveSessionId = session.id;
      await this.plugin.saveSettings();
    }
    this.renderMessagesFromHistory();
    this.refreshSessionState();
    this.clearRunFlow();
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    this.clearPendingPermissions();
    this.clearPendingUserInputRequests();
    this.clearExternalReadRequests();
    this.refreshStatusBar();
    this.scrollToBottom(); // V2.8: 恢复后滚到最新消息
    new Notice(`已恢复会话：${session.title}`);
  }

  // V2.17-A: 恢复 pinned context（保留完整类型字段）+ 重算 message-scope 附件内联 snippet + 恢复 agentType
  // - 供 restoreSession 与 restoreLastActiveSessionIfNeeded 复用，避免两处逻辑漂移
  // - fileType/pathKind/kind 等枚举字段保留原值，不强制 String 化
  // - 历史 message 的内联文本 snippet 在恢复后重算（prompt 仍含内联内容）
  // - agentType 与 session 记录对齐，保证 EffectiveRunPlan 一致性
  private async restoreContextAndSnippets(session: PersistedSession): Promise<void> {
    const s = this.plugin.settings;
    if (typeof session.agentType === "string" && session.agentType) {
      s.agentType = session.agentType as typeof s.agentType;
    }
    this.messageFileRefs = [];
    this.pinnedFileRefs = [];
    this.sessionFileRefs = [];
    this.attachmentTextSnippets = [];
    this.attachmentReadGrants = [];
    const persistedPinnedRefs = Array.isArray(session.pinnedContextRefs)
      ? session.pinnedContextRefs
      : Array.isArray(session.workingSetRefs)
        ? session.workingSetRefs
        : [];
    if (persistedPinnedRefs.length > 0) {
      try {
        this.pinnedFileRefs = persistedPinnedRefs.map((r) => this.normalizePersistedFileRef(r));
        this.attachmentReadGrants = this.pinnedFileRefs
          .filter((ref) => ref.kind === "attachment")
          .map((ref) => ({
            path: ref.resolvedPath,
            scope: "attachment" as const,
            match: "file" as const,
            grantedAt: ref.createdAt,
            source: ref.source,
          }));
      } catch {
        // pinned context 恢复失败不阻断主流程
      }
    }
    // V2.17-A: 重算 message-scope 附件的内联文本 snippet
    await this.recomputeMessageAttachmentSnippets();
    this.refreshContextRefs();
  }

  // V2.17-A: 将持久化的 FileRef 还原为强类型对象（保留 fileType/pathKind/kind 等枚举字段）
  private normalizePersistedFileRef(raw: unknown): FileRef {
    const r = (raw ?? {}) as Record<string, unknown>;
    const requestedPath = typeof r.requestedPath === "string" ? r.requestedPath : "";
    const resolvedPath = typeof r.resolvedPath === "string" ? r.resolvedPath : requestedPath;
    return {
      id: typeof r.id === "string" ? r.id : "",
      kind: (typeof r.kind === "string" ? r.kind : "file") as FileRef["kind"],
      displayName: typeof r.displayName === "string" ? r.displayName : requestedPath,
      requestedPath,
      resolvedPath,
      pathKind: (typeof r.pathKind === "string" ? r.pathKind : "vault") as FileRef["pathKind"],
      fileType: (typeof r.fileType === "string" ? r.fileType : "unknown") as FileRef["fileType"],
      ...(typeof r.previewText === "string" && r.previewText.trim() ? { previewText: r.previewText } : {}),
      source: typeof r.source === "string" ? r.source : "manual",
      grantScope: (typeof r.grantScope === "string" ? r.grantScope : "session") as FileRef["grantScope"],
      scope: "pinned",
      createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
      status: "active",
    } as FileRef;
  }

  // V2.17-A: 遍历历史 message 的 fileRefs，对 message-scope 文本附件重算内联 snippet
  // - 恢复 session 后 attachmentTextSnippets 被清空，历史 message 附件的内联内容需重算才能进 prompt
  // - 仅处理 kind=attachment + bounded text type + active + message scope
  private async recomputeMessageAttachmentSnippets(): Promise<void> {
    const snippets: AttachmentTextSnippet[] = [];
    for (const msg of this.messages) {
      if (!msg.fileRefs || msg.fileRefs.length === 0) continue;
      for (const ref of msg.fileRefs) {
        if (ref.scope !== "message" || ref.status !== "active") continue;
        if (!isBoundedTextAttachmentType(ref.fileType)) continue;
        const result = await ingestAttachmentTextSnippet(ref);
        if (result.snippet) snippets.push(result.snippet);
      }
    }
    this.attachmentTextSnippets = snippets;
  }

  // V2.16-D: 会话保持 — onOpen 时静默恢复上次活动会话（不弹确认对话框）
  // - 仅在 keepLastSession=true 且 lastActiveSessionId 非空时触发
  // - 旧 session 文件不存在时清除 lastActiveSessionId，fallback 到新会话
  // - 还原消息 + pinned context + 模式 + 模型/effort + backend + 权限模式
  private async restoreLastActiveSessionIfNeeded(): Promise<void> {
    const s = this.plugin.settings;
    if (!s.keepLastSession || !s.lastActiveSessionId) return;
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const session = await loadSession(vaultPath, s.lastActiveSessionId);
    if (!session) {
      // 旧 session 文件不存在（被删除/清理），清除 id 静默 fallback 到新会话
      s.lastActiveSessionId = "";
      await this.plugin.saveSettings();
      return;
    }
    // 静默恢复（不弹确认对话框，因为 onOpen 时无消息）
    this.messages = session.messages.slice();
    this.currentAssistantId = null;
    this.currentSessionId = session.id;
    this.messagesFoldExpanded = false;
    this.sessionState = {
      title: session.title,
      status: session.status,
      messageCount: session.messageCount,
      startedAt: session.startedAt,
    };
    // V2.16-D/V2.17-A: 还原运行时状态 + pinned context（保留类型）+ 重算 message 附件 snippet
    if (session.model) s.model = session.model;
    if (session.effortLevel) s.effortLevel = session.effortLevel;
    if (session.backendMode) s.backendMode = session.backendMode as typeof s.backendMode;
    if (session.permissionMode) s.claudePermissionMode = session.permissionMode as typeof s.claudePermissionMode;
    if (session.sessionMode) s.sessionMode = session.sessionMode as typeof s.sessionMode;
    // V2.17-A: 复用统一恢复逻辑（pinned context 保留类型 + message snippet 重算 + agentType 对齐）
    await this.restoreContextAndSnippets(session);
    await this.plugin.saveSettings();
    this.session = null;
    this.sessionMode = null;
    // P3: 标记为恢复的会话（静默恢复也需要标注）
    this.sessionResumed = true;
    // V2.17-A Completion: provider session persistence
    // keepLastSession 静默恢复也回填 providerThreadId/SessionId。
    this.restoredProviderThreadId = session.providerThreadId;
    this.restoredProviderSessionId = session.providerSessionId;
    this.refreshAllChips();
    this.renderMessagesFromHistory();
    this.refreshSessionState();
    this.clearRunFlow();
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    this.clearPendingPermissions();
    this.clearPendingUserInputRequests();
    this.clearExternalReadRequests();
    this.refreshStatusBar();
    this.scrollToBottom();
  }

  // V2.5: 从历史会话渲染消息列表（复用 renderMessage 渲染逻辑）
  // V2.7: 长会话旧消息折叠（默认显示最近 8 条，更早的折叠为按钮）
  private renderMessagesFromHistory(): void {
    this.messagesEl.empty();
    if (this.messages.length === 0) {
      this.renderEmptyState();
      this.refreshComposerStatusRail();
      return;
    }
    const MAX_EXPANDED = 8;
    if (this.messages.length > MAX_EXPANDED && !this.messagesFoldExpanded) {
      const hiddenCount = this.messages.length - MAX_EXPANDED;
      const visible = this.messages.slice(hiddenCount);
      const foldBtn = this.messagesEl.createDiv({ cls: "llm-bridge-msg-fold" });
      foldBtn.createEl("button", {
        cls: "llm-bridge-msg-fold-btn",
        text: `展开更早 ${hiddenCount} 条消息`,
      }).addEventListener("click", () => {
        this.messagesFoldExpanded = true;
        this.renderMessagesFromHistory();
      });
      for (const msg of visible) {
        this.renderMessage(msg);
      }
    } else {
      for (const msg of this.messages) {
        this.renderMessage(msg);
      }
    }
    this.refreshComposerStatusRail();
  }

  // V2.5: 删除历史会话（确认后删除 + 刷新列表）
  // V2.8: 改为原地移除 historyItems 项 + 重渲染，不重新 listSessions
  private async deleteHistorySession(sessionId: string, title: string): Promise<void> {
    const confirmed = await this.confirmDialog(
      "删除历史会话",
      `确认删除历史会话「${title}」？此操作不可恢复。`,
    );
    if (!confirmed) return;
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const ok = await deleteSession(vaultPath, sessionId);
    if (ok) {
      new Notice(`已删除历史会话：${title}`);
      // 若删除的是当前活动会话，清空 currentSessionId
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
      }
      // V2.8: 原地移除该项并重渲染（不重新 listSessions）
      this.historyItems = this.historyItems.filter((it) => it.id !== sessionId);
      this.renderHistoryList();
    } else {
      new Notice("删除失败：会话文件不存在");
    }
  }

  // V2.8: 重命名历史会话标题（弹 Modal 输入 + 原子写 + 原地更新）
  private async renameHistorySession(sessionId: string, currentTitle: string): Promise<void> {
    const newTitle = await this.promptDialog("重命名会话标题", "输入新的会话标题：", currentTitle);
    if (newTitle === null) return; // 用户取消
    const trimmed = newTitle.trim();
    if (!trimmed) {
      new Notice("标题不能为空");
      return;
    }
    if (trimmed === currentTitle) return; // 未修改
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const ok = await renameSession(vaultPath, sessionId, trimmed);
    if (ok) {
      // 原地更新 historyItems 对应项
      if (this.historyItems.some((it) => it.id === sessionId)) {
        this.historyItems = this.historyItems.map((it) =>
          it.id === sessionId ? { ...it, title: trimmed, savedAt: new Date().toISOString() } : it,
        );
      }
      // 若重命名的是当前活动会话，同步更新 sessionState.title
      if (this.currentSessionId === sessionId) {
        this.sessionState = { ...this.sessionState, title: trimmed };
        this.refreshSessionState();
      }
      this.renderHistoryList();
      new Notice(`已重命名会话：${trimmed}`);
    } else {
      new Notice("重命名失败：会话文件不存在或写入失败");
    }
  }

  // V2.8: 通用输入对话框（返回输入值；取消返回 null）
  private promptDialog(title: string, message: string, defaultValue: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(title);
      modal.contentEl.empty();
      modal.contentEl.addClass("llm-bridge-prompt-modal");
      modal.contentEl.createEl("p", { text: message, cls: "llm-bridge-confirm-msg" });
      const input = modal.contentEl.createEl("input", {
        cls: "llm-bridge-prompt-input",
        attr: { type: "text", value: defaultValue },
      });
      input.style.width = "100%";
      const btns = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const cancel = btns.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => { resolve(null); modal.close(); });
      const confirm = btns.createEl("button", { text: "确认", cls: "mod-warning" });
      confirm.addEventListener("click", () => { resolve(input.value); modal.close(); });
      modal.open();
      // 自动聚焦输入框并选中文本
      setTimeout(() => { input.focus(); input.select(); }, 50);
    });
  }

  // V2.5: 通用确认对话框（返回 true=确认 / false=取消）
  private confirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(title);
      modal.contentEl.empty();
      modal.contentEl.addClass("llm-bridge-confirm-modal");
      modal.contentEl.createEl("p", { text: message, cls: "llm-bridge-confirm-msg" });
      const btns = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const cancel = btns.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => { resolve(false); modal.close(); });
      const confirm = btns.createEl("button", { text: "确认", cls: "mod-warning" });
      confirm.addEventListener("click", () => { resolve(true); modal.close(); });
      modal.open();
    });
  }

  private async refreshAgentSkills(): Promise<void> {
    await this.refreshAgentSkillsManifestOnly();
    await this.refreshManagedCodexPlugins();
    this.renderAgentSkillsList();
  }

  private async refreshAgentSkillsManifestOnly(): Promise<void> {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    try {
      const manifest = await loadAgentSkillsManifest(vaultPath);
      this.agentSkills = manifest.skills.slice();
    } catch {
      this.agentSkills = [];
    }
  }

  private updateAgentSkillsToggle(): void {
    if (!this.agentSkillsToggleEl || !this.agentSkillsBodyEl) return;
    const pluginEnabled = this.managedCodexPlugins.filter((plugin) => plugin.enabled).length;
    const pluginTotal = this.managedCodexPlugins.length;
    const enabled = this.agentSkills.filter((skill) => skill.enabled).length;
    const total = this.agentSkills.length;
    const hidden = this.agentSkillsBodyEl.hasAttribute("hidden");
    this.agentSkillsToggleEl.classList.toggle("is-open", !hidden);
    this.agentSkillsToggleEl.setAttribute("aria-expanded", hidden ? "false" : "true");
    if (this.agentSkillsToggleChevronEl) this.agentSkillsToggleChevronEl.setText(hidden ? "›" : "⌄");
    if (this.agentSkillsToggleCountEl) this.agentSkillsToggleCountEl.setText(`${pluginEnabled}/${pluginTotal}P · ${enabled}/${total}S`);
  }

  private renderAgentSkillsList(): void {
    if (!this.agentSkillsListEl) return;
    try {
      this.renderManagedCodexPluginsList();
      this.agentSkillsListEl.empty();
      if (this.agentSkills.length === 0) {
        this.agentSkillsListEl.createDiv({
          cls: "llm-bridge-skills-empty",
          text: "无 Agent Skills。可通过 .llm-bridge/agent-skills.json 管理，或导入外部 skill pack。",
        });
        this.updateAgentSkillsToggle();
        return;
      }

      const list = this.agentSkillsListEl.createDiv({ cls: "llm-bridge-agent-skills-list" });
      const sorted = this.agentSkills.slice().sort((a, b) => a.slug.localeCompare(b.slug));
      for (const skill of sorted) {
        const item = list.createDiv({
          cls: `llm-bridge-agent-skill-registry-item${skill.enabled ? "" : " is-disabled"}`,
          attr: { title: skill.materializedPath || `.claude/skills/${skill.slug}/SKILL.md` },
        });
        const icon = item.createEl("span", { cls: "llm-bridge-agent-skill-icon" });
        setIcon(icon, skill.enabled ? "sparkles" : "circle-dashed");
        const main = item.createEl("button", {
          cls: "llm-bridge-agent-skill-open",
          attr: { title: `在 Obsidian 中打开 ${skill.materializedPath || `.claude/skills/${skill.slug}/SKILL.md`}` },
        });
        const titleRow = main.createDiv({ cls: "llm-bridge-agent-skill-title-row" });
        titleRow.createEl("span", { cls: "llm-bridge-agent-skill-name", text: skill.name || skill.slug });
        titleRow.createEl("span", { cls: `llm-bridge-agent-skill-badge ${skill.enabled ? "is-enabled" : "is-disabled"}`, text: skill.enabled ? "已启用" : "已禁用" });
        main.createEl("span", { cls: "llm-bridge-agent-skill-desc", text: skill.description || "No description" });
        const meta = main.createDiv({ cls: "llm-bridge-agent-skill-meta" });
        meta.createEl("span", { text: `slug: ${skill.slug}` });
        meta.createEl("span", { text: `source: ${skill.source}` });
        main.addEventListener("click", () => void this.openAgentSkillFile(skill));

        const toggleBtn = item.createEl("button", {
          cls: `llm-bridge-agent-skill-toggle ${skill.enabled ? "is-enabled" : "is-disabled"}`,
          text: skill.enabled ? "关闭" : "启用",
          attr: { title: "启用/禁用此 Agent Skill（只更新 manifest，不插入输入框）" },
        });
        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.toggleAgentSkillEnabled(skill.id, !skill.enabled);
        });
      }
      this.updateAgentSkillsToggle();
    } catch (e) {
      this.renderListError(this.agentSkillsListEl, "agent-skills", e);
    }
  }

  private async refreshManagedCodexPlugins(): Promise<void> {
    try {
      this.managedCodexPluginCatalog = listManagedCodexPlugins(this.plugin.pluginDir);
      this.managedCodexPlugins = this.managedCodexPluginCatalog.entries.slice();
    } catch (error) {
      this.managedCodexPluginCatalog = {
        available: false,
        runtimePath: null,
        entries: [],
        error: error instanceof Error ? error.message : String(error),
      };
      this.managedCodexPlugins = [];
    }
  }

  private renderManagedCodexPluginsList(): void {
    if (!this.managedCodexPluginsListEl) return;
    this.managedCodexPluginsListEl.empty();
    const section = this.managedCodexPluginsListEl.createDiv({ cls: "llm-bridge-codex-plugins-panel" });
    const head = section.createDiv({ cls: "llm-bridge-codex-plugins-head" });
    head.createEl("span", { cls: "llm-bridge-codex-plugins-title", text: "Installed plugins" });
    head.createEl("span", {
      cls: "llm-bridge-codex-plugins-count",
      text: String(this.managedCodexPlugins.length),
      attr: { title: "Managed Codex runtime installed plugins" },
    });
    const hint = section.createDiv({ cls: "llm-bridge-codex-plugins-hint" });
    if (!this.managedCodexPluginCatalog?.available) {
      hint.setText(this.managedCodexPluginCatalog?.error || "Managed Codex runtime unavailable.");
      hint.addClass("is-error");
      return;
    }
    hint.setText("直接从 pinned managed Codex runtime 读取真实已安装插件，不依赖用户 PATH。");
    const list = section.createDiv({ cls: "llm-bridge-agent-skills-list llm-bridge-codex-plugins-list" });
    if (this.managedCodexPlugins.length === 0) {
      list.createDiv({ cls: "llm-bridge-skills-empty", text: "当前 runtime 没有已安装插件。" });
      return;
    }
    for (const plugin of this.managedCodexPlugins) {
      const item = list.createDiv({ cls: `llm-bridge-agent-skill-registry-item llm-bridge-codex-plugin-item${plugin.enabled ? "" : " is-disabled"}` });
      const icon = item.createDiv({ cls: "llm-bridge-agent-skill-icon llm-bridge-codex-plugin-icon" });
      setIcon(icon, plugin.enabled ? "plug" : "plug-zap");
      const main = item.createDiv({ cls: "llm-bridge-agent-skill-main" });
      const title = main.createDiv({ cls: "llm-bridge-agent-skill-title-row" });
      title.createEl("span", { cls: "llm-bridge-agent-skill-name", text: plugin.name });
      title.createEl("span", {
        cls: `llm-bridge-agent-skill-badge ${plugin.enabled ? "is-enabled" : "is-disabled"}`,
        text: plugin.enabled ? "enabled" : "disabled",
      });
      main.createDiv({
        cls: "llm-bridge-agent-skill-desc llm-bridge-codex-plugin-desc",
        text: `${plugin.marketplaceName} · ${plugin.version}`,
      });
      const meta = main.createDiv({ cls: "llm-bridge-agent-skill-meta llm-bridge-codex-plugin-meta" });
      meta.createEl("span", { text: plugin.pluginId, attr: { title: plugin.pluginId } });
      meta.createEl("span", { text: `auth ${plugin.authPolicy.toLowerCase()}` });
      meta.createEl("span", { text: plugin.sourceLabel, attr: { title: plugin.sourceLabel } });
    }
  }

  private async toggleAgentSkillEnabled(skillId: string, enabled: boolean): Promise<void> {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const manifest = await loadAgentSkillsManifest(vaultPath);
    const skills = manifest.skills.map((skill) =>
      skill.id === skillId ? { ...skill, enabled, updatedAt: new Date().toISOString() } : skill,
    );
    const ok = await saveAgentSkillsManifest(vaultPath, { version: manifest.version, skills });
    if (!ok) {
      new Notice("Agent Skill 状态保存失败");
      return;
    }
    this.agentSkills = skills;
    this.renderAgentSkillsList();
    new Notice(`${enabled ? "已启用" : "已禁用"} Agent Skill`);
  }

  private async openAgentSkillFile(skill: AgentSkillRecord): Promise<void> {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const skillPath = this.resolveAgentSkillVaultPath(skill, vaultPath);
    const fallbackPath = this.resolveAgentSkillDisplayPath(skill, vaultPath);
    if (!skillPath) {
      await this.openAgentSkillDocumentLeaf(skill, fallbackPath, fallbackPath);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(skillPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
      return;
    }
    await this.openAgentSkillDocumentLeaf(skill, skillPath, fallbackPath);
  }

  private async openAgentSkillDocumentLeaf(skill: AgentSkillRecord, skillPath: string, displayPath: string): Promise<void> {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SKILL_DOCUMENT);
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf(true);
    for (const duplicateLeaf of existingLeaves.slice(1)) {
      duplicateLeaf.detach();
    }
    await leaf.setViewState({
      type: VIEW_TYPE_AGENT_SKILL_DOCUMENT,
      active: true,
      state: {
        skillPath,
        displayPath,
        title: skill.name || skill.slug,
      },
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private resolveAgentSkillVaultPath(skill: AgentSkillRecord, vaultPath: string): string | null {
    const fallback = `.claude/skills/${skill.slug}/SKILL.md`;
    const rawPath = skill.materializedPath || fallback;
    if (!path.isAbsolute(rawPath)) return rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const relative = path.relative(vaultPath, rawPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.replace(/\\/g, "/");
  }

  private resolveAgentSkillDisplayPath(skill: AgentSkillRecord, vaultPath: string): string {
    const rawPath = skill.materializedPath || `.claude/skills/${skill.slug}/SKILL.md`;
    if (path.isAbsolute(rawPath)) return rawPath;
    return path.join(vaultPath, rawPath);
  }

  // V2.7: 列表渲染失败的 fallback 提示（避免异常导致面板空白）
  private renderListError(container: HTMLElement | null, name: string, error: unknown): void {
    if (!container) return;
    try {
      container.empty();
      const err = container.createDiv({ cls: "llm-bridge-list-error" });
      err.createEl("span", { text: `[${name} 列表渲染失败]` });
      if (error instanceof Error && error.message) {
        err.createEl("pre", { cls: "llm-bridge-error-detail", text: error.message });
      }
    } catch {
      // 静默忽略
    }
  }

  // V2.0: 渲染运行流程区面板（展示最新一次运行的 6 步流程）
  private renderRunFlowPanel(parent: HTMLElement): void {
    this.runFlowEl = parent.createDiv({ cls: "llm-bridge-run-flow" });
    const head = this.runFlowEl.createDiv({ cls: "llm-bridge-run-flow-head" });
    this.runFlowToggle = head.createEl("span", { cls: "llm-bridge-run-flow-toggle", text: "▶ 运行流程" });
    this.runFlowBody = this.runFlowEl.createDiv({ cls: "llm-bridge-run-flow-body" });
    this.runFlowBody.setAttribute("hidden", "");
    this.runFlowToggle.addEventListener("click", () => {
      if (!this.runFlowBody || !this.runFlowToggle) return;
      const hidden = this.runFlowBody.hasAttribute("hidden");
      if (hidden) {
        this.runFlowBody.removeAttribute("hidden");
        this.runFlowToggle.textContent = "▼ 运行流程";
      } else {
        this.runFlowBody.setAttribute("hidden", "");
        this.runFlowToggle.textContent = "▶ 运行流程";
      }
    });
    this.clearRunFlow();
  }

  // V2.0: 清空运行流程区
  private clearRunFlow(): void {
    if (!this.runFlowBody || !this.runFlowEl) return;
    this.runFlowBody.empty();
    this.runFlowBody.createEl("div", { cls: "llm-bridge-run-flow-empty", text: "暂无运行" });
    this.runFlowEl.classList.remove("is-running", "is-completed", "is-failed", "is-stopped");
  }

  // V2.0: 运行开始时展示前 3 步（准备上下文 → 构建 prompt → 启动 agent）
  private showRunFlowStarted(promptLength: number): void {
    if (!this.runFlowBody || !this.runFlowEl || !this.runFlowToggle) return;
    this.runFlowBody.empty();
    this.runFlowEl.classList.remove("is-completed", "is-failed", "is-stopped");
    this.runFlowEl.classList.add("is-running");
    this.runFlowBody.setAttribute("hidden", "");
    this.runFlowToggle.textContent = "▶ 运行流程";

    const steps = [
      { label: "准备上下文", detail: "已导出 Obsidian 状态", status: "done" },
      { label: "构建 prompt", detail: `${promptLength} chars via stdin`, status: "done" },
      { label: "启动 agent", detail: "process started", status: "running" },
    ];
    for (const step of steps) {
      const item = this.runFlowBody.createDiv({ cls: `llm-bridge-run-flow-item is-${step.status}` });
      item.createEl("span", { cls: "llm-bridge-run-flow-dot" });
      const text = item.createDiv({ cls: "llm-bridge-run-flow-text" });
      text.createEl("span", { cls: "llm-bridge-run-flow-label", text: step.label });
      if (step.detail) {
        text.createEl("span", { cls: "llm-bridge-run-flow-detail", text: step.detail });
      }
    }
  }

  // V2.0: 运行完成后展示完整 6 步流程（复用 workflowTrace 渲染逻辑）
  private showRunFlowTrace(trace: ReadonlyArray<{ stage: string; timestamp: string; detail: string; status: string }>, finalStatus: RunStatus): void {
    if (!this.runFlowBody || !this.runFlowEl || !this.runFlowToggle) return;
    this.runFlowBody.empty();
    this.runFlowEl.classList.remove("is-running");
    this.runFlowEl.classList.add(`is-${finalStatus}`);
    this.runFlowBody.setAttribute("hidden", "");
    this.runFlowToggle.textContent = "▶ 运行流程";

    // 6 步流程标签映射（workflowTrace stage → 用户可读步骤名）
    const stepLabels: Record<string, string> = {
      preflight: "准备上下文",
      build_prompt: "构建 prompt",
      spawn: "启动 agent",
      stdout: "读取输出",
      stderr: "读取输出",
      file_diff_scan: "检测文件变化",
      completed: "完成",
      failed: "失败",
      stopped: "停止",
    };

    for (const entry of trace) {
      const stage = entry.stage as WorkflowTraceStage;
      const label = stepLabels[stage] || workflowStageLabel(stage);
      const item = this.runFlowBody.createDiv({
        cls: `llm-bridge-run-flow-item ${workflowStageClass(stage)} is-${entry.status}`,
      });
      item.createEl("span", { cls: "llm-bridge-run-flow-dot" });
      const text = item.createDiv({ cls: "llm-bridge-run-flow-text" });
      text.createEl("span", { cls: "llm-bridge-run-flow-label", text: label });
      if (entry.detail) {
        text.createEl("span", { cls: "llm-bridge-run-flow-detail", text: entry.detail });
      }
      const time = new Date(entry.timestamp).toLocaleTimeString();
      text.createEl("span", { cls: "llm-bridge-run-flow-time", text: time });
    }
  }

  // ---------- 运行流程 ----------

  // 供外部 command 调用：填充输入框
  setInput(text: string): void {
    this.inputEl.value = text;
    this.inputEl.focus();
    // 光标移到末尾
    this.inputEl.selectionStart = this.inputEl.selectionEnd = this.inputEl.value.length;
  }

  focusInput(): void {
    this.inputEl.focus();
  }

  // 供外部 command 调用：直接触发发送
  async runNow(): Promise<void> {
    await this.run();
  }

  private async run(): Promise<void> {
    if (this.runHandle) return;
    const userInput = this.inputEl.value.trim();
    if (!userInput) {
      new Notice("请输入请求");
      return;
    }
    const installStatus = this.getManagedRuntimeInstallStatusForCurrentMode();
    if (installStatus?.required) {
      this.refreshManagedRuntimeInstallAction(installStatus);
      this.statusLabelEl.textContent = "Codex runtime · install required";
      this.statusDotEl.setAttribute("title", this.formatRuntimeInstallTitle(installStatus));
      new Notice("Codex managed runtime needs to be installed first");
      return;
    }

    const settings = this.plugin.settings;
    const activeFile = this.getActiveFile();
    const selection = settings.includeSelection ? this.getSelection() : null;

    // 导出状态
    let vaultPath = "";
    try {
      const result = await exportState(this.app, this.app.vault, activeFile, { selection }, settings);
      vaultPath = result.vaultPath;
    } catch (e) {
      new Notice("导出 Obsidian 状态失败：" + (e as Error).message);
      return;
    }

    this.beforeFiles = await snapshotVaultMarkdownFiles(vaultPath);
    const messageRefsForRun = this.messageFileRefs.map((ref) => {
      const previewText = this.getFileRefPreviewText(ref);
      return {
        ...ref,
        scope: "message" as const,
        ...(previewText ? { previewText } : {}),
      };
    });
    const promptFileRefsForRun = this.getPromptFileRefs(messageRefsForRun);
    const promptAttachmentSnippetsForRun = this.getPromptAttachmentSnippets(promptFileRefsForRun);

    // 构建 State Snapshot（用于 prompt package）
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

    // 如果启用 includeActiveNote，读取活动笔记内容
    if (settings.includeActiveNote && activeFile) {
      try {
        snapshot.activeFileContent = await this.app.vault.read(activeFile);
      } catch (e) {
        // 读取失败不阻断主流程
        console.warn("Failed to read active file:", e);
      }
    }

    // V2.17-A Completion: provider-neutral BridgePromptPackage 先构造（单一真相源）。
    // buildSdkStreamingInput 从 promptPackage.userPrompt 派生 text block，不再使用
    // 旧 buildPromptPackage 字符串（避免 prompt split 绕过）。
    // bridge 系统附加内容只进入 systemPrompt / provider instructions 层，
    // 不混入 SDK streaming text block。
    // V16.5-E Task 0: session 必须在 buildRuntimeCapabilities 之前声明（修复 TDZ blocker）。
    const session = this.getSession();
    if (session.providerId === "codex-managed-app-server") {
      await this.refreshManagedCodexPlugins();
      await this.refreshAgentSkillsManifestOnly();
      const codexSkillPrep = prepareAgentSkillsForCodexRuntimeSync(vaultPath);
      if (!codexSkillPrep.ok) {
        new Notice(`Codex Skills 物化失败：${codexSkillPrep.reason || "unknown error"}`);
      }
    }
    const promptUserInput = this.buildUserInputWithRuntimeCapabilityHints(userInput);
    // V16.5-D: 注入真实 runtime capabilities（从 session.providerId 派生），不再只用默认值。
    const runtimeCapabilities = this.buildRuntimeCapabilities(session.providerId, settings);
    const promptPackage = buildBridgePromptPackage(promptUserInput, snapshot, settings, runtimeCapabilities);
    const sdkStreamingInput = await this.buildSdkStreamingInput(promptPackage.userPrompt, promptFileRefsForRun);

    // 旧 buildPromptPackage 仅作为 legacy CLI preview/log fallback（不进入 SDK streaming）
    const prompt = buildPromptPackage(promptUserInput, snapshot, settings);

    // V2.17-A Completion: 通过 BridgeSession 选择 provider 并构造 EffectiveRunPlan。
    // UI 不再直接接触 SdkBackend/ClaudeCliBackend/MockAgentBackend；plan 由
    // provider.buildPlan 从 RunInput 派生（单一真相源）。
    const imageBlockCount = sdkStreamingInput?.content.filter((b) => b.type === "image").length ?? 0;
    const attachmentPlan: AttachmentPlan = {
      messageScopedRefs: messageRefsForRun.length,
      pinnedRefs: this.pinnedFileRefs.length,
      inlineSnippets: promptAttachmentSnippetsForRun.length,
      imageStreamingBlocks: imageBlockCount,
      nativeRefOnly: Math.max(0, promptFileRefsForRun.length - promptAttachmentSnippetsForRun.length - imageBlockCount),
      // V2.17-A: entry-level 审计由 provider 内部从 promptPackage.attachmentEntries 构造；
      // view 层仅保留 counts 供 commandPreview/log，entries 为空。
      entries: [],
    };
    // 注：attachmentPlan 仅用于 UI 展示审计；provider 内部从 promptPackage.attachmentEntries
    // 重新聚合（保证 provider-neutral）。这里保留供 commandPreview / log 用。

    // V1.5: 构造命令预览（UI-only，展示本次实际执行的 command/args/cwd/上下文）
    const commandPreviewRows = previewToRows(buildCommandPreview(settings, vaultPath, {
      hasSelection: !!selection,
      selectionLength: selection?.length ?? 0,
      hasActiveNote: settings.includeActiveNote && !!activeFile,
      activeFileName: activeFile?.path ?? null,
      promptLength: prompt.length,
      // V16.3: 传入活动笔记内容字符数用于 token 估算（与实际 prompt 注入一致）
      activeNoteContentLength: snapshot.activeFileContent?.length ?? 0,
    }));

    // 渲染用户消息 + assistant 占位
    this.appendUserMessage(userInput, messageRefsForRun);
    const assistantId = this.appendAssistantPlaceholder();
    this.inputEl.value = "";
    this.closeMentionPicker();
    this.clearMessageContext();
    this.selectedRuntimeCapabilities = [];
    this.renderComposerRuntimeCapabilityChips();

    // V2.0: 首条用户消息生成会话标题 + 更新消息数
    if (this.sessionState.messageCount === 0) {
      this.sessionState = updateSession(this.sessionState, {
        title: generateSessionTitle(userInput),
        startedAt: new Date().toISOString(),
      });
    }
    this.sessionState = updateSession(this.sessionState, {
      messageCount: this.sessionState.messageCount + 1,
    });

    this.setGlobalStatus("running");
    // V2.0: 运行流程区展示前 3 步
    this.showRunFlowStarted(prompt.length);
    // V1.2: 运行过程时间线 —— 收集中间事件（首次 stdout/stderr 各记录一条，保持简洁）
    const startedAt = new Date().toISOString();
    const timelineEvents: Array<{ type: TimelineEventType; detail: string; timestamp: string }> = [];
    // V1.5: Workflow Trace —— 收集中间事件（与 timeline 共享首次 stdout/stderr 记录）
    const workflowEvents: WorkflowTraceEvent[] = [];
    // V1.6: SDK 工作流事件（工具级：tool_start/tool_result/file_change/permission/error/message）
    const sdkEvents: WorkflowEvent[] = [];
    let sawStdout = false;
    let sawStderr = false;

    // V2.17-A Completion: 通过 provider.buildPlan 构造 EffectiveRunPlan（单一真相源）
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
    this.updateAssistantMessage(assistantId, {
      log: `$ ${this.commandLine()}\ncwd: ${vaultPath}\nprompt 通过 stdin 传入（${prompt.length} 字符）`,
      commandPreview: commandPreviewRows,
      effectiveRunPlan,
      attachmentPlan, // P3: persist attachmentPlan for developerMode audit
    });

    // V2.14.0-K: runtime file tool adapter（provider 通过 RunContext 拿到）
    const runtimeFileToolAdapter = createRuntimeFileToolAdapter(
      session.providerId === "claude-sdk" ? "sdk" : "cli",
      (request) => this.executeAgentFileToolRoute(request),
    );
    runInput.runtimeFileToolAdapter = runtimeFileToolAdapter;

    // V2.17-A Completion: 通过 BridgeSession.start 启动 run，消费 NormalizedRuntimeEvent 流。
    // 主渲染链路迁移到 AssistantTurnViewBuilder：UI 只消费 AssistantTurnView，
    // 不再反向映射 WorkflowEvent 作为主流程。final answer 由 builder.finalAnswer 输出，
    // 不再由 stdout_delta 旁路直接写 content。
    // - stdout_delta/stderr_delta/completed/failed：builder 聚合 + 终态处理
    // - 其余事件：builder 聚合后渲染 process/thoughts/tools/fileChanges/approvals
    // - WorkflowEvent 映射仅保留为 legacy log（sdkEvents/timelineEvents），不作主 UI 数据源
    let terminalStatus: RunStatus | null = null;
    let terminalResult: RunResult | null = null;
    const runIter = session.start(runInput, settings);
    const turnBuilder = new AssistantTurnViewBuilder(assistantId, session.providerId, startedAt);

    // runHandle：把 cancel 透传给 BridgeSession（stop 按钮用）
    const view = this;
    this.runHandle = {
      get running(): boolean { return terminalStatus === null; },
      stop(): void {
        // BridgeSession.cancel 会调用 provider.cancel + permission.cancelAllPending
        session.cancel("");
      },
    };

    void (async () => {
      try {
        for await (const ev of runIter) {
          if (terminalStatus) break;
          view.handleNormalizedEvent(ev, {
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
            promptLength: prompt.length,
            turnBuilder,
            onTerminal: (status: RunStatus, result: RunResult) => {
              terminalStatus = status;
              terminalResult = result;
            },
          });
        }
      } catch (e) {
        // 异常兜底：构造 failed 终态
        const errMsg = (e as Error)?.message || String(e);
        terminalStatus = "failed";
        terminalResult = {
          exitCode: null,
          signal: null,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          stdout: "",
          stderr: errMsg,
          command: "",
          args: [],
        };
      } finally {
        view.runHandle = null;
        if (terminalStatus && terminalResult) {
          await view.onRunFinished(
            terminalResult, vaultPath, assistantId, terminalStatus,
            startedAt, timelineEvents, workflowEvents, prompt.length, sdkEvents,
          );
        }
      }
    })();
  }

  /**
   * V2.17-A Completion: 处理单个 NormalizedRuntimeEvent（主渲染走 AssistantTurnViewBuilder）。
   *
   * - 所有事件先 ingest 到 turnBuilder（主 UI 状态源）
   * - final answer 由 turnBuilder.finalAnswer 输出（不再 stdout_delta 旁路直接写 content）
   * - process/thoughts/tools/fileChanges/approvals 从 turnBuilder 渲染
   * - stdout_delta/stderr_delta 首次出现时记录到 timeline/workflow log（legacy）
   * - completed/failed 触发终态
   * - WorkflowEvent 映射仅保留为 legacy log（sdkEvents），不作主 UI 数据源
   * - approval pending 仍驱动 pendingPermissions 面板
   * - user_input pending 走独立 question UI，不进入 permission 面板
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
    const p = ev.payload;

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

    // 3. 从 turnView 渲染到 ChatMessage（final answer + stderr + tools/files/approvals）
    //    P3: 持久化 turnView 快照到 msg，使 appendMsgDetails 能从 turnView 渲染
    //    process/thoughts/tools/fileChanges（普通用户态主链路）。
    this.updateAssistantMessage(ctx.assistantId, {
      content: turnView.finalAnswer,
      stderr: this.plugin.settings.showStderr
        ? turnView.warnings.filter((w) => w).join("\n")
        : undefined,
      assistantTurnView: turnView,
    });

    // 4. approval pending 面板（从 turnView.approvals 驱动，替代旧 WorkflowEvent 路径）
    // V16.5-B: PermissionBoundary.pending 是主状态源；此处仅同步 UI 显示缓存。
    let approvalCacheChanged = false;
    for (const ap of turnView.approvals) {
      if (ap.pending) {
        if (!this.pendingPermissions.has(ap.requestId)) {
          // V16.5-B: 只补充 UI 显示字段（boundary.pending 是 truth）
          this.pendingPermissions.set(ap.requestId, {
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
        // V16.5-B: resolved — 从缓存和 stale 集合清除
        if (this.pendingPermissions.has(ap.requestId) || this.staleApprovalRequestIds.has(ap.requestId)) {
          this.pendingPermissions.delete(ap.requestId);
          this.staleApprovalRequestIds.delete(ap.requestId);
          approvalCacheChanged = true;
        }
      }
    }
    if (approvalCacheChanged) {
      this.refreshPermissionPanel();
    }

    for (const req of (turnView.userInputRequests ?? [])) {
      if (!req.pending) {
        this.pendingUserInputDrafts.delete(req.requestId);
      }
    }
    if (p.kind === "user_input_request" || p.kind === "user_input_resolved") {
      this.refreshUserInputPanel();
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

    // 6. LEGACY LOG: 把事件映射为 WorkflowEvent 存入 sdkEvents（供 onRunFinished 日志/trace 用）
    //    P3-C: appendLiveSdkEvent/WorkflowEvent 只是 developer/legacy log，不参与普通用户主 UI。
    //    普通用户态主链路完全由 turnView（AssistantTurnView）驱动（步骤 2-4）。
    //    仅在 developerMode 下推送 live progress，避免普通用户态依赖 WorkflowEvent/RunStateAggregator。
    //    (keep as developer log; remove or migrate in P4)
    const developerMode = !!this.plugin.settings.developerMode;
    const wfEvent = developerMode ? mapNormalizedToWorkflowEvent(ev) : null;
    if (wfEvent) {
      ctx.sdkEvents.push(wfEvent);
      this.appendLiveSdkEvent(wfEvent);
    } else if (developerMode) {
      // developerMode 下即使 wfEvent 映射为 null（如 stdout_delta）也保留 sdkEvents 空记录用于审计
      // 非 developerMode 完全跳过，减少 view.ts 对 WorkflowEvent 的依赖
    }
  }

  private stop(): void {
    if (this.runHandle) {
      this.runHandle.stop();
      // V2.3s: 清空待决策权限请求
      this.clearPendingPermissions();
      this.clearPendingUserInputRequests();
      const msg = this.messages.find((m) => m.id === this.currentAssistantId);
      if (msg) {
        this.updateAssistantMessage(this.currentAssistantId!, {
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
    this.runHandle = null;
    this.clearApprovalUiState();

    const msg = this.messages.find((m) => m.id === assistantId);
    const newLog = (msg?.log || "") +
      `\nexit code: ${result.exitCode ?? "null"}  signal: ${result.signal ?? "-"}\nduration: ${result.durationMs} ms`;
    // V0.3: backend 终态 stderr 已是用户可见摘要，直接覆盖（不再增量拼接）
    // 详细诊断日志已写入 .llm-bridge/logs/debug-*.log
    // V2.4: 先保存日志，拿到具体文件路径用于 debug log 提示（而非目录）
    let debugLogPath = "";
    if (this.plugin.settings.saveLogs) {
      try {
        debugLogPath = await this.saveLogFile(result, vaultPath);
      } catch {
        /* 忽略 */
      }
    }

    let newStderr = this.plugin.settings.showStderr ? (result.stderr || "") : "";
    // V1.1: 失败时构造简短错误摘要（脱敏，不含 secret），并在 stderr 末尾追加 debug log 路径
    const errorSummary = status === "failed" ? buildErrorSummary(result.stderr, result.exitCode) : "";
    if (status === "failed") {
      if (errorSummary) {
        newStderr = newStderr ? `${newStderr}\n---\n摘要: ${errorSummary}` : `摘要: ${errorSummary}`;
      }
      // V2.4: 追加具体 debug log 文件路径（而非目录），便于用户直接定位
      const logPath = debugLogPath || path.join(vaultPath, ".llm-bridge", "logs");
      newStderr = `${newStderr}\nDebug log: ${logPath}`;
    }

    // V1.2: 构造运行过程时间线（started / stdout / stderr / 终态）
    const finalDetail = status === "failed"
      ? (errorSummary || `exit ${result.exitCode ?? "null"}`)
      : status === "stopped"
        ? "stopped by user"
        : `exit ${result.exitCode ?? 0} · ${result.durationMs}ms`;
    const timeline = buildTimeline(startedAt, timelineEvents, status, finalDetail);

    this.setGlobalStatus(status);
    this.updateAssistantMessage(assistantId, {
      status,
      stderr: newStderr,
      log: newLog,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timeline,
      sdkEvents: sdkEvents.length > 0 ? sdkEvents : undefined,
    });

    await new Promise((r) => setTimeout(r, 300));
    const afterFiles = await snapshotVaultMarkdownFiles(vaultPath);
    const newFiles = diffSnapshots(this.beforeFiles, afterFiles);
    if (newFiles.length > 0) {
      this.updateAssistantMessage(assistantId, { generatedFiles: newFiles });
    }

    // V1.5: 构造 Workflow Trace（UI-only，含 preflight/build_prompt/spawn/stdout/stderr/file_diff_scan/终态）
    // preflight 状态：null 表示未执行（mock 模式 / 未点 Preflight）；用 lastPreflightResult 推断
    const preflightOk = this.lastPreflightResult ? this.lastPreflightResult.available : null;
    const workflowFinalDetail = finalDetail;
    const workflowTrace = buildWorkflowTrace(
      startedAt,
      preflightOk,
      promptLength,
      workflowEvents,
      newFiles.length,
      status,
      workflowFinalDetail,
    );
    this.updateAssistantMessage(assistantId, { workflowTrace });
    // V2.0: 运行流程区展示完整 6 步流程
    this.showRunFlowTrace(workflowTrace, status);

    // V2.5: 运行结束后保存会话到历史（失败不阻断；同一会话 id 复用）
    try {
      const s = this.plugin.settings;
      // V2.16-E: 只保存 pinned context；普通 message attachments 已在对应 user message 上。
      const extras: SessionExtras = {
        pinnedContextRefs: this.pinnedFileRefs.map((r) => ({
          id: r.id, kind: r.kind, displayName: r.displayName,
          requestedPath: r.requestedPath, resolvedPath: r.resolvedPath,
          pathKind: r.pathKind, fileType: r.fileType, previewText: r.previewText, source: r.source,
          grantScope: r.grantScope, scope: r.scope, createdAt: r.createdAt, status: r.status,
        })),
        sessionMode: s.sessionMode,
        model: s.model,
        effortLevel: s.effortLevel,
        backendMode: s.backendMode,
        permissionMode: s.claudePermissionMode,
        // V2.17-A Completion: provider session persistence（codex threadId/sessionId）
        providerThreadId: this.session?.providerThreadId,
        providerSessionId: this.session?.providerSessionId,
      };
      const savedId = await saveSession(
        vaultPath,
        this.sessionState,
        this.messages,
        s.agentType,
        this.currentSessionId || undefined,
        extras,
      );
      if (savedId) {
        this.currentSessionId = savedId;
        // V2.16-D: 更新 lastActiveSessionId 用于会话保持
        if (s.keepLastSession) {
          s.lastActiveSessionId = savedId;
          await this.plugin.saveSettings();
        }
        // V2.9: 强制重载（force=true），确保新保存的会话立即出现，不被 5s 缓存拦截
        void this.refreshHistory(true);
      }
    } catch {
      // 保存失败不阻断主流程
    }
  }

  // ---------- 日志保存 ----------

  private async saveLogFile(result: RunResult, vaultPath: string): Promise<string> {
    const logsDir = path.join(vaultPath, ".llm-bridge", "logs");
    await fs.promises.mkdir(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const agent = this.plugin.settings.agentType;
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
    return file; // V2.4: 返回具体文件路径，用于 debug log 提示
  }

  // ---------- 文件检测 ----------
  // V0.9: snapshotVaultMarkdownFiles / diffSnapshots 已抽取到 fileDiff.ts

  private async openGeneratedFile(displayPath: string): Promise<void> {
    const relPath = extractRelPath(displayPath);
    const file = this.app.vault.getAbstractFileByPath(relPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(file);
      return;
    }
    // V2.8: 文件不存在/未索引时弹 Modal 显示完整路径 + 复制按钮
    this.showFileNotFoundModal(relPath);
  }

  // V2.8: 文件未找到时的提示 Modal（显示路径 + 复制按钮）
  private showFileNotFoundModal(relPath: string): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText("文件无法打开");
    modal.contentEl.empty();
    modal.contentEl.addClass("llm-bridge-file-not-found-modal");
    modal.contentEl.createEl("p", {
      text: "文件可能已被删除或尚未被 Obsidian 索引。可复制路径后手动查找：",
      cls: "llm-bridge-confirm-msg",
    });
    const pathBox = modal.contentEl.createDiv({ cls: "llm-bridge-file-path-box" });
    pathBox.createEl("code", { text: relPath, cls: "llm-bridge-file-path-code" });
    const btns = modal.contentEl.createDiv({ cls: "modal-button-container" });
    const copyBtn = btns.createEl("button", { text: "复制路径" });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(relPath);
        new Notice("路径已复制");
      } catch {
        new Notice("复制失败，请手动选取");
      }
    });
    const closeBtn = btns.createEl("button", { text: "关闭", cls: "mod-warning" });
    closeBtn.addEventListener("click", () => modal.close());
    modal.open();
  }
}
