/**
 * MAP UTILITY FUNCTIONS
 */

const JSON_CACHE_LIMIT = 200;
const PLAYBACK_INTERVAL_MS = 800;
const WORKER_CACHE_VERSION = "5";
const DEFAULT_MAP_CENTER = [-12.97, -38.5];
const DOMAIN_CONFIG = {
  D01: { label: "BA/NE", center: DEFAULT_MAP_CENTER, zoom: 5.5 },
  D02: { label: "BA", center: DEFAULT_MAP_CENTER, zoom: 7 },
  D03: { label: "RMS", center: DEFAULT_MAP_CENTER, zoom: 9 },
  D04: { label: "SSA", center: DEFAULT_MAP_CENTER, zoom: 12 },
};
const GRID_VISIBLE_STYLE = {
  fillOpacity: 0.45,
  weight: 0.5,
  opacity: 0.15,
  color: "white",
};
const GRID_HIDDEN_STYLE = {
  fillOpacity: 0,
  opacity: 0,
  weight: 0,
};

function _debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

class MeteoMapManager {
  constructor(options = {}) {
    this.mapContext = this.resolveMapContext(options.context);
    this.contextConfig = VARIABLE_CONTEXTS[this.mapContext] || VARIABLE_CONTEXTS.forecast;
    this.map = null;
    this.currentGeoJsonLayer = null;
    this.currentValueData = null;
    this.gridLayers = {};
    this._jsonCache = new Map();

    this._colorWorker = null;
    this._jsonWorker = null;
    this._jsonWorkerCallbacks = new Map();
    this._jsonWorkerId = 0;
    this._colorRequestId = 0;
    this._windRequestKey = null;
    try {
      this._colorWorker = new Worker(`assets/js/workers/color-calc.worker.js?v=${WORKER_CACHE_VERSION}`);
      this._jsonWorker = new Worker(`assets/js/workers/json-parser.worker.js?v=${WORKER_CACHE_VERSION}`);
      this._jsonWorker.onmessage = (e) => {
        const { id, data, error } = e.data;
        const cb = this._jsonWorkerCallbacks.get(id);
        if (cb) {
          this._jsonWorkerCallbacks.delete(id);
          if (error) cb.reject(new Error(error));
          else cb.resolve(data);
        }
      };
    } catch (err) {
      console.warn("Web Workers not available, falling back to main thread:", err);
    }
    this.stateGeoJson = null;
    this.selectedMarker = null;
    this.customParameters = {};
    this.windHeight = 50;

    this.ui = {};

    this.state = {
      type: this.contextConfig.defaultVariable,
      domain: "D01",
      index: 7,
      isPlaying: false,
      hasUserControlledPlayback: false,
      isClippedToState: false,
      stateAbbr: "BA",
      maxLayer: 73,
      initialDateTime: null,
      initialIndex: null,
      dateTimePattern: null,
      intervalId: null,
      selectedCell: null,
    };

    this.initMap();
    this.setupEventListeners();
    this.setupDomainIndicators();
    this.loadStateGeoJson("BA");
    this.loadCustomParameters();
  }

  resolveMapContext(explicitContext) {
    const context = explicitContext || document.body?.dataset?.mapContext || "forecast";
    return VARIABLE_CONTEXTS[context] ? context : "forecast";
  }

  getDomainConfig(domain = this.state.domain) {
    return DOMAIN_CONFIG[domain] || { label: domain, center: DEFAULT_MAP_CENTER, zoom: 6 };
  }

  getDomainLabel(domain = this.state.domain) {
    return this.getDomainConfig(domain).label;
  }

  getVisibleVariableTypes() {
    return this.contextConfig.variables.filter((variableType) => VARIABLES_CONFIG[variableType]);
  }

  getRelatedVariableTypes() {
    const variables = new Set(this.getVisibleVariableTypes());
    if (this.state.type === "solar" || this.state.type === "eolico") {
      variables.add("temperature");
    }
    return [...variables];
  }

  /**
   * Fetch JSON with in-memory cache.
   * Avoids re-downloading the same JSON when switching variables or time steps.
   */
  _cachedFetch(url, options = {}) {
    if (options.signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }

    if (this._jsonCache.has(url)) {
      return Promise.resolve(this._jsonCache.get(url));
    }

    const fetchPromise = this._jsonWorker
      ? this._workerFetch(url).then((data) => {
          if (options.signal && options.signal.aborted) throw new DOMException("Aborted", "AbortError");
          return data;
        })
      : fetch(url, options).then((res) => {
          if (!res.ok) throw new Error("Dados não encontrados");
          return res.json();
        });

    return fetchPromise.then((data) => {
      if (this._jsonCache.size > JSON_CACHE_LIMIT) {
        const firstKey = this._jsonCache.keys().next().value;
        this._jsonCache.delete(firstKey);
      }
      this._jsonCache.set(url, data);
      return data;
    });
  }

  /**
   * Fetch + parse JSON using the Web Worker.
   * Returns a Promise that resolves with the parsed JSON.
   */
  _workerFetch(url) {
    return new Promise((resolve, reject) => {
      const id = String(++this._jsonWorkerId);
      this._jsonWorkerCallbacks.set(id, { resolve, reject });
      const absoluteUrl = new URL(url, window.location.href).href;
      this._jsonWorker.postMessage({ url: absoluteUrl, id });
    });
  }

  getVariableId(variableType) {
    const config = VARIABLES_CONFIG[variableType];
    if (!config) return null;

    if (variableType === "eolico") {
      if (this.windHeight === 100) return config.id_100m;
      if (this.windHeight === 150) return config.id_150m;
      return config.id;
    }

    return config.id;
  }

  setWindHeight(height) {
    if ([50, 100, 150].includes(height)) {
      this.windHeight = height;
      if (this.state.type === "eolico") {
        this.gridLayers = {};

        if (this.state.selectedCell) {
          this.applyMapChanges().then(() => {
            this.handleMapClick({
              latlng: L.latLng(this.state.selectedCell.lat, this.state.selectedCell.lng),
            });
          });
        } else {
          this.applyMapChanges();
        }
      }
    }
  }

  loadCustomParameters() {
    try {
      const saved = localStorage.getItem("meteoMapCustomParameters");
      this.customParameters = saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.warn("Error loading custom parameters:", e);
      this.customParameters = {};
    }
  }

