# LLM CLI Bridge 测试报告 — Managed Codex Runtime Smoke (V17-F2)

> 本报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成。
> 验证 production manifest + pinned binary + app-server protocol proof。

- **测试时间**: 2026-07-12T07:53:34.549Z
- **resolverSmokeStatus**: pass
- **runtimeSmokeStatus**: pass
- **managedAppServerProtocolStatus**: pass
- **codexUserReady**: true
- **manifestLoaded**: true
- **manifestVersion**: 0.144.1
- **manifestProtocolVersion**: 2026-07-12
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
- **codexRuntimePinnedVersion**: 0.144.1
- **appServerSpawnStatus**: pass
- **initializeStatus**: pass
- **initializedStatus**: pass
- **threadStartStatus**: pass
- **turnStartStatus**: pass
- **turnCompletedStatus**: pass
- **turnSmokeReady**: pass
- **turnSmokeFailureReason**: null
- **observedFinalAnswer**: "SMOKE_OK"
- **providerWireSmokeStatus**: pass
- **providerWireSmokeFailureReason**: null
- **providerWireObservedFinalAnswer**: "SMOKE_OK"
- **stopCancelStatus**: pass
- **noVaultRootPollution**: true
- **selectedModel**: gpt-5.6-sol
- **binaryDependency**: managed,pinned,bundled
- **authConfigDependency**: user-level Codex/OpenAI credentials or env
- **managedRuntimeReadsUserCodexHome**: true
- **codexHome**: C:\Users\Ye_Luo\.codex
- **reason**: ok
- **error**: null

## 步骤结果

| 状态 | 步骤 | 详情 |
|------|------|------|
| PASS | manifest loaded | version=0.144.1 fixture=false |
| PASS | platform selected | win32-x64 (codex.exe) |
| PASS | runtime binary exists | D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\src\runtime\providers\codex-managed-app-server\runtime\win32-x64\codex.exe |
| PASS | size valid | 341200688 |
| PASS | sha256 valid | cbacbb9726262ef558b4af0438a1b2a5bba9076132401d947b5b4d2bf92ab0e4 |
| PASS | executable valid | - |
| PASS | spawn managed runtime | pid=27072 |
| PASS | initialize | Codex Desktop/0.144.1 (Windows 10.0.26300; x86_64) unknown (llm-cli-bridge-managed-smoke; 17-f2) |
| PASS | initialized | - |
| PASS | model/list | selected=gpt-5.6-sol |
| PASS | thread/start | threadId=019f5551-427c-7b30-8497-322368dac50a |
| PASS | turn/start | - |
| PASS | turn/completed | status=completed |
| PASS | turn smoke (meaningful output + SMOKE_OK) | 4 event(s), final="SMOKE_OK" |
| PASS | clean shutdown / cancel | {"timestamp":"2026-07-12T07:53:37.277140Z","level":"WARN","fields":{"message":"ignoring interface.icon_small: icon path with '..' must resolve under plugin assets/"},"target":"codex_core_skills::loade |
| PASS | no vault root pollution | - |
| PASS | provider-wire smoke: wire shape (text item 无 text_elements, turnStart 无 attachments, threadStart 含 config/instructions + 顶层 wire 字段) | - |
| PASS | provider-wire smoke: spawn | pid=22076 |
| PASS | provider-wire smoke: initialize | Codex Desktop/0.144.1 (Windows 10.0.26300; x86_64) unknown (llm-cli-bridge; 2.17-A) |
| PASS | provider-wire smoke: thread/start | threadId=019f5551-5214-73b0-a933-641ac4b2128d |
| PASS | provider-wire smoke: turn/start | - |
| PASS | provider-wire smoke: turn/completed | status=completed |
| PASS | provider-wire smoke: final answer 含 SMOKE_OK | final="SMOKE_OK" |
| PASS | provider-wire smoke: clean shutdown | - |

## codexUserReady gate

- `codexUserReady=true` 只允许 resolver/runtime/protocol/turnSmoke/providerWire 五层均 pass。
- binary verified != protocol ready != turn smoke ready != provider-wire ready。
- initialized + turn/started + completed(empty) 必须显示为 turn smoke failed。
- turn smoke 必须收到目标 token SMOKE_OK；仅有 item/completed 但无目标文本不得 pass。
- provider-wire smoke 用 buildCodexAppServerRunOptions() 生成真实 payload 验证 wire 兼容性。
- production manifest 下 `skip-fixture` 不允许通过。
- external codex CLI/app-server 不参与本报告 gate。
- 当前 production manifest 仅声明本机已验证平台；`crossPlatformReady=false`，不得表述为 all-platform release-ready。
- Binary dependency 为 managed/pinned/bundled，不依赖用户安装 CLI/App；auth/config 仍依赖可用的 user-level Codex/OpenAI credentials 或环境变量。

```bash
npm run smoke:codex-managed-runtime
```

*报告由 `scripts/codex-managed-runtime-smoke.mjs` 自动生成*
