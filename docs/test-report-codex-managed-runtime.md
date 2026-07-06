# LLM CLI Bridge 测试报告 — Codex Managed Runtime Smoke (V17-F1 任务 F)

> 本报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成。
> 验证 Managed Codex App-Server Runtime 的 manifest + sha256 + executable。

- **测试时间**: 2026-07-05T19:45:53.648Z
- **runtimeSmokeStatus**: fixture-only
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

## runtimeSmokeStatus 语义

- **pass**: 所有校验通过 + fixture=false（真实 binary，可标 user-ready）
- **fixture-only**: 所有校验通过 + fixture=true（fixture，不是真实 app-server，不标 user-ready）
- **fail**: 任一校验失败

## 校验链

1. manifest 存在且 JSON 合法
2. 当前平台在 manifest.platforms 中
3. runtime binary 文件存在
4. sha256 匹配（防篡改）
5. executable 权限（Windows: .exe/.bat/.cmd；Unix: X_OK）

## V17-F1 任务 G：codexUserReady 主 gate

- codexUserReady 的主 gate 改为 managed runtime gate（runtimeSmokeStatus=pass）
- fixture-only 不标 user-ready（fixture runtime 不支持真实 app-server）
- external 字段保留，但不得影响 codexUserReady

## 运行命令

```bash
npm run smoke:codex-managed-runtime
```

---

*报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成*
