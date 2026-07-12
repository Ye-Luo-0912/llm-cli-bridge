# LLM CLI Bridge 测试报告 — 进程测试（process）

- **测试时间**: 2026-07-12T21:58:48.053Z
- **测试环境**: win32 / Node.js v24.14.0
- **插件版本**: 2.18.0
- **main.js 大小**: 1379.8 KB
- **main.js bundle content smoke**: PASS ({"HttpBridge":true,"writeHelperAndWrappers":true,"CodexAppServerProvider":true,"vault_api":true})
- **Vault 路径**: `D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki`
- **bridge.json 存在**: 是
- **HTTP 端口**: 63359
- **commit sha**: 6329c318735ae38f3d76ce167d942e44f4bab6da
- **commit 短 sha**: 6329c318735a
- **运行命令**: node scripts/run-tests.mjs --process

## 测试汇总

- ✅ **通过**: 280
- ❌ **失败**: 0
- ⏭️ **跳过**: 63
- ⚪ **需人工验证**: 0
- **总计**: 343

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
| ✅ | 生成运行前快照 | 文件数: 62 |

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

### Bridge Core tests 段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Bridge Core tests 段 | 当前为非 unit 模式，跳过 |

### AgentBackend contract tests 段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | AgentBackend contract tests 段 | 当前为 integration 模式，跳过 unit 测试 |

### UI 映射测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | UI 映射测试段 | 当前为 integration 模式，跳过 unit 测试 |

### Profile 解析测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Profile 解析测试段 | 当前为 process/integration 模式，跳过 unit 测试 |

### File Diff 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | File Diff 单元测试段 | 当前模式不运行 unit |

### Bridge Metadata Sync 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Bridge Metadata Sync 测试段 | 当前为 process/claude 模式，跳过 bridge unit 测试 |

### Helper Behavior

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | --wait --timeout 超时行为（fake server） | exit=1 elapsed=3379ms hasTimeout=true hasAssertion=false stderr=等待超时（2s）。actionId: timeout-test-id
 |
| ✅ | --wait 成功路径（fake server 第 3 次轮询转 completed） | exit=0 elapsed=4643ms hasCompleted=true stdout=Action 已完成。actionId: fake-id-1783893532517
 |
