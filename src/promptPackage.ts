// LLM CLI Bridge — Prompt Package Builder (legacy)
// V0.7: 构建发送给 CLI agent 的最终 prompt，包含状态快照
//
// V16.5-C: 此模块为 legacy fallback — 仅 view.ts 在 CLI preview/log 和 metrics
// 估算场景下使用。runtime/core/promptPackage.ts 是主线 provider-neutral 拆分包。
//
// 为避免两套规则漂移，本模块的核心指令段（native handoff / tool steering / safety）
// 复用 runtime/core/bridgePromptContract.ts 的三个核心 section。
// 本文件只保留 legacy 字符串组装 + 附件/活动笔记/选区等 userPrompt 内容。

import type { LLMBridgeSettings } from "./types";
import {
  buildPromptContract,
  DEFAULT_PROVIDER_CAPABILITIES,
} from "./runtime/core/bridgePromptContract";

/**
 * 状态快照（从 Obsidian 收集）
 */
export interface StateSnapshot {
  vaultPath: string;
  activeFilePath: string | null;
  activeFileContent: string | null;
  selection: string | null;
  fileRefIndex?: PromptFileRefIndexEntry[];
  attachmentTextSnippets?: PromptAttachmentTextSnippet[];
  attachmentPackingPolicy?: {
    smallTextInlineMaxBytes: number;
    smallTextInlineMaxChars: number;
    allowedTextExtensions: string[];
    binaryAsNativeRef: boolean;
    imageAsSdkAttachmentIfSupported: boolean;
    sdkDirectAttachmentSupported: boolean;
    sdkDirectAttachmentEvidence: string;
  };
  timestamp: string;
}

export interface PromptFileRefIndexEntry {
  id: string;
  displayName: string;
  path: string;
  kind: "vault" | "external" | "attachment";
  fileType: "image" | "text" | "markdown" | "json" | "pdf" | "binary" | "unknown";
  scope?: "message" | "pinned" | "session";
  status: "active";
}

export interface PromptAttachmentTextSnippet {
  refId: string;
  displayName: string;
  resolvedPath: string;
  fileType: "text" | "markdown" | "json";
  content: string;
  bytesRead: number;
  maxBytes: number;
  maxChars: number;
  truncated: boolean;
}

/**
 * 截断文本（纯函数，便于测试）
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n...[truncated by LLM CLI Bridge]";
}

/**
 * 构建 Prompt Package
 * - 输入 user message + state snapshot + settings
 * - 输出给 CLI 的最终 prompt
 * - 输出位置由 settings.outputDir 驱动；未配置则按 AGENTS.md / 项目规则
 * - 明确要求不要在聊天窗口打印完整长文档
 */
export function buildPromptPackage(
  userInput: string,
  snapshot: StateSnapshot,
  settings: LLMBridgeSettings,
): string {
  const parts: string[] = [];

  // 1. 基础上下文
  parts.push(`你正在处理一个 Obsidian Vault。

当前 Vault 根目录：${snapshot.vaultPath}
当前时间：${snapshot.timestamp}`);

  // V16.5-C: 核心指令段复用 bridgePromptContract（capability/autonomy/safety）
  // 不再在本文件维护 native handoff / tool steering / safety 的独立规则文本。
  parts.push(buildPromptContract(snapshot, settings, DEFAULT_PROVIDER_CAPABILITIES));

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

  // 2. 当前活动笔记（V16.3: 拆分条件 — 路径始终注入，内容可选，保证 UI 与 prompt 语义一致）
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
      parts.push(`
========== 当前活动笔记 ==========
路径：${snapshot.activeFilePath}
内容：（读取失败，仅提供路径）
`);
    }
  }

  // 3. 选区内容（仅当 includeSelection=true 且有内容时）
  if (settings.includeSelection && snapshot.selection) {
    const truncated = truncateText(snapshot.selection, settings.maxSelectionChars);
    parts.push(`
========== 当前选区内容 ==========
${truncated}
`);
  }

  // 4. FileRef metadata index（只列已授权/用户主动 refs；不包含正文）
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

  // 5. 本轮/Pin 附件（只包含 bounded text snippets，不包含未授权 external 全文）
  // V2.17-A: 调用方可能传入 [ingestResult.snippet] 其中 snippet 为 null（ingestion 被跳过），
  // 这里过滤掉 null/undefined 条目，避免 TypeError；空数组不输出该区。
  const validSnippets = (snapshot.attachmentTextSnippets ?? []).filter((s) => s != null);
  if (validSnippets.length > 0) {
    const snippets = validSnippets.map((snippet, idx) => {
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

  // 6. 输出规则（配置驱动 / 项目约定驱动，不硬编码目录名）
  const configuredDir = settings.outputDir && settings.outputDir.trim().length > 0
    ? settings.outputDir.trim()
    : "";
  const outputLocation = configuredDir
    ? `配置目录 \`${configuredDir}/\``
    : "按 AGENTS.md 或 Vault 项目规则选择输出位置";
  parts.push(`
========== 输出规则 ==========
- 长输出写入文件（输出位置：${outputLocation}），不要在聊天窗口打印完整长文件。`);

  // 7. 用户请求（最末，保持干净正文，不被 bridge-native 指令污染）
  parts.push(`
========== 用户请求 ==========
${userInput}`);

  return parts.join("\n");
}
