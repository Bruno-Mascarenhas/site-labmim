/**
 * MONITORAMENTO
 *
 * Controller for the live monitoring page. Reads the `labmim-monitoring-v1`
 * document from the directory declared in `dataset.paths.monitoring` and draws,
 * for each variable, the rolling 7-day window in THREE LAYERS: the raw datalogger
 * samples, the hourly aggregate over them, and the WRF series where the model
 * carries that variable.
 *
 * Contracts this file relies on:
 *
 * - Nothing is computed here. Aggregation, quality control and window trimming
 *   arrive ready from the Python exporter (`labmim-monitoring`); the page only
 *   picks what to show.
 * - Each layer publishes its time axis as `start` + `step_minutes` + `count`
 *   instead of a list of dates, with values in a parallel array and `null` for
 *   intervals without observation. That is what keeps the document near 160 kB.
 * - The `start` stamps are STATION LOCAL TIME, with no timezone. Reading them with
 *   `new Date("...")` would shift the whole series by the VIEWER's offset, so they
 *   go through `Date.UTC` and come back out through `getUTC*`: the axis is plain
 *   arithmetic over station time and the visitor's browser never takes part.
 * - Nothing here is publication-specific. The directory comes from the
 *   `data-monitoring-base` attribute, and every label, unit, axis limit and caveat
 *   comes from the JSON, so a publication with its own station reuses the whole
 *   page by publishing its own data.
 * - The directory holds operational data: in a development checkout and in CI it is
 *   empty, and the page has to say so instead of breaking.
 */

"use strict";

