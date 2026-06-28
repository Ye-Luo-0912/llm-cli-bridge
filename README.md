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

## License

MIT
