// LLM CLI Bridge — Agent Skills Manifest / Materialization (V2.13.0-C)
// Agent Skill 是 runtime capability：Claude 物化到 .claude/skills/<slug>/SKILL.md；
// Codex managed runtime 物化到 Codex home 的 personal skills 目录，不写入 composer。

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash, randomUUID } from "crypto";

export const AGENT_SKILLS_MANIFEST_VERSION = 1;
export const AGENT_SKILLS_FILE_REL = ".llm-bridge/agent-skills.json";
export const CLAUDE_SKILLS_DIR_REL = ".claude/skills";
export const CODEX_BRIDGE_SKILL_PREFIX = "llm-bridge-";
export const AGENT_SKILL_FILE_NAME = "SKILL.md";
export const AGENT_SKILL_GENERATED_BY = "llm-cli-bridge";

export type AgentSkillSource = "manual" | "converted" | "imported";

export interface AgentSkillRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly enabled: boolean;
  readonly source: AgentSkillSource;
  readonly sourcePath?: string;
  /** 包 skill 的源目录（相对 vault 路径，如 LLM-AgentRuntime/skills/vault-context）。
   * 非空时物化会复制目录下所有 .md 文件（除 SKILL.md 主文件外）。 */
  readonly sourceDir?: string;
  /** 包 skill 的组合源内容 hash（含 SKILL.md + 所有子 .md 文件内容拼接）。
   * 用于检测子文件变化；非包 skill 不设置此字段。 */
  readonly sourceContentHash?: string;
  readonly materializedPath: string;
  readonly materializedHash: string;
  readonly updatedAt: string;
}

export interface AgentSkillsManifest {
  readonly version: number;
  readonly skills: AgentSkillRecord[];
}

export interface AgentSkillInput {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly enabled?: boolean;
  readonly source?: AgentSkillSource;
  readonly sourcePath?: string;
  readonly sourceDir?: string;
  readonly sourceContentHash?: string;
  readonly slug?: string;
  readonly id?: string;
}

export type AgentSkillMaterializeStatus = "created" | "updated" | "skipped" | "conflict" | "error";

export interface AgentSkillMaterializeResult {
  readonly ok: boolean;
  readonly status: AgentSkillMaterializeStatus;
  readonly record: AgentSkillRecord;
  readonly filePath: string;
  readonly reason?: string;
}

export interface AgentSkillsRuntimePreparationResult {
  readonly ok: boolean;
  readonly enabledCount: number;
  readonly results: readonly AgentSkillMaterializeResult[];
  readonly manifest: AgentSkillsManifest;
  readonly saved: boolean;
  readonly reason?: string;
}

export function createEmptyAgentSkillsManifest(): AgentSkillsManifest {
  return { version: AGENT_SKILLS_MANIFEST_VERSION, skills: [] };
}

export async function loadAgentSkillsManifest(vaultPath: string): Promise<AgentSkillsManifest> {
  const filePath = path.join(vaultPath, AGENT_SKILLS_FILE_REL);
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<AgentSkillsManifest>;
    if (parsed.version !== AGENT_SKILLS_MANIFEST_VERSION || !Array.isArray(parsed.skills)) {
      return createEmptyAgentSkillsManifest();
    }
    const skills = parsed.skills
      .map(sanitizeAgentSkillRecord)
      .filter((s): s is AgentSkillRecord => s !== null);
    return { version: AGENT_SKILLS_MANIFEST_VERSION, skills };
  } catch {
    return createEmptyAgentSkillsManifest();
  }
}

export async function saveAgentSkillsManifest(vaultPath: string, manifest: AgentSkillsManifest): Promise<boolean> {
  const dirPath = path.join(vaultPath, ".llm-bridge");
  const filePath = path.join(vaultPath, AGENT_SKILLS_FILE_REL);
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    const payload: AgentSkillsManifest = {
      version: AGENT_SKILLS_MANIFEST_VERSION,
      skills: manifest.skills.map(normalizeAgentSkillRecord),
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    try {
      await fs.promises.copyFile(filePath, bakPath);
    } catch {
      // 首次写入没有旧文件，不需要备份。
    }
    await fs.promises.writeFile(tmpPath, content, "utf8");
    await fs.promises.rename(tmpPath, filePath);
    return true;
  } catch {
    try { await fs.promises.unlink(tmpPath); } catch {}
    return false;
  }
}

