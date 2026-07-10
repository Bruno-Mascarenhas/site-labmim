/**
 * Web Worker: Color Computation
 *
 * Offloads the CPU-intensive color interpolation from the main thread.
 * Receives an array of values + scale configuration, returns an array
 * of computed CSS color strings.
 *
 * Message protocol:
 *   Input:  { requestId: number, values: number[], scaleValues: number[], colors: string[] }
 *   Output: { requestId: number, colors: string[] }
 */

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function interpolateColor(palette, paletteRgb, factor) {
  const index = factor * (palette.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const f = index - lower;

  if (lower === upper) return palette[lower];

  const c1 = paletteRgb[lower];
  const c2 = paletteRgb[upper];

  return `rgb(${Math.round(c1.r + (c2.r - c1.r) * f)}, ${Math.round(c1.g + (c2.g - c1.g) * f)}, ${Math.round(c1.b + (c2.b - c1.b) * f)})`;
}

function colorFromScale(value, scaleValues, palette, paletteRgb) {
  if (!scaleValues || scaleValues.length === 0) return palette[0];
  if (value < scaleValues[0]) return palette[0];
  if (value > scaleValues[scaleValues.length - 1]) return palette[palette.length - 1];

  for (let i = 0; i < scaleValues.length - 1; i++) {
    if (value >= scaleValues[i] && value < scaleValues[i + 1]) {
      const ratio = (value - scaleValues[i]) / (scaleValues[i + 1] - scaleValues[i]);
      return interpolateColor(palette, paletteRgb, (i + ratio) / (scaleValues.length - 1));
    }
  }
  return palette[palette.length - 1];
}

self.onmessage = function (e) {
  const { requestId, values, scaleValues, colors: palette } = e.data;
  const result = new Array(values.length);

  // Parse the palette hex strings ONCE per message instead of running the
  // regex twice per interpolated cell (~20k regex executions per frame for
  // a 9801-cell domain — measured ~5x slower). Values are quantized to 2
  // decimals, so memoizing per distinct value skips most interpolations
  // too. Both caches are per-message: palette and scale change with the
  // selected variable.
  const paletteRgb = palette.map(hexToRgb);
  const memo = new Map();

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== undefined && v !== null) {
      let color = memo.get(v);
      if (color === undefined) {
        color = colorFromScale(v, scaleValues, palette, paletteRgb);
        memo.set(v, color);
      }
      result[i] = color;
    }
    // else result[i] remains undefined
  }

  self.postMessage({ requestId, colors: result });
};
