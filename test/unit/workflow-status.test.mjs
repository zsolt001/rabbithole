/** @protects shared branch workflow derivation, review persistence, and subtree aggregates. */
import assert from "node:assert/strict";
import { deriveSubtreeWorkflow, deriveWorkflowStatus, nodeIsExplicitlyDone } from "../../src/core/hole/workflow.js";
import { createHoleState, holeStateToHole, reduceHoleEvent } from "../../src/core/hole/reduce.js";

/** @type {[Record<string, any>, string][]} */
const cases = [
  [{ status: "pending", queued: true }, "queued"],
  [{ status: "pending", drawing: true }, "drawing"],
  [{ status: "pending" }, "thinking"],
  [{ status: "pending", delegated: true }, "delegated"],
  [{ status: "pending", markdown: "partial" }, "streaming"],
  [{ status: "pending", error: { message: "nope" } }, "failed"],
  [{ status: "answered", extensions: {} }, "needs-review"],
  [{ status: "answered", extensions: { attention: { seen_at: 1 } } }, "reviewed"],
  [{ status: "answered", extensions: { review: { done_at: 2 } } }, "done"],
  [{ status: "answered", origin: { kind: "note" }, extensions: {} }, "note"],
];
for (const [node, expected] of cases) assert.equal(deriveWorkflowStatus(node).id, expected);
assert.equal(nodeIsExplicitlyDone(cases[8][0]), true);
assert.equal(nodeIsExplicitlyDone(cases[7][0]), false);

const nodes = {
  root: { id: "root", status: "answered", extensions: { review: { done_at: 1 } } },
  failed: { id: "failed", parent_id: "root", status: "pending", error: { message: "x" } },
  note: { id: "note", parent_id: "root", status: "answered", origin: { kind: "note" } },
};
const aggregate = deriveSubtreeWorkflow("root", nodes, (id) => Object.values(nodes).filter((node) => node.parent_id === id));
assert.equal(aggregate.total, 2);
assert.equal(aggregate.counts.done, 1);
assert.equal(aggregate.counts.failed, 1);
assert.equal(aggregate.counts.note, 0);
assert.equal(aggregate.dominant.id, "failed");

let state = createHoleState({
  hole_id: "workflow",
  root_id: "answer",
  nodes: [{
    id: "answer",
    status: "answered",
    extensions: { attention: { seen_at: 1 }, review: { done_at: 2 }, retained: { yes: true } },
  }],
});
state = reduceHoleEvent(state, {
  type: "node_answered",
  node_id: "answer",
  title: "Fresh",
  markdown: "Fresh answer",
}).state;
assert.deepEqual(state.nodes.get("answer").extensions, { retained: { yes: true } }, "fresh answers clear attention and review only");
state = reduceHoleEvent(state, {
  type: "node_extensions_patch",
  node_id: "answer",
  namespace: "review",
  value: { done_at: 3 },
}).state;
assert.equal(deriveWorkflowStatus(state.nodes.get("answer")).id, "done");
assert.deepEqual(holeStateToHole(state).nodes[0].extensions.review, { done_at: 3 }, "explicit done persists in the review extension");

console.log("workflow status unit contracts ok");
