// LLM CLI Bridge — Composer controller (structure extract, no visual change)
//
// Owns menu surfaces, permission/model picker DOM, attachment tokens, autoGrow,
// status-rail apply, and file-drag surface bind.
// LLMBridgeView supplies settings/session mutation and file-ingest callbacks.

import * as path from "path";
import { setIcon } from "obsidian";
import {
  AGENT_APPROVAL_PROFILES,
  getAgentApprovalProfileInfo,
  type AgentApprovalProfile,
} from "../agentApprovalProfile";
import type { FileRef } from "../fileRefs";
import type { RuntimeModelCatalog } from "../runtimeModelCatalog";
import { findEffortEntry, findModelEntry } from "../runtimeModelCatalog";

export interface ComposerMenuItemOptions {
  className: string;
  icon?: string;
  title: string;
  description?: string;
  meta?: string;
  badge?: string;
  active?: boolean;
  danger?: boolean;
  data?: Record<string, string>;
  iconClass?: string;
  bodyClass?: string;
  titleClass?: string;
  descClass?: string;
  checkClass?: string;
}

export interface ComposerAttachmentTokenDeps {
  selectedAttachmentId: string | null;
  getFileRefThumbnailUrl: (ref: FileRef) => string | null;
  getFileRefIconName: (ref: FileRef) => string;
  getSmartImageThumbnailCacheKey: (ref: FileRef, url: string) => string;
  maybeApplySmartImageThumbnail: (img: HTMLImageElement, cacheKey: string) => void;
  openFileRefPreview: (ref: FileRef) => void;
  showAttachmentContextMenu: (
    event: MouseEvent,
    ref: FileRef,
    options: { allowRemove: boolean; allowOpen: boolean },
  ) => void;
  closeAttachmentContextMenu: () => void;
}

export interface ComposerAttachmentMenuDeps {
  setActivePopup: (kind: "attachment" | null) => void;
  copyFileRefToClipboard: (ref: FileRef) => void;
  openPathWithSystemDefault: (target: string) => void;
  removeMessageFileRef: (id: string) => void;
  getSelectedAttachmentId: () => string | null;
  setSelectedAttachmentId: (id: string | null) => void;
}

export interface ComposerAttachmentKeydownDeps {
  getInputValue: () => string;
  getSelectionRange: () => { start: number; end: number };
  getMessageFileRefs: () => ReadonlyArray<FileRef>;
  getSelectedAttachmentId: () => string | null;
  setSelectedAttachmentId: (id: string | null) => void;
  removeMessageFileRef: (id: string) => void;
  renderComposerFileRefs: () => void;
}

/** 空输入 52–64px；有内容最多 128px */
export function autoGrowInput(el: HTMLTextAreaElement | null | undefined): void {
  if (!el) return;
  el.style.height = "auto";
  const emptyH = 56;
  const max = 128;
  if (!el.value.trim()) {
    el.style.height = `${emptyH}px`;
    el.removeClass("is-auto-grown");
    return;
  }
  const next = Math.min(Math.max(el.scrollHeight, 64), max);
  el.style.height = `${next}px`;
  el.addClass("is-auto-grown");
}

export function shortAttachmentName(name: string, max = 14): string {
  const base = (name || "file").trim();
  if (base.length <= max) return base;
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  const keep = Math.max(4, max - ext.length - 1);
  return `${stem.slice(0, keep)}…${ext}`;
}

export function eventTargetElement(event: Event): HTMLElement | null {
  const target = event.target;
  if (target instanceof HTMLElement) return target;
  if (target instanceof Text) return target.parentElement;
  return target instanceof Element ? (target as HTMLElement) : null;
}

export function isEventInsideSelector(event: Event, selector: string): boolean {
  const pathNodes = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of pathNodes) {
    if (node instanceof HTMLElement && (node.matches(selector) || !!node.closest(selector))) {
      return true;
    }
  }
  const target = eventTargetElement(event);
  return !!target?.closest(selector);
}

export function createComposerMenuSurface(parent: HTMLElement, className: string, hidden = false): HTMLDivElement {
  const surface = parent.createDiv({ cls: `llm-bridge-menu-surface ${className}` });
  if (hidden) surface.setAttribute("hidden", "");
  surface.addEventListener("pointerdown", (event) => event.stopPropagation());
  surface.addEventListener("click", (event) => event.stopPropagation());
  return surface;
}

