// LLM CLI Bridge — 附件摄入服务（从 view.ts 渐进拆分 P3 batch 7）
// 边界：路径提取 + blob 落盘 → 返回 vault 相对路径数组
// FileRef 创建/入册/刷新保留在 view。
import { Notice, normalizePath } from "obsidian";
import * as path from "path";
import {
  collectFilePathsFromDataTransfer,
  extractNativeFilePath,
  extractPathsFromFileList,
  readElectronClipboardFilePaths,
} from "./clipboardPathExtractor";
import {
  defaultClipboardTextAttachmentFileName as chooseClipboardTextAttachmentFileName,
  isClipboardTextBlobDescriptor,
  shouldPersistLargeClipboardText,
} from "../clipboardPastePolicy";
import {
  defaultAttachmentFileName,
  isUsableAttachmentFileName,
  sanitizeAttachmentFileName,
} from "./attachmentFileNameUtil";

const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico"];

/** Vault 写入接口（view 注入 this.app.vault 的子集） */
export interface AttachmentVaultWriter {
  create(relPath: string, content: string): Promise<unknown>;
  createBinary(relPath: string, data: ArrayBuffer): Promise<unknown>;
  createFolder(folder: string): Promise<unknown>;
  getAbstractFileByPath(relPath: string): unknown | null;
}

// ===== 路径提取层（纯函数，无 IO） =====

/** 从 ClipboardEvent 合并 DataTransfer + Electron 原生剪贴板文件路径 */
export function collectFilePathsFromClipboardEvent(event: ClipboardEvent): string[] {
  const paths = collectFilePathsFromDataTransfer(event.clipboardData);
  for (const filePath of readElectronClipboardFilePaths()) {
    if (!paths.includes(filePath)) paths.push(filePath);
  }
  return paths;
}

/** 判断 FileList 是否含非文本 blob（含原生 path 的 File 也算"非 text 通道"） */
export function hasNonTextClipboardFileBlob(files: FileList | null | undefined): boolean {
  if (!files?.length) return false;
  return Array.from(files).some((file) => {
    if (extractNativeFilePath(file)) return true;
    return !isClipboardTextBlobDescriptor(file);
  });
}

/** 决定是否对某个 pathless blob 落盘：size>0 + 非 paste 直接 yes；paste 时区分文本/二进制 */
export function shouldPersistPathlessAttachmentBlob(
  file: File,
  source: string,
  options: { clipboardText?: string } = {},
): boolean {
  if (file.size <= 0) return false;
  if (!/^paste$/i.test(source)) return true;
  if (!isClipboardTextBlobDescriptor(file)) return true;
  return shouldPersistLargeClipboardText(options.clipboardText);
}

// ===== Blob 落盘层 =====

/** 把超长粘贴文本写为 vault 内 .txt/.json/.md 文件 */
export async function persistClipboardTextToVault(
  text: string,
  source: string,
  vault: AttachmentVaultWriter,
): Promise<string | null> {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  try {
    const folder = normalizePath("LLM-Bridge Attachments");
    await ensureVaultFolder(folder, vault);
    const safeName = sanitizeAttachmentFileName(chooseClipboardTextAttachmentFileName(normalized));
    const relPath = await allocateAttachmentPath(folder, safeName, vault);
    await vault.create(relPath, normalized);
    new Notice(`已缓存 ${source} 文本附件：${safeName}`, 2500);
    return relPath;
  } catch (error) {
    new Notice(`缓存文本附件失败：${error instanceof Error ? error.message : String(error)}`, 5000);
    return null;
  }
}

/** 把 File（图片/二进制）arrayBuffer 写入 vault.createBinary；图片走大小/扩展名校验 */
export async function persistBlobAttachmentToVault(
  file: File,
  source: string,
  vault: AttachmentVaultWriter,
): Promise<string | null> {
  if (!file || file.size <= 0) return null;
  // Phase 3: 图片大小限制 + 格式检查
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(file.name) || /^image\//i.test(file.type);
  if (isImage) {
    if (!MAX_IMAGE_ATTACHMENT_BYTES || file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      const limitMB = (MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0);
      new Notice(`图片过大（${sizeMB}MB > ${limitMB}MB 限制），将以路径引用方式发送，不直接上传。`, 5000);
    }
    if (ext && !SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
      new Notice(`不支持的图片格式：${ext}（支持 PNG/JPG/GIF/WEBP/BMP/SVG）`, 5000);
      return null;
    }
  }
  try {
    const folder = normalizePath("LLM-Bridge Attachments");
    await ensureVaultFolder(folder, vault);
    const sourceName = isUsableAttachmentFileName(file.name)
      ? file.name
      : defaultAttachmentFileName(file.type);
    const safeName = sanitizeAttachmentFileName(sourceName);
    const relPath = await allocateAttachmentPath(folder, safeName, vault);
    const data = await file.arrayBuffer();
    await vault.createBinary(relPath, data);
    new Notice(`已缓存 ${source} 附件：${safeName}`, 2500);
    return relPath;
  } catch (error) {
    new Notice(`缓存附件失败：${error instanceof Error ? error.message : String(error)}`, 5000);
    return null;
  }
}

