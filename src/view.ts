// LLM CLI Bridge — 右侧 Chat View（Codex / Claude Code 风格紧凑工作台）

import { App, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type LLMBridgePlugin from "../main";
import { buildPrompt } from "./prompt";
import { buildPromptPackage, StateSnapshot } from "./promptPackage";
import { ClaudeCliBackend } from "./claudeCliBackend";
import { MockAgentBackend } from "./mockAgentBackend";
import { AgentBackend, AgentRunHandle, AgentTask } from "./agentBackend";
import { exportState } from "./state";
import { diffSnapshots, extractRelPath, FileSnapshot, snapshotVaultMarkdownFiles } from "./fileDiff";
import { AgentType, BackendMode, ChatMessage, RunResult, RunStatus, SessionMode } from "./types";
import type { PendingActionEntry } from "./httpServer";
import { runPreflight, PreflightResult } from "./agentProfile";
import { mapPreflightToStatus, buildErrorSummary } from "./preflightStatus";
import { buildFirstUseGuide, shouldShowFirstUseGuide } from "./firstUseGuide";
import { buildTimeline, isTerminalTimelineType, timelineTypeClass, timelineTypeLabel, TimelineEventType } from "./runTimeline";
import { buildCommandLine, buildCommandPreview, buildRedactedCommandDisplay, previewToRows, CommandPreview } from "./commandProfile";
import { buildWorkflowTrace, workflowStageLabel, workflowStageClass, isTerminalWorkflowStage, WorkflowTraceStage, WorkflowTraceEvent } from "./workflowTrace";
import { SdkBackend } from "./sdkBackend";
import { WorkflowEvent, PermissionEvent, buildToolTimeline, workflowEventLabel, workflowEventIcon, workflowEventClass, truncateText, extractFileChanges } from "./workflowEvent";
import { SessionState, createNewSession, generateSessionTitle, sessionStatusLabel, sessionStatusClass, updateSession } from "./session";
import { PersistedSession, SessionListItem, saveSession, listSessions, loadSession, deleteSession, renameSession } from "./sessions";
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
  addFileRefToWorkingSet,
  createAttachmentFileRef,
  createExternalFileRefFromApprovedRequest,
  createVaultFileRef,
  createWorkingSet,
  classifyFileTypeByPath,
  buildPromptFileRefIndex,
  FileRef,
  WorkingSet,
} from "./fileRefs";
import { AttachmentTextSnippet, ingestAttachmentTextSnippet } from "./fileIngestion";
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

// 模型选项（对应中转支持的模型）
const MODEL_OPTIONS = [
  { value: "gpt-5.5", label: "gpt-5.5" },
  { value: "gpt-5.4", label: "gpt-5.4" },
  { value: "glm-5.2", label: "glm-5.2" },
  { value: "deepseek-v4", label: "deepseek-v4" },
];

