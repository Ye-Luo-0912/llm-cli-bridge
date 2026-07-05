// LLM CLI Bridge — PiSdkProvider (V17-B1 Pi SDK Runtime Correctness)
//
// 使用 @earendil-works/pi-coding-agent 的 SDK 嵌入模式（createAgentSession / AgentSession），
// 而不是 pi --mode rpc 子进程。作为 portable profile 的 portable backend 主线。
//
// V17-B1 修复要点：
// - 工具暴露：tools=["read"] + customTools=[bridge_write/bridge_edit/bridge_bash]
//   不启用 Pi 内置 write/edit/bash，避免同名冲突；bridge_* 真实进入 active tools
// - accept 后接 Bridge-controlled executor：fs/promises 写文件、字符串替换、bash 禁用
// - streaming 并发：subscribe + 异步 prompt + for await iterate，不阻塞
// - toolCallId 在 start/update/end 复用同一 id（来自 Pi SDK event 或回退生成）
// - 模型/认证：probe modelRegistry.hasConfiguredAuth，无 auth 时发可行动提示
//
// 权限边界（任务 C）：
// - bridge_* 工具 execute 内部调用 PermissionBoundary.requestApproval + waitForApproval
// - accept → 调用 Bridge-controlled executor（真实写入）
// - decline → 返回 tool error/result 给 Pi
// - read 走 Pi 内置 Read（read-only adapter）
//
// 事件映射（任务 D）：
// - message_update + text_delta → message partial
// - message_update + thinking_delta → thinking
// - tool_execution_start → tool_start（携带 toolCallId）
// - tool_execution_update → progress
// - tool_execution_end → tool_result（复用同一 toolCallId）
// - agent_start → session_started
// - agent_end → completed
// - error → error/failed
// - raw provider event 仅在 developerMode 下保留
//
// V17-E 任务 F：Pi SDK 降级为 optional/advanced backend，不阻塞 Codex-first audit。
// - friendReady 字段废弃，改名为 piAdvancedReady（见 scripts/pi-sdk-smoke.mjs）
// - ESM dynamic import（dynamicImportNode / tryLoadPiSdkAsync）作为独立修复项：
//     SDK 是纯 ESM，必须用 await import() 加载；require 无法加载。
//     当前实现已在 tryLoadPiSdkAsync 中走 dynamicImportNode，多路径候选
//     （plugin node_modules → vendor → bare specifier）。
//     若 ESM 加载出现异常（如 import meta 解析失败 / 包导出映射不兼容），
//     将作为独立修复项处理，不影响 Codex-first 主线 audit。

import type { LLMBridgeSettings, PiToolMode } from "../../../types";
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
// V17-B1: 优先用 globalThis.require（Obsidian renderer 环境），回退到直接 require
// esbuild bundle 时保留 require 调用（format=esm + platform=node 仍可用 createRequire）
function requireNode<T>(name: string): T | null {
  try {
    const g = globalThis as unknown as { require?: (n: string) => T };
    if (g.require) return g.require(name);
  } catch { /* fallthrough */ }
  try {
    return (require as (n: string) => T)(name);
  } catch {
    return null;
  }
}

// V17-D 任务 B：动态 import helper（SDK 是纯 ESM，require 无法加载）
// esbuild 不会 inline dynamic import()，运行时解析
// V17-E 任务 F：ESM dynamic import 作为独立修复项 — 不阻塞 Codex-first audit
async function dynamicImportNode<T>(specifier: string): Promise<T | null> {
  try {
    return await import(specifier) as T;
  } catch {
    return null;
  }
}

// V17-D 任务 B：候选加载路径（按优先级）
// 1. 插件目录 node_modules/@earendil-works/pi-coding-agent
// 2. 插件目录 vendor/pi-sdk
// 3. bare specifier "@earendil-works/pi-coding-agent"（项目 node_modules / Obsidian 全局解析）
function getCandidateSdkPaths(): { kind: "node_modules" | "vendor" | "bare"; specifier: string }[] {
  const paths: { kind: "node_modules" | "vendor" | "bare"; specifier: string }[] = [];
  const g = globalThis as unknown as { __dirname?: string };
  const pluginDir = g.__dirname;
  if (pluginDir) {
    paths.push({ kind: "node_modules", specifier: pluginDir + "/node_modules/@earendil-works/pi-coding-agent" });
    paths.push({ kind: "vendor", specifier: pluginDir + "/vendor/pi-sdk" });
  }
  paths.push({ kind: "bare", specifier: "@earendil-works/pi-coding-agent" });
  return paths;
}

// ---------- Pi SDK 加载 ----------

/**
 * Pi SDK 模块接口（仅声明我们用到的 API surface）。
 *
 * 实际包 @earendil-works/pi-coding-agent 在 optionalDependencies 中（朋友版可选依赖）。
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
  AuthStorage?: {
    create(): AuthStorageLike;
  };
  ModelRegistry?: {
    create(authStorage: unknown): ModelRegistryLike;
  };
  DefaultResourceLoader?: new (options: Record<string, unknown>) => { reload(): Promise<void> };
  SettingsManager?: { inMemory(overrides?: Record<string, unknown>): unknown };
}

export interface AuthStorageLike {
  hasConfiguredAuth?(model?: { provider?: string; id?: string }): boolean;
  setRuntimeApiKey?(provider: string, key: string): void;
  getRuntimeApiKey?(provider: string): string | undefined;
}

export interface ModelRegistryLike {
  /** V17-C 任务 C：返回当前已配置 auth 的可用模型列表（替代旧 list()） */
  getAvailable?(): ReadonlyArray<{ id: string; provider: string }>;
  find?(provider: string, modelId: string): { id: string; provider: string } | undefined;
  list?(): ReadonlyArray<{ id: string; provider: string }>;
}

