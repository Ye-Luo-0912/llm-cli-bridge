// LLM CLI Bridge — Codex app-server EffectiveRunPlan (Round 1)
//
// 从 Bridge Core 的 EffectiveRunPlan + BridgePromptPackage 派生 codex app-server
// 特定的运行参数（thread/start developerInstructions、turn/start input/effort）。
//
// Prompt 拆分映射（Round 1）：
// - userPrompt → turn/start input（主输入）
// - Bridge 薄 Obsidian 约定 → developerInstructions（不覆盖模型 baseInstructions）
// - 模型基础指令由 managed runtime 自行选择（不传 baseInstructions）

import type { EffectiveRunPlan, LLMBridgeSettings } from "../../../types";
import { pathToFileURL } from "url";
import type { BridgePromptPackage } from "../../core/types";
import type { RunInput } from "../../core/types";
import { buildAttachmentPlan, buildEffectiveRunPlan, computePromptPackageHash } from "../../../effectiveRunPlan";
import {
  isAgentApprovalProfile,
  mapAgentApprovalProfileToCodex,
  migrateLegacyPermissionToApprovalProfile,
  type AgentApprovalProfile,
} from "../../../agentApprovalProfile";
import {
  buildCodexDeveloperInstructions,
  CODEX_DEVELOPER_INSTRUCTIONS_META,
} from "../../core/bridgePromptContract";
import type {
  CodexClientCapabilities,
  CodexClientInfo,
  CodexInitializeParams,
  CodexThreadConfig,
  CodexThreadStartParams,
  CodexTurnInputItem,
  CodexTurnStartParams,
} from "./schema";

/**
 * Codex app-server 运行参数（派生自 EffectiveRunPlan + BridgePromptPackage）。
 */
export interface CodexAppServerRunOptions {
  /** initialize 请求参数（clientInfo + capabilities，官方 shape） */
  initialize: CodexInitializeParams;
  /** thread/start 参数（config 容器，不再塞 resumeSessionId） */
  threadStart: CodexThreadStartParams;
  /** turn/start 参数（threadId 由 provider 在 thread/start 后注入） */
  turnStart: Omit<CodexTurnStartParams, "threadId">;
  /** Bridge 薄指令的承载层（审计用） */
  bridgeSystemAppendSource: "developerInstructions" | "instructions" | "config" | "rules" | "provider-preamble";
  /** experimentalApi 是否启用（审计用；默认 false） */
  experimentalApi: boolean;
  /** developer 层装配元数据（开发模式日志：id/version/chars，不默认打印全文） */
  developerInstructionsMeta?: {
    id: string;
    version: string;
    chars: number;
  };
}

const CLIENT_NAME = "llm-cli-bridge";
const CLIENT_TITLE = "LLM CLI Bridge";
const CLIENT_VERSION = "2.17-A";

function localFileUrl(resolvedPath: string | undefined): string | null {
  if (!resolvedPath) return null;
  try {
    return pathToFileURL(resolvedPath).href;
  } catch {
    return null;
  }
}

/**
 * 构造 EffectiveRunPlan（codex-app-server backend）。
 */
