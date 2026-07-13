// LLM CLI Bridge — Composer Runtime Tools 能力闭环（从 view.ts 渐进拆分 P3）
// 纯函数：chip 渲染 + plugin/skill 列表 + 选中态切换 + prompt hint 拼接。
// 状态 selectedRuntimeCapabilities 保留在 view，通过 deps 回调读写。
import { Notice, setIcon } from "obsidian";
import type { AgentSkillRecord } from "../agentSkills";
import type {
  CodexManagedPluginCatalog,
  CodexManagedPluginEntry,
} from "../runtime/providers/codex-managed-app-server/codexManagedPluginCatalog";
import { resolveUiLocale } from "../runtime/core/toolPresentation";

/** 选中态类型（原 view.ts 行 287-294） */
export type ComposerRuntimeCapabilitySelection = {
  readonly kind: "plugin" | "skill";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly visualKey: string;
};

/** Composer runtime capabilities 依赖注入 */
export interface ComposerRuntimeCapabilitiesViewDeps {
  /** chip 容器（composerRuntimeCapabilitiesEl） */
  getChipsContainerEl: () => HTMLElement | null;
  /** 聚焦输入框 */
  focusInput: () => void;
  /** 已安装的 managed codex 插件清单 */
  getManagedCodexPlugins: () => ReadonlyArray<CodexManagedPluginEntry>;
  /** managed plugin catalog（含 available/error 状态） */
  getManagedCodexPluginCatalog: () => CodexManagedPluginCatalog | null;
  /** Vault 内 Agent Skills 清单 */
  getAgentSkills: () => ReadonlyArray<AgentSkillRecord>;
  /** 当前选中能力（view 仍持有状态） */
  getSelectedRuntimeCapabilities: () => ComposerRuntimeCapabilitySelection[];
  setSelectedRuntimeCapabilities: (v: ComposerRuntimeCapabilitySelection[]) => void;
}

/** 纯函数：工具视觉 key 分类（原 view.composerToolVisualKey） */
export function composerToolVisualKey(label: string, id: string): string {
  const key = `${label} ${id}`.toLowerCase();
  if (key.includes("chrome")) return "chrome";
  if (key.includes("document")) return "documents";
  if (key.includes("pdf")) return "pdf";
  if (key.includes("spreadsheet") || key.includes("sheet")) return "spreadsheets";
  if (key.includes("presentation") || key.includes("slide")) return "presentations";
  if (key.includes("template")) return "template";
  if (key.includes("computer")) return "computer";
  if (key.includes("github")) return "github";
  if (key.includes("gmail")) return "gmail";
  if (key.includes("google-drive") || key.includes("drive")) return "google-drive";
  if (key.includes("imagegen") || key.includes("image")) return "imagegen";
  if (key.includes("skill")) return "skill";
  return "plugin";
}

/** 纯函数：managed codex plugin → 展示信息（原 view.describeComposerManagedCodexPlugin） */
export function describeComposerManagedCodexPlugin(plugin: CodexManagedPluginEntry): { label: string; description: string; icon: string } {
  const key = `${plugin.pluginId} ${plugin.name} ${plugin.marketplaceName}`.toLowerCase();
  if (key.includes("document")) return { label: "Documents", description: "Create and edit document artifacts", icon: "file-text" };
  if (key.includes("pdf")) return { label: "PDF", description: "Read, create, and verify PDF files", icon: "file-type" };
  if (key.includes("spreadsheet") || key.includes("sheet")) return { label: "Spreadsheets", description: "Create and edit spreadsheet files", icon: "table-2" };
  if (key.includes("presentation") || key.includes("slide")) return { label: "Presentations", description: "Create and edit presentations", icon: "presentation" };
  if (key.includes("template")) return { label: "Template Creator", description: "Create or update personal artifact templates", icon: "blocks" };
  if (key.includes("computer")) return { label: "电脑", description: "Control Windows apps from Codex", icon: "monitor" };
  if (key.includes("github")) return { label: "GitHub", description: "Triage PRs, issues, CI, and publish flows", icon: "github" };
  if (key.includes("gmail")) return { label: "Gmail", description: "Read and manage Gmail", icon: "mail" };
  if (key.includes("google-drive")) return { label: "Google Drive", description: "Search and work with Drive files", icon: "folder-sync" };
  if (key.includes("google-doc")) return { label: "Google Docs", description: "Create and edit Google Docs", icon: "file-text" };
  if (key.includes("google-sheet")) return { label: "Google Sheets", description: "Analyze and edit Google Sheets", icon: "table-2" };
  if (key.includes("google-slide")) return { label: "Google Slides", description: "Create and edit Google Slides", icon: "presentation" };
  if (key.includes("chrome")) return { label: "Chrome", description: "Use the local browser session", icon: "globe" };
  const label = plugin.name || plugin.marketplaceName || plugin.pluginId;
  return {
    label,
    description: plugin.marketplaceName && plugin.marketplaceName !== "unknown"
      ? plugin.marketplaceName
      : `Installed Codex plugin · ${plugin.version}`,
    icon: plugin.enabled ? "plug" : "plug-zap",
  };
}