export interface AgentSessionLike {
  readonly sessionId: string;
  prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  subscribe(listener: (event: PiSdkEvent) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
  readonly isStreaming: boolean;
  getActiveToolNames?(): ReadonlyArray<string>;
}

/** Pi SDK 事件（判别联合 — 仅声明我们识别的字段） */
export interface PiSdkEvent {
  readonly type: string;
  readonly assistantMessageEvent?: {
    readonly type: string; // text_delta | thinking_delta | toolcall_start | ...
    readonly delta?: string;
    readonly toolCall?: { readonly name: string; readonly input?: unknown; readonly id?: string };
  };
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly args?: unknown;
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
  /** V17-D 任务 B：加载源（哪个候选路径命中） */
  readonly loadedFrom?: "node_modules" | "vendor" | "bare" | "cache";
}

const probeCache: { result: PiSdkProbeResult | null; ts: number } = { result: null, ts: 0 };
const PROBE_CACHE_TTL_MS = 30_000;

/** 清除探测缓存（测试用） */
export function clearPiSdkProbeCache(): void {
  probeCache.result = null;
  probeCache.ts = 0;
}

/**
 * 同步版：返回 cached probe（首次调用返回 unavailable，需先 await tryLoadPiSdkAsync 预加载）。
 * 适用于无法 await 的场景（如 PiSdkProvider constructor）。
 * force=true 时仍返回 cache（不重新加载，避免在同步上下文中阻塞）。
 */
export function tryLoadPiSdk(force = false): PiSdkProbeResult {
  void force; // 同步版不主动 reload，仅返回 cache
  if (probeCache.result) return probeCache.result;
  return {
    available: false,
    module: null,
    reason: "not-installed",
    error: "Pi SDK 尚未预加载；请先调用 tryLoadPiSdkAsync() 或检查插件目录是否含 node_modules/@earendil-works/pi-coding-agent 或 vendor/pi-sdk",
  };
}

/**
 * V17-D 任务 B：异步加载 Pi SDK，按优先级尝试多个候选路径。
 *
 * 加载顺序：
 * 1. 插件目录 node_modules/@earendil-works/pi-coding-agent
 * 2. 插件目录 vendor/pi-sdk
 * 3. bare specifier "@earendil-works/pi-coding-agent"（require / dynamic import 回退）
 *
 * SDK 是纯 ESM（"type": "module"），require 无法加载，必须用 dynamic import()。
 * 旧 requireNode 路径作为最后回退（兼容 CommonJS 环境的旧版 SDK）。
 *
 * - 包未安装时返回 available=false, reason=not-installed
 * - import 失败时返回 available=false, reason=load-error
 * - 不抛错
 */
export async function tryLoadPiSdkAsync(force = false): Promise<PiSdkProbeResult> {
  const now = Date.now();
  if (!force && probeCache.result && now - probeCache.ts < PROBE_CACHE_TTL_MS) {
    return { ...probeCache.result, loadedFrom: "cache" };
  }

  const candidates = getCandidateSdkPaths();
  const triedPaths: string[] = [];

  for (const candidate of candidates) {
    triedPaths.push(`${candidate.kind}:${candidate.specifier}`);
    // 优先 dynamic import（SDK 是纯 ESM）
    const mod = await dynamicImportNode<PiSdkModule>(candidate.specifier);
    if (mod && typeof (mod as { createAgentSession?: unknown }).createAgentSession === "function") {
      const result: PiSdkProbeResult = {
        available: true,
        module: mod,
        reason: "installed",
        loadedFrom: candidate.kind,
      };
      probeCache.result = result;
      probeCache.ts = now;
      return result;
    }
    // dynamic import 失败时回退 requireNode（仅对 bare specifier 有意义，CommonJS 环境兼容）
    if (candidate.kind === "bare") {
      const reqMod = requireNode<PiSdkModule>(candidate.specifier);
      if (reqMod && typeof reqMod.createAgentSession === "function") {
        const result: PiSdkProbeResult = {
          available: true,
          module: reqMod,
          reason: "installed",
          loadedFrom: "bare",
        };
        probeCache.result = result;
        probeCache.ts = now;
        return result;
      }
    }
  }

  // 所有路径均失败
  const result: PiSdkProbeResult = {
    available: false,
    module: null,
    reason: "not-installed",
    error: `Pi SDK 未在以下路径找到：${triedPaths.join(" → ")}。当前发行包缺 Pi SDK，请使用 'Enable Friend Preview' 后重启，或重新下载完整 user-package。`,
  };
  probeCache.result = result;
  probeCache.ts = now;
  return result;
}

/**
 * 旧版同步 require 回退（V17-B 保留兼容）。
 * @deprecated V17-D 起改用 tryLoadPiSdkAsync。
 */
export function tryLoadPiSdkLegacy(): PiSdkProbeResult {
  const mod = requireNode<PiSdkModule>("@earendil-works/pi-coding-agent");
  if (mod && typeof mod.createAgentSession === "function") {
    const result: PiSdkProbeResult = {
      available: true,
      module: mod,
      reason: "installed",
      loadedFrom: "bare",
    };
    probeCache.result = result;
    probeCache.ts = Date.now();
    return result;
  }
  const result: PiSdkProbeResult = {
    available: false,
    module: null,
    reason: mod ? "load-error" : "not-installed",
    error: mod ? "createAgentSession export missing" : "package @earendil-works/pi-coding-agent not installed",
  };
  probeCache.result = result;
  probeCache.ts = Date.now();
  return result;
}

/**
 * V17-D 任务 D：测试钩子 — 直接注入 probe（绕过真实 SDK 加载）。
 * 仅在测试中使用，让 PiSdkProvider constructor 拿到 fake probe。
 */
export function __setProbeForTest(probe: PiSdkProbeResult | null): void {
  probeCache.result = probe;
  probeCache.ts = probe ? Date.now() : 0;
}

/**
 * V17-B1 任务 F / V17-C 任务 C：探测 Pi SDK 模型/认证可用性。
 *
 * V17-C 修复要点：
 * - 不再调用 authStorage.hasConfiguredAuth()（无参）或 modelRegistry.list() 全量列表
 * - 优先使用 modelRegistry.getAvailable() 判断是否有可用模型
 * - 回退到 modelRegistry.find(provider, modelId) + hasConfiguredAuth(model)
 * - hasAuth 通过 getAvailable 是否非空间接判断（已配置 auth 才会出现在 available 列表）
 *
 * V17-D 任务 F：支持 runtime auth override（不写 ~/.pi/agent，仅运行时注入）
 *
 * 返回 auth/model 状态用于 UI 提示。无 auth 时返回可行动提示。
 */
export interface PiSdkAuthProbeResult {
  readonly hasAuth: boolean;
  readonly hasModel: boolean;
  readonly hint: string;
}

/** V17-D 任务 F：runtime auth override 配置（来自 plugin settings） */
export interface PiSdkAuthOverride {
  readonly apiKey?: string;
  readonly provider?: string; // 默认 "anthropic"
  readonly baseUrl?: string; // 自定义 base URL
  readonly model?: string; // 显式指定 model id
}

/**
 * V17-D 任务 F：创建带 runtime override 的 authStorage + modelRegistry。
 * - apiKey 非空时调用 authStorage.setRuntimeApiKey（不写 ~/.pi/agent）
 * - baseUrl 非空时调用 modelRegistry.registerProvider
 * 返回的 authStorage/modelRegistry 可直接用于 probePiSdkAuth 与 createAgentSession。
 */
export function createAuthWithOverride(
  sdk: PiSdkModule,
  override?: PiSdkAuthOverride,
): { authStorage: AuthStorageLike | null; modelRegistry: ModelRegistryLike | null } {
  const authStorage = sdk.AuthStorage?.create ? sdk.AuthStorage.create() : null;
  const modelRegistry = sdk.ModelRegistry?.create && authStorage ? sdk.ModelRegistry.create(authStorage) : null;
  if (override?.apiKey && authStorage && typeof authStorage.setRuntimeApiKey === "function") {
    const provider = override.provider || "anthropic";
    try {
      authStorage.setRuntimeApiKey(provider, override.apiKey);
    } catch { /* ignore override failure, fallback to ~/.pi/agent */ }
  }
  if (override?.baseUrl && modelRegistry && typeof modelRegistry.registerProvider === "function") {
    const provider = override.provider || "anthropic";
    try {
      modelRegistry.registerProvider(provider, { baseUrl: override.baseUrl });
    } catch { /* ignore */ }
  }
  return { authStorage, modelRegistry };
}

export function probePiSdkAuth(probe: PiSdkProbeResult, override?: PiSdkAuthOverride): PiSdkAuthProbeResult {
  if (!probe.available || !probe.module) {
    return {
      hasAuth: false,
      hasModel: false,
      hint: "Pi SDK 未安装。请运行：npm install --ignore-scripts @earendil-works/pi-coding-agent",
    };
  }
  const sdk = probe.module;
  try {
    const { authStorage, modelRegistry } = createAuthWithOverride(sdk, override);

    // V17-C 任务 C：优先用 getAvailable() 判断 auth+model 同时可用
    let hasAuth = false;
    let hasModel = false;
    if (modelRegistry && typeof modelRegistry.getAvailable === "function") {
      const available = modelRegistry.getAvailable();
      hasModel = available.length > 0;
      // getAvailable 返回已配置 auth 的模型 — 非空即表示 auth 可用
      hasAuth = hasModel;
    } else if (modelRegistry && typeof modelRegistry.list === "function") {
      // 回退：list() 仅用于探测 model 总数（不判断 auth）
      const all = modelRegistry.list();
      hasModel = all.length > 0;
      // 若 list 非空但需要 auth 判断，尝试 find + hasConfiguredAuth(model)
      if (hasModel && authStorage && typeof authStorage.hasConfiguredAuth === "function") {
        const first = all[0];
        try {
          hasAuth = authStorage.hasConfiguredAuth({ provider: first.provider, id: first.id });
        } catch {
          hasAuth = false;
        }
      }
    }

    let hint = "";
    if (!hasAuth && !hasModel) {
      // V17-D 任务 F：提示用户可在插件设置中配置（不强制 ~/.pi/agent 或命令行）
      hint = "Pi SDK 未配置认证和模型。请在插件设置「Pi SDK Auth」中配置 Provider / API Key / Model，或运行 pi login。";
    } else if (!hasAuth) {
      hint = "Pi SDK 未配置认证。请在插件设置「Pi SDK Auth」中配置 Provider / API Key，或运行 pi login。";
    } else if (!hasModel) {
      hint = "Pi SDK 未选择模型。请在插件设置「Pi SDK Auth」中选择 Model。";
    }
    return { hasAuth, hasModel, hint };
  } catch {
    return {
      hasAuth: false,
      hasModel: false,
      hint: "Pi SDK 认证探测失败。请检查插件设置「Pi SDK Auth」或运行 pi login。",
    };
  }
}

// ---------- 写工具判定（任务 C 权限边界） ----------

/**
 * V17-B1 任务 B：Bridge-controlled 工具名集合。
 * 这些工具替代 Pi 内置 write/edit/bash，避免同名冲突。
 */
export const BRIDGE_TOOL_NAMES = ["bridge_write", "bridge_edit", "bridge_bash"] as const;
export type BridgeToolName = typeof BRIDGE_TOOL_NAMES[number];

/** 判断 Pi SDK 工具调用是否为写/命令操作（需 approval）。导出用于测试。 */
export function isWriteToolCall(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  // V17-B1: bridge_* 工具是写操作；内置 write/edit/bash 也算（防御性）
  if (lower === "bridge_write" || lower === "bridge_edit" || lower === "bridge_bash") return true;
  const WRITE_TOOL_NAMES = new Set([
    "write", "edit", "multiedit", "bash", "shell", "command", "terminal",
    "delete", "remove", "rm", "mkdir", "mv", "rename", "notebookedit",
  ]);
  if (WRITE_TOOL_NAMES.has(lower)) return true;
  return /write|edit|bash|shell|command|terminal|delete|remove|rename/i.test(lower);
}

// ---------- toolCallId 管理（任务 E） ----------

/**
 * V17-B1 任务 E：toolCallId 注册表。
 *
 * Pi SDK event 中 toolCallId 可能出现在 toolcall_start（assistantMessageEvent.toolCall.id）
 * 或 tool_execution_start（event.toolCallId）。我们在 start 时记录 id，
 * update/end 时优先使用 event 自带 id，缺失时回退到最近注册的 id（按 toolName 关联）。
 *
 * 同一 toolCallId 在 start/update/end 之间复用，不再各自生成不同 id。
 */
export class ToolCallIdRegistry {
  private readonly byToolName = new Map<string, string>();
  private counter = 0;

