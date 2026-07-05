// LLM CLI Bridge — PiRpcProvider (V17-A Portable Backend Spike)
//
// 只验证 Pi 能否作为 portable backend，不替换主架构。
//
// 定位：
// - Pi 是 portable backend 候选，通过 `pi --mode rpc` 启动 JSONL-over-stdio 通信。
// - 本 provider 是 spike：协议细节未知时做保守最小实现。
// - 未安装 pi 时 isAvailable=false，不崩溃，run() 直接发 failed 事件。
//
// 权限边界（任务 C.3）：
// - 第一阶段禁止 Pi 默认 write/edit/bash 直通。
// - Pi 输出的 tool_use 写操作映射为 approval_request 事件，由 Bridge PermissionBoundary 审批。
// - Pi provider 不直接执行 Vault 写操作；写操作必须回到 Bridge approval card。
// - 不能拦截 Pi 内置工具时，Pi backend 只作为 plan/read-only spike。
//
// Prompt 拆分映射（同 claude-cli）：
// - pi-rpc: bridgeSystemAppend + "\n\n" + userPrompt 合成 stdin

import type { LLMBridgeSettings } from "../../../types";
import { buildAttachmentPlan, buildEffectiveRunPlan } from "../../../effectiveRunPlan";
import type {
  EffectiveRunPlan,
  NormalizedRuntimeEvent,
  RunContext,
  RunInput,
  RuntimeProvider,
} from "../../core/types";
import { composePromptForBackend } from "../agentBackendAdapter";

// 运行时动态 require（避免顶层 import 导致 renderer 加载失败）
function requireNode<T>(name: string): T {
  const g = globalThis as unknown as { require?: (n: string) => T };
  if (g.require) return g.require(name);
  return (require as (n: string) => T)(name);
}

