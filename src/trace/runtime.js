import ElkModule from "elkjs/lib/elk.bundled.js";

/** @typedef {{ layout(graph: object): Promise<object> }} ElkRuntime */
const Elk = /** @type {new () => ElkRuntime} */ (/** @type {unknown} */ (ElkModule));
const elk = new Elk();

/** @param {object} graph */
export function layout(graph) {
  return elk.layout(graph);
}

globalThis.RabbitholeTraceRuntime = { layout };
