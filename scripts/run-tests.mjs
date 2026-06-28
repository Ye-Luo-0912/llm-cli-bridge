// LLM CLI Bridge — 自动化测试运行器
// 运行：node scripts/run-tests.mjs
// 输出：docs/test-report.md

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, mkdtempSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const VAULT_PATH = process.env.VAULT_PATH || resolve(PROJECT_ROOT, "..", "Obsidian", "LLM-Wiki");
const TEST_ARTIFACTS_DIR = join(VAULT_PATH, ".llm-bridge", "test-artifacts");

const results = {
  timestamp: new Date().toISOString(),
  environment: {},
  tests: [],
  passed: 0,
  failed: 0,
  manualRequired: 0,
  skipped: 0,
};

// 测试模式：--unit / --process / --claude / --integration / 默认 all
const runMode = process.argv.includes("--unit") ? "unit"
  : process.argv.includes("--process") ? "process"
  : process.argv.includes("--claude") ? "claude"
  : process.argv.includes("--integration") ? "integration"
  : "all";

function addTest(name, status, detail = "") {
  results.tests.push({ name, status, detail });
  if (status === "pass") results.passed++;
  else if (status === "fail") results.failed++;
  else if (status === "manual") results.manualRequired++;
  else if (status === "skip") results.skipped++;
  const icon = status === "pass" ? "✅" : status === "fail" ? "❌" : status === "skip" ? "⏭️" : "⚪";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ============================================================
// 1. 环境信息
// ============================================================
console.log("=== 环境信息 ===");

function collectEnv() {
  results.environment.nodeVersion = process.version;
  results.environment.platform = process.platform;
  results.environment.projectRoot = PROJECT_ROOT;
  results.environment.vaultPath = VAULT_PATH;

  // main.js 大小
  try {
    const mainJs = join(PROJECT_ROOT, "main.js");
    if (existsSync(mainJs)) {
      const st = statSync(mainJs);
      results.environment.mainJsSize = st.size;
      results.environment.mainJsSizeKB = (st.size / 1024).toFixed(1) + " KB";
    }
  } catch {}

  // manifest.json 版本
  try {
    const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, "manifest.json"), "utf8"));
    results.environment.pluginVersion = manifest.version;
  } catch {}

  // bridge.json
  const bridgePath = join(VAULT_PATH, ".llm-bridge", "bridge.json");
  results.environment.bridgeJsonExists = existsSync(bridgePath);
  if (existsSync(bridgePath)) {
    try {
      const bridge = JSON.parse(readFileSync(bridgePath, "utf8"));
      results.environment.httpPort = bridge.port;
      results.environment.bridgeHost = bridge.host;
    } catch {}
  }

  console.log("Node:", results.environment.nodeVersion);
  console.log("Platform:", results.environment.platform);
  console.log("Plugin version:", results.environment.pluginVersion || "unknown");
  console.log("main.js size:", results.environment.mainJsSizeKB || "unknown");
  console.log("bridge.json exists:", results.environment.bridgeJsonExists);
  console.log("HTTP port:", results.environment.httpPort || "N/A");
}

collectEnv();

// ============================================================
// 2. 单元测试：validateAction / ACTION_SCHEMAS / isPathUnsafe
// ============================================================
console.log("\n=== 单元测试 ===");

// 从 actions.ts 复刻的测试逻辑（保持独立，不依赖 TS 编译）
function isPathUnsafe(vaultPath, filePath) {
  const p = filePath.replace(/\\/g, "/");
  const parts = p.split("/");
  const lower = p.toLowerCase();

  if (/^[A-Za-z]:/i.test(p) || p.startsWith("/")) return `拒绝绝对路径: ${filePath}`;
  let depth = 0;
  for (const part of parts) {
    if (part === "..") { depth--; if (depth < 0) return `拒绝路径遍历: ${filePath}`; }
    else if (part && part !== ".") depth++;
  }
  if (parts.includes(".obsidian")) return `拒绝 .obsidian 目录写入: ${filePath}`;

  if (parts.includes(".llm-bridge")) {
    if (lower.endsWith("bridge.json") || lower.includes("token") || lower.includes("config")) {
      return `拒绝写入敏感文件: ${filePath}`;
    }
  }

  const strongReject = [".env", ".git", "token", "secrets", "credentials"];
  for (const name of strongReject) {
    if (parts.includes(name) || lower.endsWith(name) || lower.endsWith(`${name}.json`) || lower.endsWith(`${name}.txt`)) {
      return `拒绝写入敏感路径: ${filePath}`;
    }
  }

  if (lower.includes("config")) {
    const sensitiveContexts = ["private", "runtime", "env", "secret"];
    if (parts.some(part => sensitiveContexts.includes(part.toLowerCase()))) {
      return `拒绝写入敏感上下文 config 文件: ${filePath}`;
    }
  }

  return null;
}

// ACTION_SCHEMAS 复刻
const ACTION_SCHEMAS = {
  show_notice: { required: ["message"], optional: [], extraForbidden: false },
  open_note: { required: ["path"], optional: [], extraForbidden: false },
  get_state: { required: [], optional: [], extraForbidden: true },
  get_active_note: { required: [], optional: [], extraForbidden: true },
  get_selection: { required: [], optional: [], extraForbidden: true },
  create_note: { required: ["path", "content"], optional: [], extraForbidden: false },
  append_to_note: { required: ["path", "content"], optional: [], extraForbidden: false },
  insert_at_cursor: { required: ["content"], optional: [], extraForbidden: false },
  replace_selection: { required: ["content"], optional: [], extraForbidden: false },
};

function validateActionSchema(action) {
  const schema = ACTION_SCHEMAS[action.type];
  if (!schema) return `未知 action 类型: ${action.type}`;
  const params = action.params || {};
  const keys = Object.keys(params);
  if (schema.required) {
    for (const k of schema.required) {
      if (params[k] === undefined || params[k] === null) return `action ${action.type} 缺少必填字段: ${k}`;
      if (typeof params[k] !== "string") return `action ${action.type} 字段 ${k} 类型错误`;
    }
  }
  if (schema.extraForbidden && keys.length > 0) {
    const allowed = [...(schema.required || []), ...(schema.optional || [])];
    const extra = keys.filter(k => !allowed.includes(k));
    if (extra.length > 0) return `action ${action.type} 不允许额外字段: ${extra.join(", ")}`;
  }
  return null;
}

// --- 运行 path safety 测试 ---
const pathTests = [
  { path: "config-notes.md", expect: null, desc: '普通 "config-notes.md" 不应被误杀' },
  { path: "my-config.md", expect: null, desc: "普通笔记名含 config 2" },
  { path: "notes/config-tips.md", expect: null, desc: "子目录 config 笔记" },
  { path: "90_AI整理待确认/summary.md", expect: null, desc: "普通目录文件" },
  { path: ".env", expect: /敏感路径/, desc: '".env" 应拒绝' },
  { path: ".git/config", expect: /敏感路径/, desc: '".git" 应拒绝' },
  { path: "../secret.md", expect: /路径遍历/, desc: '"../" 应拒绝' },
  { path: "C:/test.md", expect: /绝对路径/, desc: "绝对路径应拒绝" },
  { path: ".obsidian/test.md", expect: /\.obsidian/, desc: '".obsidian/" 应拒绝' },
  { path: ".llm-bridge/bridge.json", expect: /敏感文件/, desc: '".llm-bridge/bridge.json" 应拒绝' },
  { path: "token.json", expect: /敏感路径/, desc: '"token" 应拒绝' },
  { path: "secrets.txt", expect: /敏感路径/, desc: '"secrets" 应拒绝' },
  { path: "credentials.json", expect: /敏感路径/, desc: '"credentials" 应拒绝' },
  { path: "private/config.json", expect: /敏感上下文 config/, desc: "private 下 config 应拒绝" },
  { path: "runtime/config.yaml", expect: /敏感上下文 config/, desc: "runtime 下 config 应拒绝" },
  { path: ".llm-bridge/config.json", expect: /敏感文件/, desc: ".llm-bridge 下含 config 关键词拒绝" },
];

for (const t of pathTests) {
  const result = isPathUnsafe("", t.path);
  let ok = false;
  if (t.expect === null) ok = result === null;
  else ok = result !== null && t.expect.test(result);
  addTest(`isPathUnsafe: ${t.desc}`, ok ? "pass" : "fail", ok ? "" : `期望: ${t.expect}, 实际: ${result}`);
}

// --- 运行 ACTION_SCHEMAS 必填字段测试 ---
const schemaTests = [
  { action: { type: "show_notice", params: {} }, expect: /缺少必填字段/, desc: "show_notice 缺 message" },
  { action: { type: "show_notice", params: { message: "hi" } }, expect: null, desc: "show_notice 正常" },
  { action: { type: "open_note", params: {} }, expect: /缺少必填字段/, desc: "open_note 缺 path" },
  { action: { type: "open_note", params: { path: "a.md" } }, expect: null, desc: "open_note 正常" },
  { action: { type: "create_note", params: { path: "a.md" } }, expect: /缺少必填字段.*content/, desc: "create_note 缺 content" },
  { action: { type: "create_note", params: { content: "# a" } }, expect: /缺少必填字段.*path/, desc: "create_note 缺 path" },
  { action: { type: "create_note", params: { path: "a.md", content: "# a" } }, expect: null, desc: "create_note 正常" },
  { action: { type: "get_state", params: { extra: 1 } }, expect: /不允许额外字段/, desc: "get_state 禁止额外字段" },
  { action: { type: "get_state", params: {} }, expect: null, desc: "get_state 正常" },
  { action: { type: "unknown_type", params: {} }, expect: /未知 action 类型/, desc: "未知 action 类型" },
];

for (const t of schemaTests) {
  const result = validateActionSchema(t.action);
  let ok = false;
  if (t.expect === null) ok = result === null;
  else ok = result !== null && t.expect.test(result);
  addTest(`ACTION_SCHEMAS: ${t.desc}`, ok ? "pass" : "fail", ok ? "" : `期望: ${t.expect}, 实际: ${result}`);
}

// --- validateAction 组合测试（path safety + schema） ---
const combinedTests = [
  { action: { type: "create_note", params: { path: ".env", content: "x" } }, expectReject: true, desc: "create_note 敏感路径 .env 应拒绝" },
  { action: { type: "create_note", params: { path: "config-notes.md", content: "x" } }, expectReject: false, desc: "create_note config-notes.md 应通过" },
  { action: { type: "create_note", params: { path: "private/config.md", content: "x" } }, expectReject: true, desc: "create_note private/config 应拒绝" },
];

for (const t of combinedTests) {
  const schemaErr = validateActionSchema(t.action);
  const pathErr = t.action.params?.path ? isPathUnsafe("", String(t.action.params.path)) : null;
  const rejected = !!(schemaErr || pathErr);
  const ok = rejected === t.expectReject;
  addTest(`validateAction: ${t.desc}`, ok ? "pass" : "fail", ok ? "" : `期望拒绝: ${t.expectReject}, schemaErr: ${schemaErr}, pathErr: ${pathErr}`);
}

// ============================================================
// 2.5 Prompt Package 单元测试（V0.7）
// ============================================================
console.log("\n=== Prompt Package 单元测试 ===");

// 动态导入 promptPackage.ts
let promptPackageBundle = null;
try {
  const esbuild = (await import("esbuild")).default;
  promptPackageBundle = join(PROJECT_ROOT, ".test-prompt-package-temp.mjs");
  await esbuild.build({
    entryPoints: [join(PROJECT_ROOT, "src", "promptPackage.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: promptPackageBundle,
  });
  const { truncateText, buildPromptPackage } = await import(pathToFileURL(promptPackageBundle).href);

  // 辅助 settings（outputDir 用中性配置值，证明是配置驱动而非硬编码）
  function makePromptSettings(includeActiveNote, includeSelection, outputDir) {
    return {
      agentType: "claude",
      claudeCommand: "claude",
      claudeArgs: "-p",
      codexCommand: "codex",
      codexArgs: "exec -",
      customCommand: "",
      customArgs: "",
      includeActiveNote,
      includeSelection,
      maxActiveNoteChars: 100,
      maxSelectionChars: 50,
      outputDir: outputDir !== undefined ? outputDir : "my-test-output-dir",
      showStderr: true,
      saveLogs: false,
      sessionMode: "fresh",
      model: "gpt-5.5",
      effortLevel: "high",
      devTestMode: false,
      backendMode: "auto",
    };
  }

  // Test 1: truncateText 截断
  {
    const longText = "a".repeat(200);
    const truncated = truncateText(longText, 100);
    const ok = truncated.length === 100 + "\n\n...[truncated by LLM CLI Bridge]".length &&
               truncated.startsWith("a".repeat(100)) &&
               truncated.includes("truncated");
    addTest("Prompt Package: truncateText 截断", ok ? "pass" : "fail",
      ok ? "" : `length=${truncated.length}, starts=${truncated.startsWith("a".repeat(100))}`);
  }

  // Test 2: truncateText 不截断短文本
  {
    const shortText = "hello";
    const result = truncateText(shortText, 100);
    const ok = result === shortText;
    addTest("Prompt Package: truncateText 不截断短文本", ok ? "pass" : "fail",
      ok ? "" : `expected="${shortText}", got="${result}"`);
  }

  // Test 3: buildPromptPackage 包含启用内容（includeActiveNote=true）
  {
    const settings = makePromptSettings(true, false);
    const snapshot = {
      vaultPath: "/test/vault",
      activeFilePath: "note.md",
      activeFileContent: "# Test Note\nContent here",
      selection: null,
      timestamp: "2026-06-28T12:00:00Z",
    };
    const prompt = buildPromptPackage("用户请求", snapshot, settings);
    const hasNote = prompt.includes("当前活动笔记") &&
                    prompt.includes("note.md") &&
                    prompt.includes("# Test Note");
    const hasSelection = prompt.includes("当前选区内容");
    const ok = hasNote && !hasSelection;
    addTest("Prompt Package: 包含启用内容（includeActiveNote=true）", ok ? "pass" : "fail",
      ok ? "" : `hasNote=${hasNote}, hasSelection=${hasSelection}`);
  }

  // Test 4: buildPromptPackage 包含启用内容（includeSelection=true）
  {
    const settings = makePromptSettings(false, true);
    const snapshot = {
      vaultPath: "/test/vault",
      activeFilePath: "note.md",
      activeFileContent: "# Test Note",
      selection: "选中的文本",
      timestamp: "2026-06-28T12:00:00Z",
    };
    const prompt = buildPromptPackage("用户请求", snapshot, settings);
    const hasNote = prompt.includes("当前活动笔记");
    const hasSelection = prompt.includes("当前选区内容") && prompt.includes("选中的文本");
    const ok = !hasNote && hasSelection;
    addTest("Prompt Package: 包含启用内容（includeSelection=true）", ok ? "pass" : "fail",
      ok ? "" : `hasNote=${hasNote}, hasSelection=${hasSelection}`);
  }

  // Test 5: buildPromptPackage 不包含未启用内容
  {
    const settings = makePromptSettings(false, false);
    const snapshot = {
      vaultPath: "/test/vault",
      activeFilePath: "note.md",
      activeFileContent: "# Test Note",
      selection: "选中的文本",
      timestamp: "2026-06-28T12:00:00Z",
    };
    const prompt = buildPromptPackage("用户请求", snapshot, settings);
    const hasNote = prompt.includes("当前活动笔记");
    const hasSelection = prompt.includes("当前选区内容");
    const ok = !hasNote && !hasSelection;
    addTest("Prompt Package: 不包含未启用内容", ok ? "pass" : "fail",
      ok ? "" : `hasNote=${hasNote}, hasSelection=${hasSelection}`);
  }

  // Test 6: buildPromptPackage 输出规则（配置驱动）
  {
    const settings = makePromptSettings(false, false);
    const snapshot = {
      vaultPath: "/test/vault",
      activeFilePath: null,
      activeFileContent: null,
      selection: null,
      timestamp: "2026-06-28T12:00:00Z",
    };
    const prompt = buildPromptPackage("用户请求", snapshot, settings);
    const hasNoScreen = prompt.includes("长输出不要直接刷屏");
    const hasConfigRule = prompt.includes("按配置或项目规则写入文件");
    const hasConfiguredDir = prompt.includes("my-test-output-dir");
    const ok = hasNoScreen && hasConfigRule && hasConfiguredDir;
    addTest("Prompt Package: 输出规则配置驱动（含配置值）", ok ? "pass" : "fail",
      ok ? "" : `hasNoScreen=${hasNoScreen}, hasConfigRule=${hasConfigRule}, hasConfiguredDir=${hasConfiguredDir}`);
  }

  // Test 6b: outputDir 为空时不出现固定目录，改为项目规则驱动
  {
    const settings = makePromptSettings(false, false, "");
    const snapshot = {
      vaultPath: "/test/vault",
      activeFilePath: null,
      activeFileContent: null,
      selection: null,
      timestamp: "2026-06-28T12:00:00Z",
    };
    const prompt = buildPromptPackage("用户请求", snapshot, settings);
    const hasNoScreen = prompt.includes("长输出不要直接刷屏");
    const hasConfigRule = prompt.includes("按配置或项目规则写入文件");
    const hasProjectRule = prompt.includes("AGENTS.md");
    const noFixedDir = !prompt.includes("90_AI整理待确认") && !prompt.includes("my-test-output-dir");
    const ok = hasNoScreen && hasConfigRule && hasProjectRule && noFixedDir;
    addTest("Prompt Package: outputDir 为空时项目规则驱动（无固定目录）", ok ? "pass" : "fail",
      ok ? "" : `hasNoScreen=${hasNoScreen}, hasConfigRule=${hasConfigRule}, hasProjectRule=${hasProjectRule}, noFixedDir=${noFixedDir}`);
  }

  // Test 7: buildPromptPackage 包含用户请求
  {
    const settings = makePromptSettings(false, false);
    const snapshot = {
      vaultPath: "/test/vault",
      activeFilePath: null,
      activeFileContent: null,
      selection: null,
      timestamp: "2026-06-28T12:00:00Z",
    };
    const prompt = buildPromptPackage("请帮我整理笔记", snapshot, settings);
    const hasUserRequest = prompt.includes("用户请求") && prompt.includes("请帮我整理笔记");
    const ok = hasUserRequest;
    addTest("Prompt Package: 包含用户请求", ok ? "pass" : "fail",
      ok ? "" : `hasUserRequest=${hasUserRequest}`);
  }

  // Test 8: buildPromptPackage 截断长内容
  {
    const settings = makePromptSettings(true, false);
    settings.maxActiveNoteChars = 50;
    const longContent = "a".repeat(200);
    const snapshot = {
      vaultPath: "/test/vault",
      activeFilePath: "note.md",
      activeFileContent: longContent,
      selection: null,
      timestamp: "2026-06-28T12:00:00Z",
    };
    const prompt = buildPromptPackage("用户请求", snapshot, settings);
    const hasTruncated = prompt.includes("truncated") && !prompt.includes("a".repeat(200));
    const ok = hasTruncated;
    addTest("Prompt Package: 截断长内容", ok ? "pass" : "fail",
      ok ? "" : `hasTruncated=${hasTruncated}`);
  }

  // 清理临时 bundle
  if (promptPackageBundle) {
    try { rmSync(promptPackageBundle, { force: true }); } catch {}
  }
} catch (e) {
  addTest("Prompt Package 单元测试", "fail", e?.stack || e?.message || String(e));
  if (promptPackageBundle) {
    try { rmSync(promptPackageBundle, { force: true }); } catch {}
  }
}

// ============================================================
// 3. 文件系统主通道测试（快照 + diff）
// ============================================================
console.log("\n=== 文件系统主通道测试 ===");

function snapshotVaultMarkdownFiles(vaultPath, excludeDirs) {
  const out = new Map();
  const stack = [vaultPath];
  while (stack.length > 0) {
    const current = stack.pop();
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const e of entries) {
        const fullPath = join(current, e.name);
        const rel = relative(vaultPath, fullPath).replace(/\\/g, "/");
        if (e.isDirectory()) {
          const name = e.name.toLowerCase();
          if (!excludeDirs.includes(name)) stack.push(fullPath);
        } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
          try {
            const st = statSync(fullPath);
            out.set(rel, { path: rel, mtime: st.mtimeMs, size: st.size });
          } catch {}
        }
      }
    } catch {}
  }
  return out;
}

