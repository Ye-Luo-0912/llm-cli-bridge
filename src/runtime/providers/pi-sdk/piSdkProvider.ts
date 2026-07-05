// LLM CLI Bridge — PiSdkProvider (V17-B Pi SDK Provider Adapter)
//
// 使用 @earendil-works/pi-coding-agent 的 SDK 嵌入模式（createAgentSession / AgentSession），
// 而不是 pi --mode rpc 子进程。作为 portable profile 的 portable backend 主线。
//
// 定位：
// - Pi SDK 是朋友版 portable backend 主线候选。
// - pi-rpc 保留为实验 fallback；portable 主线切到 pi-sdk。
// - 未安装或 import 失败时 isAvailable=false，run() 直接发 failed 事件，不崩溃。
//
// 权限边界（任务 C）：
// - 不使用 Pi 默认 write/edit/bash 直通。
// - 通过 SDK 自定义 tools 拦截：tools=["read"] + excludeTools=["edit","write","bash"] +
//   customTools=[bridgeWriteTool, bridgeEditTool, bridgeBashTool]。
// - 自定义工具的 execute 内部调用 ctx.permission.requestApproval + waitForApproval：
//   - accept → 调用 Bridge-controlled executor（暂为占位，后续接 runtimeFileToolAdapter）
//   - decline → 返回 tool error/result 给 Pi
// - read 走 Pi 内置 Read（read-only adapter）。
//
// 事件映射（任务 D）：
// - message_update + text_delta → message partial
// - message_update + thinking_delta → thinking
// - tool_execution_start → tool_start
// - tool_execution_update → progress
// - tool_execution_end → tool_result
// - agent_start → session_started
// - agent_end → completed
// - error → error/failed
// - raw provider event 仅在 developerMode 下保留（通过 rawProviderEvent 字段）

import type { LLMBridgeSettings } from "../../../types";
import { buildAttachmentPlan, buildEffectiveRunPlan } from "../../../effectiveRunPlan";
import type {
  EffectiveRunPlan,
  NormalizedRuntimeEvent,
  RunContext,
  RunInput,
  RuntimeProvider,
  ProviderId,
  PermissionBoundary,
  ApprovalRequest,
} from "../../core/types";
import { composePromptForBackend } from "../agentBackendAdapter";

// 运行时动态 require（避免顶层 import 导致 renderer 加载失败 / 包未安装时崩溃）
function requireNode<T>(name: string): T | null {
  try {
    const g = globalThis as unknown as { require?: (n: string) => T };
    if (g.require) return g.require(name);
    return (require as (n: string) => T)(name);
  } catch {
    return null;
  }
}

// ---------- Pi SDK 加载 ----------

/**
 * Pi SDK 模块接口（仅声明我们用到的 API surface）。
 *
 * 实际包 @earendil-works/pi-coding-agent 未在 devDependencies 中（朋友版可选依赖）。
 * import 失败时 provider unavailable，不崩溃。
 */
export interface PiSdkModule {
  createAgentSession(options: Record<string, unknown>): Promise<{
    session: AgentSessionLike;
    extensionsResult?: unknown;
    modelFallbackMessage?: string;
  }>;
  defineTool?(definition: ToolDefinition): unknown;
  SessionManager?: { inMemory(): unknown; create(cwd: string): unknown };
  AuthStorage?: { create(): unknown };
  ModelRegistry?: { create(authStorage: unknown): unknown };
  DefaultResourceLoader?: new (options: Record<string, unknown>) => { reload(): Promise<void> };
  SettingsManager?: { inMemory(overrides?: Record<string, unknown>): unknown };
}

