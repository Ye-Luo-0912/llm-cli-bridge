// LLM CLI Bridge — CodexAppServerProvider (V2.17-A Completion)
//
// 主目标 provider：通过 codex app-server JSON-RPC over stdio JSONL 接入 Bridge Core。
//
// V2.17-A Completion 主线闭环 wire 协议（对齐官方 docs/generated schema）：
// 1. 每个连接先 send `initialize`，params 使用官方 shape：
//      { clientInfo: { name, title, version }, capabilities: { experimentalApi: bool }, cwd }
//    不再使用 clientName/clientVersion 顶层字段。
//    experimentalApi 默认 false；若启用必须在 CodexRunOptions audit 记录。
//    收到 result 后 notify `initialized`。
// 2. 新会话走 thread/start；resume 走 thread/resume（不再塞 resumeSessionId 进 thread/start）。
//    response result shape: { thread: { id, sessionId? } }。
// 3. send `turn/start`，input 为 content item array（[{ type:"text", text:userPrompt }, ...]）。
// 4. approval 不走 notification，而是 server-initiated request：
//    - item/commandExecution/requestApproval（带 id）
//    - item/fileChange/requestApproval（带 id）
//    client 按原 id 返回 result（{ decision: "accept"|"acceptForSession"|"decline"|"cancel" }）。
//    不再在 wire 层使用 allow/allowSession/deny。
//    item/tool/requestUserInput 同为 server request，走独立 user input 通道。
// 5. serverRequest/resolved 通知携带真实 requestId/threadId/turnId/itemId/decision，用于 UI 同步。
// 6. item delta 通知（官方 method 名）：
//    item/agentMessage/delta, item/reasoning/summaryTextDelta, item/reasoning/textDelta,
//    item/commandExecution/outputDelta, item/plan/delta, item/fileChange/outputDelta。
//    旧 item/text/delta 仅作为 fixture legacy alias，不作为主路径。
//
// 当前环境无 codex CLI；run() 仍可被 fixture JSONL 测试驱动（通过 EventMapper 直接测）。

import type { LLMBridgeSettings } from "../../../types";
import type {
  EffectiveRunPlan,
  NormalizedRuntimeEvent,
  RunContext,
  RunInput,
  RuntimeProvider,
  ProviderId,
} from "../../core/types";
import { CodexAppServerEventMapper } from "./codexAppServerEventMapper";
import { CodexAppServerApprovalMapper } from "./codexAppServerApprovalMapper";
import { CodexAppServerUserInputMapper } from "./codexAppServerUserInputMapper";
import { CodexAppServerSessionMapper } from "./codexAppServerSessionMapper";
import {
  buildCodexAppServerEffectiveRunPlan,
  buildCodexAppServerRunOptions,
} from "./codexAppServerEffectiveRunPlan";
import { AppServerProcessManager, type AppServerProcessLike, type AppServerSpawnOptions } from "./appServerProcessManager";
import { JsonRpcClient } from "./jsonRpcClient";
import type {
  CodexFileChangeItem,
  CodexInitializeResult,
  CodexItemAgentMessageDeltaParams,
  CodexItemArgumentDeltaParams,
  CodexItemCommandExecutionOutputDeltaParams,
  CodexItemCompletedParams,
  CodexFileChangeOutputDeltaParams,
  CodexItemPlanDeltaParams,
  CodexItemReasoningSummaryTextDeltaParams,
  CodexItemReasoningTextDeltaParams,
  CodexItemStartedParams,
  CodexItemTextDeltaParams,
  CodexServerRequestResolvedParams,
  CodexToolUserInputRequestParams,
  CodexThreadResumeResult,
  CodexThreadStartResult,
  CodexTurnCompletedParams,
  CodexTurnDiffUpdatedParams,
  CodexTurnFailedParams,
  CodexTurnInputItem,
  CodexTurnStartedParams,
} from "./schema";
import { execFileSync } from "child_process";
import { buildEnhancedPath } from "../../../claudeCliBackend";

/**
 * 任务1: 判断 NormalizedRuntimeEvent 是否为"有效输出"。
 *
 * no-op 判定核心：只有以下事件类型算作有效 turn 输出：
 * - message: assistant 文本回复
 * - tool_start / tool_result: 工具调用与结果
 * - file_change: 文件变更
 * - approval_request / approval_resolved: 审批流程
 * - user_input_request / user_input_resolved: 用户输入流程
 * - failed: 错误
 *
 * 以下不算有效输出（即使收到也不阻止 empty-completed → failed 转换）：
 * - progress (initialized / turn/started / turnDiff / status 类)
 * - session_started
 * - thinking（纯推理，无实际输出）
 * - stderr_delta（诊断信息，不是有效 turn 输出）
 * - completed（终态，由 no-op guard 单独处理）
 *
 * 这样 turn/completed(empty) 在仅收到 initialized + turn/started + turnDiff 时
 * 仍会被判定为 no-op 并转为 failed，避免"协议通但无输出"的假完成。
 */
