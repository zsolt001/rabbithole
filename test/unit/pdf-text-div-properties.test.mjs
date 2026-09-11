/** @protects pdf text-div geometry reconstruction capability contracts. */
import assert from "node:assert/strict";
import test from "node:test";
import { pdfTextDivProperties } from "../../src/core/pdf-shared.js";

// pdf.js 4.10 keeps the per-span {angle, canvasWidth, fontSize} on a private
// field of its TextLayer instance, but the reader still needs those three
// values to tune letter/word spacing and to skip rotated spans during native
// selection calibration. This helper reconstructs them from the text content
// item exactly as pdf.js's TextLayer#appendText does, so the reader keeps
// working after the standalone renderTextLayer/updateTextLayer functions were
// removed.

test("horizontal multi-character item exposes upright geometry and its scale width", () => {
  const props = pdfTextDivProperties(
    { str: "Attention", width: 69.8, height: 12, transform: [12, 0, 0, 12, 211.488, 626.359] },
    { vertical: false },
  );
  assert.equal(props.angle, 0, "upright text has no rotation");
  assert.equal(props.fontSize, 12, "fontSize is the transform's y-scale magnitude");
  assert.equal(props.canvasWidth, 69.8, "multi-character spans scale to their PDF-space width");
});

test("a rotated item reports its angle in degrees and its own font height", () => {
  // A 90°-rotated glyph run: transform = [0, s, -s, 0, ...].
  const props = pdfTextDivProperties(
    { str: "Sideways", width: 40, height: 10, transform: [0, 10, -10, 0, 50, 60] },
    { vertical: false },
  );
  assert.equal(props.angle, -90, "angle = atan2(-b, a) converted to degrees");
  assert.equal(props.fontSize, 10, "font height ignores rotation (hypot of the shear column)");
  assert.equal(props.canvasWidth, 40);
});

test("a single non-space character never scales, matching pdf.js shouldScaleText", () => {
  const props = pdfTextDivProperties(
    { str: "x", width: 8, height: 12, transform: [12, 0, 0, 12, 0, 0] },
    { vertical: false },
  );
  assert.equal(props.canvasWidth, 0, "one upright glyph keeps its natural width");
  assert.equal(props.fontSize, 12);
  assert.equal(props.angle, 0);
});

test("a single glyph with a >1.5x axis mismatch does scale", () => {
  const props = pdfTextDivProperties(
    { str: "W", width: 30, height: 10, transform: [30, 0, 0, 10, 0, 0] },
    { vertical: false },
  );
  assert.equal(props.canvasWidth, 30, "a squished single glyph is scaled back to its box");
});

test("vertical text rotates by a quarter turn and scales to its height", () => {
  const props = pdfTextDivProperties(
    { str: "縦書き", width: 12, height: 44, transform: [12, 0, 0, 12, 0, 0] },
    { vertical: true },
  );
  assert.equal(props.angle, 90, "vertical writing adds a quarter turn");
  assert.equal(props.canvasWidth, 44, "vertical spans scale to their PDF-space height");
});

test("a malformed item degrades to safe zeros instead of throwing", () => {
  const props = pdfTextDivProperties({ str: "", transform: null }, {});
  assert.deepEqual(props, { angle: 0, canvasWidth: 0, fontSize: 0 });
});
