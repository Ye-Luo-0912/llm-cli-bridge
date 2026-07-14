# UI-03 Smoke: 导航、会话与页面层级验收

- **generatedAt**: 2026-07-14T06:54:15.607Z
- **testedCodeCommitSha**: 799f02e906f2e28ec71d8770d915ed91b1c67d48
- **ui03SmokeStatus**: fail
- **totalChecks**: 14

| Check | Status | Detail |
| --- | --- | --- |
| UI-03 左 rail nav-label: 4 个导航项均有 label span | fail | nav-label 不完整 |
| UI-03 CSS nav-label: 默认 display:none，is-active 时 display:inline | pass | ok |
| UI-03 CSS nav-item 键盘焦点: focus-visible outline | pass | ok |
| UI-03 History 首条+最后答复: 分开显示而非单一 preview | pass | ok |
| UI-03 History 无单一 preview: 移除 sessionSummaryText 调用 | pass | ok |
| UI-03 CSS History 分行: block + ellipsis 样式 | pass | ok |
| UI-03 Skills 分组: 本轮已启用 vs 可用但未启用 | fail | Skills 分组不完整 |
| UI-03 Skills 分组标签: '本轮已启用（N）' + '可用但未启用（N）' | fail | 分组标签文案不完整 |
| UI-03 renderAgentSkillItem: 抽取为独立方法（AgentSkillRecord 类型） | pass | ok |
| UI-03 CSS Skills 分组: uppercase + accent 色标签 | pass | ok |
| UI-03 恢复提示: 消息数 + 模型 + 权限 + Pin + 原生会话 | fail | 恢复提示不完整 |
| UI-03 Files 三段: 本轮上下文 / Pin / 外部读取请求（已有，验证保留） | fail | Files 三段缺失 |
| UI-03 顶栏: 会话标题 + 新聊天 + 设置 + runtime 状态（已有，验证保留） | pass | ok |
| UI-03 nav-item tooltip/aria-label: 保留（键盘可访问） | fail | aria-label 缺失 |
