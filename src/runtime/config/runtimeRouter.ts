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
import * as os from "os";
import * as path from "path";
import {
  AGENT_RUNTIME_PRIVATE_RUNTIME_DIR_REL,
  AGENT_RUNTIME_ACTIVE_PROVIDER_REL,
  AGENT_RUNTIME_CODEX_CONFIG_REL,
  AGENT_RUNTIME_CODEX_CONFIG_DIR_REL,
  AGENT_RUNTIME_CLAUDE_CONFIG_REL,
  AGENT_RUNTIME_CLAUDE_CONFIG_DIR_REL,
  AGENT_RUNTIME_PI_SETTINGS_REL,
  AGENT_RUNTIME_PI_MODELS_REL,
  AGENT_RUNTIME_PI_CONFIG_DIR_REL,
  AGENT_RUNTIME_PROVIDER_CONFIG_REL,
} from "../../agentRuntimeWorkspace";
import { getActiveProvider, saveActiveProvider, type RuntimeProviderId } from "./activeProvider";
import {
  loadAllSecrets, getSecret, setSecret, clearSecret, getSecretKeyStatus, getSecretStatus,
  type SecretVarName, type SecretKeyStatus,
} from "./secretsStore";
import { writeProviderForm, readProviderForm } from "./configForm";

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

// ---------- 全局配置目录（用于"打开全局配置目录"按钮）----------

/** 获取 Codex 全局配置目录（CODEX_HOME 或 ~/.codex） */
export function getGlobalCodexConfigDir(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/** 获取 Claude 全局配置目录（CLAUDE_CONFIG_DIR 或 ~/.claude） */
export function getGlobalClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/** 获取 Pi 全局配置目录（PI_CODING_AGENT_DIR 或 ~/.pi） */
export function getGlobalPiConfigDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi");
}

/** 检测全局配置目录是否存在 */
export function globalCodexConfigExists(): boolean {
  try { return fs.existsSync(getGlobalCodexConfigDir()); } catch { return false; }
}
export function globalClaudeConfigExists(): boolean {
  try { return fs.existsSync(getGlobalClaudeConfigDir()); } catch { return false; }
}
export function globalPiConfigExists(): boolean {
  try { return fs.existsSync(getGlobalPiConfigDir()); } catch { return false; }
}

// ---------- 创建本地配置（先复制全局，没有则用官方模板生成）----------

export interface CreateLocalConfigResult {
  readonly ok: boolean;
  readonly source: "global-copy" | "template" | "already-exists";
  readonly createdFiles: string[];
  readonly reason?: string;
}

/** 原子写入文件（tmp + rename） */
function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp-" + process.pid;
  fs.writeFileSync(tmpPath, content, "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw e;
  }
}

/** Codex config.toml 官方模板 */
function codexConfigTemplate(): string {
  return [
    '# Codex 配置 — 由 Bridge 创建（基于官方文档模板）',
    '# 请将 base_url 和 model 替换为你的中转站地址和模型',
    "",
    'model = "gpt-5.4"',
    'model_provider = "relay"',
    "",
    "[model_providers.relay]",
    'name = "Local Relay"',
    'base_url = "https://api.example.com/v1"',
    'env_key = "CODEX_RELAY_API_KEY"',
    'wire_api = "responses"',
    "",
  ].join("\n");
}

/** Claude settings.json 官方模板 */
function claudeConfigTemplate(): string {
  return JSON.stringify({
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    env: {
      ANTHROPIC_BASE_URL: "https://api.example.com",
      ANTHROPIC_MODEL: "claude-sonnet-4-5",
    },
  }, null, 2) + "\n";
}

/** Pi settings.json 官方模板 */
function piSettingsTemplate(): string {
  return JSON.stringify({
    defaultProvider: "relay",
    defaultModel: "gpt-5.4",
    defaultThinkingLevel: "medium",
  }, null, 2) + "\n";
}

/** Pi models.json 官方模板 */
function piModelsTemplate(): string {
  return JSON.stringify({
    providers: {
      relay: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "PI_RELAY_API_KEY",
        api: "openai-responses",
        models: [
          {
            id: "gpt-5.4",
            name: "GPT-5.4",
            reasoning: true,
            input: ["text", "image"],
          },
        ],
      },
    },
  }, null, 2) + "\n";
}

