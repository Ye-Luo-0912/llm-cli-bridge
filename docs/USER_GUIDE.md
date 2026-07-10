# LLM CLI Bridge 用户指南

本指南面向普通 Obsidian 用户。当前版本 **v2.18.0**。

> **平台支持：仅 Windows x64**。跨平台支持留到下个版本。

---

## 一、安装与升级

### 1. 下载发行包

下载 `llm-cli-bridge-<version>-win32-x64.zip`。默认包大小约 98 MB（不含 runtime binary）。

如需离线安装，使用离线包（含预装 runtime binary，约 406 MB），首次运行无需下载。

### 2. 解压并安装

1. 解压 zip。
2. 将内容复制到你的 Vault 插件目录：

```text
<Vault>/.obsidian/plugins/llm-cli-bridge/
```

3. 重启 Obsidian。
4. 设置 → 第三方插件 → 启用 `LLM CLI Bridge`。

升级时直接覆盖同一目录下的文件，然后重启 Obsidian。

### 3. 首次运行下载 runtime

启用插件后，**Managed Codex**（默认运行时）会在首次运行时自动下载约 323 MB 的 Windows runtime binary。请保持网络可用。

### 4. 配置 Codex/OpenAI 登录凭据

Managed Codex runtime 需要用户级 Codex/OpenAI 凭据，二选一：

- 配置 `~/.codex` 目录（Codex CLI 登录后生成）。
- 或设置相应环境变量。

未配置凭据时 runtime 无法与模型通信。

---

## 二、运行时选择

| 运行时 | 说明 | 首次下载 |
|--------|------|----------|
| Managed Codex（默认） | 内置 Codex runtime，首次运行下载约 323 MB Windows binary | 是，约 323 MB |
| Claude CLI | 需用户自行安装 Claude Code | 否 |
| Claude SDK | 需用户自行配置 Claude SDK | 否 |
| Pi（高级） | 实验性 Pi runtime | 否 |

默认使用 Managed Codex。如需切换到 Claude CLI / Claude SDK / Pi，在插件设置中选择对应运行时并按提示配置其本地凭据与运行环境。

---

## 三、主界面

主界面收敛为紧凑聊天式工作台：左侧图标导航、顶部会话栏、中央消息流、底部 composer。

### 左侧导航

左侧窄图标 rail，只负责切换页面：

- `Chat`：聊天主界面。
- `Files`：本轮附件、Pinned context、FileRef index、外部读取授权。
- `Skills`：Agent Skills runtime capabilities。
- `History`：历史会话列表和恢复。

左侧不放 Settings。设置入口在顶部齿轮。

### 顶部栏

顶部栏包含：

- `Bridge` 标题。
- 当前页面名称。
- 当前会话 selector。
- `+ 新聊天`。
- 设置齿轮。
- compact runtime status，例如 `Managed Codex · 已就绪`。

Backend、cwd、preflight 等详细诊断不常驻主界面，失败时从详情展开。

### Chat 页

Chat 页只保留主消息流和必要状态：

- 用户和 assistant 消息。
- thinking / running 状态。
- 命令执行摘要卡片。
- 失败摘要卡片。
- stderr、workflow trace、debug log 默认折叠，点「查看详情」展开。

### Composer

底部 composer 是日常操作中心：

- 左侧：上传、命令菜单、权限模式 chip。
- 中间：输入框，支持 `/` 命令习惯。
- 右侧：model/effort thinking 组合控件、发送按钮。

preflight、路径 fallback 等入口已收进命令菜单或二级区域，不再铺满输入区下方。

### Context / Attachments

主界面不再常驻展示空的工作集区域：

- `Note` / `Selection` 是轻量 context toggles。
- 拖拽、粘贴、`@` 选择或输入路径添加的文件默认是本轮 attachments。
- 本轮 attachments 显示在输入框内，发送后移动到对应用户消息气泡。
- 下一轮 composer 默认清空，不自动带入上一轮普通附件。
- 只有点击 `Pin` 的文件会进入 Pinned context，并跨轮保留。

---

## 四、附件与文件边界

用户主动添加附件后默认只服务当前消息：

- text / markdown / json 小文件会在当次请求中 bounded inline 打包给 agent。
- image / 截图 / blob 会写入本地 attachment cache；SDK 可用时优先走 Streaming Input image block，否则作为 path ref。
- 大文件、PDF、binary、unknown 默认只作为 refs，不在插件侧解析。
- 删除 attachment chip 会同步清理对应本轮 attachment grant。

Native handoff：

- Vault 内普通文件读写交给运行时 agent 的原生能力。
- 插件在 prompt / handoff 中说明 Vault 根目录、当前附件、Pinned context 和限制。
- 如需查看图片或 PDF，让 agent 用原生能力读取对应路径。

安全边界：

- Vault 外 read 需要用户确认授权。
- Vault 外 write / delete / rename 不开放。
- `.env`、token、credentials、secrets、`.ssh`、私钥、`.git/config`、`.obsidian`、`.llm-bridge` 凭据路径保持拒绝或强风险提示。

---

## 五、Agent Skills

Skills 页只代表 Agent Skills：

- Agent Skill 是运行时 agent 可发现、可调用的 capability。
- Skills 页只负责展示、启用/禁用和预览。
- 点击 Agent Skill 只更新内联预览，不写入 composer。
- Agent Skill instructions 不会拼接进 promptPackage。

---

## 六、运行与错误

发送消息后，agent 会在 Vault 根目录作为工作区执行。运行中可以点发送按钮位置的 stop 控件终止。

失败时主界面只显示摘要：

- 简短错误原因。
- `查看详情`。
- debug log 路径和复制按钮。
- 折叠的 stderr / command / workflow trace。

debug log 位于：

```text
<Vault>/.llm-bridge/logs/
```

日志不会记录 token/API key 明文。

---

## 七、已知限制

- 插件不自研 Vault write executor、backup、rollback、audit transaction。
- 插件不做 OCR、PDF parser、image parser。
- 图片/PDF/二进制文件在插件内只显示引用，由 agent 原生读取。
- 外部读取授权是会话级，重启或新会话后需要重新授权。
- Managed Codex runtime 首次运行需联网下载约 323 MB binary；离线包已预装可跳过下载。
- 运行时是否可用取决于本地凭据与网络状态。

---

## 八、帮助

- 技术说明见 [README.md](../README.md)。
- 发布检查见 [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md)。
