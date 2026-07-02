// LLM CLI Bridge — Codex app-server EffectiveRunPlan (V2.17-A Completion)
//
// 从 Bridge Core 的 EffectiveRunPlan + BridgePromptPackage 派生 codex app-server
// 特定的运行参数（thread/start instructions/config、turn/start input/attachments/effort）。
//
// Prompt 拆分映射（task spec §5）：
// - userPrompt → turn/start input（主输入）
// - bridgeSystemAppend → Codex instructions/config/rules 层
//   若 instructions/config/rules 暂不可用，则作为明确的 provider preamble，
//   但必须单独标记来源（source: "bridge-system-append"），不与 userPrompt 混合。
//
// 当前 skeleton：codex app-server schema 尚未稳定，bridgeSystemAppend 默认走 instructions 字段
// （codex app-server 文档中明确支持 instructions 作为 system-level 指令层）。

import type { EffectiveRunPlan, LLMBridgeSettings } from "../../../types";
import type { BridgePromptPackage } from "../../core/types";
import type { RunInput } from "../../core/types";
import { buildAttachmentPlan, buildEffectiveRunPlan, computePromptPackageHash } from "../../../effectiveRunPlan";
import type {
  CodexAttachmentBlock,
  CodexThreadStartParams,
  CodexTurnInputItem,
  CodexTurnStartParams,
} from "./schema";

/**
 * Codex app-server 运行参数（派生自 EffectiveRunPlan + BridgePromptPackage）。
 */
export interface CodexAppServerRunOptions {
  /** thread/start 参数 */
  threadStart: CodexThreadStartParams;
  /** turn/start 参数（threadId 由 provider 在 thread/start 后注入） */
  turnStart: Omit<CodexTurnStartParams, "threadId">;
  /** bridgeSystemAppend 的承载层（审计用：标记它走了哪个 codex 字段） */
  bridgeSystemAppendSource: "instructions" | "config" | "rules" | "provider-preamble";
}

/**
 * 构造 EffectiveRunPlan（codex-app-server backend）。
 *
 * 返回 CodexAppServerEffectiveRunPlan（backend="codex-app-server"），
 * 含 instructionsSource 字段标记 bridgeSystemAppend 走 instructions 层。
 */
export function buildCodexAppServerEffectiveRunPlan(
  input: RunInput,
  settings: LLMBridgeSettings,
): EffectiveRunPlan {
  // attachmentPlan 从 promptPackage.attachmentEntries 聚合（counts + entry-level 审计）
  const attachmentPlan = buildAttachmentPlan(input.promptPackage.attachmentEntries);
  return buildEffectiveRunPlan({
    backend: "codex-app-server",
    settings,
    cwd: input.cwd,
    promptPackageText: input.promptPackage.auditHash,
    settingSources: [], // codex app-server 当前不读 claude skills/setting sources
    skills: [],
    attachmentPlan,
  });
}

/**
 * 从 EffectiveRunPlan + BridgePromptPackage 派生 codex app-server 运行参数。
 *
 * bridgeSystemAppend 映射策略（优先级）：
 * 1. instructions 字段（codex app-server 文档支持）—— 当前默认
 * 2. （未来）config/rules 层 —— 当 schema 生成版本暴露这些字段时切换
 * 3. provider-preamble —— 兜底，作为 turn/start input 头部 preamble，但 source 单独标记
 */
export function buildCodexAppServerRunOptions(
  plan: EffectiveRunPlan,
  promptPackage: BridgePromptPackage,
): CodexAppServerRunOptions {
  // 附件 → codex attachment blocks
  const attachments: CodexAttachmentBlock[] = [];
  for (const entry of promptPackage.attachmentEntries) {
    if (entry.packing === "inline-snippet") {
      // inline snippet 已在 userPrompt 中；不再重复作为 codex attachment
      continue;
    }
    if (entry.packing === "sdk-streaming-block") {
      attachments.push({
        type: "image",
        refId: entry.refId,
      });
    } else if (entry.packing === "native-ref-only") {
      attachments.push({
        type: "file",
        refId: entry.refId,
      });
    }
  }

  // bridgeSystemAppend → instructions（当前默认）
  const bridgeSystemAppendSource: CodexAppServerRunOptions["bridgeSystemAppendSource"] = "instructions";

  const threadStart: CodexThreadStartParams = {
    model: plan.model || undefined,
    instructions: promptPackage.bridgeSystemAppend,
    cwd: plan.cwd,
  };
  if (plan.session?.resumeId) {
    threadStart.resumeSessionId = plan.session.resumeId;
  }

  // turn/start.input 为 content item array（V2.17-A Completion wire 校准）
  const inputItems: CodexTurnInputItem[] = [
    { type: "text", text: promptPackage.userPrompt },
  ];
  // image/file 附件可作为 input item 一并送入（与 attachments 字段互补）
  for (const entry of promptPackage.attachmentEntries) {
    if (entry.packing === "sdk-streaming-block" && entry.fileType === "image") {
      inputItems.push({ type: "image", refId: entry.refId });
    } else if (entry.packing === "native-ref-only") {
      inputItems.push({ type: "file", refId: entry.refId });
    }
  }

  const turnStart: Omit<CodexTurnStartParams, "threadId"> = {
    input: inputItems,
    attachments: attachments.length > 0 ? attachments : undefined,
    effort: plan.effort || undefined,
  };

  return {
    threadStart,
    turnStart,
    bridgeSystemAppendSource,
  };
}

/**
 * 审计哈希（与 plan.promptPackageHash 互验；保证 prompt 拆分跨 provider 一致）。
 */
export function computeCodexRunOptionsAuditHash(options: CodexAppServerRunOptions): string {
  const inputItemsStr = (options.turnStart.input ?? [])
    .map((it) => `${it.type}:${"text" in it ? it.text : it.refId ?? ""}`)
    .join("|");
  const input = [
    options.bridgeSystemAppendSource,
    options.threadStart.instructions ?? "",
    options.threadStart.model ?? "",
    inputItemsStr,
    options.turnStart.effort ?? "",
    (options.turnStart.attachments ?? []).map((a) => `${a.type}:${a.refId ?? ""}`).join("|"),
  ].join("\n---\n");
  return computePromptPackageHash(input);
}
