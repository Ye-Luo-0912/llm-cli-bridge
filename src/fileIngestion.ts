import * as fs from "fs";
import { FileRef, FileRefFileType } from "./fileRefs";
import { isSensitivePath } from "./fileAccessPolicy";

export const MAX_ATTACHMENT_INGEST_BYTES = 32 * 1024;
export const MAX_ATTACHMENT_INGEST_CHARS = 12 * 1024;

export interface AttachmentTextSnippet {
  refId: string;
  displayName: string;
  resolvedPath: string;
  fileType: Extract<FileRefFileType, "text" | "markdown" | "json">;
  content: string;
  bytesRead: number;
  maxBytes: number;
  maxChars: number;
  truncated: boolean;
}

export interface AttachmentIngestionResult {
  snippet: AttachmentTextSnippet | null;
  skippedReason: "not_text" | "too_large" | "sensitive_path" | "read_error" | null;
  sizeBytes: number | null;
}

export function isBoundedTextAttachmentType(fileType: FileRefFileType): fileType is AttachmentTextSnippet["fileType"] {
  return fileType === "text" || fileType === "markdown" || fileType === "json";
}

export async function ingestAttachmentTextSnippet(
  ref: FileRef,
  options: { maxBytes?: number; maxChars?: number } = {},
): Promise<AttachmentIngestionResult> {
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_INGEST_BYTES;
  const maxChars = options.maxChars ?? MAX_ATTACHMENT_INGEST_CHARS;

  if (isSensitivePath(ref.resolvedPath)) {
    return { snippet: null, skippedReason: "sensitive_path", sizeBytes: null };
  }
  if (ref.kind !== "attachment" || !isBoundedTextAttachmentType(ref.fileType)) {
    return { snippet: null, skippedReason: "not_text", sizeBytes: null };
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(ref.resolvedPath);
  } catch {
    return { snippet: null, skippedReason: "read_error", sizeBytes: null };
  }
  if (!stat.isFile()) {
    return { snippet: null, skippedReason: "read_error", sizeBytes: stat.size };
  }
  if (stat.size > maxBytes) {
    return { snippet: null, skippedReason: "too_large", sizeBytes: stat.size };
  }

  try {
    const raw = await fs.promises.readFile(ref.resolvedPath, "utf8");
    const truncated = raw.length > maxChars;
    return {
      snippet: {
        refId: ref.id,
        displayName: ref.displayName,
        resolvedPath: ref.resolvedPath,
        fileType: ref.fileType,
        content: truncated ? raw.slice(0, maxChars) : raw,
        bytesRead: stat.size,
        maxBytes,
        maxChars,
        truncated,
      },
      skippedReason: null,
      sizeBytes: stat.size,
    };
  } catch {
    return { snippet: null, skippedReason: "read_error", sizeBytes: stat.size };
  }
}
