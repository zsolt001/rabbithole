/** @protects chart runtime selection, offline delivery, and snapshot boundaries. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { buildSnapshotHtml, snapshotProjectionUsesChart, snapshotProjectionUsesTrace } from "../../src/core/snapshot-html.js";
import { buildCanvasHtml } from "../../src/node/html/canvas.js";
import { traceRendererCases } from "../fixtures/traces/renderer-corpus.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const chartSource = await fs.readFile(path.join(root, "dist/chart-runtime.js"), "utf8");
const traceSource = await fs.readFile(path.join(root, "dist/trace-runtime.js"), "utf8");
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

const multiTraceMarkdown = traceRendererCases.slice(0, 3).map((fixture, index) => [
  `\`\`\`trace id=trace${index + 1}`,
  JSON.stringify(fixture.trace),
  "```",
].join("\n")).join("\n");

assert.equal(snapshotProjectionUsesChart(projection(chartMarkdown)), true);
assert.equal(snapshotProjectionUsesChart(projection("````markdown\n```chart\n{}\n```\n````")), false);
assert.equal(snapshotProjectionUsesTrace(projection(traceMarkdown)), true);
assert.equal(snapshotProjectionUsesTrace(projection("````markdown\n```trace\n{}\n```\n````")), false);
assert.throws(() => buildSnapshotHtml({ title: "Trace", stylesheetText, dompurifySource, frozenClientSource, snapshotProjection: projection(traceMarkdown) }), /Trace runtime is unavailable/);
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

  const traceHtml = buildSnapshotHtml({ title: "Trace", stylesheetText, dompurifySource, traceSource, frozenClientSource, snapshotProjection: projection(traceMarkdown) });
  await page.setContent(traceHtml, { waitUntil: "load" });
  await page.locator('.viz-trace svg[role="img"]').waitFor({ state: "visible" });
  assert.equal(await page.locator('.viz-trace [data-trace="previous"]').isDisabled(), true);
  assert.equal(await page.locator('.viz-trace [data-node="api"]').getAttribute("tabindex"), "0");
  assert.match(await page.locator('.viz-trace [data-node="api"]').getAttribute("aria-label"), /^API, service,/);
  assert.equal(await page.locator(".viz-trace .rh-trace-caption").textContent(), "send request-1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    globalThis.__traceAnimations = 0;
    // @ts-ignore Browser probe only needs to count calls, not emulate Animation.
    Element.prototype.animate = function () {
      globalThis.__traceAnimations += 1;
      return { cancel() {}, finished: Promise.resolve() };
    };
  });
  await page.locator('.viz-trace [data-trace="next"]').click();
  assert.equal(await page.locator(".viz-trace .rh-trace-caption").textContent(), "enqueue request-1");
  assert.equal(await page.locator('.viz-trace [data-node="jobs"] .rh-trace-node-count').textContent(), "1 buffered");
  assert.equal(await page.evaluate(() => globalThis.__traceAnimations), 0, "reduced motion must suppress trace token animation");
  assert.equal(await page.locator(".viz-sim .rh-trace-caption").textContent(), "job-1 enters work");
  await page.locator('.viz-sim svg[role="img"]').waitFor({ state: "visible" });
  assert.equal(await page.locator('.viz-sim [data-node="work"] .rh-trace-node-count').textContent(), "1 buffered");
  assert.equal(requests.length, 0, "frozen trace snapshots must not fetch network resources");

  const multiHtml = buildSnapshotHtml({ title: "Multiple traces", stylesheetText, dompurifySource, traceSource, frozenClientSource, snapshotProjection: projection(multiTraceMarkdown) });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(multiHtml, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll(".viz-trace").length === 3 && [...document.querySelectorAll(".viz-trace")].every((host) => host.shadowRoot?.querySelector("svg")));
  assert.equal(await page.locator(".viz-trace").count(), 3, "multiple traces should mount independently");
  const traceHosts = page.locator(".viz-trace");
  const compactRanks = await traceHosts.nth(0).evaluate((host) => {
    const y = (id) => Number(/translate\([^ ]+ ([^)]+)\)/.exec(host.shadowRoot.querySelector(`[data-node="${id}"]`).getAttribute("transform"))[1]);
    return [y("checkout"), y("orders"), y("worker1")];
  });
  assert(compactRanks[0] < compactRanks[1] && compactRanks[1] < compactRanks[2], "mobile traces should use a vertical compact layout");
  const darkCardColor = await traceHosts.nth(0).locator(".rh-trace-node rect").first().evaluate((node) => getComputedStyle(node).fill);
  assert.notEqual(darkCardColor, "rgb(255, 255, 255)", "trace SVG should inherit the dark theme tokens");
  const secondCaptionBefore = await traceHosts.nth(1).locator(".rh-trace-caption").textContent();
  await traceHosts.nth(0).locator('input[type="range"]').evaluate((input) => {
    input.value = "16";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(await traceHosts.nth(0).locator('[data-edge="worker2--orders"]').getAttribute("class"), "rh-trace-edge is-transient is-active is-retry");
  assert.equal(await traceHosts.nth(1).locator(".rh-trace-caption").textContent(), secondCaptionBefore, "one trace should not advance another");

  await page.evaluate(() => {
    const host = document.querySelector(".viz-trace");
    host.__rhVisualDispose();
    host.shadowRoot.querySelector('[data-trace="play"]').click();
  });
  await page.waitForTimeout(850);
  assert.equal(await traceHosts.nth(0).locator(".rh-trace-position").textContent(), "Step 17 of 26", "disposed traces must not retain playback listeners");

  const liveHtml = await buildCanvasHtml({
    title: "Live Trace",
    hole_id: "live-trace",
    root_id: "root",
    nodes: [liveNode("root", traceMarkdown)],
    frozen: false,
    agent_attached: false,
  });
  assert(liveHtml.includes('type="application/vnd.rabbithole+trace" id="rabbithole-trace-runtime"'));
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.route("http://rabbithole.test/**", (route) => route.abort());
  await page.setContent(liveHtml.replace("<head>", '<head><base href="http://rabbithole.test/">'), { waitUntil: "load" });
  await page.waitForSelector(".card.current [aria-label='Expand document']");
  await page.locator(".card.current [aria-label='Expand document']").click();
  await page.waitForFunction(() => !document.body.classList.contains("mode-canvas") && !document.body.classList.contains("mode-flight"));
  await page.waitForFunction(() => !!document.querySelector(".viz-trace")?.shadowRoot?.querySelector("svg"));
  assert.equal(await page.locator(".viz-trace").count(), 2, "live trace and simulation blocks should render with their embedded runtime");
} finally {
  await browser.close();
}

console.log("ok visual runtimes: offline charts export and expand while trace and simulation controls advance deterministically");

function liveNode(id, markdown) {
  return {
    id,
    parent_id: null,
    title: "Live Trace",
    markdown,
    base_url: null,
    base_url_source: null,
    origin: null,
    position: { x: 0, y: 0 },
    size: null,
    font_scale: 1,
    collapsed: false,
    status: "answered",
    read: true,
    created_at: "2026-09-15T00:00:00.000Z",
    extensions: {},
  };
}
