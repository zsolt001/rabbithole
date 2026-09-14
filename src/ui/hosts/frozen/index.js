import { snapshotProjectionToFrozenHydration } from "../../../core/snapshot-projection.js";
import chartCss from "../../../design/document/chart.css";
import checkCss from "../../../design/document/check.css";
import mermaidCss from "../../../design/document/mermaid.css";
import traceCss from "../../../design/document/trace.css";
import visualBaseCss from "../../../design/document/visual-base.css";
import { createRabbitholeUi } from "../../composition.js";
import { mountPdfView } from "../../pdf-view.js";
import { setVisualStyles } from "../../visual-style-runtime.js";

function startRabbithole(hydration) {
  setVisualStyles({ visualBaseCss, checkCss, mermaidCss, chartCss, traceCss });
  return createRabbitholeUi({
    hydration: hydration,
    capabilities: { exportSnapshot: null, exportPortable: null, mountPdfView: mountPdfView },
  });
}

export function startPortableSnapshot(projection) {
  return startRabbithole(snapshotProjectionToFrozenHydration(projection));
}
