/** @protects the reviewed-document and editable-document derived-kind and reading-layout predicates. */
import assert from "node:assert/strict";
import { hasDocumentLayout, isEditableDocument, isReviewedDocument, supportsOutline } from "../../src/core/hole/ask.js";

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

assert.equal(hasDocumentLayout({ origin: null }), true, "documents read in the wide column");
assert.equal(hasDocumentLayout({ origin: { question: "why?" } }), true, "answer cards read in the wide column");
assert.equal(hasDocumentLayout({ origin: { kind: "note" } }), true, "notes read in the wide column");
assert.equal(hasDocumentLayout({ origin: null, source: { kind: "pdf" } }), false, "PDFs keep their own viewport");
assert.equal(hasDocumentLayout(null), false);
assert.equal(supportsOutline({ origin: { question: "why?" } }), true, "answer cards can show an outline");
assert.equal(supportsOutline({ origin: { kind: "note" } }), false, "notes are an editor surface, no outline");
assert.equal(supportsOutline({ origin: null, source: { kind: "pdf" } }), false);
console.log("ok hasDocumentLayout / supportsOutline");
