// LLM CLI Bridge — Smart Image Thumbnail（从 view.ts 渐进拆分 P0）
// 纯 Canvas 算法：自动裁剪白边 + 密度方形裁剪 + 96px 缩略图生成，零 view 依赖。
import type { FileRef } from "../fileRefs";

/** 缩略图缓存（按 cacheKey 存储裁剪后的 dataURL；null 表示已处理但无产出） */
export class SmartImageThumbnailCache {
  private cache = new Map<string, string | null>();
  has(key: string): boolean { return this.cache.has(key); }
  get(key: string): string | null | undefined { return this.cache.get(key); }
  set(key: string, value: string | null): void { this.cache.set(key, value); }
}

/** 生成缓存键：FileRef 标识 + 缩略图 URL 组合 */
export function getSmartImageThumbnailCacheKey(ref: FileRef, thumbnailUrl: string): string {
  return [ref.id, ref.resolvedPath, thumbnailUrl].join("::");
}

/** 异步应用智能缩略图：命中缓存直接替换，否则延迟到下一个 tick 计算 */
export function maybeApplySmartImageThumbnail(
  previewEl: HTMLImageElement,
  cacheKey: string,
  cache: SmartImageThumbnailCache,
): void {
  if (previewEl.dataset.smartThumbPending === "true" || previewEl.dataset.smartThumbApplied === "true") return;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    previewEl.dataset.smartThumbApplied = "true";
    if (cached && previewEl.src !== cached) previewEl.src = cached;
    return;
  }
  previewEl.dataset.smartThumbPending = "true";
  window.setTimeout(() => {
    try {
      const cropped = buildSmartImageThumbnailDataUrl(previewEl);
      cache.set(cacheKey, cropped);
      previewEl.dataset.smartThumbApplied = "true";
      if (cropped && previewEl.isConnected && previewEl.src !== cropped) {
        previewEl.src = cropped;
      }
    } catch {
      cache.set(cacheKey, null);
      previewEl.dataset.smartThumbApplied = "true";
    } finally {
      delete previewEl.dataset.smartThumbPending;
    }
  }, 0);
}

/**
 * 构建智能缩略图 dataURL：
 * 1. 下采样到 256px 采样画布
 * 2. 统计显著像素（非透明、非近白），计算包围盒
 * 3. 对宽高比异常或高覆盖率的图，搜索密度最高的方形裁剪区
 * 4. 映射回原图坐标，带 padding 后绘制到 96px 缩略图画布
 */
