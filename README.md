# LLM CLI Bridge

将 Obsidian 桥接到本地 Claude Code / Codex CLI agent，仅在桌面端运行。

不引入 SDK / Codex / ACP / MCP，通过 `child_process.spawn` 直接调用本地 CLI，用 stdin 传递 prompt。

---

## 安装方式

### 方式一：手动部署到 Vault

1. 运行 `npm install` 安装依赖。
2. 运行 `npm run build` 生成 `main.js`。
3. 将以下三个文件复制到 Vault 的插件目录：
   ```
   <Vault>/.obsidian/plugins/llm-cli-bridge/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```
4. 在 Obsidian 设置 → 第三方插件中启用「LLM CLI Bridge」。

### 方式二：开发热重载

```bash
npm install
npm run dev   # esbuild watch 模式
```

同时把 `main.js` / `manifest.json` / `styles.css` 软链或复制到 Vault 插件目录，即可在 Obsidian 内 reload 插件查看改动。

---

## 设置说明

在 Obsidian 设置 → 第三方插件 → LLM CLI Bridge 中配置：

| 设置项 | 说明 | 默认值 |
|---|---|---|
| Agent Type | agent 类型：`claude` / `codex` / `custom` | `claude` |
| Backend Mode | 后端模式：`auto` / `mock-success` / `mock-failure` | `auto` |
| Claude Command | claude 命令 | `claude` |
| Claude Args | claude 参数 | `-p` |
| Codex Command | codex 命令 | `codex` |
| Codex Args | codex 参数 | `exec -` |
| Custom Command / Args | 自定义 agent 命令与参数 | 空 |
| Include Active Note | 是否把当前活动笔记内容注入 prompt | 关 |
| Include Selection | 是否把当前选区注入 prompt | 开 |
| Max Active Note Chars | 活动笔记最大注入字符数 | 6000 |
| Max Selection Chars | 选区最大注入字符数 | 3000 |
| Output Dir | 生成笔记的推荐输出目录（配置驱动，非强制） | `90_AI整理待确认` |
| Model | 模型标识（注入 `ANTHROPIC_MODEL`） | `gpt-5.5` |
| Effort Level | 思考强度（注入 `CLAUDE_CODE_EFFORT_LEVEL`） | `high` |
| Show Stderr | 是否在消息中显示 stderr | 开 |
| Save Logs | 是否保存运行日志 | 开 |
| Dev Test Mode | 启用 `/dev/approve` / `/dev/reject` 测试端点 | 关 |

> `settings.json` 中不含 `ANTHROPIC_MODEL` / `CLAUDE_CODE_EFFORT_LEVEL`，由 UI 控制注入。

---

## Backend Mode（mock-success / mock-failure / auto）

| 模式 | 行为 | 用途 |
|---|---|---|
| `auto` | 默认生产行为，使用 `ClaudeCliBackend` 真实调用 CLI | 日常使用 |
| `mock-success` | 使用 `MockAgentBackend(success)`，不发真实命令，模拟成功响应 | 开发 / 离线验证 UI 流程 |
| `mock-failure` | 使用 `MockAgentBackend(failure)`，模拟失败响应 | 验证失败态 UI |

mock 模式不产生文件结果，不要求真实 CLI 可用。

---

## Agent Profile（claude / codex / custom）

`resolveProfile(settings)` 根据 `agentType` 解析出 `CommandProfile`：

- **claude**：使用 `claudeCommand` + `claudeArgs`，默认 `claude -p`。
- **codex**：使用 `codexCommand` + `codexArgs`，默认 `codex exec -`。
- **custom**：使用 `customCommand` + `customArgs`，命令会 trim，参数按空白拆分。

Prompt 通过 stdin 传递（避免命令行长度限制），cwd 设置为当前 Vault 根目录。Windows 下使用 `shell: true` 兼容 `.cmd` / `.ps1` 垫片和带空格路径。

### PATH 增强

`buildEnhancedPath` 按以下优先级构造 PATH，保证 Vault 移动到其他环境仍能定位 CLI：

1. Vault 局部 `LLM-AgentRuntime/node_modules/.bin`
2. fnm / nvm / Volta / asdf / Homebrew / npm global 等版本管理器路径（通过 `FNM_DIR` / `NVM_HOME` / `NVM_DIR` / `NVS_HOME` 等环境变量解析）
3. 系统 PATH

---

## Preflight 预检

`runPreflight(settings, cwd)` 在真实调用前执行预检：

- 检查 cwd 是否存在。
- 执行 `<command> --version` 探测命令可用性（不发送真实 prompt，不消耗 API）。
- 10s 超时保护。
- 返回 `PreflightResult`：`available` / `commandFound` / `versionStdout` / 诊断摘要。

失败时提供用户可读诊断，并列出扫描过的 PATH 目录，建议修复方式。

### Debug Log 位置

详细诊断日志写入 Vault 下（不污染 stdout，不含 secret）：

