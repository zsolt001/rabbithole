/** @protects the reviewed-document redline surface end to end over a live session. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-redline-e2e-"));
const previousDir = process.env.RABBITHOLE_DIR;
const previousNoBrowser = process.env.RABBITHOLE_NO_BROWSER;
process.env.RABBITHOLE_DIR = storeDir;
process.env.RABBITHOLE_NO_BROWSER = "1";
let session = null;
let context = null;
try {
  const [{ createSession }, { buildCanvasHtml }] = await Promise.all([
    import("../../src/node/sessions.js"),
    import("../../src/node/html/canvas.js"),
  ]);
  session = await createSession({
    holeId: "redline-e2e", title: "Redline", rootId: "root",
    viewState: { mode: "canvas", node_id: "root", scroll: 0 }, isResume: true,
    nodes: [{
      id: "root", parent_id: null, title: "Report", markdown: "# Report\n\nThe quick brown fox.",
      origin: null, position: { x: 0, y: 0 }, size: { w: 420, h: 460 }, status: "answered", extensions: {},
    }],
    assetNames: new Set(), renderPage: (hydration) => buildCanvasHtml(hydration),
  });
  context = await app.browser.newContext();
  const page = await context.newPage();
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card.root .doc-content");

  // The agent push: replace the document markdown on the live session.
  await session.updateNode({ type: "node_document_update", node_id: "root", content: "# Report\n\nThe slow brown fox." });

  const del = page.locator(".card.root .doc-content del.rh-del");
  const ins = page.locator(".card.root .doc-content ins.rh-ins");
  await del.first().waitFor();
  assert.equal(await del.first().innerText(), "quick");
  assert.equal(await ins.first().innerText(), "slow");
  console.log("ok redline marks render in the card");
} finally {
  if (context) await context.close();
  if (session) await session.close("redline_test_complete");
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR; else process.env.RABBITHOLE_DIR = previousDir;
  if (previousNoBrowser === undefined) delete process.env.RABBITHOLE_NO_BROWSER; else process.env.RABBITHOLE_NO_BROWSER = previousNoBrowser;
  await app.close();
  await fs.rm(storeDir, { recursive: true, force: true });
}
