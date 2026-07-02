// LLM CLI Bridge — V2.17-A EffectiveRunPlan 构造器（续：单一真相源）
// 每次运行的单一真相源：CLI 与 SDK 都从同一个 plan 派生 options / args / env。
// 纯函数，无副作用，便于测试与审计。
//
// V2.17-A 续核心收敛：
// - 新增 buildSdkOptionsFromPlan(plan)：SDK options 完全由 plan 派生，backend 不再读 settings。
// - 新增 buildCliCommandFromPlan(plan, settings)：CLI command args/env 完全由 plan 派生
//   （base command 二进制路径来自 settings，属环境配置；动态 args/env 来自 plan）。
// - 新增 buildAttachmentPlanFromRefs(...)：entry-level 附件审计（refId/scope/fileType/mode/pathHash/contentHash/reason）。
// - buildBridgePromptPackageAudit(...)：BridgePromptPackage 脱敏审计视图写入 plan。
// - Developer mode 展示的 plan 等于真实执行 options/args/env 的脱敏版本。

import * as path from "path";
import type {
  AttachmentEntry,
  AttachmentMode,
  AttachmentPlan,
  BridgePromptPackage,
  BridgePromptPackageAudit,
  EffectiveRunPlan,
  LLMBridgeSettings,
  RuntimeProviderId,
} from "./types";
import type { FileRef } from "./fileRefs";
import type { AttachmentTextSnippet } from "./fileIngestion";
import { providerBackendKind } from "./runtimeProvider";

// ---------- 哈希工具 ----------

/**
 * 计算 prompt package 文本哈希（审计用，非加密强度）。
 * 使用 djb2 变体，避免引入 crypto 模块依赖，保证跨环境可移植。
 */
export function computePromptPackageHash(promptPackageText: string): string {
  let hash = 5381;
  for (let i = 0; i < promptPackageText.length; i++) {
    hash = ((hash << 5) + hash + promptPackageText.charCodeAt(i)) | 0;
  }
  const unsigned = hash >>> 0;
  return unsigned.toString(16).padStart(8, "0").slice(0, 16);
}

/**
 * 路径稳定哈希（审计用）。归一化大小写与分隔符后计算 djb2。
 */
export function computePathHash(resolvedPath: string): string {
  const normalized = resolvedPath.replace(/\\/g, "/").toLowerCase();
  return computePromptPackageHash(normalized);
}

/**
 * 文本内容哈希（inline-snippet 附件审计用）。
 */
export function computeContentHash(content: string): string {
  return computePromptPackageHash(content || "");
}

// ---------- AttachmentPlan entry-level 构造 ----------

/**
 * 判定单个附件的打包模式。
 * - image + active → image-streaming-block（SDK 路径；CLI 回落 native-ref-only）
 * - bounded text type + active → inline-snippet（小文本内联）
 * - 其它（pdf/binary/unknown/超大） → native-ref-only（path ref / native tool）
 */
export function classifyAttachmentMode(
  ref: FileRef,
  inlineSnippetForRef: AttachmentTextSnippet | undefined,
  providerSupportsImageStreaming: boolean,
): { mode: AttachmentMode; reason: string } {
  if (ref.status !== "active") {
    return { mode: "native-ref-only", reason: `ref status=${ref.status}, not active` };
  }
  if (ref.fileType === "image") {
    if (providerSupportsImageStreaming) {
      return { mode: "image-streaming-block", reason: "image ref + provider supports SDK streaming image block" };
    }
    return { mode: "native-ref-only", reason: "image ref but provider does not support streaming; path ref fallback" };
  }
  if (inlineSnippetForRef) {
    return { mode: "inline-snippet", reason: `bounded text (${ref.fileType}) inlined within ${inlineSnippetForRef.maxBytes} bytes` };
  }
  return { mode: "native-ref-only", reason: `${ref.fileType} file remains native ref (no inline snippet)` };
}

/**
 * 从 FileRef + 内联 snippet 构造 entry-level AttachmentEntry。
 */
export function buildAttachmentEntry(
  ref: FileRef,
  inlineSnippetForRef: AttachmentTextSnippet | undefined,
  providerSupportsImageStreaming: boolean,
): AttachmentEntry {
  const { mode, reason } = classifyAttachmentMode(ref, inlineSnippetForRef, providerSupportsImageStreaming);
  return {
    refId: ref.id,
    scope: ref.scope,
    fileType: ref.fileType,
    mode,
    pathHash: computePathHash(ref.resolvedPath),
    contentHash: mode === "inline-snippet" && inlineSnippetForRef
      ? computeContentHash(inlineSnippetForRef.content)
      : "",
    reason,
  };
}

