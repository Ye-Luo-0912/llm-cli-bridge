// LLM CLI Bridge — Command Profile (V1.5)
// 统一命令解析与构造：command / args / cwd / model / continue / resume / permission / extra args
// 纯函数模块，便于单元测试；不引入 SDK / ACP / MCP，不新增 npm 依赖
// 不改 AgentEvent v0.1，不新增 tool event

import { AgentType, ClaudePermissionMode, LLMBridgeSettings } from "./types";

/**
 * 命令 profile：描述如何调用某个 agent 的基础命令（不含动态参数）
 * 兼容 V0.5 agentProfile.ts 的 CommandProfile 结构
 */
export interface CommandProfile {
  /** profile 名：claude / codex / custom */
  readonly name: AgentType;
  /** 实际可执行命令（已 trim） */
  readonly command: string;
  /** 基础运行参数（已 trim + 按空白拆分），来自 settings 的 *Args 字段 */
  readonly args: string[];
  /** version 探测参数，默认 ["--version"] */
  readonly versionArgs: string[];
}

/**
 * 完整解析后的命令行（用于实际 spawn 与 UI 预览）
 * 包含 base args + Claude Code 动态参数（continue/resume/permission/extra）
 */
export interface ResolvedCommandLine {
  readonly command: string;
  /** 完整参数数组（base + 动态） */
  readonly args: string[];
  readonly cwd: string;
}

/**
 * 命令预览信息（UI-only，不进 AgentEvent）
 * 用于在面板展示本次实际执行的命令、上下文与环境
 */
export interface CommandPreview {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly hasSelection: boolean;
  readonly hasActiveNote: boolean;
  readonly selectionLength: number;
  readonly activeFileName: string | null;
  readonly promptLength: number;
  readonly model: string;
  readonly effortLevel: string;
  readonly permissionMode: ClaudePermissionMode;
  readonly continueSession: boolean;
  readonly resumeSessionId: string;
  /** 环境变量 key 名（存在性，不含 value） */
  readonly envKeys: string[];
}

/**
 * 根据 settings 解析出对应 agentType 的基础 CommandProfile
 * 统一原 agentProfile.ts 的 resolveProfile 与 claudeCliBackend.ts 的 resolveCommand
 */
export function resolveProfile(settings: LLMBridgeSettings): CommandProfile {
  const type: AgentType = settings.agentType;
  let command: string;
  let argsStr: string;
  if (type === "claude") {
    command = settings.claudeCommand;
    argsStr = settings.claudeArgs;
  } else if (type === "codex") {
    command = settings.codexCommand;
    argsStr = settings.codexArgs;
  } else {
    command = settings.customCommand;
    argsStr = settings.customArgs;
  }
  const trimmedCommand = command.trim();
  const args = argsStr.trim().length > 0 ? argsStr.trim().split(/\s+/) : [];
  return {
    name: type,
    command: trimmedCommand,
    args,
    versionArgs: ["--version"],
  };
}

/**
 * 构造 Claude Code 的动态参数（continue / resume / permission / extra args）
 * 仅 claude agentType 生效；codex / custom 返回空数组
 *
 * Claude Code CLI 参数规范：
 * - --continue          继续最近一次会话
 * - --resume <sessionId> 恢复指定会话（与 --continue 互斥，continue 优先）
 * - --permission-mode <mode>  权限模式：default / acceptEdits / plan / bypassPermissions
 * - extra args          用户自定义额外参数（按空白拆分）
 */
export function buildClaudeDynamicArgs(settings: LLMBridgeSettings): string[] {
  if (settings.agentType !== "claude") return [];
  const args: string[] = [];
  // continue 优先于 resume
  if (settings.claudeContinueSession) {
    args.push("--continue");
  } else if (settings.claudeResumeSessionId.trim().length > 0) {
    args.push("--resume", settings.claudeResumeSessionId.trim());
  }
  // permission-mode（default 不加 flag）
  if (settings.claudePermissionMode !== "default") {
    args.push("--permission-mode", settings.claudePermissionMode);
  }
  // extra args
  const extra = settings.claudeExtraArgs.trim();
  if (extra.length > 0) {
    args.push(...extra.split(/\s+/));
  }
  return args;
}