export function isMeaningfulCodexRuntimeEvent(ev: NormalizedRuntimeEvent): boolean {
  const kind = (ev.payload as { kind: string }).kind;
  switch (kind) {
    case "message":
    case "tool_start":
    case "tool_result":
    case "file_change":
    case "approval_request":
    case "approval_resolved":
    case "user_input_request":
    case "user_input_resolved":
    case "failed":
      return true;
    default:
      return false;
  }
}

/**
 * 任务1: 构建 no-op completed → failed 的转换事件。
 *
 * 当 turn/completed 在 turnSubmitted 后到达，且期间未收到任何 meaningful 事件，
 * 且 completed.text 为空时，转换为 failed 事件。
 */
function buildNoOpFailedEvent(
  ev: NormalizedRuntimeEvent,
  providerId: ProviderId,
  developerMode: boolean,
): NormalizedRuntimeEvent {
  const payload = ev.payload as { kind: string; text?: unknown; sessionId?: string };
  return {
    providerId,
    timestamp: new Date().toISOString(),
    sourceRef: ev.sourceRef,
    rawProviderEvent: developerMode
      ? {
        ...(ev.rawProviderEvent && typeof ev.rawProviderEvent === "object" ? ev.rawProviderEvent : {}),
        emptyCompleted: true,
      }
      : undefined,
    payload: {
      kind: "failed",
      message: "Codex runtime ended without output. The app-server returned turn/completed before any response, tool, or diagnostic event.",
      recoverable: false,
      sessionId: payload.sessionId,
    },
  };
}

/**
 * CodexAppServerProvider：通过 codex app-server JSON-RPC 接入 Bridge Core。
 *
 * V17-F0 任务 B：定性为 external app-server provider（高级/开发者 fallback）。
 * 已重命名为 CodexExternalAppServerProvider，向后兼容别名 CodexAppServerProvider 保留。
 *
 * V17-E 任务 A：command 来源统一为 settings.codexCommand（constructor 注入），
 * isAvailable/run/resume/spawn 共用同一 command；spawn 使用 enhanced PATH
 * 避免普通用户因 PATH 不完整被误判不可用。
 *
 * 注意：本 provider 是 external executable fallback，不是 Codex 线主线。
 * 主线为 CodexSdkProvider（嵌入式 SDK），本轮为占位。
 */
export class CodexExternalAppServerProvider implements RuntimeProvider {
  // V17-F1.1 任务 B：providerId/displayName 改为 constructor 参数赋值（非 field initializer）
  // 这样子类通过 super() 传入正确的 providerId，mappers 在父类 constructor 中捕获正确值
  readonly providerId: ProviderId;
  readonly displayName: string;
  private directSourceRefSequence = 0;

  private readonly approvalMapper: CodexAppServerApprovalMapper;
  private readonly userInputMapper: CodexAppServerUserInputMapper;
  private readonly sessionMapper: CodexAppServerSessionMapper;
  /** 当前活动进程（cancel 用） */
  private currentProcess: AppServerProcessLike | null = null;
  /** 当前活动 JsonRpcClient（cancel/approval respond 用） */
  private currentClient: JsonRpcClient | null = null;
  /** 当前 runId（cancel 配对） */
  private currentRunId: string | null = null;
  /**
   * 任务3: serverRequestId → 本地 approval response 快照。
   * 当 serverRequest/resolved 通知缺 itemId/decision 时，用本地记录回填。
   * 禁止缺 decision 时把已 accept 的请求映射为 decline。
   */
  private readonly serverRequestBookkeeping = new Map<string | number, {
    requestId: string;
    itemId?: string;
    decision: "accept" | "acceptForSession" | "decline" | "cancel";
    method: string;
  }>();
  /** V17-E 任务 A：codex 命令来源（来自 settings.codexCommand，默认 "codex"） */
  private readonly codexCommand: string;
  /** V17-F1.1 任务 B：app-server 启动参数（由 constructor 接收，子类不再需要 override） */
  private readonly appServerArgs: string[];

  constructor(
    _developerMode: boolean = false,
    codexCommand: string = "codex",
    providerId: ProviderId = "codex-app-server",
    displayName: string = "Codex app-server (external)",
    appServerArgs: string[] = ["app-server"],
  ) {
    // V17-F1.1 任务 B：用参数赋值 readonly 字段，确保 mappers 捕获正确 providerId
    this.providerId = providerId;
    this.displayName = displayName;
    this.appServerArgs = appServerArgs.length > 0 ? appServerArgs : ["app-server"];
    this.approvalMapper = new CodexAppServerApprovalMapper(providerId);
    this.userInputMapper = new CodexAppServerUserInputMapper(providerId);
    this.sessionMapper = new CodexAppServerSessionMapper();
    this.codexCommand = codexCommand || "codex";
  }

