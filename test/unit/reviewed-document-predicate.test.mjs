/** @protects the reviewed-document and editable-document derived-kind predicates. */
import assert from "node:assert/strict";
import { isEditableDocument, isReviewedDocument } from "../../src/core/hole/ask.js";

assert.equal(isReviewedDocument({ extensions: { doc_edit: { baseline_markdown: "x", first_edit_at: "t" } } }), true);
assert.equal(isReviewedDocument({ extensions: { review: { done_at: "t" } } }), false);
assert.equal(isReviewedDocument({ extensions: {} }), false);
assert.equal(isReviewedDocument(null), false);
console.log("ok isReviewedDocument");

assert.equal(isEditableDocument({ origin: null, extensions: {} }), true);
assert.equal(isEditableDocument({ origin: null, extensions: { doc_edit: { baseline_markdown: "x" } } }), true);
assert.equal(isEditableDocument({ origin: { kind: "note" } }), false);
assert.equal(isEditableDocument({ origin: { question: "why?" } }), false);
assert.equal(isEditableDocument({ origin: null, source: { kind: "pdf" } }), false);
assert.equal(isEditableDocument(null), false);
console.log("ok isEditableDocument");
