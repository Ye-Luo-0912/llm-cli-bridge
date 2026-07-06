#!/usr/bin/env node
// LLM CLI Bridge — V17-F5 real Codex managed protocol capability smoke.

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const REPORT_PATH = join(DOCS_DIR, "test-report-codex-real-protocol-capability.md");
const MANIFEST_PATH = join(PROJECT_ROOT, "src", "runtime", "providers", "codex-managed-app-server", "runtime-manifest.json");
const SMOKE_VAULT_DIR = join(PROJECT_ROOT, ".tmp", "codex-real-protocol-smoke-vault");
const mapperBundle = join(PROJECT_ROOT, ".test-codex-real-protocol-mapper-temp.mjs");
const viewBundle = join(PROJECT_ROOT, ".test-codex-real-protocol-view-temp.mjs");
const displayBundle = join(PROJECT_ROOT, ".test-codex-real-protocol-display-temp.mjs");

const KNOWN_PROTOCOL_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "turn/failed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/plan/delta",
  "serverRequest/resolved",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "error",
]);

const KNOWN_ITEM_TYPES = new Set([
  "agentMessage",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageView",
  "enteredReviewMode",
  "exitedReviewMode",
  "contextCompaction",
  "plan",
  "userMessage",
  "approval_request",
  "message",
  "tool_call",
  "tool_result",
  "thinking",
  "file_change",
]);

const OBSERVED_METHOD_CLASSIFICATION = {
  "account/rateLimits/updated": "telemetry/status",
  "thread/tokenUsage/updated": "telemetry/status",
  "thread/status/changed": "telemetry/status",
  "thread/started": "lifecycle",
  "turn/diff/updated": "diff/timeline",
  "mcpServer/startupStatus/updated": "infra",
  "remoteControl/status/changed": "infra",
};

const CLASSIFICATION_FIELD = {
  "telemetry/status": "telemetryMethodsObserved",
  lifecycle: "lifecycleMethodsObserved",
  "diff/timeline": "timelineMethodsObserved",
  infra: "ignoredInfraMethodsObserved",
};

function gitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readManagedRuntime() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.fixture) throw new Error("production managed runtime manifest must not be fixture");
  const platformKey = `${process.platform}-${process.arch}`;
  const entry = manifest.platforms?.[platformKey];
  if (!entry) throw new Error(`managed runtime platform entry missing: ${platformKey}`);
  const runtimePath = resolve(dirname(MANIFEST_PATH), entry.path);
  if (!existsSync(runtimePath)) {
    execFileSync("node", ["scripts/install-codex-managed-runtime.mjs"], { cwd: PROJECT_ROOT, stdio: "inherit" });
  }
  if (!existsSync(runtimePath)) throw new Error(`managed runtime binary missing: ${runtimePath}`);
  const stat = statSync(runtimePath);
  if (stat.size !== entry.size) throw new Error(`runtime size mismatch: expected ${entry.size}, got ${stat.size}`);
  const actualSha = sha256(runtimePath);
  if (actualSha !== entry.sha256) throw new Error(`runtime sha256 mismatch: expected ${entry.sha256}, got ${actualSha}`);
  return {
    runtimePath,
    appServerArgs: Array.isArray(manifest.appServerArgs) && manifest.appServerArgs.length > 0 ? manifest.appServerArgs : ["app-server"],
    runtimeVersion: manifest.version,
    platformKey,
  };
}

function createJsonRpcClient(proc) {
  let buf = "";
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();
  const rawMessages = [];

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      rawMessages.push(msg);
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result);
      } else if (msg.method) {
        const list = handlers.get(msg.method) || [];
        for (const handler of list) {
          try { handler(msg.params || {}, msg.id); } catch {}
        }
      }
    }
  });

  return {
    rawMessages,
    request(method, params, timeoutMs = 30000) {
      return new Promise((resolvePromise, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolvePromise, reject });
        proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`${method} timeout`));
        }, timeoutMs);
      });
    },
    notify(method, params = {}) {
      proc.stdin.write(JSON.stringify({ method, params }) + "\n");
    },
    respond(id, result) {
      proc.stdin.write(JSON.stringify({ id, result }) + "\n");
    },
    on(method, handler) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(handler);
    },
  };
}

function waitForExit(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
  });
}

function normalizeAction(kind) {
  if (kind === "add") return "create";
  if (kind === "delete") return "delete";
  return "modify";
}

