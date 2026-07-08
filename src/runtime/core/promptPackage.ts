// LLM CLI Bridge — BridgePromptPackage Builder (V2.17-A Completion, V16.5-C slimmed)
//
// Provider-neutral prompt 拆分：把现有 promptPackage.ts 的单一字符串拆为
// bridgeSystemAppend + userPrompt + attachmentEntries + auditHash。
//
// V16.5-C: bridgeSystemAppend 改为组合 bridgePromptContract 的三个核心 section
// （capability / autonomy / safety）+ 简短 attachment/output 提示。
// 不再堆大量细碎规则；规则收敛到 bridgePromptContract.ts 单一真相源。
//
// 拆分原则：
// - bridgeSystemAppend: bridge-native 指令（contract 三段 + attachment policy + output）。
//   所有 provider 都需要，但映射方式不同（SDK append / CLI stdin 头部 / Codex instructions 层）。
// - userPrompt: 用户正文 = vault 上下文 + 活动笔记 + 选区 + FileRef index +
//   attachment inline snippets + 用户请求。各 provider 都作为主输入。
// - attachmentEntries: entry-level 审计，每条附件单独记录 packing 决策。
// - auditHash: 整包哈希，跨 provider 一致性校验。

import type { LLMBridgeSettings } from "../../types";
import type {
  AttachmentEntry,
  BridgePromptPackage,
} from "./types";
import type {
  PromptAttachmentTextSnippet,
  PromptFileRefIndexEntry,
  StateSnapshot,
} from "../../promptPackage";
import { computePromptPackageHash } from "../../effectiveRunPlan";
import {
  buildPromptContract,
  DEFAULT_PROVIDER_CAPABILITIES,
} from "./bridgePromptContract";
import type { ProviderCapabilityInfo } from "./bridgePromptContract";

// ---------- Bridge System Append（bridge-native 指令） ----------

/**
 * bridge-native 指令段（所有 provider 共享，映射方式不同）。
 *
 * V16.5-C: 改为组合 bridgePromptContract 的三个核心 section + 简短 attachment/output 提示。
 * 不再堆大量细碎规则（旧 native handoff / tool steering 已被 contract 覆盖）。
 */
export function buildBridgeSystemAppend(
  settings: LLMBridgeSettings,
  snapshot: StateSnapshot,
  capabilities: ProviderCapabilityInfo = DEFAULT_PROVIDER_CAPABILITIES,
): string {
  const parts: string[] = [];

  // 基础上下文（vault + 时间）
  parts.push(`你正在处理一个 Obsidian Vault。

当前 Vault 根目录：${snapshot.vaultPath}
当前时间：${snapshot.timestamp}`);

  // V16.5-C: 核心契约三段（capability / autonomy / safety）
  parts.push(buildPromptContract(snapshot, settings, capabilities));

  // 简短 attachment policy（保留运行时配置信息，规则由 contract 承担）
  if (snapshot.attachmentPackingPolicy) {
    const policy = snapshot.attachmentPackingPolicy;
    parts.push(`
========== Attachment Packing Policy ==========
- message-scoped small text/markdown/json attachments are packed inline only for the current run.
- Inline limits: ${policy.smallTextInlineMaxBytes} bytes / ${policy.smallTextInlineMaxChars} chars.
- Allowed inline extensions: ${policy.allowedTextExtensions.join(", ")}.
- Binary/PDF/unknown files remain native refs: ${policy.binaryAsNativeRef ? "yes" : "no"}.
- Image native SDK attachment: ${policy.sdkDirectAttachmentSupported && policy.imageAsSdkAttachmentIfSupported ? "available" : "unavailable; use path ref"}.
- SDK attachment evidence: ${policy.sdkDirectAttachmentEvidence}`);
  }

  // 简短输出规则（保留配置驱动信息）
  const configuredDir = settings.outputDir && settings.outputDir.trim().length > 0
    ? settings.outputDir.trim()
    : "";
  const outputLocation = configuredDir
    ? `配置目录 \`${configuredDir}/\``
    : "按 AGENTS.md 或 Vault 项目规则选择输出位置";
  parts.push(`
========== 输出规则 ==========
- 长输出写入文件（输出位置：${outputLocation}），不要在聊天窗口打印完整长文件。`);

  return parts.join("\n");
}

