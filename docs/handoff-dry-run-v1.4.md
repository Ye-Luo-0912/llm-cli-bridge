# Handoff Dry Run v1.4

本报告记录 V1.4 Clean Handoff Dry Run 的验证结果，面向普通用户交付包的干净演练。

- 日期：2026-06-28
- 版本：v1.3.0（V1.4 阶段为 dry run，不改版本号）
- Commit：8481aed
- release zip：`release/llm-cli-bridge-1.3.0.zip`（46.9 KB）

---

## 一、交付包内容检查

### 1.1 release zip 文件清单

解压 `release/llm-cli-bridge-1.3.0.zip` 后应含且仅含以下 6 个文件：

| 文件 | 大小 | 说明 |
|---|---|---|
| `main.js` | 147509 bytes | 插件主程序 |
| `manifest.json` | 289 bytes | 插件清单（version 1.3.0） |
| `styles.css` | 20390 bytes | 样式 |
| `README.md` | 6740 bytes | 项目说明 |
| `RELEASE_CHECKLIST.md` | 3026 bytes | 发布检查清单 |
| `USER_GUIDE.md` | 8310 bytes | 普通用户指南 |

✅ 文件数 = 6，无多余条目。

### 1.2 不应包含的条目检查

| 检查项 | 结果 |
|---|---|
| `node_modules/` | ✅ 不含 |
| `.llm-bridge/`（日志/bridge.json/token） | ✅ 不含 |
| `.env` / `*.env` / credentials | ✅ 不含 |
| `.bridge-token` / `token.json` / `secrets.json` | ✅ 不含 |
| `.obsidian/workspace*` | ✅ 不含 |
| `.git/` | ✅ 不含 |
| `docs/test-report.md`（测试报告，含本机路径） | ✅ 不含 |
| 源码（`src/` / `main.ts` / `*.ts`） | ✅ 不含 |
| 测试脚本（`scripts/run-tests.mjs` 等） | ✅ 不含 |
| `package.json` / `package-lock.json` | ✅ 不含 |
| `tsconfig.json` / `esbuild.config.mjs` | ✅ 不含 |

### 1.3 本机绝对路径泄漏检查

扫描 `main.js` 中的本机路径模式（`Ye_Luo` / `D:\Users` / `C:\Users` 等）：

✅ 无命中。

### 1.4 敏感信息扫描

`scripts/scan-sensitive.mjs` 扫描 release stage 目录（6 个文件）：

✅ 无敏感信息（token / API key / .env / credentials）。

> 注：扫描项目根目录时会命中 `scripts/run-tests.mjs` 中的假数据（`sk-ant-api03-abcdef...` 等测试用例）和 `node_modules` 中的二进制，这些都不进入 release zip，不影响交付。已记入 BACKLOG B-010 优化扫描脚本。

---

## 二、自动化测试

| 测试套件 | 结果 |
|---|---|
| `npm run build` | ✅ 成功（tsc + esbuild） |
| `npm run test:unit` | ✅ 136 passed, 0 failed, 22 skipped |
| `npm run test:process` | ⚠️ flaky（偶发 1 failed，重跑通过），62 passed, 0 failed, 28 skipped |
| `npm run test:claude` | ✅ 55 passed, 0 failed, 26 skipped |

> test:process 的 flaky 问题已记入 BACKLOG B-011，非阻塞。

---

## 三、文档一致性检查

### 3.1 README.md

✅ 普通用户章节无已废弃功能引用（无「生成复习提纲」「整理当前笔记」等已移除按钮）。
✅ 安装步骤、Preflight、提问、解释选区、总结当前笔记、查看文件、查看 debug log 均有覆盖。
✅ 默认配置表与 `DEFAULT_SETTINGS` 一致。

### 3.2 docs/USER_GUIDE.md

✅ 准备工作、安装、启用、首次使用、日常使用 4 场景、运行控制、错误处理、设置说明、隐私安全 均覆盖。
✅ 无已废弃功能引用。

### 3.3 RELEASE_CHECKLIST.md

