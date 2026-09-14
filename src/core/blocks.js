/** @typedef {"sanitize-html" | "inert"} BlockSecurity */
/** @typedef {{ type: string, version: number, parse: (source: string) => unknown, toPlainText: (model: any) => string, security: BlockSecurity }} BlockTypeDescriptor */
import { parseSimulation, parseTrace, simulate, traceToPlainText } from "./system-simulation.js";

/** @type {Map<string, BlockTypeDescriptor>} */
const blockTypes = new Map();

/** @param {unknown} value */
function normalizedType(value) {
  return String(value || "").toLowerCase();
}

/** @param {any} descriptor @returns {BlockTypeDescriptor} */
export function registerBlockType(descriptor) {
  if (!descriptor || typeof descriptor !== "object") throw new TypeError("Block type descriptor must be an object");
  const type = normalizedType(descriptor.type);
  if (!type || !/^[a-z][a-z0-9_-]*$/.test(type)) throw new TypeError("Block type descriptor.type must be a fence-safe name");
  if (!Number.isInteger(descriptor.version) || descriptor.version < 1) throw new TypeError(`Block type "${type}" must have a positive integer version`);
  if (typeof descriptor.parse !== "function") throw new TypeError(`Block type "${type}" must provide parse(source)`);
  if (typeof descriptor.toPlainText !== "function") throw new TypeError(`Block type "${type}" must provide toPlainText(model)`);
  if (descriptor.security !== "sanitize-html" && descriptor.security !== "inert") {
    throw new TypeError(`Block type "${type}" security must be "sanitize-html" or "inert"`);
  }
  if (blockTypes.has(type)) throw new Error(`Block type "${type}" is already registered`);
  const registered = Object.freeze({ ...descriptor, type });
  blockTypes.set(type, registered);
  return registered;
}

/** @param {unknown} type */
export function getBlockType(type) {
  return blockTypes.get(normalizedType(type));
}

export function listBlockTypes() {
  return [...blockTypes.values()];
}

const BLOCK_ID_PATTERN = /^[a-z0-9]{4,8}$/;

/** @param {unknown} info */
export function parseBlockInfo(info) {
  const parts = String(info || "").trim().split(/\s+/).filter(Boolean);
  const type = normalizedType(parts[0]);
  let id = null;
  for (let i = 1; i < parts.length; i += 1) {
    const match = /^id=([^\s]+)$/i.exec(parts[i] ?? "");
    if (match && BLOCK_ID_PATTERN.test(match[1] ?? "")) id = match[1] ?? null;
  }
  return { type, id };
}

function defaultBlockIdFactory() {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

/**
 * Add durable ids to registered fenced blocks and canonicalize registered
 * opener info strings. Every byte outside an affected opener is preserved.
 *
 * @param {string} markdown
 * @param {{ idFactory?: () => string }} [options]
 */
export function normalizeBlockIds(markdown, { idFactory = defaultBlockIdFactory } = {}) {
  const source = String(markdown ?? "");
  // The overwhelming majority of generated documents contain no fenced
  // visual at all. Avoid allocating an array and one string per line unless a
  // fence marker can actually be present.
  if (!source.includes("```") && !source.includes("~~~")) return { markdown: source, changed: false };
  const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) || [];
  let active = null;
  let changed = false;
  const output = [];
  for (const wholeLine of lines) {
    if (!wholeLine) continue;
    const ending = wholeLine.endsWith("\r\n") ? "\r\n" : wholeLine.endsWith("\n") ? "\n" : wholeLine.endsWith("\r") ? "\r" : "";
    const line = ending ? wholeLine.slice(0, -ending.length) : wholeLine;
    if (active) {
      const close = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[2]?.[0] === active.char && close[2].length >= active.width) active = null;
      output.push(wholeLine);
      continue;
    }
    const open = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
    if (!open) {
      output.push(wholeLine);
      continue;
    }
    const marker = open[2] ?? "";
    const info = (open[3] ?? "").trim();
    active = { char: marker[0] ?? "", width: marker.length };
    const parsed = parseBlockInfo(info);
    if (!getBlockType(parsed.type)) {
      output.push(wholeLine);
      continue;
    }
    let id = parsed.id;
    if (!id) {
      id = String(idFactory());
      if (!BLOCK_ID_PATTERN.test(id)) throw new Error(`Block id factory returned invalid id ${JSON.stringify(id)}`);
    }
    const normalized = `${open[1]}${marker}${parsed.type} id=${id}${ending}`;
    changed ||= normalized !== wholeLine;
    output.push(normalized);
  }
  return { markdown: output.join(""), changed };
}

