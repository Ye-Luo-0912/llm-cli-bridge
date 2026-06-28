# Manual Smoke — V1.7 Experimental Release

> V1.7.1 打包阶段整理。本文档列出需要在 Obsidian 中手工验证的 smoke 项。
> 标注 **manual required** 的项必须由人在 Obsidian 中实际操作确认，自动化测试无法覆盖。
> 所有逻辑层已由 `scripts/run-tests.mjs` 的 V1.6 + V1.7 单元测试段覆盖；此处验证 UI 渲染与端到端流程。

## 元信息

| 字段 | 值 |
|---|---|
| 验证版本 | plugin 1.7.0（V1.7 Real SDK Workflow Enhancement） |
| 验证时间 | 待人工验证后填写 |
| Vault | 测试专用 vault |
| 验证方式 | Obsidian 中手工操作 + 目视确认 |
| 自动化基线 | unit 187/0/22skip · process 62/0/31skip · claude 55/0/29skip · build 成功 |

## 前置准备

1. 解压 `release/llm-cli-bridge-1.7.0-experimental.zip` 到 `<vault>/.obsidian/plugins/llm-cli-bridge/`
2. 在 Obsidian 设置 → 第三方插件中启用「LLM CLI Bridge」
3. 打开右侧 Bridge 面板（命令面板 → 「LLM CLI Bridge: Open」）
4. 点击面板 Preflight 按钮，确认 claude 命令可用（Preflight 状态变绿）

## 验证项

### 1. auto + Claude 正常（CLI 主线不回归）— **manual required**

**目标**：确认 V1.7 改动未破坏 auto/CLI 默认行为。

**步骤**：
1. 设置 → LLM CLI Bridge → 开发者区域 → Backend 模式 = `auto`
2. 面板输入框输入「你好，简短回复」
3. 点发送（或 Ctrl+Enter）

**预期**：
- 状态点由 Idle → Running → Done
- 助手消息显示 claude 回复内容
- 消息下方无 SDK Workflow 区域（CLI backend 不产生 workflow 事件）
- 运行过程时间线正常显示（started / stdout / completed）

**结果**：☐ pass ☐ fail — 详情：__________

### 2. mock-success 正常 — **manual required**

**目标**：确认 mock 演示流程不受 V1.7 影响。

**步骤**：
1. 设置 → 开发者区域 → Backend 模式 = `mock-success`
2. 面板输入「测试」，发送

**预期**：
- 状态 → Done，exitCode=0
- 助手消息含 `[mock]` 输出
- 无 SDK Workflow 区域（mock backend 不产生 workflow 事件）

**结果**：☐ pass ☐ fail — 详情：__________

### 3. mock-failure 正常 — **manual required**

**目标**：确认失败流程与错误摘要不受 V1.7 影响。

**步骤**：
1. 设置 → 开发者区域 → Backend 模式 = `mock-failure`
2. 面板输入「测试」，发送

**预期**：
- 状态 → Failed，exitCode=1
- stderr 显示错误摘要 + Debug log 路径（可点击复制）
- 无 SDK Workflow 区域

**结果**：☐ pass ☐ fail — 详情：__________

### 4. sdk-experimental 显示 fallback workflow timeline — **manual required**

**目标**：确认 sdk-experimental backend 在真实 SDK 不可用时 fallback 产出 mock workflow 事件并正确渲染。本机未安装 `@anthropic-ai/claude-agent-sdk` / `@anthropic-ai/claude-code`，预期走 fallback 路径。

**步骤**：
1. 设置 → 开发者区域 → Backend 模式 = `sdk-experimental`
2. 面板输入「帮我总结一下」，发送
3. 等待约 2 秒（mock workflow 事件序列在 50ms~1200ms 间产出）

**预期**：
- 状态 → Done，exitCode=0
- 助手消息含 `[sdk-mock]` 或 `[sdk]` stdout 输出
- 消息下方出现 **SDK Workflow** 区域，含：
  - 首条事件：ℹ System: 「SDK 不可用，使用 mock workflow 演示」（fallback 标记）
  - **工具时间线**：Read（✓ done）、Write（✓ done）两条，各自显示 input/output 摘要
  - **非工具事件列表**：
    - 💬 Assistant: 「我来处理你的请求…」
    - 🔓 Permission granted: Write
    - 📄 Created file: `output/summary.md`
    - 💬 Assistant: 「已完成处理，生成了摘要文件。」

**结果**：☐ pass ☐ fail — 详情：__________

### 5. SDK Workflow 区域覆盖所有事件类型 — **manual required**

**目标**：确认 SDK Workflow 区域能显示 V1.7 映射的全部 6 种 WorkflowEvent 类型（message / tool_start / tool_result / file_change / permission / error）。fallback mock workflow 已覆盖前 5 种；error 类型需触发 mock-failure 路径或真实 SDK 错误。

**步骤**：
1. 保持 `sdk-experimental` 模式
2. 面板输入「测试事件类型」，发送，观察事件列表
3. （可选）若要观察 error 事件，可在无网络/SDK 异常时触发

**预期（fallback 路径）**：
- ✅ message（assistant + system 两种 role）
- ✅ tool_start（Read、Write）
- ✅ tool_result（Read ✓、Write ✓）
- ✅ file_change（Created file: `output/summary.md`）
- ✅ permission（Permission granted: Write）
- ⚠️ error（fallback 路径不产生；需真实 SDK 错误或 mock-failure workflow 触发，标记为可选）

