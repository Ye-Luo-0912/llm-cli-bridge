// LLM CLI Bridge — Context Metrics (V2.16-D UX State Persistence / Context Visualization)
//
// 统一的 ContextMetrics 数据结构 + token 估算。
// CLI 和 SDK 都通过同一 UI 组件展示 context。
// 精度标明：exact（SDK 返回真实 token）/ estimated（字符估算）/ unavailable（无数据）。
//
// 估算规则：
// - 英文约 4 字符 = 1 token；中文约 2 字符 = 1 token；混合取 3.5 字符/token
// - 标注 estimated，不冒充精确值
// - context window 根据模型查表；未知模型用 128000 兜底

/** 单个 context 部分的指标 */
export interface ContextMetricPart {
  /** 估算 token 数 */
  tokens: number;
  /** 字符数 */
  chars: number;
  /** 显示标签 */
  label: string;
}

/** 压缩信息（当发生压缩/裁剪时） */
export interface CompressionInfo {
  /** 压缩前 token 数 */
  beforeTokens: number;
  /** 压缩后 token 数 */
  afterTokens: number;
  /** 压缩比（afterTokens / beforeTokens） */
  ratio: number;
  /** 被压缩的来源 */
  source: "history" | "note" | "selection" | "working_set";
  /** 压缩原因 */
  reason: "over_budget" | "policy" | "manual";
}

/** 完整的 context 指标 */
export interface ContextMetrics {
  /** prompt package 部分（系统指令 + tool steering 等） */
  promptPackage: ContextMetricPart;
  /** active note 部分 */
  activeNote: ContextMetricPart;
  /** selection 部分 */
  selection: ContextMetricPart;
  /** V2.17-A: message-scoped 附件（本轮附件） */
  messageAttachments: ContextMetricPart;
  /** V2.17-A: pinned context（跨轮保留的附件） */
  pinnedContext: ContextMetricPart;
  /** attachments / pinned context 聚合计数（用于 total/remaining） */
  workingSet: ContextMetricPart;
  /** history/session 部分（历史消息） */
  history: ContextMetricPart;
  /** 总计 */
  total: ContextMetricPart;
  /** 剩余可用（基于模型 context window） */
  remaining: ContextMetricPart;
  /** 模型 context window 大小（token） */
  contextWindow: number;
  /** 数据精度 */
  precision: "exact" | "estimated" | "unavailable";
  /** 压缩信息（如果发生压缩） */
  compression?: CompressionInfo;
}

/** 常见模型的 context window 大小（token） */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.5": 200000,
  "gpt-5.4": 200000,
  "gpt-5.3": 200000,
  "gpt-5.2": 128000,
  "gpt-5.1": 128000,
  "gpt-5": 128000,
  "claude-sonnet-4-5": 200000,
  "claude-opus-4-1": 200000,
  "claude-haiku-4": 200000,
};

/** 默认 context window（未知模型兜底） */
const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * 估算字符串的 token 数
 * - 混合中英文：约 3.5 字符/token
 * - 标注 estimated，不冒充精确值
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * 获取模型的 context window 大小
 */
export function getModelContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
}

/**
 * 从字符串创建 ContextMetricPart
 */
function partFromText(text: string, label: string): ContextMetricPart {
  return {
    tokens: estimateTokens(text),
    chars: text.length,
    label,
  };
}

/**
 * 计算 ContextMetrics
 * - 接收各部分文本内容
 * - 估算 token 数（标明 estimated）
 * - 计算剩余可用空间
 *
 * V2.17-A: 拆分 message attachments 与 pinned context 两段，
 * workingSet 作为聚合计数（两者之和）保留用于 total/remaining。
 *
 * @param promptPackageText prompt package 全文
 * @param activeNoteText active note 内容（可能为空）
 * @param selectionText selection 内容（可能为空）
 * @param messageAttachmentsText 本轮 message-scoped 附件路径拼接（可能为空）
 * @param pinnedContextText pinned context（跨轮保留）路径拼接（可能为空）
 * @param historyText 历史消息拼接文本
 * @param model 当前模型 id（用于查 context window）
 * @param compression 压缩信息（可选；无信号时不传，不伪造）
 */
export function computeContextMetrics(
  promptPackageText: string,
  activeNoteText: string,
  selectionText: string,
  messageAttachmentsText: string,
  pinnedContextText: string,
  historyText: string,
  model: string,
  compression?: CompressionInfo,
): ContextMetrics {
  const promptPackage = partFromText(promptPackageText, "Prompt");
  const activeNote = partFromText(activeNoteText, "Active note");
  const selection = partFromText(selectionText, "Selection");
  const messageAttachments = partFromText(messageAttachmentsText, "Message attachments");
  const pinnedContext = partFromText(pinnedContextText, "Pinned context");
  const workingSet: ContextMetricPart = {
    tokens: messageAttachments.tokens + pinnedContext.tokens,
    chars: messageAttachments.chars + pinnedContext.chars,
    label: "Attachments",
  };
  const history = partFromText(historyText, "History");

  const totalTokens = promptPackage.tokens + activeNote.tokens + selection.tokens + workingSet.tokens + history.tokens;
  const totalChars = promptPackage.chars + activeNote.chars + selection.chars + workingSet.chars + history.chars;
  const total: ContextMetricPart = { tokens: totalTokens, chars: totalChars, label: "Total" };

  const contextWindow = getModelContextWindow(model);
  const remainingTokens = Math.max(0, contextWindow - totalTokens);
  const remaining: ContextMetricPart = { tokens: remainingTokens, chars: 0, label: "Remaining" };

  return {
    promptPackage,
    activeNote,
    selection,
    messageAttachments,
    pinnedContext,
    workingSet,
    history,
    total,
    remaining,
    contextWindow,
    precision: "estimated",
    compression,
  };
}

/**
 * 格式化 token 数为简短显示
 * - < 1000: 原样
 * - >= 1000: 1.2k / 12k / 120k
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * 格式化压缩比为百分比
 */
export function formatCompressionRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
