// LLM CLI Bridge — SDK Backend (V2.0 SDK Workflow Deepening)
// 实验性 Claude Agent SDK 接入：尝试加载真实 SDK，不可用时 fallback mock workflow
// 不破坏 AgentEvent v0.1；工具级事件通过 onWorkflowEvent 传递（UI-only）
//
// V2.0 策略：
// 1. 尝试加载 @anthropic-ai/claude-agent-sdk（新包名）或 @anthropic-ai/claude-code（旧包名）
// 2. 若可用：调用真实 SDK query()，用 mapSdkMessageToWorkflowEvents 映射事件流（含 thinking/completed/failed）
// 3. 若不可用：fallback 到 mock workflow（模拟工具调用序列 + thinking + 终态），UI 仍可展示流程
// 4. 收集 SDK diagnostics（可用性/包名/版本/事件数/partialCount/fallback 原因/错误摘要），日志脱敏
// 5. 权限：canUseTool 回调发出 permission 事件，默认 allow（仅展示，不自动批准危险操作由 permissionMode 控制）
// 6. partial：stream_event 映射 text/thinking/progress，保留 SDK 原始过程

import * as path from "path";
import { AgentBackend, AgentEventHandler, AgentRunHandle, AgentTask } from "./agentBackend";
import {
  AgentSkillsRuntimePreparationResult,
  prepareAgentSkillsForClaudeRuntimeSync,
} from "./agentSkills";
import { applyClaudeRuntimeEnv, resolveClaudeRuntimeConfig } from "./claudeRuntimeConfig";
import { LLMBridgeSettings } from "./types";
import {
  MessageEvent,
  ToolStartEvent,
  ToolResultEvent,
  FileChangeEvent,
  PermissionEvent,
  ErrorEvent,
  ThinkingEvent,
  CompletedEvent,
  FailedEvent,
  WorkflowEvent,
  WorkflowEventHandler,
  redactWorkflowEvent,
  redactSecrets,
} from "./workflowEvent";
import {
  SdkMessage,
  SdkDiagnostics,
  mapSdkMessageToWorkflowEvents,
  createInitialDiagnostics,
  updateDiagnostics,
  formatDiagnosticsForLog,
} from "./sdkMessageMapper";
import type {
  UserInputOption,
  UserInputQuestion,
  UserInputRequest,
  UserInputResponse,
} from "./runtime/core/types";
import {
  assessToolRisk,
  decideByMode,
  checkSessionAllow,
  checkSessionDeny,
  createSessionAllow,
  createSessionDeny,
  buildRequestMergeKey,
  assessSubagentPermissionRisk,
  isSdkUserInputTool,
  type PermissionChoice,
  type SessionPermissionAllow,
  type SessionPermissionDeny,
} from "./sdkPermission";
import { RuntimeFileToolAdapterResult, RuntimeFileToolCall, describeRuntimeFileToolAdapter } from "./runtimeFileToolAdapter";

// ---------- SDK 可用性探测 ----------

/** SDK 包名候选（新包名优先，旧包名兼容） */
const SDK_PACKAGE_CANDIDATES = [
  "@anthropic-ai/claude-agent-sdk", // V1.7: 新包名（当前推荐）
  "@anthropic-ai/claude-code", // V1.6: 旧包名（已 deprecated，兼容）
];

export const SDK_SKILL_SETTING_SOURCES = ["user", "project", "local"] as const;

export interface SdkLoadResult {
  readonly mod: unknown;
  readonly packageName: string;
  readonly version: string | null;
}

async function* createSdkUserMessageStream(content: unknown[]): AsyncIterable<unknown> {
  yield {
    type: "user",
    message: {
      role: "user",
      content,
    },
  };
}

/**
 * 从 SDK assistant 文本事件中提取应追加到正文的增量文本。
 *
 * 兼容两类常见流式模式：
 * 1. 累积快照：前一段为 "Hello"，后一段为 "Hello world" → 只追加 " world"
 * 2. 分块输出：前一段为 "Hello"，后一段为 " world" → 直接追加第二段
 */
export function deriveAssistantTextDelta(previousText: string, nextText: string): string {
  if (!nextText) return "";
  if (!previousText) return nextText;
  if (nextText === previousText) return "";
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length);
  }
  if (previousText.endsWith(nextText) || previousText.includes(nextText)) {
    return "";
  }
  return nextText;
}

/**
 * 候选运行时根目录（V2.4 修正：支持 vault 内 + sibling 两种布局）
 * 1. <vault>/LLM-AgentRuntime — vault 内子目录（原有布局）
 * 2. <vault>/../LLM-AgentRuntime — vault 同级 sibling 目录（多 vault 共享运行时）
 * @returns 候选运行时根目录数组（按优先级）
 */
export function resolveRuntimeDirs(cwd: string): string[] {
  return [
    path.join(cwd, "LLM-AgentRuntime"),
    path.join(cwd, "..", "LLM-AgentRuntime"),
  ];
}

/**
 * V2.16-A: 安装 Node 兼容的 AbortController，使 SDK 的 setMaxListeners(n, signal) 不抛错。
 *
 * 根因：SDK 源码 `import{setMaxListeners as Wz}from"events"` → `Ws()` 内部 `new AbortController()`
 * → `Wz(e, t.signal)` 传入 browser AbortSignal。Node 的 setMaxListeners 检查
 * `instanceof EventEmitter` 或 `isEventTarget(target)`，Electron renderer 的 browser AbortSignal
 * 不被识别（ESM 内置 events 与 CJS require('events') 绑定独立，CJS patch 无效）。
 *
 * 方案：在 SDK query 调用前，将 globalThis.AbortController 替换为 EventEmitter-based 版本。
 * SDK 的 `Ws()` 做 `new AbortController()`，得到 EventEmitter-based signal，通过 instanceof 检查。
 * query 结束后恢复原始 AbortController。
 *
 * @returns 恢复函数（调用后还原 globalThis.AbortController）
 */
