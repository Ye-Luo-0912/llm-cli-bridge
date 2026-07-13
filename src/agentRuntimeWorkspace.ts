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
import { ACTION_METADATA, requiresBridgeApproval, type ActionMetadata, type ActionType } from "./actionMetadata";
import { loadAgentSkillsManifestSync, saveAgentSkillsManifestSync, createAgentSkillRecord, materializeAgentSkillSync, materializeAgentSkillToTarget, materializeAgentSkillToCodexHomeSync, computeAgentSkillSourceHash, type AgentSkillRecord, type AgentSkillMaterializeResult, type AgentSkillsManifest } from "./agentSkills";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

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
/** V3: 参考分区目录（vault-rules/directories/conventions/preferences 移入此处） */
export const VAULT_SKILL_REFERENCES_DIR_REL = "LLM-AgentRuntime/skills/vault-context/references";
/** V3: agent 配置目录（openai.yaml 等） */
export const VAULT_SKILL_AGENTS_DIR_REL = "LLM-AgentRuntime/skills/vault-context/agents";
/** V3: 静态资源目录 */
export const VAULT_SKILL_ASSETS_DIR_REL = "LLM-AgentRuntime/skills/vault-context/assets";
/** V3: 迁移备份目录（v2 平铺结构 → v3 references/ 时备份） */
export const VAULT_SKILL_BACKUP_DIR_REL = "LLM-AgentRuntime/skills/vault-context/.v2-backup";
/** V3: 参考分区文件名（相对 references/ 目录） */
export const VAULT_SKILL_REFERENCE_FILES = ["vault-rules.md", "directories.md", "conventions.md", "preferences.md"] as const;
/** V3: 包物化时递归同步的子目录 */
export const VAULT_SKILL_PACKAGE_SUBDIRS = ["references", "agents", "assets"] as const;
// V2.18 vault-api：暴露 Obsidian Plugin API 能力（文件系统做不到的：property/tags/backlinks/tasks/daily/trash）
export const VAULT_API_SLUG = "vault-api";
export const VAULT_API_SKILL_SOURCE_DIR_REL = "LLM-AgentRuntime/skills/vault-api";
export const VAULT_API_SKILL_SOURCE_REL = "LLM-AgentRuntime/skills/vault-api/SKILL.md";
export const VAULT_SKILLS_MANIFEST_REL = "LLM-AgentRuntime/skills/manifest.json";
export const AGENT_RUNTIME_SESSIONS_DIR_REL = "LLM-AgentRuntime/sessions";
export const AGENT_RUNTIME_WORK_DIR_REL = "LLM-AgentRuntime/work";
export const AGENT_RUNTIME_PI_SESSIONS_DIR_REL = "LLM-AgentRuntime/pi-sessions";
// V20: runtime provider 本地真相源文件（含 API Key，不随 Vault 同步，不提交 Git）
export const AGENT_RUNTIME_PRIVATE_DIR_REL = "LLM-AgentRuntime/private";
export const AGENT_RUNTIME_PROVIDER_CONFIG_REL = "LLM-AgentRuntime/private/runtime-provider.json";

// V20.5: 原生运行时配置目录（各 runtime 使用官方格式，Bridge 只路由）
// V20.6: 路径从 LLM-AgentRuntime/private/runtime/ 迁移到 .llm-bridge/private/runtime/
//        Claude 配置文件名从 settings.local.json 改为 settings.json
export const AGENT_RUNTIME_PRIVATE_RUNTIME_DIR_REL = ".llm-bridge/private/runtime";
export const AGENT_RUNTIME_ACTIVE_PROVIDER_REL = ".llm-bridge/private/runtime/active.json";
export const AGENT_RUNTIME_SECRETS_ENV_REL = ".llm-bridge/private/runtime/secrets.env";
/**
 * V20.9: Bridge 所有权 sidecar — 记录哪些 provider 的本地配置由 Bridge 表单创建。
 *
 * 取代"根据内容形状猜所有权"的旧逻辑。只有 sidecar 中明确记录的 provider，
 * 其本地配置文件才允许被 Bridge 表单整文件覆盖；否则视为用户手写，转只读保护。
 *
 * sidecar 本身只在 writeProviderForm 成功后写入，删除本地配置文件不自动清除 sidecar
 * （下次 Bridge 重新生成会再次标记）。
 */
export const AGENT_RUNTIME_BRIDGE_OWNED_REL = ".llm-bridge/private/runtime/bridge-owned.json";
export const AGENT_RUNTIME_CODEX_CONFIG_DIR_REL = ".llm-bridge/private/runtime/codex";
export const AGENT_RUNTIME_CODEX_CONFIG_REL = ".llm-bridge/private/runtime/codex/config.toml";
export const AGENT_RUNTIME_CLAUDE_CONFIG_DIR_REL = ".llm-bridge/private/runtime/claude";
export const AGENT_RUNTIME_CLAUDE_CONFIG_REL = ".llm-bridge/private/runtime/claude/settings.json";
export const AGENT_RUNTIME_PI_CONFIG_DIR_REL = ".llm-bridge/private/runtime/pi";
export const AGENT_RUNTIME_PI_SETTINGS_REL = ".llm-bridge/private/runtime/pi/settings.json";
export const AGENT_RUNTIME_PI_MODELS_REL = ".llm-bridge/private/runtime/pi/models.json";

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

