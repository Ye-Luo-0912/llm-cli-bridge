/**
 * Obsidian HTTP Bridge Runtime Smoke Test
 *
 * 连接真实 Obsidian 环境的 llm-cli-bridge 插件 HTTP bridge，验证：
 * 1. /health 探活
 * 2. /state 运行时状态
 * 3. 鉴权（无 token 401，有 token 200）
 * 4. /action 文件操作（create_note → pending_approval → /dev/approve → 执行）
 * 5. 审批拒绝流（create_note → pending_approval → /dev/reject → rejected）
 * 6. /action-status 状态查询
 * 7. /dev/* 端点幂等性
 *
 * 用法：node scripts/obsidian-http-smoke.mjs
 *
 * 注意：LLM 运行（mock-success/mock-failure/claude-cli/completed/failed/stopped）
 * 以及 UI 渲染（AgentRunDisplayModel/debugView/sessionResumed）需要 CDP 或手动 UI 操作，
 * 本脚本不覆盖，标记为 manual required。
 */
import { readFileSync } from "fs";
import { join } from "path";

const VAULT_PATH = "D:\\Users\\Ye_Luo\\APP\\Obsidian\\LLM-Wiki";
const BRIDGE_JSON = join(VAULT_PATH, ".llm-bridge", "bridge.json");

let bridge;
try {
  bridge = JSON.parse(readFileSync(BRIDGE_JSON, "utf-8"));
} catch (e) {
  console.error(`FAIL: 无法读取 bridge.json: ${e.message}`);
  console.error(`路径: ${BRIDGE_JSON}`);
  process.exit(1);
}

const { port, token } = bridge;
const BASE = `http://127.0.0.1:${port}`;
const AUTH = { Authorization: `Bearer ${token}` };

