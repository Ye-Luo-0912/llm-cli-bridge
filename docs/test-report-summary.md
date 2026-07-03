# LLM CLI Bridge 测试报告 — 汇总（P2: Codex app-server Runtime 主线闭环）

> 本报告由 `scripts/generate-test-summary.mjs` 从 unit/process/codex-smoke 报告解析生成，不手写。
> 详细结果分别见：
> - [docs/test-report-unit.md](./test-report-unit.md) — 单元测试详细结果
> - [docs/test-report-process.md](./test-report-process.md) — 进程测试详细结果
> - [docs/test-report-codex-smoke.md](./test-report-codex-smoke.md) — Codex real app-server smoke
>
> 三份报告不互相覆盖：unit/process/codex-smoke 各自独立生成，summary 仅汇总主线结论。

- **生成时间**: 2026-07-03T04:30:02.012Z
- **reportCommitSha**: cf55436fd518b4f5d05e7702a0474bc2b3c78dec
- **reportCommitSha 短**: cf55436fd518
- **reportParentSha**: cf55436fd518b4f5d05e7702a0474bc2b3c78dec
- **reportParentSha 短**: cf55436fd518
- **testedCodeCommitSha**: cf55436fd518b4f5d05e7702a0474bc2b3c78dec
- **testedCodeCommitSha 短**: cf55436fd518
- **commitKind**: code commit（报告证明当前 HEAD）
- **unitReportCommitSha**: cf55436fd518b4f5d05e7702a0474bc2b3c78dec
- **processReportCommitSha**: cf55436fd518b4f5d05e7702a0474bc2b3c78dec
- **codexSmokeStatus**: skip
- **codexHandshakeStatus**: skip
- **codexTurnStatus**: skip
- **codexVersion**: null
- **codexSchemaSource**: fixture
- **unit 运行命令**: node scripts/run-tests.mjs unit
- **process 运行命令**: node scripts/run-tests.mjs process
- **unit 测试时间**: 2026-07-03T04:25:41.788Z
- **process 测试时间**: 2026-07-03T04:26:34.761Z

## testedCodeCommitSha 语义说明

- **docs-only commit**（当前 commit 只修改 `docs/test-report*.md`）：`testedCodeCommitSha = reportParentSha`，即报告证明的是父 commit（代码 commit）的测试结果。
- **code commit**（当前 commit 修改 `src/` / `scripts/` / `package.json` / `schema/` 等主线文件）：`testedCodeCommitSha = reportCommitSha`（= HEAD），报告必须证明当前 commit。
- **本次判定**：code commit（报告证明当前 HEAD）；testedCodeCommitSha=cf55436fd518。
- **当前 commit 改动文件**：(无改动 / 无法获取)

## 主线结论

| 轨道 | 通过 | 失败 | 跳过 | 需人工 | 总计 | commit sha | 主线状态 |
|------|------|------|------|--------|------|------------|----------|
| unit | 805 | 0 | 25 | 0 | 830 | cf55436fd518 | ✅ 通过 |
| process | 805 | 0 | 25 | 0 | 830 | cf55436fd518 | ✅ 通过 |
| codex-smoke | - | - | - | - | - | null | ⏭️ skip |
| **合计** | **1610** | **0** | **50** | **0** | **1660** | cf55436fd518 | ✅ **主线通过** |

**双轨均 0 失败 → P2 Codex app-server Runtime 主线闭环测试通过。**

## 审计模式说明（P2 integrity check）

- **testedCodeCommitSha 语义**：docs-only commit → = parentSha；code commit → = HEAD。unit/process 报告 sha 必须 === testedCodeCommitSha。
- **uncaughtException / unhandledRejection 计为 fail**：进程级未捕获异常必须反映在测试结果中，不得仅记日志。
- 本轮 unit 轨道：uncaughtException = 0，unhandledRejection = 0
- 本轮 process 轨道：uncaughtException = 0，unhandledRejection = 0
- **codexSmokeStatus**：必须为 `skip`（无 codex CLI）/ `pass`（handshake + turn 全通）/ `handshake-only`（handshake pass 但 turn 非 pass，如 auth 不可用）；`fail` 或缺失 → 审计失败。分层字段 `codexHandshakeStatus` / `codexTurnStatus` 记录根因。
- **报告过期判定**：若 unit/process 报告的 commit sha 与 testedCodeCommitSha 不一致，说明报告是旧 commit 的结果，必须重新生成。

## 审计结果

✅ **审计通过**：testedCodeCommitSha 一致 + codexSmokeStatus 合法 + uncaught/unhandled 为 0 + 字段解析完整。

## skip 策略与覆盖替代

当前环境 skip 项保留，但每项必须标明原因并有覆盖替代测试。skip 原因分类：

| skip 原因 | 说明 | 覆盖替代 |
|-----------|------|----------|
| 环境假失败（非 Windows） | `cmd /c` 类命令在 Linux 沙箱不可用 | process 轨道的 fixture 测试覆盖等价路径 |
| 模式不匹配 | unit 模式跳过 process/claude/integration 段；process 模式跳过 unit 段 | unit ↔ process 互补：unit 测 mapper/aggregator 纯函数，process 测真实子进程 |
| Obsidian 未运行 | integration 测试需真实 Obsidian HTTP bridge | unit 轨道的 ACTION_SCHEMAS / validateAction 覆盖 schema 验证 |
| claude/codex CLI 不可用 | 沙箱未安装 claude/codex 命令 | Preflight fixture + EventMapper fixture 覆盖协议映射；real codex smoke 在 codex 可用环境运行 `npm run smoke:codex-app-server` |

---

*报告由 `scripts/generate-test-summary.mjs` 自动生成（解析 unit/process/codex-smoke 报告，不手写）*
