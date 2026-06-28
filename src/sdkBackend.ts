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
// 6. partial：stream_event 标记 partial 不产出事件，不伪造工具过程

import * as path from "path";
import { AgentBackend, AgentEventHandler, AgentRunHandle, AgentTask } from "./agentBackend";
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
import {
  assessToolRisk,
  decideByMode,
  checkSessionAllow,
  checkSessionDeny,
  createSessionAllow,
  createSessionDeny,
  buildRequestMergeKey,
  assessSubagentPermissionRisk,
  type PermissionChoice,
  type SessionPermissionAllow,
  type SessionPermissionDeny,
} from "./sdkPermission";

// ---------- SDK 可用性探测 ----------

/** SDK 包名候选（新包名优先，旧包名兼容） */
const SDK_PACKAGE_CANDIDATES = [
  "@anthropic-ai/claude-agent-sdk", // V1.7: 新包名（当前推荐）
  "@anthropic-ai/claude-code", // V1.6: 旧包名（已 deprecated，兼容）
];

export interface SdkLoadResult {
  readonly mod: unknown;
  readonly packageName: string;
  readonly version: string | null;
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

/**
 * V2.3s: 摘要工具输入参数（用于 UI 展示，已脱敏）
 */
function summarizeToolInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.file_path === "string") parts.push(`file: ${input.file_path}`);
  if (typeof input.notebook_path === "string") parts.push(`notebook: ${input.notebook_path}`);
  if (typeof input.path === "string") parts.push(`path: ${input.path}`);
  if (typeof input.command === "string") parts.push(`cmd: ${input.command.slice(0, 80)}`);
  if (typeof input.pattern === "string") parts.push(`pattern: ${input.pattern}`);
  if (typeof input.url === "string") parts.push(`url: ${input.url}`);
  if (typeof input.query === "string") parts.push(`query: ${input.query.slice(0, 60)}`);
  if (parts.length === 0) {
    const keys = Object.keys(input).slice(0, 3);
    for (const k of keys) {
      const v = String(input[k]).slice(0, 60);
      parts.push(`${k}: ${v}`);
    }
  }
  return parts.join(" | ");
}

/**
 * 构造 SDK query options（从 LLMBridgeSettings 映射）
 */
function buildSdkOptions(task: AgentTask, settings: LLMBridgeSettings): Record<string, unknown> {
  const options: Record<string, unknown> = {
    cwd: task.cwd,
    // 不设置 model（让 SDK 使用默认/配置）；settings.model 主要给 CLI backend 用
    permissionMode: settings.claudePermissionMode ?? "default",
    // V1.7: 不启用 includePartialMessages（避免 partial 噪音，终态消息已足够）
    includePartialMessages: false,
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
  return options;
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

  const options = buildSdkOptions(task, settings);
  let msgCount = 0;
  let wfEventCount = 0;
  let partialCount = 0;
  let terminalStatus: "completed" | "failed" = "completed";
  let terminalText = "";
  let terminalExitCode = 0;

  try {
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
      const mode = settings.claudePermissionMode ?? "default";
      const risk = assessToolRisk(toolName, input);
      const mergeKey = buildRequestMergeKey(toolName, risk, input);
      const inputSummary = summarizeToolInput(input);
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

    // 调用 query
    const queryResult = (queryFn as (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>)({
      prompt: task.prompt,
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

    // 发出 stdout_delta（AgentEvent v0.1）
    if (terminalText) {
      onEvent({ type: "stdout_delta", data: terminalText });
    }

    const finalDiagnostics = updateDiagnostics(diagnostics, {
      available: true,
      messageCount: msgCount,
      workflowEventCount: wfEventCount,
      partialCount,
      // V2.0: 失败时记录错误摘要（脱敏）
      errorSummary: terminalStatus === "failed" ? redactSecrets(terminalText.slice(0, 200)) : null,
    });

    return {
      status: terminalStatus,
      text: terminalText || `[sdk] 任务 ${task.id} 已处理`,
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
  }
}

// ---------- SdkBackend 实现 ----------

/**
 * SDK Backend（实验性，V1.7 增强）
 *
 * 行为：
 * - 尝试加载真实 Claude Agent SDK（新/旧包名）
 * - 若可用：调用 SDK query()，用 mapSdkMessageToWorkflowEvents 映射事件流
 * - 若不可用：fallback mock workflow，模拟工具调用序列 + AgentEvent v0.1
 *
 * AgentEvent v0.1 不变；工具级事件通过 onWorkflowEvent 传递
 * SDK diagnostics 收集可用性/包名/版本/事件数/fallback 原因，日志脱敏
 */
export class SdkBackend implements AgentBackend {
  readonly name = "sdk-experimental";

  /** 最近一次运行的诊断信息（供 UI/日志读取，不含 secret） */
  lastDiagnostics: SdkDiagnostics | null = null;

  /** V2.3s: 权限状态（会话级允许/拒绝缓存 + 待决策请求） */
  private permissionState: PermissionState = createPermissionState();

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
        console.log(`[sdk-experimental] ${formatDiagnosticsForLog(result.diagnostics)}`);

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
            command: "sdk-experimental",
            args: [],
          });
        } else {
          onEvent({
            type: "failed",
            exitCode: 1,
            durationMs,
            stdout: "",
            stderr: result.text,
            command: "sdk-experimental",
            args: [],
          });
        }
      };
      void runAsync();
    } else {
      // Mock fallback 路径
      diagnostics = updateDiagnostics(diagnostics, {
        available: false,
        fallbackReason: "SDK package not found (@anthropic-ai/claude-agent-sdk / @anthropic-ai/claude-code)",
      });
      this.lastDiagnostics = diagnostics;

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
          command: "sdk-experimental",
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
          command: "sdk-experimental",
          args: [],
        });
      },
    };
  }
}
