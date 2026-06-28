// LLM CLI Bridge — Skills Entry (V2.0)
// 从 Vault 内 Markdown 文件读取 skills 列表，展示并插入 prompt
// Skills 默认只做 prompt 增强：不新增 tool event，不直接执行危险操作
// 纯函数解析 + 文件读取分离，便于单元测试

import * as fs from "fs";
import * as path from "path";

/** Skills 配置文件相对 Vault 根的路径 */
export const SKILLS_FILE_REL = ".llm-bridge/skills.md";

/**
 * 单个 Skill 定义
 * - name: 显示名（来自 ## 标题）
 * - description: 简短描述（标题后第一段非空文本）
 * - prompt: 插入到输入框的 prompt 模板（描述后的正文）
 */
export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
}

/**
 * 从 Markdown 文本解析 skills 列表（纯函数，便于单元测试）
 *
 * 格式约定：
 *   # Skills          （顶层标题，忽略）
 *
 *   ## 总结笔记        （skill 名称）
 *   生成当前笔记的摘要  （描述：标题后第一段非空行）
 *
 *   请总结当前笔记...   （prompt：描述后的正文，直到下一个 ## 或文件末尾）
 *
 * - 仅识别 ## 二级标题为 skill 名称（# 一级标题忽略，### 及以下不识别）
 * - 描述为标题后第一段非空文本（单行）
 * - prompt 为描述段落之后的所有正文（多行，去除首尾空白）
 * - 无正文的 skill 仍保留（prompt 为空字符串）
 * - name / description / prompt 去除首尾空白
 */
export function parseSkillsMarkdown(content: string): Skill[] {
  const skills: Skill[] = [];
  const lines = content.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 匹配 ## 标题（二级标题，前后可有空白）
    const match = line.match(/^\s*##\s+(.+?)\s*$/);
    if (!match) {
      i++;
      continue;
    }

    const name = match[1];
    i++;

    // 跳过空行，找描述（第一个非空行，且不是下一个 ## 标题）
    let description = "";
    while (i < lines.length) {
      const l = lines[i];
      if (l.match(/^\s*##\s+/)) break; // 下一个 skill
      if (l.trim().length === 0) {
        i++;
        continue;
      }
      description = l.trim();
      i++;
      break;
    }

    // 收集 prompt 正文（直到下一个 ## 或文件末尾）
    const promptLines: string[] = [];
    // 跳过描述与正文之间的空行
    while (i < lines.length && lines[i].trim().length === 0) {
      i++;
    }
    while (i < lines.length) {
      const l = lines[i];
      if (l.match(/^\s*##\s+/)) break; // 下一个 skill
      promptLines.push(l);
      i++;
    }

    const prompt = promptLines.join("\n").trimEnd();
    skills.push({ name, description, prompt });
  }

  return skills;
}

/**
 * 从 Vault 读取 skills 列表
 * - 读取 {vaultPath}/.llm-bridge/skills.md
 * - 文件不存在时返回空数组（不报错，skills 为可选功能）
 * - 解析失败时返回空数组并记录警告
 */
export async function loadSkills(vaultPath: string): Promise<Skill[]> {
  const filePath = path.join(vaultPath, SKILLS_FILE_REL);
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return parseSkillsMarkdown(content);
  } catch {
    // 文件不存在或读取失败：skills 为空（可选功能）
    return [];
  }
}

/**
 * 构造 skills 配置文件模板内容（用于首次创建）
 * 不自动创建文件；仅提供模板供用户参考
 */
export function buildSkillsTemplate(): string {
  return `# Skills

## 总结笔记
生成当前笔记的摘要

请总结当前笔记的核心内容，生成一份摘要笔记到输出目录下，文件名用原笔记名加 -summary 后缀，包含适当的 frontmatter。

## 解释选区
解释选中文本的含义

请解释以上选中文本的含义、背景和关键概念。如有可能，给出相关的延伸阅读建议。

## 自由提问
清空输入框并聚焦

`;
}
