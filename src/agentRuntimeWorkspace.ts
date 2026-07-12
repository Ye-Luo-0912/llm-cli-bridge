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
import type { ObsidianCliAvailability } from "./runtime/core/bridgePromptContract";
import { ACTION_METADATA, requiresBridgeApproval, type ActionMetadata, type ActionType } from "./actionMetadata";
import { loadAgentSkillsManifestSync, saveAgentSkillsManifestSync, createAgentSkillRecord, materializeAgentSkillSync, materializeAgentSkillToTarget, materializeAgentSkillToCodexHomeSync, computeAgentSkillSourceHash, type AgentSkillRecord, type AgentSkillMaterializeResult, type AgentSkillsManifest } from "./agentSkills";

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
// V2.18 vault-api：暴露 Obsidian Plugin API 能力（文件系统做不到的：property/tags/backlinks/tasks/daily/trash）
export const VAULT_API_SLUG = "vault-api";
export const VAULT_API_SKILL_SOURCE_DIR_REL = "LLM-AgentRuntime/skills/vault-api";
export const VAULT_API_SKILL_SOURCE_REL = "LLM-AgentRuntime/skills/vault-api/SKILL.md";
export const VAULT_SKILLS_MANIFEST_REL = "LLM-AgentRuntime/skills/manifest.json";
export const AGENT_RUNTIME_SESSIONS_DIR_REL = "LLM-AgentRuntime/sessions";
export const AGENT_RUNTIME_WORK_DIR_REL = "LLM-AgentRuntime/work";
export const AGENT_RUNTIME_PI_SESSIONS_DIR_REL = "LLM-AgentRuntime/pi-sessions";

export const RUNTIME_FACTS_SCHEMA_VERSION = 1;
/** 轻量 vault-runtime skill 总上限：远小于 12k，聚焦规则而非内容 */
export const VAULT_SKILL_MAX_CHARS = 8000;
/** 每个 section 的条数上限（轻量约束） */
export const VAULT_SKILL_SECTION_MAX_ITEMS = 15;
/** 每条规则的最大长度 */
export const VAULT_SKILL_ITEM_MAX_CHARS = 300;

/**
 * 轻量 vault-runtime Skill Package 的四个 section。
 *
 * 只存必要偏好、稳定约定、边界规则、少量目录语义；
 * 不做完整 vault 索引/内容摘要（那些太重且不稳定）。
 */
