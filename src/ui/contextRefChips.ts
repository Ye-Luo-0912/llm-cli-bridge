// LLM CLI Bridge — Context Ref Chip 渲染（从 view.ts 渐进拆分 P4）
// 纯渲染：pinned context + files context section + ref chip + visual + badge label。
import { setIcon } from "obsidian";
import type { FileRef } from "../fileRefs";
import { getFileRefShortLabel } from "./fileRefMetaUtil";

/** Context chip 渲染依赖注入 */
export interface ContextRefChipDeps {
  /** FileRef → 显示路径 */
  fileRefDisplayPath: (ref: FileRef) => string;
  /** FileRef → 徽章标签（pinned/session/external/preview/attached · type） */
  fileRefBadgeLabel: (ref: FileRef) => string;
  /** FileRef → 缩略图 URL（image 类型） */
  getFileRefThumbnailUrl: (ref: FileRef) => string | null;
  /** FileRef → 图标名 */
  getFileRefIconName: (ref: FileRef) => string;
  /** 渲染文档预览缩略图 */
  renderDocumentPreviewThumb: (parent: HTMLElement, thumbClass: string, lineClass: string, ref: FileRef, maxLines: number, maxChars: number) => void;
  /** 打开文件预览 */
  openFileRefPreview: (ref: FileRef) => void;
  /** 复制文件引用到剪贴板 */
  copyFileRefToClipboard: (ref: FileRef) => void;
  /** 取消 pin */
  unpinFileRef: (refId: string) => void;
  /** 移除上下文文件引用 */
  removeContextFileRef: (refId: string) => void;
  /** 获取文件引用预览文本（用于 badge label 判断） */
  getFileRefPreviewText: (ref: FileRef) => string | null;
}

/** 渲染 pinned context 区块（summary + chips） */
export function renderPinnedContext(
  container: HTMLElement,
  pinnedFileRefs: ReadonlyArray<FileRef>,
  deps: ContextRefChipDeps,
): void {
  container.empty();
  if (pinnedFileRefs.length === 0) {
    container.setAttribute("hidden", "");
    return;
  }
  container.removeAttribute("hidden");
  container.createEl("summary", { text: `Pinned context (${pinnedFileRefs.length})` });
  const body = container.createDiv({ cls: "llm-bridge-pinned-context-body" });
  for (const ref of pinnedFileRefs) {
    renderContextRefChip(body, ref, { allowUnpin: true, allowRemove: true }, deps);
  }
}

/** 渲染 files context 区块（current + pinned + session 三段） */
export function renderFilesContext(
  container: HTMLElement,
  options: {
    messageFileRefs: ReadonlyArray<FileRef>;
    pinnedFileRefs: ReadonlyArray<FileRef>;
    sessionFileRefs: ReadonlyArray<FileRef>;
  },
  deps: ContextRefChipDeps,
): void {
  container.empty();
  renderFileContextSection(container, {
    variant: "current",
    icon: "paperclip",
    title: "本轮附件",
    description: "仅随下一条消息发送；移除不会删除原文件。",
    refs: options.messageFileRefs,
    emptyText: "拖拽、粘贴或输入 @ 添加文件。",
    actions: { allowRemove: true, allowCopy: true },
  }, deps);
  // 旧会话 Pin：只读入口（查看/复制/移除），不提供新建 Pin
  if (options.pinnedFileRefs.length > 0) {
    renderFileContextSection(container, {
      variant: "pinned",
      icon: "pin",
      title: "旧会话上下文",
      description: "来自升级前的 Pin；可查看、复制或移除，不再支持新建。",
      refs: options.pinnedFileRefs,
      emptyText: "",
      actions: { allowUnpin: true, allowRemove: true, allowCopy: true },
    }, deps);
  }
  renderFileContextSection(container, {
    variant: "session",
    icon: "shield-check",
    title: "会话授权",
    description: "本会话允许的外部文件读取。",
    refs: options.sessionFileRefs,
    emptyText: "外部读取授权批准后会出现在这里。",
    actions: { allowRemove: true, allowCopy: true },
  }, deps);
}

/** 渲染单个 context section（head + body + chips） */
export function renderFileContextSection(
  container: HTMLElement,
  options: {
    variant: string;
    icon: string;
    title: string;
    description: string;
    refs: ReadonlyArray<FileRef>;
    emptyText: string;
    actions: { allowPin?: boolean; allowUnpin?: boolean; allowRemove?: boolean; allowCopy?: boolean };
  },
  deps: ContextRefChipDeps,
): void {
  const section = container.createDiv({ cls: `llm-bridge-context-section is-${options.variant}` });
  const head = section.createDiv({ cls: "llm-bridge-context-section-head" });
  const icon = head.createEl("span", { cls: "llm-bridge-context-section-icon" });
  setIcon(icon, options.icon);
  const titleWrap = head.createDiv({ cls: "llm-bridge-context-section-title" });
  titleWrap.createEl("strong", { text: options.title });
  titleWrap.createEl("span", { text: options.description });
  head.createEl("span", { cls: "llm-bridge-context-section-count", text: String(options.refs.length) });

  const body = section.createDiv({ cls: "llm-bridge-context-section-body" });
  if (options.refs.length === 0) {
    body.createEl("span", { cls: "llm-bridge-context-empty", text: options.emptyText });
    return;
  }
  for (const ref of options.refs) renderContextRefChip(body, ref, options.actions, deps);
}

