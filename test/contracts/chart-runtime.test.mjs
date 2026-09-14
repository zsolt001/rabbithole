/** @protects chart runtime selection, offline delivery, and snapshot boundaries. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { buildSnapshotHtml, snapshotProjectionUsesChart } from "../../src/core/snapshot-html.js";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const chartSource = await fs.readFile(path.join(root, "dist/chart-runtime.js"), "utf8");
const frozenClientSource = await fs.readFile(path.join(root, "dist/frozen-client.js"), "utf8");
const stylesheetText = await fs.readFile(path.join(root, "dist/canvas.css"), "utf8");
const dompurifySource = await fs.readFile(path.join(root, "node_modules/dompurify/dist/purify.min.js"), "utf8");

function projection(markdown) {
  return {
    format: "rabbithole",
    format_version: 1,
    hole: {
      schema_version: 2,
      hole_id: "chart-test",
      title: "Chart test",
      root_id: "root",
      created_at: "2026-09-14T00:00:00.000Z",
      updated_at: "2026-09-14T00:00:00.000Z",
      extensions: {},
      nodes: [{ id: "root", parent_id: null, title: "Chart", markdown, created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:00:00.000Z", extensions: {} }],
    },
    assets: {},
    view: { mode: "canvas", node_id: "root", scroll: 0, view: { x: 0, y: 0, scale: 1 } },
  };
}

const chartMarkdown = [
  "```chart",
  JSON.stringify({ v: 1, type: "confidence-band", title: "Estimated effect", data: [{ year: 2024, estimate: 2.1, low: 1.7, high: 2.5 }, { year: 2025, estimate: 2.8, low: 2.3, high: 3.2 }], x: "year", y: "low", y2: "high", value: "estimate" }),
  "```",
].join("\n");

const traceMarkdown = [
  "```trace",
  JSON.stringify({ v: 1, title: "Request path", actors: [{ id: "api", label: "API", type: "service" }, { id: "jobs", label: "Jobs", type: "queue" }], events: [{ at: 0, type: "send", from: "api", to: "jobs", item: "request-1" }, { at: 1, type: "enqueue", target: "jobs", item: "request-1" }] }),
  "```",
  "```sim",
  JSON.stringify({ v: 1, title: "Worker queue", seed: 42, duration: 10, queues: [{ id: "work", label: "Work", capacity: 5 }], pools: [{ id: "workers", label: "Workers", queue: "work", capacity: 1, service: { distribution: "constant", value: 2 } }], arrivals: [{ at: 0, queue: "work", item: "job-1" }] }),
  "```",
].join("\n");

assert.equal(snapshotProjectionUsesChart(projection(chartMarkdown)), true);
assert.equal(snapshotProjectionUsesChart(projection("````markdown\n```chart\n{}\n```\n````")), false);
assert.throws(() => buildSnapshotHtml({ title: "Chart", stylesheetText, dompurifySource, frozenClientSource, snapshotProjection: projection(chartMarkdown) }), /Chart runtime is unavailable/);

const without = buildSnapshotHtml({ title: "Plain", stylesheetText, dompurifySource, frozenClientSource, snapshotProjection: projection("Plain prose") });
assert(!without.includes('type="application/vnd.rabbithole+chart" id="rabbithole-chart-runtime"'));
const html = buildSnapshotHtml({ title: "Chart", stylesheetText, dompurifySource, chartSource, frozenClientSource, snapshotProjection: projection(chartMarkdown) });
assert(html.includes('type="application/vnd.rabbithole+chart" id="rabbithole-chart-runtime"'));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const requests = [];
  page.on("request", (request) => {
    if (request.resourceType() !== "document") requests.push(request.url());
  });
  await page.setContent(html, { waitUntil: "load" });
  const svg = page.locator('.viz-chart svg[role="img"][aria-label="Estimated effect"]');
  await svg.waitFor({ state: "visible" });
  assert.equal(await svg.count(), 1);
  assert.equal(requests.length, 0, "frozen chart snapshots must not fetch network resources");

  const fullscreen = page.locator('.viz-chart [data-chart-action="expand"]');
  await fullscreen.click();
  await page.locator('.rh-lightbox svg[role="img"][aria-label="Estimated effect"]').waitFor({ state: "visible" });
  await page.keyboard.press("Escape");

  const download = page.waitForEvent("download");
  await page.locator('.viz-chart [data-chart-action="download"]').click();
  assert.equal((await download).suggestedFilename(), "estimated-effect.svg");

  const traceHtml = buildSnapshotHtml({ title: "Trace", stylesheetText, dompurifySource, frozenClientSource, snapshotProjection: projection(traceMarkdown) });
  await page.setContent(traceHtml, { waitUntil: "load" });
  assert.equal(await page.locator(".viz-trace .rh-trace-caption").textContent(), "0: send request-1");
  await page.locator('.viz-trace [data-trace="next"]').click();
  assert.equal(await page.locator(".viz-trace .rh-trace-caption").textContent(), "1: enqueue request-1");
  assert.equal(await page.locator('.viz-trace [data-actor="jobs"] output').textContent(), "1");
  assert.match(await page.locator(".viz-sim .rh-trace-caption").textContent(), /^0: job-1 enters work$/);
  const queueMeter = page.locator('.viz-sim [data-actor="work"] .rh-trace-queue-meter');
  assert.equal(await queueMeter.getAttribute("aria-valuemax"), "5");
  assert.equal(await queueMeter.getAttribute("aria-valuenow"), "1");
  assert.equal(await page.locator('.viz-sim [data-actor="work"] output').textContent(), "1 / 5");
} finally {
  await browser.close();
}

console.log("ok visual runtimes: offline charts export and expand while trace and simulation controls advance deterministically");
