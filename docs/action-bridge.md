# LLM CLI Bridge — HTTP Action Bridge 协议

## 概述

HTTP Action Bridge 是 Claude Code 与 **Obsidian UI / 编辑器 / 状态** 交互的主通道。

**定位**：
- **普通文件操作**（创建/修改/追加 Markdown 文件）：Claude Code 直接读写 Vault 文件系统，**不走** HTTP Bridge
- **Obsidian 交互**（通知、打开笔记、当前光标、当前选区、活动状态）：通过 HTTP Bridge
- **内容生成**：直接写入 `90_AI整理待确认/` 目录，插件检测新增文件并显示

Outbox（轮询 `actions.jsonl`）作为 fallback，仅在 HTTP server 不可用时使用。

```
文件写入：Claude Code → 直接写 Vault 文件系统
UI/编辑器：Claude Code → HTTP POST /action → llm-cli-bridge → Obsidian API
```

---

## bridge.json

插件启动后在 `.llm-bridge/bridge.json` 写入连接信息：

```json
{
  "host": "127.0.0.1",
  "port": 62072,
  "token": "a3f8c2d1e5b7...",
  "vaultPath": "D:/Users/.../LLM-Wiki",
  "startedAt": "2024-01-01T12:00:00.000Z"
}
```

- `host` / `port`：HTTP server 地址
- `token`：每次启动随机生成（48 字符十六进制），用于 Authorization header 鉴权
- `vaultPath`：Vault 根目录完整路径
- `startedAt`：插件启动时间（ISO 8601）

---

## HTTP API

所有端点地址：`http://127.0.0.1:<port>`

### GET /health

健康检查。**不需要 Authorization header**。

```bash
curl http://127.0.0.1:62072/health
```

响应：
```json
{ "ok": true, "vault": "D:/Users/.../LLM-Wiki", "startedAt": "...", "uptimeMs": 12345 }
```

### GET /state

