// LLM CLI Bridge — Codex capability matrix report generator.
//
// Source of truth:
// - schema/manifest.json for protocol capabilities advertised by the fixture/generated schema.
// - schema/index.ts for CodexItemType union values.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const manifestPath = join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "schema", "manifest.json");
const schemaPath = join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "schema", "index.ts");
const outPath = join(PROJECT_ROOT, "docs", "test-report-codex-capability-matrix.md");
const realProtocolSmokePath = join(PROJECT_ROOT, "docs", "test-report-codex-real-protocol-capability.md");

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractCodexItemTypes(schemaSource) {
  const match = schemaSource.match(/export type CodexItemType =([\s\S]*?);/);
  if (!match) return [];
  return [...match[1].matchAll(/\|\s*"([^"]+)"/g)].map((m) => m[1]);
}

function uniq(values) {
  return [...new Set(values)].filter(Boolean).sort();
}

function methodEvidence(method) {
  const real = realSmokeMethodPassed(method);
  const mapped = new Set([
    "initialize",
    "initialized",
    "thread/start",
    "thread/resume",
    "turn/start",
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
    "serverRequest/resolved",
  ]);
  const experimental = new Set(["item/plan/delta"]);
  const weak = new Set(["item/text/delta", "item/thinking/delta", "item/argument/delta"]);
  if (real) return makeEvidence(method, "real-smoke-passed", true, true, true, "observed", "Verified against the managed Codex app-server real protocol smoke.");
  if (mapped.has(method)) return makeEvidence(method, "mapped", true, false, false, "not-real-smoked", "Preserves sourceRef and maps into TurnTimelineNode.");
  if (experimental.has(method)) return makeEvidence(method, "experimental", true, false, false, "not-real-smoked", "Supported behind Codex experimental protocol capability.");
  if (weak.has(method)) return makeEvidence(method, "weak-mapped", true, false, false, "not-real-smoked", "Compatibility/status mapping; not all native fields have rich UI.");
  return makeEvidence(method, "unsupported", false, false, false, "not-observed", "No Bridge mapping yet.");
}

function itemEvidence(type) {
  const real = realSmokeItemPassed(type);
  const mapped = new Set([
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
  ]);
  const weak = new Set(["message", "tool_call", "tool_result", "thinking", "file_change"]);
  const experimental = new Set(["plan"]);
  const ignored = new Set(["userMessage", "approval_request"]);
  if (real) return makeEvidence(type, "real-smoke-passed", true, true, true, "observed", "Verified against the managed Codex app-server real protocol smoke.");
  if (mapped.has(type)) return makeEvidence(type, "synthetic-passed", true, true, false, "not-real-smoked", "Mapped in Bridge and covered by fixture/synthetic timeline smoke; not yet real-smoke-passed.");
  if (experimental.has(type)) return makeEvidence(type, "experimental", true, false, false, "not-real-smoked", "Supported behind Codex experimental protocol capability.");
  if (weak.has(type)) return makeEvidence(type, "weak-mapped", true, false, false, "legacy", "Legacy compatibility surface; not part of the native Codex main gate.");
  if (ignored.has(type)) return makeEvidence(type, "ignored", false, false, false, "not-timeline", type === "userMessage" ? "User prompt is input context, not an assistant turn timeline node." : "Legacy/fixture-only surface; not a main protocol source.");
  return makeEvidence(type, "unsupported", false, false, false, "not-observed", "No Bridge mapping yet.");
}

function serverRequestEvidence(method) {
  const real = realSmokeServerRequestPassed(method);
  const mapped = new Set([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
  ]);
  if (real) return makeEvidence(method, "real-smoke-passed", true, true, true, "observed", "Request surfaced, response returned, and matching timeline item resolved in real protocol smoke.");
  if (method === "item/tool/requestUserInput") return makeEvidence(method, "not-observed", true, true, false, "not-observed", "Synthetic mapping passed, but the real managed app-server smoke did not trigger this request. It is not counted as real-smoke-passed.");
  return mapped.has(method)
    ? makeEvidence(method, "synthetic-passed", true, true, false, "not-real-smoked", "Mapped in Bridge and covered by fixture/synthetic smoke; not yet real-smoke-passed.")
    : makeEvidence(method, "unsupported", false, false, false, "not-observed", "No Bridge mapping yet.");
}

function makeEvidence(name, status, mapped, syntheticPassed, realSmokePassed, observation, note) {
  return { name, status, mapped, syntheticPassed, realSmokePassed, observation, note };
}

let cachedRealSmokePassed;
let cachedRealSmokeText;
function realSmokeText() {
  if (cachedRealSmokeText !== undefined) return cachedRealSmokeText;
  cachedRealSmokeText = existsSync(realProtocolSmokePath) ? readFileSync(realProtocolSmokePath, "utf8") : "";
  return cachedRealSmokeText;
}

function realSmokePassed() {
  if (cachedRealSmokePassed !== undefined) return cachedRealSmokePassed;
  cachedRealSmokePassed = /- \*\*realProtocolCapabilitySmokeStatus\*\*: pass/.test(realSmokeText());
  return cachedRealSmokePassed;
}

function realSmokeFieldPass(field) {
  return new RegExp(`- \\*\\*${field}\\*\\*: pass`).test(realSmokeText());
}

function realSmokeFieldValue(field) {
  const match = realSmokeText().match(new RegExp(`- \\*\\*${field}\\*\\*: ([^\\r\\n]+)`));
  return match ? match[1].trim() : "unknown";
}

