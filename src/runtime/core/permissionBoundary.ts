// LLM CLI Bridge — PermissionBoundary 实现 (V2.17-A Completion)
//
// 会话级权限边界：聚合 permissionMode + permissionPolicy + 会话级 allow/deny 缓存 +
// pending approvals。取代 view.ts 中分散的 pendingPermissions Map 与
// SdkBackend.resolvePermission 调用。
//
// 决策流程（provider 调用 requestApproval）：
// 1. 先查会话级 allow 缓存（按 toolName + riskLevel + pathPattern）
// 2. 再按 permissionMode 自动决策（bypassPermissions/dontAsk 全 allow；plan 全 deny；
//    acceptEdits low/medium allow；auto/default low allow）
// 3. 其余进入 pending，等待 UI 调用 resolveApproval
//
// Provider 在 requestApproval 返回 "pending" 后，调用 waitForApproval(requestId)
// 挂起当前事件产出，直到 UI resolveApproval / cancelAllPending 唤醒。
//
// cancelAllPending 在 stop/新会话时调用，返回被取消的 requestId+providerContext 列表
// 供 provider 回传 deny 给底层 runtime。

import type { ClaudePermissionMode, PermissionPolicy } from "../../types";
import type {
  ApprovalRequest,
  ApprovalResponse,
  PermissionBoundary,
  SessionAllowEntry,
  SessionDenyEntry,
} from "./types";
import {
  decideByMode,
  checkSessionAllow,
  extractToolPathPattern,
} from "../../sdkPermission";

/**
 * PermissionBoundary 实现（带 provider 私有的 waitForApproval 方法）。
 *
 * UI 通过 PermissionBoundary 接口观察 pending / 提交 resolveApproval；
 * provider 通过 PermissionBoundaryImpl.waitForApproval 等待决策。
 */
export class PermissionBoundaryImpl implements PermissionBoundary {
  readonly mode: ClaudePermissionMode;
  readonly policy: PermissionPolicy;
  private readonly pendingMap = new Map<string, ApprovalRequest>();
  private readonly allowsList: SessionAllowEntry[] = [];
  private readonly deniesList: SessionDenyEntry[] = [];
  private readonly resolvers = new Map<string, (r: { response: ApprovalResponse; source: "user" | "session_allow" | "session_deny" | "mode" }) => void>();
  /**
   * V16.5-C: resolvedMap — 记录已 resolve 的 response/source，供 late waiter replay。
   *
   * 场景：provider 调用 requestApproval 后未立即调用 waitForApproval（如先处理其他
   * 事件），UI 在此期间 resolveApprovalDetailed。若 resolver 缺失，旧实现只能丢弃
   * response；late waiter 调用 waitForApproval 时会拿到 cancel，导致 provider 误以为
   * 用户取消。resolvedMap 缓存真实 response，waitForApproval 命中时返回真实决策。
   */
  private readonly resolvedMap = new Map<string, { response: ApprovalResponse; source: "user" | "session_allow" | "session_deny" | "mode" }>();

  constructor(mode: ClaudePermissionMode, policy: PermissionPolicy) {
    this.mode = mode;
    this.policy = policy;
  }

  get pending(): ReadonlyMap<string, ApprovalRequest> { return this.pendingMap; }
  get sessionAllows(): ReadonlyArray<SessionAllowEntry> { return this.allowsList; }
  get sessionDenies(): ReadonlyArray<SessionDenyEntry> { return this.deniesList; }

