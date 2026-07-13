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
  AGENT_RUNTIME_BRIDGE_OWNED_REL,
} from "../../agentRuntimeWorkspace";
import type { RuntimeProviderId } from "./activeProvider";

// ---------- 表单数据结构 ----------

export interface ProviderForm {
  /** 第三方服务地址（baseURL），如 https://api.example.com/v1 */
  readonly baseURL: string;
  /** 模型 ID，如 gpt-5.4 / claude-sonnet-4-5 */
  readonly model: string;
  /** Codex-only：personality（写入 config.toml 根表，单一真相源） */
  readonly codexPersonality?: "none" | "friendly" | "pragmatic";
  /** Codex-only：reasoning summary（写入 config.toml model_reasoning_summary） */
  readonly codexReasoningSummary?: "auto" | "concise" | "detailed" | "none";
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
    // personality / model_reasoning_summary 为 config.toml 单一真相源（V20.11）
    const personalityRaw = extractTomlString(content, "personality");
    const summaryRaw = extractTomlString(content, "model_reasoning_summary");
    const codexPersonality = personalityRaw === "none" || personalityRaw === "friendly" || personalityRaw === "pragmatic"
      ? personalityRaw
      : undefined;
    const codexReasoningSummary = summaryRaw === "auto" || summaryRaw === "concise" || summaryRaw === "detailed" || summaryRaw === "none"
      ? summaryRaw
      : undefined;
    return {
      ok: true,
      form: { baseURL: baseURL || "", model: model || "", codexPersonality, codexReasoningSummary },
      localConfigExists: true,
    };
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
 * V20.11：personality / model_reasoning_summary 写入根表，作为单一真相源；
 * turn/start 不再重复发送（直接让 Codex Runtime 解析 config.toml）。
 */
export function writeCodexForm(
  vaultPath: string,
  form: ProviderForm,
): void {
  const personality = form.codexPersonality ?? "pragmatic";
  const reasoningSummary = form.codexReasoningSummary ?? "auto";
  const lines: string[] = [
    '# Codex 配置 — 由 Bridge 表单生成',
    '# Key 不写入此文件，由环境变量 CODEX_RELAY_API_KEY 注入（见 secrets.env）',
    '# personality / model_reasoning_summary 为单一真相源；运行时不再在 turn/start 覆盖',
    '',
    `model = "${form.model}"`,
    'model_provider = "relay"',
    `model_reasoning_summary = "${reasoningSummary}"`,
    'model_supports_reasoning_summaries = true',
    `personality = "${personality}"`,
    '',
    '[model_providers.relay]',
    'name = "Local Relay"',
    `base_url = "${form.baseURL}"`,
    'env_key = "CODEX_RELAY_API_KEY"',
    'wire_api = "responses"',
    '',
  ];
  const content = lines.join('\n');
  const filePath = path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_REL);
  atomicWrite(filePath, content);
}

/** 误落在 [model_providers.*] 子表、应提升到根表的字段 */
const CODEX_ROOT_FIELDS = [
  "model_reasoning_summary",
  "model_supports_reasoning_summaries",
  "personality",
  "model",
  "model_provider",
] as const;

/**
 * 检测并提升误落在 [model_providers.relay]（或其它 provider 子表）下的根字段。
 * 返回修复后的 TOML；若无需修复则原样返回。
 */
