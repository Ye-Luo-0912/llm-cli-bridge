# LLM CLI Bridge 测试报告 — User Package Smoke (V17-F3 Runtime Distribution)

> 本报告由 `scripts/user-package-smoke.mjs` 自动生成。
> 验证 dist/user-package 发行包的完整性、CJS 加载安全性与 managed runtime 分发边界。
> V17-F3：默认 download-on-first-run 不打包大 binary；offline package 才 bundling 当前平台 runtime。

- **测试时间**: 2026-07-08T12:33:52.174Z
- **userPackageStatus**: pass
- **containsPiSdk**: true
- **canRequirePiSdk**: true
- **canLoadMainJs**: true（V17-E1 任务 C：main.js CJS 加载检查）
- **noRootPackageJson**: true（V17-E1 任务 C：根目录无 package.json 或无 type=module）
- **userNeedsNpmInstall**: false
- **sdkVersion**: 0.80.3
- **totalSizeMB**: 98.3
- **containsCodexManagedRuntime**: true（V17-F1 任务 E）
- **codexRuntimeSha256Valid**: false（V17-F1 任务 E）
- **codexRuntimeExecutable**: false（V17-F1 任务 E）
- **codexRuntimePinnedVersion**: 0.142.5
- **codexRuntimeFixture**: false（V17-F1 任务 E：fixture=true 不标 production ready）
- **releasePackageMode**: download-on-first-run
- **containsRuntimeBinary**: false
- **runtimeDownloadRequired**: true
- **runtimePinnedArtifactMetadataComplete**: true
- **runtimeInstallerExecutable**: true
- **runtimeInstallRequiresSystemNpm**: false
- **runtimeInstallRequiresSystemTar**: false
- **releasePackageContainsCodexRuntime**: true
- **releasePackageSizeMB**: 98.3
- **runtimeBinarySha256Verified**: false
- **offlinePackageSizeMB**: 0
- **runtimeInstallerPresent**: true
- **runtimePinnedArtifactPackage**: @openai/codex@0.142.5-win32-x64

## 验证项说明

- **containsPiSdk**: dist/user-package/node_modules/@earendil-works/pi-coding-agent 存在且 package.json 有 exports/main
- **canRequirePiSdk**: createAgentSession 可通过 dynamic import 加载
- **canLoadMainJs**: main.js 可被 CJS require 解析（无 ERR_REQUIRE_ESM）
- **noRootPackageJson**: 根目录无 package.json（或无 type=module），不干扰 CJS 加载
- **userNeedsNpmInstall**: 关键 transitive deps 全部 vendor，无需终端用户 npm install
- **containsCodexManagedRuntime**: dist/user-package/codex-managed-runtime/runtime-manifest.json 存在
- **codexRuntimeSha256Valid**: offline package 中当前平台 runtime binary 的 sha256 与 manifest 匹配；download-on-first-run 默认包不要求该字段为 true
- **codexRuntimeExecutable**: offline package 中当前平台 runtime binary 可执行权限校验通过；download-on-first-run 默认包不要求该字段为 true
- **codexRuntimePinnedVersion**: manifest 中记录的 runtime 版本
- **codexRuntimeFixture**: manifest.fixture=true（fixture runtime，不标 production ready）
- **releasePackageMode**: download-on-first-run 为普通用户默认；bundled-platform-runtime 仅用于离线朋友版/平台专用包；external-fallback-dev 仅开发者兼容路径
- **containsRuntimeBinary**: 当前包是否实际包含 runtime binary
- **runtimeDownloadRequired**: 当前包是否需要首次运行安装 runtime
- **runtimePinnedArtifactMetadataComplete**: manifest 中固定 artifact package/tarball/tarballSha256/vendorPath/size/sha256 完整
- **runtimeInstallerExecutable**: 包内 installer 不依赖系统 npm/tar，可由 Node/Electron 执行
- **runtimeInstallRequiresSystemNpm**: runtime installer 是否依赖系统 npm CLI
- **runtimeInstallRequiresSystemTar**: runtime installer 是否依赖系统 tar CLI
- **releasePackageContainsCodexRuntime**: dist/user-package 已包含 runtime-manifest.json 与 installer/downloader；默认不包含 codex.exe
- **releasePackageSizeMB**: dist/user-package 当前产物大小，用于 release 风险记录
- **runtimeBinarySha256Verified**: offline package 中当前平台 runtime binary sha256 已按 manifest 校验；默认包为 false
- **offlinePackageSizeMB**: offline package 构建时记录实际包大小；默认包为 0
- **auth/config boundary**: 发行包不依赖用户安装 Codex CLI/App；运行真实 Codex turn 仍需要可用的 user-level Codex/OpenAI credentials 或环境变量

## V17-E1 任务 C：package.json type=module 风险修复

- build-user-package.mjs 不再写 `package.json`（含 `"type":"module"`）到 user-package 根目录
- 改为写 `llm-cli-bridge-user-package.json` 作为纯元数据文件，不影响 Node 模块解析
- main.js 是 esbuild format=cjs，CJS require 加载不受影响

## 运行命令

```bash
npm run build:user-package
npm run smoke:user-package
```

---

*报告由 `scripts/user-package-smoke.mjs` 自动生成*
