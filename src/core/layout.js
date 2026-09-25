import { BRANCH_FOLLOWUP, BRANCH_SELECTION, branchTypeOfNode } from "./hole/ask.js";

/** @typedef {Omit<import("./contracts/engine.js").HoleNode, "origin"> & { origin?: { branch_type?: unknown, selected_text?: unknown } | null } & Record<string, any>} LayoutNode */
/** @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds */
/** @typedef {(nodeId: string) => LayoutNode[]} ChildrenOf */
/** @typedef {(node: LayoutNode) => number} EffectiveHeight */

export const DEFAULT_ROOT = Object.freeze({ w: 480, h: 580 });
export const DEFAULT_CHILD = Object.freeze({ w: 420, h: 460 });
export const DEFAULT_STANDALONE_NOTE = Object.freeze({ w: 300, h: 180 });
export const TREE_PARENT_GAP = 70;
export const TREE_STACK_GAP = 30;

/** @param {LayoutNode} a @param {LayoutNode} b */
export function nodeOrder(a, b) {
  return ((a?._order || 0) - (b?._order || 0)) || String(a?.id || "").localeCompare(String(b?.id || ""));
}

/** @param {LayoutNode | null | undefined} node */
function nodeX(node) {
  return Number(node?.position?.x) || 0;
}

/** @param {LayoutNode | null | undefined} node */
function nodeY(node) {
  return Number(node?.position?.y) || 0;
}

/** @param {LayoutNode | null | undefined} node @param {number} [fallback] */
function nodeW(node, fallback = DEFAULT_CHILD.w) {
  return Number(node?.size?.w) || fallback;
}

/** @param {LayoutNode | null | undefined} node @param {number} [fallback] */
function nodeH(node, fallback = DEFAULT_CHILD.h) {
  return Number(node?.size?.h) || fallback;
}

