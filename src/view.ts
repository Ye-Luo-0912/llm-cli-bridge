// LLM CLI Bridge — 右侧 Chat View（Codex / Claude Code 风格紧凑工作台）

import { App, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, normalizePath, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type LLMBridgePlugin from "../main";
import { buildPrompt } from "./prompt";
import { buildPromptPackage, StateSnapshot } from "./promptPackage";
import { AgentRunHandle, SdkImageContentBlock, SdkStreamingInput } from "./agentBackend";
import { exportState } from "./state";
import { diffSnapshots, extractRelPath, FileSnapshot, snapshotVaultMarkdownFiles } from "./fileDiff";
import { AgentType, AttachmentPlan, BackendMode, ChatMessage, EffectiveRunPlan, RunResult, RunStatus, SessionMode } from "./types";
import type { PendingActionEntry } from "./httpServer";
import { runPreflight, PreflightResult } from "./agentProfile";
import { mapPreflightToStatus, buildErrorSummary } from "./preflightStatus";
import { buildFirstUseGuide, shouldShowFirstUseGuide } from "./firstUseGuide";
import { buildTimeline, isTerminalTimelineType, timelineTypeClass, timelineTypeLabel, TimelineEventType } from "./runTimeline";
import { buildCommandLine, buildCommandPreview, buildRedactedCommandDisplay, previewToRows, CommandPreview } from "./commandProfile";
import { buildWorkflowTrace, workflowStageLabel, workflowStageClass, isTerminalWorkflowStage, WorkflowTraceStage, WorkflowTraceEvent } from "./workflowTrace";
import { formatEffectiveRunPlan } from "./effectiveRunPlan";
import { createBridgeSession, type BridgeSessionImpl } from "./runtime/core/bridgeSession";
import type { BridgeSession, RunInput, NormalizedRuntimeEvent, ApprovalResponse } from "./runtime/core/types";
import { buildBridgePromptPackage } from "./runtime/core/promptPackage";
import { mapNormalizedToWorkflowEvent } from "./runtime/providers/workflowEventMapper";
import { getRuntimeModelCatalog, normalizeModelValue, normalizeEffortValue, findModelEntry, findEffortEntry, type RuntimeModelCatalog } from "./runtimeModelCatalog";
import { WorkflowEvent, PermissionEvent, buildToolTimeline, workflowEventLabel, workflowEventIcon, workflowEventClass, truncateText, extractFileChanges } from "./workflowEvent";
import { computeTimelineStats, formatCompletedSummary, formatFailedSummary, extractToolPath, extractToolParams, pathBasename, countLines, truncatePath, isInternalFilePath, type TimelineNode, type TimelineNodeKind } from "./timelineAdapter";
import { RunStateAggregator, aggregateEventsToTimeline } from "./runtimeTranscript";
import { computeContextMetrics, formatTokens, formatCompressionRatio, type ContextMetrics, type CompressionInfo } from "./contextMetrics";
import { SessionState, createNewSession, generateSessionTitle, sessionStatusLabel, sessionStatusClass, updateSession } from "./session";
import { PersistedSession, SessionListItem, SessionExtras, saveSession, listSessions, loadSession, deleteSession, renameSession } from "./sessions";
import { AgentSkillRecord, loadAgentSkillsManifest, saveAgentSkillsManifest } from "./agentSkills";
import { getPermissionModeInfo, type PermissionChoice } from "./sdkPermission";
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

export const VIEW_TYPE_LLM_BRIDGE = "llm-cli-bridge-view";
export const VIEW_TYPE_AGENT_SKILL_DOCUMENT = "llm-cli-bridge-agent-skill-document";

interface AgentSkillDocumentState {
  skillPath?: string;
  displayPath?: string;
  title?: string;
}

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
    const copyBtn = header.createEl("button", { cls: "llm-bridge-agent-skill-doc-copy", text: "复制路径" });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(displayPath || skillPath);
        new Notice("已复制 Skill 路径");
      } catch {
        new Notice("复制 Skill 路径失败");
      }
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
      err.createEl("pre", { cls: "llm-bridge-error-detail", text: error instanceof Error ? error.message : String(error) });
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

export class LLMBridgeView extends ItemView {
  private plugin: LLMBridgePlugin;
  // V2.17-A Completion: BridgeSession 替代 cachedBackend。
  // UI 不再直接持有 SdkBackend/ClaudeCliBackend/MockAgentBackend，只通过 BridgeSession
  // 与 RuntimeProvider 交互。session 按 settings.backendMode 缓存，mode 变化时重建。
  private session: BridgeSessionImpl | null = null;
  private sessionMode: BackendMode | null = null;
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
  // V2.13.0-F: Agent Skills 是 runtime capability，不插入 composer。
  private agentSkills: AgentSkillRecord[] = [];
  private agentSkillsToggleEl!: HTMLElement;
  private agentSkillsBodyEl!: HTMLElement;
  private agentSkillsListEl!: HTMLElement;
  // V2.9: scrollToBottom rAF 批处理定时器（合并同帧多次调用，避免每个 delta 触发 reflow）
  private scrollRafId: number | null = null;
  private streamContentRafId: number | null = null;
  private streamContentAssistantId: string | null = null;
  private liveTimelineTimerId: number | null = null;
  // V2.5: 历史会话列表
  private historyListEl!: HTMLElement;
  private historyToggleEl!: HTMLElement;
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
  private activeFileLabelEl!: HTMLElement;
  private selectionLabelEl!: HTMLElement;
  private agentChipGroup!: HTMLElement;
  private agentChipTextEl!: HTMLElement;
  private modelChipGroup!: HTMLElement;
  private effortChipGroup!: HTMLElement;
  private modelEffortPickerEl!: HTMLElement;
  private modelEffortButtonEl!: HTMLButtonElement;
  private modelEffortPopoverEl!: HTMLElement;
  /** V2.16-C: 运行时模型目录（不再硬编码） */
  private modelCatalog: RuntimeModelCatalog = getRuntimeModelCatalog();
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
  private pendingPermissions: Map<string, PermissionEvent> = new Map();
  // V2.14.0-E: 外部 read 授权仅存在于当前 Bridge View/session 生命周期
  private externalReadGrantStore: SessionReadGrantStore = createSessionReadGrantStore();
  private externalReadPanelEl!: HTMLElement;
  // V2.16-E: 普通附件只属于本轮消息；只有 pinned context 跨轮保留。
  private messageFileRefs: FileRef[] = [];
  private pinnedFileRefs: FileRef[] = [];
  private sessionFileRefs: FileRef[] = [];
  private attachmentReadGrants: FileAccessReadGrant[] = [];
  private attachmentTextSnippets: AttachmentTextSnippet[] = [];
  private attachmentFileInputEl!: HTMLInputElement;
  private pinnedContextEl!: HTMLElement;
  private composerFileRefsEl!: HTMLElement;
  private filesContextEl!: HTMLElement;
  private filePreviewLeaf: WorkspaceLeaf | null = null;
  // V2.16-D: Context metrics UI 元素
  private contextRingEl!: HTMLElement;
  private contextLabelEl!: HTMLElement;
  private contextDetailEl!: HTMLElement;
  private lastContextMetrics: ContextMetrics | null = null;
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
    topbarBrand.createEl("span", { cls: "llm-bridge-topbar-logo", text: "⌘" });
    topbarBrand.createEl("span", { cls: "llm-bridge-topbar-title", text: "Bridge" });
    this.pageTitleEl = topbarBrand.createEl("span", { cls: "llm-bridge-page-title", text: "Chat" });
    const sessionPreview = header.createEl("button", {
      cls: "llm-bridge-session-selector",
      attr: { title: "打开最近会话下拉；完整历史在 History 页面" },
    });
    sessionPreview.createEl("span", { cls: "llm-bridge-session-kicker", text: "当前会话" });
    this.sessionTitleEl = sessionPreview.createEl("span", { cls: "llm-bridge-sb-session-title", text: this.sessionState.title });
    sessionPreview.createEl("span", { cls: "llm-bridge-session-caret", text: "⌄" });
    const sessionDropdown = header.createDiv({ cls: "llm-bridge-session-dropdown" });
    sessionDropdown.setAttribute("hidden", "");

    const headerRight = header.createDiv({ cls: "llm-bridge-header-right" });
    this.clearBtn = headerRight.createEl("button", {
      cls: "llm-bridge-new-chat-btn",
      text: "+ 新聊天",
      attr: { title: "新建会话（清空消息）" },
    });
    this.clearBtn.addEventListener("click", () => this.newSession());
    const settingsBtn = headerRight.createEl("button", { cls: "llm-bridge-icon-btn llm-bridge-settings-btn", attr: { title: "打开插件设置" } });
    settingsBtn.createEl("span", { cls: "llm-bridge-icon", text: "⚙" });
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

