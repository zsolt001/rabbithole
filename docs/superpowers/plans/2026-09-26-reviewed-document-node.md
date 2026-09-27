# Reviewed-Document Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the connected agent push an edited document back into its rabbithole node, shown as word-level redlines against the text the reviewer opened, with an optional heading outline for navigating large documents.

**Architecture:** A new derived node kind — the *reviewed document* — is marked by an `extensions.doc_edit` object holding the pristine baseline. A new core event `node_document_update` replaces a document node's markdown (capturing the baseline on the first edit) without the ask-settling, `read`-flipping, `stripNodeAttention` semantics of `node_answered`. A new local-host MCP tool `update_document` resolves the edit target to the parentless lineage root of the passed node and dispatches that event on the live session or the stored hole. Redlines are computed at render time by a pure core library (block-aligned, word-level diff → HTML via a sentinel-substitution pass that survives the markdown renderer's raw-HTML escaping) and mounted in `buildDocContent`. The outline is a CSS-positioned rail built from the rendered headings, with change markers from a pure core diff. View mode and outline visibility persist in the node's `view` (canvas namespace).

**Delivery order:** Tasks 1–4 build the pure diff/outline libraries (no runtime wiring). Tasks 5–9 build the push pipeline; after Task 9 the feature already works end to end, showing the pushed edit as updated (clean) text. Tasks 10–12 layer redline rendering, the view-mode/outline controls, and styling on top. Each task ends at an independently testable deliverable.

**Tech Stack:** Vanilla JS ES modules (no framework, no third-party canvas or diff library), `marked` v15 for markdown, `node:test` for unit/contract tiers, Playwright for e2e (`test/support/web-app-harness.mjs`), Biome + custom `scripts/check-*.mjs` gates, plain CSS validated by lightningcss with tokens enforced by `scripts/check-design.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-26-reviewed-document-node-design.md`

## Global Constraints

- **No new runtime dependencies.** The word diff is a small vendored routine in `src/core/`; the repo has no diff library and adds none.
- **Core stays markdown-only and isomorphic.** `src/core/` stores markdown, never HTML, and must run in both Node and browser. HTML is produced by injecting the shared `renderMarkdownToHtml` into pure functions, never by importing a UI renderer into core.
- **The markdown renderer escapes raw HTML.** `html({ text }) { return escapeHtml(text); }` in `src/core/markdown-renderer.js` means `<ins>`/`<del>` written into markdown render as visible escaped text. Redline marks must be produced by the sentinel-substitution pass in `renderRedlineHtml`, never injected into markdown as tags. `escapeHtml` (`src/core/utils.js`) rewrites only `& < > " '`, so the control-character sentinels (``–``) pass through untouched.
- **`extensions.doc_edit`, not `extensions.review`.** `extensions.review.done_at` is the existing workflow "done" marker and `stripNodeAttention` (`src/core/hole/node.js`) deletes `review` and `attention` on every `node_answered`. The baseline lives under `doc_edit`, which survives that wipe.
- **Do not settle the ask or flip workflow status when a document is edited.** The document node (root or independent) is not the ask being answered. Use the dedicated `node_document_update` event, not `node_answered` (which sets `status:"answered"`, `read:false`, and settles asks) and not `node_update` (which ignores markdown on non-note nodes — `reduceNodeUpdate`, `src/core/hole/reduce.js:376`).
- **Push tool is local host only.** The browser/web host has no filesystem and does not get `update_document`. Rendering (redlines, outline) is shared and runs in both hosts.
- **CSS uses existing tokens only.** `scripts/check-design.mjs` fails on color literals outside `tokens.css`, on unused token definitions, and on unresolved token uses. Redline/outline styling reuses `--success-strong`, `--danger`, `--accent`, `--border`, `--fg-faint`, `--card-bg` via `color-mix`; it defines no new tokens.
- **`.rh-` class prefix** for new UI/redline classes, matching the existing convention (`.rh-pdf`, `.rh-check`, …).

## Review Focus

These are inputs the spec implies but no single feature description dwells on. Each has its test added to the owning task.

- **Content identical to current markdown** — the tool/reducer must no-op: no baseline capture, no state change, no spurious re-render. (Task 6.)
- **Push targeting a non-document node** (branch/answer with a question, a note, a PDF source) — must be rejected with a clear error, including when a passed node's lineage root is itself a standalone note. (Tasks 6 and 7.)
- **A second, third, … edit** — the baseline is captured once and never overwritten; redlines always measure from the first-opened text, not intermediate churn. (Task 6.)
- **A document whose baseline text contains `~~`, `*`, `#`, or `<`** — the diff and render treat baseline content as plain document text; marks are control-char sentinels substituted after rendering, so document markup is not confused with marks and raw `<` stays escaped. (Task 3.)
- **A one-word edit inside an emphasis/link span** — word runs are whole whitespace-delimited tokens, so a changed `**bold**` token keeps its `**` pair inside one mark; the rare case of an edit splitting one side of an inline delimiter is a documented v1 limitation that degrades to slightly imperfect emphasis around the edit, never a crash or unescaped HTML. (Task 3.)

---

### Task 1: Word/block tokenizer (pure core)

**Files:**
- Create: `src/core/redline/tokens.js`
- Test: `test/unit/redline-tokens.test.mjs`

**Interfaces:**
- Produces:
  - `tokenizeWords(text: string): string[]` — splits into alternating whitespace and non-whitespace runs; `tokenizeWords(t).join("") === t` for any string.
  - `splitBlocks(markdown: string): string[]` — top-level blocks separated by one or more blank lines, with fenced code blocks (```` ``` ````/`~~~`) kept intact even when they contain blank lines. Each returned block is trimmed of surrounding blank lines; the return excludes empty blocks.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/redline-tokens.test.mjs
/** @protects redline word/block tokenization used by the reviewed-document diff. */
import assert from "node:assert/strict";
import { tokenizeWords, splitBlocks } from "../../src/core/redline/tokens.js";

// tokenizeWords is lossless and alternates whitespace / non-whitespace.
assert.deepEqual(tokenizeWords("the quick  fox"), ["the", " ", "quick", "  ", "fox"]);
assert.equal(tokenizeWords("  lead and trail  ").join(""), "  lead and trail  ");
assert.deepEqual(tokenizeWords(""), []);
console.log("ok tokenizeWords");

// splitBlocks separates on blank lines.
assert.deepEqual(splitBlocks("# Title\n\nFirst para.\n\nSecond para."), ["# Title", "First para.", "Second para."]);
// A fenced code block with an internal blank line stays one block.
assert.deepEqual(
  splitBlocks("Intro.\n\n```\ncode line 1\n\ncode line 2\n```\n\nOutro."),
  ["Intro.", "```\ncode line 1\n\ncode line 2\n```", "Outro."],
);
// Leading/trailing blank lines produce no empty blocks.
assert.deepEqual(splitBlocks("\n\nonly\n\n"), ["only"]);
console.log("ok splitBlocks");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/redline-tokens.test.mjs`
Expected: FAIL — `Cannot find module '.../src/core/redline/tokens.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/core/redline/tokens.js

/** Split text into a lossless alternating stream of whitespace and non-whitespace runs. @param {string} text @returns {string[]} */
export function tokenizeWords(text) {
  return String(text ?? "").match(/\s+|\S+/g) || [];
}

const FENCE = /^(\s*)(`{3,}|~{3,})/;

