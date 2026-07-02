# LLM CLI Bridge 测试报告 — 汇总（V2.17-A Completion）

> 本报告为 unit + process 双轨汇总，证明主线通过。详细结果分别见：
> - [docs/test-report-unit.md](./test-report-unit.md) — 单元测试详细结果
> - [docs/test-report-process.md](./test-report-process.md) — 进程测试详细结果
>
> 三份报告不互相覆盖：unit/process 各自独立生成，summary 仅汇总主线结论。

- **生成时间**: 2026-07-02
- **测试环境**: linux / Node.js v24.15.0
- **插件版本**: 2.16.0
- **main.js 大小**: 574.6 KB

## 主线结论

| 轨道 | 通过 | 失败 | 跳过 | 总计 | 主线状态 |
|------|------|------|------|------|----------|
| unit | 733 | 0 | 36 | 769 | ✅ 通过 |
| process | 87 | 0 | 59 | 146 | ✅ 通过 |
| **合计** | **820** | **0** | **95** | **915** | ✅ **主线通过** |

**双轨均 0 失败 → V2.17-A Completion 主线闭环测试通过。**

## 审计模式说明

- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。
- 本轮 unit 轨道：uncaughtException = 0，unhandledRejection = 0
- 本轮 process 轨道：uncaughtException = 0，unhandledRejection = 0
- 两条轨道均无进程级异常 → 审计清洁。

## skip 策略与覆盖替代

当前环境 skip 项保留，但每项必须标明原因并有覆盖替代测试。skip 原因分类：

| skip 原因 | 说明 | 覆盖替代 |
|-----------|------|----------|
| 环境假失败（非 Windows） | `cmd /c` 类命令在 Linux 沙箱不可用 | process 轨道的 fixture 测试覆盖等价路径 |
| 模式不匹配 | unit 模式跳过 process/claude/integration 段；process 模式跳过 unit 段 | unit ↔ process 互补：unit 测 mapper/aggregator 纯函数，process 测真实子进程 |
| Obsidian 未运行 | integration 测试需真实 Obsidian HTTP bridge | unit 轨道的 ACTION_SCHEMAS / validateAction 覆盖 schema 验证 |
| claude/codex CLI 不可用 | 沙箱未安装 claude/codex 命令 | Preflight fixture + EventMapper fixture 覆盖协议映射 |

## V2.17-A Completion 主线验收点

| 验收项 | 证据 | 状态 |
|--------|------|------|
| Codex app-server fixture 与官方 docs/generated schema 关键 shape 一致 | schema/index.ts schemaVersion `0.3.0-official-aligned`；manifest.json wireProtocolCalibration | ✅ |
| initialize/clientInfo 正确 | Codex schema Test 1: clientInfo={name,title,version} + capabilities={experimentalApi:false}，无 clientName/clientVersion 顶层 | ✅ |
| item/agentMessage/delta 可驱动 AssistantTurnView.finalAnswer | Codex schema Test 4: 4 段 delta 拼接为 "Hello, world!" | ✅ |
| approval server-request 使用官方 decision shape | Codex schema Test 8: accept/acceptForSession/decline/cancel，无 allow/deny | ✅ |
| thread/resume 可从 BridgeSession 恢复 | Codex schema Test 11+12: SessionMapper register + getProviderThreadId + hasCodexThread；provider resume 走 thread/resume | ✅ |
| test summary 能同时证明 unit/process 主线通过 | 本报告合计 820p/0f，双轨均 0 失败 | ✅ |

## Codex app-server schema alignment 测试段（unit 轨道新增）

V2.17-A Completion 新增 15 个 schema alignment 测试（位于 unit 轨道末段）：

1. initialize.params 使用 clientInfo + capabilities（无 clientName/clientVersion 顶层）
2. experimentalApi=true 显式启用 + audit hash 区分
3. thread/start 使用 config 容器 + instructions，无 resumeSessionId
4. item/agentMessage/delta 驱动 AssistantTurnView.finalAnswer
5. item/reasoning/summaryTextDelta 驱动 thinking 段
6. item/commandExecution/outputDelta 附加到 tool progress
7. item/started 解析 nested params.item（agentMessage/commandExecution/reasoning）
8. approval decision 使用官方 shape（accept/acceptForSession/decline/cancel，无 allow/deny）
9. approval request 提取 threadId/turnId/itemId 到 providerContext
10. serverRequest/resolved 携带真实 requestId + decision → approval_resolved
11. SessionMapper register + getProviderThreadId/getProviderSessionId + hasCodexThread
12. thread/resume 从 SessionMapper 恢复 + 映射同步更新
13. item/text/delta legacy alias 仍可驱动 finalAnswer（兼容路径）
14. turn/started 通知映射为 progress（detail=turnId）
15. item/completed 解析 nested params.item（agentMessage 完整文本）

全部 15 项通过。

---

*本汇总由 `scripts/run-tests.mjs` 双轨运行后整理生成。详细结果见 test-report-unit.md / test-report-process.md。*
