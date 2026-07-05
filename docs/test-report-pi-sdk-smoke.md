# Pi SDK real smoke 报告 (V17-D)

- **测试时间**: 2026-07-05T15:30:00.000Z
- **Node 版本**: v22.22.2 (via fnm, 绕过 npm 11.9 + Node 24 的 minizlib bug)
- **SDK 版本**: `@earendil-works/pi-coding-agent@0.80.3` (实际安装) / package.json optionalDependencies `^0.80.3`
- **SDK 加载方式**: ESM `await import("@earendil-works/pi-coding-agent")` (SDK 是纯 ESM，`"type": "module"`)
- **Auth 来源**: Fallback 到 `~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN` + `env.ANTHROPIC_BASE_URL`（pinai-cn 代理）
- **Model**: 默认 SDK 选择（read-only 用 anthropic provider；pi-native 同）
- **运行命令**: `npm run smoke:pi-sdk`

## Auth 配置链（按优先级 fallback）

1. **标准 Pi auth**（`~/.pi/agent/auth.json`）— 当前为 `{}`，0 models available
2. **环境变量**（`PI_SMOKE_PROVIDER` / `PI_SMOKE_API_KEY` / `PI_SMOKE_BASE_URL` / `PI_SMOKE_MODEL`）— 未设置
3. **Claude Code settings**（`~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN` + `env.ANTHROPIC_BASE_URL`）— **命中**，24 models available

命中后调用：
- `authStorage.setRuntimeApiKey("anthropic", authToken)` — 仅运行时内存，不持久化
- `modelRegistry.registerProvider("anthropic", { baseUrl })` — 覆盖所有 anthropic models 的 baseUrl

## Smoke 结果

| Smoke 组 | passed | text_chunks | tool_events | agent_ended | errors | text_preview |
|----------|--------|-------------|-------------|-------------|--------|--------------|
| read-only | ✅ true | 58 | 2 | true | 0 | `package.json 中的包名是：obsidian-llm-cli-bridge...` |
| pi-native | ✅ true | 31 | 0 | true | 0 | `我是一个在 Pi 编程代理环境中运行的 AI 助手...` |

## 最终状态

```
piSdkSmokeStatus=pass
piReadOnlySmokeStatus=pass
piNativeSmokeStatus=pass
friendReady=true
```

## 分层状态说明

- **piSdkSmokeStatus** = `pass`：SDK ESM import + createAgentSession + prompt + agent_end 全部通过。
- **piReadOnlySmokeStatus** = `pass`：read-only 模式（`tools=["read"]`）+ text_delta + tool_execution_start/end + agent_end。
- **piNativeSmokeStatus** = `pass`：pi-native 模式（不传 tools，用 Pi 默认）+ text_delta + agent_end。
- **friendReady** = `true`：pi-native smoke pass，可正式标 Friend Preview ready + tag RC。

## 已知限制

- 当前 auth 来自 Claude Code 的 `~/.claude/settings.json`，**不是 Pi 原生 auth**。朋友版用户需自行配置 `~/.pi/agent/auth.json` 或环境变量。
- `pi-native` 模式默认不带 tool events（0 个）；smoke 通过条件是 `text_chunks > 0 && agent_ended && errors == 0`。
- SDK 是纯 ESM；provider 的 `requireNode` 仍用 CommonJS `require`，加载 ESM SDK 会失败。需后续 V17-E 改为动态 `import()` 才能在 Obsidian renderer 中真正跑通 Pi SDK provider。

## 后续行动

- [x] V17-D 任务 1：诊断 npm 环境并安装真实 SDK — fnm use 22 绕过 minizlib bug
- [x] V17-D 任务 2：smoke 脚本 SDK 加载改为 ESM `await import()`
- [x] V17-D 任务 3：auth + model 配置（Claude Code settings fallback）
- [x] V17-D 任务 4：跑 smoke 记录结果（双组 pass）
- [x] V17-D 任务 5：piNativeSmokeStatus=pass → friendReady=true → tag RC
- [ ] V17-E（后续）：provider `requireNode` 改为动态 `import()` 支持 ESM SDK（Obsidian renderer 集成）

*报告由 `scripts/pi-sdk-smoke.mjs` 跑通后人工整理*
