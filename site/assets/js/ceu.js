"use strict";

(function () {
  const RESEARCH_MODE = window.labmimChartPage.researchMode;
  const KTKD_PAYLOAD = "ktkd.json";
  const FRAME_PAYLOAD = "frame.json";
  const TIMELINE_PAYLOAD = "timeline.json";
  const CUMULATIVE_PAYLOAD = "kt_cumulative.json";
  const PUBLIC_POINTS_LIMIT = 5000;
  const PUBLIC_POINTS_ONE_IN = 4;
  const POINTS_LOADING_MESSAGE = "Carregando os pontos…";
  const POINTS_FAILURE_MESSAGES = {
    absent: "O arquivo de pontos não pôde ser baixado.",
    unreadable: unreadableMessage("O arquivo de pontos"),
    foreign: "O arquivo não contém pontos compatíveis com este modo de visualização.",
    stale:
      "Os pontos são de outra versão do documento de Kt × Kd, que está sendo atualizado. Recarregue a página em alguns minutos.",
  };
  const UNDECLARED_KD_HEADROOM = 0.1;
  const DEFAULT_RAW_FRAME = "allsky.jpg";
  const IMAGE_ONLY_MODEL = "image_only";
  const VIEW_LAYERS = [
    { id: "photo", label: "Foto" },
    { id: "features", label: "Padrões" },
    { id: "sensitivity", label: "Influência" },
  ];
  const MODEL_LABELS = { image_only: "Só imagem", image_ghi: "Imagem + sensores" };
  const MODEL_INPUT_LABELS = { image: "Foto do céu", ghi: "Radiação global medida" };
  const PHOTO_NOTE = "Foto original da câmera all-sky, como foi registrada.";
  const FEATURES_NOTE =
    "Cores parecidas marcam regiões que o modelo interpreta da mesma forma, como céu limpo, nuvens e o entorno do sol. " +
    "As cores não têm significado fixo e mudam de um modelo para o outro.";
  const FEATURES_ALT = "Mapa de padrões do modelo sobre a foto do céu";

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

  const TIMESCALE_NOTES = {
    hourly: { label: "Médias horárias", unit: "horas" },
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
    chartBase: "",
    chart: null,
    chartPayload: null,
    chartStatus: "absent",
    framePayload: null,
    frameStatus: "absent",
    timelinePayload: null,
    timelineStatus: "absent",
    cumulativeStatus: "absent",
    timelineChart: null,
    stripChart: null,
    timelineDrawToken: 0,
    themeDrawToken: 0,
    classes: [],
    models: [],
    points: [],
    pointsRequest: null,
    pointsStatus: "idle",
    density: null,
    hidden: new Set(),
    layers: new Set([RESEARCH_MODE ? "points" : "density"]),
    activeModels: new Set(),
    photoMissing: false,
    viewLayer: "photo",
    viewModel: IMAGE_ONLY_MODEL,
    payloadsCheckedAt: 0,
    announcedStatus: new Map(),
    hoverCell: null,
    cumulativePayload: null,
    cumulativeSubsetId: "",
    cumulativeChart: null,
  };

  const { el, isDark, node, statTile, pad, decimal, integer, countNoun, percent, fade, parseStationTime, showEmpty } =
    window.labmimChartPage;
  const formatDay = window.labmimChartPage.formatDayYear;
  const formatStamp = window.labmimChartPage.formatStampYear;
  const formatShortDay = window.labmimChartPage.formatDay;
  const formatHour = window.labmimChartPage.formatHour;

  const POINTS = RESEARCH_MODE
    ? {
        file: "ktkd_points.json",
        schema: "labmim-ktkd-research-v1",
        sampling: "complete",
        format: ["kt", "kd", "t", "condition"],
        label: "Pontos (completos)",
        fits: (n, population) => n === population,
        hint: "Todas as horas selecionadas, coloridas pela condição de céu",
        chartLabel: "Dispersão completa",
        note: (declared) =>
          `Pesquisa local: todas as ${integer(declared.n)} horas selecionadas, sem amostragem nem arredondamento dos pontos. Densidade, curvas e métricas usam o mesmo registro completo.`,
        missing: "Os pontos completos de pesquisa não estão disponíveis.",
        guide:
          "Uma marca por hora do registro selecionado, colorida pela condição de céu daquele Kt. Todos os pontos são preservados com a precisão original, sob os mesmos filtros científicos da densidade e das métricas.",
      }
    : {
        file: "ktkd_sample.json",
        schema: "labmim-ktkd-sample-v1",
        sampling: "stable-hash-v1",
        format: ["kt", "kd", "condition"],
        label: "Pontos (amostra)",
        fits: (n, population) => n <= Math.min(PUBLIC_POINTS_LIMIT, Math.floor(population / PUBLIC_POINTS_ONE_IN)),
        hint: "Amostra fixa de horas medidas, colorida pela condição de céu; a densidade usa o registro completo",
        chartLabel: "Amostra",
        note: (declared) =>
          `Pontos: amostra de ${integer(declared.n)} das ${integer(declared.population_n)} horas, sem datas individuais. Densidade, curvas e métricas usam todo o registro selecionado.`,
        missing:
          "A amostra de pontos ainda não foi publicada. Densidade, curvas e métricas usam todo o registro selecionado.",
        guide: `Uma marca por hora da amostra, colorida pela condição de céu daquele Kt. A seleção é fixa para o mesmo registro, limitada a ${integer(PUBLIC_POINTS_LIMIT)} pontos e a ${percent(1 / PUBLIC_POINTS_ONE_IN, 0)} das horas, sem datas individuais. A densidade e as métricas dos modelos usam todas as horas selecionadas.`,
      };

  const POINT_CONDITION_INDEX = POINTS.format.indexOf("condition");
  const POINT_TIME_INDEX = POINTS.format.indexOf("t");

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
      sensorModel: isDark() ? MODEL_PALETTE.dark.ridley_brl_2010 : MODEL_PALETTE.light.ridley_brl_2010,
    };
  }

  function rangeLabel(entry, index, total) {
    const bounds = Array.isArray(entry.kt_range) ? entry.kt_range : [];
    if (index === 0) return `Kt ≤ ${decimal(bounds[1], 2)}`;
    if (index === total - 1) return `Kt > ${decimal(bounds[0], 2)}`;
    return `${decimal(bounds[0], 2)} < Kt ≤ ${decimal(bounds[1], 2)}`;
  }

  function resolveClasses(payload) {
    const source = declaredConditions(payload) || FALLBACK_CLASSES;
    return source.map((entry, index) => {
      const id = String(entry.id || ROMAN[index] || index + 1).toLowerCase();
      const condition = entry.condition || index + 1;
      const roman = ROMAN[condition - 1] || String(condition);
      const cited = FALLBACK_CLASSES.find((known) => known.id === id);
      const name = (cited && cited.name_pt) || entry.name_pt || SHORT_LABELS[id] || id;
      return {
        id,
        condition,
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

  function readPoints(rows) {
    return rows.map((row) => ({ x: row[0], y: row[1], condition: row[POINT_CONDITION_INDEX], observed: true }));
  }

  function pointsFileDeclared() {
    const declared = state.chartPayload && state.chartPayload.points_file;
    if (!declared || declared.name !== POINTS.file || declared.sampling !== POINTS.sampling) return false;
    return (
      Number.isInteger(declared.population_n) &&
      declared.population_n === state.chartPayload.period?.n &&
      Number.isInteger(declared.n) &&
      declared.n >= 0 &&
      POINTS.fits(declared.n, declared.population_n)
    );
  }

  function pointsOffered() {
    return pointsFileDeclared() && state.chartPayload.points_file.n > 0;
  }

  function pointsFailed() {
    return POINTS_FAILURE_MESSAGES[state.pointsStatus] !== undefined;
  }

  function pointsUsable() {
    return pointsOffered() && !pointsFailed();
  }

  function pointsStatusMessage() {
    if (state.pointsStatus === "loading") return POINTS_LOADING_MESSAGE;
    return pointsFailed() ? POINTS_FAILURE_MESSAGES[state.pointsStatus] : "";
  }

  function pointsFileStatus(result) {
    if (result.status !== "ok") return result.status;
    const payload = result.payload;
    if (!payload || payload.schema !== POINTS.schema) return "foreign";
    const version = state.chartPayload.version;
    if (typeof version !== "string" || !version || payload.version !== version) return "stale";
    const declared = state.chartPayload.points_file;
    if (
      payload.sampling !== declared.sampling ||
      payload.population_n !== declared.population_n ||
      !Array.isArray(payload.points) ||
      payload.points.length !== declared.n ||
      !Array.isArray(payload.points_format) ||
      payload.points_format.join(",") !== POINTS.format.join(",") ||
      !payload.points.every(
        (point) =>
          Array.isArray(point) &&
          point.length === POINTS.format.length &&
          Number.isFinite(point[0]) &&
          Number.isFinite(point[1]) &&
          (POINT_TIME_INDEX < 0 ||
            (typeof point[POINT_TIME_INDEX] === "string" &&
              Number.isFinite(parseStationTime(point[POINT_TIME_INDEX])))) &&
          Number.isInteger(point[POINT_CONDITION_INDEX]) &&
          point[POINT_CONDITION_INDEX] >= 1 &&
          point[POINT_CONDITION_INDEX] <= 4
      )
    ) {
      return "foreign";
    }
    return "ok";
  }

  function focusedPointsControl() {
    const focused = document.activeElement;
    return el("ceuCamadas").contains(focused) ? focused : null;
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
    state.pointsStatus = pointsFileStatus(result);
    state.points = state.pointsStatus === "ok" ? readPoints(result.payload.points) : [];
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
    if (state.points.length || !pointsOffered()) return Promise.resolve();
    if (!state.pointsRequest) {
      state.pointsStatus = "loading";
      state.pointsRequest = loadJson(POINTS.file, state.chartBase).then(acceptPointsFile);
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

  function densestCellHours() {
    const count = state.density ? state.density.max_count : null;
    if (!Number.isInteger(count) || count < 1) return "muitas horas";
    return countNoun(count, "hora", "horas");
  }

  function densityCoverageSentence(coverage) {
    const rest = coverage.outside === 1 ? "mais uma fica" : `outras ${integer(coverage.outside)} ficam`;
    const inside = countNoun(coverage.inside, "hora", "horas");
    return `A densidade conta ${inside}; ${rest} fora da grade ${coverage.span}.`;
  }

  function pointClass(point) {
    return state.classes.find((entry) => entry.condition === point.condition) || null;
  }

  const ATTRIBUTION_ALT =
    "Mapa de influência sobre a foto do céu: cor mais clara onde esconder um trecho mais altera a estimativa do modelo";

  const REASON_PT = {
    fresh: "quadro recente",
    night: "o sol está abaixo do piso de elevação do modelo; a câmera segue, mas nada é pontuado à noite",
    no_scored_frame: "nenhum quadro foi pontuado ainda",
    watch_stale: "há luz do dia, mas a vigília não escreveu uma previsão nos últimos blocos",
  };

  const CLOCK_OFFSET_TOLERANCE_S = 60;
  const MINUTE_MS = 60000;
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;
  const AGE_REFRESH_INTERVAL_MS = MINUTE_MS;
  const PAYLOAD_RECHECK_INTERVAL_MS = 5 * MINUTE_MS;
  const PAYLOAD_RECHECK_MIN_GAP_MS = MINUTE_MS;

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function text(value, fallback = "—") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function withUnit(formatted, unit) {
    return formatted === "—" ? formatted : `${formatted} ${unit}`;
  }

  function unreadableMessage(subject) {
    return `${subject} chegou incompleto ou ilegível; ele pode estar sendo publicado neste momento.`;
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

  function ageSuffix(sinceUtcMs) {
    const age = ageText(Date.now() - sinceUtcMs);
    return age ? ` (${age})` : "";
  }

  function ageNode(payload, localStamp) {
    const sinceUtcMs = stationToUtcMs(payload, localStamp);
    const age = node("span", null, ageSuffix(sinceUtcMs));
    age.dataset.ageSince = String(sinceUtcMs);
    return age;
  }

  function statusContent(parts, separator) {
    const content = document.createDocumentFragment();
    parts.forEach((part, index) => {
      if (index) content.append(separator);
      for (const piece of [part].flat()) content.append(typeof piece === "string" ? withReferences(piece) : piece);
    });
    return content;
  }

  function clockOffsetText(offsetSeconds) {
    if (!finite(offsetSeconds) || Math.abs(offsetSeconds) <= CLOCK_OFFSET_TOLERANCE_S) return "";
    const direction = offsetSeconds > 0 ? "atrasado" : "adiantado";
    return `relógio da câmera ${direction} ${integer(Math.abs(offsetSeconds))} s`;
  }

  function targetsGlossary() {
    for (const targets of [
      state.framePayload && state.framePayload.targets,
      state.timelinePayload && state.timelinePayload.targets,
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

  function frameCacheToken(block) {
    const hash = block && typeof block.sha256_12 === "string" ? block.sha256_12.trim() : "";
    return hash ? `v=${encodeURIComponent(hash)}` : `t=${encodeURIComponent(frameToken())}`;
  }

  function frameUrl(name, fallback) {
    return `${state.base}/${frameFileName(name, fallback)}?${frameCacheToken(frameSection(name))}`;
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
      state.photoMissing = true;
      container.replaceChildren(node("div", "sky-frame-missing", missingMessage));
      noteElement.textContent = "";
      settleEmptyState();
    });
    container.replaceChildren(image);
    return image;
  }

  function allPayloadsAbsent() {
    return [state.chartStatus, state.frameStatus, state.timelineStatus, state.cumulativeStatus].every(
      (status) => status === "absent"
    );
  }

  function settleEmptyState() {
    if (!state.photoMissing || !allPayloadsAbsent()) return;
    showEmpty(
      "ceu",
      "Os dados de condição do céu ainda não foram publicados para esta estação. " +
        "Eles são anexados ao site no deploy, separadamente das páginas."
    );
  }

  function applyOverlayOpacity() {
    const slider = el("ceuOpacidade");
    slider.setAttribute("aria-valuetext", `${slider.value}% de opacidade da camada`);
    const overlay = el("ceuMediaBruto").querySelector(".sky-frame-overlay");
    if (overlay) overlay.style.opacity = String(Number(slider.value) / 100);
  }

  function fitFrameBox(container, image) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    container.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
  }

  function frameScored() {
    const frame = state.framePayload;
    return Boolean(frame && frame.status && frame.status.scored !== false && frame.prediction);
  }

  function frameModels() {
    const frame = state.framePayload;
    if (!frame) return [];
    if (Array.isArray(frame.models) && frame.models.length) {
      return frame.models.filter((model) => model && typeof model === "object" && typeof model.id === "string");
    }
    if (!frame.prediction && !frameSection("attribution")) return [];
    return [
      {
        id: IMAGE_ONLY_MODEL,
        inputs: ["image"],
        available: frameScored(),
        prediction: frame.prediction || null,
        maps: { features: null, sensitivity: frameSection("attribution") },
      },
    ];
  }

  function modelLabel(model) {
    return text(model.label_pt, MODEL_LABELS[model.id] || model.id);
  }

  function modelMap(model, layer) {
    const meta = model && model.maps && model.maps[layer];
    return meta && typeof meta === "object" && typeof meta.file === "string" && meta.file ? meta : null;
  }

  function mapUrl(meta) {
    return `${state.base}/${meta.file}?${frameCacheToken(meta)}`;
  }

  function viewedModel() {
    const models = frameModels();
    return models.find((model) => model.id === state.viewModel) || models[0] || null;
  }

  function layerOffered(layer) {
    return layer.id === "photo" || frameModels().some((model) => modelMap(model, layer.id));
  }

  function settleViewChoice() {
    const models = frameModels();
    if (!VIEW_LAYERS.some((layer) => layer.id === state.viewLayer && layerOffered(layer))) state.viewLayer = "photo";
    if (!models.some((model) => model.id === state.viewModel)) state.viewModel = IMAGE_ONLY_MODEL;
    if (state.viewLayer === "photo" || modelMap(viewedModel(), state.viewLayer)) return;
    const drawn = models.find((model) => modelMap(model, state.viewLayer));
    if (drawn) state.viewModel = drawn.id;
  }

  function buildChoice(container, entries, onChoose) {
    container.replaceChildren(
      ...entries.map((entry) => {
        const button = node("button", "clima-segmented-btn", entry.label);
        button.type = "button";
        button.dataset.choice = entry.id;
        button.addEventListener("click", () => onChoose(entry.id));
        return button;
      })
    );
  }

  function syncChoice(container, current, enabled) {
    for (const button of container.children) {
      const active = button.dataset.choice === current;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
      button.disabled = !enabled(button.dataset.choice);
    }
  }

  function chooseView(change) {
    change();
    renderViewer();
  }

  function renderFrames() {
    state.photoMissing = false;
    const container = el("ceuMediaBruto");
    const photo = buildFrame(
      container,
      frameUrl("image", DEFAULT_RAW_FRAME),
      frameAlt("image", "Foto da câmera all-sky"),
      el("ceuCamadaNota"),
      "Foto ainda não publicada."
    );
    photo.classList.add("sky-frame-photo");
    photo.addEventListener("load", () => fitFrameBox(container, photo));
    buildChoice(el("ceuVisorCamada"), VIEW_LAYERS.filter(layerOffered), (id) =>
      chooseView(() => {
        state.viewLayer = id;
      })
    );
    buildChoice(
      el("ceuVisorModelo"),
      frameModels().map((model) => ({ id: model.id, label: modelLabel(model) })),
      (id) =>
        chooseView(() => {
          state.viewModel = id;
        })
    );
    renderModelCards();
    renderViewer();
    renderFrameStatus();
  }

  function markSelectedCard() {
    for (const card of el("ceuModelos").children) {
      card.classList.toggle("is-selected", state.viewLayer !== "photo" && card.dataset.model === state.viewModel);
    }
  }

  function renderViewer() {
    settleViewChoice();
    syncChoice(el("ceuVisorCamada"), state.viewLayer, () => true);
    const models = frameModels();
    el("ceuVisorModeloControl").hidden = state.viewLayer === "photo" || models.length < 2;
    syncChoice(el("ceuVisorModelo"), state.viewModel, (id) =>
      Boolean(
        modelMap(
          models.find((model) => model.id === id),
          state.viewLayer
        )
      )
    );
    markSelectedCard();
    renderOverlay();
    renderLayerNote();
  }

  function renderOverlay() {
    const container = el("ceuMediaBruto");
    const photo = container.querySelector(".sky-frame-photo");
    const meta = state.viewLayer === "photo" ? null : modelMap(viewedModel(), state.viewLayer);
    let overlay = container.querySelector(".sky-frame-overlay");
    const shown = Boolean(meta && photo);
    container.classList.toggle("is-layered", shown);
    el("ceuOpacidadeControl").hidden = !shown;
    if (!shown) {
      if (overlay) overlay.remove();
      return;
    }
    const url = mapUrl(meta);
    const alt = text(meta.alt_pt, state.viewLayer === "features" ? FEATURES_ALT : ATTRIBUTION_ALT);
    if (!overlay) {
      overlay = frameImage(url, alt, "sky-frame-image sky-frame-overlay");
      overlay.addEventListener("error", () => {
        overlay.remove();
        container.classList.remove("is-layered");
        el("ceuOpacidadeControl").hidden = true;
      });
      container.appendChild(overlay);
    } else {
      overlay.alt = alt;
      if (overlay.getAttribute("src") !== url) overlay.src = url;
    }
    applyOverlayOpacity();
  }

  function sensitivityScaleText(meta) {
    if (!finite(meta.full_strength_change)) return "maior";
    return meta.target === "kindex"
      ? decimal(meta.full_strength_change, 3)
      : withUnit(decimal(meta.full_strength_change, 1), dhiUnit());
  }

  function renderLayerNote() {
    const note = el("ceuCamadaNota");
    const scale = el("ceuEscala");
    scale.hidden = state.viewLayer !== "sensitivity";
    if (state.viewLayer === "features") {
      note.textContent = FEATURES_NOTE;
      return;
    }
    if (state.viewLayer !== "sensitivity") {
      note.textContent = PHOTO_NOTE;
      return;
    }
    const meta = modelMap(viewedModel(), "sensitivity") || {};
    const target = meta.target === "kindex" ? `o ${kindexLabel()} estimado` : "a estimativa de irradiância difusa";
    const parts = [`Cores mais claras marcam onde esconder um trecho da foto muda mais ${target}.`];
    if (meta.shared_scale === true) {
      parts.push(
        "Os dois modelos usam a mesma escala: um mapa mais apagado indica um modelo que depende menos da imagem."
      );
    }
    note.textContent = parts.join(" ");
    el("ceuEscalaMaximo").textContent = sensitivityScaleText(meta);
  }

  function capitalized(sentence) {
    return sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence;
  }

  function modelValue(list, term, value, className) {
    const row = node("div", className || null);
    const description = node("dd");
    description.append(value);
    row.append(node("dt", null, term), description);
    list.appendChild(row);
  }

  function irradianceValue(value) {
    const wrapper = node("span");
    wrapper.append(node("span", "clima-stat-value", decimal(value, 1)), " ", dhiUnit());
    return wrapper;
  }

  function modelCard(model) {
    const card = node("article", "theme-surface sky-model");
    card.dataset.model = model.id;
    const inputs = node("ul", "sky-model-inputs");
    inputs.setAttribute("aria-label", `Entradas do modelo ${modelLabel(model)}`);
    for (const input of Array.isArray(model.inputs) ? model.inputs : []) {
      inputs.appendChild(node("li", null, MODEL_INPUT_LABELS[input] || String(input)));
    }
    card.append(node("h4", "sky-model-name", modelLabel(model)), inputs);
    const prediction =
      model.available !== false && model.prediction && typeof model.prediction === "object" ? model.prediction : null;
    if (!prediction || !finite(prediction.dhi_w_m2)) {
      const reason = capitalized(text(model.reason_pt, "sem estimativa para este quadro").replace(/\.\s*$/, ""));
      card.appendChild(node("p", "sky-model-pending", `${reason}.`));
      return card;
    }
    const values = node("dl", "sky-model-values");
    modelValue(values, "Irradiância difusa", irradianceValue(prediction.dhi_w_m2), "sky-model-main");
    const condition = resolveCondition(state.framePayload, prediction.sky);
    if (condition) modelValue(values, "Condição do céu", conditionCell(condition));
    if (finite(prediction.kindex)) modelValue(values, capitalized(kindexLabel()), decimal(prediction.kindex, 3));
    const measured = model.measured || {};
    if (finite(measured.ghi_w_m2)) {
      modelValue(values, "Global medida na estação", withUnit(decimal(measured.ghi_w_m2, 0), dhiUnit()));
    }
    card.appendChild(values);
    return card;
  }

  function renderModelCards() {
    const container = el("ceuModelos");
    const models = frameModels();
    container.hidden = !models.length;
    container.replaceChildren(...models.map(modelCard));
    markSelectedCard();
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
        parts.push([`último quadro pontuado em ${formatStamp(latest)}`, ageNode(frame, info.latest_scored_at)]);
      }
      parts.push("as imagens são as últimas publicadas");
    } else {
      const captured = parseStationTime(frame.captured_at || "");
      if (Number.isFinite(captured)) {
        parts.push([`quadro capturado em ${formatStamp(captured)}`, ageNode(frame, frame.captured_at)]);
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
    status.replaceChildren(statusContent(parts, " · "));
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
        const entry = pointClass(point);
        return Boolean(entry) && !state.hidden.has(entry.id);
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
    { id: "points", label: POINTS.label },
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
    const hours = countNoun(cell.count, "hora", "horas");
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
        const entry = pointClass(point);
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
                const entry = pointClass(item.raw);
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
          : POINTS.hint
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
    return [state.framePayload, state.timelinePayload, state.chartPayload, state.cumulativePayload].filter(
      (payload) => payload && typeof payload === "object"
    );
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
    const timescale = TIMESCALE_NOTES[payload.timescale];
    if (timescale) parts.push(timescale.label);
    const start = parseStationTime(period.start || "");
    const end = parseStationTime(period.end || "");
    if (Number.isFinite(start) && Number.isFinite(end)) {
      parts.push(`${formatDay(start)} a ${formatDay(end)}`);
    }
    if (Number.isFinite(period.n)) parts.push(`${integer(period.n)} ${timescale ? timescale.unit : "registros"}`);
    el("ceuGraficoNota").textContent = parts.join(" · ");
    el("ceuPontosNota").textContent = pointsFileDeclared() ? POINTS.note(payload.points_file) : POINTS.missing;

    const filtersWrittenForReaders = Boolean(payload.points_file) && Array.isArray(payload.filters);
    const filters = filtersWrittenForReaders
      ? payload.filters.filter((filter) => typeof filter === "string" && filter.trim())
      : [];
    if (filters.length) {
      el("ceuFiltros").textContent =
        `Seleção e cálculo das horas, como o exportador os descreve: ${filters.join("; ")}.`;
    }

    const coverage = hoursOutsideDensityGrid();
    el("ceuForaDaGrade").textContent = coverage ? densityCoverageSentence(coverage) : "";
    el("ceuHorasCelulaCheia").textContent = densestCellHours();

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
      state.layers.has("density") && state.density
        ? `Densidade horária no plano do índice de claridade contra a fração difusa, com os limites das quatro condições de céu.`
        : `${POINTS.chartLabel} de ${decimal(shown, 0)} horas no plano do índice de claridade contra a fração difusa.`
    );
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
    const pointsMessage = pointsStatusMessage();
    if (pointsMessage) return pointsMessage;
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
        `O plano é cortado em células e cada uma é pintada pelo número de horas do acervo que caíram nela: quanto mais escura, mais horas. A escala é logarítmica porque a célula mais cheia concentra ${densestCellHours()} e as bordas têm uma ou duas.`
      );
    }
    if (pointsUsable()) {
      guideDefinition(list, `Camada ${POINTS.label}`, POINTS.guide);
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
          : "Um modelo que depende só de Kt é desenhado como curva sobre os pontos."
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

  function renderHeader() {
    const source = state.framePayload || state.timelinePayload;
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
  const BLOCK_STATUS_PT = { scored: "pontuado", skipped: "pulado", pending: "pendente", failed: "falhou" };
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
    if (finite(frames)) lines.push(`${countNoun(frames, "quadro", "quadros")} no bloco`);
    const source = state.timelinePayload.source;
    const origin = Array.isArray(source) ? sourceLabel(source[index]) : "";
    if (origin) lines.push(`fonte: ${origin}`);
    const elevation = at("solar_elevation_deg");
    if (finite(elevation)) lines.push(`sol a ${decimal(elevation, 1)}°`);
    if (at("extrapolation") === true) lines.push("acima da elevação máxima do treino (extrapolação)");
    return lines;
  }

  function predictionOnRawScale() {
    return state.timelinePayload?.label_scale !== CORRECTED_LABEL_SCALE;
  }

  function liveWithBlocks() {
    const live = state.timelinePayload && state.timelinePayload.live;
    return live && typeof live === "object" && finite(live.n_blocks) && live.n_blocks > 0 ? live : null;
  }

  function comparedWithStation(series) {
    return Boolean(series.measured) || liveWithBlocks() !== null;
  }

  function predictedDhiLabel(series, model) {
    const base = `${dhiLabel()} prevista`;
    const label = series.sensorDhi ? `${base}, ${model === "sensor" ? "imagem + sensores" : "só imagem"}` : base;
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
    if (series.sensorDhi) {
      datasets.push({
        label: predictedDhiLabel(series, "sensor"),
        data: series.sensorDhi,
        borderColor: theme.sensorModel,
        backgroundColor: theme.sensorModel,
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
    if (series.sensorDhi) {
      legendItem(list, { background: theme.sensorModel, height: "0.25rem" }, predictedDhiLabel(series, "sensor"));
    }
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
      parts.push([`Último bloco pontuado: ${formatStamp(stamp)}`, ageNode(payload, latest.last_scored_block)]);
    if (latest.last_block_status && latest.last_block_status !== "scored")
      parts.push(`estado do último bloco: ${BLOCK_STATUS_PT[latest.last_block_status] || latest.last_block_status}`);
    const labels = payload.reason_labels_pt || (payload.skipped && payload.skipped.reason_labels_pt) || {};
    if (latest.reason && latest.reason !== "fresh")
      parts.push(text(labels[latest.reason], REASON_PT[latest.reason] || latest.reason));
    return parts.length ? [statusContent(parts, " · "), "."] : "";
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
    return `A comparação com o piranômetro${source} está pendente: ${reason}.`;
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

  async function drawTimeline({ stripInSameTurn = false } = {}) {
    const token = ++state.timelineDrawToken;
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
      sensorDhi: timelinePoints("sensor_dhi_w_m2"),
      kindex: timelinePoints("kindex"),
    };
    drawTimelineChart(theme, bounds, runs, series);
    renderTimelineLegend(theme, runs, series);
    renderTimelineDays();
    renderTimelineStatus();
    if (!stripInSameTurn) {
      await afterNextPaint();
      if (token !== state.timelineDrawToken) return;
    }
    drawConditionStrip(theme, bounds, runs, series.kindex);
  }

  function renderTimelineStatus() {
    const payload = state.timelinePayload;
    el("ceuLinhaStatus").replaceChildren(
      statusContent([latestSentence(payload), skippedSummary(payload), measuredSentence(payload)].filter(Boolean), " ")
    );
  }

  async function loadJson(name, base = state.base) {
    let response;
    try {
      // Same name every run, so freshness is the request header's job.
      response = await fetch(`${base}/${name}`, { cache: "no-cache" });
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

  function afterNextPaint() {
    if (document.hidden) return new Promise((resolve) => setTimeout(resolve, 0));
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  async function paintInTurns(...steps) {
    for (const step of steps) {
      await afterNextPaint();
      await step();
    }
  }

  function repaintThemedControls() {
    buildClassToggles();
    buildModelToggles();
    renderModelCards();
  }

  function repaintForPrint() {
    state.themeDrawToken += 1;
    repaintThemedControls();
    drawChart();
    drawCumulative();
    drawTimeline({ stripInSameTurn: true });
  }

  async function onThemeChange() {
    const token = ++state.themeDrawToken;
    const current = () => token === state.themeDrawToken;
    repaintThemedControls();
    await paintInTurns(
      () => current() && drawChart(),
      () => current() && drawCumulative(),
      () => current() && drawTimeline()
    );
  }

  function applyChartPayload(chart) {
    state.chartPayload = chart.payload;
    state.chartStatus = chart.status;
    state.classes = resolveClasses(state.chartPayload);
    state.models = resolveModels(state.chartPayload);
    state.density = readDensity(state.chartPayload);
    invalidateVisiblePoints();
    if (!state.density) state.layers.delete("density");
    if (!state.density && pointsOffered()) state.layers.add("points");
    if (state.models.length) state.activeModels.add(state.models[0].id);
  }

  function buildCaveatsAndToggles() {
    buildCaveats();
    buildLayerToggles();
    buildClassToggles();
    buildModelToggles();
  }

  function refreshAges() {
    for (const age of el("ceuApp").querySelectorAll("[data-age-since]")) {
      const suffix = ageSuffix(Number(age.dataset.ageSince));
      if (age.textContent !== suffix) age.textContent = suffix;
    }
  }

  function frameAnnouncementKey() {
    const frame = state.framePayload;
    const info = (frame && frame.status) || {};
    return JSON.stringify([
      state.frameStatus,
      Boolean(frame),
      info.scored === false,
      info.reason,
      info.watch_alive === false,
      Boolean(frame && frame.solar && frame.solar.extrapolation === true),
      Boolean(clockOffsetText(info.camera_clock_drift_s)),
    ]);
  }

  function timelineAnnouncementKey() {
    const payload = state.timelinePayload;
    const latest = (payload && payload.latest) || {};
    const measured = (payload && payload.measured_status) || {};
    return JSON.stringify([
      state.timelineStatus,
      Boolean(payload && timelineBounds()),
      latest.last_block_status,
      latest.reason,
      measured.reason,
    ]);
  }

  function announceStatusChanges() {
    const announcements = [];
    for (const [id, key] of [
      ["ceuQuadroStatus", frameAnnouncementKey()],
      ["ceuLinhaStatus", timelineAnnouncementKey()],
    ]) {
      const changed = key !== state.announcedStatus.get(id);
      state.announcedStatus.set(id, key);
      const status = el(id).cloneNode(true);
      for (const age of status.querySelectorAll("[data-age-since]")) age.remove();
      const content = status.textContent;
      if (content && changed) announcements.push(node("p", null, content));
    }
    if (announcements.length) el("ceuAnuncio").replaceChildren(...announcements);
  }

  function publishedAnew(current, reply) {
    if (reply.status !== "ok" || !reply.payload) return false;
    const version = reply.payload.version;
    return typeof version !== "string" || !version || !current || version !== current.version;
  }

  async function recheckPayloads() {
    state.payloadsCheckedAt = Date.now();
    const [frame, timeline] = await Promise.all([loadJson(FRAME_PAYLOAD), loadJson(TIMELINE_PAYLOAD)]);
    const frameChanged = publishedAnew(state.framePayload, frame);
    const timelineChanged = publishedAnew(state.timelinePayload, timeline);
    if (!frameChanged && !timelineChanged) return;
    if (frameChanged) {
      state.framePayload = frame.payload;
      state.frameStatus = frame.status;
    }
    if (timelineChanged) {
      state.timelinePayload = timeline.payload;
      state.timelineStatus = timeline.status;
    }
    registerPayloadReferences();
    renderHeader();
    if (frameChanged) renderFrames();
    if (timelineChanged) await drawTimeline();
    buildCaveats();
    renderReferences();
    announceStatusChanges();
  }

  function refreshLiveView(recheckAfterMs) {
    if (document.hidden) return;
    refreshAges();
    if (Date.now() - state.payloadsCheckedAt >= recheckAfterMs) recheckPayloads();
  }

  function followPublications() {
    state.payloadsCheckedAt = Date.now();
    setInterval(() => refreshLiveView(PAYLOAD_RECHECK_INTERVAL_MS), AGE_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => refreshLiveView(PAYLOAD_RECHECK_MIN_GAP_MS));
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) refreshLiveView(PAYLOAD_RECHECK_MIN_GAP_MS);
    });
  }

  async function start() {
    const root = document.querySelector("[data-sky-base]");
    if (!root) return;
    state.base = (root.dataset.skyBase || "").replace(/\/$/, "");
    state.chartBase = RESEARCH_MODE ? `${state.base}/research` : state.base;
    if (RESEARCH_MODE) {
      el("ceuDispersaoResumo").textContent =
        `Na camada ${POINTS.label}, todas as horas selecionadas aparecem coloridas pela condição de céu, com a precisão original. Este é o modo local de pesquisa.`;
    }
    if (!state.base) {
      showEmpty("ceu", "Esta publicação ainda não declara um diretório de condição do céu.");
      return;
    }
    if (typeof Chart === "undefined") {
      showEmpty("ceu", "A biblioteca de gráficos não carregou.");
      return;
    }

    const chartRequest = loadJson(KTKD_PAYLOAD, state.chartBase);
    const [frame, timeline, cumulative] = await Promise.all([
      loadJson(FRAME_PAYLOAD),
      loadJson(TIMELINE_PAYLOAD),
      loadJson(CUMULATIVE_PAYLOAD, state.chartBase),
    ]);
    state.chartStatus = "loading";
    state.framePayload = frame.payload;
    state.frameStatus = frame.status;
    state.timelinePayload = timeline.payload;
    state.timelineStatus = timeline.status;
    state.cumulativePayload = cumulative.payload;
    state.cumulativeStatus = cumulative.status;
    state.classes = resolveClasses(null);

    // Before anything renders text: a payload bibliography has to be in the registry for the markers in its own
    // caveats to expand into citations instead of staying literal.
    registerPayloadReferences();

    renderHeader();
    renderFrames();
    buildCaveatsAndToggles();
    el("ceuOpacidade").addEventListener("input", applyOverlayOpacity);
    el("ceuGuia").addEventListener("click", openGuide);
    el("ceuAmpliar").addEventListener("click", openZoom);

    initCumulative();
    el("ceuEmpty").hidden = true;
    el("ceuApp").hidden = false;
    window.addEventListener("labmim-theme-change", onThemeChange);
    window.addEventListener("labmim-print-change", (event) => {
      if (!event.detail.paletteChanged) return;
      if (event.detail.printing) repaintForPrint();
      else onThemeChange();
    });
    await paintInTurns(
      async () => {
        await drawTimeline();
        announceStatusChanges();
      },
      renderReferences,
      drawChart,
      () => {
        drawCumulative();
        followPublications();
      },
      async () => {
        applyChartPayload(await chartRequest);
        if (state.layers.has("points")) ensurePoints();
        registerPayloadReferences();
        renderHeader();
        buildCaveatsAndToggles();
        renderReferences();
        drawChart();
        settleEmptyState();
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
