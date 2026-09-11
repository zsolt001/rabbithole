/** @protects the CSS exfil-strip contract for sanitized <style> content. */
import assert from "node:assert/strict";
import test from "node:test";
import { stripStyleNetworkRefs } from "../../src/ui/visuals.js";

// DOMPurify keeps <style> tags for show/mermaid content but does not parse the
// CSS inside them, so `background: url(https://tracker/…)` or an `@import`
// becomes a passive "document opened" beacon that fires the moment a hole is
// rendered. Neutralize network-reaching url() and every @import, while keeping
// local url(#id) references that mermaid uses for markers and gradients.

test("neutralizes an external url() beacon in a declaration", () => {
  const out = stripStyleNetworkRefs(".a{background:url(https://tracker.example/b.png)}");
  assert.ok(!out.includes("tracker.example"), "external host must not survive");
  assert.match(out, /background:\s*url\(\)/i, "the url target is emptied, not the whole rule");
});

test("strips @import at-rules in both url() and bare-string forms", () => {
  assert.ok(!stripStyleNetworkRefs('@import url("https://tracker.example/x.css");').includes("tracker.example"));
  assert.ok(!stripStyleNetworkRefs("@import 'https://tracker.example/y.css';").includes("tracker.example"));
});

test("neutralizes a data: url() (inline exfil vector)", () => {
  const out = stripStyleNetworkRefs(".a{list-style-image:url(data:image/gif;base64,AAAA)}");
  assert.ok(!out.includes("data:"), "data URIs must not survive in <style>");
});

test("preserves local url(#id) fragment references", () => {
  for (const css of [".a{marker-end:url(#arrow)}", '.a{fill:url("#grad")}', ".a{mask:url( #m )}"]) {
    assert.match(stripStyleNetworkRefs(css), /url\(\s*['"]?#/, `local ref preserved: ${css}`);
  }
});

test("leaves url-free CSS untouched and tolerates non-string input", () => {
  assert.equal(stripStyleNetworkRefs(".a{color:red}"), ".a{color:red}");
  assert.equal(stripStyleNetworkRefs(null), "");
});
