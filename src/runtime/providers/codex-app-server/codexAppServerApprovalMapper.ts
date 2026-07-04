// LLM CLI Bridge — Codex app-server approval mapper (V2.17-A Completion)
//
// 把 codex app-server 的 server-initiated approval request（item/commandExecution/
// requestApproval 与 item/fileChange/requestApproval）映射为 provider-neutral
// ApprovalRequest；把统一 ApprovalResponse 映射回 CodexServerRequestResult。
//
// ⚠️ V2.17-A Completion 主线闭环：对齐官方 decision shape。
// approval 不再走 approval/request notification + approval/respond notification。
// 改为 server-initiated request（带 id），client 按原 id 返回 result。
//
// 官方 decision：
// - commandExecution: accept / acceptForSession / acceptWithExecpolicyAmendment
//                     / applyNetworkPolicyAmendment / decline / cancel
// - fileChange:       accept / decline
// 不再在 wire 层使用 allow/allowSession/deny。
//
// 风险分级：
// - commandExecution → high（shell 执行）
// - fileChange (delete) → high
// - fileChange (create/modify) → medium
//
// 注意：approval 的"等待用户决策"逻辑由 PermissionBoundary.waitForApproval 承载；
// 本 mapper 只负责格式转换，不做决策。

import type {
  CodexCommandExecutionApprovalRequestParams,
  CodexCommandExecutionDecision,
  CodexFileChangeApprovalRequestParams,
  CodexFileChangeDecision,
  CodexServerRequestResult,
} from "./schema";
import type {
  ApprovalRequest,
  ApprovalResponse,
  ProviderId,
} from "../../core/types";

/**
 * codex app-server approval server-request 的统一内部表示。
 *
 * 由 provider 在 onServerRequest handler 内构造，传给 mapper。
 * serverRequestId 是 wire 上的原 id，必须原样回复。
 */
export interface CodexApprovalServerRequest {
  method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
  serverRequestId: number | string;
  params: CodexCommandExecutionApprovalRequestParams | CodexFileChangeApprovalRequestParams;
}

/**
 * Codex app-server → ApprovalRequest 映射 + ApprovalResponse → server 响应 映射。
 *
 * 对齐官方 decision shape（accept/acceptForSession/decline/cancel +
 * acceptWithExecpolicyAmendment）。
 */
export class CodexAppServerApprovalMapper {
  constructor(private readonly providerId: ProviderId) {}

  /**
   * 把 codex 的 approval server-request 映射为 provider-neutral ApprovalRequest。
   *
   * providerContext 携带 serverRequestId + method + threadId + turnId + itemId，
   * 供 resolveApproval 时按 id 回复并同步 UI。
   */
  mapApprovalRequest(req: CodexApprovalServerRequest): ApprovalRequest {
    const { method, serverRequestId, params } = req;
    const isCommand = method === "item/commandExecution/requestApproval";
    const cmdParams = params as CodexCommandExecutionApprovalRequestParams;
    const fcParams = params as CodexFileChangeApprovalRequestParams;

    const toolName = isCommand ? "Bash" : "Write";
    const riskLevel = this.assessRiskLevel(method, fcParams.fileAction);
    // 命令字符串：官方可能为 string[]；合并为空格分隔字符串供 UI 展示
    const commandStr = isCommand
      ? Array.isArray(cmdParams.command) ? cmdParams.command.join(" ") : (cmdParams.command ?? "")
      : "";
    const description = isCommand
      ? (cmdParams.reason ?? cmdParams.description ?? `Execute command: ${commandStr}`)
      : (fcParams.reason ?? fcParams.description ?? `${fcParams.fileAction ?? "modify"} ${fcParams.filePath ?? ""}`);
    const riskReason = isCommand
      ? "Shell execution"
      : fcParams.fileAction === "delete" ? "File deletion" : "File modification";
    const inputSummary = isCommand
      ? (cmdParams.inputSummary ?? commandStr)
      : (fcParams.inputSummary ?? fcParams.filePath);
    const mergeKey = `${toolName}:${riskLevel}:${
      isCommand ? commandStr : fcParams.filePath ?? ""
    }`;

    return {
      requestId: `codex-req-${serverRequestId}`,
      providerId: this.providerId,
      toolName,
      description,
      riskLevel,
      riskReason,
      inputSummary,
      mergeKey,
      providerContext: {
        serverRequestId,
        method,
        threadId: cmdParams.threadId ?? fcParams.threadId,
        turnId: cmdParams.turnId ?? fcParams.turnId,
        itemId: cmdParams.itemId ?? fcParams.itemId,
      },
    };
  }

  /**
   * 把统一 ApprovalResponse 映射为 codex app-server server-request 响应 result。
   *
   * 使用官方 decision shape：
   * - accept → accept（commandExecution/fileChange）
   * - acceptForSession → acceptForSession（commandExecution；fileChange 退化为 accept）
   * - decline → decline
   * - cancel → cancel（commandExecution；fileChange 退化为 decline）
   *
   * commandExecution 专用扩展位 acceptWithExecpolicyAmendment 当前由用户决策层显式触发
   * （ApprovalResponse 暂无对应 type；保留扩展位供未来 PermissionBoundary 升级）。
   */
  mapServerRequestResult(unified: ApprovalResponse): CodexServerRequestResult {
    // 统一映射为官方 decision（commandExecution 兼容 fileChange 语义）
    const decision = this.mapApprovalResponseToDecision(unified);
    return { decision };
  }

  /**
   * 把统一 ApprovalResponse 映射为官方 decision 字符串。
   *
   * commandExecution decision：accept / acceptForSession / decline / cancel
   * （acceptWithExecpolicyAmendment / applyNetworkPolicyAmendment 由专用扩展路径触发）
   *
   * V16.4-G: declineForSession 统一映射为 "decline"（codex server 协议无 declineForSession）；
   * 会话级 deny 缓存由 PermissionBoundary 内部维护，不影响 server 协议层。
   */
  private mapApprovalResponseToDecision(
    unified: ApprovalResponse,
  ): CodexCommandExecutionDecision | CodexFileChangeDecision {
    switch (unified.type) {
      case "accept":
        return "accept";
      case "acceptForSession":
        return "acceptForSession";
      case "decline":
        return "decline";
      case "declineForSession":
        // codex server 协议只有 decline，无 declineForSession；会话级 deny 由 PermissionBoundary 维护
        return "decline";
      case "cancel":
        return "cancel";
    }
  }

  private assessRiskLevel(
    method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval",
    fileAction?: "create" | "modify" | "delete",
  ): "low" | "medium" | "high" {
    if (method === "item/commandExecution/requestApproval") return "high";
    if (fileAction === "delete") return "high";
    return "medium";
  }
}
