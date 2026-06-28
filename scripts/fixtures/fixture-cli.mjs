// LLM CLI Bridge — 本地 fixture CLI
// 用 Node 脚本模拟真实 agent 进程，供 process integration tests 使用
// 不依赖 Obsidian，不引入真实 agent
//
// 用法：node fixture-cli.mjs <mode>
// mode:
//   success       — 多段 stdout，exit 0
//   failure       — stderr，exit 1
//   mixed         — stdout + stderr，exit 0
//   slow          — 延迟输出，用于 stop 测试（运行约 30s）
//   large-output  — 较长 stdout，用于确认不污染诊断日志
//   write-file    — 向 cwd 写入一个 .md 文件后 exit 0（用于 V0.9 文件检测测试）
//
// 所有模式均从 stdin 读取 prompt（claudeCliBackend 会 write prompt 到 stdin），
// 但 fixture 不必处理 prompt 内容，只读空以避免 stdin 阻塞。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    // 兜底：500ms 后强制结束，避免 stdin 未关闭导致挂起
    setTimeout(() => resolve(data), 500);
  });
}

async function main() {
  // 消费 stdin（claudeCliBackend 会写入 prompt 并 end）
  await readStdin();

  switch (mode) {
    case "success": {
      // 多段 stdout delta
      process.stdout.write("Hello ");
      process.stdout.write("from ");
      process.stdout.write("fixture\n");
      process.exit(0);
    }
    case "failure": {
      process.stderr.write("fixture error: something went wrong\n");
      process.exit(1);
    }
    case "mixed": {
      process.stdout.write("partial stdout\n");
      process.stderr.write("warning on stderr\n");
      process.stdout.write("more stdout\n");
      process.exit(0);
    }
    case "slow": {
      // 延迟输出，运行约 30s，用于 stop 测试
      process.stdout.write("starting slow task\n");
      let count = 0;
      const interval = setInterval(() => {
        count += 1;
        process.stdout.write(`tick ${count}\n`);
        if (count >= 60) {
          clearInterval(interval);
          process.exit(0);
        }
      }, 500);
      // 兜底：30s 后强制退出
      setTimeout(() => process.exit(0), 30000);
      return;
    }
    case "large-output": {
      // 较长 stdout，确认不会污染诊断日志
      for (let i = 0; i < 1000; i++) {
        process.stdout.write(`line ${i}: ${"x".repeat(80)}\n`);
      }
      process.exit(0);
    }
    case "write-file": {
      // V0.9: 向 cwd 写入一个 .md 文件，模拟 agent 生成笔记
      const targetDir = join(process.cwd(), "generated");
      try {
        mkdirSync(targetDir, { recursive: true });
      } catch { /* 已存在忽略 */ }
      const fileName = `fixture-output-${Date.now()}.md`;
      writeFileSync(join(targetDir, fileName), `# Fixture 生成笔记

本文件由 fixture-cli write-file 模式生成，用于验证 V0.9 文件检测逻辑。
生成时间：${new Date().toISOString()}
`);
      process.stdout.write(`已写入 ${fileName}\n`);
      process.exit(0);
    }
    default: {
      process.stderr.write(`unknown fixture mode: ${mode}\n`);
      process.exit(2);
    }
  }
}

main().catch((e) => {
  process.stderr.write(`fixture crash: ${e?.stack || e?.message || String(e)}\n`);
  process.exit(3);
});
