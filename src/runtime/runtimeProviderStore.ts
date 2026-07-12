// LLM CLI Bridge — Runtime Provider Store (V20.4)
//
// runtime-provider.json 的唯一读写入口（single source of truth）。
//
// 设计目标（修复"配置状态分裂"）：
// - 配置存在：完全以文件为准；设置页只是它的编辑器。
// - 配置缺失：从旧 settings / Vault Profile / 便携 Key 迁移一次，成功后落盘。
// - 配置损坏：明确返回 source="corrupt" + error，不静默回退到另一个来源。
// - 外部修改文件：async 读路径检查 mtime/size，变化时重新加载。
// - 原子写入：临时文件 + rename，避免写到一半损坏。
// - API Key：仅以 encryptedApiKey（safeStorage）持久化；明文不入文件。
//   safeStorage 不可用时 Key 仅存内存（session-only），重启后需重新输入。
//
// 替代旧 runtimeProfileResolver 的三路合并（relayUrl/apiKey 三来源合并导致状态分裂）。
// 旧 loadVaultRuntimeProfile / loadPortableApiKey 仅作迁移来源，不再在每次解析时读取。

import * as fs from "fs";
import * as path from "path";
import { AGENT_RUNTIME_PROVIDER_CONFIG_REL } from "../agentRuntimeWorkspace";
import { encryptApiKey, decryptApiKey, isSafeStorageAvailable } from "./safeStorageProvider";
import { loadVaultRuntimeProfileSync, loadPortableApiKeySync } from "./runtimeProfileResolver";

// ---------- 类型 ----------

export type ApiKeyStatus = "saved" | "not-configured" | "session-only";
export type ProviderConfigSource = "provider-config" | "migrated" | "none" | "corrupt";

/** Store 的完整状态快照（只读视图） */
export interface RuntimeProviderState {
  readonly relayUrl: string;
  /** 解密后的明文 Key（仅在内存中传递，不落盘）。无 Key 时为空串。 */
  readonly apiKey: string;
  readonly model: string;
  readonly defaultModel?: string;
  readonly providerModels?: ReadonlyArray<string>;
  readonly verifiedModels?: ReadonlyArray<string>;
  readonly pendingModels?: ReadonlyArray<string>;
  readonly incompatibleModels?: ReadonlyArray<{ id: string; reason: string }>;
  readonly discoveredAt?: string;
  readonly keyStatus: ApiKeyStatus;
  readonly source: ProviderConfigSource;
  /** source="corrupt" 时的具体错误；其他来源为 undefined */
  readonly error?: string;
  readonly updatedAt?: string;
}

/** 旧 settings 字段（仅迁移用） */
export interface LegacySettingsSnapshot {
  readonly localRelayUrl?: string;
  readonly localRelayModel?: string;
  readonly model?: string;
  readonly localRelayApiKey?: string;
  readonly localRelayPortableKeyPath?: string;
}

/** 写入补丁：所有字段可选，未提供字段保留原值 */
export interface RuntimeProviderPatch {
  readonly relayUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly defaultModel?: string;
  readonly providerModels?: ReadonlyArray<string>;
  readonly verifiedModels?: ReadonlyArray<string>;
  readonly pendingModels?: ReadonlyArray<string>;
  readonly incompatibleModels?: ReadonlyArray<{ id: string; reason: string }>;
  readonly discoveredAt?: string;
}

interface StoreEntry {
  readonly state: RuntimeProviderState;
  readonly mtimeMs: number;
  readonly size: number;
}

// ---------- 内部缓存 ----------

/** vaultPath → 最近一次读取的快照（含 mtime，用于外部修改检测） */
const cache = new Map<string, StoreEntry>();
/** vaultPath → session-only 明文 Key（safeStorage 不可用时） */
const sessionKeys = new Map<string, string>();

function getStorePath(vaultPath: string): string {
  return path.join(vaultPath, AGENT_RUNTIME_PROVIDER_CONFIG_REL);
}