  requestApproval(req: ApprovalRequest): "pending" | "auto-allow" | "auto-deny" {
    const riskAssessment = {
      level: req.riskLevel,
      highRiskFlags: req.highRiskFlags ?? [],
      reason: req.riskReason ?? "",
    };
    // V16.4-F2: 先按 mergeKey 检查会话级 allow/deny 缓存。
    // resolveApproval 时 acceptForSession/decline 把 mergeKey 写入 pathPattern；
    // checkSessionAllow 用空 input 提取 pathPattern 无法命中 mergeKey，故此处显式匹配。
    if (req.mergeKey) {
      for (const allow of this.allowsList) {
        if (allow.toolName === req.toolName
          && allow.riskLevel === req.riskLevel
          && allow.pathPattern === req.mergeKey) {
          return "auto-allow";
        }
      }
      for (const deny of this.deniesList) {
        if (deny.toolName === req.toolName
          && deny.riskLevel === req.riskLevel
          && deny.pathPattern === req.mergeKey) {
          return "auto-deny";
        }
      }
    }
    // 1. 查会话级 allow 缓存（pathPattern 前缀匹配）
    if (checkSessionAllow(this.allowsList, req.toolName, riskAssessment, {})) {
      return "auto-allow";
    }
    // 2. 按 permissionMode 自动决策
    const decision = decideByMode(this.mode, riskAssessment);
    if (decision.behavior === "allow") {
      return "auto-allow";
    }
    if (decision.behavior === "deny") {
      return "auto-deny";
    }
    // 3. behavior === "ask"：进入 pending
    this.pendingMap.set(req.requestId, req);
    return "pending";
  }

  resolveApproval(requestId: string, response: ApprovalResponse): boolean {
    return this.resolveApprovalDetailed(requestId, response).ok;
  }

  /**
   * V16.5-B: 带原因的 resolveApproval。
   *
   * 返回 { ok, reason }，UI 可据此显示 stale/error 状态：
   * - not_found: requestId 不在 pendingMap（可能从未进入 pending，或已被另一路径解析）
   * - already_resolved: resolver 已被消费（requestId 在 pendingMap 但 resolver 缺失）
   * - session_mismatch: 保留接口位（当前未启用 sessionId 校验，留作未来扩展）
   * - cancelled: 保留接口位（cancelAllPending 后 requestId 已从 pendingMap 删除）
   *
   * 不破坏原 resolveApproval 接口；UI 可直接调用此方法获取详细原因。
   */
  resolveApprovalDetailed(requestId: string, response: ApprovalResponse): { ok: boolean; reason?: "not_found" | "already_resolved" | "session_mismatch" | "cancelled" } {
    const req = this.pendingMap.get(requestId);
    if (!req) {
      // V16.5-B: 区分 not_found vs cancelled — cancelled 的 requestId 不再在 pendingMap
      // 但 UI 仍可能持有引用。当前无独立 cancelled 集合，统一返回 not_found
      // （UI 看到此结果即认为 stale，不再静默失败）。
      return { ok: false, reason: "not_found" };
    }
    this.pendingMap.delete(requestId);

    // 更新会话级缓存：直接构造 SessionAllowEntry/SessionDenyEntry（此处无解析后的 tool
    // input record，pathPattern 退化为通配；真实 pathPattern 由 provider 在 requestApproval
    // 时通过 mergeKey 携带）
    // V16.4-G: decline 只拒绝本次不写 deniesList；declineForSession 才写会话级 deny 缓存。
    const pathPattern = req.mergeKey ?? extractToolPathPattern({});
    const now = new Date().toISOString();
    if (response.type === "acceptForSession") {
      this.allowsList.push({
        toolName: req.toolName,
        riskLevel: req.riskLevel,
        pathPattern,
        grantedAt: now,
      });
    } else if (response.type === "declineForSession") {
      this.deniesList.push({
        toolName: req.toolName,
        riskLevel: req.riskLevel,
        pathPattern,
        deniedAt: now,
      });
    }

    // 唤醒 provider 等待的 resolver
    const resolver = this.resolvers.get(requestId);
    const source = response.type === "acceptForSession" ? "session_allow"
      : response.type === "declineForSession" ? "session_deny"
      : "user";
    if (resolver) {
      this.resolvers.delete(requestId);
      resolver({ response, source });
    } else {
      // V16.5-C: resolver 缺失 — provider 尚未调用 waitForApproval（late waiter）。
      // 缓存 response/source 到 resolvedMap，waitForApproval 命中时返回真实决策而非 cancel。
      this.resolvedMap.set(requestId, { response, source });
    }
    // V16.5-B: 若 resolver 不存在但 pendingMap 有 entry，说明 provider 未调用 waitForApproval
    // 或已被另一路径消费 — 仍视为 ok（pending 已清除），但记录原因供 UI 诊断。
    return { ok: true };
  }