export function loadAgentSkillsManifestSync(vaultPath: string): AgentSkillsManifest {
  const filePath = path.join(vaultPath, AGENT_SKILLS_FILE_REL);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<AgentSkillsManifest>;
    if (parsed.version !== AGENT_SKILLS_MANIFEST_VERSION || !Array.isArray(parsed.skills)) {
      return createEmptyAgentSkillsManifest();
    }
    const skills = parsed.skills
      .map(sanitizeAgentSkillRecord)
      .filter((s): s is AgentSkillRecord => s !== null);
    return { version: AGENT_SKILLS_MANIFEST_VERSION, skills };
  } catch {
    return createEmptyAgentSkillsManifest();
  }
}

export function saveAgentSkillsManifestSync(vaultPath: string, manifest: AgentSkillsManifest): boolean {
  const dirPath = path.join(vaultPath, ".llm-bridge");
  const filePath = path.join(vaultPath, AGENT_SKILLS_FILE_REL);
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const payload: AgentSkillsManifest = {
      version: AGENT_SKILLS_MANIFEST_VERSION,
      skills: manifest.skills.map(normalizeAgentSkillRecord),
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch {
      // 首次写入没有旧文件，不需要备份。
    }
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    return false;
  }
}

export function createAgentSkillRecord(
  input: AgentSkillInput,
  existingSlugs: readonly string[] = [],
  nowIso: string = new Date().toISOString(),
): AgentSkillRecord {
  const name = input.name.trim();
  const description = input.description.trim();
  const instructions = input.instructions.trim();
  const slug = normalizeSlug(input.slug || slugifyAgentSkillName(name, existingSlugs));
  const id = input.id?.trim() || `as-${sha256(`${name}\n${description}\n${nowIso}\n${randomUUID()}`).slice(0, 16)}`;
  return normalizeAgentSkillRecord({
    id,
    slug,
    name,
    description,
    instructions,
    enabled: input.enabled ?? true,
    source: input.source ?? "manual",
    sourcePath: input.sourcePath,
    ...(input.sourceDir ? { sourceDir: input.sourceDir } : {}),
    ...(input.sourceContentHash ? { sourceContentHash: input.sourceContentHash } : {}),
    materializedPath: materializedSkillPathForSlug(slug),
    materializedHash: "",
    updatedAt: nowIso,
  });
}

export function createAgentSkillFromPromptSnippet(
  snippet: { readonly name: string; readonly description: string; readonly prompt: string },
  existingSlugs: readonly string[] = [],
  nowIso: string = new Date().toISOString(),
): AgentSkillRecord {
  return createAgentSkillRecord({
    name: snippet.name,
    description: snippet.description,
    instructions: snippet.prompt,
    source: "converted",
  }, existingSlugs, nowIso);
}

export function slugifyAgentSkillName(name: string, existingSlugs: readonly string[] = []): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const base = ascii || `skill-${sha256(name).slice(0, 8)}`;
  const used = new Set(existingSlugs.map(normalizeSlug));
  let slug = normalizeSlug(base);
  let i = 2;
  while (used.has(slug)) {
    slug = `${base.slice(0, 56)}-${i}`;
    i++;
  }
  return slug;
}

export function materializedSkillPathForSlug(slug: string): string {
  return path.posix.join(CLAUDE_SKILLS_DIR_REL, normalizeSlug(slug), AGENT_SKILL_FILE_NAME);
}

export function resolveCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), ".codex");
}

export function codexBridgeSkillDirName(slug: string): string {
  return `${CODEX_BRIDGE_SKILL_PREFIX}${normalizeSlug(slug)}`;
}

