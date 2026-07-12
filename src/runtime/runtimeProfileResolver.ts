// LLM CLI Bridge — Runtime Profile Resolver (provider-neutral)
//
// 统一解析 Codex 主 runtime 使用的 OpenAI-compatible 中转配置；高级 provider 可选择复用：
// - Vault 内 .llm-bridge/runtime-profile.json 保存 relayUrl / model / source（可同步，严禁保存 Key）
// - API Key 仅在当前插件进程内存中保存，或写入用户明确指定的便携目录（多 Vault 共用）
// - 解析结果注入 Codex 子进程 env / Claude env / Pi AuthStorage
//
// 安全规则：
// - Vault 内 JSON 不得包含 apiKey 字段
// - 所有错误消息必须经过 desensitizeError 脱敏（移除 key 片段）
// - 状态栏只显示来源/域名/模型，不显示 Key

import * as fs from "fs";
import * as path from "path";

// ---------- 类型 ----------

/** Vault 内 .llm-bridge/runtime-profile.json 的 schema（严禁包含 apiKey） */
export interface VaultRuntimeProfile {
  readonly relayUrl: string;
  readonly model: string;
  /** 标识 profile 来源类型，固定 "local-relay" */
  readonly source: string;
}

/** 解析后的运行时 profile（包含 apiKey，仅在内存中传递，不落盘 Vault） */
export interface ResolvedRuntimeProfile {
  readonly relayUrl: string;
  readonly model: string;
  readonly apiKey: string;
  /** profile 来源：vault-profile / settings / portable / none */
  readonly origin: "vault-profile" | "settings" | "portable" | "none";
}

/** 测试连接结果 */
export interface RelayConnectionTestResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly detail: string; // 已脱敏
  /** OpenAI-compatible /v1/models 返回的模型 ID。接口不支持时为空。 */
  readonly models: ReadonlyArray<string>;
}

// ---------- 常量 ----------

export const RUNTIME_PROFILE_FILE_REL = ".llm-bridge/runtime-profile.json";
export const RUNTIME_PROFILE_SOURCE = "local-relay";

// ---------- Vault Profile 读写 ----------

/**
 * 读取 Vault 内 .llm-bridge/runtime-profile.json。
 * 不存在或格式错误时返回 null（静默回退到原生认证）。
 * 安全检查：如果 JSON 包含 apiKey 字段，拒绝读取并返回 null。
 */
export async function loadVaultRuntimeProfile(vaultPath: string): Promise<VaultRuntimeProfile | null> {
  const filePath = path.join(vaultPath, RUNTIME_PROFILE_FILE_REL);
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return parseVaultRuntimeProfile(content);
  } catch {
    return null;
  }
}

/**
 * 同步版本（用于 buildRunEnv 等同步路径）。
 */
export function loadVaultRuntimeProfileSync(vaultPath: string): VaultRuntimeProfile | null {
  const filePath = path.join(vaultPath, RUNTIME_PROFILE_FILE_REL);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return parseVaultRuntimeProfile(content);
  } catch {
    return null;
  }
}

/** 解析 vault profile JSON 内容（共享逻辑，含安全检查） */
function parseVaultRuntimeProfile(content: string): VaultRuntimeProfile | null {
  const parsed = JSON.parse(content) as Partial<VaultRuntimeProfile> & { apiKey?: unknown };
  // 安全规则：Vault 内 JSON 严禁包含 apiKey
  if ("apiKey" in parsed && parsed.apiKey !== undefined && parsed.apiKey !== "") {
    return null;
  }
  if (!parsed.relayUrl || typeof parsed.relayUrl !== "string") return null;
  return {
    relayUrl: parsed.relayUrl,
    model: typeof parsed.model === "string" ? parsed.model : "",
    source: typeof parsed.source === "string" ? parsed.source : RUNTIME_PROFILE_SOURCE,
  };
}

/**
 * 写入 Vault 内 .llm-bridge/runtime-profile.json。
 * 强制移除 apiKey 字段（即使调用方误传也不写入）。
 */
