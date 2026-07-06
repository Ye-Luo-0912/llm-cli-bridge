# LLM CLI Bridge 测试报告 — 汇总（Managed Codex Runtime 主线）

> 本报告由 `scripts/generate-test-summary.mjs` 从 unit/process/managed-runtime/user-package 报告解析生成，不手写。
> 详细结果分别见：
> - [docs/test-report-unit.md](./test-report-unit.md) — 单元测试详细结果
> - [docs/test-report-process.md](./test-report-process.md) — 进程测试详细结果
> - [docs/test-report-codex-managed-runtime.md](./test-report-codex-managed-runtime.md) — Managed Codex Runtime smoke
>
> 报告不互相覆盖：unit/process/managed-runtime/user-package 各自独立生成，summary 仅汇总主线结论。
> external Codex CLI/app-server 是兼容路径；本 summary 不解析旧 codex-smoke 报告，也不把 external 状态作为主 gate。

- **生成时间**: 2026-07-06T16:44:25.047Z
- **reportCommitSha**: 31d6dd5dd1affd22e2b4afceac2a90e64b77a564
- **reportCommitSha 短**: 31d6dd5dd1af
- **reportParentSha**: 276bead0fe416e8cd1ae6c8f94a96033ffecbbf9
- **reportParentSha 短**: 276bead0fe41
- **testedCodeCommitSha**: 31d6dd5dd1affd22e2b4afceac2a90e64b77a564
- **testedCodeCommitSha 短**: 31d6dd5dd1af
- **commitKind**: code commit（报告证明当前 HEAD）
- **unitReportCommitSha**: 31d6dd5dd1affd22e2b4afceac2a90e64b77a564
- **processReportCommitSha**: 31d6dd5dd1affd22e2b4afceac2a90e64b77a564
- **externalCodexSmokeStatus**: not-evaluated
- **externalCodexHandshakeStatus**: not-evaluated
- **externalCodexCompatibilityStatus**: not-main-gate
- **codexUserReady**: true
- **codexManagedResolverSmokeStatus**: pass
- **codexManagedRuntimeSmokeStatus**: pass
- **codexManagedAppServerProtocolStatus**: pass
- **codexManagedRuntimeAvailable**: true
- **codexManagedRuntimeVersion**: 0.142.5
- **codexManagedRuntimeSha256Valid**: true
- **codexManagedRuntimeExecutable**: true
- **codexManagedAppServerSpawnStatus**: pass
- **supportedPlatforms**: win32-x64
- **testedPlatform**: win32-x64
- **crossPlatformReady**: false
- **binaryDependency**: managed,pinned,bundled
- **authConfigDependency**: user-level Codex/OpenAI credentials or env
- **managedRuntimeReadsUserCodexHome**: true
- **codexHome**: C:\Users\Ye_Luo\.codex
- **initializeStatus**: pass
- **threadStartStatus**: pass
- **turnStartStatus**: pass
- **turnCompletedStatus**: pass
- **stopCancelStatus**: pass
- **noVaultRootPollution**: true
- **userPackageStatus**: pass
- **containsPiSdk**: true
- **canRequirePiSdk**: true
- **canLoadMainJs**: true
- **noRootPackageJson**: true
- **userNeedsNpmInstall**: false
- **containsCodexManagedRuntime**: true
- **codexRuntimeSha256Valid**: false
- **codexRuntimeExecutable**: false
- **codexRuntimePinnedVersion**: 0.142.5
- **codexRuntimeFixture**: false
- **userPackageSizeMB**: 97.9
- **releasePackageMode**: download-on-first-run
- **containsRuntimeBinary**: false
- **runtimeDownloadRequired**: true
- **runtimePinnedArtifactMetadataComplete**: true
- **runtimeInstallerExecutable**: true
- **runtimeInstallSmokeStatus**: pass
- **runtimeInstallSource**: download
- **runtimeRemoteDownloadSmokeStatus**: pass
- **runtimeFirstRunIntegrationStatus**: pass
- **installRequiredSurfaced**: true
- **resolverAfterInstallStatus**: pass
- **providerAfterInstall**: codex-managed-app-server
- **runtimeInstallRequiresSystemNpm**: false
- **runtimeInstallRequiresSystemTar**: false
- **releasePackageContainsCodexRuntime**: true
- **releasePackageSizeMB**: 97.9
- **runtimeBinarySha256Verified**: false
- **unit 运行命令**: node scripts/run-tests.mjs --unit
- **process 运行命令**: node scripts/run-tests.mjs --process
- **unit 测试时间**: 2026-07-06T16:33:53.178Z
- **process 测试时间**: 2026-07-06T16:34:32.836Z

