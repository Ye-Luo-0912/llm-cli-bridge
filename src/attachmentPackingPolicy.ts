import { MAX_ATTACHMENT_INGEST_BYTES, MAX_ATTACHMENT_INGEST_CHARS } from "./fileIngestion";

export interface AttachmentPackingPolicy {
  smallTextInlineMaxBytes: number;
  smallTextInlineMaxChars: number;
  allowedTextExtensions: string[];
  binaryAsNativeRef: boolean;
  imageAsSdkAttachmentIfSupported: boolean;
  sdkDirectAttachmentSupported: boolean;
  sdkDirectAttachmentEvidence: string;
}

export const DEFAULT_ATTACHMENT_PACKING_POLICY: AttachmentPackingPolicy = {
  smallTextInlineMaxBytes: MAX_ATTACHMENT_INGEST_BYTES,
  smallTextInlineMaxChars: MAX_ATTACHMENT_INGEST_CHARS,
  allowedTextExtensions: [
    ".md", ".markdown", ".mdown", ".mkd",
    ".json", ".jsonc",
    ".txt", ".text", ".csv", ".tsv", ".log",
    ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ],
  binaryAsNativeRef: true,
  imageAsSdkAttachmentIfSupported: true,
  sdkDirectAttachmentSupported: true,
  sdkDirectAttachmentEvidence: "Official Claude Agent SDK TypeScript docs support query({ prompt }) with AsyncIterable<SDKUserMessage> Streaming Input, including image content blocks. Local package/types were not installed, so PDF/document blocks remain disabled until tested.",
};
