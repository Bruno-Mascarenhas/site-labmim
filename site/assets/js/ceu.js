/**
 * Sky-condition page: reads `labmim-ktkd-v1`, `labmim-kt-cumulative-v1`, `labmim-allsky-frame-v2`,
 * `labmim-allsky-timeline-v1` and `labmim-allsky-model-v1` from `data-sky-base`.
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
  const TIMELINE_PAYLOAD = "timeline.json";
  const MODEL_PAYLOAD = "model.json";
  const CUMULATIVE_PAYLOAD = "kt_cumulative.json";
  const POINTS_FILE_SCHEMA = "labmim-ktkd-points-v1";
  const POINTS_LOADING_MESSAGE = "Carregando os pontos horários…";
  const POINTS_FAILURE_MESSAGES = {
    absent: "Os pontos horários não puderam ser baixados.",
    unreadable: unreadableMessage("O arquivo dos pontos horários"),
    foreign: "O arquivo dos pontos horários não está no formato que esta página lê.",
    stale:
      "Os pontos horários publicados são de outra versão do documento de Kt × Kd, que está sendo atualizado. Recarregue a página em alguns minutos.",
  };
  const UNDECLARED_KD_HEADROOM = 0.1;
  const DEFAULT_RAW_FRAME = "allsky.jpg";
  const DEFAULT_ATTRIBUTION_FRAME = "attribution.png";
  const DEFAULT_INPUT_FRAME = "input.jpg";
  const FRAME_IMAGE_COUNT = 3;

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

  const GRID_EDGE_FORMAT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

  const state = {
    base: "",
    chart: null,
    chartPayload: null,
    chartStatus: "absent",
    framePayload: null,
    frameStatus: "absent",
    timelinePayload: null,
    timelineStatus: "absent",
    modelPayload: null,
    modelStatus: "absent",
    cumulativeStatus: "absent",
    timelineChart: null,
    stripChart: null,
    curveChart: null,
    classes: [],
    models: [],
    points: [],
    pointsRequest: null,
    pointsStatus: "idle",
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

  const { el, node, statTile, pad, decimal, integer, percent, fade, parseStationTime, downloadCsv } =
    window.labmimChartPage;
  const formatDay = window.labmimChartPage.formatDayYear;
  const formatStamp = window.labmimChartPage.formatStampYear;
  const formatShortDay = window.labmimChartPage.formatDay;
  const formatHour = window.labmimChartPage.formatHour;

  function isDark() {
    return document.documentElement.classList.contains("dark-theme");
  }

  function classPalette() {
    return isDark() ? CLASS_PALETTE.dark : CLASS_PALETTE.light;
  }

  function themeColors() {
    const root = getComputedStyle(document.documentElement);
    return {
      classes: classPalette(),
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
      band: isDark() ? "rgba(255, 255, 255, 0.09)" : "rgba(0, 0, 0, 0.07)",
      measured: isDark() ? MODEL_PALETTE.dark.lemos_2017 : MODEL_PALETTE.light.lemos_2017,
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

  function declaredPointCount() {
    const declared = state.chartPayload && state.chartPayload.points_file;
    if (!declared || typeof declared.name !== "string" || !declared.name) return 0;
    return Number.isInteger(declared.n) && declared.n > 0 ? declared.n : 0;
  }

  function pointsOffered() {
    return state.points.length > 0 || declaredPointCount() > 0;
  }

  function pointsFailed() {
    return POINTS_FAILURE_MESSAGES[state.pointsStatus] !== undefined;
  }

  function pointsStatusMessage() {
    if (state.pointsStatus === "loading") return POINTS_LOADING_MESSAGE;
    return pointsFailed() ? POINTS_FAILURE_MESSAGES[state.pointsStatus] : "";
  }

  function pointsFileStatus(result) {
    if (result.status !== "ok") return result.status;
    const payload = result.payload;
    if (!payload || payload.schema !== POINTS_FILE_SCHEMA) return "foreign";
    const version = state.chartPayload.version;
    if (typeof version !== "string" || !version || payload.version !== version) return "stale";
    return "ok";
  }

  function focusedPointsControl() {
    const focused = document.activeElement;
    if (!focused) return null;
    return focused === el("ceuExport") || el("ceuCamadas").contains(focused) ? focused : null;
  }

  function refocusLayerToggles(control) {
    if (control.isConnected && !control.disabled) return;
    const fallback = Array.from(el("ceuCamadas").children).find((button) => !button.disabled);
    if (fallback) {
      fallback.focus();
      return;
    }
    const status = el("ceuStatus");
    status.tabIndex = -1;
    status.focus();
  }

  function acceptPointsFile(result) {
    const focusedControl = focusedPointsControl();
    const status = pointsFileStatus(result);
    const points = status === "ok" ? readPoints(result.payload) : [];
    state.pointsStatus = status === "ok" && !points.length ? "unreadable" : status;
    state.points = points;
    invalidateVisiblePoints();
    if (pointsFailed()) {
      state.layers.delete("points");
      buildLayerToggles();
    }
    syncClassToggles();
    drawChart();
    if (focusedControl) refocusLayerToggles(focusedControl);
  }

  function ensurePoints() {
    if (state.points.length || !declaredPointCount()) return Promise.resolve();
    if (!state.pointsRequest) {
      state.pointsStatus = "loading";
      state.pointsRequest = loadJson(state.chartPayload.points_file.name).then(acceptPointsFile);
    }
    return state.pointsRequest;
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
    if (!grid.counts.every((row) => row.every(Number.isFinite))) return null;
    return grid;
  }

  function densityGridSpan(grid) {
    const span = (edges) =>
      `de ${GRID_EDGE_FORMAT.format(edges[0])} a ${GRID_EDGE_FORMAT.format(edges[edges.length - 1])}`;
    const kt = span(grid.kt_edges);
    const kd = span(grid.kd_edges);
    return kt === kd ? kt : `(Kt ${kt}, Kd ${kd})`;
  }

  function hoursOutsideDensityGrid() {
    const grid = state.density;
    if (!grid || !Number.isInteger(grid.n_outside) || grid.n_outside < 1) return null;
    const inside = grid.counts.reduce((total, row) => row.reduce((sum, count) => sum + count, total), 0);
    return { inside, outside: grid.n_outside, span: densityGridSpan(grid) };
  }

  function densityCoverageSentence(coverage, pointsLayerAvailable) {
    const rest = coverage.outside === 1 ? "mais uma fica" : `outras ${integer(coverage.outside)} ficam`;
    const appear = coverage.outside === 1 ? "aparece" : "aparecem";
    const inside = `${integer(coverage.inside)} ${coverage.inside === 1 ? "hora" : "horas"}`;
    const where = pointsLayerAvailable ? ` e só ${appear} na camada Pontos` : "";
    return `A densidade conta ${inside}; ${rest} fora da grade ${coverage.span}${where}.`;
  }

  function classOf(kt) {
    return state.classes.find((entry) => kt <= entry.max) || state.classes[state.classes.length - 1] || null;
  }

  const ATTRIBUTION_ALT =
    "Mapa de sensibilidade à oclusão sobre o quadro all-sky: cor mais intensa onde cobrir a janela mais altera o índice de céu claro previsto";

  const REASON_PT = {
    fresh: "quadro recente",
    night: "o sol está abaixo do piso de elevação do modelo; a câmera segue, mas nada é pontuado à noite",
    no_scored_frame: "nenhum quadro foi pontuado ainda",
    watch_stale: "há luz do dia, mas a vigília não escreveu uma previsão nos últimos blocos",
  };

  const REGION_PT = {
    disc: "disco do céu",
    overlay_band: "faixa de texto",
    pad: "borda preta",
    other: "restante do quadro",
  };
  const CLOCK_OFFSET_TOLERANCE_S = 60;
  const MINUTE_MS = 60000;
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  const DAY_STAMP = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseStationDate(value) {
    const parts = DAY_STAMP.exec(String(value || "").trim());
    if (parts) return Date.UTC(+parts[1], +parts[2] - 1, +parts[3]);
    return parseStationTime(value || "");
  }

  const ROLE_PT = {
    all: "todas as cabeças",
    sky: "condição de céu",
    dhi: "difusa",
    kindex: "índice de céu claro",
    best: "melhor época da validação",
  };

  function codeVersionText(value) {
    if (value && typeof value === "object") {
      const parts = [];
      if (value.package_version) parts.push(`versão ${value.package_version}`);
      if (value.git_commit) parts.push(`commit ${shortHash(value.git_commit)}`);
      return parts.join(", ") || "—";
    }
    return text(value);
  }

  function geometryText(geometry) {
    if (!geometry || typeof geometry !== "object") return text(geometry, "");
    const parts = [];
    const crop = geometry.crop;
    if (crop && typeof crop === "object" && crop.enabled !== false && finite(crop.width) && finite(crop.height)) {
      parts.push(
        `recorte de ${integer(crop.width)} × ${integer(crop.height)} px em (${integer(crop.left)}, ${integer(crop.top)})`
      );
    }
    const padding = geometry.pad;
    if (padding && typeof padding === "object" && padding.enabled !== false) {
      const sides = ["top", "right", "bottom", "left"].map((side) => integer(padding[side])).join(" / ");
      parts.push(`preenchimento ${sides} px${padding.fill !== undefined ? ` com ${padding.fill}` : ""}`);
    }
    if (finite(geometry.resize)) parts.push(`redimensionado para ${integer(geometry.resize)} px`);
    const mask = geometry.mask;
    if (mask && typeof mask === "object") {
      parts.push(mask.enabled ? `máscara do disco (limiar ${decimal(mask.threshold, 2)})` : "sem máscara do disco");
    }
    return parts.join(" · ");
  }
  const HEAD_PT = { dhi: "DHI", kindex: "k*", sky: "condição de céu" };

  function roleLabel(value) {
    return ROLE_PT[value] || String(value);
  }

  function headLabel(value) {
    return HEAD_PT[value] || String(value);
  }

  function text(value, fallback = "—") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function signed(value, digits) {
    if (!finite(value)) return "—";
    if (value < 0) return `−${decimal(Math.abs(value), digits)}`;
    return `+${decimal(value, digits)}`;
  }

  function trueMinus(value, digits) {
    if (!finite(value)) return "—";
    return value < 0 ? `−${decimal(Math.abs(value), digits)}` : decimal(value, digits);
  }

  function withUnit(formatted, unit) {
    return formatted === "—" ? formatted : `${formatted} ${unit}`;
  }

  function transition(from, to, digits) {
    return finite(from) ? `${decimal(from, digits)} → ${decimal(to, digits)}` : decimal(to, digits);
  }

  function unreadableMessage(subject) {
    return `${subject} chegou incompleto ou ilegível; ele pode estar sendo publicado neste momento.`;
  }

  function shortHash(value) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 12) : "—";
  }

  const ENGLISH_CONDITION_NAMES = { i: "cloudy", ii: "partly_cloudy_diffuse", iii: "partly_cloudy_clear", iv: "clear" };

  function declaredConditions(payload) {
    for (const block of [
      payload && payload.sky_conditions,
      payload && payload.evaluation && payload.evaluation.sky_conditions,
    ]) {
      if (block && Array.isArray(block.conditions) && block.conditions.length) return block.conditions;
    }
    return null;
  }

  function conditionsOf(payload) {
    const source = declaredConditions(payload) || FALLBACK_CLASSES;
    return source
      .filter((entry) => entry && (entry.id || Number.isInteger(entry.condition)))
      .map((entry) => {
        const id = String(entry.id || ROMAN[(entry.condition || 0) - 1] || "").toLowerCase();
        const condition = Number.isInteger(entry.condition) ? entry.condition : ROMAN.indexOf(id.toUpperCase()) + 1;
        return {
          id,
          condition,
          english: typeof entry.name === "string" ? entry.name.toLowerCase() : ENGLISH_CONDITION_NAMES[id] || "",
          roman: ROMAN[condition - 1] || String(condition),
          name: entry.name_pt || SHORT_LABELS[id] || id,
          short: SHORT_LABELS[id] || entry.name_pt || id,
        };
      })
      .sort((left, right) => left.condition - right.condition);
  }

  function resolveCondition(payload, reference) {
    if (reference === null || reference === undefined) return null;
    const conditions = conditionsOf(payload);
    const asObject = typeof reference === "object";
    const id = String(asObject ? reference.id || "" : typeof reference === "string" ? reference : "").toLowerCase();
    const declared = Number(asObject ? reference.condition : reference);
    const number = Number.isInteger(declared) ? declared : /^\d+$/.test(id) ? Number(id) : NaN;
    return (
      (id && conditions.find((entry) => entry.id === id)) ||
      (Number.isInteger(number) && conditions.find((entry) => entry.condition === number)) ||
      (id && conditions.find((entry) => entry.english === id || entry.name.toLowerCase() === id)) ||
      null
    );
  }

  function conditionSwatch(condition) {
    const swatch = node("span", "sky-swatch");
    swatch.style.background = classPalette()[condition.id] || "#888";
    return swatch;
  }

  function conditionLabel(condition) {
    return `${condition.roman} · ${condition.name}`;
  }

  function conditionShort(condition) {
    return `${condition.roman} · ${condition.short}`;
  }

  function conditionCell(condition) {
    const chip = node("span", "sky-condition-cell");
    chip.append(conditionSwatch(condition), node("span", null, conditionLabel(condition)));
    return chip;
  }

  function legendItem(list, swatch, label) {
    const mark = swatch instanceof Node ? swatch : node("span", "sky-swatch");
    if (!(swatch instanceof Node)) Object.assign(mark.style, swatch);
    const item = node("li");
    item.append(mark, node("span", null, label));
    list.appendChild(item);
  }

  function fillConditionBar(bar, payload, shares) {
    bar.replaceChildren();
    const colors = classPalette();
    const drawn = [];
    if (shares && typeof shares === "object") {
      for (const condition of conditionsOf(payload)) {
        const fraction = shares[condition.id];
        if (!finite(fraction)) continue;
        const segment = node("span", "sky-bar-segment");
        segment.style.width = `${(fraction * 100).toFixed(1)}%`;
        segment.style.background = colors[condition.id] || "#888";
        bar.appendChild(segment);
        drawn.push({ condition, fraction });
      }
    }
    return drawn;
  }

  function shareLabels(drawn) {
    return drawn.map(({ condition, fraction }) => `${condition.roman} ${percent(fraction, 0)}`);
  }

  function utcOffsetHours(payload) {
    const zone = payload && payload.timezone;
    if (!zone || typeof zone !== "object") return NaN;
    for (const key of ["utc_offset_hours", "offset_hours", "utc_offset"]) {
      if (finite(zone[key])) return zone[key];
    }
    return NaN;
  }

  function stationToUtcMs(payload, localStamp) {
    const local = parseStationTime(localStamp || "");
    const offset = utcOffsetHours(payload);
    if (!Number.isFinite(local) || !Number.isFinite(offset)) return NaN;
    return local - offset * HOUR_MS;
  }

  function ageText(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
    const minutes = Math.floor(elapsedMs / MINUTE_MS);
    if (minutes < 1) return "há menos de 1 min";
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `há ${hours} h ${pad(minutes % 60)} min`;
    return `há ${Math.floor(hours / 24)} dias`;
  }

  function withAge(payload, localStamp) {
    const age = ageText(Date.now() - stationToUtcMs(payload, localStamp));
    return age ? ` (${age})` : "";
  }

  function clockOffsetText(offsetSeconds) {
    if (!finite(offsetSeconds) || Math.abs(offsetSeconds) <= CLOCK_OFFSET_TOLERANCE_S) return "";
    const direction = offsetSeconds > 0 ? "atrasado" : "adiantado";
    return `relógio da câmera ${direction} ${integer(Math.abs(offsetSeconds))} s`;
  }

  function targetsGlossary() {
    const evaluationTargets =
      state.modelPayload && state.modelPayload.evaluation && state.modelPayload.evaluation.targets;
    for (const targets of [
      state.framePayload && state.framePayload.targets,
      state.timelinePayload && state.timelinePayload.targets,
      evaluationTargets,
    ]) {
      if (targets && typeof targets === "object" && targets.kindex) return targets;
    }
    return {};
  }

  function kindexLabel() {
    const label = text((targetsGlossary().kindex || {}).label_pt, "índice de céu claro");
    const symbol = kindexSymbol();
    return label.includes(symbol) ? label : `${label} ${symbol}`;
  }

  function kindexSymbol() {
    return text((targetsGlossary().kindex || {}).symbol, "k*");
  }

  function dhiLabel() {
    return text((targetsGlossary().dhi || {}).label_pt, "irradiância difusa horizontal");
  }

  function dhiUnit() {
    return text((targetsGlossary().dhi || {}).unit, "W/m²");
  }

  function frameToken() {
    const captured = state.framePayload ? state.framePayload.captured_at : null;
    const parsed = parseStationTime(captured || "");
    if (Number.isFinite(parsed)) return String(parsed);
    return String(Math.floor(Date.now() / FRAME_BUCKET_MS));
  }

  function frameSection(name) {
    const block = state.framePayload && state.framePayload[name];
    return block && typeof block === "object" ? block : null;
  }

  function frameFileName(name, fallback) {
    const block = frameSection(name);
    return text(block && block.file, fallback);
  }

  function frameCacheToken(name) {
    const block = frameSection(name);
    if (block && typeof block.sha256_12 === "string" && block.sha256_12.trim()) {
      return `v=${encodeURIComponent(block.sha256_12.trim())}`;
    }
    return `t=${encodeURIComponent(frameToken())}`;
  }

  function frameUrl(name, fallback) {
    return `${state.base}/${frameFileName(name, fallback)}?${frameCacheToken(name)}`;
  }

  function frameAlt(name, fallback) {
    const block = frameSection(name);
    return text(block && block.alt_pt, fallback);
  }

  function frameImage(url, alt, className) {
    const image = document.createElement("img");
    image.className = className;
    image.alt = alt;
    image.decoding = "async";
    image.src = url;
    return image;
  }

  function buildFrame(container, url, alt, noteElement, missingMessage) {
    const image = frameImage(url, alt, "sky-frame-image");
    image.addEventListener("error", () => {
      state.framesMissing += 1;
      container.replaceChildren(node("div", "sky-frame-missing", missingMessage));
      noteElement.textContent = "";
      settleEmptyState();
    });
    container.replaceChildren(image);
    return image;
  }

  function allPayloadsAbsent() {
    return [
      state.chartStatus,
      state.frameStatus,
      state.timelineStatus,
      state.modelStatus,
      state.cumulativeStatus,
    ].every((status) => status === "absent");
  }

  function settleEmptyState() {
    if (state.framesMissing < FRAME_IMAGE_COUNT || !allPayloadsAbsent()) return;
    showEmpty(
      "Os dados de condição do céu ainda não foram publicados para esta estação. " +
        "Eles são anexados ao site no deploy, separadamente das páginas."
    );
  }

  function applyOverlayOpacity() {
    const slider = el("ceuOpacidade");
    slider.setAttribute("aria-valuetext", `${slider.value}% de opacidade do mapa de sensibilidade`);
    const overlay = el("ceuMediaSensibilidade").querySelector(".sky-frame-overlay");
    if (!overlay) return;
    overlay.style.opacity = String(Number(slider.value) / 100);
  }

  function fitFrameBox(container, image) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    container.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
  }

  function frameScored() {
    const frame = state.framePayload;
    return Boolean(frame && frame.status && frame.status.scored !== false && frame.prediction);
  }

  function renderFrames() {
    const rawUrl = frameUrl("image", DEFAULT_RAW_FRAME);
    const raw = buildFrame(
      el("ceuMediaBruto"),
      rawUrl,
      frameAlt("image", "Quadro bruto da câmera all-sky"),
      el("ceuNotaBruto"),
      "Quadro ainda não publicado."
    );
    raw.addEventListener("load", () => {
      fitFrameBox(el("ceuMediaBruto"), raw);
      fitFrameBox(el("ceuMediaSensibilidade"), raw);
    });

    const overlayContainer = el("ceuMediaSensibilidade");
    const overlay = buildFrame(
      overlayContainer,
      frameUrl("attribution", DEFAULT_ATTRIBUTION_FRAME),
      frameAlt("attribution", ATTRIBUTION_ALT),
      el("ceuNotaSensibilidade"),
      "Mapa de sensibilidade ainda não publicado."
    );
    overlay.classList.add("sky-frame-overlay");
    overlay.addEventListener("error", () => {
      el("ceuOpacidadeControl").hidden = true;
    });
    const underlay = frameImage(rawUrl, "", "sky-frame-image");
    underlay.setAttribute("aria-hidden", "true");
    underlay.addEventListener("error", () => underlay.remove());
    overlayContainer.insertBefore(underlay, overlay);
    applyOverlayOpacity();

    const input = buildFrame(
      el("ceuMediaEntrada"),
      frameUrl("input", DEFAULT_INPUT_FRAME),
      frameAlt("input", "O recorte quadrado que a rede recebeu"),
      el("ceuNotaEntrada"),
      "Entrada da rede ainda não publicada."
    );
    input.addEventListener("load", () => fitFrameBox(el("ceuMediaEntrada"), input));

    renderFrameNotes();
    renderFrameStatus();
    renderPredictionCard();
  }

  function renderFrameNotes() {
    const frame = state.framePayload;
    if (!frame) return;
    const image = frameSection("image") || {};
    const rawParts = [];
    const captured = parseStationTime(frame.captured_at || "");
    if (Number.isFinite(captured)) rawParts.push(`Capturado em ${formatStamp(captured)}`);
    if (finite(image.width) && finite(image.height)) {
      const original =
        finite(image.original_width) && finite(image.original_height)
          ? `, do original de ${integer(image.original_width)} × ${integer(image.original_height)}`
          : "";
      rawParts.push(`${integer(image.width)} × ${integer(image.height)} px${original}`);
    }
    el("ceuNotaBruto").textContent = rawParts.join(" · ");

    const attribution = frameSection("attribution") || {};
    const sensitivityParts = [];
    if (attribution.summary_pt) sensitivityParts.push(text(attribution.summary_pt).replace(/\.\s*$/, ""));
    if (finite(attribution.window_px) && finite(attribution.stride_px)) {
      sensitivityParts.push(
        `janela de ${integer(attribution.window_px)} px, passo de ${integer(attribution.stride_px)} px, alvo ${kindexSymbol()}`
      );
    }
    el("ceuNotaSensibilidade").textContent = sensitivityParts.join(" · ");

    const input = frameSection("input") || {};
    const inputParts = [];
    if (finite(input.size)) inputParts.push(`${integer(input.size)} × ${integer(input.size)} px`);
    const box = input.content_box;
    const padded =
      box && finite(box.width) && finite(box.height) && (box.width < input.size || box.height < input.size);
    if (padded) {
      inputParts.push(`${integer(box.width)} × ${integer(box.height)} px de câmera, o resto é preenchimento`);
    }
    el("ceuNotaEntrada").textContent = inputParts.join(" — ");
  }

  function renderFrameStatus() {
    const status = el("ceuQuadroStatus");
    if (state.frameStatus === "unreadable") {
      status.textContent = `${unreadableMessage("O metadado do quadro")} As imagens são as últimas enviadas.`;
      return;
    }
    const frame = state.framePayload;
    if (!frame) {
      status.textContent =
        "O metadado do quadro ainda não foi publicado; as imagens acima são as últimas enviadas, sem carimbo de captura.";
      return;
    }
    const info = frame.status || {};
    const parts = [];
    if (info.scored === false) {
      parts.push(text(info.reason_pt, REASON_PT[info.reason] || "nenhum quadro pontuado"));
      const latest = parseStationTime(info.latest_scored_at || "");
      if (Number.isFinite(latest)) {
        parts.push(`último quadro pontuado em ${formatStamp(latest)}${withAge(frame, info.latest_scored_at)}`);
      }
      parts.push("as imagens são as últimas publicadas");
    } else {
      const captured = parseStationTime(frame.captured_at || "");
      if (Number.isFinite(captured)) {
        parts.push(`quadro capturado em ${formatStamp(captured)}${withAge(frame, frame.captured_at)}`);
      }
      if (info.reason && info.reason !== "fresh")
        parts.push(text(info.reason_pt, REASON_PT[info.reason] || info.reason));
    }
    if (finite(info.solar_elevation_deg)) parts.push(`sol a ${decimal(info.solar_elevation_deg, 1)}° de elevação`);
    if (frame.solar && frame.solar.extrapolation === true) {
      parts.push("acima da elevação máxima do treino: previsão em extrapolação");
    }
    if (info.watch_alive === false) parts.push("a vigília da câmera parece parada");
    const clock = clockOffsetText(info.camera_clock_drift_s);
    if (clock) parts.push(clock);
    status.replaceChildren(withReferences(parts.join(" · ")));
  }

  function factRow(list, term, detail) {
    const row = node("div", "clima-fit-row");
    row.appendChild(node("dt", null, term));
    const description = node("dd");
    if (typeof detail === "string") description.textContent = detail;
    else description.appendChild(detail);
    row.appendChild(description);
    list.appendChild(row);
  }

  function conditionText(payload, reference) {
    const condition = resolveCondition(payload, reference);
    return condition ? conditionLabel(condition) : "—";
  }

  function renderProbabilities(frame, sky) {
    const bar = el("ceuProbabilidades");
    const legend = el("ceuProbabilidadesLegenda");
    legend.replaceChildren();
    const drawn = fillConditionBar(bar, frame, sky && sky.probabilities);
    bar.hidden = drawn.length === 0;
    legend.hidden = bar.hidden;
    for (const { condition, fraction } of drawn) {
      legendItem(legend, conditionSwatch(condition), `${conditionShort(condition)} ${percent(fraction, 0)}`);
    }
    bar.setAttribute("aria-label", `Probabilidades por condição de céu: ${shareLabels(drawn).join(", ")}`);
  }

  function counterfactualDetail(frame, entry, base) {
    const delta = (entry && entry.delta) || {};
    const from = base || {};
    const parts = [
      `DHI ${withUnit(transition(from.dhi_w_m2, entry.dhi_w_m2, 1), dhiUnit())} (${signed(delta.dhi_w_m2, 1)})`,
      `${kindexSymbol()} ${transition(from.kindex, entry.kindex, 3)} (${signed(delta.kindex, 3)})`,
    ];
    if (entry.sky) parts.push(`condição ${conditionText(frame, entry.sky)}`);
    const test = entry.test;
    if (test && (finite(test.dhi_rmse) || finite(test.kindex_mae))) {
      parts.push(
        `no teste: RMSE DHI ${withUnit(decimal(test.dhi_rmse, 2), dhiUnit())}, MAE ${kindexSymbol()} ${decimal(test.kindex_mae, 4)}`
      );
    }
    return parts.join(" · ");
  }

  function noImageControls(frame) {
    const block = frame.counterfactuals && frame.counterfactuals.no_image;
    if (!block || typeof block !== "object") return [];
    const labels = {
      sensor_only: "Sem imagem — controle só com escalares",
      climatology: "Sem imagem — média do treino",
    };
    return Object.entries(block)
      .filter(([, entry]) => entry && typeof entry === "object")
      .map(([key, entry]) => ({ label: labels[key] || `Sem imagem — ${key}`, entry }));
  }

  function renderCounterfactuals(frame) {
    const list = el("ceuContrafactuais");
    list.replaceChildren();
    for (const { label, entry } of noImageControls(frame)) {
      const member = entry.member ? ` (${entry.member})` : "";
      factRow(list, `${label}${member}`, counterfactualDetail(frame, entry, null));
    }
    const neutralised = frame.counterfactuals && frame.counterfactuals.overlay_neutralised;
    if (neutralised && typeof neutralised === "object") {
      const member = neutralised.member ? ` (${neutralised.member})` : "";
      factRow(
        list,
        `Faixa de texto da câmera neutralizada${member}`,
        counterfactualDetail(frame, neutralised, neutralised.base || null)
      );
    }
    list.parentElement.hidden = list.children.length === 0;
  }

  function renderAttributionMass(frame) {
    const list = el("ceuMassa");
    const note = el("ceuAtribuicaoNota");
    list.replaceChildren();
    const attribution = frame.attribution && typeof frame.attribution === "object" ? frame.attribution : null;
    const mass = attribution && attribution.mass_by_region;
    if (mass && typeof mass === "object") {
      for (const key of ["disc", "overlay_band", "pad", "other"]) {
        if (finite(mass[key])) factRow(list, REGION_PT[key], percent(mass[key], 1));
      }
      for (const [key, value] of Object.entries(mass)) {
        if (!REGION_PT[key] && finite(value)) factRow(list, key, percent(value, 1));
      }
    }
    const parts = [];
    if (attribution) {
      if (attribution.method === "occlusion_sensitivity") {
        parts.push(
          "Sonda de oclusão: cada janela é substituída pelo nível médio da rede e a célula guarda a variação do alvo"
        );
      }
      const details = [];
      if (finite(attribution.window_px)) details.push(`janela ${integer(attribution.window_px)} px`);
      if (finite(attribution.stride_px)) details.push(`passo ${integer(attribution.stride_px)} px`);
      details.push(
        `alvo ${attribution.target === "kindex" || !attribution.target ? kindexSymbol() : attribution.target}`
      );
      if (finite(attribution.base_value)) details.push(`valor-base ${decimal(attribution.base_value, 3)}`);
      if (attribution.member) details.push(`membro ${attribution.member}`);
      const shape = attribution.grid_shape;
      const peak = attribution.peak;
      if (peak && finite(peak.row) && finite(peak.col)) {
        const grid =
          Array.isArray(shape) && shape.length === 2 ? ` de ${integer(shape[0])} × ${integer(shape[1])}` : "";
        details.push(`pico na linha ${integer(peak.row)}, coluna ${integer(peak.col)}${grid}`);
      }
      parts.push(details.join(", "));
    }
    note.textContent = parts.filter(Boolean).join(". ");
    list.parentElement.hidden = list.children.length === 0 && !note.textContent;
  }

  function renderMembers(frame) {
    const list = el("ceuMembros");
    list.replaceChildren();
    const members = Array.isArray(frame.members) ? frame.members : [];
    for (const member of members) {
      if (!member || typeof member !== "object") continue;
      const details = [];
      if (finite(member.seed)) details.push(`semente ${integer(member.seed)}`);
      if (member.role) details.push(`papel: ${roleLabel(member.role)}`);
      if (Array.isArray(member.heads) && member.heads.length) {
        details.push(`cabeças: ${member.heads.map(headLabel).join(", ")}`);
      }
      details.push(`pesos ${shortHash(member.checkpoint_sha256)}`);
      if (member.code_version) details.push(`código: ${codeVersionText(member.code_version)}`);
      factRow(list, text(member.name, "membro"), details.join(" · "));
    }
    list.parentElement.hidden = list.children.length === 0;
  }

  function renderPredictionCard() {
    const panel = el("ceuPrevisaoPainel");
    const frame = state.framePayload;
    if (!frameScored()) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const prediction = frame.prediction;
    const solar = frame.solar || {};
    const stats = el("ceuPrevisaoStats");
    stats.replaceChildren();
    statTile(stats, withUnit(decimal(prediction.dhi_w_m2, 1), dhiUnit()), `${dhiLabel()} prevista`);
    statTile(
      stats,
      withUnit(decimal(solar.clearsky_dhi_w_m2, 1), dhiUnit()),
      "difusa de céu claro no instante",
      finite(solar.clearsky_ghi_w_m2) ? `global de céu claro ${decimal(solar.clearsky_ghi_w_m2, 1)} ${dhiUnit()}` : ""
    );
    statTile(
      stats,
      decimal(prediction.kindex, 3),
      kindexLabel(),
      text((targetsGlossary().kindex || {}).definition_pt, "")
    );
    const elevationLabel =
      solar.extrapolation === true ? "elevação solar — acima do máximo do treino" : "elevação solar";
    statTile(
      stats,
      finite(solar.elevation_deg) ? `${decimal(solar.elevation_deg, 1)}°` : "—",
      elevationLabel,
      finite(solar.azimuth_deg) ? `azimute ${decimal(solar.azimuth_deg, 1)}°` : ""
    );

    const condition = resolveCondition(frame, prediction.sky);
    el("ceuCondicao").replaceChildren(condition ? conditionCell(condition) : "—");
    renderProbabilities(frame, prediction.sky);
    renderCounterfactuals(frame);
    renderAttributionMass(frame);
    renderMembers(frame);

    const glossary = targetsGlossary().kindex || {};
    el("ceuPrevisaoNota").replaceChildren(
      withReferences(
        `${dhiLabel()} prevista só a partir dos pixels, como razão à difusa de céu claro; ${kindexLabel()}` +
          (glossary.definition_pt ? ` — ${glossary.definition_pt}` : "") +
          "."
      )
    );
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

  let visiblePointsCache = null;

  function invalidateVisiblePoints() {
    visiblePointsCache = null;
  }

  function visiblePoints() {
    if (!visiblePointsCache) {
      visiblePointsCache = state.points.filter((point) => {
        const entry = classOf(point.x);
        return !entry || !state.hidden.has(entry.id);
      });
    }
    return visiblePointsCache;
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
    let kdMax = axes.y && axes.y.range ? declaredY[1] : declaredY[1] + UNDECLARED_KD_HEADROOM;
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
        const stamped = observation.dataIndex;
        index = Number.isInteger(stamped) && dataset.data[stamped] === observation ? stamped : -1;
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
        if (!entry || !grouped.has(entry.id)) continue;
        const bucket = grouped.get(entry.id);
        point.dataIndex = bucket.length;
        bucket.push(point);
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
      if (entry.disabled) button.disabled = true;
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
      LAYERS.filter((layer) => (layer.id === "density" ? state.density : pointsOffered())).map((layer) => ({
        ...layer,
        disabled: layer.id === "points" && pointsFailed(),
      })),
      (layer) => state.layers.has(layer.id),
      (layer) => {
        if (state.layers.has(layer.id)) state.layers.delete(layer.id);
        else state.layers.add(layer.id);
        if (state.layers.has("points")) ensurePoints();
        syncClassToggles();
      },
      (layer) =>
        layer.id === "density"
          ? "Contagem de horas por célula do plano Kt × Kd: quanto mais escura, mais horas caíram ali"
          : "Uma marca por hora medida, colorida pela condição de céu"
    );
  }

  function toggleHiddenClass(id) {
    if (state.hidden.has(id)) state.hidden.delete(id);
    else state.hidden.add(id);
    invalidateVisiblePoints();
  }

  function buildClassToggles() {
    const colors = themeColors().classes;
    buildToggles(
      el("ceuClasses"),
      state.classes.map((entry) => ({ ...entry, swatch: colors[entry.id] })),
      (entry) => !state.hidden.has(entry.id),
      (entry) => toggleHiddenClass(entry.id),
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

  function loadedPayloads() {
    return [
      state.framePayload,
      state.timelinePayload,
      state.modelPayload,
      state.chartPayload,
      state.cumulativePayload,
    ].filter((payload) => payload && typeof payload === "object");
  }

  function registerPayloadReferences() {
    for (const payload of loadedPayloads()) {
      if (payload.references) refs().register(payload.references);
    }
  }

  function caveatTexts() {
    return loadedPayloads().flatMap((payload) =>
      Array.isArray(payload.caveats) ? payload.caveats.filter((caveat) => typeof caveat === "string") : []
    );
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
    const parts = [];
    if (payload.timescale && payload.timescale.label) parts.push(payload.timescale.label);
    const start = parseStationTime(period.start || "");
    const end = parseStationTime(period.end || "");
    if (Number.isFinite(start) && Number.isFinite(end)) {
      parts.push(`${formatDay(start)} a ${formatDay(end)}`);
    }
    if (Number.isFinite(period.hours)) parts.push(`${decimal(period.hours, 0)} horas`);
    el("ceuGraficoNota").textContent = parts.join(" · ");

    const filtersWrittenForReaders = Boolean(payload.points_file) && Array.isArray(payload.filters);
    const filters = filtersWrittenForReaders
      ? payload.filters.filter((filter) => typeof filter === "string" && filter.trim())
      : [];
    if (filters.length) {
      el("ceuFiltros").textContent =
        `Seleção e cálculo das horas, como o exportador os descreve: ${filters.join("; ")}.`;
    }

    const coverage = hoursOutsideDensityGrid();
    if (coverage) el("ceuAmostra").textContent = "das horas selecionadas";
    el("ceuForaDaGrade").textContent = coverage
      ? densityCoverageSentence(coverage, pointsOffered() && !pointsFailed())
      : "";

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
    el("ceuExport").disabled = !pointsOffered() || pointsFailed();
    el("ceuAmpliar").disabled = !hasDrawing() || (state.layers.has("points") && state.pointsStatus === "loading");
    el("ceuGuia").disabled = state.chartStatus === "loading";
  }

  function nothingToDrawMessage() {
    if (state.chartStatus === "loading") return "Carregando o documento de Kt × Kd…";
    if (state.chartStatus === "unreadable") return unreadableMessage("O documento de Kt × Kd");
    if (state.chartStatus === "absent") {
      return "O documento de Kt × Kd ainda não foi publicado — os quadros acima continuam válidos.";
    }
    if (!state.density && !pointsOffered()) return "O documento publicado não traz nem densidade nem pontos.";
    if (state.pointsStatus === "loading") return POINTS_LOADING_MESSAGE;
    if (pointsFailed() && !state.density) return pointsStatusMessage();
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
      pointsStatusMessage() ||
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
    if (pointsOffered() && !pointsFailed()) {
      const coverage = hoursOutsideDensityGrid();
      guideDefinition(
        list,
        "Camada Pontos",
        `Uma marca por hora medida, colorida pela condição de céu daquele Kt. ${
          coverage
            ? densityCoverageSentence(coverage, true)
            : "É a mesma amostra da densidade, hora a hora em vez de contada."
        }`
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

  async function exportCsv() {
    const request = ensurePoints();
    if (state.pointsStatus === "loading") drawChart();
    await request;
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
    const source = state.framePayload || state.timelinePayload || state.modelPayload || state.chartPayload;
    const generated = parseStationTime((source && source.generated_utc) || "");
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
      statTile(container, percent(condition.fraction, 1), cumulativeConditionLabel(condition));
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

  const SOURCE_PT = { frame_aggregate: "agregado dos quadros do bloco", block_model: "modelo de bloco" };
  const MEASURED_REASON_PT = {
    ok: "exportação da estação recebida",
    no_export: "sem exportação da estação",
    export_stale: "exportação da estação desatualizada",
    no_valid_rows: "exportação da estação sem leitura que passe pela triagem",
    interval_mismatch: "exportação da estação fora da grade dos blocos",
  };
  const SCREENING_PT = { "sentinels + sensor_limits": "passados pelas sentinelas e pelos limites do sensor do acervo" };
  const CORRECTED_LABEL_SCALE = "corrected";
  const RAW_LABEL_SCALE = "raw";
  const DECLARED_LABEL_SCALES = new Set([RAW_LABEL_SCALE, CORRECTED_LABEL_SCALE]);
  const RAW_SCALE_LIVE_NOTE =
    "a difusa prevista está na escala crua do rótulo de treino e a medida, na escala corrigida: RMSE, MAE e MBE incluem essa diferença de escala, não só o erro do modelo";
  const BLOCK_STATUS_PT = { scored: "pontuado", skipped: "pulado", pending: "pendente", failed: "falhou" };
  const ARM_KIND_PT = { served: "servido", ensemble: "conjunto servido", member: "membro", control: "controle" };
  const SERVED_ARM_KINDS = ["served", "ensemble"];
  const METRIC_PT = {
    dhi_rmse: "RMSE DHI",
    dhi_mae: "MAE DHI",
    dhi_mbe: "MBE DHI",
    kindex_mae: "MAE k*",
    kindex_rmse: "RMSE k*",
    sky_balanced_accuracy: "acurácia balanceada",
    sky_accuracy: "acurácia",
    sky_macro_f1: "F1 macro",
    sky_kappa_quadratic: "κ quadrático",
    persistence_skill_dhi: "habilidade contra a persistência (DHI)",
  };
  const TRAINING_KEY_PT = {
    epochs: "épocas",
    epochs_budget: "orçamento de épocas",
    batch_size: "lote",
    learning_rate: "taxa de aprendizado",
    lr: "taxa de aprendizado",
    backbone_lr: "taxa de aprendizado do tronco",
    layer_decay: "decaimento por camada",
    scheduler: "agendador",
    patience: "paciência",
    min_delta: "delta mínimo",
    monitor: "monitor",
    early_stopping: "parada antecipada",
    loss: "função de perda",
    optimizer: "otimizador",
    weight_decay: "decaimento de pesos",
    seed: "semente",
  };
  const ROLE_KEY_PT = {
    frame_sky_role: "condição de céu do quadro",
    frame_dhi_role: "difusa do quadro",
    sky: "condição de céu",
    dhi: "difusa",
  };
  const ARCHITECTURE_NAME_PT = { image_only: "só imagem" };
  const TARGET_SOURCE_PT = { measured: "medido na estação" };
  const SPLIT_STRATEGY_PT = { chronological: "cronológica por dia" };

  function keyLabel(dictionary, key) {
    return dictionary[key] || String(key).replace(/_/g, " ");
  }

  function metricValue(key, value) {
    if (!finite(value)) return "—";
    if (key.includes("accuracy")) return percent(value, 1);
    if (/f1|kappa|skill/.test(key)) return trueMinus(value, 3);
    if (key.startsWith("dhi")) return trueMinus(value, 2);
    return decimal(value, 4);
  }
  const SPLIT_PT = { train: "treino", val: "validação", test: "teste" };
  const CONTROL_IDS = ["sensor_only", "climatology"];
  const TIMELINE_AXIS_WIDTH = 56;

  function timelineAxis() {
    const axis = state.timelinePayload && state.timelinePayload.axis;
    const start = parseStationTime((axis && axis.start) || "");
    const step = axis && finite(axis.step_minutes) ? axis.step_minutes * MINUTE_MS : NaN;
    if (!Number.isFinite(start) || !(step > 0)) return null;
    return { start, step };
  }

  function timelineSeries(id) {
    const series = state.timelinePayload && state.timelinePayload.series;
    const values = series && series[id];
    return Array.isArray(values) ? values : null;
  }

  function timelineLength() {
    const series = state.timelinePayload && state.timelinePayload.series;
    if (!series || typeof series !== "object") return 0;
    return Object.values(series).reduce(
      (longest, values) => (Array.isArray(values) ? Math.max(longest, values.length) : longest),
      0
    );
  }

  function timelinePoints(id) {
    const axis = timelineAxis();
    const values = timelineSeries(id);
    if (!axis || !values) return null;
    let finiteCount = 0;
    const points = values.map((value, index) => {
      const y = finite(value) ? value : null;
      if (y !== null) finiteCount += 1;
      return { x: axis.start + index * axis.step, y };
    });
    return finiteCount ? points : null;
  }

  function timelineBounds() {
    const axis = timelineAxis();
    const length = timelineLength();
    if (!axis || !length) return null;
    return { min: axis.start - axis.step / 2, max: axis.start + (length - 1) * axis.step + axis.step / 2 };
  }

  function blockIndexAt(x) {
    const axis = timelineAxis();
    if (!axis) return -1;
    const index = Math.round((x - axis.start) / axis.step);
    return index >= 0 && index < timelineLength() ? index : -1;
  }

  function extrapolationRuns() {
    const axis = timelineAxis();
    const flags = timelineSeries("extrapolation");
    if (!axis || !flags) return [];
    const runs = [];
    let open = null;
    flags.forEach((flag, index) => {
      const x = axis.start + index * axis.step;
      if (flag === true) {
        if (open) open.to = x + axis.step / 2;
        else open = { from: x - axis.step / 2, to: x + axis.step / 2 };
      } else if (open) {
        runs.push(open);
        open = null;
      }
    });
    if (open) runs.push(open);
    return runs;
  }

  const extrapolationBands = {
    id: "labmimSkyExtrapolation",
    beforeDatasetsDraw(chart, _args, options) {
      const runs = options.runs || [];
      if (!runs.length) return;
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      ctx.fillStyle = options.color;
      for (const run of runs) {
        const left = Math.max(chartArea.left, scales.x.getPixelForValue(run.from));
        const right = Math.min(chartArea.right, scales.x.getPixelForValue(run.to));
        if (right > left) ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      }
      ctx.restore();
    },
  };

  function tickStepMs(spanMs) {
    if (spanMs <= 1.5 * DAY_MS) return 3 * HOUR_MS;
    if (spanMs <= 4 * DAY_MS) return 12 * HOUR_MS;
    if (spanMs <= 10 * DAY_MS) return DAY_MS;
    return 2 * DAY_MS;
  }

  function alignedTimeTicks(min, max) {
    const step = tickStepMs(max - min);
    const ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push({ value });
    return ticks;
  }

  function timeTickLabel(value) {
    const date = new Date(value);
    return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 ? formatShortDay(value) : formatHour(value);
  }

  function timeScale(theme, bounds) {
    return {
      type: "linear",
      min: bounds.min,
      max: bounds.max,
      afterBuildTicks: (axis) => {
        axis.ticks = alignedTimeTicks(axis.min, axis.max);
      },
      ticks: { color: theme.textSecondary, autoSkip: false, maxRotation: 0, callback: timeTickLabel },
      grid: { color: theme.grid },
    };
  }

  function fixedWidthAxis(scale) {
    return { ...scale, afterFit: (axis) => (axis.width = TIMELINE_AXIS_WIDTH) };
  }

  function sourceLabel(value) {
    const published = state.timelinePayload && state.timelinePayload.source_labels_pt;
    if (published && typeof published === "object" && typeof published[value] === "string") return published[value];
    return SOURCE_PT[value] || (typeof value === "string" ? value : "");
  }

  function timelineBlockLines(index) {
    if (index < 0) return [];
    const at = (id) => {
      const values = timelineSeries(id);
      return values ? values[index] : null;
    };
    const lines = [];
    const kindex = at("kindex");
    if (finite(kindex)) lines.push(`${kindexLabel()}: ${decimal(kindex, 3)}`);
    const condition = resolveCondition(state.timelinePayload, at("condition"));
    if (condition) {
      const probability = at(`p_${condition.id}`);
      const suffix = finite(probability) ? ` (${percent(probability, 0)})` : "";
      lines.push(`condição prevista: ${conditionLabel(condition)}${suffix}`);
    }
    const frames = at("n_frames");
    if (finite(frames)) lines.push(`${integer(frames)} ${frames === 1 ? "quadro" : "quadros"} no bloco`);
    const source = state.timelinePayload.source;
    const origin = Array.isArray(source) ? sourceLabel(source[index]) : "";
    if (origin) lines.push(`fonte: ${origin}`);
    const elevation = at("solar_elevation_deg");
    if (finite(elevation)) lines.push(`sol a ${decimal(elevation, 1)}°`);
    if (at("extrapolation") === true) lines.push("acima da elevação máxima do treino (extrapolação)");
    return lines;
  }

  function declaredLabelScale(value) {
    return DECLARED_LABEL_SCALES.has(value) ? value : null;
  }

  function predictionLabelScale() {
    return (
      declaredLabelScale(state.timelinePayload?.label_scale) ??
      declaredLabelScale(state.modelPayload?.dataset?.label_scale)
    );
  }

  function predictionOnRawScale() {
    return predictionLabelScale() !== CORRECTED_LABEL_SCALE;
  }

  function comparedWithStation(series) {
    const live = state.timelinePayload && state.timelinePayload.live;
    return (
      Boolean(series.measured) ||
      Boolean(live && typeof live === "object" && finite(live.n_blocks) && live.n_blocks > 0)
    );
  }

  function predictedDhiLabel(series) {
    const label = `${dhiLabel()} prevista`;
    return comparedWithStation(series) && predictionOnRawScale() ? `${label} (escala crua)` : label;
  }

  function timelineDatasets(theme, series) {
    const datasets = [];
    const predicted = series.dhi;
    if (predicted) {
      datasets.push({
        label: predictedDhiLabel(series),
        data: predicted,
        borderColor: `rgb(${theme.ink})`,
        backgroundColor: `rgb(${theme.ink})`,
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 3,
        spanGaps: false,
        tension: 0,
        order: 1,
      });
    }
    const clearsky = series.clearsky;
    if (clearsky) {
      datasets.push({
        label: "difusa de céu claro",
        data: clearsky,
        borderColor: theme.textSecondary,
        backgroundColor: theme.textSecondary,
        borderWidth: 1.2,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        spanGaps: false,
        tension: 0,
        order: 3,
      });
    }
    const measured = series.measured;
    if (measured) {
      datasets.push({
        label: "difusa medida (PSP)",
        data: measured,
        borderColor: theme.measured,
        backgroundColor: theme.measured,
        borderWidth: 1.4,
        pointRadius: 0,
        pointHoverRadius: 3,
        spanGaps: false,
        tension: 0,
        order: 2,
      });
    }
    return datasets;
  }

  function lineChartBase() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
    };
  }

  function chartTooltip(theme, callbacks) {
    return {
      backgroundColor: theme.tooltipBg,
      titleColor: theme.tooltipText,
      bodyColor: theme.tooltipText,
      borderColor: theme.textSecondary,
      borderWidth: 1,
      callbacks,
    };
  }

  function timelineChartConfig(theme, bounds, runs, { datasets, yScale, label }) {
    return {
      type: "line",
      data: { datasets },
      options: {
        ...lineChartBase(),
        plugins: {
          labmimSkyExtrapolation: { runs, color: theme.band },
          legend: { display: false },
          tooltip: chartTooltip(theme, {
            title: (items) => `Bloco até ${formatStamp(items[0].parsed.x)}`,
            label,
            afterBody: (items) => timelineBlockLines(blockIndexAt(items[0].parsed.x)),
          }),
        },
        scales: {
          x: timeScale(theme, bounds),
          y: fixedWidthAxis({ type: "linear", min: 0, ...yScale, grid: { color: theme.grid } }),
        },
      },
      plugins: [extrapolationBands],
    };
  }

  function drawTimelineChart(theme, bounds, runs, series) {
    const datasets = timelineDatasets(theme, series);
    const wrap = el("ceuLinhaChartWrap");
    wrap.hidden = datasets.length === 0;
    if (!datasets.length) return;
    state.timelineChart = new Chart(
      el("ceuLinhaCanvas").getContext("2d"),
      timelineChartConfig(theme, bounds, runs, {
        datasets,
        label: (item) => `${item.dataset.label}: ${withUnit(decimal(item.parsed.y, 1), dhiUnit())}`,
        yScale: {
          title: { display: true, text: `${dhiLabel()} (${dhiUnit()})`, color: theme.textSecondary },
          ticks: { color: theme.textSecondary, maxTicksLimit: 6 },
        },
      })
    );
  }

  function drawConditionStrip(theme, bounds, runs, points) {
    const wrap = el("ceuFaixaChartWrap");
    wrap.hidden = !points;
    if (!points) return;
    const payload = state.timelinePayload;
    const references = timelineSeries("condition") || [];
    const colorByReference = new Map();
    const colors = points.map((_point, index) => {
      const reference = references[index];
      if (!colorByReference.has(reference)) {
        const condition = resolveCondition(payload, reference);
        colorByReference.set(reference, condition ? theme.classes[condition.id] : "transparent");
      }
      return colorByReference.get(reference);
    });
    const top = Math.max(1, ...points.map((point) => (point.y === null ? 0 : point.y)));
    state.stripChart = new Chart(
      el("ceuFaixaCanvas").getContext("2d"),
      timelineChartConfig(theme, bounds, runs, {
        datasets: [
          {
            label: kindexLabel(),
            data: points,
            borderColor: fade(theme.surface === "#fff" ? "#000000" : "#ffffff", 0.28),
            backgroundColor: colors,
            borderWidth: 1,
            pointRadius: 2.4,
            pointHoverRadius: 4,
            pointBackgroundColor: colors,
            pointBorderColor: colors,
            pointBorderWidth: 0,
            spanGaps: false,
            tension: 0,
          },
        ],
        label: () => "",
        yScale: {
          max: Math.ceil(top * 10) / 10,
          title: { display: true, text: kindexSymbol(), color: theme.textSecondary },
          ticks: { color: theme.textSecondary, maxTicksLimit: 4 },
        },
      })
    );
  }

  function renderTimelineLegend(theme, runs, series) {
    const list = el("ceuLinhaLegenda");
    list.replaceChildren();
    const hasData = Boolean(series.dhi || series.kindex);
    list.hidden = !hasData;
    if (!hasData) return;
    legendItem(list, { background: `rgb(${theme.ink})`, height: "0.25rem" }, predictedDhiLabel(series));
    legendItem(
      list,
      { background: "transparent", height: "0", borderTop: `2px dashed ${theme.textSecondary}` },
      "difusa de céu claro"
    );
    if (series.measured) {
      legendItem(list, { background: theme.measured, height: "0.25rem" }, "difusa medida (PSP)");
    }
    if (runs.length) {
      legendItem(
        list,
        { background: theme.band, outline: `1px solid ${theme.textSecondary}` },
        "sol acima do máximo do treino"
      );
    }
    for (const condition of conditionsOf(state.timelinePayload)) {
      legendItem(list, conditionSwatch(condition), conditionShort(condition));
    }
  }

  function shareBar(payload, share) {
    const wrap = node("span", "sky-share");
    const bar = node("span", "sky-bar sky-bar-compact");
    const labels = shareLabels(fillConditionBar(bar, payload, share));
    wrap.append(bar, node("span", "sky-share-text", labels.join(" · ") || "—"));
    wrap.title = labels.join(", ");
    return wrap;
  }

  function cell(row, value, className) {
    const element = node("td", className || null);
    if (value instanceof Node) element.appendChild(value);
    else element.textContent = value;
    row.appendChild(element);
    return element;
  }

  function renderTimelineDays() {
    const wrap = el("ceuDiasWrap");
    const body = el("ceuDiasCorpo");
    body.replaceChildren();
    const payload = state.timelinePayload;
    const days = payload && Array.isArray(payload.days) ? payload.days : [];
    wrap.hidden = days.length === 0;
    for (const day of days) {
      if (!day || typeof day !== "object") continue;
      const row = node("tr");
      const date = parseStationTime(day.date || "");
      cell(row, Number.isFinite(date) ? formatDay(date) : text(day.date));
      cell(row, integer(day.blocks_scored));
      cell(row, integer(day.blocks_skipped));
      cell(row, integer(day.frames));
      cell(row, shareBar(payload, day.condition_share));
      body.appendChild(row);
    }
  }

  function skippedSummary(payload) {
    const raw = payload.skipped;
    const entries = Array.isArray(raw) ? raw : raw && Array.isArray(raw.blocks) ? raw.blocks : [];
    const labels = payload.reason_labels_pt || (raw && raw.reason_labels_pt) || {};
    if (!entries.length) return "";
    const counts = new Map();
    for (const entry of entries) {
      const reason = entry && typeof entry.reason === "string" ? entry.reason : "outro";
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    const parts = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => `${integer(count)} — ${text(labels[reason], reason)}`);
    return `Blocos pulados na janela: ${integer(entries.length)} (${parts.join("; ")}).`;
  }

  function latestSentence(payload) {
    const latest = payload.latest;
    if (!latest || typeof latest !== "object") return "";
    const parts = [];
    const stamp = parseStationTime(latest.last_scored_block || "");
    if (Number.isFinite(stamp))
      parts.push(`Último bloco pontuado: ${formatStamp(stamp)}${withAge(payload, latest.last_scored_block)}`);
    if (latest.last_block_status && latest.last_block_status !== "scored")
      parts.push(`estado do último bloco: ${BLOCK_STATUS_PT[latest.last_block_status] || latest.last_block_status}`);
    const labels = payload.reason_labels_pt || (payload.skipped && payload.skipped.reason_labels_pt) || {};
    if (latest.reason && latest.reason !== "fresh")
      parts.push(text(labels[latest.reason], REASON_PT[latest.reason] || latest.reason));
    return parts.length ? `${parts.join(" · ")}.` : "";
  }

  function measuredSentence(payload) {
    const measured = payload.measured;
    const status = payload.measured_status || {};
    if (status.reason === "ok" && measured && typeof measured === "object") {
      const source = text(status.source_label, text(measured.source_column, "piranômetro"));
      const screening = measured.screening ? `, ${SCREENING_PT[measured.screening] || measured.screening}` : "";
      return `Difusa medida: ${integer(measured.n)} blocos pareados com ${source}${screening}.`;
    }
    const reason = MEASURED_REASON_PT[status.reason] || text(status.reason, "motivo não informado");
    if (status.reason === "export_stale") {
      const lastRow = parseStationTime(status.last_row_at || "");
      const lastReading = Number.isFinite(lastRow) ? `, com última leitura em ${formatStamp(lastRow)}` : "";
      return `Sem difusa medida nesta janela: ${reason}${lastReading}; a comparação ao vivo cobre só os blocos que ela alcança.`;
    }
    if (status.reason === "no_valid_rows" || status.reason === "interval_mismatch") {
      return `A difusa medida não está publicada: ${reason}.`;
    }
    const source = status.source_label ? ` (${status.source_label})` : "";
    return `A comparação ao vivo com o piranômetro${source} está pendente: ${reason}; os números do teste não a substituem.`;
  }

  function renderLiveStats() {
    const container = el("ceuAoVivo");
    container.replaceChildren();
    const live = state.timelinePayload && state.timelinePayload.live;
    container.hidden = !live || typeof live !== "object" || !finite(live.n_blocks) || live.n_blocks === 0;
    if (container.hidden) return;
    const since = parseStationDate(live.since);
    const window = [];
    if (finite(live.n_days)) window.push(`${integer(live.n_days)} ${live.n_days === 1 ? "dia" : "dias"}`);
    if (finite(live.n_blocks)) window.push(`${integer(live.n_blocks)} blocos`);
    const rawScale = predictionOnRawScale();
    statTile(
      container,
      Number.isFinite(since) ? `desde ${formatDay(since)}` : "ao vivo",
      `contra o piranômetro${window.length ? ` — ${window.join(", ")}` : ""}`,
      rawScale
        ? RAW_SCALE_LIVE_NOTE
        : "o único holdout limpo: dias posteriores à decisão do pino, nunca usados em decisão"
    );
    const dhi = live.dhi || {};
    const scaleNote = rawScale ? " (inclui a diferença de escala)" : "";
    statTile(container, withUnit(decimal(dhi.rmse, 1), dhiUnit()), `RMSE da difusa ao vivo${scaleNote}`);
    statTile(container, withUnit(decimal(dhi.mae, 1), dhiUnit()), `MAE da difusa ao vivo${scaleNote}`);
    statTile(container, withUnit(signed(dhi.mbe, 1), dhiUnit()), `MBE da difusa ao vivo${scaleNote}`);
    if (live.kindex && finite(live.kindex.mae))
      statTile(container, decimal(live.kindex.mae, 3), `MAE de ${kindexSymbol()} ao vivo`);
    if (live.sky && finite(live.sky.balanced_accuracy)) {
      statTile(container, percent(live.sky.balanced_accuracy, 1), "acurácia balanceada ao vivo");
    }
  }

  function destroyTimelineCharts() {
    for (const key of ["timelineChart", "stripChart"]) {
      if (state[key]) {
        state[key].destroy();
        state[key] = null;
      }
    }
  }

  function timelineUnavailableMessage() {
    if (state.timelineStatus === "unreadable") return unreadableMessage("O documento da linha do tempo");
    if (state.timelineStatus === "absent") return "A linha do tempo dos últimos dias ainda não foi publicada.";
    return "O documento da linha do tempo não traz blocos pontuados.";
  }

  function drawTimeline() {
    destroyTimelineCharts();
    const payload = state.timelinePayload;
    const bounds = payload ? timelineBounds() : null;
    const theme = themeColors();
    const body = el("ceuLinhaCorpo");
    if (!payload || !bounds) {
      body.hidden = true;
      el("ceuLinhaNota").textContent = "";
      el("ceuLinhaStatus").textContent = timelineUnavailableMessage();
      return;
    }
    body.hidden = false;
    const axis = timelineAxis();
    const length = timelineLength();
    const noteParts = [`blocos de ${integer(axis.step / MINUTE_MS)} min`];
    noteParts.push(`${formatStamp(axis.start)} a ${formatStamp(axis.start + (length - 1) * axis.step)}`);
    noteParts.push(`${integer(length)} blocos`);
    el("ceuLinhaNota").textContent = noteParts.join(" · ");

    const runs = extrapolationRuns();
    const series = {
      dhi: timelinePoints("dhi_w_m2"),
      clearsky: timelinePoints("clearsky_dhi_w_m2"),
      measured: timelinePoints("measured_dhi_w_m2"),
      kindex: timelinePoints("kindex"),
    };
    drawTimelineChart(theme, bounds, runs, series);
    drawConditionStrip(theme, bounds, runs, series.kindex);
    renderTimelineLegend(theme, runs, series);
    renderLiveStats();
    renderTimelineDays();
    el("ceuLinhaStatus").replaceChildren(
      withReferences(
        [latestSentence(payload), skippedSummary(payload), measuredSentence(payload)].filter(Boolean).join(" ")
      )
    );
  }

  function evaluation() {
    const block = state.modelPayload && state.modelPayload.evaluation;
    return block && typeof block === "object" ? block : {};
  }

  function rowsOf(source, keyField) {
    if (Array.isArray(source)) return source.filter((row) => row && typeof row === "object");
    if (source && typeof source === "object") {
      return Object.entries(source)
        .filter(([, row]) => row && typeof row === "object")
        .map(([key, row]) => ({ [keyField]: key, ...row }));
    }
    return [];
  }

  function modelArms() {
    return rowsOf(evaluation().arms, "id").map((arm) => ({ ...arm, id: String(arm.id || arm.name || "") }));
  }

  function servedBlock() {
    const served = state.modelPayload && state.modelPayload.served;
    return served && typeof served === "object" ? served : {};
  }

  function armKind(arm) {
    if (typeof arm.kind === "string") return arm.kind;
    const served = servedBlock();
    if ((served.id && arm.id === served.id) || arm.id === "served") return "served";
    if (CONTROL_IDS.includes(arm.id)) return "control";
    if (Array.isArray(served.members) && served.members.some((member) => member && member.name === arm.id))
      return "member";
    return "";
  }

  function servedArm() {
    const arms = modelArms();
    const served = servedBlock();
    return (
      arms.find((arm) => served.id && arm.id === served.id) ||
      arms.find((arm) => arm.id === "served") ||
      arms.find((arm) => SERVED_ARM_KINDS.includes(armKind(arm))) ||
      null
    );
  }

  function armById(id) {
    return modelArms().find((arm) => arm.id === id) || null;
  }

  function skillEntry(name) {
    const block = evaluation();
    const fromSkill = block.skill && (block.skill[name] || block.skill[`vs_${name}`]);
    const fromReference = block.references && block.references[name];
    const merged = { ...(fromReference || {}), ...(fromSkill || {}) };
    return finite(merged.skill) ? merged : null;
  }

  function renderModelHeadline() {
    const model = state.modelPayload;
    const served = servedBlock();
    const arm = servedArm();
    const stats = el("ceuModeloStats");
    const skills = el("ceuModeloSkill");
    stats.replaceChildren();
    skills.replaceChildren();
    const block = evaluation();
    const dataset = model.dataset || {};
    const split = (dataset.split && dataset.split[block.split || "test"]) || {};
    const noteParts = [];
    if (served.label) noteParts.push(served.label);
    const splitParts = [];
    if (finite(split.days)) splitParts.push(`${integer(split.days)} dias`);
    const start = parseStationDate(split.start);
    const end = parseStationDate(split.end);
    if (Number.isFinite(start) && Number.isFinite(end)) splitParts.push(`${formatDay(start)} a ${formatDay(end)}`);
    if (finite(block.n)) splitParts.push(`${integer(block.n)} linhas`);
    if (splitParts.length)
      noteParts.push(`${SPLIT_PT[block.split] || block.split || "teste"} cronológico: ${splitParts.join(", ")}`);
    const selection = served.selection || {};
    const decided = parseStationDate(selection.decided_on);
    if (Number.isFinite(decided)) {
      noteParts.push(
        `pino decidido em ${formatDay(decided)} na ${SPLIT_PT[selection.selection_split] || selection.selection_split || "validação"}`
      );
    }
    el("ceuModeloNota").replaceChildren(withReferences(noteParts.join(" · ")));

    if (arm) {
      const dhi = arm.dhi || {};
      const kindex = arm.kindex || {};
      const unit = dhiUnit();
      statTile(
        stats,
        withUnit(decimal(dhi.rmse, 2), unit),
        "RMSE da difusa no teste",
        finite(dhi.r2) ? `r² ${decimal(dhi.r2, 3)}` : ""
      );
      statTile(stats, withUnit(decimal(dhi.mae, 2), unit), "MAE da difusa no teste");
      statTile(stats, withUnit(signed(dhi.mbe, 2), unit), "MBE da difusa no teste");
      const sensor = armById("sensor_only");
      const climatology = armById("climatology");
      const controls = [];
      if (sensor) controls.push(`só escalares ${decimal((sensor.kindex || {}).mae, 4)}`);
      if (climatology) controls.push(`média do treino ${decimal((climatology.kindex || {}).mae, 4)}`);
      statTile(
        stats,
        decimal(kindex.mae, 4),
        `MAE de ${kindexSymbol()} no teste${controls.length ? ` — controles: ${controls.join(", ")}` : ""}`
      );
      const sky = arm.sky || {};
      const skyDetails = [];
      if (finite(sky.accuracy)) skyDetails.push(`acurácia ${percent(sky.accuracy, 1)}`);
      if (finite(sky.macro_f1)) skyDetails.push(`F1 macro ${decimal(sky.macro_f1, 3)}`);
      if (finite(sky.kappa_quadratic)) skyDetails.push(`κ quadrático ${decimal(sky.kappa_quadratic, 3)}`);
      statTile(
        stats,
        percent(sky.balanced_accuracy, 1),
        "acurácia balanceada das condições de céu",
        skyDetails.join(" · ")
      );
    }

    const skillLabels = {
      clearsky: "habilidade contra o céu claro",
      persistence: "habilidade contra a persistência",
      climatology: "habilidade contra a média do treino",
      sensor_only: "habilidade contra só escalares",
    };
    for (const name of ["clearsky", "persistence", "climatology", "sensor_only"]) {
      const entry = skillEntry(name);
      if (!entry) continue;
      const details = [];
      if (finite(entry.horizon_minutes)) details.push(`de ${integer(entry.horizon_minutes)} min`);
      if (finite(entry.n)) details.push(`n ${integer(entry.n)}`);
      if (finite(entry.n_rows)) details.push(`${integer(entry.n_rows)} linhas distintas`);
      const label = `${skillLabels[name]}${finite(entry.horizon_minutes) ? ` ${details.shift()}` : ""}${details.length ? ` (${details.join(", ")})` : ""}`;
      statTile(skills, trueMinus(entry.skill, 3), label, text(entry.label, ""));
    }
  }

  function persistenceCaveat() {
    const caveats = Array.isArray(state.modelPayload.caveats) ? state.modelPayload.caveats : [];
    return caveats.find((caveat) => typeof caveat === "string" && /persist/i.test(caveat)) || "";
  }

  function armRowLabel(arm) {
    return text(arm.label, arm.id);
  }

  function renderArmsTable() {
    const body = el("ceuBracosCorpo");
    body.replaceChildren();
    el("ceuBracosCabecalhoKindex").textContent = `MAE ${kindexSymbol()}`;
    const block = evaluation();
    el("ceuBracosLegenda").textContent = finite(block.n)
      ? `${integer(block.n)} linhas do ${SPLIT_PT[block.split] || block.split || "teste"}; difusa em ${dhiUnit()}`
      : "";
    const order = { served: 0, ensemble: 0, member: 1, control: 2 };
    const arms = modelArms().sort((left, right) => (order[armKind(left)] ?? 3) - (order[armKind(right)] ?? 3));
    for (const arm of arms) {
      const row = node("tr");
      const dhi = arm.dhi || {};
      const sky = arm.sky || {};
      const kindex = arm.kindex || {};
      cell(row, armRowLabel(arm));
      cell(row, ARM_KIND_PT[armKind(arm)] || armKind(arm) || "—");
      cell(row, decimal(dhi.rmse, 2));
      cell(row, decimal(dhi.mae, 2));
      cell(row, signed(dhi.mbe, 2));
      cell(row, trueMinus(dhi.r2, 3));
      cell(row, decimal(kindex.mae, 4));
      cell(row, percent(sky.accuracy, 1));
      cell(row, percent(sky.balanced_accuracy, 1));
      cell(row, decimal(sky.macro_f1, 3));
      cell(row, decimal(sky.kappa_quadratic, 3));
      cell(row, integer(dhi.n));
      body.appendChild(row);
    }
  }

  function renderReferencesTable() {
    const body = el("ceuReferenciasCorpo");
    body.replaceChildren();
    const references = evaluation().references || {};
    const names = { clearsky: "difusa de céu claro", persistence: "persistência" };
    for (const [key, reference] of Object.entries(references)) {
      if (!reference || typeof reference !== "object") continue;
      const row = node("tr");
      const horizon = finite(reference.horizon_minutes) ? ` de ${integer(reference.horizon_minutes)} min` : "";
      const label = text(reference.label, `${names[key] || key}${horizon}`);
      cell(row, label);
      cell(row, decimal(reference.dhi_rmse, 2));
      cell(row, decimal(reference.model_rmse_on_paired, 2));
      cell(row, trueMinus(reference.skill, 3));
      cell(row, integer(reference.n));
      const details = [];
      if (finite(reference.horizon_minutes)) details.push(`horizonte de ${integer(reference.horizon_minutes)} min`);
      if (finite(reference.n_rows)) details.push(`${integer(reference.n_rows)} linhas distintas do datalogger`);
      const kindexReference = reference.kindex;
      if (kindexReference && finite(kindexReference.skill)) {
        details.push(
          `${kindexSymbol()}: habilidade ${trueMinus(kindexReference.skill, 3)} (n ${integer(kindexReference.n)})`
        );
      }
      const clear = reference.on_clear_rows;
      if (clear && typeof clear === "object") {
        details.push(
          `nas linhas de céu claro: RMSE ${decimal(clear.rmse, 2)}, MBE ${signed(clear.mbe, 2)}, n ${integer(clear.n)}`
        );
      }
      cell(row, details.join(" · ") || "—");
      body.appendChild(row);
    }
  }

  function renderPerClass() {
    const body = el("ceuClassesCorpo");
    body.replaceChildren();
    const arm = servedArm();
    const source = evaluation().per_class || (arm && arm.sky && arm.sky.per_class);
    const rows = rowsOf(source, "id");
    const model = state.modelPayload;
    for (const condition of conditionsOf(model)) {
      const found = rows.find((row) => (resolveCondition(model, row) || {}).id === condition.id);
      if (!found) continue;
      const row = node("tr");
      cell(row, conditionCell(condition));
      cell(row, percent(found.recall, 1));
      cell(row, percent(found.precision, 1));
      cell(row, decimal(found.f1, 3));
      cell(row, integer(found.n ?? found.support));
      body.appendChild(row);
    }
  }

  function confusionMatrix(arm) {
    const confusion = arm && arm.sky && arm.sky.confusion;
    return Array.isArray(confusion) ? confusion : null;
  }

  function conditionHeader(condition, scope) {
    const header = node("th", null, condition ? conditionShort(condition) : "—");
    header.scope = scope;
    return header;
  }

  function renderConfusion() {
    const head = el("ceuConfusaoCabecalho");
    const body = el("ceuConfusaoCorpo");
    body.replaceChildren();
    const model = state.modelPayload;
    const matrix = confusionMatrix(servedArm());
    head.closest(".clima-table-scroll").hidden = !matrix;
    if (!matrix) return;
    const ordered = conditionsOf(model).slice(0, matrix.length);
    head.replaceChildren(head.firstElementChild, ...ordered.map((condition) => conditionHeader(condition, "col")));
    const ink = themeColors().ink;
    matrix.forEach((values, rowIndex) => {
      if (!Array.isArray(values)) return;
      const total = values.reduce((sum, value) => (finite(value) ? sum + value : sum), 0);
      const row = node("tr");
      row.appendChild(conditionHeader(ordered[rowIndex], "row"));
      values.forEach((value, columnIndex) => {
        const fraction = total > 0 && finite(value) ? value / total : 0;
        const box = cell(
          row,
          finite(value) ? `${integer(value)} (${percent(fraction, 0)})` : "—",
          "sky-confusion-cell"
        );
        box.style.background = `rgba(${ink}, ${(0.05 + 0.6 * fraction).toFixed(3)})`;
        if (columnIndex === rowIndex) box.classList.add("is-diagonal");
      });
      body.appendChild(row);
    });
  }

  function bandLabel(row) {
    const stratum = text(row.stratum, "");
    const bounds = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(stratum);
    if (bounds) return `${decimal(Number(bounds[1]), 1)}–${decimal(Number(bounds[2]), 1)}°`;
    return stratum || "—";
  }

  function errorCells(row, entry) {
    cell(row, integer(entry.n));
    cell(row, decimal(entry.rmse, 2));
    cell(row, decimal(entry.mae, 2));
    cell(row, signed(entry.mbe, 2));
  }

  function renderStratified() {
    const stratified = (state.modelPayload && state.modelPayload.stratified) || {};
    const model = state.modelPayload;
    const elevationBody = el("ceuElevacaoCorpo");
    elevationBody.replaceChildren();
    el("ceuElevacaoLegenda").textContent = stratified.member
      ? `Por faixa de elevação solar — membro ${stratified.member}, difusa em ${dhiUnit()}`
      : `Por faixa de elevação solar, difusa em ${dhiUnit()}`;
    for (const entry of rowsOf(stratified.solar_elevation, "stratum")) {
      const row = node("tr");
      const extrapolated = entry.extrapolation === true ? " — extrapolação" : "";
      cell(row, `${bandLabel(entry)}${extrapolated}`);
      errorCells(row, entry);
      elevationBody.appendChild(row);
    }
    const classBody = el("ceuEstratoClasseCorpo");
    classBody.replaceChildren();
    const rows = rowsOf(stratified.sky_class, "stratum");
    for (const condition of conditionsOf(model)) {
      const entry = rows.find((row) => (resolveCondition(model, row.stratum) || {}).id === condition.id);
      if (!entry) continue;
      const row = node("tr");
      cell(row, conditionCell(condition));
      errorCells(row, entry);
      classBody.appendChild(row);
    }
  }

  function renderPerDay() {
    const body = el("ceuDiasTesteCorpo");
    body.replaceChildren();
    const model = state.modelPayload;
    const days = Array.isArray(evaluation().per_day) ? evaluation().per_day : [];
    const persistence = skillEntry("persistence");
    el("ceuDiasTestePersistencia").textContent =
      persistence && finite(persistence.horizon_minutes)
        ? `RMSE da persistência de ${integer(persistence.horizon_minutes)} min`
        : "RMSE da persistência";
    body.closest(".clima-table-scroll").hidden = days.length === 0;
    for (const day of days) {
      if (!day || typeof day !== "object") continue;
      const row = node("tr");
      const date = parseStationTime(day.date || "");
      cell(row, Number.isFinite(date) ? formatDay(date) : text(day.date));
      cell(row, integer(day.n));
      cell(row, shareBar(model, day.class_share));
      cell(row, decimal(day.rmse_model, 2));
      cell(row, decimal(day.rmse_persistence, 2));
      cell(row, decimal(day.rmse_clearsky, 2));
      body.appendChild(row);
    }
  }

  function curveEpochs(curve) {
    if (Array.isArray(curve.epochs)) return curve.epochs;
    const length = Math.max(
      ...["train_kindex_mae", "val_kindex_mae"].map((key) => (Array.isArray(curve[key]) ? curve[key].length : 0))
    );
    return Array.from({ length }, (_value, index) => index + 1);
  }

  function curveSeries(curve, key, epochs) {
    const values = Array.isArray(curve[key]) ? curve[key] : null;
    if (!values) return null;
    const points = epochs.map((epoch, index) => ({ x: epoch, y: finite(values[index]) ? values[index] : null }));
    return points.some((point) => point.y !== null) ? points : null;
  }

  const bestEpochMarker = {
    id: "labmimSkyBestEpoch",
    afterDatasetsDraw(chart, _args, options) {
      if (!finite(options.epoch)) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(options.epoch);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.save();
      ctx.strokeStyle = options.color;
      ctx.fillStyle = options.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = x > (chartArea.left + chartArea.right) / 2 ? "right" : "left";
      ctx.fillText(
        `melhor época: ${integer(options.epoch)}`,
        x + (ctx.textAlign === "left" ? 4 : -4),
        chartArea.top + 12
      );
      ctx.restore();
    },
  };

  function drawTrainingCurve(theme) {
    if (state.curveChart) {
      state.curveChart.destroy();
      state.curveChart = null;
    }
    const curve = (state.modelPayload && state.modelPayload.training_curve) || {};
    const epochs = curveEpochs(curve);
    const train = curveSeries(curve, "train_kindex_mae", epochs);
    const validation = curveSeries(curve, "val_kindex_mae", epochs);
    const wrap = el("ceuCurvaChartWrap");
    wrap.hidden = !train && !validation;
    const note = el("ceuCurvaNota");
    if (wrap.hidden) {
      note.textContent = "";
      return;
    }
    const noteParts = [`MAE de ${kindexSymbol()} por época, no treino e na validação`];
    if (finite(curve.best_epoch)) noteParts.push(`a parada antecipada escolheu a época ${integer(curve.best_epoch)}`);
    const served = servedBlock();
    if (served.training && finite(served.training.epochs))
      noteParts.push(`${integer(served.training.epochs)} épocas previstas`);
    note.textContent = `${noteParts.join(" · ")}.`;
    const datasets = [];
    if (train) {
      datasets.push({
        label: "treino",
        data: train,
        borderColor: theme.textSecondary,
        backgroundColor: theme.textSecondary,
        borderWidth: 1.4,
        borderDash: [5, 4],
        pointRadius: 0,
        spanGaps: false,
        tension: 0,
      });
    }
    if (validation) {
      datasets.push({
        label: "validação",
        data: validation,
        borderColor: `rgb(${theme.ink})`,
        backgroundColor: `rgb(${theme.ink})`,
        borderWidth: 1.8,
        pointRadius: 0,
        spanGaps: false,
        tension: 0,
      });
    }
    state.curveChart = new Chart(el("ceuCurvaCanvas").getContext("2d"), {
      type: "line",
      data: { datasets },
      options: {
        ...lineChartBase(),
        plugins: {
          labmimSkyBestEpoch: { epoch: curve.best_epoch, color: theme.textSecondary },
          legend: { display: true, position: "top", labels: { color: theme.legendText, boxWidth: 26 } },
          tooltip: chartTooltip(theme, {
            title: (items) => `Época ${integer(items[0].parsed.x)}`,
            label: (item) => `${item.dataset.label}: ${decimal(item.parsed.y, 4)}`,
          }),
        },
        scales: {
          x: {
            type: "linear",
            min: epochs[0],
            max: epochs[epochs.length - 1],
            title: { display: true, text: "época", color: theme.textSecondary },
            ticks: { color: theme.textSecondary, stepSize: 5, maxRotation: 0 },
            grid: { display: false },
          },
          y: {
            type: "linear",
            title: { display: true, text: `MAE de ${kindexSymbol()}`, color: theme.textSecondary },
            ticks: { color: theme.textSecondary, maxTicksLimit: 6 },
            grid: { color: theme.grid },
          },
        },
      },
      plugins: [bestEpochMarker],
    });
  }

  function bestMetricText(value) {
    if (value && typeof value === "object") {
      const name = typeof value.name === "string" ? ` (${keyLabel(METRIC_PT, value.name)})` : "";
      return `${metricValue(String(value.name || ""), value.value)}${name}`;
    }
    return decimal(value, 4);
  }

  function renderSeeds() {
    const body = el("ceuSementesCorpo");
    body.replaceChildren();
    el("ceuSementesCabecalhoKindex").textContent = `MAE ${kindexSymbol()}`;
    const seeds = (state.modelPayload && state.modelPayload.seeds) || {};
    const served = servedBlock();
    const pinned = Array.isArray(served.members) ? served.members : [];
    const members = Array.isArray(seeds.members) ? seeds.members : [];
    const captionParts = [];
    if (finite(seeds.n_seeds))
      captionParts.push(`${integer(seeds.n_seeds)} sementes — sem desvio-padrão, só mínimo e máximo`);
    const range = seeds.range && typeof seeds.range === "object" ? seeds.range : {};
    const rangeParts = Object.entries(range)
      .filter(([, bounds]) => bounds && finite(bounds.min) && finite(bounds.max))
      .map(
        ([key, bounds]) =>
          `${keyLabel(METRIC_PT, key)} ${metricValue(key, bounds.min)} a ${metricValue(key, bounds.max)}`
      );
    if (rangeParts.length) captionParts.push(`faixa: ${rangeParts.join("; ")}`);
    el("ceuSementesLegenda").textContent = captionParts.join(" · ");
    for (const member of members) {
      if (!member || typeof member !== "object") continue;
      const pin = pinned.find((entry) => entry && entry.name === member.name) || {};
      const row = node("tr");
      cell(row, text(member.name));
      cell(row, integer(member.seed ?? pin.seed));
      cell(row, integer(pin.epoch));
      cell(row, bestMetricText(pin.best_metric));
      cell(row, decimal(member.dhi_rmse, 2));
      cell(row, decimal(member.dhi_mae, 2));
      cell(row, signed(member.dhi_mbe, 2));
      cell(row, decimal(member.kindex_mae, 4));
      cell(row, percent(member.sky_balanced_accuracy, 1));
      body.appendChild(row);
    }
    body.closest(".clima-table-scroll").hidden = body.children.length === 0;
  }

  function renderDataset() {
    const model = state.modelPayload;
    const dataset = model.dataset || {};
    const split = dataset.split || {};
    const noteParts = [];
    if (finite(dataset.rows) && finite(dataset.days))
      noteParts.push(`${integer(dataset.rows)} linhas em ${integer(dataset.days)} dias`);
    const period = dataset.period || {};
    const start = parseStationDate(period.start);
    const end = parseStationDate(period.end);
    if (Number.isFinite(start) && Number.isFinite(end)) noteParts.push(`${formatDay(start)} a ${formatDay(end)}`);
    if (dataset.season_note) noteParts.push(dataset.season_note);
    if (split.strategy) noteParts.push(`divisão ${keyLabel(SPLIT_STRATEGY_PT, split.strategy)}`);
    if (finite(split.gap_days))
      noteParts.push(`${integer(split.gap_days)} ${split.gap_days === 1 ? "dia" : "dias"} de intervalo`);
    if (finite(dataset.min_elevation_deg)) noteParts.push(`piso de elevação ${decimal(dataset.min_elevation_deg, 1)}°`);
    if (dataset.frames_from) noteParts.push(`quadros de ${dataset.frames_from}`);
    if (dataset.camera) noteParts.push(dataset.camera);
    if (dataset.target_source) noteParts.push(`alvo: ${keyLabel(TARGET_SOURCE_PT, dataset.target_source)}`);
    el("ceuDadosNota").replaceChildren(withReferences(noteParts.join(" · ")));
    const body = el("ceuDivisaoCorpo");
    body.replaceChildren();
    el("ceuDivisaoLegenda").textContent =
      "Cada divisão com seus dias, linhas, faixa de elevação solar e mistura de condições";
    for (const key of ["train", "val", "test"]) {
      const part = split[key];
      if (!part || typeof part !== "object") continue;
      const row = node("tr");
      cell(row, SPLIT_PT[key]);
      cell(row, integer(part.days));
      const partStart = parseStationDate(part.start);
      const partEnd = parseStationDate(part.end);
      cell(
        row,
        Number.isFinite(partStart) && Number.isFinite(partEnd) ? `${formatDay(partStart)} a ${formatDay(partEnd)}` : "—"
      );
      cell(row, integer(part.rows));
      const declared = part.solar_elevation_range_deg;
      const range = Array.isArray(declared)
        ? declared
        : declared && typeof declared === "object"
          ? [declared.min, declared.max]
          : [];
      cell(row, range.length === 2 ? `${decimal(range[0], 1)}° a ${decimal(range[1], 1)}°` : "—");
      cell(row, shareBar(model, part.class_share));
      body.appendChild(row);
    }
  }

  function renderProvenance() {
    const list = el("ceuProveniencia");
    list.replaceChildren();
    const model = state.modelPayload;
    const served = servedBlock();
    const dataset = model.dataset || {};
    if (served.id) factRow(list, "Braço servido", `${served.id}${served.label ? ` — ${served.label}` : ""}`);
    const members = Array.isArray(served.members) ? served.members : [];
    for (const member of members) {
      if (!member || typeof member !== "object") continue;
      const details = [];
      if (finite(member.seed)) details.push(`semente ${integer(member.seed)}`);
      if (member.role) details.push(`papel: ${roleLabel(member.role)}`);
      if (finite(member.epoch)) details.push(`época ${integer(member.epoch)}`);
      details.push(`pesos ${shortHash(member.checkpoint_sha256)}`);
      factRow(list, `Membro ${text(member.name)}`, details.join(" · "));
    }
    const attributionMember = finite(served.attribution_member)
      ? (members[served.attribution_member] || {}).name
      : served.attribution_member;
    if (attributionMember) factRow(list, "Membro do mapa de sensibilidade", text(attributionMember));
    const roles = served.roles;
    if (roles && typeof roles === "object") {
      factRow(
        list,
        "Papéis das cabeças",
        Object.entries(roles)
          .map(([key, value]) => `${keyLabel(ROLE_KEY_PT, key)}: ${roleLabel(value)}`)
          .join(" · ")
      );
    }
    if (served.code_version) factRow(list, "Versão do código", codeVersionText(served.code_version));
    const selection = served.selection || {};
    if (selection.criterion) factRow(list, "Critério de seleção", withReferences(selection.criterion));
    if (selection.selection_split)
      factRow(list, "Divisão da seleção", SPLIT_PT[selection.selection_split] || selection.selection_split);
    const decided = parseStationDate(selection.decided_on);
    if (Number.isFinite(decided)) factRow(list, "Decidido em", formatDay(decided));
    const architecture = served.architecture;
    if (architecture && typeof architecture === "object") {
      const details = [];
      if (architecture.name) details.push(keyLabel(ARCHITECTURE_NAME_PT, architecture.name));
      if (architecture.backbone) details.push(`tronco ${architecture.backbone}`);
      if (finite(architecture.image_size)) details.push(`${integer(architecture.image_size)} px`);
      if (architecture.pooling) details.push(`agregação ${architecture.pooling}`);
      if (finite(architecture.unfreeze_last_n))
        details.push(`${integer(architecture.unfreeze_last_n)} blocos ajustados`);
      if (finite(architecture.trunk_hidden)) details.push(`tronco oculto ${integer(architecture.trunk_hidden)}`);
      if (finite(architecture.parameters)) details.push(`${integer(architecture.parameters)} parâmetros`);
      factRow(list, "Arquitetura", withReferences(details.join(" · ")));
    }
    const inputs = served.inputs;
    if (inputs && typeof inputs === "object") {
      const details = [];
      const geometry = geometryText(inputs.image_geometry);
      if (geometry) details.push(geometry);
      details.push(inputs.scalars_consumed === false ? "não consome escalares" : "consome escalares");
      if (inputs.radiometry_forbidden === true) details.push("radiometria proibida na entrada");
      factRow(list, "Entradas", details.join(" · "));
    }
    const training = served.training;
    if (training && typeof training === "object") {
      const scalarEntry = ([key, value]) =>
        `${keyLabel(TRAINING_KEY_PT, key)}: ${typeof value === "number" ? decimal(value, value < 1 ? 6 : 0) : value}`;
      const details = Object.entries(training)
        .filter(([, value]) => value !== null && typeof value !== "object")
        .map(scalarEntry);
      const stopping = training.early_stopping;
      if (stopping && typeof stopping === "object") {
        const inner = Object.entries(stopping)
          .filter(([, value]) => value !== null && typeof value !== "object")
          .map(scalarEntry);
        details.push(`parada antecipada — ${inner.join(", ")}`);
      }
      if (details.length) factRow(list, "Treino", details.join(" · "));
    }
    if (dataset.manifest_sha256) factRow(list, "Manifesto do conjunto", shortHash(dataset.manifest_sha256));
    if (dataset.split_id) {
      const id = String(dataset.split_id);
      factRow(list, "Identificador da divisão", /^[0-9a-f]{32,}$/i.test(id) ? shortHash(id) : id);
    }
    if (dataset.dataset_version) factRow(list, "Versão do conjunto", dataset.dataset_version);
    const attribution = model.attribution_summary;
    if (attribution && typeof attribution === "object") {
      const details = [];
      if (attribution.method === "occlusion_sensitivity") details.push("sensibilidade à oclusão");
      else if (attribution.method) details.push(attribution.method);
      if (finite(attribution.window_px)) details.push(`janela ${integer(attribution.window_px)} px`);
      if (finite(attribution.stride_px)) details.push(`passo ${integer(attribution.stride_px)} px`);
      if (attribution.target)
        details.push(`alvo ${attribution.target === "kindex" ? kindexSymbol() : attribution.target}`);
      factRow(list, "Mapa de sensibilidade", details.join(" · "));
    }
    const check = model.domain_check;
    if (check && typeof check === "object") {
      const details = [];
      const day = parseStationDate(check.day);
      if (Number.isFinite(day)) details.push(formatDay(day));
      if (finite(check.n)) details.push(`n ${integer(check.n)}`);
      if (finite(check.dhi_rmse)) details.push(`RMSE DHI ${decimal(check.dhi_rmse, 2)} ${dhiUnit()}`);
      if (finite(check.dhi_mbe)) details.push(`MBE DHI ${signed(check.dhi_mbe, 2)} ${dhiUnit()}`);
      if (finite(check.class_agreement)) details.push(`concordância de condição ${percent(check.class_agreement, 1)}`);
      factRow(list, "Verificação de domínio (JPEG ao vivo × timelapse)", details.join(" · ") || "—");
    } else {
      factRow(list, "Verificação de domínio (JPEG ao vivo × timelapse)", "não medido");
    }
  }

  function modelUnavailableMessage() {
    if (state.modelStatus === "unreadable") return unreadableMessage("O cartão do modelo");
    if (state.modelStatus === "absent") {
      return "O cartão do modelo ainda não foi publicado — o quadro e a linha do tempo não dependem dele.";
    }
    return "O cartão do modelo não traz avaliação.";
  }

  function drawModelCard() {
    const model = state.modelPayload;
    const usable = Boolean(model && typeof model === "object" && (servedArm() || servedBlock().id));
    el("ceuModeloToggleWrap").hidden = !usable;
    el("ceuModeloResumo").hidden = !usable;
    if (!usable) {
      el("ceuModeloNota").textContent = "";
      el("ceuModeloDetalhes").hidden = true;
      el("ceuModeloStatus").textContent = modelUnavailableMessage();
      return;
    }
    renderModelHeadline();
    const caveat = persistenceCaveat();
    el("ceuModeloStatus").replaceChildren(withReferences(caveat));
    renderArmsTable();
    renderReferencesTable();
    renderPerClass();
    renderConfusion();
    renderStratified();
    renderPerDay();
    drawTrainingCurve(themeColors());
    renderSeeds();
    renderDataset();
    renderProvenance();
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
    empty.classList.remove("is-loading");
    empty.hidden = false;
    el("ceuEmptyMessage").textContent = message;
  }

  function onThemeChange() {
    buildClassToggles();
    buildModelToggles();
    drawChart();
    drawCumulative();
    renderPredictionCard();
    drawTimeline();
    drawModelCard();
  }

  function applyChartPayload(chart) {
    state.chartPayload = chart.payload;
    state.chartStatus = chart.status;
    state.classes = resolveClasses(state.chartPayload);
    state.models = resolveModels(state.chartPayload);
    state.points = readPoints(state.chartPayload);
    state.density = readDensity(state.chartPayload);
    invalidateVisiblePoints();
    if (!state.density) state.layers.delete("density");
    if (!state.density && pointsOffered()) state.layers.add("points");
    if (state.models.length) state.activeModels.add(state.models[0].id);
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

    const chartRequest = loadJson(KTKD_PAYLOAD);
    const [frame, timeline, model, cumulative] = await Promise.all([
      loadJson(FRAME_PAYLOAD),
      loadJson(TIMELINE_PAYLOAD),
      loadJson(MODEL_PAYLOAD),
      loadJson(CUMULATIVE_PAYLOAD),
    ]);
    state.chartStatus = "loading";
    state.framePayload = frame.payload;
    state.frameStatus = frame.status;
    state.timelinePayload = timeline.payload;
    state.timelineStatus = timeline.status;
    state.modelPayload = model.payload;
    state.modelStatus = model.status;
    state.cumulativePayload = cumulative.payload;
    state.cumulativeStatus = cumulative.status;
    state.classes = resolveClasses(null);

    // Before anything renders text: a payload bibliography has to be in the registry for the markers in its own
    // caveats to expand into citations instead of staying literal.
    registerPayloadReferences();

    renderHeader();
    renderFrames();
    buildCaveats();
    buildLayerToggles();
    buildClassToggles();
    buildModelToggles();
    el("ceuOpacidade").addEventListener("input", applyOverlayOpacity);
    el("ceuGuia").addEventListener("click", openGuide);
    el("ceuAmpliar").addEventListener("click", openZoom);
    el("ceuExport").addEventListener("click", exportCsv);

    initCumulative();
    el("ceuEmpty").hidden = true;
    el("ceuApp").hidden = false;
    drawTimeline();
    drawModelCard();
    // Last, so it sees every citation the page ended up making — the static prose already decorated by
    // references.js, plus the markers the payloads brought in.
    renderReferences();
    drawChart();
    drawCumulative();

    window.addEventListener("labmim-theme-change", onThemeChange);

    applyChartPayload(await chartRequest);
    if (state.layers.has("points")) ensurePoints();
    registerPayloadReferences();
    renderHeader();
    buildCaveats();
    buildLayerToggles();
    buildClassToggles();
    buildModelToggles();
    renderReferences();
    drawChart();
    settleEmptyState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
