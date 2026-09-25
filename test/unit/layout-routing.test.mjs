/** @protects shared card placement, tidy layout, and connector routing. */
import assert from "node:assert/strict";
import { BRANCH_FOLLOWUP, BRANCH_SELECTION } from "../../src/core/hole/ask.js";
import { roundedOrthogonalPath, routeConnector } from "../../src/core/edge-routing.js";
import { boundsOverlap, nodeBounds, placeChild, tidyTree } from "../../src/core/layout.js";

function node(id, parentId, x, y, w = 100, h = 80, order = 0) {
  return { id, parent_id: parentId, position: { x, y }, size: { w, h }, _order: order };
}

const root = node("root", null, 0, 0);
const unrelated = node("unrelated", null, 170, 0, 100, 80, 1);
const selection = placeChild(root, BRANCH_SELECTION, {
  placedNodes: [root, unrelated],
  childSize: { w: 100, h: 80 },
});
assert.deepEqual(selection, { x: 170, y: 110 }, "selection keeps the preferred right column and clears unrelated cards");
assert.equal(
  boundsOverlap({ minX: selection.x, minY: selection.y, maxX: selection.x + 100, maxY: selection.y + 80 }, nodeBounds(unrelated)),
  false,
);

const belowBlocker = node("below", null, 0, 150, 100, 80, 2);
const followup = placeChild(root, BRANCH_FOLLOWUP, {
  placedNodes: [root, belowBlocker],
  childSize: { w: 100, h: 80 },
});
assert.deepEqual(followup, { x: 0, y: 260 }, "follow-up stays below the parent and clears an unrelated card");
assert.deepEqual(
  placeChild(root, BRANCH_FOLLOWUP, { placedNodes: [belowBlocker, root], childSize: { w: 100, h: 80 } }),
  followup,
  "placement is independent of host collection order",
);

const tree = {
  root: node("root", null, 30, 40, 120, 90),
  a: node("a", "root", 900, 900, 80, 120, 1),
  b: node("b", "root", -500, 300, 140, 60, 2),
  a1: node("a1", "a", 12, 12, 110, 70, 3),
};
tree.a.origin = { branch_type: BRANCH_SELECTION };
tree.b.origin = { branch_type: BRANCH_FOLLOWUP };
tree.a1.origin = { branch_type: BRANCH_FOLLOWUP };
const childrenOf = (id) => Object.values(tree).filter((candidate) => candidate.parent_id === id);
const first = tidyTree(tree.root, { childrenOf });
const second = tidyTree(tree.root, { childrenOf });
assert.deepEqual(first, second, "tidy output is deterministic");
assert.deepEqual(first.root, { x: 0, y: 0 }, "tree remains rooted at the origin expected by explicit tidy");
const laidOut = Object.entries(first).map(([id, position]) => ({ ...tree[id], position }));
for (let i = 0; i < laidOut.length; i++) {
  for (let j = i + 1; j < laidOut.length; j++) {
    assert.equal(boundsOverlap(nodeBounds(laidOut[i]), nodeBounds(laidOut[j])), false, laidOut[i].id + " overlaps " + laidOut[j].id);
  }
}
assert.ok(first.a.y < first.b.y, "stable node order controls sibling order");
assert.ok(first.a.x > first.root.x, "selection branches keep the right-hand lane");
assert.equal(first.b.x, first.root.x, "follow-up branches keep the below-parent lane");
assert.ok(first.b.y > first.root.y, "follow-up branches sit below their parent");

const obstacle = { minX: 90, minY: -20, maxX: 130, maxY: 20 };
const route = routeConnector({ x: 0, y: 0 }, { x: 220, y: 0 }, { obstacles: [obstacle] });
assert.deepEqual(route[0], { x: 0, y: 0 });
assert.deepEqual(route[route.length - 1], { x: 220, y: 0 });
assert.ok(route.some((point) => Math.abs(point.y) >= 38), "route clears an unrelated card with deterministic clearance");
assert.deepEqual(
  routeConnector({ x: 0, y: 0 }, { x: 220, y: 0 }, { obstacles: [obstacle] }),
  route,
  "routing is deterministic",
);
const path = roundedOrthogonalPath(route);
assert.match(path, /^M 0 0/);
assert.match(path, /Q /, "orthogonal corners are rounded");
assert.match(path, /L 220 0$/, "the exact endpoint is preserved");

console.log("layout-routing unit contracts ok");
