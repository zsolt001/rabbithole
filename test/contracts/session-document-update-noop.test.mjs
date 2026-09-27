/** @protects a no-op live document update emits no SSE re-render. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-noop-sse-"));
const previousDir = process.env.RABBITHOLE_DIR;
const previousNoBrowser = process.env.RABBITHOLE_NO_BROWSER;
process.env.RABBITHOLE_DIR = storeDir;
process.env.RABBITHOLE_NO_BROWSER = "1";
let session = null;
try {
  const { createSession } = await import("../../src/node/sessions.js");
  session = await createSession({
    holeId: "noop-sse", title: "H", rootId: "root",
    viewState: { mode: "canvas", node_id: "root", scroll: 0 }, isResume: true,
    nodes: [{
      id: "root", parent_id: null, title: "Doc", markdown: "# Doc\n\nThe quick brown fox.",
      origin: null, position: { x: 0, y: 0 }, size: null, status: "answered", extensions: {},
    }],
    assetNames: new Set(), renderPage: () => "<!doctype html><html></html>",
  });

  const before = session.lastOutboundEventId;
  // No-op: identical content must not broadcast.
  await session.updateNode({ type: "node_document_update", node_id: "root", content: "# Doc\n\nThe quick brown fox." });
  assert.equal(session.lastOutboundEventId, before, "no-op update must not emit an SSE event");
  console.log("ok no-op update is silent");

  // A real change must still broadcast.
  await session.updateNode({ type: "node_document_update", node_id: "root", content: "# Doc\n\nThe slow brown fox." });
  assert.ok(session.lastOutboundEventId > before, "a real change must emit an SSE event");
  console.log("ok real change broadcasts");
} finally {
  if (session) await session.close("noop_sse_test_complete");
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR; else process.env.RABBITHOLE_DIR = previousDir;
  if (previousNoBrowser === undefined) delete process.env.RABBITHOLE_NO_BROWSER; else process.env.RABBITHOLE_NO_BROWSER = previousNoBrowser;
  await fs.rm(storeDir, { recursive: true, force: true });
}
