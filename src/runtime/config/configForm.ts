// LLM CLI Bridge — V20.7 Config Form
//
// 第三方服务表单：地址（baseURL）+ 模型（model）+ Key（由 secretsStore 单独管理）。
// 读取时用轻量正则/JSON 解析从原生配置文件提取三要素；
// 写入时用官方文档模板生成完整配置文件。
//
// 设计原则：
// - 不引入完整 TOML 解析器，只用正则提取 `key = "value"` 形式字段
// - JSON 配置用内置 JSON.parse
// - 写入时直接模板拼接，不做增量修改（保证文件始终是已知良好状态）
// - Key 永远不写入配置文件，由 secrets.env 注入

import * as fs from "fs";
import * as path from "path";
import {
  AGENT_RUNTIME_CODEX_CONFIG_REL,
  AGENT_RUNTIME_CLAUDE_CONFIG_REL,
  AGENT_RUNTIME_PI_SETTINGS_REL,
  AGENT_RUNTIME_PI_MODELS_REL,
} from "../../agentRuntimeWorkspace";
import type { RuntimeProviderId } from "./activeProvider";

// ---------- 表单数据结构 ----------

export interface ProviderForm {
  /** 第三方服务地址（baseURL），如 https://api.example.com/v1 */
  readonly baseURL: string;
  /** 模型 ID，如 gpt-5.4 / claude-sonnet-4-5 */
  readonly model: string;
}

export interface ProviderFormReadResult {
  readonly ok: boolean;
  readonly form: ProviderForm | null;
  /** 本地配置文件是否存在 */
  readonly localConfigExists: boolean;
  /** 读取失败时的错误信息（展示原生错误） */
  readonly error?: string;
}

// ---------- 原子写入 ----------

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

// ---------- Codex (config.toml) ----------

/**
 * 从 Codex config.toml 提取 model 和 base_url。
 * 用正则提取 `key = "value"` 形式字段，不做完整 TOML 解析。
 */
