// LLM CLI Bridge — Minimal Prompt Contract (V16.5-C, V16.5-D grounded)
//
// 集中维护 prompt 的三类核心 section：
// 1. buildCapabilityManifest  — 声明当前 runtime 可用能力与边界
// 2. buildAutonomyContract    — 鼓励 LLM 自主行动，减少反复正文确认
// 3. buildSafetyBoundaryContract — write/delete/command 由 host approval 承担
//
// V16.5-D: Capability Manifest 不再只依赖 DEFAULT_PROVIDER_CAPABILITIES。
// ProviderCapabilityInfo 改为带 evidence 的 facts 结构，obsidianCliAvailable 改为
// 三态（known-available / unknown / known-unavailable）。调用方（view.ts）注入真实
// runtime/provider/preflight 能力，本模块只渲染事实，不臆造。
//
// 设计原则：
// - 最小化：每个 section 只描述必要约束，不堆砌细碎规则。
// - provider-neutral：不绑定 SDK/CLI/Codex 的私有字段名。
// - 单一真相源：runtime/core/promptPackage.ts 与 src/promptPackage.ts 都复用本模块。
// - 事实驱动：capability 文案根据真实 facts 派生，不写"未知但可用"的矛盾文案。

import type { LLMBridgeSettings } from "../../types";
import type { StateSnapshot } from "../../promptPackage";

// ---------- Provider 能力信息 ----------

/**
 * Obsidian CLI 可用性三态。
 *
 * - "known-available":   已探测可用（如 `obsidian --version` 成功）
 * - "unknown":           未探测（默认；调用方可按需探测）
 * - "known-unavailable": 已探测不可用（命令缺失/失败）
 */
export type ObsidianCliAvailability = "known-available" | "unknown" | "known-unavailable";

/**
 * 当前 runtime 可用的 provider 能力（带 evidence 的 facts）。
 *
 * 由调用方（view.ts / BridgeSession）根据 backendMode + provider + preflight 实际结果填充。
 * evidence 用于 prompt 审计与 LLM 决策依据；不会展示给最终用户（仅在 prompt 中以事实形式出现）。
 *
 * V16.5-D: obsidianCliAvailable 从 boolean 改为三态；其余能力保留 boolean + 可选 evidence string。
 */
export interface ProviderCapabilityInfo {
  /** provider-native file tools 可用（Read/Write/Edit/Glob/Grep 等） */
  readonly providerNativeFileTools: boolean;
  /** bridge runtime file tools 可用（read-only adapter） */
  readonly bridgeRuntimeFileTools: boolean;
  /** shell / PowerShell / Bash 执行可用（需 host approval） */
  readonly shellAvailable: boolean;
  /** Obsidian CLI 可用性三态（known-available / unknown / known-unavailable） */
  readonly obsidianCliAvailable: ObsidianCliAvailability;
  /** AskUserQuestion 可用于真实歧义 */
  readonly askUserQuestionAvailable: boolean;
  /** 能力来源证据（provider id / runtimeFileToolAdapter / shell approval / obsidian CLI probe 结果） */
  readonly evidence?: ProviderCapabilityEvidence;
  /** Runtime-discovered Codex plugins / Agent Skills that should be visible to the provider. */
  readonly runtimeSkills?: ProviderRuntimeSkillContext;
}

export interface ProviderCapabilityEvidence {
  /** 当前 provider 标识（claude-sdk / codex-app-server / claude-cli / mock） */
  readonly provider?: string;
  /** runtimeFileToolAdapter 状态（available / unavailable） */
  readonly runtimeFileToolAdapter?: "available" | "unavailable";
  /** shell approval 是否支持（host approval 能拦截 command execution） */
  readonly shellApprovalSupported?: boolean;
  /** Obsidian CLI 探测结果（not-probed / probed-ok / probed-failed） */
  readonly obsidianCliProbe?: "not-probed" | "probed-ok" | "probed-failed";
}

export interface ProviderRuntimeSkillContext {
  readonly managedCodexPlugins: readonly ProviderRuntimeSkillEntry[];
  readonly managedCodexPluginSkills?: readonly ProviderRuntimeSkillEntry[];
  readonly agentSkills: readonly ProviderRuntimeSkillEntry[];
  readonly evidence?: string;
}

export interface ProviderRuntimeSkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly source?: string;
  readonly enabled?: boolean;
}

/**
 * 默认能力（仅作为 fallback，不应作为主路径）。
 *
 * V16.5-D: 主路径（view.ts → buildBridgePromptPackage）必须传入真实 capabilities。
 * 此默认值保留给 legacy 路径与单元测试，obsidianCliAvailable 默认 "unknown"
 * （不臆造可用）。
 */
export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilityInfo = {
  providerNativeFileTools: true,
  bridgeRuntimeFileTools: true,
  shellAvailable: true,
  obsidianCliAvailable: "unknown",
  askUserQuestionAvailable: true,
  evidence: {
    provider: "unknown",
    runtimeFileToolAdapter: "available",
    shellApprovalSupported: true,
    obsidianCliProbe: "not-probed",
  },
};

