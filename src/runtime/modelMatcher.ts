// LLM CLI Bridge — Model Matcher (V20)
//
// 将中转站 /v1/models 返回的模型 ID 与 Codex runtime model/list 返回的模型能力
// 进行交叉匹配，分为三类：
// - available：两边 ID 匹配 + runtime 确认支持文本生成（Responses 协议）
// - pending：两边 ID 匹配，但 runtime 未返回能力信息（待真实请求验证）
// - incompatible：中转站有但 runtime 不认识，或不是 Responses/文本生成模型
//
// 只把 available 和 pending 放入聊天框模型列表。
// 不做"名称包含 GPT"等模糊猜测；不把图片/Embedding/语音模型混进 agent 模型。

import type { ModelCatalogEntry, ModelValidationStatus } from "../runtimeModelCatalog";

/** 中转站 /v1/models 返回的原始模型 ID */
export interface RelayModelInfo {
  readonly id: string;
  readonly ownedBy?: string;
}

/** Codex runtime model/list 返回的单个模型能力信息 */
export interface RuntimeModelInfo {
  readonly id: string;
  readonly label?: string;
  readonly isDefault?: boolean;
  readonly supportedReasoningEfforts?: ReadonlyArray<string>;
  readonly defaultReasoningEffort?: string;
  readonly inputModalities?: ReadonlyArray<string>;
  readonly supportsPersonality?: boolean;
  readonly provider?: string;
}

/** 模型匹配结果 */
export interface ModelMatchResult {
  /** 可用模型（两边匹配 + 能力检查通过） */
  readonly available: ModelCatalogEntry[];
  /** 待验证模型（两边匹配，能力未知） */
  readonly pending: ModelCatalogEntry[];
  /** 不兼容模型（中转站有但 runtime 不认识，或非文本生成模型） */
  readonly incompatible: ModelCatalogEntry[];
  /** 所有可放入聊天框的模型（available + pending） */
  readonly selectable: ModelCatalogEntry[];
  /** runtime 默认模型 ID */
  readonly defaultModel: string;
}

/** 不适用于 Agent 的模型关键词（图片/Embedding/语音/转录等） */
const NON_AGENT_KEYWORDS = [
  "dall-e", "image", "embed", "tts", "whisper", "transcribe",
  "audio", "speech", "moderation", "sora",
];

/**
 * 判断模型 ID 是否明显不是 Agent 文本生成模型。
 * 基于 ID 中的关键词判断，不做模糊猜测。
 */
function isNonAgentModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return NON_AGENT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * 判断 runtime 模型是否支持文本生成（Responses 协议）。
 * runtime model/list 返回的 inputModalities 包含 "text" 即认为支持。
 */
function supportsTextGeneration(model: RuntimeModelInfo): boolean {
  if (!model.inputModalities || model.inputModalities.length === 0) {
    // runtime 未返回模态信息，保守认为可能支持
    return true;
  }
  return model.inputModalities.some((m) => m.toLowerCase() === "text");
}

/**
 * 执行模型匹配。
 *
 * @param relayModels 中转站 /v1/models 返回的模型列表
 * @param runtimeModels Codex runtime model/list 返回的模型能力列表
 * @returns 匹配结果
 */
export function matchModels(
  relayModels: ReadonlyArray<RelayModelInfo>,
  runtimeModels: ReadonlyArray<RuntimeModelInfo>,
): ModelMatchResult {
  const runtimeMap = new Map<string, RuntimeModelInfo>();
  for (const m of runtimeModels) {
    if (m.id) runtimeMap.set(m.id, m);
  }

  const available: ModelCatalogEntry[] = [];
  const pending: ModelCatalogEntry[] = [];
  const incompatible: ModelCatalogEntry[] = [];

  // 遍历中转站模型，与 runtime 交叉匹配
  for (const relay of relayModels) {
    const id = relay.id.trim();
    if (!id) continue;

    // 明显的非 Agent 模型直接标记不兼容
    if (isNonAgentModel(id)) {
      incompatible.push({ value: id, label: id, validationStatus: "incompatible" });
      continue;
    }

    const runtime = runtimeMap.get(id);
    if (!runtime) {
      // 中转站有但 runtime 不认识
      incompatible.push({ value: id, label: id, validationStatus: "incompatible" });
      continue;
    }

    // 检查是否支持文本生成
    if (!supportsTextGeneration(runtime)) {
      incompatible.push({ value: id, label: runtime.label || id, validationStatus: "incompatible" });
      continue;
    }

    // 两边都有 + 支持文本生成 → available 或 pending
    const hasCapabilityInfo = !!runtime.supportedReasoningEfforts
      || !!runtime.inputModalities
      || runtime.supportsPersonality !== undefined;

    const entry: ModelCatalogEntry = {
      value: id,
      label: runtime.label || id,
      supportedReasoningEfforts: runtime.supportedReasoningEfforts,
      defaultReasoningEffort: runtime.defaultReasoningEffort,
      inputModalities: runtime.inputModalities,
      supportsPersonality: runtime.supportsPersonality,
      isDefault: runtime.isDefault,
      provider: runtime.provider,
      validationStatus: hasCapabilityInfo ? "available" : "pending",
    };

    if (hasCapabilityInfo) {
      available.push(entry);
    } else {
      pending.push(entry);
    }
  }

  // runtime 默认模型
  const defaultRuntime = runtimeModels.find((m) => m.isDefault);
  const defaultModel = defaultRuntime?.id
    || (available[0]?.value ?? pending[0]?.value ?? "");

  // selectable = available + pending，默认模型排前
  const selectable = [...available, ...pending];
  if (defaultModel) {
    const idx = selectable.findIndex((m) => m.value === defaultModel);
    if (idx > 0) {
      const [item] = selectable.splice(idx, 1);
      selectable.unshift({ ...item, isDefault: true });
    }
  }

  return { available, pending, incompatible, selectable, defaultModel };
}

/**
 * 格式化模型匹配结果为统计摘要字符串。
 */
export function formatMatchSummary(result: ModelMatchResult): string {
  const total = result.available.length + result.pending.length + result.incompatible.length;
  return `发现 ${total} 个模型 · 可用 ${result.available.length} · 待验证 ${result.pending.length} · 不兼容 ${result.incompatible.length}`;
}
