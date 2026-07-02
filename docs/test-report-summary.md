# LLM CLI Bridge 测试报告 — 汇总（V2.17-A Completion）

> 本报告由 `scripts/generate-test-summary.mjs` 从 unit/process 报告解析生成，不手写。
> 详细结果分别见：
> - [docs/test-report-unit.md](./test-report-unit.md) — 单元测试详细结果
> - [docs/test-report-process.md](./test-report-process.md) — 进程测试详细结果
>
> 三份报告不互相覆盖：unit/process 各自独立生成，summary 仅汇总主线结论。

- **生成时间**: 2026-07-02T15:43:32.009Z
- **当前 HEAD commit sha**: 076f2ffa6b01064a14decf87d5c8cddee7d4aba6
- **当前 HEAD 短 sha**: 076f2ffa6b01
- **unit 报告 commit sha**: 076f2ffa6b01064a14decf87d5c8cddee7d4aba6
- **process 报告 commit sha**: 076f2ffa6b01064a14decf87d5c8cddee7d4aba6
- **unit 运行命令**: node scripts/run-tests.mjs --unit
- **process 运行命令**: node scripts/run-tests.mjs --process
- **unit 测试时间**: 2026-07-02T15:43:01.419Z
- **process 测试时间**: 2026-07-02T15:43:02.355Z

## 主线结论

| 轨道 | 通过 | 失败 | 跳过 | 需人工 | 总计 | commit sha | 主线状态 |
|------|------|------|------|--------|------|------------|----------|
| unit | 744 | 0 | 36 | 0 | 780 | 076f2ffa6b01 | ✅ 通过 |
| process | 87 | 0 | 59 | 0 | 146 | 076f2ffa6b01 | ✅ 通过 |
| **合计** | **831** | **0** | **95** | **0** | **926** | 076f2ffa6b01 | ✅ **主线通过** |

**双轨均 0 失败 → V2.17-A Completion 主线闭环测试通过。**

## 审计模式说明（integrity check）

- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。
- 本轮 unit 轨道：uncaughtException = 0，unhandledRejection = 0
- 本轮 process 轨道：uncaughtException = 0，unhandledRejection = 0
- **commit sha 一致性**：unit 与 process 报告的 commit sha 必须一致，且与当前 HEAD 一致；不匹配时审计模式 fail。
- **报告过期判定**：若 unit/process 报告的 commit sha 与当前 HEAD 不一致，说明报告是旧 commit 的结果，必须重新生成。

## 审计结果

✅ **审计通过**：commit sha 一致 + uncaught/unhandled 为 0 + 字段解析完整。

## skip 策略与覆盖替代

当前环境 skip 项保留，但每项必须标明原因并有覆盖替代测试。skip 原因分类：

| skip 原因 | 说明 | 覆盖替代 |
|-----------|------|----------|
| 环境假失败（非 Windows） | `cmd /c` 类命令在 Linux 沙箱不可用 | process 轨道的 fixture 测试覆盖等价路径 |
| 模式不匹配 | unit 模式跳过 process/claude/integration 段；process 模式跳过 unit 段 | unit ↔ process 互补：unit 测 mapper/aggregator 纯函数，process 测真实子进程 |
| Obsidian 未运行 | integration 测试需真实 Obsidian HTTP bridge | unit 轨道的 ACTION_SCHEMAS / validateAction 覆盖 schema 验证 |
| claude/codex CLI 不可用 | 沙箱未安装 claude/codex 命令 | Preflight fixture + EventMapper fixture 覆盖协议映射；real codex smoke 在 codex 可用环境运行 `npm run smoke:codex-app-server` |

---

*报告由 `scripts/generate-test-summary.mjs` 自动生成（解析 unit/process 报告，不手写）*
