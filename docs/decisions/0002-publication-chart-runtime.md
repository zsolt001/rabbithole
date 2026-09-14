---
status: accepted
date: 2026-09-14
---

# Publication chart runtime

Rabbithole uses a strict, versioned `chart` fence translated into Observable
Plot. The Plot runtime is built as a separate browser asset and is included in
live pages and frozen snapshots only when a chart fence is present.

The decision follows a renderer bake-off against the same fictitious corpus:
confidence bands, histograms, violins, grouped bars, heatmaps, and contours.
Observable Plot rendered all six cases as accessible SVG with no network
requests in a 319 KB minified candidate bundle. Vega-Lite plus Vega rendered
five cases, lacked a contour primitive, and required an 808 KB minified bundle
plus a CSP expression interpreter. Observable Plot also preserves Node 18
support, while Vega-Lite 6 requires Node 20.

The accepted boundary is not arbitrary Plot configuration. Agents author the
Rabbithole-owned `chart` v1 JSON schema. Core validates its keys, row and source
limits, chart types, and scalar data before the separately loaded runtime sees
it. The runtime generates SVG and receives only host-owned theme values.

This choice accepts an approximately 326 KB tax for chart-bearing live pages
and snapshots. It avoids adding that runtime to the always-loaded live and
frozen clients, preserving their existing byte ceilings. Rendered SVG remains
derived content; Markdown JSON remains canonical.

The selected renderer's corpus evaluation remains executable through
`npm run evaluate:charts`; the rejected Vega-Lite prototype and its roughly
490 KB of additional development dependencies are not retained. Production
depends on the pinned Observable Plot version selected here.
