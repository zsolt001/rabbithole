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
