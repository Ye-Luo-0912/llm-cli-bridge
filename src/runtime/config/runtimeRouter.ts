// LLM CLI Bridge — V20.5 Runtime Router (simplified)
//
// Bridge 只负责：选择 active provider + 检测本地配置存在性 + 注入 *_HOME + 注入密钥。
// 不解析、不建模、不校验各 agent 的配置文件内容——配置由 agent 自己读取。
//
// 核心规则：
// - 本地配置文件存在 → 设置 *_HOME 指向本地配置目录（agent 优先读本地）
// - 本地配置文件缺失 → 不设置 *_HOME（agent 使用全局配置，Bridge 不干预）
// - 本地配置错误 → 展示 agent 原生错误，不自动回退
// - 密钥始终从 secrets.env 注入（作为环境变量，由 agent 配置文件中的变量名引用）

import * as fs from "fs";
import * as path from "path";
import {
  AGENT_RUNTIME_PRIVATE_RUNTIME_DIR_REL,
  AGENT_RUNTIME_ACTIVE_PROVIDER_REL,
  AGENT_RUNTIME_CODEX_CONFIG_REL,
  AGENT_RUNTIME_CODEX_CONFIG_DIR_REL,
  AGENT_RUNTIME_CLAUDE_CONFIG_REL,
  AGENT_RUNTIME_CLAUDE_CONFIG_DIR_REL,
  AGENT_RUNTIME_PI_SETTINGS_REL,
  AGENT_RUNTIME_PI_CONFIG_DIR_REL,
  AGENT_RUNTIME_PROVIDER_CONFIG_REL,
} from "../../agentRuntimeWorkspace";
import { getActiveProvider, saveActiveProvider, type RuntimeProviderId } from "./activeProvider";
import {
  loadAllSecrets, getSecret, setSecret, clearSecret, getSecretKeyStatus,
  type SecretVarName, type SecretKeyStatus,
} from "./secretsStore";

// ---------- 本地配置存在性检测 ----------

/** 检测 Codex 本地配置 (config.toml) 是否存在 */
export function codexConfigExists(vaultPath: string): boolean {
  try {
    return fs.existsSync(path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_REL));
  } catch {
    return false;
  }
}

/** 检测 Claude 本地配置 (settings.local.json) 是否存在 */
export function claudeConfigExists(vaultPath: string): boolean {
  try {
    return fs.existsSync(path.join(vaultPath, AGENT_RUNTIME_CLAUDE_CONFIG_REL));
  } catch {
    return false;
  }
}

/** 检测 Pi 本地配置 (settings.json) 是否存在 */
export function piConfigExists(vaultPath: string): boolean {
  try {
    return fs.existsSync(path.join(vaultPath, AGENT_RUNTIME_PI_SETTINGS_REL));
  } catch {
    return false;
  }
}

// ---------- 路径获取 ----------

export function getCodexConfigDir(vaultPath: string): string {
  return path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_DIR_REL);
}

export function getClaudeConfigDir(vaultPath: string): string {
  return path.join(vaultPath, AGENT_RUNTIME_CLAUDE_CONFIG_DIR_REL);
}

export function getPiConfigDir(vaultPath: string): string {
  return path.join(vaultPath, AGENT_RUNTIME_PI_CONFIG_DIR_REL);
}

// ---------- 路由状态 ----------

/** 各 provider 的配置状态（供 UI 展示，不解析配置内容） */
export interface ProviderConfigStatus {
  readonly provider: RuntimeProviderId;
  /** 本地配置文件是否存在 */
  readonly localConfigExists: boolean;
  /** 是否有密钥 */
  readonly hasKey: boolean;
  /** 密钥状态 */
  readonly keyStatus: SecretKeyStatus;
}

/** 聚合路由状态 */
export interface RouterState {
  readonly activeProvider: RuntimeProviderId;
  readonly providers: Readonly<Record<RuntimeProviderId, ProviderConfigStatus>>;
}