/** 从 electron.clipboard.readImage() 取 PNG buffer 委托 persistBinaryAttachmentToVault 落盘 */
export async function persistElectronClipboardImageToVault(vault: AttachmentVaultWriter): Promise<string | null> {
  try {
    const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
    const electron = requireFn?.("electron") as {
      clipboard?: {
        readImage?: () => {
          isEmpty?: () => boolean;
          toPNG?: () => Buffer;
        };
      };
    } | undefined;
    const image = electron?.clipboard?.readImage?.();
    if (!image || image.isEmpty?.()) return null;
    const png = image.toPNG?.();
    if (!png || png.length === 0) return null;
    return await persistBinaryAttachmentToVault(png, `screenshot-${Date.now()}.png`, "paste", vault);
  } catch {
    return null;
  }
}

/** 通用二进制落盘：大小校验 + ensureVaultFolder + allocateAttachmentPath + vault.createBinary */
export async function persistBinaryAttachmentToVault(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  source: string,
  vault: AttachmentVaultWriter,
): Promise<string | null> {
  const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.length;
  // Phase 3: 图片大小限制 + 降级提示
  if (byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
    const sizeMB = (byteLength / 1024 / 1024).toFixed(1);
    const limitMB = (MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0);
    new Notice(`图片过大（${sizeMB}MB > ${limitMB}MB 限制），将以路径引用方式发送，不直接上传。`, 5000);
  }
  try {
    const folder = normalizePath("LLM-Bridge Attachments");
    await ensureVaultFolder(folder, vault);
    const safeName = sanitizeAttachmentFileName(fileName);
    const relPath = await allocateAttachmentPath(folder, safeName, vault);
    const binary = data instanceof ArrayBuffer
      ? data
      : new Uint8Array(data).slice().buffer;
    await vault.createBinary(relPath, binary);
    new Notice(`已缓存 ${source} 图片：${safeName}`, 2500);
    return relPath;
  } catch (error) {
    new Notice(`缓存图片失败：${error instanceof Error ? error.message : String(error)}`, 5000);
    return null;
  }
}

/** 逐级创建 vault 文件夹（处理并发竞态） */
export async function ensureVaultFolder(folder: string, vault: AttachmentVaultWriter): Promise<void> {
  const parts = folder.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (vault.getAbstractFileByPath(current)) continue;
    try {
      await vault.createFolder(current);
    } catch {
      // Another event may have created it between the existence check and createFolder.
    }
  }
}

/** 生成不冲突的 vault 相对路径（{folder}/{timestamp}-{base}{-N}{ext}），最多尝试 1000 次 */
export async function allocateAttachmentPath(folder: string, fileName: string, vault: AttachmentVaultWriter): Promise<string> {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext) || "attachment";
  for (let index = 0; index < 1000; index++) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const relPath = normalizePath(`${folder}/${Date.now()}-${base}${suffix}${ext}`);
    if (!vault.getAbstractFileByPath(relPath)) return relPath;
  }
  return normalizePath(`${folder}/${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`);
}

// ===== 编排层（路径 + 落盘的总入口） =====

/** 路径提取 + blob 落盘编排：先抽 native path，再把无 path 的 blob 落盘并合并路径 */
export async function collectPathsAndCacheBlobsFromFileList(
  files: FileList | null | undefined,
  source: string,
  vault: AttachmentVaultWriter,
): Promise<string[]> {
  const paths = extractPathsFromFileList(files);
  for (const cachedPath of await cachePathlessFilesFromFileList(files, source, vault)) {
    if (!paths.includes(cachedPath)) paths.push(cachedPath);
  }
  return paths;
}

/** 遍历 FileList，对"无 native path 且策略允许"的 File 调用 persistBlobAttachmentToVault 落盘 */
export async function cachePathlessFilesFromFileList(
  files: FileList | null | undefined,
  source: string,
  vault: AttachmentVaultWriter,
  options: { clipboardText?: string } = {},
): Promise<string[]> {
  if (!files?.length) return [];
  const paths: string[] = [];
  for (const file of Array.from(files)) {
    if (extractNativeFilePath(file)) continue;
    if (!shouldPersistPathlessAttachmentBlob(file, source, options)) continue;
    const cachedPath = await persistBlobAttachmentToVault(file, source, vault);
    if (cachedPath) paths.push(cachedPath);
  }
  return paths;
}
