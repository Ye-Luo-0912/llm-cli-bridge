# LLM CLI Bridge 测试报告 — 全量测试（all）

- **测试时间**: 2026-07-05T06:44:17.533Z
- **测试环境**: win32 / Node.js v24.14.0
- **插件版本**: 2.16.0
- **main.js 大小**: 784.1 KB
- **Vault 路径**: `D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki`
- **bridge.json 存在**: 是
- **HTTP 端口**: 59338
- **commit sha**: b757d42a1c3b7909dda480da9cd101786bb23b5b
- **commit 短 sha**: b757d42a1c3b
- **运行命令**: node scripts/run-tests.mjs 

## 测试汇总

- ✅ **通过**: 1009
- ❌ **失败**: 0
- ⏭️ **跳过**: 4
- ⚪ **需人工验证**: 2
- **总计**: 1015

### 审计模式说明

- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。
- **本轮 uncaughtException 次数**: 0
- **本轮 unhandledRejection 次数**: 0
- **skip 策略**：当前环境 skip 项保留，但每项必须标明原因（环境假失败 / 模式不匹配 / Obsidian 未运行等）并有覆盖替代测试（unit ↔ process 互补）。

## 详细结果

### isPathUnsafe

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 普通 "config-notes.md" 不应被误杀 | - |
| ✅ | 普通笔记名含 config 2 | - |
| ✅ | 子目录 config 笔记 | - |
| ✅ | 普通目录文件 | - |
| ✅ | ".env" 应拒绝 | - |
| ✅ | ".git" 应拒绝 | - |
| ✅ | "../" 应拒绝 | - |
| ✅ | 绝对路径应拒绝 | - |
| ✅ | ".obsidian/" 应拒绝 | - |
| ✅ | ".llm-bridge/bridge.json" 应拒绝 | - |
| ✅ | "token" 应拒绝 | - |
| ✅ | "secrets" 应拒绝 | - |
| ✅ | "credentials" 应拒绝 | - |
| ✅ | private 下 config 应拒绝 | - |
| ✅ | runtime 下 config 应拒绝 | - |
| ✅ | .llm-bridge 下含 config 关键词拒绝 | - |

### ACTION_SCHEMAS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | show_notice 缺 message | - |
| ✅ | show_notice 正常 | - |
| ✅ | open_note 缺 path | - |
| ✅ | open_note 正常 | - |
| ✅ | create_note 缺 content | - |
| ✅ | create_note 缺 path | - |
| ✅ | create_note 正常 | - |
| ✅ | get_state 禁止额外字段 | - |
| ✅ | get_state 正常 | - |
| ✅ | 未知 action 类型 | - |

### validateAction

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | create_note 敏感路径 .env 应拒绝 | - |
| ✅ | create_note config-notes.md 应通过 | - |
| ✅ | create_note private/config 应拒绝 | - |

### Prompt Package

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | truncateText 截断 | - |
| ✅ | truncateText 不截断短文本 | - |
| ✅ | 包含启用内容（includeActiveNote=true） | - |
| ✅ | 包含启用内容（includeSelection=true） | - |
| ✅ | 不包含未启用内容 | - |
| ✅ | 输出规则配置驱动（含配置值） | - |
| ✅ | outputDir 为空时项目规则驱动（无固定目录） | - |
| ✅ | 包含用户请求 | - |
| ✅ | 截断长内容 | - |

### V16.3 Prompt Package

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | activeFileContent=null 时路径仍注入（语义一致性） | - |
| ✅ | activeFilePath=null 时不注入（无路径可注入） | - |

### V16.3 buildUserPrompt (runtime)

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | activeFileContent=null 时路径仍注入 | - |

### 文件快照

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 生成运行前快照 | 文件数: 20 |

### diff

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 检测新增文件 [NEW] | 找到: _fs-test-temp/test-new-file.md |
| ✅ | 检测修改文件 [MODIFIED] | 找到: _fs-test-temp/test-existing-file.md |

### 排除目录

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | LLM-AgentRuntime/ 不参与 diff | - |
| ✅ | .obsidian/ 不参与 diff | - |
| ✅ | .llm-bridge/ 不参与 diff | - |

### HTTP

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | /health 探测成功 | - |
| ✅ | GET /state | vault: N/A |
| ✅ | token 错误返回 401 | status: 401 |
| ✅ | POST /action show_notice | - |
| ✅ | get_active_note | status: completed |
| ✅ | get_selection | status: completed |
| ✅ | open_note 不存在的文件返回错误 | open_note: 文件不存在 __non_existent_test_file__.md |

### Dev mode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | /dev/approve 端点可用 | - |

### Approval

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | create_note 返回 202 pending_approval | status: 202, data.status: pending_approval |
| ✅ | /action-status 查询 pending | status: pending_approval |
| ✅ | POST /dev/approve | - |
| ✅ | approve 后状态为 completed | status: completed, error: none |
| ✅ | 文件创建成功 | _approval-test/devtest-create.md |
| ✅ | POST /dev/reject | - |
| ✅ | reject 后状态为 declined | status: declined |
| ✅ | reject 后文件未创建 | - |
| ✅ | append_to_note pending | status: 202 |
| ✅ | append_to_note approve 成功 | status: completed, error: none |
| ⚪ | insert_at_cursor 完整流程 | 需要活动的 Markdown 编辑器 + 光标位置 |
| ⚪ | replace_selection 完整流程 | 需要活动的 Markdown 编辑器 + 选区 |
| ✅ | default mode + high risk → pending | - |
| ✅ | resolveApproval(accept) → waitForApproval resolves | - |
| ✅ | acceptForSession writes sessionAllows cache | - |
| ✅ | cancelAllPending → resolver wakes with cancel | - |
| ✅ | bypassPermissions mode → auto-allow | - |

### Helper

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | obsidian-action.mjs 存在 | - |
| ✅ | health 命令 | - |
| ✅ | state 命令 | - |
| ✅ | show_notice 命令 | - |
| ✅ | --json 标志输出有效 JSON | - |
| ✅ | --wait --timeout 超时行为 | 耗时: 3126ms, stderr包含timeout: true |
| ✅ | bridge.json 缺失时错误提示 | 正确提示 bridge.json 缺失 |

### Contract

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | CodexAppServerProvider 实现 RuntimeProvider 接口 | - |
| ✅ | started 必须先发出 | - |
| ✅ | stdout_delta 正常产出 | - |
| ✅ | stderr_delta 正常产出 | - |
| ✅ | completed 正常产出 | - |
| ✅ | failed 正常产出 | - |
| ✅ | stop() 产出 stopped/failed | - |
| ✅ | stop() 多次调用不抛异常 | - |
| ✅ | cwd 不存在返回 failed | - |
| ✅ | command 不存在返回 failed | - |

### Plan snapshot

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | codex-app-server plan.backend=codex-app-server | - |
| ✅ | bridgeSystemAppend → instructions, userPrompt → turn/start input[0].text | - |

### Attachment audit

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | entry-level packing decisions | - |

### Prompt split

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | bridgeSystemAppend + userPrompt + auditHash stable | - |
| ✅ | SDK streaming input 使用 BridgePromptPackage.userPrompt（不绕过） | - |

### Codex fixture JSONL → NormalizedRuntimeEvent sequence

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Codex fixture JSONL → NormalizedRuntimeEvent sequence | - |

### Codex fixture

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | turn/completed carries finalText + sessionId | - |

### Wire shape

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 无 jsonrpc 字段 + initialize/initialized/respondToServerRequest | - |

### Wire handshake

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | initialize→initialized→thread/start 顺序 + thread.start result.thread.id | - |

### Wire turn/start.input

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | content item array (text + image + file) | - |

### Wire approval

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | server-request → client 按 id 返回 result (decision=allow) | - |
| ✅ | 手动 respondToServerRequest (decision=deny) | - |

### AssistantTurnView

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | fixture stream → completed view (process/thoughts/tools/files/final) | - |

### AgentRunDisplayModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | header 含摘要计数（tools/file changes） | - |
| ✅ | finalAnswer 透传自 AssistantTurnView | - |
| ✅ | timelineCards 含 thinking/tool/approval/error（resolved approval 进入 timeline） | - |
| ✅ | pending approvalCards 只含 pending（resolved 进入 timeline） | - |
| ✅ | fileChangeCards 从 fileChanges 派生 | - |
| ✅ | diagnosticCards 只含 warnings（errors 进 timeline） | - |
| ✅ | developerMode=false → debugView=undefined | - |
| ✅ | developerMode=true → debugView 含 rawProviderEvents | - |
| ✅ | running 状态 → currentActivity + header 含运行中 | - |
| ✅ | getToolIconCategory 分类正确 | - |

### P4-D AgentRunDisplayModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | toolDisplayLabel 普通用户态简洁标签 | - |
| ✅ | 普通用户态 tool card 降噪（隐藏 raw JSON），developer mode 保留 | normal=ok dev=ok |
| ✅ | completed 无文件变化但有回答 → Answered | - |
| ✅ | completed 仅有终态回答时显示 Answered · Xs | - |

### V16.4-D AgentRunDisplayModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 需要用户确认的最终回答 → Needs input | disposition=needs-input header="Needs input · 32s" |
| ✅ | 无文件变化普通回答 → Answered | header="Answered · 32s" disposition=answered |
| ✅ | completed 无法判定时不裸露时长 | header="Completed · 32s" disposition=completed |
| ✅ | pending approval → Needs approval + concise label | header="Needs approval" label="Write _test_output.md" |

### V16.4-E AgentRunDisplayModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AskUserQuestion approval_request 归类为 Needs input（非 permission） | header="Needs input · 40s" approvals=0 userInputs=1 |

### V16.4 ProviderLifecycleEvent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 从 AssistantTurnView 派生（evaluation_started/tool_started/observation/result） | - |

### V16.4 RunPhaseModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 多个 AssistantMessage 生成多个 phase（不被压成一个 thinking） | - |
| ✅ | phase 类型正确（reading/editing/verifying） | - |
| ✅ | verifying 检测（读取曾写入文件 → verifying） | - |
| ✅ | phase 内 fileChanges 带 +N -M | - |
| ✅ | completed phase 默认折叠 | - |
| ✅ | TaskCreate/TaskUpdate/TodoWrite/AskUserQuestion 普通用户态不可见 | - |
| ✅ | phaseLabel 用户友好标签 | - |
| ✅ | phase tools 不含 TaskCreate/Preparing 等隐藏工具 | - |
| ✅ | running 中 currentPhase 保持 running（不被误标记 completed） | - |
| ✅ | running 时 currentPhase 非 null | - |
| ✅ | running currentActivity 显示当前阶段（非 Thinking 回退） | - |
| ✅ | running phase 默认展开（defaultExpanded=true） | - |
| ✅ | Bash/test/lint/dotnet 映射为 checking phase | - |
| ✅ | checking phaseLabel（Running command/tests/lint） | - |
| ✅ | 同一 AssistantMessage 多个 tool_use 在同一 phase（不被误拆） | - |
| ✅ | 两个 AssistantMessage 生成两个 phase（多段 thinking 不被压成一个） | - |

### V16.4 FileChangeStats

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | +N -M 统计透传（create +3 -0） | - |
| ✅ | source 字段标记来源（fallback） | - |

### V16.4 getPhaseIconName

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Lucide 图标名映射 | - |
| ✅ | checking → terminal | - |

### V16.4 AgentRunDisplayModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 phaseModel（普通用户态主链路） | - |
| ✅ | fileChangeCards 含 +N -M | - |

### V16.4 Developer mode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 保留 lifecycleEvents + timelineCards（raw trace 不丢失） | - |

### V16.4 Codex app-server

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | item/started/completed 序列生成 RunPhaseModel | - |

### V16.4 Codex FileChangeStats

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | modify +2 -1 | - |

### V16.4 provider-native lifecycle

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 同一 AssistantMessage 多个 tool_use 只有一个 evaluation_started | - |
| ✅ | 两个 AssistantMessage 产生两个 evaluation_started | - |

### V16.4 mergeFileChangeStats

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | provider > snapshot > fallback 优先级 | - |

### V16.4-C

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | phaseModel.currentActivity 与 AgentRunDisplayModel.currentActivity 一致 | - |
| ✅ | running header 显示 phaseModel.currentActivity + elapsed（Reading AGENTS.md · 12s） | - |
| ✅ | checking phase running header（Running command） | - |
| ✅ | checking phase running header（Running tests） | - |
| ✅ | buildRunPhaseModel providerStats 覆盖 fallback（additions=100 source=provider） | - |
| ✅ | buildRunPhaseModel snapshotStats 覆盖 fallback（additions=50 source=snapshot） | - |
| ✅ | phase.fileChanges 用合并后的 stats（provider 覆盖 fallback additions=100） | - |
| ✅ | fileChangeCards 用合并后的 stats（provider 覆盖 fallback additions=100） | - |