export function buildSmartImageThumbnailDataUrl(imageEl: HTMLImageElement): string | null {
  const sourceWidth = imageEl.naturalWidth;
  const sourceHeight = imageEl.naturalHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const sampleMax = 256;
  const sampleScale = Math.min(1, sampleMax / Math.max(sourceWidth, sourceHeight));
  const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
  const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!sampleCtx) return null;
  sampleCtx.imageSmoothingEnabled = true;
  sampleCtx.imageSmoothingQuality = "high";
  sampleCtx.drawImage(imageEl, 0, 0, sampleWidth, sampleHeight);

  const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const significant = new Uint8Array(sampleWidth * sampleHeight);
  let significantCount = 0;
  let minX = sampleWidth;
  let minY = sampleHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const offset = (y * sampleWidth + x) * 4;
      const alpha = pixels[offset + 3];
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const nearWhite = red >= 248 && green >= 248 && blue >= 248;
      if (alpha < 24 || nearWhite) continue;
      significant[y * sampleWidth + x] = 1;
      significantCount += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const coverage = (cropWidth * cropHeight) / (sampleWidth * sampleHeight);
  let cropSampleX = minX;
  let cropSampleY = minY;
  let cropSampleWidth = cropWidth;
  let cropSampleHeight = cropHeight;
  let usedDenseSquareCrop = false;
  const overallDensity = significantCount / (sampleWidth * sampleHeight);
  const aspect = sourceWidth / sourceHeight;
  if (sampleWidth >= 40 && sampleHeight >= 40 && (aspect >= 1.25 || aspect <= 0.8 || coverage >= 0.75)) {
    const minDimension = Math.min(sampleWidth, sampleHeight);
    const candidateSizes = Array.from(new Set([
      Math.max(20, Math.floor(minDimension * 0.42)),
      Math.max(24, Math.floor(minDimension * 0.58)),
      Math.max(24, Math.floor(minDimension * 0.72)),
      Math.max(24, Math.floor(minDimension * 0.86)),
    ])).filter((size) => size <= minDimension);
    let bestDensity = 0;
    let bestScore = -1;
    let bestX = 0;
    let bestY = 0;
    let bestSize = 0;
    for (const squareSize of candidateSizes) {
      const step = Math.max(2, Math.floor(squareSize / 12));
      for (let y = 0; y <= sampleHeight - squareSize; y += step) {
        for (let x = 0; x <= sampleWidth - squareSize; x += step) {
          let score = 0;
          for (let yy = y; yy < y + squareSize; yy += 1) {
            const rowOffset = yy * sampleWidth;
            for (let xx = x; xx < x + squareSize; xx += 1) {
              score += significant[rowOffset + xx];
            }
          }
          const density = score / (squareSize * squareSize);
          const rankedDensity = density + (squareSize / minDimension) * 0.06;
          if (rankedDensity > bestDensity || (rankedDensity === bestDensity && score > bestScore)) {
            bestDensity = rankedDensity;
            bestScore = score;
            bestX = x;
            bestY = y;
            bestSize = squareSize;
          }
        }
      }
    }
    const bestActualDensity = bestSize > 0 ? bestScore / (bestSize * bestSize) : 0;
    if (bestActualDensity > overallDensity * 1.12 && bestScore >= 20) {
      cropSampleX = bestX;
      cropSampleY = bestY;
      cropSampleWidth = bestSize;
      cropSampleHeight = bestSize;
      usedDenseSquareCrop = true;
    } else if (coverage > 0.9) {
      return null;
    }
  } else if (coverage > 0.9) {
    return null;
  }

  const padding = usedDenseSquareCrop ? 4 : 8;
  const cropX = Math.max(0, Math.floor((cropSampleX - padding) / sampleScale));
  const cropY = Math.max(0, Math.floor((cropSampleY - padding) / sampleScale));
  const cropRight = Math.min(sourceWidth, Math.ceil((cropSampleX + cropSampleWidth + padding) / sampleScale));
  const cropBottom = Math.min(sourceHeight, Math.ceil((cropSampleY + cropSampleHeight + padding) / sampleScale));
  const finalCropWidth = Math.max(1, cropRight - cropX);
  const finalCropHeight = Math.max(1, cropBottom - cropY);

  const thumbSize = 96;
  const inset = usedDenseSquareCrop ? 2 : 4;
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbSize;
  thumbCanvas.height = thumbSize;
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) return null;
  thumbCtx.fillStyle = "#f3f5f7";
  thumbCtx.fillRect(0, 0, thumbSize, thumbSize);
  const innerSize = thumbSize - inset * 2;
  const scale = usedDenseSquareCrop
    ? Math.max(innerSize / finalCropWidth, innerSize / finalCropHeight)
    : Math.min(innerSize / finalCropWidth, innerSize / finalCropHeight);
  const drawWidth = Math.max(1, Math.round(finalCropWidth * scale));
  const drawHeight = Math.max(1, Math.round(finalCropHeight * scale));
  const drawX = Math.round((thumbSize - drawWidth) / 2);
  const drawY = Math.round((thumbSize - drawHeight) / 2);
  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.imageSmoothingQuality = "high";
  thumbCtx.filter = "contrast(1.14) saturate(1.04)";
  thumbCtx.drawImage(
    imageEl,
    cropX,
    cropY,
    finalCropWidth,
    finalCropHeight,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
  thumbCtx.filter = "none";
  return thumbCanvas.toDataURL("image/png");
}
