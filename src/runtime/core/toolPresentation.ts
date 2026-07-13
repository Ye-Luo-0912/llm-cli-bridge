// LLM CLI Bridge — ToolPresentation (F-01 统一「用户可见操作」翻译层)
//
// 单一入口：把 provider event / vault-api action / tool name 翻译成普通用户可见的呈现。
// 输出：用户标签 / 图标 / 分类 / 摘要 / 风险等级 / 是否突出 / (devMode) 原始名与输入。
//
// 设计原则：
// 1. 普通模式绝不泄露下划线内部名（property_get / vault_delete / codex-managed-app-server）。
// 2. 未知工具走安全降级「正在执行工具 / Running tool」，不泄露原始 payload。
// 3. Developer Mode 才保留原始名称与输入（rawName / rawInput）。
// 4. 双语表（zh/en），运行时按 resolveUiLocale() 切换（默认跟随 Obsidian 语言，node 测试环境 fallback en）。
// 5. ActionType 精确匹配优先于 provider 原生工具的正则匹配（避免 tags_list/command_list 被 list/command 正则误吞）。
//
// 迁移：agentRunDisplayModel.ts 的 toolDisplayLabel / approvalDisplayLabel / getToolIconCategory /
// toolToActivity 与 view.ts 的 toolDisplayLabelForPhase 均委托到本模块，消除重复逻辑。

import { ACTION_METADATA, type ActionType } from "../../actionMetadata";

// ---------- Types ----------

export type Locale = "zh" | "en";

/** 细粒度分类（向后兼容 getToolIconCategory 的 category 值：read/write/command/...） */
export type ToolPresentationCategory =
  | "read" | "write" | "delete" | "search" | "command"
  | "web" | "notify" | "think" | "tool" | "system";

/** F-01 规范的高层分组（读取 / 编辑 / 检索 / 外部操作 / 等待用户 / 系统） */
export type ToolPresentationGroup =
  | "read" | "edit" | "search" | "external" | "waiting" | "system";

export type RiskLevel = "low" | "medium" | "high";

export interface ToolPresentation {
  /** 用户可见标签（如「读取笔记属性」「Read AGENTS.md」），普通模式不含下划线内部名 */
  userLabel: string;
  /** Lucide 图标名 */
  icon: string;
  /** 细粒度分类（向后兼容） */
  category: ToolPresentationCategory;
  /** 高层分组（F-01 规范） */
  group: ToolPresentationGroup;
  /** 摘要（如「读取《项目计划》的 tags」），不含 raw payload */
  summary: string;
  /** 风险等级 */
  riskLevel: RiskLevel;
  /** 是否应突出显示（高风险 / 需用户注意） */
  shouldHighlight: boolean;
  /** Developer Mode 保留的原始名称；普通模式为 undefined */
  rawName?: string;
  /** Developer Mode 保留的原始输入；普通模式为 undefined */
  rawInput?: string;
  /** 是否为未知工具（使用安全降级文案） */
  isUnknown: boolean;
}

export interface PresentationOptions {
  locale?: Locale;
  developerMode?: boolean;
}

export type ToolPresentationInput =
  | { kind: "tool"; toolName: string; toolInput?: string } & PresentationOptions
  | { kind: "action"; actionType: string; params?: Record<string, unknown> } & PresentationOptions
  | { kind: "provider"; providerId: string } & PresentationOptions;

// ---------- Locale resolution ----------

let cachedLocale: Locale | null = null;

/**
 * 运行时解析 UI 语言。优先级：显式传入 > Obsidian moment.locale() > 默认 en。
 * - Obsidian 设为中文（zh / zh-cn / zh-tw）→ "zh"
 * - 其余 / node 测试环境（无 window.moment）→ "en"
 *
 * 结果缓存：首次解析后复用，避免每次呈现都读 moment。测试可通过 resetUiLocale() 重置。
 */
export function resolveUiLocale(explicit?: Locale): Locale {
  if (explicit === "zh" || explicit === "en") return explicit;
  if (cachedLocale) return cachedLocale;
  let resolved: Locale = "en";
  try {
    const w = (globalThis as { window?: { moment?: { locale?: () => string } } }).window;
    const loc = typeof w?.moment?.locale === "function" ? w.moment.locale() : undefined;
    if (typeof loc === "string" && loc.toLowerCase().startsWith("zh")) resolved = "zh";
  } catch {
    // 无 Obsidian 环境（node 测试）：默认 en
  }
  cachedLocale = resolved;
  return resolved;
}

