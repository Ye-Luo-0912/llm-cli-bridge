# Codex Capability Matrix

- **generatedAt**: 2026-07-06T18:08:06.189Z
- **testedCodeCommitSha**: 1c2d7681c6078f62f6b5337d64659404c699e3d9
- **schemaManifest**: `src/runtime/providers/codex-app-server/schema/manifest.json`
- **schemaSource**: `src/runtime/providers/codex-app-server/schema/index.ts`
- **schemaVersion**: 0.3.0-official-aligned
- **schemaSourceMode**: fixture
- **experimentalApiDefault**: false
- **realProtocolSmokeReport**: `docs/test-report-codex-real-protocol-capability.md`
- **realProtocolCapabilitySmokeStatus**: partial
- **commandExecutionRealSmokeStatus**: pass
- **fileChangeRealSmokeStatus**: pass
- **approvalRealSmokeStatus**: pass
- **userInputRealSmokeStatus**: not-observed
- **unknownMethodCount**: 0
- **unknownItemTypeCount**: 0
- **observedShapeNoteCount**: 2
- **observedUnknownMethodClassification**: {"remoteControl/status/changed":"infra","thread/started":"lifecycle","mcpServer/startupStatus/updated":"infra","thread/status/changed":"telemetry/status","thread/tokenUsage/updated":"telemetry/status","account/rateLimits/updated":"telemetry/status","turn/diff/updated":"diff/timeline"}
- **telemetryMethodsObserved**: account/rateLimits/updated, thread/status/changed, thread/tokenUsage/updated
- **timelineMethodsObserved**: turn/diff/updated
- **ignoredInfraMethodsObserved**: mcpServer/startupStatus/updated, remoteControl/status/changed
- **userInputNotObservedReason**: The real managed app-server completed the userInput scenario without sending item/tool/requestUserInput; synthetic mapping remains covered but is not counted as real pass.
- **realProtocolSmokePassed**: false
- **realSmokePassed**: 14
- **syntheticPassed**: 9
- **notObserved**: 1
- **mapped**: 8
- **weakMapped**: 8
- **ignored**: 7
- **unsupported**: 0
- **experimental**: 2

This report inventories Codex app-server methods, item types, and server-initiated requests used by the Bridge timeline mapping layer. Evidence columns are independent: a surface can be mapped and synthetic-passed while still not observed in real protocol smoke.

## Methods

| Surface | Status | Mapped | Synthetic | Real Smoke | Observation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `account/rateLimits/updated` | ignored | no | no | no | observed-telemetry | Observed real app-server telemetry/infra method; kept out of normal user timeline. |
| `initialize` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `initialized` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/agentMessage/delta` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/argument/delta` | weak-mapped | yes | no | no | not-real-smoked | Compatibility/status mapping; not all native fields have rich UI. |
| `item/commandExecution/outputDelta` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `item/completed` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `item/fileChange/outputDelta` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `item/plan/delta` | experimental | yes | no | no | not-real-smoked | Supported behind Codex experimental protocol capability. |
| `item/reasoning/summaryTextDelta` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/reasoning/textDelta` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/started` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `item/text/delta` | weak-mapped | yes | no | no | not-real-smoked | Compatibility/status mapping; not all native fields have rich UI. |
| `item/thinking/delta` | weak-mapped | yes | no | no | not-real-smoked | Compatibility/status mapping; not all native fields have rich UI. |
| `mcpServer/startupStatus/updated` | ignored | no | no | no | observed-telemetry | Observed real app-server telemetry/infra method; kept out of normal user timeline. |
| `remoteControl/status/changed` | ignored | no | no | no | observed-telemetry | Observed real app-server telemetry/infra method; kept out of normal user timeline. |
| `serverRequest/resolved` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `thread/resume` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `thread/start` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `thread/started` | mapped | no | no | no | observed-lifecycle | Observed lifecycle notification; useful for diagnostics but not a timeline item. |
| `thread/status/changed` | ignored | no | no | no | observed-telemetry | Observed real app-server telemetry/infra method; kept out of normal user timeline. |
| `thread/tokenUsage/updated` | ignored | no | no | no | observed-telemetry | Observed real app-server telemetry/infra method; kept out of normal user timeline. |
| `turn/completed` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `turn/diff/updated` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `turn/failed` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `turn/start` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `turn/started` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |

## Item Types

| Surface | Status | Mapped | Synthetic | Real Smoke | Observation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `userMessage` | ignored | no | no | no | not-timeline | User prompt is input context, not an assistant turn timeline node. |
| `agentMessage` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `plan` | experimental | yes | no | no | not-real-smoked | Supported behind Codex experimental protocol capability. |
| `reasoning` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `commandExecution` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `fileChange` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `mcpToolCall` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `dynamicToolCall` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `webSearch` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `imageView` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `enteredReviewMode` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `exitedReviewMode` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `contextCompaction` | synthetic-passed | yes | yes | no | not-real-smoked | Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed. |
| `message` | weak-mapped | yes | no | no | legacy | Legacy compatibility surface; not part of the native Codex main gate. |
| `tool_call` | weak-mapped | yes | no | no | legacy | Legacy compatibility surface; not part of the native Codex main gate. |
| `tool_result` | weak-mapped | yes | no | no | legacy | Legacy compatibility surface; not part of the native Codex main gate. |
| `thinking` | weak-mapped | yes | no | no | legacy | Legacy compatibility surface; not part of the native Codex main gate. |
| `approval_request` | ignored | no | no | no | not-timeline | Legacy/fixture-only surface; not a main protocol source. |
| `file_change` | weak-mapped | yes | no | no | legacy | Legacy compatibility surface; not part of the native Codex main gate. |

## Server Requests

| Surface | Status | Mapped | Synthetic | Real Smoke | Observation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `item/commandExecution/requestApproval` | real-smoke-passed | yes | yes | yes | observed | Request surfaced, response returned, and matching timeline item resolved in real protocol smoke. |
| `item/fileChange/requestApproval` | real-smoke-passed | yes | yes | yes | observed | Request surfaced, response returned, and matching timeline item resolved in real protocol smoke. |
| `item/tool/requestUserInput` | not-observed | yes | yes | no | not-observed | Synthetic mapping passed, but the real managed app-server smoke did not trigger this request. It is not counted as real-smoke-passed. |
