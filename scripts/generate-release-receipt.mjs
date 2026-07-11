// Phase 5: 统一发布凭证生成 + 三方 SHA 一致性校验
// 生成包含版本、提交、测试、产物 SHA、部署 Vault 的发布凭证
// 校验源码 ↔ user-package ↔ Vault 的 main.js/styles.css SHA 一致性
//
// 用法：node scripts/generate-release-receipt.mjs [--vault <path1>] [--vault <path2>]
// 默认检查 dist/user-package 和两个标准 Vault 路径

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "manifest.json");

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function gitCommitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "(unknown)";
  }
}

function gitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "(unknown)";
  }
}

function gitIsClean() {
  try {
    const status = execSync("git status --porcelain", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
    return status.length === 0;
  } catch {
    return false;
  }
}

// Default Vault paths (can be overridden by --vault args)
const DEFAULT_VAULTS = [
  "D:\\Users\\Ye_Luo\\APP\\Obsidian\\LLM-Wiki\\.obsidian\\plugins\\llm-cli-bridge",
  "D:\\Users\\Ye_Luo\\APP\\Test\\Obsidian\\LLM-Wiki\\.obsidian\\plugins\\llm-cli-bridge",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const vaults = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--vault" && i + 1 < args.length) {
      vaults.push(args[++i]);
    }
  }
  return { vaults: vaults.length > 0 ? vaults : DEFAULT_VAULTS };
}

function checkArtifact(filePath, label) {
  if (!fs.existsSync(filePath)) {
    return { label, exists: false, sha256: null, size: 0 };
  }
  const sha = sha256File(filePath);
  const stat = fs.statSync(filePath);
  return { label, exists: true, sha256: sha, size: stat.size };
}

function main() {
  const { vaults } = parseArgs();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const version = manifest.version || "(unknown)";
  const commitSha = gitCommitSha();
  const branch = gitBranch();
  const isClean = gitIsClean();

  // Source artifacts
  const sourceMain = checkArtifact(path.join(PROJECT_ROOT, "main.js"), "source main.js");
  const sourceStyles = checkArtifact(path.join(PROJECT_ROOT, "styles.css"), "source styles.css");
  const sourceManifest = checkArtifact(path.join(PROJECT_ROOT, "manifest.json"), "source manifest.json");

  // User package artifacts
  const userPkgDir = path.join(PROJECT_ROOT, "dist", "user-package");
  const userPkgMain = checkArtifact(path.join(userPkgDir, "main.js"), "user-package main.js");
  const userPkgStyles = checkArtifact(path.join(userPkgDir, "styles.css"), "user-package styles.css");
  const userPkgManifest = checkArtifact(path.join(userPkgDir, "manifest.json"), "user-package manifest.json");

  // Vault artifacts
  const vaultResults = vaults.map((v) => ({
    vaultPath: v,
    main: checkArtifact(path.join(v, "main.js"), "vault main.js"),
    styles: checkArtifact(path.join(v, "styles.css"), "vault styles.css"),
    manifest: checkArtifact(path.join(v, "manifest.json"), "vault manifest.json"),
  }));

  // SHA consistency check
  const shaChecks = [];
  const sourceMainSha = sourceMain.sha256;
  const userPkgMainSha = userPkgMain.sha256;
  const sourceStylesSha = sourceStyles.sha256;
  const userPkgStylesSha = userPkgStyles.sha256;

  // Source ↔ User package
  if (sourceMainSha && userPkgMainSha) {
    shaChecks.push({
      check: "source ↔ user-package main.js SHA",
      match: sourceMainSha === userPkgMainSha,
      source: sourceMainSha,
      target: userPkgMainSha,
    });
  }
  if (sourceStylesSha && userPkgStylesSha) {
    shaChecks.push({
      check: "source ↔ user-package styles.css SHA",
      match: sourceStylesSha === userPkgStylesSha,
      source: sourceStylesSha,
      target: userPkgStylesSha,
    });
  }

  // Source ↔ Vault
  for (const v of vaultResults) {
    if (v.main.exists && sourceMainSha) {
      shaChecks.push({
        check: `source ↔ vault(${path.basename(path.dirname(path.dirname(v.vaultPath)))}) main.js SHA`,
        match: sourceMainSha === v.main.sha256,
        source: sourceMainSha,
        target: v.main.sha256,
      });
    }
    if (v.styles.exists && sourceStylesSha) {
      shaChecks.push({
        check: `source ↔ vault(${path.basename(path.dirname(path.dirname(v.vaultPath)))}) styles.css SHA`,
        match: sourceStylesSha === v.styles.sha256,
        source: sourceStylesSha,
        target: v.styles.sha256,
      });
    }
  }

  const allShaMatch = shaChecks.length > 0 && shaChecks.every((c) => c.match);

  // Build receipt
  const receipt = {
    generatedAt: new Date().toISOString(),
    version,
    git: {
      commitSha,
      branch,
      workingTreeClean: isClean,
    },
    artifacts: {
      source: { main: sourceMain, styles: sourceStyles, manifest: sourceManifest },
      userPackage: { main: userPkgMain, styles: userPkgStyles, manifest: userPkgManifest },
      vaults: vaultResults,
    },
    shaConsistency: {
      allMatch: allShaMatch,
      checks: shaChecks,
    },
  };

  // Output receipt
  const receiptPath = path.join(PROJECT_ROOT, "docs", "release-receipt.json");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), "utf8");

  // Print summary
  console.log("=== Release Receipt ===");
  console.log(`Version: ${version}`);
  console.log(`Commit:  ${commitSha} (${branch})`);
  console.log(`Clean:   ${isClean}`);
  console.log("");
  console.log("--- Artifacts ---");
  console.log(`Source main.js:      ${sourceMain.exists ? sourceMain.sha256?.slice(0, 16) : "MISSING"}`);
  console.log(`UserPkg main.js:     ${userPkgMain.exists ? userPkgMain.sha256?.slice(0, 16) : "MISSING"}`);
  console.log(`Source styles.css:   ${sourceStyles.exists ? sourceStyles.sha256?.slice(0, 16) : "MISSING"}`);
  console.log(`UserPkg styles.css:  ${userPkgStyles.exists ? userPkgStyles.sha256?.slice(0, 16) : "MISSING"}`);
  console.log("");
  console.log("--- SHA Consistency ---");
  for (const c of shaChecks) {
    const status = c.match ? "✅" : "❌";
    console.log(`${status} ${c.check}`);
    if (!c.match) {
      console.log(`   source: ${c.source}`);
      console.log(`   target: ${c.target}`);
    }
  }
  console.log("");
  console.log(`Overall: ${allShaMatch ? "✅ All SHA match" : "❌ SHA mismatch detected"}`);
  console.log(`Receipt: ${receiptPath}`);

  // Exit non-zero if SHA mismatch
  if (!allShaMatch) {
    process.exit(1);
  }
}

main();
