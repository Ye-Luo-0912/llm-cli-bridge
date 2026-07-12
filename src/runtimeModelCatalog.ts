// LLM CLI Bridge — Runtime Model Catalog (V2.16-C)
// 提供模型与推理等级的运行时目录，避免 UI 硬编码
//
// 设计：
// - 优先从 SDK/runtime 配置读取可用模型与推理等级（source=runtime）
// - 若无法动态读取，fallback 到静态列表（source=static）
// - UI 显示的 model/effort 必须与传给 SDK query 的 options 一致
// - 使用 SDK 原始名称/原文 label，不强制中文化 effort

/** 模型验证状态 */
export type ModelValidationStatus = "available" | "pending" | "incompatible";

/**
 * 模型目录条目
 */
export interface ModelCatalogEntry {
  /** 模型标识（传给 SDK query 的 model 参数） */
  readonly value: string;
  /** 显示标签（原始名称，不中文化） */
  readonly label: string;
  /** 支持的推理等级列表（来自 runtime model/list） */
  readonly supportedReasoningEfforts?: ReadonlyArray<string>;
  /** 默认推理等级 */
  readonly defaultReasoningEffort?: string;
  /** 输入模态列表（如 ["text", "image"]） */
  readonly inputModalities?: ReadonlyArray<string>;
  /** 是否支持 personality 参数 */
  readonly supportsPersonality?: boolean;
  /** 是否为 runtime 默认模型 */
  readonly isDefault?: boolean;
  /** 模型所属 provider（如 "llm_bridge_relay"） */
  readonly provider?: string;
  /** 验证状态：available=可用，pending=待验证，incompatible=不兼容 */
  readonly validationStatus?: ModelValidationStatus;
  /** V20.3: 不兼容原因（仅在 validationStatus=incompatible 时有意义） */
  readonly incompatibleReason?: string;
}

/**
 * 推理等级目录条目
 */
export interface EffortCatalogEntry {
  /** 推理等级标识（传给 SDK query 的参数） */
  readonly value: string;
  /** 显示标签（原始名称，不中文化） */
  readonly label: string;
}

/**
 * 运行时模型目录
 */
export interface RuntimeModelCatalog {
  /** 可用模型列表 */
  readonly models: ReadonlyArray<ModelCatalogEntry>;
  /** 可用推理等级列表 */
  readonly efforts: ReadonlyArray<EffortCatalogEntry>;
  /** 目录来源：runtime=从 SDK/配置动态读取；static=fallback 静态列表 */
  readonly source: "runtime" | "static";
}

export type RuntimeModelCatalogAgent = "claude" | "codex" | "custom";

const runtimeCatalogByAgent = new Map<string, RuntimeModelCatalog>();

/**
 * 静态 fallback 模型列表（与中转支持的模型对齐）
 * source=static 时使用
 */
const STATIC_MODELS: ReadonlyArray<ModelCatalogEntry> = [
  { value: "gpt-5.5", label: "gpt-5.5" },
  { value: "gpt-5.4", label: "gpt-5.4" },
  { value: "glm-5.2", label: "glm-5.2" },
  { value: "deepseek-v4", label: "deepseek-v4" },
];

const CODEX_MODELS: ReadonlyArray<ModelCatalogEntry> = [
  { value: "gpt-5.6-sol", label: "gpt-5.6-sol" },
  { value: "gpt-5.5", label: "gpt-5.5" },
  { value: "gpt-5.4", label: "gpt-5.4" },
];

/**
 * V20.2: effort 中文显示映射。
 * 发送给 runtime 的值仍保持 low/medium/high/max，仅 UI 显示中文。
 */
const EFFORT_DISPLAY_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  max: "极高",
};

/** V20.2: 获取 effort 的中文显示标签，未知值原样返回。 */
export function effortDisplayLabel(value: string): string {
  return EFFORT_DISPLAY_LABELS[value] ?? value;
}

/**
 * 静态 fallback 推理等级列表
 * V20.2: label 使用中文显示，value 保持 low/medium/high/max
 */
const STATIC_EFFORTS: ReadonlyArray<EffortCatalogEntry> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "max", label: "极高" },
];

/**
 * 尝试从 SDK runtime 读取模型目录
 *
 * 当前 SDK 不暴露 model catalog API，返回 null，fallback 到静态列表。
 * 未来若 SDK 提供 listModels() 或类似 API，可在此处实现动态读取。
 *
 * @returns 运行时目录，不可用时返回 null
 */
function tryReadRuntimeCatalog(): RuntimeModelCatalog | null {
  // V2.16-C: SDK 当前不暴露 model catalog API，使用静态 fallback
  // 未来扩展点：若 SDK 提供 listModels/listEfforts，在此读取
  return null;
}

/**
 * 获取运行时模型目录
 *
 * 优先从 SDK/runtime 读取，不可用时 fallback 到静态列表。
 * source 字段标识目录来源，供 UI 显示。
 */