export function createComposerMenuItem(parent: HTMLElement, options: ComposerMenuItemOptions): HTMLButtonElement {
  const classes = ["llm-bridge-menu-item", options.className];
  if (options.active) classes.push("is-active");
  if (options.danger) classes.push("is-danger");
  const attr: Record<string, string> = { type: "button" };
  for (const [key, value] of Object.entries(options.data ?? {})) attr[key] = value;
  const item = parent.createEl("button", { cls: classes.join(" "), attr });
  if (options.icon) {
    const iconEl = item.createEl("span", { cls: `llm-bridge-menu-item-icon ${options.iconClass ?? ""}`.trim() });
    setIcon(iconEl, options.icon);
  }
  const body = item.createDiv({ cls: `llm-bridge-menu-item-body ${options.bodyClass ?? ""}`.trim() });
  const titleRow = body.createDiv({ cls: "llm-bridge-menu-item-title-row" });
  titleRow.createEl("span", { cls: `llm-bridge-menu-item-title ${options.titleClass ?? ""}`.trim(), text: options.title });
  if (options.badge) titleRow.createEl("span", { cls: "llm-bridge-menu-item-badge", text: options.badge });
  if (options.meta) body.createEl("span", { cls: "llm-bridge-menu-item-meta", text: options.meta });
  if (options.description) {
    body.createEl("span", {
      cls: `llm-bridge-menu-item-desc ${options.descClass ?? ""}`.trim(),
      text: options.description,
    });
  }
  item.createEl("span", { cls: `llm-bridge-menu-item-check ${options.checkClass ?? ""}`.trim(), text: "✓" });
  return item;
}

export function refreshPermissionModeChip(chip: HTMLElement, profile: AgentApprovalProfile): void {
  const info = getAgentApprovalProfileInfo(profile);
  chip.empty();
  setIcon(chip.createEl("span", { cls: "llm-bridge-permission-chip-icon" }), info.icon);
  chip.createEl("span", { cls: "llm-bridge-permission-chip-label", text: info.shortLabel });
  chip.setAttribute("aria-label", info.title);
  chip.setAttribute("title", `${info.title}\n${info.description}\n点击切换`);
  chip.classList.remove("is-safe", "is-caution", "is-danger", "is-ask", "is-auto", "is-full-access");
  chip.classList.add(`is-${profile}`);
}

/** 权限菜单：请求批准 / 替我审批 / 完全访问（计划模式已移出） */
export function renderPermissionPopover(
  mountEl: HTMLElement,
  current: AgentApprovalProfile,
  deps: {
    onSelectProfile: (profile: AgentApprovalProfile) => void | Promise<void>;
    close: () => void;
  },
): HTMLDivElement {
  const popover = createComposerMenuSurface(mountEl, "llm-bridge-perm-popover", true);

  const head = popover.createDiv({ cls: "llm-bridge-perm-popover-head" });
  head.createEl("span", {
    cls: "llm-bridge-perm-popover-question",
    text: "应如何批准 Agent 操作？",
  });

  const list = popover.createDiv({ cls: "llm-bridge-perm-popover-list" });
  for (const profile of AGENT_APPROVAL_PROFILES) {
    const opt = list.createEl("button", {
      cls: `llm-bridge-perm-option is-profile-${profile.id}${current === profile.id ? " is-active" : ""}`,
      attr: {
        type: "button",
        "data-approval-profile": profile.id,
      },
    });
    const iconEl = opt.createEl("span", { cls: "llm-bridge-perm-option-icon" });
    setIcon(iconEl, profile.icon);
    const text = opt.createDiv({ cls: "llm-bridge-perm-option-text" });
    text.createEl("span", { cls: "llm-bridge-perm-option-title", text: profile.title });
    text.createEl("span", { cls: "llm-bridge-perm-option-desc", text: profile.description });
    const check = opt.createEl("span", { cls: "llm-bridge-perm-option-check" });
    setIcon(check, "check");
    opt.addEventListener("pointerdown", (event) => event.stopPropagation());
    opt.addEventListener("click", async (event) => {
      event.stopPropagation();
      deps.close();
      await deps.onSelectProfile(profile.id);
    });
  }
  return popover;
}

export function renderModelEffortOptions(
  modelOptionsEl: HTMLElement,
  effortOptionsEl: HTMLElement,
  catalog: RuntimeModelCatalog,
  currentEffort: string,
  currentModel: string,
  deps: {
    onSelect: (model: string, effort: string) => void;
    close: () => void;
  },
): void {
  modelOptionsEl.empty();
  effortOptionsEl.empty();
  for (const model of catalog.models) {
    const option = modelOptionsEl.createEl("button", {
      cls: "llm-bridge-model-option",
      text: model.label,
      attr: { "data-model": model.value },
    });
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.close();
      deps.onSelect(model.value, currentEffort);
    });
  }
  for (const effort of catalog.efforts) {
    const option = effortOptionsEl.createEl("button", {
      cls: "llm-bridge-effort-option",
      text: effort.label,
      attr: { "data-effort": effort.value },
    });
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.close();
      deps.onSelect(currentModel, effort.value);
    });
  }
}

