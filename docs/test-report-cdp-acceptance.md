# LLM CLI Bridge 测试报告 — CDP 端口验收

> 本报告由 `scripts/cdp-acceptance-smoke.mjs` 自动生成。
> 通过 CDP 端口 9223 连接 Obsidian 进行验收。

- **测试时间**: 2026-07-13T19:55:49.954Z
- **CDP 端口**: 9223
- **Passed**: 0
- **Failed**: 1
- **Skipped**: 0

## 测试项

| 状态 | 测试项 | 详情 |
|------|--------|------|
| FAIL | CDP 端口 9223 可达 | connect ECONNREFUSED 127.0.0.1:9223 |

## 测试说明

- **CDP 端口 9223 可达**: 验证 Chrome DevTools Protocol 端口可用
- **Obsidian 页面 target 存在**: 验证 Obsidian 窗口可被 CDP 识别
- **插件已加载**: 验证 llm-cli-bridge 插件已加载且版本正确
- **重载插件成功**: disable → enable 重载插件，验证 onload 无异常
- **状态栏 provider 派生显示**: 验证状态栏 Agent 类型从 session.providerId 派生（Task 1）
- **窄栏 UI 元素存在性**: 验证 composer/menu/scroll-bottom/input 元素存在（760px 验收）
- **active provider 配置一致**: 验证 active.json 与 settings 一致
- **diag-onload.txt 诊断副作用**: 验证 developerMode 关闭时不写入诊断（Task 4）
- **朋友版命令已删除**: 验证 enable/disable-friend-preview 命令不存在（Task 3）

## 仍需人工验收的项目

- **发送图文消息**: 需在 Obsidian UI 内真实发送，检查思考/工具/正文顺序
- **turn/steer / review / compact / fork**: 需在运行中真实触发
- **fork 不污染原会话**: 需在 fork 后检查原会话完整
- **760px 窄栏视觉布局**: 需人眼确认菜单/输入框/回到底部按钮在窄屏下不溢出
- **重启 Obsidian 后配置/模型/会话恢复**: 需真实重启验证

```bash
node scripts/cdp-acceptance-smoke.mjs
```

*报告由 `scripts/cdp-acceptance-smoke.mjs` 自动生成*
