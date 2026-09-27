# Reviewed-document node: in-node agent edits with redlines and an outline

- **Date:** 2026-09-26
- **Status:** Design approved, spec under review
- **Path type:** Architectural (new derived node kind, new MCP capability, new rendering paths)

## Problem

A common workflow is opening a document in a rabbithole to review it, then
asking the connected agent to change it. Today the agent edits the file on
disk with its normal file tools and answers on a branch with a summary of what
it did. The rabbithole document node never reflects that edit. The card keeps
showing the stale text the file held when the hole was opened.

Two gaps follow from this:

1. There is no way for the agent's file edit to flow back into the node, and no
   way to see what changed inside the node.
2. Review documents are usually large, and there is no in-node navigation. The
   app has no outline, table of contents, or heading parsing anywhere.

This spec closes both gaps for markdown and text documents.

## Goals

- The connected agent can push an edited document back into its node.
- The node shows the edit as redlines: insertions and deletions marked inline
  against the original text the reviewer first opened.
- The reviewer can toggle between a marked-up view, a clean current view, and
  the original text.
- The node offers an optional heading outline for navigating large documents,
  with markers on the sections that changed.
- Correcting a bad edit uses the existing branch-and-ask flow. The reviewer
  selects the redlined text, asks again, and the agent re-edits.

## Non-goals

- **Per-change accept and reject.** Edits apply directly. Branch-to-correct
  replaces an accept-reject workflow.
- **File-watching.** The update is pushed by the agent, not detected on disk.
- **Revision history, undo, or a patch stack.** Redlines are the net change
  from the original, not a timeline.
- **Editing PDF source nodes.** PDFs render as page images and are excluded
  from review editing.
- **A second card.** The reviewed document is the same card the reviewer
  opened, carrying review state. It is not a copy or a linked revision node.
- **Web-host editing.** The push tool is a local MCP capability. The browser
  app has no filesystem. Rendering of redlines and the outline is shared and
  works in both hosts and in frozen snapshots.

## Design overview

Rabbithole has no node-type enum. A card's kind is derived from its fields:
the root document is the node whose id equals the hole's `root_id`, a branch
node has an `origin` with a question, a note node has `origin.kind === "note"`,
and a PDF node has a populated `source`. This feature adds one more derived
kind, the **reviewed document**, marked by the presence of a `review` object in
the node's `extensions` bag. No node is a reviewed document until its first
agent edit creates that object.

The reviewed-document kind unlocks three behaviors on an otherwise ordinary
document node: it accepts pushed edits, it can render redlines, and it can show
an outline.

Throughout this spec, **document node** means a top-level canvas node that holds
a markdown or text document. It is a parentless node, the node at the top of a
lineage, that is neither a note nor a PDF source. A hole can hold more than one.
The original document the reviewer opened is one, identified by the hole's
`root_id`. Any independent document added to the canvas is another: a parentless
node with document content, `origin` of null, and no question. Branch, answer,
and note cards are not document nodes and are never review-editable.

**The edit target is the document at the top of the current branch's lineage,**
not always the hole's `root_id`. When the reviewer branches off the original
document, that lineage root is `root_id`. When they branch off an independent
document they added, it is that independent node. Lineage walks up `parent_id`
to the parentless node the branch sits under, and that node is what an edit
updates.

## Data model

The review state lives in the node's `extensions` bag, so no schema-version
bump is needed:

```
extensions.doc_edit = {
  baseline_markdown: string,   // pristine text captured before the first edit
  first_edit_at: string        // ISO timestamp of the first edit
}
```

**Namespace choice.** This uses `doc_edit`, not the existing `extensions.review`
namespace. That existing namespace already means something else: `review.done_at`
is a workflow marker set when the human marks an answer done, and `node_answered`
wipes `extensions.review` and `extensions.attention` through `stripNodeAttention`
in `src/core/hole/node.js`. A separate `doc_edit` namespace keeps the baseline
clear of that meaning and clear of that wipe.

**Baseline capture is lazy.** A document carries no review state until it is
first edited. When the push tool fires and the node has no `extensions.review`,
it snapshots the node's current markdown into `baseline_markdown`, then applies
the new text. Documents that are never edited carry no extra state.