/** 测试用：重置 locale 缓存。 */
export function resetUiLocale(): void {
  cachedLocale = null;
}

// ---------- Helpers ----------

/** 取路径 basename（跨平台），不泄露完整路径 */
function basename(p: string | undefined | null): string | null {
  if (!p || typeof p !== "string") return null;
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** 从工具输入（JSON 字符串或裸路径）提取文件路径 basename */
function extractPathBasename(input?: string): string | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    const p = parsed.file_path ?? parsed.notebook_path ?? parsed.path ?? parsed.pattern;
    if (typeof p === "string" && p.length > 0) return basename(p);
  } catch {
    if (/[/\\]/.test(input)) return basename(input);
  }
  return null;
}

/** 中文书名号包裹标题，用于摘要里的笔记名；去掉 .md/.markdown 扩展名以显示更友好的标题 */
function quotedTitle(name: string | null, locale: Locale): string {
  if (!name) return locale === "zh" ? "笔记" : "note";
  const stripped = name.replace(/\.(md|markdown)$/i, "");
  return locale === "zh" ? `《${stripped}》` : `"${stripped}"`;
}

function riskFromAction(actionType: string): RiskLevel {
  const meta = ACTION_METADATA[actionType as ActionType];
  if (!meta) return "low";
  if (meta.category === "dangerous") return "high";
  if (meta.modifying) return "medium";
  return "low";
}

// ---------- Action label table (vault-api 39 ActionTypes) ----------

interface ActionLabel {
  zh: string;
  en: string;
  icon: string;
  category: ToolPresentationCategory;
  group: ToolPresentationGroup;
  /** 摘要构建器；缺省则 summary = userLabel */
  summary?: (params: Record<string, unknown>, locale: Locale) => string;
}

/** 标记摘要构建器（identity 包装，提升可读性） */
function actionSummary(
  fn: (params: Record<string, unknown>, locale: Locale) => string,
): ActionLabel["summary"] {
  return fn;
}

