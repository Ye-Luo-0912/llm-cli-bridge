// LLM CLI Bridge — Claude CLI Backend
// 把现有 Claude CLI（spawn）调用逻辑封装为 AgentBackend 实现
// UI 层通过 AgentBackend 接口调用，不再直接接触 child_process

import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AgentBackend, AgentEvent, AgentEventHandler, AgentRunHandle, AgentTask } from "./agentBackend";
import { AgentType, LLMBridgeSettings, EffectiveRunPlan } from "./types";
import { buildCommandLine } from "./commandProfile";
import { AgentSkillsRuntimePreparationResult, prepareAgentSkillsForClaudeRuntimeSync } from "./agentSkills";
import { resolveClaudeRuntimeConfig } from "./claudeRuntimeConfig";
import { buildRuntimeSpawnEnv } from "./runtime/runtimeProfileResolver";
import { RuntimeFileToolAdapterResult, RuntimeFileToolCall, describeRuntimeFileToolAdapter } from "./runtimeFileToolAdapter";
import { redactSecrets } from "./workflowEvent";

// ---------- PATH 增强工具函数（从 runner.ts 迁移） ----------

// 安全的目录探测：存在且为目录则返回路径，否则返回 null
export function probeDir(p: string): string | null {
  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  } catch { /* ignore */ }
  return null;
}

// 扫描指定父目录下所有 semver 版本子目录的 installation/bin 子目录
// 适用于 fnm node-versions、nvm-windows、volta tools 等
export function scanVersionedDirs(parent: string, sub: string): string[] {
  const out: string[] = [];
  if (!probeDir(parent)) return out;
  try {
    for (const v of fs.readdirSync(parent)) {
      if (!/^v?\d+\.\d+\.\d+$/.test(v)) continue;
      const target = path.join(parent, v, sub);
      const d = probeDir(target);
      if (d) out.push(d);
    }
  } catch { /* ignore */ }
  return out;
}

// 构建 PATH 增量：Vault 局部优先（便携可移动），多版本管理器 + 全局 fallback
export function buildEnhancedPath(cwd: string): string {
  const paths: string[] = [];
  const win = process.platform === "win32";

  // 1. Vault 局部路径（便携版优先级最高，相对 cwd 健壮）
  paths.push(path.join(cwd, "LLM-AgentRuntime", "node_modules", ".bin"));
  paths.push(path.join(cwd, "..", "LLM-AgentRuntime", "node_modules", ".bin")); // V2.4: sibling 布局
  paths.push(path.join(cwd, "node_modules", ".bin"));
  paths.push(path.dirname(process.execPath));

  if (win) {
    // fnm：%FNM_DIR%/node-versions/v*/installation
    const fnmDir = process.env.FNM_DIR || path.join(process.env.APPDATA || "", "fnm", "node-versions");
    paths.push(...scanVersionedDirs(fnmDir, "installation"));

    // nvm-windows：%NVM_HOME%/v*/ 或 %NVM_SYMLINK%
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) paths.push(...scanVersionedDirs(nvmHome, ""));
    const nvmSymlink = process.env.NVM_SYMLINK || "C:\\Program Files\\nodejs";
    const ns = probeDir(nvmSymlink);
    if (ns) paths.push(ns);

    // Volta：%LOCALAPPDATA%\Volta\bin
    const volta = probeDir(path.join(process.env.LOCALAPPDATA || "", "Volta", "bin"));
    if (volta) paths.push(volta);

    // nvs：%NVS_HOME%
    const nvsHome = process.env.NVS_HOME || path.join(process.env.LOCALAPPDATA || "", "nvs");
    const nvs = probeDir(nvsHome);
    if (nvs) paths.push(nvs);

    // Scoop / Chocolatey
    const scoop = probeDir(path.join(process.env.USERPROFILE || "", "scoop", "shims"));
    if (scoop) paths.push(scoop);
    const choco = probeDir("C:\\ProgramData\\chocolatey\\bin");
    if (choco) paths.push(choco);

    // npm 全局 prefix（默认 %APPDATA%\npm）
    const npmGlobal = probeDir(path.join(process.env.APPDATA || "", "npm"));
    if (npmGlobal) paths.push(npmGlobal);
  } else {
    // macOS / Linux
    const home = process.env.HOME || "";

    // fnm（unix）
    const fnmDir = process.env.FNM_DIR || path.join(home, ".fnm", "node-versions");
    paths.push(...scanVersionedDirs(fnmDir, path.join("installation", "bin")));

    // nvm（unix）：~/.nvm/versions/node/v*/bin
    const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm");
    paths.push(...scanVersionedDirs(path.join(nvmDir, "versions", "node"), "bin"));

    // Volta（unix）：~/.volta/bin
    const volta = probeDir(path.join(home, ".volta", "bin"));
    if (volta) paths.push(volta);

    // asdf：~/.asdf/shims
    const asdf = probeDir(path.join(home, ".asdf", "shims"));
    if (asdf) paths.push(asdf);

    // Homebrew（Apple Silicon + Intel）
    const brewArm = probeDir("/opt/homebrew/bin");
    if (brewArm) paths.push(brewArm);
    const brewIntel = probeDir("/usr/local/bin");
    if (brewIntel) paths.push(brewIntel);

    // npm 全局（unix）
    const npmGlobal = probeDir(path.join(home, ".npm-global", "bin"));
    if (npmGlobal) paths.push(npmGlobal);
    const npmLib = probeDir("/usr/lib/node_modules/.bin");
    if (npmLib) paths.push(npmLib);
  }

  // 去重，保留顺序
  return [...new Set(paths)].join(path.delimiter);
}

