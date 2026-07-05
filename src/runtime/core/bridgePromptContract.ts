// LLM CLI Bridge — Minimal Prompt Contract (V16.5-C)
//
// 集中维护 prompt 的三类核心 section：
// 1. buildCapabilityManifest  — 声明当前 runtime 可用能力与边界
// 2. buildAutonomyContract    — 鼓励 LLM 自主行动，减少反复正文确认
// 3. buildSafetyBoundaryContract — write/delete/command 由 host approval 承担
//
// 设计原则：
// - 最小化：每个 section 只描述必要约束，不堆砌细碎规则。
// - provider-neutral：不绑定 SDK/CLI/Codex 的私有字段名。
// - 单一真相源：runtime/core/promptPackage.ts 与 src/promptPackage.ts 都复用本模块，
//   避免两套规则漂移。
// - 不禁止工具：Obsidian CLI / shell / provider-native file tools 都允许使用，
//   只要求在能力不明时通过命令探测或 AskUserQuestion 确认。

import type { LLMBridgeSettings } from "../../types";
import type { StateSnapshot } from "../../promptPackage";

// ---------- Provider 能力信息 ----------

/**
 * 当前 runtime 可用的 provider 能力。
 *
 * 由调用方（view.ts / BridgeSession）根据 backendMode + provider 实际探测结果填充。
 * 默认值保守（true 表示"可用，但不强制"）。
 */
export interface ProviderCapabilityInfo {
  /** provider-native file tools 可用（Read/Write/Edit/Glob/Grep 等） */
  readonly providerNativeFileTools: boolean;
  /** bridge runtime file tools 可用（read-only adapter） */
  readonly bridgeRuntimeFileTools: boolean;
  /** shell / PowerShell / Bash 执行可用（需 host approval） */
  readonly shellAvailable: boolean;
  /** Obsidian CLI 可用（不可臆造；调用方应在能力不明时通过命令探测） */
  readonly obsidianCliAvailable: boolean;
  /** AskUserQuestion 可用于真实歧义 */
  readonly askUserQuestionAvailable: boolean;
}

export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilityInfo = {
  providerNativeFileTools: true,
  bridgeRuntimeFileTools: true,
  shellAvailable: true,
  obsidianCliAvailable: true,
  askUserQuestionAvailable: true,
};

// ---------- Section 1: Capability Manifest ----------

/**
 * 声明当前 runtime 可用能力与边界。
 *
 * - provider-native file tools / bridge runtime file tools 可用时应优先用于文件操作。
 * - Shell / PowerShell / Bash 可用于高效任务，但需要 host approval。
 * - Obsidian CLI 可以使用，但不要臆造；使用前应确认或通过命令探测可用性。
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
  if (capabilities.obsidianCliAvailable) {
    lines.push("- Obsidian CLI：可以使用，但不要臆造可用性；使用前应通过命令探测（如 `--version`）或 AskUserQuestion 确认。");
  }
  if (capabilities.askUserQuestionAvailable) {
    lines.push("- AskUserQuestion：可用于真实歧义（target/scope/operation 不明确时）。");
  }
  lines.push("- Host approval 是 write/delete/command 的最终安全边界；权限系统会拦截未授权操作。");
  return lines.join("\n");
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