export function getRuntimeModelCatalog(): RuntimeModelCatalog {
  const runtime = tryReadRuntimeCatalog();
  if (runtime) return runtime;
  return {
    models: STATIC_MODELS,
    efforts: STATIC_EFFORTS,
    source: "static",
  };
}

export function getRuntimeModelCatalogForAgent(agent: RuntimeModelCatalogAgent | string): RuntimeModelCatalog {
  const dynamic = runtimeCatalogByAgent.get(agent);
  if (dynamic) return dynamic;
  if (agent === "codex") {
    return {
      models: CODEX_MODELS,
      efforts: STATIC_EFFORTS,
      source: "static",
    };
  }
  const runtime = tryReadRuntimeCatalog();
  if (runtime) return runtime;
  return getRuntimeModelCatalog();
}

/**
 * 注册运行时真实返回的模型目录。目录仅保存在当前插件进程内，避免把可能变化的
 * 服务端模型列表写进 Vault。调用方可把默认模型放在首位。
 * 保留模型能力字段（supportedReasoningEfforts 等），供 effort 下拉框动态刷新。
 */
export function setRuntimeModelCatalogForAgent(
  agent: RuntimeModelCatalogAgent | string,
  models: ReadonlyArray<ModelCatalogEntry>,
): RuntimeModelCatalog {
  const seen = new Set<string>();
  const normalized = models
    .map((item) => ({
      value: item.value.trim(),
      label: (item.label || item.value).trim(),
      supportedReasoningEfforts: item.supportedReasoningEfforts,
      defaultReasoningEffort: item.defaultReasoningEffort,
      inputModalities: item.inputModalities,
      supportsPersonality: item.supportsPersonality,
      isDefault: item.isDefault,
      provider: item.provider,
      validationStatus: item.validationStatus,
      incompatibleReason: item.incompatibleReason,
    }))
    .filter((item) => item.value.length > 0 && !seen.has(item.value) && !!seen.add(item.value));
  const catalog: RuntimeModelCatalog = {
    models: normalized,
    efforts: STATIC_EFFORTS,
    source: "runtime",
  };
  if (normalized.length > 0) runtimeCatalogByAgent.set(agent, catalog);
  return normalized.length > 0 ? catalog : getRuntimeModelCatalogForAgent(agent);
}

/**
 * 获取指定模型的推理等级列表。如果模型自带 supportedReasoningEfforts 则用它；
 * 否则回退到静态列表。
 * V20.2: label 使用中文显示（低/中/高/极高），value 保持 low/medium/high/max。
 */
export function getEffortsForModel(catalog: RuntimeModelCatalog, modelValue: string): ReadonlyArray<EffortCatalogEntry> {
  const entry = findModelEntry(catalog, modelValue);
  if (entry?.supportedReasoningEfforts && entry.supportedReasoningEfforts.length > 0) {
    return entry.supportedReasoningEfforts.map((e) => ({ value: e, label: effortDisplayLabel(e) }));
  }
  return catalog.efforts;
}

/**
 * 获取指定模型的默认推理等级。如果模型自带 defaultReasoningEffort 则用它；
 * 否则回退到目录第一个等级。
 */
export function getDefaultEffortForModel(catalog: RuntimeModelCatalog, modelValue: string): string {
  const entry = findModelEntry(catalog, modelValue);
  if (entry?.defaultReasoningEffort) return entry.defaultReasoningEffort;
  const efforts = getEffortsForModel(catalog, modelValue);
  return efforts[0]?.value ?? "high";
}

export function clearRuntimeModelCatalogForAgent(agent: RuntimeModelCatalogAgent | string): void {
  runtimeCatalogByAgent.delete(agent);
}

/**
 * 查找模型条目（若不存在返回 null）
 */
export function findModelEntry(catalog: RuntimeModelCatalog, value: string): ModelCatalogEntry | null {
  return catalog.models.find((m) => m.value === value) ?? null;
}

/**
 * 查找推理等级条目（若不存在返回 null）
 */
export function findEffortEntry(catalog: RuntimeModelCatalog, value: string): EffortCatalogEntry | null {
  return catalog.efforts.find((e) => e.value === value) ?? null;
}

/**
 * 归一化模型值。服务端可能比本地缓存先增加模型，因此非空未知值必须原样保留，
 * 不能静默替换成目录第一项。仅空值才采用当前目录默认项。
 */
export function normalizeModelValue(catalog: RuntimeModelCatalog, value: string): string {
  const trimmed = value.trim();
  return findModelEntry(catalog, trimmed)?.value ?? (trimmed || catalog.models[0]?.value || "gpt-5.6-sol");
}

/**
 * 归一化推理等级值（若不在目录中，返回第一个等级的 value）
 */
export function normalizeEffortValue(catalog: RuntimeModelCatalog, value: string): string {
  return findEffortEntry(catalog, value)?.value ?? catalog.efforts[0]?.value ?? "high";
}