  isAvailable(cwd: string): boolean {
    // V17-E 任务 A：探测 command 来源与 run/spawn 一致（this.codexCommand）
    try {
      execFileSync(this.codexCommand, ["--version"], {
        cwd,
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 3000,
        env: this.buildSpawnEnv(cwd),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * V17-F1.1 任务 B：返回 app-server 启动参数（从 constructor 接收，子类不再需要 override）。
   */
  protected getAppServerArgs(): string[] {
    return this.appServerArgs;
  }

  /**
   * V17-F1.1 任务 B：暴露 approvalMapper 实际使用的 providerId（测试验证用）。
   *
   * 验证 managed provider 的 approval request providerId 是 "codex-managed-app-server"
   * 而非父类默认的 "codex-app-server"。
   */
  getApprovalProviderId(): ProviderId {
    return this.approvalMapper.getProviderId();
  }

  /**
   * V17-E 任务 A：构建 spawn env（含 enhanced PATH）。
   * 复用 claudeCliBackend 的 buildEnhancedPath，避免普通用户因 PATH 不完整被误判不可用。
   */
  private buildSpawnEnv(cwd: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    try {
      const extraPath = buildEnhancedPath(cwd);
      if (extraPath) {
        env.PATH = extraPath + (process.platform === "win32" ? ";" : ":") + (env.PATH || "");
      }
    } catch { /* fallthrough: enhanced PATH 不可用时退回 process.env */ }
    return env;
  }

  buildPlan(input: RunInput, settings: LLMBridgeSettings): EffectiveRunPlan {
    return buildCodexAppServerEffectiveRunPlan(input, settings);
  }

  async *run(ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const developerMode = !!settings.developerMode;
    // 每个 run 用独立 eventMapper，保证 rawProviderEvent 正确填充
    const eventMapper = new CodexAppServerEventMapper(this.providerId, developerMode);

    // 派生 codex 运行参数
    const options = buildCodexAppServerRunOptions(ctx.plan, ctx.promptPackage);

    // V17-E 任务 A：启动 codex app-server 进程（command 来源 = this.codexCommand，env 含 enhanced PATH）
    const process = this.createProcess({
      command: this.codexCommand,
      args: this.getAppServerArgs(),
      cwd: ctx.plan.cwd,
      env: this.buildSpawnEnv(ctx.plan.cwd),
    });
    this.currentProcess = process;

    // 构造 JsonRpcClient
    const client = this.createClient(process);
    this.currentClient = client;

    // async queue：把通知 handler 产出的 NormalizedRuntimeEvent push 给 generator
    const queue = new Array<NormalizedRuntimeEvent>();
    let resolveWait: (() => void) | null = null;
    let done = false;
    let turnSubmitted = false;
    let turnRuntimeEventCount = 0;

    const push = (ev: NormalizedRuntimeEvent | null): void => {
      if (!ev) return;
      let next = ev;
      const payload = ev.payload as { kind: string; text?: unknown; sessionId?: string };
      // 任务1: 只对 meaningful 事件计数（assistant/tool/file/approval/user-input/error），
      // initialized/session_started/turn/started/turnDiff/progress 不算有效输出。
      if (turnSubmitted && isMeaningfulCodexRuntimeEvent(ev)) {
        turnRuntimeEventCount += 1;
      }
      // 任务1: 无 meaningful 事件时，turn/completed(empty) 必须转 failed
      if (turnSubmitted && payload.kind === "completed" && turnRuntimeEventCount === 0) {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) {
          next = buildNoOpFailedEvent(ev, this.providerId, developerMode);
        }
      }
      queue.push(next);
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    };

    const signalDone = (): void => {
      done = true;
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    };

    // 注册通知 handler（item/* 事件）
    // V2.17-A Completion 主线闭环：注册 6 个官方 delta method + turn/started + nested item/* 事件。
    // 旧 item/text/delta / item/thinking/delta / item/argument/delta 仅作为 fixture legacy alias。
    const unreg: Array<() => void> = [];
    const handlerUnregs = this.registerEventHandlers(client, eventMapper, push, signalDone, ctx, developerMode, () => turnSubmitted);
    unreg.push(...handlerUnregs);

    // 进程退出 → 兜底 signalDone
    unreg.push(process.onExit((_code, _signal) => {
      if (!done) {
        push({
          providerId: this.providerId,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "failed",
            message: "codex app-server process exited",
            recoverable: false,
          },
        });
        signalDone();
      }
    }));

    // stderr → stderr_delta
    unreg.push(process.onStderrLine((line) => {
      push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        rawProviderEvent: developerMode ? { stream: "stderr", line } : undefined,
        payload: { kind: "stderr_delta", data: line },
      });
    }));

    try {
      // P5: currentRunId 在 try 内赋值，确保 setup 阶段抛错时不泄漏（finally 会清理）
      this.currentRunId = ctx.runId;
      // 1. initialize handshake（官方 shape：clientInfo + capabilities；不再用 clientName/clientVersion）
      //    experimentalApi 默认 false；options.initialize 已由 buildCodexAppServerRunOptions 构造。
      const initResult = await client.send<CodexInitializeResult>(
        "initialize", options.initialize,
      );
      push(eventMapper.mapInitialized(initResult));

      // notify initialized（handshake 完成）
      client.notify("initialized");

      // 2. thread/start（新 thread；resume 路径走 thread/resume，不再塞 resumeSessionId）
      //    response result shape: { thread: { id, sessionId? } }
      //    wire payload 剥离 config/instructions（真实 codex binary 读取顶层 model + baseInstructions；
      //    config/instructions 保留在 options 对象供 thread/resume 路径与审计哈希使用，但发到
      //    wire 上会导致 app-server hang）。与 codex-managed-runtime-smoke provider-wire 验证一致。
      const { config: _wireDropConfig, instructions: _wireDropInstr, ...threadStartWire } = options.threadStart;
      const threadResult = await client.send<CodexThreadStartResult>(
        "thread/start", threadStartWire,
      );
      const threadId = threadResult.thread.id;
      const sessionId = threadResult.thread.sessionId;
      // V2.17-A Completion: 同时注册 runId 和 bridgeSessionId（若提供），供 resume 按 bridgeSessionId 查找。
      this.sessionMapper.register(ctx.runId, threadId, sessionId);
      if (ctx.bridgeSessionId && ctx.bridgeSessionId !== ctx.runId) {
        this.sessionMapper.register(ctx.bridgeSessionId, threadId, sessionId);
      }
      push(eventMapper.mapThreadStarted(threadId, sessionId));

      // 3. turn/start（input 为 content item array）
      turnSubmitted = true;
      await client.send("turn/start", {
        ...options.turnStart,
        threadId,
      });

      // 等待事件流直到 done
      while (!done) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (done) break;
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      // 清理
      for (const u of unreg) {
        try { u(); } catch { /* swallow */ }
      }
      client.close();
      process.kill();
      this.currentProcess = null;
      this.currentClient = null;
      this.currentRunId = null;
    }
  }