export function refreshModelEffortPickerLabels(
  buttonEl: HTMLElement,
  effortChipEl: HTMLElement | null | undefined,
  popoverEl: HTMLElement | null | undefined,
  catalog: RuntimeModelCatalog,
  modelValue: string,
  effortValue: string,
): void {
  const model = findModelEntry(catalog, modelValue);
  const effort = findEffortEntry(catalog, effortValue);
  const modelLabel = model?.label ?? modelValue ?? "unknown";
  const effortLabel = effort?.label ?? effortValue ?? "unknown";
  buttonEl.textContent = `${modelLabel} · ${effortLabel}`;
  if (effortChipEl) effortChipEl.textContent = effortLabel;
  const currentModelValue = model?.value ?? modelValue;
  const currentEffortValue = effort?.value ?? effortValue;
  popoverEl?.querySelectorAll<HTMLElement>(".llm-bridge-model-option").forEach((option) => {
    option.classList.toggle("is-active", option.getAttribute("data-model") === currentModelValue);
  });
  popoverEl?.querySelectorAll<HTMLElement>(".llm-bridge-effort-option").forEach((option) => {
    option.classList.toggle("is-active", option.getAttribute("data-effort") === currentEffortValue);
  });
}

export function renderComposerFileRefs(
  container: HTMLElement,
  refs: ReadonlyArray<FileRef>,
  selectedId: string | null,
  deps: {
    renderToken: (container: HTMLElement, ref: FileRef, allowRemove: boolean) => void;
    setSelectedAttachmentId: (id: string | null) => void;
  },
): string | null {
  container.empty();
  const visibleRefs = refs.filter((ref) => ref.kind === "vault" || ref.kind === "attachment" || ref.kind === "external");
  if (visibleRefs.length === 0) {
    deps.setSelectedAttachmentId(null);
    container.setAttribute("hidden", "");
    return null;
  }
  container.removeAttribute("hidden");
  const maxVisible = 4;
  const visible = visibleRefs.slice(0, maxVisible);
  const overflow = visibleRefs.length - visible.length;
  for (const ref of visible) {
    deps.renderToken(container, ref, true);
  }
  if (overflow > 0) {
    container.createEl("span", {
      cls: "llm-bridge-attachment-more",
      text: `+${overflow}`,
      attr: { title: `还有 ${overflow} 个附件` },
    });
  }
  return selectedId && visibleRefs.some((ref) => ref.id === selectedId) ? selectedId : selectedId;
}

export function renderComposerAttachmentToken(
  container: HTMLElement,
  ref: FileRef,
  allowRemove: boolean,
  deps: ComposerAttachmentTokenDeps,
): void {
  const isImage = ref.fileType === "image";
  const token = container.createDiv({
    cls: `llm-bridge-attachment-token is-${isImage ? "image" : "file"}${deps.selectedAttachmentId === ref.id ? " is-selected" : ""}`,
    attr: { "data-ref-id": ref.id },
  });
  const preview = token.createEl("button", {
    cls: "llm-bridge-attachment-token-preview",
    attr: {
      type: "button",
      title: `预览：${ref.displayName}`,
      "aria-label": `预览 ${ref.displayName}`,
    },
  });
  if (isImage) {
    const thumbnailUrl = deps.getFileRefThumbnailUrl(ref);
    if (thumbnailUrl) {
      const img = preview.createEl("img", {
        cls: "llm-bridge-attachment-token-thumb llm-bridge-composer-file-image",
        attr: { src: thumbnailUrl, alt: ref.displayName },
      });
      img.addEventListener("error", () => {
        img.remove();
        const icon = preview.createEl("span", { cls: "llm-bridge-attachment-token-icon llm-bridge-composer-file-icon is-fallback" });
        setIcon(icon, "image");
      });
      img.addEventListener("load", () => {
        deps.maybeApplySmartImageThumbnail(img, deps.getSmartImageThumbnailCacheKey(ref, thumbnailUrl));
      });
    } else {
      const icon = preview.createEl("span", { cls: "llm-bridge-attachment-token-icon" });
      setIcon(icon, "image");
    }
  } else {
    const icon = preview.createEl("span", { cls: "llm-bridge-attachment-token-icon llm-bridge-composer-file-icon" });
    setIcon(icon, deps.getFileRefIconName(ref));
    preview.createEl("span", {
      cls: "llm-bridge-attachment-token-name llm-bridge-composer-file-text",
      text: shortAttachmentName(ref.displayName),
      attr: { title: ref.displayName },
    });
  }
  preview.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    deps.closeAttachmentContextMenu();
    deps.openFileRefPreview(ref);
  });
  token.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    deps.showAttachmentContextMenu(event, ref, {
      allowRemove,
      allowOpen: false,
    });
  });
}