export interface AgentSessionLike {
  readonly sessionId: string;
  prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  subscribe(listener: (event: PiSdkEvent) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
  readonly isStreaming: boolean;
}

/** Pi SDK 事件（判别联合 — 仅声明我们识别的字段） */
export interface PiSdkEvent {
  readonly type: string;
  readonly assistantMessageEvent?: {
    readonly type: string; // text_delta | thinking_delta | toolcall_start | ...
    readonly delta?: string;
    readonly toolCall?: { readonly name: string; readonly input?: unknown };
  };
  readonly toolName?: string;
  readonly partialResult?: unknown;
  readonly isError?: boolean;
  readonly messages?: ReadonlyArray<unknown>;
  readonly reason?: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly finalError?: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly label?: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly execute: (args: Record<string, unknown>) => Promise<{
    content: ReadonlyArray<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
}

/** tryLoadPiSdk 探测结果 */
export interface PiSdkProbeResult {
  readonly available: boolean;
  readonly module: PiSdkModule | null;
  readonly reason: "installed" | "not-installed" | "load-error";
  readonly error?: string;
}

const probeCache: { result: PiSdkProbeResult | null; ts: number } = { result: null, ts: 0 };
const PROBE_CACHE_TTL_MS = 30_000;

/** 清除探测缓存（测试用） */
export function clearPiSdkProbeCache(): void {
  probeCache.result = null;
  probeCache.ts = 0;
}

/**
 * V17-B 任务 A：尝试加载 @earendil-works/pi-coding-agent SDK。
 *
 * - 包未安装时返回 available=false，reason=not-installed
 * - require 失败时返回 available=false，reason=load-error
 * - 不抛错
 */
export function tryLoadPiSdk(force = false): PiSdkProbeResult {
  const now = Date.now();
  if (!force && probeCache.result && now - probeCache.ts < PROBE_CACHE_TTL_MS) {
    return probeCache.result;
  }

  const mod = requireNode<PiSdkModule>("@earendil-works/pi-coding-agent");
  if (mod && typeof mod.createAgentSession === "function") {
    const result: PiSdkProbeResult = {
      available: true,
      module: mod,
      reason: "installed",
    };
    probeCache.result = result;
    probeCache.ts = now;
    return result;
  }

  // require 返回 null 或 API surface 不全
  const result: PiSdkProbeResult = {
    available: false,
    module: null,
    reason: mod ? "load-error" : "not-installed",
    error: mod ? "createAgentSession export missing" : "package @earendil-works/pi-coding-agent not installed",
  };
  probeCache.result = result;
  probeCache.ts = now;
  return result;
}

// ---------- 写工具判定（任务 C 权限边界） ----------

const WRITE_TOOL_NAMES = new Set([
  "write", "edit", "multiedit", "bash", "shell", "command", "terminal",
  "delete", "remove", "rm", "mkdir", "mv", "rename", "notebookedit",
]);

/** 判断 Pi SDK 工具调用是否为写/命令操作（需 approval）。导出用于测试。 */
export function isWriteToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  if (WRITE_TOOL_NAMES.has(lower)) return true;
  return /write|edit|bash|shell|command|terminal|delete|remove|rename/i.test(lower);
}

// ---------- 事件映射（任务 D） ----------

/**
 * 把 Pi SDK event 映射为 NormalizedRuntimeEvent[]。
 *
 * 纯函数（不依赖 provider 实例），导出供单元测试。
 * rawProviderEvent 由调用方根据 developerMode 决定是否填充。
 */
export function mapPiSdkEvent(
  event: PiSdkEvent,
  providerId: ProviderId,
): NormalizedRuntimeEvent[] {
  const ts = new Date().toISOString();
  const events: NormalizedRuntimeEvent[] = [];
  const type = event.type;

  // message_update — 流式文本/思考/工具调用开始
  if (type === "message_update" && event.assistantMessageEvent) {
    const ame = event.assistantMessageEvent;
    if (ame.type === "text_delta" && typeof ame.delta === "string") {
      events.push({
        providerId,
        timestamp: ts,
        payload: { kind: "message", role: "assistant", text: ame.delta, partial: true },
      });
      return events;
    }
    if (ame.type === "thinking_delta" && typeof ame.delta === "string") {
      events.push({
        providerId,
        timestamp: ts,
        payload: { kind: "thinking", text: ame.delta },
      });
      return events;
    }
    if (ame.type === "toolcall_start" && ame.toolCall) {
      const toolName = ame.toolCall.name || "unknown";
      const toolInput = ame.toolCall.input ? JSON.stringify(ame.toolCall.input) : "";
      const callId = `pi-sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // 写工具 → approval_request（任务 C：不直通）
      if (isWriteToolCall(toolName)) {
        events.push({
          providerId,
          timestamp: ts,
          payload: {
            kind: "approval_request",
            requestId: callId,
            toolName,
            description: `Pi SDK 请求执行 ${toolName}`,
            riskLevel: "medium",
            riskReason: "Pi portable backend — 写操作需 Bridge approval",
            inputSummary: toolInput.slice(0, 200),
          },
        });
      } else {
        events.push({
          providerId,
          timestamp: ts,
          payload: { kind: "tool_start", toolName, toolInput, callId },
        });
      }
      return events;
    }
    // 其他 assistantMessageEvent 类型：作为 progress
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "progress", label: `message_update:${ame.type}`, category: "tool" },
    });
    return events;
  }

  // tool_execution_start
  if (type === "tool_execution_start") {
    const toolName = event.toolName || "unknown";
    const callId = `pi-sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (isWriteToolCall(toolName)) {
      events.push({
        providerId,
        timestamp: ts,
        payload: {
          kind: "approval_request",
          requestId: callId,
          toolName,
          description: `Pi SDK 请求执行 ${toolName}`,
          riskLevel: "medium",
          riskReason: "Pi portable backend — 写操作需 Bridge approval",
        },
      });
    } else {
      events.push({
        providerId,
        timestamp: ts,
        payload: { kind: "tool_start", toolName, toolInput: "", callId },
      });
    }
    return events;
  }

  // tool_execution_update → progress
  if (type === "tool_execution_update") {
    events.push({
      providerId,
      timestamp: ts,
      payload: {
        kind: "progress",
        label: event.toolName ? `tool_update:${event.toolName}` : "tool_update",
        detail: event.partialResult ? JSON.stringify(event.partialResult).slice(0, 200) : undefined,
        category: "tool",
      },
    });
    return events;
  }

  // tool_execution_end → tool_result
  if (type === "tool_execution_end") {
    const toolName = event.toolName || "unknown";
    const callId = `pi-sdk-end-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isError = event.isError === true;
    const output = event.partialResult ? JSON.stringify(event.partialResult).slice(0, 500) : (isError ? "tool error" : "ok");
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "tool_result", callId, toolName, output, isError },
    });
    return events;
  }

  // agent_start → session_started
  if (type === "agent_start") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "session_started", text: "Pi SDK agent started" },
    });
    return events;
  }

  // agent_end → completed
  if (type === "agent_end") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "completed", text: `Pi SDK agent end (${event.messages?.length ?? 0} messages)` },
    });
    return events;
  }

  // message_start / message_end → progress
  if (type === "message_start" || type === "message_end") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "progress", label: type, category: "status" },
    });
    return events;
  }

  // turn_start / turn_end → progress
  if (type === "turn_start" || type === "turn_end") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "progress", label: type, category: "status" },
    });
    return events;
  }

  // queue_update → progress
  if (type === "queue_update") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "progress", label: "queue_update", category: "status" },
    });
    return events;
  }

  // compaction_start / compaction_end → progress
  if (type === "compaction_start" || type === "compaction_end") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "progress", label: type, detail: event.reason, category: "notice" },
    });
    return events;
  }

  // auto_retry_start / auto_retry_end → progress
  if (type === "auto_retry_start" || type === "auto_retry_end") {
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "progress", label: type, category: "notice" },
    });
    return events;
  }

  // error → error/failed
  if (type === "error") {
    const message = event.error || event.finalError || "Pi SDK error";
    events.push({
      providerId,
      timestamp: ts,
      payload: { kind: "error", message, recoverable: true },
    });
    return events;
  }

  // 未识别事件：作为 progress（不丢失，便于 developerMode 排查）
  events.push({
    providerId,
    timestamp: ts,
    payload: { kind: "progress", label: `unknown_event:${type}`, category: "status" },
  });
  return events;
}

// ---------- Bridge-controlled write tools（任务 C） ----------

/**
 * 创建 Bridge-controlled 自定义工具定义。
 *
 * 这些工具替代 Pi 内置的 write/edit/bash：
 * - execute 内部调用 PermissionBoundary.requestApproval + waitForApproval
 * - accept → 返回 success（暂为占位执行；后续接 runtimeFileToolAdapter）
 * - decline → 返回 tool error 给 Pi
 *
 * 返回的是 Pi SDK defineTool 兼容的定义（不带 SDK 依赖，纯数据结构）。
 */
export function buildBridgeControlledWriteTools(
  permission: PermissionBoundary,
  providerId: ProviderId,
): ReadonlyArray<ToolDefinition> {
  const makeTool = (
    name: string,
    description: string,
    parameters: unknown,
  ): ToolDefinition => ({
    name,
    description,
    parameters,
    execute: async (args) => {
      const inputSummary = JSON.stringify(args).slice(0, 200);
      const requestId = `pi-bridge-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const req: ApprovalRequest = {
        requestId,
        providerId,
        toolName: name,
        description: `Pi SDK 请求执行 ${name}`,
        riskLevel: "medium",
        riskReason: "Pi portable backend — 写操作需 Bridge approval",
        inputSummary,
      };
      const decision = permission.requestApproval(req);
      if (decision === "auto-allow") {
        return {
          content: [{ type: "text", text: `[Bridge] ${name} auto-allowed by session policy` }],
          details: { args, decision: "auto-allow" },
        };
      }
      if (decision === "auto-deny") {
        return {
          content: [{ type: "text", text: `[Bridge] ${name} auto-denied by session policy` }],
          details: { args, decision: "auto-deny" },
        };
      }
      // pending → 等待用户决策
      const { response } = await permission.waitForApproval(requestId);
      if (response.type === "accept" || response.type === "acceptForSession") {
        // accept 后才调用 Bridge-controlled executor
        // 暂为占位（后续接 runtimeFileToolAdapter / host executor）
        return {
          content: [{ type: "text", text: `[Bridge] ${name} approved and executed (placeholder)` }],
          details: { args, decision: response.type },
        };
      }
      // decline → 返回 tool error/result 给 Pi
      return {
        content: [{ type: "text", text: `[Bridge] ${name} declined by user (${response.type})` }],
        details: { args, decision: response.type, declined: true },
      };
    },
  });

