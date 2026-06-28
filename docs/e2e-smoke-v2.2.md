# V2.2 Core Flow End-to-End Smoke 报告

> 目标：验证插件主流程在真实 Vault 中完整可用，不再扩展 Skills 或 SDK 能力。

## 测试环境

| 项目 | 值 |
|---|---|
| 测试时间 | 2026-06-28 |
| 插件版本 | 2.2.0 |
| Node | v24.14.0 |
| Platform | win32 |
| Claude CLI | 2.1.195 (Claude Code) |
| main.js | 203.7 KB |
| bridge.json | exists |
| HTTP port | 59763 |

---

## 1. 约束确认（自动化代码审查）

| 约束 | 状态 | 证据 |
|---|---|---|
| 不改 AgentEvent v0.1 | ✅ 通过 | `src/agentBackend.ts:31-32` 注释"已冻结"，6 种事件（started/stdout_delta/stderr_delta/completed/failed/stopped），无 tool event |
| 不新增 tool event | ✅ 通过 | AgentEvent 联合类型未扩展，WorkflowEvent 为 UI-only 不混入 AgentEvent |
| CLI/auto 主线稳定 | ✅ 通过 | `test:process` 62 passed, 0 failed；`test:claude` Claude Smoke 真实执行成功 |
| sdk-experimental 默认关闭 | ✅ 通过 | `src/types.ts:98` `backendMode: "auto"` |
| 不新增业务模板 | ✅ 通过 | V2.2 不修改 Skills 系统，无新增 skill 模板 |
| 不绑定固定输出目录 | ✅ 通过 | `src/prompt.ts:21` 三级优先级：AGENTS.md > settings.outputDir > 用户明确指定 |

---

## 2. 自动化测试结果

### build
- `npm run build` — ✅ 通过（tsc -noEmit -skipLibCheck + esbuild production）

### test:unit
- 结果：**237 passed, 0 failed, 22 skipped, 0 manual required**
- 覆盖：
  - 路径安全 / ACTION_SCHEMAS / validateAction
  - Prompt Package（includeActiveNote/includeSelection/outputDir 配置驱动）
  - 文件系统主通道（snapshot/diff/排除目录）
  - AgentBackend contract / MockAgentBackend
  - UI 事件→状态映射
  - AgentProfile / File Diff / Bridge Metadata Sync
  - Preset Prompts / Preflight Status / ErrorSummary 脱敏
  - Command Profile / Workflow Trace（V1.5）
  - SDK Workflow Event（V1.6）/ Real SDK Enhancement（V1.7）
  - Real User Flow Consolidation（V1.8）
  - SDK Workflow Deepening / Agent State / Session / Skills（V2.0）
  - Skills Pack（V2.1）：5 skill 解析 / filterEnabledSkills / expandSkillPrompt / redactSkillForLog / seedDefaultSkills / loadSkills fallback / CLI 不回归

### test:process
- 结果：**62 passed, 0 failed, 35 skipped, 0 manual required**
- 覆盖：
  - Process: 启动/stdout/stderr/exit 0/exit 1/stop()/cwd 带空格/large-output
  - Preflight: cwd 不存在/command 不存在/version 成功/command 为空/debug log 无 secret/claude 真实探测 available=true
  - Process File Diff: fixture write-file completed + diff 检测新文件

### test:claude
- 结果：**55 passed, 0 failed, 33 skipped, 0 manual required**
- 覆盖：
  - Claude Smoke: claude 可用性 version 2.1.195 / started 先发出 / stdout_delta / completed exitCode 0 / stdout 含 OK
  - Claude Note Summarize: claude 可用性 / prompt 含标记词 / started / completed exitCode 0 / stdout 含标记词 / stdout 提到总结/关键

---

## 3. 手工端到端 Smoke 验证清单（manual required）

> 以下项目需要在 Obsidian 真实 Vault 中手工执行，无法自动化。请在 Obsidian 中加载插件后逐项验证并填写结果。

### 3.1 核心用户流（manual required）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 1 | 自由提问 | 打开 Bridge View → 输入框输入任意问题 → Ctrl+Enter 发送 | 消息出现在对话区，状态点变 Running，收到 Claude 回复后变 Done | ☐ 待验证 |
| 2 | 解释选区 | 在编辑器选中一段文本 → Bridge View 显示 Selection chip 字符数 → 点击「解释选区」preset → 发送 | prompt 含选中文本，Claude 返回解释 | ☐ 待验证 |
| 3 | 总结当前笔记 | 打开一篇笔记 → Bridge View 显示 Note chip 文件名 → 点击「总结当前笔记」preset → 发送 | prompt 含笔记内容，Claude 返回总结，生成 -summary 文件可点击 | ☐ 待验证 |
| 4 | 应用 Skill 后运行 | 点击 Skills 面板中某个 skill（如「改写润色」）→ prompt 注入输入框 → 编辑后发送 | prompt 含 skill 指令 + {{outputDir}} 已替换为实际目录，Claude 按指令执行 | ☐ 待验证 |
| 5 | 运行过程可见 | 运行任一任务时观察 Workflow 区 / Run Flow 区 | 显示 started → stdout → 终态时间线，状态点正确翻转 | ☐ 待验证 |
| 6 | 文件列表可点击 | 运行结束后观察生成文件列表 | 显示新增/修改的 Markdown 文件，点击可在 Obsidian 中打开 | ☐ 待验证 |

