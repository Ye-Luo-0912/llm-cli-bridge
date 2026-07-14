# LLM CLI Bridge 测试报告 — 端到端端口 Smoke

> 本报告由 `scripts/e2e-port-smoke.mjs` 自动生成。
> 用 managed runtime codex.exe 做真实协议层端到端验证。

- **测试时间**: 2026-07-14T07:14:25.925Z
- **Passed**: 14
- **Failed**: 1
- **Skipped**: 1
- **Managed Runtime**: D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\src\runtime\providers\codex-managed-app-server\runtime\win32-x64\codex.exe

## 测试项

| 状态 | 测试项 | 详情 |
|------|--------|------|
| SKIP | 窄栏：UI 布局验证 | manual required — 纯 UI 布局，需在 Obsidian 内人工验收 |
| PASS | 附件：turn/start 含 localImage 被接受 | events=15, reason=completed |
| FAIL | 思考：捕获 reasoning 事件 | 模型支持 reasoning（efforts=[low,medium,high,xhigh,max,ultra]）但 runtime 丢失事件：summaryDelta=false, textDelta=false, partAdded=false, reasoningCompleted=false, turnReason=completed | events=[turn/started,item/started,item/completed,item/started,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/agentMessage/delta,item/completed,turn/completed] |
| PASS | 思考：turn/completed 到达 | reason=completed |
| PASS | 工具：捕获 item/started (commandExecution) | hasCmdStarted=true |
| PASS | 工具：捕获 item/completed (commandExecution) | hasCmdCompleted=true, turnReason=completed |
| PASS | 审批：捕获 requestApproval server-request | method=fileChange |
| PASS | 审批：accept 后文件创建 | approval-test.txt 已创建 |
| PASS | 恢复会话：Phase 1 创建会话 | threadId=019f5f79-4805-7d70-a8e9-76ffb26badbc |
| PASS | 恢复会话：Phase 2 thread/resume | resumedThreadId=019f5f79-4805-7d70-a8e9-76ffb26badbc |
| PASS | 恢复会话：Phase 2 上下文保留验证 | agentMessage="RESUME_42" |
| PASS | 分叉：turn/started 携带 turn.id（nativeTurnId） | turn.id=019f5f79-9ee3-7ac3-90f5-c26825ed8a23, turnReason=completed |
| PASS | 分叉：thread/fork 接受真实 lastTurnId | fork 成功 |
| PASS | 追加：turn/steer 被接受 | steer RPC 已接受（expectedTurnId=019f5f79-e82e-7b00-8836-3be48019d780） |
| PASS | 压缩：thread/compact/start RPC 被接受 | compact RPC 已接受 |
| PASS | 压缩：完成通知或超时兜底 | 结果=completed（timeout 表示需要插件层 30s 超时兜底） |

## 测试说明

- **窄栏**：纯 UI 布局，需在 Obsidian 内人工验收（narrow column / 窄屏布局渲染）。
- **附件**：turn/start input 含 localImage 条目，验证 codex 接受并处理图片附件。
- **思考**：捕获 reasoning 事件（summaryTextDelta / textDelta / item/completed reasoning），验证 Task 1 多段合并路径。V19: 当模型 supportedReasoningEfforts 不含 high/medium 时记为 skip（模型不支持），含 high 但无事件记为 fail（runtime 丢失）。
- **工具**：捕获 item/started + item/completed (commandExecution)，验证 tool_start/tool_result 事件流。
- **审批**：approvalPolicy="on-request"，捕获 requestApproval server-request，验证 accept/decline 响应。
- **恢复会话**：thread/start → turn → close → thread/resume，验证会话上下文保留。
- **分叉（V18-FORK）**：turn/started 携带 turn.id → thread/fork lastTurnId=该 id，验证分叉提交真实 nativeTurnId。
- **追加（V18-APPEND）**：turn/start → turn/steer 追加文本，验证 steer RPC 被接受（统一时间线）。
- **压缩（V18-COMPACT）**：thread/compact RPC 接受 + 完成通知/超时兜底，验证压缩独立短超时。

```bash
node scripts/e2e-port-smoke.mjs
```

*报告由 `scripts/e2e-port-smoke.mjs` 自动生成*
