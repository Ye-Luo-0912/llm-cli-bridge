# Manual Smoke — V1.6 Experimental Release

> V1.6.1 打包阶段整理。本文档列出需要在 Obsidian 中手工验证的 smoke 项。
> 标注 **manual required** 的项必须由人在 Obsidian 中实际操作确认，自动化测试无法覆盖。
> 所有项已在 `scripts/run-tests.mjs` 的 V1.6 单元测试段覆盖逻辑层；此处验证 UI 渲染与端到端流程。

## 元信息

| 字段 | 值 |
|---|---|
| 验证版本 | plugin 1.6.0（V1.6 SDK Workflow Event Prototype） |
| 验证时间 | 待人工验证后填写 |
| Vault | 测试专用 vault |
| 验证方式 | Obsidian 中手工操作 + 目视确认 |
| 自动化基线 | unit 171/0/22skip · process 62/0/30skip · claude 55/0/28skip · build 成功 |

## 前置准备

1. 解压 `release/llm-cli-bridge-1.6.0.zip` 到 `<vault>/.obsidian/plugins/llm-cli-bridge/`
2. 在 Obsidian 设置 → 第三方插件中启用「LLM CLI Bridge」
3. 打开右侧 Bridge 面板（命令面板 → 「LLM CLI Bridge: Open」）
4. 点击面板 Preflight 按钮，确认 claude 命令可用（Preflight 状态变绿）

## 验证项

### 1. auto + Claude 正常（CLI 主线不回归）— **manual required**

**目标**：确认 V1.6 改动未破坏 auto/CLI 默认行为。

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

**目标**：确认 mock 演示流程不受 V1.6 影响。

**步骤**：
1. 设置 → 开发者区域 → Backend 模式 = `mock-success`
2. 面板输入「测试」，发送

**预期**：
- 状态 → Done，exitCode=0
- 助手消息含 `[mock]` 输出
- 无 SDK Workflow 区域（mock backend 不产生 workflow 事件）

**结果**：☐ pass ☐ fail — 详情：__________

### 3. mock-failure 正常 — **manual required**

**目标**：确认失败流程与错误摘要不受 V1.6 影响。

**步骤**：
1. 设置 → 开发者区域 → Backend 模式 = `mock-failure`
2. 面板输入「测试」，发送

**预期**：
- 状态 → Failed，exitCode=1
- stderr 显示错误摘要 + Debug log 路径（可点击复制）
- 无 SDK Workflow 区域

**结果**：☐ pass ☐ fail — 详情：__________

### 4. sdk-experimental 显示 mock workflow timeline — **manual required**

**目标**：确认 sdk-experimental backend 在 SDK 不可用时 fallback 产出 mock workflow 事件并正确渲染。

**步骤**：
1. 设置 → 开发者区域 → Backend 模式 = `sdk-experimental`
2. 面板输入「帮我总结一下」，发送
3. 等待约 2 秒（mock workflow 事件序列在 50ms~1200ms 间产出）

**预期**：
- 状态 → Done，exitCode=0
- 助手消息含 `[sdk-mock]` 或 `[sdk]` stdout 输出
- 消息下方出现 **SDK Workflow** 区域，含：
  - **工具时间线**：Read（✓ done）、Write（✓ done）两条，各自显示 input/output 摘要
  - **非工具事件列表**：
    - 💬 Assistant: 「我来处理你的请求…」
    - 🔓 Permission granted: Write
    - 📄 Created file: `output/summary.md`
    - 💬 Assistant: 「已完成处理，生成了摘要文件。」
- 若 SDK 不可用，首条事件为 ℹ System: 「SDK 不可用，使用 mock workflow 演示」

**结果**：☐ pass ☐ fail — 详情：__________

### 5. sdk-experimental 事件已脱敏 — **manual required**

**目标**：确认 SDK workflow 事件中的敏感信息已被 redactSecrets 脱敏。

**步骤**：
1. 保持 `sdk-experimental` 模式
2. 面板输入「key=sk-ant-api03-test 请处理」，发送
3. 观察 SDK Workflow 区域中 message/tool_start/tool_result 事件文本

**预期**：
- 助手消息文本中 `sk-ant-api03-test` 若被引用，显示为 `sk-ant-api03-***`（mock workflow 不直接回显用户输入的 key，但脱敏函数已对所有事件生效）
- 不出现完整的 `sk-ant-...` key 字符串

**结果**：☐ pass ☐ fail — 详情：__________

### 6. SDK 不可用时不影响 CLI — **manual required**

**目标**：确认 sdk-experimental 模式失败/不可用时，切回 auto 模式 CLI 仍正常工作。

**步骤**：
1. 先在 `sdk-experimental` 模式运行一次（确认 mock workflow 显示）
2. 切换回 `auto` 模式
3. 面板输入「再次测试」，发送

**预期**：
- auto 模式正常调用 claude CLI，收到真实回复
- 状态 → Done
- 无 SDK Workflow 区域（证明 workflow 事件仅 sdk-experimental 产生，不污染 CLI）

**结果**：☐ pass ☐ fail — 详情：__________

### 7. sdk-experimental stop() 可中断 — **manual required**

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

- V1.6 sdk-experimental 当前使用 mock workflow（真实 Claude Agent SDK 映射为 TODO，待 SDK 安装后接入）
- 真实 SDK 不可用时，sdk-experimental 与 mock-success 行为类似，但额外产生结构化 workflow 事件
- SDK Workflow 区域仅 `sdk-experimental` backend 产生；`auto`/`mock-*` 不产生

## 自动化覆盖说明

以下逻辑层已由 `scripts/run-tests.mjs` V1.6 单元测试段覆盖（12 项全绿），手工验证聚焦 UI 渲染：

| 自动化测试项 | 覆盖点 |
|---|---|
| redactSecrets | sk-ant/sk-/Bearer/password/api_key 脱敏 |
| redactWorkflowEvent | 原事件不变 + tool_start/tool_result/error 字段脱敏 |
| workflowEventLabel/Class/isFatalError | 事件映射 |
| buildToolTimeline | tool_start/tool_result 配对，未配对保持 running |
| extractFileChanges | file_change 提取 |
| truncateText | 截断加省略号 |
| SdkBackend fallback | SDK 不可用时产出 AgentEvent v0.1 + mock workflow |
| SdkBackend 脱敏 | onWorkflowEvent 收到已脱敏事件 |
| SdkBackend stop() | 发出 stopped 事件，handle 不再 running |
| CLI 不回归 | ClaudeCliBackend 不产生 workflow 事件 |
| isSdkAvailable | 探测不抛异常 |
