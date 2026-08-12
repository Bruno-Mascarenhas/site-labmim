/**
 * Sky-condition page: reads `labmim-ktkd-v1` and `labmim-allsky-frame-v1` from
 * `data-sky-base`.
 *
 * Nothing is recomputed here. The histogram, the model bands and their skill
 * scores arrive from the Python exporter, which owns the filters and the
 * coefficients; the page draws what it is given and names the source. The two
 * files have different cadences on purpose — the frame is rewritten per capture,
 * the Kt/Kd artifact per archive rebuild — so each is fetched independently and
 * either can be absent. The directory is deploy-only: empty in a dev checkout
 * and in CI, where the page says so.
 */

"use strict";

(function () {
  const KTKD_PAYLOAD = "ktkd.json";
  const FRAME_PAYLOAD = "frame.json";
  const DEFAULT_RAW_FRAME = "allsky.jpg";
  const DEFAULT_MASK_FRAME = "mask.png";

  const ROMAN = ["I", "II", "III", "IV"];

  /**
   * Escobedo et al. (2009), Applied Energy 86(3), 299-309, §3.1: four sky
   * conditions as intervals of the clearness index, upper bound inclusive.
   * Portuguese wording from Teramoto & Escobedo (2012), RBEAA 16(9), 985-992.
   * The payload carries these too; this copy is what the figure falls back to,
   * so the boundaries never come from nowhere.
   */
  const FALLBACK_CLASSES = [
    { condition: 1, id: "i", name_pt: "nebuloso", kt_range: [0, 0.35] },
    { condition: 2, id: "ii", name_pt: "parcialmente nebuloso com dominância para o difuso", kt_range: [0.35, 0.55] },
    { condition: 3, id: "iii", name_pt: "parcialmente nebuloso com dominância para o claro", kt_range: [0.55, 0.65] },
    { condition: 4, id: "iv", name_pt: "claro", kt_range: [0.65, 1] },
  ];

  // The payload's names are full sentences, which no chip can hold.
  const SHORT_LABELS = {
    i: "Nebuloso",
    ii: "Parc. nebuloso — difuso",
    iii: "Parc. nebuloso — claro",
    iv: "Claro",
  };

  const CLASS_PALETTE = {
    light: { i: "#64748b", ii: "#3761b4", iii: "#1a7f5a", iv: "#e07a1f" },
    dark: { i: "#94a3b8", ii: "#5589e6", iii: "#31a37a", iv: "#cb8030" },
  };

  const MODEL_PALETTE = {
    light: { marques_filho_2016: "#7c3aa8", lemos_2017: "#c2185b", ridley_2010: "#0e7490" },
    dark: { marques_filho_2016: "#c08ae0", lemos_2017: "#f06292", ridley_2010: "#4dd0e1" },
  };

  // A model id the palette does not know still has to be drawable.
  const MODEL_FALLBACK = { light: ["#7c3aa8", "#c2185b", "#0e7490"], dark: ["#c08ae0", "#f06292", "#4dd0e1"] };

  // Monochrome, because colour on this page already means sky condition. Channels
  // rather than a hex: the cell alpha is what carries the count.
  const DENSITY_INK = { light: "24, 60, 112", dark: "150, 198, 255" };

  // Condition II ends where the diffuse component equals the direct one, which
  // on the surface is half the global: this line and Kt = 0,55 meet by definition.
  const DIFFUSE_PARITY = 0.5;

  // Same file name every capture, so without a stamp the browser serves the copy
  // it holds. Finer than any plausible capture interval, coarse enough to cache.
  const FRAME_BUCKET_MS = 300000;

  const state = {
    base: "",
    chart: null,
    chartPayload: null,
    chartStatus: "absent",
    framePayload: null,
    classes: [],
    models: [],
    points: [],
    density: null,
    hidden: new Set(),
    layers: new Set(["density"]),
    activeModels: new Set(),
    framesMissing: 0,
    hoverCell: null,
  };

  const el = (id) => document.getElementById(id);

  function decimal(value, digits) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function fade(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
  const COMPACT_STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/;

  // Station-local stamps carry no offset: they go in through `Date.UTC` and come
  // back through `getUTC*`, or every reading would shift by the VIEWER's offset.
  function parseStationTime(text) {
    const parts = STAMP.exec(String(text)) || COMPACT_STAMP.exec(String(text));
    if (!parts) return NaN;
    return Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], parts[6] ? +parts[6] : 0);
  }

  const pad = (value) => String(value).padStart(2, "0");

  function formatDay(ms) {
    const date = new Date(ms);
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  }

  function formatStamp(ms) {
    const date = new Date(ms);
    return `${formatDay(ms)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  function isDark() {
    return document.documentElement.classList.contains("dark-theme");
  }

  function themeColors() {
    const root = getComputedStyle(document.documentElement);
    return {
      classes: isDark() ? CLASS_PALETTE.dark : CLASS_PALETTE.light,
      models: isDark() ? MODEL_PALETTE.dark : MODEL_PALETTE.light,
      modelFallback: isDark() ? MODEL_FALLBACK.dark : MODEL_FALLBACK.light,
      ink: isDark() ? DENSITY_INK.dark : DENSITY_INK.light,
      textSecondary: root.getPropertyValue("--text-secondary").trim() || "#888",
      legendText: root.getPropertyValue("--chart-legend-color").trim() || "#666",
      grid: root.getPropertyValue("--chart-grid-color").trim() || "#f0f0f0",
      tooltipBg: root.getPropertyValue("--tooltip-bg").trim() || "rgba(18, 18, 18, 0.96)",
      tooltipText: root.getPropertyValue("--tooltip-text").trim() || "#fff",
      guide: isDark() ? "rgba(255, 255, 255, 0.34)" : "rgba(0, 0, 0, 0.26)",
      crosshair: isDark() ? "rgba(255, 255, 255, 0.32)" : "rgba(0, 0, 0, 0.24)",
    };
  }

  function rangeLabel(entry, index, total) {
    const bounds = Array.isArray(entry.kt_range) ? entry.kt_range : [];
    if (index === 0) return `Kt ≤ ${decimal(bounds[1], 2)}`;
    if (index === total - 1) return `Kt > ${decimal(bounds[0], 2)}`;
    return `${decimal(bounds[0], 2)} < Kt ≤ ${decimal(bounds[1], 2)}`;
  }

  function resolveClasses(payload) {
    const declared = payload && payload.sky_conditions && payload.sky_conditions.classes;
    const source = Array.isArray(declared) && declared.length ? declared : FALLBACK_CLASSES;
    return source.map((entry, index) => {
      const id = String(entry.id || ROMAN[index] || index + 1).toLowerCase();
      const roman = ROMAN[(entry.condition || index + 1) - 1] || String(entry.condition || index + 1);
      const name = entry.name_pt || SHORT_LABELS[id] || id;
      return {
        id,
        roman,
        label: SHORT_LABELS[id] || name,
        full: `Condição de céu ${roman}, ${name}`,
        range: rangeLabel(entry, index, source.length),
        // The last class is open-ended: cloud enhancement can put Kt past its
        // declared upper bound and those hours are still clear sky.
        max: index === source.length - 1 ? Infinity : (entry.kt_range || [])[1],
      };
    });
  }

  // "Marques Filho et al. (2016)" -> "Marques Filho"; "… — BRL" -> "BRL".
  function shortModelLabel(label) {
    const text = String(label || "");
    if (text.includes(" — ")) return text.split(" — ").pop().trim();
    return text.split(/\s+et al\.|\s+\(/)[0].trim() || text;
  }

  function resolveModels(payload) {
    const declared = payload && Array.isArray(payload.models) ? payload.models : [];
    return declared
      .filter((model) => model && typeof model.id === "string" && Array.isArray(model.kt))
      .map((model) => ({ ...model, short: shortModelLabel(model.label) }));
  }

  function readPoints(payload) {
    const raw = payload && Array.isArray(payload.points) ? payload.points : [];
    const points = [];
    for (const entry of raw) {
      const positional = Array.isArray(entry);
      const kt = positional ? entry[0] : entry && entry.kt;
      const kd = positional ? entry[1] : entry && entry.kd;
      const stamp = positional ? entry[2] : entry && entry.t;
      if (!Number.isFinite(kt) || !Number.isFinite(kd)) continue;
      points.push({ x: kt, y: kd, t: typeof stamp === "string" ? stamp : "", observed: true });
    }
    return points;
  }

  function readDensity(payload) {
    const grid = payload && payload.density;
    if (!grid || !Array.isArray(grid.counts) || !Array.isArray(grid.kt_edges) || !Array.isArray(grid.kd_edges)) {
      return null;
    }
    // Rows are Kd bins and columns Kt bins, so the matrix must be as tall as the
    // Kd edges and as wide as the Kt ones. A transposed grid would still draw,
    // silently mirroring the figure about its diagonal.
    if (grid.counts.length !== grid.kd_edges.length - 1) return null;
    if (grid.counts.some((row) => !Array.isArray(row) || row.length !== grid.kt_edges.length - 1)) return null;
    return grid;
  }

  function classOf(kt) {
    return state.classes.find((entry) => kt <= entry.max) || state.classes[state.classes.length - 1] || null;
  }

  /**
   * The frame file names its condition twice, as a 1-4 `condition` and as an id,
   * because the exporter's own class integer is 0-based; reading a bare index
   * across that boundary is an off-by-one waiting to happen.
   */
  function frameClass(frame) {
    const sky = frame && frame.sky_condition;
    if (!sky) return null;
    const byId = state.classes.find((entry) => entry.id === String(sky.id || "").toLowerCase());
    if (byId) return byId;
    const condition = Number(sky.condition);
    return Number.isInteger(condition) ? state.classes[condition - 1] || null : null;
  }

  function frameToken() {
    const captured = state.framePayload ? state.framePayload.captured_at : null;
    const parsed = parseStationTime(captured || "");
    if (Number.isFinite(parsed)) return String(parsed);
    return String(Math.floor(Date.now() / FRAME_BUCKET_MS));
  }

  function frameName(field, fallback) {
    const declared = state.framePayload ? state.framePayload[field] : null;
    return typeof declared === "string" && declared.trim() ? declared.trim() : fallback;
  }

  function frameUrl(name) {
    return `${state.base}/${name}?t=${encodeURIComponent(frameToken())}`;
  }

  function frameImage(name, alt, className) {
    const image = document.createElement("img");
    image.className = className;
    image.alt = alt;
    image.decoding = "async";
    image.src = frameUrl(name);
    return image;
  }

  function buildFrame(container, name, alt, noteElement, missingMessage) {
    const image = frameImage(name, alt, "sky-frame-image");
    image.addEventListener("error", () => {
      state.framesMissing += 1;
      container.replaceChildren(node("div", "sky-frame-missing", missingMessage));
      noteElement.textContent = "";
      settleEmptyState();
    });
    container.replaceChildren(image);
    return image;
  }

  // The state of every dev checkout and of CI, where two placeholders and an
  // empty chart would read as a broken page rather than as undeployed data.
  function settleEmptyState() {
    if (state.framesMissing < 2 || state.chartPayload || state.framePayload) return;
    showEmpty(
      "Os dados de condição do céu ainda não foram publicados para esta estação. " +
        "Eles são anexados ao site no deploy, separadamente das páginas."
    );
  }

  function applyMaskOpacity() {
    const mask = el("ceuMediaMascara").querySelector(".sky-frame-mask");
    if (!mask) return;
    mask.style.opacity = String(Number(el("ceuOpacidade").value) / 100);
  }

  // `object-fit: contain` letterboxes each layer by its OWN ratio, so a square
  // box under a 4:3 frame would fade the mask over misregistered pixels.
  function fitFrameBoxes(image) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const ratio = `${image.naturalWidth} / ${image.naturalHeight}`;
    el("ceuMediaBruto").style.aspectRatio = ratio;
    el("ceuMediaMascara").style.aspectRatio = ratio;
  }

  function renderFrames() {
    const rawName = frameName("image", DEFAULT_RAW_FRAME);
    const maskName = frameName("mask", DEFAULT_MASK_FRAME);

    const raw = buildFrame(
      el("ceuMediaBruto"),
      rawName,
      "Quadro bruto da câmera all-sky",
      el("ceuNotaBruto"),
      "Quadro ainda não publicado."
    );
    raw.addEventListener("load", () => fitFrameBoxes(raw));

    const container = el("ceuMediaMascara");
    const mask = buildFrame(
      container,
      maskName,
      "Máscara de segmentação prevista sobre o quadro all-sky",
      el("ceuNotaMascara"),
      "Máscara ainda não publicada."
    );
    mask.classList.add("sky-frame-mask");
    const underlay = frameImage(rawName, "", "sky-frame-image");
    underlay.setAttribute("aria-hidden", "true");
    underlay.addEventListener("error", () => underlay.remove());
    container.insertBefore(underlay, mask);
    applyMaskOpacity();

    const frame = state.framePayload || {};
    const captured = parseStationTime(frame.captured_at || "");
    el("ceuNotaBruto").textContent = Number.isFinite(captured) ? `Capturado em ${formatStamp(captured)}` : "";

    const predicted = frameClass(frame);
    const notes = [];
    if (predicted) notes.push(`Condição prevista: ${predicted.roman} · ${predicted.label}`);
    if (Number.isFinite(frame.cloud_fraction)) {
      notes.push(`cobertura de nuvens ${decimal(frame.cloud_fraction * 100, 0)}%`);
    }
    el("ceuNotaMascara").textContent = notes.join(" — ");
  }

  function modelColor(model, theme) {
    const index = state.models.indexOf(model);
    return theme.models[model.id] || theme.modelFallback[index % theme.modelFallback.length];
  }

  function activeModels() {
    return state.models.filter((model) => state.activeModels.has(model.id));
  }

  function showingPoints() {
    return state.layers.has("points") && state.points.length > 0;
  }

  function visiblePoints() {
    return state.points.filter((point) => {
      const entry = classOf(point.x);
      return !entry || !state.hidden.has(entry.id);
    });
  }

  function hasDrawing() {
    if (state.layers.has("density") && state.density) return true;
    if (showingPoints() && visiblePoints().length) return true;
    return activeModels().length > 0;
  }

  const LAYERS = [
    { id: "density", label: "Densidade" },
    { id: "points", label: "Pontos" },
  ];

  function axisBounds() {
    const axes = (state.chartPayload && state.chartPayload.axes) || {};
    const declaredX = (axes.x && axes.x.range) || [0, 1];
    const declaredY = (axes.y && axes.y.range) || [0, 1];
    let ktMax = declaredX[1];
    let kdMin = declaredY[0];
    // Headroom above the declared range: the overcast class piles up against the
    // top of it, and a ceiling exactly there presses the densest rows into the edge.
    let kdMax = declaredY[1] + 0.1;
    for (const point of state.points) {
      ktMax = Math.max(ktMax, point.x);
      kdMin = Math.min(kdMin, point.y);
      kdMax = Math.max(kdMax, point.y);
    }
    if (state.density) {
      ktMax = Math.max(ktMax, state.density.kt_edges[state.density.kt_edges.length - 1]);
    }
    return {
      ktMin: Math.min(0, declaredX[0]),
      ktMax: Math.ceil(ktMax * 10) / 10,
      kdMin: Math.floor(kdMin * 10) / 10,
      kdMax: Math.ceil(kdMax * 10) / 10,
    };
  }

  function densityCellAt(kt, kd) {
    const grid = state.density;
    if (!grid || !state.layers.has("density")) return null;
    const find = (value, edges) => {
      for (let index = 0; index < edges.length - 1; index += 1) {
        if (value >= edges[index] && value < edges[index + 1]) return index;
      }
      return -1;
    };
    const column = find(kt, grid.kt_edges);
    const row = find(kd, grid.kd_edges);
    if (column < 0 || row < 0) return null;
    return {
      count: grid.counts[row][column],
      kt: [grid.kt_edges[column], grid.kt_edges[column + 1]],
      kd: [grid.kd_edges[row], grid.kd_edges[row + 1]],
    };
  }

  /**
   * One filled rectangle per occupied cell. Log by default because the densest
   * cell of a Kt/Kd cloud holds an order of magnitude more hours than its tails,
   * and a linear ramp flattens everything outside the core into one shade; the
   * exporter states which scale it intends in `color_scale_hint`.
   */
  const densityLayer = {
    id: "labmimSkyDensity",
    beforeDatasetsDraw(instance, _args, options) {
      const grid = options.grid;
      if (!grid) return;
      const { ctx, chartArea, scales } = instance;
      const logarithmic = options.scale !== "linear";
      const top = logarithmic ? Math.log1p(grid.max_count) : grid.max_count;
      if (!(top > 0)) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.clip();
      for (let row = 0; row < grid.counts.length; row += 1) {
        const yTop = scales.y.getPixelForValue(grid.kd_edges[row + 1]);
        const yBottom = scales.y.getPixelForValue(grid.kd_edges[row]);
        for (let column = 0; column < grid.counts[row].length; column += 1) {
          const count = grid.counts[row][column];
          if (!count) continue;
          const xLeft = scales.x.getPixelForValue(grid.kt_edges[column]);
          const xRight = scales.x.getPixelForValue(grid.kt_edges[column + 1]);
          const weight = (logarithmic ? Math.log1p(count) : count) / top;
          ctx.fillStyle = `rgba(${options.ink}, ${(0.12 + 0.83 * weight).toFixed(3)})`;
          // Half a pixel of overlap: cell edges land on fractional pixels and
          // exact rectangles leave a hairline grid the data does not have.
          ctx.fillRect(xLeft, yTop, xRight - xLeft + 0.5, yBottom - yTop + 0.5);
        }
      }
      ctx.restore();
    },
  };

  // Reference frame, not data: drawn under the cloud so no point is hidden.
  const guides = {
    id: "labmimSkyGuides",
    beforeDatasetsDraw(instance, _args, options) {
      const { ctx, chartArea, scales } = instance;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = options.color;
      ctx.setLineDash([4, 4]);
      for (const entry of state.classes) {
        if (!Number.isFinite(entry.max) || entry.max > scales.x.max) continue;
        const x = scales.x.getPixelForValue(entry.max);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
      }
      const y = scales.y.getPixelForValue(DIFFUSE_PARITY);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.restore();
    },
  };

  const crosshair = {
    id: "labmimSkyCrosshair",
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

  function nearestObservation(kt) {
    let best = null;
    let distance = Infinity;
    for (const point of visiblePoints()) {
      const gap = Math.abs(point.x - kt);
      if (gap < distance) {
        distance = gap;
        best = point;
      }
    }
    return best;
  }

  function nearestFilledIndex(data, kt) {
    let best = -1;
    let distance = Infinity;
    for (let index = 0; index < data.length; index += 1) {
      const point = data[index];
      if (!point || point.y === null || point.y === undefined) continue;
      const gap = Math.abs(point.x - kt);
      if (gap < distance) {
        distance = gap;
        best = index;
      }
    }
    return best;
  }

  /**
   * One tooltip item per series holding this reading, so every line carries its
   * own colour and mark — which `afterBody`, being plain text, cannot. It is an
   * interaction mode because Chart.js settles the item set before any callback
   * runs, and it hit-tests on Kt alone: the reader points at a column.
   */
  Chart.Interaction.modes.labmimSkyColumn = (chart, event) => {
    const position = Chart.helpers.getRelativePosition(event, chart);
    const kt = chart.scales.x.getValueForPixel(position.x);
    state.hoverCell = densityCellAt(kt, chart.scales.y.getValueForPixel(position.y));
    const observation = showingPoints() ? nearestObservation(kt) : null;
    const items = [];
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.labmimEnvelope || !chart.isDatasetVisible(datasetIndex)) return;
      const index = dataset.labmimModel
        ? nearestFilledIndex(dataset.data, observation ? observation.x : kt)
        : observation
          ? dataset.data.indexOf(observation)
          : -1;
      if (index < 0) return;
      const element = chart.getDatasetMeta(datasetIndex).data[index];
      if (element) items.push({ element, datasetIndex, index });
    });
    return items;
  };

  function hoveredObservation(items) {
    for (const item of items) {
      if (item.raw && item.raw.observed) return item.raw;
    }
    return null;
  }

  // Residual is signed model − measured: positive means the model sits above.
  function modelLine(item, observation) {
    const model = state.models.find((entry) => entry.id === item.dataset.labmimModel);
    if (!model) return "";
    const value = decimal(item.parsed.y, 3);
    if (observation) {
      const residual = item.parsed.y - observation.y;
      return `${model.short}: ${value} (${residual >= 0 ? "+" : "−"}${decimal(Math.abs(residual), 3)})`;
    }
    if (model.kind !== "band") return `${model.short}: ${value}`;
    const bin = item.raw.bin;
    return `${model.short}: ${value} · p10 ${decimal(model.p10[bin], 3)} · p90 ${decimal(model.p90[bin], 3)}`;
  }

  function tooltipTitle(items) {
    const observation = hoveredObservation(items);
    if (observation) {
      const stamp = parseStationTime(observation.t || "");
      return Number.isFinite(stamp)
        ? `Kt ${decimal(observation.x, 3)} · ${formatStamp(stamp)}`
        : `Kt ${decimal(observation.x, 3)}`;
    }
    const cell = state.hoverCell;
    if (!cell) return `Kt ${decimal(items[0].parsed.x, 3)}`;
    const hours = `${decimal(cell.count, 0)} ${cell.count === 1 ? "hora" : "horas"}`;
    return `Kt ${decimal(cell.kt[0], 3)}–${decimal(cell.kt[1], 3)} · Kd ${decimal(cell.kd[0], 3)}–${decimal(cell.kd[1], 3)} · ${hours}`;
  }

  function buildDatasets(theme, radius) {
    const datasets = [];
    if (showingPoints()) {
      const grouped = new Map(state.classes.map((entry) => [entry.id, []]));
      for (const point of state.points) {
        const entry = classOf(point.x);
        if (entry && grouped.has(entry.id)) grouped.get(entry.id).push(point);
      }
      for (const entry of state.classes) {
        const data = grouped.get(entry.id);
        if (!data || !data.length || state.hidden.has(entry.id)) continue;
        datasets.push({
          type: "line",
          label: `${entry.roman} · ${entry.label}`,
          data,
          borderColor: "transparent",
          backgroundColor: theme.classes[entry.id],
          borderWidth: 0,
          showLine: false,
          pointRadius: radius,
          pointHoverRadius: radius + 2.5,
          pointBorderWidth: 0,
          normalized: true,
          order: 5,
        });
      }
    }

    for (const model of activeModels()) {
      const color = modelColor(model, theme);
      if (model.kind === "band") {
        // p10 and p90 as a filled pair, and the median as its own line: drawing a
        // band model as a single line would claim a determinism it does not have.
        const envelope = (series) => model.kt.map((kt, bin) => ({ x: kt, y: series[bin], bin }));
        const lower = datasets.length;
        datasets.push({
          type: "line",
          label: `${model.label} p10`,
          labmimEnvelope: true,
          data: envelope(model.p10),
          borderColor: "transparent",
          backgroundColor: fade(color, 0.13),
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          tension: 0,
          order: 3,
        });
        datasets.push({
          type: "line",
          label: `${model.label} p90`,
          labmimEnvelope: true,
          data: envelope(model.p90),
          fill: { target: lower, above: fade(color, 0.13), below: fade(color, 0.13) },
          borderColor: "transparent",
          backgroundColor: fade(color, 0.13),
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          tension: 0,
          order: 3,
        });
        datasets.push({
          type: "line",
          label: model.label,
          labmimModel: model.id,
          data: envelope(model.median),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2.5,
          pointStyle: "line",
          pointRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          tension: 0,
          order: 1,
        });
        continue;
      }
      datasets.push({
        type: "line",
        label: model.label,
        labmimModel: model.id,
        data: model.kt.map((kt, index) => ({ x: kt, y: model.kd[index], bin: index })),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2.5,
        borderDash: [6, 4],
        pointStyle: "line",
        pointRadius: 0,
        pointHoverRadius: 0,
        spanGaps: false,
        tension: 0,
        order: 1,
      });
    }
    return datasets;
  }

  // No inline legend: the chips and the toggles already name the conditions
  // twice. The zoom dialog carries neither, so there it comes back.
  function chartConfig(theme, { radius = 2.4, legend = false } = {}) {
    const bounds = axisBounds();
    const grid = state.layers.has("density") ? state.density : null;
    return {
      data: { datasets: buildDatasets(theme, radius) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: "labmimSkyColumn", intersect: false },
        plugins: {
          labmimSkyDensity: { grid, ink: theme.ink, scale: grid ? grid.color_scale_hint : "log" },
          labmimSkyGuides: { color: theme.guide },
          labmimSkyCrosshair: { color: theme.crosshair },
          legend: {
            display: legend,
            position: "top",
            labels: {
              color: theme.legendText,
              boxWidth: 26,
              filter: (item, data) => !data.datasets[item.datasetIndex].labmimEnvelope,
            },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.classes.ii,
            borderWidth: 1,
            usePointStyle: true,
            callbacks: {
              title: tooltipTitle,
              label: (item) => {
                if (item.dataset.labmimModel) return modelLine(item, hoveredObservation(item.chart.tooltip.dataPoints));
                const entry = classOf(item.parsed.x);
                const suffix = entry ? ` — ${entry.roman} · ${entry.label}` : "";
                return `Kd medido: ${decimal(item.parsed.y, 3)}${suffix}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: bounds.ktMin,
            max: bounds.ktMax,
            title: { display: true, text: "Índice de claridade Kt = H/H₀", color: theme.textSecondary },
            // A tick budget over 0-1,1 picks 0 / 0,5 / 1 / 1,1 and crowds the end.
            ticks: { color: theme.textSecondary, stepSize: 0.2 },
            grid: { color: theme.grid },
          },
          y: {
            type: "linear",
            min: bounds.kdMin,
            max: bounds.kdMax,
            title: { display: true, text: "Fração difusa Kd = Hd/H", color: theme.textSecondary },
            ticks: { color: theme.textSecondary, stepSize: 0.2 },
            grid: { color: theme.grid },
          },
        },
      },
    };
  }

  function buildToggles(container, entries, isActive, onToggle, describe) {
    container.replaceChildren();
    for (const entry of entries) {
      const button = node("button", "clima-segmented-btn sky-class-btn");
      button.type = "button";
      const described = describe ? describe(entry) : null;
      if (described) button.title = described;
      if (entry.swatch) {
        const swatch = node("span", entry.curve ? "sky-swatch sky-swatch-curve" : "sky-swatch");
        swatch.style.background = entry.swatch;
        button.appendChild(swatch);
      }
      button.appendChild(node("span", null, entry.label));
      const active = isActive(entry);
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
      button.addEventListener("click", () => {
        onToggle(entry);
        const on = isActive(entry);
        button.setAttribute("aria-pressed", String(on));
        button.classList.toggle("is-active", on);
        drawChart();
      });
      container.appendChild(button);
    }
  }

  function buildLayerToggles() {
    buildToggles(
      el("ceuCamadas"),
      LAYERS.filter((layer) => (layer.id === "density" ? state.density : state.points.length)),
      (layer) => state.layers.has(layer.id),
      (layer) => {
        if (state.layers.has(layer.id)) state.layers.delete(layer.id);
        else state.layers.add(layer.id);
        syncClassToggles();
      },
      (layer) =>
        layer.id === "density"
          ? "Histograma das horas em células de Kt × Kd"
          : "Uma marca por hora medida, colorida pela condição de céu"
    );
  }

  function buildClassToggles() {
    const colors = themeColors().classes;
    buildToggles(
      el("ceuClasses"),
      state.classes.map((entry) => ({ ...entry, swatch: colors[entry.id] })),
      (entry) => !state.hidden.has(entry.id),
      (entry) => {
        if (state.hidden.has(entry.id)) state.hidden.delete(entry.id);
        else state.hidden.add(entry.id);
      },
      (entry) => entry.full
    );
    syncClassToggles();
  }

  // The conditions colour the individual hours, so with the point layer off they
  // have nothing to act on; saying that with `disabled` beats a dead control.
  function syncClassToggles() {
    const usable = showingPoints();
    for (const button of el("ceuClasses").children) {
      button.disabled = !usable;
      button.title = usable ? button.title : "Ative a camada de pontos para filtrar por condição";
    }
  }

  function buildModelToggles() {
    const theme = themeColors();
    buildToggles(
      el("ceuCurva"),
      state.models.map((model) => ({
        ...model,
        label: model.short,
        swatch: modelColor(model, theme),
        curve: model.kind === "curve",
      })),
      (model) => state.activeModels.has(model.id),
      (model) => {
        if (state.activeModels.has(model.id)) state.activeModels.delete(model.id);
        else state.activeModels.add(model.id);
      },
      (model) =>
        model.kind === "band"
          ? `${model.label} — mediana e faixa p10-p90 por intervalo de Kt`
          : `${model.label} — curva, função apenas de Kt`
    );
  }

  function buildLegend() {
    const colors = themeColors().classes;
    const list = el("ceuLegenda");
    list.replaceChildren();
    for (const entry of state.classes) {
      const item = node("li", "sky-legend-item");
      item.title = entry.full;
      const swatch = node("span", "sky-swatch");
      swatch.style.background = colors[entry.id];
      item.appendChild(swatch);
      item.appendChild(node("span", "sky-legend-label", `${entry.roman} · ${entry.label}`));
      item.appendChild(node("span", "sky-legend-range", entry.range));
      list.appendChild(item);
    }
  }

  function buildCaveats() {
    const list = el("ceuCaveats");
    const caveats = state.chartPayload && Array.isArray(state.chartPayload.caveats) ? state.chartPayload.caveats : [];
    list.replaceChildren();
    for (const caveat of caveats) list.appendChild(node("li", null, caveat));
    list.hidden = caveats.length === 0;
  }

  function syncChartText() {
    const payload = state.chartPayload || {};
    const period = payload.period || {};
    const filters = payload.filters || {};
    const parts = [];
    if (payload.timescale && payload.timescale.label) parts.push(payload.timescale.label);
    const start = parseStationTime(period.start || "");
    const end = parseStationTime(period.end || "");
    if (Number.isFinite(start) && Number.isFinite(end)) {
      parts.push(`${formatDay(start)} a ${formatDay(end)}`);
    }
    if (Number.isFinite(period.hours)) {
      const kept = `${decimal(period.hours, 0)} horas`;
      parts.push(Number.isFinite(filters.n_input) ? `${kept} de ${decimal(filters.n_input, 0)}` : kept);
    }
    el("ceuGraficoNota").textContent = parts.join(" · ");

    // Each model against the measured Kd over this exact period: the legend says
    // how they perform here instead of implying they are equivalent.
    const metrics = activeModels()
      .filter((model) => Number.isFinite(model.rmse))
      .map(
        (model) =>
          `${model.short}: RMSE ${decimal(model.rmse, 3)}${
            Number.isFinite(model.mbe) ? ` · MBE ${model.mbe >= 0 ? "+" : "−"}${decimal(Math.abs(model.mbe), 3)}` : ""
          }`
      );
    el("ceuMetricas").textContent = metrics.join("   ");
    el("ceuMetricas").hidden = metrics.length === 0;

    const shown = showingPoints() ? visiblePoints().length : 0;
    el("ceuCanvas").setAttribute(
      "aria-label",
      state.density
        ? `Densidade horária no plano do índice de claridade contra a fração difusa, com os limites das quatro condições de céu. Use o botão CSV para a versão textual.`
        : `Dispersão de ${decimal(shown, 0)} horas no plano do índice de claridade contra a fração difusa.`
    );
    el("ceuExport").disabled = state.points.length === 0;
    el("ceuAmpliar").disabled = !hasDrawing();
  }

  function nothingToDrawMessage() {
    if (state.chartStatus === "unreadable") {
      return "O documento de Kt × Kd chegou incompleto ou ilegível; ele pode estar sendo publicado neste momento.";
    }
    if (state.chartStatus === "absent") {
      return "O documento de Kt × Kd ainda não foi publicado — os quadros acima continuam válidos.";
    }
    if (!state.density && !state.points.length) return "O documento publicado não traz nem densidade nem pontos.";
    if (showingPoints() && !visiblePoints().length) {
      return "Nenhuma condição de céu selecionada — ative pelo menos uma acima.";
    }
    return "Nenhuma camada selecionada — ative a densidade, os pontos ou um modelo.";
  }

  function drawChart() {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    syncChartText();
    if (!hasDrawing()) {
      el("ceuStatus").textContent = nothingToDrawMessage();
      return;
    }
    el("ceuStatus").textContent =
      "A linha horizontal marca Kd = 0,5, onde a componente difusa iguala a direta; as verticais são os limites entre as condições de céu.";
    state.chart = new Chart(el("ceuCanvas").getContext("2d"), {
      type: "line",
      ...chartConfig(themeColors()),
      plugins: [densityLayer, guides, crosshair],
    });
  }

  function openZoom() {
    const dialog = document.createElement("dialog");
    dialog.className = "theme-surface monitor-zoom";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-label", "Dispersão Kt × Kd ampliada");

    const head = node("div", "monitor-zoom-head");
    head.appendChild(node("h2", "monitor-zoom-title", "Índice de claridade × fração difusa"));
    const form = document.createElement("form");
    form.method = "dialog";
    form.appendChild(node("button", "btn btn-sm btn-outline-lab", "Fechar"));
    head.appendChild(form);
    dialog.appendChild(head);

    const wrap = node("div", "chart-container monitor-zoom-chart");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Dispersão ampliada do índice de claridade contra a fração difusa");
    wrap.appendChild(canvas);
    dialog.appendChild(wrap);
    document.body.appendChild(dialog);

    let instance = null;
    dialog.addEventListener("close", () => {
      if (instance) instance.destroy();
      dialog.remove();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.showModal();
    if (hasDrawing()) {
      instance = new Chart(canvas.getContext("2d"), {
        type: "line",
        ...chartConfig(themeColors(), { radius: 3.4, legend: true }),
        plugins: [densityLayer, guides, crosshair],
      });
    } else {
      wrap.appendChild(node("p", "monitor-pending", nothingToDrawMessage()));
    }
  }

  const EXCEL_UTF8_BOM = "\ufeff";

  function exportCsv() {
    if (!state.points.length) return;
    const rows = ["instante;kt;kd;condicao"];
    for (const point of state.points) {
      const stamp = parseStationTime(point.t || "");
      const date = Number.isFinite(stamp) ? new Date(stamp) : null;
      const iso = date
        ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
        : "";
      const entry = classOf(point.x);
      // Decimal comma with `;` as separator: what Excel in pt-BR opens without
      // going through the import wizard.
      rows.push(
        [
          iso,
          String(point.x).replace(".", ","),
          String(point.y).replace(".", ","),
          entry ? `${entry.roman} - ${entry.label}` : "",
        ].join(";")
      );
    }
    const blob = new Blob([`${EXCEL_UTF8_BOM}${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "condicao-ceu-kt-kd.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderHeader() {
    const generated = parseStationTime((state.chartPayload && state.chartPayload.generated_utc) || "");
    el("ceuAtualizado").textContent = Number.isFinite(generated) ? `Publicado em ${formatStamp(generated)} UTC` : "";
  }

  /**
   * Absence and unreadability stay apart, as in monitoramento.js — a 200 cut in
   * half is the normal state during an upload, not a file yet to be deployed.
   */
  async function loadJson(name) {
    let response;
    try {
      // Same name every run, so freshness is the request header's job.
      response = await fetch(`${state.base}/${name}`, { cache: "no-cache" });
      if (!response.ok) return { status: "absent", payload: null };
    } catch {
      return { status: "absent", payload: null };
    }
    try {
      return { status: "ok", payload: await response.json() };
    } catch (error) {
      console.error(error);
      return { status: "unreadable", payload: null };
    }
  }

  function showEmpty(message) {
    el("ceuApp").hidden = true;
    const empty = el("ceuEmpty");
    empty.hidden = false;
    el("ceuEmptyMessage").textContent = message;
  }

  function onThemeChange() {
    buildLegend();
    buildClassToggles();
    buildModelToggles();
    drawChart();
  }

  async function start() {
    const root = document.querySelector("[data-sky-base]");
    if (!root) return;
    state.base = (root.dataset.skyBase || "").replace(/\/$/, "");
    if (!state.base) {
      showEmpty("Esta publicação ainda não declara um diretório de condição do céu.");
      return;
    }
    if (typeof Chart === "undefined") {
      showEmpty("A biblioteca de gráficos não carregou.");
      return;
    }

    el("ceuEmpty").hidden = false;
    const [chart, frame] = await Promise.all([loadJson(KTKD_PAYLOAD), loadJson(FRAME_PAYLOAD)]);
    state.chartPayload = chart.payload;
    state.chartStatus = chart.status;
    state.framePayload = frame.payload;
    state.classes = resolveClasses(state.chartPayload);
    state.models = resolveModels(state.chartPayload);
    state.points = readPoints(state.chartPayload);
    state.density = readDensity(state.chartPayload);
    if (!state.density) state.layers.delete("density");
    if (!state.density && state.points.length) state.layers.add("points");
    if (state.models.length) state.activeModels.add(state.models[0].id);

    renderHeader();
    renderFrames();
    buildLegend();
    buildCaveats();
    buildLayerToggles();
    buildClassToggles();
    buildModelToggles();
    el("ceuOpacidade").addEventListener("input", applyMaskOpacity);
    el("ceuAmpliar").addEventListener("click", openZoom);
    el("ceuExport").addEventListener("click", exportCsv);

    el("ceuEmpty").hidden = true;
    el("ceuApp").hidden = false;
    drawChart();

    window.addEventListener("labmim-theme-change", onThemeChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
