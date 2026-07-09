// LLM CLI Bridge — Action 元数据（纯数据，不依赖 obsidian）
// V2.18 r7: 从 actions.ts 提取，打破 agentRuntimeWorkspace → actions → obsidian 依赖链。
// agentRuntimeWorkspace 只需 ACTION_METADATA 生成 SKILL.md，不需要 obsidian runtime。

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
  | "property_delete" // 删除 frontmatter 属性（fileManager.processFrontMatter delete）
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
  | "clipboard_write"   // 写入剪贴板（navigator.clipboard.writeText）
  // V2.18 vault-api 第五批：反向查询/链接解析/附件/视图模式（metadataCache 解析能力 + UI 操作）
  | "tag_files"          // 列出某 tag 下的所有文件（metadataCache 反向查询，tags_list 的逆向）
  | "link_resolve"       // 解析 wikilink/markdown link 到实际路径（metadataCache.getFirstLinkpathDest）
  | "attachment_list"    // 列出笔记嵌入的所有附件（getFileCache().embeds，区分纯文本引用）
  | "view_mode_set";      // 切换当前视图编辑/预览模式（MarkdownView.setState，UI 运行时操作）

export interface OutboxAction {
  id: string;
  type: ActionType;
  params: Record<string, unknown>;
  ts?: string;
}

// ─── Action Schema 校验 ───────────────────────────────────────────────────

export interface ParamSchema {
  required?: string[];
  optional?: string[];
  extraForbidden?: boolean; // true = 不允许额外字段
}

// ─── Action 完整元数据（参数类型 + 返回值 + 描述，用于 SKILL.md 自动生成）──

export interface ActionParamSpec {
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "unknown";
  readonly required: boolean;
  readonly description: string;
}

export interface ActionMetadata {
  readonly type: ActionType;
  readonly params: ReadonlyArray<ActionParamSpec>;
  readonly returns: string;        // 返回值类型描述
  readonly modifying: boolean;     // 是否修改类（走审批）
  readonly description: string;    // 一句话描述
  readonly category: "basic" | "structured" | "dangerous" | "ui" | "search";
}

// 修改类 action 清单（与 MODIFYING_ACTIONS 同步）
const MODIFYING_ACTION_TYPES: ReadonlyArray<ActionType> = [
  "create_note", "append_to_note", "insert_at_cursor", "replace_selection",
  "property_set", "daily_append",
  "vault_delete", "vault_rename", "vault_restore",
  "rename_tag", "command_run",
];

function meta(
  type: ActionType,
  params: Array<[string, ActionParamSpec["type"], boolean, string]>,
  returns: string,
  description: string,
  category: ActionMetadata["category"],
): ActionMetadata {
  return {
    type,
    params: params.map(([name, type, required, description]) => ({
      name, type, required, description,
    })),
    returns,
    modifying: MODIFYING_ACTION_TYPES.includes(type),
    description,
    category,
  };
}

