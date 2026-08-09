/**
 * CLIMATOLOGIA
 *
 * Controlador da página de climatologia. Lê os artefatos `labmim-climatology-v1`
 * do diretório declarado em `dataset.paths.climatology` e desenha, para a
 * variável e o recorte escolhidos, a distribuição medida com a densidade teórica
 * da literatura sobreposta.
 *
 * Contratos que este arquivo assume:
 *
 * - Nada é calculado aqui. Bins, ajuste, curva teórica e medidas de aderência já
 *   vêm prontos do exportador Python (`labmim-climatology`), inclusive a curva já
 *   reescalada por 1 menos a massa dos átomos. Reimplementar Weibull/gama/beta em
 *   JavaScript criaria uma segunda numérica capaz de divergir dos parâmetros
 *   impressos ao lado da curva.
 * - A curva de um histograma vem amostrada NOS CENTROS DOS BINS, um valor por
 *   barra, então barras e linha compartilham o mesmo eixo categórico sem
 *   interpolação — o que também vale para os bins logarítmicos da precipitação.
 * - Nada aqui é específico de uma publicação: o diretório vem do atributo
 *   `data-climatology-base` e todo rótulo vem do JSON. Uma publicação com registro
 *   próprio reusa a página inteira publicando os seus arquivos.
 * - O diretório é dado operacional: em checkout de desenvolvimento e em CI ele
 *   está vazio, e a página precisa dizer isso em vez de quebrar.
 */

"use strict";