  /** 注册或获取 toolCallId。优先使用 event 自带 id。 */
  resolveId(event: PiSdkEvent): string {
    const toolName = event.toolName || event.assistantMessageEvent?.toolCall?.name || "unknown";
    // 1. event.assistantMessageEvent.toolCall.id（toolcall_start）
    const tcId = event.assistantMessageEvent?.toolCall?.id;
    if (tcId) {
      this.byToolName.set(toolName, tcId);
      return tcId;
    }
    // 2. event.toolCallId（tool_execution_*）
    if (event.toolCallId) {
      this.byToolName.set(toolName, event.toolCallId);
      return event.toolCallId;
    }
    // 3. 回退：按 toolName 查找已注册 id
    const existing = this.byToolName.get(toolName);
    if (existing) return existing;
    // 4. 全部缺失：生成新 id（仅 start 时）
    const fallback = `pi-sdk-${toolName}-${Date.now()}-${this.counter++}`;
    this.byToolName.set(toolName, fallback);
    return fallback;
  }

  /** 清理（run 结束时调用） */
  clear(): void {
    this.byToolName.clear();
  }
}

// ---------- 事件映射（任务 D + E） ----------

/**
 * 把 Pi SDK event 映射为 NormalizedRuntimeEvent[]。
 *
 * 纯函数（不依赖 provider 实例），导出供单元测试。
 * rawProviderEvent 由调用方根据 developerMode 决定是否填充。
 *
 * V17-B1 任务 E：toolCallId 在 start/update/end 之间复用（通过 registry）。
 */
export function mapPiSdkEvent(
  event: PiSdkEvent,
  providerId: ProviderId,
  idRegistry?: ToolCallIdRegistry,
): NormalizedRuntimeEvent[] {
  const ts = new Date().toISOString();
  const events: NormalizedRuntimeEvent[] = [];
  const type = event.type;
  const registry = idRegistry ?? new ToolCallIdRegistry();

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
      const callId = registry.resolveId(event);
      // V17-B1: bridge_* 工具是写操作 → approval_request
      // 内置 write/edit/bash 防御性也算（不应出现，因 tools=["read"]）
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
    const callId = registry.resolveId(event);
    const toolInput = event.args ? JSON.stringify(event.args).slice(0, 200) : "";
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
          inputSummary: toolInput,
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

  // tool_execution_update → progress（复用同一 callId，通过 detail 携带）
  if (type === "tool_execution_update") {
    const callId = registry.resolveId(event);
    events.push({
      providerId,
      timestamp: ts,
      payload: {
        kind: "progress",
        label: event.toolName ? `tool_update:${event.toolName}` : "tool_update",
        detail: event.partialResult
          ? `${JSON.stringify(event.partialResult).slice(0, 180)} [callId:${callId}]`
          : `[callId:${callId}]`,
        category: "tool",
      },
    });
    return events;
  }

  // tool_execution_end → tool_result（复用同一 callId）
  if (type === "tool_execution_end") {
    const toolName = event.toolName || "unknown";
    const callId = registry.resolveId(event);
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

// ---------- Bridge-controlled executor（任务 C：真实写入） ----------

/**
 * V17-B1 任务 C：Bridge-controlled 工具执行器。
 *
 * accept 后调用真实 executor：
 * - bridge_write → fs/promises.writeFile
 * - bridge_edit → 读取 → 字符串替换 → 写回
 * - bridge_bash → portable 默认禁用（需 developer profile + 显式开启）
 *
 * decline 后不执行任何操作，返回 tool error。
 */
export interface BridgeToolExecutor {
  write(path: string, content: string): Promise<{ ok: boolean; message: string }>;
  edit(path: string, oldText: string, newText: string): Promise<{ ok: boolean; message: string }>;
  bash(command: string): Promise<{ ok: boolean; message: string }>;
}

/** 默认 executor：使用 Node fs/promises + V17-C 任务 E 路径边界 */
export function createDefaultBridgeToolExecutor(
  cwd: string,
  allowBash: boolean,
  options: { readonly allowAbsolute?: boolean } = {},
): BridgeToolExecutor {
  return {
    async write(path, content) {
      try {
        const fs = requireNode<{ promises: { writeFile(path: string, data: string, enc?: string): Promise<void>; mkdir(path: string, opts?: { recursive: boolean }): Promise<void> } }>("node:fs");
        if (!fs?.promises) {
          return { ok: false, message: "node:fs not available in this environment" };
        }
        // V17-C 任务 E：使用 resolveBoundedPath 限制在 cwd 内
        const fullPath = resolveBoundedPath(cwd, path, { allowAbsolute: options.allowAbsolute });
        if (fullPath === null) {
          return { ok: false, message: `path blocked (out of vault or absolute): ${path}` };
        }
        const pathMod = requireNode<{ sep: string }>("node:path");
        const sep = pathMod?.sep ?? "/";
        const dir = fullPath.substring(0, fullPath.lastIndexOf(sep));
        if (dir) await fs.promises.mkdir(dir, { recursive: true }).catch(() => { /* ignore */ });
        await fs.promises.writeFile(fullPath, content, "utf8");
        return { ok: true, message: `wrote ${path}` };
      } catch (e) {
        return { ok: false, message: `write failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    async edit(path, oldText, newText) {
      try {
        const fs = requireNode<{ promises: { readFile(path: string, enc: string): Promise<string>; writeFile(path: string, data: string, enc?: string): Promise<void> } }>("node:fs");
        if (!fs?.promises) {
          return { ok: false, message: "node:fs not available in this environment" };
        }
        const fullPath = resolveBoundedPath(cwd, path, { allowAbsolute: options.allowAbsolute });
        if (fullPath === null) {
          return { ok: false, message: `path blocked (out of vault or absolute): ${path}` };
        }
        const original = await fs.promises.readFile(fullPath, "utf8");
        if (!original.includes(oldText)) {
          return { ok: false, message: `oldText not found in ${path}` };
        }
        const updated = original.replace(oldText, newText);
        await fs.promises.writeFile(fullPath, updated, "utf8");
        return { ok: true, message: `edited ${path}` };
      } catch (e) {
        return { ok: false, message: `edit failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    async bash(_command) {
      if (!allowBash) {
        return { ok: false, message: "bash is disabled in portable profile (requires developer profile + explicit enable)" };
      }
      // V17-B1: portable 默认禁用 bash；developer profile 下也建议走 Bridge command approval
      // 真实 bash 执行由 view.ts 的 command execution approval path 处理，此处仅返回禁用提示
      return { ok: false, message: "bash execution not supported via Pi SDK bridge tool — use Bridge command approval path" };
    },
  };
}

/**
 * V17-C 任务 E：Bridge-controlled 路径边界。
 *
 * 把 path normalize/resolve 后限制在 cwd（Vault 根目录）内：
 * - 相对路径 → 拼到 cwd 后 normalize
 * - 绝对路径 → 默认拒绝（除非 allowAbsolute=true，仅 developerMode 显式开启）
 * - 路径 escape（.. 越界） → 直接拒绝（返回 null）
 *
 * V17-C 修复：纯 JS 实现，不依赖 node:path（避免 esbuild bundle/test 环境下 requireNode 返回 null）
 *
 * 返回 null 表示拒绝；调用方应转为 high risk approval 或 tool error。
 */
export function resolveBoundedPath(
  cwd: string,
  path: string,
  options: { readonly allowAbsolute?: boolean } = {},
): string | null {
  if (!path) return cwd;

  // 统一用 / 作为分隔符处理（Windows/Unix 兼容）
  const normalizeSep = (p: string): string => p.replace(/\\/g, "/");
  const cwdNorm = normalizeSep(cwd);
  const pathNorm = normalizeSep(path);

  // 绝对路径检测（Unix / 或 Windows drive:/ ）
  const isAbs = pathNorm.startsWith("/") || /^[A-Za-z]:\//.test(pathNorm);
  if (isAbs) {
    if (!options.allowAbsolute) return null;
    // allowAbsolute 时仍需检查 normalize 后是否在 cwd 内
    const normalized = normalizeSegments(pathNorm);
    const rel = relativePath(cwdNorm, normalized);
    if (rel === null || rel.startsWith("../") || rel === "..") return null;
    return normalized.replace(/\//g, pathSep());
  }

  // 相对路径：拼到 cwd 后 normalize + 检查越界
  const joined = (cwdNorm.endsWith("/") ? cwdNorm : cwdNorm + "/") + pathNorm;
  const normalized = normalizeSegments(joined);
  const rel = relativePath(cwdNorm, normalized);
  if (rel === null || rel.startsWith("../") || rel === "..") return null;
  return normalized.replace(/\//g, pathSep());
}

/** 当前平台的路径分隔符 */
function pathSep(): string {
  if (typeof process !== "undefined" && typeof process.platform === "string" && process.platform === "win32") return "\\";
  return "/";
}

/** 纯 JS 路径 segment normalize：处理 . 和 .. 段 */
function normalizeSegments(p: string): string {
  const isAbs = p.startsWith("/") || /^[A-Za-z]:\//.test(p);
  const driveMatch = p.match(/^([A-Za-z]:)(\/.*)?$/);
  const drive = driveMatch ? driveMatch[1] : "";
  const body = driveMatch ? (driveMatch[2] || "") : (isAbs ? p : p);
  const segments = body.split("/").filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      }
      continue;
    }
    out.push(seg);
  }
  const normalizedBody = out.join("/");
  if (drive) {
    return drive + "/" + normalizedBody;
  }
  if (isAbs) {
    return "/" + normalizedBody;
  }
  return normalizedBody;
}

/** 计算 to 相对于 from 的路径（to 必须在 from 内，否则返回 null 或 ../ 路径） */
function relativePath(from: string, to: string): string | null {
  const fromSegs = from.split("/").filter((s) => s.length > 0);
  const toSegs = to.split("/").filter((s) => s.length > 0);

  // 找共同前缀
  let commonLen = 0;
  while (commonLen < fromSegs.length && commonLen < toSegs.length && fromSegs[commonLen] === toSegs[commonLen]) {
    commonLen++;
  }

  const upCount = fromSegs.length - commonLen;
  const downSegs = toSegs.slice(commonLen);

  const parts: string[] = [];
  for (let i = 0; i < upCount; i++) parts.push("..");
  for (const seg of downSegs) parts.push(seg);

  return parts.length === 0 ? "" : parts.join("/");
}

function resolvePath(cwd: string, path: string): string {
  // V17-C 任务 E：旧 resolvePath 仅供 pi-native 模式使用（Pi 内置工具自行处理路径）
  // bridge-controlled 模式应使用 resolveBoundedPath
  if (!path) return cwd;
  const pathMod = requireNode<{ sep: string }>("node:path");
  const sep = pathMod?.sep ?? "/";
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  if (cwd.endsWith(sep)) return cwd + path;
  return cwd + sep + path;
}

/**
 * V17-B1 任务 B+C：创建 Bridge-controlled 自定义工具定义。
 *
 * 工具名：bridge_write / bridge_edit / bridge_bash（避免与 Pi 内置同名冲突）
 * - execute 内部调用 PermissionBoundary.requestApproval + waitForApproval
 * - accept → 调用 BridgeToolExecutor 真实执行
 * - decline → 返回 tool error 给 Pi
 *
 * 返回的是 Pi SDK defineTool 兼容的定义（不带 SDK 依赖，纯数据结构）。
 */
export function buildBridgeControlledWriteTools(
  permission: PermissionBoundary,
  providerId: ProviderId,
  executor: BridgeToolExecutor,
): ReadonlyArray<ToolDefinition> {
  const makeTool = (
    name: BridgeToolName,
    description: string,
    parameters: unknown,
    run: (args: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>,
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
        const result = await run(args);
        return {
          content: [{ type: "text", text: `[Bridge] ${name} auto-allowed: ${result.message}` }],
          details: { args, decision: "auto-allow", ok: result.ok },
        };
      }
      if (decision === "auto-deny") {
        return {
          content: [{ type: "text", text: `[Bridge] ${name} auto-denied by session policy` }],
          details: { args, decision: "auto-deny", declined: true },
        };
      }
      // pending → 等待用户决策
      const { response } = await permission.waitForApproval(requestId);
      if (response.type === "accept" || response.type === "acceptForSession") {
        // V17-B1 任务 C：accept 后调用真实 Bridge-controlled executor
        const result = await run(args);
        return {
          content: [{ type: "text", text: `[Bridge] ${name} approved: ${result.message}` }],
          details: { args, decision: response.type, ok: result.ok },
        };
      }
      // decline → 返回 tool error/result 给 Pi
      return {
        content: [{ type: "text", text: `[Bridge] ${name} declined by user (${response.type})` }],
        details: { args, decision: response.type, declined: true },
      };
    },
  });

  // TypeBox 风格 schema（Pi SDK defineTool 解析）
  const writeSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "目标文件路径（相对 cwd 或绝对路径）" },
      content: { type: "string", description: "要写入的内容" },
    },
    required: ["path", "content"],
  };
  const editSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "目标文件路径" },
      oldText: { type: "string", description: "要替换的原文" },
      newText: { type: "string", description: "替换后的新文" },
    },
    required: ["path", "oldText", "newText"],
  };
  const bashSchema = {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的 shell 命令（portable 默认禁用）" },
    },
    required: ["command"],
  };

  return [
    makeTool("bridge_write", "Bridge-controlled Write tool (requires approval, writes file via Bridge executor)", writeSchema,
      async (args) => executor.write(String(args.path ?? ""), String(args.content ?? ""))),
    makeTool("bridge_edit", "Bridge-controlled Edit tool (requires approval, replaces oldText with newText)", editSchema,
      async (args) => executor.edit(String(args.path ?? ""), String(args.oldText ?? ""), String(args.newText ?? ""))),
    makeTool("bridge_bash", "Bridge-controlled Bash tool (requires approval, disabled in portable profile by default)", bashSchema,
      async (args) => executor.bash(String(args.command ?? ""))),
  ];
}