/**
 * Detect whether Markdown contains an opener for a registered fenced block.
 * The scanner observes CommonMark fence nesting, so examples inside a larger
 * code fence do not accidentally opt a snapshot into an expensive runtime.
 *
 * @param {unknown} markdown
 * @param {unknown} targetType
 */
export function markdownContainsBlockType(markdown, targetType) {
  const target = normalizedType(targetType);
  if (!target || !getBlockType(target)) return false;
  const source = String(markdown ?? "");
  // Snapshot capability checks touch every node. Most holes have no Mermaid
  // token anywhere, so skip line tokenization for that common case.
  if (!source.toLowerCase().includes(target)) return false;
  const lines = source.split(/\r\n|\n|\r/);
  let active = null;
  for (const line of lines) {
    if (active) {
      const close = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[2]?.[0] === active.char && close[2].length >= active.width) active = null;
      continue;
    }
    const open = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
    if (!open) continue;
    const marker = open[2] ?? "";
    const parsed = parseBlockInfo(open[3] ?? "");
    if (parsed.type === target) return true;
    active = { char: marker[0] ?? "", width: marker.length };
  }
  return false;
}

registerBlockType({
  type: "show",
  version: 1,
  parse(/** @type {unknown} */ source) { return String(source ?? ""); },
  toPlainText() { return ""; },
  security: "sanitize-html",
});

