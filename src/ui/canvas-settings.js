import { BUTTON_OPEN } from "../core/html/markup.js";
import {
  AUTO_TIDY_GRACE_DEFAULT,
  AUTO_TIDY_GRACE_STOPS,
  autoTidyEnabled,
  autoTidyGraceSeconds,
  LAYOUT_MODES,
  layoutMode,
  onPreferenceChange,
  setAutoTidyEnabled,
  setAutoTidyGraceSeconds,
  setLayoutMode,
} from "./preferences.js";

const LAYOUT_LABELS = { tree: "Tree", mindmap: "Mind map", "mindmap-balanced": "Balanced" };

export function formatAutoTidyGrace(seconds) {
  const value = Math.round(Number(seconds)) || AUTO_TIDY_GRACE_DEFAULT;
  if (value < 60 || value % 60 !== 0) return value + " s";
  return value / 60 + " min";
}

function canvasSettingsMarkup() {
  const layoutSegments = LAYOUT_MODES.map(function (value) {
    return (
      BUTTON_OPEN +
      ' type="button" class="settings-segment" role="radio" data-layout-choice="' +
      value +
      '" aria-checked="false" tabindex="-1">' +
      LAYOUT_LABELS[value] +
      "</button>"
    );
  }).join("");
  const layout =
    '<div class="settings-segmented" role="radiogroup" aria-labelledby="settings-layout-label">' +
    layoutSegments +
    "</div>";
  const enabled =
    '<span class="switch"><input type="checkbox" role="switch" data-tidy-enabled' +
    ' aria-labelledby="settings-auto-tidy-label"><span class="switch-track"></span></span>';
  // Reset sits before the stepper so its appearance never shifts the − / value /
  // + cluster the pointer is already over.
  const grace =
    '<div class="settings-stepper" role="group" aria-labelledby="settings-tidy-grace-label">' +
    BUTTON_OPEN +
    ' type="button" class="settings-reset" data-tidy-reset>Reset</button>' +
    BUTTON_OPEN +
    ' type="button" class="settings-step" data-tidy-step="-1" aria-label="Shorter fold delay">−</button>' +
    '<span class="settings-step-value" data-tidy-value aria-live="polite"></span>' +
    BUTTON_OPEN +
    ' type="button" class="settings-step" data-tidy-step="1" aria-label="Longer fold delay">+</button>' +
    "</div>";
  return (
    '<div class="settings-sheet-section">' +
    '<div class="settings-sheet-row" id="settings-layout-row">' +
    '<div class="settings-sheet-copy"><span class="settings-sheet-label" id="settings-layout-label">Layout</span>' +
    '<small class="settings-sheet-sub">How Tidy arranges cards. Mind map fans branches out horizontally; Balanced splits them either side of the root.</small></div>' +
    '<div class="settings-sheet-control">' +
    layout +
    "</div></div>" +
    '<div class="settings-sheet-row" id="settings-auto-tidy-row">' +
    '<div class="settings-sheet-copy"><span class="settings-sheet-label" id="settings-auto-tidy-label">Auto-tidy</span>' +
    '<small class="settings-sheet-sub">Folds branches you\'ve moved on from. Your current trail stays open.</small></div>' +
    '<div class="settings-sheet-control">' +
    enabled +
    "</div></div>" +
    '<div class="settings-sheet-row" id="settings-tidy-grace-row">' +
    '<div class="settings-sheet-copy"><span class="settings-sheet-label" id="settings-tidy-grace-label">Fold after</span></div>' +
    '<div class="settings-sheet-control">' +
    grace +
    "</div></div></div>"
  );
}

function graceInDirection(value, direction) {
  if (direction < 0) {
    for (let index = AUTO_TIDY_GRACE_STOPS.length - 1; index >= 0; index--) {
      if (AUTO_TIDY_GRACE_STOPS[index] < value) return AUTO_TIDY_GRACE_STOPS[index];
    }
    return AUTO_TIDY_GRACE_STOPS[0];
  }
  for (let index = 0; index < AUTO_TIDY_GRACE_STOPS.length; index++) {
    if (AUTO_TIDY_GRACE_STOPS[index] > value) return AUTO_TIDY_GRACE_STOPS[index];
  }
  return AUTO_TIDY_GRACE_STOPS[AUTO_TIDY_GRACE_STOPS.length - 1];
}

export function mountCanvasSettings(host) {
  host.innerHTML = canvasSettingsMarkup();
  const layoutSegments = Array.prototype.slice.call(host.querySelectorAll("[data-layout-choice]"));
  const enabled = host.querySelector("[data-tidy-enabled]");
  const graceRow = host.querySelector("#settings-tidy-grace-row");
  const value = host.querySelector("[data-tidy-value]");
  const reset = host.querySelector("[data-tidy-reset]");
  const shorter = host.querySelector('[data-tidy-step="-1"]');
  const longer = host.querySelector('[data-tidy-step="1"]');

  function syncLayout() {
    const current = layoutMode();
    layoutSegments.forEach(function (button) {
      const selected = button.dataset.layoutChoice === current;
      button.setAttribute("aria-checked", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function sync() {
    const on = autoTidyEnabled();
    const seconds = autoTidyGraceSeconds();
    enabled.checked = on;
    value.textContent = formatAutoTidyGrace(seconds);
    reset.hidden = seconds === AUTO_TIDY_GRACE_DEFAULT;
    graceRow.classList.toggle("settings-sheet-row-disabled", !on);
    shorter.disabled = !on || seconds <= AUTO_TIDY_GRACE_STOPS[0];
    longer.disabled = !on || seconds >= AUTO_TIDY_GRACE_STOPS[AUTO_TIDY_GRACE_STOPS.length - 1];
    reset.disabled = !on;
  }

  layoutSegments.forEach(function (button) {
    button.addEventListener("click", function () {
      setLayoutMode(button.dataset.layoutChoice);
    });
  });
  host.querySelector("[data-layout-choice]").parentElement.addEventListener("keydown", function (event) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(event.key) === -1) return;
    event.preventDefault();
    const current = Math.max(0, layoutSegments.indexOf(document.activeElement));
    const last = layoutSegments.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (current + 1) % layoutSegments.length
            : (current - 1 + layoutSegments.length) % layoutSegments.length;
    setLayoutMode(layoutSegments[next].dataset.layoutChoice);
    layoutSegments[next].focus({ preventScroll: true });
  });

  enabled.addEventListener("change", function () {
    setAutoTidyEnabled(enabled.checked);
  });
  host.querySelectorAll("[data-tidy-step]").forEach(function (button) {
    button.addEventListener("click", function () {
      setAutoTidyGraceSeconds(graceInDirection(autoTidyGraceSeconds(), Number(button.dataset.tidyStep)));
    });
  });
  reset.addEventListener("click", function () {
    setAutoTidyGraceSeconds(AUTO_TIDY_GRACE_DEFAULT);
  });

  const stopListening = onPreferenceChange(function (kind) {
    if (kind === "auto-tidy") sync();
    if (kind === "layout") syncLayout();
  });
  sync();
  syncLayout();
  return stopListening;
}

export function canvasSettingsSection() {
  return { id: "canvas", label: "Canvas", order: 3, mount: mountCanvasSettings };
}
