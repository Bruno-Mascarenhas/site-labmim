const PLAYBACK_INTERVAL_MS = 800;
const PREFETCH_AHEAD_STEPS = 2;
// One playback loop (values + wind overlay) plus an open modal must stay resident.
const CACHE_ENTRIES_PER_TIMELINE_STEP = 5.5;
// Mirrors DAYLIGHT_ONLY_VARIABLES in the pipeline (value_source.py). Fallback only:
// with a v2 manifest, `availability` is authoritative.
const DAYLIGHT_ONLY_VARIABLE_IDS = new Set(["SWDOWN", "SWUP", "SWNET", "KT"]);
const DAYLIGHT_FALLBACK_FIRST_LOCAL_HOUR = 6;
const DAYLIGHT_FALLBACK_LAST_LOCAL_HOUR = 18;

function workerScriptUrl(fileName) {
  if (!workerScriptUrl._hashes) {
    const hashes = {};
    const meta = document.querySelector('meta[name="labmim-asset-hashes"]');
    (meta?.content || "").split(";").forEach((pair) => {
      const [name, hash] = pair.split(":");
      if (name && hash) hashes[name.trim()] = hash.trim();
    });
    workerScriptUrl._hashes = hashes;
  }
  const version = workerScriptUrl._hashes[fileName];
  // A fixed fallback token would be frozen as immutable by the .htaccess rule and pin an old worker.
  return version ? `assets/js/workers/${fileName}?v=${encodeURIComponent(version)}` : `assets/js/workers/${fileName}`;
}
function readSiteConfig() {
  const content = document.querySelector('meta[name="site-config"]')?.content;
  if (!content) throw new Error("Missing generated publication configuration");
  try {
    const parsed = JSON.parse(content);
    if (
      !parsed?.map?.initialCenter ||
      !parsed?.map?.domains ||
      !parsed?.map?.stateCode ||
      !parsed?.map?.defaultDomain ||
      !parsed?.data?.manifestPath ||
      !parsed?.data?.valuesBase ||
      !parsed?.data?.gridsBase ||
      !parsed?.data?.timeline
    ) {
      throw new Error("incomplete publication, map, or dataset configuration");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid generated publication configuration: ${error.message}`, { cause: error });
  }
}

const SITE_RUNTIME_CONFIG = readSiteConfig();
window.SITE_RUNTIME_CONFIG = SITE_RUNTIME_CONFIG;
const MAP_SITE_CONFIG = SITE_RUNTIME_CONFIG.map;
const DATA_SITE_CONFIG = SITE_RUNTIME_CONFIG.data;
const DEFAULT_MAP_CENTER = MAP_SITE_CONFIG.initialCenter;
const DEFAULT_MAP_ZOOM = MAP_SITE_CONFIG.initialZoom;
const DOMAIN_CONFIG = MAP_SITE_CONFIG.domains;
const DEFAULT_MAX_LAYER = DATA_SITE_CONFIG.timeline.defaultMaxLayer;
const DEFAULT_INITIAL_INDEX = DATA_SITE_CONFIG.timeline.initialIndex;
const TIMELINE_STEP_HOURS = DATA_SITE_CONFIG.timeline.stepHours;
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
const GRID_NODATA_STYLE = {
  ...GRID_VISIBLE_STYLE,
  fillColor: "#cccccc",
};

function _debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function _pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function _pointInPolygonCoords(lng, lat, polygonCoords) {
  if (!_pointInRing(lng, lat, polygonCoords[0])) return false;
  for (let h = 1; h < polygonCoords.length; h++) {
    if (_pointInRing(lng, lat, polygonCoords[h])) return false;
  }
  return true;
}

function pointInGeoJsonFeature(lng, lat, feature) {
  const geometry = feature?.geometry;
  if (!geometry) return false;
  if (geometry.type === "Polygon") return _pointInPolygonCoords(lng, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygonCoords) => _pointInPolygonCoords(lng, lat, polygonCoords));
  }
  return false;
}

class MeteoMapManager {
  constructor() {
    this.mapContext = this.resolveMapContext();
    this.contextConfig = VARIABLE_CONTEXTS[this.mapContext] || VARIABLE_CONTEXTS.forecast;
    // Pipeline run version from the manifest, appended as ?v= to every data URL so
    // the fixed-name files can be cached long-term.
    this.dataVersion = null;
    this.map = null;
    this.currentGeoJsonLayer = null;
    this.currentValueData = null;
    // Which (domain, variable, timestep) currentValueData holds, so a click can tell
    // whether the load has caught up with the current view.
    this._currentValueKey = null;
    // The in-flight applyMapChanges() load, tagged with the view it targets.
    this._currentApply = null;
    this.gridLayers = {};
    this._gridLayerPromises = new Map();
    this.dataService = new LabmimDataService({
      workerUrl: workerScriptUrl("json-parser.worker.js"),
    });

    // Timeline contract from a v2 manifest; until one arrives, the build defaults hold.
    this.timeline = {
      indexMin: 1,
      indexMax: null,
      availability: null,
      features: null,
      startLocal: null,
    };

    this._colorWorker = null;
    this._colorRequestId = 0;
    this._pendingColorRequest = null;
    this._windRequestKey = null;
    try {
      this._colorWorker = new Worker(workerScriptUrl("color-calc.worker.js"));
      const onColorWorkerFailure = (event) => {
        console.warn("Color worker failed, falling back to main thread:", event?.message || event);
        try {
          this._colorWorker.terminate();
        } catch {
          /* worker already gone */
        }
        this._colorWorker = null;
        if (this._pendingColorRequest) {
          const { layers, values, scaleValues, config } = this._pendingColorRequest;
          this._pendingColorRequest = null;
          this._applyColorsOnMainThread(layers, values, scaleValues, config);
        }
      };
      this._colorWorker.onerror = onColorWorkerFailure;
      this._colorWorker.onmessageerror = onColorWorkerFailure;
    } catch (err) {
      console.warn("Web Workers not available, falling back to main thread:", err);
      this._colorWorker = null;
    }
    this.stateGeoJson = null;
    this.selectedMarker = null;
    this.customParameters = {};
    this.windHeight = 50;

    this.ui = {};

    this.state = {
      type: this.contextConfig.defaultVariable,
      domain: MAP_SITE_CONFIG.defaultDomain,
      index: DEFAULT_INITIAL_INDEX,
      // Accumulation window in hours; re-anchored per variable by configureAccumulationSelector.
      accumHours: 1,
      isPlaying: false,
      hasUserControlledPlayback: false,
      isClippedToState: false,
      stateAbbr: MAP_SITE_CONFIG.stateCode,
      maxLayer: DEFAULT_MAX_LAYER,
      initialDateTime: null,
      initialIndex: null,
      intervalId: null,
      selectedCell: null,
    };

    this.initMap();
    this.setupEventListeners();
    this.setupDomainIndicators();
    this.loadStateGeoJson();
    this.loadCustomParameters();
  }

  resolveMapContext() {
    const context = document.body?.dataset?.mapContext || "forecast";
    return VARIABLE_CONTEXTS[context] ? context : "forecast";
  }

  getDomainConfig(domain = this.state.domain) {
    return DOMAIN_CONFIG[domain] || { label: domain, center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM };
  }

  getDomainLabel(domain = this.state.domain) {
    return this.getDomainConfig(domain).label;
  }

  getVisibleVariableTypes() {
    return this.contextConfig.variables.filter((variableType) => VARIABLES_CONFIG[variableType]);
  }

  /**
   * The active variable plus the companions its specificInfo reads: fetching every
   * visible one would pull ~10 full-domain files per click to show three numbers.
   */
  getRelatedVariableTypes() {
    const variables = new Set([this.state.type]);
    (VARIABLES_CONFIG[this.state.type]?.relatedVariables || []).forEach((variableType) => {
      if (VARIABLES_CONFIG[variableType]) variables.add(variableType);
    });
    return [...variables];
  }

  /** Must stay a method: ChartsManager reaches it as app._cachedFetch. */
  _cachedFetch(url, options = {}) {
    return this.dataService.fetchJson(url, options);
  }

  /** Every pipeline run publishes a new version, so a versioned URL never pins a stale forecast. */
  dataUrl(path) {
    return this.dataVersion ? `${path}?v=${encodeURIComponent(this.dataVersion)}` : path;
  }

  valuesJsonPath(domain, variableId, index) {
    return `${DATA_SITE_CONFIG.valuesBase}/${domain}_${variableId}_${String(index).padStart(3, "0")}.json`;
  }

  gridJsonPath(domain) {
    return `${DATA_SITE_CONFIG.gridsBase}/${domain}.grid.json`;
  }

  gridGeoJsonPath(domain) {
    return `${DATA_SITE_CONFIG.gridsBase}/${domain}.geojson`;
  }

  /**
   * Adopts a pipeline manifest: the run version for ?v= URLs and, on v2, the timeline
   * contract, so a longer run or a newly gated variable never requires an edit here.
   */
  applyManifest(manifest) {
    if (typeof manifest?.version === "string" && manifest.version) {
      this.dataVersion = manifest.version;
    }

    if (Number.isInteger(manifest?.index_max) && manifest.index_max >= 1) {
      this.timeline.indexMax = manifest.index_max;
      this.timeline.indexMin = Number.isInteger(manifest.index_min) ? Math.max(1, manifest.index_min) : 1;
      this.dataService.ensureCacheLimit(Math.ceil(manifest.index_max * CACHE_ENTRIES_PER_TIMELINE_STEP));
    } else {
      // A v1 manifest (or a rollback) carries no timeline: the previous run's range must not survive it.
      this.timeline.indexMax = null;
      this.timeline.indexMin = 1;
    }
    this.state.maxLayer = this.timeline.indexMax ?? DEFAULT_MAX_LAYER;
    if (this.ui.slider) {
      this.ui.slider.max = String(this.state.maxLayer);
      // A --skip-first run starts above 1, and any position below indexMin is draggable but unloadable.
      this.ui.slider.min = String(this.timeline.indexMin);
      if (parseInt(this.ui.slider.value, 10) > this.state.maxLayer) {
        this.ui.slider.value = String(this.state.maxLayer);
        this.state.index = this.state.maxLayer;
      }
      if (parseInt(this.ui.slider.value, 10) < this.timeline.indexMin) {
        this.ui.slider.value = String(this.timeline.indexMin);
        this.state.index = this.timeline.indexMin;
      }
    }

    this.timeline.availability =
      manifest?.availability && typeof manifest.availability === "object" ? manifest.availability : null;
    this.timeline.features = manifest?.features && typeof manifest.features === "object" ? manifest.features : null;

    // start_local is the local datetime of FILE INDEX 0, so it always pairs with
    // initialIndex 0 — never index_min, which a skip-first run pushes above 0.
    if (typeof manifest?.start_local === "string") {
      try {
        const parsed = this.parseDateTime(manifest.start_local);
        if (parsed instanceof Date && !isNaN(parsed)) {
          this.timeline.startLocal = manifest.start_local;
          this.state.initialDateTime = parsed;
          this.state.initialIndex = 0;
        }
      } catch {
        /* older manifest or malformed date: keep the file-metadata anchor */
      }
    }

    // Availability is only known now, and the inherited index may not be one of the
    // steps this variable was exported at (the solar ones are absent overnight).
    this._snapIndexToAvailable();

    this.updateDateTime();
  }

  /**
   * Reacts to a manifest re-check. A genuinely new run behind the same fixed file
   * names invalidates every cache keyed on the old bytes; no-op while unchanged.
   */
  handleManifestUpdate(manifest, chartsManagerInstance = this.chartsManager) {
    if (!manifest?.version) return;
    if (!this.dataVersion) {
      // Session ran unversioned so far: same run, just late, so nothing is stale.
      this.applyManifest(manifest);
      this.applyMapChanges();
      return;
    }
    if (manifest.version === this.dataVersion) return;

    this.dataService.clear();
    chartsManagerInstance?.clearCaches?.();
    // Both describe the previous run: closing beats showing two runs side by side.
    chartsManagerInstance?.closeModal?.();
    this.closeSidebar();
    // Grid geometry can change between runs; the generation token keeps an in-flight
    // old-run fetch from repopulating the cache after this reset.
    this.gridLayers = {};
    this._gridLayerPromises.clear();
    this._gridGeneration = (this._gridGeneration || 0) + 1;

    this.state.initialDateTime = null;
    this.state.initialIndex = null;
    this.applyManifest(manifest);

    // Safe only after applyManifest: it snapped the paused index onto the new grid.
    this.applyMapChanges();
    this.scheduleVariablePreviewRefresh();
  }

  /**
   * Whether the pipeline exports this variable at this step. Manifest ranges win; the
   * legacy fallback optimistically allows the index when no anchor is known yet — a
   * miss is a handled 404, never a wrong blank.
   */
  isIndexAvailable(index, type = this.state.type) {
    const config = VARIABLES_CONFIG[type];
    if (!config) return true;

    // A v2 manifest bounds the whole timeline; variables absent from `availability` cover it all.
    if (this.timeline.indexMax !== null && (index < this.timeline.indexMin || index > this.timeline.indexMax)) {
      return false;
    }

    const ranges = this.timeline.availability?.[this.getVariableId(type)];
    if (Array.isArray(ranges)) {
      return ranges.some((range) => index >= range[0] && index <= range[1]);
    }

    if (!DAYLIGHT_ONLY_VARIABLE_IDS.has(config.id)) return true;
    const date = this.calculateTargetDateFromIndex(index);
    if (!date) return true;
    const hour = date.getUTCHours();
    return hour >= DAYLIGHT_FALLBACK_FIRST_LOCAL_HOUR && hour <= DAYLIGHT_FALLBACK_LAST_LOCAL_HOUR;
  }

  /**
   * First index with data at or after `from`, wrapping past maxLayer to indexMin;
   * `from` unchanged when a full lap finds nothing (the load path then shows no-data).
   */
  nextPlayableIndex(from, type = this.state.type) {
    const maxLayer = this.state.maxLayer;
    const minIndex = this.timeline.indexMin;
    const start = from > maxLayer || from < minIndex ? minIndex : from;
    let index = start;
    for (let hops = 0; hops <= maxLayer; hops++) {
      if (index > maxLayer) index = minIndex;
      if (this.isIndexAvailable(index, type)) return index;
      index += 1;
    }
    return start;
  }

  /**
   * Moves the current step (and the slider) to the first one where `type` exists.
   * The shortwave variables only exist by day, and a blank map at an instant the
   * pipeline never published gives no hint that moving the timeline fixes it.
   */
  _snapIndexToAvailable(type = this.state.type) {
    if (this.isIndexAvailable(this.state.index, type)) return this.state.index;
    const next = this.nextPlayableIndex(this.state.index, type);
    this.state.index = next;
    if (this.ui.slider) this.ui.slider.value = String(next);
    return next;
  }

  getAccumulationConfig(variableType = this.state.type) {
    const accumulation = VARIABLES_CONFIG[variableType]?.accumulation;
    return Array.isArray(accumulation?.options) && accumulation.options.length ? accumulation : null;
  }

  getAccumulationOption(variableType = this.state.type) {
    const accumulation = this.getAccumulationConfig(variableType);
    if (!accumulation) return null;
    return (
      accumulation.options.find((option) => option.hours === this.state.accumHours) ||
      accumulation.options.find((option) => option.hours === accumulation.defaultHours) ||
      accumulation.options[0]
    );
  }

  /**
   * How many steps really went into the painted field: near the start of the timeline
   * the accumulation window runs out of earlier steps and shortens (the `break` in
   * _fetchValues). Anything that is not the field on screen reports the nominal window.
   */
  getAccumulatedSteps(variableType = this.state.type) {
    const nominal = this.getAccumulationOption(variableType)?.hours || 1;
    if (variableType !== this.state.type || this._currentValueKey !== this._loadKey()) return nominal;
    const steps = this.currentValueData?.accumulatedSteps;
    return Number.isInteger(steps) && steps > 0 ? Math.min(steps, nominal) : nominal;
  }

  /**
   * VARIABLES_CONFIG resolved against the current accumulation window: a 3h total
   * needs its own range and label. Every consumer of the *displayed* variable must
   * read this, not VARIABLES_CONFIG directly.
   */
  getVariableConfig(variableType = this.state.type) {
    const config = VARIABLES_CONFIG[variableType];
    const option = this.getAccumulationOption(variableType);
    if (!config || !option) return config;
    const steps = this.getAccumulatedSteps(variableType);
    return {
      ...config,
      // On a shortened window, announcing a 1h total as a 3h one is a wrong reading.
      label:
        steps < option.hours ? `${config.label} (${steps}h de ${option.hours}h)` : option.variableLabel || config.label,
      scaleMax: Number.isFinite(option.scaleMax) ? option.scaleMax : config.scaleMax,
    };
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
        this._applyMapChangesReselecting(this.state.selectedCell);
        // The panel summarizes the height-resolved variable, so it must follow the map.
        this.scheduleVariablePreviewRefresh();
      }
    }
  }

  setAccumulationHours(hours) {
    const accumulation = this.getAccumulationConfig();
    if (!accumulation || !accumulation.options.some((option) => option.hours === hours)) return;
    if (hours === this.state.accumHours) return;

    this.state.accumHours = hours;
    this.updateAccumulationButtons();
    // Repaint up front, or a failed load leaves the previous window's scale under the new button.
    this.updateColorbar(this.getVariableConfig(), null);
    this._applyMapChangesReselecting(this.state.selectedCell);
  }

  loadCustomParameters() {
    try {
      const saved = JSON.parse(localStorage.getItem("meteoMapCustomParameters"));
      this.customParameters = saved && typeof saved === "object" ? saved : {};
    } catch (e) {
      console.warn("Error loading custom parameters:", e);
      this.customParameters = {};
    }
  }

  getCustomParameter(variableType, paramName) {
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
      this.chartsManager?.reloadChartsWithNewParameters();
    } catch (e) {
      console.warn("Error saving parameters to localStorage:", e);
    }
  }

  resetCustomParameters(variableType) {
    const prefix = `${variableType}_`;
    Object.keys(this.customParameters).forEach((key) => {
      if (key.startsWith(prefix)) {
        delete this.customParameters[key];
      }
    });

    try {
      localStorage.setItem("meteoMapCustomParameters", JSON.stringify(this.customParameters));
      this.chartsManager?.reloadChartsWithNewParameters();
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
    // The comma is the decimal separator in Portuguese and what `inputmode="decimal"`
    // offers on a phone; dropping it would turn "1,225" into an accepted 1225.
    let sanitized = value.replace(/,/g, ".").replace(/[^\d.-]/g, "");

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
    // Sanitize again: `input` is not the only route to a save (paste, autofill).
    const value = this.sanitizeNumericInput(input.value).trim();
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

      inputs.forEach((input) => {
        const validateAndSave = (e) => {
          this.saveParameterInput(variableType, e.target);
          this.updateSidebarWithNewParameters(variableType);
        };

        input.addEventListener("blur", validateAndSave);

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.code === "Enter") {
            e.preventDefault();
            // Deliberately no `blur()`: it would repeat the save through the blur
            // listener and drop keyboard users on <body>, restarting Tab at the top.
            validateAndSave(e);
          }
        });

        input.addEventListener("input", (e) => {
          e.target.value = this.sanitizeNumericInput(e.target.value);
        });
      });

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

  _specificInfoStatsHtml(specificInfo) {
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

    return html;
  }

  _specificInfoHtml(specificInfo) {
    return this._specificInfoStatsHtml(specificInfo) + this.createParametersEditor(this.state.type);
  }

  updateSidebarSpecificInfo(specificInfo) {
    const sidebarContent = this.ui.sidebarContent || document.getElementById("sidebarContent");
    const existingSpecific = sidebarContent.querySelector(".variable-specific");

    if (!existingSpecific) return;

    const existingEditor = existingSpecific.querySelector(".parameters-editor");

    // This runs on the `blur` of an editor field, i.e. with Tab already on its way to
    // the next one. Recreating the editor would destroy the field about to take focus,
    // so reuse it when it belongs to the displayed variable and redraw only the stats.
    const reusableEditor =
      existingEditor?.parentElement === existingSpecific &&
      existingEditor.querySelector(`.parameters-list[data-variable="${this.state.type}"]`)
        ? existingEditor
        : null;

    if (reusableEditor) {
      const stale = [];
      for (let node = existingSpecific.firstChild; node && node !== reusableEditor; node = node.nextSibling) {
        stale.push(node);
      }
      stale.forEach((node) => node.remove());
      reusableEditor.insertAdjacentHTML("beforebegin", this._specificInfoStatsHtml(specificInfo));
      return;
    }

    const wasEditorOpen = Boolean(existingEditor?.querySelector(".parameters-list")?.classList.contains("active"));

    existingSpecific.innerHTML = this._specificInfoHtml(specificInfo);

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
    });

    const fitBounds = MAP_SITE_CONFIG.fitBounds;
    if (
      Array.isArray(fitBounds) &&
      fitBounds.length === 2 &&
      fitBounds.every((corner) => Array.isArray(corner) && corner.length === 2)
    ) {
      this.map.fitBounds(fitBounds, {
        padding: [20, 20],
        maxZoom: MAP_SITE_CONFIG.fitMaxZoom || DEFAULT_MAP_ZOOM,
      });
    } else {
      this.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    }

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: `&copy; OpenStreetMap | ${MAP_SITE_CONFIG.attribution}`,
      minZoom: 3,
      maxZoom: 15,
    }).addTo(this.map);

    // Leaflet's keyboard handler puts tabindex="0" on the container, but with no role
    // and no accessible name the Tab stop announces nothing and screen readers swallow
    // the arrow keys. Only fill in what the document did not provide.
    const container = this.map.getContainer();
    if (!container.getAttribute("role")) container.setAttribute("role", "application");
    if (!container.getAttribute("aria-label")) {
      container.setAttribute("aria-label", "Mapa interativo: setas movem o mapa, Enter lê a célula no centro");
    }

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
      accumSelector: document.getElementById("accumSelector"),
      accumSelectorTitle: document.getElementById("accumSelectorTitle"),
      accumButtonGroup: document.getElementById("accumButtonGroup"),
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
    if (!canvas || this.windCanvasUpdateHandler) return;

    this.windCanvasUpdateHandler = () => {
      // Assigning width/height discards the canvas backing store and this runs once per
      // frame while panning, hence the size guard.
      const windCheckbox = this.ui.windCheckbox || document.getElementById("windLayerCheckbox");
      if (!windCheckbox || !windCheckbox.checked) return;

      const size = this.map.getSize();
      if (canvas.width !== size.x || canvas.height !== size.y) {
        canvas.width = size.x;
        canvas.height = size.y;
      }
      cancelAnimationFrame(this.windRenderScheduled);
      this.windRenderScheduled = requestAnimationFrame(() => this.renderWindVectors());
    };

    this.windCanvasUpdateHandler();

    this.map.on("move", this.windCanvasUpdateHandler, this);
    this.map.on("resize", this.windCanvasUpdateHandler, this);
    this.map.on("zoomend", this.windCanvasUpdateHandler, this);
  }

  setupEventListeners() {
    this.cacheUIElements();
    this.configureVariableSelect();
    this.configureAccumulationSelector();

    // The document ships the legend with a sample unit and only a successful load
    // rewrites it, so paint it here too — otherwise it describes another variable.
    this.updateColorbar(this.getVariableConfig(), null);

    const _debouncedSliderApply = _debounce(() => {
      this._applyMapChangesReselecting(this.state.isPlaying ? null : this.state.selectedCell);
    }, 100);

    this.ui.slider.addEventListener("input", (e) => {
      this.state.index = parseInt(e.target.value);
      this.updateDateTime();
      this.scheduleVariablePreviewRefresh();
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
        heightButtons.forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        e.target.classList.add("active");
        e.target.setAttribute("aria-pressed", "true");
        this.setWindHeight(height);
      });
    });

    // Delegated: configureAccumulationSelector rebuilds these buttons per variable.
    this.ui.accumButtonGroup?.addEventListener("click", (e) => {
      const button = e.target.closest(".accum-btn");
      if (!button) return;
      this.setAccumulationHours(parseInt(button.dataset.accum, 10));
    });

    if (this.ui.windCheckbox) {
      this.ui.windCheckbox.addEventListener("change", (e) => {
        this.toggleWindLayer(e.target.checked);
      });
    }

    this.map.on("click", (e) => {
      this.handleMapClick(e, { userInitiated: true }).catch(() => {
        /* feedback already shown by showErrorMessage */
      });
    });

    // The grid is one canvas with no per-cell node to focus: Enter/Space read the cell
    // at the center and Leaflet's arrow keys move that center across the grid.
    const mapContainer = this.map.getContainer();
    mapContainer.addEventListener("keydown", (e) => {
      // The zoom controls are children of the container; their Enter must not land here.
      if (e.target !== mapContainer) return;
      if (e.key !== "Enter" && e.key !== " " && e.code !== "Space") return;
      e.preventDefault();
      this.handleMapClick({ latlng: this.map.getCenter() }, { userInitiated: true }).catch(() => {
        /* feedback already shown by showErrorMessage */
      });
    });

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
      option.title = config.summary || config.label;
      optionGroup.appendChild(option);
    });

    this.ui.variableSelect.appendChild(optionGroup);
    this.ui.variableSelect.value = selectedVariable;
    this.state.type = selectedVariable;
  }

  /**
   * The buttons come from VARIABLES_CONFIG, so the windows offered can never drift
   * from the ones _fetchValues knows how to build.
   */
  configureAccumulationSelector(variableType = this.state.type) {
    const selector = this.ui.accumSelector;
    if (!selector) return;

    const accumulation = this.getAccumulationConfig(variableType);
    selector.classList.toggle("active", Boolean(accumulation));
    if (!accumulation) return;

    // A window selected for the previous variable may not exist here.
    if (!accumulation.options.some((option) => option.hours === this.state.accumHours)) {
      this.state.accumHours = this.getAccumulationOption(variableType).hours;
    }

    if (this.ui.accumSelectorTitle) {
      this.ui.accumSelectorTitle.textContent = accumulation.title || "Acumulado:";
    }

    const group = this.ui.accumButtonGroup;
    if (!group) return;

    group.innerHTML = "";
    accumulation.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-btn accum-btn";
      button.dataset.accum = String(option.hours);
      button.textContent = option.label;
      button.title = `Precipitação acumulada em ${option.hours}h`;
      group.appendChild(button);
    });

    this.updateAccumulationButtons();
  }

  updateAccumulationButtons() {
    const buttons = this.ui.accumButtonGroup?.querySelectorAll(".accum-btn") || [];
    const activeHours = this.getAccumulationOption()?.hours;

    buttons.forEach((button) => {
      const isActive = parseInt(button.dataset.accum, 10) === activeHours;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  setupDocumentationListeners() {
    const { docBtn, docCloseBtn, docModal, docTabs, docTabContents } = this.ui;

    if (!docBtn || !docCloseBtn || !docModal) return;

    const closeDoc = () => {
      docModal.classList.remove("active");
      if (this._docReturnFocusEl && document.contains(this._docReturnFocusEl)) {
        this._docReturnFocusEl.focus();
      }
      this._docReturnFocusEl = null;
    };

    docBtn.addEventListener("click", () => {
      this._docReturnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      docModal.classList.add("active");
      // aria-modal="true" hides the rest of the page, so focus must move inside.
      docCloseBtn.focus();
    });

    docCloseBtn.addEventListener("click", closeDoc);

    docModal.addEventListener("click", (e) => {
      if (e.target === docModal) {
        closeDoc();
      }
    });

    const trapDocFocus = (event) => {
      const focusables = [
        ...docModal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
        // Inactive tabs are <button> with tabindex="-1" (roving tabindex), which the
        // `button` token drags back in — hence the filter below.
      ].filter((el) => !el.disabled && el.getAttribute("tabindex") !== "-1" && el.getClientRects().length > 0);
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !docModal.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !docModal.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const selectTab = (tab) => {
      const tabName = tab.getAttribute("data-tab");

      docTabs.forEach((candidate) => {
        const isSelected = candidate === tab;
        candidate.classList.toggle("active", isSelected);
        candidate.setAttribute("aria-selected", String(isSelected));
        // ARIA roving tabindex for tabs: only the active tab is a tab stop.
        candidate.setAttribute("tabindex", isSelected ? "0" : "-1");
      });
      docTabContents.forEach((content) => {
        content.classList.toggle("active", content.dataset.tab === tabName);
      });
    };

    docTabs.forEach((tab, i) => {
      tab.addEventListener("click", () => selectTab(tab));
      tab.addEventListener("keydown", (e) => {
        const tabCount = docTabs.length;
        let next = null;
        if (e.key === "ArrowRight") next = docTabs[(i + 1) % tabCount];
        else if (e.key === "ArrowLeft") next = docTabs[(i - 1 + tabCount) % tabCount];
        else if (e.key === "Home") next = docTabs[0];
        else if (e.key === "End") next = docTabs[tabCount - 1];
        if (next) {
          e.preventDefault();
          next.focus();
          selectTab(next);
        }
      });
    });

    document.addEventListener("keydown", (e) => {
      if (!docModal.classList.contains("active")) return;
      if (e.key === "Escape") {
        closeDoc();
        return;
      }
      if (e.key === "Tab") trapDocFocus(e);
    });
  }

  setupVariableOverview(chartsManagerInstance) {
    this.chartsManager = chartsManagerInstance;
    this.ui.variableOverviewPanel = document.getElementById("variableOverviewPanel");
    this.ui.variableOverviewToggle = document.getElementById("variableOverviewToggle");
    this.ui.variableCardsGrid = document.getElementById("variableCardsGrid");
    this.ui.variablePreviewCanvas = document.getElementById("variablePreviewCanvas");
    this.ui.variablePreviewStats = document.getElementById("variablePreviewStats");
    this.ui.variablePreviewTitle = document.getElementById("variablePreviewTitle");
    this.ui.variablePreviewLabel = document.getElementById("variablePreviewLabel");
    this.ui.variablePreviewDomain = document.getElementById("variablePreviewDomain");

    if (!this.ui.variableOverviewPanel || !this.ui.variableCardsGrid) return;

    this.renderVariableGuideCards();
    this._debouncedPreviewRefresh = _debounce(() => this.refreshVariableOverviewPreview(), 250);
    this.updateVariableOverviewToggle();

    this.ui.variableOverviewToggle?.addEventListener("click", () => {
      const isCollapsed = this.ui.variableOverviewPanel.classList.toggle("is-collapsed");
      this.updateVariableOverviewToggle(isCollapsed);
      if (!isCollapsed) this.refreshVariableOverviewPreview();
    });

    this.updateVariablePreviewShell(this.state.type);
  }

  updateVariableOverviewToggle(isCollapsed = this.ui.variableOverviewPanel?.classList.contains("is-collapsed")) {
    const toggle = this.ui.variableOverviewToggle;
    if (!toggle) return;

    const icon = toggle.querySelector("i");
    const label = toggle.querySelector("span");

    if (icon) icon.className = isCollapsed ? "fas fa-chevron-down" : "fas fa-chevron-up";
    if (label) label.textContent = isCollapsed ? "Ver detalhes" : "Recolher";
    toggle.title = isCollapsed ? "Ver detalhes" : "Recolher painel";
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
  }

  renderVariableGuideCards() {
    const fragment = document.createDocumentFragment();

    this.getVisibleVariableTypes().forEach((variableType) => {
      const config = VARIABLES_CONFIG[variableType];
      if (!config) return;

      const card = document.createElement("article");
      card.className = "variable-guide-card";
      card.dataset.variable = variableType;

      card.innerHTML = `
        <div class="variable-card-title">
          <span>${config.icon || ""} ${config.optionLabel || config.label}</span>
          <i class="fas fa-info-circle variable-info-icon" title="${config.summary || config.label}"></i>
        </div>
        <div class="variable-card-meta">
          ${config.unit ? `<span class="variable-card-chip">${config.unit}</span>` : ""}
          <span class="variable-card-chip">${config.sourceId || config.id}</span>
        </div>
        <p class="variable-card-summary">${config.summary || "Variável disponível no mapa interativo."}</p>
        <button class="variable-card-action" type="button" data-variable="${variableType}">
          <i class="fas fa-map-location-dot"></i> Abrir no mapa
        </button>
      `;

      card.querySelector(".variable-card-action")?.addEventListener("click", () => {
        this.switchVariable(variableType);
      });

      fragment.appendChild(card);
    });

    this.ui.variableCardsGrid.innerHTML = "";
    this.ui.variableCardsGrid.appendChild(fragment);
    this.updateVariableGuideSelection();
  }

  updateVariableGuideSelection(variableType = this.state.type) {
    if (!this.ui.variableCardsGrid) return;

    this.ui.variableCardsGrid.querySelectorAll(".variable-guide-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.variable === variableType);
    });
  }

  updateVariablePreviewShell(variableType = this.state.type) {
    const config = this.getVariableConfig(variableType);
    if (!config) return;

    if (this.ui.variablePreviewTitle) {
      this.ui.variablePreviewTitle.textContent = config.optionLabel || config.label;
    }
    if (this.ui.variablePreviewLabel) {
      // Dimensionless variables declare no unit, so the separator would dangle.
      const source = config.sourceId || config.id;
      this.ui.variablePreviewLabel.textContent = config.unit ? `${source} · ${config.unit}` : source;
    }
    if (this.ui.variablePreviewDomain) {
      this.ui.variablePreviewDomain.textContent = this.getDomainLabel(this.state.domain);
      this.ui.variablePreviewDomain.title = `Domínio técnico: ${this.state.domain}`;
    }
    if (this.ui.variablePreviewStats) {
      this.ui.variablePreviewStats.innerHTML =
        '<div class="variable-preview-empty">Abra uma variável no mapa para carregar a prévia leve do domínio atual.</div>';
    }
  }

  scheduleVariablePreviewRefresh() {
    if (this._debouncedPreviewRefresh) {
      this._debouncedPreviewRefresh();
    }
  }

  refreshVariableOverviewPreview(variableType = this.state.type) {
    this.updateVariableGuideSelection(variableType);
    this.updateVariablePreviewShell(variableType);

    if (!this.chartsManager || !this.ui.variableOverviewPanel) return;
    if (this.ui.variableOverviewPanel.classList.contains("is-collapsed")) return;

    this.chartsManager.renderDomainSummary(variableType, this.state.domain, {
      canvasId: "variablePreviewCanvas",
      statsContainer: this.ui.variablePreviewStats,
      titleElement: this.ui.variablePreviewTitle,
      labelElement: this.ui.variablePreviewLabel,
      domainElement: this.ui.variablePreviewDomain,
    });
  }

  /**
   * The path must come from the declared `boundaryAsset`: build-all's reachability
   * narrowing scans only HTML and CSS, so a path built from any other state code
   * would 404.
   */
  loadStateGeoJson() {
    const stateCode = MAP_SITE_CONFIG.stateCode;
    this.state.stateAbbr = stateCode;
    fetch(MAP_SITE_CONFIG.boundaryAsset)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((geojson) => {
        this.stateGeoJson = geojson.features[0];
        if (this.ui.clipStateBtn) {
          this.ui.clipStateBtn.innerHTML = `<i class="fas fa-map"></i> ${stateCode} Off`;
          this.ui.clipStateBtn.style.display = "inline-block";
        }

        // The mask is an O(cells x boundary points) ray cast: never on plain startup.
        if (this.currentGeoJsonLayer && this.state.isClippedToState) {
          this._precomputeStateMask(this.currentGeoJsonLayer);
          if (this.currentValueData) {
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
      const lng = (bounds.getEast() + bounds.getWest()) / 2;
      const lat = (bounds.getNorth() + bounds.getSouth()) / 2;
      layer._inStateMask = pointInGeoJsonFeature(lng, lat, this.stateGeoJson);
    });
    gridLayer._stateMaskComputed = true;
  }

  updateDateTime() {
    if (this.ui.layerLabel) {
      const hasData = this.isIndexAvailable(this.state.index);
      const targetDate = this.calculateTargetDateFromIndex(this.state.index);
      // With nothing published there is no instant to stamp.
      const label =
        !targetDate && this._noPublishedDataNotice
          ? this._noPublishedDataNotice
          : this.formatForecastDateTimeLabel(targetDate, hasData);
      this.ui.layerLabel.textContent = label;
      // The slider value is a WRF timestep index: assistive tech would say "10 of 75".
      if (this.ui.slider) this.ui.slider.setAttribute("aria-valuetext", label);
    }
  }

  /**
   * The label advances on the slider's input event, but the field is repainted only
   * once the load answers; aria-busy declares that window. Attribute only: any blink
   * would follow the 800 ms repaint beat.
   */
  _setTimeLabelBusy(isBusy) {
    if (!this.ui.layerLabel) return;
    if (isBusy) this.ui.layerLabel.setAttribute("aria-busy", "true");
    else this.ui.layerLabel.removeAttribute("aria-busy");
  }

  calculateTargetDateFromIndex(index) {
    if (!this.state.initialDateTime) return null;
    const hoursDiff = (index - this.state.initialIndex) * TIMELINE_STEP_HOURS;
    const date = new Date(this.state.initialDateTime.getTime());
    date.setTime(date.getTime() + hoursDiff * 60 * 60 * 1000);
    return date;
  }

  calculateDateTimeFromIndex(index) {
    const date = this.calculateTargetDateFromIndex(index);
    if (!date) return `Hora ${index}`;
    return this.formatForecastDateTimeLabel(date, true);
  }

  formatForecastDateTimeLabel(date, hasData = true) {
    if (!date) return "Carregando...";

    const year = date.getUTCFullYear();
    const monthIndex = date.getUTCMonth();
    const month = String(monthIndex + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");

    if (hasData) {
      return `${year}-${month}-${day} · ${hours}:${minutes} UTC−03:00`;
    }

    // Generic wording: gaps are not only night hours (skip-first spin-up steps too).
    const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    const monthStr = months[monthIndex];
    return `${day} ${monthStr} ${year} · ${hours}:${minutes} UTC−03:00 — sem dados neste horário`;
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
      this.stopAnimation();
    }
  }

  /**
   * The largest movement on the site is this setInterval repainting the whole grid
   * every 800 ms, and base.css's `prefers-reduced-motion` block does not reach JS.
   * Motion never starts unrequested (WCAG 2.3.3); Play stays available to everyone.
   */
  startInitialPlayback() {
    if (this.state.hasUserControlledPlayback) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    this.setPlaybackState(true);
  }

  /**
   * The model output directory does not exist on this server yet (fresh bundle, CI,
   * the window between deploying pages and deploying data). Playback does not start
   * alongside it (map-init.js), or the empty map would retry every 800 ms.
   */
  showNoPublishedDataNotice() {
    // On phones the label is clipped to the bar width, so the essential part goes first.
    this._noPublishedDataNotice =
      "Dados do modelo ainda não publicados. Eles são anexados ao site no deploy, separadamente das páginas.";
    this.updateDateTime();
  }

  toggleClipState(btn) {
    this.state.isClippedToState = !this.state.isClippedToState;
    const abbr = this.state.stateAbbr;
    btn.innerHTML = this.state.isClippedToState
      ? `<i class="fas fa-map"></i> ${abbr} On`
      : `<i class="fas fa-map"></i> ${abbr} Off`;
    btn.classList.toggle("active", this.state.isClippedToState);

    if (this.currentGeoJsonLayer) {
      if (this.state.isClippedToState) {
        try {
          this._precomputeStateMask(this.currentGeoJsonLayer);
        } catch (maskErr) {
          console.warn("State mask unavailable, rendering without clipping:", maskErr);
        }
      }
      if (this.currentValueData) {
        this.applyValuesToGrid(this.currentGeoJsonLayer, this.currentValueData);
      }
    }
  }

  startAnimation() {
    if (this.state.intervalId) {
      clearInterval(this.state.intervalId);
    }
    this.state.intervalId = setInterval(() => this._advanceToNextPlayable(), PLAYBACK_INTERVAL_MS);
  }

  stopAnimation() {
    clearInterval(this.state.intervalId);
    this.state.intervalId = null;
    this.state.isPlaying = false;
    this.ui.playPauseBtn.innerHTML = '<i class="fas fa-play"></i> Play';
  }

  /** The synthetic input event is what drives the label, preview and data load. */
  _advanceToNextPlayable() {
    const next = this.nextPlayableIndex(parseInt(this.ui.slider.value, 10) + 1);
    this.ui.slider.value = String(next);
    this.ui.slider.dispatchEvent(new Event("input"));
  }

  switchVariable(variableType) {
    this.state.type = variableType;
    if (this.ui.variableSelect) this.ui.variableSelect.value = variableType;

    if (this.ui.windCanvas) {
      const ctx = this.ui.windCanvas.getContext("2d");
      ctx.clearRect(0, 0, this.ui.windCanvas.width, this.ui.windCanvas.height);
    }

    this.ui.heightSelector?.classList.toggle("active", variableType === "eolico");
    this.configureAccumulationSelector(variableType);

    this.updateWindLayerToggleVisibility(variableType);
    this.refreshVariableOverviewPreview(variableType);

    // The legend describes the selected variable, not the last painted field.
    this.updateColorbar(this.getVariableConfig(variableType), null);
    this._snapIndexToAvailable(variableType);
    this.updateDateTime();

    const selectedCell = this.state.selectedCell;

    this._removeSelectedMarker();

    this._applyMapChangesReselecting(selectedCell);
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

  /**
   * Re-applies the current view, then re-clicks `cell` so sidebar and marker track
   * the selection across slider, variable, hub-height and domain changes. A failed
   * re-click closes the sidebar.
   */
  _applyMapChangesReselecting(cell) {
    return this.applyMapChanges().then(() => {
      if (!cell || !this.state.selectedCell) return;
      this.handleMapClick({ latlng: L.latLng(cell.lat, cell.lng) }).catch(() => this.closeSidebar());
    });
  }

  /**
   * Identifies a (run, domain, variable, window, timestep) view. Including the run
   * version is what makes an in-flight response from BEFORE a detected run switch
   * fail the staleness guards instead of repainting old-run data.
   */
  _loadKey(index = this.state.index, type = this.state.type, domain = this.state.domain) {
    const hours = this.getAccumulationOption(type)?.hours;
    const windowSuffix = hours > 1 ? `@${hours}h` : "";
    return `${this.dataVersion || "v0"}:${domain}:${this.getVariableId(type)}${windowSuffix}:${index}`;
  }

  /**
   * Drops value data and painted layer together, so the map never shows a previous
   * timestep or variable under an advanced time label.
   */
  _clearCurrentData() {
    this.currentValueData = null;
    this._currentValueKey = null;
    this.removeCurrentLayer();
    this.clearWindVectors();
  }

  applyMapChanges() {
    if (!this.isIndexAvailable(this.state.index)) {
      this._clearCurrentData();
      this._removeSelectedMarker();
      this.updateDateTime();
      // The legend survives the wipe; left alone it announces the previous variable.
      this.updateColorbar(this.getVariableConfig(), null);
      this._currentApply = null;
      this._setTimeLabelBusy(false);
      return Promise.resolve(null);
    }

    const promise = this.loadValueData(this.state.index, this.state.type);
    this._currentApply = { key: this._loadKey(), promise };
    this._setTimeLabelBusy(true);
    promise.finally(() => {
      // A superseded load does not speak for the label: a newer one is still pending.
      if (this._currentApply?.promise === promise) this._setTimeLabelBusy(false);
    });
    return promise;
  }

  /**
   * Values payload for a view, honoring the variable's accumulation window. Longer
   * windows are summed here because the pipeline only writes per-timestep totals.
   */
  _fetchValues(domain, type, index) {
    const variableId = this.getVariableId(type);
    const steps = this.getAccumulationOption(type)?.hours || 1;
    const latest = this._cachedFetch(this.dataUrl(this.valuesJsonPath(domain, variableId, index)));
    if (steps <= 1) return latest;

    const older = [];
    for (let back = 1; back < steps; back++) {
      const previousIndex = index - back;
      if (previousIndex < this.timeline.indexMin) break;
      // Best-effort: a missing earlier step shortens the window instead of blanking the map.
      older.push(
        this._cachedFetch(this.dataUrl(this.valuesJsonPath(domain, variableId, previousIndex))).catch(() => null)
      );
    }

    return Promise.all([latest, ...older]).then((payloads) => this._sumValuePayloads(payloads));
  }

  /**
   * Element-wise sum of per-timestep payloads, newest first: it owns the metadata and
   * is the only mandatory member. Re-quantized to the pipeline's 2 decimals so the
   * palette memoization keeps hitting; always a copy, since `latest` is the cached
   * object shared with the 1h window. `accumulatedSteps` reports the steps really
   * summed — early in the run the window silently shortens.
   */
  _sumValuePayloads([latest, ...older]) {
    if (!Array.isArray(latest?.values)) return latest;

    const values = latest.values.slice();
    let accumulatedSteps = 1;
    older.forEach((payload) => {
      const previous = payload?.values;
      if (!Array.isArray(previous) || previous.length !== values.length) return;
      accumulatedSteps++;
      for (let i = 0; i < values.length; i++) {
        if (previous[i] === null || previous[i] === undefined) continue;
        // A null cell in the newest step stays null: inheriting the earlier value would
        // show a number indistinguishable from real data under this step's date.
        if (values[i] === null || values[i] === undefined) continue;
        values[i] += previous[i];
      }
    });

    for (let i = 0; i < values.length; i++) {
      if (values[i] !== null && values[i] !== undefined) values[i] = Math.round(values[i] * 100) / 100;
    }

    return { ...latest, values, accumulatedSteps };
  }

  loadValueData(index, type) {
    const domain = this.state.domain;

    const loadKey = this._loadKey(index, type, domain);

    return Promise.all([this._fetchValues(domain, type, index), this.loadGridLayer(domain)])
      .then(([valueData, gridLayer]) => {
        // A rapid variable/domain/timestep switch starts a newer load; dropping a
        // superseded resolution keeps stale data off the new scale and colorbar.
        if (loadKey !== this._currentApply?.key) {
          return null;
        }

        // Grid fetch failed while values succeeded: still a no-data state.
        if (!gridLayer) {
          this._clearCurrentData();
          return null;
        }

        // The mask ray cast is expensive and its output unused while the clip is off.
        if (this.state.isClippedToState) {
          try {
            this._precomputeStateMask(gridLayer);
          } catch (maskErr) {
            console.warn("State mask unavailable, rendering without clipping:", maskErr);
          }
        }

        this.currentValueData = valueData;
        this._currentValueKey = loadKey;
        this._emptyFrameStreak = 0;
        this.applyValuesToGrid(gridLayer, valueData);

        this.showGeoJsonLayer(gridLayer);
        this.updateUIFromMetadata(valueData.metadata, index);

        if (this.ui.windCheckbox && this.ui.windCheckbox.checked) {
          setTimeout(() => this.renderWindVectors(), 100);
        }

        this._prefetchUpcoming(index, type);

        return valueData;
      })
      .catch((err) => {
        console.error("Error loading data:", err);
        // Honest no-data state, but only while this load is still the current view:
        // a superseded rejection must not wipe the freshly painted newer one.
        if (loadKey === this._currentApply?.key) {
          this._clearCurrentData();
          this._maybeFastSkipEmptyFrame(err);
        }
        return null;
      });
  }

  /**
   * Degraded-mode playback. Without a v2 manifest or a timeline anchor, unavailable
   * indices can only be discovered by fetching, so hop to the next one instead of
   * spending a full playback tick per blank frame; the streak cap stops the hopping
   * when there is no data at all.
   */
  _maybeFastSkipEmptyFrame(err) {
    if (!this.state.isPlaying || err?.notFound !== true) return;
    this._emptyFrameStreak = (this._emptyFrameStreak || 0) + 1;
    if (this._emptyFrameStreak > this.state.maxLayer) return;
    setTimeout(() => {
      if (!this.state.isPlaying) return;
      this._advanceToNextPlayable();
    }, 50);
  }

  /**
   * Warms the shared cache with the next timesteps (fire-and-forget) so the next frame
   * paints from memory instead of paying fetch + parse inside the 800 ms tick budget.
   * Duplicate calls are free (in-flight dedup, negative cache); skipped under saveData.
   */
  _prefetchUpcoming(index, type, count = PREFETCH_AHEAD_STEPS) {
    if (navigator.connection?.saveData) return;
    const config = VARIABLES_CONFIG[type];
    if (!config) return;
    const domain = this.state.domain;
    const variableId = this.getVariableId(type);
    // The 'wind' overlay draws from standalone WIND_VECTORS files (eolico embeds its
    // vectors in the values JSON), so the arrows need warming too.
    const prefetchWind = type === "wind" && this.ui.windCheckbox?.checked;

    const warm = (path) =>
      this.dataService.fetchJson(this.dataUrl(path)).catch(() => {
        /* prefetch is best-effort; the real load reports errors */
      });

    let next = index;
    for (let i = 0; i < count; i++) {
      next = this.nextPlayableIndex(next + 1, type);
      warm(this.valuesJsonPath(domain, variableId, next));
      if (prefetchWind) {
        warm(this.valuesJsonPath(domain, "WIND_VECTORS", next));
      }
    }
  }

  updateDomainIndicator() {
    const domain = this.state.domain;
    const domainButtons = this.ui.domainButtons || [];

    domainButtons.forEach((btn) => {
      const label = this.getDomainLabel(btn.dataset.domain);
      const isActive = btn.dataset.domain === domain;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
      btn.textContent = label;
      btn.title = `Domínio ${label}`;
      btn.setAttribute("aria-label", `Domínio ${label}`);
    });
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
        this.updateDomainIndicator();
        this.refreshVariableOverviewPreview();

        // A click invalidates the framing the previous one asked for; both branches
        // below end in an async flyTo, so they share a token.
        const switchGen = (this._domainSwitchGen = (this._domainSwitchGen || 0) + 1);

        if (this.state.selectedCell) {
          const selectedLat = this.state.selectedCell.lat;
          const selectedLng = this.state.selectedCell.lng;

          this.map.flyTo([selectedLat, selectedLng], targetZoom, {
            duration: 1.5,
            easeLinearity: 0.25,
          });

          // Generation token so only the LATEST handler acts: rapid switches during a
          // 1.5s flyTo would stack one-shot moveend handlers. Do NOT call
          // map.off("moveend") with no function — that also removes Leaflet's own
          // tile-layer and canvas-renderer handlers, breaking tiles and grid repaint.
          this.map.once("moveend", () => {
            if (switchGen !== this._domainSwitchGen) return;
            this.applyMapChanges().then(() => {
              if (switchGen !== this._domainSwitchGen) return;
              const target = L.latLng(selectedLat, selectedLng);
              const gridBounds = this.currentGeoJsonLayer?.getBounds?.();
              // The domains are nested over very different areas: a cell picked at the
              // edge of BA/NE does not exist in the Salvador grid, so fall back to its center.
              if (!gridBounds || !gridBounds.contains(target)) {
                this.closeSidebar();
                this.showErrorMessage(
                  `A célula selecionada está fora do domínio ${this.getDomainLabel(selectedDomain)}`
                );
                this.map.flyTo(config.center, targetZoom, {
                  duration: 1.5,
                  easeLinearity: 0.25,
                });
                return;
              }
              // Don't resurrect a selection cleared during the 1.5s flyTo.
              if (!this.state.selectedCell) return;
              this.handleMapClick({ latlng: target }).catch(() => this.closeSidebar());
            });
          });
        } else {
          this.applyMapChanges().then(() => {
            // The domains share a center and differ only in zoom: a load resolving late
            // would frame the abandoned domain under the newer one's grid and legend.
            if (switchGen !== this._domainSwitchGen) return;
            this.map.flyTo(config.center, targetZoom, {
              duration: 1.5,
              easeLinearity: 0.25,
            });
          });
        }
      });
    });
  }

  /**
   * Rebuilds the legacy FeatureCollection from a compact grid payload so everything
   * downstream — layer construction, linear_index mapping, bounds-based
   * hover/click/mask — stays identical to the legacy path. Throws on malformed
   * payloads so the caller can fall back to the .geojson file.
   */
  _featureCollectionFromCompactGrid(compact) {
    const shape = Array.isArray(compact?.shape) ? compact.shape : [];
    const nRows = shape[0];
    const nCols = shape[1];
    if (!Number.isInteger(nRows) || !Number.isInteger(nCols) || nRows < 1 || nCols < 1) {
      throw new Error("Malformed compact grid payload: bad shape");
    }

    // Same ring vertex order as the legacy writer, closed. Leaflet normalizes bounds,
    // so the grid's latitude orientation does not matter.
    const cellFeature = (left, bottom, right, top, linearIndex) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [left, bottom],
            [right, bottom],
            [right, top],
            [left, top],
            [left, bottom],
          ],
        ],
      },
      properties: { linear_index: linearIndex },
    });

    const features = new Array(nRows * nCols);
    if (compact.format === "grid-edges-v1") {
      const lonEdges = compact.lon_edges;
      const latEdges = compact.lat_edges;
      if (
        !Array.isArray(lonEdges) ||
        !Array.isArray(latEdges) ||
        lonEdges.length !== nCols + 1 ||
        latEdges.length !== nRows + 1
      ) {
        throw new Error("Malformed grid-edges-v1 payload: edge lengths");
      }
      for (let i = 0; i < nRows; i++) {
        for (let j = 0; j < nCols; j++) {
          const k = i * nCols + j;
          features[k] = cellFeature(lonEdges[j], latEdges[i + 1], lonEdges[j + 1], latEdges[i], k);
        }
      }
    } else if (compact.format === "grid-bounds-v1") {
      const bounds = compact.bounds;
      if (!Array.isArray(bounds) || bounds.length !== nRows * nCols) {
        throw new Error("Malformed grid-bounds-v1 payload: bounds length");
      }
      for (let k = 0; k < bounds.length; k++) {
        const cell = bounds[k];
        features[k] = cellFeature(cell[0], cell[1], cell[2], cell[3], k);
      }
    } else {
      throw new Error(`Unknown compact grid format: ${compact?.format}`);
    }

    return { type: "FeatureCollection", metadata: compact.metadata, features };
  }

  loadGridLayer(domain) {
    const cacheKey = domain;

    if (this.gridLayers[cacheKey]) {
      return Promise.resolve(this.gridLayers[cacheKey]);
    }

    if (this._gridLayerPromises.has(cacheKey)) {
      return this._gridLayerPromises.get(cacheKey);
    }

    // Bumped by handleManifestUpdate: an old-run fetch must not repopulate the cache.
    const generation = this._gridGeneration || 0;

    // Compact grid first (a few KB vs 1.2-2.6MB); the legacy GeoJSON is the fallback
    // for servers still holding data from an older pipeline run.
    const gridPromise = this.dataService
      .fetchJson(this.dataUrl(this.gridJsonPath(domain)))
      .then((compact) => this._featureCollectionFromCompactGrid(compact))
      .catch((compactErr) => {
        if (compactErr?.notFound !== true) {
          console.warn(`Compact grid unavailable for ${domain}, using legacy GeoJSON:`, compactErr);
        }
        return this.dataService.fetchJson(this.dataUrl(this.gridGeoJsonPath(domain)));
      })
      .then((geojson) => {
        const gridMetadata = geojson.metadata;
        const layer = L.geoJSON(geojson, {
          renderer: this._canvasRenderer,
          style: GRID_NODATA_STYLE,
          onEachFeature: (feature) => {
            feature.properties.valor = null;
          },
        });

        // Delegated on the group: per-cell handlers mean two closures per ~10k cells.
        layer.on("mouseover", (e) => {
          const cell = e.propagatedFrom;
          if (!cell || this._isCellHidden(cell)) return;
          cell.setStyle({
            weight: 1.2,
            color: "#666",
            fillOpacity: 0.65,
          });
        });
        layer.on("mouseout", (e) => {
          const cell = e.propagatedFrom;
          if (!cell) return;
          // Restore from the cell's current state: one hidden by the clip or by the
          // display threshold must return to GRID_HIDDEN_STYLE, not to a painted style.
          cell.setStyle(
            this._isCellHidden(cell)
              ? GRID_HIDDEN_STYLE
              : {
                  ...GRID_VISIBLE_STYLE,
                  fillColor: cell.options.fillColor,
                }
          );
        });

        const layersByLinearIndex = new Map();
        layer.getLayers().forEach((cellLayer, index) => {
          const properties = cellLayer.feature?.properties || {};
          properties.index = Number.isInteger(properties.linear_index) ? properties.linear_index : index;
          layersByLinearIndex.set(properties.index, cellLayer);
        });

        layer._gridMetadata = gridMetadata;
        layer._layersByLinearIndex = layersByLinearIndex;
        if (generation === (this._gridGeneration || 0)) {
          this.gridLayers[cacheKey] = layer;
        }
        return layer;
      })
      .catch((err) => {
        console.error("Error loading grid:", err);
        return null;
      })
      .finally(() => {
        this._gridLayerPromises.delete(cacheKey);
      });

    this._gridLayerPromises.set(cacheKey, gridPromise);
    return gridPromise;
  }

  applyValuesToGrid(gridLayer, valueData) {
    const values = valueData.values;
    const layers = gridLayer.getLayers();
    const config = this.getVariableConfig();
    const scaleValues = this.getScaleValues(config, valueData);
    const hideBelow = Number.isFinite(config.hideBelow) ? config.hideBelow : -Infinity;

    if (this._colorWorker) {
      const requestId = ++this._colorRequestId;
      this._pendingColorRequest = { layers, values, scaleValues, config };
      this._colorWorker.onmessage = (e) => {
        const { requestId: responseId, colors } = e.data;
        if (responseId !== undefined && responseId !== this._colorRequestId) return;
        this._pendingColorRequest = null;
        this._scheduleGridPaint(layers, values, colors);
      };
      this._colorWorker.postMessage({
        requestId,
        values,
        scaleValues,
        colors: config.colors,
        hideBelow,
      });
    } else {
      this._applyColorsOnMainThread(layers, values, scaleValues, config);
    }
  }

  _applyColorsOnMainThread(layers, values, scaleValues, config) {
    const colors = new Array(values.length);
    const hideBelow = Number.isFinite(config.hideBelow) ? config.hideBelow : -Infinity;
    // Values are quantized to 2 decimals, so thousands of cells share few distinct
    // ones; per call only (palette/scale can change), and `has` since null is valid.
    const memo = new Map();
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value !== undefined && value !== null) {
        if (!memo.has(value)) {
          memo.set(value, value < hideBelow ? null : this._colorFromScale(value, scaleValues, config));
        }
        colors[i] = memo.get(value);
      }
    }

    this._scheduleGridPaint(layers, values, colors);
  }

  _scheduleGridPaint(layers, values, colors) {
    cancelAnimationFrame(this._applyGridRaf);
    this._applyGridRaf = requestAnimationFrame(() => {
      this.applyComputedColorsToGrid(layers, values, colors);
    });
  }

  applyComputedColorsToGrid(layers, values, colors) {
    const isClipped = this.state.isClippedToState;
    // Scratch style reused across cells: setStyle copies the properties into each
    // layer's options, so this avoids ~10k short-lived allocations per repaint.
    const visibleStyle = { ...GRID_VISIBLE_STYLE, fillColor: undefined };

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const cellIndex = this.getCellIndexForLayer(layer, i);
      const color = colors[cellIndex];
      const inState = layer._inStateMask !== false;
      const hiddenByClip = isClipped && !inState;

      if (color === undefined) {
        // No data at this step: clear the previous one's value instead of leaving it.
        layer.feature.properties.valor = null;
        layer._hiddenByValue = false;
        this._setGridCellStyle(layer, hiddenByClip ? GRID_HIDDEN_STYLE : GRID_NODATA_STYLE);
        continue;
      }

      layer.feature.properties.valor = values[cellIndex];

      // `null` (never `undefined`) marks a value under `hideBelow`: there IS data, it
      // just must not be painted. The flag keeps hover from revealing the cell.
      layer._hiddenByValue = color === null;

      if (hiddenByClip || color === null) {
        this._setGridCellStyle(layer, GRID_HIDDEN_STYLE);
      } else {
        visibleStyle.fillColor = color;
        this._setGridCellStyle(layer, visibleStyle);
      }
    }
  }

  /**
   * setStyle only when the target differs on some property it would actually change
   * (setStyle merges, so untouched options are irrelevant). A hovered cell never
   * matches its resting style, so repaints restore it exactly as before.
   */
  _setGridCellStyle(layer, style) {
    const options = layer.options;
    for (const key in style) {
      if (options[key] !== style[key]) {
        layer.setStyle(style);
        return;
      }
    }
  }

  /**
   * Hidden means fully transparent: clipped outside the state boundary, or below the
   * variable's display threshold. Hover must neither reveal nor repaint such a cell.
   */
  _isCellHidden(cell) {
    if (cell._hiddenByValue === true) return true;
    return this.state.isClippedToState && cell._inStateMask === false;
  }

  getCellIndexForLayer(layer, fallbackIndex) {
    const properties = layer?.feature?.properties || {};
    return Number.isInteger(properties.index) ? properties.index : fallbackIndex;
  }

  _colorFromScale(value, scaleValues, config) {
    if (!scaleValues?.length) return config.colors[0];
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

  getScaleValues(config, valueData = this.currentValueData) {
    if (Array.isArray(config.scaleTicks) && config.scaleTicks.length >= 2) {
      return config.scaleTicks;
    }

    if (Number.isFinite(config.scaleMin) && Number.isFinite(config.scaleMax) && config.scaleMin < config.scaleMax) {
      const tickCount = Number.isInteger(config.scaleTickCount) ? config.scaleTickCount : 10;
      const values = [];
      for (let i = 0; i < tickCount; i++) {
        values.push(config.scaleMin + (config.scaleMax - config.scaleMin) * (i / (tickCount - 1)));
      }
      return values;
    }

    return valueData?.metadata?.scale_values || [];
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
    // Playback repaints the SAME cached per-domain layer every tick: a full teardown
    // and re-add of ~10k vector paths would be paid per frame for no visual change.
    if (this.currentGeoJsonLayer === newLayer && this.map.hasLayer(newLayer)) {
      return;
    }
    if (this.currentGeoJsonLayer) {
      this.map.removeLayer(this.currentGeoJsonLayer);
    }
    newLayer.addTo(this.map);
    this.currentGeoJsonLayer = newLayer;

    if (this.state.selectedCell) {
      this._removeSelectedMarker();
      this.selectedMarker = this.createPingMarker(this.state.selectedCell.lat, this.state.selectedCell.lng);
    }
  }

  removeCurrentLayer() {
    if (this.currentGeoJsonLayer) {
      this.map.removeLayer(this.currentGeoJsonLayer);
      this.currentGeoJsonLayer = null;
    }
  }

  updateUIFromMetadata(metadata, loadedIndex = this.state.index) {
    const config = this.getVariableConfig();

    if (!this.state.initialDateTime && metadata?.date_time) {
      this.state.initialDateTime = this.parseDateTime(metadata.date_time);
      // Anchor to the index whose metadata we loaded, not what the slider reads now.
      this.state.initialIndex = loadedIndex;
    }

    this.updateColorbar(config);
    this.updateDateTime();
  }

  parseDateTime(dateStr) {
    const parts = dateStr.split(" ");
    let day, month, year;
    if (parts[0].includes("/")) {
      const dateParts = parts[0].split("/");
      day = parseInt(dateParts[0], 10);
      month = parseInt(dateParts[1], 10);
      year = parseInt(dateParts[2], 10);
    } else {
      const dateParts = parts[0].split("-");
      year = parseInt(dateParts[0], 10);
      month = parseInt(dateParts[1], 10);
      day = parseInt(dateParts[2], 10);
    }
    const timeParts = parts[1].split(":");
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = timeParts[2] ? parseInt(timeParts[2], 10) : 0;

    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  /**
   * Callers that run BEFORE a payload exists pass `valueData: null`, so a variable
   * whose scale comes from the file metadata shows no ticks at all instead of
   * borrowing the previous variable's.
   */
  updateColorbar(config, valueData = this.currentValueData) {
    const scaleValues = this.getScaleValues(config, valueData);
    // Rebuilding the gradient + label DOM every playback tick forces style and layout
    // for identical output; the signature covers the metadata-driven scale too.
    const signature = `${config.unit}|${config.colors.join(",")}|${scaleValues.join(",")}`;
    if (signature === this._colorbarSignature) return;
    this._colorbarSignature = signature;

    const gradient = `linear-gradient(to top, ${config.colors.join(", ")})`;
    this.ui.colorbarGradient.style.background = gradient;
    this.ui.colorbarUnit.textContent = config.unit;
    // Dimensionless variables (kt, sky emissivity) declare no unit: the element carries
    // a top border and padding, so leaving it empty hangs a stray rule under the scale.
    this.ui.colorbarUnit.hidden = !config.unit;

    const labelsContainer = this.ui.colorbarLabels;
    labelsContainer.innerHTML = "";

    const decimals = this.colorbarDecimals(scaleValues);
    for (let i = scaleValues.length - 1; i >= 0; i--) {
      const label = document.createElement("div");
      label.className = "colorbar-label";
      label.textContent = this.formatColorbarValue(scaleValues[i], decimals);
      labelsContainer.appendChild(label);
    }
  }

  /**
   * Fewest decimals that keep the ticks distinct AND the largest at two significant
   * digits. One count for the whole scale, so a 0.6-1 range never shows "1" next to
   * "0.956"; the significant-digit rule keeps 0-0.85 from collapsing its top tick.
   */
  colorbarDecimals(scaleValues) {
    const largest = Math.max(...scaleValues.map((value) => Math.abs(value)));
    if (!Number.isFinite(largest)) return 0;

    for (let decimals = 0; decimals <= 3; decimals++) {
      const labels = scaleValues.map((value) => value.toFixed(decimals));
      const distinct = new Set(labels).size === labels.length;
      if (distinct && Math.round(largest * 10 ** decimals) >= 10) return decimals;
    }
    return 3;
  }

  formatColorbarValue(value, decimals = 0) {
    if (!Number.isFinite(value)) return "";
    return value.toFixed(decimals);
  }

  async handleMapClick(e, options = {}) {
    // The user may have clicked mid-drag: wait for the matching in-flight load so the
    // sidebar reflects the selected view. Bounded; a residual mismatch reads no-data.
    for (let attempt = 0; attempt < 3; attempt++) {
      const wantKey = this._loadKey();
      if (this._currentValueKey === wantKey) break;
      if (this._currentApply?.key !== wantKey) break;
      try {
        await this._currentApply.promise;
      } catch {
        break;
      }
    }

    if (!this.currentGeoJsonLayer) {
      return Promise.reject(new Error("No GeoJSON layer available"));
    }

    // Only trust currentValueData when it matches the current view.
    const values =
      this._currentValueKey === this._loadKey() && Array.isArray(this.currentValueData?.values)
        ? this.currentValueData.values
        : null;

    let foundCell = null;
    const cellLayers = this.currentGeoJsonLayer.getLayers();
    for (let i = 0; i < cellLayers.length; i++) {
      const layer = cellLayers[i];
      if (layer.getBounds().contains(e.latlng)) {
        const cellIndex = this.getCellIndexForLayer(layer, 0);
        foundCell = {
          layer,
          value: values ? (values[cellIndex] ?? null) : null,
          cellIndex,
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          allValues: {},
        };
        break;
      }
    }

    if (!foundCell || foundCell.value === null) {
      this.showErrorMessage("Sem informações neste local");
      return Promise.reject(new Error("No cell data found at this location"));
    }

    this._removeSelectedMarker();
    this.selectedMarker = this.createPingMarker(e.latlng.lat, e.latlng.lng);

    return this.loadAllVariableValuesForCell(foundCell)
      .then((allValues) => {
        // A programmatic refresh must not resurrect a selection the user cleared.
        if (!options.userInitiated && !this.state.selectedCell) {
          this._removeSelectedMarker();
          return null;
        }
        foundCell.allValues = allValues;
        this.state.selectedCell = foundCell;
        this.showSidebar({ userInitiated: options.userInitiated === true });
        return foundCell;
      })
      .catch((err) => {
        console.error("Error loading values:", err);
        this.showErrorMessage("Erro ao carregar informações");
        this._removeSelectedMarker();
        throw err;
      });
  }

  createPingMarker(lat, lng) {
    const iconSize = 32;

    const pingIcon = L.divIcon({
      className: "ping-pin",
      html: `
                <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24">
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

  _removeSelectedMarker() {
    if (this.selectedMarker) {
      this.map.removeLayer(this.selectedMarker);
      this.selectedMarker = null;
    }
  }

  loadValueDataOnly(index, type) {
    const domain = this.state.domain;

    if (!domain) {
      return Promise.resolve(null);
    }

    const variableId = this.getVariableId(type);
    const filePath = this.dataUrl(this.valuesJsonPath(domain, variableId, index));

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

  /**
   * `options.userInitiated` separates a real map click from programmatic refreshes —
   * read by the showSidebar wrapper in map-init.js to decide whether the time-series
   * modal may open.
   */
  showSidebar() {
    const cell = this.state.selectedCell;
    const config = this.getVariableConfig();
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
      html += `<div class="info-section variable-specific">${this._specificInfoHtml(specificInfo)}</div>`;
    }

    content.innerHTML = html;
    sidebar.classList.add("active");

    this.setupParametersEditorListeners(this.state.type);
  }

  closeSidebar() {
    this.ui.sidebar?.classList.remove("active");
    this._removeSelectedMarker();
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
      // Invalidate any in-flight WIND_VECTORS fetch: a late response for the same
      // domain:index must not paint its 10m arrows over these hub-height ones.
      this._windRequestKey = null;
      this._renderWindFromData(this.currentValueData.metadata.wind);
    } else {
      const domain = this.state.domain;
      const filePath = this.dataUrl(this.valuesJsonPath(domain, "WIND_VECTORS", this.state.index));
      const requestKey = `${this.dataVersion || "v0"}:${domain}:${this.state.index}`;
      this._windRequestKey = requestKey;

      this._cachedFetch(filePath)
        .then((windData) => {
          if (this._windRequestKey !== requestKey || !this.ui.windCheckbox?.checked) return;
          this._renderWindFromData(windData);
        })
        .catch((err) => {
          console.warn("Wind vectors not available:", err.message);
          if (this._windRequestKey === requestKey) {
            this.clearWindVectors();
          }
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
      this.clearWindVectors();
      return;
    }

    // Same size guard as windCanvasUpdateHandler; the clearRect below hands over a clean frame.
    const size = this.map.getSize();
    if (canvas.width !== size.x || canvas.height !== size.y) {
      canvas.width = size.x;
      canvas.height = size.y;
    }
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
    // Feature order in the GeoJSON is not guaranteed to match linear_index, so a
    // positional lookup could misplace arrows.
    const layersByLinearIndex = this.currentGeoJsonLayer._layersByLinearIndex;

    linearIndices.forEach((linearIndex, idx) => {
      try {
        const targetLayer = layersByLinearIndex ? layersByLinearIndex.get(linearIndex) : layers[linearIndex];
        if (!targetLayer || !targetLayer.getBounds) {
          return;
        }

        if (isClipped && targetLayer._inStateMask === false) return;

        const bounds = targetLayer.getBounds();
        const center = bounds.getCenter();
        const point = this.map.latLngToContainerPoint(center);

        const angle = angles[idx];
        const magnitude = magnitudes[idx];

        if (point.x >= 0 && point.x <= canvas.width && point.y >= 0 && point.y <= canvas.height) {
          this.drawWindArrow(ctx, point.x, point.y, angle, magnitude, minMag, magRange);
        }
      } catch {
        return;
      }
    });
  }

  drawWindArrow(ctx, x, y, angle, magnitude, minMag, magRange) {
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
    // The only answer to a click that found no data, and gone in 3.3s. The text is set
    // before insertion so assistive tech announces an already complete message.
    alertDiv.setAttribute("role", "alert");
    alertDiv.textContent = message;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.classList.add("is-exiting");
      setTimeout(() => alertDiv.remove(), 300);
    }, 3000);
  }
}

window.MeteoMapManager = MeteoMapManager;
