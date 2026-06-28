// LLM CLI Bridge — SDK Permission Bridge (V2.3s)
// 基于 SDK 原生 permissionMode 与 canUseTool 回调做 UI 封装
// 纯函数模块：permissionMode 映射 + 风险解释 + 工具风险分级 + 会话级决策缓存
//
// 设计原则：
// - 不改 AgentEvent v0.1，不新增 tool event
// - CLI/auto 主线不受影响（仅 sdk-experimental 启用 canUseTool 回调）
// - high-risk 操作必须明确提示（删除/shell/Vault外/.obsidian/env/网络）
// - subagent 权限继承较宽时 UI 提示风险（只展示，不自研编排）
// - 相同工具/同类请求合并，避免频繁弹窗

import type { ClaudePermissionMode } from "./types";

// ---------- permissionMode 映射与风险解释 ----------

/**
 * permissionMode 风险描述（中文）
 */
export interface PermissionModeInfo {
  readonly mode: ClaudePermissionMode;
  /** 中文标签 */
  readonly label: string;
  /** 中文风险解释 */
  readonly risk: string;
  /** 风险等级（用于 UI 颜色提示） */
  readonly level: "safe" | "caution" | "danger";
  /** 是否需要 canUseTool 回调参与决策 */
  readonly interactive: boolean;
}

const PERMISSION_MODE_INFO: Readonly<Record<ClaudePermissionMode, PermissionModeInfo>> = {
  default: {
    mode: "default",
    label: "默认询问",
    risk: "每次工具调用按 SDK 默认规则询问；编辑类操作需确认，读操作自动允许。",
    level: "safe",
    interactive: true,
  },
  acceptEdits: {
    mode: "acceptEdits",
    label: "自动接受编辑",
    risk: "文件编辑类操作自动允许，不再逐次询问；删除/Shell 等仍按默认规则处理。",
    level: "caution",
    interactive: true,
  },
  plan: {
    mode: "plan",
    label: "只读规划",
    risk: "低风险只读操作（读文件/列目录/查询状态）自动允许；中/高风险（编辑/删除/Shell/网络）拒绝；适合规划与调研。",
    level: "safe",
    interactive: true,
  },
  auto: {
    mode: "auto",
    label: "自动决策",
    risk: "低风险自动允许；中/高风险必须用户确认，不自动放行（V2.3.2 Safety Gate）。",
    level: "caution",
    interactive: true,
  },
  dontAsk: {
    mode: "dontAsk",
    label: "不询问",
    risk: "静默允许所有操作，不再弹出询问；canUseTool 仍会观测并记录，但不拦截。",
    level: "danger",
    interactive: false,
  },
  bypassPermissions: {
    mode: "bypassPermissions",
    label: "跳过权限（危险）",
    risk: "跳过所有权限检查（含删除/Shell/网络）；仅开发者显式选择时放行，非默认。",
    level: "danger",
    interactive: false,
  },
};

/**
 * 获取 permissionMode 的中文风险描述
 */
export function getPermissionModeInfo(mode: ClaudePermissionMode): PermissionModeInfo {
  return PERMISSION_MODE_INFO[mode] ?? PERMISSION_MODE_INFO.default;
}

/**
 * 获取所有 permissionMode 选项（用于 UI 下拉）
 */
export function listPermissionModes(): ReadonlyArray<PermissionModeInfo> {
  return Object.values(PERMISSION_MODE_INFO);
}

// ---------- 工具风险分级 ----------

/**
 * 工具风险等级
 * - low: 只读操作（Read/Glob/Gash 只读）
 * - medium: 文件编辑（Edit/Write/MultiEdit/NotebookEdit）
 * - high: 删除/Shell/网络/Vault 外路径/.obsidian/env
 */
export type ToolRiskLevel = "low" | "medium" | "high";

/**
 * 工具风险分类结果
 */
export interface ToolRiskAssessment {
  readonly level: ToolRiskLevel;
  /** 中文风险说明 */
  readonly reason: string;
  /** 命中的高风险标记（用于 UI 明确提示） */
  readonly highRiskFlags: ReadonlyArray<string>;
}

