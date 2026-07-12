// LLM CLI Bridge — V20.5 Active Provider Router
//
// active.json 只保存路由信息（schemaVersion + activeProvider），不保存地址、模型和 Key。
// Bridge 启动时根据 activeProvider 选择对应的原生配置目录和 env 注入。

import * as fs from "fs";
import * as path from "path";
import { AGENT_RUNTIME_ACTIVE_PROVIDER_REL } from "../../agentRuntimeWorkspace";

export type RuntimeProviderId = "codex" | "claude" | "pi";

export const ACTIVE_PROVIDER_SCHEMA_VERSION = 1;

export interface ActiveProviderConfig {
  readonly schemaVersion: number;
  readonly activeProvider: RuntimeProviderId;
}

const VALID_PROVIDERS: ReadonlySet<string> = new Set(["codex", "claude", "pi"]);

/** 读取 active.json，不存在时返回 null */
export function loadActiveProvider(vaultPath: string): ActiveProviderConfig | null {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_ACTIVE_PROVIDER_REL);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<ActiveProviderConfig>;
    if (parsed.schemaVersion !== ACTIVE_PROVIDER_SCHEMA_VERSION) return null;
    if (!parsed.activeProvider || !VALID_PROVIDERS.has(parsed.activeProvider)) return null;
    return { schemaVersion: parsed.schemaVersion, activeProvider: parsed.activeProvider as RuntimeProviderId };
  } catch {
    return null;
  }
}

/** 写入 active.json（原子写：tmp + rename） */
export function saveActiveProvider(vaultPath: string, provider: RuntimeProviderId): void {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_ACTIVE_PROVIDER_REL);
  const config: ActiveProviderConfig = {
    schemaVersion: ACTIVE_PROVIDER_SCHEMA_VERSION,
    activeProvider: provider,
  };
  const content = JSON.stringify(config, null, 2) + "\n";
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

/** 获取当前 active provider，不存在时默认 "codex" */
export function getActiveProvider(vaultPath: string): RuntimeProviderId {
  const config = loadActiveProvider(vaultPath);
  return config?.activeProvider ?? "codex";
}