/** 获取聚合路由状态（只检测文件存在性，不解析内容） */
export function getRouterState(vaultPath: string): RouterState {
  const activeProvider = getActiveProvider(vaultPath);
  const secrets = loadAllSecrets(vaultPath);

  return {
    activeProvider,
    providers: {
      codex: {
        provider: "codex",
        localConfigExists: codexConfigExists(vaultPath),
        hasKey: !!secrets.get("CODEX_RELAY_API_KEY"),
        keyStatus: getSecretKeyStatus(vaultPath),
      },
      claude: {
        provider: "claude",
        localConfigExists: claudeConfigExists(vaultPath),
        hasKey: !!(secrets.get("ANTHROPIC_API_KEY") || secrets.get("ANTHROPIC_AUTH_TOKEN")),
        keyStatus: getSecretKeyStatus(vaultPath),
      },
      pi: {
        provider: "pi",
        localConfigExists: piConfigExists(vaultPath),
        hasKey: !!secrets.get("PI_RELAY_API_KEY"),
        keyStatus: getSecretKeyStatus(vaultPath),
      },
    },
  };
}

// ---------- Env 构建 ----------

/**
 * 为 active provider 构建 spawn env。
 *
 * 规则：
 * - 本地配置存在 → 设置 *_HOME 指向本地配置目录（agent 优先读本地）
 * - 本地配置缺失 → 不设置 *_HOME（agent 使用全局配置，Bridge 不干预）
 * - 密钥始终注入（从 secrets.env 读取）
 */
export function buildRuntimeEnv(vaultPath: string): Record<string, string> {
  const provider = getActiveProvider(vaultPath);
  const secrets = loadAllSecrets(vaultPath);
  const env: Record<string, string> = {};

  switch (provider) {
    case "codex": {
      // 本地 config.toml 存在 → 设置 CODEX_HOME，Codex 从中读取配置
      if (codexConfigExists(vaultPath)) {
        env.CODEX_HOME = getCodexConfigDir(vaultPath);
      }
      // 注入 CODEX_RELAY_API_KEY（config.toml 的 env_key 引用此变量名）
      const key = secrets.get("CODEX_RELAY_API_KEY");
      if (key) env.CODEX_RELAY_API_KEY = key;
      break;
    }
    case "claude": {
      // 本地 settings.local.json 存在 → 设置 CLAUDE_CONFIG_DIR
      if (claudeConfigExists(vaultPath)) {
        env.CLAUDE_CONFIG_DIR = getClaudeConfigDir(vaultPath);
      }
      // 注入 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
      const apiKey = secrets.get("ANTHROPIC_API_KEY");
      if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
      const authToken = secrets.get("ANTHROPIC_AUTH_TOKEN");
      if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
      break;
    }
    case "pi": {
      // 本地 settings.json 存在 → 设置 PI_CODING_AGENT_DIR
      if (piConfigExists(vaultPath)) {
        env.PI_CODING_AGENT_DIR = getPiConfigDir(vaultPath);
      }
      // 注入 PI_RELAY_API_KEY
      const key = secrets.get("PI_RELAY_API_KEY");
      if (key) env.PI_RELAY_API_KEY = key;
      break;
    }
  }

  return env;
}

// ---------- 设置入口 ----------

/** 设置 active provider */
export function setActiveProvider(vaultPath: string, provider: RuntimeProviderId): void {
  saveActiveProvider(vaultPath, provider);
}

/** 设置 Codex 密钥 */
export function setCodexKey(vaultPath: string, key: string): SecretKeyStatus {
  return setSecret(vaultPath, "CODEX_RELAY_API_KEY", key);
}

/** 设置 Claude 密钥（ANTHROPIC_API_KEY） */
export function setClaudeKey(vaultPath: string, key: string): SecretKeyStatus {
  return setSecret(vaultPath, "ANTHROPIC_API_KEY", key);
}

