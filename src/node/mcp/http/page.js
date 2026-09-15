/**
 * Self-contained page for a Rabbithole.
 *
 * The frontend is authored as three focused strings (styles, shell, browser
 * runtime) and assembled here into one HTML document. The output is still a
 * single-file page for live sessions and frozen exports.
 */

import { serializeForInlineScript } from "../../../core/utils.js";
import { assembleRabbitholePage } from "../../../core/html/document.js";
import { markdownContainsBlockType } from "../../../core/blocks.js";
import { getChartScript, getDompurifyScript, getFrozenClientLiteral, getInlinePdfJsScript, getInlinePdfWorkerScript, getMermaidScript, getTraceScript, getUiAssets } from "../../shared/dist-assets.js";
import { getCoreHtml } from "./assets.js";

export async function buildCanvasHtml(hydration) {
  const title = hydration?.title || "Rabbithole";
  const hydrationJson = serializeForInlineScript(hydration);
  const { stylesheetText, clientSource } = await getUiAssets();
  const { CANVAS_SHELL } = await getCoreHtml();
  const usesPdf = !!hydration?.nodes?.some((node) => node?.extensions?.pdf?.version === 2 && !node.extensions.pdf.converted);
  const usesChart = !!hydration?.nodes?.some((node) => markdownContainsBlockType(node?.markdown, "chart"));
  // Attached sessions can receive trace/sim nodes after the initial HTML is
  // served, so their inert carrier must be available before the SSE update.
  const usesTrace = hydration?.agent_attached === true || !!hydration?.nodes?.some((node) =>
    markdownContainsBlockType(node?.markdown, "trace") || markdownContainsBlockType(node?.markdown, "sim"));
  const pdfRuntimeCarriers = usesPdf
    ? `<script type="application/vnd.rabbithole+pdfjs" id="rabbithole-pdfjs-runtime">${getInlinePdfJsScript()}</script>
<script type="application/vnd.rabbithole+pdf-worker" id="rabbithole-pdf-worker-runtime">${getInlinePdfWorkerScript()}</script>`
    : "";
  const liveSnapshotSource = `  window.__RABBITHOLE_FROZEN_CLIENT__ = ${getFrozenClientLiteral()};\n`;
  const liveSnapshotHoleHook = `      getSnapshotHole: async function(){
        var response = await fetch("/snapshot-hole", { cache: "no-store" });
        if (!response.ok) throw new Error("Snapshot document is unavailable");
        return response.json();
      },\n`;

  const bodyHtml = `${CANVAS_SHELL}
<script type="application/vnd.rabbithole+mermaid" id="rabbithole-mermaid-runtime">${getMermaidScript()}</script>
${usesChart ? `<script type="application/vnd.rabbithole+chart" id="rabbithole-chart-runtime">${getChartScript()}</script>` : ""}
${usesTrace ? `<script type="application/vnd.rabbithole+trace" id="rabbithole-trace-runtime">${getTraceScript()}</script>` : ""}
${pdfRuntimeCarriers}
<script>
${getDompurifyScript()}
(function(){
	  "use strict";
	  var hydration = ${hydrationJson};
	  var preferences = hydration.preferences || {};
	  delete hydration.preferences;
	${liveSnapshotSource}${clientSource}
	  RabbitholeClient.startRabbithole(hydration, {
	    clock: window.__rabbitholeTest && window.__rabbitholeTest.autoTidyClock,
	    preferences: preferences,
	    snapshotHooks: {
	${liveSnapshotHoleHook}      getFrozenClientSource: function(){ return window.__RABBITHOLE_FROZEN_CLIENT__ || ""; },
	      getStylesheetText: function(){
	        var style = document.head && document.head.querySelector("style:first-of-type");
	        return style ? style.textContent : "";
	      }
	    }
	  });
	})();
</script>
`;
  return assembleRabbitholePage({ mode: "live", title, stylesheetText, bodyHtml });
}
