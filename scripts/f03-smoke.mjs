// F-03 Smoke: 交互状态机收口验收
// 验证 AssistantTurnView 终态守卫、cancelled 标志、markStopped 激活、流无终态兜底、restore 防护
// 独立于 run-tests.mjs，按 spec 要求作为独立 smoke

import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT = join(PROJECT_ROOT, "docs", "test-report-f03-smoke.md");
const VIEW_SRC = readFileSync(join(PROJECT_ROOT, "src", "view.ts"), "utf8");
const TURN_VIEW_SRC = readFileSync(join(PROJECT_ROOT, "src", "runtime", "core", "assistantTurnView.ts"), "utf8");

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const results = [];
function add(name, ok, detail = "") {
  results.push({ name, status: ok ? "pass" : "fail", detail });
}

// === 1. AssistantTurnView 终态守卫 ===
// ingest() 在 status !== "running" 时直接返回，防止迟到事件覆盖终态
{
  const hasGuard = TURN_VIEW_SRC.includes('if (this.status !== "running")') &&
    TURN_VIEW_SRC.includes("return this.toView();");
  add("F-03 ingest 终态守卫: status !== running 时直接返回 toView", hasGuard, hasGuard ? "ok" : "未找到终态守卫");
}

// === 2. cancelled 标志声明 ===
{
  const hasCancelled = VIEW_SRC.includes('let cancelled = false; // F-03: cancel 标志');
  add("F-03 cancelled 标志: run 闭包中声明 cancelled = false", hasCancelled, hasCancelled ? "ok" : "未找到 cancelled 声明");
}

// === 3. runHandle.stop() 设置 cancelled ===
{
  const stopSetsCancelled = VIEW_SRC.includes("cancelled = true;") &&
    VIEW_SRC.includes("F-03: 立即标记取消");
  add("F-03 runHandle.stop(): 设置 cancelled = true", stopSetsCancelled, stopSetsCancelled ? "ok" : "stop() 未设置 cancelled");
}

// === 4. runHandle.stop() 调用 markStopped ===
{
  const callsMarkStopped = VIEW_SRC.includes("turnBuilder.markStopped();");
  add("F-03 runHandle.stop(): 调用 turnBuilder.markStopped()（激活死代码）", callsMarkStopped, callsMarkStopped ? "ok" : "未调用 markStopped");
}

// === 5. runHandle.stop() 设置 terminalStatus = "stopped" ===
{
  const setsStopped = VIEW_SRC.includes('terminalStatus = "stopped";') &&
    VIEW_SRC.includes('F-03: 激活 markStopped');
  add("F-03 runHandle.stop(): 设置 terminalStatus = stopped", setsStopped, setsStopped ? "ok" : "未设置 stopped 终态");
}

// === 6. for-await 守卫使用 cancelled || terminalStatus ===
{
  const guardOk = VIEW_SRC.includes("if (cancelled || terminalStatus) break;");
  add("F-03 for-await 守卫: cancelled || terminalStatus 时 break", guardOk, guardOk ? "ok" : "守卫不正确");
}

// === 7. finally 流无终态兜底 ===
{
  const hasFallback = VIEW_SRC.includes("if (!terminalStatus)") &&
    VIEW_SRC.includes('terminalStatus = cancelled ? "stopped" : "failed";') &&
    VIEW_SRC.includes("Stream ended without terminal event");
  add("F-03 finally 兜底: 流无终态时 cancelled→stopped / 异常→failed", hasFallback, hasFallback ? "ok" : "未找到兜底逻辑");
}

// === 8. finishingRun 字段声明 ===
{
  const hasField = VIEW_SRC.includes("private finishingRun = false;");
  add("F-03 finishingRun 字段: 声明为 private finishingRun = false", hasField, hasField ? "ok" : "未找到字段声明");
}

// === 9. restoreSession 检查 finishingRun ===
{
  const checksFinishing = VIEW_SRC.includes("if (this.runHandle || this.finishingRun)") &&
    VIEW_SRC.includes("F-03: 运行中或收尾中均禁止 restore");
  add("F-03 restoreSession: 检查 runHandle || finishingRun", checksFinishing, checksFinishing ? "ok" : "未检查 finishingRun");
}

// === 10. onRunFinished 设置 finishingRun = true ===
{
  const setsTrue = VIEW_SRC.includes("this.finishingRun = true;") &&
    VIEW_SRC.includes("F-03: 标记收尾中");
  add("F-03 onRunFinished: 开始时设置 finishingRun = true", setsTrue, setsTrue ? "ok" : "未设置 finishingRun = true");
}

// === 11. onRunFinished finally 清除 finishingRun ===
{
  const clearsInFinally = VIEW_SRC.includes("this.finishingRun = false;") &&
    VIEW_SRC.includes("F-03: 收尾完成，清除标志");
  add("F-03 onRunFinished: finally 清除 finishingRun = false", clearsInFinally, clearsInFinally ? "ok" : "未在 finally 清除");
}