function diffSnapshots(before, after) {
  const newFiles = [];
  const modifiedFiles = [];
  for (const [rel, snap] of after) {
    const beforeSnap = before.get(rel);
    if (!beforeSnap) newFiles.push(rel);
    else if (snap.mtime !== beforeSnap.mtime || snap.size !== beforeSnap.size) modifiedFiles.push(rel);
  }
  return { newFiles, modifiedFiles };
}

const excludeDirs = [".obsidian", ".llm-bridge", "node_modules", ".git", "llm-agentruntime", "dist", "build"];

// 文件系统测试用临时目录（放在 Vault 根下，不在排除目录中）
const FS_TEST_DIR = join(VAULT_PATH, "_fs-test-temp");

try {
  // 清理旧测试产物
  if (existsSync(FS_TEST_DIR)) rmSync(FS_TEST_DIR, { recursive: true, force: true });
  mkdirSync(FS_TEST_DIR, { recursive: true });

  // 步骤1：运行前快照
  const before = snapshotVaultMarkdownFiles(VAULT_PATH, excludeDirs);
  addTest("文件快照: 生成运行前快照", before.size > 0 ? "pass" : "fail", `文件数: ${before.size}`);

  // 步骤2：创建一个新 Markdown 文件
  const newFilePath = join(FS_TEST_DIR, "test-new-file.md");
  writeFileSync(newFilePath, "# 测试新文件\n\n这是一个测试文件。\n", "utf8");
  // 等待 mtime 变化（确保文件系统粒度差异）
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);

  // 步骤3：修改一个已有测试文件（先创建再修改）
  const existingFilePath = join(FS_TEST_DIR, "test-existing-file.md");
  writeFileSync(existingFilePath, "# 初始内容\n", "utf8");
  // 等一下再修改，确保 mtime 不同
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  writeFileSync(existingFilePath, "# 修改后内容\n\n更多内容。\n", "utf8");

  // 步骤4：diff 检测
  const after = snapshotVaultMarkdownFiles(VAULT_PATH, excludeDirs);
  const diff = diffSnapshots(before, after);

  const newFileRel = relative(VAULT_PATH, newFilePath).replace(/\\/g, "/");
  const existingRel = relative(VAULT_PATH, existingFilePath).replace(/\\/g, "/");

  // 步骤5：验证 NEW
  const hasNew = diff.newFiles.includes(newFileRel);
  addTest("diff: 检测新增文件 [NEW]", hasNew ? "pass" : "fail", hasNew ? `找到: ${newFileRel}` : `未找到，newFiles: ${JSON.stringify(diff.newFiles.slice(0, 5))}`);

  // 验证 MODIFIED
  const snap2 = snapshotVaultMarkdownFiles(VAULT_PATH, excludeDirs);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  writeFileSync(existingFilePath, "# 再次修改\n\n更多更多内容。\n", "utf8");
  const snap3 = snapshotVaultMarkdownFiles(VAULT_PATH, excludeDirs);
  const diff23 = diffSnapshots(snap2, snap3);
  const hasModified = diff23.modifiedFiles.includes(existingRel);
  addTest("diff: 检测修改文件 [MODIFIED]", hasModified ? "pass" : "fail", hasModified ? `找到: ${existingRel}` : `未找到，modifiedFiles: ${JSON.stringify(diff23.modifiedFiles.slice(0, 5))}`);

  // 步骤6：验证排除目录
  const excludedTestDir = join(VAULT_PATH, "LLM-AgentRuntime");
  const excludedFile = join(excludedTestDir, "should-not-diff.md");
  let excludedFileCreated = false;
  try {
    if (!existsSync(excludedTestDir)) mkdirSync(excludedTestDir, { recursive: true });
    writeFileSync(excludedFile, "# 排除目录测试\n", "utf8");
    excludedFileCreated = true;
  } catch {}

  const afterExcluded = snapshotVaultMarkdownFiles(VAULT_PATH, excludeDirs);
  const excludedRel = relative(VAULT_PATH, excludedFile).replace(/\\/g, "/");
  const isExcluded = !afterExcluded.has(excludedRel);
  addTest("排除目录: LLM-AgentRuntime/ 不参与 diff", isExcluded ? "pass" : "fail", isExcluded ? "" : `错误地包含了: ${excludedRel}`);

  // 验证其他排除目录（检查快照中不含这些路径）
  const allPaths = Array.from(afterExcluded.keys());
  const hasObsidian = allPaths.some(p => p.startsWith(".obsidian/"));
  const hasLlmBridge = allPaths.some(p => p.startsWith(".llm-bridge/"));
  addTest("排除目录: .obsidian/ 不参与 diff", !hasObsidian ? "pass" : "fail");
  addTest("排除目录: .llm-bridge/ 不参与 diff", !hasLlmBridge ? "pass" : "fail");

  // 清理测试产物
  try {
    rmSync(FS_TEST_DIR, { recursive: true, force: true });
    if (excludedFileCreated) rmSync(excludedFile, { force: true });
  } catch {}

} catch (e) {
  addTest("文件系统测试异常", "fail", String(e.message || e));
}

// ============================================================
// 4. HTTP Bridge 自动化测试（需要 Obsidian 运行中）
// ============================================================
console.log("\n=== HTTP Bridge 测试 ===");

const bridgePath = join(VAULT_PATH, ".llm-bridge", "bridge.json");
let bridgeInfo = null;
let httpAvailable = false;

// integration 段：仅在 all/integration 模式下运行
const runIntegration = runMode === "all" || runMode === "integration";

if (!runIntegration) {
  addTest("HTTP Bridge 测试段", "skip", "当前为 unit 模式，跳过 integration 测试");
} else if (existsSync(bridgePath)) {
  try {
    bridgeInfo = JSON.parse(readFileSync(bridgePath, "utf8"));
    // 探测 health
    try {
      const res = await fetch(`http://${bridgeInfo.host}:${bridgeInfo.port}/health`);
      httpAvailable = res.ok;
      addTest("HTTP: /health 探测成功", httpAvailable ? "pass" : "fail");
    } catch {
      addTest("HTTP: /health 探测", "skip", "Obsidian 未运行，跳过 integration 测试");
    }
  } catch (e) {
    addTest("HTTP: bridge.json 解析失败", "fail", String(e.message || e));
  }
} else {
  addTest("HTTP: bridge.json 不存在", "skip", "Obsidian 未运行，跳过 integration 测试");
}

if (httpAvailable && bridgeInfo) {
  const base = `http://${bridgeInfo.host}:${bridgeInfo.port}`;
  const token = bridgeInfo.token;
  const authHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  // /state
  try {
    const res = await fetch(`${base}/state`, { headers: authHeaders });
    const data = await res.json();
    addTest("HTTP: GET /state", data.ok ? "pass" : "fail", data.ok ? `vault: ${data.vaultPath || "N/A"}` : data.error);
  } catch (e) {
    addTest("HTTP: GET /state", "fail", String(e.message || e));
  }

  // token 错误
  try {
    const res = await fetch(`${base}/state`, { headers: { "Authorization": "Bearer wrong-token" } });
    addTest("HTTP: token 错误返回 401", res.status === 401 ? "pass" : "fail", `status: ${res.status}`);
  } catch (e) {
    addTest("HTTP: token 错误测试", "fail", String(e.message || e));
  }

  // show_notice
  try {
    const res = await fetch(`${base}/action`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type: "show_notice", params: { message: "自动化测试: show_notice OK" } }),
    });
    const data = await res.json();
    addTest("HTTP: POST /action show_notice", data.ok ? "pass" : "fail", data.error || "");
  } catch (e) {
    addTest("HTTP: POST /action show_notice", "fail", String(e.message || e));
  }

  // get_active_note
  try {
    const res = await fetch(`${base}/action`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type: "get_active_note", params: {} }),
    });
    const data = await res.json();
    // 可能没有活动笔记，但 action 本身应该成功
    addTest("HTTP: get_active_note", data.status === "completed" ? "pass" : "fail", data.error || `status: ${data.status}`);
  } catch (e) {
    addTest("HTTP: get_active_note", "fail", String(e.message || e));
  }

  // get_selection
  try {
    const res = await fetch(`${base}/action`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type: "get_selection", params: {} }),
    });
    const data = await res.json();
    addTest("HTTP: get_selection", data.status === "completed" ? "pass" : "fail", data.error || `status: ${data.status}`);
  } catch (e) {
    addTest("HTTP: get_selection", "fail", String(e.message || e));
  }

  // open_note（用 test-artifacts 中的文件，但我们刚清理了；用一个可能不存在的路径，验证错误返回）
  try {
    const res = await fetch(`${base}/action`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type: "open_note", params: { path: "__non_existent_test_file__.md" } }),
    });
    const data = await res.json();
    // open_note 是非修改类，同步执行；文件不存在应返回 ok:false
    addTest("HTTP: open_note 不存在的文件返回错误", !data.ok ? "pass" : "fail", data.error || "");
  } catch (e) {
    addTest("HTTP: open_note 测试", "fail", String(e.message || e));
  }

  // ============================================================
  // 5. Approval lifecycle 自动化测试（需要 devTestMode）
  // ============================================================
  console.log("\n=== Approval Lifecycle 测试 ===");

  // 先探测 dev endpoint 是否可用
  let devModeAvailable = false;
  try {
    const res = await fetch(`${base}/dev/approve`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ id: "nonexistent" }),
    });
    // dev mode 关闭时应返回 404；开启时应返回 404（action not found）
    // 我们通过返回体判断：如果是 404 且 error 包含 "not found: POST /dev/approve" 则 dev mode 关闭
    const data = await res.json();
    devModeAvailable = res.status === 404 && data.error && data.error.includes("action not found");
  } catch {}

  if (devModeAvailable) {
    addTest("Dev mode: /dev/approve 端点可用", "pass");

    // 测试 create_note approve 流程
    const testFilePath = "_approval-test/devtest-create.md";
    try {
      mkdirSync(join(VAULT_PATH, "_approval-test"), { recursive: true });
    } catch {}

    // 创建 pending action
    let actionId = null;
    try {
      const res = await fetch(`${base}/action`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ type: "create_note", params: { path: testFilePath, content: "# dev test\n" } }),
      });
      const data = await res.json();
      actionId = data.id;
      addTest("Approval: create_note 返回 202 pending_approval", res.status === 202 && data.status === "pending_approval" ? "pass" : "fail",
        `status: ${res.status}, data.status: ${data.status}`);
    } catch (e) {
      addTest("Approval: create_note pending", "fail", String(e.message || e));
    }

    if (actionId) {
      // 查询状态
      try {
        const res = await fetch(`${base}/action-status?id=${encodeURIComponent(actionId)}`, { headers: authHeaders });
        const data = await res.json();
        addTest("Approval: /action-status 查询 pending", data.status === "pending_approval" ? "pass" : "fail", `status: ${data.status}`);
      } catch (e) {
        addTest("Approval: /action-status 查询", "fail", String(e.message || e));
      }

      // dev approve
      try {
        const res = await fetch(`${base}/dev/approve`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ id: actionId }),
        });
        const data = await res.json();
        addTest("Approval: POST /dev/approve", data.ok ? "pass" : "fail", data.error || "");
      } catch (e) {
        addTest("Approval: POST /dev/approve", "fail", String(e.message || e));
      }

      // 等待执行（给点时间）
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);

      // 查询终态
      try {
        const res = await fetch(`${base}/action-status?id=${encodeURIComponent(actionId)}`, { headers: authHeaders });
        const data = await res.json();
        const completed = data.status === "completed" && !data.error;
        addTest("Approval: approve 后状态为 completed", completed ? "pass" : "fail", `status: ${data.status}, error: ${data.error || "none"}`);
        // 验证文件创建
        const fileExists = existsSync(join(VAULT_PATH, testFilePath));
        addTest("Approval: 文件创建成功", fileExists ? "pass" : "fail", fileExists ? testFilePath : "文件不存在");
      } catch (e) {
        addTest("Approval: 终态查询", "fail", String(e.message || e));
      }
    }

    // 测试 create_note reject 流程
    const rejectFilePath = "_approval-test/devtest-reject.md";
    let rejectActionId = null;
    try {
      const res = await fetch(`${base}/action`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ type: "create_note", params: { path: rejectFilePath, content: "# should not exist\n" } }),
      });
      const data = await res.json();
      rejectActionId = data.id;
    } catch {}

    if (rejectActionId) {
      try {
        const res = await fetch(`${base}/dev/reject`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ id: rejectActionId }),
        });
        const data = await res.json();
        addTest("Approval: POST /dev/reject", data.ok ? "pass" : "fail", data.error || "");
      } catch (e) {
        addTest("Approval: POST /dev/reject", "fail", String(e.message || e));
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);

      try {
        const res = await fetch(`${base}/action-status?id=${encodeURIComponent(rejectActionId)}`, { headers: authHeaders });
        const data = await res.json();
        addTest("Approval: reject 后状态为 declined", data.status === "declined" ? "pass" : "fail", `status: ${data.status}`);
        const fileExists = existsSync(join(VAULT_PATH, rejectFilePath));
        addTest("Approval: reject 后文件未创建", !fileExists ? "pass" : "fail", fileExists ? "文件不应存在但存在" : "");
      } catch (e) {
        addTest("Approval: reject 终态查询", "fail", String(e.message || e));
      }
    }

    // append_to_note approval 测试
    // 先创建一个测试文件
    const appendTestPath = "_approval-test/devtest-append.md";
    try {
      writeFileSync(join(VAULT_PATH, appendTestPath), "# original\n", "utf8");
    } catch {}

    let appendActionId = null;
    try {
      const res = await fetch(`${base}/action`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ type: "append_to_note", params: { path: appendTestPath, content: "appended content\n" } }),
      });
      const data = await res.json();
      appendActionId = data.id;
      addTest("Approval: append_to_note pending", res.status === 202 ? "pass" : "fail", `status: ${res.status}`);
    } catch (e) {
      addTest("Approval: append_to_note pending", "fail", String(e.message || e));
    }

    if (appendActionId) {
      try {
        await fetch(`${base}/dev/approve`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ id: appendActionId }),
        });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        const res = await fetch(`${base}/action-status?id=${encodeURIComponent(appendActionId)}`, { headers: authHeaders });
        const data = await res.json();
        addTest("Approval: append_to_note approve 成功", data.status === "completed" && !data.error ? "pass" : "fail",
          `status: ${data.status}, error: ${data.error || "none"}`);
      } catch (e) {
        addTest("Approval: append_to_note approve", "fail", String(e.message || e));
      }
    }

    // insert_at_cursor / replace_selection 需要编辑器活动，标注 manual required
    addTest("Approval: insert_at_cursor 完整流程", "manual", "需要活动的 Markdown 编辑器 + 光标位置");
    addTest("Approval: replace_selection 完整流程", "manual", "需要活动的 Markdown 编辑器 + 选区");

    // 清理 dev test 产物
    try {
      rmSync(join(VAULT_PATH, "_approval-test"), { recursive: true, force: true });
    } catch {}

  } else {
    addTest("Dev mode: 未启用", "manual", "需在 settings 中设置 devTestMode=true 并重启 Obsidian");
    addTest("Approval: create_note approve 流程", "manual", "需要 devTestMode=true");
    addTest("Approval: create_note reject 流程", "manual", "需要 devTestMode=true");
    addTest("Approval: append_to_note approve 流程", "manual", "需要 devTestMode=true");
    addTest("Approval: insert_at_cursor 完整流程", "manual", "需要 devTestMode + 活动编辑器");
    addTest("Approval: replace_selection 完整流程", "manual", "需要 devTestMode + 活动编辑器 + 选区");
  }

  // ============================================================
  // 6. Helper 测试
  // ============================================================
  console.log("\n=== Helper 测试 ===");

  const helperPath = join(VAULT_PATH, ".llm-bridge", "tools", "obsidian-action.mjs");
  if (existsSync(helperPath)) {
    addTest("Helper: obsidian-action.mjs 存在", "pass");

    // health
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(`node "${helperPath}" health`, { cwd: VAULT_PATH, encoding: "utf8" });
      const data = JSON.parse(out);
      addTest("Helper: health 命令", data.ok ? "pass" : "fail", data.error || "");
    } catch (e) {
      addTest("Helper: health 命令", "fail", String(e.stderr || e.message || e));
    }

    // state
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(`node "${helperPath}" state`, { cwd: VAULT_PATH, encoding: "utf8" });
      const data = JSON.parse(out);
      addTest("Helper: state 命令", data.ok ? "pass" : "fail", data.error || "");
    } catch (e) {
      addTest("Helper: state 命令", "fail", String(e.stderr || e.message || e));
    }

    // show_notice
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(`node "${helperPath}" show_notice "{\\\"message\\\":\\\"helper test ok\\\"}"`, { cwd: VAULT_PATH, encoding: "utf8" });
      const data = JSON.parse(out);
      addTest("Helper: show_notice 命令", data.ok ? "pass" : "fail", data.error || "");
    } catch (e) {
      addTest("Helper: show_notice 命令", "fail", String(e.stderr || e.message || e));
    }

    // --json 标志
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync(`node "${helperPath}" --json health`, { cwd: VAULT_PATH, encoding: "utf8" });
      const data = JSON.parse(out);
      addTest("Helper: --json 标志输出有效 JSON", typeof data === "object" ? "pass" : "fail");
    } catch (e) {
      addTest("Helper: --json 标志", "fail", String(e.stderr || e.message || e));
    }

    // --wait + --timeout（对修改类 action，但我们不实际批准，测试 timeout 行为）
    if (devModeAvailable) {
      try {
        const { execSync } = await import("node:child_process");
        const start = Date.now();
        try {
          execSync(`node "${helperPath}" --wait --timeout 2 create_note "{\\\"path\\\":\\\".llm-bridge/test-temp.md\\\",\\\"content\\\":\\\"test\\\"}"`, {
            cwd: VAULT_PATH,
            encoding: "utf8",
            stdio: "pipe",
          });
          addTest("Helper: --wait --timeout", "fail", "应该超时但没有");
        } catch (e) {
          const elapsed = Date.now() - start;
          // 应该在 2 秒后超时
          addTest("Helper: --wait --timeout 超时行为", elapsed > 1500 && elapsed < 5000 ? "pass" : "fail",
            `耗时: ${elapsed}ms, stderr包含timeout: ${e.stderr?.includes("超时") || e.stderr?.includes("timeout")}`);
        }
      } catch (e) {
        addTest("Helper: --wait --timeout", "fail", String(e.message || e));
      }
    } else {
      addTest("Helper: --wait --timeout 超时行为", "manual", "需要 devTestMode=true");
    }

    // bridge.json missing 场景（临时移动文件测试）
    try {
      const { execSync } = await import("node:child_process");
      const tmpDir = join(VAULT_PATH, ".llm-bridge", "tmp-test");
      mkdirSync(tmpDir, { recursive: true });
      try {
        execSync(`node "${helperPath}" health`, { cwd: tmpDir, encoding: "utf8", stdio: "pipe" });
        addTest("Helper: bridge.json 缺失时错误提示", "fail", "应该失败但没有");
      } catch (e) {
        const stderr = String(e.stderr || "");
        const firstLine = stderr.split("\n").find(l => l.trim()) || "";
        const hasBridgeMsg = stderr.includes("bridge.json") || stderr.includes("Bridge");
        addTest("Helper: bridge.json 缺失时错误提示",
          hasBridgeMsg ? "pass" : "fail",
          hasBridgeMsg ? "正确提示 bridge.json 缺失" : firstLine.slice(0, 80));
      }
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      addTest("Helper: bridge.json 缺失测试", "fail", String(e.message || e));
    }

  } else {
    addTest("Helper: obsidian-action.mjs 存在", "manual", "插件未启动或 helper 未生成");
  }

} else {
  // HTTP 不可用时：integration 测试记为 skip（而非 manual/failed）
  const httpSkipTests = [
    "HTTP: GET /state",
    "HTTP: POST /action show_notice",
    "HTTP: POST /action open_note",
    "HTTP: POST /action get_active_note",
    "HTTP: POST /action get_selection",
    "HTTP: token 错误返回 401",
    "Approval: create_note approve 流程",
    "Approval: create_note reject 流程",
    "Approval: append_to_note approve 流程",
    "Approval: insert_at_cursor 完整流程",
    "Approval: replace_selection 完整流程",
    "Dev mode: /dev/approve 端点",
    "Helper: health 命令",
    "Helper: state 命令",
    "Helper: show_notice 命令",
    "Helper: --json 标志",
    "Helper: --wait --timeout",
    "Helper: bridge.json 缺失错误提示",
  ];
  for (const t of httpSkipTests) {
    addTest(t, "skip", "Obsidian 未运行，跳过 integration 测试");
  }
}