// ---------- 文件解析 ----------

interface ParsedConfig {
  readonly relayUrl: string;
  readonly encryptedApiKey?: string;
  readonly legacyApiKey?: string;
  readonly model: string;
  readonly defaultModel?: string;
  readonly providerModels?: ReadonlyArray<string>;
  readonly verifiedModels?: ReadonlyArray<string>;
  readonly pendingModels?: ReadonlyArray<string>;
  readonly incompatibleModels?: ReadonlyArray<{ id: string; reason: string }>;
  readonly discoveredAt?: string;
  readonly updatedAt?: string;
}

function parseStringArray(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return result.length > 0 ? result : undefined;
}

function parseIncompatibleModels(value: unknown): ReadonlyArray<{ id: string; reason: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .map((item): { id: string; reason: string } | null => {
      if (typeof item !== "object" || item === null) return null;
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== "string" || typeof obj.reason !== "string") return null;
      return { id: obj.id, reason: obj.reason };
    })
    .filter((v): v is { id: string; reason: string } => v !== null);
  return result.length > 0 ? result : undefined;
}

/**
 * 解析文件内容为 ParsedConfig。
 * 返回 null 表示 JSON 合法但缺少 relayUrl（视为未配置，非损坏）。
 * 抛出 Error 表示 JSON 损坏（调用方应标记 source="corrupt"）。
 */
function parseConfigContent(content: string): ParsedConfig {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const relayUrl = typeof parsed.relayUrl === "string" ? parsed.relayUrl : "";
  return {
    relayUrl,
    encryptedApiKey: typeof parsed.encryptedApiKey === "string" ? parsed.encryptedApiKey : undefined,
    legacyApiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : undefined,
    model: typeof parsed.model === "string" ? parsed.model : "",
    defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : undefined,
    providerModels: parseStringArray(parsed.providerModels),
    verifiedModels: parseStringArray(parsed.verifiedModels),
    pendingModels: parseStringArray(parsed.pendingModels),
    incompatibleModels: parseIncompatibleModels(parsed.incompatibleModels),
    discoveredAt: typeof parsed.discoveredAt === "string" ? parsed.discoveredAt : undefined,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
  };
}

/** 从 ParsedConfig + session key 构建 RuntimeProviderState */
function buildState(vaultPath: string, parsed: ParsedConfig, source: ProviderConfigSource): RuntimeProviderState {
  let apiKey = "";
  let keyStatus: ApiKeyStatus = "not-configured";

  if (parsed.encryptedApiKey) {
    const decrypted = decryptApiKey(parsed.encryptedApiKey);
    if (decrypted) {
      apiKey = decrypted;
      keyStatus = "saved";
    } else {
      // encryptedApiKey 存在但解密失败（如换机器/系统凭据变更）→ 视为未配置
      keyStatus = "not-configured";
    }
  } else if (parsed.legacyApiKey) {
    // 兼容旧版明文 Key：读取后下次保存时自动加密
    apiKey = parsed.legacyApiKey;
    keyStatus = isSafeStorageAvailable() ? "saved" : "session-only";
  } else {
    // 文件无 Key，检查 session-only
    const sessionKey = sessionKeys.get(vaultPath);
    if (sessionKey) {
      apiKey = sessionKey;
      keyStatus = "session-only";
    }
  }

  return {
    relayUrl: parsed.relayUrl,
    apiKey,
    model: parsed.model,
    defaultModel: parsed.defaultModel,
    providerModels: parsed.providerModels,
    verifiedModels: parsed.verifiedModels,
    pendingModels: parsed.pendingModels,
    incompatibleModels: parsed.incompatibleModels,
    discoveredAt: parsed.discoveredAt,
    keyStatus,
    source,
    updatedAt: parsed.updatedAt,
  };
}

// ---------- 迁移 ----------

/**
 * 从旧来源（Vault Profile / 便携 Key / settings）迁移。
 * 仅在配置文件不存在时调用一次；成功后由调用方落盘。
 */
