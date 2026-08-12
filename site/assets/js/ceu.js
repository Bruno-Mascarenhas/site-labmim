/**
 * Sky-condition page: reads `labmim-sky-v1` from `data-sky-base` and draws the
 * all-sky frame, the segmentation mask predicted over it, and the clearness
 * index against the diffuse fraction.
 *
 * Contracts:
 *
 * - Nothing is computed here. Kt and Kd arrive already paired from the Python
 *   exporter; the only derivation is the sky class, which is a threshold lookup
 *   on Kt and exists to colour the cloud.
 * - The two frames keep FIXED names and are rewritten in place, so freshness
 *   travels in the query string rather than in the file name.
 * - The payload format is still provisional: `readPoints` accepts both the
 *   object and the positional shape so a change in the exporter does not blank
 *   the chart.
 * - The directory holds operational data: empty in a dev checkout and in CI,
 *   where the page has to say so instead of breaking.
 */

"use strict";

(function () {
  const RAW_FRAME = "allsky.jpg";
  const MASK_FRAME = "mask.png";
  const PAYLOAD = "ceu.json";

  /**
   * Escobedo, J. F., Gomes, E. N., Oliveira, A. P. & Soares, J. (2009), Applied
   * Energy 86(3), 299-309, section 3.1: four sky conditions as intervals of the
   * clearness index, upper bound inclusive. Portuguese wording from Teramoto,
   * E. T. & Escobedo, J. F. (2012), RBEAA 16(9), 985-992.
   *
   * The asymmetry in III is the literature's own: the English names the direct
   * component, the Portuguese names the clear sky it produces.
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

  // The same hues the monitoring and climatology pages use, so a reader moving
  // between the three pages does not have to relearn the palette. Ordering is
  // carried by the Kt axis, not by the colours.
  const PALETTE = {
    light: { i: "#64748b", ii: "#3761b4", iii: "#1a7f5a", iv: "#e07a1f" },
    dark: { i: "#94a3b8", ii: "#5589e6", iii: "#31a37a", iv: "#cb8030" },
  };

  /**
   * Erbs, D. G., Klein, S. A. & Duffie, J. A. (1982), Solar Energy 28(4),
   * 293-302, eqn. (1), in Horner form. Above Kt = 0.80 the value is a constant
   * the authors CHOSE rather than fitted, following Orgill and Hollands.
   */
  function erbs(kt) {
    if (kt <= 0.22) return 1 - 0.09 * kt;
    if (kt <= 0.8) return 0.9511 + kt * (-0.1604 + kt * (4.388 + kt * (-16.638 + kt * 12.336)));
    return 0.165;
  }

  /** Orgill, J. F. & Hollands, K. G. T. (1977), Solar Energy 19(4), 357-359. */
  function orgillHollands(kt) {
    if (kt < 0.35) return 1 - 0.249 * kt;
    if (kt <= 0.75) return 1.557 - 1.84 * kt;
    return 0.177;
  }

  const CURVES = [
    { id: "none", label: "Nenhuma", fn: null },
    { id: "erbs", label: "Erbs", fn: erbs, credit: "Erbs, Klein e Duffie (1982)" },
    { id: "orgill", label: "Orgill e Hollands", fn: orgillHollands, credit: "Orgill e Hollands (1977)" },
  ];

  // The boundary between conditions II and III is DEFINED where the diffuse
  // component equals the direct one, which on the surface is half the global:
  // the horizontal line and the vertical one meet by construction.
  const DIFFUSE_PARITY = 0.5;

  // Frames are rewritten under the same name, so without a stamp the browser
  // would serve the copy it already holds. Five minutes is finer than any
  // plausible capture interval and coarse enough not to defeat the cache.
  const FRAME_BUCKET_MS = 300000;

  const state = {
    base: "",
    payload: null,
    points: [],
    hidden: new Set(),
    curveId: "erbs",
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

  // The exporter may name the predicted class as an id, a Roman numeral or a
  // 1-based index; none of the three is wrong, and the page reads all of them.
  function declaredClass(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().toLowerCase();
    const index = Number.parseInt(text, 10);
    if (Number.isInteger(index) && index >= 1 && index <= SKY_CLASSES.length) return SKY_CLASSES[index - 1];
    return SKY_CLASSES.find((entry) => entry.id === text || entry.roman.toLowerCase() === text) || null;
  }

  // The rejected count is kept because "no pairs" has two very different causes:
  // a payload that declares none, and one whose pairs all arrived unreadable —
  // numbers serialised as strings, say. Only the second is a pipeline bug.
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
      points.push({ x: kt, y: kd, t: typeof stamp === "string" ? stamp : "" });
    }
    return { points, rejected };
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

  // Both frames absent AND no payload is the state of every dev checkout and of
  // CI: showing two placeholders and an empty chart there would read as a broken
  // page rather than as data that simply has not been deployed.
  function settleEmptyState() {
    if (state.framesMissing < 2 || state.payload) return;
    showEmpty(
      "Os dados de condição do céu ainda não foram publicados para esta estação. " +
        "Eles são anexados ao site no deploy, separadamente das páginas."
    );
  }

  // The mask panel carries the raw frame underneath it, so lowering the opacity
  // reads the segmentation against the pixels it was predicted from.
  function applyMaskOpacity() {
    const mask = el("ceuMediaMascara").querySelector(".sky-frame-mask");
    if (!mask) return;
    mask.style.opacity = String(Number(el("ceuOpacidade").value) / 100);
  }

  function buildSegmented(container, entries, isActive, onPick) {
    container.replaceChildren();
    for (const entry of entries) {
      const button = node("button", "clima-segmented-btn", entry.label);
      button.type = "button";
      const active = isActive(entry);
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
      button.addEventListener("click", () => {
        onPick(entry);
        for (let index = 0; index < container.children.length; index += 1) {
          const sibling = container.children[index];
          const on = isActive(entries[index]);
          sibling.setAttribute("aria-pressed", String(on));
          sibling.classList.toggle("is-active", on);
        }
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

  // Neither axis is pinned to [0, 1]. Cloud enhancement puts real Kt past 1, and
  // Kd is a ratio between two instruments, so it lands outside the interval at
  // low sun and under broken cloud. A fixed scale would hide exactly those
  // points while the caption and the CSV went on counting them.
  // The Kd floor is 1.1 rather than 1: the overcast class piles up against
  // Kd = 1, and a ceiling there presses the densest part of the cloud into the
  // top edge. The legacy exporter keeps observations up to Kd = 1.2, so the
  // headroom is also where real points land.
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

  function curveDataset(theme, bounds) {
    const curve = CURVES.find((entry) => entry.id === state.curveId);
    if (!curve || !curve.fn) return null;
    const data = [];
    for (let step = 0; step <= 100; step += 1) {
      const kt = (step / 100) * bounds.ktMax;
      data.push({ x: kt, y: curve.fn(kt) });
    }
    return {
      type: "line",
      label: curve.label,
      data,
      borderColor: theme.textSecondary,
      backgroundColor: theme.textSecondary,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
      order: 1,
    };
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

  // The class boundaries and the diffuse-parity line are the plot's reference
  // frame, not data: drawn under the cloud so no point is hidden by them.
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

  // The inline chart draws no legend of its own: the chips under the frames name
  // the four conditions and the buttons beside the canvas repeat them a second
  // time. The zoom dialog carries neither, so there the legend comes back.
  function chartConfig(theme, { radius = 2.4, legend = false } = {}) {
    const bounds = axisBounds();
    const datasets = classDatasets(theme, radius);
    const curve = curveDataset(theme, bounds);
    if (curve) datasets.push(curve);
    return {
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        // `intersect: false` because the cloud is dense and the marks are small:
        // requiring the cursor to land ON a dot makes the tooltip unreachable.
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
            // Fixed step rather than a tick budget: on a 0-1,1 range Chart.js
            // picks 0 / 0,5 / 1 / 1,1 and crowds the last two together.
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
    const curve = CURVES.find((entry) => entry.id === state.curveId);
    const timescale = state.payload && state.payload.ktkd ? state.payload.ktkd.timescale : null;
    const parts = [];
    if (timescale) parts.push(timescale);
    parts.push(`${decimal(shown, 0)} de ${decimal(state.points.length, 0)} pares visíveis`);
    if (curve && curve.fn) parts.push(`curva de ${curve.credit}`);
    el("ceuGraficoNota").textContent = parts.join(" · ");
    el("ceuCanvas").setAttribute(
      "aria-label",
      `Dispersão de ${decimal(shown, 0)} pares de índice de claridade e fração difusa, coloridos pelas quatro condições de céu. Use o botão CSV para a versão textual.`
    );
    // Both actions go with the drawing: zooming an empty plane and downloading
    // an empty file are the same non-event, and a click that does nothing is
    // indistinguishable from one the browser blocked.
    el("ceuExport").disabled = shown === 0;
    el("ceuAmpliar").disabled = shown === 0;
  }

  // Four ways to have nothing to draw, and the operator needs to know which:
  // only the third names a defect in the published document.
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
    // Keyed on the points, not on `datasets.length`: the reference curve is a
    // dataset too, so counting it would open a modal showing a lone curve over
    // an empty plane and never reach the message written for this case.
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
  // box under a 4:3 frame would put the mask and the pixels it was predicted
  // from at different scales — and the fade would compare misregistered images
  // without saying so. The CSS square is only the pre-load placeholder.
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
   * A missing payload is not a missing page: the frames are published
   * independently of it, and the chart says so on its own line.
   *
   * Absence and unreadability stay apart, as in monitoramento.js: a 404 means
   * the file was never deployed, while a 200 cut in half is the normal state
   * during an upload — and telling the operator to go publish a file that is
   * already on the server sends them hunting for nothing.
   */
  async function loadPayload() {
    let response;
    try {
      // No `?v=`: the file is rewritten under the same name, so freshness is
      // decided by the request header, not by the URL.
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
    buildSegmented(
      el("ceuCurva"),
      CURVES,
      (entry) => entry.id === state.curveId,
      (entry) => {
        state.curveId = entry.id;
        drawChart();
      }
    );

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