/** Split markdown into top-level blocks on blank lines, keeping fenced code blocks whole. @param {string} markdown @returns {string[]} */
export function splitBlocks(markdown) {
  const lines = String(markdown ?? "").split("\n");
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  let current = [];
  let fenceMarker = null;
  const flush = () => {
    const text = current.join("\n").replace(/^\n+|\n+$/g, "").trim();
    if (text) blocks.push(text);
    current = [];
  };
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fenceMarker) {
      current.push(line);
      if (fence && line.trim().startsWith(fenceMarker)) fenceMarker = null;
      continue;
    }
    if (fence) {
      fenceMarker = fence[2];
      current.push(line);
      continue;
    }
    if (line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return blocks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/redline-tokens.test.mjs`
Expected: PASS — `ok tokenizeWords`, `ok splitBlocks`.

- [ ] **Step 5: Commit**

```bash
git add src/core/redline/tokens.js test/unit/redline-tokens.test.mjs
git commit -m "feat: add word/block tokenizer for reviewed-document redlines"
```

---

### Task 2: Word and block diff (pure core)

**Files:**
- Create: `src/core/redline/diff.js`
- Test: `test/unit/redline-diff.test.mjs`

**Interfaces:**
- Consumes: `tokenizeWords`, `splitBlocks` from `src/core/redline/tokens.js`.
- Produces:
  - `diffTokens(before: string[], after: string[]): Array<{ type: "equal"|"insert"|"delete", tokens: string[] }>` — LCS-based; consecutive same-type runs are merged.
  - `diffWords(before: string, after: string): Array<{ type: "equal"|"insert"|"delete", text: string }>` — `diffTokens` over `tokenizeWords`, each run's tokens joined to text.
  - `diffBlocks(beforeBlocks: string[], afterBlocks: string[]): Array<{ type: "equal"|"insert"|"delete"|"change", before?: string, after?: string }>` — block-level LCS by exact string equality; unmatched blocks between two anchors are paired positionally into `change` (both sides present), `delete` (before only), or `insert` (after only). `equal`/`change`/`insert` carry `after`; `delete`/`change` carry `before`.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/redline-diff.test.mjs
/** @protects the word and block diff powering reviewed-document redlines. */
import assert from "node:assert/strict";
import { diffTokens, diffWords, diffBlocks } from "../../src/core/redline/diff.js";

// Word diff: middle word replaced.
assert.deepEqual(diffWords("the quick fox", "the slow fox"), [
  { type: "equal", text: "the " },
  { type: "delete", text: "quick" },
  { type: "insert", text: "slow" },
  { type: "equal", text: " fox" },
]);
// Pure insertion and pure deletion.
assert.deepEqual(diffWords("a c", "a b c"), [
  { type: "equal", text: "a " },
  { type: "insert", text: "b " },
  { type: "equal", text: "c" },
]);
assert.deepEqual(diffWords("same", "same"), [{ type: "equal", text: "same" }]);
console.log("ok diffWords");

// diffTokens merges consecutive runs of the same type.
assert.deepEqual(diffTokens(["x"], ["y", " ", "z"]), [
  { type: "delete", tokens: ["x"] },
  { type: "insert", tokens: ["y", " ", "z"] },
]);
console.log("ok diffTokens");

// Block diff: one edited paragraph in place becomes a change (for inline diff),
// an added paragraph an insert, a removed one a delete.
assert.deepEqual(
  diffBlocks(["# H", "old para", "tail"], ["# H", "new para", "added", "tail"]),
  [
    { type: "equal", after: "# H" },
    { type: "change", before: "old para", after: "new para" },
    { type: "insert", after: "added" },
    { type: "equal", after: "tail" },
  ],
);
console.log("ok diffBlocks");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/redline-diff.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/core/redline/diff.js
import { tokenizeWords } from "./tokens.js";

/** Longest-common-subsequence indices over two arrays compared by ===. */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  /** @type {Array<[number, number]>} */
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** @param {string[]} before @param {string[]} after */
export function diffTokens(before, after) {
  const pairs = lcs(before, after);
  /** @type {Array<{ type: "equal"|"insert"|"delete", tokens: string[] }>} */
  const runs = [];
  const push = (type, token) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.tokens.push(token);
    else runs.push({ type, tokens: [token] });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    while (i < pi) push("delete", before[i++]);
    while (j < pj) push("insert", after[j++]);
    push("equal", after[j]);
    i++; j++;
  }
  while (i < before.length) push("delete", before[i++]);
  while (j < after.length) push("insert", after[j++]);
  return runs;
}

/** @param {string} before @param {string} after */
export function diffWords(before, after) {
  return diffTokens(tokenizeWords(before), tokenizeWords(after))
    .map((run) => ({ type: run.type, text: run.tokens.join("") }));
}

/** @param {string[]} beforeBlocks @param {string[]} afterBlocks */
export function diffBlocks(beforeBlocks, afterBlocks) {
  const pairs = lcs(beforeBlocks, afterBlocks);
  /** @type {Array<{ type: "equal"|"insert"|"delete"|"change", before?: string, after?: string }>} */
  const ops = [];
  const emitGap = (bStart, bEnd, aStart, aEnd) => {
    const bGap = beforeBlocks.slice(bStart, bEnd);
    const aGap = afterBlocks.slice(aStart, aEnd);
    const count = Math.max(bGap.length, aGap.length);
    for (let k = 0; k < count; k++) {
      const b = bGap[k];
      const a = aGap[k];
      if (b !== undefined && a !== undefined) ops.push({ type: "change", before: b, after: a });
      else if (a !== undefined) ops.push({ type: "insert", after: a });
      else ops.push({ type: "delete", before: b });
    }
  };
  let bi = 0;
  let ai = 0;
  for (const [pb, pa] of pairs) {
    emitGap(bi, pb, ai, pa);
    ops.push({ type: "equal", after: afterBlocks[pa] });
    bi = pb + 1;
    ai = pa + 1;
  }
  emitGap(bi, beforeBlocks.length, ai, afterBlocks.length);
  return ops;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/redline-diff.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redline/diff.js test/unit/redline-diff.test.mjs
git commit -m "feat: add word and block diff for reviewed-document redlines"
```

---

### Task 3: Redline HTML renderer (pure core)

**Files:**
- Create: `src/core/redline/render.js`
- Test: `test/unit/redline-render.test.mjs`

**Interfaces:**
- Consumes: `splitBlocks` (Task 1), `diffBlocks`/`diffWords` (Task 2).
- Produces: `renderRedlineHtml(baseline: string, current: string, renderMarkdown: (markdown: string) => string): string` — returns HTML where inserted word runs are wrapped in `<ins class="rh-ins">…</ins>`, deleted runs in `<del class="rh-del">…</del>`, wholly-added blocks in `<div class="rh-ins-block">…</div>`, and wholly-removed blocks in `<div class="rh-del-block">…</div>`. `renderMarkdown` is the injected shared markdown→HTML function so this module stays UI-free and testable.

Marks are emitted as control-character sentinels (``–``) into the markdown handed to `renderMarkdown`, then substituted for real tags after rendering. Because `escapeHtml` never touches control characters, the sentinels survive the render, and because they wrap whole whitespace-delimited tokens, inline markdown pairs stay balanced inside a single mark.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/redline-render.test.mjs
/** @protects reviewed-document redline HTML assembly and sentinel substitution. */
import assert from "node:assert/strict";
import { renderRedlineHtml } from "../../src/core/redline/render.js";
import { createMarkdownRenderer } from "../../src/core/markdown-renderer.js";

const { renderMarkdownToHtml } = createMarkdownRenderer({ encodeBase64: (s) => Buffer.from(s).toString("base64") });
const render = (md) => renderMarkdownToHtml(md);

// A one-word edit inside a paragraph marks only the changed words.
const html = renderRedlineHtml("The quick brown fox.", "The slow brown fox.", render);
assert.match(html, /<del class="rh-del">quick<\/del>/);
assert.match(html, /<ins class="rh-ins">slow<\/ins>/);
assert.match(html, /brown fox\./);
console.log("ok inline word marks");

// An added paragraph is a block insertion; a removed one a block deletion.
const blockHtml = renderRedlineHtml("Keep me.", "Keep me.\n\nBrand new.", render);
assert.match(blockHtml, /<div class="rh-ins-block"><p>Brand new\.<\/p>[\s\S]*<\/div>/);
const delHtml = renderRedlineHtml("Keep me.\n\nGone now.", "Keep me.", render);
assert.match(delHtml, /<div class="rh-del-block"><p>Gone now\.<\/p>[\s\S]*<\/div>/);
console.log("ok block marks");

// Emphasis whose whole token changes keeps its pair inside the mark.
const emph = renderRedlineHtml("This is **bold** text.", "This is **strong** text.", render);
assert.match(emph, /<del class="rh-del"><strong>bold<\/strong><\/del>/);
assert.match(emph, /<ins class="rh-ins"><strong>strong<\/strong><\/ins>/);
console.log("ok emphasis token");

// Baseline text containing raw HTML and tilde stays escaped, never a real tag or mark.
const hostile = renderRedlineHtml("Safe <script> and ~~x~~ y.", "Safe <script> and ~~x~~ z.", render);
assert.match(hostile, /&lt;script&gt;/);
assert.doesNotMatch(hostile, /<script>/);
assert.match(hostile, /<del class="rh-del">y\.<\/del>/);
assert.match(hostile, /<ins class="rh-ins">z\.<\/ins>/);
console.log("ok hostile content stays escaped");

// No sentinel control characters leak into the output.
assert.doesNotMatch(html + blockHtml + emph + hostile, /[]/);
console.log("ok no sentinel leak");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/redline-render.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/core/redline/render.js
import { splitBlocks } from "./tokens.js";
import { diffBlocks, diffWords } from "./diff.js";

const INS_OPEN = "";
const INS_CLOSE = "";
const DEL_OPEN = "";
const DEL_CLOSE = "";

/**
 * Render word-level redlines of `current` against `baseline` to HTML.
 * @param {string} baseline @param {string} current @param {(markdown: string) => string} renderMarkdown
 * @returns {string}
 */
export function renderRedlineHtml(baseline, current, renderMarkdown) {
  const ops = diffBlocks(splitBlocks(baseline), splitBlocks(current));
  let html = "";
  for (const op of ops) {
    if (op.type === "equal") html += renderMarkdown(op.after);
    else if (op.type === "insert") html += `<div class="rh-ins-block">${renderMarkdown(op.after)}</div>`;
    else if (op.type === "delete") html += `<div class="rh-del-block">${renderMarkdown(op.before)}</div>`;
    else html += renderMarkdown(wrapWordRuns(op.before, op.after));
  }
  return substituteSentinels(html);
}

/** @param {string} before @param {string} after */
function wrapWordRuns(before, after) {
  let out = "";
  for (const run of diffWords(before, after)) {
    if (run.type === "insert") out += INS_OPEN + run.text + INS_CLOSE;
    else if (run.type === "delete") out += DEL_OPEN + run.text + DEL_CLOSE;
    else out += run.text;
  }
  return out;
}

/** @param {string} html */
function substituteSentinels(html) {
  return html
    .split(INS_OPEN).join('<ins class="rh-ins">')
    .split(INS_CLOSE).join("</ins>")
    .split(DEL_OPEN).join('<del class="rh-del">')
    .split(DEL_CLOSE).join("</del>");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/redline-render.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redline/render.js test/unit/redline-render.test.mjs
git commit -m "feat: render reviewed-document redlines via sentinel substitution"
```

---

### Task 4: Outline change detection (pure core)

**Files:**
- Create: `src/core/redline/outline.js`
- Test: `test/unit/redline-outline.test.mjs`

**Interfaces:**
- Consumes: `splitBlocks` is not needed here; parse headings directly.
- Produces:
  - `buildOutline(markdown: string): Array<{ level: number, text: string, index: number }>` — ATX headings in document order, `index` the 0-based ordinal among headings, skipping fenced code.
  - `changedSectionHeadings(baseline: string, current: string): Set<string>` — normalized texts of current-side headings that are new or whose section body (heading line through the next heading) differs from the matching baseline section. `baseline` empty/absent yields an empty set.

The UI (Task 12) builds the clickable rail from the rendered DOM headings and marks an entry when its normalized text is in this set, so DOM scroll targets never depend on this parser.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/redline-outline.test.mjs
/** @protects outline parsing and change detection for reviewed documents. */
import assert from "node:assert/strict";
import { buildOutline, changedSectionHeadings } from "../../src/core/redline/outline.js";

assert.deepEqual(buildOutline("# A\n\ntext\n\n## B\n\n```\n# not a heading\n```\n\n### C"), [
  { level: 1, text: "A", index: 0 },
  { level: 2, text: "B", index: 1 },
  { level: 3, text: "C", index: 2 },
]);
console.log("ok buildOutline");

