// Managed Codex app-server 模型目录探测。
// 目录只缓存在当前插件进程中；模型选择仍以 settings.model 为单一真相源。
// Round 1: 解析 model/list 的 object-array supportedReasoningEfforts，保留顺序与 description。
// Round 3: 升级为 CodexRuntimeCapabilitySnapshot——分页读取全部 model/list 结果（nextCursor），
// 解析 serviceTiers/defaultServiceTier/supportsPersonality/inputModalities，
// 并尝试读取 modelProvider/capabilities/read（失败时 null，不阻塞模型目录）。
// loadCodexManagedModelCatalog 保留为向后兼容的薄封装（仅取 models/defaultModel）。

import type { ModelCatalogEntry, ReasoningEffortOptionDetail } from "../../../runtimeModelCatalog";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AppServerProcessManager } from "../codex-app-server/appServerProcessManager";
import { JsonRpcClient } from "../codex-app-server/jsonRpcClient";
import { CODEX_APP_SERVER_STAGE_TIMEOUTS } from "../codex-app-server/codexAppServerProvider";
import { buildRuntimeEnv } from "../../config/runtimeRouter";
import { resolveManagedRuntime, resolveManifestPath } from "./codexManagedRuntimeResolver";

export interface CodexRuntimeModelCatalogResult {
  readonly models: ReadonlyArray<ModelCatalogEntry>;
  readonly defaultModel: string;
}

/**
 * Round 3: modelProvider/capabilities/read 结果（见 generated ModelProviderCapabilitiesReadResponse）。
 * 读取失败（旧 runtime 不支持该 method、超时等）时为 null，不阻塞模型目录展示。
 */
export interface CodexModelProviderCapabilities {
  readonly namespaceTools: boolean;
  readonly imageGeneration: boolean;
  readonly webSearch: boolean;
}

/**
 * Round 3: managed Codex runtime 能力快照——model/list（全量分页）+ modelProvider/capabilities/read。
 * loadCodexManagedModelCatalog 是本快照的薄封装（只取 models/defaultModel），供旧调用点兼容。
 */
export interface CodexRuntimeCapabilitySnapshot {
  readonly models: ReadonlyArray<ModelCatalogEntry>;
  readonly defaultModel: string;
  /** 探测时的 managed runtime 版本（缓存 key 的一部分，runtime 升级后自动失效重新探测） */
  readonly runtimeVersion: string;
  /** modelProvider/capabilities/read 结果；探测失败或 runtime 不支持时为 null */
  readonly modelProviderCapabilities: CodexModelProviderCapabilities | null;
}

interface CodexModelListItem {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly displayName?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly hidden?: unknown;
  readonly isDefault?: unknown;
  readonly supportedReasoningEfforts?: unknown;
  readonly defaultReasoningEffort?: unknown;
  readonly inputModalities?: unknown;
  readonly supportsPersonality?: unknown;
  readonly provider?: unknown;
  readonly serviceTiers?: unknown;
  readonly defaultServiceTier?: unknown;
}

const cache = new Map<string, Promise<CodexRuntimeCapabilitySnapshot | null>>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`model catalog ${stage ? `「${stage}」` : ""}timeout (${timeoutMs}ms)`)),
      timeoutMs,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function asStringArray(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return result.length > 0 ? result : undefined;
}

/** 解析 generated Model.serviceTiers（{ id, name, description }[]）。 */
function parseServiceTiers(
  value: unknown,
): ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      id: typeof v.id === "string" ? v.id : "",
      name: typeof v.name === "string" ? v.name : "",
      description: typeof v.description === "string" ? v.description : "",
    }))
    .filter((v) => v.id.length > 0);
  return result.length > 0 ? result : undefined;
}

/**
 * 解析 supportedReasoningEfforts：
 * - 新协议：`{ reasoningEffort, description }[]`（保持 runtime 返回顺序）
 * - 旧协议：`string[]`
 */
export function parseSupportedReasoningEfforts(
  value: unknown,
): { efforts: ReadonlyArray<string>; details: ReadonlyArray<ReasoningEffortOptionDetail> } | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const details: ReasoningEffortOptionDetail[] = [];
  const efforts: string[] = [];

  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      efforts.push(item);
      details.push({ value: item });
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as { reasoningEffort?: unknown; description?: unknown };
      const effort = typeof rec.reasoningEffort === "string" ? rec.reasoningEffort : "";
      if (!effort) continue;
      efforts.push(effort);
      details.push({
        value: effort,
        description: typeof rec.description === "string" ? rec.description : undefined,
      });
    }
  }

  if (efforts.length === 0) return undefined;
  return { efforts, details };
}

