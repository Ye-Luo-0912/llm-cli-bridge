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

### B-004 空状态引导按钮在运行中可重复点击

- 现象：运行中点空状态的「运行 Preflight 检测」按钮仍会触发 preflight。
- 期望：运行中禁用，或显示运行中状态。
- 影响：preflight 与运行互不冲突，但 UX 不一致。

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
