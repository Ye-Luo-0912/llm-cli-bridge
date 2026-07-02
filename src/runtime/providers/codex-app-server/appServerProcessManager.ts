// LLM CLI Bridge — Codex app-server process manager (V2.17-A Completion)
//
// 管理 codex app-server 子进程的生命周期与 stdio 桥接。
//
// 职责：
// - spawn: 启动 codex app-server（默认通过 `codex app-server` 子命令）
// - 提供 writeLine(line)：把 JSON-RPC 行写入子进程 stdin
// - 提供 onStdoutLine(handler)：把子进程 stdout 按行分发给 JsonRpcClient
// - 提供 onStderr(handler)：把 stderr 暴露（用于诊断 / fallback）
// - kill: 终止子进程并清理
//
// 当前为 skeleton：实际 spawn 在 isAvailable(cwd) 通过后才会被调用。
// 若 codex 不可用，调用方应跳过本 provider；测试通过 fixture JSONL 直接驱动
// EventMapper，不需要本模块启动真实进程。

import { spawn, type ChildProcess } from "child_process";

export interface AppServerSpawnOptions {
  /** codex 命令名（默认 "codex"） */
  command: string;
  /** 启动 app-server 的子命令参数（默认 ["app-server"]） */
  args?: string[];
  /** 工作目录（Vault 根目录） */
  cwd: string;
  /** 环境变量（继承父进程） */
  env?: NodeJS.ProcessEnv;
}

export interface AppServerProcessLike {
  /** 写入一行到子进程 stdin */
  writeLine(line: string): void;
  /** 注册 stdout 行 handler（按 \n 分割） */
  onStdoutLine(handler: (line: string) => void): () => void;
  /** 注册 stderr 行 handler（按 \n 分割） */
  onStderrLine(handler: (line: string) => void): () => void;
  /** 注册子进程退出 handler */
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
  /** 是否仍在运行 */
  readonly running: boolean;
  /** 终止子进程（SIGTERM → SIGKILL） */
  kill(): void;
}

/**
 * AppServerProcessManager：封装 codex app-server 子进程。
 *
 * 本类直接依赖 child_process，因此只能在 Node/Electron main/runtime 中实例化；
 * 单元测试通过直接构造 fixture JSONL 驱动 EventMapper 而绕过本类。
 */
export class AppServerProcessManager implements AppServerProcessLike {
  private readonly child: ChildProcess;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly stdoutLineHandlers = new Set<(line: string) => void>();
  private readonly stderrLineHandlers = new Set<(line: string) => void>();
  private readonly exitHandlers = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private exited = false;

  constructor(options: AppServerSpawnOptions) {
    const args = options.args ?? ["app-server"];
    this.child = spawn(options.command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout?.on("data", (chunk: Buffer | string) => {
      this.stdoutBuffer += chunk.toString();
      let idx: number;
      while ((idx = this.stdoutBuffer.indexOf("\n")) >= 0) {
        const line = this.stdoutBuffer.slice(0, idx);
        this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
        if (line.length > 0) {
          for (const h of this.stdoutLineHandlers) {
            try { h(line); } catch { /* swallow */ }
          }
        }
      }
    });

    this.child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrBuffer += chunk.toString();
      let idx: number;
      while ((idx = this.stderrBuffer.indexOf("\n")) >= 0) {
        const line = this.stderrBuffer.slice(0, idx);
        this.stderrBuffer = this.stderrBuffer.slice(idx + 1);
        if (line.length > 0) {
          for (const h of this.stderrLineHandlers) {
            try { h(line); } catch { /* swallow */ }
          }
        }
      }
    });

    this.child.on("exit", (code, signal) => {
      this.exited = true;
      // flush 剩余 buffer（无换行结尾的部分）
      if (this.stdoutBuffer.length > 0) {
        for (const h of this.stdoutLineHandlers) {
          try { h(this.stdoutBuffer); } catch { /* swallow */ }
        }
        this.stdoutBuffer = "";
      }
      if (this.stderrBuffer.length > 0) {
        for (const h of this.stderrLineHandlers) {
          try { h(this.stderrBuffer); } catch { /* swallow */ }
        }
        this.stderrBuffer = "";
      }
      for (const h of this.exitHandlers) {
        try { h(code, signal); } catch { /* swallow */ }
      }
    });

    this.child.on("error", (err) => {
      // spawn 错误也作为 stderr 行暴露（简化上层处理）
      for (const h of this.stderrLineHandlers) {
        try { h(`[spawn error] ${err.message}`); } catch { /* swallow */ }
      }
    });
  }

  writeLine(line: string): void {
    if (this.exited) return;
    this.child.stdin?.write(line + "\n");
  }

  onStdoutLine(handler: (line: string) => void): () => void {
    this.stdoutLineHandlers.add(handler);
    return () => { this.stdoutLineHandlers.delete(handler); };
  }

  onStderrLine(handler: (line: string) => void): () => void {
    this.stderrLineHandlers.add(handler);
    return () => { this.stderrLineHandlers.delete(handler); };
  }

  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.exitHandlers.add(handler);
    return () => { this.exitHandlers.delete(handler); };
  }

  get running(): boolean {
    return !this.exited;
  }

  kill(): void {
    if (this.exited) return;
    try {
      this.child.kill("SIGTERM");
      // 2s 后强杀
      setTimeout(() => {
        if (!this.exited) {
          try { this.child.kill("SIGKILL"); } catch { /* already gone */ }
        }
      }, 2000);
    } catch { /* already gone */ }
  }
}
