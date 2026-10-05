import { changedSectionHeadings, normalizeHeading } from "../../core/redline/outline.js";
import { frozen } from "../core.js";
import { persistCanvasExtension } from "./pins.js";

// Outline width lives in node.view.outlineFraction, a share of the document's
// width, so the rail keeps its proportion between a small card and the wide
// expanded reader. (An earlier em-based outlineWidth is ignored and dropped.)
const OUTLINE_MIN_FRACTION = 0.08;
const OUTLINE_MAX_FRACTION = 0.5;
const OUTLINE_KEY_STEP = 0.02;

/** @param {HTMLElement} dc @param {any} node @returns {HTMLElement | null} */
export function buildOutlineRail(dc, node) {
  const headings = Array.from(dc.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter((el) => !el.closest(".rh-outline"));
  if (headings.length < 2) return null;
  const baseline = node.extensions && node.extensions.doc_edit && node.extensions.doc_edit.baseline_markdown;
  const changed = typeof baseline === "string" ? changedSectionHeadings(baseline, node.markdown || "") : new Set();

  const nav = document.createElement("nav");
  nav.className = "rh-outline";
  nav.setAttribute("aria-label", "Document outline");
  for (const heading of headings) {
    const key = normalizeHeading(heading.textContent);
    const item = document.createElement("a");
    item.className = "rh-outline-item rh-outline-l" + heading.tagName.slice(1);
    if (changed.has(key)) item.classList.add("rh-outline-changed");
    item.textContent = heading.textContent || "";
    item.href = "#";
    item.addEventListener("click", (e) => {
      e.preventDefault();
      heading.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    nav.appendChild(item);
  }

  // The pane is the sticky grid item; the nav scrolls inside it and the handle
  // rides its right edge without scrolling away with a long outline.
  const pane = document.createElement("div");
  pane.className = "rh-outline-pane";
  pane.appendChild(nav);
  pane.appendChild(buildResizeHandle(dc, node));
  const fraction = storedOutlineFraction(node);
  if (fraction != null) dc.style.setProperty("--rh-outline-w", toPercent(fraction));
  return pane;
}

function storedOutlineFraction(node) {
  const value = node.view && node.view.outlineFraction;
  return Number.isFinite(value) ? clampOutlineFraction(value) : null;
}

function clampOutlineFraction(fraction) {
  return Math.round(Math.min(OUTLINE_MAX_FRACTION, Math.max(OUTLINE_MIN_FRACTION, fraction)) * 1000) / 1000;
}

function toPercent(fraction) {
  return fraction * 100 + "%";
}

// Grid percentages resolve against the content box, so measure that.
function contentWidth(dc) {
  const style = getComputedStyle(dc);
  return dc.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0) || 1;
}

// Every live surface of this node (card body and reader) follows the drag.
function applyOutlineWidth(node, fraction) {
  const surfaces = document.querySelectorAll(".doc-content.rh-has-outline");
  for (let i = 0; i < surfaces.length; i++) {
    if (surfaces[i].dataset.nodeId !== node.id) continue;
    if (fraction == null) surfaces[i].style.removeProperty("--rh-outline-w");
    else surfaces[i].style.setProperty("--rh-outline-w", toPercent(fraction));
  }
}

function setOutlineFraction(node, fraction) {
  const view = { ...(node.view || {}) };
  delete view.outlineWidth;
  if (fraction == null) delete view.outlineFraction;
  else view.outlineFraction = fraction;
  node.view = view;
  applyOutlineWidth(node, fraction);
}

function buildResizeHandle(dc, node) {
  const handle = document.createElement("div");
  handle.className = "rh-outline-resize";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize outline");
  handle.title = "Drag to resize · double-click to reset";
  const commit = () => {
    if (!frozen) persistCanvasExtension(node);
  };
  const currentFraction = () => handle.parentElement.offsetWidth / contentWidth(dc);

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Canvas cards sit under a zoom transform; pointer deltas are screen px.
    const scale = dc.offsetWidth ? dc.getBoundingClientRect().width / dc.offsetWidth || 1 : 1;
    const startX = e.clientX;
    const startFraction = currentFraction();
    const widthPx = contentWidth(dc);
    handle.classList.add("is-dragging");
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_e) {}
    const move = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setOutlineFraction(node, clampOutlineFraction(startFraction + (ev.clientX - startX) / scale / widthPx));
    };
    const done = (ev) => {
      if (ev) ev.stopPropagation();
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", done, true);
      window.removeEventListener("pointercancel", done, true);
      handle.classList.remove("is-dragging");
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_e) {}
      commit();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", done, true);
    window.addEventListener("pointercancel", done, true);
  });
  handle.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOutlineFraction(node, null);
    commit();
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.key === "ArrowRight" ? OUTLINE_KEY_STEP : -OUTLINE_KEY_STEP;
    setOutlineFraction(node, clampOutlineFraction(currentFraction() + step));
    commit();
  });
  return handle;
}
