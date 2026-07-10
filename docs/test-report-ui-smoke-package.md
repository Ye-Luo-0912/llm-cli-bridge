# UI Smoke 测试包：聚合验收报告

- **generatedAt**: 2026-07-10T03:35:38.850Z
- **testedCodeCommitSha**: fd951b1eb32c89b3213b4c2ab4e135ed904f84cb
- **uiSmokePackageStatus**: pass
- **passed**: 13
- **failed**: 0
- **manualRequired**: 1
- **totalChecks**: 13

## 自动化检查

| Check | Status | Detail |
| --- | --- | --- |
| 聚合 smoke: F-01 toolPresentation | pass | 14 passed, 0 failed |
| 聚合 smoke: UI-01 对话/运行过程 | pass | 19 passed, 0 failed |
| 聚合 smoke: UI-02 Composer/上下文 | pass | 20 passed, 0 failed |
| 聚合 smoke: UI-03 导航/会话/页面 | pass | 14 passed, 0 failed |
| 聚合 smoke: F-03 状态机收口 | pass | 16 passed, 0 failed |
| DevMode 回归: localizeRunStatus 保留原始英文 | pass | ok |
| DevMode 回归: renderTimelineNode 保留 raw tool name | pass | ok |
| DevMode 回归: metrics 始终显示（hasMeaningfulMetrics || developerMode） | pass | ok |
| DevMode 回归: SDK events 仅 developerMode 下映射 | pass | ok |
| DevMode 回归: providerLabel 保留 raw（codex-managed-app-server 不归一化） | pass | ok |
| DevMode 回归: Process 标题双语（普通用户态），DevMode 经 localizeRunStatus 保留英文 | pass | ok |
| 独立性: smoke 脚本不在 run-tests.mjs 中（独立文件） | pass | ok |
| package.json: 5 个 smoke 脚本均存在 | pass | ok |

## Manual Required

### CDP 4 宽度截图

```
1. 启动 Obsidian 并启用远程调试：obsidian --remote-debugging-port=9222
2. 打开 LLM CLI Bridge 插件视图
3. 用浏览器自动化工具（Puppeteer/Playwright）连接 http://localhost:9222
4. 在 4 个宽度截图：1920px / 1280px / 768px / 480px
5. 截图保存到 docs/screenshots/
6. 验证：Chat/Files/Skills/History 四个页面在所有宽度下无溢出/截断/竖排
```
