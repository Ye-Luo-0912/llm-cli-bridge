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
  NativeSessionRef,
} from "../../core/types";
import { CodexAppServerEventMapper } from "./codexAppServerEventMapper";
import { CodexAppServerApprovalMapper } from "./codexAppServerApprovalMapper";
import { CodexAppServerUserInputMapper } from "./codexAppServerUserInputMapper";
import { CodexAppServerSessionMapper } from "./codexAppServerSessionMapper";
import {
  buildCodexAppServerEffectiveRunPlan,
  buildCodexAppServerRunOptions,
  type CodexAppServerRunOptions,
} from "./codexAppServerEffectiveRunPlan";
import { AppServerProcessManager, type AppServerProcessLike, type AppServerSpawnOptions } from "./appServerProcessManager";
import { JsonRpcClient } from "./jsonRpcClient";
import { buildRuntimeEnv } from "../../config/runtimeRouter";
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
  CodexThreadTokenUsageUpdatedParams,
  ThreadCompactStartResponse,
  ReviewStartParams,
  ReviewStartResponse,
  SkillsListParams,
  SkillsListResponse,
  PermissionProfileListParams,
  PermissionProfileListResponse,
  ThreadForkParams,
  ThreadForkResponse,
  TurnSteerResponse,
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
 * V20.3: app-server 分阶段超时（毫秒）。
 *
 * 替代之前"只等 90 秒总超时"的粗粒度设计。每个 JSON-RPC 阶段独立超时，
 * 错误信息明确指出卡在哪一步，便于用户诊断（网络/认证/runtime 启动慢等）。
 *
 * 取值依据：本地 runtime 各阶段通常 <3s；中转站 + 网络延迟可能 5-10s；
 * 留出充足余量到 8-15s，避免慢机器误判。
 */
export const CODEX_APP_SERVER_STAGE_TIMEOUTS = {
  /** process spawn：等待子进程启动并就绪（stdout 可读） */
  spawn: 15_000,
  /** initialize handshake：客户端→服务端首次握手 */
  initialize: 12_000,
  /** model/list：查询 runtime 支持的模型目录 */
  modelList: 10_000,
  /** thread/start：创建新会话线程 */
  threadStart: 12_000,
  /** turn/start：提交本轮用户输入 */
  turnStart: 15_000,
  /**
   * Round 4: turn/interrupt（cancel() 优雅取消）。超时后 cancel() 兜底强杀进程
   * （见 cancel() 内的 setTimeout(hardKill, ...)）；此值需明显小于用户等待耐心，
   * 优雅取消失败时才不会让用户等太久看到"取消"生效。
   */
  turnInterrupt: 3_000,
  /**
   * Round 4: 辅助 RPC（thread/compact/start、review/start、skills/list、
   * permissionProfile/list、thread/fork）的统一超时——非主 run 路径，容忍稍慢。
   */
  auxRpc: 10_000,
} as const;

