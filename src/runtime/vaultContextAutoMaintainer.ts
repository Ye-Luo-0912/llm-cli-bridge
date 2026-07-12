// LLM CLI Bridge — Vault Context Auto Maintainer (VC-2)
//
// turn completed 后台维护生命周期：
// 1. 提取稳定候选（directories / conventions，从 tool calls + fileChanges + generatedFiles）
// 2. 去重与冲突检查（同目录不同描述 → 冲突，不自动写入）
// 3. 安全内容自动写入（仅 agent-managed 区：directories / conventions）
// 4. 异步更新索引
//
// 设计原则：
// - 后台 fire-and-forget，不阻塞流式速度
// - 只提取高置信度候选：同一 turn 内出现 >= 4 次的目录（明确的多文件操作模式），
//   不因单轮两次访问就记录"频繁操作目录"
// - 不自动写入 vaultRules（安全规则只由用户/初始模板设定）
// - 不自动写入 preferences（用户偏好只追加，不自动提取）
// - 冲突不弹通知（VC-4 UI 阶段再处理冲突提醒）

import * as fs from "fs";
import * as path from "path";
import {
  VAULT_SKILL_SOURCE_DIR_REL,
  VAULT_SKILL_SECTION_MAX_ITEMS,
  VAULT_SKILL_ITEM_MAX_CHARS,
  regenerateVaultContextIndex,
} from "../agentRuntimeWorkspace";
import type { AssistantTurnView } from "./core/types";

// ---------- 公共类型 ----------

export interface AutoMaintainInput {
  readonly vaultPath: string;
  readonly turnView: AssistantTurnView | undefined;
  readonly generatedFiles: ReadonlyArray<string>;
  readonly status: "completed" | "failed" | "stopped";
}

export interface AutoMaintainResult {
  readonly ok: boolean;
  readonly updatedFiles: string[];
  readonly conflicts: string[];
  readonly reason?: string;
  /** VC-4: 文件名 → 修改前原始内容，用于撤销 */
  readonly backups?: ReadonlyMap<string, string>;
}

// ---------- 提取稳定候选 ----------

interface StableCandidates {
  readonly directories: string[];
  readonly conventions: string[];
}

/** 从 tool input JSON 中提取文件路径字段 */
function extractPathsFromToolInput(toolInput: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolInput);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const paths: string[] = [];
  const pathKeys = ["file_path", "path", "filePath", "note_path", "target_path", "dest_path"];
  for (const key of pathKeys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) {
      paths.push(val);
    }
  }
  return paths;
}

/** 归一化目录路径：去掉 ./ 前缀，统一 / 分隔符，去掉尾部 / */
function normalizeDir(dir: string): string {
  return dir
    .replace(/^\.\//, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .trim();
}

/** 判断目录是否有意义（排除根目录和内部目录） */
function isMeaningfulDir(dir: string): boolean {
  if (!dir || dir === "." || dir === "/" || dir.length === 0) return false;
  const internal = [".obsidian", ".llm-bridge", ".git", "LLM-AgentRuntime", "node_modules", ".codex"];
  return !internal.some((p) => dir === p || dir.startsWith(p + "/"));
}

/** 从目录路径提取前两级作为短描述（避免过长的目录路径） */
function shortenDir(dir: string): string {
  const parts = dir.split("/");
  if (parts.length <= 2) return dir;
  return parts.slice(0, 2).join("/") + "/…";
}

/**
 * 从 turn 数据中提取稳定候选。
 *
 * 策略：
 * - directories: 从 tool calls + fileChanges 中提取目录路径，统计出现次数，>= 2 次的记录
 * - conventions: 从 fileChanges(create/modify) + generatedFiles 中提取输出位置约定，>= 2 次的记录
 */
function extractStableCandidates(input: AutoMaintainInput): StableCandidates {
  const dirCounts = new Map<string, number>();
  const convCounts = new Map<string, number>();

  const turnView = input.turnView;

  // 1. 从 tool calls 中提取目录路径
  if (turnView?.tools) {
    for (const tool of turnView.tools) {
      const filePaths = extractPathsFromToolInput(tool.toolInput);
      for (const fp of filePaths) {
        const dir = normalizeDir(path.dirname(fp));
        if (isMeaningfulDir(dir)) {
          dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
        }
      }
    }
  }

  // 2. 从 fileChanges 中提取目录路径
  if (turnView?.fileChanges) {
    for (const fc of turnView.fileChanges) {
      const dir = normalizeDir(path.dirname(fc.path));
      if (isMeaningfulDir(dir)) {
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
        if (fc.action === "create" || fc.action === "modify") {
          convCounts.set(dir, (convCounts.get(dir) ?? 0) + 1);
        }
      }
    }
  }

  // 3. 从 generatedFiles 中提取输出位置约定
  for (const gf of input.generatedFiles) {
    const dir = normalizeDir(path.dirname(gf));
    if (isMeaningfulDir(dir)) {
      convCounts.set(dir, (convCounts.get(dir) ?? 0) + 1);
    }
  }

  // 只保留出现 >= 4 次的候选（明确的多文件操作模式，避免单轮两次访问就记录）
  const dirCandidates = Array.from(dirCounts.entries())
    .filter(([, count]) => count >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dir]) => `${shortenDir(dir)}/ : 频繁操作目录（自动记录）`);

  const convCandidates = Array.from(convCounts.entries())
    .filter(([, count]) => count >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([dir]) => `输出位置约定：${shortenDir(dir)}/（自动记录）`);

  return { directories: dirCandidates, conventions: convCandidates };
}

