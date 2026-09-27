/** @protects the reviewed-document derived-kind predicate. */
import assert from "node:assert/strict";
import { isReviewedDocument } from "../../src/core/hole/ask.js";

assert.equal(isReviewedDocument({ extensions: { doc_edit: { baseline_markdown: "x", first_edit_at: "t" } } }), true);
assert.equal(isReviewedDocument({ extensions: { review: { done_at: "t" } } }), false);
assert.equal(isReviewedDocument({ extensions: {} }), false);
assert.equal(isReviewedDocument(null), false);
console.log("ok isReviewedDocument");
