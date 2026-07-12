// Managed Codex app-server 模型目录探测。
// 目录只缓存在当前插件进程中；模型选择仍以 settings.model 为单一真相源。

import type { LLMBridgeSettings } from "../../../types";
import type { ModelCatalogEntry } from "../../../runtimeModelCatalog";
import { createHash } from "crypto";
import { AppServerProcessManager } from "../codex-app-server/appServerProcessManager";
import { JsonRpcClient } from "../codex-app-server/jsonRpcClient";
import { loadVaultRuntimeProfileSync, resolveRuntimeProfileSync } from "../../runtimeProfileResolver";
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
}

const cache = new Map<string, Promise<CodexRuntimeModelCatalogResult | null>>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`model catalog timeout (${timeoutMs}ms)`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
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
      return { value, label, isDefault: item.isDefault === true };
    })
    .filter((item) => item.value.length > 0 && !seen.has(item.value) && !!seen.add(item.value));
  if (parsed.length === 0) return null;
  const defaultModel = parsed.find((item) => item.isDefault)?.value || parsed[0].value;
  parsed.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return {
    models: parsed.map(({ value, label }) => ({ value, label })),
    defaultModel,
  };
}

async function probe(
  pluginDir: string,
  vaultPath: string,
  settings: LLMBridgeSettings,
): Promise<CodexRuntimeModelCatalogResult | null> {
  const runtime = resolveManagedRuntime(resolveManifestPath(pluginDir), process.platform, process.arch, { scheduleVerify: false });
  if (!runtime.available || !runtime.runtimePath) return null;

  const env: NodeJS.ProcessEnv = { ...process.env };
  const relayProfile = resolveRuntimeProfileSync(settings, loadVaultRuntimeProfileSync(vaultPath), vaultPath);
  if (relayProfile.relayUrl) {
    env.OPENAI_BASE_URL = relayProfile.relayUrl;
    if (relayProfile.apiKey) env.OPENAI_API_KEY = relayProfile.apiKey;
  }

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
    }), 10_000);
    client.notify("initialized", {});
    const result = await withTimeout(client.send("model/list", {}), 10_000);
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
  settings: LLMBridgeSettings,
): Promise<CodexRuntimeModelCatalogResult | null> {
  const vaultProfile = loadVaultRuntimeProfileSync(vaultPath);
  const resolvedProfile = resolveRuntimeProfileSync(settings, vaultProfile, vaultPath);
  const profileUrl = resolvedProfile.relayUrl || "native";
  const authFingerprint = resolvedProfile.apiKey
    ? createHash("sha256").update(resolvedProfile.apiKey).digest("hex").slice(0, 12)
    : "no-key";
  const key = [pluginDir, vaultPath, profileUrl, authFingerprint].join("|");
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = probe(pluginDir, vaultPath, settings);
  cache.set(key, pending);
  void pending.then((result) => {
    if (!result) cache.delete(key);
  });
  return pending;
}
