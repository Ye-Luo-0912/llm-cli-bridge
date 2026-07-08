// LLM CLI Bridge — Runtime Model Catalog (V2.16-C)
// 提供模型与推理等级的运行时目录，避免 UI 硬编码
//
// 设计：
// - 优先从 SDK/runtime 配置读取可用模型与推理等级（source=runtime）
// - 若无法动态读取，fallback 到静态列表（source=static）
// - UI 显示的 model/effort 必须与传给 SDK query 的 options 一致
// - 使用 SDK 原始名称/原文 label，不强制中文化 effort

/**
 * 模型目录条目
 */
export interface ModelCatalogEntry {
  /** 模型标识（传给 SDK query 的 model 参数） */
  readonly value: string;
  /** 显示标签（原始名称，不中文化） */
  readonly label: string;
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
  { value: "gpt-5.5", label: "gpt-5.5" },
  { value: "gpt-5.4", label: "gpt-5.4" },
];

/**
 * 静态 fallback 推理等级列表（使用原始名称，不中文化）
 * source=static 时使用
 */
const STATIC_EFFORTS: ReadonlyArray<EffortCatalogEntry> = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "max", label: "max" },
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
 * 归一化模型值（若不在目录中，返回第一个模型的 value）
 */
export function normalizeModelValue(catalog: RuntimeModelCatalog, value: string): string {
  return findModelEntry(catalog, value)?.value ?? catalog.models[0]?.value ?? "gpt-5.5";
}

/**
 * 归一化推理等级值（若不在目录中，返回第一个等级的 value）
 */
export function normalizeEffortValue(catalog: RuntimeModelCatalog, value: string): string {
  return findEffortEntry(catalog, value)?.value ?? catalog.efforts[0]?.value ?? "high";
}
