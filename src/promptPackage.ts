// LLM CLI Bridge — Prompt Package Builder
// V0.7: 构建发送给 CLI agent 的最终 prompt，包含状态快照

import type { LLMBridgeSettings } from "./types";

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

  parts.push(`
========== CLI/SDK Native File Handoff ==========
- 当前 Vault 根目录是本轮工作区；Vault 内普通文件可由 Claude Code / Claude SDK 的原生文件能力合理读取、创建或编辑。
- 插件职责是提供上下文、Attachments、Pinned context 和权限边界提示；不要把插件当作自研文件 runtime。
- 不要写入、删除、重命名 Vault 外路径；external read 只有在用户授权后才可作为引用使用。
- 不要修改 sensitive paths，例如 .env、token、credentials、secrets、.ssh、private keys、.git/config、.obsidian 内部配置、.llm-bridge credentials。
- 如需查看附件或 FileRef 中的 image/pdf/binary/unknown 文件，优先使用 Claude Code Read 或 SDK 原生能力读取对应 path；插件不做 OCR、PDF parser 或 base64 注入。`);

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

  // 2. 当前活动笔记（仅当 includeActiveNote=true 且有内容时）
  if (settings.includeActiveNote && snapshot.activeFilePath && snapshot.activeFileContent) {
    const truncated = truncateText(snapshot.activeFileContent, settings.maxActiveNoteChars);
    parts.push(`
========== 当前活动笔记 ==========
路径：${snapshot.activeFilePath}
内容：
${truncated}
`);
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
CLI/Claude Code 路径：如需查看 pdf/binary 或 refs-only 文件，可在权限允许时使用 Claude Code Read 读取对应 path。
SDK 路径：message-scoped 图片/截图可通过 Streaming Input image content block 传入当前消息；PDF/document block 需本地验证稳定后再启用，否则使用 path ref。

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
- 长输出不要直接刷屏（不要在聊天窗口打印完整长文件）
- 按配置或项目规则写入文件（输出位置：${outputLocation}）
- 如果必须输出长内容，写入文件并告知路径`);

  // V2.16-C: Tool steering 指引（V2.17-A: 移到用户请求之前，保持用户请求为最末的干净正文）
  parts.push(`
========== Tool Steering ==========
- 只读请求（查看文件、读取配置、搜索内容）优先使用 Read / Glob / Grep，不要使用 Write / Edit / MultiEdit。
- 读取 manifest.json / package.json / 配置文件等只读任务，不得创建任何 user-visible 文件。
- 找不到文件时必须明确告知用户文件不存在，不要静默创建空文件或猜测内容。
- 仅在用户明确要求创建或修改文件时才使用 Write / Edit。
- 不要为读取操作创建临时文件或中间产物。`);

  // 7. 用户请求（最末，保持干净正文，不被 bridge-native 指令污染）
  parts.push(`
========== 用户请求 ==========
${userInput}`);

  return parts.join("\n");
}
