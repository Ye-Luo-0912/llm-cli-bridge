// LLM CLI Bridge — Skills Entry (V2.0)
// 从 Vault 内 Markdown 文件读取 skills 列表，展示并插入 prompt
// Skills 默认只做 prompt 增强：不新增 tool event，不直接执行危险操作
// 纯函数解析 + 文件读取分离，便于单元测试

import * as fs from "fs";
import * as path from "path";
import { redactSecrets } from "./workflowEvent";

/** Skills 配置文件相对 Vault 根的路径 */
export const SKILLS_FILE_REL = ".llm-bridge/skills.md";

/** V2.3: 导入的 skill 文件目录（每个 skill 一个 .md 文件） */
export const SKILLS_DIR_REL = ".llm-bridge/skills";

/** V2.3: 单个 skill prompt 最大长度（与 maxActiveNoteChars 同量级，防 prompt 爆炸） */
export const MAX_SKILL_PROMPT_LENGTH = 8000;

/**
 * 单个 Skill 定义
 * - name: 显示名（来自 ## 标题）
 * - description: 简短描述（标题后第一段非空文本，V2.6 去除 #标签部分）
 * - prompt: 插入到输入框的 prompt 模板（描述后的正文）
 * - tags: V2.6 分组标签（从 description 行末 #标签 提取，如 #翻译 #常用）
 */
export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly tags: string[];
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

    // V2.6: 从 description 行末提取 #标签（如 "将选区翻译为英文 #翻译 #常用" → desc="将选区翻译为英文", tags=["翻译","常用"]）
    const { description: cleanDesc, tags } = extractTags(description);
    description = cleanDesc;

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
    skills.push({ name, description, prompt, tags });
  }

  return skills;
}

/**
 * V2.6: 从文本中提取 #标签（行末 #词 形式）
 * - 标签格式：#后跟非空白字符（中文/英文/数字/下划线/连字符）
 * - 标签必须前面是空格或行首（避免匹配 URL 中的 #）
 * - 返回去除标签后的描述文本与标签数组
 * - 无标签时返回原文本与空数组
 */
export function extractTags(text: string): { description: string; tags: string[] } {
  const tags: string[] = [];
  // 匹配 (空格或行首)#标签词（标签词：1-30 个非空白字符）
  const tagRegex = /(?:^|\s)#([^\s#]{1,30})/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    tags.push(match[1]);
  }
  if (tags.length === 0) {
    return { description: text, tags: [] };
  }
  // 去除标签部分，保留描述
  const desc = text.replace(/(?:^|\s)#[^\s#]{1,30}/g, "").trim();
  return { description: desc, tags };
}

/**
 * 从 Vault 读取 skills 列表
 * - 读取 {vaultPath}/.llm-bridge/skills.md（主文件，向后兼容）
 * - 读取 {vaultPath}/.llm-bridge/skills/*.md（V2.3 导入的 skill，每个文件一个 skill）
 * - 主文件与目录中同名 skill 时，主文件优先
 * - 文件不存在时返回空数组（不报错，skills 为可选功能）
 */
export async function loadSkills(vaultPath: string): Promise<Skill[]> {
  // 1. 主文件
  const mainSkills = await loadMainSkillsFile(vaultPath);
  // 2. 导入目录
  const importedSkills = await loadImportedSkillsDir(vaultPath);
  // 去重：主文件优先
  const names = new Set(mainSkills.map((s) => s.name));
  return [...mainSkills, ...importedSkills.filter((s) => !names.has(s.name))];
}

// 内部：读取主文件
async function loadMainSkillsFile(vaultPath: string): Promise<Skill[]> {
  const filePath = path.join(vaultPath, SKILLS_FILE_REL);
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return parseSkillsMarkdown(content);
  } catch {
    return [];
  }
}

// V2.3: 内部：读取导入目录下的所有 .md 文件
async function loadImportedSkillsDir(vaultPath: string): Promise<Skill[]> {
  const dirPath = path.join(vaultPath, SKILLS_DIR_REL);
  let files: string[] = [];
  try {
    files = await fs.promises.readdir(dirPath);
  } catch {
    return []; // 目录不存在
  }
  const skills: Skill[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(dirPath, file);
    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      const parsed = parseSkillsMarkdown(content);
      // 每个文件应只含一个 skill，取第一个
      if (parsed.length > 0) skills.push(parsed[0]);
    } catch {
      // 单个文件读取失败，跳过
    }
  }
  return skills;
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

// ─── V2.3: Skills 安装/导入/删除 ──────────────────────────────────────────