  cancel(_runId: string): void {
    if (this.currentClient) {
      this.currentClient.close();
    }
    if (this.currentProcess) {
      this.currentProcess.kill();
    }
    this.currentProcess = null;
    this.currentClient = null;
    this.currentRunId = null;
  }

  async *resume(sessionId: string, ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // V2.17-A Completion 主线闭环：resume 走 thread/resume，不再塞 resumeSessionId 进 thread/start。
    // 决策：sessionMapper.hasCodexThread(sessionId|bridgeSessionId) → thread/resume 路径；否则退化为 thread/start。
    // 优先用 bridgeSessionId 查找（会话生命周期内稳定）；其次用 sessionId（兼容旧调用）。
    const lookupKey = ctx.bridgeSessionId ?? sessionId;
    const codexThread = this.sessionMapper.getCodexThread(lookupKey);
    if (!codexThread) {
      // 无映射：退化为新 thread（保持向后兼容；记录为 provider 行为，不作为主路径）
      yield* this.run(ctx, settings);
      return;
    }

    // 有映射：走 thread/resume 路径
    const developerMode = !!settings.developerMode;
    const eventMapper = new CodexAppServerEventMapper(this.providerId, developerMode);
    const options = buildCodexAppServerRunOptions(ctx.plan, ctx.promptPackage);

    const codexCommand = this.codexCommand;
    const process = this.createProcess({
      command: codexCommand,
      args: this.getAppServerArgs(),
      cwd: ctx.plan.cwd,
      env: this.buildSpawnEnv(ctx.plan.cwd),
    });
    this.currentProcess = process;

    const client = this.createClient(process);
    this.currentClient = client;

    const queue = new Array<NormalizedRuntimeEvent>();
    let resolveWait: (() => void) | null = null;
    let done = false;
    let turnSubmitted = false;
    let turnRuntimeEventCount = 0;

    const push = (ev: NormalizedRuntimeEvent | null): void => {
      if (!ev) return;
      let next = ev;
      const payload = ev.payload as { kind: string; text?: unknown; sessionId?: string };
      // 任务1: 只对 meaningful 事件计数（与 run() 一致）
      if (turnSubmitted && isMeaningfulCodexRuntimeEvent(ev)) {
        turnRuntimeEventCount += 1;
      }
      // 任务1: 无 meaningful 事件时，turn/completed(empty) 必须转 failed
      if (turnSubmitted && payload.kind === "completed" && turnRuntimeEventCount === 0) {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) {
          next = buildNoOpFailedEvent(ev, this.providerId, developerMode);
        }
      }
      queue.push(next);
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    };

    const signalDone = (): void => {
      done = true;
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    };

    const unreg: Array<() => void> = [];
    const handlerUnregs = this.registerEventHandlers(client, eventMapper, push, signalDone, ctx, developerMode, () => turnSubmitted);
    unreg.push(...handlerUnregs);

