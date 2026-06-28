// LLM CLI Bridge — 本地 HTTP Action Bridge
// 在 127.0.0.1 上开启随机端口的 HTTP server，作为 Obsidian 交互主通道
// outbox watcher 保留为 fallback
//
// 两阶段 Approval Lifecycle：
// 1. 非修改类 action：同步执行，立即返回结果
// 2. 修改类 action：立即返回 pending_approval 状态，后台弹确认框，用户确认后执行

import { App } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { ConfirmModal, describeAction, executeAction, isModifying, validateAction, OutboxAction } from "./actions";

// 运行时获取 node http 模块（避免顶层 import 导致 renderer 加载失败）
type HttpModule = typeof import("http");
function loadHttp(): HttpModule {
  const g = globalThis as unknown as { require?: (n: string) => HttpModule };
  if (g.require) return g.require("http");
  throw new Error("globalThis.require 不可用，无法加载 http 模块");
}

// 运行时获取 node crypto 模块（用于时间安全 token 比较，防时序攻击）
type CryptoModule = typeof import("crypto");
function loadCrypto(): CryptoModule | null {
  const g = globalThis as unknown as { require?: (n: string) => CryptoModule };
  try {
    if (g.require) return g.require("crypto");
    return (require as (n: string) => CryptoModule)("crypto");
  } catch {
    return null;
  }
}

// 时间安全的 token 比较，防止时序攻击
function safeTokenEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    const crypto = loadCrypto();
    if (crypto) {
      const bufA = Buffer.from(a, "utf8");
      const bufB = Buffer.from(b, "utf8");
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    }
  } catch { /* fallthrough to constant-time-ish comparison */ }
  // fallback：手动恒定时间比较（crypto 不可用时）
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface BridgeInfo {
  host: string;
  port: number;
  token: string;
  vaultPath: string;
  startedAt: string;
}

interface ActionRequest {
  id?: string;
  type: string;
  params?: Record<string, unknown>;
}

export type ActionStatus = "pending_approval" | "completed" | "declined" | "cancelled";

export interface PendingActionEntry {
  id: string;
  type: string;
  params: Record<string, unknown>;
  ts: string;
  status: ActionStatus;
  confirmed?: boolean;
  result?: unknown;
  error?: string;
}

// Pending action 的用户确认回调：view 层注册后接管确认 UI
type PendingConfirmCallback = (
  entry: PendingActionEntry,
  approve: () => void,
  reject: () => void,
) => void;

interface ActionResult {
  ok: boolean;
  id?: string;
  type?: string;
  result?: unknown;
  error?: string;
  status?: ActionStatus;
  confirmed?: boolean;
  idempotent?: boolean;
}

// 用宽松类型，避免在模块顶层就引用 http 类型导致 esbuild 还原成顶层 require
type AnyServer = { close: (cb?: () => void) => void; address: () => { port: number } | string | null };
type AnyReq = { url?: string; method?: string; headers: Record<string, string | string[] | undefined>; on: (e: string, cb: (c?: Buffer) => void) => void; setTimeout?: (ms: number, cb?: () => void) => void };
type AnyRes = { writeHead: (s: number, h: Record<string, string>) => void; end: (d?: string) => void; on: (e: string, cb: () => void) => void; setTimeout: (ms: number, cb?: () => void) => void };

export class HttpBridge {
  private server: AnyServer | null = null;
  private port = 0;
  private logsDir: string;
  private actionsLogPath: string;
  private devLogPath: string;
  private startedAt = "";
  // Pending actions 注册表：actionId → entry
  private pendingActions = new Map<string, PendingActionEntry>();
  // 已完成的 actions（保留 60s，供状态查询）
  private completedActions = new Map<string, PendingActionEntry>();
  // Action idempotency：记录已处理 actionId，防止重复 POST 导致重复执行
  // key: actionId, value: { status, ts }（仅记录非 pending 的终态或已注册的 pending）
  private processedActionIds = new Map<string, { status: ActionStatus; ts: string }>();
  // Pending action 的确认回调（resolve/reject），由 view 层持有并调用
  private pendingConfirms = new Map<string, { resolve: (v: boolean) => void; reject: (e: Error) => void }>();
  // View 层注册的确认 UI 回调
  private pendingConfirmCallback: PendingConfirmCallback | null = null;
  // Dev endpoint 已处理的 approve/reject id，防止重复操作
  private processedDevOps = new Set<string>();

