# Release Checklist

每次发布前按此清单逐项检查。所有项必须 ✅ 才能发布。

---

## 1. 代码与构建

- [ ] `npm run build` 成功（tsc 类型检查 + esbuild 打包 main.js）
- [ ] `main.js` 已重新生成，时间戳为最新
- [ ] `manifest.json` 的 `version` 已更新
- [ ] 无未提交的改动（`git status` 干净）

## 2. 测试

- [ ] `npm run test:unit` 全绿（0 failed，skipped 项有合理原因）
- [ ] `npm run test:process` 全绿（0 failed，skipped 项有合理原因）
- [ ] `npm run test:claude` 全绿或正确 skip（缺 claude 时 skip）
- [ ] `docs/test-report.md` 已重新生成，含测试时间、环境、插件版本

## 3. 手工 Smoke（manual required）

- [ ] mock-success：发送消息 → 显示 completed → 无错误
- [ ] mock-failure：发送消息 → 显示 failed → 错误摘要脱敏 → debug log 路径可点击复制
- [ ] auto + Claude 短消息：发送 → 收到回复
- [ ] 选区识别：编辑器选中文本 → Selection chip 显示字符数
- [ ] 当前笔记识别：打开笔记 → Note chip 显示文件名
- [ ] 生成文件可点击：运行结束后文件列表可点击打开
- [ ] 运行过程时间线：started / stdout / stderr / 终态 正确显示
- [ ] 空状态引导：首次打开显示 5 步引导 + Preflight 按钮
- [ ] 首次使用提示：可关闭，关闭后不再显示

### 3.1 V1.6 SDK Experimental Smoke（manual required，详见 docs/manual-smoke-v1.6.md）

- [ ] sdk-experimental 模式：发送消息 → 显示 SDK Workflow 区域（工具时间线 + 非工具事件）
- [ ] SDK 不可用时 fallback：sdk-experimental 仍产出 mock workflow 事件 + AgentEvent v0.1
- [ ] sdk-experimental 事件已脱敏：无完整 sk-ant / Bearer / password 明文
- [ ] sdk-experimental stop() 可中断：状态 → Stopped
- [ ] SDK 不影响 CLI：切回 auto 模式后 claude CLI 正常，无 SDK Workflow 区域
- [ ] auto/mock-success/mock-failure 不产生 SDK Workflow 区域（CLI 主线不回归）

## 4. 敏感信息扫描

- [ ] `node scripts/scan-sensitive.mjs` 通过（无 token / API key / .env / credentials）
- [ ] `git log --all -p | grep -iE "sk-ant|api[_-]?key|token="` 无敏感值命中
- [ ] `.llm-bridge/` 未入库（`.gitignore` 已排除）
- [ ] `bridge.json` / `.bridge-token` 未入库

## 5. Release zip 构建

- [ ] `npm run release` 成功生成 `release/llm-cli-bridge-<version>.zip`
- [ ] zip 内容只含 6 个文件：`main.js` / `manifest.json` / `styles.css` / `README.md` / `RELEASE_CHECKLIST.md` / `USER_GUIDE.md`
- [ ] zip 不含：源码 / node_modules / .llm-bridge / docs/test-report.md / 测试临时文件 / .git
- [ ] zip 内 `main.js` 与本地构建产物一致（大小或哈希核对）

## 6. 文档

- [ ] `README.md` 普通用户章节与当前功能一致（无已移除的按钮名称）
- [ ] `docs/USER_GUIDE.md` 步骤可走通
- [ ] `docs/BACKLOG.md` 已更新已知问题
- [ ] `docs/test-report.md` 已重新生成

## 7. 提交与推送

- [ ] 改动已提交（commit message 含版本号与变更摘要）
- [ ] 已推送到 `origin/master`
- [ ] 可选：打 tag `v<version>` 并推送

## 8. 发布后验证

- [ ] 在干净 Vault 中按 USER_GUIDE 步骤安装
- [ ] Preflight 通过
- [ ] 至少完成一次「总结当前笔记」端到端流程
- [ ] 至少完成一次「解释选区」端到端流程

---

## 历史发布

| 版本 | 日期 | Commit | 备注 |
|---|---|---|---|
| v1.0.1-rc.1 | 2026-06-28 | d281628 | 首个 release zip，36.9 KB |
| v1.3.0 | 2026-06-28 | b9b87e4 | Handoff Ready Polish，含 USER_GUIDE / BACKLOG / 统一 release 脚本，GitHub Release 已创建 |
| v1.5.0 | 2026-06-28 | d0c489d | Claude Code Command Support / Workflow Trace Foundation，新增命令预览区 + Workflow Trace |
| v1.6.0 | 2026-06-28 | 282b911 | SDK Workflow Event Prototype (experimental)，新增 sdk-experimental backend + UI-only WorkflowEvent 模型，默认关闭，CLI 主线不变 |
| v1.7.0 | 2026-06-28 | d07f4de | Real SDK Workflow Enhancement，接入真实 Claude Agent SDK 事件流（双包名兼容）+ SDKMessage→WorkflowEvent 纯函数映射 + SDK diagnostics，SDK 不可用时 fallback mock，CLI 主线不变 |
| v1.8.0 | 2026-06-28 | d1e6267 | Real User Flow Consolidation，3 核心用户流收敛 + workflow trace/timeline/sdk workflow 默认折叠 + onboarding 简化为 3 步用户导向 + README 3 步使用法，不新增功能 |
| v2.0.0 | 2026-06-28 | (pending) | Agent State / Session / Workflow UX + SDK Workflow Deepening，会话概念(title/new/clear) + 会话状态区(4面板) + 运行流程区(6步) + Skills 入口(.llm-bridge/skills.md) + thinking/completed/failed WorkflowEvent + tool durationMs + 按阶段分组 UI + error 复制按钮 + diagnostics errorSummary，不修改 AgentEvent v0.1，CLI 主线不变 |