### V16.4-D

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | thinking_delta + progress-thinking + thinking_delta 合并为一个 ThoughtSegment（同 messageId） | - |
| ✅ | tool 进度不打碎 thinking block（同 messageId 合并，跨 message 新段） | - |
| ✅ | toolUseId 绑定 — Write 不出现在 Reading phase，verify Read 在 Verifying phase | - |
| ✅ | phase label 重算 — create fileChange → 'Created b.md' | - |
| ✅ | phase label 重算 — modify fileChange → 'Modified c.md' | - |
| ✅ | phase label 重算 — checking tool → 'Running tests' | - |
| ✅ | phase 内 tool 不重复（toolUseId 绑定唯一性） | - |
| ✅ | 普通用户态 thoughts 合并为单个 Reasoning 块（不逐词灰块） | - |
| ✅ | 权限 popover 含 5 模式（含 Bypass）+ 外部挂载 + pointerdown close | - |
| ✅ | setPermissionMode 不被 runHandle 阻塞（修复点击无反应） | - |

### P3-C

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 普通用户态 debugView=undefined（不渲染 audit/raw/legacy） | - |
| ✅ | developerMode=true → debugView 含 rawProviderEvents/effectiveRunPlan/attachmentPlan/workflowTrace/sdkEvents | - |
| ✅ | AgentRunDisplayModel 不依赖 WorkflowEvent / RunStateAggregator | - |
| ✅ | turnView 分支不直接调用 appendSdkWorkflow/appendWorkflowTrace（通过 debugView） | - |
| ✅ | historical fallback 分支 sdkEvents 必须 developerMode gated | - |

### P4

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | doNewSession 置空 this.session + this.sessionMode（修复跨会话 PermissionBoundary 泄漏） | - |
| ✅ | PermissionBoundary.resetSessionCache 清空 allowsList（修复跨会话 auto-allow 泄漏） | - |
| ✅ | resetSessionCache 后同类 approval 进入 pending（不再 auto-allow） | - |
| ✅ | PermissionBoundary 接口包含 resetSessionCache 方法 | - |
| ✅ | 死代码 mapWorkflowEventsToNormalized 已删除 | - |
| ✅ | 死代码 buildRuntimeTranscriptFromEvents 已删除 | - |

### P5

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | fileChange mapper 接受 changeIndex 参数（修复多 change 重复第一个 path） | - |
| ✅ | provider 循环传入 changeIndex idx（每个 change 映射为独立事件） | - |
| ✅ | JSON-RPC server request error 使用 top-level error（符合规范） | - |
| ✅ | 三处 error 回复改为 respondToServerRequestError | - |
| ✅ | BridgeSession currentRunId 清理移进 finally + cancel 清理 | - |
| ✅ | provider currentRunId 赋值移进 try 块（setup 抛错时不泄漏） | - |
| ✅ | debugView 脱敏（redactDebugView 函数 + 调用） | - |

### P5 behavior

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | fileChange 3 changes 产出 3 个不同 path/action 事件 | - |
| ✅ | fileChangeCards 路径全部正确（3 个不同 path） | - |
| ✅ | JsonRpcClient handler throw/reject/unsupported → top-level error | - |
| ✅ | redactDebugView 对 token/apiKey/authorization/cookie/password/secret/credential 脱敏 | - |

### P4-D

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SDK dual-path partial+stdout_delta 不重复（我→我现在→我现在运行） | - |
| ✅ | 中英文混合不重复（Obsidian Vault / Claude SDK） | - |
| ✅ | CLI 路径仅 stdout_delta 正常累加（Hello World） | - |
| ✅ | completed reconcile 用完整快照替换 partial 累加 | - |
| ✅ | 重复完整快照不重复（Hello World ×2） | - |
| ✅ | 累积快照模式（Hello → Hello World） | - |
| ✅ | full message + stdout_delta 同文本不重复（你好） | - |
| ✅ | result success text + prior partial deltas 不重复 | - |

### WorkflowEvent→Normalized

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | thinking maps provider-neutral | - |
| ✅ | permission(pending) → approval_request | - |
| ✅ | developerMode fills rawProviderEvent | - |

### UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | view.ts 不再直接 import SdkBackend / ClaudeCliBackend | - |

### UI 主链路

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AssistantTurnViewBuilder 为主状态源（不再 WorkflowEvent 反向映射主流程） | - |

### UI legacy 削减

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | appendLiveSdkEvent/WorkflowEvent 仅 developer/legacy log（普通用户态主链路由 turnView 驱动） | - |

### V16.4-F2 PermissionBoundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | acceptForSession 后同 mergeKey auto-allow | d1=pending resolved=true d2=auto-allow |
| ✅ | canUseTool pending → resolveApproval → promise resumed | decision=pending resolved=true promiseType=accept source=user |

### V16.4-F2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | permissionMode 切换后 rebuildPermissionBoundary 重建 + 行为差异 | mode1=default(true) mode2=acceptEdits(true) oldDecision=pending newDecision=auto-allow |

### V16.4-G Approval

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | decline 只拒绝本次，第二次仍 pending | d1=pending resolved=true d2=pending |
| ✅ | declineForSession 写 deniesList，第二次 auto-deny | d1=pending resolved=true d2=auto-deny |
| ✅ | acceptForSession 仍 auto-allow（回归） | d1=pending resolved=true d2=auto-allow |

### V16.4-G UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | renderRunStatusText 方法 + running/blocked kind 使用 | method=true runningKind=true turnView=true placeholder=true blockedKind=true |
| ✅ | approval card 4 按钮 + deny_once/deny_session 映射 | proceed=true proceedSession=true declineOnce=true declineSession=true mapOnce=true mapSession=true |

### V16.4-G CSS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | run-status-text + glow keyframes + reduced-motion + 旧 spinner display:none + decline-session btn | runStatus=true glow=true reducedMotion=true disablesGlow=true spinnerHidden=true declineBtn=true |

### V16.4-G types

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ApprovalResponse declineForSession + PermissionChoice deny_once/deny_session + Codex mapper | declineForSession=true denyOnce=true denySession=true codexMapper=true |

### V16.4-H UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Needs approval/input header 用 kind=blocked 不含 run-glow | blockedCheck=true blockedNoGlow=true |
| ✅ | Thinking 只出现一次（appendRunningProcessPlaceholder 不重复） | mergedSpan=true thinkingCount=1 |
| ✅ | user input 优先级守卫 + 解析后刷新 approval panel | guard=true resolveRefresh=true |

### V16.4-H CSS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | is-approval-active 隐藏 composerBar | approvalActive=true userInputActive=true |

### V16.5-B normalizeToolName

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | bash/Bash/command/shell/terminal/RunCommand/CommandExecution → Bash | 14 cases |

### V16.5-B assessToolRisk

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | bash/Bash/command/RunCommand 一致 + 不返回 low | bash=high/高风险：Shell 执行 Bash=high/高风险：Shell 执行 command=high RunCommand=high |
| ✅ | command execution 不显示低风险只读文案 | reason="高风险：Shell 执行" level=high |
| ✅ | Bash/bash/CommandExecution 高危场景文案一致 | Bash=high bash=high codex=high |

### V16.5-B resolveApprovalDetailed

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不存在的 requestId 返回 not_found | ok=false reason=not_found |
| ✅ | 二次 resolve 返回 not_found | first.ok=true second.ok=false second.reason=not_found |

### V16.5-B waitForApproval

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | cancelAllPending 后立即返回 cancel | type=cancel elapsed=0ms |
| ✅ | 不存在的 requestId 立即返回 cancel | type=cancel elapsed=0ms |

### V16.5-B view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | boundary.pending 主源 + stale/resolving + Cancel × + resolveApprovalDetailed | boundary=true stale=true cancel=true staleCard=true resolving=true detailed=true |

### V16.5-B CSS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | is-resolving/is-stale/cancel/dismiss-stale/stop-run | resolving=true cancel=true stale=true dismiss=true stop=true |

### V16.5-B handleNormalizedEvent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 只同步缓存 + stale 清理（无 shadow truth） | cacheOnly=true cacheChanged=true staleCleanup=true |

### V16.5-B clearPendingPermissions

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 清空 staleApprovalRequestIds + resolvingApprovalRequestId | stale=true resolving=true |

### V16.5-B runPhaseModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | thoughtKey 去重（messageId/contentBlockIndex/text hash） | thoughtKey=true usesThoughtKey=true noIncludesInPostLoop=true |
| ✅ | thoughtKey 含 messageId/contentBlockIndex/text 指纹 | stableKey=true |

### V16.5-C bridgePromptContract

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 最小三类 section，不堆砌细则 | allPresent=true hasHeaders=true reasonableLen=true capLen=820 autoLen=195 safetyLen=326 |

### V16.5-C contract

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 允许 Obsidian CLI 但要求确认可用性 | mentionsCli=true notBanned=true allowsProbe=true |
| ✅ | 用户确认后继续执行，不反复正文确认 | hasNoRepeat=true hasContinue=true hasDirectAction=true |
| ✅ | write/delete/command 由 host approval 承担 | hasHostApproval=true hasWriteDelete=true hasNoSimulate=true hasHighRiskNotAbandon=true |

### V16.5-C 两套 promptPackage 共用 contract，不维护两套 policy

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V16.5-C 两套 promptPackage 共用 contract，不维护两套 policy | legacyUsesContract=true runtimeUsesContract=true legacyNoStandalone=true runtimeNoStandalone=true |

### V16.5-C late waiter replay

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | resolve 在 waitForApproval 之前，返回 accept | isPending=true resolveOk=true replayCorrect=true responseType=accept source=user |

### V16.5-C approval title canonicalization

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | RunCommand/CommandExecution/shell/exec → Bash | usesNormalize=true allMatch=true |

### V16.5-C cancelAllPending 清理 resolvedMap

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | late waiter 返回 cancel | isCancel=true responseType=cancel |

### V16.5-C resetSessionCache 清理 resolvedMap

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V16.5-C resetSessionCache 清理 resolvedMap | isCancel=true responseType=cancel |

### V16.5-C buildBridgeSystemAppend 瘦身

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | contract 三段 + 简短 attachment/output | cap=true auto=true safety=true attachment=true output=true noOldNative=true noOldSteering=true |

### V16.5-D manifest known-available

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 输出 'Obsidian CLI: available.' | hasAvailable=true notUnknown=true notUnavailable=true |

### V16.5-D manifest unknown

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 输出 'availability unknown; you may probe if useful.' | hasUnknown=true notAvailable=true |

### V16.5-D manifest known-unavailable

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 输出 'unavailable; use other tools.' | hasUnavailable=true notAvailable=true notUnknown=true |

### V16.5-D buildObsidianCliLine

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 三态文案派生正确 | a='- Obsidian CLI: available.' u='- Obsidian CLI: availability unknown; you may probe if useful.' un='- Obsidian CLI: unavailable; use other tools.' |

### V16.5-D buildBridgePromptPackage

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | capabilities 参数传递到 bridgeSystemAppend | hasUnavailable=true notUnknown=true |

### V16.5-D view.ts 主路径注入真实 capabilities

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V16.5-D view.ts 主路径注入真实 capabilities | hasBuilder=true hasPass=true hasImport=true |

### V16.5-D DEFAULT_PROVIDER_CAPABILITIES

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | obsidianCliAvailable 默认 unknown | isUnknown=true hasEvidence=true |

### V16.5-D buildRuntimeCapabilities

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 根据 providerId 派生 providerNativeFileTools | hasProviderCheck=true hasEvidenceProvider=true |

### V16.5-D Autonomy Contract 保持不变

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V16.5-D Autonomy Contract 保持不变 | direct=true noRepeat=true tool=true askUser=true |

### V16.5-D ProviderCapabilityInfo evidence 字段可填充

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V16.5-D ProviderCapabilityInfo evidence 字段可填充 | hasManifest=true hasAvailable=true |

### V16.5-E blocker

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | session 声明在 buildRuntimeCapabilities 之前 | sessionLine=291358 capLine=291503 orderOk=true |
| ✅ | buildBridgePromptPackage 主路径接收 runtimeCapabilities | hasRuntimeCapabilities=true hasPassedToBuilder=true |

### V16.5-E workspace

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 首次初始化创建完整结构 | allCreated=true vaultSkillInitialized=true created=["LLM-AgentRuntime","LLM-AgentRuntime/runtime","LLM-AgentRuntime/skills","LLM-AgentRuntime/skills/vault-context","LLM-AgentRuntime/sessions","LLM-AgentRuntime/work","LLM-AgentRuntime/pi-sessions","LLM-AgentRuntime/README.md","LLM-AgentRuntime/runtime/RUNTIME_FACTS.json","LLM-AgentRuntime/skills/vault-context/SKILL.md"] |
| ✅ | 二次初始化不覆盖已存在文件 | vaultSkillSkipped=true readmeSkipped=true initialized=false |

### V16.5-E RUNTIME_FACTS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 默认 obsidianCliAvailable=unknown | isUnknown=true probeNotProbed=true hasSchema=true |

### V16.5-E VAULT_SKILL 初版

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 包含 Overview/Directory/Agent Workspace facts | header=true vaultRoot=true agentWs=true source=true target=true stableFacts=true |

### V16.5-E VAULT_SKILL

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 已存在文件不被模板覆盖 | skipped=true userEditPreserved=true |

