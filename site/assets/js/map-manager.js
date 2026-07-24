/**
 * MAP UTILITY FUNCTIONS
 */

const PLAYBACK_INTERVAL_MS = 800;
const PREFETCH_AHEAD_STEPS = 2;

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
  // Sem hash (HTML sem build): URL sem ?v= — um token fixo seria congelado
  // como immutable pela regra do .htaccess e prenderia um worker antigo.
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

/**
 * Ray-casting point-in-polygon for GeoJSON Polygon/MultiPolygon features.
 * Replaces the former runtime dependency on the full turf.js bundle, which
 * was only used for the state-boundary mask.
 */
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
    // Pipeline run version from the configured manifest (adopted via applyManifest
    // once map-init resolves the manifest): appended as ?v= to every data URL
    // so the server can cache the fixed-name data files long-term. Null (no
    // manifest) keeps plain URLs.
    this.dataVersion = null;
    this.map = null;
    this.currentGeoJsonLayer = null;
    this.currentValueData = null;
    // Identifies which (domain, variable, timestep) currentValueData holds, so
    // a click can tell whether the loaded data matches the current view or is
    // still catching up after a rapid slider/variable/domain change.
    this._currentValueKey = null;
    // The in-flight applyMapChanges() load, tagged with the view it targets.
    this._currentApply = null;
    this.gridLayers = {};
    this._gridLayerPromises = new Map();
    this.dataService = new LabmimDataService({
      workerUrl: workerScriptUrl("json-parser.worker.js"),
    });

    // Timeline contract from a v2 manifest (applyManifest). Until one
    // arrives, the selected dataset supplies the static build defaults.
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
    this.loadStateGeoJson(MAP_SITE_CONFIG.stateCode);
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
   * The variables the sidebar actually consumes for the current selection:
   * the active variable plus the companions its specificInfo reads
   * (declared per-variable as `relatedVariables` in VARIABLES_CONFIG).
   * Fetching every visible variable here made each map click download ~10
   * full-domain files to display at most three numbers.
   */
  getRelatedVariableTypes() {
    const variables = new Set([this.state.type]);
    (VARIABLES_CONFIG[this.state.type]?.relatedVariables || []).forEach((variableType) => {
      if (VARIABLES_CONFIG[variableType]) variables.add(variableType);
    });
    return [...variables];
  }

  /**
   * Fetch JSON through the shared data service (cache, in-flight dedup,
   * negative cache and worker parsing with main-thread fallback).
   * Kept as a method because ChartsManager consumes it via app._cachedFetch.
   */
  _cachedFetch(url, options = {}) {
    return this.dataService.fetchJson(url, options);
  }

  /**
   * Appends the pipeline run version (from the configured manifest) to a data
   * URL. A new run publishes a new version, so versioned URLs may be cached
   * aggressively by the browser without ever pinning stale forecasts; when
   * no manifest exists the plain URL keeps today's revalidation behavior.
   */
  dataUrl(path) {
    return this.dataVersion ? `${path}?v=${encodeURIComponent(this.dataVersion)}` : path;
  }

  /** Single source of the per-timestep value JSON path convention. */
  valuesJsonPath(domain, variableId, index) {
    return `${DATA_SITE_CONFIG.valuesBase}/${domain}_${variableId}_${String(index).padStart(3, "0")}.json`;
  }

  /** Compact and legacy grid paths supplied by the selected dataset. */
  gridJsonPath(domain) {
    return `${DATA_SITE_CONFIG.gridsBase}/${domain}.grid.json`;
  }

  gridGeoJsonPath(domain) {
    return `${DATA_SITE_CONFIG.gridsBase}/${domain}.geojson`;
  }

  /**
   * Adopts a pipeline manifest: run version for ?v= URLs and, when the v2
   * fields are present, the timeline contract — step range, per-variable
   * availability and consolidated-artifact descriptors — replacing the
   * hardcoded defaults that would otherwise have to be edited in lockstep
   * with every pipeline change (longer runs, new gated variables).
   */
  applyManifest(manifest) {
    if (typeof manifest?.version === "string" && manifest.version) {
      this.dataVersion = manifest.version;
    }

    if (Number.isInteger(manifest?.index_max) && manifest.index_max >= 1) {
      this.timeline.indexMax = manifest.index_max;
      this.timeline.indexMin = Number.isInteger(manifest.index_min) ? Math.max(1, manifest.index_min) : 1;
      // One playback loop (values + wind overlay) plus an open modal must
      // stay resident; scale with the timeline instead of thrashing at 121+.
      this.dataService.ensureCacheLimit(Math.ceil(manifest.index_max * 5.5));
    } else {
      // A v1 manifest (or a rollback) carries no timeline: the previous
      // run's longer range must not survive it.
      this.timeline.indexMax = null;
      this.timeline.indexMin = 1;
    }
    this.state.maxLayer = this.timeline.indexMax ?? DEFAULT_MAX_LAYER;
    if (this.ui.slider) {
      this.ui.slider.max = String(this.state.maxLayer);
      if (parseInt(this.ui.slider.value, 10) > this.state.maxLayer) {
        this.ui.slider.value = String(this.state.maxLayer);
        this.state.index = this.state.maxLayer;
      }
    }

    this.timeline.availability =
      manifest?.availability && typeof manifest.availability === "object" ? manifest.availability : null;
    this.timeline.features = manifest?.features && typeof manifest.features === "object" ? manifest.features : null;

    // Anchor the date labels to the run start instead of waiting for the
    // first loaded file's metadata. start_local is the local datetime of
    // FILE INDEX 0 (the wrfout's first time step) — always paired with
    // initialIndex 0, never with index_min (which is merely the first index
    // the run wrote; skip-first runs have index_min > 0).
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

    this.updateDateTime();
  }

  /**
   * A manifest re-check found a manifest whose version differs from the one
   * this session runs on. First manifest of the session (slow first fetch):
   * adopt it in place. Genuinely NEW run under the same fixed file names:
   * drop every cache keyed on the old bytes (parsed JSON, chart series,
   * grid layers), close views built from them, re-anchor the timeline and
   * repaint. No-op while the version is unchanged.
   */
  handleManifestUpdate(manifest, chartsManagerInstance = this.chartsManager) {
    if (!manifest?.version) return;
    if (!this.dataVersion) {
      // Session ran unversioned so far — same run, just late; no cache nuke.
      this.applyManifest(manifest);
      this.applyMapChanges();
      return;
    }
    if (manifest.version === this.dataVersion) return;

    this.dataService.clear();
    chartsManagerInstance?.clearCaches?.();
    // The open modal/sidebar describe the previous run's series and cell
    // values; closing beats silently showing yesterday's forecast next to
    // today's map.
    chartsManagerInstance?.closeModal?.();
    this.closeSidebar();
    // Grid geometry can change between runs (re-gridded domain): rebuild
    // layers from the new run's files. The generation token keeps an
    // in-flight old-run grid fetch from repopulating the cache after it.
    this.gridLayers = {};
    this._gridLayerPromises.clear();
    this._gridGeneration = (this._gridGeneration || 0) + 1;

    this.state.initialDateTime = null;
    this.state.initialIndex = null;
    this.applyManifest(manifest);

    // The paused position may not exist in the new run's timeline.
    if (!this.isIndexAvailable(this.state.index)) {
      const next = this.nextPlayableIndex(this.state.index);
      this.state.index = next;
      if (this.ui.slider) this.ui.slider.value = String(next);
    }
    this.applyMapChanges();
    this.scheduleVariablePreviewRefresh();
  }

  /**
   * Whether the pipeline exports this variable at this timestep. Prefers the
   * manifest's availability ranges (derived from the files actually
   * written); the legacy fallback derives SWDOWN's daylight window from the
   * forecast anchor (6h-18h local), and optimistically allows the index when
   * no anchor is known yet — a miss is a handled 404, never a wrong blank.
   */
  isIndexAvailable(index, type = this.state.type) {
    const config = VARIABLES_CONFIG[type];
    if (!config) return true;

    // A v2 manifest bounds the whole timeline (skip-first runs start above
    // index 1); variables absent from `availability` cover that full range.
    if (this.timeline.indexMax !== null && (index < this.timeline.indexMin || index > this.timeline.indexMax)) {
      return false;
    }

    const ranges = this.timeline.availability?.[this.getVariableId(type)];
    if (Array.isArray(ranges)) {
      return ranges.some((range) => index >= range[0] && index <= range[1]);
    }

    if (config.id !== "SWDOWN") return true;
    const date = this.calculateTargetDateFromIndex(index);
    if (!date) return true;
    const hour = date.getUTCHours();
    return hour >= 6 && hour <= 18;
  }

  /**
   * First index with data at or after `from`, wrapping past maxLayer to 1.
   * Returns `from` unchanged when everything up to a full lap is
   * unavailable (the load path then shows the honest no-data state).
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
        // The overview panel summarizes the height-resolved variable
        // (POT_EOLICO_50M/100M/150M) — refresh it, or its chart and stats
        // keep describing the previous hub height under the new map.
        this.scheduleVariablePreviewRefresh();
      }
    }
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

  /** Inner HTML of the variable-specific sidebar section (title, stat cards, parameters editor). */
  _specificInfoHtml(specificInfo) {
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

    return html + this.createParametersEditor(this.state.type);
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
      if (!this.windCanvasUpdateHandler) {
        this.windCanvasUpdateHandler = () => {
          // With the overlay off the canvas is already blank and
          // _renderWindFromData re-sizes it when re-enabled — skip the work.
          // This handler runs on every 'move' event (per frame during pans),
          // and assigning width/height discards the canvas backing store,
          // so only do it when the size actually changed.
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
    }
  }

  setupEventListeners() {
    this.cacheUIElements();
    this.configureVariableSelect();

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

    const selectTab = (tab) => {
      const tabName = tab.getAttribute("data-tab");

      docTabs.forEach((t) => {
        const isSelected = t === tab;
        t.classList.toggle("active", isSelected);
        t.setAttribute("aria-selected", String(isSelected));
        // Roving tabindex do padrão ARIA de abas: só a aba ativa é tab-stop.
        t.setAttribute("tabindex", isSelected ? "0" : "-1");
      });
      docTabContents.forEach((content) => {
        content.classList.toggle("active", content.dataset.tab === tabName);
      });
    };

    docTabs.forEach((tab, i) => {
      tab.addEventListener("click", () => selectTab(tab));
      tab.addEventListener("keydown", (e) => {
        const n = docTabs.length;
        let next = null;
        if (e.key === "ArrowRight") next = docTabs[(i + 1) % n];
        else if (e.key === "ArrowLeft") next = docTabs[(i - 1 + n) % n];
        else if (e.key === "Home") next = docTabs[0];
        else if (e.key === "End") next = docTabs[n - 1];
        if (next) {
          e.preventDefault();
          next.focus();
          selectTab(next);
        }
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && docModal.classList.contains("active")) {
        docModal.classList.remove("active");
      }
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
          <span class="variable-card-chip">${config.unit}</span>
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
    const config = VARIABLES_CONFIG[variableType];
    if (!config) return;

    if (this.ui.variablePreviewTitle) {
      this.ui.variablePreviewTitle.textContent = config.optionLabel || config.label;
    }
    if (this.ui.variablePreviewLabel) {
      this.ui.variablePreviewLabel.textContent = `${config.sourceId || config.id} · ${config.unit}`;
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

  loadStateGeoJson(stateCode) {
    this.state.stateAbbr = stateCode;
    const boundaryAsset =
      stateCode === MAP_SITE_CONFIG.stateCode
        ? MAP_SITE_CONFIG.boundaryAsset
        : `assets/data/br_${stateCode.toLowerCase()}.json`;
    fetch(boundaryAsset)
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

        // The mask is only computed when clipping is active — it costs an
        // O(cells x boundary points) ray cast (hundreds of ms on mobile),
        // so it must never run on the plain startup path.
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
      this.ui.layerLabel.textContent = this.formatForecastDateTimeLabel(targetDate, hasData);
    }
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
    } else {
      // Generic wording: availability gaps are not only night hours (e.g.
      // skip-first spin-up steps a v2 manifest marks unavailable).
      const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
      const monthStr = months[monthIndex];
      return `${day} ${monthStr} ${year} · ${hours}:${minutes} UTC−03:00 — sem dados neste horário`;
    }
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

    if (this.currentGeoJsonLayer) {
      // Lazily computed on first activation (and per domain in
      // loadValueData); a no-op once the layer's mask exists.
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
    // Skip straight to the next timestep the pipeline actually exports
    // (e.g. SWDOWN daylight hours), wrapping at the end of the timeline.
    this.state.intervalId = setInterval(() => this._advanceToNextPlayable(), PLAYBACK_INTERVAL_MS);
  }

  stopAnimation() {
    clearInterval(this.state.intervalId);
    this.state.intervalId = null;
    this.state.isPlaying = false;
    this.ui.playPauseBtn.innerHTML = '<i class="fas fa-play"></i> Play';
  }

  /** Advances the slider to the next available timestep and fires its input pipeline (label, preview, load). */
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

    this.updateWindLayerToggleVisibility(variableType);
    this.refreshVariableOverviewPreview(variableType);

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
   * Re-applies the current view, then re-clicks `cell` ({lat, lng}) so the
   * sidebar and marker track the selection across slider, variable,
   * hub-height and domain changes. No re-click when no cell was given or the
   * selection was cleared while data loaded; a failed re-click closes the
   * sidebar.
   */
  _applyMapChangesReselecting(cell) {
    return this.applyMapChanges().then(() => {
      if (!cell || !this.state.selectedCell) return;
      this.handleMapClick({ latlng: L.latLng(cell.lat, cell.lng) }).catch(() => this.closeSidebar());
    });
  }

  /**
   * Key identifying a (run, domain, variable, timestep) view. The variable
   * part is the resolved data id (getVariableId), so eolico 50/100/150 m are
   * distinct; the run version makes an in-flight response from BEFORE a
   * detected pipeline-run switch fail the staleness guards instead of
   * repainting old-run data over the resynchronized view.
   */
  _loadKey(index = this.state.index, type = this.state.type, domain = this.state.domain) {
    return `${this.dataVersion || "v0"}:${domain}:${this.getVariableId(type)}:${index}`;
  }

  /**
   * Drops the current value data and painted layer together, so the map never
   * shows a previous timestep/variable under an advanced time label. Also
   * clears any wind overlay left from the previous frame.
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
      this._currentApply = null;
      return Promise.resolve(null);
    }

    const promise = this.loadValueData(this.state.index, this.state.type);
    this._currentApply = { key: this._loadKey(), promise };
    return promise;
  }

  loadValueData(index, type) {
    const domain = this.state.domain;

    const variableId = this.getVariableId(type);
    const filePath = this.dataUrl(this.valuesJsonPath(domain, variableId, index));
    const loadKey = this._loadKey(index, type, domain);

    return Promise.all([this._cachedFetch(filePath), this.loadGridLayer(domain)])
      .then(([valueData, gridLayer]) => {
        // Staleness guard: a rapid variable/domain/timestep switch starts a
        // newer load. applyMapChanges tags the latest requested view on
        // this._currentApply.key. If this resolution is no longer the latest,
        // drop it so we never paint stale data under the new scale/colorbar.
        if (loadKey !== this._currentApply?.key) {
          return null;
        }

        // Grid fetch failed while the value fetch succeeded: still a no-data
        // state — clear so a stale frame/value is never shown under the label.
        if (!gridLayer) {
          this._clearCurrentData();
          return null;
        }

        // Only when clipping is active: the mask ray cast is expensive and
        // its output is unused while the clip toggle is off.
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
        // Honest no-data state — but ONLY if this load is still the current
        // view. A superseded (stale) rejection must not wipe the freshly
        // painted newer load. The data service's negative cache keeps
        // playback from re-hitting the network for the same missing file.
        if (loadKey === this._currentApply?.key) {
          this._clearCurrentData();
          this._maybeFastSkipEmptyFrame(err);
        }
        return null;
      });
  }

  /**
   * Degraded-mode playback helper. Without a v2 manifest OR a timeline
   * anchor (old data, first session frames), unavailable indices (e.g.
   * SWDOWN night hours) can only be discovered by fetching — isIndexAvailable
   * optimistically allowed them. Instead of spending a full playback tick
   * per blank frame, hop to the next index right away; the streak cap stops
   * the hopping when there is no data at all (it resets on any successful
   * load, which also establishes the anchor that makes this path moot).
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
   * Warms the shared data-service cache with the next timesteps of the
   * current view (fire-and-forget). During playback and manual stepping the
   * next frame then paints from memory instead of paying fetch + parse
   * inside the 800ms tick budget. Mirrors the animation loop's SWDOWN
   * daylight skip; duplicate calls are free thanks to in-flight dedup and
   * the negative cache. Skipped for users who opted into data saving.
   */
  _prefetchUpcoming(index, type, count = PREFETCH_AHEAD_STEPS) {
    if (navigator.connection?.saveData) return;
    const config = VARIABLES_CONFIG[type];
    if (!config) return;
    const domain = this.state.domain;
    const variableId = this.getVariableId(type);
    // The 'wind' overlay draws from standalone WIND_VECTORS files (eolico
    // embeds its vectors in the values JSON) — warm those too, or the arrows
    // paint one fetch round-trip behind the field they annotate.
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

        if (this.state.selectedCell) {
          const selectedLat = this.state.selectedCell.lat;
          const selectedLng = this.state.selectedCell.lng;

          this.map.flyTo([selectedLat, selectedLng], targetZoom, {
            duration: 1.5,
            easeLinearity: 0.25,
          });

          // Rapid domain switches during a 1.5s flyTo would otherwise stack
          // one-shot moveend handlers, each re-applying an outdated view.
          // Use a generation token so only the LATEST handler acts. Do NOT
          // call map.off("moveend") with no function — that also removes
          // Leaflet's own tile-layer and canvas-renderer moveend handlers,
          // breaking tile loading and grid repaint on pan.
          const moveendGen = (this._domainMoveendGen = (this._domainMoveendGen || 0) + 1);
          this.map.once("moveend", () => {
            if (moveendGen !== this._domainMoveendGen) return;
            // The user may have closed the sidebar / started playback during
            // the 1.5s flyTo; don't resurrect a cleared selection.
            this._applyMapChangesReselecting({ lat: selectedLat, lng: selectedLng });
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

  /**
   * Rebuilds the legacy FeatureCollection from a compact grid payload
   * (grid-edges-v1 / grid-bounds-v1, written by the pipeline alongside the
   * .geojson) so everything downstream — Leaflet layer construction,
   * linear_index mapping, bounds-based hover/click/mask — stays identical
   * to the legacy path. Throws on malformed payloads so the caller can fall
   * back to the .geojson file.
   */
  _featureCollectionFromCompactGrid(compact) {
    const shape = Array.isArray(compact?.shape) ? compact.shape : [];
    const nRows = shape[0];
    const nCols = shape[1];
    if (!Number.isInteger(nRows) || !Number.isInteger(nCols) || nRows < 1 || nCols < 1) {
      throw new Error("Malformed compact grid payload: bad shape");
    }

    // Same ring vertex order as the legacy writer: [left,bottom],
    // [right,bottom], [right,top], [left,top], closed. Leaflet normalizes
    // bounds, so the grid's latitude orientation does not matter.
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

    // Bumped by handleManifestUpdate: an in-flight fetch started under the
    // previous run must not repopulate the cache it just cleared.
    const generation = this._gridGeneration || 0;

    // Compact grid first (a few KB vs 1.2-2.6MB); the legacy GeoJSON is the
    // fallback for servers still holding data from an older pipeline run.
    // Both go through the data service: worker-side parsing, in-flight dedup
    // and 60s negative caching on failure (so a missing grid is not
    // re-requested on every playback tick).
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

        // Hover delegado no grupo (e.propagatedFrom) em vez de 2 closures por
        // célula — são até ~9.801 células por domínio, ~63k closures com os
        // 4 domínios em cache.
        layer.on("mouseover", (e) => {
          const cell = e.propagatedFrom;
          if (!cell) return;
          cell.setStyle({
            weight: 1.2,
            color: "#666",
            fillOpacity: 0.65,
          });
        });
        layer.on("mouseout", (e) => {
          const cell = e.propagatedFrom;
          if (!cell) return;
          // Restore the cell's resting style from its current state. A
          // state-clipped cell must return to GRID_HIDDEN_STYLE; a fixed
          // visible style would repaint it and defeat the clip. Visible
          // (and no-data gray) cells keep their stored fillColor.
          const hiddenByClip = this.state.isClippedToState && cell._inStateMask === false;
          cell.setStyle(
            hiddenByClip
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
    const config = VARIABLES_CONFIG[this.state.type];
    const scaleValues = this.getScaleValues(config, valueData);

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
      });
    } else {
      this._applyColorsOnMainThread(layers, values, scaleValues, config);
    }
  }

  _applyColorsOnMainThread(layers, values, scaleValues, config) {
    const colors = new Array(values.length);
    // Values are quantized to 2 decimals, so a few thousand cells share far
    // fewer distinct values — memoize per call (palette/scale can change
    // between calls, so the map must not outlive this repaint).
    const memo = new Map();
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value !== undefined && value !== null) {
        let color = memo.get(value);
        if (color === undefined) {
          color = this._colorFromScale(value, scaleValues, config);
          memo.set(value, color);
        }
        colors[i] = color;
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
    // Scratch style reused across cells: setStyle copies the properties into
    // each layer's own options, so mutating one shared object between calls
    // is safe and avoids ~10k short-lived allocations per repaint.
    const visibleStyle = { ...GRID_VISIBLE_STYLE, fillColor: undefined };

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const cellIndex = this.getCellIndexForLayer(layer, i);
      const color = colors[cellIndex];
      const inState = layer._inStateMask !== false;
      const hiddenByClip = isClipped && !inState;

      if (color === undefined) {
        // No data at this timestep: reset the previous timestep's value and
        // color instead of leaving a stale reading on the map.
        layer.feature.properties.valor = null;
        this._setGridCellStyle(layer, hiddenByClip ? GRID_HIDDEN_STYLE : GRID_NODATA_STYLE);
        continue;
      }

      layer.feature.properties.valor = values[cellIndex];

      if (hiddenByClip) {
        this._setGridCellStyle(layer, GRID_HIDDEN_STYLE);
      } else {
        visibleStyle.fillColor = color;
        this._setGridCellStyle(layer, visibleStyle);
      }
    }
  }

  /**
   * setStyle only when the layer's current options differ from the target
   * on some property the style would actually change (setStyle merges, so
   * untouched options are irrelevant). Revisiting a cached frame or toggling
   * the clip then skips Leaflet's option merge and redraw bookkeeping for
   * unchanged cells. A hovered cell (weight 1.2) never matches its resting
   * style, so repaints restore it exactly as before.
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
    // Playback repaints the SAME cached per-domain layer every tick — a full
    // Leaflet teardown/re-add of ~10k vector paths (plus marker churn and a
    // hover reset) would be paid per frame for no visual change.
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
    const config = VARIABLES_CONFIG[this.state.type];

    if (!this.state.initialDateTime && metadata?.date_time) {
      this.state.initialDateTime = this.parseDateTime(metadata.date_time);
      // Anchor to the index whose metadata we actually loaded, not whatever
      // the slider reads at resolution time (which may have moved on).
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

  updateColorbar(config) {
    const scaleValues = this.getScaleValues(config);
    // Rebuilding the gradient + label DOM every playback tick forces style
    // and layout work for identical output; skip when nothing changed.
    // The signature covers the metadata-driven scale fallback too.
    const signature = `${config.unit}|${config.colors.join(",")}|${scaleValues.join(",")}`;
    if (signature === this._colorbarSignature) return;
    this._colorbarSignature = signature;

    const gradient = `linear-gradient(to top, ${config.colors.join(", ")})`;
    this.ui.colorbarGradient.style.background = gradient;
    this.ui.colorbarUnit.textContent = config.unit;

    const labelsContainer = this.ui.colorbarLabels;
    labelsContainer.innerHTML = "";

    for (let i = scaleValues.length - 1; i >= 0; i--) {
      const label = document.createElement("div");
      label.className = "colorbar-label";
      label.textContent = this.formatColorbarValue(scaleValues[i]);
      labelsContainer.appendChild(label);
    }
  }

  formatColorbarValue(value) {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value) < 1 && value !== 0) return value.toFixed(3);
    return value.toFixed(0);
  }

  async handleMapClick(e, options = {}) {
    // The data for the current view may still be loading (the user clicked
    // mid-drag). Wait for the matching in-flight load so the sidebar reflects
    // the selected view, not a previous one. Bounded to avoid chasing a user
    // who keeps dragging; a residual mismatch falls through to "no data".
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

    // Only trust currentValueData when it matches the current view; otherwise
    // the value would be shown under a mismatched variable/time label.
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
        // Cells don't overlap: the first hit is the only hit (eachLayer
        // could not break and always scanned all ~10k layers).
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
        // A programmatic refresh must not resurrect a selection the user
        // cleared (closed the sidebar / started playback) while data loaded.
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

  /** Removes the selected-cell ping marker from the map, if present. */
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
   * Renders the selected-cell sidebar. `options.userInitiated` distinguishes
   * a real map click from programmatic refreshes (slider, variable or domain
   * switches) — consumed by the showSidebar wrapper in map-init.js to decide
   * whether the time-series modal may open.
   */
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
      // Invalidate any in-flight WIND_VECTORS fetch: a late response from
      // the previous variable (same domain:index key) must not repaint its
      // 10m arrows over the embedded hub-height arrows rendered here.
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
          // Only clear if this is still the current wind request — a stale
          // rejection must not wipe a newer wind layer.
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
    // Resolve cells through the linear_index -> layer map built in
    // loadGridLayer: feature order in the GeoJSON is not guaranteed to
    // match linear_index, so positional lookup could misplace arrows.
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
    alertDiv.textContent = message;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.classList.add("is-exiting");
      setTimeout(() => alertDiv.remove(), 300);
    }, 3000);
  }
}

window.MeteoMapManager = MeteoMapManager;