const ACTION_LABELS: Partial<Record<ActionType, ActionLabel>> = {
  // basic 读取
  get_state: { zh: "读取工作区状态", en: "Read workspace state", icon: "info", category: "read", group: "read" },
  get_active_note: {
    zh: "读取当前笔记", en: "Read active note", icon: "file-text", category: "read", group: "read",
    summary: actionSummary((_p, loc) => loc === "zh" ? "读取当前活动笔记" : "Read active note"),
  },
  get_selection: { zh: "读取选中文本", en: "Read selection", icon: "text-cursor", category: "read", group: "read" },
  open_note: {
    zh: "打开笔记", en: "Open note", icon: "file-text", category: "read", group: "read",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `打开笔记 ${quotedTitle(b, loc)}` : `Open note ${quotedTitle(b, loc)}`;
    }),
  },
  show_notice: { zh: "显示通知", en: "Show notice", icon: "bell", category: "notify", group: "system" },

  // basic 编辑
  create_note: {
    zh: "创建笔记", en: "Create note", icon: "file-plus", category: "write", group: "edit",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `创建笔记 ${quotedTitle(b, loc)}` : `Create note ${quotedTitle(b, loc)}`;
    }),
  },
  append_to_note: {
    zh: "追加到笔记", en: "Append to note", icon: "file-plus", category: "write", group: "edit",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `追加内容到 ${quotedTitle(b, loc)}` : `Append to ${quotedTitle(b, loc)}`;
    }),
  },
  insert_at_cursor: { zh: "在光标处插入", en: "Insert at cursor", icon: "file-plus", category: "write", group: "edit" },
  replace_selection: { zh: "替换选中文本", en: "Replace selection", icon: "file-pen-line", category: "write", group: "edit" },

  // structured frontmatter / metadata
  property_get: {
    zh: "读取笔记属性", en: "Read note property", icon: "file-text", category: "read", group: "read",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      const key = typeof p.key === "string" ? p.key : null;
      return loc === "zh"
        ? `读取${quotedTitle(b, loc)}${key ? `的 ${key}` : "的属性"}`
        : `Read ${key ? key + " of " : ""}${quotedTitle(b, loc)}`;
    }),
  },
  property_set: {
    zh: "更新 frontmatter", en: "Update frontmatter", icon: "pencil", category: "write", group: "edit",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      const key = typeof p.key === "string" ? p.key : null;
      return loc === "zh"
        ? `更新${quotedTitle(b, loc)}${key ? `的 ${key}` : "的属性"}`
        : `Update ${key ? key + " of " : ""}${quotedTitle(b, loc)}`;
    }),
  },
  property_delete: {
    zh: "删除 frontmatter 属性", en: "Delete frontmatter property", icon: "eraser", category: "delete", group: "edit",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      const key = typeof p.key === "string" ? p.key : null;
      return loc === "zh"
        ? `删除${quotedTitle(b, loc)}${key ? `的 ${key}` : "的属性"}`
        : `Delete ${key ? key + " of " : "property of "}${quotedTitle(b, loc)}`;
    }),
  },
  tags_list: { zh: "列出 Vault 标签", en: "List vault tags", icon: "tags", category: "search", group: "search" },
  backlinks_get: {
    zh: "读取反向链接", en: "Read backlinks", icon: "link", category: "read", group: "read",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `读取${quotedTitle(b, loc)}的反向链接` : `Read backlinks of ${quotedTitle(b, loc)}`;
    }),
  },
  tasks_list: { zh: "列出待办清单", en: "List tasks", icon: "list-checks", category: "search", group: "search" },
  daily_read: { zh: "读取今日 Daily Note", en: "Read today's daily note", icon: "calendar", category: "read", group: "read" },
  daily_append: { zh: "追加到今日 Daily Note", en: "Append to today's daily note", icon: "calendar-plus", category: "write", group: "edit" },
  outlinks_get: {
    zh: "读取出链清单", en: "Read outlinks", icon: "link", category: "read", group: "read",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `读取${quotedTitle(b, loc)}的出链` : `Read outlinks of ${quotedTitle(b, loc)}`;
    }),
  },
  broken_links_list: { zh: "列出断链清单", en: "List broken links", icon: "link-broken", category: "search", group: "search" },
  headings_get: {
    zh: "读取标题大纲", en: "Read headings", icon: "list", category: "read", group: "read",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `读取${quotedTitle(b, loc)}的标题大纲` : `Read headings of ${quotedTitle(b, loc)}`;
    }),
  },
  bookmarks_list: { zh: "读取书签", en: "Read bookmarks", icon: "bookmark", category: "read", group: "read" },
  metadatacache_get: {
    zh: "读取笔记元数据", en: "Read note metadata", icon: "file-text", category: "read", group: "read",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `读取${quotedTitle(b, loc)}的元数据` : `Read metadata of ${quotedTitle(b, loc)}`;
    }),
  },
  resolved_links_map: { zh: "读取链接图", en: "Read resolved links map", icon: "share-2", category: "read", group: "read" },
  tag_files: {
    zh: "按标签查找文件", en: "Find files by tag", icon: "tags", category: "search", group: "search",
    summary: actionSummary((p, loc) => {
      const tag = typeof p.tag === "string" ? p.tag : null;
      return loc === "zh" ? `查找带 #${tag ?? "tag"} 标签的文件` : `Find files tagged #${tag ?? "tag"}`;
    }),
  },
  link_resolve: { zh: "解析链接", en: "Resolve link", icon: "link", category: "read", group: "read" },
  attachment_list: {
    zh: "列出附件", en: "List attachments", icon: "paperclip", category: "read", group: "read",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `列出${quotedTitle(b, loc)}的附件` : `List attachments of ${quotedTitle(b, loc)}`;
    }),
  },
  plugin_list: { zh: "列出已启用插件", en: "List enabled plugins", icon: "puzzle", category: "read", group: "system" },
  setting_get: { zh: "读取设置项", en: "Read setting", icon: "settings", category: "read", group: "system" },
  workspace_get: { zh: "读取工作区状态", en: "Read workspace", icon: "layout", category: "read", group: "system" },

  // search
  search: {
    zh: "搜索 Vault", en: "Search vault", icon: "search", category: "search", group: "search",
    summary: actionSummary((p, loc) => {
      const q = typeof p.query === "string" ? p.query : null;
      return loc === "zh" ? `在 Vault 中搜索「${q ?? ""}」` : `Search vault for "${q ?? ""}"`;
    }),
  },

  // dangerous
  vault_delete: {
    zh: "删除文件", en: "Delete file", icon: "trash-2", category: "delete", group: "edit",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      return loc === "zh" ? `删除文件 ${quotedTitle(b, loc)}` : `Delete file ${quotedTitle(b, loc)}`;
    }),
  },
  vault_rename: {
    zh: "重命名/移动文件", en: "Rename or move file", icon: "file-output", category: "write", group: "edit",
    summary: actionSummary((p, loc) => {
      const b = basename(p.path as string);
      const nb = basename(p.newPath as string);
      return loc === "zh" ? `重命名 ${quotedTitle(b, loc)} → ${quotedTitle(nb, loc)}` : `Rename ${quotedTitle(b, loc)} → ${quotedTitle(nb, loc)}`;
    }),
  },
  vault_restore: { zh: "从回收站恢复文件", en: "Restore file from trash", icon: "file-heart", category: "write", group: "edit" },
  rename_tag: {
    zh: "重命名标签", en: "Rename tag", icon: "tags", category: "write", group: "edit",
    summary: actionSummary((p, loc) => {
      const o = typeof p.oldTag === "string" ? p.oldTag : null;
      const n = typeof p.newTag === "string" ? p.newTag : null;
      return loc === "zh" ? `重命名标签 #${o} → #${n}` : `Rename tag #${o} → #${n}`;
    }),
  },
  command_run: {
    zh: "执行命令", en: "Run command", icon: "terminal", category: "command", group: "external",
    summary: actionSummary((p, loc) => {
      const id = typeof p.commandId === "string" ? p.commandId : null;
      return loc === "zh" ? `执行命令 ${id ?? ""}` : `Run command ${id ?? ""}`.trim();
    }),
  },

  // ui / external
  open_url: {
    zh: "打开链接", en: "Open URL", icon: "external-link", category: "web", group: "external",
    summary: actionSummary((p, loc) => {
      const u = typeof p.url === "string" ? p.url : null;
      return loc === "zh" ? `打开链接 ${u ?? ""}` : `Open URL ${u ?? ""}`.trim();
    }),
  },
  command_list: { zh: "列出可执行命令", en: "List commands", icon: "terminal", category: "command", group: "system" },
  clipboard_write: { zh: "写入剪贴板", en: "Write to clipboard", icon: "clipboard", category: "command", group: "external" },
  view_mode_set: { zh: "切换视图模式", en: "Switch view mode", icon: "eye", category: "command", group: "external" },
};

