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
  attachmentTextSnippets?: PromptAttachmentTextSnippet[];
  timestamp: string;
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

  // 4. 用户主动附件（只包含 bounded text snippets，不包含 external working set 全文）
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
========== 用户主动附件（bounded text snippets） ==========
以下内容仅来自用户主动添加的 text / markdown / json 小文件。未授权 external working set 文件不会出现在本区。

${snippets}
`);
  }

  // 5. 输出规则（配置驱动 / 项目约定驱动，不硬编码目录名）
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

  // 6. 用户请求
  parts.push(`
========== 用户请求 ==========
${userInput}`);

  return parts.join("\n");
}
