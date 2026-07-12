// LLM CLI Bridge — JSON-RPC client over stdio JSONL (V2.17-A Completion)
//
// Codex app-server 通过子进程 stdio 通信，每行一个 JSON-RPC 消息（JSONL）。
// 本 client 负责把请求/通知/响应配对，并把服务端推送的通知分发给注册的 handler。
//
// ⚠️ Wire 协议（codex app-server 约定）：
// - wire 上不发送 "jsonrpc":"2.0" 字段。请求/通知/响应均为 bare object。
// - 支持 server-initiated request（带 id + method 的消息）：client 必须按原 id
//   返回 result（通过 respondToServerRequest）。
//
// 设计：
// - send(method, params): Promise<result>            // client→server 请求（id 递增）
// - notify(method, params): void                      // client→server 通知（无 id）
// - respondToServerRequest(id, result): void          // server→client request 的回复
// - onNotification(method, handler): 注册通知 handler  // server→client 通知（无 id）
// - onServerRequest(method, handler): 注册 server request handler
//     handler 收到 (params, id)；handler 可同步返回 result 或 Promise<result>，
//     client 自动按 id 回复；也可手动调 respondToServerRequest。
// - onError(handler): 注册 transport-level 错误 handler
//
// 不直接依赖 child_process；通过注入的 writeLine / onLine 解耦，便于 fixture 测试。

import type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponseError,
  JsonRpcResponseSuccess,
} from "./schema";

/**
 * 写入一行 JSON（服务端 stdin）。由 AppServerProcessManager 提供。
 */
export type WriteLineFn = (line: string) => void;

/**
 * 注册 stdin/stderr 行回调。返回取消订阅函数。
 */
export type RegisterLineHandler = (handler: (line: string) => void) => () => void;

export type NotificationHandler = (params: unknown) => void;
export type ServerRequestHandler = (params: unknown, id: number | string) =>
  unknown | Promise<unknown>;
export type TransportErrorHandler = (err: Error) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * 序列化 wire 消息（不带 jsonrpc 字段）。
 *
 * codex app-server 约定 wire 上不出现 "jsonrpc":"2.0"。
 */
function serialize(msg: Record<string, unknown>): string {
  return JSON.stringify(msg);
}