interface ChildProcessSpawnSync {
  spawnSync(command: string, args: ReadonlyArray<string>, options: { cwd?: string; encoding?: string; timeout?: number }): {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
}

interface ChildProcessSpawn {
  spawn(command: string, args: ReadonlyArray<string>, options: { cwd?: string; env?: NodeJS.ProcessEnv }): {
    pid: number;
    stdin: { write(chunk: string | Buffer): boolean; end(): void; on(event: string, listener: (...args: unknown[]) => void): void };
    stdout: { on(event: string, listener: (...args: unknown[]) => void): void };
    stderr: { on(event: string, listener: (...args: unknown[]) => void): void };
    on(event: string, listener: (...args: unknown[]) => void): void;
    kill(signal?: string): boolean;
  };
}

// ---------- Pi 探测 ----------

export interface PiProbeResult {
  /** pi 命令是否存在且可执行 */
  readonly available: boolean;
  /** pi --mode rpc 是否可用（available && rpc 帮助可解析） */
  readonly rpcSupported: boolean;
  /** pi 版本字符串（从 --version 输出提取） */
  readonly version: string | null;
  readonly reason: "installed" | "not-found" | "rpc-unsupported" | "probe-error";
  readonly error?: string;
}

/** 探测结果缓存（同一命令短时间不重复探测） */
const probeCache = new Map<string, { result: PiProbeResult; ts: number }>();
const PROBE_CACHE_TTL_MS = 30_000;

/**
 * V17-A 任务 C.1：探测 Pi 是否可用作 portable backend。
 *
 * - 检查 `pi --version` 是否可执行
 * - 检查 `pi --mode rpc --help`（或 --help 中是否含 rpc）判断 rpc 支持
 * - 未安装时返回 available=false，reason=not-found，不抛错
 */
export function probePi(piCommand: string, options: { readonly cwd?: string; readonly force?: boolean } = {}): PiProbeResult {
  const cacheKey = `${piCommand}`;
  const now = Date.now();
  if (!options.force) {
    const cached = probeCache.get(cacheKey);
    if (cached && now - cached.ts < PROBE_CACHE_TTL_MS) return cached.result;
  }

  let childSync: ChildProcessSpawnSync;
  try {
    childSync = requireNode<ChildProcessSpawnSync>("child_process");
  } catch (e) {
    const result: PiProbeResult = {
      available: false,
      rpcSupported: false,
      version: null,
      reason: "probe-error",
      error: e instanceof Error ? e.message : String(e),
    };
    probeCache.set(cacheKey, { result, ts: now });
    return result;
  }

  // 步骤 1: pi --version
  let versionOut = "";
  let versionErr = "";
  let versionStatus: number | null = null;
  let probeError: string | undefined;
  try {
    const r = childSync.spawnSync(piCommand, ["--version"], {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    versionStatus = r.status;
    versionOut = (r.stdout || "").trim();
    versionErr = (r.stderr || "").trim();
    if (r.error) probeError = r.error.message;
  } catch (e) {
    probeError = e instanceof Error ? e.message : String(e);
  }

  // 命令不存在 / 非零退出 → not-found
  if (versionStatus === null && probeError) {
    const isNotFound = /not found|no such file|ENOENT|command not found/i.test(probeError);
    const result: PiProbeResult = {
      available: false,
      rpcSupported: false,
      version: null,
      reason: isNotFound ? "not-found" : "probe-error",
      error: probeError,
    };
    probeCache.set(cacheKey, { result, ts: now });
    return result;
  }
  if (versionStatus !== 0) {
    const result: PiProbeResult = {
      available: false,
      rpcSupported: false,
      version: null,
      reason: "not-found",
      error: versionErr || `pi --version exit ${versionStatus}`,
    };
    probeCache.set(cacheKey, { result, ts: now });
    return result;
  }

  // pi 已安装，提取版本
  const version = versionOut || versionErr || null;

  // 步骤 2: 检查 rpc 支持（pi --help 或 pi --mode rpc --help）
  let rpcSupported = false;
  try {
    const helpR = childSync.spawnSync(piCommand, ["--help"], {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    const helpText = `${helpR.stdout || ""}\n${helpR.stderr || ""}`;
    rpcSupported = /--mode|rpc/i.test(helpText);
  } catch {
    // help 失败不致命，保守认为 rpc 不支持
    rpcSupported = false;
  }

  const result: PiProbeResult = {
    available: true,
    rpcSupported,
    version,
    reason: rpcSupported ? "installed" : "rpc-unsupported",
  };
  probeCache.set(cacheKey, { result, ts: now });
  return result;
}

/** 清除探测缓存（测试用） */
export function clearPiProbeCache(): void {
  probeCache.clear();
}

// ---------- 写工具判定（任务 C.3 权限边界） ----------

const WRITE_TOOL_NAMES = new Set([
  "write", "edit", "multiedit", "bash", "shell", "command", "terminal",
  "delete", "remove", "rm", "mkdir", "mv", "rename", "notebookedit",
]);

/** 判断 Pi 输出的 tool_use 是否为写/命令操作（需 approval）。导出用于测试。 */
export function isWriteToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  if (WRITE_TOOL_NAMES.has(lower)) return true;
  return /write|edit|bash|shell|command|terminal|delete|remove|rename/i.test(lower);
}

// ---------- PiRpcProvider ----------

/**
 * V17-A 任务 C.2：Pi RPC Provider prototype。
 *
 * 启动 `pi --mode rpc`，stdin 发送 prompt，stdout JSONL 映射到 NormalizedRuntimeEvent。
 * abort 时 kill 进程。未安装 pi 时 isAvailable=false，run() 发 failed 事件不崩溃。
 */
export class PiRpcProvider implements RuntimeProvider {
  readonly providerId = "pi-rpc" as const;
  readonly displayName = "Pi RPC";
  private currentChild: { kill(signal?: string): boolean; pid: number } | null = null;
  private readonly probe: PiProbeResult;

  constructor(piCommand: string, options: { readonly cwd?: string } = {}) {
    this.probe = probePi(piCommand, options);
  }

  isAvailable(_cwd: string): boolean {
    return this.probe.available && this.probe.rpcSupported;
  }

  /** 暴露探测结果（测试/UI 用） */
  getProbeResult(): PiProbeResult {
    return this.probe;
  }

  buildPlan(input: RunInput, settings: LLMBridgeSettings): EffectiveRunPlan {
    const attachmentPlan = buildAttachmentPlan(input.promptPackage.attachmentEntries);
    return buildEffectiveRunPlan({
      backend: "cli", // Pi 复用 cli plan 字段（promptPackage 审计用）
      settings,
      cwd: input.cwd,
      promptPackageText: input.promptPackage.auditHash,
      settingSources: [],
      skills: [],
      attachmentPlan,
    });
  }

  async *run(ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // 未安装 / rpc 不支持：直接发 failed，不崩溃
    if (!this.probe.available) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "failed", message: `Pi 未安装或不可用：${this.probe.reason}${this.probe.error ? " — " + this.probe.error : ""}`, recoverable: true },
      };
      return;
    }
    if (!this.probe.rpcSupported) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "failed", message: `Pi 不支持 --mode rpc（版本：${this.probe.version ?? "unknown"}）`, recoverable: true },
      };
      return;
    }

    let childSpawn: ChildProcessSpawn;
    try {
      childSpawn = requireNode<ChildProcessSpawn>("child_process");
    } catch (e) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "failed", message: `无法加载 child_process：${e instanceof Error ? e.message : String(e)}`, recoverable: false },
      };
      return;
    }

    // 组装 prompt（同 claude-cli：bridgeSystemAppend + userPrompt）
    const prompt = composePromptForBackend(ctx, "cli");
    const args = settings.piArgs ? settings.piArgs.split(/\s+/).filter((a) => a.length > 0) : ["--mode", "rpc"];
    // session-dir 指向 LLM-AgentRuntime/pi-sessions/（不污染 Vault 根目录）
    const sessionDir = "LLM-AgentRuntime/pi-sessions";

    let child: ReturnType<ChildProcessSpawn["spawn"]>;
    try {
      child = childSpawn.spawn(settings.piCommand || "pi", args, {
        cwd: ctx.plan.cwd,
        env: { ...process.env, PI_SESSION_DIR: sessionDir },
      });
      this.currentChild = child;
    } catch (e) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "failed", message: `Pi 启动失败：${e instanceof Error ? e.message : String(e)}`, recoverable: true },
      };
      return;
    }

    yield {
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
      payload: { kind: "session_started", text: `Pi RPC started (pid=${child.pid})` },
    };

    // stdin 写 prompt
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (e) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "error", message: `stdin 写入失败：${e instanceof Error ? e.message : String(e)}`, recoverable: true },
      };
    }

    // stdout JSONL 解析（异步事件流）
    const stream = createAsyncEventStream();
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let exitCode: number | null = null;
    let processExited = false;

    child.stdout.on("data", (chunk: unknown) => {
      stdoutBuffer += typeof chunk === "string" ? chunk : String(chunk);
      let idx: number;
      while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        if (line.length === 0) continue;
        for (const evt of parsePiJsonlLine(line, this.providerId)) {
          stream.push(evt);
        }
      }
    });

    child.stderr.on("data", (chunk: unknown) => {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      stderrBuffer += text;
      stream.push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "stderr_delta", data: text },
      });
    });

    child.on("exit", (code: unknown) => {
      exitCode = typeof code === "number" ? code : null;
      processExited = true;
      stream.push(null); // 哨兵：流结束
    });
    child.on("error", (err: unknown) => {
      stream.push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "error", message: `Pi 进程错误：${err instanceof Error ? err.message : String(err)}`, recoverable: false },
      });
      stream.push(null);
    });

    // 消费事件流（哨兵 null 时自动结束迭代）
    for await (const evt of stream.iterate()) {
      yield evt;
    }

    this.currentChild = null;

    // 进程结束后发 completed/failed
    if (processExited && exitCode !== null && exitCode !== 0) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "failed", message: `Pi 退出码 ${exitCode}${stderrBuffer ? "；stderr: " + stderrBuffer.slice(0, 500) : ""}`, recoverable: true },
      };
    } else {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "completed", text: "Pi run completed", durationMs: undefined },
      };
    }
  }

  cancel(_runId: string): void {
    if (this.currentChild) {
      try {
        this.currentChild.kill("SIGTERM");
      } catch { /* ignore */ }
      this.currentChild = null;
    }
  }

  async *resume(_sessionId: string, ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // Pi spike 不支持 resume，直接复用 run 路径
    yield* this.run(ctx, settings);
  }
}