export function codexBridgeSkillPathForSlug(slug: string, codexHome: string = resolveCodexHome()): string {
  return path.join(codexHome, "skills", codexBridgeSkillDirName(slug), AGENT_SKILL_FILE_NAME);
}

/**
 * 仅当目标目录名严格等于 `llm-bridge-<slug>` 时，允许将旧 source-id 迁移到当前 manifest。
 * 其他插件或手工 Skill（目录名不符）必须继续报冲突、绝不覆盖。
 */
export function isBridgeOwnedSkillDirectory(filePath: string, slug: string): boolean {
  const dirName = path.basename(path.dirname(filePath));
  return dirName === codexBridgeSkillDirName(slug);
}

/**
 * 插件生成 + 目录归属匹配时，允许旧 source-id 迁移（覆盖写入新 marker）。
 */
export function canMigrateBridgeSkillOwnership(
  existingContent: string,
  filePath: string,
  slug: string,
  nextSourceId: string,
): boolean {
  const marker = parseGeneratedMarker(existingContent);
  if (!marker || marker.generatedBy !== AGENT_SKILL_GENERATED_BY) return false;
  if (marker.sourceId === nextSourceId) return false; // 同 ID 走常规更新/跳过，不算迁移
  return isBridgeOwnedSkillDirectory(filePath, slug);
}

export function computeAgentSkillSourceHash(record: Pick<AgentSkillRecord, "name" | "description" | "instructions">): string {
  return sha256(JSON.stringify({
    name: record.name,
    description: record.description,
    instructions: record.instructions,
  }));
}

export function serializeAgentSkillToMarkdown(record: AgentSkillRecord): string {
  const sourceHash = computeAgentSkillSourceHash(record);
  return [
    "---",
    `name: ${quoteYaml(record.name)}`,
    `description: ${quoteYaml(record.description)}`,
    "---",
    "",
    `<!-- generated-by: ${AGENT_SKILL_GENERATED_BY} -->`,
    `<!-- source-id: ${record.id} -->`,
    `<!-- source-hash: ${sourceHash} -->`,
    "",
    "# Instructions",
    "",
    record.instructions.trim(),
    "",
  ].join("\n");
}

/**
 * u5: 统一物化核心函数 — 将单个 AgentSkillRecord 物化到任意目标文件路径。
 *
 * 所有 target（claude/.agents/.pi/codex）都通过此函数物化，使用统一的 Agent Skill 格式
 * （source-id marker），消除旧的 runtime 格式（source-slug marker）。
 *
 * - 支持可选 name/description override（Codex 需要 "llm-bridge-" 前缀）
 * - 支持可选 expectedHash 检测外部修改（仅 claude target 从 manifest 传入）
 * - 自动升级旧 runtime 格式文件（source-slug marker → source-id marker）
 */
export interface AgentSkillTargetOptions {
  readonly nameOverride?: string;
  readonly descriptionOverride?: string;
  readonly expectedHash?: string;
  /** 源目录绝对路径（包 skill 物化时读取附属 .md 文件的来源） */
  readonly sourceDir?: string;
}