| ✅ | health 命令（fake server） | - |
| ✅ | --json 标志输出有效 JSON（fake server） | - |
| ✅ | 非修改类 action 直接输出（不轮询） | {
  "ok": true,
  "id": "fake-id-1783893537571",
  "status": "completed",
  "result": {
    "type":  |
| ✅ | --stdin 模式读取 JSON params | {
  "ok": true,
  "id": "fake-id-1783893537687",
  "status": "completed",
  "result": {
    "type":  |
| ✅ | --raw 输出纯 JSON（单行） | {"ok":true,"id":"fake-id-1783893537798","status":"completed","result":{"type":"tags_list","fake":tru |
| ✅ | 错误分级 - bridge.json 缺失 exit 2 | exit=2 stderr=[bridge 未启动] 未找到 .llm-bridge/bridge.json。
  请确认 Obsidian 已启动且 llm-cli-bridge 插件已 |
| ✅ | 错误分级 - JSON 解析失败 exit 5 | exit=5 stderr=[参数解析失败] JSON 格式错误: Expected property name or '}' in JSON at position 1 (line 1  |
| ✅ | obsidian-bridge wrapper 生成（obsidian-bridge.cmd + obsidian-bridge） | win=true unix=true |
| ✅ | 真实 wrapper invocation（当前平台 health 实跑） | platform=win32 wrapperExists=true exit=0 stdout={
  "ok": true,
  "data": {
    "vaultPath": "C:\\Users\\Ye_Luo\\AppData\\Local\ stderr= |

### V1.1 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V1.1 单元测试段 | 当前模式不运行 unit |

### V1.5 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V1.5 单元测试段 | 当前模式不运行 unit |

### V1.6 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V1.6 单元测试段 | 当前模式不运行 unit |

### V1.7 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V1.7 单元测试段 | 当前模式不运行 unit |

### V1.8 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V1.8 单元测试段 | 当前模式不运行 unit |

### V2.0 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.0 单元测试段 | 当前模式不运行 unit |

### V2.0 Session/Skills 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.0 Session/Skills 单元测试段 | 当前模式不运行 unit |

### V2.1 Skills Pack 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.1 Skills Pack 单元测试段 | 当前模式不运行 unit |

### V2.3 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.3 单元测试段 | 当前模式不运行 unit |

### V2.3s 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.3s 单元测试段 | 当前模式不运行 unit |

### V2.4 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.4 单元测试段 | 当前模式不运行 unit |

### V2.5 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.5 单元测试段 | 当前模式不运行 unit |

### V2.6 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.6 单元测试段 | 当前模式不运行 unit |

### V2.7 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.7 单元测试段 | 当前模式不运行 unit |

### V2.8 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.8 单元测试段 | 当前模式不运行 unit |

### V2.9 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.9 单元测试段 | 当前模式不运行 unit |

### V2.10 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.10 单元测试段 | 当前模式不运行 unit |

### V2.11 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.11 单元测试段 | 当前模式不运行 unit |

### V2.11.1 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.11.1 单元测试段 | 当前模式不运行 unit |

### V2.12.1 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.12.1 单元测试段 | 当前模式不运行 unit |

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

### V2.13.0-C Agent Skill Manifest 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.13.0-C Agent Skill Manifest 单元测试段 | 当前模式不运行 unit |

### V2.13.0-D CLI Runtime Alignment 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.13.0-D CLI Runtime Alignment 单元测试段 | 当前模式不运行 unit |

### V2.13.0-E SDK Skills Alignment 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.13.0-E SDK Skills Alignment 单元测试段 | 当前模式不运行 unit |

### V2.13.0-F Agent Skills UI Split 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.13.0-F Agent Skills UI Split 单元测试段 | 当前模式不运行 unit |

### V2.14.0-A File Access Permission Boundary 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.14.0-A File Access Permission Boundary 单元测试段 | 当前模式不运行 unit |

### V2.14.0-B Shared File Access Policy Module 单元测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.14.0-B Shared File Access Policy Module 单元测试段 | 当前模式不运行 unit |

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

### Preflight

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | cwd 不存在 → failed diagnostic | - |
| ✅ | command 不存在 → unavailable | - |
| ✅ | version 成功 → available | - |
| ✅ | command 为空 → unavailable | - |
| ✅ | debug log 不含 secret | - |
| ✅ | 路径带空格可运行 | - |
| ✅ | claude 真实命令探测 | available=true, stdout="2.1.200 (Claude Code)
" |
| ⏭️ | codex 真实命令探测 | codex 未安装或不可用 (exitCode=1) |

### Process File Diff

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | fixture write-file completed | - |
| ✅ | diff 检测到 fixture 写入的新文件 | - |

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

### 运行过程 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | shell 与 output 合并为单块瀑布事件 | uiInvariant=true |
| ✅ | 工具事件支持分组增量更新，composer 文本区与工具栏分层 | - |

### V17-G62 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 直接从 managed Codex runtime 读取 installed plugins（工具列表已移除计划模式入口，plan 仍由 permission popover 提供） | - |

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

### 运行时 UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 模型目录按 agent 路由，工具菜单可选择 Skills | - |

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

### V2.16-H timeline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用户态隐藏 session/text/raw tool input，仅保留语义过程节点 | - |

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

### V2.16-G SDK streaming

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | partial stream/progress 映射并增量输出 | - |

### Phase 1.4 架构 guard 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Phase 1.4 架构 guard 测试段 | 当前模式不运行 unit |

### Phase 2 DOM harness 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Phase 2 DOM harness 测试段 | 当前模式不运行 unit |

### Phase 3 生产函数测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Phase 3 生产函数测试段 | 当前模式不运行 unit |

### VC DOM 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | VC DOM 测试段 | 当前模式不运行 unit |

### onOpen() DOM 回归测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | onOpen() DOM 回归测试段 | 当前模式不运行 unit |

### V2.17-A smoke 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.17-A smoke 测试段 | 当前模式不运行 unit |

### Codex schema alignment 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Codex schema alignment 测试段 | 当前模式不运行 unit |

### V20.2 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V20.2 测试段 | 当前模式不运行 unit |

### V20.3 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V20.3 测试段 | 当前模式不运行 unit |

### V20.5 ActiveProvider

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 空 vault 返回默认 codex | expected codex, got codex |
| ✅ | save+load claude | expected claude, got claude |
| ✅ | active.json 不含地址/模型/Key | active.json 内容: {"schemaVersion":1,"activeProvider":"pi"} |

### Runtime router

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | active provider 驱动真实 session 选择并使缓存失效 | selects=true, invalidates=true |

### V20.5 SecretsStore

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | setCodexKey 后 hasKey=true | hasKey=true, keyStatus=session-only |
| ✅ | clearCodexKey 后 hasKey=false | hasKey=false |
| ✅ | setClaudeKey + setPiKey | claude.hasKey=true, pi.hasKey=true |

### V20.5 ConfigExists

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 空 vault 全部 false | codex=false, claude=false, pi=false |
| ✅ | codex/config.toml 存在 → true | codexConfigExists=true |
| ✅ | claude/settings.json 存在 → true | claudeConfigExists=true |
| ✅ | pi/settings.json 存在 → true | piConfigExists=true |

### V20.5 buildRuntimeEnv

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | codex 本地配置存在 → CODEX_HOME 设置 | CODEX_HOME=C:\Users\Ye_Luo\AppData\Local\Temp\v205-test-xgNf65\.llm-bridge\private\runtime\codex, hasKey=true |
| ✅ | codex 本地配置缺失 → CODEX_HOME 不设置 | CODEX_HOME=undefined, hasKey=true |
| ✅ | claude 本地配置存在 → CLAUDE_CONFIG_DIR 设置 | CLAUDE_CONFIG_DIR=C:\Users\Ye_Luo\AppData\Local\Temp\v205-test-s5ORy3\.llm-bridge\private\runtime\claude, hasKey=true |
| ✅ | pi 本地配置存在 → PI_CODING_AGENT_DIR 设置 | PI_CODING_AGENT_DIR=C:\Users\Ye_Luo\AppData\Local\Temp\v205-test-yzbAc9\.llm-bridge\private\runtime\pi, hasKey=true |
| ✅ | 无密钥 → env 不含 CODEX_RELAY_API_KEY | hasKey=false |

### V20.5 getRouterState

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 聚合状态正确（含 localConfigPath + globalConfigDir） | active=codex, codex.exists=true, codex.path=.llm-bridge/private/runtime/codex/config.toml, codex.hasKey=true |

### V20.5 Migrate

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 无旧配置 → migrated=false | migrated=false, reason=无 V20.4 配置文件，无需迁移 |
| ✅ | 有旧配置 → 迁移 active.json + 密钥 | migrated=true, activeExists=true, codex.hasKey=true |
| ✅ | 已有 active.json → 跳过 | migrated=false, reason=V20.5 配置已存在，跳过迁移 |
| ✅ | 迁移后不自动创建原生配置文件 | codex=false, claude=false, pi=false |

### V20.5 clearRouterCache

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 清除 session-only 缓存后密钥丢失 | hasKey=false (session-only cleared) |

### V20.6 getGlobalCodexConfigDir

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回非空路径 | dir=C:\Users\Ye_Luo\.codex |

### V20.6 getGlobalClaudeConfigDir

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回非空路径 | dir=C:\Users\Ye_Luo\.claude |

### V20.6 getGlobalPiConfigDir

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 返回非空路径 | dir=C:\Users\Ye_Luo\.pi |

### V20.7 Codex form

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | write→read 往返一致 | ok=true, baseURL=https://relay.example.com/v1, model=gpt-5.4, exists=true |

### V20.7 Claude form

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | write→read 往返一致 | ok=true, baseURL=https://relay.example.com, model=claude-sonnet-4-5, exists=true |

### V20.7 Pi form

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | write→read 往返一致 | ok=true, baseURL=https://relay.example.com/v1, model=gpt-5.4, exists=true |

### V20.7 readCodexForm

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 本地配置不存在 → localConfigExists=false | ok=true, form=false, exists=false |

### V20.7 readClaudeForm

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | JSON 错误 → 返回 error | ok=false, exists=true, error=Claude settings.json 解析失败：Expected property name o |

### V20.7 saveProviderForm Codex

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 生成配置 + 注入密钥 | ok=true, model=gpt-5.4, files=.llm-bridge/private/runtime/codex/config.toml, keyStatus=session-only |

### V20.7 saveProviderForm Claude

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 生成配置 + 注入密钥 | ok=true, model=claude-sonnet-4-5, files=.llm-bridge/private/runtime/claude/settings.json |

### V20.7 saveProviderForm Pi

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 生成 settings.json + models.json | ok=true, model=gpt-5.4, files=.llm-bridge/private/runtime/pi/settings.json,.llm-bridge/private/runtime/pi/models.json |

### V20.7 saveProviderForm

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 无 apiKey → keyStatus=undefined | ok=true, keyStatus=undefined |

### V20.7 writeCodexForm

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 生成 env_key 但不泄露 Key 值 | hasEnvKey=true, noKeyLeak=true |

### V20.7 writePiForm

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | apiKey 字段为环境变量名 | hasVarName=true, noKeyLeak=true |

### V20.8 readiness

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 本地配置缺失 → ok=true | ok=true, preSendBlock=false |
| ✅ | 本地配置+Key → ok=true | ok=true, reason=undefined |
| ✅ | 本地配置+缺Key → preSendBlock=true | ok=false, preSendBlock=true, reason=Codex 本地配置已创建但缺少 API Key。请在设置页「运行时配置」→ Codex →「API Key」中填写后点「保存并应用」。 |

### V20.8 getSecretStatus

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 按 Provider 精确计算（Codex有Key, Claude无Key） | codex=session-only, claude=not-configured |

### V20.8 集成

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 保存→生成配置→buildRuntimeEnv→readiness ok | save=true, configExists=true, CODEX_HOME=true, KEY=true, readiness=true |

### V20.8 RunSessionController

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 使用 runtimeRouter readiness | usesRouter=true |

### V20.8 settings.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 首次创建 Key 必填 + 无 Active Provider 下拉框 | firstCreate=true, noDropdown=true |

### V20.8 view.ts

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 不请求 /v1/models + 使用 readProviderForm | noV1=true, localForm=true |

### V20.8 明文回退

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | setSecret 返回 saved + 明文文件含警告头与 Key | status=saved, plainExists=true, hasHeader=true, hasKey=true |
| ✅ | clearSecretsCache 后 loadAllSecrets 仍可读取 + getSecretStatus=saved | value=test-key-123, status=saved |
| ✅ | 关闭后 setSecret 返回 session-only + 无明文文件 | status=session-only, plainExists=false |

## 失败项详情

无失败项。

## 需人工验证项

无。

---

*报告由 `scripts/run-tests.mjs` 自动生成*