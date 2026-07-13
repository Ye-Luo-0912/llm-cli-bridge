// Managed Codex app-server 模型目录探测。
// 目录只缓存在当前插件进程中；模型选择仍以 settings.model 为单一真相源。
// V20: 解析 model/list 返回的完整能力字段（efforts/modalities/personality 等）。

import type { ModelCatalogEntry } from "../../../runtimeModelCatalog";
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

interface CodexModelListItem {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly displayName?: unknown;
  readonly name?: unknown;
  readonly isDefault?: unknown;
  readonly supportedReasoningEfforts?: unknown;
  readonly defaultReasoningEffort?: unknown;
  readonly inputModalities?: unknown;
  readonly supportsPersonality?: unknown;
  readonly provider?: unknown;
}

const cache = new Map<string, Promise<CodexRuntimeModelCatalogResult | null>>();

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

function parseModelList(payload: unknown): CodexRuntimeModelCatalogResult | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const seen = new Set<string>();
  const parsed = (data as CodexModelListItem[])
    .map((item) => {
      const value = typeof item.model === "string" ? item.model : typeof item.id === "string" ? item.id : "";
      const label = typeof item.displayName === "string"
        ? item.displayName
        : typeof item.name === "string" ? item.name : value;
      const supportedReasoningEfforts = asStringArray(item.supportedReasoningEfforts);
      const inputModalities = asStringArray(item.inputModalities);
      return {
        value,
        label,
        isDefault: item.isDefault === true,
        supportedReasoningEfforts,
        defaultReasoningEffort: typeof item.defaultReasoningEffort === "string" ? item.defaultReasoningEffort : undefined,
        inputModalities,
        supportsPersonality: typeof item.supportsPersonality === "boolean" ? item.supportsPersonality : undefined,
        provider: typeof item.provider === "string" ? item.provider : undefined,
      };
    })
    .filter((item) => item.value.length > 0 && !seen.has(item.value) && !!seen.add(item.value));
  if (parsed.length === 0) return null;
  const defaultModel = parsed.find((item) => item.isDefault)?.value || parsed[0].value;
  parsed.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  // 构建 ModelCatalogEntry 列表（保留能力字段）
  const models: ModelCatalogEntry[] = parsed.map(({ value, label, supportedReasoningEfforts, defaultReasoningEffort, inputModalities, supportsPersonality, isDefault, provider }) => ({
    value, label, supportedReasoningEfforts, defaultReasoningEffort, inputModalities, supportsPersonality, isDefault, provider,
  }));

  return { models, defaultModel };
}

async function probe(
  pluginDir: string,
  vaultPath: string,
): Promise<CodexRuntimeModelCatalogResult | null> {
  const runtime = resolveManagedRuntime(resolveManifestPath(pluginDir), process.platform, process.arch, { scheduleVerify: false });
  if (!runtime.available || !runtime.runtimePath) return null;

  // 与真实 Codex run 共用同一 CODEX_HOME 和密钥；配置内容由 Codex 自己解析。
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
    // V20.3: 分阶段超时 — initialize / model/list 各自独立超时
    await withTimeout(client.send("initialize", {
      clientInfo: { name: "llm-cli-bridge-model-catalog", title: "LLM CLI Bridge", version: "1" },
      capabilities: { experimentalApi: false },
      cwd: vaultPath,
    }), CODEX_APP_SERVER_STAGE_TIMEOUTS.initialize, "initialize");
    client.notify("initialized", {});
    const result = await withTimeout(
      client.send("model/list", {}),
      CODEX_APP_SERVER_STAGE_TIMEOUTS.modelList,
      "model/list",
    );
    return parseModelList(result);
  } catch {
    return null;
  } finally {
    client.close();
    processManager.kill();
  }
}

/** 后台读取一次真实 runtime 目录；同一 runtime/relay 组合复用进程内结果。 */
export function loadCodexManagedModelCatalog(
  pluginDir: string,
  vaultPath: string,
): Promise<CodexRuntimeModelCatalogResult | null> {
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
  const key = [pluginDir, vaultPath, codexHome, configFingerprint, authFingerprint].join("|");
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = probe(pluginDir, vaultPath);
  cache.set(key, pending);
  void pending.then((result) => {
    if (!result) cache.delete(key);
  });
  return pending;
}

/**
 * V20.2: 清除模型目录缓存，用于中转站新增/删除模型后强制重新读取。
 */
export function clearCodexManagedModelCatalogCache(): void {
  cache.clear();
}