// === 12. "stopped by user" 渲染分支现在可达 ===
{
  // 之前 markStopped 是死代码，terminalStatus 永远不会是 "stopped"
  // 现在 runHandle.stop() 设置 terminalStatus = "stopped"，onRunFinished 收到 "stopped"
  const branchExists = VIEW_SRC.includes('finalStatus === "stopped"') &&
    VIEW_SRC.includes('"stopped by user"');
  add("F-03 stopped 渲染分支: 现在可达（markStopped → terminalStatus=stopped → onRunFinished）", branchExists, branchExists ? "ok" : "渲染分支缺失");
}

// === 13. Provider 协议未改动 ===
{
  // F-03 约束：不改 provider 协议。验证关键 provider 文件不含 F-03 标记
  const codexProvider = readFileSync(join(PROJECT_ROOT, "src", "runtime", "providers", "codex-app-server", "codexAppServerProvider.ts"), "utf8");
  const claudeSdkProvider = readFileSync(join(PROJECT_ROOT, "src", "runtime", "providers", "claude-sdk", "claudeSdkProvider.ts"), "utf8");
  const claudeCliProvider = readFileSync(join(PROJECT_ROOT, "src", "runtime", "providers", "claude-cli", "claudeCliProvider.ts"), "utf8");
  const noF03InProviders = !codexProvider.includes("F-03") && !claudeSdkProvider.includes("F-03") && !claudeCliProvider.includes("F-03");
  add("F-03 Provider 协议未改: codex/sdk/cli provider 无 F-03 改动", noF03InProviders, noF03InProviders ? "ok" : "provider 文件含 F-03 改动");
}

// === 14. 行为测试: ingest 终态后不处理事件 ===
// 用 esbuild 打包 assistantTurnView.ts，验证终态守卫行为
{
  const tempBundle = join(PROJECT_ROOT, ".test-f03-turnview.mjs");
  try {
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "runtime", "core", "assistantTurnView.ts")],
      bundle: true,
      format: "esm",
      target: "es2020",
      platform: "node",
      outfile: tempBundle,
      logLevel: "silent",
    });
    const { AssistantTurnViewBuilder: Builder } = await import(pathToFileURL(tempBundle).href);

    const ts = () => new Date().toISOString();
    const mkCompleted = (text, durationMs) => ({
      providerId: "claude-sdk", timestamp: ts(),
      payload: { kind: "completed", text, durationMs },
    });
    const mkMsg = (text, partial = true) => ({
      providerId: "claude-sdk", timestamp: ts(),
      payload: { kind: "message", role: "assistant", text, partial },
    });

    // Test A: completed 后再 ingest message → 不应改变 finalAnswer
    const bA = new Builder("tA", "claude-sdk", ts());
    bA.ingest(mkCompleted("done", 1000));
    const viewAfterCompleted = bA.toView();
    bA.ingest(mkMsg("late content", true)); // 迟到事件
    const viewAfterLate = bA.toView();
    const guardWorks = viewAfterLate.status === "completed" &&
      viewAfterLate.finalAnswer === "done" &&
      viewAfterLate.finalAnswer === viewAfterCompleted.finalAnswer;
    add("F-03 行为: completed 后迟到 message 不覆盖终态/答案", guardWorks,
      guardWorks ? "ok" : `status=${viewAfterLate.status} answer="${viewAfterLate.finalAnswer}"`);

    // Test B: markStopped 后再 ingest failed → 不应改变 status
    const bB = new Builder("tB", "claude-sdk", ts());
    bB.ingest(mkMsg("partial", true));
    bB.markStopped();
    const viewAfterStopped = bB.toView();
    bB.ingest({
      providerId: "claude-sdk", timestamp: ts(),
      payload: { kind: "failed", message: "late failure" },
    });
    const viewAfterLateFail = bB.toView();
    const stoppedGuard = viewAfterLateFail.status === "stopped" &&
      !viewAfterLateFail.errors.includes("late failure");
    add("F-03 行为: markStopped 后迟到 failed 不覆盖 stopped 状态", stoppedGuard,
      stoppedGuard ? "ok" : `status=${viewAfterLateFail.status} errors=${JSON.stringify(viewAfterLateFail.errors)}`);

    // Test C: markStopped 设置 endedAt
    const hasEndedAt = !!viewAfterStopped.endedAt;
    add("F-03 行为: markStopped 设置 endedAt", hasEndedAt, hasEndedAt ? "ok" : "endedAt 为空");

  } finally {
    try { unlinkSync(tempBundle); } catch { /* ignore */ }
  }
}

// === 生成报告 ===
const failed = results.filter((r) => r.status !== "pass");
const lines = [
  "# F-03 Smoke: 交互状态机收口验收",
  "",
  "- **generatedAt**: " + new Date().toISOString(),
  "- **testedCodeCommitSha**: " + gitSha(),
  "- **f03SmokeStatus**: " + (failed.length === 0 ? "pass" : "fail"),
  "- **totalChecks**: " + results.length,
  "",
  "| Check | Status | Detail |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
  "",
];

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`\n=== F-03 Smoke: 交互状态机收口验收 ===`);
for (const r of results) {
  console.log(`${r.status === "pass" ? "✅" : "❌"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
console.log(`\n报告已写入: ${OUT}`);
console.log(`\n=== 结果: ${results.length - failed.length} passed, ${failed.length} failed ===`);

if (failed.length > 0) process.exit(1);
