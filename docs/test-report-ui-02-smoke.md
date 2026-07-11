# UI-02 Smoke: Composer 与上下文工作台验收

- **generatedAt**: 2026-07-11T20:17:25.085Z
- **testedCodeCommitSha**: f8a7b3097e1500aecf3882429bd45d942c698090
- **ui02SmokeStatus**: fail
- **totalChecks**: 20

| Check | Status | Detail |
| --- | --- | --- |
| UI-02 autoGrowInput 方法: 存在且实现完整（auto/scrollHeight/is-auto-grown） | fail | 方法不完整 |
| UI-02 input 事件: 调用 autoGrowInput | pass | ok |
| UI-02 autoGrowInput 接入: setInput/clear/selectMention 均调用 | fail | setInput=false clear=false selectMention=false |
| UI-02 textarea rows: '1'（紧凑态，非 '3'） | pass | ok |
| UI-02 CSS 紧凑态: min-height 52px, max-height 180px, is-auto-grown 64px | pass | ok |
| UI-02 CSS grid: 允许输入行增高到 180px | fail | 未找到 grid-template-rows 覆盖 |
| UI-02 CSS 防竖排: left tools flex-wrap:nowrap + white-space:nowrap | pass | ok |
| UI-02 上下文分组 Skill: renderComposerRuntimeCapabilityChips 加分组标签 | pass | ok |
| UI-02 上下文分组 Pin/External/File: renderComposerFileRefs 分组展示 | fail | 未找到文件分组逻辑 |
| UI-02 Note 前缀: tag 显示 'Note · 文件名' 让用户区分上下文类型 | pass | ok |
| UI-02 文件 chip 键盘删除: tabindex+role+aria-label+keydown | fail | 键盘删除不完整 |
| UI-02 CSS 文件 chip 删除: focus-visible 样式 | pass | ok |
| UI-02 CSS 需要你操作: approval/clarification 卡片 accent 左边框 | fail | 未找到 accent 左边框 |
| UI-02 CSS 上下文分组标签: uppercase + letter-spacing 样式 | pass | ok |
| UI-02 CSS 响应式 480px: 隐藏模型选择器+工具标签 | pass | ok |
| UI-02 CSS 响应式 360px: 极窄宽度发送/停止按钮 32px | pass | ok |
| UI-02 CSS 响应式 760px: 旧 compact 隐藏规则已移除，权限入口不再被隐藏 | pass | ok |
| UI-02 resolveUiLocale: 复用 F-01 的 locale 解析 | pass | ok |
| UI-02 CSS section: 标记存在 | pass | ok |
| UI-02 现有机制保留: approval/user-input active 时隐藏 composer bar | pass | ok |