/**
 * JsonRpcClient：JSON-RPC over stdio JSONL（codex app-server 变体，wire 不带 jsonrpc 字段）。
 *
 * 用法：
 *   const client = new JsonRpcClient(writeLine, registerLineHandler);
 *   const result = await client.send("thread/start", { ... });
 *   client.onNotification("item/started", (params) => { ... });
 *   client.onServerRequest("item/commandExecution/requestApproval", (params, id) => {
 *     return { decision: "allow" };  // 自动按 id 回复
 *   });
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Array<NotificationHandler>>();
  private readonly serverRequestHandlers = new Map<string, Array<ServerRequestHandler>>();
  private readonly errorHandlers = new Set<TransportErrorHandler>();
  /** 已处理的 server request id（去重，防重复回复） */
  private readonly respondedServerRequests = new Set<number | string>();
  private closed = false;

  constructor(
    private readonly writeLine: WriteLineFn,
    private readonly registerLineHandler: RegisterLineHandler,
  ) {
    registerLineHandler((line) => this.handleLine(line));
  }

  /**
   * 发送 client→server 请求并等待响应。
   *
   * V20.3: 支持可选 timeoutMs。超时后 reject 并清理 pending，
   * 让上层能明确报告卡在哪个 JSON-RPC 阶段，而不是干等 90 秒。
   */
  send<R = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<R> {
    if (this.closed) return Promise.reject(new Error("JsonRpcClient closed"));
    const id = this.nextId++;
    const req: JsonRpcRequest = { id, method };
    if (params !== undefined) (req as { params?: unknown }).params = params;
    const json = serialize(req as unknown as Record<string, unknown>);
    return new Promise<R>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const entry: PendingRequest = {
        resolve: (r) => {
          if (timer !== null) clearTimeout(timer);
          resolve(r as R);
        },
        reject: (err) => {
          if (timer !== null) clearTimeout(timer);
          reject(err);
        },
      };
      this.pending.set(id, entry);
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`JSON-RPC '${method}' timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }
      try {
        this.writeLine(json);
      } catch (err) {
        if (timer !== null) clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * 发送通知（无 id，无响应）。
   */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const notif: JsonRpcNotification = { method };
    if (params !== undefined) (notif as { params?: unknown }).params = params;
    this.writeLine(serialize(notif as unknown as Record<string, unknown>));
  }

  /**
   * 回复 server-initiated request（按原 id 返回 result）。
   *
   * 用于 handler 需要异步决策（如等待用户 approval）时手动回复。
   * 同步 handler 直接 return result 即可，无需调用本方法。
   */
  respondToServerRequest(id: number | string, result: unknown): void {
    if (this.closed) return;
    if (this.respondedServerRequests.has(id)) return; // 防重复回复
    this.respondedServerRequests.add(id);
    const msg = { id, result };
    this.writeLine(serialize(msg));
  }

  /**
   * 回复 server-initiated request 的错误（top-level error，符合 JSON-RPC 规范）。
   *
   * 用于 handler 抛错或无 handler 时。error 为 top-level 字段（非嵌在 result 内），
   * 与 routeMessage 接收响应时的解析逻辑对称。
   */
  respondToServerRequestError(id: number | string, code: number, message: string, data?: unknown): void {
    if (this.closed) return;
    if (this.respondedServerRequests.has(id)) return; // 防重复回复
    this.respondedServerRequests.add(id);
    const msg = { id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
    this.writeLine(serialize(msg));
  }

  /**
   * 注册通知 handler（按 method 多播）。
   */
  onNotification(method: string, handler: NotificationHandler): () => void {
    let list = this.notificationHandlers.get(method);
    if (!list) {
      list = [];
      this.notificationHandlers.set(method, list);
    }
    list.push(handler);
    return () => {
      const arr = this.notificationHandlers.get(method);
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) this.notificationHandlers.delete(method);
    };
  }

  /**
   * 注册 server-initiated request handler。
   *
   * handler 收到 (params, id)。若 handler 同步返回非 Promise 值，client 自动按 id 回复；
   * 若返回 Promise，等 resolve 后回复；若 handler 抛错，回复 error。
   * handler 也可不返回值，稍后手动调 respondToServerRequest(id, result)。
   */
  onServerRequest(method: string, handler: ServerRequestHandler): () => void {
    let list = this.serverRequestHandlers.get(method);
    if (!list) {
      list = [];
      this.serverRequestHandlers.set(method, list);
    }
    list.push(handler);
    return () => {
      const arr = this.serverRequestHandlers.get(method);
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) this.serverRequestHandlers.delete(method);
    };
  }

  /**
   * 注册 transport 错误 handler。
   */
  onError(handler: TransportErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => { this.errorHandlers.delete(handler); };
  }

  /**
   * 关闭 client：拒绝所有 pending 请求，停止处理后续行。
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const err = new Error("JsonRpcClient closed");
    for (const { reject } of this.pending.values()) {
      reject(err);
    }
    this.pending.clear();
    this.notificationHandlers.clear();
    this.serverRequestHandlers.clear();
  }

  isClosed(): boolean {
    return this.closed;
  }

  // ---------- 内部 ----------

  private handleLine(line: string): void {
    if (this.closed) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch (err) {
      this.emitError(new Error(`Invalid JSON-RPC line: ${trimmed.slice(0, 200)}`));
      return;
    }
    this.routeMessage(msg);
  }

  private routeMessage(msg: JsonRpcMessage): void {
    // 1. 响应（带 id + result/error，但无 method）—— 对应 client→server 请求的回复
    if ("id" in msg && !("method" in msg) && ("result" in msg || "error" in msg)) {
      const id = (msg as { id: number | string }).id;
      const pending = this.pending.get(id);
      if (!pending) return; // 已被 close 取消或已 resolve
      this.pending.delete(id);
      if ("error" in msg) {
        const e = msg as JsonRpcResponseError;
        pending.reject(new Error(`JSON-RPC error ${e.error.code}: ${e.error.message}`));
      } else {
        const r = msg as JsonRpcResponseSuccess;
        pending.resolve(r.result);
      }
      return;
    }
    // 2. 通知（无 id，有 method）
    if ("method" in msg && !("id" in msg)) {
      const notif = msg as JsonRpcNotification;
      const handlers = this.notificationHandlers.get(notif.method);
      if (handlers) {
        for (const h of handlers) {
          try {
            h(notif.params);
          } catch (err) {
            this.emitError(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
      return;
    }
    // 3. server-initiated request（带 id + method）—— client 必须按 id 回复 result
    if ("method" in msg && "id" in msg) {
      const req = msg as JsonRpcRequest;
      const id = req.id;
      const handlers = this.serverRequestHandlers.get(req.method);
      if (handlers && handlers.length > 0) {
        // 只调用第一个 handler（多播对 server request 无意义）
        const h = handlers[0];
        try {
          const ret = h(req.params, id);
          if (ret instanceof Promise) {
            ret.then(
              (result) => {
                if (result !== undefined) {
                  this.respondToServerRequest(id, result);
                }
              },
              (err) => {
                this.respondToServerRequestError(id, -32603, err instanceof Error ? err.message : String(err));
              },
            );
          } else if (ret !== undefined) {
            this.respondToServerRequest(id, ret);
          }
          // 若 ret === undefined：handler 将稍后手动调 respondToServerRequest
        } catch (err) {
          this.respondToServerRequestError(id, -32603, err instanceof Error ? err.message : String(err));
        }
      } else {
        // 无 handler：回复 method not found
        this.respondToServerRequestError(id, -32601, `method '${req.method}' not supported`);
      }
      return;
    }
    // 4. 无法识别的消息
    this.emitError(new Error(`Unrecognized JSON-RPC message: ${JSON.stringify(msg).slice(0, 200)}`));
  }

  private emitError(err: Error): void {
    for (const h of this.errorHandlers) {
      try { h(err); } catch { /* swallow */ }
    }
  }
}

/**
 * 从字符串数组（每行一个 JSON-RPC 消息）构造一个 in-memory client。
 *
 * 主要供 fixture 测试用：把录制好的 JSONL 行序列喂给 client，让 EventMapper 处理。
 * 不发送任何请求。
 *
 * 改进版：返回 client 与 lineHandler，测试可先注册 handler 再回放 fixture 行。
 */
export function createInMemoryJsonRpcClient(
  fixtureLines?: ReadonlyArray<string>,
): { client: JsonRpcClient; replay: () => void } {
  let lineHandler: ((line: string) => void) | null = null;
  const writeLine: WriteLineFn = (_line: string) => {
    // 测试模式：不实际发送（但记录以便 wire-shape 测试断言）
  };
  const register: RegisterLineHandler = (handler) => {
    lineHandler = handler;
    return () => { lineHandler = null; };
  };
  const client = new JsonRpcClient(writeLine, register);
  const replay = () => {
    if (!lineHandler || !fixtureLines) return;
    for (const line of fixtureLines) lineHandler(line);
  };
  return { client, replay };
}
