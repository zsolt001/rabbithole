/** @protects answer cards and notes sharing the document reader width, and answer cards the outline. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-answer-layout-e2e-"));
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
  const base = { position: { x: 0, y: 0 }, size: { w: 420, h: 400 }, status: "answered", extensions: {} };
  session = await createSession({
    holeId: "answer-layout-e2e", title: "Answers", rootId: "root",
    viewState: { mode: "canvas", node_id: "root", scroll: 0 }, isResume: true,
    nodes: [
      { ...base, id: "root", parent_id: null, title: "Doc", markdown: "# Doc\n\nRoot.", origin: null },
      { ...base, id: "ans", parent_id: "root", title: "Answer", markdown: "# Answer\n\nBody\n\n## Part two\n\nMore", position: { x: 500, y: 0 },
        origin: { kind: "branch", question: "why?", branch_type: "selection", selected_text: "" } },
      { ...base, id: "note", parent_id: "root", title: "Note", markdown: "A standalone note.", position: { x: 500, y: 500 },
        origin: { kind: "note" } },
    ],
    assetNames: new Set(), renderPage: (hydration) => buildCanvasHtml(hydration),
  });
  context = await app.browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card[data-id='ans'] .doc-content");

  const colWidth = async (id) => {
    await page.evaluate((cardId) => document.querySelector(`.card[data-id="${cardId}"] [aria-label='Expand document']`).click(), id);
    await page.waitForSelector(".reader-col .doc-content");
    await page.waitForTimeout(600);
    const width = await page.locator(".reader-col").evaluate((el) => el.getBoundingClientRect().width);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.body.classList.contains("mode-canvas"));
    return width;
  };

  const doc = await colWidth("root");
  assert.ok(doc > 900, `fixture: the document reader column is wide (${doc})`);
  assert.ok(Math.abs((await colWidth("ans")) - doc) < 2, "an answer card reads as wide as a document");
  assert.ok(Math.abs((await colWidth("note")) - doc) < 2, "a note reads as wide as a document");
  console.log("ok answer cards and notes share the document width");

  // An answer card can show the outline; a note offers none.
  await page.locator(".card[data-id='ans'] .card-more").click();
  await page.locator("#cm-outline").click();
  await page.locator(".card[data-id='ans'] .doc-content .rh-outline .rh-outline-item").first().waitFor();
  assert.equal(await page.locator(".card[data-id='ans'] .review-pill").isVisible(), false, "no review modes on an answer");
  await page.locator(".card[data-id='note'] .card-more").click();
  assert.equal(await page.locator("#cm-outline").isVisible(), false, "notes offer no outline");
  console.log("ok answer outline");
} finally {
  if (context) await context.close();
  if (session) await session.close("answer_layout_test_complete");
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR; else process.env.RABBITHOLE_DIR = previousDir;
  if (previousNoBrowser === undefined) delete process.env.RABBITHOLE_NO_BROWSER; else process.env.RABBITHOLE_NO_BROWSER = previousNoBrowser;
  await app.close();
  await fs.rm(storeDir, { recursive: true, force: true });
}
