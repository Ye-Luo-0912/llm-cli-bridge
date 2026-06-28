# LLM CLI Bridge

将 Obsidian 桥接到本地 Claude Code CLI，在面板里直接向 Claude 提问、解释选区、总结当前笔记。

仅桌面端运行，通过本地 `claude` 命令调用，不引入 SDK / Codex / ACP / MCP。

---

## 普通用户快速上手

### 1. 准备本地 Claude Code CLI

在终端执行 `claude --version`，能看到版本号即可。如果未安装，参考 [Claude Code 官方文档](https://docs.anthropic.com/claude/docs/claude-code) 安装。

### 2. 安装插件

1. 下载 release zip（`llm-cli-bridge-<version>.zip`）。
2. 解压后应该看到 6 个文件：`main.js` / `manifest.json` / `styles.css` / `README.md` / `RELEASE_CHECKLIST.md` / `USER_GUIDE.md`。
3. 把这 6 个文件复制到 Vault 的 `.obsidian/plugins/llm-cli-bridge/` 目录（目录不存在就新建）。
4. 重启 Obsidian，设置 → 第三方插件 → 找到「LLM CLI Bridge」→ 启用。

> 详细图文流程见 [USER_GUIDE.md](docs/USER_GUIDE.md)。

### 3. 首次使用：Preflight 检测

1. 启用插件后，点左侧栏的机器人图标打开 Bridge 面板。
2. 空状态会显示 5 步引导，点底部「运行 Preflight 检测」按钮（或面板顶部 Preflight）。
3. 状态栏 Preflight 一栏显示：
   - 绿色 `available` —— 可以正常使用。
   - 红色 `unavailable` —— 检查本地 `claude` CLI 是否安装、PATH 是否可用。

> Preflight 只执行 `claude --version`，不调用真实模型，不消耗 API。

### 4. 日常使用

#### 提问

底部输入框输入问题 → 点 ↑ 或按 Ctrl/Cmd+Enter 发送。

#### 解释选区

编辑器中选中文本 → 面板底部 chips 行确认 **Selection** 已勾选（显示字符数）→ 点「解释选区」按钮 → 发送。

#### 总结当前笔记

打开一个笔记 → 确认 **Note** 已勾选（显示文件名）→ 点「总结当前笔记」按钮 → 发送。运行结束后摘要笔记生成到 `outputDir`（默认 `90_AI整理待确认/`），消息下方会显示可点击的文件链接。

#### 自由提问

点「自由提问」按钮清空输入框并聚焦，直接输入任意问题发送。

### 5. 停止运行

运行中状态栏显示 `Running`，发送按钮变为 ■ 停止按钮。点 ■ 终止当前进程。

### 6. 查看生成文件

运行结束后，新增/修改的 Markdown 文件会以可点击列表显示在消息下方，点击即跳转打开。

### 7. 查看错误与 debug log

运行失败时，消息下方会显示：

- 简短错误摘要（脱敏，不含 token / API key）。
- debug log 路径（可点击复制）。
- 折叠的 stderr 完整内容（点击展开）。

debug log 位于 `.llm-bridge/logs/debug-<timestamp>.log`。

### 8. 关闭首次使用提示

首次打开面板会显示「首次使用提示」5 步指南，点 × 关闭后不再显示。如需再次查看，清除浏览器 localStorage 中 `llm-bridge-guide-dismissed` 键即可。

---

## 默认配置

普通用户安装后无需任何配置即可使用。默认值：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| Agent 类型 | `claude` | 使用 Claude Code CLI |
| Backend 模式 | `auto` | 真实调用 CLI（非 mock） |
| 引用当前笔记 | 关 | 点「总结当前笔记」按钮会自动打开 |
| 引用选区 | 开 | 点「解释选区」按钮会确保打开 |
| 推荐输出目录 | `90_AI整理待确认` | 生成笔记的建议目录，可改 |
| 显示 stderr | 开 | 失败时显示错误摘要与 debug log 路径 |
| 保存运行日志 | 开 | 写入 `.llm-bridge/logs/` |

设置入口：Obsidian 设置 → 第三方插件 → LLM CLI Bridge。

- **基础配置**：Agent 类型 / 引用开关 / 输出目录（普通用户日常只关心这里）
- **高级配置**：命令与参数（默认值可用，一般不改）
- **日志与显示**：stderr 显示、日志保存
- **开发者区域**：Backend 模式（mock）/ Dev Test Mode（仅供开发测试，日常保持 auto + 关闭）

---

## 命令（Command Palette）

| 命令 | 说明 |
|---|---|
| Open LLM CLI Bridge panel | 打开 Bridge 面板 |
| Ask Claude about selection | 预填选区作为上下文（不自动发送） |
| Rewrite selection with Claude | 预填重写指令并自动发送，要求用 `replace_selection` 回写 |
| Summarize active note to pending note | 自动总结当前笔记到 `outputDir/` |
| Create pending note from selection | 基于选区创建待确认笔记到 `outputDir/` |
| Open last generated note | 打开 `outputDir/` 下最近修改的 .md（不调用 LLM） |

---

## 测试与构建（开发者）

```bash
npm install
npm run build         # tsc 类型检查 + esbuild 打包 main.js
npm run test:unit     # 纯单元测试
npm run test:process  # 本地子进程 fixture + preflight
npm run test:claude   # 真实 claude smoke（缺 claude 时自动 skip）
npm test              # 全量
npm run release       # 生成 release/llm-cli-bridge-<version>.zip
```

测试报告输出到 `docs/test-report.md`。需要手工验证的项标记为「manual required」。

### Release zip 内容

`npm run release` 产物只包含以下 6 个文件，不包含源码、node_modules、.llm-bridge、测试临时文件：

```
llm-cli-bridge-<version>/
├── main.js
├── manifest.json
├── styles.css
├── README.md
├── RELEASE_CHECKLIST.md
└── USER_GUIDE.md
```

### 敏感信息扫描

`scripts/scan-sensitive.mjs` 扫描 release 内容，确保无 token / API key / .env / credentials 进入 zip。

---

## 开发约定

- `child_process.spawn` + `shell: true`，cwd = Vault 根目录。
- Prompt 经 stdin 传递（避免命令行长度限制）。
- HTTP 请求 30s 超时。
- 修改类 action（create_note / append_to_note / insert_at_cursor / replace_selection）需两阶段确认。
- AgentEvent v0.1 contract 已冻结，不新增 tool event。
- UI 使用 Obsidian CSS 变量，无框架依赖。
- PATH 增强：Vault 局部 `LLM-AgentRuntime/node_modules/.bin` → fnm/nvm/Volta → 系统 PATH。

### Debug Log 位置

| 日志 | 路径 | 内容 |
|---|---|---|
| Preflight 诊断 | `.llm-bridge/logs/preflight-<timestamp>.log` | env key 存在性、命令探测、exit code |
| 运行诊断 | `.llm-bridge/logs/debug-<timestamp>.log` | 命令路径、cwd、env key、进程起止、stderr 摘要 |
| Action 审计 | `.llm-bridge/logs/actions.jsonl` | 所有 action 状态变更 |
| Dev 操作审计 | `.llm-bridge/logs/dev-ops.jsonl` | `/dev/approve` / `/dev/reject` 操作（仅 devTestMode） |

> 日志只记录 env key 名（存在性），不记录 value，不泄露 secret。

---

## 已知非阻塞问题

见 [docs/BACKLOG.md](docs/BACKLOG.md)。

---

## License

MIT
