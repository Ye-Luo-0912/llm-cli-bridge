// Standalone runner for presentation behavior tests (Agent B owned).
//
// Usage:
//   node scripts/presentation/run-presentation-tests.mjs
//   node scripts/presentation/run-presentation-tests.mjs --filter codex-run

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadCodexRunViewModelModules } from "./_bundle.mjs";
import { runCodexRunViewModelSemanticTests } from "./codex-run-view-model-semantic.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-presentation.md");

const filterArg = process.argv.find((a) => a.startsWith("--filter="));
const filter = filterArg ? filterArg.slice("--filter=".length) : (process.argv.includes("--filter") ? process.argv[process.argv.indexOf("--filter") + 1] : "all");

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const results = [];
function addTest(name, status, detail = "") {
  results.push({ name, status, detail });
  const icon = status === "pass" ? "✅" : status === "fail" ? "❌" : "⏭️";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

let bundlesToClean = null;

try {
  console.log("=== Presentation behavior tests ===\n");

  if (filter === "all" || filter === "codex-run" || filter.startsWith("codex")) {
    const mods = await loadCodexRunViewModelModules(PROJECT_ROOT);
    bundlesToClean = mods.bundles;
    runCodexRunViewModelSemanticTests({
      addTest,
      buildAgentRunDisplayModel: mods.buildAgentRunDisplayModel,
      buildCodexRunViewModel: mods.buildCodexRunViewModel,
      buildAssistantTurnViewFromEvents: mods.buildAssistantTurnViewFromEvents,
    });
  } else {
    addTest(`Unknown filter: ${filter}`, "fail", "Use --filter=all|codex-run");
  }
} catch (e) {
  addTest("Presentation tests runner", "fail", e?.stack || e?.message || String(e));
} finally {
  if (bundlesToClean) {
    for (const f of Object.values(bundlesToClean)) {
      try { rmSync(f, { force: true }); } catch { /* ignore */ }
    }
  }
}

const passed = results.filter((r) => r.status === "pass").length;
const failed = results.filter((r) => r.status === "fail").length;

const lines = [
  "# LLM CLI Bridge — Presentation Behavior Tests",
  "",
  `- **时间**: ${new Date().toISOString()}`,
  `- **commit**: ${gitSha()}`,
  `- **filter**: ${filter}`,
  `- **结果**: ${passed} passed, ${failed} failed`,
  "",
  "| 状态 | 测试项 | 详情 |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.status === "pass" ? "✅" : "❌"} | ${r.name} | ${r.detail || "-"} |`),
  "",
];

if (!existsSync(join(PROJECT_ROOT, "docs"))) mkdirSync(join(PROJECT_ROOT, "docs"), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");

console.log(`\n报告已写入: ${OUT}`);
console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);

process.exit(failed > 0 ? 1 : 0);
