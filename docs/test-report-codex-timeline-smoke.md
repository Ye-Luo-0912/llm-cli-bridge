# Codex Timeline Smoke

- **generatedAt**: 2026-07-06T11:11:36.464Z
- **testedCodeCommitSha**: d3c966371f43d7e6ba8f4dd6204fd31d49cc527d
- **timelineSmokeStatus**: pass
- **nodeCount**: 8
- **timelineCardCount**: 8

| Check | Status | Detail |
| --- | --- | --- |
| commandExecution output by itemId | pass | cmdA.stdout="cmd-a-out\n" |
| parallel tools no output cross-talk | pass | cmdB.stdout="cmd-b-out\n" |
| fileChange diff card | pass | changes=2 |
| mcpToolCall structured result | pass | result={"total":2,"ok":true} |
| dynamicToolCall contentItems | pass | items=[{"type":"text","text":"result"}] |
| approval request/resolved | pass | cmdA=approved cmdB=pending file=approved |
| user input request/resolved | pass | status=resolved |
| review/contextCompaction/status nodes | pass | nodes=commandExecution,commandExecution,fileChange,mcpToolCall,dynamicToolCall,userInput,reviewMode,contextCompaction |
| AssistantTurnView timeline does not use recent running tool inference | pass | cards=8 nodes=8 |
| normal user verbose output collapsed | pass | defaultExpanded=false |
| developer mode sourceRef visible | pass | devSource=true normalSource=false |