**The baseline is fixed after capture.** Later edits replace the node's
markdown but never touch `baseline_markdown`. Redlines are therefore always the
net difference from the original the reviewer opened, never intermediate churn
from edits that were later overwritten.

**Correctness of the snapshot.** The agent edits the file first, then calls the
push tool. At the moment of the call the node still holds the pre-edit text, so
snapshotting the node yields the true original. This ordering is stated in the
tool description so the agent follows it.

## The push tool

A new MCP tool, added to the local host's tool set:

```
update_document({
  session_id | hole_id,   // identifies the live session or stored hole
  node_id?,               // defaults to the hole's root document
  content: string,        // the full new markdown for the node
  title?: string          // optional retitle
})
```

Behavior:

1. Resolve the target node. The agent passes the `node_id` of the document
   being reviewed, which is the parentless node at the top of the current ask's
   lineage. When `node_id` is omitted, resolve it from the ask being answered by
   walking that ask's lineage to its top-level node, falling back to `root_id`
   only when there is no ask context.
2. Reject the call if the resolved node is not a document node, meaning it is a
   PDF source, a note, or an ask that carries a question.
3. If the node has no `extensions.review`, snapshot its current markdown as
   `baseline_markdown` and set `first_edit_at`.
4. Replace the node's markdown with `content` and recompute its rendered HTML.
5. Emit a document-update event so any live view re-renders with redlines.

The agent's end-to-end loop, mostly unchanged from today:

1. Infer that the ask is an edit rather than a question.
2. Edit the file on disk with its normal file tools.
3. Call `update_document` with the new content.
4. Answer the branch with a summary of what changed.

The tool description will spell out this sequence, including that the file edit
comes before the push and the branch answer comes after, so the agent does it
reliably. It will also state that the target is the document at the top of the
current ask's lineage, which the branch request already carries, so branching
under an independent document edits that document rather than the original.

## Reducer changes

The reducer is the single choke point for node mutation. Today
`reduceNodeUpdate` in `src/core/hole/reduce.js` allows title edits on any node
but permits markdown edits only on note nodes. The contract comment records
that markdown is "human-authored note content only."

This adds one new document-update event to the `DocEvent` vocabulary in
`src/core/contracts/engine.d.ts`, handled by a dedicated reducer branch that:

- Accepts a markdown replacement on a review-eligible document node.
- Captures the baseline on first edit, as described above.
- Leaves the existing `node_update` rule untouched, so note-only editing and
  the block on branch and root markdown editing are unchanged for every other
  path.

Keeping this in its own event, rather than relaxing `reduceNodeUpdate`, means
the existing invariant stays exactly as strict as it is now for everything that
is not a pushed document edit.

## Redline rendering

**Representation: computed at render time.** Redlines are a pure function of
`baseline_markdown` and the current markdown. Nothing about individual changes
is stored. This was chosen over agent-emitted change records and over a stored
patch stack, both of which add bookkeeping that branch-to-correct makes
unnecessary.

**Algorithm: word-level diff.** The diff runs at the text level over the two
markdown strings, at word granularity, which is the standard for prose review
and reads cleanly. The repo has no diff dependency today, so this adds a small
vendored word-diff routine in `src/core/`. It emits a sequence of unchanged,
inserted, and deleted runs.

**Render integration.** The rendered output wraps inserted and deleted runs in
marked spans styled as redlines. Dispatch is a new branch in `buildDocContent`
at `src/ui/core.js:573`, sitting alongside the existing note-editor and
PDF-view branches. When the node is a reviewed document and the active view mode
is marked-up, it renders the diff; otherwise it renders the plain cached HTML as
today. The existing `node.html` cache, keyed on `node.markdown`, still serves
the clean current view.

**Diff-then-render versus render-then-diff.** The diff is computed on markdown
source and then rendered, rather than diffing already-rendered HTML. Source-level
diffing is simpler and avoids fighting the HTML structure. An implementation
detail to settle during planning is how inserted and deleted runs that span
markdown block boundaries are rendered so the marks survive the markdown-to-HTML
pass. The plan will pin this down.

## View modes and persistence

The card offers three view modes, chosen from the card header:

- **Marked-up:** the redlined view. Default immediately after an edit.
- **Clean:** the current text with no marks.
- **Original:** the `baseline_markdown` text.