// 29 个 action 的完整元数据表
export const ACTION_METADATA: Record<ActionType, ActionMetadata> = {
  show_notice: meta("show_notice",
    [["message", "string", true, "通知文本"]], "undefined", "显示 Obsidian 通知条", "basic"),
  open_note: meta("open_note",
    [["path", "string", true, "vault 相对路径"]], "undefined", "在 Obsidian 打开笔记", "basic"),
  get_state: meta("get_state", [],
    "{vaultPath, activeFilePath, hasActiveFile, hasSelection, selectionLength, timestamp}",
    "获取当前工作区状态", "basic"),
  get_active_note: meta("get_active_note",
    [["maxChars", "number", false, "内容截断上限（默认 50000，-1 不截断）"]],
    "{path, content, size, truncated} | null", "获取当前活动笔记全文（大文件自动截断）", "basic"),
  get_selection: meta("get_selection", [],
    "{text, length, hasSelection}", "获取当前选中文本", "basic"),
  create_note: meta("create_note",
    [["path", "string", true, "vault 相对路径"], ["content", "string", true, "文件内容"]],
    "{path}", "创建新笔记", "basic"),
  append_to_note: meta("append_to_note",
    [["path", "string", true, "vault 相对路径"], ["content", "string", true, "追加内容"]],
    "undefined", "追加内容到笔记末尾", "basic"),
  insert_at_cursor: meta("insert_at_cursor",
    [["content", "string", true, "插入文本"]], "undefined", "在光标位置插入文本", "basic"),
  replace_selection: meta("replace_selection",
    [["content", "string", true, "替换文本"]], "undefined", "替换当前选中文本", "basic"),
  property_get: meta("property_get",
    [["path", "string", true, "vault 相对路径"], ["key", "string", false, "属性名（不传返回全部）"]],
    "any | Record<string, any>", "读 frontmatter 属性（metadataCache）", "structured"),
  property_set: meta("property_set",
    [["path", "string", true, "vault 相对路径"], ["key", "string", true, "属性名"], ["value", "unknown", true, "属性值（string/number/boolean/array/object，null 被拒绝，用 property_delete 删除）"]],
    "undefined", "写 frontmatter 属性（fileManager.processFrontMatter）", "structured"),
  property_delete: meta("property_delete",
    [["path", "string", true, "vault 相对路径"], ["key", "string", true, "要删除的属性名"]],
    "{deleted}", "删除 frontmatter 属性（fileManager.processFrontMatter delete）", "structured"),
  tags_list: meta("tags_list",
    [["path", "string", false, "目录前缀过滤"], ["limit", "number", false, "结果上限（默认 500，-1 不限）"]],
    "{tags, total, truncated}", "全 vault 标签清单（大 vault 自动截断）", "structured"),
  backlinks_get: meta("backlinks_get",
    [["path", "string", true, "vault 相对路径"]], "Array<{path, position}>", "反向链接清单", "structured"),
  tasks_list: meta("tasks_list",
    [["path", "string", false, "目录前缀过滤"], ["limit", "number", false, "结果上限（默认 500，-1 不限）"]],
    "{tasks, total, truncated}", "待办清单（大 vault 自动截断）", "structured"),
  daily_read: meta("daily_read", [],
    "{path, content} | null", "读今天 daily note", "structured"),
  daily_append: meta("daily_append",
    [["content", "string", true, "追加内容"]], "undefined", "追加到今天 daily note", "structured"),
  outlinks_get: meta("outlinks_get",
    [["path", "string", true, "vault 相对路径"]], "Array<{link, display, resolvedPath}>", "出链清单", "structured"),
  broken_links_list: meta("broken_links_list",
    [["path", "string", false, "目录前缀过滤"]], "Array<{path, link, position}>", "断链清单", "structured"),
  headings_get: meta("headings_get",
    [["path", "string", true, "vault 相对路径"]], "Array<{level, heading, position}>", "标题大纲", "structured"),
  vault_delete: meta("vault_delete",
    [["path", "string", true, "vault 相对路径"]], "undefined", "删除文件（走回收站）", "dangerous"),
  vault_rename: meta("vault_rename",
    [["path", "string", true, "原路径"], ["newPath", "string", true, "新路径"]],
    "undefined", "重命名/移动文件", "dangerous"),
  vault_restore: meta("vault_restore",
    [["path", "string", true, "回收站内文件名"]], "undefined", "从回收站恢复文件", "dangerous"),
  search: meta("search",
    [["query", "string", true, "搜索词（默认 literal；regex=true 时按正则）"],
     ["path", "string", false, "目录前缀过滤"],
     ["limit", "number", false, "结果上限（默认50，上限200）"],
     ["regex", "boolean", false, "是否正则模式（默认 false literal）"]],
    "Array<{path, line, match, context}>", "全文搜索（markdown-aware，默认 literal）", "search"),
  rename_tag: meta("rename_tag",
    [["oldTag", "string", true, "旧标签名（不带#）"], ["newTag", "string", true, "新标签名（不带#）"], ["path", "string", false, "目录前缀过滤"]],
    "{updatedFiles}", "全 vault 标签重命名", "dangerous"),
  bookmarks_list: meta("bookmarks_list", [],
    "Array<{path, title, type}>", "读 Obsidian 书签", "structured"),
  metadatacache_get: meta("metadatacache_get",
    [["path", "string", true, "vault 相对路径"], ["limit", "number", false, "links/embeds 上限（默认 200，-1 不限）"]],
    "{frontmatter, tags, links, embeds, headings, sections, truncated}", "单文件完整 metadataCache 快照（大文件自动截断）", "structured"),
  resolved_links_map: meta("resolved_links_map",
    [["path", "string", false, "目录前缀过滤"], ["limit", "number", false, "结果上限（默认 500，-1 不限）"]],
    "{map, total, truncated}", "全 vault 解析后链接图（大 vault 自动截断）", "structured"),
  plugin_list: meta("plugin_list", [],
    "Array<{id, name, enabled}>", "列出启用的插件", "structured"),
  open_url: meta("open_url",
    [["url", "string", true, "URL（http/https/obsidian://）"]], "undefined", "在默认浏览器打开 URL", "ui"),
  setting_get: meta("setting_get",
    [["key", "string", true, "设置项名（如 attachmentFolderPath）"]], "any", "读 Obsidian 设置项", "structured"),
  command_list: meta("command_list", [],
    "Array<{id, name}>", "列出所有可执行命令", "ui"),
  command_run: meta("command_run",
    [["commandId", "string", true, "命令 id（用 command_list 查询）"]], "unknown", "执行 Obsidian 命令", "dangerous"),
  workspace_get: meta("workspace_get", [],
    "{activeFile, openFiles, leaves}", "读当前工作区状态", "ui"),
  clipboard_write: meta("clipboard_write",
    [["text", "string", true, "剪贴板文本"]], "undefined", "写入系统剪贴板", "ui"),
  tag_files: meta("tag_files",
    [["tag", "string", true, "标签名（不带#）"]], "Array<{path, tags}>", "列出某 tag 下的所有文件", "structured"),
  link_resolve: meta("link_resolve",
    [["link", "string", true, "wikilink/markdown link"], ["sourcePath", "string", false, "来源文件路径"]],
    "{resolvedPath, file} | null", "解析 link 到实际路径", "structured"),
  attachment_list: meta("attachment_list",
    [["path", "string", true, "vault 相对路径"]], "Array<{link, resolvedPath, type}>", "列出笔记嵌入的所有附件", "structured"),
  view_mode_set: meta("view_mode_set",
    [["mode", "string", true, "source/edit/reading/preview"]], "undefined", "切换当前视图编辑/预览模式", "ui"),
};

