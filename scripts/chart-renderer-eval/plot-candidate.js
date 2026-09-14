import * as Plot from "@observablehq/plot";

const colors = ["#27628c", "#bb5b33", "#54814c", "#7c5aa6"];

function base(model) {
  return {
    width: 720,
    height: 430,
    marginLeft: 64,
    marginBottom: 52,
    style: { background: "white", color: "#171717", fontFamily: "system-ui, sans-serif", fontSize: "12px" },
    caption: model.caption,
  };
}

function kde(rows, group, bandwidth = 0.35) {
  const values = rows.filter((row) => row.group === group).map((row) => row.value);
  const output = [];
  for (let x = 0.5; x <= 4.3; x += 0.08) {
    const density = values.reduce((sum, value) => {
      const z = (x - value) / bandwidth;
      return sum + Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * bandwidth);
    }, 0) / values.length;
    output.push({ group, value: x, density });
  }
  return output;
}

function chart(model) {
  const options = { ...base(model), title: model.title };
  switch (model.id) {
    case "confidence-band": {
      const data = model.data.map((row) => ({ ...row, date: new Date(row.date) }));
      return Plot.plot({
        ...options,
        x: { type: "utc", label: "Year" },
        y: { grid: true, label: "Estimated effect" },
        marks: [
          Plot.ruleY([0], { stroke: "#777", strokeDasharray: "4,4" }),
          Plot.areaY(data, { x: "date", y1: "low", y2: "high", fill: colors[0], fillOpacity: 0.2 }),
          Plot.line(data, { x: "date", y: "estimate", stroke: colors[0], strokeWidth: 2 }),
          Plot.dot(data, { x: "date", y: "estimate", fill: colors[0], r: 3 }),
          Plot.text([data[2]], { x: "date", y: "estimate", text: () => "Policy introduced", dy: -14 }),
        ],
      });
    }
    case "histogram":
      return Plot.plot({
        ...options,
        x: { label: "Estimated effect" },
        y: { grid: true, label: "Count" },
        marks: [
          Plot.rectY(model.data, Plot.binX({ y: "count" }, { x: "value", thresholds: 7, fill: colors[0] })),
          Plot.ruleY([0]),
          Plot.ruleX([2.75], { stroke: colors[1], strokeDasharray: "4,4" }),
        ],
      });
    case "violin": {
      const densities = ["Control", "Policy"].flatMap((group) => kde(model.data, group));
      return Plot.plot({
        ...options,
        facet: { data: densities, x: "group" },
        fx: { label: null },
        x: { axis: null },
        y: { grid: true, label: "Outcome" },
        color: { domain: ["Control", "Policy"], range: colors, legend: false },
        marks: [
          Plot.areaX(densities, { y: "value", x1: (row) => -row.density, x2: "density", fill: "group", fillOpacity: 0.7 }),
          Plot.ruleX([0], { strokeOpacity: 0.35 }),
        ],
      });
    }
    case "grouped-bars":
      return Plot.plot({
        ...options,
        facet: { data: model.data, x: "region" },
        fx: { label: null },
        x: { label: null },
        y: { grid: true, label: "Outcome" },
        color: { domain: ["Baseline", "Policy"], range: colors, legend: true },
        marks: [Plot.barY(model.data, { x: "scenario", y: "value", fill: "scenario" }), Plot.ruleY([0])],
      });
    case "heatmap":
      return Plot.plot({
        ...options,
        x: { label: "Year" },
        y: { label: null },
        color: { type: "diverging", pivot: 0, scheme: "RdBu", legend: true },
        marks: [
          Plot.cell(model.data, { x: "year", y: "sector", fill: "value", inset: 0.5 }),
          Plot.text(model.data, { x: "year", y: "sector", text: (row) => row.value.toFixed(1), fill: "black" }),
        ],
      });
    case "contour":
      return Plot.plot({
        ...options,
        x: { label: "Input A" },
        y: { label: "Input B" },
        color: { scheme: "viridis", legend: true },
        marks: [Plot.contour(model.data, { x: "x", y: "y", value: "value", thresholds: 10, fill: "value", stroke: "white" })],
      });
    default:
      throw new Error(`Unsupported case ${model.id}`);
  }
}

export async function renderCase(model, container) {
  const output = chart(model);
  const svgs = output.matches?.("svg") ? [output] : [...output.querySelectorAll("svg")];
  const svg = svgs.sort((left, right) =>
    right.querySelectorAll("path, rect, circle, line, polygon").length - left.querySelectorAll("path, rect, circle, line, polygon").length
  )[0];
  if (!svg) throw new Error("Observable Plot produced no SVG");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", model.title);
  container.replaceChildren(output);
  return { svg: new XMLSerializer().serializeToString(svg) };
}
