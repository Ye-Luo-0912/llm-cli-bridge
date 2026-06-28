// LLM CLI Bridge — Permission Policy (V2.3)
// 权限分级与授权决策纯函数模块
// 不改 AgentEvent v0.1，不新增 tool event，不引入新协议
// 仅在 httpServer runAction 入口决定是否走审批流程

import type { ActionType } from "./actions";

/**
 * 风险等级
 * - low: 读操作，默认允许
 * - medium: Vault 内 Markdown 写入，可本轮授权
 * - high: 删除 / Vault 外访问 / .obsidian / env / shell，默认拒绝
 */
export type PermissionLevel = "low" | "medium" | "high";

/**
 * 授权决策类型
 * - allow_once: 本次允许（不缓存）
 * - allow_session: 本会话允许（缓存到 sessionAllows）
 * - deny_session: 始终拒绝（本会话内不再弹出）
 */
export type PermissionDecision = "allow_once" | "allow_session" | "deny_session";

/**
 * 权限策略（持久化到 settings）
 * - defaultLevel: 默认策略等级，控制 medium 风险操作的默认行为
 *   - "low" = 宽松（medium 操作仅提示不阻塞）
 *   - "medium" = 标准（medium 操作需本轮授权，默认值）
 *   - "high" = 严格（所有 medium 操作视为 high，需显式授权）
 */
export type PermissionPolicy = "low" | "medium" | "high";

/**
 * 会话级授权缓存条目（运行时，不持久化）
 * - actionType: 已授权的 action 类型
 * - pathPattern: 已授权的路径模式（简单前缀匹配，空表示该类型所有路径）
 * - grantedAt: 授权时间
 */
export interface SessionAllow {
  readonly actionType: string;
  readonly pathPattern: string;
  readonly grantedAt: string;
}

/**
 * 会话级拒绝缓存条目（运行时，不持久化）
 */
export interface SessionDeny {
  readonly actionType: string;
  readonly pathPattern: string;
  readonly deniedAt: string;
}

/**
 * 权限决策结果
 */
export interface PermissionCheckResult {
  readonly level: PermissionLevel;
  readonly decision: "auto_allow" | "session_allowed" | "session_denied" | "needs_approval";
  readonly reason: string;
}

// 低风险读操作（无需审批）
const LOW_RISK_ACTIONS: ReadonlySet<string> = new Set([
  "show_notice",
  "open_note",
  "get_state",
  "get_active_note",
  "get_selection",
]);

// 中风险写操作（Vault 内 Markdown，可本轮授权）
const MEDIUM_RISK_ACTIONS: ReadonlySet<string> = new Set([
  "create_note",
  "append_to_note",
  "insert_at_cursor",
  "replace_selection",
]);

/**
 * 判定 action 的风险等级（纯函数）
 *
 * 分级规则：
 * - low: 读操作（LOW_RISK_ACTIONS）
 * - medium: Vault 内 Markdown 写入（MEDIUM_RISK_ACTIONS）
 * - high: 删除 / Vault 外访问 / .obsidian / env / shell（当前 ActionType 无此类，保留扩展）
 *
 * 注：路径安全（isPathUnsafe）由 validateAction 提前拦截，此处不再重复判定。
 *     被 isPathUnsafe 拒绝的操作不会进入本函数。
 *
 * @param actionType action 类型
 * @param _params action 参数（保留用于未来扩展，如根据 path 细化分级）
 * @param _vaultPath Vault 根路径（保留用于未来扩展）
 */
export function classifyActionRisk(
  actionType: string,
  _params?: Record<string, unknown>,
  _vaultPath?: string,
): PermissionLevel {
  if (LOW_RISK_ACTIONS.has(actionType)) return "low";
  if (MEDIUM_RISK_ACTIONS.has(actionType)) return "medium";
  // 未知 action 默认 high（保守）
  return "high";
}

/**
 * 检查会话级授权缓存是否命中（纯函数）
 *
 * 匹配规则：
 * - actionType 必须完全匹配
 * - pathPattern 为空表示该类型所有路径已授权
 * - pathPattern 非空时，params.path 必须以 pathPattern 开头（前缀匹配）
 *
 * @param allows 会话授权缓存
 * @param actionType action 类型
 * @param params action 参数（用于提取 path 做前缀匹配）
 */