/** 渲染命令菜单内"本轮能力"列表（plugins + skills） */
export function renderComposerRuntimeToolsList(
  parent: HTMLElement,
  deps: ComposerRuntimeCapabilitiesViewDeps,
): void {
  parent.empty();
  renderComposerManagedCodexPluginsList(parent, deps);
  renderComposerAgentSkillsList(parent, deps);
}

/** 渲染 composer bar 上的已选能力 chip 区 */
export function renderComposerRuntimeCapabilityChips(
  deps: ComposerRuntimeCapabilitiesViewDeps,
): void {
  const container = deps.getChipsContainerEl();
  if (!container) return;
  container.empty();
  const selected = deps.getSelectedRuntimeCapabilities();
  if (selected.length === 0) {
    container.setAttribute("hidden", "");
    return;
  }
  container.removeAttribute("hidden");
  const loc = resolveUiLocale();
  container.createDiv({ cls: "llm-bridge-composer-context-group-label", text: loc === "zh" ? "Skill" : "Skill" });
  for (const selection of selected) {
    const chip = container.createEl("button", {
      cls: "llm-bridge-composer-runtime-chip",
      attr: {
        title: `${selection.kind === "plugin" ? "Plugin" : "Skill"} · ${selection.description || selection.id}。点击移除。`,
        "data-plugin-key": selection.visualKey,
      },
    });
    const icon = chip.createEl("span", { cls: "llm-bridge-composer-runtime-chip-icon" });
    setIcon(icon, selection.icon);
    chip.createEl("span", { cls: "llm-bridge-composer-runtime-chip-label", text: selection.label });
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      deps.setSelectedRuntimeCapabilities(
        deps.getSelectedRuntimeCapabilities().filter((item) =>
          !(item.kind === selection.kind && item.id === selection.id)
        )
      );
      renderComposerRuntimeCapabilityChips(deps);
      deps.focusInput();
    });
  }
}

/** 切换某项能力的选中态并重绘 chip */
export function toggleComposerRuntimeCapability(
  selection: ComposerRuntimeCapabilitySelection,
  deps: ComposerRuntimeCapabilitiesViewDeps,
): void {
  const current = deps.getSelectedRuntimeCapabilities();
  const exists = current.some((item) => item.kind === selection.kind && item.id === selection.id);
  deps.setSelectedRuntimeCapabilities(
    exists
      ? current.filter((item) => !(item.kind === selection.kind && item.id === selection.id))
      : [...current.filter((item) => item.kind !== selection.kind || item.id !== selection.id), selection]
  );
  renderComposerRuntimeCapabilityChips(deps);
}

/** 点击某个 managed plugin 项 */
export function useComposerManagedCodexPlugin(
  plugin: CodexManagedPluginEntry,
  deps: ComposerRuntimeCapabilitiesViewDeps,
): void {
  if (!plugin.enabled) {
    new Notice(`${plugin.name} 已安装但当前未启用`);
    return;
  }
  const presentation = describeComposerManagedCodexPlugin(plugin);
  toggleComposerRuntimeCapability({
    kind: "plugin",
    id: plugin.pluginId,
    label: presentation.label,
    description: presentation.description,
    icon: presentation.icon,
    visualKey: composerToolVisualKey(presentation.label, plugin.pluginId),
  }, deps);
  deps.focusInput();
}

/** 点击某个 agent skill 项 */
export function useComposerAgentSkill(
  skill: AgentSkillRecord,
  deps: ComposerRuntimeCapabilitiesViewDeps,
): void {
  if (!skill.enabled) {
    new Notice(`${skill.name || skill.slug} 当前未启用`);
    return;
  }
  const label = skill.name || skill.slug;
  toggleComposerRuntimeCapability({
    kind: "skill",
    id: skill.slug,
    label,
    description: skill.description || skill.slug,
    icon: "sparkles",
    visualKey: composerToolVisualKey(label, skill.slug),
  }, deps);
  deps.focusInput();
}

