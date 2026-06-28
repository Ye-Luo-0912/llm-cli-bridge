// LLM CLI Bridge — Preset Prompts
// V1.1: 常用操作的预设 prompt 构造（纯函数，不依赖 Obsidian，便于单元测试）
// 只生成 prompt 文本，不新增 tool event，不自动注入全文

/**
 * 预设操作类型
 * V1.2 Interaction Foundation: 只保留通用入口，移除强业务模板
 */
export type PresetType = "summarize" | "explain" | "freeform";

/**
 * 预设操作的元数据（label / hint）
 */
export interface PresetMeta {
  readonly type: PresetType;
  readonly label: string;
  readonly hint: string;
}

export const PRESETS: readonly PresetMeta[] = [
  { type: "freeform", label: "自由提问", hint: "清空输入框并聚焦" },
  { type: "explain", label: "解释选区", hint: "解释选中的文本" },
  { type: "summarize", label: "总结当前笔记", hint: "生成摘要笔记到输出目录" },
];

/**
 * 构造预设 prompt
 * - summarize: 总结当前笔记，生成摘要笔记到 outputDir
 * - explain: 解释当前选区
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

  // freeform
  return "";
}

/**
 * 判断预设是否需要活动笔记
 */
export function requiresActiveNote(type: PresetType): boolean {
  return type === "summarize";
}

/**
 * 判断预设是否需要选区
 */
export function requiresSelection(type: PresetType): boolean {
  return type === "explain";
}
