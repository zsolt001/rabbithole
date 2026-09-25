/** @protects user-controlled canvas card sizing. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../src/ui/canvas/gestures.js", import.meta.url), "utf8");
assert.match(source, /node\.view\?\.manual_size/, "manually sized cards must render at their selected height");
assert.match(source, /manual_size: true/, "resizing must persist user sizing intent");
assert.match(source, /card\?\.offsetHeight \|\| n\.size\.h/, "the first resize must anchor to the visible card corner");

console.log("canvas resize unit contracts ok");