| 日志 | 路径 | 内容 |
|---|---|---|
| Preflight 诊断 | `.llm-bridge/logs/preflight-<timestamp>.log` | env key 存在性、命令探测、exit code |
| 运行诊断 | `.llm-bridge/logs/debug-<timestamp>.log` | 命令路径、cwd、env key、进程起止、stderr 摘要 |
| Action 审计 | `.llm-bridge/logs/actions.jsonl` | 所有 action 状态变更 |
| Dev 操作审计 | `.llm-bridge/logs/dev-ops.jsonl` | `/dev/approve` / `/dev/reject` 操作（仅 devTestMode） |

> 日志只记录 env key 名（存在性），不记录 value，不泄露 secret。

---

## 命令

| 命令 | 说明 |
|---|---|
| Open LLM CLI Bridge panel | 打开 Bridge 面板 |
| Ask Claude about selection | 预填选区作为上下文（不自动发送） |
| Rewrite selection with Claude | 预填重写指令并自动发送，要求用 `replace_selection` 回写 |
| Summarize active note to pending note | 自动总结当前笔记到 `outputDir/` |
| Create pending note from selection | 基于选区创建待确认笔记到 `outputDir/` |
| Open last generated note | 打开 `outputDir/` 下最近修改的 .md（不调用 LLM） |

---

## 文件检测（V0.9）

真实 backend run 前后扫描 Vault，检测新增 / 修改的 `.md` 文件，运行结束后在 UI 显示为可点击列表。

排除目录（大小写不敏感）：`.obsidian` / `.llm-bridge` / `node_modules` / `.git` / `LLM-AgentRuntime` / `dist` / `build`。

不绑定任何固定输出目录。

---

## 测试

```bash
npm run test:unit      # 纯单元测试
npm run test:process   # 本地子进程 fixture + preflight
npm run test:claude    # 真实 claude smoke（缺 claude 时自动 skip）
npm test               # 全量
```

测试报告输出到 `docs/test-report.md`，含测试时间、环境、插件版本、bridge 状态及每项结果。需要手工验证的项标记为「manual required」。

---

## 开发约定

- `child_process.spawn` + `shell: true`，cwd = Vault 根目录。
- Prompt 经 stdin 传递。
- HTTP 请求 30s 超时。
- 修改类 action（create_note / append_to_note / insert_at_cursor / replace_selection）需两阶段确认。
- AgentEvent v0.1 contract 已冻结，不新增 tool event。
- UI 使用 Obsidian CSS 变量，无框架依赖。

---

## 普通用户使用流程

本章节面向日常使用，不涉及开发细节。完成以下步骤即可在 Obsidian 中使用 Claude Code 处理笔记。

### 1. 安装

1. 确保本地已安装 [Claude Code CLI](https://docs.anthropic.com/claude/docs/claude-code)（`claude` 命令可在终端执行）。
2. 下载 release zip，解压到 Vault 的 `.obsidian/plugins/llm-cli-bridge/` 目录。
3. 在 Obsidian 设置 → 第三方插件中启用 "LLM CLI Bridge"。

### 2. 首次配置

1. 打开插件面板（右侧侧边栏图标）。
2. 首次打开会显示"首次使用提示"，介绍 Backend / Preflight / 选区 / 当前笔记 / 运行。点 × 关闭后不再显示。
3. 在设置中确认 Backend 模式为 `auto`（默认）。
4. 点击面板顶部 **Preflight** 按钮，状态栏会显示 `available`（绿色）或 `unavailable`（红色）。
   - 如果 unavailable：检查本地是否已安装 `claude` CLI，或切换 Backend 到 `mock-success` 进行测试。

### 3. 日常使用：打开笔记 → 点预设 → 得到结果

**场景 A：总结当前笔记**

1. 在 Obsidian 中打开一个笔记。
2. 面板底部 chips 行确认 **Note** 已勾选（会显示文件名）。
3. 点 **总结当前笔记** 按钮，输入框自动填充 prompt。
4. 点 ↑ 发送（或 Ctrl/Cmd+Enter）。
5. 运行结束后，摘要笔记会出现在 `settings.outputDir`（默认 `90_AI整理待确认/`），消息下方会显示可点击的文件链接。

**场景 B：解释选区**

1. 在编辑器中选中一段文本。
2. 面板底部 chips 行确认 **Selection** 已勾选（会显示字符数）。
3. 点 **解释/改写选区** 按钮。
4. 发送后，Claude 会基于选区内容给出解释或改写。

**场景 C：生成复习提纲**

1. 打开一个课堂笔记或学习笔记。
2. 点 **生成复习提纲** 按钮。
3. 发送后，复习提纲（含核心概念、Q&A、易错点、延伸思考题）会生成到输出目录。

**场景 D：整理当前笔记**

1. 打开结构混乱的笔记。
2. 点 **整理当前笔记** 按钮。
3. 发送后，Claude 会整理标题层级、统一格式，并通过 `create_note` action 写回。

### 4. 自由提问

点 **自由提问** 按钮清空输入框并聚焦，直接输入任意问题发送即可。

### 5. 停止运行

运行中状态栏显示 `Running`，发送按钮变为 ■ 停止按钮。点 ■ 可终止当前进程。

### 6. 查看错误

运行失败时，消息下方会显示简短错误摘要和 debug log 路径。展开 stderr 可查看完整错误信息。

---

## License

MIT