export async function saveVaultRuntimeProfile(
  vaultPath: string,
  profile: { relayUrl: string; model: string; source?: string },
): Promise<boolean> {
  const filePath = path.join(vaultPath, RUNTIME_PROFILE_FILE_REL);
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    // 强制不写入 apiKey
    const safe: VaultRuntimeProfile = {
      relayUrl: profile.relayUrl,
      model: profile.model,
      source: profile.source || RUNTIME_PROFILE_SOURCE,
    };
    const content = `${JSON.stringify(safe, null, 2)}\n`;
    await fs.promises.writeFile(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ---------- 便携 Key 读写 ----------

/**
 * 从便携目录读取 API Key。
 * 文件名固定 `runtime-profile.key`，内容为纯文本 key（无 JSON 包装）。
 */
export async function loadPortableApiKey(portableDir: string): Promise<string | null> {
  if (!portableDir) return null;
  const filePath = path.join(portableDir, "runtime-profile.key");
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    const key = content.trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** 同步读取便携 Key，供 CLI/app-server spawn env 使用。 */
export function loadPortableApiKeySync(portableDir: string, vaultPath?: string): string | null {
  if (!portableDir) return null;
  const resolvedDir = resolvePortableDirectory(portableDir, vaultPath);
  try {
    const key = fs.readFileSync(path.join(resolvedDir, "runtime-profile.key"), "utf8").trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * 写入 API Key 到便携目录。
 */
export async function savePortableApiKey(portableDir: string, apiKey: string): Promise<boolean> {
  if (!portableDir) return false;
  const filePath = path.join(portableDir, "runtime-profile.key");
  try {
    await fs.promises.mkdir(portableDir, { recursive: true });
    await fs.promises.writeFile(filePath, apiKey, "utf8");
    return true;
  } catch {
    return false;
  }
}

function resolvePortableDirectory(portableDir: string, vaultPath?: string): string {
  if (path.isAbsolute(portableDir)) return portableDir;
  return path.resolve(vaultPath || process.cwd(), portableDir);
}

// ---------- 核心解析 ----------

/**
 * 解析运行时 profile（provider-neutral 单一入口）。
 *
 * V20.5: Bridge 不再解析 agent 配置文件内容，不再提供 relayUrl/model/apiKey。
 * 各 agent 从自己的原生配置文件（config.toml / settings.local.json / settings.json）读取。
 * Bridge 只负责设置 *_HOME 指向本地配置目录 + 注入密钥环境变量（见 buildRuntimeSpawnEnv）。
 *
 * 此函数保留用于向后兼容，始终返回 origin="none"。
 * 调用方应改用 buildRuntimeSpawnEnv() 获取 spawn env。
 */
export async function resolveRuntimeProfile(
  _vaultPath?: string,
  _settings?: {
    localRelayUrl?: string;
    localRelayModel?: string;
    model?: string;
    localRelayApiKey?: string;
    localRelayPortableKeyPath?: string;
  },
): Promise<ResolvedRuntimeProfile> {
  return { relayUrl: "", model: "", apiKey: "", origin: "none" };
}

/**
 * 同步版本（用于无法 await 的场景）。
 *
 * V20.5: 同上，始终返回 origin="none"。调用方应改用 buildRuntimeSpawnEnv()。
 */
export function resolveRuntimeProfileSync(
  _settings?: {
    localRelayUrl?: string;
    localRelayModel?: string;
    model?: string;
    localRelayApiKey?: string;
    localRelayPortableKeyPath?: string;
  },
  _vaultProfile?: VaultRuntimeProfile | null,
  _vaultPath?: string,
): ResolvedRuntimeProfile {
  return { relayUrl: "", model: "", apiKey: "", origin: "none" };
}

/**
 * V20.5: 为 active provider 构建 spawn env。
 * - 本地配置存在 → 设置 *_HOME 指向本地配置目录
 * - 密钥从 secrets.env 注入（CODEX_RELAY_API_KEY / ANTHROPIC_API_KEY / PI_RELAY_API_KEY）
 * 供各 provider 的 buildSpawnEnv / buildRunEnv 调用。
 */
export function buildRuntimeSpawnEnv(vaultPath: string): Record<string, string> {
  const { buildRuntimeEnv } = require("./config/runtimeRouter") as typeof import("./config/runtimeRouter");
  return buildRuntimeEnv(vaultPath);
}

// ---------- 测试连接 ----------

/**
 * 测试中转站连接（真实 HTTP GET /v1/models）。
 * 验证 relay 可达 + key 有效。错误消息经过脱敏。
 */
export async function testRelayConnection(
  relayUrl: string,
  apiKey: string,
  _model?: string,
): Promise<RelayConnectionTestResult> {
  if (!relayUrl) {
    return { ok: false, status: null, detail: "未配置中转站地址", models: [] };
  }

  const url = relayUrl.replace(/\/+$/, "") + "/v1/models";
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      let models: string[] = [];
      try {
        const payload = await response.json() as { data?: ReadonlyArray<{ id?: unknown; model?: unknown }> };
        models = (Array.isArray(payload.data) ? payload.data : [])
          .map((item) => typeof item?.id === "string" ? item.id : typeof item?.model === "string" ? item.model : "")
          .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index);
      } catch {
        // 可达但响应不是 JSON：连接仍成功，仅无法同步模型目录。
      }
      const detail = models.length > 0 ? `连接成功，发现 ${models.length} 个模型` : "连接成功";
      return { ok: true, status: response.status, detail, models };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, detail: "API Key 无效或权限不足", models: [] };
    }

    if (response.status === 404) {
      // /v1/models 不支持但 relay 可达 — 视为部分可用
      return { ok: true, status: response.status, detail: "中转站可达（/v1/models 不支持，但连接正常）", models: [] };
    }

    return { ok: false, status: response.status, detail: `中转站返回 HTTP ${response.status}`, models: [] };
  } catch (e) {
    return { ok: false, status: null, detail: desensitizeError(e, apiKey), models: [] };
  }
}

/**
 * V20.4: 对指定模型发起一次真实 Responses 请求（POST /v1/responses），
 * 验证模型真正可用（不仅列表存在，而是能完成一次推理）。
 *
 * 用于"验证当前模型"按钮：仅 /v1/models 只能证明模型在列表里，
 * 真实 Responses 请求才能证明 key 有调用权限 + 模型可推理。
 * 产生少量费用（max_output_tokens 极低）。
 */
export async function testModelResponsesRequest(
  relayUrl: string,
  apiKey: string,
  model: string,
): Promise<{ ok: boolean; status: number | null; detail: string }> {
  if (!relayUrl) return { ok: false, status: null, detail: "未配置中转站地址" };
  if (!apiKey) return { ok: false, status: null, detail: "未配置 API Key" };
  if (!model) return { ok: false, status: null, detail: "未选择模型" };

  const url = relayUrl.replace(/\/+$/, "") + "/v1/responses";
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    // 极小负载：1 token 输入 + max_output_tokens=1，费用可忽略
    const body = JSON.stringify({
      model,
      input: "hi",
      max_output_tokens: 1,
      stream: false,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      return { ok: true, status: response.status, detail: `模型 ${model} 验证通过（真实 Responses 请求成功）` };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, detail: "API Key 无效或无该模型调用权限" };
    }
    if (response.status === 404) {
      return { ok: false, status: response.status, detail: `模型 ${model} 不存在或不支持 Responses 接口` };
    }
    if (response.status === 429) {
      return { ok: false, status: response.status, detail: "请求频率超限（Rate limit）；模型可达，稍后重试" };
    }
    // 尝试读取错误体
    let errDetail = "";
    try {
      const errPayload = await response.json() as { error?: { message?: unknown } };
      errDetail = typeof errPayload?.error?.message === "string" ? errPayload.error.message : "";
    } catch { /* non-JSON error body */ }
    const suffix = errDetail ? `：${desensitizeError(errDetail, apiKey)}` : "";
    return { ok: false, status: response.status, detail: `中转站返回 HTTP ${response.status}${suffix}` };
  } catch (e) {
    return { ok: false, status: null, detail: desensitizeError(e, apiKey) };
  }
}