// ---------- Provider-native tool regex matchers ----------
//
// 精确保留既有 toolDisplayLabel 的英文输出与正则语义（测试断言依赖）。
// 仅当工具名不是 ActionType 时进入此路径。

interface ProviderToolRule {
  test: (lower: string) => boolean;
  zh: (basename: string | null) => string;
  en: (basename: string | null) => string;
  icon: string;
  category: ToolPresentationCategory;
  group: ToolPresentationGroup;
  risk: RiskLevel;
}

const PROVIDER_TOOL_RULES: ProviderToolRule[] = [
  {
    test: (l) => /^read|getfile|file_read|view$/.test(l) || l === "read",
    zh: (b) => b ? `读取 ${b}` : "读取文件",
    en: (b) => b ? `Read ${b}` : "Read",
    icon: "file-text", category: "read", group: "read", risk: "low",
  },
  {
    test: (l) => /write|edit|str_replace|patch|update_file|insert/.test(l),
    zh: (b) => b ? `修改 ${b}` : "修改文件",
    en: (b) => b ? `Write ${b}` : "Write",
    icon: "pencil", category: "write", group: "edit", risk: "medium",
  },
  {
    test: (l) => /create_file/.test(l),
    zh: (b) => b ? `创建 ${b}` : "创建文件",
    en: (b) => b ? `Created ${b}` : "Created",
    icon: "file-plus", category: "write", group: "edit", risk: "medium",
  },
  {
    test: (l) => /delete_file|remove/.test(l),
    zh: (b) => b ? `删除 ${b}` : "删除文件",
    en: (b) => b ? `Deleted ${b}` : "Deleted",
    icon: "trash-2", category: "delete", group: "edit", risk: "high",
  },
  {
    test: (l) => /bash|execute|run|command|shell/.test(l),
    zh: (_b) => "执行命令",
    en: (_b) => "Run command",
    icon: "terminal", category: "command", group: "external", risk: "medium",
  },
  {
    test: (l) => /grep|glob|search|ls|list/.test(l),
    zh: (_b) => "搜索",
    en: (_b) => "Search",
    icon: "search", category: "search", group: "search", risk: "low",
  },
  {
    test: (l) => /web|fetch|curl|browse/.test(l),
    zh: (_b) => "访问网络",
    en: (_b) => "Web request",
    icon: "globe", category: "web", group: "external", risk: "low",
  },
  {
    test: (l) => /think|reason/.test(l),
    zh: (_b) => "思考",
    en: (_b) => "Thinking",
    icon: "brain", category: "think", group: "system", risk: "low",
  },
];

