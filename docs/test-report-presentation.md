# LLM CLI Bridge — Presentation Behavior Tests

- **时间**: 2026-07-11T21:04:19.984Z
- **commit**: 635f2efd6f4135837f45259487f1fdf183dbb175
- **filter**: codex-run
- **结果**: 8 passed, 0 failed

| 状态 | 测试项 | 详情 |
| --- | --- | --- |
| ✅ | V17-G CodexRunViewModel: runHeader/currentActivity/feed/changes/steps/approval/debugPanel 分层 | status=blocked activity=Waiting approval commands=1 changes=1 approvals=1 feed=thinking>command>file>approval thinkingSummary=Plan the edit stepStdout=true relativePath=notes/run.md debug=false/true |
| ✅ | V17-G61: thinking lead + shell/output 合并为单块瀑布，assistant 不冒充 Thinking | feed=thinking>command>file>approval stdoutMerged=true |
| ✅ | V17-G CodexRunViewModel: completion-only → synthetic candidate（单一 DOM 所有者） | final="done" feedKinds=thinking>assistant |
| ✅ | V17-G CodexRunViewModel: 单瀑布流 — 中间过程说明 + 终端 candidate 同在 feed（无独立 Answer 副本） | final="done" feed=assistant>command>assistant>file>assistant assistant=先读配置，再检查 runtime 状态。 | 配置没问题，接着创建 smoke 文件。 | done |
| ✅ | V17-G CodexRunViewModel: 单条 assistant message → feed 内唯一 candidate 节点 | final="只回答这一句。" feed=assistant |
| ✅ | V17-G CodexRunViewModel: assistant→tool→assistant → 前段过程说明，末段 candidate 同瀑布流 | final="命令完成，结果是 hi。" feed=assistant>command>assistant |
| ✅ | V17-G CodexRunViewModel: reasoning→tool→answer → Thinking 仅真 reasoning，answer 为 candidate | final="目录里有 a.md。" feed=thinking>command>assistant |
| ✅ | V17-G CodexRunViewModel: 候选回答遇后续工具时从 candidate 降为 process（单所有者） | midFinal="准备改文件。" afterFinal="" afterFeed=assistant>command |