// ---------- 去重与冲突检查 ----------

interface MergeResult {
  readonly added: string[];
  readonly conflicts: string[];
  /** 修改前的原始内容（仅当有追加时才填充），用于撤销 */
  readonly backup?: string;
}

/** 归一化条目用于去重（小写 + 压缩空格） */
function normalizeItem(item: string): string {
  return item.trim().toLowerCase().replace(/\s+/g, " ");
}

/** 截断条目到最大长度 */
function truncateItem(item: string): string {
  if (item.length > VAULT_SKILL_ITEM_MAX_CHARS) {
    return item.slice(0, VAULT_SKILL_ITEM_MAX_CHARS) + "...";
  }
  return item;
}

/** 从条目中提取目录路径前缀（用于冲突检查） */
function extractDirPrefix(item: string): string | null {
  // 匹配 "路径/ : 描述" 或 "输出位置约定：路径/（...）" 中的路径部分
  const m1 = item.match(/^([^\s:：]+?)\/\s*[:：]/);
  if (m1) return m1[1];
  const m2 = item.match(/[:：]\s*([^\s（(]+)/);
  if (m2) return m2[1].replace(/\/+$/, "");
  return null;
}

/**
 * 将候选条目合并到子 skill 文件中。
 *
 * 流程：
 * 1. 读取现有文件，解析现有 `- ` 行
 * 2. 去重：normalize 后比较
 * 3. 冲突检查：同目录路径不同描述 → 记录冲突，不自动写入
 * 4. 追加新条目
 * 5. compact：超过 VAULT_SKILL_SECTION_MAX_ITEMS 条时截断
 */
async function mergeCandidatesIntoFile(
  filePath: string,
  candidates: ReadonlyArray<string>,
): Promise<MergeResult> {
  if (candidates.length === 0) return { added: [], conflicts: [] };

  let content = "";
  try {
    content = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return { added: [], conflicts: [] };
  }

  const lines = content.split("\n");
  const existingItems = new Set<string>();
  const existingDirMap = new Map<string, string>(); // dir prefix -> full item
  for (const line of lines) {
    if (line.startsWith("- ")) {
      const item = line.slice(2).trim();
      existingItems.add(normalizeItem(item));
      const dirPrefix = extractDirPrefix(item);
      if (dirPrefix) {
        existingDirMap.set(dirPrefix.toLowerCase(), item);
      }
    }
  }

  const added: string[] = [];
  const conflicts: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeItem(candidate);
    if (existingItems.has(normalized)) continue; // 去重

    // 冲突检查：同目录路径不同描述
    const candidateDir = extractDirPrefix(candidate);
    if (candidateDir && existingDirMap.has(candidateDir.toLowerCase())) {
      const existing = existingDirMap.get(candidateDir.toLowerCase())!;
      conflicts.push(
        `目录 ${candidateDir} 已有不同描述：\n  现有: ${existing}\n  新候选: ${candidate}`,
      );
      continue; // 冲突时不自动写入
    }

    added.push(candidate);
    existingItems.add(normalized);
    if (candidateDir) {
      existingDirMap.set(candidateDir.toLowerCase(), candidate);
    }
  }

  if (added.length === 0) {
    return { added: [], conflicts };
  }

  // 保存修改前的原始内容（用于撤销）
  const backup = content;

  // 追加新条目到文件末尾
  const newLines = [...lines];
  while (newLines.length > 0 && newLines[newLines.length - 1].trim() === "") {
    newLines.pop();
  }
  for (const item of added) {
    newLines.push(`- ${truncateItem(item)}`);
  }
  newLines.push("");

  // compact：超过上限时只保留前 VAULT_SKILL_SECTION_MAX_ITEMS 条
  let bulletCount = 0;
  const compacted = newLines.filter((line) => {
    if (line.startsWith("- ")) {
      if (bulletCount >= VAULT_SKILL_SECTION_MAX_ITEMS) return false;
      bulletCount++;
    }
    return true;
  });

  try {
    await fs.promises.writeFile(filePath, compacted.join("\n"), "utf8");
  } catch {
    return { added: [], conflicts };
  }

  return { added, conflicts, backup };
}