/** 拼接 prompt 提示（RunSessionHost.buildUserInputWithRuntimeCapabilityHints 复用） */
export function buildUserInputWithRuntimeCapabilityHints(
  userInput: string,
  deps: Pick<ComposerRuntimeCapabilitiesViewDeps, "getSelectedRuntimeCapabilities">,
): string {
  const selected = deps.getSelectedRuntimeCapabilities();
  if (selected.length === 0) return userInput;
  const hints = selected.map((selection) =>
    `- ${selection.kind === "plugin" ? "Plugin" : "Skill"}: ${selection.label} (${selection.id}) — ${selection.description}`
  ).join("\n");
  return `Preferred runtime capabilities for this turn:\n${hints}\n\nUser request:\n${userInput}`;
}

// ===== 模块内私有 =====

function renderComposerManagedCodexPluginsList(
  parent: HTMLElement,
  deps: ComposerRuntimeCapabilitiesViewDeps,
): void {
  const section = parent.createDiv({ cls: "llm-bridge-command-menu-runtime-section" });
  section.createDiv({ cls: "llm-bridge-command-menu-subtitle", text: "Installed plugins" });
  const catalog = deps.getManagedCodexPluginCatalog();
  if (!catalog?.available) {
    section.createDiv({
      cls: "llm-bridge-command-menu-plugin-empty is-error",
      text: catalog?.error || "managed runtime unavailable",
    });
    return;
  }
  const plugins = deps.getManagedCodexPlugins();
  if (plugins.length === 0) {
    section.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "当前 runtime 没有已安装插件。" });
    return;
  }
  for (const plugin of plugins) {
    const presentation = describeComposerManagedCodexPlugin(plugin);
    const item = section.createEl("button", {
      cls: `llm-bridge-command-menu-plugin${plugin.enabled ? "" : " is-disabled"}`,
      attr: {
        "data-plugin-key": composerToolVisualKey(presentation.label, plugin.pluginId),
        title: plugin.enabled
          ? `使用 ${presentation.label} 插件`
          : `${presentation.label} 已安装但当前未启用`,
      },
    });
    item.disabled = !plugin.enabled;
    item.addEventListener("click", () => useComposerManagedCodexPlugin(plugin, deps));
    const icon = item.createEl("span", { cls: "llm-bridge-command-menu-plugin-icon" });
    setIcon(icon, presentation.icon);
    const main = item.createDiv({ cls: "llm-bridge-command-menu-plugin-main" });
    const title = main.createDiv({ cls: "llm-bridge-command-menu-plugin-title" });
    title.createEl("span", { cls: "llm-bridge-command-menu-plugin-name", text: presentation.label });
    main.createDiv({
      cls: "llm-bridge-command-menu-plugin-desc",
      text: presentation.description,
    });
  }
}

function renderComposerAgentSkillsList(
  parent: HTMLElement,
  deps: ComposerRuntimeCapabilitiesViewDeps,
): void {
  const section = parent.createDiv({ cls: "llm-bridge-command-menu-runtime-section" });
  section.createDiv({ cls: "llm-bridge-command-menu-subtitle", text: "Agent Skills" });
  const sorted = deps.getAgentSkills()
    .filter((skill) => skill.enabled)
    .slice()
    .sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug));
  if (sorted.length === 0) {
    section.createDiv({ cls: "llm-bridge-command-menu-plugin-empty", text: "当前 Vault 没有启用 Agent Skills。" });
    return;
  }
  for (const skill of sorted) {
    const label = skill.name || skill.slug;
    const item = section.createEl("button", {
      cls: "llm-bridge-command-menu-plugin is-skill",
      attr: {
        "data-plugin-key": composerToolVisualKey(label, skill.slug),
        title: `使用 ${label} Skill`,
      },
    });
    item.addEventListener("click", () => useComposerAgentSkill(skill, deps));
    const icon = item.createEl("span", { cls: "llm-bridge-command-menu-plugin-icon" });
    setIcon(icon, "sparkles");
    const main = item.createDiv({ cls: "llm-bridge-command-menu-plugin-main" });
    const title = main.createDiv({ cls: "llm-bridge-command-menu-plugin-title" });
    title.createEl("span", { cls: "llm-bridge-command-menu-plugin-name", text: label });
    main.createDiv({
      cls: "llm-bridge-command-menu-plugin-desc",
      text: skill.description || skill.slug,
    });
  }
}
