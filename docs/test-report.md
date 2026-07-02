# LLM CLI Bridge 测试报告 — 进程测试（process）

- **测试时间**: 2026-07-02T14:53:47.817Z
- **测试环境**: linux / Node.js v24.15.0
- **插件版本**: 2.16.0
- **main.js 大小**: 574.6 KB
- **Vault 路径**: `/Obsidian/LLM-Wiki`
- **bridge.json 存在**: 否
- **HTTP 端口**: N/A

## 测试汇总

- ✅ **通过**: 86
- ❌ **失败**: 1
- ⏭️ **跳过**: 59
- ⚪ **需人工验证**: 0
- **总计**: 146

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

### 文件快照

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | 生成运行前快照 | 文件数: 0（空 vault，快照机制由 diff 测试验证） |

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
| ❌ | 接收多段 stdout_delta | delta 数量=1, combined="Hello from fixture
"; debug logs: /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-186Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-194Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-389Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-503Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-546Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-711Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-712Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-873Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-57-043Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-57-348Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-58-100Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-210Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-372Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-533Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-692Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-856Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-22-161Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-22-747Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-56-868Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-56-875Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-57-179Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-57-390Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-051Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-313Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-479Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-642Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-810Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-22-114Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-22-713Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-350Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-509Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-674Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-844Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-32-012Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-32-317Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-32-938Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-068Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-261Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-584Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-764Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-943Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-47-249Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-47-888Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-17-450Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-17-458Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-17-830Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-18-045Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-40-765Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-096Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-259Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-436Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-592Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-897Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-42-540Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-38-699Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-38-708Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-39-012Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-39-225Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-55-975Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-145Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-304Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-474Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-644Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-949Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-57-548Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-08-642Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-08-820Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-004Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-198Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-391Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-698Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-10-348Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-158Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-338Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-502Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-669Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-839Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-24-146Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-24-765Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-32-615Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-32-797Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-32-989Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-33-170Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-33-360Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-33-666Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-34-339Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-343Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-520Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-701Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-879Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-51-058Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-51-368Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-52-017Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-53-611Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-53-796Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-127Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-302Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-483Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-789Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-55-483Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-066Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-249Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-425Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-624Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-797Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-58-103Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-58-737Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-227Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-393Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-559Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-728Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-896Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-09-202Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-09-833Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-468Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-648Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-831Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-998Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-20-175Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-20-481Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-21-309Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-139Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-148Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-453Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-666Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-237Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-513Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-687Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-850Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-23-020Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-23-325Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-23-932Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-34-998Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-178Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-346Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-525Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-698Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-36-004Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-36-601Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-314Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-476Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-638Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-798Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-39-110Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-39-416Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-40-049Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-41-828Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-014Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-205Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-391Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-571Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-877Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-43-564Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-400Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-595Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-775Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-965Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-46-317Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-46-623Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-47-323Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-180Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-368Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-547Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-727Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-921Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-50-227Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-51-115Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-228Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-417Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-597Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-759Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-947Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-00-253Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-00-924Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-02-675Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-02-877Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-064Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-253Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-435Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-741Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-04-369Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-256Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-436Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-605Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-775Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-945Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-07-250Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-07-897Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-09-706Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-09-897Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-076Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-243Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-411Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-716Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-11-313Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-252Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-457Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-653Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-823Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-997Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-14-303Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-14-948Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-30-620Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-30-807Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-30-990Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-31-161Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-31-331Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-31-647Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-32-312Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-370Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-536Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-691Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-860Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-46-020Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-46-326Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-46-931Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-48-631Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-48-794Z.log |
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
| ⏭️ | cwd 不存在 → failed diagnostic | 环境假失败: 非 Windows 平台 `Z:\...` 不被当作不存在的盘符路径 |
| ✅ | command 不存在 → unavailable | - |
| ✅ | version 成功 → available | - |
| ✅ | command 为空 → unavailable | - |
| ✅ | debug log 不含 secret | - |
| ✅ | 路径带空格可运行 | - |
| ⏭️ | claude 真实命令探测 | claude 未安装或不可用 (exitCode=127) |
| ⏭️ | codex 真实命令探测 | codex 未安装或不可用 (exitCode=127) |

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

### V2.17-A smoke 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | V2.17-A smoke 测试段 | 当前模式不运行 unit |

### Codex schema alignment 测试段

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ⏭️ | Codex schema alignment 测试段 | 当前模式不运行 unit |

## 失败项详情

- **Process: 接收多段 stdout_delta**: delta 数量=1, combined="Hello from fixture
"; debug logs: /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-186Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-194Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-389Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-503Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-546Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-711Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-712Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-56-873Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-57-043Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-57-348Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-30-58-100Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-210Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-372Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-533Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-692Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-21-856Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-22-161Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-31-22-747Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-56-868Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-56-875Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-57-179Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-45-57-390Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-051Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-313Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-479Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-642Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-21-810Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-22-114Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-22-713Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-350Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-509Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-674Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-31-844Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-32-012Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-32-317Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-32-938Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-068Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-261Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-584Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-764Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-46-943Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-47-249Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-46-47-888Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-17-450Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-17-458Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-17-830Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-18-045Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-40-765Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-096Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-259Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-436Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-592Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-41-897Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-48-42-540Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-38-699Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-38-708Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-39-012Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-39-225Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-55-975Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-145Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-304Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-474Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-644Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-56-949Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-49-57-548Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-08-642Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-08-820Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-004Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-198Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-391Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-09-698Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-10-348Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-158Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-338Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-502Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-669Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-23-839Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-24-146Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-24-765Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-32-615Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-32-797Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-32-989Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-33-170Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-33-360Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-33-666Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-34-339Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-343Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-520Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-701Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-50-879Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-51-058Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-51-368Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-52-017Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-53-611Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-53-796Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-127Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-302Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-483Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-54-789Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-55-483Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-066Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-249Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-425Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-624Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-57-797Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-58-103Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-50-58-737Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-227Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-393Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-559Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-728Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-08-896Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-09-202Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-09-833Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-468Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-648Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-831Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-19-998Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-20-175Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-20-481Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-21-309Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-139Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-148Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-453Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-51-59-666Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-237Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-513Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-687Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-22-850Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-23-020Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-23-325Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-23-932Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-34-998Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-178Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-346Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-525Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-35-698Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-36-004Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-36-601Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-314Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-476Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-638Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-38-798Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-39-110Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-39-416Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-40-049Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-41-828Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-014Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-205Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-391Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-571Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-42-877Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-43-564Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-400Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-595Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-775Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-45-965Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-46-317Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-46-623Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-47-323Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-180Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-368Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-547Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-727Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-49-921Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-50-227Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-51-115Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-228Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-417Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-597Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-759Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-52-59-947Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-00-253Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-00-924Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-02-675Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-02-877Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-064Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-253Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-435Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-03-741Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-04-369Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-256Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-436Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-605Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-775Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-06-945Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-07-250Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-07-897Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-09-706Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-09-897Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-076Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-243Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-411Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-10-716Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-11-313Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-252Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-457Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-653Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-823Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-13-997Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-14-303Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-14-948Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-30-620Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-30-807Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-30-990Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-31-161Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-31-331Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-31-647Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-32-312Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-370Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-536Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-691Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-45-860Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-46-020Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-46-326Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-46-931Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-48-631Z.log; /Obsidian/LLM-Wiki/.llm-bridge/logs/debug-2026-07-02T14-53-48-794Z.log

## 需人工验证项

无。

---

*报告由 `scripts/run-tests.mjs` 自动生成*