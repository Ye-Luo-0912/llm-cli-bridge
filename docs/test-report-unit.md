# LLM CLI Bridge 测试报告 — 单元测试（unit）

- **测试时间**: 2026-07-11T19:28:27.432Z
- **测试环境**: win32 / Node.js v24.14.0
- **插件版本**: 2.18.0
- **main.js 大小**: 1265.7 KB
- **main.js bundle content smoke**: PASS ({"HttpBridge":true,"writeHelperAndWrappers":true,"CodexAppServerProvider":true,"vault_api":true})
- **Vault 路径**: `D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki`
- **bridge.json 存在**: 是
- **HTTP 端口**: 53828
- **commit sha**: f8a7b3097e1500aecf3882429bd45d942c698090
- **commit 短 sha**: f8a7b3097e15
- **运行命令**: node scripts/run-tests.mjs --unit

## 测试汇总

- ✅ **通过**: 1231
- ❌ **失败**: 0
- ⏭️ **跳过**: 25
- ⚪ **需人工验证**: 0
- **总计**: 1256

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
| ✅ | property_get 缺 path | - |
| ✅ | property_get 仅 path 正常 | - |
| ✅ | property_get path+key 正常 | - |
| ✅ | property_set 缺 value | - |
| ✅ | property_set 完整正常 | - |
| ✅ | property_set value=number 通过 | - |
| ✅ | property_set value=boolean 通过 | - |
| ✅ | property_set value=array 通过 | - |
| ✅ | property_set value=object 通过 | - |
| ✅ | property_set value=null 视为缺失 | - |
| ✅ | property_set value=number 不是 string 也通过（unknown 类型） | - |
| ✅ | property_delete 缺 key | - |
| ✅ | property_delete 完整正常 | - |
| ✅ | property_delete 缺 path | - |
| ✅ | tags_list 无参正常 | - |
| ✅ | tags_list 带 path 过滤正常 | - |
| ✅ | backlinks_get 缺 path | - |
| ✅ | backlinks_get 正常 | - |
| ✅ | tasks_list 无参正常 | - |
| ✅ | daily_read 禁止额外字段 | - |
| ✅ | daily_read 正常 | - |
| ✅ | daily_append 缺 content | - |
| ✅ | daily_append 正常 | - |
| ✅ | vault_delete 缺 path | - |
| ✅ | vault_delete 正常 | - |
| ✅ | vault_rename 缺 newPath | - |
| ✅ | vault_rename 正常 | - |
| ✅ | outlinks_get 缺 path | - |
| ✅ | outlinks_get 正常 | - |
| ✅ | broken_links_list 无参正常 | - |
| ✅ | broken_links_list 带 path 过滤正常 | - |
| ✅ | headings_get 缺 path | - |
| ✅ | headings_get 正常 | - |
| ✅ | vault_restore 缺 path | - |
| ✅ | vault_restore 正常 | - |
| ✅ | search 缺 query | - |
| ✅ | search 仅 query 正常 | - |
| ✅ | search 全参正常 | - |
| ✅ | rename_tag 缺 newTag | - |
| ✅ | rename_tag 正常 | - |
| ✅ | rename_tag 带 path 过滤正常 | - |
| ✅ | bookmarks_list 无参正常 | - |
| ✅ | metadatacache_get 缺 path | - |
| ✅ | metadatacache_get 正常 | - |
| ✅ | resolved_links_map 无参正常 | - |
| ✅ | resolved_links_map 带 path 过滤正常 | - |
| ✅ | plugin_list 无参正常 | - |
| ✅ | open_url 缺 url | - |
| ✅ | open_url 正常 | - |
| ✅ | setting_get 缺 key | - |
| ✅ | setting_get 正常 | - |
| ✅ | command_list 无参正常 | - |
| ✅ | command_run 缺 commandId | - |
| ✅ | command_run 正常 | - |
| ✅ | workspace_get 无参正常 | - |
| ✅ | clipboard_write 缺 text | - |
| ✅ | clipboard_write 正常 | - |
| ✅ | tag_files 缺 tag | - |
| ✅ | tag_files 正常（不带 #） | - |
| ✅ | tag_files 正常（带 #） | - |
| ✅ | link_resolve 缺 link | - |
| ✅ | link_resolve wikilink 正常 | - |
| ✅ | link_resolve 带 sourcePath 正常 | - |
| ✅ | attachment_list 缺 path | - |
| ✅ | attachment_list 正常 | - |
| ✅ | view_mode_set 缺 mode | - |
| ✅ | view_mode_set reading 正常 | - |
| ✅ | view_mode_set source 正常 | - |

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
| ✅ | 生成运行前快照 | 文件数: 50 |

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

### HTTP Bridge 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | HTTP Bridge 测试段 | 当前为 unit 模式，跳过 integration 测试 |

### HTTP

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | GET /state | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | POST /action show_notice | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | POST /action open_note | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | POST /action get_active_note | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | POST /action get_selection | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | token 错误返回 401 | Obsidian 未运行，跳过 integration 测试 |

### Approval

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | create_note approve 流程 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | create_note reject 流程 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | append_to_note approve 流程 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | insert_at_cursor 完整流程 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | replace_selection 完整流程 | Obsidian 未运行，跳过 integration 测试 |
| ✅ | default mode + high risk → pending | - |
| ✅ | resolveApproval(accept) → waitForApproval resolves | - |
| ✅ | acceptForSession writes sessionAllows cache | - |
| ✅ | cancelAllPending → resolver wakes with cancel | - |
| ✅ | bypassPermissions mode → auto-allow | - |
| ✅ | Codex native-pending → pending（不复用 Claude decideByMode） | decision=pending |

### Dev mode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | /dev/approve 端点 | Obsidian 未运行，跳过 integration 测试 |

### Helper

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | health 命令 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | state 命令 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | show_notice 命令 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | --json 标志 | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | --wait --timeout | Obsidian 未运行，跳过 integration 测试 |
| ⏭️ | bridge.json 缺失错误提示 | Obsidian 未运行，跳过 integration 测试 |

