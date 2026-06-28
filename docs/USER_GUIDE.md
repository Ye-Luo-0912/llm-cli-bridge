# LLM CLI Bridge 用户指南

本指南面向普通 Obsidian 用户，不涉及开发细节。按顺序完成后即可日常使用。

---

## 一、准备工作

### 1. 安装 Claude Code CLI

LLM CLI Bridge 需要本地有 `claude` 命令可用。

**Windows / macOS / Linux 通用步骤：**

1. 打开终端（Windows 用 PowerShell，macOS 用 Terminal）。
2. 执行 `claude --version`。
   - 如果显示版本号（例如 `2.1.195`），说明已安装，跳到下一步。
   - 如果提示「command not found」或「不是内部或外部命令」，参考 [Claude Code 官方文档](https://docs.anthropic.com/claude/docs/claude-code) 安装。
3. 安装后再次执行 `claude --version` 确认可用。

> 如果你用的是 fnm / nvm / Volta 等 Node 版本管理器，插件会自动扫描这些路径，无需手动配置 PATH。

### 2. 下载并安装插件

1. 从 release 页面下载 `llm-cli-bridge-<version>.zip`。
2. 解压后会看到 6 个文件：
   - `main.js`（插件主程序）
   - `manifest.json`（插件清单）
   - `styles.css`（样式）
   - `README.md`（项目说明）
   - `RELEASE_CHECKLIST.md`（发布检查清单）
   - `USER_GUIDE.md`（本文件）
3. 打开你的 Obsidian Vault 所在文件夹。
4. 进入 `.obsidian/plugins/` 目录（如果没有 `plugins` 文件夹就新建）。
5. 新建文件夹 `llm-cli-bridge`，把解压出的 6 个文件全部复制进去。

目录结构应该是这样：

```
你的Vault/
└── .obsidian/
    └── plugins/
        └── llm-cli-bridge/
            ├── main.js
            ├── manifest.json
            ├── styles.css
            ├── README.md
            ├── RELEASE_CHECKLIST.md
            └── USER_GUIDE.md
```

### 3. 启用插件

1. 重启 Obsidian（或按 Ctrl/Cmd+R 重新加载）。
2. 打开设置 → 第三方插件。
3. 如果提示「受限模式」已开启，点关闭受限模式。
4. 在已安装插件列表中找到「LLM CLI Bridge」，打开开关启用。
5. 启用后，左侧栏会出现机器人图标，点它即可打开 Bridge 面板。

---

## 二、首次使用

### 1. 打开面板

点左侧栏机器人图标，右侧会打开 LLM CLI Bridge 面板。

首次打开会看到两样东西：

- **空状态引导**：5 步使用说明，底部有「运行 Preflight 检测」按钮。
- **首次使用提示卡片**：更详细的 5 步指南，点 × 关闭后不再显示。

### 2. 运行 Preflight 检测

点空状态底部的「运行 Preflight 检测」按钮，或面板顶部的 Preflight 按钮。

观察面板顶部状态栏的 Preflight 一栏：

- 绿色 `available` —— `claude` CLI 可用，可以正常使用。
- 红色 `unavailable` —— `claude` CLI 不可用。请回到「准备工作」检查安装。

> Preflight 只执行 `claude --version`，不调用真实模型，不消耗 API 额度。

### 3. 确认 Backend 模式

正常情况下无需修改。如果 Preflight 一直显示 unavailable，可以检查：

设置 → 第三方插件 → LLM CLI Bridge → 滚动到底部「开发者区域」：

- **Backend 模式** 应保持 `auto（真实 CLI）`。不要改成 mock-success / mock-failure，那些是开发测试用的。
- **Dev Test Mode** 应保持关闭。

---

## 三、日常使用

### 场景 A：直接提问

1. 点左侧栏机器人图标打开面板。
2. 在底部输入框输入问题，例如「这段代码什么意思？」。
3. 点 ↑ 按钮，或按 Ctrl/Cmd+Enter 发送。
4. Claude 的回答会显示在消息流中。

### 场景 B：解释选中的文本

1. 在编辑器中选中一段文本（代码、概念、外语等）。
2. 打开 Bridge 面板，看底部 chips 行：
   - **Selection** 应显示勾选态，旁边显示选区字符数（例如 `42`）。
   - 如果没勾选，点一下 Selection chip 勾选。
3. 点面板中的「解释选区」按钮，输入框会自动填入解释指令。
4. 点 ↑ 发送，Claude 会基于选区给出解释。

> 选区内容由「引用选区」开关控制。点「解释选区」按钮会自动帮你打开。

### 场景 C：总结当前笔记

1. 在 Obsidian 中打开一个笔记。
2. 打开 Bridge 面板，看底部 chips 行：
   - **Note** 应显示勾选态，旁边显示文件名。
   - 如果没勾选，点一下 Note chip 勾选。
3. 点面板中的「总结当前笔记」按钮，输入框会自动填入总结指令。
4. 点 ↑ 发送。
5. 运行结束后，摘要笔记会生成到输出目录（默认 `90_AI整理待确认/`），消息下方会显示可点击的文件链接，点击即跳转打开。

> 笔记内容由「引用当前笔记」开关控制。点「总结当前笔记」按钮会自动帮你打开。

### 场景 D：自由提问

点「自由提问」按钮会清空输入框并聚焦，你可以输入任意问题。

---

## 四、运行控制

### 停止运行

运行中状态栏显示 `Running`，发送按钮会变成 ■ 停止按钮。点 ■ 即可终止当前进程。

### 查看运行过程

每条 assistant 消息下方都有「运行过程」时间线，显示：

- Started（开始时间）
- stdout（首次输出，截断到 60 字符）
- stderr（首次错误输出，如果有）
- Completed / Failed / Stopped（终态 + 详情）

### 查看生成文件

运行结束后，如果 Claude 新建或修改了 Markdown 文件，消息下方会显示「新增/修改的 Markdown 文件」列表，每项可点击打开。

---

## 五、错误处理

### 运行失败时

消息下方会显示三样东西：

1. **简短错误摘要**：脱敏后的错误原因（不含 token / API key）。
2. **Debug log 路径**：可点击复制完整路径，便于排查。
3. **折叠的 stderr**：点 ▶ 展开查看完整错误输出。

### 常见错误

| 错误现象 | 可能原因 | 解决方法 |
|---|---|---|
| Preflight unavailable | `claude` CLI 未安装或 PATH 不可用 | 重新安装 Claude Code CLI，或重启 Obsidian 让 PATH 生效 |
| 运行后立即 failed | API key 未配置或失效 | 在终端执行 `claude` 单独测试，按提示登录 |
| 运行后无文件生成 | Claude 没有调用文件操作 | 检查 AGENTS.md 是否存在，或在 prompt 中明确要求生成笔记 |
| 中文乱码 | PowerShell 编码问题 | 不影响功能，可忽略 |

### 查看 debug log

debug log 位于 Vault 下的 `.llm-bridge/logs/debug-<timestamp>.log`。

在 Obsidian 中可以用文件管理器导航到 `.llm-bridge/logs/` 目录查看，或在系统文件资源管理器中打开 Vault 文件夹找到该路径。

---

## 六、设置说明

设置入口：Obsidian 设置 → 第三方插件 → LLM CLI Bridge。

### 基础配置（日常只关心这里）

| 设置项 | 默认值 | 说明 |
|---|---|---|
| Agent 类型 | Claude Code | 也可以临时在面板顶部切换 |
| 引用当前笔记 | 关 | 点「总结当前笔记」会自动打开 |
| 引用选区 | 开 | 点「解释选区」会自动确保打开 |
| 推荐输出目录 | `90_AI整理待确认` | 生成笔记的建议目录，可改成自己喜欢的 |

### 高级配置（一般不改）

命令与参数默认值已经可用。只有在本地 CLI 名称不同（例如自定义路径）时才修改。

### 日志与显示

- 显示 stderr：默认开。失败时错误摘要与 debug log 路径会显示在消息下方。
- 保存运行日志：默认开。写入 `.llm-bridge/logs/`。

### 开发者区域（普通用户不要改）

- Backend 模式：保持 `auto`。mock-success / mock-failure 仅供开发测试。
- Dev Test Mode：保持关闭。开启会暴露测试端点。

---

## 七、隐私与安全

- 插件通过本地 `claude` CLI 调用，不直接联网发送数据。
- token / API key 不会写入日志，日志只记录 env key 名（存在性）。
- 修改类操作（创建笔记、追加内容、替换选区）需要你在面板中确认才会执行。
- bridge.json（含 token）只在 Vault 本地的 `.llm-bridge/` 目录，不会进入 release zip。

---

## 八、获取帮助

- 查看项目 [README.md](../README.md) 了解技术细节。
- 查看 [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md) 了解发布检查项。
- 已知非阻塞问题见 [BACKLOG.md](BACKLOG.md)。