function migrateFromLegacy(vaultPath: string, legacy: LegacySettingsSnapshot): ParsedConfig | null {
  const vaultProfile = loadVaultRuntimeProfileSync(vaultPath);
  const relayUrl = vaultProfile?.relayUrl || legacy.localRelayUrl || "";
  if (!relayUrl) return null;

  let apiKey = "";
  if (legacy.localRelayPortableKeyPath) {
    const portableKey = loadPortableApiKeySync(legacy.localRelayPortableKeyPath, vaultPath);
    if (portableKey) apiKey = portableKey;
  }
  if (!apiKey && legacy.localRelayApiKey) {
    apiKey = legacy.localRelayApiKey;
  }

  const model = legacy.model || vaultProfile?.model || legacy.localRelayModel || "";
  return { relayUrl, model, legacyApiKey: apiKey || undefined };
}

// ---------- 读取 ----------

function statFile(filePath: string): { mtimeMs: number; size: number } | null {
  try {
    const st = fs.statSync(filePath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

function isCacheFresh(vaultPath: string, filePath: string): boolean {
  const entry = cache.get(vaultPath);
  if (!entry) return false;
  const st = statFile(filePath);
  if (!st) return false;
  return st.mtimeMs === entry.mtimeMs && st.size === entry.size;
}

function readFileSync(vaultPath: string, filePath: string, legacy: LegacySettingsSnapshot | null): RuntimeProviderState {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    let parsed: ParsedConfig;
    try {
      parsed = parseConfigContent(content);
    } catch (e) {
      // JSON 损坏：明确报错，不静默回退
      const errState: RuntimeProviderState = {
        relayUrl: "", apiKey: "", model: "",
        keyStatus: "not-configured", source: "corrupt",
        error: e instanceof Error ? e.message : String(e),
      };
      cache.delete(vaultPath);
      return errState;
    }
    if (!parsed.relayUrl) {
      // 文件存在但无 relayUrl：视为未配置（非损坏）
      return buildEmptyState(vaultPath);
    }
    const st = statFile(filePath);
    const state = buildState(vaultPath, parsed, "provider-config");
    if (st) cache.set(vaultPath, { state, mtimeMs: st.mtimeMs, size: st.size });
    return state;
  } catch {
    // 文件不存在
    if (legacy) {
      const migrated = migrateFromLegacy(vaultPath, legacy);
      if (migrated) {
        // 迁移成功：返回 migrated 状态（不在此处落盘，由 async 路径落盘）
        const state = buildState(vaultPath, migrated, "migrated");
        return state;
      }
    }
    return buildEmptyState(vaultPath);
  }
}

function buildEmptyState(vaultPath: string): RuntimeProviderState {
  const sessionKey = sessionKeys.get(vaultPath);
  return {
    relayUrl: "", apiKey: sessionKey || "", model: "",
    keyStatus: sessionKey ? "session-only" : "not-configured",
    source: "none",
  };
}

/**
 * 异步读取（权威路径）：检查 mtime，外部修改时重新加载。
 * 文件缺失时执行迁移并落盘。
 */
export async function loadRuntimeProviderState(
  vaultPath: string,
  legacy?: LegacySettingsSnapshot,
): Promise<RuntimeProviderState> {
  const filePath = getStorePath(vaultPath);

  // 缓存新鲜 → 直接返回
  if (isCacheFresh(vaultPath, filePath)) {
    return cache.get(vaultPath)!.state;
  }

  const st = statFile(filePath);
  if (!st) {
    // 文件不存在：尝试迁移
    const migrated = legacy ? migrateFromLegacy(vaultPath, legacy) : null;
    if (migrated) {
      const state = buildState(vaultPath, migrated, "migrated");
      // 落盘（原子写）
      await writeConfigAtomic(vaultPath, filePath, migrated);
      const newSt = statFile(filePath);
      if (newSt) cache.set(vaultPath, { state, mtimeMs: newSt.mtimeMs, size: newSt.size });
      return state;
    }
    cache.delete(vaultPath);
    return buildEmptyState(vaultPath);
  }

  // 文件存在：读取并解析
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    let parsed: ParsedConfig;
    try {
      parsed = parseConfigContent(content);
    } catch (e) {
      const errState: RuntimeProviderState = {
        relayUrl: "", apiKey: "", model: "",
        keyStatus: "not-configured", source: "corrupt",
        error: e instanceof Error ? e.message : String(e),
      };
      cache.delete(vaultPath);
      return errState;
    }
    if (!parsed.relayUrl) {
      cache.delete(vaultPath);
      return buildEmptyState(vaultPath);
    }
    const state = buildState(vaultPath, parsed, "provider-config");
    cache.set(vaultPath, { state, mtimeMs: st.mtimeMs, size: st.size });
    return state;
  } catch {
    cache.delete(vaultPath);
    return buildEmptyState(vaultPath);
  }
}

/**
 * 同步读取（spawn env 等不能 await 的路径）。
 * 返回最近一次 async 读取的缓存；若未缓存则同步读文件。
 * 不执行迁移（迁移需异步写文件）。
 */
export function loadRuntimeProviderStateSync(vaultPath: string): RuntimeProviderState {
  const filePath = getStorePath(vaultPath);
  if (isCacheFresh(vaultPath, filePath)) {
    return cache.get(vaultPath)!.state;
  }
  return readFileSync(vaultPath, filePath, null);
}

/** 强制重新加载（设置页打开 / 发送前检查外部修改） */
export async function reloadRuntimeProviderState(vaultPath: string): Promise<RuntimeProviderState> {
  cache.delete(vaultPath);
  return loadRuntimeProviderState(vaultPath);
}

// ---------- 原子写入 ----------

function buildPersistPayload(state: ParsedConfig | RuntimeProviderPatch & { relayUrl: string; model: string }): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    relayUrl: state.relayUrl,
    model: state.model,
    updatedAt: new Date().toISOString(),
  };
  if (state.defaultModel) payload.defaultModel = state.defaultModel;
  if (state.providerModels) payload.providerModels = state.providerModels;
  if (state.verifiedModels) payload.verifiedModels = state.verifiedModels;
  if (state.pendingModels) payload.pendingModels = state.pendingModels;
  if (state.incompatibleModels) payload.incompatibleModels = state.incompatibleModels;
  if (state.discoveredAt) payload.discoveredAt = state.discoveredAt;
  return payload;
}

