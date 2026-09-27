/** @protects the update_document MCP capability: target resolution, baseline, and rejection. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.RABBITHOLE_NO_BROWSER = "1";
process.env.RABBITHOLE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-update-doc-"));

const { sendToRabbithole, updateDocument } = await import("../../src/node/rabbithole.js");
const { defaultFsStore } = await import("../../src/node/fs-store.js");

// Seed a stored hole with a root document and an independent document.
async function seed() {
  const holeId = "hole-update-doc";
  await defaultFsStore.saveHole({
    hole_id: holeId, title: "H", root_id: "root", created_at: "2026-01-01T00:00:00.000Z", view_state: null,
    nodes: [
      { id: "root", parent_id: null, title: "Root", markdown: "# Root\n\nOriginal.", origin: null, position: { x: 0, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: true, created_at: "2026-01-01T00:00:00.000Z", extensions: {} },
      { id: "indep", parent_id: null, title: "Indep", markdown: "# Indep\n\nStandalone.", origin: null, position: { x: 500, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: true, created_at: "2026-01-01T00:00:00.000Z", extensions: {} },
      { id: "note1", parent_id: "root", title: "Note", markdown: "margin", origin: { kind: "note", author: "human" }, position: { x: 0, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: true, created_at: "2026-01-01T00:00:00.000Z", extensions: {} },
    ],
  });
  return holeId;
}

// Explicit node_id updates the root and captures its baseline.
let holeId = await seed();
await updateDocument({ holeId, nodeId: "root", content: "# Root\n\nEdited." });
let hole = await defaultFsStore.loadHole(holeId);
let root = hole.nodes.find((n) => n.id === "root");
assert.equal(root.markdown, "# Root\n\nEdited.");
assert.equal(root.extensions.doc_edit.baseline_markdown, "# Root\n\nOriginal.");
console.log("ok stored root update captures baseline");

// A branch node id resolves up its lineage to the parentless root.
holeId = await seed();
await updateDocument({ holeId, nodeId: "note1", content: "ignored" }).then(
  () => assert.fail("editing a note's lineage should reject on the note itself"),
  (err) => assert.match(String(err.message), /not a document node/i),
);
console.log("ok note lineage rejected");

// Independent document keeps its own baseline; root untouched.
holeId = await seed();
await updateDocument({ holeId, nodeId: "indep", content: "# Indep\n\nRevised." });
hole = await defaultFsStore.loadHole(holeId);
assert.equal(hole.nodes.find((n) => n.id === "indep").extensions.doc_edit.baseline_markdown, "# Indep\n\nStandalone.");
assert.equal(hole.nodes.find((n) => n.id === "root").extensions.doc_edit, undefined);
console.log("ok independent document isolated");

// Omitted node_id falls back to root_id.
holeId = await seed();
await updateDocument({ holeId, content: "# Root\n\nFallback edit." });
hole = await defaultFsStore.loadHole(holeId);
assert.equal(hole.nodes.find((n) => n.id === "root").markdown, "# Root\n\nFallback edit.");
console.log("ok fallback to root_id");

// Tool shape assertion
const { toolDefinitions } = await import("../../src/node/mcp/tools.js");
const tool = toolDefinitions.find((t) => t.name === "update_document");
assert.ok(tool, "update_document tool is registered");
assert.ok(tool.input.content && tool.input.hole_id && tool.input.node_id, "declares content, hole_id, node_id");
assert.throws(() => tool.validateInput({ hole_id: "h", content: "   " }), /content is required/);
assert.throws(() => tool.validateInput({ content: "x" }), /session_id or hole_id/);
console.log("ok update_document tool shape");
