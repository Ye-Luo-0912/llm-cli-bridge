// LLM CLI Bridge — Safe Storage Provider (V20.5)
//
// 提供 Electron safeStorage 的低层 encrypt/decrypt 原语。
// 上层由 secretsStore.ts 负责：把整份 secrets.env（Codex/Claude/Pi 三个 runtime 的
// API Key，使用各运行时官方约定的环境变量名）加密后落盘到
// .llm-bridge/private/runtime/secrets.env。
//
// 回退策略（由 secretsStore 编排）：
// - safeStorage 不可用（非 Electron 环境 / 系统不支持加密）时，若用户明确同意
//   allowPlaintextSecretsFallback，明文写入 .secrets.plain；否则仅内存有效
//   （session-only，重载丢失）。
//
// 三个 runtime 的密钥彼此独立，互不混用。

let safeStorageRef: {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
} | null | undefined;

/**
 * 懒加载 Electron safeStorage。
 * 在非 Electron 环境（测试/Node CLI）返回 null。
 */
function getSafeStorage(): typeof safeStorageRef {
  if (safeStorageRef !== undefined) return safeStorageRef;
  try {
    // esbuild.config.mjs 将 "electron" 标记为 external，运行时由 Obsidian 内置 Electron 提供
    const electron = require("electron");
    safeStorageRef = electron?.safeStorage ?? null;
  } catch {
    safeStorageRef = null;
  }
  return safeStorageRef;
}

/**
 * 检查 safeStorage 是否可用（Electron 环境 + 系统支持加密）。
 */
export function isSafeStorageAvailable(): boolean {
  const storage = getSafeStorage();
  return !!storage && storage.isEncryptionAvailable();
}

/**
 * 加密 API Key。返回 base64 字符串。
 * safeStorage 不可用时返回 null（调用方应仅保存在内存中）。
 */
export function encryptApiKey(plainKey: string): string | null {
  const storage = getSafeStorage();
  if (!storage || !storage.isEncryptionAvailable()) return null;
  if (!plainKey) return null;
  const encrypted = storage.encryptString(plainKey);
  return Buffer.from(encrypted).toString("base64");
}

/**
 * 解密 API Key。返回明文字符串。
 * 解密失败或 safeStorage 不可用时返回 null。
 */
export function decryptApiKey(encryptedBase64: string): string | null {
  const storage = getSafeStorage();
  if (!storage || !storage.isEncryptionAvailable()) return null;
  try {
    const buf = Buffer.from(encryptedBase64, "base64");
    return storage.decryptString(buf);
  } catch {
    return null;
  }
}
