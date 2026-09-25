import { getAssetContentType } from "./assets.js";
import { createPortableProjection } from "./portable-projection.js";

/** @typedef {import("./contracts/artifact.js").PersistedHole} PersistedHole */
/** @typedef {import("./contracts/artifact.js").PortableArtifact} PortableArtifact */

/**
 * @param {any} hole
 * @param {PersistedHole["view_state"]} viewState
 * @param {any} assets
 * @returns {PortableArtifact}
 */
export function createSnapshotProjection(hole, viewState, assets) {
  const projection = createPortableProjection({ ...hole, view_state: viewState }, assets);
  // Shares exclude unrelated personal extension state. Native PDF provenance,
  // note/card presentation, and answer workflow state are required to render
  // the document faithfully, so a snapshot retains those namespaces.
  projection.hole = {
    ...projection.hole,
    nodes: projection.hole.nodes.map((node) => ({
      ...node,
      extensions: {
        ...(node.extensions?.pdf ? { pdf: node.extensions.pdf } : {}),
        ...(node.extensions?.note ? { note: node.extensions.note } : {}),
        ...(node.extensions?.canvas ? { canvas: node.extensions.canvas } : {}),
        ...(node.extensions?.review?.done_at ? { review: { done_at: node.extensions.review.done_at } } : {}),
      },
    })),
  };
  return projection;
}

/** @param {PortableArtifact} projection */
export function snapshotProjectionToFrozenHydration(projection) {
  const hole = projection.hole;
  /** @type {Record<string, string>} */
  const assetData = {};
  for (const [name, encoded] of Object.entries(projection.assets)) {
    assetData[name] = `data:${getAssetContentType(name)};base64,${encoded}`;
  }
  return {
    title: hole.title,
    root_id: hole.root_id,
    last_event_id: 0,
    agent_attached: false,
    view_state: hole.view_state,
    frozen: true,
    asset_data: assetData,
    nodes: hole.nodes,
  };
}
