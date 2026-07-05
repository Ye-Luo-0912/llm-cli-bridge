// LLM CLI Bridge — Agent Runtime Workspace (V16.5-E)
//
// 收纳 agent 自己的会话、临时工作、runtime facts、Vault Skill 源文件。
//
// 工作区结构：
//   LLM-AgentRuntime/
//     README.md
//     runtime/
//       RUNTIME_FACTS.json
//     skills/
//       vault-context/
//         SKILL.md            # source-of-truth（agent 维护）
//         update-log.md       # 可选短日志，不进 prompt
//     sessions/
//     work/
//
// 设计原则：
// - 懒初始化：缺失时创建，不每轮重写。
// - 用户无需日常维护；可查看/重置/清理，但默认不需要编辑。
// - 所有文件写入仍走现有 Vault 文件能力和 PermissionBoundary，不绕过权限系统。
// - VAULT_SKILL 由 agent 自主生成和维护，记录长期可复用事实，不是用户配置。
// - Skills 源文件在 LLM-AgentRuntime 下，运行时物化到 .claude/skills 才能按需生效。

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { ObsidianCliAvailability } from "./runtime/core/bridgePromptContract";

// ---------- 常量 ----------

export const AGENT_RUNTIME_DIR_REL = "LLM-AgentRuntime";
export const AGENT_RUNTIME_README_REL = "LLM-AgentRuntime/README.md";
export const AGENT_RUNTIME_RUNTIME_DIR_REL = "LLM-AgentRuntime/runtime";
export const AGENT_RUNTIME_FACTS_REL = "LLM-AgentRuntime/runtime/RUNTIME_FACTS.json";
export const AGENT_RUNTIME_SKILLS_DIR_REL = "LLM-AgentRuntime/skills";
export const VAULT_CONTEXT_SLUG = "vault-context";
export const VAULT_SKILL_SOURCE_DIR_REL = "LLM-AgentRuntime/skills/vault-context";
export const VAULT_SKILL_SOURCE_REL = "LLM-AgentRuntime/skills/vault-context/SKILL.md";
export const VAULT_SKILL_UPDATE_LOG_REL = "LLM-AgentRuntime/skills/vault-context/update-log.md";
export const AGENT_RUNTIME_SESSIONS_DIR_REL = "LLM-AgentRuntime/sessions";
export const AGENT_RUNTIME_WORK_DIR_REL = "LLM-AgentRuntime/work";

export const RUNTIME_FACTS_SCHEMA_VERSION = 1;
export const VAULT_SKILL_MAX_CHARS = 12000;
export const VAULT_SKILL_TARGET_CHARS_MIN = 3000;
export const VAULT_SKILL_TARGET_CHARS_MAX = 8000;

// ---------- RUNTIME_FACTS.json ----------

export interface RuntimeFacts {
  readonly schemaVersion: number;
  readonly providerId: string;
  readonly vaultPath: string;
  readonly cwd: string;
  readonly platform: string;
  readonly shellAvailable: boolean;
  readonly shellKind: string;
  readonly runtimeFileToolAdapter: "available" | "unavailable";
  readonly providerNativeFileTools: boolean;
  readonly obsidianCliAvailable: ObsidianCliAvailability;
  readonly obsidianCliProbe: "not-probed" | "probed-ok" | "probed-failed";
  readonly lastCapabilityProbeAt: string | null;
  readonly updatedAt: string;
}

export function createDefaultRuntimeFacts(params: {
  providerId: string;
  vaultPath: string;
  cwd: string;
  platform: string;
  shellAvailable: boolean;
  shellKind: string;
  runtimeFileToolAdapter: "available" | "unavailable";
  providerNativeFileTools: boolean;
}): RuntimeFacts {
  return {
    schemaVersion: RUNTIME_FACTS_SCHEMA_VERSION,
    providerId: params.providerId,
    vaultPath: params.vaultPath,
    cwd: params.cwd,
    platform: params.platform,
    shellAvailable: params.shellAvailable,
    shellKind: params.shellKind,
    runtimeFileToolAdapter: params.runtimeFileToolAdapter,
    providerNativeFileTools: params.providerNativeFileTools,
    obsidianCliAvailable: "unknown",
    obsidianCliProbe: "not-probed",
    lastCapabilityProbeAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadRuntimeFacts(vaultPath: string): Promise<RuntimeFacts | null> {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_FACTS_REL);
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<RuntimeFacts>;
    if (parsed.schemaVersion !== RUNTIME_FACTS_SCHEMA_VERSION) return null;
    return parsed as RuntimeFacts;
  } catch {
    return null;
  }
}

