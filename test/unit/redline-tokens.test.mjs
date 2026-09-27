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