export function materializeAgentSkillToTarget(
  record: AgentSkillRecord,
  filePath: string,
  options: AgentSkillTargetOptions = {},
): AgentSkillMaterializeResult {
  const normalized = normalizeAgentSkillRecord(record);
  const projected: AgentSkillRecord = (options.nameOverride || options.descriptionOverride)
    ? normalizeAgentSkillRecord({
        ...normalized,
        name: options.nameOverride ?? normalized.name,
        description: options.descriptionOverride ?? normalized.description,
      })
    : normalized;
  const nextContent = serializeAgentSkillToMarkdown(projected);
  const nextHash = sha256(nextContent);
  const nextRecord = normalizeAgentSkillRecord({ ...normalized, materializedHash: nextHash });

  try {
    let existing: string | null = null;
    try {
      existing = fs.readFileSync(filePath, "utf8");
    } catch {
      existing = null;
    }

    let skipped = false;
    if (existing !== null) {
      const marker = parseGeneratedMarker(existing);
      if (marker && marker.generatedBy === AGENT_SKILL_GENERATED_BY) {
        // Agent Skill 格式（source-id marker）
        if (marker.sourceId !== normalized.id) {
          // P0: 仅 llm-bridge-<slug> 目录允许旧 source-id → 当前 manifest 迁移
          if (!isBridgeOwnedSkillDirectory(filePath, normalized.slug)) {
            return conflict(nextRecord, filePath, "target SKILL.md belongs to another Agent Skill record");
          }
          // fall through → 覆盖写入（ownership migration）
        } else if (options.expectedHash && sha256(existing) !== options.expectedHash) {
          return conflict(nextRecord, filePath, "target SKILL.md changed after last materialization");
        }
        if (marker.sourceId === normalized.id && existing === nextContent) {
          skipped = true;
        }
        // 内容不同或 ID 迁移 → 更新（fall through 到写入）
      } else if (isLegacyPluginGeneratedSkill(existing)) {
        // 旧 runtime 格式（source-slug marker）→ 自动升级为 Agent Skill 格式（fall through 到写入）
      } else {
        return conflict(nextRecord, filePath, "target SKILL.md is not plugin-generated");
      }
    }

    if (!skipped) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, nextContent, "utf8");
    }

    // 包 skill：复制附属 .md 文件（SKILL.md 以外的源目录 .md 文件）
    if (options.sourceDir) {
      try {
        const sourceFiles = fs.readdirSync(options.sourceDir)
          .filter((f): f is string => typeof f === "string" && f.endsWith(".md") && f !== AGENT_SKILL_FILE_NAME);
        const targetDir = path.dirname(filePath);
        for (const f of sourceFiles) {
          const src = path.join(options.sourceDir, f);
          const dst = path.join(targetDir, f);
          const content = fs.readFileSync(src, "utf8");
          fs.writeFileSync(dst, content, "utf8");
        }
      } catch { /* 附属文件复制失败不阻塞主文件物化 */ }
    }

    if (skipped) {
      return { ok: true, status: "skipped", record: nextRecord, filePath };
    }
    return { ok: true, status: existing === null ? "created" : "updated", record: nextRecord, filePath };
  } catch (e) {
    return { ok: false, status: "error", record: nextRecord, filePath, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 检测旧 runtime 格式文件（source-slug marker，无 source-id）。
 * 用于自动升级为 Agent Skill 格式，而非报 conflict。
 */
function isLegacyPluginGeneratedSkill(content: string): boolean {
  return content.includes(`<!-- generated-by: ${AGENT_SKILL_GENERATED_BY} -->`)
    && content.includes("<!-- source-slug:")
    && !content.includes("<!-- source-id:");
}

export async function materializeAgentSkill(vaultPath: string, record: AgentSkillRecord): Promise<AgentSkillMaterializeResult> {
  return materializeAgentSkillSync(vaultPath, record);
}

export function materializeAgentSkillSync(vaultPath: string, record: AgentSkillRecord): AgentSkillMaterializeResult {
  const normalized = normalizeAgentSkillRecord(record);
  const filePath = path.join(vaultPath, normalized.materializedPath);
  const sourceDir = normalized.sourceDir ? path.join(vaultPath, normalized.sourceDir) : undefined;
  return materializeAgentSkillToTarget(normalized, filePath, { expectedHash: normalized.materializedHash, sourceDir });
}

export function materializeAgentSkillToCodexHomeSync(
  record: AgentSkillRecord,
  codexHome: string = resolveCodexHome(),
  vaultPath?: string,
): AgentSkillMaterializeResult {
  const normalized = normalizeAgentSkillRecord(record);
  const filePath = codexBridgeSkillPathForSlug(normalized.slug, codexHome);
  const sourceDir = (normalized.sourceDir && vaultPath) ? path.join(vaultPath, normalized.sourceDir) : undefined;
  return materializeAgentSkillToTarget(normalized, filePath, {
    nameOverride: `${CODEX_BRIDGE_SKILL_PREFIX}${normalized.name}`,
    descriptionOverride: `${normalized.description} (Bridge plugin Skill)`,
    sourceDir,
  });
}

export async function materializeEnabledAgentSkills(
  vaultPath: string,
  manifest: AgentSkillsManifest,
): Promise<{ readonly manifest: AgentSkillsManifest; readonly results: AgentSkillMaterializeResult[] }> {
  const results: AgentSkillMaterializeResult[] = [];
  const nextRecords: AgentSkillRecord[] = [];
  for (const record of manifest.skills) {
    if (!record.enabled) {
      nextRecords.push(record);
      continue;
    }
    const result = await materializeAgentSkill(vaultPath, record);
    results.push(result);
    nextRecords.push(result.ok ? result.record : record);
  }
  return {
    manifest: { version: AGENT_SKILLS_MANIFEST_VERSION, skills: nextRecords },
    results,
  };
}

export function materializeEnabledAgentSkillsSync(
  vaultPath: string,
  manifest: AgentSkillsManifest,
): { readonly manifest: AgentSkillsManifest; readonly results: AgentSkillMaterializeResult[] } {
  const results: AgentSkillMaterializeResult[] = [];
  const nextRecords: AgentSkillRecord[] = [];
  for (const record of manifest.skills) {
    if (!record.enabled) {
      nextRecords.push(record);
      continue;
    }
    const result = materializeAgentSkillSync(vaultPath, record);
    results.push(result);
    nextRecords.push(result.ok ? result.record : record);
  }
  return {
    manifest: { version: AGENT_SKILLS_MANIFEST_VERSION, skills: nextRecords },
    results,
  };
}

export function prepareAgentSkillsForClaudeRuntimeSync(vaultPath: string): AgentSkillsRuntimePreparationResult {
  const manifest = loadAgentSkillsManifestSync(vaultPath);
  const enabledCount = manifest.skills.filter((record) => record.enabled).length;
  if (enabledCount === 0) {
    return { ok: true, enabledCount, results: [], manifest, saved: false };
  }

  const materialized = materializeEnabledAgentSkillsSync(vaultPath, manifest);
  const failed = materialized.results.filter((result) => !result.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      enabledCount,
      results: materialized.results,
      manifest,
      saved: false,
      reason: failed.map((result) => `${result.record.slug}: ${result.reason || result.status}`).join("; "),
    };
  }

  const changed = materialized.manifest.skills.some((record, index) => {
    const prev = manifest.skills[index];
    return !prev || record.materializedHash !== prev.materializedHash;
  });
  const saved = changed ? saveAgentSkillsManifestSync(vaultPath, materialized.manifest) : false;
  if (changed && !saved) {
    return {
      ok: false,
      enabledCount,
      results: materialized.results,
      manifest: materialized.manifest,
      saved,
      reason: "failed to persist updated Agent Skills manifest",
    };
  }

  return { ok: true, enabledCount, results: materialized.results, manifest: materialized.manifest, saved };
}

export function prepareAgentSkillsForCodexRuntimeSync(
  vaultPath: string,
  codexHome: string = resolveCodexHome(),
): AgentSkillsRuntimePreparationResult {
  const manifest = loadAgentSkillsManifestSync(vaultPath);
  const enabledCount = manifest.skills.filter((record) => record.enabled).length;
  if (enabledCount === 0) {
    return { ok: true, enabledCount, results: [], manifest, saved: false };
  }

  const results = manifest.skills
    .filter((record) => record.enabled)
    .map((record) => materializeAgentSkillToCodexHomeSync(record, codexHome));
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      enabledCount,
      results,
      manifest,
      saved: false,
      reason: failed.map((result) => `${result.record.slug}: ${result.reason || result.status}`).join("; "),
    };
  }

  return { ok: true, enabledCount, results, manifest, saved: false };
}

