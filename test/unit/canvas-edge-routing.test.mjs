/** @protects direct horizontal branch routing from selected source text. */
import assert from "node:assert/strict";
import { edgeEnd } from "../../src/ui/canvas/edges.js";
import { routeConnector } from "../../src/core/edge-routing.js";

const child = { id: "child", position: { x: 450, y: 150 }, size: { w: 300, h: 240 } };
const end = edgeEnd(child, "left", {}, 300);

assert.deepEqual(end, { x: 450, y: 300 }, "a side-by-side child receives the edge at the source text height");
assert.deepEqual(
  routeConnector({ x: 300, y: 300 }, end),
  [{ x: 300, y: 300 }, { x: 450, y: 300 }],
  "aligned side anchors produce a direct connector when no obstacle intervenes",
);
assert.deepEqual(
  routeConnector({ x: 300, y: 260 }, { x: 450, y: 340 }, { preferTwoElbows: true }),
  [
    { x: 300, y: 260 },
    { x: 375, y: 260 },
    { x: 375, y: 340 },
    { x: 450, y: 340 },
  ],
  "side-to-side branches changing rows use two elbows",
);
assert.deepEqual(
  routeConnector({ x: 300, y: 260 }, { x: 450, y: 340 }, { preferTwoElbows: true, preferVerticalDeparture: true }),
  [
    { x: 300, y: 260 },
    { x: 300, y: 300 },
    { x: 450, y: 300 },
    { x: 450, y: 340 },
  ],
  "top-to-bottom branches use a vertical departure and arrival",
);

console.log("canvas edge routing unit contracts ok");
