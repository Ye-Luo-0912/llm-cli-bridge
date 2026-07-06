# LLM CLI Bridge 测试报告 — Codex Real Obsidian Runtime UX Smoke (V17-F6 RC Hardening)

> 本报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成。
> 它只在真实 Obsidian 通过 CDP 暴露时记录真实 UI 观察；CDP 不可用时明确 skip，不把合成 smoke 伪装为真实 UI pass。

- **测试时间**: 2026-07-06T14:00:55.983Z
- **testedCodeCommitSha**: 3ac798b779c5e537a70ce394ba23d4289c9639a4
- **realObsidianRuntimeUxStatus**: pass
- **realObsidianSmokeStatus**: pass
- **cdpStatus**: connected
- **cdpBase**: http://127.0.0.1:9223
- **cdpJsonReachable**: true
- **cdpVersionReachable**: true
- **cdpTargetTitle**: 新标签页 - LLM-Wiki - Obsidian 1.12.7
- **cdpTargetUrl**: app://obsidian.md/index.html
- **skipReason**: null
- **skipDetail**: null
- **obsidianLaunchHint**: Start Obsidian with --remote-debugging-port=9223 and verify http://127.0.0.1:9223/json is reachable.

## CDP Environment Entry

- Start Obsidian with: `Obsidian.exe --remote-debugging-port=9223`
- Verify CDP target list: `http://127.0.0.1:9223/json`
- Expected skip reasons: `cdp-port-unreachable`, `no-obsidian-target`, `plugin-not-loaded`, `bridge-view-not-open`

## Runtime UX Observations

- **firstOpenDefaultPackageObserved**: true
- **runtimeMissingInstallRequiredObserved**: true
- **installSuccessProviderReadyObserved**: true
- **installButtonMetadataComplete**: true
- **runtimeInstallResultStatus**: installed
- **runtimeInstallSource**: download
- **runtimeInstallTarballSha256Valid**: true
- **runtimeInstallBinarySha256Valid**: true
- **runtimeInstallBinarySizeValid**: true
- **runtimeInstallExecutable**: true
- **providerLabelAfterInstall**: Codex managed
- **installFailureRetryCopyObserved**: true
- **uiSmokeRunStatus**: completed
- **uiSmokeApprovalCount**: 1
- **uiSmokeFinalAnswer**: 先执行你指定的命令烟雾测试，然后用 `apply_patch` 创建或更新目标 Markdown 文件为单行内容。开始修改 `[_llm_bridge_smoke/v17-f6-obsidian-smoke.md](D:/Users/Ye_Luo/APP/Test/Obsidian/LLM-Wiki/_llm_bridge_smoke/v17-f6-obsidian-smoke.md)`，只保留你要求的单行内容。done
- **commandTimelineObserved**: true
- **fileEditTimelineObserved**: true
- **approvalCardObserved**: true
- **diffCardObserved**: true

## Timeline UX Evidence

- **normalUserVerboseOutputDefaultCollapsed**: true
- **normalUserRawJsonSourceRefHidden**: true
- **developerModeSourceRefVisible**: true
- **turnDiffUpdatedNormalHidden**: true
- **turnDiffUpdatedDeveloperVisible**: true
- **normalModeRawSourceRefAbsentInDom**: true
- **developerDebugViewAccessible**: true
- **developerRawProviderEventAccessible**: true

## Release Packaging Readiness

- **releasePackageMode**: download-on-first-run
- **containsRuntimeBinary**: false
- **runtimeDownloadRequired**: true
- **runtimePinnedArtifactMetadataComplete**: true
- **runtimeInstallerPresent**: true
- **runtimeInstallRequiresSystemNpm**: false
- **runtimeInstallRequiresSystemTar**: false
- **defaultPackageSizeMB**: 97.9
- **offlineWin32X64PackageOptional**: true
- **offlineWin32X64PackageSizeMB**: 406.1
- **offlineWin32X64ContainsRuntimeBinary**: true
- **offlineWin32X64Sha256Verified**: true
- **offlineWin32X64ExecutableVerified**: true
- **allPlatformFatPackageAbsent**: true
- **noDistRuntimeTempFiles**: true
- **installationRetryErrorCopyPresent**: true

## Checks

| Check | Status | Detail |
| --- | --- | --- |
| default package uses download-on-first-run | pass | download-on-first-run |
| default package does not include runtime binary | pass | containsRuntimeBinary=false |
| runtime download required for default package | pass | runtimeDownloadRequired=true |
| runtime installer metadata complete | pass |  |
| installer does not require system npm | pass |  |
| installer does not require system tar | pass |  |
| dist/runtime temp files absent from package boundary | pass |  |
| offline win32-x64 package optional or verified | pass | sizeMB=406.1 sha=true executable=true |
| all-platform fat package absent | pass |  |
| install retry/error copy present | pass |  |
| normal user verbose output collapsed | pass |  |
| normal user raw sourceRef hidden | pass |  |
| developer mode sourceRef visible | pass |  |
| turn/diff/updated hidden from normal timeline | pass |  |
| turn/diff/updated visible in developer evidence | pass |  |
| real Obsidian plugin and bridge view loaded | pass | auto |
| runtime missing surfaces install required | pass | Codex managed · ready |
| install button metadata title complete | pass | Runtime version: 0.142.5 Download size: 308.2 MB Source: https://registry.npmjs.org/@openai/codex/-/codex-0.142.5-win32-x64.tgz SHA-256: 645f5a1a0347abb2b31fae4e594c198ad00e3a4b4a999dcfa3a66c0d0f8cd43b Install path: D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge\codex-managed-runtime\runtime\win32-x64\codex.exe Status: path-not-exist Error: runtime binary not found: D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge\codex-managed-runtime\runtime\win32-x64\codex.exe |
| runtime installer verified tarball/binary in Obsidian | pass | status=installed source=download |
| install success surfaces provider ready | pass | Codex managed |
| real Obsidian Codex UI smoke run completed | pass | 先执行你指定的命令烟雾测试，然后用 `apply_patch` 创建或更新目标 Markdown 文件为单行内容。开始修改 `[_llm_bridge_smoke/v17-f6-obsidian-smoke.md](D:/Users/Ye_Luo/APP/Test/Obsidian/LLM-Wiki/_llm_bridge_smoke/v17-f6-obsidian-smoke.md)`，只保留你要求的单行内容。done |
| real Obsidian command timeline observed | pass |  |
| real Obsidian file edit timeline observed | pass |  |
| real Obsidian approval card observed | pass |  |
| real Obsidian diff card observed | pass |  |
| real Obsidian normal mode raw sourceRef absent | pass |  |
| real Obsidian developer debug view/sourceRef accessible | pass |  |
| real Obsidian developer raw provider event accessible | pass |  |

## Known Gaps

- userInput not-observed in real Codex managed protocol smoke
- non-win32-x64 platforms are not verified in this workspace
- Codex runtime authentication depends on user-level Codex/OpenAI credentials or environment
- telemetry methods are observed for developer/debug status only and do not enter the normal user timeline

## Errors

- null

## 运行命令

```bash
npm run smoke:codex-real-obsidian-runtime-ux
```

*报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成*
