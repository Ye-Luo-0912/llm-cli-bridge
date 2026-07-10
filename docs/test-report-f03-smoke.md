# F-03 Smoke: 交互状态机收口验收

- **generatedAt**: 2026-07-10T03:35:38.746Z
- **testedCodeCommitSha**: fd951b1eb32c89b3213b4c2ab4e135ed904f84cb
- **f03SmokeStatus**: pass
- **totalChecks**: 16

| Check | Status | Detail |
| --- | --- | --- |
| F-03 ingest 终态守卫: status !== running 时直接返回 toView | pass | ok |
| F-03 cancelled 标志: run 闭包中声明 cancelled = false | pass | ok |
| F-03 runHandle.stop(): 设置 cancelled = true | pass | ok |
| F-03 runHandle.stop(): 调用 turnBuilder.markStopped()（激活死代码） | pass | ok |
| F-03 runHandle.stop(): 设置 terminalStatus = stopped | pass | ok |
| F-03 for-await 守卫: cancelled || terminalStatus 时 break | pass | ok |
| F-03 finally 兜底: 流无终态时 cancelled→stopped / 异常→failed | pass | ok |
| F-03 finishingRun 字段: 声明为 private finishingRun = false | pass | ok |
| F-03 restoreSession: 检查 runHandle || finishingRun | pass | ok |
| F-03 onRunFinished: 开始时设置 finishingRun = true | pass | ok |
| F-03 onRunFinished: finally 清除 finishingRun = false | pass | ok |
| F-03 stopped 渲染分支: 现在可达（markStopped → terminalStatus=stopped → onRunFinished） | pass | ok |
| F-03 Provider 协议未改: codex/sdk/cli provider 无 F-03 改动 | pass | ok |
| F-03 行为: completed 后迟到 message 不覆盖终态/答案 | pass | ok |
| F-03 行为: markStopped 后迟到 failed 不覆盖 stopped 状态 | pass | ok |
| F-03 行为: markStopped 设置 endedAt | pass | ok |
