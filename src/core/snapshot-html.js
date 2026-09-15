import { CANVAS_SHELL } from "./html/shell.js";
import { markdownContainsBlockType } from "./blocks.js";
import { escapeHtml, serializeForInlineScript } from "./utils.js";
import { assembleRabbitholePage } from "./html/document.js";

/** @param {any} projection */
export function snapshotProjectionUsesMermaid(projection) {
  return !!projection?.hole?.nodes?.some((/** @type {any} */ node) => markdownContainsBlockType(node?.markdown, "mermaid"));
}

/** @param {any} projection */
export function snapshotProjectionUsesChart(projection) {
  return !!projection?.hole?.nodes?.some((/** @type {any} */ node) => markdownContainsBlockType(node?.markdown, "chart"));
}

/** @param {any} projection */
export function snapshotProjectionUsesTrace(projection) {
  return !!projection?.hole?.nodes?.some((/** @type {any} */ node) =>
    markdownContainsBlockType(node?.markdown, "trace") || markdownContainsBlockType(node?.markdown, "sim"));
}

/** @param {any} projection */
export function snapshotProjectionUsesPdf(projection) {
  return !!projection?.hole?.nodes?.some((/** @type {any} */ node) => node?.extensions?.pdf?.version === 2 && !node.extensions.pdf.converted);
}

/** @param {unknown} source */
function mermaidRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+mermaid" id="rabbithole-mermaid-runtime">${escaped}</script>`;
}

/** @param {unknown} source */
function chartRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+chart" id="rabbithole-chart-runtime">${escaped}</script>`;
}

/** @param {unknown} source */
function traceRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+trace" id="rabbithole-trace-runtime">${escaped}</script>`;
}

/**
 * @param {{
 *   title: string,
 *   stylesheetText: string,
 *   dompurifySource: string,
 *   mermaidSource?: string,
 *   chartSource?: string,
 *   traceSource?: string,
 *   frozenClientSource: string,
 *   pdfWorkerSource?: string,
 *   pdfJsSource?: string,
 *   snapshotProjection: any
 * }} options
 */
export function buildSnapshotHtml({ title, stylesheetText, dompurifySource, mermaidSource = "", chartSource = "", traceSource = "", pdfJsSource = "", pdfWorkerSource = "", frozenClientSource, snapshotProjection }) {
  const usesMermaid = snapshotProjectionUsesMermaid(snapshotProjection);
  const usesChart = snapshotProjectionUsesChart(snapshotProjection);
  const usesTrace = snapshotProjectionUsesTrace(snapshotProjection);
  const usesPdf = snapshotProjectionUsesPdf(snapshotProjection);
  if (usesMermaid && !mermaidSource) throw new Error("Mermaid runtime is unavailable for this snapshot");
  if (usesChart && !chartSource) throw new Error("Chart runtime is unavailable for this snapshot");
  if (usesTrace && !traceSource) throw new Error("Trace runtime is unavailable for this snapshot");
  if (usesPdf && (!pdfWorkerSource || !pdfJsSource)) throw new Error("PDF runtime is unavailable for this snapshot");
  var lt = String.fromCharCode(60);
  var gt = String.fromCharCode(62);
  var scriptOpen = lt + "script" + gt;
  var scriptClose = lt + String.fromCharCode(47) + "script" + gt;
  var payloadOpen = lt + 'script type="application/vnd.rabbithole+json" id="rabbithole-portable"' + gt;
  const bodyHtml = CANVAS_SHELL +
    (usesMermaid ? "\n" + mermaidRuntimeCarrier(mermaidSource) : "") +
    (usesChart ? "\n" + chartRuntimeCarrier(chartSource) : "") +
    (usesTrace ? "\n" + traceRuntimeCarrier(traceSource) : "") +
    (usesPdf ? "\n" + pdfJsRuntimeCarrier(pdfJsSource) + "\n" + pdfWorkerRuntimeCarrier(pdfWorkerSource) : "") +
    "\n" + payloadOpen + serializeForInlineScript(snapshotProjection) + scriptClose +
    "\n" + scriptOpen + "\n" +
    dompurifySource +
    "\n(function(){\n" +
    '  "use strict";\n' +
    frozenClientSource +
    "\n  var payload = document.getElementById(\"rabbithole-portable\");\n" +
    "  RabbitholeFrozenClient.startPortableSnapshot(JSON.parse(payload.textContent));\n" +
    "})();\n" +
    scriptClose;
  return assembleRabbitholePage({ mode: "frozen", title, stylesheetText, bodyHtml });
}

/** @param {unknown} source */
function pdfJsRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+pdfjs" id="rabbithole-pdfjs-runtime">${escaped}</script>`;
}

/** @param {unknown} source */
function pdfWorkerRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+pdf-worker" id="rabbithole-pdf-worker-runtime">${escaped}</script>`;
}
