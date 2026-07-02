// LLM CLI Bridge — CodexAppServerProvider (V2.17-A Completion)
//
// 主目标 provider：通过 codex app-server JSON-RPC over stdio JSONL 接入 Bridge Core。
//
// V2.17-A Completion wire 协议校准：
// 1. 每个连接先 send `initialize`，收到 result 后 notify `initialized`。
// 2. initialize 后再 send `thread/start`，response result shape: { thread: { id, sessionId? } }。
// 3. send `turn/start`，input 为 content item array（[{ type:"text", text:userPrompt }, ...]）。
// 4. approval 不走 notification，而是 server-initiated request：
//    - item/commandExecution/requestApproval（带 id）
//    - item/fileChange/requestApproval（带 id）
//    client 按原 id 返回 result（{ decision: "allow"|"allowSession"|"deny" }）。
//    item/tool/requestUserInput 同为 server request，当前转 unsupported/pending。
// 5. serverRequest/resolved 通知用于 UI 同步（标记 approval 已落地）。
//
// 当前环境无 codex CLI；run() 仍可被 fixture JSONL 测试驱动（通过 EventMapper 直接测）。

import type { LLMBridgeSettings } from "../../../types";
import type {
  EffectiveRunPlan,
  NormalizedRuntimeEvent,
  RunContext,
  RunInput,
  RuntimeProvider,
} from "../../core/types";
import { CodexAppServerEventMapper } from "./codexAppServerEventMapper";
import { CodexAppServerApprovalMapper } from "./codexAppServerApprovalMapper";
import { CodexAppServerSessionMapper } from "./codexAppServerSessionMapper";
import {
  buildCodexAppServerEffectiveRunPlan,
  buildCodexAppServerRunOptions,
} from "./codexAppServerEffectiveRunPlan";
import { AppServerProcessManager } from "./appServerProcessManager";
import { JsonRpcClient } from "./jsonRpcClient";
import type {
  CodexInitializeResult,
  CodexItemArgumentDeltaParams,
  CodexItemCompletedParams,
  CodexItemStartedParams,
  CodexItemTextDeltaParams,
  CodexServerRequestResolvedParams,
  CodexThreadStartResult,
  CodexTurnCompletedParams,
  CodexTurnFailedParams,
} from "./schema";
import { execFileSync } from "child_process";

const CLIENT_NAME = "llm-cli-bridge";
const CLIENT_VERSION = "2.17-A";

/**
 * CodexAppServerProvider：通过 codex app-server JSON-RPC 接入 Bridge Core。
 *
 * 主目标 provider（V2.17-A Completion）。
 */
export class CodexAppServerProvider implements RuntimeProvider {
  readonly providerId = "codex-app-server" as const;
  readonly displayName = "Codex app-server";

  private readonly approvalMapper: CodexAppServerApprovalMapper;
  private readonly sessionMapper: CodexAppServerSessionMapper;
  /** 当前活动进程（cancel 用） */
  private currentProcess: AppServerProcessManager | null = null;
  /** 当前活动 JsonRpcClient（cancel/approval respond 用） */
  private currentClient: JsonRpcClient | null = null;
  /** 当前 runId（cancel 配对） */
  private currentRunId: string | null = null;

  constructor(_developerMode: boolean = false) {
    // developerMode 由 run() 内部根据 settings 注入；构造时无需缓存
    this.approvalMapper = new CodexAppServerApprovalMapper(this.providerId);
    this.sessionMapper = new CodexAppServerSessionMapper();
  }