/** 导出供单测：解析单页 model/list payload（{ data, nextCursor? }）。 */
export function parseCodexModelList(payload: unknown): CodexRuntimeModelCatalogResult | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  return parseModelListItems(data as CodexModelListItem[]);
}

/**
 * Round 3: 解析已跨分页聚合好的 model/list items（见 probeSnapshot 的分页循环）。
 * 与旧 parseCodexModelList 共用同一套字段解析逻辑，额外解析 serviceTiers/defaultServiceTier。
 */
function parseModelListItems(items: ReadonlyArray<CodexModelListItem>): CodexRuntimeModelCatalogResult | null {
  const seen = new Set<string>();
  const parsed = items
    .map((item) => {
      const value = typeof item.model === "string" ? item.model : typeof item.id === "string" ? item.id : "";
      const label = typeof item.displayName === "string"
        ? item.displayName
        : typeof item.name === "string" ? item.name : value;
      const parsedEfforts = parseSupportedReasoningEfforts(item.supportedReasoningEfforts);
      const inputModalities = asStringArray(item.inputModalities);
      return {
        value,
        label,
        description: typeof item.description === "string" ? item.description : undefined,
        hidden: item.hidden === true,
        isDefault: item.isDefault === true,
        supportedReasoningEfforts: parsedEfforts?.efforts,
        reasoningEffortOptions: parsedEfforts?.details,
        defaultReasoningEffort: typeof item.defaultReasoningEffort === "string" ? item.defaultReasoningEffort : undefined,
        inputModalities,
        supportsPersonality: typeof item.supportsPersonality === "boolean" ? item.supportsPersonality : undefined,
        provider: typeof item.provider === "string" ? item.provider : undefined,
        serviceTiers: parseServiceTiers(item.serviceTiers),
        defaultServiceTier: typeof item.defaultServiceTier === "string" ? item.defaultServiceTier : undefined,
      };
    })
    .filter((item) => item.value.length > 0 && item.hidden !== true && !seen.has(item.value) && !!seen.add(item.value));
  if (parsed.length === 0) return null;
  // 保持 runtime 返回顺序；仅把默认模型提到首位时仍保留相对顺序
  const defaultIdx = parsed.findIndex((item) => item.isDefault);
  const ordered = defaultIdx > 0
    ? [parsed[defaultIdx], ...parsed.slice(0, defaultIdx), ...parsed.slice(defaultIdx + 1)]
    : parsed;
  const defaultModel = ordered.find((item) => item.isDefault)?.value || ordered[0].value;

  const models: ModelCatalogEntry[] = ordered.map((item) => ({
    value: item.value,
    label: item.label,
    description: item.description,
    supportedReasoningEfforts: item.supportedReasoningEfforts,
    reasoningEffortOptions: item.reasoningEffortOptions,
    defaultReasoningEffort: item.defaultReasoningEffort,
    inputModalities: item.inputModalities,
    supportsPersonality: item.supportsPersonality,
    isDefault: item.isDefault,
    provider: item.provider,
    serviceTiers: item.serviceTiers,
    defaultServiceTier: item.defaultServiceTier,
  }));

  return { models, defaultModel };
}

/** Round 3: model/list 分页安全上限（防御 runtime 返回错误的 nextCursor 造成死循环）。 */
const MODEL_LIST_MAX_PAGES = 20;

/**
 * Round 3: 分页拉取全部 model/list 结果（跟随 nextCursor 直到为 null/undefined），
 * 并尝试读取 modelProvider/capabilities/read（失败/不支持时为 null，不影响模型目录）。
 */