// ---------- VAULT_SKILL 初版生成（V3 标准结构） ----------

/**
 * vault-context 参考分区主题映射（文件名 stem → 中文主题）。
 * V3：参考分区（references/）不是独立子 Skill，只是同一 Skill 的参考文件。
 */
const VAULT_CONTEXT_TOPIC_MAP: Readonly<Record<string, string>> = {
  "vault-rules": "边界规则",
  "conventions": "稳定约定",
  "preferences": "用户偏好",
  "directories": "目录语义",
};

/** V3: vault-context SKILL.md 的标准 frontmatter（单一真相源） */
export const VAULT_CONTEXT_SKILL_META = {
  name: "vault-context",
  description: "Maintain and apply stable, reusable, verified context for the current Obsidian vault. Invoke before creating, moving, renaming, or deleting notes; when choosing paths, names, properties, formats, or stable workflows; when the user states a lasting preference; and after completed work reveals verified reusable directory semantics or conventions. Read only the relevant reference file. Never store transient tasks, guesses, session content, credentials, or secrets.",
  /** 独立短描述，用于 agents/openai.yaml 的 interface.short_description（25-64 字符） */
  shortDescription: "Maintain and apply stable, reusable vault context.",
} as const;

/**
 * V3: 生成 vault-context Skill 包初版（标准 Skill 结构）。
 *
 * 结构：
 * - SKILL.md：frontmatter（name/description）+ 路由正文
 * - references/：vault-rules.md / directories.md / conventions.md / preferences.md（参考分区）
 * - agents/openai.yaml：OpenAI agent 配置
 * - INDEX.md：Obsidian 可读的自动生成目录
 *
 * 写入 bridge 默认已知的边界规则（禁区）+ 目录语义；不做深度全库扫描（轻量原则）。
 */
