// LLM CLI Bridge — Outbox action 执行器
// Claude Code 通过 .llm-bridge/outbox/actions.jsonl 触发 Obsidian 动作
// 支持：show_notice / open_note / get_state / get_active_note / get_selection /
//       create_note / append_to_note / insert_at_cursor / replace_selection
//
// V2.18 vault-api Skill（latest native session only 配套）：
// 聚焦"文件系统操作不能覆盖的能力"——用 Obsidian metadataCache / fileManager /
// resolvedLinks / trash 等 Plugin API 实现，比裸文件系统读更准、更安全。
// agent 已有 native Read/Write/Edit/Grep 覆盖普通文件操作，这些 action 只保留前者做不到的。

import { App, DataAdapter, Modal, Notice, TFile, TFolder, Vault, MarkdownView } from "obsidian";

export type ActionType =
  | "show_notice"
  | "open_note"
  | "get_state"
  | "get_active_note"
  | "get_selection"
  | "create_note"
  | "append_to_note"
  | "insert_at_cursor"
  | "replace_selection"
  // V2.18 vault-api：结构化类（文件系统做不准/做不到）
  | "property_get"    // 读 frontmatter（用 metadataCache，处理 YAML 边界）
  | "property_set"    // 写 frontmatter（用 fileManager.processFrontMatter）
  | "tags_list"      // 全 vault 标签清单（用 metadataCache，区分代码块假 tag）
  | "backlinks_get"  // 反向链接（用 resolvedLinks，文件系统无法反向查）
  | "tasks_list"     // 待办清单（扫所有 markdown 文件）
  | "daily_read"     // 读今天 daily note（按 daily-notes 约定路径）
  | "daily_append"   // 追加到今天 daily note
  // V2.18 vault-api：危险操作类（走 Obsidian trash + 审批）
  | "vault_delete"    // 删除文件（走回收站，比 fs.delete 安全）
  | "vault_rename";   // 重命名/移动（更新 metadataCache）

export interface OutboxAction {
  id: string;
  type: ActionType;
  params: Record<string, unknown>;
  ts?: string;
}

// ─── Action Schema 校验 ───────────────────────────────────────────────────

interface ParamSchema {
  required?: string[];
  optional?: string[];
  extraForbidden?: boolean; // true = 不允许额外字段
}

const ACTION_SCHEMAS: Record<ActionType, ParamSchema> = {
  show_notice: { required: ["message"], optional: [], extraForbidden: false },
  open_note: { required: ["path"], optional: [], extraForbidden: false },
  get_state: { required: [], optional: [], extraForbidden: true },
  get_active_note: { required: [], optional: [], extraForbidden: true },
  get_selection: { required: [], optional: [], extraForbidden: true },
  create_note: { required: ["path", "content"], optional: [], extraForbidden: false },
  append_to_note: { required: ["path", "content"], optional: [], extraForbidden: false },
  insert_at_cursor: { required: ["content"], optional: [], extraForbidden: false },
  replace_selection: { required: ["content"], optional: [], extraForbidden: false },
  // V2.18 vault-api schemas
  property_get: { required: ["path"], optional: ["key"], extraForbidden: false },
  property_set: { required: ["path", "key", "value"], optional: [], extraForbidden: false },
  tags_list: { required: [], optional: ["path"], extraForbidden: false },
  backlinks_get: { required: ["path"], optional: [], extraForbidden: false },
  tasks_list: { required: [], optional: ["path"], extraForbidden: false },
  daily_read: { required: [], optional: [], extraForbidden: true },
  daily_append: { required: ["content"], optional: [], extraForbidden: false },
  vault_delete: { required: ["path"], optional: [], extraForbidden: false },
  vault_rename: { required: ["path", "newPath"], optional: [], extraForbidden: false },
};

// ─── 路径安全校验 ─────────────────────────────────────────────────────────

const FORBIDDEN_PATHS = [
  ".obsidian",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
];

const FORBIDDEN_DIRS = [
  ".llm-bridge/bridge.json",
  "bridge.json",
];

