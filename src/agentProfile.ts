// LLM CLI Bridge — Agent Profile / Preflight
// V0.5: profile 只负责命令解析和预检，不维护会话、不发真实 prompt、不调模型
// 不引入 SDK / ACP / MCP，不新增 npm 依赖
// V1.5: resolveProfile / CommandProfile 统一到 commandProfile.ts

import { spawn, type SpawnOptions } from "child_process";

/**
 * 跨平台 spawn：Windows 下用 cmd.exe /d /s /c 显式调用，兼容 .cmd/.ps1 垫片，
 * 避免 shell:true 的 DEP0190 弃用警告。非 Windows 直接 spawn（不加 shell）。
 */
function spawnCompat(command: string, args: string[], options: SpawnOptions): ReturnType<typeof spawn> {
  if (process.platform === "win32") {
    const quoteIfNeeded = (a: string) => (a.includes(" ") && !a.startsWith('"') ? `"${a}"` : a);
    const cmdLine = [quoteIfNeeded(command), ...args.map(quoteIfNeeded)].join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmdLine], {
      ...options,
      shell: false,
      windowsHide: true,
    });
  }
  return spawn(command, args, { ...options, shell: false, windowsHide: true });
}
import * as fs from "fs";
import * as path from "path";
import { LLMBridgeSettings } from "./types";
import { buildEnhancedPath, buildRunEnv } from "./claudeCliBackend";
// V1.5: 复用 commandProfile.ts 的 resolveProfile / CommandProfile（单一数据源）
import { resolveProfile, CommandProfile } from "./commandProfile";

// re-export 保持向后兼容（外部引用来自 agentProfile 的 CommandProfile / resolveProfile）
export { resolveProfile };
export type { CommandProfile };

// ---------- Preflight 结果 ----------

export interface PreflightResult {
  readonly profile: string;
  readonly command: string;
  readonly args: string[];
  readonly versionArgs: string[];
  readonly cwd: string;
  readonly cwdExists: boolean;
  /** version 命令是否执行成功（exit 0） */
  readonly commandFound: boolean;
  readonly versionExitCode: number | null;
  /** version stdout（截断，避免过长） */
  readonly versionStdout: string;
  readonly versionStderr: string;
  /** cwd 存在且 command 可执行（version 成功） */
  readonly available: boolean;
  /** 用户可读诊断摘要 */
  readonly diagnostics: string;
  /** 详细诊断日志路径（不含 secret） */
  readonly debugLogPath: string | null;
  /** 未安装时用于测试跳过的原因 */
  readonly skipReason: string | null;
}

// ---------- 诊断日志写入 ----------

/**
 * 写入 preflight 调试日志到 <cwd>/.llm-bridge/logs/preflight-<timestamp>.log
 * 只记录 env key 名（存在性），不记录 value，不泄露 secret
 */
