# Codex real app-server smoke 报告

- **测试时间**: 2026-07-13T17:19:05.924Z
- **codex 可用**: 是
- **codexVersion**: codex-cli 0.144.1
- **schemaSource**: generated
- **schemaGeneratedAt**: 2026-07-13T17:18:33.244Z
- **handshakeStatus**: fail
- **turnStatus**: skip-handshake-failed
- **smokeStatus**: fail
- **codexUserReady**: false
- **generatedFiles**: 87
- **schemaHash**: 53de0275a71ed95d
- **protocolCapabilities**: {"wireJsonrpcOmitted":true,"initializeHandshake":true,"threadResume":true,"itemDeltas":["item/agentMessage/delta","item/reasoning/summaryTextDelta","item/reasoning/textDelta","item/commandExecution/outputDelta","item/plan/delta","item/fileChange/outputDelta"],"approvalDecisions":["accept","acceptForSession","acceptWithExecpolicyAmendment","applyNetworkPolicyAmendment","decline","cancel"],"serverInitiatedRequests":["item/commandExecution/requestApproval","item/fileChange/requestApproval","item/tool/requestUserInput"]}

## Readiness Matrix (V17-F1.1 任务 E — 25 字段)

### V17-F1.1 新增 Managed runtime 分层字段（主 gate）

- **codexManagedResolverSmokeStatus**: pass
- **codexManagedRuntimeSmokeStatus**: pass
- **codexManagedAppServerProtocolStatus**: pass

### V17-F1 Managed runtime 主线字段

- **codexManagedRuntimeAvailable**: true
- **codexManagedRuntimeVersion**: 0.144.1
- **codexManagedRuntimeSha256Valid**: true
- **codexManagedRuntimeExecutable**: true
- **codexManagedAppServerSpawnStatus**: pass

### V17-F0 SDK 字段（保留，非主 gate；本轮占位 false）

- **codexSdkAvailable**: false
- **codexEmbeddedRuntimeAvailable**: false
- **codexSdkAuthAvailable**: false

### V17-F0 External fallback 字段（不得作为 user-ready 主 gate）

- **codexExternalExecutableAvailable**: true
- **externalAppServerSpawnStatus**: pass

### V17-E1 旧字段（保留兼容，非主 gate）

- **codexCliAvailable**: true
- **codexVersion**: codex-cli 0.144.1
- **codexAuthAvailable**: unknown
- **appServerSpawnStatus**: pass
- **initializeStatus**: pass
- **threadStartStatus**: fail
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

## Generated schema manifest 摘要（task 4）

- generate-ts 写入临时目录，**不覆盖 fixture schema**；fixture/generated/compat mapper 三层保持清晰。
- fixture schema（`src/.../schema/manifest.json`，`source=fixture`）为默认测试基线。
- generated schema 仅在显式运行 `npm run codex:schema` 时覆盖 fixture。
- compat mapper（EventMapper/SessionMapper/ApprovalMapper）对齐 fixture 与 generated 共有 wire shape。

## 步骤结果

| 阶段 | 状态 | 步骤 | 详情 |
|------|------|------|------|
| handshake | ✅ | codex app-server generate-ts | generatedFiles=87 hash=53de0275a71ed95d |
| handshake | ✅ | codex app-server stdio 启动 | pid=44952 |
| handshake | ✅ | initialize / result | userAgent=llm-cli-bridge-smoke/0.144.1 (Windows 10.0.26300; x86_64) dumb (llm-cli-bridge-smoke; 2.17.0-a) |
| handshake | ✅ | initialized notification | - |
| handshake | ❌ | thread/start | JSON-RPC request "model/list" timeout (id=2) |

**最终结果**: handshake=fail turn=skip-handshake-failed smoke=fail codexUserReady=false

*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*