export const VAULT_SKILL_SECTIONS = [
  "vaultRules",        // 边界规则（agent 必须遵守的禁区/审批边界）
  "stableConventions", // 稳定约定（命名/输出位置/格式）
  "userPreferences",   // 必要偏好（用户明确的少量偏好）
  "directorySemantics", // 少量目录语义（关键目录含义，非完整索引）
] as const;
export type VaultSkillSection = (typeof VAULT_SKILL_SECTIONS)[number];

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
  // 启发式：如果内容像单次命令日志（以 $ 开头或包含 exit code），拒绝
  if (/^\s*\$\s/.test(trimmed) || /exit\s+\d+/i.test(trimmed)) {
    return { ok: false, reason: "looks like command log" };
  }
  // 禁止写入明显的一次性内容（temp/tmp/debug/log 关键词启发式）
  const forbiddenPatterns = [
    { re: /\btemp\b/i, label: "temp" },
    { re: /\btmp\b/i, label: "tmp" },
    { re: /\bdebug\b/i, label: "debug" },
    { re: /\blog\b(?!ging)/i, label: "log" },
  ];
  for (const { re, label } of forbiddenPatterns) {
    if (re.test(trimmed)) {
      return { ok: false, reason: `contains forbidden keyword: ${label}` };
    }
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
  /** 边界规则（agent 必须遵守的禁区/审批边界） */
  readonly vaultRules?: ReadonlyArray<string>;
  /** 稳定约定（命名/输出位置/格式） */
  readonly stableConventions?: ReadonlyArray<string>;
  /** 用户偏好（用户明确要求的少量偏好；agent 不自动覆盖） */
  readonly userPreferences?: ReadonlyArray<string>;
  /** 目录语义（关键目录含义，非完整索引） */
  readonly directorySemantics?: ReadonlyArray<string>;
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
 * 四 section 分区策略：
 * - Vault Rules / Stable Conventions / Directory Semantics: agent-managed 区（去重合并）
 * - User Preferences: user-correctable 区（agent 不自动覆盖，只追加）
 *
 * 如果 existing 内容超过 VAULT_SKILL_MAX_CHARS，触发 compact merge。
 */
export function mergeVaultSkillContent(
  existing: string | null,
  input: VaultSkillUpdateInput,
): VaultSkillUpdateResult {
  if (!existing) {
    // 初次生成：用 input 四 section 直接构建
    const content = buildVaultSkillMarkdown({
      vaultRules: input.vaultRules ?? [],
      stableConventions: input.stableConventions ?? [],
      userPreferences: input.userPreferences ?? [],
      directorySemantics: input.directorySemantics ?? [],
    });
    return finalizeContent(content);
  }

  // 解析现有 section
  const sections = parseVaultSkillSections(existing);
  let vaultRules = sections.vaultRules;
  let stableConventions = sections.stableConventions;
  let userPreferences = sections.userPreferences;  // user-correctable 区
  let directorySemantics = sections.directorySemantics;

  // agent-managed 区（vaultRules/stableConventions/directorySemantics）：按行指纹去重合并
  const mergeSection = (arr: string[], additions: ReadonlyArray<string> | undefined): string[] => {
    if (!additions) return arr;
    const result = [...arr];
    for (const add of additions) {
      if (!result.includes(add)) result.push(add);
    }
    return result;
  };
  vaultRules = mergeSection(vaultRules, input.vaultRules);
  stableConventions = mergeSection(stableConventions, input.stableConventions);
  directorySemantics = mergeSection(directorySemantics, input.directorySemantics);

  // userPreferences 区：不自动覆盖；新增 preferences 追加（但整体仍要 compact）
  if (input.userPreferences) {
    userPreferences = [...userPreferences, ...input.userPreferences];
  }

  let content = buildVaultSkillMarkdown({
    vaultRules,
    stableConventions,
    userPreferences,
    directorySemantics,
  });

  const compacted = content.length > VAULT_SKILL_MAX_CHARS;
  if (compacted) {
    content = compactVaultSkillContent(content);
  }

  return finalizeContent(content, compacted);
}

function finalizeContent(content: string, compacted = false): VaultSkillUpdateResult {
  content = enforceVaultSkillMaxChars(content);
  return { ok: true, content, length: content.length, compacted };
}

/**
 * 硬截断 vault-runtime skill 到 VAULT_SKILL_MAX_CHARS。
 *
 * 保留 H1 标题 + blockquote header + 前部内容；尾部追加截断标记。
 */
function enforceVaultSkillMaxChars(content: string): string {
  if (content.length <= VAULT_SKILL_MAX_CHARS) return content;
  const firstSection = content.indexOf("\n## ");
  const headerEnd = firstSection > 0 ? firstSection : 0;
  const tail = content.slice(headerEnd, VAULT_SKILL_MAX_CHARS - 100);
  return content.slice(0, headerEnd) + tail + "\n\n> [compacted] exceeded max length, truncated.\n";
}

interface VaultSkillSections {
  readonly vaultRules: string[];
  readonly stableConventions: string[];
  readonly userPreferences: string[];
  readonly directorySemantics: string[];
}

/**
 * 解析轻量 vault-runtime Skill 的四个 section。
 *
 * 使用 `## Vault Rules` / `## Stable Conventions` / `## User Preferences` /
 * `## Directory Semantics` 作为 section header。
 */
export function parseVaultSkillSections(content: string): VaultSkillSections {
  const sections: { vaultRules: string[]; stableConventions: string[]; userPreferences: string[]; directorySemantics: string[] } = { vaultRules: [], stableConventions: [], userPreferences: [], directorySemantics: [] };
  const lines = content.split("\n");
  let current: keyof typeof sections | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current && buffer.length > 0) {
      const text = buffer.join("\n").trim();
      if (text) {
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
    if (line.startsWith("## Vault Rules")) { flush(); current = "vaultRules"; continue; }
    if (line.startsWith("## Stable Conventions")) { flush(); current = "stableConventions"; continue; }
    if (line.startsWith("## User Preferences")) { flush(); current = "userPreferences"; continue; }
    if (line.startsWith("## Directory Semantics")) { flush(); current = "directorySemantics"; continue; }
    if (current && line.startsWith("## ")) { flush(); current = null; continue; }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

/**
 * 构建轻量 vault-runtime Skill markdown 内容。
 *
 * 四个 section：Vault Rules / Stable Conventions / User Preferences / Directory Semantics。
 * 只存必要偏好、稳定约定、边界规则、少量目录语义；不做完整索引/内容摘要。
 */
export function buildVaultSkillMarkdown(params: {
  readonly vaultRules: ReadonlyArray<string>;
  readonly stableConventions: ReadonlyArray<string>;
  readonly userPreferences: ReadonlyArray<string>;
  readonly directorySemantics: ReadonlyArray<string>;
  readonly updatedAt?: string;
}): string {
  const updatedAt = params.updatedAt ?? new Date().toISOString();
  const lines: string[] = [
    "# VAULT_RUNTIME_SKILL",
    "",
    "> Agent-maintained lightweight vault runtime package.",
    "> Only stable rules + minimal preferences + directory semantics.",
    `> Source: ${VAULT_SKILL_SOURCE_REL}`,
    "",
    "## Vault Rules",
    "",
  ];
  if (params.vaultRules.length === 0) {
    lines.push("- (agent 必须遵守的边界规则；初始化时由 bridge 写入默认禁区)");
  } else {
    for (const rule of params.vaultRules) {
      lines.push(`- ${rule}`);
    }
  }
  lines.push("", "## Stable Conventions", "");
  if (params.stableConventions.length === 0) {
    lines.push("- (命名/输出位置/格式约定；待 agent 发现稳定模式后填充)");
  } else {
    for (const conv of params.stableConventions) {
      lines.push(`- ${conv}`);
    }
  }
  lines.push("", "## User Preferences", "");
  if (params.userPreferences.length === 0) {
    lines.push("- (用户明确的少量偏好；agent 不自动覆盖)");
  } else {
    for (const pref of params.userPreferences) {
      lines.push(`- ${pref}`);
    }
  }
  lines.push("", "## Directory Semantics", "");
  if (params.directorySemantics.length === 0) {
    lines.push("- (关键目录含义；非完整索引，只记少量语义)");
  } else {
    for (const sem of params.directorySemantics) {
      lines.push(`- ${sem}`);
    }
  }
  lines.push("", `---`, "", `_Last Updated: ${updatedAt}_`, "");
  return lines.join("\n");
}

/**
 * compact merge：超过 VAULT_SKILL_MAX_CHARS 时压缩合并。
 *
 * 策略：每个 section 保留前 VAULT_SKILL_SECTION_MAX_ITEMS 条，
 * 每条截断到 VAULT_SKILL_ITEM_MAX_CHARS chars。
 */
export function compactVaultSkillContent(content: string): string {
  const sections = parseVaultSkillSections(content);
  const trimList = (arr: ReadonlyArray<string>): string[] => {
    return arr.slice(0, VAULT_SKILL_SECTION_MAX_ITEMS).map((s) =>
      s.length > VAULT_SKILL_ITEM_MAX_CHARS ? s.slice(0, VAULT_SKILL_ITEM_MAX_CHARS) + "..." : s
    );
  };
  return buildVaultSkillMarkdown({
    vaultRules: trimList(sections.vaultRules),
    stableConventions: trimList(sections.stableConventions),
    userPreferences: trimList(sections.userPreferences),
    directorySemantics: trimList(sections.directorySemantics),
  });
}

// ---------- VAULT_SKILL 初版生成 ----------

/**
 * vault-context 子 skill 主题映射（文件名 stem → 中文主题）。
 */
const VAULT_CONTEXT_TOPIC_MAP: Readonly<Record<string, string>> = {
  "vault-rules": "边界规则",
  "conventions": "稳定约定",
  "preferences": "用户偏好",
  "directories": "目录语义",
};

/**
 * 生成 vault-context Skill 包初版。
 *
 * 包结构：SKILL.md（清单）+ 4 个子 .md 文件 + INDEX.md（索引）。
 * 写入 bridge 默认已知的边界规则（禁区）+ 目录语义；
 * 不做深度全库扫描（轻量原则）。
 */
export async function generateInitialVaultSkill(
  vaultPath: string,
  _options: {
    readonly scanTopLevelDirs?: boolean;
    readonly readKeyFiles?: boolean;
  } = {},
): Promise<{ readonly skillMd: string; readonly subFiles: Readonly<Record<string, string>>; readonly indexMd: string }> {
  const vaultRules = [
    "不修改 .obsidian/ 目录（Obsidian 配置区）",
    "不修改 .llm-bridge/ 目录（Bridge 主控区，含 bridge.json/credentials）",
    "不修改 .git/ 目录（版本控制）",
    "写操作走 PermissionBoundary（需审批的路径不绕过）",
    "agent 自维护区在 LLM-AgentRuntime/（sessions/work/runtime/skills）",
  ];

  const directories = [
    `${AGENT_RUNTIME_DIR_REL}/ : agent 自维护工作区（sessions/work/runtime/skills）`,
    `.llm-bridge/ : Bridge 主控区（bridge.json/state/logs/sessions）`,
    `.obsidian/ : Obsidian 配置区（禁写）`,
    `.claude/skills/ : Claude skill 物化目标`,
    `.agents/skills/ : generic-agent skill 物化目标`,
    `.pi/skills/ : Pi skill 物化目标`,
  ];

  const skillMd = [
    "# Vault Context",
    "<!-- vault-context-router-version: 2 -->",
    "",
    "维护并应用当前 Obsidian Vault 中稳定、可复用、已验证的上下文。",
    "只在与 Vault 路径、命名、格式、明确偏好或可复用工作约定有关时使用。",
    "",
    "## 按需读取",
    "",
    "- 创建、移动、重命名或删除笔记前：读取 [vault-rules.md](vault-rules.md) 与 [directories.md](directories.md)",
    "- 决定文件名、属性、格式或稳定工作流时：读取 [conventions.md](conventions.md)",
    "- 用户表达稳定偏好，或任务需要遵循既有偏好时：读取 [preferences.md](preferences.md)",
    "- 只需定位相关条目时：先读取 [INDEX.md](INDEX.md)",
    "- 普通知识问答且不涉及 Vault 行为时：不要继续加载本包",
    "",
    "## 自动维护",
    "",
    "- 任务完成后，仅把本轮已验证且未来仍有用的事实追加到对应子文件",
    "- 用户明确表达长期偏好时写入 preferences.md；不要从一次性请求推断偏好",
    "- 重复出现并已验证的目录用途写入 directories.md；命名/格式/流程约定写入 conventions.md",
    "- 不自动修改 vault-rules.md；安全边界变更必须来自用户明确要求或系统迁移",
    "- 写入前去重；发现冲突时保留现状并向用户说明，不静默覆盖",
    "- 临时任务、会话过程、待办、猜测、模型结论、凭据和其他敏感信息不得写入",
    "- 当前明确指令优先于 preferences.md；INDEX.md 由系统生成，不手工编辑",
    "",
  ].join("\n");

  const subFiles: Record<string, string> = {
    "vault-rules.md": [
      "# vault-rules",
      "",
      ...vaultRules.map((r) => `- ${r}`),
      "",
    ].join("\n"),
    "conventions.md": [
      "# conventions",
      "",
      "<!-- agent 维护：命名/输出位置/格式约定 -->",
      "（暂无，agent 在发现稳定约定时追加）",
      "",
    ].join("\n"),
    "preferences.md": [
      "# preferences",
      "",
      "<!-- agent 维护：用户明确表达的偏好（agent 不自动覆盖，只追加） -->",
      "（暂无，用户表达偏好时追加）",
      "",
    ].join("\n"),
    "directories.md": [
      "# directories",
      "",
      ...directories.map((d) => `- ${d}`),
      "",
    ].join("\n"),
  };

  // 接受 vaultPath 参数以保持签名兼容（轻量扫描已内联到 directories 默认值中）
  void vaultPath;

  const indexMd = buildVaultContextIndexMd([
    { file: "vault-rules.md", topic: VAULT_CONTEXT_TOPIC_MAP["vault-rules"] ?? "vault-rules", count: vaultRules.length, updatedAt: "-" },
    { file: "conventions.md", topic: VAULT_CONTEXT_TOPIC_MAP["conventions"] ?? "conventions", count: 0, updatedAt: "-" },
    { file: "preferences.md", topic: VAULT_CONTEXT_TOPIC_MAP["preferences"] ?? "preferences", count: 0, updatedAt: "-" },
    { file: "directories.md", topic: VAULT_CONTEXT_TOPIC_MAP["directories"] ?? "directories", count: directories.length, updatedAt: "-" },
  ]);

  return { skillMd, subFiles, indexMd };
}

/**
 * 旧版 SKILL.md 单文件结构迁移：解析旧版的 Vault Rules / Stable Conventions /
 * User Preferences / Directory Semantics 段落，把条目分发到对应子文件。
 *
 * 旧版 SKILL.md 是单文件，把所有内容都写在一个文件里。新版拆成 4 个子文件 +
 * 一个路由入口 SKILL.md。此函数只做"内容提取 + 分发"，不覆盖已有非空子文件。
 *
 * @param legacySkillMd 旧版 SKILL.md 内容
 * @returns 子文件名 → 提取出的条目数组（仅包含解析出的 `- ` 条目，未含文件头）
 */
function parseLegacyVaultSkillSections(legacySkillMd: string): {
  readonly "vault-rules.md": string[];
  readonly "conventions.md": string[];
  readonly "preferences.md": string[];
  readonly "directories.md": string[];
} {
  type SubFile = "vault-rules.md" | "conventions.md" | "preferences.md" | "directories.md";
  const result: Record<SubFile, string[]> = {
    "vault-rules.md": [],
    "conventions.md": [],
    "preferences.md": [],
    "directories.md": [],
  };

  // 段落标题映射（支持中英文）
  const sectionMap: ReadonlyArray<{ readonly re: RegExp; readonly file: SubFile }> = [
    { re: /^##\s+Vault\s+Rules\s*$/im, file: "vault-rules.md" },
    { re: /^##\s+Stable\s+Conventions\s*$/im, file: "conventions.md" },
    { re: /^##\s+User\s+Preferences\s*$/im, file: "preferences.md" },
    { re: /^##\s+Directory\s+Semantics\s*$/im, file: "directories.md" },
  ];

  const lines = legacySkillMd.split("\n");
  let currentFile: SubFile | null = null;
  for (const line of lines) {
    // 检测段落切换
    let matched = false;
    for (const sec of sectionMap) {
      if (sec.re.test(line)) {
        currentFile = sec.file;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 遇到其他 ## 段落时停止当前段落
    if (/^##\s/.test(line)) {
      currentFile = null;
      continue;
    }

    // 在当前段落内收集 `- ` 条目
    if (currentFile && line.startsWith("- ")) {
      const item = line.slice(2).trim();
      // 跳过占位符条目
      if (item.length > 0 && !item.startsWith("(") && !item.includes("待 agent") && !item.includes("用户明确")) {
        result[currentFile].push(item);
      }
    }
  }

  return result;
}

/**
 * 迁移旧版 SKILL.md 到新结构：解析旧内容 → 分发到子文件 → 重写 SKILL.md 为路由入口。
 *
 * 策略：
 * - 子文件不存在或为空（只有标题行）时，用旧版解析出的条目填充
 * - SKILL.md 始终重写为新版路由入口（无论旧版内容多少）
 * - 保留旧版中有用的条目，丢弃占位符
 */
export async function migrateLegacyVaultSkill(
  vaultPath: string,
  legacySkillMd: string,
): Promise<{ readonly rewritten: string[]; readonly migrated: string[] }> {
  const skillDir = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  const parsed = parseLegacyVaultSkillSections(legacySkillMd);
  const initial = await generateInitialVaultSkill(vaultPath);

  const rewritten: string[] = [];
  const migrated: string[] = [];

  // 1. 重写 SKILL.md 为路由入口（始终执行）
  await fs.promises.writeFile(path.join(skillDir, "SKILL.md"), initial.skillMd, "utf8");
  rewritten.push(`${VAULT_SKILL_SOURCE_DIR_REL}/SKILL.md`);

  // 2. 分发旧版条目到子文件（仅当子文件不存在或为空时）
  for (const [fileName, items] of Object.entries(parsed)) {
    if (items.length === 0) continue;
    const subAbs = path.join(skillDir, fileName);
    let existingContent = "";
    try {
      existingContent = await fs.promises.readFile(subAbs, "utf8");
    } catch {
      // 文件不存在
    }

    // 判断现有文件是否为空（只有标题行 + 占位符）
    const existingLines = existingContent.split("\n").filter((l) => l.startsWith("- ") && l.trim().length > 2);
    const hasRealContent = existingLines.some((l) => {
      const item = l.slice(2).trim();
      return item.length > 0 && !item.startsWith("(") && !item.includes("待 agent") && !item.includes("用户明确");
    });

    if (hasRealContent) {
      // 已有真实内容，不覆盖，只追加旧版条目中不重复的
      const existingSet = new Set(existingLines.map((l) => l.slice(2).trim().toLowerCase()));
      const toAppend = items.filter((item) => !existingSet.has(item.toLowerCase()));
      if (toAppend.length > 0) {
        const newContent = existingContent.replace(/\s*$/, "") + "\n" + toAppend.map((i) => `- ${i}`).join("\n") + "\n";
        await fs.promises.writeFile(subAbs, newContent, "utf8");
        migrated.push(`${VAULT_SKILL_SOURCE_DIR_REL}/${fileName}`);
      }
    } else {
      // 空文件或只有占位符，用旧版条目填充
      const header = `# ${fileName.replace(/\.md$/, "")}\n\n`;
      const newContent = header + items.map((i) => `- ${i}`).join("\n") + "\n";
      await fs.promises.writeFile(subAbs, newContent, "utf8");
      migrated.push(`${VAULT_SKILL_SOURCE_DIR_REL}/${fileName}`);
    }
  }

  // 3. 重新生成索引
  try {
    await regenerateVaultContextIndex(vaultPath);
  } catch {
    // 索引更新失败不阻断
  }

  return { rewritten, migrated };
}


/**
 * 构建 vault-context INDEX.md 内容。
 */
function buildVaultContextIndexMd(entries: ReadonlyArray<{ readonly file: string; readonly topic: string; readonly count: number; readonly updatedAt: string }>): string {
  const rows = entries.map((e) => `| [${e.file}](${e.file}) | ${e.topic} | ${e.count} | ${e.updatedAt} |`);
  return [
    "# vault-context 索引",
    "",
    "> 自动生成的子 skill 索引。agent 可参考此索引快速定位需要更新/查看的子 skill。",
    "> 物化时会从源目录同步到目标目录。",
    "",
    "## 子 Skills",
    "",
    "| 文件 | 主题 | 条目数 | 最后更新 |",
    "|------|------|--------|----------|",
    ...rows,
    "",
  ].join("\n");
}

/**
 * 扫描 vault-context 源目录下所有子 .md 文件，生成/更新 INDEX.md。
 *
 * 排除 SKILL.md 和 INDEX.md 本身。对每个子 skill 文件统计 `- ` 开头行数作为条目数。
 */
export async function regenerateVaultContextIndex(vaultPath: string): Promise<boolean> {
  const sourceDirAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  let files: string[];
  try {
    files = (await fs.promises.readdir(sourceDirAbs))
      .filter((f): f is string => typeof f === "string" && f.endsWith(".md") && f !== "SKILL.md" && f !== "INDEX.md")
      .sort();
  } catch {
    return false;
  }

  const entries: Array<{ file: string; topic: string; count: number; updatedAt: string }> = [];
  for (const file of files) {
    const filePath = path.join(sourceDirAbs, file);
    let content = "";
    try {
      content = await fs.promises.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const stem = file.replace(/\.md$/, "");
    const topic = VAULT_CONTEXT_TOPIC_MAP[stem] ?? stem;
    const count = content.split("\n").filter((l) => l.startsWith("- ")).length;
    let updatedAt = "-";
    try {
      const stat = await fs.promises.stat(filePath);
      updatedAt = stat.mtime.toISOString();
    } catch {
      // 保留 "-"
    }
    entries.push({ file, topic, count, updatedAt });
  }

  const indexMd = buildVaultContextIndexMd(entries);
  try {
    await fs.promises.mkdir(sourceDirAbs, { recursive: true });
    await fs.promises.writeFile(path.join(sourceDirAbs, "INDEX.md"), indexMd, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ---------- V2.18 vault-api Skill 初版生成 ----------

/**
 * V2.18 vault-api：生成 vault-api Skill 初版内容。
 *
 * 设计哲学：只暴露"文件系统做不到的能力"。
 * agent 已有 native Read/Write/Edit/Grep 覆盖普通文件读写；
 * 本 Skill 通过 outbox action / HTTP bridge 调用 Obsidian Plugin API：
 * metadataCache（frontmatter/tags/links）、fileManager.processFrontMatter、
 * vault.trash、vault.rename、resolvedLinks 反查、daily-notes 约定路径。
 *
 * 内容是静态的（不依赖运行时扫描），只描述调用方式与 action 清单。
 */
export function generateInitialVaultApiSkill(): string {
  // 从 ACTION_METADATA 自动生成 action 表（单一真相源）
  const actionEntries = (Object.keys(ACTION_METADATA) as ActionType[])
    .map((type) => ACTION_METADATA[type]);

  // 按 category 分组
  const categories: Array<{ label: string; cat: ActionMetadata["category"] }> = [
    { label: "基础操作", cat: "basic" },
    { label: "结构化类（metadataCache / fileManager，文件系统做不准）", cat: "structured" },
    { label: "全文搜索", cat: "search" },
    { label: "UI / 运行时操作（文件系统做不到）", cat: "ui" },
    { label: "危险操作类（advanced — 默认不调用，需 agent runtime approval 显式确认）", cat: "dangerous" },
  ];

  const actionTables = categories.map(({ label, cat }) => {
    const rows = actionEntries.filter((m) => m.category === cat);
    if (rows.length === 0) return "";
    const tableLines = [
      `### ${label}`,
      "",
      "| type | params | 返回 | dangerous审批 | 说明 |",
      "|------|--------|------|------|------|",
    ];
    for (const m of rows) {
      const paramsStr = m.params.length === 0
        ? "{}"
        : m.params.map((p) => `\"${p.name}\"${p.required ? "" : "?"}`).join(", ");
      // V2.18 s2: 用 requiresBridgeApproval 而非 modifying（仅 dangerous 走 Bridge 审批）
      const confirm = requiresBridgeApproval(m.type) ? "是" : "否";
      tableLines.push(`| ${m.type} | ${paramsStr} | ${m.returns} | ${confirm} | ${m.description} |`);
    }
    tableLines.push("");
    return tableLines.join("\n");
  }).filter(Boolean).join("\n");

  return [
    "# vault-api",
    "",
    "> Obsidian Plugin API 能力 Skill（V2.18）。",
    "> 只暴露文件系统做不到的能力；普通文件读写请用 native Read/Write/Edit。",
    "> 调用通道：obsidian-bridge wrapper（推荐）→ helper mjs → HTTP bridge → outbox actions.jsonl（兜底）。",
    "",
    "## 能力分级",
    "",
    "agent 操作 vault 内容时按以下优先级选择工具：",
    "",
    "- **L0 native file tools（优先）**：普通文件读写用 Read/Write/Edit/Grep/Glob。文件系统能做的不走本 Skill。",
    "- **L1 obsidian-bridge wrapper（本 Skill）**：文件系统做不到或做不准的能力——frontmatter/tags/backlinks/tasks/daily note/metadataCache/搜索/回收站/UI 操作。",
    "- **L2 shell 降级**：当 wrapper 不可用（exit 2/3/4），可降级用 shell + 文件系统做近似操作（如 grep 替代 search），但失去 metadataCache 准确性。",
    "- **dangerous 操作（advanced）**：vault_delete/vault_rename/vault_restore/rename_tag/command_run 默认不调用。仅在用户明确要求时使用，并走 agent runtime approval 显式确认。bridge 对此类保留两阶段审批安全网。",
    "",
    "## 调用通道",
    "",
    "### 1. obsidian-bridge wrapper（推荐，最稳定）",
    "",
    "插件启动时在 `.llm-bridge/tools/` 生成 `obsidian-bridge.cmd`（Windows）/ `obsidian-bridge`（Unix）可执行 wrapper。",
    "agent 直接调用 `obsidian-bridge <type> [params]`，无需手写 `node xxx.mjs`，自动处理 port/token。",
    "",
    "**前置依赖**：wrapper 内部调用 `node`，要求运行环境 PATH 中存在 Node.js（v16+）。",
    "- Codex managed runtime：已内置 node，无需额外安装。",
    "- Claude Code / 通用 agent：需确保 `node` 可在 PATH 中找到。",
    "- 验证：`obsidian-bridge health` 返回 `{ok:true}` 即表示 wrapper + node + bridge 链路正常。",
    "",
    "```bash",
    "obsidian-bridge health                                    # 健康检查",
    "obsidian-bridge tags_list                                 # 非修改类直接输出",
    `obsidian-bridge property_get '{"path":"a.md","key":"tags"}'`,
    `echo '{"path":"a.md","content":"# a"}' | obsidian-bridge create_note --stdin`,
    `obsidian-bridge --wait --timeout 60 vault_delete '{"path":"temp/draft.md"}'`,
    "obsidian-bridge --raw tags_list | jq '.tags'              # 纯 JSON 输出，适合管道",
    "```",
    "",
    "如 PATH 中存在同名冲突（如官方 Obsidian CLI），用显式路径调用：",
    "- Windows: `.\\.llm-bridge\\tools\\obsidian-bridge.cmd health`",
    "- Unix: `./.llm-bridge/tools/obsidian-bridge health`",
    "",
    "**--stdin 模式**（强烈推荐用于修改类 action）：从 stdin 读 JSON params，彻底避免 PowerShell/bash 引号转义问题。",
    "",
    "### 2. Helper mjs（直接 import）",
    "",
    "`.llm-bridge/tools/obsidian-action.mjs` 提供 createClient()，自动读取 bridge.json 并重试。",
    "",
    "```javascript",
    "import { createClient } from \"./.llm-bridge/tools/obsidian-action.mjs\";",
    "const c = createClient();",
    "await c.action(\"property_get\", { path: \"inbox/note.md\", key: \"tags\" });",
    "```",
    "",
    "### 3. HTTP bridge（直接 curl，不推荐）",
    "",
    "插件启动时监听 127.0.0.1 随机端口，连接信息写入 `.llm-bridge/bridge.json`（字段：host / port / token / vaultPath / startedAt）。",
    "请求需手写 `Authorization: Bearer <token>` header，修改类需轮询 `/action-status`。比 wrapper 易出错，仅作兜底。",
    "",
    "### 4. Outbox 兜底（仅当 HTTP server 不可用）",
    "",
    "向 `.llm-bridge/outbox/actions.jsonl` 追加一行 JSON（{ id, type, params, ts? }），插件下次启动时轮询执行。不要在 Obsidian 运行时使用。",
    "",
    "## 错误处理",
    "",
    "wrapper 提供分级错误码：",
    "- exit 2：bridge 未启动（找不到 bridge.json）",
    "- exit 3：bridge 连接失败（端口失效/Obsidian 已退出/防火墙）",
    "- exit 4：token 无效（HTTP 401/403，重启插件刷新 token）",
    "- exit 5：JSON 参数解析失败（建议改用 --stdin）",
    "- exit 1：action 执行失败或用户拒绝审批",
    "",
    "",
    `## Action 清单（V2.18，共 ${actionEntries.length} 个）`,
    "",
    actionTables,
    "",
    "## 使用规则",
    "",
    "- **L0 优先**：普通文件读写 → 用 native Read/Write/Edit/Grep，**不要**走本 Skill。",
    "- frontmatter 操作（property_get/set）→ **必须**用本 Skill（metadataCache/fileManager 比 YAML 文本解析可靠）。",
    "- 全 vault 标签/反向链接/待办清单/出链/断链/标题大纲/书签/metadataCache → **必须**用本 Skill（文件系统无法高效反查或做不准解析或被路径校验拒绝）。",
    "- 全文搜索 → 用 search action（跳过 frontmatter/代码块，比 grep 准；query 可为正则）。",
    "- daily note → 用本 Skill（自动解析 daily-notes 插件配置的日期格式与目录）。",
    "- 删除/重命名/恢复/标签改名 → 用本 Skill（走回收站、更新 metadataCache、原子改 frontmatter；不要直接 fs.unlink/rename 或手动改 YAML）。",
    "- 工作区状态/命令清单/剪贴板写入/视图模式 → 用本 Skill（.obsidian/workspace.json 被拒绝且非实时；命令执行与剪贴板是运行时 UI 操作，文件系统做不到）。",
    "- path 参数必须是 vault 相对路径（如 `inbox/note.md`），禁止绝对路径与 `..` 遍历。",
    "- 修改类 action（property_set/daily_append/vault_delete/vault_rename/vault_restore/rename_tag/command_run）会弹审批框，用户拒绝则不执行。",
    "- **推荐调用方式**：`obsidian-bridge <type> --stdin`（从 stdin 读 JSON，避免 shell 转义）；修改类加 `--wait --timeout N` 等审批结果。",
    `- ${actionEntries.length} 个 action 之外的 Obsidian 能力暂未暴露；如需扩展请在 LLM-AgentRuntime/skills/vault-api/SKILL.md 记录需求。`,
    "",
  ].join("\n");
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
    VAULT_API_SKILL_SOURCE_DIR_REL,
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

  // VAULT_SKILL source（缺失时生成初版包，不覆盖已有）
  const vaultSkillAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_REL);
  try {
    await fs.promises.access(vaultSkillAbs);
    skipped.push(VAULT_SKILL_SOURCE_REL);
    // 旧结构迁移：检测旧版单文件结构并迁移到子文件 + 路由入口 SKILL.md
    try {
      const legacySkillMd = await fs.promises.readFile(vaultSkillAbs, "utf8");
      const isLegacyFormat = /^##\s+(Vault\s+Rules|Stable\s+Conventions|User\s+Preferences|Directory\s+Semantics)\s*$/im.test(legacySkillMd);
      if (isLegacyFormat) {
        // 旧版单文件结构 → 解析并分发到子文件 + 重写 SKILL.md 为路由入口
        const result = await migrateLegacyVaultSkill(vaultPath, legacySkillMd);
        created.push(...result.rewritten, ...result.migrated);
      } else {
        // 新版结构但子文件可能缺失 → 补建空模板
        const skillDir = path.dirname(vaultSkillAbs);
        const initial = await generateInitialVaultSkill(vaultPath);
        let migrated = false;
        // 路由文件由插件维护；旧路由升级到 metadata 渐进披露版本。
        // 稳定事实都在子文件中，因此升级路由不会覆盖用户上下文内容。
        const isOldManagedRouter = /^#\s+Vault\s+Context\s*$/im.test(legacySkillMd)
          && !legacySkillMd.includes("vault-context-router-version: 2")
          && (/##\s+(?:子 Skills|使用路由|按需读取|维护边界|自动维护)/.test(legacySkillMd));
        if (isOldManagedRouter) {
          await fs.promises.writeFile(vaultSkillAbs, initial.skillMd, "utf8");
          created.push(VAULT_SKILL_SOURCE_REL);
          migrated = true;
        }
        for (const [name, content] of Object.entries(initial.subFiles)) {
          const subAbs = path.join(skillDir, name);
          try {
            await fs.promises.access(subAbs);
          } catch {
            await fs.promises.writeFile(subAbs, content, "utf8");
            created.push(`${VAULT_SKILL_SOURCE_DIR_REL}/${name}`);
            migrated = true;
          }
        }
        // INDEX.md 缺失时也补建
        const indexAbs = path.join(skillDir, "INDEX.md");
        try {
          await fs.promises.access(indexAbs);
        } catch {
          await fs.promises.writeFile(indexAbs, initial.indexMd, "utf8");
          created.push(`${VAULT_SKILL_SOURCE_DIR_REL}/INDEX.md`);
          migrated = true;
        }
        if (migrated) {
          // 迁移后重新生成索引，确保条目数和 mtime 正确
          try { await regenerateVaultContextIndex(vaultPath); } catch { /* ignore */ }
        }
      }
    } catch { /* migration failure non-fatal */ }
  } catch {
    if (options.createVaultSkillIfMissing ?? true) {
      try {
        const initial = await generateInitialVaultSkill(vaultPath);
        const skillDir = path.dirname(vaultSkillAbs);
        await fs.promises.mkdir(skillDir, { recursive: true });
        await fs.promises.writeFile(vaultSkillAbs, initial.skillMd, "utf8");
        created.push(VAULT_SKILL_SOURCE_REL);
        for (const [name, content] of Object.entries(initial.subFiles)) {
          const subRel = `${VAULT_SKILL_SOURCE_DIR_REL}/${name}`;
          try {
            await fs.promises.writeFile(path.join(skillDir, name), content, "utf8");
            created.push(subRel);
          } catch {
            skipped.push(subRel);
          }
        }
        try {
          await fs.promises.writeFile(path.join(skillDir, "INDEX.md"), initial.indexMd, "utf8");
          created.push(`${VAULT_SKILL_SOURCE_DIR_REL}/INDEX.md`);
        } catch {
          skipped.push(`${VAULT_SKILL_SOURCE_DIR_REL}/INDEX.md`);
        }
        vaultSkillInitialized = true;
      } catch {
        skipped.push(VAULT_SKILL_SOURCE_REL);
      }
    } else {
      skipped.push(VAULT_SKILL_SOURCE_REL);
    }
  }

  // V2.18 vault-api source（缺失时生成初版，不覆盖已有）
  const vaultApiSkillAbs = path.join(vaultPath, VAULT_API_SKILL_SOURCE_REL);
  try {
    await fs.promises.access(vaultApiSkillAbs);
    skipped.push(VAULT_API_SKILL_SOURCE_REL);
  } catch {
    if (options.createVaultSkillIfMissing ?? true) {
      try {
        const initial = generateInitialVaultApiSkill();
        await fs.promises.writeFile(vaultApiSkillAbs, initial, "utf8");
        created.push(VAULT_API_SKILL_SOURCE_REL);
      } catch {
        skipped.push(VAULT_API_SKILL_SOURCE_REL);
      }
    } else {
      skipped.push(VAULT_API_SKILL_SOURCE_REL);
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
    "- `skills/vault-context/`: vault-context Skill 包（SKILL.md 清单 + 子 skill .md + INDEX.md 索引）。agent 自维护的 vault 认知包。",
    "- `skills/vault-api/SKILL.md`: V2.18 vault-api Skill 源文件（Obsidian Plugin API 能力：property/tags/backlinks/tasks/daily/trash）。",
    "- `sessions/`: 会话摘要（agent 写入，不进 VAULT_SKILL）。",
    "- `work/`: 临时工作文件（agent 写入，不进 VAULT_SKILL）。",
    "- `pi-sessions/`: V17-A Pi portable backend session 目录（pi --mode rpc，不污染 Vault 根）。",
    "",
    "## 说明",
    "",
    "- vault-context 包物化到 `.claude/skills/vault-context/`（SKILL.md + 子 .md + INDEX.md）才能被 provider 按需识别。",
    "- vault-api Skill 源文件物化到 `.claude/skills/vault-api/SKILL.md`（以及 .agents/skills / .pi/skills）。",
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
  [VAULT_CONTEXT_SLUG]: {
    slug: VAULT_CONTEXT_SLUG,
    name: "vault-context",
    description: "Use for vault-specific context in the current Obsidian vault: before creating, moving, renaming, or deleting notes; when choosing paths, names, properties, formats, or stable workflows; when the user states a lasting preference; and after completed work reveals verified reusable directory semantics or conventions. Read only the relevant referenced file and maintain it automatically. Never store transient tasks, guesses, session content, credentials, or secrets.",
  },
  // V2.18 vault-api：Obsidian Plugin API 能力（property/tags/backlinks/tasks/daily/trash）
  [VAULT_API_SLUG]: { slug: VAULT_API_SLUG, name: "vault-api", description: "Obsidian Plugin API capabilities that the file system cannot provide: frontmatter (metadataCache/fileManager), tags/backlinks/tasks aggregation, daily-notes path, vault trash/rename. Invoke via outbox action / HTTP bridge (see .llm-bridge/bridge.json)." },
};

export function getVaultSkillRuntimeMeta(slug: string): VaultSkillRuntimeMeta {
  return VAULT_SKILL_RUNTIME_META[slug] ?? { slug, name: slug, description: `Split skill: ${slug}` };
}

/**
 * V18: 从 SKILL.md 全文解析 YAML frontmatter 的 name/description 字段。
 * 解析失败时返回空对象，调用方回退到 getVaultSkillRuntimeMeta 的硬编码值。
 */
function parseSkillFrontmatterFields(raw: string): { name?: string; description?: string } {
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
  return { name: values.name, description: values.description };
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

// ---------- V16.5-K: Vault Skill manifest（轻量版，单 skill） ----------

/**
 * V16.5-K: Vault Skills manifest 记录 skill 元数据。
 *
 * 轻量版只维护 vault-context 一个 skill（不拆分、不索引）。
 * vault-context 含 4 个 section：Vault Rules / Stable Conventions /
 * User Preferences / Directory Semantics。
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
 * 轻量 vault-runtime Skill 的 compact 决策。
 *
 * 当 source 超过 VAULT_SKILL_MAX_CHARS 时，执行 compact rewrite（分区内截断）。
 * 不再拆分多文件（轻量原则：单文件多 section）。
 */
export function decideCompact(charCount: number): "compact" | "keep" {
  if (charCount <= VAULT_SKILL_MAX_CHARS) return "keep";
  return "compact";
}

/**
 * 执行 vault-context skill 包的 compact 流程（包结构版）。
 *
 * 遍历源目录下所有子 .md 文件（SKILL.md + INDEX.md 除外），每个文件单独 compact：
 * 保留前 15 条 `- ` 开头的行，每条截断到 300 字符。
 * compact 后重新生成 INDEX.md。
 */
export interface CompactOrSplitResult {
  readonly action: "keep" | "compacted";
  readonly vaultContextContent: string;
  readonly reason?: string;
}

/**
 * compact 单个子 skill 文件内容：
 * 保留非 `- ` 行（标题/注释/空行），对 `- ` 行只保留前 15 条且每条截断到 300 字符。
 */
function compactSubSkillContent(content: string): string {
  const lines = content.split("\n");
  let bulletCount = 0;
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (bulletCount >= VAULT_SKILL_SECTION_MAX_ITEMS) {
        continue;
      }
      const itemContent = line.slice(2);
      const truncated = itemContent.length > VAULT_SKILL_ITEM_MAX_CHARS
        ? itemContent.slice(0, VAULT_SKILL_ITEM_MAX_CHARS) + "..."
        : itemContent;
      result.push(`- ${truncated}`);
      bulletCount++;
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

export async function compactOrSplitVaultSkill(vaultPath: string): Promise<CompactOrSplitResult> {
  const sourceDirAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  let files: string[];
  try {
    files = (await fs.promises.readdir(sourceDirAbs))
      .filter((f): f is string => typeof f === "string" && f.endsWith(".md") && f !== "SKILL.md" && f !== "INDEX.md")
      .sort();
  } catch {
    return {
      action: "keep",
      vaultContextContent: "",
      reason: "vault-context source dir not found",
    };
  }

  let anyCompacted = false;
  for (const file of files) {
    const filePath = path.join(sourceDirAbs, file);
    let content: string;
    try {
      content = await fs.promises.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const compacted = compactSubSkillContent(content);
    if (compacted !== content) {
      try {
        await fs.promises.writeFile(filePath, compacted, "utf8");
        anyCompacted = true;
      } catch {
        // 写入失败不阻塞后续文件
      }
    }
  }

  // 重新生成 INDEX.md
  await regenerateVaultContextIndex(vaultPath);

  const skillMd = await readVaultSkillSource(vaultPath);
  return {
    action: anyCompacted ? "compacted" : "keep",
    vaultContextContent: skillMd ?? "",
  };
}

// ============================================================
// u5: 统一物化入口 — 消除 runtime 格式与 Agent Skill 格式的双重物化
// ============================================================

export interface MaterializeAllSkillsResult {
  readonly ok: boolean;
  readonly results: ReadonlyArray<AgentSkillMaterializeResult & { readonly target: string; readonly slug: string }>;
  readonly manifest: AgentSkillsManifest;
  readonly saved: boolean;
  readonly syncSummary: { readonly synced: readonly string[]; readonly skipped: readonly string[] };
  readonly reason?: string;
}

/**
 * u5: 统一物化入口 — 一步完成 source→manifest 同步 + 四端物化（claude/.agents/.pi/codex）。
 *
 * 取代旧的 5 步调用链：
 * 1. materializeAllVaultSkillsToAllTargets（runtime 格式 → .claude/.agents/.pi）
 * 2. syncVaultSkillsToAgentManifest（删除 .claude 的 runtime 文件 → Agent Skill 格式重写 + manifest upsert）
 * 3. prepareAgentSkillsForCodexRuntimeSync（Agent Skill 格式 → ~/.codex/skills/）
 *
 * 统一为：所有 target 使用 materializeAgentSkillToTarget（Agent Skill 格式，source-id marker）。
 */
export function materializeAllSkillsToAllTargets(vaultPath: string): MaterializeAllSkillsResult {
  // Step 1: 同步 vault-context + vault-api source 到 manifest
  const syncSummary = syncVaultSkillsSourceToManifest(vaultPath);

  // Step 2: 加载 manifest，遍历 enabled skills 物化到四端
  let manifest = loadAgentSkillsManifestSync(vaultPath);
  const results: Array<AgentSkillMaterializeResult & { target: string; slug: string }> = [];
  const nextRecords: AgentSkillRecord[] = [...manifest.skills];
  let manifestChanged = false;

  for (let i = 0; i < manifest.skills.length; i++) {
    const record = manifest.skills[i];
    if (!record.enabled) continue;

    // claude target（带 hash check 检测外部修改 + 更新 manifest hash）
    const claudeResult = materializeAgentSkillSync(vaultPath, record);
    results.push({ ...claudeResult, target: "claude", slug: record.slug });
    if (claudeResult.ok && claudeResult.record.materializedHash !== record.materializedHash) {
      nextRecords[i] = claudeResult.record;
      manifestChanged = true;
    }

    // generic-agent target（.agents/skills/<slug>/SKILL.md）
    const agentsPath = path.join(vaultPath, providerTargetPathForSlug("generic-agent", record.slug));
    const agentsResult = materializeAgentSkillToTarget(record, agentsPath, {
      sourceDir: record.sourceDir ? path.join(vaultPath, record.sourceDir) : undefined,
    });
    results.push({ ...agentsResult, target: "generic-agent", slug: record.slug });

    // pi target（.pi/skills/<slug>/SKILL.md）
    const piPath = path.join(vaultPath, providerTargetPathForSlug("pi", record.slug));
    const piResult = materializeAgentSkillToTarget(record, piPath, {
      sourceDir: record.sourceDir ? path.join(vaultPath, record.sourceDir) : undefined,
    });
    results.push({ ...piResult, target: "pi", slug: record.slug });

    // codex target（~/.codex/skills/llm-bridge-<vaultHash>-<slug>/SKILL.md，带 name/desc override）
    const codexResult = materializeAgentSkillToCodexHomeSync(record, undefined, vaultPath);
    results.push({ ...codexResult, target: "codex", slug: record.slug });
  }

  // Step 3: 保存 manifest（hash 变化时）
  let saved = false;
  if (manifestChanged) {
    saved = saveAgentSkillsManifestSync(vaultPath, {
      version: manifest.version,
      skills: nextRecords,
    });
    manifest = loadAgentSkillsManifestSync(vaultPath);
  }

  const ok = results.every((r) => r.ok || r.status === "skipped");
  return { ok, results, manifest, saved, syncSummary };
}

/**
 * u5: 将 vault-context + vault-api 的 source SKILL.md 同步到 agent-skills.json manifest。
 *
 * 读取 source 内容 → 创建/更新 AgentSkillRecord → 保存 manifest。
 * vault-context 是包 skill：instructions = SKILL.md，sourceDir 指向源目录，
 * sourceContentHash 包含 SKILL.md + 所有子 .md 文件内容（检测子文件变化）。
 * vault-api 是单文件 skill：用 computeAgentSkillSourceHash 检测变化。
 */
function syncVaultSkillsSourceToManifest(vaultPath: string): { synced: string[]; skipped: string[] } {
  const synced: string[] = [];
  const skipped: string[] = [];
  const manifest = loadAgentSkillsManifestSync(vaultPath);
  const existingBySlug = new Map(manifest.skills.map((s) => [s.slug, s]));
  const nextRecords: AgentSkillRecord[] = [...manifest.skills];

  for (const slug of [VAULT_CONTEXT_SLUG, VAULT_API_SLUG]) {
    const meta = getVaultSkillRuntimeMeta(slug);
    const isPackage = slug === VAULT_CONTEXT_SLUG;
    const sourceRel = slug === VAULT_API_SLUG ? VAULT_API_SKILL_SOURCE_REL : VAULT_SKILL_SOURCE_REL;
    const sourcePath = path.join(vaultPath, sourceRel);
    let instructions = "";
    try {
      instructions = fs.readFileSync(sourcePath, "utf8");
    } catch {
      skipped.push(slug);
      continue;
    }

    const existing = existingBySlug.get(slug);
    const nowIso = new Date().toISOString();

    // V18: 从 SKILL.md frontmatter 解析 name/description，覆盖硬编码值
    // 解析失败时回退到 getVaultSkillRuntimeMeta 的硬编码值
    const frontmatter = parseSkillFrontmatterFields(instructions);
    const skillName = frontmatter.name || meta.name;
    const skillDescription = frontmatter.description || meta.description;

    // 包 skill：hash 包含 SKILL.md + 所有子 .md 文件内容拼接
    let combinedForHash = instructions;
    if (isPackage) {
      const sourceDirAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
      try {
        const subFiles = fs.readdirSync(sourceDirAbs)
          .filter((f): f is string => typeof f === "string" && f.endsWith(".md") && f !== "SKILL.md")
          .sort();
        for (const f of subFiles) {
          combinedForHash += "\n\n---" + f + "---\n\n" + fs.readFileSync(path.join(sourceDirAbs, f), "utf8");
        }
      } catch {
        // 目录读取失败，仅用 SKILL.md 内容
      }
    }

    // 检测 source 内容是否变化
    const newSourceHash = computeAgentSkillSourceHash({
      name: skillName,
      description: skillDescription,
      instructions: combinedForHash.trim(),
    });

    if (isPackage) {
      // 包 skill：用 sourceContentHash 比较（检测子文件变化）
      if (existing?.sourceContentHash && existing.sourceContentHash === newSourceHash) {
        skipped.push(slug);
        continue;
      }
    } else {
      // 单文件 skill：用 instructions hash 比较
      if (existing) {
        const oldSourceHash = computeAgentSkillSourceHash(existing);
        if (oldSourceHash === newSourceHash) {
          skipped.push(slug);
          continue;
        }
      }
    }

    // 创建/更新 record
    const record = createAgentSkillRecord({
      name: skillName,
      description: skillDescription,
      instructions,
      enabled: true,
      source: existing?.source ?? "manual",
      sourcePath: existing?.sourcePath,
      ...(isPackage ? { sourceDir: VAULT_SKILL_SOURCE_DIR_REL } : {}),
      ...(isPackage ? { sourceContentHash: newSourceHash } : {}),
      slug,
      id: existing?.id,
    }, nextRecords.map((r) => r.slug).filter((s) => s !== slug), nowIso);

    if (existing) {
      const idx = nextRecords.findIndex((r) => r.slug === slug);
      if (idx >= 0) nextRecords[idx] = record;
    } else {
      nextRecords.push(record);
    }
    synced.push(slug);
  }

  if (synced.length === 0) {
    return { synced, skipped };
  }

  saveAgentSkillsManifestSync(vaultPath, {
    version: manifest.version,
    skills: nextRecords,
  });

  return { synced, skipped };
}
