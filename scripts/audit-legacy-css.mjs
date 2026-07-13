// One-shot audit script: extract CSS selectors from styles/legacy.css
// and determine their reachability across the TypeScript / JavaScript source.
// Writes a markdown report to docs/legacy-css-selector-audit.md.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "d:/Users/Ye_Luo/APP/Test/llm-cli-bridge".replace(/\//g, sep);
const LEGACY_CSS = join(ROOT, "styles", "legacy.css");
const OTHER_CSS_DIR = join(ROOT, "styles");
const REPORT_PATH = join(ROOT, "docs", "legacy-css-selector-audit.md");

// --- 1. Read legacy.css -------------------------------------------------
const legacySrc = readFileSync(LEGACY_CSS, "utf8");
const legacyLineCount = legacySrc.split(/\r?\n/).length;

// Extract class selectors: tokens starting with .[a-zA-Z_-]
// We look at every CSS rule (comma-separated selector lists) and pull class names.
const classSet = new Set();
const idSet = new Set();
const elementSet = new Set();

// Strip /* comments */ so they don't pollute extraction
const stripped = legacySrc.replace(/\/\*[\s\S]*?\*\//g, "");

// Match selector lists: everything before a { ... }
// We use a global regex to find selector groups (text up to '{').
const ruleRe = /([^{}]+)\{/g;
let m;
while ((m = ruleRe.exec(stripped)) !== null) {
  const selectorGroup = m[1];
  // Split comma-separated selectors
  for (const rawSel of selectorGroup.split(",")) {
    const sel = rawSel.trim();
    if (!sel) continue;
    // Skip @media lines and at-rules handled inline
    if (sel.startsWith("@")) continue;
    // Extract classes
    const classMatches = sel.match(/\.[a-zA-Z_][a-zA-Z0-9_-]*/g);
    if (classMatches) {
      for (const c of classMatches) classSet.add(c.slice(1));
    }
    // Extract ids
    const idMatches = sel.match(/#[a-zA-Z_][a-zA-Z0-9_-]*/g);
    if (idMatches) {
      for (const i of idMatches) {
        // ignore color hex like #fff
        const v = i.slice(1);
        if (/^[0-9a-fA-F]{3,8}$/.test(v)) continue;
        idSet.add(v);
      }
    }
    // Extract element selectors (first identifier token)
    const elementMatches = sel.match(/(^|[\s>+~(])\b([a-z][a-zA-Z0-9-]*)\b/g);
    if (elementMatches) {
      for (const e of elementMatches) {
        const name = e.replace(/^[^a-zA-Z]+/, "");
        // Filter out pseudo-classes / pseudo-elements keywords and keywords we don't care about
        if (["from", "to", "and", "or", "not", "in", "is", "where", "matches", "host", "root"].includes(name)) continue;
        if (["html", "body", "div", "span", "p", "a", "img", "ul", "ol", "li", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "small", "button", "input", "textarea", "label", "select", "option", "details", "summary", "table", "thead", "tbody", "tr", "td", "th", "svg", "path", "g", "rect", "circle", "line", "polyline", "polygon", "defs", "use", "text", "tspan", "foreignObject", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "marker", "title"].includes(name)) {
          elementSet.add(name);
        }
      }
    }
  }
}

// --- 2. Gather source files --------------------------------------------
const TS_EXCLUDE_DIRS = new Set([
  join(ROOT, "src", "runtime", "providers", "codex-app-server", "schema", "generated"),
]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "main.js"]);

function walk(dir, out = [], { acceptExt, allowMjs = false, allowTs = true }) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(e)) continue;
      if (TS_EXCLUDE_DIRS.has(full)) continue;
      walk(full, out, { acceptExt, allowMjs, allowTs });
    } else if (st.isFile()) {
      const lower = e.toLowerCase();
      if (allowTs && lower.endsWith(".ts")) out.push(full);
      else if (allowMjs && lower.endsWith(".mjs")) out.push(full);
      else if (allowMjs && lower.endsWith(".js")) {
        // skip build outputs and configs; only take scripts
        if (dir.startsWith(join(ROOT, "scripts"))) out.push(full);
      }
    }
  }
  return out;
}

const tsFiles = [
  ...walk(join(ROOT, "src"), [], { allowTs: true, allowMjs: false }),
  join(ROOT, "main.ts"),
].filter(p => existsSync(p));

const mjsFiles = walk(join(ROOT, "scripts"), [], { allowTs: false, allowMjs: true });

