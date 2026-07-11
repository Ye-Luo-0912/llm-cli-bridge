// LLM CLI Bridge — Session Persistence (V2.5)
// 将会话状态与消息持久化到 .llm-bridge/sessions/，支持历史会话列表与恢复
// 安全写入（tmp+rename）；失败不阻断主流程；不保存 secret 明文
//
// 设计原则：
// - 不改 AgentEvent v0.1，不新增 tool event
// - CLI/auto 主线不受影响（仅在 view 层调用，运行后/手动触发时保存）
// - session 文件含 version 字段，便于后续迁移
// - 不与 Claude SDK/CLI 会话直连；Continue/Resume 仅作为 UI 本地历史恢复

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ChatMessage, RunStatus } from "./types";
import { redactSecrets } from "./workflowEvent";
import { SessionState } from "./session";
import type { NativeSessionRef } from "./runtime/core/types";

/**
 * 校验 session id：防止 path traversal / 控制字符 / 空值进入文件路径。
 * session id 直接拼入 `${sessionId}.json`，必须保证不含路径分隔符、`..`、盘符等危险字符。
 */
function validateSessionId(sessionId: string): string {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("Invalid session id: must be a non-empty string");
  }
  if (/[\r\n\t\0]/.test(sessionId)) {
    throw new Error("Invalid session id: contains control characters");
  }
  if (sessionId.includes("..") || /[\/\\]/.test(sessionId) || /^[A-Za-z]:/.test(sessionId)) {
    throw new Error("Invalid session id: path traversal characters are not allowed");
  }
  // Verify the final path stays within the sessions directory
  return sessionId;
}

/**
 * 防御性路径包含检查：确认最终文件路径仍在 sessions 目录内。
 * 若 path.relative 返回值以 `..` 开头，说明路径逃逸出目录。
 */
function assertPathWithinSessionsDir(dirPath: string, fullPath: string): void {
  const rel = path.relative(dirPath, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid session id: resolved path escapes sessions directory");
  }
}

/** sessions 目录相对 Vault 根的路径 */
export const SESSIONS_DIR_REL = ".llm-bridge/sessions";

/**
 * 统一解析 session 文件路径：所有 save/load/delete/rename 必须走此函数。
 * 先校验 sessionId（拒绝 `..`、斜杠、绝对路径、控制字符），
 * 再拼路径并断言最终路径仍在 sessions 目录内。
 */
function resolveSessionFilePath(vaultPath: string, sessionId: string): string {
  const safeId = validateSessionId(sessionId);
  const dirPath = path.join(vaultPath, SESSIONS_DIR_REL);
  const filePath = path.join(dirPath, `${safeId}.json`);
  assertPathWithinSessionsDir(dirPath, filePath);
  return filePath;
}

/** 统一解析 sessions 目录路径 */
function resolveSessionsDir(vaultPath: string): string {
  return path.join(vaultPath, SESSIONS_DIR_REL);
}

/** session 文件 schema 版本（升级时递增，配合迁移逻辑） */
export const SESSION_SCHEMA_VERSION = 2;

/** 历史会话列表上限（超过时按 savedAt 升序淘汰最旧；防止目录膨胀） */
export const MAX_SESSIONS_KEPT = 50;

/**
 * 持久化的会话（写入 .llm-bridge/sessions/<id>.json）
 * - version: schema 版本，便于后续迁移
 * - id: 会话唯一 id（与文件名一致，不含扩展名）
 * - messages: 完整消息列表（含 workflow trace / sdk events / generated files）
 * - 不保存 secret 明文（content/stderr/log 走 redactSecrets）
 */
