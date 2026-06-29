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

// V2.10: 并行 stat 批大小，避免单次 Promise.all 在超大 Vault 下同时打开过多句柄
const STAT_BATCH_SIZE = 64;

/**
 * 扫描 Vault 目录，收集所有 Markdown 文件快照
 * - 排除 EXCLUDE_DIRS 中的目录
 * - 只收集 .md 文件
 * - 返回 Map<相对路径, FileSnapshot>
 * - V2.10: 优化大 Vault 性能——先收集所有 md 文件路径，再分批 Promise.all 并行 stat（替代循环内逐个 await）
 */
export async function snapshotVaultMarkdownFiles(vaultPath: string): Promise<Map<string, FileSnapshot>> {
  const out = new Map<string, FileSnapshot>();
  // 第一遍：BFS 收集所有 md 文件路径（只 readdir，不 stat）
  const mdFiles: Array<{ fullPath: string; rel: string }> = [];
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
          mdFiles.push({ fullPath, rel });
        }
      }
    } catch {
      /* 目录不存在或无权限 */
    }
  }
  // 第二遍：分批并行 stat（V2.10 替代循环内逐个 await，大 Vault 从 O(N) 串行 syscall 降为 O(N/BATCH) 批次）
  for (let i = 0; i < mdFiles.length; i += STAT_BATCH_SIZE) {
    const batch = mdFiles.slice(i, i + STAT_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (f) => {
        try {
          const stat = await fs.promises.stat(f.fullPath);
          return { rel: f.rel, mtime: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) out.set(r.rel, { path: r.rel, mtime: r.mtime, size: r.size });
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
