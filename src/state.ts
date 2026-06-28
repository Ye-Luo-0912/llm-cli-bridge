// LLM CLI Bridge — Obsidian 状态导出
// 在每次发送任务前，把 Vault 当前状态写入 .llm-bridge/state/

import { App, CachedMetadata, TFile, Vault, DataAdapter } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { BridgeState, LLMBridgeSettings } from "./types";

export const STATE_DIR_REL = ".llm-bridge/state";
export const LOGS_DIR_REL = ".llm-bridge/logs";

// metadata.json 结构：当前 active note 的元信息
export interface NoteMetadata {
  path: string;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  outgoingLinks: string[];
  backlinks: string[];
  headings: { level: number; text: string; line: number }[];
  timestamp: string;
}

function getVaultPath(vault: Vault): string {
  const adapter = vault.adapter as DataAdapter & { getBasePath?: () => string };
  if (adapter.getBasePath) return adapter.getBasePath();
  // 兜底：从 resourcePath 之类推断不到时返回空串
  return "";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n...[truncated by LLM CLI Bridge]";
}

export interface ExportStateOptions {
  // 即使未勾选，也保留参数用于写 current.json 的元信息
  selection: string | null;
}

export interface ExportStateResult extends BridgeState {
  vaultPath: string;
  stateDir: string;
  logsDir: string;
}

export async function exportState(
  app: App,
  vault: Vault,
  activeFile: TFile | null,
  opts: ExportStateOptions,
  settings: LLMBridgeSettings,
): Promise<ExportStateResult> {
  const vaultPath = getVaultPath(vault);
  if (!vaultPath) {
    throw new Error("无法获取 Vault 根目录路径（仅桌面端支持）");
  }

  const stateDir = path.join(vaultPath, STATE_DIR_REL);
  const logsDir = path.join(vaultPath, LOGS_DIR_REL);
  await fs.promises.mkdir(stateDir, { recursive: true });
  if (settings.saveLogs) {
    await fs.promises.mkdir(logsDir, { recursive: true });
  }

  const hasSelection = !!opts.selection && opts.selection.length > 0;
  const selectionLength = opts.selection ? opts.selection.length : 0;

  const state: BridgeState = {
    vaultPath,
    activeFilePath: activeFile ? activeFile.path : null,
    hasActiveFile: !!activeFile,
    hasSelection,
    selectionLength,
    timestamp: new Date().toISOString(),
  };

  await fs.promises.writeFile(
    path.join(stateDir, "current.json"),
    JSON.stringify(state, null, 2),
    "utf8",
  );

  // active-note.md：仅当勾选“引用当前笔记”且有 active file
  const activeNotePath = path.join(stateDir, "active-note.md");
  if (settings.includeActiveNote && activeFile) {
    let content = await vault.read(activeFile);
    content = truncate(content, settings.maxActiveNoteChars);
    await fs.promises.writeFile(activeNotePath, content, "utf8");
  } else {
    await fs.promises.rm(activeNotePath, { force: true });
  }

  // selection.md：仅当勾选“引用选区”且有选区
  const selectionPath = path.join(stateDir, "selection.md");
  if (settings.includeSelection && hasSelection && opts.selection) {
    const content = truncate(opts.selection, settings.maxSelectionChars);
    await fs.promises.writeFile(selectionPath, content, "utf8");
  } else {
    await fs.promises.rm(selectionPath, { force: true });
  }

  // metadata.json：始终导出当前 active note 的元信息（无 active file 则删除）
  const metadataPath = path.join(stateDir, "metadata.json");
  if (activeFile) {
    try {
      const meta = collectNoteMetadata(app, activeFile);
      await fs.promises.writeFile(metadataPath, JSON.stringify(meta, null, 2), "utf8");
    } catch {
      // 元信息收集失败不阻断主流程
    }
  } else {
    await fs.promises.rm(metadataPath, { force: true });
  }

  return { ...state, stateDir, logsDir };
}

// 收集 active note 的 frontmatter / tags / outgoing links / backlinks / headings
function collectNoteMetadata(app: App, file: TFile): NoteMetadata {
  const cache: CachedMetadata | null = app.metadataCache.getFileCache(file);

  // frontmatter（去掉 Obsidian 内部字段）
  let frontmatter: Record<string, unknown> | null = null;
  if (cache?.frontmatter) {
    frontmatter = {};
    for (const [k, v] of Object.entries(cache.frontmatter)) {
      if (k === "position") continue;
      frontmatter[k] = v;
    }
  }

  // tags
  const tags: string[] = [];
  if (cache?.tags) {
    for (const t of cache.tags) tags.push(t.tag);
  }

  // headings
  const headings: { level: number; text: string; line: number }[] = [];
  if (cache?.headings) {
    for (const h of cache.headings) {
      headings.push({
        level: h.level,
        text: h.heading,
        line: h.position?.start?.line ?? 0,
      });
    }
  }

  // outgoing links（解析成功 + 未解析）
  const outgoingLinks: string[] = [];
  if (cache?.links) {
    for (const link of cache.links) {
      const target = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (target) outgoingLinks.push(target.path);
      else outgoingLinks.push(`[unresolved] ${link.link}`);
    }
  }

  // backlinks：遍历 resolvedLinks，找出所有指向当前文件的反向链接
  const backlinks: string[] = [];
  const resolved = app.metadataCache.resolvedLinks;
  for (const sourcePath of Object.keys(resolved)) {
    const targets = resolved[sourcePath];
    if (targets && targets[file.path]) {
      backlinks.push(sourcePath);
    }
  }

  return {
    path: file.path,
    frontmatter,
    tags,
    outgoingLinks,
    backlinks,
    headings,
    timestamp: new Date().toISOString(),
  };
}