function makeSourceRef(params, method, serverRequestId, sequence) {
  return {
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    serverRequestId,
    method,
    sequence,
  };
}

function makeApprovalRequestEvent(providerId, params, method, serverRequestId, sequence) {
  const isCommand = method.includes("commandExecution");
  const command = Array.isArray(params.command) ? params.command.join(" ") : params.command ?? "";
  return {
    providerId,
    timestamp: new Date().toISOString(),
    sourceRef: makeSourceRef(params, method, serverRequestId, sequence),
    payload: {
      kind: "approval_request",
      requestId: `codex-req-${serverRequestId}`,
      toolName: isCommand ? "Bash" : "Write",
      description: params.reason ?? (isCommand ? `Execute command: ${command}` : "Apply file changes"),
      riskLevel: isCommand ? "high" : "medium",
      riskReason: isCommand ? "Shell execution" : "File modification",
      inputSummary: isCommand ? command : params.reason ?? "file changes",
      mergeKey: `${method}:${params.itemId ?? serverRequestId}`,
    },
  };
}

function makeApprovalResolvedEvent(providerId, params, method, serverRequestId, sequence, responseType = "accept") {
  return {
    providerId,
    timestamp: new Date().toISOString(),
    sourceRef: makeSourceRef(params, method, serverRequestId, sequence),
    payload: {
      kind: "approval_resolved",
      requestId: `codex-req-${serverRequestId}`,
      response: { type: responseType },
      source: "user",
    },
  };
}

function makeUserInputRequestEvent(providerId, params, serverRequestId, sequence) {
  const questions = Array.isArray(params.questions)
    ? params.questions.map((q, index) => ({
        id: q.id || `question-${index + 1}`,
        header: q.header || undefined,
        question: q.question || q.prompt || "Input requested",
        options: Array.isArray(q.options)
          ? q.options.map((opt) => ({ label: opt.label, description: opt.description || undefined })).filter((opt) => opt.label)
          : [],
        multiSelect: false,
        selectionType: "single",
      }))
    : undefined;
  return {
    providerId,
    timestamp: new Date().toISOString(),
    sourceRef: makeSourceRef(params, "item/tool/requestUserInput", serverRequestId, sequence),
    payload: {
      kind: "user_input_request",
      requestId: `codex-input-${serverRequestId}`,
      toolName: "request_user_input",
      prompt: questions?.[0]?.question ?? "Input requested",
      inputType: "text",
      questions,
    },
  };
}

function makeUserInputResolvedEvent(providerId, params, serverRequestId, sequence, response) {
  return {
    providerId,
    timestamp: new Date().toISOString(),
    sourceRef: makeSourceRef(params, "user-input-resolved", serverRequestId, sequence),
    payload: {
      kind: "user_input_resolved",
      requestId: `codex-input-${serverRequestId}`,
      response,
      source: "user",
    },
  };
}

async function buildBundles() {
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
  return {
    ...(await import(pathToFileURL(mapperBundle).href)),
    ...(await import(pathToFileURL(viewBundle).href)),
    ...(await import(pathToFileURL(displayBundle).href)),
  };
}

function isAuthUnavailableError(err) {
  const msg = (typeof err === "string" ? err : err?.message || JSON.stringify(err || {})).toLowerCase();
  return /auth|login|unauthorized|not.*logged.*in|no.*credentials|token|sign.?in|forbidden|401|403/.test(msg);
}

function makeThreadParams(model, cwd, approvalPolicy, instructions, config = undefined) {
  return {
    model,
    cwd,
    approvalPolicy,
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    baseInstructions: instructions,
    developerInstructions: "Use real tools when explicitly requested. Keep final answers short.",
    config,
    personality: "pragmatic",
    ephemeral: true,
    sessionStartSource: "clear",
  };
}