export function buildCodexAppServerEffectiveRunPlan(
  input: RunInput,
  settings: LLMBridgeSettings,
): EffectiveRunPlan {
  const attachmentPlan = buildAttachmentPlan(input.promptPackage.attachmentEntries);
  const profile: AgentApprovalProfile = isAgentApprovalProfile(settings.agentApprovalProfile)
    ? settings.agentApprovalProfile
    : migrateLegacyPermissionToApprovalProfile(settings.claudePermissionMode);
  const wire = mapAgentApprovalProfileToCodex(profile, input.cwd);
  return buildEffectiveRunPlan({
    backend: "codex-app-server",
    settings,
    cwd: input.cwd,
    // Round 5: Codex 审计哈希基于实际 wire 层（developerInstructions + userPrompt），
    // 不再用旧 bridgeSystemAppend 整包哈希冒充 Codex 收到的内容。
    promptPackageText: computePromptPackageHash([
      "developerInstructions",
      buildCodexDeveloperInstructions(input.cwd),
      input.promptPackage.userPrompt,
      `model=${settings.model ?? ""}`,
      `effort=${settings.effortLevel ?? ""}`,
      `personality=${settings.codexPersonality ?? "pragmatic"}`,
      `summary=${settings.codexReasoningSummary ?? "auto"}`,
      input.promptPackage.attachmentEntries.map((e) => `${e.refId}:${e.packing}`).join("|"),
    ].join("\n---\n")),
    settingSources: [],
    skills: [],
    attachmentPlan,
    approvalProfile: profile,
    approvalPolicy: wire.approvalPolicy,
    approvalsReviewer: wire.approvalsReviewer,
    sandbox: wire.sandbox,
  });
}

/**
 * 从 EffectiveRunPlan + BridgePromptPackage 派生 codex app-server 运行参数。
 *
 * Round 1：developerInstructions = 薄 Obsidian 约定；不设置 baseInstructions。
 */
export function buildCodexAppServerRunOptions(
  plan: EffectiveRunPlan,
  promptPackage: BridgePromptPackage,
  opts?: { experimentalApi?: boolean; supportsPersonality?: boolean },
): CodexAppServerRunOptions {
  const experimentalApi = !!opts?.experimentalApi;
  // V20.10: personality 按 supportsPersonality 门控 — 模型不支持时发 "none"
  const supportsPersonality = opts?.supportsPersonality !== false;

  const clientInfo: CodexClientInfo = {
    name: CLIENT_NAME,
    title: CLIENT_TITLE,
    version: CLIENT_VERSION,
  };
  const capabilities: CodexClientCapabilities = {
    experimentalApi,
  };
  const initialize: CodexInitializeParams = {
    clientInfo,
    capabilities,
    cwd: plan.cwd,
  };

  const bridgeSystemAppendSource: CodexAppServerRunOptions["bridgeSystemAppendSource"] = "developerInstructions";
  const developerInstructions = buildCodexDeveloperInstructions(plan.cwd);
  const developerInstructionsMeta = {
    id: CODEX_DEVELOPER_INSTRUCTIONS_META.id,
    version: CODEX_DEVELOPER_INSTRUCTIONS_META.version,
    chars: developerInstructions.length,
  };

  const threadConfig: CodexThreadConfig = plan.model ? { model: plan.model } : {};
  // Round 1：thread/start 恒为新建 thread（"startup"|"clear" 为 generated ThreadStartSource
  // 仅有的两个取值；resume 走独立的 thread/resume RPC，不在 thread/start.sessionStartSource
  // 内表达"续接"语义），故此处恒为 "clear"，不再依赖 continueSession 分支。
  const approvalProfile: AgentApprovalProfile = plan.backend === "codex-app-server" && isAgentApprovalProfile(plan.approvalProfile)
    ? plan.approvalProfile
    : "ask";
  const approvalWire = mapAgentApprovalProfileToCodex(approvalProfile, plan.cwd);
  // Round 5: personality/reasoningSummary 来自用户设置（settings.codexPersonality/codexReasoningSummary），
  // 经 CodexAppServerEffectiveRunPlan 传递（单一真相源），不再硬编码。
  // V20.10: 按 supportsPersonality 门控 — 模型不支持时 personality="none"
  const userPersonality = plan.backend === "codex-app-server" ? plan.personality : "pragmatic";
  const personality = supportsPersonality ? userPersonality : "none";
  const reasoningSummary = plan.backend === "codex-app-server" ? plan.reasoningSummary : "auto";
  const threadStart: CodexThreadStartParams = {
    config: threadConfig,
    cwd: plan.cwd,
    model: plan.model,
    // Round 1：不传 baseInstructions；Bridge 薄规则走 developerInstructions
    developerInstructions,
    approvalPolicy: approvalWire.approvalPolicy,
    approvalsReviewer: approvalWire.approvalsReviewer,
    sandbox: approvalWire.sandbox,
    personality,
    ephemeral: false,
    sessionStartSource: "clear",
  };

  const inputItems: CodexTurnInputItem[] = [
    { type: "text", text: promptPackage.userPrompt, text_elements: [] },
  ];
  for (const entry of promptPackage.attachmentEntries) {
    if (entry.packing === "sdk-streaming-block" && entry.fileType === "image") {
      // localFileUrl 仅用于校验 path 能解析出有效 file:// URL（wire 上只发 path 字段，
      // generated UserInput.localImage 不含 refId/url）。
      const url = localFileUrl(entry.resolvedPath);
      if (url) {
        inputItems.push({ type: "localImage", path: entry.resolvedPath });
      }
    }
  }

  const turnStart: Omit<CodexTurnStartParams, "threadId"> = {
    input: inputItems,
    effort: plan.effort || undefined,
    model: plan.model || undefined,
    personality,
    summary: reasoningSummary,
    approvalPolicy: approvalWire.approvalPolicy,
    approvalsReviewer: approvalWire.approvalsReviewer,
    sandboxPolicy: approvalWire.sandboxPolicy,
  };

  return {
    initialize,
    threadStart,
    turnStart,
    bridgeSystemAppendSource,
    experimentalApi,
    developerInstructionsMeta,
  };
}

