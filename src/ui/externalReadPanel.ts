// LLM CLI Bridge — External Read 面板渲染（从 view.ts 渐进拆分 P4）
// 纯函数：target 渲染 + field 渲染 + reason 标签。
import * as path from "path";
import { setIcon } from "obsidian";
import { classifyFileTypeByPath } from "../fileRefs";
import type { PendingExternalReadRequest } from "../fileAccessPolicy";
import { fileTypeIconName, shortLabelForPath } from "./fileRefMetaUtil";

/** 渲染外部读取请求的目标文件信息块（图标 + 文件名 + 路径 + 风险/范围徽章） */
export function renderExternalReadTarget(parent: HTMLElement, req: PendingExternalReadRequest): void {
  const fileType = classifyFileTypeByPath(req.requestedPath);
  const displayName = path.basename(req.requestedPath.replace(/\\/g, "/")) || req.requestedPath;
  const target = parent.createDiv({
    cls: `llm-bridge-external-read-target is-${fileType} is-risk-${req.risk}`,
    attr: { title: `${req.requestedPath}\n${req.proposedGrantRoot || ""}`.trim() },
  });
  const thumb = target.createEl("span", { cls: "llm-bridge-external-read-target-thumb" });
  setIcon(thumb.createEl("span", { cls: "llm-bridge-external-read-target-icon" }), fileTypeIconName(fileType));
  thumb.createEl("span", { cls: "llm-bridge-external-read-target-ext", text: shortLabelForPath(displayName, fileType) });

  const text = target.createDiv({ cls: "llm-bridge-external-read-target-text" });
  text.createEl("span", { cls: "llm-bridge-external-read-target-name", text: displayName });
  text.createEl("span", { cls: "llm-bridge-external-read-target-path", text: req.requestedPath, attr: { title: req.requestedPath } });

  const badges = target.createDiv({ cls: "llm-bridge-external-read-target-badges" });
  badges.createEl("span", { cls: `llm-bridge-external-read-target-risk is-${req.risk}`, text: req.risk === "high" ? "high risk" : req.risk === "medium" ? "medium risk" : "low risk" });
  badges.createEl("span", { cls: "llm-bridge-external-read-target-scope", text: req.grantRootSafety === "deny" ? "file only" : req.proposedGrantRoot ? "file or folder" : "file" });
}

/** 渲染外部读取请求的字段行（label + value） */
export function renderExternalReadField(parent: HTMLElement, label: string, value: string): void {
  const row = parent.createDiv({ cls: "llm-bridge-external-read-field" });
  row.createEl("span", { cls: "llm-bridge-external-read-field-label", text: label });
  row.createEl("span", { cls: "llm-bridge-external-read-field-value", text: value, attr: { title: value } });
}

/** 外部读取原因 → 中文标签 */
export function externalReadReasonLabel(reason: string): string {
  if (reason === "pending_read_request") return "需要确认后读取外部文件。";
  if (reason === "outside_read_roots") return "该路径不在当前允许读取范围内。";
  if (reason === "high_risk_path") return "路径风险较高，请确认后继续。";
  if (reason === "sensitive_path") return "路径可能包含敏感配置或凭据。";
  return reason.replace(/[_-]+/g, " ");
}
