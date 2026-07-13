# LLM CLI Bridge 测试报告 — 端到端端口 Smoke

> 本报告由 `scripts/e2e-port-smoke.mjs` 自动生成。
> 用 managed runtime codex.exe 做真实协议层端到端验证。

- **测试时间**: 2026-07-13T22:54:52.075Z
- **Passed**: 9
- **Failed**: 1
- **Skipped (manual required)**: 1
- **Managed Runtime**: D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\src\runtime\providers\codex-managed-app-server\runtime\win32-x64\codex.exe

## 测试项

| 状态 | 测试项 | 详情 |
|------|--------|------|
| SKIP | 窄栏：UI 布局验证 | manual required — 纯 UI 布局，需在 Obsidian 内人工验收 |
| PASS | 附件：turn/start 含 localImage 被接受 | events=19, reason=completed |
| FAIL | 思考：捕获 reasoning 事件 | summaryDelta=false, textDelta=false, reasoningCompleted=false, turnReason=completed |
| PASS | 思考：turn/completed 到达 | reason=completed |
| PASS | 工具：捕获 item/started (commandExecution) | hasCmdStarted=true |
| PASS | 工具：捕获 item/completed (commandExecution) | hasCmdCompleted=true, turnReason=completed |
| PASS | 审批：捕获 requestApproval server-request | method=fileChange |
| PASS | 审批：accept 后文件创建 | approval-test.txt 已创建 |
| PASS | 恢复会话：Phase 1 创建会话 | threadId=019f5db0-7532-7dd3-8b8f-138c00f08ad4 |
| PASS | 恢复会话：Phase 2 thread/resume | resumedThreadId=019f5db0-7532-7dd3-8b8f-138c00f08ad4 |
| PASS | 恢复会话：Phase 2 上下文保留验证 | agentMessage="RESUME_42" |

## 测试说明

- **窄栏**：纯 UI 布局，需在 Obsidian 内人工验收（narrow column / 窄屏布局渲染）。
- **附件**：turn/start input 含 localImage 条目，验证 codex 接受并处理图片附件。
- **思考**：捕获 reasoning 事件（summaryTextDelta / textDelta / item/completed reasoning），验证 Task 1 多段合并路径。
- **工具**：捕获 item/started + item/completed (commandExecution)，验证 tool_start/tool_result 事件流。
- **审批**：approvalPolicy="on-request"，捕获 requestApproval server-request，验证 accept/decline 响应。
- **恢复会话**：thread/start → turn → close → thread/resume，验证会话上下文保留。

```bash
node scripts/e2e-port-smoke.mjs
```

*报告由 `scripts/e2e-port-smoke.mjs` 自动生成*