    unreg.push(process.onExit((_code, _signal) => {
      if (!done) {
        push({
          providerId: this.providerId,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "failed",
            message: "codex app-server process exited during resume",
            recoverable: false,
          },
        });
        signalDone();
      }
    }));

    unreg.push(process.onStderrLine((line) => {
      push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        rawProviderEvent: developerMode ? { stream: "stderr", line } : undefined,
        payload: { kind: "stderr_delta", data: line },
      });
    }));

    try {
      // P5: currentRunId 在 try 内赋值，确保 setup 阶段抛错时不泄漏（finally 会清理）
      this.currentRunId = ctx.runId;
      // 1. initialize handshake（与 run 一致；clientInfo + capabilities）
      const initResult = await client.send<CodexInitializeResult>(
        "initialize", options.initialize,
      );
      push(eventMapper.mapInitialized(initResult));
      client.notify("initialized");

      // 2. thread/resume（恢复已有 threadId；不再走 thread/start 伪恢复）
      const resumeResult = await client.send<CodexThreadResumeResult>(
        "thread/resume",
        {
          threadId: codexThread,
          config: options.threadStart.config,
          cwd: ctx.plan.cwd,
        },
      );
      const resumedThreadId = resumeResult.thread.id;
      const resumedSessionId = resumeResult.thread.sessionId;
      // V2.17-A Completion: 同步更新 sessionMapper（runId + bridgeSessionId + 原始 lookupKey），
      // 保证后续 resume 仍能找到最新的 threadId。
      this.sessionMapper.register(ctx.runId, resumedThreadId, resumedSessionId);
      if (ctx.bridgeSessionId && ctx.bridgeSessionId !== ctx.runId) {
        this.sessionMapper.register(ctx.bridgeSessionId, resumedThreadId, resumedSessionId);
      }
      if (lookupKey !== ctx.runId && lookupKey !== ctx.bridgeSessionId) {
        this.sessionMapper.register(lookupKey, resumedThreadId, resumedSessionId);
      }
      push(eventMapper.mapThreadResumed(resumedThreadId, resumedSessionId));

      // 3. turn/start（input 为 content item array）
      turnSubmitted = true;
      await client.send("turn/start", {
        ...options.turnStart,
        input: buildResumeTurnInput(options.turnStart.input, options.threadStart.instructions),
        threadId: resumedThreadId,
      });

      while (!done) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (done) break;
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      for (const u of unreg) {
        try { u(); } catch { /* swallow */ }
      }
      client.close();
      process.kill();
      this.currentProcess = null;
      this.currentClient = null;
      this.currentRunId = null;
    }
  }

  // ---------- 内部 ----------

  /**
   * 注册 codex app-server 通知 + server-request handler（run/resume 共用）。
   *
   * V2.17-A Completion 主线闭环：
   * - 6 个官方 delta method（item/agentMessage/delta 等）作为主路径
   * - 旧 item/text/delta / item/thinking/delta / item/argument/delta 作为 legacy alias
   * - item/started / item/completed 解析 nested params.item
   * - turn/started / turn/completed / turn/failed
   * - serverRequest/resolved 携带真实 requestId/threadId/turnId/itemId
   * - approval server-request（commandExecution / fileChange）使用官方 decision shape
   */
  private registerEventHandlers(
    client: JsonRpcClient,
    eventMapper: CodexAppServerEventMapper,
    push: (ev: NormalizedRuntimeEvent | null) => void,
    signalDone: () => void,
    ctx: RunContext,
    developerMode: boolean,
    isTurnSubmitted: () => boolean,
  ): Array<() => void> {
    const unreg: Array<() => void> = [];

    // 任务2: transport 错误处理（invalid JSON / unrecognized JSON-RPC message）
    // - turn 前（turnSubmitted=false）错误：直接 failed + signalDone（run 无法启动）
    // - turn 中错误：push stderr_delta（进入 error timeline，用户可见），不立即终止；
    //   若后续 turn/completed(empty)，no-op guard 会转 failed（stderr_delta 不算 meaningful）
    unreg.push(client.onError((err) => {
      push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        rawProviderEvent: developerMode ? { method: "transport-error", error: err.message } : undefined,
        payload: { kind: "stderr_delta", data: `[transport error] ${err.message}` },
      });
      if (!isTurnSubmitted()) {
        // turn 前 transport 错误：run 无法继续
        push({
          providerId: this.providerId,
          timestamp: new Date().toISOString(),
          rawProviderEvent: developerMode ? { method: "transport-error-terminal", error: err.message } : undefined,
          payload: {
            kind: "failed",
            message: `Codex app-server transport error before turn: ${err.message}`,
            recoverable: false,
          },
        });
        signalDone();
      }
    }));

    // item/started（官方 nested params.item）
    unreg.push(client.onNotification("item/started", (params) => {
      push(eventMapper.mapItemStarted(params as CodexItemStartedParams));
    }));

    // 官方 delta methods（主路径，驱动 AssistantTurnView.finalAnswer / thinking / tool progress）
    unreg.push(client.onNotification("item/agentMessage/delta", (params) => {
      push(eventMapper.mapItemAgentMessageDelta(params as CodexItemAgentMessageDeltaParams));
    }));
    unreg.push(client.onNotification("item/reasoning/summaryTextDelta", (params) => {
      push(eventMapper.mapItemReasoningSummaryTextDelta(params as CodexItemReasoningSummaryTextDeltaParams));
    }));
    unreg.push(client.onNotification("item/reasoning/textDelta", (params) => {
      push(eventMapper.mapItemReasoningTextDelta(params as CodexItemReasoningTextDeltaParams));
    }));
    unreg.push(client.onNotification("item/commandExecution/outputDelta", (params) => {
      push(eventMapper.mapItemCommandExecutionOutputDelta(params as CodexItemCommandExecutionOutputDeltaParams));
    }));
    unreg.push(client.onNotification("item/plan/delta", (params) => {
      push(eventMapper.mapItemPlanDelta(params as CodexItemPlanDeltaParams));
    }));
    unreg.push(client.onNotification("item/fileChange/outputDelta", (params) => {
      push(eventMapper.mapItemFileChangeOutputDelta(params as CodexFileChangeOutputDeltaParams));
    }));
    unreg.push(client.onNotification("turn/diff/updated", (params) => {
      push(eventMapper.mapTurnDiffUpdated(params as CodexTurnDiffUpdatedParams));
    }));

    // 旧 fixture legacy alias delta（不作为主路径，保留兼容）
    unreg.push(client.onNotification("item/text/delta", (params) => {
      push(eventMapper.mapItemTextDelta(params as CodexItemTextDeltaParams));
    }));
    unreg.push(client.onNotification("item/thinking/delta", (params) => {
      push(eventMapper.mapThinkingDelta(params as CodexItemTextDeltaParams));
    }));
    unreg.push(client.onNotification("item/argument/delta", (params) => {
      push(eventMapper.mapItemArgumentDelta(params as CodexItemArgumentDeltaParams));
    }));

    // item/completed（官方 nested params.item；fileChange 多 changes 在此展开）
    unreg.push(client.onNotification("item/completed", (params) => {
      const completedParams = params as CodexItemCompletedParams;
      const item = completedParams.item;
      // fileChange item 含 changes 数组：每个 change 映射为一条 file_change 事件
      if (item?.type === "fileChange") {
        const fcItem = item as CodexFileChangeItem;
        if (fcItem.changes && fcItem.changes.length > 0) {
          for (let i = 0; i < fcItem.changes.length; i++) {
            push(eventMapper.mapItemCompleted(completedParams, i));
          }
          return;
        }
      }
      push(eventMapper.mapItemCompleted(completedParams));
    }));

    // turn/started（官方通知）
    unreg.push(client.onNotification("turn/started", (params) => {
      push(eventMapper.mapTurnStarted(params as CodexTurnStartedParams));
    }));

    // serverRequest/resolved 通知：标记 approval 已落地（UI 同步，携带真实 requestId/threadId/turnId/itemId）
    // 任务3: resolved 缺 itemId/decision 时用本地 bookkeeping 回填；
    //       禁止缺 decision 时默认把已 accept 的请求映射为 decline。
    unreg.push(client.onNotification("serverRequest/resolved", (params) => {
      const resolved = params as CodexServerRequestResolvedParams;
      const local = resolved.requestId !== undefined
        ? this.serverRequestBookkeeping.get(resolved.requestId)
        : undefined;
      // 回填缺失的 itemId
      if (!resolved.itemId && local?.itemId) {
        (resolved as CodexServerRequestResolvedParams).itemId = local.itemId;
      }
      // 回填缺失的 decision：用本地记录（禁止默认 decline）
      const wireDecision = resolved.decision ?? resolved.outcome;
      if (!wireDecision && local) {
        (resolved as CodexServerRequestResolvedParams).decision = local.decision;
      }
      // 清理 bookkeeping（resolved 已落地）
      if (resolved.requestId !== undefined) {
        this.serverRequestBookkeeping.delete(resolved.requestId);
      }
      push(eventMapper.mapServerRequestResolved(resolved));
    }));

    unreg.push(client.onNotification("turn/completed", (params) => {
      push(eventMapper.mapTurnCompleted(params as CodexTurnCompletedParams));
      signalDone();
    }));
    unreg.push(client.onNotification("turn/failed", (params) => {
      push(eventMapper.mapTurnFailed(params as CodexTurnFailedParams));
      signalDone();
    }));

    // approval server-request handler：item/commandExecution/requestApproval
    // client 按原 id 返回 result（{ decision: "accept"|"acceptForSession"|"decline"|"cancel" }）
    unreg.push(client.onServerRequest(
      "item/commandExecution/requestApproval",
      (params, serverRequestId) => {
        const approvalReq = this.approvalMapper.mapApprovalRequest({
          method: "item/commandExecution/requestApproval",
          serverRequestId,
          params: params as never,
        });
        return this.handleApprovalRequest(approvalReq, ctx, client, eventMapper, push, developerMode, params);
      },
    ));

    // approval server-request handler：item/fileChange/requestApproval
    unreg.push(client.onServerRequest(
      "item/fileChange/requestApproval",
      (params, serverRequestId) => {
        const approvalReq = this.approvalMapper.mapApprovalRequest({
          method: "item/fileChange/requestApproval",
          serverRequestId,
          params: params as never,
        });
        return this.handleApprovalRequest(approvalReq, ctx, client, eventMapper, push, developerMode, params);
      },
    ));

    // item/tool/requestUserInput：独立 user input 通道
    unreg.push(client.onServerRequest(
      "item/tool/requestUserInput",
      (params, serverRequestId) => {
        const inputReq = this.userInputMapper.mapUserInputRequest({
          method: "item/tool/requestUserInput",
          serverRequestId,
          params: params as CodexToolUserInputRequestParams,
        });
        return this.handleUserInputRequest(inputReq, ctx, push, developerMode, params);
      },
    ));

    return unreg;
  }

  /**
   * 处理 approval server-request：返回 Promise<result>，client 按 id 自动回复。
   *
   * 流程：
   * 1. PermissionBoundary.requestApproval：返回 pending/auto-allow/auto-deny
   * 2. 若 auto：立即返回 decision
   * 3. 若 pending：调 waitForApproval 异步等待用户决策，resolve 后返回 decision
   */
  private handleApprovalRequest(
    approvalReq: import("../../core/types").ApprovalRequest,
    ctx: RunContext,
    client: JsonRpcClient,
    eventMapper: CodexAppServerEventMapper,
    push: (ev: NormalizedRuntimeEvent | null) => void,
    developerMode: boolean,
    rawParams: unknown,
  ): Promise<unknown> {
    const decision = ctx.permission.requestApproval(approvalReq);
    const serverRequestId = (approvalReq.providerContext as { serverRequestId?: string | number } | undefined)?.serverRequestId;
    const method = (approvalReq.providerContext as { method?: string } | undefined)?.method ?? "approval-server-request";
    const itemId = (rawParams as { itemId?: string })?.itemId;
    // 任务3: 记录本地 approval response 快照，serverRequest/resolved 回填时用
    const recordBookkeeping = (wireDecision: "accept" | "acceptForSession" | "decline" | "cancel"): void => {
      if (serverRequestId === undefined) return;
      this.serverRequestBookkeeping.set(serverRequestId, {
        requestId: approvalReq.requestId,
        itemId,
        decision: wireDecision,
        method,
      });
    };
    // 通知 UI（无论是否 pending）
    push({
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
      sourceRef: {
        threadId: (rawParams as { threadId?: string })?.threadId,
        turnId: (rawParams as { turnId?: string })?.turnId,
        itemId,
        serverRequestId,
        method,
        sequence: this.directSourceRefSequence++,
      },
      rawProviderEvent: developerMode ? { method: "approval-server-request", params: rawParams } : undefined,
      payload: {
        kind: "approval_request",
        requestId: approvalReq.requestId,
        toolName: approvalReq.toolName,
        description: approvalReq.description,
        riskLevel: approvalReq.riskLevel,
        riskReason: approvalReq.riskReason,
        inputSummary: approvalReq.inputSummary,
        mergeKey: approvalReq.mergeKey,
      },
    });

    if (decision === "auto-allow") {
      push(eventMapper.mapApprovalResolved(approvalReq.requestId, "allow", "mode"));
      recordBookkeeping("accept");
      return Promise.resolve(this.approvalMapper.mapServerRequestResult({ type: "accept" }));
    }
    if (decision === "auto-deny") {
      push(eventMapper.mapApprovalResolved(approvalReq.requestId, "deny", "mode"));
      recordBookkeeping("decline");
      return Promise.resolve(this.approvalMapper.mapServerRequestResult({ type: "decline" }));
    }
    // pending：异步等待 UI 决策
    return ctx.permission.waitForApproval(approvalReq.requestId).then(
      (result) => {
        push(eventMapper.mapApprovalResolved(approvalReq.requestId,
          result.response.type === "accept" ? "allow"
            : result.response.type === "acceptForSession" ? "allowSession"
            : "deny",
          result.source));
        const wireDecision = result.response.type === "accept" ? "accept"
          : result.response.type === "acceptForSession" ? "acceptForSession"
          : result.response.type === "cancel" ? "cancel"
          : "decline";
        recordBookkeeping(wireDecision);
        return this.approvalMapper.mapServerRequestResult(result.response);
      },
      () => {
        // cancelAllPending：返回 deny（server 协议无 cancel outcome）
        push(eventMapper.mapApprovalResolved(approvalReq.requestId, "deny", "mode"));
        recordBookkeeping("decline");
        return this.approvalMapper.mapServerRequestResult({ type: "decline" });
      },
    );
  }

  private handleUserInputRequest(
    inputReq: import("../../core/types").UserInputRequest,
    ctx: RunContext,
    push: (ev: NormalizedRuntimeEvent | null) => void,
    developerMode: boolean,
    rawParams: unknown,
  ): Promise<unknown> {
    ctx.userInput.requestInput(inputReq);
    push({
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
      sourceRef: {
        threadId: (rawParams as { threadId?: string })?.threadId,
        turnId: (rawParams as { turnId?: string })?.turnId,
        itemId: (rawParams as { itemId?: string })?.itemId,
        serverRequestId: (inputReq.providerContext as { serverRequestId?: string | number } | undefined)?.serverRequestId,
        method: "item/tool/requestUserInput",
        sequence: this.directSourceRefSequence++,
      },
      rawProviderEvent: developerMode ? { method: "user-input-server-request", params: rawParams } : undefined,
      payload: {
        kind: "user_input_request",
        requestId: inputReq.requestId,
        toolName: inputReq.toolName,
        prompt: inputReq.prompt,
        inputType: inputReq.inputType,
        questions: inputReq.questions,
        placeholder: inputReq.placeholder,
      },
    });

    return ctx.userInput.waitForInput(inputReq.requestId).then((result) => {
      push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        sourceRef: {
          serverRequestId: (inputReq.providerContext as { serverRequestId?: string | number } | undefined)?.serverRequestId,
          method: "user-input-resolved",
          sequence: this.directSourceRefSequence++,
        },
        rawProviderEvent: developerMode ? { method: "user-input-resolved", requestId: inputReq.requestId, response: result.response } : undefined,
        payload: {
          kind: "user_input_resolved",
          requestId: inputReq.requestId,
          response: result.response,
          source: result.source,
        },
      });
      return this.userInputMapper.mapServerRequestResult(result.response);
    });
  }

  /**
   * 暴露 ApprovalMapper（测试用）。
   */
  getApprovalMapper(): CodexAppServerApprovalMapper {
    return this.approvalMapper;
  }

  /**
   * 暴露 SessionMapper（测试用）。
   */
  getSessionMapper(): CodexAppServerSessionMapper {
    return this.sessionMapper;
  }

  /**
   * V2.17-A Completion: 从持久化的 providerThreadId/providerSessionId 回填 sessionMapper。
   *
   * keepLastSession 恢复时由 BridgeSessionImpl 调用，使后续 resume() 能在 sessionMapper
   * 命中 thread/resume 路径，而不是退化为新 thread。
   *
   * 仅在 threadId 非空且 sessionMapper 尚无该 bridgeSessionId 映射时注册，
   * 避免覆盖正在运行的真实映射。
   */
  restoreProviderSession(bridgeSessionId: string, providerThreadId?: string, providerSessionId?: string): void {
    if (!providerThreadId) return;
    if (this.sessionMapper.hasCodexThread(bridgeSessionId)) return;
    this.sessionMapper.register(bridgeSessionId, providerThreadId, providerSessionId);
  }

  // ---------- 进程/客户端工厂（注入缝） ----------

  /**
   * 创建 codex app-server 子进程管理器。
   *
   * 抽象为 protected 方法以便 provider-level 测试注入 fake AppServerProcessLike
   * （fake 进程 + 真实 JsonRpcClient 驱动 run()/resume() 全路径）。
   * 生产路径返回真实 AppServerProcessManager。
   */
  protected createProcess(options: AppServerSpawnOptions): AppServerProcessLike {
    return new AppServerProcessManager(options);
  }

  /**
   * 创建 JsonRpcClient，绑定到给定进程的 stdio。
   *
   * 抽象为 protected 方法以便 provider-level 测试复用真实 JsonRpcClient
   * （wire 解析/路由/请求-响应配对逻辑不 mock，只 mock 进程 stdio）。
   */
  protected createClient(process: AppServerProcessLike): JsonRpcClient {
    return new JsonRpcClient(
      (line) => process.writeLine(line),
      (handler) => process.onStdoutLine(handler),
    );
  }
}

