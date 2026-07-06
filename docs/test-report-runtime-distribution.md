# LLM CLI Bridge 测试报告 — Runtime Distribution Strategy (V17-F3)

> 本报告由 `scripts/generate-runtime-distribution-report.mjs` 自动生成。
> 默认包采用 download-on-first-run，不复制 Codex runtime 大 binary；offline package 才 bundling 当前平台 binary。

- **测试时间**: 2026-07-06T05:49:43.501Z
- **defaultPackageDir**: D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\dist\user-package
- **defaultPackageMode**: download-on-first-run
- **defaultPackageSizeMB**: 97.8
- **offlinePackageDir**: D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\dist\user-package-offline-win32-x64
- **offlinePackageMode**: bundled-platform-runtime
- **offlineWin32X64PackageSizeMB**: 406
- **offlineCurrentPlatformPackageExists**: true
- **runtimeBinarySizeMB**: 308.2
- **runtimeDownloadRequired**: true
- **containsRuntimeBinary**: false
- **runtimePinnedArtifactVerified**: true
- **runtimeCanInstallFromPinnedArtifact**: true
- **defaultManifestExists**: true
- **defaultInstallerExists**: true
- **runtimeVersion**: 0.142.5
- **testedPlatform**: win32-x64
- **supportedPlatformsInManifest**: win32-x64
- **crossPlatformPackageStrategy**: platform-specific-packages-only:no-all-platform-fat-package
- **platformPackageNames**: llm-cli-bridge-win32-x64,llm-cli-bridge-win32-arm64,llm-cli-bridge-darwin-arm64,llm-cli-bridge-linux-x64

## Distribution Modes

| mode | purpose | runtime binary policy |
|------|---------|-----------------------|
| bundled-platform-runtime | offline friend build / platform-specific release | include current platform binary only |
| download-on-first-run | default ordinary-user package | include manifest + installer; download after user confirmation |
| external-fallback-dev | developer compatibility path | use external codex app-server explicitly; not a user-ready gate |

## Installer UX Contract

- 首次启动发现 runtime missing 时，应显示 runtime version、download size、source package、sha256、install path。
- 用户确认后才下载安装。
- 下载后必须校验 size + sha256。
- 校验失败必须删除下载 artifact / extract 目录 / 目标 runtime binary，并提示错误。
- default 普通用户模式优先 download-on-first-run；离线朋友版使用 bundled-platform-runtime。
- 不再发布 all-platform fat package；跨平台通过平台专用包或 CI 后续生成。

```bash
npm run build:user-package
npm run build:user-package:offline
npm run report:runtime-distribution
```

*报告由 `scripts/generate-runtime-distribution-report.mjs` 自动生成*
