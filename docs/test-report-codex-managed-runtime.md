# LLM CLI Bridge 测试报告 — Managed Codex Runtime Smoke (V17-F2)

> 本报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成。
> 验证 production manifest + pinned binary + app-server protocol proof。

- **测试时间**: 2026-07-06T16:42:40.007Z
- **resolverSmokeStatus**: pass
- **runtimeSmokeStatus**: pass
- **managedAppServerProtocolStatus**: pass
- **codexUserReady**: true
- **manifestLoaded**: true
- **manifestVersion**: 0.142.5
- **manifestProtocolVersion**: 2026-07-06
- **manifestFixture**: false
- **supportedPlatforms**: win32-x64
- **testedPlatform**: win32-x64
- **crossPlatformReady**: false
- **platformSelected**: true
- **platformKey**: win32-x64
- **runtimePath**: D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\src\runtime\providers\codex-managed-app-server\runtime\win32-x64\codex.exe
- **pathExists**: true
- **sizeValid**: true
- **sha256Valid**: true
- **executableValid**: true
- **codexRuntimePinnedVersion**: 0.142.5
- **appServerSpawnStatus**: pass
- **initializeStatus**: pass
- **initializedStatus**: pass
- **threadStartStatus**: pass
- **turnStartStatus**: pass
- **turnCompletedStatus**: pass
- **stopCancelStatus**: pass
- **noVaultRootPollution**: true
- **selectedModel**: gpt-5.5
- **binaryDependency**: managed,pinned,bundled
- **authConfigDependency**: user-level Codex/OpenAI credentials or env
- **managedRuntimeReadsUserCodexHome**: true
- **codexHome**: C:\Users\Ye_Luo\.codex
- **reason**: ok
- **error**: null

## 步骤结果

| 状态 | 步骤 | 详情 |
|------|------|------|
| PASS | manifest loaded | version=0.142.5 fixture=false |
| PASS | platform selected | win32-x64 (codex.exe) |
| PASS | runtime binary exists | D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\src\runtime\providers\codex-managed-app-server\runtime\win32-x64\codex.exe |
| PASS | size valid | 323143472 |
| PASS | sha256 valid | 645f5a1a0347abb2b31fae4e594c198ad00e3a4b4a999dcfa3a66c0d0f8cd43b |
| PASS | executable valid | - |
| PASS | spawn managed runtime | pid=27892 |
| PASS | initialize | Codex Desktop/0.142.5 (Windows 10.0.26300; x86_64) unknown (llm-cli-bridge-managed-smoke; 17-f2) |
| PASS | initialized | - |
| PASS | model/list | selected=gpt-5.5 |
| PASS | thread/start | threadId=019f384f-7b3b-7af2-96f0-4d0aab588e8d |
| PASS | turn/start | - |
| PASS | turn/completed | - |
| PASS | clean shutdown / cancel | {"timestamp":"2026-07-06T16:42:40.969436Z","level":"WARN","fields":{"message":"ignoring interface.defaultPrompt: maximum of 3 prompts is supported","path":"C:\\Users\\Ye_Luo\\.codex\\plugins\\cache\\o |
| PASS | no vault root pollution | - |

## codexUserReady gate

- `codexUserReady=true` 只允许 resolver/runtime/protocol 三层均 pass。
- production manifest 下 `skip-fixture` 不允许通过。
- external codex CLI/app-server 不参与本报告 gate。
- 当前 production manifest 仅声明本机已验证平台；`crossPlatformReady=false`，不得表述为 all-platform release-ready。
- Binary dependency 为 managed/pinned/bundled，不依赖用户安装 CLI/App；auth/config 仍依赖可用的 user-level Codex/OpenAI credentials 或环境变量。

```bash
npm run smoke:codex-managed-runtime
```

*报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成*
