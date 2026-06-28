// LLM CLI Bridge — Outbox 文件 watcher
// 轮询 .llm-bridge/outbox/actions.jsonl，解析新增行并执行 action
// 启动时先把已有内容标记为已处理（不执行），只处理启动后新增的 action

import { App, Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { ConfirmModal, describeAction, executeAction, isModifying, validateAction, OutboxAction } from "./actions";

export const OUTBOX_DIR_REL = ".llm-bridge/outbox";
export const OUTBOX_FILE_NAME = "actions.jsonl";
const POLL_INTERVAL_MS = 1500;
const ACTIONS_LOG_REL = ".llm-bridge/logs/actions.jsonl";

export class OutboxWatcher {
  private timer: number | null = null;
  private offset = 0;
  private processedIds = new Set<string>();
  private filePath: string;
  private dirPath: string;
  private logsDir: string;
  private actionsLogPath: string;
  private polling = false;

  constructor(private app: App, private vaultPath: string) {
    this.dirPath = path.join(vaultPath, OUTBOX_DIR_REL);
    this.filePath = path.join(this.dirPath, OUTBOX_FILE_NAME);
    this.logsDir = path.join(vaultPath, ".llm-bridge", "logs");
    this.actionsLogPath = path.join(vaultPath, ACTIONS_LOG_REL);
  }

  start(): void {
    if (this.timer !== null) return;
    // 异步初始化：确保目录存在 + 读取已有内容标记已处理
    void this.init();
    this.timer = window.setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 初始化：标记已有 action 为已处理，offset 跳到文件末尾
  private async init(): Promise<void> {
    try {
      await fs.promises.mkdir(this.dirPath, { recursive: true });
    } catch {
      /* 忽略 */
    }
    try {
      const stat = await fs.promises.stat(this.filePath);
      const content = await fs.promises.readFile(this.filePath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const action = JSON.parse(trimmed) as OutboxAction;
          if (action.id) this.processedIds.add(action.id);
        } catch {
          /* 跳过坏行 */
        }
      }
      this.offset = stat.size;
    } catch {
      // 文件不存在
      this.offset = 0;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(this.filePath);
      } catch {
        return; // 文件不存在
      }
      // 文件被截断或轮转：重置 offset
      if (stat.size < this.offset) {
        this.offset = 0;
      }
      if (stat.size === this.offset) return;

      console.log("[llm-cli-bridge] outbox poll: reading from offset", this.offset, "to", stat.size);
      const fd = await fs.promises.open(this.filePath, "r");
      try {
        const length = stat.size - this.offset;
        const buf = Buffer.alloc(length);
        await fd.read(buf, 0, length, this.offset);
        this.offset = stat.size;
        const text = buf.toString("utf8");
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let action: OutboxAction;
          try {
            action = JSON.parse(trimmed) as OutboxAction;
          } catch (e) {
            console.warn("[llm-cli-bridge] outbox 解析失败:", e, "line:", trimmed);
            continue;
          }
          if (!action.id || this.processedIds.has(action.id)) continue;
          this.processedIds.add(action.id);
          console.log("[llm-cli-bridge] executing action:", action.type, action.id);
          await this.handle(action);
        }
      } finally {
        await fd.close();
      }
    } catch (e) {
      console.error("[llm-cli-bridge] outbox poll error:", e);
    } finally {
      this.polling = false;
    }
  }

  private async handle(action: OutboxAction): Promise<void> {
    let ok = false;
    let errorMsg: string | undefined;
    let confirmed = true;
    try {
      // 先校验（不走 action 执行器内部校验，避免重复）
      const validationError = validateAction(this.vaultPath, action);
      if (validationError) {
        new Notice(`[Bridge] ${action.type} 校验失败: ${validationError}`);
        await this.appendLog(action, false, validationError, false);
        return;
      }
      if (isModifying(action.type)) {
        confirmed = await this.confirm(action);
        if (!confirmed) {
          new Notice(`[Bridge] 已拒绝 action: ${action.type}`);
          await this.appendLog(action, false, "user declined", false);
          return;
        }
      }
      await executeAction(this.app, this.vaultPath, action);
      ok = true;
      // 非修改类 action 静默执行；show_notice 自身会弹消息
      if (isModifying(action.type)) {
        new Notice(`[Bridge] ${action.type} ✓`);
      }
    } catch (e) {
      errorMsg = (e as Error).message;
      new Notice(`[Bridge] ${action.type} 失败: ${errorMsg}`);
      console.error("[llm-cli-bridge] action 执行失败:", e);
    } finally {
      await this.appendLog(action, ok, errorMsg, confirmed);
    }
  }

  // outbox 作为 fallback，也把执行结果写入 actions.jsonl，source 标记为 outbox
  private async appendLog(action: OutboxAction, ok: boolean, error: string | undefined, confirmed: boolean): Promise<void> {
    try {
      await fs.promises.mkdir(this.logsDir, { recursive: true });
      const p = action.params || {};
      const paramsSummary: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (typeof v === "string" && v.length > 200) {
          paramsSummary[k] = `[${v.length} chars] ${v.slice(0, 200)}...`;
        } else {
          paramsSummary[k] = v;
        }
      }
      const entry = {
        ts: new Date().toISOString(),
        id: action.id,
        type: action.type,
        params: paramsSummary,
        ok,
        error,
        confirmed,
        source: "outbox",
      };
      await fs.promises.appendFile(this.actionsLogPath, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* 忽略日志失败 */
    }
  }

  private confirm(action: OutboxAction): Promise<boolean> {
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
}
