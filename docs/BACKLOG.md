# Backlog

记录已知非阻塞问题，不在当前阶段展开修复。按优先级粗分。

---

## P1（影响体验，建议下个版本修）

### B-001 选区/笔记 chip 字符数显示不稳定

- 现象：切换笔记或清空选区后，chips 旁的字符数/文件名有时不更新。
- 复现：打开笔记 A → 切换到笔记 B，Note chip 仍显示 A 的文件名。
- 临时规避：点面板顶部 ↻ 刷新按钮。
- 根因：`updateContextDisplay` 未订阅 `workspace.on('file-open')` 事件。

### B-002 时间线 detail 截断后无 tooltip

- 现象：stdout/stderr 首次事件 detail 截断到 60 字符，鼠标悬停看不到完整内容。
- 临时规避：展开 stderr 折叠区查看完整输出。
- 根因：`appendTimeline` 未给 detail 加 `title` 属性。

---

## P2（小问题，可延后）

### B-003 首次使用提示关闭后无法在 UI 内重新打开

- 现象：点 × 关闭后，只能通过清除 localStorage 中 `llm-bridge-guide-dismissed` 键重新显示。
- 期望：设置页加一个「重新显示首次使用提示」按钮。
- 临时规避：开发者控制台执行 `localStorage.removeItem('llm-bridge-guide-dismissed')` 后刷新面板。

### B-004 空状态引导按钮在运行中可重复点击（V2.2 已解决）

- V2.2 UX Gap 修复：emptyState 不再包含 Preflight 按钮，简化为纯文本提示，此问题不再适用。

### B-005 PowerShell 中文乱码

- 现象：测试输出中含中文时，PowerShell 终端显示乱码。
- 影响：不影响测试结果，仅影响终端可读性。
- 根因：PowerShell 默认编码非 UTF-8。

### B-010 scan-sensitive.mjs 误报测试假数据与二进制

- 现象：扫描项目根目录时，`scripts/run-tests.mjs` 中的假 API key（`sk-ant-api03-abcdef...` 等测试用例）和 `node_modules` 中的二进制（esbuild.exe）被误报为敏感信息。
- 影响：不影响 release zip 扫描（stage 目录只有 6 个交付文件），仅影响全项目扫描。
- 期望：扫描脚本跳过 `node_modules/` 和测试文件中的已知假数据，或提供 `--strict` 模式区分。
- 约束：不改测试用例（假数据是必要的，用于验证 redactSecret 函数）。

### B-011 test:process 偶发 1 failed（flaky）

- 现象：`npm run test:process` 偶尔出现 1 failed，重跑即通过。
- 复现：无法稳定复现，约每 3-5 次出现一次。
- 影响：不影响 release zip 交付，CI 重跑即可。
- 根因：疑似 fixture CLI 子进程退出时序竞争，或文件系统快照延迟。
- 期望：排查具体 flaky 测试项，增加重试或等待逻辑。

### B-012 Model 选项与 Agent 类型概念冲突（V2.2 UX Gap）

- 现象：默认组合"Claude Code + gpt-5.5"在概念上不成立（Claude Code 应跑 Claude 模型）。
- 影响：普通用户困惑，高级用户怀疑 model 参数是否传递给 claude CLI。
- 根因：MODEL_OPTIONS 含 gpt/glm/deepseek 模型，但默认 agent 是 claude。
- 期望：确认 model 是否实际生效（通过 ANTHROPIC_MODEL 环境变量），或 UI 说明 model 仅用于某些 backend。

### B-013 首屏面板层数过多，输入框易被挤出可视区（V2.2 UX Gap）

- 现象：窄侧栏（350-450px）下从 Header 到 Composer 共 9 层，Status Bar items 换行后进一步吞噬垂直空间。
- 影响：首次用户可能看不到底部输入框。
- 期望：Pending Actions count=0 时隐藏；Status Bar 技术指标可折叠；减少首屏层数。

### B-014 SDK 真实路径 stop() 不能中断 query（V2.2 UX Gap）