  // 最小 schema（TypeBox 风格占位 — 实际由 Pi SDK defineTool 解析）
  const pathSchema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
  const editSchema = {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
    },
    required: ["path", "oldText", "newText"],
  };
  const bashSchema = {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  };

  return [
    makeTool("write", "Bridge-controlled Write tool (requires approval)", pathSchema),
    makeTool("edit", "Bridge-controlled Edit tool (requires approval)", editSchema),
    makeTool("bash", "Bridge-controlled Bash tool (requires approval)", bashSchema),
  ];
}

// ---------- PiSdkProvider ----------

/**
 * V17-B 任务 A：Pi SDK Provider。
 *
 * 使用 @earendil-works/pi-coding-agent 的 SDK 嵌入模式。
 * 未安装/import 失败时 isAvailable=false，run() 发 failed 事件不崩溃。
 */
export class PiSdkProvider implements RuntimeProvider {
  readonly providerId = "pi-sdk" as const;
  readonly displayName = "Pi SDK";
  private readonly probe: PiSdkProbeResult;
  private currentSession: AgentSessionLike | null = null;

  constructor(options: { readonly forceReload?: boolean } = {}) {
    this.probe = tryLoadPiSdk(options.forceReload === true);
  }

  isAvailable(_cwd: string): boolean {
    return this.probe.available;
  }

