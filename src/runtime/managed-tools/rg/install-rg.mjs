// LLM CLI Bridge — V17-RG B2 Managed ripgrep installer。
//
// 由 rgManagedInstallerBridge.ts 动态导入（避免主 bundle 内联下载逻辑）。
//
// 安装流程：
//   1. 读取 manifest，解析当前平台条目
//   2. fixture 模式直接返回（无需下载）
//   3. 已安装且 verified 直接返回
//   4. 下载 artifact zip → 校验 artifactSha256 → 解压取出 binary
//   5. 临时文件写入 → 原子 rename 到目标路径
//   6. 校验 binary sha256 + size → 标记完整性已验证
//
// 仅使用 Node.js 内置模块（零安装要求）。

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * 安装托管 rg（从 plugin 内 manifest 解析，按需下载 artifact）。
 * @param {{ confirm?: boolean }} options
 * @returns {Promise<import("./rgManagedInstallerBridge").ManagedToolInstallStatus>}
 */
export async function ensureManagedToolInstalled(options = {}) {
  // 从 import.meta.url 推导 manifest 目录
  const installerDir = dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
  const manifestPath = join(installerDir, "rg-manifest.json");

  if (!existsSync(manifestPath)) {
    return fail("manifest-not-found", `manifest not found: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return fail("manifest-invalid", `manifest parse failed: ${e.message}`);
  }

  // fixture：无需安装
  if (manifest.fixture === true) {
    return readStatus(manifestPath, manifest, "installed");
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const entry = manifest.platforms?.[platformKey];
  if (!entry) {
    return fail("platform-not-found", `platform ${platformKey} not in manifest`);
  }

  const targetPath = resolve(installerDir, entry.path);
  const targetDir = dirname(targetPath);

  // 已存在且校验通过：跳过下载
  if (existsSync(targetPath)) {
    const existingSha = await hashFileSha256(targetPath);
    if (existingSha === entry.sha256) {
      const st = statSync(targetPath);
      if (st.size === entry.size) {
        return readStatus(manifestPath, manifest, "installed");
      }
    }
  }

  // 需要 artifact 下载
  if (!entry.artifact?.url) {
    return fail("no-artifact", `binary missing and no artifact.url in manifest for ${platformKey}`);
  }

  // 确保目标目录存在
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    return fail("mkdir-failed", `cannot create target dir ${targetDir}: ${e.message}`);
  }

  // 下载 artifact zip 到临时文件
  const tmpZip = `${targetPath}.${process.pid}.tmp.zip`;
  try {
    await downloadToFile(entry.artifact.url, tmpZip);
  } catch (e) {
    safeUnlink(tmpZip);
    return fail("download-failed", `download artifact failed: ${e.message}`);
  }

  // 校验 artifact sha256
  const artifactSha = await hashFileSha256(tmpZip);
  if (entry.artifact.artifactSha256 && artifactSha !== entry.artifact.artifactSha256) {
    safeUnlink(tmpZip);
    return fail("artifact-sha-mismatch", `artifact sha256 mismatch: expected ${entry.artifact.artifactSha256}, got ${artifactSha}`);
  }

  // 解压取出 binary 到临时文件
  const tmpBinary = `${targetPath}.${process.pid}.tmp.bin`;
  try {
    await extractZipEntry(tmpZip, entry.artifact.vendorPath, tmpBinary);
  } catch (e) {
    safeUnlink(tmpZip);
    safeUnlink(tmpBinary);
    return fail("extract-failed", `extract binary from zip failed: ${e.message}`);
  }

  // 校验 binary sha256 + size
  const binarySha = await hashFileSha256(tmpBinary);
  if (binarySha !== entry.sha256) {
    safeUnlink(tmpZip);
    safeUnlink(tmpBinary);
    return fail("binary-sha-mismatch", `binary sha256 mismatch: expected ${entry.sha256}, got ${binarySha}`);
  }
  const binaryStat = statSync(tmpBinary);
  if (binaryStat.size !== entry.size) {
    safeUnlink(tmpZip);
    safeUnlink(tmpBinary);
    return fail("binary-size-mismatch", `binary size mismatch: expected ${entry.size}, got ${binaryStat.size}`);
  }

  // 原子替换：rename tmpBinary → targetPath
  // Windows 上如果目标文件被占用 rename 可能失败，重试几次
  safeUnlink(tmpZip);
  let renamed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // 先尝试删除目标（如果存在），再 rename
      if (existsSync(targetPath)) {
        try { unlinkSync(targetPath); } catch { /* Windows 可能锁定 */ }
      }
      renameSync(tmpBinary, targetPath);
      renamed = true;
      break;
    } catch (e) {
      if (attempt < 2) {
        await sleep(200 * (attempt + 1));
      }
    }
  }
  if (!renamed) {
    safeUnlink(tmpBinary);
    return fail("rename-failed", `atomic rename failed after retries: ${targetPath}`);
  }

  // Unix 下设置可执行权限
  if (process.platform !== "win32") {
    try {
      const { chmodSync } = await import("node:fs");
      chmodSync(targetPath, 0o755);
    } catch { /* best-effort */ }
  }

  return readStatus(manifestPath, manifest, "installed");
}

// --- helpers ---

function fail(status, error) {
  return {
    required: false,
    version: null,
    size: null,
    source: null,
    sha256: null,
    installPath: null,
    status,
    error,
  };
}

function readStatus(manifestPath, manifest, status) {
  const platformKey = `${process.platform}-${process.arch}`;
  const entry = manifest.platforms?.[platformKey];
  const installPath = entry ? resolve(dirname(manifestPath), entry.path) : null;
  return {
    required: false,
    version: manifest.version || null,
    size: entry?.size ?? null,
    source: entry?.artifact?.url || null,
    sha256: entry?.sha256 || null,
    installPath,
    status,
    error: null,
    toolExecutable: existsSync(installPath || ""),
  };
}

function safeUnlink(p) {
  try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hashFileSha256(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

/**
 * 下载 URL 到本地文件（支持重定向）。
 */
async function downloadToFile(url, dest) {
  // 动态 import https/http（避免顶层 import 在非 Node 环境报错）
  const protocol = url.startsWith("https:") ? await import("node:https") : await import("node:http");
  return new Promise((resolveDownload, reject) => {
    const get = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error("too many redirects"));
        return;
      }
      const req = protocol.get(currentUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const location = res.headers.location;
          res.resume();
          if (location) {
            get(location, redirectCount + 1);
          } else {
            reject(new Error(`redirect without location: ${res.statusCode}`));
          }
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}: ${currentUrl}`));
          return;
        }
        const ws = createWriteStream(dest);
        pipeline(res, ws).then(resolveDownload).catch(reject);
      });
      req.on("error", reject);
      req.setTimeout(60000, () => {
        req.destroy(new Error("download timeout"));
      });
    };
    get(url);
  });
}