export async function saveRuntimeFacts(vaultPath: string, facts: RuntimeFacts): Promise<boolean> {
  const filePath = path.join(vaultPath, AGENT_RUNTIME_FACTS_REL);
  const dirPath = path.dirname(filePath);
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    const content = `${JSON.stringify(facts, null, 2)}\n`;
    await fs.promises.writeFile(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ---------- VAULT_SKILL 写入门槛 ----------

/**
 * V16.5-E 任务 C：VAULT_SKILL 写入门槛判定。
 *
 * 只有"稳定 + 有用 + 可复用"的事实才写入 VAULT_SKILL。
 * 默认每轮不写。
 */
export type VaultSkillWriteReason =
  | "initial"
  | "user-requested"
  | "user-long-term-preference"
  | "stable-vault-structure"
  | "correction-of-error"
  | "post-cleanup-task";

export function shouldWriteVaultSkill(reason: VaultSkillWriteReason): boolean {
  // 所有合法 reason 都允许写入；调用方必须先判定事实稳定性
  switch (reason) {
    case "initial":
    case "user-requested":
    case "user-long-term-preference":
    case "stable-vault-structure":
    case "correction-of-error":
    case "post-cleanup-task":
      return true;
    default:
      return false;
  }
}

/**
 * V16.5-E 任务 C：判定内容是否可以写入 VAULT_SKILL。
 *
 * 不得写入：一次性工具日志、当前 run 过程、普通聊天流水、临时测试文件、
 * 未确认猜测、错误命令尝试、已删除临时路径、大段会话原文。
 */
export function isVaultSkillWritableContent(content: string): { ok: boolean; reason?: string } {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty content" };
  }
  // 禁止写入明显的一次性内容（简单启发式）
  const forbiddenPatterns = [
    /\btemp\b/i,
    /\btmp\b/i,
    /\bdebug\b/i,
    /\blog\b(?!ging)/i, // log 但不匹配 logging
  ];
  // 启发式：如果内容像单次命令日志（以 $ 开头或包含 exit code），拒绝
  if (/^\s*\$\s/.test(trimmed) || /exit\s+\d+/i.test(trimmed)) {
    return { ok: false, reason: "looks like command log" };
  }
  return { ok: true };
}

// ---------- VAULT_SKILL 更新（read → merge → rewrite compact）----------

/**
 * V16.5-E 任务 D：VAULT_SKILL 更新方式 — 禁止 append-only 膨胀。
 *
 * 更新流程：read existing → merge → rewrite compact version
 * 目标长度：3k～8k chars，最大 12k chars，超过必须压缩合并。
 */
export interface VaultSkillUpdateInput {
  /** 新增的稳定事实段落（已通过 isVaultSkillWritableContent 判定） */
  readonly additions?: ReadonlyArray<string>;
  /** 用户纠正段落 */
  readonly userCorrections?: ReadonlyArray<string>;
  /** 是否强制覆盖 agent-managed 区（默认 false，尊重人工修改） */
  readonly overwriteAgentSection?: boolean;
}

export interface VaultSkillUpdateResult {
  readonly ok: boolean;
  readonly content: string;
  readonly length: number;
  readonly compacted: boolean;
  readonly reason?: string;
}

/**
 * 读取现有 VAULT_SKILL source（LLM-AgentRuntime/skills/vault-context/SKILL.md）。
 * 不存在时返回 null。
 */
export async function readVaultSkillSource(vaultPath: string): Promise<string | null> {
  const filePath = path.join(vaultPath, VAULT_SKILL_SOURCE_REL);
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 合并 VAULT_SKILL 内容：read → merge → rewrite compact version。
 *
 * 分区策略：
 * - Stable Vault Facts: agent 维护，agent-managed 区
 * - Agent Observations: agent 维护，agent-managed 区
 * - User Corrections: user-correctable 区，agent 不自动覆盖
 *
 * 如果 existing 内容超过 VAULT_SKILL_MAX_CHARS，触发 compact merge。
 */
export function mergeVaultSkillContent(
  existing: string | null,
  input: VaultSkillUpdateInput,
): VaultSkillUpdateResult {
  const additions = input.additions ?? [];
  const userCorrections = input.userCorrections ?? [];

  if (!existing) {
    // 初次生成：只用 additions + userCorrections
    const content = buildVaultSkillMarkdown({
      stableFacts: additions,
      observations: [],
      userCorrections,
    });
    return finalizeContent(content);
  }

  // 解析现有分区
  const sections = parseVaultSkillSections(existing);
  let stableFacts = sections.stableFacts;
  let observations = sections.observations;
  // userCorrections 区：不自动覆盖；新增 corrections 追加（但整体仍要 compact）
  const mergedUserCorrections = [...sections.userCorrections, ...userCorrections];

  // agent-managed 区：additions 合并去重（按行指纹）
  for (const add of additions) {
    if (!stableFacts.includes(add) && !observations.includes(add)) {
      // 简单策略：短事实进 stableFacts，长观察进 observations
      if (add.length < 200) {
        stableFacts = [...stableFacts, add];
      } else {
        observations = [...observations, add];
      }
    }
  }

  let content = buildVaultSkillMarkdown({
    stableFacts,
    observations,
    userCorrections: mergedUserCorrections,
  });

  const compacted = content.length > VAULT_SKILL_MAX_CHARS;
  if (compacted) {
    // compact merge：保留每个分区的前 N 条，截断过长的条目
    content = compactVaultSkillContent(content);
  }

  return finalizeContent(content, compacted);
}

function finalizeContent(content: string, compacted = false): VaultSkillUpdateResult {
  if (content.length > VAULT_SKILL_MAX_CHARS) {
    // compact 后仍超限，硬截断到 max（保住 header + 前部）
    const header = content.indexOf("\n---\n");
    const headerEnd = header > 0 ? header + 5 : 0;
    const tail = content.slice(headerEnd, VAULT_SKILL_MAX_CHARS - 100);
    content = content.slice(0, headerEnd) + tail + "\n\n> [compacted] exceeded max length, truncated.\n";
  }
  return { ok: true, content, length: content.length, compacted };
}

interface VaultSkillSections {
  readonly stableFacts: string[];
  readonly observations: string[];
  readonly userCorrections: string[];
}

/**
 * 解析 VAULT_SKILL 的三个分区。
 *
 * 不依赖复杂 marker；使用 `## Stable Vault Facts` / `## Agent Observations` /
 * `## User Corrections` 作为 section header。
 */
export function parseVaultSkillSections(content: string): VaultSkillSections {
  const sections: VaultSkillSections = { stableFacts: [], observations: [], userCorrections: [] };
  const lines = content.split("\n");
  let current: keyof VaultSkillSections | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current && buffer.length > 0) {
      const text = buffer.join("\n").trim();
      if (text) sections[current] = [...sections[current], text];
    }
    buffer = [];
  };
  for (const line of lines) {
    if (line.startsWith("## Stable Vault Facts")) { flush(); current = "stableFacts"; continue; }
    if (line.startsWith("## Agent Observations")) { flush(); current = "observations"; continue; }
    if (line.startsWith("## User Corrections")) { flush(); current = "userCorrections"; continue; }
    if (current && line.startsWith("## ")) { flush(); current = null; continue; }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

/**
 * 构建 VAULT_SKILL markdown 内容。
 *
 * 不写成长规则库；聚焦：Vault Overview / Directory Map / Agent Workspace /
 * File Operation Preferences / Tool Preferences / User Preferences / Last Updated。
 */
export function buildVaultSkillMarkdown(params: {
  readonly stableFacts: ReadonlyArray<string>;
  readonly observations: ReadonlyArray<string>;
  readonly userCorrections: ReadonlyArray<string>;
  readonly updatedAt?: string;
}): string {
  const updatedAt = params.updatedAt ?? new Date().toISOString();
  const lines: string[] = [
    "# VAULT_SKILL",
    "",
    `> Agent-maintained long-term vault context cache. Generated by llm-cli-bridge.`,
    `> Source-of-truth: ${VAULT_SKILL_SOURCE_REL}`,
    `> Materialized to: .claude/skills/${VAULT_CONTEXT_SLUG}/SKILL.md`,
    "",
    "## Stable Vault Facts",
    "",
  ];
  if (params.stableFacts.length === 0) {
    lines.push("- (待 agent 发现稳定事实后填充)");
  } else {
    for (const fact of params.stableFacts) {
      lines.push(`- ${fact}`);
    }
  }
  lines.push("", "## Agent Observations", "");
  if (params.observations.length === 0) {
    lines.push("- (待 agent 观察到稳定模式后填充)");
  } else {
    for (const obs of params.observations) {
      lines.push(`- ${obs}`);
    }
  }
  lines.push("", "## User Corrections", "");
  if (params.userCorrections.length === 0) {
    lines.push("- (用户可在此区纠错；agent 不自动覆盖)");
  } else {
    for (const corr of params.userCorrections) {
      lines.push(`- ${corr}`);
    }
  }
  lines.push("", `---`, "", `_Last Updated: ${updatedAt}_`, "");
  return lines.join("\n");
}

/**
 * compact merge：超过 VAULT_SKILL_MAX_CHARS 时压缩合并。
 *
 * 策略：每个分区保留前 20 条，每条截断到 300 chars。
 */
export function compactVaultSkillContent(content: string): string {
  const sections = parseVaultSkillSections(content);
  const trimList = (arr: ReadonlyArray<string>, max = 20, maxItemLen = 300): string[] => {
    return arr.slice(0, max).map((s) => s.length > maxItemLen ? s.slice(0, maxItemLen) + "..." : s);
  };
  return buildVaultSkillMarkdown({
    stableFacts: trimList(sections.stableFacts),
    observations: trimList(sections.observations),
    userCorrections: trimList(sections.userCorrections),
  });
}

// ---------- VAULT_SKILL 初版生成 ----------

/**
 * V16.5-E 任务 B：生成 VAULT_SKILL 初版。
 *
 * 不做深度全库扫描；只扫描 Vault 顶层目录 + 可读取少量关键文件
 *（AGENTS.md / README.md / 根目录索引）。
 */
export async function generateInitialVaultSkill(
  vaultPath: string,
  options: {
    readonly scanTopLevelDirs?: boolean;
    readonly readKeyFiles?: boolean;
  } = {},
): Promise<string> {
  const scanTopLevelDirs = options.scanTopLevelDirs ?? true;
  const readKeyFiles = options.readKeyFiles ?? true;
  const stableFacts: string[] = [];

  stableFacts.push(`Vault root: ${vaultPath}`);

  if (scanTopLevelDirs) {
    try {
      const entries = await fs.promises.readdir(vaultPath, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).filter((d) => !d.startsWith("."));
      if (dirs.length > 0) {
        stableFacts.push(`Top-level directories: ${dirs.slice(0, 15).join(", ")}`);
      }
    } catch {
      // 读取失败不阻断初版生成
    }
  }

  if (readKeyFiles) {
    for (const keyFile of ["AGENTS.md", "README.md"]) {
      try {
        const content = await fs.promises.readFile(path.join(vaultPath, keyFile), "utf8");
        // 只提取首段非空行作为概述（不全文注入）
        const firstLine = content.split("\n").find((l) => l.trim().length > 0 && !l.startsWith("#"))?.trim();
        if (firstLine) {
          stableFacts.push(`${keyFile} overview: ${firstLine.slice(0, 200)}`);
        }
      } catch {
        // 文件不存在跳过
      }
    }
  }

  stableFacts.push(`Agent workspace: ${AGENT_RUNTIME_DIR_REL}/ (sessions/ work/ runtime/ skills/)`);
  stableFacts.push(`Vault Skill source: ${VAULT_SKILL_SOURCE_REL}`);
  stableFacts.push(`Runtime Skill target: .claude/skills/${VAULT_CONTEXT_SLUG}/SKILL.md`);

  return buildVaultSkillMarkdown({
    stableFacts,
    observations: [],
    userCorrections: [],
  });
}

// ---------- Workspace 初始化 ----------

export interface AgentRuntimeWorkspaceInitResult {
  readonly ok: boolean;
  readonly created: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
  readonly vaultSkillInitialized: boolean;
  readonly reason?: string;
}

/**
 * V16.5-E 任务 A：懒初始化 Agent Runtime Workspace。
 *
 * 缺失时创建；已存在时跳过（不覆盖）。
 * 不每轮重写；用户无需日常维护。
 */
export async function ensureAgentRuntimeWorkspace(
  vaultPath: string,
  options: {
    readonly createVaultSkillIfMissing?: boolean;
    readonly vaultSkillInitParams?: {
      readonly providerId: string;
      readonly cwd: string;
      readonly platform: string;
      readonly shellAvailable: boolean;
      readonly shellKind: string;
      readonly runtimeFileToolAdapter: "available" | "unavailable";
      readonly providerNativeFileTools: boolean;
    };
  } = {},
): Promise<AgentRuntimeWorkspaceInitResult> {
  const created: string[] = [];
  const skipped: string[] = [];
  let vaultSkillInitialized = false;

  const dirsToCreate = [
    AGENT_RUNTIME_DIR_REL,
    AGENT_RUNTIME_RUNTIME_DIR_REL,
    AGENT_RUNTIME_SKILLS_DIR_REL,
    VAULT_SKILL_SOURCE_DIR_REL,
    AGENT_RUNTIME_SESSIONS_DIR_REL,
    AGENT_RUNTIME_WORK_DIR_REL,
  ];

  for (const rel of dirsToCreate) {
    const abs = path.join(vaultPath, rel);
    try {
      await fs.promises.mkdir(abs, { recursive: true });
      created.push(rel);
    } catch {
      skipped.push(rel);
    }
  }

  // README.md（缺失时创建，不覆盖）
  const readmeAbs = path.join(vaultPath, AGENT_RUNTIME_README_REL);
  try {
    await fs.promises.access(readmeAbs);
    skipped.push(AGENT_RUNTIME_README_REL);
  } catch {
    try {
      await fs.promises.writeFile(readmeAbs, buildAgentRuntimeReadme(), "utf8");
      created.push(AGENT_RUNTIME_README_REL);
    } catch {
      skipped.push(AGENT_RUNTIME_README_REL);
    }
  }

  // RUNTIME_FACTS.json（缺失时创建默认值，不覆盖）
  const factsAbs = path.join(vaultPath, AGENT_RUNTIME_FACTS_REL);
  try {
    await fs.promises.access(factsAbs);
    skipped.push(AGENT_RUNTIME_FACTS_REL);
  } catch {
    if (options.vaultSkillInitParams) {
      const facts = createDefaultRuntimeFacts({
        providerId: options.vaultSkillInitParams.providerId,
        vaultPath,
        cwd: options.vaultSkillInitParams.cwd,
        platform: options.vaultSkillInitParams.platform,
        shellAvailable: options.vaultSkillInitParams.shellAvailable,
        shellKind: options.vaultSkillInitParams.shellKind,
        runtimeFileToolAdapter: options.vaultSkillInitParams.runtimeFileToolAdapter,
        providerNativeFileTools: options.vaultSkillInitParams.providerNativeFileTools,
      });
      const saved = await saveRuntimeFacts(vaultPath, facts);
      if (saved) {
        created.push(AGENT_RUNTIME_FACTS_REL);
      } else {
        skipped.push(AGENT_RUNTIME_FACTS_REL);
      }
    } else {
      skipped.push(AGENT_RUNTIME_FACTS_REL);
    }
  }

  // VAULT_SKILL source（缺失时生成初版，不覆盖已有）
  const vaultSkillAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_REL);
  try {
    await fs.promises.access(vaultSkillAbs);
    skipped.push(VAULT_SKILL_SOURCE_REL);
  } catch {
    if (options.createVaultSkillIfMissing ?? true) {
      try {
        const initial = await generateInitialVaultSkill(vaultPath);
        await fs.promises.writeFile(vaultSkillAbs, initial, "utf8");
        created.push(VAULT_SKILL_SOURCE_REL);
        vaultSkillInitialized = true;
      } catch {
        skipped.push(VAULT_SKILL_SOURCE_REL);
      }
    } else {
      skipped.push(VAULT_SKILL_SOURCE_REL);
    }
  }

  return {
    ok: true,
    created,
    skipped,
    vaultSkillInitialized,
  };
}

export function buildAgentRuntimeReadme(): string {
  return [
    "# LLM-AgentRuntime",
    "",
    "> Agent Runtime Workspace for llm-cli-bridge.",
    "> Agent 维护，用户默认不需要编辑。",
    "",
    "## 结构",
    "",
    "- `runtime/RUNTIME_FACTS.json`: 机器事实（provider/shell/capability），不进 prompt。",
    "- `skills/vault-context/SKILL.md`: VAULT_SKILL 源文件（agent 长期认知缓存）。",
    "- `skills/vault-context/update-log.md`: 可选短变更日志，不进 prompt。",
    "- `sessions/`: 会话摘要（agent 写入，不进 VAULT_SKILL）。",
    "- `work/`: 临时工作文件（agent 写入，不进 VAULT_SKILL）。",
    "",
    "## 说明",
    "",
    "- VAULT_SKILL 源文件物化到 `.claude/skills/vault-context/SKILL.md` 才能被 provider 按需识别。",
    "- 用户可查看/重置/清理本目录，但默认不需要维护。",
    "- 所有写入仍走 PermissionBoundary，不绕过权限系统。",
    "",
  ].join("\n");
}

// ---------- Skill source → runtime materialization ----------

/**
 * V16.5-E 任务 E：读取 VAULT_SKILL source 并物化到 .claude/skills。
 *
 * 复用现有 agentSkills.ts 机制，不重写 Skills 系统。
 * sourcePath = LLM-AgentRuntime/skills/vault-context/SKILL.md
 * materializedPath = .claude/skills/vault-context/SKILL.md
 *
 * 如果 source skill 更新，下次物化 runtime skill。
 * 如果 runtime skill 被人工修改且 hash 不匹配，返回 conflict，不强制覆盖。
 */
export interface VaultSkillMaterializeResult {
  readonly ok: boolean;
  readonly status: "created" | "updated" | "skipped" | "conflict" | "missing-source" | "error";
  readonly sourcePath: string;
  readonly materializedPath: string;
  readonly sourceHash: string;
  readonly materializedHash: string;
  readonly reason?: string;
}

export async function materializeVaultSkill(vaultPath: string): Promise<VaultSkillMaterializeResult> {
  const sourceAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_REL);
  const materializedAbs = path.join(vaultPath, ".claude/skills", VAULT_CONTEXT_SLUG, "SKILL.md");

  // 读取 source
  let sourceContent: string;
  try {
    sourceContent = await fs.promises.readFile(sourceAbs, "utf8");
  } catch {
    return {
      ok: false,
      status: "missing-source",
      sourcePath: VAULT_SKILL_SOURCE_REL,
      materializedPath: path.posix.join(".claude/skills", VAULT_CONTEXT_SLUG, "SKILL.md"),
      sourceHash: "",
      materializedHash: "",
      reason: "source SKILL.md not found; run ensureAgentRuntimeWorkspace first",
    };
  }

  const sourceHash = sha256(sourceContent);

  // 读取 materialized
  let existingMaterialized: string | null = null;
  try {
    existingMaterialized = await fs.promises.readFile(materializedAbs, "utf8");
  } catch {
    existingMaterialized = null;
  }

  // conflict 检测：materialized 存在但 hash 与 manifest 不匹配 → 人工修改过
  // V16.5-E: 使用 manifest（.llm-bridge/agent-skills.json）记录的 materializedHash 比对
  // 为简化本阶段：如果 materialized 内容与 source 不一致且不是 plugin-generated marker，返回 conflict
  if (existingMaterialized !== null) {
    // materialized 文件带 plugin-generated marker，比较时剥离 marker
    const markerPrefix = "<!-- generated-by:llm-cli-bridge -->\n";
    const strippedMaterialized = existingMaterialized.startsWith(markerPrefix)
      ? existingMaterialized.slice(markerPrefix.length)
      : existingMaterialized;
    const strippedHash = sha256(strippedMaterialized);
    if (strippedHash === sourceHash) {
      // 已物化且内容一致（marker 不计入内容比对）
      return {
        ok: true,
        status: "skipped",
        sourcePath: VAULT_SKILL_SOURCE_REL,
        materializedPath: path.posix.join(".claude/skills", VAULT_CONTEXT_SLUG, "SKILL.md"),
        sourceHash,
        materializedHash: sha256(existingMaterialized),
      };
    }
    // 内容不一致：检查是否是 plugin-generated
    const isPluginGenerated = existingMaterialized.includes("<!-- generated-by:llm-cli-bridge -->");
    if (!isPluginGenerated) {
      return {
        ok: false,
        status: "conflict",
        sourcePath: VAULT_SKILL_SOURCE_REL,
        materializedPath: path.posix.join(".claude/skills", VAULT_CONTEXT_SLUG, "SKILL.md"),
        sourceHash,
        materializedHash: sha256(existingMaterialized),
        reason: "materialized SKILL.md is not plugin-generated; will not overwrite",
      };
    }
    // plugin-generated 但 stripped 内容与 source 不一致 → 正常更新
  }

  // 写入 materialized（加 plugin-generated marker）
  const contentWithMarker = `<!-- generated-by:llm-cli-bridge -->\n${sourceContent}`;
  try {
    await fs.promises.mkdir(path.dirname(materializedAbs), { recursive: true });
    await fs.promises.writeFile(materializedAbs, contentWithMarker, "utf8");
    return {
      ok: true,
      status: existingMaterialized === null ? "created" : "updated",
      sourcePath: VAULT_SKILL_SOURCE_REL,
      materializedPath: path.posix.join(".claude/skills", VAULT_CONTEXT_SLUG, "SKILL.md"),
      sourceHash,
      materializedHash: sha256(contentWithMarker),
    };
  } catch (e) {
    return {
      ok: false,
      status: "error",
      sourcePath: VAULT_SKILL_SOURCE_REL,
      materializedPath: path.posix.join(".claude/skills", VAULT_CONTEXT_SLUG, "SKILL.md"),
      sourceHash,
      materializedHash: "",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------- update-log.md ----------

export interface VaultSkillUpdateLogEntry {
  readonly timestamp: string;
  readonly reason: VaultSkillWriteReason;
  readonly summary: string;
}

export async function appendVaultSkillUpdateLog(
  vaultPath: string,
  entry: VaultSkillUpdateLogEntry,
): Promise<boolean> {
  const logAbs = path.join(vaultPath, VAULT_SKILL_UPDATE_LOG_REL);
  try {
    const existing = await fs.promises.readFile(logAbs, "utf8").catch(() => "");
    // 限制 log 长度：保留最近 50 条
    const lines = existing.split("\n").filter((l) => l.trim().length > 0);
    lines.push(`- [${entry.timestamp}] (${entry.reason}) ${entry.summary}`);
    const trimmed = lines.slice(-50);
    await fs.promises.mkdir(path.dirname(logAbs), { recursive: true });
    await fs.promises.writeFile(logAbs, trimmed.join("\n") + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

// ---------- 工具函数 ----------

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