// Also include other CSS files for overlap check
const otherCssFiles = readdirSync(OTHER_CSS_DIR)
  .map(n => join(OTHER_CSS_DIR, n))
  .filter(p => p !== LEGACY_CSS && p.toLowerCase().endsWith(".css"));

// --- 3. Build a big blob of source text --------------------------------
function readFiles(paths) {
  const blobs = [];
  for (const p of paths) {
    try {
      const t = readFileSync(p, "utf8");
      blobs.push({ path: p, text: t });
    } catch {
      // ignore
    }
  }
  return blobs;
}

const tsBlobs = readFiles(tsFiles);
const mjsBlobs = readFiles(mjsFiles).filter(b => !b.path.endsWith("audit-legacy-css.mjs"));
const otherCssBlobs = readFiles(otherCssFiles);

// Combined searchable text (we keep individual blobs for hit reporting)
function combinedSource(blobs) {
  return blobs.map(b => b.text).join("\n/\n");
}
const allSource = combinedSource(tsBlobs) + "\n/\n" + combinedSource(mjsBlobs);

// --- 4. For each class, check reachability ----------------------------
// A class is REACHABLE if it appears as a literal token `llm-bridge-foo`
// somewhere in source. We use a regex with word boundaries that allow
// `:` `"` `'` `` ` `` `(` etc. as context, plus optional `-` suffix for
// dynamic-prefix patterns (we'll separately flag dynamic constructions).
function findHits(className, blobs) {
  const hits = [];
  // Escape regex special chars (class names are simple [A-Za-z0-9_-], only `-` matters)
  const esc = className.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  // Boundary: preceded by non-word OR start, followed by non-word OR end.
  // We require the class name to be a complete token (no extra identifier chars).
  const re = new RegExp(`(^|[^\\w])${esc}([^\\w-]|$)`, "m");
  for (const b of blobs) {
    if (re.test(b.text)) hits.push(b.path);
  }
  return hits;
}

// --- 5. Detect dynamic class construction patterns --------------------
// Look for any template literal of the form `<prefix>${...}` where <prefix>
// is a likely class-name fragment. We intentionally catch BOTH
// `llm-bridge-...${...}` AND bare `is-...${...}` / `is-${...}` since state
// modifiers are routinely built that way.
const dynamicPatterns = [];

// Template-literal patterns: any identifier-ish prefix followed by ${...}
const dynRe = /([a-zA-Z][a-zA-Z0-9_-]*)\$\{[^}]+\}/g;
for (const b of [...tsBlobs, ...mjsBlobs]) {
  // Skip the audit script itself
  if (b.path.endsWith("audit-legacy-css.mjs")) continue;
  let mm;
  while ((mm = dynRe.exec(b.text)) !== null) {
    // Only keep matches where the prefix looks like a class fragment
    // (starts with a letter, contains - or is short like "is")
    const prefix = mm[1];
    if (!/^[a-z]/.test(prefix)) continue;
    // Require at least one dash OR a 2-3 char prefix (e.g. "is")
    if (!prefix.includes("-") && prefix.length > 3) continue;
    const idx = mm.index;
    const ctx = b.text.slice(Math.max(0, idx - 50), idx + 90).replace(/\s+/g, " ").trim();
    dynamicPatterns.push({
      file: relative(ROOT, b.path),
      match: mm[0],
      prefix,
      context: ctx,
    });
  }
}

// String-concatenation patterns: "...prefix-" + variable (e.g. addClass("llm-bridge-tl-tool-cat-" + cat))
const concatRe = /"([a-zA-Z][a-zA-Z0-9_-]+)-"\s*\+\s*[a-zA-Z_$]/g;
for (const b of [...tsBlobs, ...mjsBlobs]) {
  if (b.path.endsWith("audit-legacy-css.mjs")) continue;
  let mm;
  while ((mm = concatRe.exec(b.text)) !== null) {
    const idx = mm.index;
    const ctx = b.text.slice(Math.max(0, idx - 50), idx + 90).replace(/\s+/g, " ").trim();
    dynamicPatterns.push({
      file: relative(ROOT, b.path),
      match: `"${mm[1]}-" + …`,
      prefix: mm[1] + "-",
      context: ctx,
    });
  }
}

// Deduplicate dynamic patterns
const dynSeen = new Set();
const dynamicUnique = [];
for (const d of dynamicPatterns) {
  const key = d.file + "|" + d.match + "|" + d.context;
  if (dynSeen.has(key)) continue;
  dynSeen.add(key);
  dynamicUnique.push(d);
}

