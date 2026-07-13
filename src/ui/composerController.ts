// LLM CLI Bridge — Composer controller (structure extract, no visual change)
//
// Owns menu surfaces, permission/model picker DOM, attachment tokens, autoGrow,
// status-rail apply, and file-drag surface bind.
// LLMBridgeView supplies settings/session mutation and file-ingest callbacks.

import * as path from "path";
import { App, Notice, setIcon, TFile } from "obsidian";
import {
  AGENT_APPROVAL_PROFILES,
  getAgentApprovalProfileInfo,
  type AgentApprovalProfile,
} from "../agentApprovalProfile";
import type { FileRef } from "../fileRefs";
import type { RuntimeModelCatalog } from "../runtimeModelCatalog";
import { findModelEntry, getEffortsForModel, effortDisplayLabel } from "../runtimeModelCatalog";

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
  runtimeProfiles?: Array<{ id: string; description: string | null; allowed: boolean }> | null,
): HTMLDivElement {
  const popover = createComposerMenuSurface(mountEl, "llm-bridge-perm-popover", true);

  const head = popover.createDiv({ cls: "llm-bridge-perm-popover-head" });
  head.createEl("span", {
    cls: "llm-bridge-perm-popover-question",
    text: "应如何批准 Agent 操作？",
  });
  const more = head.createEl("a", {
    cls: "llm-bridge-perm-popover-more",
    text: "了解更多",
    attr: { href: "#", role: "button" },
  });
  more.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    new Notice(
      "请求批准：编辑外部文件与联网时始终询问\n替我审批：仅对检测到的风险操作询问\n完全访问：可跳过审批（高风险）",
      7000,
    );
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

  // V20.10: runtime permissionProfile/list 缓存 — 只读展示可用 runtime profiles
  if (runtimeProfiles && runtimeProfiles.length > 0) {
    const rtSection = popover.createDiv({ cls: "llm-bridge-perm-popover-runtime" });
    rtSection.createEl("span", {
      cls: "llm-bridge-perm-popover-runtime-label",
      text: "Runtime profiles",
    });
    const rtList = rtSection.createDiv({ cls: "llm-bridge-perm-popover-runtime-list" });
    for (const rp of runtimeProfiles) {
      const item = rtList.createEl("span", {
        cls: `llm-bridge-perm-popover-runtime-item${rp.allowed ? "" : " is-disabled"}`,
        text: rp.id,
      });
      if (rp.description) item.setAttribute("title", rp.description);
    }
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
    closeModel: () => void;
    closeEffort: () => void;
    /** Fig.1 嵌套主菜单：写入 模型/推理强度 行 */
    primaryMenuEl?: HTMLElement | null;
    openFlyout?: (panel: "model" | "effort") => void;
    activeFlyout?: "model" | "effort" | null;
  },
): void {
  modelOptionsEl.empty();
  effortOptionsEl.empty();

  // V20.3: 模型三分类 — 已验证（available）/ 待验证（pending）/ 不兼容（incompatible）
  const availableModels = catalog.models.filter((m) => !m.validationStatus || m.validationStatus === "available");
  const pendingModels = catalog.models.filter((m) => m.validationStatus === "pending");
  const incompatibleModels = catalog.models.filter((m) => m.validationStatus === "incompatible");

  const appendSection = (title: string, models: ReadonlyArray<{ value: string; label: string; validationStatus?: string; incompatibleReason?: string }>): void => {
    if (models.length === 0) return;
    const header = modelOptionsEl.createDiv({ cls: "llm-bridge-model-section-header", text: title });
    header.setAttribute("data-section", title);
    for (const model of models) {
      const isSelectable = model.validationStatus !== "incompatible";
      const isActive = isSelectable && model.value === currentModel;
      const option = modelOptionsEl.createEl("button", {
        cls: `llm-bridge-model-option${isActive ? " is-active" : ""}${!isSelectable ? " is-disabled" : ""}`,
        attr: { "data-model": model.value, type: "button", ...(isSelectable ? {} : { disabled: "true" }) },
      });
      const labelEl = option.createEl("span", { cls: "llm-bridge-model-option-label", text: model.label });
      if (model.validationStatus === "pending") {
        labelEl.addClass("is-pending");
        option.createEl("span", { cls: "llm-bridge-model-option-tag", text: "待验证" });
      } else if (model.validationStatus === "incompatible") {
        labelEl.addClass("is-incompatible");
        const reason = model.incompatibleReason || "不兼容";
        option.createEl("span", { cls: "llm-bridge-model-option-reason", text: reason });
      }
      option.createEl("span", { cls: "llm-bridge-option-check", text: isActive ? "✓" : "" });
      if (isSelectable) {
        option.addEventListener("click", (event) => {
          event.stopPropagation();
          deps.closeModel();
          deps.onSelect(model.value, currentEffort);
        });
      }
    }
  };

  appendSection("已验证", availableModels);
  appendSection("待验证", pendingModels);
  appendSection("不兼容", incompatibleModels);

  const efforts = getEffortsForModel(catalog, currentModel);
  if (efforts.length === 0 && (catalog.effortsUnavailable || catalog.source === "runtime")) {
    const empty = effortOptionsEl.createEl("div", {
      cls: "llm-bridge-effort-unavailable",
      text: "推理等级目录不可用（runtime 未返回 supportedReasoningEfforts）",
    });
    void empty;
  }
  for (const effort of efforts) {
    const isActive = effort.value === currentEffort;
    const option = effortOptionsEl.createEl("button", {
      cls: `llm-bridge-effort-option${isActive ? " is-active" : ""}`,
      attr: { "data-effort": effort.value, type: "button" },
    });
    option.createEl("span", { cls: "llm-bridge-effort-option-label", text: effort.label });
    option.createEl("span", { cls: "llm-bridge-option-check", text: isActive ? "✓" : "" });
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.closeEffort();
      deps.onSelect(currentModel, effort.value);
    });
  }

  // Fig.1: 主菜单行（模型 / 推理强度），右侧展开子菜单
  if (deps.primaryMenuEl) {
    const model = findModelEntry(catalog, currentModel);
    const effort = efforts.find((e) => e.value === currentEffort) ?? null;
    const modelLabel = shortModelChipLabel(model?.label ?? currentModel);
    const effortLabel = effort?.label ?? effortDisplayLabel(currentEffort);
    deps.primaryMenuEl.empty();

    const addRow = (panel: "model" | "effort", name: string, value: string) => {
      const row = deps.primaryMenuEl!.createEl("button", {
        cls: `llm-bridge-model-menu-row${deps.activeFlyout === panel ? " is-active" : ""}`,
        attr: { type: "button", "data-panel": panel },
      });
      row.createEl("span", { cls: "llm-bridge-model-menu-row-label", text: name });
      const trailing = row.createDiv({ cls: "llm-bridge-model-menu-row-trailing" });
      trailing.createEl("span", { cls: "llm-bridge-model-menu-row-value", text: value });
      trailing.createEl("span", { cls: "llm-bridge-model-menu-row-chevron", text: "›" });
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        deps.openFlyout?.(panel);
      });
    };
    addRow("model", "模型", modelLabel);
    addRow("effort", "推理强度", effortLabel);
  }
}