export function checkSessionAllow(
  allows: ReadonlyArray<SessionAllow>,
  actionType: string,
  params?: Record<string, unknown>,
): boolean {
  const path = typeof params?.path === "string" ? (params.path as string) : "";
  for (const allow of allows) {
    if (allow.actionType !== actionType) continue;
    if (allow.pathPattern === "") return true; // 该类型所有路径已授权
    if (path && path.startsWith(allow.pathPattern)) return true;
  }
  return false;
}

/**
 * 检查会话级拒绝缓存是否命中（纯函数）
 */
export function checkSessionDeny(
  denies: ReadonlyArray<SessionDeny>,
  actionType: string,
  params?: Record<string, unknown>,
): boolean {
  const path = typeof params?.path === "string" ? (params.path as string) : "";
  for (const deny of denies) {
    if (deny.actionType !== actionType) continue;
    if (deny.pathPattern === "") return true;
    if (path && path.startsWith(deny.pathPattern)) return true;
  }
  return false;
}

/**
 * 综合权限检查（纯函数）
 *
 * 决策流程：
 * 1. classifyActionRisk → level
 * 2. low + (policy != high) → auto_allow
 * 3. high → needs_approval（始终需显式授权，不自动拒绝以保留用户选择权）
 * 4. medium:
 *    - session_denied 命中 → needs_approval（重新询问，不永久拒绝）
 *    - session_allowed 命中 → auto_allow
 *    - 否则 → needs_approval
 *
 * @param actionType action 类型
 * @param params action 参数
 * @param policy 当前权限策略
 * @param allows 会话授权缓存
 * @param denies 会话拒绝缓存
 */
export function checkPermission(
  actionType: string,
  params: Record<string, unknown>,
  policy: PermissionPolicy,
  allows: ReadonlyArray<SessionAllow>,
  denies: ReadonlyArray<SessionDeny>,
): PermissionCheckResult {
  const level = classifyActionRisk(actionType, params);

  // low 风险：默认允许（除非 policy=high 强制严格）
  if (level === "low") {
    if (policy === "high") {
      // 严格模式：low 也需审批
      return { level, decision: "needs_approval", reason: "严格策略：读操作需确认" };
    }
    return { level, decision: "auto_allow", reason: "低风险读操作" };
  }

  // high 风险：始终需显式授权
  if (level === "high") {
    return { level, decision: "needs_approval", reason: "高风险操作需显式授权" };
  }

  // medium 风险
  // policy=low：宽松模式，medium 自动允许
  if (policy === "low") {
    return { level, decision: "auto_allow", reason: "宽松策略：medium 自动允许" };
  }

  // 检查会话缓存
  if (checkSessionDeny(denies, actionType, params)) {
    return { level, decision: "needs_approval", reason: "本会话曾拒绝，重新询问" };
  }
  if (checkSessionAllow(allows, actionType, params)) {
    return { level, decision: "session_allowed", reason: "本会话已授权" };
  }

  return { level, decision: "needs_approval", reason: "medium 风险需本轮授权" };
}

/**
 * 构造会话授权条目（纯函数）
 */
export function createSessionAllow(actionType: string, pathPattern: string): SessionAllow {
  return {
    actionType,
    pathPattern,
    grantedAt: new Date().toISOString(),
  };
}

/**
 * 构造会话拒绝条目（纯函数）
 */
export function createSessionDeny(actionType: string, pathPattern: string): SessionDeny {
  return {
    actionType,
    pathPattern,
    deniedAt: new Date().toISOString(),
  };
}

/**
 * 从 action params 提取路径前缀用于会话授权
 *
 * 规则：
 * - 有 path 参数：取 path 的目录部分（最后 / 前）作为前缀，授权同目录下所有文件
 * - 无 path 参数：pathPattern 为空，授权该类型所有实例
 */
export function extractPathPattern(actionType: string, params: Record<string, unknown>): string {
  const path = typeof params.path === "string" ? (params.path as string) : "";
  if (!path) return "";
  const slash = path.lastIndexOf("/");
  if (slash <= 0) return ""; // 根目录文件，授权该类型所有
  return path.slice(0, slash + 1);
}

/**
 * 权限策略标签（UI 显示用）
 */
export function permissionPolicyLabel(policy: PermissionPolicy): string {
  switch (policy) {
    case "low": return "宽松";
    case "medium": return "标准";
    case "high": return "严格";
    default: return String(policy);
  }
}

/**
 * 风险等级标签（UI 显示用）
 */
export function permissionLevelLabel(level: PermissionLevel): string {
  switch (level) {
    case "low": return "低";
    case "medium": return "中";
    case "high": return "高";
    default: return String(level);
  }
}