// Build a set of "dynamic prefixes" — any class whose name starts with one of
// these prefixes is a candidate false-positive and should be flagged.
// We filter out OVERLY BROAD prefixes that would match too many classes.
// A prefix is "too broad" if:
//   - it is exactly `llm-bridge-` (comes from `llm-bridge-${skill.name}` which
//     produces skill-specific runtime classes that are NOT in legacy.css)
//   - it has fewer than 2 dashes (except `is-` which is a legit state-modifier prefix)
const BROAD_PREFIX_BLOCKLIST = new Set([
  "llm-bridge-", // from llm-bridge-${skill.name} — too broad
]);
const dynamicPrefixes = new Set();
for (const d of dynamicUnique) {
  let p = d.prefix;
  if (!p.endsWith("-")) p = p + "-";
  if (BROAD_PREFIX_BLOCKLIST.has(p)) continue;
  // Also drop prefixes that aren't likely CSS-class prefixes (from script IDs etc.)
  // Require the prefix to start with either `is-` or `llm-bridge-` (CSS namespace)
  if (!p.startsWith("is-") && !p.startsWith("llm-bridge-")) continue;
  dynamicPrefixes.add(p);
}

// Given a class name, decide if it is producible by a dynamic prefix.
// Returns the LONGEST matching prefix (most specific) for better reporting.
function producibleByDynamic(cls) {
  let best = null;
  for (const p of dynamicPrefixes) {
    if (cls.startsWith(p) && cls.length > p.length) {
      if (best === null || p.length > best.length) best = p;
    }
  }
  return best;
}

// --- 6. Compute reachability per class ---------------------------------
const reachable = [];
const unreachable = [];
const unreachableDynamic = []; // unreachable BUT producible by a dynamic prefix

for (const cls of [...classSet].sort()) {
  // Always exclude checking inside legacy.css itself; we already know it's defined there.
  const tsHits = findHits(cls, tsBlobs);
  const mjsHits = findHits(cls, mjsBlobs);
  // Also check other CSS files for overlap
  const cssHits = findHits(cls, otherCssBlobs);
  if (tsHits.length > 0 || mjsHits.length > 0) {
    reachable.push({ cls, ts: tsHits, mjs: mjsHits, css: cssHits });
  } else {
    const dynPrefix = producibleByDynamic(cls);
    if (dynPrefix) {
      unreachableDynamic.push({ cls, css: cssHits, dynPrefix });
    } else {
      unreachable.push({ cls, css: cssHits });
    }
  }
}

// --- 7. CSS overlap check ----------------------------------------------
// Build a map: class -> set of other CSS files that also define it
const overlap = {};
for (const cls of classSet) {
  const files = [];
  for (const b of otherCssBlobs) {
    const re = new RegExp(`(^|[^\\w])\\.${cls.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^\\w-]|$)`, "m");
    if (re.test(b.text)) files.push(basename(b.path));
  }
  if (files.length > 0) overlap[cls] = files;
}

// --- 8. Build report ---------------------------------------------------
const totalClasses = classSet.size;
const reachableCount = reachable.length;
const unreachableCount = unreachable.length;
const unreachableDynamicCount = unreachableDynamic.length;

const lines = [];
lines.push("# Legacy CSS Selector Audit");
lines.push("");
lines.push(`Target file: \`styles/legacy.css\` (${legacyLineCount} lines)`);
lines.push("");
lines.push("## Summary");
lines.push("");
lines.push("| Metric | Count |");
lines.push("|---|---|");
lines.push(`| Total unique class selectors in \`legacy.css\` | ${totalClasses} |`);
lines.push(`| REACHABLE (found in \`src/*.ts\`, \`main.ts\`, or \`scripts/*.mjs\`) | ${reachableCount} |`);
lines.push(`| UNREACHABLE — likely false-positive (producible by dynamic prefix) | ${unreachableDynamicCount} |`);
lines.push(`| UNREACHABLE — deletion candidates (no dynamic match) | ${unreachableCount} |`);
lines.push(`| Unique ID selectors | ${idSet.size} |`);
lines.push(`| Element selectors tracked (HTML/SVG) | ${elementSet.size} |`);
lines.push("");
lines.push("> REACHABLE selectors are kept. UNREACHABLE — deletion candidates are safe to remove (verify each one). UNREACHABLE — likely false-positive classes are produced by dynamic template-literal / concatenation patterns and should NOT be deleted without manual verification.");
lines.push("");

