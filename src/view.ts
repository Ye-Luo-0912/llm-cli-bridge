// LLM CLI Bridge — 右侧 Chat View（Codex / Claude Code 风格紧凑工作台）

import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type LLMBridgePlugin from "../main";
import { buildPrompt } from "./prompt";
import { ClaudeCliBackend } from "./claudeCliBackend";
import { MockAgentBackend } from "./mockAgentBackend";
import { AgentBackend, AgentRunHandle, AgentTask } from "./agentBackend";
import { exportState } from "./state";
import { AgentType, BackendMode, ChatMessage, RunResult, RunStatus, SessionMode } from "./types";
import type { PendingActionEntry } from "./httpServer";

export const VIEW_TYPE_LLM_BRIDGE = "llm-cli-bridge-view";

interface FileSnapshot {
  path: string;
  mtime: number;
  size: number;
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

  // DOM
  private statusDotEl!: HTMLElement;
  private statusLabelEl!: HTMLElement;
  private activeFileLabelEl!: HTMLElement;
  private selectionLabelEl!: HTMLElement;
  private agentChipGroup!: HTMLElement;
  private agentChipTextEl!: HTMLElement;
  private modeChipGroup!: HTMLElement;
  private modelChipGroup!: HTMLElement;
  private effortChipGroup!: HTMLElement;
  private includeNoteCheckEl!: HTMLInputElement;
  private includeSelectionCheckEl!: HTMLInputElement;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;
  private pendingActionsEl!: HTMLElement;
  private pendingActionsCountEl!: HTMLElement;
  private pendingActionsBody!: HTMLElement;

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

    // ===== 消息流 =====
    this.messagesEl = root.createDiv({ cls: "llm-bridge-messages" });
    this.renderEmptyState();

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
    this.modeChipGroup = this.buildChipGroup(chipsRow, MODE_OPTIONS, () => this.plugin.settings.sessionMode, async (v) => {
      if (v !== "fresh") {
        new Notice("本轮只启用 Fresh 模式");
        this.refreshAllChips();
        return;
      }
      this.plugin.settings.sessionMode = v as SessionMode;
      await this.plugin.saveSettings();
    });

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

    // 清空按钮放最右
    this.clearBtn = chipsRow.createEl("button", {
      cls: "llm-bridge-chip-ghost",
      text: "Clear",
      attr: { title: "清空消息" },
    });
    this.clearBtn.addEventListener("click", () => this.clearMessages());

