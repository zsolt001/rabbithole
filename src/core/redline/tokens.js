/** Split text into a lossless alternating stream of whitespace and non-whitespace runs. @param {string} text @returns {string[]} */
export function tokenizeWords(text) {
  return String(text ?? "").match(/\s+|\S+/g) || [];
}

const FENCE = /^(\s*)(`{3,}|~{3,})/;

/** Split markdown into top-level blocks on blank lines, keeping fenced code blocks whole. @param {string} markdown @returns {string[]} */
export function splitBlocks(markdown) {
  const lines = String(markdown ?? "").split("\n");
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  let current = [];
  let fenceMarker = null;
  const flush = () => {
    const text = current.join("\n").replace(/^\n+|\n+$/g, "").trim();
    if (text) blocks.push(text);
    current = [];
  };
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fenceMarker) {
      current.push(line);
      if (fence && line.trim().startsWith(fenceMarker)) fenceMarker = null;
      continue;
    }
    if (fence) {
      fenceMarker = fence[2];
      current.push(line);
      continue;
    }
    if (line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return blocks;
}
