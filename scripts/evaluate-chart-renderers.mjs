import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { publicationCases, publicationRequirements } from "../test/fixtures/charts/publication-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  { id: "plot", entry: "scripts/chart-renderer-eval/plot-candidate.js", globalName: "RabbitholePlotCandidate" },
];
const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-chart-eval-"));
const browser = await chromium.launch();
const rows = [];

try {
  for (const candidate of candidates) {
    const bundlePath = path.join(outputDir, `${candidate.id}.js`);
    await esbuild.build({
      entryPoints: [path.join(root, candidate.entry)],
      outfile: bundlePath,
      bundle: true,
      format: "iife",
      globalName: candidate.globalName,
      platform: "browser",
      target: "es2018",
      minify: true,
      legalComments: "none",
      logLevel: "silent",
    });
    const bundleBytes = (await fs.stat(bundlePath)).size;
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const requests = [];
    page.on("request", (request) => {
      if (!request.url().startsWith("data:") && request.resourceType() !== "document") requests.push(request.url());
    });
    await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:white}.chart{width:720px;min-height:430px}</style><main></main>');
    await page.addScriptTag({ path: bundlePath });
    for (const model of publicationCases) {
      const started = performance.now();
      const result = await page.evaluate(async ({ globalName, model }) => {
        const container = document.createElement("section");
        container.className = "chart";
        document.querySelector("main").appendChild(container);
        try {
          const rendered = await globalThis[globalName].renderCase(model, container);
          const svg = container.querySelector('svg[role="img"]');
          const geometryCount = svg?.querySelectorAll("path, rect, circle, line, polygon").length || 0;
          return {
            ok: Boolean(svg) && geometryCount >= 3,
            svgBytes: new TextEncoder().encode(rendered.svg).length,
            geometryCount,
            accessible: svg?.getAttribute("role") === "img" && svg?.getAttribute("aria-label") === model.title,
            message: "",
          };
        } catch (error) {
          return { ok: false, svgBytes: 0, geometryCount: 0, accessible: false, message: error?.message || String(error) };
        }
      }, { globalName: candidate.globalName, model });
      rows.push({ candidate: candidate.id, case: model.id, bundleBytes, renderMs: performance.now() - started, networkRequests: 0, ...result });
    }
    const screenshotPath = path.join(outputDir, `${candidate.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    for (const row of rows.filter((item) => item.candidate === candidate.id)) row.networkRequests = requests.length;
    await context.close();
  }
} finally {
  await browser.close();
}

const summary = candidates.map((candidate) => {
  const candidateRows = rows.filter((row) => row.candidate === candidate.id);
  const covered = new Set(candidateRows.filter((row) => row.ok).flatMap((row) => publicationCases.find((item) => item.id === row.case)?.capabilities || []));
  return {
    candidate: candidate.id,
    bundleBytes: candidateRows[0]?.bundleBytes || 0,
    rendered: candidateRows.filter((row) => row.ok).length,
    cases: candidateRows.length,
    acceptanceCapabilities: covered.size,
    acceptanceRequirements: publicationRequirements.length,
    networkRequests: Math.max(0, ...candidateRows.map((row) => row.networkRequests || 0)),
  };
});

console.table(summary);
console.table(rows.map(({ candidate, case: caseId, ok, accessible, geometryCount, svgBytes, renderMs, message }) => ({
  candidate,
  case: caseId,
  ok,
  accessible,
  geometryCount,
  svgBytes,
  renderMs: Number(renderMs.toFixed(1)),
  message,
})));
console.log(`Artifacts: ${outputDir}`);

if (rows.some((row) => row.networkRequests > 0 || (row.ok && !row.accessible))) process.exitCode = 1;