  /** 暴露探测结果（测试/UI 用） */
  getProbeResult(): PiSdkProbeResult {
    return this.probe;
  }

  buildPlan(input: RunInput, settings: LLMBridgeSettings): EffectiveRunPlan {
    const attachmentPlan = buildAttachmentPlan(input.promptPackage.attachmentEntries);
    // Pi SDK 复用 sdk plan 字段（promptPackage 审计用）
    return buildEffectiveRunPlan({
      backend: "sdk",
      settings,
      cwd: input.cwd,
      promptPackageText: input.promptPackage.auditHash,
      settingSources: [],
      skills: [],
      attachmentPlan,
    });
  }

  async *run(ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const developerMode = !!settings.developerMode;

    // 未安装 / import 失败：直接发 failed，不崩溃（任务 A）
    if (!this.probe.available) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: {
          kind: "failed",
          message: `Pi SDK 不可用：${this.probe.reason}${this.probe.error ? " — " + this.probe.error : ""}`,
          recoverable: true,
        },
      };
      return;
    }

    const sdk = this.probe.module!;
    // 组装 prompt（任务 G：session.prompt 传入 composePromptForBackend(ctx, "sdk")）
    const prompt = composePromptForBackend(ctx, "sdk");

    // 任务 C：构建 Bridge-controlled write tools（写操作需 approval）
    const bridgeTools = buildBridgeControlledWriteTools(ctx.permission, this.providerId);
    // 用 defineTool 包装（如果 SDK 暴露 defineTool）；否则直接传 raw 定义
    let customTools: unknown[] = [];
    try {
      if (typeof sdk.defineTool === "function") {
        customTools = bridgeTools.map((t) => (sdk.defineTool as (d: ToolDefinition) => unknown)(t));
      } else {
        customTools = bridgeTools.slice();
      }
    } catch {
      customTools = bridgeTools.slice();
    }

    // 创建会话（最小参数 — 实际 SDK 需要更多配置，这里做 best-effort）
    let session: AgentSessionLike;
    try {
      const sessionManager = sdk.SessionManager?.inMemory
        ? sdk.SessionManager.inMemory()
        : undefined;
      const authStorage = sdk.AuthStorage?.create
        ? sdk.AuthStorage.create()
        : undefined;
      const modelRegistry = sdk.ModelRegistry?.create && authStorage
        ? sdk.ModelRegistry.create(authStorage)
        : undefined;
      const settingsManager = sdk.SettingsManager?.inMemory
        ? sdk.SettingsManager.inMemory({ compaction: { enabled: false } })
        : undefined;

      const result = await sdk.createAgentSession({
        cwd: ctx.plan.cwd,
        // 任务 C：禁用内置 write/edit/bash，只保留 read；写操作走 customTools
        tools: ["read"],
        excludeTools: ["edit", "write", "bash"],
        customTools,
        thinkingLevel: "medium",
        sessionManager,
        authStorage,
        modelRegistry,
        settingsManager,
      } as Record<string, unknown>);
      session = result.session;
    } catch (e) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: {
          kind: "failed",
          message: `Pi SDK createAgentSession 失败：${e instanceof Error ? e.message : String(e)}`,
          recoverable: true,
        },
      };
      return;
    }

    this.currentSession = session;

    yield {
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
      payload: { kind: "session_started", text: `Pi SDK session started (${session.sessionId})` },
    };

    // 订阅事件（任务 D：映射为 NormalizedRuntimeEvent）
    const stream = createAsyncEventStream<NormalizedRuntimeEvent>();
    let agentEnded = false;
    let lastError: string | null = null;

    const unsubscribe = session.subscribe((event: PiSdkEvent) => {
      const mapped = mapPiSdkEvent(event, this.providerId);
      for (const evt of mapped) {
        // raw provider event 仅在 developerMode 下保留
        if (developerMode) {
          (evt as NormalizedRuntimeEvent & { rawProviderEvent?: unknown }).rawProviderEvent = event;
        }
        stream.push(evt);
      }
      if (event.type === "agent_end") {
        agentEnded = true;
        stream.push(null); // 哨兵
      }
      if (event.type === "error") {
        lastError = event.error || event.finalError || "Pi SDK error";
      }
    });

    // 发送 prompt
    try {
      await session.prompt(prompt);
    } catch (e) {
      stream.push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: {
          kind: "error",
          message: `session.prompt 失败：${e instanceof Error ? e.message : String(e)}`,
          recoverable: true,
        },
      });
    }

    // 消费事件流（哨兵 null 时结束）
    for await (const evt of stream.iterate()) {
      yield evt;
    }

    try { unsubscribe(); } catch { /* ignore */ }

    // 终态
    if (lastError) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "failed", message: lastError, recoverable: true },
      };
    } else if (!agentEnded) {
      // 没收到 agent_end：发 completed 兜底
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "completed", text: "Pi SDK run completed (no agent_end)" },
      };
    }

    try { session.dispose(); } catch { /* ignore */ }
    this.currentSession = null;
  }

  cancel(_runId: string): void {
    // 任务 A：cancel(runId) 调用 session.abort()
    if (this.currentSession) {
      try {
        void this.currentSession.abort();
      } catch { /* ignore */ }
      this.currentSession = null;
    }
  }

  async *resume(_sessionId: string, ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // Pi SDK spike：resume 复用 run 路径（SDK 内部通过 sessionManager 处理持久化）
    yield* this.run(ctx, settings);
  }
}

// ---------- 简单异步事件队列（同 pi-rpc） ----------

/**
 * 简单的异步事件队列：把 EventEmitter 回调包装为 async iterable。
 * push(null) 作为哨兵表示结束。
 */
function createAsyncEventStream<T>(): {
  push: (item: T | null) => void;
  iterate: () => AsyncIterable<T>;
} {
  const buffer: (T | null)[] = [];
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
              if (item === null) return;
              yield item;
            } else {
              await new Promise<void>((resolve) => { waiter = resolve; });
              // 唤醒后重新检查 buffer（push 可能已加入新事件）
              void self;
            }
          }
        },
      };
    },
  };
}