- 现象：sdk-experimental 模式下真实 SDK 路径的 `for await` 循环不响应 `stopped` 标志，stop() 后 SDK query 在后台继续运行消耗 token。
- 影响：停止后 token 持续消耗；UI 状态与实际运行不一致。
- 约束：sdk-experimental 默认关闭，真实 SDK 路径仅在 SDK 可用时触发，当前 fallback mock 不受影响。
- 期望：探索 SDK query 的中断机制（如 AbortController）。

### B-015 SDK 真实路径停止后 assistant 消息 content 为空（V2.2 UX Gap）

- 现象：真实 SDK 路径 stdout_delta 只在终态一次性发出，若用户在 query 完成前 stop()，msg.content 始终为空。
- 影响：SDK 模式停止后用户体验差，看不到任何中间输出。
- 期望：启用 includePartialMessages 并映射 partial message 到 stdout_delta。

### B-016 Preflight 缓存在切换 agent 类型后不失效（V2.2 UX Gap）

- 现象：agent 下拉切换 handler 没有清空 lastPreflightResult，切换后状态栏仍显示旧 agent 的 preflight 状态。
- 影响：用户从 claude（available）切到 codex（未安装）后，状态栏误导。
- 期望：agent 切换时清空 lastPreflightResult。

### B-017 Debug log 路径指向目录而非具体文件（V2.2 UX Gap）

- 现象：失败时 UI 显示的 Debug log 路径是 .llm-bridge/logs 目录，"打开"按钮按文件处理但实际打开目录。
- 根因：writeDebugLog() 不回传文件路径，UI 无法得知具体文件名。
- 期望：writeDebugLog() 返回文件路径，UI 显示具体 .log 文件。

### B-018 fileDiff 串行 stat，大 Vault 性能差（V2.2 UX Gap）

- 现象：snapshotVaultMarkdownFiles 在循环内逐个 await stat，1000+ md 文件 = 1000+ 串行 syscall。
- 影响：大 Vault 下单次运行的文件检测可耗秒级，用户感知卡顿。
- 期望：分批 Promise.all 并行 stat。

### B-019 切换 backend mode 后 view 不立即刷新（V2.2 UX Gap）

- 现象：settings.ts 的 backendMode onChange 只 saveSettings()，不触发 view 刷新，状态栏 Backend 值不立即更新。
- 期望：settings 变更时通知 view 刷新状态栏。

### B-020 Mode chip 是无效控件但表现为可点击（V2.2 UX Gap）

- 现象：continue/resume 标记 disabled，enabled 只剩 fresh，点击 chip 永远循环到自身，死代码 Notice 永远不触发。
- 期望：改为只读标签，或提示"仅 Fresh 可用"。

### B-021 "New"按钮在 Status Bar 和 chips 行重复出现（V2.2 UX Gap）

- 现象：两处都调用 newSession()，功能完全重复，信息冗余。
- 期望：保留一处。

---

## P3（增强项，非 bug）

### B-006 Continue / Resume 会话模式

- 现状：SessionMode 类型已定义 `continue` / `resume`，UI 已预留但禁用。
- 期望：接入 Claude Code 的 `--continue` / `--resume` 参数。
- 约束：不引入 SDK，不改 AgentEvent v0.1。

### B-007 自定义 agent 的参数模板

- 现状：Custom agent 只能配 command + args。
- 期望：支持 `{{prompt}}` / `{{vault}}` 等占位符。
- 约束：保持泛化，不引入强业务模板。

### B-008 文件检测排除目录可配置

- 现状：排除目录硬编码（.obsidian / .llm-bridge / node_modules 等）。
- 期望：设置页可增删排除目录。
- 约束：默认排除列表不变。

### B-009 运行历史持久化

- 现状：刷新面板后消息历史丢失。
- 期望：消息历史写入 `.llm-bridge/history.jsonl`，重新打开面板可恢复。
- 约束：不引入数据库，用 jsonl 追加。

---

## 不做（明确排除）

- 引入 SDK / Codex / ACP / MCP
- 修改 AgentEvent v0.1 contract
- 新增 tool event 类型
- 新增强业务模板（如「生成复习提纲」「整理笔记」等已移除的预设）
- 重构底层 backend