获取当前 Vault 实时状态。**需要 Authorization header**。

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:62072/state
```

响应：
```json
{ "ok": true, "result": { "vaultPath": "...", "activeFilePath": "a.md", "hasActiveFile": true, "hasSelection": false, "selectionLength": 0, "timestamp": "..." } }
```

### POST /action

执行单个 action。**需要 Authorization header**。

两阶段 lifecycle：
- **非修改类**（show_notice / open_note / get_*）：同步执行，立即返回结果，HTTP 状态码 200
- **修改类**（create_note / append_to_note / insert_at_cursor / replace_selection）：立即返回 pending 状态，HTTP 状态码 202，后台弹出确认框

```bash
curl -X POST http://127.0.0.1:62072/action \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id":"msg-001","type":"show_notice","params":{"message":"Hello"}}'
```

**非修改类响应（200）**：
```json
{ "ok": true, "id": "msg-001", "type": "show_notice", "status": "completed", "confirmed": true }
```

**修改类响应（202）**：
```json
{ "ok": true, "id": "msg-001", "type": "create_note", "status": "pending_approval", "confirmed": false }
```

**用户拒绝响应（200）**：
```json
{ "ok": false, "id": "msg-001", "type": "create_note", "error": "user declined", "confirmed": false, "status": "declined" }
```

### GET /action-status

查询 pending action 的状态。**需要 Authorization header**。

```bash
curl -H "Authorization: Bearer <token>" "http://127.0.0.1:62072/action-status?id=msg-001"
```

响应：
```json
{ "ok": true, "id": "msg-001", "status": "completed", "result": { "path": "a.md" } }
```

可能的 status 值：`pending_approval` | `completed` | `declined` | `cancelled`

### POST /batch

批量执行多个 action。**需要 Authorization header**。

```bash
curl -X POST http://127.0.0.1:62072/batch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"actions":[{"type":"get_state"},{"type":"get_selection"}]}'
```

---

## Action 分类与 Schema

HTTP Bridge 只处理 Obsidian UI / 编辑器 / 状态相关交互。普通文件写入请直接操作文件系统。

### UI actions（操作 Obsidian 界面）

**show_notice** — 弹出 Obsidian 通知。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | ✓ | 通知内容 |

```json
{ "type": "show_notice", "params": { "message": "处理完成" } }
```

**open_note** — 在 Obsidian 中打开指定笔记。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | ✓ | 相对于 vault 根的笔记路径 |

```json
{ "type": "open_note", "params": { "path": "a.md" } }
```

### Context actions（读取当前状态）

**get_state** — 获取当前 Vault 实时状态（活动文件、选区、时间戳）。

```json
{ "type": "get_state", "params": {} }
```

**get_active_note** — 获取当前活动笔记的路径和全文。

```json
{ "type": "get_active_note", "params": {} }
```

**get_selection** — 获取当前选区文本。

```json
{ "type": "get_selection", "params": {} }
```

### Editor actions（操作当前编辑器光标/选区）

**insert_at_cursor** — **需要确认**。在当前活动的 Markdown 视图光标位置插入内容。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | ✓ | 插入内容 |

```json
{ "type": "insert_at_cursor", "params": { "content": "插入的文本" } }
```

**replace_selection** — **需要确认**。替换当前选区内容（无选区则失败）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | ✓ | 替换内容 |

```json
{ "type": "replace_selection", "params": { "content": "替换后的文本" } }
```

### File fallback actions（不推荐，直接写文件更好）

> ⚠️ 普通文件操作请直接读写 Vault 文件系统。以下 action 仅作为便利 fallback 保留。

**create_note** — **需要确认**。创建新笔记（已存在则失败）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | ✓ | 相对于 vault 根的笔记路径 |
| content | string | ✓ | 笔记内容 |

```json
{ "type": "create_note", "params": { "path": "90_AI整理待确认/x.md", "content": "# 标题\n\n内容" } }
```

**append_to_note** — **需要确认**。追加内容到已有笔记。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | ✓ | 相对于 vault 根的笔记路径 |
| content | string | ✓ | 追加内容 |

```json
{ "type": "append_to_note", "params": { "path": "a.md", "content": "\n\n更多内容" } }
```

---

## 路径安全校验

插件只强制安全边界，不限制具体目录：

**强制拒绝**：
- 绝对路径（`C:\...` 或 `/...`）
- 路径遍历（`../`）
- `.obsidian/` 目录
- `.llm-bridge/bridge.json`、`.llm-bridge/token`、`.llm-bridge/config` 等敏感文件
- `private`、`token`、`config`、`credentials`、`secrets`、`.env`、`.git` 等敏感路径

**目录归档规则**（非强制）：
- 优先遵循 Vault 根目录下的 `AGENTS.md` 中的目录约定
- 若无约定，可参考用户设置的「推荐输出目录」（可在插件设置页修改或留空）
- 用户请求中明确指定路径时，以用户指定为准
- 插件会检测运行期间新增/修改的 Markdown 文件（排除 `.obsidian/`、`.llm-bridge/`、`node_modules/`、`.git/`），并在 Bridge 面板显示

**安全边界优先级**：无论用户指定什么路径，只要触碰安全边界就会被拒绝。

---

## obsidian-action.mjs Helper

插件会在 `.llm-bridge/tools/obsidian-action.mjs` 生成 ESM helper 脚本。

### 在脚本中 import

```javascript
import { createClient } from "./.llm-bridge/tools/obsidian-action.mjs";

const client = createClient();  // 默认读取 process.cwd()/.llm-bridge/bridge.json
// 或显式指定 vault 路径：
// const client = createClient("/path/to/vault");

const r = await client.health();
console.log(r);   // { status: 200, ok: true, data: { vault, startedAt, uptimeMs } }

await client.showNotice("Hello");
await client.createNote("90_AI整理待确认/x.md", "# 标题");
```

### CLI 用法

```bash
# 健康检查
node .llm-bridge/tools/obsidian-action.mjs health

# 获取状态
node .llm-bridge/tools/obsidian-action.mjs state