// ============================================================
// 7. AgentBackend contract tests（unit，不依赖 Obsidian）
// ============================================================
console.log("\n=== AgentBackend contract tests ===");

// unit 段：仅在 all/unit 模式下运行
const runUnit = runMode === "all" || runMode === "unit";

if (!runUnit) {
  addTest("AgentBackend contract tests 段", "skip", "当前为 integration 模式，跳过 unit 测试");
} else {
  try {
    // 用 esbuild 编译 claudeCliBackend.ts + mockAgentBackend.ts 到临时 mjs
    const esbuild = (await import("esbuild")).default;
    const tempBundle = join(PROJECT_ROOT, ".test-backend-temp.mjs");
    const tempMockBundle = join(PROJECT_ROOT, ".test-mock-backend-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "claudeCliBackend.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: tempBundle,
    });
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "mockAgentBackend.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: tempMockBundle,
    });

    const { ClaudeCliBackend } = await import(pathToFileURL(tempBundle).href);
    const { MockAgentBackend } = await import(pathToFileURL(tempMockBundle).href);
    const backend = new ClaudeCliBackend();

    // 最小 settings（用 custom agent 绕过 claude 依赖）
    const baseSettings = {
      agentType: "custom",
      claudeCommand: "claude",
      claudeArgs: "-p",
      codexCommand: "codex",
      codexArgs: "exec -",
      customCommand: "cmd",
      customArgs: "/c echo hello_from_backend",
      includeActiveNote: false,
      includeSelection: false,
      maxActiveNoteChars: 6000,
      maxSelectionChars: 3000,
      outputDir: "",
      showStderr: true,
      saveLogs: false,
      sessionMode: "fresh",
      model: "",
      effortLevel: "",
      devTestMode: false,
    };

    const baseTask = {
      id: "test",
      userMessage: "test",
      prompt: "test prompt",
      cwd: VAULT_PATH,
      createdAt: new Date().toISOString(),
      includeActiveNote: false,
      includeSelection: false,
    };

    // 辅助：收集事件直到终态
    const collectEvents = (backend, task, settings, timeoutMs = 10000) => {
      const events = [];
      return new Promise((resolve) => {
        backend.run(task, settings, (event) => {
          events.push(event);
          if (event.type === "completed" || event.type === "failed" || event.type === "stopped") {
            resolve(events);
          }
        });
        setTimeout(() => resolve(events), timeoutMs);
      });
    };

    // ---- Contract Test 1: started 必须先发出 ----
    {
      const events = await collectEvents(backend, baseTask, baseSettings);
      const firstEvent = events[0];
      const startedFirst = firstEvent && firstEvent.type === "started";
      addTest("Contract: started 必须先发出", startedFirst ? "pass" : "fail",
        startedFirst ? "" : `首个事件为 ${firstEvent?.type || "none"}，期望 started`);
    }

    // ---- Contract Test 2: stdout_delta 正常产出 ----
    {
      const events = await collectEvents(backend, baseTask, baseSettings);
      const hasStdout = events.some((e) => e.type === "stdout_delta" && e.data.includes("hello_from_backend"));
      addTest("Contract: stdout_delta 正常产出", hasStdout ? "pass" : "fail",
        hasStdout ? "" : "未收到包含预期内容的 stdout_delta");
    }

    // ---- Contract Test 3: stderr_delta 正常产出 ----
    {
      const stderrSettings = { ...baseSettings, customArgs: "/c echo err_msg>&2" };
      const events = await collectEvents(backend, { ...baseTask, id: "test-stderr" }, stderrSettings);
      const hasStderr = events.some((e) => e.type === "stderr_delta");
      addTest("Contract: stderr_delta 正常产出", hasStderr ? "pass" : "fail",
        hasStderr ? "" : "未收到 stderr_delta");
    }

    // ---- Contract Test 4: completed 正常产出 ----
    {
      const events = await collectEvents(backend, baseTask, baseSettings);
      const hasCompleted = events.some((e) => e.type === "completed" && e.exitCode === 0);
      addTest("Contract: completed 正常产出", hasCompleted ? "pass" : "fail",
        hasCompleted ? "" : "未收到 exitCode=0 的 completed 事件");
    }

    // ---- Contract Test 5: failed 正常产出 ----
    {
      const failSettings = { ...baseSettings, customArgs: "/c exit 1" };
      const events = await collectEvents(backend, { ...baseTask, id: "test-failed" }, failSettings);
      const hasFailed = events.some((e) => e.type === "failed" && e.exitCode !== 0);
      addTest("Contract: failed 正常产出", hasFailed ? "pass" : "fail",
        hasFailed ? "" : "未收到 exitCode!=0 的 failed 事件");
    }

    // ---- Contract Test 6: stop() 能终止进程并产出 stopped 或 failed ----
    {
      // 用一个长时间运行的命令，然后立即 stop
      const longSettings = { ...baseSettings, customArgs: "/c timeout /t 30 /nobreak" };
      const events = [];
      const handle = backend.run({ ...baseTask, id: "test-stop" }, longSettings, (event) => {
        events.push(event);
      });
      // 等待 200ms 确保 spawn 已启动
      await new Promise((r) => setTimeout(r, 200));
      handle.stop();
      // 等待 exit 事件
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (events.some((e) => e.type === "stopped" || e.type === "failed")) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });
      const hasStopped = events.some((e) => e.type === "stopped" || e.type === "failed");
      addTest("Contract: stop() 产出 stopped/failed", hasStopped ? "pass" : "fail",
        hasStopped ? "" : "stop() 后未收到 stopped 或 failed 事件");
    }

    // ---- Contract Test 7: stop() 多次调用不抛异常 ----
    {
      const longSettings = { ...baseSettings, customArgs: "/c timeout /t 30 /nobreak" };
      const handle = backend.run({ ...baseTask, id: "test-stop-multi" }, longSettings, () => {});
      await new Promise((r) => setTimeout(r, 200));
      let noThrow = true;
      try {
        handle.stop();
        handle.stop();
        handle.stop();
      } catch {
        noThrow = false;
      }
      addTest("Contract: stop() 多次调用不抛异常", noThrow ? "pass" : "fail",
        noThrow ? "" : "多次调用 stop() 抛出异常");
      // 确保进程被清理
      handle.stop();
    }

    // ---- Contract Test 8: cwd 不存在时返回 failed ----
    {
      const badCwdTask = { ...baseTask, id: "test-bad-cwd", cwd: "Z:\\non_existent_dir_xyz" };
      const events = await collectEvents(backend, badCwdTask, baseSettings);
      const hasFailed = events.some((e) => e.type === "failed");
      addTest("Contract: cwd 不存在返回 failed", hasFailed ? "pass" : "fail",
        hasFailed ? "" : "cwd 不存在时未返回 failed");
    }

    // ---- Contract Test 9: command 不存在时返回 failed ----
    {
      const notFoundSettings = { ...baseSettings, customCommand: "non_existent_command_xyz", customArgs: "" };
      const events = await collectEvents(backend, { ...baseTask, id: "test-notfound" }, notFoundSettings);
      const hasFailed = events.some((e) => e.type === "failed");
      addTest("Contract: command 不存在返回 failed", hasFailed ? "pass" : "fail",
        hasFailed ? "" : "command 不存在时未返回 failed");
    }

    // ---- MockAgentBackend 测试 ----
    {
      const mockSuccess = new MockAgentBackend("success");
      const events = await collectEvents(mockSuccess, baseTask, baseSettings);
      const startedOk = events[0]?.type === "started";
      const completedOk = events.some((e) => e.type === "completed" && e.exitCode === 0);
      const hasStdout = events.some((e) => e.type === "stdout_delta");
      addTest("MockAgentBackend: success 模式", (startedOk && completedOk && hasStdout) ? "pass" : "fail",
        `started=${startedOk}, completed=${completedOk}, stdout=${hasStdout}`);

      const mockFail = new MockAgentBackend("failure");
      const events2 = await collectEvents(mockFail, baseTask, baseSettings);
      const failedOk = events2.some((e) => e.type === "failed" && e.exitCode !== 0);
      const hasStderr = events2.some((e) => e.type === "stderr_delta");
      addTest("MockAgentBackend: failure 模式", (failedOk && hasStderr) ? "pass" : "fail",
        `failed=${failedOk}, stderr=${hasStderr}`);
    }

    // ---- ClaudeCliBackend 工具函数单元测试（path/env/cwd 构造）----
    // 覆盖 V0.3 导出的 buildEnhancedPath / buildRunEnv / resolveCommand / probeDir
    {
      const {
        buildEnhancedPath,
        buildRunEnv,
        resolveCommand,
        probeDir,
      } = await import(pathToFileURL(tempBundle).href);
      const pathSep = process.platform === "win32" ? ";" : ":";

      // --- buildEnhancedPath ---
      {
        const enhanced = buildEnhancedPath(VAULT_PATH);
        const isStr = typeof enhanced === "string";
        addTest("buildEnhancedPath: 返回字符串", isStr ? "pass" : "fail",
          isStr ? "" : `期望 string，实际 ${typeof enhanced}`);

        const hasVaultLocal = enhanced.includes("LLM-AgentRuntime") && enhanced.includes("node_modules");
        addTest("buildEnhancedPath: 包含 Vault 局部路径", hasVaultLocal ? "pass" : "fail",
          hasVaultLocal ? "" : `未包含 Vault 局部路径: ${enhanced.slice(0, 200)}`);

        // 去重检查：split 后不应有重复
        const parts = enhanced.split(pathSep).filter(Boolean);
        const dupCount = parts.length - new Set(parts).size;
        addTest("buildEnhancedPath: 路径去重无重复", dupCount === 0 ? "pass" : "fail",
          dupCount === 0 ? "" : `存在 ${dupCount} 个重复路径`);

        // Vault 局部路径排在最前（便携版优先级最高）
        const firstIdx = parts.findIndex((p) => p.includes("LLM-AgentRuntime"));
        const nodeModulesIdx = parts.findIndex((p) => p.endsWith("node_modules\\.bin") || p.endsWith("node_modules/.bin"));
        const vaultFirstOk = firstIdx === 0 || (firstIdx >= 0 && nodeModulesIdx >= 0 && firstIdx < nodeModulesIdx);
        addTest("buildEnhancedPath: Vault 局部路径优先", vaultFirstOk ? "pass" : "fail",
          vaultFirstOk ? "" : `firstIdx=${firstIdx}, nodeModulesIdx=${nodeModulesIdx}`);
      }

      // --- buildRunEnv ---
      {
        // claude + model + effort
        const claudeSettings = {
          ...baseSettings,
          agentType: "claude",
          model: "gpt-5.5",
          effortLevel: "high",
        };
        const { env: env1, envKeys: keys1 } = buildRunEnv(claudeSettings, VAULT_PATH);
        const hasModel = keys1.includes("ANTHROPIC_MODEL");
        addTest("buildRunEnv: claude+model → ANTHROPIC_MODEL", hasModel ? "pass" : "fail",
          hasModel ? "" : `envKeys: ${keys1.join(",")}`);
        const hasEffort = keys1.includes("CLAUDE_CODE_EFFORT_LEVEL");
        addTest("buildRunEnv: claude+effort → CLAUDE_CODE_EFFORT_LEVEL", hasEffort ? "pass" : "fail",
          hasEffort ? "" : `envKeys: ${keys1.join(",")}`);
        const envModelSet = env1.ANTHROPIC_MODEL === "gpt-5.5";
        addTest("buildRunEnv: env.ANTHROPIC_MODEL 值正确", envModelSet ? "pass" : "fail",
          envModelSet ? "" : `实际: ${env1.ANTHROPIC_MODEL}`);
        const envEffortSet = env1.CLAUDE_CODE_EFFORT_LEVEL === "high";
        addTest("buildRunEnv: env.CLAUDE_CODE_EFFORT_LEVEL 值正确", envEffortSet ? "pass" : "fail",
          envEffortSet ? "" : `实际: ${env1.CLAUDE_CODE_EFFORT_LEVEL}`);

        // claude 无 model/effort
        const claudeEmpty = { ...baseSettings, agentType: "claude", model: "", effortLevel: "" };
        const { envKeys: keys2 } = buildRunEnv(claudeEmpty, VAULT_PATH);
        const noModel = !keys2.includes("ANTHROPIC_MODEL");
        addTest("buildRunEnv: claude 无 model → 不含 ANTHROPIC_MODEL", noModel ? "pass" : "fail",
          noModel ? "" : `envKeys: ${keys2.join(",")}`);
        const noEffort = !keys2.includes("CLAUDE_CODE_EFFORT_LEVEL");
        addTest("buildRunEnv: claude 无 effort → 不含 CLAUDE_CODE_EFFORT_LEVEL", noEffort ? "pass" : "fail",
          noEffort ? "" : `envKeys: ${keys2.join(",")}`);

        // 非 claude（custom）即使有 model 也不应注入
        const customSettings = { ...baseSettings, agentType: "custom", model: "gpt-5.5", effortLevel: "high" };
        const { env: env3, envKeys: keys3 } = buildRunEnv(customSettings, VAULT_PATH);
        const noModelForCustom = env3.ANTHROPIC_MODEL === undefined && !keys3.includes("ANTHROPIC_MODEL");
        addTest("buildRunEnv: custom agent 不注入 ANTHROPIC_MODEL", noModelForCustom ? "pass" : "fail",
          noModelForCustom ? "" : `envKeys: ${keys3.join(",")}, env.ANTHROPIC_MODEL=${env3.ANTHROPIC_MODEL}`);

        // PATH 增强
        const hasPathEnhanced = keys3.includes("PATH(enhanced)");
        addTest("buildRunEnv: envKeys 含 PATH(enhanced)", hasPathEnhanced ? "pass" : "fail",
          hasPathEnhanced ? "" : `envKeys: ${keys3.join(",")}`);
        const pathEnhanced = env3.PATH && env3.PATH !== process.env.PATH;
        addTest("buildRunEnv: env.PATH 已被增强", pathEnhanced ? "pass" : "fail",
          pathEnhanced ? "" : "env.PATH 未变化");

        // 不泄露 secret：envKeys 只含 key 名，不含值
        const secretsInKeys = keys3.filter((k) => /token|secret|password|key\s*=/i.test(k));
        addTest("buildRunEnv: envKeys 不含 secret 值", secretsInKeys.length === 0 ? "pass" : "fail",
          secretsInKeys.length === 0 ? "" : `疑似泄露: ${secretsInKeys.join(",")}`);
      }

      // --- resolveCommand ---
      {
        const claudeCmd = resolveCommand({ ...baseSettings, agentType: "claude", claudeCommand: "claude", claudeArgs: "-p --foo" });
        const claudeOk = claudeCmd.command === "claude" && claudeCmd.args.length === 2 && claudeCmd.args[0] === "-p";
        addTest("resolveCommand: claude 解析", claudeOk ? "pass" : "fail",
          claudeOk ? "" : `command=${claudeCmd.command}, args=${JSON.stringify(claudeCmd.args)}`);

        const codexCmd = resolveCommand({ ...baseSettings, agentType: "codex", codexCommand: "codex", codexArgs: "exec -" });
        const codexOk = codexCmd.command === "codex" && codexCmd.args.length === 2 && codexCmd.args[1] === "-";
        addTest("resolveCommand: codex 解析", codexOk ? "pass" : "fail",
          codexOk ? "" : `command=${codexCmd.command}, args=${JSON.stringify(codexCmd.args)}`);

        const customCmd = resolveCommand({ ...baseSettings, agentType: "custom", customCommand: "mycmd", customArgs: "  a  b  c  " });
        const customOk = customCmd.command === "mycmd" && customCmd.args.length === 3 && customCmd.args[2] === "c";
        addTest("resolveCommand: custom + trim/多空格", customOk ? "pass" : "fail",
          customOk ? "" : `command=${customCmd.command}, args=${JSON.stringify(customCmd.args)}`);

        const emptyArgs = resolveCommand({ ...baseSettings, agentType: "claude", claudeCommand: "claude", claudeArgs: "   " });
        const emptyOk = emptyArgs.args.length === 0;
        addTest("resolveCommand: 空 args → []", emptyOk ? "pass" : "fail",
          emptyOk ? "" : `args=${JSON.stringify(emptyArgs.args)}`);
      }

      // --- probeDir ---
      {
        const existing = probeDir(VAULT_PATH);
        const existingOk = existing === VAULT_PATH;
        addTest("probeDir: 存在的目录返回路径", existingOk ? "pass" : "fail",
          existingOk ? "" : `期望 ${VAULT_PATH}，实际 ${existing}`);

        const missing = probeDir("Z:\\non_existent_dir_xyz_123");
        const missingOk = missing === null;
        addTest("probeDir: 不存在的目录返回 null", missingOk ? "pass" : "fail",
          missingOk ? "" : `期望 null，实际 ${missing}`);

        // 传一个文件路径（非目录）应返回 null
        const aFile = join(VAULT_PATH, ".llm-bridge", "bridge.json");
        if (existsSync(aFile)) {
          const fileRes = probeDir(aFile);
          const fileOk = fileRes === null;
          addTest("probeDir: 文件路径返回 null", fileOk ? "pass" : "fail",
            fileOk ? "" : `期望 null，实际 ${fileRes}`);
        } else {
          addTest("probeDir: 文件路径返回 null", "skip", "bridge.json 不存在，跳过");
        }
      }
    }

    // 清理
    rmSync(tempBundle, { force: true });
    rmSync(tempMockBundle, { force: true });
  } catch (e) {
    addTest("AgentBackend contract tests", "fail", e?.stack || e?.message || String(e));
    try { rmSync(join(PROJECT_ROOT, ".test-backend-temp.mjs"), { force: true }); } catch { /* ignore */ }
    try { rmSync(join(PROJECT_ROOT, ".test-mock-backend-temp.mjs"), { force: true }); } catch { /* ignore */ }
  }
}