function isPathUnsafe(vaultPath: string, filePath: string): string | null {
  const p = filePath.replace(/\\/g, "/");
  const parts = p.split("/");
  const lower = p.toLowerCase();

  // 1. 绝对路径 / 路径遍历 / .obsidian 目录
  if (/^[A-Za-z]:/i.test(p) || p.startsWith("/")) return `拒绝绝对路径: ${filePath}`;
  let depth = 0;
  for (const part of parts) {
    if (part === "..") { depth--; if (depth < 0) return `拒绝路径遍历: ${filePath}`; }
    else if (part && part !== ".") depth++;
  }
  if (parts.includes(".obsidian")) return `拒绝 .obsidian 目录写入: ${filePath}`;

  // 2. .llm-bridge 目录敏感文件
  if (parts.includes(".llm-bridge")) {
    if (lower.endsWith("bridge.json") || lower.includes("token") || lower.includes("config")) {
      return `拒绝写入敏感文件: ${filePath}`;
    }
  }

  // 3. 强拒绝敏感关键词（.env/.git/token/secrets/credentials）
  const strongReject = [".env", ".git", "token", "secrets", "credentials"];
  for (const name of strongReject) {
    if (parts.includes(name) || lower.endsWith(name) || lower.endsWith(`${name}.json`) || lower.endsWith(`${name}.txt`)) {
      return `拒绝写入敏感路径: ${filePath}`;
    }
  }

  // 4. 条件拒绝 config（仅在敏感上下文中拒绝）
  if (lower.includes("config")) {
    const sensitiveContexts = ["private", "runtime", "env", "secret"];
    if (parts.some(part => sensitiveContexts.includes(part.toLowerCase()))) {
      return `拒绝写入敏感上下文 config 文件: ${filePath}`;
    }
  }

  return null;
}

// 校验 action params 是否符合 schema；返回 null 表示通过，否则返回错误信息
export function validateAction(
  vaultPath: string,
  action: OutboxAction,
): string | null {
  const schema = ACTION_SCHEMAS[action.type as ActionType];
  if (!schema) {
    return `未知 action 类型: ${action.type}`;
  }

  const params = action.params || {};
  const keys = Object.keys(params);

  // 检查必填字段
  if (schema.required) {
    for (const k of schema.required) {
      if (params[k] === undefined || params[k] === null) {
        return `action ${action.type} 缺少必填字段: ${k}`;
      }
      // string 类型字段值必须是字符串
      if (typeof params[k] !== "string") {
        return `action ${action.type} 字段 ${k} 类型错误，需要 string，实际 ${typeof params[k]}`;
      }
    }
  }

  // 检查多余字段
  if (schema.extraForbidden && keys.length > 0) {
    const allowed = [...(schema.required || []), ...(schema.optional || [])];
    const extra = keys.filter((k) => !allowed.includes(k));
    if (extra.length > 0) {
      return `action ${action.type} 不允许额外字段: ${extra.join(", ")}`;
    }
  }

  // 路径安全校验（针对有 path 参数的 action）
  const pathFields = ["path"];
  for (const field of pathFields) {
    const val = params[field];
    if (typeof val === "string" && val.trim()) {
      const unsafe = isPathUnsafe(vaultPath, val);
      if (unsafe) return unsafe;
    }
  }

  return null;
}

// 会修改笔记或覆盖文件的 action：必须弹确认
const MODIFYING_ACTIONS: ActionType[] = [
  "create_note",
  "append_to_note",
  "insert_at_cursor",
  "replace_selection",
  // V2.18 vault-api 写入/危险操作类
  "property_set",
  "daily_append",
  "vault_delete",
  "vault_rename",
];

export function isModifying(type: string): boolean {
  return MODIFYING_ACTIONS.includes(type as ActionType);
}

// 从 app 获取 Vault 根路径
function getVaultPathFromApp(app: App): string {
  const adapter = app.vault.adapter as DataAdapter & { getBasePath?: () => string };
  return adapter.getBasePath ? adapter.getBasePath() : "";
}

