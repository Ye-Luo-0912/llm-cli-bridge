# LLM CLI Bridge 测试报告 — 汇总（Managed Codex Runtime 主线）

> 本报告由 `scripts/generate-test-summary.mjs` 从 unit/process/codex-smoke 报告解析生成，不手写。
> 详细结果分别见：
> - [docs/test-report-unit.md](./test-report-unit.md) — 单元测试详细结果
> - [docs/test-report-process.md](./test-report-process.md) — 进程测试详细结果
> - [docs/test-report-codex-managed-runtime.md](./test-report-codex-managed-runtime.md) — Managed Codex Runtime smoke
> - [docs/test-report-codex-smoke.md](./test-report-codex-smoke.md) — Codex external app-server smoke（兼容字段）
>
> 报告不互相覆盖：unit/process/managed-runtime/user-package 各自独立生成，summary 仅汇总主线结论。

- **生成时间**: 2026-07-06T05:06:07.590Z
- **reportCommitSha**: 2a7cf1d05ff654d89c5405d8e9bd17cbd6e85c2e
- **reportCommitSha 短**: 2a7cf1d05ff6
- **reportParentSha**: 7540548776e8f70369c8e42f1810d1c11b856431
- **reportParentSha 短**: 7540548776e8
- **testedCodeCommitSha**: 2a7cf1d05ff654d89c5405d8e9bd17cbd6e85c2e
- **testedCodeCommitSha 短**: 2a7cf1d05ff6
- **commitKind**: code commit（报告证明当前 HEAD）
- **unitReportCommitSha**: 2a7cf1d05ff654d89c5405d8e9bd17cbd6e85c2e
- **processReportCommitSha**: 2a7cf1d05ff654d89c5405d8e9bd17cbd6e85c2e
- **codexSmokeStatus**: fail
- **codexHandshakeStatus**: fail
- **codexTurnStatus**: skip
- **codexVersion**: codex-cli 0.142.5
- **codexSchemaSource**: generated
- **codexUserReady**: true
- **codexManagedResolverSmokeStatus**: pass
- **codexManagedRuntimeSmokeStatus**: pass
- **codexManagedAppServerProtocolStatus**: pass
- **codexManagedRuntimeAvailable**: true
- **codexManagedRuntimeVersion**: 0.142.5
- **codexManagedRuntimeSha256Valid**: true
- **codexManagedRuntimeExecutable**: true
- **codexManagedAppServerSpawnStatus**: pass
- **codexSdkAvailable**: false
- **codexEmbeddedRuntimeAvailable**: false
- **codexSdkAuthAvailable**: false
- **codexExternalExecutableAvailable**: true
- **externalAppServerSpawnStatus**: pass
- **codexCliAvailable**: true
- **codexAuthAvailable**: unknown
- **appServerSpawnStatus**: pass
- **initializeStatus**: pass
- **threadStartStatus**: pass
- **turnStartStatus**: pass
- **turnCompletedStatus**: pass
- **approvalRequestStatus**: unknown
- **fileChangeRequestStatus**: unknown
- **stopCancelStatus**: pass
- **noVaultRootPollution**: true
- **userPackageStatus**: pass
- **containsPiSdk**: true
- **canRequirePiSdk**: true
- **canLoadMainJs**: true
- **noRootPackageJson**: true
- **userNeedsNpmInstall**: false
- **containsCodexManagedRuntime**: true
- **codexRuntimeSha256Valid**: true
- **codexRuntimeExecutable**: true
- **codexRuntimePinnedVersion**: 0.142.5
- **codexRuntimeFixture**: false
- **userPackageSizeMB**: 406
- **unit 运行命令**: node scripts/run-tests.mjs --unit
- **process 运行命令**: node scripts/run-tests.mjs --process
- **unit 测试时间**: 2026-07-06T05:04:19.336Z
- **process 测试时间**: 2026-07-06T05:04:58.686Z

## testedCodeCommitSha 语义说明

- **docs-only commit**（当前 commit 只修改 `docs/test-report*.md`）：`testedCodeCommitSha = reportParentSha`，即报告证明的是父 commit（代码 commit）的测试结果。
- **code commit**（当前 commit 修改 `src/` / `scripts/` / `package.json` / `schema/` 等主线文件）：`testedCodeCommitSha = reportCommitSha`（= HEAD），报告必须证明当前 commit。
- **本次判定**：code commit（报告证明当前 HEAD）；testedCodeCommitSha=2a7cf1d05ff6。
- **当前 commit 改动文件**：.gitignore, scripts/build-user-package.mjs, scripts/codex-app-server-smoke.mjs, scripts/codex-managed-runtime-smoke.mjs, scripts/generate-test-summary.mjs, scripts/install-codex-managed-runtime.mjs, scripts/run-tests.mjs, scripts/user-package-smoke.mjs, src/runtime/providers/codex-managed-app-server/codexManagedRuntimeResolver.ts, src/runtime/providers/codex-managed-app-server/runtime-manifest.fixture.json, src/runtime/providers/codex-managed-app-server/runtime-manifest.json, src/types.ts, src/view.ts

## 主线结论

| 轨道 | 通过 | 失败 | 跳过 | 需人工 | 总计 | commit sha | 主线状态 |
|------|------|------|------|--------|------|------------|----------|
| unit | 1027 | 0 | 25 | 0 | 1052 | 2a7cf1d05ff6 | ✅ 通过 |
| process | 97 | 0 | 56 | 0 | 153 | 2a7cf1d05ff6 | ✅ 通过 |
| codex-smoke | - | - | - | - | - | codex-cli 0. | ❌ 失败 |
| **合计** | **1124** | **0** | **81** | **0** | **1205** | 2a7cf1d05ff6 | ✅ **主线通过** |

**双轨均 0 失败 + Managed Codex Runtime smoke pass → Managed Codex Runtime 主线通过。**

## 审计模式说明（P2 integrity check）

- **testedCodeCommitSha 语义**：docs-only commit → = parentSha；code commit → = HEAD。unit/process 报告 sha 必须 === testedCodeCommitSha。
- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。
- 本轮 unit 轨道：uncaughtException = 0，unhandledRejection = 0
- 本轮 process 轨道：uncaughtException = 0，unhandledRejection = 0
- **Managed Codex Runtime gate**：resolver/runtime/protocol/codexUserReady 必须全部通过；external codexSmokeStatus 仅保留为兼容字段，不影响审计。
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
