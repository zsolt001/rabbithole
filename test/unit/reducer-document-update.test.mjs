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
assert.equal(noop.state.nodes.get("root").extensions?.doc_edit, undefined);
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