/**
 * 创建 Codex 本地配置。
 * 先尝试从全局 ~/.codex/ 复制 config.toml；全局不存在则用官方模板生成。
 */
export function createCodexLocalConfig(vaultPath: string): CreateLocalConfigResult {
  const localPath = path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_REL);
  if (fs.existsSync(localPath)) {
    return { ok: true, source: "already-exists", createdFiles: [] };
  }

  // 尝试从全局复制
  const globalDir = getGlobalCodexConfigDir();
  const globalConfig = path.join(globalDir, "config.toml");
  if (fs.existsSync(globalConfig)) {
    try {
      const content = fs.readFileSync(globalConfig, "utf8");
      atomicWrite(localPath, content);
      return { ok: true, source: "global-copy", createdFiles: [AGENT_RUNTIME_CODEX_CONFIG_REL] };
    } catch (e) {
      return { ok: false, source: "template", createdFiles: [], reason: `复制全局配置失败：${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // 全局不存在，用模板生成
  try {
    atomicWrite(localPath, codexConfigTemplate());
    return { ok: true, source: "template", createdFiles: [AGENT_RUNTIME_CODEX_CONFIG_REL] };
  } catch (e) {
    return { ok: false, source: "template", createdFiles: [], reason: `生成模板配置失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 创建 Claude 本地配置。
 * 先尝试从全局 ~/.claude/ 复制 settings.json；全局不存在则用官方模板生成。
 */
export function createClaudeLocalConfig(vaultPath: string): CreateLocalConfigResult {
  const localPath = path.join(vaultPath, AGENT_RUNTIME_CLAUDE_CONFIG_REL);
  if (fs.existsSync(localPath)) {
    return { ok: true, source: "already-exists", createdFiles: [] };
  }

  // 尝试从全局复制（优先 settings.json，其次 settings.local.json）
  const globalDir = getGlobalClaudeConfigDir();
  for (const name of ["settings.json", "settings.local.json"]) {
    const globalConfig = path.join(globalDir, name);
    if (fs.existsSync(globalConfig)) {
      try {
        const content = fs.readFileSync(globalConfig, "utf8");
        atomicWrite(localPath, content);
        return { ok: true, source: "global-copy", createdFiles: [AGENT_RUNTIME_CLAUDE_CONFIG_REL] };
      } catch (e) {
        return { ok: false, source: "template", createdFiles: [], reason: `复制全局配置失败：${e instanceof Error ? e.message : String(e)}` };
      }
    }
  }

  // 全局不存在，用模板生成
  try {
    atomicWrite(localPath, claudeConfigTemplate());
    return { ok: true, source: "template", createdFiles: [AGENT_RUNTIME_CLAUDE_CONFIG_REL] };
  } catch (e) {
    return { ok: false, source: "template", createdFiles: [], reason: `生成模板配置失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 创建 Pi 本地配置。
 * 先尝试从全局 ~/.pi/ 复制 settings.json + models.json；全局不存在则用官方模板生成。
 */
export function createPiLocalConfig(vaultPath: string): CreateLocalConfigResult {
  const localSettingsPath = path.join(vaultPath, AGENT_RUNTIME_PI_SETTINGS_REL);
  const localModelsPath = path.join(vaultPath, AGENT_RUNTIME_PI_MODELS_REL);
  if (fs.existsSync(localSettingsPath)) {
    return { ok: true, source: "already-exists", createdFiles: [] };
  }

  const createdFiles: string[] = [];
  let source: "global-copy" | "template" = "template";
  const globalDir = getGlobalPiConfigDir();
  const globalSettings = path.join(globalDir, "settings.json");
  const globalModels = path.join(globalDir, "models.json");

  // settings.json
  if (fs.existsSync(globalSettings)) {
    try {
      const content = fs.readFileSync(globalSettings, "utf8");
      atomicWrite(localSettingsPath, content);
      createdFiles.push(AGENT_RUNTIME_PI_SETTINGS_REL);
      source = "global-copy";
    } catch (e) {
      return { ok: false, source: "template", createdFiles: [], reason: `复制全局 settings.json 失败：${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    try {
      atomicWrite(localSettingsPath, piSettingsTemplate());
      createdFiles.push(AGENT_RUNTIME_PI_SETTINGS_REL);
    } catch (e) {
      return { ok: false, source: "template", createdFiles: [], reason: `生成模板 settings.json 失败：${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // models.json
  if (fs.existsSync(globalModels)) {
    try {
      const content = fs.readFileSync(globalModels, "utf8");
      atomicWrite(localModelsPath, content);
      createdFiles.push(AGENT_RUNTIME_PI_MODELS_REL);
    } catch (e) {
      // models.json 复制失败不阻塞，用模板补充
      try {
        atomicWrite(localModelsPath, piModelsTemplate());
        createdFiles.push(AGENT_RUNTIME_PI_MODELS_REL);
      } catch { /* ignore */ }
    }
  } else {
    try {
      atomicWrite(localModelsPath, piModelsTemplate());
      createdFiles.push(AGENT_RUNTIME_PI_MODELS_REL);
    } catch (e) {
      return { ok: false, source, createdFiles, reason: `生成模板 models.json 失败：${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return { ok: true, source, createdFiles };
}

// ---------- 路由状态 ----------

/** 各 provider 的配置状态（供 UI 展示，不解析配置内容） */
export interface ProviderConfigStatus {
  readonly provider: RuntimeProviderId;
  /** 本地配置文件是否存在 */
  readonly localConfigExists: boolean;
  /** 本地配置文件相对路径（供 UI 显示） */
  readonly localConfigPath: string;
  /** 全局配置目录是否存在 */
  readonly globalConfigExists: boolean;
  /** 全局配置目录绝对路径（供 UI 打开） */
  readonly globalConfigDir: string;
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
        localConfigPath: AGENT_RUNTIME_CODEX_CONFIG_REL,
        globalConfigExists: globalCodexConfigExists(),
        globalConfigDir: getGlobalCodexConfigDir(),
        hasKey: !!secrets.get("CODEX_RELAY_API_KEY"),
        keyStatus: getSecretStatus(vaultPath, "CODEX_RELAY_API_KEY"),
      },
      claude: {
        provider: "claude",
        localConfigExists: claudeConfigExists(vaultPath),
        localConfigPath: AGENT_RUNTIME_CLAUDE_CONFIG_REL,
        globalConfigExists: globalClaudeConfigExists(),
        globalConfigDir: getGlobalClaudeConfigDir(),
        hasKey: !!(secrets.get("ANTHROPIC_API_KEY") || secrets.get("ANTHROPIC_AUTH_TOKEN")),
        // Claude 优先检查 ANTHROPIC_API_KEY，其次 ANTHROPIC_AUTH_TOKEN
        keyStatus: getSecretStatus(vaultPath, "ANTHROPIC_API_KEY") !== "not-configured"
          ? getSecretStatus(vaultPath, "ANTHROPIC_API_KEY")
          : getSecretStatus(vaultPath, "ANTHROPIC_AUTH_TOKEN"),
      },
      pi: {
        provider: "pi",
        localConfigExists: piConfigExists(vaultPath),
        localConfigPath: AGENT_RUNTIME_PI_SETTINGS_REL,
        globalConfigExists: globalPiConfigExists(),
        globalConfigDir: getGlobalPiConfigDir(),
        hasKey: !!secrets.get("PI_RELAY_API_KEY"),
        keyStatus: getSecretStatus(vaultPath, "PI_RELAY_API_KEY"),
      },
    },
  };
}

// ---------- Readiness 检查（发送前阻断）----------

export interface ReadinessResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** 缺配置/缺 Key 时为 true，调用方不应创建 assistant 失败消息 */
  readonly preSendBlock: boolean;
}

/**
 * V20.8: 发送前 readiness 检查。
 *
 * 检查 active provider 的本地配置 + 密钥是否就绪。
 * - 本地配置存在 + Key 已配置 → ok
 * - 本地配置存在但缺 Key → preSendBlock（不创建 assistant 失败消息）
 * - 本地配置缺失 → ok（使用全局配置，Bridge 不干预）
 * - 本地配置文件解析错误 → preSendBlock + 展示原生错误
 *
 * 替代 RunSessionController 中的 loadRuntimeProviderState 调用。
 */
export function checkRuntimeReadiness(vaultPath: string): ReadinessResult {
  const provider = getActiveProvider(vaultPath);
  const secrets = loadAllSecrets(vaultPath);
  const state = getRouterState(vaultPath);
  const status = state.providers[provider];

  // 本地配置缺失 → 使用全局配置，不阻断
  if (!status.localConfigExists) {
    return { ok: true, preSendBlock: false };
  }

  // 本地配置存在，检查表单是否可解析
  const formRead = readProviderForm(vaultPath, provider);
  if (!formRead.ok && formRead.error) {
    return {
      ok: false,
      reason: formRead.error,
      preSendBlock: true,
    };
  }

  // 检查密钥
  let hasKey = false;
  switch (provider) {
    case "codex":
      hasKey = !!secrets.get("CODEX_RELAY_API_KEY");
      break;
    case "claude":
      hasKey = !!(secrets.get("ANTHROPIC_API_KEY") || secrets.get("ANTHROPIC_AUTH_TOKEN"));
      break;
    case "pi":
      hasKey = !!secrets.get("PI_RELAY_API_KEY");
      break;
  }

  if (!hasKey) {
    return {
      ok: false,
      reason: `${provider} 本地配置已创建但缺少 API Key。请在设置页填写 Key 后重试。`,
      preSendBlock: true,
    };
  }

  return { ok: true, preSendBlock: false };
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
  getSecretKeyStatus, getSecretStatus, type SecretKeyStatus, type SecretVarName,
} from "./secretsStore";

export {
  readProviderForm, writeProviderForm,
  readCodexForm, writeCodexForm,
  readClaudeForm, writeClaudeForm,
  readPiForm, writePiForm,
  type ProviderForm, type ProviderFormReadResult,
} from "./configForm";

// ---------- V20.7: 表单 + 密钥统一保存 ----------

export interface SaveProviderFormInput {
  readonly baseURL: string;
  readonly model: string;
  /** 空字符串表示不更新密钥 */
  readonly apiKey?: string;
}

export interface SaveProviderFormResult {
  readonly ok: boolean;
  readonly error?: string;
  /** 生成的配置文件相对路径 */
  readonly createdFiles: string[];
  /** 密钥保存状态（仅在 apiKey 非空时返回） */
  readonly keyStatus?: SecretKeyStatus;
}

/**
 * V20.7: 保存 provider 表单（生成原生配置文件 + 注入密钥）。
 *
 * 1. 调用 writeProviderForm 生成对应 runtime 的官方配置文件
 * 2. 如果 apiKey 非空，调用 setXxxKey 注入到 secrets.env
 *
 * 配置错误时直接抛出，不静默回退。
 */
export function saveProviderForm(
  vaultPath: string,
  provider: RuntimeProviderId,
  input: SaveProviderFormInput,
): SaveProviderFormResult {
  const createdFiles: string[] = [];
  try {
    writeProviderForm(vaultPath, provider, { baseURL: input.baseURL, model: input.model });
    // 记录生成的文件路径
    switch (provider) {
      case "codex":
        createdFiles.push(AGENT_RUNTIME_CODEX_CONFIG_REL);
        break;
      case "claude":
        createdFiles.push(AGENT_RUNTIME_CLAUDE_CONFIG_REL);
        break;
      case "pi":
        createdFiles.push(AGENT_RUNTIME_PI_SETTINGS_REL, AGENT_RUNTIME_PI_MODELS_REL);
        break;
    }
  } catch (e) {
    return {
      ok: false,
      error: `生成配置文件失败：${e instanceof Error ? e.message : String(e)}`,
      createdFiles,
    };
  }

  let keyStatus: SecretKeyStatus | undefined;
  if (input.apiKey && input.apiKey.trim()) {
    try {
      switch (provider) {
        case "codex":
          keyStatus = setCodexKey(vaultPath, input.apiKey.trim());
          break;
        case "claude":
          keyStatus = setClaudeKey(vaultPath, input.apiKey.trim());
          break;
        case "pi":
          keyStatus = setPiKey(vaultPath, input.apiKey.trim());
          break;
      }
    } catch (e) {
      return {
        ok: false,
        error: `密钥保存失败：${e instanceof Error ? e.message : String(e)}`,
        createdFiles,
      };
    }
  }

  return { ok: true, createdFiles, keyStatus };
}