/**
 * 从 promptFileRefs + inlineSnippets 构造完整 AttachmentPlan（entry-level 审计）。
 *
 * @param promptFileRefs 本轮进入 prompt 的所有 FileRef（message + pinned + session active）
 * @param inlineSnippets 已内联的文本 snippet（按 refId 索引）
 * @param messageScopedCount message-scope 附件数（聚合计数）
 * @param pinnedCount pinned 附件数（聚合计数）
 * @param providerSupportsImageStreaming provider 是否支持 SDK image streaming
 */
export function buildAttachmentPlanFromRefs(
  promptFileRefs: ReadonlyArray<FileRef>,
  inlineSnippets: ReadonlyArray<AttachmentTextSnippet>,
  messageScopedCount: number,
  pinnedCount: number,
  providerSupportsImageStreaming: boolean,
): AttachmentPlan {
  const snippetByRefId = new Map<string, AttachmentTextSnippet>();
  for (const s of inlineSnippets) snippetByRefId.set(s.refId, s);

  const entries: AttachmentEntry[] = promptFileRefs.map((ref) =>
    buildAttachmentEntry(ref, snippetByRefId.get(ref.id), providerSupportsImageStreaming),
  );

  const inlineSnippetsCount = entries.filter((e) => e.mode === "inline-snippet").length;
  const imageStreamingBlocks = entries.filter((e) => e.mode === "image-streaming-block").length;
  const nativeRefOnly = entries.filter((e) => e.mode === "native-ref-only").length;

  return {
    messageScopedRefs: messageScopedCount,
    pinnedRefs: pinnedCount,
    inlineSnippets: inlineSnippetsCount,
    imageStreamingBlocks,
    nativeRefOnly,
    entries,
  };
}

// ---------- BridgePromptPackage 审计 ----------

/**
 * 从 BridgePromptPackage 构造脱敏审计视图（写入 EffectiveRunPlan，供 Developer mode 展示）。
 * 不含附件正文，仅含哈希/长度/预览。
 */
export function buildBridgePromptPackageAudit(pkg: BridgePromptPackage): BridgePromptPackageAudit {
  return {
    bridgeSystemAppendHash: computePromptPackageHash(pkg.bridgeSystemAppend),
    bridgeSystemAppendLength: pkg.bridgeSystemAppend.length,
    userPromptLength: pkg.userPrompt.length,
    userPromptPreview: pkg.userPrompt.slice(0, 80),
    attachmentEntryCount: pkg.attachmentEntries.length,
    auditHash: pkg.auditHash,
  };
}

// ---------- EffectiveRunPlan 构造 ----------

/**
 * 构造 EffectiveRunPlan（单一真相源）。
 *
 * CLI 与 SDK 在各自运行入口调用同一函数，保证两边派生自同一真相源。
 * view 层在发送时构造一次，挂到 AgentTask.effectiveRunPlan，provider 从该 plan 读取。
 *
 * V2.17-A 续：
 * - provider 为 canonical 标识；backend 由 provider 派生。
 * - extraArgs 显式进入 plan（不再由 backend 读 settings.claudeExtraArgs）。
 * - bridgePrompt 审计视图可选写入。
 */
export function buildEffectiveRunPlan(args: {
  provider: RuntimeProviderId;
  settings: LLMBridgeSettings;
  cwd: string;
  promptPackageText: string;
  settingSources: readonly string[];
  skills: readonly string[];
  attachmentPlan: AttachmentPlan;
  bridgePrompt?: BridgePromptPackage;
}): EffectiveRunPlan {
  const { provider, settings, cwd, promptPackageText, settingSources, skills, attachmentPlan, bridgePrompt } = args;
  const isCodex = provider === "codex-sdk";
  const plan: EffectiveRunPlan = {
    provider,
    backend: providerBackendKind(provider),
    cwd,
    model: settings.model,
    effort: settings.effortLevel,
    permission: settings.claudePermissionMode,
    session: {
      continueSession: settings.claudeContinueSession,
      ...(settings.claudeResumeSessionId ? { resumeId: settings.claudeResumeSessionId } : {}),
    },
    // Codex 不适用 claude_code preset（空字符串标记不适用）
    systemPrompt: { preset: isCodex ? "" : "claude_code" },
    tools: { preset: isCodex ? "" : "claude_code" },
    settingSources,
    skills,
    // V2.17-A 续: extraArgs 从 settings 解析一次进入 plan，backend 不再直接读
    extraArgs: parseExtraArgs(settings.claudeExtraArgs),
    promptPackageHash: computePromptPackageHash(promptPackageText),
    attachmentPlan,
    ...(bridgePrompt ? { bridgePrompt: buildBridgePromptPackageAudit(bridgePrompt) } : {}),
    createdAt: new Date().toISOString(),
  };
  return plan;
}

