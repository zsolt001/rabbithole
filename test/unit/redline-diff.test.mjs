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
