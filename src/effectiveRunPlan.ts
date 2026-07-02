// LLM CLI Bridge — V2.17-A EffectiveRunPlan 构造器
// 每次运行的单一真相源：CLI 与 SDK 都从同一个 plan 派生 options / env。
// 纯函数，无副作用，便于测试与审计。

import type { AttachmentPlan, EffectiveRunPlan, LLMBridgeSettings } from "./types";

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
 * 构造 EffectiveRunPlan。
 *
 * CLI 与 SDK 在各自运行入口调用同一函数，保证两边派生自同一真相源。
 * view 层在发送时构造一次，挂到 AgentTask.effectiveRunPlan，两个 backend 都从该 plan 读取。
 */
export function buildEffectiveRunPlan(args: {
  backend: "sdk" | "cli";
  settings: LLMBridgeSettings;
  cwd: string;
  promptPackageText: string;
  settingSources: readonly string[];
  skills: readonly string[];
  attachmentPlan: AttachmentPlan;
}): EffectiveRunPlan {
  const { backend, settings, cwd, promptPackageText, settingSources, skills, attachmentPlan } = args;
  const plan: EffectiveRunPlan = {
    backend,
    cwd,
    model: settings.model,
    effort: settings.effortLevel,
    permission: settings.claudePermissionMode,
    session: {
      continueSession: settings.claudeContinueSession,
      ...(settings.claudeResumeSessionId ? { resumeId: settings.claudeResumeSessionId } : {}),
    },
    systemPrompt: { preset: "claude_code" },
    tools: { preset: "claude_code" },
    settingSources,
    skills,
    promptPackageHash: computePromptPackageHash(promptPackageText),
    attachmentPlan,
    createdAt: new Date().toISOString(),
  };
  return plan;
}

/**
 * 将 plan 序列化为可审计的键值行（Developer mode 展示用）。
 */
export function formatEffectiveRunPlan(plan: EffectiveRunPlan): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  rows.push({ label: "backend", value: plan.backend });
  rows.push({ label: "cwd", value: plan.cwd });
  rows.push({ label: "model", value: plan.model || "(default)" });
  rows.push({ label: "effort", value: plan.effort || "(default)" });
  rows.push({ label: "permission", value: plan.permission });
  rows.push({ label: "session", value: plan.session.continueSession ? "continue" : plan.session.resumeId ? `resume:${plan.session.resumeId}` : "fresh" });
  rows.push({ label: "systemPrompt", value: `preset:${plan.systemPrompt.preset}` });
  rows.push({ label: "tools", value: `preset:${plan.tools.preset}` });
  rows.push({ label: "settingSources", value: plan.settingSources.join(",") });
  rows.push({ label: "skills", value: plan.skills.length > 0 ? plan.skills.join(",") : "(none)" });
  rows.push({ label: "promptPackageHash", value: plan.promptPackageHash });
  rows.push({ label: "attachments", value: `msg=${plan.attachmentPlan.messageScopedRefs} pin=${plan.attachmentPlan.pinnedRefs} inline=${plan.attachmentPlan.inlineSnippets} img=${plan.attachmentPlan.imageStreamingBlocks} native=${plan.attachmentPlan.nativeRefOnly}` });
  rows.push({ label: "createdAt", value: plan.createdAt });
  return rows;
}