// 执行单个 action；失败抛错。读取类 action 返回数据，写入类返回 undefined。
export async function executeAction(
  app: App,
  vaultPath: string,
  action: OutboxAction,
): Promise<unknown> {
  // 先校验 schema 和路径安全
  const validationError = validateAction(vaultPath, action);
  if (validationError) {
    throw new Error(validationError);
  }

  const { type, params } = action;
  const p = params || {};
  switch (type) {
    case "show_notice": {
      new Notice(String(p.message ?? ""));
      return undefined;
    }
    case "open_note": {
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("open_note: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`open_note: 文件不存在 ${targetPath}`);
      await app.workspace.getLeaf().openFile(f);
      return undefined;
    }
    case "get_state": {
      const file = app.workspace.getActiveFile();
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      const sel = view?.editor.getSelection() ?? "";
      return {
        vaultPath: getVaultPathFromApp(app),
        activeFilePath: file ? file.path : null,
        hasActiveFile: !!file,
        hasSelection: sel.length > 0,
        selectionLength: sel.length,
        timestamp: new Date().toISOString(),
      };
    }
    case "get_active_note": {
      const file = app.workspace.getActiveFile();
      if (!(file instanceof TFile)) return null;
      const content = await app.vault.read(file);
      return { path: file.path, content, size: content.length };
    }
    case "get_selection": {
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      const sel = view?.editor.getSelection() ?? "";
      return { text: sel, length: sel.length, hasSelection: sel.length > 0 };
    }
    case "create_note": {
      const targetPath = String(p.path ?? "").trim();
      const content = String(p.content ?? "");
      if (!targetPath) throw new Error("create_note: 缺少 path");
      if (app.vault.getAbstractFileByPath(targetPath)) {
        throw new Error(`create_note: 文件已存在 ${targetPath}`);
      }
      await ensureParentDir(app.vault, targetPath);
      const created = await app.vault.create(targetPath, content);
      // vault.create may return null for files in unindexed directories (e.g. .llm-bridge/)
      if (created && typeof created.path === 'string') {
        return { path: created.path };
      }
      // Fallback: re-read from vault
      const file = app.vault.getAbstractFileByPath(targetPath);
      if (file instanceof TFile) {
        return { path: file.path };
      }
      // If vault doesn't have it, verify with filesystem and return path as-is
      return { path: targetPath };
    }
    case "append_to_note": {
      const targetPath = String(p.path ?? "").trim();
      const content = String(p.content ?? "");
      if (!targetPath) throw new Error("append_to_note: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`append_to_note: 文件不存在 ${targetPath}`);
      const existing = await app.vault.read(f);
      const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      await app.vault.modify(f, existing + sep + content);
      return { path: f.path };
    }
    case "insert_at_cursor": {
      const content = String(p.content ?? "");
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) throw new Error("insert_at_cursor: 没有活动的 Markdown 视图");
      const editor = view.editor;
      const cursor = editor.getCursor();
      editor.replaceRange(content, cursor);
      return { inserted: content.length };
    }
    case "replace_selection": {
      const content = String(p.content ?? "");
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) throw new Error("replace_selection: 没有活动的 Markdown 视图");
      const editor = view.editor;
      const selected = editor.getSelection();
      if (!selected) throw new Error("replace_selection: 当前没有选区");
      editor.replaceSelection(content);
      return { replaced: selected.length, with: content.length };
    }
    // ─── V2.18 vault-api：结构化类 ──────────────────────────────────────────
    case "property_get": {
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("property_get: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`property_get: 文件不存在 ${targetPath}`);
      // metadataCache 提供 frontmatter（已解析 YAML，比裸文本解析可靠）
      const cache = app.metadataCache.getFileCache(f);
      const frontmatter = cache?.frontmatter ?? {};
      const key = typeof p.key === "string" ? String(p.key) : undefined;
      if (key) {
        return { path: f.path, key, value: key in frontmatter ? frontmatter[key] : null };
      }
      return { path: f.path, properties: frontmatter };
    }
    case "property_set": {
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("property_set: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`property_set: 文件不存在 ${targetPath}`);
      const key = String(p.key ?? "");
      if (!key) throw new Error("property_set: 缺少 key");
      const value = p.value;
      // processFrontMatter 安全修改 YAML frontmatter（处理边界/序列化）
      await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
        fm[key] = value;
      });
      return { path: f.path, key, value };
    }
    case "tags_list": {
      // 聚合全 vault 标签（用 metadataCache，区分代码块假 tag）
      const pathFilter = typeof p.path === "string" ? String(p.path).trim() : undefined;
      const tagCounts = new Map<string, { count: number; files: string[] }>();
      const mdFiles = app.vault.getMarkdownFiles();
      for (const f of mdFiles) {
        if (pathFilter && !f.path.startsWith(pathFilter)) continue;
        const cache = app.metadataCache.getFileCache(f);
        const tags = cache?.tags;
        if (!tags) continue;
        for (const t of tags) {
          const name = t.tag.startsWith("#") ? t.tag : `#${t.tag}`;
          const existing = tagCounts.get(name);
          if (existing) {
            existing.count += 1;
            if (!existing.files.includes(f.path)) existing.files.push(f.path);
          } else {
            tagCounts.set(name, { count: 1, files: [f.path] });
          }
        }
      }
      const tags = Array.from(tagCounts.entries())
        .map(([name, info]) => ({ name, count: info.count, files: info.files }))
        .sort((a, b) => b.count - a.count);
      return { tags, total: tags.length };
    }
    case "backlinks_get": {
      // 反向链接（用 resolvedLinks，文件系统无法反向查）
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("backlinks_get: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`backlinks_get: 文件不存在 ${targetPath}`);
      const resolvedLinks = (app.metadataCache as unknown as { resolvedLinks: Record<string, Record<string, number>> }).resolvedLinks;
      const backlinks: { source: string; count: number }[] = [];
      for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
        const count = links[targetPath];
        if (count && count > 0) {
          backlinks.push({ source: sourcePath, count });
        }
      }
      return { path: targetPath, backlinks, total: backlinks.length };
    }
    case "tasks_list": {
      // 扫描所有 markdown 文件的待办项（- [ ] / - [x]）
      const pathFilter = typeof p.path === "string" ? String(p.path).trim() : undefined;
      const tasks: { path: string; line: number; text: string; completed: boolean }[] = [];
      const mdFiles = app.vault.getMarkdownFiles();
      for (const f of mdFiles) {
        if (pathFilter && !f.path.startsWith(pathFilter)) continue;
        const content = await app.vault.read(f);
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^\s*[-*]\s+\[(x|X| )\]\s+(.+)$/);
          if (m) {
            tasks.push({
              path: f.path,
              line: i + 1,
              text: m[2].trim(),
              completed: m[1].toLowerCase() === "x",
            });
          }
        }
      }
      return { tasks, total: tasks.length };
    }
    case "daily_read": {
      // 读今天的 daily note（按 daily-notes 约定路径）
      const dailyPath = resolveDailyNotePath(app);
      const f = dailyPath ? app.vault.getAbstractFileByPath(dailyPath) : null;
      if (!(f instanceof TFile)) return { path: dailyPath, content: null, exists: false };
      const content = await app.vault.read(f);
      return { path: f.path, content, exists: true };
    }
    case "daily_append": {
      // 追加到今天的 daily note（不存在则创建）
      const content = String(p.content ?? "");
      const dailyPath = resolveDailyNotePath(app);
      if (!dailyPath) throw new Error("daily_append: 无法解析 daily note 路径（检查 daily-notes 插件配置）");
      const existingFile = app.vault.getAbstractFileByPath(dailyPath);
      let f: TFile;
      if (existingFile instanceof TFile) {
        f = existingFile;
      } else {
        await ensureParentDir(app.vault, dailyPath);
        f = await app.vault.create(dailyPath, "");
      }
      const existing = await app.vault.read(f);
      const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      await app.vault.modify(f, existing + sep + content);
      return { path: f.path };
    }
    // ─── V2.18 vault-api：危险操作类 ────────────────────────────────────────
    case "vault_delete": {
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("vault_delete: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile) && !(f instanceof TFolder)) {
        throw new Error(`vault_delete: 文件不存在 ${targetPath}`);
      }
      // 走 Obsidian trash（进回收站，比 fs.delete 安全）
      await app.vault.trash(f, true);
      return { path: targetPath, trashed: true };
    }
    case "vault_rename": {
      const oldPath = String(p.path ?? "").trim();
      const newPath = String(p.newPath ?? "").trim();
      if (!oldPath) throw new Error("vault_rename: 缺少 path");
      if (!newPath) throw new Error("vault_rename: 缺少 newPath");
      // newPath 路径安全校验
      const newPathUnsafe = isPathUnsafe(vaultPath, newPath);
      if (newPathUnsafe) throw new Error(newPathUnsafe);
      const f = app.vault.getAbstractFileByPath(oldPath);
      if (!(f instanceof TFile) && !(f instanceof TFolder)) {
        throw new Error(`vault_rename: 文件不存在 ${oldPath}`);
      }
      // 确保新路径父目录存在
      await ensureParentDir(app.vault, newPath);
      await app.vault.rename(f, newPath);
      return { oldPath, newPath };
    }
    default:
      throw new Error(`未知 action 类型: ${type}`);
  }
}

