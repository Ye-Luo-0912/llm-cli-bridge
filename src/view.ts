// LLM CLI Bridge — 右侧 Chat View（Codex / Claude Code 风格紧凑工作台）

import { ItemView, MarkdownView, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
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
import { buildPresetPrompt, PRESETS, PresetType, requiresActiveNote, requiresSelection } from "./presetPrompts";
import { buildFirstUseGuide, shouldShowFirstUseGuide } from "./firstUseGuide";
import { buildTimeline, isTerminalTimelineType, timelineTypeClass, timelineTypeLabel, TimelineEventType } from "./runTimeline";
import { buildCommandLine, buildCommandPreview, buildRedactedCommandDisplay, previewToRows, CommandPreview } from "./commandProfile";
import { buildWorkflowTrace, workflowStageLabel, workflowStageClass, isTerminalWorkflowStage, WorkflowTraceStage, WorkflowTraceEvent } from "./workflowTrace";
import { SdkBackend } from "./sdkBackend";
import { WorkflowEvent, PermissionEvent, buildToolTimeline, workflowEventLabel, workflowEventIcon, workflowEventClass, truncateText, extractFileChanges } from "./workflowEvent";
import { SessionState, createNewSession, generateSessionTitle, sessionStatusLabel, sessionStatusClass, updateSession } from "./session";
import { PersistedSession, SessionListItem, saveSession, listSessions, loadSession, deleteSession } from "./sessions";
import { Skill, loadSkills, seedDefaultSkills, filterEnabledSkills, expandSkillPrompt, importSkillFromText, deleteSkill, isImportedSkill, scanSkillPrompt, truncateSkillPrompt, MAX_SKILL_PROMPT_LENGTH, updateImportedSkill, searchSkills, checkImportConflict, extractTags } from "./skills";
import { SkillsState, SkillMeta, loadSkillsState, saveSkillsState, getSkillMeta, recordSkillApplied, setSkillPinned, recordCombo, formatRelativeTime, createEmptySkillsState } from "./skillsState";
import { getPermissionModeInfo, type PermissionChoice } from "./sdkPermission";

export const VIEW_TYPE_LLM_BRIDGE = "llm-cli-bridge-view";

// V0.9: FileSnapshot / snapshotVaultMarkdownFiles / diffSnapshots 已抽取到 fileDiff.ts

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
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
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
  // V2.0: Skills 列表
  private skills: Skill[] = [];
  private skillsListEl!: HTMLElement;
  // V2.1: Skills 面板折叠开关（用于更新标题计数）
  private skillsToggleEl!: HTMLElement;
  // V2.3: 从 .llm-bridge/skills/ 导入的 skill 名称集合（用于 UI 显示删除按钮）
  private importedSkillNames: Set<string> = new Set();
  // V2.5: Skills 搜索框 + 当前过滤 query
  private skillsSearchEl!: HTMLInputElement;
  private skillsSearchQuery = "";
  // V2.6: Skills 分组/排序下拉 + state 持久化 + 组合勾选
  private skillsGroupEl!: HTMLSelectElement;
  private skillsSortEl!: HTMLSelectElement;
  private skillsState: SkillsState = createEmptySkillsState();
  private skillsGroupFilter = "all"; // all | ungrouped | <tag>
  private skillsSortBy = "name"; // name | recent | popular
  private skillsComboSet: Set<string> = new Set(); // 勾选组合的 skill 名称（按插入顺序）
  // V2.7: state 写入节流定时器 + 搜索防抖定时器（避免频繁 IO/渲染）
  private skillsStateSaveTimer: number | null = null;
  private skillsSearchDebounceTimer: number | null = null;
  // V2.5: 历史会话列表
  private historyListEl!: HTMLElement;
  private historyToggleEl!: HTMLElement;
  private historyItems: SessionListItem[] = [];
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
  private includeNoteCheckEl!: HTMLInputElement;
  private includeSelectionCheckEl!: HTMLInputElement;
  private messagesEl!: HTMLElement;
  // V2.7: 长会话旧消息折叠（false=折叠显示最近 N 条；true=展开全部）
  private messagesFoldExpanded = false;
  private inputEl!: HTMLTextAreaElement;
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
  private presetBtnsEl!: HTMLElement;
  // V2.3: 状态栏新增字段（权限策略 / 已应用 Skills / 工具步骤 / agent 计数）
  private statusPermissionEl!: HTMLElement;
  private statusSkillsEl!: HTMLElement;
  private statusToolsEl!: HTMLElement;
  private statusAgentsEl!: HTMLElement;
  // V2.3s: 权限模式状态栏字段（SDK permissionMode + 中文风险）
  private statusPermModeEl!: HTMLElement;
  // V2.3s: 待决策权限请求面板（运行中实时展示 pending 权限请求，用户点击允许/拒绝）
  private permissionPanelEl!: HTMLElement;
  private pendingPermissions: Map<string, PermissionEvent> = new Map();
  // V2.3: 已应用 Skills 名称集合（applySkill 添加；发送/清空时重置）
  private appliedSkillNames: Set<string> = new Set();
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

    // ===== 顶部 header（单行：左标题 / 中 agent 下拉 / 右状态点+刷新） =====
    const header = root.createDiv({ cls: "llm-bridge-header" });
    header.createEl("span", { cls: "llm-bridge-title", text: "Bridge" });

    // agent 下拉（header 中间）
    const agentSelect = header.createEl("select", { cls: "llm-bridge-agent-select" });
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
    // 复用 agentChipGroup 字段保存下拉，refreshChipGroup 不作用于它；agentChipGroup 保留给底部 chip
    this.agentChipGroup = agentSelect;

    const headerRight = header.createDiv({ cls: "llm-bridge-header-right" });
    this.statusDotEl = headerRight.createEl("span", {
      cls: "llm-bridge-status-dot llm-bridge-status-dot-idle",
      attr: { title: STATUS_LABEL.idle },
    });
    this.statusLabelEl = headerRight.createEl("span", {
      cls: "llm-bridge-status-text",
      text: STATUS_LABEL.idle,
    });
    const refreshBtn = headerRight.createEl("button", { cls: "llm-bridge-icon-btn", attr: { title: "刷新" } });
    refreshBtn.createEl("span", { cls: "llm-bridge-icon", text: "↻" });
    refreshBtn.addEventListener("click", () => {
      this.lastPreflightResult = null; // V2.4: 手动刷新时失效 preflight 缓存
      this.updateContextDisplay();
      this.syncControlsFromSettings();
    });

    // ===== Pending Actions 区域（最小化折叠） =====
    this.pendingActionsEl = root.createDiv({ cls: "llm-bridge-pending-wrap" });
    const pendingHead = this.pendingActionsEl.createDiv({ cls: "llm-bridge-pending-head" });
    const pendingToggle = pendingHead.createEl("span", { cls: "llm-bridge-pending-toggle", text: "▶ Pending (0)" });
    this.pendingActionsCountEl = pendingHead.createEl("span", { cls: "llm-bridge-pending-count", text: "" });
    const pendingBody = this.pendingActionsEl.createDiv({ cls: "llm-bridge-pending-body" });
    pendingBody.setAttribute("hidden", "");
    this.pendingActionsBody = pendingBody;
    pendingToggle.addEventListener("click", () => {
      const hidden = pendingBody.hasAttribute("hidden");
      if (hidden) {
        pendingBody.removeAttribute("hidden");
        pendingToggle.textContent = "▼ Pending";
      } else {
        pendingBody.setAttribute("hidden", "");
        pendingToggle.textContent = "▶ Pending";
      }
    });
    this.pendingActionsEl.appendChild(pendingHead);
    this.pendingActionsEl.appendChild(pendingBody);

    // 注册 pending action 回调
    this.registerPendingActionCallback();

    // ===== V2.0: 会话状态区（Session State） =====
    // 会话标题 + 运行状态 + Backend/Agent/上下文指标
    this.statusBarEl = root.createDiv({ cls: "llm-bridge-status-bar" });
    // 会话标题行（左侧标题 + 右侧 New Session 按钮）
    const sbTitleRow = this.statusBarEl.createDiv({ cls: "llm-bridge-sb-title-row" });
    this.sessionTitleEl = sbTitleRow.createEl("span", { cls: "llm-bridge-sb-session-title", text: this.sessionState.title, attr: { title: "当前会话" } });
    // V2.4: 状态栏 New 按钮复用 clearBtn 字段（移除 chips 行重复按钮）
    this.clearBtn = sbTitleRow.createEl("button", {
      cls: "llm-bridge-sb-new-session",
      text: "New",
      attr: { title: "新建会话（清空消息）" },
    });
    this.clearBtn.addEventListener("click", () => this.newSession());
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
      attr: { title: "展开高级指标（Preflight/权限/Skills/工具/Agents/模式）" },
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
    // V2.3: 权限策略 / 已应用 Skills / 工具步骤 / agent 计数
    this.statusPermissionEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-permission", attr: { title: "当前权限策略" } });
    this.statusPermissionEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Perm" });
    this.statusPermissionEl.createEl("span", { cls: "llm-bridge-sb-value", text: "medium" });
    this.statusSkillsEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item llm-bridge-sb-skills", attr: { title: "已应用到当前输入的 Skills" } });
    this.statusSkillsEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Skills" });
    this.statusSkillsEl.createEl("span", { cls: "llm-bridge-sb-value", text: "0" });
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

    // Preflight 按钮（不调用真实模型，只探测 command 可用性）
    this.preflightBtn = this.statusBarEl.createEl("button", {
      cls: "llm-bridge-sb-btn",
      text: "Preflight",
      attr: { title: "检测 agent 命令是否可用（不调用真实模型）" },
    });
    this.preflightBtn.addEventListener("click", () => void this.runPreflightCheck());

    // ===== V1.1: 常用操作按钮行（上下文选择区一部分） =====
    this.presetBtnsEl = root.createDiv({ cls: "llm-bridge-presets" });
    for (const preset of PRESETS) {
      const btn = this.presetBtnsEl.createEl("button", {
        cls: "llm-bridge-preset-btn",
        text: preset.label,
        attr: { title: preset.hint, "data-preset": preset.type },
      });
      btn.addEventListener("click", () => void this.applyPreset(preset.type));
    }

    // ===== V2.0: Skills 入口（上下文选择区，可折叠，从 .llm-bridge/skills.md 读取） =====
    this.renderSkillsPanel(root);

    // ===== V2.5: 历史会话入口（可折叠，默认折叠） =====
    this.renderHistoryPanel(root);

    // ===== V1.2: 首次使用提示（可关闭，关闭后不再显示） =====
    this.renderFirstUseGuide(root);

    // ===== V2.0: 运行流程区（Run Flow，展示最新一次运行的 6 步流程） =====
    this.renderRunFlowPanel(root);

    // ===== 消息流（对话区） =====
    this.messagesEl = root.createDiv({ cls: "llm-bridge-messages" });
    this.renderEmptyState();

    // V2.3s: 权限请求面板（运行中实时展示 pending 权限请求，用户点击允许/拒绝）
    this.permissionPanelEl = root.createDiv({ cls: "llm-bridge-perm-panel" });
    this.permissionPanelEl.style.display = "none";

    // ===== 底部 composer =====
    const composer = root.createDiv({ cls: "llm-bridge-composer" });

    // 输入框（大）+ 右侧发送/停止
    const inputRow = composer.createDiv({ cls: "llm-bridge-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "llm-bridge-input",
      attr: { placeholder: "Ask Claude Code…", rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.run();
      }
    });

    const actionCol = inputRow.createDiv({ cls: "llm-bridge-action-col" });
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
    this.sendBtn.createEl("span", { cls: "llm-bridge-send-icon", text: "↑" });
    this.sendBtn.addEventListener("click", () => void this.run());

    // compact chips 行（输入框下方）：Claude Code / gpt-5.5 / High / Fresh / Note / Selection
    const chipsRow = composer.createDiv({ cls: "llm-bridge-chips-row" });

    // agent chip（与 header 下拉同步，纯显示当前选中）
    const agentChipWrap = chipsRow.createDiv({ cls: "llm-bridge-chip-wrap" });
    const agentChipLabel = agentChipWrap.createEl("button", {
      cls: "llm-bridge-chip-readonly",
      text: "Claude Code",
      attr: { "data-chip": "agent" },
    });
    agentChipLabel.addEventListener("click", () => {
      // 点击聚焦到 header 下拉
      (this.agentChipGroup as HTMLSelectElement).focus();
    });
    this.agentChipGroup = agentSelect; // 保持引用 header 下拉
    // 用单独字段保存 agent chip 文本节点
    this.agentChipTextEl = agentChipLabel;

    this.modelChipGroup = this.buildChipGroup(chipsRow, MODEL_OPTIONS, () => this.plugin.settings.model, async (v) => {
      this.plugin.settings.model = v;
      await this.plugin.saveSettings();
    });
    this.effortChipGroup = this.buildChipGroup(chipsRow, EFFORT_OPTIONS, () => this.plugin.settings.effortLevel, async (v) => {
      this.plugin.settings.effortLevel = v;
      await this.plugin.saveSettings();
    });
    // V2.4: 移除 Mode chip（仅 Fresh 可用，Continue/Resume 永久 disabled，点击 no-op 易误导）

    // Note / Selection 上下文 chips（可点击切换，带勾选态）
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

    // V2.4: 移除 chips 行重复的 New 按钮（状态栏已有，避免误导）

    // 初始化
    this.syncControlsFromSettings();
    this.updateContextDisplay();
    this.setGlobalStatus("idle");
    this.refreshStatusBar();
    this.refreshSessionState();
    void this.refreshSkills();
    void this.refreshHistory();

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.updateContextDisplay();
      this.refreshStatusBar();
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
    // header agent 下拉
    (this.agentChipGroup as HTMLSelectElement).value = this.plugin.settings.agentType;
    // 底部 agent chip 文本
    const agentLabel = AGENT_OPTIONS.find((a) => a.value === this.plugin.settings.agentType)?.label ?? this.plugin.settings.agentType;
    this.agentChipTextEl.textContent = agentLabel;

    // cycle chips：显示当前选中标签
    this.refreshCycleChip(this.modelChipGroup, MODEL_OPTIONS, this.plugin.settings.model);
    this.refreshCycleChip(this.effortChipGroup, EFFORT_OPTIONS, this.plugin.settings.effortLevel);
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

  async onClose(): Promise<void> {
    if (this.runHandle) {
      this.runHandle.stop();
      this.runHandle = null;
    }
  }

  // ---------- 控件同步 ----------

  private syncControlsFromSettings(): void {
    this.refreshAllChips();
    this.includeNoteCheckEl.checked = this.plugin.settings.includeActiveNote;
    this.includeSelectionCheckEl.checked = this.plugin.settings.includeSelection;
  }

  private refreshModeOptions(): void {
    // 当前只 claude 支持模式概念；codex/custom 暂只 fresh
    if (this.plugin.settings.agentType !== "claude") {
      this.plugin.settings.sessionMode = "fresh";
      this.refreshAllChips();
    }
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
    this.statusLabelEl.textContent = STATUS_LABEL[status];
    this.statusDotEl.className = `llm-bridge-status-dot llm-bridge-status-dot-${status}`;
    this.statusDotEl.setAttribute("title", STATUS_LABEL[status]);
    const running = status === "running";
    // 停止按钮只在运行中显示，发送按钮反之
    this.stopBtn.style.display = running ? "inline-flex" : "none";
    this.sendBtn.style.display = running ? "none" : "inline-flex";
    this.sendBtn.disabled = running;
    // 禁用所有 chip 与 agent 下拉
    const allChips = this.contentEl.querySelectorAll(".llm-bridge-chip, .llm-bridge-agent-select");
    allChips.forEach((c) => {
      (c as HTMLButtonElement).disabled = running;
    });
    this.includeNoteCheckEl.disabled = running;
    this.includeSelectionCheckEl.disabled = running;
    this.clearBtn.disabled = running;
    // V1.1: 运行中禁用 preflight 和 preset 按钮
    this.preflightBtn.disabled = running;
    (this.presetBtnsEl.querySelectorAll(".llm-bridge-preset-btn") as NodeListOf<HTMLButtonElement>).forEach((b) => {
      b.disabled = running;
    });
    // V2.0: 同步会话状态
    this.sessionState = updateSession(this.sessionState, { status });
    this.refreshSessionState();
  }

  // V1.1: 刷新状态栏（Backend 模式 / Agent / cwd / Preflight 状态）
  // V2.3: 新增权限策略 / 已应用 Skills / 工具步骤 / agent 计数
  private refreshStatusBar(): void {
    const s = this.plugin.settings;
    // Backend 模式
    const backendLabel = s.backendMode === "auto" ? "auto" : s.backendMode;
    this.statusBackendEl.querySelector(".llm-bridge-sb-value")!.textContent = backendLabel;
    // Agent 类型
    const agentLabel = AGENT_OPTIONS.find((a) => a.value === s.agentType)?.label ?? s.agentType;
    this.statusAgentEl.querySelector(".llm-bridge-sb-value")!.textContent = agentLabel;
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
    // V2.3: 已应用 Skills 计数
    const appliedCount = this.appliedSkillNames.size;
    this.statusSkillsEl.querySelector(".llm-bridge-sb-value")!.textContent = String(appliedCount);
    const appliedNames = Array.from(this.appliedSkillNames).join(", ") || "无";
    this.statusSkillsEl.setAttribute("title", `已应用 Skills：${appliedNames}`);
    // V2.3: 最近一次 SDK 运行的工具步骤与 agent 数
    this.statusToolsEl.querySelector(".llm-bridge-sb-value")!.textContent = String(this.lastSdkToolCount);
    this.statusToolsEl.setAttribute("title", `最近一次 SDK 运行：${this.lastSdkToolCount} 个工具步骤`);
    this.statusAgentsEl.querySelector(".llm-bridge-sb-value")!.textContent = String(this.lastSdkAgentCount);
    this.statusAgentsEl.setAttribute("title", `最近一次 SDK 运行：${this.lastSdkAgentCount} 个 agent 实例（主+子）`);
  }

  // V2.3: 应用 Skill 时记录名称（用于状态栏展示）
  private trackAppliedSkill(name: string): void {
    this.appliedSkillNames.add(name);
    this.refreshStatusBar();
  }

  // V2.3: 重置已应用 Skills（发送或清空时调用）
  private resetAppliedSkills(): void {
    this.appliedSkillNames.clear();
    this.refreshStatusBar();
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
      this.preflightBtn.textContent = "Preflight";
    }
  }

  // V1.1: 应用预设操作（只生成 prompt，不自动注入全文）
  private async applyPreset(type: PresetType): Promise<void> {
    if (this.runHandle) return;

    const activeFile = this.getActiveFile();
    const selection = this.getSelection();

    // 检查前置条件
    if (requiresActiveNote(type) && !activeFile) {
      new Notice("请先打开一个笔记");
      return;
    }
    if (requiresSelection(type) && !selection) {
      new Notice("请先选中文本");
      return;
    }

    const prompt = buildPresetPrompt(type, {
      activeFilePath: activeFile?.path || null,
      outputDir: this.plugin.settings.outputDir,
    });

    if (type === "freeform") {
      // 自由提问：清空输入框并聚焦
      this.inputEl.value = "";
      this.inputEl.focus();
      return;
    }

    // 设置 includeSelection / includeActiveNote（不自动注入全文）
    if (type === "explain") {
      // explain 需要选区注入
      if (!this.plugin.settings.includeSelection) {
        this.plugin.settings.includeSelection = true;
        await this.plugin.saveSettings();
        this.syncControlsFromSettings();
      }
    } else if (type === "summarize") {
      // summarize 需要当前笔记内容注入（用户可手动关闭）
      if (!this.plugin.settings.includeActiveNote) {
        this.plugin.settings.includeActiveNote = true;
        await this.plugin.saveSettings();
        this.syncControlsFromSettings();
      }
    }

    this.setInput(prompt);
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
      const startOpen = failed;
      this.appendCollapsible(details, "stderr", msg.stderr, "llm-bridge-stderr-text", startOpen, failed);
      // V1.2/V1.5: 失败时提取 debug log 路径，提供可点击/复制/打开按钮
      if (failed) {
        const logPathMatch = msg.stderr.match(/Debug log:\s*(.+)/);
        if (logPathMatch && logPathMatch[1]) {
          this.appendDebugLogPath(details, logPathMatch[1].trim());
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
        text.createEl("span", { cls: "llm-bridge-workflow-trace-detail", text: entry.detail });
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
      const mainTools = toolTimeline.filter((t) => this.findToolParentAgent(events, t.callId) === "main");
      const subTools = toolTimeline.filter((t) => this.findToolParentAgent(events, t.callId) === "subagent");
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

  // V2.3: 根据 tool_use callId 查找其所属 agent 类型（main / subagent / unknown）
  private findToolParentAgent(events: ReadonlyArray<WorkflowEvent>, callId: string): "main" | "subagent" | "unknown" {
    for (const event of events) {
      if (event.type === "tool_start" && event.callId === callId) {
        return event.parentToolUseId ? "subagent" : "main";
      }
    }
    return "unknown";
  }

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
        text.createEl("span", { cls: "llm-bridge-timeline-detail", text: entry.detail });
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
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
    // V2.3: 重置已应用 Skills 与 SDK 统计
    this.resetAppliedSkills();
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    // V2.3s: 清空待决策权限请求
    this.clearPendingPermissions();
    this.refreshStatusBar();
  }

  // V2.0: 刷新会话状态展示（标题 + 状态 + 消息数 + 上下文指标）
  private refreshSessionState(): void {
    if (this.sessionTitleEl) {
      this.sessionTitleEl.textContent = this.sessionState.title;
    }
    // 会话标题行着色（按状态）
    const titleRow = this.statusBarEl.querySelector(".llm-bridge-sb-title-row");
    if (titleRow) {
      titleRow.className = `llm-bridge-sb-title-row ${sessionStatusClass(this.sessionState.status)}`;
    }
  }

  // V2.0: 渲染 Skills 面板（可折叠，从 .llm-bridge/skills.md 读取）
  // V2.3: head 添加"导入"按钮
  // V2.5: body 顶部添加搜索框
  private renderSkillsPanel(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-skills-panel" });
    const head = wrap.createDiv({ cls: "llm-bridge-skills-head" });
    this.skillsToggleEl = head.createEl("span", { cls: "llm-bridge-skills-toggle", text: "▶ Skills" });
    // V2.3: 导入按钮（弹窗输入 name/description/prompt）
    const importBtn = head.createEl("button", {
      cls: "llm-bridge-skills-import-btn",
      text: "+ 导入",
      attr: { title: "从文本导入新 skill 到 .llm-bridge/skills/ 目录" },
    });
    importBtn.addEventListener("click", () => void this.openImportSkillDialog());
    const body = wrap.createDiv({ cls: "llm-bridge-skills-body" });
    body.setAttribute("hidden", "");
    this.skillsListEl = body;
    // V2.5: 搜索框（仅展开时可见，过滤 skills 列表）
    const searchBar = body.createDiv({ cls: "llm-bridge-skills-search" });
    this.skillsSearchEl = searchBar.createEl("input", {
      type: "text",
      cls: "llm-bridge-skills-search-input",
      attr: { placeholder: "搜索 skill 名称/描述/#标签…", title: "按名称/描述/标签过滤 skills" },
    }) as HTMLInputElement;
    this.skillsSearchEl.addEventListener("input", () => {
      // V2.7: 搜索防抖（300ms），避免每次按键都重渲染列表
      if (this.skillsSearchDebounceTimer !== null) {
        window.clearTimeout(this.skillsSearchDebounceTimer);
      }
      const value = this.skillsSearchEl.value;
      this.skillsSearchDebounceTimer = window.setTimeout(() => {
        this.skillsSearchQuery = value;
        this.renderSkillsList();
        this.skillsSearchDebounceTimer = null;
      }, 300);
    });
    // V2.6: 分组 + 排序下拉 + 组合应用按钮
    const controlsBar = body.createDiv({ cls: "llm-bridge-skills-controls" });
    const groupLabel = controlsBar.createEl("span", { cls: "llm-bridge-skills-ctrl-label", text: "分组" });
    this.skillsGroupEl = controlsBar.createEl("select", { cls: "llm-bridge-skills-group-select" }) as HTMLSelectElement;
    this.skillsGroupEl.createEl("option", { value: "all", text: "全部" });
    this.skillsGroupEl.createEl("option", { value: "ungrouped", text: "未分组" });
    // 标签选项在 refreshSkills 后动态填充
    this.skillsGroupEl.addEventListener("change", () => {
      this.skillsGroupFilter = this.skillsGroupEl.value;
      this.renderSkillsList();
    });
    const sortLabel = controlsBar.createEl("span", { cls: "llm-bridge-skills-ctrl-label", text: "排序" });
    this.skillsSortEl = controlsBar.createEl("select", { cls: "llm-bridge-skills-sort-select" }) as HTMLSelectElement;
    this.skillsSortEl.createEl("option", { value: "name", text: "名称" });
    this.skillsSortEl.createEl("option", { value: "recent", text: "最近使用" });
    this.skillsSortEl.createEl("option", { value: "popular", text: "最常用" });
    this.skillsSortEl.addEventListener("change", () => {
      this.skillsSortBy = this.skillsSortEl.value;
      this.renderSkillsList();
    });
    const comboBtn = controlsBar.createEl("button", {
      cls: "llm-bridge-skills-combo-btn",
      text: "组合应用 (0)",
      attr: { title: "按勾选顺序拼接所选 skill 的 prompt，一次性插入光标位置" },
    });
    comboBtn.addEventListener("click", () => void this.applyCombo());
    const listContainer = body.createDiv({ cls: "llm-bridge-skills-list-container" });
    // skillsListEl 重新指向 listContainer（搜索框单独一行，不随空状态被清空）
    this.skillsListEl = listContainer;
    this.skillsToggleEl.addEventListener("click", () => {
      const hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
      } else {
        body.setAttribute("hidden", "");
      }
      this.updateSkillsToggle();
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
    refreshHistBtn.addEventListener("click", () => void this.refreshHistory());
    const body = wrap.createDiv({ cls: "llm-bridge-history-body" });
    body.setAttribute("hidden", "");
    this.historyListEl = body;
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
    body.createDiv({ cls: "llm-bridge-history-empty", text: "暂无历史会话" });
  }

  // V2.5: 从 .llm-bridge/sessions/ 加载历史会话列表并渲染
  private async refreshHistory(): Promise<void> {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    try {
      this.historyItems = await listSessions(vaultPath);
    } catch {
      this.historyItems = [];
    }
    this.renderHistoryList();
  }

  // V2.5: 渲染历史会话列表
  private renderHistoryList(): void {
    if (!this.historyListEl) return;
    try {
    this.historyListEl.empty();
    if (this.historyItems.length === 0) {
      this.historyListEl.createDiv({ cls: "llm-bridge-history-empty", text: "暂无历史会话" });
      this.historyToggleEl.textContent = `${this.historyListEl.hasAttribute("hidden") ? "▶" : "▼"} History (0)`;
      return;
    }
    const list = this.historyListEl.createDiv({ cls: "llm-bridge-history-list" });
    for (const item of this.historyItems) {
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
    this.historyToggleEl.textContent = `${this.historyListEl.hasAttribute("hidden") ? "▶" : "▼"} History (${this.historyItems.length})`;
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
    this.resetAppliedSkills();
    this.lastSdkToolCount = 0;
    this.lastSdkAgentCount = 0;
    this.clearPendingPermissions();
    this.refreshStatusBar();
    new Notice(`已恢复会话：${session.title}`);
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
      await this.refreshHistory();
    } else {
      new Notice("删除失败：会话文件不存在");
    }
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

  // V2.0: 从 Vault 读取 skills 列表并渲染
  // V2.3: 预加载导入状态（用于 UI 显示删除按钮）
  // V2.6: 同时加载 skills-state（置顶/统计/最近组合），并填充分组下拉标签选项
  private async refreshSkills(): Promise<void> {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    this.skills = await loadSkills(vaultPath);
    this.skillsState = await loadSkillsState(vaultPath);
    this.importedSkillNames = new Set();
    for (const skill of this.skills) {
      if (await isImportedSkill(vaultPath, skill.name)) {
        this.importedSkillNames.add(skill.name);
      }
    }
    // V2.6: 填充分组下拉的标签选项（保留 all/ungrouped，追加所有 tags）
    this.populateGroupOptions();
    this.renderSkillsList();
  }

  // V2.6: 填充分组下拉标签选项（从当前 skills 收集所有 tags）
  private populateGroupOptions(): void {
    if (!this.skillsGroupEl) return;
    const currentValue = this.skillsGroupEl.value;
    // 保留前两个固定选项（all/ungrouped），清除其余
    while (this.skillsGroupEl.options.length > 2) {
      this.skillsGroupEl.remove(2);
    }
    const allTags = new Set<string>();
    for (const skill of this.skills) {
      for (const tag of skill.tags || []) {
        allTags.add(tag);
      }
    }
    for (const tag of Array.from(allTags).sort()) {
      this.skillsGroupEl.createEl("option", { value: tag, text: `#${tag}` });
    }
    // 恢复之前选择（若仍存在）
    if (Array.from(this.skillsGroupEl.options).some(o => o.value === currentValue)) {
      this.skillsGroupEl.value = currentValue;
    } else {
      this.skillsGroupEl.value = "all";
      this.skillsGroupFilter = "all";
    }
  }

  // V2.1: 更新 Skills 折叠标题（含启用/总数计数）
  private updateSkillsToggle(): void {
    if (!this.skillsToggleEl) return;
    const enabled = filterEnabledSkills(this.skills, this.plugin.settings.disabledSkills).length;
    const total = this.skills.length;
    const hidden = this.skillsListEl.hasAttribute("hidden");
    this.skillsToggleEl.textContent = `${hidden ? "▶" : "▼"} Skills (${enabled}/${total})`;
  }

  // V2.1: 渲染 skills 列表（空则显示提示 + 初始化按钮；每项含启用/禁用开关）
  // V2.5: 应用搜索过滤；导入的 skill 增加"查看"和"编辑"按钮
  // V2.6: 分组/排序/置顶/组合勾选/使用统计
  private renderSkillsList(): void {
    if (!this.skillsListEl) return;
    try {
    this.skillsListEl.empty();
    if (this.skills.length === 0) {
      const empty = this.skillsListEl.createDiv({ cls: "llm-bridge-skills-empty" });
      empty.createEl("span", { text: "无 skills。在 .llm-bridge/skills.md 中用 ## 标题定义 skill。" });
      const seedBtn = empty.createEl("button", {
        cls: "llm-bridge-skills-seed-btn",
        text: "初始化默认 Skills",
        attr: { title: "写入 5 个默认 skill 到 .llm-bridge/skills.md（不覆盖已存在文件）" },
      });
      seedBtn.addEventListener("click", () => void this.seedDefaults());
      this.updateSkillsToggle();
      this.updateComboButton();
      return;
    }
    // V2.5: 应用搜索过滤
    let filtered = searchSkills(this.skills, this.skillsSearchQuery);
    // V2.6: 应用分组过滤
    if (this.skillsGroupFilter === "ungrouped") {
      filtered = filtered.filter((s) => (s.tags || []).length === 0);
    } else if (this.skillsGroupFilter !== "all") {
      filtered = filtered.filter((s) => (s.tags || []).includes(this.skillsGroupFilter));
    }
    if (filtered.length === 0) {
      const empty = this.skillsListEl.createDiv({ cls: "llm-bridge-skills-empty" });
      empty.createEl("span", { text: `无匹配当前过滤条件的 skill` });
      this.updateSkillsToggle();
      this.updateComboButton();
      return;
    }
    // V2.6: 排序（置顶始终最前，组内按 sortBy 排序）
    const sorted = this.sortSkills(filtered);
    const disabled = new Set(this.plugin.settings.disabledSkills);
    const list = this.skillsListEl.createDiv({ cls: "llm-bridge-skills-list" });
    for (const skill of sorted) {
      const isDisabled = disabled.has(skill.name);
      const meta = getSkillMeta(this.skillsState, skill.name);
      const isPinned = !!meta.pinned;
      const item = list.createDiv({
        cls: `llm-bridge-skill-item${isDisabled ? " is-disabled" : ""}${isPinned ? " is-pinned" : ""}`,
        attr: { title: skill.description || skill.name },
      });
      // V2.6: 组合勾选框（与启用开关区分：启用是永久，勾选是本次组合）
      const comboLabel = item.createEl("label", { cls: "llm-bridge-skill-combo", attr: { title: "勾选加入组合应用" } });
      const comboCheck = comboLabel.createEl("input", { type: "checkbox" }) as HTMLInputElement;
      comboCheck.checked = this.skillsComboSet.has(skill.name);
      comboCheck.addEventListener("change", () => {
        if (comboCheck.checked) {
          this.skillsComboSet.add(skill.name);
        } else {
          this.skillsComboSet.delete(skill.name);
        }
        this.updateComboButton();
      });
      // 启用/禁用开关
      const checkLabel = item.createEl("label", { cls: "llm-bridge-skill-check", attr: { title: "启用/禁用此 skill" } });
      const check = checkLabel.createEl("input", { type: "checkbox" }) as HTMLInputElement;
      check.checked = !isDisabled;
      check.addEventListener("change", () => void this.toggleSkillEnabled(skill.name, check.checked));
      // V2.6: 置顶按钮
      const pinBtn = item.createEl("button", {
        cls: "llm-bridge-skill-pin-btn",
        text: isPinned ? "📌" : "📍",
        attr: { title: isPinned ? "取消置顶" : "置顶（排在分组最前）" },
      });
      pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.toggleSkillPinned(skill.name, !isPinned);
      });
      // 名称 + 描述 + 标签（点击插入 prompt 到光标位置；禁用时不响应）
      const main = item.createEl("button", { cls: "llm-bridge-skill-main" });
      main.createEl("span", { cls: "llm-bridge-skill-name", text: skill.name });
      if (skill.description) {
        main.createEl("span", { cls: "llm-bridge-skill-desc", text: skill.description });
      }
      // V2.6: 标签展示
      if (skill.tags && skill.tags.length > 0) {
        const tagsEl = main.createEl("span", { cls: "llm-bridge-skill-tags" });
        for (const tag of skill.tags) {
          tagsEl.createEl("span", { cls: "llm-bridge-skill-tag", text: `#${tag}` });
        }
      }
      // V2.6: 使用统计（应用次数 + 最近使用时间）
      if (meta.applyCount > 0) {
        const statsEl = main.createEl("span", { cls: "llm-bridge-skill-stats" });
        statsEl.createEl("span", { cls: "llm-bridge-skill-count", text: `×${meta.applyCount}`, attr: { title: `应用 ${meta.applyCount} 次` } });
        statsEl.createEl("span", { cls: "llm-bridge-skill-last", text: formatRelativeTime(meta.lastUsedAt), attr: { title: `最近使用：${meta.lastUsedAt || "未使用"}` } });
      }
      main.addEventListener("click", () => {
        if (isDisabled) {
          new Notice("该 skill 已禁用，请在 Skills 面板勾选启用");
          return;
        }
        this.insertSkillAtCursor(skill);
      });
      // V2.6: 追加按钮（追加 prompt 到输入框末尾，与点击插入光标位置区分）
      const appendBtn = item.createEl("button", {
        cls: "llm-bridge-skill-append-btn",
        text: "+",
        attr: { title: "追加 prompt 到输入框末尾" },
      });
      appendBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isDisabled) {
          new Notice("该 skill 已禁用");
          return;
        }
        this.appendSkillToInput(skill);
      });
      // V2.5: 查看完整 prompt 按钮（所有 skill 可查看）
      const viewBtn = item.createEl("button", {
        cls: "llm-bridge-skill-view-btn",
        text: "👁",
        attr: { title: "查看完整 skill prompt" },
      });
      viewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.viewSkillPrompt(skill);
      });
      // V2.5: 导入的 skill 显示编辑 + 删除按钮（主文件中的 skill 不可编辑/删除）
      if (this.importedSkillNames.has(skill.name)) {
        const editBtn = item.createEl("button", {
          cls: "llm-bridge-skill-edit-btn",
          text: "✎",
          attr: { title: "编辑此导入的 skill（名称/描述/prompt）" },
        });
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.openEditSkillDialog(skill);
        });
        const delBtn = item.createEl("button", {
          cls: "llm-bridge-skill-del-btn",
          text: "×",
          attr: { title: "删除此导入的 skill（仅删除 .llm-bridge/skills/ 下的文件，不影响主文件）" },
        });
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.deleteSkillFromVault(skill.name);
        });
      }
    }
    this.updateSkillsToggle();
    this.updateComboButton();
    } catch (e) {
      this.renderListError(this.skillsListEl, "skills", e);
    }
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

  // V2.6: 排序 skills（置顶最前，组内按 sortBy 排序）
  private sortSkills(skills: Skill[]): Skill[] {
    const withMeta = skills.map((s) => ({ skill: s, meta: getSkillMeta(this.skillsState, s.name) }));
    withMeta.sort((a, b) => {
      // 置顶最前
      const aPinned = a.meta.pinned ? 1 : 0;
      const bPinned = b.meta.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      // 组内排序
      if (this.skillsSortBy === "recent") {
        const aT = a.meta.lastUsedAt ? new Date(a.meta.lastUsedAt).getTime() : 0;
        const bT = b.meta.lastUsedAt ? new Date(b.meta.lastUsedAt).getTime() : 0;
        if (aT !== bT) return bT - aT; // 最近使用在前
      } else if (this.skillsSortBy === "popular") {
        if (a.meta.applyCount !== b.meta.applyCount) return b.meta.applyCount - a.meta.applyCount;
      }
      // 默认按名称（name）
      return a.skill.name.localeCompare(b.skill.name, "zh");
    });
    return withMeta.map((x) => x.skill);
  }

  // V2.6: 切换置顶状态并持久化（V2.7: 节流写入）
  private toggleSkillPinned(skillName: string, pinned: boolean): void {
    this.skillsState = setSkillPinned(this.skillsState, skillName, pinned);
    this.scheduleSkillsStateSave();
    this.renderSkillsList();
  }

  // V2.6: 更新组合应用按钮文案（显示当前勾选数）
  private updateComboButton(): void {
    const btn = this.contentEl.querySelector(".llm-bridge-skills-combo-btn") as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = `组合应用 (${this.skillsComboSet.size})`;
      btn.disabled = this.skillsComboSet.size === 0;
    }
  }

  // V2.6: 插入 skill prompt 到输入框光标位置（替换选区或插入光标处）
  private insertSkillAtCursor(skill: Skill): void {
    if (this.runHandle) return;
    const expanded = expandSkillPrompt(skill.prompt, this.plugin.settings.outputDir);
    if (expanded.length === 0) {
      this.inputEl.focus();
      return;
    }
    const scan = scanSkillPrompt(expanded);
    if (scan.warnings.length > 0) {
      new Notice(`Skill 包含可疑内容：${scan.warnings.join("；")}\n已脱敏后填入，请检查`, 6000);
    }
    const truncated = truncateSkillPrompt(scan.redacted);
    if (truncated.length < scan.redacted.length) {
      new Notice(`Skill prompt 超过 ${MAX_SKILL_PROMPT_LENGTH} 字符，已截断`, 4000);
    }
    // 插入光标位置（替换选区）
    const start = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const end = this.inputEl.selectionEnd ?? this.inputEl.value.length;
    const before = this.inputEl.value.slice(0, start);
    const after = this.inputEl.value.slice(end);
    this.inputEl.value = before + truncated + after;
    // 光标移到插入内容末尾
    const newPos = start + truncated.length;
    this.inputEl.setSelectionRange(newPos, newPos);
    this.inputEl.focus();
    this.trackAppliedSkill(skill.name);
    void this.recordSkillUse(skill.name);
  }

  // V2.6: 追加 skill prompt 到输入框末尾
  private appendSkillToInput(skill: Skill): void {
    if (this.runHandle) return;
    const expanded = expandSkillPrompt(skill.prompt, this.plugin.settings.outputDir);
    if (expanded.length === 0) return;
    const scan = scanSkillPrompt(expanded);
    if (scan.warnings.length > 0) {
      new Notice(`Skill 包含可疑内容：${scan.warnings.join("；")}\n已脱敏后追加，请检查`, 6000);
    }
    const truncated = truncateSkillPrompt(scan.redacted);
    if (truncated.length < scan.redacted.length) {
      new Notice(`Skill prompt 超过 ${MAX_SKILL_PROMPT_LENGTH} 字符，已截断`, 4000);
    }
    const sep = this.inputEl.value.length > 0 && !this.inputEl.value.endsWith("\n") ? "\n\n" : "";
    this.inputEl.value = this.inputEl.value + sep + truncated;
    this.inputEl.scrollTop = this.inputEl.scrollHeight;
    this.inputEl.focus();
    this.trackAppliedSkill(skill.name);
    void this.recordSkillUse(skill.name);
  }

  // V2.6: 应用组合（按勾选顺序拼接 prompt，插入光标位置）
  private applyCombo(): void {
    if (this.runHandle) return;
    if (this.skillsComboSet.size === 0) {
      new Notice("请先勾选要组合的 skill");
      return;
    }
    // 按勾选顺序（skills 列表中的出现顺序）收集
    const orderedNames: string[] = [];
    for (const skill of this.skills) {
      if (this.skillsComboSet.has(skill.name)) {
        orderedNames.push(skill.name);
      }
    }
    // 拼接 prompt
    const parts: string[] = [];
    for (const name of orderedNames) {
      const skill = this.skills.find((s) => s.name === name);
      if (!skill) continue;
      if (this.plugin.settings.disabledSkills.includes(name)) continue;
      const expanded = expandSkillPrompt(skill.prompt, this.plugin.settings.outputDir);
      const scan = scanSkillPrompt(expanded);
      const truncated = truncateSkillPrompt(scan.redacted);
      if (truncated.length > 0) {
        parts.push(truncated);
      }
    }
    if (parts.length === 0) {
      new Notice("勾选的 skill 无可用 prompt（可能已禁用或为空）");
      return;
    }
    const combined = parts.join("\n\n---\n\n");
    // 插入光标位置
    const start = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const end = this.inputEl.selectionEnd ?? this.inputEl.value.length;
    const before = this.inputEl.value.slice(0, start);
    const after = this.inputEl.value.slice(end);
    this.inputEl.value = before + combined + after;
    const newPos = start + combined.length;
    this.inputEl.setSelectionRange(newPos, newPos);
    this.inputEl.focus();
    // 记录组合 + 各 skill 使用（V2.7: 节流写入）
    this.skillsState = recordCombo(this.skillsState, orderedNames);
    for (const name of orderedNames) {
      this.skillsState = recordSkillApplied(this.skillsState, name);
      this.trackAppliedSkill(name);
    }
    this.scheduleSkillsStateSave();
    // 清空勾选
    this.skillsComboSet.clear();
    this.renderSkillsList();
    new Notice(`已组合应用 ${orderedNames.length} 个 skill`);
  }

  // V2.7: 节流写入 skills-state（500ms 内多次操作合并为一次写入，减少 IO）
  private scheduleSkillsStateSave(): void {
    if (this.skillsStateSaveTimer !== null) {
      window.clearTimeout(this.skillsStateSaveTimer);
    }
    this.skillsStateSaveTimer = window.setTimeout(async () => {
      this.skillsStateSaveTimer = null;
      try {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        await saveSkillsState(vaultPath, this.skillsState);
      } catch {
        // 写入失败不阻断主流程
      }
    }, 500);
  }

  // V2.6: 记录单个 skill 使用（更新 applyCount + lastUsedAt 并持久化）
  private recordSkillUse(skillName: string): void {
    this.skillsState = recordSkillApplied(this.skillsState, skillName);
    this.scheduleSkillsStateSave();
  }

  // V2.5: 查看完整 skill prompt（弹窗只读展示）
  private viewSkillPrompt(skill: Skill): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText(`Skill：${skill.name}`);
    modal.contentEl.empty();
    if (skill.description) {
      modal.contentEl.createEl("p", { text: skill.description, cls: "llm-bridge-skill-view-desc" });
    }
    const pre = modal.contentEl.createEl("pre", { cls: "llm-bridge-skill-view-prompt" });
    pre.textContent = skill.prompt || "(无 prompt 内容)";
    const btns = modal.contentEl.createDiv({ cls: "modal-button-container" });
    btns.createEl("button", { text: "关闭" }).addEventListener("click", () => modal.close());
    modal.open();
  }

  // V2.5: 打开编辑 skill 对话框（仅导入的 skill 可编辑）
  private async openEditSkillDialog(skill: Skill): Promise<void> {
    const modal = new EditSkillModal(this.app, skill, async (newName, newDesc, newPrompt) => {
      const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      // 若改名，检查新名称是否冲突
      if (newName !== skill.name) {
        const conflict = await checkImportConflict(vaultPath, newName);
        if (conflict) {
          new Notice(`编辑失败：名称「${newName}」已存在，请换一个名称`);
          return;
        }
      }
      const ok = await updateImportedSkill(vaultPath, skill.name, newName, newDesc, newPrompt);
      if (ok) {
        new Notice(`Skill 已更新`);
        await this.refreshSkills();
      } else {
        new Notice("编辑失败：skill 不在导入目录中或名称冲突");
      }
    });
    modal.open();
  }

  // V2.3: 打开导入 skill 对话框（简单 modal：name / description / prompt）
  // V2.5: 导入前检测冲突，冲突时提示重命名
  private openImportSkillDialog(): void {
    const modal = new ImportSkillModal(this.app, async (name, description, prompt) => {
      const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      // V2.5: 冲突检测
      const conflict = await checkImportConflict(vaultPath, name);
      if (conflict) {
        const renameConfirmed = await this.confirmDialog(
          "Skill 名称冲突",
          `名为「${name}」的导入 skill 已存在。是否仍要导入？\n点击确认将覆盖现有 skill，取消请修改名称后重试。`,
        );
        if (!renameConfirmed) return;
        // 用户确认覆盖：先删除旧的，再导入
        await deleteSkill(vaultPath, name);
      }
      const ok = await importSkillFromText(vaultPath, name, description, prompt);
      if (ok) {
        new Notice(`Skill "${name}" 已导入`);
        await this.refreshSkills();
      } else {
        new Notice(`导入失败：写入文件失败`);
      }
    });
    modal.open();
  }

  // V2.3: 删除导入的 skill
  private async deleteSkillFromVault(skillName: string): Promise<void> {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const ok = await deleteSkill(vaultPath, skillName);
    if (ok) {
      new Notice(`Skill "${skillName}" 已删除`);
      await this.refreshSkills();
    } else {
      new Notice(`删除失败：skill 不在导入目录中`);
    }
  }

  // V2.0: 应用 skill（只做 prompt 增强，插入到输入框，不执行危险操作）
  // V2.1: expandSkillPrompt 替换 {{outputDir}} 占位符
  // V2.3: 进入 prompt 前做敏感扫描和长度截断
  private applySkill(skill: Skill): void {
    if (this.runHandle) return;
    const expanded = expandSkillPrompt(skill.prompt, this.plugin.settings.outputDir);
    if (expanded.length === 0) {
      // 无 prompt 的 skill：清空输入框并聚焦
      this.inputEl.value = "";
      this.inputEl.focus();
      return;
    }
    // V2.3: 敏感扫描
    const scan = scanSkillPrompt(expanded);
    if (scan.warnings.length > 0) {
      new Notice(`Skill 包含可疑内容：${scan.warnings.join("；")}\n已脱敏后填入，请检查`, 6000);
    }
    // V2.3: 长度截断
    const truncated = truncateSkillPrompt(scan.redacted);
    if (truncated.length < scan.redacted.length) {
      new Notice(`Skill prompt 超过 ${MAX_SKILL_PROMPT_LENGTH} 字符，已截断`, 4000);
    }
    this.setInput(truncated);
    // V2.3: 记录已应用 Skill 名称（用于状态栏展示）
    this.trackAppliedSkill(skill.name);
  }

  // V2.1: 切换 skill 启用/禁用状态（持久化到 settings.disabledSkills）
  private async toggleSkillEnabled(name: string, enabled: boolean): Promise<void> {
    const set = new Set(this.plugin.settings.disabledSkills);
    if (enabled) set.delete(name);
    else set.add(name);
    this.plugin.settings.disabledSkills = Array.from(set);
    await this.plugin.saveSettings();
    this.renderSkillsList();
  }

  // V2.1: 写入默认 skills 模板（不覆盖已存在文件）并刷新
  private async seedDefaults(): Promise<void> {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    await seedDefaultSkills(vaultPath);
    await this.refreshSkills();
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
    // 自动展开运行流程区
    this.runFlowBody.removeAttribute("hidden");
    this.runFlowToggle.textContent = "▼ 运行流程";

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
    // 自动展开
    this.runFlowBody.removeAttribute("hidden");
    this.runFlowToggle.textContent = "▼ 运行流程";

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
    // V2.3: 发送后重置已应用 Skills 计数（输入框将被清空）
    this.resetAppliedSkills();
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

    // 构造 AgentTask 并通过 AgentBackend 启动
    const task: AgentTask = {
      id: assistantId,
      userMessage: userInput,
      prompt,
      cwd: vaultPath,
      createdAt: new Date().toISOString(),
      includeActiveNote: settings.includeActiveNote,
      includeSelection: settings.includeSelection,
    };

    this.runHandle = this.getBackend().run(task, settings, (event) => {
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
        // 静默刷新历史列表（若已展开）
        void this.refreshHistory();
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
    new Notice("文件尚未被 Obsidian 索引，请稍后重试。");
  }
}

// V2.3: 导入 Skill 对话框（name / description / prompt 三字段）
class ImportSkillModal extends Modal {
  private resolved = false;
  constructor(
    app: import("obsidian").App,
    private onConfirm: (name: string, description: string, prompt: string) => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText("导入 Skill");
    this.contentEl.empty();
    const form = this.contentEl.createEl("div", { cls: "llm-bridge-import-skill-form" });
    // name
    form.createEl("label", { text: "Skill 名称", cls: "llm-bridge-import-label" });
    const nameInput = form.createEl("input", { type: "text", cls: "llm-bridge-import-input", attr: { placeholder: "如：翻译选区" } });
    // description
    form.createEl("label", { text: "简短描述", cls: "llm-bridge-import-label" });
    const descInput = form.createEl("input", { type: "text", cls: "llm-bridge-import-input", attr: { placeholder: "如：将选中文本翻译为英文" } });
    // prompt
    form.createEl("label", { text: "Prompt 模板（支持 {{outputDir}} 占位符）", cls: "llm-bridge-import-label" });
    const promptArea = form.createEl("textarea", { cls: "llm-bridge-import-textarea", attr: { rows: "6", placeholder: "请将以上选中文本翻译为英文，并通过 replace_selection action 写回原选区位置。" } });
    // 按钮
    const btns = form.createDiv({ cls: "modal-button-container" });
    const cancel = btns.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.done(false));
    const confirm = btns.createEl("button", { text: "导入", cls: "mod-warning" });
    confirm.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        new Notice("请输入 skill 名称");
        return;
      }
      this.done(true);
    });
    nameInput.focus();
  }
  onClose(): void {
    if (!this.resolved) this.done(false);
    this.contentEl.empty();
  }
  private done(ok: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    if (ok) {
      const nameInput = this.contentEl.querySelector("input[type='text']") as HTMLInputElement;
      const descInput = this.contentEl.querySelectorAll("input[type='text']")[1] as HTMLInputElement;
      const promptArea = this.contentEl.querySelector("textarea") as HTMLTextAreaElement;
      const name = nameInput?.value.trim() || "";
      const description = descInput?.value.trim() || "";
      const prompt = promptArea?.value || "";
      void this.onConfirm(name, description, prompt);
    }
    this.close();
  }
}

