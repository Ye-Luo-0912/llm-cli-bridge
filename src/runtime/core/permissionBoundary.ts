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
    // 1. 查会话级 allow 缓存
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
    const req = this.pendingMap.get(requestId);
    if (!req) return false;
    this.pendingMap.delete(requestId);

    // 更新会话级缓存：直接构造 SessionAllowEntry/SessionDenyEntry（此处无解析后的 tool
    // input record，pathPattern 退化为通配；真实 pathPattern 由 provider 在 requestApproval
    // 时通过 mergeKey 携带）
    const pathPattern = req.mergeKey ?? extractToolPathPattern({});
    const now = new Date().toISOString();
    if (response.type === "acceptForSession") {
      this.allowsList.push({
        toolName: req.toolName,
        riskLevel: req.riskLevel,
        pathPattern,
        grantedAt: now,
      });
    } else if (response.type === "decline") {
      this.deniesList.push({
        toolName: req.toolName,
        riskLevel: req.riskLevel,
        pathPattern,
        deniedAt: now,
      });
    }

    // 唤醒 provider 等待的 resolver
    const resolver = this.resolvers.get(requestId);
    if (resolver) {
      this.resolvers.delete(requestId);
      const source = response.type === "acceptForSession" ? "session_allow"
        : response.type === "decline" ? "session_deny"
        : "user";
      resolver({ response, source });
    }
    return true;
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
    return cancelled;
  }

  /**
   * Provider 在 requestApproval 返回 "pending" 后调用，挂起当前事件产出直到 UI 决策。
   *
   * 返回决策结果（response + source）。cancelAllPending 时返回 { type: "cancel" }。
   */
  waitForApproval(requestId: string): Promise<{ response: ApprovalResponse; source: "user" | "session_allow" | "session_deny" | "mode" }> {
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