function installNodeCompatibleAbortController(): () => void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require("events");
  const originalAC = globalThis.AbortController;

  // EventEmitter-based AbortSignal：通过 instanceof EventEmitter 检查
  class NodeCompatAbortSignal extends EventEmitter {
    public _aborted = false;
    public _abortReason: unknown = undefined;
    get aborted(): boolean { return this._aborted; }
    get reason(): unknown { return this._abortReason; }
    throwIfAborted(): void { if (this._aborted) throw new Error("The operation was aborted."); }
    addEventListener(type: string, listener: (...args: unknown[]) => void): void {
      if (type === "abort") this.on("abort", listener);
    }
    removeEventListener(type: string, listener: (...args: unknown[]) => void): void {
      if (type === "abort") this.off("abort", listener);
    }
    dispatchEvent(event: { type: string }): boolean {
      if (event && event.type === "abort") {
        this._aborted = true;
        this.emit("abort", event);
      }
      return true;
    }
  }

  class NodeCompatAbortController {
    public signal: NodeCompatAbortSignal;
    constructor() { this.signal = new NodeCompatAbortSignal(); }
    abort(reason?: unknown): void {
      if (this.signal._aborted) return;
      this.signal._aborted = true;
      this.signal._abortReason = reason;
      this.signal.emit("abort", { type: "abort" });
    }
  }

  globalThis.AbortController = NodeCompatAbortController as unknown as typeof AbortController;
  return () => { globalThis.AbortController = originalAC; };
}

/**
 * 尝试加载 Claude Agent SDK
 * 优先从候选运行时目录（vault 内 + sibling）的 node_modules 加载，再尝试全局 require
 * @returns 加载结果（含包名与版本），不可用时返回 null
 */
export function tryLoadSdk(cwd: string): SdkLoadResult | null {
  const runtimeDirs = resolveRuntimeDirs(cwd);
  for (const pkgName of SDK_PACKAGE_CANDIDATES) {
    // 1. 候选运行时目录（vault 内 + sibling）
    for (const runtimeDir of runtimeDirs) {
      try {
        const localPath = path.join(runtimeDir, "node_modules", pkgName);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(localPath);
        const version = extractSdkVersion(pkgName, runtimeDir);
        return { mod, packageName: pkgName, version };
      } catch {
        // 该运行时目录加载失败，继续下一个
      }
    }
    // 2. 尝试全局 require
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(pkgName);
      const version = extractSdkVersion(pkgName, null);
      return { mod, packageName: pkgName, version };
    } catch {
      // 全局也失败，尝试下一个候选包名
    }
  }
  return null;
}

/**
 * 提取 SDK 版本（从 package.json，不含 secret）
 * @param pkgName SDK 包名
 * @param runtimeDir 运行时根目录（null 表示全局 require）
 */
