// LLM CLI Bridge — V17-F1 任务 C + V17-F1.1 任务 B：CodexManagedAppServerProvider
//
// Managed Codex App-Server Runtime provider（主线）。
//
// 不依赖用户安装 Codex CLI / Codex Desktop App。
// 使用我们管理的 pinned runtime binary（manifest + sha256 + executable）。
//
// 复用 CodexExternalAppServerProvider 的 JSON-RPC client / mapper / approval / session 逻辑。
// V17-F1.1 任务 B：通过 super() 参数注入 providerId/displayName/appServerArgs，
// 确保父类 constructor 创建的 mappers 捕获正确的 providerId="codex-managed-app-server"。

import type { ProviderId } from "../../core/types";
import { CodexExternalAppServerProvider } from "../codex-app-server/codexAppServerProvider";
import type { ManagedRuntimeResolverResult } from "./codexManagedRuntimeResolver";

/**
 * CodexManagedAppServerProvider：使用我们管理的 pinned runtime binary。
 *
 * V17-F1 任务 C：主线 provider。
 * V17-F1.1 任务 B：providerId 通过 super() 参数注入，不再通过 field override。
 *
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
  private readonly resolverResult: ManagedRuntimeResolverResult;

  constructor(
    resolverResult: ManagedRuntimeResolverResult,
    appServerArgs: string[] = ["app-server"],
    pluginDir: string = "",
  ) {
    // V17-F1.1 任务 B：通过 super() 参数注入 providerId/displayName/appServerArgs
    // 父类 constructor 用这些参数创建 mappers，确保 approvalMapper 捕获正确的 providerId
    super(
      false, // developerMode 由 run() 内部根据 settings 注入
      resolverResult.available && resolverResult.runtimePath
        ? resolverResult.runtimePath
        : "codex-managed-runtime-unavailable",
      "codex-managed-app-server" as ProviderId, // providerId
      "Codex managed app-server", // displayName
      appServerArgs.length > 0 ? appServerArgs : ["app-server"], // appServerArgs
      pluginDir, // V20-RG: 传入真实插件目录
    );
    this.resolverResult = resolverResult;
  }

  /**
   * V17-F1 任务 C：用 resolver 结果判断可用性（不调用 codex --version）。
   */
  isAvailable(_cwd: string): boolean {
    return this.resolverResult.available;
  }

  /**
   * 暴露 resolver 结果（smoke 报告用）。
   */
  getResolverResult(): ManagedRuntimeResolverResult {
    return this.resolverResult;
  }
}
