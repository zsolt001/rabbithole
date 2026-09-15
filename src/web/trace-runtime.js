let runtimePromise = null;
let sourcePromise = null;
const TRACE_URL = "/trace-runtime.js";

export function loadTraceRuntime() {
  if (globalThis.RabbitholeTraceRuntime) return Promise.resolve(globalThis.RabbitholeTraceRuntime);
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TRACE_URL;
      script.async = true;
      script.dataset.rabbitholeRuntime = "trace";
      script.addEventListener("load", () => globalThis.RabbitholeTraceRuntime ? resolve(globalThis.RabbitholeTraceRuntime) : reject(new Error("Trace runtime loaded without exposing its browser API")), { once: true });
      script.addEventListener("error", () => reject(new Error("Unable to load the trace runtime")), { once: true });
      document.head.appendChild(script);
    }).catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export function getTraceSource() {
  if (!sourcePromise) {
    sourcePromise = fetch(TRACE_URL, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Unable to load traces for the offline snapshot");
      return response.text();
    }).catch((error) => {
      sourcePromise = null;
      throw error;
    });
  }
  return sourcePromise;
}