function extractSdkVersion(pkgName: string, runtimeDir: string | null): string | null {
  try {
    const fs = require("fs");
    if (runtimeDir) {
      const pkgJsonPath = path.join(runtimeDir, "node_modules", pkgName, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        return pkg.version ?? null;
      }
    }
    // 尝试全局 node_modules
    const globalPkgPath = require.resolve(`${pkgName}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(globalPkgPath, "utf8"));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * 检测 SDK 是否可用（不实际调用）
 */
export function isSdkAvailable(cwd: string): boolean {
  return tryLoadSdk(cwd) !== null;
}

// ---------- Mock Workflow 事件生成（fallback 用） ----------

/**
 * 生成 mock workflow 事件序列（模拟真实工具调用流程）
 * 用于无真实 SDK 时测试 UI 渲染
 *
 * V2.0 序列（覆盖 thinking/tool/file/permission/completed）：
 *   thinking → message(assistant) → tool_start(Read) → tool_result(Read)
 *   → tool_start(Write) → permission(Write) → tool_result(Write)
 *   → file_change(create) → message(assistant) → completed
 */
export function generateMockWorkflowEvents(
  task: AgentTask,
  onWorkflowEvent: WorkflowEventHandler,
  timers: ReturnType<typeof setTimeout>[],
  startedAt: number,
): void {
  const now = () => new Date().toISOString();
  let delay = 50;

  const schedule = (fn: () => void) => {
    const t = setTimeout(fn, delay);
    timers.push(t);
    delay += 150;
  };

  // 1. V2.0 thinking（模型思考过程摘要）
  schedule(() => {
    const ev: ThinkingEvent = {
      type: "thinking",
      timestamp: now(),
      text: `分析请求：${task.userMessage.slice(0, 30)}，需要先读取笔记再生成摘要`,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 2. assistant 消息
  schedule(() => {
    const ev: MessageEvent = {
      type: "message",
      timestamp: now(),
      role: "assistant",
      text: `我来处理你的请求：${task.userMessage.slice(0, 40)}`,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 3. tool_start: Read
  const readCallId = `call_read_${startedAt}`;
  schedule(() => {
    const ev: ToolStartEvent = {
      type: "tool_start",
      timestamp: now(),
      toolName: "Read",
      toolInput: JSON.stringify({ file_path: "notes/example.md" }),
      callId: readCallId,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 4. tool_result: Read
  schedule(() => {
    const ev: ToolResultEvent = {
      type: "tool_result",
      timestamp: now(),
      callId: readCallId,
      toolName: "Read",
      output: "# 示例笔记\n这是文件内容...",
      isError: false,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 5. tool_start: Write
  const writeCallId = `call_write_${startedAt}`;
  schedule(() => {
    const ev: ToolStartEvent = {
      type: "tool_start",
      timestamp: now(),
      toolName: "Write",
      toolInput: JSON.stringify({ file_path: `${task.cwd}/output/summary.md`, content: "..." }),
      callId: writeCallId,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 6. permission: Write
  schedule(() => {
    const ev: PermissionEvent = {
      type: "permission",
      timestamp: now(),
      toolName: "Write",
      description: "写入文件 output/summary.md",
      granted: true,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 7. tool_result: Write
  schedule(() => {
    const ev: ToolResultEvent = {
      type: "tool_result",
      timestamp: now(),
      callId: writeCallId,
      toolName: "Write",
      output: "文件已写入",
      isError: false,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 8. file_change: create
  schedule(() => {
    const ev: FileChangeEvent = {
      type: "file_change",
      timestamp: now(),
      action: "create",
      path: "output/summary.md",
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 9. assistant 最终消息
  schedule(() => {
    const ev: MessageEvent = {
      type: "message",
      timestamp: now(),
      role: "assistant",
      text: "已完成处理，生成了摘要文件。",
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // 10. V2.0 completed 终态事件（UI-only）
  schedule(() => {
    const ev: CompletedEvent = {
      type: "completed",
      timestamp: now(),
      text: "mock workflow 完成（SDK 不可用，演示用）",
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });
}

/**
 * 生成 mock 失败 workflow 事件序列（V2.0：覆盖 error + failed 终态）
 */
export function generateMockFailureWorkflowEvents(
  task: AgentTask,
  onWorkflowEvent: WorkflowEventHandler,
  timers: ReturnType<typeof setTimeout>[],
): void {
  const now = () => new Date().toISOString();
  let delay = 50;

  const schedule = (fn: () => void) => {
    const t = setTimeout(fn, delay);
    timers.push(t);
    delay += 150;
  };

  schedule(() => {
    const ev: MessageEvent = {
      type: "message",
      timestamp: now(),
      role: "assistant",
      text: `尝试处理：${task.userMessage.slice(0, 40)}`,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  const readCallId = `call_read_fail_${Date.now()}`;
  schedule(() => {
    const ev: ToolStartEvent = {
      type: "tool_start",
      timestamp: now(),
      toolName: "Read",
      toolInput: JSON.stringify({ file_path: "nonexistent.md" }),
      callId: readCallId,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  schedule(() => {
    const ev: ToolResultEvent = {
      type: "tool_result",
      timestamp: now(),
      callId: readCallId,
      toolName: "Read",
      output: "ENOENT: no such file or directory",
      isError: true,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  schedule(() => {
    const ev: ErrorEvent = {
      type: "error",
      timestamp: now(),
      message: "无法读取所需文件，任务终止",
      recoverable: false,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });

  // V2.0: failed 终态事件（UI-only）
  schedule(() => {
    const ev: FailedEvent = {
      type: "failed",
      timestamp: now(),
      message: "mock workflow 失败（读取文件失败，演示用）",
      recoverable: false,
    };
    onWorkflowEvent(redactWorkflowEvent(ev));
  });
}

// ---------- 真实 SDK 调用 ----------

/**
 * V2.3s: 权限状态（会话级允许/拒绝缓存 + 待决策请求）
 * 在 SdkBackend 实例上持有，canUseTool 回调通过引用访问
 */
export interface PermissionState {
  /** 会话级允许缓存 */
  readonly allows: SessionPermissionAllow[];
  /** 会话级拒绝缓存 */
  readonly denies: SessionPermissionDeny[];
  /** 待决策的权限请求（requestId → resolve 回调） */
  readonly pending: Map<string, (choice: PermissionChoice) => void>;
}

/**
 * 创建空的权限状态
 */
export function createPermissionState(): PermissionState {
  return {
    allows: [],
    denies: [],
    pending: new Map(),
  };
}

export interface SdkAgentSkillsOptions {
  readonly ok: boolean;
  readonly settingSources: readonly string[];
  readonly skills: readonly string[];
  readonly preparation: AgentSkillsRuntimePreparationResult;
  readonly reason?: string;
}

function truncateToolInputSummary(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function summarizeObjectPlaceholderString(text: string): string | null {
  const next = text.replace(/\[object Object\](\s*,\s*\[object Object\])*/g, (match) => {
    const count = match.match(/\[object Object\]/g)?.length ?? 0;
    return count > 1 ? `${count} items` : "{ object }";
  });
  return next === text ? null : next;
}

function summarizeToolInputValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    return truncateToolInputSummary(summarizeObjectPlaceholderString(value) ?? value, 60);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "0 items";
    const scalarOnly = value.every((item) => item == null || ["string", "number", "boolean"].includes(typeof item));
    if (scalarOnly) {
      const joined = value
        .map((item) => item == null ? "null" : String(item))
        .join(", ");
      return truncateToolInputSummary(joined, 60);
    }
    return `${value.length} items`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    const preview = keys.slice(0, 3).join(", ");
    return `{ ${preview}${keys.length > 3 ? ", ..." : ""} }`;
  }
  return null;
}

/**
 * V2.3s: 摘要工具输入参数（用于 UI 展示，已脱敏）
 */
export function summarizeToolInput(
  input: Record<string, unknown>,
  options: { developerMode?: boolean } = {},
): string {
  if (options.developerMode) {
    try {
      return truncateToolInputSummary(JSON.stringify(input), 200);
    } catch {
      // ignore and fall back to structured summary
    }
  }
  const parts: string[] = [];
  if (typeof input.file_path === "string") parts.push(`file: ${input.file_path}`);
  if (typeof input.notebook_path === "string") parts.push(`notebook: ${input.notebook_path}`);
  if (typeof input.path === "string") parts.push(`path: ${input.path}`);
  if (typeof input.command === "string") parts.push(`cmd: ${input.command.slice(0, 80)}`);
  if (typeof input.pattern === "string") parts.push(`pattern: ${input.pattern}`);
  if (typeof input.url === "string") parts.push(`url: ${input.url}`);
  if (typeof input.query === "string") parts.push(`query: ${input.query.slice(0, 60)}`);
  if (parts.length === 0) {
    for (const k of Object.keys(input)) {
      const summary = summarizeToolInputValue(input[k]);
      if (!summary) continue;
      parts.push(`${k}: ${summary}`);
      if (parts.length >= 3) break;
    }
  }
  return parts.join(" | ");
}

function readStringField(input: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function parseAskUserQuestionOptions(value: unknown): ReadonlyArray<UserInputOption> {
  if (!Array.isArray(value)) return [];
  const parsed: UserInputOption[] = [];
  for (const item of value) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const label = String(item).trim();
      if (label) parsed.push({ label, value: label });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const label = typeof raw.label === "string" && raw.label.trim().length > 0
      ? raw.label.trim()
      : typeof raw.title === "string" && raw.title.trim().length > 0
        ? raw.title.trim()
        : typeof raw.value === "string" && raw.value.trim().length > 0
          ? raw.value.trim()
          : "";
    if (!label) continue;
    parsed.push({
      label,
      description: typeof raw.description === "string" && raw.description.trim().length > 0
        ? raw.description.trim()
        : undefined,
      value: typeof raw.value === "string" && raw.value.trim().length > 0
        ? raw.value.trim()
        : label,
    });
  }
  return parsed;
}

function parseAskUserQuestionQuestion(
  value: unknown,
  index: number,
  fallbackOptions: ReadonlyArray<UserInputOption>,
): UserInputQuestion | null {
  if (typeof value === "string") {
    const question = value.trim();
    if (!question) return null;
    return { id: `question-${index + 1}`, question, options: fallbackOptions };
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const question = readStringField(raw, ["question", "prompt", "text", "label"]);
  if (!question) return null;
  const options = parseAskUserQuestionOptions(raw.options ?? raw.choices);
  return {
    id: readStringField(raw, ["id", "name", "key"]) ?? `question-${index + 1}`,
    header: readStringField(raw, ["header", "title"]),
    question,
    options: options.length > 0 ? options : fallbackOptions,
  };
}

export function parseAskUserQuestionRequest(
  toolName: string,
  input: Record<string, unknown>,
  opts: { toolUseID?: string; description?: string; displayName?: string },
): UserInputRequest {
  const prompt = readStringField(input, ["prompt", "message", "description"])
    ?? opts.description
    ?? opts.displayName
    ?? "Input required";
  const fallbackOptions = parseAskUserQuestionOptions(input.options ?? input.choices);
  const structuredQuestions = Array.isArray(input.questions)
    ? input.questions
      .map((q, index) => parseAskUserQuestionQuestion(q, index, fallbackOptions))
      .filter((q): q is UserInputQuestion => q !== null)
    : [];
  const singleQuestion = structuredQuestions.length === 0
    ? parseAskUserQuestionQuestion(
      input.question ?? (fallbackOptions.length > 0 ? prompt : undefined),
      0,
      fallbackOptions,
    )
    : null;
  const questions = structuredQuestions.length > 0
    ? structuredQuestions
    : singleQuestion ? [singleQuestion] : undefined;
  const toolUseId = opts.toolUseID ? String(opts.toolUseID).replace(/[^A-Za-z0-9_-]/g, "_") : "";
  return {
    requestId: toolUseId
      ? `sdk-input-${toolUseId}`
      : `sdk-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    providerId: "claude-sdk",
    toolName,
    prompt,
    inputType: input.inputType === "secret" || input.type === "secret" ? "secret" : "text",
    questions,
    placeholder: readStringField(input, ["placeholder"]),
    providerContext: {
      toolUseID: opts.toolUseID,
    },
  };
}

function buildAskUserQuestionAnswers(
  response: UserInputResponse,
  questions: ReadonlyArray<UserInputQuestion> | undefined,
): Record<string, string> {
  if (response.type === "cancel") return {};
  const answerValue = response.value.trim();
  if (!questions || questions.length === 0) return { answer: answerValue };
  const splitValues = answerValue.split(/\s+\+\s+/).map((v) => v.trim()).filter(Boolean);
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    answers[question.id] = splitValues[index] ?? answerValue;
  });
  return answers;
}

