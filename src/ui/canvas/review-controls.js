import { isReviewedDocument } from "../../core/hole/ask.js";
import { currentNodeId, frozen, mode, nodes, readerMain } from "../core.js";
import { renderReaderBody } from "../reader.js";
import { fillBody } from "./document.js";
import { persistCanvasExtension } from "./pins.js";

/*
 * Review-view state (redline mode + outline) for a reviewed document, shared by
 * the three surfaces that switch it: the card-head pill, the reader strip, and
 * the card menu. Each mutator persists node.view and refreshes whatever surfaces
 * are live, so the pill, the reader controls, and the menu labels never disagree.
 */

export const REVIEW_MODES = ["marked", "clean", "original"];

const MODE_LABEL = { marked: "Marked-up", clean: "Clean", original: "Original" };

export function reviewMode(node) {
  return (node.view && node.view.reviewMode) || "marked";
}

export function reviewModeLabel(node) {
  return MODE_LABEL[reviewMode(node)] || MODE_LABEL.marked;
}

export function outlineOn(node) {
  return !!(node.view && node.view.outline);
}

export function setReviewMode(node, next) {
  if (!REVIEW_MODES.includes(next) || next === reviewMode(node)) return;
  node.view = { ...(node.view || {}), reviewMode: next };
  commitReviewChange(node);
}

export function cycleReviewMode(node) {
  const cur = reviewMode(node);
  setReviewMode(node, REVIEW_MODES[(REVIEW_MODES.indexOf(cur) + 1) % REVIEW_MODES.length]);
}

export function toggleOutline(node) {
  node.view = { ...(node.view || {}), outline: !outlineOn(node) };
  commitReviewChange(node);
}

function commitReviewChange(node) {
  if (!frozen) persistCanvasExtension(node);
  refreshReviewSurfaces(node);
}

// Re-render whichever surfaces show this node. fillBody re-syncs the card-head
// pill; renderReaderBody rebuilds the reader strip with the new active state.
function refreshReviewSurfaces(node) {
  if (node.bodyEl) fillBody(node);
  if (mode === "reader" && currentNodeId === node.id) {
    // Toggling swaps the body under the reader; keep the reader where it was
    // (renderReaderBody restores node._scrollTop at the end).
    if (readerMain) node._scrollTop = readerMain.scrollTop;
    renderReaderBody();
  }
}

// --- Card-head pill --------------------------------------------------------

export function buildReviewPill(node) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "review-pill";
  pill.addEventListener("click", function (e) {
    e.stopPropagation();
    cycleReviewMode(node);
  });
  node.reviewPillEl = pill;
  syncReviewPill(node);
  return pill;
}

export function syncReviewPill(node) {
  const el = node && node.reviewPillEl;
  if (!el) return;
  const reviewed = isReviewedDocument(node);
  el.style.display = reviewed ? "" : "none";
  if (!reviewed) return;
  el.dataset.mode = reviewMode(node);
  el.textContent = reviewModeLabel(node);
  el.title = "Review view: " + reviewModeLabel(node) + " — click to change";
  el.setAttribute("aria-label", el.title);
}

// --- Reader control strip --------------------------------------------------

export function buildReaderReviewStrip(node) {
  if (!isReviewedDocument(node)) return null;
  const strip = document.createElement("div");
  strip.className = "reader-review-strip";

  const seg = document.createElement("div");
  seg.className = "rrs-seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Review view");
  const cur = reviewMode(node);
  for (const m of REVIEW_MODES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rrs-seg-btn" + (m === cur ? " is-active" : "");
    b.textContent = MODE_LABEL[m];
    b.setAttribute("aria-pressed", m === cur ? "true" : "false");
    b.addEventListener("click", function () {
      setReviewMode(node, m);
    });
    seg.appendChild(b);
  }
  strip.appendChild(seg);

  const outline = document.createElement("button");
  outline.type = "button";
  outline.className = "rrs-outline" + (outlineOn(node) ? " is-active" : "");
  outline.textContent = "Outline";
  outline.setAttribute("aria-pressed", outlineOn(node) ? "true" : "false");
  outline.title = outlineOn(node) ? "Hide the section outline" : "Show the section outline";
  outline.addEventListener("click", function () {
    toggleOutline(node);
  });
  strip.appendChild(outline);

  return strip;
}
