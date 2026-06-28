// LLM CLI Bridge — Preset Prompts
// V1.1: 常用操作的预设 prompt 构造（纯函数，不依赖 Obsidian，便于单元测试）
// 只生成 prompt 文本，不新增 tool event，不自动注入全文

/**
 * 预设操作类型
 */
export type PresetType = "summarize" | "explain" | "organize" | "freeform";

/**
 * 预设操作的元数据（label / hint）
 */
export interface PresetMeta {
  readonly type: PresetType;
  readonly label: string;
  readonly hint: string;
}

export const PRESETS: readonly PresetMeta[] = [
  { type: "summarize", label: "总结当前笔记", hint: "生成摘要笔记到输出目录" },
  { type: "explain", label: "解释当前选区", hint: "解释选中的文本" },
  { type: "organize", label: "整理当前笔记", hint: "整理结构并写回文件" },
  { type: "freeform", label: "自由提问", hint: "清空输入框并聚焦" },
];

/**
 * 构造预设 prompt
 * - summarize: 总结当前笔记，生成摘要笔记到 outputDir
 * - explain: 解释当前选区
 * - organize: 整理当前笔记结构，写回原文件（通过 create_note / append_to_note）
 * - freeform: 返回空字符串（仅聚焦输入框，不生成 prompt）
 *
 * @param type       预设类型
 * @param ctx        上下文（activeFilePath / outputDir）
 * @returns          prompt 文本（freeform 返回空字符串）
 */
export function buildPresetPrompt(
  type: PresetType,
  ctx: { activeFilePath: string | null; outputDir: string },
): string {
  const outputDir = ctx.outputDir && ctx.outputDir.trim().length > 0
    ? ctx.outputDir.trim()
    : "90_AI整理待确认";

  if (type === "summarize") {
    if (!ctx.activeFilePath) {
      return `请总结当前笔记的核心内容，生成一份摘要笔记到 \`${outputDir}/\` 目录下，文件名用原笔记名加 \`-summary\` 后缀，包含适当的 frontmatter。`;
    }
    return `请总结当前笔记 \`${ctx.activeFilePath}\` 的核心内容，生成一份摘要笔记到 \`${outputDir}/\` 目录下，文件名用原笔记名加 \`-summary\` 后缀，包含适当的 frontmatter。`;
  }

  if (type === "explain") {
    // 选区内容由 includeSelection 注入，prompt 只需指令
    return `请解释以上选中文本的含义、背景和关键概念。如有可能，给出相关的延伸阅读建议。`;
  }

  if (type === "organize") {
    if (!ctx.activeFilePath) {
      return `请整理当前笔记的结构：修正标题层级、统一格式、补充缺失的链接和 frontmatter。整理后通过 create_note action 写回原文件位置。`;
    }
    return `请整理当前笔记 \`${ctx.activeFilePath}\` 的结构：修正标题层级、统一格式、补充缺失的链接和 frontmatter。整理后通过 create_note action 写回原文件位置（覆盖原内容）。`;
  }

  // freeform
  return "";
}

/**
 * 判断预设是否需要活动笔记
 */
export function requiresActiveNote(type: PresetType): boolean {
  return type === "summarize" || type === "organize";
}

/**
 * 判断预设是否需要选区
 */
export function requiresSelection(type: PresetType): boolean {
  return type === "explain";
}
