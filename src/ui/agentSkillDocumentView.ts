// LLM CLI Bridge — Agent Skill Document View（从 view.ts 渐进拆分 P0）
// 独立小视图，展示单个 SKILL.md 文档内容

import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import * as fs from "fs";
import * as path from "path";

export const VIEW_TYPE_AGENT_SKILL_DOCUMENT = "llm-cli-bridge-agent-skill-document";

interface AgentSkillDocumentState {
  skillPath?: string;
  displayPath?: string;
  title?: string;
}

export class AgentSkillDocumentView extends ItemView {
  private state: AgentSkillDocumentState = {};

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = true;
    this.icon = "sparkles";
  }

  getViewType(): string {
    return VIEW_TYPE_AGENT_SKILL_DOCUMENT;
  }

  getDisplayText(): string {
    return this.state.title ? `Skill: ${this.state.title}` : "Agent Skill";
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    await super.setState(state, result);
    const next = (state && typeof state === "object" ? state : {}) as AgentSkillDocumentState;
    this.state = {
      skillPath: typeof next.skillPath === "string" ? next.skillPath : "",
      displayPath: typeof next.displayPath === "string" ? next.displayPath : "",
      title: typeof next.title === "string" ? next.title : "Agent Skill",
    };
    await this.renderSkillDocument();
  }

  protected async onOpen(): Promise<void> {
    await this.renderSkillDocument();
  }

  private async renderSkillDocument(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("llm-bridge-agent-skill-doc");
    const skillPath = this.state.skillPath || "";
    const displayPath = this.state.displayPath || skillPath;
    const header = root.createDiv({ cls: "llm-bridge-agent-skill-doc-head" });
    header.createEl("span", { cls: "llm-bridge-agent-skill-doc-kicker", text: "Agent Skill" });
    header.createEl("h2", { text: this.state.title || path.basename(path.dirname(displayPath)) || "Agent Skill" });
    header.createEl("div", {
      cls: "llm-bridge-agent-skill-doc-path",
      text: displayPath || "No SKILL.md path",
      attr: { title: displayPath || "" },
    });

    const body = root.createDiv({ cls: "llm-bridge-agent-skill-doc-body" });
    if (!skillPath) {
      body.createDiv({ cls: "llm-bridge-list-error", text: "缺少 SKILL.md 路径" });
      return;
    }
    try {
      const markdown = await this.readSkillMarkdown(skillPath);
      await MarkdownRenderer.render(this.app, markdown, body, skillPath.replace(/\\/g, "/"), this);
    } catch (error) {
      const err = body.createDiv({ cls: "llm-bridge-list-error" });
      err.createEl("span", { text: "无法读取 Agent Skill 文档" });
      err.createEl("span", {
        cls: "llm-bridge-agent-skill-doc-error-path",
        text: displayPath || skillPath,
        attr: { title: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async readSkillMarkdown(skillPath: string): Promise<string> {
    const normalized = skillPath.replace(/\\/g, "/");
    if (!path.isAbsolute(skillPath)) {
      return this.app.vault.adapter.read(normalized);
    }
    return fs.promises.readFile(skillPath, "utf8");
  }
}
