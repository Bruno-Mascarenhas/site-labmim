/**
 * Controller for the climatology page: reads the `labmim-climatology-v1` artifacts from the directory named in the
 * `data-climatology-base` attribute.
 *
 * Nothing is computed here. Bins, fit, theoretical curve and goodness-of-fit arrive ready from the Python exporter
 * (`labmim-climatology`), curve already rescaled by one minus the atom mass; a second numerical path in JavaScript
 * would be free to diverge from the parameters printed beside it. The curve is sampled AT THE BIN CENTERS, one value
 * per bar, so bars and line share one categorical axis with no interpolation — logarithmic rainfall bins included.
 *
 * Nothing is publication-specific: every label comes from the JSON. The directory holds operational data, so in a
 * development checkout and in CI it is empty and the page has to say so instead of breaking.
 */

"use strict";

(function () {
  // Pairs validated with scripts/validate_palette.js: luminance band, chroma floor, colour-blind separation and
  // contrast against the surface. Changing a value means running the validator again.
  const PALETTE = {
    light: { empirical: "#3761b4", model: "#d9741c" },
    dark: { empirical: "#5589e6", model: "#cb8030" },
  };

  const ROSE_RINGS = 4;
  const COMPASS = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];

  // Without it Excel in pt-BR opens the CSV as Latin-1 and the accented labels reach the researcher corrupted.
  const EXCEL_UTF8_BOM = "\uFEFF";

  const state = {
    base: "",
    manifest: null,
    variable: null,
    variableId: "",
    subsetId: "",
    chart: null,
    cache: new Map(),
    seq: 0,
  };

  const el = (id) => document.getElementById(id);

  function decimal(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  function integer(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("pt-BR").format(Math.round(value));
  }

  function percent(fraction, digits = 1) {
    if (fraction === null || fraction === undefined) return "—";
    return `${decimal(fraction * 100, digits)}%`;
  }

  function digitsToDistinguishBins(edges) {
    let smallest = Infinity;
    for (let index = 1; index < edges.length; index += 1) {
      smallest = Math.min(smallest, edges[index] - edges[index - 1]);
    }
    if (!Number.isFinite(smallest) || smallest <= 0) return 2;
    return Math.max(0, Math.min(3, Math.ceil(-Math.log10(smallest))));
  }

  // Chart.js keeps nothing from the CSS, so re-reading the tokens when the theme class flips is enough — the same
  // runtime read as charts-manager.js.

  function isDark() {
    return document.documentElement.classList.contains("dark-theme");
  }

  function themeColors() {
    const root = getComputedStyle(document.documentElement);
    const series = isDark() ? PALETTE.dark : PALETTE.light;
    return {
      empirical: series.empirical,
      model: series.model,
      textSecondary: root.getPropertyValue("--text-secondary").trim() || "#888",
      legendText: root.getPropertyValue("--chart-legend-color").trim() || "#666",
      grid: root.getPropertyValue("--chart-grid-color").trim() || "#f0f0f0",
      tooltipBg: root.getPropertyValue("--tooltip-bg").trim() || "rgba(18, 18, 18, 0.96)",
      tooltipText: root.getPropertyValue("--tooltip-text").trim() || "#fff",
    };
  }

  function dataUrl(file) {
    const version = state.manifest ? `?v=${encodeURIComponent(state.manifest.version)}` : "";
    return `${state.base}/${file}${version}`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function loadVariable(id) {
    if (state.cache.has(id)) return state.cache.get(id);
    const entry = state.manifest.variables.find((item) => item.id === id);
    const payload = await fetchJson(dataUrl(entry.file));
    state.cache.set(id, payload);
    return payload;
  }

  function currentSubset() {
    if (!state.variable) return null;
    return state.variable.subsets[state.subsetId] || null;
  }

  function subsetLabel(id) {
    const entry = state.manifest.subsets.find((item) => item.id === id);
    return entry ? entry.label : id;
  }

  function buildControls() {
    const select = el("climaVariavel");
    select.replaceChildren();
    for (const variable of state.manifest.variables) {
      const option = document.createElement("option");
      option.value = variable.id;
      option.textContent = variable.unit ? `${variable.label} (${variable.unit})` : variable.label;
      select.appendChild(option);
    }
    select.value = state.variableId;
    select.addEventListener("change", () => {
      state.variableId = select.value;
      refresh();
    });

    const group = el("climaRecorte");
    group.replaceChildren();
    for (const id of state.manifest.selector) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clima-segmented-btn";
      button.dataset.subset = id;
      button.textContent = subsetLabel(id);
      button.setAttribute("aria-pressed", String(id === state.subsetId));
      button.addEventListener("click", () => {
        state.subsetId = id;
        markActiveSubset();
        refresh();
      });
      group.appendChild(button);
    }

    el("climaExport").addEventListener("click", exportCsv);
  }

  function markActiveSubset() {
    for (const button of el("climaRecorte").children) {
      const active = button.dataset.subset === state.subsetId;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    }
  }

  function binLabels(edges, digits) {
    const labels = [];
    for (let index = 1; index < edges.length; index += 1) {
      labels.push(decimal((edges[index - 1] + edges[index]) / 2, digits));
    }
    return labels;
  }

  function histogramConfig(subset, theme) {
    const variable = state.variable;
    const digits = digitsToDistinguishBins(variable.edges);
    const labels = binLabels(variable.edges, digits);
    const axisWindow = variable.display_range || [0, labels.length - 1];
    const datasets = [
      {
        type: "bar",
        label: "Frequência medida",
        data: subset.density,
        backgroundColor: theme.empirical,
        borderColor: theme.empirical,
        borderWidth: 0,
        borderRadius: 4,
        borderSkipped: "bottom",
        categoryPercentage: 0.96,
        barPercentage: 0.94,
        order: 2,
      },
    ];
    if (subset.curve) {
      datasets.push({
        type: "line",
        label: plainReferences(variable.family_label),
        data: subset.curve,
        borderColor: theme.model,
        backgroundColor: theme.model,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.35,
        fill: false,
        order: 1,
      });
    }

    return {
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              color: theme.legendText,
              usePointStyle: true,
              boxWidth: 10,
              // The curve carries `order: 1` so it paints ON TOP of the bars, and Chart.js
              // reads that same field for the legend — which listed the fitted model ahead
              // of the measurement it is fitted to. Draw order is a depth question; legend
              // order is a "what is this chart about" question, and the answer is the bars.
              sort: (a, b) => (a.datasetIndex === b.datasetIndex ? 0 : a.datasetIndex - b.datasetIndex),
            },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.model,
            borderWidth: 1,
            callbacks: {
              title: (items) => {
                const index = items[0].dataIndex;
                const low = decimal(variable.edges[index], digits);
                const high = decimal(variable.edges[index + 1], digits);
                return `${low} a ${high} ${variable.unit}`.trim();
              },
              label: (item) => {
                if (item.dataset.type === "line") {
                  return `${item.dataset.label}: ${decimal(item.parsed.y, 4)}`;
                }
                const count = subset.counts[item.dataIndex];
                return [`Densidade: ${decimal(item.parsed.y, 4)}`, `Observações: ${integer(count)}`];
              },
            },
          },
        },
        scales: {
          x: {
            // Window published with the variable, identical across subsets: the edges cover the whole physically
            // possible range, and only the axis is clipped — never the data.
            min: axisWindow[0],
            max: axisWindow[1],
            title: {
              display: Boolean(variable.unit),
              text: variable.unit,
              color: theme.textSecondary,
            },
            ticks: { color: theme.textSecondary, maxTicksLimit: 14, autoSkip: true },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Densidade", color: theme.textSecondary },
            ticks: { color: theme.textSecondary },
            grid: { color: theme.grid },
          },
        },
      },
    };
  }

  function drawHistogram(subset) {
    const theme = themeColors();
    const config = histogramConfig(subset, theme);
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    const canvas = el("climaCanvas");
    state.chart = new Chart(canvas.getContext("2d"), { type: "bar", ...config });
    canvas.setAttribute(
      "aria-label",
      `Histograma de ${state.variable.label} — ${subsetLabel(state.subsetId)}. ` +
        `Use o botão "Ver tabela de dados" para a versão textual.`
    );
  }

  // The rose is SVG and not Chart.js: in 3.9.1 no series of type `line` can be laid over a radial scale, so the von
  // Mises mixture would have no way to appear on top of a polarArea. The SVG also satisfies the CSP with no new
  // dependency.

  const SVG_NS = "http://www.w3.org/2000/svg";
  const CENTER = 200;
  const MAX_RADIUS = 150;

  function svgNode(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  /** Point on the SVG plane for a bearing in degrees (0 = north, clockwise). */
  function polar(degrees, radius) {
    const angle = ((degrees - 90) * Math.PI) / 180;
    return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)];
  }

  function sectorPath(centerDegrees, halfWidth, radius) {
    const [x0, y0] = polar(centerDegrees - halfWidth, radius);
    const [x1, y1] = polar(centerDegrees + halfWidth, radius);
    return `M ${CENTER} ${CENTER} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(
      2
    )} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  }

  function drawRose(subset) {
    const theme = themeColors();
    const svg = el("climaRose");
    svg.replaceChildren();

    const sectors = state.variable.sectors;
    const frequencies = subset.frequencies || [];
    const curve = subset.curve || [];
    const peak = Math.max(...frequencies, ...curve, 0.0001);
    // Radius scales LINEARLY with frequency (wind atlas convention), which reads only because the rings are labelled.
    const scale = (value) => (value / peak) * MAX_RADIUS;

    // Ring labels are held back to be appended LAST: petals are opaque fill and the SVG paints in document order.
    // The surface-coloured outline completes the defence — over a petal the text stays legible with no opaque box.
    const surface = isDark() ? "#2d2d2d" : "#fff";
    const ringLabels = [];
    for (let ring = 1; ring <= ROSE_RINGS; ring += 1) {
      const radius = (MAX_RADIUS * ring) / ROSE_RINGS;
      svg.appendChild(
        svgNode("circle", {
          cx: CENTER,
          cy: CENTER,
          r: radius,
          fill: "none",
          stroke: theme.grid,
          "stroke-width": 1,
        })
      );
      const label = svgNode("text", {
        x: CENTER + 4,
        y: CENTER - radius - 3,
        "font-size": 11,
        fill: theme.textSecondary,
        stroke: surface,
        "stroke-width": 3,
        "stroke-linejoin": "round",
        "paint-order": "stroke fill",
      });
      label.textContent = percent((peak * ring) / ROSE_RINGS, 0);
      ringLabels.push(label);
    }

    COMPASS.forEach((name, index) => {
      const degrees = index * 45;
      const [x, y] = polar(degrees, MAX_RADIUS);
      svg.appendChild(
        svgNode("line", {
          x1: CENTER,
          y1: CENTER,
          x2: x.toFixed(2),
          y2: y.toFixed(2),
          stroke: theme.grid,
          "stroke-width": 1,
        })
      );
      const [tx, ty] = polar(degrees, MAX_RADIUS + 20);
      const label = svgNode("text", {
        x: tx.toFixed(2),
        y: ty.toFixed(2),
        "font-size": 13,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        fill: theme.textSecondary,
      });
      label.textContent = name;
      svg.appendChild(label);
    });

    const halfWidth = sectors.length > 1 ? 360 / sectors.length / 2 : 22.5;
    sectors.forEach((center, index) => {
      const value = frequencies[index] || 0;
      if (value <= 0) return;
      const petal = svgNode("path", {
        d: sectorPath(center, halfWidth * 0.92, scale(value)),
        fill: theme.empirical,
        stroke: surface,
        "stroke-width": 2,
      });
      const title = svgNode("title", {});
      title.textContent = `${decimal(center, 1)}° — ${percent(value, 1)}`;
      petal.appendChild(title);
      svg.appendChild(petal);
    });

    if (curve.length > 1) {
      const points = curve.map((value, index) => {
        const degrees = (index * 360) / (curve.length - 1);
        const [x, y] = polar(degrees, scale(value));
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      svg.appendChild(
        svgNode("polyline", {
          points: points.join(" "),
          fill: "none",
          stroke: theme.model,
          "stroke-width": 2,
          "stroke-linejoin": "round",
        })
      );
    }

    for (const label of ringLabels) svg.appendChild(label);

    const circular = subset.circular || {};
    svg.setAttribute(
      "aria-label",
      `Rosa dos ventos — ${subsetLabel(state.subsetId)}. Rumo médio ${decimal(
        circular.mean_direction,
        0
      )} graus. Use o botão "Ver tabela de dados" para a versão textual.`
    );
  }

  function statTile(label, value) {
    const tile = document.createElement("div");
    tile.className = "clima-stat";
    const number = document.createElement("span");
    number.className = "clima-stat-value";
    number.textContent = value;
    const caption = document.createElement("span");
    caption.className = "clima-stat-label";
    caption.textContent = label;
    tile.append(number, caption);
    return tile;
  }

  function renderStats(subset) {
    const unit = state.variable.unit ? ` ${state.variable.unit}` : "";
    const tiles = el("climaStats");
    tiles.replaceChildren();
    tiles.appendChild(statTile("Observações", integer(subset.n)));

    if (state.variable.chart === "rose") {
      const circular = subset.circular || {};
      tiles.appendChild(statTile("Rumo médio", `${decimal(circular.mean_direction, 1)}°`));
      tiles.appendChild(statTile("Comprimento resultante", decimal(circular.resultant_length, 3)));
      tiles.appendChild(statTile("Variância circular", decimal(circular.circular_variance, 3)));
      return;
    }

    const stats = subset.stats || {};
    tiles.appendChild(statTile("Média", `${decimal(stats.mean, 2)}${unit}`));
    tiles.appendChild(statTile("Desvio-padrão", `${decimal(stats.std, 2)}${unit}`));
    tiles.appendChild(statTile("Mediana", `${decimal(stats.p50, 2)}${unit}`));
    tiles.appendChild(statTile("Percentil 1", `${decimal(stats.p01, 2)}${unit}`));
    tiles.appendChild(statTile("Percentil 99", `${decimal(stats.p99, 2)}${unit}`));
    tiles.appendChild(statTile("Assimetria", decimal(stats.skewness, 2)));
  }

  // Finite samples outside the histogram edges. They are counted in `n` but have no bar, so the bars sum to less
  // than the announced total and the gap has to be named. Rose subsets carry neither field.
  function overflowNote(subset) {
    const below = subset.below || 0;
    const above = subset.above || 0;
    if (!below && !above) return "";
    const parts = [];
    if (below) parts.push(`${integer(below)} abaixo`);
    if (above) parts.push(`${integer(above)} acima`);
    return ` Incluídas neste total, fora das bordas do histograma e sem barra: ${parts.join(" e ")}.`;
  }

  function fitRow(label, value) {
    const row = document.createElement("div");
    row.className = "clima-fit-row";
    const name = document.createElement("dt");
    name.textContent = label;
    const number = document.createElement("dd");
    number.textContent = value;
    row.append(name, number);
    return row;
  }

  const PARAMETER_LABELS = {
    shape: "Forma (k)",
    scale: "Escala (c)",
    mu: "Média (μ)",
    sigma: "Desvio (σ)",
    alpha: "α",
    beta: "β",
    lambda: "λ",
    kt_max: "Kt máximo",
    gain: "Ganho estimado",
  };

  // Rows chosen by FAMILY and not by the shape of the parameters: more than one family carries `weights`, so that
  // vector says nothing about which rows to print. What the reader needs are the INHERITED parameters and the single
  // estimated scalar, not the quadrature behind them.
  function parameterRows(fit) {
    const params = fit.params || {};
    const rows = [];

    if (Array.isArray(params.mu_degrees)) {
      (params.weights || []).forEach((weight, index) => {
        rows.push([
          `Componente ${index + 1}`,
          `${percent(weight, 1)} · rumo ${decimal(params.mu_degrees[index], 1)}° · κ ${decimal(params.kappa[index], 2)}`,
        ]);
      });
      return rows;
    }

    if (fit.family === "power_normal_mixture") {
      (params.weights || []).forEach((weight, index) => {
        rows.push([
          `Regime ${index + 1}`,
          `${percent(weight, 1)} · T ${decimal(params.mu[index], 2)} K · σ ${decimal(params.sigma[index], 2)} K`,
        ]);
      });
      return rows;
    }

    if (Array.isArray(params.scales) || Array.isArray(params.mu)) {
      rows.push(["λ herdado do Kt", decimal(params.lambda, 4)]);
      rows.push(["Kt máximo herdado", decimal(params.kt_max, 4)]);
      if (params.gain !== undefined && params.gain !== 1) {
        rows.push(["Ganho estimado", decimal(params.gain, 4)]);
      }
      if (params.slope !== undefined) {
        rows.push(["Inclinação (a)", decimal(params.slope, 4)]);
        rows.push(["Intercepto (b)", `${decimal(params.intercept, 2)} W/m²`]);
        rows.push(["Dispersão do resíduo", `${decimal(params.sigma, 2)} W/m²`]);
      }
      const components = params.components || (params.scales || []).length;
      rows.push(["Componentes da mistura", integer(components)]);
      return rows;
    }

    for (const [key, value] of Object.entries(params)) {
      rows.push([PARAMETER_LABELS[key] || key, decimal(value, 4)]);
    }
    return rows;
  }

  function renderFit(subset) {
    const panel = el("climaFitPanel");
    const grid = el("climaFit");
    grid.replaceChildren();
    const fitTitle = el("climaFitTitulo");
    fitTitle.replaceChildren(document.createTextNode("Ajuste teórico — "));
    fitTitle.appendChild(withReferences(state.variable.family_label));

    if (!subset.fit) {
      panel.hidden = true;
      el("climaAtoms").textContent = "";
      return;
    }
    panel.hidden = false;

    for (const [label, value] of parameterRows(subset.fit)) {
      grid.appendChild(fitRow(label, value));
    }

    const quality = subset.quality || {};
    if (quality.ks_distance !== undefined && quality.ks_distance !== null) {
      grid.appendChild(fitRow("Maior discrepância acumulada (KS)", percent(quality.ks_distance, 2)));
    }
    if (quality.quantile_gap !== undefined && quality.quantile_gap !== null) {
      const unit = state.variable.unit ? ` ${state.variable.unit}` : "";
      grid.appendChild(fitRow("Erro médio de quantil", `${decimal(quality.quantile_gap, 3)}${unit}`));
    }
    if (quality.density_r_squared !== undefined && quality.density_r_squared !== null) {
      grid.appendChild(fitRow("R² da densidade", decimal(quality.density_r_squared, 4)));
    }
    if (quality.n_effective !== undefined && quality.n_effective !== null) {
      grid.appendChild(
        fitRow(
          "Amostra efetiva",
          `${integer(quality.n_effective)} de ${integer(quality.n)} (autocorrelação ${decimal(
            quality.lag1_autocorrelation,
            2
          )})`
        )
      );
    }

    // The fraction is over the WHOLE subset — before the point mass is removed from the fit — while the panel beside
    // it prints `n`, which is what was LEFT. The absolute count is published so nobody multiplies the two.
    const atoms = subset.atoms || [];
    el("climaAtoms").textContent = atoms.length
      ? atoms
          .map((atom) => {
            const share = percent(atom.fraction, 1);
            return Number.isFinite(atom.count)
              ? `${atom.label}: ${share} (${integer(atom.count)} h)`
              : `${atom.label}: ${share}`;
          })
          .join(" · ")
      : "";
  }

  // Expanding the `[[chave]]` markers belongs to assets/js/references.js. What is specific here is the SOURCE: the
  // distribution families are a choice of whoever produces the data, so their bibliography arrives in the manifest
  // and is registered at runtime on top of the static one.

  const refs = () =>
    window.labmimReferences || {
      expand: (text) => document.createTextNode(String(text)),
      plain: (text) => String(text),
      keysIn: () => [],
      get: () => null,
      register: () => {},
      linkable: () => false,
    };

  const withReferences = (text) => refs().expand(text);
  const plainReferences = (text) => refs().plain(text);

  function citedKeys() {
    const keys = [];
    for (const text of [state.variable.family_label, ...(state.variable.caveats || [])]) {
      for (const key of refs().keysIn(text)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return keys;
  }

  function renderReferences() {
    const panel = el("climaRefsPanel");
    const list = el("climaRefs");
    list.replaceChildren();
    for (const key of citedKeys()) {
      const entry = refs().get(key);
      if (!entry) continue;
      const item = document.createElement("li");
      // Same criterion as assets/js/references.js: the bibliography comes from the exporter's manifest, so only an
      // http(s) scheme becomes a link.
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

  function renderCaveats() {
    const list = el("climaCaveats");
    list.replaceChildren();
    // Manifest caveats hold for the whole page — the record is not a thirty-year climate normal, and the time zone
    // is Salvador local time — and come before the variable's own.
    const shared = (state.manifest && state.manifest.caveats) || [];
    for (const text of [...shared, ...(state.variable.caveats || [])]) {
      const item = document.createElement("li");
      item.appendChild(withReferences(text));
      list.appendChild(item);
    }
    list.hidden = list.children.length === 0;
  }

  function tableRows(subset) {
    const variable = state.variable;
    if (variable.chart === "rose") {
      const header = ["Setor (°)", "Frequência", "Mistura de von Mises"];
      const curve = subset.curve || [];
      const step = curve.length > 1 ? (curve.length - 1) / variable.sectors.length : 0;
      // The curve comes on a 201-point grid (1.8°) and the centre of the eight odd sectors falls exactly between two
      // samples, so the index is interpolated: rounding it would read 0.9° past the bearing the first column of the
      // same row announces. drawRose() escapes this by drawing the whole curve as a polyline.
      const atCenter = (index) => {
        const exact = index * step;
        const low = Math.floor(exact);
        const high = Math.min(low + 1, curve.length - 1);
        return curve[low] + (curve[high] - curve[low]) * (exact - low);
      };
      const rows = variable.sectors.map((center, index) => [
        decimal(center, 1),
        percent(subset.frequencies[index], 2),
        curve.length ? percent(atCenter(index), 2) : "—",
      ]);
      return { header, rows };
    }
    const digits = digitsToDistinguishBins(variable.edges);
    const header = ["Intervalo", "Observações", "Densidade", "Densidade teórica"];
    const rows = subset.counts.map((count, index) => [
      `${decimal(variable.edges[index], digits)} – ${decimal(variable.edges[index + 1], digits)}`,
      integer(count),
      decimal(subset.density[index], 5),
      subset.curve ? decimal(subset.curve[index], 5) : "—",
    ]);
    return { header, rows };
  }

  function renderTable(subset) {
    const { header, rows } = tableRows(subset);
    const head = el("climaTabelaHead");
    const body = el("climaTabelaBody");
    body.replaceChildren();

    // The column-scoped header cells come from the HTML, so this fills only their text: writing that attribute value
    // here as a literal would trip scripts/check-bootstrap-purge.mjs, which pulls EVERY quoted token out of the
    // site's own JS, comments included, and would read it as a Bootstrap grid class absent from the purged CSS.
    Array.from(head.children).forEach((cell, index) => {
      cell.textContent = header[index] || "";
      cell.hidden = index >= header.length;
    });

    for (const row of rows) {
      const line = document.createElement("tr");
      for (const value of row) {
        const cell = document.createElement("td");
        cell.textContent = value;
        line.appendChild(cell);
      }
      while (line.children.length < head.children.length) {
        const filler = document.createElement("td");
        filler.hidden = true;
        line.appendChild(filler);
      }
      body.appendChild(line);
    }
    // The caption counts the BARS, not the subset: samples outside the histogram edges are in `subset.n` but have
    // no row here, so announcing `n` over this table would promise rows it does not have.
    const binned = (subset.counts || []).reduce((total, count) => total + count, 0);
    el("climaTabelaCaption").textContent =
      `${state.variable.label} — ${subsetLabel(state.subsetId)} (${integer(binned)} observações nas barras)`;
  }

  function exportCsv() {
    const subset = currentSubset();
    // Required here too, not only in the button state: a disabled button is a UI layer, the listener stays reachable.
    if (!subset || !subset.n) return;
    const { header, rows } = tableRows(subset);
    const lines = [header.join(";"), ...rows.map((row) => row.join(";"))];
    const blob = new Blob([`${EXCEL_UTF8_BOM}${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `climatologia_${state.variableId}_${state.subsetId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function renderCoverage() {
    const container = el("climaCoverage");
    container.replaceChildren();
    const years = (state.manifest.coverage && state.manifest.coverage.years) || [];
    // Scaled to the best covered year OF THIS VARIABLE: under a global denominator the structurally sparser
    // variables (rain, PAR, night-time net radiation) turn into a row of indistinguishable stubs.
    let peak = 0;
    for (const entry of years) peak = Math.max(peak, (entry.hours || {})[state.variableId] || 0);

    for (const entry of years) {
      const hours = (entry.hours || {})[state.variableId] || 0;
      const column = document.createElement("div");
      column.className = "clima-coverage-year";
      // A bar `title` opens neither by keyboard nor by touch, so each column carries an accessible label of its own:
      // without it a year with no observation and a year with very few valid hours differ only by the dashed frame.
      column.setAttribute("role", "img");
      column.setAttribute(
        "aria-label",
        hours ? `${entry.year}: ${integer(hours)} horas válidas` : `${entry.year}: sem observação`
      );

      const bar = document.createElement("div");
      bar.className = "clima-coverage-bar";
      bar.style.height = `${Math.round((hours / (peak || 1)) * 100)}%`;
      bar.title = `${entry.year}: ${integer(hours)} horas válidas`;

      const track = document.createElement("div");
      track.className = "clima-coverage-track";
      track.appendChild(bar);

      const label = document.createElement("span");
      label.className = "clima-coverage-label";
      label.textContent = String(entry.year);

      column.append(track, label);
      if (hours === 0) column.classList.add("is-empty");
      container.appendChild(column);
    }

    // Hours of the variable on screen, not the year count of the whole record: `seasons[].years` is global, comes
    // out the same for every variable and contradicts the per-variable bars just above.
    const seasons = (state.manifest.coverage && state.manifest.coverage.seasons) || [];
    const seasonNote = seasons
      .map((season) => `${season.season}: ${integer((season.hours || {})[state.variableId] || 0)} horas válidas`)
      .join(" · ");
    // With the per-variable scale the top of the track means something different for each one, so without the peak
    // written out a sparsely measured variable would look as well covered as temperature.
    const scaleNote = peak ? `Barras na escala do ano mais coberto desta variável: ${integer(peak)} horas.` : "";
    el("climaSeasons").textContent = [scaleNote, seasonNote].filter(Boolean).join(" ");
  }

  function showEmpty(message) {
    el("climaApp").hidden = true;
    const empty = el("climaEmpty");
    empty.hidden = false;
    el("climaEmptyMessage").textContent = message;
  }

  function render() {
    const subset = currentSubset();
    const isRose = state.variable.chart === "rose";
    el("climaChartWrap").hidden = isRose;
    el("climaRoseWrap").hidden = !isRose;
    el("climaTitulo").textContent = `${state.variable.label} — ${subsetLabel(state.subsetId)}`;

    // These three describe the VARIABLE, never the subset: redrawn even on an empty subset, or the previous
    // variable's caveats, bibliography and coverage hours stay under the new title.
    renderCaveats();
    renderReferences();
    renderCoverage();

    if (!subset || !subset.n) {
      el("climaStatus").textContent = "Sem observações válidas neste recorte.";
      el("climaStats").replaceChildren();
      el("climaFitPanel").hidden = true;
      el("climaAtoms").textContent = "";
      el("climaLegenda").textContent = "";
      // Emptied by hand instead of through renderTable(): there may be no subset object at all, and a rose with no
      // observations may be missing `frequencies`.
      el("climaTabelaBody").replaceChildren();
      el("climaTabelaCaption").textContent = `${state.variable.label} — ${subsetLabel(state.subsetId)} (0 observações)`;
      el("climaExport").disabled = true;
      el("climaCanvas").setAttribute(
        "aria-label",
        `Histograma de ${state.variable.label} — ${subsetLabel(state.subsetId)}: sem observações neste recorte.`
      );
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
      if (isRose) {
        el("climaRose").replaceChildren();
        el("climaRose").setAttribute(
          "aria-label",
          `Rosa dos ventos — ${subsetLabel(state.subsetId)}: sem observações neste recorte.`
        );
      }
      return;
    }

    el("climaExport").disabled = false;
    if (isRose) {
      // Destroy the previous histogram so it does not stay registered on the hidden canvas — with its listeners,
      // its ResizeObserver and that variable's data — until the reader returns to a histogram variable.
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
      drawRose(subset);
    } else {
      drawHistogram(subset);
    }
    renderStats(subset);
    renderFit(subset);
    renderTable(subset);

    const marks = isRose ? "Pétalas" : "Barras";
    const legend = el("climaLegenda");
    if (subset.curve) {
      legend.replaceChildren(document.createTextNode(`${marks}: frequência medida. Linha: `));
      legend.appendChild(withReferences(state.variable.family_label));
      legend.appendChild(document.createTextNode("."));
    } else {
      legend.textContent = `${marks}: frequência medida. Esta variável não tem densidade teórica canônica.`;
    }
    el("climaStatus").textContent =
      `${state.variable.label}, ${subsetLabel(state.subsetId)}: ${integer(subset.n)} observações.` +
      overflowNote(subset);
  }

  // A failure in ONE variable must not blank the whole page: hiding `#climaApp`, which is all `showEmpty()` does,
  // takes the variable selector down with it and only `start()` brings it back. The technical detail goes to the
  // console — the engine message is in English and says nothing to whoever is reading the page.
  function variableFailed(error) {
    console.error(error);
    // Mandatory: keeps the previous variable's chart and table from sitting under the label of the one that failed.
    state.variable = null;
    const entry = (state.manifest.variables || []).find((item) => item.id === state.variableId);
    const label = entry ? entry.label : state.variableId;

    el("climaTitulo").textContent = "—";
    el("climaLegenda").textContent = "";
    el("climaStatus").textContent =
      `Os dados de ${label} não puderam ser lidos; o arquivo pode estar incompleto no servidor. Escolha outra variável.`;
    el("climaStats").replaceChildren();
    el("climaFitPanel").hidden = true;
    el("climaAtoms").textContent = "";
    el("climaTabelaBody").replaceChildren();
    el("climaTabelaCaption").textContent = "Sem dados para exibir.";
    el("climaExport").disabled = true;
    el("climaCaveats").replaceChildren();
    el("climaCaveats").hidden = true;
    el("climaRefs").replaceChildren();
    el("climaRefsPanel").hidden = true;
    el("climaRose").replaceChildren();
    el("climaCanvas").setAttribute("aria-label", `Sem dados para exibir: os dados de ${label} não puderam ser lidos.`);
    el("climaRose").setAttribute("aria-label", `Sem dados para exibir: os dados de ${label} não puderam ser lidos.`);
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    // Depends only on the manifest and on the chosen id, so it stays correct.
    renderCoverage();
  }

  async function refresh() {
    // Every change of variable or subset invalidates the responses still in flight: without this mark the slowest
    // one arrives last and draws the old choice.
    const generation = (state.seq += 1);
    try {
      const variable = await loadVariable(state.variableId);
      if (generation !== state.seq) return;
      state.variable = variable;
      render();
    } catch (error) {
      if (generation !== state.seq) return;
      variableFailed(error);
    }
  }

  async function start() {
    const root = document.querySelector("[data-climatology-base]");
    if (!root) return;
    state.base = (root.dataset.climatologyBase || "").replace(/\/$/, "");
    if (!state.base) {
      showEmpty("Esta publicação ainda não declara um diretório de climatologia.");
      return;
    }
    if (typeof Chart === "undefined") {
      showEmpty("A biblioteca de gráficos não carregou.");
      return;
    }

    el("climaEmpty").hidden = false;
    try {
      state.manifest = await fetchJson(`${state.base}/manifest.json`);
    } catch {
      showEmpty(
        "Os dados de climatologia ainda não foram publicados para esta região. " +
          "Eles são anexados ao site no deploy, separadamente das páginas."
      );
      return;
    }

    // Producer bibliography on top of the site's: they cover different things — model schemes versus families.
    refs().register(state.manifest.references);

    if (!state.manifest.variables || !state.manifest.variables.length) {
      showEmpty("O conjunto publicado não declara nenhuma variável.");
      return;
    }

    state.variableId = state.manifest.variables[0].id;
    state.subsetId = state.manifest.selector[0];
    buildControls();
    markActiveSubset();

    const period = state.manifest.period || {};
    if (period.start && period.end) {
      el("climaPeriodo").textContent =
        `Distribuições estatísticas do registro observado — ${period.start} a ${period.end}`;
    }

    el("climaEmpty").hidden = true;
    el("climaApp").hidden = false;
    await refresh();

    window.addEventListener("labmim-theme-change", () => {
      const subset = currentSubset();
      if (!subset || !subset.n) return;
      if (state.variable.chart === "rose") {
        drawRose(subset);
      } else {
        drawHistogram(subset);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