/**
 * 审计哈希（与 plan.promptPackageHash 互验；保证 prompt 拆分跨 provider 一致）。
 */
export function computeCodexRunOptionsAuditHash(options: CodexAppServerRunOptions): string {
  const inputItems = options.turnStart.input ?? [];
  const inputItemsStr = inputItems
    .map((it) => {
      switch (it.type) {
        case "text": return `${it.type}:${it.text}`;
        case "skill": return `${it.type}:${it.name}`;
        case "mention": return `${it.type}:${it.name}:${it.path}`;
        case "image": return `${it.type}:${it.url}`;
        case "localImage": return `${it.type}:${it.path}`;
        default: return `${(it as { type: string }).type}`;
      }
    })
    .join("|");
  const capabilitiesStr = JSON.stringify(options.initialize.capabilities ?? {});
  const configStr = JSON.stringify(options.threadStart.config ?? {});
  // Round 5: attachments 走 turn/start.input 的 localImage/mention 条目（非独立 attachments 字段），
  // 用条目数审计取代 Round 1 遗留的静态 "disabled" 标记（该标记已不反映真实 wire 行为）。
  const attachmentsAudit = `attachments=input(${inputItems.length - 1 >= 0 ? inputItems.length - 1 : 0})`;
  const input = [
    options.bridgeSystemAppendSource,
    options.experimentalApi ? "experimentalApi=true" : "experimentalApi=false",
    capabilitiesStr,
    options.initialize.clientInfo.name,
    options.initialize.clientInfo.version,
    options.threadStart.developerInstructions ?? "",
    configStr,
    `approvalPolicy=${options.threadStart.approvalPolicy ?? ""}`,
    `approvalsReviewer=${options.threadStart.approvalsReviewer ?? ""}`,
    `sandbox=${options.threadStart.sandbox ?? ""}`,
    `turnApprovalPolicy=${options.turnStart.approvalPolicy ?? ""}`,
    `turnApprovalsReviewer=${options.turnStart.approvalsReviewer ?? ""}`,
    `turnSandboxPolicy=${JSON.stringify(options.turnStart.sandboxPolicy ?? {})}`,
    `turnModel=${options.turnStart.model ?? ""}`,
    `turnPersonality=${options.turnStart.personality ?? ""}`,
    `turnSummary=${options.turnStart.summary ?? ""}`,
    inputItemsStr,
    options.turnStart.effort ?? "",
    attachmentsAudit,
  ].join("\n---\n");
  return computePromptPackageHash(input);
}
