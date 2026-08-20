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
  const CUMULATIVE_PAYLOAD = "kt_cumulative.json";
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

  /**
   * Validated over ALL pairs against the card surface (#f8f9fa light, #2d2d2d dark): on
   * a scatter any two classes can touch.
   *
   * Condition I is NOT the grey that "overcast" suggests. Grey fails the chroma floor,
   * and any grey chromatic enough to pass has become condition II's blue.
   *
   * Colour-blind separation sits in the 6-8 band, legal here because class is also fixed
   * by position against the dashed Kt boundaries — the cloud is drawn at POINT_ALPHA, so
   * hue is the weaker of the two cues by design and position carries the class.
   *
   * These hues are NOT solved against the model curves: no hue that clears the models
   * clears the classes. The curves stay legible over the cloud by luminance instead, via
   * the casing, which is what makes the collision (class III against the Lemos band, ΔE
   * 1,9 under protanopia in the light theme) survivable rather than fixed.
   */
  const CLASS_PALETTE = {
    light: { i: "#a85a93", ii: "#3761b4", iii: "#1a7f5a", iv: "#d9741c" },
    dark: { i: "#a8629a", ii: "#5589e6", iii: "#31a37a", iv: "#cb8030" },
  };

  // Keyed by the published model id. `ridley_brl_2010` is the one the exporter emits; `ridley_2010` is kept because
  // dropping it would silently move that model to a fallback colour on any payload still using the older id.
  const MODEL_PALETTE = {
    light: { marques_filho_2016: "#7c3aa8", lemos_2017: "#c2185b", ridley_brl_2010: "#0d86a3", ridley_2010: "#0d86a3" },
    dark: { marques_filho_2016: "#8a5fd0", lemos_2017: "#c9486f", ridley_brl_2010: "#2ba3ba", ridley_2010: "#2ba3ba" },
  };

  // A model id the palette does not know still has to be drawable.
  const MODEL_FALLBACK = { light: ["#7c3aa8", "#c2185b", "#0d86a3"], dark: ["#8a5fd0", "#c9486f", "#2ba3ba"] };

  // 23 mil pontos opacos apagavam as curvas dos modelos por acúmulo, não por ordem de
  // desenho: as linhas já vêm na frente. Com alfa o acúmulo passa a ser o próprio dado —
  // a cauda esparsa clareia e o núcleo satura — e a curva atravessa a nuvem.
  const POINT_ALPHA = 0.38;
  // Sobre o núcleo saturado nenhuma cor de linha se garante: no tema claro a classe III
  // e a banda de Lemos ficam a ΔE 1,9 sob protanopia. O contorno na cor do cartão separa
  // a linha do fundo por luminância, como as isóbaras fazem sobre os campos do WebGIS.
  const MODEL_CASING_WIDTH = 5.5;
  const CURVE_CASING_WIDTH = 7.5;
  const CURVE_LINE_WIDTH = 3.4;
  const CURVE_DASH = [9, 6];

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
    cumulativePayload: null,
    cumulativeSubsetId: "",
    cumulativeChart: null,
  };

  const { el, node, pad, decimal, integer, percent, fade, parseStationTime, downloadCsv } = window.labmimChartPage;
  const formatDay = window.labmimChartPage.formatDayYear;
  const formatStamp = window.labmimChartPage.formatStampYear;

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
      surface: isDark() ? "#2d2d2d" : "#fff",
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

  // "Marques Filho et al. (2016)" -> "Marques Filho"; "BRL — Ridley et al. (2010)" -> "Ridley". The dash separates
  // a family name from a citation, and the citation is the half that distinguishes — two of the three models are
  // BRL fits, so "BRL" alone would name neither. Both cuts apply, in order, whichever side of the dash survives:
  // otherwise one chip carries a year the others do not and the row stops reading as one set.
  function shortModelLabel(label) {
    const text = String(label || "");
    const segment = text.includes(" — ") ? text.split(" — ").pop().trim() : text;
    return segment.split(/\s+et al\.|\s+\(/)[0].trim() || segment;
  }

  // `label` is optional in the contract, so fall back to the id — never to `reference`:
  // deriving a name from the citation would make editing bibliography relabel the figure.
  function modelDisplayName(model) {
    if (model.label) return shortModelLabel(model.label);
    return String(model.id || "").replace(/_/g, " ");
  }

  function resolveModels(payload) {
    const declared = payload && Array.isArray(payload.models) ? payload.models : [];
    return declared
      .filter((model) => model && typeof model.id === "string" && Array.isArray(model.kt))
      .map((model) => ({ ...model, short: modelDisplayName(model) }));
  }

  // Rows are positional to keep the file small on a host that serves JSON uncompressed.
  // The order is therefore read from the payload, never assumed: kt and kd swapped would
  // mirror the figure across the diagonal and still look like a plausible scatter.
  const DEFAULT_POINTS_FORMAT = ["kt", "kd", "t"];

  function pointsFieldIndex(payload) {
    const declared = payload && payload.points_format;
    const order = Array.isArray(declared) && declared.length ? declared : DEFAULT_POINTS_FORMAT;
    return { kt: order.indexOf("kt"), kd: order.indexOf("kd"), t: order.indexOf("t") };
  }

  function readPoints(payload) {
    const raw = payload && Array.isArray(payload.points) ? payload.points : [];
    const at = pointsFieldIndex(payload);
    // A declaration without both coordinates names no scatter at all; falling back to positions it did not
    // declare would be guessing, and guessing here is what mirrors the figure.
    if (at.kt < 0 || at.kd < 0) return [];
    const points = [];
    for (const entry of raw) {
      const positional = Array.isArray(entry);
      const kt = positional ? entry[at.kt] : entry && entry.kt;
      const kd = positional ? entry[at.kd] : entry && entry.kd;
      const stamp = positional ? (at.t < 0 ? "" : entry[at.t]) : entry && entry.t;
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
    // Nothing to fade without a mask, and a control over an absent image reads
    // as a broken one.
    mask.addEventListener("error", () => {
      el("ceuOpacidadeControl").hidden = true;
    });
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

  /**
   * The bin that CONTAINS this Kt, never merely the nearest filled one: past the
   * end of a band the nearest summarised bin can be far away, and quoting its
   * value would attribute the model a number at a Kt where it was suppressed.
   */
  function modelBinAt(model, kt) {
    const spacing = model.kt.length > 1 ? Math.abs(model.kt[1] - model.kt[0]) : Infinity;
    let best = -1;
    let distance = Infinity;
    for (let index = 0; index < model.kt.length; index += 1) {
      const gap = Math.abs(model.kt[index] - kt);
      if (gap < distance) {
        distance = gap;
        best = index;
      }
    }
    return distance <= spacing ? best : -1;
  }

  function modelValueAt(model, kt) {
    const bin = modelBinAt(model, kt);
    if (bin < 0) return null;
    const value = model.kind === "band" ? model.median[bin] : model.kd[bin];
    return value === null || value === undefined ? null : { bin, value };
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
      let index = -1;
      if (dataset.labmimModel) {
        const model = state.models.find((entry) => entry.id === dataset.labmimModel);
        const found = model ? modelValueAt(model, observation ? observation.x : kt) : null;
        index = found ? found.bin : -1;
      } else if (observation) {
        index = dataset.data.indexOf(observation);
      }
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

  // No timestamp: on the Kt x Kd plane the instant is not what is being read.
  function tooltipTitle(items) {
    const observation = hoveredObservation(items);
    if (observation) return `Kt ${decimal(observation.x, 3)}`;
    const cell = state.hoverCell;
    if (!cell) return `Kt ${decimal(items[0].parsed.x, 3)}`;
    const hours = `${decimal(cell.count, 0)} ${cell.count === 1 ? "hora" : "horas"}`;
    return `Kt ${decimal(cell.kt[0], 3)}–${decimal(cell.kt[1], 3)} · Kd ${decimal(cell.kd[0], 3)}–${decimal(cell.kd[1], 3)} · ${hours}`;
  }

  function modelCasing(label, data, surface, width = MODEL_CASING_WIDTH) {
    return {
      type: "line",
      label: `${label} contorno`,
      labmimEnvelope: true,
      data,
      borderColor: surface,
      backgroundColor: "transparent",
      borderWidth: width,
      pointRadius: 0,
      pointHoverRadius: 0,
      spanGaps: false,
      tension: 0,
      order: 2,
    };
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
          backgroundColor: fade(theme.classes[entry.id], POINT_ALPHA),
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
        datasets.push(modelCasing(model.label, envelope(model.median), theme.surface));
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
      const curve = model.kt.map((kt, index) => ({ x: kt, y: model.kd[index], bin: index }));
      datasets.push(modelCasing(model.label, curve, theme.surface, CURVE_CASING_WIDTH));
      datasets.push({
        type: "line",
        label: model.label,
        labmimModel: model.id,
        data: curve,
        borderColor: color,
        backgroundColor: color,
        borderWidth: CURVE_LINE_WIDTH,
        borderDash: CURVE_DASH,
        borderCapStyle: "butt",
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
              // A suppressed bin has no mark to hang a coloured line on, and its
              // absence is worth naming: `n_per_bin` counts the hours that were
              // there, `min_samples_per_bin` the ones the summary needed.
              afterBody: (items) => {
                const observation = hoveredObservation(items);
                const kt = observation ? observation.x : items[0].parsed.x;
                const lines = [];
                for (const model of activeModels()) {
                  if (model.kind !== "band" || modelValueAt(model, kt)) continue;
                  const bin = modelBinAt(model, kt);
                  if (bin < 0) continue;
                  const hours = model.n_per_bin ? model.n_per_bin[bin] : 0;
                  const needed = model.min_samples_per_bin;
                  lines.push(
                    Number.isFinite(needed)
                      ? `${model.short}: ${decimal(hours, 0)} h nesta faixa, menos que as ${decimal(needed, 0)} do resumo`
                      : `${model.short}: faixa sem resumo`
                  );
                }
                return lines;
              },
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
      // The Kt band rides on the chip; the legend row it replaced repeated the swatch
      // and the name to add this one column.
      if (entry.range) button.appendChild(node("span", "sky-chip-range", entry.range));
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
          ? "Contagem de horas por célula do plano Kt × Kd: quanto mais escura, mais horas caíram ali"
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
  // The conditions colour individual hours, so they act on the point layer alone. They
  // appear with it rather than sitting disabled — which was the page's default state.
  function syncClassToggles() {
    const usable = showingPoints();
    const group = el("ceuClasses").closest(".clima-control");
    if (group) group.hidden = !usable;
    for (const button of el("ceuClasses").children) button.disabled = !usable;
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

  // Expanding `[[chave]]` belongs to assets/js/references.js. What is specific here is the SOURCE: the site
  // bibliography is embedded by the build, and a payload may register its own on top, the same way the climatology
  // page does with the one its manifest carries.
  const refs = () =>
    window.labmimReferences || {
      expand: (text) => document.createTextNode(String(text)),
      keysIn: () => [],
      get: () => null,
      register: () => {},
      linkable: () => false,
    };

  const withReferences = (text) => refs().expand(text);

  function registerPayloadReferences() {
    for (const payload of [state.chartPayload, state.cumulativePayload]) {
      if (payload && payload.references) refs().register(payload.references);
    }
  }

  function caveatTexts() {
    return [state.chartPayload, state.cumulativePayload]
      .filter(Boolean)
      .flatMap((payload) => (Array.isArray(payload.caveats) ? payload.caveats : []));
  }

  // Both payloads, deduplicated: they describe the same archive and repeat each other.
  function buildCaveats() {
    const list = el("ceuCaveats");
    const caveats = [...new Set(caveatTexts())];
    list.replaceChildren();
    for (const caveat of caveats) {
      const item = document.createElement("li");
      item.appendChild(withReferences(caveat));
      list.appendChild(item);
    }
    el("ceuNotasContagem").textContent = caveats.length ? `(${caveats.length})` : "";
    el("ceuNotasPainel").hidden = caveats.length === 0;
  }

  // The keys come from what the page ALREADY cited, not from a list kept here: the static prose is decorated by
  // references.js before this runs, leaving each expanded citation tagged with its key, and the payload caveats are
  // scanned for markers of their own. Two copies of that list would drift the day someone edits only the prose.
  function citedKeys() {
    const keys = [];
    const add = (key) => {
      if (key && !keys.includes(key)) keys.push(key);
    };
    for (const element of document.querySelectorAll("[data-ref-key]")) add(element.dataset.refKey);
    for (const text of caveatTexts()) refs().keysIn(text).forEach(add);
    return keys;
  }

  function renderReferences() {
    const panel = el("ceuRefsPanel");
    const list = el("ceuRefs");
    list.replaceChildren();
    for (const key of citedKeys()) {
      const entry = refs().get(key);
      if (!entry) continue;
      const item = document.createElement("li");
      // Same criterion as assets/js/references.js: a payload bibliography arrives with the deploy data, outside
      // every gate, so only an http(s) scheme becomes a link.
      if (refs().linkable(entry.url)) {
        const link = document.createElement("a");
        link.href = entry.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = entry.citation;
        item.appendChild(link);
      } else {
        item.textContent = entry.citation;
      }
      list.appendChild(item);
    }
    panel.hidden = list.children.length === 0;
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

  function guideDefinition(list, term, description) {
    list.appendChild(node("dt", null, term));
    const detail = node("dd");
    if (typeof description === "string") detail.textContent = description;
    else description(detail);
    list.appendChild(detail);
  }

  /**
   * A glossary at the point of use. The four conditions and the model kinds are
   * read from the payload rather than restated, so the panel cannot drift from
   * what the figure is actually drawing.
   */
  function openGuide() {
    const theme = themeColors();
    const dialog = document.createElement("dialog");
    dialog.className = "theme-surface sky-guide";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-label", "Como ler o gráfico de Kt × Kd");

    const head = node("div", "sky-guide-head");
    head.appendChild(node("h2", "sky-guide-title", "Como ler este gráfico"));
    const form = document.createElement("form");
    form.method = "dialog";
    form.appendChild(node("button", "btn btn-sm btn-outline-lab", "Fechar"));
    head.appendChild(form);
    dialog.appendChild(head);

    const list = node("dl", "sky-guide-list");
    guideDefinition(
      list,
      "Kt — índice de claridade",
      "A irradiação global medida na horizontal dividida pela irradiação no topo da atmosfera, no mesmo plano e no mesmo intervalo. Perto de 0 o céu está fechado; perto de 1 a atmosfera deixa passar quase tudo."
    );
    guideDefinition(
      list,
      "Kd — fração difusa",
      "A irradiação difusa dividida pela global. Perto de 1 quase toda a luz chega espalhada pelo céu; perto de 0 quase toda chega direto do disco solar. É difusa sobre global, não sobre a extraterrestre."
    );
    if (state.density) {
      guideDefinition(
        list,
        "Camada Densidade",
        "O plano é cortado em células e cada uma é pintada pelo número de horas do acervo que caíram nela: quanto mais escura, mais horas. A escala é logarítmica porque o miolo concentra dezenas de horas e as bordas têm uma ou duas."
      );
    }
    if (state.points.length) {
      guideDefinition(
        list,
        "Camada Pontos",
        "Uma marca por hora medida, colorida pela condição de céu daquele Kt. É a mesma amostra da densidade, hora a hora em vez de contada."
      );
    }
    guideDefinition(list, "Condições de céu", (detail) => {
      detail.appendChild(
        document.createTextNode("Faixas do índice de claridade, e não da fração difusa, que é consequência delas:")
      );
      for (const entry of state.classes) {
        const line = node("span", "sky-guide-condition");
        const swatch = node("span", "sky-swatch");
        swatch.style.background = theme.classes[entry.id];
        line.appendChild(swatch);
        line.appendChild(node("span", null, `${entry.roman} · ${entry.label} — ${entry.range}`));
        detail.appendChild(line);
      }
    });
    const bands = state.models.filter((model) => model.kind === "band");
    if (state.models.length) {
      guideDefinition(
        list,
        "Curva e banda",
        bands.length
          ? "Um modelo que depende só de Kt vira curva. Os que dependem também da hora solar, da elevação, do Kt diário e da persistência assumem uma faixa de valores num mesmo Kt: aparecem como banda, com a mediana dentro do envelope entre os percentis 10 e 90. Onde a faixa tem amostras de menos para resumir, a banda não é desenhada."
          : "Um modelo que depende só de Kt é desenhado como curva sobre a amostra."
      );
      guideDefinition(
        list,
        "RMSE e MBE",
        "O erro de cada modelo contra o Kd medido neste mesmo período. O RMSE mede o tamanho do erro; o MBE tem sinal e diz para que lado o modelo erra — positivo, ele fica acima da medida."
      );
    }
    guideDefinition(
      list,
      "As linhas tracejadas",
      "As verticais são os limites entre as condições de céu. A horizontal marca Kd = 0,5, onde a componente difusa iguala a direta — o mesmo ponto que define o limite em Kt = 0,55, e por isso as duas se encontram."
    );
    dialog.appendChild(list);

    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.showModal();
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
    downloadCsv("condicao-ceu-kt-kd.csv", rows);
  }

  function renderHeader() {
    const generated = parseStationTime((state.chartPayload && state.chartPayload.generated_utc) || "");
    el("ceuAtualizado").textContent = Number.isFinite(generated) ? `Publicado em ${formatStamp(generated)} UTC` : "";
  }

  /**
   * Absence and unreadability stay apart, as in monitoramento.js — a 200 cut in
   * half is the normal state during an upload, not a file yet to be deployed.
   */
  // Cumulative distribution of the clearness index (`labmim-kt-cumulative-v1`).
  //
  // A third payload, independent of the other two: it answers what the scatter cannot — not how Kd behaves at a
  // given Kt, but how much of the record sits in each sky condition at all. Rebuilt on the archive's cadence, so
  // it is fetched apart and may be absent while the others are present.
  //
  // `cumulative[i]` is F at the UPPER edge of bin i — fifty values for fifty-one edges — so the series is drawn on
  // a LINEAR x scale with `stepped: "after"`: F is defined AT the edges and holds constant between them. A
  // bin-centre axis would shift the whole curve half a bin off the numbers it refers to, and a smoothed line would
  // claim intermediate values a step function does not have.
  //
  // Whether `below`/`above` sit inside the denominator decides whether F can reach 1, and the page does not assume
  // either way: it draws the published values, caps the axis at 1, and names the out-of-edge hours beside the curve
  // instead of folding them in silently. In the sibling climatology contract they are NOT inside `n` — every
  // published subset there has `sum(counts) == n` exactly — so a reader who assumes otherwise misreads the total.

  function cumulativeSubsets() {
    const payload = state.cumulativePayload;
    const subsets = payload && payload.subsets;
    if (!subsets || typeof subsets !== "object") return [];
    return Object.entries(subsets).map(([id, subset]) => ({
      id,
      label: (subset && subset.label) || id,
      subset,
    }));
  }

  function currentCumulativeSubset() {
    const entry = cumulativeSubsets().find((item) => item.id === state.cumulativeSubsetId);
    return entry ? entry.subset : null;
  }

  function cumulativePoints(subset, edges) {
    const values = (subset && subset.cumulative) || [];
    if (!values.length || !Array.isArray(edges) || edges.length < 2) return [];
    const points = [{ x: edges[0], y: 0 }];
    for (let index = 0; index < values.length; index += 1) {
      points.push({ x: edges[index + 1], y: values[index] });
    }
    return points;
  }

  // No copy of the thresholds here. They are literature, they arrive beside their citation in the payload, and the
  // embedded fallback this file keeps for the scatter exists only so the figure never draws boundaries from
  // nowhere — it is not a second source to classify by.
  function cumulativeBounds(subset) {
    const sky = subset && subset.sky_conditions;
    const bounds = sky && Array.isArray(sky.kt_upper_bounds) ? sky.kt_upper_bounds : [];
    return bounds.filter((value) => Number.isFinite(value));
  }

  // Read by `condition`/`id`, never by position: the exporter's internal class is 0-based while the literature
  // numbers I to IV, so a raw index crossing that boundary is an off-by-one waiting to happen.
  function cumulativeConditionAt(subset, value) {
    const sky = subset && subset.sky_conditions;
    for (const condition of (sky && sky.conditions) || []) {
      const range = condition.kt_range || [];
      const low = range[0];
      const high = range[1];
      const aboveLow = low === null || low === undefined || value > low;
      const belowHigh = high === null || high === undefined || value <= high;
      if (aboveLow && belowHigh) return condition;
    }
    return null;
  }

  function cumulativeConditionLabel(condition) {
    if (!condition) return "—";
    const numeral = String(condition.id || condition.condition || "").toUpperCase();
    return `${numeral} ${condition.name_pt || condition.name || ""}`.trim();
  }

  const CUMULATIVE_AREA_ALPHA = 0.12;
  const CUMULATIVE_BAND_ALPHA = 0.3;

  function conditionPixelRange(condition, chart) {
    const { chartArea, scales } = chart;
    const range = (condition && condition.kt_range) || [];
    const low = Number.isFinite(range[0]) ? scales.x.getPixelForValue(range[0]) : chartArea.left;
    const high = Number.isFinite(range[1]) ? scales.x.getPixelForValue(range[1]) : chartArea.right;
    return [Math.max(chartArea.left, Math.min(low, high)), Math.min(chartArea.right, Math.max(low, high))];
  }

  function paintCumulativeArea(chart, points, columns, fillStyle) {
    const spans = columns.filter(([left, right]) => right - left > 0.5);
    if (!spans.length) return;
    const { ctx, chartArea, scales } = chart;
    const baseline = scales.y.getPixelForValue(0);
    ctx.save();
    ctx.beginPath();
    for (const [left, right] of spans) {
      ctx.rect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
    }
    ctx.clip();
    ctx.fillStyle = fillStyle;
    for (let index = 0; index < points.length - 1; index += 1) {
      const top = scales.y.getPixelForValue(points[index + 1].y);
      if (top >= baseline) continue;
      const left = scales.x.getPixelForValue(points[index].x);
      const right = scales.x.getPixelForValue(points[index + 1].x);
      ctx.fillRect(left, top, right - left, baseline - top);
    }
    ctx.restore();
  }

  function cumulativeAreaPlugin(subset, theme, points) {
    let hovered = null;
    return {
      id: "ceuAcumuladaArea",
      afterEvent(chart, args) {
        const { event } = args;
        const { chartArea } = chart;
        const inside =
          event.type !== "mouseout" &&
          Number.isFinite(event.x) &&
          Number.isFinite(event.y) &&
          event.x >= chartArea.left &&
          event.x <= chartArea.right &&
          event.y >= chartArea.top &&
          event.y <= chartArea.bottom;
        const next = inside ? cumulativeConditionAt(subset, chart.scales.x.getValueForPixel(event.x)) : null;
        const nextId = next ? String(next.id || "").toLowerCase() : "";
        if (nextId === (hovered ? String(hovered.id || "").toLowerCase() : "")) return;
        hovered = nextId ? next : null;
        args.changed = true;
      },
      beforeDatasetsDraw(chart) {
        if (!points.length) return;
        const { chartArea } = chart;
        const wash = `rgba(${theme.ink}, ${CUMULATIVE_AREA_ALPHA})`;
        if (!hovered) {
          paintCumulativeArea(chart, points, [[chartArea.left, chartArea.right]], wash);
          return;
        }
        const [bandLeft, bandRight] = conditionPixelRange(hovered, chart);
        paintCumulativeArea(
          chart,
          points,
          [
            [chartArea.left, bandLeft],
            [bandRight, chartArea.right],
          ],
          wash
        );
        const hue = theme.classes[String(hovered.id || "").toLowerCase()];
        if (!hue) return;
        paintCumulativeArea(chart, points, [[bandLeft, bandRight]], fade(hue, CUMULATIVE_BAND_ALPHA));
      },
    };
  }

  function cumulativeBoundsPlugin(subset, theme) {
    const bounds = cumulativeBounds(subset);
    return {
      id: "ceuAcumuladaBounds",
      afterDatasetsDraw(chart) {
        if (!bounds.length) return;
        const { ctx, chartArea, scales } = chart;
        ctx.save();
        ctx.strokeStyle = theme.textSecondary;
        ctx.fillStyle = theme.textSecondary;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        // The lines always draw; the labels yield to each other. On a narrow chart the boundaries sit a few pixels
        // apart and two numbers printed on top of one another read as a third, wrong one.
        let lastLabelRight = -Infinity;
        for (const bound of bounds) {
          const x = scales.x.getPixelForValue(bound);
          if (x < chartArea.left || x > chartArea.right) continue;
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          const text = decimal(bound, 2);
          const half = ctx.measureText(text).width / 2;
          if (x - half > lastLabelRight + 4) {
            ctx.fillText(text, x, chartArea.top + 12);
            lastLabelRight = x + half;
          }
        }
        ctx.restore();
      },
    };
  }

  function drawCumulative() {
    const panel = el("ceuAcumuladaPainel");
    const subset = currentCumulativeSubset();
    const payload = state.cumulativePayload;
    if (!payload || !subset) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    const theme = themeColors();
    const edges = payload.edges || [];
    const points = cumulativePoints(subset, edges);
    const lineInk = `rgb(${theme.ink})`;

    if (state.cumulativeChart) {
      state.cumulativeChart.destroy();
      state.cumulativeChart = null;
    }

    const canvas = el("ceuAcumuladaCanvas");
    state.cumulativeChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          {
            label: "Fração acumulada",
            data: points,
            borderColor: lineInk,
            backgroundColor: lineInk,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            stepped: "after",
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "nearest", axis: "x" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: lineInk,
            borderWidth: 1,
            callbacks: {
              title: (items) => `Kt até ${decimal(items[0].parsed.x, 2)}`,
              label: (item) => {
                const lines = [`Fração do registro: ${percent(item.parsed.y, 2)}`];
                const condition = cumulativeConditionAt(subset, item.parsed.x);
                if (condition) lines.push(`Condição ${cumulativeConditionLabel(condition)}`);
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: edges[0],
            max: edges[edges.length - 1],
            title: { display: true, text: "Kt", color: theme.textSecondary },
            ticks: { color: theme.textSecondary, maxTicksLimit: 11 },
            grid: { display: false },
          },
          y: {
            min: 0,
            max: 1,
            title: { display: true, text: "Fração acumulada", color: theme.textSecondary },
            ticks: { color: theme.textSecondary, callback: (value) => percent(value, 0) },
            grid: { color: theme.grid },
          },
        },
      },
      plugins: [cumulativeAreaPlugin(subset, theme, points), cumulativeBoundsPlugin(subset, theme)],
    });

    canvas.setAttribute(
      "aria-label",
      `Distribuição acumulada do índice de claridade — ${currentCumulativeLabel()}. ` +
        `As frações por condição de céu estão listadas acima do gráfico.`
    );

    renderCumulativeClasses(subset);
    renderCumulativeStatus(subset);
  }

  function currentCumulativeLabel() {
    const entry = cumulativeSubsets().find((item) => item.id === state.cumulativeSubsetId);
    return entry ? entry.label : state.cumulativeSubsetId;
  }

  // The share of hours per class is the headline, not a footnote: the curve answers "how often below Kt", these
  // answer "how often in this state", and the second is what the classification exists for. Published already
  // computed — reading it off an interpolated F would be a second numerical path free to disagree.
  function renderCumulativeClasses(subset) {
    const container = el("ceuAcumuladaClasses");
    container.replaceChildren();
    const sky = subset.sky_conditions || {};
    for (const condition of sky.conditions || []) {
      const tile = node("div", "clima-stat");
      const value = node("span", "clima-stat-value", percent(condition.fraction, 1));
      const caption = node("span", "clima-stat-label", cumulativeConditionLabel(condition));
      tile.append(value, caption);
      container.appendChild(tile);
    }
  }

  function renderCumulativeStatus(subset) {
    const sky = subset.sky_conditions || {};
    const below = Number.isFinite(subset.below) ? subset.below : 0;
    const above = Number.isFinite(subset.above) ? subset.above : 0;
    const parts = [`${integer(subset.n)} horas no recorte`];
    if (sky.n !== undefined && sky.n !== null) parts.push(`${integer(sky.n)} classificadas`);
    // Named, not hidden: these sit inside `n` but outside the curve, which is exactly why F does not reach 1.
    if (below || above) {
      const ends = [];
      if (below) ends.push(`${integer(below)} abaixo`);
      if (above) ends.push(`${integer(above)} acima`);
      parts.push(`fora das bordas ${ends.join(" e ")}`);
    }
    el("ceuAcumuladaStatus").textContent = `${parts.join(" · ")}.`;
  }

  function buildCumulativeSubsetToggles() {
    const group = el("ceuAcumuladaRecorte");
    group.replaceChildren();
    const entries = cumulativeSubsets();
    // A single published slice needs no chooser — the control would be a button that changes nothing.
    group.parentElement.hidden = entries.length < 2;
    for (const entry of entries) {
      const button = node("button", "clima-segmented-btn", entry.label);
      button.type = "button";
      button.dataset.subset = entry.id;
      button.setAttribute("aria-pressed", String(entry.id === state.cumulativeSubsetId));
      button.classList.toggle("is-active", entry.id === state.cumulativeSubsetId);
      button.addEventListener("click", () => {
        state.cumulativeSubsetId = entry.id;
        for (const other of group.children) {
          const active = other.dataset.subset === state.cumulativeSubsetId;
          other.setAttribute("aria-pressed", String(active));
          other.classList.toggle("is-active", active);
        }
        drawCumulative();
      });
      group.appendChild(button);
    }
  }

  function initCumulative() {
    const payload = state.cumulativePayload;
    const entries = cumulativeSubsets();
    if (!payload || !entries.length) {
      el("ceuAcumuladaPainel").hidden = true;
      return;
    }
    state.cumulativeSubsetId = entries[0].id;
    // The citation goes in as a marker, not spelled out: the reader gets the short form here, the link on it, and
    // the full record in the panel at the foot of the page — the same shape every other citation on the site has.
    // The payload publishes `sky_conditions.reference` as prose, and printing it here would be a second, longer
    // wording of a work the page already cites properly two paragraphs above.
    const note = el("ceuAcumuladaNota");
    note.replaceChildren(
      withReferences(
        "Curva: fração do registro com Kt até o valor lido no eixo — função escada, constante entre arestas. " +
          "Verticais tracejadas: os limites entre as condições de céu [[escobedo]], na nomenclatura de [[teramoto]]."
      )
    );
    buildCumulativeSubsetToggles();
  }

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
    buildClassToggles();
    buildModelToggles();
    drawChart();
    drawCumulative();
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
    const [chart, frame, cumulative] = await Promise.all([
      loadJson(KTKD_PAYLOAD),
      loadJson(FRAME_PAYLOAD),
      loadJson(CUMULATIVE_PAYLOAD),
    ]);
    state.chartPayload = chart.payload;
    state.chartStatus = chart.status;
    state.framePayload = frame.payload;
    state.cumulativePayload = cumulative.payload;
    state.classes = resolveClasses(state.chartPayload);
    state.models = resolveModels(state.chartPayload);
    state.points = readPoints(state.chartPayload);
    state.density = readDensity(state.chartPayload);
    if (!state.density) state.layers.delete("density");
    if (!state.density && state.points.length) state.layers.add("points");
    if (state.models.length) state.activeModels.add(state.models[0].id);

    // Before anything renders text: a payload bibliography has to be in the registry for the markers in its own
    // caveats to expand into citations instead of staying literal.
    registerPayloadReferences();

    renderHeader();
    renderFrames();
    buildCaveats();
    buildLayerToggles();
    buildClassToggles();
    buildModelToggles();
    el("ceuOpacidade").addEventListener("input", applyMaskOpacity);
    el("ceuGuia").addEventListener("click", openGuide);
    el("ceuAmpliar").addEventListener("click", openZoom);
    el("ceuExport").addEventListener("click", exportCsv);

    initCumulative();
    // Last, so it sees every citation the page ended up making — the static prose already decorated by
    // references.js, plus the markers the two payloads brought in.
    renderReferences();

    el("ceuEmpty").hidden = true;
    el("ceuApp").hidden = false;
    drawChart();
    drawCumulative();

    window.addEventListener("labmim-theme-change", onThemeChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