function writePreflightDebugLog(cwd: string, content: string): string | null {
  try {
    const logDir = path.join(cwd, ".llm-bridge", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(logDir, `preflight-${ts}.log`);
    fs.writeFileSync(logPath, content, "utf8");
    return logPath;
  } catch {
    return null;
  }
}

// ---------- Preflight 实现 ----------

/**
 * 执行 preflight 预检
 * - 不发送真实 prompt，不调用模型，不消耗 API
 * - 只执行 `<command> --version` 探测命令可用性
 * - Windows 下 shell:true 保证带空格路径可用
 *
 * @param settings 用于解析 profile 和构造 env
 * @param cwd      运行目录（用于 cwd 检查和日志写入）
 * @param timeoutMs version 探测超时，默认 10s
 */
export function runPreflight(
  settings: LLMBridgeSettings,
  cwd: string,
  timeoutMs = 10000,
): Promise<PreflightResult> {
  return new Promise((resolve) => {
    const profile = resolveProfile(settings);
    const { env, envKeys } = buildRunEnv(settings, cwd);

    // cwd 检查
    const cwdExists = fs.existsSync(cwd);

    // 构造诊断日志（不含 secret）
    const debugLines: string[] = [];
    debugLines.push("=== Preflight 诊断 ===");
    debugLines.push(`time: ${new Date().toISOString()}`);
    debugLines.push(`profile: ${profile.name}`);
    debugLines.push(`command: ${profile.command}`);
    debugLines.push(`args: ${profile.args.join(" ")}`);
    debugLines.push(`version args: ${profile.versionArgs.join(" ")}`);
    debugLines.push(`cwd: ${cwd}`);
    debugLines.push(`cwd exists: ${cwdExists}`);
    debugLines.push(`env keys (存在性，不含 value): ${envKeys.length > 0 ? envKeys.join(", ") : "(none)"}`);

    // command 为空 → 直接 unavailable
    if (!profile.command) {
      debugLines.push("result: command 为空，跳过 version 探测");
      const debugLogPath = cwdExists ? writePreflightDebugLog(cwd, debugLines.join("\n") + "\n") : null;
      const diagnostics = buildDiagnostics(profile, cwdExists, false, null, "", "command 为空");
      resolve({
        profile: profile.name,
        command: profile.command,
        args: profile.args,
        versionArgs: profile.versionArgs,
        cwd,
        cwdExists,
        commandFound: false,
        versionExitCode: null,
        versionStdout: "",
        versionStderr: "",
        available: false,
        diagnostics,
        debugLogPath,
        skipReason: "command 为空",
      });
      return;
    }

    // cwd 不存在 → 直接 unavailable，不执行 version
    if (!cwdExists) {
      debugLines.push("result: cwd 不存在，跳过 version 探测");
      const debugLogPath = writePreflightDebugLog(cwd, debugLines.join("\n") + "\n");
      const diagnostics = buildDiagnostics(profile, false, false, null, "", "cwd 不存在");
      resolve({
        profile: profile.name,
        command: profile.command,
        args: profile.args,
        versionArgs: profile.versionArgs,
        cwd,
        cwdExists: false,
        commandFound: false,
        versionExitCode: null,
        versionStdout: "",
        versionStderr: "",
        available: false,
        diagnostics,
        debugLogPath,
        skipReason: null,
      });
      return;
    }

    // 执行 version 探测：spawnCompat 兼容 Windows .cmd/.ps1 垫片和带空格路径（无 shell:true DEP0190）
    let versionStdout = "";
    let versionStderr = "";
    let versionExitCode: number | null = null;
    let timedOut = false;
    let settled = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnCompat(profile.command, profile.versionArgs, {
        cwd,
        env,
        windowsHide: true,
      });
    } catch (e) {
      // spawn 同步异常
      const errMsg = `[spawn exception] ${(e as Error).message}`;
      debugLines.push(`result: spawn 异常 — ${errMsg}`);
      const debugLogPath = writePreflightDebugLog(cwd, debugLines.join("\n") + "\n");
      const diagnostics = buildDiagnostics(profile, cwdExists, false, null, "", errMsg);
      resolve({
        profile: profile.name,
        command: profile.command,
        args: profile.args,
        versionArgs: profile.versionArgs,
        cwd,
        cwdExists,
        commandFound: false,
        versionExitCode: null,
        versionStdout: "",
        versionStderr: errMsg,
        available: false,
        diagnostics,
        debugLogPath,
        skipReason: null,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { versionStdout += chunk; });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { versionStderr += chunk; });
    }

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const commandFound = !timedOut && code === 0;
      // 截断，避免过长输出
      const stdoutTrim = versionStdout.length > 500 ? versionStdout.slice(0, 500) + "..." : versionStdout;
      const stderrTrim = versionStderr.length > 500 ? versionStderr.slice(0, 500) + "..." : versionStderr;

      debugLines.push(`result: ${commandFound ? "available" : timedOut ? "timeout" : "unavailable"}`);
      debugLines.push(`exit code: ${code ?? "null"}`);
      debugLines.push(`timed out: ${timedOut}`);
      debugLines.push(`---- version stdout ----\n${stdoutTrim}`);
      debugLines.push(`---- version stderr ----\n${stderrTrim}`);
      const debugLogPath = writePreflightDebugLog(cwd, debugLines.join("\n") + "\n");

      const reason = timedOut ? "version 探测超时" : (code !== 0 ? `version 命令退出码 ${code}` : "");
      const diagnostics = buildDiagnostics(profile, cwdExists, commandFound, code, stdoutTrim, reason);

      resolve({
        profile: profile.name,
        command: profile.command,
        args: profile.args,
        versionArgs: profile.versionArgs,
        cwd,
        cwdExists,
        commandFound,
        versionExitCode: code,
        versionStdout: stdoutTrim,
        versionStderr: stderrTrim,
        available: cwdExists && commandFound,
        diagnostics,
        debugLogPath,
        skipReason: null,
      });
    };

    child.on("error", (err: Error) => {
      // ENOENT: command 不存在；EACCES: 权限不足
      const errnoCode = (err as NodeJS.ErrnoException).code;
      versionStderr += `[spawn error] ${err.message} (code: ${errnoCode ?? "unknown"})`;
      // error 事件后通常不会有 exit，直接以失败结束
      finish(errnoCode === "ENOENT" ? 127 : 1);
    });

    child.on("exit", (code) => {
      finish(code);
    });
  });
}

/**
 * 构造用户可读诊断摘要
 */
function buildDiagnostics(
  profile: CommandProfile,
  cwdExists: boolean,
  commandFound: boolean,
  exitCode: number | null,
  versionStdout: string,
  reason: string,
): string {
  const lines: string[] = [];
  lines.push(`[preflight] profile: ${profile.name}`);
  lines.push(`command: ${profile.command || "(empty)"}`);
  lines.push(`cwd: ${cwdExists ? "ok" : "missing"}`);
  if (!cwdExists) {
    lines.push(`status: unavailable (cwd 不存在)`);
  } else if (!profile.command) {
    lines.push(`status: unavailable (command 为空)`);
  } else if (commandFound) {
    lines.push(`status: available`);
    if (versionStdout.trim()) {
      lines.push(`version: ${versionStdout.trim().split("\n")[0]}`);
    }
  } else {
    lines.push(`status: unavailable (${reason || "version 探测失败"})`);
    if (exitCode !== null) lines.push(`exit code: ${exitCode}`);
  }
  return lines.join("\n");
}
