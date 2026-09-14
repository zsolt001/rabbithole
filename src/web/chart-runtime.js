let runtimePromise = null;
let sourcePromise = null;
const CHART_URL = "/chart-runtime.js";

export function loadChartRuntime() {
  if (globalThis.RabbitholeChartRuntime) return Promise.resolve(globalThis.RabbitholeChartRuntime);
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHART_URL;
      script.async = true;
      script.dataset.rabbitholeRuntime = "chart";
      script.addEventListener("load", () => globalThis.RabbitholeChartRuntime ? resolve(globalThis.RabbitholeChartRuntime) : reject(new Error("Chart runtime loaded without exposing its browser API")), { once: true });
      script.addEventListener("error", () => reject(new Error("Unable to load the chart runtime")), { once: true });
      document.head.appendChild(script);
    }).catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export function getChartSource() {
  if (!sourcePromise) {
    sourcePromise = fetch(CHART_URL, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Unable to load charts for the offline snapshot");
      return response.text();
    }).catch((error) => {
      sourcePromise = null;
      throw error;
    });
  }
  return sourcePromise;
}
