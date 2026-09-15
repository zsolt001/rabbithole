/** @protects renderer-neutral topology and deterministic trace frame reduction. */
import assert from "node:assert/strict";
import { parseTrace } from "../../src/core/system-simulation.js";
import { deriveTracePresentation, tracePresentationText } from "../../src/core/trace-presentation.js";
import { traceRendererCases } from "../fixtures/traces/renderer-corpus.mjs";

for (const fixture of traceRendererCases) {
  const trace = parseTrace(JSON.stringify(fixture.trace));
  const first = deriveTracePresentation(trace);
  const second = deriveTracePresentation(trace);
  assert.deepEqual(first, second, `${fixture.id} presentation must be deterministic`);
  assert.equal(first.nodes.length, trace.actors.length);
  assert.equal(first.frames.length, trace.events.length);
  assert(first.edges.length > 0);
  assert.match(tracePresentationText(first, 0), /Step 1 of/);
}

const messaging = deriveTracePresentation(traceRendererCases[0].trace);
assert(messaging.edges.some((edge) => edge.from === "worker2" && edge.to === "orders"), "retry route should be persistent topology");
assert.equal(messaging.edges.find((edge) => edge.from === "worker2" && edge.to === "orders").layout, false, "reverse retry route should not drive topology layout");
assert.equal(messaging.frames[7].counts.orders, 4, "four messages should be buffered before consumers claim work");
assert.equal(messaging.frames[15].statuses.worker2, "failed");
assert.equal(messaging.frames[16].activeEdge, "worker2--orders");
assert.equal(messaging.frames[19].statuses.worker2, "idle", "recovery should clear failure state");
assert.equal(messaging.nodes.find((node) => node.id === "worker4").initialState, "inactive");

console.log("ok trace presentation: shared topology and frames are deterministic and preserve retry, queue, and status semantics");