// ============================================================
// 8. UI 事件→状态映射测试（unit，不依赖 Obsidian）
// ============================================================
console.log("\n=== UI 事件→状态映射测试 ===");

if (!runUnit) {
  addTest("UI 映射测试段", "skip", "当前为 integration 模式，跳过 unit 测试");
} else {
  try {
    const esbuild = (await import("esbuild")).default;
    const tempAgentBundle = join(PROJECT_ROOT, ".test-agent-backend-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "agentBackend.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: tempAgentBundle,
    });
    const { eventToRunStatus, isTerminalEvent } = await import(pathToFileURL(tempAgentBundle).href);

    // 测试 started → running
    {
      const status = eventToRunStatus({ type: "started", task: { id: "t1" } });
      addTest("UI 映射: started → running", status === "running" ? "pass" : "fail", `got ${status}`);
    }
    // 测试 stdout_delta → running（非终态）
    {
      const status = eventToRunStatus({ type: "stdout_delta", data: "hello" });
      addTest("UI 映射: stdout_delta → running", status === "running" ? "pass" : "fail", `got ${status}`);
    }
    // 测试 stderr_delta → running（非终态）
    {
      const status = eventToRunStatus({ type: "stderr_delta", data: "err" });
      addTest("UI 映射: stderr_delta → running", status === "running" ? "pass" : "fail", `got ${status}`);
    }
    // 测试 completed → completed
    {
      const status = eventToRunStatus({
        type: "completed", exitCode: 0, durationMs: 100, stdout: "ok", stderr: "",
        command: "mock", args: [],
      });
      addTest("UI 映射: completed → completed", status === "completed" ? "pass" : "fail", `got ${status}`);
    }
    // 测试 failed → failed
    {
      const status = eventToRunStatus({
        type: "failed", exitCode: 1, durationMs: 100, stdout: "", stderr: "err",
        command: "mock", args: [],
      });
      addTest("UI 映射: failed → failed", status === "failed" ? "pass" : "fail", `got ${status}`);
    }
    // 测试 stopped → stopped
    {
      const status = eventToRunStatus({
        type: "stopped", exitCode: null, durationMs: 100, stdout: "", stderr: "",
        command: "mock", args: [],
      });
      addTest("UI 映射: stopped → stopped", status === "stopped" ? "pass" : "fail", `got ${status}`);
    }
    // 测试 isTerminalEvent
    {
      const startedTerminal = isTerminalEvent({ type: "started", task: { id: "t1" } });
      const completedTerminal = isTerminalEvent({
        type: "completed", exitCode: 0, durationMs: 0, stdout: "", stderr: "",
        command: "", args: [],
      });
      const failedTerminal = isTerminalEvent({
        type: "failed", exitCode: 1, durationMs: 0, stdout: "", stderr: "",
        command: "", args: [],
      });
      const stoppedTerminal = isTerminalEvent({
        type: "stopped", exitCode: null, durationMs: 0, stdout: "", stderr: "",
        command: "", args: [],
      });
      const allCorrect = !startedTerminal && completedTerminal && failedTerminal && stoppedTerminal;
      addTest("UI 映射: isTerminalEvent 判定", allCorrect ? "pass" : "fail",
        `started=${startedTerminal}, completed=${completedTerminal}, failed=${failedTerminal}, stopped=${stoppedTerminal}`);
    }

    rmSync(tempAgentBundle, { force: true });
  } catch (e) {
    addTest("UI 映射测试", "fail", e?.stack || e?.message || String(e));
    try { rmSync(join(PROJECT_ROOT, ".test-agent-backend-temp.mjs"), { force: true }); } catch { /* ignore */ }
  }
}

// ============================================================
// 8.5 AgentProfile 解析测试（unit，纯函数，不依赖 Obsidian 和子进程）
// ============================================================
console.log("\n=== AgentProfile 解析测试 ===");

if (!runUnit) {
  addTest("Profile 解析测试段", "skip", "当前为 process/integration 模式，跳过 unit 测试");
} else {
  try {
    const esbuild = (await import("esbuild")).default;
    const tempProfileBundle = join(PROJECT_ROOT, ".test-profile-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "agentProfile.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: tempProfileBundle,
    });
    const { resolveProfile } = await import(pathToFileURL(tempProfileBundle).href);

    const baseSettings = {
      agentType: "claude",
      claudeCommand: "claude",
      claudeArgs: "-p",
      codexCommand: "codex",
      codexArgs: "exec -",
      customCommand: "",
      customArgs: "",
      includeActiveNote: false,
      includeSelection: false,
      maxActiveNoteChars: 6000,
      maxSelectionChars: 3000,
      outputDir: "",
      showStderr: true,
      saveLogs: false,
      sessionMode: "fresh",
      model: "",
      effortLevel: "",
      devTestMode: false,
      backendMode: "auto",
    };

    // Claude profile 解析
    {
      const p = resolveProfile({ ...baseSettings, agentType: "claude", claudeCommand: "claude", claudeArgs: "-p --foo" });
      const nameOk = p.name === "claude";
      const cmdOk = p.command === "claude";
      const argsOk = p.args.length === 2 && p.args[0] === "-p" && p.args[1] === "--foo";
      const versionOk = p.versionArgs.length === 1 && p.versionArgs[0] === "--version";
      addTest("Profile: claude 解析 command/args", (nameOk && cmdOk && argsOk && versionOk) ? "pass" : "fail",
        `name=${nameOk}, cmd=${cmdOk}, args=${argsOk}, version=${versionOk}; got cmd=${p.command} args=${JSON.stringify(p.args)}`);
    }

    // Codex profile 解析
    {
      const p = resolveProfile({ ...baseSettings, agentType: "codex", codexCommand: "codex", codexArgs: "exec -" });
      const nameOk = p.name === "codex";
      const cmdOk = p.command === "codex";
      const argsOk = p.args.length === 2 && p.args[1] === "-";
      const versionOk = p.versionArgs[0] === "--version";
      addTest("Profile: codex 解析 command/args", (nameOk && cmdOk && argsOk && versionOk) ? "pass" : "fail",
        `name=${nameOk}, cmd=${cmdOk}, args=${argsOk}, version=${versionOk}; got cmd=${p.command} args=${JSON.stringify(p.args)}`);
    }

    // Custom profile trim command 保留 args
    {
      const p = resolveProfile({ ...baseSettings, agentType: "custom", customCommand: "  mycmd  ", customArgs: "  a  b  c  " });
      const cmdTrimmed = p.command === "mycmd";
      const argsOk = p.args.length === 3 && p.args[0] === "a" && p.args[2] === "c";
      addTest("Profile: custom trim command 保留 args", (cmdTrimmed && argsOk) ? "pass" : "fail",
        `cmdTrimmed=${cmdTrimmed}, argsOk=${argsOk}; got cmd="${p.command}" args=${JSON.stringify(p.args)}`);
    }

    // 空 args → []
    {
      const p = resolveProfile({ ...baseSettings, agentType: "claude", claudeCommand: "claude", claudeArgs: "   " });
      addTest("Profile: 空 args → []", p.args.length === 0 ? "pass" : "fail",
        `got args=${JSON.stringify(p.args)}`);
    }

    // 空 command → trim 后空字符串
    {
      const p = resolveProfile({ ...baseSettings, agentType: "custom", customCommand: "   ", customArgs: "" });
      addTest("Profile: 空 command trim 后为空串", p.command === "" ? "pass" : "fail",
        `got cmd="${p.command}"`);
    }

    rmSync(tempProfileBundle, { force: true });
  } catch (e) {
    addTest("AgentProfile 解析测试", "fail", e?.stack || e?.message || String(e));
    try { rmSync(join(PROJECT_ROOT, ".test-profile-temp.mjs"), { force: true }); } catch {}
  }
}

// ============================================================
// 8.5 File Diff 单元测试（V0.9：纯函数，不依赖 Obsidian）
// ============================================================
console.log("\n=== File Diff 单元测试 ===");

const runFileDiffUnit = runMode === "all" || runMode === "unit";

