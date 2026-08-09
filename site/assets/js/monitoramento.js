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
    // Os dois trechos de texto do cartão que precisam acompanhar o que o canvas
    // mostra: a lista de camadas do cabeçalho e o aviso de gráfico sem nada para
    // desenhar. Guardados por id porque o cartão é montado uma vez e o desenho
    // se repete a cada troca de camada, janela ou tema.
    layerLabels: new Map(),
    notices: new Map(),
    downloads: new Map(),
    // Ids que o observador já mandou desenhar. É a intenção registrada, e não a
    // geometria do momento, que diz o que `redrawAll` precisa refazer: um gráfico
    // pode sair de `charts` (nenhuma camada selecionada existe para ele) e o
    // observador não dispara de novo enquanto o cartão não cruzar a borda da faixa
    // que ele vigia — o cartão ficaria em branco até sair da tela e voltar.
    created: new Set(),
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

  /**
   * Carimbo com ANO, para o cabeçalho da página.
   *
   * O eixo e os tooltips podem ficar em dia/mês — é o que cabe numa marca de
   * eixo e o ano seria a mesma informação repetida centenas de vezes. Mas o
   * cabeçalho é o único lugar que diz QUANDO é a janela desenhada, e a página se
   * apresenta como atualizada a cada hora: sem o ano, um documento parado há
   * anos se lê exatamente como o de hoje.
   */
  function formatStampYear(ms) {
    const date = new Date(ms);
    return `${formatDay(ms)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
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

  /**
   * Rótulo da camada NESTE gráfico.
   *
   * O botão de camada é global e por isso genérico, mas a agregação horária não é
   * sempre média: onde o exportador declara `kind: "bar"` ela é o acumulado da
   * hora — é o que a ressalva publicada com a chuva diz, e é o que o documento
   * traz (a horária da precipitação é a soma das doze amostras, não a média
   * delas). Chamar isso de "média" no cabeçalho do CSV e na alternativa textual
   * do gráfico entrega um total sob o nome de uma taxa, e o CSV é justamente o
   * caminho de quem quer os números.
   */
  function layerLabel(chart, layer) {
    if (layer.id === "hourly" && chart.kind === "bar") return "Soma horária";
    return layer.label;
  }

  /** Recorte visível: os últimos N dias da janela publicada. */
  function windowStart() {
    const selected = WINDOWS.find((entry) => entry.id === state.windowId) || WINDOWS[0];
    // Âncora no fim do REGISTRO DA ESTAÇÃO, não no fim do documento. Desde que o
    // acumulado do modelo passou a estender a janela à frente, `window.end` quer
    // dizer "fim do que este documento carrega": ancorar nele faria a vista de 7
    // dias virar `fim_do_modelo − 7d` e empurrar para fora dias de observação real
    // que estão no payload — o dado presente e invisível. `station_end` é aditivo,
    // e o fallback mantém funcionando o artefato antigo, que não o traz.
    const anchor = parseStationTime(state.payload.window.station_end || state.payload.window.end);
    return anchor - selected.days * DAY_MS;
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
    let finitos = 0;
    for (let index = 0; index < values.length; index += 1) {
      const x = start + index * step;
      if (x < from) continue;
      const y = values[index];
      if (typeof y === "number" && Number.isFinite(y)) finitos += 1;
      points.push({ x, y });
    }
    // Uma série RESOLVIDA e inteiramente nula na janela não vira dataset. O array
    // de `null` tem o comprimento certo e o Chart.js o aceita, mas desenha nada sob
    // uma entrada de legenda — e legenda sem traço se lê como "a linha existe e saiu
    // da escala", que é pior do que ausência declarada. Isto não é hipótese: quando
    // um sensor sai do ar o exportador segue publicando a grade de tempo cheia de
    // buracos, e a camada da estação chega assim enquanto a do modelo continua cheia.
    // `points.length` sozinho não distingue os dois casos, porque conta os nulos.
    return finitos ? points : null;
  }

  /**
   * Existe pelo menos UM valor finito desta série, nesta camada, dentro do
   * recorte? Mesma regra de `layerPoints`, mas sem materializar os pontos e
   * saindo no primeiro que serve — é o que permite consultar a disponibilidade a
   * cada redesenho sem construir milhares de objetos que ninguém vai desenhar.
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
   * As séries que cada camada de fato desenha. A bruta entra uma vez só: é a base
   * sobre a qual as outras são lidas, e uma entrada por parcela repetiria a mesma
   * informação. Existe para `buildDatasets` e `availableLayers` não divergirem —
   * duas cópias da mesma regra é o que faz o rótulo prometer o que o canvas não tem.
   */
  function layerSeriesIds(chart, layerId) {
    return layerId === "raw" ? [chart.series[0].id] : chart.series.map((series) => series.id);
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

  /**
   * Raios ponto a ponto que revelam a LEITURA ISOLADA numa camada desenhada como
   * linha.
   *
   * Um valor sozinho entre buracos não desenha nada: com `spanGaps` desligado não
   * há vizinho com quem formar segmento, e o raio do ponto é zero porque numa
   * série cheia duas mil bolinhas viram borrão. O resultado era o cartão anunciar
   * "Média horária" sobre um canvas em branco — a mesma promessa quebrada que o
   * rótulo de camada ausente causava, e não é caso hipotético: sensor que volta
   * por uma hora e cai de novo produz exatamente esse ponto solto.
   *
   * Devolve o escalar 0 quando nenhum ponto está solto, para o caminho comum —
   * série contínua — seguir sem array nenhum.
   */
  function isolatedRadii(points, radius) {
    const finite = (point) => Boolean(point) && typeof point.y === "number" && Number.isFinite(point.y);
    let solto = false;
    const radii = points.map((point, index) => {
      if (!finite(point) || finite(points[index - 1]) || finite(points[index + 1])) return 0;
      solto = true;
      return radius;
    });
    return solto ? radii : 0;
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
   * Engrossa as MARCAS (não o dado) para o gráfico ampliado.
   *
   * A especificação de traço do projeto é 2px, e ela está calibrada para o cartão
   * da grade. No diálogo o canvas tem cerca de três vezes a área, e a mesma linha
   * de 2px passa a ler como fio de cabelo — proporcionalmente ela encolheu. Escalar
   * apenas espessura, raio de ponto e o padrão do tracejado preserva a codificação
   * inteira (matiz = família, traço = direção, pontilhado = modelo) e devolve só a
   * presença visual. Engrossar na GRADE seria o erro oposto: ali a linha horária já
   * cobre a nuvem bruta que ela existe para ser comparada contra.
   */
  function scaleMarks(datasets, factor) {
    if (factor === 1) return datasets;
    const grow = (value) => (typeof value === "number" && value > 0 ? Math.round(value * factor * 100) / 100 : value);
    return datasets.map((dataset) => ({
      ...dataset,
      borderWidth: grow(dataset.borderWidth),
      pointRadius: Array.isArray(dataset.pointRadius) ? dataset.pointRadius.map(grow) : grow(dataset.pointRadius),
      pointHoverRadius: grow(dataset.pointHoverRadius),
      borderDash: Array.isArray(dataset.borderDash) ? dataset.borderDash.map(grow) : dataset.borderDash,
    }));
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
      pointRadius: dotted ? 2.6 : isolatedRadii(points, 2.6),
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
        if (points) {
          const dataset = hourlyDataset(chart, series, seriesColor(chart, series, theme), points);
          // Única camada rotulada por INTERVALO: o carimbo é o começo da hora que
          // ela resume. É o que `otherSeriesAt` precisa saber para ler a hora que
          // contém o instante apontado, e não a vizinha.
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
    // O acerto do Chart.js devolve TODAS as séries empatadas na menor distância
    // em x, e não uma só: a camada horária e a do WRF dividem a grade de 60
    // minutos, então sobre uma hora cheia todos os datasets empatam. O corpo do
    // tooltip já imprime uma linha por série empatada, de modo que aqui é o
    // conjunto inteiro que precisa ficar de fora — pular só a primeira repetiria
    // cada valor duas vezes.
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
      // Casa quando o instante apontado cai DENTRO do intervalo daquela amostra,
      // não quando o carimbo é idêntico. As camadas têm cadências diferentes — a
      // bruta tem doze pontos por hora e a horária um — e exigir igualdade
      // deixaria a lista vazia em onze de cada doze posições.
      //
      // São duas regras, porque são duas semânticas de carimbo. A camada horária
      // resume um INTERVALO e o carimbo é o começo dele (o exportador a produz
      // com `resample`, que rotula à esquerda), então a hora que CONTÉM o
      // instante é a do piso: por arredondamento, 05:40 leria a média de
      // [06:00, 07:00), e no gráfico de chuva a soma de uma hora que não choveu.
      // As camadas instantâneas — a bruta e a do WRF, cuja semântica o documento
      // não declara — continuam pelo carimbo mais próximo.
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

  function chartConfig(chart, theme, { escala = 1 } = {}) {
    const digits = unitDigits(chart.unit);
    const datasets = scaleMarks(buildDatasets(chart, theme), escala);
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
              // O acerto do Chart.js devolve só o que está mais perto em x, o que
              // num gráfico de sete séries responde a pergunta errada: no balanço
              // o que se quer é o instante inteiro, as cinco parcelas e o modelo
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
    syncCardText(chart, config.data.datasets.length);
    if (!config.data.datasets.length) return;
    state.charts.set(chart.id, new Chart(canvas.getContext("2d"), { type: "line", ...config, plugins: [crosshair] }));
  }

  function redrawAll() {
    for (const chart of state.payload.charts) {
      if (state.created.has(chart.id)) drawChart(chart);
    }
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
        // Vírgula decimal com separador de campo `;`, que é o que o Excel em
        // pt-BR abre sem passar pelo assistente de importação.
        return value === undefined || value === null ? "" : String(value).replace(".", ",");
      });
      // Instante em que NENHUMA coluna tem leitura não vira linha. A união de
      // carimbos vem da grade de tempo publicada, que o exportador mantém cheia
      // mesmo com o sensor fora do ar: quando a estação registrou duas horas numa
      // janela de sete dias, 166 das 192 linhas saíam como `carimbo;;` — planilha
      // que se abre parecendo dado corrompido, e que esconde entre milhares de
      // linhas vazias as poucas que têm número. O buraco continua legível pela
      // descontinuidade dos carimbos, que é como um CSV representa ausência.
      if (cells.some((cell) => cell !== "")) rows.push([iso, ...cells].join(";"));
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

  /**
   * Quais camadas este gráfico tem PARA DESENHAR na janela escolhida.
   *
   * Presença no payload não basta. Uma camada pode existir com todas as séries
   * nulas — sensor fora do ar, ou uma janela do modelo que ainda não cobre o
   * recorte pedido —, e derivar o rótulo da presença fazia o cartão anunciar
   * "Bruto 5 min · Média horária · WRF" sobre um canvas com só a curva do modelo.
   * A regra é a mesma de `layerPoints`, para o texto do cartão e o que o canvas
   * mostra concordarem por construção em vez de por manutenção.
   */
  function availableLayers(chart) {
    const from = windowStart();
    return LAYERS.filter((layer) => {
      const data = chart.layers[layer.id];
      if (!data) return false;
      return layerSeriesIds(chart, layer.id).some((seriesId) => layerHasData(data, seriesId, from));
    });
  }

  /**
   * Há alguma coluna para o CSV nesta janela?
   *
   * Não é `availableLayers`: o CSV exporta TODAS as séries de todas as camadas,
   * inclusive a bruta das parcelas que o desenho omite, então a pergunta é mais
   * ampla que a do rótulo do cartão. Percorre na mesma ordem de `exportCsv` e
   * para na primeira coluna que existiria.
   */
  function hasExportableData(chart) {
    const from = windowStart();
    return chart.series.some((series) => LAYERS.some((layer) => layerHasData(chart.layers[layer.id], series.id, from)));
  }

  /** Interseção do que o gráfico tem com o que está ligado: o que o canvas mostra. */
  function drawnLayers(chart) {
    return availableLayers(chart).filter((layer) => state.layers.has(layer.id));
  }

  /**
   * Deixa o texto do cartão dizer o que o canvas está mostrando.
   *
   * O cabeçalho e a alternativa textual listavam as camadas DISPONÍVEIS, que não
   * mudam: com as três desligadas o cartão continuava anunciando "Bruto 5 min ·
   * Média horária · WRF" sobre um canvas totalmente vazio — sem eixos, sem
   * grade, sem aviso —, indistinguível de falha de carregamento. Quando não
   * sobra nada para desenhar, o cartão passa a dizer por quê: ou nenhuma camada
   * está selecionada, ou as selecionadas não existem para aquela variável (a
   * chuva e a radiação PAR não têm WRF).
   */
  function syncCardText(chart, drawnCount) {
    const labels = drawnLayers(chart).map((layer) => layerLabel(chart, layer));
    const span = state.layerLabels.get(chart.id);
    if (span) span.textContent = labels.join(" · ");

    const canvas = state.canvases.get(chart.id);
    if (canvas) {
      // Sem camadas o canvas não desenha nada, e prometer três na alternativa
      // textual seria descrever um gráfico que não está ali. O motivo vem logo
      // depois, no parágrafo de aviso.
      const descricao = labels.length ? `camadas ${labels.join(", ")}` : "sem camadas para desenhar";
      canvas.setAttribute(
        "aria-label",
        `${chart.title} — ${descricao}. Use o botão CSV para a versão textual dos dados.`
      );
    }

    // O botão de CSV é a alternativa textual do gráfico, e é o caminho de quem
    // quer os números — mas quando não há uma única leitura na janela ele não tem
    // o que gerar: `exportCsv` saía sem colunas, sem arquivo e SEM AVISO NENHUM.
    // Clicar respondia com o nada absoluto, indistinguível de um download
    // bloqueado pelo navegador. Desabilitado, o cartão diz antes do clique que
    // não há o que baixar, e o motivo já está no parágrafo abaixo do canvas.
    // Depende da janela, então é reavaliado a cada redesenho, junto do resto.
    const download = state.downloads.get(chart.id);
    if (download) {
      const exportavel = hasExportableData(chart);
      download.disabled = !exportavel;
      download.setAttribute(
        "aria-label",
        exportavel
          ? `Baixar os dados de ${chart.title} em CSV`
          : `Sem dados de ${chart.title} nesta janela para baixar em CSV`
      );
    }

    const notice = state.notices.get(chart.id);
    if (notice) {
      notice.hidden = drawnCount > 0;
      // Três motivos diferentes para um canvas vazio, e o leitor precisa saber qual.
      // O terceiro é o que a estação de fato produz: quando um sensor sai do ar, o
      // exportador omite a série e o gráfico chega sem nenhuma camada desenhável.
      // Dizer "nenhuma das selecionadas" ali culparia a escolha do leitor por uma
      // ausência que não é dele — não há recorte de camada que traga o dado de volta.
      if (!state.layers.size) {
        notice.textContent = "Nenhuma camada selecionada — ative pelo menos uma acima.";
      } else if (!availableLayers(chart).length) {
        // Sem interpolar o título: ele é o cabeçalho logo acima, e minusculizá-lo
        // estragaria as siglas ("Radiação PAR" viraria "radiação par").
        notice.textContent = "Sem registro nesta janela — nem a estação nem o modelo publicaram dados desta variável.";
      } else {
        notice.textContent = "Nenhuma das camadas selecionadas tem dados para esta variável.";
      }
    }
  }

  /**
   * Ampliação de um gráfico num `<dialog>` nativo.
   *
   * `showModal()` traz prisão de foco, fechamento por Escape, fundo inerte e
   * `::backdrop` sem uma linha de código nossa — foi justamente a gestão de foco
   * escrita à mão que produziu os defeitos de acessibilidade dos modais desta
   * página. `closedby="any"` dá o clique-fora de forma declarativa; o ouvinte
   * abaixo cobre o navegador que ainda não o implementa.
   *
   * O gráfico é criado ao abrir e destruído ao fechar: manter mais nove
   * instâncias vivas custaria memória por uma tela que quase sempre está fechada.
   * Os dados saem do mesmo `buildDatasets`, então o recorte e as camadas ligadas
   * acompanham o que o cartão mostra.
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

    // `method="dialog"` fecha sem handler e devolve o foco ao botão que abriu.
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

    const config = chartConfig(chart, themeColors(), { escala: 1.6 });
    let instance = null;
    dialog.addEventListener("close", () => {
      if (instance) instance.destroy();
      dialog.remove();
    });
    // Clique no próprio <dialog> é clique no backdrop: o conteúdo está nos filhos.
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
    // A página estática abria cada PNG num modal do Bootstrap — era assim que se
    // lia o detalhe, e a versão interativa herdou os gráficos sem herdar a
    // ampliação. Num cartão de 448x240 com ~2000 amostras brutas são 4,5 pontos
    // por pixel e o traço vira mancha; o diálogo devolve a área que o PNG tinha.
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

    // Fica logo abaixo do canvas, escondido enquanto há o que desenhar: é o
    // texto que substitui o gráfico em branco quando nenhuma camada sobra.
    const notice = node("p", "monitor-pending");
    notice.hidden = true;
    card.appendChild(notice);
    state.notices.set(chart.id, notice);

    // O cabeçalho, a alternativa textual e o aviso saem do mesmo lugar que o
    // desenho usa, e não da lista fixa de camadas disponíveis.
    syncCardText(chart, drawnLayers(chart).length);

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
          if (!chart) continue;
          state.created.add(chart.id);
          if (!state.charts.has(chart.id)) drawChart(chart);
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
    const stationEnd = parseStationTime(window_.station_end || window_.end);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      // `end` é o fim do DOCUMENTO e passa do fim do registro quando o acumulado do
      // modelo vai à frente. Anunciar "N dias" sobre um intervalo maior que N
      // descreveria mal o que está na tela, então a previsão é nomeada à parte em
      // vez de diluída no mesmo intervalo.
      //
      // A contagem de dias é MEDIDA sobre os carimbos, não lida de `window.days`:
      // os dois só coincidem no caminho padrão do exportador — com `--end` explícito
      // o início e o comprimento são independentes, e imprimir o campo ao lado de um
      // intervalo calculado à parte é como o rótulo passa a contradizer as datas que
      // ele mesmo emoldura.
      const dias = Math.max(1, Math.round((stationEnd - start) / DAY_MS));
      const registro = `Janela móvel de ${dias} ${dias === 1 ? "dia" : "dias"} — ${formatStampYear(start)} a ${formatStampYear(stationEnd)} (horário local)`;
      el("monitorPeriodo").textContent =
        Number.isFinite(stationEnd) && end > stationEnd ? `${registro}; modelo até ${formatStampYear(end)}` : registro;
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
      // Sem `?v=`: o arquivo é reescrito no mesmo nome a cada hora, então quem
      // decide o frescor é o cabeçalho da requisição, não a URL.
      response = await fetch(`${state.base}/monitoring.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      showEmpty(
        "Os dados de monitoramento ainda não foram publicados para esta estação. " +
          "Eles são anexados ao site no deploy, separadamente das páginas."
      );
      return;
    }

    // A leitura do corpo fica FORA do try da rede porque as duas falhas pedem
    // respostas diferentes de quem opera o deploy. Ausência é 404; corpo
    // incompleto é resposta 200 com JSON cortado no meio, que é o estado normal
    // enquanto o envio do arquivo está em curso — ele é reescrito de hora em
    // hora com o mesmo nome. Dizer "ainda não foi publicado" nesse caso manda
    // quem opera o deploy procurar um arquivo que já está no servidor, quando
    // basta esperar o envio terminar.
    try {
      state.payload = await response.json();
    } catch (error) {
      // O detalhe técnico vai para o console: a mensagem do motor de JS é em
      // inglês e não diz nada a quem lê a página, mas é o que distingue corpo
      // truncado de documento corrompido para quem investiga.
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
