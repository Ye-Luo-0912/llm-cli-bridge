# LLM CLI Bridge 测试报告 — Codex Runtime Installer Default Package Smoke (V17-F3.1)

> 本报告由 `scripts/codex-runtime-install-default-package-smoke.mjs` 自动生成。
> 验证 dist/user-package 默认包不含 runtime binary 时，包内 installer 可不依赖系统 npm/tar 完成安装。

- **测试时间**: 2026-07-06T06:33:26.484Z
- **installerPresent**: true
- **noRuntimeBefore**: true
- **downloadOrLocalArtifactInstall**: true
- **installSource**: local-artifact
- **tarballSha256Valid**: true
- **binarySha256Valid**: true
- **binarySizeValid**: true
- **runtimeExecutable**: true
- **noPartialArtifactsAfterFail**: true
- **runtimeInstallSmokeStatus**: pass
- **runtimeInstallRequiresSystemNpm**: false
- **runtimeInstallRequiresSystemTar**: false
- **ensureFunctionPresent**: true
- **version**: 0.142.5
- **size**: 323143472
- **source**: https://registry.npmjs.org/@openai/codex/-/codex-0.142.5-win32-x64.tgz
- **sha256**: 645f5a1a0347abb2b31fae4e594c198ad00e3a4b4a999dcfa3a66c0d0f8cd43b
- **installPath**: D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\dist\user-package\codex-managed-runtime\runtime\win32-x64\codex.exe
- **error**: null

## 运行命令

```bash
npm run smoke:codex-runtime-install-default-package
```

*报告由 `scripts/codex-runtime-install-default-package-smoke.mjs` 自动生成*