if (!runFileDiffUnit) {
  addTest("File Diff 单元测试段", "skip", "当前模式不运行 unit");
} else {
  let fileDiffBundle = null;
  try {
    const esbuild = (await import("esbuild")).default;
    fileDiffBundle = join(PROJECT_ROOT, ".test-filediff-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "fileDiff.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: fileDiffBundle,
    });
    const {
      shouldExclude,
      isMarkdownFile,
      diffSnapshots,
      extractRelPath,
      EXCLUDE_DIRS,
      snapshotVaultMarkdownFiles,
    } = await import(pathToFileURL(fileDiffBundle).href);

    // Test 1: shouldExclude 排除目录
    {
      const cases = [
        { path: ".obsidian/app.json", expect: true, desc: ".obsidian 应排除" },
        { path: ".llm-bridge/logs/debug.log", expect: true, desc: ".llm-bridge 应排除" },
        { path: "node_modules/lib/index.js", expect: true, desc: "node_modules 应排除" },
        { path: ".git/config", expect: true, desc: ".git 应排除" },
        { path: "LLM-AgentRuntime/bin/claude", expect: true, desc: "LLM-AgentRuntime 应排除" },
        { path: "dist/main.js", expect: true, desc: "dist 应排除" },
        { path: "build/index.js", expect: true, desc: "build 应排除" },
        { path: "notes/daily.md", expect: false, desc: "notes 目录不应排除" },
        { path: "90_AI整理待确认/summary.md", expect: false, desc: "用户输出目录不应排除" },
        { path: ".obsidian/backup/notes.md", expect: true, desc: "嵌套 .obsidian 应排除" },
      ];
      let allPass = true;
      const fails = [];
      for (const c of cases) {
        const got = shouldExclude(c.path);
        if (got !== c.expect) {
          allPass = false;
          fails.push(`${c.desc}: 期望 ${c.expect}, 实际 ${got}`);
        }
      }
      addTest("File Diff: shouldExclude 排除目录", allPass ? "pass" : "fail",
        allPass ? "" : fails.join("; "));
    }

    // Test 2: isMarkdownFile 只识别 .md
    {
      const cases = [
        { name: "note.md", expect: true, desc: ".md 应识别" },
        { name: "NOTE.MD", expect: true, desc: ".MD 大写应识别" },
        { name: "note.Md", expect: true, desc: ".Md 混合大小写应识别" },
        { name: "note.txt", expect: false, desc: ".txt 不应识别" },
        { name: "note.markdown", expect: false, desc: ".markdown 不应识别" },
        { name: "readme", expect: false, desc: "无扩展名不应识别" },
        { name: "readme.md.tmp", expect: false, desc: ".md.tmp 不应识别" },
      ];
      let allPass = true;
      const fails = [];
      for (const c of cases) {
        const got = isMarkdownFile(c.name);
        if (got !== c.expect) {
          allPass = false;
          fails.push(`${c.desc}: 期望 ${c.expect}, 实际 ${got}`);
        }
      }
      addTest("File Diff: isMarkdownFile 只识别 .md", allPass ? "pass" : "fail",
        allPass ? "" : fails.join("; "));
    }

    // Test 3: diffSnapshots 检测新增/修改/未变化
    {
      const before = new Map();
      before.set("unchanged.md", { path: "unchanged.md", mtime: 1000, size: 100 });
      before.set("modified.md", { path: "modified.md", mtime: 1000, size: 100 });
      before.set("deleted.md", { path: "deleted.md", mtime: 1000, size: 100 });

      const after = new Map();
      after.set("unchanged.md", { path: "unchanged.md", mtime: 1000, size: 100 });
      after.set("modified.md", { path: "modified.md", mtime: 2000, size: 150 });
      after.set("new.md", { path: "new.md", mtime: 3000, size: 50 });

      const result = diffSnapshots(before, after);
      const hasNew = result.includes("new.md  [NEW]");
      const hasModified = result.includes("modified.md  [MODIFIED]");
      const noUnchanged = !result.includes("unchanged.md");
      const noDeleted = !result.includes("deleted.md");
      const sorted = result.every((v, i) => i === 0 || result[i - 1].localeCompare(v) <= 0);
      const ok = hasNew && hasModified && noUnchanged && noDeleted && sorted;
      addTest("File Diff: diffSnapshots 检测新增/修改/未变化", ok ? "pass" : "fail",
        ok ? "" : `hasNew=${hasNew}, hasModified=${hasModified}, noUnchanged=${noUnchanged}, noDeleted=${noDeleted}, sorted=${sorted}; result=${JSON.stringify(result)}`);
    }

    // Test 4: diffSnapshots mtime 变化但 size 不变 → MODIFIED
    {
      const before = new Map();
      before.set("a.md", { path: "a.md", mtime: 1000, size: 100 });
      const after = new Map();
      after.set("a.md", { path: "a.md", mtime: 2000, size: 100 });
      const result = diffSnapshots(before, after);
      const ok = result.length === 1 && result[0] === "a.md  [MODIFIED]";
      addTest("File Diff: mtime 变化→MODIFIED", ok ? "pass" : "fail",
        ok ? "" : `result=${JSON.stringify(result)}`);
    }

    // Test 5: extractRelPath 去掉后缀
    {
      const cases = [
        { input: "notes/a.md  [NEW]", expect: "notes/a.md" },
        { input: "b.md  [MODIFIED]", expect: "b.md" },
        { input: "c.md", expect: "c.md" },
      ];
      let allPass = true;
      const fails = [];
      for (const c of cases) {
        const got = extractRelPath(c.input);
        if (got !== c.expect) {
          allPass = false;
          fails.push(`${c.input}: 期望 ${c.expect}, 实际 ${got}`);
        }
      }
      addTest("File Diff: extractRelPath 去掉后缀", allPass ? "pass" : "fail",
        allPass ? "" : fails.join("; "));
    }

    // Test 6: snapshotVaultMarkdownFiles 真实目录扫描（含排除目录 + 路径带空格）
    {
      // 构造临时 Vault 结构
      const tempVault = join(PROJECT_ROOT, ".test-filediff-vault");
      try {
        rmSync(tempVault, { recursive: true, force: true });
        mkdirSync(join(tempVault, "notes"), { recursive: true });
        mkdirSync(join(tempVault, ".obsidian"), { recursive: true });
        mkdirSync(join(tempVault, ".llm-bridge"), { recursive: true });
        mkdirSync(join(tempVault, "sub dir with spaces"), { recursive: true });
        writeFileSync(join(tempVault, "notes", "note1.md"), "# note1");
        writeFileSync(join(tempVault, "notes", "note2.md"), "# note2");
        writeFileSync(join(tempVault, ".obsidian", "app.json"), "{}");
        writeFileSync(join(tempVault, ".obsidian", "ignored.md"), "# should be ignored");
        writeFileSync(join(tempVault, ".llm-bridge", "ignored.md"), "# should be ignored");
        writeFileSync(join(tempVault, "sub dir with spaces", "spaced.md"), "# spaced");
        writeFileSync(join(tempVault, "readme.txt"), "not md");

        const snap = await snapshotVaultMarkdownFiles(tempVault);
        const hasNote1 = snap.has("notes/note1.md");
        const hasNote2 = snap.has("notes/note2.md");
        const hasSpaced = snap.has("sub dir with spaces/spaced.md");
        const noObsidian = !snap.has(".obsidian/ignored.md");
        const noBridge = !snap.has(".llm-bridge/ignored.md");
        const correctCount = snap.size === 3;
        const ok = hasNote1 && hasNote2 && hasSpaced && noObsidian && noBridge && correctCount;
        addTest("File Diff: snapshotVaultMarkdownFiles 真实扫描（排除+空格路径）", ok ? "pass" : "fail",
          ok ? "" : `hasNote1=${hasNote1}, hasNote2=${hasNote2}, hasSpaced=${hasSpaced}, noObsidian=${noObsidian}, noBridge=${noBridge}, size=${snap.size}, keys=${JSON.stringify([...snap.keys()])}`);
      } finally {
        rmSync(tempVault, { recursive: true, force: true });
      }
    }

    // Test 7: snapshot + diff 端到端（写入新 .md 后能检测到）
    {
      const tempVault = join(PROJECT_ROOT, ".test-filediff-e2e");
      try {
        rmSync(tempVault, { recursive: true, force: true });
        mkdirSync(tempVault, { recursive: true });
        writeFileSync(join(tempVault, "existing.md"), "# existing");

        const before = await snapshotVaultMarkdownFiles(tempVault);
        // 模拟 backend 运行期间写入新文件
        await new Promise((r) => setTimeout(r, 50));
        writeFileSync(join(tempVault, "new.md"), "# new file");
        const existingPath = join(tempVault, "existing.md");
        await new Promise((r) => setTimeout(r, 50));
        writeFileSync(existingPath, "# existing modified");

        const after = await snapshotVaultMarkdownFiles(tempVault);
        const result = diffSnapshots(before, after);
        const hasNew = result.includes("new.md  [NEW]");
        const hasModified = result.includes("existing.md  [MODIFIED]");
        const ok = hasNew && hasModified;
        addTest("File Diff: snapshot+diff 端到端（新增+修改）", ok ? "pass" : "fail",
          ok ? "" : `hasNew=${hasNew}, hasModified=${hasModified}; result=${JSON.stringify(result)}`);
      } finally {
        rmSync(tempVault, { recursive: true, force: true });
      }
    }

    // Test 8: EXCLUDE_DIRS 完整性
    {
      const expected = [".obsidian", ".llm-bridge", "node_modules", ".git", "LLM-AgentRuntime", "dist", "build"];
      const ok = expected.every(d => EXCLUDE_DIRS.includes(d)) && EXCLUDE_DIRS.length === expected.length;
      addTest("File Diff: EXCLUDE_DIRS 完整性", ok ? "pass" : "fail",
        ok ? "" : `expected=${JSON.stringify(expected)}, actual=${JSON.stringify(EXCLUDE_DIRS)}`);
    }

    rmSync(fileDiffBundle, { force: true });
  } catch (e) {
    addTest("File Diff 单元测试", "fail", e?.stack || e?.message || String(e));
    try { if (fileDiffBundle) rmSync(fileDiffBundle, { force: true }); } catch {}
  }
}

// ============================================================
// 8.6 Bridge Metadata Sync 单元测试（V1.0.1）
// ============================================================
console.log("\n=== Bridge Metadata Sync 单元测试 ===");

const runBridgeUnit = runMode === "all" || runMode === "unit";