export function readCodexForm(vaultPath: string): ProviderFormReadResult {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_REL);
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { ok: true, form: null, localConfigExists: false };
  }

  try {
    const model = extractTomlString(content, "model");
    const baseURL = extractTomlString(content, "base_url");
    if (!model && !baseURL) {
      return { ok: true, form: null, localConfigExists: true };
    }
    return { ok: true, form: { baseURL: baseURL || "", model: model || "" }, localConfigExists: true };
  } catch (e) {
    return {
      ok: false,
      form: null,
      localConfigExists: true,
      error: `Codex config.toml 解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 生成 Codex config.toml（基于官方文档模板）。
 * Key 不写入文件，由 env_key 引用环境变量 CODEX_RELAY_API_KEY。
 */
export function writeCodexForm(vaultPath: string, form: ProviderForm): void {
  const content = [
    '# Codex 配置 — 由 Bridge 表单生成',
    '# Key 不写入此文件，由环境变量 CODEX_RELAY_API_KEY 注入（见 secrets.env）',
    '',
    `model = "${form.model}"`,
    'model_provider = "relay"',
    '',
    '[model_providers.relay]',
    'name = "Local Relay"',
    `base_url = "${form.baseURL}"`,
    'env_key = "CODEX_RELAY_API_KEY"',
    'wire_api = "responses"',
    '',
  ].join('\n');
  const filePath = path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_REL);
  atomicWrite(filePath, content);
}

// ---------- Claude (settings.json) ----------

/**
 * 从 Claude settings.json 读取 ANTHROPIC_BASE_URL 和 ANTHROPIC_MODEL。
 */
export function readClaudeForm(vaultPath: string): ProviderFormReadResult {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_CLAUDE_CONFIG_REL);
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { ok: true, form: null, localConfigExists: false };
  }

  try {
    const parsed = JSON.parse(content) as { env?: { ANTHROPIC_BASE_URL?: string; ANTHROPIC_MODEL?: string } };
    const baseURL = parsed.env?.ANTHROPIC_BASE_URL || "";
    const model = parsed.env?.ANTHROPIC_MODEL || "";
    if (!baseURL && !model) {
      return { ok: true, form: null, localConfigExists: true };
    }
    return { ok: true, form: { baseURL, model }, localConfigExists: true };
  } catch (e) {
    return {
      ok: false,
      form: null,
      localConfigExists: true,
      error: `Claude settings.json 解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 生成 Claude settings.json（基于官方文档模板）。
 * Key 不写入文件，由环境变量 ANTHROPIC_API_KEY 注入。
 */
export function writeClaudeForm(vaultPath: string, form: ProviderForm): void {
  const content = JSON.stringify({
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    env: {
      ANTHROPIC_BASE_URL: form.baseURL,
      ANTHROPIC_MODEL: form.model,
    },
  }, null, 2) + "\n";
  const filePath = path.join(vaultPath, AGENT_RUNTIME_CLAUDE_CONFIG_REL);
  atomicWrite(filePath, content);
}

// ---------- Pi (settings.json + models.json) ----------

/**
 * 从 Pi settings.json 读取 defaultModel，从 models.json 读取 baseUrl。
 */
export function readPiForm(vaultPath: string): ProviderFormReadResult {
  const settingsPath = path.join(vaultPath, AGENT_RUNTIME_PI_SETTINGS_REL);
  let settingsContent: string;
  try {
    settingsContent = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return { ok: true, form: null, localConfigExists: false };
  }

  try {
    const settings = JSON.parse(settingsContent) as { defaultModel?: string };
    const model = settings.defaultModel || "";

    // 读取 models.json 的 baseUrl
    let baseURL = "";
    try {
      const modelsPath = path.join(vaultPath, AGENT_RUNTIME_PI_MODELS_REL);
      const modelsContent = fs.readFileSync(modelsPath, "utf8");
      const models = JSON.parse(modelsContent) as { providers?: Record<string, { baseUrl?: string }> };
      const defaultProvider = (settings as { defaultProvider?: string }).defaultProvider || "relay";
      baseURL = models.providers?.[defaultProvider]?.baseUrl || "";
    } catch {
      // models.json 不存在或解析失败，baseURL 留空
    }

    if (!baseURL && !model) {
      return { ok: true, form: null, localConfigExists: true };
    }
    return { ok: true, form: { baseURL, model }, localConfigExists: true };
  } catch (e) {
    return {
      ok: false,
      form: null,
      localConfigExists: true,
      error: `Pi settings.json 解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 生成 Pi settings.json + models.json（基于官方文档模板）。
 * Key 不写入文件，由 models.json 的 apiKey 字段引用环境变量名 PI_RELAY_API_KEY。
 */
export function writePiForm(vaultPath: string, form: ProviderForm): void {
  // settings.json
  const settingsContent = JSON.stringify({
    defaultProvider: "relay",
    defaultModel: form.model,
    defaultThinkingLevel: "medium",
  }, null, 2) + "\n";
  atomicWrite(path.join(vaultPath, AGENT_RUNTIME_PI_SETTINGS_REL), settingsContent);

  // models.json — apiKey 字段值为环境变量名（Pi SDK 约定）
  const modelsContent = JSON.stringify({
    providers: {
      relay: {
        baseUrl: form.baseURL,
        apiKey: "PI_RELAY_API_KEY",
        api: "openai-responses",
        models: [
          {
            id: form.model,
            name: form.model,
            reasoning: true,
            input: ["text", "image"],
          },
        ],
      },
    },
  }, null, 2) + "\n";
  atomicWrite(path.join(vaultPath, AGENT_RUNTIME_PI_MODELS_REL), modelsContent);
}

// ---------- 统一入口 ----------

/** 读取指定 provider 的表单数据 */
export function readProviderForm(vaultPath: string, provider: RuntimeProviderId): ProviderFormReadResult {
  switch (provider) {
    case "codex": return readCodexForm(vaultPath);
    case "claude": return readClaudeForm(vaultPath);
    case "pi": return readPiForm(vaultPath);
  }
}

/** 保存指定 provider 的表单数据（生成原生配置文件） */
export function writeProviderForm(vaultPath: string, provider: RuntimeProviderId, form: ProviderForm): void {
  switch (provider) {
    case "codex": return writeCodexForm(vaultPath, form);
    case "claude": return writeClaudeForm(vaultPath, form);
    case "pi": return writePiForm(vaultPath, form);
  }
}

// ---------- 用户手写配置保护 ----------

/**
 * 检测本地配置文件是否由 Bridge 表单生成（可安全整文件覆盖）。
 *
 * 配置表单只能覆盖 Bridge 自己生成的配置；遇到用户手写的官方配置应转只读展示，
 * 不能整文件重写。检测基于 Bridge 模板的特征形状（不向官方配置注入额外字段）：
 * - Codex: 含 `由 Bridge 表单生成` 标记注释
 * - Claude: 顶层键 ⊆ {$schema, env}，env 键 ⊆ {ANTHROPIC_BASE_URL, ANTHROPIC_MODEL}
 * - Pi: settings.json 顶层键 ⊆ {defaultProvider, defaultModel, defaultThinkingLevel}
 *
 * 文件不存在时返回 false（无文件可保护，由调用方决定是否新建）。
 */
export function isBridgeGeneratedConfig(vaultPath: string, provider: RuntimeProviderId): boolean {
  switch (provider) {
    case "codex": return isCodexBridgeGenerated(vaultPath);
    case "claude": return isClaudeBridgeGenerated(vaultPath);
    case "pi": return isPiBridgeGenerated(vaultPath);
  }
}

function isCodexBridgeGenerated(vaultPath: string): boolean {
  try {
    const content = fs.readFileSync(path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_REL), "utf8");
    return content.includes("由 Bridge 表单生成");
  } catch {
    return false;
  }
}

function isClaudeBridgeGenerated(vaultPath: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(path.join(vaultPath, AGENT_RUNTIME_CLAUDE_CONFIG_REL), "utf8");
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const allowedTop = new Set(["$schema", "env"]);
    if (!Object.keys(parsed).every((k) => allowedTop.has(k))) return false;
    const env = (parsed.env as Record<string, unknown> | undefined) ?? {};
    const allowedEnv = new Set(["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"]);
    return Object.keys(env).every((k) => allowedEnv.has(k));
  } catch {
    return false;
  }
}

function isPiBridgeGenerated(vaultPath: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(path.join(vaultPath, AGENT_RUNTIME_PI_SETTINGS_REL), "utf8");
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const allowedTop = new Set(["defaultProvider", "defaultModel", "defaultThinkingLevel"]);
    return Object.keys(parsed).every((k) => allowedTop.has(k));
  } catch {
    return false;
  }
}

// ---------- TOML 轻量正则提取 ----------

/**
 * 从 TOML 内容中提取顶层或 table 内的字符串字段 `key = "value"`。
 * 只处理双引号字符串值，不处理数字/布尔/数组。
 */
function extractTomlString(content: string, key: string): string | null {
  // 匹配 `key = "value"` 形式（允许等号两侧空格）
  const re = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*"([^"]*)"`, "m");
  const match = re.exec(content);
  return match ? match[1] : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
