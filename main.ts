// LLM CLI Bridge — 插件入口

import * as fs from "fs";
import * as path from "path";
import { DataAdapter, Editor, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { LLMBridgeSettingTab } from "./src/settings";
import { LLMBridgeView, VIEW_TYPE_LLM_BRIDGE } from "./src/view";
import { DEFAULT_SETTINGS, LLMBridgeSettings } from "./src/types";
import { OutboxWatcher } from "./src/outbox";
import { BridgeInfo, BridgeWriteResult, HttpBridge } from "./src/httpServer";
import { writeHelper } from "./src/toolsWriter";

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

  async onload(): Promise<void> {
    // V1.0.1: 诊断文件含 vaultPath / bridgePath / timestamp（actual port / bridgeWritten 在 HTTP 启动后补充）
    const vaultPath0 = this.getVaultPath();
    const bridgePath0 = path.join(vaultPath0, BRIDGE_FILE_REL);
    try {
      await fs.promises.mkdir(path.dirname(bridgePath0), { recursive: true });
      await fs.promises.writeFile(path.join(vaultPath0, ".llm-bridge", "diag-onload.txt"),
        `onload ${new Date().toISOString()}\nvaultPath: ${vaultPath0}\nbridgePath: ${bridgePath0}\nactualPort: (pending)\nbridgeWritten: (pending)\nbridgeWriteError: (pending)\n`,
        "utf8");
    } catch { /* ignore */ }
    await this.loadSettings();

    this.registerView(VIEW_TYPE_LLM_BRIDGE, (leaf) => new LLMBridgeView(leaf, this));

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

      // 写 helper mjs
      await writeHelper(vaultPath);

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

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // V2.3: 同步权限策略到 httpBridge（运行时生效）
    if (this.httpBridge) {
      this.httpBridge.setPermissionPolicy(this.settings.permissionPolicy);
    }
  }
}