/**
 * 异步版本 — 用 fs.promises 替代同步 fs，避免阻塞 Obsidian 主线程。
 *
 * 同步版本（prepareAgentSkillsForCodexRuntimeSync）会对每个 enabled skill
 * 执行多次 readFileSync/mkdirSync/writeFileSync/readdirSync，
 * 7 个 skill × 多次同步 I/O 在 Windows（尤其杀毒扫描时）足以冻结主线程，
 * 导致"整个 Obsidian 卡死、Notice 弹窗不消失"。
 * 此版本将所有 I/O 移到 fs.promises，让事件循环保持响应。
 */
export async function prepareAgentSkillsForCodexRuntime(
  vaultPath: string,
  codexHome: string = resolveCodexHome(),
): Promise<AgentSkillsRuntimePreparationResult> {
  const manifest = await loadAgentSkillsManifest(vaultPath);
  const enabledCount = manifest.skills.filter((record) => record.enabled).length;
  if (enabledCount === 0) {
    return { ok: true, enabledCount, results: [], manifest, saved: false };
  }

  const results: AgentSkillMaterializeResult[] = [];
  for (const record of manifest.skills) {
    if (!record.enabled) continue;
    const result = await materializeAgentSkillToCodexHomeAsync(record, codexHome, vaultPath);
    results.push(result);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      enabledCount,
      results,
      manifest,
      saved: false,
      reason: failed.map((result) => `${result.record.slug}: ${result.reason || result.status}`).join("; "),
    };
  }

  return { ok: true, enabledCount, results, manifest, saved: false };
}

