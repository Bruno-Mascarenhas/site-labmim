// The interactive timeline is 1-based: index 1 is the slider minimum.
const CHART_TIMELINE_FIRST_INDEX = 1;
// Forecast timestamps carry the metadata's wall-clock digits in UTC fields
// (see app.parseDateTime) and the map label prints those digits, so charts and
// CSV must format in UTC too — local time would shift them off the map.
const CHART_FORECAST_TIME_ZONE = "UTC";
const CSV_EXCEL_UTF8_BOM = "\ufeff";
const CSV_FIELD_SEPARATOR = ";";
const CSV_VALUE_FRACTION_DIGITS = 2;
const CSV_COORDINATE_FRACTION_DIGITS = 4;
const STEPPED_MODE_FILLING_STEP_BEFORE_EACH_POINT = "after";
const STEP_ENDING_AT_CURSOR_INTERACTION_MODE = "stepEndingAtCursor";

// The two card surfaces a series is drawn on: assets/css/maps.css and the dark override in
// assets/css/theme.css (.chart-modal-body, div[id^="chartContainer"]).
const CHART_SURFACES = ["#ffffff", "#161b22"];
const CHART_SERIES_FALLBACK = "#0d6efd";

const SERIES_POINT_RADIUS_PX = 3;
const MOST_POINTS_DRAWN_WITH_MARKERS = 96;
const PARTIAL_COVERAGE_POINT_RADIUS_PX = 5;
const PARTIAL_COVERAGE_POINT_BORDER_WIDTH_PX = 2;
const HOLLOW_POINT_FILL = "rgba(0, 0, 0, 0)";
const INSTANT_UPDATE_MODE_REFRESHING_POINT_OPTIONS = "instantRefresh";

