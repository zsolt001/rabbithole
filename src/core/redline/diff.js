import { tokenizeWords } from "./tokens.js";

/** Longest-common-subsequence indices over two arrays compared by ===. */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  /** @type {Array<[number, number]>} */
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** @param {string[]} before @param {string[]} after */
export function diffTokens(before, after) {
  const pairs = lcs(before, after);
  /** @type {Array<{ type: "equal"|"insert"|"delete", tokens: string[] }>} */
  const runs = [];
  const push = (type, token) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.tokens.push(token);
    else runs.push({ type, tokens: [token] });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    while (i < pi) push("delete", before[i++]);
    while (j < pj) push("insert", after[j++]);
    push("equal", after[j]);
    i++; j++;
  }
  while (i < before.length) push("delete", before[i++]);
  while (j < after.length) push("insert", after[j++]);
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
