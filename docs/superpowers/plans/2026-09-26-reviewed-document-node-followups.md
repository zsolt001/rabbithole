# Reviewed-document node — deferred follow-ups

Parked polish items from the whole-branch review and re-review of
`feat/reviewed-document-node` (feature tip `1c2d0f8`, base `live`). None are
blocking; the feature shipped without them by design. Do these **after** the
manual test pass of the `rabbithole-dev` MCP server.

Status: not started. Ordered roughly by value.

## 1. Dedicated icon for the view-mode menu row

- **Where:** `src/core/html/shell.js` — the `cm-viewmode` row uses
  `iconSvg("rename")`, the same glyph as `cm-rename`.
- **Fix:** add a distinct icon to the icon set (`scripts/generate-ionicons.mjs`
  / `check:icons` gate) and reference it from the `cm-viewmode` row.
- **Cost of leaving it:** cosmetic — two menu rows share a glyph.

## 2. Cap per-block word-LCS to avoid a tab hang on a degenerate block

- **Where:** `src/core/redline/diff.js` (`diffWords`, per-`change`-block
  O(n·m) LCS), invoked from `src/core/redline/render.js` `renderRedlineHtml`.
- **Problem:** a single unbroken block near the 10MB content cap makes the
  word-level DP allocate O(words²) and can hang the tab. Realistic
  paragraph-structured prose is unaffected (blocks stay small).
- **Fix:** when either side of a `change` block exceeds a word-count threshold,
  degrade that block to a block-level delete+insert instead of word LCS. Add a
  focused unit test with an oversized block.
- **Cost of leaving it:** only a pathological/degenerate document is at risk.

## 3. Remove or use the `rh-reviewed` / `rh-redline` CSS hooks

- **Where:** classes toggled on `.doc-content` in `src/ui/core.js`
  `buildDocContent`; no rules for them in `src/design/canvas/base.css`.
- **Fix:** either drop the class toggles or give them real style/semantic use.
- **Cost of leaving it:** dead classes; harmless.

## 4. Typed visual-fence id edge case

- **Context:** flagged lowest-severity in the final whole-branch review — the
  block-id handling around typed visual fences (mermaid/chart) can mis-assign
  a fence id in an edge case that is off the prose-review path.
- **Fix:** needs a concrete repro first, then pin the id handling.
- **Cost of leaving it:** edge-of-edge; not on the reviewed-document flow.

## 5. (Optional) Skip `markDirty` on a no-op document update

- **Where:** `src/core/engine/hole-engine.js` (`dispatch` calls
  `saveChain.markDirty()` unconditionally, before the no-op guard added in
  `src/node/mcp/hole-session/broadcast.js` `updateNode`).
- **Problem:** a no-op `update_document` ticks the dirty counter with no data
  change. Pre-existing behavior, not introduced by this branch; harmless
  (nothing incorrect to persist, no schedule/flush triggered).
- **Fix (if desired):** thread the no-op signal so `markDirty` is skipped too.
- **Cost of leaving it:** a dirty-counter tick with no state change.

---

Also noted (not follow-ups, informational): the full suite has 7 pre-existing
baseline failures on `live` — an image-gen / tool-registration family
(`generate_image` / `answerBranchDescription` not registered) plus one
`custom-endpoint` network flake. None are related to this feature.
