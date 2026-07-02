// LLM CLI Bridge — Codex app-server approval mapper (V2.17-A Completion)
//
// 把 codex app-server 的 server-initiated approval request（item/commandExecution/
// requestApproval 与 item/fileChange/requestApproval）映射为 provider-neutral
// ApprovalRequest；把统一 ApprovalResponse 映射回 CodexServerRequestResult。
//
// ⚠️ V2.17-A Completion wire 协议校准：
// approval 不再走 approval/request notification + approval/respond notification。
// 改为 server-initiated request（带 id），client 按原 id 返回 result。
// mapper 现在接收 server-request method + params + id，输出 ApprovalRequest
// （providerContext 携带 serverRequestId 供回复时配对）。
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
  CodexFileChangeApprovalRequestParams,
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
 */
export class CodexAppServerApprovalMapper {
  constructor(private readonly providerId: ProviderId) {}

  /**
   * 把 codex 的 approval server-request 映射为 provider-neutral ApprovalRequest。
   *
   * providerContext 携带 serverRequestId + method，供 resolveApproval 时按 id 回复。
   */
  mapApprovalRequest(req: CodexApprovalServerRequest): ApprovalRequest {
    const { method, serverRequestId, params } = req;
    const isCommand = method === "item/commandExecution/requestApproval";
    const cmdParams = params as CodexCommandExecutionApprovalRequestParams;
    const fcParams = params as CodexFileChangeApprovalRequestParams;

    const toolName = isCommand ? "Bash" : "Write";
    const riskLevel = this.assessRiskLevel(method, fcParams.fileAction);
    const description = isCommand
      ? (cmdParams.description ?? `Execute command: ${cmdParams.command ?? ""}`)
      : `${fcParams.fileAction ?? "modify"} ${fcParams.filePath ?? ""}`;
    const riskReason = isCommand
      ? "Shell execution"
      : fcParams.fileAction === "delete" ? "File deletion" : "File modification";
    const inputSummary = isCommand
      ? (cmdParams.inputSummary ?? cmdParams.command)
      : (fcParams.inputSummary ?? fcParams.filePath);
    const mergeKey = `${toolName}:${riskLevel}:${
      isCommand ? cmdParams.command ?? "" : fcParams.filePath ?? ""
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
      },
    };
  }

  /**
   * 把统一 ApprovalResponse 映射为 codex app-server server-request 响应 result。
   *
   * cancel 在 server-request 语义下映射为 deny（server 协议无 cancel outcome）。
   */
  mapServerRequestResult(unified: ApprovalResponse): CodexServerRequestResult {
    const decision = unified.type === "accept" ? "allow"
      : unified.type === "acceptForSession" ? "allowSession"
      : "deny"; // decline 与 cancel 都映射为 deny（server 协议无 cancel outcome）
    return { decision };
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
