# Presentation behavior tests (Agent B)

Home for **event-sequence → view-model** presentation semantics and future DOM-adjacent smoke tests. Keeps `scripts/run-tests.mjs` thinner without colliding with Agent A (`src/view.ts` split) or Agent C (`src/runtime/`).

## Layout

```
scripts/presentation/
  README.md                          ← this file
  run-presentation-tests.mjs         ← standalone runner + docs report
  _bundle.mjs                        ← shared esbuild helpers for runtime imports
  codex-run-view-model-semantic.mjs  ← V17-G CodexRunViewModel semantics (extracted)
  fixtures/
    codex-run-events.mjs             ← mkCodexRunEvent + default view opts
  # future (not yet extracted):
  # message-presentation-semantic.mjs  ← buildMessagePresentation feed/chrome split
  # view-src-smoke.mjs                 ← view.ts / styles.css string guards (process mode)
```

## V17-G tests covered

| Test | Event sequence |
| --- | --- |
| Layering (header/feed/steps/approval/debug) | thinking → tool → file → approval |
| Final answer not in feed | thinking → completed |
| Mid assistant → process, final → Answer | assistant → tool → assistant → file → assistant → completed |
| **Single assistant** | message → completed → Answer only |
| **a→tool→a** | assistant → tool → assistant → Answer |
| **reasoning→tool→answer** | thinking → tool → message → completed |
| **Move candidate** | partial assistant in Answer; after tool → process feed |

## How to run

**Standalone (fast, presentation-only):**

```bash
node scripts/presentation/run-presentation-tests.mjs
node scripts/presentation/run-presentation-tests.mjs --filter codex-run
```

Report: `docs/test-report-presentation.md`

**Via main runner (unchanged flags):**

```bash
node scripts/run-tests.mjs --unit
npm run test:unit
```

The V17-G block in Bridge Core section delegates to `codex-run-view-model-semantic.mjs`.

## Ownership boundaries

| Agent | Owns | Does not touch |
| --- | --- | --- |
| **B (this)** | `scripts/presentation/`, presentation smoke scripts, test reports | `src/view.ts`, `src/runtime/`, `styles/` |
| **A** | `src/view.ts` split / DOM render | presentation test fixtures |
| **C** | `src/runtime/` core models | test runner structure |

## Adding tests

1. Add fixtures under `fixtures/` if event builders are reused.
2. Export `runXxxTests({ addTest, ...mods })` from a new module.
3. Call it from `run-presentation-tests.mjs` and optionally from `run-tests.mjs` (additive import only).
