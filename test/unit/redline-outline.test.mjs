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
