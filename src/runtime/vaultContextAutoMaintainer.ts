// LLM CLI Bridge — Vault Context Auto Maintainer (V3)
//
// V3 收紧自动维护：
// - 删除"单轮访问同一目录四次就写入约定"的逻辑
// - preferences 只记录用户明确表达的长期偏好（不自动提取）
// - vault-rules 只接受用户明确规则或系统迁移（不自动提取）
// - directories 只记录目录用途，不缓存完整目录树（不自动提取）
// - conventions 需要明确证据或跨任务重复验证（不单轮自动写入）
// - 使用原子写入、持久化更新日志和可恢复备份
//
// autoMaintainVaultContext 现在是保守的 no-op：
// 不再从 tool calls / fileChanges 自动提取候选写入 references/。
// 写入由 agent 遵循 SKILL.md 指令显式执行（用户明确偏好/规则/跨任务验证的约定）。
// 本模块只提供原子写入 + 备份 + 更新日志的 utility 供 agent 调用。

import * as fs from "fs";
import * as path from "path";
import {
  VAULT_SKILL_REFERENCES_DIR_REL,
  VAULT_SKILL_BACKUP_DIR_REL,
  VAULT_SKILL_REFERENCE_FILES,
  VAULT_SKILL_ITEM_MAX_CHARS,
  VAULT_SKILL_SECTION_MAX_ITEMS,
  appendVaultSkillUpdateLog,
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

// ---------- 原子写入 + 备份 utility ----------

/**
 * 读取 reference 文件原始内容（用于备份/撤销）。
 * 文件不存在时返回 null。
 */
export async function readReferenceFile(
  vaultPath: string,
  fileName: string,
): Promise<string | null> {
  if (!(VAULT_SKILL_REFERENCE_FILES as readonly string[]).includes(fileName)) {
    return null;
  }
  const filePath = path.join(vaultPath, VAULT_SKILL_REFERENCES_DIR_REL, fileName);
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 原子写入 reference 文件：.tmp + rename，避免半写状态。
 *
 * 流程：
 * 1. 备份原始内容到内存（用于返回）和 .v2-backup/ 目录（持久化）
 * 2. 写 .tmp 文件
 * 3. rename 覆盖目标
 * 4. 追加 update-log.md
 *
 * @returns 修改前原始内容（null 表示文件原本不存在），用于撤销
 */
export async function writeReferenceFileAtomic(
  vaultPath: string,
  fileName: string,
  newContent: string,
  options?: { reason?: string; summary?: string },
): Promise<{ ok: boolean; backup: string | null; reason?: string }> {
  if (!(VAULT_SKILL_REFERENCE_FILES as readonly string[]).includes(fileName)) {
    return { ok: false, backup: null, reason: `invalid reference file: ${fileName}` };
  }
  const refsDir = path.join(vaultPath, VAULT_SKILL_REFERENCES_DIR_REL);
  const filePath = path.join(refsDir, fileName);
  const tmpPath = filePath + ".tmp";

  // 1. 读取原始内容（内存备份）
  let backup: string | null = null;
  try {
    backup = await fs.promises.readFile(filePath, "utf8");
  } catch {
    backup = null;
  }

  try {
    // 2. 确保 references/ 目录存在
    await fs.promises.mkdir(refsDir, { recursive: true });

    // 3. 持久化备份到 .v2-backup/（可恢复）
    if (backup !== null) {
      try {
        const backupDir = path.join(vaultPath, VAULT_SKILL_BACKUP_DIR_REL);
        await fs.promises.mkdir(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `${fileName}.${Date.now()}.bak`);
        await fs.promises.writeFile(backupPath, backup, "utf8");
      } catch {
        // 持久化备份失败不阻断主写入
      }
    }

    // 4. 原子写入：.tmp → rename
    await fs.promises.writeFile(tmpPath, newContent, "utf8");
    await fs.promises.rename(tmpPath, filePath);

    // 5. 追加更新日志
    try {
      await appendVaultSkillUpdateLog(vaultPath, {
        timestamp: new Date().toISOString(),
        reason: "user-long-term-preference",
        summary: options?.summary ?? `updated references/${fileName}`,
      });
    } catch {
      // 日志失败不阻断
    }

    return { ok: true, backup };
  } catch (err) {
    // 清理可能残留的 .tmp
    try { await fs.promises.rm(tmpPath, { force: true }); } catch { /* ignore */ }
    return {
      ok: false,
      backup,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 去重合并条目到 reference 文件（原子写入）。
 *
 * 用于 agent 显式追加条目时调用：
 * - 读取现有 `- ` 条目
 * - normalize 去重
 * - 超过 VAULT_SKILL_SECTION_MAX_ITEMS 时截断
 * - 原子写入 + 备份 + 更新日志
 */
export async function mergeItemsIntoReferenceAtomic(
  vaultPath: string,
  fileName: string,
  items: ReadonlyArray<string>,
  options?: { reason?: string; summary?: string },
): Promise<{ ok: boolean; added: string[]; backup: string | null; reason?: string }> {
  if (items.length === 0) return { ok: true, added: [], backup: null };

  const filePath = path.join(vaultPath, VAULT_SKILL_REFERENCES_DIR_REL, fileName);
  let content = "";
  try {
    content = await fs.promises.readFile(filePath, "utf8");
  } catch {
    // 文件不存在时用空内容（writeReferenceFileAtomic 会创建）
    content = "";
  }

  const lines = content.split("\n");
  const existingItems = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("- ")) {
      existingItems.add(normalizeItem(line.slice(2).trim()));
    }
  }

  const added: string[] = [];
  for (const item of items) {
    const normalized = normalizeItem(item);
    if (existingItems.has(normalized)) continue;
    added.push(truncateItem(item));
    existingItems.add(normalized);
  }

  if (added.length === 0) {
    return { ok: true, added: [], backup: null };
  }

  // 追加新条目
  const newLines = [...lines];
  while (newLines.length > 0 && newLines[newLines.length - 1].trim() === "") {
    newLines.pop();
  }
  for (const item of added) {
    newLines.push(`- ${item}`);
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

  const writeResult = await writeReferenceFileAtomic(
    vaultPath,
    fileName,
    compacted.join("\n"),
    options,
  );

  return {
    ok: writeResult.ok,
    added,
    backup: writeResult.backup,
    reason: writeResult.reason,
  };
}

// ---------- 内部 utility ----------

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

// ---------- 主入口 ----------

/**
 * V3: turn completed 后台自动维护 Vault Context。
 *
 * 收紧后：不再从 tool calls / fileChanges 自动提取候选。
 * 写入由 agent 遵循 SKILL.md 指令显式执行（用户明确偏好/规则/跨任务验证的约定）。
 * 本函数现在只做：检查是否有需要重建的索引（始终返回空 updatedFiles）。
 *
 * 保留接口签名以兼容 RunSessionController 调用方。
 * 后台 fire-and-forget，不阻塞流式速度。失败静默。
 */
export async function autoMaintainVaultContext(input: AutoMaintainInput): Promise<AutoMaintainResult> {
  // 只在 completed 状态下执行
  if (input.status !== "completed") {
    return { ok: true, updatedFiles: [], conflicts: [] };
  }

  // V3: 不再自动提取候选；返回空结果
  // 索引重建由 ensureAgentRuntimeWorkspace / materialize 阶段负责
  return { ok: true, updatedFiles: [], conflicts: [] };
}

/**
 * VC-4: 撤销最近一次自动维护。
 *
 * 从 backups 恢复原始文件内容，然后重新生成索引。
 * V3: 恢复到 references/ 目录。
 */
export async function undoVaultContextMaintain(
  vaultPath: string,
  backups: ReadonlyMap<string, string>,
): Promise<{ ok: boolean; reason?: string }> {
  if (backups.size === 0) return { ok: false, reason: "无可撤销的备份" };
  const refsDir = path.join(vaultPath, VAULT_SKILL_REFERENCES_DIR_REL);
  try {
    await fs.promises.mkdir(refsDir, { recursive: true });
    for (const [fileName, content] of backups) {
      if (!(VAULT_SKILL_REFERENCE_FILES as readonly string[]).includes(fileName)) continue;
      const filePath = path.join(refsDir, fileName);
      const tmpPath = filePath + ".tmp";
      await fs.promises.writeFile(tmpPath, content, "utf8");
      await fs.promises.rename(tmpPath, filePath);
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