// ---------- Internal provider id table ----------

const PROVIDER_LABELS: Record<string, { zh: string; en: string; icon: string }> = {
  "codex-managed-app-server": { zh: "Codex 运行时", en: "Codex runtime", icon: "cpu" },
  "codex-app-server": { zh: "Codex 外部运行时", en: "Codex external runtime", icon: "cpu" },
  "claude-sdk": { zh: "Claude SDK", en: "Claude SDK", icon: "cpu" },
  "claude-cli": { zh: "Claude CLI", en: "Claude CLI", icon: "terminal" },
  "pi-sdk": { zh: "Pi SDK", en: "Pi SDK", icon: "cpu" },
  "pi-rpc": { zh: "Pi RPC", en: "Pi RPC", icon: "terminal" },
  "mock": { zh: "模拟后端", en: "Mock backend", icon: "flask-conical" },
};

// ---------- Fallback (unknown) ----------

function fallbackPresentation(
  locale: Locale,
  developerMode: boolean,
  rawName?: string,
  rawInput?: string,
): ToolPresentation {
  const userLabel = locale === "zh" ? "正在执行工具" : "Running tool";
  return {
    userLabel,
    icon: "wrench",
    category: "tool",
    group: "system",
    summary: userLabel,
    riskLevel: "low",
    shouldHighlight: false,
    // 普通模式绝不泄露原始名/输入；仅 devMode 保留
    rawName: developerMode ? rawName : undefined,
    rawInput: developerMode ? rawInput : undefined,
    isUnknown: true,
  };
}

// ---------- Main entry points ----------

/**
 * 呈现工具调用（provider 原生工具 或 vault-api ActionType）。
 *
 * 解析顺序：
 * 1. ActionType 精确匹配（避免 tags_list/command_list 被正则误吞）
 * 2. provider 原生工具正则匹配（保留既有英文输出）
 * 3. 安全降级「正在执行工具 / Running tool」
 */
export function presentTool(
  toolName: string,
  toolInput?: string,
  options: PresentationOptions = {},
): ToolPresentation {
  const locale = resolveUiLocale(options.locale);
  const developerMode = options.developerMode === true;
  const lower = toolName.toLowerCase();

  // 1. ActionType 精确匹配
  if (Object.prototype.hasOwnProperty.call(ACTION_LABELS, lower)) {
    const label = ACTION_LABELS[lower as ActionType]!;
    const userLabel = locale === "zh" ? label.zh : label.en;
    return {
      userLabel,
      icon: label.icon,
      category: label.category,
      group: label.group,
      summary: userLabel,
      riskLevel: riskFromAction(lower),
      shouldHighlight: riskFromAction(lower) === "high",
      rawName: developerMode ? toolName : undefined,
      rawInput: developerMode ? toolInput : undefined,
      isUnknown: false,
    };
  }

  // 2. provider 原生工具正则匹配
  const b = extractPathBasename(toolInput);
  for (const rule of PROVIDER_TOOL_RULES) {
    if (rule.test(lower)) {
      const userLabel = locale === "zh" ? rule.zh(b) : rule.en(b);
      return {
        userLabel,
        icon: rule.icon,
        category: rule.category,
        group: rule.group,
        summary: userLabel,
        riskLevel: rule.risk,
        shouldHighlight: rule.risk === "high",
        rawName: developerMode ? toolName : undefined,
        rawInput: developerMode ? toolInput : undefined,
        isUnknown: false,
      };
    }
  }

  // 3. 安全降级
  return fallbackPresentation(locale, developerMode, toolName, toolInput);
}

/**
 * 呈现 vault-api action（带结构化 params，可生成上下文摘要）。
 */