### V16.5-E materialize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | source → .claude/skills/vault-context/SKILL.md | isOk=true hasPaths=true hasMarker=true hasFrontmatter=true hasInstructions=true status=created |
| ✅ | 内容一致时 skipped | status=skipped |
| ✅ | 人工修改后 conflict 不强制覆盖 | isConflict=true status=conflict reason=materialized SKILL.md is not plugin-generated; will not overwrite |

### V16.5-E shouldWriteVaultSkill

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 合法 reason 允许写入 | allLegal=true |

### V16.5-E isVaultSkillWritableContent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 拒绝命令日志，接受稳定事实 | rejected=true accepted=true |

### V16.5-E mergeVaultSkillContent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 超限时 compact，不 append-only 膨胀 | length=7588 max=12000 compacted=false |

### V16.5-E prompt

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 包含 Agent workspace / Vault Skill source / target 事实 | agentWs=true source=true target=true facts=true |
| ✅ | 不注入完整 VAULT_SKILL，只注入路径事实 | hasPath=true notFullContent=true |

### V16.5-E command palette

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 注册 5 个 Agent Runtime 命令 | init=true view=true rebuild=true materialize=true cleanWork=true |

### V16.5-E 兼容

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Autonomy Contract 不回退 | direct=true noRepeat=true |

### V16.5-K compact

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 大 skill compact 后低于阈值时不拆分 | action=compacted beforeLen=15532 afterLen=6442 max=12000 noSplit=true noManifest=true |

### V16.5-K split

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | compact 后仍超限时按职责拆分 | action=split splitSlugs=["vault-structure","file-operations","user-preferences"] structureExists=true indexExists=true manifestEntries=5 manifestHasSplits=true |

### V16.5-K vault-index

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 拆分后索引引用正确 | header=true routing=true allReferenced=true splitSlugs=["vault-structure","file-operations","user-preferences"] |

### V16.5-K 去噪

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 拆分不写入 sessions/work/runtime facts | leaked=false leakedIn=[] vcLeaked=false |

### V16.5-K 碎片化

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 单次临时任务不生成新 skill | rejectedShort=true rejectedTemp=true rejectedCmd=true acceptedStable=true |

### V16.5-K1 runtime format

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 物化后含 frontmatter + # Instructions | vcOk=true vcFrontmatter=true vcInstructions=true vcMarker=true vcSourceHash=true indexFrontmatter=true indexInstructions=true splitRuntime=[{"slug":"vault-structure","hasFrontmatter":true,"hasInstructions":true},{"slug":"file-operations","hasFrontmatter":true,"hasInstructions":true},{"slug":"user-preferences","hasFrontmatter":true,"hasInstructions":true}] |

### V16.5-K1 index-only

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | split 后 vault-context 不含已拆入 facts | vcLen=646 underMax=true splitNotice=true indexPointer=true notRetain=true charCountMatch=true manifestCharCount=646 |

### V16.5-K1 materializeAll

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 单个 conflict 不影响其他 skill | isConflict=true othersOk=true othersCount=4 structureStatus=conflict |

### V16.5-K1 manifest 一致性

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | entries 与源文件一致 | allConsistent=true indexReferencesAll=true mismatches=[] |

### V17-A probe

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不存在的命令返回 not-found 不崩溃 | reason=probe-error available=false error=Dynamic require of "child_process" is not supported |

### V17-A provider

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不存在的命令 isAvailable=false | isAvailable=false probeReason=probe-error |

### V17-A 权限

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 写/命令工具映射为 approval_request 不直通 | writeApproval=true writeRisk=true bashApproval=true |

### V17-A 解析

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 读工具→tool_start / 消息→message / 非JSON→stdout_delta | readToolStart=true notApproval=true message=true stdout=true |

### V17-A isWriteToolCall

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 写/命令工具判定 | write=true edit=true bash=true read=true glob=true |

### V17-A providerTarget

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | .claude/.agents/.pi 路径正确 | claude=.claude/skills/vault-context/SKILL.md generic=.agents/skills/vault-structure/SKILL.md pi=.pi/skills/vault-index/SKILL.md |

### V17-A materialize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 物化到 .agents/skills 和 .pi/skills 含 frontmatter | genericOk=true piOk=true genericExists=true piExists=true genericFormat=true piFormat=true |

### V17-A materializeAll

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 所有 skill 物化到所有 target + manifest providerTargets | entriesWithTargets=5/5 allTargetsMaterialized=true resultCount=15/15 |

### V17-A settings

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | backendProfile/piCommand 字段存在且合法 | backendProfile=true(developer) piCommand=true piArgs=true valid=true |

### MockAgentBackend

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | success 模式 | started=true, completed=true, stdout=true |
| ✅ | failure 模式 | failed=true, stderr=true |

### buildEnhancedPath

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回字符串 | - |
| ✅ | 包含 Vault 局部路径 | - |
| ✅ | 路径去重无重复 | - |
| ✅ | Vault 局部路径优先 | - |

### buildRunEnv

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claude+model → ANTHROPIC_MODEL | - |
| ✅ | claude+effort → CLAUDE_CODE_EFFORT_LEVEL | - |
| ✅ | env.ANTHROPIC_MODEL 值正确 | - |
| ✅ | env.CLAUDE_CODE_EFFORT_LEVEL 值正确 | - |
| ✅ | claude 无 model → 不含 ANTHROPIC_MODEL | - |
| ✅ | claude 无 effort → 不含 CLAUDE_CODE_EFFORT_LEVEL | - |
| ✅ | custom agent 不注入 ANTHROPIC_MODEL | - |
| ✅ | envKeys 含 PATH(enhanced) | - |
| ✅ | env.PATH 已被增强 | - |
| ✅ | envKeys 不含 secret 值 | - |
| ✅ | 自动发现项目级 LLM-AgentRuntime config | - |
| ✅ | .llm-bridge/claude-runtime.json 优先于自动发现 | - |
| ✅ | 项目配置命中时未声明 config 不混入全局环境 | - |

### SdkBackend

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | query 调用使用项目级 Claude runtime env 并恢复 | - |

### Claude runtime config

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不再设置 ANTHROPIC_CONFIG_DIR | - |

### resolveCommand

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claude 解析 | - |
| ✅ | codex 解析 | - |
| ✅ | custom + trim/多空格 | - |
| ✅ | 空 args → [] | - |

### probeDir

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 存在的目录返回路径 | - |
| ✅ | 不存在的目录返回 null | - |
| ✅ | 文件路径返回 null | - |

### UI 映射

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | started → running | got running |
| ✅ | stdout_delta → running | got running |
| ✅ | stderr_delta → running | got running |
| ✅ | completed → completed | got completed |
| ✅ | failed → failed | got failed |
| ✅ | stopped → stopped | got stopped |
| ✅ | isTerminalEvent 判定 | started=false, completed=true, failed=true, stopped=true |

### Profile

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claude 解析 command/args | name=true, cmd=true, args=true, version=true; got cmd=claude args=["-p","--foo"] |
| ✅ | codex 解析 command/args | name=true, cmd=true, args=true, version=true; got cmd=codex args=["exec","-"] |
| ✅ | custom trim command 保留 args | cmdTrimmed=true, argsOk=true; got cmd="mycmd" args=["a","b","c"] |
| ✅ | 空 args → [] | got args=[] |
| ✅ | 空 command trim 后为空串 | got cmd="" |

### File Diff

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | shouldExclude 排除目录 | - |
| ✅ | isMarkdownFile 只识别 .md | - |
| ✅ | diffSnapshots 检测新增/修改/未变化 | - |
| ✅ | mtime 变化→MODIFIED | - |
| ✅ | extractRelPath 去掉后缀 | - |
| ✅ | snapshotVaultMarkdownFiles 真实扫描（排除+空格路径） | - |
| ✅ | snapshot+diff 端到端（新增+修改） | - |
| ✅ | EXCLUDE_DIRS 完整性 | - |

### Bridge Sync

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 首次写入 bridge.json | - |
| ✅ | port 改变时 bridge.json 被覆盖（旧文件不再使用） | - |
| ✅ | 旧 bridge.json 不会被继续使用 | - |
| ✅ | bridge.json 写入路径基于 vaultPath | - |
| ✅ | helper 包含 shouldRetry + loadBridge 重读逻辑 | - |
| ✅ | helper loadBridge 读取最新 bridge.json（401 后重读生效） | - |
| ✅ | 日志不包含 token 明文（只输出 tokenPresent/tokenLength） | - |
| ✅ | onload 诊断文件不包含 token 明文 | - |
| ✅ | BridgeInfo 包含所有必需字段（version/host/port/token/vaultPath/startedAt/pluginVersion） | - |

### Preset

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | summarize 包含 outputDir / 文件路径 / -summary 后缀 | - |
| ✅ | summarize 无活动笔记时使用通用 prompt（不含 null） | - |
| ✅ | explain 只含指令，不含文件路径（选区由 includeSelection 注入） | - |
| ✅ | freeform 返回空字符串 | - |
| ✅ | requiresActiveNote / requiresSelection 正确映射 | - |
| ✅ | PRESETS 含 3 种类型（不含 organize/review） | - |
| ✅ | outputDir 为空时使用默认目录 | - |
| ✅ | 不自动注入笔记全文（正文由 promptPackage 注入） | - |

### Preflight

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | null 结果映射为 unknown | - |
| ✅ | available 状态含 version | - |
| ✅ | unavailable 状态含退出码原因 | - |
| ✅ | command 为空时 detail 含 skipReason | - |
| ✅ | cwd 不存在 → failed diagnostic | - |
| ✅ | command 不存在 → unavailable | - |
| ✅ | version 成功 → available | - |
| ✅ | command 为空 → unavailable | - |
| ✅ | debug log 不含 secret | - |
| ✅ | 路径带空格可运行 | - |
| ✅ | claude 真实命令探测 | available=true, stdout="2.1.200 (Claude Code)
" |
| ⏭️ | codex 真实命令探测 | codex 未安装或不可用 (exitCode=1) |

### ErrorSummary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不包含 48-hex token 明文（替换为 <token>） | - |
| ✅ | 不包含 sk-ant API key 明文（替换为 <api-key>） | - |
| ✅ | 不包含 Bearer token 明文 | - |
| ✅ | 不包含 ANTHROPIC_API_KEY 值 | - |
| ✅ | 包含 exit code | - |
| ✅ | 空 stderr + null exitCode 返回空字符串 | - |
| ✅ | 截断到 maxLen | - |

### redactSecret

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 替换 token / api-key / Bearer | - |

### Guide V1.8

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | buildFirstUseGuide 返回 3 个步骤 | - |
| ✅ | 步骤用户导向（含 Claude Code/打开笔记/总结当前笔记，不含 Backend/Preflight） | - |
| ✅ | 步骤 index 连续从 1 开始（3 步） | - |

### Guide V1.2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | shouldShowFirstUseGuide 正确映射 dismissed 标志 | - |
| ✅ | 含 footer 文本 | - |

### Timeline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | mapStatusToTimelineType 终态映射正确（running/idle 返回 null） | - |
| ✅ | timelineTypeLabel / timelineTypeClass 全类型有值 | - |
| ✅ | isTerminalTimelineType 仅终态返回 true | - |
| ✅ | buildTimeline 首条 started / 末条终态 / 含中间事件 | - |
| ✅ | buildTimeline 无中间事件时仅 started + 终态 | - |
| ✅ | buildTimeline 非终态（running）不追加终态条目 | - |

### CommandProfile

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | buildCommandLine 基础 claude = [claude -p] | - |
| ✅ | buildCommandLine codex = [codex exec -] | - |
| ✅ | continue=true 追加 --continue | - |
| ✅ | continue 优先于 resume（resume 被忽略） | - |
| ✅ | resume 单独使用追加 --resume <id> | - |
| ✅ | permissionMode=acceptEdits 追加 --permission-mode acceptEdits | - |
| ✅ | permissionMode=default 不追加 flag | - |
| ✅ | extraArgs 按空白拆分 | - |
| ✅ | codex/custom 不应用 Claude 动态参数 | - |
| ✅ | buildCommandLine 组合 continue+permission+extra | - |
| ✅ | buildRedactedCommandDisplay 脱敏（无 secret/prompt 内容，含 cwd/model/stdin） | - |
| ✅ | previewToRows 含 command/args/cwd/session/permission 行 | - |
| ✅ | default 模式 previewToRows 不含 session/permission 行 | - |
| ✅ | resolveProfile 兼容旧接口结构 | - |
| ✅ | stdin 行只显示长度，不显示 prompt 内容 | - |

### V16.3 CommandProfile

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | previewToRows 含 token estimate（note ~100, selection ~20） | - |
| ✅ | activeNoteContentLength=0 → token estimate=0（语义一致） | - |

### WorkflowTrace

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | mapStatusToWorkflowStage 终态映射正确 | - |
| ✅ | isTerminalWorkflowStage 判断终态 | - |
| ✅ | buildWorkflowTrace 阶段顺序 preflight→build→spawn→stdout→diff→completed | - |
| ✅ | failed 状态追加 failed 终态，file_diff_scan 标记 skipped | - |
| ✅ | stopped 终态 + preflight=null 标记 skipped | - |
| ✅ | running 不追加终态条目 | - |
| ✅ | file_diff_scan 详情含变更文件数 | - |
| ✅ | workflowStageLabel / workflowStageClass 覆盖所有阶段 | - |

