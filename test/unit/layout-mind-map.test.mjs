/** @protects the mind-map tidy layouts: horizontal fan-out, centered parents, balanced sides. */
import assert from "node:assert/strict";
import { BRANCH_FOLLOWUP, BRANCH_SELECTION } from "../../src/core/hole/ask.js";
import { boundsOverlap, mindMapTree, nodeBounds, TREE_PARENT_GAP } from "../../src/core/layout.js";

function node(id, parentId, order, branch = BRANCH_SELECTION, w = 100, h = 80) {
  return { id, parent_id: parentId, position: { x: 777, y: 777 }, size: { w, h }, _order: order, origin: parentId ? { branch_type: branch } : null };
}

// root -> a, b, c ; a -> a1, a2 ; c is a follow-up (must still fan out right).
const tree = {
  root: node("root", null, 0, BRANCH_SELECTION, 120, 90),
  a: node("a", "root", 1),
  b: node("b", "root", 2, BRANCH_FOLLOWUP, 140, 60),
  c: node("c", "root", 3, BRANCH_FOLLOWUP),
  a1: node("a1", "a", 4),
  a2: node("a2", "a", 5, BRANCH_FOLLOWUP, 80, 200),
};
const childrenOf = (id) => Object.values(tree).filter((candidate) => candidate.parent_id === id);
const laidOut = (positions) => Object.entries(positions).map(([id, position]) => ({ ...tree[id], position }));
const centerY = (n) => n.position.y + n.size.h / 2;
const noOverlaps = (nodes) => {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      assert.equal(boundsOverlap(nodeBounds(nodes[i]), nodeBounds(nodes[j])), false, `${nodes[i].id} overlaps ${nodes[j].id}`);
};

// Right-growing mind map.
const right = mindMapTree(tree.root, { childrenOf });
assert.deepEqual(right, mindMapTree(tree.root, { childrenOf }), "mind-map output is deterministic");
assert.deepEqual(right.root, { x: 0, y: 0 }, "root stays at the origin");
const rightNodes = laidOut(right);
noOverlaps(rightNodes);
const by = Object.fromEntries(rightNodes.map((n) => [n.id, n]));
for (const id of ["a", "b", "c"]) {
  assert.equal(by[id].position.x, 120 + TREE_PARENT_GAP, `${id} sits in the column right of the root, selection or follow-up alike`);
}
assert.equal(by.a1.position.x, by.a.position.x + 100 + TREE_PARENT_GAP, "grandchildren fan out one column further right");
assert.ok(by.a.position.y < by.b.position.y && by.b.position.y < by.c.position.y, "siblings keep their order top to bottom");
const midOf = (ids) => {
  const group = rightNodes.filter((n) => ids.includes(n.id));
  return (Math.min(...group.map((n) => n.position.y)) + Math.max(...group.map((n) => n.position.y + n.size.h))) / 2;
};
assert.equal(centerY(by.a), midOf(["a1", "a2"]), "a parent is centered against the block of its children");
assert.equal(centerY(by.root), midOf(["a", "b", "c", "a1", "a2"]), "the root is centered against the vertical extent of its branches");

// Balanced: children split across both sides of the root, growing outward.
const balanced = mindMapTree(tree.root, { childrenOf, balanced: true });
assert.deepEqual(balanced.root, { x: 0, y: 0 });
const balancedNodes = laidOut(balanced);
noOverlaps(balancedNodes);
const bb = Object.fromEntries(balancedNodes.map((n) => [n.id, n]));
const leftOfRoot = balancedNodes.filter((n) => n.id !== "root" && n.position.x + n.size.w <= 0);
const rightOfRoot = balancedNodes.filter((n) => n.id !== "root" && n.position.x >= 120);
assert.ok(leftOfRoot.length > 0 && rightOfRoot.length > 0, "both sides of the root are used");
assert.equal(leftOfRoot.length + rightOfRoot.length, 5, "every descendant lands on exactly one side");
assert.equal(bb.a.position.x, 120 + TREE_PARENT_GAP, "the first branch goes right");
assert.equal(bb.c.position.x, -TREE_PARENT_GAP - 100, "later branches mirror to the left, growing outward");
assert.deepEqual(balanced, mindMapTree(tree.root, { childrenOf, balanced: true }), "balanced output is deterministic");

// Edge cases: a lone root, and a single child (stays on the right when balanced).
const solo = { root: node("root", null, 0) };
assert.deepEqual(mindMapTree(solo.root, { childrenOf: () => [], balanced: true }), { root: { x: 0, y: 0 } });
const pair = { root: node("root", null, 0), only: node("only", "root", 1) };
const pairKids = (id) => Object.values(pair).filter((candidate) => candidate.parent_id === id);
const pairLayout = mindMapTree(pair.root, { childrenOf: pairKids, balanced: true });
assert.equal(pairLayout.only.x, 100 + TREE_PARENT_GAP, "a single child sits right of the root");
assert.equal(pairLayout.only.y, 0, "and level with it");

// effH feeds measured heights, exactly like tidyTree.
const tall = mindMapTree(pair.root, { childrenOf: pairKids, effH: (n) => (n.id === "only" ? 400 : 80) });
assert.equal(tall.root.y, 0);
assert.equal(tall.only.y, -160, "a taller child is centered against the root by measured height");
console.log("ok mind-map layouts");