/**
 * 异步版本 — 将单个 AgentSkillRecord 物化到 Codex home 的 personal skills 目录。
 * 使用 fs.promises 替代同步 fs。
 */
export async function materializeAgentSkillToCodexHomeAsync(
  record: AgentSkillRecord,
  codexHome: string = resolveCodexHome(),
  vaultPath?: string,
): Promise<AgentSkillMaterializeResult> {
  const normalized = normalizeAgentSkillRecord(record);
  const filePath = codexBridgeSkillPathForSlug(normalized.slug, codexHome);
  const sourceDir = (normalized.sourceDir && vaultPath) ? path.join(vaultPath, normalized.sourceDir) : undefined;
  return materializeAgentSkillToTargetAsync(normalized, filePath, {
    nameOverride: `${CODEX_BRIDGE_SKILL_PREFIX}${normalized.name}`,
    descriptionOverride: `${normalized.description} (Bridge plugin Skill)`,
    sourceDir,
  });
}

/**
 * 异步版本 — 用 fs.promises 替代同步 fs，避免阻塞主线程。
 * 逻辑与 materializeAgentSkillToTarget 完全一致，仅 I/O 改为异步。
 */
export async function materializeAgentSkillToTargetAsync(
  record: AgentSkillRecord,
  filePath: string,
  options: AgentSkillTargetOptions = {},
): Promise<AgentSkillMaterializeResult> {
  const normalized = normalizeAgentSkillRecord(record);
  const projected: AgentSkillRecord = (options.nameOverride || options.descriptionOverride)
    ? normalizeAgentSkillRecord({
        ...normalized,
        name: options.nameOverride ?? normalized.name,
        description: options.descriptionOverride ?? normalized.description,
      })
    : normalized;
  const nextContent = serializeAgentSkillToMarkdown(projected);
  const nextHash = sha256(nextContent);
  const nextRecord = normalizeAgentSkillRecord({ ...normalized, materializedHash: nextHash });

  try {
    let existing: string | null = null;
    try {
      existing = await fs.promises.readFile(filePath, "utf8");
    } catch {
      existing = null;
    }

    let skipped = false;
    if (existing !== null) {
      const marker = parseGeneratedMarker(existing);
      if (marker && marker.generatedBy === AGENT_SKILL_GENERATED_BY) {
        if (marker.sourceId !== normalized.id) {
          if (!isBridgeOwnedSkillDirectory(filePath, normalized.slug)) {
            return conflict(nextRecord, filePath, "target SKILL.md belongs to another Agent Skill record");
          }
        } else if (options.expectedHash && sha256(existing) !== options.expectedHash) {
          return conflict(nextRecord, filePath, "target SKILL.md changed after last materialization");
        }
        if (marker.sourceId === normalized.id && existing === nextContent) {
          skipped = true;
        }
      } else if (isLegacyPluginGeneratedSkill(existing)) {
        // 旧 runtime 格式 → 自动升级（fall through 到写入）
      } else {
        return conflict(nextRecord, filePath, "target SKILL.md is not plugin-generated");
      }
    }

    if (!skipped) {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, nextContent, "utf8");
    }

    if (options.sourceDir) {
      try {
        const entries = await fs.promises.readdir(options.sourceDir);
        const mdFiles = entries.filter((f): f is string => typeof f === "string" && f.endsWith(".md") && f !== AGENT_SKILL_FILE_NAME);
        const targetDir = path.dirname(filePath);
        for (const f of mdFiles) {
          const src = path.join(options.sourceDir, f);
          const dst = path.join(targetDir, f);
          const content = await fs.promises.readFile(src, "utf8");
          await fs.promises.writeFile(dst, content, "utf8");
        }
      } catch { /* 附属文件复制失败不阻塞主文件物化 */ }
    }

    if (skipped) {
      return { ok: true, status: "skipped", record: nextRecord, filePath };
    }
    return { ok: true, status: existing === null ? "created" : "updated", record: nextRecord, filePath };
  } catch (e) {
    return { ok: false, status: "error", record: nextRecord, filePath, reason: e instanceof Error ? e.message : String(e) };
  }
}

