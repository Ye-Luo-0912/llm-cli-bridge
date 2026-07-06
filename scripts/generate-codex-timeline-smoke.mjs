// LLM CLI Bridge — Codex timeline smoke report.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-codex-timeline-smoke.md");
const mapperBundle = join(PROJECT_ROOT, ".test-codex-timeline-mapper-temp.mjs");
const viewBundle = join(PROJECT_ROOT, ".test-codex-timeline-view-temp.mjs");
const displayBundle = join(PROJECT_ROOT, ".test-codex-timeline-display-temp.mjs");

function gitSha() {
  return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
}

function add(results, name, ok, detail = "") {
  results.push({ name, status: ok ? "pass" : "fail", detail });
}

function manualEvent(payload, sourceRef) {
  return {
    providerId: "codex-app-server",
    timestamp: new Date().toISOString(),
    sourceRef,
    payload,
  };
}

function sourceRef(itemId, method, sequence, serverRequestId) {
  return {
    threadId: "thread-timeline",
    turnId: "turn-timeline",
    itemId,
    method,
    sequence,
    serverRequestId,
  };
}

try {
  const esbuild = (await import("esbuild")).default;
  await esbuild.build({
    entryPoints: [join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "codexAppServerEventMapper.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: mapperBundle,
  });
  await esbuild.build({
    entryPoints: [join(PROJECT_ROOT, "src", "runtime", "core", "assistantTurnView.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: viewBundle,
  });
  await esbuild.build({
    entryPoints: [join(PROJECT_ROOT, "src", "runtime", "core", "agentRunDisplayModel.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: displayBundle,
  });

  const { CodexAppServerEventMapper } = await import(pathToFileURL(mapperBundle).href);
  const { AssistantTurnViewBuilder } = await import(pathToFileURL(viewBundle).href);
  const { buildAgentRunDisplayModel } = await import(pathToFileURL(displayBundle).href);

  const mapper = new CodexAppServerEventMapper("codex-app-server", false);
  const builder = new AssistantTurnViewBuilder("turn-timeline", "codex-app-server", new Date().toISOString());

  builder.ingest(mapper.mapItemStarted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "commandExecution", id: "cmd-a", command: ["npm", "test"], cwd: "/repo" },
  }));
  builder.ingest(mapper.mapItemStarted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "commandExecution", id: "cmd-b", command: ["npm", "run", "build"], cwd: "/repo/pkg" },
  }));
  builder.ingest(manualEvent({
    kind: "approval_request",
    requestId: "codex-req-101",
    toolName: "Bash",
    description: "Run tests",
    riskLevel: "high",
    inputSummary: "npm test",
  }, sourceRef("cmd-a", "item/commandExecution/requestApproval", 100, "codex-req-101")));
  builder.ingest(manualEvent({
    kind: "approval_request",
    requestId: "codex-req-102",
    toolName: "Bash",
    description: "Run build",
    riskLevel: "high",
    inputSummary: "npm run build",
  }, sourceRef("cmd-b", "item/commandExecution/requestApproval", 101, "codex-req-102")));
  builder.ingest(mapper.mapServerRequestResolved({
    requestId: 101, threadId: "thread-timeline", turnId: "turn-timeline", itemId: "cmd-a", decision: "accept",
  }));
  builder.ingest(mapper.mapItemCommandExecutionOutputDelta({
    threadId: "thread-timeline", turnId: "turn-timeline", itemId: "cmd-a", delta: "cmd-a-out\n",
  }));
  builder.ingest(mapper.mapItemCommandExecutionOutputDelta({
    threadId: "thread-timeline", turnId: "turn-timeline", itemId: "cmd-b", delta: "cmd-b-out\n",
  }));
  builder.ingest(mapper.mapItemCompleted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "commandExecution", id: "cmd-a", command: ["npm", "test"], cwd: "/repo", status: "completed", aggregatedOutput: "cmd-a-out\n", exitCode: 0, durationMs: 10 },
  }));
  builder.ingest(mapper.mapItemCompleted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "commandExecution", id: "cmd-b", command: ["npm", "run", "build"], cwd: "/repo/pkg", status: "completed", aggregatedOutput: "cmd-b-out\n", exitCode: 0, durationMs: 20 },
  }));

  builder.ingest(mapper.mapItemStarted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "fileChange", id: "fc-1", changes: [
      { path: "src/a.ts", kind: "modify", diff: "-old\n+new\n" },
      { path: "src/b.ts", kind: "create", diff: "+created\n" },
    ] },
  }));
  builder.ingest(manualEvent({
    kind: "approval_request",
    requestId: "codex-req-201",
    toolName: "Write",
    description: "Apply file changes",
    riskLevel: "medium",
    inputSummary: "src/a.ts, src/b.ts",
  }, sourceRef("fc-1", "item/fileChange/requestApproval", 102, "codex-req-201")));
  builder.ingest(mapper.mapServerRequestResolved({
    requestId: 201, threadId: "thread-timeline", turnId: "turn-timeline", itemId: "fc-1", decision: "accept",
  }));
  builder.ingest(mapper.mapItemCompleted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "fileChange", id: "fc-1", status: "completed", changes: [
      { path: "src/a.ts", kind: "modify", diff: "-old\n+new\n" },
      { path: "src/b.ts", kind: "create", diff: "+created\n" },
    ] },
  }, 0));
  builder.ingest(mapper.mapItemCompleted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "fileChange", id: "fc-1", status: "completed", changes: [
      { path: "src/a.ts", kind: "modify", diff: "-old\n+new\n" },
      { path: "src/b.ts", kind: "create", diff: "+created\n" },
    ] },
  }, 1));

  builder.ingest(mapper.mapItemStarted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "mcpToolCall", id: "mcp-1", server: "github", tool: "listIssues", arguments: { state: "open" } },
  }));
  builder.ingest(mapper.mapItemCompleted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "mcpToolCall", id: "mcp-1", server: "github", tool: "listIssues", status: "completed", result: { total: 2, ok: true } },
  }));
  builder.ingest(mapper.mapItemStarted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "dynamicToolCall", id: "dyn-1", tool: "webSearch", arguments: { q: "codex" } },
  }));
  builder.ingest(mapper.mapItemCompleted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "dynamicToolCall", id: "dyn-1", tool: "webSearch", status: "completed", success: true, contentItems: [{ type: "text", text: "result" }] },
  }));
  builder.ingest(manualEvent({
    kind: "user_input_request",
    requestId: "codex-req-301",
    toolName: "request_user_input",
    prompt: "Choose one",
  }, sourceRef("input-1", "item/tool/requestUserInput", 103, "codex-req-301")));
  builder.ingest(manualEvent({
    kind: "user_input_resolved",
    requestId: "codex-req-301",
    response: { type: "submit", value: "src/a.ts" },
    source: "user",
  }, sourceRef("input-1", "user-input-resolved", 104, "codex-req-301")));
  builder.ingest(mapper.mapItemStarted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "enteredReviewMode", id: "review-1", review: "reviewing" },
  }));
  builder.ingest(mapper.mapItemCompleted({
    threadId: "thread-timeline", turnId: "turn-timeline",
    item: { type: "contextCompaction", id: "compact-1" },
  }));
  builder.ingest(mapper.mapTurnCompleted({ threadId: "thread-timeline", turnId: "turn-timeline", finalText: "done" }));

  const view = builder.toView();
  const normalModel = buildAgentRunDisplayModel(view, { developerMode: false, isRunning: false });
  const devModel = buildAgentRunDisplayModel(view, { developerMode: true, isRunning: false });
  const nodes = view.turnTimeline;
  const cmdA = nodes.find((n) => n.id === "cmd-a");
  const cmdB = nodes.find((n) => n.id === "cmd-b");
  const fileChange = nodes.find((n) => n.id === "fc-1");
  const mcp = nodes.find((n) => n.id === "mcp-1");
  const dynamic = nodes.find((n) => n.id === "dyn-1");
  const userInput = nodes.find((n) => n.id === "input-1");
  const devCommandCard = devModel.timelineCards.find((c) => c.kind === "tool-call" && c.sourceRef?.itemId === "cmd-a");
  const normalCommandCard = normalModel.timelineCards.find((c) =>
    c.kind === "tool-call"
      && Array.isArray(c.command)
      && c.command.join(" ") === "npm test");
  const fileCard = devModel.timelineCards.find((c) => c.kind === "file-change");
  const mcpCard = devModel.timelineCards.find((c) => c.kind === "tool-call" && c.label === "github.listIssues");
  const dynamicCard = devModel.timelineCards.find((c) => c.kind === "tool-call" && c.label === "webSearch");

  const results = [];
  add(results, "commandExecution output by itemId", cmdA?.stdout?.includes("cmd-a-out") && !cmdA?.stdout?.includes("cmd-b-out"), `cmdA.stdout=${JSON.stringify(cmdA?.stdout)}`);
  add(results, "parallel tools no output cross-talk", cmdB?.stdout?.includes("cmd-b-out") && !cmdB?.stdout?.includes("cmd-a-out"), `cmdB.stdout=${JSON.stringify(cmdB?.stdout)}`);
  add(results, "fileChange diff card", fileCard?.diff?.includes("+new") && fileCard?.changes?.length === 2 && fileChange?.approvalStatus === "approved", `changes=${fileCard?.changes?.length}`);
  add(results, "mcpToolCall structured result", mcp?.result?.total === 2 && mcpCard?.structuredResult?.ok === true, `result=${JSON.stringify(mcp?.result)}`);
  add(results, "dynamicToolCall contentItems", Array.isArray(dynamic?.contentItems) && Array.isArray(dynamicCard?.contentItems), `items=${JSON.stringify(dynamic?.contentItems)}`);
  add(results, "approval request/resolved", cmdA?.approvalStatus === "approved" && cmdB?.approvalStatus === "pending" && fileChange?.approvalStatus === "approved", `cmdA=${cmdA?.approvalStatus} cmdB=${cmdB?.approvalStatus} file=${fileChange?.approvalStatus}`);
  add(results, "user input request/resolved", userInput?.status === "resolved" && userInput?.result?.type === "submit", `status=${userInput?.status}`);
  add(results, "review/contextCompaction/status nodes", nodes.some((n) => n.kind === "reviewMode") && nodes.some((n) => n.kind === "contextCompaction"), `nodes=${nodes.map((n) => n.kind).join(",")}`);
  add(results, "AssistantTurnView timeline does not use recent running tool inference", normalModel.timelineCards.length === nodes.length, `cards=${normalModel.timelineCards.length} nodes=${nodes.length}`);
  add(results, "normal user verbose output collapsed", normalCommandCard?.defaultExpanded === false, `defaultExpanded=${normalCommandCard?.defaultExpanded}`);
  add(results, "developer mode sourceRef visible", !!devCommandCard?.sourceRef?.threadId && !normalCommandCard?.sourceRef, `devSource=${!!devCommandCard?.sourceRef} normalSource=${!!normalCommandCard?.sourceRef}`);

  const failed = results.filter((r) => r.status !== "pass");
  const lines = [
    "# Codex Timeline Smoke",
    "",
    "- **generatedAt**: " + new Date().toISOString(),
    "- **testedCodeCommitSha**: " + gitSha(),
    "- **timelineSmokeStatus**: " + (failed.length === 0 ? "pass" : "fail"),
    "- **nodeCount**: " + nodes.length,
    "- **timelineCardCount**: " + devModel.timelineCards.length,
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...results.map((r) => `| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
    "",
  ];

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`Wrote ${OUT}`);
  if (failed.length > 0) process.exit(1);
} finally {
  for (const file of [mapperBundle, viewBundle, displayBundle]) {
    try { rmSync(file, { force: true }); } catch {}
  }
}