/**
 * 解析 extra args 字符串为数组（trim + 按空白拆分，过滤空串）。
 */
export function parseExtraArgs(extraArgs: string): string[] {
  const trimmed = (extraArgs || "").trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/).filter(Boolean);
}

// ---------- SDK options 派生（单一真相源） ----------

/**
 * 从 EffectiveRunPlan 派生 SDK query options（单一真相源）。
 *
 * backend 不再直接读取 settings 中的 model/effort/permission/session/extraArgs；
 * 全部从 plan 派生。canUseTool 回调由 backend 在运行时附加（非 plan 字段）。
 *
 * - effort 使用官方字段（不再用未确认的 reasoningEffort）
 * - 显式 claude_code systemPrompt / tools preset（Codex 时为空字符串，由 codex provider 自行处理）
 * - settingSources / skills 来自 plan
 * - continue/resume/extraArgs 来自 plan
 */
export function buildSdkOptionsFromPlan(plan: EffectiveRunPlan): Record<string, unknown> {
  const isCodex = plan.provider === "codex-sdk";
  const options: Record<string, unknown> = {
    cwd: plan.cwd,
    model: plan.model || undefined,
    // V2.17-A: 使用官方 effort 字段（不再用未确认的 reasoningEffort）
    ...(plan.effort ? { effort: plan.effort } : {}),
    // permission 从 plan 派生（不再读 settings.claudePermissionMode）
    permissionMode: plan.permission,
    // V2.16-G: 打开 SDK partial stream
    includePartialMessages: true,
    // V2.16-H: adaptive thinking summaries
    thinking: { type: "adaptive", display: "summarized" },
  };
  // claude_code preset 仅 claude provider 适用；Codex 由 codexRuntimeProvider 自行处理
  if (!isCodex) {
    options.systemPrompt = { preset: plan.systemPrompt.preset };
    options.tools = { preset: plan.tools.preset };
  }
  // 继续会话（从 plan 派生，不再读 settings）
  if (plan.session.continueSession) {
    options.continue = true;
  } else if (plan.session.resumeId) {
    options.resume = plan.session.resumeId;
  }
  // extra args（从 plan 派生，不再读 settings.claudeExtraArgs）
  if (plan.extraArgs.length > 0) {
    options.extraArgs = [...plan.extraArgs];
  }
  // settingSources / skills 来自 plan
  if (plan.settingSources.length > 0) {
    options.settingSources = [...plan.settingSources];
  }
  if (plan.skills.length > 0) {
    options.skills = [...plan.skills];
  }
  return options;
}

// ---------- CLI command / env 派生（单一真相源） ----------

/**
 * CLI 动态 args（从 plan 派生）：--continue / --resume / --permission-mode / extra args。
 * base command 与 base args 来自 settings（环境配置：claudeCommand / claudeArgs 二进制路径）。
 *
 * backend 不再直接读取 settings 中的 continue/resume/permission/extraArgs。
 */
export function buildCliDynamicArgsFromPlan(plan: EffectiveRunPlan): string[] {
  const args: string[] = [];
  // continue 优先于 resume（从 plan 派生）
  if (plan.session.continueSession) {
    args.push("--continue");
  } else if (plan.session.resumeId) {
    args.push("--resume", plan.session.resumeId);
  }
  // permission-mode（从 plan 派生；default 不加 flag）
  if (plan.permission !== "default") {
    args.push("--permission-mode", plan.permission);
  }
  // extra args（从 plan 派生）
  if (plan.extraArgs.length > 0) {
    args.push(...plan.extraArgs);
  }
  return args;
}

/**
 * 构造 CLI 完整命令行（base command + base args + 动态 args），完全由 plan 派生动态部分。
 *
 * @param plan EffectiveRunPlan（动态 args 来源）
 * @param settings 用于 base command/args（claudeCommand/claudeArgs 二进制路径，环境配置）
 * @returns { command, args } 用于 spawn
 */
export function buildCliCommandFromPlan(
  plan: EffectiveRunPlan,
  settings: LLMBridgeSettings,
): { command: string; args: string[] } {
  const baseCommand = settings.claudeCommand.trim();
  const baseArgsStr = settings.claudeArgs.trim();
  const baseArgs = baseArgsStr.length > 0 ? baseArgsStr.split(/\s+/) : [];
  const dynamicArgs = buildCliDynamicArgsFromPlan(plan);
  return {
    command: baseCommand,
    args: [...baseArgs, ...dynamicArgs],
  };
}

/**
 * 构造 CLI 运行环境变量（model/effort 从 plan 派生，不再读 settings）。
 *
 * @returns env 和诊断用的 envKey 列表（只含 key 名，不含 value）
 */
