// LLM CLI Bridge — Agent Skills Manifest / Materialization (V2.13.0-C)
// Agent Skill 是 runtime capability：物化到 .claude/skills/<slug>/SKILL.md，不写入 composer。

import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";

export const AGENT_SKILLS_MANIFEST_VERSION = 1;
export const AGENT_SKILLS_FILE_REL = ".llm-bridge/agent-skills.json";
export const CLAUDE_SKILLS_DIR_REL = ".claude/skills";
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

export async function materializeAgentSkill(vaultPath: string, record: AgentSkillRecord): Promise<AgentSkillMaterializeResult> {
  const normalized = normalizeAgentSkillRecord(record);
  const filePath = path.join(vaultPath, normalized.materializedPath);
  const nextContent = serializeAgentSkillToMarkdown(normalized);
  const nextHash = sha256(nextContent);
  const nextRecord = normalizeAgentSkillRecord({ ...normalized, materializedHash: nextHash });

  try {
    let existing: string | null = null;
    try {
      existing = await fs.promises.readFile(filePath, "utf8");
    } catch {
      existing = null;
    }

    if (existing !== null) {
      const marker = parseGeneratedMarker(existing);
      if (!marker || marker.generatedBy !== AGENT_SKILL_GENERATED_BY) {
        return conflict(nextRecord, filePath, "target SKILL.md is not plugin-generated");
      }
      if (marker.sourceId !== normalized.id) {
        return conflict(nextRecord, filePath, "target SKILL.md belongs to another Agent Skill record");
      }
      if (normalized.materializedHash && sha256(existing) !== normalized.materializedHash) {
        return conflict(nextRecord, filePath, "target SKILL.md changed after last materialization");
      }
      if (existing === nextContent) {
        return { ok: true, status: "skipped", record: nextRecord, filePath };
      }
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, nextContent, "utf8");
    return { ok: true, status: existing === null ? "created" : "updated", record: nextRecord, filePath };
  } catch (e) {
    return { ok: false, status: "error", record: nextRecord, filePath, reason: e instanceof Error ? e.message : String(e) };
  }
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

function sanitizeAgentSkillRecord(raw: unknown): AgentSkillRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AgentSkillRecord>;
  if (typeof r.id !== "string" || typeof r.slug !== "string" || typeof r.name !== "string") return null;
  if (typeof r.description !== "string" || typeof r.instructions !== "string") return null;
  if (typeof r.enabled !== "boolean" || !isAgentSkillSource(r.source)) return null;
  if (typeof r.materializedPath !== "string" || typeof r.materializedHash !== "string" || typeof r.updatedAt !== "string") return null;
  if (r.sourcePath !== undefined && typeof r.sourcePath !== "string") return null;
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
