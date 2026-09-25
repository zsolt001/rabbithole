import { systemClock } from "../core/clock.js";
import { deriveSubtreeWorkflow, deriveWorkflowStatus } from "../core/hole/workflow.js";
import { iconSvg } from "../core/html/icons.js";
import { childrenOf, closed, frozen, nodes, postBrowserEvent, rootId, sessionPhase } from "./core.js";

export function workflowBadge(node, options = {}) {
  const status = deriveWorkflowStatus(node);
  const aggregate = deriveSubtreeWorkflow(node, nodes, childrenOf);
  const badge = document.createElement(options.tagName || "span");
  badge.className = "workflow-status workflow-status-" + status.id;
  badge.dataset.status = status.id;
  badge.textContent = workflowBadgeText(node, status, aggregate);
  badge.title = workflowSummary(node, aggregate);
  badge.setAttribute("aria-label", badge.title);
  return badge;
}

export function syncWorkflowBadge(badge, node) {
  if (!badge || !node) return;
  const status = deriveWorkflowStatus(node);
  const aggregate = deriveSubtreeWorkflow(node, nodes, childrenOf);
  badge.className = "workflow-status workflow-status-" + status.id;
  badge.dataset.status = status.id;
  badge.textContent = workflowBadgeText(node, status, aggregate);
  badge.title = workflowSummary(node, aggregate);
  badge.setAttribute("aria-label", badge.title);
}

function workflowBadgeText(node, status, aggregate) {
  const descendants = Math.max(0, aggregate.total - 1);
  const ownLabel = workflowDisplayLabel(node, status);
  if (!descendants) return ownLabel;
  const active =
    aggregate.counts.failed +
    aggregate.counts.queued +
    aggregate.counts.drawing +
    aggregate.counts.thinking +
    aggregate.counts.delegated +
    aggregate.counts.streaming;
  if (active) return ownLabel + " · " + active + " active";
  if (aggregate.counts["needs-review"]) return ownLabel + " · " + aggregate.counts["needs-review"] + " review";
  return ownLabel + " · " + descendants + " branches";
}

function workflowDisplayLabel(node, status) {
  if (node?.status === "answered") return status.shortLabel;
  const phase = sessionPhase();
  if (phase === "frozen") return "Unanswered";
  if (phase === "closed") return "Saved";
  if (phase === "away") return "Waiting";
  return status.shortLabel;
}

export function workflowSummary(node, aggregate = deriveSubtreeWorkflow(node, nodes, childrenOf)) {
  const status = deriveWorkflowStatus(node);
  const displayLabel = workflowDisplayLabel(node, status);
  const descendants = Math.max(0, aggregate.total - 1);
  if (!descendants) return "Status: " + displayLabel;
  const counts = Object.entries(aggregate.counts)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => count + " " + id.replace("-", " "))
    .join(", ");
  return "Status: " + displayLabel + ". Subtree: " + counts + ". Dominant: " + aggregate.dominant.label;
}

export function workflowMarkLabel(node) {
  const name = node?.title || node?.origin?.question || "Untitled";
  const status = deriveWorkflowStatus(node);
  return "Open branch: " + name + ", status " + workflowDisplayLabel(node, status);
}

export function canSetWorkflowDone(node) {
  return (
    !!node &&
    node.id !== rootId &&
    !frozen &&
    !closed &&
    node.status === "answered" &&
    deriveWorkflowStatus(node).id !== "note"
  );
}

export function setWorkflowDone(node, done) {
  if (!canSetWorkflowDone(node)) return Promise.resolve({ ok: false });
  return postBrowserEvent({
    type: "node_extensions_patch",
    node_id: node.id,
    namespace: "review",
    value: done ? { done_at: systemClock.now() } : {},
  });
}

export function workflowDoneButton(node, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "workflow-done-action";
  syncWorkflowDoneButton(button, node);
  button.addEventListener("click", function () {
    setWorkflowDone(node, deriveWorkflowStatus(node).id !== "done");
  });
  return button;
}

export function syncWorkflowDoneButton(button, node) {
  const done = deriveWorkflowStatus(node).id === "done";
  button.innerHTML = iconSvg("check", { size: 14 }) + "<span>" + (done ? "Mark not done" : "Mark done") + "</span>";
  button.setAttribute("aria-label", done ? "Mark this answer not done" : "Mark this answer done");
  button.title = button.getAttribute("aria-label");
}

export function refreshWorkflowSurfaces() {
  for (const node of Object.values(nodes)) {
    if (node.workflowEl) syncWorkflowBadge(node.workflowEl, node);
  }
  const marks = document.querySelectorAll("[data-child].rh-pdf-mark, mark[data-child]");
  for (const mark of /** @type {NodeListOf<HTMLElement | SVGElement>} */ (marks)) {
    const child = nodes[mark.dataset.child];
    if (child && mark.getAttribute("role") !== "group") mark.setAttribute("aria-label", workflowMarkLabel(child));
  }
}
