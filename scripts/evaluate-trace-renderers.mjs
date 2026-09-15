import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { traceRendererCases, traceRendererViewports } from "../test/fixtures/traces/renderer-corpus.mjs";
import { deriveTracePresentation } from "./trace-renderer-eval/shared-model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  { id: "elk-svg", entry: "scripts/trace-renderer-eval/elk-svg-candidate.js", globalName: "RabbitholeElkCandidate", output: "elk-svg.js" },
  { id: "cytoscape", entry: "scripts/trace-renderer-eval/cytoscape-candidate.js", globalName: "RabbitholeCytoscapeCandidate", output: "cytoscape.js" },
];
const artifactsDir = path.join(root, "scratchpad", "trace-renderer-eval-artifacts");
const bundleDir = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-trace-eval-"));
await fs.rm(artifactsDir, { recursive: true, force: true });
await fs.mkdir(artifactsDir, { recursive: true });

const browser = await chromium.launch();
const rows = [];
const screenshots = [];

try {
  for (const candidate of candidates) {
    const bundlePath = path.join(bundleDir, candidate.output);
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

    for (const fixture of traceRendererCases) {
      const presentation = deriveTracePresentation(fixture.trace);
      for (const viewport of traceRendererViewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          serviceWorkers: "block",
          reducedMotion: "no-preference",
          colorScheme: "light",
        });
        const page = await context.newPage();
        const requests = [];
        const errors = [];
        page.on("request", (request) => {
          if (request.resourceType() !== "document" && !request.url().startsWith("data:")) requests.push(request.url());
        });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setContent('<!doctype html><meta charset="utf-8"><main id="target"></main><style>html,body,#target{width:100%;height:100%;margin:0}</style>');
        await page.addScriptTag({ path: bundlePath });
        const result = await page.evaluate(async ({ globalName, presentation, viewport }) => {
          const started = performance.now();
          const renderer = await globalThis[globalName].render(presentation, document.getElementById("target"), { width: viewport.width, height: viewport.height });
          const renderMs = performance.now() - started;
          const updates = [];
          for (let repetition = 0; repetition < 20; repetition += 1) {
            for (let index = 0; index < presentation.frames.length; index += 1) {
              const updateStarted = performance.now();
              renderer.setFrame(index, false);
              const probe = document.querySelector(".trace-caption");
              probe?.getBoundingClientRect();
              updates.push(performance.now() - updateStarted);
            }
          }
          updates.sort((left, right) => left - right);
          renderer.setFrame(0, false);
          const serialized = renderer.serialize();
          return {
            renderMs,
            layoutMs: renderer.layoutMs,
            medianFrameMs: updates[Math.floor(updates.length / 2)] || 0,
            serializedBytes: new TextEncoder().encode(serialized).length,
            svgCount: document.querySelectorAll("svg").length,
            canvasCount: document.querySelectorAll("canvas").length,
            domElements: document.querySelectorAll("*").length,
            regionLabel: document.getElementById("target").getAttribute("aria-label"),
            controls: [...document.querySelectorAll("button")].map((button) => ({ label: button.textContent, disabled: button.disabled })),
            liveCaption: Boolean(document.querySelector('[aria-live="polite"]')),
          };
        }, { globalName: candidate.globalName, presentation, viewport });

        for (const frameIndex of fixture.captureFrames) {
          const boundedIndex = Math.min(frameIndex, presentation.frames.length - 1);
          await page.evaluate((index) => globalThis.__traceEvalRenderer?.setFrame(index, false), boundedIndex).catch(() => {});
          // The public controls exercise the same frame path. Directly call the
          // retained renderer for deterministic screenshot frames.
          await page.evaluate((index) => {
            const buttons = [...document.querySelectorAll("button")];
            const previous = buttons.find((button) => button.dataset.action === "previous");
            while (!previous.disabled) previous.click();
            const next = buttons.find((button) => button.dataset.action === "next");
            for (let step = 0; step < index; step += 1) next.click();
          }, boundedIndex);
          const file = `${candidate.id}-${fixture.id}-${viewport.id}-frame-${String(boundedIndex).padStart(2, "0")}.png`;
          await page.screenshot({ path: path.join(artifactsDir, file) });
          screenshots.push(file);
        }
        rows.push({
          candidate: candidate.id,
          case: fixture.id,
          viewport: viewport.id,
          bundleBytes,
          networkRequests: requests.length,
          errors,
          ...result,
        });
        await context.close();
      }
    }

    await captureMode(candidate, bundlePath, "dark", { colorScheme: "dark", reducedMotion: "no-preference" });
    await captureMode(candidate, bundlePath, "reduced-motion", { colorScheme: "light", reducedMotion: "reduce" });
  }
} finally {
  await browser.close();
  await fs.rm(bundleDir, { recursive: true, force: true });
}