    // 初始化
    this.syncControlsFromSettings();
    this.updateContextDisplay();
    this.setGlobalStatus("idle");

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateContextDisplay()));

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
    this.pendingActionsBody.empty();

    if (count === 0) return;

    for (const entry of this.pendingActions) {
      const item = this.pendingActionsBody.createDiv({ cls: "llm-bridge-pending-item" });
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
      // 按钮行
      const btnRow = item.createDiv({ cls: "llm-bridge-pending-btns" });
      const approveBtn = btnRow.createEl("button", {
        cls: "llm-bridge-pending-btn-approve",
        text: "✓ Approve",
      });
      approveBtn.addEventListener("click", () => {
        bridge.approvePendingAction(entry.id);
        this.pendingActions = this.pendingActions.filter((a) => a.id !== entry.id);
        this.refreshPendingActions();
      });
      const rejectBtn = btnRow.createEl("button", {
        cls: "llm-bridge-pending-btn-reject",
        text: "✗ Reject",
      });
      rejectBtn.addEventListener("click", () => {
        bridge.rejectPendingAction(entry.id);
        this.pendingActions = this.pendingActions.filter((a) => a.id !== entry.id);
        this.refreshPendingActions();
      });
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
    this.refreshCycleChip(this.modeChipGroup, MODE_OPTIONS, this.plugin.settings.sessionMode);

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
    const s = this.plugin.settings;
    if (s.agentType === "claude") return `${s.claudeCommand} ${s.claudeArgs}`.trim();
    if (s.agentType === "codex") return `${s.codexCommand} ${s.codexArgs}`.trim();
    return `${s.customCommand} ${s.customArgs}`.trim();
  }

  // ---------- 消息渲染 ----------

  private renderEmptyState(): void {
    this.messagesEl.empty();
    this.messagesEl.createDiv({ cls: "llm-bridge-empty", text: "Ask Claude Code about this vault." });
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
  }

  // stderr / log / 生成文件，默认折叠；失败或有新文件时显著
  private appendMsgDetails(block: HTMLElement, msg: ChatMessage): void {
    const details = block.createDiv({ cls: "llm-bridge-msg-details" });
    const failed = msg.status === "failed";

    if (msg.stderr) {
      const startOpen = failed;
      this.appendCollapsible(details, "stderr", msg.stderr, "llm-bridge-stderr-text", startOpen, failed);
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

    this.beforeFiles = await this.snapshotVaultMarkdownFiles(vaultPath);
    const prompt = buildPrompt(userInput, settings);

    // 渲染用户消息 + assistant 占位
    this.appendUserMessage(userInput);
    const assistantId = this.appendAssistantPlaceholder();
    this.inputEl.value = "";

    this.setGlobalStatus("running");
    this.updateAssistantMessage(assistantId, {
      log: `$ ${this.commandLine()}\ncwd: ${vaultPath}\nprompt 通过 stdin 传入（${prompt.length} 字符）`,
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
          const msg = this.messages.find((m) => m.id === assistantId);
          if (msg) {
            this.updateAssistantMessage(assistantId, { content: msg.content + event.data });
          }
          break;
        }
        case "stderr_delta": {
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
          void this.onRunFinished(result, vaultPath, assistantId, event.type);
          break;
        }
      }
    });
  }

  private stop(): void {
    if (this.runHandle) {
      this.runHandle.stop();
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
  ): Promise<void> {
    this.runHandle = null;

    const msg = this.messages.find((m) => m.id === assistantId);
    const newLog = (msg?.log || "") +
      `\nexit code: ${result.exitCode ?? "null"}  signal: ${result.signal ?? "-"}\nduration: ${result.durationMs} ms`;
    // V0.3: backend 终态 stderr 已是用户可见摘要，直接覆盖（不再增量拼接）
    // 详细诊断日志已写入 .llm-bridge/logs/debug-*.log
    const newStderr = this.plugin.settings.showStderr ? (result.stderr || "") : "";

    this.setGlobalStatus(status);
    this.updateAssistantMessage(assistantId, {
      status,
      stderr: newStderr,
      log: newLog,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });

    if (this.plugin.settings.saveLogs) {
      try {
        await this.saveLogFile(result, vaultPath);
      } catch {
        /* 忽略 */
      }
    }

    await new Promise((r) => setTimeout(r, 300));
    const newFiles = await this.diffVaultMarkdownFiles(vaultPath);
    if (newFiles.length > 0) {
      this.updateAssistantMessage(assistantId, { generatedFiles: newFiles });
    }
  }

  // ---------- 日志保存 ----------

  private async saveLogFile(result: RunResult, vaultPath: string): Promise<void> {
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
  }

  // ---------- 文件检测 ----------

  // 运行前快照：排除 .obsidian/.llm-bridge/node_modules/.git/LLM-AgentRuntime/dist/build 等目录
  private async snapshotVaultMarkdownFiles(vaultPath: string): Promise<Map<string, FileSnapshot>> {
    const excludeDirs = [".obsidian", ".llm-bridge", "node_modules", ".git", "LLM-AgentRuntime", "dist", "build"];
    const out = new Map<string, FileSnapshot>();
    const stack: string[] = [vaultPath];
    while (stack.length > 0) {
      const current = stack.pop()!;
      try {
        const entries = await fs.promises.readdir(current, { withFileTypes: true });
        for (const e of entries) {
          const fullPath = path.join(current, e.name);
          const rel = path.relative(vaultPath, fullPath).replace(/\\/g, "/");
          if (e.isDirectory()) {
            const name = e.name.toLowerCase();
            if (!excludeDirs.includes(name)) {
              stack.push(fullPath);
            }
          } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
            try {
              const stat = await fs.promises.stat(fullPath);
              out.set(rel, { path: rel, mtime: stat.mtimeMs, size: stat.size });
            } catch {
              /* stat 失败跳过 */
            }
          }
        }
      } catch {
        /* 目录不存在或无权限 */
      }
    }
    return out;
  }

  private async diffVaultMarkdownFiles(vaultPath: string): Promise<string[]> {
    const after = await this.snapshotVaultMarkdownFiles(vaultPath);
    const result: string[] = [];
    for (const [rel, snap] of after) {
      const beforeSnap = this.beforeFiles.get(rel);
      if (!beforeSnap) {
        result.push(rel + "  [NEW]");
      } else if (snap.mtime !== beforeSnap.mtime || snap.size !== beforeSnap.size) {
          result.push(rel + "  [MODIFIED]");
        }
    }
    return result.sort((a, b) => a.localeCompare(b));
  }

  private async openGeneratedFile(displayPath: string): Promise<void> {
    const relPath = displayPath.replace(/\s+\[(NEW|MODIFIED)\]$/, "");
    const file = this.app.vault.getAbstractFileByPath(relPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(file);
      return;
    }
    new Notice("文件尚未被 Obsidian 索引，请稍后重试。");
  }
}