// ---------- Section 1: Capability Manifest ----------

/**
 * 声明当前 runtime 可用能力与边界（V16.5-D: 事实驱动，文案根据三态派生）。
 *
 * - provider-native file tools / bridge runtime file tools 可用时应优先用于文件操作。
 * - Shell / PowerShell / Bash 可用于高效任务，但需要 host approval。
 * - Obsidian CLI 文案根据 known-available / unknown / known-unavailable 派生。
 * - AskUserQuestion 可用于真实歧义。
 * - Host approval 是 write/delete/command 的最终边界。
 */
export function buildCapabilityManifest(
  _snapshot: StateSnapshot,
  _settings: LLMBridgeSettings,
  capabilities: ProviderCapabilityInfo = DEFAULT_PROVIDER_CAPABILITIES,
): string {
  const lines: string[] = [
    "========== Capability Manifest ==========",
    "- 你运行在 LLM CLI Bridge 中（Obsidian Vault 工作区）。可使用的能力：",
  ];
  if (capabilities.providerNativeFileTools) {
    lines.push("- provider-native file tools（Read/Write/Edit/Glob/Grep 等）：可用；文件操作优先使用。");
  }
  if (capabilities.bridgeRuntimeFileTools) {
    lines.push("- bridge runtime file tools（read-only adapter）：可用；只读文件查询可使用。");
  }
  if (capabilities.shellAvailable) {
    lines.push("- Shell / PowerShell / Bash：可用于高效任务，但 write/delete/command 类操作需要 host approval。");
  }
  // V16.5-D: Obsidian CLI 文案根据三态派生（不臆造可用性）
  const obsidianLine = buildObsidianCliLine(capabilities.obsidianCliAvailable);
  if (obsidianLine) {
    lines.push(obsidianLine);
  }
  if (capabilities.askUserQuestionAvailable) {
    lines.push("- AskUserQuestion：可用于真实歧义（target/scope/operation 不明确时）。");
  }
  const runtimeSkillLines = buildRuntimeSkillCapabilityLines(capabilities.runtimeSkills);
  if (runtimeSkillLines.length > 0) {
    lines.push(...runtimeSkillLines);
  }
  lines.push("- Host approval 是 write/delete/command 的最终安全边界；权限系统会拦截未授权操作。");
  // V16.5-E: Agent Runtime Workspace 事实（简短路径，不堆规则）
  const providerId = capabilities.evidence?.provider ?? "";
  const isCodexManagedProvider = providerId === "codex-managed-app-server" || providerId === "codex-app-server";
  lines.push("- Agent workspace: LLM-AgentRuntime/（sessions/ work/ runtime/ skills/；agent 维护，用户默认不需要编辑）。");
  if (isCodexManagedProvider) {
    lines.push("- Codex Skills: Bridge-managed Skills are materialized into Codex home personal skills before run; they are not injected as prompt capability text.");
  } else {
    lines.push("- Vault Skill source: LLM-AgentRuntime/skills/vault-context/SKILL.md（轻量 vault-runtime 包：边界规则/稳定约定/用户偏好/目录语义）。");
    lines.push("- Runtime Skill target: .claude/skills/vault-context/SKILL.md（物化后 provider 按需识别）。");
  }
  // V2.18 vault-api：声明 Obsidian Plugin API 能力 Skill（obsidian wrapper / helper mjs / HTTP bridge / outbox 调用）
  lines.push("- vault-api Skill: .claude/skills/vault-api/SKILL.md（物化后）。暴露 Obsidian Plugin API 能力（文件系统做不到的）：frontmatter property、tags（清单/反查/改名）、backlinks/outlinks/链接解析/附件、tasks、daily note、search（markdown-aware）、metadataCache 聚合、resolvedLinks 全局图、bookmarks、plugin、setting、命令执行、workspace、clipboard、视图模式、vault 回收站操作。共 29 个 action，详见 SKILL.md。调用通道：obsidian wrapper（推荐，`.llm-bridge/tools/obsidian`，支持 --stdin 绕开 shell 转义 / --raw 管道输出 / --wait 等审批）→ helper mjs → HTTP bridge → outbox actions.jsonl 兜底。普通文件读写仍用 native file tools。");
  lines.push("- Runtime facts: LLM-AgentRuntime/runtime/RUNTIME_FACTS.json（机器事实，不进 prompt）。");
  return lines.join("\n");
}

