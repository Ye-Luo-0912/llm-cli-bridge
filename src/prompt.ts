// LLM CLI Bridge — 包装发送给 CLI agent 的 prompt

import { LLMBridgeSettings } from "./types";

export function buildPrompt(userInput: string, settings: LLMBridgeSettings): string {
  return `你正在处理一个 Obsidian Vault。

当前 Vault 根目录就是你的工作目录。

Obsidian 状态文件（每次发送前由插件刷新）：
- \`.llm-bridge/state/current.json\` — Vault 基本信息（vaultPath / activeFilePath / hasActiveFile / hasSelection / selectionLength / timestamp）
- \`.llm-bridge/state/active-note.md\` — 当前笔记全文（仅当用户开启"引用当前笔记"时存在）
- \`.llm-bridge/state/selection.md\` — 当前选区内容（仅当用户开启"引用选区"且存在选区时存在）
- \`.llm-bridge/state/metadata.json\` — 当前笔记的元信息（frontmatter / tags / outgoingLinks / backlinks / headings）

========== 与 Obsidian 交互的两种方式（严格按优先级） ==========

【优先级 1 — 直接文件系统】普通 Markdown 文件读写
- 创建、修改、追加 Markdown 文件直接用文件系统操作（cat / write / Edit 等）。
- 不要走 HTTP Bridge 或 helper 来创建/修改 Markdown 文件。
- 目录归档规则优先遵循 AGENTS.md；若无约定可参考推荐目录 \`${settings.outputDir}\`；用户明确指定时以用户为准。

【优先级 2 — Helper Action】需要操作 Obsidian UI / 编辑器 / 当前状态时
- 工具：\`.llm-bridge/tools/obsidian-action.mjs\`（由插件自动生成，读取 bridge.json，自动带 token）。
- 适用场景：弹出通知、打开笔记、读取当前活动笔记/选区、在光标处插入、替换选区。
- **必须使用 helper，不要通过写 actions.jsonl 文件来触发 action。**
- 写 actions.jsonl 是被废弃的首选路径，仅作为最后兜底（见优先级 3）。

Helper 用法（在 Bash 工具里执行）：
- 健康检查：\`node .llm-bridge/tools/obsidian-action.mjs health\`
- 获取状态：\`node .llm-bridge/tools/obsidian-action.mjs state\`
- 执行动作：\`node .llm-bridge/tools/obsidian-action.mjs <type> '<json-params>'\`
  示例（UI 通知）：\`node .llm-bridge/tools/obsidian-action.mjs show_notice '{"message":"已完成"}'\`
  示例（打开笔记）：\`node .llm-bridge/tools/obsidian-action.mjs open_note '{"path":"笔记名.md"}'\`
  示例（替换选区，需确认）：\`node .llm-bridge/tools/obsidian-action.mjs --wait replace_selection '{"content":"新内容"}'\`
  示例（在光标处插入，需确认）：\`node .llm-bridge/tools/obsidian-action.mjs --wait insert_at_cursor '{"content":"新内容"}'\`

或在脚本中 import：
\`\`\`js
import { createClient } from "./.llm-bridge/tools/obsidian-action.mjs";
const client = createClient();
await client.health();
await client.state();
await client.showNotice("处理完成");
await client.openNote("a.md");
await client.replaceSelection("替换内容");
\`\`\`

Helper 标志：
- \`--wait\`：对修改类 action（需确认）轮询直到终态（completed / declined），默认超时 5 分钟
- \`--timeout <sec>\`：配合 --wait 设置超时
- \`--json\`：输出原始 JSON，便于脚本解析

【优先级 3 — Outbox 兜底】仅当 HTTP server 不可用时
- 只有当 helper 报错"无法连接到 Obsidian Bridge"且 Obsidian 未启动时，才向 \`.llm-bridge/outbox/actions.jsonl\` 追加 JSON 行（每行一个 { id, type, params, ts? }），插件下次启动时轮询执行。
- **不要在 Obsidian 正常运行时使用 outbox。** 优先用 helper。

========== HTTP API 参考（helper 已封装，通常无需直接调用） ==========

插件在启动时开启本地 HTTP server（仅监听 127.0.0.1），连接信息写入 \`.llm-bridge/bridge.json\`，字段：host / port / token / vaultPath / startedAt。

- GET  /health                       不需鉴权，返回 { ok, vault, startedAt, uptimeMs }
- GET  /state                         需鉴权，返回当前活动笔记/选区等实时状态
- GET  /action-status?id=<id>         需鉴权，查询 pending action 状态
- POST /action   body: { id?, type, params }    执行单个动作，返回 { ok, result?, error?, status?, idempotent? }
- POST /batch    body: { actions: [...] }        批量执行，返回 { ok, results: [...] }
所有非 /health 请求需带 header：\`Authorization: Bearer <token>\`（token 在 bridge.json 中）。

Idempotency：如果 POST /action 时客户端显式传入 id 且该 id 已处理过，返回现有状态（\`idempotent: true\`），不重复执行。

========== Action 分类 ==========

UI actions（操作 Obsidian 界面）：
| type          | params               | 确认 | 说明                       |
|---------------|----------------------|------|----------------------------|
| show_notice   | {"message":"..."}    | 否   | 弹出 Obsidian 通知         |
| open_note     | {"path":"..."}       | 否   | 在 Obsidian 中打开指定笔记 |

Context actions（读取当前状态）：
| type            | params | 确认 | 说明                           |
|-----------------|--------|------|--------------------------------|
| get_state       | {}     | 否   | 返回当前 vault/活动笔记/选区状态 |
| get_active_note | {}     | 否   | 返回当前活动笔记路径+全文        |
| get_selection   | {}     | 否   | 返回当前选区文本                 |

Editor actions（操作当前编辑器光标/选区）：
| type              | params             | 确认 | 说明                       |
|-------------------|--------------------|------|----------------------------|
| insert_at_cursor  | {"content":"..."}  | 是   | 在当前光标处插入内容       |
| replace_selection | {"content":"..."}  | 是   | 替换当前选区内容           |

File fallback actions（不推荐，直接写文件更好）：
| type           | params                            | 确认 | 说明                                       |
|----------------|-----------------------------------|------|--------------------------------------------|
| create_note    | {"path":"...","content":"..."}    | 是   | 创建新笔记（仅作为 fallback，推荐直接写文件） |
| append_to_note | {"path":"...","content":"..."}    | 是   | 追加到已有笔记（仅作为 fallback，推荐直接写文件）|

注意：
- 需要确认的 action 会进入 pending_approval 状态，用户拒绝则不执行（error: "user declined"）。
- insert_at_cursor / replace_selection 作用于当前活动的 Markdown 视图。
- create_note / append_to_note 仅作为便利 fallback，普通文件写入请直接操作文件系统。
- 所有 action 执行结果会追加写入 \`.llm-bridge/logs/actions.jsonl\`（含 source: http/outbox）。
- devTestMode=true 时 approve/reject 操作记录在 \`.llm-bridge/logs/dev-ops.jsonl\`。
- 插件会检测运行期间新增/修改的 Markdown 文件（排除 .obsidian/.llm-bridge/node_modules/.git/LLM-AgentRuntime/dist/build），并显示可点击打开。

========== 用户请求 ==========

${userInput}

========== 规则汇总 ==========

- 创建/修改 Markdown 文件 → 直接写文件系统，不要走 create_note / append_to_note action，也不要走 helper。
- 操作 Obsidian UI / 编辑器 / 选区 / 通知 → 必须用 helper (\`.llm-bridge/tools/obsidian-action.mjs\`)，不要写 actions.jsonl。
- 只有 Obsidian 未启动且 helper 报连接失败时，才向 outbox/actions.jsonl 追加 action 作为兜底。
- 目录归档规则：优先遵循 AGENTS.md；若无约定可参考推荐目录 \`${settings.outputDir}\`；用户明确指定时以用户为准。
- 插件会检测运行期间新增/修改的 Markdown 文件（排除 .obsidian/.llm-bridge/node_modules/.git/LLM-AgentRuntime/dist/build），并显示可点击打开。
- 不要在聊天输出里打印完整长文件。
- 修改文件前优先说明计划。
- 如果只是测试连接，请简短回复。
`;
}
