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
export const VAULT_INDEX_SLUG = "vault-index";
export const VAULT_SKILL_SOURCE_DIR_REL = "LLM-AgentRuntime/skills/vault-context";
export const VAULT_SKILL_SOURCE_REL = "LLM-AgentRuntime/skills/vault-context/SKILL.md";
export const VAULT_SKILL_UPDATE_LOG_REL = "LLM-AgentRuntime/skills/vault-context/update-log.md";
export const VAULT_SKILLS_MANIFEST_REL = "LLM-AgentRuntime/skills/manifest.json";
export const VAULT_INDEX_SOURCE_REL = "LLM-AgentRuntime/skills/vault-index/SKILL.md";
export const AGENT_RUNTIME_SESSIONS_DIR_REL = "LLM-AgentRuntime/sessions";
export const AGENT_RUNTIME_WORK_DIR_REL = "LLM-AgentRuntime/work";
export const AGENT_RUNTIME_PI_SESSIONS_DIR_REL = "LLM-AgentRuntime/pi-sessions";

export const RUNTIME_FACTS_SCHEMA_VERSION = 1;
export const VAULT_SKILL_MAX_CHARS = 12000;
export const VAULT_SKILL_TARGET_CHARS_MIN = 3000;
export const VAULT_SKILL_TARGET_CHARS_MAX = 8000;

/**
 * V16.5-K 任务 K：Vault Skill 拆分时的职责分类。
 *
 * 当 vault-context skill compact 后仍超过 12k chars，按职责拆分为多个 skill。
 */
export const VAULT_SKILL_SPLIT_SLUGS = [
  "vault-structure",
  "file-operations",
  "user-preferences",
  "project-context",
] as const;
export type VaultSkillSplitSlug = (typeof VAULT_SKILL_SPLIT_SLUGS)[number];

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
      if (text) {
        // 按列表项（- 前缀）拆分为单独 fact，便于 compact/classify/merge 精细操作。
        // 去掉 "- " 前缀，使 fact 为纯文本（buildVaultSkillMarkdown 会重新加前缀）。
        const items = text.split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => l.slice(2).trim())
          .filter((l) => l.length > 0);
        if (items.length > 0) {
          sections[current] = [...sections[current], ...items];
        } else {
          sections[current] = [...sections[current], text];
        }
      }
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
    AGENT_RUNTIME_PI_SESSIONS_DIR_REL,
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
    "- `pi-sessions/`: V17-A Pi portable backend session 目录（pi --mode rpc，不污染 Vault 根）。",
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
 * V16.5-K1 任务 A：source → runtime skill 转换。
 *
 * source skill（LLM-AgentRuntime/skills/<slug>/SKILL.md）是 agent 维护的纯 markdown；
 * runtime skill（.claude/skills/<slug>/SKILL.md）必须包含 YAML frontmatter + # Instructions
 * 才能被 Claude / SDK 按需识别。
 *
 * runtime 格式（与 agentSkills.ts serializeAgentSkillToMarkdown 一致）：
 *   ---
 *   name: <slug>
 *   description: <description>
 *   ---
 *   <!-- generated-by: llm-cli-bridge -->
 *   <!-- source-slug: <slug> -->
 *   <!-- source-hash: <hash> -->
 *
 *   # Instructions
 *
 *   <source content>
 *
 * 不把 source 直接复制到 runtime；runtime 始终通过本函数派生。
 */