### V1.6 redactSecrets

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 脱敏 sk-ant/sk-/Bearer/password/api_key | - |

### V1.6 redactWorkflowEvent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回新事件，原事件不变 | originalIntact=true redactedOk=true typePreserved=true |
| ✅ | tool_start/tool_result/error 字段脱敏 | - |

### V1.6 workflowEventLabel/Class/isFatalError

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 事件映射正确 | label=true class=true fatal=true |

### V1.6 buildToolTimeline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 配对 tool_start/tool_result，未配对保持 running | count=true pair1=true pair2=true unpaired=true |

### V1.6 extractFileChanges

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 只提取 file_change 事件 | - |

### V1.6 truncateText

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 超长截断加省略号 | - |

### V1.6 SdkBackend fallback

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SDK 不可用时产出 AgentEvent v0.1 + mock workflow | startedFirst=true hasCompleted=true hasStdout=true wfHasTypes=true notRunning=true |

### V1.6 SdkBackend

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | onWorkflowEvent 收到的事件已脱敏 | - |
| ✅ | stop() 发出 stopped 事件且 handle 不再 running | hasStopped=true notRunning=true |

### V1.6 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 不产生 workflow 事件 | hasStdout=true noWfEvents=true wfCount=0 |

### V1.6 isSdkAvailable

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 探测不抛异常 | available=false |

### V1.7 mapSdkMessageToWorkflowEvents

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | assistant text/tool_use/file_change 映射 | hasMsg=true hasReadStart=true hasWriteStart=true readNoFc=true writeFc=true noTerminal=true |
| ✅ | user tool_result 映射（含 error 标记） | ok1=true ok2=true |
| ✅ | system init + permission_denied | initOk=true permOk=true |
| ✅ | result success/error 终态 | successOk=true errorOk=true |
| ✅ | 未知消息类型忽略 | events=0 terminal=null partial=false |
| ✅ | 映射层保留原文（脱敏由调用方负责） | - |

### P4-D mapSdkMessageToWorkflowEvents

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | subtype=success && is_error=true 不产生 'SDK error: success' | msg="SDK 标记成功但 is_error=true（逻辑异常，请检查 SDK 版本与调用参数）" |
| ✅ | subtype=success && is_error=true 优先使用 errors 数组 | msg="real error reason" |
| ✅ | errors 空时 fallback 到 result 文案 | msg="detailed error info" |

### V2.16-G mapSdkMessageToWorkflowEvents

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | stream_event 标记 partial 并保留 progress | partial=true events=1 terminal=null |

### V1.7 detectFileChangeFromToolUse

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Write/Edit/MultiEdit 产生 fc，Read/Bash/无路径 返回 null | writeOk=true editOk=true multiOk=true readOk=true bashOk=true noPathOk=true |

### V1.7 serializeToolInput/serializeToolResultContent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 截断与数组拼接 | shortOk=true longOk=true strOk=true arrOk=true longStrOk=true |

### V1.7 createInitialDiagnostics/updateDiagnostics

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 初始值 + 不可变更新 | initialOk=true updateOk=true immutableOk=true |

### V1.7 formatDiagnosticsForLog

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 格式化字段完整 + fallback 原因 | hasFields=true fbOk=true |

### V1.7 SdkBackend fallback

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | lastDiagnostics 记录 available=false + fallbackReason | - |

### V1.7 SdkBackend

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | onWorkflowEvent 事件已脱敏（mock workflow 含 sk-ant key） | noRawKey=true hasRedacted=true |
| ✅ | stop() 发出 stopped 事件且 handle 不再 running | hasStopped=true notRunning=true |

### V1.7 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 不产生 workflow 事件（V1.7 验证） | hasStdout=true noWfEvents=true wfCount=0 |

### V1.7 isSdkAvailable

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 探测不抛异常（V1.7 验证） | available=false |

### V1.8 核心流 summarize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | prompt 含总结/文件路径/输出目录/-summary 后缀 | hasSummarize=true hasFilePath=true hasOutputDir=true hasSummarySuffix=true |

### V1.8 核心流 explain

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | prompt 含解释/选中文本，不依赖文件路径 | hasExplain=true hasContext=true noFilePath=true |

### V1.8 核心流 freeform

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回空字符串（仅聚焦输入框） | prompt="" |

### V1.8 PRESETS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 恰好 3 个主入口（freeform/explain/summarize） | types=freeform,explain,summarize |

### V1.8 requiresActiveNote/requiresSelection

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 3 流映射正确 | - |

### V1.8 onboarding

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 3 步用户导向，步骤正文不含 mock/sdk-experimental/Backend 技术词 | is3Steps=true titleOk=true noTechInBody=true |

### V1.8 shouldShowFirstUseGuide

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | dismissed 逻辑不变 | - |

### V1.8 SDK fallback 不影响主流程

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | completed + handle 翻转 | hasCompleted=true notRunning=true |

### V1.8 CLI 主线不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | auto 模式正常产出 stdout | hasStdout=true |

### V1.8 零配置可用

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | summarize 无 activeFilePath 仍可构造 prompt | hasSummarize=true hasOutputDir=true noNullPath=true |

### V2.0 thinking 映射

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | assistant 含 thinking block → ThinkingEvent | hasThinking=true hasMessage=true notTerminal=true |

### V2.16-H thinking summary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | redacted_thinking summary → ThinkingEvent | hasSummary=true |

### V2.0 completed 终态

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | result success → message + completed 事件 | hasCompleted=true terminalCompleted=true |

### V2.16-G SDK streaming

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | deriveAssistantTextDelta 兼容 snapshot/block 并去重 | first="Hello" snapshot=" world" block=" world" duplicate="" |
| ✅ | partial stream/progress 映射并增量输出 | - |

### V2.0 failed 终态

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | result error → error + failed 事件 | hasFailed=true hasError=true terminalFailed=true |

### V2.0 tool durationMs

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 配对计算耗时，未配对为 null | durationOk=true unpairedOk=true |

### V2.0 diagnostics errorSummary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 初始 null + 不可变更新 | initialNoError=true updateOk=true |

### V2.0 formatDiagnosticsForLog

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 errorSummary 字段 | hasErrorSummary=true hasPackage=true |

### V2.0 mock workflow

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 thinking + completed + tool_start（复杂 fixture） | hasThinking=true hasCompleted=true hasToolStart=true |

### V2.0 mock failure workflow

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 error + failed 终态 | hasFailed=true hasError=true |

### V2.0 redactWorkflowEvent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | thinking/completed/failed 脱敏 | thinkingRedacted=true completedIntact=true failedRedacted=true |

### V2.0 workflowEventLabel/Icon/Class

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 覆盖 thinking/completed/failed | tL=true cL=true fL=true tC=true cC=true fC=true tI=true cI=true fI=true |

### V2.16-G partial

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | stream_event 映射 assistant text delta | partialOk=true |

### V2.0 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 不产生 workflow 事件 | hasStdout=true noWfEvents=true wfCount=0 |
| ✅ | ClaudeCliBackend 可正常加载 | ClaudeCliBackend=function |

### V2.16-H timeline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | thinking 聚合为单块且不再生成 final_message 重复节点 | thoughts=1 final=0 completed=1 detail=~74 tokens · +16 |
| ✅ | 用户态隐藏 session/text/raw tool input，仅保留语义过程节点 | - |

### V2.0 createNewSession

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 初始 idle/新会话/0/null | title=新会话 status=idle count=0 startedAt=null |

### V2.0 generateSessionTitle

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 短消息原样返回 | title=总结这个笔记 |
| ✅ | 长消息截断加 … | title=这是一段非常长的用户消息需要被截断到三十个字符以内才能作为会… len=31 |
| ✅ | 空消息返回 新会话 | title1=新会话 title2=新会话 |

### V2.0 sessionStatusLabel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 5 种 RunStatus 标签 | {"idle":"Idle","running":"Running","completed":"Done","failed":"Failed","stopped":"Stopped"} |

### V2.0 sessionStatusClass

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | is-{status} 格式 | idle=is-idle running=is-running |

### V2.0 updateSession

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不可变更新（原对象不变） | s1.title=新会话 s2.title=测试标题 sameRef=false |

### V2.0 parseSkillsMarkdown

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 解析多个 skill（name/desc/prompt） | count=2 s0=总结笔记 s1=解释选区 |
| ✅ | 空内容/无二级标题返回 [] | empty=0 noH2=0 |
| ✅ | 无 prompt 的 skill（prompt 为空字符串） | name=自由提问 prompt="" |
| ✅ | # 忽略，### 不识别，仅 ## 识别 | count=1 name=真正的 skill |

### V2.1 buildSkillsTemplate

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回含 5 个默认 skill 的模板 | len=458 hasSkills=true |

### V2.0 SKILLS_FILE_REL

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 路径为 .llm-bridge/skills.md | path=.llm-bridge/skills.md |

### V2.0 secret 不泄露

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 sk-ant 的消息截断为短标题 | titleLen=31 (<=31) |

### V2.1 默认包解析

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 5 个 skill 名称顺序正确 | count=5 names=总结当前笔记|解释选区|整理为结构化笔记|提取待办/行动项|改写润色 |

### V2.1 filterEnabledSkills

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 过滤禁用项保留顺序 | enabled=3 names=总结当前笔记|整理为结构化笔记|提取待办/行动项 |
| ✅ | 空 disabled 返回全部副本 | enabled=5 isCopy=true |
| ✅ | 未知禁用名返回全部 | enabled=5 |

### V2.1 expandSkillPrompt

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 替换 {{outputDir}} 占位符 | out=写入 90_AI整理 下，再 90_AI整理 一次 |
| ✅ | 无占位符返回原串 | out=无占位符的 prompt |

### V2.1 redactSkillForLog

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 脱敏 sk-ant-api03 且保留 name/desc | promptRedacted=key=sk-ant-api03-*** 勿泄露 |
| ✅ | 无 secret 时 prompt 原样 | promptRedacted=请总结当前笔记 |

### V2.1 seedDefaultSkills

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不存在时写入 5 skill 并返回 true | seeded=true exists=true parsed=5 |
| ✅ | 已存在不覆盖返回 false | seeded=false preserved=true |

### V2.1 loadSkills

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 缺失配置文件返回 [] fallback | count=0 |

### V2.1 prompt 注入

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | expand 后含实际目录无占位符 | hasDir=true noPlaceholder=true |

### V2.1 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可加载 | ClaudeCliBackend=function |

### V2.3 权限分级

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | low/medium/high 分类 | low=low med=medium high=high |

### V2.3 权限决策

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | medium 策略矩阵 | low=auto_allow high=needs_approval med=needs_approval |
| ✅ | low 策略 medium 自动允许 | decision=auto_allow |
| ✅ | high 策略 low 需审批 | decision=needs_approval |

### V2.3 会话级 allow

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 同类操作自动通过 | decision=session_allowed |

### V2.3 会话级 deny

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 重新询问 | decision=needs_approval |

### V2.3 extractPathPattern

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 目录前缀提取 | p1=notes/sub/ p2= p3= |

### V2.3 权限标签

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | policy/level 文本 | policy=标准 level=高 |

### V2.3 Skills 导入

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 写入并识别 | ok=true imported=true |

### V2.3 Skills 删除

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 删除后不再识别为导入 | deleted=true stillImported=false |

### V2.3 Skills 扫描

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 检测 API key / Bearer / 凭证 | clean=0 apikey=1 bearer=1 cred=1 |

### V2.3 Skills 脱敏

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | redacted 不含原 key | redactedContainsKey=false |

### V2.3 Skills 截断

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 超长截断，短文保留 | truncatedLen=8020 shortLen=5 |

### V2.3 Skills 序列化

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | markdown 格式正确 | hasName=true hasDesc=true hasPrompt=true |

### V2.3 Skills 加载

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 空目录返回空数组 | count=0 |

### V2.3 SDK 映射

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | subagent 消息携带 sessionId/parentToolUseId | msgOk=true toolOk=true |
| ✅ | 主 agent 无 parentToolUseId | sessionId=sess-main parentToolUseId=undefined |
| ✅ | 终态 completed 事件携带 sessionId | sessionIdOk=true noDuplicateMsg=true terminal=completed |
| ✅ | 无 session_id 向后兼容 | sessionId=undefined parentToolUseId=undefined |

### V2.3 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 仍可实例化 | isFunc=true hasRun=true |

### V2.3s permissionMode 映射

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 6 种模式均有中文标签/风险/等级 | all 6 modes ok |

### V2.3s listPermissionModes

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回 6 项 | length=6 |

### V2.3s permissionMode 风险等级

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | default=safe, bypass=danger, plan=safe, dontAsk=danger | default=safe bypass=danger plan=safe dontAsk=danger |

### V16.4-E2 SDK canUseTool

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AskUserQuestion 禁止 direct allow，改走 user input bridge | ask=true snake=true read=true directAllowRemoved=true bridge=true |

### V16.4-E2 AskUserQuestion runtime bridge

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pending → render card → submit → resolved → SDK answer | pending=true requestEvent=true renderCard=true resolved=true resolvedEvent=true sdkAnswer=true |

