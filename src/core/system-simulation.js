// @ts-nocheck
const ACTOR_TYPES = new Set(["service", "queue", "pool", "database", "cache", "broker", "network"]);
const EVENT_TYPES = new Set(["send", "enqueue", "dequeue", "start", "complete", "retry", "timeout", "failure", "recovery", "annotation"]);
const DISTRIBUTIONS = new Set(["constant", "uniform", "exponential"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function keys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported ${unknown.length === 1 ? "key" : "keys"}: ${unknown.join(", ")}`);
}

function id(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(value)) throw new Error(`${label} must be a lowercase identifier of at most 32 characters`);
  return value;
}

function text(value, label, required = true) {
  if (!required && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`${label} must be a non-empty string of at most 300 characters`);
  return value;
}

function finite(value, label, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number from ${min} to ${max}`);
  return value;
}

export function parseTrace(source) {
  let parsed;
  try { parsed = JSON.parse(String(source ?? "")); }
  catch (error) { throw new Error(`Trace body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const model = object(parsed, "Trace body");
  keys(model, ["v", "title", "actors", "events"], "Trace body");
  if (model.v !== 1) throw new Error("Trace v must be 1");
  text(model.title, "Trace title", false);
  if (!Array.isArray(model.actors) || !model.actors.length || model.actors.length > 40) throw new Error("Trace actors must contain 1-40 items");
  const actorIds = new Set();
  const actors = model.actors.map((actor, index) => {
    object(actor, `Trace actor ${index}`);
    keys(actor, ["id", "label", "type", "capacity"], `Trace actor ${index}`);
    const actorId = id(actor.id, `Trace actor ${index} id`);
    if (actorIds.has(actorId)) throw new Error(`Trace actor id ${actorId} is duplicated`);
    actorIds.add(actorId);
    if (!ACTOR_TYPES.has(actor.type)) throw new Error(`Trace actor ${actorId} type is unsupported`);
    if (actor.capacity !== undefined) finite(actor.capacity, `Trace actor ${actorId} capacity`, 1, 10000);
    return { id: actorId, label: text(actor.label, `Trace actor ${actorId} label`), type: actor.type, ...(actor.capacity !== undefined ? { capacity: actor.capacity } : {}) };
  });
  if (!Array.isArray(model.events) || !model.events.length || model.events.length > 5000) throw new Error("Trace events must contain 1-5000 items");
  let previous = -Infinity;
  const events = model.events.map((event, index) => {
    object(event, `Trace event ${index}`);
    keys(event, ["at", "type", "from", "to", "target", "item", "caption"], `Trace event ${index}`);
    const at = finite(event.at, `Trace event ${index} at`, 0, 1e9);
    if (at < previous) throw new Error("Trace events must be ordered by at");
    previous = at;
    if (!EVENT_TYPES.has(event.type)) throw new Error(`Trace event ${index} type is unsupported`);
    for (const endpoint of ["from", "to", "target"]) if (event[endpoint] !== undefined && !actorIds.has(event[endpoint])) throw new Error(`Trace event ${index} references unknown actor ${event[endpoint]}`);
    const item = text(event.item, `Trace event ${index} item`, false);
    const caption = text(event.caption, `Trace event ${index} caption`, false);
    return { at, type: event.type, ...(event.from ? { from: event.from } : {}), ...(event.to ? { to: event.to } : {}), ...(event.target ? { target: event.target } : {}), ...(item ? { item } : {}), ...(caption ? { caption } : {}) };
  });
  return { v: 1, ...(model.title ? { title: model.title } : {}), actors, events };
}

export function parseSimulation(source) {
  let parsed;
  try { parsed = JSON.parse(String(source ?? "")); }
  catch (error) { throw new Error(`Simulation body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const model = object(parsed, "Simulation body");
  keys(model, ["v", "title", "seed", "duration", "queues", "pools", "arrivals"], "Simulation body");
  if (model.v !== 1) throw new Error("Simulation v must be 1");
  text(model.title, "Simulation title", false);
  const seed = finite(model.seed, "Simulation seed", 0, 0xffffffff);
  const duration = finite(model.duration, "Simulation duration", 0.001, 1e7);
  if (!Array.isArray(model.queues) || !model.queues.length || model.queues.length > 20) throw new Error("Simulation queues must contain 1-20 items");
  const queues = model.queues.map((queue, index) => {
    object(queue, `Simulation queue ${index}`);
    keys(queue, ["id", "label", "capacity"], `Simulation queue ${index}`);
    return { id: id(queue.id, `Simulation queue ${index} id`), label: text(queue.label, `Simulation queue ${index} label`), capacity: finite(queue.capacity, `Simulation queue ${index} capacity`, 1, 10000) };
  });
  const queueIds = new Set(queues.map((queue) => queue.id));
  if (queueIds.size !== queues.length) throw new Error("Simulation queue ids must be unique");
  if (!Array.isArray(model.pools) || !model.pools.length || model.pools.length > 20) throw new Error("Simulation pools must contain 1-20 items");
  const pools = model.pools.map((pool, index) => {
    object(pool, `Simulation pool ${index}`);
    keys(pool, ["id", "label", "queue", "capacity", "service", "failureRate", "retryDelay", "maxRetries"], `Simulation pool ${index}`);
    const poolId = id(pool.id, `Simulation pool ${index} id`);
    if (!queueIds.has(pool.queue)) throw new Error(`Simulation pool ${poolId} references unknown queue ${pool.queue}`);
    const service = object(pool.service, `Simulation pool ${poolId} service`);
    keys(service, ["distribution", "value", "min", "max", "mean"], `Simulation pool ${poolId} service`);
    if (!DISTRIBUTIONS.has(service.distribution)) throw new Error(`Simulation pool ${poolId} service distribution is unsupported`);
    if (service.distribution === "constant") finite(service.value, `Simulation pool ${poolId} service value`, 0.001, duration);
    if (service.distribution === "uniform") {
      finite(service.min, `Simulation pool ${poolId} service min`, 0.001, duration);
      finite(service.max, `Simulation pool ${poolId} service max`, service.min, duration);
    }
    if (service.distribution === "exponential") finite(service.mean, `Simulation pool ${poolId} service mean`, 0.001, duration);
    return {
      id: poolId,
      label: text(pool.label, `Simulation pool ${poolId} label`),
      queue: pool.queue,
      capacity: finite(pool.capacity, `Simulation pool ${poolId} capacity`, 1, 1000),
      service: structuredClone(service),
      failureRate: pool.failureRate === undefined ? 0 : finite(pool.failureRate, `Simulation pool ${poolId} failureRate`, 0, 1),
      retryDelay: pool.retryDelay === undefined ? 0 : finite(pool.retryDelay, `Simulation pool ${poolId} retryDelay`, 0, duration),
      maxRetries: pool.maxRetries === undefined ? 0 : finite(pool.maxRetries, `Simulation pool ${poolId} maxRetries`, 0, 20),
    };
  });
  if (new Set(pools.map((pool) => pool.id)).size !== pools.length) throw new Error("Simulation pool ids must be unique");
  if (!Array.isArray(model.arrivals) || !model.arrivals.length || model.arrivals.length > 2000) throw new Error("Simulation arrivals must contain 1-2000 items");
  const arrivals = model.arrivals.map((arrival, index) => {
    object(arrival, `Simulation arrival ${index}`);
    keys(arrival, ["at", "queue", "item"], `Simulation arrival ${index}`);
    if (!queueIds.has(arrival.queue)) throw new Error(`Simulation arrival ${index} references unknown queue ${arrival.queue}`);
    return { at: finite(arrival.at, `Simulation arrival ${index} at`, 0, duration), queue: arrival.queue, item: text(arrival.item, `Simulation arrival ${index} item`) };
  }).sort((left, right) => left.at - right.at);
  return { v: 1, ...(model.title ? { title: model.title } : {}), seed, duration, queues, pools, arrivals };
}

function randomGenerator(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function sample(distribution, random) {
  if (distribution.distribution === "constant") return distribution.value;
  if (distribution.distribution === "uniform") return distribution.min + random() * (distribution.max - distribution.min);
  return -Math.log(Math.max(Number.EPSILON, 1 - random())) * distribution.mean;
}

export function simulate(model) {
  const random = randomGenerator(model.seed);
  const actors = [
    ...model.queues.map((queue) => ({ id: queue.id, label: queue.label, type: "queue", capacity: queue.capacity })),
    ...model.pools.map((pool) => ({ id: pool.id, label: pool.label, type: "pool", capacity: pool.capacity })),
  ];
  const queues = new Map(model.queues.map((queue) => [queue.id, []]));
  const busy = new Map(model.pools.map((pool) => [pool.id, 0]));
  const schedule = model.arrivals.map((arrival) => ({ at: arrival.at, kind: "arrival", ...arrival, retries: 0 }));
  const events = [];
  const push = (event) => {
    if (events.length >= 5000) throw new Error("Simulation generated more than 5000 events");
    events.push(event);
  };
  const dispatch = (at, queueId) => {
    const pool = model.pools.find((candidate) => candidate.queue === queueId && busy.get(candidate.id) < candidate.capacity);
    const queue = queues.get(queueId);
    if (!pool || !queue?.length) return;
    const job = queue.shift();
    busy.set(pool.id, busy.get(pool.id) + 1);
    push({ at, type: "dequeue", from: queueId, to: pool.id, item: job.item, caption: `${job.item} leaves ${queueId}` });
    push({ at, type: "start", target: pool.id, item: job.item, caption: `${pool.label} starts ${job.item}` });
    schedule.push({ ...job, at: at + sample(pool.service, random), kind: "finish", pool, queue: queueId });
  };
  while (schedule.length) {
    schedule.sort((left, right) => left.at - right.at || left.kind.localeCompare(right.kind));
    const next = schedule.shift();
    if (next.at > model.duration) break;
    if (next.kind === "arrival") {
      const queue = queues.get(next.queue);
      const capacity = model.queues.find((item) => item.id === next.queue).capacity;
      if (queue.length >= capacity) push({ at: next.at, type: "failure", target: next.queue, item: next.item, caption: `${next.item} rejected: ${next.queue} is full` });
      else {
        queue.push(next);
        push({ at: next.at, type: "enqueue", target: next.queue, item: next.item, caption: `${next.item} enters ${next.queue}` });
        dispatch(next.at, next.queue);
      }
    } else {
      busy.set(next.pool.id, busy.get(next.pool.id) - 1);
      if (random() < next.pool.failureRate) {
        push({ at: next.at, type: "failure", target: next.pool.id, item: next.item, caption: `${next.item} fails in ${next.pool.label}` });
        if (next.retries < next.pool.maxRetries) {
          push({ at: next.at, type: "retry", from: next.pool.id, to: next.queue, item: next.item, caption: `${next.item} scheduled for retry` });
          schedule.push({ at: next.at + next.pool.retryDelay, kind: "arrival", queue: next.queue, item: next.item, retries: next.retries + 1 });
        }
      } else push({ at: next.at, type: "complete", target: next.pool.id, item: next.item, caption: `${next.item} completes in ${next.pool.label}` });
      dispatch(next.at, next.queue);
    }
  }
  return { v: 1, title: model.title || "System simulation", actors, events: events.sort((left, right) => left.at - right.at) };
}

export function traceToPlainText(model) {
  return [model.title || "System trace", ...model.events.map((event) => `${event.at}: ${event.caption || `${event.type} ${event.item || ""}`.trim()}`)].join("\n");
}
