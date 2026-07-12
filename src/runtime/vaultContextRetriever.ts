// LLM CLI Bridge — Vault Context On-Demand Retriever (VC-3)
//
// turn start 按需检索 vault-context 条目：
// 1. vault-rules（安全规则）始终加载（删除、覆盖、受保护目录等）
// 2. directories/conventions 只加载与 userPrompt 相关的条目（路径关键词匹配）
// 3. preferences 只加载与 userPrompt 相关的条目（风格/习惯关键词匹配）
// 4. 当前指令始终优先于普通偏好
//
// 设计原则：
// - 轻量：只读取 4 个小文件（vault-rules / directories / conventions / preferences）
// - 按需：从 userPrompt 中提取关键词，只选择匹配的条目
// - 安全规则始终注入；普通偏好按需注入
// - 不替代物化（物化后的 skill 仍由 provider 被动发现），而是在 prompt 中主动提示

import * as fs from "fs";
import * as path from "path";
import { VAULT_SKILL_SOURCE_DIR_REL } from "../agentRuntimeWorkspace";

/**
 * VC-3: turn start 按需检索 vault-context 条目，返回格式化的 context block。
 *
 * 返回空字符串表示无需注入（文件不存在或无相关条目）。
 */
export async function retrieveVaultContextOnDemand(
  vaultPath: string,
  userPrompt: string,
): Promise<string> {
  const sourceDir = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);

  // 1. 始终读取 vault-rules.md（安全规则）
  const rules = await readSubSkillItems(sourceDir, "vault-rules.md");

  // 2. 从 userPrompt 中提取路径关键词
  const pathKeywords = extractPathKeywords(userPrompt);

  // 3. 只加载相关 directories 条目
  const directories = await readSubSkillItems(sourceDir, "directories.md");
  const relevantDirs = pathKeywords.length > 0
    ? directories.filter((item) => isItemRelevant(item, pathKeywords))
    : [];

  // 4. 只加载相关 conventions 条目
  const conventions = await readSubSkillItems(sourceDir, "conventions.md");
  const relevantConvs = pathKeywords.length > 0
    ? conventions.filter((item) => isItemRelevant(item, pathKeywords))
    : [];

  // 5. 只加载相关 preferences 条目（风格/习惯关键词匹配）
  const styleKeywords = extractStyleKeywords(userPrompt);
  const preferences = await readSubSkillItems(sourceDir, "preferences.md");
  const relevantPrefs = styleKeywords.length > 0
    ? preferences.filter((item) => isItemRelevant(item, styleKeywords))
    : [];

  // 6. 格式化为 context block
  return formatVaultContextBlock(rules, relevantDirs, relevantConvs, relevantPrefs);
}

/** 读取子 skill 文件中的 `- ` 条目 */
async function readSubSkillItems(sourceDir: string, fileName: string): Promise<string[]> {
  try {
    const content = await fs.promises.readFile(path.join(sourceDir, fileName), "utf8");
    return content
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((item) => item.length > 0 && !item.startsWith("<!--"));
  } catch {
    return [];
  }
}

/** 从用户 prompt 中提取路径关键词（至少包含一个 / 的路径片段） */
function extractPathKeywords(prompt: string): string[] {
  // 匹配文件路径模式：word/word 或 word/word/word...
  const matches = prompt.match(/[\w-]+(?:\/[\w.-]+)+/g) || [];
  const dirs = new Set<string>();
  for (const match of matches) {
    const parts = match.split("/");
    // 取前两级作为关键词
    if (parts.length >= 1) {
      dirs.add(parts[0].toLowerCase());
    }
    if (parts.length >= 2) {
      dirs.add(parts.slice(0, 2).join("/").toLowerCase());
    }
  }
  return Array.from(dirs);
}

/** 从用户 prompt 中提取风格/习惯关键词（触发 preferences 加载） */
function extractStyleKeywords(prompt: string): string[] {
  const keywords = new Set<string>();
  const lower = prompt.toLowerCase();
  // 风格/习惯相关关键词（中英文）
  const stylePatterns = [
    "风格", "习惯", "偏好", "格式", "语言", "回复", "回答", "语气", "简洁", "详细",
    "中文", "英文", "markdown", "表格", "列表", "代码块",
    "style", "tone", "format", "language", "reply", "respond", "concise", "verbose",
  ];
  for (const kw of stylePatterns) {
    if (lower.includes(kw)) {
      keywords.add(kw);
    }
  }
  return Array.from(keywords);
}

/** 判断条目是否与关键词相关 */
function isItemRelevant(item: string, keywords: string[]): boolean {
  const lower = item.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/** 格式化为 vault-context block */
function formatVaultContextBlock(
  rules: string[],
  directories: string[],
  conventions: string[],
  preferences: string[],
): string {
  if (rules.length === 0 && directories.length === 0 && conventions.length === 0 && preferences.length === 0) {
    return "";
  }

  const sections: string[] = [];
  sections.push("<vault-context>");
  sections.push("以下为 vault 长期记忆。用户当前指令始终优先于普通偏好；安全规则必须遵守。");
  sections.push("");

  if (rules.length > 0) {
    sections.push("## 安全规则（必须遵守）");
    for (const rule of rules.slice(0, 10)) {
      sections.push(`- ${rule}`);
    }
    sections.push("");
  }

  if (directories.length > 0) {
    sections.push("## 相关目录");
    for (const dir of directories.slice(0, 5)) {
      sections.push(`- ${dir}`);
    }
    sections.push("");
  }

  if (conventions.length > 0) {
    sections.push("## 相关约定");
    for (const conv of conventions.slice(0, 5)) {
      sections.push(`- ${conv}`);
    }
    sections.push("");
  }

  if (preferences.length > 0) {
    sections.push("## 相关偏好（用户当前指令优先）");
    for (const pref of preferences.slice(0, 5)) {
      sections.push(`- ${pref}`);
    }
    sections.push("");
  }

  sections.push("</vault-context>");
  return sections.join("\n");
}