function relativeLuminance(hex) {
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastRatio(a, b) {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function themeInvariantSeriesColor(colors) {
  if (!Array.isArray(colors) || !colors.length) return CHART_SERIES_FALLBACK;
  const worstContrast = (color) => Math.min(...CHART_SURFACES.map((surface) => contrastRatio(color, surface)));
  return colors.reduce((best, color) => (worstContrast(color) > worstContrast(best) ? color : best), colors[0]);
}

function itemsOfStepEndingAtCursor(chart, event, options, useFinalPosition) {
  const cursorX = Chart.helpers.getRelativePosition(event, chart).x;
  return chart.getSortedVisibleDatasetMetas().flatMap((meta) => {
    const index = meta.data.findIndex((point) => point.getProps(["x"], useFinalPosition).x >= cursorX);
    const point = meta.data[index];
    const closesNoStep = chart.data.datasets[meta.index].openingStepAnchorIndexes.has(index);
    return point && !point.skip && !closesNoStep ? [{ element: point, datasetIndex: meta.index, index }] : [];
  });
}

class ChartsManager {
  constructor(app) {
    this.app = app;
    this.charts = new Map();
    this.previewCharts = new Map();
    this.timeSeriesData = {};
    this.timeSeriesCache = new Map();
    this.domainSummaryCache = new Map();
    this.unusableCellSeriesFiles = new Set();
    this.cellSeriesFilesSkippedByPanel = new Set();
    this.abortController = null;
    this.previewAbortController = null;
    this.chartJsLoading = null;
    this.modalChartJsPrefetch = null;
    this.ui = this._cacheUIElements();

    this._setupModalListeners();
  }

  ensureChartJs() {
    if (typeof Chart !== "undefined") return Promise.resolve(true);
    if (!this.chartJsLoading) {
      this.chartJsLoading = new Promise((resolve) => {
        const script = document.createElement("script");
        const fail = () => {
          script.remove();
          this.chartJsLoading = null;
          console.error("[Charts] Error loading Chart.js:", new Error(`Chart.js did not load from ${script.src}`));
          resolve(false);
        };
        script.src = window.SITE_RUNTIME_CONFIG.vendor.chartJs;
        script.onload = () => (typeof Chart === "undefined" ? fail() : resolve(true));
        script.onerror = fail;
        document.head.appendChild(script);
      });
    }
    return this.chartJsLoading;
  }

  _cacheUIElements() {
    return {
      modal: document.getElementById("timeSeriesModal"),
      title: document.getElementById("timeSeriesModalTitle"),
      closeBtn: document.getElementById("timeSeriesCloseBtn"),
      exportBtn: document.getElementById("timeSeriesExportBtn"),
      loadingOverlay: document.getElementById("timeSeriesLoadingOverlay"),
      chartValueCanvas: document.getElementById("chartCanvasValue"),
      chartEnergyCanvas: document.getElementById("chartCanvasEnergy"),
      chartEnergyContainer: document.getElementById("chartContainerEnergy"),
    };
  }

  _setupModalListeners() {
    const { closeBtn, exportBtn, modal } = this.ui;

    if (closeBtn) closeBtn.addEventListener("click", () => this.closeModal());
    if (exportBtn) exportBtn.addEventListener("click", () => this.exportCurrentData());
    if (modal)
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.closeModal();
      });
    document.addEventListener("keydown", (e) => {
      if (!modal || modal.style.display !== "flex") return;
      if (e.key === "Escape") {
        this.closeModal();
        return;
      }
      if (e.key === "Tab") this._trapModalFocus(e);
    });
    window.addEventListener("labmim-theme-change", () => this.refreshChartTheme());
  }

  async loadTimeSeriesData(selectedCell, domain, variableType) {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const lat = selectedCell?.lat;
      const lng = selectedCell?.lng;
      const cellIndex = Number.isInteger(selectedCell?.cellIndex)
        ? selectedCell.cellIndex
        : await this.findCellIndex(lat, lng, domain, signal);
      if (cellIndex === null) return {};

      const timeSeriesData = {};
      const variableKeys = this._getRequiredVariableKeys(variableType);

      await Promise.all(
        variableKeys.map(async (variableKey) => {
          const result = await this._loadVariableSeries(variableKey, domain, cellIndex, signal);
          if (result?.data?.length) {
            timeSeriesData[variableKey] = result;
          }
        })
      );

      if (signal.aborted) return {};

      this.timeSeriesData = timeSeriesData;
      // The caller only redraws when some series came back, so the previous
      // cell's charts must be torn down here.
      if (!timeSeriesData[variableType]?.data?.length) {
        this._showModalEmptyState("Sem dados para esta célula nesta variável.");
      }
      return timeSeriesData;
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("[Charts] Error loading time series:", error);
        // Without this the CSV button exports the previous cell's values under
        // the newly selected coordinates.
        this.timeSeriesData = {};
        this._showModalEmptyState("Não foi possível carregar a série temporal desta célula.");
      }
      return {};
    }
  }

  _showModalEmptyState(message, { exportable = false } = {}) {
    this.charts.forEach((chart) => chart.destroy());
    this.charts.clear();
    if (this.ui.chartEnergyContainer) this.ui.chartEnergyContainer.style.display = "none";
    if (this.ui.exportBtn) {
      this.ui.exportBtn.disabled = !exportable;
      if (exportable) this.ui.exportBtn.removeAttribute("aria-disabled");
      else this.ui.exportBtn.setAttribute("aria-disabled", "true");
    }

    const body = this.ui.modal?.querySelector(".chart-modal-body");
    if (!body) return;
    let box = body.querySelector(".chart-empty-state");
    if (!box) {
      box = document.createElement("div");
      box.className = "chart-empty-state";
      // Announces the state change without stealing focus from the close button.
      box.setAttribute("role", "status");
      // Inline: the build-generated modal markup carries no class for this state.
      box.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
        "text-align:center;padding:1.5rem;color:var(--text-secondary,#666);background:var(--bg-secondary);";
      body.appendChild(box);
    }
    box.textContent = message;
    box.style.display = "flex";
  }

  _clearModalEmptyState() {
    const box = this.ui.modal?.querySelector(".chart-empty-state");
    if (box) box.style.display = "none";
    if (this.ui.exportBtn) {
      this.ui.exportBtn.disabled = false;
      this.ui.exportBtn.removeAttribute("aria-disabled");
    }
  }

  async findCellIndex(lat, lng, domain, signal) {
    try {
      let gridLayer = this.app?.gridLayers?.[domain];

      // The shared loader is compact-format aware and dedups in flight; a fetch
      // of our own would pull the multi-MB legacy GeoJSON instead.
      if (!gridLayer && this.app?.loadGridLayer) {
        gridLayer = await this.app.loadGridLayer(domain);
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }

      if (gridLayer) {
        const layers = gridLayer.getLayers();
        let closestIndex = 0,
          minDist = Infinity;
        layers.forEach((layer, i) => {
          const bounds = layer.getBounds?.();
          if (!bounds) return;
          const center = bounds.getCenter();
          const distance = this._squaredDistance(lat, lng, center.lat, center.lng);
          if (distance < minDist) {
            minDist = distance;
            closestIndex = this.app?.getCellIndexForLayer?.(layer, i) ?? i;
          }
        });
        return closestIndex;
      }

      if (!this.app?.gridGeoJsonPath) return null;
      const res = await fetch(this.app.gridGeoJsonPath(domain), { signal });
      if (!res.ok) return null;
      const geoJson = await res.json();

      let closestIndex = 0,
        minDist = Infinity;
      (geoJson.features || []).forEach((feature, i) => {
        if (feature.geometry?.type === "Polygon") {
          const center = this._centroid(feature.geometry.coordinates[0]);
          const distance = this._squaredDistance(lat, lng, center.lat, center.lng);
          if (distance < minDist) {
            minDist = distance;
            closestIndex = Number.isInteger(feature.properties?.linear_index) ? feature.properties.linear_index : i;
          }
        }
      });
      return closestIndex;
    } catch (error) {
      if (error.name !== "AbortError") console.error("[Charts] Error finding cell:", error);
      throw error;
    }
  }

  openModal() {
    this.modalChartJsPrefetch = this.ensureChartJs();
    if (this.ui.modal) {
      this._returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.ui.modal.style.display = "flex";
      if (this.ui.closeBtn) this.ui.closeBtn.focus();
    }
  }

  _trapModalFocus(event) {
    const modal = this.ui.modal;
    const focusables = [
      ...modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
    ].filter((el) => !el.disabled && el.getClientRects().length > 0);
    if (!focusables.length) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  isModalOpen() {
    return !!this.ui.modal && this.ui.modal.style.display === "flex";
  }

  closeModal() {
    if (this.ui.modal) this.ui.modal.style.display = "none";
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this._returnFocusEl && document.contains(this._returnFocusEl)) {
      this._returnFocusEl.focus();
    }
    this._returnFocusEl = null;
  }

  async renderChartsForVariable(variableType) {
    const config = VARIABLES_CONFIG[variableType];
    if (!config) return;

    // Before the no-data return: the header must name the REQUESTED variable
    // even when the answer is "no data".
    this.ui.title.innerHTML = `<i class="fas ${this._getIcon(variableType)}" aria-hidden="true"></i> Série Temporal: ${this._seriesLabel(variableType, config)}`;

    // The requested variable can be missing while a companion series loaded,
    // and the caller only checks whether the payload has any key at all.
    if (!this.timeSeriesData?.[variableType]?.data?.length) {
      this._showModalEmptyState("Sem dados para esta célula nesta variável.");
      return;
    }

    const signal = this.abortController?.signal;
    const chartJsReady = this.modalChartJsPrefetch ?? this.ensureChartJs();
    this.modalChartJsPrefetch = null;
    if (!(await chartJsReady)) {
      if (signal?.aborted) return;
      this._showModalEmptyState("Não foi possível carregar os gráficos. A série continua disponível no botão CSV.", {
        exportable: true,
      });
      return;
    }
    if (signal?.aborted || !this.timeSeriesData?.[variableType]?.data?.length) return;

    this._clearModalEmptyState();

    const timeData = this._seriesWithHourGaps(this.timeSeriesData[variableType].data);
    const energySeries = this._prepareChartData(variableType, "energy", config, timeData);
    const sharedAxisOpensHourBefore = energySeries?.stepTotal === true && Number.isFinite(energySeries.data[0]);

    this._updateOrCreateChart(
      "chartCanvasValue",
      timeData,
      this._prepareChartData(variableType, "value", config, timeData),
      sharedAxisOpensHourBefore
    );

    const energyContainer = this.ui.chartEnergyContainer;
    if (energySeries?.data.some(Number.isFinite)) {
      energyContainer.style.display = "block";
      this._updateOrCreateChart("chartCanvasEnergy", timeData, energySeries, sharedAxisOpensHourBefore);
    } else {
      energyContainer.style.display = "none";
    }
  }

  reloadChartsWithNewParameters() {
    const { type, selectedCell } = this.app?.state || {};
    if (type && selectedCell && this.timeSeriesData) {
      this.renderChartsForVariable(type);
    }
  }

  /**
   * Called when a new pipeline run replaces the data files in place, so
   * nothing computed from the previous run's bytes survives.
   */
  clearCaches() {
    this.timeSeriesCache.clear();
    this.domainSummaryCache.clear();
    this.unusableCellSeriesFiles.clear();
    this.cellSeriesFilesSkippedByPanel.clear();
  }

  async renderDomainSummary(variableType, domain, elements = {}) {
    const config = VARIABLES_CONFIG[variableType];
    if (!config) return;
    const chartJsReady = this.ensureChartJs();

    if (this.previewAbortController) {
      this.previewAbortController.abort();
    }
    this.previewAbortController = new AbortController();
    const signal = this.previewAbortController.signal;

    const { canvasId = "variablePreviewCanvas", statsContainer, titleElement, labelElement, domainElement } = elements;

    if (titleElement) {
      titleElement.textContent = config.accumulation ? this._stepLabel(config) : config.optionLabel || config.label;
    }
    if (labelElement) {
      // Same node `updateVariablePreviewShell` (map-manager.js) writes to, and
      // this one writes last. Dimensionless variables (EPS_SKY, KT) carry no
      // unit, so the separator has to go with it.
      const source = config.sourceId || config.id;
      labelElement.textContent = config.unit ? `${source} · ${config.unit}` : source;
    }
    if (domainElement) {
      domainElement.textContent = this.app?.getDomainLabel ? this.app.getDomainLabel(domain) : domain;
      domainElement.title = `Domínio técnico: ${domain}`;
    }
    if (statsContainer) {
      statsContainer.innerHTML = '<div class="variable-preview-empty">Carregando resumo...</div>';
    }

    try {
      const result = await this._loadDomainMeanSeries(variableType, domain, signal);
      if (signal.aborted) return;

      if (!result?.series?.length) {
        this._renderEmptyPreview(
          canvasId,
          statsContainer,
          "Sem dados disponíveis para esta variável no domínio atual."
        );
        return;
      }

      const meanCoversDaylightOnly = this._meanCoversDaylightOnly(variableType, config, domain);
      this._renderPreviewStats(statsContainer, result.stats, config, meanCoversDaylightOnly);
      if (!(await chartJsReady)) {
        if (!signal.aborted) this._showPreviewChartNotice(canvasId, "Não foi possível carregar o gráfico.");
        return;
      }
      if (signal.aborted) return;
      this._renderPreviewChart(canvasId, result.series, config, meanCoversDaylightOnly);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("[Charts] Error rendering domain summary:", error);
      this._renderEmptyPreview(canvasId, statsContainer, "Não foi possível carregar o resumo visual.");
    }
  }

  async _loadDomainMeanSeries(variableType, domain, signal) {
    const config = VARIABLES_CONFIG[variableType];
    if (!config?.id) return null;
    if (this.app?.hasPublishedSteps && !this.app.hasPublishedSteps(variableType, domain)) return null;

    const variableId = this._getVariableId(variableType, config);
    const maxHour = this._getAvailableHourCount();
    const currentHour = parseInt(this.app?.state?.index, 10) || 1;
    // Run version in the key: after a daily regeneration the same names hold
    // a different forecast, so entries from the old run must never be served.
    const cacheKey = `${this.app?.dataVersion || "v0"}:${domain}:${variableId}:domain-summary:${maxHour}`;
    const cached = this.domainSummaryCache.get(cacheKey);
    if (cached) return this._withCurrentStats(cached, currentHour);

    // One consolidated artifact instead of averaging every hour's full-domain
    // JSON client-side.
    const artifactSeries = await this._loadSummaryArtifactSeries(variableId, domain, maxHour, signal);
    if (artifactSeries) {
      const baseResult = { series: artifactSeries };
      this.domainSummaryCache.set(cacheKey, baseResult);
      return this._withCurrentStats(baseResult, currentHour);
    }

    const { series, transientFailures } = await this._collectHourlySeries(
      variableId,
      domain,
      maxHour,
      8,
      signal,
      (hour, data) => {
        const summary = this._summarizeValues(data.values);
        if (!summary) return null;
        return {
          hour,
          value: summary.mean,
          min: summary.min,
          max: summary.max,
          finiteCells: summary.count,
          totalCells: data.values.length,
          timestamp: this._timestampForHour(hour, data),
        };
      }
    );

    const baseResult = { series };
    // A series missing only structurally-absent hours (404) is complete; one
    // truncated by a transient failure is not, and must not be cached.
    if (transientFailures === 0) {
      this.domainSummaryCache.set(cacheKey, baseResult);
    }
    return this._withCurrentStats(baseResult, currentHour);
  }

  /**
   * Reads {D}_{VAR}.summary.json (domain-summary-v1): per-step domain
   * mean/min/max in one request. Null on any missing/malformed artifact —
   * callers fall back to the legacy one-fetch-per-hour sweep.
   */
  async _loadSummaryArtifactSeries(variableId, domain, maxHour, signal) {
    const feature = this.app?.timeline?.features?.domain_summary;
    if (feature?.format !== "domain-summary-v1" || typeof feature.template !== "string") return null;

    try {
      const url = this._artifactUrl(feature.template, domain, variableId);
      const data = this.app?._cachedFetch
        ? await this.app._cachedFetch(url, { signal })
        : await fetch(url, { signal }).then((res) => (res.ok ? res.json() : null));
      if (data?.format !== "domain-summary-v1" || !Array.isArray(data.indices)) return null;

      const series = [];
      for (let i = 0; i < data.indices.length; i++) {
        const hour = data.indices[i];
        if (!Number.isInteger(hour) || hour < CHART_TIMELINE_FIRST_INDEX || hour > maxHour) continue;
        const value = data.mean?.[i];
        if (!Number.isFinite(value)) continue;
        series.push({
          hour,
          value,
          min: Number.isFinite(data.min?.[i]) ? data.min[i] : value,
          max: Number.isFinite(data.max?.[i]) ? data.max[i] : value,
          finiteCells: Number.isInteger(data.finite_cells?.[i]) ? data.finite_cells[i] : null,
          totalCells: Number.isInteger(data.cells) ? data.cells : null,
          timestamp: this._timestampForHour(hour, { metadata: { date_time: data.date_times?.[i] } }),
        });
      }
      return series.length ? series : null;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return null;
    }
  }

  /**
   * `transientFailures` counts only network errors and 5xx. A deterministic
   * 404 (a file the pipeline never exports, e.g. SWDOWN night hours) is an
   * expected gap, so a complete-but-sparse series stays cacheable.
   */
  async _collectHourlySeries(variableId, domain, maxHour, batchSize, signal, mapHourData) {
    const series = [];
    let transientFailures = 0;

    for (let start = 1; start <= maxHour; start += batchSize) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const batchEnd = Math.min(start + batchSize - 1, maxHour);
      const batch = [];

      for (let hour = start; hour <= batchEnd; hour++) {
        batch.push(
          this._fetchHourJson(variableId, domain, hour, signal)
            .then((data) => (data ? mapHourData(hour, data) : null))
            .catch((err) => {
              if (err?.name === "AbortError") throw err;
              transientFailures += 1;
              return null;
            })
        );
      }

      const batchResults = await Promise.all(batch);
      series.push(...batchResults.filter(Boolean));
    }

    return { series, transientFailures };
  }

  _withCurrentStats(result, currentHour) {
    return {
      series: result.series,
      stats: this._aggregateSeriesStats(result.series, currentHour),
    };
  }

  _summarizeValues(values) {
    if (!Array.isArray(values)) return null;

    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    values.forEach((value) => {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
      const numericValue = Number(value);
      count += 1;
      sum += numericValue;
      min = Math.min(min, numericValue);
      max = Math.max(max, numericValue);
    });

    if (!count) return null;
    return { mean: sum / count, min, max, count };
  }

  _aggregateSeriesStats(series, currentHour) {
    if (!series?.length) return null;

    // No entry for the current timestep (e.g. SWDOWN night hours) means
    // "Atual" is genuinely unavailable; another hour's value would read as a
    // measurement next to a map that says "sem dados".
    const current = series.find((entry) => entry.hour === currentHour) || null;
    const weightedByFiniteCells = series.every((entry) => Number.isInteger(entry.finiteCells) && entry.finiteCells > 0);
    const mean = weightedByFiniteCells
      ? series.reduce((sum, entry) => sum + entry.value * entry.finiteCells, 0) /
        series.reduce((sum, entry) => sum + entry.finiteCells, 0)
      : series.reduce((sum, entry) => sum + entry.value, 0) / series.length;
    const min = Math.min(...series.map((entry) => entry.min));
    const max = Math.max(...series.map((entry) => entry.max));
    const meanWeightsPartialSteps = weightedByFiniteCells && series.some((entry) => this._coversPartOfDomain(entry));

    return { current: current ? current.value : null, mean, min, max, meanWeightsPartialSteps };
  }

  _coversPartOfDomain(entry) {
    return (
      Number.isInteger(entry?.finiteCells) && Number.isInteger(entry.totalCells) && entry.finiteCells < entry.totalCells
    );
  }

  _domainCoverageLabel(entry) {
    const coveredPercent = Math.floor((100 * entry.finiteCells) / entry.totalCells);
    return coveredPercent < 1 ? "menos de 1% das células com valor" : `${coveredPercent}% das células com valor`;
  }

  _applyPreviewPoints(chartOrConfig, series, color) {
    const dataset = chartOrConfig.data.datasets[0];
    const coversPart = series.map((entry) => this._coversPartOfDomain(entry));
    dataset.pointRadius = coversPart.map((partial) => (partial ? PARTIAL_COVERAGE_POINT_RADIUS_PX : 0));
    dataset.pointBorderWidth = coversPart.map((partial) => (partial ? PARTIAL_COVERAGE_POINT_BORDER_WIDTH_PX : 0));
    dataset.pointBackgroundColor = coversPart.map((partial) => (partial ? HOLLOW_POINT_FILL : color));
    dataset.pointBorderColor = color;
  }

  _meanCoversDaylightOnly(variableType, config, domain) {
    if (config.publishedSteps !== "daylight-zero-night") return false;

    const variableId = this._getVariableId(variableType, config);
    const ranges = this.app?.availabilityRanges?.(variableId, domain);
    if (!Array.isArray(ranges)) return true;

    const publishedSteps = ranges.reduce((sum, [first, last]) => sum + last - first + 1, 0);
    const firstIndex = this.app?.timeline?.indexMin ?? CHART_TIMELINE_FIRST_INDEX;
    return publishedSteps < this._getAvailableHourCount() - firstIndex + 1;
  }

  _renderPreviewStats(container, stats, config, meanCoversDaylightOnly) {
    if (!container || !stats) return;

    const items = [
      ["Atual", stats.current],
      [meanCoversDaylightOnly ? "Média diurna" : "Média", stats.mean],
      ["Mín", stats.min],
      ["Máx", stats.max],
    ];

    container.innerHTML = items
      .map(
        ([label, value]) => `
          <div class="variable-preview-stat">
            <span>${label}</span>
            <strong>${this._formatPreviewValue(value, config.unit)}</strong>
          </div>
        `
      )
      .join("");
    if (stats.meanWeightsPartialSteps) {
      container.insertAdjacentHTML(
        "beforeend",
        '<p class="variable-preview-note">A média pesa cada passo pelo número de células com valor. ' +
          "Os pontos vazados marcam os passos em que só parte das células tem valor.</p>"
      );
    }
  }

  _renderPreviewChart(canvasId, series, config, meanCoversDaylightOnly) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return;
    this._clearPreviewChartNotice(canvasId);

    const stepTotal = config.stepTotal === true;
    const gapped = this._seriesWithHourGaps(series);
    const drawn = this._withOpeningStepAnchors(
      gapped,
      gapped.map((entry) => entry.value),
      stepTotal
    );
    const labels = drawn.entries.map((entry) =>
      new Date(entry.timestamp).toLocaleString("pt-BR", {
        timeZone: CHART_FORECAST_TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
      })
    );
    const chartData = drawn.data;
    const firstSeriesLabel = labels[drawn.entries.length - gapped.length];
    const chartColor = themeInvariantSeriesColor(config.colors);
    const chartLabel = `Média do domínio · ${this._stepLabel(config)}`;
    const tooltipLabel = (ctx) => {
      const value = this._formatPreviewValue(ctx.parsed.y, config.unit);
      const entry = drawn.entries[ctx.dataIndex];
      return this._coversPartOfDomain(entry) ? [value, this._domainCoverageLabel(entry)] : value;
    };

    // A <canvas> exposes no content to the accessibility tree (WCAG 1.1.1).
    if (labels.length) {
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `Média do domínio para ${this._stepLabel(config)}${config.unit ? ` em ${config.unit}` : ""}, ` +
          `de ${firstSeriesLabel} a ${labels[labels.length - 1]}. ` +
          (meanCoversDaylightOnly
            ? "As estatísticas do resumo desta prévia cobrem só as horas diurnas publicadas; a noite não entra na média."
            : "As estatísticas do período estão no resumo desta prévia.")
      );
    }

    let chartInstance = this.previewCharts.get(canvasId);

    if (chartInstance) {
      this._applySeriesToChart(chartInstance, labels, chartData, chartLabel, chartColor);
      this._applySeriesShape(chartInstance, stepTotal, drawn.anchorIndexes);
      chartInstance.options.scales.y.title.text = config.unit;
      chartInstance.options.plugins.tooltip.callbacks.label = tooltipLabel;
      this._applyPreviewPoints(chartInstance, drawn.entries, chartColor);
      this._applyChartTheme(chartInstance, chartColor);
      chartInstance.update(INSTANT_UPDATE_MODE_REFRESHING_POINT_OPTIONS);
      return;
    }

    const previewConfig = this._buildChartConfig(chartData, labels, chartLabel, chartColor, config.unit);
    this._applySeriesShape(previewConfig, stepTotal, drawn.anchorIndexes);
    this._applyPreviewPoints(previewConfig, drawn.entries, chartColor);
    chartInstance = new Chart(canvas.getContext("2d"), previewConfig);
    chartInstance.options.plugins.legend.display = false;
    chartInstance.options.scales.x.ticks.maxTicksLimit = 6;
    chartInstance.options.plugins.tooltip.callbacks.label = tooltipLabel;
    chartInstance.update("none");
    this.previewCharts.set(canvasId, chartInstance);
  }

  _renderEmptyPreview(canvasId, statsContainer, message) {
    const chartInstance = this.previewCharts.get(canvasId);
    if (chartInstance) {
      chartInstance.destroy();
      this.previewCharts.delete(canvasId);
    }
    this._clearPreviewChartNotice(canvasId);
    if (statsContainer) {
      statsContainer.innerHTML = `<div class="variable-preview-empty">${message}</div>`;
    }
  }

  _showPreviewChartNotice(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    const area = canvas?.parentElement;
    if (!area) return;
    let notice = area.querySelector(".variable-preview-empty");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "variable-preview-empty";
      notice.setAttribute("role", "status");
      area.appendChild(notice);
    }
    notice.textContent = message;
    canvas.hidden = true;
  }

  _clearPreviewChartNotice(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.parentElement?.querySelector(".variable-preview-empty")?.remove();
    canvas.hidden = false;
  }

  _formatPreviewValue(value, unit) {
    // Number(null) is 0, which would render a fake "0 <unit>" instead of N/D.
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/D";
    const numericValue = Number(value);
    // Outside the hundreds-scale units the decimals follow MAGNITUDE, not unit:
    // a whole-domain precipitation mean lives in the hundredths, because WRF
    // writes zero over most of the grid.
    const isCoarseUnit = unit === "%" || unit === "W/m²" || unit === "hPa";
    const abs = Math.abs(numericValue);
    const precision = isCoarseUnit || abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return `${numericValue.toFixed(precision)} ${unit}`;
  }

  _updateOrCreateChart(
    canvasId,
    timeData,
    { data: seriesData, label: chartLabel, unit: chartUnit, color: chartColor, stepTotal },
    sharedAxisOpensHourBefore = false
  ) {
    const drawn = this._withOpeningStepAnchors(timeData, seriesData, stepTotal, sharedAxisOpensHourBefore);
    const chartData = drawn.data;
    const labels = drawn.entries.map((entry) => {
      if (!entry._formattedLabel) {
        entry._formattedLabel = new Date(entry.timestamp).toLocaleString("pt-BR", {
          timeZone: CHART_FORECAST_TIME_ZONE,
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return entry._formattedLabel;
    });

    const canvas = this._getChartCanvas(canvasId);
    const firstSeriesLabel = labels[drawn.entries.length - timeData.length];
    // A <canvas> exposes no content to the accessibility tree (WCAG 1.1.1).
    if (canvas && labels.length) {
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `Série temporal de ${chartLabel}${chartUnit ? ` em ${chartUnit}` : ""}, ` +
          `de ${firstSeriesLabel} a ${labels[labels.length - 1]}. ` +
          "Use o botão CSV para a versão textual dos dados."
      );
    }

    let chartInstance = this.charts.get(canvasId);

    if (chartInstance) {
      this._applySeriesToChart(chartInstance, labels, chartData, chartLabel, chartColor);
      this._applySeriesShape(chartInstance, stepTotal, drawn.anchorIndexes);
      chartInstance.data.datasets[0].pointRadius = this._seriesPointRadii(drawn);
      chartInstance.data.datasets[0].pointBackgroundColor = chartColor;
      chartInstance.options.scales.y.title.text = chartUnit;
      chartInstance.options.plugins.tooltip.callbacks.label = (ctx) => `${ctx.parsed.y.toFixed(2)} ${chartUnit}`;
      this._applyChartTheme(chartInstance, chartColor);
      chartInstance.update(INSTANT_UPDATE_MODE_REFRESHING_POINT_OPTIONS);
    } else {
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const chartConfig = this._buildChartConfig(chartData, labels, chartLabel, chartColor, chartUnit);
      this._applySeriesShape(chartConfig, stepTotal, drawn.anchorIndexes);
      chartConfig.data.datasets[0].pointRadius = this._seriesPointRadii(drawn);
      chartInstance = new Chart(ctx, chartConfig);
      this.charts.set(canvasId, chartInstance);
    }
  }

  /**
   * Windowed variables (SWDOWN, KT) export only daylight hours, and Chart.js
   * spaces category-axis points equidistantly: 18:00 would join 06:00 in a
   * smooth curve with no night in it. A null in the hole breaks the line. The
   * CSV reads the original series, so no fabricated rows reach the export.
   */
  _seriesWithHourGaps(data) {
    if (!Array.isArray(data) || data.length < 2) return data;
    const first = data[0].hour;
    const last = data[data.length - 1].hour;
    if (!Number.isInteger(first) || !Number.isInteger(last)) return data;
    if (last - first + 1 === data.length) return data;

    const byHour = new Map(data.map((entry) => [entry.hour, entry]));
    const filled = [];
    for (let hour = first; hour <= last; hour++) {
      filled.push(byHour.get(hour) || { hour, value: null, timestamp: this._timestampForHour(hour, null) });
    }
    return filled;
  }

  _getChartCanvas(canvasId) {
    if (canvasId === "chartCanvasValue") return this.ui.chartValueCanvas;
    if (canvasId === "chartCanvasEnergy") return this.ui.chartEnergyCanvas;
    return document.getElementById(canvasId);
  }

  refreshChartTheme() {
    const publicationAccent =
      getComputedStyle(document.documentElement).getPropertyValue("--map-accent").trim() || "#596579";
    const apply = (chart) => {
      const chartColor = chart.data.datasets[0]?.borderColor || publicationAccent;
      this._applyChartTheme(chart, chartColor);
      chart.update("none");
    };
    this.charts.forEach(apply);
    this.previewCharts.forEach(apply);
  }

  _applyChartTheme(chart, accentColor) {
    const theme = this._getThemeColors();
    chart.options.plugins.legend.labels.color = theme.legendText;
    chart.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
    chart.options.plugins.tooltip.titleColor = theme.tooltipText;
    chart.options.plugins.tooltip.bodyColor = theme.tooltipText;
    chart.options.plugins.tooltip.borderColor = accentColor;
    chart.options.scales.y.ticks.color = theme.textSecondary;
    chart.options.scales.x.ticks.color = theme.textSecondary;
    chart.options.scales.y.grid.color = theme.grid;
    chart.options.scales.x.grid.color = theme.grid;
    chart.options.scales.y.title.color = theme.textSecondary;
  }

  _artifactUrl(template, domain, variableId) {
    const path = template.replace("{domain}", domain).replace("{variable}", variableId);
    return this.app?.dataUrl ? this.app.dataUrl(path) : path;
  }

  _applySeriesToChart(chartInstance, labels, data, label, color) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = data;
    chartInstance.data.datasets[0].label = label;
    chartInstance.data.datasets[0].borderColor = color;
    chartInstance.data.datasets[0].backgroundColor = `${color}20`;
  }

  _applySeriesShape(chartOrConfig, stepTotal, openingStepAnchorIndexes) {
    Chart.Interaction.modes[STEP_ENDING_AT_CURSOR_INTERACTION_MODE] = itemsOfStepEndingAtCursor;
    chartOrConfig.data.datasets[0].stepped = stepTotal ? STEPPED_MODE_FILLING_STEP_BEFORE_EACH_POINT : false;
    chartOrConfig.data.datasets[0].openingStepAnchorIndexes = openingStepAnchorIndexes;
    chartOrConfig.options.scales.y.beginAtZero = stepTotal;
    chartOrConfig.options.interaction.mode = stepTotal ? STEP_ENDING_AT_CURSOR_INTERACTION_MODE : "index";
  }

  _withOpeningStepAnchors(entries, values, stepTotal, sharedAxisOpensHourBefore = false) {
    const opensHourBefore = sharedAxisOpensHourBefore || (stepTotal && Number.isFinite(values[0]));
    const drawnEntries = [...entries];
    const data = [...values];
    if (opensHourBefore) {
      const openingHour = entries[0].hour - 1;
      drawnEntries.unshift({ hour: openingHour, value: null, timestamp: this._timestampForHour(openingHour, null) });
      data.unshift(null);
    }
    const anchorIndexes = new Set();
    if (!stepTotal) return { entries: drawnEntries, data, anchorIndexes };
    for (let index = 1; index < data.length; index++) {
      const opensRun = Number.isFinite(data[index]) && !Number.isFinite(data[index - 1]);
      const anchorFollowsGapOrEdge = index === 1 || !Number.isFinite(data[index - 2]);
      if (opensRun && anchorFollowsGapOrEdge) {
        data[index - 1] = data[index];
        anchorIndexes.add(index - 1);
      }
    }
    return { entries: drawnEntries, data, anchorIndexes };
  }

  _seriesPointRadii(drawn) {
    const radius = drawn.data.length > MOST_POINTS_DRAWN_WITH_MARKERS ? 0 : SERIES_POINT_RADIUS_PX;
    return drawn.data.map((_, index) => (drawn.anchorIndexes.has(index) ? 0 : radius));
  }

  _getThemeColors() {
    const rootStyles = getComputedStyle(document.documentElement);
    return {
      textSecondary: rootStyles.getPropertyValue("--text-secondary").trim() || "#888",
      legendText: rootStyles.getPropertyValue("--chart-legend-color").trim() || "#666",
      grid: rootStyles.getPropertyValue("--chart-grid-color").trim() || "#f0f0f0",
      tooltipBg: rootStyles.getPropertyValue("--tooltip-bg").trim() || "rgba(18, 18, 18, 0.96)",
      tooltipText: rootStyles.getPropertyValue("--tooltip-text").trim() || "#fff",
    };
  }

  _buildChartConfig(chartData, labels, chartLabel, chartColor, chartUnit) {
    const theme = this._getThemeColors();
    return {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: chartLabel,
            data: chartData,
            borderColor: chartColor,
            backgroundColor: `${chartColor}20`,
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: chartData.length > MOST_POINTS_DRAWN_WITH_MARKERS ? 0 : SERIES_POINT_RADIUS_PX,
            pointBackgroundColor: chartColor,
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        transitions: { [INSTANT_UPDATE_MODE_REFRESHING_POINT_OPTIONS]: { animation: { duration: 0 } } },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              font: { size: 14 },
              color: theme.legendText,
              padding: 15,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: chartColor,
            borderWidth: 2,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (ctx) => `${ctx.parsed.y.toFixed(2)} ${chartUnit}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: false,
            ticks: {
              color: theme.textSecondary,
              font: { size: 13 },
              // Over a range narrower than 1 (the domain precipitation mean
              // runs 0.02-0.23 mm) a fixed single decimal would collapse
              // distinct ticks into one label.
              callback: (value, index, ticks) => {
                const step = ticks?.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 0;
                const decimals = step > 0 && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 1;
                return value.toFixed(decimals);
              },
            },
            grid: { color: theme.grid, drawBorder: false },
            title: {
              display: true,
              text: chartUnit,
              font: { size: 13, weight: "bold" },
              color: theme.textSecondary,
            },
          },
          x: {
            ticks: { color: theme.textSecondary, font: { size: 13 }, maxTicksLimit: 12 },
            grid: { color: theme.grid, drawBorder: false },
          },
        },
      },
    };
  }

  /**
   * Label of the variable PER MODEL STEP. Modal, preview and CSV series are
   * always hourly — the "Acumulado" selector only changes what the map sums —
   * so they need the 1h label, never the selected window's label that
   * `app.getVariableConfig` returns.
   */
  _stepLabel(config) {
    const options = config?.accumulation?.options;
    if (!Array.isArray(options)) return config?.label;
    return options.find((option) => option.hours === 1)?.variableLabel || `${config?.label} (1h)`;
  }

  _seriesLabel(variableType, config) {
    const stepLabel = this._stepLabel(config);
    return variableType === "eolico" ? `${stepLabel} a ${this.app.windHeight} m` : stepLabel;
  }

  _prepareChartData(variableType, chartType, config, timeData) {
    if (chartType === "value") {
      return {
        data: timeData.map((entry) => entry.value),
        label: this._seriesLabel(variableType, config),
        unit: config.unit,
        color: themeInvariantSeriesColor(config.colors),
        stepTotal: config.stepTotal === true,
      };
    }

    const color = variableType === "solar" ? "#b16d00" : "#4783a9";
    const companionValuesByHour = new Map(
      (config.chartCompanions || []).map((key) => [
        key,
        new Map((this.timeSeriesData?.[key]?.data || []).map((entry) => [entry.hour, entry.value])),
      ])
    );
    const domain = this.app.state.domain;
    const energyItems = timeData.map((entry) => {
      if (entry.value === null || entry.value === undefined) return null;
      const stepSeconds = this.app.stepSecondsFor(domain, entry.hour);
      const allValues = { [variableType]: { value: entry.value, stepSeconds } };
      companionValuesByHour.forEach((valueByHour, key) => {
        allValues[key] = { value: valueByHour.get(entry.hour), stepSeconds };
      });
      const info = config.specificInfo(entry.value, allValues);
      return info?.items?.find((item) => Number.isFinite(item.energyValue)) ?? null;
    });

    const basis = energyItems.some((item) => item?.energyBasis === "step") ? "step" : "instant";
    const seriesItem = energyItems.find((item) => item?.energyBasis === basis);
    if (!seriesItem) return null;

    const stepTotal = basis === "step";
    return {
      data: energyItems.map((item) => (item?.energyBasis === basis ? item.energyValue : null)),
      label: seriesItem.chartLabel,
      csvLabel: seriesItem.csvLabel,
      unit: seriesItem.unit,
      color,
      stepIrradiationByHour: stepTotal ? companionValuesByHour.get("shortwaveIrradiation") : null,
      stepTotal,
    };
  }

  _getRequiredVariableKeys(variableType) {
    const keys = new Set();
    const config = VARIABLES_CONFIG[variableType];
    if (config?.id) keys.add(variableType);
    // e.g. temperature drives the solar/eolico energy-production chart.
    (config?.chartCompanions || []).forEach((key) => {
      if (VARIABLES_CONFIG[key]?.id) keys.add(key);
    });
    return [...keys];
  }

  async _loadVariableSeries(variableKey, domain, cellIndex, signal, { rangeReadOnly = false } = {}) {
    const config = VARIABLES_CONFIG[variableKey];
    if (!config?.id) return null;
    if (this.app?.hasPublishedSteps && !this.app.hasPublishedSteps(variableKey, domain)) return null;

    const variableId = this._getVariableId(variableKey, config);
    const maxHour = this._getAvailableHourCount();
    // Run version in the key: see _loadDomainMeanSeries.
    const cacheKey = `${this.app?.dataVersion || "v0"}:${domain}:${variableId}:${cellIndex}:${maxHour}`;
    const cached = this.timeSeriesCache.get(cacheKey);
    if (cached) return cached;

    // One ~300-byte Range request instead of dozens of full-domain JSONs read
    // for a single cell each.
    const binarySeries = await this._loadCellSeriesFromBinary(variableId, domain, cellIndex, maxHour, signal, {
      rangeReadOnly,
    });
    if (binarySeries) {
      const result = { config, data: binarySeries };
      this.timeSeriesCache.set(cacheKey, result);
      return result;
    }
    if (rangeReadOnly) return null;

    const { series, transientFailures } = await this._collectHourlySeries(
      variableId,
      domain,
      maxHour,
      12,
      signal,
      (hour, data) => {
        const cellValue = Array.isArray(data.values) ? data.values[cellIndex] : null;
        if (cellValue == null) return null;
        return {
          hour,
          value: cellValue,
          timestamp: this._timestampForHour(hour, data),
        };
      }
    );

    const result = { config, data: series };
    if (transientFailures === 0) {
      this.timeSeriesCache.set(cacheKey, result);
    }
    return result;
  }

  /**
   * Reads one cell's series from {D}_{VAR}.series.bin (cell-series-int32-le-v1:
   * row-major cells x steps int32 LE, value = raw * scale, `missing` sentinel)
   * via a Range request.
   */
  async _loadCellSeriesFromBinary(variableId, domain, cellIndex, maxHour, signal, { rangeReadOnly = false } = {}) {
    const feature = this.app?.timeline?.features?.cell_series;
    if (
      feature?.format !== "cell-series-int32-le-v1" ||
      typeof feature.template !== "string" ||
      !Number.isInteger(feature.index_min) ||
      !Number.isInteger(feature.index_max) ||
      !Number.isInteger(cellIndex) ||
      cellIndex < 0
    ) {
      return null;
    }

    const fileKey = `${this.app?.dataVersion || "v0"}:${domain}:${variableId}`;
    if (this.unusableCellSeriesFiles.has(fileKey)) return null;
    if (rangeReadOnly && this.cellSeriesFilesSkippedByPanel.has(fileKey)) return null;

    const steps = feature.index_max - feature.index_min + 1;
    if (steps <= 0) return null;
    const bytesPerCell = steps * 4;
    const offset = cellIndex * bytesPerCell;
    // A stale file left by a previous run can have a different step count, and
    // reading it with this run's stride returns other cells' values — so the
    // size must be exactly cells x steps x 4 bytes.
    const gridCellCount = this.app?.gridLayers?.[domain]?.getLayers?.().length || null;
    const expectedTotal = gridCellCount ? gridCellCount * bytesPerCell : null;

    try {
      const url = this._artifactUrl(feature.template, domain, variableId);
      const res = await fetch(url, {
        signal,
        headers: { Range: `bytes=${offset}-${offset + bytesPerCell - 1}` },
      });

      let buffer;
      if (res.status === 206) {
        // Content-Range: "bytes start-end/total" carries the full file size.
        const totalMatch = /\/(\d+)\s*$/.exec(res.headers.get("Content-Range") || "");
        const total = totalMatch ? parseInt(totalMatch[1], 10) : null;
        if (total !== null && (total % bytesPerCell !== 0 || (expectedTotal !== null && total !== expectedTotal))) {
          this.unusableCellSeriesFiles.add(fileKey);
          return null;
        }
        if (rangeReadOnly && (total === null || total !== expectedTotal)) return null;
        buffer = await res.arrayBuffer();
        if (buffer.byteLength < bytesPerCell) return null;
      } else if (res.ok) {
        this.cellSeriesFilesSkippedByPanel.add(fileKey);
        if (rangeReadOnly) {
          await res.body?.cancel();
          return null;
        }
        const full = await res.arrayBuffer();
        if (full.byteLength % bytesPerCell !== 0 || (expectedTotal !== null && full.byteLength !== expectedTotal)) {
          this.unusableCellSeriesFiles.add(fileKey);
          return null;
        }
        if (full.byteLength < offset + bytesPerCell) return null;
        buffer = full.slice(offset, offset + bytesPerCell);
      } else {
        if (rangeReadOnly && res.status === 404) this.cellSeriesFilesSkippedByPanel.add(fileKey);
        return null;
      }

      const view = new DataView(buffer);
      const scale = Number.isFinite(feature.scale) ? feature.scale : 0.01;
      const rawUnitsPerValue = 1 / scale;
      const missing = Number.isInteger(feature.missing) ? feature.missing : -2147483648;
      const series = [];
      for (let step = 0; step < steps; step++) {
        const hour = feature.index_min + step;
        if (hour < CHART_TIMELINE_FIRST_INDEX || hour > maxHour) continue;
        const raw = view.getInt32(step * 4, true);
        if (raw === missing) continue;
        series.push({
          hour,
          value: raw / rawUnitsPerValue,
          timestamp: this._timestampForHour(hour, null),
        });
      }
      return series.length || rangeReadOnly ? series : null;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return null;
    }
  }

  _getVariableId(variableKey, config) {
    // Same resolution as the map, including the eolico hub-height variants.
    return this.app?.getVariableId?.(variableKey) ?? config.id;
  }

  _getAvailableHourCount() {
    const sliderMax = parseInt(this.app?.ui?.slider?.max, 10);
    const stateMax = parseInt(this.app?.state?.maxLayer, 10);
    return Number.isFinite(sliderMax) ? sliderMax : Number.isFinite(stateMax) ? stateMax : 73;
  }

  exportCurrentData() {
    const { type, selectedCell } = this.app?.state || {};
    if (!type || !selectedCell || !this.timeSeriesData?.[type]) return;

    const config = VARIABLES_CONFIG[type];
    const timeData = this.timeSeriesData[type].data;
    const chartDataValue = this._prepareChartData(type, "value", config, timeData).data;

    const domainLabel = this.app?.getDomainLabel
      ? this.app.getDomainLabel(this.app.state.domain)
      : this.app?.state?.domain || "";
    const seriesLabel = this._seriesLabel(type, config);
    const header = [
      "Data",
      `Hora (${this.app.forecastUtcOffsetLabel()})`,
      "Latitude",
      "Longitude",
      "Domínio",
      "Variável",
      `Valor(${config.unit})`,
    ];
    const energySeries = this._prepareChartData(type, "energy", config, timeData);
    const stepIrradiationByHour = energySeries?.stepIrradiationByHour ?? null;
    if (stepIrradiationByHour) header.push(`Irradiação do passo(${VARIABLES_CONFIG.shortwaveIrradiation.unit})`);
    if (energySeries) header.push(`${energySeries.csvLabel}(${energySeries.unit})`);
    const rows = [header.join(CSV_FIELD_SEPARATOR)];

    timeData.forEach((entry, i) => {
      const date = new Date(entry.timestamp);
      const dateStr = date.toLocaleDateString("pt-BR", { timeZone: CHART_FORECAST_TIME_ZONE });
      const timeStr = date.toLocaleTimeString("pt-BR", {
        timeZone: CHART_FORECAST_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const cells = [
        dateStr,
        timeStr,
        this._formatCsvValue(selectedCell.lat, CSV_COORDINATE_FRACTION_DIGITS),
        this._formatCsvValue(selectedCell.lng, CSV_COORDINATE_FRACTION_DIGITS),
        `"${domainLabel}"`,
        `"${seriesLabel}"`,
        this._formatCsvValue(chartDataValue[i]),
      ];
      if (stepIrradiationByHour) cells.push(this._formatCsvValue(stepIrradiationByHour.get(entry.hour)));
      if (energySeries) cells.push(this._formatCsvValue(energySeries.data[i]));
      rows.push(cells.join(CSV_FIELD_SEPARATOR));
    });

    const blob = new Blob([CSV_EXCEL_UTF8_BOM, `${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = this._csvFileName(type, config);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  _csvFileName(variableType, config) {
    const parts = ["timeseries", this._getVariableId(variableType, config), this.app.state.domain];
    const runStartLocal = this.app.calculateTargetDateFromIndex(0);
    if (runStartLocal instanceof Date && !isNaN(runStartLocal)) {
      parts.push(`rodada_${runStartLocal.toISOString().slice(0, 13).replace("T", "_")}h`);
    }
    return `${parts.join("_")}.csv`;
  }

  _formatCsvValue(value, fractionDigits = CSV_VALUE_FRACTION_DIGITS) {
    if (!Number.isFinite(value)) return "";
    return value.toFixed(fractionDigits).replace(".", ",");
  }

  /**
   * Null for a deterministically absent file (404); transient failures are
   * rethrown so the caller can count them and decline to cache a truncated
   * series.
   */
  async _fetchHourJson(variableId, domain, hour, signal) {
    if (!this.app?.valuesJsonPath) throw new Error("Dataset path resolver is unavailable");
    const plainUrl = this.app.valuesJsonPath(domain, variableId, hour);
    const url = this.app?.dataUrl ? this.app.dataUrl(plainUrl) : plainUrl;
    try {
      if (this.app?._cachedFetch) {
        return await this.app._cachedFetch(url, { signal });
      }
      const res = await fetch(url, { signal });
      if (res.ok) return await res.json();
      if (res.status === 404 || res.status === 403 || res.status === 410) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (e.name === "AbortError") throw e;
      if (e.notFound) return null;
      throw e;
    }
  }

  _timestampForHour(hour, data) {
    const meta = data?.metadata;
    if (meta?.date_time) {
      const parsed = this._parseMetadataDate(meta.date_time);
      if (!isNaN(parsed)) return parsed.toISOString();
    }
    if (meta?.start_date) {
      const start = this._parseMetadataDate(meta.start_date);
      if (!isNaN(start)) {
        return new Date(start.getTime() + (hour - 1) * 3600000).toISOString();
      }
    }
    const forecastDate = this.app?.calculateTargetDateFromIndex?.(hour);
    if (forecastDate instanceof Date && !isNaN(forecastDate)) {
      return forecastDate.toISOString();
    }
    const base = new Date();
    base.setMinutes(0, 0, 0);
    base.setHours(base.getHours() + (hour - 1));
    return base.toISOString();
  }

  /**
   * Parses "DD/MM/YYYY HH:MM[:SS]" or "YYYY-MM-DD HH:MM[:SS]" into a UTC Date.
   * Never via new Date(string): WebKit returns Invalid Date for the
   * space-separated, non-ISO formats the metadata uses.
   */
  _parseMetadataDate(value) {
    if (value instanceof Date) return value;
    const dateStr = String(value).trim();

    if (typeof this.app?.parseDateTime === "function") {
      try {
        const parsed = this.app.parseDateTime(dateStr);
        if (parsed instanceof Date && !isNaN(parsed)) return parsed;
      } catch {
        /* fall through to the standalone parser */
      }
    }

    const [datePart, timePart] = dateStr.split(/[T ]/);
    if (!datePart || !timePart) return new Date(NaN);

    let day, month, year;
    if (datePart.includes("/")) {
      [day, month, year] = datePart.split("/").map(Number);
    } else {
      [year, month, day] = datePart.split("-").map(Number);
    }
    const [hour, minute, second = 0] = timePart.split(":").map(Number);
    if (![year, month, day, hour, minute].every(Number.isFinite)) return new Date(NaN);

    return new Date(Date.UTC(year, month - 1, day, hour, minute, Number.isFinite(second) ? second : 0));
  }

  _squaredDistance(lat1, lng1, lat2, lng2) {
    const dlat = lat1 - lat2;
    const dlng = lng1 - lng2;
    return dlat * dlat + dlng * dlng;
  }

  _centroid(coords) {
    let lat = 0,
      lng = 0;
    const n = coords.length - 1;
    for (let i = 0; i < n; i++) {
      lng += coords[i][0];
      lat += coords[i][1];
    }
    return { lat: lat / n, lng: lng / n };
  }

  _getIcon(variableType) {
    return VARIABLES_CONFIG[variableType]?.faIcon || "fa-chart-line";
  }
}

window.ChartsManager = ChartsManager;
