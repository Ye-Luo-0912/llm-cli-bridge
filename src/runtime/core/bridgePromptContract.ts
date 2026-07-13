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
// - 单一真相源：runtime/core/promptPackage.ts 复用本模块（Round 5: legacy src/promptPackage.ts 已删除）。
// - 事实驱动：capability 文案根据真实 facts 派生，不写"未知但可用"的矛盾文案。

import type { LLMBridgeSettings } from "../../types";
import type { StateSnapshot } from "./types";

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
  // Round 1：常驻 Capability Manifest 压到 5–8 条 Obsidian / Bridge 边界规则。
  // Agent workspace 细则、Skill 包结构、vault-api action 清单留给对应 Skill。
  const lines: string[] = [
    "========== Capability Manifest ==========",
    "- 你运行在 LLM CLI Bridge 中（Obsidian Vault 工作区）；以当前 vault / Agent Runtime 为工作边界。",
  ];
  if (capabilities.providerNativeFileTools || capabilities.bridgeRuntimeFileTools) {
    lines.push("- 文件操作优先使用 provider-native / bridge runtime file tools；不要臆造未声明的工具。");
  }
  if (capabilities.shellAvailable) {
    lines.push("- Shell 可用于高效任务；write/delete/command 需 host approval。");
  }
  lines.push("- Skills 按需加载（vault-context / vault-api 等）；细节以 Skill 正文为准，不要把未读 Skill 当已知事实。");
  lines.push("- Vault Plugin API 走 vault-api Skill / obsidian-bridge wrapper；不要假装拥有未暴露的 Obsidian API。");
  if (capabilities.askUserQuestionAvailable) {
    lines.push("- 仅在 target/scope/operation 不明确时使用 AskUserQuestion。");
  }
  lines.push("- Host approval 是 write/delete/command 的最终安全边界；禁止在正文中伪造授权结果。");
  const providerId = capabilities.evidence?.provider ?? "";
  if (providerId === "codex-managed-app-server" || providerId === "codex-app-server") {
    lines.push("- Codex Skills：Bridge 管理的 Skills 在 run 前物化到 Codex home；不通过 prompt 注入完整清单。");
  }
  return lines.join("\n");
}

/**
 * Round 1：Codex developerInstructions 薄层（5–8 条 Obsidian 约定）。
 * 不包含模型基础指令；模型能力以 managed runtime 为准。
 */
export const CODEX_DEVELOPER_INSTRUCTIONS_META = {
  id: "codex-obsidian-developer",
  version: "1",
} as const;

export function buildCodexDeveloperInstructions(vaultPath: string): string {
  const root = (vaultPath || "").trim() || "(vault root)";
  return [
    "LLM CLI Bridge — Obsidian developer instructions:",
    `- Workspace root is the Obsidian vault: ${root}`,
    "- Stay within the vault / Agent Runtime workspace unless the user explicitly asks otherwise.",
    "- Prefer provider-native tools and Skills; load Skills on demand — do not invent tools or APIs.",
    "- Vault Plugin API work goes through the vault-api Skill / obsidian-bridge wrapper when needed.",
    "- write/delete/command require host approval; never fake approval outcomes in text.",
    "- Act when intent is clear; ask only when target/scope/operation is ambiguous.",
    "- Do not claim capabilities that are not available in the current managed runtime.",
  ].join("\n");
}

/**
 * V2.18 r4: Obsidian CLI 降级 — 三态声明已废弃。
 *
 * 外部 Obsidian CLI 不再作为独立能力声明。Vault API 操作统一走
 * obsidian-bridge wrapper（详见 vault-api Skill）。本函数保留签名供
 * legacy/测试引用，但不再产出三态文案，统一返回空串。
 *
 * 调用方应改用 buildCapabilityManifest 内联的降级声明。
 */
export function buildObsidianCliLine(_availability: ObsidianCliAvailability): string {
  return "";
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
