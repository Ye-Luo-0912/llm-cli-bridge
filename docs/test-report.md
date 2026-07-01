# LLM CLI Bridge 测试报告

- **测试时间**: 2026-07-01T15:55:43.994Z
- **测试环境**: win32 / Node.js v22.22.2
- **插件版本**: 2.16.0
- **main.js 大小**: 442.9 KB
- **Vault 路径**: `D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki`
- **bridge.json 存在**: 是
- **HTTP 端口**: 60586

## 测试汇总

- ✅ **通过**: 87
- ❌ **失败**: 0
- ⏭️ **跳过**: 53
- ⚪ **需人工验证**: 0
- **总计**: 140

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
| ✅ | 生成运行前快照 | 文件数: 30 |

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
| ✅ | claude 真实命令探测 | available=true, stdout="2.1.196 (Claude Code)
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
| ✅ | exact/unavailable/estimated 状态区分 | - |

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

### V2.16-D timeline

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 用户态过滤 raw/internal 节点 | - |

### V2.16-D completed UI

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | 结果后折叠过程且不重复答案 | - |

## 失败项详情

无失败项。

## 需人工验证项

无。

---

*报告由 `scripts/run-tests.mjs` 自动生成*