/** @param {LayoutNode} node @param {{ effH?: EffectiveHeight | null }} [options] @returns {Bounds} */
export function nodeBounds(node, { effH = null } = {}) {
  const x = nodeX(node);
  const y = nodeY(node);
  const w = nodeW(node);
  const h = typeof effH === "function" ? effH(node) : nodeH(node);
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

/**
 * @overload
 * @param {Bounds} a
 * @param {Bounds | null | undefined} b
 * @returns {Bounds}
 */
/**
 * @overload
 * @param {Bounds | null | undefined} a
 * @param {Bounds} b
 * @returns {Bounds}
 */
/** @param {Bounds | null | undefined} a @param {Bounds | null | undefined} b @returns {Bounds | null | undefined} */
export function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** @param {Bounds} bounds @param {number} dx @param {number} dy */
export function shiftBounds(bounds, dx, dy) {
  return {
    minX: bounds.minX + dx,
    minY: bounds.minY + dy,
    maxX: bounds.maxX + dx,
    maxY: bounds.maxY + dy,
  };
}

/** @param {Bounds | null | undefined} a @param {Bounds | null | undefined} b */
export function boundsOverlap(a, b) {
  return !!(a && b && a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY);
}

/** @param {Bounds} a @param {Bounds} b */
function overlapArea(a, b) {
  return Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
    * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b @param {{ x: number, y: number }} c @param {{ x: number, y: number }} d */
function segmentsCross(a, b, c, d) {
  /** @param {{ x: number, y: number }} p @param {{ x: number, y: number }} q @param {{ x: number, y: number }} r */
  function turn(p, q, r) {
    return Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  }
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

/** @param {Bounds} bounds */
function center(bounds) {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** @param {LayoutNode} node @param {{ childrenOf?: ChildrenOf, effH?: EffectiveHeight | null, sort?: typeof nodeOrder }} [options] @returns {Bounds} */
export function subtreeBounds(node, { childrenOf, effH = null, sort = nodeOrder } = {}) {
  let bounds = nodeBounds(node, { effH });
  if (!node?.collapsed && typeof childrenOf === "function") {
    for (const child of childrenOf(node.id).sort(sort)) {
      bounds = unionBounds(bounds, subtreeBounds(child, { childrenOf, effH, sort }));
    }
  }
  return bounds;
}

/**
 * Pick a new card position without disturbing the existing arrangement.
 * placedNodes is deliberately supplied by the host so hidden/docked cards can
 * be excluded without teaching core layout about presentation state.
 * @param {LayoutNode} parent
 * @param {unknown} branchType
 * @param {{ childrenOf?: ChildrenOf, placedNodes?: LayoutNode[], effH?: EffectiveHeight | null, sort?: typeof nodeOrder, childSize?: { w: number, h: number } }} [options]
 */
export function placeChild(parent, branchType, { childrenOf, placedNodes = [], effH = null, sort = nodeOrder, childSize = DEFAULT_CHILD } = {}) {
  const type = branchType === BRANCH_SELECTION ? BRANCH_SELECTION : BRANCH_FOLLOWUP;
  const parentX = nodeX(parent);
  const parentY = nodeY(parent);
  const parentW = nodeW(parent);
  const parentH = typeof effH === "function" ? effH(parent) : nodeH(parent);
  const preferred = type === BRANCH_SELECTION
    ? { x: parentX + parentW + TREE_PARENT_GAP, y: parentY }
    : { x: parentX, y: parentY + parentH + TREE_PARENT_GAP };
  const ordered = placedNodes.filter((node) => node && node.id !== parent.id).slice().sort(sort);
  const placedIds = new Set([parent.id, ...ordered.map((node) => node.id)]);
  const blockers = ordered.map((node) => nodeBounds(node, { effH }));
  const xs = new Set([preferred.x]);
  const ys = new Set([preferred.y]);
  for (const blocker of blockers) {
    xs.add(blocker.maxX + TREE_STACK_GAP);
    xs.add(blocker.minX - childSize.w - TREE_STACK_GAP);
    ys.add(blocker.maxY + TREE_STACK_GAP);
    ys.add(blocker.minY - childSize.h - TREE_STACK_GAP);
  }
  /** @type {[{ x: number, y: number }, { x: number, y: number }][]} */
  const edges = [];
  if (typeof childrenOf === "function") {
    for (const node of [parent, ...ordered]) {
      const from = center(nodeBounds(node, { effH }));
      for (const child of childrenOf(node.id).slice().sort(sort)) {
        if (!child || child.id === parent.id || !placedIds.has(child.id)) continue;
        edges.push([from, center(nodeBounds(child, { effH }))]);
      }
    }
  }
  const parentCenter = center(nodeBounds(parent, { effH }));
  /** @type {{ x: number, y: number, key: number[] } | null} */
  let best = null;
  for (const x of xs) {
    for (const y of ys) {
      const bounds = { minX: x, minY: y, maxX: x + childSize.w, maxY: y + childSize.h };
      const target = center(bounds);
      let overlap = 0;
      for (const blocker of blockers) overlap += overlapArea(bounds, blocker);
      let crossings = 0;
      for (const [edgeStart, edgeEnd] of edges) if (segmentsCross(parentCenter, target, edgeStart, edgeEnd)) crossings += 1;
      const distance = Math.abs(x - preferred.x) + Math.abs(y - preferred.y);
      const wrongDirection = type === BRANCH_SELECTION
        ? Math.max(0, preferred.x - x)
        : Math.max(0, preferred.y - y);
      const reverseReadingDirection = type === BRANCH_SELECTION
        ? Math.max(0, preferred.y - y)
        : Math.max(0, preferred.x - x);
      const key = [overlap > 0 ? 1 : 0, overlap, crossings, wrongDirection, reverseReadingDirection, distance, y, x];
      if (!best || compareNumberKeys(key, best.key) < 0) {
        best = { x, y, key };
      }
    }
  }
  return best ? { x: best.x, y: best.y } : preferred;
}

/**
 * Deterministic tree layout that preserves Rabbithole's branch grammar:
 * selections grow right, follow-ups grow below. Subtree bounds reserve enough
 * room that the two lanes never overlap.
 * @param {LayoutNode} root
 * @param {{ childrenOf: ChildrenOf, effH?: EffectiveHeight | null, sort?: typeof nodeOrder }} options
 */
export function tidyTree(root, { childrenOf, effH = null, sort = nodeOrder }) {
  /** @type {Record<string, { x: number, y: number }>} */
  const positions = {};
  /** @param {LayoutNode} node @param {number} dx @param {number} dy */
  function moveSubtree(node, dx, dy) {
    const position = positions[node.id];
    if (!position) return;
    position.x += dx;
    position.y += dy;
    for (const child of childrenOf(node.id).slice().sort(sort)) moveSubtree(child, dx, dy);
  }
  /** @param {LayoutNode} node @param {number} x @param {number} y @returns {Bounds} */
  function place(node, x, y) {
    positions[node.id] = { x, y };
    let bounds = { minX: x, minY: y, maxX: x + nodeW(node), maxY: y + (typeof effH === "function" ? effH(node) : nodeH(node)) };
    const kids = childrenOf(node.id).slice().sort(sort);
    const selections = kids.filter((child) => branchTypeOfNode(child) === BRANCH_SELECTION);
    const followups = kids.filter((child) => branchTypeOfNode(child) !== BRANCH_SELECTION);
    let sideBounds = null;
    let sideY = y;
    const sideX = x + nodeW(node) + TREE_PARENT_GAP;
    for (const child of selections) {
      const childBounds = place(child, sideX, sideY);
      sideBounds = unionBounds(sideBounds, childBounds);
      bounds = unionBounds(bounds, childBounds);
      sideY = childBounds.maxY + TREE_STACK_GAP;
    }
    let belowY = y + (typeof effH === "function" ? effH(node) : nodeH(node)) + TREE_PARENT_GAP;
    for (const child of followups) {
      let childBounds = place(child, x, belowY);
      if (sideBounds && boundsOverlap(childBounds, sideBounds)) {
        const dy = sideBounds.maxY + TREE_STACK_GAP - childBounds.minY;
        moveSubtree(child, 0, dy);
        childBounds = shiftBounds(childBounds, 0, dy);
      }
      bounds = unionBounds(bounds, childBounds);
      belowY = childBounds.maxY + TREE_STACK_GAP;
    }
    return bounds;
  }
  place(root, 0, 0);
  return positions;
}

/** @param {number[]} a @param {number[]} b */
function compareNumberKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    const left = a[i] ?? 0;
    const right = Number(b[i] ?? 0);
    if (left !== right) return left - right;
  }
  return 0;
}
