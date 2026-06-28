# Release Checklist — LLM CLI Bridge

发布前逐项核对。每项标记 ✅ 通过 / ⚠️ 跳过（含原因）/ ❌ 失败 / ⚪ manual required。

---

## 1. Build

- [ ] `npm install` 成功，无依赖缺失
- [ ] `npm run build` 成功（`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`）
- [ ] 生成 `main.js`，体积合理（< 200 KB）
- [ ] TypeScript 类型检查零错误

## 2. 自动化测试

- [ ] `npm run test:unit` 全绿或正确 skip
- [ ] `npm run test:process` 全绿或正确 skip
- [ ] `npm run test:claude` 全绿或正确 skip（缺 claude 时 skip 可接受）
- [ ] `docs/test-report.md` 已生成，含时间 / 环境 / 版本 / bridge 状态
- [ ] 无 0 failed 之外的失败项
- [ ] manual required 项已明确标记

## 3. 部署到测试 Vault

- [ ] 复制 `main.js` → `<Vault>/.obsidian/plugins/llm-cli-bridge/main.js`
- [ ] 复制 `manifest.json` → `<Vault>/.obsidian/plugins/llm-cli-bridge/manifest.json`
- [ ] 复制 `styles.css` → `<Vault>/.obsidian/plugins/llm-cli-bridge/styles.css`
- [ ] Obsidian 内 reload 插件，无控制台错误

## 4. Obsidian 手工 Smoke（manual required）

在 Obsidian 内逐项验证：

- [ ] **mock-success**：Backend Mode = mock-success，发送消息，状态显示 `completed`
- [ ] **mock-failure**：Backend Mode = mock-failure，发送消息，状态显示 `failed`，stderr 可见
- [ ] **auto + claude 短消息**：Backend Mode = auto，agent = claude，发送「只回复 OK」，能收到回复
- [ ] **包含选区**：勾选 Selection，选中一段含唯一标记词的文本，发送「复述选区中的标记词」，Claude 能识别
- [ ] **包含当前笔记**：勾选 Note，打开一篇含唯一标记词的笔记，发送「指出当前笔记中的标记词」，Claude 能识别
- [ ] **文件检测**：auto 模式运行后，UI 显示「本次新增/修改文件」列表，路径可点击打开

## 5. 敏感文件清理

- [ ] `.gitignore` 含 `node_modules/` / `.llm-bridge/` / `*.log` / `*.env` / `*token*` / `*secret*` / `*credential*` / `.obsidian/workspace*`
- [ ] `git status` 无 `.llm-bridge/` 目录被跟踪
- [ ] `git status` 无 `data.json`（插件本地设置）被跟踪
- [ ] `git status` 无 `bridge.json` / `.bridge-token` 被跟踪
- [ ] 提交前 `git diff --staged` 不含 token / secret / key
- [ ] preflight / debug 日志未提交（仅存在于 Vault 本地）

## 6. 打包文件清单

发布到 GitHub Release 的 zip 应仅含：

- [ ] `main.js`
- [ ] `manifest.json`
- [ ] `styles.css`
- [ ] `README.md`

**不应包含**：`node_modules/` / `src/` / `scripts/` / `docs/` / `.llm-bridge/` / `*.log` / `data.json` / `tsconfig.json` / `package*.json`。

## 7. 版本与提交

- [ ] `manifest.json` 版本号已更新
- [ ] commit message 符合约定（`feat:` / `fix:` / `refactor:`）
- [ ] `git push origin master` 成功
- [ ] GitHub main 分支已含最新提交

---

## 当前版本核对（V1.0 Release Candidate）

| 项 | 状态 |
|---|---|
| Build | ✅ `npm run build` 通过，main.js ~109 KB |
| test:unit | ✅ 96 passed, 0 failed, 22 skipped |
| test:process | ✅ 62 passed, 0 failed, 26 skipped |
| test:claude | ✅ 55 passed, 0 failed, 24 skipped |
| 部署到测试 Vault | ✅ main.js / manifest.json / styles.css 已复制 |
| Obsidian 手工 smoke | ⚪ manual required（见第 4 节） |
| 敏感文件清理 | ✅ .gitignore 已加固 |
| README | ✅ 已创建 |
| RELEASE_CHECKLIST | ✅ 已创建 |