// ---------- User Prompt（用户正文） ----------

/**
 * 用户正文：vault 上下文 + 活动笔记 + 选区 + FileRef index + attachment snippets + 用户请求。
 *
 * 不含 bridge-native 指令（那些在 bridgeSystemAppend）。各 provider 把 userPrompt
 * 作为主输入（SDK prompt / CLI stdin 主体 / Codex turn/start input）。
 */
export function buildUserPrompt(
  userInput: string,
  snapshot: StateSnapshot,
  settings: LLMBridgeSettings,
): string {
  const parts: string[] = [];

  // 1. 当前活动笔记
  // V16.3: 拆分条件 — includeActiveNote && activeFilePath 始终注入路径；
  // activeFileContent 非空时再追加内容。修复"UI 显示 attached 但 prompt 未注入路径"的语义不一致。
  if (settings.includeActiveNote && snapshot.activeFilePath) {
    if (snapshot.activeFileContent) {
      const truncated = truncateText(snapshot.activeFileContent, settings.maxActiveNoteChars);
      parts.push(`
========== 当前活动笔记 ==========
路径：${snapshot.activeFilePath}
内容：
${truncated}
`);
    } else {
      // 内容读取失败：仍注入路径，让模型知道当前活动笔记是什么（语义一致）
      parts.push(`
========== 当前活动笔记 ==========
路径：${snapshot.activeFilePath}
内容：（读取失败，仅提供路径）
`);
    }
  }

  // 2. 选区内容
  if (settings.includeSelection && snapshot.selection) {
    const truncated = truncateText(snapshot.selection, settings.maxSelectionChars);
    parts.push(`
========== 当前选区内容 ==========
${truncated}
`);
  }

  // 3. FileRef metadata index
  const messageRefs = snapshot.fileRefIndex?.filter((ref) => (ref.scope || "message") === "message") ?? [];
  const pinnedRefs = snapshot.fileRefIndex?.filter((ref) => ref.scope === "pinned") ?? [];
  const sessionRefs = snapshot.fileRefIndex?.filter((ref) => ref.scope === "session") ?? [];
  if (snapshot.fileRefIndex && snapshot.fileRefIndex.length > 0) {
    const rowsFor = (refs: PromptFileRefIndexEntry[]) => refs.map((ref, idx) =>
      `${idx + 1}. ${ref.displayName} | kind=${ref.kind} | scope=${ref.scope || "message"} | type=${ref.fileType} | status=${ref.status} | path=${ref.path}`
    ).join("\n");
    parts.push(`
========== FileRef Metadata Index ==========
以下是已授权或用户主动添加的文件引用索引，只包含 metadata，不包含文件正文。pending / denied / 未授权 external refs 不会出现在本区。

--- Message attachment refs (current run only) ---
${messageRefs.length > 0 ? rowsFor(messageRefs) : "(none)"}

--- Pinned context refs (persist across runs until unpinned) ---
${pinnedRefs.length > 0 ? rowsFor(pinnedRefs) : "(none)"}

--- Session authorization refs (permission state; not automatically inline) ---
${sessionRefs.length > 0 ? rowsFor(sessionRefs) : "(none)"}
`);
  }

  // 4. attachment inline snippets
  if (snapshot.attachmentTextSnippets && snapshot.attachmentTextSnippets.length > 0) {
    const snippets = snapshot.attachmentTextSnippets.map((snippet, idx) => {
      const marker = snippet.truncated ? "\n...[attachment truncated by LLM CLI Bridge]" : "";
      return `--- Attachment ${idx + 1}: ${snippet.displayName} ---
type: ${snippet.fileType}
path: ${snippet.resolvedPath}
bytesRead: ${snippet.bytesRead}/${snippet.maxBytes}
charsIncluded: ${snippet.content.length}/${snippet.maxChars}
truncated: ${snippet.truncated ? "yes" : "no"}

${snippet.content}${marker}`;
    }).join("\n\n");
    parts.push(`
========== Message Attachments Inline（bounded text snippets） ==========
以下内容仅来自本轮 message-scoped 或 pinned 的 text / markdown / json 小文件。普通 message 附件只进入当前 run；未授权 external 文件不会出现在本区。

${snippets}
`);
  }

  // 5. 用户请求（最末，保持干净正文）
  parts.push(`
========== 用户请求 ==========
${userInput}`);

  return parts.join("\n");
}