// 思考强度
const EFFORT_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "max", label: "超高" },
];

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
  // backend 实例缓存：按 settings.backendMode 选择 real / mock
  private cachedBackend: AgentBackend | null = null;
  private cachedBackendMode: BackendMode | null = null;
  private runHandle: AgentRunHandle | null = null;
  private messages: ChatMessage[] = [];
  private currentAssistantId: string | null = null;
  private beforeFiles: Map<string, FileSnapshot> = new Map();
  private pendingActions: PendingActionEntry[] = [];

  // V1.1: preflight 结果缓存
  private lastPreflightResult: PreflightResult | null = null;
  // V1.2: 首次使用提示 DOM
  private guideEl: HTMLElement | null = null;

  // V2.0: 会话状态（UI-only，不持久化）
  private sessionState: SessionState = createNewSession();
  // V2.0: 运行流程区（最新一次运行的 workflow trace）
  private runFlowEl!: HTMLElement;
  private runFlowBody!: HTMLElement;
  private runFlowToggle!: HTMLElement;
  // V2.0: 会话标题展示
  private sessionTitleEl!: HTMLElement;
  // V2.13.0-F: Agent Skills 是 runtime capability，不插入 composer。
  private agentSkills: AgentSkillRecord[] = [];
  private agentSkillsToggleEl!: HTMLElement;
  private agentSkillsBodyEl!: HTMLElement;
  private agentSkillsListEl!: HTMLElement;
  // V2.9: scrollToBottom rAF 批处理定时器（合并同帧多次调用，避免每个 delta 触发 reflow）
  private scrollRafId: number | null = null;
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
  private permissionModeChipEl!: HTMLButtonElement;
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
  // V2.14.0-F: Working Set 只保存文件引用和授权状态，不保存文件正文
  private fileWorkingSet: WorkingSet = createWorkingSet();
  private attachmentReadGrants: FileAccessReadGrant[] = [];
  private attachmentTextSnippets: AttachmentTextSnippet[] = [];
  private attachmentFileInputEl!: HTMLInputElement;
  private workingSetEl!: HTMLElement;
  private filesWorkingSetEl!: HTMLElement;
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
      text: "Claude Code · 待命",
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
        this.refreshWorkingSetChips();
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

    // ===== Files page: Working Set / attachments / FileRef index / approvals =====
    const filesHead = filesPanel.createDiv({ cls: "llm-bridge-secondary-head" });
    filesHead.createEl("span", { cls: "llm-bridge-secondary-kicker", text: "Files" });
    filesHead.createEl("strong", { text: "Working Set、附件与 FileRef index" });
    filesHead.createEl("small", { text: "这里只管理文件引用和授权状态；文件执行交给 Claude Code / SDK native handoff。" });
    this.filesWorkingSetEl = filesPanel.createDiv({ cls: "llm-bridge-working-set llm-bridge-working-set-page" });

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

    // ===== V2.0: 运行流程区（Run Flow，展示最新一次运行的 6 步流程） =====
    this.renderRunFlowPanel(chatPanel);

    // ===== 消息流（对话区） =====
    this.messagesEl = chatPanel.createDiv({ cls: "llm-bridge-messages" });
    this.renderEmptyState();

    // V2.3s: 权限请求面板（运行中实时展示 pending 权限请求，用户点击允许/拒绝）
    this.permissionPanelEl = chatPanel.createDiv({ cls: "llm-bridge-perm-panel" });
    this.permissionPanelEl.style.display = "none";
    // V2.14.0-E: 外部读取授权请求面板（只管理授权，不读取文件内容）
    this.externalReadPanelEl = filesPanel.createDiv({ cls: "llm-bridge-external-read-panel" });
    this.externalReadPanelEl.style.display = "none";

    // Working Set strip 位于 composer 上方，空态保持紧凑。
    const workingSetStrip = chatPanel.createDiv({ cls: "llm-bridge-working-set-strip" });
    workingSetStrip.createEl("span", { cls: "llm-bridge-working-set-label", text: "工作集" });
    const contextChipsRow = workingSetStrip.createDiv({ cls: "llm-bridge-working-set-context" });
    this.workingSetEl = workingSetStrip.createDiv({ cls: "llm-bridge-working-set llm-bridge-working-set-refs" });

    // ===== 底部 composer =====
    const composer = chatPanel.createDiv({ cls: "llm-bridge-composer" });

    const composerBar = composer.createDiv({ cls: "llm-bridge-composer-bar" });
    composerBar.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, select, summary, details, input, textarea")) return;
      this.inputEl.focus();
    });
    const leftTools = composerBar.createDiv({ cls: "llm-bridge-composer-tools llm-bridge-composer-tools-left" });
    const attachmentMenu = leftTools.createEl("details", { cls: "llm-bridge-attachment-menu" });
    const attachmentSummary = attachmentMenu.createEl("summary", {
      cls: "llm-bridge-composer-tool-btn llm-bridge-attach-file-btn",
      attr: { title: "添加附件（输入 @ 选 Vault 文件，或原生选择器）" },
    });
    setIcon(attachmentSummary, "plus");
    const attachmentMenuBody = attachmentMenu.createDiv({ cls: "llm-bridge-attachment-menu-body" });
    // V2.15-H: @ 形式 Vault 文件选择（输入框上方 inline popup）
    const vaultAttachBtn = attachmentMenuBody.createEl("button", { cls: "llm-bridge-attachment-menu-item", text: "Vault 文件（@）" });
    vaultAttachBtn.addEventListener("click", () => {
      attachmentMenu.removeAttribute("open");
      this.triggerMentionAtCursor();
    });
    const nativeAttachBtn = attachmentMenuBody.createEl("button", { cls: "llm-bridge-attachment-menu-item", text: "原生文件选择器" });
    nativeAttachBtn.addEventListener("click", () => {
      attachmentMenu.removeAttribute("open");
      this.openNativeAttachmentPicker();
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
    this.permissionModeChipEl.addEventListener("click", () => void this.cyclePermissionMode());

    const inputRow = composerBar.createDiv({ cls: "llm-bridge-input-row" });
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

    // Note / Selection 上下文 chips：作为 Working Set strip 的 compact refs。
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
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      composer.addClass("is-dragging-file");
    });
    composer.addEventListener("dragleave", () => composer.removeClass("is-dragging-file"));
    composer.addEventListener("drop", (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      composer.removeClass("is-dragging-file");
      void this.addFilesFromFileList(event.dataTransfer.files);
    });
    this.refreshWorkingSetChips();

    // 初始化
    this.syncControlsFromSettings();
    this.updateContextDisplay();
    this.setGlobalStatus("idle");
    this.refreshStatusBar();
    this.refreshSessionState();
    void this.refreshAgentSkills();
    void this.refreshHistory();

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.updateContextDisplay();
      this.refreshStatusBar();
    }));
    // V2.10 (B-001): 订阅 file-open 事件，确保同一 pane 内切换文件时 chip 立即更新
    // active-leaf-change 在某些场景（如快速切换同 pane 文件）可能延迟或不触发，file-open 更可靠
    this.registerEvent(this.app.workspace.on("file-open", () => {
      this.updateContextDisplay();
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
    });
    chip.addEventListener("click", async (e) => {
      e.preventDefault();
      if (this.runHandle) return;
      check.checked = !check.checked;
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
    // V2.4: Mode chip 已移除（仅 Fresh 可用，无需 refresh）

    // 上下文 chip 勾选态
    const noteChip = this.includeNoteCheckEl.parentElement?.querySelector(".llm-bridge-chip-toggle");
    if (noteChip) noteChip.classList.toggle("is-active", this.plugin.settings.includeActiveNote);
    const selChip = this.includeSelectionCheckEl.parentElement?.querySelector(".llm-bridge-chip-toggle");
    if (selChip) selChip.classList.toggle("is-active", this.plugin.settings.includeSelection);
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

    this.modelEffortPopoverEl = this.modelEffortPickerEl.createDiv({
      cls: "llm-bridge-model-effort-popover",
      attr: { hidden: "" },
    });
    const modelColumn = this.modelEffortPopoverEl.createDiv({ cls: "llm-bridge-model-effort-column llm-bridge-model-list" });
    modelColumn.createEl("span", { cls: "llm-bridge-model-effort-label", text: "模型" });
    for (const model of MODEL_OPTIONS) {
      const option = modelColumn.createEl("button", {
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
    const effortColumn = this.modelEffortPopoverEl.createDiv({ cls: "llm-bridge-model-effort-column llm-bridge-effort-list" });
    effortColumn.createEl("span", { cls: "llm-bridge-model-effort-label", text: "推理等级" });
    for (const effort of EFFORT_OPTIONS) {
      const option = effortColumn.createEl("button", {
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
    });
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape") this.closeModelEffortPopover();
    });
  }

  private async setModelEffort(model: string, effort: string): Promise<void> {
    if (this.runHandle) return;
    const nextModel = MODEL_OPTIONS.some((option) => option.value === model) ? model : MODEL_OPTIONS[0].value;
    const nextEffort = EFFORT_OPTIONS.some((option) => option.value === effort) ? effort : EFFORT_OPTIONS[0].value;
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
    const model = MODEL_OPTIONS.find((option) => option.value === this.plugin.settings.model) ?? MODEL_OPTIONS[0];
    const effort = EFFORT_OPTIONS.find((option) => option.value === this.plugin.settings.effortLevel) ?? EFFORT_OPTIONS[0];
    this.modelEffortButtonEl.textContent = `${model.label} · ${effort.label}`;
    this.modelEffortPopoverEl?.querySelectorAll<HTMLElement>(".llm-bridge-model-option").forEach((option) => {
      option.classList.toggle("is-active", option.getAttribute("data-model") === model.value);
    });
    this.modelEffortPopoverEl?.querySelectorAll<HTMLElement>(".llm-bridge-effort-option").forEach((option) => {
      option.classList.toggle("is-active", option.getAttribute("data-effort") === effort.value);
    });
  }

  private permissionModeShortLabel(): string {
    const mode = this.plugin.settings.claudePermissionMode ?? "default";
    if (mode === "plan") return "受限";
    if (mode === "default") return "默认";
    if (mode === "acceptEdits") return "acceptEdits";
    return mode;
  }

  private refreshPermissionModeChip(): void {
    if (!this.permissionModeChipEl) return;
    const mode = this.plugin.settings.claudePermissionMode ?? "default";
    const info = getPermissionModeInfo(mode);
    this.permissionModeChipEl.textContent = `权限：${this.permissionModeShortLabel()}`;
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
    if (this.historySearchDebounceTimer !== null) {
      window.clearTimeout(this.historySearchDebounceTimer);
      this.historySearchDebounceTimer = null;
    }
    this.clearExternalReadRequests();
    this.clearFileWorkingSet();
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
    this.activeFileLabelEl.textContent = f ? f.path : "";
    const sel = this.getSelection();
    if (sel) {
      this.selectionLabelEl.textContent = `${sel.length} chars`;
    } else {
      this.selectionLabelEl.textContent = "";
    }
  }

  // 按 settings.backendMode 获取 backend 实例（带缓存）
  // - auto: 真实 ClaudeCliBackend（默认生产行为）
  // - mock-success / mock-failure: MockAgentBackend（开发/测试用）
  // - sdk-experimental: V1.6 SdkBackend（尝试真实 SDK，不可用时 fallback mock workflow）
  private getBackend(): AgentBackend {
    const mode = this.plugin.settings.backendMode;
    if (this.cachedBackend && this.cachedBackendMode === mode) {
      return this.cachedBackend;
    }
    let backend: AgentBackend;
    if (mode === "mock-success") {
      backend = new MockAgentBackend("success");
    } else if (mode === "mock-failure") {
      backend = new MockAgentBackend("failure");
    } else if (mode === "sdk-experimental") {
      backend = new SdkBackend();
    } else {
      backend = new ClaudeCliBackend();
    }
    this.cachedBackend = backend;
    this.cachedBackendMode = mode;
    return backend;
  }

  private setGlobalStatus(status: RunStatus): void {
    const agentLabel = AGENT_OPTIONS.find((a) => a.value === this.plugin.settings.agentType)?.label ?? this.plugin.settings.agentType;
    const runtimeLabel = this.plugin.settings.backendMode === "sdk-experimental" ? "SDK" : agentLabel;
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
  private refreshStatusBar(): void {
    const s = this.plugin.settings;
    // Backend 模式
    const backendLabel = s.backendMode === "auto" ? "auto" : s.backendMode;
    this.statusBackendEl.querySelector(".llm-bridge-sb-value")!.textContent = backendLabel;
    // Agent 类型
    const agentLabel = AGENT_OPTIONS.find((a) => a.value === s.agentType)?.label ?? s.agentType;
    this.statusAgentEl.querySelector(".llm-bridge-sb-value")!.textContent = agentLabel;
    const runtimeLabel = s.backendMode === "sdk-experimental" ? "SDK" : agentLabel;
    const runtimeState = this.sessionState.status === "failed" ? "失败" : this.sessionState.status === "running" ? "运行中" : "已连接";
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

  // V2.3s: 解析权限请求（调用 SdkBackend.resolvePermission）
  private resolvePermissionRequests(requestIds: string[], choice: PermissionChoice): void {
    const backend = this.getBackend();
    if (!(backend instanceof SdkBackend)) {
      new Notice("权限请求仅在 sdk-experimental 模式下可用");
      return;
    }
    let resolved = 0;
    for (const id of requestIds) {
      if (backend.resolvePermission(id, choice)) {
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
    // 尝试拒绝所有待决策请求（避免 Promise 挂起）
    const backend = this.getBackend();
    if (backend instanceof SdkBackend) {
      for (const [, ev] of this.pendingPermissions) {
        if (ev.requestId) backend.resolvePermission(ev.requestId, "deny_session");
      }
    }
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

  public addVaultFileRef(requestedPath: string, options: { pathKind?: FileAccessPathKind; source?: string } = {}): FileRef | null {
    const ref = createVaultFileRef(this.createCurrentFileAccessPolicy(), requestedPath, {
      pathKind: options.pathKind || "file",
      source: options.source || "user",
    });
    this.fileWorkingSet = addFileRefToWorkingSet(this.fileWorkingSet, ref);
    this.refreshWorkingSetChips();
    return ref;
  }

  public addAttachmentFileRef(requestedPath: string, options: { pathKind?: FileAccessPathKind; source?: string } = {}): FileRef | null {
    const result = createAttachmentFileRef(this.getVaultPath(), requestedPath, {
      pathKind: options.pathKind || "file",
      source: options.source || "attachment",
    });
    if (!result) return null;
    this.attachmentReadGrants = this.attachmentReadGrants
      .filter((grant) => grant.path !== result.readGrant.path || grant.scope !== result.readGrant.scope);
    this.attachmentReadGrants.push(result.readGrant);
    this.fileWorkingSet = addFileRefToWorkingSet(this.fileWorkingSet, result.ref);
    this.refreshWorkingSetChips();
    return result.ref;
  }

  public async addAttachmentFileRefWithIngestion(requestedPath: string): Promise<FileRef | null> {
    const ref = this.addAttachmentFileRef(requestedPath, { source: "attachment" });
    if (!ref) return null;
    const result = await ingestAttachmentTextSnippet(ref);
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((snippet) => snippet.refId !== ref.id);
    if (result.snippet) {
      this.attachmentTextSnippets.push(result.snippet);
    }
    this.refreshWorkingSetChips();
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
    return this.fileWorkingSet.refs.slice();
  }

  public async executeFileToolRequest(request: FileToolExecutionRequest): Promise<FileToolResult> {
    const result = await executeFileTool(this.createCurrentFileAccessPolicy(), {
      ...request,
      fileRefs: request.fileRefs || this.fileWorkingSet.refs,
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
    const ref = await this.addAttachmentFileRefWithIngestion(requestedPath);
    if (!ref) {
      new Notice("附件路径无效，未加入 Working Set");
      return;
    }
    const snippet = this.attachmentTextSnippets.find((item) => item.refId === ref.id);
    const type = classifyFileTypeByPath(ref.resolvedPath);
    new Notice(snippet ? `已添加附件并读取 bounded snippet：${ref.displayName}` : `已添加附件引用：${ref.displayName} (${type})`);
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

  private async addFilesFromFileList(files: FileList): Promise<void> {
    const paths = Array.from(files)
      .map((file) => this.extractNativeFilePath(file))
      .filter((filePath): filePath is string => !!filePath);
    if (paths.length === 0) {
      new Notice("原生文件选择器未返回 path；请在输入框使用 @ 选择 Vault 文件。");
      return;
    }
    const refs = await this.addAttachmentFilesWithIngestion(paths);
    new Notice(`已添加 ${refs.length}/${paths.length} 个附件到 Working Set`);
  }

  private extractNativeFilePath(file: File): string | null {
    const electronFile = file as File & { path?: string };
    return typeof electronFile.path === "string" && electronFile.path.trim().length > 0
      ? electronFile.path
      : null;
  }

  private refreshWorkingSetChips(): void {
    if (this.workingSetEl) this.renderWorkingSetChipsInto(this.workingSetEl, "strip");
    if (this.filesWorkingSetEl) this.renderWorkingSetChipsInto(this.filesWorkingSetEl, "page");
  }

  private renderWorkingSetChipsInto(container: HTMLElement, mode: "strip" | "page"): void {
    const refs = this.fileWorkingSet.refs;
    container.empty();
    if (refs.length === 0) {
      container.style.display = "flex";
      if (mode === "page") {
        container.createEl("span", { cls: "llm-bridge-working-set-label", text: "Working Set" });
      }
      container.createEl("span", {
        cls: "llm-bridge-working-set-empty",
        text: mode === "strip" ? "添加附件后会显示为 refs；小文本可 bounded 进入上下文。" : "No files attached. Native handoff refs only; small text/md/json attachments can include bounded text.",
      });
      return;
    }
    container.style.display = "flex";
    if (mode === "page") {
      container.createEl("span", { cls: "llm-bridge-working-set-label", text: "Working Set" });
    }
    for (const ref of refs) {
      const chip = container.createDiv({ cls: `llm-bridge-working-set-chip is-${ref.kind} is-${ref.status}` });
      chip.createEl("span", { cls: "llm-bridge-working-set-name", text: ref.displayName, attr: { title: ref.resolvedPath } });
      chip.createEl("span", { cls: "llm-bridge-working-set-meta", text: `${ref.kind} · ${ref.status} · ${ref.source} · ${ref.pathKind} · ${ref.fileType}` });
      const snippet = this.attachmentTextSnippets.find((item) => item.refId === ref.id);
      chip.createEl("span", {
        cls: "llm-bridge-working-set-ingested",
        text: snippet ? "bounded text" : "native ref",
        attr: { title: snippet ? "Bounded text is included in prompt." : "refs-only native reference; use Claude Code / SDK native read when needed." },
      });
      const remove = chip.createEl("button", { cls: "llm-bridge-working-set-remove", text: "×", attr: { title: "移除" } });
      remove.addEventListener("click", () => this.removeWorkingSetRef(ref.id));
    }
  }

  private removeWorkingSetRef(refId: string): void {
    const ref = this.fileWorkingSet.refs.find((item) => item.id === refId) || null;
    this.fileWorkingSet = { refs: this.fileWorkingSet.refs.filter((item) => item.id !== refId) };
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((snippet) => snippet.refId !== refId);
    if (ref?.kind === "attachment") {
      this.attachmentReadGrants = this.attachmentReadGrants.filter((grant) => grant.path !== ref.resolvedPath || grant.scope !== "attachment");
    }
    this.refreshWorkingSetChips();
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
      this.fileWorkingSet = addFileRefToWorkingSet(this.fileWorkingSet, ref);
      this.refreshWorkingSetChips();
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

  private clearFileWorkingSet(): void {
    this.fileWorkingSet = createWorkingSet();
    this.attachmentReadGrants = [];
    this.attachmentTextSnippets = [];
    this.refreshWorkingSetChips();
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

  private appendUserMessage(text: string): string {
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
    this.renderMessage(msg);
    return id;
  }

  private renderMessage(msg: ChatMessage): void {
    try {
      const empty = this.messagesEl.querySelector(".llm-bridge-empty");
      if (empty) empty.remove();

      const block = this.messagesEl.createDiv({
        cls: `llm-bridge-msg llm-bridge-msg-${msg.role}`,
        attr: { "data-msg-id": msg.id },
      });

      // 消息头：角色 + 状态（失败时高亮）+ 时间
      const head = block.createDiv({ cls: "llm-bridge-msg-head" });
      head.createEl("span", { cls: "llm-bridge-msg-role", text: msg.role === "user" ? "You" : "Claude Code" });
      if (msg.role === "assistant") {
        head.createEl("span", {
          cls: `llm-bridge-msg-status is-${msg.status}`,
          text: STATUS_LABEL[msg.status],
        });
      }
      head.createEl("span", { cls: "llm-bridge-msg-time", text: new Date(msg.timestamp).toLocaleTimeString() });

      // 内容
      const content = block.createEl("div", { cls: "llm-bridge-msg-content" });
      content.textContent = msg.content || (msg.role === "assistant" && msg.status === "running" ? "…" : "");

      if (msg.role === "assistant") {
        this.appendMsgDetails(block, msg);
      }
      this.scrollToBottom();
    } catch (e) {
      // V2.7: 单条消息渲染失败不影响其他消息
      this.renderMessageError(msg, e);
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
      this.scrollToBottom();
    } catch {
      // 连错误块都渲染失败，静默忽略（避免无限抛出）
    }
  }

  // stderr / log / 生成文件，默认折叠；失败或有新文件时显著
  private appendMsgDetails(block: HTMLElement, msg: ChatMessage): void {
    const details = block.createDiv({ cls: "llm-bridge-msg-details" });
    const failed = msg.status === "failed";

    // V1.5: 命令预览区（UI-only，展示本次实际执行的 command/args/cwd/上下文）
    if (msg.role === "assistant" && msg.commandPreview && msg.commandPreview.length > 0) {
      this.appendCommandPreview(details, msg.commandPreview);
    }

    // V1.5: Workflow Trace 区域（UI-only，比 V1.2 timeline 更细粒度）
    // 优先显示 workflowTrace；若不存在则回退到 V1.2 timeline
    if (msg.role === "assistant" && msg.workflowTrace && msg.workflowTrace.length > 0) {
      this.appendWorkflowTrace(details, msg.workflowTrace);
    } else if (msg.role === "assistant" && msg.timeline && msg.timeline.length > 0) {
      // V1.2: 运行过程时间线（向后兼容）
      this.appendTimeline(details, msg.timeline);
    }

    // V1.6: SDK 工作流事件（工具级：tool_start/tool_result/file_change/permission/error/message）
    // 仅 sdk-experimental backend 产生；CLI/mock backend 无此数据
    if (msg.role === "assistant" && msg.sdkEvents && msg.sdkEvents.length > 0) {
      this.appendSdkWorkflow(details, msg.sdkEvents);
      // V2.3: 更新状态栏工具步骤/agent 计数
      this.updateLastSdkStats(msg.sdkEvents);
    }

    if (msg.stderr) {
      const startOpen = false;
      this.appendCollapsible(details, failed ? "查看详情" : "stderr", msg.stderr, "llm-bridge-stderr-text", startOpen, failed);
      // V1.2/V1.5: 失败时提取 debug log 路径，提供可点击/复制/打开按钮
      if (failed) {
        const logPathMatch = msg.stderr.match(/Debug log:\s*(.+)/);
        if (logPathMatch && logPathMatch[1]) {
          const debugLogBody = this.createCollapsibleSection(details, "debug log", "llm-bridge-debug-log-collapse", false);
          this.appendDebugLogPath(debugLogBody, logPathMatch[1].trim());
        }
      }
    }
    if (msg.log) {
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
  private appendSdkWorkflow(parent: HTMLElement, events: ReadonlyArray<WorkflowEvent>): void {
    const body = this.createCollapsibleSection(parent, "SDK Workflow", "llm-bridge-sdk-workflow");

    // V2.3: 提取所有 agent 实例（按 sessionId 区分，主 agent 无 parentToolUseId）
    const agents = this.extractAgentInstances(events);
    if (agents.length > 0) {
      const agentGroup = this.createSdkGroup(body, "Agents", agents.length);
      const agentList = agentGroup.createDiv({ cls: "llm-bridge-sdk-agent-list" });
      for (const agent of agents) {
        const item = agentList.createDiv({ cls: `llm-bridge-sdk-agent-item ${agent.isMain ? "is-main" : "is-subagent"}` });
        item.createEl("span", { cls: "llm-bridge-sdk-agent-icon", text: agent.isMain ? "★" : "↳" });
        const text = item.createDiv({ cls: "llm-bridge-sdk-agent-text" });
        text.createEl("span", { cls: "llm-bridge-sdk-agent-name", text: agent.isMain ? "Main agent" : "Subagent" });
        if (agent.sessionId) {
          text.createEl("span", { cls: "llm-bridge-sdk-agent-session", text: truncateText(agent.sessionId, 12), attr: { title: agent.sessionId } });
        }
        if (!agent.isMain && agent.parentToolUseId) {
          text.createEl("span", { cls: "llm-bridge-sdk-agent-parent", text: `parent: ${truncateText(agent.parentToolUseId, 12)}`, attr: { title: agent.parentToolUseId } });
        }
        text.createEl("span", { cls: "llm-bridge-sdk-agent-count", text: `${agent.eventCount} events` });
      }
    }

    // V2.0: 按阶段顺序分组渲染（空分组跳过）
    this.appendSdkEventGroup(body, "Thinking", events.filter((e) => e.type === "thinking"));
    this.appendSdkEventGroup(body, "Messages", events.filter((e) => e.type === "message"));

    // Tools 分组（tool timeline，含 durationMs / 结果状态 / 长内容截断）
    // V2.3: 按主 agent / subagent 分组展示工具调用
    const toolTimeline = buildToolTimeline(events);
    if (toolTimeline.length > 0) {
      // V2.9: 直接用 entry.parentToolUseId 分组（O(1) 查表），替代 findToolParentAgent 对每个 tool 线性扫描 events（原 O(N²)）
      const mainTools = toolTimeline.filter((t) => !t.parentToolUseId);
      const subTools = toolTimeline.filter((t) => !!t.parentToolUseId);
      if (mainTools.length > 0) {
        this.renderToolTimelineGroup(body, "Tools — Main agent", mainTools);
      }
      if (subTools.length > 0) {
        this.renderToolTimelineGroup(body, "Tools — Subagents", subTools);
      }
      // 兜底：若两者都为空（理论上不会发生，但保守处理）
      if (mainTools.length === 0 && subTools.length === 0) {
        this.renderToolTimelineGroup(body, "Tools", toolTimeline);
      }
    }

    this.appendSdkEventGroup(body, "File changes", events.filter((e) => e.type === "file_change"));
    // V2.3s: 权限事件分组（展示工具名/风险等级/决策来源/来源 agent/参数摘要）
    this.renderPermissionHistory(body, events.filter((e): e is PermissionEvent => e.type === "permission"));
    this.appendSdkEventGroup(body, "Errors", events.filter((e) => e.type === "error"));
    this.appendSdkEventGroup(body, "Terminal", events.filter((e) => e.type === "completed" || e.type === "failed"));
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
    Object.assign(msg, patch);
    const block = this.messagesEl.querySelector(`[data-msg-id="${id}"]`);
    if (!block) return;

    // 状态
    const statusEl = block.querySelector(".llm-bridge-msg-status");
    if (statusEl) {
      statusEl.textContent = STATUS_LABEL[msg.status];
      statusEl.className = `llm-bridge-msg-status is-${msg.status}`;
    }

    // 内容
    const contentEl = block.querySelector(".llm-bridge-msg-content");
    if (contentEl) {
      contentEl.textContent = msg.content || "";
    }

    // 重建 details（stderr / log / files）
    const oldDetails = block.querySelector(".llm-bridge-msg-details");
    if (oldDetails) oldDetails.remove();
    this.appendMsgDetails(block as HTMLElement, msg);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
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
    this.renderEmptyState();
    this.refreshSessionState();
    this.clearRunFlow();
    // 重置 SDK 统计
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    // V2.3s: 清空待决策权限请求
    this.clearPendingPermissions();
    this.clearExternalReadRequests();
    this.clearFileWorkingSet();
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
    }
    // 会话标题行着色（按状态）
    const titleRow = this.statusBarEl.querySelector(".llm-bridge-sb-title-row");
    if (titleRow) {
      titleRow.className = `llm-bridge-sb-title-row ${sessionStatusClass(this.sessionState.status)}`;
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
          attr: { title: `${item.title} · ${item.messageCount} 条消息` },
        });
        row.createEl("span", { cls: "llm-bridge-session-dropdown-name", text: item.title });
        row.createEl("span", { cls: "llm-bridge-session-dropdown-meta", text: `${item.messageCount} 条 · ${this.formatHistoryTime(item.savedAt)}` });
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
    this.renderMessagesFromHistory();
    this.refreshSessionState();
    this.clearRunFlow();
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    this.clearPendingPermissions();
    this.clearExternalReadRequests();
    this.clearFileWorkingSet();
    this.refreshStatusBar();
    this.scrollToBottom(); // V2.8: 恢复后滚到最新消息
    // V2.8: agentType 一致性提示（不强制切换 backend）
    if (session.agentType && session.agentType !== this.plugin.settings.agentType) {
      const sessionLabel = AGENT_OPTIONS.find((a) => a.value === session.agentType)?.label ?? session.agentType;
      const currentLabel = AGENT_OPTIONS.find((a) => a.value === this.plugin.settings.agentType)?.label ?? this.plugin.settings.agentType;
      new Notice(`已恢复会话：${session.title}（该会话使用 ${sessionLabel}，当前为 ${currentLabel}，已按当前 backend 恢复）`, 6000);
    } else {
      new Notice(`已恢复会话：${session.title}`);
    }
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
    if (!this.runFlowBody) return;
    this.runFlowBody.empty();
    this.runFlowBody.createEl("div", { cls: "llm-bridge-run-flow-empty", text: "暂无运行" });
    this.runFlowEl.classList.remove("is-running", "is-completed", "is-failed", "is-stopped");
  }

  // V2.0: 运行开始时展示前 3 步（准备上下文 → 构建 prompt → 启动 agent）
  private showRunFlowStarted(promptLength: number): void {
    if (!this.runFlowBody) return;
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
    if (!this.runFlowBody) return;
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

    // 构建 State Snapshot（用于 prompt package）
    const snapshot: StateSnapshot = {
      vaultPath,
      activeFilePath: activeFile?.path || null,
      activeFileContent: null,
      selection,
      fileRefIndex: buildPromptFileRefIndex(this.fileWorkingSet),
      attachmentTextSnippets: this.attachmentTextSnippets.slice(),
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

    // 使用 prompt package builder（V0.7）
    const prompt = buildPromptPackage(userInput, snapshot, settings);

    // V1.5: 构造命令预览（UI-only，展示本次实际执行的 command/args/cwd/上下文）
    const commandPreviewRows = previewToRows(buildCommandPreview(settings, vaultPath, {
      hasSelection: !!selection,
      selectionLength: selection?.length ?? 0,
      hasActiveNote: settings.includeActiveNote && !!activeFile,
      activeFileName: activeFile?.path ?? null,
      promptLength: prompt.length,
    }));

    // 渲染用户消息 + assistant 占位
    this.appendUserMessage(userInput);
    const assistantId = this.appendAssistantPlaceholder();
    this.inputEl.value = "";
    this.closeMentionPicker();

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
    this.updateAssistantMessage(assistantId, {
      log: `$ ${this.commandLine()}\ncwd: ${vaultPath}\nprompt 通过 stdin 传入（${prompt.length} 字符）`,
      commandPreview: commandPreviewRows,
    });

    const backend = this.getBackend();
    const runtimeFileToolAdapter = createRuntimeFileToolAdapter(
      backend instanceof SdkBackend ? "sdk" : "cli",
      (request) => this.executeAgentFileToolRoute(request),
    );

    // 构造 AgentTask 并通过 AgentBackend 启动
    const task: AgentTask = {
      id: assistantId,
      userMessage: userInput,
      prompt,
      cwd: vaultPath,
      createdAt: new Date().toISOString(),
      includeActiveNote: settings.includeActiveNote,
      includeSelection: settings.includeSelection,
      runtimeFileToolAdapter,
    };

    this.runHandle = backend.run(task, settings, (event) => {
      switch (event.type) {
        case "started":
          // 任务已启动，无需额外处理（状态已在前面设置）
          break;
        case "stdout_delta": {
          if (!sawStdout) {
            sawStdout = true;
            const detail = event.data.replace(/\s+/g, " ").trim().slice(0, 60);
            const ts = new Date().toISOString();
            timelineEvents.push({ type: "stdout", detail, timestamp: ts });
            // V1.5: 同步记录到 workflowEvents
            workflowEvents.push({ stage: "stdout", detail, timestamp: ts });
          }
          const msg = this.messages.find((m) => m.id === assistantId);
          if (msg) {
            this.updateAssistantMessage(assistantId, { content: msg.content + event.data });
          }
          break;
        }
        case "stderr_delta": {
          if (!sawStderr) {
            sawStderr = true;
            const detail = event.data.replace(/\s+/g, " ").trim().slice(0, 60);
            const ts = new Date().toISOString();
            timelineEvents.push({ type: "stderr", detail, timestamp: ts });
            // V1.5: 同步记录到 workflowEvents
            workflowEvents.push({ stage: "stderr", detail, timestamp: ts });
          }
          if (!this.plugin.settings.showStderr) return;
          const msg = this.messages.find((m) => m.id === assistantId);
          if (msg) {
            this.updateAssistantMessage(assistantId, { stderr: msg.stderr + event.data });
          }
          break;
        }
        case "completed":
        case "failed":
        case "stopped": {
          // 构造 RunResult 兼容现有 onRunFinished / saveLogFile 逻辑
          const result: RunResult = {
            exitCode: event.exitCode,
            signal: event.type === "stopped" ? "SIGTERM" as NodeJS.Signals : null,
            durationMs: event.durationMs,
            stdout: event.stdout,
            stderr: event.stderr,
            command: event.command,
            args: event.args,
          };
          void this.onRunFinished(result, vaultPath, assistantId, event.type, startedAt, timelineEvents, workflowEvents, prompt.length, sdkEvents);
          break;
        }
      }
    }, (wfEvent: WorkflowEvent) => {
      // V1.6: 收集 SDK 工作流事件（工具级），用于 UI 渲染
      sdkEvents.push(wfEvent);
      // V2.3s: 实时处理权限请求事件（pending=true 时加入面板等待用户决策）
      if (wfEvent.type === "permission") {
        const permEv = wfEvent as PermissionEvent;
        if (permEv.pending && permEv.requestId) {
          // 新的 pending 权限请求：加入面板
          this.pendingPermissions.set(permEv.requestId, permEv);
          this.refreshPermissionPanel();
        } else if (permEv.requestId && !permEv.pending) {
          // 权限请求已解决（用户已决策或缓存命中）：从面板移除
          if (this.pendingPermissions.has(permEv.requestId)) {
            this.pendingPermissions.delete(permEv.requestId);
            this.refreshPermissionPanel();
          }
        }
      }
    });
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
      const savedId = await saveSession(
        vaultPath,
        this.sessionState,
        this.messages,
        this.plugin.settings.agentType,
        this.currentSessionId || undefined,
      );
      if (savedId) {
        this.currentSessionId = savedId;
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