### V16.4-E2 AskUserQuestion timeout

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 默认 10 分钟后自动 cancel | timeoutMs=600000 |

### V16.4-F runtimePermission

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AgentTask + provider 注入 + canUseTool 走 PermissionBoundary | task=true inject=true canUseTool=true |

### V2.3s assessToolRisk

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Read=low, Edit=medium, Bash=high | Read=low Edit=medium Bash=high |
| ✅ | .env 和 .obsidian 触发高风险标记 | env=Vault 外绝对路径,.env 环境文件 obsidian=.obsidian 配置目录 |
| ✅ | rm -rf 触发递归删除标记 | flags=Shell 执行,递归删除命令 |

### V2.3s decideByMode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | bypassPermissions → allow (mode) | behavior=allow source=mode |
| ✅ | plan+medium → deny (mode) | behavior=deny source=mode |
| ✅ | dontAsk → allow (mode) | behavior=allow source=mode |

### V2.3s checkSessionAllow

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 同工具同路径缓存命中 | hit=true |
| ✅ | 不同路径不命中 | hit=false |

### V2.3s checkSessionDeny

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 同工具缓存命中 | hit=true |

### V2.3s buildRequestMergeKey

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 同工具同目录合并，不同工具不合并 | key1=Edit:medium:notes/ key2=Edit:medium:notes/ key3=Write:medium:notes/ |

### V2.3s assessSubagentPermissionRisk

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | bypassPermissions + subagent → risky | risky=true warning=subagent 继承主 agent 的「跳过权限（危险）」权限，可执行高风险操 |
| ✅ | plan + subagent → not risky | risky=false |
| ✅ | 非 subagent → not risky | risky=false |

### V2.3s extractToolPathPattern

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 提取目录前缀 | p1=notes/sub/ p2= |

### V2.3s SdkBackend.resolvePermission

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 未知 requestId → false | ok=false |

### V2.3s SdkBackend.clearSessionPermissions

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 清空 allows/denies | allows=0 denies=0 |

### V2.3s createPermissionState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回空状态 | allows=0 denies=0 pending=0 |

### V16.4-D summarizeToolInput

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 数组对象显示为 N items，且不输出 [object Object] | summary=questions: 2 items |
| ✅ | 对象显示为 { key1, key2 } | summary=questions: { key1, key2 } |
| ✅ | 已字符串化对象数组仍不输出 [object Object] | summary=questions: 2 items |

### V2.3s PermissionEvent 脱敏

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | inputSummary 中 API key 被替换 | hasSecret=false hasRedaction=true |
| ✅ | description 中凭证被替换 | hasSecret=false |

### V2.3s CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 仍可实例化且有 run() | isFunc=true |

### V2.3s SdkBackend

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 实例化且 name='sdk' | name=sdk |

### V2.3.2 decideByMode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | auto+high → ask（不自动允许） | behavior=ask source=mode |
| ✅ | auto+medium → ask | behavior=ask |
| ✅ | auto+low → allow | behavior=allow |
| ✅ | acceptEdits+high → ask | behavior=ask |
| ✅ | acceptEdits+medium → allow | behavior=allow |
| ✅ | default+high → ask | behavior=ask |
| ✅ | default+medium → ask | behavior=ask |
| ✅ | default+low → allow | behavior=allow |
| ✅ | bypassPermissions+high → allow（显式放行） | behavior=allow source=mode |
| ✅ | dontAsk+high → allow | behavior=allow |
| ✅ | ask 返回 reason 含高风险/需用户确认提示 | reason=自动决策：high 风险需用户确认（高风险：Shell 执行、递归删除命令） |

### V2.4 decideByMode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | plan+low → allow（只读操作允许） | behavior=allow |

### V2.3.2 文案

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | auto 模式风险说明含 Safety Gate 提示 | risk=低风险自动允许；中/高风险必须用户确认，不自动放行（V2.3.2 Safety  |
| ✅ | bypassPermissions 风险说明含显式选择提示 | risk=跳过所有权限检查（含删除/Shell/网络）；仅开发者显式选择时放行，非默认。 |

### V2.3.2 high-risk

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | assessToolRisk Bash+rm → high 含 highRiskFlags 与 reason | level=high flags=2 reason=高风险：Shell 执行、递归删除命令 |

### V2.4 SDK sibling runtime

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回 2 个候选目录 | length=2 |
| ✅ | vault 内优先 + sibling 次之 | dirs=C:\vault\mywiki\LLM-AgentRuntime | C:\vault\LLM-AgentRuntime |

### V2.4 plan 权限

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | low 只读操作自动允许 | behavior=allow reason=只读规划：低风险只读操作自动允许 |
| ✅ | medium 编辑操作拒绝 | behavior=deny reason=只读规划：medium 风险操作拒绝（只读模式不允许修改/删除/Shell/网络 |
| ✅ | high Shell 操作拒绝 | behavior=deny reason=只读规划：high 风险操作拒绝（只读模式不允许修改/删除/Shell/网络） |
| ✅ | low reason 含低风险只读说明 | reason=只读规划：低风险只读操作自动允许 |

### V2.4 plan 文案

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含低风险自动允许与中/高拒绝说明 | risk=低风险只读操作（读文件/列目录/查询状态）自动允许；中/高风险（编辑/删除/Shell/网络）拒绝；适合规划与调研。 |

### V2.4 Skills 导入一致性

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | importSkillFromFile 用 skill 名称存储 | ok=true importedBySkillName=true |

### V2.4 Skills 删除一致性

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用 skill 名称可删除导入文件 | deleted=true stillImported=false |

### V2.4 UI 默认折叠

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Advanced 区默认 hidden + 可展开 | toggle=true hidden=true handler=true |
| ✅ | Command Preview body 默认 hidden | body=true hidden=true |

### V2.4 Preflight 缓存失效

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | agent 切换 + 手动刷新均重置 | agentChange=true refresh=true |

### V2.4 Mode chip 移除

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 无 modeChipGroup 字段与 refresh 调用 | field=false refresh=false |

### V2.4 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | name=claude-cli |

### V2.4 PATH sibling

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | buildEnhancedPath 含 vault 内 + sibling 两种布局 | count=2 |

### V2.4 secret 脱敏

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Anthropic API key 替换为 *** | redacted=key=sk-ant-api03-*** |
| ✅ | redactWorkflowEvent 脱敏 tool_start toolInput | toolInput=command="export ANTHROPIC_API_KEY=******" |

### V2.5 Skills 编辑

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 更新描述与 prompt（名称不变） | ok=true desc=新描述 prompt=新 prompt 内容 |
| ✅ | 重命名（旧删除新写入） | ok=true hasNew=true hasOld=false |
| ✅ | 重命名冲突返回 false | ok=false |
| ✅ | 不存在的 skill 返回 false | ok=false |

### V2.5 Skills 搜索

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 空 query 返回全部 | filtered=2 total=2 |
| ✅ | 按名称子串过滤 | filtered=1 name=重命名后 |
| ✅ | 按描述子串过滤 | filtered=1 |
| ✅ | 无匹配返回空 | filtered=0 |

### V2.5 Skills 冲突

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 已存在返回 true | conflict=true |
| ✅ | 不存在返回 false | conflict=false |

### V2.5 Skills 注入脱敏

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | API key 检测不回归 | warnings=1 |

### V2.5 Skills 注入截断

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 超长截断不回归 | orig=10000 trunc=8020 |

### V2.5 Session 保存

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回非空 id | id=s-2026-07-05T06-44-52-210Z-dxnkct |

### V2.5 Session 版本

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | loadSession 返回 version=2 | version=2 expected=2 |
| ✅ | SESSION_SCHEMA_VERSION = 2 | version=2 |

### V2.5 Session 加载

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回完整消息与 generatedFiles | msgs=1 files=1 |

### V2.5 Session 列表

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 按 savedAt 降序（最新在前） | len=5 first=s-2026-07-05T06-44-52-284Z-x4sky0 second=s-2026-07-05T06-44-52-223Z-5zqurk |
| ✅ | 空目录返回空数组 | len=0 |

### V2.5 Session 删除

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 删除后 loadSession 返回 null | ok=true session=null |
| ✅ | 不存在返回 false | ok=false |

### V2.5 Session 安全写入

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 失败返回 null 不抛异常 | id=null |

### V2.5 Session 脱敏

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | redactSessionMessages 脱敏 content/stderr/log | contentLeak=false |
| ✅ | 写入文件不含 secret 明文 | leak=false |

### V2.5 Session id

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 生成 s- 前缀且唯一 | id1=s-2026-07-05T06-44-52-314Z-fb8sgr id2=s-2026-07-05T06-44-52-314Z-g1isik |

### V2.5 Session 上限

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | MAX_SESSIONS_KEPT 在 10-200 之间 | max=50 |

### V2.5 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | name=claude-cli |

### V2.5 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | mode=auto |

### V2.5 默认设置

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | disabledSkills 为空数组 | disabled=0 |

### V2.6 extractTags

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 提取多个标签 | desc="将选区翻译为英文" tags=["翻译","常用"] |
| ✅ | 无标签返回原文本 | desc="纯描述没有标签" tags=[] |
| ✅ | URL 中的 # 不被匹配 | desc="访问 https://example.com/page#section 详情" tags=[] |
| ✅ | 空字符串 | desc="" tags=[] |

### V2.6 parseSkillsMarkdown

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 提取 tags | name=翻译 desc="将选区翻译为英文" tags=["翻译","常用"] |
| ✅ | 无标签 skill tags 为空数组 | tags=[] |

### V2.6 serializeSkillToMarkdown

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 保留 tags（往返一致） | name=翻译 desc="将选区翻译为英文" tags=["翻译","常用"] prompt="请将选中文本翻译为英文。" |

### V2.6 searchSkills

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | #标签语法匹配 | count=1 names=翻译 |
| ✅ | 普通查询匹配 tags | count=1 names=A |
| ✅ | tags 无匹配返回空 | count=0 |

### V2.6 createEmptySkillsState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | version=1 skills={} lastCombo=[] | version=1 skills=0 combo=0 |

### V2.6 SKILLS_STATE_VERSION = 1

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V2.6 SKILLS_STATE_VERSION = 1 | version=1 |

### V2.6 SKILLS_STATE_FILE_REL = .llm-bridge/skills-state.json

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V2.6 SKILLS_STATE_FILE_REL = .llm-bridge/skills-state.json | rel=.llm-bridge/skills-state.json |

### V2.6 loadSkillsState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 文件不存在返回空 state | version=1 skills=0 |
| ✅ | 损坏 JSON 返回空 state | version=1 skills=0 |

### V2.6 saveSkillsState + loadSkillsState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 往返一致 | ok=true version=1 count=1 pinned=true combo=["翻译","总结"] |

### V2.6 saveSkillsState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 原子写（tmp 无残留，主文件存在） | ok=true tmp=false main=true |
| ✅ | 失败不抛异常返回 false | ok=false |

### V2.6 recordSkillApplied

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | applyCount+1 且 lastUsedAt 更新 | before=0 after=1 lastUsedAt=2026-07-05T06:44:52.393Z |
| ✅ | 累计 applyCount=3 | count=3 |

### V2.6 setSkillPinned

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | true/false 切换 | pinned=true unpinned=false |

### V2.6 setSkillGroupOverride

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 设置与清除 | g1=自定义分组 g2=undefined |

### V2.6 recordCombo

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 更新 lastCombo 且为副本 | combo=["A","B","C"] |

### V2.6 getSkillMeta

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不存在返回默认值 | count=0 lastUsedAt=null pinned=undefined |

### V2.6 formatRelativeTime

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | null 返回未使用 | label=未使用 |
| ✅ | 刚刚 | label=刚刚 |
| ✅ | 损坏 ISO 返回未使用 | label=未使用 |

### V2.6 不可变性

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | recordSkillApplied 不修改原 state | sameRef=false |
| ✅ | setSkillPinned 不修改原 state | sameRef=false |

### V2.6 文件版本

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 保存的文件含 version=1 字段 | ok=true version=1 |

### V2.6 state 安全

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 文件不含 prompt 正文 | hasPrompt=false |

### V2.6 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | type=object run=function |

### V2.6 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | mode=auto |

### V2.6 默认设置

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | disabledSkills 为空数组 | disabled=0 |

### V2.7 migrateSession

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 有效 v1 完整对象返回规整结果 | - |
| ✅ | version 缺失返回 null | out=null |
| ✅ | 高版本不降级返回 null | out=null |
| ✅ | id 缺失返回 null | out=null |
| ✅ | messages 非数组返回 null | out=null |
| ✅ | messageCount 非数字返回 null | out=null |
| ✅ | null 输入返回 null | out=null |
| ✅ | 字符串输入返回 null | out=null |
| ✅ | title 非字符串用默认值 | title=新会话 |
| ✅ | status 非字符串用默认 idle | status=idle |
| ✅ | startedAt 非字符串为 null | startedAt=null |
| ✅ | agentType 非字符串用默认 claude | agentType=claude |
| ✅ | savedAt 非字符串用当前时间 | savedAt=2026-07-05T06:44:52.485Z |

### V2.7 SESSION_SCHEMA_VERSION = 2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V2.7 SESSION_SCHEMA_VERSION = 2 | version=2 |