const results = [];
function ok(name, detail = "") {
  results.push({ name, status: "pass", detail });
  console.log(`PASS ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, status: "fail", detail });
  console.log(`FAIL ${name}${detail ? " — " + detail : ""}`);
}
function skip(name, detail = "") {
  results.push({ name, status: "skip", detail });
  console.log(`SKIP ${name}${detail ? " — " + detail : ""}`);
}

async function fetchBridge(path, opts = {}, withAuth = true) {
  const url = `${BASE}${path}`;
  const headers = {};
  if (withAuth) Object.assign(headers, AUTH);
  if (opts.headers) Object.assign(headers, opts.headers);
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(url, { method: opts.method || "GET", headers, body: opts.body, signal: controller.signal });
    clearTimeout(timer);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, json, ok: r.ok };
  } catch (e) {
    return { status: 0, text: e.message, json: null, ok: false, error: e };
  }
}

// ---------- 1. /health ----------
async function testHealth() {
  const r = await fetchBridge("/health", {}, false);
  if (r.ok && r.json?.ok === true) {
    ok("health: /health 返回 ok=true", `vault=${r.json.vault} uptime=${r.json.uptimeMs}ms`);
  } else {
    fail("health: /health 返回 ok=true", `status=${r.status} body=${r.text}`);
  }
}

// ---------- 2. /state ----------
async function testState() {
  const r = await fetchBridge("/state");
  if (r.ok && r.json?.ok === true && r.json?.result?.vaultPath) {
    ok("state: /state 返回 vaultPath", `activeFile=${r.json.result.activeFilePath}`);
  } else {
    fail("state: /state 返回 vaultPath", `status=${r.status} body=${r.text}`);
  }
}

// ---------- 3. 鉴权 ----------
async function testAuth() {
  const r1 = await fetchBridge("/state", {}, false);
  if (r1.status === 401) {
    ok("auth: 无 token -> 401 Unauthorized");
  } else {
    fail("auth: 无 token -> 401", `status=${r1.status}`);
  }
  const r2 = await fetchBridge("/state");
  if (r2.ok) {
    ok("auth: 有 token -> 200 OK");
  } else {
    fail("auth: 有 token -> 200", `status=${r2.status}`);
  }
}

// ---------- 4. 审批通过流 ----------
async function testApprovalAccept() {
  const actionId = `smoke-accept-${Date.now()}`;
  const notePath = `smoke-test/smoke-accept-${Date.now()}.md`;
  const r1 = await fetchBridge("/action", {
    method: "POST",
    body: JSON.stringify({
      id: actionId,
      type: "create_note",
      params: { path: notePath, content: "# Smoke Test Accept\n\nCreated by obsidian-http-smoke." },
    }),
  });
  if (r1.status !== 202 || !r1.json?.ok || r1.json?.status !== "pending_approval") {
    fail("approval-accept: create_note -> pending_approval", `status=${r1.status} body=${r1.text}`);
    return;
  }
  ok("approval-accept: create_note -> pending_approval (202)");

  const r2 = await fetchBridge("/dev/approve", {
    method: "POST",
    body: JSON.stringify({ id: actionId }),
  });
  if (r2.ok && r2.json?.status === "approved") {
    ok("approval-accept: /dev/approve -> approved");
  } else {
    fail("approval-accept: /dev/approve -> approved", `status=${r2.status} body=${r2.text}`);
    return;
  }

  await new Promise((r) => setTimeout(r, 500));

  const r3 = await fetchBridge(`/action-status?id=${actionId}`);
  if (r3.ok && r3.json?.status === "completed") {
    ok("approval-accept: /action-status -> completed", `id=${actionId}`);
  } else {
    fail("approval-accept: /action-status -> completed", `status=${r3.status} body=${r3.text}`);
  }
}

// ---------- 5. 审批拒绝流 ----------
async function testApprovalReject() {
  const actionId = `smoke-reject-${Date.now()}`;
  const notePath = `smoke-test/smoke-reject-${Date.now()}.md`;
  const r1 = await fetchBridge("/action", {
    method: "POST",
    body: JSON.stringify({
      id: actionId,
      type: "create_note",
      params: { path: notePath, content: "# Should Not Exist" },
    }),
  });
  if (r1.status !== 202 || r1.json?.status !== "pending_approval") {
    fail("approval-reject: create_note -> pending_approval", `status=${r1.status} body=${r1.text}`);
    return;
  }
  ok("approval-reject: create_note -> pending_approval (202)");

  const r2 = await fetchBridge("/dev/reject", {
    method: "POST",
    body: JSON.stringify({ id: actionId }),
  });
  if (r2.ok && r2.json?.status === "rejected") {
    ok("approval-reject: /dev/reject -> rejected");
  } else {
    fail("approval-reject: /dev/reject -> rejected", `status=${r2.status} body=${r2.text}`);
    return;
  }

  await new Promise((r) => setTimeout(r, 300));

  const r3 = await fetchBridge(`/action-status?id=${actionId}`);
  if (r3.ok && (r3.json?.status === "rejected" || r3.json?.status === "denied" || r3.json?.status === "declined")) {
    ok("approval-reject: /action-status -> rejected/denied/declined", `status=${r3.json?.status}`);
  } else {
    fail("approval-reject: /action-status -> rejected/denied", `status=${r3.status} body=${r3.text}`);
  }
}

// ---------- 6. /dev/* idempotency ----------
async function testDevIdempotency() {
  const actionId = `smoke-idem-${Date.now()}`;
  const notePath = `smoke-test/smoke-idem-${Date.now()}.md`;
  const r1 = await fetchBridge("/action", {
    method: "POST",
    body: JSON.stringify({
      id: actionId,
      type: "create_note",
      params: { path: notePath, content: "idempotency test" },
    }),
  });
  if (r1.status !== 202) {
    fail("dev-idempotency: create_note -> pending", `status=${r1.status} body=${r1.text}`);
    return;
  }
  const r2 = await fetchBridge("/dev/approve", { method: "POST", body: JSON.stringify({ id: actionId }) });
  const r3 = await fetchBridge("/dev/approve", { method: "POST", body: JSON.stringify({ id: actionId }) });
  if (r2.ok && r3.ok) {
    ok("dev-idempotency: 重复 /dev/approve 同一 id 返回 200（幂等）");
  } else {
    fail("dev-idempotency: 重复 /dev/approve 幂等", `first=${r2.status} second=${r3.status}`);
  }
}

// ---------- 7. Manual required items ----------
function manualItems() {
  skip("mock-success/failure 运行: 需要 CDP 或手动 UI 触发（HTTP bridge 不支持触发 LLM 运行）", "manual required");
  skip("claude-cli/claude-sdk 运行路径: 需要在 Obsidian UI 中发送消息", "manual required");
  skip("completed/failed/stopped 运行状态: 需要触发 LLM 运行后观察 UI", "manual required");
  skip("新会话不继承上一会话 allow/session cache: 需要多轮运行+新会话操作", "manual required");
  skip("keepLastSession 恢复后 sessionResumed UI: 需要重启插件后视觉确认", "manual required");
  skip("普通用户态只看 AgentRunDisplayModel UI: 需要视觉确认", "manual required");
  skip("developer mode 能看 debugView 且已脱敏: 需要视觉确认", "manual required");
}

// ---------- Main ----------
async function main() {
  console.log(`\n=== Obsidian HTTP Bridge Runtime Smoke ===`);
  console.log(`Bridge: ${BASE} (port=${port}, token=${token.substring(0, 8)}...)`);
  console.log(`Vault: ${VAULT_PATH}\n`);

  await testHealth();
  await testState();
  await testAuth();
  await testApprovalAccept();
  await testApprovalReject();
  await testDevIdempotency();
  manualItems();

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  console.log(`\n=== Result: ${passed} passed, ${failed} failed, ${skipped} skipped (manual required) ===`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