  isAvailable(cwd: string): boolean {
    // 探测 codex 命令是否存在：spawn `codex --version`
    try {
      execFileSync("codex", ["--version"], {
        cwd,
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 3000,
      });
      return true;
    } catch {
      return false;
    }
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

    // 启动 codex app-server 进程
    const codexCommand = settings.codexCommand || "codex";
    const process = new AppServerProcessManager({
      command: codexCommand,
      args: ["app-server"],
      cwd: ctx.plan.cwd,
    });
    this.currentProcess = process;
    this.currentRunId = ctx.runId;

    // 构造 JsonRpcClient
    const client = new JsonRpcClient(
      (line) => process.writeLine(line),
      (handler) => process.onStdoutLine(handler),
    );
    this.currentClient = client;

    // async queue：把通知 handler 产出的 NormalizedRuntimeEvent push 给 generator
    const queue = new Array<NormalizedRuntimeEvent>();
    let resolveWait: (() => void) | null = null;
    let done = false;

    const push = (ev: NormalizedRuntimeEvent | null): void => {
      if (!ev) return;
      queue.push(ev);
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
    const unreg: Array<() => void> = [];

    unreg.push(client.onNotification("item/started", (params) => {
      push(eventMapper.mapItemStarted(params as CodexItemStartedParams));
    }));
    unreg.push(client.onNotification("item/text/delta", (params) => {
      push(eventMapper.mapItemTextDelta(params as CodexItemTextDeltaParams));
    }));
    unreg.push(client.onNotification("item/thinking/delta", (params) => {
      push(eventMapper.mapThinkingDelta(params as CodexItemTextDeltaParams));
    }));
    unreg.push(client.onNotification("item/argument/delta", (params) => {
      push(eventMapper.mapItemArgumentDelta(params as CodexItemArgumentDeltaParams));
    }));
    unreg.push(client.onNotification("item/completed", (params) => {
      push(eventMapper.mapItemCompleted(params as CodexItemCompletedParams));
    }));

    // serverRequest/resolved 通知：标记 approval 已落地（UI 同步）
    unreg.push(client.onNotification("serverRequest/resolved", (params) => {
      const resolved = params as CodexServerRequestResolvedParams;
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

    // item/tool/requestUserInput：当前转 unsupported/pending
    // 返回 cancelled，让 server 知道 client 暂不支持交互式用户输入
    unreg.push(client.onServerRequest("item/tool/requestUserInput", (_params, _id) => {
      return { cancelled: true as const };
    }));

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
      // 1. initialize handshake（每个连接必须先 send initialize，再 notify initialized）
      const initResult = await client.send<CodexInitializeResult>("initialize", {
        clientName: CLIENT_NAME,
        clientVersion: CLIENT_VERSION,
        cwd: ctx.plan.cwd,
      });
      push(eventMapper.mapInitialized(initResult));

      // notify initialized（handshake 完成）
      client.notify("initialized");

      // 2. thread/start（response result shape: { thread: { id, sessionId? } }）
      const threadResult = await client.send<CodexThreadStartResult>(
        "thread/start", options.threadStart,
      );
      const threadId = threadResult.thread.id;
      const sessionId = threadResult.thread.sessionId;
      this.sessionMapper.register(ctx.runId, threadId, sessionId);
      push(eventMapper.mapThreadStarted(threadId, sessionId));

      // 3. turn/start（input 为 content item array）
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
    // 通过 sessionMapper 取 codex threadId；若无则作为新 thread 启动
    const codexThread = this.sessionMapper.getCodexThread(sessionId);
    if (codexThread) {
      // 注入到 threadStart.resumeSessionId
      // 简化：复用 run 路径（threadStart 已含 resumeSessionId 由 plan.session.resumeId 提供）
      yield* this.run(ctx, settings);
    } else {
      yield* this.run(ctx, settings);
    }
  }

  // ---------- 内部 ----------

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
    // 通知 UI（无论是否 pending）
    push({
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
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
      return Promise.resolve(this.approvalMapper.mapServerRequestResult({ type: "accept" }));
    }
    if (decision === "auto-deny") {
      push(eventMapper.mapApprovalResolved(approvalReq.requestId, "deny", "mode"));
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
        return this.approvalMapper.mapServerRequestResult(result.response);
      },
      () => {
        // cancelAllPending：返回 deny（server 协议无 cancel outcome）
        push(eventMapper.mapApprovalResolved(approvalReq.requestId, "deny", "mode"));
        return this.approvalMapper.mapServerRequestResult({ type: "decline" });
      },
    );
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
}