/**
 * 从 zip 文件中提取指定 entry 到目标路径。
 * 使用 Node.js 内置 zlib 解压（不依赖 npm 包）。
 *
 * 简化实现：解压整个 zip 的 central directory，找到匹配 vendorPath 的 entry，
 * 读取其 local header 定位数据偏移，inflate 到目标文件。
 */
async function extractZipEntry(zipPath, entryPath, destPath) {
  const data = readFileSync(zipPath);
  // 查找 End of Central Directory Record (EOCD)
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("EOCD not found in zip");

  const cdOffset = data.readUInt32LE(eocdOffset + 16);
  const cdEntries = data.readUInt16LE(eocdOffset + 10);

  // 遍历 central directory entries
  let offset = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) break;
    const compMethod = data.readUInt16LE(offset + 10);
    const compSize = data.readUInt32LE(offset + 20);
    const uncompSize = data.readUInt32LE(offset + 24);
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const localHeaderOffset = data.readUInt32LE(offset + 42);
    const name = data.slice(offset + 46, offset + 46 + nameLen).toString("utf8");

    if (name === entryPath) {
      // 读取 local header
      if (data.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`invalid local header for ${entryPath}`);
      }
      const localNameLen = data.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = data.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressed = data.slice(dataOffset, dataOffset + compSize);

      let decompressed;
      if (compMethod === 0) {
        decompressed = compressed;
      } else if (compMethod === 8) {
        decompressed = zlib.inflateRawSync(compressed);
      } else {
        throw new Error(`unsupported compression method ${compMethod} for ${entryPath}`);
      }

      if (decompressed.length !== uncompSize) {
        throw new Error(`size mismatch after decompress: expected ${uncompSize}, got ${decompressed.length}`);
      }

      // 写入目标文件（临时文件，后续 rename）
      const { writeFileSync } = await import("node:fs");
      writeFileSync(destPath, decompressed);
      return;
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error(`entry "${entryPath}" not found in zip`);
}