export async function handleAskUserQuestion(
  toolName: string,
  input: Record<string, unknown>,
  opts: { toolUseID?: string; description?: string; displayName?: string },
  task: AgentTask,
  developerMode: boolean,
): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> {
  const userInput = task.runtimeUserInput;
  const emitRuntimeEvent = task.emitRuntimeEvent;
  if (!userInput || !emitRuntimeEvent) {
    return { behavior: "deny", message: "AskUserQuestion requires runtime user input bridge" };
  }

  const request = parseAskUserQuestionRequest(toolName, input, opts);
  userInput.requestInput(request);
  emitRuntimeEvent({
    providerId: "claude-sdk",
    timestamp: new Date().toISOString(),
    rawProviderEvent: developerMode ? { method: "sdk-canUseTool-user-input", toolName, input, opts } : undefined,
    payload: {
      kind: "user_input_request",
      requestId: request.requestId,
      toolName: request.toolName,
      prompt: request.prompt,
      inputType: request.inputType,
      questions: request.questions,
      placeholder: request.placeholder,
    },
  });

  const result = await userInput.waitForInput(request.requestId);
  emitRuntimeEvent({
    providerId: "claude-sdk",
    timestamp: new Date().toISOString(),
    rawProviderEvent: developerMode ? { method: "sdk-user-input-resolved", requestId: request.requestId, response: result.response } : undefined,
    payload: {
      kind: "user_input_resolved",
      requestId: request.requestId,
      response: result.response,
      source: result.source,
    },
  });

  if (result.response.type === "cancel") {
    return { behavior: "deny", message: "User cancelled AskUserQuestion" };
  }
  const value = result.response.value.trim();
  return {
    behavior: "allow",
    updatedInput: {
      ...input,
      value,
      answer: value,
      response: value,
      answers: buildAskUserQuestionAnswers(result.response, request.questions),
    },
  };
}

