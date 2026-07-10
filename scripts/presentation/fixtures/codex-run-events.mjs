// Shared event fixtures for CodexRunViewModel presentation semantic tests.

export const DEFAULT_CODEX_RUN_VIEW_OPTS = {
  providerLabel: "codex-managed-app-server",
  modelLabel: "gpt-codex",
  cwd: "D:/repo",
  developerMode: false,
};

/** Build a normalized provider event for buildAssistantTurnViewFromEvents. */
export function mkCodexRunEvent(payload, sequence = 1, overrides = {}) {
  return {
    providerId: "codex-app-server",
    timestamp: "2026-07-02T00:00:00.000Z",
    sourceRef: {
      threadId: "thread-v17g",
      turnId: "turn-v17g",
      itemId: payload.callId || payload.requestId || `item-${sequence}`,
      method: payload.kind,
      sequence,
    },
    payload,
    ...overrides,
  };
}