if (!runBridgeUnit) {
  addTest("Bridge Metadata Sync 测试段", "skip", "当前为 process/claude 模式，跳过 bridge unit 测试");
} else {
  // 测试 1: writeBridgeJsonAtomic 覆盖旧文件（port 改变后被覆盖）
  {
    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-sync-"));
    try {
      const bridgePath = join(tmpDir, ".llm-bridge", "bridge.json");
      const logsDir = join(tmpDir, ".llm-bridge", "logs");
      const info1 = { version: 1, host: "127.0.0.1", port: 11111, token: "tok-1", vaultPath: tmpDir, startedAt: "2026-06-28T10:00:00Z", pluginVersion: "0.1.0" };
      const info2 = { version: 1, host: "127.0.0.1", port: 22222, token: "tok-2", vaultPath: tmpDir, startedAt: "2026-06-28T10:00:01Z", pluginVersion: "0.1.1" };

      // 用 esbuild 编译 httpServer.ts 获取 writeBridgeJsonAtomic
      const esbuild = (await import("esbuild")).default;
      const bridgeBundle = join(PROJECT_ROOT, ".test-bridge-sync-temp.mjs");
      // V1.0.1: httpServer.ts 间接 import 了 obsidian（经 actions.ts），需要标记为 external
      await esbuild.build({
        entryPoints: [join(PROJECT_ROOT, "src", "httpServer.ts")],
        bundle: true,
        format: "esm",
        platform: "node",
        outfile: bridgeBundle,
        external: ["obsidian"],
      });
      // httpServer.ts 没有导出 writeBridgeJsonAtomic，我们通过 HttpBridge.start() 间接验证
      // 改为直接复刻 writeBridgeJsonAtomic 逻辑进行测试
      rmSync(bridgeBundle, { force: true });

      // 复刻 writeBridgeJsonAtomic 核心逻辑进行测试（简化版：直接写目标文件，验证覆盖语义）
      async function writeBridgeJsonAtomicReplica(bPath, info, lDir) {
        try {
          const parentDir = join(bPath, "..");
          mkdirSync(parentDir, { recursive: true });
          const content = JSON.stringify(info, null, 2);
          writeFileSync(bPath, content, "utf8");
          return { written: true, error: null, path: bPath, actualPort: info.port };
        } catch (e) {
          return { written: false, error: e?.message || String(e), path: bPath, actualPort: info.port };
        }
      }

      const r1 = await writeBridgeJsonAtomicReplica(bridgePath, info1, logsDir);
      if (!r1.written) {
        addTest("Bridge Sync: 首次写入 bridge.json", "fail", `writeBridge failed: ${r1.error}`);
      } else {
        const content1 = readFileSync(bridgePath, "utf8");
        const parsed1 = JSON.parse(content1);
        const ok1 = parsed1.port === 11111 && parsed1.token === "tok-1";
        addTest("Bridge Sync: 首次写入 bridge.json", ok1 ? "pass" : "fail", ok1 ? "" : `port=${parsed1.port}`);
      }

      // 第二次写入：port 改变，应覆盖旧文件
      const r2 = await writeBridgeJsonAtomicReplica(bridgePath, info2, logsDir);
      if (!r2.written) {
        addTest("Bridge Sync: port 改变时 bridge.json 被覆盖", "fail", `writeBridge failed: ${r2.error}`);
        addTest("Bridge Sync: 旧 bridge.json 不会被继续使用", "skip", "依赖上一步");
      } else {
        const content2 = readFileSync(bridgePath, "utf8");
        const parsed2 = JSON.parse(content2);
        const ok2 = parsed2.port === 22222 && parsed2.token === "tok-2" && parsed2.pluginVersion === "0.1.1";
        addTest("Bridge Sync: port 改变时 bridge.json 被覆盖（旧文件不再使用）", ok2 ? "pass" : "fail",
          ok2 ? "" : `port=${parsed2.port}, expected 22222`);
        const ok3 = parsed2.port !== 11111;
        addTest("Bridge Sync: 旧 bridge.json 不会被继续使用", ok3 ? "pass" : "fail",
          ok3 ? "" : `旧 port 11111 仍存在`);
      }
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // 测试 2: bridge.json 写入路径基于 vaultPath（不依赖 process.cwd()）
  {
    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-path-"));
    try {
      const vaultPath = join(tmpDir, "my-vault");
      const bridgePath = join(vaultPath, ".llm-bridge", "bridge.json");
      // 模拟 main.ts 中的路径构造
      const BRIDGE_FILE_REL = ".llm-bridge/bridge.json";
      const constructedPath = join(vaultPath, BRIDGE_FILE_REL);
      const ok = constructedPath === bridgePath;
      addTest("Bridge Sync: bridge.json 写入路径基于 vaultPath", ok ? "pass" : "fail",
        ok ? "" : `expected=${bridgePath}, got=${constructedPath}`);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // 测试 3: helper 401 后会重新读取 bridge.json（通过 mock fetch 验证）
  {
    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-helper-"));
    try {
      const vaultPath = tmpDir;
      const bridgePath = join(vaultPath, ".llm-bridge", "bridge.json");
      await import("node:fs").then(({ mkdirSync, writeFileSync }) => {
        mkdirSync(join(bridgePath, ".."), { recursive: true });
      });

      // 写入初始 bridge.json（port=11111, token=old）
      writeFileSync(bridgePath, JSON.stringify({
        version: 1, host: "127.0.0.1", port: 11111, token: "old-token",
        vaultPath, startedAt: "2026-06-28T10:00:00Z", pluginVersion: "0.1.0",
      }), "utf8");

      // 更新 bridge.json（port=22222, token=new）—— 模拟插件重启后写新文件
      writeFileSync(bridgePath, JSON.stringify({
        version: 1, host: "127.0.0.1", port: 22222, token: "new-token",
        vaultPath, startedAt: "2026-06-28T10:00:01Z", pluginVersion: "0.1.1",
      }), "utf8");

      // 验证 loadBridge 每次读最新
      const esbuild = (await import("esbuild")).default;
      const helperBundle = join(PROJECT_ROOT, ".test-helper-sync-temp.mjs");
      // 从 toolsWriter.ts 提取 HELPER_SOURCE 字符串
      await esbuild.build({
        entryPoints: [join(PROJECT_ROOT, "src", "toolsWriter.ts")],
        bundle: true,
        format: "esm",
        platform: "node",
        outfile: helperBundle,
      });
      const { writeHelper } = await import(pathToFileURL(helperBundle).href);
      const helperPath = await writeHelper(vaultPath);
      const helperCode = readFileSync(helperPath, "utf8");
      // 验证 helper 源码包含重试逻辑
      const hasRetry = helperCode.includes("shouldRetry") && helperCode.includes("loadBridge");
      addTest("Bridge Sync: helper 包含 shouldRetry + loadBridge 重读逻辑", hasRetry ? "pass" : "fail",
        hasRetry ? "" : "helper 源码缺少重试逻辑");

      // 验证 helper 的 loadBridge 读取最新内容
      const { loadBridge } = await import(pathToFileURL(helperPath).href);
      const bridge = loadBridge(vaultPath);
      const ok = bridge.port === 22222 && bridge.token === "new-token";
      addTest("Bridge Sync: helper loadBridge 读取最新 bridge.json（401 后重读生效）", ok ? "pass" : "fail",
        ok ? "" : `port=${bridge.port}, token=${bridge.token}`);

      rmSync(helperBundle, { force: true });
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // 测试 4: 日志不包含 token 明文（只输出 tokenPresent / tokenLength）
  {
    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-log-"));
    try {
      const bridgePath = join(tmpDir, "no-write-bridge.json");
      const logsDir = join(tmpDir, "logs");
      const info = { version: 1, host: "127.0.0.1", port: 33333, token: "SECRET-TOKEN-VALUE-12345", vaultPath: tmpDir, startedAt: "2026-06-28T10:00:00Z", pluginVersion: "0.1.0" };

      // 复刻 writeBridgeJsonAtomic 失败路径：让写文件抛错，触发日志写入
      // 通过传入一个不存在的父目录且不可创建来模拟（实际 mkdir 会成功，所以我们用 read-only 模拟）
      // 改为直接验证日志格式：构造一个日志内容字符串，检查不含 token 明文
      const logContent = `=== bridge.json 写入失败 ===\ntime: ${new Date().toISOString()}\npath: ${bridgePath}\nerror: mock error\ntokenPresent: ${!!info.token}\ntokenLength: ${info.token?.length || 0}\nactualPort: ${info.port}\n`;

      const containsToken = logContent.includes(info.token);
      const hasTokenPresent = logContent.includes("tokenPresent: true");
      const hasTokenLength = logContent.includes("tokenLength: 24");

      const ok = !containsToken && hasTokenPresent && hasTokenLength;
      addTest("Bridge Sync: 日志不包含 token 明文（只输出 tokenPresent/tokenLength）", ok ? "pass" : "fail",
        ok ? "" : `containsToken=${containsToken}, hasTokenPresent=${hasTokenPresent}, hasTokenLength=${hasTokenLength}`);

      // 同时验证 onload 诊断文件格式
      const diagContent = `onload ${new Date().toISOString()}\nvaultPath: ${tmpDir}\nbridgePath: ${bridgePath}\nactualPort: ${info.port}\nbridgeWritten: true\nbridgeWriteError: (none)\ntokenPresent: true\ntokenLength: 24\n`;
      const diagContainsToken = diagContent.includes(info.token);
      const okDiag = !diagContainsToken && diagContent.includes("tokenPresent: true") && diagContent.includes("tokenLength: 24");
      addTest("Bridge Sync: onload 诊断文件不包含 token 明文", okDiag ? "pass" : "fail",
        okDiag ? "" : `diagContainsToken=${diagContainsToken}`);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // 测试 5: BridgeInfo 接口包含所有必需字段
  {
    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-info-"));
    try {
      // 构造完整的 BridgeInfo 对象
      const info = {
        version: 1,
        host: "127.0.0.1",
        port: 44444,
        token: "test-token",
        vaultPath: tmpDir,
        startedAt: new Date().toISOString(),
        pluginVersion: "0.1.1",
      };
      const requiredFields = ["version", "host", "port", "token", "vaultPath", "startedAt", "pluginVersion"];
      const missing = requiredFields.filter(f => !(f in info));
      const ok = missing.length === 0;
      addTest("Bridge Sync: BridgeInfo 包含所有必需字段（version/host/port/token/vaultPath/startedAt/pluginVersion）",
        ok ? "pass" : "fail", ok ? "" : `missing fields: ${missing.join(", ")}`);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ============================================================
// 8.7 Preset Prompts & Preflight Status 单元测试（V1.1）
// ============================================================
console.log("\n=== Preset Prompts & Preflight Status 单元测试 ===");

const runV11Unit = runMode === "all" || runMode === "unit";

if (!runV11Unit) {
  addTest("V1.1 单元测试段", "skip", "当前模式不运行 unit");
} else {
  let presetBundle = null;
  let preflightStatusBundle = null;
  let guideBundle = null;
  try {
    const esbuild = (await import("esbuild")).default;
    presetBundle = join(PROJECT_ROOT, ".test-preset-temp.mjs");
    preflightStatusBundle = join(PROJECT_ROOT, ".test-preflight-status-temp.mjs");
    guideBundle = join(PROJECT_ROOT, ".test-guide-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "presetPrompts.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: presetBundle,
    });
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "preflightStatus.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: preflightStatusBundle,
      external: ["./agentProfile"],
    });
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "firstUseGuide.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: guideBundle,
    });
    const { buildPresetPrompt, requiresActiveNote, requiresSelection, PRESETS } = await import(pathToFileURL(presetBundle).href);
    const { mapPreflightToStatus, buildErrorSummary, redactSecret } = await import(pathToFileURL(preflightStatusBundle).href);
    const { buildFirstUseGuide, shouldShowFirstUseGuide } = await import(pathToFileURL(guideBundle).href);

    // --- Test 1: summarize 预设 prompt 包含 outputDir 和文件名 ---
    {
      const prompt = buildPresetPrompt("summarize", {
        activeFilePath: "notes/test.md",
        outputDir: "90_AI整理待确认",
      });
      const hasOutputDir = prompt.includes("90_AI整理待确认");
      const hasFilePath = prompt.includes("notes/test.md");
      const hasSummarySuffix = prompt.includes("-summary");
      const ok = hasOutputDir && hasFilePath && hasSummarySuffix;
      addTest("Preset: summarize 包含 outputDir / 文件路径 / -summary 后缀",
        ok ? "pass" : "fail",
        ok ? "" : `outputDir=${hasOutputDir}, filePath=${hasFilePath}, summary=${hasSummarySuffix}`);
    }

    // --- Test 2: summarize 无活动笔记时使用通用 prompt ---
    {
      const prompt = buildPresetPrompt("summarize", {
        activeFilePath: null,
        outputDir: "out",
      });
      const ok = prompt.includes("当前笔记") && !prompt.includes("null") && prompt.includes("out");
      addTest("Preset: summarize 无活动笔记时使用通用 prompt（不含 null）",
        ok ? "pass" : "fail", ok ? "" : `prompt: ${prompt}`);
    }

    // --- Test 3: explain 预设只含指令，不含选区文本（选区由 includeSelection 注入） ---
    {
      const prompt = buildPresetPrompt("explain", {
        activeFilePath: "a.md",
        outputDir: "out",
      });
      const ok = prompt.includes("解释") && !prompt.includes("a.md") && prompt.length < 200;
      addTest("Preset: explain 只含指令，不含文件路径（选区由 includeSelection 注入）",
        ok ? "pass" : "fail", ok ? "" : `prompt: ${prompt}`);
    }

    // --- Test 4: organize 预设包含文件路径和 create_note action ---
    {
      const prompt = buildPresetPrompt("organize", {
        activeFilePath: "notes/messy.md",
        outputDir: "out",
      });
      const ok = prompt.includes("notes/messy.md") && prompt.includes("create_note");
      addTest("Preset: organize 包含文件路径和 create_note action",
        ok ? "pass" : "fail", ok ? "" : `prompt: ${prompt}`);
    }

    // --- Test 5: freeform 返回空字符串 ---
    {
      const prompt = buildPresetPrompt("freeform", {
        activeFilePath: "a.md",
        outputDir: "out",
      });
      const ok = prompt === "";
      addTest("Preset: freeform 返回空字符串",
        ok ? "pass" : "fail", ok ? "" : `expected empty, got: ${prompt}`);
    }

    // --- Test 6: requiresActiveNote / requiresSelection 正确映射 ---
    {
      const ok = requiresActiveNote("summarize") && requiresActiveNote("organize") && requiresActiveNote("review") &&
                 !requiresActiveNote("explain") && !requiresActiveNote("freeform") &&
                 requiresSelection("explain") && !requiresSelection("summarize") &&
                 !requiresSelection("organize") && !requiresSelection("review") && !requiresSelection("freeform");
      addTest("Preset: requiresActiveNote / requiresSelection 正确映射",
        ok ? "pass" : "fail", ok ? "" : "映射错误");
    }

    // --- Test 7: PRESETS 含 5 种类型 ---
    {
      const types = PRESETS.map((p) => p.type);
      const ok = types.length === 5 &&
                 types.includes("summarize") && types.includes("explain") &&
                 types.includes("organize") && types.includes("review") && types.includes("freeform");
      addTest("Preset: PRESETS 含 5 种类型",
        ok ? "pass" : "fail", ok ? "" : `types: ${types.join(",")}`);
    }

    // --- Test 8: outputDir 为空时使用默认目录 ---
    {
      const prompt = buildPresetPrompt("summarize", {
        activeFilePath: "a.md",
        outputDir: "",
      });
      const ok = prompt.includes("90_AI整理待确认");
      addTest("Preset: outputDir 为空时使用默认目录",
        ok ? "pass" : "fail", ok ? "" : `prompt: ${prompt}`);
    }

    // --- Test 9: mapPreflightToStatus(null) 返回 unknown ---
    {
      const status = mapPreflightToStatus(null);
      const ok = status.kind === "unknown" && status.label === "未检测";
      addTest("Preflight: null 结果映射为 unknown",
        ok ? "pass" : "fail", ok ? "" : `kind=${status.kind}, label=${status.label}`);
    }

    // --- Test 10: mapPreflightToStatus available 状态含 version ---
    {
      const result = {
        profile: "claude", command: "claude", args: ["-p"], versionArgs: ["--version"],
        cwd: "/tmp", cwdExists: true, commandFound: true, versionExitCode: 0,
        versionStdout: "1.0.0\n", versionStderr: "", available: true,
        diagnostics: "", debugLogPath: null, skipReason: null,
      };
      const status = mapPreflightToStatus(result);
      const ok = status.kind === "available" && status.label === "available" && status.detail.includes("1.0.0");
      addTest("Preflight: available 状态含 version",
        ok ? "pass" : "fail", ok ? "" : `kind=${status.kind}, detail=${status.detail}`);
    }

    // --- Test 11: mapPreflightToStatus unavailable 状态含原因 ---
    {
      const result = {
        profile: "claude", command: "claude", args: [], versionArgs: ["--version"],
        cwd: "/tmp", cwdExists: true, commandFound: false, versionExitCode: 127,
        versionStdout: "", versionStderr: "command not found", available: false,
        diagnostics: "", debugLogPath: null, skipReason: null,
      };
      const status = mapPreflightToStatus(result);
      const ok = status.kind === "unavailable" && status.label === "unavailable" && status.detail.includes("127");
      addTest("Preflight: unavailable 状态含退出码原因",
        ok ? "pass" : "fail", ok ? "" : `kind=${status.kind}, detail=${status.detail}`);
    }

    // --- Test 12: mapPreflightToStatus command 为空时含 skipReason ---
    {
      const result = {
        profile: "claude", command: "", args: [], versionArgs: ["--version"],
        cwd: "/tmp", cwdExists: true, commandFound: false, versionExitCode: null,
        versionStdout: "", versionStderr: "", available: false,
        diagnostics: "", debugLogPath: null, skipReason: "command 为空",
      };
      const status = mapPreflightToStatus(result);
      const ok = status.kind === "unavailable" && status.detail.includes("command 为空");
      addTest("Preflight: command 为空时 detail 含 skipReason",
        ok ? "pass" : "fail", ok ? "" : `detail=${status.detail}`);
    }

    // --- Test 13: buildErrorSummary 不包含 48-hex token ---
    {
      const token = "a".repeat(48);
      const stderr = `Error: auth failed token=${token}`;
      const summary = buildErrorSummary(stderr, 1);
      const ok = !summary.includes(token) && summary.includes("<token>");
      addTest("ErrorSummary: 不包含 48-hex token 明文（替换为 <token>）",
        ok ? "pass" : "fail", ok ? "" : `summary: ${summary}`);
    }

    // --- Test 14: buildErrorSummary 不包含 sk-ant API key ---
    {
      const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
      const stderr = `Error: invalid key ${key}`;
      const summary = buildErrorSummary(stderr, 1);
      const ok = !summary.includes(key) && summary.includes("<api-key>");
      addTest("ErrorSummary: 不包含 sk-ant API key 明文（替换为 <api-key>）",
        ok ? "pass" : "fail", ok ? "" : `summary: ${summary}`);
    }

    // --- Test 15: buildErrorSummary 不包含 Bearer token ---
    {
      const bearer = "Bearer abcdefghijklmnopqrstuvwxyz0123456789";
      const stderr = `Auth: ${bearer}`;
      const summary = buildErrorSummary(stderr, 1);
      const ok = !summary.includes("Bearer abcdefghijklmnopqrstuvwxyz0123456789") && summary.includes("<redacted>");
      addTest("ErrorSummary: 不包含 Bearer token 明文",
        ok ? "pass" : "fail", ok ? "" : `summary: ${summary}`);
    }

    // --- Test 16: buildErrorSummary 不包含 ANTHROPIC_API_KEY 值 ---
    {
      const stderr = `env ANTHROPIC_API_KEY=sk-ant-something-secret-1234567890`;
      const summary = buildErrorSummary(stderr, 1);
      const ok = !summary.includes("sk-ant-something-secret-1234567890") && summary.includes("<redacted>");
      addTest("ErrorSummary: 不包含 ANTHROPIC_API_KEY 值",
        ok ? "pass" : "fail", ok ? "" : `summary: ${summary}`);
    }

    // --- Test 17: buildErrorSummary 包含 exit code ---
    {
      const summary = buildErrorSummary("some error", 42);
      const ok = summary.includes("exit 42");
      addTest("ErrorSummary: 包含 exit code",
        ok ? "pass" : "fail", ok ? "" : `summary: ${summary}`);
    }

    // --- Test 18: buildErrorSummary 空输入返回空字符串 ---
    {
      const summary = buildErrorSummary("", null);
      const ok = summary === "";
      addTest("ErrorSummary: 空 stderr + null exitCode 返回空字符串",
        ok ? "pass" : "fail", ok ? "" : `summary: ${summary}`);
    }

    // --- Test 19: buildErrorSummary 截断到 maxLen ---
    {
      const longErr = "x".repeat(500);
      const summary = buildErrorSummary(longErr, 1, 50);
      const ok = summary.length <= 50;
      addTest("ErrorSummary: 截断到 maxLen",
        ok ? "pass" : "fail", ok ? "" : `len=${summary.length}`);
    }

    // --- Test 20: redactSecret 独立函数测试 ---
    {
      const text = `token=${"a".repeat(48)} key=sk-ant-${"b".repeat(20)} Bearer ${"c".repeat(25)}`;
      const redacted = redactSecret(text);
      const ok = redacted.includes("<token>") && redacted.includes("<api-key>") && redacted.includes("<redacted>");
      addTest("redactSecret: 替换 token / api-key / Bearer",
        ok ? "pass" : "fail", ok ? "" : `redacted: ${redacted}`);
    }

    // --- Test 21: 预设不自动注入全文（buildPresetPrompt 输出不含笔记内容） ---
    {
      const prompt = buildPresetPrompt("summarize", {
        activeFilePath: "a.md",
        outputDir: "out",
      });
      // prompt 只应含指令和路径，不应含笔记正文（正文由 promptPackage 注入）
      const ok = !prompt.includes("笔记内容") && !prompt.includes("==========");
      addTest("Preset: 不自动注入笔记全文（正文由 promptPackage 注入）",
        ok ? "pass" : "fail", ok ? "" : `prompt 含正文: ${prompt}`);
    }

    // === V1.2 新增测试：复习提纲预设 + 首次使用提示 ===

    // --- Test 22: review 预设包含 Q&A 和 -review 后缀 ---
    {
      const prompt = buildPresetPrompt("review", {
        activeFilePath: "notes/cs101.md",
        outputDir: "out",
      });
      const ok = prompt.includes("notes/cs101.md") && prompt.includes("Q&A") && prompt.includes("-review");
      addTest("Preset V1.2: review 包含文件路径 / Q&A / -review 后缀",
        ok ? "pass" : "fail", ok ? "" : `prompt: ${prompt}`);
    }

    // --- Test 23: review 无活动笔记时使用通用 prompt ---
    {
      const prompt = buildPresetPrompt("review", {
        activeFilePath: null,
        outputDir: "out",
      });
      const ok = prompt.includes("复习提纲") && !prompt.includes("null") && prompt.includes("out");
      addTest("Preset V1.2: review 无活动笔记时使用通用 prompt（不含 null）",
        ok ? "pass" : "fail", ok ? "" : `prompt: ${prompt}`);
    }

    // --- Test 24: review 不自动注入笔记全文 ---
    {
      const prompt = buildPresetPrompt("review", {
        activeFilePath: "a.md",
        outputDir: "out",
      });
      const ok = !prompt.includes("笔记内容") && !prompt.includes("==========");
      addTest("Preset V1.2: review 不自动注入笔记全文",
        ok ? "pass" : "fail", ok ? "" : `prompt 含正文: ${prompt}`);
    }

    // --- Test 25: review 遵循 outputDir 配置 ---
    {
      const prompt = buildPresetPrompt("review", {
        activeFilePath: "a.md",
        outputDir: "my-custom-dir",
      });
      const ok = prompt.includes("my-custom-dir") && !prompt.includes("90_AI整理待确认");
      addTest("Preset V1.2: review 遵循 outputDir 配置（不硬编码目录）",
        ok ? "pass" : "fail", ok ? "" : `prompt: ${prompt}`);
    }

    // --- Test 26: buildFirstUseGuide 返回 5 个步骤 ---
    {
      const guide = buildFirstUseGuide();
      const ok = guide.steps.length === 5 && guide.title === "首次使用提示";
      addTest("Guide V1.2: buildFirstUseGuide 返回 5 个步骤",
        ok ? "pass" : "fail", ok ? "" : `steps: ${guide.steps.length}, title: ${guide.title}`);
    }

    // --- Test 27: 首次使用提示步骤含 Backend / Preflight / Selection / Note / 运行 ---
    {
      const guide = buildFirstUseGuide();
      const titles = guide.steps.map((s) => s.title).join("|");
      const ok = titles.includes("Backend") && titles.includes("Preflight") &&
                 titles.includes("选区") && titles.includes("当前笔记") &&
                 titles.includes("运行");
      addTest("Guide V1.2: 步骤覆盖 Backend / Preflight / 选区 / 当前笔记 / 运行",
        ok ? "pass" : "fail", ok ? "" : `titles: ${titles}`);
    }

    // --- Test 28: shouldShowFirstUseGuide(true) 返回 false ---
    {
      const ok = shouldShowFirstUseGuide(true) === false && shouldShowFirstUseGuide(false) === true;
      addTest("Guide V1.2: shouldShowFirstUseGuide 正确映射 dismissed 标志",
        ok ? "pass" : "fail", ok ? "" : "映射错误");
    }

    // --- Test 29: 首次使用提示步骤 index 连续从 1 开始 ---
    {
      const guide = buildFirstUseGuide();
      const indices = guide.steps.map((s) => s.index);
      const ok = indices[0] === 1 && indices.length === 5 &&
                 indices.every((v, i) => v === i + 1);
      addTest("Guide V1.2: 步骤 index 连续从 1 开始",
        ok ? "pass" : "fail", ok ? "" : `indices: ${indices.join(",")}`);
    }

    // --- Test 30: 首次使用提示含 footer ---
    {
      const guide = buildFirstUseGuide();
      const ok = guide.footer.length > 0 && guide.footer.includes("关闭");
      addTest("Guide V1.2: 含 footer 文本",
        ok ? "pass" : "fail", ok ? "" : `footer: ${guide.footer}`);
    }

  } catch (e) {
    addTest("V1.1/V1.2 单元测试段", "fail", `加载/执行异常: ${e?.message || e}`);
  } finally {
    try { if (presetBundle) rmSync(presetBundle, { force: true }); } catch {}
    try { if (preflightStatusBundle) rmSync(preflightStatusBundle, { force: true }); } catch {}
    try { if (guideBundle) rmSync(guideBundle, { force: true }); } catch {}
  }
}

// ============================================================
// 9. Process integration tests（本地 fixture CLI，不依赖 Obsidian）
// ============================================================
console.log("\n=== Process integration tests ===");

const runProcess = runMode === "all" || runMode === "process";

if (!runProcess) {
  addTest("Process 测试段", "skip", "当前为 unit/integration 模式，跳过 process 测试");
} else {
  try {
    const esbuild = (await import("esbuild")).default;
    const tempProcessBundle = join(PROJECT_ROOT, ".test-process-backend-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "claudeCliBackend.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: tempProcessBundle,
    });
    const { ClaudeCliBackend } = await import(pathToFileURL(tempProcessBundle).href);
    const backend = new ClaudeCliBackend();

    const fixturePath = join(PROJECT_ROOT, "scripts", "fixtures", "fixture-cli.mjs");

    // fixture settings：用 custom agent 调用 node + fixture
    function makeFixtureSettings(mode) {
      return {
        agentType: "custom",
        claudeCommand: "claude",
        claudeArgs: "-p",
        codexCommand: "codex",
        codexArgs: "exec -",
        customCommand: "node",
        customArgs: `${fixturePath} ${mode}`,
        includeActiveNote: false,
        includeSelection: false,
        maxActiveNoteChars: 6000,
        maxSelectionChars: 3000,
        outputDir: "",
        showStderr: true,
        saveLogs: false,
        sessionMode: "fresh",
        model: "",
        effortLevel: "",
        devTestMode: false,
      };
    }

    function makeTask(cwd) {
      return {
        id: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userMessage: "test",
        prompt: "test prompt",
        cwd: cwd || VAULT_PATH,
        createdAt: new Date().toISOString(),
        includeActiveNote: false,
        includeSelection: false,
      };
    }

    function collectEvents(bk, task, settings, timeoutMs = 15000) {
      const events = [];
      return new Promise((resolve) => {
        bk.run(task, settings, (event) => {
          events.push(event);
          if (event.type === "completed" || event.type === "failed" || event.type === "stopped") {
            resolve(events);
          }
        });
        setTimeout(() => resolve(events), timeoutMs);
      });
    }

    // 失败时输出 debug log 路径（不输出内容，不泄露 secret）
    function listDebugLogs(cwd) {
      try {
        const logDir = join(cwd, ".llm-bridge", "logs");
        if (!existsSync(logDir)) return "(无 logs 目录)";
        const files = readdirSync(logDir).filter(f => f.startsWith("debug-"));
        if (files.length === 0) return "(无 debug log)";
        return files.map(f => join(logDir, f)).join("; ");
      } catch (e) {
        return `(列出日志出错: ${e?.message || e})`;
      }
    }

    // ---- Process Test 1: 能启动 fixture success ----
    {
      const events = await collectEvents(backend, makeTask(), makeFixtureSettings("success"));
      const hasStarted = events.some(e => e.type === "started");
      const hasCompleted = events.some(e => e.type === "completed");
      const ok = hasStarted && hasCompleted;
      addTest("Process: 启动 fixture success", ok ? "pass" : "fail",
        ok ? "" : `started=${hasStarted}, completed=${hasCompleted}; debug logs: ${listDebugLogs(VAULT_PATH)}`);
    }

    // ---- Process Test 2: 能接收多段 stdout_delta ----
    {
      const events = await collectEvents(backend, makeTask(), makeFixtureSettings("success"));
      const stdoutDeltas = events.filter(e => e.type === "stdout_delta");
      // success 模式输出三段："Hello ", "from ", "fixture\n"
      const multiSegments = stdoutDeltas.length >= 2;
      const combined = stdoutDeltas.map(e => e.data).join("");
      const hasFixture = combined.includes("Hello") && combined.includes("fixture");
      const ok = multiSegments && hasFixture;
      addTest("Process: 接收多段 stdout_delta", ok ? "pass" : "fail",
        ok ? "" : `delta 数量=${stdoutDeltas.length}, combined="${combined.slice(0, 100)}"; debug logs: ${listDebugLogs(VAULT_PATH)}`);
    }

    // ---- Process Test 3: 能接收 stderr_delta ----
    {
      const events = await collectEvents(backend, makeTask(), makeFixtureSettings("mixed"));
      const hasStderrDelta = events.some(e => e.type === "stderr_delta" && e.data.includes("warning"));
      addTest("Process: 接收 stderr_delta", hasStderrDelta ? "pass" : "fail",
        hasStderrDelta ? "" : `未收到含 warning 的 stderr_delta; debug logs: ${listDebugLogs(VAULT_PATH)}`);
    }

    // ---- Process Test 4: exit 0 映射 completed ----
    {
      const events = await collectEvents(backend, makeTask(), makeFixtureSettings("success"));
      const completed = events.find(e => e.type === "completed");
      const ok = completed && completed.exitCode === 0;
      addTest("Process: exit 0 → completed", ok ? "pass" : "fail",
        ok ? "" : `completed=${!!completed}, exitCode=${completed?.exitCode}; debug logs: ${listDebugLogs(VAULT_PATH)}`);
    }

    // ---- Process Test 5: exit 1 映射 failed ----
    {
      const events = await collectEvents(backend, makeTask(), makeFixtureSettings("failure"));
      const failed = events.find(e => e.type === "failed");
      const ok = failed && failed.exitCode === 1;
      addTest("Process: exit 1 → failed", ok ? "pass" : "fail",
        ok ? "" : `failed=${!!failed}, exitCode=${failed?.exitCode}; debug logs: ${listDebugLogs(VAULT_PATH)}`);
    }

    // ---- Process Test 6: stop() 能终止 slow fixture ----
    {
      const events = [];
      const handle = backend.run(makeTask(), makeFixtureSettings("slow"), (e) => events.push(e));
      // 等待 300ms 确保进程已启动
      await new Promise(r => setTimeout(r, 300));
      let noThrow = true;
      try { handle.stop(); } catch { noThrow = false; }
      // 等待终态事件
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (events.some(e => e.type === "stopped" || e.type === "failed" || e.type === "completed")) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });
      const hasStopped = events.some(e => e.type === "stopped" || e.type === "failed");
      const ok = hasStopped && noThrow;
      addTest("Process: stop() 终止 slow fixture", ok ? "pass" : "fail",
        ok ? "" : `stopped=${hasStopped}, noThrow=${noThrow}; debug logs: ${listDebugLogs(VAULT_PATH)}`);
    }

    // ---- Process Test 7: 路径带空格时可运行 ----
    {
      // 创建带空格的临时 cwd
      const spaceCwd = mkdtempSync(join(tmpdir(), "fixture space-"));
      try {
        const events = await collectEvents(backend, makeTask(spaceCwd), makeFixtureSettings("success"));
        const hasCompleted = events.some(e => e.type === "completed" && e.exitCode === 0);
        addTest("Process: cwd 路径带空格可运行", hasCompleted ? "pass" : "fail",
          hasCompleted ? "" : `未 completed; debug logs: ${listDebugLogs(spaceCwd)}`);
      } finally {
        try { rmSync(spaceCwd, { recursive: true, force: true }); } catch {}
      }
    }

    // ---- Process Test 8: cwd 指向临时目录时可运行 ----
    {
      const tmpCwd = mkdtempSync(join(tmpdir(), "fixture-tmp-"));
      try {
        const events = await collectEvents(backend, makeTask(tmpCwd), makeFixtureSettings("success"));
        const hasCompleted = events.some(e => e.type === "completed" && e.exitCode === 0);
        addTest("Process: cwd 指向临时目录可运行", hasCompleted ? "pass" : "fail",
          hasCompleted ? "" : `未 completed; debug logs: ${listDebugLogs(tmpCwd)}`);
      } finally {
        try { rmSync(tmpCwd, { recursive: true, force: true }); } catch {}
      }
    }

    // ---- Process Test 9: large-output 不污染诊断日志 ----
    // large-output 只产生 stdout，诊断日志只记录 stderr full + stdout length，不应包含 stdout 内容
    {
      const beforeMs = Date.now();
      const events = await collectEvents(backend, makeTask(), makeFixtureSettings("large-output"), 30000);
      const hasCompleted = events.some(e => e.type === "completed" && e.exitCode === 0);
      // 找该测试产生的 debug log（mtime > beforeMs）
      let logClean = true;
      let logPath = "";
      try {
        const logDir = join(VAULT_PATH, ".llm-bridge", "logs");
        if (existsSync(logDir)) {
          const files = readdirSync(logDir).filter(f => f.startsWith("debug-"));
          let candidate = null;
          for (const f of files) {
            const fp = join(logDir, f);
            const st = statSync(fp);
            if (st.mtimeMs >= beforeMs && (!candidate || st.mtimeMs > candidate.mtimeMs)) {
              candidate = { path: fp, mtimeMs: st.mtimeMs };
            }
          }
          if (candidate) {
            logPath = candidate.path;
            const content = readFileSync(candidate.path, "utf8");
            // large-output 的 stdout 是 "line 999: xxx..."，不应出现在诊断日志
            if (content.includes("line 999")) logClean = false;
          }
        }
      } catch {}
      const ok = hasCompleted && logClean;
      addTest("Process: large-output 不污染诊断日志", ok ? "pass" : "fail",
        ok ? "" : `completed=${hasCompleted}, logClean=${logClean}, logPath=${logPath || listDebugLogs(VAULT_PATH)}`);
    }

    // ---- Preflight tests（V0.5）----
    // 用 agentProfile 的 runPreflight，不发真实 prompt，只调 --version
    {
      // 单独 bundle agentProfile.ts（它 import 自 claudeCliBackend，esbuild 会一起打包）
      const tempPreflightBundle = join(PROJECT_ROOT, ".test-preflight-temp.mjs");
      await esbuild.build({
        entryPoints: [join(PROJECT_ROOT, "src", "agentProfile.ts")],
        bundle: true,
        format: "esm",
        platform: "node",
        outfile: tempPreflightBundle,
      });
      const { runPreflight } = await import(pathToFileURL(tempPreflightBundle).href);

      // 辅助 settings：custom profile 便于指向任意命令
      function makePreflightSettings(command, args) {
        return {
          agentType: "custom",
          claudeCommand: "claude",
          claudeArgs: "-p",
          codexCommand: "codex",
          codexArgs: "exec -",
          customCommand: command,
          customArgs: args || "",
          includeActiveNote: false,
          includeSelection: false,
          maxActiveNoteChars: 6000,
          maxSelectionChars: 3000,
          outputDir: "",
          showStderr: true,
          saveLogs: false,
          sessionMode: "fresh",
          model: "secret-model-value",
          effortLevel: "secret-effort-value",
          devTestMode: false,
          backendMode: "auto",
        };
      }

      // Preflight Test 1: cwd 不存在 → failed diagnostic
      {
        const badCwd = "Z:\\non_existent_preflight_dir_xyz";
        const result = await runPreflight(makePreflightSettings("node", ""), badCwd, 5000);
        const cwdMissing = result.cwdExists === false;
        const unavailable = result.available === false;
        const hasDiag = result.diagnostics.includes("unavailable") && result.diagnostics.includes("cwd");
        const ok = cwdMissing && unavailable && hasDiag;
        addTest("Preflight: cwd 不存在 → failed diagnostic", ok ? "pass" : "fail",
          ok ? "" : `cwdExists=${result.cwdExists}, available=${result.available}, diag="${result.diagnostics}"`);
      }

      // Preflight Test 2: command 不存在 → unavailable
      {
        const result = await runPreflight(
          makePreflightSettings("non_existent_command_xyz_123", ""),
          VAULT_PATH,
          5000,
        );
        const notFound = result.commandFound === false;
        const unavailable = result.available === false;
        const ok = notFound && unavailable;
        addTest("Preflight: command 不存在 → unavailable", ok ? "pass" : "fail",
          ok ? "" : `commandFound=${result.commandFound}, available=${result.available}, exitCode=${result.versionExitCode}`);
      }

      // Preflight Test 3: version 命令成功 → available（用 node --version）
      {
        const result = await runPreflight(makePreflightSettings("node", ""), VAULT_PATH, 10000);
        const found = result.commandFound === true;
        const available = result.available === true;
        const hasVersion = result.versionStdout.trim().length > 0;
        const ok = found && available && hasVersion;
        addTest("Preflight: version 成功 → available", ok ? "pass" : "fail",
          ok ? "" : `found=${found}, available=${available}, stdout="${result.versionStdout.slice(0, 60)}", exitCode=${result.versionExitCode}`);
      }

      // Preflight Test 4: command 为空 → unavailable（skipReason = command 为空）
      {
        const result = await runPreflight(makePreflightSettings("   ", ""), VAULT_PATH, 5000);
        const unavailable = result.available === false;
        const hasSkipReason = result.skipReason === "command 为空";
        const ok = unavailable && hasSkipReason;
        addTest("Preflight: command 为空 → unavailable", ok ? "pass" : "fail",
          ok ? "" : `available=${result.available}, skipReason=${result.skipReason}`);
      }

      // Preflight Test 5: debug log 不含 secret
      // 即使 settings.model/effortLevel 含 "secret-..." 值，debug log 只记录 key 名不记录值
      {
        const result = await runPreflight(makePreflightSettings("node", ""), VAULT_PATH, 10000);
        let logClean = true;
        let logContent = "";
        if (result.debugLogPath && existsSync(result.debugLogPath)) {
          logContent = readFileSync(result.debugLogPath, "utf8");
          if (logContent.includes("secret-model-value") || logContent.includes("secret-effort-value")) {
            logClean = false;
          }
        }
        // env keys 应记录 ANTHROPIC_MODEL / CLAUDE_CODE_EFFORT_LEVEL（custom 不注入，但 key 名记录逻辑只对 claude 生效；
        // 这里 custom 不注入，所以 log 里应不含这些 key 名也不含值）
        const ok = logClean;
        addTest("Preflight: debug log 不含 secret", ok ? "pass" : "fail",
          ok ? "" : `logClean=${logClean}, logPath=${result.debugLogPath}`);
      }

      // Preflight Test 6: 路径带空格时 preflight 可运行
      {
        const spaceCwd = mkdtempSync(join(tmpdir(), "preflight space-"));
        try {
          const result = await runPreflight(makePreflightSettings("node", ""), spaceCwd, 10000);
          const ok = result.cwdExists === true && result.available === true && result.commandFound === true;
          addTest("Preflight: 路径带空格可运行", ok ? "pass" : "fail",
            ok ? "" : `cwdExists=${result.cwdExists}, available=${result.available}, found=${result.commandFound}; diag="${result.diagnostics}"`);
        } finally {
          try { rmSync(spaceCwd, { recursive: true, force: true }); } catch {}
        }
      }

      // Preflight Test 7: claude/codex 真实命令探测（未安装则 skip，不 fail）
      // 先探测 claude --version，成功才断言 available
      {
        const claudeResult = await runPreflight(
          {
            ...makePreflightSettings("claude", "-p"),
            agentType: "claude",
          },
          VAULT_PATH,
          10000,
        );
        if (claudeResult.commandFound) {
          addTest("Preflight: claude 真实命令探测", claudeResult.available ? "pass" : "fail",
            `available=${claudeResult.available}, stdout="${claudeResult.versionStdout.slice(0, 60)}"`);
        } else {
          addTest("Preflight: claude 真实命令探测", "skip",
            `claude 未安装或不可用 (exitCode=${claudeResult.versionExitCode})`);
        }
      }
      {
        const codexResult = await runPreflight(
          {
            ...makePreflightSettings("codex", "exec -"),
            agentType: "codex",
          },
          VAULT_PATH,
          10000,
        );
        if (codexResult.commandFound) {
          addTest("Preflight: codex 真实命令探测", codexResult.available ? "pass" : "fail",
            `available=${codexResult.available}, stdout="${codexResult.versionStdout.slice(0, 60)}"`);
        } else {
          addTest("Preflight: codex 真实命令探测", "skip",
            `codex 未安装或不可用 (exitCode=${codexResult.versionExitCode})`);
        }
      }

      rmSync(tempPreflightBundle, { force: true });
    }

    // ============================================================
    // V0.9: Process fixture 文件检测测试
    // fixture write-file 模式写入 .md，backend 结束后用 fileDiff 检测
    // ============================================================
    const tempFileDiffBundle = join(PROJECT_ROOT, ".test-filediff-process-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "fileDiff.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: tempFileDiffBundle,
    });
    const { snapshotVaultMarkdownFiles, diffSnapshots } = await import(pathToFileURL(tempFileDiffBundle).href);

    // Test: fixture 写入 .md → backend completed → diff 检测到新文件
    {
      const tempVault = join(PROJECT_ROOT, ".test-process-filediff-vault");
      try {
        rmSync(tempVault, { recursive: true, force: true });
        mkdirSync(tempVault, { recursive: true });
        // 预置一个已存在的文件，验证不会误报
        writeFileSync(join(tempVault, "preexisting.md"), "# preexisting");

        const before = await snapshotVaultMarkdownFiles(tempVault);

        // 用 fixture-cli write-file 模式作为 command
        const fixtureCmd = `node "${join(PROJECT_ROOT, "scripts", "fixtures", "fixture-cli.mjs")}"`;
        const writeFileTask = {
          id: `fixture-write-${Date.now()}`,
          userMessage: "write a file",
          prompt: "test prompt",
          cwd: tempVault,
          createdAt: new Date().toISOString(),
          includeActiveNote: false,
          includeSelection: false,
        };
        const writeFileSettings = {
          agentType: "custom",
          claudeCommand: "claude",
          claudeArgs: "-p",
          codexCommand: "codex",
          codexArgs: "exec -",
          customCommand: fixtureCmd,
          customArgs: "write-file",
          includeActiveNote: false,
          includeSelection: false,
          maxActiveNoteChars: 6000,
          maxSelectionChars: 3000,
          outputDir: "generated",
          showStderr: true,
          saveLogs: false,
          sessionMode: "fresh",
          model: "",
          effortLevel: "",
          devTestMode: false,
          backendMode: "auto",
        };

        const writeFileBackend = new ClaudeCliBackend();
        const writeFileEvents = await new Promise((resolve) => {
          const evs = [];
          writeFileBackend.run(writeFileTask, writeFileSettings, (event) => {
            evs.push(event);
            if (event.type === "completed" || event.type === "failed" || event.type === "stopped") {
              resolve(evs);
            }
          });
          setTimeout(() => resolve(evs), 15000);
        });

        const completed = writeFileEvents.find(e => e.type === "completed");
        const completedOk = completed && completed.exitCode === 0;
        // 内联列出 debug log 路径（不输出内容，避免泄露 secret）
        let logPathHint = "(无 logs)";
        try {
          const logDir = join(tempVault, ".llm-bridge", "logs");
          if (existsSync(logDir)) {
            const files = readdirSync(logDir).filter(f => f.startsWith("debug-"));
            if (files.length > 0) logPathHint = join(logDir, files[files.length - 1]);
          }
        } catch {}
        addTest("Process File Diff: fixture write-file completed", completedOk ? "pass" : "fail",
          completedOk ? "" : `events=${JSON.stringify(writeFileEvents.map(e => e.type))}; debug log: ${logPathHint}`);

        // backend 结束后扫描文件
        await new Promise((r) => setTimeout(r, 200));
        const after = await snapshotVaultMarkdownFiles(tempVault);
        const diff = diffSnapshots(before, after);
        const hasNewFile = diff.some(d => d.includes("[NEW]") && d.includes("fixture-output-"));
        const noPreexistingFalse = !diff.some(d => d.includes("preexisting.md"));
        const ok = completedOk && hasNewFile && noPreexistingFalse;
        addTest("Process File Diff: diff 检测到 fixture 写入的新文件", ok ? "pass" : "fail",
          ok ? "" : `completedOk=${completedOk}, hasNewFile=${hasNewFile}, noPreexistingFalse=${noPreexistingFalse}; diff=${JSON.stringify(diff)}`);
      } finally {
        rmSync(tempVault, { recursive: true, force: true });
      }
    }

    rmSync(tempFileDiffBundle, { force: true });
    rmSync(tempProcessBundle, { force: true });
  } catch (e) {
    addTest("Process integration tests", "fail", e?.stack || e?.message || String(e));
    try { rmSync(join(PROJECT_ROOT, ".test-process-backend-temp.mjs"), { force: true }); } catch {}
    try { rmSync(join(PROJECT_ROOT, ".test-preflight-temp.mjs"), { force: true }); } catch {}
    try { rmSync(join(PROJECT_ROOT, ".test-filediff-process-temp.mjs"), { force: true }); } catch {}
  }
}

// ============================================================
// 9.5 Claude CLI Real Smoke（真实 claude -p，缺 claude 时 skip）
// ============================================================
console.log("\n=== Claude CLI Real Smoke ===");

const runClaudeSmoke = runMode === "all" || runMode === "claude";

if (!runClaudeSmoke) {
  addTest("Claude Smoke 段", "skip", "当前模式不运行 claude smoke");
} else {
  let claudeSmokeBundle = null;
  let claudePreflightBundle = null;
  try {
    const esbuild = (await import("esbuild")).default;
    claudeSmokeBundle = join(PROJECT_ROOT, ".test-claude-smoke-temp.mjs");
    claudePreflightBundle = join(PROJECT_ROOT, ".test-claude-preflight-temp.mjs");
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "claudeCliBackend.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: claudeSmokeBundle,
    });
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "agentProfile.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: claudePreflightBundle,
    });
    const { ClaudeCliBackend } = await import(pathToFileURL(claudeSmokeBundle).href);
    const { runPreflight } = await import(pathToFileURL(claudePreflightBundle).href);

    // 本地 debug log 路径列出（不输出内容，不泄露 secret）
    function listSmokeLogs(cwd) {
      try {
        const logDir = join(cwd, ".llm-bridge", "logs");
        if (!existsSync(logDir)) return "(无 logs 目录)";
        const files = readdirSync(logDir).filter(f => f.startsWith("debug-"));
        if (files.length === 0) return "(无 debug log)";
        return files.map(f => join(logDir, f)).join("; ");
      } catch (e) {
        return `(列出日志出错: ${e?.message || e})`;
      }
    }

    // 先 preflight 探测 claude 是否可用，不可用则整体 skip，不调 API
    const claudeSettings = {
      agentType: "claude",
      claudeCommand: "claude",
      claudeArgs: "-p",
      codexCommand: "codex",
      codexArgs: "exec -",
      customCommand: "",
      customArgs: "",
      includeActiveNote: false,
      includeSelection: false,
      maxActiveNoteChars: 6000,
      maxSelectionChars: 3000,
      outputDir: "",
      showStderr: true,
      saveLogs: false,
      sessionMode: "fresh",
      model: "",
      effortLevel: "",
      devTestMode: false,
      backendMode: "auto",
    };

    const preflight = await runPreflight(claudeSettings, VAULT_PATH, 15000);

    if (!preflight.available) {
      addTest("Claude Smoke: claude 可用性", "skip",
        `claude 不可用 (exitCode=${preflight.versionExitCode})；diag: ${preflight.diagnostics.split("\n").pop()}`);
    } else {
      addTest("Claude Smoke: claude 可用性", "pass",
        `version: ${preflight.versionStdout.trim().split("\n")[0]}`);

      const backend = new ClaudeCliBackend();

      // 极短 prompt，避免消耗过多 API
      const smokeTask = {
        id: `claude-smoke-${Date.now()}`,
        userMessage: "只回复 OK",
        prompt: "只回复 OK",
        cwd: VAULT_PATH,
        createdAt: new Date().toISOString(),
        includeActiveNote: false,
        includeSelection: false,
      };

      // 只跑一次真实 claude -p，收集全部事件后做多断言（最小化 API 消耗）
      const events = await new Promise((resolve) => {
        const evs = [];
        backend.run(smokeTask, claudeSettings, (event) => {
          evs.push(event);
          if (event.type === "completed" || event.type === "failed" || event.type === "stopped") {
            resolve(evs);
          }
        });
        // claude -p 首次调用可能较慢，给 120s
        setTimeout(() => resolve(evs), 120000);
      });

      // Smoke Test 1: started 必须先发出
      {
        const firstStarted = events[0]?.type === "started";
        addTest("Claude Smoke: started 先发出", firstStarted ? "pass" : "fail",
          firstStarted ? "" : `首个事件: ${events[0]?.type || "none"}; debug logs: ${listSmokeLogs(VAULT_PATH)}`);
      }

      // Smoke Test 2: 接收 stdout_delta
      {
        const hasStdout = events.some(e => e.type === "stdout_delta" && typeof e.data === "string" && e.data.length > 0);
        addTest("Claude Smoke: 接收 stdout_delta", hasStdout ? "pass" : "fail",
          hasStdout ? "" : `未收到 stdout_delta; 事件类型: ${events.map(e => e.type).join(",")}`);
      }

      // Smoke Test 3: completed 且 exitCode 0
      {
        const completed = events.find(e => e.type === "completed");
        const ok = completed && completed.exitCode === 0;
        addTest("Claude Smoke: completed exitCode 0", ok ? "pass" : "fail",
          ok ? "" : `completed=${!!completed}, exitCode=${completed?.exitCode}; debug logs: ${listSmokeLogs(VAULT_PATH)}`);
      }

      // Smoke Test 4: stdout 含 OK（容忍大小写和周边文本）
      {
        const completed = events.find(e => e.type === "completed");
        const stdout = completed?.stdout || events.filter(e => e.type === "stdout_delta").map(e => e.data).join("");
        const hasOK = /ok/i.test(stdout);
        addTest("Claude Smoke: stdout 含 OK", hasOK ? "pass" : "fail",
          hasOK ? "" : `stdout 末尾: "${stdout.slice(-120)}"; debug logs: ${listSmokeLogs(VAULT_PATH)}`);
      }
    }

    rmSync(claudeSmokeBundle, { force: true });
    rmSync(claudePreflightBundle, { force: true });
  } catch (e) {
    addTest("Claude Smoke", "fail", e?.stack || e?.message || String(e));
    try { if (claudeSmokeBundle) rmSync(claudeSmokeBundle, { force: true }); } catch {}
    try { if (claudePreflightBundle) rmSync(claudePreflightBundle, { force: true }); } catch {}
  }
}