/**
 * 将单个 skill 序列化为 Markdown 文件内容（用于写入 .llm-bridge/skills/ 目录）
 * 格式与主文件一致：## 标题 + 描述(+ #标签) + prompt 正文
 * V2.6: 描述后追加 #标签（如有）
 */
export function serializeSkillToMarkdown(skill: Skill): string {
  const lines: string[] = [`## ${skill.name}`];
  // V2.6: 描述 + #标签 拼接（标签追加在描述行末）
  let descLine = skill.description || "";
  if (skill.tags && skill.tags.length > 0) {
    const tagStr = skill.tags.map((t) => `#${t}`).join(" ");
    descLine = descLine ? `${descLine} ${tagStr}` : tagStr;
  }
  if (descLine) {
    lines.push("");
    lines.push(descLine);
  }
  if (skill.prompt) {
    lines.push("");
    lines.push(skill.prompt);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 将 skill 名称转换为合法文件名（替换非法字符）
 */
function skillNameToFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 64) || "untitled";
}

/**
 * 从文本导入 skill 到 .llm-bridge/skills/ 目录
 * @returns true 表示导入成功，false 表示失败（同名文件已存在或写入失败）
 */
export async function importSkillFromText(
  vaultPath: string,
  name: string,
  description: string,
  prompt: string,
): Promise<boolean> {
  const dirPath = path.join(vaultPath, SKILLS_DIR_REL);
  const fileName = `${skillNameToFileName(name)}.md`;
  const filePath = path.join(dirPath, fileName);
  try {
    // 确保目录存在
    await fs.promises.mkdir(dirPath, { recursive: true });
    // 检查是否已存在
    try {
      await fs.promises.access(filePath);
      return false; // 已存在，不覆盖
    } catch {
      // 不存在，继续写入
    }
    const skill: Skill = { name, description, prompt, tags: [] };
    await fs.promises.writeFile(filePath, serializeSkillToMarkdown(skill), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 从外部 .md 文件导入 skill 到 .llm-bridge/skills/ 目录
 * - 读取源文件，解析为 skill，重新序列化后写入导入目录
 * - 文件名基于源文件名（去路径），冲突时返回 false
 * @returns true 表示导入成功
 */
export async function importSkillFromFile(
  vaultPath: string,
  srcFilePath: string,
): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(srcFilePath, "utf8");
    const parsed = parseSkillsMarkdown(content);
    if (parsed.length === 0) return false;
    const skill = parsed[0];
    // V2.4 修正：用 skillNameToFileName(skill.name) 作为文件名，保持与 deleteSkill/isImportedSkill 一致
    // （原实现用源文件 basename，导致导入后无法按 skill 名称删除）
    const fileName = `${skillNameToFileName(skill.name)}.md`;
    const dirPath = path.join(vaultPath, SKILLS_DIR_REL);
    const filePath = path.join(dirPath, fileName);
    await fs.promises.mkdir(dirPath, { recursive: true });
    try {
      await fs.promises.access(filePath);
      return false; // 已存在
    } catch {
      // 不存在
    }
    await fs.promises.writeFile(filePath, serializeSkillToMarkdown(skill), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 删除导入的 skill（仅删除 .llm-bridge/skills/ 目录下的文件，不删主文件 skills.md）
 * @returns true 表示删除成功，false 表示文件不存在或删除失败
 */
export async function deleteSkill(vaultPath: string, skillName: string): Promise<boolean> {
  const dirPath = path.join(vaultPath, SKILLS_DIR_REL);
  const fileName = `${skillNameToFileName(skillName)}.md`;
  const filePath = path.join(dirPath, fileName);
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 判断 skill 是否为导入的（存在于 .llm-bridge/skills/ 目录）
 * 用于 UI 决定是否显示"删除"按钮（主文件中的 skill 不可删除）
 */
export async function isImportedSkill(vaultPath: string, skillName: string): Promise<boolean> {
  const dirPath = path.join(vaultPath, SKILLS_DIR_REL);
  const fileName = `${skillNameToFileName(skillName)}.md`;
  const filePath = path.join(dirPath, fileName);
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── V2.3: Skills 敏感扫描 + 长度截断 ─────────────────────────────────────

/**
 * Skill prompt 敏感扫描结果
 * - redacted: 脱敏后的 prompt（可直接注入）
 * - warnings: 检测到的可疑模式列表（用于 UI 提示）
 */
export interface SkillScanResult {
  readonly redacted: string;
  readonly warnings: string[];
}

/**
 * 扫描 skill prompt 中的敏感内容并脱敏
 * - 检测 API key / Bearer token / 凭证模式
 * - 使用 redactSecrets 脱敏
 * - 返回警告列表供 UI 提示用户
 */
export function scanSkillPrompt(prompt: string): SkillScanResult {
  const warnings: string[] = [];
  if (/sk-ant-api03-[A-Za-z0-9_-]{20,}/i.test(prompt)) {
    warnings.push("疑似 Anthropic API key");
  }
  if (/sk-[A-Za-z0-9]{20,}/i.test(prompt)) {
    warnings.push("疑似 API key（sk- 前缀）");
  }
  if (/Bearer\s+[A-Za-z0-9_.~+/=-]{20,}/i.test(prompt)) {
    warnings.push("疑似 Bearer token");
  }
  if (/(api[_-]?key|token|password|secret|credential)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{8,}/i.test(prompt)) {
    warnings.push("疑似凭证赋值语句");
  }
  const redacted = redactSecrets(prompt);
  return { redacted, warnings };
}

/**
 * 截断 skill prompt 到最大长度
 * - 超长时在末尾追加截断标记
 * - 不超长时原样返回
 */
export function truncateSkillPrompt(prompt: string, maxLen: number = MAX_SKILL_PROMPT_LENGTH): string {
  if (prompt.length <= maxLen) return prompt;
  return prompt.slice(0, maxLen) + "\n…(skill prompt 已截断)";
}

// ─── V2.5: Skills 编辑 / 搜索 / 冲突处理 ──────────────────────────────────

/**
 * 编辑导入的 skill（重命名 + 更新 description/prompt）
 * - 仅作用于 .llm-bridge/skills/ 目录下的文件
 * - 若 newName 与 originalName 不同，删除旧文件并写入新文件（保持 skillNameToFileName 一致性）
 * - 若 newName 与 originalName 相同，直接覆盖原文件内容
 * - 主文件（skills.md）中的 skill 不可编辑，需返回 false
 * @returns true 表示编辑成功
 */
export async function updateImportedSkill(
  vaultPath: string,
  originalName: string,
  newName: string,
  newDescription: string,
  newPrompt: string,
): Promise<boolean> {
  try {
    const dirPath = path.join(vaultPath, SKILLS_DIR_REL);
    const oldFileName = `${skillNameToFileName(originalName)}.md`;
    const oldFilePath = path.join(dirPath, oldFileName);
    // 检查原文件是否存在（仅导入的 skill 可编辑）
    try {
      await fs.promises.access(oldFilePath);
    } catch {
      return false; // 原文件不存在或为主文件中的 skill
    }
    await fs.promises.mkdir(dirPath, { recursive: true });
    // 若名称改变：检查新名称是否冲突（已存在同文件名的另一文件）
    if (newName !== originalName) {
      const newFileName = `${skillNameToFileName(newName)}.md`;
      const newFilePath = path.join(dirPath, newFileName);
      try {
        await fs.promises.access(newFilePath);
        return false; // 新名称已存在，冲突
      } catch {
        // 新名称不冲突，继续
      }
      // 写入新文件
      const updatedSkill: Skill = { name: newName, description: newDescription, prompt: newPrompt, tags: [] };
      await fs.promises.writeFile(newFilePath, serializeSkillToMarkdown(updatedSkill), "utf8");
      // 删除旧文件
      try {
        await fs.promises.unlink(oldFilePath);
      } catch {
        // 旧文件删除失败不阻断（新文件已写入）
      }
      return true;
    }
    // 名称未变：直接覆盖原文件
    const updatedSkill: Skill = { name: newName, description: newDescription, prompt: newPrompt, tags: [] };
    await fs.promises.writeFile(oldFilePath, serializeSkillToMarkdown(updatedSkill), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 按名称/描述/标签过滤 skills（不区分大小写，空 query 返回全部副本）
 * - V2.6: 增加 tags 匹配（#标签 或纯关键词均可匹配）
 */
export function searchSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return skills.slice();
  // 支持 #标签 语法（输入 #翻译 只匹配标签）
  const isTagQuery = q.startsWith("#");
  const tagQuery = isTagQuery ? q.slice(1) : q;
  return skills.filter((s) => {
    const nameMatch = s.name.toLowerCase().includes(q);
    const descMatch = s.description && s.description.toLowerCase().includes(q);
    const tagMatch = (s.tags || []).some((t) => t.toLowerCase().includes(tagQuery));
    return isTagQuery ? tagMatch : (nameMatch || descMatch || tagMatch);
  });
}

/**
 * 检查导入目录中是否已存在同名 skill（用于导入时冲突提示）
 * @returns true 表示已存在同名 skill（冲突）
 */
export async function checkImportConflict(vaultPath: string, name: string): Promise<boolean> {
  return isImportedSkill(vaultPath, name);
}
