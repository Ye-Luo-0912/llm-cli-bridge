// LLM CLI Bridge — Agent Skills 面板渲染（从 view.ts 渐进拆分 P1）
// 纯渲染函数：renderAgentSkillsList + renderAgentSkillItem，零 view 状态写入。
import { setIcon } from "obsidian";
import type { AgentSkillRecord } from "../agentSkills";

/** Agent Skills 列表渲染依赖注入 */
export interface AgentSkillsListDeps {
  /** 渲染 managed codex plugins 区块（由 view 实现） */
  renderManagedCodexPluginsList: () => void;
  /** 更新折叠头部计数（由 view 实现） */
  updateAgentSkillsToggle: () => void;
  /** 渲染单个 skill 项（见下方 renderAgentSkillItem） */
  renderAgentSkillItem: (parent: HTMLElement, skill: AgentSkillRecord) => void;
  /** 渲染错误占位（由 view 实现） */
  renderListError: (container: HTMLElement, kind: string, error: unknown) => void;
}

/** 渲染 Agent Skills 列表：managed plugins + enabled/disabled 分组 */
export function renderAgentSkillsList(
  container: HTMLElement,
  skills: ReadonlyArray<AgentSkillRecord>,
  deps: AgentSkillsListDeps,
): void {
  if (!container) return;
  try {
    deps.renderManagedCodexPluginsList();
    container.empty();
    if (skills.length === 0) {
      container.createDiv({
        cls: "llm-bridge-skills-empty",
        text: "无 Agent Skills。可通过 .llm-bridge/agent-skills.json 管理，或导入外部 skill pack。",
      });
      deps.updateAgentSkillsToggle();
      return;
    }

    const list = container.createDiv({ cls: "llm-bridge-agent-skills-list" });
    const sorted = skills.slice().sort((a, b) => a.slug.localeCompare(b.slug));
    // UI-03: Skills 页区分"本轮已启用能力"和"可用但未启用能力"
    const enabledSkills = sorted.filter((s) => s.enabled);
    const disabledSkills = sorted.filter((s) => !s.enabled);

    if (enabledSkills.length > 0) {
      const enabledSection = list.createDiv({ cls: "llm-bridge-agent-skills-group is-enabled-group" });
      enabledSection.createDiv({ cls: "llm-bridge-agent-skills-group-label", text: `本轮已启用（${enabledSkills.length}）` });
      for (const skill of enabledSkills) {
        deps.renderAgentSkillItem(list, skill);
      }
    }

    if (disabledSkills.length > 0) {
      const disabledSection = list.createDiv({ cls: "llm-bridge-agent-skills-group is-disabled-group" });
      disabledSection.createDiv({ cls: "llm-bridge-agent-skills-group-label", text: `可用但未启用（${disabledSkills.length}）` });
      for (const skill of disabledSkills) {
        deps.renderAgentSkillItem(list, skill);
      }
    }

    if (enabledSkills.length === 0 && disabledSkills.length === 0) {
      list.createDiv({ cls: "llm-bridge-skills-empty", text: "无 Agent Skills。" });
    }
    deps.updateAgentSkillsToggle();
  } catch (e) {
    deps.renderListError(container, "agent-skills", e);
  }
}

/** Agent Skill 单项渲染依赖注入 */
export interface AgentSkillItemDeps {
  /** Runtime 已发现的 skill 名称集合（用于显示 "Runtime 已发现" 徽章） */
  runtimeDiscoveredSkillNames: ReadonlySet<string>;
  /** 打开 skill 文件回调 */
  onOpen: (skill: AgentSkillRecord) => void;
  /** 切换 skill 启用状态回调 */
  onToggle: (skillId: string, enabled: boolean) => void;
}

/** UI-03: 渲染单个 skill 项（名称 + 徽章 + 描述 + 启用/关闭按钮） */
export function renderAgentSkillItem(
  parent: HTMLElement,
  skill: AgentSkillRecord,
  deps: AgentSkillItemDeps,
): void {
  // V20.12: 检测 Runtime 是否发现此 skill（name 匹配 llm-bridge-{name} 或 slug 匹配）
  const runtimeName = `llm-bridge-${skill.name}`;
  const runtimeDiscovered = deps.runtimeDiscoveredSkillNames.has(runtimeName)
    || deps.runtimeDiscoveredSkillNames.has(skill.slug);
  const item = parent.createDiv({
    cls: `llm-bridge-agent-skill-registry-item${skill.enabled ? "" : " is-disabled"}`,
    attr: { title: skill.materializedPath || `.claude/skills/${skill.slug}/SKILL.md` },
  });
  const icon = item.createEl("span", { cls: "llm-bridge-agent-skill-icon" });
  setIcon(icon, skill.enabled ? "sparkles" : "circle-dashed");
  const main = item.createEl("button", {
    cls: "llm-bridge-agent-skill-open",
    attr: { title: `在 Obsidian 中打开 ${skill.materializedPath || `.claude/skills/${skill.slug}/SKILL.md`}` },
  });
  const titleRow = main.createDiv({ cls: "llm-bridge-agent-skill-title-row" });
  titleRow.createEl("span", { cls: "llm-bridge-agent-skill-name", text: skill.name || skill.slug });
  titleRow.createEl("span", { cls: `llm-bridge-agent-skill-badge ${skill.enabled ? "is-enabled" : "is-disabled"}`, text: skill.enabled ? "已启用" : "已禁用" });
  if (runtimeDiscovered) {
    titleRow.createEl("span", { cls: "llm-bridge-agent-skill-badge is-runtime", text: "Runtime 已发现", attr: { title: "Codex Runtime skills/list 已识别此 skill" } });
  }
  main.createEl("span", { cls: "llm-bridge-agent-skill-desc", text: skill.description || "No description" });
  const meta = main.createDiv({ cls: "llm-bridge-agent-skill-meta" });
  meta.createEl("span", { text: `slug: ${skill.slug}` });
  meta.createEl("span", { text: `source: ${skill.source}` });
  main.addEventListener("click", () => deps.onOpen(skill));

  const toggleBtn = item.createEl("button", {
    cls: `llm-bridge-agent-skill-toggle ${skill.enabled ? "is-enabled" : "is-disabled"}`,
    text: skill.enabled ? "关闭" : "启用",
    attr: { title: "启用/禁用此 Agent Skill（只更新 manifest，不插入输入框）" },
  });
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deps.onToggle(skill.id, !skill.enabled);
  });
}
