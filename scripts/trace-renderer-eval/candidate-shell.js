const SVG_NS = "http://www.w3.org/2000/svg";

export function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function button(label, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.dataset.action = action;
  element.textContent = label;
  return element;
}

export function createCandidateShell(container, presentation, options = {}) {
  container.className = `trace-candidate ${options.rendererClass || ""}`;
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", presentation.title);
  container.innerHTML = "";

  const header = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = presentation.title;
  const controls = document.createElement("div");
  controls.className = "trace-controls";
  const play = button("Play", "play");
  const previous = button("Previous", "previous");
  const next = button("Next", "next");
  const position = document.createElement("span");
  position.className = "trace-position";
  controls.append(play, previous, next, position);
  header.append(heading, controls);

  const stage = document.createElement("div");
  stage.className = "trace-stage";
  const caption = document.createElement("div");
  caption.className = "trace-caption";
  caption.setAttribute("aria-live", "polite");
  const legend = document.createElement("div");
  legend.className = "trace-legend";
  legend.innerHTML = '<span class="message">message</span><span class="processing">processing</span><span class="retry">retry</span><span class="failure">failure</span>';
  container.append(header, stage, caption, legend);

  let frameIndex = 0;
  let timer = null;
  let paintFrame = () => {};
  const reducedMotion = options.reducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    play.textContent = "Play";
  }

  function setFrame(index, animate = false) {
    frameIndex = Math.max(0, Math.min(presentation.frames.length - 1, Number(index) || 0));
    const frame = presentation.frames[frameIndex];
    position.textContent = `Step ${frameIndex + 1} of ${presentation.frames.length}`;
    previous.disabled = frameIndex === 0;
    next.disabled = frameIndex === presentation.frames.length - 1;
    caption.textContent = frame.caption;
    caption.dataset.eventType = frame.type;
    paintFrame(frame, animate && !reducedMotion);
    return frame;
  }

  function onControls(event) {
    const action = event.target.closest("button")?.dataset.action;
    if (action === "previous") {
      stop();
      setFrame(frameIndex - 1);
    } else if (action === "next") {
      stop();
      setFrame(frameIndex + 1, true);
    } else if (action === "play") {
      if (timer) stop();
      else {
        if (frameIndex === presentation.frames.length - 1) frameIndex = -1;
        play.textContent = "Pause";
        timer = setInterval(() => {
          if (frameIndex >= presentation.frames.length - 1) stop();
          else setFrame(frameIndex + 1, true);
        }, 550);
      }
    }
  }
  controls.addEventListener("click", onControls);

  return {
    stage,
    setPainter(nextPainter) {
      paintFrame = nextPainter;
      setFrame(0);
    },
    setFrame,
    stop,
    destroy() {
      stop();
      controls.removeEventListener("click", onControls);
      container.replaceChildren();
    },
  };
}

export function ensureCandidateStyles() {
  if (document.getElementById("trace-candidate-styles")) return;
  const style = document.createElement("style");
  style.id = "trace-candidate-styles";
  style.textContent = `
    :root{--trace-bg:#fff;--trace-card:#f7f7f8;--trace-text:#171717;--trace-muted:#777b82;--trace-line:#e5e5e7;--trace-blue:#315fbd;--trace-blue-soft:#e9eef9;--trace-yellow:#e8b934;--trace-orange:#c94d18;--trace-pink:#d7659b;--trace-red:#b42318;--trace-radius:14px;color-scheme:light}
    @media(prefers-color-scheme:dark){:root{--trace-bg:#171719;--trace-card:#242427;--trace-text:#f5f5f6;--trace-muted:#a4a4aa;--trace-line:#3b3b40;--trace-blue:#78a1ff;--trace-blue-soft:#263552;--trace-yellow:#f2c84c;--trace-orange:#ef713b;--trace-pink:#ee83b6;--trace-red:#ff8178;color-scheme:dark}}
    *{box-sizing:border-box}body{margin:0;background:var(--trace-bg);color:var(--trace-text);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.trace-candidate{display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;gap:18px;width:100%;height:100%;padding:24px;background:var(--trace-bg);overflow:hidden}.trace-candidate header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.trace-candidate h2{margin:0;font-size:24px;line-height:1.15}.trace-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.trace-controls button{border:1px solid var(--trace-line);border-radius:12px;padding:8px 13px;background:var(--trace-card);color:var(--trace-text);font:600 14px inherit;cursor:pointer}.trace-controls button[data-action=play]{background:var(--trace-text);color:var(--trace-bg)}.trace-controls button:disabled{opacity:.35;cursor:default}.trace-position{color:var(--trace-muted);font-size:14px;white-space:nowrap}.trace-stage{position:relative;min-width:0;min-height:0;overflow:hidden}.trace-caption{text-align:center;font-size:17px;font-weight:650}.trace-caption::before{content:attr(data-event-type);display:block;margin-bottom:4px;color:var(--trace-muted);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.trace-legend{display:flex;justify-content:center;gap:18px;color:var(--trace-muted);font-size:13px}.trace-legend span::before{content:"";display:inline-block;width:10px;height:10px;margin-right:7px;border-radius:50%;background:var(--trace-blue)}.trace-legend .processing::before{background:var(--trace-yellow)}.trace-legend .retry::before{background:var(--trace-pink)}.trace-legend .failure::before{background:var(--trace-red)}
    @media(max-width:600px){.trace-candidate{gap:10px;padding:14px}.trace-candidate header{display:grid}.trace-candidate h2{font-size:18px}.trace-controls{gap:5px}.trace-controls button{padding:6px 9px;font-size:12px}.trace-position{font-size:12px}.trace-caption{font-size:14px}.trace-legend{display:none}}
  `;
  document.head.appendChild(style);
}

export function nodeStatus(frame, node) {
  if (frame.activeNodes.includes(node.id)) return frame.type === "retry" ? "retry" : frame.statuses[node.id] || "active";
  return frame.statuses[node.id] || node.initialState;
}
