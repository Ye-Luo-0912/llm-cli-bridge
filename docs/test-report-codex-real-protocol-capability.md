# Codex Real Protocol Capability

- **generatedAt**: 2026-07-06T13:58:44.974Z
- **testedCodeCommitSha**: 3ac798b779c5e537a70ce394ba23d4289c9639a4
- **runtimeVersion**: 0.142.5
- **testedPlatform**: win32-x64
- **selectedModel**: gpt-5.5
- **authStatus**: initialized
- **realProtocolCapabilitySmokeStatus**: partial
- **commandExecutionRealSmokeStatus**: pass
- **fileChangeRealSmokeStatus**: pass
- **approvalRealSmokeStatus**: pass
- **userInputRealSmokeStatus**: not-observed
- **userInputNotObservedReason**: The real managed app-server completed the userInput scenario without sending item/tool/requestUserInput; synthetic mapping remains covered but is not counted as real pass.
- **unknownMethodCount**: 0
- **unknownItemTypeCount**: 0
- **observedShapeNoteCount**: 2
- **observedUnknownMethodClassification**: {"remoteControl/status/changed":"infra","thread/started":"lifecycle","mcpServer/startupStatus/updated":"infra","thread/status/changed":"telemetry/status","thread/tokenUsage/updated":"telemetry/status","account/rateLimits/updated":"telemetry/status","turn/diff/updated":"diff/timeline"}
- **telemetryMethodsObserved**: account/rateLimits/updated, thread/status/changed, thread/tokenUsage/updated
- **lifecycleMethodsObserved**: thread/started
- **timelineMethodsObserved**: turn/diff/updated
- **ignoredInfraMethodsObserved**: mcpServer/startupStatus/updated, remoteControl/status/changed
- **cleanShutdown**: pass
- **error**: null

Overall is partial because commandExecution, fileChange, and approval were observed in the real managed app-server protocol, while userInput was not observed in this run and is not counted as pass.

## Scenarios

| Scenario | Outcome | Nodes | Server requests | Error |
| --- | --- | --- | --- | --- |
| commandExecution | completed | 3 | item/commandExecution/requestApproval<br>serverRequest/resolved |  |
| fileChange | completed | 7 | item/fileChange/requestApproval<br>serverRequest/resolved |  |
| userInput | completed | 3 | none |  |

## Checks

| Check | Status | Detail |
| --- | --- | --- |
| command item/started has itemId | pass | call_LR9dp86BYWKSEjrSOC9EvXFY |
| command outputDelta by itemId enters node | pass | stdoutIncludesTarget=true stdoutChars=746 |
| command completed writes exitCode/durationMs/stdout | pass | exit=0 duration=1343 |
| timeline does not rely on recent running tool | pass | cards=3 nodes=3 |
| command approval request surfaced | pass | item/commandExecution/requestApproval,serverRequest/resolved |
| command approval resolved same item | pass | approval=approved |
| fileChange item has changes[] | pass | changes=1 |
| fileChange path/action/diff enters FileChangeCard | pass | path=D:\Users\Ye_Luo\APP\Test\llm-cli-bridge\.tmp\codex-real-protocol-smoke-vault\v17-f42-target.md action=modify diffChars=27 |
| fileChange approval request bound to itemId | pass | requestItem=call_Z7BBWuhXUiyF7lemutlNnmD7 nodeItem=call_Z7BBWuhXUiyF7lemutlNnmD7 |
| fileChange approvalStatus resolved | pass | node=approved card=approved |
| turn/diff/updated developer status node observed | pass | node=true devCard=true |
| turn/diff/updated hidden from normal timeline | pass | normalVisible=false |
| user input request surfaced | fail |  |
| user input timeline node resolved | fail | status=undefined |
| normal user verbose output collapsed | pass | defaultExpanded=false sourceRef=false |
| developer mode shows sourceRef/threadId/turnId/itemId/method | pass | {"threadId":"019f37b9-6676-74a2-b579-6e67e0f6acfe","turnId":"019f37b9-678e-7e80-9763-b1ffff1c30ac","itemId":"call_LR9dp86BYWKSEjrSOC9EvXFY","serverRequestId":"codex-req-0","method":"item/commandExecution/requestApproval","sequence":1000} |
| normal mode does not expose raw JSON sourceRef | pass | normalSourceRef=false |

## UI Contract

- **normalUserVerboseOutputDefaultCollapsed**: true
- **normalUserRawJsonSourceRefHidden**: true
- **developerModeSourceRefVisible**: true

## Unknown / Shape Observations

- **observedUnknownMethodClassification**:
  - account/rateLimits/updated: telemetry/status
  - mcpServer/startupStatus/updated: infra
  - remoteControl/status/changed: infra
  - thread/started: lifecycle
  - thread/status/changed: telemetry/status
  - thread/tokenUsage/updated: telemetry/status
  - turn/diff/updated: diff/timeline
- **telemetryMethodsObserved**: account/rateLimits/updated, thread/status/changed, thread/tokenUsage/updated
- **timelineMethodsObserved**: turn/diff/updated
- **ignoredInfraMethodsObserved**: mcpServer/startupStatus/updated, remoteControl/status/changed
- **unknownMethods**: none
- **unknownItemTypes**: none
- **observedShapeNotes**: 
  - serverRequest/resolved did not include itemId/decision; timeline resolved by requestId correlation
  - fileChange.change.kind object shape observed and normalized
