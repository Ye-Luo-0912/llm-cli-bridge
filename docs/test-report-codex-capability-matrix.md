# Codex Capability Matrix

- **generatedAt**: 2026-07-06T06:52:51.484Z
- **testedCodeCommitSha**: e44badc3236dd17ffb51c01ba9e8fee6c8349ff4
- **schemaManifest**: `src/runtime/providers/codex-app-server/schema/manifest.json`
- **schemaSource**: `src/runtime/providers/codex-app-server/schema/index.ts`
- **schemaVersion**: 0.3.0-official-aligned
- **schemaSourceMode**: fixture
- **experimentalApiDefault**: false
- **mapped**: 28
- **weakMapped**: 11
- **ignored**: 1
- **unsupported**: 0
- **experimental**: 2

This report inventories Codex app-server methods, item types, and server-initiated requests used by the Bridge timeline mapping layer.

## Methods

| Surface | Status | Notes |
| --- | --- | --- |
| `initialize` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `initialized` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/agentMessage/delta` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/argument/delta` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `item/commandExecution/outputDelta` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/completed` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/fileChange/outputDelta` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/plan/delta` | experimental | Supported behind Codex experimental protocol capability. |
| `item/reasoning/summaryTextDelta` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/reasoning/textDelta` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/started` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/text/delta` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `item/thinking/delta` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `serverRequest/resolved` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `thread/resume` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `thread/start` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `turn/completed` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `turn/failed` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `turn/start` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `turn/started` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |

## Item Types

| Surface | Status | Notes |
| --- | --- | --- |
| `userMessage` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `agentMessage` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `plan` | experimental | Supported behind Codex experimental protocol capability. |
| `reasoning` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `commandExecution` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `fileChange` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `mcpToolCall` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `dynamicToolCall` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `webSearch` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `imageView` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `enteredReviewMode` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `exitedReviewMode` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `contextCompaction` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `message` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `tool_call` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `tool_result` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `thinking` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |
| `approval_request` | ignored | Legacy/fixture-only surface; not a main protocol source. |
| `file_change` | weak-mapped | Compatibility/status mapping; not all native fields have rich UI. |

## Server Requests

| Surface | Status | Notes |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/fileChange/requestApproval` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
| `item/tool/requestUserInput` | mapped | Preserves sourceRef and maps into TurnTimelineNode. |
