// LLM CLI Bridge — Vault Markdown 文件快照与 diff（V0.9 抽取为纯函数）
// 运行前后扫描 Vault，检测新增/修改的 .md 文件
// 排除 .obsidian / .llm-bridge / node_modules / .git / LLM-AgentRuntime / dist / build

import * as fs from "fs";
import * as path from "path";

export interface FileSnapshot {
  path: string;   // 相对路径（正斜杠）
  mtime: number;
  size: number;
}

// V0.9: 排除目录列表（匹配时全部转小写，大小写不敏感）
export const EXCLUDE_DIRS = [
  ".obsidian",
  ".llm-bridge",
  "node_modules",
  ".git",
  "LLM-AgentRuntime",
  "dist",
  "build",
];

// 内部小写集合，用于大小写不敏感匹配
const EXCLUDE_DIRS_LOWER = EXCLUDE_DIRS.map((d) => d.toLowerCase());

/**
 * 判断相对路径是否应被排除（任一路径段命中排除目录，大小写不敏感）
 */
export function shouldExclude(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, "/").split("/");
  for (const part of parts) {
    if (EXCLUDE_DIRS_LOWER.includes(part.toLowerCase())) return true;
  }
  return false;
}

/**
 * 判断文件是否为 Markdown（.md 结尾，不区分大小写）
 */
export function isMarkdownFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".md");
}

/**
 * 扫描 Vault 目录，收集所有 Markdown 文件快照
 * - 排除 EXCLUDE_DIRS 中的目录
 * - 只收集 .md 文件
 * - 返回 Map<相对路径, FileSnapshot>
 */
export async function snapshotVaultMarkdownFiles(vaultPath: string): Promise<Map<string, FileSnapshot>> {
  const out = new Map<string, FileSnapshot>();
  const stack: string[] = [vaultPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (const e of entries) {
        const fullPath = path.join(current, e.name);
        const rel = path.relative(vaultPath, fullPath).replace(/\\/g, "/");
        if (e.isDirectory()) {
          if (!EXCLUDE_DIRS_LOWER.includes(e.name.toLowerCase())) {
            stack.push(fullPath);
          }
        } else if (e.isFile() && isMarkdownFile(e.name)) {
          try {
            const stat = await fs.promises.stat(fullPath);
            out.set(rel, { path: rel, mtime: stat.mtimeMs, size: stat.size });
          } catch {
            /* stat 失败跳过 */
          }
        }
      }
    } catch {
      /* 目录不存在或无权限 */
    }
  }
  return out;
}

/**
 * 对比前后快照，返回新增/修改的文件列表
 * - 新增：before 中不存在
 * - 修改：mtime 或 size 变化
 * - 返回格式："relPath  [NEW]" 或 "relPath  [MODIFIED]"，按路径排序
 */
export function diffSnapshots(
  before: Map<string, FileSnapshot>,
  after: Map<string, FileSnapshot>,
): string[] {
  const result: string[] = [];
  for (const [rel, snap] of after) {
    const beforeSnap = before.get(rel);
    if (!beforeSnap) {
      result.push(rel + "  [NEW]");
    } else if (snap.mtime !== beforeSnap.mtime || snap.size !== beforeSnap.size) {
      result.push(rel + "  [MODIFIED]");
    }
  }
  return result.sort((a, b) => a.localeCompare(b));
}

/**
 * 从展示路径中提取相对路径（去掉 "  [NEW]" / "  [MODIFIED]" 后缀）
 */
export function extractRelPath(displayPath: string): string {
  return displayPath.replace(/\s+\[(NEW|MODIFIED)\]$/, "");
}