export function buildCliEnvFromPlan(
  plan: EffectiveRunPlan,
  settings: LLMBridgeSettings,
  cwd: string,
): { env: NodeJS.ProcessEnv; envKeys: string[] } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const envKeys: string[] = [];

  if (settings.agentType === "claude") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveClaudeRuntimeConfig } = require("./claudeRuntimeConfig");
    const runtimeConfig = resolveClaudeRuntimeConfig(cwd, env);
    delete env.ANTHROPIC_CONFIG_DIR;
    if (runtimeConfig.source === "project-json" || runtimeConfig.source === "auto-detected") {
      delete env.CLAUDE_CONFIG_DIR;
    }
    Object.assign(env, runtimeConfig.env);
    envKeys.push(...runtimeConfig.envKeys);

    // V2.17-A 续: model/effort 从 plan 派生（不再读 settings）
    if (plan.model) {
      env.ANTHROPIC_MODEL = plan.model;
      envKeys.push("ANTHROPIC_MODEL");
    }
    if (plan.effort) {
      env.CLAUDE_CODE_EFFORT_LEVEL = plan.effort;
      envKeys.push("CLAUDE_CODE_EFFORT_LEVEL");
    }
  }

  // 增强 PATH（复用 claudeCliBackend 现有逻辑）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildEnhancedPath } = require("./claudeCliBackend");
  const extraPath = buildEnhancedPath(cwd);
  if (extraPath) {
    env.PATH = extraPath + path.delimiter + (env.PATH || "");
    envKeys.push("PATH(enhanced)");
  }

  return { env, envKeys };
}

// ---------- 审计格式化 ----------

/**
 * 将 plan 序列化为可审计的键值行（Developer mode 展示用）。
 * 展示内容等于真实执行 options/args/env 的脱敏版本。
 */
export function formatEffectiveRunPlan(plan: EffectiveRunPlan): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  rows.push({ label: "provider", value: plan.provider });
  rows.push({ label: "backend", value: plan.backend });
  rows.push({ label: "cwd", value: plan.cwd });
  rows.push({ label: "model", value: plan.model || "(default)" });
  rows.push({ label: "effort", value: plan.effort || "(default)" });
  rows.push({ label: "permission", value: plan.permission });
  rows.push({ label: "session", value: plan.session.continueSession ? "continue" : plan.session.resumeId ? `resume:${plan.session.resumeId}` : "fresh" });
  rows.push({ label: "systemPrompt", value: plan.systemPrompt.preset ? `preset:${plan.systemPrompt.preset}` : "(codex: n/a)" });
  rows.push({ label: "tools", value: plan.tools.preset ? `preset:${plan.tools.preset}` : "(codex: n/a)" });
  rows.push({ label: "settingSources", value: plan.settingSources.join(",") });
  rows.push({ label: "skills", value: plan.skills.length > 0 ? plan.skills.join(",") : "(none)" });
  rows.push({ label: "extraArgs", value: plan.extraArgs.length > 0 ? plan.extraArgs.join(" ") : "(none)" });
  rows.push({ label: "promptPackageHash", value: plan.promptPackageHash });
  rows.push({ label: "attachments", value: `msg=${plan.attachmentPlan.messageScopedRefs} pin=${plan.attachmentPlan.pinnedRefs} inline=${plan.attachmentPlan.inlineSnippets} img=${plan.attachmentPlan.imageStreamingBlocks} native=${plan.attachmentPlan.nativeRefOnly} entries=${plan.attachmentPlan.entries.length}` });
  if (plan.bridgePrompt) {
    rows.push({ label: "bridgePrompt.auditHash", value: plan.bridgePrompt.auditHash });
    rows.push({ label: "bridgePrompt.appendLen", value: String(plan.bridgePrompt.bridgeSystemAppendLength) });
    rows.push({ label: "bridgePrompt.userLen", value: String(plan.bridgePrompt.userPromptLength) });
    rows.push({ label: "bridgePrompt.userPreview", value: plan.bridgePrompt.userPromptPreview });
  }
  rows.push({ label: "createdAt", value: plan.createdAt });
  return rows;
}

/**
 * 将 AttachmentPlan entries 序列化为可审计的键值行（Developer mode 展示用）。
 */
export function formatAttachmentEntries(plan: EffectiveRunPlan): Array<{ label: string; value: string }> {
  return plan.attachmentPlan.entries.map((e, i) => ({
    label: `attachment[${i}]`,
    value: `${e.refId} | ${e.scope} | ${e.fileType} | ${e.mode} | path=${e.pathHash} | content=${e.contentHash || "(none)"} | ${e.reason}`,
  }));
}
