// LLM CLI Bridge — Safe Storage Provider (V20.2)
//
// 使用 Electron safeStorage 对 API Key 做本机加密后持久化。
// 加密后的密文写入 runtime-provider.json 的 encryptedApiKey 字段（base64），
// 明文 apiKey 字段不再写入磁盘。
//
// 回退策略：
// - safeStorage 不可用（非 Electron 环境 / 系统不支持加密）时，明文回退到内存，
//   不落盘。用户重启后需重新输入。
// - 读取时优先解密 encryptedApiKey；不存在时回退到旧明文 apiKey（兼容迁移）。
//
// 仅用于 Codex/本地中转，不扩到 Pi、Claude。

/** 加密后的 API Key 存储格式 */
export interface EncryptedKeyStore {
  /** base64 编码的加密密文 */
  readonly encryptedApiKey?: string;
  /** 旧明文 Key（仅迁移期读取，不再写入） */
  readonly legacyApiKey?: string;
}

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
