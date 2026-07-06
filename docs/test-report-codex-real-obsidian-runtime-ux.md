# LLM CLI Bridge 测试报告 — Codex Real Obsidian Runtime UX Smoke (V17-F6 RC Hardening)

> 本报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成。
> 它只在真实 Obsidian 通过 CDP 暴露时记录真实 UI 观察；CDP 不可用时明确 skip，不把合成 smoke 伪装为真实 UI pass。

- **测试时间**: 2026-07-06T13:27:32.617Z
- **testedCodeCommitSha**: afe723cde957d3c3ef68097064f5cde8bbf21d0c
- **realObsidianRuntimeUxStatus**: skip-cdp-unavailable
- **realObsidianSmokeStatus**: skip-cdp-unavailable
- **cdpStatus**: skip-cdp-unavailable
- **cdpBase**: http://127.0.0.1:9223
- **cdpJsonReachable**: false
- **cdpVersionReachable**: false
- **cdpTargetTitle**: null
- **cdpTargetUrl**: null
- **skipReason**: cdp-port-unreachable
- **skipDetail**: fetch failed
- **obsidianLaunchHint**: Start Obsidian with --remote-debugging-port=9223 and verify http://127.0.0.1:9223/json is reachable.

## CDP Environment Entry

- Start Obsidian with: `Obsidian.exe --remote-debugging-port=9223`
- Verify CDP target list: `http://127.0.0.1:9223/json`
- Expected skip reasons: `cdp-port-unreachable`, `no-obsidian-target`, `plugin-not-loaded`, `bridge-view-not-open`

## Runtime UX Observations

- **firstOpenDefaultPackageObserved**: false
- **runtimeMissingInstallRequiredObserved**: false
- **installSuccessProviderReadyObserved**: false
- **installButtonMetadataComplete**: false
- **providerLabelAfterInstall**: null
- **installFailureRetryCopyObserved**: false
- **commandTimelineObserved**: false
- **fileEditTimelineObserved**: false
- **approvalCardObserved**: false
- **diffCardObserved**: false

## Timeline UX Evidence

- **normalUserVerboseOutputDefaultCollapsed**: true
- **normalUserRawJsonSourceRefHidden**: true
- **developerModeSourceRefVisible**: true
- **turnDiffUpdatedNormalHidden**: true
- **turnDiffUpdatedDeveloperVisible**: true
- **normalModeRawSourceRefAbsentInDom**: false
- **developerDebugViewAccessible**: false
- **developerRawProviderEventAccessible**: false

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