const baseline = "# Intro\n\nHello world.\n\n## Details\n\nUnchanged body.";
const current = "# Intro\n\nHello brave world.\n\n## Details\n\nUnchanged body.";
assert.deepEqual([...changedSectionHeadings(baseline, current)], ["intro"]);

const added = "# Intro\n\nHello world.\n\n## Details\n\nUnchanged body.\n\n## Extra\n\nNew section.";
assert.deepEqual([...changedSectionHeadings(baseline, added)], ["extra"]);

assert.equal(changedSectionHeadings("", current).size, 0);
console.log("ok changedSectionHeadings");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/redline-outline.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/core/redline/outline.js

const FENCE = /^(\s*)(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

/** @param {string} markdown @returns {Array<{ level: number, text: string, index: number }>} */
export function buildOutline(markdown) {
  const out = [];
  let inFence = false;
  let index = 0;
  for (const line of String(markdown ?? "").split("\n")) {
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), index: index++ });
  }
  return out;
}

/** @param {string} text */
function normalizeHeading(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split markdown into { heading -> section body } by ATX heading lines. @param {string} markdown */
function sectionsByHeading(markdown) {
  /** @type {Map<string, string>} */
  const sections = new Map();
  let key = null;
  let body = [];
  let inFence = false;
  const flush = () => { if (key !== null) sections.set(key, body.join("\n").trim()); };
  for (const line of String(markdown ?? "").split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (m) { flush(); key = normalizeHeading(m[2]); body = []; }
    else if (key !== null) body.push(line);
  }
  flush();
  return sections;
}

/** @param {string} baseline @param {string} current @returns {Set<string>} */
export function changedSectionHeadings(baseline, current) {
  /** @type {Set<string>} */
  const changed = new Set();
  if (!String(baseline ?? "").trim()) return changed;
  const before = sectionsByHeading(baseline);
  const after = sectionsByHeading(current);
  for (const [key, body] of after) {
    if (!before.has(key) || before.get(key) !== body) changed.add(key);
  }
  return changed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/redline-outline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redline/outline.js test/unit/redline-outline.test.mjs
git commit -m "feat: add outline parsing and change detection for reviewed documents"
```

---

### Task 5: Document-update event contract + reviewed-document predicate

**Files:**
- Modify: `src/core/contracts/engine.d.ts:142-178` (add event interface, union member, effect field)
- Modify: `src/core/hole/ask.js` (add `isReviewedDocument` predicate near `isNoteNode`)
- Test: `test/unit/reviewed-document-predicate.test.mjs`

**Interfaces:**
- Produces:
  - Type `NodeDocumentUpdateEvent { type: "node_document_update"; node_id; content?; title? }` and its inclusion in `DocEvent`.
  - `ReduceEffects.updatedNode?: HoleNode`.
  - `isReviewedDocument(node): boolean` — true iff `node.extensions?.doc_edit` is present. Used by the UI (view-mode controls, redline branch) and read-only elsewhere.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/reviewed-document-predicate.test.mjs
/** @protects the reviewed-document derived-kind predicate. */
import assert from "node:assert/strict";
import { isReviewedDocument } from "../../src/core/hole/ask.js";

assert.equal(isReviewedDocument({ extensions: { doc_edit: { baseline_markdown: "x", first_edit_at: "t" } } }), true);
assert.equal(isReviewedDocument({ extensions: { review: { done_at: "t" } } }), false);
assert.equal(isReviewedDocument({ extensions: {} }), false);
assert.equal(isReviewedDocument(null), false);
console.log("ok isReviewedDocument");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/reviewed-document-predicate.test.mjs`
Expected: FAIL — `isReviewedDocument is not a function`.

- [ ] **Step 3: Add the predicate and the contract**

In `src/core/hole/ask.js`, add next to the other predicates:

```js
/** @param {Record<string, any> | null | undefined} node */
export function isReviewedDocument(node) {
  return !!node?.extensions?.doc_edit;
}
```

In `src/core/contracts/engine.d.ts`, after `NodeUpdateEvent` (line 147) add:

```ts
export interface NodeDocumentUpdateEvent extends NodeTarget {
  type: "node_document_update";
  /** The full replacement markdown for the target document node. */
  content?: unknown;
  title?: unknown;
}
```

Extend the union (line 166-168) to include `NodeDocumentUpdateEvent`:

```ts
export type DocEvent = BranchRequestEvent | NodeCreateEvent | NodeProgressEvent | NodeAnsweredEvent |
  DeleteNodeEvent | NodeUpdateEvent | NodeDocumentUpdateEvent | NodesUpdateEvent | ViewStateEvent |
  HoleTitleEvent | NodeOriginEvent | NodeExtensionsPatchEvent | BlockStateEvent;
```

Add the effect field to `ReduceEffects` (line 170-176):

```ts
export interface ReduceEffects {
  node_id?: string;
  createdNode?: HoleNode;
  answeredNode?: HoleNode;
  updatedNode?: HoleNode;
  deletedNodeIds?: string[];
  deletedNodes?: HoleNode[];
}
```

- [ ] **Step 4: Run tests and the type check**

Run: `node --test test/unit/reviewed-document-predicate.test.mjs`
Expected: PASS.
Run: `node scripts/check-types.mjs`
Expected: PASS — no new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/hole/ask.js src/core/contracts/engine.d.ts test/unit/reviewed-document-predicate.test.mjs
git commit -m "feat: add node_document_update contract and reviewed-document predicate"
```

---

### Task 6: `reduceNodeDocumentUpdate` (core reducer)

**Files:**
- Modify: `src/core/hole/reduce.js:37-68` (switch), and add the reducer function near `reduceNodeUpdate:376`
- Test: `test/unit/reducer-document-update.test.mjs`

**Interfaces:**
- Consumes: `isNoteNode` (already imported in `reduce.js`), `normalizeBlockIds`, `cloneNodes`, `withState`.
- Produces: handling for `case "node_document_update"` returning `withState(nextState, { updatedNode })`. Captures `extensions.doc_edit = { baseline_markdown, first_edit_at }` on the first edit only; replaces markdown; optional retitle; rejects notes, PDF sources, and question-bearing (branch/answer) nodes; no-ops when content equals current markdown; never settles asks, never flips `status`/`read`, never runs `stripNodeAttention`.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/reducer-document-update.test.mjs
/** @protects the node_document_update reducer: baseline capture, guards, no-op, and no ask settling. */
import assert from "node:assert/strict";
import { createHoleState, reduceHoleEvent } from "../../src/core/hole/reduce.js";

function baseHole(extra = []) {
  return createHoleState({
    hole_id: "h", title: "H", root_id: "root", created_at: "2026-01-01T00:00:00.000Z",
    nodes: [
      { id: "root", parent_id: null, title: "Doc", markdown: "# Title\n\nOriginal body.", origin: null, status: "answered", created_at: "2026-01-01T00:00:00.000Z" },
      ...extra,
    ],
  });
}
const OPTS = { now: "2026-02-02T00:00:00.000Z" };

// First edit captures the baseline and replaces markdown.
let r = reduceHoleEvent(baseHole(), { type: "node_document_update", node_id: "root", content: "# Title\n\nEdited body." }, OPTS);
let root = r.state.nodes.get("root");
assert.equal(root.markdown, "# Title\n\nEdited body.");
assert.equal(root.extensions.doc_edit.baseline_markdown, "# Title\n\nOriginal body.");
assert.equal(root.extensions.doc_edit.first_edit_at, "2026-02-02T00:00:00.000Z");
assert.equal(root.status, "answered");
assert.equal(root.read, false);
assert.equal(r.effects.updatedNode.id, "root");
console.log("ok first edit captures baseline");

// Second edit keeps the original baseline.
let r2 = reduceHoleEvent(r.state, { type: "node_document_update", node_id: "root", content: "# Title\n\nEdited twice." }, { now: "2026-03-03T00:00:00.000Z" });
let root2 = r2.state.nodes.get("root");
assert.equal(root2.markdown, "# Title\n\nEdited twice.");
assert.equal(root2.extensions.doc_edit.baseline_markdown, "# Title\n\nOriginal body.");
assert.equal(root2.extensions.doc_edit.first_edit_at, "2026-02-02T00:00:00.000Z");
console.log("ok second edit keeps baseline");

// Identical content is a no-op: no doc_edit created, state unchanged.
let noop = reduceHoleEvent(baseHole(), { type: "node_document_update", node_id: "root", content: "# Title\n\nOriginal body." }, OPTS);
assert.equal(noop.state.nodes.get("root").extensions.doc_edit, undefined);
console.log("ok identical content no-op");

// Reject a note node.
const noteHole = baseHole([{ id: "n1", parent_id: "root", title: "Note", markdown: "note", origin: { kind: "note", author: "human" }, status: "answered", created_at: "2026-01-01T00:00:00.000Z" }]);
assert.throws(() => reduceHoleEvent(noteHole, { type: "node_document_update", node_id: "n1", content: "x" }, OPTS), /not a document node/i);
console.log("ok rejects note");

// Reject a branch/answer node (has a question origin).
const askHole = baseHole([{ id: "b1", parent_id: "root", title: "Ask", markdown: "answer", origin: { question: "why?", selected_text: "", branch_type: "followup" }, status: "answered", created_at: "2026-01-01T00:00:00.000Z" }]);
assert.throws(() => reduceHoleEvent(askHole, { type: "node_document_update", node_id: "b1", content: "x" }, OPTS), /not a document node/i);
console.log("ok rejects answer branch");

// Reject a PDF source node.
const pdfHole = baseHole([{ id: "p1", parent_id: null, title: "PDF", markdown: "pages", origin: null, source: { pages: 3 }, status: "answered", created_at: "2026-01-01T00:00:00.000Z" }]);
assert.throws(() => reduceHoleEvent(pdfHole, { type: "node_document_update", node_id: "p1", content: "x" }, OPTS), /not a document node/i);
console.log("ok rejects pdf source");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/reducer-document-update.test.mjs`
Expected: FAIL — `Unsupported hole event: node_document_update`.

- [ ] **Step 3: Add the switch case and the reducer**

In the `reduceHoleEvent` switch (`src/core/hole/reduce.js`), add after the `node_update` case (line 52):

```js
    case "node_document_update":
      return reduceNodeDocumentUpdate(state, /** @type {import("../contracts/engine.js").NodeDocumentUpdateEvent} */ (event), options);
```

Add the function after `reduceNodeUpdate` (after line 388):

```js
/** @param {HoleState} state @param {import("../contracts/engine.js").NodeDocumentUpdateEvent} event @param {ReduceOptions} options */
function reduceNodeDocumentUpdate(state, event, options) {
  const nodeId = String(event.node_id || "");
  const node = state.nodes.get(nodeId);
  if (!node) return withState(state);
  const hasQuestion = !!(node.origin && typeof node.origin === "object" && node.origin.question);
  if (isNoteNode(node) || node.source || hasQuestion) {
    throw new Error(`Node ${nodeId} is not a document node and cannot be edited`);
  }
  const content = normalizeBlockIds(String(event.content ?? ""), { idFactory: options.idFactory }).markdown;
  const title = typeof event.title === "string" && event.title.trim() ? event.title.trim() : null;
  if (content === node.markdown && !title) return withState(state, { updatedNode: node });
  const next = { ...node };
  if (!node.extensions?.doc_edit) {
    next.extensions = {
      ...(node.extensions || {}),
      doc_edit: { baseline_markdown: node.markdown, first_edit_at: options.now ?? new Date().toISOString() },
    };
  }
  next.markdown = content;
  if (title) next.title = title;
  const nodes = cloneNodes(state, options);
  nodes.set(nodeId, /** @type {HoleNode} */ (next));
  return withState({ ...state, nodes }, { updatedNode: /** @type {HoleNode} */ (next) });
}
```

- [ ] **Step 4: Run tests and the golden/reducer suite**

Run: `node --test test/unit/reducer-document-update.test.mjs`
Expected: PASS — all `ok …` lines.
Run: `node --test test/unit/reducer.test.mjs`
Expected: PASS — the existing reducer corpus is unaffected (new event, existing rules untouched).

- [ ] **Step 5: Commit**

```bash
git add src/core/hole/reduce.js test/unit/reducer-document-update.test.mjs
git commit -m "feat: reduce node_document_update with lazy baseline capture and guards"
```

---

### Task 7: `updateDocument` MCP implementation, session method, and SSE builder

**Files:**
- Modify: `src/core/hole-host.js:85-94` (add `buildNodeDocumentUpdateEvent` next to `buildNodeAnsweredEvent`)
- Modify: `src/node/mcp/hole-session/broadcast.js:187-194` (add `updateNode`)
- Modify: `src/node/mcp/open.js` (add `updateDocument`, import `lineageNodesFromMap`)
- Test: `test/contracts/mcp-update-document.test.mjs`

**Interfaces:**
- Consumes: `getSession`, `getSessionByHole` (registry), `defaultFsStore`, `createHoleState`, `holeStateToHole`, `reduceHoleEvent`, `lineageNodesFromMap` (`src/core/hole/tree.js`), `projectNode`.
- Produces:
  - `buildNodeDocumentUpdateEvent(node: HoleNode): { type: "node_document_update", node_id: string, markdown: string, extensions: object }` — the SSE payload the browser applies (Task 9). Distinct from the reducer event (which carries `content`).
  - `SessionBroadcast.updateNode(event): Promise<HoleNode>` — dispatches the reducer event, saves, broadcasts `buildNodeDocumentUpdateEvent(effects.updatedNode)`, returns the node.
  - `updateDocument({ sessionId?, holeId?, nodeId?, content, title? }): Promise<{ status, hole_id, node_id, ... }>` — resolves the edit target to `lineageNodesFromMap(nodes, nodeId)[0].id` (the parentless lineage root) when `nodeId` is given, else the hole's `root_id`; dispatches on the live session (`updateNode`) or the stored hole (reduce + save).

Re-exported automatically by `src/node/rabbithole.js` (`export * from "./mcp/open.js"`).

- [ ] **Step 1: Write the failing test**

```js
// test/contracts/mcp-update-document.test.mjs
/** @protects the update_document MCP capability: target resolution, baseline, and rejection. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.RABBITHOLE_NO_BROWSER = "1";
process.env.RABBITHOLE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-update-doc-"));

const { sendToRabbithole, updateDocument } = await import("../../src/node/rabbithole.js");
const { defaultFsStore } = await import("../../src/node/fs-store.js");

// Seed a stored hole with a root document and an independent document.
async function seed() {
  const holeId = "hole-update-doc";
  await defaultFsStore.saveHole({
    hole_id: holeId, title: "H", root_id: "root", created_at: "2026-01-01T00:00:00.000Z", view_state: null,
    nodes: [
      { id: "root", parent_id: null, title: "Root", markdown: "# Root\n\nOriginal.", origin: null, position: { x: 0, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: true, created_at: "2026-01-01T00:00:00.000Z", extensions: {} },
      { id: "indep", parent_id: null, title: "Indep", markdown: "# Indep\n\nStandalone.", origin: null, position: { x: 500, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: true, created_at: "2026-01-01T00:00:00.000Z", extensions: {} },
      { id: "note1", parent_id: "root", title: "Note", markdown: "margin", origin: { kind: "note", author: "human" }, position: { x: 0, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: true, created_at: "2026-01-01T00:00:00.000Z", extensions: {} },
    ],
  });
  return holeId;
}

// Explicit node_id updates the root and captures its baseline.
let holeId = await seed();
await updateDocument({ holeId, nodeId: "root", content: "# Root\n\nEdited." });
let hole = await defaultFsStore.loadHole(holeId);
let root = hole.nodes.find((n) => n.id === "root");
assert.equal(root.markdown, "# Root\n\nEdited.");
assert.equal(root.extensions.doc_edit.baseline_markdown, "# Root\n\nOriginal.");
console.log("ok stored root update captures baseline");

// A branch node id resolves up its lineage to the parentless root.
holeId = await seed();
await updateDocument({ holeId, nodeId: "note1", content: "ignored" }).then(
  () => assert.fail("editing a note's lineage should reject on the note itself"),
  (err) => assert.match(String(err.message), /not a document node/i),
);
console.log("ok note lineage rejected");

// Independent document keeps its own baseline; root untouched.
holeId = await seed();
await updateDocument({ holeId, nodeId: "indep", content: "# Indep\n\nRevised." });
hole = await defaultFsStore.loadHole(holeId);
assert.equal(hole.nodes.find((n) => n.id === "indep").extensions.doc_edit.baseline_markdown, "# Indep\n\nStandalone.");
assert.equal(hole.nodes.find((n) => n.id === "root").extensions.doc_edit, undefined);
console.log("ok independent document isolated");

// Omitted node_id falls back to root_id.
holeId = await seed();
await updateDocument({ holeId, content: "# Root\n\nFallback edit." });
hole = await defaultFsStore.loadHole(holeId);
assert.equal(hole.nodes.find((n) => n.id === "root").markdown, "# Root\n\nFallback edit.");
console.log("ok fallback to root_id");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contracts/mcp-update-document.test.mjs`
Expected: FAIL — `updateDocument` is not exported.

- [ ] **Step 3: Implement the builder, session method, and impl**

In `src/core/hole-host.js`, after `buildNodeAnsweredEvent` (line 94), add:

```js
/** @param {import("./contracts/engine.js").HoleNode} node */
export function buildNodeDocumentUpdateEvent(node) {
  const projected = projectNode(node, "wire");
  return {
    type: "node_document_update",
    node_id: projected.id,
    markdown: projected.markdown,
    extensions: projected.extensions,
  };
}
```

In `src/node/mcp/hole-session/broadcast.js`, after `publishNode` (line 194), add (and import `buildNodeDocumentUpdateEvent` from `../../../core/hole-host.js` alongside the existing `buildNodeAnsweredEvent` import):

```js
  /** Replace a document node's markdown in place and re-render every connected canvas. */
  async updateNode(event) {
    const effects = this.dispatchHoleEvent(event, { now: new Date().toISOString() });
    const node = effects.updatedNode;
    this.scheduleSave();
    await this.flushSave();
    this.broadcast(buildNodeDocumentUpdateEvent(node));
    return node;
  }
```

In `src/node/mcp/open.js`, add `lineageNodesFromMap` to the `../../core/hole/tree.js` import and add the impl (mirroring `sendToRabbithole`'s live/stored split, `sendToRabbithole` at line 314):

```js
/**
 * Push an edited document back into its node. Resolves the edit target to the
 * parentless lineage root of `nodeId` (falling back to root_id), then dispatches
 * a node_document_update on the live session or the stored hole.
 */
export async function updateDocument({ sessionId, holeId, nodeId, content, title }) {
  sessionId = normalizeId(sessionId);
  holeId = normalizeId(holeId);
  nodeId = nodeId == null ? undefined : normalizeId(nodeId);
  if (!String(content ?? "").trim()) throw new Error("content is required");

  const session = sessionId ? getSession(sessionId) : getSessionByHole(holeId);
  if (session && !session.isClosed()) {
    const targetId = resolveDocumentTarget(session.nodes, nodeId, session.rootId);
    if (!session.nodes.has(targetId)) throw new Error(`Node ${targetId} not found.`);
    const node = await session.updateNode({ type: "node_document_update", node_id: targetId, content, title });
    return { status: session.sseClients.size > 0 ? "delivered" : "stored", hole_id: session.holeId, node_id: node.id };
  }

  if (!holeId) throw new Error("hole_id is required when no live session is open");
  const hole = await defaultFsStore.loadHole(holeId);
  if (!hole) throw new Error(`Hole ${holeId} not found.`);
  const state = createHoleState(/** @type {any} */ (hole), { cloneExtensions: false });
  const targetId = resolveDocumentTarget(state.nodes, nodeId, hole.root_id);
  if (!state.nodes.has(targetId)) throw new Error(`Node ${targetId} not found.`);
  const reduced = reduceHoleEvent(state, { type: "node_document_update", node_id: targetId, content, title }, { now: new Date().toISOString(), mutate: true });
  await defaultFsStore.saveHole(holeStateToHole(reduced.state));
  return { status: "stored", hole_id: holeId, node_id: targetId };
}

/** @param {Map<string, any>} nodes @param {string | undefined} nodeId @param {string} rootId */
function resolveDocumentTarget(nodes, nodeId, rootId) {
  if (!nodeId) return String(rootId);
  const lineage = lineageNodesFromMap(nodes, nodeId);
  return lineage.length ? lineage[0].id : nodeId;
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/contracts/mcp-update-document.test.mjs`
Expected: PASS — all `ok …` lines.

- [ ] **Step 5: Commit**

```bash
git add src/core/hole-host.js src/node/mcp/hole-session/broadcast.js src/node/mcp/open.js test/contracts/mcp-update-document.test.mjs
git commit -m "feat: add updateDocument MCP impl, session updateNode, and SSE builder"
```

---

### Task 8: `update_document` tool definition

**Files:**
- Modify: `src/node/mcp/tools.js` (import `updateDocument`, add the tool object to `toolDefinitions`, add `validateUpdate`)
- Test: `test/contracts/mcp-update-document.test.mjs` (extend with a tool-shape assertion)

**Interfaces:**
- Consumes: `updateDocument` (Task 7), `normalizeId`, `z`.
- Produces: a `toolDefinitions` entry named `update_document`. It is auto-registered by the `for (const tool of toolDefinitions)` loop in `src/node/mcp/main.js:36`.

- [ ] **Step 1: Write the failing test (append to the Task 7 test file)**

```js
// appended to test/contracts/mcp-update-document.test.mjs
const { toolDefinitions } = await import("../../src/node/mcp/tools.js");
const tool = toolDefinitions.find((t) => t.name === "update_document");
assert.ok(tool, "update_document tool is registered");
assert.ok(tool.input.content && tool.input.hole_id && tool.input.node_id, "declares content, hole_id, node_id");
assert.throws(() => tool.validateInput({ hole_id: "h", content: "   " }), /content is required/);
assert.throws(() => tool.validateInput({ content: "x" }), /session_id or hole_id/);
console.log("ok update_document tool shape");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contracts/mcp-update-document.test.mjs`
Expected: FAIL — `update_document tool is registered` assertion fails.

- [ ] **Step 3: Add the tool definition**

In `src/node/mcp/tools.js`, add `updateDocument` to the `./open.js` import, add the validator near `validatePublish` (line 53):

```js
function validateUpdate(params) {
  if (!normalizeId(params.session_id) && !normalizeId(params.hole_id)) throw new Error("session_id or hole_id is required");
  if (!String(params.content || "").trim()) throw new Error("content is required");
}
```

and add this object to the `toolDefinitions` array (near `send_to_rabbithole`, line 225):

```js
    {
      name: "update_document",
      description:
        "Push an edited document back into its Rabbithole node, shown as redlines against the text the reviewer opened. " +
        "Use it for review edits: (1) edit the file on disk with your normal tools; (2) call update_document with node_id set to the document being reviewed and content set to the full new markdown; (3) answer the branch with a summary. " +
        "The edit lands on the document at the top of that node's lineage, so branching under an independent document edits that document, not the original. Do not call this for a note, a PDF, or an answer branch.",
      input: {
        session_id: z.string().max(200).describe("Active session ID from open_rabbithole; use this or hole_id").optional(),
        hole_id: z.string().max(200).describe("Saved Rabbithole id; use this or session_id").optional(),
        node_id: z.string().max(200).describe("The document node being reviewed; resolves to its lineage root. Omit to target the root document").optional(),
        content: z.string().max(10485760).describe("The full new markdown for the document"),
        title: z.string().max(2000).describe("Optional new title").optional(),
      },
      validateInput: validateUpdate,
      run: ({ session_id, hole_id, node_id, content, title }) => updateDocument({
        sessionId: normalizeId(session_id),
        holeId: normalizeId(hole_id),
        nodeId: node_id == null ? undefined : normalizeId(node_id),
        content,
        title,
      }),
    },
```

- [ ] **Step 4: Run the test**

Run: `node --test test/contracts/mcp-update-document.test.mjs`
Expected: PASS — including `ok update_document tool shape`.

- [ ] **Step 5: Commit**

```bash
git add src/node/mcp/tools.js test/contracts/mcp-update-document.test.mjs
git commit -m "feat: register update_document MCP tool"
```

---

### Task 9: Browser applies `node_document_update`

**Files:**
- Modify: `src/ui/store/apply-server-event.js:3-11` (add event to `DOCUMENT_EVENTS`) and `:37-101` (add handler branch)
- Modify: `src/ui/transport-status.js:526-550` (add re-render branch)
- Test: `test/unit/apply-server-event-document-update.test.mjs`

**Interfaces:**
- Consumes: the SSE event `{ type: "node_document_update", node_id, markdown, extensions }` from Task 7.
- Produces: on `node_document_update`, the store node's `markdown` and `extensions` are replaced and `"document"` is invalidated; `status`/`read`/`origin` are left untouched. `transport-status.js` re-renders the card body and reader on that invalidation.

`applyServerEvent(store, message)` is a pure store function and is unit-tested directly; the `transport-status.js` wiring is exercised by the Task 10 e2e test.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/apply-server-event-document-update.test.mjs
/** @protects browser application of node_document_update: markdown + extensions, no status flip. */
import assert from "node:assert/strict";
import { applyServerEvent } from "../../src/ui/store/apply-server-event.js";

const node = { id: "root", markdown: "old", status: "answered", read: true, origin: null, extensions: {} };
const store = { nodes: { root: node }, register() {} };

const result = applyServerEvent(store, {
  type: "node_document_update",
  node_id: "root",
  markdown: "# New\n\nBody.",
  extensions: { doc_edit: { baseline_markdown: "old", first_edit_at: "t" } },
});

assert.equal(result.handled, true);
assert.equal(node.markdown, "# New\n\nBody.");
assert.equal(node.extensions.doc_edit.baseline_markdown, "old");
assert.equal(node.status, "answered");
assert.equal(node.read, true);
assert.equal(result.invalidated.has("document"), true);
console.log("ok node_document_update applied");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/apply-server-event-document-update.test.mjs`
Expected: FAIL — `handled` is false (event not in `DOCUMENT_EVENTS`).

- [ ] **Step 3: Implement**

In `src/ui/store/apply-server-event.js`, add `"node_document_update"` to the `DOCUMENT_EVENTS` set (line 3-11). Add a handler branch after the `node_answered` branch (after line 50):

```js
  } else if (type === "node_document_update") {
    node.markdown = message.markdown || "";
    if (message.extensions && typeof message.extensions === "object" && !Array.isArray(message.extensions)) {
      node.extensions = message.extensions;
    }
    invalidated.add("document");
```

In `src/ui/transport-status.js`, add a branch alongside the other `result.type` cases (after the `node_progress` branch, around line 526):

```js
    } else if (result.type === "node_document_update") {
      refreshNodeHtml(node);
      if (node.bodyEl) fillBody(node);
      if (mode === "reader" && currentNodeId === node.id) renderReaderBody();
      scheduleEdges();
```

- [ ] **Step 4: Run the test and UI checks**

Run: `node --test test/unit/apply-server-event-document-update.test.mjs`
Expected: PASS.
Run: `node --run test -- --tier unit` (or `node test/run.mjs --tier unit`) to confirm `check:ui` (Biome) and `check:ui-architecture` still pass.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/apply-server-event.js src/ui/transport-status.js test/unit/apply-server-event-document-update.test.mjs
git commit -m "feat: apply node_document_update in the browser store and re-render"
```

---

### Task 10: Redline rendering in the card body + styling

**Files:**
- Modify: `src/ui/renderer.js:62-73` (add `ensureRedlineHtml`, `ensureBaselineHtml`)
- Modify: `src/ui/core.js:573-635` (`buildDocContent` reviewed-document branch), and expose the two renderer functions through `coreHooks` (see `defaultCoreHooks` / `configureCoreHooks` around line 95-109)
- Modify: `src/design/canvas/base.css` (add redline mark styles near the `.doc-content` mark block, line 122)
- Test: `test/e2e/reviewed-document-redline.test.mjs`

**Interfaces:**
- Consumes: `renderRedlineHtml` (Task 3), `isReviewedDocument` (Task 5), `renderMarkdownToHtml` (renderer).
- Produces:
  - `ensureRedlineHtml(node): string` — cached on `node._redlineFor` keyed by `baseline markdown`; empty string when the node has no baseline.
  - `ensureBaselineHtml(node): string` — the baseline rendered clean, cached on `node._baselineFor`.
  - `buildDocContent`: for a reviewed document (not a PDF), the mounted HTML is chosen by `node.view?.reviewMode` — `"marked"` (default) → redline HTML, `"original"` → baseline HTML, `"clean"` → `node.html`.

This test drives a **live node-host session** (not the web host), the same seam `verifyFreshAnswerInvalidation` in `test/e2e/auto-tidy.test.mjs` uses: seed a session with `createSession`, navigate the browser to `session.url`, then push the edit server-side with `session.updateNode(...)` (added in Task 7) and let the browser re-render over SSE. This exercises `updateNode` → `buildNodeDocumentUpdateEvent` → the browser `applyServerEvent` (Task 9) → the redline render branch in one pass. There is no `applyServerEvent` browser hook; do not invent one. The browser test seam that does exist is `window.__rabbitholeTest`.

- [ ] **Step 1: Write the failing e2e test**

```js
// test/e2e/reviewed-document-redline.test.mjs
/** @protects the reviewed-document redline surface end to end over a live session. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-redline-e2e-"));
const previousDir = process.env.RABBITHOLE_DIR;
const previousNoBrowser = process.env.RABBITHOLE_NO_BROWSER;
process.env.RABBITHOLE_DIR = storeDir;
process.env.RABBITHOLE_NO_BROWSER = "1";
let session = null;
let context = null;
try {
  const [{ createSession }, { buildCanvasHtml }] = await Promise.all([
    import("../../src/node/sessions.js"),
    import("../../src/node/html/canvas.js"),
  ]);
  session = await createSession({
    holeId: "redline-e2e", title: "Redline", rootId: "root",
    viewState: { mode: "canvas", node_id: "root", scroll: 0 }, isResume: true,
    nodes: [{
      id: "root", parent_id: null, title: "Report", markdown: "# Report\n\nThe quick brown fox.",
      origin: null, position: { x: 0, y: 0 }, size: { w: 420, h: 460 }, status: "answered", extensions: {},
    }],
    assetNames: new Set(), renderPage: (hydration) => buildCanvasHtml(hydration),
  });
  context = await app.browser.newContext();
  const page = await context.newPage();
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card.root .doc-content");

  // The agent push: replace the document markdown on the live session.
  await session.updateNode({ type: "node_document_update", node_id: "root", content: "# Report\n\nThe slow brown fox." });

  const del = page.locator(".card.root .doc-content del.rh-del");
  const ins = page.locator(".card.root .doc-content ins.rh-ins");
  await del.first().waitFor();
  assert.equal(await del.first().innerText(), "quick");
  assert.equal(await ins.first().innerText(), "slow");
  console.log("ok redline marks render in the card");
} finally {
  if (context) await context.close();
  if (session) await session.close("redline_test_complete");
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR; else process.env.RABBITHOLE_DIR = previousDir;
  if (previousNoBrowser === undefined) delete process.env.RABBITHOLE_NO_BROWSER; else process.env.RABBITHOLE_NO_BROWSER = previousNoBrowser;
  await app.close();
  await fs.rm(storeDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/run.mjs --tier e2e --files reviewed-document-redline`
Expected: FAIL — no `del.rh-del` element (redline branch not implemented).

- [ ] **Step 3: Implement renderer helpers and the render branch**

In `src/ui/renderer.js`, add:

```js
import { renderRedlineHtml } from "../core/redline/render.js";

export function ensureBaselineHtml(node) {
  const baseline = node && node.extensions && node.extensions.doc_edit && node.extensions.doc_edit.baseline_markdown;
  if (typeof baseline !== "string") return "";
  if (node._baselineFor === baseline) return node._baselineHtml;
  node._baselineHtml = renderMarkdownToHtml(baseline, { baseUrl: node.base_url || null, assetNames });
  node._baselineFor = baseline;
  return node._baselineHtml;
}

export function ensureRedlineHtml(node) {
  const baseline = node && node.extensions && node.extensions.doc_edit && node.extensions.doc_edit.baseline_markdown;
  if (typeof baseline !== "string") return "";
  const key = baseline + " " + (node.markdown || "");
  if (node._redlineFor === key) return node._redlineHtml;
  node._redlineHtml = renderRedlineHtml(baseline, node.markdown || "", (md) =>
    renderMarkdownToHtml(md, { baseUrl: node.base_url || null, assetNames }));
  node._redlineFor = key;
  return node._redlineHtml;
}
```

Expose both through `coreHooks` in `src/ui/core.js` (add `ensureRedlineHtml` and `ensureBaselineHtml` to the hook object built by `defaultCoreHooks`, populated from `renderer.js` wherever `ensureNodeHtml` is wired). In `buildDocContent`, replace the plain `dc.innerHTML = node.html || ""` default (line 621) with a reviewed-document aware choice:

```js
      const reviewed = isReviewedDocument(node);
      if (reviewed) {
        const mode = (node.view && node.view.reviewMode) || "marked";
        dc.classList.add("rh-reviewed");
        dc.classList.toggle("rh-redline", mode === "marked");
        dc.innerHTML = mode === "marked" ? coreHooks.ensureRedlineHtml(node)
          : mode === "original" ? coreHooks.ensureBaselineHtml(node)
          : (node.html || "");
      } else {
        dc.innerHTML = node.html || "";
      }
      const pdfExt = node.source;
```

(Add `import { isReviewedDocument } from "../core/hole/ask.js";` to `core.js`.)

- [ ] **Step 4: Add redline styles**

In `src/design/canvas/base.css`, after the `.doc-content` mark rules (around line 142), add:

```css
.doc-content ins.rh-ins { text-decoration: none; background: color-mix(in srgb, var(--success-strong) 16%, transparent); box-shadow: inset 0 -0.08em color-mix(in srgb, var(--success-strong) 55%, transparent); border-radius: 2px; }
.doc-content del.rh-del { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--danger) 70%, transparent); color: color-mix(in srgb, var(--danger) 80%, var(--fg)); background: color-mix(in srgb, var(--danger) 10%, transparent); border-radius: 2px; }
.doc-content .rh-ins-block { border-left: 3px solid color-mix(in srgb, var(--success-strong) 60%, transparent); padding-left: 0.6em; }
.doc-content .rh-del-block { border-left: 3px solid color-mix(in srgb, var(--danger) 60%, transparent); padding-left: 0.6em; opacity: 0.75; }
```

- [ ] **Step 5: Run the e2e test and design checks**

Run: `node test/run.mjs --tier e2e --files reviewed-document-redline`
Expected: PASS — `ok redline marks render in the card`.
Run: `node scripts/check-css-integrity.mjs && node scripts/check-design.mjs`
Expected: PASS — no color literals, no unused/unresolved tokens.

- [ ] **Step 6: Commit**

```bash
git add src/ui/renderer.js src/ui/core.js src/design/canvas/base.css test/e2e/reviewed-document-redline.test.mjs
git commit -m "feat: render reviewed-document redlines in the card body"
```

---

### Task 11: View-mode and outline controls in the card menu

**Files:**
- Modify: `src/core/html/shell.js:127-137` (add `cm-viewmode` and `cm-outline` menu rows)
- Modify: `src/ui/canvas/menu.js` (show/hide + labels in `openCardMenu`, dispatch in `onCardMenuClick`)
- Test: `test/e2e/reviewed-document-controls.test.mjs`

**Interfaces:**
- Consumes: `isReviewedDocument` (Task 5), `persistCanvasExtension` (`src/ui/canvas/pins.js`), `fillBody` (`src/ui/canvas/document.js`).
- Produces: two menu rows, shown only for reviewed documents. `cm-viewmode` cycles `node.view.reviewMode` through `marked → clean → original → marked` and re-renders; `cm-outline` toggles `node.view.outline` and re-renders. Both persist via `persistCanvasExtension(node)` (canvas namespace), which round-trips through `reduceNodeExtensionsPatch` and the `canvas → view` hydration mapping.

Same live-session seam as Task 10. The first assertion (`ok view-mode cycles to clean`) passes at the end of this task; the outline assertion (`ok outline toggles on`) stays red until Task 12 builds the rail. Keep both; re-run after Task 12.

- [ ] **Step 1: Write the failing e2e test**

```js
// test/e2e/reviewed-document-controls.test.mjs
/** @protects reviewed-document view-mode and outline menu controls end to end. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-controls-e2e-"));
const previousDir = process.env.RABBITHOLE_DIR;
const previousNoBrowser = process.env.RABBITHOLE_NO_BROWSER;
process.env.RABBITHOLE_DIR = storeDir;
process.env.RABBITHOLE_NO_BROWSER = "1";
let session = null;
let context = null;
try {
  const [{ createSession }, { buildCanvasHtml }] = await Promise.all([
    import("../../src/node/sessions.js"),
    import("../../src/node/html/canvas.js"),
  ]);
  session = await createSession({
    holeId: "controls-e2e", title: "Controls", rootId: "root",
    viewState: { mode: "canvas", node_id: "root", scroll: 0 }, isResume: true,
    nodes: [{
      id: "root", parent_id: null, title: "Report", markdown: "# Report\n\nThe quick brown fox.\n\n## Details\n\nMore.",
      origin: null, position: { x: 0, y: 0 }, size: { w: 480, h: 520 }, status: "answered", extensions: {},
    }],
    assetNames: new Set(), renderPage: (hydration) => buildCanvasHtml(hydration),
  });
  context = await app.browser.newContext();
  const page = await context.newPage();
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card.root .doc-content");
  await session.updateNode({ type: "node_document_update", node_id: "root", content: "# Report\n\nThe slow brown fox.\n\n## Details\n\nMore." });

  // Default view is marked-up.
  await page.locator(".card.root .doc-content del.rh-del").first().waitFor();

  // Cycle the view mode to clean via the card menu: marks disappear.
  await page.locator(".card.root .card-more").click();
  await page.locator("#cm-viewmode").click();
  await page.waitForFunction(() => document.querySelectorAll(".card.root .doc-content del.rh-del").length === 0);
  console.log("ok view-mode cycles to clean");

  // Toggle the outline on: the rail appears with an entry per heading.
  await page.locator(".card.root .card-more").click();
  await page.locator("#cm-outline").click();
  await page.locator(".card.root .doc-content .rh-outline .rh-outline-item").first().waitFor();
  assert.ok(await page.locator(".card.root .doc-content .rh-outline .rh-outline-item").count() >= 2);
  console.log("ok outline toggles on");
} finally {
  if (context) await context.close();
  if (session) await session.close("controls_test_complete");
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR; else process.env.RABBITHOLE_DIR = previousDir;
  if (previousNoBrowser === undefined) delete process.env.RABBITHOLE_NO_BROWSER; else process.env.RABBITHOLE_NO_BROWSER = previousNoBrowser;
  await app.close();
  await fs.rm(storeDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/run.mjs --tier e2e --files reviewed-document-controls`
Expected: FAIL — `#cm-viewmode` not found. (The `.rh-outline` assertion also fails until Task 12; that is expected — this task's steps make the first `ok` pass, Task 12 makes the second pass. Keep both assertions; re-run after Task 12.)

- [ ] **Step 3: Add the menu rows**

In `src/core/html/shell.js`, after the `cm-copy` row (line 128), add:

```js
  ${buttonMarkup({ bare: true, className: "sm-item", id: "cm-viewmode", role: "menuitem", tabIndex: -1, label: "Marked-up", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("rename") + '</span>' })}
  ${buttonMarkup({ bare: true, className: "sm-item", id: "cm-outline", role: "menuitem", tabIndex: -1, label: "Show outline", labelClass: "sm-label", svgIconHtml: '<span class="sm-ic">' + iconSvg("trail") + '</span>' })}
```

- [ ] **Step 4: Wire show/hide and dispatch**

In `src/ui/canvas/menu.js`, import `isReviewedDocument` from `../../core/hole/ask.js`, `persistCanvasExtension` from `./pins.js`, and `fillBody` from `./document.js`. In `openCardMenu`, after the `cm-done` handling (line 88), add:

```js
  const reviewed = isReviewedDocument(node);
  const viewModeButton = document.getElementById("cm-viewmode");
  const outlineButton = document.getElementById("cm-outline");
  viewModeButton.style.display = reviewed ? "" : "none";
  outlineButton.style.display = reviewed ? "" : "none";
  if (reviewed) {
    const mode = (node.view && node.view.reviewMode) || "marked";
    viewModeButton.querySelector(".sm-label").textContent =
      mode === "marked" ? "Marked-up" : mode === "clean" ? "Clean" : "Original";
    outlineButton.querySelector(".sm-label").textContent =
      node.view && node.view.outline ? "Hide outline" : "Show outline";
  }
```

In `onCardMenuClick`, after `r.cardMenuController.close();` (line 114), add before the `if (button.id === "cm-copy")` chain:

```js
  if (button.id === "cm-viewmode") { cycleReviewMode(node); return; }
  if (button.id === "cm-outline") { toggleOutline(node); return; }
```

and add the helpers at the bottom of the module:

```js
const REVIEW_MODES = ["marked", "clean", "original"];

function cycleReviewMode(node) {
  const mode = (node.view && node.view.reviewMode) || "marked";
  const next = REVIEW_MODES[(REVIEW_MODES.indexOf(mode) + 1) % REVIEW_MODES.length];
  node.view = { ...(node.view || {}), reviewMode: next };
  if (!frozen) persistCanvasExtension(node);
  if (node.bodyEl) fillBody(node);
}

function toggleOutline(node) {
  const on = !(node.view && node.view.outline);
  node.view = { ...(node.view || {}), outline: on };
  if (!frozen) persistCanvasExtension(node);
  if (node.bodyEl) fillBody(node);
}
```

- [ ] **Step 5: Run the first assertion and UI checks**

Run: `node test/run.mjs --tier e2e --files reviewed-document-controls`
Expected: `ok view-mode cycles to clean` passes; the outline assertion still fails (Task 12).
Run: `node test/run.mjs --tier unit` (Biome + `check:ui-architecture` gates).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/html/shell.js src/ui/canvas/menu.js test/e2e/reviewed-document-controls.test.mjs
git commit -m "feat: add reviewed-document view-mode and outline menu controls"
```

---

### Task 12: Outline rail with change markers

**Files:**
- Create: `src/ui/canvas/outline-rail.js`
- Modify: `src/ui/core.js` (`buildDocContent`: prepend the rail for reviewed documents when `node.view.outline`)
- Modify: `src/design/canvas/base.css` (add `.rh-outline` styles)
- Test: `test/e2e/reviewed-document-controls.test.mjs` (the outline assertion from Task 11 now passes)

**Interfaces:**
- Consumes: `changedSectionHeadings` (Task 4), the rendered `.doc-content` DOM.
- Produces: `buildOutlineRail(dc: HTMLElement, node): HTMLElement | null` — builds a `<nav class="rh-outline">` from the rendered headings in `dc` (`h1`–`h6` in document order); each entry is a button that scrolls its heading into view; entries whose normalized heading text is in `changedSectionHeadings(baseline, current)` get a `.rh-outline-changed` marker. Returns null when there are fewer than two headings.

- [ ] **Step 1: The failing assertion already exists** (the `.rh-outline .rh-outline-item` count in `test/e2e/reviewed-document-controls.test.mjs`, written in Task 11).

Run: `node test/run.mjs --tier e2e --files reviewed-document-controls`
Expected: FAIL on the outline assertion.

- [ ] **Step 2: Implement the rail**

```js
// src/ui/canvas/outline-rail.js
import { changedSectionHeadings } from "../../core/redline/outline.js";

function normalizeHeading(text) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** @param {HTMLElement} dc @param {any} node @returns {HTMLElement | null} */
export function buildOutlineRail(dc, node) {
  const headings = Array.from(dc.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter((el) => !el.closest(".rh-outline"));
  if (headings.length < 2) return null;
  const baseline = node.extensions && node.extensions.doc_edit && node.extensions.doc_edit.baseline_markdown;
  const changed = typeof baseline === "string" ? changedSectionHeadings(baseline, node.markdown || "") : new Set();

  const nav = document.createElement("nav");
  nav.className = "rh-outline";
  nav.setAttribute("aria-label", "Document outline");
  for (const heading of headings) {
    const key = normalizeHeading(heading.textContent);
    const item = document.createElement("a");
    item.className = "rh-outline-item rh-outline-l" + heading.tagName.slice(1);
    if (changed.has(key)) item.classList.add("rh-outline-changed");
    item.textContent = heading.textContent || "";
    item.href = "#";
    item.addEventListener("click", (e) => {
      e.preventDefault();
      heading.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    nav.appendChild(item);
  }
  return nav;
}
```

In `src/ui/core.js` `buildDocContent`, after `mountDocMedia(dc, node, base)` in the reviewed-document path, before `return dc`, add:

```js
      if (isReviewedDocument(node) && node.view && node.view.outline) {
        const rail = coreHooks.buildOutlineRail ? coreHooks.buildOutlineRail(dc, node) : null;
        if (rail) { dc.classList.add("rh-has-outline"); dc.prepend(rail); }
      }
```

Wire `buildOutlineRail` into `coreHooks` (same place `ensureRedlineHtml` was added in Task 10), importing it from `./canvas/outline-rail.js` at the host wiring layer.

- [ ] **Step 3: Add outline styles**

In `src/design/canvas/base.css`, add:

```css
.doc-content.rh-has-outline { padding-left: 12.5em; position: relative; }
.rh-outline { position: absolute; left: 0; top: 0; width: 11em; max-height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 0.15em; border-right: 1px solid var(--border); padding-right: 0.6em; }
.rh-outline-item { display: block; color: var(--fg-faint); text-decoration: none; font-size: inherit; line-height: 1.3; padding: 0.15em 0; border-radius: 3px; }
.rh-outline-item:hover, .rh-outline-item:focus-visible { color: var(--fg); outline: none; }
.rh-outline-l2 { padding-left: 0.8em; }
.rh-outline-l3 { padding-left: 1.6em; }
.rh-outline-l4, .rh-outline-l5, .rh-outline-l6 { padding-left: 2.4em; }
.rh-outline-changed::after { content: ""; display: inline-block; width: 0.4em; height: 0.4em; margin-left: 0.35em; border-radius: 50%; background: color-mix(in srgb, var(--accent) 80%, transparent); }
```

- [ ] **Step 4: Run the full control test and checks**

Run: `node test/run.mjs --tier e2e --files reviewed-document-controls`
Expected: PASS — both `ok view-mode cycles to clean` and `ok outline toggles on`.
Run: `node scripts/check-css-integrity.mjs && node scripts/check-design.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/canvas/outline-rail.js src/ui/core.js src/design/canvas/base.css
git commit -m "feat: add reviewed-document outline rail with change markers"
```

---

## Notes carried from the spec

- **Snapshots show clean text by design.** `joinLegacyExtensions` (`src/core/hole/node.js:200-204`) narrows the snapshot projection to `pdf`/`note`/`canvas`/`attention`/`review`, so `doc_edit` is dropped from a frozen `.html` snapshot and it renders the current clean document. No task changes this; the spec lists preserving redlines in shares as a v1 non-goal.
- **Portable export keeps redlines.** The `.rabbithole` portable projection carries the full `extensions` bag (`doc_edit` included), so redlines render after re-import with no extra work.
- **Documented v1 limitations** (see Review Focus): an edit that splits one side of an inline emphasis/link delimiter within a paired block may render slightly imperfect emphasis around that edit; positional block pairing can mispair when a block is inserted immediately before an edited one. Both degrade gracefully (never a crash, never unescaped HTML) and are correctable by the reviewer via branch-and-ask.