function makeTurnParams(threadId, text, approvalPolicy = undefined) {
  return {
    threadId,
    input: [{ type: "text", text, text_elements: [] }],
    approvalPolicy,
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [SMOKE_VAULT_DIR],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

function ingestMapped(builder, event) {
  if (event) builder.ingest(event);
}

async function runTurn({ client, mapper, Builder, providerId, model, name, prompt, approvalPolicy, threadConfig }) {
  const builder = new Builder(`turn-${name}`, providerId, new Date().toISOString());
  const rawEvents = [];
  const serverRequests = [];
  const decisions = new Map();
  let sequence = 1000;
  let turnError = null;
  let completed = false;
  let failed = false;

  const ingest = (event) => {
    if (!event) return;
    rawEvents.push(event);
    builder.ingest(event);
  };

  const thread = await client.request("thread/start", makeThreadParams(
    model,
    SMOKE_VAULT_DIR,
    approvalPolicy,
    `Real Codex protocol smoke scenario: ${name}.`,
    threadConfig,
  ), 20000);
  const threadId = thread?.thread?.id;
  if (!threadId) throw new Error(`${name}: thread/start returned no thread id`);

  const done = new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise("timeout"), 120000);
    const finish = (outcome) => {
      clearTimeout(timer);
      resolvePromise(outcome);
    };
    const onScenario = (method, handler) => {
      client.on(method, (params, id) => {
        if (params?.threadId && params.threadId !== threadId) return;
        handler(params, id);
      });
    };

    onScenario("turn/started", (params) => ingest(mapper.mapTurnStarted(params)));
    onScenario("item/started", (params) => ingest(mapper.mapItemStarted(params)));
    onScenario("item/agentMessage/delta", (params) => ingest(mapper.mapItemAgentMessageDelta(params)));
    onScenario("item/reasoning/summaryTextDelta", (params) => ingest(mapper.mapItemReasoningSummaryTextDelta(params)));
    onScenario("item/reasoning/textDelta", (params) => ingest(mapper.mapItemReasoningTextDelta(params)));
    onScenario("item/commandExecution/outputDelta", (params) => ingest(mapper.mapItemCommandExecutionOutputDelta(params)));
    onScenario("item/fileChange/outputDelta", (params) => ingest(mapper.mapItemFileChangeOutputDelta(params)));
    onScenario("turn/diff/updated", (params) => ingest(mapper.mapTurnDiffUpdated(params)));
    onScenario("item/plan/delta", (params) => ingest(mapper.mapItemPlanDelta(params)));
    onScenario("item/completed", (params) => {
      const item = params.item;
      if (item?.type === "fileChange" && Array.isArray(item.changes) && item.changes.length > 0) {
        for (let i = 0; i < item.changes.length; i++) ingest(mapper.mapItemCompleted(params, i));
      } else {
        ingest(mapper.mapItemCompleted(params));
      }
    });
    onScenario("serverRequest/resolved", (params) => {
      const decision = [...decisions.values()].find((d) => String(d.requestId) === String(params.requestId));
      if (!decision) return;
      serverRequests.push({ method: "serverRequest/resolved", params });
      ingest(mapper.mapServerRequestResolved({
        ...params,
        itemId: decision.itemId,
        decision: decision.decision,
      }));
    });
    onScenario("item/commandExecution/requestApproval", (params, id) => {
      serverRequests.push({ method: "item/commandExecution/requestApproval", id, params });
      decisions.set(String(id), { requestId: id, itemId: params.itemId, decision: "accept" });
      ingest(makeApprovalRequestEvent(providerId, params, "item/commandExecution/requestApproval", id, sequence++));
      client.respond(id, { decision: "accept" });
      ingest(makeApprovalResolvedEvent(providerId, params, "item/commandExecution/requestApproval", id, sequence++, "accept"));
    });
    onScenario("item/fileChange/requestApproval", (params, id) => {
      serverRequests.push({ method: "item/fileChange/requestApproval", id, params });
      decisions.set(String(id), { requestId: id, itemId: params.itemId, decision: "accept" });
      ingest(makeApprovalRequestEvent(providerId, params, "item/fileChange/requestApproval", id, sequence++));
      client.respond(id, { decision: "accept" });
      ingest(makeApprovalResolvedEvent(providerId, params, "item/fileChange/requestApproval", id, sequence++, "accept"));
    });
    onScenario("item/tool/requestUserInput", (params, id) => {
      serverRequests.push({ method: "item/tool/requestUserInput", id, params });
      const firstQuestion = Array.isArray(params.questions) ? params.questions[0] : undefined;
      const answerLabel = firstQuestion?.options?.[0]?.label || "ok";
      const answers = firstQuestion?.id ? { [firstQuestion.id]: answerLabel } : undefined;
      const response = { type: "submit", value: answerLabel, answers };
      ingest(makeUserInputRequestEvent(providerId, params, id, sequence++));
      client.respond(id, firstQuestion?.id
        ? { answers: { [firstQuestion.id]: { answers: [answerLabel] } } }
        : { value: answerLabel });
      ingest(makeUserInputResolvedEvent(providerId, params, id, sequence++, response));
    });
    onScenario("turn/completed", (params) => {
      completed = true;
      ingest(mapper.mapTurnCompleted(params));
      finish("completed");
    });
    onScenario("turn/failed", (params) => {
      failed = true;
      turnError = params?.error?.message || params?.message || "turn/failed";
      ingest(mapper.mapTurnFailed(params));
      finish("failed");
    });
    onScenario("error", (params) => {
      turnError = params?.error?.message || params?.message || JSON.stringify(params);
    });
  });

  await client.request("turn/start", makeTurnParams(threadId, prompt, approvalPolicy), 20000);
  const outcome = await done;
  const view = builder.toView();
  return {
    name,
    threadId,
    outcome,
    completed,
    failed,
    turnError,
    rawEvents,
    serverRequests,
    view,
  };
}