The active mode persists in the node's `view` state, which is the canonical
presentation state already carried on every node. The outline toggle below
persists the same way.

## Outline sidebar

- **Optional, toggled from the card header,** and persisted in `view`. This is
  the in-node sidebar the reviewer asked for.
- **Built from headings** parsed from the document, nested by level, each
  entry scrolling the card body to its section on click.
- **Change markers.** A heading whose section contains an insertion or deletion
  gets a marker, so on a large document the reviewer can jump straight to what
  the agent touched. Change markers derive from the same word-diff runs used for
  redlines, mapped to the headings that contain them.
- **Scope for the first version:** document nodes, the original root and any
  independent document on the canvas. Because the outline needs only headings,
  it extends to long answer cards later with no data-model change.

## Host scope, persistence, and snapshots

- **Push tool: local MCP host only.** File editing happens there. The browser
  app has no filesystem and does not get `update_document`.
- **Rendering is shared.** The redline and outline code lives in `src/ui/` and
  `src/core/` and runs in both hosts.
- **Persistence.** `extensions.review` is stored in the hole JSON on the local
  host and in IndexedDB on the web host, alongside the node's current markdown.
  The baseline travels with the node, so reopening or resuming a hole preserves
  the redlined view.
- **Portable export keeps redlines.** The `.rabbithole` portable projection
  carries the full `extensions` bag unchanged, so `doc_edit.baseline_markdown`
  survives an export and re-import, and redlines render after import.
- **Frozen snapshots show clean text.** The shared HTML snapshot narrows each
  node's extensions to an allowlist in `createSnapshotProjection`, so the
  baseline is dropped and the snapshot renders the current clean document with
  no redlines. This matches how the app already treats review state as private
  and avoids embedding a second copy of the document in every share. Preserving
  redlines in shares is a deliberate non-goal for the first version; it would
  mean adding `doc_edit` to the snapshot allowlist at the cost of a doubled
  document payload.

## Edge cases

- **Push before any edit is meaningless:** the first push captures the baseline
  and is itself the first edit, so there is no empty-diff state to handle beyond
  a no-op when content equals the current text.
- **Content identical to current:** the tool applies it as a no-op and emits no
  spurious change.
- **Push targeting a non-document node:** rejected with a clear error, per the
  tool behavior above. This includes a lineage root that is a standalone note.
- **Multiple document roots in one hole:** the edit updates the lineage root of
  the ask, so an independent document and the original each keep their own
  baseline and redlines, and branching under one never edits the other.
- **Very large documents:** the word-diff runs on two strings and the outline
  parses headings once per render. Both should be checked against the largest
  realistic review document during implementation, and memoized on the markdown
  key if needed.
- **Baseline text that itself contained redline-like markup:** the diff and
  render must treat baseline content as plain document text, not as existing
  marks.

## Testing strategy

- **Reducer unit tests:** first edit captures the baseline; second edit leaves
  the baseline unchanged; the new event is rejected on PDF, note, and branch
  nodes; the existing note-editing and root-block rules are unaffected.
- **Word-diff unit tests:** insertions, deletions, replacements, no-change,
  and content spanning block boundaries.
- **Render tests:** marked-up, clean, and original modes produce the expected
  output; the view-mode choice round-trips through `view` persistence.
- **Outline tests:** headings parse and nest correctly; change markers land on
  the sections that contain diff runs.
- **Tool tests:** explicit `node_id`, resolution to the lineage root of an
  independent document, fallback to `root_id` when there is no ask context,
  retitle, non-document rejection including a standalone note, and the no-op
  path.
- **Snapshot test:** a frozen snapshot of an edited document renders the
  marked-up view from stored baseline and current text.

## Open items for planning

1. Resolved during planning: `extensions` survives persist, hydrate, and
   portable projections unchanged, so the baseline persists locally and through
   `.rabbithole` export. Frozen HTML snapshots narrow extensions to an allowlist
   and drop the baseline by design, so shares render clean text.
2. Settle how diff runs that cross markdown block boundaries are marked so the
   redlines survive the markdown-to-HTML pass.
3. Decide whether the outline renders as an in-card rail, a reader-view panel,
   or both for the first version.
