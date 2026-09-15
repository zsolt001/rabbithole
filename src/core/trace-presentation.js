/**
 * @typedef {{ id: string, label: string, type: string, capacity?: number }} TraceActor
 * @typedef {{ at: number, type: string, from?: string, to?: string, target?: string, item?: string, caption?: string }} TraceEvent
 * @typedef {{ title?: string, actors: TraceActor[], events: TraceEvent[] }} TraceModel
 * @typedef {{ id: string, from: string, to: string, eventTypes: string[], layout: boolean }} TraceEdge
 * @typedef {{ counts: Record<string, number>, statuses: Record<string, string> }} TraceState
 * @typedef {TraceState & { index: number, at: number, type: string, caption: string, activeNodes: string[], activeEdge: string | null, item: string, movement: boolean }} TraceFrame
 * @typedef {TraceActor & { rank: number, order: number, initialState: string }} TraceNode
 * @typedef {{ title: string, nodes: TraceNode[], edges: TraceEdge[], frames: TraceFrame[] }} TracePresentation
 */
const TRANSIT_TYPES = new Set(["queue", "broker", "network"]);
const MOVEMENT_TYPES = new Set(["send", "dequeue", "retry"]);
const RELEASE_TYPES = new Set(["complete", "failure", "timeout"]);

/** @param {string} from @param {string} to */
function edgeId(from, to) {
  return `${from}--${to}`;
}

/** @param {TraceModel} trace @returns {TraceEdge[]} */
function uniqueEdges(trace) {
  const seen = new Set();
  /** @type {TraceEdge[]} */
  const edges = [];
  for (const event of trace.events) {
    if (!event.from || !event.to) continue;
    const key = edgeId(event.from, event.to);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: key, from: event.from, to: event.to, eventTypes: [], layout: true });
  }
  for (const edge of edges) {
    edge.eventTypes = [...new Set(trace.events
      .filter((event) => event.from === edge.from && event.to === edge.to)
      .map((event) => event.type))];
  }
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const edge of edges) {
    edge.layout = !(
      edge.eventTypes.every((type) => type === "retry") &&
      edgeIds.has(edgeId(edge.to, edge.from))
    );
  }
  return edges;
}

/** @param {TraceModel} trace @param {TraceEdge[]} edges */
function deriveRanks(trace, edges) {
  const incoming = new Map(trace.actors.map((actor) => [actor.id, 0]));
  const outgoing = new Map(trace.actors.map((actor) => [actor.id, 0]));
  for (const edge of edges.filter((candidate) => candidate.layout)) {
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
  }
  /** @type {Map<string, number>} */
  const ranks = new Map();
  for (const actor of trace.actors) {
    if ((incoming.get(actor.id) || 0) === 0 && (outgoing.get(actor.id) || 0) > 0) ranks.set(actor.id, 0);
    else if (TRANSIT_TYPES.has(actor.type)) ranks.set(actor.id, 1);
    else if ((outgoing.get(actor.id) || 0) === 0 || actor.type === "database" || actor.type === "cache") ranks.set(actor.id, 3);
    else ranks.set(actor.id, 2);
  }
  return ranks;
}

/** @param {TraceModel} trace @param {number} eventIndex @param {TraceState} previous @returns {TraceFrame} */
function frameFromEvent(trace, eventIndex, previous) {
  const event = trace.events[eventIndex];
  if (!event) throw new RangeError(`Trace event ${eventIndex} is unavailable`);
  const counts = { ...previous.counts };
  const statuses = { ...previous.statuses };
  if (event.type === "enqueue" && event.target) counts[event.target] = (counts[event.target] || 0) + 1;
  if (event.type === "dequeue" && event.from) counts[event.from] = Math.max(0, (counts[event.from] || 0) - 1);
  if (event.type === "start" && event.target) {
    counts[event.target] = (counts[event.target] || 0) + 1;
    statuses[event.target] = "processing";
  }
  if (RELEASE_TYPES.has(event.type) && event.target) counts[event.target] = Math.max(0, (counts[event.target] || 0) - 1);
  if (event.type === "failure" && event.target) statuses[event.target] = "failed";
  if (event.type === "timeout" && event.target) statuses[event.target] = "timed-out";
  if (event.type === "recovery" && event.target) statuses[event.target] = "idle";
  if (event.type === "complete" && event.target) statuses[event.target] = "complete";
  return {
    index: eventIndex,
    at: event.at,
    type: event.type,
    caption: event.caption || `${event.type} ${event.item || ""}`.trim(),
    activeNodes: [...new Set([event.from, event.to, event.target].filter((value) => typeof value === "string"))],
    activeEdge: event.from && event.to ? edgeId(event.from, event.to) : null,
    item: event.item || "",
    counts,
    statuses,
    movement: MOVEMENT_TYPES.has(event.type),
  };
}

/** @param {TraceModel} trace @returns {TracePresentation} */
export function deriveTracePresentation(trace) {
  const edges = uniqueEdges(trace);
  const ranks = deriveRanks(trace, edges);
  const nodes = trace.actors.map((actor, order) => ({
    ...actor,
    rank: ranks.get(actor.id) ?? 0,
    order,
    initialState: actor.type === "pool" && !trace.events.some((event) =>
      event.from === actor.id || event.to === actor.id || event.target === actor.id) ? "inactive" : "idle",
  }));
  /** @type {TraceState} */
  let state = {
    counts: Object.fromEntries(nodes.map((node) => [node.id, 0])),
    statuses: Object.fromEntries(nodes.map((node) => [node.id, node.initialState])),
  };
  const frames = trace.events.map((_, index) => {
    const frame = frameFromEvent(trace, index, state);
    state = frame;
    return frame;
  });
  return { title: trace.title || "System trace", nodes, edges, frames };
}

/** @param {TracePresentation} presentation @param {number} frameIndex */
export function tracePresentationText(presentation, frameIndex) {
  const frame = presentation.frames[Math.max(0, Math.min(presentation.frames.length - 1, frameIndex))];
  if (!frame) return `${presentation.title}. No events.`;
  return `${presentation.title}. Step ${frame.index + 1} of ${presentation.frames.length}. ${frame.caption}`;
}