export function showAttachmentContextMenu(
  event: MouseEvent,
  ref: FileRef,
  options: { allowRemove: boolean; allowOpen: boolean },
  menuElRef: { current: HTMLElement | null },
  deps: ComposerAttachmentMenuDeps,
): HTMLElement {
  if (menuElRef.current) {
    menuElRef.current.remove();
    menuElRef.current = null;
  }
  deps.setActivePopup("attachment");
  const menu = document.body.createDiv({ cls: "llm-bridge-attachment-context-menu" });
  menuElRef.current = menu;
  const addItem = (label: string, onClick: () => void) => {
    const item = menu.createEl("button", {
      cls: "llm-bridge-attachment-context-item",
      text: label,
      attr: { type: "button" },
    });
    item.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (menuElRef.current) {
        menuElRef.current.remove();
        menuElRef.current = null;
      }
      deps.setActivePopup(null);
      onClick();
    });
  };
  addItem("复制", () => deps.copyFileRefToClipboard(ref));
  if (options.allowOpen) {
    addItem("打开", () => {
      const target = ref.resolvedPath || ref.displayName;
      if (target) deps.openPathWithSystemDefault(target);
    });
  }
  if (options.allowRemove) {
    addItem("从本轮移除", () => {
      if (deps.getSelectedAttachmentId() === ref.id) deps.setSelectedAttachmentId(null);
      deps.removeMessageFileRef(ref.id);
    });
  }
  const x = Math.min(event.clientX, window.innerWidth - 160);
  const y = Math.min(event.clientY, window.innerHeight - 120);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
  return menu;
}

export function closeAttachmentContextMenu(
  menuElRef: { current: HTMLElement | null },
  updateActive: boolean,
  activePopup: string | null,
  setActivePopup: (kind: null) => void,
): void {
  if (menuElRef.current) {
    menuElRef.current.remove();
    menuElRef.current = null;
  }
  if (updateActive && activePopup === "attachment") setActivePopup(null);
}

export interface ComposerStatusRailEls {
  railEl: HTMLElement;
  textEl: HTMLElement;
  stepPillEl: HTMLElement;
}

export interface ComposerStatusRailState {
  kind: string;
  label: string;
  stepText: string;
}

/** Apply computed status-rail state; pass null to hide. */
export function applyComposerStatusRail(
  els: ComposerStatusRailEls,
  state: ComposerStatusRailState | null,
): void {
  if (!state) {
    els.railEl.setAttribute("hidden", "");
    els.textEl.textContent = "";
    els.stepPillEl.textContent = "";
    els.railEl.className = "llm-bridge-composer-status-rail";
    return;
  }
  els.railEl.removeAttribute("hidden");
  els.railEl.className = `llm-bridge-composer-status-rail is-${state.kind}`;
  els.textEl.textContent = state.label;
  els.textEl.setAttribute("title", state.label);
  els.stepPillEl.textContent = state.stepText;
  els.stepPillEl.toggleAttribute("hidden", !state.stepText);
}

/** Bind dragover/dragleave/drop visual + drop callback; ingest stays on View. */
export function bindComposerFileDragSurface(
  surface: HTMLElement,
  onDrop: (event: DragEvent) => void,
): void {
  surface.addEventListener("dragover", (event) => {
    const hasFiles = !!event.dataTransfer?.files?.length
      || Array.from(event.dataTransfer?.types ?? []).some((type) => /files|uri-list/i.test(type));
    if (!hasFiles) return;
    event.preventDefault();
    surface.addClass("is-dragging-file");
  });
  surface.addEventListener("dragleave", () => surface.removeClass("is-dragging-file"));
  surface.addEventListener("drop", (event) => {
    event.preventDefault();
    surface.removeClass("is-dragging-file");
    onDrop(event);
  });
}

/** 空输入时 Backspace 选中/删除附件；有文本时优先删文字 */
export function handleComposerAttachmentKeydown(
  e: KeyboardEvent,
  deps: ComposerAttachmentKeydownDeps,
): boolean {
  const value = deps.getInputValue();
  const range = deps.getSelectionRange();
  const hasSelection = range.start !== range.end;
  if (e.key === "Escape" && deps.getSelectedAttachmentId()) {
    e.preventDefault();
    deps.setSelectedAttachmentId(null);
    deps.renderComposerFileRefs();
    return true;
  }
  if (value.length > 0 || hasSelection) return false;
  const refs = deps.getMessageFileRefs().filter((ref) => ref.kind === "vault" || ref.kind === "attachment" || ref.kind === "external");
  if (refs.length === 0) return false;
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    if (deps.getSelectedAttachmentId()) {
      const id = deps.getSelectedAttachmentId()!;
      deps.setSelectedAttachmentId(null);
      deps.removeMessageFileRef(id);
      return true;
    }
    if (e.key === "Backspace") {
      deps.setSelectedAttachmentId(refs[refs.length - 1].id);
      deps.renderComposerFileRefs();
      return true;
    }
  }
  return false;
}
