# Pre-Refactor Checkpoint

**Date**: 2026-07-10  
**Base commit**: `db4c10c56a3a` (`master`)  
**Frozen baseline**: three checkpoint commits on top of base (permissions/runtime → waterfall/UI → tests/styles)

## Verification baseline (this round)

| Gate | Result | Notes |
|------|--------|-------|
| `npm run build` | PASS | tsc + `build-styles` + esbuild |
| `npm run test:unit` | **1190 passed**, 0 failed, 25 skipped | includes approval-profile + waterfall guards |
| `npm run test:process` | **233 passed**, 0 failed, 56 skipped | |
| `npm run test:presentation` | **7 passed**, 0 failed | `scripts/presentation/` semantic suite |
| Obsidian deploy + reload | **PASS** | `deploy-to-obsidian.ps1` → both vault plugin dirs; SHA-256 of `main.js` matched repo; CDP `plugin:reload` → **v2.18.0**; bridge health OK on live vault `D:\Users\Ye_Luo\APP\Obsidian\LLM-Wiki` (Obsidian restarted with `--remote-debugging-port=9223`) |

## Semantic invariants (do not regress)

1. True `thinking` / reasoning events → Thinking only (`kind: "thinking"`); faded stream + glow only for real reasoning.
2. Intermediate assistant messages → waterfall **说明** (`answerRole: "process"`); never labeled Thinking.
3. Every `agentMessage` owns **one stable DOM node** in the waterfall. Terminal message is `answerRole: "candidate"`; on turn/completed it upgrades **in place** to Markdown.
4. `finalAnswer` is a **copy/persist projection only** — not a second Final Answer DOM twin. UI node remains the last assistant candidate in the waterfall.
5. If tools follow a candidate → demote that node to `process` (single owner via view-model rebuild; no DOM copy).
6. Streaming body (`.llm-bridge-msg-stream-text`) is plain text: only `white-space: pre-wrap` (no code-block border/background).
7. Codex approval: ask=`on-request`+`user`+`workspaceWrite`; auto=`on-request`+`auto_review`+`workspaceWrite`; full-access=`never`+`user`+`dangerFullAccess`.
8. `turn/start` must send `approvalPolicy` + `approvalsReviewer` + `sandboxPolicy` (resume path).

## Naming debt (fix during structure split)

`feedItems` / `codexProcessFeed` already hold Thinking + process narrative + tools + terminal candidate — not a “process-only” feed.

During refactor, prefer:

- `feedItems` → `timelineItems` or `waterfallItems`
- `codexProcessFeed.ts` → `codexWaterfall.ts`

Do **not** reintroduce a separate Final Answer DOM owner when renaming.

## Parallel ownership (after this checkpoint)

Structure-only first: **no visual/behavior change**, Obsidian native DOM only (no React/Vue). One method group per move; after each move: `build` + `test:presentation` + `test:unit`.

| Agent | Owns | Must not touch |
|-------|------|----------------|
| **A** | Split `src/view.ts` Message + Waterfall renderers under `src/ui/` | `styles/**` cleanup, Composer menus, `src/runtime/providers/**` main chain |
| **B** | Test framework; replace source-string guards in `run-tests.mjs` with real DOM/event-sequence tests (`scripts/presentation/`, future `tests/`) | Production DOM in `src/view.ts` / `src/ui/**`, runtime/provider main chain |
| **C** | Split Composer, attachments, permission + model menus from `src/view.ts` | Waterfall/Message renderers (A), `legacy.css` cleanup, runtime/provider main chain |
| **CSS** | Deferred | Do **not** clean `legacy.css` / Thinking glow polish until DOM/class ownership stabilizes |

## Suggested first extracted seams

**Agent A (Message / Waterfall)**

- `renderCodexFeed*`, `patchCodexFeed*` item/tool-group patches remain on `LLMBridgeView` for now
- **Round 1 done:** `reconcileCodexRunWaterfall` / `patchCodexFeedStable` / `upgradeCodexCandidateAnswerInFeed` → `src/ui/codexWaterfallRenderer.ts` (single reconcile entry; keys/expand/candidate identity preserved)
- deleted dead `renderCodexFinalAnswer` + `ensureCodexFinalAnswerNode` shims
- **Round 2 done:** `renderMessage` / `renderMessageContent` / actions / error / suppress helpers → `src/ui/messageRenderer.ts` (View keeps thin wrappers + fileRefs/details/actions orchestration)
- `appendMsgDetails` / `updateAssistantMessage` / `renderMessageFileRefs` remain on View for now
- Round 3: ComposerController

**Agent C (Composer)**

- permission popover / approval profile chip
- model/effort picker
- composer file refs / attachment tokens

Keep `LLMBridgeView` as thin orchestrator; pass deps explicitly (no circular imports with runtime).

## Out of scope until structure is stable

- Thinking glow / spacing / typography / collapse polish
- Broad `legacy.css` deletion
- Runtime/provider main-chain refactors
- Multi-person deep edits without syncing on this checkpoint