async function captureMode(candidate, bundlePath, mode, contextOptions) {
  const viewport = { width: 1280, height: 760 };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block", ...contextOptions });
  const page = await context.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><main id="target"></main><style>html,body,#target{width:100%;height:100%;margin:0}</style>');
  await page.addScriptTag({ path: bundlePath });
  const presentation = deriveTracePresentation(traceRendererCases[0].trace);
  await page.evaluate(async ({ globalName, presentation, viewport }) => {
    const renderer = await globalThis[globalName].render(presentation, document.getElementById("target"), { width: viewport.width, height: viewport.height });
    renderer.setFrame(16, true);
  }, { globalName: candidate.globalName, presentation, viewport });
  const file = `${candidate.id}-many-to-many-fullscreen-${mode}.png`;
  await page.screenshot({ path: path.join(artifactsDir, file) });
  screenshots.push(file);
  await context.close();
}

const summaries = candidates.map((candidate) => {
  const candidateRows = rows.filter((row) => row.candidate === candidate.id);
  return {
    candidate: candidate.id,
    bundleBytes: candidateRows[0]?.bundleBytes || 0,
    medianRenderMs: median(candidateRows.map((row) => row.renderMs)),
    medianLayoutMs: median(candidateRows.map((row) => row.layoutMs)),
    medianFrameMs: median(candidateRows.map((row) => row.medianFrameMs)),
    maxSerializedBytes: Math.max(...candidateRows.map((row) => row.serializedBytes)),
    maxDomElements: Math.max(...candidateRows.map((row) => row.domElements)),
    networkRequests: candidateRows.reduce((sum, row) => sum + row.networkRequests, 0),
    errors: candidateRows.flatMap((row) => row.errors).length,
    hostAccessibility: candidateRows.every((row) => row.regionLabel && row.liveCaption && row.controls.length === 3 && row.controls[1].disabled),
    graphAccessibility: candidate.id === "elk-svg" && candidateRows.every((row) => row.svgCount === 1),
  };
});

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function table(records, columns) {
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  return [header, separator, ...records.map((record) => `| ${columns.map((column) => record[column]).join(" | ")} |`)].join("\n");
}

const report = {
  generatedAt: new Date().toISOString(),
  corpus: traceRendererCases.map(({ id, description, trace }) => ({ id, description, actors: trace.actors.length, events: trace.events.length })),
  viewports: traceRendererViewports,
  summaries,
  measurements: rows,
  screenshots,
};
await fs.writeFile(path.join(artifactsDir, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
const markdown = `# Trace renderer bake-off results

Generated ${report.generatedAt}. Both candidates consumed the same renderer-neutral presentation derived from the existing \`trace\` v1 corpus.

## Automated measurements

${table(summaries.map((summary) => ({
  Candidate: summary.candidate,
  "Bundle bytes": summary.bundleBytes,
  "Median render ms": summary.medianRenderMs.toFixed(2),
  "Median layout ms": summary.medianLayoutMs.toFixed(2),
  "Median frame ms": summary.medianFrameMs.toFixed(3),
  "Max serialized bytes": summary.maxSerializedBytes,
  "Max DOM elements": summary.maxDomElements,
  Network: summary.networkRequests,
  Errors: summary.errors,
  "Host a11y": summary.hostAccessibility ? "pass" : "fail",
  "Graph a11y": summary.graphAccessibility ? "pass" : "fail",
})), ["Candidate", "Bundle bytes", "Median render ms", "Median layout ms", "Median frame ms", "Max serialized bytes", "Max DOM elements", "Network", "Errors", "Host a11y", "Graph a11y"])}

## Mandatory gates

- Zero non-document network requests.
- No page errors.
- Deterministic frame stepping from the same \`trace\` v1 input.
- Named region, keyboard-native buttons, disabled Previous at frame zero, and live caption.
- Paused by default and static under reduced motion.

## Visual review

Review the PNG files in this directory side by side. Score visual fidelity, trace semantics, card readability, fullscreen readability, reduced motion, and implementation complexity from 0-5. The automated report intentionally does not fabricate subjective scores.

## Schema checkpoint

Record any requirement that neither renderer can derive from \`trace\` v1. Do not extend the schema unless a captured corpus failure demonstrates the need.
`;
await fs.writeFile(path.join(artifactsDir, "README.md"), markdown, "utf8");

console.table(summaries);
console.log(`Artifacts: ${artifactsDir}`);
if (summaries.some((summary) => summary.networkRequests || summary.errors || !summary.hostAccessibility)) process.exitCode = 1;