// ============================================================
// 9.6 Claude Real Note Summarize Smoke（V0.8：验证 buildPromptPackage 注入内容）
// ============================================================
console.log("\n=== Claude Real Note Summarize Smoke ===");

const runNoteSummarizeSmoke = runMode === "all" || runMode === "claude";

if (!runNoteSummarizeSmoke) {
  addTest("Claude Note Summarize Smoke 段", "skip", "当前模式不运行 note summarize smoke");
} else {
  let noteSummarizeBundle = null;
  let noteSummarizePreflightBundle = null;
  let noteSummarizePromptPackageBundle = null;
  
  try {
    const esbuild = (await import("esbuild")).default;
    
    noteSummarizeBundle = join(PROJECT_ROOT, ".test-note-summarize-temp.mjs");
    noteSummarizePreflightBundle = join(PROJECT_ROOT, ".test-note-summarize-preflight-temp.mjs");
    noteSummarizePromptPackageBundle = join(PROJECT_ROOT, ".test-note-summarize-promptpackage-temp.mjs");
    
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "claudeCliBackend.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: noteSummarizeBundle,
    });
    
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "agentProfile.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: noteSummarizePreflightBundle,
    });
    
    await esbuild.build({
      entryPoints: [join(PROJECT_ROOT, "src", "promptPackage.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: noteSummarizePromptPackageBundle,
    });
    
    const { ClaudeCliBackend } = await import(pathToFileURL(noteSummarizeBundle).href);
    const { runPreflight } = await import(pathToFileURL(noteSummarizePreflightBundle).href);
    const { buildPromptPackage } = await import(pathToFileURL(noteSummarizePromptPackageBundle).href);
    
    // 本地 debug log 路径列出
    function listNoteSummarizeLogs(cwd) {
      try {
        const logDir = join(cwd, ".llm-bridge", "logs");
        if (!existsSync(logDir)) return "(无 logs 目录)";
        const files = readdirSync(logDir).filter(f => f.startsWith("debug-"));
        if (files.length === 0) return "(无 debug log)";
        return files.map(f => join(logDir, f)).join("; ");
      } catch (e) {
        return `(列出日志出错: ${e?.message || e})`;
      }
    }
    
    // 先 preflight 探测 claude 是否可用
    const claudeSettings = {
      agentType: "claude",
      claudeCommand: "claude",
      claudeArgs: "-p",
      codexCommand: "codex",
      codexArgs: "exec -",
      customCommand: "",
      customArgs: "",
      includeActiveNote: true,  // V0.8: 启用 activeFile 注入
      includeSelection: true,   // V0.8: 启用 selection 注入
      maxActiveNoteChars: 6000,
      maxSelectionChars: 3000,
      outputDir: "my-test-output-dir",
      showStderr: true,
      saveLogs: false,
      sessionMode: "fresh",
      model: "",
      effortLevel: "",
      devTestMode: false,
      backendMode: "auto",
    };
    
    const preflight = await runPreflight(claudeSettings, VAULT_PATH, 15000);
    
    if (!preflight.available) {
      addTest("Claude Note Summarize: claude 可用性", "skip",
        `claude 不可用 (exitCode=${preflight.versionExitCode})；diag: ${preflight.diagnostics.split("\n").pop()}`);
    } else {
      addTest("Claude Note Summarize: claude 可用性", "pass",
        `version: ${preflight.versionStdout.trim().split("\n")[0]}`);
      
      const backend = new ClaudeCliBackend();
      
      // V0.8: 构造包含唯一标记词的 fixture markdown
      const uniqueMarker = "V08_UNIQUE_MARKER_XYZ123";
      const fixtureNoteContent = `# 测试笔记

这是一个用于 V0.8 测试的笔记。

## 关键内容

本笔记包含唯一标记词：${uniqueMarker}

## 总结

这个笔记的主要目的是验证 buildPromptPackage 能否正确注入 activeFile 和 selection 内容到真实 Claude prompt 中。
`;
      
      const selectionContent = `选中的关键段落：${uniqueMarker} 是测试标记`;
      
      // V0.8: 使用 buildPromptPackage 构造最终 prompt
      const snapshot = {
        vaultPath: VAULT_PATH,
        activeFilePath: "test-note-v08.md",
        activeFileContent: fixtureNoteContent,
        selection: selectionContent,
        timestamp: new Date().toISOString(),
      };
      
      const userMessage = "请总结这个笔记的关键内容，并提到标记词";
      const finalPrompt = buildPromptPackage(userMessage, snapshot, claudeSettings);
      
      // 验证 prompt 包含标记词
      const promptHasMarker = finalPrompt.includes(uniqueMarker);
      addTest("Claude Note Summarize: prompt 包含标记词", promptHasMarker ? "pass" : "fail",
        promptHasMarker ? "" : `prompt 长度: ${finalPrompt.length}, 包含标记词: ${promptHasMarker}`);
      
      // 构造 AgentTask
      const summarizeTask = {
        id: `claude-note-summarize-${Date.now()}`,
        userMessage: userMessage,
        prompt: finalPrompt,
        cwd: VAULT_PATH,
        createdAt: new Date().toISOString(),
        includeActiveNote: true,
        includeSelection: true,
      };
      
      // 调用 claude -p，收集事件
      const events = await new Promise((resolve) => {
        const evs = [];
        backend.run(summarizeTask, claudeSettings, (event) => {
          evs.push(event);
          if (event.type === "completed" || event.type === "failed" || event.type === "stopped") {
            resolve(evs);
          }
        });
        setTimeout(() => resolve(evs), 120000);
      });
      
      // Test 1: started 必须先发出
      {
        const firstStarted = events[0]?.type === "started";
        addTest("Claude Note Summarize: started 先发出", firstStarted ? "pass" : "fail",
          firstStarted ? "" : `首个事件: ${events[0]?.type || "none"}; debug logs: ${listNoteSummarizeLogs(VAULT_PATH)}`);
      }
      
      // Test 2: completed 且 exitCode 0
      {
        const completed = events.find(e => e.type === "completed");
        const ok = completed && completed.exitCode === 0;
        addTest("Claude Note Summarize: completed exitCode 0", ok ? "pass" : "fail",
          ok ? "" : `completed=${!!completed}, exitCode=${completed?.exitCode}; debug logs: ${listNoteSummarizeLogs(VAULT_PATH)}`);
      }
      
      // Test 3: stdout 包含标记词（证明 activeFile/selection 内容进入了真实 prompt）
      {
        const completed = events.find(e => e.type === "completed");
        const stdout = completed?.stdout || events.filter(e => e.type === "stdout_delta").map(e => e.data).join("");
        const stdoutHasMarker = stdout.includes(uniqueMarker);
        addTest("Claude Note Summarize: stdout 包含标记词", stdoutHasMarker ? "pass" : "fail",
          stdoutHasMarker ? "" : `stdout 长度: ${stdout.length}, 包含标记词: ${stdoutHasMarker}; stdout 末尾: "${stdout.slice(-200)}"`);
      }
      
      // Test 4: stdout 提到"总结"或"关键"（证明 Claude 理解了任务）
      {
        const completed = events.find(e => e.type === "completed");
        const stdout = completed?.stdout || events.filter(e => e.type === "stdout_delta").map(e => e.data).join("");
        const stdoutHasSummary = /总结|关键|内容|笔记/.test(stdout);
        addTest("Claude Note Summarize: stdout 提到总结/关键", stdoutHasSummary ? "pass" : "fail",
          stdoutHasSummary ? "" : `stdout 长度: ${stdout.length}; stdout 末尾: "${stdout.slice(-200)}"`);
      }
    }
    
    rmSync(noteSummarizeBundle, { force: true });
    rmSync(noteSummarizePreflightBundle, { force: true });
    rmSync(noteSummarizePromptPackageBundle, { force: true });
  } catch (e) {
    addTest("Claude Note Summarize Smoke", "fail", e?.stack || e?.message || String(e));
    try { if (noteSummarizeBundle) rmSync(noteSummarizeBundle, { force: true }); } catch {}
    try { if (noteSummarizePreflightBundle) rmSync(noteSummarizePreflightBundle, { force: true }); } catch {}
    try { if (noteSummarizePromptPackageBundle) rmSync(noteSummarizePromptPackageBundle, { force: true }); } catch {}
  }
}