/** Chip 上的短模型名：去掉 GPT-/Claude 前缀，贴近图 1 的「5.6 Sol」观感 */
export function shortModelChipLabel(label: string): string {
  return (label || "")
    .replace(/^GPT[-\s]*/i, "")
    .replace(/^Claude[-\s]*/i, "")
    .trim() || label;
}

export function refreshModelEffortPickerLabels(
  buttonEl: HTMLElement,
  menuEl: HTMLElement | null | undefined,
  catalog: RuntimeModelCatalog,
  modelValue: string,
  effortValue: string,
): void {
  const model = findModelEntry(catalog, modelValue);
  const modelEfforts = getEffortsForModel(catalog, modelValue);
  const effort = modelEfforts.find((e) => e.value === effortValue) ?? null;
  const modelLabel = shortModelChipLabel(model?.label ?? modelValue ?? "unknown");
  const effortLabel = effort?.label ?? effortDisplayLabel(effortValue ?? "unknown");
  buttonEl.textContent = `${modelLabel} ${effortLabel}`;
  const currentModelValue = model?.value ?? modelValue;
  const currentEffortValue = effort?.value ?? effortValue;
  menuEl?.querySelectorAll<HTMLElement>(".llm-bridge-model-option").forEach((option) => {
    const active = option.getAttribute("data-model") === currentModelValue;
    option.classList.toggle("is-active", active);
    const check = option.querySelector<HTMLElement>(".llm-bridge-option-check");
    if (check) check.textContent = active ? "✓" : "";
  });
  menuEl?.querySelectorAll<HTMLElement>(".llm-bridge-effort-option").forEach((option) => {
    const active = option.getAttribute("data-effort") === currentEffortValue;
    option.classList.toggle("is-active", active);
    const check = option.querySelector<HTMLElement>(".llm-bridge-option-check");
    if (check) check.textContent = active ? "✓" : "";
  });
  const modelRowValue = menuEl?.querySelector<HTMLElement>(
    '.llm-bridge-model-menu-row[data-panel="model"] .llm-bridge-model-menu-row-value',
  );
  const effortRowValue = menuEl?.querySelector<HTMLElement>(
    '.llm-bridge-model-menu-row[data-panel="effort"] .llm-bridge-model-menu-row-value',
  );
  if (modelRowValue) modelRowValue.textContent = modelLabel;
  if (effortRowValue) effortRowValue.textContent = effortLabel;
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
    // Phase 4: PDF/Office 等 binary 附件以路径引用方式发送，不直接上传
    token.createEl("span", {
      cls: "llm-bridge-attachment-token-badge",
      text: "路径引用",
      attr: { title: "此文件以路径引用方式交给 agent，由工具读取，不直接上传到 LLM" },
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

/**
 * 附件删除过渡：先给 token 加 is-removing 触发淡出，150ms 后再实际移除。
 * 找不到 token 元素（或已在移除中）时直接移除，保持原有行为。
 */
function fadeOutAttachmentTokenThen(refId: string, onRemove: () => void): void {
  const tokenEl = document.querySelector<HTMLElement>(
    `.llm-bridge-attachment-token[data-ref-id="${refId}"]`,
  );
  if (!tokenEl || tokenEl.classList.contains("is-removing")) {
    onRemove();
    return;
  }
  tokenEl.classList.add("is-removing");
  window.setTimeout(onRemove, 150);
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
      fadeOutAttachmentTokenThen(ref.id, () => deps.removeMessageFileRef(ref.id));
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
      fadeOutAttachmentTokenThen(id, () => deps.removeMessageFileRef(id));
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

// ---------------------------------------------------------------------------
// ComposerController — 有状态的 popup 互斥 / outside-click / mention / 附件选择
// ---------------------------------------------------------------------------

export type ComposerPopupKind =
  | "command"
  | "model"
  | "effort"
  | "permission"
  | "attachment"
  | "session"
  | "mention"
  | null;

/**
 * 注入 ComposerController 所需的全部外部依赖。
 * DOM 元素通过 getter 延迟访问（view.ts 在 onOpen 渲染期间逐步创建）。
 */
export interface ComposerHost {
  readonly inputEl: HTMLTextAreaElement;
  readonly app: App;
  // DOM 元素（由 view.ts 渲染期间创建并持有）
  getComposerEl(): HTMLElement | null;
  getComposerBarEl(): HTMLElement | null;
  getModelEffortButtonEl(): HTMLButtonElement | null;
  getModelOptionsEl(): HTMLElement | null;
  getEffortOptionsEl(): HTMLElement | null;
  getPermissionModePickerEl(): HTMLElement | null;
  getPermissionModeChipEl(): HTMLButtonElement | null;
  // 模型目录与设置值
  getModelCatalog(): RuntimeModelCatalog;
  getEffortLevel(): string;
  getModel(): string;
  // 业务回调
  addAttachmentPathWithNotice(path: string): void;
  removeMessageFileRef(id: string): void;
  renderComposerFileRefs(): void;
  copyFileRefToClipboard(ref: FileRef): void;
  openPathWithSystemDefault(target: string): void;
  setApprovalProfile(profile: AgentApprovalProfile): void | Promise<void>;
  setModelEffort(model: string, effort: string): void | Promise<void>;
  effectiveApprovalProfile(): AgentApprovalProfile;
  autoGrowInput(): void;
  getMessageFileRefs(): ReadonlyArray<FileRef>;
  /** V20.10: 同步读取已缓存的 runtime permissionProfile 列表（未缓存返回 null） */
  getCachedPermissionProfilesSync?(): Array<{ id: string; description: string | null; allowed: boolean }> | null;
}

export class ComposerController {
  private host: ComposerHost;

  // 迁移的状态字段
  private _activePopup: ComposerPopupKind = null;
  private _selectedAttachmentId: string | null = null;
  private _attachmentContextMenuEl: HTMLElement | null = null;
  private _closeCommandMenuPopover: (() => void) | null = null;
  private _modelEffortPopoverEl: HTMLElement | null = null;
  private _permissionPopoverEl: HTMLDivElement | null = null;
  private _mentionPickerEl: HTMLElement | null = null;
  private _mentionPickerRange: { start: number; end: number } | null = null;
  private _mentionPickerActiveIndex = -1;

  // document 监听器 bound 引用（用于 destroy 时移除）
  private boundPointerdown?: (event: Event) => void;
  private boundKeydown?: (event: KeyboardEvent) => void;

  constructor(host: ComposerHost) {
    this.host = host;
  }

  // ---- 公开 getter/setter（供 view.ts 薄包装或直接访问） ----

  get activePopup(): ComposerPopupKind {
    return this._activePopup;
  }

  get selectedAttachmentId(): string | null {
    return this._selectedAttachmentId;
  }

  set selectedAttachmentId(id: string | null) {
    this._selectedAttachmentId = id;
  }

  get modelEffortPopoverEl(): HTMLElement | null {
    return this._modelEffortPopoverEl;
  }

  get permissionPopoverEl(): HTMLDivElement | null {
    return this._permissionPopoverEl;
  }

  get mentionPickerEl(): HTMLElement | null {
    return this._mentionPickerEl;
  }

  /** view.ts renderModelEffortPicker 创建嵌套菜单后注入 */
  setModelEffortPopoverEl(el: HTMLElement): void {
    this._modelEffortPopoverEl = el;
  }

  /** view.ts 创建 mention picker 元素后注入 */
  setMentionPickerEl(el: HTMLElement): void {
    this._mentionPickerEl = el;
  }

  /** view.ts onOpen 创建 closeCommandMenu 闭包后注入 */
  setCloseCommandMenuPopover(fn: (() => void) | null): void {
    this._closeCommandMenuPopover = fn;
  }

  // ---- 互斥总控 ----

  /**
   * 统一激活弹层：同一时刻只保留一个；提升 composer 层级，避免各自堆 z-index。
   */
  setActivePopup(kind: ComposerPopupKind): void {
    const applyOpenClass = () => {
      const open = kind !== null;
      this.host.getComposerEl()?.classList.toggle("is-popup-open", open);
      this.host.getComposerBarEl()?.classList.toggle("is-popup-open", open);
      this.host.getComposerBarEl()?.classList.toggle("is-command-menu-open", kind === "command");
    };
    if (this._activePopup === kind) {
      applyOpenClass();
      return;
    }
    const prev = this._activePopup;
    this._activePopup = kind;
    if (prev === "attachment" && kind !== "attachment") this.closeAttachmentContextMenu(false);
    if (prev === "command" && kind !== "command") this._closeCommandMenuPopover?.();
    if ((prev === "model" || prev === "effort") && kind !== "model" && kind !== "effort") this.closeModelEffortPopover(false);
    if (prev === "permission" && kind !== "permission") this.closePermissionPopover(false);
    if (prev === "mention" && kind !== "mention") this.closeMentionPicker();
    if (prev === "session" && kind !== "session") {
      document.querySelectorAll(".llm-bridge-session-dropdown:not([hidden])")
        .forEach((el) => el.setAttribute("hidden", ""));
    }
    applyOpenClass();
  }

  /**
   * 关闭所有会话框风格选择器（Escape 或互斥打开时调用）。
   */
  closeAllSelectors(): void {
    this.setActivePopup(null);
    this._closeCommandMenuPopover?.();
    this.closePermissionPopover(false);
    this.closeModelEffortPopover(false);
    this.closeMentionPicker();
    this.closeAttachmentContextMenu(false);
    document.querySelectorAll(".llm-bridge-session-dropdown:not([hidden])")
      .forEach((el) => el.setAttribute("hidden", ""));
  }

  /**
   * 统一外部点击关闭——所有会话框风格选择器共用一个抽象。
   */
  handleSelectorOutsideClick(event: Event): void {
    // 附件右键菜单
    if (this._attachmentContextMenuEl && !isEventInsideSelector(event, ".llm-bridge-attachment-context-menu")) {
      this.closeAttachmentContextMenu();
    }
    // 工具菜单（button + popover）
    if (!isEventInsideSelector(event, ".llm-bridge-command-menu")) {
      this._closeCommandMenuPopover?.();
    }
    // 权限 popover（chip + popover 容器）
    if (!isEventInsideSelector(event, ".llm-bridge-permission-picker")
      && !isEventInsideSelector(event, ".llm-bridge-perm-popover")) {
      this.closePermissionPopover();
    }
    // 模型 / effort popover（V20.2: 两个独立 popover，都在 picker 容器内）
    if (!isEventInsideSelector(event, ".llm-bridge-model-effort-picker")) {
      this.closeModelEffortPopover();
      this.closeEffortPopover();
    }
    // 会话下拉（header session selector + dropdown）
    if (!isEventInsideSelector(event, ".llm-bridge-session-selector")
      && !isEventInsideSelector(event, ".llm-bridge-session-dropdown")) {
      document.querySelectorAll(".llm-bridge-session-dropdown:not([hidden])")
        .forEach((el) => el.setAttribute("hidden", ""));
      if (this._activePopup === "session") this.setActivePopup(null);
    }
    // @ 提及：点击输入框或选择器本身不关闭（保留输入体验）
    if (this._mentionPickerEl && !this._mentionPickerEl.hasAttribute("hidden")) {
      const target = eventTargetElement(event);
      if (target !== this.host.inputEl && !target?.closest(".llm-bridge-mention-picker")) {
        this.closeMentionPicker();
        if (this._activePopup === "mention") this.setActivePopup(null);
      }
    }
  }

  // ---- Model / Effort popover (Fig.1: 嵌套主菜单 + 右侧 flyout) ----

  private _activeModelFlyout: "model" | "effort" | null = null;

  renderModelEffortOptions(): void {
    const modelOptionsEl = this.host.getModelOptionsEl();
    const effortOptionsEl = this.host.getEffortOptionsEl();
    if (!modelOptionsEl || !effortOptionsEl) return;
    const menuEl = this._modelEffortPopoverEl;
    const primaryMenuEl = menuEl?.querySelector<HTMLElement>(".llm-bridge-model-menu-primary") ?? null;
    renderModelEffortOptions(
      modelOptionsEl,
      effortOptionsEl,
      this.host.getModelCatalog(),
      this.host.getEffortLevel(),
      this.host.getModel(),
      {
        closeModel: () => this.closeModelEffortPopover(),
        closeEffort: () => this.closeModelEffortPopover(),
        onSelect: (model, effort) => { void this.host.setModelEffort(model, effort); },
        primaryMenuEl,
        activeFlyout: this._activeModelFlyout,
        openFlyout: (panel) => this.openModelMenuFlyout(panel),
      },
    );
    // 保持当前 flyout 可见状态
    if (this._activeModelFlyout) this.openModelMenuFlyout(this._activeModelFlyout);
  }

  private openModelMenuFlyout(panel: "model" | "effort"): void {
    this._activeModelFlyout = panel;
    const menuEl = this._modelEffortPopoverEl;
    if (!menuEl) return;
    menuEl.querySelectorAll<HTMLElement>(".llm-bridge-model-menu-flyout").forEach((el) => {
      const match = el.getAttribute("data-panel") === panel;
      if (match) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
    menuEl.querySelectorAll<HTMLElement>(".llm-bridge-model-menu-row").forEach((row) => {
      row.classList.toggle("is-active", row.getAttribute("data-panel") === panel);
    });
  }

  toggleModelEffortPopover(): void {
    if (!this._modelEffortPopoverEl) return;
    if (this._modelEffortPopoverEl.hasAttribute("hidden")) {
      this.setActivePopup("model");
      this._modelEffortPopoverEl.removeAttribute("hidden");
      this._modelEffortPopoverEl.classList.add("is-open");
      this.host.getModelEffortButtonEl()?.setAttribute("aria-expanded", "true");
      // Fig.1：默认只显示主列表行；点「模型 / 推理强度」再展开子菜单
      this._activeModelFlyout = null;
      this.renderModelEffortOptions();
      this._modelEffortPopoverEl.querySelectorAll<HTMLElement>(".llm-bridge-model-menu-flyout").forEach((el) => {
        el.setAttribute("hidden", "");
      });
      this._modelEffortPopoverEl.querySelectorAll<HTMLElement>(".llm-bridge-model-menu-row").forEach((row) => {
        row.classList.remove("is-active");
      });
    } else {
      this.closeModelEffortPopover();
    }
  }

  closeModelEffortPopover(updateActive = true): void {
    if (!this._modelEffortPopoverEl) return;
    this._modelEffortPopoverEl.setAttribute("hidden", "");
    this._modelEffortPopoverEl.classList.remove("is-open");
    this.host.getModelEffortButtonEl()?.setAttribute("aria-expanded", "false");
    this._modelEffortPopoverEl.querySelectorAll<HTMLElement>(".llm-bridge-model-menu-flyout").forEach((el) => {
      el.setAttribute("hidden", "");
    });
    this._activeModelFlyout = null;
    if (updateActive && this._activePopup === "model") this.setActivePopup(null);
  }

  toggleEffortPopover(): void {
    // Fig.1: 推理强度已并入嵌套菜单，打开主菜单并切到 effort flyout
    if (!this._modelEffortPopoverEl) return;
    if (this._modelEffortPopoverEl.hasAttribute("hidden")) {
      this.toggleModelEffortPopover();
    }
    this.openModelMenuFlyout("effort");
  }

  closeEffortPopover(updateActive = true): void {
    this.closeModelEffortPopover(updateActive);
  }

  // ---- Permission popover ----

  renderPermissionPopover(): void {
    const mountEl = this.host.getPermissionModePickerEl();
    if (!mountEl) return;
    this._permissionPopoverEl?.remove();
    const runtimeProfiles = this.host.getCachedPermissionProfilesSync?.() ?? null;
    this._permissionPopoverEl = renderPermissionPopover(mountEl, this.host.effectiveApprovalProfile(), {
      close: () => this.closePermissionPopover(),
      onSelectProfile: (profile) => { void this.host.setApprovalProfile(profile); },
    }, runtimeProfiles);
  }

  togglePermissionPopover(): void {
    if (!this._permissionPopoverEl) this.renderPermissionPopover();
    if (!this._permissionPopoverEl) return;
    const hidden = this._permissionPopoverEl.hasAttribute("hidden");
    if (hidden) {
      this.setActivePopup("permission");
      void this.host.getComposerEl()?.offsetHeight;
      this.renderPermissionPopover();
      requestAnimationFrame(() => {
        this._permissionPopoverEl?.removeAttribute("hidden");
        this.host.getPermissionModeChipEl()?.setAttribute("aria-expanded", "true");
      });
    } else {
      this.closePermissionPopover();
    }
  }

  closePermissionPopover(updateActive = true): void {
    this._permissionPopoverEl?.setAttribute("hidden", "");
    this.host.getPermissionModeChipEl()?.setAttribute("aria-expanded", "false");
    if (updateActive && this._activePopup === "permission") this.setActivePopup(null);
  }

  // ---- @ 提及选择器 ----

  handleMentionInput(): void {
    const ta = this.host.inputEl;
    const value = ta.value;
    const cursor = ta.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (!match) {
      this.closeMentionPicker();
      return;
    }
    this._mentionPickerRange = { start: cursor - match[0].length, end: cursor };
    this.openMentionPicker(match[1]);
  }

  openMentionPicker(query: string): void {
    const inputRow = this.host.inputEl.parentElement as HTMLElement | null;
    if (!inputRow) return;
    if (!this._mentionPickerEl) {
      this._mentionPickerEl = inputRow.createDiv({ cls: "llm-bridge-mention-picker" });
      this._mentionPickerEl.setAttribute("hidden", "");
    }
    this.renderMentionList(query);
    if (this._mentionPickerEl.hasAttribute("hidden")) {
      this._mentionPickerEl.removeAttribute("hidden");
      this._mentionPickerEl.classList.add("is-open");
    }
  }

  renderMentionList(query: string): void {
    const picker = this._mentionPickerEl;
    if (!picker) return;
    picker.empty();
    const q = query.trim().toLowerCase();
    const files = this.host.app.vault.getFiles()
      .filter((file) => file instanceof TFile)
      .sort((a, b) => a.path.localeCompare(b.path))
      .filter((file) => !q || file.path.toLowerCase().includes(q))
      .slice(0, 50);
    if (files.length === 0) {
      picker.createDiv({ cls: "llm-bridge-mention-picker-empty", text: "无匹配 Vault 文件" });
      this._mentionPickerActiveIndex = -1;
      return;
    }
    files.forEach((file, index) => {
      const row = picker.createEl("button", {
        cls: "llm-bridge-mention-picker-item",
        text: file.path,
        attr: { title: file.path, "data-index": String(index), "data-path": file.path },
      });
      row.addEventListener("click", (e) => {
        e.preventDefault();
        this.selectMention(file.path);
      });
      row.addEventListener("mouseenter", () => {
        this._mentionPickerActiveIndex = index;
        this.updateMentionActive();
      });
    });
    this._mentionPickerActiveIndex = 0;
    this.updateMentionActive();
  }

  updateMentionActive(): void {
    const picker = this._mentionPickerEl;
    if (!picker) return;
    picker.querySelectorAll<HTMLElement>(".llm-bridge-mention-picker-item").forEach((item, i) => {
      item.classList.toggle("is-active", i === this._mentionPickerActiveIndex);
    });
  }

  handleMentionKeydown(e: KeyboardEvent): boolean {
    const picker = this._mentionPickerEl;
    if (!picker || picker.hasAttribute("hidden")) return false;
    const items = Array.from(picker.querySelectorAll<HTMLElement>(".llm-bridge-mention-picker-item"));
    if (e.key === "ArrowDown") {
      if (items.length === 0) return false;
      e.preventDefault();
      this._mentionPickerActiveIndex = (this._mentionPickerActiveIndex + 1) % items.length;
      this.updateMentionActive();
      items[this._mentionPickerActiveIndex]?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (e.key === "ArrowUp") {
      if (items.length === 0) return false;
      e.preventDefault();
      this._mentionPickerActiveIndex = (this._mentionPickerActiveIndex - 1 + items.length) % items.length;
      this.updateMentionActive();
      items[this._mentionPickerActiveIndex]?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (items.length === 0) return false;
      e.preventDefault();
      const active = items[this._mentionPickerActiveIndex];
      const path = active?.getAttribute("data-path") ?? "";
      if (path) this.selectMention(path);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeMentionPicker();
      return true;
    }
    return false;
  }

  selectMention(filePath: string): void {
    const range = this._mentionPickerRange;
    this.closeMentionPicker();
    const inputEl = this.host.inputEl;
    if (range) {
      const value = inputEl.value;
      inputEl.value = value.slice(0, range.start) + value.slice(range.end);
      inputEl.setSelectionRange(range.start, range.start);
    }
    this.host.autoGrowInput();
    inputEl.focus();
    void this.host.addAttachmentPathWithNotice(filePath);
  }

  closeMentionPicker(): void {
    const picker = this._mentionPickerEl;
    if (!picker) return;
    picker.setAttribute("hidden", "");
    picker.classList.remove("is-open");
    this._mentionPickerRange = null;
    this._mentionPickerActiveIndex = -1;
  }

  // ---- 附件右键菜单 ----

  showAttachmentContextMenu(
    event: MouseEvent,
    ref: FileRef,
    options: { allowRemove: boolean; allowOpen: boolean },
  ): void {
    const menuRef = { current: this._attachmentContextMenuEl };
    showAttachmentContextMenu(event, ref, options, menuRef, {
      setActivePopup: (kind) => this.setActivePopup(kind),
      copyFileRefToClipboard: (r) => { void this.host.copyFileRefToClipboard(r); },
      openPathWithSystemDefault: (target) => { void this.host.openPathWithSystemDefault(target); },
      removeMessageFileRef: (id) => this.host.removeMessageFileRef(id),
      getSelectedAttachmentId: () => this._selectedAttachmentId,
      setSelectedAttachmentId: (id) => { this._selectedAttachmentId = id; },
    });
    this._attachmentContextMenuEl = menuRef.current;
  }

  closeAttachmentContextMenu(updateActive = true): void {
    const menuRef = { current: this._attachmentContextMenuEl };
    closeAttachmentContextMenu(
      menuRef,
      updateActive,
      this._activePopup as string | null,
      () => this.setActivePopup(null),
    );
    this._attachmentContextMenuEl = menuRef.current;
  }

  /** 空输入时 Backspace 选中/删除附件；有文本时优先删文字 */
  handleComposerAttachmentKeydown(e: KeyboardEvent): boolean {
    const inputEl = this.host.inputEl;
    return handleComposerAttachmentKeydown(e, {
      getInputValue: () => inputEl.value,
      getSelectionRange: () => ({ start: inputEl.selectionStart ?? 0, end: inputEl.selectionEnd ?? 0 }),
      getMessageFileRefs: () => this.host.getMessageFileRefs(),
      getSelectedAttachmentId: () => this._selectedAttachmentId,
      setSelectedAttachmentId: (id) => { this._selectedAttachmentId = id; },
      removeMessageFileRef: (id) => this.host.removeMessageFileRef(id),
      renderComposerFileRefs: () => this.host.renderComposerFileRefs(),
    });
  }

  // ---- 生命周期 ----

  /**
   * 注册 document 级 pointerdown + keydown 监听器。
   * 在 view.ts onOpen 渲染完成后调用。
   */
  registerListeners(): void {
    this.boundPointerdown = (event: Event) => this.handleSelectorOutsideClick(event);
    this.boundKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.closeAllSelectors();
    };
    document.addEventListener("pointerdown", this.boundPointerdown);
    document.addEventListener("keydown", this.boundKeydown);
  }

  /**
   * 释放监听器、清理 popup DOM。在 view.ts onClose 中调用。
   */
  destroy(): void {
    if (this.boundPointerdown) {
      document.removeEventListener("pointerdown", this.boundPointerdown);
      this.boundPointerdown = undefined;
    }
    if (this.boundKeydown) {
      document.removeEventListener("keydown", this.boundKeydown);
      this.boundKeydown = undefined;
    }
    this._attachmentContextMenuEl?.remove();
    this._attachmentContextMenuEl = null;
    this._mentionPickerEl?.remove();
    this._mentionPickerEl = null;
    this._permissionPopoverEl?.remove();
    this._permissionPopoverEl = null;
    // V20.2: effort popover 由 modelEffortPickerEl 容器统一移除，无需单独 remove
  }
}
