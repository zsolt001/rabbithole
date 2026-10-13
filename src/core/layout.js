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

/**
 * Mind-map layout, the alternative to tidyTree's selections-right/follow-ups-
 * below grammar. Branch type is ignored: every child fans out horizontally from
 * its parent, siblings stack in order, and a parent is centered against the
 * block of its children. Each subtree reserves its own vertical band, so bands
 * never overlap whatever the depth. With `balanced`, the root's children split
 * across both sides (first half right, rest left) and the left side mirrors,
 * growing outward.
 * @param {LayoutNode} root
 * @param {{ childrenOf: ChildrenOf, effH?: EffectiveHeight | null, sort?: typeof nodeOrder, balanced?: boolean }} options
 */
export function mindMapTree(root, { childrenOf, effH = null, sort = nodeOrder, balanced = false }) {
  /** @type {Record<string, { x: number, y: number }>} */
  const positions = {};
  /** @type {Map<string, number>} */
  const extents = new Map();
  /** @param {LayoutNode} node */
  const heightOf = (node) => (typeof effH === "function" ? effH(node) : nodeH(node));
  /** @param {LayoutNode} node */
  const kidsOf = (node) => childrenOf(node.id).slice().sort(sort);
  /** @param {LayoutNode[]} siblings */
  function blockExtent(siblings) {
    if (!siblings.length) return 0;
    return siblings.reduce((sum, sibling) => sum + extent(sibling), 0) + TREE_STACK_GAP * (siblings.length - 1);
  }
  /** Vertical band a subtree needs: its own card or its children's block, whichever is taller. @param {LayoutNode} node @returns {number} */
  function extent(node) {
    let known = extents.get(node.id);
    if (known === undefined) {
      known = Math.max(heightOf(node), blockExtent(kidsOf(node)));
      extents.set(node.id, known);
    }
    return known;
  }
  /** @param {LayoutNode[]} siblings @param {number} anchorX @param {number} top @param {number} totalExtent @param {1 | -1} dir */
  function placeBlock(siblings, anchorX, top, totalExtent, dir) {
    let cursor = top + (totalExtent - blockExtent(siblings)) / 2;
    for (const sibling of siblings) {
      place(sibling, anchorX, cursor, dir);
      cursor += extent(sibling) + TREE_STACK_GAP;
    }
  }
  /** anchorX is the card's near edge: its left edge going right, its right edge going left. @param {LayoutNode} node @param {number} anchorX @param {number} top @param {1 | -1} dir */
  function place(node, anchorX, top, dir) {
    const w = nodeW(node);
    const x = dir > 0 ? anchorX : anchorX - w;
    positions[node.id] = { x, y: top + (extent(node) - heightOf(node)) / 2 };
    placeBlock(kidsOf(node), dir > 0 ? x + w + TREE_PARENT_GAP : x - TREE_PARENT_GAP, top, extent(node), dir);
  }

  /**
   * Fan a hub's children out on both sides: contiguous runs, the first filling the right until it holds half the total height.
   * The hub's left edge sits at x = 0. @param {LayoutNode} hub
   */
  function placeBalanced(hub) {
    const kids = kidsOf(hub);
    const total = kids.reduce((sum, kid) => sum + extent(kid), 0);
    const rightKids = [];
    const leftKids = [];
    let rightSum = 0;
    for (const kid of kids) {
      if (rightSum < total / 2) {
        rightKids.push(kid);
        rightSum += extent(kid);
      } else {
        leftKids.push(kid);
      }
    }
    const hubExtent = Math.max(heightOf(hub), blockExtent(rightKids), blockExtent(leftKids));
    extents.set(hub.id, hubExtent);
    const w = nodeW(hub);
    positions[hub.id] = { x: 0, y: (hubExtent - heightOf(hub)) / 2 };
    placeBlock(rightKids, w + TREE_PARENT_GAP, 0, hubExtent, 1);
    placeBlock(leftKids, -TREE_PARENT_GAP, 0, hubExtent, -1);
  }

  // A root with a single child (a trunk) has nothing to split, so the fan-out
  // happens at the first node that branches; the trunk stacks above it.
  let placed = false;
  if (balanced) {
    /** @type {LayoutNode[]} */
    const trunk = [];
    let cursor = root;
    for (let kids = kidsOf(cursor); kids.length === 1; kids = kidsOf(cursor)) {
      trunk.push(cursor);
      cursor = /** @type {LayoutNode} */ (kids[0]);
    }
    if (kidsOf(cursor).length >= 2 && trunk.length) {
      placeBalanced(cursor);
      let y = /** @type {{ y: number }} */ (positions[cursor.id]).y;
      const centerX = nodeW(cursor) / 2;
      for (const ancestor of trunk.reverse()) {
        y -= TREE_PARENT_GAP + heightOf(ancestor);
        positions[ancestor.id] = { x: centerX - nodeW(ancestor) / 2, y };
      }
      placed = true;
    }
  }
  if (placed) {
    // The trunk and hub are already positioned.
  } else if (balanced) {
    placeBalanced(root);
  } else {
    place(root, 0, 0, 1);
  }
  // The explicit tidy contract roots the layout at the origin.
  const rootPosition = positions[root.id];
  if (rootPosition && (rootPosition.x !== 0 || rootPosition.y !== 0)) {
    const { x: dx, y: dy } = rootPosition;
    for (const position of Object.values(positions)) {
      position.x -= dx;
      position.y -= dy;
    }
  }
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