### V2.7 loadSkillsState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 过滤无效 SkillMeta 字段 + lastCombo 非字符串 | - |
| ✅ | version 过高返回空 state | v=1 skills=0 |

### V2.7 saveSkillsState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 首次写入无 .bak（无旧文件） | saved=true main=true bak=false |
| ✅ | 第二次写入生成 .bak（备份第一次内容） | mainHasSecond=true bakHasFirst=true |

### V2.7 buildCliSessionContext

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | continue 模式 | ctx={"mode":"continue","sessionId":null,"source":"cli"} |
| ✅ | resume 模式 | ctx={"mode":"resume","sessionId":"abc-123","source":"cli"} |
| ✅ | resume id 仅空白 → fresh | ctx={"mode":"fresh","sessionId":null,"source":"cli"} |
| ✅ | fresh 模式 | ctx={"mode":"fresh","sessionId":null,"source":"cli"} |

### V2.7 buildSdkSessionContext

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | resume 模式 | ctx={"mode":"resume","sessionId":"xyz-456","source":"sdk"} |
| ✅ | null → fresh | ctx={"mode":"fresh","sessionId":null,"source":"sdk"} |
| ✅ | 仅空白 → fresh | ctx={"mode":"fresh","sessionId":null,"source":"sdk"} |

### V2.7 buildLocalSessionContext

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 固定 fresh + local | ctx={"mode":"fresh","sessionId":null,"source":"local"} |

### V2.7 needsSessionResume

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | resume+id → true | - |
| ✅ | fresh → false | - |
| ✅ | resume+null id → false | - |
| ✅ | continue → false | - |

### V2.7 isContinueMode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | continue=true / fresh=false | t=true f=true |

### V2.7 sessionContextLabel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | resume 带 id 截断 12 字符 | label=CLI·恢复指定(abcdefghijkl) |
| ✅ | fresh 无 id | label=CLI·新会话 |
| ✅ | SDK / 本地 来源标签 | sdk=SDK·新会话 local=本地·新会话 |
| ✅ | continue 模式 | label=CLI·继续最近 |

### V2.15-E view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 移除 Prompt Snippet skills-state 写入节流 | - |
| ✅ | 移除 Prompt Snippet 搜索防抖 | - |
| ✅ | 删除 Prompt Snippet 编辑入口 | - |
| ✅ | 删除 Prompt Snippet EditSkillModal | - |
| ✅ | 删除 Prompt Snippet combo 插入 | - |

### V2.7 view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 renderMessageError 错误 fallback | - |
| ✅ | 含 renderListError 列表 fallback | - |
| ✅ | 含长会话折叠（MAX_EXPANDED + 展开按钮） | - |
| ✅ | doNewSession/restoreSession 重置折叠状态 | - |

### V2.7 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | - |

### V2.7 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | mode=auto |

### V2.7 默认设置

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claudeContinueSession = false | continue=false |
| ✅ | claudeResumeSessionId = 空字符串 | resume= |

### V2.8 renameSession

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 成功修改 title | ok=true title=新标题 |
| ✅ | 保留其他字段不变 | status=failed agentType=codex |
| ✅ | 不存在的会话返回 false | ok=false |
| ✅ | savedAt 更新为当前时间 | before=2026-07-05T06:44:52.581Z after=2026-07-05T06:44:52.640Z |
| ✅ | listSessions 反映新标题 | title=列表新标题 |

### V2.8 view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | restoreSession 对齐 agentType + 重算 message snippet | - |
| ✅ | restoreSession 末尾 scrollToBottom | - |
| ✅ | 含 historySortMode 排序模式字段 | - |
| ✅ | 含排序下拉 UI（按时间/按消息数） | - |
| ✅ | 含 messages 排序逻辑（降序） | - |
| ✅ | deleteHistorySession 原地刷新不重载 | - |
| ✅ | openGeneratedFile 失败弹 Modal + 复制路径 | - |
| ✅ | 含 renameHistorySession 方法 | - |
| ✅ | 含 promptDialog 通用输入对话框 | - |
| ✅ | 历史列表项含编辑按钮 | - |

### V2.8 sessions.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 导出 renameSession 函数 | type=function |

### V2.8 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | - |

### V2.8 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | mode=auto |

### V2.8 schema 不变

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SESSION_SCHEMA_VERSION = 2 | version=2 |

### V2.9 buildToolTimeline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 主 agent tool parentToolUseId=undefined | len=1 pid=undefined |
| ✅ | subagent tool 记录 parentToolUseId | pid=parent-abc |
| ✅ | 配对后 parentToolUseId 保留 | pid=p1 status=done |
| ✅ | main/subagent O(1) 分组正确 | total=4 main=2 sub=2 |
| ✅ | 多 subagent 各自保留 parentToolUseId | p1=pA p2=pB |

### V2.9 workflowEvent.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ToolTimelineEntry 含 parentToolUseId 字段 | - |

### V2.9 view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | appendSdkWorkflow 用 RunStateAggregator 聚合分组 | - |
| ✅ | findToolParentAgent 线性扫描方法已移除 | - |
| ✅ | scrollToBottom 用 requestAnimationFrame 合并 | - |
| ✅ | 含 scrollRafId 字段 | - |
| ✅ | onClose 清理 scrollRafId 避免关闭后回调 | - |
| ✅ | refreshHistory 含 5s 缓存守卫 + force 参数 | - |
| ✅ | ↻ 按钮强制重载 | - |
| ✅ | 含 historyLastLoadAt 缓存时间戳 | - |
| ✅ | 含 historySearch 字段（El/Query/Debounce） | - |
| ✅ | 含历史搜索框 UI | - |
| ✅ | 历史搜索 300ms 防抖 | - |
| ✅ | renderHistoryList 按标题子串过滤 | - |
| ✅ | historyBodyEl + listContainer 分离 | - |
| ✅ | 搜索时显示匹配数/总数 | - |

### V2.9 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | - |

### V2.9 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | mode=auto |

### V2.9 schema 不变

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SESSION_SCHEMA_VERSION = 2 | version=2 |

### V2.10 B-018

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | snapshotVaultMarkdownFiles 两阶段并行 stat | - |
| ✅ | 并行优化后仍正确收集 md + 排除目录 | size=3 keys=a.md,b.md,sub/c.md |
| ✅ | 跨批处理 70 个文件全部收集 | size=70 expected=70 |
| ✅ | diffSnapshots 仍正确检测新增+修改 | diff=["exist.md  [MODIFIED]","new.md  [NEW]"] |
| ✅ | EXCLUDE_DIRS 排除列表不变 | dirs=.obsidian,.llm-bridge,node_modules,.git,LLM-AgentRuntime,dist,build |
| ✅ | shouldExclude 大小写不敏感仍正常 | - |
| ✅ | isMarkdownFile 不变 | - |

### V2.10 B-001

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | view.ts 订阅 file-open 事件 | - |
| ✅ | file-open 回调内调用 updateContextDisplay | - |

### V2.10 B-002

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | timeline detail 含 title 属性 | - |
| ✅ | workflow trace detail 含 title 属性 | - |

### V2.10 B-003

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | settings.ts 含重新显示首次使用提示按钮 | - |
| ✅ | 按钮使用 addButton + setButtonText | - |

### V2.10 B-019

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | settings.ts backendMode onChange 调用 refreshBridgeView | - |
| ✅ | main.ts 含 refreshBridgeView 公开方法 | - |
| ✅ | view.ts 含 refreshOnSettingsChange 公开方法 | - |
| ✅ | refreshOnSettingsChange 调用 refreshStatusBar | - |

### V2.10 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | run=function name=claude-cli |

### V2.10 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | backendMode=auto |

### V2.10 schema 不变

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SESSION_SCHEMA_VERSION = 2 | value=2 |

### V2.11 B-010

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 解析 --strict 标志（默认 false） | - |
| ✅ | SCAN_EXCLUDE_DIRS 含 node_modules/.git/.llm-bridge/dist/build | - |
| ✅ | walk 函数跳过 SCAN_EXCLUDE_DIRS | - |
| ✅ | TEST_FIXTURE_MARKERS 含测试假数据标记 | - |
| ✅ | isTestFile 函数判断测试文件 | - |
| ✅ | isTestFixture 用 lastIndexOf/indexOf 优化上下文扫描 | - |
| ✅ | 主循环非 strict 模式跳过测试文件 | - |
| ✅ | 默认模式扫描干净目录 exit 0 | exit=0 out=[scan] ✓ 扫描 1 个文件，无敏感信息
 |
| ✅ | 默认模式扫描真实 sk-ant key exit 1 | exit=1 err=[scan] ✗ config.md: 命中 sk-ant API key → sk-ant-api03-abcdefghijklmnopqrstuvwxyz0 |
| ✅ | 默认模式跳过测试文件中的假数据 | exit=0 out=[scan] ✓ 扫描 1 个文件，无敏感信息，跳过 1 处测试假数据（--strict 可全扫描）
 |
| ✅ | --strict 模式检出测试文件中的假数据 | exit=1 err=[scan] ✗ redact.test.md: 命中 sk-ant API key → sk-ant-api03-abcdefghijklmnopqrstuv |
| ✅ | 默认模式跳过 node_modules 子目录 | exit=0 err= |
| ✅ | 默认模式跳过 .git 子目录 | exit=0 |
| ✅ | 默认模式用 isTestFixture 识别零散假数据 | exit=0 out=[scan] ✓ 扫描 1 个文件，无敏感信息，跳过 1 处测试假数据（--strict 可全扫描）
 |
| ✅ | 正则强制添加 g 标志避免 re.exec 死循环 | - |

### V2.11 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 可实例化 | run=function name=claude-cli |

### V2.11 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | backendMode=auto |

### V2.11 schema 不变

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SESSION_SCHEMA_VERSION = 2 | value=2 |

### V2.11.1 重命名迁移

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | meta 从旧名迁移到新名 | oldGone=true newPinned=true newCount=2 |
| ✅ | 同名返回原 state | - |
| ✅ | 旧名无 meta 返回原 state | - |
| ✅ | lastCombo 不变（不自动改名） | combo=["A","B"] |

### V2.11.1 tags 编辑保留

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | updateImportedSkill 提取 #标签 | ok1=true tags=["翻译","常用"] desc=将选区翻译为日文 |
| ✅ | 无 #标签时 tags 为空 | tags=[] |

### V2.15-E onClose

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不再写 legacy skills-state | - |
| ✅ | 移除 legacy skills 搜索防抖 | - |

### V2.11.1 groupOverride

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 标注为 future 不误导 | - |

### V2.11.1 组合顺序

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Set 保持插入顺序 | order=["C","A","B"] |

### V2.11.1 session 脱敏

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | timeline detail 含 secret 被脱敏 | detail=output sk-ant-api03-*** |
| ✅ | commandPreview value 含 secret 被脱敏 | value=ANTHROPIC_API_KEY=****** |
| ✅ | workflowTrace detail 含 secret 被脱敏 | - |
| ✅ | sdkEvents 各字段含 secret 被脱敏 | - |
| ✅ | 无嵌套字段不崩溃 | - |

### V2.11.1 设置刷新

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | agentType onChange 调用 refreshBridgeView | - |
| ✅ | claudePermissionMode onChange 调用 refreshBridgeView | - |
| ✅ | permissionPolicy onChange 调用 refreshBridgeView | - |

### V2.11.1 SDK 默认关闭

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | DEFAULT_SETTINGS.backendMode = auto | backendMode=auto |

### V2.11.1 schema 不变

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SESSION_SCHEMA_VERSION = 2 | value=2 |
| ✅ | SKILLS_STATE_VERSION = 1 | value=1 |

### V2.12 约束

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AgentEvent v0.1 不变（6 事件，无 tool event） | - |
| ✅ | sdk-experimental 默认关闭 | - |
| ✅ | CLI auto 主线不回归（ClaudeCliBackend 可实例化） | - |

### V2.15-E UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Skills 页只保留 Agent Skills 且默认折叠 | - |

### V2.12 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | History 面板默认折叠 | - |
| ✅ | Advanced 指标区默认折叠（sbAdvancedItems setAttribute hidden） | - |
| ✅ | createCollapsibleSection 默认 startOpen=false | - |
| ✅ | timeline detail 含 tooltip attr title | - |
| ✅ | workflow trace detail 含 tooltip attr title | - |
| ✅ | SDK event detail 含 tooltip attr title | - |

### V2.12 权限

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | low 风险 auto_allow（policy != high） | - |
| ✅ | high 风险 needs_approval（始终） | - |
| ✅ | medium + policy=high 不静默放行（needs_approval） | - |
| ✅ | medium + policy=medium 不静默放行（needs_approval） | - |
| ✅ | stop 按钮存在 + 绑定 stop() 调用 | - |
| ✅ | onClose 调用 runHandle.stop() 终止运行 | - |
| ✅ | onClose 清理 scrollRafId 定时器 | - |

### V2.12 错误

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | showFileNotFoundModal 含完整路径显示 | - |
| ✅ | showFileNotFoundModal 含复制按钮（clipboard.writeText） | - |
| ✅ | debug log 路径可复制（clipboard.writeText(logPath)） | - |