// ---------- 环境变量构造（导出便于单元测试） ----------

/**
 * 构造运行环境变量（不泄露 secret 值）
 * - 优先使用项目级 Claude runtime config，其次自动发现 Vault 局部 runtime，再继承进程环境
 * - 用 UI 选择的 model / effort 覆盖（仅 claude）
 * - 增强 PATH：Vault 局部优先
 * V2.17-A: 当传入 EffectiveRunPlan 时，model/effort 从 plan 读取（CLI/SDK 单一真相源）。
 * @returns env 和诊断用的 envKey 列表（只含 key 名，不含 value）
 */
export function buildRunEnv(
  settings: LLMBridgeSettings,
  cwd: string,
  plan?: EffectiveRunPlan,
): { env: NodeJS.ProcessEnv; envKeys: string[] } {
  const env = { ...process.env };
  const envKeys: string[] = [];

  if (settings.agentType === "claude") {
    const runtimeConfig = resolveClaudeRuntimeConfig(cwd, env);
    delete env.ANTHROPIC_CONFIG_DIR;
    if (runtimeConfig.source === "project-json" || runtimeConfig.source === "auto-detected") {
      delete env.CLAUDE_CONFIG_DIR;
    }
    Object.assign(env, runtimeConfig.env);
    envKeys.push(...runtimeConfig.envKeys);

    // V2.17-A: model/effort 优先取自 EffectiveRunPlan
    const model = plan?.model ?? settings.model;
    const effort = plan?.effort ?? settings.effortLevel;
    if (model) {
      env.ANTHROPIC_MODEL = model;
      envKeys.push("ANTHROPIC_MODEL");
    }
    if (effort) {
      env.CLAUDE_CODE_EFFORT_LEVEL = effort;
      envKeys.push("CLAUDE_CODE_EFFORT_LEVEL");
    }
  }

  // V20.5: 通过 buildRuntimeSpawnEnv 注入 CLAUDE_CONFIG_DIR（本地配置存在时）+ ANTHROPIC_API_KEY。
  // Bridge 不再解析 Claude settings.local.json 内容——Claude 自己读取配置。
  try {
    const runtimeEnv = buildRuntimeSpawnEnv(cwd);
    for (const [k, v] of Object.entries(runtimeEnv)) {
      env[k] = v;
      envKeys.push(k);
    }
  } catch { /* fallthrough */ }

  // 增强 PATH
  const extraPath = buildEnhancedPath(cwd);
  if (extraPath) {
    env.PATH = extraPath + path.delimiter + (env.PATH || "");
    envKeys.push("PATH(enhanced)");
  }

  return { env, envKeys };
}

export async function executeCliRuntimeFileTool(task: AgentTask, call: RuntimeFileToolCall): Promise<RuntimeFileToolAdapterResult> {
  if (!task.runtimeFileToolAdapter) {
    return buildMissingRuntimeFileToolAdapterResult("cli", call.toolName);
  }
  return task.runtimeFileToolAdapter.execute(call);
}

