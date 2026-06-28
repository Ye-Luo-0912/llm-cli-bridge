// LLM CLI Bridge — Preflight Status Mapping
// V1.1: 将 PreflightResult 映射为 UI 可读状态（纯函数，便于单元测试）

import type { PreflightResult } from "./agentProfile";

/**
 * UI 显示用的 preflight 状态类别
 */
export type PreflightStatusKind = "available" | "unavailable" | "unknown";

/**
 * UI 显示用的 preflight 状态
 */
export interface PreflightStatus {
  readonly kind: PreflightStatusKind;
  /** 简短状态文本（如 "available" / "unavailable" / "未检测"） */
  readonly label: string;
  /** 详细说明（含 version / skipReason，不含 secret） */
  readonly detail: string;
}

/**
 * 将 PreflightResult 映射为 UI 状态
 * - available: cwd 存在且 command 可执行
 * - unavailable: cwd 不存在 / command 为空 / version 探测失败
 * - unknown: 尚未执行 preflight
 */
export function mapPreflightToStatus(result: PreflightResult | null): PreflightStatus {
  if (!result) {
    return {
      kind: "unknown",
      label: "未检测",
      detail: "点击 Preflight 检测 agent 是否可用",
    };
  }

  if (result.available) {
    const versionLine = result.versionStdout.trim().split("\n")[0] || "";
    return {
      kind: "available",
      label: "available",
      detail: versionLine ? `${result.profile} ${versionLine}` : `${result.profile} 可用`,
    };
  }

  // unavailable
  let reason = "不可用";
  if (result.skipReason) {
    reason = result.skipReason;
  } else if (!result.cwdExists) {
    reason = "cwd 不存在";
  } else if (result.versionExitCode !== null) {
    reason = `version 退出码 ${result.versionExitCode}`;
  } else if (result.versionStderr) {
    // 取 stderr 第一行作为原因，避免泄露完整路径或 secret
    reason = result.versionStderr.trim().split("\n")[0].slice(0, 80);
  }

  return {
    kind: "unavailable",
    label: "unavailable",
    detail: `${result.profile}: ${reason}`,
  };
}

/**
 * 构造错误摘要（用于运行失败时显示）
 * - 不包含 secret / token / 完整路径
 * - 截断到 maxLen 字符
 */
export function buildErrorSummary(stderr: string, exitCode: number | null, maxLen = 200): string {
  if (!stderr && exitCode === null) return "";
  const parts: string[] = [];
  if (exitCode !== null) parts.push(`exit ${exitCode}`);
  if (stderr) {
    // 取第一行非空内容，截断
    const firstLine = stderr.trim().split("\n").find((l) => l.trim().length > 0) || "";
    if (firstLine) parts.push(firstLine.slice(0, maxLen));
  }
  const summary = parts.join(" — ");
  // 脱敏：移除可能的 token / key 模式
  return redactSecret(summary).slice(0, maxLen);
}

/**
 * 脱敏：移除疑似 token / key 的内容
 */
export function redactSecret(text: string): string {
  return text
    // 48 字符 hex token
    .replace(/[0-9a-f]{48}/gi, "<token>")
    // sk-ant-... API key
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, "<api-key>")
    // Bearer <token>
    .replace(/Bearer\s+[A-Za-z0-9]{20,}/g, "Bearer <redacted>")
    // ANTHROPIC_API_KEY=...
    .replace(/ANTHROPIC_API_KEY\s*[:=]\s*\S+/gi, "ANTHROPIC_API_KEY=<redacted>")
    // CLAUDE_API_KEY=...
    .replace(/CLAUDE_API_KEY\s*[:=]\s*\S+/gi, "CLAUDE_API_KEY=<redacted>");
}
