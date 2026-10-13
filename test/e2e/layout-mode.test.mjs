/** @protects the Layout setting: Tidy follows Tree / Mind map / Balanced and the choice persists. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-layout-e2e-"));
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
  const card = (id, parent, x, y, branch = "selection") => ({
    id, parent_id: parent, title: id, markdown: `# ${id}\n\nbody`,
    origin: parent ? { kind: "branch", question: "why?", branch_type: branch, selected_text: "" } : null,
    position: { x, y }, size: { w: 300, h: 200 }, status: "answered", extensions: {},
  });
  session = await createSession({
    holeId: "layout-e2e", title: "Layout", rootId: "root",
    viewState: { mode: "canvas", node_id: "root", scroll: 0 }, isResume: true,
    nodes: [card("root", null, 0, 0), card("a", "root", 900, 900), card("b", "root", -900, 900, "followup"), card("c", "root", 900, -900)],
    assetNames: new Set(), renderPage: (hydration) => buildCanvasHtml(hydration),
  });
  context = await app.browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await context.newPage();
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card.root");

  const positions = () => page.evaluate(() => Object.fromEntries(["root", "a", "b", "c"].map((id) => {
    const el = document.querySelector(`.card[data-id="${id}"]`);
    return [id, { x: parseFloat(el.style.left), y: parseFloat(el.style.top) }];
  })));
  const chooseLayout = async (value) => {
    await page.locator("#t-settings").click();
    await page.locator("[data-settings-section]", { hasText: "Canvas" }).click();
    await page.locator(`[data-layout-choice="${value}"]`).click();
    await page.keyboard.press("Escape");
  };
  const tidy = async () => {
    await page.locator("#t-tidy").click();
    await page.waitForTimeout(500);
    return positions();
  };

  // Default is the existing tree grammar: selections right, follow-ups below.
  const tree = await tidy();
  assert.equal(tree.a.x, 370, "tree: a selection goes right of the root");
  assert.equal(tree.b.x, 0, "tree: a follow-up stays under the root");
  console.log("ok tree is the default");

  // Changing the setting alone moves nothing; Tidy applies it.
  await chooseLayout("mindmap");
  assert.deepEqual(await positions(), tree, "choosing a layout does not rearrange the canvas");
  const mind = await tidy();
  assert.deepEqual([mind.a.x, mind.b.x, mind.c.x], [370, 370, 370], "mind map: every branch fans out in one column to the right");
  assert.ok(mind.a.y < mind.b.y && mind.b.y < mind.c.y, "mind map: siblings stack in order, top to bottom");
  assert.ok(mind.a.y < mind.root.y && mind.root.y < mind.c.y, "mind map: the root sits between its first and last branch");
  console.log("ok mind map tidy");

  await chooseLayout("mindmap-balanced");
  const balanced = await tidy();
  const sides = [balanced.a, balanced.b, balanced.c].map((p) => (p.x < 0 ? "left" : "right"));
  assert.ok(sides.includes("left") && sides.includes("right"), `balanced: branches use both sides (${sides})`);
  console.log("ok balanced tidy");

  // The choice survives a reload.
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card.root");
  await page.locator("#t-settings").click();
  await page.locator("[data-settings-section]", { hasText: "Canvas" }).click();
  assert.equal(await page.locator('[data-layout-choice="mindmap-balanced"]').getAttribute("aria-checked"), "true");
  console.log("ok layout choice persists");
} finally {
  if (context) await context.close();
  if (session) await session.close("layout_test_complete");
  if (previousDir === undefined) delete process.env.RABBITHOLE_DIR; else process.env.RABBITHOLE_DIR = previousDir;
  if (previousNoBrowser === undefined) delete process.env.RABBITHOLE_NO_BROWSER; else process.env.RABBITHOLE_NO_BROWSER = previousNoBrowser;
  await app.close();
  await fs.rm(storeDir, { recursive: true, force: true });
}