export interface PersistedSession {
  version: number;
  id: string;
  title: string;
  status: RunStatus;
  messageCount: number;
  startedAt: string | null;
  savedAt: string;
  agentType: string;
  messages: ChatMessage[];
  // V2.16-D: 运行时状态持久化（v2 新增，可选字段；v1 文件迁移时填充默认值）
  /** Legacy working set refs（兼容旧 session 文件；新版本优先使用 pinnedContextRefs） */
  workingSetRefs?: unknown[];
  /** V2.16-E: 只有用户显式 Pin 的 context 跨轮恢复 */
  pinnedContextRefs?: unknown[];
  /** 会话模式 fresh/continue/resume */
  sessionMode?: string;
  /** 模型 id */
  model?: string;
  /** effort level */
  effortLevel?: string;
  /** backend 模式 auto/cli/sdk/mock */
  backendMode?: string;
  /** SDK 权限模式（legacy；新会话优先 approvalProfile） */
  permissionMode?: string;
  /** provider-neutral 审批画像 ask/auto/full-access */
  approvalProfile?: string;
  // latest native session only: 该会话绑定的 native session 引用
  // 用于判断历史恢复是否允许 native continuation
  nativeSessionRef?: NativeSessionRef;
  // Legacy: provider session persistence（旧格式，读取兼容，不再用于 resume）
  /** provider 侧 thread id（codex app-server threadId；legacy，不再用于 resume） */
  providerThreadId?: string;
  /** provider 侧 session id（codex app-server sessionId；legacy，不再用于 resume） */
  providerSessionId?: string;
}

/**
 * 会话列表项（轻量，不含 messages，用于历史列表展示）
 */
export interface SessionListItem {
  id: string;
  title: string;
  status: RunStatus;
  messageCount: number;
  startedAt: string | null;
  savedAt: string;
  agentType: string;
  /** 首条用户请求摘要，用于最近会话下拉辨识 */
  firstUserSummary: string;
  /** 最后一条 assistant 回复摘要，用于最近会话下拉辨识 */
  lastAssistantSummary: string;
  /** 文件大小（字节，用于 UI 提示） */
  sizeBytes: number;
}

export interface SessionDeleteResult {
  bridgeSessionDeleted: boolean;
  codexSessionFilesDeleted: number;
  codexSessionIndexEntriesDeleted: number;
  providerIds: string[];
}

export interface SessionsClearResult {
  bridgeSessionsDeleted: number;
  codexSessionFilesDeleted: number;
  codexSessionIndexEntriesDeleted: number;
  providerIds: string[];
}

/**
 * V2.16-D: 会话运行时状态快照（保存时由 view 传入，恢复时还原）
 * 这些字段可选；不传时 session 文件不记录对应状态
 */
export interface SessionExtras {
  workingSetRefs?: unknown[];
  pinnedContextRefs?: unknown[];
  sessionMode?: string;
  model?: string;
  effortLevel?: string;
  backendMode?: string;
  permissionMode?: string;
  approvalProfile?: string;
  // latest native session only: 该会话绑定的 native session 引用
  nativeSessionRef?: NativeSessionRef;
}

/**
 * 生成会话 id（时间戳 + 短随机，文件名安全）
 */
export function generateSessionId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `s-${ts}-${rand}`;
}

function summarizeSessionText(value: unknown, maxLen = 96): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function extractSessionSummaries(messages: unknown): { firstUserSummary: string; lastAssistantSummary: string } {
  if (!Array.isArray(messages)) return { firstUserSummary: "", lastAssistantSummary: "" };
  const firstUser = messages.find((msg) => msg && typeof msg === "object" && (msg as { role?: unknown }).role === "user") as { content?: unknown } | undefined;
  const assistantMessages = messages.filter((msg) => msg && typeof msg === "object" && (msg as { role?: unknown }).role === "assistant") as Array<{ content?: unknown }>;
  const lastAssistant = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : undefined;
  return {
    firstUserSummary: summarizeSessionText(firstUser?.content),
    lastAssistantSummary: summarizeSessionText(lastAssistant?.content),
  };
}

/**
 * 脱敏会话消息（content / stderr / log 走 redactSecrets）
 * 返回新数组，原消息不变
 */
export function redactSessionMessages(messages: ReadonlyArray<ChatMessage>): ChatMessage[] {
  return messages.map((m) => ({
    ...m,
    content: redactSecrets(m.content),
    stderr: redactSecrets(m.stderr),
    log: redactSecrets(m.log),
    // V2.11.1: defense-in-depth 脱敏嵌套字段（timeline/workflowTrace/sdkEvents/commandPreview）
    // 这些字段可能含 stdout/stderr 片段或工具输入输出，需二次脱敏防止 secret 进入 session 文件
    timeline: m.timeline ? m.timeline.map((e) => ({ ...e, detail: redactSecrets(e.detail) })) : undefined,
    timelineEvents: m.timelineEvents ? m.timelineEvents.map((e) => ({ ...e, detail: redactSecrets(e.detail) })) : undefined,
    commandPreview: m.commandPreview ? m.commandPreview.map((r) => ({ ...r, value: redactSecrets(r.value) })) : undefined,
    workflowTrace: m.workflowTrace ? m.workflowTrace.map((e) => ({ ...e, detail: redactSecrets(e.detail) })) : undefined,
    workflowEvents: m.workflowEvents ? m.workflowEvents.map((e) => ({ ...e, detail: redactSecrets(e.detail) })) : undefined,
    sdkEvents: m.sdkEvents ? m.sdkEvents.map(redactSdkEventForSession) : undefined,
  }));
}

