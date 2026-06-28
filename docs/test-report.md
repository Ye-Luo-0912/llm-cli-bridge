# LLM CLI Bridge 测试报告

- **测试时间**: 2026-06-28T16:39:43.602Z
- **测试环境**: win32 / Node.js v24.14.0
- **插件版本**: 2.4.0
- **main.js 大小**: 254.0 KB
- **Vault 路径**: `D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki`
- **bridge.json 存在**: 是
- **HTTP 端口**: 49742

## 测试汇总

- ✅ **通过**: 313
- ❌ **失败**: 0
- ⏭️ **跳过**: 22
- ⚪ **需人工验证**: 0
- **总计**: 335

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

### 文件快照

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 生成运行前快照 | 文件数: 13 |

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

### Contract

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | started 必须先发出 | - |
| ✅ | stdout_delta 正常产出 | - |
| ✅ | stderr_delta 正常产出 | - |
| ✅ | completed 正常产出 | - |
| ✅ | failed 正常产出 | - |
| ✅ | stop() 产出 stopped/failed | - |
| ✅ | stop() 多次调用不抛异常 | - |
| ✅ | cwd 不存在返回 failed | - |
| ✅ | command 不存在返回 failed | - |

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
| ✅ | stream_event 标记 partial 不产出事件 | partial=true events=0 terminal=null |
| ✅ | 未知消息类型忽略 | events=0 terminal=null partial=false |
| ✅ | 映射层保留原文（脱敏由调用方负责） | - |

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

### V2.0 completed 终态

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | result success → message + completed 事件 | hasCompleted=true terminalCompleted=true |

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

### V2.0 partial 不变

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | stream_event 标记 partial 不产出事件（不伪造工具过程） | partialOk=true |

### V2.0 CLI 不回归

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | ClaudeCliBackend 不产生 workflow 事件 | hasStdout=true noWfEvents=true wfCount=0 |
| ✅ | ClaudeCliBackend 可正常加载 | ClaudeCliBackend=function |

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
| ✅ | 终态消息携带 sessionId | sessionIdOk=true terminal=completed |
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
| ✅ | 实例化且 name='sdk-experimental' | name=sdk-experimental |

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

## 失败项详情

无失败项。

## 需人工验证项

无。

---

*报告由 `scripts/run-tests.mjs` 自动生成*