/** 高风险工具名（按 SDK 内置工具） */
const HIGH_RISK_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Bash", // Shell 执行
  "Delete", // 删除文件
  "WebFetch", // 网络
  "WebSearch", // 网络
]);

/** 中风险工具名（文件编辑类） */
const MEDIUM_RISK_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

/** 敏感目录关键词（Vault 外/.obsidian/env 等） */
const SENSITIVE_PATH_PATTERNS: ReadonlyArray<{ re: RegExp; flag: string }> = [
  { re: /^\/(?:Users|home|tmp|var|etc|opt|usr)\//i, flag: "Vault 外绝对路径" },
  { re: /^[A-Za-z]:[\\/]/, flag: "Vault 外绝对路径（Windows 盘符）" },
  { re: /(?:^|[\\/])\.obsidian[\\/]/i, flag: ".obsidian 配置目录" },
  { re: /(?:^|[\\/])\.env(?:[\\/]|$)/i, flag: ".env 环境文件" },
  { re: /(?:^|[\\/])\.git[\\/]/i, flag: ".git 版本控制目录" },
  { re: /(?:^|[\\/])\.llm-bridge[\\/](?:bridge\.json|token|secrets|credentials)/i, flag: "Bridge 凭证文件" },
];

/**
 * 评估工具调用的风险等级
 * @param toolName 工具名（SDK 内置或自定义）
 * @param input 工具输入参数（用于检测路径/命令）
 */
export function assessToolRisk(toolName: string, input: Record<string, unknown>): ToolRiskAssessment {
  const highRiskFlags: string[] = [];

  // 1. 工具名判定
  if (HIGH_RISK_TOOL_NAMES.has(toolName)) {
    if (toolName === "Bash") highRiskFlags.push("Shell 执行");
    else if (toolName === "Delete") highRiskFlags.push("文件删除");
    else highRiskFlags.push(`网络操作（${toolName}）`);
  }

  // 2. 路径敏感性检测（file_path / notebook_path / path）
  const pathCandidates = [input.file_path, input.notebook_path, input.path].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  for (const p of pathCandidates) {
    for (const { re, flag } of SENSITIVE_PATH_PATTERNS) {
      if (re.test(p) && !highRiskFlags.includes(flag)) {
        highRiskFlags.push(flag);
      }
    }
  }

  // 3. Bash 命令内容检测（command 字段）
  const cmd = typeof input.command === "string" ? input.command : "";
  if (cmd) {
    if (/\brm\s+-rf?\b/i.test(cmd) || /\bdel\s+\/[sqf]/i.test(cmd)) highRiskFlags.push("递归删除命令");
    if (/\bcurl\b|\bwget\b|\bfetch\b/i.test(cmd)) highRiskFlags.push("网络命令");
    if (/\bsudo\b/i.test(cmd)) highRiskFlags.push("提权命令");
    if (/\b(ANTHROPIC|OPENAI|API|SECRET|TOKEN)[_A-Z]*\s*=/i.test(cmd)) highRiskFlags.push("凭证环境变量赋值");
  }

  // 4. 综合等级
  let level: ToolRiskLevel;
  if (highRiskFlags.length > 0) {
    level = "high";
  } else if (MEDIUM_RISK_TOOL_NAMES.has(toolName)) {
    level = "medium";
  } else {
    level = "low";
  }

  const reason = level === "high"
    ? `高风险：${highRiskFlags.join("、")}`
    : level === "medium"
      ? "中风险：文件编辑操作"
      : "低风险：只读或无害操作";

  return { level, reason, highRiskFlags };
}

// ---------- 会话级决策缓存 ----------

/**
 * 用户决策类型
 */
export type PermissionChoice = "allow_once" | "allow_session" | "deny_session";

/**
 * 会话级允许缓存条目
 * 按 toolName + riskLevel + pathPattern 三元组匹配
 */
export interface SessionPermissionAllow {
  readonly toolName: string;
  readonly riskLevel: ToolRiskLevel;
  /** 路径前缀（空表示该工具所有路径已允许） */
  readonly pathPattern: string;
  readonly grantedAt: string;
}

/**
 * 会话级拒绝缓存条目
 */
export interface SessionPermissionDeny {
  readonly toolName: string;
  readonly riskLevel: ToolRiskLevel;
  readonly pathPattern: string;
  readonly deniedAt: string;
}

/**
 * canUseTool 决策结果
 */
export interface CanUseToolDecision {
  /** allow=允许执行；deny=拒绝执行；ask=需用户确认（由 canUseTool 走交互流程） */
  readonly behavior: "allow" | "deny" | "ask";
  /** 决策来源：user=用户本次选择；session_allow=会话级允许缓存命中；session_deny=会话级拒绝缓存命中；mode=permissionMode 自动决策 */
  readonly source: "user" | "session_allow" | "session_deny" | "mode";
  /** 风险评估 */
  readonly risk: ToolRiskAssessment;
  /** 中文说明（用于 UI/日志） */
  readonly reason: string;
}

/**
 * 从工具输入提取路径前缀（用于会话级缓存匹配）
 */
export function extractToolPathPattern(input: Record<string, unknown>): string {
  const path = typeof input.file_path === "string"
    ? input.file_path
    : typeof input.notebook_path === "string"
      ? input.notebook_path
      : typeof input.path === "string"
        ? input.path
        : "";
  if (!path) return "";
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash <= 0) return "";
  return path.slice(0, slash + 1);
}

