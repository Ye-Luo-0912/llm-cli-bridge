# Codex Real Protocol Capability

- **generatedAt**: 2026-07-06T12:38:10.448Z
- **testedCodeCommitSha**: 9e1042d27f3760831f371df99cf4c98efa52a2eb
- **runtimeVersion**: 0.142.5
- **testedPlatform**: win32-x64
- **selectedModel**: gpt-5.5
- **authStatus**: initialized
- **realProtocolCapabilitySmokeStatus**: partial
- **commandExecutionRealSmokeStatus**: pass
- **fileChangeRealSmokeStatus**: pass
- **approvalRealSmokeStatus**: pass
- **userInputRealSmokeStatus**: not-observed
- **unknownMethodCount**: 7
- **unknownItemTypeCount**: 0
- **observedShapeNoteCount**: 2
- **cleanShutdown**: pass
- **error**: null

Overall is partial because commandExecution, fileChange, and approval were observed in the real managed app-server protocol, while userInput was not observed in this run and is not counted as pass.

## Scenarios

| Scenario | Outcome | Nodes | Server requests | Error |
| --- | --- | --- | --- | --- |
| commandExecution | completed | 2 | item/commandExecution/requestApproval<br>serverRequest/resolved |  |
| fileChange | completed | 10 | item/fileChange/requestApproval<br>serverRequest/resolved<br>item/commandExecution/requestApproval<br>serverRequest/resolved<br>item/commandExecution/requestApproval<br>serverRequest/resolved |  |
| userInput | completed | 2 | none |  |

## Checks

| Check | Status | Detail |
| --- | --- | --- |
| command item/started has itemId | pass | call_4lIiE5RUY5Avh7E27z2dPcnV |
| command outputDelta by itemId enters node | pass | stdoutIncludesTarget=true stdoutChars=746 |
| command completed writes exitCode/durationMs/stdout | pass | exit=0 duration=1268 |
| timeline does not rely on recent running tool | pass | cards=2 nodes=2 |
| command approval request surfaced | pass | item/commandExecution/requestApproval,serverRequest/resolved |
| command approval resolved same item | pass | approval=approved |
| fileChange item has changes[] | pass | changes=1 |
| fileChange path/action/diff enters FileChangeCard | pass | path=D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\.tmp\codex-real-protocol-smoke-vault\v17-f42-target.md action=modify diffChars=27 |
| fileChange approval request bound to itemId | pass | requestItem=call_CoJe029VrZw8P6cheXQpWvVT nodeItem=call_CoJe029VrZw8P6cheXQpWvVT |
| fileChange approvalStatus resolved | pass | node=approved card=approved |
| user input request surfaced | fail |  |
| user input timeline node resolved | fail | status=undefined |
| normal user verbose output collapsed | pass | defaultExpanded=false sourceRef=false |
| developer mode shows sourceRef/threadId/turnId/itemId/method | pass | {"threadId":"019f376f-a186-74b2-bdb4-833b9401deac","turnId":"019f376f-a2be-7be2-b165-2373ab11cf19","itemId":"call_4lIiE5RUY5Avh7E27z2dPcnV","serverRequestId":"codex-req-0","method":"item/commandExecution/requestApproval","sequence":1000} |
| normal mode does not expose raw JSON sourceRef | pass | normalSourceRef=false |

## UI Contract

- **normalUserVerboseOutputDefaultCollapsed**: true
- **normalUserRawJsonSourceRefHidden**: true
- **developerModeSourceRefVisible**: true

## Unknown / Shape Observations

- **unknownMethods**: 
  - account/rateLimits/updated (9)
  - mcpServer/startupStatus/updated (6)
  - remoteControl/status/changed (1)
  - thread/started (3)
  - thread/status/changed (14)
  - thread/tokenUsage/updated (9)
  - turn/diff/updated (5)
- **unknownItemTypes**: none
- **observedShapeNotes**: 
  - serverRequest/resolved did not include itemId/decision; timeline resolved by requestId correlation
  - fileChange.change.kind object shape observed and normalized