// ---------- toolMode 解析（任务 A） ----------

/**
 * V17-C 任务 A：解析 Pi SDK toolMode。
 *
 * - settings.piToolMode 已设置 → 直接返回
 * - 未设置（旧 settings 迁移） → 按 backendProfile 推断：
 *   portable → pi-native（朋友版默认）
 *   developer → bridge-controlled（开发者默认）
 */
export function resolveToolMode(settings: LLMBridgeSettings): PiToolMode {
  const mode = (settings as { piToolMode?: string }).piToolMode;
  if (mode === "pi-native" || mode === "bridge-controlled" || mode === "read-only") {
    return mode;
  }
  // 迁移默认：portable → pi-native；developer → bridge-controlled
  return settings.backendProfile === "portable" ? "pi-native" : "bridge-controlled";
}

// ---------- PiSdkProvider ----------

/**
 * V17-B1：Pi SDK Provider。
 *
 * 使用 @earendil-works/pi-coding-agent 的 SDK 嵌入模式。
 * 未安装/import 失败时 isAvailable=false，run() 发 failed 事件不崩溃。
 */
export class PiSdkProvider implements RuntimeProvider {
  readonly providerId = "pi-sdk" as const;
  readonly displayName = "Pi SDK";
  private probe: PiSdkProbeResult;
  private currentSession: AgentSessionLike | null = null;