function sanitizeAgentSkillRecord(raw: unknown): AgentSkillRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AgentSkillRecord>;
  if (typeof r.id !== "string" || typeof r.slug !== "string" || typeof r.name !== "string") return null;
  if (typeof r.description !== "string" || typeof r.instructions !== "string") return null;
  if (typeof r.enabled !== "boolean" || !isAgentSkillSource(r.source)) return null;
  if (typeof r.materializedPath !== "string" || typeof r.materializedHash !== "string" || typeof r.updatedAt !== "string") return null;
  if (r.sourcePath !== undefined && typeof r.sourcePath !== "string") return null;
  if (r.sourceDir !== undefined && typeof r.sourceDir !== "string") return null;
  if (r.sourceContentHash !== undefined && typeof r.sourceContentHash !== "string") return null;
  return normalizeAgentSkillRecord(r as AgentSkillRecord);
}

function normalizeAgentSkillRecord(record: AgentSkillRecord): AgentSkillRecord {
  const slug = normalizeSlug(record.slug);
  return {
    id: record.id.trim(),
    slug,
    name: record.name.trim(),
    description: record.description.trim(),
    instructions: record.instructions.trim(),
    enabled: !!record.enabled,
    source: isAgentSkillSource(record.source) ? record.source : "manual",
    ...(record.sourcePath ? { sourcePath: record.sourcePath } : {}),
    ...(record.sourceDir ? { sourceDir: record.sourceDir } : {}),
    ...(record.sourceContentHash ? { sourceContentHash: record.sourceContentHash } : {}),
    materializedPath: materializedSkillPathForSlug(slug),
    materializedHash: record.materializedHash || "",
    updatedAt: record.updatedAt,
  };
}

function normalizeSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "skill";
}

function parseGeneratedMarker(content: string): { generatedBy: string; sourceId: string; sourceHash: string } | null {
  const generatedBy = content.match(/<!--\s*generated-by:\s*([^>]+?)\s*-->/)?.[1]?.trim();
  const sourceId = content.match(/<!--\s*source-id:\s*([^>]+?)\s*-->/)?.[1]?.trim();
  const sourceHash = content.match(/<!--\s*source-hash:\s*([^>]+?)\s*-->/)?.[1]?.trim();
  if (!generatedBy || !sourceId || !sourceHash) return null;
  return { generatedBy, sourceId, sourceHash };
}

function conflict(record: AgentSkillRecord, filePath: string, reason: string): AgentSkillMaterializeResult {
  return { ok: false, status: "conflict", record, filePath, reason };
}

function isAgentSkillSource(source: unknown): source is AgentSkillSource {
  return source === "manual" || source === "converted" || source === "imported";
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