registerBlockType({
  type: "trace",
  version: 1,
  parse(/** @type {string} */ source) {
    try { return parseTrace(source); }
    catch (error) { throw new Error(`Trace body is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  },
  toPlainText: traceToPlainText,
  security: "sanitize-html",
});

registerBlockType({
  type: "sim",
  version: 1,
  parse(/** @type {string} */ source) {
    try { return parseSimulation(source); }
    catch (error) { throw new Error(`Simulation body is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  },
  toPlainText(/** @type {any} */ model) { return traceToPlainText(simulate(model)); },
  security: "sanitize-html",
});

registerBlockType({
  type: "mermaid",
  version: 1,
  parse(/** @type {unknown} */ source) { return String(source ?? ""); },
  toPlainText(/** @type {unknown} */ source) { return String(source ?? ""); },
  security: "sanitize-html",
});

/** @param {string} source */
function parseCheck(source) {
  let model;
  try {
    model = JSON.parse(String(source ?? ""));
  } catch (error) {
    throw new Error(`Check body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!model || typeof model !== "object" || Array.isArray(model)) throw new Error("Check body must be a JSON object");
  if (typeof model.question !== "string" || !model.question.trim()) throw new Error("Check question must be a non-empty string");
  if (!Array.isArray(model.options)) throw new Error("Check options must be an array of 2-6 strings");
  if (model.options.length < 2 || model.options.length > 6) throw new Error("Check options must contain 2-6 strings");
  if (model.options.some((/** @type {unknown} */ option) => typeof option !== "string")) throw new Error("Check options must contain only strings");
  if (!Number.isInteger(model.answer)) throw new Error("Check answer must be an integer option index");
  if (model.answer < 0 || model.answer >= model.options.length) throw new Error("Check answer must index an existing option");
  if (model.explanation !== undefined && typeof model.explanation !== "string") throw new Error("Check explanation must be a string when provided");
  return {
    question: model.question,
    options: [...model.options],
    answer: model.answer,
    ...(model.explanation !== undefined ? { explanation: model.explanation } : {}),
  };
}

const CHART_TYPES = new Set([
  "line", "step", "scatter", "bubble", "bar", "grouped-bar", "stacked-bar", "histogram", "density", "ecdf",
  "box", "violin", "error-bar", "confidence-band", "area", "stacked-area", "heatmap", "contour",
]);
const CHART_KEYS = new Set([
  "v", "type", "title", "subtitle", "caption", "data", "x", "y", "y2", "value", "series", "group", "color", "size",
  "xLabel", "yLabel", "xScale", "yScale", "bins", "bandwidth", "annotations", "references",
]);

/** @param {string} source */
function parseChart(source) {
  const text = String(source ?? "");
  if (text.length > 65536) throw new Error("Chart body must not exceed 64 KiB");
  let model;
  try {
    model = JSON.parse(text);
  } catch (error) {
    throw new Error(`Chart body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!model || typeof model !== "object" || Array.isArray(model)) throw new Error("Chart body must be a JSON object");
  const unknown = Object.keys(model).filter((key) => !CHART_KEYS.has(key));
  if (unknown.length) throw new Error(`Chart body contains unsupported ${unknown.length === 1 ? "key" : "keys"}: ${unknown.join(", ")}`);
  if (model.v !== 1) throw new Error("Chart v must be 1");
  if (!CHART_TYPES.has(model.type)) throw new Error(`Chart type must be one of: ${[...CHART_TYPES].join(", ")}`);
  if (!Array.isArray(model.data) || !model.data.length || model.data.length > 5000) throw new Error("Chart data must contain 1-5000 rows");
  for (const row of model.data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Chart data rows must be JSON objects");
    if (Object.keys(row).length > 32) throw new Error("Chart data rows must contain at most 32 fields");
    for (const value of Object.values(row)) {
      if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error("Chart data values must be strings, numbers, booleans, or null");
      }
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Chart numeric values must be finite");
      if (typeof value === "string" && value.length > 500) throw new Error("Chart data strings must not exceed 500 characters");
    }
  }
  for (const key of ["title", "subtitle", "caption", "x", "y", "y2", "value", "series", "group", "color", "size", "xLabel", "yLabel"]) {
    if (model[key] !== undefined && (typeof model[key] !== "string" || !model[key].trim() || model[key].length > 500)) {
      throw new Error(`Chart ${key} must be a non-empty string of at most 500 characters`);
    }
  }
  if (model.xScale !== undefined && !["linear", "log", "time", "utc", "ordinal", "band", "point"].includes(model.xScale)) throw new Error("Chart xScale is unsupported");
  if (model.yScale !== undefined && !["linear", "log", "time", "utc"].includes(model.yScale)) throw new Error("Chart yScale is unsupported");
  if (model.bins !== undefined && (!Number.isInteger(model.bins) || model.bins < 2 || model.bins > 100)) throw new Error("Chart bins must be an integer from 2 to 100");
  if (model.bandwidth !== undefined && (typeof model.bandwidth !== "number" || !Number.isFinite(model.bandwidth) || model.bandwidth <= 0)) throw new Error("Chart bandwidth must be a positive finite number");
  if (model.annotations !== undefined) {
    if (!Array.isArray(model.annotations) || model.annotations.length > 20) throw new Error("Chart annotations must contain at most 20 items");
    for (const annotation of model.annotations) {
      if (!annotation || typeof annotation !== "object" || Array.isArray(annotation) || typeof annotation.label !== "string" || typeof annotation.x !== "number" || typeof annotation.y !== "number") throw new Error("Each chart annotation requires numeric x/y and a label");
    }
  }
  if (model.references !== undefined) {
    if (!Array.isArray(model.references) || model.references.length > 10) throw new Error("Chart references must contain at most 10 items");
    for (const reference of model.references) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference) || !["x", "y"].includes(reference.axis) || typeof reference.value !== "number" || !Number.isFinite(reference.value)) throw new Error("Each chart reference requires axis x/y and a finite numeric value");
    }
  }
  return structuredClone(model);
}

registerBlockType({
  type: "check",
  version: 1,
  parse: parseCheck,
  toPlainText(/** @type {any} */ model) { return [model.question, ...model.options].join("\n"); },
  security: "sanitize-html",
});

registerBlockType({
  type: "chart",
  version: 1,
  parse: parseChart,
  toPlainText(/** @type {any} */ model) {
    const columns = [...new Set(model.data.flatMap((/** @type {Record<string, any>} */ row) => Object.keys(row)))];
    const rows = model.data.slice(0, 50).map((/** @type {Record<string, any>} */ row) => columns.map((column) => String(row[column] ?? "")).join("\t"));
    return [model.title || `${model.type} chart`, model.caption || "", columns.join("\t"), ...rows].filter(Boolean).join("\n");
  },
  security: "sanitize-html",
});
