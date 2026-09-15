import ELK from "elkjs/lib/elk.bundled.js";
import { createCandidateShell, ensureCandidateStyles, nodeStatus, svgElement } from "./candidate-shell.js";

const elk = new ELK();
const NODE_WIDTH = 154;
const NODE_HEIGHT = 76;

function graphFor(presentation, direction) {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "SPLINES",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.spacing.nodeNode": direction === "RIGHT" ? "32" : "18",
      "elk.layered.spacing.nodeNodeBetweenLayers": direction === "RIGHT" ? "120" : "56",
      "elk.padding": "[top=18,left=18,bottom=18,right=18]",
    },
    children: presentation.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: presentation.edges.filter((edge) => edge.layout).map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  };
}

function pathFromSection(section) {
  const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
  if (points.length === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  return points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
}

function transientPath(edge, nodeLayouts) {
  const source = nodeLayouts.get(edge.from);
  const target = nodeLayouts.get(edge.to);
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const offset = Math.max(28, Math.abs(end.x - start.x) * 0.18);
  return `M${start.x},${start.y} C${start.x - offset},${start.y + offset} ${end.x + offset},${end.y + offset} ${end.x},${end.y}`;
}

function drawNode(layer, node, layoutNode) {
  const group = svgElement("g", { class: "elk-node", "data-node": node.id, transform: `translate(${layoutNode.x} ${layoutNode.y})`, tabindex: "0", role: "group", "aria-label": `${node.label}, ${node.type}` });
  group.appendChild(svgElement("rect", { width: layoutNode.width, height: layoutNode.height, rx: 13 }));
  const label = svgElement("text", { x: layoutNode.width / 2, y: 31, "text-anchor": "middle", class: "node-label" });
  label.textContent = node.label;
  const type = svgElement("text", { x: layoutNode.width / 2, y: 52, "text-anchor": "middle", class: "node-type" });
  type.textContent = node.type;
  const status = svgElement("circle", { cx: layoutNode.width - 15, cy: 15, r: 6, class: "node-status" });
  const count = svgElement("text", { x: layoutNode.width / 2, y: 67, "text-anchor": "middle", class: "node-count" });
  group.append(label, type, status, count);
  layer.appendChild(group);
}

function ensureStyles(container) {
  const style = document.createElement("style");
  style.textContent = `
    .elk-svg-candidate .trace-stage svg{display:block;width:100%;height:100%}.elk-svg-candidate .elk-edge{fill:none;stroke:var(--trace-line);stroke-width:2}.elk-svg-candidate .elk-edge.is-active{stroke:var(--trace-blue);stroke-width:3.5}.elk-svg-candidate .elk-edge.is-retry{stroke:var(--trace-pink);stroke-dasharray:9 7}.elk-svg-candidate .elk-node rect{fill:var(--trace-card);stroke:var(--trace-line);stroke-width:2;transition:fill .18s,stroke .18s}.elk-svg-candidate .elk-node .node-label{fill:var(--trace-text);font-size:14px;font-weight:650}.elk-svg-candidate .elk-node .node-type{fill:var(--trace-muted);font-size:11px}.elk-svg-candidate .elk-node .node-count{fill:var(--trace-blue);font-size:10px;font-weight:700}.elk-svg-candidate .elk-node .node-status{fill:var(--trace-line)}.elk-svg-candidate .elk-node[data-status=processing] rect{stroke:var(--trace-yellow)}.elk-svg-candidate .elk-node[data-status=processing] .node-status{fill:var(--trace-yellow)}.elk-svg-candidate .elk-node[data-status=failed] rect,.elk-svg-candidate .elk-node[data-status=timed-out] rect{stroke:var(--trace-red)}.elk-svg-candidate .elk-node[data-status=failed] .node-status,.elk-svg-candidate .elk-node[data-status=timed-out] .node-status{fill:var(--trace-red)}.elk-svg-candidate .elk-node[data-status=inactive]{opacity:.35}.elk-svg-candidate .elk-node[data-status=complete] .node-status{fill:var(--trace-blue)}.elk-svg-candidate .message-token{fill:var(--trace-blue);stroke:var(--trace-bg);stroke-width:3;filter:drop-shadow(0 2px 3px rgba(0,0,0,.2))}.elk-svg-candidate .message-token.is-retry{fill:var(--trace-pink)}
    @media(prefers-reduced-motion:reduce){.elk-svg-candidate *{transition:none!important}}
  `;
  container.appendChild(style);
}

export async function render(presentation, container, options = {}) {
  ensureCandidateStyles();
  const shell = createCandidateShell(container, presentation, { ...options, rendererClass: "elk-svg-candidate" });
  ensureStyles(container);
  const direction = options.width < 600 ? "DOWN" : "RIGHT";
  const started = performance.now();
  const layout = await elk.layout(graphFor(presentation, direction));
  const layoutMs = performance.now() - started;
  const svg = svgElement("svg", { viewBox: `0 0 ${layout.width} ${layout.height}`, role: "img", "aria-label": presentation.title, preserveAspectRatio: "xMidYMid meet" });
  const edgeLayer = svgElement("g", { class: "edge-layer" });
  const nodeLayer = svgElement("g", { class: "node-layer" });
  const token = svgElement("circle", { class: "message-token", r: 7, hidden: "" });
  const pathById = new Map();
  for (const edge of layout.edges || []) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const path = svgElement("path", { class: "elk-edge", "data-edge": edge.id, d: pathFromSection(section) });
    pathById.set(edge.id, path);
    edgeLayer.appendChild(path);
  }
  const nodeLayouts = new Map((layout.children || []).map((node) => [node.id, node]));
  for (const edge of presentation.edges.filter((edge) => !edge.layout)) {
    const path = svgElement("path", { class: "elk-edge transient-edge", "data-edge": edge.id, d: transientPath(edge, nodeLayouts) });
    pathById.set(edge.id, path);
    edgeLayer.appendChild(path);
  }
  for (const node of presentation.nodes) drawNode(nodeLayer, node, nodeLayouts.get(node.id));
  svg.append(edgeLayer, nodeLayer, token);
  shell.stage.appendChild(svg);

  function paint(frame, animate) {
    for (const edge of presentation.edges) {
      const path = pathById.get(edge.id);
      if (!path) continue;
      path.classList.toggle("is-active", frame.activeEdge === edge.id);
      path.classList.toggle("is-retry", frame.activeEdge === edge.id && frame.type === "retry");
    }
    for (const node of presentation.nodes) {
      const group = nodeLayer.querySelector(`[data-node="${CSS.escape(node.id)}"]`);
      const status = nodeStatus(frame, node);
      group.dataset.status = status;
      const count = frame.counts[node.id] || 0;
      group.querySelector(".node-count").textContent = count ? (node.type === "queue" ? `${count} buffered` : `${count} active`) : "";
    }
    const path = frame.activeEdge ? pathById.get(frame.activeEdge) : null;
    if (!path || !frame.movement) {
      token.setAttribute("hidden", "");
      return;
    }
    token.removeAttribute("hidden");
    token.classList.toggle("is-retry", frame.type === "retry");
    const length = path.getTotalLength();
    const destination = path.getPointAtLength(length);
    token.setAttribute("cx", String(destination.x));
    token.setAttribute("cy", String(destination.y));
    if (animate && token.animate) {
      const source = path.getPointAtLength(0);
      token.animate([
        { cx: source.x, cy: source.y, opacity: 0.4 },
        { cx: destination.x, cy: destination.y, opacity: 1 },
      ], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }
  shell.setPainter(paint);
  return {
    renderer: "elk-svg",
    layoutMs,
    setFrame: shell.setFrame,
    element: svg,
    serialize: () => new XMLSerializer().serializeToString(svg),
    destroy: shell.destroy,
  };
}