function findNode(view, kind) {
  return view.turnTimeline.find((node) => node.kind === kind);
}

function findCard(model, kind, predicate = () => true) {
  return model.timelineCards.find((card) => card.kind === kind && predicate(card));
}

function addCheck(checks, name, ok, detail = "") {
  checks.push({ name, status: ok ? "pass" : "fail", detail });
}

function compactJson(value, max = 360) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function collectProtocolObservations(rawMessages) {
  const unknownMethodMap = new Map();
  const unknownItemTypes = [];
  const observedShapeNotes = [];
  const observedMethodClassification = {};
  const classifiedMethods = {
    telemetryMethodsObserved: new Set(),
    lifecycleMethodsObserved: new Set(),
    timelineMethodsObserved: new Set(),
    ignoredInfraMethodsObserved: new Set(),
  };
  const seenShapeNotes = new Set();

  const addShapeNote = (note) => {
    if (seenShapeNotes.has(note)) return;
    seenShapeNotes.add(note);
    observedShapeNotes.push(note);
  };

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== "object" || !msg.method) continue;
    const classification = OBSERVED_METHOD_CLASSIFICATION[msg.method];
    if (classification) {
      observedMethodClassification[msg.method] = classification;
      classifiedMethods[CLASSIFICATION_FIELD[classification]].add(msg.method);
    } else if (!KNOWN_PROTOCOL_METHODS.has(msg.method)) {
      const existing = unknownMethodMap.get(msg.method);
      if (existing) {
        existing.count += 1;
      } else {
        unknownMethodMap.set(msg.method, { method: msg.method, count: 1 });
      }
    }
    const item = msg.params?.item;
    const itemType = typeof item?.type === "string" ? item.type : undefined;
    if (itemType && !KNOWN_ITEM_TYPES.has(itemType)) {
      unknownItemTypes.push({ method: msg.method, itemType, itemPreview: compactJson(item) });
    }
    if (item?.type === "fileChange" && Array.isArray(item.changes)) {
      for (const change of item.changes) {
        if (change?.kind && typeof change.kind === "object") {
          addShapeNote("fileChange.change.kind object shape observed and normalized");
        }
      }
    }
    if (msg.method === "serverRequest/resolved") {
      if (msg.params?.itemId === undefined || msg.params?.decision === undefined) {
        addShapeNote("serverRequest/resolved did not include itemId/decision; timeline resolved by requestId correlation");
      }
    }
  }

  return {
    unknownMethods: [...unknownMethodMap.values()].sort((a, b) => a.method.localeCompare(b.method)),
    unknownItemTypes,
    observedShapeNotes,
    observedMethodClassification,
    telemetryMethodsObserved: [...classifiedMethods.telemetryMethodsObserved].sort(),
    lifecycleMethodsObserved: [...classifiedMethods.lifecycleMethodsObserved].sort(),
    timelineMethodsObserved: [...classifiedMethods.timelineMethodsObserved].sort(),
    ignoredInfraMethodsObserved: [...classifiedMethods.ignoredInfraMethodsObserved].sort(),
  };
}

