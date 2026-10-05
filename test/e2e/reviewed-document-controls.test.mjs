/** @protects reviewed-document view-mode, outline, outline resize, and sticky reader strip end to end. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-controls-e2e-"));
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
    holeId: "controls-e2e", title: "Controls", rootId: "root",
    viewState: { mode: "canvas", node_id: "root", scroll: 0 }, isResume: true,
    nodes: [{
      id: "root", parent_id: null, title: "Report", markdown: "# Report\n\nThe quick brown fox.\n\n## Details\n\nMore.\n\n" + "Filler paragraph for scrolling.\n\n".repeat(80),
      origin: null, position: { x: 0, y: 0 }, size: { w: 480, h: 520 }, status: "answered", extensions: {},
    }],
    assetNames: new Set(), renderPage: (hydration) => buildCanvasHtml(hydration),
  });
  context = await app.browser.newContext();
  const page = await context.newPage();
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card.root .doc-content");

  // An unedited document already offers the outline, but not the review modes.
  await page.locator(".card.root .card-more").click();
  assert.equal(await page.locator("#cm-viewmode").isVisible(), false);
  await page.locator("#cm-outline").click();
  await page.locator(".card.root .doc-content .rh-outline .rh-outline-item").first().waitFor();
  assert.equal(await page.locator(".card.root .review-pill").isVisible(), false);

  // Dragging the rail's edge widens it; the width persists across a reload
  // and a double-click resets it.
  const railWidth = () => page.locator(".card.root .rh-outline-pane").evaluate((el) => el.getBoundingClientRect().width);
  const before = await railWidth();
  const grip = await page.locator(".card.root .rh-outline-resize").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 20);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + 20, { steps: 5 });
  await page.mouse.up();
  const widened = await railWidth();
  assert.ok(widened > before + 20, `outline must widen on drag (${before} -> ${widened})`);
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".card.root .rh-outline-pane").waitFor();
  assert.ok(Math.abs((await railWidth()) - widened) < 2, "outline width must persist across a reload");
  await page.locator(".card.root .rh-outline-resize").dblclick();
  assert.ok(Math.abs((await railWidth()) - before) < 2, "double-click must reset the outline width");
  console.log("ok outline resizes and resets");

  // Expanded reader: the control strip stays pinned while the document scrolls.
  await page.evaluate(() => document.querySelector(".card.root [aria-label='Expand document']").click());
  await page.locator(".reader-review-strip").waitFor();
  await page.locator("#reader-main").evaluate((el) => { el.scrollTop = 1500; });
  const pinned = await page.evaluate(() => {
    const main = document.getElementById("reader-main").getBoundingClientRect();
    const strip = document.querySelector(".reader-review-strip").getBoundingClientRect();
    return { mainTop: main.top, stripTop: strip.top, scrolled: document.getElementById("reader-main").scrollTop };
  });
  assert.ok(pinned.scrolled > 500, `reader fixture must scroll (${JSON.stringify(pinned)})`);
  assert.ok(Math.abs(pinned.stripTop - pinned.mainTop) < 2, `reader strip must stay pinned (${JSON.stringify(pinned)})`);
  console.log("ok reader strip stays pinned");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.body.classList.contains("mode-canvas"));
  await page.locator(".card.root .card-more").click();
  await page.locator("#cm-outline").click();
  await page.waitForFunction(() => !document.querySelector(".card.root .doc-content .rh-outline"));
  console.log("ok unedited document toggles the outline");

  await session.updateNode({ type: "node_document_update", node_id: "root", content: "# Report\n\nThe slow brown fox.\n\n## Details\n\nMore.\n\n" + "Filler paragraph for scrolling.\n\n".repeat(80) });

  // Default view is marked-up.
  await page.locator(".card.root .doc-content del.rh-del").first().waitFor();

  // Cycle the view mode to clean via the card menu: marks disappear.
  await page.locator(".card.root .card-more").click();
  await page.locator("#cm-viewmode").click();
  await page.waitForFunction(() => document.querySelectorAll(".card.root .doc-content del.rh-del").length === 0);
  console.log("ok view-mode cycles to clean");

  // Toggle the outline on: the rail appears with an entry per heading.
  await page.locator(".card.root .card-more").click();
  await page.locator("#cm-outline").click();
  await page.locator(".card.root .doc-content .rh-outline .rh-outline-item").first().waitFor();
  assert.ok(await page.locator(".card.root .doc-content .rh-outline .rh-outline-item").count() >= 2);
  console.log("ok outline toggles on");
} finally {
  if (context) await context.close();
  if (session) await session.close("controls_test_complete");
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR; else process.env.RABBITHOLE_DIR = previousDir;
  if (previousNoBrowser === undefined) delete process.env.RABBITHOLE_NO_BROWSER; else process.env.RABBITHOLE_NO_BROWSER = previousNoBrowser;
  await app.close();
  await fs.rm(storeDir, { recursive: true, force: true });
}