**结果**：☐ pass ☐ fail — 详情：__________

### 6. sdk-experimental 事件已脱敏 — **manual required**

**目标**：确认 SDK workflow 事件中的敏感信息已被 `redactSecrets` / `redactWorkflowEvent` 脱敏。

**步骤**：
1. 保持 `sdk-experimental` 模式
2. 面板输入「key=sk-ant-api03-test 请处理」，发送
3. 观察 SDK Workflow 区域中 message/tool_start/tool_result 事件文本

**预期**：
- 助手消息文本中若引用用户输入的 key，显示为 `sk-ant-api03-***`
- 不出现完整的 `sk-ant-...` key 字符串
- 不出现 `Bearer <长串>` / `password=<长串>` 等敏感模式

**结果**：☐ pass ☐ fail — 详情：__________

### 7. SDK diagnostics 可观察（控制台）— **manual required**

**目标**：确认 SdkBackend 运行后 `lastDiagnostics` 记录了可用性/包名/版本/事件数/fallback 原因，且日志不含 secret。

**步骤**：
1. 保持 `sdk-experimental` 模式
2. 打开 Obsidian 开发者控制台（Ctrl+Shift+I）
3. 面板输入「测试诊断」，发送
4. 在控制台查找 `[sdk-experimental]` 开头的日志行

**预期（fallback 路径）**：
- 控制台输出类似：`[sdk-experimental] available=false package=null version=null model=null permissionMode=default messages=0 workflowEvents=0 partial=0 fallbackReason=SDK package not found (@anthropic-ai/claude-agent-sdk / @anthropic-ai/claude-code)`
- 日志不含 token / API key / .env / 本机绝对路径
- `available=false` + `fallbackReason` 非空

**结果**：☐ pass ☐ fail — 详情：__________

### 8. 切回 auto 后 CLI 不回归 — **manual required**

**目标**：确认 sdk-experimental 模式 fallback/不可用时，切回 auto 模式 CLI 仍正常工作。

**步骤**：
1. 先在 `sdk-experimental` 模式运行一次（确认 fallback workflow 显示）
2. 切换回 `auto` 模式
3. 面板输入「再次测试」，发送

**预期**：
- auto 模式正常调用 claude CLI，收到真实回复
- 状态 → Done
- 无 SDK Workflow 区域（证明 workflow 事件仅 sdk-experimental 产生，不污染 CLI）

**结果**：☐ pass ☐ fail — 详情：__________

### 9. sdk-experimental stop() 可中断 — **manual required**

**目标**：确认 sdk-experimental 运行中可被停止。

**步骤**：
1. 切换到 `sdk-experimental` 模式
2. 面板输入「测试」，发送后立即点停止按钮（■）

**预期**：
- 状态 → Stopped
- 助手消息标记为 stopped
- 停止按钮消失，发送按钮恢复

**结果**：☐ pass ☐ fail — 详情：__________

## 已知限制

- V1.7 sdk-experimental 在本机无真实 SDK 时走 fallback mock workflow 路径（与 V1.6 行为一致）
- 真实 SDK 路径（`@anthropic-ai/claude-agent-sdk` / `@anthropic-ai/claude-code`）的端到端验证需安装 SDK 并配置 API key，本次 release 未覆盖
- `stream_event`（partial）映射已实现，但 `buildSdkOptions` 设 `includePartialMessages: false`，故默认不接收 partial 消息；未来开启时可观察 `partial=true` 标记
- SDK Workflow 区域仅 `sdk-experimental` backend 产生；`auto`/`mock-*` 不产生

## 自动化覆盖说明

以下逻辑层已由 `scripts/run-tests.mjs` V1.7 单元测试段覆盖（16 项全绿），手工验证聚焦 UI 渲染与端到端流程：

| 自动化测试项 | 覆盖点 |
|---|---|
| mapSdkMessageToWorkflowEvents (assistant) | text→message, tool_use→tool_start+file_change 映射 |
| mapSdkMessageToWorkflowEvents (user) | tool_result 映射（含 is_error 标记） |
| mapSdkMessageToWorkflowEvents (system) | init→message(system), permission_denied→permission(denied) |
| mapSdkMessageToWorkflowEvents (result) | success→terminal=completed, error→terminal=failed |
| mapSdkMessageToWorkflowEvents (stream_event) | 标记 partial=true，不产出事件 |
| mapSdkMessageToWorkflowEvents (未知类型) | 忽略，不产出事件 |
| detectFileChangeFromToolUse | Write/Edit/MultiEdit 产生 fc，Read/Bash/无路径 返回 null |
| serializeToolInput / serializeToolResultContent | 截断 + 数组拼接 |
| mapSdkMessageToWorkflowEvents 保留原文 | 映射层不脱敏，由 redactWorkflowEvent 负责 |
| createInitialDiagnostics / updateDiagnostics | 初始值 + 不可变更新 |
| formatDiagnosticsForLog | 字段完整 + fallback 原因 |
| SdkBackend fallback lastDiagnostics | available=false + fallbackReason |
| SdkBackend 脱敏 | onWorkflowEvent 事件已脱敏（含 sk-ant key 场景） |
| SdkBackend stop() | 发出 stopped 事件，handle 不再 running |
| CLI 不回归 (V1.7) | ClaudeCliBackend 不产生 workflow 事件 |
| isSdkAvailable (V1.7) | 探测不抛异常 |

V1.6 单元测试段（12 项）继续覆盖 WorkflowEvent 基础模型与 SdkBackend V1.6 行为。
