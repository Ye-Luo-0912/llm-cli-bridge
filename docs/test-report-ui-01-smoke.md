# UI-01 Smoke: 对话与运行过程重做验收

- **generatedAt**: 2026-07-09T21:41:17.868Z
- **testedCodeCommitSha**: b5fc7a2c1ca88315e21d1b6a63cb80aee1179545
- **ui01SmokeStatus**: pass
- **totalChecks**: 19

| Check | Status | Detail |
| --- | --- | --- |
| UI-01 renderTimelineNode: 普通模式 tool name 经 toolDisplayLabel，devMode 保留 raw | pass | ok |
| UI-01 renderToolCallCard: 兜底用 toolDisplayLabel 而非 raw toolName | pass | ok |
| UI-01 renderApprovalCard: 兜底用 toolDisplayLabel 而非 raw toolName | pass | ok |
| UI-01 已解决审批卡: 兜底用 toolDisplayLabel | pass | ok |
| UI-01 providerId 归一化: 普通模式用 presentProvider（codex-managed-app-server → Codex runtime） | pass | ok |
| UI-01 getToolIconAndCategory: 委托到 getToolIconCategory（识别 property_get 等） | pass | ok |
| UI-01 localizeRunStatus: 双语状态映射（Answered→已完成, Thinking→正在处理, Needs approval→需要你的确认） | pass | ok |
| UI-01 renderRunStatusText: 状态文本经 localizeRunStatus 本地化 | pass | ok |
| UI-01 Developer Mode: 状态文本保留原始英文 | pass | ok |
| UI-01 Codex run header: 状态文本经 localizeRunStatus | pass | ok |
| UI-01 headerText: 状态部分本地化（Answered · 12s → 已完成 · 12s） | pass | ok |
| UI-01 metrics 条件显示: 简单问答不显示 metrics（无文件改动/命令/审批时隐藏） | pass | ok |
| UI-01 toggle 标签: '运行详情'/'Run details'（双语） | pass | ok |
| UI-01 Process 标题: '运行详情'/'Run details'（双语，替换 'Process'） | pass | ok |
| UI-01 Thinking 本地化: 所有 text:'Thinking' 均经 localizeRunStatus | pass | raw=0 localized=4 |
| UI-01 无 'Process' 硬编码: 已替换为双语 processTitleLabel | pass | ok |
| UI-01 导入: presentProvider + resolveUiLocale 从 toolPresentation 导入 | pass | ok |
| UI-01 CSS 回归: process-body/run-header/run-metrics/run-status-text 样式存在 | pass | ok |
| UI-01 折叠交互: toggle 文本更新保留 '运行详情' 标签 | pass | ok |