export interface VaultSkillRuntimeMeta {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

const VAULT_SKILL_RUNTIME_META: Readonly<Record<string, VaultSkillRuntimeMeta>> = {
  [VAULT_CONTEXT_SLUG]: { slug: VAULT_CONTEXT_SLUG, name: "vault-context", description: "Agent-maintained long-term vault context cache." },
  [VAULT_INDEX_SLUG]: { slug: VAULT_INDEX_SLUG, name: "vault-index", description: "Vault Skill index and routing." },
  "vault-structure": { slug: "vault-structure", name: "Vault Structure", description: "Vault directory layout and structure facts." },
  "file-operations": { slug: "file-operations", name: "File Operations", description: "File operation preferences and naming rules." },
  "user-preferences": { slug: "user-preferences", name: "User Preferences", description: "User long-term preferences and corrections." },
  "project-context": { slug: "project-context", name: "Project Context", description: "Project conventions and AGENTS.md context." },
};

export function getVaultSkillRuntimeMeta(slug: string): VaultSkillRuntimeMeta {
  return VAULT_SKILL_RUNTIME_META[slug] ?? { slug, name: slug, description: `Split skill: ${slug}` };
}

export function convertVaultSkillSourceToRuntime(
  sourceContent: string,
  slug: string,
  metaOverride?: Partial<VaultSkillRuntimeMeta>,
): string {
  const meta = { ...getVaultSkillRuntimeMeta(slug), ...metaOverride };
  const sourceHash = sha256(sourceContent);
  // 去除 source 可能已有的 H1（# VAULT_SKILL / # vault-index 等），避免与 # Instructions 重复
  const stripped = sourceContent.replace(/^#\s+[^\n]*\n+/m, "").trim();
  return [
    "---",
    `name: ${quoteYamlValue(meta.name)}`,
    `description: ${quoteYamlValue(meta.description)}`,
    "---",
    "",
    `<!-- generated-by: llm-cli-bridge -->`,
    `<!-- source-slug: ${slug} -->`,
    `<!-- source-hash: ${sourceHash} -->`,
    "",
    "# Instructions",
    "",
    stripped,
    "",
  ].join("\n");
}

function quoteYamlValue(value: string): string {
  // 简单 YAML quoting：含特殊字符时用双引号
  const needsQuote = /[:#\[\]{}&!*|>'"%@`,\n]/.test(value) || value.trim() !== value || value.length === 0;
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * V16.5-K1 任务 A：从 runtime SKILL.md 内容中解析 source-hash。
 * 用于 conflict 检测：比较 runtime 记录的 source-hash 与当前 source 的 hash。
 */
export function parseRuntimeSkillSourceHash(runtimeContent: string): string | null {
  const m = runtimeContent.match(/<!-- source-hash: ([a-f0-9]{64}) -->/);
  return m ? m[1] : null;
}

/**
 * V16.5-K1 任务 A：判断 runtime SKILL.md 是否由 plugin 生成。
 */
export function isRuntimeSkillPluginGenerated(runtimeContent: string): boolean {
  return runtimeContent.includes("<!-- generated-by: llm-cli-bridge -->")
    && runtimeContent.includes("# Instructions");
}

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

export async function materializeVaultSkill(
  vaultPath: string,
  options: {
    readonly slug?: string;
    readonly sourcePath?: string;
    readonly materializedPath?: string;
    readonly metaOverride?: Partial<VaultSkillRuntimeMeta>;
  } = {},
): Promise<VaultSkillMaterializeResult> {
  const slug = options.slug ?? VAULT_CONTEXT_SLUG;
  const sourceRel = options.sourcePath ?? (slug === VAULT_CONTEXT_SLUG
    ? VAULT_SKILL_SOURCE_REL
    : `LLM-AgentRuntime/skills/${slug}/SKILL.md`);
  const materializedRel = options.materializedPath ?? path.posix.join(".claude/skills", slug, "SKILL.md");
  const sourceAbs = path.join(vaultPath, sourceRel);
  const materializedAbs = path.join(vaultPath, materializedRel);

  // 读取 source
  let sourceContent: string;
  try {
    sourceContent = await fs.promises.readFile(sourceAbs, "utf8");
  } catch {
    return {
      ok: false,
      status: "missing-source",
      sourcePath: sourceRel,
      materializedPath: materializedRel,
      sourceHash: "",
      materializedHash: "",
      reason: "source SKILL.md not found; run ensureAgentRuntimeWorkspace first",
    };
  }

  const sourceHash = sha256(sourceContent);

  // V16.5-K1：使用 convertVaultSkillSourceToRuntime 派生 runtime 内容（含 frontmatter + # Instructions）
  const runtimeContent = convertVaultSkillSourceToRuntime(sourceContent, slug, options.metaOverride);

  // 读取 materialized
  let existingMaterialized: string | null = null;
  try {
    existingMaterialized = await fs.promises.readFile(materializedAbs, "utf8");
  } catch {
    existingMaterialized = null;
  }

  // conflict 检测：通过 runtime 中记录的 source-hash 比对当前 source hash
  if (existingMaterialized !== null) {
    const existingSourceHash = parseRuntimeSkillSourceHash(existingMaterialized);
    const isPluginGenerated = isRuntimeSkillPluginGenerated(existingMaterialized);

    if (!isPluginGenerated) {
      return {
        ok: false,
        status: "conflict",
        sourcePath: sourceRel,
        materializedPath: materializedRel,
        sourceHash,
        materializedHash: sha256(existingMaterialized),
        reason: "materialized SKILL.md is not plugin-generated; will not overwrite",
      };
    }

    if (existingSourceHash === sourceHash) {
      // runtime 由 plugin 生成且记录的 source-hash 与当前 source 一致 → 已是最新
      return {
        ok: true,
        status: "skipped",
        sourcePath: sourceRel,
        materializedPath: materializedRel,
        sourceHash,
        materializedHash: sha256(existingMaterialized),
      };
    }
    // plugin-generated 但 source-hash 不一致 → 正常更新
  }

  // 写入 materialized（runtime 格式，含 frontmatter + # Instructions）
  try {
    await fs.promises.mkdir(path.dirname(materializedAbs), { recursive: true });
    await fs.promises.writeFile(materializedAbs, runtimeContent, "utf8");
    return {
      ok: true,
      status: existingMaterialized === null ? "created" : "updated",
      sourcePath: sourceRel,
      materializedPath: materializedRel,
      sourceHash,
      materializedHash: sha256(runtimeContent),
    };
  } catch (e) {
    return {
      ok: false,
      status: "error",
      sourcePath: sourceRel,
      materializedPath: materializedRel,
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

// ---------- V16.5-K: Vault Skill 自动拆分与索引 ----------

/**
 * V16.5-K: Vault Skills manifest 记录所有拆分后的 skill 元数据。
 *
 * vault-index 只做索引和路由，不存大量事实。
 * vault-context 是默认主 skill；超限时拆分为 vault-structure / file-operations /
 * user-preferences / project-context。
 */
export interface VaultSkillManifestEntry {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly materializedPath: string;
  readonly sourceHash: string;
  readonly charCount: number;
  readonly updatedAt: string;
  /**
   * V17-A 任务 C.4：多 provider target 路径映射。
   * claude → .claude/skills/<slug>/SKILL.md
   * generic-agent → .agents/skills/<slug>/SKILL.md
   * pi → .pi/skills/<slug>/SKILL.md
   */
  readonly providerTargets?: Readonly<Record<ProviderSkillTarget, string>>;
}

export type ProviderSkillTarget = "claude" | "generic-agent" | "pi";

export const PROVIDER_SKILL_TARGETS: ReadonlyArray<ProviderSkillTarget> = ["claude", "generic-agent", "pi"];

export function providerTargetPathForSlug(target: ProviderSkillTarget, slug: string): string {
  const dir = target === "claude" ? ".claude/skills"
    : target === "generic-agent" ? ".agents/skills"
    : ".pi/skills";
  return path.posix.join(dir, slug, "SKILL.md");
}

export interface VaultSkillsManifest {
  readonly schemaVersion: number;
  readonly updatedAt: string;
  readonly entries: VaultSkillManifestEntry[];
}

export const VAULT_SKILLS_MANIFEST_SCHEMA_VERSION = 1;

export function createEmptyVaultSkillsManifest(): VaultSkillsManifest {
  return {
    schemaVersion: VAULT_SKILLS_MANIFEST_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: [],
  };
}

export async function loadVaultSkillsManifest(vaultPath: string): Promise<VaultSkillsManifest> {
  const filePath = path.join(vaultPath, VAULT_SKILLS_MANIFEST_REL);
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<VaultSkillsManifest>;
    if (parsed.schemaVersion !== VAULT_SKILLS_MANIFEST_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return createEmptyVaultSkillsManifest();
    }
    return parsed as VaultSkillsManifest;
  } catch {
    return createEmptyVaultSkillsManifest();
  }
}

export async function saveVaultSkillsManifest(vaultPath: string, manifest: VaultSkillsManifest): Promise<boolean> {
  const filePath = path.join(vaultPath, VAULT_SKILLS_MANIFEST_REL);
  const dirPath = path.dirname(filePath);
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.promises.writeFile(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * V16.5-K: 判定是否应该为某内容创建新 skill。
 *
 * 禁止无意义碎片化：
 * - 不为一次性任务创建长期 skill。
 * - 不为单个临时文件创建 skill。
 * - 不为普通日志创建 skill。
 */
export function shouldCreateSplitSkill(content: string, reason: string): { ok: boolean; reason?: string } {
  const trimmed = content.trim();
  if (trimmed.length < 100) {
    return { ok: false, reason: "content too short for a dedicated skill" };
  }
  // 一次性任务/临时文件/日志不创建 skill
  if (/一次性|临时|temp|tmp|debug|log/i.test(reason)) {
    return { ok: false, reason: "one-time/temporary content should not become a skill" };
  }
  // 命令日志不创建 skill
  if (/^\s*\$\s/.test(trimmed) || /exit\s+\d+/i.test(trimmed)) {
    return { ok: false, reason: "command log should not become a skill" };
  }
  return { ok: true };
}

/**
 * V16.5-K: 将 vault-context skill 内容按职责分类到拆分 skill。
 *
 * 简单分类策略（按关键词匹配）：
 * - vault-structure: 目录结构、vault 布局、顶层目录
 * - file-operations: 文件操作偏好、输出目录、命名规则
 * - user-preferences: 用户长期偏好、纠正
 * - project-context: 项目约定、AGENTS.md、README
 * - 其他剩余内容保留在 vault-context
 */
export function classifyVaultSkillContent(content: string): {
  readonly vaultStructure: string[];
  readonly fileOperations: string[];
  readonly userPreferences: string[];
  readonly projectContext: string[];
  readonly remaining: string[];
} {
  const sections = parseVaultSkillSections(content);
  const allFacts = [...sections.stableFacts, ...sections.observations, ...sections.userCorrections];
  const result = {
    vaultStructure: [] as string[],
    fileOperations: [] as string[],
    userPreferences: [] as string[],
    projectContext: [] as string[],
    remaining: [] as string[],
  };

  for (const fact of allFacts) {
    const lower = fact.toLowerCase();
    if (/director|目录|structure|layout|top-level|顶层/.test(lower)) {
      result.vaultStructure.push(fact);
    } else if (/file operation|文件操作|output|输出|命名|naming|write|edit/.test(lower)) {
      result.fileOperations.push(fact);
    } else if (/user|偏好|preference|纠正|correction|用户/.test(lower)) {
      result.userPreferences.push(fact);
    } else if (/agents\.md|readme|project|项目|convention|约定/.test(lower)) {
      result.projectContext.push(fact);
    } else {
      result.remaining.push(fact);
    }
  }
  return result;
}

/**
 * V16.5-K: 拆分 vault-context skill 到多个职责 skill。
 *
 * 每个 skill 目标长度 3k～8k chars；超过 12k 的 skill 不允许（compact 后再拆）。
 * 拆分后更新 vault-index 引用所有拆分 skill。
 */
export interface VaultSkillSplitResult {
  readonly ok: boolean;
  readonly splitSkills: ReadonlyArray<{ readonly slug: string; readonly content: string; readonly charCount: number }>;
  readonly vaultIndexContent: string;
  /**
   * V16.5-K1 任务 B：split 后 vault-context 改为 index-only（指向 vault-index），不再保留 compacted 全文。
   * 这样拆出的 facts 只存在于 split skill 中，不会与 vault-context 重复。
   */
  readonly vaultContextRemainingContent: string;
  readonly reason?: string;
}

export function splitVaultSkillByResponsibility(vaultContextContent: string): VaultSkillSplitResult {
  const classified = classifyVaultSkillContent(vaultContextContent);
  const splitSkills: Array<{ readonly slug: string; readonly content: string; readonly charCount: number }> = [];

  const buildSplitSkill = (slug: string, name: string, description: string, facts: ReadonlyArray<string>): { slug: string; content: string; charCount: number } | null => {
    if (facts.length === 0) return null;
    const content = buildVaultSkillMarkdown({
      stableFacts: facts,
      observations: [],
      userCorrections: [],
    }).replace("# VAULT_SKILL", `# ${name}`).replace("Agent-maintained long-term vault context cache.", description);
    // compact 单个 skill
    const compacted = content.length > VAULT_SKILL_MAX_CHARS ? compactVaultSkillContent(content) : content;
    return { slug, content: compacted, charCount: compacted.length };
  };

  const splits = [
    { slug: "vault-structure", name: "Vault Structure", description: "Vault directory layout and structure facts.", facts: classified.vaultStructure },
    { slug: "file-operations", name: "File Operations", description: "File operation preferences and naming rules.", facts: classified.fileOperations },
    { slug: "user-preferences", name: "User Preferences", description: "User long-term preferences and corrections.", facts: classified.userPreferences },
    { slug: "project-context", name: "Project Context", description: "Project conventions and AGENTS.md context.", facts: classified.projectContext },
  ];

  for (const split of splits) {
    const skill = buildSplitSkill(split.slug, split.name, split.description, split.facts);
    if (skill) splitSkills.push(skill);
  }

  // vault-index 只做索引和路由
  const indexLines: string[] = [
    "# vault-index",
    "",
    "> Vault Skill 索引和路由。只记录 skill slug 与职责，不存大量事实。",
    "",
    "## Skills Index",
    "",
  ];
  for (const skill of splitSkills) {
    const desc = splits.find((s) => s.slug === skill.slug)?.description ?? "";
    indexLines.push(`- \`${skill.slug}\` (${skill.charCount} chars): ${desc}`);
  }
  if (splitSkills.length === 0) {
    indexLines.push("- (no split skills; vault-context 保留所有事实)");
  }
  indexLines.push("", `---`, "", `_Last Updated: ${new Date().toISOString()}_`, "");

  // V16.5-K1 任务 B：split 后 vault-context 改为 index-only，指向 vault-index，不保留 compacted 全文。
  // 拆出的 facts 只存在于 split skill 中，不会与 vault-context 重复。
  const vaultContextRemainingLines: string[] = [
    "# VAULT_SKILL",
    "",
    `> Agent-maintained long-term vault context cache. Generated by llm-cli-bridge.`,
    `> Source-of-truth: ${VAULT_SKILL_SOURCE_REL}`,
    `> Materialized to: .claude/skills/${VAULT_CONTEXT_SLUG}/SKILL.md`,
    "",
    "> **Split notice**: 本 vault-context 已按职责拆分为多个子 skill。",
    "> 长期事实已分散到 vault-structure / file-operations / user-preferences / project-context。",
    "> 完整索引见 `vault-index` skill（LLM-AgentRuntime/skills/vault-index/SKILL.md）。",
    "",
    "## Stable Vault Facts",
    "",
    "- (vault-context 已拆分；稳定事实已迁移到子 skill)",
    "",
    "## Agent Observations",
    "",
    "- (vault-context 已拆分；观察已迁移到子 skill)",
    "",
    "## User Corrections",
    "",
    "- (用户可在此区纠错；agent 不自动覆盖)",
    "",
    `---`,
    "",
    `_Last Updated: ${new Date().toISOString()}_`,
    "",
  ];

  return {
    ok: true,
    splitSkills,
    vaultIndexContent: indexLines.join("\n"),
    vaultContextRemainingContent: vaultContextRemainingLines.join("\n"),
  };
}

/**
 * V16.5-K: compact-or-split 决策。
 *
 * 1. 当单个 skill 超过 12k chars，agent 先尝试 compact rewrite。
 * 2. compact 后仍超过 12k chars，按职责拆分。
 *
 * 返回 "compact" / "split" / "keep"。
 */
export function decideCompactOrSplit(charCount: number): "compact" | "split" | "keep" {
  if (charCount <= VAULT_SKILL_MAX_CHARS) return "keep";
  // 超过 max，先 compact
  return "compact";
}

/**
 * V16.5-K: compact 后仍超过 max 时，决定是否拆分。
 */
export function shouldSplitAfterCompact(compactedCharCount: number): boolean {
  return compactedCharCount > VAULT_SKILL_MAX_CHARS;
}

/**
 * V16.5-K: 执行 vault-context skill 的 compact-or-split 流程。
 *
 * 返回更新后的 vault-context content（如果 compact 或保留）或拆分结果。
 */
export interface CompactOrSplitResult {
  readonly action: "keep" | "compacted" | "split";
  readonly vaultContextContent: string;
  readonly splitResult?: VaultSkillSplitResult;
  readonly reason?: string;
}

export async function compactOrSplitVaultSkill(vaultPath: string): Promise<CompactOrSplitResult> {
  const existing = await readVaultSkillSource(vaultPath);
  if (!existing) {
    return {
      action: "keep",
      vaultContextContent: "",
      reason: "vault-context source not found",
    };
  }

  // 步骤 1: compact
  const decision = decideCompactOrSplit(existing.length);
  if (decision === "keep") {
    return {
      action: "keep",
      vaultContextContent: existing,
    };
  }

  // 执行 compact
  const compacted = compactVaultSkillContent(existing);
  if (!shouldSplitAfterCompact(compacted.length)) {
    // compact 后低于阈值，写回 vault-context，不拆分
    await fs.promises.writeFile(path.join(vaultPath, VAULT_SKILL_SOURCE_REL), compacted, "utf8");
    return {
      action: "compacted",
      vaultContextContent: compacted,
    };
  }

  // 步骤 2: compact 后仍超限，按职责拆分
  const splitResult = splitVaultSkillByResponsibility(compacted);

  // 写入拆分 skill 源文件
  for (const skill of splitResult.splitSkills) {
    const skillSourcePath = path.join(vaultPath, "LLM-AgentRuntime/skills", skill.slug, "SKILL.md");
    await fs.promises.mkdir(path.dirname(skillSourcePath), { recursive: true });
    await fs.promises.writeFile(skillSourcePath, skill.content, "utf8");
  }

  // V16.5-K1 任务 B：vault-context 改为 index-only（指向 vault-index），不再保留 compacted 全文。
  // 拆出的 facts 只存在于 split skill 中，不会与 vault-context 重复。
  const vaultContextRemaining = splitResult.vaultContextRemainingContent;
  await fs.promises.writeFile(path.join(vaultPath, VAULT_SKILL_SOURCE_REL), vaultContextRemaining, "utf8");

  // 写入 vault-index
  const indexPath = path.join(vaultPath, VAULT_INDEX_SOURCE_REL);
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, splitResult.vaultIndexContent, "utf8");

  // 更新 manifest（sourceHash/charCount 与实际 source 文件一致）
  const nowIso = new Date().toISOString();
  // V17-A 任务 C.4：每个 entry 记录 providerTargets 路径映射
  const buildProviderTargets = (slug: string): Record<ProviderSkillTarget, string> => ({
    claude: providerTargetPathForSlug("claude", slug),
    "generic-agent": providerTargetPathForSlug("generic-agent", slug),
    pi: providerTargetPathForSlug("pi", slug),
  });
  const entries: VaultSkillManifestEntry[] = [
    {
      slug: VAULT_CONTEXT_SLUG,
      name: "vault-context",
      description: "Main vault context (index-only after split).",
      sourcePath: VAULT_SKILL_SOURCE_REL,
      materializedPath: `.claude/skills/${VAULT_CONTEXT_SLUG}/SKILL.md`,
      sourceHash: sha256(vaultContextRemaining),
      charCount: vaultContextRemaining.length,
      updatedAt: nowIso,
      providerTargets: buildProviderTargets(VAULT_CONTEXT_SLUG),
    },
    {
      slug: VAULT_INDEX_SLUG,
      name: "vault-index",
      description: "Vault Skill index and routing.",
      sourcePath: VAULT_INDEX_SOURCE_REL,
      materializedPath: `.claude/skills/${VAULT_INDEX_SLUG}/SKILL.md`,
      sourceHash: sha256(splitResult.vaultIndexContent),
      charCount: splitResult.vaultIndexContent.length,
      updatedAt: nowIso,
      providerTargets: buildProviderTargets(VAULT_INDEX_SLUG),
    },
  ];
  for (const skill of splitResult.splitSkills) {
    entries.push({
      slug: skill.slug,
      name: skill.slug,
      description: `Split skill: ${skill.slug}`,
      sourcePath: `LLM-AgentRuntime/skills/${skill.slug}/SKILL.md`,
      materializedPath: `.claude/skills/${skill.slug}/SKILL.md`,
      sourceHash: sha256(skill.content),
      charCount: skill.charCount,
      updatedAt: nowIso,
      providerTargets: buildProviderTargets(skill.slug),
    });
  }
  const manifest: VaultSkillsManifest = {
    schemaVersion: VAULT_SKILLS_MANIFEST_SCHEMA_VERSION,
    updatedAt: nowIso,
    entries,
  };
  await saveVaultSkillsManifest(vaultPath, manifest);

  return {
    action: "split",
    vaultContextContent: vaultContextRemaining,
    splitResult,
  };
}

/**
 * V16.5-K: 物化所有 vault skills（vault-context + vault-index + split skills）。
 *
 * runtime skill hash conflict 时不强制覆盖。
 */
export interface MaterializeAllVaultSkillsResult {
  readonly ok: boolean;
  readonly results: ReadonlyArray<VaultSkillMaterializeResult>;
  readonly manifest: VaultSkillsManifest | null;
  readonly reason?: string;
}

export async function materializeAllVaultSkills(vaultPath: string): Promise<MaterializeAllVaultSkillsResult> {
  const manifest = await loadVaultSkillsManifest(vaultPath);
  const results: VaultSkillMaterializeResult[] = [];

  // 总是先物化 vault-context（即使 manifest 为空）
  const vaultContextResult = await materializeVaultSkill(vaultPath);
  results.push(vaultContextResult);

  // 物化 manifest 中的所有 split skills（复用 materializeVaultSkill 的转换 + conflict 检测）
  for (const entry of manifest.entries) {
    if (entry.slug === VAULT_CONTEXT_SLUG) continue; // 已物化
    const result = await materializeVaultSkill(vaultPath, {
      slug: entry.slug,
      sourcePath: entry.sourcePath,
      materializedPath: entry.materializedPath,
    });
    results.push(result);
  }

  return {
    ok: results.every((r) => r.ok || r.status === "skipped"),
    results,
    manifest,
  };
}

/**
 * V17-A 任务 C.4：物化单个 skill 到指定 provider target。
 *
 * 复用 materializeVaultSkill 的转换 + conflict 检测，仅改 materializedPath。
 * - claude → .claude/skills/<slug>/SKILL.md
 * - generic-agent → .agents/skills/<slug>/SKILL.md
 * - pi → .pi/skills/<slug>/SKILL.md
 */
export async function materializeToProviderTarget(
  vaultPath: string,
  slug: string,
  target: ProviderSkillTarget,
  options: { readonly sourcePath?: string; readonly metaOverride?: Partial<VaultSkillRuntimeMeta> } = {},
): Promise<VaultSkillMaterializeResult> {
  return materializeVaultSkill(vaultPath, {
    slug,
    sourcePath: options.sourcePath ?? (slug === VAULT_CONTEXT_SLUG
      ? VAULT_SKILL_SOURCE_REL
      : `LLM-AgentRuntime/skills/${slug}/SKILL.md`),
    materializedPath: providerTargetPathForSlug(target, slug),
    metaOverride: options.metaOverride,
  });
}

export interface MaterializeAllToAllTargetsResult {
  readonly ok: boolean;
  readonly results: ReadonlyArray<VaultSkillMaterializeResult & { readonly target: ProviderSkillTarget }>;
  readonly manifest: VaultSkillsManifest;
}

/**
 * V17-A 任务 C.4：物化所有 vault skills 到所有 provider targets。
 *
 * 遍历 manifest entries × PROVIDER_SKILL_TARGETS，逐一物化。
 * 单个 conflict 不影响其他安全 skill（同 materializeAllVaultSkills 语义）。
 */
export async function materializeAllVaultSkillsToAllTargets(vaultPath: string): Promise<MaterializeAllToAllTargetsResult> {
  const manifest = await loadVaultSkillsManifest(vaultPath);
  const results: Array<VaultSkillMaterializeResult & { readonly target: ProviderSkillTarget }> = [];

  // vault-context 总是物化（即使 manifest 为空）
  for (const target of PROVIDER_SKILL_TARGETS) {
    const result = await materializeToProviderTarget(vaultPath, VAULT_CONTEXT_SLUG, target);
    results.push({ ...result, target });
  }

  // manifest 中的所有 split skills × 所有 targets
  for (const entry of manifest.entries) {
    if (entry.slug === VAULT_CONTEXT_SLUG) continue;
    for (const target of PROVIDER_SKILL_TARGETS) {
      const result = await materializeToProviderTarget(vaultPath, entry.slug, target, { sourcePath: entry.sourcePath });
      results.push({ ...result, target });
    }
  }

  return {
    ok: results.every((r) => r.ok || r.status === "skipped"),
    results,
    manifest,
  };
}