// V2.5: 编辑导入的 skill 对话框（预填充原 name/description/prompt）
class EditSkillModal extends Modal {
  private resolved = false;
  private nameInput!: HTMLInputElement;
  private descInput!: HTMLInputElement;
  private promptArea!: HTMLTextAreaElement;

  constructor(
    app: import("obsidian").App,
    private skill: Skill,
    private onConfirm: (name: string, description: string, prompt: string) => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(`编辑 Skill：${this.skill.name}`);
    this.contentEl.empty();
    const form = this.contentEl.createEl("div", { cls: "llm-bridge-import-skill-form" });
    form.createEl("label", { text: "Skill 名称（修改即重命名）", cls: "llm-bridge-import-label" });
    this.nameInput = form.createEl("input", {
      type: "text",
      cls: "llm-bridge-import-input",
      attr: { placeholder: "如：翻译选区" },
    }) as HTMLInputElement;
    this.nameInput.value = this.skill.name;
    form.createEl("label", { text: "简短描述", cls: "llm-bridge-import-label" });
    this.descInput = form.createEl("input", {
      type: "text",
      cls: "llm-bridge-import-input",
      attr: { placeholder: "如：将选中文本翻译为英文" },
    }) as HTMLInputElement;
    this.descInput.value = this.skill.description || "";
    form.createEl("label", { text: "Prompt 模板（支持 {{outputDir}} 占位符）", cls: "llm-bridge-import-label" });
    this.promptArea = form.createEl("textarea", {
      cls: "llm-bridge-import-textarea",
      attr: { rows: "8", placeholder: "请将以上选中文本翻译为英文..." },
    }) as HTMLTextAreaElement;
    this.promptArea.value = this.skill.prompt || "";
    const btns = form.createDiv({ cls: "modal-button-container" });
    const cancel = btns.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.done(false));
    const confirm = btns.createEl("button", { text: "保存", cls: "mod-warning" });
    confirm.addEventListener("click", () => {
      const name = this.nameInput.value.trim();
      if (!name) {
        new Notice("请输入 skill 名称");
        return;
      }
      this.done(true);
    });
    this.nameInput.focus();
  }
  onClose(): void {
    if (!this.resolved) this.done(false);
    this.contentEl.empty();
  }
  private done(ok: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    if (ok) {
      const name = this.nameInput.value.trim();
      const description = this.descInput.value.trim();
      const prompt = this.promptArea.value;
      void this.onConfirm(name, description, prompt);
    }
    this.close();
  }
}