async function writeConfigAtomic(vaultPath: string, filePath: string, data: ParsedConfig): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const payload = buildPersistPayload(data);
  // API Key 加密持久化
  if (data.legacyApiKey || data.encryptedApiKey) {
    const plainKey = data.legacyApiKey || (data.encryptedApiKey ? (decryptApiKey(data.encryptedApiKey) ?? "") : "");
    if (plainKey) {
      const encrypted = encryptApiKey(plainKey);
      if (encrypted) {
        payload.encryptedApiKey = encrypted;
      } else if (isSafeStorageAvailable()) {
        // safeStorage 可用但加密失败 — 异常情况，Key 不落盘
      } else {
        // safeStorage 不可用 — Key 仅存内存（session-only）
        sessionKeys.set(vaultPath, plainKey);
      }
    }
  }
  const content = JSON.stringify(payload, null, 2) + "\n";
  // 原子写：临时文件 + rename
  const tmpPath = filePath + ".tmp-" + process.pid;
  await fs.promises.writeFile(tmpPath, content, "utf8");
  try {
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * 更新配置（原子写）。未提供字段保留原值。
 * 返回更新后的状态。
 */
export async function updateRuntimeProviderState(
  vaultPath: string,
  patch: RuntimeProviderPatch,
): Promise<RuntimeProviderState> {
  const current = await loadRuntimeProviderState(vaultPath);
  if (current.source === "corrupt") {
    throw new Error(`runtime-provider.json 损坏，无法更新：${current.error || "解析失败"}`);
  }
  const merged: ParsedConfig = {
    relayUrl: patch.relayUrl !== undefined ? patch.relayUrl : current.relayUrl,
    model: patch.model !== undefined ? patch.model : current.model,
    defaultModel: patch.defaultModel !== undefined ? patch.defaultModel : current.defaultModel,
    providerModels: patch.providerModels !== undefined ? patch.providerModels : current.providerModels,
    verifiedModels: patch.verifiedModels !== undefined ? patch.verifiedModels : current.verifiedModels,
    pendingModels: patch.pendingModels !== undefined ? patch.pendingModels : current.pendingModels,
    incompatibleModels: patch.incompatibleModels !== undefined ? patch.incompatibleModels : current.incompatibleModels,
    discoveredAt: patch.discoveredAt !== undefined ? patch.discoveredAt : current.discoveredAt,
    // apiKey 单独处理
    legacyApiKey: patch.apiKey !== undefined ? patch.apiKey : (current.apiKey || undefined),
  };
  await writeConfigAtomic(vaultPath, getStorePath(vaultPath), merged);
  return reloadRuntimeProviderState(vaultPath);
}

// ---------- API Key 专用操作 ----------

/**
 * 设置/替换 API Key。
 * safeStorage 可用 → 加密落盘（keyStatus="saved"）。
 * safeStorage 不可用 → 仅存内存（keyStatus="session-only"），返回需提示用户。
 */
export async function setProviderApiKey(
  vaultPath: string,
  apiKey: string,
): Promise<RuntimeProviderState> {
  const current = await loadRuntimeProviderState(vaultPath);
  if (current.source === "corrupt") {
    throw new Error(`runtime-provider.json 损坏，无法更新：${current.error || "解析失败"}`);
  }
  const merged: ParsedConfig = {
    relayUrl: current.relayUrl,
    model: current.model,
    defaultModel: current.defaultModel,
    providerModels: current.providerModels,
    verifiedModels: current.verifiedModels,
    pendingModels: current.pendingModels,
    incompatibleModels: current.incompatibleModels,
    discoveredAt: current.discoveredAt,
    legacyApiKey: apiKey || undefined,
  };
  await writeConfigAtomic(vaultPath, getStorePath(vaultPath), merged);
  return reloadRuntimeProviderState(vaultPath);
}

/** 清除 API Key（保留 relayUrl/model/发现结果） */
export async function clearProviderApiKey(vaultPath: string): Promise<RuntimeProviderState> {
  sessionKeys.delete(vaultPath);
  const current = await loadRuntimeProviderState(vaultPath);
  if (current.source === "corrupt") {
    throw new Error(`runtime-provider.json 损坏，无法更新：${current.error || "解析失败"}`);
  }
  const merged: ParsedConfig = {
    relayUrl: current.relayUrl,
    model: current.model,
    defaultModel: current.defaultModel,
    providerModels: current.providerModels,
    verifiedModels: current.verifiedModels,
    pendingModels: current.pendingModels,
    incompatibleModels: current.incompatibleModels,
    discoveredAt: current.discoveredAt,
    // 无 legacyApiKey / encryptedApiKey → 落盘时不写入 Key 字段
  };
  await writeConfigAtomic(vaultPath, getStorePath(vaultPath), merged);
  return reloadRuntimeProviderState(vaultPath);
}

/** 设置当前模型（聊天框切换模型时同步到配置文件） */
export async function setProviderModel(vaultPath: string, model: string): Promise<RuntimeProviderState> {
  return updateRuntimeProviderState(vaultPath, { model });
}

// ---------- 工具 ----------

/** 清除缓存（测试用） */
export function clearRuntimeProviderStoreCache(): void {
  cache.clear();
  sessionKeys.clear();
}

/** 窥探 session-only Key 是否存在（UI 状态显示用） */
export function hasSessionOnlyKey(vaultPath: string): boolean {
  return sessionKeys.has(vaultPath);
}