// ---------- 工具函数 ----------

/**
 * 从 URL 提取域名（用于状态栏显示，不暴露 path/query/key）。
 */
export function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    // 非 URL 格式，返回原值截断
    return url.length > 40 ? url.slice(0, 40) + "..." : url;
  }
}

/**
 * 错误脱敏：移除 API Key 片段、Authorization 头等敏感信息。
 * 用于所有可能包含 key 的错误消息。
 */
export function desensitizeError(error: unknown, apiKey: string): string {
  let msg: string;
  if (error instanceof Error) {
    msg = error.message;
  } else if (typeof error === "string") {
    msg = error;
  } else {
    msg = String(error ?? "");
  }

  // 移除 apiKey 片段（完整 key 和尾部片段）
  if (apiKey && apiKey.length > 0) {
    // 移除完整 key
    msg = msg.split(apiKey).join("***");
    // 移除 Bearer header
    msg = msg.replace(/Bearer\s+[^\s,]+/gi, "Bearer ***");
    // 移除可能的 key 片段（最后 8 位以上）
    if (apiKey.length > 8) {
      const tail = apiKey.slice(-8);
      msg = msg.split(tail).join("***");
    }
  }

  // 移除其他常见敏感模式
  msg = msg.replace(/(?:api[_-]?key|authorization|token)["'\s:=]+[^\s,}]+/gi, "$1=***");

  // 网络错误简化
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(msg)) {
    return `网络连接失败：${msg}`;
  }
  if (/abort|timeout/i.test(msg)) {
    return "连接超时（8秒）";
  }

  return msg || "未知错误";
}

/**
 * 格式化状态栏标签。
 * 返回 "本地中转 · 可用" / "本地中转 · 未配置" / "本地中转 · 未配置Key" 等。
 */
export function formatRelayStatusLabel(profile: ResolvedRuntimeProfile): {
  label: string;
  available: boolean;
} {
  if (profile.origin === "none" || !profile.relayUrl) {
    return { label: "本地中转 · 未配置", available: false };
  }
  if (!profile.apiKey) {
    return { label: "本地中转 · 未配置Key", available: false };
  }
  return { label: "本地中转 · 可用", available: true };
}

/**
 * 格式化状态栏详情 tooltip（只显示来源/域名/模型，不显示 Key）。
 */
export function formatRelayStatusDetail(profile: ResolvedRuntimeProfile): string {
  if (profile.origin === "none" || !profile.relayUrl) {
    return "未配置本地中转（使用原生认证）";
  }
  const domain = extractDomain(profile.relayUrl);
  const originLabel = profile.origin === "portable" ? "便携目录" : profile.origin === "vault-profile" ? "Vault Profile" : "本地设置";
  const modelPart = profile.model ? `\n模型：${profile.model}` : "";
  return `来源：${originLabel}\n域名：${domain}${modelPart}`;
}