// ---------- 主入口 ----------

/**
 * VC-2: turn completed 后台自动维护 Vault Context。
 *
 * 只在 completed 状态下执行。
 * 后台 fire-and-forget，不阻塞流式速度。
 * 失败静默（只返回 result，不抛错）。
 */
export async function autoMaintainVaultContext(input: AutoMaintainInput): Promise<AutoMaintainResult> {
  // 只在 completed 状态下维护
  if (input.status !== "completed") {
    return { ok: true, updatedFiles: [], conflicts: [] };
  }

  // 没有工具调用和文件变更时跳过
  const turnView = input.turnView;
  const hasTools = turnView?.tools && turnView.tools.length > 0;
  const hasFileChanges = turnView?.fileChanges && turnView.fileChanges.length > 0;
  const hasGenerated = input.generatedFiles.length > 0;
  if (!hasTools && !hasFileChanges && !hasGenerated) {
    return { ok: true, updatedFiles: [], conflicts: [] };
  }

  try {
    const candidates = extractStableCandidates(input);

    // 没有候选时跳过
    if (candidates.directories.length === 0 && candidates.conventions.length === 0) {
      return { ok: true, updatedFiles: [], conflicts: [] };
    }

    const sourceDir = path.join(input.vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
    const updatedFiles: string[] = [];
    const conflicts: string[] = [];
    const backups = new Map<string, string>();

    // directories
    if (candidates.directories.length > 0) {
      const result = await mergeCandidatesIntoFile(
        path.join(sourceDir, "directories.md"),
        candidates.directories,
      );
      if (result.added.length > 0) {
        updatedFiles.push("directories.md");
        if (result.backup !== undefined) backups.set("directories.md", result.backup);
      }
      conflicts.push(...result.conflicts);
    }

    // conventions
    if (candidates.conventions.length > 0) {
      const result = await mergeCandidatesIntoFile(
        path.join(sourceDir, "conventions.md"),
        candidates.conventions,
      );
      if (result.added.length > 0) {
        updatedFiles.push("conventions.md");
        if (result.backup !== undefined) backups.set("conventions.md", result.backup);
      }
      conflicts.push(...result.conflicts);
    }

    // 如果有更新，重新生成索引
    if (updatedFiles.length > 0) {
      try {
        await regenerateVaultContextIndex(input.vaultPath);
      } catch {
        // 索引更新失败不阻断
      }
    }

    return { ok: true, updatedFiles, conflicts, backups };
  } catch (err) {
    return {
      ok: false,
      updatedFiles: [],
      conflicts: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * VC-4: 撤销最近一次自动维护。
 *
 * 从 backups 恢复原始文件内容，然后重新生成索引。
 */
export async function undoVaultContextMaintain(
  vaultPath: string,
  backups: ReadonlyMap<string, string>,
): Promise<{ ok: boolean; reason?: string }> {
  if (backups.size === 0) return { ok: false, reason: "无可撤销的备份" };
  const sourceDir = path.join(vaultPath, VAULT_SKILL_SOURCE_DIR_REL);
  try {
    for (const [fileName, content] of backups) {
      await fs.promises.writeFile(path.join(sourceDir, fileName), content, "utf8");
    }
    try {
      await regenerateVaultContextIndex(vaultPath);
    } catch {
      // 索引更新失败不阻断
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