export function normalizeCodexConfigToml(content: string): { content: string; lifted: string[] } {
  const lines = content.split(/\r?\n/);
  const lifted: string[] = [];
  const rootValues = new Map<string, string>();
  const sectionLineIndexesToDrop = new Set<number>();

  let currentSection: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    if (!currentSection || !currentSection.startsWith("model_providers.")) continue;
    for (const key of CODEX_ROOT_FIELDS) {
      const re = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+?)\\s*$`);
      const m = re.exec(line);
      if (!m) continue;
      if (!rootValues.has(key)) {
        rootValues.set(key, m[1].trim());
        lifted.push(key);
      }
      sectionLineIndexesToDrop.add(i);
      break;
    }
  }

  if (lifted.length === 0) {
    return { content, lifted: [] };
  }

  // 去掉子表中的误放行
  const withoutMisplaced = lines.filter((_, idx) => !sectionLineIndexesToDrop.has(idx));

  // 在第一个 [section] 之前插入缺失的根字段（已存在的根键不覆盖）
  const existingRoot = new Set<string>();
  for (const line of withoutMisplaced) {
    if (/^\s*\[/.test(line)) break;
    for (const key of CODEX_ROOT_FIELDS) {
      if (new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(line)) {
        existingRoot.add(key);
      }
    }
  }

  const insertLines: string[] = [];
  for (const key of lifted) {
    if (existingRoot.has(key)) continue;
    const value = rootValues.get(key);
    if (value == null) continue;
    insertLines.push(`${key} = ${value}`);
  }

  if (insertLines.length === 0) {
    return { content: withoutMisplaced.join("\n"), lifted };
  }

  let insertAt = withoutMisplaced.findIndex((line) => /^\s*\[/.test(line));
  if (insertAt < 0) insertAt = withoutMisplaced.length;
  // 保证根字段与 section 之间有空行
  const before = withoutMisplaced.slice(0, insertAt);
  while (before.length > 0 && before[before.length - 1].trim() === "") before.pop();
  const after = withoutMisplaced.slice(insertAt);
  const merged = [...before, ...insertLines, "", ...after];
  return { content: merged.join("\n"), lifted };
}

/**
 * 若 Vault 内 config.toml 把 reasoning/personality 误写在 provider 子表下，提升到根表并写回。
 */
export function normalizeCodexConfigRootFields(vaultPath: string): { ok: boolean; lifted: string[]; changed: boolean; error?: string } {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_CODEX_CONFIG_REL);
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { ok: true, lifted: [], changed: false };
  }
  try {
    const { content: next, lifted } = normalizeCodexConfigToml(content);
    if (lifted.length === 0 || next === content) {
      return { ok: true, lifted, changed: false };
    }
    atomicWrite(filePath, next.endsWith("\n") ? next : `${next}\n`);
    return { ok: true, lifted, changed: true };
  } catch (e) {
    return {
      ok: false,
      lifted: [],
      changed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
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

/** 保存指定 provider 的表单数据（生成原生配置文件 + 标记 sidecar 所有权） */
export function writeProviderForm(
  vaultPath: string,
  provider: RuntimeProviderId,
  form: ProviderForm,
): void {
  switch (provider) {
    case "codex":
      writeCodexForm(vaultPath, form);
      // Round 1：写回后若仍有历史误放字段（理论上模板已正确），再 normalize 一次
      normalizeCodexConfigRootFields(vaultPath);
      break;
    case "claude": writeClaudeForm(vaultPath, form); break;
    case "pi": writePiForm(vaultPath, form); break;
  }
  // V20.9: 写入成功后标记 sidecar 所有权（下次可安全覆盖）
  markProviderBridgeOwned(vaultPath, provider);
}

// ---------- 用户手写配置保护（V20.9: sidecar 所有权记录） ----------

/**
 * Bridge 所有权 sidecar 结构。
 *
 * 只有 providers[provider] === true 的 provider，其本地配置文件才允许被 Bridge 表单
 * 整文件覆盖。sidecar 是所有权的唯一真相源，不再根据配置文件内容形状猜测。
 */
interface BridgeOwnedRecord {
  readonly schemaVersion: 1;
  readonly providers: Record<RuntimeProviderId, boolean>;
}

function readBridgeOwned(vaultPath: string): BridgeOwnedRecord {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_BRIDGE_OWNED_REL);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<BridgeOwnedRecord>;
    if (parsed.schemaVersion !== 1 || !parsed.providers) {
      return { schemaVersion: 1, providers: { codex: false, claude: false, pi: false } };
    }
    return {
      schemaVersion: 1,
      providers: {
        codex: !!parsed.providers.codex,
        claude: !!parsed.providers.claude,
        pi: !!parsed.providers.pi,
      },
    };
  } catch {
    return { schemaVersion: 1, providers: { codex: false, claude: false, pi: false } };
  }
}

function writeBridgeOwned(vaultPath: string, record: BridgeOwnedRecord): void {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_BRIDGE_OWNED_REL);
  atomicWrite(filePath, JSON.stringify(record, null, 2) + "\n");
}

/** 标记 provider 的本地配置由 Bridge 表单创建（写入 sidecar）。 */
function markProviderBridgeOwned(vaultPath: string, provider: RuntimeProviderId): void {
  const record = readBridgeOwned(vaultPath);
  if (record.providers[provider]) return;
  writeBridgeOwned(vaultPath, {
    ...record,
    providers: { ...record.providers, [provider]: true },
  });
}

/**
 * 检测本地配置文件是否由 Bridge 表单生成（可安全整文件覆盖）。
 *
 * V20.9: 只查 bridge-owned.json sidecar，不再根据配置文件内容形状猜测。
 * 这样即使用户手写配置刚好只有 Bridge 模板字段，也不会被误判为 Bridge 生成。
 */
export function isBridgeGeneratedConfig(vaultPath: string, provider: RuntimeProviderId): boolean {
  return readBridgeOwned(vaultPath).providers[provider] === true;
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
