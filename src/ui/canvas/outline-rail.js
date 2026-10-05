import { changedSectionHeadings, normalizeHeading } from "../../core/redline/outline.js";
import { frozen } from "../core.js";
import { persistCanvasExtension } from "./pins.js";

// Outline width lives in node.view.outlineWidth, in em of the document's own
// font size, so a card and its expanded reader share one width at any zoom.
const OUTLINE_MIN_EM = 6;
const OUTLINE_MAX_EM = 32;
const OUTLINE_KEY_STEP_EM = 1;

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
  const width = storedOutlineWidth(node);
  if (width != null) dc.style.setProperty("--rh-outline-w", width + "em");
  return pane;
}

function storedOutlineWidth(node) {
  const value = node.view && node.view.outlineWidth;
  return Number.isFinite(value) ? clampOutlineWidth(value) : null;
}

function clampOutlineWidth(em) {
  return Math.round(Math.min(OUTLINE_MAX_EM, Math.max(OUTLINE_MIN_EM, em)) * 10) / 10;
}

// Every live surface of this node (card body and reader) follows the drag.
function applyOutlineWidth(node, em) {
  const surfaces = document.querySelectorAll(".doc-content.rh-has-outline");
  for (let i = 0; i < surfaces.length; i++) {
    if (surfaces[i].dataset.nodeId !== node.id) continue;
    if (em == null) surfaces[i].style.removeProperty("--rh-outline-w");
    else surfaces[i].style.setProperty("--rh-outline-w", em + "em");
  }
}

function setOutlineWidth(node, em) {
  const view = { ...(node.view || {}) };
  if (em == null) delete view.outlineWidth;
  else view.outlineWidth = em;
  node.view = view;
  applyOutlineWidth(node, em);
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
  const currentEm = () => {
    const fontPx = parseFloat(getComputedStyle(dc).fontSize) || 16;
    return handle.parentElement.offsetWidth / fontPx;
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Canvas cards sit under a zoom transform; pointer deltas are screen px.
    const scale = dc.offsetWidth ? dc.getBoundingClientRect().width / dc.offsetWidth || 1 : 1;
    const fontPx = parseFloat(getComputedStyle(dc).fontSize) || 16;
    const startX = e.clientX;
    const startEm = currentEm();
    handle.classList.add("is-dragging");
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_e) {}
    const move = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setOutlineWidth(node, clampOutlineWidth(startEm + (ev.clientX - startX) / scale / fontPx));
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
    setOutlineWidth(node, null);
    commit();
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.key === "ArrowRight" ? OUTLINE_KEY_STEP_EM : -OUTLINE_KEY_STEP_EM;
    setOutlineWidth(node, clampOutlineWidth(currentEm() + step));
    commit();
  });
  return handle;
}
