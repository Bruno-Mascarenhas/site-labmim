/**
 * CHARTS_MANAGER.js
 *
 * Time series charts manager for the interactive map
 *
 */

class ChartsManager {
  constructor(app) {
    this.app = app;
    this.charts = new Map();
    this.timeSeriesData = {};
    this.timeSeriesCache = new Map();
    this.abortController = null;

    this._setupModalListeners();
  }

  _setupModalListeners() {
    const closeBtn = document.getElementById("timeSeriesCloseBtn");
    const exportBtn = document.getElementById("timeSeriesExportBtn");
    const modal = document.getElementById("timeSeriesModal");

    if (closeBtn) closeBtn.addEventListener("click", () => this.closeModal());
    if (exportBtn) exportBtn.addEventListener("click", () => this.exportCurrentData());
    if (modal)
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.closeModal();
      });
    window.addEventListener("labmim-theme-change", () => this.refreshChartTheme());
  }

  // ─── Data Loading ─────────────────────────────────────────────────────────

  async loadTimeSeriesData(selectedCell, domain, variableType) {
    // Abort previous request if it exists
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
      return timeSeriesData;
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("[Charts] Request cancelled by the user.");
      } else {
        console.error("[Charts] Error loading time series:", error);
      }
      return {};
    }
  }

  async findCellIndex(lat, lng, domain, signal) {
    try {
      const cacheKey = domain;
      const cachedLayer = this.app?.gridLayers?.[cacheKey];

      if (cachedLayer) {
        const layers = cachedLayer.getLayers();
        let closestIndex = 0,
          minDist = Infinity;
        layers.forEach((layer, i) => {
          const bounds = layer.getBounds?.();
          if (!bounds) return;
          const c = bounds.getCenter();
          const d = this._quickDist(lat, lng, c.lat, c.lng);
          if (d < minDist) {
            minDist = d;
            closestIndex = i;
          }
        });
        return closestIndex;
      }

      const res = await fetch(`GeoJSON/${domain}.geojson`, { signal });
      if (!res.ok) return null;
      const geoJson = await res.json();

      let closestIndex = 0,
        minDist = Infinity;
      (geoJson.features || []).forEach((feature, i) => {
        if (feature.geometry?.type === "Polygon") {
          const c = this._centroid(feature.geometry.coordinates[0]);
          const d = this._quickDist(lat, lng, c.lat, c.lng);
          if (d < minDist) {
            minDist = d;
            closestIndex = i;
          }
        }
      });
      return closestIndex;
    } catch (error) {
      if (error.name !== "AbortError") console.error("[Charts] Error finding cell:", error);
      throw error;
    }
  }

  // ─── Modal Rendering ──────────────────────────────────────────────────────

  openModal() {
    const modal = document.getElementById("timeSeriesModal");
    if (modal) modal.style.display = "flex";
  }

  closeModal() {
    const modal = document.getElementById("timeSeriesModal");
    if (modal) modal.style.display = "none";
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  renderChartsForVariable(variableType, selectedCellData) {
    const config = VARIABLES_CONFIG[variableType];
    if (!config) return;

    document.getElementById("timeSeriesModalTitle").innerHTML =
      `<i class="fas fa-${this._getIcon(variableType, "value")}"></i> Série Temporal: ${config.label}`;

    const isSolarOrWind = variableType === "solar" || variableType === "eolico";

    this._updateOrCreateChart(variableType, "value", "chartCanvasValue");

    const energyContainer = document.getElementById("chartContainerEnergy");
    if (isSolarOrWind) {
      energyContainer.style.display = "block";
      this._updateOrCreateChart(variableType, "energy", "chartCanvasEnergy");
    } else {
      energyContainer.style.display = "none";
    }
  }

  reloadChartsWithNewParameters() {
    const { type, selectedCell } = this.app?.state || {};
    if (type && selectedCell && this.timeSeriesData) {
      this.renderChartsForVariable(type, selectedCell);
    }
  }

  clearCharts() {
    this.charts.forEach((chart) => chart?.destroy());
    this.charts.clear();
    this.timeSeriesData = {};
    this.timeSeriesCache.clear();
  }

  // ─── Internal Methods ─────────────────────────────────────────────────────

  _updateOrCreateChart(variableType, chartType, canvasId) {
    if (!this.timeSeriesData?.[variableType]) return;

    const config = VARIABLES_CONFIG[variableType];
    const timeData = this.timeSeriesData[variableType].data;
    const {
      data: chartData,
      label: chartLabel,
      unit: chartUnit,
      color: chartColor,
    } = this._prepareChartData(variableType, chartType, config, timeData);

    // Optimization: Cache parsed dates
    const labels = timeData.map((d) => {
      if (!d._formattedLabel) {
        d._formattedLabel = new Date(d.timestamp).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return d._formattedLabel;
    });

    let chartInstance = this.charts.get(canvasId);

    if (chartInstance) {
      // Update in-place (Performance Win)
      chartInstance.data.labels = labels;
      chartInstance.data.datasets[0].data = chartData;
      chartInstance.data.datasets[0].label = chartLabel;
      chartInstance.data.datasets[0].borderColor = chartColor;
      chartInstance.data.datasets[0].backgroundColor = `${chartColor}20`;
      chartInstance.data.datasets[0].pointRadius = chartData.length > 96 ? 0 : 3;
      chartInstance.data.datasets[0].pointBackgroundColor = chartColor;
      chartInstance.options.scales.y.title.text = chartUnit;
      chartInstance.options.plugins.tooltip.callbacks.label = (ctx) => `${ctx.parsed.y.toFixed(2)} ${chartUnit}`;
      this._applyChartTheme(chartInstance, chartColor);
      chartInstance.update("none");
    } else {
      // Create new if it does not exist
      const ctx = document.getElementById(canvasId).getContext("2d");
      chartInstance = new Chart(ctx, this._buildChartConfig(chartData, labels, chartLabel, chartColor, chartUnit));
      this.charts.set(canvasId, chartInstance);
    }
  }

  refreshChartTheme() {
    this.charts.forEach((chart) => {
      const chartColor = chart.data.datasets[0]?.borderColor || "#667eea";
      this._applyChartTheme(chart, chartColor);
      chart.update("none");
    });
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

  _getThemeColors() {
    const rootStyles = getComputedStyle(document.documentElement);
    const bodyStyles = getComputedStyle(document.body);
    return {
      textPrimary: rootStyles.getPropertyValue("--text-primary").trim() || bodyStyles.color || "#fff",
      textSecondary: rootStyles.getPropertyValue("--text-secondary").trim() || "#888",
      legendText: document.documentElement.classList.contains("dark-theme") ? "#fff" : "#666",
      grid: rootStyles.getPropertyValue("--chart-grid-color").trim() || "#f0f0f0",
      tooltipBg: "rgba(18, 18, 18, 0.96)",
      tooltipText: "#fff",
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
            pointRadius: chartData.length > 96 ? 0 : 3,
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
              callback: (v) => v.toFixed(1),
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

  _prepareChartData(variableType, chartType, config, timeData) {
    if (chartType === "value") {
      return {
        data: timeData.map((d) => d.value),
        label: config.label,
        unit: config.unit,
        color: config.colors[config.colors.length - 1],
      };
    }

    const unit = variableType === "solar" ? "Wh/m²" : "kWh";
    const color = variableType === "solar" ? "#FDB462" : "#80B1D3";
    const temperatureSeries = this.timeSeriesData?.temperature?.data || [];
    const temperatureByHour = new Map(temperatureSeries.map((entry) => [entry.hour, entry.value]));
    const data = timeData.map((d) => {
      try {
        const info = config.specificInfo(d.value, {
          [variableType]: { value: d.value },
          temperature: { value: temperatureByHour.get(d.hour) },
        });
        // "Produção Energética" will be returned by specificInfo since we haven't translated VARIABLES_CONFIG yet
        // However, we translate our string matchers. Since VARIABLES_CONFIG label will still be PT (used in HTML),
        // we check for both EN and PT just in case, or keep matching PT if VARIABLES_CONFIG is untouched
        const item = info?.items?.find(
          (it) =>
            it.label?.includes("Produção Energética") ||
            it.label?.includes("Energy Production") ||
            it.label?.includes("kWh") ||
            it.label?.includes("Wh")
        );
        if (item?.value) {
          const num = parseFloat(
            String(item.value)
              .replace(/[^\d.,]/g, "")
              .replace(",", ".")
          );
          return isNaN(num) ? 0 : num;
        }
      } catch (_) {}
      return 0;
    });

    return { data, label: "Produção Energética Acumulada (1h)", unit, color };
  }

  _getRequiredVariableKeys(variableType) {
    const keys = new Set();
    if (VARIABLES_CONFIG[variableType]?.id) keys.add(variableType);
    if (variableType === "solar" || variableType === "eolico") keys.add("temperature");
    return [...keys];
  }

  async _loadVariableSeries(variableKey, domain, cellIndex, signal) {
    const config = VARIABLES_CONFIG[variableKey];
    if (!config?.id) return null;

    const variableId = this._getVariableId(variableKey, config);
    const maxHour = this._getAvailableHourCount();
    const cacheKey = `${domain}:${variableId}:${cellIndex}:${maxHour}`;
    const cached = this.timeSeriesCache.get(cacheKey);
    if (cached) return cached;

    const BATCH_SIZE = 12;
    const allResults = [];
    for (let start = 1; start <= maxHour; start += BATCH_SIZE) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const batchEnd = Math.min(start + BATCH_SIZE - 1, maxHour);
      const batch = [];
      for (let hour = start; hour <= batchEnd; hour++) {
        batch.push(this._fetchHourValue(variableId, domain, hour, cellIndex, signal));
      }
      const batchResults = await Promise.all(batch);
      allResults.push(...batchResults);
    }

    const result = { config, data: allResults.filter(Boolean) };
    this.timeSeriesCache.set(cacheKey, result);
    return result;
  }

  async _fetchHourValue(variableId, domain, hour, cellIndex, signal) {
    try {
      const data = await this._fetchHourJson(variableId, domain, hour, signal);
      if (data?.values && Array.isArray(data.values)) {
        const cellValue = data.values[cellIndex];
        if (cellValue != null) {
          return {
            hour,
            value: cellValue,
            timestamp: this._timestampForHour(hour, data),
          };
        }
      }
      return null;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return null;
    }
  }

  _getVariableId(variableKey, config) {
    if (variableKey === "eolico" && this.app?.windHeight) {
      if (this.app.windHeight === 100) return config.id_100m;
      if (this.app.windHeight === 150) return config.id_150m;
    }
    return config.id;
  }

  _getAvailableHourCount() {
    const sliderMax = parseInt(document.getElementById("layerSlider")?.max, 10);
    const stateMax = parseInt(this.app?.state?.maxLayer, 10);
    return Number.isFinite(sliderMax) ? sliderMax : Number.isFinite(stateMax) ? stateMax : 73;
  }

  exportCurrentData() {
    const { type, selectedCell } = this.app?.state || {};
    if (!type || !selectedCell || !this.timeSeriesData?.[type]) return;

    const config = VARIABLES_CONFIG[type];
    const timeData = this.timeSeriesData[type].data;
    const chartDataValue = this._prepareChartData(type, "value", config, timeData).data;

    let csv = `Data,Hora,Latitude,Longitude,Variável,Valor(${config.unit})`;
    const isEnergy = type === "solar" || type === "eolico";
    let chartDataEnergy = null;
    let energyUnit = "";

    if (isEnergy) {
      const energyConfig = this._prepareChartData(type, "energy", config, timeData);
      chartDataEnergy = energyConfig.data;
      energyUnit = energyConfig.unit;
      csv += `,Produção(${energyUnit})`;
    }
    csv += "\n";

    timeData.forEach((d, i) => {
      const date = new Date(d.timestamp);
      const dateStr = date.toLocaleDateString("pt-BR");
      const timeStr = date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const rawV = chartDataValue[i];
      const numV =
        typeof rawV === "string" ? parseFloat(rawV.replace(/[^\d.,]/g, "").replace(",", ".")) : parseFloat(rawV);

      csv += `${dateStr},${timeStr},${selectedCell.lat.toFixed(4)},${selectedCell.lng.toFixed(4)},"${config.label}",${isNaN(numV) ? "0.00" : numV.toFixed(2)}`;

      if (isEnergy && chartDataEnergy) {
        const rawE = chartDataEnergy[i];
        const numE =
          typeof rawE === "string" ? parseFloat(rawE.replace(/[^\d.,]/g, "").replace(",", ".")) : parseFloat(rawE);
        csv += `,${isNaN(numE) ? "0.00" : numE.toFixed(2)}`;
      }
      csv += "\n";
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `timeseries_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async _fetchHourJson(variableId, domain, hour, signal) {
    const idNum = String(hour).padStart(3, "0");
    const url = `JSON/${domain}_${variableId}_${idNum}.json`;
    try {
      if (this.app?._cachedFetch) {
        return await this.app._cachedFetch(url, { signal });
      }
      const res = await fetch(url, { signal });
      return res.ok ? res.json() : null;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      return null;
    }
  }

  _timestampForHour(hour, data) {
    const meta = data?.metadata;
    if (meta?.date_time) {
      const parsed = this._parseMetadataDate(meta.date_time);
      if (!isNaN(parsed)) return parsed.toISOString();
    }
    if (meta?.start_date) {
      const base = new Date(meta.start_date);
      if (!isNaN(base)) {
        base.setHours(base.getHours() + (hour - 1));
        return base.toISOString();
      }
    }
    const base = new Date();
    base.setMinutes(0, 0, 0);
    base.setHours(base.getHours() + (hour - 1));
    return base.toISOString();
  }

  _parseMetadataDate(value) {
    if (value instanceof Date) return value;
    const parts = String(value).trim().split(" ");
    if (parts.length >= 2 && parts[0].includes("/")) {
      const dateParts = parts[0].split("/").reverse().join("-");
      return new Date(`${dateParts} ${parts[1]}`);
    }
    return new Date(value);
  }

  _quickDist(lat1, lng1, lat2, lng2) {
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

  _getIcon(variableType, chartType) {
    if (chartType === "energy") return variableType === "solar" ? "solar-panel" : "fan";
    return (
      {
        solar: "sun",
        eolico: "wind",
        temperature: "thermometer",
        pressure: "cloud",
        humidity: "droplet",
        rain: "cloud-rain",
      }[variableType] || "chart-line"
    );
  }
}