export function buildSdkAgentSkillsOptions(vaultPath: string): SdkAgentSkillsOptions {
  const preparation = prepareAgentSkillsForClaudeRuntimeSync(vaultPath);
  const skills = preparation.manifest.skills
    .filter((record) => record.enabled)
    .map((record) => record.slug);
  return {
    ok: preparation.ok,
    settingSources: SDK_SKILL_SETTING_SOURCES,
    skills,
    preparation,
    ...(preparation.reason ? { reason: preparation.reason } : {}),
  };
}

function buildAgentSkillsPreparationFailureSummary(result: SdkAgentSkillsOptions): string {
  const lines: string[] = [];
  lines.push("[sdk] Agent Skills runtime preparation failed");
  if (result.reason) {
    lines.push(`reason: ${result.reason}`);
  }
  for (const item of result.preparation.results.filter((r) => !r.ok)) {
    lines.push(`- ${item.record.slug}: ${item.reason || item.status}`);
  }
  return lines.join("\n");
}

/**
 * 构造 SDK query options（从 EffectiveRunPlan / LLMBridgeSettings 映射）
 * V2.17-A: 优先从 task.effectiveRunPlan 读取（单一真相源），回退到 settings。
 * - effort 使用官方字段（不再用未确认的 reasoningEffort）
 * - 显式 claude_code systemPrompt / tools preset
 * - 显式 settingSources / skills
 */
export function buildSdkOptions(
  task: AgentTask,
  settings: LLMBridgeSettings,
  agentSkillsOptions?: SdkAgentSkillsOptions,
): Record<string, unknown> {
  const plan = task.effectiveRunPlan;
  const effort = plan?.effort ?? settings.effortLevel;
  const model = plan?.model ?? settings.model;
  const settingSources = plan?.settingSources ?? agentSkillsOptions?.settingSources;
  const skills = plan?.skills ?? agentSkillsOptions?.skills;
  const options: Record<string, unknown> = {
    cwd: task.cwd,
    // V2.17-A: model/effort 来自 EffectiveRunPlan（UI/SDK/CLI 三端一致）
    model: model || undefined,
    // V2.17-A: 使用官方 effort 字段（不再用未确认的 reasoningEffort）
    ...(effort ? { effort } : {}),
    permissionMode: settings.claudePermissionMode ?? "default",
    // V2.16-G: 打开 SDK partial stream，避免首包前长期无响应。
    includePartialMessages: true,
    // V2.16-H: Ask the SDK/API for displayable thinking summaries when the
    // selected model/runtime supports them. Unsupported paths simply won't emit
    // thinking text; the UI keeps the lightweight placeholder.
    thinking: { type: "adaptive", display: "summarized" },
    // V2.17-A: 显式 claude_code systemPrompt / tools preset
    systemPrompt: { preset: "claude_code" },
    tools: { preset: "claude_code" },
  };
  // 继续会话
  if (settings.claudeContinueSession) {
    options.continue = true;
  } else if (settings.claudeResumeSessionId) {
    options.resume = settings.claudeResumeSessionId;
  }
  // extra args
  if (settings.claudeExtraArgs) {
    options.extraArgs = settings.claudeExtraArgs.split(/\s+/).filter(Boolean);
  }
  // V2.17-A: settingSources / skills 来自 plan（或 agentSkillsOptions 回退）
  if (settingSources) {
    options.settingSources = [...settingSources];
  }
  if (skills) {
    options.skills = [...skills];
  }
  return options;
}

export async function executeSdkRuntimeFileTool(task: AgentTask, call: RuntimeFileToolCall): Promise<RuntimeFileToolAdapterResult> {
  if (!task.runtimeFileToolAdapter) {
    return buildMissingRuntimeFileToolAdapterResult("sdk", call.toolName);
  }
  return task.runtimeFileToolAdapter.execute(call);
}