// ---------- Attachment Entries（entry-level 审计） ----------

/**
 * 从 snapshot 构造附件条目列表（entry-level 审计）。
 *
 * 每条附件单独记录 packing 决策：
 * - inline-snippet:      小文本/markdown/json 内联
 * - sdk-streaming-block: 图片走 SDK/Codex streaming image block
 * - native-ref-only:     binary/pdf/unknown 仅 path ref
 */
export function buildAttachmentEntries(snapshot: StateSnapshot): AttachmentEntry[] {
  const entries: AttachmentEntry[] = [];
  const refIndex = snapshot.fileRefIndex ?? [];
  const snippets = snapshot.attachmentTextSnippets ?? [];
  const snippetRefIds = new Set(snippets.map((s) => s.refId));

  for (const ref of refIndex) {
    const isImage = ref.fileType === "image";
    const isInlineText = snippetRefIds.has(ref.id);
    let packing: AttachmentEntry["packing"];
    if (isInlineText) {
      packing = "inline-snippet";
    } else if (isImage) {
      // 图片走 SDK streaming block（policy 支持时）；CLI 退化为 native-ref-only
      packing = "sdk-streaming-block";
    } else {
      packing = "native-ref-only";
    }
    const snippet = snippets.find((s) => s.refId === ref.id);
    entries.push({
      refId: ref.id,
      displayName: ref.displayName,
      resolvedPath: ref.path,
      kind: ref.kind,
      scope: (ref.scope || "message") as AttachmentEntry["scope"],
      fileType: ref.fileType,
      packing,
      bytesRead: snippet?.bytesRead,
      truncated: snippet?.truncated,
    });
  }
  return entries;
}

// ---------- BridgePromptPackage 构造器 ----------

/**
 * 构造 BridgePromptPackage（provider-neutral prompt 拆分包）。
 *
 * view 层在发送时构造一次，所有 provider 从同一包派生自己的 instructions/prompt/input。
 * auditHash 用于跨 provider 一致性审计。
 *
 * V16.5-D: 增加可选 capabilities 参数。主路径（view.ts）必须传入从 runtime/provider
 * /preflight 派生的真实 capabilities；未传入时降级为 DEFAULT_PROVIDER_CAPABILITIES（fallback）。
 */
export function buildBridgePromptPackage(
  userInput: string,
  snapshot: StateSnapshot,
  settings: LLMBridgeSettings,
  capabilities?: ProviderCapabilityInfo,
): BridgePromptPackage {
  const bridgeSystemAppend = buildBridgeSystemAppend(settings, snapshot, capabilities);
  const userPrompt = buildUserPrompt(userInput, snapshot, settings);
  const attachmentEntries = buildAttachmentEntries(snapshot);
  // auditHash 基于 bridgeSystemAppend + userPrompt + attachmentEntries（跨 provider 一致）
  const auditHashInput = bridgeSystemAppend + "\n---\n" + userPrompt + "\n---\n" +
    attachmentEntries.map((e) => `${e.refId}:${e.packing}`).join("|");
  const auditHash = computePromptPackageHash(auditHashInput);
  return {
    bridgeSystemAppend,
    userPrompt,
    attachmentEntries,
    auditHash,
  };
}

// ---------- 工具函数 ----------

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n...[truncated by LLM CLI Bridge]";
}
