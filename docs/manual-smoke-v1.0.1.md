# Manual Smoke Report — V1.0.1

> 本文件由 V1.0.2 打包阶段整理，源自 Obsidian Developer Console 自动化验证脚本的运行结果。
> 已清理本机绝对路径与敏感信息（token / 端口 / 用户名）。

## 元信息

| 字段 | 值 |
|---|---|
| 验证版本 | plugin 0.1.0（V1.0.1 metadata sync fix） |
| 验证时间 | 2026-06-28T08:20:27Z |
| Vault | `<test-vault>`（测试专用 vault） |
| 验证方式 | Obsidian Developer Console 自动化脚本（`v1-smoke.mjs`） |
| 汇总 | 6 passed / 0 failed / 0 manual required |

## 验证项

| # | 验证项 | 结果 | 详情 |
|---|---|---|---|
| 1 | mock-success 完成 | ✅ pass | status=completed, contentLen=66, exitCode=0 |
| 2 | mock-failure 显示 | ✅ pass | status=failed, stderrLen=36, exitCode=1 |
| 3 | auto+Claude 短消息响应 | ✅ pass | status=completed, duration≈8s, contentLen=3, exitCode=0 |
| 4 | 选区识别 | ✅ pass | 编辑器设置 15 字符选区，view.getSelection 检测到 15 字符 |
| 5 | 当前笔记识别 | ✅ pass | activeFilePath=AGENTS.md |
| 6 | 可点击生成文件（fileDiff 检测） | ✅ pass | 运行期间创建 `smoke-gen-test-<ts>.md`，generatedFiles 检测到 `[NEW]` |

## V1.0.1 Bridge Metadata Sync 附加验证

| 验证项 | 结果 |
|---|---|
| bridge.json 端口 = 实际 HTTP 端口 | ✅ |
| bridge.json 字段完整（version/host/port/token/vaultPath/startedAt/pluginVersion） | ✅ |
| diag-onload.txt 诊断完整 | ✅ |
| bridgeWritten: true / error: null | ✅ |
| helper health / state 调用 | ✅ 200 OK |
| 401 重试逻辑（陈旧 token 自动重读重试） | ✅ |
| 日志/诊断文件不含 token 明文 | ✅ |

## 验证脚本说明

- 脚本位置：`<vault>/.llm-bridge/test-artifacts/v1-smoke.mjs`（不打包进 release）
- 执行方式：Obsidian Developer Console 中 `eval` 读取脚本内容
- 原理：
  - 通过 `app.workspace.getLeavesOfType("llm-cli-bridge-view")` 获取 view 实例
  - 调用 `view.setInput()` + `view.runNow()` 触发运行
  - 轮询 `view.messages` 等待新 assistant 消息到达终态
  - 第 6 项额外轮询 `msg.generatedFiles` 等 `onRunFinished` 内部 300ms setTimeout + snapshot 完成
  - 选区/笔记识别直接调用 `view.getSelection()` / `view.getActiveFile()`（规避 Obsidian renderer fetch CORS 限制）
  - 测试文件用 `app.vault.adapter.write()` 直接写文件系统，绕过 dataview 索引
- 自动恢复原始设置（backendMode / includeSelection / includeActiveNote）
- 自动清理测试文件

## 注意事项

- 第 3 项（auto+Claude）会真实调用 claude CLI，需确保 PATH 中有 claude 命令
- 脚本依赖 `view.runNow()` / `view.setInput()` / `view.getSelection()` / `view.getActiveFile()` 等 public/private 方法，后续版本若重构 view 需同步更新脚本
- 原始结果文件 `v1-smoke-result.json` 含本机绝对路径，不打包进 release
