/**
 * MONITORAMENTO
 *
 * Controlador da página de monitoramento interativa. Lê o documento
 * `labmim-monitoring-v1` do diretório declarado em `dataset.paths.monitoring` e
 * desenha, para cada variável, a janela móvel de 7 dias em TRÊS CAMADAS: as
 * amostras brutas do datalogger, a média horária por cima delas e a série do WRF
 * quando o modelo tem aquela variável.
 *
 * Contratos que este arquivo assume:
 *
 * - Nada é calculado aqui. Agregação, controle de qualidade e recorte da janela
 *   já vêm prontos do exportador Python (`labmim-monitoring`). O que a página faz
 *   é escolher o que mostrar.
 * - Cada camada publica o eixo do tempo como `start` + `step_minutes` + `count`,
 *   não como uma lista de datas; os valores vêm em array paralelo, com `null` nos
 *   intervalos sem observação. É o que mantém o documento em ~160 kB.
 * - Os carimbos de `start` são HORA LOCAL DA ESTAÇÃO, sem fuso. Interpretá-los com
 *   `new Date("...")` deslocaria toda a série pelo fuso de QUEM ESTÁ OLHANDO, então
 *   aqui eles são convertidos com `Date.UTC` e lidos de volta com `getUTC*`: o
 *   eixo é aritmética pura sobre a hora da estação, e o navegador do visitante não
 *   participa.
 * - Nada aqui é específico de uma publicação: o diretório vem do atributo
 *   `data-monitoring-base` e todo rótulo, unidade, limite de eixo e ressalva vem do
 *   JSON. Uma publicação com estação própria reusa a página inteira publicando os
 *   seus dados.
 * - O diretório é dado operacional: em checkout de desenvolvimento e em CI ele está
 *   vazio, e a página precisa dizer isso em vez de quebrar.
 */

"use strict";

