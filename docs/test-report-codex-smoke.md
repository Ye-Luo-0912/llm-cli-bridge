# Codex real app-server smoke 报告

- **测试时间**: 2026-07-05T18:27:51.129Z
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

## Readiness Matrix (V17-E1 任务 E — 12 字段)

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
- **codexUserReady**：`true` 仅当 smokeStatus=pass 且关键 matrix 字段（appServerSpawn/initialize/threadStart/turnStart/turnCompleted/stopCancel/noVaultRootPollution）均 pass/true。`not-triggered` 的 approval/fileChange 不阻塞 ready（agent 可能不需要审批）。

**最终结果**: handshake=skip turn=skip smoke=skip codexUserReady=false

*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*
