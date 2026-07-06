# LLM CLI Bridge 测试报告 — Codex Real Obsidian Runtime UX Smoke (V17-F5)

> 本报告由 `scripts/codex-real-obsidian-runtime-ux-smoke.mjs` 自动生成。
> 它只在真实 Obsidian 通过 CDP 暴露时记录真实 UI 观察；CDP 不可用时明确 skip，不把合成 smoke 伪装为真实 UI pass。

- **测试时间**: 2026-07-06T13:11:57.645Z
- **testedCodeCommitSha**: d6d81eda6d79b88f328bdf191325fae9c7a800a4
- **realObsidianRuntimeUxStatus**: skip-cdp-unavailable
- **realObsidianSmokeStatus**: skip-cdp-unavailable
- **cdpStatus**: skip-cdp-unavailable
- **cdpTargetTitle**: null
- **cdpTargetUrl**: null
- **skipReason**: fetch failed

## Runtime UX Observations

- **firstOpenDefaultPackageObserved**: false
- **runtimeMissingInstallRequiredObserved**: false
- **installSuccessProviderReadyObserved**: false
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
- **offlineWin32X64PackageSizeMB**: not-built
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
