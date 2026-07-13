// LLM CLI Bridge — V2.17-A EffectiveRunPlan 构造器
// 每次运行的单一真相源：CLI 与 SDK 都从同一个 plan 派生 options / env。
// 纯函数，无副作用，便于测试与审计。
//
// V2.17-A Completion:
// - EffectiveRunPlan 拆分为 Base/Claude/Codex 联合类型（去掉 Claude-only 顶层语义）
// - AttachmentPlan 从 count-only 升级到 entry-level（每条附件单独审计 refId/scope/fileType/packing/pathHash/contentHash/reason）

import type {
  AttachmentAuditEntry,
  AttachmentPlan,
  ClaudeEffectiveRunPlan,
  CodexAppServerEffectiveRunPlan,
  EffectiveRunPlan,
  LLMBridgeSettings,
} from "./types";
import type { AttachmentEntry } from "./runtime/core/types";

/**
 * 计算 prompt package 文本哈希（审计用，非加密强度）。
 * 使用 djb2 变体，避免引入 crypto 模块依赖，保证跨环境可移植。
 */
export function computePromptPackageHash(promptPackageText: string): string {
  let hash = 5381;
  for (let i = 0; i < promptPackageText.length; i++) {
    hash = ((hash << 5) + hash + promptPackageText.charCodeAt(i)) | 0;
  }
  // 转为无符号 16 进制，取前 16 位
  const unsigned = hash >>> 0;
  return unsigned.toString(16).padStart(8, "0").slice(0, 16);
}

/**
 * 推断 packing 决策原因（审计用）。
 */
function inferPackingReason(packing: AttachmentEntry["packing"], fileType: AttachmentEntry["fileType"]): string {
  switch (packing) {
    case "inline-snippet":
      return "bounded text ingest (small markdown/text/json → userPrompt inline)";
    case "sdk-streaming-block":
      return `image content block (${fileType} → SDK streaming input)`;
    case "native-ref-only":
      return `${fileType} → native ref only (binary/pdf/large/sensitive, no inline)`;
  }
}

/**
 * 从 AttachmentEntry[] 构造 entry-level 审计条目。
 *
 * pathHash 基于 displayName（跨 run 比对同一附件）；
 * contentHash 基于 refId + bytesRead + truncated（内容版本代理；inline-snippet 有实际 bytesRead，
 * ref-only 记录空串表示未读取内容）。
 */
function toAttachmentAuditEntry(entry: AttachmentEntry): AttachmentAuditEntry {
  return {
    refId: entry.refId,
    scope: entry.scope,
    fileType: entry.fileType,
    packing: entry.packing,
    pathHash: computePromptPackageHash(entry.displayName || entry.refId),
    contentHash: entry.packing === "inline-snippet"
      ? computePromptPackageHash(`${entry.refId}:${entry.bytesRead ?? 0}:${entry.truncated ?? false}`)
      : "",
    reason: inferPackingReason(entry.packing, entry.fileType),
  };
}

/**
 * 从 BridgePromptPackage.attachmentEntries 构造 AttachmentPlan（counts + entry-level 审计）。
 *
 * 所有 provider（claude-sdk/claude-cli/codex-app-server/mock）共用此函数，
 * 保证 attachment 审计跨 provider 一致。
 */
export function buildAttachmentPlan(entries: ReadonlyArray<AttachmentEntry>): AttachmentPlan {
  return {
    messageScopedRefs: entries.filter((e) => e.scope === "message").length,
    pinnedRefs: entries.filter((e) => e.scope === "pinned").length,
    inlineSnippets: entries.filter((e) => e.packing === "inline-snippet").length,
    imageStreamingBlocks: entries.filter((e) => e.packing === "sdk-streaming-block").length,
    nativeRefOnly: entries.filter((e) => e.packing === "native-ref-only").length,
    entries: entries.map(toAttachmentAuditEntry),
  };
}

/**
 * 空 AttachmentPlan（无附件时使用）。
 */
export function emptyAttachmentPlan(): AttachmentPlan {
  return {
    messageScopedRefs: 0,
    pinnedRefs: 0,
    inlineSnippets: 0,
    imageStreamingBlocks: 0,
    nativeRefOnly: 0,
    entries: [],
  };
}

/**
 * 构造 EffectiveRunPlan（按 backend 收窄为 Claude 或 Codex 专用 plan）。
 *
 * CLI 与 SDK 在各自运行入口调用同一函数，保证两边派生自同一真相源。
 * view 层在发送时构造一次，挂到 AgentTask.effectiveRunPlan，两个 backend 都从该 plan 读取。
 *
 * V2.17-A Completion:
 * - backend=sdk|cli → ClaudeEffectiveRunPlan（含 permission/systemPrompt/tools preset）
 * - backend=codex-app-server → CodexAppServerEffectiveRunPlan（含 instructionsSource）
 */
