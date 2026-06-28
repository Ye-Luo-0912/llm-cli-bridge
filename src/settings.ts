// LLM CLI Bridge — 设置页

import { App, PluginSettingTab, Setting } from "obsidian";
import type LLMBridgePlugin from "../main";
import { AgentType, BackendMode } from "./types";

export class LLMBridgeSettingTab extends PluginSettingTab {
  plugin: LLMBridgePlugin;

  constructor(app: App, plugin: LLMBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("Agent 类型")
      .setDesc("选择要调用的本地 CLI agent。也可以在 Chat View 顶部临时切换。")
      .addDropdown((dd) => {
        dd.addOption("claude", "Claude Code");
        dd.addOption("codex", "Codex CLI");
        dd.addOption("custom", "Custom");
        dd.setValue(s.agentType);
        dd.onChange(async (v) => {
          s.agentType = v as AgentType;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    containerEl.createEl("h3", { text: "Claude Code" });
    new Setting(containerEl)
      .setName("Claude command")
      .setDesc("默认 claude")
      .addText((t) =>
        t.setValue(s.claudeCommand).onChange(async (v) => {
          s.claudeCommand = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Claude args")
      .setDesc("默认 -p（prompt 通过 stdin 传入）")
      .addText((t) =>
        t.setValue(s.claudeArgs).onChange(async (v) => {
          s.claudeArgs = v;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "Codex CLI" });
    new Setting(containerEl)
      .setName("Codex command")
      .setDesc("默认 codex")
      .addText((t) =>
        t.setValue(s.codexCommand).onChange(async (v) => {
          s.codexCommand = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Codex args")
      .setDesc('默认 "exec -"（从 stdin 读取）')
      .addText((t) =>
        t.setValue(s.codexArgs).onChange(async (v) => {
          s.codexArgs = v;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "Custom" });
    new Setting(containerEl)
      .setName("Custom command")
      .setDesc("自定义可执行命令（需能从 stdin 读取 prompt）")
      .addText((t) =>
        t.setValue(s.customCommand).onChange(async (v) => {
          s.customCommand = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Custom args")
      .addText((t) =>
        t.setValue(s.customArgs).onChange(async (v) => {
          s.customArgs = v;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "引用与导出" });
    new Setting(containerEl)
      .setName("引用当前笔记")
      .setDesc("开启后导出 active-note.md。默认关闭。")
      .addToggle((t) =>
        t.setValue(s.includeActiveNote).onChange(async (v) => {
          s.includeActiveNote = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("引用选区")
      .setDesc("开启后导出 selection.md。默认开启。")
      .addToggle((t) =>
        t.setValue(s.includeSelection).onChange(async (v) => {
          s.includeSelection = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("最大 active note 导出字符数")
      .addText((t) => {
        t.setValue(String(s.maxActiveNoteChars));
        t.inputEl.type = "number";
        t.onChange(async (v) => {
          const n = Number.parseInt(v, 10);
          if (!Number.isNaN(n) && n >= 0) {
            s.maxActiveNoteChars = n;
            await this.plugin.saveSettings();
          }
        });
      });
    new Setting(containerEl)
      .setName("最大 selection 导出字符数")
      .addText((t) => {
        t.setValue(String(s.maxSelectionChars));
        t.inputEl.type = "number";
        t.onChange(async (v) => {
          const n = Number.parseInt(v, 10);
          if (!Number.isNaN(n) && n >= 0) {
            s.maxSelectionChars = n;
            await this.plugin.saveSettings();
          }
        });
      });
    new Setting(containerEl)
      .setName("推荐输出目录")
      .setDesc("生成长内容时的建议目录（相对 Vault 根）。可留空。仅作建议，实际路径由 AGENTS.md 或用户请求决定。")
      .addText((t) =>
        t.setValue(s.outputDir).onChange(async (v) => {
          s.outputDir = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "日志与显示" });
    new Setting(containerEl)
      .setName("显示 stderr")
      .setDesc("在 Chat View 中展示 stderr 流。默认开启。")
      .addToggle((t) =>
        t.setValue(s.showStderr).onChange(async (v) => {
          s.showStderr = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("保存运行日志")
      .setDesc("将每次运行的 stdout/stderr/exit 信息写入 .llm-bridge/logs/。默认开启。")
      .addToggle((t) =>
        t.setValue(s.saveLogs).onChange(async (v) => {
          s.saveLogs = v;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "开发者" });
    new Setting(containerEl)
      .setName("Dev Test Mode")
      .setDesc("启用开发测试端点 /dev/approve 和 /dev/reject，用于自动化测试。仅在开发测试时开启。")
      .addToggle((t) =>
        t.setValue(s.devTestMode).onChange(async (v) => {
          s.devTestMode = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Backend 模式（Demo / Mock）")
      .setDesc("auto=使用真实 ClaudeCliBackend（默认生产）；mock-success/mock-failure=使用 MockAgentBackend 驱动 UI 演示，不调用真实 CLI。")
      .addDropdown((d) => {
        d.addOption("auto", "auto（真实 CLI）");
        d.addOption("mock-success", "mock-success（演示成功流程）");
        d.addOption("mock-failure", "mock-failure（演示失败流程）");
        d.setValue(s.backendMode);
        d.onChange(async (v) => {
          s.backendMode = v as BackendMode;
          await this.plugin.saveSettings();
        });
      });
  }
}
