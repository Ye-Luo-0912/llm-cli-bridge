// LLM CLI Bridge — 设置页

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LLMBridgePlugin from "../main";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { AgentType, BackendMode, BackendProfile, PermissionPolicy, PiToolMode } from "./types";
import {
  AGENT_APPROVAL_PROFILES,
  isAgentApprovalProfile,
  mapAgentApprovalProfileToClaudePermissionMode,
  type AgentApprovalProfile,
} from "./agentApprovalProfile";

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
      .setName("运行方式")
      .setDesc(
        s.backendMode === "auto"
          ? "自动选择（推荐）：优先使用插件管理的 Codex runtime，不可用时再按高级设置回退。聊天面板状态栏显示本轮真实 runtime。"
          : `当前固定为 ${s.backendMode}。可在下方高级设置中改回自动选择。`,
      );

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

    // ===== 本地认证配置（provider-neutral 中转站，普通用户首选） =====
    containerEl.createEl("h3", { text: "本地认证配置" });
    containerEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "配置 OpenAI-compatible 中转站后，Codex runtime 使用同一地址、模型和认证。聊天框模型始终以当前 runtime 的 model/list 为准；未配置时回退原生认证。",
    });

    new Setting(containerEl)
      .setName("中转站地址")
      .setDesc("如 https://api.example.com。配置后注入 ANTHROPIC_BASE_URL / OPENAI_BASE_URL / Pi baseUrl。留空则使用原生认证。")
      .addText((t) => {
        t.setValue(s.localRelayUrl);
        t.onChange(async (v) => {
          s.localRelayUrl = v.trim();
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("V20.2：默认使用本机加密（Electron safeStorage）持久化到 runtime-provider.json，重启后自动恢复；不写入 Vault 明文。safeStorage 不可用时仅存内存。")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s.localRelayApiKey);
        t.onChange(async (v) => {
          s.localRelayApiKey = v.trim();
          await this.plugin.saveSettings();
          // V20.2: 默认持久化到 runtime-provider.json（safeStorage 加密）
          try {
            const vaultPath = (this.plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
            const { loadRuntimeProviderConfig, saveRuntimeProviderConfig } = await import("./runtime/runtimeProviderConfig");
            const existing = await loadRuntimeProviderConfig(vaultPath, s);
            await saveRuntimeProviderConfig(vaultPath, {
              relayUrl: existing.config?.relayUrl || s.localRelayUrl,
              apiKey: s.localRelayApiKey,
              model: existing.config?.model || s.model,
            });
          } catch { /* safeStorage 不可用时仅存内存 */ }
          this.plugin.refreshBridgeView();
        });
      })
      .addButton((b) => {
        b.setButtonText("忘记 Key");
        b.onClick(async () => {
          try {
            const vaultPath = (this.plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
            const { loadRuntimeProviderConfig, saveRuntimeProviderConfig } = await import("./runtime/runtimeProviderConfig");
            const existing = await loadRuntimeProviderConfig(vaultPath, s);
            if (existing.config) {
              // 清除 apiKey，保留 relayUrl/model
              await saveRuntimeProviderConfig(vaultPath, {
                relayUrl: existing.config.relayUrl,
                apiKey: "",
                model: existing.config.model,
              });
            }
            s.localRelayApiKey = "";
            await this.plugin.saveSettings();
            new Notice("已忘记 API Key（已清除本机加密存储）", 4000);
            this.plugin.refreshBridgeView();
          } catch (e) {
            new Notice("忘记 Key 失败：" + (e instanceof Error ? e.message : String(e)), 5000);
          }
        });
      });

    new Setting(containerEl)
      .setName("便携目录路径（高级，可选）")
      .setDesc("高级选项：设置后从该目录读取 runtime-profile.key，可让多个 Vault 共用同一份明文 Key（不经过 safeStorage 加密）。默认无需配置。")
      .addText((t) => {
        t.setValue(s.localRelayPortableKeyPath);
        t.onChange(async (v) => {
          s.localRelayPortableKeyPath = v.trim();
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        });
      })
      .addButton((b) => {
        b.setButtonText("保存当前 Key");
        b.onClick(async () => {
          if (!s.localRelayPortableKeyPath || !s.localRelayApiKey) {
            new Notice("请先填写便携目录路径和 API Key", 4000);
            return;
          }
          const vaultPath = (this.plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
          const portableDir = isAbsolute(s.localRelayPortableKeyPath)
            ? s.localRelayPortableKeyPath
            : resolve(vaultPath, s.localRelayPortableKeyPath);
          const { savePortableApiKey } = await import("./runtime/runtimeProfileResolver");
          const ok = await savePortableApiKey(portableDir, s.localRelayApiKey);
          new Notice(ok ? "API Key 已保存到便携目录" : "API Key 保存失败", 4000);
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(containerEl)
      .setName("保存到 Vault Profile")
      .setDesc("把中转站地址和模型写入 .llm-bridge/runtime-profile.json（可随 Vault 同步，不含 API Key）。")
      .addButton((b) => {
        b.setButtonText("保存 Profile");
        b.onClick(async () => {
          b.setDisabled(true);
          try {
            const { saveVaultRuntimeProfile } = await import("./runtime/runtimeProfileResolver");
            const vaultPath = (this.plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
            const ok = await saveVaultRuntimeProfile(vaultPath, {
              relayUrl: s.localRelayUrl,
              model: s.model,
            });
            new Notice(ok ? "Vault Profile 已保存（不含 Key）" : "保存失败", 4000);
          } catch (e) {
            new Notice("保存失败：" + (e instanceof Error ? e.message : String(e)), 5000);
          } finally {
            b.setDisabled(false);
          }
        });
      });

    new Setting(containerEl)
      .setName("发现并匹配模型")
      .setDesc("同时请求中转站 /v1/models 和 Codex runtime model/list，交叉匹配后只把可用模型放入聊天框。")
      .addButton((b) => {
        b.setButtonText("发现并匹配模型");
        b.onClick(async () => {
          b.setButtonText("匹配中...");
          b.setDisabled(true);
          try {
            const vaultPath = (this.plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
            // V20.2: 通过 resolveRuntimeProfile 获取真实 relayUrl/apiKey（含加密持久化恢复）
            const { resolveRuntimeProfile, testRelayConnection, desensitizeError } = await import("./runtime/runtimeProfileResolver");
            const profile = await resolveRuntimeProfile(vaultPath, s);
            if (!profile.relayUrl || !profile.apiKey) {
              new Notice("请先配置中转站地址和 API Key", 5000);
              return;
            }
            // 1. 请求中转站 /v1/models
            const relayResult = await testRelayConnection(profile.relayUrl, profile.apiKey, s.model);
            if (!relayResult.ok) {
              new Notice("中转站连接失败：" + relayResult.detail, 8000);
              return;
            }
            // 2. 请求 Codex runtime model/list（V20.2: 先清缓存确保最新）
            const { loadCodexManagedModelCatalog, clearCodexManagedModelCatalogCache } = await import("./runtime/providers/codex-managed-app-server/codexManagedModelCatalog");
            clearCodexManagedModelCatalogCache();
            const runtimeCatalog = await loadCodexManagedModelCatalog(this.plugin.pluginDir, vaultPath, s);
            // 3. 交叉匹配
            const { matchModels, formatMatchSummary } = await import("./runtime/modelMatcher");
            const relayModels = relayResult.models.map((id) => ({ id }));
            const runtimeModels = runtimeCatalog?.runtimeModels ?? [];
            const matchResult = matchModels(relayModels, runtimeModels);
            // 4. 更新 models 和 defaultModel
            // V20.3: 即使无可用模型也持久化发现结果（含不兼容原因），便于 UI 显示
            if (matchResult.selectable.length > 0) {
              s.model = matchResult.defaultModel || matchResult.selectable[0].value;
              await this.plugin.saveSettings();
            }
            const { saveRuntimeProviderConfig } = await import("./runtime/runtimeProviderConfig");
            await saveRuntimeProviderConfig(vaultPath, {
              relayUrl: profile.relayUrl,
              apiKey: profile.apiKey,
              model: s.model,
              providerModels: relayResult.models,
              verifiedModels: matchResult.available.map((m) => m.value),
              pendingModels: matchResult.pending.map((m) => m.value),
              incompatibleModels: matchResult.incompatible.map((m) => ({
                id: m.value,
                reason: m.incompatibleReason || "不兼容",
              })),
              discoveredAt: new Date().toISOString(),
            });
            // 5. 显示统计
            new Notice(formatMatchSummary(matchResult), 8000);
            this.plugin.refreshBridgeView();
          } catch (e) {
            const { desensitizeError } = await import("./runtime/runtimeProfileResolver");
            new Notice("匹配失败：" + desensitizeError(e, s.localRelayApiKey), 6000);
          } finally {
            b.setButtonText("发现并匹配模型");
            b.setDisabled(false);
          }
        });
      });

    new Setting(containerEl)
      .setName("刷新模型目录")
      .setDesc("清除缓存后重新读取 Codex runtime model/list，用于 runtime 更新或中转站新增/删除模型后重新匹配。")
      .addButton((b) => {
        b.setButtonText("刷新");
        b.onClick(async () => {
          b.setDisabled(true);
          try {
            // V20.2: 清除模型目录缓存，强制下次重新读取
            const { clearCodexManagedModelCatalogCache } = await import("./runtime/providers/codex-managed-app-server/codexManagedModelCatalog");
            clearCodexManagedModelCatalogCache();
            const { clearRuntimeModelCatalogForAgent } = await import("./runtimeModelCatalog");
            clearRuntimeModelCatalogForAgent("codex");
            this.plugin.refreshBridgeView();
            new Notice("已清除缓存并刷新模型目录，重新打开聊天框生效", 4000);
          } finally {
            b.setDisabled(false);
          }
        });
      });

    new Setting(containerEl)
      .setName("验证当前模型")
      .setDesc("对当前选中的模型发起一次真实 Responses 请求，验证可用性（会产生少量费用）。")
      .addButton((b) => {
        b.setButtonText("验证");
        b.onClick(async () => {
          b.setButtonText("验证中...");
          b.setDisabled(true);
          try {
            const { resolveRuntimeProfile, testRelayConnection, desensitizeError } = await import("./runtime/runtimeProfileResolver");
            const vaultPath = (this.plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
            // V20.2: 通过 resolveRuntimeProfile 获取真实 relayUrl/apiKey（含加密持久化恢复）
            const profile = await resolveRuntimeProfile(vaultPath, s);
            if (!profile.relayUrl || !profile.apiKey) {
              new Notice("请先配置中转站地址和 API Key", 5000);
              return;
            }
            // 只验证当前选中模型
            const result = await testRelayConnection(profile.relayUrl, profile.apiKey, s.model);
            new Notice(result.ok ? `模型 ${s.model} 验证通过` : `验证失败：${result.detail}`, 6000);
          } catch (e) {
            const { desensitizeError } = await import("./runtime/runtimeProfileResolver");
            new Notice("验证失败：" + desensitizeError(e, s.localRelayApiKey), 6000);
          } finally {
            b.setButtonText("验证");
            b.setDisabled(false);
          }
        });
      });

    new Setting(containerEl)
      .setName("重载")
      .setDesc("重新读取 Vault Profile 和便携 Key，刷新状态栏。")
      .addButton((b) => {
        b.setButtonText("重载");
        b.onClick(async () => {
          b.setDisabled(true);
          try {
            this.plugin.refreshBridgeView();
            new Notice("已重载本地中转配置", 3000);
          } finally {
            b.setDisabled(false);
          }
        });
      });

    // ===== 高级设置（折叠） =====
    const advancedDetails = containerEl.createEl("details", { cls: "llm-bridge-advanced-settings" });
    advancedDetails.createEl("summary", { text: "高级设置（命令参数、开发者选项、Runtime 详细配置）" });
    const advancedEl = advancedDetails.createDiv({ cls: "llm-bridge-advanced-settings-body" });

    // ===== 高级配置（命令/参数，普通用户一般不改） =====
    advancedEl.createEl("h3", { text: "高级配置（命令与参数）" });
    advancedEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "默认值已经可用。只有在本地 CLI 名称不同或需要自定义参数时才修改。",
    });

    new Setting(advancedEl)
      .setName("CLI 回退 Agent")
      .setDesc("仅在自动 runtime 不可用或显式使用 CLI backend 时生效；不会覆盖聊天面板显示的真实 runtime。")
      .addDropdown((dd) => {
        dd.addOption("claude", "Claude Code");
        dd.addOption("codex", "Codex CLI");
        dd.addOption("custom", "Custom");
        dd.setValue(s.agentType);
        dd.onChange(async (v) => {
          s.agentType = v as AgentType;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(advancedEl)
      .setName("Claude command")
      .setDesc("默认 claude")
      .addText((t) =>
        t.setValue(s.claudeCommand).onChange(async (v) => {
          s.claudeCommand = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(advancedEl)
      .setName("Claude args")
      .setDesc("默认 -p（prompt 通过 stdin 传入）")
      .addText((t) =>
        t.setValue(s.claudeArgs).onChange(async (v) => {
          s.claudeArgs = v;
          await this.plugin.saveSettings();
        }),
      );

    // V1.5: Claude Code command profile（continue / resume / permission / extra args）
    advancedEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "Claude Code 会话与权限参数。普通用户保持默认即可；需要在自动接受编辑或继续上次会话时再调整。",
    });

    new Setting(advancedEl)
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

    new Setting(advancedEl)
      .setName("恢复指定会话 (--resume <id>)")
      .setDesc("填写会话 ID 后追加 --resume <id>。留空则不添加。开启「继续上次会话」时此项被忽略。")
      .addText((t) =>
        t.setValue(s.claudeResumeSessionId).onChange(async (v) => {
          s.claudeResumeSessionId = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
      .setName("保持上次会话")
      .setDesc("插件重载、视图关闭再打开、Obsidian 重启后自动恢复上次活动会话（消息、Pinned context、模式、模型/effort、backend、权限模式）。新聊天按钮才创建新会话。")
      .addToggle((t) =>
        t.setValue(s.keepLastSession).onChange(async (v) => {
          s.keepLastSession = v;
          if (!v) s.lastActiveSessionId = "";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
      .setName("Agent 审批画像")
      .setDesc("请求批准 / 替我审批 / 完全访问。Codex 由此映射 approvalPolicy、approvalsReviewer 与 sandbox；完全访问需在面板中显式确认。计划模式已移出权限菜单（Claude 可在下方单独设置）。")
      .addDropdown((d) => {
        for (const profile of AGENT_APPROVAL_PROFILES) {
          d.addOption(profile.id, `${profile.title} — ${profile.description}`);
        }
        const current = isAgentApprovalProfile(s.agentApprovalProfile) ? s.agentApprovalProfile : "ask";
        d.setValue(current);
        d.onChange(async (v) => {
          const profile = v as AgentApprovalProfile;
          if (profile === "full-access") {
            // 设置页不静默启用完全访问；提示用户在面板权限菜单中确认
            new Notice("完全访问需在聊天面板权限菜单中显式确认后启用。");
            d.setValue(isAgentApprovalProfile(s.agentApprovalProfile) ? s.agentApprovalProfile : "ask");
            return;
          }
          s.agentApprovalProfile = profile;
          s.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode(profile);
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        });
      });

    new Setting(advancedEl)
      .setName("Claude 计划模式")
      .setDesc("仅 Claude：开启后使用 --permission-mode plan（只读规划）。不影响 Codex 审批画像。")
      .addToggle((t) =>
        t.setValue(s.claudePermissionMode === "plan").onChange(async (v) => {
          if (v) {
            s.claudePermissionMode = "plan";
          } else if (s.claudePermissionMode === "plan") {
            s.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode(
              isAgentApprovalProfile(s.agentApprovalProfile) ? s.agentApprovalProfile : "ask",
            );
          }
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        }),
      );

    new Setting(advancedEl)
      .setName("额外参数 (extra args)")
      .setDesc("追加到 claude 命令末尾的自定义参数（按空白拆分）。例如 --no-cache。留空则不添加。")
      .addText((t) =>
        t.setValue(s.claudeExtraArgs).onChange(async (v) => {
          s.claudeExtraArgs = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
      .setName("Codex command")
      .setDesc("默认 codex")
      .addText((t) =>
        t.setValue(s.codexCommand).onChange(async (v) => {
          s.codexCommand = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(advancedEl)
      .setName("Codex args")
      .setDesc('默认 "exec -"（从 stdin 读取）')
      .addText((t) =>
        t.setValue(s.codexArgs).onChange(async (v) => {
          s.codexArgs = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
      .setName("Custom command")
      .setDesc("自定义可执行命令（需能从 stdin 读取 prompt）")
      .addText((t) =>
        t.setValue(s.customCommand).onChange(async (v) => {
          s.customCommand = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(advancedEl)
      .setName("Custom args")
      .addText((t) =>
        t.setValue(s.customArgs).onChange(async (v) => {
          s.customArgs = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
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
    new Setting(advancedEl)
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

    // ===== 开发者区域（mock / devTestMode） =====
    advancedEl.createEl("h3", { text: "开发者区域" });
    advancedEl.createEl("p", {
      cls: "llm-bridge-setting-hint llm-bridge-setting-hint-warn",
      text: "以下选项仅供开发与测试。日常使用请保持 Backend 模式为 auto，不要开启 Dev Test Mode。",
    });

    // V2.3: 权限策略（low / medium / high）
    new Setting(advancedEl)
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

    new Setting(advancedEl)
      .setName("Backend 模式")
      .setDesc("V17-F1 任务 D：auto = Managed runtime first（codex-managed→codex-sdk→claude-sdk→pi-sdk→cli）。codex-managed-app-server=我们管理的 pinned runtime binary（主线，不依赖用户安装 Codex CLI）；codex-sdk=Codex Agent SDK（占位）；codex-app-server-external=外部 codex app-server（高级/开发者 fallback）；cli=Claude Code CLI；sdk=Claude Agent SDK；pi-sdk/pi-rpc=Pi（optional/advanced）；mock=离线测试。")
      .addDropdown((d) => {
        d.addOption("auto", "auto（Managed：codex-managed→codex-sdk→claude-sdk→pi-sdk→cli）");
        d.addOption("codex-managed-app-server", "codex-managed-app-server（Managed pinned runtime 主线）");
        d.addOption("codex-sdk", "codex-sdk（Codex Agent SDK 占位）");
        d.addOption("codex-app-server-external", "codex-app-server-external（高级 fallback）");
        d.addOption("cli", "cli（Claude Code CLI）");
        d.addOption("sdk", "sdk（Claude Agent SDK）");
        d.addOption("pi-sdk", "pi-sdk（Pi SDK 嵌入，optional/advanced）");
        d.addOption("pi-rpc", "pi-rpc（Pi RPC，optional/advanced）");
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

    const runtimeStatus = this.plugin.getManagedRuntimeInstallStatus();
    const runtimeSize = typeof runtimeStatus.size === "number"
      ? `${(runtimeStatus.size / 1024 / 1024).toFixed(1)} MB`
      : "unknown";
    const runtimeBox = advancedEl.createDiv({ cls: "llm-bridge-managed-runtime-settings" });
    runtimeBox.createEl("div", {
      cls: "llm-bridge-managed-runtime-settings-title",
      text: "Managed Codex Runtime",
    });
    runtimeBox.createEl("div", {
      cls: "llm-bridge-managed-runtime-settings-grid",
      text: [
        `version=${runtimeStatus.version || "unknown"}`,
        `size=${runtimeSize}`,
        `source=${runtimeStatus.source || "unknown"}`,
        `sha256=${runtimeStatus.sha256 || "unknown"}`,
        `installPath=${runtimeStatus.installPath || "unknown"}`,
        `status=${runtimeStatus.status}`,
      ].join("\n"),
    });
    if (runtimeStatus.error) {
      runtimeBox.createEl("div", { cls: "llm-bridge-setting-hint llm-bridge-setting-hint-warn", text: runtimeStatus.error });
    }
    new Setting(runtimeBox)
      .setName("Codex runtime")
      .setDesc("Default package installs the pinned runtime on first run after user confirmation.")
      .addButton((button) => {
        button
          .setButtonText(runtimeStatus.required ? "Install Codex runtime" : "Retry install")
          .setTooltip("Download, verify, and install the pinned managed runtime")
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText("Installing...");
            const result = await this.plugin.ensureManagedRuntimeInstalled({ confirm: true });
            if (result.status === "installed" || result.status === "already-installed") {
              new Notice("Codex runtime installed");
            } else {
              new Notice(`Codex runtime install failed: ${result.error || result.status}`);
            }
            this.display();
            this.plugin.refreshBridgeView();
          });
      });

    new Setting(advancedEl)
      .setName("Backend 配置档")
      .setDesc("V17-F0 任务 C：developer/portable 的 auto 均走 SDK-first 链；portable 仅 UI 精简不暴露实验选项。Pi 为 optional/advanced。")
      .addDropdown((d) => {
        d.addOption("developer", "developer（全后端可选）");
        d.addOption("portable", "portable（朋友版，UI 精简）");
        d.setValue(s.backendProfile);
        d.onChange(async (v) => {
          s.backendProfile = v as BackendProfile;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        });
      });

    // V17-F0 任务 D：Codex Desktop App 不是集成目标 — 普通用户主线不出现 Codex CLI 安装引导
    advancedEl.createEl("h3", { text: "Codex Mainline Status (V17-F0 — SDK-first)" });
    advancedEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "V17-F0 任务 D：Codex 线以 SDK-first 为主（与 Claude/Pi 一致）。Desktop App / codex CLI 不是集成目标，不作为普通用户默认主线。codex-sdk 为本轮占位，readiness 以 smoke 报告为准（codexSdkAvailable / codexSdkAuthAvailable）。Desktop App is not an integration target.",
    });

    // V17-E 任务 F：Pi SDK 降级为 optional/advanced backend — 普通用户无需配置
    advancedEl.createEl("h3", { text: "Pi Backend (Optional / Advanced — V17-E 任务 F)" });
    advancedEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "Pi SDK/RPC 是可选 advanced backend，仅 portable profile 或显式选择 pi-sdk/pi-rpc 时启用。普通用户无需配置，默认走 SDK-first 路径。friendReady 字段已废弃，改名为 piAdvancedReady。",
    });

    new Setting(advancedEl)
      .setName("Pi 命令")
      .setDesc("V17-A: Pi portable backend spike 命令（默认 pi；未安装时 unavailable，不崩溃）。")
      .addText((t) =>
        t.setValue(s.piCommand).onChange(async (v) => {
          s.piCommand = v.trim() || "pi";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
      .setName("Pi 参数")
      .setDesc("V17-A: pi 启动参数（默认 --mode rpc）。")
      .addText((t) =>
        t.setValue(s.piArgs).onChange(async (v) => {
          s.piArgs = v.trim() || "--mode rpc";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
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

    new Setting(advancedEl)
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

    // V17-D 任务 F：Pi SDK Auth 设置 section（runtime override，不写 ~/.pi/agent）
    // RuntimeProfileResolver: 此 section 作为高级回退（原生认证），本地中转已配置时优先使用中转
    advancedEl.createEl("h3", { text: "Pi SDK Auth (Runtime Override — Optional/Advanced)" });
    advancedEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "高级回退（原生认证）：本地中转未配置时回退到此处的 Pi SDK 原生认证。已配置本地中转时，以上方「本地认证配置」为准。",
    });

    new Setting(advancedEl)
      .setName("Provider")
      .setDesc("V17-D 任务 F：API Key 所属 provider（默认 anthropic；可选 openai 等）。仅运行时注入，不写 ~/.pi/agent。")
      .addText((t) => {
        t.setValue(s.piAuthProvider);
        t.onChange(async (v) => {
          s.piAuthProvider = v.trim() || "anthropic";
          await this.plugin.saveSettings();
        });
      });

    new Setting(advancedEl)
      .setName("Model")
      .setDesc("显式指定 model id（如 claude-haiku-4-5）。留空则用 SDK 默认选择。")
      .addText((t) => {
        t.setValue(s.piApiModel);
        t.onChange(async (v) => {
          s.piApiModel = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(advancedEl)
      .setName("API Key")
      .setDesc("Pi SDK runtime API key。仅运行时注入 session.authStorage，不写磁盘全局配置。留空则 fallback 到 ~/.pi/agent 或 ~/.claude/settings.json env。")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s.piApiKey);
        t.onChange(async (v) => {
          s.piApiKey = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(advancedEl)
      .setName("Base URL")
      .setDesc("自定义 API base URL（可选，如 https://us.pinai-cn.com）。留空则用 provider 默认。")
      .addText((t) => {
        t.setValue(s.piApiBaseUrl);
        t.onChange(async (v) => {
          s.piApiBaseUrl = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(advancedEl)
      .setName("Test connection")
      .setDesc("V17-D 任务 F：探测当前 Pi SDK + auth override 是否可用。不发起真实请求，仅检查 auth/model 配置。")
      .addButton((b) => {
        b.setButtonText("Test connection");
        b.onClick(async () => {
          b.setButtonText("Testing...");
          b.setDisabled(true);
          try {
            const { PiSdkProvider, tryLoadPiSdkAsync } = await import("./runtime/providers/pi-sdk/piSdkProvider");
            await tryLoadPiSdkAsync(true);
            const provider = new PiSdkProvider();
            const probe = provider.getProbeResult();
            if (!probe.available) {
              new Notice("Pi SDK 不可用：" + (probe.error || probe.reason), 6000);
            } else {
              const override = {
                apiKey: s.piApiKey || undefined,
                provider: s.piAuthProvider || undefined,
                baseUrl: s.piApiBaseUrl || undefined,
                model: s.piApiModel || undefined,
              };
              const { probePiSdkAuth } = await import("./runtime/providers/pi-sdk/piSdkProvider");
              const authProbe = probePiSdkAuth(probe, override);
              if (authProbe.hasAuth && authProbe.hasModel) {
                new Notice("Pi SDK 连接测试通过：auth + model 已配置。", 5000);
              } else {
                new Notice("Pi SDK 认证/模型未配置：" + authProbe.hint, 8000);
              }
            }
          } catch (e) {
            new Notice("Pi SDK Test connection 失败：" + (e instanceof Error ? e.message : String(e)), 6000);
          } finally {
            b.setButtonText("Test connection");
            b.setDisabled(false);
          }
        });
      });

    // V17-F0 任务 F：External App-Server Fallback（高级/开发者）
    // 保留 codex app-server external provider，但只在显式选择 codex-app-server-external 时启用
    // 不作为普通用户默认路线，不引导用户安装 Codex Desktop App
    advancedEl.createEl("h3", { text: "External Codex App-Server Fallback (Advanced / Developer — V17-F0 任务 F)" });
    advancedEl.createEl("p", {
      cls: "llm-bridge-setting-hint",
      text: "V17-F0 任务 F：外部 codex app-server 是高级/开发者 fallback，不是普通用户主线。需要本机已安装 codex CLI 并完成 codex login。Desktop App is not an integration target；仅当用户明确选择 codex-app-server-external 模式时启用。Ready 仅表示本地探测通过（heuristic），真实可用性以 codex smoke 报告为准（codexExternalExecutableAvailable / externalAppServerSpawnStatus）。",
    });

    new Setting(advancedEl)
      .setName("Codex External Command (Advanced)")
      .setDesc("V17-F0 任务 F：外部 codex 可执行文件名或绝对路径（默认 codex）。仅用于 codex-app-server-external 模式；普通用户无需配置。")
      .addText((t) => {
        t.setValue(s.codexCommand);
        t.onChange(async (v) => {
          s.codexCommand = v.trim() || "codex";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(advancedEl)
      .setName("Codex External Args (Advanced)")
      .setDesc("V17-F0 任务 F：外部 codex app-server 启动参数（默认 app-server）。仅用于 codex-app-server-external 模式。")
      .addText((t) => {
        t.setValue(s.codexArgs);
        t.onChange(async (v) => {
          s.codexArgs = v.trim() || "app-server";
          await this.plugin.saveSettings();
        });
      });

    {
      // V17-F0 任务 F：external heuristic 探测（非 real smoke；不引导安装）
      const codexCmd = s.codexCommand || "codex";
      let codexInstalled = false;
      let codexVersion = "";
      let appServerOk = false;
      const cwd = this.app.vault.adapter.getResourcePath?.("") || ".";
      try {
        const out = execFileSync(codexCmd, ["--version"], {
          cwd: typeof cwd === "string" ? cwd : ".",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 3000,
          encoding: "utf8",
        });
        codexInstalled = true;
        codexVersion = (out || "").trim().split(/\r?\n/)[0] || "unknown";
      } catch { /* not installed */ }

      if (codexInstalled) {
        try {
          execFileSync(codexCmd, ["app-server", "--help"], {
            stdio: ["ignore", "ignore", "ignore"],
            timeout: 5000,
          });
          appServerOk = true;
        } catch { /* app-server not available */ }
      }

      const extStatus = !codexInstalled
        ? "未安装（external fallback 不可用）"
        : !appServerOk
          ? `已安装（${codexVersion}）但 app-server 不可用`
          : `heuristic-ready（${codexVersion}）`;

      new Setting(advancedEl)
        .setName("Codex External Status (Heuristic)")
        .setDesc(`V17-F0 任务 F：${extStatus} — 仅用于 codex-app-server-external 模式；真实可用性以 smoke 报告为准。`)
        .addButton((b) => {
          b.setButtonText("重新检测");
          b.onClick(() => this.display());
        });
    }

    new Setting(advancedEl)
      .setName("Dev Test Mode")
      .setDesc("启用开发测试端点 /dev/approve 和 /dev/reject，用于自动化测试。仅在开发测试时开启，正式使用请关闭。")
      .addToggle((t) =>
        t.setValue(s.devTestMode).onChange(async (v) => {
          s.devTestMode = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(advancedEl)
      .setName("Developer mode")
      .setDesc("默认关闭。开启后在聊天消息中显示 raw command、workflow trace、debug log 与完整 SDK raw log。普通用户界面保持精简。")
      .addToggle((t) =>
        t.setValue(s.developerMode).onChange(async (v) => {
          s.developerMode = v;
          await this.plugin.saveSettings();
          this.plugin.refreshBridgeView();
        }),
      );
  }
}
