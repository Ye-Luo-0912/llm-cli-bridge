import { execFileSync, execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { resolveManifestPath, resolveManagedRuntime } from "./codexManagedRuntimeResolver";

export interface CodexManagedPluginSkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
}

export interface CodexManagedPluginEntry {
  readonly pluginId: string;
  readonly name: string;
  readonly marketplaceName: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly authPolicy: string;
  readonly sourceLabel: string;
  readonly sourcePath: string | null;
  readonly skills: ReadonlyArray<CodexManagedPluginSkillEntry>;
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
  const skills = listPluginSkills(sourcePath, pluginId);
  return {
    pluginId,
    name,
    marketplaceName,
    version,
    enabled: raw.enabled !== false,
    authPolicy: asString(raw.authPolicy, "unknown").trim() || "unknown",
    sourceLabel: sourcePath ? `${sourceKind} · ${sourcePath}` : sourceKind,
    sourcePath: sourcePath || null,
    skills,
  };
}

export function listPluginSkills(pluginPath: string, pluginId = "plugin"): ReadonlyArray<CodexManagedPluginSkillEntry> {
  if (!pluginPath) return [];
  const skillsRoot = join(pluginPath, "skills");
  try {
    if (!existsSync(skillsRoot) || !statSync(skillsRoot).isDirectory()) return [];
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillPath = join(skillsRoot, entry.name, "SKILL.md");
        if (!existsSync(skillPath)) return null;
        const raw = readFileSync(skillPath, "utf8");
        return normalizePluginSkillEntry(raw, skillPath, pluginId, entry.name);
      })
      .filter((entry): entry is CodexManagedPluginSkillEntry => !!entry)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function normalizePluginSkillEntry(raw: string, skillPath: string, pluginId: string, fallbackName: string): CodexManagedPluginSkillEntry {
  const frontmatter = parseSkillFrontmatter(raw);
  const name = cleanSkillScalar(frontmatter.name) || fallbackName;
  const description = cleanSkillScalar(frontmatter.description) || firstNonEmptyMarkdownLine(raw) || "No description";
  return {
    id: `${pluginId}:${fallbackName}`,
    name,
    description,
    skillPath,
  };
}

function parseSkillFrontmatter(raw: string): Record<string, string> {
  const normalized = raw.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) return {};
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = normalized.slice(3, end).split(/\r?\n/);
  const values: Record<string, string> = {};
  for (const line of block) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2];
  }
  return values;
}

function cleanSkillScalar(value: string | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ").trim();
}

function firstNonEmptyMarkdownLine(raw: string): string {
  const withoutFrontmatter = raw.replace(/^\uFEFF?---[\s\S]*?\r?\n---\r?\n?/, "");
  for (const line of withoutFrontmatter.split(/\r?\n/)) {
    const text = line.replace(/^#+\s*/, "").trim();
    if (text && !text.startsWith("```")) return text;
  }
  return "";
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

const execFileAsync = promisify(execFile);

/**
 * 异步版本 — 用 execFile（非阻塞）替代 execFileSync，避免冻结 Obsidian 主线程。
 * execFileSync 会在子进程启动期间同步阻塞渲染线程长达 15 秒（timeout），
 * 导致"整个 Obsidian 卡死"。此版本将子进程等待移出主线程。
 */
export async function listManagedCodexPluginsAsync(pluginDir: string): Promise<CodexManagedPluginCatalog> {
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
    const { stdout: raw } = await execFileAsync(resolver.runtimePath, ["plugin", "list", "--json"], {
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