### 3.2 Skills 验证（manual required）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 7 | Skills 读取 | 首次打开 Bridge View 或点击 seed 按钮 | `.llm-bridge/skills.md` 生成，含 5 个默认 skill，Skills 面板显示 5/5 | ☐ 待验证 |
| 8 | Skills 选择 | 点击某个 skill 的主按钮 | prompt 注入输入框，含 skill 指令，{{outputDir}} 已替换 | ☐ 待验证 |
| 9 | Skills 禁用 | 取消某个 skill 的 checkbox | Skills 面板标题计数更新（如 4/5），该 skill 不再显示在启用列表 | ☐ 待验证 |
| 10 | prompt 注入 | 选择 skill 后查看输入框 | 输入框含 skill prompt，{{outputDir}} 已替换为 settings.outputDir 实际值 | ☐ 待验证 |
| 11 | 缺失目录 fallback | 删除 `.llm-bridge/skills.md` → 刷新 Bridge View | Skills 面板显示空状态 + 「初始化默认 Skills」按钮，不报错 | ☐ 待验证 |

### 3.3 Workflow 验证（manual required）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 12 | 状态显示 | 运行任务时观察状态点 + 状态文字 | idle→Running→Done/Failed/Stopped 正确翻转 | ☐ 待验证 |
| 13 | 步骤显示 | 运行任务时观察 Run Flow 区 | 显示 preflight→build→spawn→stdout→diff→终态 6 步流程 | ☐ 待验证 |
| 14 | 错误摘要 | 触发失败（如断网或错误命令） | 错误摘要脱敏（无 token/key 明文），含 exit code | ☐ 待验证 |
| 15 | debug log 路径 | 失败后查看错误区 | 显示 debug log 路径，可点击复制 | ☐ 待验证 |

### 3.4 切换验证（manual required）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 16 | mock-success | 设置 backend=mock-success → 发送消息 | 显示 completed，无错误，stdout 显示模拟成功输出 | ☐ 待验证 |
| 17 | mock-failure | 设置 backend=mock-failure → 发送消息 | 显示 failed，错误摘要脱敏，debug log 路径可点击复制 | ☐ 待验证 |
| 18 | auto + Claude | 设置 backend=auto → 发送短消息 | 收到 Claude 真实回复，状态 completed，无 SDK Workflow 区 | ☐ 待验证 |
| 19 | sdk-experimental | 设置 backend=sdk-experimental → 发送消息 | 显示 SDK Workflow 区（fallback mock 事件），含 message/tool_start/tool_result/file_change/permission/error | ☐ 待验证 |
| 20 | 切回 auto 不回归 | 从 sdk-experimental 切回 auto → 发送消息 | CLI 正常工作，无 SDK Workflow 区，无残留状态 | ☐ 待验证 |

---

## 4. 输出目录规则验证

| 规则 | 验证方式 | 状态 |
|---|---|---|
| AGENTS.md 优先 | 代码审查 `src/prompt.ts:21` | ✅ 通过 |
| settings.outputDir 参考 | 代码审查 + 单元测试（Prompt Package: 输出规则配置驱动） | ✅ 通过 |
| 用户明确指定时以用户为准 | 代码审查 `src/prompt.ts:21` | ✅ 通过 |
| outputDir 为空时项目规则驱动 | 单元测试（Prompt Package: outputDir 为空时项目规则驱动） | ✅ 通过 |
| {{outputDir}} 占位符替换 | 单元测试（V2.1 expandSkillPrompt） | ✅ 通过 |

---

## 5. 敏感信息扫描

| 扫描项 | 状态 |
|---|---|
| 本报告无 token/key/env/logs 明文 | ✅ 通过 |
| 本报告无本机绝对路径 | ✅ 通过 |
| 自动化测试 debug log 不含 secret | ✅ 通过（test:process 验证） |
| redactSkillForLog 脱敏 sk-ant-api03 | ✅ 通过（test:unit V2.1 验证） |

---

## 6. 结论

### 自动化部分（已通过）
- 约束确认：6/6 通过
- build：通过
- test:unit：237 passed, 0 failed
- test:process：62 passed, 0 failed
- test:claude：55 passed, 0 failed
- 输出目录规则：5/5 通过
- 敏感信息扫描：4/4 通过

### 手工部分（manual required）
- 核心用户流：6 项待验证
- Skills 验证：5 项待验证
- Workflow 验证：4 项待验证
- 切换验证：5 项待验证
- **合计：20 项 manual required，需在 Obsidian 真实 Vault 中手工执行**

### 验收标准
> 真实 Vault 中完成"选择上下文 → 选择 Skill → 运行 agent → 查看过程 → 打开结果文件"的完整闭环。

**自动化部分已验证插件主流程稳定，手工部分需用户在 Obsidian 中完成端到端闭环验证。**