/**
 * 检查会话级允许缓存是否命中
 */
export function checkSessionAllow(
  allows: ReadonlyArray<SessionPermissionAllow>,
  toolName: string,
  risk: ToolRiskAssessment,
  input: Record<string, unknown>,
): boolean {
  const pathPattern = extractToolPathPattern(input);
  for (const allow of allows) {
    if (allow.toolName !== toolName) continue;
    if (allow.riskLevel !== risk.level) continue;
    if (allow.pathPattern === "") return true; // 该工具+风险等级所有路径已允许
    if (pathPattern && pathPattern.startsWith(allow.pathPattern)) return true;
  }
  return false;
}

/**
 * 检查会话级拒绝缓存是否命中（命中则重新询问，不自动拒绝，保守策略）
 * 返回 true 表示曾拒绝过（UI 可提示），但决策仍走 needs_approval
 */
export function checkSessionDeny(
  denies: ReadonlyArray<SessionPermissionDeny>,
  toolName: string,
  risk: ToolRiskAssessment,
  input: Record<string, unknown>,
): boolean {
  const pathPattern = extractToolPathPattern(input);
  for (const deny of denies) {
    if (deny.toolName !== toolName) continue;
    if (deny.riskLevel !== risk.level) continue;
    if (deny.pathPattern === "") return true;
    if (pathPattern && pathPattern.startsWith(deny.pathPattern)) return true;
  }
  return false;
}

/**
 * 根据 permissionMode 与风险评估给出决策（唯一真相源）
 *
 * V2.3.2 Safety Gate 修正：
 * - bypassPermissions：全部 allow（仅开发者显式选择时放行，危险）
 * - dontAsk：全部 allow（静默放行，canUseTool 仍观测记录）
 * - plan：全部 deny（只读模式不允许任何工具）
 * - acceptEdits：low/medium 自动 allow，high 需用户确认（ask）
 * - auto：low 自动 allow，medium/high 需用户确认（ask）—— high 不自动允许
 * - default：low 自动 allow，medium/high 需用户确认（ask）
 *
 * 返回 ask 时，由 canUseTool 走用户交互流程（pending + resolvePermission）。
 * high-risk 在任何交互模式下都不会被静默放行。
 */