export function presentAction(
  actionType: string,
  params: Record<string, unknown> = {},
  options: PresentationOptions = {},
): ToolPresentation {
  const locale = resolveUiLocale(options.locale);
  const developerMode = options.developerMode === true;
  const lower = actionType.toLowerCase();

  const label = ACTION_LABELS[lower as ActionType];
  if (!label) {
    return fallbackPresentation(locale, developerMode, actionType, undefined);
  }
  const userLabel = locale === "zh" ? label.zh : label.en;
  const risk = riskFromAction(lower);
  return {
    userLabel,
    icon: label.icon,
    category: label.category,
    group: label.group,
    summary: label.summary ? label.summary(params, locale) : userLabel,
    riskLevel: risk,
    shouldHighlight: risk === "high",
    rawName: developerMode ? actionType : undefined,
    rawInput: developerMode ? safeStringifyParams(params) : undefined,
    isUnknown: false,
  };
}

/**
 * 呈现内部 provider id（codex-managed-app-server 等）。
 */
export function presentProvider(
  providerId: string,
  options: PresentationOptions = {},
): ToolPresentation {
  const locale = resolveUiLocale(options.locale);
  const developerMode = options.developerMode === true;
  const entry = PROVIDER_LABELS[providerId];
  if (!entry) {
    return fallbackPresentation(locale, developerMode, providerId, undefined);
  }
  const userLabel = locale === "zh" ? entry.zh : entry.en;
  return {
    userLabel,
    icon: entry.icon,
    category: "system",
    group: "system",
    summary: userLabel,
    riskLevel: "low",
    shouldHighlight: false,
    rawName: developerMode ? providerId : undefined,
    isUnknown: false,
  };
}

/** 统一入口：按 input.kind 分派 */
export function present(input: ToolPresentationInput): ToolPresentation {
  if (input.kind === "action") {
    return presentAction(input.actionType, input.params, input);
  }
  if (input.kind === "provider") {
    return presentProvider(input.providerId, input);
  }
  return presentTool(input.toolName, input.toolInput, input);
}

/** devMode 摘要参数时安全序列化（截断，避免巨大 payload） */
function safeStringifyParams(params: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(params);
    return s.length > 240 ? s.slice(0, 239) + "…" : s;
  } catch {
    return "[params]";
  }
}

// ---------- Backward-compat helpers (供 agentRunDisplayModel / view.ts 委托) ----------

/** 旧 toolDisplayLabel(toolName, toolInput?) → userLabel（en 测试环境保持原输出） */
export function toolLabelLegacy(toolName: string, toolInput?: string, developerMode = false): string {
  return presentTool(toolName, toolInput, { developerMode }).userLabel;
}

/** 旧 getToolIconCategory(toolName) → { icon, category }（精确保留既有 .includes 链，零视觉变更） */
export function toolIconCategoryLegacy(toolName: string): { icon: string; category: string } {
  const name = toolName.toLowerCase();
  if (name.includes("read") || name.includes("list") || name.includes("grep") || name.includes("stat") || name.includes("glob")) {
    return { icon: "file-text", category: "read" };
  }
  if (name.includes("search")) {
    return { icon: "search", category: "search" };
  }
  if (name.includes("write") || name.includes("create") || name.includes("edit") || name.includes("replace") || name.includes("insert") || name.includes("patch")) {
    return { icon: "pencil", category: "write" };
  }
  if (name.includes("delete") || name.includes("remove") || name.includes("rm")) {
    return { icon: "trash-2", category: "delete" };
  }
  if (name.includes("bash") || name.includes("command") || name.includes("execute") || name.includes("run") || name.includes("shell") || name.includes("terminal")) {
    return { icon: "terminal", category: "command" };
  }
  if (name.includes("think") || name.includes("reason")) {
    return { icon: "brain", category: "think" };
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("curl") || name.includes("http") || name.includes("browse")) {
    return { icon: "globe", category: "web" };
  }
  if (name.includes("notify") || name.includes("notice") || name.includes("toast")) {
    return { icon: "bell", category: "notify" };
  }
  return { icon: "settings", category: "tool" };
}

/** 旧 toolToActivity(toolName) → 活动标签（精确保留既有正则与输出） */
export function toolActivityLegacy(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (/read|getfile|file_read|view|cat|grep|glob|search|ls/.test(lower)) return "Reading files";
  if (/write|edit|str_replace|patch|create_file|update_file|insert|delete_file/.test(lower)) return "Editing files";
  if (/bash|execute|run|command|shell|check|test|lint/.test(lower)) return "Running checks";
  return toolName;
}
