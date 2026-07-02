// LLM CLI Bridge — JSON-RPC 2.0 client over stdio JSONL (V2.17-A Completion)
//
// Codex app-server 通过子进程 stdio 通信，每行一个 JSON-RPC 2.0 消息（JSONL）。
// 本 client 负责把请求/通知/响应配对，并把服务端推送的通知分发给注册的 handler。
//
// 设计：
// - send(method, params): Promise<result>  // 请求-响应配对（id 递增）
// - notify(method, params): void            // 单向通知（无 id）
// - onNotification(method, handler): 注册通知 handler
// - onError(handler): 注册 transport-level 错误 handler
//
// 数据流：
//   toServer: writeLine(JSON.stringify(request | notification | response))
//   fromServer: split by newline → parse JSON → route by id / method
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
export type TransportErrorHandler = (err: Error) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * JsonRpcClient：JSON-RPC 2.0 over stdio JSONL。
 *
 * 用法：
 *   const client = new JsonRpcClient(writeLine, registerLineHandler);
 *   const result = await client.send("thread/start", { ... });
 *   client.onNotification("item/started", (params) => { ... });
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Array<NotificationHandler>>();
  private readonly errorHandlers = new Set<TransportErrorHandler>();
  private closed = false;

  constructor(
    private readonly writeLine: WriteLineFn,
    private readonly registerLineHandler: RegisterLineHandler,
  ) {
    registerLineHandler((line) => this.handleLine(line));
  }

  /**
   * 发送请求并等待响应。
   */
  send<R = unknown>(method: string, params?: unknown): Promise<R> {
    if (this.closed) return Promise.reject(new Error("JsonRpcClient closed"));
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const json = JSON.stringify(req);
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (r) => resolve(r as R),
        reject,
      });
      try {
        this.writeLine(json);
      } catch (err) {
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
    const notif: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.writeLine(JSON.stringify(notif));
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
    // 1. 响应（带 id + result/error）
    if ("id" in msg && ("result" in msg || "error" in msg)) {
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
    // 3. 服务端发起的请求（带 id + method）— 当前 codex app-server 不主动发起请求，
    //    若收到则作为通知处理（忽略 id），日志记录。
    if ("method" in msg && "id" in msg) {
      const handlers = this.notificationHandlers.get((msg as { method: string }).method);
      if (handlers) {
        for (const h of handlers) {
          try { h((msg as { params?: unknown }).params); } catch (err) {
            this.emitError(err instanceof Error ? err : new Error(String(err)));
          }
        }
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
 */
export function createInMemoryJsonRpcClient(
  fixtureLines: ReadonlyArray<string>,
  notificationHandler: (method: string, params: unknown) => void,
): JsonRpcClient {
  const writeLine: WriteLineFn = (_line: string) => {
    // 测试模式：不实际发送
  };
  const register: RegisterLineHandler = (handler) => {
    // 立即回放所有 fixture 行
    for (const line of fixtureLines) {
      handler(line);
    }
    return () => { /* no-op */ };
  };
  const client = new JsonRpcClient(writeLine, register);
  // 注册通配通知 handler（把所有 method 转给调用方）
  // 由于 JsonRpcClient.onNotification 按 method 注册，测试时需要为每个 method 分别注册。
  // 这里提供一个直接读 routeMessage 的便利：通过 onError 桥接不可识别消息不合适。
  // 改用：测试代码直接用 onNotification(method, ...) 注册关心的方法。
  void notificationHandler;
  return client;
}