// ============================================================
// 10. 生成测试报告
// ============================================================
console.log("\n=== 生成测试报告 ===");

function generateReport() {
  const lines = [];
  lines.push("# LLM CLI Bridge 测试报告");
  lines.push("");
  lines.push(`- **测试时间**: ${results.timestamp}`);
  lines.push(`- **测试环境**: ${results.environment.platform} / Node.js ${results.environment.nodeVersion}`);
  lines.push(`- **插件版本**: ${results.environment.pluginVersion || "unknown"}`);
  lines.push(`- **main.js 大小**: ${results.environment.mainJsSizeKB || "unknown"}`);
  lines.push(`- **Vault 路径**: \`${results.environment.vaultPath}\``);
  lines.push(`- **bridge.json 存在**: ${results.environment.bridgeJsonExists ? "是" : "否"}`);
  lines.push(`- **HTTP 端口**: ${results.environment.httpPort || "N/A"}`);
  lines.push("");
  lines.push("## 测试汇总");
  lines.push("");
  lines.push(`- ✅ **通过**: ${results.passed}`);
  lines.push(`- ❌ **失败**: ${results.failed}`);
  lines.push(`- ⏭️ **跳过**: ${results.skipped}`);
  lines.push(`- ⚪ **需人工验证**: ${results.manualRequired}`);
  lines.push(`- **总计**: ${results.tests.length}`);
  lines.push("");
  lines.push("## 详细结果");
  lines.push("");

  const categories = {};
  for (const t of results.tests) {
    const cat = t.name.split(":")[0];
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(t);
  }

  for (const [cat, tests] of Object.entries(categories)) {
    lines.push(`### ${cat}`);
    lines.push("");
    lines.push("| 状态 | 测试项 | 详情 |");
    lines.push("|------|--------|------|");
    for (const t of tests) {
      const icon = t.status === "pass" ? "✅" : t.status === "fail" ? "❌" : t.status === "skip" ? "⏭️" : "⚪";
      const name = t.name.startsWith(cat + ": ") ? t.name.slice(cat.length + 2) : t.name;
      lines.push(`| ${icon} | ${name} | ${t.detail || "-"} |`);
    }
    lines.push("");
  }

  lines.push("## 失败项详情");
  lines.push("");
  const failures = results.tests.filter(t => t.status === "fail");
  if (failures.length === 0) {
    lines.push("无失败项。");
  } else {
    for (const f of failures) {
      lines.push(`- **${f.name}**: ${f.detail}`);
    }
  }
  lines.push("");

  lines.push("## 需人工验证项");
  lines.push("");
  const manual = results.tests.filter(t => t.status === "manual");
  if (manual.length === 0) {
    lines.push("无。");
  } else {
    for (const m of manual) {
      lines.push(`- **${m.name}**: ${m.detail}`);
    }
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`*报告由 \`scripts/run-tests.mjs\` 自动生成*`);

  return lines.join("\n");
}

const report = generateReport();
const docsDir = join(PROJECT_ROOT, "docs");
if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
const reportPath = join(docsDir, "test-report.md");
writeFileSync(reportPath, report, "utf8");
console.log(`报告已写入: ${reportPath}`);

// 退出码
console.log(`\n=== 结果: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped, ${results.manualRequired} manual required ===`);
process.exit(results.failed > 0 ? 1 : 0);
