// LLM CLI Bridge — Skills Entry (V2.0)
// 从 Vault 内 Markdown 文件读取 skills 列表，展示并插入 prompt
// Skills 默认只做 prompt 增强：不新增 tool event，不直接执行危险操作
// 纯函数解析 + 文件读取分离，便于单元测试

import * as fs from "fs";
import * as path from "path";
import { redactSecrets } from "./workflowEvent";

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
 * 构造 skills 配置文件模板内容（V2.1 默认 5 skill 包）
 * 不自动创建文件；由 seedDefaultSkills 或 UI 按钮触发写入
 * prompt 中的 {{outputDir}} 占位符在应用时由 expandSkillPrompt 替换为实际输出目录，
 * 保持 skills 数据驱动且不绑定具体 Vault 目录
 */
export function buildSkillsTemplate(): string {
  return `# Skills

## 总结当前笔记
生成当前笔记的摘要

请总结当前笔记的核心内容，生成一份摘要笔记到 {{outputDir}} 目录下，文件名用原笔记名加 -summary 后缀，包含适当的 frontmatter。

## 解释选区
解释选中文本的含义

请解释以上选中文本的含义、背景和关键概念。如有可能，给出相关的延伸阅读建议。

## 整理为结构化笔记
把零散内容整理为结构化笔记

请把当前笔记（或选区）的内容整理为结构化笔记，包含清晰的标题层级、要点列表和必要的总结段落。整理结果写入 {{outputDir}} 目录下的新笔记。

## 提取待办/行动项
从笔记中提取待办与行动项

请从当前笔记中提取所有待办事项与行动项，按优先级分组列出，并生成一份行动清单笔记到 {{outputDir}} 目录下。

## 改写润色
改写润色选中文本

请改写并润色以上选中文本，使其更清晰、连贯、专业，保持原意不变。改写结果请通过 replace_selection action 写回原选区位置。

`;
}

/**
 * 把默认 skills 模板写入 Vault（仅当文件不存在时；不覆盖已有文件）
 * @returns true 表示已写入（之前不存在），false 表示已存在或写入失败
 */
export async function seedDefaultSkills(vaultPath: string): Promise<boolean> {
  const filePath = path.join(vaultPath, SKILLS_FILE_REL);
  try {
    await fs.promises.access(filePath);
    return false; // 已存在，不覆盖
  } catch {
    // 文件不存在，写入默认模板
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, buildSkillsTemplate(), "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 过滤掉被禁用的 skills（纯函数，保留原顺序）
 * @param skills 全部 skills
 * @param disabledNames 被禁用的 skill 名称列表
 */
export function filterEnabledSkills(skills: Skill[], disabledNames: string[]): Skill[] {
  if (!disabledNames || disabledNames.length === 0) return skills.slice();
  const disabled = new Set(disabledNames);
  return skills.filter((s) => !disabled.has(s.name));
}

/**
 * 替换 skill prompt 中的占位符（如 {{outputDir}}）
 * 保持 skills 数据驱动且不绑定具体 Vault 目录
 */
export function expandSkillPrompt(prompt: string, outputDir: string): string {
  return prompt.replace(/\{\{outputDir\}\}/g, outputDir);
}

/**
 * 构造用于日志的 skill 表示（脱敏 prompt，防止 secret 泄露到日志）
 */
export function redactSkillForLog(skill: Skill): { name: string; description: string; promptRedacted: string } {
  return {
    name: skill.name,
    description: skill.description,
    promptRedacted: redactSecrets(skill.prompt),
  };
}
