# Codex real app-server smoke 报告

- **测试时间**: 2026-07-03T04:29:56.097Z
- **codex 可用**: 否
- **codexVersion**: null
- **schemaSource**: fixture
- **schemaGeneratedAt**: null
- **handshakeStatus**: skip
- **turnStatus**: skip
- **smokeStatus**: skip
- **generatedFiles**: (generate-ts 未运行)
- **schemaHash**: null
- **protocolCapabilities**: null
- **skip 原因**: spawnSync codex ENOENT

## 分层状态说明

- **handshakeStatus** = `pass`：codex --version / generate-ts / app-server spawn / initialize / initialized / thread/start 全部通过。
- **turnStatus** = `pass`：turn/start + turn/completed 通过；`skip-auth`：turn 因 auth/login 不可用而跳过（handshake 仍可 pass）；`fail`：turn 硬失败；`skip-handshake-failed`：handshake fail 时 turn 不执行。
- **smokeStatus**：`skip`=无 codex CLI；`pass`=handshake+turn 全 pass；`handshake-only`=handshake pass 但 turn 非 pass（如 auth 不可用）；`fail`=handshake fail。

**最终结果**: handshake=skip turn=skip smoke=skip

*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*