function buildMissingRuntimeFileToolAdapterResult(kind: "sdk", toolName: string): RuntimeFileToolAdapterResult {
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

/**
 * 调用真实 SDK query 并映射事件流
 * @returns 终态信息 { status, text, exitCode, diagnostics }
 */
async function runRealSdkQuery(
  sdkMod: unknown,
  task: AgentTask,
  settings: LLMBridgeSettings,
  onEvent: AgentEventHandler,
  onWorkflowEvent: WorkflowEventHandler | undefined,
  diagnostics: SdkDiagnostics,
  startedAt: number,
  permissionState: PermissionState,
): Promise<{ status: "completed" | "failed"; text: string; exitCode: number; diagnostics: SdkDiagnostics }> {
  const queryFn = (sdkMod as { query?: unknown }).query;
  if (typeof queryFn !== "function") {
    // SDK 模块无 query 函数，fallback
    const fallbackReason = "SDK module has no query() function";
    return {
      status: "failed",
      text: `[sdk] ${fallbackReason}`,
      exitCode: 1,
      diagnostics: updateDiagnostics(diagnostics, { fallbackReason }),
    };
  }

  const agentSkillsOptions = buildSdkAgentSkillsOptions(task.cwd);
  if (!agentSkillsOptions.ok) {
    const summary = buildAgentSkillsPreparationFailureSummary(agentSkillsOptions);
    if (onWorkflowEvent) {
      const errEv: ErrorEvent = {
        type: "error",
        timestamp: new Date().toISOString(),
        message: summary,
        recoverable: false,
      };
      onWorkflowEvent(redactWorkflowEvent(errEv));
    }
    return {
      status: "failed",
      text: summary,
      exitCode: 1,
      diagnostics: updateDiagnostics(diagnostics, { fallbackReason: "Agent Skills runtime preparation failed" }),
    };
  }

  const options = buildSdkOptions(task, settings, agentSkillsOptions);
  const runtimeConfig = resolveClaudeRuntimeConfig(task.cwd);
  const clearInheritedRuntimeEnv = runtimeConfig.source === "project-json" || runtimeConfig.source === "auto-detected";
  const restoreRuntimeEnv = applyClaudeRuntimeEnv(runtimeConfig.env, clearInheritedRuntimeEnv);
  let restoreAbortController: (() => void) | null = null;
  let msgCount = 0;
  let wfEventCount = 0;
  let partialCount = 0;
  let terminalStatus: "completed" | "failed" = "completed";
  let terminalText = "";
  let terminalExitCode = 0;
  let streamedAssistantText = "";

  try {
    if (onWorkflowEvent && settings.developerMode) {
      const adapterEv: MessageEvent = {
        type: "message",
        timestamp: new Date().toISOString(),
        role: "system",
        text: describeRuntimeFileToolAdapter(task.runtimeFileToolAdapter),
      };
      onWorkflowEvent(redactWorkflowEvent(adapterEv));
      wfEventCount++;
    }

    // V2.3.2: canUseTool 回调 —— decideByMode 为唯一真相源
    // 1. 评估工具风险（assessToolRisk）
    // 2. 检查会话级允许/拒绝缓存
    // 3. 调用 decideByMode 统一决策：allow=允许 / deny=拒绝 / ask=等待用户确认
    // 4. ask 时发出 pending 权限事件，用户决策（allow_once/allow_session/deny_session）通过 resolvePermission 注入
    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      opts: { toolUseID?: string; description?: string; displayName?: string; sessionId?: string; parentToolUseId?: string },
    ): Promise<{ behavior: "allow" | "deny"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> => {
      if (isSdkUserInputTool(toolName)) {
        return handleAskUserQuestion(toolName, input, opts, task, !!settings.developerMode);
      }

      const mode = settings.claudePermissionMode ?? "default";
      const risk = assessToolRisk(toolName, input);
      const mergeKey = buildRequestMergeKey(toolName, risk, input);
      const inputSummary = summarizeToolInput(input, { developerMode: settings.developerMode });
      const sessionId = opts.sessionId;
      const parentToolUseId = opts.parentToolUseId;
      const isSubagent = !!parentToolUseId;
      const subagentRiskWarn = isSubagent
        ? assessSubagentPermissionRisk(mode, true).warning
        : "";

      // 发出权限事件辅助函数
      const emitPerm = (
        granted: boolean,
        source: "user" | "session_allow" | "session_deny" | "mode",
        pending: boolean = false,
        requestId?: string,
      ): void => {
        if (!onWorkflowEvent) return;
        const ev: PermissionEvent = {
          type: "permission",
          timestamp: new Date().toISOString(),
          toolName,
          description: opts.description ?? opts.displayName ?? `Tool: ${toolName}`,
          granted,
          riskLevel: risk.level,
          riskReason: risk.reason,
          highRiskFlags: risk.highRiskFlags.length > 0 ? risk.highRiskFlags : undefined,
          source,
          sessionId,
          parentToolUseId,
          requestId,
          mergeKey,
          pending,
          inputSummary,
          subagentRisk: subagentRiskWarn || undefined,
        };
        onWorkflowEvent(redactWorkflowEvent(ev));
        wfEventCount++;
      };

      // 1. 检查会话级允许缓存
      if (checkSessionAllow(permissionState.allows, toolName, risk, input)) {
        emitPerm(true, "session_allow");
        return { behavior: "allow", updatedInput: input };
      }

      // 2. 检查会话级拒绝缓存
      if (checkSessionDeny(permissionState.denies, toolName, risk, input)) {
        emitPerm(false, "session_deny");
        return { behavior: "deny", message: `会话已拒绝：${toolName}（${risk.reason}）` };
      }

      // 3. 调用 decideByMode 统一决策（唯一真相源）
      const decision = decideByMode(mode, risk);
      if (decision.behavior === "allow") {
        emitPerm(true, "mode");
        return { behavior: "allow", updatedInput: input };
      }
      if (decision.behavior === "deny") {
        emitPerm(false, "mode");
        return { behavior: "deny", message: decision.reason };
      }

      // 4. decision.behavior === "ask"：等待用户决策
      const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      emitPerm(true, "user", true, requestId); // pending=true

      const choice = await new Promise<PermissionChoice>((resolve) => {
        permissionState.pending.set(requestId, resolve);
      });

      // 应用用户决策
      if (choice === "allow_once") {
        emitPerm(true, "user", false, requestId);
        return { behavior: "allow", updatedInput: input };
      }
      if (choice === "allow_session") {
        permissionState.allows.push(createSessionAllow(toolName, risk, input));
        emitPerm(true, "user", false, requestId);
        return { behavior: "allow", updatedInput: input };
      }
      // deny_session
      permissionState.denies.push(createSessionDeny(toolName, risk, input));
      emitPerm(false, "user", false, requestId);
      return { behavior: "deny", message: `用户拒绝：${toolName}（${risk.reason}）` };
    };
    options.canUseTool = canUseTool;

    // V2.16-A: 安装 Node 兼容 AbortController（SDK 内部 setMaxListeners 需要 EventEmitter-based signal）
    restoreAbortController = installNodeCompatibleAbortController();

    // 调用 query。V2.16-E: 有图片/blob 附件时使用 SDK Streaming Input。
    const promptInput = task.sdkStreamingInput
      ? createSdkUserMessageStream(task.sdkStreamingInput.content)
      : task.prompt;
    const queryResult = (queryFn as (params: { prompt: string | AsyncIterable<unknown>; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>)({
      prompt: promptInput,
      options,
    });

    // 迭代事件流
    for await (const msg of queryResult) {
      msgCount++;
      const result = mapSdkMessageToWorkflowEvents(msg);
      partialCount += result.partial ? 1 : 0;

      // 发出映射的 WorkflowEvent
      if (onWorkflowEvent) {
        for (const ev of result.events) {
          onWorkflowEvent(redactWorkflowEvent(ev));
          wfEventCount++;
        }
      }

      // P4-D: SDK assistant 正文只走 WorkflowEvent.message -> Normalized message -> AssistantTurnView，
      // 不再二次发射 stdout_delta（历史双写根因，导致 finalAnswer 重复）。
      // stdout_delta 仅保留给 CLI/mock 路径或无 message 事件时的 terminal fallback。
      // 仅在 developer mode 追踪 streamedAssistantText 用于 terminal fallback reconcile 审计。
      if (settings.developerMode) {
        for (const ev of result.events) {
          if (ev.type !== "message" || ev.role !== "assistant" || !ev.text) continue;
          const deltaText = deriveAssistantTextDelta(streamedAssistantText, ev.text);
          if (!deltaText) continue;
          streamedAssistantText += deltaText;
        }
      }

      // 处理终态
      if (result.terminal === "completed") {
        terminalStatus = "completed";
        terminalText = result.terminalText;
        terminalExitCode = 0;
      } else if (result.terminal === "failed") {
        terminalStatus = "failed";
        terminalText = result.terminalText;
        terminalExitCode = 1;
      }
    }

    // P4-D: terminal fallback —— 仅当整个流式过程未产生任何 assistant message 时，
    // 才用 stdout_delta 把 terminalText 补齐到 finalAnswer（CLI 无 stream 的兼容路径）。
    // 有 message 事件时 AssistantTurnView 已是 source of truth，terminalText 仅用于 result.text 审计。
    if (terminalText && streamedAssistantText.length === 0) {
      onEvent({ type: "stdout_delta", data: terminalText });
      streamedAssistantText = terminalText;
    }

    const effectiveTerminalText = terminalText || streamedAssistantText;

    const finalDiagnostics = updateDiagnostics(diagnostics, {
      available: true,
      messageCount: msgCount,
      workflowEventCount: wfEventCount,
      partialCount,
      // V2.0: 失败时记录错误摘要（脱敏）
      errorSummary: terminalStatus === "failed" ? redactSecrets(effectiveTerminalText.slice(0, 200)) : null,
    });

    return {
      status: terminalStatus,
      text: effectiveTerminalText || `[sdk] 任务 ${task.id} 已处理`,
      exitCode: terminalExitCode,
      diagnostics: finalDiagnostics,
    };
  } catch (e) {
    // SDK 调用异常 → failed
    const errMsg = e instanceof Error ? e.message : String(e);
    const redactedErr = redactSecrets(errMsg);
    const finalDiagnostics = updateDiagnostics(diagnostics, {
      available: true,
      messageCount: msgCount,
      workflowEventCount: wfEventCount,
      partialCount,
      fallbackReason: `SDK query error: ${redactedErr.slice(0, 100)}`,
      // V2.0: 错误摘要（脱敏，不含 secret）
      errorSummary: redactedErr.slice(0, 200),
    });

    // 发出 error workflow 事件
    if (onWorkflowEvent) {
      const errEv: ErrorEvent = {
        type: "error",
        timestamp: new Date().toISOString(),
        message: `SDK query failed: ${redactedErr}`,
        recoverable: false,
      };
      onWorkflowEvent(redactWorkflowEvent(errEv));
      // V2.0: failed 终态事件（UI-only）
      const failedEv: FailedEvent = {
        type: "failed",
        timestamp: new Date().toISOString(),
        message: `SDK query failed: ${redactedErr}`,
        recoverable: false,
      };
      onWorkflowEvent(redactWorkflowEvent(failedEv));
    }

    return {
      status: "failed",
      text: `[sdk] query error: ${redactedErr}`,
      exitCode: 1,
      diagnostics: finalDiagnostics,
    };
  } finally {
    if (restoreAbortController) restoreAbortController();
    restoreRuntimeEnv();
  }
}

// ---------- SdkBackend 实现 ----------

/**
 * SDK Backend（V2.16-B: SDK primary runtime）
 *
 * 行为：
 * - 尝试加载真实 Claude Agent SDK（新/旧包名）
 * - 若可用：调用 SDK query()，用 mapSdkMessageToWorkflowEvents 映射事件流
 * - 若不可用：
 *   - strict=false（auto 模式）：fallback mock workflow，模拟工具调用序列 + AgentEvent v0.1
 *   - strict=true（显式 sdk 模式）：发 failed 事件，显示明确错误，不静默 fallback
 *
 * AgentEvent v0.1 不变；工具级事件通过 onWorkflowEvent 传递
 * SDK diagnostics 收集可用性/包名/版本/事件数/fallback 原因，日志脱敏
 */
export class SdkBackend implements AgentBackend {
  readonly name = "sdk";

  /** 最近一次运行的诊断信息（供 UI/日志读取，不含 secret） */
  lastDiagnostics: SdkDiagnostics | null = null;

  /** V2.3s: 权限状态（会话级允许/拒绝缓存 + 待决策请求） */
  private permissionState: PermissionState = createPermissionState();

  /**
   * V2.16-B: strict 模式（显式选 sdk 时）
   * - true: SDK 不可用时发 failed 事件，不静默 fallback mock
   * - false: SDK 不可用时 fallback mock workflow（auto 模式默认行为）
   */
  constructor(private readonly strict: boolean = false) {}

  /**
   * V2.3s: 解析待决策的权限请求（由 UI 调用）
   * @param requestId 权限请求 ID
   * @param choice 用户决策（allow_once/allow_session/deny_session）
   * @returns true=成功解析；false=请求不存在或已解析
   */
  resolvePermission(requestId: string, choice: PermissionChoice): boolean {
    const resolve = this.permissionState.pending.get(requestId);
    if (!resolve) return false;
    this.permissionState.pending.delete(requestId);
    resolve(choice);
    return true;
  }

  /**
   * V2.3s: 清空会话级权限缓存与待决策请求
   * 在新会话或 stop 时调用；待决策请求自动拒绝（deny_session）
   */
  clearSessionPermissions(): void {
    // 拒绝所有待决策请求
    for (const [, resolve] of this.permissionState.pending) {
      resolve("deny_session");
    }
    this.permissionState.pending.clear();
    this.permissionState.allows.length = 0;
    this.permissionState.denies.length = 0;
  }

  /**
   * V2.3s: 获取当前会话级允许缓存（供 UI/测试读取）
   */
  getSessionAllows(): ReadonlyArray<SessionPermissionAllow> {
    return this.permissionState.allows;
  }

  /**
   * V2.3s: 获取当前会话级拒绝缓存（供 UI/测试读取）
   */
  getSessionDenies(): ReadonlyArray<SessionPermissionDeny> {
    return this.permissionState.denies;
  }

  run(
    task: AgentTask,
    settings: LLMBridgeSettings,
    onEvent: AgentEventHandler,
    onWorkflowEvent?: WorkflowEventHandler,
  ): AgentRunHandle {
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const startedAt = Date.now();

    const cleanup = () => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    };

    // 发出 started 事件
    onEvent({ type: "started", task });

    // 初始诊断
    let diagnostics = createInitialDiagnostics(task.cwd, settings.model || null, settings.claudePermissionMode ?? null);

    // 尝试加载 SDK
    const sdkLoadResult = tryLoadSdk(task.cwd);
    const sdkAvailable = sdkLoadResult !== null;

    if (sdkAvailable && sdkLoadResult) {
      diagnostics = updateDiagnostics(diagnostics, {
        available: true,
        packageName: sdkLoadResult.packageName,
        version: sdkLoadResult.version,
      });
      this.lastDiagnostics = diagnostics;

      // 真实 SDK 路径：异步调用 query
      const runAsync = async () => {
        if (stopped) return;
        const result = await runRealSdkQuery(
          sdkLoadResult.mod,
          task,
          settings,
          onEvent,
          onWorkflowEvent,
          diagnostics,
          startedAt,
          this.permissionState,
        );
        if (stopped) return;

        this.lastDiagnostics = result.diagnostics;
        // 记录诊断日志（脱敏，不含 secret）
        console.log(`[sdk] ${formatDiagnosticsForLog(result.diagnostics)}`);

        stopped = true;
        cleanup();
        const durationMs = Date.now() - startedAt;
        if (result.status === "completed") {
          onEvent({
            type: "completed",
            exitCode: 0,
            durationMs,
            stdout: result.text,
            stderr: "",
            command: "sdk",
            args: [],
          });
        } else {
          onEvent({
            type: "failed",
            exitCode: 1,
            durationMs,
            stdout: "",
            stderr: result.text,
            command: "sdk",
            args: [],
          });
        }
      };
      void runAsync();
    } else {
      // SDK 不可用
      diagnostics = updateDiagnostics(diagnostics, {
        available: false,
        fallbackReason: "SDK package not found (@anthropic-ai/claude-agent-sdk / @anthropic-ai/claude-code)",
      });
      this.lastDiagnostics = diagnostics;

      // V2.16-B: strict 模式（显式选 sdk）— 发 failed 事件，不静默 fallback
      if (this.strict) {
        const durationMs = Date.now() - startedAt;
        const errMsg = "SDK 不可用：未找到 @anthropic-ai/claude-agent-sdk 包。请在 LLM-AgentRuntime/node_modules 安装 SDK，或切换 backend 为 auto/cli。";
        if (onWorkflowEvent) {
          const errEv: ErrorEvent = {
            type: "error",
            timestamp: new Date().toISOString(),
            message: errMsg,
            recoverable: false,
          };
          onWorkflowEvent(redactWorkflowEvent(errEv));
        }
        onEvent({
          type: "failed",
          exitCode: 1,
          durationMs,
          stdout: "",
          stderr: errMsg,
          command: "sdk",
          args: [],
        });
        stopped = true;
        return {
          get running(): boolean {
            return !stopped;
          },
          stop: (): void => {
            if (stopped) return;
            stopped = true;
            cleanup();
            this.clearSessionPermissions();
            onEvent({
              type: "stopped",
              exitCode: null,
              durationMs: Date.now() - startedAt,
              stdout: "",
              stderr: "",
              command: "sdk",
              args: [],
            });
          },
        };
      }

      // 非严格模式（auto fallback）：mock workflow
      if (onWorkflowEvent) {
        // 发一条系统消息说明 SDK 不可用
        const now = () => new Date().toISOString();
        const sysMsg: MessageEvent = {
          type: "message",
          timestamp: now(),
          role: "system",
          text: "SDK 不可用，使用 mock workflow 演示",
        };
        onWorkflowEvent(redactWorkflowEvent(sysMsg));
        generateMockWorkflowEvents(task, onWorkflowEvent, timers, startedAt);
      }

      // 模拟 stdout 输出（AgentEvent v0.1）
      const stdoutTimer = setTimeout(() => {
        if (stopped) return;
        const output = `[sdk-mock] 任务 ${task.id} 已处理（SDK 不可用，fallback mock）`;
        onEvent({ type: "stdout_delta", data: output });
      }, 1200);
      timers.push(stdoutTimer);

      // 模拟完成
      const completeTimer = setTimeout(() => {
        if (stopped) return;
        stopped = true; // 标记不再运行（完成后 handle.running 应为 false）
        cleanup();
        const durationMs = Date.now() - startedAt;
        const stdout = `[sdk-mock] 任务 ${task.id} 已处理（SDK 不可用，fallback mock）`;
        onEvent({
          type: "completed",
          exitCode: 0,
          durationMs,
          stdout,
          stderr: "",
          command: "sdk",
          args: [],
        });
      }, 1500);
      timers.push(completeTimer);
    }

    return {
      get running(): boolean {
        return !stopped;
      },
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        cleanup();
        // V2.3s: 停止时拒绝所有待决策权限请求，避免 Promise 永久挂起
        this.clearSessionPermissions();
        onEvent({
          type: "stopped",
          exitCode: null,
          durationMs: Date.now() - startedAt,
          stdout: "",
          stderr: "",
          command: "sdk",
          args: [],
        });
      },
    };
  }
}
