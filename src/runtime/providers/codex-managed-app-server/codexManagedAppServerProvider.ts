// LLM CLI Bridge — V17-F1 任务 C：CodexManagedAppServerProvider
//
// Managed Codex App-Server Runtime provider（主线）。
//
// 不依赖用户安装 Codex CLI / Codex Desktop App。
// 使用我们管理的 pinned runtime binary（manifest + sha256 + executable）。
//
// 复用 CodexExternalAppServerProvider 的 JSON-RPC client / mapper / approval / session 逻辑。
// 仅覆盖：
//   - providerId: "codex-managed-app-server"
//   - displayName: "Codex managed app-server"
//   - isAvailable: 用 resolver 结果（不调用 codex --version）
//   - getAppServerArgs: 返回 manifest.appServerArgs
//   - constructor: 接受 resolver 结果（runtimePath 作为 command）

import type { ProviderId } from "../../core/types";
import { CodexExternalAppServerProvider } from "../codex-app-server/codexAppServerProvider";
import type { ManagedRuntimeResolverResult } from "./codexManagedRuntimeResolver";

/**
 * CodexManagedAppServerProvider：使用我们管理的 pinned runtime binary。
 *
 * V17-F1 任务 C：主线 provider。
 * - 不读取 settings.codexCommand
 * - 不调用用户 PATH
 * - 不执行 `codex --version`
 * - 使用 CodexManagedRuntimeResolver 返回的 runtimePath
 * - 启动 app-server：command = runtimePath, args = manifest.appServerArgs
 *
 * 复用父类 CodexExternalAppServerProvider 的全部 JSON-RPC / mapper / approval / session 逻辑。
 * 本轮 manifest.fixture=true，fixture runtime 不是真实 app-server；
 * resolver 通过 sha256/executable 校验后，isAvailable 返回 true，
 * 但 run() 会因 fixture runtime 不支持 JSON-RPC 而失败（fixture-only，不标 user-ready）。
 */
export class CodexManagedAppServerProvider extends CodexExternalAppServerProvider {
  // V17-F1 任务 C：覆盖父类 providerId
  readonly providerId: ProviderId = "codex-managed-app-server";
  readonly displayName = "Codex managed app-server";

  private readonly resolverResult: ManagedRuntimeResolverResult;
  private readonly managedAppServerArgs: string[];

  constructor(
    resolverResult: ManagedRuntimeResolverResult,
    appServerArgs: string[] = ["app-server"],
  ) {
    // 父类 constructor 接受 codexCommand；这里传入 runtimePath（或 unavailable 占位）
    super(
      false,
      resolverResult.available && resolverResult.runtimePath
        ? resolverResult.runtimePath
        : "codex-managed-runtime-unavailable",
    );
    this.resolverResult = resolverResult;
    this.managedAppServerArgs = appServerArgs.length > 0 ? appServerArgs : ["app-server"];
  }

  /**
   * V17-F1 任务 C：用 resolver 结果判断可用性（不调用 codex --version）。
   */
  isAvailable(_cwd: string): boolean {
    return this.resolverResult.available;
  }

  /**
   * V17-F1 任务 C：返回 manifest.appServerArgs（默认 ["app-server"]）。
   */
  protected getAppServerArgs(): string[] {
    return this.managedAppServerArgs;
  }

  /**
   * 暴露 resolver 结果（smoke 报告用）。
   */
  getResolverResult(): ManagedRuntimeResolverResult {
    return this.resolverResult;
  }
}