(function () {
  // Pairs validated with scripts/validate_palette.js from the visualization guide,
  // the same ones the climatology page uses (lightness band, chroma floor,
  // colorblind separation and contrast against the surface).
  //
  // HOW COLOR CARRIES MEANING, and why there are two rules:
  //
  // - In a single-quantity chart hue is free, so it carries the distinction that
  //   matters most there: BLUE is measured, ORANGE is the model.
  // - In the radiation balance hue is already taken — it says which family the
  //   term belongs to (net, shortwave, longwave) — and flux direction moves to the
  //   stroke (solid goes down, dashed goes up). That leaves DOTTED for the model,
  //   which therefore borrows the hue of the term it mirrors.
  //
  // This is deliberately the same encoding as the `labmim-site-graphs` PNGs: both
  // products come from the same archive and must be read the same way.
  //
  // `raw` is achromatic on purpose rather than a fourth color: it is not another
  // quantity, it is the same one before aggregation. Grey recedes under the hourly
  // line, competes with no hue, and separates from blue and orange under every kind
  // of color blindness — the same role grey plays in the PNGs.
  const PALETTE = {
    light: { station: "#3761b4", model: "#e07a1f", net: "#3761b4", shortwave: "#e07a1f", longwave: "#1a7f5a" },
    dark: { station: "#5589e6", model: "#cb8030", net: "#5589e6", shortwave: "#cb8030", longwave: "#31a37a" },
  };

  const RAW_COLOR = { light: "#8a929c", dark: "#79828d" };

  const RAW_LABEL = "Bruto 5 min";

  const LAYERS = [
    { id: "raw", label: RAW_LABEL },
    { id: "hourly", label: "Média horária" },
    { id: "wrf", label: "WRF" },
  ];

  // Slices of the published window, counted back from its end. The document always
  // carries seven days; these only narrow what is drawn, never fetch another file.
  const WINDOWS = [
    { id: "7d", label: "7 dias", days: 7 },
    { id: "3d", label: "3 dias", days: 3 },
    { id: "1d", label: "24 horas", days: 1 },
  ];

  const MINUTE_MS = 60000;
  const DAY_MS = 86400000;

  const state = {
    base: "",
    payload: null,
    layers: new Set(["raw", "hourly", "wrf"]),
    windowId: "7d",
    charts: new Map(),
    canvases: new Map(),
    layerLabels: new Map(),
    notices: new Map(),
    downloads: new Map(),
    // Cards the observer has already asked to draw. `redrawAll` works from this
    // recorded intent instead of from `charts`, because a chart leaves `charts`
    // whenever no selected layer has data for it and the observer only fires again
    // when the card crosses the margin it watches.
    revealed: new Set(),
  };

  const el = (id) => document.getElementById(id);

  // ─── Formatting ───────────────────────────────────────────────────────────
  // pt-BR throughout (decimal comma), as in the rest of the site.

  function decimal(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  /**
   * Enough decimals for the unit. Rain needs THREE: the tipping bucket counts in
   * steps of 0.254 mm, and rounding to two would print "0,25" — the same reason the
   * exporter keeps three in `_DECIMALS`. Irradiance needs none, because a tenth of
   * a W/m² is noise.
   */
  function unitDigits(unit) {
    if (unit === "mm") return 3;
    if (unit === "W/m²") return 0;
    return 1;
  }

  // ─── Time ─────────────────────────────────────────────────────────────────
  // All arithmetic runs in "pretend UTC": the station stamp goes in through
  // Date.UTC and comes out through getUTC*, so nothing here depends on the
  // browser's timezone. See the contract note at the top of the file.

  // Two spellings, because the payload has two origins: layer axes come from a
  // pandas Timestamp (`2022-07-01 00:00:00`) and the publication stamp from a
  // compact strftime (`20260809T121500Z`).
  const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
  const COMPACT_STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/;

  function parseStationTime(text) {
    const value = String(text);
    const parts = STAMP.exec(value) || COMPACT_STAMP.exec(value);
    if (!parts) return NaN;
    return Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], parts[6] ? +parts[6] : 0);
  }

  const pad = (value) => String(value).padStart(2, "0");

  function formatDay(ms) {
    const date = new Date(ms);
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
  }

  function formatHour(ms) {
    const date = new Date(ms);
    return `${pad(date.getUTCHours())}h`;
  }

  function formatStamp(ms) {
    const date = new Date(ms);
    return `${formatDay(ms)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  /**
   * Stamp WITH the year, for the page header.
   *
   * Axis ticks and tooltips stay on day/month — that is what fits in a tick, and
   * the year would be the same information repeated hundreds of times. But the
   * header is the only place that says WHEN the drawn window is, and the page
   * presents itself as refreshed hourly: without the year, a document that stalled
   * years ago reads exactly like today's.
   */
  function formatStampYear(ms) {
    const date = new Date(ms);
    return `${formatDay(ms)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  // ─── Theme ────────────────────────────────────────────────────────────────

  function isDark() {
    return document.documentElement.classList.contains("dark-theme");
  }

  function themeColors() {
    const root = getComputedStyle(document.documentElement);
    const series = isDark() ? PALETTE.dark : PALETTE.light;
    return {
      series,
      raw: isDark() ? RAW_COLOR.dark : RAW_COLOR.light,
      textSecondary: root.getPropertyValue("--text-secondary").trim() || "#888",
      legendText: root.getPropertyValue("--chart-legend-color").trim() || "#666",
      grid: root.getPropertyValue("--chart-grid-color").trim() || "#f0f0f0",
      tooltipBg: root.getPropertyValue("--tooltip-bg").trim() || "rgba(18, 18, 18, 0.96)",
      tooltipText: root.getPropertyValue("--tooltip-text").trim() || "#fff",
      crosshair: isDark() ? "rgba(255, 255, 255, 0.32)" : "rgba(0, 0, 0, 0.24)",
    };
  }

  function fade(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  // ─── Document layers ──────────────────────────────────────────────────────

  /**
   * Layer label AS IT READS IN THIS CHART.
   *
   * The layer button is global and therefore generic, but the hourly aggregate is
   * not always a mean: where the exporter declares `kind: "bar"` it is the hour's
   * accumulation (the hourly rain series is the sum of the twelve samples, not
   * their mean). Calling that a "mean" in the CSV header and in the chart's text
   * alternative would hand a total out under the name of a rate.
   */
  function layerLabel(chart, layer) {
    if (layer.id === "hourly" && chart.kind === "bar") return "Soma horária";
    return layer.label;
  }

  /** Visible slice: the last N days of the published window. */
  function windowStart() {
    const selected = WINDOWS.find((entry) => entry.id === state.windowId) || WINDOWS[0];
    // Anchored at the end of the STATION RECORD, not the end of the document.
    // `window.end` means "end of what this document carries" and runs ahead of the
    // station whenever the model forecast extends the window, so anchoring there
    // would make the 7-day view `model_end − 7d` and push real observations that
    // are in the payload out of sight. `station_end` is additive; the fallback
    // keeps older artifacts, which do not carry it, working.
    const anchor = parseStationTime(state.payload.window.station_end || state.payload.window.end);
    return anchor - selected.days * DAY_MS;
  }

  /**
   * Turns a layer into {x, y} points, already trimmed to the chosen window.
   *
   * The payload's `null`s are kept as null-valued points instead of dropped: with
   * `spanGaps` off, that is what makes a data outage show up as a hole in the line
   * rather than a straight segment bridging an interruption that may have lasted
   * hours.
   */
  function layerPoints(layer, seriesId, from) {
    const values = layer && layer.series ? layer.series[seriesId] : null;
    if (!values) return null;
    const start = parseStationTime(layer.axis.start);
    const step = layer.axis.step_minutes * MINUTE_MS;
    const points = [];
    let finiteCount = 0;
    for (let index = 0; index < values.length; index += 1) {
      const x = start + index * step;
      if (x < from) continue;
      const y = values[index];
      if (typeof y === "number" && Number.isFinite(y)) finiteCount += 1;
      points.push({ x, y });
    }
    // A series that resolves but is entirely null inside the window must not become
    // a dataset. Chart.js accepts the all-null array and draws nothing under a
    // legend entry, and a legend entry with no mark reads as "the line exists and
    // left the scale", which is worse than a declared absence. `points.length`
    // cannot tell the two apart, because it counts the nulls.
    return finiteCount ? points : null;
  }

  /**
   * Same rule as `layerPoints`, without materialising the points, bailing out at
   * the first finite value — cheap enough to ask on every redraw.
   */
  function layerHasData(layer, seriesId, from) {
    const values = layer && layer.series ? layer.series[seriesId] : null;
    if (!values) return false;
    const start = parseStationTime(layer.axis.start);
    const step = layer.axis.step_minutes * MINUTE_MS;
    for (let index = 0; index < values.length; index += 1) {
      if (start + index * step < from) continue;
      const value = values[index];
      if (typeof value === "number" && Number.isFinite(value)) return true;
    }
    return false;
  }

  /**
   * The series each layer actually draws. The raw layer enters once only: it is the
   * ground the others are read against, and one entry per term would repeat the
   * same information. Shared so that the card's label and the canvas agree by
   * construction rather than by maintenance.
   */
  function layerSeriesIds(chart, layerId) {
    return layerId === "raw" ? [chart.series[0].id] : chart.series.map((series) => series.id);
  }

  // ─── Datasets ─────────────────────────────────────────────────────────────

  /**
   * In a single-series chart hue is free and carries the measured/model pair; with
   * more than one, hue is the physical family declared by the exporter. See the
   * PALETTE note.
   */
  function seriesColor(chart, series, theme) {
    if (chart.series.length === 1) return theme.series.station;
    return theme.series[series.hue] || theme.series.station;
  }

  /**
   * With a single series hue is free and orange marks "this is not a measurement";
   * with several, hue already names the family, so the model inherits the hue of
   * the term it mirrors and is told apart by the dotted stroke.
   */
  function modelColor(chart, series, theme) {
    return chart.series.length === 1 ? theme.series.model : seriesColor(chart, series, theme);
  }

  /**
   * Per-point radii that reveal an ISOLATED READING in a layer drawn as a line.
   *
   * A lone value between gaps draws nothing: with `spanGaps` off it has no
   * neighbour to form a segment with, and the point radius is zero because two
   * thousand dots on a full series would smear. A sensor that comes back for an
   * hour and drops again produces exactly this stranded point.
   *
   * Returns the scalar 0 when no point is stranded, so the common case — a
   * continuous series — carries no array at all.
   */
  function isolatedRadii(points, radius) {
    const finite = (point) => Boolean(point) && typeof point.y === "number" && Number.isFinite(point.y);
    let hasIsolated = false;
    const radii = points.map((point, index) => {
      if (!finite(point) || finite(points[index - 1]) || finite(points[index + 1])) return 0;
      hasIsolated = true;
      return radius;
    });
    return hasIsolated ? radii : 0;
  }

  function baseDataset(extra) {
    return {
      borderJoinStyle: "round",
      spanGaps: false,
      normalized: true,
      ...extra,
    };
  }

  /**
   * Grows the MARKS, never the data.
   *
   * Two independent factors, and keeping them apart is the point. `stroke` moves
   * line width and dash pattern; `point` moves the sample radius. In the grid only
   * the stroke grows: the raw layer is a cloud of ~2000 samples that the hourly
   * line crosses to be compared against, and fattening the points along with it
   * would close the cloud into a blot. In the dialog both grow, because the canvas
   * there has several times the area and the whole mark shrank in proportion.
   */
  function scaleMarks(datasets, { stroke = 1, point = 1 } = {}) {
    if (stroke === 1 && point === 1) return datasets;
    const by = (factor) => (value) =>
      typeof value === "number" && value > 0 ? Math.round(value * factor * 100) / 100 : value;
    const growStroke = by(stroke);
    const growPoint = by(point);
    return datasets.map((dataset) => ({
      ...dataset,
      borderWidth: growStroke(dataset.borderWidth),
      pointRadius: Array.isArray(dataset.pointRadius)
        ? dataset.pointRadius.map(growPoint)
        : growPoint(dataset.pointRadius),
      pointHoverRadius: growPoint(dataset.pointHoverRadius),
      borderDash: Array.isArray(dataset.borderDash) ? dataset.borderDash.map(growStroke) : dataset.borderDash,
    }));
  }

  function rawDataset(chart, color, points) {
    // Rain is not an instantaneous sample but the interval's accumulation: a cloud
    // of dots would read as "that much rain fell at that instant". Thin line, as in
    // the PNG.
    if (chart.kind === "bar") {
      return baseDataset({
        type: "line",
        label: RAW_LABEL,
        data: points,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 1,
        pointRadius: isolatedRadii(points, 1.5),
        pointHoverRadius: 0,
        order: 6,
      });
    }
    return baseDataset({
      type: "line",
      label: RAW_LABEL,
      data: points,
      borderColor: "transparent",
      backgroundColor: fade(color, 0.85),
      borderWidth: 0,
      showLine: false,
      pointRadius: 1.5,
      pointHoverRadius: 3.5,
      pointBorderWidth: 0,
      order: 6,
    });
  }

  function hourlyDataset(chart, series, color, points) {
    if (chart.kind === "bar") {
      return baseDataset({
        type: "bar",
        label: series.label,
        data: points,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 0,
        borderRadius: 3,
        borderSkipped: "bottom",
        order: 3,
      });
    }
    if (chart.kind === "scatter") {
      return baseDataset({
        type: "line",
        label: series.label,
        data: points,
        borderColor: "transparent",
        backgroundColor: color,
        showLine: false,
        pointRadius: 2.6,
        pointHoverRadius: 5,
        pointBorderWidth: 0,
        order: 3,
      });
    }
    return baseDataset({
      type: "line",
      label: series.label,
      data: points,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: isolatedRadii(points, 2.6),
      pointHoverRadius: 4,
      // Dashed for upward terms of the balance: hue there already names the
      // family, so flux direction needs a channel of its own.
      borderDash: series.direction === "up" ? [7, 4] : [],
      tension: 0.2,
      order: 3,
    });
  }

  function wrfDataset(chart, series, color, points) {
    const dotted = chart.kind === "scatter";
    return baseDataset({
      type: "line",
      label: `${series.label} — WRF`,
      data: points,
      borderColor: dotted ? "transparent" : color,
      backgroundColor: color,
      borderWidth: 2,
      // Dotted = model, in every chart. It is the third channel, the one left
      // after hue (family) and dash (direction).
      borderDash: [2, 3],
      showLine: !dotted,
      pointRadius: dotted ? 2.6 : isolatedRadii(points, 2.6),
      pointHoverRadius: dotted ? 5 : 4,
      pointStyle: "rect",
      pointBorderWidth: 0,
      tension: 0.2,
      order: 1,
    });
  }

  /**
   * Builds a chart's datasets in drawing order: raw at the bottom, hourly over it,
   * model on top.
   *
   * In a multi-series chart (the balance) the raw layer is the FIRST term's only:
   * five clouds of ~2000 points smear into a blot and hide the very lines meant to
   * be compared. Same choice as the PNG, and the payload still carries the raw data
   * of every term for whoever downloads the CSV.
   */
  function buildDatasets(chart, theme) {
    const from = windowStart();
    const datasets = [];
    if (state.layers.has("raw")) {
      const points = layerPoints(chart.layers.raw, chart.series[0].id, from);
      if (points) datasets.push(rawDataset(chart, theme.raw, points));
    }
    for (const series of chart.series) {
      if (state.layers.has("hourly")) {
        const points = layerPoints(chart.layers.hourly, series.id, from);
        if (points) {
          const dataset = hourlyDataset(chart, series, seriesColor(chart, series, theme), points);
          // The only layer stamped by INTERVAL: the stamp is the start of the hour
          // it summarises. `otherSeriesAt` needs this to read the hour containing
          // the hovered instant instead of the neighbouring one.
          dataset.labmimInterval = true;
          datasets.push(dataset);
        }
      }
    }
    for (const series of chart.series) {
      if (state.layers.has("wrf")) {
        const points = layerPoints(chart.layers.wrf, series.id, from);
        if (points) datasets.push(wrfDataset(chart, series, modelColor(chart, series, theme), points));
      }
    }
    return datasets;
  }

  // ─── Chart ────────────────────────────────────────────────────────────────

  /**
   * Vertical thread under the cursor. Chart.js 3.9 ships none, and without it
   * reading one instant across nine stacked charts becomes guesswork.
   */
  const crosshair = {
    id: "labmimCrosshair",
    afterDatasetsDraw(instance, _args, options) {
      const active = instance.tooltip && instance.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const { ctx, chartArea } = instance;
      const x = active[0].element.x;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = options.color;
      ctx.stroke();
      ctx.restore();
    },
  };

  /**
   * Legend swatches that reproduce the line's stroke instead of dots.
   *
   * With the Chart.js default, "Onda curta ↓" and "Onda curta ↑" become two
   * identical orange circles: flux direction lives in the stroke, and the stroke
   * does not reach the swatch. Here the box is drawn with the dataset's own
   * `borderDash`, so solid/dashed/dotted — downward measurement, upward measurement
   * and model — are told apart in the legend too.
   */
  function legendLabels(instance) {
    return instance.data.datasets.map((dataset, index) => {
      const stroked = dataset.borderColor && dataset.borderColor !== "transparent";
      const color = stroked ? dataset.borderColor : dataset.backgroundColor;
      // Filled swatch where the mark itself is filled — bars and point clouds — and
      // hollow where the mark is a line, so the border's dash shows through.
      const filled = dataset.type === "bar" || !stroked;
      return {
        text: dataset.label,
        fillStyle: filled ? color : "transparent",
        strokeStyle: color,
        lineDash: dataset.borderDash || [],
        lineWidth: filled ? 1 : 2,
        hidden: !instance.isDatasetVisible(index),
        datasetIndex: index,
      };
    });
  }

  /**
   * Values of the other visible series at the SAME instant as the hovered point.
   *
   * The lookup is by index rather than by scanning: the layers are regular grids,
   * so a stamp sits at `(x - start) / step`. That O(1) per series is what makes it
   * affordable on every mouse move over 2000 points.
   */
  function otherSeriesAt(items, digits, unit) {
    if (!items.length) return [];
    const hovered = items[0];
    // A Chart.js hit returns EVERY series tied at the smallest distance in x, not
    // just one: the hourly and WRF layers share the 60-minute grid, so on a round
    // hour all their datasets tie. The tooltip body already prints one line per tied
    // series, so the whole set has to stay out here — skipping only the first would
    // repeat each of those values twice.
    const shown = new Set(items.map((item) => item.datasetIndex));
    const stamp = hovered.parsed.x;
    const lines = [];
    hovered.chart.data.datasets.forEach((dataset, index) => {
      if (shown.has(index)) return;
      if (!hovered.chart.isDatasetVisible(index)) return;
      const points = dataset.data;
      if (!points.length) return;
      const step = points.length > 1 ? points[1].x - points[0].x : 0;
      if (!step) return;
      const offset = (stamp - points[0].x) / step;
      // A match means the hovered instant falls INSIDE that sample's interval, not
      // that the stamps are equal. The layers run at different cadences — twelve
      // raw points per hour against one hourly point — and demanding equality would
      // leave the list empty at eleven of every twelve positions.
      //
      // Two rules, because there are two stamp semantics. The hourly layer
      // summarises an INTERVAL and its stamp is the start of it (the exporter builds
      // it with `resample`, which labels on the left), so the hour CONTAINING the
      // instant is the floor: rounding would make 05:40 read the mean of
      // [06:00, 07:00), and on the rain chart the sum of an hour with no rain. The
      // instantaneous layers — raw and WRF, whose semantics the document does not
      // declare — stay on the nearest stamp.
      const position = dataset.labmimInterval ? Math.floor(offset) : Math.round(offset);
      const point = points[position];
      if (!point || point.y === null) return;
      const inside = dataset.labmimInterval
        ? stamp >= point.x && stamp < point.x + step
        : Math.abs(point.x - stamp) <= step / 2;
      if (!inside) return;
      lines.push(`${dataset.label}: ${decimal(point.y, digits)} ${unit}`.trim());
    });
    return lines;
  }

  function tickCallback(value) {
    const date = new Date(value);
    return date.getUTCHours() === 0 ? formatDay(value) : formatHour(value);
  }

  // Axis tick spacing in hours, per slice. Fixed rather than automatic because
  // Chart.js would pick round multiples of milliseconds, which land on broken
  // hours: a seven-day axis has to tick midnight, not 22h.
  const TICK_HOURS = { "7d": 24, "3d": 12, "1d": 3 };

  function alignedTicks(min, max) {
    const step = (TICK_HOURS[state.windowId] || 24) * 3600000;
    const ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push({ value });
    return ticks;
  }

  const GRID_MARKS = Object.freeze({ stroke: 1.25, point: 1 });
  const ZOOM_MARKS = Object.freeze({ stroke: 1.6, point: 1.6 });

  function chartConfig(chart, theme, { marks = GRID_MARKS } = {}) {
    const digits = unitDigits(chart.unit);
    const datasets = scaleMarks(buildDatasets(chart, theme), marks);
    return {
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Nine charts of up to ~2000 points each: animating their entrance costs
        // more than it gives, and every layer toggle would redraw sluggishly.
        animation: false,
        parsing: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          labmimCrosshair: { color: theme.crosshair },
          legend: {
            display: datasets.length > 1,
            position: "top",
            labels: {
              color: theme.legendText,
              boxWidth: 26,
              // Dataset order, not drawing order. `order` pushes the raw layer to
              // the back of the canvas, and it would drag the legend along with it,
              // listing the model before the measurement it mirrors.
              sort: (left, right) => left.datasetIndex - right.datasetIndex,
              generateLabels: legendLabels,
            },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.series.station,
            borderWidth: 1,
            callbacks: {
              title: (items) => formatStamp(items[0].parsed.x),
              label: (item) => `${item.dataset.label}: ${decimal(item.parsed.y, digits)} ${chart.unit}`.trim(),
              // A Chart.js hit returns only what is nearest in x, which in a
              // seven-series chart answers the wrong question: on the balance what
              // is wanted is the whole instant, the five terms and the model side by
              // side. The rest are looked up by the hovered stamp and listed below.
              afterBody: (items) => otherSeriesAt(items, digits, chart.unit),
            },
          },
        },
        scales: {
          x: {
            // Linear scale rather than time: no date adapter is vendored, and none
            // is needed — the axis is station time, which here is arithmetic over
            // milliseconds and not a timezone.
            type: "linear",
            min: windowStart(),
            max: parseStationTime(state.payload.window.end),
            afterBuildTicks: (axis) => {
              axis.ticks = alignedTicks(axis.min, axis.max);
            },
            ticks: {
              color: theme.textSecondary,
              autoSkip: false,
              maxRotation: 0,
              callback: tickCallback,
            },
            grid: { display: false },
          },
          y: {
            min: chart.y_limits ? chart.y_limits[0] : undefined,
            max: chart.y_limits ? chart.y_limits[1] : undefined,
            beginAtZero: chart.kind === "bar",
            title: { display: Boolean(chart.unit), text: chart.unit, color: theme.textSecondary },
            ticks: { color: theme.textSecondary, maxTicksLimit: 7 },
            grid: { color: theme.grid },
          },
        },
      },
    };
  }

  function drawChart(chart) {
    const canvas = state.canvases.get(chart.id);
    if (!canvas) return;
    const existing = state.charts.get(chart.id);
    if (existing) {
      existing.destroy();
      state.charts.delete(chart.id);
    }
    const config = chartConfig(chart, themeColors());
    syncCardText(chart, config.data.datasets.length);
    if (!config.data.datasets.length) return;
    state.charts.set(chart.id, new Chart(canvas.getContext("2d"), { type: "line", ...config, plugins: [crosshair] }));
  }

  function redrawAll() {
    for (const chart of state.payload.charts) {
      if (state.revealed.has(chart.id)) drawChart(chart);
    }
  }

  // ─── CSV ──────────────────────────────────────────────────────────────────

  /**
   * One row per instant of the finest layer present, one column per series/layer.
   * This is the chart's text alternative and the route for anyone who wants the
   * numbers — including the raw layers the drawing leaves out.
   */
  function exportCsv(chart) {
    const from = windowStart();
    const columns = [];
    for (const series of chart.series) {
      for (const layer of LAYERS) {
        const points = layerPoints(chart.layers[layer.id], series.id, from);
        if (points) columns.push({ header: `${series.label} (${layerLabel(chart, layer)})`, points });
      }
    }
    if (!columns.length) return;

    const stamps = new Set();
    for (const column of columns) for (const point of column.points) stamps.add(point.x);
    const ordered = [...stamps].sort((left, right) => left - right);
    const lookup = columns.map((column) => new Map(column.points.map((point) => [point.x, point.y])));

    const header = ["instante", ...columns.map((column) => `${column.header} [${chart.unit}]`)];
    const rows = [header.join(";")];
    for (const stamp of ordered) {
      const date = new Date(stamp);
      const iso =
        `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
      const cells = lookup.map((values) => {
        const value = values.get(stamp);
        // Decimal comma with `;` as the field separator, which is what Excel in
        // pt-BR opens without going through the import wizard.
        return value === undefined || value === null ? "" : String(value).replace(".", ",");
      });
      // An instant where NO column has a reading is not a row. The union of stamps
      // comes from the published time grid, which the exporter keeps full even with
      // the sensor down, so an outage would otherwise fill the sheet with
      // `stamp;;` lines and bury the few rows that carry numbers. The gap stays
      // legible through the discontinuity of the stamps, which is how a CSV
      // represents absence.
      if (cells.some((cell) => cell !== "")) rows.push([iso, ...cells].join(";"));
    }

    // Leading BOM: without it Excel reads the file as latin-1 and the accents in
    // the headers arrive broken.
    const blob = new Blob([`\ufeff${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `monitoramento-${chart.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ─── Cards ────────────────────────────────────────────────────────────────

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function layersWithData(chart) {
    const from = windowStart();
    return LAYERS.filter((layer) => {
      const data = chart.layers[layer.id];
      if (!data) return false;
      return layerSeriesIds(chart, layer.id).some((seriesId) => layerHasData(data, seriesId, from));
    });
  }

  /**
   * Deliberately wider than `layersWithData`: the CSV exports EVERY series of every
   * layer, including the raw data of the terms the drawing omits. Walks in the same
   * order as `exportCsv` and stops at the first column that would exist.
   */
  function hasExportableData(chart) {
    const from = windowStart();
    return chart.series.some((series) => LAYERS.some((layer) => layerHasData(chart.layers[layer.id], series.id, from)));
  }

  function drawnLayers(chart) {
    return layersWithData(chart).filter((layer) => state.layers.has(layer.id));
  }

  function syncCardText(chart, drawnCount) {
    const labels = drawnLayers(chart).map((layer) => layerLabel(chart, layer));
    const span = state.layerLabels.get(chart.id);
    if (span) span.textContent = labels.join(" · ");

    const canvas = state.canvases.get(chart.id);
    if (canvas) {
      const description = labels.length ? `camadas ${labels.join(", ")}` : "sem camadas para desenhar";
      canvas.setAttribute(
        "aria-label",
        `${chart.title} — ${description}. Use o botão CSV para a versão textual dos dados.`
      );
    }

    // With not a single reading in the window `exportCsv` has nothing to generate
    // and returns without a file and without a message, so clicking would answer
    // with nothing at all, indistinguishable from a download blocked by the
    // browser. Disabled, the card says so before the click. It depends on the
    // window, hence the re-evaluation on every redraw.
    const download = state.downloads.get(chart.id);
    if (download) {
      const exportable = hasExportableData(chart);
      download.disabled = !exportable;
      download.setAttribute(
        "aria-label",
        exportable
          ? `Baixar os dados de ${chart.title} em CSV`
          : `Sem dados de ${chart.title} nesta janela para baixar em CSV`
      );
    }

    const notice = state.notices.get(chart.id);
    if (notice) {
      notice.hidden = drawnCount > 0;
      // Three different reasons for an empty canvas, and the reader needs to know
      // which one. The middle case is what the station actually produces: with a
      // sensor down the exporter omits the series and the chart arrives with no
      // drawable layer at all. Saying "none of the selected ones" there would blame
      // the reader's choice for an absence no layer toggle can undo.
      if (!state.layers.size) {
        notice.textContent = "Nenhuma camada selecionada — ative pelo menos uma acima.";
      } else if (!layersWithData(chart).length) {
        // The title is not interpolated: it is the heading right above, and
        // lowercasing it would ruin the acronyms ("Radiação PAR" → "radiação par").
        notice.textContent = "Sem registro nesta janela — nem a estação nem o modelo publicaram dados desta variável.";
      } else {
        notice.textContent = "Nenhuma das camadas selecionadas tem dados para esta variável.";
      }
    }
  }

  /**
   * Enlarges a chart in a native `<dialog>`.
   *
   * `showModal()` brings focus trapping, Escape to close, an inert background and
   * `::backdrop` without a line of our own code. `closedby="any"` gives the
   * click-outside declaratively; the listener below covers browsers that have not
   * implemented it yet.
   *
   * The chart is created on open and destroyed on close: keeping nine more live
   * instances around would cost memory for a screen that is almost always closed.
   * The data comes from the same `buildDatasets`, so the slice and the enabled
   * layers follow whatever the card shows.
   */
  function openZoom(chart) {
    const dialog = document.createElement("dialog");
    dialog.className = "monitor-zoom";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-label", `${chart.title} ampliado`);

    const head = node("div", "monitor-zoom-head");
    const title = node("h2", "monitor-zoom-title", chart.title);
    if (chart.unit) title.appendChild(node("span", "monitor-unit", ` (${chart.unit})`));
    head.appendChild(title);

    // `method="dialog"` closes with no handler and returns focus to the opener.
    const form = document.createElement("form");
    form.method = "dialog";
    const close = node("button", "btn btn-sm btn-outline-lab", "Fechar");
    form.appendChild(close);
    head.appendChild(form);
    dialog.appendChild(head);

    const wrap = node("div", "chart-container monitor-zoom-chart");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      `${chart.title} ampliado — camadas ${
        drawnLayers(chart)
          .map((layer) => layerLabel(chart, layer))
          .join(", ") || "nenhuma"
      }. Use o botão CSV do cartão para a versão textual.`
    );
    wrap.appendChild(canvas);
    dialog.appendChild(wrap);
    document.body.appendChild(dialog);

    const config = chartConfig(chart, themeColors(), { marks: ZOOM_MARKS });
    let instance = null;
    dialog.addEventListener("close", () => {
      if (instance) instance.destroy();
      dialog.remove();
    });
    // A click on the <dialog> itself is a click on the backdrop: the content lives
    // in its children.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.showModal();
    if (config.data.datasets.length) {
      instance = new Chart(canvas.getContext("2d"), { type: "line", ...config, plugins: [crosshair] });
    } else {
      wrap.appendChild(node("p", "monitor-pending", "Sem camadas para desenhar nesta janela."));
    }
  }

  function buildCard(chart) {
    const card = node("div", "theme-surface monitor-card");
    card.id = `monitor-card-${chart.id}`;

    const head = node("div", "monitor-card-head");
    const heading = node("h3", "monitor-card-title", chart.title);
    if (chart.unit) heading.appendChild(node("span", "monitor-unit", ` (${chart.unit})`));
    head.appendChild(heading);

    const actions = node("div", "monitor-card-actions");
    const layers = node("span", "monitor-layers");
    state.layerLabels.set(chart.id, layers);
    actions.appendChild(layers);
    const zoom = node("button", "btn btn-sm btn-outline-lab", "Ampliar");
    zoom.type = "button";
    zoom.setAttribute("aria-label", `Ampliar o gráfico de ${chart.title}`);
    zoom.addEventListener("click", () => openZoom(chart));
    actions.appendChild(zoom);

    const download = node("button", "btn btn-sm btn-outline-lab", "CSV");
    download.type = "button";
    download.setAttribute("aria-label", `Baixar os dados de ${chart.title} em CSV`);
    download.addEventListener("click", () => exportCsv(chart));
    state.downloads.set(chart.id, download);
    actions.appendChild(download);
    head.appendChild(actions);
    card.appendChild(head);

    const wrap = node("div", "chart-container monitor-chart");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    wrap.appendChild(canvas);
    card.appendChild(wrap);
    state.canvases.set(chart.id, canvas);

    // Sits right below the canvas, hidden while there is something to draw: it is
    // the text that stands in for a blank chart when no layer is left.
    const notice = node("p", "monitor-pending");
    notice.hidden = true;
    card.appendChild(notice);
    state.notices.set(chart.id, notice);

    syncCardText(chart, drawnLayers(chart).length);

    // What the model does not deliver yet. Naming it is the point: otherwise a
    // missing layer is indistinguishable from a loading error, and the day WRF
    // precipitation arrives would pass unnoticed.
    const pending = Object.keys(chart.wrf_pending || {});
    if (pending.length) {
      const labels = chart.series.filter((series) => pending.includes(series.id)).map((series) => series.label);
      card.appendChild(
        node(
          "p",
          "monitor-pending",
          `Sem série do WRF para ${labels.join(", ")} nesta janela — a extração operacional ainda não escreve essa variável.`
        )
      );
    }

    if (chart.caveats && chart.caveats.length) {
      const list = node("ul", "clima-caveats");
      for (const caveat of chart.caveats) list.appendChild(node("li", null, caveat));
      card.appendChild(list);
    }

    return card;
  }

  // ─── Controls ─────────────────────────────────────────────────────────────

  function buildLayerToggles() {
    const group = el("monitorCamadas");
    group.replaceChildren();
    for (const layer of LAYERS) {
      const button = node("button", "clima-segmented-btn", layer.label);
      button.type = "button";
      button.dataset.layer = layer.id;
      const active = state.layers.has(layer.id);
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
      button.addEventListener("click", () => {
        if (state.layers.has(layer.id)) state.layers.delete(layer.id);
        else state.layers.add(layer.id);
        const on = state.layers.has(layer.id);
        button.setAttribute("aria-pressed", String(on));
        button.classList.toggle("is-active", on);
        redrawAll();
      });
      group.appendChild(button);
    }
  }

  function buildWindowChips() {
    const group = el("monitorJanela");
    group.replaceChildren();
    for (const entry of WINDOWS) {
      const button = node("button", "clima-segmented-btn", entry.label);
      button.type = "button";
      button.dataset.window = entry.id;
      button.setAttribute("aria-pressed", String(entry.id === state.windowId));
      button.classList.toggle("is-active", entry.id === state.windowId);
      button.addEventListener("click", () => {
        state.windowId = entry.id;
        for (const sibling of group.children) {
          const active = sibling.dataset.window === state.windowId;
          sibling.setAttribute("aria-pressed", String(active));
          sibling.classList.toggle("is-active", active);
        }
        redrawAll();
      });
      group.appendChild(button);
    }
  }

  // ─── Orchestration ────────────────────────────────────────────────────────

  function showEmpty(message) {
    el("monitorApp").hidden = true;
    const empty = el("monitorEmpty");
    empty.hidden = false;
    el("monitorEmptyMessage").textContent = message;
  }

  /**
   * Charts are born only when their card reaches the screen. With nine canvases of
   * ~2000 points, building everything on load freezes the page for seconds on a
   * phone; the same observation also drives the cards' fade-in, which is pure CSS.
   */
  function observeCards() {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          const chart = state.payload.charts.find((item) => `monitor-card-${item.id}` === entry.target.id);
          if (!chart) continue;
          state.revealed.add(chart.id);
          if (!state.charts.has(chart.id)) drawChart(chart);
        }
      },
      { rootMargin: "200px 0px" }
    );
    for (const card of el("monitorGrid").children) observer.observe(card);
  }

  function renderHeader() {
    const windowInfo = state.payload.window || {};
    const start = parseStationTime(windowInfo.start);
    const end = parseStationTime(windowInfo.end);
    const stationEnd = parseStationTime(windowInfo.station_end || windowInfo.end);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      // `end` is the end of the DOCUMENT and runs past the end of the record
      // whenever the model forecast goes ahead. Announcing "N days" over a longer
      // interval would misdescribe what is on screen, so the forecast is named
      // apart instead of diluted into the same span.
      //
      // The day count is MEASURED from the stamps rather than read from
      // `window.days`: the two only agree on the exporter's default path — with an
      // explicit `--end` the start and the length are independent, and printing the
      // field next to a separately computed interval is how a label starts
      // contradicting the dates it frames.
      const dayCount = Math.max(1, Math.round((stationEnd - start) / DAY_MS));
      const recordText = `Janela móvel de ${dayCount} ${dayCount === 1 ? "dia" : "dias"} — ${formatStampYear(start)} a ${formatStampYear(stationEnd)} (horário local)`;
      el("monitorPeriodo").textContent =
        Number.isFinite(stationEnd) && end > stationEnd
          ? `${recordText}; modelo até ${formatStampYear(end)}`
          : recordText;
    }
    const generated = parseStationTime(state.payload.generated_utc || "");
    el("monitorAtualizado").textContent = Number.isFinite(generated)
      ? `Publicado em ${formatStampYear(generated)} UTC`
      : "";
  }

  async function start() {
    const root = document.querySelector("[data-monitoring-base]");
    if (!root) return;
    state.base = (root.dataset.monitoringBase || "").replace(/\/$/, "");
    if (!state.base) {
      showEmpty("Esta publicação ainda não declara um diretório de monitoramento.");
      return;
    }
    if (typeof Chart === "undefined") {
      showEmpty("A biblioteca de gráficos não carregou.");
      return;
    }

    el("monitorEmpty").hidden = false;
    let response;
    try {
      // No `?v=`: the file is rewritten under the same name every hour, so
      // freshness is decided by the request header, not by the URL.
      response = await fetch(`${state.base}/monitoring.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      showEmpty(
        "Os dados de monitoramento ainda não foram publicados para esta estação. " +
          "Eles são anexados ao site no deploy, separadamente das páginas."
      );
      return;
    }

    // Reading the body stays OUTSIDE the network try because the two failures ask
    // different things of whoever runs the deploy. Absence is a 404; an incomplete
    // body is a 200 with JSON cut in half, which is the normal state while the
    // upload is still in flight — the file is rewritten hourly under the same name.
    // Saying "not published yet" there sends the operator hunting for a file that is
    // already on the server, when waiting for the upload to finish is enough.
    try {
      state.payload = await response.json();
    } catch (error) {
      // The technical detail goes to the console: the engine's message is in English
      // and means nothing to a reader of the page, but it is what tells a truncated
      // body apart from a corrupted document for whoever investigates.
      console.error(error);
      showEmpty(
        "O documento de monitoramento chegou incompleto ou ilegível; o arquivo pode estar sendo " +
          "publicado neste momento. Recarregar a página em alguns minutos deve resolver."
      );
      return;
    }

    if (!state.payload.charts || !state.payload.charts.length) {
      showEmpty("O documento publicado não declara nenhum gráfico.");
      return;
    }

    renderHeader();
    buildLayerToggles();
    buildWindowChips();

    const grid = el("monitorGrid");
    grid.replaceChildren();
    for (const chart of state.payload.charts) grid.appendChild(buildCard(chart));

    el("monitorEmpty").hidden = true;
    el("monitorApp").hidden = false;
    observeCards();

    window.addEventListener("labmim-theme-change", redrawAll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
