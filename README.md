# LLM CLI Bridge

LLM CLI Bridge is an Obsidian desktop plugin that turns a Vault into a compact Claude Code / Claude SDK workbench.

The plugin is a context and permission bridge: it manages the chat UI, Working Set, attachments, Agent Skills status, external read approvals, and native handoff guidance. Claude Code / SDK keep responsibility for native file execution inside the Vault.

Current release candidate: `2.15.0`.

---

## Quick Start

1. Install Claude Code and confirm `claude --version` works.
2. Download `llm-cli-bridge-<version>.zip`.
3. Copy the 6 release files into `<Vault>/.obsidian/plugins/llm-cli-bridge/`.
4. Restart Obsidian and enable `LLM CLI Bridge` in Community plugins.
5. Open the Bridge view and send a message from the bottom composer.

Release zip contents:

```text
llm-cli-bridge-<version>/
├── main.js
├── manifest.json
├── styles.css
├── README.md
├── RELEASE_CHECKLIST.md
└── USER_GUIDE.md
```

For end-user steps, see [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

---

## UI Structure

V2.15 uses a compact Obsidian panel shell:

- Left rail: icon-only navigation for `Chat`, `Files`, `Skills`, and `History`.
- Topbar: `Bridge`, current session selector, new chat, settings gear, and compact runtime status.
- Chat: message stream, thinking/status cards, collapsed command/workflow/debug details, and concise error cards.
- Composer: upload, command menu, permission chip, input, model/effort selector, and send/stop.
- Working Set strip: compact chips for `AGENTS.md`, active note, selection, and FileRefs.
- Files page: Working Set, attachments, FileRef index, and external read requests.
- Skills page: Agent Skills runtime capabilities only. Clicking a skill previews/toggles state and never inserts text into the composer.
- History page: session list, preview, restore, rename, and delete.

Settings stay in the topbar gear and the normal Obsidian plugin settings modal.

---

## Claude Runtime Config

Use project-local Claude configuration through `CLAUDE_CONFIG_DIR`.

Recommended project config file:

```json
{
  "claudeConfigDir": "D:\\Users\\Ye_Luo\\APP\\Test\\Obsidian\\LLM-AgentRuntime\\private\\claude-config"
}
```

Store it at:

```text
<Vault>/.llm-bridge/claude-runtime.json
```

Rules:

- `CLAUDE_CONFIG_DIR` is the supported runtime config variable.
- `ANTHROPIC_CONFIG_DIR` is not used.
- Do not rely on shell launcher scripts to inject Claude config.
- Tokens remain in the local Claude config directory and are not copied into plugin settings or release artifacts.

---

## Native Handoff Boundary

The plugin does not try to replace Claude Code / SDK file capabilities.

Allowed direction:

- Claude Code / SDK handle native Vault file reads and edits.
- The plugin tells the runtime the Vault root, Working Set, attachment paths, and boundary guidance.
- Small user-added text / markdown / json attachments may be bounded into prompt context.
- Image, PDF, binary, and unknown files stay as refs / native handoff paths.

Closed direction:

- No plugin-owned Vault write executor.
- No backup / rollback / audit transaction layer.
- No external write / delete / rename.
- No OCR, PDF parser, image parser, base64 image injection, or SDK image streaming.
- No complex custom runtime tool registration expansion.

External reads require explicit approval. Sensitive paths such as `.env`, credentials, `.ssh`, private keys, `.git/config`, `.obsidian`, and credential-bearing `.llm-bridge` paths remain denied or strong-risk gated.

---

## Commands

Obsidian command palette:

| Command | Purpose |
| --- | --- |
| Open LLM CLI Bridge panel | Open the Bridge view |
| Ask Claude about selection | Put selected text into context |
| Rewrite selection with Claude | Ask Claude to rewrite and use the existing selection action |
| Summarize active note to pending note | Summarize current note into the configured output directory |
| Create pending note from selection | Create a pending note from selected text |
| Open last generated note | Open the newest generated Markdown file |

The composer command menu contains runtime checks, context refresh, and attachment fallback controls without spreading buttons across the main panel.

---

## Build, Test, Release

```bash
npm install
npm run build
npm run test:unit
npm run test:process
npm run test:claude
npm run release
```

`npm run release` builds the plugin, stages exactly the 6 release files, scans the stage for sensitive data, and writes `release/llm-cli-bridge-<version>.zip`.

---

## Logs And Local Files

Runtime data lives under the Vault-local `.llm-bridge/` directory:

| Path | Purpose |
| --- | --- |
| `.llm-bridge/bridge.json` | Local bridge port/token metadata |
| `.llm-bridge/claude-runtime.json` | Project-local Claude config pointer |
| `.llm-bridge/logs/` | Debug and action logs |
| `.llm-bridge/sessions/` | Saved sessions |
| `.llm-bridge/skills.md` | Legacy file from older releases; no longer read or modified by V2.15 |
| `.llm-bridge/agent-skills.json` | Agent Skill manifest state |

Logs record env key presence and operational metadata, not secret values.

V2.15 does not automatically delete old `.llm-bridge/skills.md` or `.llm-bridge/skills/` data, but these legacy prompt-template paths are no longer part of the UI or runtime flow.

---

## Known Limitations

- Image/PDF/binary attachments are refs only in the plugin UI; ask Claude Code / SDK to inspect them natively.
- External reads require approval and may need a retry after approval.
- External writes, deletes, and renames are intentionally unavailable.
- SDK runtime availability depends on the local portable runtime package and network/auth state.
- Visual smoke should use a single unambiguous test Vault path to avoid same-name Vault selection.

---

## License

MIT
