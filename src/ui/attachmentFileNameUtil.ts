// LLM CLI Bridge — 附件文件名规范（从 view.ts 渐进拆分 P3）
// 纯函数：文件名清理 + 可用性检查 + 默认文件名生成。
import * as path from "path";

/** 清理附件文件名：去控制字符 + 压缩空白 + 截断 120 字符 */
export function sanitizeAttachmentFileName(fileName: string): string {
  const trimmed = fileName.trim() || "attachment";
  return trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

/** 检查文件名是否可用：非空 + 无替换符 + 无控制字符 + 有扩展名或长度 ≤48 */
export function isUsableAttachmentFileName(fileName: string | null | undefined): fileName is string {
  const trimmed = (fileName || "").trim();
  if (!trimmed) return false;
  if (trimmed.includes("\uFFFD")) return false;
  if (/[\x00-\x1F]/.test(trimmed)) return false;
  if (!path.extname(trimmed) && trimmed.length > 48) return false;
  return true;
}

/** MIME 类型 → 默认附件文件名 */
export function defaultAttachmentFileName(mimeType: string): string {
  if (/png/i.test(mimeType)) return "pasted-image.png";
  if (/jpe?g/i.test(mimeType)) return "pasted-image.jpg";
  if (/gif/i.test(mimeType)) return "pasted-image.gif";
  if (/webp/i.test(mimeType)) return "pasted-image.webp";
  if (/pdf/i.test(mimeType)) return "pasted-document.pdf";
  if (/json/i.test(mimeType)) return "pasted-data.json";
  if (/text|plain/i.test(mimeType)) return "pasted-text.txt";
  return "pasted-file.bin";
}