async function main() {
  rmSync(SMOKE_VAULT_DIR, { recursive: true, force: true });
  mkdirSync(SMOKE_VAULT_DIR, { recursive: true });
  writeFileSync(join(SMOKE_VAULT_DIR, "v17-f42-target.md"), "before\n", "utf8");

  const { runtimePath, appServerArgs, runtimeVersion, platformKey } = readManagedRuntime();
  const { CodexAppServerEventMapper, AssistantTurnViewBuilder, buildAgentRunDisplayModel } = await buildBundles();
  const providerId = "codex-managed-app-server";
  const mapper = new CodexAppServerEventMapper(providerId, true);

  let stderr = "";
  const proc = spawn(runtimePath, appServerArgs, {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const client = createJsonRpcClient(proc);

  const report = {
    generatedAt: new Date().toISOString(),
    testedCodeCommitSha: gitSha(),
    runtimeVersion,
    platformKey,
    runtimePath,
    realProtocolCapabilitySmokeStatus: "fail",
    authStatus: "unknown",
    selectedModel: null,
    scenarios: [],
    checks: [],
    error: null,
  };

  try {
    const init = await client.request("initialize", {
      clientInfo: { name: "llm-cli-bridge-real-protocol-smoke", title: "LLM CLI Bridge Real Protocol Capability", version: "17-f5" },
      capabilities: { experimentalApi: true },
      cwd: SMOKE_VAULT_DIR,
    }, 15000);
    report.authStatus = "initialized";
    client.notify("initialized", {});

    const modelList = await client.request("model/list", {}, 15000);
    const models = Array.isArray(modelList?.data) ? modelList.data : [];
    const selected = models.find((m) => m?.isDefault && (m.model || m.id)) || models.find((m) => m?.model || m?.id);
    report.selectedModel = selected?.model || selected?.id || "gpt-5.5";

    const commandScenario = await runTurn({
      client,
      mapper,
      Builder: AssistantTurnViewBuilder,
      providerId,
      model: report.selectedModel,
      name: "commandExecution",
      approvalPolicy: "untrusted",
      prompt: [
        "Use command execution to run exactly this shell command, do not simulate:",
        "node -e \"console.log('CMD_TIMELINE_OK')\"",
        "After it finishes, answer with COMMAND_DONE.",
      ].join("\n"),
    });
    report.scenarios.push(commandScenario);

    const fileScenario = await runTurn({
      client,
      mapper,
      Builder: AssistantTurnViewBuilder,
      providerId,
      model: report.selectedModel,
      name: "fileChange",
      approvalPolicy: "untrusted",
      prompt: [
        "Modify the file v17-f42-target.md in the current working directory.",
        "Replace its content with exactly:",
        "after",
        "Use the file editing tool and do not only describe the change.",
        "After the edit, answer with FILE_DONE.",
      ].join("\n"),
    });
    report.scenarios.push(fileScenario);

    const inputScenario = await runTurn({
      client,
      mapper,
      Builder: AssistantTurnViewBuilder,
      providerId,
      model: report.selectedModel,
      name: "userInput",
      approvalPolicy: "untrusted",
      prompt: [
        "Use the request_user_input tool to ask one single-choice question with option label ok.",
        "After the answer is returned, answer with INPUT_DONE.",
      ].join("\n"),
      threadConfig: {
        collaboration_mode: {
          mode: "plan",
          settings: {
            model: report.selectedModel,
            reasoning_effort: null,
            developer_instructions: "Use request_user_input when the user asks for input.",
          },
        },
      },
    });
    report.scenarios.push(inputScenario);

    const commandView = commandScenario.view;
    const commandNode = findNode(commandView, "commandExecution");
    const commandModel = buildAgentRunDisplayModel(commandView, { developerMode: true, isRunning: false });
    const commandNormalModel = buildAgentRunDisplayModel(commandView, { developerMode: false, isRunning: false });
    const commandCard = findCard(commandModel, "tool-call", (card) => card.sourceRef?.itemId === commandNode?.sourceRef?.itemId);
    const commandNormalCard = findCard(commandNormalModel, "tool-call");
    addCheck(report.checks, "command item/started has itemId", !!commandNode?.sourceRef?.itemId, commandNode?.sourceRef?.itemId ?? "");
    addCheck(report.checks, "command outputDelta by itemId enters node",
      !!commandNode?.stdout?.includes("CMD_TIMELINE_OK"),
      `stdoutIncludesTarget=${!!commandNode?.stdout?.includes("CMD_TIMELINE_OK")} stdoutChars=${commandNode?.stdout?.length ?? 0}`);
    addCheck(report.checks, "command completed writes exitCode/durationMs/stdout",
      commandNode?.exitCode === 0 && typeof commandNode.durationMs === "number" && !!commandNode.stdout,
      `exit=${commandNode?.exitCode} duration=${commandNode?.durationMs}`);
    addCheck(report.checks, "timeline does not rely on recent running tool",
      commandModel.timelineCards.length === commandView.turnTimeline.length && !!commandCard?.sourceRef?.itemId,
      `cards=${commandModel.timelineCards.length} nodes=${commandView.turnTimeline.length}`);
    addCheck(report.checks, "command approval request surfaced",
      commandScenario.serverRequests.some((r) => r.method === "item/commandExecution/requestApproval"),
      commandScenario.serverRequests.map((r) => r.method).join(","));
    addCheck(report.checks, "command approval resolved same item",
      commandNode?.approvalStatus === "approved",
      `approval=${commandNode?.approvalStatus}`);

    const fileView = fileScenario.view;
    const fileNode = findNode(fileView, "fileChange");
    const fileModel = buildAgentRunDisplayModel(fileView, { developerMode: true, isRunning: false });
    const fileNormalModel = buildAgentRunDisplayModel(fileView, { developerMode: false, isRunning: false });
    const fileCard = findCard(fileModel, "file-change");
    const diffStatusNode = fileView.turnTimeline.find((node) => node.sourceRef?.method === "turn/diff/updated");
    const diffStatusDevCard = fileModel.timelineCards.find((card) => card.sourceRef?.method === "turn/diff/updated");
    const diffStatusNormalVisible = fileNormalModel.timelineCards.some((card) => card.title === "turnDiff" || card.summary === "turnDiff");
    addCheck(report.checks, "fileChange item has changes[]",
      Array.isArray(fileNode?.fileChanges) && fileNode.fileChanges.length > 0,
      `changes=${fileNode?.fileChanges?.length ?? 0}`);
    addCheck(report.checks, "fileChange path/action/diff enters FileChangeCard",
      !!fileCard?.changes?.[0]?.path && !!fileCard?.changes?.[0]?.action && !!fileCard.diff,
      `path=${fileCard?.changes?.[0]?.path ?? ""} action=${fileCard?.changes?.[0]?.action ?? ""} diffChars=${fileCard?.diff?.length ?? 0}`);
    addCheck(report.checks, "fileChange approval request bound to itemId",
      fileScenario.serverRequests.some((r) => r.method === "item/fileChange/requestApproval" && r.params?.itemId === fileNode?.sourceRef?.itemId),
      `requestItem=${fileScenario.serverRequests.find((r) => r.method === "item/fileChange/requestApproval")?.params?.itemId ?? ""} nodeItem=${fileNode?.sourceRef?.itemId ?? ""}`);
    addCheck(report.checks, "fileChange approvalStatus resolved",
      fileNode?.approvalStatus === "approved" || fileCard?.approvalStatus === "approved",
      `node=${fileNode?.approvalStatus} card=${fileCard?.approvalStatus}`);
    addCheck(report.checks, "turn/diff/updated developer status node observed",
      !!diffStatusNode && !!diffStatusDevCard,
      `node=${!!diffStatusNode} devCard=${!!diffStatusDevCard}`);
    addCheck(report.checks, "turn/diff/updated hidden from normal timeline",
      !diffStatusNormalVisible,
      `normalVisible=${diffStatusNormalVisible}`);

    const inputView = inputScenario.view;
    const inputNode = findNode(inputView, "userInput");
    addCheck(report.checks, "user input request surfaced",
      inputScenario.serverRequests.some((r) => r.method === "item/tool/requestUserInput"),
      inputScenario.serverRequests.map((r) => r.method).join(","));
    addCheck(report.checks, "user input timeline node resolved",
      inputNode?.status === "resolved",
      `status=${inputNode?.status}`);

    addCheck(report.checks, "normal user verbose output collapsed",
      commandNormalCard?.defaultExpanded === false && !commandNormalCard?.sourceRef,
      `defaultExpanded=${commandNormalCard?.defaultExpanded} sourceRef=${!!commandNormalCard?.sourceRef}`);
    addCheck(report.checks, "developer mode shows sourceRef/threadId/turnId/itemId/method",
      !!commandCard?.sourceRef?.threadId && !!commandCard.sourceRef.turnId && !!commandCard.sourceRef.itemId && !!commandCard.sourceRef.method,
      JSON.stringify(commandCard?.sourceRef ?? {}));
    addCheck(report.checks, "normal mode does not expose raw JSON sourceRef",
      !commandNormalCard?.sourceRef,
      `normalSourceRef=${!!commandNormalCard?.sourceRef}`);

    const checkPassed = (name) => report.checks.find((c) => c.name === name)?.status === "pass";
    report.commandExecutionRealSmokeStatus = [
      "command item/started has itemId",
      "command outputDelta by itemId enters node",
      "command completed writes exitCode/durationMs/stdout",
      "timeline does not rely on recent running tool",
    ].every(checkPassed) ? "pass" : "fail";
    report.fileChangeRealSmokeStatus = [
      "fileChange item has changes[]",
      "fileChange path/action/diff enters FileChangeCard",
    ].every(checkPassed) ? "pass" : "fail";
    report.approvalRealSmokeStatus = [
      "command approval request surfaced",
      "command approval resolved same item",
      "fileChange approval request bound to itemId",
      "fileChange approvalStatus resolved",
    ].every(checkPassed) ? "pass" : "fail";
    report.userInputRealSmokeStatus = [
      "user input request surfaced",
      "user input timeline node resolved",
    ].every(checkPassed) ? "pass" : "not-observed";
    report.userInputNotObservedReason = report.userInputRealSmokeStatus === "not-observed"
      ? "The real managed app-server completed the userInput scenario without sending item/tool/requestUserInput; synthetic mapping remains covered but is not counted as real pass."
      : "observed";
    report.realProtocolCapabilitySmokeStatus = report.commandExecutionRealSmokeStatus === "pass"
      && report.fileChangeRealSmokeStatus === "pass"
      && report.approvalRealSmokeStatus === "pass"
      && report.userInputRealSmokeStatus === "pass"
      ? "pass"
      : report.commandExecutionRealSmokeStatus === "pass"
        && report.fileChangeRealSmokeStatus === "pass"
        && report.approvalRealSmokeStatus === "pass"
          ? "partial"
          : "fail";
    const observations = collectProtocolObservations(client.rawMessages);
    report.unknownMethods = observations.unknownMethods;
    report.unknownItemTypes = observations.unknownItemTypes;
    report.observedShapeNotes = observations.observedShapeNotes;
    report.observedMethodClassification = observations.observedMethodClassification;
    report.telemetryMethodsObserved = observations.telemetryMethodsObserved;
    report.lifecycleMethodsObserved = observations.lifecycleMethodsObserved;
    report.timelineMethodsObserved = observations.timelineMethodsObserved;
    report.ignoredInfraMethodsObserved = observations.ignoredInfraMethodsObserved;
  } catch (err) {
    report.error = err?.message || String(err);
    if (isAuthUnavailableError(err)) {
      report.authStatus = "skip-auth";
    }
  } finally {
    try { proc.stdin.end(); } catch {}
    let exited = await waitForExit(proc, 3000);
    if (!exited) {
      try { proc.kill("SIGKILL"); } catch {}
      exited = await waitForExit(proc, 5000);
    }
    report.cleanShutdown = exited ? "pass" : "fail";
    report.stderrPreview = stderr.slice(0, 400);
    for (const file of [mapperBundle, viewBundle, displayBundle]) {
      try { rmSync(file, { force: true }); } catch {}
    }
  }

  const lines = [
    "# Codex Real Protocol Capability",
    "",
    "- **generatedAt**: " + report.generatedAt,
    "- **testedCodeCommitSha**: " + report.testedCodeCommitSha,
    "- **runtimeVersion**: " + report.runtimeVersion,
    "- **testedPlatform**: " + report.platformKey,
    "- **selectedModel**: " + (report.selectedModel ?? "null"),
    "- **authStatus**: " + report.authStatus,
    "- **realProtocolCapabilitySmokeStatus**: " + report.realProtocolCapabilitySmokeStatus,
    "- **commandExecutionRealSmokeStatus**: " + (report.commandExecutionRealSmokeStatus ?? "not-run"),
    "- **fileChangeRealSmokeStatus**: " + (report.fileChangeRealSmokeStatus ?? "not-run"),
    "- **approvalRealSmokeStatus**: " + (report.approvalRealSmokeStatus ?? "not-run"),
    "- **userInputRealSmokeStatus**: " + (report.userInputRealSmokeStatus ?? "not-run"),
    "- **userInputNotObservedReason**: " + (report.userInputNotObservedReason ?? "not-run"),
    "- **unknownMethodCount**: " + (report.unknownMethods?.length ?? 0),
    "- **unknownItemTypeCount**: " + (report.unknownItemTypes?.length ?? 0),
    "- **observedShapeNoteCount**: " + (report.observedShapeNotes?.length ?? 0),
    "- **observedUnknownMethodClassification**: " + compactJson(report.observedMethodClassification ?? {}),
    "- **telemetryMethodsObserved**: " + ((report.telemetryMethodsObserved ?? []).join(", ") || "none"),
    "- **lifecycleMethodsObserved**: " + ((report.lifecycleMethodsObserved ?? []).join(", ") || "none"),
    "- **timelineMethodsObserved**: " + ((report.timelineMethodsObserved ?? []).join(", ") || "none"),
    "- **ignoredInfraMethodsObserved**: " + ((report.ignoredInfraMethodsObserved ?? []).join(", ") || "none"),
    "- **cleanShutdown**: " + report.cleanShutdown,
    "- **error**: " + (report.error ?? "null"),
    "",
    report.realProtocolCapabilitySmokeStatus === "partial"
      ? "Overall is partial because commandExecution, fileChange, and approval were observed in the real managed app-server protocol, while userInput was not observed in this run and is not counted as pass."
      : "Overall pass requires every listed real capability to be observed and verified.",
    "",
    "## Scenarios",
    "",
    "| Scenario | Outcome | Nodes | Server requests | Error |",
    "| --- | --- | --- | --- | --- |",
    ...report.scenarios.map((s) => `| ${s.name} | ${s.outcome} | ${s.view.turnTimeline.length} | ${s.serverRequests.map((r) => r.method).join("<br>") || "none"} | ${String(s.turnError ?? "").replace(/\|/g, "\\|")} |`),
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((c) => `| ${c.name} | ${c.status} | ${String(c.detail).replace(/\|/g, "\\|")} |`),
    "",
    "## UI Contract",
    "",
    "- **normalUserVerboseOutputDefaultCollapsed**: " + (report.checks.find((c) => c.name === "normal user verbose output collapsed")?.status === "pass"),
    "- **normalUserRawJsonSourceRefHidden**: " + (report.checks.find((c) => c.name === "normal mode does not expose raw JSON sourceRef")?.status === "pass"),
    "- **developerModeSourceRefVisible**: " + (report.checks.find((c) => c.name === "developer mode shows sourceRef/threadId/turnId/itemId/method")?.status === "pass"),
    "",
    "## Unknown / Shape Observations",
    "",
    "- **observedUnknownMethodClassification**:",
    ...Object.entries(report.observedMethodClassification ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([method, classification]) => `  - ${method}: ${classification}`),
    "- **telemetryMethodsObserved**: " + ((report.telemetryMethodsObserved ?? []).join(", ") || "none"),
    "- **timelineMethodsObserved**: " + ((report.timelineMethodsObserved ?? []).join(", ") || "none"),
    "- **ignoredInfraMethodsObserved**: " + ((report.ignoredInfraMethodsObserved ?? []).join(", ") || "none"),
    "- **unknownMethods**: " + ((report.unknownMethods?.length ?? 0) === 0 ? "none" : ""),
    ...(report.unknownMethods ?? []).map((m) => `  - ${m.method} (${m.count})`),
    "- **unknownItemTypes**: " + ((report.unknownItemTypes?.length ?? 0) === 0 ? "none" : ""),
    ...(report.unknownItemTypes ?? []).map((i) => `  - ${i.itemType} via ${i.method}: ${i.itemPreview}`),
    "- **observedShapeNotes**: " + ((report.observedShapeNotes?.length ?? 0) === 0 ? "none" : ""),
    ...(report.observedShapeNotes ?? []).map((note) => `  - ${note}`),
    "",
  ];

  mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  console.log(`Wrote ${REPORT_PATH}`);
  if (report.realProtocolCapabilitySmokeStatus === "fail") process.exit(1);
}

main().catch((err) => {
  try {
    mkdirSync(DOCS_DIR, { recursive: true });
    writeFileSync(REPORT_PATH, [
      "# Codex Real Protocol Capability",
      "",
      "- **generatedAt**: " + new Date().toISOString(),
      "- **testedCodeCommitSha**: " + gitSha(),
      "- **realProtocolCapabilitySmokeStatus**: fail",
      "- **error**: " + (err?.stack || err?.message || String(err)).replace(/\r?\n/g, " "),
      "",
    ].join("\n"), "utf8");
  } catch {}
  console.error(err);
  process.exit(1);
});