export function decideByMode(
  mode: ClaudePermissionMode,
  risk: ToolRiskAssessment,
): CanUseToolDecision {
  const info = getPermissionModeInfo(mode);

  // 危险模式：全部允许（仅显式选择时）
  if (mode === "bypassPermissions" || mode === "dontAsk") {
    return {
      behavior: "allow",
      source: "mode",
      risk,
      reason: `${info.label}：${info.risk}`,
    };
  }

  // plan：low 只读自动允许，medium/high 拒绝（V2.4 修正：与文案一致）
  if (mode === "plan") {
    if (risk.level === "low") {
      return {
        behavior: "allow",
        source: "mode",
        risk,
        reason: `${info.label}：低风险只读操作自动允许`,
      };
    }
    return {
      behavior: "deny",
      source: "mode",
      risk,
      reason: `${info.label}：${risk.level} 风险操作拒绝（只读模式不允许修改/删除/Shell/网络）`,
    };
  }

  // acceptEdits：low/medium 自动允许，high 需用户确认
  if (mode === "acceptEdits") {
    if (risk.level === "high") {
      return {
        behavior: "ask",
        source: "mode",
        risk,
        reason: `${info.label}：高风险操作需用户确认（${risk.reason}）`,
      };
    }
    return {
      behavior: "allow",
      source: "mode",
      risk,
      reason: `${info.label}：${risk.level} 风险自动允许`,
    };
  }

  // auto：low 自动允许，medium/high 需用户确认（high 不自动允许）
  if (mode === "auto") {
    if (risk.level === "low") {
      return {
        behavior: "allow",
        source: "mode",
        risk,
        reason: `${info.label}：低风险自动允许`,
      };
    }
    return {
      behavior: "ask",
      source: "mode",
      risk,
      reason: `${info.label}：${risk.level} 风险需用户确认（${risk.reason}）`,
    };
  }

  // default：low 自动允许，medium/high 需用户确认
  if (risk.level === "low") {
    return {
      behavior: "allow",
      source: "mode",
      risk,
      reason: "默认模式：低风险自动允许",
    };
  }
  return {
    behavior: "ask",
    source: "mode",
    risk,
    reason: `默认模式：${risk.level} 风险需用户确认（${risk.reason}）`,
  };
}

/**
 * 构造会话级允许条目
 */
export function createSessionAllow(
  toolName: string,
  risk: ToolRiskAssessment,
  input: Record<string, unknown>,
): SessionPermissionAllow {
  return {
    toolName,
    riskLevel: risk.level,
    pathPattern: extractToolPathPattern(input),
    grantedAt: new Date().toISOString(),
  };
}

/**
 * 构造会话级拒绝条目
 */
export function createSessionDeny(
  toolName: string,
  risk: ToolRiskAssessment,
  input: Record<string, unknown>,
): SessionPermissionDeny {
  return {
    toolName,
    riskLevel: risk.level,
    pathPattern: extractToolPathPattern(input),
    deniedAt: new Date().toISOString(),
  };
}

// ---------- 请求合并键 ----------

/**
 * 构造请求合并键（相同工具+相同风险+相同路径前缀合并为一次询问）
 */
export function buildRequestMergeKey(
  toolName: string,
  risk: ToolRiskAssessment,
  input: Record<string, unknown>,
): string {
  const pathPattern = extractToolPathPattern(input);
  return `${toolName}:${risk.level}:${pathPattern}`;
}

// ---------- subagent 权限继承提示 ----------

/**
 * subagent 权限继承风险评估
 * SDK 中 subagent 通常继承主 agent 的 permissionMode，权限较宽时需提示
 */
export interface SubagentPermissionRisk {
  /** 是否存在权限继承较宽的风险 */
  readonly risky: boolean;
  /** 中文提示 */
  readonly warning: string;
}

/**
 * 评估 subagent 权限继承风险
 * @param mode 主 agent 的 permissionMode
 * @param isSubagent 是否为 subagent 事件
 */
export function assessSubagentPermissionRisk(
  mode: ClaudePermissionMode,
  isSubagent: boolean,
): SubagentPermissionRisk {
  if (!isSubagent) {
    return { risky: false, warning: "" };
  }
  const info = getPermissionModeInfo(mode);
  if (info.level === "danger") {
    return {
      risky: true,
      warning: `subagent 继承主 agent 的「${info.label}」权限，可执行高风险操作（${info.risk}）`,
    };
  }
  if (info.level === "caution") {
    return {
      risky: true,
      warning: `subagent 继承主 agent 的「${info.label}」权限，编辑类操作自动允许`,
    };
  }
  return {
    risky: false,
    warning: `subagent 继承主 agent 的「${info.label}」权限`,
  };
}