/**
 * V2.11.1: 脱敏单个 SDK 事件的字符串字段（defense-in-depth）
 * 处理 WorkflowEvent 联合类型的各种 string 字段，返回新事件对象
 */
function redactSdkEventForSession(event: import("./workflowEvent").WorkflowEvent): import("./workflowEvent").WorkflowEvent {
  switch (event.type) {
    case "thinking":
      return { ...event, text: redactSecrets(event.text) };
    case "message":
      return { ...event, text: redactSecrets(event.text) };
    case "tool_start":
      return { ...event, toolInput: redactSecrets(event.toolInput) };
    case "tool_result":
      return { ...event, output: redactSecrets(event.output) };
    case "file_change":
      return event; // path 不含 secret，原样返回
    case "permission":
      return {
        ...event,
        description: redactSecrets(event.description),
        inputSummary: event.inputSummary ? redactSecrets(event.inputSummary) : event.inputSummary,
        riskReason: event.riskReason ? redactSecrets(event.riskReason) : event.riskReason,
        subagentRisk: event.subagentRisk ? redactSecrets(event.subagentRisk) : event.subagentRisk,
      };
    case "error":
      return { ...event, message: redactSecrets(event.message) };
    case "completed":
      return { ...event, text: redactSecrets(event.text) };
    case "failed":
      return { ...event, message: redactSecrets(event.message) };
    default:
      return event;
  }
}

/**
 * 保存会话到 .llm-bridge/sessions/<id>.json
 * - 使用 tmp + rename 原子写入（避免半写入文件）
 * - 失败不抛异常，返回 false
 * - 超过 MAX_SESSIONS_KEPT 时按 savedAt 升序淘汰最旧会话
 * @returns true 表示保存成功
 */
