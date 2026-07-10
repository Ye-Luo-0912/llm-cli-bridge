// V17-G CodexRunViewModel presentation semantic tests (event-sequence → view model).
// Agent B owned — import from run-tests.mjs or run standalone via run-presentation-tests.mjs.

import { DEFAULT_CODEX_RUN_VIEW_OPTS, mkCodexRunEvent } from "./fixtures/codex-run-events.mjs";

/**
 * @param {{
 *   addTest: (name: string, status: "pass"|"fail"|"skip"|"manual", detail?: string) => void,
 *   buildAgentRunDisplayModel: Function,
 *   buildCodexRunViewModel: Function,
 *   buildAssistantTurnViewFromEvents: Function,
 * }} ctx
 */
export function runCodexRunViewModelSemanticTests(ctx) {
  const { addTest, buildAgentRunDisplayModel, buildCodexRunViewModel, buildAssistantTurnViewFromEvents } = ctx;

  const events = [
    mkCodexRunEvent({ kind: "thinking", text: "Plan the edit" }, 1),
    mkCodexRunEvent({ kind: "tool_start", toolName: "Bash", toolInput: JSON.stringify({ command: "echo V17G", cwd: "D:/repo" }), callId: "cmd-v17g" }, 2),
    mkCodexRunEvent({ kind: "tool_result", callId: "cmd-v17g", toolName: "Bash", output: "V17G\n", isError: false }, 3),
    mkCodexRunEvent({ kind: "file_change", action: "modify", path: "D:/repo/notes/run.md", diff: "--- a/notes/run.md\n+++ b/notes/run.md\n@@\n-old\n+new" }, 4),
    mkCodexRunEvent({ kind: "approval_request", requestId: "ap-v17g", toolName: "Bash", description: "Run command", inputSummary: "echo V17G", riskLevel: "medium" }, 5),
  ];
  const view = buildAssistantTurnViewFromEvents("turn-v17g", "codex-app-server", events, "2026-07-02T00:00:00.000Z");
  const model = buildAgentRunDisplayModel(view, { developerMode: false, isRunning: true });
  const run = buildCodexRunViewModel(model, view, {
    status: "running",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const devModel = buildAgentRunDisplayModel(view, {
    developerMode: true,
    isRunning: true,
    debug: { rawProviderEvents: [{ method: "item/commandExecution/outputDelta" }] },
  });
  const devRun = buildCodexRunViewModel(devModel, view, {
    status: "running",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
    developerMode: true,
  });
  const commandStep = run.stepGroups.find((step) => step.kind === "command");
  const change = run.changeGroups[0];
  const feedKinds = run.feedItems.map((item) => item.kind).join(">");
  const thinkingFeed = run.feedItems.find((item) => item.kind === "thinking");
  const commandFeed = run.feedItems.find((item) => item.kind === "command");
  const fileFeed = run.feedItems.find((item) => item.kind === "file");
  const ok = run.runHeader.statusKind === "blocked"
    && run.currentActivity.label === "Waiting approval"
    && run.runHeader.commandCount === 1
    && run.runHeader.fileChangeCount === 1
    && run.runHeader.approvalCount >= 1
    && run.approvalGates.length === 1
    && commandStep?.stdout?.includes("V17G")
    && change?.relativePath === "notes/run.md"
    && change.diffSummary === "+1 -1"
    && feedKinds.includes("thinking>command")
    && /Plan the edit/.test(thinkingFeed?.summary || "")
    && !!commandFeed?.step?.stdout?.includes("V17G")
    && fileFeed?.change?.relativePath === "notes/run.md"
    && run.debugPanel === undefined
    && devRun.debugPanel?.rawProviderEvents?.length === 1;
  addTest("V17-G CodexRunViewModel: runHeader/currentActivity/feed/changes/steps/approval/debugPanel 分层",
    ok ? "pass" : "fail",
    `status=${run.runHeader.statusKind} activity=${run.currentActivity.label} commands=${run.runHeader.commandCount} changes=${run.runHeader.fileChangeCount} approvals=${run.approvalGates.length} feed=${feedKinds} thinkingSummary=${thinkingFeed?.summary || ""} stepStdout=${!!commandStep?.stdout} relativePath=${change?.relativePath} debug=${!!run.debugPanel}/${!!devRun.debugPanel}`);

  const finalOnlyEvents = [
    mkCodexRunEvent({ kind: "thinking", text: "Plan the edit" }, 1),
    mkCodexRunEvent({ kind: "completed", text: "done", durationMs: 1200 }, 2),
  ];
  const finalOnlyView = buildAssistantTurnViewFromEvents("turn-v17g-final", "codex-app-server", finalOnlyEvents, "2026-07-02T00:00:00.000Z");
  const finalOnlyModel = buildAgentRunDisplayModel(finalOnlyView, { developerMode: false });
  const finalOnlyRun = buildCodexRunViewModel(finalOnlyModel, finalOnlyView, {
    status: "completed",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const finalSeparatedOk = finalOnlyRun.finalAnswer === "done"
    && finalOnlyRun.feedItems.every((item) => item.kind !== "assistant");
  addTest("V17-G CodexRunViewModel: 无 agent message 卡片时 final answer 不虚构进过程 feed",
    finalSeparatedOk ? "pass" : "fail",
    `final=${JSON.stringify(finalOnlyRun.finalAnswer)} feedKinds=${finalOnlyRun.feedItems.map((item) => item.kind).join(">")}`);

  const interleavedEvents = [
    mkCodexRunEvent({ kind: "thinking", text: "" }, 1),
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "先读配置，再检查 runtime 状态。", partial: false }, 2),
    mkCodexRunEvent({ kind: "tool_start", toolName: "Bash", toolInput: JSON.stringify({ command: "Get-Content settings.json", cwd: "D:/repo" }), callId: "cmd-v17g-interleaved-1" }, 3),
    mkCodexRunEvent({ kind: "tool_result", callId: "cmd-v17g-interleaved-1", toolName: "Bash", output: "{\\\"ok\\\":true}\\n", isError: false }, 4),
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "先读配置，再检查 runtime 状态。配置没问题，接着创建 smoke 文件。", partial: false }, 5),
    mkCodexRunEvent({ kind: "file_change", action: "create", path: "D:/repo/_llm_bridge_smoke/run.md", diff: "--- /dev/null\n+++ b/_llm_bridge_smoke/run.md\n@@\n+done" }, 6),
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "先读配置，再检查 runtime 状态。配置没问题，接着创建 smoke 文件。done", partial: false }, 7),
    mkCodexRunEvent({ kind: "completed", text: "先读配置，再检查 runtime 状态。配置没问题，接着创建 smoke 文件。done", durationMs: 1400 }, 8),
  ];
  const interleavedView = buildAssistantTurnViewFromEvents("turn-v17g-interleaved", "codex-app-server", interleavedEvents, "2026-07-02T00:00:00.000Z");
  const interleavedModel = buildAgentRunDisplayModel(interleavedView, { developerMode: false });
  const interleavedRun = buildCodexRunViewModel(interleavedModel, interleavedView, {
    status: "completed",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const interleavedFeedKinds = interleavedRun.feedItems.map((item) => item.kind).join(">");
  const assistantFeed = interleavedRun.feedItems.filter((item) => item.kind === "assistant");
  const assistantFeedTexts = assistantFeed.map((item) => item.summary || "").join(" | ");
  const interleavedOk = interleavedRun.finalAnswer === "done"
    && interleavedFeedKinds === "assistant>command>assistant>file>assistant"
    && assistantFeed.length === 3
    && assistantFeed[0].answerRole === "process"
    && assistantFeed[1].answerRole === "process"
    && assistantFeed[2].answerRole === "candidate"
    && assistantFeed[0].label === "说明"
    && assistantFeed[2].label === "Answer"
    && assistantFeedTexts.includes("先读配置，再检查 runtime 状态。")
    && assistantFeedTexts.includes("配置没问题，接着创建 smoke 文件。")
    && (assistantFeed[2].summary || "").includes("done");
  addTest("V17-G CodexRunViewModel: 单瀑布流 — 中间过程说明 + 终端 candidate 同在 feed（无独立 Answer 副本）",
    interleavedOk ? "pass" : "fail",
    `final=${JSON.stringify(interleavedRun.finalAnswer)} feed=${interleavedFeedKinds} assistant=${assistantFeedTexts}`);

  // --- 行为 1: 单条 assistant message → feed 内唯一 candidate ---
  const singleEvents = [
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "只回答这一句。", partial: false }, 1),
    mkCodexRunEvent({ kind: "completed", text: "只回答这一句。", durationMs: 200 }, 2),
  ];
  const singleView = buildAssistantTurnViewFromEvents("turn-v17g-single", "codex-app-server", singleEvents, "2026-07-02T00:00:00.000Z");
  const singleModel = buildAgentRunDisplayModel(singleView, { developerMode: false });
  const singleRun = buildCodexRunViewModel(singleModel, singleView, {
    status: "completed",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const singleAssistants = singleRun.feedItems.filter((item) => item.kind === "assistant");
  const singleOk = singleRun.finalAnswer.includes("只回答这一句")
    && singleAssistants.length === 1
    && singleAssistants[0].answerRole === "candidate"
    && !singleRun.feedItems.some((item) => item.kind === "thinking");
  addTest("V17-G CodexRunViewModel: 单条 assistant message → feed 内唯一 candidate 节点",
    singleOk ? "pass" : "fail",
    `final=${JSON.stringify(singleRun.finalAnswer)} feed=${singleRun.feedItems.map((i) => i.kind).join(">")}`);

  // --- 行为 2: assistant → tool → assistant：前段过程说明，末段 candidate ---
  const a2t2aEvents = [
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "我先跑一条命令。", partial: false }, 1),
    mkCodexRunEvent({ kind: "tool_start", toolName: "Bash", toolInput: JSON.stringify({ command: "echo hi", cwd: "D:/repo" }), callId: "cmd-a2t2a" }, 2),
    mkCodexRunEvent({ kind: "tool_result", callId: "cmd-a2t2a", toolName: "Bash", output: "hi\n", isError: false }, 3),
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "我先跑一条命令。命令完成，结果是 hi。", partial: false }, 4),
    mkCodexRunEvent({ kind: "completed", text: "我先跑一条命令。命令完成，结果是 hi。", durationMs: 400 }, 5),
  ];
  const a2t2aView = buildAssistantTurnViewFromEvents("turn-v17g-a2t2a", "codex-app-server", a2t2aEvents, "2026-07-02T00:00:00.000Z");
  const a2t2aModel = buildAgentRunDisplayModel(a2t2aView, { developerMode: false });
  const a2t2aRun = buildCodexRunViewModel(a2t2aModel, a2t2aView, {
    status: "completed",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const a2t2aFeed = a2t2aRun.feedItems.map((item) => item.kind).join(">");
  const a2t2aAssistants = a2t2aRun.feedItems.filter((item) => item.kind === "assistant");
  const a2t2aOk = a2t2aFeed === "assistant>command>assistant"
    && a2t2aAssistants.length === 2
    && a2t2aAssistants[0].answerRole === "process"
    && a2t2aAssistants[0].label === "说明"
    && a2t2aAssistants[1].answerRole === "candidate"
    && (a2t2aAssistants[0].summary || "").includes("我先跑一条命令")
    && a2t2aRun.finalAnswer.includes("命令完成，结果是 hi")
    && (a2t2aAssistants[1].summary || "").includes("命令完成，结果是 hi");
  addTest("V17-G CodexRunViewModel: assistant→tool→assistant → 前段过程说明，末段 candidate 同瀑布流",
    a2t2aOk ? "pass" : "fail",
    `final=${JSON.stringify(a2t2aRun.finalAnswer)} feed=${a2t2aFeed}`);

  // --- 行为 3: reasoning → tool → answer：Thinking 仅真 reasoning，answer 为 candidate ---
  const r2t2aEvents = [
    mkCodexRunEvent({ kind: "thinking", text: "先检查目录再回答。" }, 1),
    mkCodexRunEvent({ kind: "tool_start", toolName: "Bash", toolInput: JSON.stringify({ command: "ls", cwd: "D:/repo" }), callId: "cmd-r2t2a" }, 2),
    mkCodexRunEvent({ kind: "tool_result", callId: "cmd-r2t2a", toolName: "Bash", output: "a.md\n", isError: false }, 3),
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "目录里有 a.md。", partial: false }, 4),
    mkCodexRunEvent({ kind: "completed", text: "目录里有 a.md。", durationMs: 300 }, 5),
  ];
  const r2t2aView = buildAssistantTurnViewFromEvents("turn-v17g-r2t2a", "codex-app-server", r2t2aEvents, "2026-07-02T00:00:00.000Z");
  const r2t2aModel = buildAgentRunDisplayModel(r2t2aView, { developerMode: false });
  const r2t2aRun = buildCodexRunViewModel(r2t2aModel, r2t2aView, {
    status: "completed",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const r2t2aFeed = r2t2aRun.feedItems.map((item) => item.kind).join(">");
  const r2t2aThinking = r2t2aRun.feedItems.filter((item) => item.kind === "thinking");
  const r2t2aAssistants = r2t2aRun.feedItems.filter((item) => item.kind === "assistant");
  const r2t2aOk = r2t2aFeed === "thinking>command>assistant"
    && r2t2aThinking.length === 1
    && /先检查目录再回答/.test(r2t2aThinking[0].summary || "")
    && r2t2aAssistants.length === 1
    && r2t2aAssistants[0].answerRole === "candidate"
    && r2t2aRun.finalAnswer.includes("目录里有 a.md");
  addTest("V17-G CodexRunViewModel: reasoning→tool→answer → Thinking 仅真 reasoning，answer 为 candidate",
    r2t2aOk ? "pass" : "fail",
    `final=${JSON.stringify(r2t2aRun.finalAnswer)} feed=${r2t2aFeed}`);

  // --- 行为 4: 候选可移动：运行中 candidate 在 feed；随后出现工具则降为 process（单所有者）---
  const moveMidEvents = [
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "准备改文件。", partial: true }, 1),
  ];
  const moveMidView = buildAssistantTurnViewFromEvents("turn-v17g-move", "codex-app-server", moveMidEvents, "2026-07-02T00:00:00.000Z");
  const moveMidModel = buildAgentRunDisplayModel(moveMidView, { developerMode: false, isRunning: true });
  const moveMidRun = buildCodexRunViewModel(moveMidModel, moveMidView, {
    status: "running",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const moveMidAssistants = moveMidRun.feedItems.filter((item) => item.kind === "assistant");
  const moveMidOk = moveMidRun.finalAnswer.includes("准备改文件")
    && moveMidAssistants.length === 1
    && moveMidAssistants[0].answerRole === "candidate";
  const moveAfterEvents = [
    mkCodexRunEvent({ kind: "message", role: "assistant", text: "准备改文件。", partial: false }, 1),
    mkCodexRunEvent({ kind: "tool_start", toolName: "Bash", toolInput: JSON.stringify({ command: "echo x", cwd: "D:/repo" }), callId: "cmd-move" }, 2),
  ];
  const moveAfterView = buildAssistantTurnViewFromEvents("turn-v17g-move", "codex-app-server", moveAfterEvents, "2026-07-02T00:00:00.000Z");
  const moveAfterModel = buildAgentRunDisplayModel(moveAfterView, { developerMode: false, isRunning: true });
  const moveAfterRun = buildCodexRunViewModel(moveAfterModel, moveAfterView, {
    status: "running",
    ...DEFAULT_CODEX_RUN_VIEW_OPTS,
  });
  const moveAfterAssistants = moveAfterRun.feedItems.filter((item) => item.kind === "assistant");
  const moveAfterOk = moveAfterRun.finalAnswer === ""
    && moveAfterAssistants.length === 1
    && moveAfterAssistants[0].answerRole === "process"
    && (moveAfterAssistants[0].summary || "").includes("准备改文件");
  addTest("V17-G CodexRunViewModel: 候选回答遇后续工具时从 candidate 降为 process（单所有者）",
    moveMidOk && moveAfterOk ? "pass" : "fail",
    `midFinal=${JSON.stringify(moveMidRun.finalAnswer)} afterFinal=${JSON.stringify(moveAfterRun.finalAnswer)} afterFeed=${moveAfterRun.feedItems.map((i) => i.kind).join(">")}`);
}
