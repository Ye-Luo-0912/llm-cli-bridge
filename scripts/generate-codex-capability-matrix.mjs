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

function statusForMethod(method) {
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
  if (mapped.has(method)) return "mapped";
  if (experimental.has(method)) return "experimental";
  if (weak.has(method)) return "weak-mapped";
  return "unsupported";
}

function statusForItemType(type) {
  const mapped = new Set([
    "agentMessage",
    "reasoning",
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "enteredReviewMode",
    "exitedReviewMode",
    "contextCompaction",
  ]);
  const weak = new Set(["userMessage", "webSearch", "imageView", "message", "tool_call", "tool_result", "thinking", "file_change"]);
  const experimental = new Set(["plan"]);
  const ignored = new Set(["approval_request"]);
  if (mapped.has(type)) return "mapped";
  if (experimental.has(type)) return "experimental";
  if (weak.has(type)) return "weak-mapped";
  if (ignored.has(type)) return "ignored";
  return "unsupported";
}

function statusForServerRequest(method) {
  const mapped = new Set([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
  ]);
  return mapped.has(method) ? "mapped" : "unsupported";
}

function noteForStatus(status) {
  switch (status) {
    case "mapped": return "Preserves sourceRef and maps into TurnTimelineNode.";
    case "weak-mapped": return "Compatibility/status mapping; not all native fields have rich UI.";
    case "experimental": return "Supported behind Codex experimental protocol capability.";
    case "ignored": return "Legacy/fixture-only surface; not a main protocol source.";
    default: return "No Bridge mapping yet.";
  }
}

function table(title, rows) {
  const lines = [`## ${title}`, "", "| Surface | Status | Notes |", "| --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| \`${row.name}\` | ${row.status} | ${row.note} |`);
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

const methodRows = methods.map((name) => {
  const status = statusForMethod(name);
  return { name, status, note: noteForStatus(status) };
});
const itemRows = itemTypes.map((name) => {
  const status = statusForItemType(name);
  return { name, status, note: noteForStatus(status) };
});
const serverRequestRows = serverRequests.map((name) => {
  const status = statusForServerRequest(name);
  return { name, status, note: noteForStatus(status) };
});

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
  "- **mapped**: " + (counts.mapped ?? 0),
  "- **weakMapped**: " + (counts["weak-mapped"] ?? 0),
  "- **ignored**: " + (counts.ignored ?? 0),
  "- **unsupported**: " + (counts.unsupported ?? 0),
  "- **experimental**: " + (counts.experimental ?? 0),
  "",
  "This report inventories Codex app-server methods, item types, and server-initiated requests used by the Bridge timeline mapping layer.",
  "",
  table("Methods", methodRows),
  table("Item Types", itemRows),
  table("Server Requests", serverRequestRows),
].join("\n");

if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines, "utf8");
console.log(`Wrote ${outPath}`);