  constructor(
    private app: App,
    private vaultPath: string,
    private token: string,
    private devTestMode: boolean = false,
  ) {
    this.logsDir = path.join(vaultPath, ".llm-bridge", "logs");
    this.actionsLogPath = path.join(this.logsDir, "actions.jsonl");
    this.devLogPath = path.join(this.logsDir, "dev-ops.jsonl");
  }

  // 注册 pending action 确认 UI 回调（由 view 层调用）
  setPendingConfirmCallback(cb: PendingConfirmCallback | null): void {
    this.pendingConfirmCallback = cb;
  }

  // 获取当前所有 pending actions（供 view 渲染）
  getPendingActions(): PendingActionEntry[] {
    return Array.from(this.pendingActions.values());
  }

  async start(): Promise<BridgeInfo> {
    this.startedAt = new Date().toISOString();
    const http = loadHttp();
    return new Promise((resolve, reject) => {
      const server = http.createServer((req: AnyReq, res: AnyRes) => {
        // HTTP 请求超时保护：30 秒无响应则关闭连接
        if (req.setTimeout) req.setTimeout(30000, () => {
          try { res.writeHead(504, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "request timeout" })); } catch { /* ignore */ }
        });
        res.setTimeout(30000);
        req.on("error", () => {
          try { res.end(); } catch { /* ignore */ }
        });
        res.on("error", () => { /* ignore */ });
        this.handle(req, res).catch((e) => {
          try { this.sendJson(res, 500, { ok: false, error: String((e as Error)?.message || e) }); } catch { /* ignore */ }
        });
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("无法获取监听地址"));
          return;
        }
        this.port = addr.port;
        this.server = server as unknown as AnyServer;
        resolve({
          host: "127.0.0.1",
          port: this.port,
          token: this.token,
          vaultPath: this.vaultPath,
          startedAt: this.startedAt,
        });
      });
    });
  }

  async stop(): Promise<void> {
    // 卸载时将所有 pending 标记为 cancelled
    await this.cleanupPendingActions();
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    return new Promise((resolve) => {
      s.close(() => resolve());
    });
  }

  // 插件卸载时将所有 pending action 标记为 cancelled
  async cleanupPendingActions(): Promise<void> {
    const entries = Array.from(this.pendingActions.values());
    this.pendingActions.clear();
    this.completedActions.clear();
    this.pendingConfirms.clear();
    this.processedActionIds.clear();
    this.processedDevOps.clear();
    for (const entry of entries) {
      if (entry.status === "pending_approval") {
        entry.status = "cancelled";
        entry.error = "plugin unloaded";
        await this.appendPendingLog(entry, "http");
      }
    }
  }

  private async handle(req: AnyReq, res: AnyRes): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const method = req.method || "GET";
    const p = url.pathname;

    const body = await this.readBody(req);

    // /health 不需要鉴权，方便探测
    if (p !== "/health") {
      const authRaw = req.headers.authorization;
      const auth = Array.isArray(authRaw) ? (authRaw[0] || "") : (authRaw || "");
      const expected = `Bearer ${this.token}`;
      // 时间安全比较，防止时序攻击
      if (!safeTokenEqual(auth, expected)) {
        this.sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
    }

    if (p === "/health" && method === "GET") {
      this.sendJson(res, 200, {
        ok: true,
        vault: this.vaultPath,
        startedAt: this.startedAt,
        uptimeMs: Date.now() - new Date(this.startedAt).getTime(),
      });
      return;
    }
    if (p === "/state" && method === "GET") {
      const result = await this.runAction({ id: "state-" + Date.now(), type: "get_state", params: {} }, { log: false });
      this.sendJson(res, 200, result);
      return;
    }
    if (p === "/action-status" && method === "GET") {
      const actionId = url.searchParams.get("id");
      if (!actionId) {
        this.sendJson(res, 400, { ok: false, error: "missing id parameter" });
        return;
      }
      let entry = this.pendingActions.get(actionId);
      if (!entry) {
        entry = this.completedActions.get(actionId);
      }
      if (!entry) {
        this.sendJson(res, 404, { ok: false, error: "action not found" });
        return;
      }
      this.sendJson(res, 200, { ok: true, id: entry.id, status: entry.status, result: entry.result, error: entry.error });
      return;
    }
    if (p === "/action" && method === "POST") {
      let parsed: ActionRequest;
      try {
        parsed = JSON.parse(body || "{}") as ActionRequest;
      } catch {
        this.sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const result = await this.runAction(parsed, { log: true });
      // pending_approval 状态使用 202 Accepted
      const statusCode = result.status === "pending_approval" ? 202 : result.ok ? 200 : 400;
      this.sendJson(res, statusCode, result);
      return;
    }
    if (p === "/batch" && method === "POST") {
      let parsed: { actions?: ActionRequest[] };
      try {
        parsed = JSON.parse(body || "{}") as { actions?: ActionRequest[] };
      } catch {
        this.sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const results: ActionResult[] = [];
      for (const a of actions) {
        results.push(await this.runAction(a, { log: true }));
      }
      this.sendJson(res, 200, { ok: true, results });
      return;
    }

    // Dev test endpoints（仅 devTestMode=true 时启用）
    // 加固：idempotency（重复 approve/reject 同一 id 返回当前状态）+ 审计日志
    if (this.devTestMode && p === "/dev/approve" && method === "POST") {
      let parsed: { id?: string };
      try {
        parsed = JSON.parse(body || "{}") as { id?: string };
      } catch {
        this.sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const actionId = parsed.id;
      if (!actionId) {
        this.sendJson(res, 400, { ok: false, error: "missing id" });
        return;
      }
      // Idempotency：同一 approve op 重复请求直接返回已处理
      const opKey = `approve:${actionId}`;
      if (this.processedDevOps.has(opKey)) {
        await this.appendDevLog("approve", actionId, "idempotent_replay", true);
        this.sendJson(res, 200, { ok: true, id: actionId, status: "already_approved", idempotent: true });
        return;
      }
      const entry = this.pendingActions.get(actionId) || this.completedActions.get(actionId);
      if (!entry) {
        await this.appendDevLog("approve", actionId, "action not found", false);
        this.sendJson(res, 404, { ok: false, error: "action not found or not pending" });
        return;
      }
      if (entry.status !== "pending_approval") {
        // 已终态：返回当前状态（idempotent），不报错
        this.processedDevOps.add(opKey);
        await this.appendDevLog("approve", actionId, `already ${entry.status}`, true);
        this.sendJson(res, 200, { ok: true, id: actionId, status: entry.status, idempotent: true });
        return;
      }
      this.approvePendingAction(actionId);
      this.processedDevOps.add(opKey);
      await this.appendDevLog("approve", actionId, "approved", true);
      this.sendJson(res, 200, { ok: true, id: actionId, status: "approved" });
      return;
    }
    if (this.devTestMode && p === "/dev/reject" && method === "POST") {
      let parsed: { id?: string };
      try {
        parsed = JSON.parse(body || "{}") as { id?: string };
      } catch {
        this.sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const actionId = parsed.id;
      if (!actionId) {
        this.sendJson(res, 400, { ok: false, error: "missing id" });
        return;
      }
      // Idempotency：同一 reject op 重复请求直接返回已处理
      const opKey = `reject:${actionId}`;
      if (this.processedDevOps.has(opKey)) {
        await this.appendDevLog("reject", actionId, "idempotent_replay", true);
        this.sendJson(res, 200, { ok: true, id: actionId, status: "already_rejected", idempotent: true });
        return;
      }
      const entry = this.pendingActions.get(actionId) || this.completedActions.get(actionId);
      if (!entry) {
        await this.appendDevLog("reject", actionId, "action not found", false);
        this.sendJson(res, 404, { ok: false, error: "action not found or not pending" });
        return;
      }
      if (entry.status !== "pending_approval") {
        // 已终态：返回当前状态（idempotent），不报错
        this.processedDevOps.add(opKey);
        await this.appendDevLog("reject", actionId, `already ${entry.status}`, true);
        this.sendJson(res, 200, { ok: true, id: actionId, status: entry.status, idempotent: true });
        return;
      }
      this.rejectPendingAction(actionId);
      this.processedDevOps.add(opKey);
      await this.appendDevLog("reject", actionId, "rejected", true);
      this.sendJson(res, 200, { ok: true, id: actionId, status: "rejected" });
      return;
    }

    this.sendJson(res, 404, { ok: false, error: `not found: ${method} ${p}` });
  }

  // Dev endpoint 审计日志：记录所有 approve/reject 调用（含 idempotent replay）
  private async appendDevLog(op: "approve" | "reject", actionId: string, detail: string, ok: boolean): Promise<void> {
    try {
      await fs.promises.mkdir(this.logsDir, { recursive: true });
      const entry = {
        ts: new Date().toISOString(),
        op,
        actionId,
        detail,
        ok,
        devTestMode: this.devTestMode,
      };
      await fs.promises.appendFile(this.devLogPath, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* 忽略日志失败 */
    }
  }

  // 执行单个 action：两阶段
  // - 非修改类：同步执行，立即返回 completed 结果
  // - 修改类：立即返回 pending_approval，后台弹确认框，用户确认后执行
  // - Idempotency：相同 id 重复提交时返回已有状态，不重复执行
  private async runAction(req: ActionRequest, opts: { log: boolean }): Promise<ActionResult> {
    const id = req.id || `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const type = req.type;
    const params = req.params || {};
    const ts = new Date().toISOString();

    if (!type) {
      return { ok: false, id, error: "missing type" };
    }

    // Idempotency 检查：如果客户端显式传入 id 且该 id 已注册/已处理，返回现有状态
    // 注意：自动生成的 id（无 req.id）不触发 idempotency，允许并发相同类型 action
    if (req.id) {
      const pending = this.pendingActions.get(id);
      if (pending) {
        return { ok: true, id, type: pending.type, status: pending.status, confirmed: pending.confirmed, idempotent: true };
      }
      const completed = this.completedActions.get(id);
      if (completed) {
        return { ok: completed.status === "completed" && !completed.error, id, type: completed.type, result: completed.result, error: completed.error, status: completed.status, confirmed: completed.confirmed, idempotent: true };
      }
    }

    const action: OutboxAction = { id, type: type as OutboxAction["type"], params, ts };

    // 先校验（拒绝无效 action，不弹出无意义的确认框）
    const validationError = validateAction(this.vaultPath, action);
    if (validationError) {
      const ar: ActionResult = { ok: false, id, type, error: validationError, confirmed: false };
      if (opts.log) await this.appendLog(ts, action, ar);
      return ar;
    }

    // 非修改类：同步执行
    if (!isModifying(type)) {
      try {
        const result = await executeAction(this.app, this.vaultPath, action);
        const ar: ActionResult = { ok: true, id, type, result, status: "completed", confirmed: true };
        if (opts.log) await this.appendLog(ts, action, ar);
        return ar;
      } catch (e) {
        const ar: ActionResult = { ok: false, id, type, error: String((e as Error)?.message || e), status: "completed", confirmed: true };
        if (opts.log) await this.appendLog(ts, action, ar);
        return ar;
      }
    }

    // 修改类：两阶段 —— 立即注册为 pending，后台弹确认框
    const entry: PendingActionEntry = {
      id,
      type,
      params,
      ts,
      status: "pending_approval",
    };
    this.pendingActions.set(id, entry);
    if (opts.log) {
      await this.appendPendingLog(entry, "http");
    }

    // 后台等待确认，不阻塞 HTTP 请求；用户确认/拒绝后执行后续逻辑
    this.promptConfirmation(action, entry).then(async (confirmed) => {
      if (confirmed) {
        entry.status = "completed";
        entry.confirmed = true;
        try {
          entry.result = await executeAction(this.app, this.vaultPath, action);
        } catch (e) {
          entry.status = "completed";
          const err = e as Error;
          entry.error = err?.stack || err?.message || String(e);
        }
      } else {
        entry.status = "declined";
        entry.confirmed = false;
        entry.error = "user declined";
      }
      await this.appendPendingLog(entry, "http");
      this.pendingActions.delete(entry.id);
      this.completedActions.set(entry.id, entry);
      setTimeout(() => this.completedActions.delete(entry.id), 60000);
    }).catch((e) => {
      entry.status = "completed";
      const err = e as Error;
      entry.error = err?.stack || err?.message || String(e);
      this.appendPendingLog(entry, "http").catch(() => {});
      this.pendingActions.delete(entry.id);
      this.completedActions.set(entry.id, entry);
      setTimeout(() => this.completedActions.delete(entry.id), 60000);
    });

    return {
      ok: true,
      id,
      type,
      status: "pending_approval",
      confirmed: false,
    };
  }

  // 弹出确认框，用户操作后更新 pending entry
  private async promptConfirmation(action: OutboxAction, entry: PendingActionEntry): Promise<boolean> {
    // Dev test mode：不弹 modal，等待 /dev/approve 或 /dev/reject 驱动
    if (this.devTestMode) {
      return new Promise<boolean>((resolve, reject) => {
        this.pendingConfirms.set(entry.id, { resolve, reject });
      });
    }
    // 如果 view 层注册了回调，委托给 view 处理
    if (this.pendingConfirmCallback) {
      return new Promise<boolean>((resolve, reject) => {
        this.pendingConfirms.set(entry.id, { resolve, reject });
        this.pendingConfirmCallback!(entry, () => resolve(true), () => resolve(false));
      });
    }
    // 默认：使用 ConfirmModal
    return this.confirmWithModal(action);
  }

  // view 层调用：批准某个 pending action
  approvePendingAction(actionId: string): void {
    const handlers = this.pendingConfirms.get(actionId);
    if (handlers) {
      this.pendingConfirms.delete(actionId);
      handlers.resolve(true);
    }
  }

  // view 层调用：拒绝某个 pending action
  rejectPendingAction(actionId: string): void {
    const handlers = this.pendingConfirms.get(actionId);
    if (handlers) {
      this.pendingConfirms.delete(actionId);
      handlers.resolve(false);
    }
  }

  private confirmWithModal(action: OutboxAction): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmModal(
        this.app,
        `Bridge action: ${action.type}`,
        describeAction(action),
        (ok) => resolve(ok),
      );
      modal.open();
    });
  }

  // 写入终态日志（completed / declined / cancelled）
  private async appendPendingLog(entry: PendingActionEntry, source: string): Promise<void> {
    try {
      await fs.promises.mkdir(this.logsDir, { recursive: true });
      const paramsSummary = this.summarizeParams(entry);
      const logEntry = {
        ts: entry.ts,
        id: entry.id,
        type: entry.type,
        params: paramsSummary,
        ok: entry.status === "completed" && !entry.error,
        error: entry.error,
        confirmed: entry.confirmed,
        status: entry.status,
        source,
      };
      await fs.promises.appendFile(this.actionsLogPath, JSON.stringify(logEntry) + "\n", "utf8");
    } catch {
      /* 忽略日志失败 */
    }
  }

  private async appendLog(ts: string, action: OutboxAction, result: ActionResult): Promise<void> {
    try {
      await fs.promises.mkdir(this.logsDir, { recursive: true });
      const paramsSummary = this.summarizeParams(action);
      const entry = {
        ts,
        id: action.id,
        type: action.type,
        params: paramsSummary,
        ok: result.ok,
        error: result.error,
        source: "http",
      };
      await fs.promises.appendFile(this.actionsLogPath, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* 忽略日志失败 */
    }
  }

  private summarizeParams(action: OutboxAction | PendingActionEntry): Record<string, unknown> {
    const p = action.params || {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "string" && v.length > 200) {
        out[k] = `[${v.length} chars] ${v.slice(0, 200)}...`;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private sendJson(res: AnyRes, status: number, data: unknown): void {
    const json = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(json)),
      "Access-Control-Allow-Origin": "*",
    });
    res.end(json);
  }

  // 读取请求 body（事件式，兼容 renderer）
  private readBody(req: AnyReq): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c?: Buffer) => {
        if (c) chunks.push(c);
      });
      req.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
  }
}