export async function saveSession(
  vaultPath: string,
  state: SessionState,
  messages: ReadonlyArray<ChatMessage>,
  agentType: string,
  sessionId?: string,
  extras?: SessionExtras,
): Promise<string | null> {
  try {
    const dirPath = resolveSessionsDir(vaultPath);
    await fs.promises.mkdir(dirPath, { recursive: true });
    const id = sessionId ? validateSessionId(sessionId) : generateSessionId();
    const filePath = resolveSessionFilePath(vaultPath, id);
    const fileName = `${id}.json`;
    const tmpPath = path.join(dirPath, `${fileName}.tmp`);

    const session: PersistedSession = {
      version: SESSION_SCHEMA_VERSION,
      id,
      title: state.title,
      status: state.status,
      messageCount: state.messageCount,
      startedAt: state.startedAt,
      savedAt: new Date().toISOString(),
      agentType,
      messages: redactSessionMessages(messages),
      // V2.16-D: 运行时状态快照（可选；存在则恢复时还原）
      ...(extras?.workingSetRefs ? { workingSetRefs: extras.workingSetRefs } : {}),
      ...(extras?.pinnedContextRefs ? { pinnedContextRefs: extras.pinnedContextRefs } : {}),
      ...(extras?.sessionMode ? { sessionMode: extras.sessionMode } : {}),
      ...(extras?.model ? { model: extras.model } : {}),
      ...(extras?.effortLevel ? { effortLevel: extras.effortLevel } : {}),
      ...(extras?.backendMode ? { backendMode: extras.backendMode } : {}),
      ...(extras?.permissionMode ? { permissionMode: extras.permissionMode } : {}),
      ...(extras?.approvalProfile ? { approvalProfile: extras.approvalProfile } : {}),
      // latest native session only: native session 引用（用于判断历史恢复是否允许 continuation）
      ...(extras?.nativeSessionRef ? { nativeSessionRef: extras.nativeSessionRef } : {}),
    };

    // 原子写：tmp + rename
    await fs.promises.writeFile(tmpPath, JSON.stringify(session, null, 2), "utf8");
    await fs.promises.rename(tmpPath, filePath);

    // 淘汰过旧会话（保持目录不超过 MAX_SESSIONS_KEPT）
    try {
      await pruneOldSessions(vaultPath);
    } catch {
      // 淘汰失败不阻断保存
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * 列出所有历史会话（按 savedAt 降序，最新在前）
 * - 只读取元数据（不解析 messages）
 * - 解析失败的文件跳过（不影响其他会话展示）
 */
export async function listSessions(vaultPath: string): Promise<SessionListItem[]> {
  const dirPath = resolveSessionsDir(vaultPath);
  let files: string[];
  try {
    files = await fs.promises.readdir(dirPath);
  } catch {
    return []; // 目录不存在
  }
  const items: SessionListItem[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    // id 以文件名为准（basename 去扩展名），不信任 JSON 内部的 parsed.id
    const fileId = path.basename(file, ".json");
    // 文件名本身也要通过校验，防止异常文件名进入后续删除路径
    try {
      validateSessionId(fileId);
    } catch {
      continue;
    }
    const filePath = path.join(dirPath, file);
    assertPathWithinSessionsDir(dirPath, filePath);
    try {
      const stat = await fs.promises.stat(filePath);
      const content = await fs.promises.readFile(filePath, "utf8");
      const parsed = JSON.parse(content) as Partial<PersistedSession>;
      // 基本字段校验：JSON 内部 id 必须与文件名一致，否则跳过（防止被篡改的 JSON 注入危险 id）
      if (!parsed.id || typeof parsed.messageCount !== "number") continue;
      if (parsed.id !== fileId) continue;
      const summaries = extractSessionSummaries(parsed.messages);
      items.push({
        id: fileId,
        title: parsed.title || "新会话",
        status: parsed.status || "idle",
        messageCount: parsed.messageCount,
        startedAt: parsed.startedAt || null,
        savedAt: parsed.savedAt || new Date(stat.mtimeMs).toISOString(),
        agentType: parsed.agentType || "claude",
        firstUserSummary: summaries.firstUserSummary,
        lastAssistantSummary: summaries.lastAssistantSummary,
        sizeBytes: stat.size,
      });
    } catch {
      // 单个文件解析失败，跳过
    }
  }
  // 按 savedAt 降序（最新在前）
  items.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return items;
}

/**
 * 加载单个会话完整内容
 * @returns 会话对象，不存在或解析失败返回 null
 */
export async function loadSession(vaultPath: string, sessionId: string): Promise<PersistedSession | null> {
  try {
    const filePath = resolveSessionFilePath(vaultPath, sessionId);
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return migrateSession(parsed);
  } catch {
    return null;
  }
}

/**
 * V2.7: session schema 迁移框架
 * - 根据文件 version 字段执行迁移到当前 SESSION_SCHEMA_VERSION
 * - 当前只有 v1，未来 v2 在此添加迁移步骤（字段重命名/结构变更）
 * - 高版本文件保守返回 null（不强行降级）
 * - 字段缺失/类型错误返回 null
 */
export function migrateSession(parsed: unknown): PersistedSession | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.version !== "number") return null;
  // 高版本不降级
  if (p.version > SESSION_SCHEMA_VERSION) return null;
  // V2.16-D: v1 → v2 迁移（运行时状态字段为可选，v1 文件无需补字段；读取时按需提供默认值）
  // 迁移后必需字段校验
  if (typeof p.id !== "string" || !p.id) return null;
  if (!Array.isArray(p.messages)) return null;
  if (typeof p.messageCount !== "number") return null;
  return {
    version: SESSION_SCHEMA_VERSION,
    id: p.id,
    title: typeof p.title === "string" ? p.title : "新会话",
    status: (typeof p.status === "string" ? p.status : "idle") as RunStatus,
    messageCount: p.messageCount,
    startedAt: typeof p.startedAt === "string" ? p.startedAt : null,
    savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date().toISOString(),
    agentType: typeof p.agentType === "string" ? p.agentType : "claude",
    messages: p.messages as ChatMessage[],
    // V2.16-D: 可选运行时状态字段（v1 文件无此字段，留空；恢复时若缺失则保留当前设置）
    ...(Array.isArray(p.workingSetRefs) ? { workingSetRefs: p.workingSetRefs } : {}),
    ...(Array.isArray(p.pinnedContextRefs) ? { pinnedContextRefs: p.pinnedContextRefs } : {}),
    ...(typeof p.sessionMode === "string" ? { sessionMode: p.sessionMode } : {}),
    ...(typeof p.model === "string" ? { model: p.model } : {}),
    ...(typeof p.effortLevel === "string" ? { effortLevel: p.effortLevel } : {}),
    ...(typeof p.backendMode === "string" ? { backendMode: p.backendMode } : {}),
    ...(typeof p.permissionMode === "string" ? { permissionMode: p.permissionMode } : {}),
    ...(typeof p.approvalProfile === "string" ? { approvalProfile: p.approvalProfile } : {}),
    // Legacy: provider session persistence（旧格式兼容读取）
    ...(typeof p.providerThreadId === "string" ? { providerThreadId: p.providerThreadId } : {}),
    ...(typeof p.providerSessionId === "string" ? { providerSessionId: p.providerSessionId } : {}),
    // latest native session only: native session 引用
    ...(p.nativeSessionRef ? { nativeSessionRef: p.nativeSessionRef as NativeSessionRef } : {}),
  };
}

/**
 * 删除单个历史会话
 * @returns true 表示删除成功
 */
export async function deleteSession(vaultPath: string, sessionId: string): Promise<boolean> {
  try {
    const filePath = resolveSessionFilePath(vaultPath, sessionId);
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSessionWithProviderArtifacts(vaultPath: string, sessionId: string): Promise<SessionDeleteResult> {
  validateSessionId(sessionId);
  const session = await loadSession(vaultPath, sessionId);
  const providerIds = providerIdsFromSession(session);
  const bridgeSessionDeleted = await deleteSession(vaultPath, sessionId);
  const codexSessionFilesDeleted = await deleteCodexSessionFilesByProviderIds(providerIds);
  const codexSessionIndexEntriesDeleted = await deleteCodexSessionIndexEntriesByProviderIds(providerIds);
  return { bridgeSessionDeleted, codexSessionFilesDeleted, codexSessionIndexEntriesDeleted, providerIds };
}

export async function clearSessionsWithProviderArtifacts(vaultPath: string): Promise<SessionsClearResult> {
  const dirPath = resolveSessionsDir(vaultPath);
  let files: string[] = [];
  try {
    files = await fs.promises.readdir(dirPath);
  } catch {
    return { bridgeSessionsDeleted: 0, codexSessionFilesDeleted: 0, codexSessionIndexEntriesDeleted: 0, providerIds: [] };
  }

  const providerIds = new Set<string>();
  const sessionFiles = files.filter((file) => file.endsWith(".json"));
  for (const file of sessionFiles) {
    try {
      const session = await loadSession(vaultPath, path.basename(file, ".json"));
      for (const id of providerIdsFromSession(session)) providerIds.add(id);
    } catch {
      // Bad session files are still removed below; they just cannot contribute a provider mapping.
    }
  }

  let bridgeSessionsDeleted = 0;
  for (const file of sessionFiles) {
    try {
      const filePath = path.join(dirPath, file);
      assertPathWithinSessionsDir(dirPath, filePath);
      await fs.promises.unlink(filePath);
      bridgeSessionsDeleted += 1;
    } catch {
      // Continue clearing the rest of the local session store.
    }
  }

  const providerIdList = Array.from(providerIds);
  const codexSessionFilesDeleted = await deleteCodexSessionFilesByProviderIds(providerIdList);
  const codexSessionIndexEntriesDeleted = await deleteCodexSessionIndexEntriesByProviderIds(providerIdList);
  return { bridgeSessionsDeleted, codexSessionFilesDeleted, codexSessionIndexEntriesDeleted, providerIds: providerIdList };
}

/**
 * V2.8: 重命名历史会话标题（原子写，失败返回 false）
 * 仅修改 title 与 savedAt，保留其他字段不变
 */
export async function renameSession(vaultPath: string, sessionId: string, newTitle: string): Promise<boolean> {
  try {
    validateSessionId(sessionId);
    const session = await loadSession(vaultPath, sessionId);
    if (!session) return false;
    const renamed: PersistedSession = {
      ...session,
      title: newTitle,
      savedAt: new Date().toISOString(),
    };
    const dirPath = resolveSessionsDir(vaultPath);
    const filePath = resolveSessionFilePath(vaultPath, sessionId);
    const tmpPath = path.join(dirPath, `${sessionId}.json.tmp`);
    assertPathWithinSessionsDir(dirPath, tmpPath);
    await fs.promises.writeFile(tmpPath, JSON.stringify(renamed, null, 2), "utf8");
    await fs.promises.rename(tmpPath, filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 内部：淘汰最旧会话，保持目录不超过 MAX_SESSIONS_KEPT
 * 按 savedAt 升序删除最旧的若干个
 */
async function pruneOldSessions(vaultPath: string): Promise<void> {
  const items = await listSessions(vaultPath);
  if (items.length <= MAX_SESSIONS_KEPT) return;
  // items 已按 savedAt 降序，最旧的在末尾
  const toRemove = items.slice(MAX_SESSIONS_KEPT);
  for (const item of toRemove) {
    try {
      const filePath = resolveSessionFilePath(vaultPath, item.id);
      await fs.promises.unlink(filePath);
    } catch {
      // 单个删除失败不阻断
    }
  }
}

function providerIdsFromSession(session: PersistedSession | null): string[] {
  if (!session) return [];
  // 优先用 nativeSessionRef（新格式），兼容旧 providerThreadId/providerSessionId
  const ids = [
    session.nativeSessionRef?.threadId,
    session.nativeSessionRef?.sessionId,
    session.providerThreadId,
    session.providerSessionId,
  ].filter((value): value is string => typeof value === "string" && isSafeProviderSessionId(value));
  return Array.from(new Set(ids));
}

function isSafeProviderSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(value);
}

function resolveCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), ".codex");
}

async function deleteCodexSessionFilesByProviderIds(providerIds: string[]): Promise<number> {
  const safeIds = Array.from(new Set(providerIds.filter(isSafeProviderSessionId)));
  if (safeIds.length === 0) return 0;
  const sessionsDir = path.join(resolveCodexHome(), "sessions");
  let candidates: string[] = [];
  try {
    candidates = await collectFilesRecursive(sessionsDir, ".jsonl");
  } catch {
    return 0;
  }

  let deleted = 0;
  for (const filePath of candidates) {
    const fileName = path.basename(filePath);
    const nameMatches = safeIds.some((id) => fileName.includes(id));
    const contentMatches = nameMatches ? false : await codexSessionFileContainsProviderId(filePath, safeIds);
    if (!nameMatches && !contentMatches) continue;
    try {
      await fs.promises.unlink(filePath);
      deleted += 1;
    } catch {
      // Ignore individual native session cleanup failures; Bridge session deletion remains authoritative.
    }
  }
  return deleted;
}

async function deleteCodexSessionIndexEntriesByProviderIds(providerIds: string[]): Promise<number> {
  const safeIds = Array.from(new Set(providerIds.filter(isSafeProviderSessionId)));
  if (safeIds.length === 0) return 0;
  const indexPath = path.join(resolveCodexHome(), "session_index.jsonl");
  let raw: string;
  try {
    raw = await fs.promises.readFile(indexPath, "utf8");
  } catch {
    return 0;
  }

  const endsWithNewline = raw.endsWith("\n") || raw.endsWith("\r\n");
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const kept: string[] = [];
  let removed = 0;
  for (const line of lines) {
    if (safeIds.some((id) => line.includes(id))) {
      removed += 1;
    } else {
      kept.push(line);
    }
  }
  if (removed === 0) return 0;

  const nextRaw = kept.join("\n") + (kept.length > 0 && endsWithNewline ? "\n" : "");
  const tmpPath = `${indexPath}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, nextRaw, "utf8");
    await fs.promises.rename(tmpPath, indexPath);
  } catch {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // Ignore cleanup failures for a temporary index rewrite file.
    }
    return 0;
  }
  return removed;
}

async function collectFilesRecursive(root: string, extension: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

async function codexSessionFileContainsProviderId(filePath: string, providerIds: string[]): Promise<boolean> {
  try {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const head = buffer.toString("utf8", 0, bytesRead);
      return providerIds.some((id) => head.includes(id));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}
