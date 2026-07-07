import { execFileSync } from "child_process";
import { resolveManifestPath, resolveManagedRuntime } from "./codexManagedRuntimeResolver";

export interface CodexManagedPluginEntry {
  readonly pluginId: string;
  readonly name: string;
  readonly marketplaceName: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly authPolicy: string;
  readonly sourceLabel: string;
}

export interface CodexManagedPluginCatalog {
  readonly available: boolean;
  readonly runtimePath: string | null;
  readonly entries: ReadonlyArray<CodexManagedPluginEntry>;
  readonly error: string | null;
}

type RawPluginEntry = {
  pluginId?: unknown;
  name?: unknown;
  marketplaceName?: unknown;
  version?: unknown;
  enabled?: unknown;
  authPolicy?: unknown;
  source?: { source?: unknown; path?: unknown } | null;
};

type RawPluginListResult = {
  installed?: unknown;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizePluginEntry(raw: RawPluginEntry): CodexManagedPluginEntry | null {
  const pluginId = asString(raw.pluginId).trim();
  const name = asString(raw.name).trim();
  if (!pluginId || !name) return null;
  const marketplaceName = asString(raw.marketplaceName, "unknown").trim() || "unknown";
  const version = asString(raw.version, "unknown").trim() || "unknown";
  const sourceKind = asString(raw.source?.source, "local").trim() || "local";
  const sourcePath = asString(raw.source?.path).trim();
  return {
    pluginId,
    name,
    marketplaceName,
    version,
    enabled: raw.enabled !== false,
    authPolicy: asString(raw.authPolicy, "unknown").trim() || "unknown",
    sourceLabel: sourcePath ? `${sourceKind} · ${sourcePath}` : sourceKind,
  };
}

export function listManagedCodexPlugins(pluginDir: string): CodexManagedPluginCatalog {
  const manifestPath = resolveManifestPath(pluginDir);
  const resolver = resolveManagedRuntime(manifestPath);
  if (!resolver.available || !resolver.runtimePath) {
    return {
      available: false,
      runtimePath: resolver.runtimePath,
      entries: [],
      error: resolver.error || `managed runtime unavailable: ${resolver.reason}`,
    };
  }

  try {
    const raw = execFileSync(resolver.runtimePath, ["plugin", "list", "--json"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    const parsed = JSON.parse(raw) as RawPluginListResult;
    const entries = Array.isArray(parsed.installed)
      ? parsed.installed
        .map((item) => normalizePluginEntry((item || {}) as RawPluginEntry))
        .filter((item): item is CodexManagedPluginEntry => !!item)
        .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    return {
      available: true,
      runtimePath: resolver.runtimePath,
      entries,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      runtimePath: resolver.runtimePath,
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