(function () {
  // Pares validados com scripts/validate_palette.js do guia de visualização, os
  // mesmos que a página de climatologia usa (banda de luminosidade, piso de croma,
  // separação para daltonismo e contraste contra a superfície).
  //
  // COMO A COR SIGNIFICA, e por que há duas regras:
  //
  // - Num gráfico de uma grandeza só, o matiz está livre, então ele carrega a
  //   distinção que mais importa ali: AZUL é o que foi medido, LARANJA é o modelo.
  // - No balanço de radiação o matiz já está ocupado — ele diz de qual família é
  //   a parcela (saldo, onda curta, onda longa) — e a direção do fluxo vai no
  //   traço (cheio desce, tracejado sobe). Sobra o PONTILHADO para o modelo, que
  //   por isso toma emprestado o matiz da parcela que espelha.
  //
  // É exatamente a codificação dos PNGs de `labmim-site-graphs`, de propósito: os
  // dois produtos saem do mesmo acervo e precisam ser lidos do mesmo jeito.
  //
  // O `raw` é acromático de propósito, e não uma quarta cor: ele não é outra
  // grandeza, é a mesma antes de agregar. Cinza recua sob a linha horária, não
  // disputa matiz com nada e se separa de azul e laranja em qualquer tipo de
  // daltonismo — é o mesmo papel que o cinza tem nos PNGs.
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

  // Recortes da janela publicada, do fim para trás. O documento traz sete dias;
  // estes só reduzem o que é desenhado, nunca pedem outro arquivo.
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

  /**
   * Casas suficientes para a unidade. Chuva precisa de TRÊS: a báscula do
   * pluviômetro conta de 0,254 mm em 0,254 mm, e arredondar para duas mostraria
   * "0,25" — o mesmo motivo por que o exportador guarda três em `_DECIMALS`.
   * Irradiância precisa de zero, porque um décimo de W/m² é ruído.
   */
  function unitDigits(unit) {
    if (unit === "mm") return 3;
    if (unit === "W/m²") return 0;
    if (unit === "°" || unit === "%") return 1;
    return 1;
  }

  // ─── Tempo ────────────────────────────────────────────────────────────────
  // Toda a aritmética roda em "UTC fingido": o carimbo da estação entra por
  // Date.UTC e sai por getUTC*, de modo que nada aqui depende do fuso do
  // navegador. Ver a nota de contrato no topo do arquivo.

  // Duas grafias, porque o payload tem duas origens: os eixos das camadas saem de
  // um Timestamp do pandas (`2022-07-01 00:00:00`) e o carimbo de publicação sai
  // de um strftime compacto (`20260809T121500Z`).
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

  // ─── Tema ─────────────────────────────────────────────────────────────────

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

  /** Mesma cor com transparência, para a nuvem de pontos brutos sob a linha. */
  function fade(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  // ─── Camadas do documento ─────────────────────────────────────────────────

  /** Recorte visível: os últimos N dias da janela publicada. */
  function windowStart() {
    const selected = WINDOWS.find((entry) => entry.id === state.windowId) || WINDOWS[0];
    const end = parseStationTime(state.payload.window.end);
    return end - selected.days * DAY_MS;
  }

  /**
   * Converte uma camada em pontos {x, y}, já recortada à janela escolhida.
   *
   * Os `null` do payload são preservados como pontos de valor nulo em vez de
   * removidos: com `spanGaps` desligado é isso que faz a falha de dado aparecer
   * como buraco na linha, e não como um segmento reto ligando os dois lados de
   * uma interrupção que pode ter durado horas.
   */
  function layerPoints(layer, seriesId, from) {
    const values = layer && layer.series ? layer.series[seriesId] : null;
    if (!values) return null;
    const start = parseStationTime(layer.axis.start);
    const step = layer.axis.step_minutes * MINUTE_MS;
    const points = [];
    for (let index = 0; index < values.length; index += 1) {
      const x = start + index * step;
      if (x < from) continue;
      points.push({ x, y: values[index] });
    }
    return points.length ? points : null;
  }

  // ─── Datasets ─────────────────────────────────────────────────────────────

  /**
   * Cor de uma série. Num gráfico de série única o matiz está livre e vale o par
   * medido/modelo; com mais de uma, o matiz é a família física declarada pelo
   * exportador. Ver a nota do PALETTE.
   */
  function seriesColor(chart, series, theme) {
    if (chart.series.length === 1) return theme.series.station;
    return theme.series[series.hue] || theme.series.station;
  }

  /**
   * Cor do modelo. Numa série única o matiz está livre e o laranja marca "isto
   * não é medida"; com várias, o matiz já diz a família, então o modelo herda o
   * da parcela que espelha e se distingue pelo pontilhado.
   */
  function modelColor(chart, series, theme) {
    return chart.series.length === 1 ? theme.series.model : seriesColor(chart, series, theme);
  }

  function baseDataset(extra) {
    return {
      borderJoinStyle: "round",
      spanGaps: false,
      normalized: true,
      ...extra,
    };
  }

  function rawDataset(chart, color, points) {
    // Chuva não é amostragem instantânea e sim acumulado do intervalo: uma nuvem
    // de pontos leria como "choveu isso naquele instante". Linha fina, como no PNG.
    if (chart.kind === "bar") {
      return baseDataset({
        type: "line",
        label: RAW_LABEL,
        data: points,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 1,
        pointRadius: 0,
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
      pointRadius: 0,
      pointHoverRadius: 4,
      // Tracejado nas parcelas ascendentes do balanço: no gráfico de balanço o
      // matiz já diz a família, então a direção do fluxo precisa de outro canal.
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
      // Pontilhado = modelo, em qualquer gráfico. É o terceiro canal, o que
      // sobra depois de matiz (família) e tracejado (direção).
      borderDash: [2, 3],
      showLine: !dotted,
      pointRadius: dotted ? 2.6 : 0,
      pointHoverRadius: dotted ? 5 : 4,
      pointStyle: "rect",
      pointBorderWidth: 0,
      tension: 0.2,
      order: 1,
    });
  }

  /**
   * Monta os datasets de um gráfico na ordem de desenho: bruto embaixo, média
   * horária por cima, modelo no topo.
   *
   * Num gráfico de várias séries (o balanço) a camada bruta é só a da PRIMEIRA
   * parcela: cinco nuvens de ~2000 pontos viram borrão e escondem justamente as
   * linhas que se quer comparar. É a mesma escolha do PNG, e o payload continua
   * trazendo o bruto de todas as parcelas para quem baixar o CSV.
   */
  function buildDatasets(chart, theme) {
    const from = windowStart();
    const datasets = [];
    // A camada bruta vem primeiro e uma vez só: é a base sobre a qual as outras
    // são lidas, e uma entrada de legenda por parcela repetiria sete vezes a
    // mesma informação.
    if (state.layers.has("raw")) {
      const points = layerPoints(chart.layers.raw, chart.series[0].id, from);
      if (points) datasets.push(rawDataset(chart, theme.raw, points));
    }
    for (const series of chart.series) {
      if (state.layers.has("hourly")) {
        const points = layerPoints(chart.layers.hourly, series.id, from);
        if (points) datasets.push(hourlyDataset(chart, series, seriesColor(chart, series, theme), points));
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

  // ─── Gráfico ──────────────────────────────────────────────────────────────

  /**
   * Fio vertical sob o cursor. O Chart.js 3.9 não traz um, e sem ele a leitura
   * de um instante em nove gráficos empilhados vira adivinhação.
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
   * Amostras de legenda que reproduzem o traço da linha, e não bolinhas.
   *
   * Com o padrão do Chart.js, "Onda curta ↓" e "Onda curta ↑" viram dois
   * círculos laranjas idênticos: a direção do fluxo está no traço, e o traço não
   * aparece na amostra. Aqui a caixinha é desenhada com o mesmo `borderDash` do
   * dataset, então cheio/tracejado/pontilhado — medida descendente, ascendente e
   * modelo — se distinguem também na legenda.
   */
  function legendLabels(instance) {
    return instance.data.datasets.map((dataset, index) => {
      const stroked = dataset.borderColor && dataset.borderColor !== "transparent";
      const color = stroked ? dataset.borderColor : dataset.backgroundColor;
      // A amostra é cheia quando a marca é cheia — barras e nuvem de pontos — e
      // oca quando a marca é linha, para o tracejado da borda aparecer.
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
   * Valores das outras séries visíveis no MESMO instante do ponto sob o cursor.
   *
   * A busca é por índice e não por varredura: as camadas são grades regulares,
   * então a posição do carimbo é `(x - start) / passo`. É O(1) por série, que é o
   * que permite fazer isto a cada movimento do mouse sobre 2 mil pontos.
   */
  function otherSeriesAt(items, digits, unit) {
    if (!items.length) return [];
    const hovered = items[0];
    const stamp = hovered.parsed.x;
    const lines = [];
    hovered.chart.data.datasets.forEach((dataset, index) => {
      if (index === hovered.datasetIndex) return;
      if (!hovered.chart.isDatasetVisible(index)) return;
      const points = dataset.data;
      if (!points.length) return;
      const step = points.length > 1 ? points[1].x - points[0].x : 0;
      if (!step) return;
      const position = Math.round((stamp - points[0].x) / step);
      const point = points[position];
      // Casa quando o instante apontado cai DENTRO do intervalo daquela amostra,
      // não quando o carimbo é idêntico. As camadas têm cadências diferentes — a
      // bruta tem doze pontos por hora e a horária um — e exigir igualdade
      // deixaria a lista vazia em onze de cada doze posições. Meio passo para
      // cada lado é o intervalo que a amostra de fato representa: a média da hora
      // que contém aquele instante é resposta honesta, o vizinho de outra hora
      // não seria.
      if (!point || Math.abs(point.x - stamp) > step / 2 || point.y === null) return;
      lines.push(`${dataset.label}: ${decimal(point.y, digits)} ${unit}`.trim());
    });
    return lines;
  }

  function tickCallback(value) {
    const date = new Date(value);
    return date.getUTCHours() === 0 ? formatDay(value) : formatHour(value);
  }

  // Espaçamento das marcas do eixo, em horas, por recorte. Fixo e não automático
  // porque o Chart.js escolheria múltiplos redondos de milissegundos, que caem em
  // horas quebradas: um eixo de sete dias precisa marcar meia-noite, não 22h.
  const TICK_HOURS = { "7d": 24, "3d": 12, "1d": 3 };

  function alignedTicks(min, max) {
    const step = (TICK_HOURS[state.windowId] || 24) * 3600000;
    const ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push({ value });
    return ticks;
  }

  function chartConfig(chart, theme) {
    const digits = unitDigits(chart.unit);
    const datasets = buildDatasets(chart, theme);
    return {
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Nove gráficos com até ~2000 pontos cada: animar a entrada custa mais do
        // que entrega, e redesenhar a cada troca de camada ficaria arrastado.
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
              // Ordem dos datasets, não a de desenho. `order` empurra o bruto
              // para trás no canvas, e sem isto ele arrastaria a legenda junto —
              // o modelo apareceria antes da medida que ele espelha.
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
              // O acerto do Chart.js devolve só o ponto mais próximo, o que num
              // gráfico de sete séries responde a pergunta errada: no balanço o
              // que se quer é o instante inteiro, as cinco parcelas e o modelo
              // lado a lado. Aqui as demais são buscadas pelo carimbo do ponto
              // sob o cursor e listadas embaixo.
              afterBody: (items) => otherSeriesAt(items, digits, chart.unit),
            },
          },
        },
        scales: {
          x: {
            // Escala linear e não temporal: nenhum adaptador de data está
            // vendorizado, e não faria falta — o eixo é hora da estação, que
            // aqui é aritmética sobre milissegundos e não um fuso.
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
    if (!config.data.datasets.length) return;
    state.charts.set(chart.id, new Chart(canvas.getContext("2d"), { type: "line", ...config, plugins: [crosshair] }));
  }

  function redrawAll() {
    for (const chart of state.payload.charts) {
      if (state.charts.has(chart.id) || isOnScreen(state.canvases.get(chart.id))) drawChart(chart);
    }
  }

  function isOnScreen(canvas) {
    if (!canvas) return false;
    const box = canvas.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  }

  // ─── CSV ──────────────────────────────────────────────────────────────────

  /**
   * Uma linha por instante da camada mais fina presente, uma coluna por
   * série/camada. É a alternativa textual ao gráfico e o caminho para quem quer
   * os números — inclusive as camadas brutas que o desenho não mostra.
   */
  function exportCsv(chart) {
    const from = windowStart();
    const columns = [];
    for (const series of chart.series) {
      for (const layer of LAYERS) {
        const points = layerPoints(chart.layers[layer.id], series.id, from);
        if (points) columns.push({ header: `${series.label} (${layer.label})`, points });
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
        // Vírgula decimal com separador de campo `;`, que é o que o Excel em
        // pt-BR abre sem passar pelo assistente de importação.
        return value === undefined || value === null ? "" : String(value).replace(".", ",");
      });
      rows.push([iso, ...cells].join(";"));
    }

    // BOM à frente: sem ele o Excel lê o arquivo como latin-1 e os acentos dos
    // cabeçalhos chegam quebrados.
    const blob = new Blob([`\ufeff${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `monitoramento-${chart.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ─── Cartões ──────────────────────────────────────────────────────────────

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  /** Quais camadas este gráfico realmente tem, para o cartão não prometer o que falta. */
  function availableLayers(chart) {
    return LAYERS.filter((layer) => chart.layers[layer.id]);
  }

  function buildCard(chart) {
    const card = node("div", "theme-surface monitor-card");
    card.id = `monitor-card-${chart.id}`;

    const head = node("div", "monitor-card-head");
    const heading = node("h3", "monitor-card-title", chart.title);
    if (chart.unit) heading.appendChild(node("span", "monitor-unit", ` (${chart.unit})`));
    head.appendChild(heading);

    const actions = node("div", "monitor-card-actions");
    const present = availableLayers(chart);
    actions.appendChild(node("span", "monitor-layers", present.map((layer) => layer.label).join(" · ")));
    const download = node("button", "btn btn-sm btn-outline-lab", "CSV");
    download.type = "button";
    download.setAttribute("aria-label", `Baixar os dados de ${chart.title} em CSV`);
    download.addEventListener("click", () => exportCsv(chart));
    actions.appendChild(download);
    head.appendChild(actions);
    card.appendChild(head);

    const wrap = node("div", "chart-container monitor-chart");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      `${chart.title} — camadas ${present.map((layer) => layer.label).join(", ")}. ` +
        "Use o botão CSV para a versão textual dos dados."
    );
    wrap.appendChild(canvas);
    card.appendChild(wrap);
    state.canvases.set(chart.id, canvas);

    // O que o modelo ainda não entrega. Registrar é o ponto: sem isto a ausência
    // de uma camada é indistinguível de um erro de carregamento, e a chegada da
    // precipitação do WRF passaria despercebida.
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

  // ─── Controles ────────────────────────────────────────────────────────────

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

  // ─── Orquestração ─────────────────────────────────────────────────────────

  function showEmpty(message) {
    el("monitorApp").hidden = true;
    const empty = el("monitorEmpty");
    empty.hidden = false;
    el("monitorEmptyMessage").textContent = message;
  }

  /**
   * Os gráficos só nascem quando o cartão entra na tela. Com nove telas de
   * ~2000 pontos, criar tudo no load trava a página por segundos num celular; e
   * a mesma observação dá a entrada suave dos cartões, que é só CSS.
   */
  function observeCards() {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          const chart = state.payload.charts.find((item) => `monitor-card-${item.id}` === entry.target.id);
          if (chart && !state.charts.has(chart.id)) drawChart(chart);
        }
      },
      { rootMargin: "200px 0px" }
    );
    for (const card of el("monitorGrid").children) observer.observe(card);
  }

  function renderHeader() {
    const window_ = state.payload.window || {};
    const start = parseStationTime(window_.start);
    const end = parseStationTime(window_.end);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      el("monitorPeriodo").textContent =
        `Janela móvel de ${window_.days} dias — ${formatStamp(start)} a ${formatStamp(end)} (horário local)`;
    }
    const generated = parseStationTime(state.payload.generated_utc || "");
    el("monitorAtualizado").textContent = Number.isFinite(generated)
      ? `Publicado em ${formatStamp(generated)} UTC`
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
    try {
      // Sem `?v=`: o arquivo é reescrito no mesmo nome a cada hora, então quem
      // decide o frescor é o cabeçalho da requisição, não a URL.
      const response = await fetch(`${state.base}/monitoring.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(String(response.status));
      state.payload = await response.json();
    } catch {
      showEmpty(
        "Os dados de monitoramento ainda não foram publicados para esta estação. " +
          "Eles são anexados ao site no deploy, separadamente das páginas."
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