/** 设置 Pi 密钥 */
export function setPiKey(vaultPath: string, key: string): SecretKeyStatus {
  return setSecret(vaultPath, "PI_RELAY_API_KEY", key);
}

/** 清除 Codex 密钥 */
export function clearCodexKey(vaultPath: string): void {
  clearSecret(vaultPath, "CODEX_RELAY_API_KEY");
}

/** 清除 Claude 密钥 */
export function clearClaudeKey(vaultPath: string): void {
  clearSecret(vaultPath, "ANTHROPIC_API_KEY");
  clearSecret(vaultPath, "ANTHROPIC_AUTH_TOKEN");
}

/** 清除 Pi 密钥 */
export function clearPiKey(vaultPath: string): void {
  clearSecret(vaultPath, "PI_RELAY_API_KEY");
}

// ---------- V20.4 → V20.5 迁移 ----------

export interface MigrationResult {
  readonly migrated: boolean;
  readonly reason: string;
  readonly createdFiles: string[];
}

/**
 * 从 V20.4 runtime-provider.json 迁移到 V20.5。
 *
 * V20.5 不再建模配置文件内容，只迁移：
 * - active.json（默认 codex）
 * - 密钥（从旧 legacyApiKey 迁移到 secrets.env）
 *
 * 旧的 relayUrl/model 由用户手动写入各 agent 的原生配置文件。
 * Bridge 不自动生成 config.toml / settings.local.json / settings.json。
 */
export function migrateFromV20_4(vaultPath: string): MigrationResult {
  const oldConfigPath = path.join(vaultPath, AGENT_RUNTIME_PROVIDER_CONFIG_REL);

  // 检查旧配置是否存在
  let oldConfig: Record<string, unknown> = {};
  try {
    oldConfig = JSON.parse(fs.readFileSync(oldConfigPath, "utf8"));
  } catch {
    return { migrated: false, reason: "无 V20.4 配置文件，无需迁移", createdFiles: [] };
  }

  // 检查 V20.5 active.json 是否已存在（已迁移则跳过）
  const activePath = path.join(vaultPath, AGENT_RUNTIME_ACTIVE_PROVIDER_REL);
  if (fs.existsSync(activePath)) {
    return { migrated: false, reason: "V20.5 配置已存在，跳过迁移", createdFiles: [] };
  }

  const createdFiles: string[] = [];
  const apiKey = typeof oldConfig.legacyApiKey === "string" ? oldConfig.legacyApiKey : "";

  // 确保目录存在
  const runtimeDir = path.join(vaultPath, AGENT_RUNTIME_PRIVATE_RUNTIME_DIR_REL);
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 创建 active.json（默认 codex）
  saveActiveProvider(vaultPath, "codex");
  createdFiles.push("active.json");

  // 迁移 API Key 到 secrets.env
  if (apiKey) {
    setSecret(vaultPath, "CODEX_RELAY_API_KEY", apiKey);
    setSecret(vaultPath, "ANTHROPIC_API_KEY", apiKey);
    setSecret(vaultPath, "PI_RELAY_API_KEY", apiKey);
    createdFiles.push("secrets.env");
  }

  return {
    migrated: true,
    reason: "已从 V20.4 迁移 active.json + 密钥。请手动在各 agent 配置文件中填写 relayUrl/model（Bridge 不再自动生成配置文件内容）",
    createdFiles,
  };
}

// ---------- 清除缓存（测试用） ----------

export function clearRouterCache(): void {
  const { clearSecretsCache } = require("./secretsStore") as typeof import("./secretsStore");
  clearSecretsCache();
}

// ---------- 重新导出 ----------

export {
  getActiveProvider, saveActiveProvider, type RuntimeProviderId,
} from "./activeProvider";

export {
  getSecretKeyStatus, type SecretKeyStatus, type SecretVarName,
} from "./secretsStore";
