# LLM CLI Bridge 测试报告 — Codex Real Obsidian Runtime UX Smoke (V17-G Native Run UI)

> 本报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成。
> 它只在真实 Obsidian 通过 CDP 暴露时记录真实 UI 观察；CDP 不可用时明确 skip，不把合成 smoke 伪装为真实 UI pass。

- **测试时间**: 2026-07-08T14:45:39.114Z
- **testedCodeCommitSha**: c9689cf37a274594ff6afd01e52be7080117ac64
- **realObsidianRuntimeUxStatus**: partial
- **realObsidianSmokeStatus**: partial
- **cdpStatus**: connected-probe-timeout
- **cdpBase**: http://127.0.0.1:9223
- **cdpJsonReachable**: true
- **cdpVersionReachable**: true
- **cdpTargetTitle**: 10_学习 - LLM-Wiki - Obsidian 1.12.7
- **cdpTargetUrl**: app://obsidian.md/index.html
- **skipReason**: cdp-eval-timeout
- **skipDetail**: Runtime.evaluate timed out after 240000ms
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
- **runtimeInstallResultStatus**: null
- **runtimeInstallSource**: null
- **runtimeInstallTarballSha256Valid**: false
- **runtimeInstallBinarySha256Valid**: false
- **runtimeInstallBinarySizeValid**: false
- **runtimeInstallExecutable**: false
- **providerLabelAfterInstall**: null
- **installFailureRetryCopyObserved**: false
- **uiSmokeRunStatus**: null
- **uiSmokeApprovalCount**: 0
- **uiSmokeTargetFile**: null
- **uiSmokeFileToken**: null
- **uiSmokeFinalAnswer**: null
- **commandTimelineObserved**: false
- **fileEditTimelineObserved**: false
- **approvalCardObserved**: false
- **diffCardObserved**: false
- **codexRunHeaderObserved**: false
- **codexRunWaterfallFeedObserved**: false
- **codexRunFeedBatchObserved**: false
- **codexRunFeedBatchCount**: 0
- **codexRunFeedItemCount**: 0
- **codexRunNestedEventCount**: 0
- **codexRunFeedSequence**: null
- **codexRunThinkingCarrierObserved**: false
- **codexRunThinkingCarrierStatus**: null
- **codexRunOutputLabelCompact**: false
- **changesPanelVisible**: false
- **stepRowCount**: 0
- **approvalGateVisibleWhenPending**: false

## Timeline UX Evidence

- **diagnosticsCollapsedByDefault**: false
- **commandOutputCollapsedInNormalMode**: false
- **codexRunCommandShellPanelAvailable**: false
- **codexRunShellOutputMerged**: false
- **normalModeCommandSummaryPathRedacted**: false
- **messageRenderFailureAbsent**: false
- **developerRawEventAccessibleFromRunView**: false
- **finalAnswerVisuallySeparated**: false
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
- **defaultPackageSizeMB**: 98.4
- **offlineWin32X64PackageOptional**: true
- **offlineWin32X64PackageSizeMB**: not-built
- **offlineWin32X64ContainsRuntimeBinary**: false
- **offlineWin32X64Sha256Verified**: false
- **offlineWin32X64ExecutableVerified**: false
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
| offline win32-x64 package optional or verified | pass | not-built |
| all-platform fat package absent | pass |  |
| install retry/error copy present | pass |  |
| normal user verbose output collapsed | pass |  |
| normal user raw sourceRef hidden | pass |  |
| developer mode sourceRef visible | pass |  |
| turn/diff/updated hidden from normal timeline | pass |  |
| turn/diff/updated visible in developer evidence | pass |  |
| real Obsidian CDP probe completed | fail | Runtime.evaluate timed out after 240000ms |

## Known Gaps

- userInput not-observed in real Codex managed protocol smoke
- non-win32-x64 platforms are not verified in this workspace
- Codex runtime authentication depends on user-level Codex/OpenAI credentials or environment
- telemetry methods are observed for developer/debug status only and do not enter the normal user timeline

## Errors

- CDP probe timed out: Runtime.evaluate timed out after 240000ms

## 运行命令

```bash
npm run smoke:codex-real-obsidian-runtime-ux
```

*报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成*