// Dynamic patterns section first (so reviewers see false-positive risks)
lines.push("## Dynamic class construction (false-positive risks)");
lines.push("");
lines.push("These source locations build class names via template literals (`prefix${var}`) or string concatenation (`\"prefix-\" + var`). Any class whose name begins with one of these prefixes is listed in the \"UNREACHABLE — likely false-positive\" table below instead of the deletion-candidates table.");
lines.push("");
lines.push("Detected dynamic prefixes:");
lines.push("");
if (dynamicPrefixes.size === 0) {
  lines.push("_None detected._");
} else {
  lines.push([...dynamicPrefixes].sort().map(p => `\`${p}<value>\``).join(", "));
}
lines.push("");
if (dynamicUnique.length === 0) {
  lines.push("_No dynamic construction sites found._");
} else {
  lines.push("### Construction sites");
  lines.push("");
  lines.push("| File | Pattern | Context |");
  lines.push("|---|---|---|");
  for (const d of dynamicUnique) {
    const ctx = d.context.replace(/\|/g, "\\|");
    lines.push(`| \`${d.file}\` | \`${d.match}\` | \`${ctx}\` |`);
  }
}
lines.push("");

// Overlap with other CSS files
lines.push("## Overlap with other \`styles/*.css\` files");
lines.push("");
lines.push("Classes that are ALSO defined (or referenced) in another stylesheet. Overlap means deleting the rule from \`legacy.css\` is safe ONLY if the other stylesheet still provides the rule; otherwise deleting will remove the styling entirely.");
lines.push("");
const overlapEntries = Object.entries(overlap).sort(([a], [b]) => a.localeCompare(b));
if (overlapEntries.length === 0) {
  lines.push("_No overlaps detected._");
} else {
  lines.push(`Total overlapping class selectors: **${overlapEntries.length}**`);
  lines.push("");
  lines.push("<details><summary>Full overlap list</summary>");
  lines.push("");
  lines.push("| Class | Other CSS files |");
  lines.push("|---|---|");
  for (const [cls, files] of overlapEntries) {
    lines.push(`| \`.${cls}\` | ${files.map(f => `\`${f}\``).join(", ")} |`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

// UNREACHABLE — deletion candidates
lines.push("## UNREACHABLE — deletion candidates");
lines.push("");
lines.push(`Total: **${unreachableCount}**`);
lines.push("");
lines.push("These classes are NOT referenced in any `.ts` / `.mjs` source AND cannot be produced by a detected dynamic prefix. They are the safest deletion candidates. Still, verify each one before deleting (a few may be set from `.md` documentation or generated DOM not covered here).");
lines.push("");
if (unreachableCount === 0) {
  lines.push("_None — every class is reachable from source._");
} else {
  lines.push("| # | Class selector | Also in other CSS? |");
  lines.push("|---|---|---|");
  let i = 1;
  for (const u of unreachable) {
    const also = (overlap[u.cls] || []).map(f => `\`${f}\``).join(", ") || "—";
    lines.push(`| ${i++} | \`.${u.cls}\` | ${also} |`);
  }
  lines.push("");
  lines.push("### Notes on deletion candidates");
  lines.push("");
  lines.push("- `.modal-title` — This is a standard Obsidian class automatically applied by the Obsidian `Modal` API to the title element. It IS used at runtime but does not appear in the project's TypeScript source. **Do NOT delete** — it styles Obsidian's built-in modal title for the plugin's modals (`file-preview-modal`, `confirm-modal`, `prompt-modal`, `file-not-found-modal`).");
  lines.push("- `.llm-bridge-nav-collapse` — The source uses `.llm-bridge-nav-collapse-btn` (the button), not the bare `.llm-bridge-nav-collapse`. Verify if the base class is needed as a container selector target.");
  lines.push("- `.llm-bridge-runtime-tab-content` — The source uses `.llm-bridge-runtime-tab-contents` (plural). This singular form appears to be a typo/leftover.");
  lines.push("- `.llm-bridge-tl-*` classes — The timeline renderer uses different, more specific class names (e.g. `.llm-bridge-tl-tool-path-inline` instead of `.llm-bridge-tl-tool-path`, `.llm-bridge-tl-completed-chips` instead of `.llm-bridge-tl-completed`). These bare forms appear to be leftovers from an earlier timeline design.");
}
lines.push("");

