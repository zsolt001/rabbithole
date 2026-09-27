import { changedSectionHeadings, normalizeHeading } from "../../core/redline/outline.js";

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
  return nav;
}
