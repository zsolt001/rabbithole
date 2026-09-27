/** @protects reviewed-document redline HTML assembly and sentinel substitution. */
import assert from "node:assert/strict";
import { renderRedlineHtml } from "../../src/core/redline/render.js";
import { createMarkdownRenderer } from "../../src/core/markdown-renderer.js";

const { renderMarkdownToHtml } = createMarkdownRenderer({ encodeBase64: (s) => Buffer.from(s).toString("base64") });
const render = (md) => renderMarkdownToHtml(md);

// A one-word edit inside a paragraph marks only the changed words.
const html = renderRedlineHtml("The quick brown fox.", "The slow brown fox.", render);
assert.match(html, /<del class="rh-del">quick<\/del>/);
assert.match(html, /<ins class="rh-ins">slow<\/ins>/);
assert.match(html, /brown fox\./);
console.log("ok inline word marks");

// An added paragraph is a block insertion; a removed one a block deletion.
const blockHtml = renderRedlineHtml("Keep me.", "Keep me.\n\nBrand new.", render);
assert.match(blockHtml, /<div class="rh-ins-block"><p>Brand new\.<\/p>[\s\S]*<\/div>/);
const delHtml = renderRedlineHtml("Keep me.\n\nGone now.", "Keep me.", render);
assert.match(delHtml, /<div class="rh-del-block"><p>Gone now\.<\/p>[\s\S]*<\/div>/);
console.log("ok block marks");

// Emphasis whose whole token changes keeps its pair inside the mark.
const emph = renderRedlineHtml("This is **bold** text.", "This is **strong** text.", render);
assert.match(emph, /<del class="rh-del"><strong>bold<\/strong><\/del>/);
assert.match(emph, /<ins class="rh-ins"><strong>strong<\/strong><\/ins>/);
console.log("ok emphasis token");

// Baseline text containing raw HTML and tilde stays escaped, never a real tag or mark.
const hostile = renderRedlineHtml("Safe <script> and ~~x~~ y.", "Safe <script> and ~~x~~ z.", render);
assert.match(hostile, /&lt;script&gt;/);
assert.doesNotMatch(hostile, /<script>/);
assert.match(hostile, /<del class="rh-del">y\.<\/del>/);
assert.match(hostile, /<ins class="rh-ins">z\.<\/ins>/);
console.log("ok hostile content stays escaped");

// No sentinel control characters leak into the output.
assert.doesNotMatch(html + blockHtml + emph + hostile, /[\u0001-\u0004]/);
console.log("ok no sentinel leak");

// Raw sentinel control chars in the input are stripped, never turned into marks.
const S = String.fromCharCode(1, 2, 3, 4);
const clean = renderRedlineHtml("Clean text.", "Clean text.", render);
const injected = renderRedlineHtml("Clean text.", "Clean text." + S, render);
assert.equal(injected, clean);
assert.doesNotMatch(injected, /rh-ins|rh-del/);
console.log("ok raw sentinel chars stripped, not marked");