(function () {
  // Pares validados com scripts/validate_palette.js do guia de visualização
  // (banda de luminosidade, piso de croma, separação para daltonismo e contraste
  // contra a superfície). Claro sobre #fff: ΔE 27,2 (protan) e contraste ≥ 3:1.
  // Escuro sobre #2d2d2d: ΔE 26,0 (protan), ambos dentro da banda escura.
  // Trocar qualquer um destes valores exige rodar o validador de novo.
  const PALETTE = {
    light: { empirical: "#3761b4", model: "#e07a1f" },
    dark: { empirical: "#5589e6", model: "#cb8030" },
  };

  const ROSE_RINGS = 4;
  const COMPASS = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];

  const state = {
    base: "",
    manifest: null,
    variable: null,
    variableId: "",
    subsetId: "",
    chart: null,
    cache: new Map(),
    // Geração da última escolha do leitor: respostas de pedidos anteriores que
    // cheguem depois dela são descartadas em refresh().
    seq: 0,
  };

  const el = (id) => document.getElementById(id);

  // ─── Formatação ───────────────────────────────────────────────────────────
  // pt-BR em toda a página (vírgula decimal), como no restante do site.

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

  function percent(fraction, digits) {
    if (fraction === null || fraction === undefined) return "—";
    return `${decimal(fraction * 100, digits === undefined ? 1 : digits)}%`;
  }

  /** Casas decimais suficientes para distinguir dois bins vizinhos. */
  function binDigits(edges) {
    let smallest = Infinity;
    for (let index = 1; index < edges.length; index += 1) {
      smallest = Math.min(smallest, edges[index] - edges[index - 1]);
    }
    if (!Number.isFinite(smallest) || smallest <= 0) return 2;
    return Math.max(0, Math.min(3, Math.ceil(-Math.log10(smallest))));
  }

  // ─── Tema ─────────────────────────────────────────────────────────────────
  // Mesma leitura em runtime de charts-manager.js: o Chart.js não guarda nada do
  // CSS, então basta reler os tokens quando a classe do tema vira.

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

  // ─── Dados ────────────────────────────────────────────────────────────────

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

  // ─── Controles ────────────────────────────────────────────────────────────

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

  // ─── Histograma ───────────────────────────────────────────────────────────

  function binLabels(edges, digits) {
    const labels = [];
    for (let index = 1; index < edges.length; index += 1) {
      labels.push(decimal((edges[index - 1] + edges[index]) / 2, digits));
    }
    return labels;
  }

  function histogramConfig(subset, theme) {
    const variable = state.variable;
    const digits = binDigits(variable.edges);
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
        // 2px de respiro entre barras vizinhas, como pede o guia de marcas.
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
            labels: { color: theme.legendText, usePointStyle: true, boxWidth: 10 },
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
            // Janela publicada com a variável, idêntica em todos os recortes: as
            // bordas cobrem toda a faixa fisicamente possível, mas desenhá-las
            // por inteiro deixaria a maior parte do gráfico vazia. Nada é
            // recortado dos dados — só do eixo.
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

  // ─── Rosa dos ventos (SVG) ────────────────────────────────────────────────
  // Desenhada aqui e não com Chart.js: em 3.9.1 nenhuma série do tipo `line`
  // pode ser sobreposta a uma escala radial, então a mistura de von Mises não
  // teria como aparecer sobre um polarArea. O SVG também respeita a CSP sem
  // dependência nova e reskina sozinho pelos tokens de tema.

  const SVG_NS = "http://www.w3.org/2000/svg";
  const CENTER = 200;
  const MAX_RADIUS = 150;

  function svgNode(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  /** Ponto do plano SVG para um rumo em graus (0 = norte, sentido horário). */
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
    // Escala de raio LINEAR na frequência, com os anéis rotulados: é a convenção
    // dos atlas de vento e é legível justamente porque os anéis dizem o valor.
    const scale = (value) => (value / peak) * MAX_RADIUS;

    // Anéis e rótulos de frequência.
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
      });
      label.textContent = percent((peak * ring) / ROSE_RINGS, 0);
      svg.appendChild(label);
    }

    // Raios e rosa dos rumos.
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

    // Pétalas medidas.
    const halfWidth = sectors.length > 1 ? 360 / sectors.length / 2 : 22.5;
    sectors.forEach((center, index) => {
      const value = frequencies[index] || 0;
      if (value <= 0) return;
      const petal = svgNode("path", {
        d: sectorPath(center, halfWidth * 0.92, scale(value)),
        fill: theme.empirical,
        // Anel de 2px na cor da superfície separa pétalas vizinhas.
        stroke: isDark() ? "#2d2d2d" : "#fff",
        "stroke-width": 2,
      });
      const title = svgNode("title", {});
      title.textContent = `${decimal(center, 1)}° — ${percent(value, 1)}`;
      petal.appendChild(title);
      svg.appendChild(petal);
    });

    // Mistura de von Mises como anel fechado.
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

    const circular = subset.circular || {};
    svg.setAttribute(
      "aria-label",
      `Rosa dos ventos — ${subsetLabel(state.subsetId)}. Rumo médio ${decimal(
        circular.mean_direction,
        0
      )} graus. Use o botão "Ver tabela de dados" para a versão textual.`
    );
  }

  // ─── Painéis textuais ─────────────────────────────────────────────────────

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

  /**
   * Amostras finitas que caíram fora das bordas do histograma.
   *
   * O exportador as conta em `below`/`above` em vez de descartá-las, justamente
   * para que o leitor saiba que o eixo está recortado. Elas ficam fora das
   * barras e fora do `n` publicado — que é o denominador da densidade —, então
   * sem esta nota o total anunciado esconde as amostras extremas. Nos recortes
   * de rosa os dois campos não existem, e a nota simplesmente não sai.
   */
  function overflowNote(subset) {
    const below = subset.below || 0;
    const above = subset.above || 0;
    if (!below && !above) return "";
    const parts = [];
    if (below) parts.push(`${integer(below)} abaixo`);
    if (above) parts.push(`${integer(above)} acima`);
    return ` Fora das bordas do histograma, sem entrar nas barras nem neste total: ${parts.join(" e ")}.`;
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

  /**
   * Linhas do painel de ajuste, escolhidas pela FAMÍLIA e não pela forma dos
   * parâmetros.
   *
   * A versão anterior decidia pela presença de `params.weights`, o que era
   * verdade só enquanto a rosa dos ventos era a única mistura da página. As
   * densidades induzidas das radiações também trazem `weights` — sessenta
   * escalas, e quase seis mil médias no saldo — e caíam no ramo da rosa
   * procurando um `mu_degrees` que não existe. Despejar esses vetores também não
   * serve: o que o leitor precisa ver são os parâmetros HERDADOS e o único
   * escalar estimado, não a quadratura por trás deles.
   */
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

    const atoms = subset.atoms || [];
    el("climaAtoms").textContent = atoms.length
      ? atoms.map((atom) => `${atom.label}: ${percent(atom.fraction, 1)}`).join(" · ")
      : "";
  }

  // ─── Referências ──────────────────────────────────────────────────────────
  // A expansão dos marcadores `[[chave]]` é de assets/js/references.js, que roda
  // em todas as páginas. O que é próprio daqui é a FONTE: as famílias de
  // distribuição são escolha de quem produz os dados, não do site, então a
  // bibliografia delas chega no manifesto e é registrada em runtime por cima da
  // bibliografia estática. Uma segunda implementação da mesma expansão só criaria
  // dois lugares para o estilo da citação divergir.

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

  /** Quais referências a variável em tela cita, na ordem em que aparecem. */
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
      // Mesmo critério de assets/js/references.js: a bibliografia vem do
      // manifesto publicado pelo exportador, então só um esquema http(s) vira
      // link. Sem URL utilizável a citação fica em texto, e não num href morto.
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
    // As ressalvas do manifesto valem para a página inteira — o registro não é
    // uma normal climatológica de trinta anos, e o fuso é o local de Salvador —
    // e vêm antes das da variável. O produtor as publica junto dos dados
    // justamente para que a apresentação não possa descartá-las.
    const shared = (state.manifest && state.manifest.caveats) || [];
    for (const text of [...shared, ...(state.variable.caveats || [])]) {
      const item = document.createElement("li");
      item.appendChild(withReferences(text));
      list.appendChild(item);
    }
    list.hidden = list.children.length === 0;
  }

  // ─── Tabela ───────────────────────────────────────────────────────────────

  function tableRows(subset) {
    const variable = state.variable;
    if (variable.chart === "rose") {
      const header = ["Setor (°)", "Frequência", "Mistura de von Mises"];
      const curve = subset.curve || [];
      const step = curve.length > 1 ? (curve.length - 1) / variable.sectors.length : 0;
      // A curva vem numa grade de 201 pontos (1,8°) e o centro dos oito setores
      // ímpares cai exatamente entre duas amostras: arredondar o índice leria
      // sempre 0,9° adiante do rumo que a primeira coluna da mesma linha anuncia.
      // A rosa desenhada não tem o problema porque drawRose usa a curva inteira
      // como polilinha; a tabela e o CSV são a versão textual, e precisam do
      // valor no centro.
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
    const digits = binDigits(variable.edges);
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

    // Os cabeçalhos com escopo de coluna vêm do HTML: preencher só o texto e
    // esconder as colunas sobrando mantém a tabela acessível sem que este
    // arquivo carregue o valor daquele atributo como literal. O guard em
    // scripts/check-bootstrap-purge.mjs extrai TODA string do JS próprio,
    // comentários inclusive, e o leria como uso de uma classe de grade do
    // Bootstrap ausente do CSS purgado.
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
    el("climaTabelaCaption").textContent =
      `${state.variable.label} — ${subsetLabel(state.subsetId)} (${integer(subset.n)} observações)`;
  }

  function exportCsv() {
    const subset = currentSubset();
    // O `n` também é exigido aqui, e não só no estado do botão: o botão
    // desabilitado é camada de UI, o listener continua alcançável.
    if (!subset || !subset.n) return;
    const { header, rows } = tableRows(subset);
    const lines = [header.join(";"), ...rows.map((row) => row.join(";"))];
    // BOM explícito: sem ele o Excel em pt-BR abre o CSV como Latin-1 e os
    // acentos dos rótulos chegam corrompidos ao pesquisador.
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `climatologia_${state.variableId}_${state.subsetId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ─── Cobertura ────────────────────────────────────────────────────────────

  function renderCoverage() {
    const container = el("climaCoverage");
    container.replaceChildren();
    const years = (state.manifest.coverage && state.manifest.coverage.years) || [];
    // Escala do ano mais coberto DESTA variável, não o pico do manifesto inteiro.
    // Com o denominador global — 8.781 h da temperatura — as variáveis de
    // contagem estruturalmente menor (chuva, PAR, saldo noturno) viram uma
    // fileira de tocos indistinguíveis num trilho de 72 px, e o painel deixa de
    // mostrar a variação entre anos que é a razão de ele existir.
    let peak = 0;
    for (const entry of years) peak = Math.max(peak, (entry.hours || {})[state.variableId] || 0);

    for (const entry of years) {
      const hours = (entry.hours || {})[state.variableId] || 0;
      const column = document.createElement("div");
      column.className = "clima-coverage-year";
      // O número vivia só no `title` da barra, que não abre por teclado nem por
      // toque: sem rótulo acessível a árvore fica com a fileira de anos sem valor
      // nenhum, e "ano sem observação" e "ano com pouquíssimas horas" passam a se
      // distinguir apenas pela moldura tracejada.
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

    // Horas da variável em tela, e não a contagem de anos do registro inteiro:
    // `seasons[].years` é global, sai igual nas dezesseis variáveis e contradiz
    // as barras logo acima, que são por variável.
    const seasons = (state.manifest.coverage && state.manifest.coverage.seasons) || [];
    const seasonNote = seasons
      .map((season) => `${season.season}: ${integer((season.hours || {})[state.variableId] || 0)} horas válidas`)
      .join(" · ");
    // Com a escala por variável o topo do trilho vale coisas diferentes em cada
    // uma, então o pico precisa estar escrito: sem o número, a chuva com 979 h no
    // melhor ano pareceria tão coberta quanto a temperatura com 8.781 h.
    const scaleNote = peak ? `Barras na escala do ano mais coberto desta variável: ${integer(peak)} horas.` : "";
    el("climaSeasons").textContent = [scaleNote, seasonNote].filter(Boolean).join(" ");
  }

  // ─── Orquestração ─────────────────────────────────────────────────────────

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

    // Estes três painéis descrevem a VARIÁVEL, nunca o recorte: precisam ser
    // redesenhados mesmo com o recorte vazio, senão as ressalvas, a bibliografia
    // e as horas de cobertura da variável anterior ficam sob o título da nova.
    renderCaveats();
    renderReferences();
    renderCoverage();

    if (!subset || !subset.n) {
      el("climaStatus").textContent = "Sem observações válidas neste recorte.";
      el("climaStats").replaceChildren();
      el("climaFitPanel").hidden = true;
      el("climaAtoms").textContent = "";
      el("climaLegenda").textContent = "";
      // Tabela esvaziada à mão em vez de renderTable(): num recorte ausente o
      // subset é nulo, e numa rosa sem observações `frequencies` pode faltar.
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
      // Sem isto a instância do histograma anterior fica registrada no canvas
      // escondido — com os listeners e o ResizeObserver do Chart.js e os dados
      // daquela variável — até o leitor voltar a uma variável de histograma.
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

  /**
   * Falha de UMA variável não pode apagar a página inteira.
   *
   * `showEmpty()` esconde `#climaApp`, e dentro dele está o próprio seletor de
   * variável; como só `start()` volta a exibi-lo, um arquivo truncado no
   * servidor deixaria o leitor sem nenhum controle para escolher outra variável
   * até recarregar. Aqui o app continua em pé e só os painéis da variável que
   * falhou são limpos. O detalhe técnico vai para o console: a mensagem do motor
   * de JS é em inglês e não diz nada a quem lê a página.
   */
  function variableFailed(error) {
    console.error(error);
    // Obrigatório: sem isto o gráfico e a tabela da variável anterior ficariam
    // sob o rótulo da que falhou.
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
    // Os dois rótulos acessíveis também: esvaziar o desenho sem reescrevê-los
    // deixaria o leitor de tela anunciando a distribuição da variável anterior.
    el("climaCanvas").setAttribute("aria-label", `Sem dados para exibir: os dados de ${label} não puderam ser lidos.`);
    el("climaRose").setAttribute("aria-label", `Sem dados para exibir: os dados de ${label} não puderam ser lidos.`);
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    // Só depende do manifesto e do id escolhido, então continua correta.
    renderCoverage();
  }

  async function refresh() {
    // Toda troca de variável ou de recorte invalida as respostas ainda em voo:
    // sem esta marca a mais lenta chega por último e desenha a escolha antiga,
    // enquanto o seletor e a cobertura já mostram a nova.
    const pedido = (state.seq += 1);
    try {
      const variable = await loadVariable(state.variableId);
      if (pedido !== state.seq) return;
      state.variable = variable;
      render();
    } catch (error) {
      if (pedido !== state.seq) return;
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

    // Bibliografia do produtor por cima da do site: as duas coexistem porque
    // cobrem coisas diferentes — esquemas do modelo versus famílias de densidade.
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
