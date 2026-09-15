import cytoscape from "cytoscape";
import { createCandidateShell, ensureCandidateStyles, nodeStatus } from "./candidate-shell.js";

function elements(presentation, includeTransient = true) {
  return [
    ...presentation.nodes.map((node) => ({ data: { id: node.id, label: node.label, type: node.type, rank: node.rank } })),
    ...presentation.edges.filter((edge) => includeTransient || edge.layout).map((edge) => ({ data: { id: edge.id, source: edge.from, target: edge.to } })),
  ];
}

function styles() {
  return [
    { selector: "node", style: { "background-color": "#f7f7f8", "border-color": "#e5e5e7", "border-width": 2, color: "#171717", label: "data(label)", "font-size": 14, "font-weight": 600, width: 142, height: 66, shape: "round-rectangle", "text-valign": "center", "text-halign": "center", "text-wrap": "wrap", "text-max-width": 118 } },
    { selector: "edge", style: { width: 2, "line-color": "#e5e5e7", "curve-style": "bezier", "target-arrow-shape": "none" } },
    { selector: "edge.active", style: { width: 4, "line-color": "#315fbd" } },
    { selector: "edge.retry", style: { "line-color": "#d7659b", "line-style": "dashed" } },
    { selector: "node.processing", style: { "border-color": "#e8b934", "border-width": 4 } },
    { selector: "node.failed, node.timed-out", style: { "border-color": "#b42318", "border-width": 4 } },
    { selector: "node.complete", style: { "border-color": "#315fbd" } },
    { selector: "node.inactive", style: { opacity: 0.3 } },
    { selector: "node.counted", style: { "background-color": "#e9eef9", "border-color": "#315fbd" } },
  ];
}

function applyTheme(cy) {
  const css = getComputedStyle(document.documentElement);
  const value = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  cy.style()
    .selector("node").style({ "background-color": value("--trace-card", "#f7f7f8"), "border-color": value("--trace-line", "#e5e5e7"), color: value("--trace-text", "#171717") })
    .selector("edge").style({ "line-color": value("--trace-line", "#e5e5e7") })
    .selector("edge.active").style({ "line-color": value("--trace-blue", "#315fbd") })
    .selector("edge.retry").style({ "line-color": value("--trace-pink", "#d7659b") })
    .selector("node.processing").style({ "border-color": value("--trace-yellow", "#e8b934") })
    .selector("node.failed, node.timed-out").style({ "border-color": value("--trace-red", "#b42318") })
    .selector("node.complete").style({ "border-color": value("--trace-blue", "#315fbd") })
    .selector("node.counted").style({ "background-color": value("--trace-blue-soft", "#e9eef9"), "border-color": value("--trace-blue", "#315fbd") })
    .update();
}

export async function render(presentation, container, options = {}) {
  ensureCandidateStyles();
  const shell = createCandidateShell(container, presentation, { ...options, rendererClass: "cytoscape-candidate" });
  const graph = document.createElement("div");
  graph.className = "cytoscape-graph";
  graph.style.cssText = "position:absolute;inset:0";
  const token = document.createElement("div");
  token.className = "cytoscape-token";
  token.style.cssText = "position:absolute;width:14px;height:14px;border:3px solid var(--trace-bg);border-radius:50%;background:var(--trace-blue);box-shadow:0 2px 4px rgba(0,0,0,.22);transform:translate(-50%,-50%);pointer-events:none;opacity:0";
  shell.stage.append(graph, token);
  const cy = cytoscape({
    container: graph,
    elements: elements(presentation, false),
    style: styles(),
    userZoomingEnabled: false,
    userPanningEnabled: false,
    boxSelectionEnabled: false,
    autoungrabify: true,
    autounselectify: true,
    minZoom: 0.1,
    maxZoom: 2,
  });
  applyTheme(cy);
  const started = performance.now();
  const layout = cy.layout({
    name: "breadthfirst",
    directed: true,
    circle: false,
    grid: true,
    spacingFactor: options.width < 600 ? 0.72 : 1.15,
    roots: presentation.nodes.filter((node) => node.rank === 0).map((node) => `#${node.id}`).join(","),
    animate: false,
  });
  await new Promise((resolve) => {
    cy.one("layoutstop", resolve);
    layout.run();
  });
  cy.add(presentation.edges.filter((edge) => !edge.layout).map((edge) => ({ data: { id: edge.id, source: edge.from, target: edge.to } })));
  cy.fit(undefined, options.width < 600 ? 18 : 40);
  const layoutMs = performance.now() - started;

  function paint(frame, animate) {
    cy.batch(() => {
      cy.elements().removeClass("active retry processing failed timed-out complete inactive counted");
      if (frame.activeEdge) cy.getElementById(frame.activeEdge).addClass(`active${frame.type === "retry" ? " retry" : ""}`);
      for (const node of presentation.nodes) {
        const element = cy.getElementById(node.id);
        element.addClass(nodeStatus(frame, node));
        const count = frame.counts[node.id] || 0;
        if (count) element.addClass("counted");
        element.data("label", count ? `${node.label}\n${node.type === "queue" ? `${count} buffered` : `${count} active`}` : node.label);
      }
    });
    if (!frame.activeEdge || !frame.movement) {
      token.style.opacity = "0";
      return;
    }
    const edge = cy.getElementById(frame.activeEdge);
    const source = edge.source().renderedPosition();
    const destination = edge.target().renderedPosition();
    token.style.background = frame.type === "retry" ? "var(--trace-pink)" : "var(--trace-blue)";
    token.style.left = `${destination.x}px`;
    token.style.top = `${destination.y}px`;
    token.style.opacity = "1";
    if (animate && token.animate) token.animate([
      { left: `${source.x}px`, top: `${source.y}px`, opacity: 0.4 },
      { left: `${destination.x}px`, top: `${destination.y}px`, opacity: 1 },
    ], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  shell.setPainter(paint);
  return {
    renderer: "cytoscape",
    layoutMs,
    setFrame: shell.setFrame,
    element: graph,
    serialize: () => cy.png({ output: "base64uri", full: true, scale: 1 }),
    destroy() {
      cy.destroy();
      shell.destroy();
    },
  };
}
