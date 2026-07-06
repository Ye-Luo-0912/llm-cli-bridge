# LLM CLI Bridge 测试报告 — Codex Managed Runtime Smoke (V17-F1.1 任务 E)

> 本报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成。
> 验证 Managed Codex App-Server Runtime 的 manifest + sha256 + executable。
> V17-F1.1 任务 E：分层字段（resolverSmokeStatus / runtimeSmokeStatus / managedAppServerProtocolStatus）。

- **测试时间**: 2026-07-06T01:36:06.662Z
- **resolverSmokeStatus**: pass
- **runtimeSmokeStatus**: fixture-only
- **managedAppServerProtocolStatus**: skip-fixture
- **manifestLoaded**: true
- **manifestVersion**: 0.1.0-fixture
- **manifestProtocolVersion**: 2025-07-06
- **manifestFixture**: true
- **platformSelected**: true
- **platformKey**: win32-x64
- **runtimePath**: D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\src\runtime\providers\codex-managed-app-server\runtime\win32-x64\codex-app-server-fake.bat
- **pathExists**: true
- **sha256Valid**: true
- **executableValid**: true
- **codexRuntimePinnedVersion**: 0.1.0-fixture
- **reason**: ok
- **error**: null

## V17-F1.1 任务 E：分层字段语义

### resolverSmokeStatus (pass/fail)
- **pass**: resolver 校验链全部通过（manifest 存在 + JSON 合法 + 平台匹配 + binary 存在 + sha256 + executable）
- **fail**: 任一校验失败

### runtimeSmokeStatus (pass/fixture-only/fail/skip)
- **pass**: 真实 binary（fixture=false），可标 user-ready
- **fixture-only**: fixture binary（fixture=true），不是真实 app-server，不标 user-ready
- **skip**: resolver 失败，无法判断 runtime
- **fail**: resolver 通过但 runtime 不可用（保留扩展位）

### managedAppServerProtocolStatus (pass/skip-fixture/fail)
- **pass**: 真实 binary 的 app-server 协议可用（initialize/thread/turn pass）
- **skip-fixture**: fixture runtime 不支持真实 app-server，协议层跳过
- **fail**: 协议层失败（后续真实 binary 接入后）

## 校验链

1. manifest 存在且 JSON 合法
2. 当前平台在 manifest.platforms 中
3. runtime binary 文件存在
4. sha256 匹配（防篡改）
5. executable 权限（Windows: .exe/.bat/.cmd；Unix: X_OK）

## V17-F1 任务 G：codexUserReady 主 gate

- codexUserReady 的主 gate 改为 managed runtime gate
- 条件：resolverSmokeStatus=pass + runtimeSmokeStatus=pass + managedAppServerProtocolStatus=pass
- fixture-only（runtimeSmokeStatus=fixture-only）不标 user-ready
- external 字段保留，但不得影响 codexUserReady

## 运行命令

```bash
npm run smoke:codex-managed-runtime
```

---

*报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成*
