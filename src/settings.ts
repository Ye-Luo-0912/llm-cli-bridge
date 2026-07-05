// LLM CLI Bridge — 设置页

import { App, PluginSettingTab, Setting } from "obsidian";
import type LLMBridgePlugin from "../main";
import { AgentType, BackendMode, BackendProfile, ClaudePermissionMode, PermissionPolicy, PiToolMode } from "./types";

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

    // ===== 基础配置（普通用户日常只关心这里） =====
    containerEl.createEl("h3", { text: "基础配置" });

    new Setting(containerEl)
      .setName("Agent 类型")
      .setDesc("选择要调用的本地 CLI agent。默认 Claude Code，也可以在面板顶部临时切换。日常使用保持 claude 即可。")
      .addDropdown((dd) => {
        dd.addOption("claude", "Claude Code");
        dd.addOption("codex", "Codex CLI");
        dd.addOption("custom", "Custom");
        dd.setValue(s.agentType);
        dd.onChange(async (v) => {
          s.agentType = v as AgentType;
          await this.plugin.saveSettings();
          this.display();
          // V2.11.1: 关键配置变更后通知 view 刷新状态栏
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("引用当前笔记")
      .setDesc("开启后，运行时把当前活动笔记内容注入 prompt。默认关闭——点面板「总结当前笔记」按钮会自动打开。")
      .addToggle((t) =>
        t.setValue(s.includeActiveNote).onChange(async (v) => {
          s.includeActiveNote = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("引用选区")
      .setDesc("开启后，运行时把当前选中文本注入 prompt。默认开启——点面板「解释选区」按钮会确保打开。")
      .addToggle((t) =>
        t.setValue(s.includeSelection).onChange(async (v) => {
          s.includeSelection = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("推荐输出目录")
      .setDesc("生成长内容时的建议目录（相对 Vault 根）。可留空。仅作建议，实际路径由 AGENTS.md 或用户请求决定。")
      .addText((t) =>
        t.setValue(s.outputDir).onChange(async (v) => {
          s.outputDir = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    // ===== 高级配置（命令/参数，普通用户一般不改） =====
    containerEl.createEl("h3", { text: "高级配置（命令与参数）" });
    containerEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "默认值已经可用。只有在本地 CLI 名称不同或需要自定义参数时才修改。",
    });

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

    // V1.5: Claude Code command profile（continue / resume / permission / extra args）
    containerEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "Claude Code 会话与权限参数。普通用户保持默认即可；需要在自动接受编辑或继续上次会话时再调整。",
    });

    new Setting(containerEl)
      .setName("继续上次会话 (--continue)")
      .setDesc("开启后每次运行追加 --continue，继续最近一次 Claude Code 会话。与下方 resume 互斥。默认关闭。")
      .addToggle((t) =>
        t.setValue(s.claudeContinueSession).onChange(async (v) => {
          s.claudeContinueSession = v;
          if (v) s.claudeResumeSessionId = ""; // 互斥：清空 resume
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("恢复指定会话 (--resume <id>)")
      .setDesc("填写会话 ID 后追加 --resume <id>。留空则不添加。开启「继续上次会话」时此项被忽略。")
      .addText((t) =>
        t.setValue(s.claudeResumeSessionId).onChange(async (v) => {
          s.claudeResumeSessionId = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("保持上次会话")
      .setDesc("插件重载、视图关闭再打开、Obsidian 重启后自动恢复上次活动会话（消息、Pinned context、模式、模型/effort、backend、权限模式）。新聊天按钮才创建新会话。")
      .addToggle((t) =>
        t.setValue(s.keepLastSession).onChange(async (v) => {
          s.keepLastSession = v;
          if (!v) s.lastActiveSessionId = "";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("权限模式 (--permission-mode)")
      .setDesc("SDK 与 CLI 共用的权限模式。default=默认询问；acceptEdits=自动接受编辑；plan=只读规划；auto=自动决策；dontAsk=不询问；bypassPermissions=跳过所有权限（危险）。默认 default。风险说明见面板状态栏。")
      .addDropdown((d) => {
        d.addOption("default", "default（默认询问）");
        d.addOption("acceptEdits", "acceptEdits（自动接受编辑）");
        d.addOption("plan", "plan（只读规划）");
        d.addOption("auto", "auto（自动决策）");
        d.addOption("dontAsk", "dontAsk（不询问，危险）");
        d.addOption("bypassPermissions", "bypassPermissions（跳过权限，危险）");
        d.setValue(s.claudePermissionMode);
        d.onChange(async (v) => {
          s.claudePermissionMode = v as ClaudePermissionMode;
          await this.plugin.saveSettings();
          // V2.11.1: 权限模式影响状态栏显示，通知 view 刷新
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("额外参数 (extra args)")
      .setDesc("追加到 claude 命令末尾的自定义参数（按空白拆分）。例如 --no-cache。留空则不添加。")
      .addText((t) =>
        t.setValue(s.claudeExtraArgs).onChange(async (v) => {
          s.claudeExtraArgs = v;
          await this.plugin.saveSettings();
        }),
      );

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

    // ===== 日志与显示 =====
    containerEl.createEl("h3", { text: "日志与显示" });
    new Setting(containerEl)
      .setName("显示 stderr")
      .setDesc("在面板中展示 stderr 流。默认开启——失败时错误摘要与 debug log 路径会显示在消息下方。")
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

    // ===== 开发者区域（mock / devTestMode） =====
    containerEl.createEl("h3", { text: "开发者区域" });
    containerEl.createEl("p", {
      cls: "llm-bridge-setting-hint llm-bridge-setting-hint-warn",
      text: "以下选项仅供开发与测试。日常使用请保持 Backend 模式为 auto，不要开启 Dev Test Mode。",
    });

    // V2.3: 权限策略（low / medium / high）
    new Setting(containerEl)
      .setName("权限策略")
      .setDesc("low=宽松（读允许，medium 写操作自动允许）；medium=默认（读允许，Vault 内写操作本轮授权）；high=严格（所有操作需确认，包括读操作）")
      .addDropdown((d) => {
        d.addOption("low", "low（宽松）");
        d.addOption("medium", "medium（默认）");
        d.addOption("high", "high（严格）");
        d.setValue(s.permissionPolicy);
        d.onChange(async (v) => {
          s.permissionPolicy = v as PermissionPolicy;
          await this.plugin.saveSettings();
          // V2.11.1: 权限策略影响状态栏显示，通知 view 刷新
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("Backend 模式")
      .setDesc("auto=SDK-first + Claude Code CLI fallback（默认生产）；cli=始终使用 Claude Code CLI；sdk=始终使用 SDK（不可用时显示错误，不 fallback）；pi-sdk=Pi SDK 嵌入（V17-B portable 主线）；pi-rpc=Pi RPC portable spike；mock-success / mock-failure=离线测试用。")
      .addDropdown((d) => {
        d.addOption("auto", "auto（SDK-first + CLI fallback）");
        d.addOption("cli", "cli（Claude Code CLI）");
        d.addOption("sdk", "sdk（Claude Agent SDK）");
        d.addOption("pi-sdk", "pi-sdk（Pi SDK 嵌入，portable 主线）");
        d.addOption("pi-rpc", "pi-rpc（Pi portable backend spike）");
        d.addOption("mock-success", "mock-success（演示成功流程）");
        d.addOption("mock-failure", "mock-failure（演示失败流程）");
        d.setValue(s.backendMode);
        d.onChange(async (v) => {
          s.backendMode = v as BackendMode;
          await this.plugin.saveSettings();
          // V2.10 (B-019): 通知 view 刷新状态栏，Backend 值立即更新（替代原 saveSettings 不刷新的问题）
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("Backend 配置档")
      .setDesc("V17-A: developer=Claude/Codex/Pi/mock 全可选（默认）；portable=朋友版，auto 优先 Pi，UI 精简不暴露实验选项。")
      .addDropdown((d) => {
        d.addOption("developer", "developer（全后端可选）");
        d.addOption("portable", "portable（朋友版，优先 Pi）");
        d.setValue(s.backendProfile);
        d.onChange(async (v) => {
          s.backendProfile = v as BackendProfile;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("Pi 命令")
      .setDesc("V17-A: Pi portable backend spike 命令（默认 pi；未安装时 unavailable，不崩溃）。")
      .addText((t) =>
        t.setValue(s.piCommand).onChange(async (v) => {
          s.piCommand = v.trim() || "pi";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Pi 参数")
      .setDesc("V17-A: pi 启动参数（默认 --mode rpc）。")
      .addText((t) =>
        t.setValue(s.piArgs).onChange(async (v) => {
          s.piArgs = v.trim() || "--mode rpc";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Pi SDK 工具模式")
      .setDesc("V17-C: pi-native=使用 Pi 默认 read/write/edit/bash（朋友版默认，首次需确认 trust）；bridge-controlled=bridge_* 走 Bridge approval；read-only=只启用 read。")
      .addDropdown((d) => {
        d.addOption("pi-native", "pi-native（Pi 默认工具，朋友版）");
        d.addOption("bridge-controlled", "bridge-controlled（Bridge 审批）");
        d.addOption("read-only", "read-only（仅 read）");
        d.setValue(s.piToolMode);
        d.onChange(async (v) => {
          s.piToolMode = v as PiToolMode;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("Pi Native Trust 确认")
      .setDesc(
        s.piNativeTrustConfirmed
          ? "已确认：Pi Native Tools 可读写当前 Vault。"
          : "未确认：pi-native 模式将被阻止启动。点击确认前请先备份 Vault。"
      )
      .addButton((b) => {
        b.setButtonText(s.piNativeTrustConfirmed ? "重新确认" : "确认 Pi Native Trust");
        b.onClick(async () => {
          s.piNativeTrustConfirmed = true;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
          this.display();
        });
      })
      .addButton((b) => {
        b.setButtonText("撤销确认");
        b.onClick(async () => {
          s.piNativeTrustConfirmed = false;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Dev Test Mode")
      .setDesc("启用开发测试端点 /dev/approve 和 /dev/reject，用于自动化测试。仅在开发测试时开启，正式使用请关闭。")
      .addToggle((t) =>
        t.setValue(s.devTestMode).onChange(async (v) => {
          s.devTestMode = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Developer mode")
      .setDesc("默认关闭。开启后在聊天消息中显示 raw command、workflow trace、debug log 与完整 SDK raw log。普通用户界面保持精简。")
      .addToggle((t) =>
        t.setValue(s.developerMode).onChange(async (v) => {
          s.developerMode = v;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        }),
      );

    // V2.10 (B-003): 重新显示首次使用提示
    // 关闭后只能通过清除 localStorage 重新显示，现在在设置页提供按钮
    new Setting(containerEl)
      .setName("重新显示首次使用提示")
      .setDesc("清除「不再显示首次使用提示」标记，下次打开面板时将重新显示 3 步引导。")
      .addButton((b) =>
        b.setButtonText("重新显示").onClick(() => {
          localStorage.removeItem("llm-bridge-guide-dismissed");
        }),
      );
  }
}