export function buildEffectiveRunPlan(args: {
  backend: "sdk" | "cli" | "codex-app-server";
  settings: LLMBridgeSettings;
  cwd: string;
  promptPackageText: string;
  settingSources: readonly string[];
  skills: readonly string[];
  attachmentPlan: AttachmentPlan;
  approvalProfile?: import("./agentApprovalProfile").AgentApprovalProfile;
  approvalPolicy?: string;
  approvalsReviewer?: string;
  sandbox?: string;
}): EffectiveRunPlan {
  const { backend, settings, cwd, promptPackageText, settingSources, skills, attachmentPlan } = args;
  const base = {
    cwd,
    model: settings.model,
    effort: settings.effortLevel,
    session: {
      continueSession: settings.claudeContinueSession,
      ...(settings.claudeResumeSessionId ? { resumeId: settings.claudeResumeSessionId } : {}),
    },
    settingSources,
    skills,
    promptPackageHash: computePromptPackageHash(promptPackageText),
    attachmentPlan,
    createdAt: new Date().toISOString(),
  };

  if (backend === "codex-app-server") {
    const codexPlan: CodexAppServerEffectiveRunPlan = {
      ...base,
      backend: "codex-app-server",
      // Round 1：Bridge 薄约定走 developerInstructions（见 codexAppServerEffectiveRunPlan.ts）
      instructionsSource: "developerInstructions",
      approvalProfile: args.approvalProfile ?? "ask",
      approvalPolicy: args.approvalPolicy ?? "on-request",
      approvalsReviewer: args.approvalsReviewer ?? "user",
      sandbox: args.sandbox ?? "workspace-write",
      // Round 5: personality/summary 为用户可配置设置（settings 单一真相源），不再硬编码
      personality: settings.codexPersonality ?? "pragmatic",
      reasoningSummary: settings.codexReasoningSummary ?? "auto",
    };
    return codexPlan;
  }

  const claudePlan: ClaudeEffectiveRunPlan = {
    ...base,
    backend,
    permission: settings.claudePermissionMode,
    systemPrompt: { preset: "claude_code" },
    tools: { preset: "claude_code" },
  };
  return claudePlan;
}

/**
 * 将 plan 序列化为可审计的键值行（Developer mode 展示用）。
 *
 * 按 backend 收窄：Claude plan 输出 permission/systemPrompt/tools preset；
 * Codex plan 输出 instructionsSource（无 Claude-only 字段）。
 */
export function formatEffectiveRunPlan(plan: EffectiveRunPlan): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  rows.push({ label: "backend", value: plan.backend });
  rows.push({ label: "cwd", value: plan.cwd });
  rows.push({ label: "model", value: plan.model || "(default)" });
  rows.push({ label: "effort", value: plan.effort || "(default)" });
  // 按 backend 收窄：codex-app-server 走 instructionsSource；codex-sdk 走 sdkConfigSource；sdk/cli 走 Claude preset 字段
  if (plan.backend === "codex-app-server") {
    rows.push({ label: "instructionsSource", value: plan.instructionsSource });
    rows.push({ label: "approvalProfile", value: plan.approvalProfile });
    rows.push({ label: "approvalPolicy", value: plan.approvalPolicy });
    rows.push({ label: "approvalsReviewer", value: plan.approvalsReviewer });
    rows.push({ label: "sandbox", value: plan.sandbox });
    rows.push({ label: "personality", value: plan.personality });
    rows.push({ label: "reasoningSummary", value: plan.reasoningSummary });
  } else if (plan.backend === "codex-sdk") {
    rows.push({ label: "sdkConfigSource", value: plan.sdkConfigSource });
  } else {
    rows.push({ label: "permission", value: plan.permission });
  }
  rows.push({ label: "session", value: plan.session.continueSession ? "continue" : plan.session.resumeId ? `resume:${plan.session.resumeId}` : "fresh" });
  if (plan.backend !== "codex-app-server" && plan.backend !== "codex-sdk") {
    rows.push({ label: "systemPrompt", value: `preset:${plan.systemPrompt.preset}` });
    rows.push({ label: "tools", value: `preset:${plan.tools.preset}` });
  }
  rows.push({ label: "settingSources", value: plan.settingSources.join(",") });
  rows.push({ label: "skills", value: plan.skills.length > 0 ? plan.skills.join(",") : "(none)" });
  rows.push({ label: "promptPackageHash", value: plan.promptPackageHash });
  // entries 可能为空数组或旧 plan 未带，做防御
  const auditEntries = plan.attachmentPlan.entries ?? [];
  rows.push({ label: "attachments", value: `msg=${plan.attachmentPlan.messageScopedRefs} pin=${plan.attachmentPlan.pinnedRefs} inline=${plan.attachmentPlan.inlineSnippets} img=${plan.attachmentPlan.imageStreamingBlocks} native=${plan.attachmentPlan.nativeRefOnly} entries=${auditEntries.length}` });
  // entry-level 审计行（每条附件单独一行）
  for (const entry of auditEntries) {
    rows.push({
      label: `  attachment[${entry.refId}]`,
      value: `${entry.scope}/${entry.fileType}/${entry.packing} path=${entry.pathHash} content=${entry.contentHash || "(empty)"} reason=${entry.reason}`,
    });
  }
  rows.push({ label: "createdAt", value: plan.createdAt });
  return rows;
}
