// LLM CLI Bridge — FileRef 元数据工具（从 view.ts 渐进拆分 P4）
// 纯函数：文件类型图标 + 短标签 + MIME 类型推断，零依赖。
import * as path from "path";
import type { FileRef } from "../fileRefs";

/** 文件类型 → 图标名（Obsidian lucide icon） */
export function fileTypeIconName(fileType: string): string {
  if (fileType === "image") return "image";
  if (fileType === "markdown" || fileType === "text" || fileType === "pdf") return "file-text";
  if (fileType === "json") return "braces";
  if (fileType === "binary") return "file";
  return "file";
}

/** FileRef → 图标名（透传） */
export function getFileRefIconName(ref: FileRef): string {
  return fileTypeIconName(ref.fileType);
}

/** 展示路径 + 文件类型 → 短标签（扩展名优先，无扩展名用类型缩写） */
export function shortLabelForPath(displayPath: string, fileType: string): string {
  const ext = path.extname(displayPath).replace(".", "").trim();
  if (ext) return ext.slice(0, 4).toUpperCase();
  if (fileType === "markdown") return "MD";
  if (fileType === "text") return "TXT";
  if (fileType === "json") return "JSON";
  if (fileType === "pdf") return "PDF";
  if (fileType === "binary") return "BIN";
  return "FILE";
}

/** FileRef → 短标签 */
export function getFileRefShortLabel(ref: FileRef): string {
  return shortLabelForPath(ref.displayName, ref.fileType);
}

/** 图片文件路径 → MIME 类型 */
export function imageMimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}