  constructor(options: { readonly forceReload?: boolean } = {}) {
    // V17-D 任务 B：constructor 同步读 cache（首次未加载时返回 unavailable）
    // 真实加载由 PiSdkProvider.preload() 异步完成
    this.probe = tryLoadPiSdk(options.forceReload === true);
  }

  /**
   * V17-D 任务 B：异步预加载 Pi SDK。
   * 在 main.ts onload 或 view 初始化时调用，保证后续 constructor 拿到 cached probe。
   */
  static async preload(force = false): Promise<PiSdkProbeResult> {
    return await tryLoadPiSdkAsync(force);
  }

  /** V17-D 任务 B：在 run() 开始时若 probe 未加载，尝试重新加载一次（自愈） */
  private async ensureProbeLoaded(): Promise<PiSdkProbeResult> {
    if (this.probe.available) return this.probe;
    // probe 未加载，尝试异步加载一次
    const fresh = await tryLoadPiSdkAsync(true);
    this.probe = fresh;
    return fresh;
  }

  isAvailable(_cwd: string): boolean {
    return this.probe.available;
  }

  /** 暴露探测结果（测试/UI 用） */
  getProbeResult(): PiSdkProbeResult {
    return this.probe;
  }

  /** V17-B1 任务 F：暴露认证探测结果（UI 用） */
  getAuthProbe(): PiSdkAuthProbeResult {
    return probePiSdkAuth(this.probe);
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

    // V17-C 任务 A：解析 toolMode（未设置时按 profile 推断默认值）
    const toolMode = resolveToolMode(settings);

    // V17-D 任务 B：run() 开始时确保 probe 已加载（自愈机制）
    if (!this.probe.available) {
      this.probe = await this.ensureProbeLoaded();
    }

    // 未安装 / import 失败：直接发 failed，不崩溃（任务 A）
    if (!this.probe.available) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: {
          kind: "failed",
          message: `Pi SDK 不可用：${this.probe.reason}${this.probe.error ? " — " + this.probe.error : ""}。当前发行包缺 Pi SDK，请使用 'Enable Friend Preview' 后重启，或检查插件目录是否含 node_modules/@earendil-works/pi-coding-agent 或 vendor/pi-sdk。`,
          recoverable: true,
        },
      };
      return;
    }

    // V17-C 任务 D：pi-native 首次运行 trust warning（portable + pi-native + 未确认 → 拒绝启动）
    if (toolMode === "pi-native" && !settings.piNativeTrustConfirmed) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: {
          kind: "failed",
          message: "Pi Native Tools 未确认。首次启用 pi-native 前请确认：Pi Native Tools 将以本机用户权限读写当前 Vault。建议先备份。请在插件设置中确认后重试。",
          recoverable: true,
        },
      };
      return;
    }

    // V17-D 任务 F：从 plugin settings 构建 runtime auth override（不写 ~/.pi/agent）
    const authOverride: PiSdkAuthOverride = {
      apiKey: settings.piApiKey || undefined,
      provider: settings.piAuthProvider || undefined,
      baseUrl: settings.piApiBaseUrl || undefined,
      model: settings.piApiModel || undefined,
    };

    // V17-B1 任务 F / V17-C 任务 C：认证/模型探测（应用 runtime override）
    const authProbe = probePiSdkAuth(this.probe, authOverride);
    if (!authProbe.hasAuth || !authProbe.hasModel) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: {
          kind: "failed",
          message: `Pi SDK 认证/模型未配置：${authProbe.hint}`,
          recoverable: true,
        },
      };
      return;
    }

    const sdk = this.probe.module!;
    // 组装 prompt（任务 G：session.prompt 传入 composePromptForBackend(ctx, "sdk")）
    const prompt = composePromptForBackend(ctx, "sdk");

    // V17-C 任务 B + V17-C1 任务 E：按 toolMode 构建 session 参数
    // - pi-native: 不传 tools 和 customTools（使用 Pi 默认 read/write/edit/bash）
    // - bridge-controlled: 用 excludeTools 排除 Pi 内置 write/edit/bash（避免同名冲突），
    //   customTools=bridge_* 不会被 tools allowlist 过滤
    // - read-only: 只 tools=["read"]
    let sessionTools: string[] | undefined;
    let sessionExcludeTools: string[] | undefined;
    let customTools: unknown[] | undefined;
    if (toolMode === "read-only") {
      sessionTools = ["read"];
      customTools = undefined;
    } else if (toolMode === "bridge-controlled") {
      // V17-B1 任务 B+C：构建 Bridge-controlled write tools（真实 executor）
      const allowBash = settings.backendProfile === "developer";
      const allowAbsolute = developerMode; // V17-C 任务 E：仅 developerMode 允许绝对路径
      const executor = createDefaultBridgeToolExecutor(ctx.plan.cwd, allowBash, { allowAbsolute });
      const bridgeTools = buildBridgeControlledWriteTools(ctx.permission, this.providerId, executor);
      // 用 defineTool 包装（如果 SDK 暴露 defineTool）；否则直接传 raw 定义
      try {
        if (typeof sdk.defineTool === "function") {
          customTools = bridgeTools.map((t) => (sdk.defineTool as (d: ToolDefinition) => unknown)(t));
        } else {
          customTools = bridgeTools.slice();
        }
      } catch {
        customTools = bridgeTools.slice();
      }
      // V17-C1 任务 E：不传 tools=["read"]（会导致 customTools 被 allowlist 过滤）
      // 改用 excludeTools 排除 Pi 内置 write/edit/bash，让 read + 其他内置工具保留，
      // 同时 customTools 中的 bridge_* 不受 tools allowlist 影响
      sessionTools = undefined;
      sessionExcludeTools = ["write", "edit", "bash"];
    } else {
      // pi-native：不传 tools（用 Pi 默认 read/write/edit/bash），不传 customTools
      sessionTools = undefined;
      customTools = undefined;
    }

    // 创建会话（最小参数 — 实际 SDK 需要更多配置，这里做 best-effort）
    let session: AgentSessionLike;
    try {
      const sessionManager = sdk.SessionManager?.inMemory
        ? sdk.SessionManager.inMemory()
        : undefined;
      // V17-D 任务 F：复用 createAuthWithOverride 确保 session 拿到 runtime override
      const { authStorage, modelRegistry } = createAuthWithOverride(sdk, authOverride);
      const settingsManager = sdk.SettingsManager?.inMemory
        ? sdk.SettingsManager.inMemory({ compaction: { enabled: false } })
        : undefined;

      const sessionOpts: Record<string, unknown> = {
        cwd: ctx.plan.cwd,
        thinkingLevel: "medium",
        sessionManager,
        authStorage,
        modelRegistry,
        settingsManager,
      };
      // V17-C 任务 B + V17-C1 任务 E：按 toolMode 传入 tools/excludeTools/customTools
      // pi-native 不传 tools（用 Pi 默认配置）
      if (sessionTools !== undefined) {
        sessionOpts.tools = sessionTools;
      }
      if (sessionExcludeTools !== undefined && sessionExcludeTools.length > 0) {
        sessionOpts.excludeTools = sessionExcludeTools;
      }
      if (customTools !== undefined && customTools.length > 0) {
        sessionOpts.customTools = customTools;
      }
      // V17-D 任务 F：显式指定 model（覆盖 SDK 默认选择）
      if (authOverride.model) {
        const modelId = authOverride.model;
        const provider = authOverride.provider || "anthropic";
        if (modelRegistry && typeof modelRegistry.find === "function") {
          const found = modelRegistry.find(provider, modelId);
          if (found) sessionOpts.model = found;
        }
      }
      const result = await sdk.createAgentSession(sessionOpts);
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

    // V17-B1 任务 E：toolCallId 注册表（同一工具调用 start/update/end 复用 id）
    const idRegistry = new ToolCallIdRegistry();

    // V17-B1 任务 D：并发 streaming 结构
    // subscribe 注册 → 异步启动 prompt → for await iterate yield events
    // prompt 抛错时 yield error + push null 结束；agent_end 后正常 completed
    const stream = createAsyncEventStream<NormalizedRuntimeEvent>();
    let agentEnded = false;
    let lastError: string | null = null;
    let promptThrown = false;

    const unsubscribe = session.subscribe((event: PiSdkEvent) => {
      const mapped = mapPiSdkEvent(event, this.providerId, idRegistry);
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

    // 异步启动 prompt（不阻塞事件消费）
    const promptPromise = (async () => {
      try {
        await session.prompt(prompt);
      } catch (e) {
        promptThrown = true;
        stream.push({
          providerId: this.providerId,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "error",
            message: `session.prompt 失败：${e instanceof Error ? e.message : String(e)}`,
            recoverable: true,
          },
        });
        // prompt 抛错后必须 push null 结束 generator，不挂住
        stream.push(null);
      }
    })();

    // 消费事件流（哨兵 null 时结束）
    for await (const evt of stream.iterate()) {
      yield evt;
    }

    // 确保 promptPromise 完成（异常已通过 stream 处理）
    try { await promptPromise; } catch { /* ignore, already handled */ }
    try { unsubscribe(); } catch { /* ignore */ }
    idRegistry.clear();

    // 终态
    if (lastError) {
      yield {
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "failed", message: lastError, recoverable: true },
      };
    } else if (!agentEnded && !promptThrown) {
      // 没收到 agent_end 且 prompt 未抛错：发 completed 兜底
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
 *
 * V17-B1 任务 D：支持并发 push（subscribe 回调 + prompt 异步）。
 */
function createAsyncEventStream<T>(): {
  push: (item: T | null) => void;
  iterate: () => AsyncIterable<T>;
} {
  const buffer: (T | null)[] = [];
  let waiter: (() => void) | null = null;
  let ended = false;

  const push = (item: T | null): void => {
    if (ended) return;
    buffer.push(item);
    if (item === null) ended = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };

  const iterate = (): AsyncIterable<T> => {
    const iterable: AsyncIterable<T> = {
      [Symbol.asyncIterator]: async function* () {
        while (true) {
          if (buffer.length > 0) {
            const item = buffer.shift();
            if (item === null) return;
            yield item;
          } else {
            if (ended) return;
            await new Promise<void>((resolve) => { waiter = resolve; });
          }
        }
      },
    };
    return iterable;
  };

  return { push, iterate };
}