function buildRuntimeSkillCapabilityLines(context?: ProviderRuntimeSkillContext): string[] {
  if (!context) return [];
  const enabledPlugins = context.managedCodexPlugins.filter((entry) => entry.enabled !== false);
  const enabledPluginSkills = (context.managedCodexPluginSkills || []).filter((entry) => entry.enabled !== false);
  const enabledSkills = context.agentSkills.filter((entry) => entry.enabled !== false);
  if (enabledPlugins.length === 0 && enabledPluginSkills.length === 0 && enabledSkills.length === 0) return [];

  const lines: string[] = [
    "- Runtime Skills / Plugins：以下条目来自 provider-native runtime discovery 或本地 plugin catalog；Bridge Plugin Skills 不通过 prompt 注入。",
  ];
  if (enabledPlugins.length > 0) {
    lines.push("  Managed Codex plugins:");
    for (const plugin of enabledPlugins.slice(0, 24)) {
      const desc = plugin.description ? ` — ${capabilityText(plugin.description, 180)}` : "";
      const source = plugin.source ? ` [${capabilityText(plugin.source, 80)}]` : "";
      lines.push(`  - ${plugin.name} (${plugin.id})${desc}${source}`);
    }
    if (enabledPlugins.length > 24) {
      lines.push(`  - ... ${enabledPlugins.length - 24} more plugin(s) omitted from prompt for size.`);
    }
  }
  if (enabledPluginSkills.length > 0) {
    lines.push("  Plugin-contained Skills:");
    for (const skill of enabledPluginSkills.slice(0, 40)) {
      const desc = skill.description ? ` — ${capabilityText(skill.description, 260)}` : "";
      const source = skill.source ? ` [${capabilityText(skill.source, 100)}]` : "";
      lines.push(`  - ${skill.name} (${skill.id})${desc}${source}`);
    }
    if (enabledPluginSkills.length > 40) {
      lines.push(`  - ... ${enabledPluginSkills.length - 40} more plugin skill(s) omitted from prompt for size.`);
    }
  }
  if (enabledSkills.length > 0) {
    lines.push(`  Bridge Plugin Skills: ${enabledSkills.length} enabled; materialized through provider-native Skill discovery, not listed here.`);
  }
  if (context.evidence) {
    lines.push(`  Evidence: ${capabilityText(context.evidence, 160)}`);
  }
  return lines;
}

function capabilityText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 15)).trim()}...[truncated]`;
}

/**
 * V16.5-D: 根据 Obsidian CLI 可用性三态派生 prompt 文案。
 *
 * - known-available:   "Obsidian CLI: available."
 * - unknown:           "Obsidian CLI: availability unknown; you may probe if useful."
 * - known-unavailable:  "Obsidian CLI: unavailable; use other tools."
 *
 * 不新增行为规则，只写事实。
 */
export function buildObsidianCliLine(availability: ObsidianCliAvailability): string {
  switch (availability) {
    case "known-available":
      return "- Obsidian CLI: available.";
    case "unknown":
      return "- Obsidian CLI: availability unknown; you may probe if useful.";
    case "known-unavailable":
      return "- Obsidian CLI: unavailable; use other tools.";
    default:
      return "";
  }
}

// ---------- Section 2: Autonomy Contract ----------

/**
 * 鼓励 LLM 自主行动，减少反复正文确认。
 *
 * - 用户意图明确时直接行动。
 * - 不要反复正文确认同一个操作。
 * - 上一轮已询问确认，用户明确确认后，应继续执行。
 * - 只有 target/scope/operation 不明确时，才 AskUserQuestion。
 * - 可执行任务优先使用工具，不要只解释。
 */
export function buildAutonomyContract(): string {
  return [
    "========== Autonomy Contract ==========",
    "- 用户意图明确时直接行动，使用工具执行，不要只解释。",
    "- 不要在正文中反复确认同一个操作；上一轮已确认后继续执行。",
    "- 只有 target/scope/operation 不明确时才使用 AskUserQuestion；不要为已明确请求征求多余确认。",
    "- 可执行任务优先使用工具完成，不要仅描述步骤而不执行。",
  ].join("\n");
}

// ---------- Section 3: Safety Boundary Contract ----------

/**
 * write/delete/command 由 host approval 承担最终确认。
 *
 * - write/delete/command 依赖 host approval。
 * - 不要在正文中模拟 approval（不要假装已授权、不要伪造权限结果）。
 * - approval granted 后继续执行；approval denied 后解释并停止。
 * - 高风险不是放弃执行的理由，权限系统负责拦截。
 */
export function buildSafetyBoundaryContract(): string {
  return [
    "========== Safety Boundary Contract ==========",
    "- write/delete/command 类操作依赖 host approval（PermissionBoundary）；不要在正文中模拟授权。",
    "- approval granted 后继续执行；approval denied 后解释原因并停止该操作。",
    "- 高风险不是放弃执行的理由——权限系统会拦截未授权操作；不要因风险高就只解释不执行。",
    "- 不要修改 sensitive paths（.env / token / credentials / .git/config / .obsidian 内部 / .llm-bridge credentials）。",
  ].join("\n");
}

// ---------- 组合入口 ----------

/**
 * 组合三个核心 section 为单一字符串（供 promptPackage builder 复用）。
 *
 * 不包含 vault 根目录/时间戳/attachment policy/output 规则——
 * 这些由调用方在 buildBridgeSystemAppend 中追加。
 */
export function buildPromptContract(
  snapshot: StateSnapshot,
  settings: LLMBridgeSettings,
  capabilities: ProviderCapabilityInfo = DEFAULT_PROVIDER_CAPABILITIES,
): string {
  return [
    buildCapabilityManifest(snapshot, settings, capabilities),
    buildAutonomyContract(),
    buildSafetyBoundaryContract(),
  ].join("\n\n");
}