/**
 * 构造完整命令行（base args + Claude 动态参数），用于实际 spawn
 * 替代原 claudeCliBackend.ts 的 resolveCommand
 */
export function buildCommandLine(settings: LLMBridgeSettings, cwd: string): ResolvedCommandLine {
  const profile = resolveProfile(settings);
  const dynamicArgs = buildClaudeDynamicArgs(settings);
  return {
    command: profile.command,
    args: [...profile.args, ...dynamicArgs],
    cwd,
  };
}

/**
 * 构造命令预览（UI-only）
 * @param settings       插件设置
 * @param cwd            运行目录
 * @param opts           上下文信息（选区/笔记/prompt 长度）
 * @param envKeys        环境变量 key 名列表（来自 buildRunEnv，不含 value）
 */
export function buildCommandPreview(
  settings: LLMBridgeSettings,
  cwd: string,
  opts: {
    hasSelection: boolean;
    selectionLength: number;
    hasActiveNote: boolean;
    activeFileName: string | null;
    promptLength: number;
  },
  envKeys: string[] = [],
): CommandPreview {
  const { command, args } = buildCommandLine(settings, cwd);
  return {
    command,
    args,
    cwd,
    hasSelection: opts.hasSelection,
    hasActiveNote: opts.hasActiveNote,
    selectionLength: opts.selectionLength,
    activeFileName: opts.activeFileName,
    promptLength: opts.promptLength,
    model: settings.model,
    effortLevel: settings.effortLevel,
    permissionMode: settings.claudePermissionMode,
    continueSession: settings.claudeContinueSession,
    resumeSessionId: settings.claudeResumeSessionId,
    envKeys,
  };
}

/**
 * 构造脱敏的命令行单行显示字符串（用于复制 / 日志）
 * 不含 secret value，不含 prompt 内容（prompt 通过 stdin 传入）
 */
export function buildRedactedCommandDisplay(preview: CommandPreview): string {
  const parts = [preview.command, ...preview.args];
  const cmdLine = parts.join(" ");
  const ctx = [
    `cwd: ${preview.cwd}`,
    `model: ${preview.model}`,
    `effort: ${preview.effortLevel}`,
    `stdin: ${preview.promptLength} chars`,
  ];
  if (preview.hasSelection) ctx.push(`selection: ${preview.selectionLength} chars`);
  if (preview.hasActiveNote && preview.activeFileName) ctx.push(`note: ${preview.activeFileName}`);
  if (preview.envKeys.length > 0) ctx.push(`env: ${preview.envKeys.join(",")}`);
  return `${cmdLine}  # ${ctx.join(" | ")}`;
}

/**
 * 将 CommandPreview 转为 label/value 行数组（用于 UI 渲染）
 * 每行一个字段，value 已脱敏
 */
export function previewToRows(preview: CommandPreview): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  rows.push({ label: "command", value: preview.command || "(empty)" });
  rows.push({ label: "args", value: preview.args.length > 0 ? preview.args.join(" ") : "(none)" });
  rows.push({ label: "cwd", value: preview.cwd });
  rows.push({ label: "model", value: preview.model || "(default)" });
  rows.push({ label: "effort", value: preview.effortLevel || "(default)" });
  if (preview.continueSession) {
    rows.push({ label: "session", value: "--continue" });
  } else if (preview.resumeSessionId) {
    rows.push({ label: "session", value: `--resume ${preview.resumeSessionId}` });
  }
  if (preview.permissionMode !== "default") {
    rows.push({ label: "permission", value: preview.permissionMode });
  }
  rows.push({
    label: "stdin",
    value: `${preview.promptLength} chars`,
  });
  rows.push({
    label: "selection",
    value: preview.hasSelection ? `${preview.selectionLength} chars` : "off",
  });
  rows.push({
    label: "note",
    value: preview.hasActiveNote && preview.activeFileName ? preview.activeFileName : "off",
  });
  if (preview.envKeys.length > 0) {
    rows.push({ label: "env", value: preview.envKeys.join(", ") });
  }
  return rows;
}
