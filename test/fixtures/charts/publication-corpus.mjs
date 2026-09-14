/**
 * Renderer-neutral cases that exercise the hard parts of publication charts.
 * Values are fictitious, deterministic, and intentionally small enough for CI.
 */

export const publicationRequirements = Object.freeze([
  "line",
  "step",
  "scatter",
  "bubble",
  "grouped-bar",
  "stacked-bar",
  "histogram",
  "density",
  "ecdf",
  "box",
  "violin",
  "error-bar",
  "confidence-band",
  "area",
  "stacked-area",
  "heatmap",
  "contour",
  "facet",
  "log-scale",
  "time-scale",
  "ordinal-scale",
  "annotation",
  "reference-line",
  "caption",
]);

const trend = [
  ["2021-01-01", 1.8, 1.3, 2.3],
  ["2022-01-01", 2.2, 1.7, 2.7],
  ["2023-01-01", 2.9, 2.3, 3.5],
  ["2024-01-01", 2.6, 2.0, 3.2],
  ["2025-01-01", 3.4, 2.8, 4.0],
].map(([date, estimate, low, high]) => ({ date, estimate, low, high }));

const observations = [
  1.1, 1.4, 1.6, 1.8, 2.0, 2.1, 2.2, 2.4, 2.5, 2.7,
  2.8, 2.9, 3.1, 3.2, 3.3, 3.5, 3.8, 4.0, 4.4, 5.1,
].map((value) => ({ value }));

const distributions = {
  Control: [1.0, 1.2, 1.4, 1.7, 1.8, 2.0, 2.1, 2.3, 2.7, 3.0],
  Policy: [1.5, 1.8, 2.0, 2.2, 2.5, 2.7, 2.8, 3.1, 3.4, 3.8],
};
const violin = Object.entries(distributions).flatMap(([group, values]) => values.map((value) => ({ group, value })));

const grouped = [
  ["North", "Baseline", 42], ["North", "Policy", 49],
  ["South", "Baseline", 35], ["South", "Policy", 44],
  ["West", "Baseline", 51], ["West", "Policy", 55],
].map(([region, scenario, value]) => ({ region, scenario, value }));

const heatmap = [];
for (const sector of ["Agriculture", "Industry", "Services"]) {
  for (const year of [2022, 2023, 2024, 2025]) {
    const sectorOffset = { Agriculture: -1.1, Industry: 0.4, Services: 1.2 }[sector];
    heatmap.push({ sector, year: String(year), value: Number((sectorOffset + (year - 2022) * 0.55).toFixed(2)) });
  }
}

const contour = [];
for (let x = -3; x <= 3; x += 0.3) {
  for (let y = -3; y <= 3; y += 0.3) {
    const value = Math.exp(-(x * x + y * y) / 3) + 0.45 * Math.exp(-((x - 1.3) ** 2 + (y + 1) ** 2));
    contour.push({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), value: Number(value.toFixed(5)) });
  }
}

export const publicationCases = Object.freeze([
  {
    id: "confidence-band",
    title: "Estimated effect with 95% confidence interval",
    caption: "Fictitious annual estimates; shaded region is the 95% confidence interval.",
    capabilities: ["line", "confidence-band", "time-scale", "annotation", "reference-line", "caption"],
    data: trend,
  },
  {
    id: "histogram",
    title: "Distribution of estimated effects",
    caption: "Fictitious observations grouped into equal-width bins.",
    capabilities: ["histogram", "reference-line", "caption"],
    data: observations,
  },
  {
    id: "violin",
    title: "Outcome distribution by study group",
    caption: "Fictitious outcomes; width represents kernel density.",
    capabilities: ["density", "violin", "facet", "caption"],
    data: violin,
  },
  {
    id: "grouped-bars",
    title: "Regional outcome by scenario",
    caption: "Fictitious scenario comparison with a common quantitative scale.",
    capabilities: ["grouped-bar", "facet", "ordinal-scale", "caption"],
    data: grouped,
  },
  {
    id: "heatmap",
    title: "Sector effect by year",
    caption: "Fictitious standardized effects; a diverging scale is centered on zero.",
    capabilities: ["heatmap", "ordinal-scale", "caption"],
    data: heatmap,
  },
  {
    id: "contour",
    title: "Bivariate response surface",
    caption: "Fictitious response surface shown as filled contours.",
    capabilities: ["contour", "caption"],
    data: contour,
  },
]);
