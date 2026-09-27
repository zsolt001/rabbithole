// src/core/redline/outline.js

const FENCE = /^(\s*)(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

/** @param {string} markdown @returns {Array<{ level: number, text: string, index: number }>} */
export function buildOutline(markdown) {
  const out = [];
  let inFence = false;
  let index = 0;
  for (const line of String(markdown ?? "").split("\n")) {
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (m) out.push({ level: String(m[1]).length, text: String(m[2]).trim(), index: index++ });
  }
  return out;
}

/** @param {string} text */
function normalizeHeading(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split markdown into { heading -> section body } by ATX heading lines. @param {string} markdown */
function sectionsByHeading(markdown) {
  /** @type {Map<string, string>} */
  const sections = new Map();
  /** @type {string | null} */
  let key = null;
  /** @type {string[]} */
  let body = [];
  let inFence = false;
  const flush = () => { if (key !== null) sections.set(key, body.join("\n").trim()); };
  for (const line of String(markdown ?? "").split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (m) { flush(); key = normalizeHeading(String(m[2])); body = []; }
    else if (key !== null) body.push(line);
  }
  flush();
  return sections;
}

/** @param {string} baseline @param {string} current @returns {Set<string>} */
export function changedSectionHeadings(baseline, current) {
  /** @type {Set<string>} */
  const changed = new Set();
  if (!String(baseline ?? "").trim()) return changed;
  const before = sectionsByHeading(baseline);
  const after = sectionsByHeading(current);
  for (const [key, body] of after) {
    if (!before.has(key) || before.get(key) !== body) changed.add(key);
  }
  return changed;
}