### V2.15-E Prompt Snippets

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | view.ts 不再含搜索/防抖 UI | - |
| ✅ | view.ts 不再含分组/排序 UI | - |
| ✅ | view.ts 不再含置顶/使用统计 UI | - |
| ✅ | view.ts 不再含 rename/import/edit 链路 | - |
| ✅ | view.ts 不再含 Insert selected/combo 插入链路 | - |
| ✅ | view.ts 不再含 Insert prompt/Append 插入函数 | - |

### V2.12 Session

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 历史搜索框存在（historySearchEl） | - |
| ✅ | 标题重命名功能存在（renameSession 调用） | - |
| ✅ | 删除会话功能存在（deleteSession 调用） | - |
| ✅ | 恢复会话功能存在（restoreSession） | - |
| ✅ | V2.11.1 defense-in-depth 脱敏仍生效（redactSdkEventForSession） | - |

### V2.12 核心流

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 自由提问输入框存在（inputEl） | - |
| ✅ | 选区 chip 存在（Selection chip） | - |
| ✅ | 笔记 chip 存在（Note chip） | - |
| ✅ | 生成文件列表可点击（openGeneratedFile） | - |
| ✅ | preset 提示存在（presetPrompts） | - |

### V2.12 报告

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | docs 目录存在（e2e-smoke-v2.12.md 写入位置） | - |
| ✅ | 现有 e2e-smoke-v2.2.md 模板存在 | - |

### V2.15-E cleanup

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Bridge view 不再保留 flushSkillsStateSave | - |
| ✅ | Bridge view 不再保存 legacy skills-state | - |
| ✅ | Bridge view 不再调用 renameSkillMeta | - |
| ✅ | 删除 openEditPromptSnippetDialog | - |
| ✅ | 删除 legacy refreshSkills loader | - |
| ✅ | onClose 不再处理 legacy skills-state | - |
| ✅ | 删除 EditSkillModal | - |
| ✅ | Bridge view 不再调用 updateImportedSkill | - |
| ✅ | Bridge view 不再调用 checkImportConflict | - |
| ✅ | 删除 ImportSkillModal | - |

### V2.12.1 修复

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | renameSkillMeta 后不再调用 scheduleSkillsStateSave | - |
| ✅ | onClose 不再内联重复 flush 逻辑 | - |

### V2.12.1 真实路径

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 重命名后新名 meta 完整 + 旧名孤儿清理 | newOk=true oldGone=true oldFileGone=true newFileExists=true newMeta={"applyCount":3,"lastUsedAt":"2026-07-05T06:44:53.451Z","pinned":true,"groupOverride":"测试组"} |

### V2.12.1 字段完整性

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pinned/applyCount/lastUsedAt/groupOverride 全部迁移 | pinned=true applyCount=5 lastUsedAt=2026-07-05T06:44:53.462Z groupOverride=GroupA oldGone=true |

### V2.12.1 时序回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | scheduleSkillsStateSave 路径丢失迁移（重现 bug） | bugOld=true bugNew=false (期望: 旧名残留/新名缺失=bug 重现) |

### V2.12.1 时序修复

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | flushSkillsStateSave 路径保留迁移（验证修复） | fixNew=true fixNewPinned=true fixOldGone=true |

### V2.12.1 约束

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AgentEvent v0.1 不变（不新增 tool event） | - |
| ✅ | sdk-experimental 仍默认关闭 | - |
| ✅ | schema 不变（SESSION/SCILLS_STATE = 1） | - |
| ✅ | CLI 主线不回归（ClaudeCliBackend 可实例化） | - |

### V2.16-E FileRef

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | scope 支持 message/pinned/session 且默认 message | - |

### V2.16-E UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 本轮附件发送后挂到 user message 并清空 composer | - |
| ✅ | 不再常驻空工作集，附件显示在 composer/user message | - |

### V2.16-E pinned context

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Pin 后跨轮保留，Unpin 后移除 | - |

### V2.16-E AttachmentPackingPolicy

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | policy 字段完整 | - |

### V2.16-E promptPackage

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 区分 message inline / message refs / pinned refs | - |

### V2.16-E SDK

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 有图片附件时自动使用 Streaming Input | - |

### V2.16-E attachments

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 图片 content block，PDF/大文件 refs-only | - |

### V2.13.0-C 常量

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | manifest 与 Claude Skills 路径正确 | - |

### V2.13.0-C slug

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ASCII/CJK fallback/去重正确 | ascii=code-review-helper cjk=skill-1fa3244c dedup=code-review-helper-2 |

### V2.13.0-C record

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 创建 AgentSkillRecord 默认值正确 | {"id":"as-review","slug":"review-skill","name":"Review Skill","description":"Review code changes","instructions":"Inspect diffs and report blockers only.","enabled":true,"source":"manual","materializedPath":".claude/skills/review-skill/SKILL.md","materializedHash":"","updatedAt":"2026-06-30T00:00:00.000Z"} |

### V2.13.0-C convert

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Prompt Snippet 可显式转换为 Agent Skill record | source=converted |

### V2.13.0-C serializer

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SKILL.md 含 frontmatter/marker/instructions | - |

### V2.13.0-C manifest

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | save/load 往返一致 | saved=true count=1 |

### V2.13.0-C materialize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 创建 .claude/skills/<slug>/SKILL.md | status=created |
| ✅ | 内容一致时 skipped | status=skipped |
| ✅ | tracked generated file 可安全更新 | status=updated |
| ✅ | 不覆盖非插件生成 SKILL.md | target SKILL.md is not plugin-generated |
| ✅ | 检测插件生成文件被手工修改 | target SKILL.md changed after last materialization |

### V2.13.0-C materializeEnabled

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 只物化 enabled Agent Skills | results=1 |

### V2.13.0-C boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Agent Skill 正文不拼进 promptPackage | - |

### V2.13.0-D prepare

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 无 Agent Skill manifest 时不阻塞 CLI | enabled=0 |
| ✅ | CLI 运行前只物化 enabled Agent Skills 并回写 hash | ok=true enabled=1 results=1 |
| ✅ | 已物化且未变化时 skipped，不重复写 manifest | status=skipped saved=false |
| ✅ | 非插件生成 SKILL.md 冲突时 fail-fast | owned-by-user: target SKILL.md is not plugin-generated |

### V2.13.0-D boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | CLI backend 物化 Agent Skills，promptPackage 不注入正文 | prep=true gated=true noPromptInjection=true |

### V2.13.0-E SDK

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 无 manifest 时传空 skills + settingSources，不阻塞 | sources=["user","project","local"] skills=[] |
| ✅ | 只暴露 enabled Agent Skill slug 并物化 SKILL.md | skills=["sdk-enabled-skill"] ok=true |
| ✅ | buildSdkOptions 使用 settingSources + skills，权限仍不混入 skills | settingSources=["user","project","local"] skills=["sdk-enabled-skill"] permissionSeparate=true thinking={"type":"adaptive","display":"summarized"} |
| ✅ | 非插件生成 SKILL.md 冲突时 fail-fast | sdk-user-owned: target SKILL.md is not plugin-generated |

### V2.13.0-E boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SDK skills option 与 canUseTool 分离，sdk-experimental 默认关闭，不注入 prompt | skillsOptions=true canUseTool=true noPromptInjection=true defaultOff=true |

### V2.13.0-F UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | view.ts 引入并持有 Agent Skills manifest state | import=true fields=true |
| ✅ | Agent Skills 面板独立且 Skills 页不挂载 Prompt Snippets | agentOnly=true panel=true |
| ✅ | Agent Skills 可刷新并通过 manifest 启用/禁用 | refresh=true toggle=true |

### V2.15-F boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Agent Skills UI 只打开原生 SKILL.md/启用，不插入 composer | noPromptInsert=true registryOpen=true |

### V2.15-E compatibility

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Prompt Snippets 从 Bridge view 删除，Agent Skills runtime 边界保留 | snippetRemoved=true runtime=true |

### V2.15-F UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Agent Skills registry 无内联详情/弹窗，点击打开原生文件 | noPreview=true click=true styles=true |

### V2.13.0-F2 boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 点击 Agent Skill 不改 composer，Skills 页不暴露 snippet 插入器 | agentNoComposer=true snippetMounted=false |

### V2.14.0-A report

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 包含要求的边界报告章节 | sections=true |

### V2.14.0-A read policy

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 外部可显式只读，且不无脑拼进 promptPackage | readRoots=true noBlindPrompt=true |

### V2.14.0-A write policy

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Vault 内写入可控，外部写/删/重命名禁止 | writeRoots=true actions=true |

### V2.14.0-A sensitive paths

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 敏感路径默认拒绝或强确认 | report=true actions=true sdk=true |

### V2.14.0-A current audit

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | fileDiff Vault-only，权限策略保留高风险边界 | fileDiff=true policy=true |

### V2.14.0-A runtime boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AgentEvent/CLI/SDK/Skills 主线不变 | agentEvent=true backend=true skills=true |

### V2.14.0-B/C/D/E/E1/F/G/H/I/I1/J/K/K1/L/M exports/report

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | policy 类型与报告章节存在 | exports=true reportB=true reportC=true reportD=true reportE=true reportE1=true reportF=true reportG=true reportH=true reportI=true reportI1=true reportJ=true reportK=true reportK1=true reportL=true reportM=true |

### V2.14.0-B roots

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 默认 readRoots/writeRoots 仅 Vault | read=1 write=1 |

### V2.14.0-C on-demand external read

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 未授权 confirm，session/attachment grant allow，外部写删改 deny | vault=allow pending=confirm/pending_read_request session=allow/session-grant sibling=confirm attachment=allow/attachment-grant write=deny delete=deny rename=deny |

### V2.14.0-B outputDir

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Vault 内 outputDir 归一化并加入 writeRoots | roots=2 write=allow normalized=c:\vault\generated\daily\out.md |
| ✅ | Vault 外 outputDir 不加入 writeRoots | roots=1 write=deny/outside_write_roots |

### V2.14.0-B write/delete/rename

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Vault 内写允许，Vault 外写删改拒绝 | write=allow/inside_write_root delete=deny/outside_write_roots rename=deny/rename_target_denied |

### V2.14.0-B/B1 sensitive

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | read 可 confirm，写删改敏感路径 hard deny | readDeny=deny/sensitive_path readConfirm=confirm/high write=deny delete=deny renameSrc=deny renameTarget=deny direct=true |

### V2.14.0-D pending/session directory grant

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | read pending，批准后项目根目录只读，外部写删改拒绝 | pending=pending_read_request/d:\work\project/allow grant=directory/d:\work\project file=allow sibling=allow sensitive=deny write=deny delete=deny rename=deny nonRead=null |

### V2.14.0-D grant root rules

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 目录请求直授目录，附件 file-scope，过宽目录不默认授权 | dir=d:\work\loosedocs attach=allow/file sibling=confirm wide=deny/deny home=confirm downloads=confirm approvedWide=0 |

### V2.14.0-B path safety

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Windows/POSIX containment 与路径遍历 | win=true/true posix=true/true traversal=deny/path_traversal |

### V2.14.0-E1 strong confirm

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | confirm 显式批准，deny 永不批准，allow 普通批准 | confirm=confirm plain=0/1 dir=directory/c:\users\ye_luo file=file/c:\users\ye_luo\notes.md deny=deny/0 allow=allow/1 |

### V2.14.0-F FileRef/Working Set

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | refs only，授权衔接，不读正文不接 prompt | vault=vault/active pending=pending_read_request/pending before=0 external=external/session attachment=attachment/file reads=allow/confirm refs=3 fields=true body=true prompt=true view=true |

### V2.14.0-G attachments

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Context UI、file-scope grant、bounded ingestion、prompt boundary | grant=file sibling=confirm md=true json=true large=too_large image=not_text pdf=not_text binary=not_text sensitive=sensitive_path external=null type=true prompt=true boundary=true bounded=true ui=true |

### V2.14.0-H native attachments + FileRef index + read tool policy gate

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V2.14.0-H native attachments + FileRef index + read tool policy gate | index=5 prompt=true policy=true ingestion=true ui=true read=confirm/true stat=confirm/true list=allow/deny sibling=confirm sensitive=deny write=deny |

### V2.14.0-I real file tool executor

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | policy gate、bounded read、safe list/search、Claude Read handoff | stat=true read=true listSearch=true external=true gate=true noWrite=true limits=true view=true |

### V2.14.0-I1 symlink realpath hardening runtime test

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.14.0-I1 symlink realpath hardening runtime test | 当前环境无法创建 symlink/junction: EPERM: operation not permitted, symlink 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-i1-external-6QWscF\outside.md' -> 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-i1-vault-uPPa6X\link-out.md' |

### V2.14.0-J agent file tool route

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | read-only routing + policy gate + result surface | routing=true policy=true pending=true deny=true result=true noWrite=true boundary=true |

### V2.14.0-J route symlink escape runtime test

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.14.0-J route symlink escape runtime test | 当前环境无法创建 symlink；静态确认路由委托 executor realpath guard=true: EPERM: operation not permitted, symlink 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-j-external-ksGmVC\outside.md' -> 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-j-vault-5Iye1h\link-out.md' |

