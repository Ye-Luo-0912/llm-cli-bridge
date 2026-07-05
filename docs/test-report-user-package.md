# LLM CLI Bridge 测试报告 — User Package Smoke (V17-D + V17-E1)

> 本报告由 `scripts/user-package-smoke.mjs` 自动生成。
> 验证 dist/user-package 零安装发行包的完整性与 CJS 加载安全性。

- **测试时间**: 2026-07-05T18:25:39.411Z
- **userPackageStatus**: pass
- **containsPiSdk**: true
- **canRequirePiSdk**: true
- **canLoadMainJs**: true（V17-E1 任务 C：main.js CJS 加载检查）
- **noRootPackageJson**: true（V17-E1 任务 C：根目录无 package.json 或无 type=module）
- **userNeedsNpmInstall**: false
- **sdkVersion**: 0.80.3
- **totalSizeMB**: 97.8

## 验证项说明

- **containsPiSdk**: dist/user-package/node_modules/@earendil-works/pi-coding-agent 存在且 package.json 有 exports/main
- **canRequirePiSdk**: createAgentSession 可通过 dynamic import 加载
- **canLoadMainJs**: main.js 可被 CJS require 解析（无 ERR_REQUIRE_ESM）
- **noRootPackageJson**: 根目录无 package.json（或无 type=module），不干扰 CJS 加载
- **userNeedsNpmInstall**: 关键 transitive deps 全部 vendor，无需终端用户 npm install

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
