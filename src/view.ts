// LLM CLI Bridge — 右侧 Chat View（Codex / Claude Code 风格紧凑工作台）

import { App, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, normalizePath, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type LLMBridgePlugin from "../main";
import { SdkImageContentBlock, SdkStreamingInput } from "./agentBackend";
import { extractRelPath } from "./fileDiff";
import { AgentType, ChatMessage, EffectiveRunPlan, RunStatus } from "./types";
import type { LLMBridgeSettings } from "./types";
import type { PendingActionEntry } from "./httpServer";
import { PreflightResult } from "./agentProfile";
import { mapPreflightToStatus } from "./preflightStatus";
import { buildFirstUseGuide, shouldShowFirstUseGuide } from "./firstUseGuide";
import { timelineTypeClass, timelineTypeLabel, TimelineEventType } from "./runTimeline";
import { buildCommandLine } from "./commandProfile";
import { workflowStageLabel, workflowStageClass, WorkflowTraceStage } from "./workflowTrace";
import { formatEffectiveRunPlan } from "./effectiveRunPlan";
import { type BridgeSessionImpl } from "./runtime/core/bridgeSession";
import type { BridgeSession, RunInput, NormalizedRuntimeEvent, ApprovalResponse, UserInputQuestion, UserInputResponse, UserInputRequestSegment, AssistantTurnView, TurnTimelineNode, NativeSessionRef, StateSnapshot } from "./runtime/core/types";
import { buildBridgePromptPackage } from "./runtime/core/promptPackage";
import { getToolIconCategory, getPhaseIconName, explainAutoApprovalSource, approvalDisplayLabel, toolDisplayLabel, type AgentRunDisplayModel, type AgentRunCard, type AgentRunDebugView } from "./runtime/core/agentRunDisplayModel";
import { getActiveProvider, readProviderForm, setActiveProvider } from "./runtime/config/runtimeRouter";
import { resolveUiLocale, type Locale } from "./runtime/core/toolPresentation";
import { formatCodexRunValue, type CodexRunFeedItem, type CodexRunStepGroup, type CodexRunViewModel } from "./runtime/core/codexRunViewModel";
import type { RunPhase, RunPhaseModel } from "./runtime/core/runPhaseModel";
import { type ProviderCapabilityInfo, type ObsidianCliAvailability, type ProviderRuntimeSkillEntry } from "./runtime/core/bridgePromptContract";
import type { ManagedRuntimeInstallStatus } from "./runtime/providers/codex-managed-app-server/codexManagedRuntimeInstallerBridge";
import { listManagedCodexPluginsAsync, type CodexManagedPluginCatalog, type CodexManagedPluginEntry } from "./runtime/providers/codex-managed-app-server/codexManagedPluginCatalog";
import { RunSessionController, type RunSessionHost } from "./runtime/RunSessionController";
import { getRuntimeModelCatalogForAgent, setRuntimeModelCatalogForAgent, normalizeModelValue, normalizeEffortValue, getEffortsForModel, getDefaultEffortForModel, type ModelCatalogEntry, type RuntimeModelCatalog } from "./runtimeModelCatalog";
import { loadCodexRuntimeCapabilitySnapshot } from "./runtime/providers/codex-managed-app-server/codexManagedModelCatalog";
import { WorkflowEvent, PermissionEvent, truncateText, redactSecrets } from "./workflowEvent";
import { computeTimelineStats, formatCompletedSummary, formatFailedSummary, extractToolPath, extractToolParams, pathBasename, countLines, isInternalFilePath, type TimelineNode, type TimelineNodeKind } from "./timelineAdapter";
import { RunStateAggregator, aggregateEventsToTimeline } from "./runtimeTranscript";
import { computeContextMetrics, formatTokens, formatCompressionRatio, type ContextMetrics, type CompressionInfo } from "./contextMetrics";
import { SessionState, createNewSession, sessionStatusClass, updateSession } from "./session";
import {
  PersistedSession,
  SessionListItem,
  listSessions,
  loadSession,
  deleteSessionWithProviderArtifacts,
  clearSessionsWithProviderArtifacts,
  renameSession,
} from "./sessions";
import {
  AgentSkillRecord,
  loadAgentSkillsManifest,
  prepareAgentSkillsForCodexRuntime,
  saveAgentSkillsManifest,
} from "./agentSkills";
import {
  VAULT_SKILL_SOURCE_REL,
  VAULT_SKILL_UPDATE_LOG_REL,
} from "./agentRuntimeWorkspace";
import {
  buildMessagePresentation,
  NAV_TAB_LABELS,
  type MessagePresentation,
  type MessageActionId,
} from "./messagePresentation";
import { normalizeToolName, type PermissionChoice } from "./sdkPermission";
import {
  getAgentApprovalProfileInfo,
  isAgentApprovalProfile,
  mapAgentApprovalProfileToClaudePermissionMode,
  migrateLegacyPermissionToApprovalProfile,
  type AgentApprovalProfile,
} from "./agentApprovalProfile";
import {
  reconcileCodexRunWaterfall as reconcileCodexRunWaterfallDom,
  upgradeCodexCandidateAnswerInFeed as upgradeCodexCandidateAnswerInFeedDom,
  renderCodexFeedItem as renderCodexFeedItemDom,
  type CodexWaterfallPatchDeps,
  type CodexFeedItemRenderDeps,
} from "./ui/codexWaterfallRenderer";
import {
  mountOrReconcileCodexRun,
  type CodexRunRenderDeps,
} from "./ui/codexRunRenderer";
import {
  renderMessage as renderMessageDom,
  renderMessageContent as renderMessageContentDom,
  renderMessageActions as renderMessageActionsDom,
  flattenTurnTimelineNodes,
  renderMessageFileRefs as renderMessageFileRefsDom,
  appendMsgDetails as appendMsgDetailsDom,
  applyAssistantMessagePresentationChrome as applyAssistantMessagePresentationChromeDom,
  type MessageRendererDeps,
  type MessageDetailsDeps,
} from "./ui/messageRenderer";
import {
  autoGrowInput as autoGrowInputDom,
  shortAttachmentName as shortAttachmentNameDom,
  createComposerMenuItem as createComposerMenuItemDom,
  refreshPermissionModeChip as refreshPermissionModeChipDom,
  refreshModelEffortPickerLabels as refreshModelEffortPickerLabelsDom,
  renderComposerFileRefs as renderComposerFileRefsDom,
  renderComposerAttachmentToken as renderComposerAttachmentTokenDom,
  applyComposerStatusRail as applyComposerStatusRailDom,
  bindComposerFileDragSurface as bindComposerFileDragSurfaceDom,
  isEventInsideSelector as isEventInsideSelectorDom,
  ComposerController,
  type ComposerHost,
  type ComposerMenuItemOptions,
  type ComposerStatusRailState,
} from "./ui/composerController";
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
import { FileToolExecutionRequest, FileToolResult, executeFileTool } from "./fileToolExecutor";
import { AgentFileToolRouteRequest, AgentFileToolRouteResult, executeAgentFileToolRoute as routeAgentFileTool } from "./agentFileToolBridge";
import {
  shouldPersistLargeClipboardText,
} from "./clipboardPastePolicy";

export const VIEW_TYPE_LLM_BRIDGE = "llm-cli-bridge-view";
// AgentSkillDocumentView 已抽取到 ./ui/agentSkillDocumentView（渐进拆分 P0）
export { AgentSkillDocumentView, VIEW_TYPE_AGENT_SKILL_DOCUMENT } from "./ui/agentSkillDocumentView";
import { VIEW_TYPE_AGENT_SKILL_DOCUMENT } from "./ui/agentSkillDocumentView";
// SmartImageThumbnail 纯 Canvas 算法已抽取到 ./ui/smartImageThumbnail（渐进拆分 P0）
import {
  SmartImageThumbnailCache,
  getSmartImageThumbnailCacheKey,
  maybeApplySmartImageThumbnail,
} from "./ui/smartImageThumbnail";
// Agent Skills 面板渲染已抽取到 ./ui/agentSkillsPanel（渐进拆分 P1）
import {
  renderAgentSkillsList as renderAgentSkillsListDom,
  renderAgentSkillItem as renderAgentSkillItemDom,
} from "./ui/agentSkillsPanel";
// History 面板渲染已抽取到 ./ui/historyPanel（渐进拆分 P1）
import {
  renderHistoryList as renderHistoryListDom,
  formatHistoryTime as formatHistoryTimeFn,
} from "./ui/historyPanel";
// FileRef 元数据工具已抽取到 ./ui/fileRefMetaUtil（渐进拆分 P4）
import {
  fileTypeIconName as fileTypeIconNameFn,
  getFileRefIconName as getFileRefIconNameFn,
  shortLabelForPath as shortLabelForPathFn,
  getFileRefShortLabel as getFileRefShortLabelFn,
  imageMimeTypeForPath as imageMimeTypeForPathFn,
} from "./ui/fileRefMetaUtil";
// 附件摄入服务（路径提取 + blob 落盘）已抽取到 ./ui/attachmentIngestionService（渐进拆分 P3 batch 7）
import {
  collectFilePathsFromClipboardEvent as collectFilePathsFromClipboardEventFn,
  hasNonTextClipboardFileBlob as hasNonTextClipboardFileBlobFn,
  collectPathsAndCacheBlobsFromFileList as collectPathsAndCacheBlobsFromFileListFn,
  cachePathlessFilesFromFileList as cachePathlessFilesFromFileListFn,
  persistClipboardTextToVault as persistClipboardTextToVaultFn,
  persistElectronClipboardImageToVault as persistElectronClipboardImageToVaultFn,
  type AttachmentVaultWriter,
} from "./ui/attachmentIngestionService";
// 剪贴板/拖拽文件路径提取已抽取到 ./ui/clipboardPathExtractor（渐进拆分 P3）
import {
  parseFileUriToPath as parseFileUriToPathFn,
  collectFilePathsFromDataTransfer as collectFilePathsFromDataTransferFn,
} from "./ui/clipboardPathExtractor";
// Timeline 工具函数已抽取到 ./ui/timelineUtil（渐进拆分 P2-B）
import {
  formatDurationMs as formatDurationMsFn,
  formatProcessSummary as formatProcessSummaryFn,
  getToolIconAndCategory as getToolIconAndCategoryFn,
  filterUserFacingTimelineNodes as filterUserFacingTimelineNodesFn,
} from "./ui/timelineUtil";
// AgentRun 卡片渲染辅助已抽取到 ./ui/agentRunCardHelpers（渐进拆分 P2-A）
import {
  toolDisplayLabelForPhase as toolDisplayLabelForPhaseFn,
  renderCollapsedText as renderCollapsedTextFn,
  renderCollapsedJson as renderCollapsedJsonFn,
  renderSourceRefDetail as renderSourceRefDetailFn,
} from "./ui/agentRunCardHelpers";
// AgentRun 卡片渲染器已抽取到 ./ui/agentRunCardRenderer（渐进拆分 P2-A）
import {
  renderAgentRunCard as renderAgentRunCardFn,
  renderThinkingCard as renderThinkingCardFn,
  renderToolCallCard as renderToolCallCardFn,
  renderFileChangeCard as renderFileChangeCardFn,
  renderApprovalCard as renderApprovalCardFn,
  renderUserInputCard as renderUserInputCardFn,
  renderWarningCard as renderWarningCardFn,
  renderErrorCard as renderErrorCardFn,
} from "./ui/agentRunCardRenderer";
// Context ref chip 渲染已抽取到 ./ui/contextRefChips（渐进拆分 P4）
import {
  renderPinnedContext as renderPinnedContextDom,
  renderFilesContext as renderFilesContextDom,
  renderFileContextSection as renderFileContextSectionDom,
  renderContextRefChip as renderContextRefChipDom,
  renderContextRefVisual as renderContextRefVisualDom,
  fileRefBadgeLabel as fileRefBadgeLabelFn,
  type ContextRefChipDeps,
} from "./ui/contextRefChips";
// External read 面板渲染已抽取到 ./ui/externalReadPanel（渐进拆分 P4）
import {
  renderExternalReadTarget as renderExternalReadTargetDom,
  renderExternalReadField as renderExternalReadFieldDom,
  externalReadReasonLabel as externalReadReasonLabelFn,
} from "./ui/externalReadPanel";
// Live timeline 渲染已抽取到 ./ui/liveTimelineRenderer（渐进拆分 P2-C）
import {
  renderLiveTimeline as renderLiveTimelineDom,
  appendSdkWorkflow as appendSdkWorkflowDom,
  renderTimelineNode as renderTimelineNodeDom,
  type LiveTimelineRendererDeps,
} from "./ui/liveTimelineRenderer";
// File preview modal 渲染已抽取到 ./ui/filePreviewOpener（渐进拆分 P4）
import {
  renderFilePreviewModalContent as renderFilePreviewModalContentFn,
  readFileRefPreviewText as readFileRefPreviewTextFn,
  type FilePreviewOpenerDeps,
} from "./ui/filePreviewOpener";
// Composer runtime tools 能力闭环已抽取到 ./ui/composerRuntimeCapabilitiesView（渐进拆分 P3）
import {
  renderComposerRuntimeToolsList as renderComposerRuntimeToolsListFn,
  renderComposerRuntimeCapabilityChips as renderComposerRuntimeCapabilityChipsFn,
  toggleComposerRuntimeCapability as toggleComposerRuntimeCapabilityFn,
  useComposerManagedCodexPlugin as useComposerManagedCodexPluginFn,
  useComposerAgentSkill as useComposerAgentSkillFn,
  buildUserInputWithRuntimeCapabilityHints as buildUserInputWithRuntimeCapabilityHintsFn,
  composerToolVisualKey as composerToolVisualKeyFn,
  describeComposerManagedCodexPlugin as describeComposerManagedCodexPluginFn,
  type ComposerRuntimeCapabilitySelection,
  type ComposerRuntimeCapabilitiesViewDeps,
} from "./ui/composerRuntimeCapabilitiesView";

interface UserInputDraft {
  value: string;
  supplement: string;
  selections: Record<string, string | string[]>;
  customInputs: Record<string, string>;
  optionPages: Record<string, number>;
  stepIndex: number;
}

// V18-APPEND: AppendTimelineItem 接口已删除，追加节点直接用 TurnTimelineNode

const USER_INPUT_OPTIONS_PER_PAGE = 6;

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
  /**
   * RunSessionController owns the run lifecycle: session creation, run/stop,
   * watchdog, normalized event processing, run completion, and runtime install.
   * view.ts accesses run state through this.runSession.* getters.
   */
  private runSession!: RunSessionController;
  /** P3: 当前会话是否为恢复的历史会话（true=恢复，false=fresh）。用于 UI 标注"恢复的会话"。 */
  private sessionResumed: boolean = false;
  /** V2.16-B: 实际 runtime 标签（供 UI 显示，区分 auto→SDK / auto→CLI fallback）。
   *  默认 Codex（与默认 active provider / 托管 runtime 一致），首帧 refreshStatusBar 后由 session.displayLabel 覆盖。 */
  private actualRuntimeLabel: string = "Codex";
  private messages: ChatMessage[] = [];
  private currentAssistantId: string | null = null;
  /**
   * V2.17-A: 实时运行状态聚合器（替代 liveTimelineEvents 数组）
   * - 单 thinking block / tool_progress 合并 / 无重复 final message
   * - 历史消息渲染用 aggregateEventsToTimeline(events) 一次性构建
   */
  private liveAggregator: RunStateAggregator = new RunStateAggregator();
  // V18-APPEND: appendTimelineItems 已删除，追加节点直接进入 turnBuilder 的统一时间线
  /** V17-RESUME-DEGRADED: Resume 降级持久状态（thread/resume 失败后 fallback 到新 session） */
  private resumeDegradedEl: HTMLElement | null = null;
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
  // V20.12: Runtime skills/list 发现的 skill name 集合（由 getCachedSkills 同步读取）
  private runtimeDiscoveredSkillNames: Set<string> = new Set();
  private agentSkillsToggleEl!: HTMLElement;
  private agentSkillsToggleChevronEl!: HTMLElement;
  private agentSkillsToggleCountEl!: HTMLElement;
  private agentSkillsBodyEl!: HTMLElement;
  private agentSkillsListEl!: HTMLElement;
  private managedCodexPlugins: ReadonlyArray<CodexManagedPluginEntry> = [];
  private managedCodexPluginCatalog: CodexManagedPluginCatalog | null = null;
  private managedCodexPluginsListEl!: HTMLElement;
  /** P0: Codex Skills 物化去重缓存（同 vault 连续发送不重复全量物化） */
  private codexSkillPrepCache: { vaultPath: string; preparedAt: number; ok: boolean; reason?: string } | null = null;
  private codexSkillPrepInFlight: Promise<{ ok: boolean; reason?: string }> | null = null;
  private vaultContextStatusEl: HTMLElement | null = null;
  /** P0: managed plugin 列表刷新去重 */
  private managedPluginsRefreshInFlight: Promise<void> | null = null;
  private managedPluginsRefreshedAt = 0;
  private selectedRuntimeCapabilities: ComposerRuntimeCapabilitySelection[] = [];
  private composerRuntimeCapabilitiesEl!: HTMLElement;
  // V2.9: scrollToBottom rAF 批处理定时器（合并同帧多次调用，避免每个 delta 触发 reflow）
  private scrollRafId: number | null = null;
  private streamContentRafId: number | null = null;
  private streamContentAssistantId: string | null = null;
  /** 流式期间工具/授权/文件变化的批处理刷新（150–250ms） */
  private streamDetailsTimerId: number | null = null;
  private streamDetailsAssistantId: string | null = null;
  /** Composer popup 状态控制器（互斥 / outside-click / mention / 附件选择） */
  private composerController!: ComposerController;
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
  private historyBulkbarEl!: HTMLElement;
  private historySelectAllEl!: HTMLInputElement;
  private historyDeleteSelectedBtn!: HTMLButtonElement;
  private selectedHistorySessionIds = new Set<string>();
  // V2.5: 当前活动会话 id（保存后赋值；用于后续运行更新同一会话文件）
  private currentSessionId: string | null = null;

  // DOM
  private statusDotEl!: HTMLElement;
  private statusLabelEl!: HTMLElement;
  private runtimeInstallBtnEl!: HTMLButtonElement;
  /** V17-TOPBAR-2ROW: 第二排审查/压缩按钮（仅 Codex app-server 显示） */
  private reviewBtn!: HTMLButtonElement;
  private compactBtn!: HTMLButtonElement;
  private activeFileLabelEl!: HTMLElement;
  private selectionLabelEl!: HTMLElement;
  private agentChipGroup!: HTMLElement;
  private agentChipTextEl!: HTMLElement;
  private modelChipGroup!: HTMLElement;
  private effortChipGroup!: HTMLElement;
  private modelEffortPickerEl!: HTMLElement;
  private modelEffortButtonEl!: HTMLButtonElement;
  private modelOptionsEl!: HTMLElement;
  private effortOptionsEl!: HTMLElement;
  /** V2.16-C: 运行时模型目录（不再硬编码） */
  private modelCatalog: RuntimeModelCatalog = getRuntimeModelCatalogForAgent("claude");
  private modelCatalogRefreshTimer: number | null = null;
  private permissionModePickerEl!: HTMLElement;
  private permissionModeChipEl!: HTMLButtonElement;
  private includeNoteCheckEl!: HTMLInputElement;
  private includeSelectionCheckEl!: HTMLInputElement;
  private messagesEl!: HTMLElement;
  private scrollBottomBtnEl!: HTMLElement;
  private scrollBottomAnchorEl!: HTMLElement;
  // V2.15-A: Chat shell 页面分区。Files 只展示 refs/approval 状态，不执行文件 runtime。
  private tabPanels!: { chat: HTMLElement; files: HTMLElement; skills: HTMLElement; history: HTMLElement };
  private activeTab: "chat" | "files" | "skills" | "history" = "chat";
  private pageTitleEl!: HTMLElement;
  // V2.7: 长会话旧消息折叠（false=折叠显示最近 N 条；true=展开全部）
  private messagesFoldExpanded = false;
  private inputEl!: HTMLTextAreaElement;
  private composerEl!: HTMLElement;
  private composerBarEl!: HTMLElement;
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
  private smartImageThumbnailCache = new SmartImageThumbnailCache();
  private fileInlinePreviewCache = new Map<string, string | null>();
  private attachmentFileInputEl!: HTMLInputElement;
  private pinnedContextEl!: HTMLElement;
  private composerFileRefsEl!: HTMLElement;
  private filesContextEl!: HTMLElement;
  private filePreviewModal: Modal | null = null;
  private lastActiveMarkdownFile: TFile | null = null;
  // V2.16-D: Context metrics UI 元素
  private contextRingEl!: HTMLElement;
  private contextTipEl!: HTMLElement;
  private contextTipPctEl!: HTMLElement;
  private contextTipTokensEl!: HTMLElement;
  private contextLabelEl!: HTMLElement;
  private contextDetailEl!: HTMLElement;
  /** Codex thread/tokenUsage/updated 最新快照；ring 只吃这份数据 */
  private lastRuntimeTokenUsage: { usedTokens: number; contextWindow: number | null; updatedAt: string } | null = null;
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

    this.composerController = new ComposerController(this.buildComposerHost());

    const shell = root.createDiv({ cls: "llm-bridge-shell" });
    const nav = shell.createDiv({ cls: "llm-bridge-nav-rail" });

    const main = shell.createDiv({ cls: "llm-bridge-main" });

    // ===== V17-TOPBAR-2ROW: 顶部栏两排布局（item 8）=====
    // 第一排：会话 selector + 新聊天
    // 第二排：审查/压缩 + 设置 + runtime 状态
    const header = main.createDiv({ cls: "llm-bridge-header llm-bridge-topbar" });

    // --- 第一排 ---
    const topbarRow1 = header.createDiv({ cls: "llm-bridge-topbar-row" });
    const topbarBrand = topbarRow1.createDiv({ cls: "llm-bridge-topbar-brand" });
    const topbarLogo = topbarBrand.createEl("span", { cls: "llm-bridge-topbar-logo" });
    setIcon(topbarLogo, "message-square");
    this.pageTitleEl = topbarBrand.createEl("span", { cls: "llm-bridge-page-title", text: "Chat" });
    const sessionPreview = topbarRow1.createEl("button", {
      cls: "llm-bridge-session-selector",
      attr: { title: "打开最近会话下拉；完整历史在 History 页面" },
    });
    const sessionIcon = sessionPreview.createEl("span", { cls: "llm-bridge-session-icon" });
    setIcon(sessionIcon, "history");
    sessionPreview.createEl("span", { cls: "llm-bridge-session-kicker", text: "Session" });
    this.sessionTitleEl = sessionPreview.createEl("span", { cls: "llm-bridge-sb-session-title", text: this.sessionState.title });
    const sessionCaret = sessionPreview.createEl("span", { cls: "llm-bridge-session-caret" });
    setIcon(sessionCaret, "chevron-down");
    const sessionDropdown = topbarRow1.createDiv({ cls: "llm-bridge-session-dropdown" });
    sessionDropdown.setAttribute("hidden", "");

    const headerRight = topbarRow1.createDiv({ cls: "llm-bridge-header-right" });
    this.clearBtn = headerRight.createEl("button", {
      cls: "llm-bridge-new-chat-btn",
      attr: { title: "新建会话（清空消息）" },
    });
    setIcon(this.clearBtn.createEl("span", { cls: "llm-bridge-icon" }), "plus");
    this.clearBtn.createEl("span", { cls: "llm-bridge-new-chat-label", text: "新聊天" });
    this.clearBtn.addEventListener("click", () => this.newSession());

    // --- 第二排：审查/压缩 + 设置 + runtime 状态 ---
    const topbarRow2 = header.createDiv({ cls: "llm-bridge-topbar-row llm-bridge-topbar-row-tools" });
    this.reviewBtn = topbarRow2.createEl("button", {
      cls: "llm-bridge-topbar-action-btn",
      attr: { type: "button", title: "审查当前更改（仅 Codex app-server）" },
    });
    setIcon(this.reviewBtn.createEl("span", { cls: "llm-bridge-icon" }), "search-check");
    this.reviewBtn.createEl("span", { cls: "llm-bridge-topbar-action-label", text: "审查" });
    this.reviewBtn.addEventListener("click", () => {
      void this.runSession.runNativeAction({ kind: "review", target: { type: "uncommittedChanges" }, delivery: "inline" });
    });
    this.compactBtn = topbarRow2.createEl("button", {
      cls: "llm-bridge-topbar-action-btn",
      attr: { type: "button", title: "压缩上下文（仅 Codex app-server 且已有 thread）" },
    });
    setIcon(this.compactBtn.createEl("span", { cls: "llm-bridge-icon" }), "minimize-2");
    this.compactBtn.createEl("span", { cls: "llm-bridge-topbar-action-label", text: "压缩" });
    this.compactBtn.addEventListener("click", () => {
      void this.runSession.runNativeAction({ kind: "compact" });
    });

    const toolsRight = topbarRow2.createDiv({ cls: "llm-bridge-header-right" });
    const settingsBtn = toolsRight.createEl("button", { cls: "llm-bridge-icon-btn llm-bridge-settings-btn", attr: { title: "打开插件设置" } });
    setIcon(settingsBtn.createEl("span", { cls: "llm-bridge-icon" }), "settings");
    settingsBtn.addEventListener("click", () => this.openPluginSettings());
    const runtimeStatus = toolsRight.createDiv({ cls: "llm-bridge-runtime-status", attr: { title: "Runtime status" } });
    this.statusDotEl = runtimeStatus.createEl("span", {
      cls: "llm-bridge-status-dot llm-bridge-status-dot-idle",
      attr: { title: STATUS_LABEL.idle },
    });
    this.statusLabelEl = runtimeStatus.createEl("span", {
      cls: "llm-bridge-status-text",
      text: "正在初始化…",
    });
    this.runtimeInstallBtnEl = toolsRight.createEl("button", {
      cls: "llm-bridge-runtime-install-btn",
      text: "Install Codex runtime",
      attr: { type: "button", title: "Install the pinned Codex managed runtime" },
    });
    this.runtimeInstallBtnEl.setAttribute("hidden", "");
    this.runtimeInstallBtnEl.addEventListener("click", () => void this.runSession.installManagedRuntimeFromUi());

    // agent selector 迁入 composer 右侧；header 只保留 compact runtime status。
    const agentSelect = document.createElement("select");
    agentSelect.className = "llm-bridge-agent-select";
    for (const a of AGENT_OPTIONS) {
      agentSelect.createEl("option", { value: a.value, text: a.label });
    }
    agentSelect.addEventListener("change", async () => {
      if (this.runSession.runHandle) return;
      this.plugin.settings.agentType = agentSelect.value as AgentType;
      const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      const provider = agentSelect.value === "claude" ? "claude" : agentSelect.value === "custom" ? "pi" : "codex";
      setActiveProvider(vaultPath, provider);
      this.plugin.settings.backendMode = "auto";
      this.runSession.clearSession();
      this.runSession.setRestoredActiveNativeSessionRef(undefined);
      this.syncModelCatalogForCurrentAgent(true);
      await this.plugin.saveSettings();
      this.lastPreflightResult = null; // V2.4: 切换 agent 后失效 preflight 缓存
      this.refreshModeOptions();
      this.refreshAllChips();
    });
    this.agentChipGroup = agentSelect;

    // ===== V2.15-A: 左侧 slim navigation rail（无 Settings 入口） =====
    const railCollapseBtn = nav.createEl("button", {
      cls: "llm-bridge-nav-collapse-btn",
      attr: { title: "折叠左侧栏", "aria-label": "折叠左侧栏" },
    });
    const railCollapseIcon = railCollapseBtn.createEl("span", { cls: "llm-bridge-nav-icon" });
    setIcon(railCollapseIcon, "panel-left-close");
    railCollapseBtn.addEventListener("click", () => {
      const collapsed = !shell.classList.contains("is-rail-collapsed");
      shell.classList.toggle("is-rail-collapsed", collapsed);
      railCollapseBtn.setAttribute("title", collapsed ? "展开左侧栏" : "折叠左侧栏");
      railCollapseBtn.setAttribute("aria-label", collapsed ? "展开左侧栏" : "折叠左侧栏");
      railCollapseIcon.empty();
      setIcon(railCollapseIcon, collapsed ? "panel-left-open" : "panel-left-close");
    });
    // 左 rail：固定图标模式；页面标题/tooltip 承担命名（对话/上下文/能力/历史）
    const chatTab = nav.createEl("button", { cls: "llm-bridge-nav-item is-active", attr: { "data-tab": "chat", title: "对话", "aria-label": "对话" } });
    setIcon(chatTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "message-square");
    chatTab.createEl("span", { cls: "llm-bridge-nav-label", text: "对话" });
    const filesTab = nav.createEl("button", { cls: "llm-bridge-nav-item", attr: { "data-tab": "files", title: "上下文", "aria-label": "上下文" } });
    setIcon(filesTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "files");
    filesTab.createEl("span", { cls: "llm-bridge-nav-label", text: "上下文" });
    const skillsTab = nav.createEl("button", { cls: "llm-bridge-nav-item", attr: { "data-tab": "skills", title: "能力", "aria-label": "能力" } });
    setIcon(skillsTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "sparkles");
    skillsTab.createEl("span", { cls: "llm-bridge-nav-label", text: "能力" });
    const historyTab = nav.createEl("button", { cls: "llm-bridge-nav-item", attr: { "data-tab": "history", title: "历史", "aria-label": "历史" } });
    setIcon(historyTab.createEl("span", { cls: "llm-bridge-nav-icon" }), "history");
    historyTab.createEl("span", { cls: "llm-bridge-nav-label", text: "历史" });

    const pageStack = main.createDiv({ cls: "llm-bridge-page-stack" });
    const chatPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-chat-page is-active", attr: { "data-panel": "chat" } });
    const filesPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-files-page", attr: { "data-panel": "files" } });
    const skillsPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-skills-page", attr: { "data-panel": "skills" } });
    const historyPanel = pageStack.createDiv({ cls: "llm-bridge-tab-panel llm-bridge-history-page", attr: { "data-panel": "history" } });
    this.tabPanels = { chat: chatPanel, files: filesPanel, skills: skillsPanel, history: historyPanel };
    const switchTab = (tab: "chat" | "files" | "skills" | "history") => {
      this.closeModelEffortPopover();
      this.composerController.closeModelEffortPopover();
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

    // ===== 上下文页：本轮附件 / 旧会话 Pin / 授权（非文件浏览器） =====
    const filesHead = filesPanel.createDiv({ cls: "llm-bridge-secondary-head" });
    filesHead.createEl("span", { cls: "llm-bridge-secondary-kicker", text: "上下文" });
    filesHead.createEl("strong", { text: "附件与授权" });
    filesHead.createEl("small", { text: "本轮附件与外部读取授权。旧会话的 Pin 仅在此查看/复制/移除，不再提供新建 Pin。" });
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
    this.statusBackendEl = sbItems.createEl("span", { cls: "llm-bridge-sb-item", attr: { title: "实际 Runtime（由 provider 选择链决定）" } });
    this.statusBackendEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Runtime" });
    this.statusBackendEl.createEl("span", { cls: "llm-bridge-sb-value" });
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
    // Phase 4: Agent 类型移入高级指标区（普通状态栏以 Runtime 为中心）
    this.statusAgentEl = sbAdvancedItems.createEl("span", { cls: "llm-bridge-sb-item", attr: { title: "Agent 类型（配置值）" } });
    this.statusAgentEl.createEl("span", { cls: "llm-bridge-sb-label", text: "Agent" });
    this.statusAgentEl.createEl("span", { cls: "llm-bridge-sb-value" });
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

    // V18: 回到底部按钮——专门锚点容器居中定位，不依赖固定 bottom 数值
    // 锚点容器放在 composer 之前（chatPanel flex 列布局），height:0 + position:relative
    this.scrollBottomAnchorEl = chatPanel.createDiv({ cls: "llm-bridge-scroll-bottom-anchor" });
    this.scrollBottomBtnEl = this.scrollBottomAnchorEl.createDiv({ cls: "llm-bridge-scroll-bottom-btn", attr: { title: "回到底部", "aria-label": "回到底部" } });
    setIcon(this.scrollBottomBtnEl.createEl("span", { cls: "llm-bridge-scroll-bottom-icon" }), "arrow-down");
    this.scrollBottomBtnEl.style.display = "none";
    this.scrollBottomBtnEl.addEventListener("click", () => this.scrollToBottom(true));
    this.messagesEl.addEventListener("scroll", () => {
      const show = !this.isNearBottom(160);
      this.scrollBottomBtnEl.style.display = show ? "" : "none";
    });

    // ===== 底部 composer =====
    const composer = chatPanel.createDiv({ cls: "llm-bridge-composer" });
    this.composerEl = composer;
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
    // 上下文占用环：composer 右上角；数值只吃 agent-runtime（Codex tokenUsage）
    const contextStrip = composerContextRow.createDiv({
      cls: "llm-bridge-context-strip is-tooltip-only",
      attr: { role: "img", "aria-label": "Context" },
    });
    this.contextRingEl = contextStrip.createDiv({ cls: "llm-bridge-context-ring is-unavailable" });
    this.contextTipEl = contextStrip.createDiv({ cls: "llm-bridge-context-tip", attr: { hidden: "" } });
    this.contextTipPctEl = this.contextTipEl.createDiv({ cls: "llm-bridge-context-tip-pct" });
    this.contextTipTokensEl = this.contextTipEl.createDiv({ cls: "llm-bridge-context-tip-tokens" });
    this.contextLabelEl = contextStrip.createDiv({ cls: "llm-bridge-context-label", text: "" });
    this.contextDetailEl = contextStrip.createDiv({ cls: "llm-bridge-context-detail" });
    this.contextDetailEl.setAttribute("hidden", "");
    contextStrip.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".llm-bridge-context-detail")) return;
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

    // 工具菜单：显式 button + popover（先提升层级再显示，避免 <details> 打开闪动）
    const commandMenuWrap = leftTools.createDiv({ cls: "llm-bridge-command-menu" });
    const commandMenuBtn = commandMenuWrap.createEl("button", {
      cls: "llm-bridge-composer-tool-btn llm-bridge-command-menu-btn",
      attr: {
        type: "button",
        title: "本轮插件与 Skills",
        "aria-haspopup": "true",
        "aria-expanded": "false",
      },
    });
    setIcon(commandMenuBtn.createEl("span", { cls: "llm-bridge-command-menu-summary-icon" }), "wrench");
    commandMenuBtn.createEl("span", { cls: "llm-bridge-command-menu-label", text: "工具" });
    const commandMenuBody = commandMenuWrap.createDiv({
      cls: "llm-bridge-command-menu-body",
      attr: { hidden: "", role: "menu" },
    });
    const commandPlugins = commandMenuBody.createDiv({ cls: "llm-bridge-command-menu-plugins" });
    const commandPluginsHead = commandPlugins.createDiv({ cls: "llm-bridge-command-menu-plugins-head" });
    commandPluginsHead.createEl("span", { cls: "llm-bridge-command-menu-section-title", text: "本轮能力" });
    commandPluginsHead.createEl("span", { cls: "llm-bridge-command-menu-section-hint", text: "仅影响当前发送" });
    const commandPluginsList = commandPlugins.createDiv({ cls: "llm-bridge-command-menu-plugins-list" });
    commandPluginsList.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "首次打开时读取插件与 Skills。" });
    let commandPluginsRequest = 0;
    let commandPluginsLoaded = false;
    const refreshCommandPlugins = async (opts?: { force?: boolean; background?: boolean }) => {
      const force = !!opts?.force;
      const background = !!opts?.background;
      const FRESH_MS = 60_000;
      const cacheFresh = commandPluginsLoaded
        && !!this.managedCodexPluginCatalog
        && Date.now() - this.managedPluginsRefreshedAt < FRESH_MS;
      if (!force && cacheFresh) {
        if (!background) {
          this.renderComposerRuntimeToolsList(commandPluginsList);
          this.renderAgentSkillsList();
        }
        // 后台静默刷新，不清空现有列表
        void (async () => {
          const request = ++commandPluginsRequest;
          await this.refreshManagedCodexPlugins();
          await this.refreshAgentSkillsManifestOnly();
          if (request !== commandPluginsRequest) return;
          this.renderComposerRuntimeToolsList(commandPluginsList);
          this.renderAgentSkillsList();
        })();
        return;
      }
      const request = ++commandPluginsRequest;
      if (!background || !commandPluginsLoaded) {
        commandPluginsList.empty();
        commandPluginsList.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "正在读取..." });
      }
      await this.refreshManagedCodexPlugins();
      await this.refreshAgentSkillsManifestOnly();
      if (request !== commandPluginsRequest) return;
      this.renderComposerRuntimeToolsList(commandPluginsList);
      this.renderAgentSkillsList();
      commandPluginsLoaded = true;
    };
    const closeCommandMenu = () => {
      commandMenuBody.setAttribute("hidden", "");
      commandMenuBtn.setAttribute("aria-expanded", "false");
      commandMenuWrap.classList.remove("is-open");
      if (this.composerController.activePopup === "command") this.composerController.setActivePopup(null);
    };
    const openCommandMenu = () => {
      // 先提升 composer 层级，再显示弹层，消除打开瞬间闪动
      this.composerController.setActivePopup("command");
      this.closePermissionPopover();
      this.closeModelEffortPopover();
      this.composerController.closeModelEffortPopover();
      this.closeMentionPicker();
      this.closeAttachmentContextMenu();
      document.querySelectorAll(".llm-bridge-session-dropdown:not([hidden])")
        .forEach((el) => el.setAttribute("hidden", ""));
      commandMenuWrap.classList.add("is-open");
      commandMenuBtn.setAttribute("aria-expanded", "true");
      commandMenuBody.removeAttribute("hidden");
      void refreshCommandPlugins({ background: commandPluginsLoaded });
    };
    commandMenuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (commandMenuBody.hasAttribute("hidden")) openCommandMenu();
      else closeCommandMenu();
    });
    // 权限：扳手旁边的同级入口（不在工具菜单内）
    this.permissionModePickerEl = leftTools.createDiv({ cls: "llm-bridge-permission-picker" });
    this.permissionModeChipEl = this.permissionModePickerEl.createEl("button", {
      cls: "llm-bridge-permission-chip llm-bridge-composer-tool-btn",
      attr: { title: "切换权限模式：受限 / 默认 / acceptEdits", "aria-haspopup": "true", "aria-expanded": "false" },
    });
    this.permissionModeChipEl.addEventListener("click", (event) => {
      event.stopPropagation();
      closeCommandMenu();
      void this.togglePermissionPopover();
    });
    this.preflightBtn = document.createElement("button");

    this.composerRuntimeCapabilitiesEl = composerBar.createDiv({ cls: "llm-bridge-composer-runtime-capabilities" });
    this.composerRuntimeCapabilitiesEl.setAttribute("hidden", "");
    const inputSurface = composerBar.createDiv({ cls: "llm-bridge-input-surface" });
    this.composerFileRefsEl = inputSurface.createDiv({
      cls: "llm-bridge-composer-file-refs llm-bridge-attachment-tokens",
    });
    this.composerFileRefsEl.setAttribute("hidden", "");
    const inputRow = inputSurface.createDiv({ cls: "llm-bridge-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "llm-bridge-input",
      attr: { placeholder: "输入消息…", rows: "1" },
    });
    const mentionPickerEl = inputRow.createDiv({ cls: "llm-bridge-mention-picker" });
    mentionPickerEl.setAttribute("hidden", "");
    this.composerController.setMentionPickerEl(mentionPickerEl);
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      const mentionPicker = this.composerController.mentionPickerEl;
      if (mentionPicker && !mentionPicker.hasAttribute("hidden")) {
        if (this.handleMentionKeydown(e)) return;
      }
      if (this.handleComposerAttachmentKeydown(e)) return;
      // Enter 发送 / Shift+Enter 换行；兼容中文输入法（isComposing 或 keyCode 229 时不触发）
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        if (e.ctrlKey || e.metaKey || !e.altKey) {
          e.preventDefault();
          if (this.sendBtn?.disabled) return;
          void (this.runSession.runHandle ? this.runSession.steerCurrentTurn() : this.runSession.run());
        }
      }
    });
    this.inputEl.addEventListener("input", () => {
      if (this.composerController.selectedAttachmentId && this.inputEl.value.length > 0) {
        this.composerController.selectedAttachmentId = null;
        this.renderComposerFileRefs();
      }
      this.handleMentionInput();
      this.autoGrowInput();
      this.refreshSendButtonState();
    });
    this.inputEl.addEventListener("paste", (event) => {
      void this.handleComposerPaste(event);
    });
    // 工具菜单内部点击不得触发全局 outside-click 关闭
    commandMenuBody.addEventListener("pointerdown", (event) => event.stopPropagation());
    commandMenuBody.addEventListener("click", (event) => event.stopPropagation());
    // 供 outside-click / Escape 关闭
    this.composerController.setCloseCommandMenuPopover(closeCommandMenu);

    const toolbar = composerBar.createDiv({ cls: "llm-bridge-composer-toolbar" });
    toolbar.appendChild(leftTools);
    const rightTools = toolbar.createDiv({ cls: "llm-bridge-composer-tools llm-bridge-composer-tools-right" });
    this.agentChipTextEl = agentSelect;
    this.renderModelEffortPicker(rightTools);

    const actionCol = rightTools.createDiv({ cls: "llm-bridge-action-col" });
    this.stopBtn = actionCol.createEl("button", {
      cls: "llm-bridge-stop-btn",
      attr: { title: "停止运行", "aria-label": "停止运行" },
    });
    this.stopBtn.createEl("span", { cls: "llm-bridge-stop-icon", text: "" });
    this.stopBtn.style.display = "none";
    this.stopBtn.addEventListener("click", () => this.runSession.stop());
    this.sendBtn = actionCol.createEl("button", {
      cls: "llm-bridge-send-btn",
      attr: { title: "发送 (Enter)", "aria-label": "发送" },
    });
    setIcon(this.sendBtn.createEl("span", { cls: "llm-bridge-send-icon" }), "arrow-up");
    this.sendBtn.addEventListener("click", () => {
      void (this.runSession.runHandle ? this.runSession.steerCurrentTurn() : this.runSession.run());
    });

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

    bindComposerFileDragSurfaceDom(composer, (event) => {
      void this.handleComposerDrop(event);
    });
    this.refreshContextRefs();

    // Initialize RunSessionController after DOM is ready
    this.runSession = new RunSessionController(this.buildRunSessionHost());

    // 两阶段初始化：
    // 1) 一次性事件绑定（不可重试，否则重复注册监听）
    this.bindComposerEvents();

    // 2) 可重试的数据填充（模型目录、权限、Runtime 状态、Skills）
    try {
      this.hydrateComposerRuntime();
    } catch (e) {
      console.error("[llm-cli-bridge] hydrateComposerRuntime failed:", e);
      this.showInitErrorBoundary(e);
    }
  }

  /**
   * 一次性事件绑定：active-leaf-change / file-open / pending action 回调。
   * 只在 onOpen 中调用一次，重试初始化时不重复执行。
   */
  private bindComposerEvents(): void {
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

  /**
   * 两阶段初始化第二步：加载模型目录、权限、Runtime 状态和 Skills。
   * 即使此方法抛异常，用户也不应得到半残界面 — mountComposerDom 已确保基础 DOM 存在。
   * 此方法可被重试按钮安全调用：不包含事件注册，不会重复绑定监听。
   */
  private hydrateComposerRuntime(): void {
    this.syncModelCatalogForCurrentAgent(false);
    this.renderModelEffortOptions();
    this.syncControlsFromSettings();
    this.updateContextDisplay();
    this.setGlobalStatus("idle");
    this.refreshStatusBar();
    void this.refreshDynamicModelCatalog();
    this.refreshSessionState();
    void this.refreshAgentSkills();
    void this.refreshHistory();
    // V2.16-D: 会话保持 — onOpen 时若启用 keepLastSession 且存在 lastActiveSessionId，自动恢复
    void this.restoreLastActiveSessionIfNeeded();
    // V2.16-D: 初始 context metrics 估算
    void this.refreshContextMetrics();
  }

  /**
   * V20.8: 以本地 config.toml / settings.json / models.json 的 model 为启动默认值。
   *
   * 不再请求中转站 /v1/models 交叉匹配——第三方自定义模型作为"本地配置模型"
   * 加入聊天框。Runtime model/list 只提供能力和官方可选模型。
   */
  private async refreshDynamicModelCatalog(): Promise<void> {
    if (this.getEffectiveModelCatalogAgent() !== "codex") return;
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const settings = this.plugin.settings;

    try {
      // 本地 Codex config.toml 是用户选择的第一真相源；runtime model/list 只补能力目录。
      const localForm = readProviderForm(vaultPath, "codex");
      const localModel = localForm.ok && localForm.form ? localForm.form.model : "";
      // Round 3: 直接读取能力快照（model/list 全量分页 + modelProvider/capabilities/read）；
      // 目前只消费 models，modelProviderCapabilities 留作后续能力门控 UI 的扩展点。
      const runtimeSnapshot = await loadCodexRuntimeCapabilitySnapshot(this.plugin.pluginDir, vaultPath);

      // 构建 catalog：runtime 官方模型 + 本地配置模型（去重）
      const catalogEntries: ModelCatalogEntry[] = [...(runtimeSnapshot?.models ?? [])];
      if (localModel && !catalogEntries.some((m) => m.value === localModel)) {
        // 本地配置模型作为第一项（优先选择）
        catalogEntries.unshift({
          value: localModel,
          label: localModel,
        });
      }
      if (catalogEntries.length === 0) return;

      setRuntimeModelCatalogForAgent("codex", catalogEntries);

      // 如果当前 settings.model 为空或不匹配，使用本地配置模型
      const selected = settings.model.trim();
      if (!selected || !catalogEntries.some((m) => m.value === selected)) {
        settings.model = localModel || catalogEntries[0]?.value || "";
        const defaultEffort = getDefaultEffortForModel(getRuntimeModelCatalogForAgent("codex"), settings.model);
        settings.effortLevel = defaultEffort;
        await this.plugin.saveSettings();
      }
    } catch { /* runtime catalog 不可用时继续使用静态兜底 */ }

    this.syncModelCatalogForCurrentAgent(false);
    this.renderModelEffortOptions();
    this.refreshModelEffortPicker();
  }

  private scheduleDynamicModelCatalogRefresh(delayMs = 500): void {
    if (this.modelCatalogRefreshTimer !== null) window.clearTimeout(this.modelCatalogRefreshTimer);
    this.modelCatalogRefreshTimer = window.setTimeout(() => {
      this.modelCatalogRefreshTimer = null;
      void this.refreshDynamicModelCatalog();
    }, delayMs);
  }

  /**
   * 初始化错误边界：捕获异常后顶部显示"初始化失败"，提供重试或诊断入口。
   * 不能永久停在"正在初始化…"。
   */
  private showInitErrorBoundary(error: unknown): void {
    const errMsg = error instanceof Error ? error.message : String(error);
    // 更新状态标签为失败，而非永久停在"正在初始化…"
    if (this.statusLabelEl) {
      this.statusLabelEl.textContent = "初始化失败";
      this.statusLabelEl.setAttribute("title", errMsg);
    }
    // 在消息流顶部显示错误卡片
    if (this.messagesEl) {
      const errCard = this.messagesEl.createDiv({ cls: "llm-bridge-init-error-card" });
      errCard.createEl("div", { cls: "llm-bridge-init-error-title", text: "初始化失败" });
      errCard.createEl("div", { cls: "llm-bridge-init-error-msg", text: errMsg });
      const btnRow = errCard.createDiv({ cls: "llm-bridge-init-error-actions" });
      const retryBtn = btnRow.createEl("button", { cls: "llm-bridge-init-error-retry-btn", text: "重试初始化" });
      retryBtn.addEventListener("click", () => {
        errCard.remove();
        if (this.statusLabelEl) this.statusLabelEl.textContent = "正在初始化…";
        try {
          // hydrateComposerRuntime 内部会调用 setGlobalStatus("idle")，
          // 输出完整的 "Codex managed · 可用" 等 Runtime 状态，而非裸 "可用"。
          this.hydrateComposerRuntime();
        } catch (e2) {
          console.error("[llm-cli-bridge] retry hydrateComposerRuntime failed:", e2);
          this.showInitErrorBoundary(e2);
        }
      });
      const diagBtn = btnRow.createEl("button", { cls: "llm-bridge-init-error-diag-btn", text: "复制诊断信息" });
      diagBtn.addEventListener("click", () => void this.copyDiagnosticsToClipboard());
    }
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
      if (this.runSession.runHandle) return;
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
    const loc = resolveUiLocale() === "en" ? "en" : "zh";
    const label = NAV_TAB_LABELS[tab][loc];
    this.pageTitleEl.textContent = label;
    this.pageTitleEl.toggleAttribute("hidden", tab === "chat");
  }

  private renderComposerRuntimeToolsList(parent: HTMLElement): void {
    renderComposerRuntimeToolsListFn(parent, this.composerRuntimeCapabilitiesViewDeps());
  }

  private renderComposerRuntimeCapabilityChips(): void {
    renderComposerRuntimeCapabilityChipsFn(this.composerRuntimeCapabilitiesViewDeps());
  }

  private toggleComposerRuntimeCapability(selection: ComposerRuntimeCapabilitySelection): void {
    toggleComposerRuntimeCapabilityFn(selection, this.composerRuntimeCapabilitiesViewDeps());
  }

  private renderComposerManagedCodexPluginsList(parent: HTMLElement): void {
    // 已合并到 renderComposerRuntimeToolsList；保留签名以兼容旧调用。
    renderComposerRuntimeToolsListFn(parent, this.composerRuntimeCapabilitiesViewDeps());
  }

  private renderComposerAgentSkillsList(parent: HTMLElement): void {
    // 已合并到 renderComposerRuntimeToolsList；保留签名以兼容旧调用。
    renderComposerRuntimeToolsListFn(parent, this.composerRuntimeCapabilitiesViewDeps());
  }

  private composerToolVisualKey(label: string, id: string): string {
    return composerToolVisualKeyFn(label, id);
  }

  private describeComposerManagedCodexPlugin(plugin: CodexManagedPluginEntry): { label: string; description: string; icon: string } {
    return describeComposerManagedCodexPluginFn(plugin);
  }

  private useComposerManagedCodexPlugin(plugin: CodexManagedPluginEntry): void {
    const menu = this.inputEl.closest(".llm-bridge-composer-bar")?.querySelector(".llm-bridge-command-menu") as HTMLDetailsElement | null;
    menu?.removeAttribute("open");
    useComposerManagedCodexPluginFn(plugin, this.composerRuntimeCapabilitiesViewDeps());
  }

  private useComposerAgentSkill(skill: AgentSkillRecord): void {
    const menu = this.inputEl.closest(".llm-bridge-composer-bar")?.querySelector(".llm-bridge-command-menu") as HTMLDetailsElement | null;
    menu?.removeAttribute("open");
    useComposerAgentSkillFn(skill, this.composerRuntimeCapabilitiesViewDeps());
  }

  private buildUserInputWithRuntimeCapabilityHints(userInput: string): string {
    return buildUserInputWithRuntimeCapabilityHintsFn(userInput, this.composerRuntimeCapabilitiesViewDeps());
  }

  private composerRuntimeCapabilitiesViewDeps(): ComposerRuntimeCapabilitiesViewDeps {
    return {
      getChipsContainerEl: () => this.composerRuntimeCapabilitiesEl,
      focusInput: () => this.inputEl.focus(),
      getManagedCodexPlugins: () => this.managedCodexPlugins,
      getManagedCodexPluginCatalog: () => this.managedCodexPluginCatalog,
      getAgentSkills: () => this.agentSkills,
      getSelectedRuntimeCapabilities: () => this.selectedRuntimeCapabilities,
      setSelectedRuntimeCapabilities: (v) => { this.selectedRuntimeCapabilities = v; },
    };
  }

  private refreshAllChips(): void {
    // composer agent 下拉
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const activeProvider = this.plugin.settings.backendMode === "auto" ? getActiveProvider(vaultPath) : null;
    const agentValue: AgentType = activeProvider === "codex"
      ? "codex"
      : activeProvider === "pi"
        ? "custom"
        : activeProvider === "claude"
          ? "claude"
          : this.plugin.settings.agentType;
    (this.agentChipGroup as HTMLSelectElement).value = agentValue;

    // V2.15-E: composer 只保留一个 compact 模型/思考强度组合控件。
    this.refreshModelEffortPicker();
    this.refreshPermissionModeChip();
    this.renderPermissionPopover();
    // V17-TOPBAR-2ROW: 刷新第二排审查/压缩按钮的禁用/可见状态
    this.refreshTopbarActionButtons();
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
      // UI-02: 加 "Note ·" 前缀让用户一眼区分上下文类型
      const displayName = fname ? `Note · ${fname}` : "No active note";
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
    // Fig.1: 单一合并 chip（模型 + 推理强度），嵌套主菜单 + 右侧 flyout
    this.modelEffortButtonEl = this.modelEffortPickerEl.createEl("button", {
      cls: "llm-bridge-model-effort-chip llm-bridge-model-chip-merged",
      attr: { title: "选择模型与推理强度", "aria-haspopup": "true", "aria-expanded": "false" },
    });
    this.modelEffortButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.runSession.runHandle) return;
      this.toggleModelEffortPopover();
    });

    const menuEl = this.modelEffortPickerEl.createDiv({
      cls: "llm-bridge-model-effort-popover llm-bridge-model-menu-nested",
      attr: { hidden: "" },
    });
    this.composerController.setModelEffortPopoverEl(menuEl);

    menuEl.createDiv({ cls: "llm-bridge-model-menu-primary" });
    const modelFlyout = menuEl.createDiv({
      cls: "llm-bridge-model-menu-flyout",
      attr: { "data-panel": "model", hidden: "" },
    });
    modelFlyout.createDiv({ cls: "llm-bridge-model-menu-flyout-title", text: "模型" });
    this.modelOptionsEl = modelFlyout.createDiv({ cls: "llm-bridge-model-options" });

    const effortFlyout = menuEl.createDiv({
      cls: "llm-bridge-model-menu-flyout",
      attr: { "data-panel": "effort", hidden: "" },
    });
    effortFlyout.createDiv({ cls: "llm-bridge-model-menu-flyout-title", text: "推理强度" });
    this.effortOptionsEl = effortFlyout.createDiv({ cls: "llm-bridge-effort-options" });

    this.modelEffortPickerEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeModelEffortPopover();
    });
    this.registerDomEvent(document, "pointerdown", (event) => this.handleComposerSelectorOutsideClick(event));
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape") this.closeAllComposerSelectors();
    });
  }

  private async setModelEffort(model: string, effort: string): Promise<void> {
    if (this.runSession.runHandle) return;
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
    const providerId = this.runSession?.getSession()?.providerId;
    if (providerId && /codex/.test(providerId)) return "codex";
    if (providerId && /pi/.test(providerId)) return "custom";
    if (providerId && /claude/.test(providerId)) return "claude";
    const mode = this.plugin.settings.backendMode;
    if (mode === "codex-managed-app-server" || mode === "codex-app-server-external") return "codex";
    if (mode === "pi-sdk" || mode === "pi-rpc") return "custom";
    if (mode === "auto") {
      const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      const activeProvider = getActiveProvider(vaultPath);
      if (activeProvider === "codex") return "codex";
      if (activeProvider === "pi") return "custom";
      return "claude";
    }
    return this.plugin.settings.agentType;
  }

  private renderModelEffortOptions(): void {
    this.composerController.renderModelEffortOptions();
  }

  private toggleModelEffortPopover(): void {
    this.composerController.toggleModelEffortPopover();
  }

  private closeModelEffortPopover(updateActive = true): void {
    this.composerController.closeModelEffortPopover(updateActive);
  }

  private refreshModelEffortPicker(): void {
    if (!this.modelEffortButtonEl) return;
    this.syncModelCatalogForCurrentAgent(false);
    this.renderModelEffortOptions();
    refreshModelEffortPickerLabelsDom(
      this.modelEffortButtonEl,
      this.composerController.modelEffortPopoverEl,
      this.modelCatalog,
      this.plugin.settings.model,
      this.plugin.settings.effortLevel,
    );
  }

  private effectiveApprovalProfile(): AgentApprovalProfile {
    const fromSettings = this.plugin.settings.agentApprovalProfile;
    if (isAgentApprovalProfile(fromSettings)) return fromSettings;
    return migrateLegacyPermissionToApprovalProfile(this.plugin.settings.claudePermissionMode);
  }

  /**
   * 实际生效画像：优先本轮 EffectiveRunPlan（Codex），否则 settings。
   */
  private displayApprovalProfile(): AgentApprovalProfile {
    const plan = this.messages.slice().reverse().find((m) => m.effectiveRunPlan)?.effectiveRunPlan;
    if (plan && plan.backend === "codex-app-server" && isAgentApprovalProfile(plan.approvalProfile)) {
      return plan.approvalProfile;
    }
    return this.effectiveApprovalProfile();
  }

  private createComposerMenuItem(parent: HTMLElement, options: ComposerMenuItemOptions): HTMLButtonElement {
    return createComposerMenuItemDom(parent, options);
  }

  /**
   * 权限菜单：请求批准 / 替我审批 / 完全访问（计划模式已移出）
   */
  private renderPermissionPopover(): void {
    this.composerController.renderPermissionPopover();
  }

  private togglePermissionPopover(): void {
    this.composerController.togglePermissionPopover();
  }

  private closePermissionPopover(updateActive = true): void {
    this.composerController.closePermissionPopover(updateActive);
  }

  private isEventInsideSelector(event: Event, selector: string): boolean {
    return isEventInsideSelectorDom(event, selector);
  }

  private handleComposerSelectorOutsideClick(event: Event): void {
    if (!this.isEventInsideSelector(event, ".llm-bridge-permission-picker")
      && !this.isEventInsideSelector(event, ".llm-bridge-perm-popover")) {
      this.closePermissionPopover();
    }
    this.composerController.handleSelectorOutsideClick(event);
  }

  private closeAllComposerSelectors(): void {
    this.composerController.closeAllSelectors();
  }

  private confirmFullAccess(): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      const modal = new Modal(this.app);
      modal.titleEl.setText("启用完全访问？");
      modal.contentEl.createEl("p", {
        text: "完全访问将跳过权限确认，并可访问互联网与本机文件。仅在可信任务中使用。",
      });
      const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const cancel = row.createEl("button", { text: "取消" });
      const ok = row.createEl("button", { cls: "mod-warning", text: "确认启用" });
      const done = (val: boolean): void => {
        if (resolved) return;
        resolved = true;
        resolve(val);
        modal.close();
      };
      cancel.addEventListener("click", () => done(false));
      ok.addEventListener("click", () => done(true));
      modal.onClose = () => done(false);
      modal.open();
    });
  }

  private async setApprovalProfile(profile: AgentApprovalProfile): Promise<void> {
    if (profile === "full-access") {
      const ok = await this.confirmFullAccess();
      if (!ok) return;
    }
    this.plugin.settings.agentApprovalProfile = profile;
    this.plugin.settings.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode(profile);
    await this.plugin.saveSettings();
    this.refreshPermissionModeChip();
    this.refreshStatusBar();
    this.runSession.session?.rebuildPermissionBoundary(this.plugin.settings);
  }

  private refreshPermissionModeChip(): void {
    if (!this.permissionModeChipEl) return;
    refreshPermissionModeChipDom(this.permissionModeChipEl, this.displayApprovalProfile());
  }

  /**
   * 恢复会话审批画像。
   * full-access 不从历史静默恢复，必须重新确认；旧 bypassPermissions 统一回到 ask。
   */
  private applySessionApprovalProfile(session: { approvalProfile?: string; permissionMode?: string }): void {
    const s = this.plugin.settings;
    if (session.approvalProfile === "full-access") {
      s.agentApprovalProfile = "ask";
      s.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode("ask");
      new Notice("历史会话含完全访问：已降级为请求批准，如需完全访问请重新确认。");
      return;
    }
    if (isAgentApprovalProfile(session.approvalProfile)) {
      s.agentApprovalProfile = session.approvalProfile;
      s.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode(session.approvalProfile);
      return;
    }
    s.agentApprovalProfile = migrateLegacyPermissionToApprovalProfile(session.permissionMode);
    s.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode(s.agentApprovalProfile);
  }

  private buildComposerHost(): ComposerHost {
    const view = this;
    return {
      get inputEl() { return view.inputEl; },
      get app() { return view.app; },
      getComposerEl: () => view.composerEl,
      getComposerBarEl: () => view.composerBarEl,
      getModelEffortButtonEl: () => view.modelEffortButtonEl,
      getModelOptionsEl: () => view.modelOptionsEl,
      getEffortOptionsEl: () => view.effortOptionsEl,
      getPermissionModePickerEl: () => view.permissionModePickerEl,
      getPermissionModeChipEl: () => view.permissionModeChipEl,
      getModelCatalog: () => view.modelCatalog,
      getEffortLevel: () => view.plugin.settings.effortLevel,
      getModel: () => view.plugin.settings.model,
      addAttachmentPathWithNotice: (filePath) => { void view.addAttachmentPathWithNotice(filePath); },
      removeMessageFileRef: (id) => view.removeMessageFileRef(id),
      renderComposerFileRefs: () => view.renderComposerFileRefs(),
      copyFileRefToClipboard: (ref) => { void view.copyFileRefToClipboard(ref); },
      openPathWithSystemDefault: (target) => { void view.openPathWithSystemDefault(target); },
      setApprovalProfile: (profile) => { void view.setApprovalProfile(profile); },
      setModelEffort: (model, effort) => { void view.setModelEffort(model, effort); },
      effectiveApprovalProfile: () => view.effectiveApprovalProfile(),
      autoGrowInput: () => view.autoGrowInput(),
      getMessageFileRefs: () => view.messageFileRefs,
      getCachedPermissionProfilesSync: () => {
        try {
          const provider = view.runSession?.getSession()?.provider as
            { getCachedPermissionProfilesSync?: () => { data: Array<{ id: string; description: string | null; allowed: boolean }> } | null } | undefined;
          const fn = provider?.getCachedPermissionProfilesSync;
          if (typeof fn !== "function") return null;
          const resp = fn.call(provider);
          return resp?.data ?? null;
        } catch {
          return null;
        }
      },
      isDeveloperMode: () => !!view.plugin.settings.developerMode,
    };
  }

  async onClose(): Promise<void> {
    this.closeModelEffortPopover();
    this.closePermissionPopover();
    this.closeMentionPicker();
    this.composerController.destroy();
    if (this.modelCatalogRefreshTimer !== null) {
      window.clearTimeout(this.modelCatalogRefreshTimer);
      this.modelCatalogRefreshTimer = null;
    }
    if (this.runSession.runHandle) {
      this.runSession.stop();
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
    if (this.streamDetailsTimerId !== null) {
      window.clearTimeout(this.streamDetailsTimerId);
      this.streamDetailsTimerId = null;
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
    this.scheduleDynamicModelCatalogRefresh();
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

  /**
   * Build the RunSessionHost adapter that exposes view methods/fields to
   * RunSessionController. The controller accesses all DOM/UI concerns through
   * this interface — it never touches the DOM directly.
   */
  private buildRunSessionHost(): RunSessionHost {
    const view = this;
    return {
      plugin: view.plugin,
      app: view.app,
      getComposerInput: () => view.inputEl.value,
      clearComposerInput: () => {
        view.inputEl.value = "";
        // 清空发送框时同步清除附件高亮残留（input 事件不会自动触发）
        if (view.composerController.selectedAttachmentId) {
          view.composerController.selectedAttachmentId = null;
          view.renderComposerFileRefs();
        }
      },
      clearRuntimeCapabilitySelection: () => {
        view.selectedRuntimeCapabilities = [];
        view.renderComposerRuntimeCapabilityChips();
      },
      setRuntimeInstallUi: (state, title) => view.setRuntimeInstallUi(state, title),
      isRuntimeInstallActionAvailable: () => !!view.runtimeInstallBtnEl && !view.runtimeInstallBtnEl.disabled,
      setAssistantWatchdogHint: (assistantId, text) => view.setAssistantWatchdogHint(assistantId, text),
      get messages() { return view.messages; },
      get messageFileRefs() { return view.messageFileRefs; },
      get pinnedFileRefs() { return view.pinnedFileRefs; },
      get currentAssistantId() { return view.currentAssistantId; },
      get lastPreflightResult() { return view.lastPreflightResult; },
      pendingPermissions: view.pendingPermissions,
      staleApprovalRequestIds: view.staleApprovalRequestIds,
      get pendingUserInputDrafts() { return view.pendingUserInputDrafts as Map<string, unknown>; },
      get sessionState() { return view.sessionState; },
      set sessionState(v) { view.sessionState = v; },
      get currentSessionId() { return view.currentSessionId; },
      set currentSessionId(v) { view.currentSessionId = v; },
      get selectedRuntimeCapabilities() { return view.selectedRuntimeCapabilities; },
      set selectedRuntimeCapabilities(v) { view.selectedRuntimeCapabilities = v; },
      getActiveFile: () => view.getActiveFile(),
      getSelection: () => view.getSelection(),
      getFileRefPreviewText: (ref) => view.getFileRefPreviewText(ref),
      getPromptFileRefs: (refs) => view.getPromptFileRefs(refs),
      getPromptAttachmentSnippets: (refs) => view.getPromptAttachmentSnippets(refs),
      getVaultPath: () => view.getVaultPath(),
      appendUserMessage: (text, fileRefs?) => view.appendUserMessage(text, fileRefs),
      appendAssistantPlaceholder: () => view.appendAssistantPlaceholder(),
      updateAssistantMessage: (id, patch) => view.updateAssistantMessage(id, patch),
      setGlobalStatus: (status) => view.setGlobalStatus(status),
      refreshStatusBar: () => view.refreshStatusBar(),
      refreshPermissionModeChip: () => view.refreshPermissionModeChip(),
      refreshPermissionPanel: () => view.refreshPermissionPanel(),
      refreshUserInputPanel: () => view.refreshUserInputPanel(),
      clearPendingPermissions: () => view.clearPendingPermissions(),
      clearPendingUserInputRequests: () => view.clearPendingUserInputRequests(),
      clearApprovalUiState: () => view.clearApprovalUiState(),
      flushStreamDetailsRefresh: () => view.flushStreamDetailsRefresh(),
      scheduleStreamDetailsRefresh: (id) => view.scheduleStreamDetailsRefresh(id),
      scheduleAssistantContentPaint: (id) => view.scheduleAssistantContentPaint(id),
      patchRunningStatusLine: (id) => view.patchRunningStatusLine(id),
      isStructuralTurnChange: (prev, next) => view.isStructuralTurnChange(prev, next),
      appendLiveSdkEvent: (ev) => view.appendLiveSdkEvent(ev),
      // V18-APPEND: begin/complete/fail/getAppendTimelineNodes 已删除，追加节点在 controller 直接调用 turnBuilder
      setResumeDegraded: (degraded) => view.setResumeDegraded(degraded),
      showRunFlowStarted: (promptLength) => view.showRunFlowStarted(promptLength),
      showRunFlowTrace: (trace, finalStatus) => view.showRunFlowTrace(trace, finalStatus as RunStatus),
      autoGrowInput: () => view.autoGrowInput(),
      closeMentionPicker: () => view.closeMentionPicker(),
      clearMessageContext: () => view.clearMessageContext(),
      renderComposerRuntimeCapabilityChips: () => view.renderComposerRuntimeCapabilityChips(),
      buildRuntimeCapabilities: (providerId, settings) => view.buildRuntimeCapabilities(providerId, settings),
      buildUserInputWithRuntimeCapabilityHints: (text) => view.buildUserInputWithRuntimeCapabilityHints(text),
      buildSdkStreamingInput: (userPrompt, refs) => view.buildSdkStreamingInput(userPrompt, refs),
      ensureManagedCodexPluginsCached: () => view.ensureManagedCodexPluginsCached(),
      ensureCodexSkillsPreparedCached: (vaultPath) => view.ensureCodexSkillsPreparedCached(vaultPath),
      getManagedRuntimeInstallStatusForCurrentMode: () => view.getManagedRuntimeInstallStatusForCurrentMode(),
      refreshManagedRuntimeInstallAction: (status) => view.refreshManagedRuntimeInstallAction(status),
      commandLine: () => view.commandLine(),
      executeAgentFileToolRoute: (request) => view.executeAgentFileToolRoute(request),
      localizeRunStatus: (status) => view.localizeRunStatus(status),
      displayApprovalProfile: () => view.displayApprovalProfile(),
      refreshHistory: (force?) => view.refreshHistory(force),
      refreshSessionState: () => view.refreshSessionState(),
      applyRuntimeTokenUsage: (usedTokens, contextWindow) => view.applyRuntimeTokenUsage(usedTokens, contextWindow),
      onSkillsChanged: () => { void view.refreshAgentSkills(); },
    };
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

  /** RunSessionHost callback: manage install button state without exposing the element. */
  private setRuntimeInstallUi(state: "installing" | "idle", title?: string): void {
    if (!this.runtimeInstallBtnEl) return;
    if (state === "installing") {
      this.runtimeInstallBtnEl.disabled = true;
      this.runtimeInstallBtnEl.textContent = "Installing...";
      if (title) this.runtimeInstallBtnEl.setAttribute("title", title);
    } else {
      this.runtimeInstallBtnEl.disabled = false;
      this.runtimeInstallBtnEl.textContent = "Install Codex runtime";
      if (title) this.runtimeInstallBtnEl.setAttribute("title", title);
    }
  }

  /** RunSessionHost callback: update assistant watchdog status text in-place (no rebuild). */
  private setAssistantWatchdogHint(assistantId: string, text: string): void {
    const block = this.messagesEl.querySelector(`[data-msg-id="${assistantId}"]`) as HTMLElement | null;
    // 限定在 msg-head 内查询，避免命中瀑布流里的 Thinking 过程节点
    const statusEl = block?.querySelector(".llm-bridge-msg-head .llm-bridge-run-status-text") as HTMLElement | null;
    if (statusEl) {
      statusEl.textContent = text;
      return;
    }
    this.updateAssistantMessage(assistantId, { content: text });
  }

  private setGlobalStatus(status: RunStatus): void {
    const runtimeLabel = this.actualRuntimeLabel;
    const installStatus = this.getManagedRuntimeInstallStatusForCurrentMode();
    const stateInfo = this.computeRuntimeStateLabel(status, installStatus);
    this.statusLabelEl.textContent = `${installStatus?.required ? "Codex runtime" : runtimeLabel} · ${stateInfo.label}`;
    this.statusDotEl.className = `llm-bridge-status-dot llm-bridge-status-dot-${status}`;
    this.statusDotEl.setAttribute("title", installStatus?.required ? this.formatRuntimeInstallTitle(installStatus) : STATUS_LABEL[status]);
    this.refreshManagedRuntimeInstallAction(installStatus);
    const running = status === "running";
    // 运行中同时保留停止与发送：发送按钮改为 turn/steer 的“追加指令”。
    this.stopBtn.style.display = running ? "inline-flex" : "none";
    this.sendBtn.style.display = "inline-flex";
    this.refreshSendButtonState(running);
    // 仅禁用真实 <button>；summary（扳手菜单）不是 button，不可设 disabled
    const allChips = this.contentEl.querySelectorAll(".llm-bridge-chip, .llm-bridge-agent-select, .llm-bridge-composer-tool-btn, .llm-bridge-command-menu-item, .llm-bridge-permission-chip, .llm-bridge-model-effort-chip, .llm-bridge-model-option, .llm-bridge-effort-option");
    allChips.forEach((c) => {
      if (c instanceof HTMLButtonElement) c.disabled = running;
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

  /** 空输入 / 无附件时发送钮灰显，不依赖 Notice 才能感知不可发送 */
  private refreshSendButtonState(runningOverride?: boolean): void {
    if (!this.sendBtn) return;
    const running = runningOverride ?? (this.sessionState?.status === "running");
    if (running) {
      const hasText = !!(this.inputEl && this.inputEl.value.trim().length > 0);
      const canSteer = hasText && this.messageFileRefs.length === 0;
      this.sendBtn.disabled = !canSteer;
      this.sendBtn.classList.toggle("is-unsendable", !canSteer);
      this.sendBtn.setAttribute("title", canSteer ? "追加到当前任务 (Enter)" : "输入文本后追加到当前任务");
      this.sendBtn.setAttribute("aria-label", canSteer ? "追加指令" : "不可追加");
      return;
    }
    const hasText = !!(this.inputEl && this.inputEl.value.trim().length > 0);
    const hasFiles = this.messageFileRefs.length > 0;
    const canSend = hasText || hasFiles;
    this.sendBtn.disabled = !canSend;
    this.sendBtn.classList.toggle("is-unsendable", !canSend);
    this.sendBtn.setAttribute("title", canSend ? "发送 (Enter)" : "输入内容后发送");
    this.sendBtn.setAttribute("aria-label", canSend ? "发送" : "不可发送");
  }

  /**
   * Phase 3: 统一 Runtime 状态标签计算。
   * 区分：未安装 / 准备中 / 运行中 / 失败 / 可用
   * 用于 setGlobalStatus 和 refreshStatusBar，消除中英文不一致。
   */
  private computeRuntimeStateLabel(
    status: RunStatus,
    installStatus: ManagedRuntimeInstallStatus | null,
  ): { label: string; state: string } {
    if (installStatus?.required) {
      return { label: "未安装", state: "not-installed" };
    }
    const verifying = installStatus?.integrityStatus === "pending" || installStatus?.status === "verifying";
    if (verifying) {
      return { label: "准备中", state: "preparing" };
    }
    if (status === "failed") {
      return { label: "失败", state: "failed" };
    }
    if (status === "running") {
      return { label: "运行中", state: "running" };
    }
    return { label: "可用", state: "available" };
  }

  // V1.1: 刷新状态栏（Backend 模式 / Agent / cwd / Preflight 状态）
  // V2.3: 新增权限策略 / 工具步骤 / agent 计数
  // V2.16-B: runtime status 显示实际 backend（SDK / Claude Code fallback / Claude Code / SDK unavailable）
  private refreshStatusBar(): void {
    const s = this.plugin.settings;
    // V2.17-A Completion: runtime label 由 BridgeSession.selectProvider 决定
    // （codex-app-server 在 auto 模式下优先；不可用回退 SDK / CLI）。
    // 不再在 view.ts 直接探测 isSdkAvailable。
    const runtimeLabel = this.runSession.getSession().displayLabel;
    this.actualRuntimeLabel = runtimeLabel;
    // Phase 4: 状态栏以实际 Runtime 为中心，显示 provider label 而非 backendMode 配置值
    this.statusBackendEl.querySelector(".llm-bridge-sb-value")!.textContent = runtimeLabel;
    this.statusBackendEl.setAttribute("title", `Runtime: ${runtimeLabel}（backend 模式: ${s.backendMode}）`);
    // Agent 类型：从本轮实际 session.providerId 派生（agentType 已降级为 CLI fallback 字段）
    const providerId = this.runSession.getSession().providerId;
    const providerLabel = providerId === "codex-managed-app-server" || providerId === "codex-app-server"
      ? "Codex"
      : providerId === "claude-cli" || providerId === "claude-sdk"
        ? "Claude"
        : providerId === "pi-sdk" || providerId === "pi-rpc"
          ? "Pi"
          : providerId;
    this.statusAgentEl.querySelector(".llm-bridge-sb-value")!.textContent = providerLabel;
    // V2.16-D: runtime status pill — Phase 3 统一使用 computeRuntimeStateLabel
    const installStatus = this.getManagedRuntimeInstallStatusForCurrentMode();
    const stateInfo = this.computeRuntimeStateLabel(this.sessionState.status, installStatus);
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    this.statusLabelEl.textContent = `${installStatus?.required ? "Codex runtime" : runtimeLabel} · ${stateInfo.label}`;
    this.statusDotEl.setAttribute("title", installStatus?.required ? this.formatRuntimeInstallTitle(installStatus) : STATUS_LABEL[this.sessionState.status] || "Runtime status");
    this.refreshManagedRuntimeInstallAction(installStatus);
    // Cwd（Vault 根目录）
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
    // 审批画像（优先显示本轮 EffectiveRunPlan 实际生效值）
    const profile = this.displayApprovalProfile();
    const profileInfo = getAgentApprovalProfileInfo(profile);
    this.statusPermModeEl.querySelector(".llm-bridge-sb-value")!.textContent = profileInfo.shortLabel;
    this.statusPermModeEl.setAttribute("title", `${profileInfo.title}\n${profileInfo.description}`);
    this.statusPermModeEl.classList.remove("is-safe", "is-caution", "is-danger", "is-ask", "is-auto", "is-full-access");
    this.statusPermModeEl.classList.add(`is-${profile}`);
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
    const permission = this.runSession.getSession().permission;
    const boundaryPending = permission.pending;

    if (!this.runSession.runHandle && boundaryPending.size === 0 && this.staleApprovalRequestIds.size > 0) {
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
          this.runSession.getSession().permission.cancelAllPending();
          this.refreshPermissionPanel();
          this.runSession.stop();
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
    if (this.runSession.getSession().userInput.pending.size > 0) {
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
      text: this.localizeRunStatus(text),
    });
    if (kind === "running") {
      statusEl.addClass("llm-bridge-run-glow");
    }
  }

  /**
   * UI-01: 运行状态文本双语映射。
   * 将内部英文状态名映射为用户友好的中文/英文标签，跟随 Obsidian locale。
   * Developer Mode 下保留原始英文（便于调试）。
   */
  private localizeRunStatus(text: string): string {
    if (this.plugin.settings.developerMode) return text;
    const loc = resolveUiLocale();
    if (loc === "en") return text;
    const map: Record<string, string> = {
      "Answered": "已完成",
      "Completed": "已完成",
      "Done": "已完成",
      "Processed": "已处理",
      "Processing": "正在处理",
      "Running": "正在处理",
      "Thinking": "正在思考",
      "Thought": "已思考",
      "Failed": "失败",
      "Stopped": "已停止",
      "Idle": "空闲",
      "Needs approval": "需要你的确认",
      "Needs input": "需要输入",
      "Waiting approval": "需要你的确认",
      "Waiting input": "需要输入",
      "Running command": "正在运行命令",
      "Reading files": "正在读取文件",
      "Searching": "正在搜索",
      "Writing files": "正在写入文件",
      "Viewing image": "正在查看图片",
      "Applying patch": "正在应用补丁",
      "Editing file": "正在编辑文件",
    };
    return map[text] ?? text;
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
        const presentation = describeComposerManagedCodexPluginFn(plugin);
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

    const pending = Array.from(this.runSession.getSession().userInput.pending.values());
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
    const permission = this.runSession.getSession().permission;
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
      } else if (wasKnownPending && this.runSession.runHandle) {
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
    if (this.runSession.getSession().userInput.resolveInput(requestId, response)) {
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
    this.runSession.getSession().permission.cancelAllPending();
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
    this.runSession.getSession().userInput.cancelAllPending();
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

  private handleMentionInput(): void {
    this.composerController.handleMentionInput();
  }

  // 空输入 52–64px；有内容最多 128px
  private autoGrowInput(): void {
    autoGrowInputDom(this.inputEl);
  }

  private handleMentionKeydown(e: KeyboardEvent): boolean {
    return this.composerController.handleMentionKeydown(e);
  }

  private closeMentionPicker(): void {
    this.composerController.closeMentionPicker();
  }

  private async addNativeSelectedAttachments(): Promise<void> {
    if (!this.attachmentFileInputEl?.files?.length) return;
    await this.addFilesFromFileList(this.attachmentFileInputEl.files);
    this.attachmentFileInputEl.value = "";
  }

  private async addFilesFromFileList(files: FileList, source = "native-picker"): Promise<FileRef[]> {
    const paths = await collectPathsAndCacheBlobsFromFileListFn(files, source, this.attachmentVaultWriter());
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
    const shouldAutoAttachText = shouldPersistLargeClipboardText(plainText);
    const paths = collectFilePathsFromClipboardEventFn(event);
    for (const cachedPath of await cachePathlessFilesFromFileListFn(data?.files, "paste", this.attachmentVaultWriter(), { clipboardText: plainText })) {
      if (!paths.includes(cachedPath)) paths.push(cachedPath);
    }
    const hasBinaryClipboardFile = hasNonTextClipboardFileBlobFn(data?.files);
    if (paths.length === 0 && !hasBinaryClipboardFile && shouldAutoAttachText) {
      const textPath = await persistClipboardTextToVaultFn(plainText, "paste", this.attachmentVaultWriter());
      if (textPath) paths.push(textPath);
    }
    if (paths.length === 0 && !plainText.trim()) {
      const imagePath = await persistElectronClipboardImageToVaultFn(this.attachmentVaultWriter());
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

  private async handleComposerDrop(event: DragEvent): Promise<void> {
    const paths = collectFilePathsFromDataTransferFn(event.dataTransfer);
    for (const cachedPath of await cachePathlessFilesFromFileListFn(event.dataTransfer?.files, "drop", this.attachmentVaultWriter())) {
      if (!paths.includes(cachedPath)) paths.push(cachedPath);
    }
    if (paths.length === 0) {
      new Notice("拖拽内容没有可用文件 path。");
      return;
    }
    const refs = await this.addUserFilePathsToContext(paths, "drop");
    new Notice(`已从拖拽添加 ${refs.length}/${paths.length} 个本轮附件`);
  }

  /** 附件摄入服务的 vault 写入接口（注入 this.app.vault 的子集） */
  private attachmentVaultWriter(): AttachmentVaultWriter {
    return {
      create: (relPath, content) => this.app.vault.create(relPath, content),
      createBinary: (relPath, data) => this.app.vault.createBinary(relPath, data),
      createFolder: (folder) => this.app.vault.createFolder(folder),
      getAbstractFileByPath: (relPath) => this.app.vault.getAbstractFileByPath(relPath),
    };
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

  private parseFileUriToPath(rawUri: string): string {
    return parseFileUriToPathFn(rawUri);
  }

  private refreshContextRefs(): void {
    if (this.pinnedContextEl) this.renderPinnedContext();
    if (this.filesContextEl) this.renderFilesContext();
    if (this.composerFileRefsEl) this.renderComposerFileRefs();
  }

  private renderComposerFileRefs(): void {
    renderComposerFileRefsDom(this.composerFileRefsEl, this.messageFileRefs, this.composerController.selectedAttachmentId, {
      setSelectedAttachmentId: (id) => { this.composerController.selectedAttachmentId = id; },
      renderToken: (container, ref, allowRemove) => this.renderComposerAttachmentToken(container, ref, allowRemove),
    });
    this.refreshSendButtonState();
  }

  private shortAttachmentName(name: string, max = 14): string {
    return shortAttachmentNameDom(name, max);
  }

  private renderComposerAttachmentToken(container: HTMLElement, ref: FileRef, allowRemove: boolean): void {
    renderComposerAttachmentTokenDom(container, ref, allowRemove, {
      selectedAttachmentId: this.composerController.selectedAttachmentId,
      getFileRefThumbnailUrl: (r) => this.getFileRefThumbnailUrl(r),
      getFileRefIconName: (r) => this.getFileRefIconName(r),
      getSmartImageThumbnailCacheKey: (r, url) => getSmartImageThumbnailCacheKey(r, url),
      maybeApplySmartImageThumbnail: (img, key) => maybeApplySmartImageThumbnail(img, key, this.smartImageThumbnailCache),
      openFileRefPreview: (r) => { void this.openFileRefPreview(r); },
      showAttachmentContextMenu: (event, r, options) => this.showAttachmentContextMenu(event, r, options),
      closeAttachmentContextMenu: () => this.closeAttachmentContextMenu(),
    });
  }

  private showAttachmentContextMenu(
    event: MouseEvent,
    ref: FileRef,
    options: { allowRemove: boolean; allowOpen: boolean },
  ): void {
    this.composerController.showAttachmentContextMenu(event, ref, options);
  }

  private closeAttachmentContextMenu(updateActive = true): void {
    this.composerController.closeAttachmentContextMenu(updateActive);
  }

  /** 空输入时 Backspace 选中/删除附件；有文本时优先删文字 */
  private handleComposerAttachmentKeydown(e: KeyboardEvent): boolean {
    return this.composerController.handleComposerAttachmentKeydown(e);
  }

  private async copyFileRefToClipboard(ref: FileRef): Promise<void> {
    const filePath = ref.resolvedPath || "";
    try {
      if (ref.fileType === "image" && filePath && fs.existsSync(filePath)) {
        try {
          // Obsidian/Electron：复制为系统剪贴板图片
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const electron = (window as unknown as { require?: (id: string) => unknown }).require?.("electron") as {
            clipboard?: { writeImage?: (img: unknown) => void };
            nativeImage?: { createFromPath?: (p: string) => unknown };
          } | undefined;
          const image = electron?.nativeImage?.createFromPath?.(filePath);
          if (image && electron?.clipboard?.writeImage) {
            electron.clipboard.writeImage(image);
            new Notice("已复制图片到剪贴板");
            return;
          }
        } catch {
          // fall through to path
        }
        await navigator.clipboard.writeText(filePath);
        new Notice("无法复制图片数据，已复制图片路径");
        return;
      }
      if ((ref.fileType === "markdown" || ref.fileType === "text" || ref.fileType === "json") && filePath && fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, "utf8");
        await navigator.clipboard.writeText(text);
        new Notice("已复制文件内容");
        return;
      }
      const snippet = this.getFileRefPreviewText(ref) || this.attachmentTextSnippets.find((s) => s.refId === ref.id)?.content;
      if (snippet) {
        await navigator.clipboard.writeText(snippet);
        new Notice("已复制文本内容");
        return;
      }
      const pathOrRef = filePath || ref.displayName || ref.id;
      await navigator.clipboard.writeText(pathOrRef);
      new Notice(filePath ? "已复制文件路径" : "已复制文件引用");
    } catch {
      new Notice("复制失败");
    }
  }

  private getFileRefShortLabel(ref: FileRef): string {
    return getFileRefShortLabelFn(ref);
  }

  private shortLabelForPath(displayPath: string, fileType: string): string {
    return shortLabelForPathFn(displayPath, fileType);
  }

  private getFileRefIconName(ref: FileRef): string {
    return getFileRefIconNameFn(ref);
  }

  private fileTypeIconName(fileType: string): string {
    return fileTypeIconNameFn(fileType);
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
    return imageMimeTypeForPathFn(filePath);
  }

  // getSmartImageThumbnailCacheKey / maybeApplySmartImageThumbnail / buildSmartImageThumbnailDataUrl
  // 已抽取到 ./ui/smartImageThumbnail（渐进拆分 P0）

  private fileRefDisplayPath(ref: FileRef): string {
    const vaultRelPath = this.resolveFileRefVaultPath(ref);
    if (vaultRelPath) return vaultRelPath;
    const raw = (ref.requestedPath || ref.resolvedPath || ref.displayName).replace(/\\/g, "/");
    const parts = raw.split("/").filter(Boolean);
    if (parts.length <= 3) return raw || ref.displayName;
    return `.../${parts.slice(-3).join("/")}`;
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

  private contextRefChipDeps(): ContextRefChipDeps {
    return {
      fileRefDisplayPath: (ref) => this.fileRefDisplayPath(ref),
      fileRefBadgeLabel: (ref) => this.fileRefBadgeLabel(ref),
      getFileRefThumbnailUrl: (ref) => this.getFileRefThumbnailUrl(ref),
      getFileRefIconName: (ref) => this.getFileRefIconName(ref),
      renderDocumentPreviewThumb: (parent, thumbClass, lineClass, ref, maxLines, maxChars) =>
        this.renderDocumentPreviewThumb(parent, thumbClass, lineClass, ref, maxLines, maxChars),
      openFileRefPreview: (ref) => { void this.openFileRefPreview(ref); },
      copyFileRefToClipboard: (ref) => { void this.copyFileRefToClipboard(ref); },
      unpinFileRef: (refId) => this.unpinFileRef(refId),
      removeContextFileRef: (refId) => this.removeContextFileRef(refId),
      getFileRefPreviewText: (ref) => this.getFileRefPreviewText(ref),
    };
  }

  private renderPinnedContext(): void {
    renderPinnedContextDom(this.pinnedContextEl, this.pinnedFileRefs, this.contextRefChipDeps());
  }

  private renderFilesContext(): void {
    renderFilesContextDom(this.filesContextEl, {
      messageFileRefs: this.messageFileRefs,
      pinnedFileRefs: this.pinnedFileRefs,
      sessionFileRefs: this.sessionFileRefs,
    }, this.contextRefChipDeps());
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
      actions: { allowPin?: boolean; allowUnpin?: boolean; allowRemove?: boolean; allowCopy?: boolean };
    },
  ): void {
    renderFileContextSectionDom(container, options, this.contextRefChipDeps());
  }

  private renderContextRefChip(container: HTMLElement, ref: FileRef, options: { allowPin?: boolean; allowUnpin?: boolean; allowRemove?: boolean; allowCopy?: boolean }): void {
    renderContextRefChipDom(container, ref, options, this.contextRefChipDeps());
  }

  private renderContextRefVisual(parent: HTMLElement, ref: FileRef): void {
    renderContextRefVisualDom(parent, ref, this.contextRefChipDeps());
  }

  private fileRefBadgeLabel(ref: FileRef): string {
    return fileRefBadgeLabelFn(ref, this.getFileRefPreviewText(ref));
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
    await renderFilePreviewModalContentFn(modal, ref, this.filePreviewOpenerDeps());
    modal.open();
  }

  private async readFileRefPreviewText(ref: FileRef): Promise<string | null> {
    return readFileRefPreviewTextFn(ref, this.filePreviewOpenerDeps());
  }

  private filePreviewOpenerDeps(): FilePreviewOpenerDeps {
    return {
      app: this.app,
      fileRefDisplayPath: (ref) => this.fileRefDisplayPath(ref),
      getFileRefThumbnailUrl: (ref) => this.getFileRefThumbnailUrl(ref),
      getFileRefIconName: (ref) => this.getFileRefIconName(ref),
      getFileRefPreviewText: (ref) => this.getFileRefPreviewText(ref),
      resolveFileRefVaultPath: (ref) => this.resolveFileRefVaultPath(ref),
      resolveFileRefAbsolutePath: (ref) => this.resolveFileRefAbsolutePath(ref),
      getIndexedVaultFile: (vaultRelPath) => this.getIndexedVaultFile(vaultRelPath),
    };
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

  /**
   * 通过完整路径打开 vault 内文件（Obsidian 新标签页）。
   * `.obsidian/` 等配置区通常不是 TFile，优先走 openWithDefaultApp，再回退系统打开。
   * 返回 false 表示文件不在 vault 内，调用方应回退到系统默认应用。
   */
  private async openVaultFileByPath(fullPath: string): Promise<boolean> {
    const vaultPath = this.getVaultPath();
    let relPath: string;
    let absolutePath = fullPath;
    // Strip trailing :line / :line:col that often appear in assistant citations.
    const stripped = fullPath.replace(/\\/g, "/").replace(/:(\d+)(?::\d+)?$/, "");
    const candidate = stripped !== fullPath.replace(/\\/g, "/") ? stripped : fullPath;
    if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
      absolutePath = candidate.replace(/\//g, path.sep);
      const relative = path.relative(vaultPath, absolutePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
      relPath = relative.replace(/\\/g, "/");
    } else {
      relPath = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
      absolutePath = path.join(vaultPath, relPath);
    }
    const file = this.app.vault.getAbstractFileByPath(relPath);
    if (file instanceof TFile) {
      await this.openVaultFileFromAssistantLink(file);
      return true;
    }
    const openWithDefault = (this.app as unknown as {
      openWithDefaultApp?: (path: string) => Promise<void> | void;
    }).openWithDefaultApp;
    if (typeof openWithDefault === "function") {
      try {
        await openWithDefault.call(this.app, relPath);
        return true;
      } catch {
        // Fall through to system open for hidden / non-indexed paths.
      }
    }
    return this.openPathWithSystemDefault(absolutePath, false);
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
    renderExternalReadTargetDom(parent, req);
  }

  private renderExternalReadField(parent: HTMLElement, label: string, value: string): void {
    renderExternalReadFieldDom(parent, label, value);
  }

  private externalReadReasonLabel(reason: string): string {
    return externalReadReasonLabelFn(reason);
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
    // V18-APPEND: appendTimelineItems 已删除，追加节点在 turnBuilder 中随会话生命周期管理
    this.renderMessage(msg);
    return id;
  }

  private messageRendererDeps(): MessageRendererDeps {
    return {
      developerMode: !!this.plugin.settings.developerMode,
      renderMarkdownInto: (host, text) => {
        // 消息正文可能先 empty()；清掉 waterfall 用的 finalRendered 缓存以免跳过重渲
        delete host.dataset.finalRendered;
        this.renderMarkdownInto(host, text);
      },
      renderFileRefs: (parent, refs) => this.renderMessageFileRefs(parent, refs),
      onMessageAction: (action, msg) => { void this.handleMessageAction(action, msg); },
      appendMsgDetails: (block, msg, beforeEl) => this.appendMsgDetails(block, msg, beforeEl),
      scrollToBottom: (force) => this.scrollToBottom(force),
    };
  }

  private renderMessage(msg: ChatMessage): void {
    const loc = resolveUiLocale() === "en" ? "en" : "zh";
    const presentation = buildMessagePresentation(msg, {
      developerMode: !!this.plugin.settings.developerMode,
      locale: loc,
      runtimeLabel: this.actualRuntimeLabel,
    });
    renderMessageDom(this.messagesEl, msg, presentation, this.messageRendererDeps());
  }

  private renderMessageActions(block: HTMLElement, msg: ChatMessage, presentation: MessagePresentation): void {
    renderMessageActionsDom(block, msg, presentation, this.messageRendererDeps());
  }

  private async handleMessageAction(action: MessageActionId, msg: ChatMessage): Promise<void> {
    if (action === "copy") {
      const text = this.getAssistantCopyText(msg);
      if (!text) {
        new Notice("没有可复制的内容");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        new Notice("已复制");
      } catch {
        new Notice("复制失败");
      }
      return;
    }
    if (action === "retry") {
      await this.retryFromMessage(msg);
    }
    if (action === "fork") {
      await this.forkFromMessage(msg);
    }
  }

  private getAssistantCopyText(msg: ChatMessage): string {
    if (msg.role === "user") return msg.content || "";
    const fromTurn = msg.assistantTurnView?.finalAnswer?.trim();
    if (fromTurn) return fromTurn;
    return (msg.content || "").trim();
  }

  private async retryFromMessage(msg: ChatMessage): Promise<void> {
    if (this.runSession.runHandle) {
      new Notice("当前仍有运行中的任务");
      return;
    }
    // 找到该 assistant 之前最近一条 user 消息
    const idx = this.messages.findIndex((m) => m.id === msg.id);
    let userText = "";
    let userFileRefs: ReadonlyArray<FileRef> = [];
    for (let i = idx - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") {
        userText = this.messages[i].content || "";
        userFileRefs = this.messages[i].fileRefs ?? [];
        break;
      }
    }
    if (!userText.trim() && userFileRefs.length === 0) {
      new Notice("找不到可重试的用户消息");
      return;
    }
    if (msg.assistantTurnView?.fileChanges && msg.assistantTurnView.fileChanges.length > 0) {
      const ok = window.confirm("该回答已修改文件。再次发送可能重复执行相同操作，是否继续？");
      if (!ok) return;
    }
    this.inputEl.value = userText;
    this.autoGrowInput();
    // Phase 3: 恢复原消息的图片和文件附件（深拷贝避免修改原消息快照）
    this.messageFileRefs = userFileRefs.map((ref) => ({ ...ref }));
    this.composerController.selectedAttachmentId = null;
    this.renderComposerFileRefs();
    // V17-RETRY: 重新读取、授权和生成附件片段（不依赖旧 attachmentTextSnippets 运行时状态）
    await this.recomputeMessageAttachmentSnippetsForRetry(this.messageFileRefs);
    await this.runSession.run();
  }

  /** V17-FORK: 从指定回答分叉会话（仅 codex-app-server 支持 native fork）。 */
  private async forkFromMessage(msg: ChatMessage): Promise<void> {
    if (this.runSession.runHandle) {
      new Notice("当前仍有运行中的任务");
      return;
    }
    const session = this.runSession.getSession();
    const supportsNativeActions = session.providerId === "codex-managed-app-server"
      || session.providerId === "codex-app-server";
    if (!supportsNativeActions) {
      new Notice("当前 provider 不支持分叉");
      return;
    }
    if (!session.activeNativeSessionRef?.threadId) {
      new Notice("当前会话没有 native thread，无法分叉");
      return;
    }
    // V18-FORK: 传入 provider-native turnId（非本地 assistantId），使分叉从指定回答处切断
    const lastTurnId = msg.assistantTurnView?.nativeTurnId;
    if (!lastTurnId) {
      new Notice("该回答缺少 nativeTurnId，无法定位分叉点（旧会话不支持分叉）");
      return;
    }
    // V19-FORK: 先 RPC 成功再切换本地会话；失败则保持当前会话完全不变，不生成对话消息
    try {
      await this.runSession.runNativeAction({ kind: "fork", lastTurnId });
      this.beginLocalSessionFork();
    } catch (e) {
      const reason = (e as Error)?.message || String(e);
      new Notice(`分叉失败 · ${reason}`);
    }
  }

  private renderMessageContent(content: HTMLElement, msg: ChatMessage): void {
    renderMessageContentDom(content, msg, this.messageRendererDeps());
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
      void this.openAssistantMarkdownVaultTarget(targetFile);
    }, true);
  }

  private resolveAssistantMarkdownVaultLink(anchor: HTMLAnchorElement): {
    file: TFile | null;
    path: string;
    absolutePath?: string;
    line?: number;
  } | null {
    const rawTarget = anchor.getAttribute("data-href")
      || anchor.getAttribute("href")
      || anchor.textContent
      || "";
    const parsed = this.normalizeAssistantMarkdownLinkTarget(rawTarget);
    if (!parsed.path) return null;
    if (/^(?:https?:|mailto:|tel:|#)/i.test(parsed.path)) return null;

    const linkText = parsed.path;
    const sourcePath = this.getActiveFile()?.path || "";
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
    if (linkedFile instanceof TFile) {
      return { file: linkedFile, path: linkedFile.path, line: parsed.line };
    }

    const vaultPath = this.getVaultPath().replace(/\\/g, "/");
    let vaultRel = linkText.replace(/^\/+/, "");
    let absolutePath: string | undefined;

    if (path.isAbsolute(linkText) || /^[A-Za-z]:\//.test(linkText)) {
      absolutePath = linkText.replace(/\//g, path.sep);
      const relative = path.relative(this.getVaultPath(), absolutePath).replace(/\\/g, "/");
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        vaultRel = relative;
      }
    } else if (vaultPath && linkText.toLowerCase().startsWith(vaultPath.toLowerCase() + "/")) {
      vaultRel = linkText.slice(vaultPath.length + 1);
      absolutePath = linkText.replace(/\//g, path.sep);
    }

    const directPath = normalizePath(vaultRel);
    const directFile = this.app.vault.getAbstractFileByPath(directPath);
    if (directFile instanceof TFile) {
      return { file: directFile, path: directFile.path, absolutePath, line: parsed.line };
    }

    if (!/\.[^/\\]+$/.test(directPath)) {
      const markdownFile = this.app.vault.getAbstractFileByPath(`${directPath}.md`);
      if (markdownFile instanceof TFile) {
        return { file: markdownFile, path: markdownFile.path, absolutePath, line: parsed.line };
      }
    }

    // Basename-only / ambiguous relative links: retry linkpath resolution from vault root.
    const baseName = directPath.split("/").pop() || directPath;
    if (baseName && baseName !== linkText) {
      const byName = this.app.metadataCache.getFirstLinkpathDest(baseName, "");
      if (byName instanceof TFile) {
        return { file: byName, path: byName.path, absolutePath, line: parsed.line };
      }
    }

    return {
      file: null,
      path: directPath || linkText,
      absolutePath: absolutePath || (path.isAbsolute(linkText) || /^[A-Za-z]:\//.test(linkText)
        ? linkText.replace(/\//g, path.sep)
        : undefined),
      line: parsed.line,
    };
  }

  private normalizeAssistantMarkdownLinkTarget(value: string): { path: string; line?: number } {
    let text = value.trim();
    if (!text) return { path: "" };
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the raw link if it is not URI encoded.
    }
    if (/^file:/i.test(text)) {
      text = this.parseFileUriToPath(text).replace(/\\/g, "/");
    }
    if (/^app:\/\/obsidian\.md\//i.test(text)) {
      text = text.replace(/^app:\/\/obsidian\.md\//i, "");
    }
    const obsidianOpen = text.match(/^obsidian:\/\/open\?(.+)$/i);
    if (obsidianOpen?.[1]) {
      const params = new URLSearchParams(obsidianOpen[1]);
      text = params.get("path") || params.get("file") || text;
    }
    text = text
      .replace(/[?#].*$/, "")
      .replace(/\\/g, "/")
      .trim();

    // Editor-style "path:line" / "path:line:column" (keep drive letters like D:/...)
    let line: number | undefined;
    const lineMatch = text.match(/^(.*):(\d+)(?::\d+)?$/);
    if (lineMatch?.[1] && lineMatch[2] && !/^[A-Za-z]$/.test(lineMatch[1])) {
      text = lineMatch[1];
      line = Number(lineMatch[2]);
    }
    return { path: text, line: Number.isFinite(line) ? line : undefined };
  }

  private async openAssistantMarkdownVaultTarget(target: {
    file: TFile | null;
    path: string;
    absolutePath?: string;
    line?: number;
  }): Promise<void> {
    if (target.file) {
      await this.openVaultFileFromAssistantLink(target.file, target.line);
      return;
    }

    const vaultRel = this.toVaultRelativeAssistantPath(target.absolutePath || target.path);
    if (vaultRel) {
      // Newly written notes may not be indexed yet — retry briefly before failing.
      const indexed = await this.getIndexedVaultFile(vaultRel);
      if (indexed) {
        await this.openVaultFileFromAssistantLink(indexed, target.line);
        return;
      }
      try {
        await this.app.workspace.openLinkText(vaultRel, "", false);
        return;
      } catch {
        // Fall through to not-found modal for vault-scoped targets.
      }
      // Vault-intent links must never hit Windows shell.openPath (shows a system error dialog).
      this.showFileNotFoundModal(vaultRel);
      return;
    }

    // Truly external (outside vault): keep system-open behavior.
    const systemTarget = target.absolutePath
      || (path.isAbsolute(target.path) ? target.path : "");
    if (!systemTarget) {
      new Notice(`未找到可打开的文件：${target.path}`, 4000);
      return;
    }
    const opened = await this.openPathWithSystemDefault(systemTarget, true);
    if (!opened) {
      new Notice(`无法打开外部文件：${systemTarget}`, 4000);
    }
  }

  /** Map absolute / vault-relative assistant link targets to a vault-relative path, or null if outside vault. */
  private toVaultRelativeAssistantPath(rawPath: string): string | null {
    const vaultPath = this.getVaultPath();
    if (!rawPath || !vaultPath) return null;
    let candidate = rawPath.trim().replace(/\\/g, "/");
    if (/^file:/i.test(candidate)) {
      candidate = this.parseFileUriToPath(candidate).replace(/\\/g, "/");
    }
    candidate = candidate.replace(/:(\d+)(?::\d+)?$/, "");

    if (path.isAbsolute(candidate) || /^[A-Za-z]:\//.test(candidate)) {
      const absolute = candidate.replace(/\//g, path.sep);
      const relative = path.relative(vaultPath, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
      return normalizePath(relative.replace(/\\/g, "/"));
    }

    const vaultPosix = vaultPath.replace(/\\/g, "/");
    if (candidate.toLowerCase().startsWith(vaultPosix.toLowerCase() + "/")) {
      return normalizePath(candidate.slice(vaultPosix.length + 1));
    }
    return normalizePath(candidate.replace(/^\/+/, ""));
  }

  private async openVaultFileFromAssistantLink(file: TFile, line?: number): Promise<void> {
    try {
      const existingLeaf = this.findLeafForFile(file);
      const leaf = existingLeaf ?? this.app.workspace.getLeaf("tab");
      const openState = line && line > 0 ? { eState: { line: Math.max(0, line - 1) } } : undefined;
      await leaf.openFile(file, openState);
      this.app.workspace.revealLeaf(leaf);
      this.rememberActiveFile(file);
    } catch (error) {
      new Notice(`无法打开文件：${file.path} (${error instanceof Error ? error.message : String(error)})`, 5000);
    }
  }

  private renderMessageFileRefs(parent: HTMLElement, refs: ReadonlyArray<FileRef>): void {
    renderMessageFileRefsDom(parent, refs, {
      getFileRefThumbnailUrl: (ref) => this.getFileRefThumbnailUrl(ref),
      getSmartImageThumbnailCacheKey: (ref, url) => getSmartImageThumbnailCacheKey(ref, url),
      maybeApplySmartImageThumbnail: (img, cacheKey) => maybeApplySmartImageThumbnail(img, cacheKey, this.smartImageThumbnailCache),
      renderDocumentPreviewThumb: (p, thumbClass, lineClass, ref, maxLines, maxChars) =>
        this.renderDocumentPreviewThumb(p, thumbClass, lineClass, ref, maxLines, maxChars),
      shortAttachmentName: (name) => this.shortAttachmentName(name),
      closeAttachmentContextMenu: () => this.closeAttachmentContextMenu(),
      openFileRefPreview: (ref) => { void this.openFileRefPreview(ref); },
      showAttachmentContextMenu: (event, ref, options) => this.showAttachmentContextMenu(event, ref, options),
    });
  }

  private messageDetailsDeps(): MessageDetailsDeps {
    return {
      developerMode: !!this.plugin.settings.developerMode,
      buildDebugView: (msg: ChatMessage): AgentRunDebugView | undefined => {
        if (!this.plugin.settings.developerMode) return undefined;
        return {
          commandPreview: msg.commandPreview,
          effectiveRunPlan: msg.effectiveRunPlan,
          nativeSessionRef: this.runSession.session?.activeNativeSessionRef,
          sessionResumed: this.sessionResumed,
          attachmentPlan: msg.attachmentPlan,
          rawProviderEvents: msg.assistantTurnView?.rawProviderEvents ?? [],
          workflowTrace: msg.workflowTrace,
          sdkEvents: msg.sdkEvents,
          permissionSnapshot: {
            configuredPermissionMode: this.plugin.settings.claudePermissionMode,
            effectivePermissionMode: this.runSession.session?.permission.mode,
            sdkInitPermissionMode:
              msg.effectiveRunPlan && (msg.effectiveRunPlan.backend === "sdk" || msg.effectiveRunPlan.backend === "cli")
                ? msg.effectiveRunPlan.permission
                : undefined,
            canUseToolCalled: (msg.sdkEvents?.length ?? 0) > 0,
            approvalEvents: (msg.assistantTurnView?.approvals ?? []).map((ap) => ({
              requestId: ap.requestId,
              toolName: ap.toolName,
              pending: ap.pending,
              resolutionSource: ap.resolutionSource,
            })),
          },
        };
      },
      hasLiveAggregatorRawEvents: () => this.liveAggregator.toRawEvents().length > 0,
      renderAgentRunDisplayModel: this.renderAgentRunDisplayModel.bind(this),
      appendRunningProcessPlaceholder: this.appendRunningProcessPlaceholder.bind(this),
      appendCommandPreview: this.appendCommandPreview.bind(this),
      appendEffectiveRunPlan: this.appendEffectiveRunPlan.bind(this),
      appendWorkflowTrace: this.appendWorkflowTrace.bind(this),
      appendTimeline: this.appendTimeline.bind(this),
      appendSdkWorkflow: this.appendSdkWorkflow.bind(this),
      updateLastSdkStats: this.updateLastSdkStats.bind(this),
      appendCollapsible: this.appendCollapsible.bind(this),
      createCollapsibleSection: this.createCollapsibleSection.bind(this),
      appendDebugLogPath: this.appendDebugLogPath.bind(this),
      openGeneratedFile: (name: string) => { void this.openGeneratedFile(name); },
    };
  }

  // stderr / log / 生成文件，默认折叠；失败或有新文件时显著
  private appendMsgDetails(block: HTMLElement, msg: ChatMessage, beforeEl?: Element | null): void {
    appendMsgDetailsDom(block, msg, beforeEl, this.messageDetailsDeps());
  }

  private appendRunningProcessPlaceholder(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "llm-bridge-timeline-wrap llm-bridge-process-placeholder" });
    const head = wrap.createDiv({ cls: "llm-bridge-timeline-head llm-bridge-timeline-head-noclick" });
    // V16.4-H: 避免重复 Thinking，仅用 timeline-summary + run-glow class（CSS 控制是否 shimmer）
    const summary = head.createEl("span", { cls: "llm-bridge-timeline-summary llm-bridge-run-status-text is-running llm-bridge-run-glow", text: this.localizeRunStatus("Thinking") });
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
    const { model, codexRun, shouldUseCodexRunView } = this.runSession.buildDisplayModels(turnView, status, options);
    if (shouldUseCodexRunView && codexRun) {
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
    const rawHeaderText = (!isRunning && !isFailed && model.finalAnswerDisposition === "completed" && model.phaseModel.resultSummary)
      ? model.phaseModel.resultSummary
      : model.header;
    // UI-01: 本地化 header 中的状态文本（"Answered · 12s" → "已完成 · 12s"）
    const headerText = rawHeaderText.split(" · ").map((part) => this.localizeRunStatus(part)).join(" · ");
    // UI-01: 有过程内容时显示"运行详情"标签，无内容时不显示 toggle
    const loc = resolveUiLocale();
    const detailsLabel = loc === "zh" ? "运行详情" : "Run details";
    const toggle = hasProcessContent
      ? head.createEl("span", { cls: "llm-bridge-timeline-toggle", text: isRunning ? `▼ ${detailsLabel}` : `▶ ${detailsLabel}` })
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
          toggle.textContent = `▼ ${detailsLabel}`;
        } else {
          body.setAttribute("hidden", "");
          toggle.textContent = `▶ ${detailsLabel}`;
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
    mountOrReconcileCodexRun(
      { mode: "mount", parent },
      {
        run,
        developerMode,
        sourceModel,
        runtimeLabel: this.actualRuntimeLabel,
      },
      this.codexRunRenderDeps(),
    );
  }

  private renderCodexFeedItem(parent: HTMLElement, item: CodexRunFeedItem, developerMode: boolean): void {
    renderCodexFeedItemDom(parent, item, developerMode, this.codexFeedItemRenderDeps());
  }

  private renderMarkdownInto(host: HTMLElement, text: string): void {
    const normalized = text.trim();
    if (!normalized) return;
    if (host.dataset.finalRendered === normalized) return;
    host.dataset.finalRendered = normalized;
    host.empty();
    const fallback = () => {
      host.empty();
      host.textContent = normalized;
    };
    try {
      void MarkdownRenderer.render(this.app, normalized, host, "", this)
        .then(() => this.bindAssistantMarkdownVaultLinks(host))
        .catch(fallback);
    } catch {
      fallback();
    }
  }

  private codexFeedItemRenderDeps(): CodexFeedItemRenderDeps {
    return {
      developerMode: !!this.plugin.settings.developerMode,
      formatDurationMs: (ms) => this.formatDurationMs(ms),
      localizeRunStatus: (status) => this.localizeRunStatus(status),
      renderMarkdownInto: (host, text) => this.renderMarkdownInto(host, text),
      renderCodexDiffPreview: (parent, diff, diffSummary) => this.renderCodexDiffPreview(parent, diff, diffSummary),
      renderCodexStepPayload: (parent, step, developerMode, options) =>
        this.renderCodexStepPayload(parent, step, developerMode, options),
      renderCodexSourceRef: (parent, sourceRef, developerMode) =>
        this.renderCodexSourceRef(parent, sourceRef, developerMode),
      getVaultPath: () => this.getVaultPath(),
      openPathWithSystemDefault: (target) => { void this.openPathWithSystemDefault(target); },
      openVaultFile: (fullPath) => this.openVaultFileByPath(fullPath),
    };
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
        const permMode = this.runSession.session?.permission.mode;
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
   *
   * F-01: 委托到 toolPresentation 单一入口（经 toolDisplayLabel），消除重复逻辑。
   */
  private toolDisplayLabelForPhase(toolName: string, toolInput?: string): string {
    return toolDisplayLabelForPhaseFn(toolName, toolInput);
  }

  /**
   * P3: 渲染单个 AgentRunCard。委托到 ./ui/agentRunCardRenderer。
   */
  private renderAgentRunCard(parent: HTMLElement, card: AgentRunCard): void {
    renderAgentRunCardFn(parent, card, {
      formatDurationMs: (ms) => this.formatDurationMs(ms),
      resolvePermissionRequests: (ids, choice) => this.resolvePermissionRequests(ids, choice),
    });
  }

  private renderThinkingCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "thinking" }>): void {
    renderThinkingCardFn(parent, card);
  }

  private renderToolCallCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "tool-call" }>): void {
    renderToolCallCardFn(parent, card, {
      formatDurationMs: (ms) => this.formatDurationMs(ms),
      resolvePermissionRequests: (ids, choice) => this.resolvePermissionRequests(ids, choice),
    });
  }

  private renderCollapsedText(parent: HTMLElement, label: string, value?: string): void {
    renderCollapsedTextFn(parent, label, value);
  }

  private renderCollapsedJson(parent: HTMLElement, label: string, value: unknown): void {
    renderCollapsedJsonFn(parent, label, value);
  }

  private renderSourceRefDetail(parent: HTMLElement, card: AgentRunCard): void {
    renderSourceRefDetailFn(parent, card);
  }

  private renderFileChangeCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "file-change" }>): void {
    renderFileChangeCardFn(parent, card);
  }

  private renderApprovalCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "approval" }>): void {
    renderApprovalCardFn(parent, card, {
      formatDurationMs: (ms) => this.formatDurationMs(ms),
      resolvePermissionRequests: (ids, choice) => this.resolvePermissionRequests(ids, choice),
    });
  }

  private renderUserInputCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "user-input" }>): void {
    renderUserInputCardFn(parent, card);
  }

  private renderWarningCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "warning" }>): void {
    renderWarningCardFn(parent, card);
  }

  private renderErrorCard(parent: HTMLElement, card: Extract<AgentRunCard, { kind: "error" }>): void {
    renderErrorCardFn(parent, card);
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
    // native session audit
    if (debug.nativeSessionRef) {
      const auditBody = this.createCollapsibleSection(parent, "native session", "llm-bridge-native-session-audit", false);
      const lines: string[] = [];
      const ref = debug.nativeSessionRef;
      lines.push(`providerId: ${ref.providerId}`);
      lines.push(`kind: ${ref.kind}`);
      if (ref.threadId) lines.push(`threadId: ${ref.threadId}`);
      if (ref.sessionId) lines.push(`sessionId: ${ref.sessionId}`);
      lines.push(`updatedAt: ${ref.updatedAt}`);
      if (ref.sessionFileId) lines.push(`sessionFileId: ${ref.sessionFileId}`);
      if (debug.sessionResumed) lines.push("sessionResumed: true（恢复的会话）");
      auditBody.createEl("pre", { cls: "llm-bridge-native-session-audit-text", text: lines.join("\n") });
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

  // V18-APPEND: begin/complete/fail/getAppendTimelineNodes 已删除，
  // 追加节点直接进入 turnBuilder 的统一时间线（按时间排序），不再有独立双状态源。

  /** V17-RESUME-DEGRADED: 设置/清除 Resume 降级持久状态 */
  setResumeDegraded(degraded: boolean): void {
    if (degraded) {
      if (this.resumeDegradedEl) return;
      const banner = this.messagesEl.createDiv({
        cls: "llm-bridge-resume-degraded-banner",
        attr: { "data-persistent": "true" },
      });
      banner.createEl("span", { cls: "llm-bridge-resume-degraded-icon", text: "⚠" });
      banner.createEl("span", { cls: "llm-bridge-resume-degraded-text", text: "仅恢复记录 · 模型上下文已断开" });
      this.messagesEl.insertBefore(banner, this.messagesEl.firstChild);
      this.resumeDegradedEl = banner;
    } else {
      if (this.resumeDegradedEl) {
        this.resumeDegradedEl.remove();
        this.resumeDegradedEl = null;
      }
    }
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
    renderLiveTimelineDom(block, this.liveAggregator, this.liveTimelineRendererDeps());
  }

  private liveTimelineRendererDeps(): LiveTimelineRendererDeps {
    return {
      isDeveloperMode: () => !!this.plugin.settings.developerMode,
      localizeRunStatus: (text) => this.localizeRunStatus(text),
      scrollToBottom: () => this.scrollToBottom(),
      getLiveAggregatorNodes: () => this.liveAggregator.toTimelineNodes(),
      // V18-APPEND: getAppendTimelineItems 已删除，追加节点通过 turnView.turnTimeline 渲染
    };
  }

  /** V2.16-C: 工具图标 + 颜色分类 — F-01: 委托到 toolPresentation 单一入口 */
  private getToolIconAndCategory(toolName: string): { icon: string; category: string } {
    return getToolIconAndCategoryFn(toolName);
  }

  /**
   * V2.16-C: 渲染单个 timeline node（现代 Claude/Codex 风格垂直节点）
   */
  private filterUserFacingTimelineNodes(nodes: TimelineNode[]): TimelineNode[] {
    return filterUserFacingTimelineNodesFn(nodes, this.plugin.settings.developerMode);
  }

  private renderTimelineNode(parent: HTMLElement, node: TimelineNode, isLive: boolean): void {
    renderTimelineNodeDom(parent, node, isLive, this.liveTimelineRendererDeps());
  }

  private appendSdkWorkflow(
    parent: HTMLElement,
    events: ReadonlyArray<WorkflowEvent>,
    options: { processOnly?: boolean } = {},
  ): void {
    appendSdkWorkflowDom(parent, events, options, this.liveTimelineRendererDeps());
  }

  private formatProcessSummary(stats: ReturnType<typeof computeTimelineStats>): string {
    return formatProcessSummaryFn(stats);
  }

  // V2.0: 格式化耗时（ms → 可读字符串）
  private formatDurationMs(ms: number): string {
    return formatDurationMsFn(ms);
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

  /**
   * Phase 3: 一键复制脱敏诊断信息到剪贴板。
   * 聚合插件版本、Runtime 状态、设置、Bridge 信息，经 redactSecrets 脱敏后复制。
   */
  async copyDiagnosticsToClipboard(): Promise<void> {
    try {
      const s = this.plugin.settings;
      const installStatus = this.getManagedRuntimeInstallStatusForCurrentMode();
      const stateInfo = this.computeRuntimeStateLabel(this.sessionState.status, installStatus);
      const session = this.runSession.getSession();
      const httpBridge = this.plugin.getHttpBridge();
      const lines: string[] = [
        `=== LLM CLI Bridge 诊断信息 ===`,
        `时间: ${new Date().toISOString()}`,
        `插件版本: ${this.plugin.manifest.version}`,
        ``,
        `--- Runtime ---`,
        `状态: ${stateInfo.label} (${stateInfo.state})`,
        `显示标签: ${session.displayLabel}`,
        `Provider ID: ${session.providerId}`,
        `Backend 模式: ${s.backendMode}`,
        `Agent 类型: ${s.agentType} (CLI fallback)`,
        `模型: ${s.model}`,
        `Effort: ${s.effortLevel}`,
        `权限策略: ${s.permissionPolicy}`,
        `审批画像: ${s.agentApprovalProfile}`,
        ``,
        `--- 运行状态 ---`,
        `RunStatus: ${this.sessionState.status}`,
        `当前会话 ID: ${this.currentSessionId ?? "(none)"}`,
        `消息数: ${this.messages.length}`,
        `sessionResumed: ${this.sessionResumed}`,
        ``,
      ];
      if (installStatus) {
        lines.push(
          `--- Managed Runtime ---`,
          `required: ${installStatus.required}`,
          `status: ${installStatus.status}`,
          `version: ${installStatus.version ?? "(unknown)"}`,
          `integrityStatus: ${installStatus.integrityStatus ?? "N/A"}`,
          `error: ${installStatus.error ?? "(none)"}`,
          ``,
        );
      }
      if (httpBridge) {
        lines.push(
          `--- HTTP Bridge ---`,
          `状态: 运行中`,
          ``,
        );
      }
      lines.push(
        `--- 设置摘要 ---`,
        `backendProfile: ${s.backendProfile}`,
        `keepLastSession: ${s.keepLastSession}`,
        `includeActiveNote: ${s.includeActiveNote}`,
        `developerMode: ${s.developerMode}`,
        `settingsVersion: ${s.settingsVersion}`,
      );
      const raw = lines.join("\n");
      const sanitized = redactSecrets(raw);
      await navigator.clipboard.writeText(sanitized);
      new Notice("诊断信息已复制到剪贴板（已脱敏）");
    } catch (e) {
      new Notice(`复制诊断信息失败：${e instanceof Error ? e.message : String(e)}`);
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
    if (!block || !(block instanceof HTMLElement)) return;
    const loc = resolveUiLocale() === "en" ? "en" : "zh";
    const presentation = buildMessagePresentation(msg, {
      developerMode: !!this.plugin.settings.developerMode,
      locale: loc,
      runtimeLabel: this.actualRuntimeLabel,
    });
    applyAssistantMessagePresentationChromeDom(
      block,
      msg,
      presentation,
      !!this.plugin.settings.developerMode,
      STATUS_LABEL[msg.status],
    );

    const contentEl = block.querySelector<HTMLElement>(".llm-bridge-msg-content");
    if (contentEl) this.renderMessageContent(contentEl, msg);

    // 文本 delta：局部更新正文（含 Codex final-answer 节点），不重建过程
    if (contentOnly) {
      this.patchCodexFinalAnswerSurface(block, msg);
      this.scrollToBottom();
      return;
    }

    // 已有 Codex 过程视图：append-only / 局部更新，禁止删除重建
    const existingRun = block.querySelector<HTMLElement>(".llm-bridge-codex-run-view");
    if (existingRun && msg.assistantTurnView) {
      this.patchCodexRunViewInPlace(block, existingRun, msg, presentation);
      if (presentation.errorSummary) {
        let err = block.querySelector(".llm-bridge-msg-error-summary");
        if (!err) err = block.createDiv({ cls: "llm-bridge-msg-error-summary" });
        err.textContent = presentation.errorSummary;
      }
      const oldActions = block.querySelector(".llm-bridge-msg-actions");
      if (oldActions) oldActions.remove();
      this.renderMessageActions(block, msg, presentation);
      this.scrollToBottom();
      return;
    }

    // 首次创建过程区
    const oldDetails = block.querySelector(".llm-bridge-msg-details");
    if (oldDetails) oldDetails.remove();
    const oldSummary = block.querySelector(".llm-bridge-msg-result-summary");
    if (oldSummary) oldSummary.remove();
    const oldError = block.querySelector(".llm-bridge-msg-error-summary");
    if (oldError) oldError.remove();
    const oldActions = block.querySelector(".llm-bridge-msg-actions");
    if (oldActions) oldActions.remove();

    if (presentation.errorSummary) {
      block.createDiv({ cls: "llm-bridge-msg-error-summary", text: presentation.errorSummary });
    }
    this.appendMsgDetails(block, msg, contentEl);
    this.renderMessageActions(block, msg, presentation);
    this.scrollToBottom();
  }

  /** 流式正文：更新瀑布流中的 candidate 节点，不另建 Final Answer */
  private patchCodexFinalAnswerSurface(block: HTMLElement, msg: ChatMessage): void {
    const built = this.runSession.buildCodexRunForMessage(msg);
    if (!built) return;
    const wrap = block.querySelector<HTMLElement>(".llm-bridge-codex-run-view");
    if (!wrap) return;
    const processBody = wrap.querySelector<HTMLElement>(".llm-bridge-codex-process-body");
    if (!processBody) return;
    this.reconcileCodexRunWaterfall(processBody, built.run, {
      streaming: msg.status === "running",
      developerMode: !!this.plugin.settings.developerMode,
    });
  }

  /**
   * 过程区 append-only 局部更新：保留已渲染节点，只更新状态/文本并追加新 item。
   * 终态停止光效、弱化思考，不自动折叠、不清空。
   */
  private patchCodexRunViewInPlace(
    block: HTMLElement,
    wrap: HTMLElement,
    msg: ChatMessage,
    presentation: ReturnType<typeof buildMessagePresentation>,
  ): void {
    const built = this.runSession.buildCodexRunForMessage(msg);
    if (!built) return;
    const { run, model } = built;
    mountOrReconcileCodexRun(
      { mode: "patch", wrap },
      {
        run,
        developerMode: !!this.plugin.settings.developerMode,
        sourceModel: model,
        presentation,
        streaming: msg.status === "running",
        messageStatus: msg.status,
      },
      this.codexRunRenderDeps(),
    );
  }

  private codexRunRenderDeps(): CodexRunRenderDeps {
    return {
      localizeRunStatus: (status) => this.localizeRunStatus(status),
      renderRunStatusText: (el, label, kind) => this.renderRunStatusText(el, label, kind),
      resolvePermissionRequests: (requestIds, choice) => this.resolvePermissionRequests(requestIds, choice),
      renderCodexSourceRef: (parent, sourceRef, developerMode) =>
        this.renderCodexSourceRef(parent, sourceRef, developerMode),
      renderCodexCollapsedText: (parent, label, value) => this.renderCodexCollapsedText(parent, label, value),
      renderAgentRunDebugDrawer: (parent, debug) => this.renderAgentRunDebugDrawer(parent, debug),
      reconcileCodexRunWaterfall: (processBody, run, options) =>
        this.reconcileCodexRunWaterfall(processBody, run, options),
      upgradeCodexCandidateAnswerInFeed: (body, finalAnswer, streaming) =>
        upgradeCodexCandidateAnswerInFeedDom(body, finalAnswer, streaming, this.codexWaterfallDeps()),
    };
  }

  private codexWaterfallDeps(): CodexWaterfallPatchDeps {
    return {
      renderCodexFeedItem: (parent, item, developerMode) =>
        this.renderCodexFeedItem(parent, item, developerMode),
      renderMarkdownInto: (host, text) => this.renderMarkdownInto(host, text),
      formatDurationMs: (ms) => this.formatDurationMs(ms),
      localizeRunStatus: (status) => this.localizeRunStatus(status),
    };
  }

  /**
   * 初渲与增量共用的瀑布流 reconcile 主入口（实现见 src/ui/codexWaterfallRenderer.ts）。
   */
  private reconcileCodexRunWaterfall(
    processBody: HTMLElement,
    run: CodexRunViewModel,
    options: { streaming: boolean; developerMode: boolean },
  ): void {
    reconcileCodexRunWaterfallDom(processBody, run, options, this.codexWaterfallDeps());
  }

  private scheduleAssistantContentPaint(id: string): void {
    this.streamContentAssistantId = id;
    if (this.streamContentRafId !== null) return;
    this.streamContentRafId = window.requestAnimationFrame(() => {
      this.streamContentRafId = null;
      const nextId = this.streamContentAssistantId;
      this.streamContentAssistantId = null;
      if (!nextId) return;
      const nextMsg = this.messages.find((m) => m.id === nextId);
      const block = this.messagesEl.querySelector(`[data-msg-id="${nextId}"]`);
      if (!nextMsg || !(block instanceof HTMLElement)) return;
      const contentEl = block.querySelector<HTMLElement>(".llm-bridge-msg-content");
      if (contentEl) this.renderMessageContent(contentEl, nextMsg);
      this.patchCodexFinalAnswerSurface(block, nextMsg);
      this.scrollToBottom();
    });
  }

  private patchRunningStatusLine(id: string): void {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg || msg.status !== "running") return;
    const loc = resolveUiLocale() === "en" ? "en" : "zh";
    const presentation = buildMessagePresentation(msg, {
      developerMode: !!this.plugin.settings.developerMode,
      locale: loc,
      runtimeLabel: this.actualRuntimeLabel,
    });
    const block = this.messagesEl.querySelector(`[data-msg-id="${id}"]`);
    if (!block) return;
    // 限定在 msg-head 内查询，避免命中瀑布流里复用同 class 的 Thinking 过程节点
    const existingRunStatus = block.querySelector(".llm-bridge-msg-head .llm-bridge-msg-status-line, .llm-bridge-msg-head .llm-bridge-run-status-text");
    if (presentation.statusLine) {
      if (existingRunStatus) {
        existingRunStatus.textContent = presentation.statusLine;
        existingRunStatus.classList.add("is-running", "llm-bridge-run-glow");
      } else {
        const head = block.querySelector(".llm-bridge-msg-head");
        if (head) {
          head.createEl("span", {
            cls: "llm-bridge-msg-status-line llm-bridge-run-status-text is-running llm-bridge-run-glow",
            text: presentation.statusLine,
          });
        }
      }
    } else if (existingRunStatus) {
      // 首段回答到来：结束光效状态行（仅 head 内，不影响过程节点）
      existingRunStatus.remove();
    }
  }

  private isStructuralTurnChange(
    prev: ChatMessage["assistantTurnView"] | undefined,
    next: NonNullable<ChatMessage["assistantTurnView"]>,
  ): boolean {
    if (!prev) return true;
    const prevTools = prev.tools?.length ?? (prev as { processSteps?: unknown[] }).processSteps?.length ?? 0;
    const nextTools = next.tools?.length ?? (next as { processSteps?: unknown[] }).processSteps?.length ?? 0;
    if (prevTools !== nextTools) return true;
    if ((prev.fileChanges?.length ?? 0) !== (next.fileChanges?.length ?? 0)) return true;
    if ((prev.approvals?.length ?? 0) !== (next.approvals?.length ?? 0)) return true;
    const prevPending = prev.approvals?.filter((a) => a.pending).length ?? 0;
    const nextPending = next.approvals?.filter((a) => a.pending).length ?? 0;
    if (prevPending !== nextPending) return true;
    const prevUser = prev.userInputRequests?.length ?? 0;
    const nextUser = next.userInputRequests?.length ?? 0;
    if (prevUser !== nextUser) return true;

    // reasoning 文本变化 → 刷新过程区
    const thoughtLen = (turn: NonNullable<ChatMessage["assistantTurnView"]>) =>
      (turn.thoughts ?? []).reduce((sum, t) => sum + ((t.text || "").length), 0);
    if (thoughtLen(prev) !== thoughtLen(next)) return true;

    // timeline 节点 / imageView / 当前活动
    const summarizeTimeline = (turn: NonNullable<ChatMessage["assistantTurnView"]>) => {
      const flat: Array<{ kind: string; status: string; textLen: number }> = [];
      const visit = (nodes: ReadonlyArray<{ kind: string; status: string; text?: string; summary?: string; children?: ReadonlyArray<unknown> }>) => {
        for (const n of nodes) {
          flat.push({
            kind: n.kind,
            status: n.status,
            textLen: ((n.text || n.summary || "") as string).length,
          });
          if (n.children?.length) visit(n.children as typeof nodes);
        }
      };
      visit(turn.turnTimeline ?? []);
      const active = [...flat].reverse().find((n) => n.status === "running" || n.status === "blocked");
      return `${flat.length}|${active?.kind ?? ""}|${active?.status ?? ""}|${flat.filter((n) => n.kind === "imageView").length}|${flat.reduce((s, n) => s + n.textLen, 0)}`;
    };
    if (summarizeTimeline(prev) !== summarizeTimeline(next)) return true;

    return false;
  }

  private scheduleStreamDetailsRefresh(id: string): void {
    this.streamDetailsAssistantId = id;
    if (this.streamDetailsTimerId !== null) return;
    // 结构过程 150–250ms 合并刷新
    this.streamDetailsTimerId = window.setTimeout(() => {
      this.streamDetailsTimerId = null;
      this.flushStreamDetailsRefresh();
    }, 180);
  }

  private flushStreamDetailsRefresh(): void {
    if (this.streamDetailsTimerId !== null) {
      window.clearTimeout(this.streamDetailsTimerId);
      this.streamDetailsTimerId = null;
    }
    const id = this.streamDetailsAssistantId;
    this.streamDetailsAssistantId = null;
    if (!id) return;
    const msg = this.messages.find((m) => m.id === id);
    if (!msg || msg.status !== "running") return;
    this.updateAssistantMessage(id, {
      content: msg.content,
      stderr: msg.stderr,
      assistantTurnView: msg.assistantTurnView,
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

  // V2.0: 新建会话（清空消息 + 重置会话状态 + 清空运行流程区）
  // V2.5: 若当前有消息，先确认；重置 currentSessionId（新会话不绑定旧 id）
  private newSession(): void {
    if (this.runSession.runHandle) {
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
    // C-2: 若有 run 进行，先 stop 释放旧 session 资源（避免泄漏）
    if (this.runSession.runHandle) {
      this.runSession.stop();
    }
    // P4: 置空 session，使下一次 getSession() 创建新 BridgeSession + 新 PermissionBoundary，
    // 避免上一会话的 sessionAllows/sessionDenies 跨会话泄漏（auto-allow/auto-deny 误作用到新会话）。
    this.runSession.clearSession();
    this.messages = [];
    this.currentAssistantId = null;
    this.currentSessionId = null; // 新会话不绑定旧 id，下次运行将生成新 id
    this.messagesFoldExpanded = false; // V2.7: 重置折叠状态
    this.setResumeDegraded(false); // V17-RESUME-DEGRADED: 新会话清除降级状态
    this.sessionState = createNewSession();
    this.lastRuntimeTokenUsage = null;
    this.renderRuntimeContextRing();
    // latest native session only: 新会话清空 activeNativeSessionRef 回填缓存，
    // 避免把旧会话的 native session 带到新 BridgeSession 导致误 resume。
    this.runSession.setRestoredActiveNativeSessionRef(undefined);
    this.sessionResumed = false; // P3: 新会话是 fresh
    // latest native session only: 新聊天清空回填缓存即可，下一轮自然 thread/start 新 native session。
    // nativeSessionRef 只存在 session 文件（1:1 绑定），不在 settings 维护，无需清 settings。
    // V2.16-D: 新聊天清除 lastActiveSessionId（仅 keepLastSession 时持久化）
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

  /**
   * V17-TOPBAR-2ROW: 刷新第二排审查/压缩按钮的禁用/可见状态。
   * 仅 Codex app-server 系列 provider 显示；压缩额外要求已有 thread。
   */
  private refreshTopbarActionButtons(): void {
    if (!this.reviewBtn || !this.compactBtn) return;
    const session = this.runSession.getSession();
    const supportsNativeActions = session.providerId === "codex-managed-app-server"
      || session.providerId === "codex-app-server";
    const hasThread = !!session.activeNativeSessionRef?.threadId;
    const running = !!this.runSession.runHandle;
    this.reviewBtn.style.display = supportsNativeActions ? "" : "none";
    this.reviewBtn.disabled = !supportsNativeActions || running;
    this.compactBtn.style.display = supportsNativeActions ? "" : "none";
    this.compactBtn.disabled = !supportsNativeActions || !hasThread || running;
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

  // V2.16-D/E: 刷新 context 相关 chip 状态；占用环只吃 agent-runtime tokenUsage
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
      // developerMode：本地估算仅作明细诊断，不驱动占用环数字
      if (settings.developerMode) {
        const snapshot: StateSnapshot = {
          vaultPath,
          activeFilePath: activeFile?.path || null,
          activeFileContent: activeNoteContent || null,
          selection,
          fileRefIndex: buildPromptFileRefIndex({ refs: this.getPromptFileRefs() }),
          attachmentTextSnippets: this.getPromptAttachmentSnippets(this.getPromptFileRefs()),
          timestamp: new Date().toISOString(),
        };
        // Round 5: legacy buildPromptPackage() 字符串已废弃，改用 BridgePromptPackage
        // 的两段实际内容拼接估算——与真正发给 provider 的内容口径一致。
        const bridgePromptPackage = buildBridgePromptPackage("", snapshot, settings);
        const promptPackageText = bridgePromptPackage.bridgeSystemAppend + "\n" + bridgePromptPackage.userPrompt;
        const messageAttachmentsText = this.messageFileRefs.filter((r) => r.status === "active").map((r) => r.resolvedPath).join("\n");
        const pinnedContextText = this.pinnedFileRefs.filter((r) => r.status === "active").map((r) => r.resolvedPath).join("\n");
        const historyText = this.messages.map((m) => m.content || "").join("\n");
        this.lastContextMetrics = computeContextMetrics(
          promptPackageText, activeNoteContent, selection || "",
          messageAttachmentsText, pinnedContextText, historyText, settings.model,
        );
        this.renderContextDetail(this.lastContextMetrics);
      } else {
        this.contextDetailEl.empty();
        this.contextDetailEl.setAttribute("hidden", "");
      }
      this.renderRuntimeContextRing();
      this.refreshComposerStatusRail();
      this.refreshAllChips();
    } catch {
      this.refreshComposerStatusRail();
    }
  }

  /** RunSessionHost：Codex thread/tokenUsage/updated → 精确占用环 */
  private applyRuntimeTokenUsage(usedTokens: number, contextWindow: number | null): void {
    this.lastRuntimeTokenUsage = {
      usedTokens: Math.max(0, usedTokens),
      contextWindow,
      updatedAt: new Date().toISOString(),
    };
    this.renderRuntimeContextRing();
  }

  /** 占用环唯一数据源：agent-runtime tokenUsage；无信号时 unavailable */
  private renderRuntimeContextRing(): void {
    if (!this.contextRingEl || !this.contextTipEl) return;
    const usage = this.lastRuntimeTokenUsage;
    const win = usage?.contextWindow && usage.contextWindow > 0 ? usage.contextWindow : 0;
    const used = usage?.usedTokens ?? 0;
    const hasExact = !!usage && win > 0;
    const pct = hasExact ? Math.min(100, (used / win) * 100) : 0;
    const color = !hasExact
      ? "var(--text-faint)"
      : pct > 80
        ? "#e53935"
        : pct > 50
          ? "#f59e0b"
          : "var(--text-muted)";

    this.contextRingEl.classList.remove("is-exact", "is-estimated", "is-unavailable", "is-compressed");
    this.contextRingEl.classList.add(hasExact ? "is-exact" : "is-unavailable");
    this.contextRingEl.style.cssText = [
      `--llm-bridge-context-ring-pct: ${pct.toFixed(2)}`,
      `--llm-bridge-context-ring-fg: ${color}`,
      `--llm-bridge-context-ring-track: var(--background-modifier-border)`,
    ].join(";");

    const strip = this.contextRingEl.parentElement;
    if (strip) strip.classList.add("is-tooltip-only");

    if (!hasExact) {
      this.contextTipPctEl.textContent = "Context unavailable";
      this.contextTipTokensEl.textContent = "Waiting for runtime usage";
      this.contextTipEl.removeAttribute("hidden");
      this.contextLabelEl.textContent = "";
      return;
    }

    const tokensLine = `${formatTokens(used).toUpperCase()} / ${formatTokens(win).toUpperCase()} tokens`;
    const tipPct = `${Math.round(pct)}% context used`;
    this.contextTipPctEl.textContent = tipPct;
    this.contextTipTokensEl.textContent = tokensLine;
    this.contextTipEl.removeAttribute("hidden");
    // 不用 title/长 aria-label，避免 Obsidian 再出一层黑色 tip
    this.contextRingEl.removeAttribute("title");
    this.contextLabelEl.textContent = "";
    this.contextLabelEl.removeAttribute("title");
    if (strip) strip.setAttribute("aria-label", "Context");
  }

  private renderContextDetail(metrics: ContextMetrics): void {
    const isDev = !!this.plugin.settings.developerMode;
    this.contextDetailEl.empty();
    if (!isDev) {
      this.contextDetailEl.setAttribute("hidden", "");
      return;
    }
    this.contextDetailEl.removeAttribute("hidden");
    const precisionRow = this.contextDetailEl.createDiv({ cls: "llm-bridge-context-detail-row" });
    precisionRow.createEl("span", { cls: "llm-bridge-context-detail-label", text: "Source" });
    const runtime = this.lastRuntimeTokenUsage;
    precisionRow.createEl("span", {
      cls: "llm-bridge-context-detail-value",
      text: runtime
        ? `exact runtime usage (${formatTokens(runtime.usedTokens)} / ${runtime.contextWindow ? formatTokens(runtime.contextWindow) : "?"})`
        : "runtime usage pending; local estimate below",
    });
    const parts = [metrics.promptPackage, metrics.activeNote, metrics.selection, metrics.messageAttachments, metrics.pinnedContext, metrics.history, metrics.remaining];
    for (const part of parts) {
      const row = this.contextDetailEl.createDiv({ cls: "llm-bridge-context-detail-row" });
      row.createEl("span", { cls: "llm-bridge-context-detail-label", text: part.label });
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

  private renderAgentRunDebugDrawer(parent: HTMLElement, debug: AgentRunDebugView): void {
    const drawer = parent.createEl("details", { cls: "llm-bridge-codex-debug-drawer" });
    const summary = drawer.createEl("summary", { cls: "llm-bridge-codex-debug-drawer-summary" });
    summary.createEl("span", { cls: "llm-bridge-codex-debug-drawer-title", text: "Debug" });
    const count = debug.rawProviderEvents?.length ?? 0;
    if (count > 0) {
      summary.createEl("span", { cls: "llm-bridge-codex-debug-drawer-meta", text: `${count} raw events` });
    }
    const body = drawer.createDiv({ cls: "llm-bridge-codex-debug-drawer-body" });
    this.renderAgentRunDebugView(body, debug);
  }

  private refreshComposerStatusRail(): void {
    if (!this.composerStatusRailEl || !this.composerStatusTextEl || !this.composerStepPillEl) return;

    const latestTurn = this.getLatestAssistantTurnView();
    const turnStatus = latestTurn ? this.getComposerTurnStatus(latestTurn) : null;
    const compressionText = this.getContextCompressionStatusText();
    const shouldShow = !!turnStatus?.isActive || !!turnStatus?.isContextCompaction || !!compressionText;

    let state: ComposerStatusRailState | null = null;
    if (shouldShow) {
      const useTurnStatus = !!turnStatus && (turnStatus.isActive || turnStatus.isContextCompaction);
      state = {
        kind: useTurnStatus ? turnStatus!.kind : "compressed",
        label: useTurnStatus ? turnStatus!.label : compressionText ?? "",
        stepText: useTurnStatus ? turnStatus!.stepText : "",
      };
    }
    applyComposerStatusRailDom(
      {
        railEl: this.composerStatusRailEl,
        textEl: this.composerStatusTextEl,
        stepPillEl: this.composerStepPillEl,
      },
      state,
    );
  }

  private getLatestAssistantTurnView(): AssistantTurnView | null {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const msg = this.messages[i];
      if (msg.role === "assistant" && msg.assistantTurnView) return msg.assistantTurnView;
    }
    return null;
  }

  private flattenTurnTimeline(nodes: ReadonlyArray<TurnTimelineNode>): TurnTimelineNode[] {
    return flattenTurnTimelineNodes(nodes);
  }

  private getComposerTurnStatus(turn: AssistantTurnView): { label: string; stepText: string; kind: string; isActive: boolean; isContextCompaction: boolean } | null {
    const nodes = this.flattenTurnTimeline(turn.turnTimeline)
      .filter((node) => node.kind !== "status" && node.kind !== "agentMessage");
    if (nodes.length === 0) return null;

    // V20: 终态 turn 具有最高优先级——只要 turn 已结束，就不再显示 active composer 状态。
    // 修复 turn 完成后图片节点仍为 running 导致状态栏常驻 "Viewing image" 的问题。
    const turnIsTerminal = turn.status !== "running";
    const activeIndex = turnIsTerminal ? -1 : nodes.findIndex((node) => node.status === "running" || node.status === "blocked");
    const currentIndex = activeIndex >= 0 ? activeIndex : nodes.length - 1;
    const current = nodes[currentIndex];
    const isActive = !turnIsTerminal && (current.status === "running" || current.status === "blocked");
    const isContextCompaction = current.kind === "contextCompaction";
    const label = this.getComposerStatusLabel(turn, current, isActive);
    const stepText = this.formatComposerStepText(currentIndex, nodes.length, label, isActive, isContextCompaction);
    const kind = current.status === "blocked" && !turnIsTerminal
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
    this.agentSkillsToggleEl.createEl("span", { cls: "llm-bridge-skills-toggle-label", text: "持久能力" });
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
    help.createEl("span", { text: "此页管理持久能力（Plugins / Skills）。Composer 工具菜单只负责本轮选择，避免两个入口功能重叠。" });
    // VC-4: Vault Context 轻量状态行（已启用 + 维护记录 + 冲突数 + 撤销入口）
    this.vaultContextStatusEl = body.createDiv({ cls: "llm-bridge-vc-status" });
    this.renderVaultContextStatus();
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
    const clearHistBtn = head.createEl("button", {
      cls: "llm-bridge-history-clear-btn",
      attr: { title: "清空插件内会话，并删除已关联的 Codex 原生 session" },
    });
    setIcon(clearHistBtn.createEl("span", { cls: "llm-bridge-icon" }), "trash-2");
    clearHistBtn.addEventListener("click", () => void this.clearAllHistorySessions());
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
    this.historyBulkbarEl = body.createDiv({ cls: "llm-bridge-history-bulkbar" });
    const selectLabel = this.historyBulkbarEl.createEl("label", { cls: "llm-bridge-history-select-all" });
    this.historySelectAllEl = selectLabel.createEl("input", {
      type: "checkbox",
      cls: "llm-bridge-history-select-all-input",
      attr: { title: "选择当前筛选结果中的全部会话" },
    }) as HTMLInputElement;
    selectLabel.createEl("span", { cls: "llm-bridge-history-select-all-text", text: "选择本页" });
    this.historySelectAllEl.addEventListener("change", () => {
      const visible = this.getFilteredHistoryItems();
      if (this.historySelectAllEl.checked) {
        visible.forEach((item) => this.selectedHistorySessionIds.add(item.id));
      } else {
        visible.forEach((item) => this.selectedHistorySessionIds.delete(item.id));
      }
      this.renderHistoryList();
    });
    this.historyDeleteSelectedBtn = this.historyBulkbarEl.createEl("button", {
      cls: "llm-bridge-history-delete-selected-btn",
      attr: { type: "button", title: "删除选中的 Bridge 会话及其映射的 Codex 原生 session" },
    }) as HTMLButtonElement;
    setIcon(this.historyDeleteSelectedBtn.createEl("span", { cls: "llm-bridge-icon" }), "trash-2");
    this.historyDeleteSelectedBtn.createEl("span", { cls: "llm-bridge-history-delete-selected-label", text: "删除所选" });
    this.historyDeleteSelectedBtn.addEventListener("click", () => void this.deleteSelectedHistorySessions());
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
    dropdown.classList.add("llm-bridge-menu-surface");
    dropdown.createEl("div", { cls: "llm-bridge-session-dropdown-title", text: "Sessions" });
    const recent = this.historyItems.slice(0, 6);
    if (recent.length === 0) {
      dropdown.createEl("div", { cls: "llm-bridge-session-dropdown-empty", text: "暂无历史会话" });
    } else {
      for (const item of recent) {
        const meta = `${formatHistoryTimeFn(item.savedAt)} · ${item.messageCount} 条`;
        const row = this.createComposerMenuItem(dropdown, {
          className: "llm-bridge-session-dropdown-item",
          title: item.title,
          meta,
          badge: item.id === this.currentSessionId ? "当前" : undefined,
          active: item.id === this.currentSessionId,
        });
        row.setAttribute("title", `${item.title}\n${item.messageCount} 条消息 · ${item.savedAt}`);
        row.addEventListener("click", async () => {
          dropdown.setAttribute("hidden", "");
          await this.restoreSession(item.id);
        });
      }
    }
    // V17-TOPBAR-2ROW: 审查/压缩已移到 topbar 第二排，session dropdown 只保留会话管理
    const historyBtn = dropdown.createEl("button", { cls: "llm-bridge-session-dropdown-history" });
    const historyIcon = historyBtn.createEl("span", { cls: "llm-bridge-session-dropdown-history-icon" });
    setIcon(historyIcon, "history");
    historyBtn.createEl("span", { text: "查看全部会话" });
    historyBtn.addEventListener("click", () => {
      dropdown.setAttribute("hidden", "");
      openHistory();
    });
    const clearBtn = dropdown.createEl("button", { cls: "llm-bridge-session-dropdown-clear" });
    const clearIcon = clearBtn.createEl("span", { cls: "llm-bridge-session-dropdown-history-icon" });
    setIcon(clearIcon, "trash-2");
    clearBtn.createEl("span", { text: "清空 Bridge 会话" });
    clearBtn.addEventListener("click", () => {
      dropdown.setAttribute("hidden", "");
      void this.clearAllHistorySessions();
    });
  }

  /** 为 native thread/fork 切换到新的本地历史 id，保留原会话快照不被后续保存覆盖。 */
  private beginLocalSessionFork(): void {
    this.currentSessionId = null;
    this.sessionState = updateSession(this.sessionState, {
      title: `${this.sessionState.title || "新会话"} · 分支`,
      startedAt: new Date().toISOString(),
      status: "idle",
    });
    this.refreshSessionState();
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
    renderHistoryListDom(this.historyListEl, {
      currentSessionId: this.currentSessionId,
      historyItems: this.historyItems,
      historySearchQuery: this.historySearchQuery,
      historySortMode: this.historySortMode,
      selectedHistorySessionIds: this.selectedHistorySessionIds,
      getFilteredHistoryItems: () => this.getFilteredHistoryItems(),
      reconcileSelectedHistorySessions: () => this.reconcileSelectedHistorySessions(),
      updateHistoryBulkControls: (visibleItems) => this.updateHistoryBulkControls(visibleItems),
      updateHistoryCountLabel: (visibleCount, totalCount) => this.updateHistoryCountLabel(visibleCount, totalCount),
      onRestore: (id) => { void this.restoreSession(id); },
      onRename: (id, title) => { void this.renameHistorySession(id, title); },
      onDelete: (id, title) => { void this.deleteHistorySession(id, title); },
      renderListError: (container, kind, error) => this.renderListError(container, kind, error),
    });
  }

  private getFilteredHistoryItems(): SessionListItem[] {
    // V2.9: 按搜索词过滤（标题子串，大小写不敏感）；filter 返回新数组，可直接排序不修改原 historyItems
    const query = this.historySearchQuery.trim().toLowerCase();
    const filtered = this.historyItems.filter((it) => !query || it.title.toLowerCase().includes(query));
    if (this.historySortMode === "messages") {
      filtered.sort((a, b) => b.messageCount - a.messageCount);
    } else {
      filtered.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
    }
    return filtered;
  }

  private reconcileSelectedHistorySessions(): void {
    const existing = new Set(this.historyItems.map((item) => item.id));
    for (const id of Array.from(this.selectedHistorySessionIds)) {
      if (!existing.has(id)) this.selectedHistorySessionIds.delete(id);
    }
  }

  private updateHistoryBulkControls(visibleItems: SessionListItem[]): void {
    if (!this.historyBulkbarEl || !this.historySelectAllEl || !this.historyDeleteSelectedBtn) return;
    const selected = this.selectedHistorySessionIds.size;
    const visibleSelected = visibleItems.filter((item) => this.selectedHistorySessionIds.has(item.id)).length;
    this.historyBulkbarEl.toggleAttribute("hidden", this.historyItems.length === 0);
    this.historySelectAllEl.checked = visibleItems.length > 0 && visibleSelected === visibleItems.length;
    this.historySelectAllEl.indeterminate = visibleSelected > 0 && visibleSelected < visibleItems.length;
    this.historyDeleteSelectedBtn.disabled = selected === 0;
    const label = this.historyDeleteSelectedBtn.querySelector(".llm-bridge-history-delete-selected-label");
    if (label) label.textContent = selected > 0 ? `删除 ${selected} 个` : "删除所选";
  }

  // historyStatusText / formatHistoryTime 已抽取到 ./ui/historyPanel（渐进拆分 P1）

  // V2.5: 恢复历史会话（确认后加载消息 + 状态 + workflow trace）
  private async restoreSession(sessionId: string): Promise<void> {
    if (this.runSession.runHandle || this.runSession.finishingRun) { // F-03: 运行中或收尾中均禁止 restore
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
    // Phase 3: 确认后重新检查运行状态（await 期间用户可能启动了新 run）
    if (this.runSession.runHandle || this.runSession.finishingRun) {
      new Notice("运行状态已变化，取消恢复");
      return;
    }
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const session = await loadSession(vaultPath, sessionId);
    if (!session) {
      new Notice("恢复失败：会话文件不存在或版本不兼容");
      return;
    }
    // Phase 3: loadSession await 后再次检查（异步窗口内状态可能变化）
    if (this.runSession.runHandle || this.runSession.finishingRun) {
      new Notice("运行状态已变化，取消恢复");
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
    this.applySessionApprovalProfile(session);
    if (session.sessionMode) s.sessionMode = session.sessionMode as typeof s.sessionMode;
    await this.restoreContextAndSnippets(session);
    this.runSession.clearSession();
    this.lastRuntimeTokenUsage = null;
    this.renderRuntimeContextRing();
    // latest native session only: nativeSessionRef 只存在 session 文件（1:1 绑定）。
    // 恢复会话时直接用该 session 文件的 nativeSessionRef；不做 sessionFileId 比对
    // （session 文件本身就是绑定源，不会错位）。
    // 如果该 session 是最近活动的，native session 仍在 provider 侧 → resume 命中；
    // 否则 provider 会自然 fallback。
    this.sessionResumed = true;
    // provider 不一致时只恢复聊天记录，不恢复原生线程，提示用户切换后再继续。
    const providerCompatible = this.isSessionProviderCompatible(session);
    if (providerCompatible) {
      this.runSession.setRestoredActiveNativeSessionRef(session.nativeSessionRef);
    } else {
      this.runSession.setRestoredActiveNativeSessionRef(undefined);
      const vaultPath2 = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
      const activeProvider2 = getActiveProvider(vaultPath2);
      new Notice(`历史会话使用 ${session.agentType || "codex"}，当前 provider 为 ${activeProvider2}。已恢复聊天记录，原生线程未恢复。如需继续，请在设置页切换到对应 provider。`, 6000);
    }
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
    // UI-03: 恢复时提示恢复了哪些状态
    const restoredParts: string[] = [`${session.messageCount} 条消息`];
    if (session.model) restoredParts.push(`模型 ${session.model}`);
    const restoredProfile = isAgentApprovalProfile(session.approvalProfile) && session.approvalProfile !== "full-access"
      ? session.approvalProfile
      : (this.plugin.settings.agentApprovalProfile === "full-access" ? "ask" : this.plugin.settings.agentApprovalProfile);
    if (restoredProfile) restoredParts.push(`权限 ${getAgentApprovalProfileInfo(restoredProfile).shortLabel}`);
    if (session.pinnedContextRefs && session.pinnedContextRefs.length > 0) restoredParts.push(`${session.pinnedContextRefs.length} 个 Pin`);
    if (session.nativeSessionRef) restoredParts.push("原生会话");
    new Notice(`已恢复会话：${session.title}\n恢复状态：${restoredParts.join(" · ")}`);
  }

  // 检测历史会话的 provider 与当前 active provider 是否一致。
  // 不一致时只恢复聊天记录，不恢复原生线程（nativeSessionRef），提示用户切换后再继续。
  // 返回 true 表示一致（可恢复原生线程），false 表示不一致（只恢复聊天记录）。
  private isSessionProviderCompatible(session: PersistedSession): boolean {
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const activeProvider = getActiveProvider(vaultPath);
    // 从 session.agentType（legacy）推断历史 provider
    const sessionProvider = session.agentType === "claude" ? "claude"
      : session.agentType === "custom" ? "pi"
      : session.agentType === "codex" ? "codex"
      : "codex"; // 默认 codex
    return sessionProvider === activeProvider;
  }

  // V2.17-A: 恢复 pinned context（保留完整类型字段）+ 重算 message-scope 附件内联 snippet
  // - 供 restoreSession 与 restoreLastActiveSessionIfNeeded 复用，避免两处逻辑漂移
  // - fileType/pathKind/kind 等枚举字段保留原值，不强制 String 化
  // - 历史 message 的内联文本 snippet 在恢复后重算（prompt 仍含内联内容）
  // - agentType 已降级为 CLI fallback 字段，恢复会话时不再用旧 agentType 覆盖当前 provider
  private async restoreContextAndSnippets(session: PersistedSession): Promise<void> {
    const s = this.plugin.settings;
    // agentType 已降级为 CLI fallback 字段，恢复会话时不再用旧 agentType 覆盖当前 provider。
    // activeProvider 是唯一真相源，由 active.json 管理，恢复会话不触碰它。
    // 若历史会话的 provider 与当前 active provider 不一致，只恢复聊天记录，
    // 不恢复原生线程（nativeSessionRef），并在调用方提示用户切换后再继续。
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

  /**
   * V17-RETRY: 再次发送时重新读取、授权和生成附件片段。
   * 对当前 messageFileRefs 中的文本附件重新 ingest（不依赖旧运行时状态）。
   * 图片附件由 buildSdkStreamingInput 在 run() 内部重新读取，无需此处处理。
   */
  private async recomputeMessageAttachmentSnippetsForRetry(refs: ReadonlyArray<FileRef>): Promise<void> {
    // 清除与当前 refs 相关的旧片段（按 refId 过滤）
    const refIds = new Set(refs.map((r) => r.id));
    this.attachmentTextSnippets = this.attachmentTextSnippets.filter((s) => !refIds.has(s.refId));
    // V17-RETRY: 重建 attachmentReadGrants，恢复附件读取授权
    this.attachmentReadGrants = refs
      .filter((ref) => ref.kind === "attachment" && ref.grantScope === "attachment")
      .map((ref) => ({
        path: ref.resolvedPath,
        scope: "attachment" as const,
        match: "file" as const,
        grantedAt: ref.createdAt,
        source: ref.source,
      }));
    // 重新 ingest 文本附件；读取失败时提示附件已失效（不再静默跳过）
    const failedNames: string[] = [];
    for (const ref of refs) {
      if (ref.status !== "active") continue;
      if (!isBoundedTextAttachmentType(ref.fileType)) continue;
      const result = await ingestAttachmentTextSnippet(ref);
      if (result.snippet) {
        this.attachmentTextSnippets.push(result.snippet);
      } else if (result.skippedReason === "read_error") {
        failedNames.push(ref.displayName);
      }
    }
    if (failedNames.length > 0) {
      new Notice(`附件已失效，未能读取：${failedNames.join("、")}`, 6000);
    }
  }

  // V2.16-D: 会话保持 — onOpen 时静默恢复上次活动会话（不弹确认对话框）
  // - 仅在 keepLastSession=true 且 lastActiveSessionId 非空时触发
  // - 旧 session 文件不存在时清除 lastActiveSessionId，fallback 到新会话
  // - 还原消息 + pinned context + 模式 + 模型/effort + backend + 权限模式
  private async restoreLastActiveSessionIfNeeded(): Promise<void> {
    const s = this.plugin.settings;
    // latest native session only: nativeSessionRef 只存在 session 文件（1:1 绑定）。
    // onOpen 时从 lastActiveSessionId 对应的 session 文件读 nativeSessionRef 回填。
    // keepLastSession 控制是否恢复 transcript；但 native session ref 回填不受其影响
    // （保证未开 keepLastSession 时，下一轮也能 resume latest native session）。
    if (!s.lastActiveSessionId) return;
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const session = await loadSession(vaultPath, s.lastActiveSessionId);
    if (!session) {
      // 旧 session 文件不存在（被删除/清理），清除 id 静默 fallback 到新会话
      s.lastActiveSessionId = "";
      await this.plugin.saveSettings();
      return;
    }
    if (!s.keepLastSession) {
      // 未开启会话保持：不恢复 transcript，但仍回填 native session ref 让下一轮 resume
      this.runSession.setRestoredActiveNativeSessionRef(session.nativeSessionRef);
      this.currentSessionId = session.id;
      return;
    }
    // Phase 3: 恢复前检查用户是否已开始交互（输入文字、添加附件、启动运行）
    // 若用户已交互，放弃恢复以避免覆盖用户刚输入或发送的新内容
    if (this.runSession.runHandle
      || (this.inputEl && this.inputEl.value.trim().length > 0)
      || this.messageFileRefs.length > 0) {
      // 用户已开始交互，仅回填 native session ref，不覆盖 transcript
      this.runSession.setRestoredActiveNativeSessionRef(session.nativeSessionRef);
      this.currentSessionId = session.id;
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
    this.applySessionApprovalProfile(session);
    if (session.sessionMode) s.sessionMode = session.sessionMode as typeof s.sessionMode;
    // V2.17-A: 复用统一恢复逻辑（pinned context 保留类型 + message snippet 重算 + agentType 对齐）
    await this.restoreContextAndSnippets(session);
    await this.plugin.saveSettings();
    this.runSession.clearSession();
    // P3: 标记为恢复的会话（静默恢复也需要标注）
    this.sessionResumed = true;
    // latest native session only: nativeSessionRef 只存在 session 文件（1:1 绑定）。
    // onOpen 静默恢复最近活动会话时，直接用该 session 文件的 nativeSessionRef。
    // 不依赖 settings.lastNativeSessionRef（已移除），避免双源错位。
    // provider 不一致时只恢复聊天记录，不恢复原生线程。
    if (this.isSessionProviderCompatible(session)) {
      this.runSession.setRestoredActiveNativeSessionRef(session.nativeSessionRef);
    } else {
      this.runSession.setRestoredActiveNativeSessionRef(undefined);
    }
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
    // Phase 3: 确认后重新检查运行状态（避免删除正在运行的会话）
    if (this.runSession.runHandle) {
      new Notice("运行中无法删除会话，请先停止运行");
      return;
    }
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const result = await deleteSessionWithProviderArtifacts(vaultPath, sessionId);
    if (result.bridgeSessionDeleted) {
      const nativeDeleted = result.codexSessionFilesDeleted + result.codexSessionIndexEntriesDeleted;
      const nativeSuffix = nativeDeleted > 0
        ? `；已同步删除 ${nativeDeleted} 条 Codex 原生记录`
        : "";
      new Notice(`已删除历史会话：${title}${nativeSuffix}`);
      // 若删除的是当前活动会话，清空 currentSessionId
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
        this.doNewSession();
      }
      // V2.8: 原地移除该项并重渲染（不重新 listSessions）
      this.historyItems = this.historyItems.filter((it) => it.id !== sessionId);
      this.selectedHistorySessionIds.delete(sessionId);
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

  // V2.8: 通用输入对话框（返回输入值；取消/Esc/遮罩关闭返回 null）
  private promptDialog(title: string, message: string, defaultValue: string): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;
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
      const confirm = btns.createEl("button", { text: "确认", cls: "mod-warning" });
      const done = (val: string | null): void => {
        if (resolved) return;
        resolved = true;
        resolve(val);
        modal.close();
      };
      cancel.addEventListener("click", () => done(null));
      confirm.addEventListener("click", () => done(input.value));
      modal.onClose = () => done(null);
      modal.open();
      // 自动聚焦输入框并选中文本
      setTimeout(() => { input.focus(); input.select(); }, 50);
    });
  }

  // V2.5: 通用确认对话框（返回 true=确认 / false=取消/Esc/遮罩关闭）
  private confirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      const modal = new Modal(this.app);
      modal.titleEl.setText(title);
      modal.contentEl.empty();
      modal.contentEl.addClass("llm-bridge-confirm-modal");
      modal.contentEl.createEl("p", { text: message, cls: "llm-bridge-confirm-msg" });
      const btns = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const cancel = btns.createEl("button", { text: "取消" });
      const confirm = btns.createEl("button", { text: "确认", cls: "mod-warning" });
      const done = (val: boolean): void => {
        if (resolved) return;
        resolved = true;
        resolve(val);
        modal.close();
      };
      cancel.addEventListener("click", () => done(false));
      confirm.addEventListener("click", () => done(true));
      modal.onClose = () => done(false);
      modal.open();
    });
  }

  private async refreshAgentSkills(): Promise<void> {
    await this.refreshAgentSkillsManifestOnly();
    this.refreshRuntimeDiscoveredSkills();
    await this.refreshManagedCodexPlugins();
    this.renderAgentSkillsList();
    this.renderVaultContextStatus();
  }

  /**
   * V20.12: 从当前 provider 的 skills/list 缓存读取 Runtime 实际发现的 skill 名称。
   * 仅 Codex app-server provider 支持 getCachedSkills；其他 provider 返回空集合。
   * 缓存由 skills/changed 通知自动刷新（见 RunSessionHost.onSkillsChanged）。
   */
  private refreshRuntimeDiscoveredSkills(): void {
    const next = new Set<string>();
    try {
      const provider = this.runSession?.getSession()?.provider as
        { getCachedSkills?: () => { data: Array<{ cwd: string; skills: Array<{ name: string }> }> } | null } | undefined;
      const resp = provider?.getCachedSkills?.();
      if (resp?.data) {
        for (const entry of resp.data) {
          for (const skill of entry.skills ?? []) {
            if (skill?.name) next.add(skill.name);
          }
        }
      }
    } catch {
      // 静默失败：provider 不支持或缓存不可用
    }
    this.runtimeDiscoveredSkillNames = next;
  }

  private async deleteSelectedHistorySessions(): Promise<void> {
    if (this.runSession.runHandle) {
      new Notice("运行中无法删除历史会话");
      return;
    }
    const selectedIds = Array.from(this.selectedHistorySessionIds);
    if (selectedIds.length === 0) return;
    const selectedItems = this.historyItems.filter((item) => this.selectedHistorySessionIds.has(item.id));
    const confirmed = await this.confirmDialog(
      "删除所选会话",
      `确认删除 ${selectedItems.length} 个 Bridge 会话？会同步删除这些会话映射的 ~/.codex/sessions 原生 Codex session 文件和索引；未被 Bridge 映射的 Codex 历史不会删除。`,
    );
    if (!confirmed) return;

    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    let bridgeDeleted = 0;
    let codexNativeDeleted = 0;
    let deletedCurrent = false;
    for (const item of selectedItems) {
      const result = await deleteSessionWithProviderArtifacts(vaultPath, item.id);
      if (!result.bridgeSessionDeleted) continue;
      bridgeDeleted += 1;
      codexNativeDeleted += result.codexSessionFilesDeleted + result.codexSessionIndexEntriesDeleted;
      if (this.currentSessionId === item.id) deletedCurrent = true;
    }

    const deletedIds = new Set(selectedItems.map((item) => item.id));
    this.historyItems = this.historyItems.filter((item) => !deletedIds.has(item.id));
    this.selectedHistorySessionIds.clear();
    if (deletedCurrent) {
      this.currentSessionId = null;
      this.doNewSession();
    }
    this.renderHistoryList();
    new Notice(`已删除 ${bridgeDeleted} 个 Bridge 会话；同步删除 ${codexNativeDeleted} 条 Codex 原生记录`);
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

  private async clearAllHistorySessions(): Promise<void> {
    if (this.runSession.runHandle) {
      new Notice("运行中无法清空会话");
      return;
    }
    const total = this.historyItems.length;
    const confirmed = await this.confirmDialog(
      "清空 Bridge 会话",
      `确认清空插件内 ${total} 个历史会话？会同步删除这些会话记录过的 ~/.codex/sessions 原生 Codex session 和索引；不会删除未被 Bridge 映射的 Codex 历史。`,
    );
    if (!confirmed) return;
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
    const result = await clearSessionsWithProviderArtifacts(vaultPath);
    this.historyItems = [];
    this.selectedHistorySessionIds.clear();
    this.historyLastLoadAt = 0;
    this.renderHistoryList();
    this.doNewSession();
    const nativeDeleted = result.codexSessionFilesDeleted + result.codexSessionIndexEntriesDeleted;
    new Notice(`已清空 ${result.bridgeSessionsDeleted} 个 Bridge 会话；同步删除 ${nativeDeleted} 条 Codex 原生记录`);
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
    renderAgentSkillsListDom(this.agentSkillsListEl, this.agentSkills, {
      renderManagedCodexPluginsList: () => this.renderManagedCodexPluginsList(),
      updateAgentSkillsToggle: () => this.updateAgentSkillsToggle(),
      renderAgentSkillItem: (parent, skill) => this.renderAgentSkillItem(parent, skill),
      renderListError: (container, kind, error) => this.renderListError(container, kind, error),
    });
  }

  // UI-03: 抽取单个 skill 项渲染 — 委托到 ./ui/agentSkillsPanel
  private renderAgentSkillItem(parent: HTMLElement, skill: AgentSkillRecord): void {
    renderAgentSkillItemDom(parent, skill, {
      runtimeDiscoveredSkillNames: this.runtimeDiscoveredSkillNames,
      onOpen: (s) => { void this.openAgentSkillFile(s); },
      onToggle: (id, enabled) => { void this.toggleAgentSkillEnabled(id, enabled); },
    });
  }

  private async refreshManagedCodexPlugins(): Promise<void> {
    if (this.managedPluginsRefreshInFlight) {
      await this.managedPluginsRefreshInFlight;
      return;
    }
    this.managedPluginsRefreshInFlight = (async () => {
      try {
        this.managedCodexPluginCatalog = await listManagedCodexPluginsAsync(this.plugin.pluginDir);
        this.managedCodexPlugins = this.managedCodexPluginCatalog.entries.slice();
        this.managedPluginsRefreshedAt = Date.now();
      } catch (error) {
        this.managedCodexPluginCatalog = {
          available: false,
          runtimePath: null,
          entries: [],
          error: error instanceof Error ? error.message : String(error),
        };
        this.managedCodexPlugins = [];
      } finally {
        this.managedPluginsRefreshInFlight = null;
      }
    })();
    await this.managedPluginsRefreshInFlight;
  }

  /** P0: 发送热路径 — 有缓存则跳过；后台去重刷新 plugin 列表 */
  private ensureManagedCodexPluginsCached(): void {
    const FRESH_MS = 60_000;
    if (this.managedCodexPluginCatalog && Date.now() - this.managedPluginsRefreshedAt < FRESH_MS) {
      return;
    }
    void this.refreshManagedCodexPlugins();
  }

  /** P0: Codex Skills 物化 — 缓存/去重，连续发送不重复全量执行 */
  private async ensureCodexSkillsPreparedCached(vaultPath: string): Promise<{ ok: boolean; reason?: string }> {
    const FRESH_MS = 5 * 60_000;
    if (
      this.codexSkillPrepCache
      && this.codexSkillPrepCache.vaultPath === vaultPath
      && this.codexSkillPrepCache.ok
      && Date.now() - this.codexSkillPrepCache.preparedAt < FRESH_MS
    ) {
      return { ok: true };
    }
    if (this.codexSkillPrepInFlight) {
      return this.codexSkillPrepInFlight;
    }
    this.codexSkillPrepInFlight = (async () => {
      try {
        await this.refreshAgentSkillsManifestOnly();
        const codexSkillPrep = await prepareAgentSkillsForCodexRuntime(vaultPath);
        const result = {
          ok: codexSkillPrep.ok,
          reason: codexSkillPrep.ok ? undefined : (codexSkillPrep.reason || "unknown error"),
        };
        this.codexSkillPrepCache = {
          vaultPath,
          preparedAt: Date.now(),
          ok: result.ok,
          reason: result.reason,
        };
        return result;
      } finally {
        this.codexSkillPrepInFlight = null;
      }
    })();
    return this.codexSkillPrepInFlight;
  }

  /**
   * V20.12: 渲染 Vault Context 真实状态行。
   * 三维状态：
   *  1. 已物化：检测 SKILL.md 源文件是否存在（LLM-AgentRuntime/skills/vault-context/SKILL.md）
   *  2. Runtime 已发现：getCachedSkills 中是否包含 llm-bridge-vault-context
   *  3. 最后更新时间：读取 update-log.md 的 mtime
   */
  private renderVaultContextStatus(): void {
    const el = this.vaultContextStatusEl;
    if (!el) return;
    el.empty();
    const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();

    // 1. 检测物化文件
    const skillSourceAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_REL);
    const materialized = fs.existsSync(skillSourceAbs);

    // 2. 检测 Runtime 发现
    const runtimeDiscovered = this.runtimeDiscoveredSkillNames.has("llm-bridge-vault-context")
      || this.runtimeDiscoveredSkillNames.has("vault-context");

    // 3. 读取 update-log 最后更新时间
    let updatedAt: string | null = null;
    try {
      const logAbs = path.join(vaultPath, VAULT_SKILL_UPDATE_LOG_REL);
      if (fs.existsSync(logAbs)) {
        const stat = fs.statSync(logAbs);
        updatedAt = stat.mtime.toISOString();
      }
    } catch {
      // 静默失败
    }

    const row = el.createDiv({ cls: "llm-bridge-vc-status-row" });
    row.createEl("span", {
      cls: `llm-bridge-vc-status-badge${materialized ? " is-ok" : " is-warn"}`,
      text: materialized ? "Vault Context · 已物化" : "Vault Context · 未物化",
    });
    row.createEl("span", {
      cls: `llm-bridge-vc-status-badge${runtimeDiscovered ? " is-ok" : " is-muted"}`,
      text: runtimeDiscovered ? "Runtime 已发现" : "Runtime 未发现",
      attr: { title: runtimeDiscovered ? "Codex Runtime skills/list 已识别 vault-context" : "尚未运行或 Runtime 未识别（运行一次后自动刷新）" },
    });
    if (updatedAt) {
      const dateStr = new Date(updatedAt).toLocaleString();
      row.createEl("span", {
        cls: "llm-bridge-vc-status-badge is-muted",
        text: `更新于 ${dateStr}`,
        attr: { title: `update-log.md 最后修改时间：${updatedAt}` },
      });
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
    // Skill 启停后立即刷新物化缓存（清除旧缓存 + 重新物化）
    this.codexSkillPrepCache = null;
    void this.ensureCodexSkillsPreparedCached(vaultPath).then((r) => {
      if (!r.ok) {
        new Notice(`Skill 物化${enabled ? "（启用）" : "（禁用）"}失败: ${r.reason || "unknown"}`, 6000);
      }
    });
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
    this.autoGrowInput();
    this.inputEl.focus();
    // 光标移到末尾
    this.inputEl.selectionStart = this.inputEl.selectionEnd = this.inputEl.value.length;
  }

  focusInput(): void {
    this.inputEl.focus();
  }

  // 供外部 command 调用：直接触发发送
  async runNow(): Promise<void> {
    await this.runSession.run();
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