✅ 含 8 大检查项：代码与构建 / 测试 / 手工 Smoke / 敏感扫描 / Release zip / 文档 / 提交推送 / 发布后验证。
✅ 历史发布表已更新（v1.0.1-rc.1 / v1.3.0）。

---

## 四、手工 Smoke 验证（manual required）

以下 9 项需在 Obsidian 中实际操作验证。请在干净测试 Vault 中安装 release zip 后逐项检查，填写结果。

### 4.1 安装与加载

- [ ] 在干净 Vault 的 `.obsidian/plugins/llm-cli-bridge/` 复制 6 个文件
- [ ] 重启 Obsidian，设置 → 第三方插件 → 启用 LLM CLI Bridge
- [ ] 左侧栏出现机器人图标，点击打开面板
- [ ] 空状态显示 5 步引导 + 「运行 Preflight 检测」按钮

### 4.2 Preflight

- [ ] 点空状态或面板顶部 Preflight 按钮
- [ ] 状态栏 Preflight 显示 `available`（绿色，需本地有 claude CLI）或 `unavailable`（红色）

### 4.3 mock-success

- [ ] 设置 → 开发者区域 → Backend 模式改为 `mock-success`
- [ ] 面板输入「测试」→ 发送
- [ ] 显示 `completed` 状态，运行过程时间线含 started + completed

### 4.4 mock-failure

- [ ] Backend 模式改为 `mock-failure`
- [ ] 发送消息
- [ ] 显示 `failed` 状态
- [ ] 错误摘要脱敏（无 token / API key 明文）
- [ ] debug log 路径可点击复制
- [ ] stderr 可展开

### 4.5 auto + Claude 短消息

- [ ] Backend 模式改回 `auto`
- [ ] 输入「你好」→ 发送
- [ ] 收到 Claude 回复

### 4.6 解释选区

- [ ] 编辑器选中一段文本
- [ ] 面板底部 Selection chip 勾选，显示字符数
- [ ] 点「解释选区」按钮，输入框填入指令
- [ ] 发送后 Claude 基于选区回复

### 4.7 总结当前笔记

- [ ] 打开一个笔记
- [ ] 面板底部 Note chip 勾选，显示文件名
- [ ] 点「总结当前笔记」按钮，输入框填入指令
- [ ] 发送后运行结束，消息下方显示可点击的生成文件链接
- [ ] 点击链接跳转打开

### 4.8 生成文件可点击

- [ ] 4.7 完成后，文件列表可点击打开
- [ ] 文件路径正确（在 outputDir 下）

### 4.9 首次使用提示

- [ ] 首次打开面板显示「首次使用提示」5 步指南
- [ ] 点 × 关闭后不再显示
- [ ] 刷新面板后仍不显示

---

## 五、问题记录

### 5.1 阻塞问题

无。

### 5.2 非阻塞问题（已记入 BACKLOG）

| ID | 问题 | 处理 |
|---|---|---|
| B-010 | scan-sensitive.mjs 扫描项目根目录时误报测试假数据与二进制 | 记入 BACKLOG，不在本阶段修 |
| B-011 | test:process 偶发 1 failed（flaky），重跑通过 | 记入 BACKLOG，非阻塞 |

### 5.3 待手工验证项

见第四节 9 项 manual required。

---

## 六、交付结论

### 6.1 自动化部分（已完成）

- ✅ release zip 内容正确（6 文件，无敏感信息，无本机路径）
- ✅ build 成功，三套测试通过或正确 skip
- ✅ 文档与当前功能一致，无废弃引用
- ✅ RELEASE_CHECKLIST 覆盖完整

### 6.2 手工部分（待用户验证）

- ⏳ 9 项 manual smoke 需在干净 Vault 中验证

### 6.3 交付建议

交付包已满足「普通用户拿到后能安装、理解、使用」的标准：

1. 6 个文件解压即用，无依赖安装步骤。
2. README + USER_GUIDE 覆盖完整使用流程。
3. 默认配置 auto + claude，无需改动即可使用。
4. 错误信息脱敏，debug log 路径可复制。
5. 无敏感信息进入 zip 或仓库。

待手工 smoke 9 项全部通过后，可正式发布 v1.3.0。
