/**
 * Sky-condition page: reads `labmim-sky-v1` from `data-sky-base`.
 *
 * Kt and Kd arrive paired from the Python exporter and nothing is recomputed
 * here. The payload format is still provisional, hence the tolerant reader. The
 * two frames keep FIXED names and are rewritten in place. The directory is
 * deploy-only: empty in a dev checkout and in CI, where the page says so.
 */

"use strict";

(function () {
  const RAW_FRAME = "allsky.jpg";
  const MASK_FRAME = "mask.png";
  const PAYLOAD = "ceu.json";

  /**
   * Escobedo et al. (2009), Applied Energy 86(3), 299-309, §3.1: four sky
   * conditions as intervals of the clearness index, upper bound inclusive.
   * Portuguese wording from Teramoto & Escobedo (2012), RBEAA 16(9), 985-992,
   * where III names the clear sky the direct component produces.
   */
  const SKY_CLASSES = [
    {
      id: "i",
      roman: "I",
      label: "Nebuloso",
      full: "Condição de céu I, nebuloso",
      range: "Kt ≤ 0,35",
      max: 0.35,
    },
    {
      id: "ii",
      roman: "II",
      label: "Parc. nebuloso — difuso",
      full: "Condição de céu II, parcialmente nebuloso com dominância para o difuso",
      range: "0,35 < Kt ≤ 0,55",
      max: 0.55,
    },
    {
      id: "iii",
      roman: "III",
      label: "Parc. nebuloso — claro",
      full: "Condição de céu III, parcialmente nebuloso com dominância para o claro",
      range: "0,55 < Kt ≤ 0,65",
      max: 0.65,
    },
    {
      id: "iv",
      roman: "IV",
      label: "Claro",
      full: "Condição de céu IV, claro",
      range: "Kt > 0,65",
      max: Infinity,
    },
  ];

  const PALETTE = {
    light: { i: "#64748b", ii: "#3761b4", iii: "#1a7f5a", iv: "#e07a1f" },
    dark: { i: "#94a3b8", ii: "#5589e6", iii: "#31a37a", iv: "#cb8030" },
  };

  const MODEL_PALETTE = {
    light: { marquesfh: "#7c3aa8", lemos: "#c2185b", ridley: "#0e7490" },
    dark: { marquesfh: "#c08ae0", lemos: "#f06292", ridley: "#4dd0e1" },
  };

  /**
   * Marques Filho, E. P. et al. (2016), Renewable Energy 91, 64-74, Table 3:
   * Kd = 0,13 + 0,86 / (1 + exp(-6,29 + 12,26 Kt)), fitted to hourly averages
   * over 0 ≤ Kt ≤ 1 in Rio de Janeiro.
   */
  function marquesFilho(kt) {
    return 0.13 + 0.86 / (1 + Math.exp(-6.29 + 12.26 * kt));
  }

  // Published domain of the fit; past it the curve would be extrapolation.
  const MARQUES_FILHO_MAX_KT = 1;

  /**
   * Lemos et al. (2017), Renewable Energy 108, 569-580, and the BRL of Ridley,
   * Boland & Lauret (2010), Renewable Energy 35(2), 478-483, are logistics in
   * five predictors the page does not hold, so they arrive evaluated per
   * observation and are drawn as a cloud: at a fixed Kt they take a range.
   */
  const MODELS = [
    { id: "marquesfh", label: "Marques Filho", fn: marquesFilho, credit: "Marques Filho et al. (2016)" },
    { id: "lemos", label: "Lemos", key: "lemos", mark: "crossRot", credit: "Lemos et al. (2017)" },
    { id: "ridley", label: "BRL", key: "ridley", mark: "cross", credit: "Ridley, Boland e Lauret (2010)" },
  ];

  // Condition II ends where the diffuse component equals the direct one, which
  // on the surface is half the global: this line and Kt = 0,55 meet by definition.
  const DIFFUSE_PARITY = 0.5;

  // Same file name every capture, so without a stamp the browser serves the copy
  // it holds. Finer than any plausible capture interval, coarse enough to cache.
  const FRAME_BUCKET_MS = 300000;

  const state = {
    base: "",
    payload: null,
    points: [],
    hidden: new Set(),
    models: new Set(["marquesfh"]),
    chart: null,
    framesMissing: 0,
    payloadStatus: "absent",
    rejected: 0,
  };

  const el = (id) => document.getElementById(id);

  function decimal(value, digits) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
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

  function formatStamp(ms) {
    const date = new Date(ms);
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  function isDark() {
    return document.documentElement.classList.contains("dark-theme");
  }

  function themeColors() {
    const root = getComputedStyle(document.documentElement);
    return {
      classes: isDark() ? PALETTE.dark : PALETTE.light,
      models: isDark() ? MODEL_PALETTE.dark : MODEL_PALETTE.light,
      textSecondary: root.getPropertyValue("--text-secondary").trim() || "#888",
      legendText: root.getPropertyValue("--chart-legend-color").trim() || "#666",
      grid: root.getPropertyValue("--chart-grid-color").trim() || "#f0f0f0",
      tooltipBg: root.getPropertyValue("--tooltip-bg").trim() || "rgba(18, 18, 18, 0.96)",
      tooltipText: root.getPropertyValue("--tooltip-text").trim() || "#fff",
      guide: isDark() ? "rgba(255, 255, 255, 0.34)" : "rgba(0, 0, 0, 0.26)",
    };
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function classOf(kt) {
    return SKY_CLASSES.find((entry) => kt <= entry.max) || SKY_CLASSES[SKY_CLASSES.length - 1];
  }

  // Id, Roman numeral or 1-based index: none is wrong, so all three are read.
  function declaredClass(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().toLowerCase();
    const index = Number.parseInt(text, 10);
    if (Number.isInteger(index) && index >= 1 && index <= SKY_CLASSES.length) return SKY_CLASSES[index - 1];
    return SKY_CLASSES.find((entry) => entry.id === text || entry.roman.toLowerCase() === text) || null;
  }

  function readPoints(payload) {
    const raw = (payload && payload.ktkd && payload.ktkd.points) || (payload && payload.points);
    if (!Array.isArray(raw)) return { points: [], rejected: 0 };
    const points = [];
    let rejected = 0;
    for (const entry of raw) {
      const positional = Array.isArray(entry);
      const kt = positional ? entry[0] : entry && entry.kt;
      const kd = positional ? entry[1] : entry && entry.kd;
      const stamp = positional ? entry[2] : entry && entry.t;
      if (!Number.isFinite(kt) || !Number.isFinite(kd)) {
        rejected += 1;
        continue;
      }
      const models = !positional && entry.models && typeof entry.models === "object" ? entry.models : null;
      points.push({ x: kt, y: kd, t: typeof stamp === "string" ? stamp : "", models });
    }
    return { points, rejected };
  }

  function modelPoints(key) {
    const data = [];
    for (const point of state.points) {
      const value = point.models ? point.models[key] : undefined;
      if (Number.isFinite(value)) data.push({ x: point.x, y: value });
    }
    return data;
  }

  function frameToken() {
    const captured = state.payload && state.payload.frame ? state.payload.frame.captured_at : null;
    const parsed = parseStationTime(captured || "");
    if (Number.isFinite(parsed)) return String(parsed);
    return String(Math.floor(Date.now() / FRAME_BUCKET_MS));
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
    if (state.framesMissing < 2 || state.payload) return;
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

  function buildModelToggles() {
    const colors = themeColors().models;
    const container = el("ceuCurva");
    container.replaceChildren();
    for (const model of MODELS) {
      const button = node("button", "clima-segmented-btn sky-class-btn");
      button.type = "button";
      button.title = model.fn
        ? `${model.credit} — curva, função apenas de Kt`
        : `${model.credit} — um valor por observação, vindo do payload`;
      const swatch = node("span", model.fn ? "sky-swatch sky-swatch-curve" : "sky-swatch");
      swatch.style.background = colors[model.id];
      button.appendChild(swatch);
      button.appendChild(node("span", null, model.label));
      const active = state.models.has(model.id);
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
      button.addEventListener("click", () => {
        if (state.models.has(model.id)) state.models.delete(model.id);
        else state.models.add(model.id);
        const on = state.models.has(model.id);
        button.setAttribute("aria-pressed", String(on));
        button.classList.toggle("is-active", on);
        drawChart();
      });
      container.appendChild(button);
    }
  }

  function buildClassToggles() {
    const colors = themeColors().classes;
    const container = el("ceuClasses");
    container.replaceChildren();
    for (const entry of SKY_CLASSES) {
      const button = node("button", "clima-segmented-btn sky-class-btn");
      button.type = "button";
      button.title = entry.full;
      const swatch = node("span", "sky-swatch");
      swatch.style.background = colors[entry.id];
      button.appendChild(swatch);
      button.appendChild(node("span", null, `${entry.roman} · ${entry.label}`));
      const active = !state.hidden.has(entry.id);
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
      button.addEventListener("click", () => {
        if (state.hidden.has(entry.id)) state.hidden.delete(entry.id);
        else state.hidden.add(entry.id);
        const on = !state.hidden.has(entry.id);
        button.setAttribute("aria-pressed", String(on));
        button.classList.toggle("is-active", on);
        drawChart();
      });
      container.appendChild(button);
    }
  }

  function buildLegend() {
    const colors = themeColors().classes;
    const list = el("ceuLegenda");
    list.replaceChildren();
    for (const entry of SKY_CLASSES) {
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

  function visiblePoints() {
    return state.points.filter((point) => !state.hidden.has(classOf(point.x).id));
  }

  // Neither axis is pinned to [0, 1]: cloud enhancement puts real Kt past 1 and
  // Kd, a ratio between two instruments, leaves the interval at low sun — a fixed
  // scale would hide those while the caption and the CSV counted them. The Kd
  // floor is 1.1 because the overcast class piles up against 1.
  function axisBounds() {
    let ktMax = 1;
    let kdMin = 0;
    let kdMax = 1.1;
    for (const point of state.points) {
      ktMax = Math.max(ktMax, point.x);
      kdMin = Math.min(kdMin, point.y);
      kdMax = Math.max(kdMax, point.y);
    }
    return {
      ktMax: Math.ceil(ktMax * 10) / 10,
      kdMin: Math.floor(kdMin * 10) / 10,
      kdMax: Math.ceil(kdMax * 10) / 10,
    };
  }

  function activeModels() {
    return MODELS.filter((entry) => state.models.has(entry.id));
  }

  function modelDatasets(theme, radius) {
    const datasets = [];
    for (const model of activeModels()) {
      const color = theme.models[model.id];
      if (model.fn) {
        const data = [];
        for (let step = 0; step <= 100; step += 1) {
          const kt = (step / 100) * MARQUES_FILHO_MAX_KT;
          data.push({ x: kt, y: model.fn(kt) });
        }
        datasets.push({
          type: "line",
          label: model.credit,
          data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2.5,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
          order: 1,
        });
        continue;
      }
      const data = modelPoints(model.key);
      if (!data.length) continue;
      datasets.push({
        type: "line",
        label: model.credit,
        data,
        borderColor: "transparent",
        backgroundColor: color,
        borderWidth: 0,
        showLine: false,
        pointStyle: model.mark,
        pointBorderColor: color,
        pointBorderWidth: 1,
        pointRadius: radius + 0.6,
        pointHoverRadius: radius + 3,
        normalized: true,
        order: 1,
      });
    }
    return datasets;
  }

  function classDatasets(theme, radius) {
    const grouped = new Map(SKY_CLASSES.map((entry) => [entry.id, []]));
    for (const point of state.points) grouped.get(classOf(point.x).id).push(point);
    const datasets = [];
    for (const entry of SKY_CLASSES) {
      const data = grouped.get(entry.id);
      if (!data.length || state.hidden.has(entry.id)) continue;
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
    return datasets;
  }

  // Reference frame, not data: drawn under the cloud so no point is hidden.
  const guides = {
    id: "labmimSkyGuides",
    beforeDatasetsDraw(instance, _args, options) {
      const { ctx, chartArea, scales } = instance;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = options.color;
      ctx.setLineDash([4, 4]);
      for (const entry of SKY_CLASSES) {
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

  // No inline legend: the chips and the toggles already name the conditions
  // twice. The zoom dialog carries neither, so there it comes back.
  function chartConfig(theme, { radius = 2.4, legend = false } = {}) {
    const bounds = axisBounds();
    const datasets = classDatasets(theme, radius);
    datasets.push(...modelDatasets(theme, radius));
    return {
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        // The cloud is dense and the marks small: requiring the cursor to land
        // ON a dot makes the tooltip unreachable.
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          labmimSkyGuides: { color: theme.guide },
          legend: {
            display: legend,
            position: "top",
            labels: { color: theme.legendText, boxWidth: 26 },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.classes.ii,
            borderWidth: 1,
            callbacks: {
              title: (items) => {
                const stamp = parseStationTime(items[0].raw.t || "");
                return Number.isFinite(stamp) ? formatStamp(stamp) : items[0].dataset.label;
              },
              label: (item) => `Kt ${decimal(item.parsed.x, 3)} · Kd ${decimal(item.parsed.y, 3)}`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
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

  function syncChartText() {
    const shown = visiblePoints().length;
    const timescale = state.payload && state.payload.ktkd ? state.payload.ktkd.timescale : null;
    const parts = [];
    if (timescale) parts.push(timescale);
    parts.push(`${decimal(shown, 0)} de ${decimal(state.points.length, 0)} pares visíveis`);
    for (const model of activeModels()) {
      if (model.fn) {
        parts.push(`curva de ${model.credit}`);
        continue;
      }
      const modelled = modelPoints(model.key).length;
      parts.push(
        modelled ? `${decimal(modelled, 0)} valores de ${model.credit}` : `${model.credit} ainda não vem no payload`
      );
    }
    el("ceuGraficoNota").textContent = parts.join(" · ");
    el("ceuCanvas").setAttribute(
      "aria-label",
      `Dispersão de ${decimal(shown, 0)} pares de índice de claridade e fração difusa, coloridos pelas quatro condições de céu. Use o botão CSV para a versão textual.`
    );
    el("ceuExport").disabled = shown === 0;
    el("ceuAmpliar").disabled = shown === 0;
  }

  function nothingToDrawMessage() {
    if (state.points.length) return "Nenhuma condição de céu selecionada — ative pelo menos uma acima.";
    if (state.payloadStatus === "unreadable") {
      return "O payload de Kt × Kd chegou incompleto ou ilegível; ele pode estar sendo publicado neste momento.";
    }
    if (state.rejected) {
      return `O payload de Kt × Kd foi publicado, mas nenhum dos ${decimal(state.rejected, 0)} pares traz Kt e Kd numéricos.`;
    }
    if (state.payloadStatus === "ok") return "O documento publicado não declara nenhum par de Kt × Kd.";
    return "O payload de Kt × Kd ainda não foi publicado — os quadros acima continuam válidos.";
  }

  function drawChart() {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    syncChartText();
    if (!visiblePoints().length) {
      el("ceuStatus").textContent = nothingToDrawMessage();
      return;
    }
    el("ceuStatus").textContent =
      "A linha horizontal marca Kd = 0,5, onde a componente difusa iguala a direta; as verticais são os limites entre as condições de céu.";
    const config = chartConfig(themeColors());
    state.chart = new Chart(el("ceuCanvas").getContext("2d"), { type: "line", ...config, plugins: [guides] });
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
    // Keyed on the points, not on `datasets.length`: a model is a dataset too,
    // so counting it would open a modal on a lone curve over an empty plane.
    if (visiblePoints().length) {
      const config = chartConfig(themeColors(), { radius: 3.4, legend: true });
      instance = new Chart(canvas.getContext("2d"), { type: "line", ...config, plugins: [guides] });
    } else {
      wrap.appendChild(node("p", "monitor-pending", nothingToDrawMessage()));
    }
  }

  const EXCEL_UTF8_BOM = "\ufeff";

  function exportCsv() {
    const points = visiblePoints();
    if (!points.length) return;
    const rows = ["instante;kt;kd;condicao"];
    for (const point of points) {
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
          `${entry.roman} - ${entry.label}`,
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

  // `object-fit: contain` letterboxes each layer by its OWN ratio, so a square
  // box under a 4:3 frame would fade the mask over misregistered pixels.
  function fitFrameBoxes(image) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const ratio = `${image.naturalWidth} / ${image.naturalHeight}`;
    el("ceuMediaBruto").style.aspectRatio = ratio;
    el("ceuMediaMascara").style.aspectRatio = ratio;
  }

  function renderFrames() {
    const raw = buildFrame(
      el("ceuMediaBruto"),
      RAW_FRAME,
      "Quadro bruto da câmera all-sky",
      el("ceuNotaBruto"),
      "Quadro ainda não publicado."
    );
    raw.addEventListener("load", () => fitFrameBoxes(raw));

    const container = el("ceuMediaMascara");
    const mask = buildFrame(
      container,
      MASK_FRAME,
      "Máscara de segmentação prevista sobre o quadro all-sky",
      el("ceuNotaMascara"),
      "Máscara ainda não publicada."
    );
    mask.classList.add("sky-frame-mask");
    const underlay = frameImage(RAW_FRAME, "", "sky-frame-image");
    underlay.setAttribute("aria-hidden", "true");
    underlay.addEventListener("error", () => underlay.remove());
    container.insertBefore(underlay, mask);
    applyMaskOpacity();

    const frame = (state.payload && state.payload.frame) || {};
    const captured = parseStationTime(frame.captured_at || "");
    el("ceuNotaBruto").textContent = Number.isFinite(captured) ? `Capturado em ${formatStamp(captured)}` : "";

    const predicted = declaredClass(frame.class);
    const notes = [];
    if (predicted) notes.push(`Condição prevista: ${predicted.roman} · ${predicted.label}`);
    if (Number.isFinite(frame.cloud_fraction)) {
      notes.push(`cobertura de nuvens ${decimal(frame.cloud_fraction * 100, 0)}%`);
    }
    el("ceuNotaMascara").textContent = notes.join(" — ");
  }

  function renderHeader() {
    const generated = parseStationTime((state.payload && state.payload.generated_utc) || "");
    el("ceuAtualizado").textContent = Number.isFinite(generated) ? `Publicado em ${formatStamp(generated)} UTC` : "";
  }

  /**
   * A missing payload is not a missing page: the frames publish independently.
   * Absence and unreadability stay apart, as in monitoramento.js — a 200 cut in
   * half is the normal state during an upload, not a file yet to be deployed.
   */
  async function loadPayload() {
    let response;
    try {
      // Same name every run, so freshness is the request header's job.
      response = await fetch(`${state.base}/${PAYLOAD}`, { cache: "no-cache" });
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
    buildLegend();
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
    const loaded = await loadPayload();
    state.payload = loaded.payload;
    state.payloadStatus = loaded.status;
    const read = readPoints(state.payload);
    state.points = read.points;
    state.rejected = read.rejected;

    renderHeader();
    renderFrames();
    buildLegend();
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