# 执行 action（默认不等待修改类 action 的确认结果）
node .llm-bridge/tools/obsidian-action.mjs show_notice '{"message":"hi"}'
node .llm-bridge/tools/obsidian-action.mjs create_note '{"path":"a.md","content":"# a"}'

# 执行并等待修改类 action 的确认结果（轮询 action-status）
node .llm-bridge/tools/obsidian-action.mjs --wait create_note '{"path":"a.md","content":"# a"}'

# 指定最长等待时间（秒）
node .llm-bridge/tools/obsidian-action.mjs --timeout 60 --wait create_note '{"path":"a.md","content":"# a"}'

# 输出原始 JSON（不等待确认结果）
node .llm-bridge/tools/obsidian-action.mjs --json create_note '{"path":"a.md","content":"# a"}'
```

### 便捷方法

| 方法 | 等价调用 |
|------|----------|
| `client.health()` | GET /health |
| `client.state()` | GET /state |
| `client.action(type, params, id)` | POST /action |
| `client.actionStatus(actionId)` | GET /action-status |
| `client.batch(actions)` | POST /batch |
| `client.showNotice(msg)` | POST /action show_notice |
| `client.openNote(path)` | POST /action open_note |
| `client.getState()` | POST /action get_state |
| `client.getActiveNote()` | POST /action get_active_note |
| `client.getSelection()` | POST /action get_selection |
| `client.createNote(path, content)` | POST /action create_note |
| `client.appendToNote(path, content)` | POST /action append_to_note |
| `client.insertAtCursor(content)` | POST /action insert_at_cursor |
| `client.replaceSelection(content)` | POST /action replace_selection |

---

## Outbox Fallback

当 HTTP server 不可用时，Claude Code 可向 `.llm-bridge/outbox/actions.jsonl` 追加 JSON 行：

```jsonl
{"id":"a-001","type":"show_notice","params":{"message":"fallback"},"ts":"2024-01-01T12:00:00.000Z"}
{"id":"a-002","type":"create_note","params":{"path":"a.md","content":"# a"},"ts":"2024-01-01T12:00:01.000Z"}
```

插件启动时先标记已有 action 为已处理（不执行历史），然后每 1.5 秒轮询新行并执行。

---

## Action 日志

所有 action（无论来源是 HTTP 还是 outbox）都会追加写入 `.llm-bridge/logs/actions.jsonl`：

```jsonl
{"ts":"...","id":"msg-001","type":"show_notice","params":{"message":"hi"},"ok":true,"status":"completed","source":"http"}
{"ts":"...","id":"a-002","type":"create_note","params":{"path":"a.md","content":"..."},"ok":true,"status":"pending_approval","confirmed":false,"source":"http"}
{"ts":"...","id":"a-003","type":"create_note","params":{"path":"a.md","content":"..."},"ok":true,"status":"completed","confirmed":true,"source":"http"}
{"ts":"...","id":"a-004","type":"create_note","params":{"path":"a.md","content":"..."},"ok":false,"error":"user declined","status":"declined","confirmed":false,"source":"http"}
{"ts":"...","id":"a-005","type":"create_note","ok":false,"error":"plugin unloaded","status":"cancelled","source":"http"}
```

日志字段：`ts` / `id` / `type` / `params`（长字符串截断） / `ok` / `status` / `confirmed` / `error` / `source`（http/outbox）。

---

## 修改类 Action 确认流程（两阶段）

1. **发起请求**：POST /action，修改类立即返回 HTTP 202 + `{ ok:true, status:"pending_approval", confirmed:false, actionId }`
2. **后台弹窗**：插件弹出 ConfirmModal，用户在 Obsidian 中操作
3. **查询状态**：GET /action-status?id=actionId，可返回 pending_approval / completed / declined / cancelled
4. **CLI 等待**：用 `--wait` 参数自动轮询 action-status，直到终态或超时
5. **插件卸载**：所有 pending action 自动标记为 cancelled