## testedCodeCommitSha 语义说明

- **docs-only commit**（当前 commit 只修改 `docs/test-report*.md`）：`testedCodeCommitSha = reportParentSha`，即报告证明的是父 commit（代码 commit）的测试结果。
- **code commit**（当前 commit 修改 `src/` / `scripts/` / `package.json` / `schema/` 等主线文件）：`testedCodeCommitSha = reportCommitSha`（= HEAD），报告必须证明当前 commit。
- **本次判定**：code commit（报告证明当前 HEAD）；testedCodeCommitSha=31d6dd5dd1af。
- **当前 commit 改动文件**：scripts/codex-real-obsidian-runtime-ux-smoke.mjs, scripts/run-tests.mjs, src/runtime/core/codexRunViewModel.ts, src/timelineAdapter.ts, src/view.ts, styles.css

## 主线结论

| 轨道 | 通过 | 失败 | 跳过 | 需人工 | 总计 | commit sha | 主线状态 |
|------|------|------|------|--------|------|------------|----------|
| unit | 1035 | 0 | 25 | 0 | 1060 | 31d6dd5dd1af | ✅ 通过 |
| process | 97 | 0 | 56 | 0 | 153 | 31d6dd5dd1af | ✅ 通过 |
| managed-runtime | - | - | - | - | - | 0.142.5 | ✅ 通过 |
| **合计** | **1132** | **0** | **81** | **0** | **1213** | 31d6dd5dd1af | ✅ **主线通过** |

**双轨均 0 失败 + Managed Codex Runtime smoke pass → Managed Codex Runtime 主线通过。**

## 审计模式说明（P2 integrity check）

- **testedCodeCommitSha 语义**：docs-only commit → = parentSha；code commit → = HEAD。unit/process 报告 sha 必须 === testedCodeCommitSha。
- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。
- 本轮 unit 轨道：uncaughtException = 0，unhandledRejection = 0
- 本轮 process 轨道：uncaughtException = 0，unhandledRejection = 0
- **Managed Codex Runtime gate**：resolver/runtime/protocol/codexUserReady 必须全部通过；external Codex compatibility 字段不影响审计。
- **平台边界**：当前 production manifest 只声明已验证平台，`crossPlatformReady=false`，不得表述为 all-platform release-ready。
- **依赖边界**：binary 为 managed/pinned/bundled，不依赖用户安装 CLI/App；auth/config 仍需要可用 user-level Codex/OpenAI credentials 或环境变量。
- **Release packaging gate**：dist/user-package 默认包含 manifest + installer/downloader，不打包大 binary；必须能从 pinned artifact 安装，记录包大小。
- **报告过期判定**：若 unit/process 报告的 commit sha 与 testedCodeCommitSha 不一致，说明报告是旧 commit 的结果，必须重新生成。

## 审计结果

✅ **审计通过**：testedCodeCommitSha 一致 + Managed Codex Runtime gate 通过 + uncaught/unhandled 为 0 + 字段解析完整。

## skip 策略与覆盖替代

当前环境 skip 项保留，但每项必须标明原因并有覆盖替代测试。skip 原因分类：

| skip 原因 | 说明 | 覆盖替代 |
|-----------|------|----------|
| 环境假失败（非 Windows） | `cmd /c` 类命令在 Linux 沙箱不可用 | process 轨道的 fixture 测试覆盖等价路径 |
| 模式不匹配 | unit 模式跳过 process/claude/integration 段；process 模式跳过 unit 段 | unit ↔ process 互补：unit 测 mapper/aggregator 纯函数，process 测真实子进程 |
| Obsidian 未运行 | integration 测试需真实 Obsidian HTTP bridge | unit 轨道的 ACTION_SCHEMAS / validateAction 覆盖 schema 验证 |
| claude/codex CLI 不可用 | 沙箱未安装 claude/codex 命令 | Preflight fixture + EventMapper fixture 覆盖协议映射；real codex smoke 在 codex 可用环境运行 `npm run smoke:codex-app-server` |

---

*报告由 `scripts/generate-test-summary.mjs` 自动生成（解析 unit/process/codex-smoke 报告，不手写）*
