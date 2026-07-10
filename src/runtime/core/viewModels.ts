// LLM CLI Bridge — Runtime view-model public surface (UI split entry)
//
// Import from here for presentation-layer types/builders without pulling
// provider implementations (bridgeSession, codex-app-server, etc.).
//
// Pipeline:
//   NormalizedRuntimeEvent[] → AssistantTurnViewBuilder → AssistantTurnView
//   AssistantTurnView → buildAgentRunDisplayModel → AgentRunDisplayModel
//   AgentRunDisplayModel + AssistantTurnView → buildCodexRunViewModel → CodexRunViewModel

export {
  AssistantTurnViewBuilder,
  buildAssistantTurnViewFromEvents,
  approvalResponseToLegacyChoice,
} from "./assistantTurnView";

export {
  buildAgentRunDisplayModel,
  inferFinalAnswerDisposition,
  explainAutoApprovalSource,
  redactDebugView,
  toolDisplayLabel,
  approvalDisplayLabel,
  toolToActivity,
  getToolIconCategory,
  getPhaseIconName,
  EMPTY_CARDS,
  type AgentRunDisplayModel,
  type AgentRunCard,
  type AgentRunCardKind,
  type AgentRunCardStatus,
  type AgentRunDebugView,
  type ApprovalCard,
  type BuildDisplayModelOptions,
  type FinalAnswerDisposition,
  type PermissionSnapshot,
  type ThinkingCard,
  type ToolCallCard,
  type FileChangeCard,
  type UserInputCard,
} from "./agentRunDisplayModel";

export {
  buildCodexRunViewModel,
  formatCodexRunDuration,
  formatCodexRunValue,
  type CodexRunViewModel,
  type CodexRunHeader,
  type CodexRunFeedItem,
  type CodexRunStepGroup,
  type CodexRunChangeGroup,
  type CodexRunApprovalGate,
  type CodexRunDiagnosticsGroup,
  type CodexRunCurrentActivity,
  type CodexRunStatusKind,
  type BuildCodexRunViewModelOptions,
} from "./codexRunViewModel";

export type {
  AssistantTurnView,
  ApprovalResponse,
  ApprovalSegment,
  NativeSessionRef,
  NormalizedRuntimeEvent,
  ProviderId,
  RuntimeSourceRef,
  TurnTimelineNode,
  UserInputQuestion,
  UserInputResponse,
} from "./types";

export { isUserInputApprovalTool } from "./approvalSemantics";
