export const CLIPBOARD_TEXT_ATTACHMENT_MIN_CHARS = 20000;
export const CLIPBOARD_TEXT_ATTACHMENT_MIN_LINES = 240;

export interface ClipboardTextBlobDescriptor {
  type?: string | null;
  name?: string | null;
}

export function isClipboardTextBlobDescriptor(file: ClipboardTextBlobDescriptor): boolean {
  const mimeType = (file.type || "").toLowerCase();
  const lowerName = (file.name || "").toLowerCase();
  if (/^text\//.test(mimeType)) return true;
  if (/(json|xml|javascript|markdown|csv|rtf|html)/.test(mimeType)) return true;
  if (!mimeType && /\.(txt|md|markdown|json|csv|log|html?|xml|rtf)$/i.test(lowerName)) return true;
  return false;
}

export function shouldPersistLargeClipboardText(text?: string): boolean {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return false;
  const lineCount = normalized.split("\n").length;
  return normalized.length >= CLIPBOARD_TEXT_ATTACHMENT_MIN_CHARS || lineCount >= CLIPBOARD_TEXT_ATTACHMENT_MIN_LINES;
}

export function defaultClipboardTextAttachmentFileName(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "pasted-text.txt";
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "pasted-data.json";
    } catch {
      // Fallback below.
    }
  }
  if (/```|^\s{0,3}(#|>|\* |- |\d+\.)/m.test(trimmed)) return "pasted-note.md";
  return "pasted-text.txt";
}
