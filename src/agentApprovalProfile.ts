// LLM CLI Bridge — provider-neutral Agent Approval Profile
//
// 统一「请求批准 / 替我审批 / 完全访问」三档，供 Claude / Codex 共用 UI。
// Codex 通过唯一映射函数生成 approvalPolicy / approvalsReviewer / sandbox(+Policy)；
// 不再用 claudePermissionMode 驱动 Codex。

/** 三档审批画像（provider-neutral） */
export type AgentApprovalProfile = "ask" | "auto" | "full-access";

export interface AgentApprovalProfileInfo {
  readonly id: AgentApprovalProfile;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  /** chip 短标签 */
  readonly shortLabel: string;
}

export const AGENT_APPROVAL_PROFILES: ReadonlyArray<AgentApprovalProfileInfo> = [
  {
    id: "ask",
    title: "请求批准",
    description: "编辑外部文件和使用互联网时始终询问",
    icon: "hand",
    shortLabel: "请求批准",
  },
  {
    id: "auto",
    title: "替我审批",
    description: "仅对检测到的风险操作请求批准",
    icon: "shield",
    shortLabel: "替我审批",
  },
  {
    id: "full-access",
    title: "完全访问权限",
    description: "可不受限制地访问互联网和您电脑上的任何文件",
    icon: "shield-alert",
    shortLabel: "完全访问",
  },
];

export function getAgentApprovalProfileInfo(profile: AgentApprovalProfile): AgentApprovalProfileInfo {
  return AGENT_APPROVAL_PROFILES.find((item) => item.id === profile) ?? AGENT_APPROVAL_PROFILES[0];
}

export function isAgentApprovalProfile(value: unknown): value is AgentApprovalProfile {
  return value === "ask" || value === "auto" || value === "full-access";
}

/**
 * 旧权限数据迁移：统一回到「请求批准」。
 * 故意不把旧 bypassPermissions / dontAsk 静默升级为 full-access。
 */
export function migrateLegacyPermissionToApprovalProfile(_legacyMode?: string | null): AgentApprovalProfile {
  return "ask";
}

/**
 * Codex 结构化 sandboxPolicy（turn/start）。
 *
 * Round 2: 直接复用 generated SandboxPolicy（schema SSOT），不再手写平行定义。
 * mapAgentApprovalProfileToCodex 只构造 workspaceWrite / dangerFullAccess 两个变体，
 * 但类型上允许 generated 联合的全部变体（readOnly / externalSandbox），供未来扩展。
 */
export type CodexSandboxPolicy = import("./runtime/providers/codex-app-server/schema").SandboxPolicy;

export interface CodexApprovalWireConfig {
  readonly approvalPolicy: "on-request" | "never";
  readonly approvalsReviewer: "user" | "auto_review";
  /** thread/start 顶层 sandbox 字符串 */
  readonly sandbox: "workspace-write" | "read-only" | "danger-full-access";
  /** turn/start 结构化 sandboxPolicy */
  readonly sandboxPolicy: CodexSandboxPolicy;
}

/**
 * Codex 唯一映射：AgentApprovalProfile → wire 配置。
 * 不复用 Claude sdkPermission 风险决策。
 */
export function mapAgentApprovalProfileToCodex(
  profile: AgentApprovalProfile,
  cwd: string,
): CodexApprovalWireConfig {
  const writableRoots = cwd ? [cwd] : [];
  if (profile === "full-access") {
    return {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  if (profile === "auto") {
    return {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots,
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    };
  }
  // ask（请求批准）
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots,
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

/**
 * 可选：把三档画像映射到 Claude permissionMode（仅 Claude 路径使用）。
 * full-access → bypassPermissions；auto → auto；ask → default。
 * plan 不在三档内，仍由 Claude 专用设置保留。
 */
export function mapAgentApprovalProfileToClaudePermissionMode(
  profile: AgentApprovalProfile,
): "default" | "auto" | "bypassPermissions" {
  if (profile === "full-access") return "bypassPermissions";
  if (profile === "auto") return "auto";
  return "default";
}