### V2.14.0-K runtime file tool adapter

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SDK/CLI route through read-only bridge | adapter=true cli=true sdk=true pending=true deny=true result=true noWrite=true boundary=true |

### V2.14.0-K runtime adapter symlink escape runtime test

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.14.0-K runtime adapter symlink escape runtime test | 当前环境无法创建 symlink；静态确认 adapter 委托 executor realpath guard=true: EPERM: operation not permitted, symlink 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-k-external-jf8uEu\outside.md' -> 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-k-vault-tUgmDY\link-out.md' |

### V2.14.0-K1 runtime adapter limits clamp

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 只能收窄不能放大 | clamp=true lower=true ext=true invalid=true execution=true noWrite=true static=true |

### V2.14.0-L native handoff simplification

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | prompt 指引原生文件能力且不新增写 runtime | prompt=true external=true sensitive=true adapter=true noRuntime=true |

### V2.14.0-M smoke/UX

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | native handoff refs、Context 状态、外部边界与 read-only runtime 不回归 | handoff=true ux=true smoke=true external=true runtime=true |

### V2.14.0-N real runtime smoke

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | artifact freshness、bridge 在线、边界真实验证且未扩展 runtime | sections=true smoke=true nativeLimit=true boundary=true runtime=true |

### V2.14.0-N1 native config rerun

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | CLI/SDK 使用本地配置通过，唯一测试 Vault 且未扩展 runtime | sections=true diagnosis=true localConfig=true vault=true runtime=true |

### V2.14.0-E runtime UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pending 文案/授权动作/safety 行为存在，非 read 不入 pending | store=true ui=true actions=true safety=true nonRead=true |

### V2.14.0-B boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不接 promptPackage/CLI/SDK，不改 AgentEvent | prompt=true backend=true event=true |

### V2.15-A UI shell

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | nav/topbar/chat/composer/files pages 存在且未扩展 runtime | shell=true top=true composer=true working=true secondary=true styles=true runtime=true report=true |

### V2.15-B visual polish

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer 收敛、权限 chip、失败详情折叠且未扩展 runtime | command=true permission=true topbar=true details=true styles=true runtime=true report=true |

### V2.15-C compact shell

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 左侧 icon-only rail，Bridge 移至 topbar，runtime 未扩展 | rail=true left=true topbar=true styles=true composer=true runtime=true report=true |

### V2.15-E RC UI regression

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 附件、Skills、session、composer、icon、details 修复 | attachment=true native=true skills=true layout=true session=true composer=true icon=true details=true runtime=true report=true |

### V2.15-F Agent Skills registry

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 原生 SKILL.md 详情、无 snippets、composer/model picker 修复 | skills=true noDetail=true native=true click=true prompt=true composer=true report=true |

### Process

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 启动 fixture success | - |
| ✅ | 接收多段 stdout_delta | - |
| ✅ | 接收 stderr_delta | - |
| ✅ | exit 0 → completed | - |
| ✅ | exit 1 → failed | - |
| ✅ | stop() 终止 slow fixture | - |
| ✅ | cwd 路径带空格可运行 | - |
| ✅ | cwd 指向临时目录可运行 | - |
| ✅ | large-output 不污染诊断日志 | - |

### Process File Diff

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | fixture write-file completed | - |
| ✅ | diff 检测到 fixture 写入的新文件 | - |

### Claude Smoke

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claude 可用性 | version: 2.1.200 (Claude Code) |
| ✅ | started 先发出 | - |
| ✅ | 接收 stdout_delta | - |
| ✅ | completed exitCode 0 | - |
| ✅ | stdout 含 OK | - |

### Claude Note Summarize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claude 可用性 | version: 2.1.200 (Claude Code) |
| ✅ | prompt 包含标记词 | - |
| ✅ | started 先发出 | - |
| ✅ | completed exitCode 0 | - |
| ✅ | stdout 包含标记词 | - |
| ✅ | stdout 提到总结/关键 | - |

### V2.16-D contextMetrics.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 核心函数与接口存在 | - |

### V2.16-D view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | context metrics UI 方法与元素存在 | - |
| ✅ | 会话保持 restoreLastActiveSessionIfNeeded 存在 | - |
| ✅ | runtime status 英文 pill 格式 | - |
| ✅ | saveSession 传入运行时状态快照 | - |
| ✅ | doNewSession 清除 lastActiveSessionId | - |

### V2.16-D sessions.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | schema v2 + 运行时状态字段 + SessionExtras | - |

### V2.16-D types.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | keepLastSession 设置项 + 默认值 | - |

### V2.16-D settings.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 会话保持 toggle UI | - |

### V2.16-D styles.css

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | context strip + runtime pill 样式 | - |

### V2.16-D sessions/view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 最近会话摘要下拉与恢复入口 | - |

### V2.16-D context

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | exact/estimated 区分 + message/pinned 拆分 | - |

### V2.16-D composer

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 拖拽/粘贴文件和路径入口存在 | - |

### V2.16-D file input

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Vault ref + external attachment grant 分流 | - |

### V2.16-D developer mode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用户态隐藏 raw log/command | - |

### V16.4-D permission popover

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pointerdown 排除 chip/popover，且 next-round setting 不受 runHandle 阻塞 | pointerGuard=true setMode=true |

### V16.4-F/G permission UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Codex-style approval card in composer, 4 语义化按钮 | - |

### V16.4-E2 user input UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | AskUserQuestion dock 支持单选/多选/多页并随事件刷新 | - |

### V16.4-D user bubble

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 文本可选择复制且不新增复制按钮 | - |

### V2.16-F completed UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 结果前折叠过程且不重复答案 | - |

### V2.16-F assistant turn

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Markdown 输出 + 内联过程 + 用户态无全局 Run Flow | - |

### V2.16-F chat/context polish

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 隐藏复制按钮并压缩 Context 文案 | - |

### V2.17-A EffectiveRunPlan

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 字段完整性（SDK 派生） | backend=sdk effort=high preset=claude_code |
| ✅ | CLI/SDK 同输入产出一致 plan（仅 backend 字段不同） | consistent=true backendDiffers=true |
| ✅ | settingSources 显式 [user,project,local] | sources=user,project,local |
| ✅ | codex-app-server 派生为 CodexAppServerEffectiveRunPlan | codex=true instructions=true noClaudeOnly=true |

### V2.17-A computePromptPackageHash

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 相同输入稳定、不同输入区分 | stable=true distinct=true h1=2acfe368 h2=2acfe369 |

### V2.17-A formatEffectiveRunPlan

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 输出完整审计键值行 | rows=13 hasAll=true |
| ✅ | codex plan 输出 instructionsSource，不输出 Claude-only 行 | instrSrc=true noPerm=true noSys=true noTools=true |
| ✅ | 每条附件输出独立 audit 行（refId/scope/fileType/packing/pathHash/contentHash/reason） | auditRow=message/markdown/inline-snippet path=0e7ba06b content=434cda33 reason=bounded text ingest (small markdown/text/json → userPrompt inline) |

### V2.17-A RunStateAggregator

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 多次 thinking_delta 合并单个 block | text=part1 part2 part3 |
| ✅ | thinking_tokens 只更新标题 meta 不新增节点 | thoughtNodes=1 tokens=120 |
| ✅ | tool_progress 合并到 tool_call 节点（无独立 progress） | toolNodes=1 progressNodes=0 |
| ✅ | partial text_delta 累加到 finalAnswerBuffer | buffer=Hello world! |

### V2.17-A mapper

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | result success 只发 completed 不发重复 message | hasCompleted=true noDuplicateMessage=true |
| ✅ | completed 事件携带 sessionId | sessionId=sess-xyz |
| ✅ | failed 事件携带 sessionId | sessionId=sess-fail |

### V2.17-A aggregateEventsToTimeline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 无 final_message 节点 + 单 thought + completed | noFinalMessage=true hasCompleted=true hasSingleThought=true |

### V2.17-A computeContextMetrics

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | message/pinned 拆分 + workingSet 聚合 + estimated | msg=8 pin=8 ws=16 |
| ✅ | 附件空时 workingSet=0，有附件时 >0 | with=4 without=0 |

### V2.17-A 端到端聚合

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | partial 累加 + 单 thinking + 单 tool + sessionStarted 记录 + completed 终态 | finalAnswer="我来读取完成" thinking="分析中... 需要读文件" toolSize=1 terminal=true |

### V2.17-A buildAttachmentPlan

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 从 entries 派生 counts + entry-level audit | counts=true len=true shape=true refEmpty=true |

### V2.17-A emptyAttachmentPlan

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 entries: [] 空 audit 数组 | entries=0 |

### Codex schema

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | initialize.params 使用 clientInfo + capabilities（无 clientName/clientVersion 顶层） | clientInfo=true capabilities={"experimentalApi":false} experimentalApi=false |
| ✅ | experimentalApi=true 显式启用 + audit hash 区分 | default=true experimental=true hashDiffers=true |
| ✅ | thread/start 使用 config 容器 + instructions，无 resumeSessionId | config=true noResume=true instructions=true |
| ✅ | item/agentMessage/delta 驱动 AssistantTurnView.finalAnswer | finalAnswer="Hello, world!" |
| ✅ | item/reasoning/summaryTextDelta 驱动 thinking 段 | thoughts=1 text="Thinking about it" |
| ✅ | item/commandExecution/outputDelta 附加到 tool progress | tools=1 progress=1 |
| ✅ | item/started 解析 nested params.item（agentMessage/commandExecution/reasoning） | am=true cmd=true reasoning=true |
| ✅ | approval decision 使用官方 shape（accept/acceptForSession/decline/cancel，无 allow/deny） | accept=true forSession=true decline=true cancel=true noLegacy=true |
| ✅ | approval request 提取 threadId/turnId/itemId 到 providerContext | ctx=true risk=high cmd="rm -rf /tmp/test" |
| ✅ | serverRequest/resolved 携带真实 requestId + decision → approval_resolved | kind=approval_resolved requestId=codex-req-99 response=accept |
| ✅ | SessionMapper register + getProviderThreadId/getProviderSessionId + hasCodexThread | thread=codex-thread-abc session=codex-session-xyz has=true noThread=true |
| ✅ | thread/resume 从 SessionMapper 恢复 + 映射同步更新 | resumePath=true updated=codex-thread-resumed |
| ✅ | item/text/delta legacy alias 仍可驱动 finalAnswer（兼容路径） | finalAnswer="legacy text" |
| ✅ | turn/started 通知映射为 progress（detail=turnId） | kind=progress detail=turn-1 |
| ✅ | item/completed 解析 nested params.item（agentMessage 完整文本） | kind=message partial=false text="partial complete text" |

### Codex session persistence

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | run1 thread/start 注册 threadId 到 sessionMapper | tid=thread-abc sid=session-def has=true |
| ✅ | save/load extras round-trip 保留 providerThreadId/SessionId | loaded.tid=thread-persist loaded.sid=session-persist |
| ✅ | restoreProviderSession 注入持久化 threadId | has=true tid=thread-from-disk |
| ✅ | run2 resume 命中 thread/resume 路径（不退化为新 thread） | resumePath=thread/resume codexThread=thread-e2e |
| ✅ | doNewSession 清空回填缓存避免误 resume 旧 thread | has=false |
| ✅ | restoreProviderSession 不覆盖已存在的运行时映射 | tidAfter=thread-real |
| ✅ | run2 thread/resume + turn/start 继续同一 thread（P2 闭环） | resumePath=thread/resume resumedThreadId=thread-continue-1 turnStart.threadId=thread-continue-1 sameAsRun1=true |

### Codex provider-level resume

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | run1 thread/start 注册 threadId（provider 全路径） | sessionStarted=true text=thread-provider-1 mappedTid=thread-provider-1 eventsCount=3 |
| ✅ | run2 thread/resume + turn/start 使用 resumed threadId（P2 主线闭环） | threadResume=true threadStartOnRun2=false resumeTidOk=true turnStartTidOk=true resumedEv=true eventsCount=3 |

### Test report integrity

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | unit/process 报告含 commit sha + 运行命令字段 | unitExists=true processExists=true unitSha=true processSha=true unitCmd=true processCmd=true |
| ✅ | summary 由 generate-test-summary.mjs 解析生成（含审计结果 + commit sha 表） | exists=true parsed=true audit=true shaTable=true |
| ✅ | summary 含 P2 必需审计字段（testedCodeCommitSha/reportCommitSha/reportParentSha/unitReportSha/processReportSha/codexSmokeStatus） | exists=true testedSha=true reportSha=true parentSha=true unitSha=true processSha=true smokeStatus=true capturedTestedSha=a0a1b8294b37 |
| ✅ | 审计模式 testedCodeCommitSha 不匹配 + codexSmokeStatus 异常 → exit 1（P2 条件逻辑） | scriptExists=true auditFailExit=true testedCodeShaCheck=true codexSmokeCheck=true docsOnlyLogic=true |

## 失败项详情

无失败项。

## 需人工验证项

- **Approval: insert_at_cursor 完整流程**: 需要活动的 Markdown 编辑器 + 光标位置
- **Approval: replace_selection 完整流程**: 需要活动的 Markdown 编辑器 + 选区

---

*报告由 `scripts/run-tests.mjs` 自动生成*