/** V20.3: 分阶段超时错误，明确指出卡在哪一步 */
export class CodexAppServerStageTimeoutError extends Error {
  readonly stage: string;
  readonly stageTimeoutMs: number;
  constructor(stage: string, timeoutMs: number, cause?: unknown) {
    super(`codex app-server 卡在「${stage}」阶段（${timeoutMs}ms 超时）${cause instanceof Error ? `：${cause.message}` : ""}`);
    this.name = "CodexAppServerStageTimeoutError";
    this.stage = stage;
    this.stageTimeoutMs = timeoutMs;
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
 * 普通用户主线由 CodexManagedAppServerProvider 复用本实现并注入受管 runtime。
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
  /** Round 4: 当前活动 threadId（cancel() 发 turn/interrupt 用） */
  private currentThreadId: string | null = null;
  /** Round 4: 当前活动 turnId（cancel() 发 turn/interrupt 用） */
  private currentTurnId: string | null = null;
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
  /** V20.10: skills 缓存（skills/changed 通知时自动刷新） */
  private cachedSkills: SkillsListResponse | null = null;
  /** V20.10: permissionProfile 缓存（首次 getCachedPermissionProfiles 时拉取） */
  private cachedPermissionProfiles: PermissionProfileListResponse | null = null;

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
   * V20.5: Bridge 不再构建 relay provider 参数——relay 配置由 Codex config.toml 管理。
   */
  protected getAppServerArgs(): string[] {
    return this.appServerArgs;
  }

  /**
   * V20: 构建自定义 provider 的 `-c key=value` 配置覆盖参数。
   * V20.5: 已废弃——relay 配置由 Codex config.toml 管理，Bridge 不再注入。
   * @deprecated V20.5
   */
  private buildRelayProviderArgs(baseArgs: string[], relayUrl: string): string[] {
    const baseUrl = relayUrl.replace(/\/+$/, "") + "/v1";
    return [
      ...baseArgs,
      "-c", `model_provider=llm_bridge_relay`,
      "-c", `model_providers.llm_bridge_relay.base_url=${baseUrl}`,
      "-c", `model_providers.llm_bridge_relay.env_key=LLM_BRIDGE_RELAY_API_KEY`,
      "-c", `model_providers.llm_bridge_relay.wire_api=responses`,
      "-c", `model_providers.llm_bridge_relay.requires_openai_auth=false`,
    ];
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
   * 通过统一 runtime router 注入 CODEX_HOME（本地配置存在时）+ CODEX_RELAY_API_KEY。
   * Bridge 不再解析 Codex config.toml 内容——Codex 自己读取配置。
   */
  private buildSpawnEnv(cwd: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    try {
      const extraPath = buildEnhancedPath(cwd);
      if (extraPath) {
        env.PATH = extraPath + (process.platform === "win32" ? ";" : ":") + (env.PATH || "");
      }
    } catch { /* fallthrough: enhanced PATH 不可用时退回 process.env */ }

    // V20.5: 注入 CODEX_HOME（本地配置存在时）+ CODEX_RELAY_API_KEY
    try {
      const runtimeEnv = buildRuntimeEnv(cwd, "codex");
      Object.assign(env, runtimeEnv);
    } catch { /* fallthrough: runtime env 不可用时退回 process.env */ }

    return env;
  }

  buildPlan(input: RunInput, settings: LLMBridgeSettings): EffectiveRunPlan {
    return buildCodexAppServerEffectiveRunPlan(input, settings);
  }

  async *run(ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    const developerMode = !!settings.developerMode;
    // 每个 run 用独立 eventMapper，保证 rawProviderEvent 正确填充
    const eventMapper = new CodexAppServerEventMapper(this.providerId, developerMode);

    // 派生 codex 运行参数（V20.11: personality/summary 由 config.toml 单一真相源提供）
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
      // spawn 失败（如 ENOENT）：AppServerProcessManager 把 child 'error' 事件作为 `[spawn error]` stderr 行暴露。
      // 若 'exit' 未可靠触发，事件流将无终态信号，调用方只能等 watchdog 超时。这里立即补 failed 终态并结束流。
      if (!done && line.startsWith("[spawn error]")) {
        push({
          providerId: this.providerId,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "failed",
            message: `codex app-server spawn error: ${line.slice("[spawn error]".length).trim()}`,
            recoverable: false,
          },
        });
        signalDone();
      }
    }));

    try {
      // P5: currentRunId 在 try 内赋值，确保 setup 阶段抛错时不泄漏（finally 会清理）
      this.currentRunId = ctx.runId;
      // 任务2: 每轮 turn 开始前清理上一轮的 approval bookkeeping，防止跨轮累积
      this.serverRequestBookkeeping.clear();

      // V20.3: process spawn ready — 等待子进程就绪（stdout 可读或 spawn error）
      // 若进程在超时窗口内既无 stdout 也无 stderr，视为 spawn 卡住。
      await this.waitForProcessSpawnReady(process, CODEX_APP_SERVER_STAGE_TIMEOUTS.spawn);

      // 1. initialize handshake（官方 shape：clientInfo + capabilities；不再用 clientName/clientVersion）
      //    experimentalApi 默认 false；options.initialize 已由 buildCodexAppServerRunOptions 构造。
      //    V20.3: 分阶段超时，不再只等 90 秒总超时。
      let initResult: CodexInitializeResult;
      try {
        initResult = await client.send<CodexInitializeResult>(
          "initialize", options.initialize, CODEX_APP_SERVER_STAGE_TIMEOUTS.initialize,
        );
      } catch (err) {
        throw new CodexAppServerStageTimeoutError("initialize", CODEX_APP_SERVER_STAGE_TIMEOUTS.initialize, err);
      }
      push(eventMapper.mapInitialized(initResult));

      // notify initialized（handshake 完成）
      client.notify("initialized");
      const initialSkillsPromise = this.discoverInitialSkills(client, eventMapper, push);
      this.warmPermissionProfileCache(client).catch(() => { /* 权限缓存失败不阻断主流程 */ });

      // 2. thread/start（新 thread；resume 路径走 thread/resume，不再塞 resumeSessionId）
      //    response result shape: { thread: { id, sessionId? } }
      //    Round 1 wire：剥离 config/instructions；不发送 baseInstructions（保留 runtime 原生 base）；
      //    发送 developerInstructions（薄 Obsidian 约定）。
      //    V20.3: 分阶段超时。
      const {
        config: _wireDropConfig,
        baseInstructions: _wireDropBase,
        ...threadStartWire
      } = options.threadStart;
      // 防御：即便上游误设 baseInstructions，也绝不发到 wire
      delete (threadStartWire as { baseInstructions?: string }).baseInstructions;
      let threadResult: CodexThreadStartResult;
      try {
        threadResult = await client.send<CodexThreadStartResult>(
          "thread/start", threadStartWire, CODEX_APP_SERVER_STAGE_TIMEOUTS.threadStart,
        );
      } catch (err) {
        throw new CodexAppServerStageTimeoutError("thread/start", CODEX_APP_SERVER_STAGE_TIMEOUTS.threadStart, err);
      }
      const threadId = threadResult.thread.id;
      const sessionId = threadResult.thread.sessionId;
      this.currentThreadId = threadId;
      // V2.17-A Completion: 同时注册 runId 和 bridgeSessionId（若提供），供 resume 按 bridgeSessionId 查找。
      this.sessionMapper.register(ctx.runId, threadId, sessionId);
      if (ctx.bridgeSessionId && ctx.bridgeSessionId !== ctx.runId) {
        this.sessionMapper.register(ctx.bridgeSessionId, threadId, sessionId);
      }
      push(eventMapper.mapThreadStarted(threadId, sessionId));
      // latest native session only: 发 native_session_bound 让 UI 绑定 activeNativeSessionRef
      push(eventMapper.mapNativeSessionBound(this.providerId, threadId, sessionId));
      // 首次连接必须完成一次 skills/list；与 thread/start 并行，减少首轮等待。
      await initialSkillsPromise;

      // 3. 普通消息走 turn/start；审查/压缩/分叉走同一连接上的原生 RPC。
      //    这些动作复用事件 handler、审批边界和历史收尾，不再依赖 run 结束即失效的 stub。
      turnSubmitted = true;
      try {
        this.currentTurnId = await this.submitTurnOrNativeAction(
          client, threadId, options, ctx, eventMapper, push, signalDone,
        );
      } catch (err) {
        const stage = ctx.nativeAction ? this.nativeActionMethod(ctx.nativeAction.kind) : "turn/start";
        throw new CodexAppServerStageTimeoutError(stage, CODEX_APP_SERVER_STAGE_TIMEOUTS.turnStart, err);
      }

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
      this.currentThreadId = null;
      this.currentTurnId = null;
      // 任务2: 正常完成/异常时立即清理 approval bookkeeping，避免残留审批状态
      this.serverRequestBookkeeping.clear();
    }
  }

  /**
   * Round 4: 取消当前 run。
   *
   * 接口要求同步返回（RuntimeProvider.cancel 签名为 void），故优雅取消走后台异步：
   * 1. 若已知 threadId/turnId，先发 `turn/interrupt`（带超时）——让 runtime 有机会正常收尾
   *    （通常会推送 turn/completed，run() 主循环的 finally 会自行清理 process/client）。
   * 2. 无论 turn/interrupt 成功/失败/超时，都调度一次兜底强杀（延迟 = 超时 + 缓冲）；
   *    若 turn/interrupt 已让 run() 的 finally 跑完（currentRunId 已被清空），兜底强杀是 no-op。
   * 3. 无法确定 threadId/turnId（尚未收到 thread/start 或 turn/start 响应）时，直接走原有硬杀路径。
   */
  cancel(runId: string): void {
    // 仅取消匹配 currentRunId 的活动 run，防止迟到的 cancel 误杀无关 run
    if (runId !== this.currentRunId) return;

    const hardKill = () => {
      // run() 的 finally 可能已经跑过（turn/interrupt 触发了 turn/completed）；
      // 此时 currentRunId 已被清空，这里应是 no-op，避免误杀后续新 run。
      if (this.currentRunId !== runId) return;
      if (this.currentClient) {
        try { this.currentClient.close(); } catch { /* swallow */ }
      }
      if (this.currentProcess) {
        try { this.currentProcess.kill(); } catch { /* swallow */ }
      }
      this.currentProcess = null;
      this.currentClient = null;
      this.currentRunId = null;
      this.currentThreadId = null;
      this.currentTurnId = null;
      // 任务2: cancel 后立即清理 approval bookkeeping，避免残留审批状态
      this.serverRequestBookkeeping.clear();
    };

    const client = this.currentClient;
    const threadId = this.currentThreadId;
    const turnId = this.currentTurnId;
    if (client && !client.isClosed() && threadId && turnId) {
      const timeoutMs = CODEX_APP_SERVER_STAGE_TIMEOUTS.turnInterrupt;
      // fire-and-forget：turn/interrupt 失败/超时不影响下面调度的兜底强杀。
      void client.send("turn/interrupt", { threadId, turnId }, timeoutMs).catch(() => { /* 兜底强杀会处理 */ });
      setTimeout(hardKill, timeoutMs + 500);
    } else {
      // 尚未拿到 threadId/turnId（早期取消）：无法发 turn/interrupt，直接硬杀。
      hardKill();
    }
  }

  async *resume(ref: NativeSessionRef, ctx: RunContext, settings: LLMBridgeSettings): AsyncIterable<NormalizedRuntimeEvent> {
    // latest native session only: 直接使用 ref.threadId 进行 thread/resume。
    // 如果 ref 无 threadId（非 codex ref），退化为 thread/start。
    const codexThread = ref.threadId;
    if (!codexThread) {
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
      // spawn 失败（如 ENOENT）：与 run() 一致，立即补 failed 终态并结束流，避免等 watchdog 超时
      if (!done && line.startsWith("[spawn error]")) {
        push({
          providerId: this.providerId,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "failed",
            message: `codex app-server spawn error: ${line.slice("[spawn error]".length).trim()}`,
            recoverable: false,
          },
        });
        signalDone();
      }
    }));

    try {
      // P5: currentRunId 在 try 内赋值，确保 setup 阶段抛错时不泄漏（finally 会清理）
      this.currentRunId = ctx.runId;
      // 任务2: 每轮 turn 开始前清理上一轮的 approval bookkeeping，防止跨轮累积
      this.serverRequestBookkeeping.clear();

      // V20.3: process spawn ready — 等待子进程就绪
      await this.waitForProcessSpawnReady(process, CODEX_APP_SERVER_STAGE_TIMEOUTS.spawn);

      // 1. initialize handshake（与 run 一致；clientInfo + capabilities）
      //    V20.3: 分阶段超时
      let initResult: CodexInitializeResult;
      try {
        initResult = await client.send<CodexInitializeResult>(
          "initialize", options.initialize, CODEX_APP_SERVER_STAGE_TIMEOUTS.initialize,
        );
      } catch (err) {
        throw new CodexAppServerStageTimeoutError("initialize", CODEX_APP_SERVER_STAGE_TIMEOUTS.initialize, err);
      }
      push(eventMapper.mapInitialized(initResult));
      client.notify("initialized");
      const initialSkillsPromise = this.discoverInitialSkills(client, eventMapper, push);
      this.warmPermissionProfileCache(client).catch(() => { /* 权限缓存失败不阻断主流程 */ });

      // 2. thread/resume（恢复已有 threadId；失败时 fallback 到 thread/start）
      // latest native session only: native session 可能在 provider 侧已失效
      // （app-server 重启/thread 过期清理），此时 thread/resume 报错。
      // 容错：捕获错误，fallback 到 thread/start 新开 native session，
      // 让用户继续工作而非硬中断。
      // V20.3: 分阶段超时（复用 threadStart 超时）
      let resumedThreadId: string;
      let resumedSessionId: string | undefined;
      try {
        const resumeResult = await client.send<CodexThreadResumeResult>(
          "thread/resume",
          {
            threadId: codexThread,
            config: options.threadStart.config,
            cwd: ctx.plan.cwd,
            // Round 1：resume 走 developer 层；不传 baseInstructions
            developerInstructions: options.threadStart.developerInstructions,
            approvalPolicy: options.threadStart.approvalPolicy,
            approvalsReviewer: options.threadStart.approvalsReviewer,
            sandbox: options.threadStart.sandbox,
          },
          CODEX_APP_SERVER_STAGE_TIMEOUTS.threadStart,
        );
        resumedThreadId = resumeResult.thread.id;
        resumedSessionId = resumeResult.thread.sessionId;
        this.currentThreadId = resumedThreadId;
        // 同步更新 sessionMapper（runId + bridgeSessionId）
        this.sessionMapper.register(ctx.runId, resumedThreadId, resumedSessionId);
        if (ctx.bridgeSessionId && ctx.bridgeSessionId !== ctx.runId) {
          this.sessionMapper.register(ctx.bridgeSessionId, resumedThreadId, resumedSessionId);
        }
        push(eventMapper.mapThreadResumed(resumedThreadId, resumedSessionId));
      } catch (resumeErr) {
        // thread/resume 失败（no rollout found / thread expired / server restarted）
        // → 清理当前 process/client，fallback 到 run() 新开 native session
        for (const u of unreg) {
          try { u(); } catch { /* swallow */ }
        }
        try { client.close(); } catch { /* swallow */ }
        try { process.kill(); } catch { /* swallow */ }
        this.currentProcess = null;
        this.currentClient = null;
        this.currentThreadId = null;
        this.currentTurnId = null;
        // 提示用户：原 native session 失效，已新开
        yield {
          providerId: this.providerId,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "message",
            role: "system",
            text: `原 native session ${codexThread} 已失效（thread/resume 失败: ${(resumeErr as Error).message}），已新开 session。LLM 不会记得之前的对话内容。`,
          },
        };
        // 委托 run() 走完整 thread/start 路径（会自己创建 process/client/handlers）
        yield* this.run(ctx, settings);
        return;
      }
      push(eventMapper.mapNativeSessionBound(this.providerId, resumedThreadId, resumedSessionId));
      await initialSkillsPromise;

      // 3. 普通消息走 turn/start；原生动作复用当前 resumed thread。
      turnSubmitted = true;
      try {
        this.currentTurnId = await this.submitTurnOrNativeAction(
          client, resumedThreadId, options, ctx, eventMapper, push, signalDone,
        );
      } catch (err) {
        const stage = ctx.nativeAction ? this.nativeActionMethod(ctx.nativeAction.kind) : "turn/start";
        throw new CodexAppServerStageTimeoutError(stage, CODEX_APP_SERVER_STAGE_TIMEOUTS.turnStart, err);
      }

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
      // fallback 路径可能已关闭 client/process，用 try 包裹防止重复关闭报错
      try { client.close(); } catch { /* swallow */ }
      try { process.kill(); } catch { /* swallow */ }
      this.currentProcess = null;
      this.currentClient = null;
      this.currentRunId = null;
      this.currentThreadId = null;
      this.currentTurnId = null;
      // 任务2: 正常完成/异常时立即清理 approval bookkeeping，避免残留审批状态
      this.serverRequestBookkeeping.clear();
    }
  }

  // ---------- 内部 ----------

  private nativeActionMethod(kind: NonNullable<RunContext["nativeAction"]>["kind"]): string {
    if (kind === "review") return "review/start";
    if (kind === "compact") return "thread/compact/start";
    return "thread/fork";
  }

  /**
   * 在已经 initialize + thread/start|resume 的连接上提交普通 turn 或原生会话动作。
   * 返回活动 turnId；压缩/分叉没有活动 turn，返回 null。
   */
  private async submitTurnOrNativeAction(
    client: JsonRpcClient,
    threadId: string,
    options: CodexAppServerRunOptions,
    ctx: RunContext,
    eventMapper: CodexAppServerEventMapper,
    push: (ev: NormalizedRuntimeEvent | null) => void,
    signalDone: () => void,
  ): Promise<string | null> {
    const action = ctx.nativeAction;
    if (!action) {
      const result = await client.send<{ turn?: { id?: string } }>("turn/start", {
        ...options.turnStart,
        threadId,
      }, CODEX_APP_SERVER_STAGE_TIMEOUTS.turnStart);
      return result?.turn?.id ?? null;
    }

    if (action.kind === "review") {
      const result = await client.send<"review/start", ReviewStartResponse>("review/start", {
        threadId,
        target: action.target,
        delivery: action.delivery ?? "inline",
      } satisfies ReviewStartParams, CODEX_APP_SERVER_STAGE_TIMEOUTS.turnStart);
      if (result.reviewThreadId && result.reviewThreadId !== threadId) {
        this.currentThreadId = result.reviewThreadId;
        push(eventMapper.mapNativeSessionBound(this.providerId, result.reviewThreadId));
      }
      return result.turn?.id ?? null;
    }

    if (action.kind === "compact") {
      await client.send<"thread/compact/start", ThreadCompactStartResponse>(
        "thread/compact/start",
        { threadId },
        CODEX_APP_SERVER_STAGE_TIMEOUTS.turnStart,
      );
      // ContextCompaction item（新）或 thread/compacted 通知（兼容）会结束生成器。
      return null;
    }

    const result = await client.send<"thread/fork", ThreadForkResponse>("thread/fork", {
      threadId,
      lastTurnId: action.lastTurnId ?? null,
    } satisfies ThreadForkParams, CODEX_APP_SERVER_STAGE_TIMEOUTS.turnStart);
    const forkedThreadId = result.thread.id;
    const forkedSessionId = result.thread.sessionId;
    this.currentThreadId = forkedThreadId;
    this.sessionMapper.register(ctx.bridgeSessionId ?? ctx.runId, forkedThreadId, forkedSessionId);
    push(eventMapper.mapNativeSessionBound(this.providerId, forkedThreadId, forkedSessionId));
    push({
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
      payload: { kind: "message", role: "assistant", text: "已创建当前会话的独立分支。" },
    });
    push({
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
      payload: { kind: "completed", text: "已创建当前会话的独立分支。", sessionId: forkedSessionId },
    });
    signalDone();
    return null;
  }

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
    let nativeCompactionCompleted = false;
    const finishNativeCompaction = (): void => {
      if (ctx.nativeAction?.kind !== "compact" || nativeCompactionCompleted) return;
      nativeCompactionCompleted = true;
      push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "message", role: "assistant", text: "上下文已压缩。" },
      });
      push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        payload: { kind: "completed", text: "上下文已压缩。" },
      });
      signalDone();
    };

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

    // item/completed（官方 nested params.item；fileChange/reasoning 多段在此展开）
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
      // reasoning item：每个 summary/content part 一条 snapshot 事件
      // （按 itemId + summaryIndex 替换全部实时 delta 片段，官方协议最终权威快照）
      if (item?.type === "reasoning") {
        for (const ev of eventMapper.mapItemCompletedReasoningSnapshots(completedParams)) {
          push(ev);
        }
        return;
      }
      push(eventMapper.mapItemCompleted(completedParams));
      // 新协议以 ContextCompaction item 作为权威结果；旧 thread/compacted 通知仅作兼容。
      if (item?.type === "contextCompaction") finishNativeCompaction();
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
    // 上下文占用：不进 timeline，仅驱动 UI ring
    unreg.push(client.onNotification("thread/tokenUsage/updated", (params) => {
      push(eventMapper.mapThreadTokenUsageUpdated(params as CodexThreadTokenUsageUpdatedParams));
    }));

    // Round 4：新增官方通知（映射到既有 thinking/progress/message/system NormalizedRuntimeEvent kind）
    unreg.push(client.onNotification("item/reasoning/summaryPartAdded", (params) => {
      push(eventMapper.mapItemReasoningSummaryPartAdded(params));
    }));
    unreg.push(client.onNotification("turn/plan/updated", (params) => {
      push(eventMapper.mapTurnPlanUpdated(params));
    }));
    unreg.push(client.onNotification("thread/compacted", (params) => {
      push(eventMapper.mapThreadCompacted(params));
      finishNativeCompaction();
    }));
    unreg.push(client.onNotification("model/rerouted", (params) => {
      push(eventMapper.mapModelRerouted(params));
    }));
    unreg.push(client.onNotification("model/verification", (params) => {
      push(eventMapper.mapModelVerification(params));
    }));
    unreg.push(client.onNotification("warning", (params) => {
      push(eventMapper.mapWarning(params));
    }));
    unreg.push(client.onNotification("configWarning", (params) => {
      push(eventMapper.mapConfigWarning(params));
    }));
    unreg.push(client.onNotification("skills/changed", () => {
      // V20.12: 先刷新缓存，完成后再发 skillsChanged 事件触发 UI 读取最新数据
      this.refreshCachedSkills(client)
        .then(() => { push(eventMapper.mapSkillsChanged()); })
        .catch(() => { push(eventMapper.mapSkillsChanged()); /* 缓存失败也通知 UI 刷新 */ });
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

  // ---------- 运行期 RPC ----------

  private requireActiveClient(action: string): JsonRpcClient {
    if (!this.currentClient || this.currentClient.isClosed()) {
      throw new Error(`Codex app-server: 没有活动 run，无法执行 ${action}`);
    }
    return this.currentClient;
  }

  /** turn/steer：向当前活动 turn 追加文本指令。 */
  async steerCurrentTurn(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("追加指令不能为空");
    const client = this.requireActiveClient("turn/steer");
    const threadId = this.currentThreadId;
    const turnId = this.currentTurnId;
    if (!threadId || !turnId) {
      throw new Error("Codex app-server: 当前 turn 尚未就绪，无法追加指令");
    }
    await client.send<"turn/steer", TurnSteerResponse>("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: trimmed, text_elements: [] }],
    }, CODEX_APP_SERVER_STAGE_TIMEOUTS.auxRpc);
  }

  /** skills/list：探测本地可用 skills（用于 capability snapshot / skills UI）。 */
  async listSkills(params: SkillsListParams = {}): Promise<SkillsListResponse> {
    const client = this.requireActiveClient("skills/list");
    return client.send<"skills/list", SkillsListResponse>(
      "skills/list",
      params,
      CODEX_APP_SERVER_STAGE_TIMEOUTS.auxRpc,
    );
  }

  /**
   * V20.10: 刷新 skills 缓存（skills/changed 通知触发）。
   * 静默失败：client 不可用或 RPC 超时时不影响主流程。
   */
  private async refreshCachedSkills(
    client: JsonRpcClient,
    timeoutMs: number = CODEX_APP_SERVER_STAGE_TIMEOUTS.auxRpc,
  ): Promise<void> {
    try {
      const resp = await client.send<"skills/list", SkillsListResponse>(
        "skills/list",
        {},
        timeoutMs,
      );
      this.cachedSkills = resp;
    } catch {
      // 静默失败
    }
  }

  /** initialize/initialized 之后完成首次 Skills 发现；内部刷新事件不进入聊天过程。 */
  private async discoverInitialSkills(
    client: JsonRpcClient,
    eventMapper: CodexAppServerEventMapper,
    push: (ev: NormalizedRuntimeEvent | null) => void,
  ): Promise<void> {
    if (this.cachedSkills) return;
    await this.refreshCachedSkills(client, 3_000);
    if (this.cachedSkills) push(eventMapper.mapSkillsChanged());
  }

  /**
   * V20.10: 获取缓存的 skills 列表（由 skills/changed 自动刷新）。
   * UI 可调用此方法读取最近一次 skills/list 结果，无需主动拉取。
   * 返回 null 表示尚无缓存（首次运行前或 RPC 不可用）。
   */
  getCachedSkills(): SkillsListResponse | null {
    return this.cachedSkills;
  }

  /** permissionProfile/list：供 approval 菜单展示可选权限档案。 */
  async listPermissionProfiles(
    params: PermissionProfileListParams = {},
  ): Promise<PermissionProfileListResponse> {
    const client = this.requireActiveClient("permissionProfile/list");
    return client.send<"permissionProfile/list", PermissionProfileListResponse>(
      "permissionProfile/list",
      params,
      CODEX_APP_SERVER_STAGE_TIMEOUTS.auxRpc,
    );
  }

  /**
   * V20.10: 获取缓存的 permissionProfile 列表（供权限菜单 UI 使用）。
   * 首次调用时拉取并缓存；后续直接返回缓存。
   * RPC 不可用时返回 null，UI 降级到硬编码常量。
   */
  async getCachedPermissionProfiles(): Promise<PermissionProfileListResponse | null> {
    if (this.cachedPermissionProfiles) return this.cachedPermissionProfiles;
    try {
      this.cachedPermissionProfiles = await this.listPermissionProfiles();
      return this.cachedPermissionProfiles;
    } catch {
      return null;
    }
  }

  /**
   * V20.10: 同步读取已缓存的 permissionProfile 列表（供 UI 同步渲染）。
   * 未缓存时返回 null；UI 应降级到硬编码常量。
   */
  getCachedPermissionProfilesSync(): PermissionProfileListResponse | null {
    return this.cachedPermissionProfiles;
  }

  /**
   * V20.10: 后台拉取 permissionProfile 并填充缓存（run 开始时触发）。
   * 静默失败：不影响主流程。
   */
  private async warmPermissionProfileCache(client: JsonRpcClient): Promise<void> {
    if (this.cachedPermissionProfiles) return;
    try {
      const resp = await client.send<"permissionProfile/list", PermissionProfileListResponse>(
        "permissionProfile/list",
        {},
        CODEX_APP_SERVER_STAGE_TIMEOUTS.auxRpc,
      );
      this.cachedPermissionProfiles = resp;
    } catch {
      // 静默失败
    }
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
   * latest native session only: 从持久化的 lastNativeSessionRef 回填 provider 状态。
   *
   * keepLastSession 恢复时由 BridgeSessionImpl 调用。
   * resume() 直接使用 ref.threadId，不再依赖 sessionMapper 查找，
   * 因此此方法无需注册映射（保持为 no-op，仅满足接口契约）。
   */
  restoreActiveNativeSessionRef(_ref?: NativeSessionRef): void {
    // no-op: resume() uses ref.threadId directly; sessionMapper is internal bookkeeping only
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

  /**
   * V20.3: 等待子进程 spawn 就绪。
   *
   * codex app-server 启动后不主动输出 stdout，会等待客户端发送 initialize。
   * 因此本方法不等待 stdio 活动，而是用快速就绪检测窗口（500ms）确认进程没立即退出：
   * - 进程在 500ms 内退出（spawn 失败，如 ENOENT / 权限错误）→ 立即抛 spawn 错误
   * - 500ms 后进程仍运行 → 视为 spawn 成功，进入 initialize 阶段
   *
   * timeoutMs（15s）作为本阶段的标称超时写入错误消息，便于用户诊断；
   * 实际检测窗口远小于 timeoutMs，避免正常启动被白白阻塞。
   * 真正的"卡住"由后续 initialize/threadStart/turnStart 超时守护。
   */
  protected async waitForProcessSpawnReady(
    process: AppServerProcessLike,
    timeoutMs: number,
  ): Promise<void> {
    if (!process.running) {
      throw new CodexAppServerStageTimeoutError("process spawn", timeoutMs, new Error("process exited immediately"));
    }
    // 快速就绪检测窗口：500ms 内若进程退出则报 spawn 错误
    const PROBE_MS = 500;
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const onExit = process.onExit(() => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve();
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        onExit();
        resolve();
      }, PROBE_MS);
    });
    if (!process.running) {
      throw new CodexAppServerStageTimeoutError("process spawn", timeoutMs, new Error("process exited during spawn (ENOENT or permission denied)"));
    }
  }
}

/**
 * Round 1：resume 不再把 Bridge 文案注入 turn input（developer 层由 thread/resume 恢复）。
 * 保留导出供单测锁定为 no-op。
 */
export function buildResumeTurnInput(
  input: readonly CodexTurnInputItem[] | undefined,
  _bridgeSystemAppend?: string | undefined,
): CodexTurnInputItem[] {
  return Array.isArray(input) ? input.slice() : [];
}

/** @deprecated Round 1 起不再用于 resume preamble；保留空实现供旧测试引用。 */
export function buildCompactResumeRuntimeContext(_bridgeSystemAppend: string | undefined): string {
  return "";
}

/**
 * V17-F0 任务 B：向后兼容别名 — 旧名 CodexAppServerProvider 仍可使用。
 *
 * 新代码应使用 CodexExternalAppServerProvider 以明确语义。
 */
export const CodexAppServerProvider = CodexExternalAppServerProvider;
