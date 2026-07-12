// LLM CLI Bridge — Runtime Provider Config (V20.2)
//
// runtime provider 的本地真相源文件，存储在 Vault 内 LLM-AgentRuntime/private/ 目录。
// 该文件不随 Vault 同步（用户应将 private/ 加入同步排除），
// 不提交 Git，不包含在公开 release 中。
//
// V20.2: API Key 使用 Electron safeStorage 加密后持久化。
// 文件格式（runtime-provider.json）：
// {
//   "relayUrl": "https://...",
//   "encryptedApiKey": "<base64 safeStorage 密文>",
//   "model": "gpt-5.5",
//   "defaultModel": "gpt-5.5",
//   "updatedAt": "2026-07-12T..."
// }
// safeStorage 不可用时 encryptedApiKey 留空，Key 仅存内存（重启需重新输入）。
//
// 首次读取旧 settings/Vault Profile 后自动迁移。

import * as fs from "fs";
import * as path from "path";
import { AGENT_RUNTIME_PROVIDER_CONFIG_REL, AGENT_RUNTIME_PRIVATE_DIR_REL } from "../agentRuntimeWorkspace";
import { loadVaultRuntimeProfileSync, loadPortableApiKeySync } from "./runtimeProfileResolver";
import { encryptApiKey, decryptApiKey } from "./safeStorageProvider";

/** runtime provider 配置文件 schema */
export interface RuntimeProviderConfig {
  readonly relayUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly defaultModel?: string;
  readonly updatedAt?: string;
}

/** 迁移来源信息 */
export interface RuntimeProviderConfigSource {
  readonly origin: "provider-config" | "migrated" | "none";
  readonly config: RuntimeProviderConfig | null;
}

/**
 * 获取 runtime provider 配置文件的完整路径。
 */
export function getProviderConfigPath(vaultPath: string): string {
  return path.join(vaultPath, AGENT_RUNTIME_PROVIDER_CONFIG_REL);
}

/**
 * 读取 runtime provider 配置文件。
 * 如果文件不存在，尝试从旧 settings/Vault Profile/便携 Key 迁移。
 */
export async function loadRuntimeProviderConfig(
  vaultPath: string,
  settings: {
    localRelayUrl?: string;
    localRelayModel?: string;
    model?: string;
    localRelayApiKey?: string;
    localRelayPortableKeyPath?: string;
  },
): Promise<RuntimeProviderConfigSource> {
  const configPath = getProviderConfigPath(vaultPath);

  // 1. 尝试读取已存在的配置文件
  try {
    const content = await fs.promises.readFile(configPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.relayUrl === "string" && parsed.relayUrl) {
      // V20.2: 优先解密 encryptedApiKey；回退旧明文 apiKey（兼容迁移）
      let apiKey = "";
      if (typeof parsed.encryptedApiKey === "string" && parsed.encryptedApiKey) {
        apiKey = decryptApiKey(parsed.encryptedApiKey) ?? "";
      } else if (typeof parsed.apiKey === "string") {
        // 兼容旧版明文 Key：读取后将在下次保存时自动加密
        apiKey = parsed.apiKey;
      }
      return {
        origin: "provider-config",
        config: {
          relayUrl: parsed.relayUrl,
          apiKey,
          model: typeof parsed.model === "string" ? parsed.model : settings.model || "",
          defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : undefined,
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
        },
      };
    }
  } catch { /* file not found or invalid */ }

  // 2. 迁移：从旧 settings/Vault Profile/便携 Key 读取
  const migrated = migrateFromLegacy(vaultPath, settings);
  if (migrated) {
    // 自动写入新文件
    await saveRuntimeProviderConfig(vaultPath, migrated);
    return { origin: "migrated", config: migrated };
  }

  return { origin: "none", config: null };
}

/**
 * 同步读取 runtime provider 配置文件（用于无法 await 的 spawn env 路径）。
 * 不执行迁移（迁移需异步写文件）。
 */
export function loadRuntimeProviderConfigSync(vaultPath: string): RuntimeProviderConfig | null {
  const configPath = getProviderConfigPath(vaultPath);
  try {
    const content = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.relayUrl !== "string" || !parsed.relayUrl) return null;
    // V20.2: 优先解密 encryptedApiKey；回退旧明文 apiKey
    let apiKey = "";
    if (typeof parsed.encryptedApiKey === "string" && parsed.encryptedApiKey) {
      apiKey = decryptApiKey(parsed.encryptedApiKey) ?? "";
    } else if (typeof parsed.apiKey === "string") {
      apiKey = parsed.apiKey;
    }
    return {
      relayUrl: parsed.relayUrl,
      apiKey,
      model: typeof parsed.model === "string" ? parsed.model : "",
      defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch { /* file not found or invalid */ }
  return null;
}

/**
 * 保存 runtime provider 配置文件。
 */
export async function saveRuntimeProviderConfig(
  vaultPath: string,
  config: RuntimeProviderConfig,
): Promise<boolean> {
  const configPath = getProviderConfigPath(vaultPath);
  try {
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    // V20.2: API Key 用 safeStorage 加密后写入 encryptedApiKey，明文不再落盘。
    // safeStorage 不可用时 encryptedApiKey 留空，Key 仅存内存。
    const encryptedApiKey = config.apiKey ? encryptApiKey(config.apiKey) : null;
    const payload: Record<string, unknown> = {
      relayUrl: config.relayUrl,
      model: config.model,
      defaultModel: config.defaultModel,
      updatedAt: new Date().toISOString(),
    };
    if (encryptedApiKey) {
      payload.encryptedApiKey = encryptedApiKey;
    }
    const content = JSON.stringify(payload, null, 2) + "\n";
    await fs.promises.writeFile(configPath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 从旧来源（settings/Vault Profile/便携 Key）迁移到新配置。
 * 优先级：provider-config > Vault Profile relayUrl + 便携 Key > settings.localRelay*
 */
function migrateFromLegacy(
  vaultPath: string,
  settings: {
    localRelayUrl?: string;
    localRelayModel?: string;
    model?: string;
    localRelayApiKey?: string;
    localRelayPortableKeyPath?: string;
  },
): RuntimeProviderConfig | null {
  // 从 Vault Profile 读取 relayUrl
  const vaultProfile = loadVaultRuntimeProfileSync(vaultPath);
  const relayUrl = vaultProfile?.relayUrl || settings.localRelayUrl || "";
  if (!relayUrl) return null;

  // 从便携 Key 或 settings 读取 API Key
  let apiKey = "";
  if (settings.localRelayPortableKeyPath) {
    const portableKey = loadPortableApiKeySync(settings.localRelayPortableKeyPath, vaultPath);
    if (portableKey) apiKey = portableKey;
  }
  if (!apiKey && settings.localRelayApiKey) {
    apiKey = settings.localRelayApiKey;
  }

  const model = settings.model || vaultProfile?.model || settings.localRelayModel || "";

  return { relayUrl, apiKey, model };
}

/**
 * 检查 private 目录是否存在，不存在则创建。
 */
export async function ensurePrivateDirExists(vaultPath: string): Promise<void> {
  const dir = path.join(vaultPath, AGENT_RUNTIME_PRIVATE_DIR_REL);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch { /* ignore */ }
}