    // agent selector 迁入 composer 右侧；header 只保留 compact runtime status。
    const agentSelect = document.createElement("select");
    agentSelect.className = "llm-bridge-agent-select";
    for (const a of AGENT_OPTIONS) {
      agentSelect.createEl("option", { value: a.value, text: a.label });
    }
    agentSelect.addEventListener("change", async () => {
      if (this.runHandle) return;
      this.plugin.settings.agentType = agentSelect.value as AgentType;
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
    const skillsTab = nav.createEl("button", { cls: "llm-bridge-nav-item", attr: { "data-tab": "skills", title: "Skills", "aria-label": "Skills" } });
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
      if (this.pageTitleEl) {
        this.pageTitleEl.textContent = tab === "chat" ? "Chat" : tab === "files" ? "Files" : tab === "skills" ? "Skills" : "History";
      }
      if (tab === "skills") {
        const agentBody = skillsPanel.querySelector(".llm-bridge-agent-skills-body") as HTMLElement | null;
        if (agentBody && agentBody.hasAttribute("hidden")) agentBody.removeAttribute("hidden");
        this.updateAgentSkillsToggle();
      } else if (tab === "history") {
        const hBody = historyPanel.querySelector(".llm-bridge-history-body") as HTMLElement | null;
        if (hBody && hBody.hasAttribute("hidden")) hBody.removeAttribute("hidden");
        if (this.historyToggleEl) this.historyToggleEl.textContent = "\u25BC History";
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

    // ===== Files page: attachments / pinned context / FileRef index / approvals =====
    const filesHead = filesPanel.createDiv({ cls: "llm-bridge-secondary-head" });
    filesHead.createEl("span", { cls: "llm-bridge-secondary-kicker", text: "Files" });
    filesHead.createEl("strong", { text: "Attachments、Pinned context 与 FileRef index" });
    filesHead.createEl("small", { text: "这里只管理文件引用和授权状态；文件执行交给 Claude Code / SDK native handoff。" });
    this.filesContextEl = filesPanel.createDiv({ cls: "llm-bridge-context-refs llm-bridge-context-refs-page" });

    // ===== Pending Actions 区域（在 Files 页默认折叠） =====
    this.pendingActionsEl = filesPanel.createDiv({ cls: "llm-bridge-pending-wrap" });
    const pendingHead = this.pendingActionsEl.createDiv({ cls: "llm-bridge-pending-head" });
    const pendingToggle = pendingHead.createEl("span", { cls: "llm-bridge-pending-toggle", text: "▶ Action approvals (0)" });
    this.pendingActionsCountEl = pendingHead.createEl("span", { cls: "llm-bridge-pending-count", text: "" });
    const pendingBody = this.pendingActionsEl.createDiv({ cls: "llm-bridge-pending-body" });
    pendingBody.setAttribute("hidden", "");
    this.pendingActionsBody = pendingBody;
    pendingToggle.addEventListener("click", () => {
      const hidden = pendingBody.hasAttribute("hidden");
      if (hidden) {
        pendingBody.removeAttribute("hidden");
        pendingToggle.textContent = "▼ Action approvals";
      } else {
        pendingBody.setAttribute("hidden", "");
        pendingToggle.textContent = "▶ Action approvals";
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

    // ===== V2.5: 历史会话入口（可折叠，默认折叠） =====
    this.renderHistoryPanel(historyPanel);

    // ===== V1.2: 首次使用提示（可关闭，关闭后不再显示） =====
    this.renderFirstUseGuide(chatPanel);

    // Developer mode keeps the legacy global Run Flow; user mode shows process inside each assistant turn.
    if (this.plugin.settings.developerMode) {
      this.renderRunFlowPanel(chatPanel);
    }

    // ===== 消息流（对话区） =====
    this.messagesEl = chatPanel.createDiv({ cls: "llm-bridge-messages" });
    this.renderEmptyState();

    // V2.3s: 权限请求面板（运行中实时展示 pending 权限请求，用户点击允许/拒绝）
    this.permissionPanelEl = chatPanel.createDiv({ cls: "llm-bridge-perm-panel" });
    this.permissionPanelEl.style.display = "none";
    // V2.14.0-E: 外部读取授权请求面板（只管理授权，不读取文件内容）
    this.externalReadPanelEl = filesPanel.createDiv({ cls: "llm-bridge-external-read-panel" });
    this.externalReadPanelEl.style.display = "none";

    // 轻量 Context toggles；不再常驻展示空附件区域。
    const contextToggles = chatPanel.createDiv({ cls: "llm-bridge-context-toggles" });
    contextToggles.createEl("span", {
      cls: "llm-bridge-context-toggles-label",
      text: "Sources",
      attr: { title: "当前消息可启用的上下文来源" },
    });
    const contextChipsRow = contextToggles.createDiv({ cls: "llm-bridge-context-toggle-chips" });
    this.pinnedContextEl = chatPanel.createEl("details", { cls: "llm-bridge-pinned-context" });
    this.pinnedContextEl.setAttribute("hidden", "");

    // V2.16-D: Context indicator（composer 上方轻量条，点击展开明细）
    const contextStrip = chatPanel.createDiv({ cls: "llm-bridge-context-strip" });
    this.contextRingEl = contextStrip.createDiv({ cls: "llm-bridge-context-ring" });
    this.contextLabelEl = contextStrip.createDiv({ cls: "llm-bridge-context-label", text: "Context estimate" });
    this.contextDetailEl = contextStrip.createDiv({ cls: "llm-bridge-context-detail" });
    this.contextDetailEl.setAttribute("hidden", "");
    contextStrip.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".llm-bridge-context-detail")) return;
      if (this.contextDetailEl.hasAttribute("hidden")) {
        this.contextDetailEl.removeAttribute("hidden");
      } else {
        this.contextDetailEl.setAttribute("hidden", "");
      }
    });

    // ===== 底部 composer =====
    const composer = chatPanel.createDiv({ cls: "llm-bridge-composer" });

    const composerBar = composer.createDiv({ cls: "llm-bridge-composer-bar" });
    composerBar.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, select, summary, details, input, textarea")) return;
      this.inputEl.focus();
    });
    const leftTools = composerBar.createDiv({ cls: "llm-bridge-composer-tools llm-bridge-composer-tools-left" });
    const attachmentBtn = leftTools.createEl("button", {
      cls: "llm-bridge-composer-tool-btn llm-bridge-attach-file-btn",
      attr: { title: "直接拖拽文件、粘贴文件或粘贴路径；输入 @ 选择 Vault 文件" },
    });
    setIcon(attachmentBtn, "plus");
    attachmentBtn.addEventListener("click", () => {
      this.inputEl.focus();
      new Notice("直接拖拽文件到输入框、粘贴文件/路径，或输入 @ 选择 Vault 文件。", 3500);
    });
    const commandMenu = leftTools.createEl("details", { cls: "llm-bridge-command-menu" });
    const commandSummary = commandMenu.createEl("summary", {
      cls: "llm-bridge-composer-tool-btn llm-bridge-command-menu-summary",
      attr: { title: "命令入口：检测、路径附件、刷新上下文" },
    });
    setIcon(commandSummary, "terminal");
    const commandMenuBody = commandMenu.createDiv({ cls: "llm-bridge-command-menu-body" });
    this.preflightBtn = commandMenuBody.createEl("button", {
      cls: "llm-bridge-command-menu-item",
      text: "检测 runtime",
      attr: { title: "检测 agent 命令是否可用（不调用真实模型）" },
    });
    this.preflightBtn.addEventListener("click", () => {
      commandMenu.removeAttribute("open");
      void this.runPreflightCheck();
    });
    const refreshContextBtn = commandMenuBody.createEl("button", {
      cls: "llm-bridge-command-menu-item",
      text: "刷新上下文",
      attr: { title: "刷新当前笔记、选区和状态显示" },
    });
    refreshContextBtn.addEventListener("click", () => {
      commandMenu.removeAttribute("open");
      this.lastPreflightResult = null;
      this.updateContextDisplay();
      this.syncControlsFromSettings();
    });
    const pathAttachBtn = commandMenuBody.createEl("button", {
      cls: "llm-bridge-command-menu-item llm-bridge-attach-path-btn",
      text: "添加路径附件",
      attr: { title: "通过路径添加附件（fallback/debug）" },
    });
    pathAttachBtn.addEventListener("click", () => {
      commandMenu.removeAttribute("open");
      void this.promptAndAddAttachmentFile();
    });
    this.permissionModeChipEl = leftTools.createEl("button", {
      cls: "llm-bridge-permission-chip",
      attr: { title: "切换权限模式：受限 / 默认 / acceptEdits" },
    });
    this.permissionModeChipEl.addEventListener("click", () => void this.togglePermissionPopover());