  /**
   * P4: 重置会话级 allow/deny 缓存（新会话时调用，避免跨会话泄漏）。
   *
   * cancelAllPending 只清空 pendingMap；allowsList/deniesList 需由此方法清空。
   * 正常流程下 doNewSession 会置空整个 BridgeSession（创建新 PermissionBoundary），
   * 此方法作为保险措施，供 session 复用场景使用。
   */
  resetSessionCache(): void {
    this.allowsList.length = 0;
    this.deniesList.length = 0;
    // V16.5-C: 清理 resolvedMap，避免跨会话泄漏 late waiter replay 数据。
    this.resolvedMap.clear();
  }

  cancelAllPending(): ReadonlyArray<{ requestId: string; providerContext: unknown }> {
    const cancelled: Array<{ requestId: string; providerContext: unknown }> = [];
    for (const [id, req] of this.pendingMap) {
      cancelled.push({ requestId: id, providerContext: req.providerContext });
      const resolver = this.resolvers.get(id);
      if (resolver) {
        this.resolvers.delete(id);
        resolver({ response: { type: "cancel" }, source: "user" });
      }
    }
    this.pendingMap.clear();
    // V16.5-C: 清理 resolvedMap — cancelAllPending 后 late waiter replay 无意义，
    // 调用方应拿到 cancel。注意：仅清理 pendingMap 中存在的 requestId 对应的 resolved
    // entry（避免误清仍可能被其他路径 replay 的条目；当前实现简化为全清，因 cancelAllPending
    // 语义是停止整个 run，所有 late waiter 都应拿到 cancel）。
    this.resolvedMap.clear();
    return cancelled;
  }

  /**
   * Provider 在 requestApproval 返回 "pending" 后调用，挂起当前事件产出直到 UI 决策。
   *
   * 返回决策结果（response + source）。cancelAllPending 时返回 { type: "cancel" }。
   *
   * V16.5-B: 若 requestId 不在 pendingMap（已 cancelAllPending 或从未进入 pending），
   * 立即返回 { type: "cancel" }，避免 provider 永远 pending。
   *
   * V16.5-C: 先查 resolvedMap — 若 UI 在 provider 调用 waitForApproval 前已 resolve
   * （late waiter 场景），返回真实 response/source，不返回 cancel。
   */
  waitForApproval(requestId: string): Promise<{ response: ApprovalResponse; source: "user" | "session_allow" | "session_deny" | "mode" }> {
    // V16.5-C: late waiter replay — 先查 resolvedMap，命中返回真实决策。
    const resolved = this.resolvedMap.get(requestId);
    if (resolved) {
      this.resolvedMap.delete(requestId);
      return Promise.resolve(resolved);
    }
    // V16.5-B: 检查 request 是否仍存在 — 若已被 cancelAllPending 清除则立即返回 cancel
    if (!this.pendingMap.has(requestId)) {
      return Promise.resolve({ response: { type: "cancel" }, source: "user" });
    }
    return new Promise((resolve) => {
      this.resolvers.set(requestId, resolve);
    });
  }
}

/**
 * 创建一个会话级 PermissionBoundary。
 *
 * @param mode Claude permissionMode（default/acceptEdits/plan/auto/dontAsk/bypassPermissions）
 * @param policy 权限策略（low/medium/high，目前仅记录，决策以 mode 为主）
 */
export function createPermissionBoundary(
  mode: ClaudePermissionMode,
  policy: PermissionPolicy,
): PermissionBoundaryImpl {
  return new PermissionBoundaryImpl(mode, policy);
}
