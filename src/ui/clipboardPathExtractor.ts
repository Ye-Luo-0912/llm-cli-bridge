// LLM CLI Bridge — 剪贴板/拖拽文件路径提取（从 view.ts 渐进拆分 P3）
// 纯函数：从文本/DataTransfer/Electron 剪贴板提取文件路径，零 view 依赖。
import * as path from "path";

/** 检查原生文件路径是否可用：非空 + 无替换符 + 无控制字符（除 \t \n \r） */
export function isUsableNativeFilePath(filePath: string): boolean {
  if (!filePath.trim()) return false;
  if (filePath.includes("\uFFFD")) return false;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(filePath)) return false;
  return true;
}

/** file:// URI → 本地路径（处理 Windows UNC + 盘符 + POSIX 分隔符） */
export function parseFileUriToPath(rawUri: string): string {
  try {
    const uri = new URL(rawUri);
    if (uri.protocol !== "file:") return rawUri;
    const decodedPath = decodeURIComponent(uri.pathname || "");
    if (uri.hostname) {
      return `\\\\${uri.hostname}${decodedPath.replace(/\//g, "\\")}`;
    }
    if (/^\/[A-Za-z]:/.test(decodedPath)) {
      return decodedPath.slice(1).replace(/\//g, "\\");
    }
    return decodedPath.replace(/\//g, path.sep);
  } catch {
    return rawUri.replace(/^file:\/+/i, "").replace(/\//g, path.sep);
  }
}

/** 从多行文本提取文件路径（支持 file:// URI 和可选的原始绝对路径） */
export function extractPastedFilePaths(text: string, options?: { allowRawAbsolutePaths?: boolean }): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let candidate = rawLine.trim();
    if (!candidate) continue;
    candidate = candidate.replace(/^["'`]+|["'`]+$/g, "");
    const isFileUri = /^file:\/\//i.test(candidate);
    if (isFileUri) {
      candidate = parseFileUriToPath(candidate);
    } else {
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
        // Keep the original text if it is not URL encoded.
      }
    }
    const looksLikePath = path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate);
    if (!looksLikePath) continue;
    if (!isFileUri && !options?.allowRawAbsolutePaths) continue;
    if (!isUsableNativeFilePath(candidate)) continue;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      paths.push(candidate);
    }
  }
  return paths;
}

/** 从 File 对象提取原生文件路径（Electron file.path 或 webUtils.getPathForFile） */
export function extractNativeFilePath(file: File): string | null {
  const electronFile = file as File & { path?: string };
  if (typeof electronFile.path === "string" && electronFile.path.trim().length > 0) {
    return electronFile.path;
  }
  try {
    const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
    const electron = requireFn?.("electron") as { webUtils?: { getPathForFile?: (file: File) => string } } | undefined;
    const filePath = electron?.webUtils?.getPathForFile?.(file);
    return typeof filePath === "string" && filePath.trim().length > 0 ? filePath : null;
  } catch {
    return null;
  }
}

/** 从 FileList 提取原生文件路径数组 */
export function extractPathsFromFileList(files: FileList | null | undefined): string[] {
  if (!files?.length) return [];
  return Array.from(files)
    .map((file) => extractNativeFilePath(file))
    .filter((filePath): filePath is string => !!filePath);
}

/** 从 DataTransfer 提取文件路径（FileList + text/uri-list） */
export function collectFilePathsFromDataTransfer(data: DataTransfer | null): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  const addPath = (filePath: string | null | undefined) => {
    const trimmed = filePath?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    paths.push(trimmed);
  };

  if (!data) return paths;
  for (const filePath of extractPathsFromFileList(data.files)) addPath(filePath);

  // 只从原生 file / uri-list 通道提取文件；普通 text/plain 即使像路径，也保持原文本输入。
  const uriList = data.getData("text/uri-list");
  for (const filePath of extractPastedFilePaths(uriList)) addPath(filePath);

  return paths;
}

/** 从 Electron 剪贴板读取文件路径（uri-list + FileNameW/FileName 原生格式） */
export function readElectronClipboardFilePaths(): string[] {
  try {
    const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
    const electron = requireFn?.("electron") as {
      clipboard?: {
        availableFormats?: () => string[];
        readText?: (type?: string) => string;
        readBuffer?: (format: string) => Buffer;
      };
    } | undefined;
    const clipboard = electron?.clipboard;
    if (!clipboard) return [];

    const values: string[] = [];
    const addText = (text: string | undefined, options?: { allowRawAbsolutePaths?: boolean }) => {
      if (!text) return;
      for (const filePath of extractPastedFilePaths(text, options)) values.push(filePath);
    };

    for (const format of clipboard.availableFormats?.() ?? []) {
      if (/text\/uri-list/i.test(format)) {
        try {
          addText(clipboard.readText?.(format));
        } catch {
          // Some native formats are buffer-only.
        }
      }
    }

    for (const format of ["FileNameW", "FileName", "text/uri-list"]) {
      try {
        const buffer = clipboard.readBuffer?.(format);
        if (!buffer || buffer.length === 0) continue;
        const text = format === "FileNameW" ? buffer.toString("utf16le") : buffer.toString("utf8");
        addText(text.replace(/\0/g, "\n"), { allowRawAbsolutePaths: format !== "text/uri-list" });
      } catch {
        // Native clipboard formats vary by OS/Electron version.
      }
    }

    return Array.from(new Set(values));
  } catch {
    return [];
  }
}