  getCustomParameter(variableType, paramName) {
    if (!this.customParameters) {
      this.customParameters = {};
      return null;
    }

    const key = `${variableType}_${paramName}`;
    const customValue = this.customParameters[key];

    if (customValue !== undefined && customValue !== null && customValue !== "") {
      const numValue = parseFloat(customValue);
      if (!isNaN(numValue)) {
        return numValue;
      }
    }

    return null;
  }

  setCustomParameter(variableType, paramName, value) {
    if (!this.customParameters) {
      this.customParameters = {};
    }

    const key = `${variableType}_${paramName}`;

    if (value === null || value === undefined || value === "") {
      delete this.customParameters[key];
    } else {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        this.customParameters[key] = numValue;
      } else {
        console.warn(`[PARAM SAVE] Invalid value for ${key}: "${value}", removing`);
        delete this.customParameters[key];
      }
    }

    try {
      localStorage.setItem("meteoMapCustomParameters", JSON.stringify(this.customParameters));

      if (typeof chartsManager !== "undefined" && chartsManager) {
        chartsManager.reloadChartsWithNewParameters();
      }
    } catch (e) {
      console.warn("Error saving parameters to localStorage:", e);
    }
  }

  resetCustomParameters(variableType) {
    if (!this.customParameters) {
      this.customParameters = {};
      return;
    }

    const prefix = `${variableType}_`;
    Object.keys(this.customParameters).forEach((key) => {
      if (key.startsWith(prefix)) {
        delete this.customParameters[key];
      }
    });

    try {
      localStorage.setItem("meteoMapCustomParameters", JSON.stringify(this.customParameters));

      if (typeof chartsManager !== "undefined" && chartsManager) {
        chartsManager.reloadChartsWithNewParameters();
      }
    } catch (e) {
      console.warn("Error saving parameters to localStorage:", e);
    }
  }

  getEditableParameters(variableType) {
    const params = {
      solar: [
        {
          name: "panelEfficiency",
          label: "Eficiência do Painel",
          unit: "%",
          default: 18,
        },
        {
          name: "inversorEfficiency",
          label: "Eficiência do Inversor",
          unit: "%",
          default: 95,
        },
        { name: "noct", label: "NOCT", unit: "°C", default: 45 },
        { name: "ptc", label: "Coeficiente PTC", unit: "%/°C", default: -0.38 },
      ],
      eolico: [
        {
          name: "airDensity",
          label: "Densidade do Ar",
          unit: "kg/m³",
          default: 1.225,
        },
        {
          name: "rotorDiameter",
          label: "Diâmetro do Rotor",
          unit: "m",
          default: 40,
        },
        {
          name: "Cp",
          label: "Coeficiente de Potência da Turbina",
          unit: "",
          default: 0.4,
        },
      ],
    };

    return params[variableType] || [];
  }

  createParametersEditor(variableType) {
    const params = this.getEditableParameters(variableType);

    if (params.length === 0) {
      return "";
    }

    if (!this.customParameters) {
      this.customParameters = {};
    }

    let html = `
            <div class="parameters-editor">
                <div class="parameters-toggle" data-variable="${variableType}">
                    <span class="parameters-toggle-label">
                        <i class="fas fa-sliders-h"></i> Parâmetros Customizados
                    </span>
                    <span class="parameters-toggle-icon">▼</span>
                </div>
                <div class="parameters-list" data-variable="${variableType}">
        `;

    params.forEach((param) => {
      const customValue = this.customParameters[`${variableType}_${param.name}`];
      const displayValue = customValue !== undefined && customValue !== null ? customValue.toString() : "";

      html += `
                <div class="parameter-item">
                    <label class="parameter-label">${param.label}</label>
                    <input 
                        type="text" 
                        class="parameter-input parameter-${variableType}-${param.name}" 
                        placeholder="${param.default} (padrão)"
                        value="${displayValue}"
                        data-variable="${variableType}"
                        data-param="${param.name}"
                        data-default="${param.default}"
                        inputmode="decimal"
                    />
                    <span class="parameter-unit">${param.unit}</span>
                    <span class="parameter-hint">Deixe em branco para usar padrão</span>
                </div>
            `;
    });

    html += `
                    <button class="reset-parameters-btn" data-variable="${variableType}">
                        <i class="fas fa-redo"></i> Restaurar Padrões
                    </button>
                </div>
            </div>
        `;

    return html;
  }

  sanitizeNumericInput(value) {
    let sanitized = value.replace(/[^\d.-]/g, "");

    const decimalParts = sanitized.split(".");
    if (decimalParts.length > 2) {
      sanitized = decimalParts[0] + "." + decimalParts.slice(1).join("");
    }

    if ((sanitized.match(/-/g) || []).length > 1) {
      sanitized = sanitized.replace(/-/g, "");
      sanitized = "-" + sanitized;
    }

    return sanitized;
  }

  saveParameterInput(variableType, input) {
    const value = input.value.trim();
    const paramName = input.dataset.param;

    if (value === "") {
      this.setCustomParameter(variableType, paramName, null);
      input.value = "";
      return;
    }

    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      console.warn(`[PARAM UPDATE] Invalid value for ${paramName}: "${value}". Using default.`);
      input.value = "";
      this.setCustomParameter(variableType, paramName, null);
      return;
    }

    this.setCustomParameter(variableType, paramName, numValue);
    input.value = numValue.toString();
  }

  setupParametersEditorListeners(variableType) {
    try {
      const toggle = document.querySelector(`.parameters-toggle[data-variable="${variableType}"]`);
      const list = document.querySelector(`.parameters-list[data-variable="${variableType}"]`);
      const resetBtn = document.querySelector(`.reset-parameters-btn[data-variable="${variableType}"]`);
      const inputs = document.querySelectorAll(`[data-variable="${variableType}"].parameter-input`);

      if (toggle && list) {
        toggle.addEventListener("click", () => {
          const icon = toggle.querySelector(".parameters-toggle-icon");
          list.classList.toggle("active");
          icon.classList.toggle("active");
        });
      }

      if (inputs.length > 0) {
        inputs.forEach((input) => {
          const validateAndSave = (e) => {
            this.saveParameterInput(variableType, e.target);
            this.updateSidebarWithNewParameters(variableType);
          };

          input.addEventListener("blur", validateAndSave);

          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.code === "Enter") {
              e.preventDefault();
              validateAndSave(e);
              input.blur();
            }
          });

          input.addEventListener("input", (e) => {
            e.target.value = this.sanitizeNumericInput(e.target.value);
          });
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          if (confirm("Restaurar parâmetros aos valores padrão?")) {
            this.resetCustomParameters(variableType);
            inputs.forEach((input) => {
              input.value = "";
            });
            this.updateSidebarWithNewParameters(variableType);
          }
        });
      }
    } catch (e) {
      console.warn("Error configuring parameter listeners:", e);
    }
  }

  updateSidebarWithNewParameters(variableType) {
    if (!this.state.selectedCell) {
      console.warn(`[SIDEBAR UPDATE] No cell selected`);
      return;
    }

    if (this.state.type !== variableType) {
      console.warn(`[SIDEBAR UPDATE] Variable mismatch: ${this.state.type} !== ${variableType}`);
      return;
    }

    const config = VARIABLES_CONFIG[this.state.type];
    if (!config || !config.specificInfo) {
      console.warn(`[SIDEBAR UPDATE] Config or specificInfo not found`);
      return;
    }

    const specificInfo = config.specificInfo(this.state.selectedCell.value, this.state.selectedCell.allValues);

    this.updateSidebarSpecificInfo(specificInfo);
  }

  updateSidebarSpecificInfo(specificInfo) {
    const sidebarContent = this.ui.sidebarContent || document.getElementById("sidebarContent");
    const existingSpecific = sidebarContent.querySelector(".variable-specific");

    if (!existingSpecific) return;

    const existingEditor = existingSpecific.querySelector(".parameters-editor");
    let wasEditorOpen = false;
    if (existingEditor) {
      const existingList = existingEditor.querySelector(".parameters-list");
      wasEditorOpen = existingList && existingList.classList.contains("active");
    }

    let html = `
            <div class="info-section-title">
                <i class="fas fa-bolt"></i> ${specificInfo.title}
            </div>
        `;

    specificInfo.items.forEach((item) => {
      html += `
                <div class="stat-card">
                    <div class="stat-card-label">
                        <i class="fas ${item.icon}"></i> ${item.label}
                    </div>
                    <div class="stat-card-value">
                        ${item.value}
                        <span class="stat-card-unit">${item.unit || ""}</span>
                    </div>
                </div>
            `;
    });

    const editorHTML = this.createParametersEditor(this.state.type);
    html += editorHTML;

    existingSpecific.innerHTML = html;

    if (wasEditorOpen) {
      const newList = existingSpecific.querySelector(".parameters-list");
      const newToggle = existingSpecific.querySelector(".parameters-toggle");
      if (newList && newToggle) {
        newList.classList.add("active");
        const icon = newToggle.querySelector(".parameters-toggle-icon");
        if (icon) icon.classList.add("active");
      }
    }

    this.setupParametersEditorListeners(this.state.type);
  }

  initMap() {
    this._canvasRenderer = L.canvas({ padding: 0.5 });

    this.map = L.map("map", {
      fadeAnimation: true,
      maxZoom: 15,
      renderer: this._canvasRenderer,
    }).setView(DEFAULT_MAP_CENTER, 6);

    L.tileLayer("https://{s}.tile.osm.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap | LabMiM-UFBA",
      minZoom: 3,
      maxZoom: 15,
    }).addTo(this.map);

    this.setupWindCanvas();
  }

  cacheUIElements() {
    this.ui = {
      slider: document.getElementById("layerSlider"),
      playPauseBtn: document.getElementById("playPauseBtn"),
      clipStateBtn: document.getElementById("clipStateBtn"),
      variableSelect: document.getElementById("variableSelect"),
      closeSidebarBtn: document.getElementById("closeSidebarBtn"),
      layerLabel: document.getElementById("layerLabel"),
      windCheckbox: document.getElementById("windLayerCheckbox"),
      windCanvas: document.getElementById("windVectorCanvas"),
      heightSelector: document.getElementById("heightSelector"),
      windLayerToggle: document.getElementById("windLayerToggle"),
      sidebar: document.getElementById("sidebar"),
      sidebarContent: document.getElementById("sidebarContent"),
      colorbarGradient: document.getElementById("colorbarGradient"),
      colorbarLabels: document.getElementById("colorbarLabels"),
      colorbarUnit: document.getElementById("colorbarUnit"),
      docBtn: document.getElementById("docBtn"),
      docCloseBtn: document.getElementById("docCloseBtn"),
      docModal: document.getElementById("documentationModal"),
      domainButtons: [...document.querySelectorAll(".domain-btn")],
      heightButtons: [...document.querySelectorAll(".height-btn")],
      docTabs: [...document.querySelectorAll(".doc-tab")],
      docTabContents: [...document.querySelectorAll(".doc-tab-content")],
    };
  }

  setupWindCanvas() {
    const canvas = document.getElementById("windVectorCanvas");
    if (canvas) {
      this.ui.windCanvas = canvas;
      if (!this.windCanvasUpdateHandler) {
        this.windCanvasUpdateHandler = () => {
          canvas.width = this.map.getSize().x;
          canvas.height = this.map.getSize().y;

          const windCheckbox = this.ui.windCheckbox || document.getElementById("windLayerCheckbox");
          if (windCheckbox && windCheckbox.checked) {
            cancelAnimationFrame(this.windRenderScheduled);
            this.windRenderScheduled = requestAnimationFrame(() => this.renderWindVectors());
          }
        };

        this.windCanvasUpdateHandler();

        this.map.on("move", this.windCanvasUpdateHandler, this);
        this.map.on("resize", this.windCanvasUpdateHandler, this);
        this.map.on("zoomend", this.windCanvasUpdateHandler, this);
      }
    }
  }

  setupEventListeners() {
    this.cacheUIElements();
    this.configureVariableSelect();

    const _debouncedSliderApply = _debounce(() => {
      if (this.state.selectedCell && !this.state.isPlaying) {
        this.applyMapChanges().then(() => {
          this.handleMapClick({
            latlng: L.latLng(this.state.selectedCell.lat, this.state.selectedCell.lng),
          });
        });
      } else {
        this.applyMapChanges();
      }
    }, 100);

    this.ui.slider.addEventListener("input", (e) => {
      this.state.index = parseInt(e.target.value);
      this.updateDateTime();
      _debouncedSliderApply();
    });

    this.ui.playPauseBtn.addEventListener("click", () => {
      this.state.hasUserControlledPlayback = true;
      if (!this.state.isPlaying) {
        this.closeSidebar();
      }
      this.togglePlayPause();
    });

    this.ui.clipStateBtn.addEventListener("click", () => this.toggleClipState(this.ui.clipStateBtn));
    this.ui.variableSelect.addEventListener("change", (e) => this.switchVariable(e.target.value));
    this.ui.closeSidebarBtn.addEventListener("click", () => this.closeSidebar());

    const heightButtons = this.ui.heightButtons;
    heightButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const height = parseInt(e.target.dataset.height);
        heightButtons.forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this.setWindHeight(height);
      });
    });

    if (this.ui.windCheckbox) {
      this.ui.windCheckbox.addEventListener("change", (e) => {
        this.toggleWindLayer(e.target.checked);
      });
    }

    this.map.on("click", (e) => this.handleMapClick(e));

    this.updateDomainIndicator();
    this.updateWindLayerToggleVisibility(this.state.type);

    this.setupDocumentationListeners();
  }

  configureVariableSelect() {
    if (!this.ui.variableSelect) return;

    const currentValue = this.ui.variableSelect.value;
    const allowedVariables = this.getVisibleVariableTypes();
    const selectedVariable = allowedVariables.includes(currentValue)
      ? currentValue
      : this.contextConfig.defaultVariable;

    this.ui.variableSelect.innerHTML = "";

    const optionGroup = document.createElement("optgroup");
    optionGroup.label = this.contextConfig.optionGroupLabel;

    allowedVariables.forEach((variableType) => {
      const config = VARIABLES_CONFIG[variableType];
      const option = document.createElement("option");
      option.value = variableType;
      option.textContent = `${config.icon || ""} ${config.optionLabel || config.label}`.trim();
      optionGroup.appendChild(option);
    });

    this.ui.variableSelect.appendChild(optionGroup);
    this.ui.variableSelect.value = selectedVariable;
    this.state.type = selectedVariable;
  }

  setupDocumentationListeners() {
    const { docBtn, docCloseBtn, docModal, docTabs, docTabContents } = this.ui;

    if (!docBtn || !docCloseBtn || !docModal) return;

    docBtn.addEventListener("click", () => {
      docModal.classList.add("active");
    });

    docCloseBtn.addEventListener("click", () => {
      docModal.classList.remove("active");
    });

    docModal.addEventListener("click", (e) => {
      if (e.target === docModal) {
        docModal.classList.remove("active");
      }
    });

    docTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabName = tab.getAttribute("data-tab");

        docTabs.forEach((t) => t.classList.remove("active"));
        docTabContents.forEach((content) => {
          content.classList.remove("active");
        });

        tab.classList.add("active");
        docTabContents.find((content) => content.dataset.tab === tabName)?.classList.add("active");
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && docModal.classList.contains("active")) {
        docModal.classList.remove("active");
      }
    });
  }

  loadStateGeoJson(stateCode) {
    this.state.stateAbbr = stateCode;
    fetch(
      `https://raw.githubusercontent.com/giuliano-macedo/geodata-br-states/main/geojson/br_states/br_${stateCode.toLowerCase()}.json`
    )
      .then((res) => res.json())
      .then((geojson) => {
        this.stateGeoJson = geojson.features[0];
        if (this.ui.clipStateBtn) {
          this.ui.clipStateBtn.innerHTML = `<i class="fas fa-map"></i> ${stateCode} Off`;
          this.ui.clipStateBtn.style.display = "inline-block";
        }

        if (this.currentGeoJsonLayer) {
          this._precomputeStateMask(this.currentGeoJsonLayer);
          if (this.state.isClippedToState && this.currentValueData) {
            this.applyValuesToGrid(this.currentGeoJsonLayer, this.currentValueData);
          }
        }
      })
      .catch((err) => console.error(`Error loading boundary for state ${stateCode}:`, err));
  }

  _precomputeStateMask(gridLayer) {
    if (!this.stateGeoJson || gridLayer._stateMaskComputed) return;
    gridLayer.eachLayer((layer) => {
      const bounds = layer.getBounds();
      const pt = turf.point([(bounds.getEast() + bounds.getWest()) / 2, (bounds.getNorth() + bounds.getSouth()) / 2]);
      layer._inStateMask = turf.booleanPointInPolygon(pt, this.stateGeoJson);
    });
    gridLayer._stateMaskComputed = true;
  }

  updateDateTime() {
    const config = VARIABLES_CONFIG[this.state.type];
    const hour = (this.state.index - 1) % 24;

    if (this.ui.layerLabel) {
      if (config.id === "SWDOWN" && (hour < 6 || hour > 18)) {
        this.ui.layerLabel.textContent = "Sem dados (noturno)";
      } else {
        this.ui.layerLabel.textContent = this.calculateDateTimeFromIndex(this.state.index);
      }
    }
  }

  calculateDateTimeFromIndex(index) {
    if (!this.state.initialDateTime) return `Hora ${index}`;

    const hoursDiff = index - this.state.initialIndex;
    const date = new Date(this.state.initialDateTime);
    date.setHours(date.getHours() + hoursDiff);

    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  togglePlayPause() {
    this.setPlaybackState(!this.state.isPlaying);
  }

  setPlaybackState(shouldPlay) {
    if (shouldPlay) {
      if (this.state.isPlaying && this.state.intervalId) return;
      this.state.isPlaying = true;
      this.ui.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
      this.startAnimation();
    } else {
      if (!this.state.isPlaying && !this.state.intervalId) return;
      this.ui.playPauseBtn.innerHTML = '<i class="fas fa-play"></i> Play';
      this.stopAnimation();
    }
  }

  startInitialPlayback() {
    if (!this.state.hasUserControlledPlayback) {
      this.setPlaybackState(true);
    }
  }

  toggleClipState(btn) {
    this.state.isClippedToState = !this.state.isClippedToState;
    const abbr = this.state.stateAbbr;
    btn.innerHTML = this.state.isClippedToState
      ? `<i class="fas fa-map"></i> ${abbr} On`
      : `<i class="fas fa-map"></i> ${abbr} Off`;
    btn.classList.toggle("active", this.state.isClippedToState);

    if (this.currentGeoJsonLayer && this.currentValueData) {
      this.applyValuesToGrid(this.currentGeoJsonLayer, this.currentValueData);
    }
  }

  startAnimation() {
    if (this.state.intervalId) {
      clearInterval(this.state.intervalId);
    }
    this.state.intervalId = setInterval(() => {
      let nextIndex = parseInt(this.ui.slider.value) + 1;

      const config = VARIABLES_CONFIG[this.state.type];
      const nextHour = (nextIndex - 1) % 24;

      if (config.id === "SWDOWN" && (nextHour < 6 || nextHour > 18)) {
        nextIndex = nextHour < 6 ? Math.floor(nextIndex / 24) * 24 + 7 : Math.ceil(nextIndex / 24) * 24 + 7;
      }

      if (nextIndex > this.state.maxLayer) {
        nextIndex = config.id === "SWDOWN" ? 7 : 1;
      }

      this.ui.slider.value = nextIndex;
      this.ui.slider.dispatchEvent(new Event("input"));
    }, PLAYBACK_INTERVAL_MS);
  }

  stopAnimation() {
    clearInterval(this.state.intervalId);
    this.state.intervalId = null;
    this.state.isPlaying = false;
    this.ui.playPauseBtn.innerHTML = '<i class="fas fa-play"></i> Play';
  }

  switchVariable(variableType) {
    this.gridLayers = {};
    this.state.type = variableType;
    if (this.ui.variableSelect) this.ui.variableSelect.value = variableType;

    if (this.ui.windCanvas) {
      const ctx = this.ui.windCanvas.getContext("2d");
      ctx.clearRect(0, 0, this.ui.windCanvas.width, this.ui.windCanvas.height);
    }

    if (variableType === "eolico") {
      if (this.ui.heightSelector) this.ui.heightSelector.classList.add("active");
    } else {
      if (this.ui.heightSelector) this.ui.heightSelector.classList.remove("active");
    }

    this.updateWindLayerToggleVisibility(variableType);

    const selectedCellCoords = this.state.selectedCell
      ? {
          lat: this.state.selectedCell.lat,
          lng: this.state.selectedCell.lng,
        }
      : null;

    if (this.selectedMarker) {
      this.map.removeLayer(this.selectedMarker);
      this.selectedMarker = null;
    }

    this.applyMapChanges().then(() => {
      if (this.state.selectedCell && selectedCellCoords) {
        this.handleMapClick({
          latlng: L.latLng(selectedCellCoords.lat, selectedCellCoords.lng),
        });
      } else if (this.state.selectedCell) {
        this.updateSelectedCellData();
      }
    });
  }

  updateWindLayerToggleVisibility(variableType = this.state.type) {
    const shouldShowWindToggle = variableType === "eolico" || variableType === "wind";

    if (this.ui.windLayerToggle) {
      this.ui.windLayerToggle.classList.toggle("active", shouldShowWindToggle);
    }

    if (!shouldShowWindToggle) {
      if (this.ui.windCheckbox) this.ui.windCheckbox.checked = false;
      this.clearWindVectors();
    }
  }

  applyMapChanges() {
    const config = VARIABLES_CONFIG[this.state.type];
    const hour = (this.state.index - 1) % 24;

    if (config.id === "SWDOWN" && (hour < 6 || hour > 18)) {
      this.removeCurrentLayer();
      if (this.selectedMarker) {
        this.map.removeLayer(this.selectedMarker);
        this.selectedMarker = null;
      }
      this.updateDateTime();
      return Promise.resolve();
    }

    return this.loadValueData(this.state.index, this.state.type);
  }

  loadValueData(index, type) {
    const domain = this.state.domain;

    const id_num = String(index).padStart(3, "0");
    const variableId = this.getVariableId(type);
    const filePath = `JSON/${domain}_${variableId}_${id_num}.json`;

    return this._cachedFetch(filePath)
      .then((valueData) =>
        this.loadGridLayer(domain).then((gridLayer) => {
          if (!gridLayer) return null;

          this._precomputeStateMask(gridLayer);

          this.currentValueData = valueData;
          this.applyValuesToGrid(gridLayer, valueData);

          this.showGeoJsonLayer(gridLayer);
          this.updateUIFromMetadata(valueData.metadata);

          if (this.ui.windCheckbox && this.ui.windCheckbox.checked) {
            setTimeout(() => this.renderWindVectors(), 100);
          }

          return valueData;
        })
      )
      .catch((err) => {
        console.error("Error loading data:", err);
        this.removeCurrentLayer();
        return null;
      });
  }

  getDomainFromZoom(zoom) {
    if (zoom >= 5 && zoom <= 6) return "D01";
    if (zoom >= 7 && zoom <= 8) return "D02";
    if (zoom >= 9 && zoom <= 11) return "D03";
    if (zoom >= 12) return "D04";
    return null;
  }

  updateDomainIndicator() {
    const domain = this.state.domain;
    const domainButtons = this.ui.domainButtons || [];

    domainButtons.forEach((btn) => {
      btn.classList.remove("active");
      btn.textContent = this.getDomainLabel(btn.dataset.domain);
      btn.title = `Domínio ${this.getDomainLabel(btn.dataset.domain)}`;
      btn.setAttribute("aria-label", `Domínio ${this.getDomainLabel(btn.dataset.domain)}`);
    });

    const activeBtn = domainButtons.find((button) => button.dataset.domain === domain);
    if (activeBtn) {
      activeBtn.classList.add("active");
    }
  }

  setupDomainIndicators() {
    const domainButtons = this.ui.domainButtons || [];

    domainButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const selectedDomain = button.dataset.domain;
        const config = DOMAIN_CONFIG[selectedDomain];
        if (!config) return;
        const targetZoom = parseFloat(button.dataset.zoom) || config.zoom;

        this.state.domain = selectedDomain;
        this.gridLayers = {};
        this.updateDomainIndicator();

        if (this.state.selectedCell) {
          const selectedLat = this.state.selectedCell.lat;
          const selectedLng = this.state.selectedCell.lng;

          this.map.flyTo([selectedLat, selectedLng], targetZoom, {
            duration: 1.5,
            easeLinearity: 0.25,
          });

          this.map.once("moveend", () => {
            this.applyMapChanges().then(() => {
              this.handleMapClick({
                latlng: L.latLng(selectedLat, selectedLng),
              }).catch(() => {
                this.closeSidebar();
              });
            });
          });
        } else {
          this.applyMapChanges().then(() => {
            this.map.flyTo(config.center, targetZoom, {
              duration: 1.5,
              easeLinearity: 0.25,
            });
          });
        }
      });
    });
  }

  loadGridLayer(domain) {
    const cacheKey = domain;

    if (this.gridLayers[cacheKey]) {
      return Promise.resolve(this.gridLayers[cacheKey]);
    }

    return fetch(`GeoJSON/${domain}.geojson`)
      .then((res) => res.json())
      .then((geojson) => {
        const gridMetadata = geojson.metadata;
        const layer = L.geoJSON(geojson, {
          renderer: this._canvasRenderer,
          style: {
            weight: 0.3,
            opacity: 0.15,
            color: "white",
            fillColor: "#cccccc",
            fillOpacity: 0.45,
          },
          onEachFeature: (feature, layer) => {
            feature.properties.valor = null;
            layer.on({
              mouseover: () => {
                layer.setStyle({
                  weight: 1.2,
                  color: "#666",
                  fillOpacity: 0.65,
                });
              },
              mouseout: () => {
                layer.setStyle({
                  weight: 0.3,
                  color: "white",
                  fillOpacity: 0.45,
                });
              },
            });
          },
        });

        layer.eachLayer((cellLayer, index) => {
          const properties = cellLayer.feature?.properties || {};
          properties.index = Number.isInteger(properties.linear_index) ? properties.linear_index : index;
        });

        layer._gridMetadata = gridMetadata;
        this.gridLayers[cacheKey] = layer;
        return layer;
      })
      .catch((err) => {
        console.error("Error loading grid:", err);
        return null;
      });
  }

  applyValuesToGrid(gridLayer, valueData) {
    const values = valueData.values;
    const layers = gridLayer.getLayers();
    const config = VARIABLES_CONFIG[this.state.type];

    let scaleValues = valueData.metadata.scale_values;
    if (config.useDynamicScale && this.currentValueData) {
      const dynamicScale = this.calculateDynamicScale(this.currentValueData, config);
      if (dynamicScale) scaleValues = dynamicScale;
    }

    if (this._colorWorker) {
      const requestId = ++this._colorRequestId;
      this._colorWorker.onmessage = (e) => {
        const { requestId: responseId, colors } = e.data;
        if (responseId !== undefined && responseId !== this._colorRequestId) return;
        cancelAnimationFrame(this._applyGridRaf);
        this._applyGridRaf = requestAnimationFrame(() => {
          this.applyComputedColorsToGrid(layers, values, colors);
        });
      };
      this._colorWorker.postMessage({
        requestId,
        values,
        scaleValues,
        colors: config.colors,
      });
    } else {
      const colors = new Array(values.length);
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value !== undefined && value !== null) {
          colors[i] = this._colorFromScale(value, scaleValues, config);
        }
      }

      cancelAnimationFrame(this._applyGridRaf);
      this._applyGridRaf = requestAnimationFrame(() => {
        this.applyComputedColorsToGrid(layers, values, colors);
      });
    }
  }

  applyComputedColorsToGrid(layers, values, colors) {
    const isClipped = this.state.isClippedToState;

    for (let i = 0; i < layers.length; i++) {
      const cellIndex = this.getCellIndexForLayer(layers[i], i);
      const color = colors[cellIndex];
      if (color === undefined) continue;

      layers[i].feature.properties.valor = values[cellIndex];
      const inState = layers[i]._inStateMask !== false;

      layers[i].setStyle(
        isClipped && !inState
          ? GRID_HIDDEN_STYLE
          : {
              ...GRID_VISIBLE_STYLE,
              fillColor: color,
            }
      );
    }
  }

  getCellIndexForLayer(layer, fallbackIndex) {
    const properties = layer?.feature?.properties || {};
    return Number.isInteger(properties.index) ? properties.index : fallbackIndex;
  }

  _colorFromScale(value, scaleValues, config) {
    if (value < scaleValues[0]) return config.colors[0];
    if (value > scaleValues[scaleValues.length - 1]) return config.colors[config.colors.length - 1];
    for (let i = 0; i < scaleValues.length - 1; i++) {
      if (value >= scaleValues[i] && value < scaleValues[i + 1]) {
        const ratio = (value - scaleValues[i]) / (scaleValues[i + 1] - scaleValues[i]);
        return this.interpolateColor(config.colors, (i + ratio) / (scaleValues.length - 1));
      }
    }
    return config.colors[config.colors.length - 1];
  }

  getColorForValue(value, metadata, config) {
    let scaleValues = metadata.scale_values;

    if (config.useDynamicScale && this.currentValueData) {
      const dynamicScale = this.calculateDynamicScale(this.currentValueData, config);
      if (dynamicScale) {
        scaleValues = dynamicScale;
      }
    }

    if (value < scaleValues[0]) return config.colors[0];
    if (value > scaleValues[scaleValues.length - 1]) return config.colors[config.colors.length - 1];

    for (let i = 0; i < scaleValues.length - 1; i++) {
      if (value >= scaleValues[i] && value < scaleValues[i + 1]) {
        const ratio = (value - scaleValues[i]) / (scaleValues[i + 1] - scaleValues[i]);
        return this.interpolateColor(config.colors, (i + ratio) / (scaleValues.length - 1));
      }
    }

    return config.colors[config.colors.length - 1];
  }

  calculateDynamicScale(valueData, config) {
    if (!valueData.features || valueData.features.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;

    valueData.features.forEach((feature) => {
      if (feature.properties && feature.properties.value !== null && feature.properties.value !== undefined) {
        const val = feature.properties.value;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    });

    if (min === Infinity || max === -Infinity) return null;

    let center = config.normalValue || (min + max) / 2;
    let range = Math.max(Math.abs(max - center), Math.abs(min - center));

    const scaleMin = center - range;
    const scaleMax = center + range;

    const dynamicScale = [];
    for (let i = 0; i < 10; i++) {
      dynamicScale.push(scaleMin + (scaleMax - scaleMin) * (i / 9));
    }

    return dynamicScale;
  }

  interpolateColor(colors, factor) {
    const index = factor * (colors.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const localFactor = index - lower;

    if (lower === upper) return colors[lower];

    const c1 = this.hexToRgb(colors[lower]);
    const c2 = this.hexToRgb(colors[upper]);

    return `rgb(${Math.round(c1.r + (c2.r - c1.r) * localFactor)}, ${Math.round(c1.g + (c2.g - c1.g) * localFactor)}, ${Math.round(c1.b + (c2.b - c1.b) * localFactor)})`;
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  showGeoJsonLayer(newLayer) {
    if (this.currentGeoJsonLayer) {
      this.map.removeLayer(this.currentGeoJsonLayer);
    }
    newLayer.addTo(this.map);
    this.currentGeoJsonLayer = newLayer;

    if (this.state.selectedCell) {
      if (this.selectedMarker) {
        this.map.removeLayer(this.selectedMarker);
        this.selectedMarker = null;
      }
      this.selectedMarker = this.createPingMarker(this.state.selectedCell.lat, this.state.selectedCell.lng);
    }
  }

  removeCurrentLayer() {
    if (this.currentGeoJsonLayer) {
      this.map.removeLayer(this.currentGeoJsonLayer);
      this.currentGeoJsonLayer = null;
    }
  }

  updateUIFromMetadata(metadata) {
    const config = VARIABLES_CONFIG[this.state.type];

    if (!this.state.initialDateTime) {
      this.state.initialDateTime = this.parseDateTime(metadata.date_time);
      this.state.initialIndex = this.state.index;
    }

    this.updateColorbar(config);
    this.updateDateTime();
  }

  parseDateTime(dateStr) {
    const parts = dateStr.split(" ");
    const dateParts = parts[0].includes("/") ? parts[0].split("/").reverse().join("-") : parts[0];
    return new Date(dateParts + " " + parts[1]);
  }

  updateColorbar(config) {
    const gradient = `linear-gradient(to top, ${config.colors.join(", ")})`;
    this.ui.colorbarGradient.style.background = gradient;
    this.ui.colorbarUnit.textContent = config.unit;

    let scaleValues = this.currentValueData?.metadata.scale_values || [];

    if (config.useDynamicScale && this.currentValueData) {
      const dynamicScale = this.calculateDynamicScale(this.currentValueData, config);
      if (dynamicScale) {
        scaleValues = dynamicScale;
      }
    }

    const labelsContainer = this.ui.colorbarLabels;
    labelsContainer.innerHTML = "";

    for (let i = scaleValues.length - 1; i >= 0; i--) {
      const label = document.createElement("div");
      label.className = "colorbar-label";
      label.textContent = this.formatColorbarValue(scaleValues[i], config) + (i === scaleValues.length - 1 ? "+" : "");
      labelsContainer.appendChild(label);
    }
  }

  formatColorbarValue(value, config) {
    if (!Number.isFinite(value)) return "";
    if (config?.unit === "kg/kg") return value.toFixed(4);
    if (Math.abs(value) < 1 && value !== 0) return value.toFixed(3);
    return value.toFixed(0);
  }

  handleMapClick(e) {
    if (!this.currentGeoJsonLayer) {
      return Promise.reject("No GeoJSON layer available");
    }

    let foundCell = null;
    this.currentGeoJsonLayer.eachLayer((layer) => {
      if (layer.getBounds().contains(e.latlng)) {
        foundCell = {
          layer: layer,
          value: layer.feature.properties.valor,
          cellIndex: this.getCellIndexForLayer(layer, 0),
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          allValues: {},
        };
      }
    });

    if (!foundCell || foundCell.value === null) {
      this.showErrorMessage("Sem informações neste local");
      return Promise.reject("No cell data found at this location");
    }

    if (this.selectedMarker) {
      this.map.removeLayer(this.selectedMarker);
    }

    this.selectedMarker = this.createPingMarker(e.latlng.lat, e.latlng.lng);

    return this.loadAllVariableValuesForCell(foundCell)
      .then((allValues) => {
        foundCell.allValues = allValues;
        this.state.selectedCell = foundCell;
        this.showSidebar();
        return foundCell;
      })
      .catch((err) => {
        console.error("Error loading values:", err);
        this.showErrorMessage("Erro ao carregar informações");
        if (this.selectedMarker) {
          this.map.removeLayer(this.selectedMarker);
          this.selectedMarker = null;
        }
        throw err;
      });
  }

  createPingMarker(lat, lng) {
    const iconSize = 32;
    const scaleFactor = 1;

    const pingIcon = L.divIcon({
      className: "ping-pin",
      html: `
                <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" style="transform: scale(${scaleFactor});">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                          fill="#ff006e" stroke="#ffffff" stroke-width="0.5"/>
                    <circle cx="12" cy="9" r="2.5" fill="white"/>
                </svg>
                <span class="ping-pulse" style="width: ${iconSize}px; height: ${iconSize}px;"></span>
            `,
      iconSize: [iconSize, iconSize],
      iconAnchor: [iconSize / 2, iconSize],
      popupAnchor: [0, -iconSize],
    });

    return L.marker([lat, lng], {
      icon: pingIcon,
      zIndexOffset: 1000,
    }).addTo(this.map);
  }

  loadValueDataOnly(index, type) {
    const domain = this.state.domain;

    if (!domain) {
      return Promise.resolve(null);
    }

    const id_num = String(index).padStart(3, "0");
    const variableId = this.getVariableId(type);
    const filePath = `JSON/${domain}_${variableId}_${id_num}.json`;

    return this._cachedFetch(filePath).catch(() => null);
  }

  loadAllVariableValuesForCell(foundCell) {
    const allValues = {};

    const promises = [];

    this.getRelatedVariableTypes().forEach((varType) => {
      const config = VARIABLES_CONFIG[varType];

      if (varType === this.state.type && foundCell) {
        allValues[varType] = {
          value: foundCell.value,
          label: config.label,
          unit: config.unit,
        };
        return;
      }

      promises.push(
        this.loadValueDataOnly(this.state.index, varType)
          .then((valueData) => {
            if (
              valueData &&
              Array.isArray(valueData.values) &&
              foundCell.cellIndex >= 0 &&
              foundCell.cellIndex < valueData.values.length
            ) {
              const loadedValue = valueData.values[foundCell.cellIndex];
              allValues[varType] = {
                value: loadedValue,
                label: config.label,
                unit: config.unit,
              };
            } else {
              allValues[varType] = {
                value: null,
                label: config.label,
                unit: config.unit,
                ausente: true,
              };
            }
          })
          .catch(() => {
            allValues[varType] = {
              value: null,
              label: config.label,
              unit: config.unit,
              ausente: true,
            };
          })
      );
    });

    return Promise.all(promises).then(() => allValues);
  }

  showSidebar() {
    const cell = this.state.selectedCell;
    const config = VARIABLES_CONFIG[this.state.type];
    const sidebar = this.ui.sidebar;
    const content = this.ui.sidebarContent;

    let html = `
            <div class="info-section">
                <div class="info-section-title">
                    <i class="fas fa-map-pin"></i> Localização
                </div>
                <div class="info-item">
                    <span class="info-label">Latitude</span>
                    <span class="info-value">${cell.lat.toFixed(4)}°</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Longitude</span>
                    <span class="info-value">${cell.lng.toFixed(4)}°</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Domínio</span>
                    <span class="info-value">${this.getDomainLabel(this.state.domain)}</span>
                </div>
            </div>

            <div class="info-section">
                <div class="info-section-title">
                    <i class="fas fa-chart-line"></i> ${config.label}
                </div>
                <div class="info-item">
                    <span class="info-label">Valor</span>
                    <span class="info-value">${cell.value.toFixed(2)}<span class="info-unit">${config.unit}</span></span>
                </div>
                <div class="info-item">
                    <span class="info-label">Data/Hora</span>
                    <span class="info-value">${this.calculateDateTimeFromIndex(this.state.index)}</span>
                </div>
            </div>
        `;

    const specificInfo = config.specificInfo(cell.value, cell.allValues);
    if (specificInfo) {
      html += `
                <div class="info-section variable-specific">
                    <div class="info-section-title">
                        <i class="fas fa-bolt"></i> ${specificInfo.title}
                    </div>
            `;

      specificInfo.items.forEach((item) => {
        html += `
                    <div class="stat-card">
                        <div class="stat-card-label">
                            <i class="fas ${item.icon}"></i> ${item.label}
                        </div>
                        <div class="stat-card-value">
                            ${item.value}
                            <span class="stat-card-unit">${item.unit || ""}</span>
                        </div>
                    </div>
                `;
      });

      html += this.createParametersEditor(this.state.type);

      html += `</div>`;
    }

    content.innerHTML = html;
    sidebar.classList.add("active");

    this.setupParametersEditorListeners(this.state.type);
  }

  closeSidebar() {
    this.ui.sidebar?.classList.remove("active");

    if (this.selectedMarker) {
      this.map.removeLayer(this.selectedMarker);
      this.selectedMarker = null;
    }

    this.state.selectedCell = null;
  }

  toggleWindLayer(isEnabled) {
    if (isEnabled) {
      this.renderWindVectors();
    } else {
      this.clearWindVectors();
    }
  }

  renderWindVectors() {
    if (!this.ui.windCanvas) {
      console.warn("Wind canvas not available");
      return;
    }

    if (this.currentValueData?.metadata?.wind) {
      this._renderWindFromData(this.currentValueData.metadata.wind);
    } else {
      const domain = this.state.domain;
      const id_num = String(this.state.index).padStart(3, "0");
      const filePath = `JSON/${domain}_WIND_VECTORS_${id_num}.json`;
      const requestKey = `${domain}:${id_num}`;
      this._windRequestKey = requestKey;

      this._cachedFetch(filePath)
        .then((windData) => {
          if (this._windRequestKey !== requestKey || !this.ui.windCheckbox?.checked) return;
          this._renderWindFromData(windData);
        })
        .catch((err) => {
          console.warn("Wind vectors not available:", err.message);
          this.clearWindVectors();
        });
    }
  }

  _renderWindFromData(windData) {
    const canvas = this.ui.windCanvas;
    if (!canvas) return;

    const linearIndices = windData.downsampled_linear_indices;
    const angles = windData.downsampled_angles;
    const magnitudes = windData.downsampled_magnitudes;

    if (!linearIndices || !angles || !magnitudes || linearIndices.length === 0) {
      console.warn("Empty wind data");
      return;
    }

    canvas.width = this.map.getSize().x;
    canvas.height = this.map.getSize().y;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!this.currentGeoJsonLayer) {
      console.warn("GeoJSON layer not available");
      return;
    }

    const layers = this.currentGeoJsonLayer.getLayers();
    if (layers.length === 0) {
      console.warn("No cells on map");
      return;
    }

    const minMag = Math.min(...magnitudes);
    const maxMag = Math.max(...magnitudes);
    const magRange = maxMag - minMag || 1;

    const isClipped = this.state.isClippedToState;

    linearIndices.forEach((actualLayerIdx, idx) => {
      try {
        if (actualLayerIdx < 0 || actualLayerIdx >= layers.length) return;

        const layer = layers[actualLayerIdx];

        if (isClipped && layer._inStateMask === false) return;

        const targetLayer = layers[actualLayerIdx];
        if (!targetLayer || !targetLayer.getBounds) {
          return;
        }

        const bounds = targetLayer.getBounds();
        const center = bounds.getCenter();
        const point = this.map.latLngToContainerPoint(center);

        const angle = angles[idx];
        const magnitude = magnitudes[idx];

        if (point.x >= 0 && point.x <= canvas.width && point.y >= 0 && point.y <= canvas.height) {
          this.drawWindArrow(ctx, point.x, point.y, angle, magnitude, minMag, maxMag, magRange);
        }
      } catch {
        return;
      }
    });
  }

  drawWindArrow(ctx, x, y, angle, magnitude, minMag, maxMag, magRange) {
    const normalizedMag = (magnitude - minMag) / magRange;
    const arrowLength = 8 + normalizedMag * 16;
    const lineWidth = 0.8 + normalizedMag * 1.2;
    const arrowHeadSize = 3 + normalizedMag * 2;

    const rad = ((angle - 90) * Math.PI) / 180;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.7;

    const endX = x + arrowLength * Math.cos(rad);
    const endY = y + arrowLength * Math.sin(rad);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    const angle1 = rad + Math.PI / 6;
    const angle2 = rad - Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowHeadSize * Math.cos(angle1), endY - arrowHeadSize * Math.sin(angle1));
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowHeadSize * Math.cos(angle2), endY - arrowHeadSize * Math.sin(angle2));
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }

  clearWindVectors() {
    this._windRequestKey = null;
    const canvas = this.ui.windCanvas;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  showErrorMessage(message) {
    const alertDiv = document.createElement("div");
    alertDiv.className = "map-alert";
    alertDiv.textContent = message;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.classList.add("is-exiting");
      setTimeout(() => alertDiv.remove(), 300);
    }, 3000);
  }

  updateSelectedCellData() {
    /**
     * Updates selected cell data for a new time or variable
     * Retains marker and position, only updating the underlying information
     */
    if (!this.state.selectedCell) return;

    const cell = this.state.selectedCell;

    if (this.currentValueData && Array.isArray(this.currentValueData.values)) {
      const cellIndex = cell.cellIndex;
      if (cellIndex >= 0 && cellIndex < this.currentValueData.values.length) {
        const newValue = this.currentValueData.values[cellIndex];

        cell.value = newValue;

        this.loadAllVariableValuesForCell(cell)
          .then((allValues) => {
            cell.allValues = allValues;
            this.showSidebar();
          })
          .catch((err) => {
            console.error("Error updating cell data:", err);
            this.showErrorMessage("Sem informações meteorológicas para este horário");
            this.closeSidebar();
          });
      } else {
        this.showErrorMessage("Sem informações meteorológicas para este horário");
        this.closeSidebar();
      }
    } else {
      this.showErrorMessage("Sem informações meteorológicas disponíveis");
      this.closeSidebar();
    }
  }
}

window.MeteoMapManager = MeteoMapManager;
