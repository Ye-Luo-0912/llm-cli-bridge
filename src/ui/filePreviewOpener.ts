// LLM CLI Bridge — File Preview Modal 渲染（从 view.ts 渐进拆分 P4）
// 纯函数：modal 内容构建 + 预览文本读取。Modal 状态管理（filePreviewModal 字段）保留在 view。
import * as fs from "fs";
import { Modal, TFile, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { FileRef } from "../fileRefs";
import { isBoundedTextAttachmentType } from "../fileIngestion";

/** File preview modal 依赖注入 */
export interface FilePreviewOpenerDeps {
  /** Obsidian App，用于 vault.read */
  app: App;
  /** FileRef → 显示路径（Modal 顶部 path 行） */
  fileRefDisplayPath: (ref: FileRef) => string;
  /** FileRef → 缩略图 URL（image 类型走图预览分支） */
  getFileRefThumbnailUrl: (ref: FileRef) => string | null;
  /** FileRef → 图标名（无可预览内容时的 fallback） */
  getFileRefIconName: (ref: FileRef) => string;
  /** FileRef → 内联预览文本（命中 snippet/缓存时直接复用） */
  getFileRefPreviewText: (ref: FileRef) => string | null;
  /** FileRef → vault 相对路径（走 vault.read 分支） */
  resolveFileRefVaultPath: (ref: FileRef) => string | null;
  /** FileRef → 绝对路径（走 fs.readFileSync 分支） */
  resolveFileRefAbsolutePath: (ref: FileRef) => string | null;
  /** 轮询获取 vault 内 TFile（索引未就绪时重试） */
  getIndexedVaultFile: (vaultRelPath: string) => Promise<TFile | null>;
}

/**
 * 构建 file preview modal 的内容（标题 + 路径 + 图片/文本/空态）。
 * 调用方负责 modal 的创建、状态管理和 open() 调用。
 */
export async function renderFilePreviewModalContent(
  modal: Modal,
  ref: FileRef,
  deps: FilePreviewOpenerDeps,
): Promise<void> {
  modal.containerEl.addClass("llm-bridge-file-preview-container");
  modal.titleEl.setText(ref.displayName);
  modal.contentEl.empty();
  modal.contentEl.addClass("llm-bridge-file-preview-modal");
  modal.contentEl.createDiv({
    cls: "llm-bridge-file-preview-path",
    text: deps.fileRefDisplayPath(ref),
    attr: { title: ref.resolvedPath },
  });

  const preview = modal.contentEl.createDiv({ cls: `llm-bridge-file-preview is-${ref.fileType}` });
  const thumbnailUrl = ref.fileType === "image" ? deps.getFileRefThumbnailUrl(ref) : null;
  if (thumbnailUrl) {
    preview.createEl("img", {
      cls: "llm-bridge-file-preview-image",
      attr: { src: thumbnailUrl, alt: ref.displayName },
    });
  } else {
    const previewText = await readFileRefPreviewText(ref, deps);
    if (previewText) {
      preview.createEl("pre", { cls: "llm-bridge-file-preview-text", text: previewText });
    } else {
      const empty = preview.createDiv({ cls: "llm-bridge-file-preview-empty" });
      const icon = empty.createSpan({ cls: "llm-bridge-file-preview-icon" });
      setIcon(icon, deps.getFileRefIconName(ref));
      empty.createEl("span", { text: "此文件类型暂不支持轻量预览。" });
    }
  }
}

/**
 * 读取 FileRef 的预览文本（优先内联缓存，其次 vault，最后 fs）。
 * 超过 256KB 或 12000 字符的内容会被截断。
 */
export async function readFileRefPreviewText(
  ref: FileRef,
  deps: FilePreviewOpenerDeps,
): Promise<string | null> {
  if (!isBoundedTextAttachmentType(ref.fileType)) return null;
  const maxBytes = 256 * 1024;
  const maxChars = 12000;
  const inlinePreview = deps.getFileRefPreviewText(ref);
  if (inlinePreview) {
    return inlinePreview.length > maxChars ? `${inlinePreview.slice(0, maxChars).trimEnd()}\n...` : inlinePreview;
  }
  const vaultRelPath = deps.resolveFileRefVaultPath(ref);
  try {
    if (vaultRelPath) {
      const file = await deps.getIndexedVaultFile(vaultRelPath);
      if (!(file instanceof TFile) || file.stat.size > maxBytes) return null;
      const text = await deps.app.vault.read(file);
      return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}\n...` : text;
    }
    const filePath = deps.resolveFileRefAbsolutePath(ref);
    if (!filePath) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const text = fs.readFileSync(filePath, "utf8");
    return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}\n...` : text;
  } catch {
    return null;
  }
}