export async function generateInitialVaultSkill(
  vaultPath: string,
  _options: {
    readonly scanTopLevelDirs?: boolean;
    readonly readKeyFiles?: boolean;
  } = {},
): Promise<{
  readonly skillMd: string;
  readonly references: Readonly<Record<string, string>>;
  readonly agentsOpenaiYaml: string;
  readonly indexMd: string;
}> {
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
    "---",
    `name: "${VAULT_CONTEXT_SKILL_META.name}"`,
    `description: "${VAULT_CONTEXT_SKILL_META.description}"`,
    "---",
    "<!-- vault-context-router-version: 3 -->",
    "",
    "维护并应用当前 Obsidian Vault 中稳定、可复用、已验证的上下文。",
    "只在与 Vault 路径、命名、格式、明确偏好或可复用工作约定有关时使用。",
    "",
    "## 按需读取（路由到 references/）",
    "",
    "- 创建、移动、重命名或删除笔记前：读取 [references/vault-rules.md](references/vault-rules.md) 与 [references/directories.md](references/directories.md)",
    "- 决定文件名、属性、格式或稳定工作流时：读取 [references/conventions.md](references/conventions.md)",
    "- 用户表达稳定偏好，或任务需要遵循既有偏好时：读取 [references/preferences.md](references/preferences.md)",
    "- 只需定位相关条目时：先读取 [INDEX.md](INDEX.md)",
    "- 普通知识问答且不涉及 Vault 行为时：不要继续加载本包",
    "",
    "## 自动维护（收紧策略）",
    "",
    "- preferences.md 只记录用户明确表达的长期偏好；不从一次性请求推断",
    "- vault-rules.md 只接受用户明确规则或系统迁移；agent 不自动修改",
    "- directories.md 只记录目录用途，不缓存完整目录树",
    "- conventions.md 需要明确证据或跨任务重复验证才写入",
    "- 写入前去重；发现冲突时保留现状并向用户说明，不静默覆盖",
    "- 使用原子写入，修改前备份，更新日志持久化到 update-log.md",
    "- 临时任务、会话过程、待办、猜测、模型结论、凭据和其他敏感信息不得写入",
    "- 当前明确指令优先于 references/preferences.md；INDEX.md 由系统生成，不手工编辑",
    "",
  ].join("\n");

  const references: Record<string, string> = {
    "vault-rules.md": [
      "# vault-rules",
      "",
      ...vaultRules.map((r) => `- ${r}`),
      "",
    ].join("\n"),
    "conventions.md": [
      "# conventions",
      "",
      "<!-- agent 维护：命名/输出位置/格式约定（需明确证据或跨任务重复验证） -->",
      "（暂无，agent 在发现稳定约定时追加）",
      "",
    ].join("\n"),
    "preferences.md": [
      "# preferences",
      "",
      "<!-- agent 维护：用户明确表达的长期偏好（agent 不自动覆盖，只追加） -->",
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

  const agentsOpenaiYaml = buildAgentsOpenaiYaml();

  // 接受 vaultPath 参数以保持签名兼容（轻量扫描已内联到 directories 默认值中）
  void vaultPath;

  const indexMd = buildVaultContextIndexMd([
    { file: "vault-rules.md", topic: VAULT_CONTEXT_TOPIC_MAP["vault-rules"] ?? "vault-rules", count: vaultRules.length, updatedAt: "-" },
    { file: "conventions.md", topic: VAULT_CONTEXT_TOPIC_MAP["conventions"] ?? "conventions", count: 0, updatedAt: "-" },
    { file: "preferences.md", topic: VAULT_CONTEXT_TOPIC_MAP["preferences"] ?? "preferences", count: 0, updatedAt: "-" },
    { file: "directories.md", topic: VAULT_CONTEXT_TOPIC_MAP["directories"] ?? "directories", count: directories.length, updatedAt: "-" },
  ]);

  return { skillMd, references, agentsOpenaiYaml, indexMd };
}

/**
 * V3: 构建 agents/openai.yaml 内容。
 *
 * 采用 OpenAI 风格 runtime 的标准 agent 配置 schema：
 * - interface.display_name / interface.short_description：UI 展示名与简述
 * - default_prompt：隐式触发时发送的指令
 * - policy.allow_implicit_invocation：允许 runtime 根据上下文隐式调用
 *
 * 发现与触发入口仍是根 SKILL.md 的 frontmatter（单一真相源）；
 * 本文件只声明 interface/policy，供 OpenAI 风格 runtime 识别。
 */
function buildAgentsOpenaiYaml(): string {
  return [
    "# vault-context agent config (OpenAI-style runtime)",
    "# 由系统生成，不手工编辑。发现/触发入口为根 SKILL.md frontmatter。",
    'interface:',
    '  display_name: "Vault Context"',
    `  short_description: "${escapeYamlDoubleQuoted(VAULT_CONTEXT_SKILL_META.shortDescription)}"`,
    'default_prompt: |',
    '  Maintain and apply stable, reusable, verified context for the current Obsidian vault.',
    '  Before creating/moving/renaming/deleting notes, or choosing paths/names/formats/workflows,',
    '  read the relevant file under references/ (vault-rules.md / directories.md / conventions.md / preferences.md)',
    '  and apply it. After completed work reveals a verified reusable convention or directory semantic,',
    '  append it to the matching reference file. Never store transient tasks, guesses, credentials, or secrets.',
    'policy:',
    '  allow_implicit_invocation: true',
    'references:',
    '  - references/vault-rules.md',
    '  - references/directories.md',
    '  - references/conventions.md',
    '  - references/preferences.md',
    "",
  ].join("\n");
}

/** YAML 双引号字符串转义：反斜杠与双引号 */
function escapeYamlDoubleQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * V3: 解析旧版 SKILL.md 单文件结构（v1）的 Vault Rules / Stable Conventions /
 * User Preferences / Directory Semantics 段落，把条目分发到对应参考分区文件。
 *
 * @param legacySkillMd 旧版 SKILL.md 内容
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

  const sectionMap: ReadonlyArray<{ readonly re: RegExp; readonly file: SubFile }> = [
    { re: /^##\s+Vault\s+Rules\s*$/im, file: "vault-rules.md" },
    { re: /^##\s+Stable\s+Conventions\s*$/im, file: "conventions.md" },
    { re: /^##\s+User\s+Preferences\s*$/im, file: "preferences.md" },
    { re: /^##\s+Directory\s+Semantics\s*$/im, file: "directories.md" },
  ];

  const lines = legacySkillMd.split("\n");
  let currentFile: SubFile | null = null;
  for (const line of lines) {
    let matched = false;
    for (const sec of sectionMap) {
      if (sec.re.test(line)) {
        currentFile = sec.file;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (/^##\s/.test(line)) {
      currentFile = null;
      continue;
    }
    if (currentFile && line.startsWith("- ")) {
      const item = line.slice(2).trim();
      if (item.length > 0 && !item.startsWith("(") && !item.includes("待 agent") && !item.includes("用户明确")) {
        result[currentFile].push(item);
      }
    }
  }

  return result;
}

/**
 * V3: 迁移旧版 v1 SKILL.md（单文件）到 v3 结构（references/ + frontmatter）。
 *
 * 策略：
 * - SKILL.md 始终重写为 v3 路由入口（含 frontmatter）
 * - 旧版条目分发到 references/ 下对应文件（仅当文件不存在或为空时填充）
 * - 已有真实内容的参考文件不覆盖，只追加不重复的条目
 */
export async function migrateLegacyVaultSkill(
  vaultPath: string,
  legacySkillMd: string,
): Promise<{ readonly rewritten: string[]; readonly migrated: string[] }> {
  const skillDir = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  const referencesDir = path.join(skillDir, "references");
  const parsed = parseLegacyVaultSkillSections(legacySkillMd);
  const initial = await generateInitialVaultSkill(vaultPath);

  const rewritten: string[] = [];
  const migrated: string[] = [];

  // 1. 重写 SKILL.md 为 v3 路由入口（始终执行）
  await fs.promises.writeFile(path.join(skillDir, "SKILL.md"), initial.skillMd, "utf8");
  rewritten.push(`${VAULT_SKILL_SOURCE_DIR_REL}/SKILL.md`);

  // 2. 确保 references/ + agents/ 目录存在
  await fs.promises.mkdir(referencesDir, { recursive: true });
  const agentsDir = path.join(skillDir, "agents");
  await fs.promises.mkdir(agentsDir, { recursive: true });
  // 写 agents/openai.yaml（缺失时创建）
  const openaiYamlPath = path.join(agentsDir, "openai.yaml");
  try {
    await fs.promises.access(openaiYamlPath);
  } catch {
    await fs.promises.writeFile(openaiYamlPath, initial.agentsOpenaiYaml, "utf8");
    migrated.push(`${VAULT_SKILL_SOURCE_DIR_REL}/agents/openai.yaml`);
  }

  // 3. 分发旧版条目到 references/ 下对应文件
  for (const [fileName, items] of Object.entries(parsed)) {
    if (items.length === 0) continue;
    const subAbs = path.join(referencesDir, fileName);
    let existingContent = "";
    try {
      existingContent = await fs.promises.readFile(subAbs, "utf8");
    } catch {
      // 文件不存在
    }

    const existingLines = existingContent.split("\n").filter((l) => l.startsWith("- ") && l.trim().length > 2);
    const hasRealContent = existingLines.some((l) => {
      const item = l.slice(2).trim();
      return item.length > 0 && !item.startsWith("(") && !item.includes("待 agent") && !item.includes("用户明确");
    });

    if (hasRealContent) {
      const existingSet = new Set(existingLines.map((l) => l.slice(2).trim().toLowerCase()));
      const toAppend = items.filter((item) => !existingSet.has(item.toLowerCase()));
      if (toAppend.length > 0) {
        const newContent = existingContent.replace(/\s*$/, "") + "\n" + toAppend.map((i) => `- ${i}`).join("\n") + "\n";
        await fs.promises.writeFile(subAbs, newContent, "utf8");
        migrated.push(`${VAULT_SKILL_SOURCE_DIR_REL}/references/${fileName}`);
      }
    } else {
      const header = `# ${fileName.replace(/\.md$/, "")}\n\n`;
      const newContent = header + items.map((i) => `- ${i}`).join("\n") + "\n";
      await fs.promises.writeFile(subAbs, newContent, "utf8");
      migrated.push(`${VAULT_SKILL_SOURCE_DIR_REL}/references/${fileName}`);
    }
  }

  // 4. 重新生成索引
  try {
    await regenerateVaultContextIndex(vaultPath);
  } catch {
    // 索引更新失败不阻断
  }

  return { rewritten, migrated };
}

/**
 * V3: 迁移 v2 平铺结构（vault-rules.md 等在 skill 根目录）到 v3 结构（references/ 子目录）。
 *
 * 策略（幂等）：
 * - 检测根目录下的平铺参考文件（vault-rules.md 等）
 * - 备份旧结构到 .v2-backup/（首次迁移时）
 * - 移动到 references/（保留用户已积累的内容）
 * - 升级 SKILL.md：添加 frontmatter（若缺失），更新路由链接指向 references/
 * - 重复执行不产生修改（references/ 已存在且平铺文件已移走时为 no-op）
 *
 * @returns 迁移结果（migrated 为实际发生移动的文件；空数组表示无需迁移）
 */
export async function migrateVaultSkillV2ToV3(
  vaultPath: string,
): Promise<{ readonly migrated: string[]; readonly backedUp: string[]; readonly rewritten: boolean }> {
  const skillDir = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  const referencesDir = path.join(skillDir, "references");
  const backupDir = path.join(skillDir, ".v2-backup");

  const migrated: string[] = [];
  const backedUp: string[] = [];

  // 1. 检测根目录下的平铺参考文件
  const flatFiles: string[] = [];
  for (const name of VAULT_SKILL_REFERENCE_FILES) {
    const flatPath = path.join(skillDir, name);
    try {
      const stat = await fs.promises.stat(flatPath);
      if (stat.isFile()) flatFiles.push(name);
    } catch {
      // 不存在
    }
  }

  // 2. 检测 SKILL.md 是否需要升级（无 frontmatter 或 router-version < 3）
  const skillMdPath = path.join(skillDir, "SKILL.md");
  let skillMdContent = "";
  try {
    skillMdContent = await fs.promises.readFile(skillMdPath, "utf8");
  } catch {
    skillMdContent = "";
  }
  const parsed = parseSkillDocument(skillMdContent);
  const needsSkillUpgrade = !parsed || !skillMdContent.includes("vault-context-router-version: 3");

  // 无平铺文件且 SKILL.md 已是 v3 → 幂等 no-op
  if (flatFiles.length === 0 && !needsSkillUpgrade) {
    return { migrated, backedUp, rewritten: false };
  }

  // 3. 首次迁移时备份旧结构到 .v2-backup/
  let backupExists = false;
  try {
    await fs.promises.access(backupDir);
    backupExists = true;
  } catch {
    backupExists = false;
  }
  if (!backupExists && (flatFiles.length > 0 || needsSkillUpgrade)) {
    await fs.promises.mkdir(backupDir, { recursive: true });
    // 备份平铺参考文件
    for (const name of flatFiles) {
      try {
        await fs.promises.copyFile(path.join(skillDir, name), path.join(backupDir, name));
        backedUp.push(name);
      } catch {
        // 备份失败不阻塞
      }
    }
    // 备份旧 SKILL.md
    if (skillMdContent) {
      try {
        await fs.promises.writeFile(path.join(backupDir, "SKILL.md"), skillMdContent, "utf8");
        backedUp.push("SKILL.md");
      } catch {
        // 备份失败不阻塞
      }
    }
  }

  // 4. 确保 references/ 目录存在
  await fs.promises.mkdir(referencesDir, { recursive: true });

  // 5. 移动平铺文件到 references/（合并已存在的内容）
  for (const name of flatFiles) {
    const flatPath = path.join(skillDir, name);
    const refPath = path.join(referencesDir, name);
    const flatContent = await fs.promises.readFile(flatPath, "utf8");

    let refExists = false;
    try {
      await fs.promises.access(refPath);
      refExists = true;
    } catch {
      refExists = false;
    }

    if (refExists) {
      // references/ 已有同名文件 → 合并（追加不重复的条目，保留 references/ 版本为主）
      const refContent = await fs.promises.readFile(refPath, "utf8");
      const refItems = new Set(refContent.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim().toLowerCase()));
      const flatLines = flatContent.split("\n").filter((l) => l.startsWith("- "));
      const toAppend: string[] = [];
      for (const line of flatLines) {
        const item = line.slice(2).trim();
        if (item.length > 0 && !item.startsWith("(") && !refItems.has(item.toLowerCase())) {
          toAppend.push(item);
        }
      }
      if (toAppend.length > 0) {
        const newContent = refContent.replace(/\s*$/, "") + "\n" + toAppend.map((i) => `- ${i}`).join("\n") + "\n";
        await fs.promises.writeFile(refPath, newContent, "utf8");
      }
    } else {
      // references/ 无同名文件 → 直接移动
      await fs.promises.writeFile(refPath, flatContent, "utf8");
    }

    // 删除根目录平铺文件
    await fs.promises.unlink(flatPath);
    migrated.push(`references/${name}`);
  }

  // 6. 升级 SKILL.md 到 v3（含 frontmatter）
  let rewritten = false;
  if (needsSkillUpgrade) {
    const initial = await generateInitialVaultSkill(vaultPath);
    await fs.promises.writeFile(skillMdPath, initial.skillMd, "utf8");
    rewritten = true;
    // 确保 agents/openai.yaml 存在
    const agentsDir = path.join(skillDir, "agents");
    await fs.promises.mkdir(agentsDir, { recursive: true });
    const openaiYamlPath = path.join(agentsDir, "openai.yaml");
    try {
      await fs.promises.access(openaiYamlPath);
    } catch {
      await fs.promises.writeFile(openaiYamlPath, initial.agentsOpenaiYaml, "utf8");
    }
  }

  // 7. 重新生成索引
  try {
    await regenerateVaultContextIndex(vaultPath);
  } catch {
    // 索引更新失败不阻断
  }

  return { migrated, backedUp, rewritten };
}


/**
 * V3: 构建 vault-context INDEX.md 内容。
 *
 * INDEX 只作为 Obsidian 可读的自动生成目录；链接指向 references/ 下的参考分区文件。
 */
function buildVaultContextIndexMd(entries: ReadonlyArray<{ readonly file: string; readonly topic: string; readonly count: number; readonly updatedAt: string }>): string {
  const rows = entries.map((e) => `| [${e.file}](references/${e.file}) | ${e.topic} | ${e.count} | ${e.updatedAt} |`);
  return [
    "# vault-context 索引",
    "",
    "> 自动生成的上下文分区目录。Obsidian 可读，agent 可参考快速定位参考分区文件。",
    "> 物化时会从源目录递归同步到目标目录。不手工编辑。",
    "",
    "## 上下文分区",
    "",
    "| 文件 | 主题 | 条目数 | 最后更新 |",
    "|------|------|--------|----------|",
    ...rows,
    "",
  ].join("\n");
}

/**
 * V3: 扫描 vault-context references/ 目录下所有参考分区 .md 文件，生成/更新 INDEX.md。
 *
 * 排除 SKILL.md 和 INDEX.md 本身。对每个参考分区文件统计 `- ` 开头行数作为条目数。
 */
export async function regenerateVaultContextIndex(vaultPath: string): Promise<boolean> {
  const sourceDirAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  const referencesDirAbs = path.join(sourceDirAbs, "references");
  let files: string[];
  try {
    files = (await fs.promises.readdir(referencesDirAbs))
      .filter((f): f is string => typeof f === "string" && f.endsWith(".md"))
      .sort();
  } catch {
    // references/ 不存在 → 尝试扫描根目录（兼容迁移前状态）
    try {
      files = (await fs.promises.readdir(sourceDirAbs))
        .filter((f): f is string => typeof f === "string"
          && (VAULT_SKILL_REFERENCE_FILES as readonly string[]).includes(f))
        .sort();
    } catch {
      return false;
    }
  }

  const entries: Array<{ file: string; topic: string; count: number; updatedAt: string }> = [];
  for (const file of files) {
    const filePath = path.join(referencesDirAbs, file);
    const fallbackPath = path.join(sourceDirAbs, file);
    let content = "";
    let usedPath = filePath;
    try {
      content = await fs.promises.readFile(filePath, "utf8");
    } catch {
      try {
        content = await fs.promises.readFile(fallbackPath, "utf8");
        usedPath = fallbackPath;
      } catch {
        continue;
      }
    }
    const stem = file.replace(/\.md$/, "");
    const topic = VAULT_CONTEXT_TOPIC_MAP[stem] ?? stem;
    const count = content.split("\n").filter((l) => l.startsWith("- ")).length;
    let updatedAt = "-";
    try {
      const stat = await fs.promises.stat(usedPath);
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
    // V3: 结构迁移 — 检测旧版结构并迁移到 references/ + frontmatter
    try {
      const legacySkillMd = await fs.promises.readFile(vaultSkillAbs, "utf8");
      const isLegacySingleFile = /^##\s+(Vault\s+Rules|Stable\s+Conventions|User\s+Preferences|Directory\s+Semantics)\s*$/im.test(legacySkillMd);
      if (isLegacySingleFile) {
        // v1 单文件结构 → v3 references/ + frontmatter
        const result = await migrateLegacyVaultSkill(vaultPath, legacySkillMd);
        created.push(...result.rewritten, ...result.migrated);
      } else {
        // v2 平铺结构（vault-rules.md 等在根目录）或旧版路由 → v3 references/ + frontmatter
        const migResult = await migrateVaultSkillV2ToV3(vaultPath);
        if (migResult.migrated.length > 0) {
          created.push(...migResult.migrated.map((f) => `${VAULT_SKILL_SOURCE_DIR_REL}/${f}`));
        }
        if (migResult.backedUp.length > 0) {
          created.push(...migResult.backedUp.map((f) => `${VAULT_SKILL_SOURCE_DIR_REL}/.v2-backup/${f}`));
        }
        if (migResult.rewritten) {
          created.push(VAULT_SKILL_SOURCE_REL);
        }
        // 补建缺失的 references/ + agents/ 模板（不覆盖已有）
        const skillDir = path.dirname(vaultSkillAbs);
        const initial = await generateInitialVaultSkill(vaultPath);
        const referencesDir = path.join(skillDir, "references");
        await fs.promises.mkdir(referencesDir, { recursive: true });
        let patched = false;
        for (const [name, content] of Object.entries(initial.references)) {
          const refAbs = path.join(referencesDir, name);
          try {
            await fs.promises.access(refAbs);
          } catch {
            await fs.promises.writeFile(refAbs, content, "utf8");
            created.push(`${VAULT_SKILL_SOURCE_DIR_REL}/references/${name}`);
            patched = true;
          }
        }
        // agents/openai.yaml 缺失时补建
        const agentsDir = path.join(skillDir, "agents");
        await fs.promises.mkdir(agentsDir, { recursive: true });
        const openaiYamlAbs = path.join(agentsDir, "openai.yaml");
        try {
          await fs.promises.access(openaiYamlAbs);
        } catch {
          await fs.promises.writeFile(openaiYamlAbs, initial.agentsOpenaiYaml, "utf8");
          created.push(`${VAULT_SKILL_SOURCE_DIR_REL}/agents/openai.yaml`);
          patched = true;
        }
        // INDEX.md 缺失时也补建
        const indexAbs = path.join(skillDir, "INDEX.md");
        try {
          await fs.promises.access(indexAbs);
        } catch {
          await fs.promises.writeFile(indexAbs, initial.indexMd, "utf8");
          created.push(`${VAULT_SKILL_SOURCE_DIR_REL}/INDEX.md`);
          patched = true;
        }
        if (patched || migResult.migrated.length > 0 || migResult.rewritten) {
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
        // V3: 写 references/ 参考分区文件
        const referencesDir = path.join(skillDir, "references");
        await fs.promises.mkdir(referencesDir, { recursive: true });
        for (const [name, content] of Object.entries(initial.references)) {
          const refRel = `${VAULT_SKILL_SOURCE_DIR_REL}/references/${name}`;
          try {
            await fs.promises.writeFile(path.join(referencesDir, name), content, "utf8");
            created.push(refRel);
          } catch {
            skipped.push(refRel);
          }
        }
        // V3: 写 agents/openai.yaml
        const agentsDir = path.join(skillDir, "agents");
        await fs.promises.mkdir(agentsDir, { recursive: true });
        try {
          await fs.promises.writeFile(path.join(agentsDir, "openai.yaml"), initial.agentsOpenaiYaml, "utf8");
          created.push(`${VAULT_SKILL_SOURCE_DIR_REL}/agents/openai.yaml`);
        } catch {
          skipped.push(`${VAULT_SKILL_SOURCE_DIR_REL}/agents/openai.yaml`);
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
    "- `skills/vault-context/`: vault-context Skill 包（SKILL.md 清单 + references/ 分区 + INDEX.md 索引）。agent 自维护的 vault 认知包。",
    "- `skills/vault-api/SKILL.md`: V2.18 vault-api Skill 源文件（Obsidian Plugin API 能力：property/tags/backlinks/tasks/daily/trash）。",
    "- `sessions/`: 会话摘要（agent 写入，不进 VAULT_SKILL）。",
    "- `work/`: 临时工作文件（agent 写入，不进 VAULT_SKILL）。",
    "- `pi-sessions/`: V17-A Pi portable backend session 目录（pi --mode rpc，不污染 Vault 根）。",
    "",
    "## 说明",
    "",
    "- vault-context 包物化到 `.claude/skills/vault-context/`（SKILL.md + references/ + INDEX.md）才能被 provider 按需识别。",
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

/**
 * V3: 仅作为 fallback。真实 name/description 来自源 SKILL.md 的 frontmatter（parseSkillDocument）。
 * vault-context 的真相源是 VAULT_CONTEXT_SKILL_META，此处引用避免双真相源。
 */
const VAULT_SKILL_RUNTIME_META: Readonly<Record<string, VaultSkillRuntimeMeta>> = {
  [VAULT_CONTEXT_SLUG]: {
    slug: VAULT_CONTEXT_SLUG,
    name: VAULT_CONTEXT_SKILL_META.name,
    description: VAULT_CONTEXT_SKILL_META.description,
  },
  // V2.18 vault-api：Obsidian Plugin API 能力（property/tags/backlinks/tasks/daily/trash）
  [VAULT_API_SLUG]: { slug: VAULT_API_SLUG, name: "vault-api", description: "Obsidian Plugin API capabilities that the file system cannot provide: frontmatter (metadataCache/fileManager), tags/backlinks/tasks aggregation, daily-notes path, vault trash/rename. Invoke via outbox action / HTTP bridge (see .llm-bridge/bridge.json)." },
};

export function getVaultSkillRuntimeMeta(slug: string): VaultSkillRuntimeMeta {
  return VAULT_SKILL_RUNTIME_META[slug] ?? { slug, name: slug, description: `Split skill: ${slug}` };
}

/**
 * V3: 解析 Skill 文档（SKILL.md）的 YAML frontmatter + body。
 *
 * 源 SKILL.md 自带 name/description（单一真相源），物化时只保留这一层 frontmatter。
 * 解析失败（无 frontmatter）时返回 null，调用方回退到 getVaultSkillRuntimeMeta。
 *
 * YAML 值支持双引号/单引号/无引号字符串；不支持多行或复杂类型（Skill 元数据只需要 name/description）。
 */
export interface ParsedSkillDocument {
  readonly name: string;
  readonly description: string;
  /** frontmatter 之后的正文（已去掉前导空行） */
  readonly body: string;
  readonly raw: string;
}

export function parseSkillDocument(raw: string): ParsedSkillDocument | null {
  const normalized = raw.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) return null;
  const endMatch = /\r?\n---\s*(?:\r?\n|$)/.exec(normalized);
  if (!endMatch) return null;
  const end = endMatch.index + endMatch[0].length;
  const block = normalized.slice(3, endMatch.index);
  const body = normalized.slice(end).replace(/^\r?\n/, "");
  const values: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    values[key] = val;
  }
  if (!values.name && !values.description) return null;
  return { name: values.name ?? "", description: values.description ?? "", body, raw };
}

/** 兼容旧调用：只取 name/description */
function parseSkillFrontmatterFields(raw: string): { name?: string; description?: string } {
  const parsed = parseSkillDocument(raw);
  if (!parsed) return {};
  return { name: parsed.name || undefined, description: parsed.description || undefined };
}

// ---------- V3: 递归复制 / hash / 清理 ----------

/**
 * V3: 递归复制目录（同步）。dst 已存在时先删除 stale 条目再覆盖。
 * 用于包 skill 物化时同步 references/agents/assets 到目标目录。
 */
function copyDirRecursiveSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  const srcEntries = fs.readdirSync(src, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map((e) => e.name));
  // 删除目标端已失效的旧文件
  let dstEntries: fs.Dirent[] = [];
  try {
    dstEntries = fs.readdirSync(dst, { withFileTypes: true });
  } catch {
    dstEntries = [];
  }
  for (const d of dstEntries) {
    if (!srcNames.has(d.name)) {
      try {
        fs.rmSync(path.join(dst, d.name), { recursive: true, force: true });
      } catch {
        // 删除失败不阻塞
      }
    }
  }
  for (const entry of srcEntries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

/**
 * V3: 递归收集目录下所有文件内容（按相对路径排序），用于包 hash 计算。
 */
function collectFileContentsSync(dir: string, relPrefix: string, chunks: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = `${relPrefix}/${entry.name}`;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFileContentsSync(full, rel, chunks);
    } else if (entry.isFile()) {
      try {
        chunks.push(`\n---${rel}---\n` + fs.readFileSync(full, "utf8"));
      } catch {
        // 读取失败跳过
      }
    }
  }
}

/**
 * V3: 计算包 skill 的递归 hash（SKILL.md body + references/agents/assets 全部文件）。
 */
function computePackageSourceHash(sourceDir: string, skillMdRaw: string): string {
  const chunks: string[] = [skillMdRaw];
  for (const sub of VAULT_SKILL_PACKAGE_SUBDIRS) {
    const srcSub = path.join(sourceDir, sub);
    collectFileContentsSync(srcSub, sub, chunks);
  }
  return sha256(chunks.join("\n"));
}

/**
 * V3: 同步包 skill 的子目录（references/agents/assets）到目标目录。
 * 源目录不存在的子目录 → 删除目标端对应目录（清理失效文件）。
 */
function syncPackageSubdirsSync(sourceDir: string, targetDir: string): void {
  for (const sub of VAULT_SKILL_PACKAGE_SUBDIRS) {
    const srcSub = path.join(sourceDir, sub);
    const dstSub = path.join(targetDir, sub);
    if (fs.existsSync(srcSub) && fs.statSync(srcSub).isDirectory()) {
      copyDirRecursiveSync(srcSub, dstSub);
    } else {
      // 源端不存在 → 删除目标端旧文件（失效清理）
      try {
        fs.rmSync(dstSub, { recursive: true, force: true });
      } catch {
        // 删除失败不阻塞
      }
    }
  }
}

/**
 * V3: 异步版 syncPackageSubdirsSync（用 fs.promises 避免阻塞主线程）。
 */
async function syncPackageSubdirsAsync(sourceDir: string, targetDir: string): Promise<void> {
  for (const sub of VAULT_SKILL_PACKAGE_SUBDIRS) {
    const srcSub = path.join(sourceDir, sub);
    const dstSub = path.join(targetDir, sub);
    let srcExists = false;
    try {
      const stat = await fs.promises.stat(srcSub);
      srcExists = stat.isDirectory();
    } catch {
      srcExists = false;
    }
    if (srcExists) {
      await copyDirRecursiveAsync(srcSub, dstSub);
    } else {
      try {
        await fs.promises.rm(dstSub, { recursive: true, force: true });
      } catch {
        // 删除失败不阻塞
      }
    }
  }
}

async function copyDirRecursiveAsync(src: string, dst: string): Promise<void> {
  await fs.promises.mkdir(dst, { recursive: true });
  const srcEntries = await fs.promises.readdir(src, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map((e) => e.name));
  let dstEntries: fs.Dirent[] = [];
  try {
    dstEntries = await fs.promises.readdir(dst, { withFileTypes: true });
  } catch {
    dstEntries = [];
  }
  for (const d of dstEntries) {
    if (!srcNames.has(d.name)) {
      try {
        await fs.promises.rm(path.join(dst, d.name), { recursive: true, force: true });
      } catch {
        // 删除失败不阻塞
      }
    }
  }
  for (const entry of srcEntries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursiveAsync(srcPath, dstPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, dstPath);
    }
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
 * V3: compact 单个参考分区文件内容：
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

/**
 * V3: compact vault-context 参考分区文件（references/ 下的 .md 文件）。
 *
 * 遍历 references/ 目录下所有 .md 文件，每个文件单独 compact：
 * 保留前 15 条 `- ` 开头的行，每条截断到 300 字符。
 * compact 后重新生成 INDEX.md。
 */
export async function compactOrSplitVaultSkill(vaultPath: string): Promise<CompactOrSplitResult> {
  const sourceDirAbs = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  const referencesDirAbs = path.join(sourceDirAbs, "references");
  let files: string[];
  try {
    files = (await fs.promises.readdir(referencesDirAbs))
      .filter((f): f is string => typeof f === "string" && f.endsWith(".md"))
      .sort();
  } catch {
    // references/ 不存在 → 尝试扫描根目录平铺文件（迁移前兼容）
    try {
      files = (await fs.promises.readdir(sourceDirAbs))
        .filter((f): f is string => typeof f === "string"
          && (VAULT_SKILL_REFERENCE_FILES as readonly string[]).includes(f))
        .sort();
    } catch {
      return {
        action: "keep",
        vaultContextContent: "",
        reason: "vault-context source dir not found",
      };
    }
  }

  let anyCompacted = false;
  for (const file of files) {
    let filePath = path.join(referencesDirAbs, file);
    let usedReferences = true;
    try {
      await fs.promises.access(filePath);
    } catch {
      filePath = path.join(sourceDirAbs, file);
      usedReferences = false;
    }
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
    void usedReferences;
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
 * V3: 将 vault-context + vault-api 的 source SKILL.md 同步到 agent-skills.json manifest。
 *
 * 读取 source 内容 → 用 parseSkillDocument() 解析 frontmatter（单一真相源）→ 创建/更新 AgentSkillRecord。
 * vault-context 是包 skill：
 * - instructions = SKILL.md body（去掉 frontmatter，避免物化时双层 frontmatter）
 * - sourceDir 指向源目录
 * - sourceContentHash 递归包含 SKILL.md + references/agents/assets 全部文件（检测子文件变化）
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
    let rawContent = "";
    try {
      rawContent = fs.readFileSync(sourcePath, "utf8");
    } catch {
      skipped.push(slug);
      continue;
    }

    const existing = existingBySlug.get(slug);
    const nowIso = new Date().toISOString();

    // V3: 从 SKILL.md frontmatter 解析 name/description（单一真相源）。
    // 解析失败时回退到 getVaultSkillRuntimeMeta（fallback）。
    const parsed = parseSkillDocument(rawContent);
    const skillName = parsed?.name || meta.name;
    const skillDescription = parsed?.description || meta.description;
    // instructions = body only（去掉 frontmatter），确保物化后只有一层 frontmatter
    const instructions = parsed?.body ?? rawContent;

    // V3: 包 skill 递归 hash（SKILL.md raw + references/agents/assets 全部文件）
    const newSourceHash = isPackage
      ? computePackageSourceHash(path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL), rawContent)
      : computeAgentSkillSourceHash({
          name: skillName,
          description: skillDescription,
          instructions: instructions.trim(),
        });

    if (isPackage) {
      // 包 skill：用 sourceContentHash 比较（递归检测子文件变化）
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
