let visualBaseCss = "";
let checkCss = "";
let mermaidCss = "";
let chartCss = "";
let traceCss = "";

export function setVisualStyles(styles) {
  visualBaseCss = styles.visualBaseCss || "";
  checkCss = styles.checkCss || "";
  mermaidCss = styles.mermaidCss || "";
  chartCss = styles.chartCss || "";
  traceCss = styles.traceCss || "";
}

export function visualStylesFor(type) {
  if (type === "check") return visualBaseCss + checkCss;
  if (type === "mermaid") return visualBaseCss + mermaidCss;
  if (type === "chart") return visualBaseCss + chartCss;
  if (type === "trace" || type === "sim") return visualBaseCss + traceCss;
  return visualBaseCss;
}