function buildMissingRuntimeFileToolAdapterResult(kind: "cli", toolName: string): RuntimeFileToolAdapterResult {
  return {
    adapterKind: kind,
    toolName,
    status: "deny",
    reason: "runtime_file_tool_adapter_missing",
    output: JSON.stringify({ toolName, status: "deny", reason: "runtime_file_tool_adapter_missing" }, null, 2),
    isError: true,
    routeResult: { toolName, status: "deny", reason: "runtime_file_tool_adapter_missing" },
  };
}

// ---------- 诊断日志写入 ----------

/**
 * 写入调试日志到 .llm-bridge/logs/debug-<timestamp>.log
 * 只写本地文件，不通过 stderr_delta 推送（避免污染 UI）
 * 非开发者模式不写入；开发者模式写入时对敏感信息脱敏
 */
function writeDebugLog(cwd: string, content: string, developerMode: boolean): void {
  if (!developerMode) return;
  try {
    const logDir = path.join(cwd, ".llm-bridge", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(logDir, `debug-${ts}.log`);
    const redacted = redactSecrets(content);
    fs.writeFileSync(logPath, redacted, "utf8");
  } catch {
    // 写日志失败不影响主流程
  }
}

/**
 * 构造启动前诊断信息（不含 secret）
 */
function buildStartDiagnostic(
  command: string,
  args: string[],
  cwd: string,
  envKeys: string[],
  injectedPaths: string[],
  startTime: Date,
): string {
  const lines: string[] = [];
  lines.push("=== ClaudeCliBackend 启动诊断 ===");
  lines.push(`start time: ${startTime.toISOString()}`);
  lines.push(`command: ${command}`);
  lines.push(`args: ${args.join(" ")}`);
  lines.push(`cwd: ${cwd}`);
  lines.push(`cwd exists: ${fs.existsSync(cwd)}`);
  lines.push(`env keys (存在性，不含 value): ${envKeys.length > 0 ? envKeys.join(", ") : "(none)"}`);
  lines.push(`injected PATH dirs (${injectedPaths.length}):`);
  if (injectedPaths.length === 0) {
    lines.push("  (none)");
  } else {
    for (const p of injectedPaths) {
      let hint = "";
      try {
        const matches = fs.readdirSync(p).filter((f) => f.toLowerCase().startsWith(command.toLowerCase()));
        hint = matches.length > 0 ? ` [found: ${matches.slice(0, 3).join(", ")}]` : " [no match]";
      } catch {
        hint = " [unreadable]";
      }
      lines.push(`  ${p}${hint}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * 构造失败诊断摘要（用户可见，简短）
 */
function buildFailureSummary(
  command: string,
  exitCode: number | null,
  stderr: string,
  cwd: string,
): string {
  const lines: string[] = [];
  // stderr 摘要：取最后 500 字符，避免过长
  const stderrTail = stderr.length > 500 ? "..." + stderr.slice(-500) : stderr;
  lines.push(`[failed] command: ${command}`);
  lines.push(`exit code: ${exitCode ?? "null"}`);
  if (!fs.existsSync(cwd)) {
    lines.push(`reason: cwd 不存在 (${cwd})`);
  } else if (stderrTail.trim()) {
    lines.push(`stderr 摘要:\n${stderrTail.trim()}`);
  } else {
    lines.push("reason: 进程启动失败（无 stderr 输出）");
  }
  return lines.join("\n") + "\n";
}

function buildAgentSkillsRuntimeDiagnostic(result: AgentSkillsRuntimePreparationResult): string {
  const lines: string[] = [];
  lines.push("\n=== Agent Skills Runtime ===");
  lines.push(`enabled count: ${result.enabledCount}`);
  lines.push(`saved manifest: ${result.saved}`);
  if (result.results.length === 0) {
    lines.push("materialized: (none)");
  } else {
    for (const item of result.results) {
      lines.push(`- ${item.record.slug}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`);
    }
  }
  if (result.reason) {
    lines.push(`reason: ${result.reason}`);
  }
  return lines.join("\n") + "\n";
}

function buildAgentSkillsRuntimeFailureSummary(result: AgentSkillsRuntimePreparationResult): string {
  const lines: string[] = [];
  lines.push("[failed] Agent Skills runtime preparation failed");
  lines.push(`enabled skills: ${result.enabledCount}`);
  if (result.reason) {
    lines.push(`reason: ${result.reason}`);
  }
  for (const item of result.results.filter((r) => !r.ok)) {
    lines.push(`- ${item.record.slug}: ${item.reason || item.status}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- 命令解析（V1.5: 委托给 commandProfile.ts 统一构造） ----------

export interface ResolvedCommand {
  command: string;
  args: string[];
}

/**
 * 解析命令（V1.5: 委托给 commandProfile.buildCommandLine，含 Claude 动态参数）
 * 保留导出以兼容现有测试与外部引用
 */
export function resolveCommand(settings: LLMBridgeSettings): ResolvedCommand {
  const { command, args } = buildCommandLine(settings, "");
  return { command, args };
}

// ---------- ClaudeCliBackend 实现 ----------

/**
 * Claude CLI Backend
 * 通过 child_process.spawn 调用 Claude Code CLI（claude -p）
 * 实现 AgentBackend 接口，UI 层通过接口调用
 *
 * V0.3 加固：
 * - 诊断信息分层：stderr_delta 只推真实 CLI stderr；详细诊断写 debug log
 * - Windows 空格路径：spawn shell:true 自动处理，env PATH 正确拼接
 * - cwd 不存在 / command 不存在 / 权限不足 → 统一转 failed event
 * - stop() 稳定终止，多次调用不抛异常
 */
export class ClaudeCliBackend implements AgentBackend {
  readonly name = "claude-cli";

  run(task: AgentTask, settings: LLMBridgeSettings, onEvent: AgentEventHandler): AgentRunHandle {
    // V1.5: 使用 commandProfile.buildCommandLine 统一构造（含 Claude 动态参数）
    const { command, args } = buildCommandLine(settings, task.cwd);
    const startTime = new Date();
    const startedAt = Date.now();
    let stdout = "";
    let stderr = ""; // 真实 CLI stderr（用户可见）
    let debugLog = ""; // 详细诊断日志（只写文件，不推 UI）
    let exited = false;
    let stopped = false;
    let child: ChildProcess | null = null;
    let spawnFailed = false; // spawn 同步异常标记

    // 发出 started 事件
    onEvent({ type: "started", task });

    // 构造环境变量（V2.17-A: 传入 EffectiveRunPlan，model/effort 取自单一真相源）
    const { env, envKeys } = buildRunEnv(settings, task.cwd, task.effectiveRunPlan);
    const extraPath = buildEnhancedPath(task.cwd);
    const injectedPaths = extraPath ? extraPath.split(path.delimiter) : [];

    // 构造启动诊断并写入 debug log
    const startDiag = buildStartDiagnostic(command, args, task.cwd, envKeys, injectedPaths, startTime);
    debugLog += startDiag;
    debugLog += `\n=== Runtime File Tools ===\n${describeRuntimeFileToolAdapter(task.runtimeFileToolAdapter)}\n`;

    // spawn 前检查 cwd
    if (!fs.existsSync(task.cwd)) {
      spawnFailed = true;
      const reason = `cwd 不存在: ${task.cwd}\n`;
      debugLog += `[pre-spawn check failed] ${reason}`;
      writeDebugLog(task.cwd, debugLog, !!settings.developerMode);
      // 用户可见的失败摘要
      const summary = buildFailureSummary(command, null, "", task.cwd);
      stderr = summary;
      onEvent({ type: "failed", exitCode: null, durationMs: 0, stdout, stderr, command, args });
      return {
        get running(): boolean { return false; },
        stop(): void { /* no-op */ },
      };
    }

    if (settings.agentType === "claude") {
      const agentSkillsRuntime = prepareAgentSkillsForClaudeRuntimeSync(task.cwd);
      debugLog += buildAgentSkillsRuntimeDiagnostic(agentSkillsRuntime);
      if (!agentSkillsRuntime.ok) {
        spawnFailed = true;
        writeDebugLog(task.cwd, debugLog, !!settings.developerMode);
        stderr = buildAgentSkillsRuntimeFailureSummary(agentSkillsRuntime);
        onEvent({ type: "failed", exitCode: null, durationMs: 0, stdout, stderr, command, args });
        return {
          get running(): boolean { return false; },
          stop(): void { /* no-op */ },
        };
      }
    } else {
      debugLog += "\n=== Agent Skills Runtime ===\nskipped: agentType is not claude\n";
    }

    // spawn：使用 shell:true 兼容 Windows .cmd/.ps1 垫片和带空格的路径
    // 注意：shell:true 下 command 字符串由 shell 解析，带空格的路径需用引号包裹
    // 但 Node.js spawn shell:true 会自动处理，无需额外引号
    try {
      child = spawn(command, args, {
        cwd: task.cwd,
        shell: true,
        env,
        windowsHide: true,
      });
    } catch (e) {
      // spawn 同步异常（如权限不足）
      spawnFailed = true;
      const err = e as Error;
      const errMsg = `[spawn exception] ${err.message}\n`;
      debugLog += errMsg;
      writeDebugLog(task.cwd, debugLog, !!settings.developerMode);
      const summary = buildFailureSummary(command, null, errMsg, task.cwd);
      stderr = summary;
      onEvent({ type: "failed", exitCode: null, durationMs: 0, stdout, stderr, command, args });
      return {
        get running(): boolean { return false; },
        stop(): void { /* no-op */ },
      };
    }

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (exited) return;
      exited = true;
      const durationMs = Date.now() - startedAt;

      // 构造完整 debug log 并写入文件
      debugLog += `\n=== 进程结束 ===\n`;
      debugLog += `exit code: ${exitCode ?? "null"}\n`;
      debugLog += `signal: ${signal ?? "-"}\n`;
      debugLog += `duration ms: ${durationMs}\n`;
      debugLog += `stdout length: ${stdout.length}\n`;
      debugLog += `stderr length: ${stderr.length}\n`;
      debugLog += `---- stderr (full) ----\n${stderr}\n`;
      writeDebugLog(task.cwd, debugLog, !!settings.developerMode);

      // 根据退出状态发出对应事件
      if (stopped) {
        // stopped 模式：用户可见的 stderr 保持真实 CLI 输出
        onEvent({ type: "stopped", exitCode, durationMs, stdout, stderr, command, args });
      } else if (exitCode === 0) {
        onEvent({ type: "completed", exitCode, durationMs, stdout, stderr, command, args });
      } else {
        // failed 模式：stderr 追加简短失败摘要（用户可见）
        const summary = buildFailureSummary(command, exitCode, stderr, task.cwd);
        onEvent({ type: "failed", exitCode, durationMs, stdout, stderr: summary, command, args });
      }
      child = null;
    };

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        onEvent({ type: "stdout_delta", data: chunk });
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        // 真实 CLI stderr → 通过 stderr_delta 推送（用户可见）
        stderr += chunk;
        onEvent({ type: "stderr_delta", data: chunk });
      });
    }

    child.on("error", (err: Error) => {
      // spawn 异步错误（如 ENOENT command 不存在、EACCES 权限不足）
      const errnoCode = (err as NodeJS.ErrnoException).code;
      const errMsg = `[spawn error] ${err.message} (code: ${errnoCode ?? "unknown"})\n`;
      debugLog += errMsg;
      // 真实错误信息通过 stderr_delta 推送给用户
      stderr += errMsg;
      onEvent({ type: "stderr_delta", data: errMsg });
      finish(1, null);
    });

    child.on("exit", (code, signal) => {
      finish(code, signal);
    });

    // prompt 通过 stdin 传入，避免命令行长度限制
    if (child.stdin) {
      try {
        child.stdin.write(task.prompt, "utf8");
        child.stdin.end();
      } catch (e) {
        const errMsg = `[stdin error] ${(e as Error).message}\n`;
        debugLog += errMsg;
        stderr += errMsg;
        onEvent({ type: "stderr_delta", data: errMsg });
      }
    }

    // 返回句柄
    return {
      get running(): boolean {
        return child !== null && !exited && !spawnFailed;
      },
      stop(): void {
        if (!child || exited) return;
        stopped = true;
        const pid = child.pid;
        try {
          if (process.platform === "win32" && pid) {
            // Windows 下 shell:true 会产生中间 shell，需杀整棵进程树
            spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
              shell: true,
              windowsHide: true,
            });
          } else {
            child.kill("SIGTERM");
          }
        } catch {
          // 终止失败不抛异常，finish() 会通过 exit 事件触发
        }
      },
    };
  }
}