// 生成 action 的人类可读描述（用于确认弹窗）
export function describeAction(action: OutboxAction): string {
  const p = action.params || {};
  const contentLen = String(p.content ?? "").length;
  switch (action.type) {
    case "create_note":
      return `将创建文件: ${p.path}\n内容长度: ${contentLen} 字符`;
    case "append_to_note":
      return `将追加到文件: ${p.path}\n追加内容长度: ${contentLen} 字符`;
    case "insert_at_cursor":
      return `将在当前笔记光标处插入内容\n插入内容长度: ${contentLen} 字符`;
    case "replace_selection":
      return `将替换当前选区\n新内容长度: ${contentLen} 字符`;
    // V2.18 vault-api 描述
    case "property_set":
      return `将修改 frontmatter: ${p.path}\n字段: ${p.key} = ${JSON.stringify(p.value)}`;
    case "daily_append":
      return `将追加到今天的 daily note\n追加内容长度: ${contentLen} 字符`;
    case "vault_delete":
      return `将删除文件（进回收站）: ${p.path}`;
    case "vault_rename":
      return `将重命名: ${p.path} → ${p.newPath}`;
    default:
      return JSON.stringify(p, null, 2);
  }
}

// V2.18 vault-api：解析今天的 daily note 路径
// 优先读取 daily-notes 内置插件的配置，fallback 到 "YYYY-MM-DD.md"
function resolveDailyNotePath(app: App): string | null {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const defaultName = `${yyyy}-${mm}-${dd}.md`;
  try {
    // 尝试读取 daily-notes 内置插件配置
    const internalPlugins = (app as unknown as {
      internalPlugins?: {
        getPluginById?: (id: string) => {
          instance?: {
            options?: { format?: string; folder?: string };
          };
        };
      };
    }).internalPlugins;
    const dailyPlugin = internalPlugins?.getPluginById?.("daily-notes");
    const opts = dailyPlugin?.instance?.options;
    const folder = (opts?.folder && String(opts.folder).trim()) || "";
    // 简单格式替换（支持 YYYY-MM-DD / YYYY/MM/DD 等）
    let name = defaultName;
    if (opts?.format && typeof opts.format === "string") {
      name = opts.format
        .replace("YYYY", String(yyyy))
        .replace("MM", mm)
        .replace("DD", dd)
        .replace(/\//g, "-");
      if (!name.endsWith(".md")) name += ".md";
    }
    return folder ? `${folder}/${name}` : name;
  } catch {
    return defaultName;
  }
}

// 确保 vault 内某路径的父目录存在
async function ensureParentDir(vault: Vault, filePath: string): Promise<void> {
  const slash = filePath.lastIndexOf("/");
  if (slash <= 0) return;
  const dirPath = filePath.slice(0, slash);
  const existing = vault.getAbstractFileByPath(dirPath);
  if (existing) return;
  // 递归创建
  const parts = dirPath.split("/");
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!vault.getAbstractFileByPath(cur)) {
      try {
        await vault.createFolder(cur);
      } catch {
        // 并发创建时可能已存在，忽略
      }
    }
  }
}

// 简单确认 Modal：返回用户是否点击 Confirm
export class ConfirmModal extends Modal {
  private resolved = false;
  constructor(
    app: App,
    private titleText: string,
    private bodyText: string,
    private onResult: (ok: boolean) => void,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.bodyText, cls: "llm-bridge-confirm-body" });
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = btns.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.done(false));
    const confirm = btns.createEl("button", { text: "确认执行", cls: "mod-warning" });
    confirm.addEventListener("click", () => this.done(true));
  }
  onClose(): void {
    if (!this.resolved) this.onResult(false);
    this.contentEl.empty();
  }
  private done(ok: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.onResult(ok);
    this.close();
  }
}