// ---------- JSONL 解析 ----------

/**
 * 解析 Pi stdout 的单行 JSONL，映射为 NormalizedRuntimeEvent。
 *
 * Spike 阶段保守解析：识别常见字段 type/text/message/role/content/tool。
 * 无法识别的行作为 stdout_delta（developerMode 可见）。
 *
 * 任务 C.3：写工具调用映射为 approval_request（不直接执行）。
 */
export function parsePiJsonlLine(line: string, providerId: "pi-rpc"): NormalizedRuntimeEvent[] {
  const ts = new Date().toISOString();
  const events: NormalizedRuntimeEvent[] = [];

  // 尝试 JSON 解析
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    // 非 JSON：作为 stdout_delta
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "stdout_delta", data: line },
    });
    return events;
  }

  if (typeof obj !== "object" || obj === null) {
    events.push({ providerId, timestamp: ts, payload: { kind: "stdout_delta", data: line } });
    return events;
  }

  const o = obj as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "";
  const text = typeof o.text === "string" ? o.text
    : typeof o.message === "string" ? o.message
    : typeof o.content === "string" ? o.content
    : "";
  const role = typeof o.role === "string" ? o.role : "assistant";

  // 通用进度/思考
  if (type === "thinking" || type === "thought" || /think/i.test(type)) {
    events.push({ providerId, timestamp: ts, payload: { kind: "thinking", text } });
    return events;
  }

  // 消息
  if (type === "message" || type === "text" || type === "assistant" || type === "response" || text.length > 0) {
    events.push({
      providerId,
      timestamp: ts,
      payload: {
        kind: "message",
        role: role === "system" ? "system" : "assistant",
        text,
        partial: o.partial === true,
      },
    });
    return events;
  }

  // 工具调用（任务 C.3：写工具映射为 approval_request）
  if (type === "tool_use" || type === "tool_call" || type === "function_call") {
    const toolName = typeof o.name === "string" ? o.name : (typeof o.tool === "string" ? o.tool : "unknown");
    const toolInput = typeof o.input === "string" ? o.input : (o.input ? JSON.stringify(o.input) : "");
    const callId = typeof o.id === "string" ? o.id : `pi-${Date.now()}`;

    if (isWriteToolCall(toolName)) {
      // 写工具：映射为 approval_request，由 Bridge PermissionBoundary 审批，不直接执行
      events.push({
        providerId,
        timestamp: ts,
        payload: {
          kind: "approval_request",
          requestId: callId,
          toolName,
          description: `Pi 请求执行 ${toolName}`,
          riskLevel: "medium",
          riskReason: "Pi portable backend spike — 写操作需 Bridge approval",
          inputSummary: toolInput.slice(0, 200),
        },
      });
    } else {
      // 读工具：作为 tool_start/tool_result（read-only 不需 approval）
      events.push({
        providerId,
        timestamp: ts,
        payload: { kind: "tool_start", toolName, toolInput, callId },
      });
    }
    return events;
  }

  // 完成
  if (type === "completed" || type === "done" || type === "finish") {
    events.push({ providerId, timestamp: ts, payload: { kind: "completed", text: text || "done" } });
    return events;
  }

  // 错误
  if (type === "error" || type === "failed") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "error", message: text || "Pi error", recoverable: typeof o.recoverable === "boolean" ? o.recoverable : true },
    });
    return events;
  }

  // 文件变更
  if (type === "file_change" || type === "file") {
    const action = typeof o.action === "string" ? o.action : "modify";
    const path = typeof o.path === "string" ? o.path : "";
    if (path) {
      events.push({
        providerId,
        timestamp: ts,
        payload: {
          kind: "file_change",
          action: action === "create" ? "create" : action === "delete" ? "delete" : "modify",
          path,
        },
      });
    }
    return events;
  }

  // 未识别 JSON：作为 stdout_delta
  events.push({ providerId, timestamp: ts, payload: { kind: "stdout_delta", data: line } });
  return events;
}

// ---------- 简单异步事件队列 ----------

/**
 * 简单的异步事件队列：把 child_process 的 EventEmitter 回调包装为 async iterable。
 * push(null) 作为哨兵表示结束。
 */
function createAsyncEventStream(): {
  push: (item: NormalizedRuntimeEvent | null) => void;
  iterate: () => AsyncIterable<NormalizedRuntimeEvent>;
} {
  const buffer: (NormalizedRuntimeEvent | null)[] = [];
  let waiter: (() => void) | null = null;

  return {
    push(item) {
      buffer.push(item);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    },
    iterate() {
      const self = this;
      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            if (buffer.length > 0) {
              const item = buffer.shift();
              if (item === null || item === undefined) return;
              yield item as NormalizedRuntimeEvent;
            } else {
              await new Promise<void>((resolve) => { waiter = resolve; });
            }
          }
        },
      };
    },
  };
}
