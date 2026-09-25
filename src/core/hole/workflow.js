import { isNoteNode } from "./ask.js";

export const WORKFLOW_STATUS = Object.freeze({
  queued: Object.freeze({ id: "queued", label: "Queued", shortLabel: "Queued" }),
  drawing: Object.freeze({ id: "drawing", label: "Drawing", shortLabel: "Drawing" }),
  thinking: Object.freeze({ id: "thinking", label: "Thinking", shortLabel: "Thinking" }),
  delegated: Object.freeze({ id: "delegated", label: "Sub-agent", shortLabel: "Sub-agent" }),
  streaming: Object.freeze({ id: "streaming", label: "Writing", shortLabel: "Writing" }),
  failed: Object.freeze({ id: "failed", label: "Failed", shortLabel: "Failed" }),
  "needs-review": Object.freeze({ id: "needs-review", label: "Needs review", shortLabel: "Review" }),
  reviewed: Object.freeze({ id: "reviewed", label: "Reviewed", shortLabel: "Reviewed" }),
  done: Object.freeze({ id: "done", label: "Done", shortLabel: "Done" }),
  note: Object.freeze({ id: "note", label: "Note", shortLabel: "Note" }),
});

/** @typedef {keyof typeof WORKFLOW_STATUS} WorkflowStatusId */

const DOMINANCE = Object.freeze([
  "failed",
  "queued",
  "drawing",
  "thinking",
  "delegated",
  "streaming",
  "needs-review",
  "reviewed",
  "done",
  "note",
]);

/** @param {Record<string, any> | null | undefined} node */
export function deriveWorkflowStatus(node) {
  if (isNoteNode(node)) return WORKFLOW_STATUS.note;
  if (node?.status !== "answered") {
    if (node?.error) return WORKFLOW_STATUS.failed;
    if (node?.queued) return WORKFLOW_STATUS.queued;
    if (node?.drawing) return WORKFLOW_STATUS.drawing;
    if (node?.delegated) return WORKFLOW_STATUS.delegated;
    if (String(node?.markdown || "").trim()) return WORKFLOW_STATUS.streaming;
    return WORKFLOW_STATUS.thinking;
  }
  if (node?.extensions?.review?.done_at) return WORKFLOW_STATUS.done;
  if (node?.extensions?.attention?.seen_at) return WORKFLOW_STATUS.reviewed;
  return WORKFLOW_STATUS["needs-review"];
}

/** @param {Record<string, any> | null | undefined} node */
export function nodeIsExplicitlyDone(node) {
  return deriveWorkflowStatus(node).id === "done";
}

/**
 * @param {string | Record<string, any>} root
 * @param {Map<string, any> | Record<string, any>} collection
 * @param {(id: string) => any[]} childrenOf
 */
export function deriveSubtreeWorkflow(root, collection, childrenOf) {
  const start = typeof root === "string" ? nodeAt(collection, root) : root;
  /** @type {Record<WorkflowStatusId, number>} */
  const counts = /** @type {any} */ (Object.fromEntries(Object.keys(WORKFLOW_STATUS).map((id) => [id, 0])));
  if (!start) return { counts, total: 0, dominant: null };
  const pending = [start];
  const seen = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (!node || seen.has(node.id) || node._pendingDelete || node._ephemeral) continue;
    seen.add(node.id);
    if (!isNoteNode(node)) {
      const status = deriveWorkflowStatus(node);
      counts[/** @type {WorkflowStatusId} */ (status.id)] += 1;
    }
    for (const entry of childrenOf(node.id) || []) {
      pending.push(typeof entry === "string" ? nodeAt(collection, entry) : entry);
    }
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const dominantId = /** @type {WorkflowStatusId | null} */ (DOMINANCE.find((id) => counts[/** @type {WorkflowStatusId} */ (id)] > 0) || null);
  return { counts, total, dominant: dominantId ? WORKFLOW_STATUS[dominantId] : null };
}

/** @param {Map<string, any> | Record<string, any>} collection @param {string} id */
function nodeAt(collection, id) {
  return collection instanceof Map ? collection.get(id) : collection?.[id];
}