    const inputRow = composerBar.createDiv({ cls: "llm-bridge-input-row" });
    this.composerFileRefsEl = inputRow.createDiv({ cls: "llm-bridge-composer-file-refs" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "llm-bridge-input",
      attr: { placeholder: "输入消息，或使用 / 命令…", rows: "3" },
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

    // Note / Selection 上下文 toggles：只按开关进入当前 run。
    const chipsRow = contextChipsRow;
    this.includeNoteCheckEl = this.buildContextChip(chipsRow, "Note", () => this.plugin.settings.includeActiveNote, async (on) => {
      this.plugin.settings.includeActiveNote = on;
      await this.plugin.saveSettings();
    });
    this.activeFileLabelEl = this.includeNoteCheckEl.parentElement!.createEl("span", { cls: "llm-bridge-chip-file", text: "" });

    this.includeSelectionCheckEl = this.buildContextChip(chipsRow, "Selection", () => this.plugin.settings.includeSelection, async (on) => {
      this.plugin.settings.includeSelection = on;
      await this.plugin.saveSettings();
    });
    this.selectionLabelEl = this.includeSelectionCheckEl.parentElement!.createEl("span", { cls: "llm-bridge-chip-file", text: "" });
    this.attachmentFileInputEl = composer.createEl("input", {
      attr: { type: "file", multiple: "true", tabindex: "-1" },
    });
    this.attachmentFileInputEl.addClass("llm-bridge-native-file-input");
    this.attachmentFileInputEl.addEventListener("change", () => void this.addNativeSelectedAttachments());

    composer.addEventListener("dragover", (event) => {
      const hasFiles = !!event.dataTransfer?.files?.length || Array.from(event.dataTransfer?.types ?? []).some((type) => /files|uri-list|plain/i.test(type));
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
      this.updateContextDisplay();
      this.refreshStatusBar();
      void this.refreshContextMetrics();
    }));
    // V2.10 (B-001): 订阅 file-open 事件，确保同一 pane 内切换文件时 chip 立即更新
    // active-leaf-change 在某些场景（如快速切换同 pane 文件）可能延迟或不触发，file-open 更可靠
    this.registerEvent(this.app.workspace.on("file-open", () => {
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
          text: "✓ 本次",
          attr: { title: "仅本次允许，不缓存" },
        });
        allowOnceBtn.addEventListener("click", () => {
          bridge.approvePendingActionWithDecision(entry.id, "allow_once");
          this.pendingActions = this.pendingActions.filter((a) => a.id !== entry.id);
          this.refreshPendingActions();
        });
        const allowSessionBtn = btnRow.createEl("button", {
          cls: "llm-bridge-pending-btn-approve llm-bridge-pending-btn-session",
          text: "✓ 本会话",
          attr: { title: "本会话内允许同类操作，不再询问" },
        });
        allowSessionBtn.addEventListener("click", () => {
          bridge.approvePendingActionWithDecision(entry.id, "allow_session");
          this.pendingActions = this.pendingActions.filter((a) => a.id !== entry.id);
          this.refreshPendingActions();
        });
        const rejectBtn = btnRow.createEl("button", {
          cls: "llm-bridge-pending-btn-reject",
          text: "✗ 拒绝",
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
  private buildContextChip(
    parent: HTMLElement,
    label: string,
    getCurrent: () => boolean,
    onToggle: (on: boolean) => Promise<void>,
  ): HTMLInputElement {
    const wrap = parent.createDiv({ cls: "llm-bridge-chip-wrap" });
    const check = wrap.createEl("input", { type: "checkbox", cls: "llm-bridge-chip-check" });
    check.checked = getCurrent();
    const chip = wrap.createEl("button", {
      cls: "llm-bridge-chip llm-bridge-chip-toggle",
      text: label,
      attr: { "aria-pressed": String(check.checked) },
    });
    chip.addEventListener("click", async (e) => {
      e.preventDefault();
      if (this.runHandle) return;
      check.checked = !check.checked;
      chip.setAttribute("aria-pressed", String(check.checked));
      await onToggle(check.checked);
      this.refreshAllChips();
    });
    return check;
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

    // 上下文 chip 勾选态
    const noteChip = this.includeNoteCheckEl.parentElement?.querySelector(".llm-bridge-chip-toggle");
    if (noteChip) {
      noteChip.classList.toggle("is-active", this.plugin.settings.includeActiveNote);
      noteChip.setAttribute("aria-pressed", String(this.plugin.settings.includeActiveNote));
    }
    const selChip = this.includeSelectionCheckEl.parentElement?.querySelector(".llm-bridge-chip-toggle");
    if (selChip) {
      selChip.classList.toggle("is-active", this.plugin.settings.includeSelection);
      selChip.setAttribute("aria-pressed", String(this.plugin.settings.includeSelection));
    }
  }

  private refreshCycleChip(wrap: HTMLElement, options: { value: string; label: string }[], v: string): void {
    const chip = wrap.querySelector(".llm-bridge-chip") as HTMLButtonElement | null;
    if (chip) chip.textContent = this.labelForValue(options, v);
  }

  private renderModelEffortPicker(parent: HTMLElement): void {
    this.modelEffortPickerEl = parent.createDiv({ cls: "llm-bridge-model-effort-picker" });
    this.modelEffortButtonEl = this.modelEffortPickerEl.createEl("button", {
      cls: "llm-bridge-model-effort-chip",
      attr: { title: "选择模型与推理等级", "aria-haspopup": "true", "aria-expanded": "false" },
    });
    this.modelEffortButtonEl.addEventListener("click", (event) => {
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
    for (const model of this.modelCatalog.models) {
      const option = modelSection.createEl("button", {
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
    // 下半部分：推理等级（使用原始名称，不中文化）
    const effortSection = this.modelEffortPopoverEl.createDiv({ cls: "llm-bridge-model-effort-section llm-bridge-effort-list" });
    effortSection.createEl("div", { cls: "llm-bridge-model-effort-section-title", text: "Effort" });
    for (const effort of this.modelCatalog.efforts) {
      const option = effortSection.createEl("button", {
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
    this.modelEffortPickerEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeModelEffortPopover();
    });
    this.registerDomEvent(document, "pointerdown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".llm-bridge-model-effort-picker")) return;
      this.closeModelEffortPopover();
      if (target?.closest(".llm-bridge-permission-chip")) return;
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
    // V2.16-C: 使用 catalog 归一化，不再依赖硬编码 MODEL_OPTIONS/EFFORT_OPTIONS
    const nextModel = normalizeModelValue(this.modelCatalog, model);
    const nextEffort = normalizeEffortValue(this.modelCatalog, effort);
    this.plugin.settings.model = nextModel;
    this.plugin.settings.effortLevel = nextEffort;
    await this.plugin.saveSettings();
    this.refreshAllChips();
  }

  private toggleModelEffortPopover(): void {
    if (!this.modelEffortPopoverEl) return;
    if (this.modelEffortPopoverEl.hasAttribute("hidden")) {
      this.modelEffortPopoverEl.removeAttribute("hidden");
      this.modelEffortPopoverEl.classList.add("is-open");
      this.modelEffortButtonEl?.setAttribute("aria-expanded", "true");
    } else {
      this.closeModelEffortPopover();
    }
  }

  private closeModelEffortPopover(): void {
    if (!this.modelEffortPopoverEl) return;
    this.modelEffortPopoverEl.setAttribute("hidden", "");
    this.modelEffortPopoverEl.classList.remove("is-open");
    this.modelEffortButtonEl?.setAttribute("aria-expanded", "false");
  }

  private refreshModelEffortPicker(): void {
    if (!this.modelEffortButtonEl) return;
    // V2.16-C: 从 catalog 读取 label，不再依赖硬编码列表
    const model = findModelEntry(this.modelCatalog, this.plugin.settings.model);
    const effort = findEffortEntry(this.modelCatalog, this.plugin.settings.effortLevel);
    const modelLabel = model?.label ?? this.plugin.settings.model ?? "unknown";
    const effortLabel = effort?.label ?? this.plugin.settings.effortLevel ?? "unknown";
    this.modelEffortButtonEl.textContent = `${modelLabel} · ${effortLabel}`;
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
    if (mode === "plan") return "受限";
    if (mode === "default") return "默认";
    if (mode === "acceptEdits") return "acceptEdits";
    return mode;
  }

  /**
   * V2.16-C: 渲染 Claude 风格 permission mode popover（四模式）
   */
  private renderPermissionPopover(): void {
    if (!this.permissionModeChipEl) return;
    // 移除旧 popover
    this.permissionPopoverEl?.remove();
    this.permissionPopoverEl = this.permissionModeChipEl.createDiv({
      cls: "llm-bridge-perm-popover",
      attr: { hidden: "" },
    });
    const modes: Array<{ value: string; icon: string; title: string; desc: string }> = [
      { value: "default", icon: "✓", title: "Ask before edits", desc: "编辑前询问确认" },
      { value: "acceptEdits", icon: "✎", title: "Edit automatically", desc: "自动接受文件编辑" },
      { value: "plan", icon: "☐", title: "Plan mode", desc: "只读规划，不执行修改" },
      { value: "auto", icon: "⚡", title: "Auto mode", desc: "自动决策，低风险自动允许" },
    ];
    const current = this.plugin.settings.claudePermissionMode;
    for (const mode of modes) {
      const opt = this.permissionPopoverEl.createDiv({
        cls: "llm-bridge-perm-option" + (current === mode.value ? " is-active" : ""),
      });
      opt.createEl("span", { cls: "llm-bridge-perm-option-icon", text: mode.icon });
      const text = opt.createDiv({ cls: "llm-bridge-perm-option-text" });
      text.createEl("div", { cls: "llm-bridge-perm-option-title", text: mode.title });
      text.createEl("div", { cls: "llm-bridge-perm-option-desc", text: mode.desc });
      opt.createEl("span", { cls: "llm-bridge-perm-option-check", text: "✓" });
      opt.addEventListener("click", async () => {
        await this.setPermissionMode(mode.value);
        this.closePermissionPopover();
      });
    }
  }

  /**
   * V2.16-C: 打开/关闭 permission mode popover
   */
  private togglePermissionPopover(): void {
    if (!this.permissionPopoverEl) return;
    const hidden = this.permissionPopoverEl.hasAttribute("hidden");
    if (hidden) {
      this.closeModelEffortPopover();
      this.renderPermissionPopover();
      this.permissionPopoverEl.removeAttribute("hidden");
    } else {
      this.closePermissionPopover();
    }
  }

  /**
   * V2.16-C: 关闭 permission mode popover
   */
  private closePermissionPopover(): void {
    this.permissionPopoverEl?.setAttribute("hidden", "");
  }

  /**
   * V2.16-C: 设置 permission mode（Claude 风格四模式）
   */
  private async setPermissionMode(mode: string): Promise<void> {
    if (this.runHandle) return;
    this.plugin.settings.claudePermissionMode = mode as never;
    await this.plugin.saveSettings();
    this.refreshPermissionModeChip();
    this.refreshStatusBar();
  }

  private refreshPermissionModeChip(): void {
    if (!this.permissionModeChipEl) return;
    const mode = this.plugin.settings.claudePermissionMode ?? "default";
    const info = getPermissionModeInfo(mode);
    const claudeLabel = mode === "default" ? "Ask before edits"
      : mode === "acceptEdits" ? "Edit automatically"
      : mode === "plan" ? "Plan mode"
      : mode === "auto" ? "Auto mode"
      : mode;
    this.permissionModeChipEl.textContent = claudeLabel;
    this.permissionModeChipEl.setAttribute("title", `权限模式：${info.label}\n${info.risk}\n点击切换：受限 / 默认 / acceptEdits`);
    this.permissionModeChipEl.classList.remove("is-safe", "is-caution", "is-danger");
    this.permissionModeChipEl.classList.add(`is-${info.level}`);
  }

  private async cyclePermissionMode(): Promise<void> {
    if (this.runHandle) return;
    const modes: Array<"plan" | "default" | "acceptEdits"> = ["plan", "default", "acceptEdits"];
    const current = this.plugin.settings.claudePermissionMode ?? "default";
    const index = modes.indexOf(current as "plan" | "default" | "acceptEdits");
    const next = modes[(index + 1 + modes.length) % modes.length];
    this.plugin.settings.claudePermissionMode = next;
    await this.plugin.saveSettings();
    this.refreshPermissionModeChip();
    this.refreshStatusBar();
  }

  async onClose(): Promise<void> {
    this.closeModelEffortPopover();
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
    this.refreshStatusBar();
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
    const f = this.app.workspace.getActiveFile();
    this.activeFileLabelEl.textContent = f ? path.basename(f.path) : "";
    const sel = this.getSelection();
    if (sel) {
      this.selectionLabelEl.textContent = `${sel.length}c`;
    } else {
      this.selectionLabelEl.textContent = "";
    }
    const noteChip = this.includeNoteCheckEl.parentElement?.querySelector<HTMLElement>(".llm-bridge-chip-toggle");
    if (noteChip) {
      noteChip.setAttribute("title", f ? `当前笔记：${f.path}` : "当前没有活动笔记");
    }
    const selectionChip = this.includeSelectionCheckEl.parentElement?.querySelector<HTMLElement>(".llm-bridge-chip-toggle");
    if (selectionChip) {
      selectionChip.setAttribute("title", sel ? `当前选区：${sel.length} chars` : "当前没有选区");
    }
  }

  // V2.17-A Completion: 获取/缓存 BridgeSession（替代旧 getBackend）。
  // UI 不再直接构造 SdkBackend/ClaudeCliBackend/MockAgentBackend；provider 选择由
  // createBridgeSession 按 settings.backendMode + provider 可用性决定。
  // codex-app-server 在 auto 模式下优先（primary target）。
  private getSession(): BridgeSessionImpl {
    const mode = this.plugin.settings.backendMode;
    if (this.session && this.sessionMode === mode) {
      return this.session;
    }
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const sess = createBridgeSession(
      `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      this.plugin.settings,
      vaultPath,
    );
    this.session = sess;
    this.sessionMode = mode;
    this.actualRuntimeLabel = sess.displayLabel;
    return sess;
  }

  private setGlobalStatus(status: RunStatus): void {
    const runtimeLabel = this.actualRuntimeLabel;
    const runtimeState = status === "failed" ? "失败" : status === "running" ? "运行中" : "已连接";
    this.statusLabelEl.textContent = `${runtimeLabel} · ${runtimeState}`;
    this.statusDotEl.className = `llm-bridge-status-dot llm-bridge-status-dot-${status}`;
    this.statusDotEl.setAttribute("title", STATUS_LABEL[status]);
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
    const runtimeState = this.sessionState.status === "failed" ? "error" : this.sessionState.status === "running" ? "running" : "ready";
    this.statusLabelEl.textContent = `${runtimeLabel} · ${runtimeState}`;
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
  private refreshPermissionPanel(): void {
    const panel = this.permissionPanelEl;
    panel.empty();

    if (this.pendingPermissions.size === 0) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";

    // 标题
    const header = panel.createDiv({ cls: "llm-bridge-perm-panel-header" });
    header.createEl("span", { cls: "llm-bridge-perm-panel-title", text: "权限请求" });
    header.createEl("span", { cls: "llm-bridge-perm-panel-count", text: `${this.pendingPermissions.size} 项待决策` });

    // 按 mergeKey 合并展示（相同工具+风险+路径前缀合并）
    const mergeGroups = new Map<string, PermissionEvent[]>();
    for (const [, ev] of this.pendingPermissions) {
      const key = ev.mergeKey ?? ev.requestId ?? "unknown";
      if (!mergeGroups.has(key)) mergeGroups.set(key, []);
      mergeGroups.get(key)!.push(ev);
    }

    for (const [, group] of mergeGroups) {
      const first = group[0];
      const card = panel.createDiv({ cls: `llm-bridge-perm-card is-risk-${first.riskLevel ?? "low"}` });

      // 工具名 + 来源 agent
      const cardHeader = card.createDiv({ cls: "llm-bridge-perm-card-header" });
      cardHeader.createEl("span", { cls: "llm-bridge-perm-card-tool", text: first.toolName });
      if (first.parentToolUseId) {
        cardHeader.createEl("span", { cls: "llm-bridge-perm-card-source is-subagent", text: "Subagent", attr: { title: `parent: ${first.parentToolUseId}` } });
      } else {
        cardHeader.createEl("span", { cls: "llm-bridge-perm-card-source is-main", text: "Main agent" });
      }
      if (group.length > 1) {
        cardHeader.createEl("span", { cls: "llm-bridge-perm-card-merge-count", text: `×${group.length}` });
      }

      // 风险等级 + 风险说明
      const riskEl = card.createDiv({ cls: "llm-bridge-perm-card-risk" });
      riskEl.createEl("span", { cls: `llm-bridge-perm-risk-level is-${first.riskLevel ?? "low"}`, text: first.riskLevel ?? "low" });
      if (first.riskReason) {
        riskEl.createEl("span", { cls: "llm-bridge-perm-risk-reason", text: first.riskReason });
      }

      // 高风险标记（明确提示）
      if (first.highRiskFlags && first.highRiskFlags.length > 0) {
        const flagsEl = card.createDiv({ cls: "llm-bridge-perm-card-flags" });
        flagsEl.createEl("span", { cls: "llm-bridge-perm-flags-label", text: "高风险：" });
        for (const flag of first.highRiskFlags) {
          flagsEl.createEl("span", { cls: "llm-bridge-perm-flag", text: flag });
        }
      }

      // 参数摘要
      if (first.inputSummary) {
        card.createDiv({ cls: "llm-bridge-perm-card-input", text: first.inputSummary, attr: { title: first.inputSummary } });
      }

      // subagent 权限继承风险提示
      if (first.subagentRisk) {
        card.createDiv({ cls: "llm-bridge-perm-card-subagent-warn", text: first.subagentRisk });
      }

      // 决策按钮（允许一次 / 本会话允许 / 拒绝）
      const btns = card.createDiv({ cls: "llm-bridge-perm-card-btns" });
      const requestIds = group.map((g) => g.requestId!).filter(Boolean);

      const allowOnceBtn = btns.createEl("button", { cls: "llm-bridge-perm-btn is-allow-once", text: "允许一次" });
      allowOnceBtn.addEventListener("click", () => this.resolvePermissionRequests(requestIds, "allow_once"));

      const allowSessionBtn = btns.createEl("button", { cls: "llm-bridge-perm-btn is-allow-session", text: "本会话允许" });
      allowSessionBtn.addEventListener("click", () => this.resolvePermissionRequests(requestIds, "allow_session"));

      const denyBtn = btns.createEl("button", { cls: "llm-bridge-perm-btn is-deny", text: "拒绝" });
      denyBtn.addEventListener("click", () => this.resolvePermissionRequests(requestIds, "deny_session"));
    }
  }

  // V2.17-A Completion: 解析权限请求通过 PermissionBoundary（provider-neutral）
  // 不再调用 SdkBackend.resolvePermission；所有 provider 的 approval 都走统一路径。
  private resolvePermissionRequests(requestIds: string[], choice: PermissionChoice): void {
    const permission = this.getSession().permission;
    const response: ApprovalResponse = choice === "allow_once"
      ? { type: "accept" }
      : choice === "allow_session"
        ? { type: "acceptForSession" }
        : { type: "decline" };
    let resolved = 0;
    for (const id of requestIds) {
      if (permission.resolveApproval(id, response)) {
        this.pendingPermissions.delete(id);
        resolved++;
      }
    }
    if (resolved > 0) {
      this.refreshPermissionPanel();
    }
  }

  // V2.3s: 清空待决策权限请求（新会话/停止时调用）
  private clearPendingPermissions(): void {
    if (this.pendingPermissions.size === 0) return;
    // V2.17-A Completion: 通过 PermissionBoundary.cancelAllPending 唤醒所有等待的 provider
    // （provider 收到 cancel 后回传 deny/cancel 给底层 runtime）。
    this.getSession().permission.cancelAllPending();
    this.pendingPermissions.clear();
    this.refreshPermissionPanel();
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
    this.refreshContextRefs();
    return ref;
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
      new Notice("未拿到文件 path，也没有可缓存的文件内容；请使用 @ 选择 Vault 文件，或粘贴/输入文件路径。");
      return [];
    }
    const refs = await this.addUserFilePathsToContext(paths, source);
    new Notice(`已添加 ${refs.length}/${paths.length} 个本轮附件`);
    return refs;
  }

  private async handleComposerPaste(event: ClipboardEvent): Promise<void> {
    const paths = this.collectFilePathsFromClipboardEvent(event);
    const hasClipboardFiles = !!event.clipboardData?.files?.length || Array.from(event.clipboardData?.types ?? []).some((type) => /files|uri-list/i.test(type));
    if (paths.length > 0 || hasClipboardFiles) event.preventDefault();
    for (const cachedPath of await this.cachePathlessFilesFromFileList(event.clipboardData?.files, "paste")) {
      if (!paths.includes(cachedPath)) paths.push(cachedPath);
    }
    if (paths.length === 0) {
      const imagePath = await this.persistElectronClipboardImageToVault();
      if (imagePath) paths.push(imagePath);
    }
    if (paths.length === 0) return;
    event.preventDefault();
    const refs = await this.addUserFilePathsToContext(paths, "paste");
    if (refs.length === 0) {
      new Notice(`未能添加粘贴的文件路径：${paths[0]}`);
      return;
    }
    new Notice(`已从粘贴内容添加 ${refs.length}/${paths.length} 个本轮附件`);
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

    const uriList = data.getData("text/uri-list");
    for (const filePath of this.extractPastedFilePaths(uriList)) addPath(filePath);

    const text = data.getData("text/plain");
    for (const filePath of this.extractPastedFilePaths(text)) addPath(filePath);

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

  private async cachePathlessFilesFromFileList(files: FileList | null | undefined, source: string): Promise<string[]> {
    if (!files?.length) return [];
    const paths: string[] = [];
    for (const file of Array.from(files)) {
      if (this.extractNativeFilePath(file)) continue;
      const cachedPath = await this.persistBlobAttachmentToVault(file, source);
      if (cachedPath) paths.push(cachedPath);
    }
    return paths;
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

  private async buildSdkStreamingInput(prompt: string, refs: ReadonlyArray<FileRef>): Promise<SdkStreamingInput | undefined> {
    // V2.17-A: 仅 image ref 走 SDK streaming image block（Claude Agent SDK 支持 image content block）。
    // 非 image 的 binary blob（PDF/document 等）按 AttachmentPackingPolicy.binaryAsNativeRef=true
    // 退化为 path ref / native tool（与 CLI fallback path ref 一致），不进 streaming input。
    // 这些 native-ref-only 附件由 attachmentPlan.nativeRefOnly 计数审计。
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
        { type: "text", text: prompt },
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

  private extractPastedFilePaths(text: string): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      let candidate = rawLine.trim();
      if (!candidate) continue;
      candidate = candidate.replace(/^file:\/\//i, "");
      candidate = candidate.replace(/^["'`]+|["'`]+$/g, "");
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
        // Keep the original text if it is not URL encoded.
      }
      const looksLikePath = path.isAbsolute(candidate)
        || /^[A-Za-z]:[\\/]/.test(candidate)
        || candidate.startsWith("./")
        || candidate.startsWith("../")
        || candidate.includes("\\")
        || /\/[^/\s]+/.test(candidate);
      if (!looksLikePath) continue;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        paths.push(candidate);
      }
    }
    return paths;
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
      const addText = (text: string | undefined) => {
        if (!text) return;
        for (const filePath of this.extractPastedFilePaths(text)) values.push(filePath);
      };

      addText(clipboard.readText?.());
      for (const format of clipboard.availableFormats?.() ?? []) {
        if (/text\/uri-list|file/i.test(format)) {
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
          addText(text.replace(/\0/g, "\n"));
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
        attr: { title: `预览：${ref.displayName}\n${ref.resolvedPath}`, "aria-label": `预览 ${ref.displayName}` },
      });
      const thumb = chip.createEl("span", { cls: "llm-bridge-composer-file-thumb" });
      const thumbnailUrl = ref.fileType === "image" ? this.getFileRefThumbnailUrl(ref) : null;
      if (thumbnailUrl) {
        thumb.createEl("img", {
          cls: "llm-bridge-composer-file-image",
          attr: { src: thumbnailUrl, alt: ref.displayName },
        });
      } else {
        thumb.createEl("span", { cls: "llm-bridge-composer-file-ext", text: this.getFileRefShortLabel(ref) });
      }
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
    const ext = path.extname(ref.displayName).replace(".", "").trim();
    if (ext) return ext.slice(0, 4).toUpperCase();
    if (ref.fileType === "markdown") return "MD";
    if (ref.fileType === "text") return "TXT";
    if (ref.fileType === "json") return "JSON";
    if (ref.fileType === "pdf") return "PDF";
    if (ref.fileType === "binary") return "BIN";
    return "FILE";
  }

  private getFileRefThumbnailUrl(ref: FileRef): string | null {
    const vaultRelPath = this.resolveFileRefVaultPath(ref);
    if (vaultRelPath) {
      const file = this.app.vault.getAbstractFileByPath(vaultRelPath);
      if (file instanceof TFile) return this.app.vault.getResourcePath(file);
      return this.filePathToUrl(path.join(this.getVaultPath(), vaultRelPath));
    }
    if (path.isAbsolute(ref.resolvedPath)) return this.filePathToUrl(ref.resolvedPath);
    return null;
  }

  private filePathToUrl(filePath: string): string {
    const normalized = path.resolve(filePath).replace(/\\/g, "/");
    return `file:///${normalized.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
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
    const pinned = container.createEl("details", { cls: "llm-bridge-context-section" });
    pinned.createEl("summary", { text: `Pinned context (${this.pinnedFileRefs.length})` });
    const pinnedBody = pinned.createDiv({ cls: "llm-bridge-context-section-body" });
    if (this.pinnedFileRefs.length === 0) {
      pinnedBody.createEl("span", { cls: "llm-bridge-context-empty", text: "Pin 附件后才会跨轮保留。" });
    } else {
      for (const ref of this.pinnedFileRefs) this.renderContextRefChip(pinnedBody, ref, { allowUnpin: true, allowRemove: true });
    }

    const current = container.createEl("details", { cls: "llm-bridge-context-section", attr: { open: "" } });
    current.createEl("summary", { text: `Current message attachments (${this.messageFileRefs.length})` });
    const currentBody = current.createDiv({ cls: "llm-bridge-context-section-body" });
    if (this.messageFileRefs.length === 0) {
      currentBody.createEl("span", { cls: "llm-bridge-context-empty", text: "拖拽、粘贴、@ 选择或输入路径后，附件只用于下一次发送。" });
    } else {
      for (const ref of this.messageFileRefs) this.renderContextRefChip(currentBody, ref, { allowPin: true, allowRemove: true });
    }

    const session = container.createEl("details", { cls: "llm-bridge-context-section" });
    session.createEl("summary", { text: `Session grants / refs (${this.sessionFileRefs.length})` });
    const sessionBody = session.createDiv({ cls: "llm-bridge-context-section-body" });
    if (this.sessionFileRefs.length === 0) {
      sessionBody.createEl("span", { cls: "llm-bridge-context-empty", text: "外部读取授权会话内有效，但不会自动变成 prompt 附件。" });
    } else {
      for (const ref of this.sessionFileRefs) this.renderContextRefChip(sessionBody, ref, { allowPin: true, allowRemove: true });
    }
  }

  private renderContextRefChip(container: HTMLElement, ref: FileRef, options: { allowPin?: boolean; allowUnpin?: boolean; allowRemove?: boolean }): void {
    const chip = container.createDiv({ cls: `llm-bridge-context-ref-chip is-${ref.kind} is-${ref.status}` });
    chip.addEventListener("click", () => void this.openFileRefPreview(ref));
    chip.createEl("span", { cls: "llm-bridge-context-ref-name", text: ref.displayName, attr: { title: ref.resolvedPath } });
    chip.createEl("span", { cls: "llm-bridge-context-ref-meta", text: `${ref.kind} · ${ref.scope} · ${ref.fileType}` });
    const snippet = this.attachmentTextSnippets.find((item) => item.refId === ref.id || ref.id.startsWith(item.refId));
    chip.createEl("span", { cls: "llm-bridge-context-ref-mode", text: snippet ? "bounded text" : "native ref" });
    if (options.allowPin) {
      chip.createEl("button", { cls: "llm-bridge-context-ref-action", text: "Pin" }).addEventListener("click", (event) => {
        event.stopPropagation();
        this.pinFileRef(ref.id);
      });
    }
    if (options.allowUnpin) {
      chip.createEl("button", { cls: "llm-bridge-context-ref-action", text: "Unpin" }).addEventListener("click", (event) => {
        event.stopPropagation();
        this.unpinFileRef(ref.id);
      });
    }
    if (options.allowRemove) {
      chip.createEl("button", { cls: "llm-bridge-context-ref-remove", text: "×", attr: { title: "移除" } }).addEventListener("click", (event) => {
        event.stopPropagation();
        this.removeContextFileRef(ref.id);
      });
    }
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
    header.createEl("span", { cls: "llm-bridge-external-read-title", text: "External Read Requests" });
    header.createEl("span", { cls: "llm-bridge-external-read-count", text: `${pending.length} pending` });

    for (const req of pending) {
      const card = panel.createDiv({ cls: `llm-bridge-external-read-card is-risk-${req.risk} is-safety-${req.grantRootSafety}` });
      const title = card.createDiv({ cls: "llm-bridge-external-read-card-title" });
      title.createEl("span", { text: "Agent requested external read" });
      title.createEl("span", { cls: "llm-bridge-external-read-source", text: req.source });

      const fields = card.createDiv({ cls: "llm-bridge-external-read-fields" });
      this.renderExternalReadField(fields, "requestedPath", req.requestedPath);
      this.renderExternalReadField(fields, "proposedGrantRoot", req.proposedGrantRoot || "(none)");
      this.renderExternalReadField(fields, "risk", req.risk);
      this.renderExternalReadField(fields, "reason", req.reason);
      this.renderExternalReadField(fields, "source", req.source);

      if (req.grantRootSafety === "deny") {
        card.createDiv({ cls: "llm-bridge-external-read-warning", text: "Grant root is too broad or unsafe. Directory approval is disabled." });
      } else if (req.grantRootSafety === "confirm") {
        card.createDiv({ cls: "llm-bridge-external-read-warning", text: "Strong confirmation required: this grant root is broad. Review the path before approving." });
      }

      const btns = card.createDiv({ cls: "llm-bridge-external-read-actions" });
      if (req.grantRootSafety !== "deny") {
        const allowDirText = req.grantRootSafety === "confirm" ? "强确认：允许本次会话读取此目录" : "允许本次会话读取此目录";
        const allowDirBtn = btns.createEl("button", { cls: "llm-bridge-external-read-allow-dir", text: allowDirText });
        allowDirBtn.addEventListener("click", () => this.approveExternalReadRequest(req.id, false, req.grantRootSafety === "confirm"));
        const allowFileText = req.grantRootSafety === "confirm" ? "强确认：仅允许此文件" : "仅允许此文件";
        const allowFileBtn = btns.createEl("button", { cls: "llm-bridge-external-read-allow-file", text: allowFileText });
        allowFileBtn.addEventListener("click", () => this.approveExternalReadRequest(req.id, true, req.grantRootSafety === "confirm"));
      }
      const denyBtn = btns.createEl("button", { cls: "llm-bridge-external-read-deny", text: "拒绝" });
      denyBtn.addEventListener("click", () => this.denyExternalReadRequest(req.id));
    }
  }

  private renderExternalReadField(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "llm-bridge-external-read-field" });
    row.createEl("span", { cls: "llm-bridge-external-read-field-label", text: label });
    row.createEl("span", { cls: "llm-bridge-external-read-field-value", text: value, attr: { title: value } });
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

  // ---------- Obsidian 状态 ----------

  private getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
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
      head.createEl("span", { cls: "llm-bridge-msg-role", text: msg.role === "user" ? "You" : this.actualRuntimeLabel });
      if (msg.role === "assistant") {
        head.createEl("span", {
          cls: `llm-bridge-msg-status is-${msg.status}`,
          text: STATUS_LABEL[msg.status],
        });
      }
      head.createEl("span", { cls: "llm-bridge-msg-time", text: new Date(msg.timestamp).toLocaleTimeString() });

      const content = block.createEl("div", { cls: "llm-bridge-msg-content" });
      this.renderMessageContent(content, msg);
      if (msg.role === "user" && msg.fileRefs && msg.fileRefs.length > 0) {
        this.renderMessageFileRefs(block, msg.fileRefs);
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
    const text = msg.content || (msg.role === "assistant" && msg.status === "running" ? "" : "");
    content.empty();
    if (!text) {
      if (msg.role === "assistant" && msg.status === "running") {
        content.createEl("span", { cls: "llm-bridge-msg-pending-text", text: "正在等待首次输出..." });
      }
      return;
    }
    if (msg.role !== "assistant") {
      content.textContent = text;
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
      void MarkdownRenderer.render(this.app, text, content, "", this).catch(fallback);
    } catch {
      fallback();
    }
  }

  private renderStreamingMessageContent(content: HTMLElement, text: string): void {
    content.removeClass("llm-bridge-msg-markdown");
    content.empty();
    content.createEl("span", { cls: "llm-bridge-msg-stream-text", text });
  }

  private renderMessageFileRefs(block: HTMLElement, refs: ReadonlyArray<FileRef>): void {
    const wrap = block.createDiv({ cls: "llm-bridge-msg-attachments" });
    for (const ref of refs) {
      const chip = wrap.createEl("button", {
        cls: `llm-bridge-msg-attachment-chip is-${ref.kind} is-${ref.fileType}`,
        attr: { title: `${ref.displayName}\n${ref.resolvedPath}` },
      });
      const thumbnailUrl = ref.fileType === "image" ? this.getFileRefThumbnailUrl(ref) : null;
      if (thumbnailUrl) {
        chip.createEl("img", { cls: "llm-bridge-msg-attachment-image", attr: { src: thumbnailUrl, alt: ref.displayName } });
      } else {
        chip.createEl("span", { cls: "llm-bridge-msg-attachment-ext", text: this.getFileRefShortLabel(ref) });
      }
      chip.createEl("span", { cls: "llm-bridge-msg-attachment-name", text: ref.displayName });
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
      block.createEl("div", {
        cls: "llm-bridge-msg-content",
        text: `[消息渲染失败] ${msg.role} · ${msg.timestamp}`,
      });
      if (error instanceof Error && error.message) {
        block.createEl("pre", { cls: "llm-bridge-error-detail", text: error.message });
      }
      this.scrollToBottom(true);
    } catch {
      // 连错误块都渲染失败，静默忽略（避免无限抛出）
    }
  }

  // stderr / log / 生成文件，默认折叠；失败或有新文件时显著
  private appendMsgDetails(block: HTMLElement, msg: ChatMessage, beforeEl?: Element | null): void {
    const failed = msg.status === "failed";
    const developerMode = !!this.plugin.settings.developerMode;
    const terminalSuccess = msg.status === "completed" || msg.status === "stopped";

    if (msg.role === "assistant" && terminalSuccess && !developerMode) {
      block.querySelector<HTMLElement>(".llm-bridge-timeline-live")?.remove();
      if (msg.sdkEvents && msg.sdkEvents.length > 0) {
        const details = block.createDiv({ cls: "llm-bridge-msg-details llm-bridge-msg-process" });
        if (beforeEl) block.insertBefore(details, beforeEl);
        this.appendSdkWorkflow(details, msg.sdkEvents, { processOnly: true });
        this.updateLastSdkStats(msg.sdkEvents);
      } else if (msg.workflowTrace && msg.workflowTrace.length > 0) {
        const details = block.createDiv({ cls: "llm-bridge-msg-details llm-bridge-msg-process" });
        if (beforeEl) block.insertBefore(details, beforeEl);
        this.appendWorkflowProcess(details, msg.workflowTrace, msg.status);
      }
      return;
    }

    const details = block.createDiv({ cls: "llm-bridge-msg-details llm-bridge-msg-process" });
    if (beforeEl) block.insertBefore(details, beforeEl);
    if (msg.role === "assistant" && msg.status === "running" && (!msg.sdkEvents || msg.sdkEvents.length === 0)) {
      if (this.liveAggregator.toRawEvents().length === 0) {
        this.appendRunningProcessPlaceholder(details);
      } else if (!developerMode) {
        details.remove();
        return;
      }
    }

    // V1.5: 命令预览区（UI-only，展示本次实际执行的 command/args/cwd/上下文）
    if (developerMode && msg.role === "assistant" && msg.commandPreview && msg.commandPreview.length > 0) {
      this.appendCommandPreview(details, msg.commandPreview);
    }

    // V2.17-A: EffectiveRunPlan 面板（Developer mode 审计用；普通用户态不渲染）
    if (developerMode && msg.role === "assistant" && msg.effectiveRunPlan) {
      this.appendEffectiveRunPlan(details, msg.effectiveRunPlan);
    }

    // V1.5: Workflow Trace 区域（UI-only，比 V1.2 timeline 更细粒度）
    // 优先显示 workflowTrace；若不存在则回退到 V1.2 timeline
    if (developerMode && msg.role === "assistant" && msg.workflowTrace && msg.workflowTrace.length > 0) {
      this.appendWorkflowTrace(details, msg.workflowTrace);
    } else if (developerMode && msg.role === "assistant" && msg.timeline && msg.timeline.length > 0) {
      // V1.2: 运行过程时间线（向后兼容）
      this.appendTimeline(details, msg.timeline);
    }

    // V1.6: SDK 工作流事件（工具级：tool_start/tool_result/file_change/permission/error/message）
    // 仅 sdk backend 产生；CLI/mock backend 无此数据
    if (msg.role === "assistant" && msg.sdkEvents && msg.sdkEvents.length > 0) {
      this.appendSdkWorkflow(details, msg.sdkEvents);
      // V2.3: 更新状态栏工具步骤/agent 计数
      this.updateLastSdkStats(msg.sdkEvents);
    }

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
    if (msg.generatedFiles.length > 0) {
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
    const head = wrap.createDiv({ cls: "llm-bridge-timeline-head" });
    head.createEl("span", { cls: "llm-bridge-timeline-toggle", text: "▼ " });
    head.createEl("span", { cls: "llm-bridge-timeline-summary", text: "过程 · 正在启动" });
    const body = wrap.createDiv({ cls: "llm-bridge-timeline-body" });
    const timeline = body.createDiv({ cls: "llm-bridge-timeline llm-bridge-timeline-live" });
    const node = timeline.createDiv({ cls: "llm-bridge-tl-node llm-bridge-tl-agent is-active" });
    node.createDiv({ cls: "llm-bridge-tl-dot" });
    const content = node.createDiv({ cls: "llm-bridge-tl-content" });
    content.createEl("div", { cls: "llm-bridge-tl-agent-text", text: "正在连接 runtime，等待首个事件..." });
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
    const statusEl = block.querySelector(".llm-bridge-msg-status");
    if (statusEl) {
      statusEl.textContent = STATUS_LABEL[msg.status];
      statusEl.className = `llm-bridge-msg-status is-${msg.status}`;
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
    this.messages = [];
    this.currentAssistantId = null;
    this.currentSessionId = null; // 新会话不绑定旧 id，下次运行将生成新 id
    this.messagesFoldExpanded = false; // V2.7: 重置折叠状态
    this.sessionState = createNewSession();
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
    this.clearExternalReadRequests();
    this.clearFileContext();
    this.refreshStatusBar();
  }

  // V2.0: 刷新会话状态展示（标题 + 状态 + 消息数 + 上下文指标）
  private refreshSessionState(): void {
    if (this.sessionTitleEl) {
      this.sessionTitleEl.textContent = this.sessionState.title;
    }
    const shadowTitle = this.statusBarEl?.querySelector(".llm-bridge-sb-session-title-shadow");
    if (shadowTitle) {
      shadowTitle.textContent = this.sessionState.title;
    }
    const sessionSelector = this.sessionTitleEl?.closest(".llm-bridge-session-selector");
    if (sessionSelector) {
      sessionSelector.className = `llm-bridge-session-selector ${sessionStatusClass(this.sessionState.status)}`;
      // V2.16-D: title 属性显示完整 session title（hover 查看截断的完整内容）
      (sessionSelector as HTMLElement).setAttribute("title", this.sessionState.title || "当前会话");
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
      const activeFile = this.app.workspace.getActiveFile();
      const selection = this.getSelection();
      let activeNoteContent = "";
      if (settings.includeActiveNote && activeFile) {
        try {
          activeNoteContent = await this.app.vault.read(activeFile);
        } catch { /* 读取失败用空字符串 */ }
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
    } catch {
      this.contextLabelEl.textContent = "Context estimate";
    }
  }

  // V2.16-D: 渲染 context metrics 到 UI
  private renderContextMetrics(metrics: ContextMetrics): void {
    const total = metrics.total.tokens;
    const win = metrics.contextWindow;
    const pct = win > 0 ? Math.min(100, (total / win) * 100) : 0;
    const color = metrics.precision === "unavailable" ? "var(--text-faint)" : pct > 80 ? "#e53935" : pct > 50 ? "#f59e0b" : "var(--interactive-accent)";
    this.contextRingEl.classList.remove("is-exact", "is-estimated", "is-unavailable");
    this.contextRingEl.classList.add(`is-${metrics.precision}`);
    this.contextRingEl.style.cssText = `background: conic-gradient(${color} ${pct * 3.6}deg, var(--background-modifier-border) ${pct * 3.6}deg);`;
    // V2.17-A: exact usage 不可用时显示 "Context estimate"（不突出 unavailable，不冒充 exact）；
    // 仅 exact 精度才在主标签展示 token 数字。
    if (metrics.precision === "exact") {
      this.contextLabelEl.textContent = `Context ${formatTokens(total)} / ${formatTokens(win)}`;
    } else {
      this.contextLabelEl.textContent = "Context estimate";
    }
    this.contextLabelEl.setAttribute("title", `Exact runtime usage: ${metrics.precision === "exact" ? "available" : "unavailable"}\nLocal estimate: ${metrics.total.tokens} tokens (${metrics.total.chars} chars)\nWindow: ${formatTokens(win)}\nPrecision: ${metrics.precision}`);
    this.contextDetailEl.empty();
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
      row.createEl("span", { cls: "llm-bridge-context-detail-value", text: `${formatTokens(part.tokens)} tokens estimated` });
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

  // Agent Skills panel: runtime capabilities only; no composer insertion.
  private renderAgentSkillsPanel(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-agent-skills-panel" });
    const head = wrap.createDiv({ cls: "llm-bridge-skills-head" });
    this.agentSkillsToggleEl = head.createEl("span", {
      cls: "llm-bridge-skills-toggle",
      text: "▶ Agent Skills Registry",
      attr: { title: "Agent 可发现/可调用的 runtime capabilities；不会插入输入框" },
    });
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
    help.createEl("span", { text: "Agent Skills 是 runtime capabilities，会物化到 .claude/skills/<slug>/SKILL.md，由 Claude Code/SDK 发现；不会写入 composer，也不会拼进 promptPackage。" });
    this.agentSkillsListEl = body.createDiv({ cls: "llm-bridge-agent-skills-list-container" });

    this.agentSkillsToggleEl.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
      } else {
        body.setAttribute("hidden", "");
      }
      this.updateAgentSkillsToggle();
    });
  }

  // V2.5: 渲染历史会话面板（可折叠，默认折叠）
  private renderHistoryPanel(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-history-panel" });
    const head = wrap.createDiv({ cls: "llm-bridge-history-head" });
    this.historyToggleEl = head.createEl("span", {
      cls: "llm-bridge-history-toggle",
      text: "▶ History",
      attr: { title: "展开历史会话列表（从 .llm-bridge/sessions/ 读取）" },
    });
    const refreshHistBtn = head.createEl("button", {
      cls: "llm-bridge-history-refresh-btn",
      text: "↻",
      attr: { title: "刷新历史会话列表" },
    });
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
        body.removeAttribute("hidden");
        this.historyToggleEl.textContent = "▼ History";
        void this.refreshHistory();
      } else {
        body.setAttribute("hidden", "");
        this.historyToggleEl.textContent = "▶ History";
      }
    });
    // 初始空状态
    listContainer.createDiv({ cls: "llm-bridge-history-empty", text: "暂无历史会话" });
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
    dropdown.createEl("div", { cls: "llm-bridge-session-dropdown-title", text: "最近会话" });
    const recent = this.historyItems.slice(0, 6);
    if (recent.length === 0) {
      dropdown.createEl("div", { cls: "llm-bridge-session-dropdown-empty", text: "暂无历史会话" });
    } else {
      for (const item of recent) {
        const row = dropdown.createEl("button", {
          cls: `llm-bridge-session-dropdown-item${item.id === this.currentSessionId ? " is-current" : ""}`,
          attr: { title: `${item.title}\n${item.firstUserSummary || "无用户请求摘要"}\n${item.lastAssistantSummary || "无回复摘要"}\n${item.messageCount} 条消息 · ${item.savedAt}` },
        });
        row.createEl("span", { cls: "llm-bridge-session-dropdown-name", text: item.title });
        row.createEl("span", { cls: "llm-bridge-session-dropdown-request", text: item.firstUserSummary || "无用户请求摘要" });
        row.createEl("span", { cls: "llm-bridge-session-dropdown-reply", text: item.lastAssistantSummary || "无回复摘要" });
        row.createEl("span", { cls: "llm-bridge-session-dropdown-meta", text: `${this.formatHistoryTime(item.savedAt)} · ${item.messageCount} 条` });
        row.addEventListener("click", async () => {
          dropdown.setAttribute("hidden", "");
          await this.restoreSession(item.id);
        });
      }
    }
    const historyBtn = dropdown.createEl("button", {
      cls: "llm-bridge-session-dropdown-history",
      text: "查看全部历史",
    });
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
    const arrow = this.historyBodyEl.hasAttribute("hidden") ? "▶" : "▼";
    if (this.historyItems.length === 0) {
      this.historyListEl.createDiv({ cls: "llm-bridge-history-empty", text: "暂无历史会话" });
      this.historyToggleEl.textContent = `${arrow} History (0)`;
      return;
    }
    if (filtered.length === 0) {
      this.historyListEl.createDiv({ cls: "llm-bridge-history-empty", text: `无匹配「${this.historySearchQuery.trim()}」的会话` });
      this.historyToggleEl.textContent = `${arrow} History (0/${this.historyItems.length})`;
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
      const row = list.createDiv({
        cls: `llm-bridge-history-item is-${item.status}`,
        attr: { title: `${item.title} · ${item.messageCount} 条消息 · ${item.savedAt}` },
      });
      // 主信息（点击恢复）
      const main = row.createEl("button", { cls: "llm-bridge-history-main" });
      main.createEl("span", { cls: "llm-bridge-history-title", text: item.title });
      const meta = `${item.messageCount} 条 · ${item.agentType} · ${this.formatHistoryTime(item.savedAt)}`;
      main.createEl("span", { cls: "llm-bridge-history-meta", text: meta });
      main.addEventListener("click", () => void this.restoreSession(item.id));
      // V2.8: 编辑按钮（重命名标题）
      const editBtn = row.createEl("button", {
        cls: "llm-bridge-history-edit-btn",
        text: "✎",
        attr: { title: "重命名会话标题" },
      });
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.renameHistorySession(item.id, item.title);
      });
      // 删除按钮
      const delBtn = row.createEl("button", {
        cls: "llm-bridge-history-del-btn",
        text: "×",
        attr: { title: "删除此历史会话" },
      });
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.deleteHistorySession(item.id, item.title);
      });
    }
    // V2.9: 搜索时显示「匹配数/总数」，否则显示总数
    const countLabel = query ? `${filtered.length}/${this.historyItems.length}` : `${this.historyItems.length}`;
    this.historyToggleEl.textContent = `${arrow} History (${countLabel})`;
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
    this.refreshAllChips();
    this.renderMessagesFromHistory();
    this.refreshSessionState();
    this.clearRunFlow();
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    this.clearPendingPermissions();
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
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    try {
      const manifest = await loadAgentSkillsManifest(vaultPath);
      this.agentSkills = manifest.skills.slice();
    } catch {
      this.agentSkills = [];
    }
    this.renderAgentSkillsList();
  }

  private updateAgentSkillsToggle(): void {
    if (!this.agentSkillsToggleEl || !this.agentSkillsBodyEl) return;
    const enabled = this.agentSkills.filter((skill) => skill.enabled).length;
    const total = this.agentSkills.length;
    const hidden = this.agentSkillsBodyEl.hasAttribute("hidden");
    this.agentSkillsToggleEl.textContent = `${hidden ? "▶" : "▼"} Agent Skills Registry (${enabled}/${total})`;
  }

  private renderAgentSkillsList(): void {
    if (!this.agentSkillsListEl) return;
    try {
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
    const messageRefsForRun = this.messageFileRefs.map((ref) => ({ ...ref, scope: "message" as const }));
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

    // 使用 prompt package builder（V0.7）—— 仍用于命令预览/日志展示
    const prompt = buildPromptPackage(userInput, snapshot, settings);
    const sdkStreamingInput = await this.buildSdkStreamingInput(prompt, promptFileRefsForRun);

    // V2.17-A Completion: 通过 BridgeSession 选择 provider 并构造 EffectiveRunPlan。
    // UI 不再直接接触 SdkBackend/ClaudeCliBackend/MockAgentBackend；plan 由
    // provider.buildPlan 从 RunInput 派生（单一真相源）。
    const session = this.getSession();
    const imageBlockCount = sdkStreamingInput?.content.filter((b) => b.type === "image").length ?? 0;
    const attachmentPlan: AttachmentPlan = {
      messageScopedRefs: messageRefsForRun.length,
      pinnedRefs: this.pinnedFileRefs.length,
      inlineSnippets: promptAttachmentSnippetsForRun.length,
      imageStreamingBlocks: imageBlockCount,
      nativeRefOnly: Math.max(0, promptFileRefsForRun.length - promptAttachmentSnippetsForRun.length - imageBlockCount),
    };
    // 注：attachmentPlan 仅用于 UI 展示审计；provider 内部从 promptPackage.attachmentEntries
    // 重新聚合（保证 provider-neutral）。这里保留供 commandPreview / log 用。
    void attachmentPlan;

    // V2.17-A Completion: 构造 provider-neutral BridgePromptPackage
    const promptPackage = buildBridgePromptPackage(userInput, snapshot, settings);

    // V1.5: 构造命令预览（UI-only，展示本次实际执行的 command/args/cwd/上下文）
    const commandPreviewRows = previewToRows(buildCommandPreview(settings, vaultPath, {
      hasSelection: !!selection,
      selectionLength: selection?.length ?? 0,
      hasActiveNote: settings.includeActiveNote && !!activeFile,
      activeFileName: activeFile?.path ?? null,
      promptLength: prompt.length,
    }));

    // 渲染用户消息 + assistant 占位
    this.appendUserMessage(userInput, messageRefsForRun);
    const assistantId = this.appendAssistantPlaceholder();
    this.inputEl.value = "";
    this.closeMentionPicker();
    this.clearMessageContext();

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
    });

    // V2.14.0-K: runtime file tool adapter（provider 通过 RunContext 拿到）
    const runtimeFileToolAdapter = createRuntimeFileToolAdapter(
      session.providerId === "claude-sdk" ? "sdk" : "cli",
      (request) => this.executeAgentFileToolRoute(request),
    );
    runInput.runtimeFileToolAdapter = runtimeFileToolAdapter;

    // V2.17-A Completion: 通过 BridgeSession.start 启动 run，消费 NormalizedRuntimeEvent 流。
    // 旧 AgentBackend callback（onEvent/onWorkflowEvent）替换为单一流式消费：
    // - stdout_delta / stderr_delta / completed / failed 直接处理（原 onEvent 路径）
    // - 其余经 mapNormalizedToWorkflowEvent 还原为 WorkflowEvent，喂给现有 UI 管线
    //   （appendLiveSdkEvent / sdkEvents / pendingPermissions）
    let terminalStatus: RunStatus | null = null;
    let terminalResult: RunResult | null = null;
    const runIter = session.start(runInput, settings);

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
   * V2.17-A Completion: 处理单个 NormalizedRuntimeEvent（run() 闭包提取为方法便于维护）。
   *
   * - stdout_delta/stderr_delta/completed/failed：直接处理（原 AgentEvent onEvent 路径）
   * - 其余：经 mapNormalizedToWorkflowEvent 还原为 WorkflowEvent，喂给现有 UI 管线
   *   （appendLiveSdkEvent / sdkEvents / pendingPermissions）
   *
   * 注：UI 全量迁移到 AssistantTurnView 后，此方法可简化为直接消费 NormalizedRuntimeEvent。
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
      onTerminal: (status: RunStatus, result: RunResult) => void;
    },
  ): void {
    const p = ev.payload;
    // 1. 直接处理 stdout/stderr/completed/failed（无对应 WorkflowEvent）
    if (p.kind === "stdout_delta") {
      if (!ctx.sawStdoutRef()) {
        ctx.setSawStdout(true);
        const detail = p.data.replace(/\s+/g, " ").trim().slice(0, 60);
        const ts = new Date().toISOString();
        ctx.timelineEvents.push({ type: "stdout", detail, timestamp: ts });
        ctx.workflowEvents.push({ stage: "stdout", detail, timestamp: ts });
      }
      const msg = this.messages.find((m) => m.id === ctx.assistantId);
      if (msg) {
        this.appendAssistantContentDelta(ctx.assistantId, p.data);
      }
      return;
    }
    if (p.kind === "stderr_delta") {
      if (!ctx.sawStderrRef()) {
        ctx.setSawStderr(true);
        const detail = p.data.replace(/\s+/g, " ").trim().slice(0, 60);
        const ts = new Date().toISOString();
        ctx.timelineEvents.push({ type: "stderr", detail, timestamp: ts });
        ctx.workflowEvents.push({ stage: "stderr", detail, timestamp: ts });
      }
      if (!this.plugin.settings.showStderr) return;
      const msg = this.messages.find((m) => m.id === ctx.assistantId);
      if (msg) {
        this.updateAssistantMessage(ctx.assistantId, { stderr: msg.stderr + p.data });
      }
      return;
    }
    if (p.kind === "completed") {
      const result: RunResult = {
        exitCode: 0,
        signal: null,
        durationMs: p.durationMs ?? 0,
        stdout: p.text,
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

    // 2. 其余事件：还原为 WorkflowEvent，喂给现有 UI 管线
    const wfEvent = mapNormalizedToWorkflowEvent(ev);
    if (!wfEvent) return;
    ctx.sdkEvents.push(wfEvent);
    this.appendLiveSdkEvent(wfEvent);

    // 权限请求实时处理（pending=true 加入面板；pending=false 移除）
    if (wfEvent.type === "permission") {
      const permEv = wfEvent as PermissionEvent;
      if (permEv.pending && permEv.requestId) {
        this.pendingPermissions.set(permEv.requestId, permEv);
        this.refreshPermissionPanel();
      } else if (permEv.requestId && !permEv.pending) {
        if (this.pendingPermissions.has(permEv.requestId)) {
          this.pendingPermissions.delete(permEv.requestId);
          this.refreshPermissionPanel();
        }
      }
    }
  }

  private stop(): void {
    if (this.runHandle) {
      this.runHandle.stop();
      // V2.3s: 清空待决策权限请求
      this.clearPendingPermissions();
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
          pathKind: r.pathKind, fileType: r.fileType, source: r.source,
          grantScope: r.grantScope, scope: r.scope, createdAt: r.createdAt, status: r.status,
        })),
        sessionMode: s.sessionMode,
        model: s.model,
        effortLevel: s.effortLevel,
        backendMode: s.backendMode,
        permissionMode: s.claudePermissionMode,
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