export function buildResumeTurnInput(
  input: readonly CodexTurnInputItem[] | undefined,
  bridgeSystemAppend: string | undefined,
): CodexTurnInputItem[] {
  const items = Array.isArray(input) ? input.slice() : [];
  const context = buildCompactResumeRuntimeContext(bridgeSystemAppend);
  if (!context) return items;
  return [
    {
      type: "text",
      text: context,
    },
    ...items,
  ];
}

export function buildCompactResumeRuntimeContext(bridgeSystemAppend: string | undefined): string {
  const capabilityLines = extractRuntimeSkillCapabilityLines(bridgeSystemAppend || "");
  if (capabilityLines.length === 0) return "";
  const compactLines = limitRuntimeCapabilityLines(capabilityLines, 52, 4200);
  return [
    "Available managed Codex plugins for this resumed turn (compact):",
    "Bridge Plugin Skills are resolved through Codex native Skill discovery, not through this prompt preamble.",
    ...compactLines,
  ].join("\n");
}

function extractRuntimeSkillCapabilityLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.includes("Runtime Skills / Plugins")
      || trimmed.includes("Bridge/Vault Agent Skills and managed runtime plugins")
      || trimmed === "Managed Codex plugins:"
      || trimmed === "Plugin-contained Skills:"
      || trimmed === "Vault Agent Skills:"
      || trimmed === "Bridge/Vault Agent Skills:";
  });
  if (start < 0) return [];

  const result: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const rawLine = lines[i] || "";
    const trimmed = rawLine.trim();
    if (i > start && (
      trimmed.startsWith("==========")
      || trimmed.startsWith("- Host approval")
      || trimmed.startsWith("- Agent workspace:")
      || trimmed.startsWith("- Vault Skill source:")
      || trimmed.startsWith("- Runtime Skill target:")
      || trimmed.startsWith("- Runtime facts:")
    )) {
      break;
    }
    if (!trimmed || trimmed.startsWith("Evidence:") || trimmed.startsWith("Instructions summary:")) {
      continue;
    }
    result.push(trimCapabilityLine(rawLine));
  }
  return result;
}

function limitRuntimeCapabilityLines(lines: readonly string[], maxLines: number, maxChars: number): string[] {
  const result: string[] = [];
  let chars = 0;
  for (const line of lines) {
    const nextChars = chars + line.length + 1;
    if (result.length >= maxLines || nextChars > maxChars) {
      result.push(`- ... ${Math.max(0, lines.length - result.length)} more capability line(s) omitted for compact resume context.`);
      break;
    }
    result.push(line);
    chars = nextChars;
  }
  return result;
}

function trimCapabilityLine(line: string): string {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 225).trim()}...[truncated]`;
}

/**
 * V17-F0 任务 B：向后兼容别名 — 旧名 CodexAppServerProvider 仍可使用。
 *
 * 新代码应使用 CodexExternalAppServerProvider 以明确语义。
 */
export const CodexAppServerProvider = CodexExternalAppServerProvider;