function realSmokeMethodPassed(method) {
  if (realSmokeCommandMethodSet.has(method)) return realSmokeFieldPass("commandExecutionRealSmokeStatus");
  if (realSmokeFileMethodSet.has(method)) return realSmokeFieldPass("fileChangeRealSmokeStatus");
  if (realSmokeApprovalMethodSet.has(method)) return realSmokeFieldPass("approvalRealSmokeStatus");
  if (method === "item/tool/requestUserInput") return realSmokeFieldPass("userInputRealSmokeStatus");
  return false;
}

function realSmokeItemPassed(type) {
  if (type === "commandExecution") return realSmokeFieldPass("commandExecutionRealSmokeStatus");
  if (type === "fileChange") return realSmokeFieldPass("fileChangeRealSmokeStatus");
  return false;
}

function realSmokeServerRequestPassed(method) {
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    return realSmokeFieldPass("approvalRealSmokeStatus");
  }
  if (method === "item/tool/requestUserInput") return realSmokeFieldPass("userInputRealSmokeStatus");
  return false;
}

const realSmokeCommandMethodSet = new Set([
  "thread/start",
  "turn/start",
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/commandExecution/outputDelta",
]);
const realSmokeFileMethodSet = new Set([
  "thread/start",
  "turn/start",
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/fileChange/outputDelta",
]);
const realSmokeApprovalMethodSet = new Set([
  "serverRequest/resolved",
]);

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function boolCell(value) {
  return value ? "yes" : "no";
}

function table(title, rows) {
  const lines = [
    `## ${title}`,
    "",
    "| Surface | Status | Mapped | Synthetic | Real Smoke | Observation | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(`| \`${row.name}\` | ${row.status} | ${boolCell(row.mapped)} | ${boolCell(row.syntheticPassed)} | ${boolCell(row.realSmokePassed)} | ${row.observation} | ${escapeCell(row.note)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

const manifest = readJson(manifestPath);
const schemaSource = readFileSync(schemaPath, "utf8");
const itemTypes = extractCodexItemTypes(schemaSource);

const methods = uniq([
  "initialize",
  "initialized",
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/started",
  "turn/completed",
  "turn/failed",
  "item/started",
  "item/completed",
  ...(manifest.protocolCapabilities?.itemDeltas ?? []),
  "item/text/delta",
  "item/thinking/delta",
  "item/argument/delta",
  "serverRequest/resolved",
]);
const serverRequests = uniq(manifest.protocolCapabilities?.serverInitiatedRequests ?? []);

const methodRows = methods.map(methodEvidence);
const itemRows = itemTypes.map(itemEvidence);
const serverRequestRows = serverRequests.map(serverRequestEvidence);

const counts = [...methodRows, ...itemRows, ...serverRequestRows].reduce((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});

const lines = [
  "# Codex Capability Matrix",
  "",
  "- **generatedAt**: " + new Date().toISOString(),
  "- **testedCodeCommitSha**: " + gitSha(),
  "- **schemaManifest**: `src/runtime/providers/codex-app-server/schema/manifest.json`",
  "- **schemaSource**: `src/runtime/providers/codex-app-server/schema/index.ts`",
  "- **schemaVersion**: " + (manifest.schemaVersion ?? "unknown"),
  "- **schemaSourceMode**: " + (manifest.source ?? "unknown"),
  "- **experimentalApiDefault**: " + String(manifest.experimentalApi),
  "- **realProtocolSmokeReport**: `docs/test-report-codex-real-protocol-capability.md`",
  "- **realProtocolCapabilitySmokeStatus**: " + realSmokeFieldValue("realProtocolCapabilitySmokeStatus"),
  "- **commandExecutionRealSmokeStatus**: " + realSmokeFieldValue("commandExecutionRealSmokeStatus"),
  "- **fileChangeRealSmokeStatus**: " + realSmokeFieldValue("fileChangeRealSmokeStatus"),
  "- **approvalRealSmokeStatus**: " + realSmokeFieldValue("approvalRealSmokeStatus"),
  "- **userInputRealSmokeStatus**: " + realSmokeFieldValue("userInputRealSmokeStatus"),
  "- **unknownMethodCount**: " + realSmokeFieldValue("unknownMethodCount"),
  "- **unknownItemTypeCount**: " + realSmokeFieldValue("unknownItemTypeCount"),
  "- **observedShapeNoteCount**: " + realSmokeFieldValue("observedShapeNoteCount"),
  "- **realProtocolSmokePassed**: " + String(realSmokePassed()),
  "- **realSmokePassed**: " + (counts["real-smoke-passed"] ?? 0),
  "- **syntheticPassed**: " + (counts["synthetic-passed"] ?? 0),
  "- **notObserved**: " + (counts["not-observed"] ?? 0),
  "- **mapped**: " + (counts.mapped ?? 0),
  "- **weakMapped**: " + (counts["weak-mapped"] ?? 0),
  "- **ignored**: " + (counts.ignored ?? 0),
  "- **unsupported**: " + (counts.unsupported ?? 0),
  "- **experimental**: " + (counts.experimental ?? 0),
  "",
  "This report inventories Codex app-server methods, item types, and server-initiated requests used by the Bridge timeline mapping layer. Evidence columns are independent: a surface can be mapped and synthetic-passed while still not observed in real protocol smoke.",
  "",
  table("Methods", methodRows),
  table("Item Types", itemRows),
  table("Server Requests", serverRequestRows),
].join("\n");

if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines, "utf8");
console.log(`Wrote ${outPath}`);
