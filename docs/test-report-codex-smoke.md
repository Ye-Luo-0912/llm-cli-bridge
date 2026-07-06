# Codex real app-server smoke 报告

- **测试时间**: 2026-07-06T01:36:38.185Z
- **codex 可用**: 否
- **codexVersion**: null
- **schemaSource**: fixture
- **schemaGeneratedAt**: null
- **handshakeStatus**: skip
- **turnStatus**: skip
- **smokeStatus**: skip
- **codexUserReady**: false
- **generatedFiles**: (generate-ts 未运行)
- **schemaHash**: null
- **protocolCapabilities**: null
- **skip 原因**: spawnSync codex ENOENT

## Readiness Matrix (V17-F1.1 任务 E — 25 字段)

### V17-F1.1 新增 Managed runtime 分层字段（主 gate）

- **codexManagedResolverSmokeStatus**: pass
- **codexManagedRuntimeSmokeStatus**: fixture-only
- **codexManagedAppServerProtocolStatus**: skip-fixture

### V17-F1 Managed runtime 主线字段

- **codexManagedRuntimeAvailable**: true
- **codexManagedRuntimeVersion**: 0.1.0-fixture
- **codexManagedRuntimeSha256Valid**: true
- **codexManagedRuntimeExecutable**: true
- **codexManagedAppServerSpawnStatus**: fixture-only

### V17-F0 SDK 字段（保留，非主 gate；本轮占位 false）

- **codexSdkAvailable**: false
- **codexEmbeddedRuntimeAvailable**: false
- **codexSdkAuthAvailable**: false

### V17-F0 External fallback 字段（不得作为 user-ready 主 gate）

- **codexExternalExecutableAvailable**: false
- **externalAppServerSpawnStatus**: unknown

### V17-E1 旧字段（保留兼容，非主 gate）

- **codexCliAvailable**: false
- **codexVersion**: null
- **codexAuthAvailable**: unknown
- **appServerSpawnStatus**: unknown
- **initializeStatus**: unknown
- **threadStartStatus**: unknown
- **turnStartStatus**: unknown
- **turnCompletedStatus**: fail
- **approvalRequestStatus**: unknown
- **fileChangeRequestStatus**: unknown
- **stopCancelStatus**: unknown
- **noVaultRootPollution**: true

## 分层状态说明

- **handshakeStatus** = `pass`：codex --version / generate-ts / app-server spawn / initialize / initialized / thread/start 全部通过。
- **turnStatus** = `pass`：turn/start + turn/completed 通过；`skip-auth`：turn 因 auth/login 不可用而跳过（handshake 仍可 pass）；`fail`：turn 硬失败；`skip-handshake-failed`：handshake fail 时 turn 不执行。
- **smokeStatus**：`skip`=无 codex CLI；`pass`=handshake+turn 全 pass；`handshake-only`=handshake pass 但 turn 非 pass（如 auth 不可用）；`fail`=handshake fail。
- **codexUserReady**：`true` 仅当分层 gate 通过（resolverSmokeStatus=pass + runtimeSmokeStatus=pass + managedAppServerProtocolStatus=pass）且 smoke=pass 且关键 matrix 字段（appServerSpawn/initialize/threadStart/turnStart/turnCompleted/stopCancel/noVaultRootPollution）均 pass/true。fixture-only（runtimeSmokeStatus=fixture-only）不算 ready。`not-triggered` 的 approval/fileChange 不阻塞 ready。external app-server pass 不影响 codexUserReady。

**最终结果**: handshake=skip turn=skip smoke=skip codexUserReady=false

*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*