// UNREACHABLE — likely false-positive (dynamic)
lines.push("## UNREACHABLE — likely false-positive (dynamic)");
lines.push("");
lines.push(`Total: **${unreachableDynamicCount}**`);
lines.push("");
lines.push("These classes were NOT found as literal tokens in source, but their name begins with a detected dynamic construction prefix. They are most likely produced at runtime by template literals or string concatenation. Do NOT delete without verifying the runtime values of the interpolated variables.");
lines.push("");
if (unreachableDynamicCount === 0) {
  lines.push("_None._");
} else {
  lines.push("| # | Class selector | Dynamic prefix | Also in other CSS? |");
  lines.push("|---|---|---|---|");
  let i = 1;
  for (const u of unreachableDynamic) {
    const also = (overlap[u.cls] || []).map(f => `\`${f}\``).join(", ") || "—";
    lines.push(`| ${i++} | \`.${u.cls}\` | \`${u.dynPrefix}<value>\` | ${also} |`);
  }
}
lines.push("");

// REACHABLE summary (compact)
lines.push("## REACHABLE selectors (kept)");
lines.push("");
lines.push(`Total: **${reachableCount}**`);
lines.push("");
lines.push("<details><summary>Full reachable list with first-hit file</summary>");
lines.push("");
lines.push("| Class | First TS hit | First MJS hit |");
lines.push("|---|---|---|");
for (const r of reachable) {
  const tsHit = r.ts.length ? relative(ROOT, r.ts[0]) : "—";
  const mjsHit = r.mjs.length ? relative(ROOT, r.mjs[0]) : "—";
  lines.push(`| \`.${r.cls}\` | \`${tsHit}\` | \`${mjsHit}\` |`);
}
lines.push("");
lines.push("</details>");
lines.push("");

// ID selectors
lines.push("## ID selectors");
lines.push("");
if (idSet.size === 0) {
  lines.push("_None found in legacy.css_ (the `#` patterns detected were all color hex values).");
} else {
  lines.push("| # | ID |");
  lines.push("|---|---|");
  let i = 1;
  for (const id of [...idSet].sort()) {
    lines.push(`| ${i++} | \`#${id}\` |`);
  }
}
lines.push("");

// Element selectors
lines.push("## Element selectors observed");
lines.push("");
if (elementSet.size === 0) {
  lines.push("_None_");
} else {
  lines.push("Element selectors (HTML/SVG tags) appear in `legacy.css`. These are not class selectors and are listed for completeness only; they are not deletion candidates unless the element itself is never rendered.");
  lines.push("");
  lines.push("Elements: " + [...elementSet].sort().map(e => `\`${e}\``).join(", "));
}
lines.push("");

// Methodology
lines.push("## Methodology");
lines.push("");
lines.push("1. Parsed `styles/legacy.css` (comments stripped) and split selector groups by `,` before each `{`.");
lines.push("2. Extracted every `.classname` token into a unique set.");
lines.push("3. Searched every `.ts` file under `src/` (excluding auto-generated `src/runtime/providers/codex-app-server/schema/generated/**`) plus `main.ts`, and every `.mjs`/`.js` file under `scripts/`, for each class name with word-boundary regex `(^|[^\\w])cls([^\\w-]|$)`.");
lines.push("4. A class is **REACHABLE** if it appears as a literal token in any TS/MJS source; otherwise it is UNREACHABLE.");
lines.push("5. UNREACHABLE classes are then checked against detected dynamic construction prefixes. If the class name begins with a dynamic prefix (e.g. `is-`, `is-risk-`, `llm-bridge-status-dot-`, `llm-bridge-tl-tool-cat-`), it is moved to the **likely false-positive** table; otherwise it remains a **deletion candidate**.");
lines.push("6. Dynamic construction is detected two ways: template literals `prefix${var}` and string concatenation `\"prefix-\" + var`.");
lines.push("7. Cross-checked each class against the other stylesheets (`composer.css`, `message.css`, `run-view.css`, `secondary.css`, `shell.css`) to flag overlaps.");
lines.push("");
lines.push("> No files were modified. This report is for review only.");
lines.push("");

writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");

// Console summary
console.log("=== legacy.css audit ===");
console.log(`Lines in legacy.css: ${legacyLineCount}`);
console.log(`Total unique class selectors: ${totalClasses}`);
console.log(`REACHABLE: ${reachableCount}`);
console.log(`UNREACHABLE — deletion candidates: ${unreachableCount}`);
console.log(`UNREACHABLE — likely false-positive (dynamic): ${unreachableDynamicCount}`);
console.log(`Dynamic construction sites detected: ${dynamicUnique.length}`);
console.log(`Dynamic prefixes: ${dynamicPrefixes.size}`);
console.log(`Overlapping classes (defined in another CSS too): ${overlapEntries.length}`);
console.log(`Report written to: ${REPORT_PATH}`);