### Clipboard paste policy

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 普通复制文本保持原文，仅超大文本退化为附件 | short=false huge=true lines=true whitespace=false json=pasted-data.json markdown=pasted-note.md plain=pasted-text.txt textBlob=true htmlBlob=true imageBlob=false |

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
| ✅ | resume turn/start input only injects compact runtime Skills context when present | noSkill=true first={"type":"text","text":"Available managed Codex plugins for this resumed turn (compact):\nBridge Plugin Skills are resolved through Codex nat second={"type":"text","text":"\n========== 当前活动笔记 ==========\n路径：note.md\n内容：\n# Hello\ |

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
| ✅ | content item array (text + localImage; no unsupported file variant) | - |

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
| ✅ | 权限 popover 三项审批画像（含完全访问确认）+ 外部挂载 + pointerdown close | - |
| ✅ | setPermissionMode 不被 runHandle 阻塞（修复点击无反应） | - |

### V17-G CodexRunViewModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | runHeader/currentActivity/feed/changes/steps/approval/debugPanel 分层 | status=blocked activity=Waiting approval commands=1 changes=1 approvals=1 feed=thinking>command>file>approval thinkingSummary=Plan the edit stepStdout=true relativePath=notes/run.md debug=false/true |
| ✅ | completion-only → synthetic candidate（单一 DOM 所有者） | final="done" feedKinds=thinking>assistant |
| ✅ | 单瀑布流 — 中间过程说明 + 终端 candidate 同在 feed（无独立 Answer 副本） | final="done" feed=assistant>command>assistant>file>assistant assistant=先读配置，再检查 runtime 状态。 | 配置没问题，接着创建 smoke 文件。 | done |
| ✅ | 单条 assistant message → feed 内唯一 candidate 节点 | final="只回答这一句。" feed=assistant |
| ✅ | assistant→tool→assistant → 前段过程说明，末段 candidate 同瀑布流 | final="命令完成，结果是 hi。" feed=assistant>command>assistant |
| ✅ | reasoning→tool→answer → Thinking 仅真 reasoning，answer 为 candidate | final="目录里有 a.md。" feed=thinking>command>assistant |
| ✅ | 候选回答遇后续工具时从 candidate 降为 process（单所有者） | midFinal="准备改文件。" afterFinal="" afterFeed=assistant>command |

### V17-G61

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | thinking lead + shell/output 合并为单块瀑布，assistant 不冒充 Thinking | feed=thinking>command>file>approval stdoutMerged=true |

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

### ApprovalProfile

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ask/auto/full-access → Codex approvalPolicy/sandbox/reviewer 唯一映射 | ask=on-request/user auto=on-request/auto_review full=never/user |
| ✅ | 旧 bypassPermissions/dontAsk 迁移统一回到 ask（不静默升级 full-access） | bypass→ask dontAsk→ask |
| ✅ | Claude permissionMode 同步映射 | - |

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
| ✅ | 最小三类 section，不堆砌细则 | allPresent=true hasHeaders=true reasonableLen=true capLen=1607 autoLen=195 safetyLen=326 |

### V16.5-C contract

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Obsidian CLI 降级声明指向 obsidian-bridge wrapper | mentionsCli=true notBanned=true mentionsWrapper=true |
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

### V2.18 r4 manifest 降级

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 三态统一输出降级文案（obsidian-bridge wrapper） | states=known-available,unknown,known-unavailable |

### V2.18 r4 buildObsidianCliLine

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 降级为空串（deprecated no-op） | a='' u='' un='' |

### V2.18 r4 buildBridgePromptPackage

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 降级文案传递到 bridgeSystemAppend | hasDowngrade=true noLegacy=true |

### V17-G72 managed plugin catalog

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | reads plugin skills/SKILL.md | skills=[{"id":"pdf@openai-primary-runtime:pdf","name":"pdf","description":"Read and verify PDF files.","skillPath":"D:\\Users\\Ye_Luo\\APP\\Test\\llm-cli-bridge\\.test-managed-plugin-skills-VQUKGN\\skills\\pdf\\SKILL.md"}] |

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
| ✅ | V16.5-D ProviderCapabilityInfo evidence 字段可填充 | hasManifest=true hasDowngrade=true |

### V16.5-E blocker

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | session 声明在 buildRuntimeCapabilities 之前 | sessionLine=18467 capLine=19083 orderOk=true |
| ✅ | buildBridgePromptPackage 主路径接收 runtimeCapabilities | hasRuntimeCapabilities=true hasPassedToBuilder=true |

### V16.5-E workspace

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 首次初始化创建完整结构 | allCreated=true vaultSkillInitialized=true created=["LLM-AgentRuntime","LLM-AgentRuntime/runtime","LLM-AgentRuntime/skills","LLM-AgentRuntime/skills/vault-context","LLM-AgentRuntime/skills/vault-api","LLM-AgentRuntime/sessions","LLM-AgentRuntime/work","LLM-AgentRuntime/pi-sessions","LLM-AgentRuntime/README.md","LLM-AgentRuntime/runtime/RUNTIME_FACTS.json","LLM-AgentRuntime/skills/vault-context/SKILL.md","LLM-AgentRuntime/skills/vault-context/vault-rules.md","LLM-AgentRuntime/skills/vault-context/conventions.md","LLM-AgentRuntime/skills/vault-context/preferences.md","LLM-AgentRuntime/skills/vault-context/directories.md","LLM-AgentRuntime/skills/vault-context/INDEX.md","LLM-AgentRuntime/skills/vault-api/SKILL.md"] |
| ✅ | 二次初始化不覆盖已存在文件 | vaultSkillSkipped=true readmeSkipped=true initialized=false |

### V16.5-E RUNTIME_FACTS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 默认 obsidianCliAvailable=unknown | isUnknown=true probeNotProbed=true hasSchema=true |

### V16.5-E VAULT_SKILL 初版

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 包结构 SKILL.md 清单 + 子 skill 边界规则/目录语义 | header=true subSkills=true maintenance=true agentRuntimeDir=true vaultRulesHasBoundary=true directoriesHasSemantics=true |

### V16.5-E generateInitialVaultSkill

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回包结构对象 skillMd + subFiles(4) + indexMd | isObject=true skillMdOk=true subFilesOk=true keys=["conventions.md","directories.md","preferences.md","vault-rules.md"] vaultRulesOk=true directoriesOk=true indexMdOk=true |

### V16.5-E VAULT_SKILL

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 已存在文件不被模板覆盖 | skipped=true userEditPreserved=true |

### u5-E materialize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | source → .claude/skills/vault-context/SKILL.md | isOk=true hasPaths=true hasMarker=true hasFrontmatter=true hasInstructions=true status=created |
| ✅ | 内容一致时 skipped | status=skipped |
| ✅ | 人工修改后 conflict 不强制覆盖 | isConflict=true status=conflict reason=target SKILL.md is not plugin-generated |

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
| ✅ | 超限时 compact，不 append-only 膨胀 | length=7625 max=8000 compacted=false |

### V16.5-E prompt

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 包含 Agent workspace / Vault Skill 包 / agent 随时维护 事实 | agentWs=true vaultSkillPkg=true agentMaintain=true facts=true |
| ✅ | 不注入完整 VAULT_SKILL，只注入包路径事实 | hasPkgPath=true notFullContent=true |

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
| ✅ | 子文件超 15 条 compact 到 15，SKILL.md 不动（轻量版无 split） | action=compacted bulletCount=15 noSplit=true rulesCapped=true skillMdUntouched=true structureDirExists=false indexRegenerated=true |

### V16.5-K 轻量版

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 多子文件 compact 不 split | action=compacted noSplit=true allCapped=true counts=[15,15,15,15] structureExists=false |
| ✅ | 无 vault-index 与 split 文件 | vaultIndexDir=false vaultStructureDir=false splitEntries=[] |

### V16.5-K 去噪

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | vault-context 包不含 runtime/session JSON | leakedRuntimeFacts=false leakedSession=false allUnderMax=true files=6 |

### V16.5-K 碎片化

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 临时内容被 isVaultSkillWritableContent 拒绝 | rejectedEmpty=true rejectedTemp=true rejectedCmd=true acceptedStable=true |

### u5 Agent Skill format

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 物化后含 frontmatter + # Instructions + source-id | vcOk=true status=created frontmatter=true instructions=true marker=true sourceHash=true sourceId=true |

### V16.5-K1 包结构

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | vault-context SKILL.md 含子 Skills / 维护规则（无 split） | vcLen=707 underMax=true splitNotice=false indexPointer=false pkgHeader=true subSkills=true maintenance=true |

### V2.18 vault-api Skill

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ensureAgentRuntimeWorkspace 创建 source + 初版含 39 actions + HTTP 通道 | exists=true allActions=true httpBridge=true fsCaveat=true genH1=true genTable=true genActionCount=true genTagFiles=true |

### u5 materializeAllSkillsToAllTargets

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 单个 conflict 不影响其他 target | firstAllOk=true firstCount=8 isConflict=true othersOk=true othersCount=7 vcPiStatus=conflict |
| ✅ | vault-context + vault-api 同步到 agent-skills.json | ok=true synced=2 vaultContext=true vaultApi=true allEnabled=true hasHash=true |
| ✅ | 二次调用幂等（物化结果全 skipped） | ok=true allSkipped=true synced=0 skipped=2 |

### V16.5-K1 manifest 一致性

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | vault-context entry hash/charCount 一致 | saved=true hashMatch=true charCountMatch=true onlyVaultContext=true entries=1 |

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

### u5 materialize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 物化到 .agents/skills 和 .pi/skills 含 frontmatter | genericOk=true piOk=true genericExists=true piExists=true genericFormat=true piFormat=true |

### u5 materializeAgentSkillToTarget

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | sourceDir 时复制附属 .md 到目标目录 | ok=true status=created subA=true subB=true index=true subAContent=true skillMd=true |

### u5 materializeAll

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | vault-context + vault-api 物化到所有 target（统一版） | allTargetsMaterialized=true resultCount=8/8 targetsCovered=true vaFrontmatter=true vaInstructions=true |

### u5 syncVaultSkillsSourceToManifest

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | vault-context record 含 sourceDir + sourceContentHash（vault-api 无） | vcSourceDir=LLM-AgentRuntime/skills/vault-context vcHasSourceDir=true vaSourceDir=undefined vaNoSourceDir=true vcHasSourceContentHash=true |

### V17-A prepareAgentSkillsForCodexRuntimeSync

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | vault-api + vault-context 物化到 Codex home | allOk=true vaultApiOk=true vaultContextOk=true apiFile=true ctxFile=true hasPrefix=true |

### V17-A settings

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | backendProfile/piCommand 字段存在且合法 | backendProfile=true(developer) piCommand=true piArgs=true valid=true |

### V17-B probe

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pi-sdk 未安装时 unavailable 不崩溃 | reason=not-installed available=false providerAvailable=false |

### V17-B buildPlan

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不破坏 promptPackage auditHash | hash=f6e7e7e6 expected=f6e7e7e6 backend=sdk |

### V17-B session.prompt

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | buildPlan 使用 sdk backend（composePromptForBackend sdk mode） | backend=sdk |

### V17-B 事件映射

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | text→message / thinking / tool_start / progress / tool_result / completed / error | message=true thinking=true toolStart=true progress=true toolResult=true completed=true error=true |

### V17-B cancel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 未启动 session 时 cancel 不抛错（abort 路径验证） | cancelNoThrow=true |

### V17-B 权限

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | bridge_write/bridge_edit/bridge_bash 映射为 approval_request 不绕过 PermissionBoundary | writeApproval=true bashApproval=true editApproval=true readNotApproval=true |

### V17-B approval accept

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | accept 后真实写入文件 | hasWriteTool=true hasPending=true acceptExecuted=true fileWritten=true |

### V17-B approval decline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回 tool error/result 不执行 | hasPending=true declined=true detailsDeclined=true |

### V17-B1 package.json

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pi SDK optionalDependencies + installer metadata + smoke script | optionalDep=true installerMeta=true smokeScript=true |

### V17-B1 bridge_* tools

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 替代内置 write/edit/bash 避免同名冲突 | bridge_write=true bridge_edit=true bridge_bash=true noBuiltin=true |

### V17-B1 isWriteToolCall

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 识别 bridge_* 为写操作 | bridge_write=true bridge_edit=true bridge_bash=true readNotWrite=true |

### V17-B1 toolCallId

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | start/update/end 复用同一 id | start=tc-123 update=tc-123 end=tc-123 |
| ✅ | 缺失时回退到 toolName 关联 id 保持一致 | start=pi-sdk-read-1783798110050-0 update=pi-sdk-read-1783798110050-0 end=pi-sdk-read-1783798110050-0 |

### V17-B1 mapPiSdkEvent

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | tool_start 与 tool_result callId 一致 | startCallId=tc-456 endCallId=tc-456 |

### V17-B1 streaming

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | text_delta 立即映射为 message partial | events=1 partial=true text=chunk1 |
| ✅ | prompt throw 映射为 error event（不挂住） | events=1 kind=error msg=prompt boom |

### V17-B1 authProbe

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 未安装时返回可行动提示 | hasAuth=false hasModel=false hint=Pi SDK 未安装。请运行：npm install --ignore-scripts @earendil-works/pi-coding-agent |

### V17-B1 bridge_bash

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | portable 禁用 + developer 不直接执行 | portableDisabled=true devNotExecuted=true |

### V17-B1 bridge_edit

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实字符串替换 + oldText 不存在返回失败 | editOk=true contentReplaced=true notFoundHandled=true |

### V17-B pi-sdk

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | provider 仍可实例化（V17-E1: 不再 portable auto 主线，仅显式 pi-sdk 模式） | providerId=pi-sdk available=false |

### V17-B portable

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pi-rpc 不作为 portable 主线（providerId=pi-rpc） | providerId=pi-rpc |

### V17-C resolveToolMode

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | portable→pi-native / developer→bridge-controlled / 显式覆盖 | portableUnset=pi-native developerUnset=bridge-controlled explicitReadOnly=read-only |

### V17-C DEFAULT_SETTINGS

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | piToolMode=pi-native + piNativeTrustConfirmed=false | toolModeField=true trustField=true toolModeDefault=true trustDefault=true |

### V17-C probePiSdkAuth

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | getAvailable 非空 → hasAuth+hasModel=true | hasAuth=true hasModel=true hint= |
| ✅ | 无 auth/model 时返回可行动提示 | hasAuth=false hasModel=false hint=Pi SDK 未配置认证和模型。请在插件设置「Pi SDK Auth」中配置 Provider / API Key / Model，或运行 pi login。 |

### V17-C pi-native trust

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 未确认阻止启动 + 确认后允许 | trustBlocks=true trustAllows=true toolMode=pi-native |

### V17-C resolveBoundedPath

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 相对OK / 绝对拒绝 / ..越界拒绝 / allowAbsolute仍限cwd | relOk=true absBlocked=true escapeBlocked=true absOutsideBlocked=true innerRelOk=true |

### V17-C resolveBoundedPath 端到端

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 相对路径写入 + 绝对/越界拒绝 | writeOk=true fileWritten=true evilBlocked=true escapeBlocked=true |

### V17-C smoke

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V17-C smoke:pi-sdk: read-only + pi-native 两组 + piAdvancedReady gate + skip 明确 | readOnly=true piNative=true piAdvancedGate=true skip=true |

### V17-C settings.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | piToolMode dropdown + trust 确认按钮 | toolMode=true trust=true |

### V17-C 回归 u5

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 统一物化格式（materializeAllSkillsToAllTargets + Instructions）不回退 | unifiedMaterialize=true instructions=true |

### V17-C1 smoke

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V17-C1 smoke:pi-sdk 状态字段完整（piSdkSmokeStatus/piReadOnlySmokeStatus/piNativeSmokeStatus/piAdvancedReady/skip reason） | piSdk=true readOnly=true piNative=true piAdvancedReady=true skip=true passGate=false |

### V17-C1 main.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Enable/Disable Friend Preview 命令 + preset 设置正确 | enable=true disable=true setsPortable=true resetsTrust=true |

### V17-C1 view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Pi Native Trust onboarding 卡片（风险文案 + 确认/切换按钮） | method=true call=true warn=true backup=true confirm=true switch=true |
| ✅ | Pi SDK 不可用提示卡片（安装命令 + auth probe） | method=true call=true install=true auth=true |

### V17-C1 bridge-controlled

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用 excludeTools 替代 tools=["read"] allowlist | noAllowlist=true usesExclude=true passesExclude=true |

### V17-C1 AgentSessionLike

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | getActiveToolNames 声明（任务 E 真实 SDK fixture 前置） | getActiveToolNames=true |

### V17-C1 回归 V16.5-K1

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 轻量版 vault-runtime skill 格式 | compactOrSplit=true lightweightSkill=true |

### V17-C2 enable/disable Friend Preview

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | backendMode=auto + preset 完整 | enableAuto=true disableAuto=true presetOk=true |

### V17-C2 enable Friend Preview

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不保留旧 cli/sdk/mock backendMode | noCli=true noSdk=true noMock=true setsAuto=true |

### V17-C2 smoke

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | V17-C2 smoke:pi-sdk gate: basic/readOnly/native 三组 + skip→piAdvancedReady=false + native 工具验证 + 临时目录 | basic=true readOnly=true native=true skipLogic=true skipReleaseReady=true passLogic=true nativeToolVerification=true usesTempDir=true |

### V17-C2 main.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Check Pi SDK Dependency 命令 + tryLoadPiSdk + 安装引导 | cmd=true load=true hint=true auth=true |

### V17-C2 朋友版最小验证

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SDK 不可用提示 + trust onboarding 卡片 | hintCard=true trustCard=true confirm=true install=true |

### V17-C2 朋友版

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 运行日志/session 不污染 Vault 根目录（LLM-AgentRuntime/pi-sessions / inMemory） | piRpcSessionDir=true piSdkInMemory=true |

### V17-C2 回归 u5

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 统一物化 + materialize all targets 不回退 | unifiedEntry=true coreMaterialize=true instructions=true |

### V17-D pi-native

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | createAgentSession 不传 tools/excludeTools/customTools + run 走通 | calls=1 noTools=true noExcludeTools=true noCustomTools=true sessionStarted=true message=true completed=true |

### V17-D read-only

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | createAgentSession 传 tools=["read"] 不传 excludeTools/customTools | tools=["read"] excludeTools=undefined customTools=undefined |

### V17-D bridge-controlled

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | excludeTools=[write,edit,bash] + customTools=[bridge_*] 不传 tools allowlist | excludeTools=["write","edit","bash"] customToolNames=["bridge_write","bridge_edit","bridge_bash"] hasCustomTools=true noToolsAllowlist=true |

### V17-D trust gate

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pi-native 未确认 → failed + 不调用 createAgentSession/prompt | failed=true trustMsg=true noSessionCreated=true noPromptCalled=true |

### V17-D prompt event

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | session.prompt 收到 userPrompt + text_delta/agent_end 走通 | promptCalls=1 text=hello v17d hasMessage=true hasCompleted=true |

### V17-D cancel/abort

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | cancel(runId) 触发 session.abort() | abortCalls=1 eventsCount=3 |

### V17-D auth override

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | piApiKey/Provider/BaseUrl 注入 authStorage + model 传入 createAgentSession | setKey=true(2) register=true(2) modelOverride=true completed=true |
| ✅ | 空 override 时不调用 setRuntimeApiKey/registerProvider | noSetKey=true noRegister=true noModelOverride=true completed=true |

### V17-D settings.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Pi SDK Auth section (Provider/Model/API Key/Base URL/Test connection) + hint 指向 UI | section=true provider=true model=true apiKey=true baseUrl=true testConn=true hintToUI=true |

### V17-D 回归 G

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | u5 统一物化 skill format + Claude/Codex provider 不受影响 + PiSdkProvider 导出完整 + types 新字段 | u5Unified=true u5Core=true instructions=true k1Lightweight=true tryAsync=true preload=true setProbe=true authOverride=true probeOverride=true newSettings=true defaults=true claudeSdk=true claudeCli=true codex=true |

### V17-E A

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | CodexAppServerProvider isAvailable/run/resume command 一致 + selectProvider 传 codexCommand + spawn enhanced PATH | isAvailableMember=true noHardcoded=true ctor=true runMember=true noSettingsInRun=true selectPasses=true buildSpawnEnv=true enhancedPath=true importOk=true envPassed=true |

### V17-F0 B+C

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | BackendMode 拆分 codex-sdk/codex-app-server-external + selectProvider SDK-first 链 + Provider 重命名 + CodexSdkProvider 占位 + settings UI 下拉 + 旧 codex 迁移 | codexSdkMode=true codexExtMode=true handlesSdk=true handlesExt=true autoSdkFirst=true extProviderClass=true alias=true sdkProviderFile=true codexSdkOption=true codexExtOption=true autoDescSdkFirst=true migratesLegacyCodex=true |

### V17-F1.1 G+E

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | codex-app-server-smoke 输出 25 字段 readiness matrix（3 分层 + 5 managed runtime + 5 SDK/ext + 12 旧）+ codexUserReady 分层 gate + probeManagedRuntime + flag 收集 | layeredFields=true managedFields=true sdkFields=true legacyFields=true derive=true print=true codexUserReady=true layeredGate=true probeManaged=true skipNotReady=true approval=true fileChange=true procKill=true pollution=true |

### V17-F0 D

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | settings.ts Codex Mainline Status 区块 + Desktop App 非集成目标 + 普通用户主线无 install/login 引导 + External fallback 在 Advanced | mainlineSection=true desktopNotTarget=true noInstallHint=true noLoginHint=true extFallbackSection=true |

### V17-E/F2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | codex/managed smoke 写入 codexUserReady + generate-test-summary 解析/输出 + skip 不写主线通过 + 拆分 fixture/managed runtime 层 | smokeWrites=true summaryParses=true summaryOutputs=true skipNotPass=true splitsLayers=true passRequiresSmoke=true |

### V17-E F

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Pi SDK 降级 optional/advanced backend + friendReady→piAdvancedReady + ESM dynamic import 独立修复项 | f1=true (types=true settings=true bridge=true) f2=true (noFriendReady=true hasPiAdvancedReady=true docsRename=true) f3=true (providerDocs=true esmIndependent=true) |

### V17-E1 C+D

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | user-package 不写 type=module + smoke:user-package 脚本 + 报告产物 + canLoadMainJs/noRootPackageJson 检查 | c=true (noTypeModule=true writesMeta=true cleansResidual=true runsNpmBuild=true) d=true (hasSmoke=true hasBuildSmoke=true writesReport=true outputsStatus=true) smoke=true (canLoadMainJs=true noRootPkgJson=true) |

### V17-F1.1/F2.1 G+E

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | readiness matrix 写入 codex smoke report（25 字段）+ codexUserReady 分层 gate + summary 解析/输出 managed + external compatibility | g=true (writeReportHasMatrix=true hasDeriveUserReady=true gateChecksKeyFields=true gateChecksLayered=true) summary=true (parses=true outputs=true) |

### V17-F2 A+B+C+D

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | managed runtime 组件结构（production manifest + fixture manifest + resolver + provider + BackendMode + auto 链 + settings） | a=true (typesManifest=true manifestExists=true fixtureManifest=true manifestOk=true fixture=false platforms=1) b=true (exports=true sha=true exec=true resultIf=true) c=true (extends=true providerId=true overrides=true coreTypesProviderId=true templateMethod=true) d=true (backendMode=true autoManagedFirst=true settingsOption=true) |

### V17-F3

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | user-package 默认 download-on-first-run + offline bundled current platform + smoke 分发字段 + managed runtime protocol smoke 保持 | e=true (manifestInstaller=true offlineMode=true avoidsDefaultRuntimeCopy=true smokeChecksManaged=true) f=true (hasSmokeScript=true verifiesChain=true protocolProof=true) |
| ✅ | user-package pass gate 纳入 runtime distribution mode + summary 解析输出 | gateIncludes=true fixtureNotBlocking=true summaryParses=true summaryOutputs=true |

### V17-F3 A-E

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | runtime distribution report 覆盖三种模式、平台专用包、默认下载、离线包体积字段、installer UX contract | scriptExists=true reportScript=true installerSmoke=true modes=true fields=true platformNames=true noFat=true installerNpmFree=true installerUx=true |

### V17-F3.2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | first-run runtime install 状态/UI 接入 + 远程下载/first-run smoke + summary 字段 | downloadSmoke=true firstRunSmoke=true scripts=true autoStops=true ui=true settings=true plugin=true reports=true |

### V17-F1.1 F / P0

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | resolver 热路径不读完整 binary + 异步 SHA 缓存 + sha mismatch/platform/exec/OK | shaMismatch=true platformMissing=true execFail=true resolverOk=true hotPath=true |

### P0

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 发送热路径首帧立刻写 UI，不在发送时同步哈希 runtime exe | sendPathNoSyncHash=true |

### V17-F1.1 B+F

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | managed provider 不调 settings.codexCommand + 不执行 codex --version + super() 注入 providerId + approval providerId=codex-managed-app-server | noCodexCommand=true passesViaSuper=true noFieldOverride=true parentAcceptsParams=true parentUsesParam=true hasGetApprovalProviderId=true mapperHasGetProviderId=true noVersionCheck=true |

### V17-F1.1 C+F

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pluginDir 注入路径（main.ts onload + selectProvider + createBridgeSession + createManagedProvider + view.ts 传递） | mainSets=true selectAccepts=true createAccepts=true managedAccepts=true fallback=true viewPasses=true |

### V17-F1.1/F2.1 E+F

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | managed runtime smoke 分层字段 + 平台/认证边界 + fixture-only 非 pass + skip-fixture + codexUserReady 分层 gate + summary 解析 | smokeHasLayered=true smokeHasBoundary=true fixtureNotPass=true hasSkipFixture=true codexSmokeHasLayered=true userReadyUsesLayered=true summaryParsesLayered=true |

### V17-F0 F

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | settings.ts External Codex App-Server Fallback 区块（标题 + hint + Command/Status 设置 + heuristic-ready + 探测逻辑 + 重新检测） | extTitle=true hintNotMainline=true extCmd=true extStatus=true heuristicReady=true probesVersion=true probesAppServer=true redetect=true |

### V17-E1 D

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | summary 解析 user-package 报告 + 输出 6 字段 | hasParseFunc=true outputsFields=true |

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

### Helper Behavior

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | --wait --timeout 超时行为（fake server） | exit=1 elapsed=3271ms hasTimeout=true hasAssertion=false stderr=等待超时（2s）。actionId: timeout-test-id
 |
| ✅ | --wait 成功路径（fake server 第 3 次轮询转 completed） | exit=0 elapsed=4659ms hasCompleted=true stdout=Action 已完成。actionId: fake-id-1783798115708
 |
| ✅ | health 命令（fake server） | - |
| ✅ | --json 标志输出有效 JSON（fake server） | - |
| ✅ | 非修改类 action 直接输出（不轮询） | {
  "ok": true,
  "id": "fake-id-1783798120670",
  "status": "completed",
  "result": {
    "type":  |
| ✅ | --stdin 模式读取 JSON params | {
  "ok": true,
  "id": "fake-id-1783798120833",
  "status": "completed",
  "result": {
    "type":  |
| ✅ | --raw 输出纯 JSON（单行） | {"ok":true,"id":"fake-id-1783798120975","status":"completed","result":{"type":"tags_list","fake":tru |
| ✅ | 错误分级 - bridge.json 缺失 exit 2 | exit=2 stderr=[bridge 未启动] 未找到 .llm-bridge/bridge.json。
  请确认 Obsidian 已启动且 llm-cli-bridge 插件已 |
| ✅ | 错误分级 - JSON 解析失败 exit 5 | exit=5 stderr=[参数解析失败] JSON 格式错误: Expected property name or '}' in JSON at position 1 (line 1  |
| ✅ | obsidian-bridge wrapper 生成（obsidian-bridge.cmd + obsidian-bridge） | win=true unix=true |
| ✅ | 真实 wrapper invocation（当前平台 health 实跑） | platform=win32 wrapperExists=true exit=0 stdout={
  "ok": true,
  "data": {
    "vaultPath": "C:\\Users\\Ye_Luo\\AppData\\Local\ stderr= |

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

### V17-G timelineAdapter

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | JSON 字符串 toolInput 不触发 in-operator 渲染异常 | stringParams=0 objectParams=command=echo ok,cwd=C:\vault |

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
| ✅ | agent 切换重置，composer 不再暴露手动刷新 | agentChange=true refreshMenuRemoved=true |

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
| ✅ | 返回非空 id | id=s-2026-07-11T19-29-07-617Z-vjug6l |

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
| ✅ | 按 savedAt 降序（最新在前） | len=5 first=s-2026-07-11T19-29-07-690Z-t0czm9 second=s-2026-07-11T19-29-07-629Z-g8t8em |
| ✅ | 空目录返回空数组 | len=0 |

### V2.5 Session 删除

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 删除后 loadSession 返回 null | ok=true session=null |
| ✅ | 不存在返回 false | ok=false |

### V17-G72 Session 删除

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Bridge 会话关联清理 Codex 原生 session | bridge=true nativeDeleted=1 indexDeleted=1 bridgeGone=true nativeGone=true indexClean=true |

### V17-G72 Session 清空

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 清空 Bridge store 并删除关联 Codex session | bridgeDeleted=2 nativeDeleted=1 indexDeleted=1 remaining=0 indexClean=true |

### Phase 2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Bridge 历史删除不再模糊扫描文件内容（endsWith + 移除 content scan） | - |
| ✅ | Codex session index 使用 JSON 精确字段匹配（非 line.includes 子串） | - |
| ✅ | 提供 Sync Skills + Clean Plugin-Generated Skills 命令入口 | - |

### Phase 3

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Modal Esc/遮罩关闭正常结束 Promise（3 处 onClose 兜底 + resolved 守卫） | onCloseCount=3, hasResolvedGuard=true |
| ✅ | Retry 同时恢复原消息文字、图片和文件附件（深拷贝 fileRefs） | - |
| ✅ | 大图片大小限制（10MB）+ 格式检查 + 降级路径引用提示 | limit=true, format=true, downgrade=true |
| ✅ | 自动恢复历史期间避免覆盖用户刚输入或发送的新消息（竞态保护） | - |
| ✅ | 新建/恢复/删除会话在确认后重新检查运行状态 | - |
| ✅ | Runtime 状态区分（未安装/准备中/运行中/失败/可用，computeRuntimeStateLabel 统一） | method=true, states=true |
| ✅ | 一键复制脱敏诊断信息（copyDiagnosticsToClipboard + redactSecrets + 命令入口） | method=true, usesRedact=true, command=true |

### Phase 4

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 设置页高级选项折叠到 <details>（普通用户首屏只见基础配置+日志+首次提示） | details=true, summary=true |
| ✅ | PDF/Office 附件显示「路径引用」标记（不伪装成直接上传） | badge=true, style=true |
| ✅ | 状态栏以实际 Runtime 为中心（Backend→Runtime label，Agent 移入高级折叠区） | runtimeLabel=true, showsRuntime=true, agentInAdvanced=true |

### Phase 5

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 部署脚本 reload 改用 CDP（移除固定端口 42167 和 /api/reload-plugin 调用） | cdp=true, noFixedPort=true, noInvokeReload=true, noInvokeHealth=true |
| ✅ | 发布凭证生成脚本存在（generate-release-receipt.mjs + npm run release:receipt） | script=true, npmScript=true |
| ✅ | 发布凭证包含三方 SHA 一致性校验（源码↔user-package↔Vault）+ 版本/提交/产物 SHA | shaCheck=true, receipt=true |

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
| ✅ | 生成 s- 前缀且唯一 | id1=s-2026-07-11T19-29-07-772Z-eukt6p id2=s-2026-07-11T19-29-07-772Z-arilcn |

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
| ✅ | applyCount+1 且 lastUsedAt 更新 | before=0 after=1 lastUsedAt=2026-07-11T19:29:07.855Z |
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
| ✅ | savedAt 非字符串用当前时间 | savedAt=2026-07-11T19:29:07.923Z |

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

### V2.7 messageRenderer

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 含 renderMessageError 错误 fallback | - |

### V2.7 view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
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
| ✅ | savedAt 更新为当前时间 | before=2026-07-11T19:29:07.998Z after=2026-07-11T19:29:08.060Z |
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
| ✅ | 重命名后新名 meta 完整 + 旧名孤儿清理 | newOk=true oldGone=true oldFileGone=true newFileExists=true newMeta={"applyCount":3,"lastUsedAt":"2026-07-11T19:29:09.322Z","pinned":true,"groupOverride":"测试组"} |

### V2.12.1 字段完整性

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | pinned/applyCount/lastUsedAt/groupOverride 全部迁移 | pinned=true applyCount=5 lastUsedAt=2026-07-11T19:29:09.330Z groupOverride=GroupA oldGone=true |

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
| ✅ | legacy pinned 数据可恢复，但普通 UI 不再提供新 pin 入口 | - |

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

### V17-G72 Codex Skills

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 物化到 Codex home personal skills 而非 .claude | path=C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-codex-home-3SAmtb\skills\llm-bridge-2707a3bd-review-skill\SKILL.md |
| ✅ | run 前从 Bridge manifest 物化 enabled Skills | ok=true count=1 |

### V2.13.0-C materializeEnabled

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 只物化 enabled Agent Skills | results=1 |

### V2.13.0-C boundary

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Agent Skill 正文不拼进 promptPackage | - |

### P0 Skill ownership

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 旧 ID 可迁移 / 外部不可覆盖 / 非 llm-bridge 目录冲突 / 幂等 | migrate=true idempotent=true foreign=true wrongDir=true helper=true |

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
| ⏭️ | V2.14.0-I1 symlink realpath hardening runtime test | 当前环境无法创建 symlink/junction: EPERM: operation not permitted, symlink 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-i1-external-JEy2sr\outside.md' -> 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-i1-vault-dG2fdf\link-out.md' |

### V2.14.0-J agent file tool route

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | read-only routing + policy gate + result surface | routing=true policy=true pending=true deny=true result=true noWrite=true boundary=true |

### V2.14.0-J route symlink escape runtime test

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.14.0-J route symlink escape runtime test | 当前环境无法创建 symlink；静态确认路由委托 executor realpath guard=true: EPERM: operation not permitted, symlink 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-j-external-TxR8Cv\outside.md' -> 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-j-vault-AeG1gG\link-out.md' |

### V2.14.0-K runtime file tool adapter

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | SDK/CLI route through read-only bridge | adapter=true cli=true sdk=true pending=true deny=true result=true noWrite=true boundary=true |

### V2.14.0-K runtime adapter symlink escape runtime test

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.14.0-K runtime adapter symlink escape runtime test | 当前环境无法创建 symlink；静态确认 adapter 委托 executor realpath guard=true: EPERM: operation not permitted, symlink 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-k-external-Aix2hN\outside.md' -> 'C:\Users\Ye_Luo\AppData\Local\Temp\llm-bridge-k-vault-RXdgmD\link-out.md' |

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

### Process 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Process 测试段 | 当前为 unit/integration 模式，跳过 process 测试 |

### Claude Smoke 段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Claude Smoke 段 | 当前模式不运行 claude smoke |

### Claude Note Summarize Smoke 段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Claude Note Summarize Smoke 段 | 当前模式不运行 note summarize smoke |

### V2.16-D contextMetrics.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 核心函数与接口存在 | - |

### V2.16-D view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | context metrics UI 方法与元素存在 | - |
| ✅ | 会话保持 restoreLastActiveSessionIfNeeded 存在 | - |
| ✅ | runtime status pill 格式 + Phase1 初始文案 + Phase3 统一状态 | - |
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
| ✅ | 拖拽/粘贴文件入口存在，普通复制文本保持文本 | - |

### V17-G41 composer

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 普通复制文本保持原文，损坏路径/文件名不进入附件流 | - |

### V17-G47 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 图片缩略会裁掉大白边，文档缩略改为更平静的三行卡片 | - |

### V17-G48 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 轻量文件预览弹窗保持单实例 | - |

### V17-G3 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer/context/files surface 靠近 Codex native 风格 | - |

### V17-G4 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 普通模式移除 legacy Run Flow，composer 状态随设置刷新 | - |
| ✅ | 普通态消息渲染兜底不暴露内部异常横幅 | - |
| ✅ | 活动笔记在 Bridge/composer 聚焦后仍保留最近文件 | - |

### V17-G5 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer 内嵌活动笔记/context，文件和权限标签统一收口 | - |

### V17-G6 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Files 清单、请求弹窗和 composer 继续靠近 Codex 风格 | - |

### V17-G7 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 普通态隐藏 reasoning 占位和 warning diagnostics，assistant 输出承载瀑布流 | - |
| ✅ | composer、活动笔记、权限弹窗和文件/request 表面收口 | - |

### V17-G8 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Codex 瀑布流去重、活动笔记兜底和输入/文件表面继续收口 | - |

### V17-G60 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 去掉目标表述，附件预览继续收成严格方块缩略 | - |

### V17-G61 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | assistant narrative 增量化，去掉假 thinking 占位，shell/output 合并为单块瀑布事件 | presentationOk=true uiOk=true |

### V17-G62 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 直接从 managed Codex runtime 读取 installed plugins（工具列表已移除计划模式入口，plan 仍由 permission popover 提供） | - |

### V17-G65 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 多工具批次折叠为懒渲染工具组，命令一行摘要，composer 输入跨满宽度 | - |

### V17-G66 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | file change 折叠态与 Shell 同风格，assistant Vault 链接可打开，composer 长文本不压工具栏 | - |

### V17-G67 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Process/Answer 响应式收缩，header 不重复首个 Thinking 文本 | - |

### V17-G68 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer 文本区不被底部控件遮挡，Thinking 铺满且输出可选择复制 | - |

### V17-G69 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 工具子步骤改为紧凑可展开行，插件内联显示，发送与模型控件对齐 | - |

### V17-G70 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 模型按 agent 对齐，工具菜单支持 Skills 并压缩为 Codex 风格 | - |

### V17-G71 Codex Skills

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | managed provider materializes Bridge Skills instead of prompt-injecting them | - |

### V17-G72 UI/session

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 顶栏瘦身、左栏折叠、上箭头发送与关联清空会话 | - |

### V17-G73 History

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 多选/全选删除会同步清理原生 Codex session，列表改为插件式行 | - |

### V17-G74 UI/protocol

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Codex 图片 input 使用 localImage，会话下拉标题时间分行防溢出 | - |

### V17-G75 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 命令/文件事件标题纯计数，普通态不回退成气泡卡片 | - |

### V17-G76 Provider

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 空 turn/completed 不再渲染为空白 Completed | - |

### V17-G77 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Codex debug 抽屉不污染 Process，空白 completed 降级为可读失败 | - |

### V17-G78 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 权限和会话下拉复用紧凑菜单结构，会话不再渲染明细摘要 | - |

### V17-G10 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 权限弹窗、approval/request 和 Files 行保持 Codex 紧凑表面 | - |

### V17-G16 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Files/context rows use thumbnails and compact type labels | - |

### V17-G17 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer file chips stay compact | - |

### V17-G25 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer attachments match Codex compact send tray | - |

### V17-G18 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | user bubble attachments preview inline with lightweight modal | - |

### V17-G24 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | user image attachments render as compact thumbnail-only tiles | - |

### V17-G22 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | approval、user input 和 external-read 请求表面保持 Codex 紧凑 | - |

### V17-G23 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 活动笔记空态保留 No active note，步骤状态改为 Codex 纯文本 | - |

### V17-G26 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | permission/context bottom status stays compact | - |

### V17-G27 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | user attachments and Skills registry stay Codex-like compact | - |

### V17-G28 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | previews, dialogs and attachment tiles stay lightweight | - |

### V17-G30 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用户输入右侧展示，消息附件为小方块，轻量预览无底部按钮 | - |

### V17-G31 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用户气泡附件置顶，图片 tile 不显示 PNG/JPG 格式标签 | - |

### V17-G32 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 非图片附件以文档缩略块展示，不用格式标签占主视觉 | - |

### V17-G45 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 文档缩略块无文本时退化为轻量图标，不出现空白 tile | - |

### V17-G33 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Skills、权限弹窗和审批卡片保持扁平紧凑 | - |

### V17-G34 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 外部文件访问请求以缩略目标文件块展示 | - |

### V17-G35 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer 附件保持缩略小方块，不回退成长条 | - |

### V17-G36 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer 状态行集成进顶部轻量文本，不回退成按钮横线 | - |

### V17-G37 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Files/Context 非图片文件使用文档缩略块，不用扩展名角标作主视觉 | - |

### V17-G38 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 文件缩略块承载真实文本预览，顶部会话/历史表层继续简化 | - |

### V17-G39 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | run 过程与最终答案分层，顶部/历史/输入区继续收口 | - |

### V17-G53 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | batch waterfall、Sessions 头部和右侧用户附件缩略继续靠近 Codex | - |

### V17-G54 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 顶栏、History、composer meta row 与 Shell 块继续向 Codex 风格收口 | - |

### V17-G56 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Steps 折叠、Final answer、sessions 与 modal 表面继续收口 | - |

### V17-G57 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 普通粘贴文本保持原文，用户附件 tile 继续稳定为轻量预览 | - |

### V17-G40 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用户附件保持缩略方块，预览弹窗回归轻量只读 | - |

### V2.16-D file input

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Vault ref + external attachment grant 分流 | - |

### Chat UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 完成回答仅 copy；过程 feed 与 run chrome 拆分；附件移除不删原文件 | actions=["copy"] runningFeed=true opsFeed=true chrome=false status=true remove=true |

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

### Phase 1.4-GUARD-1

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | mount 与 reconcile 使用同一节点（结构） | - |

### Phase 1.4-GUARD-2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | candidate 流式升级 Markdown 不重建节点（结构） | - |

### Phase 1.4-GUARD-3

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | command 1→2 条时 group key 不变（结构） | - |

### Phase 1.4-GUARD-4

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | approval host 不重复（结构） | - |

### Phase 1.4-GUARD-5

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 完成后思考与工具过程保留（结构） | - |

### Phase 1.4-GUARD-6

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | Composer popup 互斥 + outside-click + 附件键盘删除（结构） | - |

### Phase 2-GUARD-7

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | RunSessionController 零 DOM 依赖（纯回调接口） | - |

### Phase 1.4-GUARD-8

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | view.ts 不再直接导入 view-model builders（结构） | - |

### Phase 2-DOM-1

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | keyed feed reconciliation 节点身份保持（不重建）（算法复制，生产函数验证见 Phase 3-DOM-1） | sameA=true sameB=true order=true |

### Phase 2-DOM-2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | candidate 原地升级 Markdown（entry 身份不变）（算法复制，生产函数验证见 Phase 3-DOM-2） | same=true streamRemoved=true hasText=true line=true |

### Phase 2-DOM-3

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | command 1→2 条时 group 节点身份不变（算法复制，生产函数验证见 Phase 3-DOM-3） | keyOk=true sameNode=true updated=true |

### Phase 2-DOM-4

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | approval host 复用（不重复创建） | same=true count=1 |

### Phase 2-DOM-5

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | terminal 状态保留 process body（不清空） | before=2 after=2 |

### Phase 2-DOM-6

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | composer 附件 Backspace 选中→删除 + 文本优先（算法复制，生产函数验证见 Phase 3-DOM-6） | selected=true removed=true textPriority=true |

### Phase 2-DOM-7

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | isEventInsideSelector 区分内外点击（算法复制，生产函数验证见 Phase 3-DOM-7） | inside=true outside=false |

### Phase 2-DOM-8

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | session traversal 防护（deleteSession 走 resolveSessionFilePath + id 校验）（算法复制，生产函数验证见 Phase 3-DOM-8） | deleteResolve=true listBasename=true hasResolve=true blocksTraversal=true |

### Phase 2-DOM-9

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | provider bookkeeping 在 finally + cancel 清理 | clearCount=5 |

### Phase 3-DOM-1

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实 groupCodexFeedRenderEntries key 稳定性 + reconciliation（生产函数） | keysMatch=true stable=true sameA=true sameB=true |

### Phase 3-DOM-2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实 patchCodexFeedEntryItem candidate 原地升级（生产函数） | same=true streamRemoved=true hasText=true line=true done=true |

### Phase 3-DOM-3

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实 groupCodexFeedRenderEntries command 1→2 条 group key 不变（生产函数） | isGroup=true sameKey=true oneGroup=true key=group:command:seq:1:cmd1 |

### Phase 3-DOM-6

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实 handleComposerAttachmentKeydown 选中→删除 + 文本优先（生产函数） | selected=true removed=true textPriority=true |

### Phase 3-DOM-7

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实 isEventInsideSelector 区分内外点击（生产函数） | inside=true outside=false |

### Phase 3-DOM-8

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实 validateSessionId 拒绝 traversal / 控制字符（生产函数） | blocksTraversal=true |

### Phase 3-DOM-10

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 真实 isCodexImageFeedItem + formatCodexImageGroupTitle（生产函数） | isImage=true title=true single="Viewed image" active="Viewing image" |

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
| ✅ | turn/start 携带 approvalsReviewer（恢复会话切换替我审批→auto_review） | askTurnReviewer=user autoTurnReviewer=auto_review resume=true |
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

### V17-F4 Codex capability smoke

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | sourceRef + command/file/user-input/reasoning/mcp/dynamic/context/review timeline | nodes=9 sourceRefs=true command=true command2=pending file=true userInput=resolved mcp=github dynamic=true |

### V17-F4 TurnTimelineModel

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | display model renders TurnTimelineNode instead of legacy running-tool inference | timelineNodes=1 cards=1 commandCard=true legacySuppressed=true |

### V17-F4 capability matrix report

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | method/item/serverRequest statuses generated | exists=true methods=true items=true requests=true statuses=true |

### V17-F4 timeline smoke report

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | rich renderer + item binding + UI contract covered | exists=true status=true parallel=true rich=true ui=true |

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
| ✅ | run1 thread/start 注册 threadId（provider 全路径） | sessionStarted=true text=thread-provider-1 mappedTid=thread-provider-1 eventsCount=4 |
| ✅ | run2 thread/resume + turn/start 使用 resumed threadId（P2 主线闭环） | threadResume=true threadStartOnRun2=false resumeTidOk=true turnStartTidOk=true turnStartContextOk=true resumedEv=true eventsCount=4 |

### 任务5a

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | isMeaningfulCodexRuntimeEvent — message/tool/file/approval/failed 有效，progress/session/thinking/stderr/completed 无效 | meaningful=true nonMeaningfulExcluded=true |

### 任务5b

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | only initialized + turn/completed(empty) → provider 输出 failed（no-op guard） | kinds=progress,session_started,native_session_bound,failed hasFailed=true hasCompleted=false msgOk=true |

### 任务5b-extra

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | turn with agentMessage → completed（no-op guard 不误触发） | kinds=progress,session_started,native_session_bound,message,completed hasCompleted=true hasFailed=false |

### 任务5c-1

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | JSON-RPC invalid line before turn → stderr_delta + terminal failed | kinds=stderr_delta,failed,progress,session_started,native_session_bound,completed hasStderrDelta=true hasTerminalFailed=true |

### 任务5c-2

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | JSON-RPC invalid line during turn → stderr_delta + no-op failed（stderr_delta 不算 meaningful） | kinds=progress,session_started,native_session_bound,stderr_delta,failed hasStderrDelta=true hasFailed=true hasCompleted=false |

### 任务5d

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | approval request/resolved requestId 闭环（requestId 一致 + server 收到 matching response） | hasApprovalReq=true hasApprovalResolved=true responseOk=true requestId=codex-req-300 kinds=progress,session_started,native_session_bound,approval_request,approval_resolved,completed |

### 任务5e

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | attachment contract — turnStart.attachments===undefined + input 只含 text+localImage + audit hash 稳定 | attachmentsUndefined=true hasText=true hasLocalImage=true hasFileVariant=false hashStable=true |

### Test report integrity

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | unit/process 报告含 commit sha + 运行命令字段 | unitExists=true processExists=true unitSha=true processSha=true unitCmd=true processCmd=true |
| ✅ | summary 由 generate-test-summary.mjs 解析生成（含审计结果 + commit sha 表） | exists=true parsed=true audit=true shaTable=true |
| ✅ | summary 含 Managed Codex Runtime 必需审计字段（testedCodeCommitSha/reportCommitSha/reportParentSha/unitReportSha/processReportSha/managed gate） | exists=true testedSha=true reportSha=true parentSha=true unitSha=true processSha=true managedGate=true capturedTestedSha=d8374b229554 |
| ✅ | 审计模式 testedCodeCommitSha 不匹配 + managed runtime gate 异常 → exit 1 | scriptExists=true auditFailExit=true testedCodeShaCheck=true managedGateCheck=true docsOnlyLogic=true |

## 失败项详情

无失败项。

## 需人工验证项

无。

---

*报告由 `scripts/run-tests.mjs` 自动生成*