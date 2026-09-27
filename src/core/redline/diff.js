import { tokenizeWords } from "./tokens.js";

/**
 * Longest-common-subsequence indices over two arrays compared by ===.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<[number, number]>}
 */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const cur = /** @type {Uint32Array} */ (dp[i]);
    const nxt = /** @type {Uint32Array} */ (dp[i + 1]);
    for (let j = m - 1; j >= 0; j--) {
      cur[j] = a[i] === b[j] ? (nxt[j + 1] ?? 0) + 1 : Math.max(nxt[j] ?? 0, cur[j + 1] ?? 0);
    }
  }
  /** @type {Array<[number, number]>} */
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else {
      const cur = /** @type {Uint32Array} */ (dp[i]);
      const nxt = /** @type {Uint32Array} */ (dp[i + 1]);
      if ((nxt[j] ?? 0) >= (cur[j + 1] ?? 0)) i++;
      else j++;
    }
  }
  return pairs;
}

/** @param {string[]} before @param {string[]} after */
export function diffTokens(before, after) {
  const pairs = lcs(before, after);
  /** @type {Array<{ type: "equal"|"insert"|"delete", tokens: string[] }>} */
  const runs = [];
  /** @param {"equal"|"insert"|"delete"} type @param {string} token */
  const push = (type, token) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.tokens.push(token);
    else runs.push({ type, tokens: [token] });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    while (i < pi) push("delete", String(before[i++]));
    while (j < pj) push("insert", String(after[j++]));
    push("equal", String(after[j]));
    i++; j++;
  }
  while (i < before.length) push("delete", String(before[i++]));
  while (j < after.length) push("insert", String(after[j++]));
  return runs;
}

/** @param {string} before @param {string} after */
export function diffWords(before, after) {
  return diffTokens(tokenizeWords(before), tokenizeWords(after))
    .map((run) => ({ type: run.type, text: run.tokens.join("") }));
}

/** @param {string[]} beforeBlocks @param {string[]} afterBlocks */
export function diffBlocks(beforeBlocks, afterBlocks) {
  const pairs = lcs(beforeBlocks, afterBlocks);
  /** @type {Array<{ type: "equal"|"insert"|"delete"|"change", before?: string, after?: string }>} */
  const ops = [];
  /** @param {number} bStart @param {number} bEnd @param {number} aStart @param {number} aEnd */
  const emitGap = (bStart, bEnd, aStart, aEnd) => {
    const bGap = beforeBlocks.slice(bStart, bEnd);
    const aGap = afterBlocks.slice(aStart, aEnd);
    const count = Math.max(bGap.length, aGap.length);
    for (let k = 0; k < count; k++) {
      const b = bGap[k];
      const a = aGap[k];
      if (b !== undefined && a !== undefined) ops.push({ type: "change", before: b, after: a });
      else if (a !== undefined) ops.push({ type: "insert", after: a });
      else ops.push({ type: "delete", before: b });
    }
  };
  let bi = 0;
  let ai = 0;
  for (const [pb, pa] of pairs) {
    emitGap(bi, pb, ai, pa);
    ops.push({ type: "equal", after: afterBlocks[pa] });
    bi = pb + 1;
    ai = pa + 1;
  }
  emitGap(bi, beforeBlocks.length, ai, afterBlocks.length);
  return ops;
}
