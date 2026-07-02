# Codex real app-server smoke 报告

- **测试时间**: 2026-07-02T15:21:10.607Z
- **codex 可用**: 否
- **skip 原因**: spawnSync codex ENOENT
- **说明**: 本机无 codex CLI，real app-server smoke 明确 skip。
  fixture schema tests 仍覆盖协议映射；real smoke 在 codex 可用环境（CI 装有 codex / 开发者本机）运行。

*报告由 `scripts/codex-app-server-smoke.mjs` 自动生成*
