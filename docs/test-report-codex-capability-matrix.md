# Codex Capability Matrix

- **generatedAt**: 2026-07-06T12:39:19.789Z
- **testedCodeCommitSha**: 9e1042d27f3760831f371df99cf4c98efa52a2eb
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
- **unknownMethodCount**: 7
- **unknownItemTypeCount**: 0
- **observedShapeNoteCount**: 2
- **realProtocolSmokePassed**: false
- **realSmokePassed**: 13
- **syntheticPassed**: 9
- **notObserved**: 1
- **mapped**: 7
- **weakMapped**: 8
- **ignored**: 2
- **unsupported**: 0
- **experimental**: 2

This report inventories Codex app-server methods, item types, and server-initiated requests used by the Bridge timeline mapping layer. Evidence columns are independent: a surface can be mapped and synthetic-passed while still not observed in real protocol smoke.

## Methods

| Surface | Status | Mapped | Synthetic | Real Smoke | Observation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
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
| `serverRequest/resolved` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `thread/resume` | mapped | yes | no | no | not-real-smoked | Preserves sourceRef and maps into TurnTimelineNode. |
| `thread/start` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
| `turn/completed` | real-smoke-passed | yes | yes | yes | observed | Verified against the managed Codex app-server real protocol smoke. |
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
