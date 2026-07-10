# LLM CLI Bridge

> Obsidian 插件：将 Vault 桥接到本地 LLM CLI agent。
> **平台支持：仅 Windows x64**（跨平台支持留到下个版本）

## 当前版本

v2.18.0

## 运行时

| 运行时 | 说明 | 首次下载 |
|--------|------|----------|
| Managed Codex（默认） | 内置 Codex runtime，首次运行下载约 323 MB Windows binary | 是，约 323 MB |
| Claude CLI | 需用户自行安装 Claude Code | 否 |
| Claude SDK | 需用户自行配置 Claude SDK | 否 |
| Pi（高级） | 实验性 Pi runtime | 否 |

- 默认包大小：约 98 MB（不含 runtime binary）
- 离线包：另行提供（含预装 runtime binary，约 406 MB）
- Managed Codex runtime 需要用户级 Codex/OpenAI 凭据（`~/.codex` 或环境变量）

## 安装

1. 下载 `llm-cli-bridge-<version>-win32-x64.zip`
2. 解压到 `<vault>/.obsidian/plugins/llm-cli-bridge/`
3. 在 Obsidian 中启用插件（Settings → Community plugins）
4. 首次运行时，Managed Codex runtime 会自动下载约 323 MB binary
5. 配置 Codex/OpenAI 登录凭据

## 开发

```bash
npm install
npm run build       # TypeScript 编译 + esbuild 打包
npm test            # 运行测试
npm run build:user-package  # 构建用户发行包
npm run release     # 构建发行 zip
```

## 许可证

MIT
