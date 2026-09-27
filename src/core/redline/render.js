import { splitBlocks } from "./tokens.js";
import { diffBlocks, diffWords } from "./diff.js";

const INS_OPEN = "\u0001";
const INS_CLOSE = "\u0002";
const DEL_OPEN = "\u0003";
const DEL_CLOSE = "\u0004";

const SENTINELS = new RegExp("[" + INS_OPEN + INS_CLOSE + DEL_OPEN + DEL_CLOSE + "]", "g");

/**
 * Render word-level redlines of `current` against `baseline` to HTML.
 * @param {string} baseline @param {string} current @param {(markdown: string) => string} renderMarkdown
 * @returns {string}
 */
export function renderRedlineHtml(baseline, current, renderMarkdown) {
  // Strip the internal sentinel chars from raw input so document content that
  // literally contains them can never be mistaken for ins/del markers after
  // substituteSentinels.
  baseline = String(baseline ?? "").replace(SENTINELS, "");
  current = String(current ?? "").replace(SENTINELS, "");
  const ops = diffBlocks(splitBlocks(baseline), splitBlocks(current));
  let html = "";
  for (const op of ops) {
    if (op.type === "equal") html += renderMarkdown(op.after ?? "");
    else if (op.type === "insert") html += `<div class="rh-ins-block">${renderMarkdown(op.after ?? "")}</div>`;
    else if (op.type === "delete") html += `<div class="rh-del-block">${renderMarkdown(op.before ?? "")}</div>`;
    else html += renderMarkdown(wrapWordRuns(op.before ?? "", op.after ?? ""));
  }
  return substituteSentinels(html);
}

/** @param {string} before @param {string} after */
function wrapWordRuns(before, after) {
  let out = "";
  for (const run of diffWords(before, after)) {
    if (run.type === "insert") out += INS_OPEN + run.text + INS_CLOSE;
    else if (run.type === "delete") out += DEL_OPEN + run.text + DEL_CLOSE;
    else out += run.text;
  }
  return out;
}

/** @param {string} html */
function substituteSentinels(html) {
  return html
    .split(INS_OPEN).join('<ins class="rh-ins">')
    .split(INS_CLOSE).join("</ins>")
    .split(DEL_OPEN).join('<del class="rh-del">')
    .split(DEL_CLOSE).join("</del>");
}
