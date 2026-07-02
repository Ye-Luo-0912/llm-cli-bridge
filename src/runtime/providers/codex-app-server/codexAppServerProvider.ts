// LLM CLI Bridge — CodexAppServerProvider (V2.17-A Completion)
//
// 主目标 provider：通过 codex app-server JSON-RPC over stdio JSONL 接入 Bridge Core。
//
// 当前为 skeleton：
// - isAvailable(cwd)：探测 codex 命令是否存在（spawn `codex --version`）；fixture 测试绕过
// - buildPlan：通过 buildCodexAppServerEffectiveRunPlan 构造（backend="codex-app-server"）
// - run：
//   1. AppServerProcessManager.spawn(codex app-server)
//   2. JsonRpcClient.send("thread/start", options.threadStart) → threadId
//   3. JsonRpcClient.send("turn/start", { ...options.turnStart, threadId })
//   4. 注册通知 handler（item/started, item/text/delta, item/argument/delta, item/completed,
//      approval/request, approval/respond, turn/completed, turn/failed）
//   5. 通过 CodexAppServerEventMapper 映射为 NormalizedRuntimeEvent，yield 到 AsyncIterable
//   6. approval/request → PermissionBoundary.requestApproval；若 pending 则 waitForApproval
//      挂起，UI 决策后通过 JsonRpcClient.notify("approval/respond", ...) 回传
//   7. turn/completed / turn/failed / process exit → 关闭流
// - cancel：AppServerProcessManager.kill() + PermissionBoundary.cancelAllPending()
// - resume：通过 CodexAppServerSessionMapper 取 codex threadId，复用 run 路径
//
// 当前环境无 codex CLI；run() 仍可被 fixture JSONL 测试驱动（通过 runFromFixtureEvents）。

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
  CodexApprovalRequestParams,
  CodexItemArgumentDeltaParams,
  CodexItemCompletedParams,
  CodexItemStartedParams,
  CodexItemTextDeltaParams,
  CodexTurnCompletedParams,
  CodexTurnFailedParams,
} from "./schema";
import { execFileSync } from "child_process";

/**
 * CodexAppServerProvider：通过 codex app-server JSON-RPC 接入 Bridge Core。
 *
 * 主目标 provider（V2.17-A Completion）。
 */
export class CodexAppServerProvider implements RuntimeProvider {
  readonly providerId = "codex-app-server" as const;
  readonly displayName = "Codex app-server";

  private readonly eventMapper: CodexAppServerEventMapper;
  private readonly approvalMapper: CodexAppServerApprovalMapper;
  private readonly sessionMapper: CodexAppServerSessionMapper;
  /** 当前活动进程（cancel 用） */
  private currentProcess: AppServerProcessManager | null = null;
  /** 当前活动 JsonRpcClient（cancel/approval respond 用） */
  private currentClient: JsonRpcClient | null = null;
  /** 当前 runId（cancel 配对） */
  private currentRunId: string | null = null;

  constructor(developerMode: boolean = false) {
    // developerMode 由 run() 内部根据 settings 注入；这里给一个默认值供 isAvailable 等无 settings 调用使用
    this.eventMapper = new CodexAppServerEventMapper(this.providerId, developerMode);
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
    // 重新构造带 developerMode 的 eventMapper（保证本 run 的 rawProviderEvent 正确填充）
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

    // 注册通知 handler
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
    unreg.push(client.onNotification("approval/request", (params) => {
      const codexParams = params as CodexApprovalRequestParams;
      const approvalReq = this.approvalMapper.mapApprovalRequest(codexParams);
      const decision = ctx.permission.requestApproval(approvalReq);
      // 通知 UI（无论是否 pending）
      push({
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        rawProviderEvent: developerMode ? { method: "approval/request", params } : undefined,
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
        client.notify("approval/respond", this.approvalMapper.mapApprovalResponse(
          { type: "accept" }, codexParams.requestId,
        ));
        push(eventMapper.mapApprovalResolved(approvalReq.requestId, "allow", "mode"));
      } else if (decision === "auto-deny") {
        client.notify("approval/respond", this.approvalMapper.mapApprovalResponse(
          { type: "decline" }, codexParams.requestId,
        ));
        push(eventMapper.mapApprovalResolved(approvalReq.requestId, "deny", "mode"));
      } else {
        // pending：等待 UI 决策（异步，不阻塞事件流）
        void (async () => {
          try {
            const result = await ctx.permission.waitForApproval(approvalReq.requestId);
            client.notify("approval/respond",
              this.approvalMapper.mapApprovalResponse(result.response, codexParams.requestId));
            push(eventMapper.mapApprovalResolved(approvalReq.requestId,
              result.response.type === "accept" ? "allow"
                : result.response.type === "acceptForSession" ? "allowSession"
                : result.response.type === "decline" ? "deny"
                : "cancel",
              result.source));
          } catch {
            // cancelAllPending 已被调用；进程将被 kill，不回传
          }
        })();
      }
    }));
    unreg.push(client.onNotification("turn/completed", (params) => {
      push(eventMapper.mapTurnCompleted(params as CodexTurnCompletedParams));
      signalDone();
    }));
    unreg.push(client.onNotification("turn/failed", (params) => {
      push(eventMapper.mapTurnFailed(params as CodexTurnFailedParams));
      signalDone();
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
      // thread/start
      const threadResult = await client.send<{ threadId: string; sessionId?: string }>(
        "thread/start", options.threadStart,
      );
      this.sessionMapper.register(ctx.runId, threadResult.threadId, threadResult.sessionId);
      push(eventMapper.mapThreadStarted(threadResult.threadId, threadResult.sessionId));

      // turn/start
      await client.send("turn/start", {
        ...options.turnStart,
        threadId: threadResult.threadId,
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

  cancel(runId: string): void {
    void runId;
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
   * 暴露 EventMapper（测试用：fixture JSONL 直接驱动）。
   */
  getEventMapper(developerMode: boolean): CodexAppServerEventMapper {
    return new CodexAppServerEventMapper(this.providerId, developerMode);
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
