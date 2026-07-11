// LLM CLI Bridge — 插件入口

import * as fs from "fs";
import * as path from "path";
import { DataAdapter, Editor, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { LLMBridgeSettingTab } from "./src/settings";
import { AgentSkillDocumentView, LLMBridgeView, VIEW_TYPE_AGENT_SKILL_DOCUMENT, VIEW_TYPE_LLM_BRIDGE } from "./src/view";
import { DEFAULT_SETTINGS, LLMBridgeSettings } from "./src/types";
import {
  isAgentApprovalProfile,
  mapAgentApprovalProfileToClaudePermissionMode,
  migrateLegacyPermissionToApprovalProfile,
} from "./src/agentApprovalProfile";
import { OutboxWatcher } from "./src/outbox";
import { BridgeInfo, BridgeWriteResult, HttpBridge } from "./src/httpServer";
import { writeHelperAndWrappers } from "./src/toolsWriter";
import { createBridgeSession } from "./src/runtime/core/bridgeSession";
import {
  ensureManagedRuntimeInstalledFromPlugin,
  getManagedRuntimeInstallStatus,
  type ManagedRuntimeInstallStatus,
} from "./src/runtime/providers/codex-managed-app-server/codexManagedRuntimeInstallerBridge";

const BRIDGE_FILE_REL = ".llm-bridge/bridge.json";

// 运行时动态 require（避免顶层 import 导致 renderer 加载失败）
function requireNode<T>(name: string): T {
  const g = globalThis as unknown as { require?: (n: string) => T };
  if (g.require) return g.require(name);
  return (require as (n: string) => T)(name);
}

// 生成 token：优先 crypto，不可用时用 Math.random 降级
function generateToken(): string {
  try {
    const crypto = requireNode<{ randomBytes: (n: number) => Buffer }>("crypto");
    return crypto.randomBytes(24).toString("hex");
  } catch {
    let s = "";
    for (let i = 0; i < 48; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
}

export default class LLMBridgePlugin extends Plugin {
  settings: LLMBridgeSettings = DEFAULT_SETTINGS;
  private outboxWatcher: OutboxWatcher | null = null;
  private httpBridge: HttpBridge | null = null;
  /** V17-F1.1 任务 C：插件目录（main.js + codex-managed-runtime/ 所在路径），onload 时从 manifest.dir 获取 */
  pluginDir: string = "";

  async onload(): Promise<void> {
    // V1.0.1: 诊断文件含 vaultPath / bridgePath / timestamp（actual port / bridgeWritten 在 HTTP 启动后补充）
    const vaultPath0 = this.getVaultPath();
    // V17-F6: Obsidian manifest.dir is relative to the vault (for example
    // ".obsidian/plugins/llm-cli-bridge"). Managed runtime resolution needs an
    // absolute plugin directory so the production package can find its manifest.
    const manifestDir = this.manifest.dir || "";
    this.pluginDir = path.isAbsolute(manifestDir) ? manifestDir : path.join(vaultPath0, manifestDir);
    const bridgePath0 = path.join(vaultPath0, BRIDGE_FILE_REL);
    try {
      await fs.promises.mkdir(path.dirname(bridgePath0), { recursive: true });
      await fs.promises.writeFile(path.join(vaultPath0, ".llm-bridge", "diag-onload.txt"),
        `onload ${new Date().toISOString()}\nvaultPath: ${vaultPath0}\nbridgePath: ${bridgePath0}\nactualPort: (pending)\nbridgeWritten: (pending)\nbridgeWriteError: (pending)\n`,
        "utf8");
    } catch { /* ignore */ }
    await this.loadSettings();

    this.registerView(VIEW_TYPE_LLM_BRIDGE, (leaf) => new LLMBridgeView(leaf, this));
    this.registerView(VIEW_TYPE_AGENT_SKILL_DOCUMENT, (leaf) => new AgentSkillDocumentView(leaf));

    this.addRibbonIcon("bot", "打开 LLM CLI Bridge", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-llm-cli-bridge",
      name: "打开 LLM CLI Bridge 面板",
      callback: () => void this.activateView(),
    });

    this.registerCommands();

    this.addSettingTab(new LLMBridgeSettingTab(this.app, this));

    // 启动 HTTP Action Bridge（主通道）+ outbox watcher（fallback）
    const vaultPath = this.getVaultPath();
    if (vaultPath) {
      // 先启动 outbox（保证 fallback 可用，不依赖 HTTP）
      this.outboxWatcher = new OutboxWatcher(this.app, vaultPath);
      this.outboxWatcher.start();

      // HTTP Bridge 在后台启动，不阻塞 onload
      void this.startHttpBridge(vaultPath).catch((e) => {
        console.error("[llm-cli-bridge] startHttpBridge 未捕获错误:", e);
      });

      // V2.18 r5: 三端统一 onload 自动物化 SKILL.md
      // 确保 source 存在 → compact → 物化到 .claude/skills + .agents/skills + .pi/skills
      void this.materializeVaultSkillsOnload(vaultPath);
    }

    // V17-D 任务 B：异步预加载 Pi SDK（不阻塞 onload）
    // 加载完成后写入 probeCache，后续 PiSdkProvider constructor 同步读取 cache
    void this.preloadPiSdk();
  }

  /** V17-D 任务 B：异步预加载 Pi SDK 到 probeCache */
  private async preloadPiSdk(): Promise<void> {
    try {
      const { PiSdkProvider } = await import("./src/runtime/providers/pi-sdk/piSdkProvider");
      await PiSdkProvider.preload();
      console.log("[llm-cli-bridge] Pi SDK preload 完成");
    } catch (e) {
      console.warn("[llm-cli-bridge] Pi SDK preload 失败（不阻塞）：", e);
    }
  }

  /** V2.18 r5 / u5: onload 自动物化 SKILL.md — 统一入口（source→manifest 同步 + 四端物化） */
  private async materializeVaultSkillsOnload(vaultPath: string): Promise<void> {
    try {
      const { ensureAgentRuntimeWorkspace, compactOrSplitVaultSkill, materializeAllSkillsToAllTargets } = await import("./src/agentRuntimeWorkspace");
      await ensureAgentRuntimeWorkspace(vaultPath, { createVaultSkillIfMissing: true });
      try { await compactOrSplitVaultSkill(vaultPath); } catch { /* compact 失败不阻塞物化 */ }
      // u5: 统一物化 — sync manifest + 物化到 claude/.agents/.pi/codex 四端（均为 Agent Skill 格式）
      const result = materializeAllSkillsToAllTargets(vaultPath);
      const okCount = result.results.filter((r) => r.ok).length;
      const syncOk = result.syncSummary.synced.length;
      const syncSkip = result.syncSummary.skipped.length;
      console.log(`[llm-cli-bridge] onload skill 物化完成: materialize=${okCount}/${result.results.length}, manifest sync=${syncOk}/${syncOk + syncSkip}, manifestSaved=${result.saved}`);
    } catch (e) {
      console.warn("[llm-cli-bridge] onload skill 物化失败（不阻塞）：", e);
    }
  }

  async onunload(): Promise<void> {
    this.outboxWatcher?.stop();
    this.outboxWatcher = null;
    await this.stopHttpBridge();
    // View 的清理由 ItemView.onClose 负责；这里不做额外操作
  }

  getHttpBridge(): HttpBridge | null {
    return this.httpBridge;
  }

  getManagedRuntimeInstallStatus(): ManagedRuntimeInstallStatus {
    return getManagedRuntimeInstallStatus(this.pluginDir);
  }

  async ensureManagedRuntimeInstalled(options: { confirm?: boolean } = {}): Promise<ManagedRuntimeInstallStatus> {
    const result = await ensureManagedRuntimeInstalledFromPlugin(this.pluginDir, options);
    this.refreshBridgeView();
    return result;
  }

  getRuntimeProviderStatusForSmoke(cwd?: string): { providerId: string; label: string } {
    const session = createBridgeSession(
      `smoke-${Date.now()}`,
      this.settings,
      cwd || this.getVaultPath(),
      this.pluginDir,
    );
    return { providerId: session.providerId, label: session.displayLabel };
  }

  private getVaultPath(): string {
    const adapter = this.app.vault.adapter as DataAdapter & { getBasePath?: () => string };
    return adapter.getBasePath ? adapter.getBasePath() : "";
  }

  // V1.0.1: 启动 HTTP server（bridge.json 已在 HttpBridge.start 内部写入）+ 写 helper mjs + 补充诊断
  private async startHttpBridge(vaultPath: string): Promise<void> {
    try {
      // 每次启动生成新 token
      const token = generateToken();
      // V1.0.1: 传入 pluginVersion，写入 bridge.json
      this.httpBridge = new HttpBridge(this.app, vaultPath, token, this.settings.devTestMode, this.manifest.version);
      // 加超时保护，避免 server.listen 回调不触发导致永久挂起
      const info: BridgeInfo = await Promise.race([
        this.httpBridge.start(),
        new Promise<BridgeInfo>((_, reject) =>
          setTimeout(() => reject(new Error("HTTP server 启动超时（5s）")), 5000),
        ),
      ]);

      // V1.0.1: bridge.json 已在 HttpBridge.start() 内部原子写入，这里只取写入结果做诊断
      const writeResult: BridgeWriteResult | null = this.httpBridge.getBridgeWriteResult();
      const bridgePath = path.join(vaultPath, BRIDGE_FILE_REL);

      // 写 helper mjs + obsidian wrapper（agent 可直接调用 `obsidian health`）
      await writeHelperAndWrappers(vaultPath);

      // V1.0.1: 补充 onload 诊断文件（含 actualPort / bridgeWritten / bridgeWriteError）
      try {
        await fs.promises.writeFile(path.join(vaultPath, ".llm-bridge", "diag-onload.txt"),
          `onload ${new Date().toISOString()}\n` +
          `vaultPath: ${vaultPath}\n` +
          `bridgePath: ${bridgePath}\n` +
          `actualPort: ${info.port}\n` +
          `bridgeWritten: ${writeResult?.written ?? false}\n` +
          `bridgeWriteError: ${writeResult?.error ?? "(none)"}\n` +
          `tokenPresent: ${!!token}\n` +
          `tokenLength: ${token.length}\n`,
          "utf8");
      } catch { /* ignore */ }

      console.log("[llm-cli-bridge] HTTP Bridge started:", `http://${info.host}:${info.port}`, "bridgeWritten:", writeResult?.written ?? false);
    } catch (e) {
      console.error("[llm-cli-bridge] HTTP Bridge 启动失败:", e);
      // 写诊断文件（无法访问控制台时用）
      try {
        const diagPath = path.join(vaultPath, ".llm-bridge", "http-bridge-error.txt");
        await fs.promises.writeFile(diagPath, `${new Date().toISOString()}\n${(e as Error)?.stack || e}\n`, "utf8");
      } catch { /* ignore */ }
      new Notice("LLM CLI Bridge: HTTP server 启动失败，outbox 仍可用");
    }
  }

  private async stopHttpBridge(): Promise<void> {
    if (!this.httpBridge) return;
    await this.httpBridge.stop();
    this.httpBridge = null;
    // 清理 bridge.json（token 失效）
    const vaultPath = this.getVaultPath();
    if (vaultPath) {
      try {
        await fs.promises.rm(path.join(vaultPath, BRIDGE_FILE_REL), { force: true });
      } catch {
        /* 忽略 */
      }
    }
  }

  private registerCommands(): void {
    // 1. Ask Claude about selection —— 预填选区作为上下文，不自动发送（用户接着输入问题）
    this.addCommand({
      id: "ask-claude-about-selection",
      name: "Ask Claude about selection",
      editorCallback: async (editor: Editor) => {
        const sel = editor.getSelection();
        if (!sel) {
          new Notice("请先选中文本");
          return;
        }
        await this.activateView();
        const v = this.getBridgeView();
        if (!v) return;
        v.setInput(`关于以下选区：\n\n\`\`\`\n${sel}\n\`\`\`\n\n`);
      },
    });

    // 2. Rewrite selection with Claude —— 预填指令并自动发送，要求用 replace_selection action 回写
    this.addCommand({
      id: "rewrite-selection-with-claude",
      name: "Rewrite selection with Claude",
      editorCallback: async (editor: Editor) => {
        const sel = editor.getSelection();
        if (!sel) {
          new Notice("请先选中文本");
          return;
        }
        await this.activateView();
        const v = this.getBridgeView();
        if (!v) return;
        v.setInput(`重写以下选区，并通过 replace_selection action 把重写结果写回原选区位置：\n\n\`\`\`\n${sel}\n\`\`\`\n`);
        await v.runNow();
      },
    });

    // 3. Summarize active note to pending note —— 自动发送
    this.addCommand({
      id: "summarize-active-note-to-pending",
      name: "Summarize active note to pending note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("没有活动笔记");
          return;
        }
        await this.activateView();
        const v = this.getBridgeView();
        if (!v) return;
        v.setInput(`请总结当前笔记 \`${file.path}\` 的核心内容，生成一份摘要笔记到 \`${this.settings.outputDir}/\` 目录下，文件名用原笔记名加 \`-summary\` 后缀，包含适当的 frontmatter。`);
        await v.runNow();
      },
    });

    // 4. Create pending note from selection —— 自动发送
    this.addCommand({
      id: "create-pending-note-from-selection",
      name: "Create pending note from selection",
      editorCallback: async (editor: Editor) => {
        const sel = editor.getSelection();
        if (!sel) {
          new Notice("请先选中文本");
          return;
        }
        await this.activateView();
        const v = this.getBridgeView();
        if (!v) return;
        v.setInput(`基于以下选区创建一份待确认笔记到 \`${this.settings.outputDir}/\` 目录下，自行拟定文件名和 frontmatter：\n\n\`\`\`\n${sel}\n\`\`\`\n`);
        await v.runNow();
      },
    });

    // 5. Open last generated note —— 不调用 LLM，直接打开输出目录下最近修改的 .md
    this.addCommand({
      id: "open-last-generated-note",
      name: "Open last generated note",
      callback: async () => {
        await this.openLastGeneratedNote();
      },
    });

    // V16.5-E: Agent Runtime Workspace 命令（最小入口）
    this.addCommand({
      id: "init-agent-runtime-workspace",
      name: "Initialize Agent Runtime Workspace",
      callback: async () => {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        const { ensureAgentRuntimeWorkspace } = await import("./src/agentRuntimeWorkspace");
        const result = await ensureAgentRuntimeWorkspace(vaultPath, { createVaultSkillIfMissing: true });
        const msg = result.vaultSkillInitialized
          ? `Agent Runtime initialized; VAULT_SKILL 初版已生成。`
          : `Agent Runtime ready (已存在文件跳过)。`;
        new Notice(msg);
      },
    });

    this.addCommand({
      id: "view-vault-skill",
      name: "View Vault Skill source",
      callback: async () => {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        const { VAULT_SKILL_SOURCE_REL, ensureAgentRuntimeWorkspace } = await import("./src/agentRuntimeWorkspace");
        await ensureAgentRuntimeWorkspace(vaultPath, { createVaultSkillIfMissing: true });
        const file = this.app.vault.getAbstractFileByPath(VAULT_SKILL_SOURCE_REL);
        if (file instanceof TFile) {
          await this.app.workspace.openLinkText(file.path, "", false);
        } else {
          new Notice("VAULT_SKILL source not found");
        }
      },
    });

    this.addCommand({
      id: "rebuild-vault-skill",
      name: "Rebuild Vault Skill (overwrite with caution)",
      callback: async () => {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        const { VAULT_SKILL_SOURCE_REL, generateInitialVaultSkill, readVaultSkillSource } = await import("./src/agentRuntimeWorkspace");
        const existing = await readVaultSkillSource(vaultPath);
        if (existing) {
          // 尊重人工修改：提示用户确认
          new Notice("VAULT_SKILL 已存在；为避免覆盖人工修改，请手动删除源文件后再 rebuild。");
          return;
        }
        const initial = await generateInitialVaultSkill(vaultPath);
        const fsMod = await import("fs");
        const fsPromises = fsMod.promises;
        const pathMod = await import("path");
        const skillDir = pathMod.join(vaultPath, "LLM-AgentRuntime/skills/vault-context");
        await fsPromises.mkdir(skillDir, { recursive: true });
        await fsPromises.writeFile(pathMod.join(vaultPath, VAULT_SKILL_SOURCE_REL), initial.skillMd, "utf8");
        for (const [name, content] of Object.entries(initial.subFiles)) {
          await fsPromises.writeFile(pathMod.join(skillDir, name), content, "utf8");
        }
        await fsPromises.writeFile(pathMod.join(skillDir, "INDEX.md"), initial.indexMd, "utf8");
        new Notice("VAULT_SKILL 初版已重建。");
      },
    });

    this.addCommand({
      id: "materialize-vault-skill",
      name: "Materialize All Vault Skills to .claude/skills",
      callback: async () => {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        const { ensureAgentRuntimeWorkspace, compactOrSplitVaultSkill, materializeAllSkillsToAllTargets } = await import("./src/agentRuntimeWorkspace");
        await ensureAgentRuntimeWorkspace(vaultPath, { createVaultSkillIfMissing: true });
        try { await compactOrSplitVaultSkill(vaultPath); } catch { /* compact 失败不阻塞物化 */ }
        // u5: 统一物化 — sync manifest + 物化到 claude/.agents/.pi/codex 四端
        const result = materializeAllSkillsToAllTargets(vaultPath);
        const okCount = result.results.filter((r) => r.ok).length;
        const conflictCount = result.results.filter((r) => r.status === "conflict").length;
        if (conflictCount > 0) {
          new Notice(`Materialized ${okCount}/${result.results.length} (4 targets); ${conflictCount} conflict`);
        } else {
          new Notice(`Materialized ${okCount}/${result.results.length} (4 targets: claude/.agents/.pi/codex)`);
        }
      },
    });

    this.addCommand({
      id: "clean-agent-runtime-work",
      name: "Clean Agent Runtime work/ directory",
      callback: async () => {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        const { AGENT_RUNTIME_WORK_DIR_REL } = await import("./src/agentRuntimeWorkspace");
        const fsMod = await import("fs");
        const pathMod = await import("path");
        const workDir = pathMod.join(vaultPath, AGENT_RUNTIME_WORK_DIR_REL);
        try {
          const entries = await fsMod.promises.readdir(workDir);
          for (const entry of entries) {
            await fsMod.promises.rm(pathMod.join(workDir, entry), { recursive: true, force: true });
          }
          new Notice(`Cleaned ${entries.length} entries from work/`);
        } catch {
          new Notice("work/ directory not found or empty");
        }
      },
    });

    // Phase 2: 同步 Skills — 确保源存在 → compact → 物化到 claude/.agents/.pi/codex 四端
    this.addCommand({
      id: "sync-skills",
      name: "Sync Skills (materialize to all targets)",
      callback: async () => {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        const { ensureAgentRuntimeWorkspace, compactOrSplitVaultSkill, materializeAllSkillsToAllTargets } = await import("./src/agentRuntimeWorkspace");
        await ensureAgentRuntimeWorkspace(vaultPath, { createVaultSkillIfMissing: true });
        try { await compactOrSplitVaultSkill(vaultPath); } catch { /* compact 失败不阻塞物化 */ }
        const result = materializeAllSkillsToAllTargets(vaultPath);
        const okCount = result.results.filter((r) => r.ok).length;
        const conflictCount = result.results.filter((r) => r.status === "conflict").length;
        const msg = conflictCount > 0
          ? `同步完成: ${okCount}/${result.results.length} (4 targets); ${conflictCount} conflict`
          : `同步完成: ${okCount}/${result.results.length} (4 targets: claude/.agents/.pi/codex)`;
        new Notice(msg);
      },
    });

    // Phase 2: 清理插件生成 Skills — 删除 ~/.codex/skills/ 下本 vault 的 bridge-owned 目录
    this.addCommand({
      id: "clean-plugin-generated-skills",
      name: "Clean Plugin-Generated Skills (Codex)",
      callback: async () => {
        const vaultPath = (this.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath();
        const { cleanupCodexBridgeSkillsForVaultSync } = await import("./src/agentSkills");
        // keepSlugs=[] 删除当前 vault 的所有 bridge-owned skill 目录（旧格式 + 当前 vault 失效目录）
        const result = cleanupCodexBridgeSkillsForVaultSync(vaultPath, undefined, []);
        const removedCount = result.removed.length;
        const errorCount = result.errors.length;
        const msg = errorCount > 0
          ? `清理完成: 删除 ${removedCount} 个目录, ${errorCount} 个错误`
          : `清理完成: 删除 ${removedCount} 个 bridge-owned skill 目录`;
        new Notice(msg);
      },
    });

    // V17-C1 任务 B / V17-C2 任务 A：朋友版 preset 初始化命令
    this.addCommand({
      id: "enable-friend-preview",
      name: "Enable Friend Preview / Portable Mode",
      callback: async () => {
        // V17-C2 任务 A：friend preset 必须显式设置 backendMode=auto（不保留旧 cli/sdk/mock）
        // auto 让 provider 选择器按 backendProfile 优先选 pi-sdk
        this.settings.backendProfile = "portable";
        this.settings.backendMode = "auto";
        this.settings.piToolMode = "pi-native";
        this.settings.piNativeTrustConfirmed = false;
        await this.saveSettings();
        // 触发 view 刷新以展示 trust onboarding 卡片
        this.refreshBridgeView?.();
        new Notice("Friend Preview 已启用：portable + auto + pi-native。首次运行前需确认 Pi Native Trust。");
      },
    });

    // V17-C1 任务 B / V17-C2 任务 A：切回 developer profile
    this.addCommand({
      id: "disable-friend-preview",
      name: "Disable Friend Preview (back to Developer profile)",
      callback: async () => {
        this.settings.backendProfile = "developer";
        this.settings.backendMode = "auto";
        this.settings.piToolMode = "bridge-controlled";
        await this.saveSettings();
        this.refreshBridgeView?.();
        new Notice("已切回 Developer profile（bridge-controlled）。");
      },
    });

    // V17-C2 任务 C：Pi SDK 依赖检查命令（朋友版手动检测 + 安装引导）
    // V17-D 任务 B：改用 tryLoadPiSdkAsync（多路径 + ESM 支持）
    this.addCommand({
      id: "check-pi-sdk-dependency",
      name: "Check Pi SDK Dependency (Friend Preview)",
      callback: async () => {
        let statusMsg = "";
        let noticeClass = "";
        try {
          const { tryLoadPiSdkAsync, probePiSdkAuth } = await import("./src/runtime/providers/pi-sdk/piSdkProvider");
          const probe = await tryLoadPiSdkAsync(true);
          if (!probe.available) {
            const fromHint = probe.loadedFrom ? `（最后尝试：${probe.loadedFrom}）` : "";
            statusMsg = `Pi SDK 未安装${fromHint}。\n\n可能原因：\n1) 当前发行包缺 Pi SDK，请重新下载完整 user-package\n2) 或在 Vault 根目录运行：\nnpm install --ignore-scripts @earendil-works/pi-coding-agent\n\n安装后重启 Obsidian。`;
            noticeClass = "llm-bridge-notice-warn";
          } else {
            const authProbe = probePiSdkAuth(probe);
            const fromInfo = probe.loadedFrom ? `（加载源：${probe.loadedFrom}）` : "";
            if (!authProbe.hasAuth || !authProbe.hasModel) {
              statusMsg = `Pi SDK 已安装${fromInfo}，但认证/模型未配置：\n${authProbe.hint}`;
              noticeClass = "llm-bridge-notice-warn";
            } else {
              statusMsg = `Pi SDK 已安装${fromInfo}且配置完成，Friend Preview 可用。`;
              noticeClass = "llm-bridge-notice-ok";
            }
          }
        } catch (e) {
          statusMsg = `Pi SDK 依赖检查失败：${e instanceof Error ? e.message : String(e)}`;
          noticeClass = "llm-bridge-notice-error";
        }
        const notice = new Notice(statusMsg, 10000);
        if (noticeClass && notice.noticeEl) {
          notice.noticeEl.addClass(noticeClass);
        }
      },
    });
  }

  private async openLastGeneratedNote(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(this.settings.outputDir);
    if (!(folder instanceof TFolder)) {
      new Notice(`输出目录不存在: ${this.settings.outputDir}`);
      return;
    }
    const mdFiles: TFile[] = [];
    this.collectMarkdownFiles(folder, mdFiles);
    if (mdFiles.length === 0) {
      new Notice("暂无生成笔记");
      return;
    }
    mdFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
    await this.app.workspace.getLeaf().openFile(mdFiles[0]);
  }

  private collectMarkdownFiles(folder: TFolder, out: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        out.push(child);
      } else if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, out);
      }
    }
  }

  private getBridgeView(): LLMBridgeView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LLM_BRIDGE);
    if (leaves.length === 0) return null;
    const view = leaves[0].view;
    return view instanceof LLMBridgeView ? view : null;
  }

  // V2.10 (B-019): 设置页切换 backendMode 等关键设置后通知 view 刷新（状态栏 Backend 值立即更新）
  public refreshBridgeView(): void {
    const v = this.getBridgeView();
    if (v) v.refreshOnSettingsChange();
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_LLM_BRIDGE);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_LLM_BRIDGE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /**
   * 集中 settings 迁移：版本号驱动，将旧版本设置升级到当前 schema。
   * 返回 { settings, changed } — changed=true 表示发生了迁移需要落盘。
   */
  private migrateSettings(
    current: LLMBridgeSettings,
    raw: unknown,
  ): { settings: LLMBridgeSettings; changed: boolean } {
    let settings = { ...current };
    let changed = false;
    const rawRecord = raw as Record<string, unknown>;
    const loadedVersion = typeof rawRecord?.settingsVersion === "number" ? rawRecord.settingsVersion : 0;

    // v0 → v1: 旧版本数据（无 settingsVersion 字段）
    if (loadedVersion < 1) {
      // V2.16-B: 迁移旧的 "sdk-experimental" → "sdk"
      if ((settings as { backendMode?: string }).backendMode === "sdk-experimental") {
        settings.backendMode = "sdk";
        changed = true;
      }
      // V17-F0 任务 C：迁移旧的 "codex" → "codex-app-server-external"
      if ((settings as { backendMode?: string }).backendMode === "codex") {
        settings.backendMode = "codex-app-server-external";
        changed = true;
      }
      // agentApprovalProfile：旧数据统一回到「请求批准」
      const rawProf = rawRecord as { agentApprovalProfile?: unknown };
      if (!isAgentApprovalProfile(rawProf.agentApprovalProfile) || rawProf.agentApprovalProfile === "full-access") {
        settings.agentApprovalProfile = migrateLegacyPermissionToApprovalProfile(settings.claudePermissionMode);
        settings.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode(settings.agentApprovalProfile);
        changed = true;
      }
      // v1 新增：includeActiveNote 默认改为 false（隐私保护）
      // 旧版本 includeActiveNote=true 的用户保持原值（不强制改变已有行为）
    }

    if (changed || loadedVersion < 1) {
      settings.settingsVersion = 1;
    }
    return { settings, changed };
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // 集中 settings 迁移：版本号驱动，避免 ad-hoc 逻辑分散
    const migrated = this.migrateSettings(this.settings, loaded);
    if (migrated.changed) {
      this.settings = migrated.settings;
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    // full-access 仅当前 Bridge session 内存有效：落盘始终降级为 ask
    const liveProfile = this.settings.agentApprovalProfile;
    const liveClaude = this.settings.claudePermissionMode;
    if (liveProfile === "full-access") {
      this.settings.agentApprovalProfile = "ask";
      this.settings.claudePermissionMode = mapAgentApprovalProfileToClaudePermissionMode("ask");
    }
    // Pi API Key 不写入 data.json（仅在内存中保留，避免明文落盘）
    const liveApiKey = this.settings.piApiKey;
    this.settings.piApiKey = "";
    await this.saveData(this.settings);
    this.settings.piApiKey = liveApiKey;
    if (liveProfile === "full-access") {
      this.settings.agentApprovalProfile = liveProfile;
      this.settings.claudePermissionMode = liveClaude;
    }
  }
}
