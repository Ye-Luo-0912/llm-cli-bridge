# LLM CLI Bridge 测试报告

- **测试时间**: 2026-06-28T11:02:23.819Z
- **测试环境**: win32 / Node.js v24.14.0
- **插件版本**: 1.8.0
- **main.js 大小**: 183.0 KB
- **Vault 路径**: `D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki`
- **bridge.json 存在**: 是
- **HTTP 端口**: 59763

## 测试汇总

- ✅ **通过**: 55
- ❌ **失败**: 0
- ⏭️ **跳过**: 30
- ⚪ **需人工验证**: 0
- **总计**: 85

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

### Process 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Process 测试段 | 当前为 unit/integration 模式，跳过 process 测试 |

### Claude Smoke

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claude 可用性 | version: 2.1.195 (Claude Code) |
| ✅ | started 先发出 | - |
| ✅ | 接收 stdout_delta | - |
| ✅ | completed exitCode 0 | - |
| ✅ | stdout 含 OK | - |

### Claude Note Summarize

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | claude 可用性 | version: 2.1.195 (Claude Code) |
| ✅ | prompt 包含标记词 | - |
| ✅ | started 先发出 | - |
| ✅ | completed exitCode 0 | - |
| ✅ | stdout 包含标记词 | - |
| ✅ | stdout 提到总结/关键 | - |

## 失败项详情

无失败项。

## 需人工验证项

无。

---

*报告由 `scripts/run-tests.mjs` 自动生成*