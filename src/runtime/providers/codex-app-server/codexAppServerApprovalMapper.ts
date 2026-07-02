// LLM CLI Bridge — Codex app-server approval mapper (V2.17-A Completion)
//
// 把 codex app-server 的 commandExecution/fileChange approval request 映射为
// provider-neutral ApprovalRequest；把统一 ApprovalResponse 映射回 codex approval
// respond 格式。
//
// 职责：
// - mapApprovalRequest(codexParams): ApprovalRequest（带 providerContext）
// - mapApprovalResponse(unifiedResponse): CodexApprovalResponse（发回给 codex app-server）
//
// 风险分级：
// - commandExecution → high（shell 执行）
// - fileChange (delete) → high
// - fileChange (create/modify) → medium
//
// 注意：approval 的"等待用户决策"逻辑由 PermissionBoundary.waitForApproval 承载；
// 本 mapper 只负责格式转换，不做决策。

import type { CodexApprovalRequestParams, CodexApprovalResponse } from "./schema";
import type {
  ApprovalRequest,
  ApprovalResponse,
  ProviderId,
} from "../../core/types";

/**
 * Codex app-server → ApprovalRequest 映射 + ApprovalResponse → codex 响应 映射。
 */
export class CodexAppServerApprovalMapper {
  constructor(private readonly providerId: ProviderId) {}

  /**
   * 把 codex 的 approval request 参数映射为 provider-neutral ApprovalRequest。
   *
   * providerContext 携带 codex 原始 requestId，供 resolveApproval 时回传。
   */
  mapApprovalRequest(params: CodexApprovalRequestParams): ApprovalRequest {
    const toolName = params.toolName
      ?? (params.kind === "commandExecution" ? "Bash" : "Write");
    const riskLevel = this.assessRiskLevel(params);
    const description = params.description
      ?? (params.kind === "commandExecution"
        ? `Execute command: ${params.command ?? ""}`
        : `${params.fileAction ?? "modify"} ${params.filePath ?? ""}`);
    return {
      requestId: `codex-${params.requestId}`,
      providerId: this.providerId,
      toolName,
      description,
      riskLevel,
      riskReason: params.kind === "commandExecution"
        ? "Shell execution"
        : params.fileAction === "delete" ? "File deletion" : "File modification",
      inputSummary: params.inputSummary ?? params.command ?? params.filePath,
      mergeKey: `${toolName}:${riskLevel}:${params.filePath ?? params.command ?? ""}`,
      providerContext: {
        codexRequestId: params.requestId,
        kind: params.kind,
      },
    };
  }

  /**
   * 把统一 ApprovalResponse 映射为 codex app-server 的 approval respond。
   */
  mapApprovalResponse(unified: ApprovalResponse, codexRequestId: string): CodexApprovalResponse {
    const outcome = unified.type === "accept" ? "allow"
      : unified.type === "acceptForSession" ? "allowSession"
      : unified.type === "decline" ? "deny"
      : "cancel";
    return {
      requestId: codexRequestId,
      outcome,
    };
  }

  private assessRiskLevel(params: CodexApprovalRequestParams): "low" | "medium" | "high" {
    if (params.kind === "commandExecution") return "high";
    if (params.fileAction === "delete") return "high";
    return "medium";
  }
}