async function probeSnapshot(
  pluginDir: string,
  vaultPath: string,
): Promise<CodexRuntimeCapabilitySnapshot | null> {
  const runtime = resolveManagedRuntime(resolveManifestPath(pluginDir), process.platform, process.arch, { scheduleVerify: false });
  if (!runtime.available || !runtime.runtimePath) return null;

  const env: NodeJS.ProcessEnv = { ...process.env, ...buildRuntimeEnv(vaultPath, "codex") };

  const processManager = new AppServerProcessManager({
    command: runtime.runtimePath,
    args: runtime.appServerArgs,
    cwd: vaultPath,
    env,
  });
  const client = new JsonRpcClient(
    (line) => processManager.writeLine(line),
    (handler) => processManager.onStdoutLine(handler),
  );

  try {
    await withTimeout(client.send("initialize", {
      clientInfo: { name: "llm-cli-bridge-model-catalog", title: "LLM CLI Bridge", version: "1" },
      capabilities: { experimentalApi: false },
      cwd: vaultPath,
    }), CODEX_APP_SERVER_STAGE_TIMEOUTS.initialize, "initialize");
    client.notify("initialized", {});

    // model/list 分页：跟随 nextCursor 直到 null（或达到安全上限）。
    const allItems: CodexModelListItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MODEL_LIST_MAX_PAGES; page++) {
      const result = await withTimeout(
        client.send("model/list", cursor ? { cursor } : {}),
        CODEX_APP_SERVER_STAGE_TIMEOUTS.modelList,
        "model/list",
      );
      const data = (result as { data?: unknown } | null)?.data;
      if (Array.isArray(data)) allItems.push(...(data as CodexModelListItem[]));
      const nextCursor = (result as { nextCursor?: unknown } | null)?.nextCursor;
      if (typeof nextCursor !== "string" || !nextCursor) break;
      cursor = nextCursor;
    }
    const parsedCatalog = parseModelListItems(allItems);
    if (!parsedCatalog) return null;

    // modelProvider/capabilities/read：可选探测，失败/runtime 不支持时降级为 null。
    let modelProviderCapabilities: CodexModelProviderCapabilities | null = null;
    try {
      const capResult = await withTimeout(
        client.send("modelProvider/capabilities/read", {}),
        CODEX_APP_SERVER_STAGE_TIMEOUTS.modelList,
        "modelProvider/capabilities/read",
      );
      const rec = capResult as Record<string, unknown> | null;
      if (rec && typeof rec.namespaceTools === "boolean" && typeof rec.imageGeneration === "boolean" && typeof rec.webSearch === "boolean") {
        modelProviderCapabilities = {
          namespaceTools: rec.namespaceTools,
          imageGeneration: rec.imageGeneration,
          webSearch: rec.webSearch,
        };
      }
    } catch {
      modelProviderCapabilities = null;
    }

    return {
      models: parsedCatalog.models,
      defaultModel: parsedCatalog.defaultModel,
      runtimeVersion: runtime.version || "unknown",
      modelProviderCapabilities,
    };
  } catch {
    return null;
  } finally {
    client.close();
    processManager.kill();
  }
}

function computeCacheKey(pluginDir: string, vaultPath: string, runtimeVersion: string): string {
  const runtimeEnv = buildRuntimeEnv(vaultPath, "codex");
  const codexHome = runtimeEnv.CODEX_HOME || process.env.CODEX_HOME || "global";
  const configPath = codexHome === "global" ? "" : path.join(codexHome, "config.toml");
  let configFingerprint = "no-local-config";
  try {
    if (configPath && fs.existsSync(configPath)) {
      configFingerprint = createHash("sha256").update(fs.readFileSync(configPath)).digest("hex").slice(0, 12);
    }
  } catch {
    configFingerprint = "config-unreadable";
  }
  const relayKey = runtimeEnv.CODEX_RELAY_API_KEY || "";
  const authFingerprint = relayKey
    ? createHash("sha256").update(relayKey).digest("hex").slice(0, 12)
    : "no-key";
  return [pluginDir, vaultPath, codexHome, configFingerprint, authFingerprint, runtimeVersion].join("|");
}

/**
 * Round 3: 后台读取一次真实 runtime 能力快照（model/list 全量分页 + modelProvider/capabilities/read）。
 * 缓存 key 含 runtimeVersion——runtime 升级后自动失效重新探测，同一 runtime/relay/配置组合复用进程内结果。
 */
export function loadCodexRuntimeCapabilitySnapshot(
  pluginDir: string,
  vaultPath: string,
): Promise<CodexRuntimeCapabilitySnapshot | null> {
  const runtime = resolveManagedRuntime(resolveManifestPath(pluginDir), process.platform, process.arch, { scheduleVerify: false });
  const runtimeVersion = runtime.version || "unknown";
  const key = computeCacheKey(pluginDir, vaultPath, runtimeVersion);
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = probeSnapshot(pluginDir, vaultPath);
  cache.set(key, pending);
  void pending.then((result) => {
    if (!result) cache.delete(key);
  });
  return pending;
}

/**
 * 后台读取一次真实 runtime 目录；同一 runtime/relay 组合复用进程内结果。
 *
 * Round 3: 薄封装——实际探测走 loadCodexRuntimeCapabilitySnapshot，本函数只取
 * models/defaultModel，供尚未需要 modelProviderCapabilities 的旧调用点保持兼容。
 */
export async function loadCodexManagedModelCatalog(
  pluginDir: string,
  vaultPath: string,
): Promise<CodexRuntimeModelCatalogResult | null> {
  const snapshot = await loadCodexRuntimeCapabilitySnapshot(pluginDir, vaultPath);
  if (!snapshot) return null;
  return { models: snapshot.models, defaultModel: snapshot.defaultModel };
}

/**
 * V20.2: 清除模型目录缓存，用于中转站新增/删除模型后强制重新读取。
 */
export function clearCodexManagedModelCatalogCache(): void {
  cache.clear();
}
