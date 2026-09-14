/** @protects deterministic bounded system trace and simulation semantics. */
import assert from "node:assert/strict";
import { parseSimulation, parseTrace, simulate, traceToPlainText } from "../../src/core/system-simulation.js";

const simulationSource = JSON.stringify({
  v: 1,
  title: "Worker queue",
  seed: 42,
  duration: 30,
  queues: [{ id: "jobs", label: "Jobs", capacity: 20 }],
  pools: [{ id: "workers", label: "Workers", queue: "jobs", capacity: 2, service: { distribution: "constant", value: 4 }, failureRate: 0.25, retryDelay: 2, maxRetries: 1 }],
  arrivals: [
    { at: 0, queue: "jobs", item: "job-1" },
    { at: 1, queue: "jobs", item: "job-2" },
    { at: 2, queue: "jobs", item: "job-3" },
  ],
});

const model = parseSimulation(simulationSource);
const first = simulate(model);
const second = simulate(model);
assert.deepEqual(first, second, "equal seeds and models must produce equal traces");
assert(first.events.some((event) => event.type === "enqueue"));
assert(first.events.some((event) => event.type === "start"));
assert(first.events.some((event) => event.type === "complete" || event.type === "failure"));
assert.doesNotThrow(() => parseTrace(JSON.stringify(first)));
assert.match(traceToPlainText(first), /Worker queue/);
assert.throws(() => parseSimulation('{"v":1,"seed":42,"duration":30,"queues":[],"pools":[],"arrivals":[]}'), /queues/);
assert.throws(() => parseSimulation('{"v":1,"seed":42,"duration":30,"queues":[{"id":"jobs","label":"Jobs","capacity":20}],"pools":[{"id":"workers","label":"Workers","queue":"jobs","capacity":1,"service":{"distribution":"constant","value":1}}],"arrivals":[{"at":0,"queue":"jobs","item":"job"}],"failures":[]}'), /unsupported key/);
assert.throws(() => parseSimulation('{"v":1,"seed":42,"duration":30,"queues":[{"id":"jobs","label":"Jobs","capacity":20}],"pools":[{"id":"workers","label":"Workers","queue":"missing","capacity":1,"service":{"distribution":"constant","value":1}}],"arrivals":[{"at":0,"queue":"jobs","item":"job"}]}'), /unknown queue/);
assert.throws(() => parseTrace('{"v":1,"actors":[{"id":"api","label":"API","type":"service"}],"events":[{"at":1,"type":"send","from":"missing","to":"api"}]}'), /unknown actor/);

console.log("ok simulation: strict models produce deterministic bounded traces with retry/failure semantics");
