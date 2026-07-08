# LLM CLI Bridge 测试报告 — Codex Real Obsidian Runtime UX Smoke (V17-G Native Run UI)

> 本报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成。
> 它只在真实 Obsidian 通过 CDP 暴露时记录真实 UI 观察；CDP 不可用时明确 skip，不把合成 smoke 伪装为真实 UI pass。

- **测试时间**: 2026-07-08T12:33:52.213Z
- **testedCodeCommitSha**: a435971043344f76e455f66ec77f3fd87087d825
- **realObsidianRuntimeUxStatus**: pass
- **realObsidianSmokeStatus**: pass
- **cdpStatus**: connected
- **cdpBase**: http://127.0.0.1:9223
- **cdpJsonReachable**: true
- **cdpVersionReachable**: true
- **cdpTargetTitle**: 10_学习 - LLM-Wiki - Obsidian 1.12.7
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
- **runtimeMissingInstallRequiredObserved**: false
- **installSuccessProviderReadyObserved**: true
- **installButtonMetadataComplete**: true
- **runtimeInstallResultStatus**: null
- **runtimeInstallSource**: null
- **runtimeInstallTarballSha256Valid**: false
- **runtimeInstallBinarySha256Valid**: false
- **runtimeInstallBinarySizeValid**: false
- **runtimeInstallExecutable**: false
- **providerLabelAfterInstall**: Codex managed
- **installFailureRetryCopyObserved**: true
- **uiSmokeRunStatus**: completed
- **uiSmokeApprovalCount**: 2
- **uiSmokeTargetFile**: _llm_bridge_smoke/v17-g-run-ui-1783514034719.md
- **uiSmokeFileToken**: V17G_OBSIDIAN_FILE_SMOKE_1783514034719
- **uiSmokeFinalAnswer**: 按你的两步烟雾测试执行：先在当前 vault 里打印指定标记，再用 `apply_patch` 创建那一个文件，不做其他读写。现在创建 `_llm_bridge_smoke/v17-g-run-ui-1783514034719.md`，只写入那一行内容，使用 `apply_patch` 保留可见 diff。done
- **commandTimelineObserved**: true
- **fileEditTimelineObserved**: true
- **approvalCardObserved**: true
- **diffCardObserved**: true
- **codexRunHeaderObserved**: true
- **codexRunWaterfallFeedObserved**: true
- **codexRunFeedBatchObserved**: true
- **codexRunFeedBatchCount**: 2
- **codexRunFeedItemCount**: 2
- **codexRunNestedEventCount**: 2
- **codexRunFeedSequence**: command>file
- **codexRunThinkingCarrierObserved**: true
- **codexRunThinkingCarrierStatus**: batch-summary-carrier
- **codexRunOutputLabelCompact**: true
- **changesPanelVisible**: true
- **stepRowCount**: 2
- **approvalGateVisibleWhenPending**: true

## Timeline UX Evidence

- **diagnosticsCollapsedByDefault**: true
- **commandOutputCollapsedInNormalMode**: true
- **codexRunCommandShellPanelAvailable**: true
- **codexRunShellOutputMerged**: true
- **normalModeCommandSummaryPathRedacted**: true
- **messageRenderFailureAbsent**: true
- **developerRawEventAccessibleFromRunView**: true
- **finalAnswerVisuallySeparated**: true
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
- **defaultPackageSizeMB**: 98.3
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
| real Obsidian plugin and bridge view loaded | pass | auto |
| runtime missing surfaces install required | pass | Codex managed · ready |
| install button metadata title complete | pass | Runtime version: 0.142.5 Download size: 308.2 MB Source: https://registry.npmjs.org/@openai/codex/-/codex-0.142.5-win32-x64.tgz SHA-256: 645f5a1a0347abb2b31fae4e594c198ad00e3a4b4a999dcfa3a66c0d0f8cd43b Install path: D:\Users\Ye_Luo\APP\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge\codex-managed-runtime\runtime\win32-x64\codex.exe Status: installed |
| runtime installer verified tarball/binary in Obsidian | pass | status=already-present source=n/a |
| install success surfaces provider ready | pass | Codex managed |
| real Obsidian Codex UI smoke run completed | pass | 按你的两步烟雾测试执行：先在当前 vault 里打印指定标记，再用 `apply_patch` 创建那一个文件，不做其他读写。现在创建 `_llm_bridge_smoke/v17-g-run-ui-1783514034719.md`，只写入那一行内容，使用 `apply_patch` 保留可见 diff。done |
| real Obsidian command timeline observed | pass |  |
| real Obsidian file edit timeline observed | pass |  |
| real Obsidian approval card observed or not requested by protocol | pass | observed |
| real Obsidian diff card observed | pass |  |
| real Obsidian Codex run header observed | pass |  |
| real Obsidian Codex waterfall feed observed | pass | feed=command>file |
| real Obsidian Codex feed batches observed | pass | batches=2 nestedEvents=2 |
| real Obsidian Codex thinking carrier visible | pass | batch-summary-carrier |
| real Obsidian Codex inline output compact | pass |  |
| real Obsidian changes panel visible | pass |  |
| real Obsidian step row count correct | pass | stepRowCount=2 |
| real Obsidian approval gate visible when pending | pass | approvals=2 |
| real Obsidian diagnostics collapsed by default | pass |  |
| real Obsidian command output collapsed in normal mode | pass |  |
| real Obsidian Codex-style command shell panel available | pass |  |
| real Obsidian command shell/output merged | pass |  |
| real Obsidian normal mode command summary path redacted | pass |  |
| real Obsidian message render failure absent | pass |  |
| real Obsidian developer mode raw event accessible from run view | pass |  |
| real Obsidian final answer visually separated | pass |  |
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