/** 渲染单个 context ref chip（visual + text + badge + actions） */
export function renderContextRefChip(
  container: HTMLElement,
  ref: FileRef,
  options: { allowPin?: boolean; allowUnpin?: boolean; allowRemove?: boolean; allowCopy?: boolean },
  deps: ContextRefChipDeps,
): void {
  const chip = container.createDiv({
    cls: `llm-bridge-context-ref-chip is-${ref.kind} is-${ref.status} is-${ref.fileType}`,
    attr: { title: `${ref.displayName}\n${deps.fileRefDisplayPath(ref)}\n${deps.fileRefBadgeLabel(ref)}` },
  });
  chip.addEventListener("click", () => void deps.openFileRefPreview(ref));
  renderContextRefVisual(chip, ref, deps);
  const text = chip.createDiv({ cls: "llm-bridge-context-ref-text" });
  text.createEl("span", { cls: "llm-bridge-context-ref-name", text: ref.displayName, attr: { title: ref.resolvedPath } });
  text.createEl("span", { cls: "llm-bridge-context-ref-meta", text: deps.fileRefDisplayPath(ref), attr: { title: ref.resolvedPath } });
  chip.createEl("span", { cls: "llm-bridge-context-ref-mode", text: deps.fileRefBadgeLabel(ref) });
  // 普通 UI 不再提供新建 Pin（allowPin 保留类型兼容，但不渲染）
  if (options.allowCopy) {
    const copyBtn = chip.createEl("button", { cls: "llm-bridge-context-ref-action is-copy", attr: { title: "复制", "aria-label": `复制 ${ref.displayName}` } });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void deps.copyFileRefToClipboard(ref);
    });
  }
  if (options.allowUnpin) {
    const unpinActionBtn = chip.createEl("button", { cls: "llm-bridge-context-ref-action is-unpin", attr: { title: "从旧会话上下文移除", "aria-label": "从旧会话上下文移除" } });
    setIcon(unpinActionBtn, "pin-off");
    unpinActionBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.unpinFileRef(ref.id);
    });
  }
  if (options.allowRemove) {
    const removeBtn = chip.createEl("button", { cls: "llm-bridge-context-ref-remove is-remove", attr: { title: "移除", "aria-label": "移除" } });
    setIcon(removeBtn, "x");
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.removeContextFileRef(ref.id);
    });
  }
}

/** 渲染 chip 的视觉部分（缩略图 / 文档预览 / 图标） */
export function renderContextRefVisual(parent: HTMLElement, ref: FileRef, deps: ContextRefChipDeps): void {
  const visual = parent.createEl("span", { cls: "llm-bridge-context-ref-icon llm-bridge-context-ref-thumb" });
  const thumbnailUrl = ref.fileType === "image" ? deps.getFileRefThumbnailUrl(ref) : null;
  if (thumbnailUrl) {
    visual.addClass("has-image-preview");
    visual.style.setProperty("background-image", `url("${thumbnailUrl.replace(/"/g, '\\"')}")`);
    const fallback = visual.createEl("span", { cls: "llm-bridge-context-ref-visual-icon is-fallback" });
    setIcon(fallback, deps.getFileRefIconName(ref));
    const preview = new Image();
    preview.addEventListener("load", () => visual.addClass("is-preview-loaded"));
    preview.addEventListener("error", () => {
      visual.removeClass("has-image-preview");
      visual.removeClass("is-preview-loaded");
      visual.addClass("is-preview-missing");
      visual.style.removeProperty("background-image");
    });
    preview.src = thumbnailUrl;
    return;
  }
  if (ref.fileType !== "image") {
    visual.addClass("has-document-preview");
    deps.renderDocumentPreviewThumb(visual, "llm-bridge-context-ref-doc-thumb", "llm-bridge-context-ref-doc-line", ref, 4, 18);
    return;
  }
  const fileIcon = visual.createEl("span", { cls: "llm-bridge-context-ref-visual-icon" });
  setIcon(fileIcon, deps.getFileRefIconName(ref));
}

/** FileRef → 徽章标签（scope/kind + type） */
export function fileRefBadgeLabel(ref: FileRef, previewText: string | null): string {
  const type = getFileRefShortLabel(ref).toLowerCase();
  if (ref.scope === "pinned") return `pinned · ${type}`;
  if (ref.scope === "session") return `session · ${type}`;
  if (ref.kind === "external") return `external · ${type}`;
  if (previewText) {
    return `preview · ${type}`;
  }
  return `attached · ${type}`;
}
