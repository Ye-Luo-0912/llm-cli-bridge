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
  // V2.18 vault-api：结构化类补充（metadataCache 解析能力，文件系统做不准）
  | "outlinks_get"      // 出链清单（getFileCache().links，区分代码块假链接 + 解析目标）
  | "broken_links_list" // 断链清单（unresolvedLinks，文件系统无法检测）
  | "headings_get"      // 标题大纲（getFileCache().headings，区分代码块内 # 误判）
  // V2.18 vault-api：危险操作类（走 Obsidian trash + 审批）
  | "vault_delete"    // 删除文件（走回收站，比 fs.delete 安全）
  | "vault_rename"   // 重命名/移动（更新 metadataCache）
  | "vault_restore"  // 从回收站恢复（vault.restore，vault_delete 的逆操作）
  // V2.18 vault-api 第二批：搜索/聚合/书签（文件系统做不准/做不到）
  | "search"             // 全文搜索（markdown-aware：跳过 frontmatter/代码块）
  | "rename_tag"         // 全 vault 标签重命名（frontmatter + 内联 #tag 原子更新）
  | "bookmarks_list"     // 读 Obsidian 书签（.obsidian/ 已被路径校验拒绝，必须走 API）
  | "metadatacache_get"  // 单文件完整 metadataCache 快照（headings+links+tags+frontmatter+embeds 聚合）
  // V2.18 vault-api 第三批：全局图/插件/外部操作/设置（文件系统做不准/做不到）
  | "resolved_links_map" // 全 vault 解析后链接图（resolvedLinks 全量，全局拓扑）
  | "plugin_list"        // 列出启用的插件（.obsidian/ 被路径校验拒绝）
  | "open_url"           // 在默认浏览器打开 URL（UI 操作）
  | "setting_get"        // 读 Obsidian 设置项（.obsidian/app.json 被拒绝）
  // V2.18 vault-api 第四批：命令/工作区/剪贴板（文件系统做不到的 UI 与运行时状态）
  | "command_list"       // 列出所有可执行 Obsidian 命令（app.commands.listCommands）
  | "command_run"        // 执行 Obsidian 命令（app.commands.executeCommandById；走审批）
  | "workspace_get"      // 读当前工作区状态（打开的标签页/活动文件；.obsidian/workspace.json 被拒绝且非实时）
  | "clipboard_write";   // 写入剪贴板（navigator.clipboard.writeText）

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
  // V2.18 vault-api schemas 补充（metadataCache 解析能力 + 回收站恢复）
  outlinks_get: { required: ["path"], optional: [], extraForbidden: false },
  broken_links_list: { required: [], optional: ["path"], extraForbidden: false },
  headings_get: { required: ["path"], optional: [], extraForbidden: false },
  vault_restore: { required: ["path"], optional: [], extraForbidden: false },
  // V2.18 vault-api 第二批 schemas（搜索/聚合/书签）
  search: { required: ["query"], optional: ["path", "limit"], extraForbidden: false },
  rename_tag: { required: ["oldTag", "newTag"], optional: ["path"], extraForbidden: false },
  bookmarks_list: { required: [], optional: [], extraForbidden: false },
  metadatacache_get: { required: ["path"], optional: [], extraForbidden: false },
  // V2.18 vault-api 第三批 schemas（全局图/插件/外部操作/设置）
  resolved_links_map: { required: [], optional: ["path"], extraForbidden: false },
  plugin_list: { required: [], optional: [], extraForbidden: false },
  open_url: { required: ["url"], optional: [], extraForbidden: false },
  setting_get: { required: ["key"], optional: [], extraForbidden: false },
  // V2.18 vault-api 第四批 schemas（命令/工作区/剪贴板）
  command_list: { required: [], optional: [], extraForbidden: false },
  command_run: { required: ["commandId"], optional: [], extraForbidden: false },
  workspace_get: { required: [], optional: [], extraForbidden: false },
  clipboard_write: { required: ["text"], optional: [], extraForbidden: false },
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
  "vault_restore",
  // V2.18 vault-api 第二批写入类
  "rename_tag",
  // V2.18 vault-api 第四批：命令执行可能有副作用/破坏性
  "command_run",
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
    // ─── V2.18 vault-api 补充：metadataCache 解析能力 ──────────────────────
    case "outlinks_get": {
      // 出链清单（getFileCache().links，区分代码块假链接 + 解析目标）
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("outlinks_get: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`outlinks_get: 文件不存在 ${targetPath}`);
      const cache = app.metadataCache.getFileCache(f);
      const links = cache?.links ?? [];
      // 交叉引用 resolvedLinks 拿解析后的目标 path
      const resolvedLinks = (app.metadataCache as unknown as { resolvedLinks: Record<string, Record<string, number>> }).resolvedLinks;
      const targetMap = resolvedLinks[targetPath] ?? {};
      const result = links.map((l) => {
        // 在 targetMap 中找匹配（按 link text 或 original 匹配）
        const target = targetMap[l.link] ? l.link : (targetMap[l.original] ? l.original : null);
        return {
          link: l.link,
          original: l.original,
          target,
          position: { line: (l.position?.start?.line ?? 0) + 1, col: l.position?.start?.col ?? 0 },
          resolved: target !== null,
        };
      });
      const brokenCount = result.filter((r) => !r.resolved).length;
      return { path: targetPath, links: result, total: result.length, brokenCount };
    }
    case "broken_links_list": {
      // 断链清单（unresolvedLinks，文件系统无法检测）
      const pathFilter = typeof p.path === "string" ? String(p.path).trim() : undefined;
      const unresolvedLinks = (app.metadataCache as unknown as { unresolvedLinks: Record<string, Record<string, number>> }).unresolvedLinks;
      const brokenLinks: { source: string; link: string; count: number }[] = [];
      for (const [sourcePath, links] of Object.entries(unresolvedLinks)) {
        if (pathFilter && !sourcePath.startsWith(pathFilter)) continue;
        for (const [linkText, count] of Object.entries(links)) {
          if (count > 0) brokenLinks.push({ source: sourcePath, link: linkText, count });
        }
      }
      brokenLinks.sort((a, b) => b.count - a.count);
      return { brokenLinks, total: brokenLinks.length };
    }
    case "headings_get": {
      // 标题大纲（getFileCache().headings，区分代码块内 # 误判为 H1）
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("headings_get: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`headings_get: 文件不存在 ${targetPath}`);
      const cache = app.metadataCache.getFileCache(f);
      const headings = cache?.headings ?? [];
      const result = headings.map((h) => ({
        heading: h.heading,
        level: h.level,
        line: (h.position?.start?.line ?? 0) + 1,
      }));
      return { path: targetPath, headings: result, total: result.length };
    }
    case "vault_restore": {
      // 从回收站恢复（vault.restore，vault_delete 的逆操作）
      const originalPath = String(p.path ?? "").trim();
      if (!originalPath) throw new Error("vault_restore: 缺少 path");
      // 路径安全校验（originalPath 必须在 vault 内、非敏感路径）
      const pathUnsafe = isPathUnsafe(vaultPath, originalPath);
      if (pathUnsafe) throw new Error(pathUnsafe);
      // 在 .trash/ 中按 basename 匹配（Obsidian 删除时可能加 " (1)" 后缀）
      const trashBase = ".trash";
      const originalBasename = originalPath.split("/").pop() ?? originalPath;
      const originalNameNoExt = originalBasename.replace(/\.[^.]+$/, "");
      let trashFile: TFile | null = null;
      const trashFolder = app.vault.getAbstractFileByPath(trashBase);
      if (trashFolder instanceof TFolder) {
        // 遍历 .trash/ 子项找匹配（basename 或去后缀名匹配）
        const filesInTrash: TFile[] = [];
        const collect = (folder: TFolder) => {
          for (const child of folder.children) {
            if (child instanceof TFile) {
              filesInTrash.push(child);
            } else if (child instanceof TFolder) {
              collect(child);
            }
          }
        };
        collect(trashFolder);
        // 优先精确 basename 匹配，其次去后缀名 + 后缀容忍
        trashFile = filesInTrash.find((tf) => tf.name === originalBasename) ?? null;
        if (!trashFile) {
          trashFile = filesInTrash.find((tf) => {
            const tfNameNoExt = tf.name.replace(/\.[^.]+$/, "");
            return tfNameNoExt === originalNameNoExt || tfNameNoExt.startsWith(`${originalNameNoExt} `);
          }) ?? null;
        }
      }
      if (!trashFile) {
        throw new Error(`vault_restore: 在 ${trashBase}/ 中未找到匹配 ${originalBasename} 的文件`);
      }
      // 优先用 vault.restore（若 API 可用），否则 fallback 到 rename
      const vaultWithRestore = app.vault as unknown as { restore?: (f: TFile) => Promise<void> };
      if (typeof vaultWithRestore.restore === "function") {
        await vaultWithRestore.restore(trashFile);
      } else {
        // fallback：rename 到原路径（等效，但不走回收站元数据）
        await ensureParentDir(app.vault, originalPath);
        await app.vault.rename(trashFile, originalPath);
      }
      return { path: originalPath, restored: true, trashPath: trashFile.path };
    }
    // ─── V2.18 vault-api 第二批：搜索/聚合/书签 ─────────────────────────────
    case "search": {
      // markdown-aware 全文搜索：跳过 frontmatter + 代码块（grep 做不到）
      const query = String(p.query ?? "").trim();
      if (!query) throw new Error("search: 缺少 query");
      const pathFilter = typeof p.path === "string" ? String(p.path).trim() : undefined;
      const limitRaw = typeof p.limit === "number" ? p.limit : (typeof p.limit === "string" ? parseInt(p.limit, 10) : NaN);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
      // 尝试作为正则；失败则按字面量
      let regex: RegExp | null = null;
      try { regex = new RegExp(query, "i"); } catch { regex = null; }
      const lowerQuery = query.toLowerCase();
      const results: { path: string; line: number; col: number; match: string; context: string }[] = [];
      const mdFiles = app.vault.getMarkdownFiles();
      outer: for (const f of mdFiles) {
        if (pathFilter && !f.path.startsWith(pathFilter)) continue;
        const content = await app.vault.read(f);
        const lines = content.split(/\r?\n/);
        let inFrontmatter = false;
        let frontmatterDone = false;
        let inCodeFence = false;
        let codeFenceMarker = "";
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // frontmatter 检测（仅文件开头）
          if (i === 0) {
            if (line.trim() === "---") { inFrontmatter = true; continue; }
            frontmatterDone = true;
          }
          if (inFrontmatter) {
            if (line.trim() === "---") { inFrontmatter = false; frontmatterDone = true; }
            continue;
          }
          // 代码块检测
          const fenceMatch = line.match(/^\s*(```|~~~)/);
          if (fenceMatch) {
            if (!inCodeFence) { inCodeFence = true; codeFenceMarker = fenceMatch[1]; }
            else if (line.includes(codeFenceMarker)) { inCodeFence = false; codeFenceMarker = ""; }
            continue;
          }
          if (inCodeFence) continue;
          // 搜索匹配
          let matchIndex = -1;
          let matchedText = "";
          if (regex) {
            const m = line.match(regex);
            if (m && m.index !== undefined) { matchIndex = m.index; matchedText = m[0]; }
          } else {
            const lowerLine = line.toLowerCase();
            matchIndex = lowerLine.indexOf(lowerQuery);
            if (matchIndex >= 0) matchedText = line.slice(matchIndex, matchIndex + query.length);
          }
          if (matchIndex >= 0) {
            const start = Math.max(0, matchIndex - 30);
            const end = Math.min(line.length, matchIndex + matchedText.length + 30);
            results.push({
              path: f.path,
              line: i + 1,
              col: matchIndex + 1,
              match: matchedText,
              context: (start > 0 ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : ""),
            });
            if (results.length >= limit) break outer;
          }
        }
      }
      return { query, isRegex: regex !== null, matches: results, total: results.length, truncated: results.length >= limit };
    }
    case "rename_tag": {
      // 全 vault 标签重命名：frontmatter（processFrontMatter）+ 内联 #tag（跳过代码块）
      const oldTag = String(p.oldTag ?? "").replace(/^#/, "").trim();
      const newTag = String(p.newTag ?? "").replace(/^#/, "").trim();
      if (!oldTag) throw new Error("rename_tag: 缺少 oldTag");
      if (!newTag) throw new Error("rename_tag: 缺少 newTag");
      const pathFilter = typeof p.path === "string" ? String(p.path).trim() : undefined;
      const escapedOld = oldTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // 内联 #tag 正则：#前非词字符/行首，tag后非词字符/行尾
      const inlineRegex = new RegExp(`(^|[^\\w/#])#${escapedOld}(?=$|[^\\w/])`, "g");
      const mdFiles = app.vault.getMarkdownFiles();
      const changed: { path: string; frontmatter: boolean; inline: number }[] = [];
      for (const f of mdFiles) {
        if (pathFilter && !f.path.startsWith(pathFilter)) continue;
        let frontmatterChanged = false;
        let inlineCount = 0;
        // 1. frontmatter tags 改名（processFrontMatter 安全处理 YAML）
        await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
          const renameInArray = (arr: unknown): unknown[] => {
            if (!Array.isArray(arr)) return arr as unknown[];
            return arr.map((t) => (typeof t === "string" && t.replace(/^#/, "").trim() === oldTag ? newTag : t));
          };
          for (const key of ["tags", "tag"]) {
            if (Array.isArray(fm[key])) {
              const before = JSON.stringify(fm[key]);
              fm[key] = renameInArray(fm[key]);
              if (JSON.stringify(fm[key]) !== before) frontmatterChanged = true;
            }
          }
        });
        // 2. 内联 #tag 改名（read fresh → skip code fences → replace → modify）
        const content = await app.vault.read(f);
        const lines = content.split(/\r?\n/);
        let inCodeFence = false;
        let codeFenceMarker = "";
        let inFrontmatter = false;
        let modified = false;
        const newLines = lines.map((line, i) => {
          if (i === 0) {
            if (line.trim() === "---") { inFrontmatter = true; return line; }
          }
          if (inFrontmatter) {
            if (line.trim() === "---") inFrontmatter = false;
            return line;
          }
          const fenceMatch = line.match(/^\s*(```|~~~)/);
          if (fenceMatch) {
            if (!inCodeFence) { inCodeFence = true; codeFenceMarker = fenceMatch[1]; }
            else if (line.includes(codeFenceMarker)) { inCodeFence = false; codeFenceMarker = ""; }
            return line;
          }
          if (inCodeFence) return line;
          if (!line.includes("#")) return line;
          const replaced = line.replace(inlineRegex, (full, pre) => {
            inlineCount++;
            return `${pre}#${newTag}`;
          });
          if (replaced !== line) modified = true;
          return replaced;
        });
        if (modified) {
          await app.vault.modify(f, newLines.join("\n"));
        }
        if (frontmatterChanged || inlineCount > 0) {
          changed.push({ path: f.path, frontmatter: frontmatterChanged, inline: inlineCount });
        }
      }
      return { oldTag, newTag, changedFiles: changed, total: changed.length };
    }
    case "bookmarks_list": {
      // 读 Obsidian 书签（.obsidian/bookmarks.json，已被路径校验拒绝，必须走 API）
      const bookmarksPath = ".obsidian/bookmarks.json";
      let raw: string;
      try {
        raw = await app.vault.adapter.read(bookmarksPath);
      } catch {
        return { bookmarks: [], total: 0, note: "未找到 .obsidian/bookmarks.json（书签插件未启用或无书签）" };
      }
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return { bookmarks: [], total: 0, note: "bookmarks.json 解析失败" };
      }
      const items = Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? [];
      const bookmarks = items.map((item: Record<string, unknown>) => ({
        type: (item?.type as string) ?? "unknown",
        path: (item?.path as string) ?? null,
        title: (item?.title as string) ?? (item?.path as string) ?? null,
      }));
      return { bookmarks, total: bookmarks.length };
    }
    case "metadatacache_get": {
      // 单文件完整 metadataCache 快照（聚合，比分别调 4 个 action 高效）
      const targetPath = String(p.path ?? "").trim();
      if (!targetPath) throw new Error("metadatacache_get: 缺少 path");
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (!(f instanceof TFile)) throw new Error(`metadatacache_get: 文件不存在 ${targetPath}`);
      const cache = app.metadataCache.getFileCache(f);
      return {
        path: f.path,
        frontmatter: cache?.frontmatter ?? null,
        tags: cache?.tags ?? [],
        links: cache?.links ?? [],
        embeds: cache?.embeds ?? [],
        headings: (cache?.headings ?? []).map((h) => ({
          heading: h.heading, level: h.level, line: (h.position?.start?.line ?? 0) + 1,
        })),
        sections: (cache?.sections ?? []).map((s) => ({
          type: s.type, line: (s.position?.start?.line ?? 0) + 1,
        })),
      };
    }
    // ─── V2.18 vault-api 第三批：全局图/插件/外部操作/设置 ───────────────────
    case "resolved_links_map": {
      // 全 vault 解析后链接图（metadataCache.resolvedLinks 全量，全局拓扑）
      const pathFilter = typeof p.path === "string" ? String(p.path).trim() : undefined;
      const resolvedLinks = (app.metadataCache as unknown as { resolvedLinks: Record<string, Record<string, number>> }).resolvedLinks;
      const links: Record<string, Record<string, number>> = {};
      let totalFiles = 0;
      let totalLinks = 0;
      for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
        if (pathFilter && !sourcePath.startsWith(pathFilter)) continue;
        const filtered: Record<string, number> = {};
        for (const [target, count] of Object.entries(targets)) {
          if (pathFilter && !target.startsWith(pathFilter)) continue;
          filtered[target] = count;
          totalLinks++;
        }
        if (Object.keys(filtered).length > 0) {
          links[sourcePath] = filtered;
          totalFiles++;
        }
      }
      return { links, totalFiles, totalLinks };
    }
    case "plugin_list": {
      // 列出启用的插件（.obsidian/ 被路径校验拒绝，必须走 API）
      const pluginsApi = app as unknown as {
        plugins?: {
          manifests?: Record<string, { id: string; name: string; version: string; description?: string }>;
          enabledPlugins?: { has?: (id: string) => boolean } | Set<string>;
        };
        internalPlugins?: {
          getPluginById?: (id: string) => { instance?: { id: string; name: string }; _loaded?: boolean } | undefined;
          plugins?: Record<string, { id: string; name: string; enabled?: boolean }>;
        };
      };
      // 社区插件
      const manifests = pluginsApi.plugins?.manifests ?? {};
      const enabledSet = pluginsApi.plugins?.enabledPlugins;
      const isEnabled = (id: string): boolean => {
        if (!enabledSet) return false;
        if (enabledSet instanceof Set) return enabledSet.has(id);
        if (typeof (enabledSet as { has?: (id: string) => boolean }).has === "function") return (enabledSet as { has: (id: string) => boolean }).has(id);
        return false;
      };
      const community = Object.values(manifests).map((m) => ({
        id: m.id, name: m.name, version: m.version,
        description: m.description ?? null, enabled: isEnabled(m.id),
      }));
      // 核心插件：读 .obsidian/core-plugins.json
      let core: { id: string; enabled: boolean }[] = [];
      try {
        const coreRaw = await app.vault.adapter.read(".obsidian/core-plugins.json");
        const coreData = JSON.parse(coreRaw);
        // 兼容两种格式：数组 [...ids] 或对象 {enabled:[...], disabled:[...]}
        let enabledIds: string[] = [];
        if (Array.isArray(coreData)) {
          enabledIds = coreData.filter((x: unknown): x is string => typeof x === "string");
        } else if (coreData && typeof coreData === "object") {
          const e = (coreData as { enabled?: unknown[] }).enabled;
          if (Array.isArray(e)) enabledIds = e.filter((x: unknown): x is string => typeof x === "string");
        }
        core = enabledIds.map((id) => ({ id, enabled: true }));
      } catch {
        core = [];
      }
      return { core, community, totalCore: core.length, totalCommunity: community.length };
    }
    case "open_url": {
      // 在默认浏览器打开 URL（UI 操作，文件系统做不到）
      const url = String(p.url ?? "").trim();
      if (!url) throw new Error("open_url: 缺少 url");
      // 安全校验：只允许 http/https/obsidian:// scheme，拒绝 javascript:/file:/data:
      if (!/^(https?:|obsidian:)/i.test(url)) {
        throw new Error(`open_url: 不支持的 URL scheme（仅允许 http/https/obsidian://）: ${url}`);
      }
      const obsidianWindow = window as unknown as { open?: (url: string, target?: string) => Window | null };
      if (typeof obsidianWindow.open === "function") {
        obsidianWindow.open(url, "_blank");
      } else {
        throw new Error("open_url: 当前环境不支持 window.open");
      }
      return { url, opened: true };
    }
    case "setting_get": {
      // 读 Obsidian 设置项（.obsidian/app.json 被路径校验拒绝，必须走 API）
      const key = String(p.key ?? "").trim();
      if (!key) throw new Error("setting_get: 缺少 key");
      let settingsRaw: string;
      try {
        settingsRaw = await app.vault.adapter.read(".obsidian/app.json");
      } catch {
        return { key, value: null, note: "未找到 .obsidian/app.json" };
      }
      let settings: Record<string, unknown>;
      try {
        settings = JSON.parse(settingsRaw);
      } catch {
        return { key, value: null, note: "app.json 解析失败" };
      }
      return { key, value: key in settings ? settings[key] : null };
    }
    // ─── V2.18 vault-api 第四批：命令/工作区/剪贴板 ─────────────────────────
    case "command_list": {
      // 列出所有可执行 Obsidian 命令（app.commands.listCommands，文件系统做不到）
      const commandsApi = app as unknown as {
        commands?: {
          listCommands?: () => Array<{ id: string; name: string; icon?: string }>;
          commands?: Record<string, { id: string; name: string }>;
        };
      };
      let cmds: Array<{ id: string; name: string }> = [];
      if (typeof commandsApi.commands?.listCommands === "function") {
        cmds = commandsApi.commands.listCommands().map((c) => ({ id: c.id, name: c.name }));
      } else if (commandsApi.commands?.commands) {
        cmds = Object.values(commandsApi.commands.commands).map((c) => ({ id: c.id, name: c.name }));
      }
      cmds.sort((a, b) => a.id.localeCompare(b.id));
      return { commands: cmds, total: cmds.length };
    }
    case "command_run": {
      // 执行 Obsidian 命令（app.commands.executeCommandById；走审批因可能有副作用）
      const commandId = String(p.commandId ?? "").trim();
      if (!commandId) throw new Error("command_run: 缺少 commandId");
      const commandsApi = app as unknown as {
        commands?: { executeCommandById?: (id: string) => unknown };
      };
      if (typeof commandsApi.commands?.executeCommandById !== "function") {
        throw new Error("command_run: 当前环境不支持 commands.executeCommandById");
      }
      const result = commandsApi.commands.executeCommandById(commandId);
      return { commandId, executed: true, result: result ?? null };
    }
    case "workspace_get": {
      // 读当前工作区状态（.obsidian/workspace.json 被拒绝且非实时）
      const activeFile = app.workspace.getActiveFile();
      const leaves = app.workspace.getLeavesOfType("markdown");
      const openFiles: { path: string }[] = [];
      for (const leaf of leaves) {
        const view = (leaf as { view?: unknown }).view;
        if (view instanceof MarkdownView && view.file) {
          openFiles.push({ path: view.file.path });
        }
      }
      return {
        activeFilePath: activeFile ? activeFile.path : null,
        openFiles,
        totalTabs: openFiles.length,
      };
    }
    case "clipboard_write": {
      // 写入剪贴板（navigator.clipboard.writeText，文件系统做不到）
      const text = String(p.text ?? "");
      const nav = navigator as unknown as { clipboard?: { writeText?: (t: string) => Promise<void> } };
      if (nav.clipboard && typeof nav.clipboard.writeText === "function") {
        try {
          await nav.clipboard.writeText(text);
          return { length: text.length, written: true };
        } catch {
          // fallback 到 execCommand
        }
      }
      // fallback：临时 textarea + document.execCommand('copy')
      const doc = document as unknown as {
        createElement: (tag: string) => HTMLTextAreaElement;
        body?: { appendChild: (el: HTMLTextAreaElement) => void; removeChild: (el: HTMLTextAreaElement) => void };
        execCommand?: (cmd: string) => boolean;
      };
      const ta = doc.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      if (doc.body) {
        doc.body.appendChild(ta);
        ta.select();
        const ok = typeof doc.execCommand === "function" ? doc.execCommand("copy") : false;
        doc.body.removeChild(ta);
        if (!ok) throw new Error("clipboard_write: 剪贴板写入失败（execCommand fallback 也失败）");
        return { length: text.length, written: true };
      }
      throw new Error("clipboard_write: 当前环境无剪贴板访问能力");
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
    case "vault_restore":
      return `将从回收站恢复文件: ${p.path}`;
    case "rename_tag":
      return `将全 vault 重命名标签: #${p.oldTag} → #${p.newTag}${p.path ? `\n范围: ${p.path}` : ""}`;
    case "command_run":
      return `将执行 Obsidian 命令: ${p.commandId}`;
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
