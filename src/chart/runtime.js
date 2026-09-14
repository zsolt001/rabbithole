import * as Plot from "@observablehq/plot";

const DEFAULT_PALETTE = ["#27628c", "#bb5b33", "#54814c", "#7c5aa6", "#a06a8c", "#6d7278"];

function field(name) {
  return name || undefined;
}

function scale(type, label) {
  if (!type && !label) return undefined;
  return { ...(type ? { type } : {}), ...(label ? { label } : {}) };
}

function groupedMark(model) {
  return Plot.barY(model.data, {
    x: field(model.x),
    y: field(model.y),
    fill: field(model.series),
  });
}

function densityRows(model) {
  const groupField = model.group || model.series;
  const groups = groupField ? [...new Set(model.data.map((row) => row[groupField]))] : ["Distribution"];
  const values = model.data.map((row) => Number(row[model.y])).filter(Number.isFinite);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const bandwidth = model.bandwidth || span / Math.max(4, Math.sqrt(values.length));
  const rows = [];
  for (const group of groups) {
    const sample = model.data
      .filter((row) => !groupField || row[groupField] === group)
      .map((row) => Number(row[model.y]))
      .filter(Number.isFinite);
    for (let index = 0; index <= 80; index += 1) {
      const value = low - span * 0.05 + span * 1.1 * index / 80;
      const density = sample.reduce((sum, observation) => {
        const z = (value - observation) / bandwidth;
        return sum + Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * bandwidth);
      }, 0) / Math.max(1, sample.length);
      rows.push({ group, value, density });
    }
  }
  return rows;
}

function ecdfRows(model) {
  const groupField = model.group || model.series;
  const groups = groupField ? [...new Set(model.data.map((row) => row[groupField]))] : ["Distribution"];
  return groups.flatMap((group) => {
    const values = model.data
      .filter((row) => !groupField || row[groupField] === group)
      .map((row) => Number(row[model.x || model.y]))
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    return values.map((value, index) => ({ group, value, probability: (index + 1) / values.length }));
  });
}

function chartOptions(model, options) {
  const palette = options.palette?.length ? options.palette : DEFAULT_PALETTE;
  /** @type {any} */
  const base = {
    width: options.width || 720,
    height: options.height || 430,
    marginLeft: 58,
    marginBottom: 48,
    title: model.title,
    subtitle: model.subtitle,
    caption: model.caption,
    style: {
      background: options.background || "transparent",
      color: options.foreground || "currentColor",
      fontFamily: options.fontFamily || "system-ui, sans-serif",
      fontSize: "12px",
    },
    color: { range: palette, legend: Boolean(model.series || model.color || model.group) },
    x: scale(model.xScale, model.xLabel),
    y: scale(model.yScale, model.yLabel),
  };
  const marks = [];
  switch (model.type) {
    case "line":
    case "step":
      marks.push(Plot.line(model.data, { x: field(model.x), y: field(model.y), stroke: field(model.series), curve: model.type === "step" ? "step-after" : "linear" }));
      break;
    case "scatter":
    case "bubble":
      marks.push(Plot.dot(model.data, { x: field(model.x), y: field(model.y), r: model.type === "bubble" ? field(model.size) : 3, fill: field(model.color || model.series), fillOpacity: 0.75 }));
      break;
    case "bar":
    case "grouped-bar":
    case "stacked-bar":
      marks.push(groupedMark(model));
      break;
    case "histogram":
      marks.push(Plot.rectY(model.data, Plot.binX({ y: "count" }, { x: field(model.x), thresholds: model.bins || 20, fill: palette[0] })));
      break;
    case "density": {
      const rows = densityRows(model);
      marks.push(Plot.line(rows, { x: "value", y: "density", stroke: "group" }));
      break;
    }
    case "ecdf": {
      const rows = ecdfRows(model);
      marks.push(Plot.line(rows, { x: "value", y: "probability", stroke: "group", curve: "step-after" }));
      base.y = { domain: [0, 1], percent: true, label: model.yLabel || "Cumulative probability" };
      break;
    }
    case "box":
      marks.push(Plot.boxY(model.data, { x: field(model.x), y: field(model.y), fill: field(model.group || model.x) }));
      break;
    case "violin": {
      const rows = densityRows(model);
      base.facet = { data: rows, x: "group" };
      base.fx = { label: null };
      base.x = { axis: null };
      marks.push(Plot.areaX(rows, { y: "value", x1: (row) => -row.density, x2: "density", fill: "group", fillOpacity: 0.72 }));
      marks.push(Plot.ruleX([0], { strokeOpacity: 0.35 }));
      break;
    }
    case "error-bar":
      marks.push(Plot.ruleX(model.data, { x: field(model.x), y1: field(model.y), y2: field(model.y2), stroke: field(model.series) }));
      marks.push(Plot.dot(model.data, { x: field(model.x), y: field(model.value || model.y), fill: field(model.series) }));
      break;
    case "confidence-band":
      marks.push(Plot.areaY(model.data, { x: field(model.x), y1: field(model.y), y2: field(model.y2), fill: palette[0], fillOpacity: 0.2 }));
      marks.push(Plot.line(model.data, { x: field(model.x), y: field(model.value), stroke: palette[0], strokeWidth: 2 }));
      break;
    case "area":
    case "stacked-area":
      marks.push(Plot.areaY(model.data, { x: field(model.x), y: field(model.y), fill: field(model.series) || palette[0] }));
      break;
    case "heatmap":
      base.color = { type: "diverging", pivot: 0, scheme: "RdBu", legend: true };
      marks.push(Plot.cell(model.data, { x: field(model.x), y: field(model.y), fill: field(model.color || model.value), inset: 0.5 }));
      break;
    case "contour":
      base.color = { scheme: "viridis", legend: true };
      marks.push(Plot.contour(model.data, { x: field(model.x), y: field(model.y), value: field(model.value), thresholds: model.bins || 10, fill: "value", stroke: options.background || "white" }));
      break;
    default:
      throw new Error(`Unsupported chart type ${JSON.stringify(model.type)}`);
  }
  for (const reference of model.references || []) {
    marks.push(reference.axis === "x"
      ? Plot.ruleX([reference.value], { stroke: options.foreground || "currentColor", strokeDasharray: "4,4" })
      : Plot.ruleY([reference.value], { stroke: options.foreground || "currentColor", strokeDasharray: "4,4" }));
  }
  for (const annotation of model.annotations || []) {
    marks.push(Plot.text([annotation], { x: "x", y: "y", text: "label", dy: -10 }));
  }
  return { ...base, marks };
}

function mainSvg(output) {
  const svgs = output.matches?.("svg") ? [output] : [...output.querySelectorAll("svg")];
  return svgs.sort((left, right) => right.querySelectorAll("path, rect, circle, line, polygon").length - left.querySelectorAll("path, rect, circle, line, polygon").length)[0];
}

export function render(model, options = {}) {
  const output = Plot.plot(chartOptions(model, options));
  const svg = mainSvg(output);
  if (!svg) throw new Error("Chart renderer produced no SVG");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", model.title || `${model.type} chart`);
  return { output, svg };
}

globalThis.RabbitholeChartRuntime = { render };