// 从 ACTION_METADATA 派生 ParamSchema（保持 ACTION_SCHEMAS 与元数据一致）
export const ACTION_SCHEMAS: Record<ActionType, ParamSchema> = Object.fromEntries(
  (Object.keys(ACTION_METADATA) as ActionType[]).map((type) => {
    const m = ACTION_METADATA[type];
    const required = m.params.filter((p) => p.required).map((p) => p.name);
    const optional = m.params.filter((p) => !p.required).map((p) => p.name);
    // get_state/get_active_note/get_selection 等无参数 action 不允许额外字段
    const extraForbidden = m.params.length === 0;
    return [type, { required, optional, extraForbidden }];
  }),
) as Record<ActionType, ParamSchema>;

// 会修改笔记或覆盖文件的 action：必须弹审批
// 从 ACTION_METADATA.modifying 派生（单一真相源）
export function isModifying(type: string): boolean {
  const meta = ACTION_METADATA[type as ActionType];
  return !!meta && meta.modifying;
}

// V2.18 r10/r11: 危险操作才走 bridge 两阶段审批；其余（含修改类）直接执行并审计。
// agent runtime 的 PermissionBoundary 是唯一用户交互审批源；
// bridge 仅对 dangerous 类（删除/重命名/恢复/标签重命名/命令执行）保留安全网。
// 普通修改类（create_note/append/property_set/daily_append/clipboard_write/view_mode_set）直接执行。
export function requiresBridgeApproval(type: string): boolean {
  const meta = ACTION_METADATA[type as ActionType];
  return !!meta && meta.category === "dangerous";
}
