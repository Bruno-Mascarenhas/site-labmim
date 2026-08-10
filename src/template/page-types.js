"use strict";

/**
 * Structural page catalog. Source references stay logical (`template` =
 * src/template, `site` = src/sites/<id>); resolving them to physical paths is
 * the job of whichever build consumes this module.
 */

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sourceReference(scope, sourcePath) {
  if (typeof sourcePath !== "string" || sourcePath.trim() === "") {
    throw new TypeError(`A ${scope} source requires a non-empty path`);
  }
  return Object.freeze({ scope, path: sourcePath });
}

function templateSource(sourcePath) {
  return sourceReference("template", sourcePath);
}

function siteSource(sourcePath) {
  return sourceReference("site", sourcePath);
}

const PAGE_TYPES = Object.freeze({
  home: Object.freeze({
    id: "home",
    file: "index.html",
    layout: "institutional",
    append: Object.freeze([]),
    requiresSiteSource: true,
  }),
  monitoring: Object.freeze({
    id: "monitoring",
    file: "monitoring.html",
    layout: "institutional",
    source: templateSource("pages/monitoring.html"),
    append: Object.freeze([]),
    seo: Object.freeze({ h1: "Monitoramento Ambiental" }),
    nav: Object.freeze({ label: "Monitoramento", icon: "fa-chart-line", order: 30, elementId: "nav-monitoring" }),
  }),
  team: Object.freeze({
    id: "team",
    file: "team.html",
    layout: "institutional",
    append: Object.freeze([]),
    seo: Object.freeze({ h1: "Equipe" }),
    nav: Object.freeze({ label: "Equipe", icon: "fa-users", order: 50, elementId: "nav-team" }),
    requiresSiteSource: true,
  }),
  climatology: Object.freeze({
    id: "climatology",
    file: "climatologia.html",
    layout: "institutional",
    source: templateSource("pages/climatologia.html"),
    append: Object.freeze([]),
    seo: Object.freeze({ h1: "Climatologia" }),
    nav: Object.freeze({ label: "Climatologia", icon: "fa-cloud-sun", order: 40, elementId: "nav-climatologia" }),
  }),
  forecast: Object.freeze({
    id: "forecast",
    file: "mapas_interativos.html",
    layout: "webgis",
    source: templateSource("pages/mapas_interativos.html"),
    append: Object.freeze([]),
    seo: Object.freeze({ h1: "Mapas Interativos WRF" }),
    nav: Object.freeze({ label: "Previsões", icon: "fa-map", order: 10, elementId: "nav-mapas" }),
    bodyAttrs: ' data-map-context="forecast"',
    kicker: "Previsões",
    docModalTitle: "Documentação - Mapa Interativo",
  }),
  energy: Object.freeze({
    id: "energy",
    file: "potenciais_energeticos.html",
    layout: "webgis",
    source: templateSource("pages/potenciais_energeticos.html"),
    append: Object.freeze([]),
    seo: Object.freeze({ h1: "Potenciais Energéticos" }),
    nav: Object.freeze({ label: "Potenciais Energéticos", icon: "fa-bolt", order: 20, elementId: "nav-potenciais" }),
    bodyAttrs: ' data-map-context="energy"',
    kicker: "Potenciais Energéticos",
    docModalTitle: "Documentação - Potenciais Energéticos",
  }),
});

// Mirrors VARIABLE_CONTEXTS in assets/js/variables-config.js. Anything else
// falls back to "forecast" silently in the browser, so the build refuses it
// rather than render a map with the wrong set of variables.
const KNOWN_MAP_CONTEXTS = Object.freeze(["forecast", "energy"]);

function mapContextOf(bodyAttrs) {
  const match = /\bdata-map-context="([^"]+)"/.exec(bodyAttrs);
  return match ? match[1] : null;
}

/** What src/template/layouts/<id>.html needs, whichever page type is using it. */
const LAYOUT_CONTRACTS = Object.freeze({
  webgis: Object.freeze({
    vendorStyles: Object.freeze(["assets/vendor/leaflet/leaflet.css?v=1.9.4"]),
    styles: Object.freeze(["assets/css/maps.css"]),
    // Leaflet, Chart.js and the five map scripts are declared in the layout file
    // itself; the slot stays empty so no tag is emitted twice.
    vendorScripts: Object.freeze([]),
    scripts: Object.freeze([]),
    required: Object.freeze({
      bodyAttrs: Object.freeze({
        // The leading space is part of the contract: the renderer emits
        // `<body{{bodyAttrs}}>` with no separator of its own.
        test: (value) =>
          isNonEmptyString(value) && value.startsWith(" ") && KNOWN_MAP_CONTEXTS.includes(mapContextOf(value)),
        expectation: `a <body> attribute string carrying data-map-context set to one of: ${KNOWN_MAP_CONTEXTS.join(", ")}`,
      }),
      kicker: Object.freeze({ test: isNonEmptyString, expectation: "a non-empty string" }),
      docModalTitle: Object.freeze({ test: isNonEmptyString, expectation: "a non-empty string" }),
    }),
  }),
});

const EMPTY_LAYOUT_CONTRACT = Object.freeze({
  vendorStyles: Object.freeze([]),
  styles: Object.freeze([]),
  vendorScripts: Object.freeze([]),
  scripts: Object.freeze([]),
  required: Object.freeze({}),
});

function layoutContract(layout) {
  if (!isNonEmptyString(layout) || !Object.prototype.hasOwnProperty.call(LAYOUT_CONTRACTS, layout)) {
    return EMPTY_LAYOUT_CONTRACT;
  }
  return LAYOUT_CONTRACTS[layout];
}

/**
 * Keys accepted by `page(type, options)`. `bodyAttrs`/`kicker`/`docModalTitle`
 * are layout slots, used only by webgis today. `indexable: false` both drops the
 * page from sitemap.xml and emits `<meta name="robots" content="noindex,
 * follow">` (renderer.js).
 */
const PAGE_OPTION_KEYS = Object.freeze([
  "append",
  "bodyAttrs",
  "docModalTitle",
  "indexable",
  "kicker",
  "nav",
  "scripts",
  "seo",
  "source",
  "styles",
  "vendorScripts",
  "vendorStyles",
]);

const STRUCTURAL_OPTION_KEYS = Object.freeze(["id", "file", "layout"]);
const CUSTOM_PAGE_OPTION_KEYS = Object.freeze([...STRUCTURAL_OPTION_KEYS, ...PAGE_OPTION_KEYS].sort());

// `home` carries semantics in the renderer (ResearchOrganization JSON-LD) and in
// the validator, so only `page("home")` may produce it.
const RESERVED_PAGE_IDS = Object.freeze(["home"]);

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[right.length];
}

function closestKey(key, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  const distanceStillPlausibleAsTypo = Math.max(1, Math.floor(key.length / 3));
  return bestDistance <= distanceStillPlausibleAsTypo ? best : null;
}

function assertKnownOptions(options, allowedKeys, typeName) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${typeName} options must be an object`);
  }
  for (const key of Object.keys(options)) {
    if (allowedKeys.includes(key)) continue;
    const suggestion = closestKey(key, allowedKeys);
    const hint = suggestion ? `; did you mean ${JSON.stringify(suggestion)}?` : ".";
    throw new TypeError(
      `${typeName}: unknown option ${JSON.stringify(key)}${hint} Valid options: ${allowedKeys.join(", ")}`
    );
  }
}

function isSourceReference(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.scope === "template" || value.scope === "site") &&
    typeof value.path === "string" &&
    value.path.trim() !== ""
  );
}

function sameStylesheet(left, right) {
  if (typeof left === "string" || typeof right === "string") {
    if (typeof left !== "string" || typeof right !== "string") return false;
    // Same assetPath/suffix split validate.js makes: the same file declared at
    // another version REPLACES the layout default, it is not a second link.
    return assetPathWithoutVersion(left) === assetPathWithoutVersion(right);
  }
  return isSourceReference(left) && isSourceReference(right) && left.scope === right.scope && left.path === right.path;
}

function assetPathWithoutVersion(asset) {
  return asset.split(/(?=[?#])/, 2)[0];
}

function missingLayoutAssets(layoutAssets, declared) {
  return layoutAssets.filter((asset) => !declared.some((entry) => sameStylesheet(entry, asset)));
}

function optionValue(definition, options, field) {
  return Object.prototype.hasOwnProperty.call(options, field) ? options[field] : definition[field];
}

/**
 * The RAW option is checked for arrayness first because a mistyped
 * `styles: "x.css"` would otherwise spread into single characters that pass the
 * per-item validation below and only break far downstream.
 */
function mergeArrayOption(definition, options, field, typeName) {
  const provided = options[field];
  if (provided !== undefined && !Array.isArray(provided)) {
    throw new TypeError(`${typeName}.${field} must be an array`);
  }
  return [...(definition[field] ?? []), ...(provided ?? [])];
}

function finalizePage(definition, options, typeName) {
  const source = options.source ?? definition.source;
  if (!isSourceReference(source)) {
    throw new TypeError(`${typeName} requires a source created with templateSource() or siteSource()`);
  }
  if (definition.requiresSiteSource && source.scope !== "site") {
    throw new TypeError(`${typeName} must use a site source`);
  }

  const layout = optionValue(definition, options, "layout");
  const contract = layoutContract(layout);

  const append = options.append ?? definition.append ?? [];
  if (!Array.isArray(append) || append.some((item) => !isSourceReference(item))) {
    throw new TypeError(`${typeName}.append must be an array of source references`);
  }

  const declaredStyles = mergeArrayOption(definition, options, "styles", typeName);
  const styles = [...missingLayoutAssets(contract.styles, declaredStyles), ...declaredStyles];
  if (styles.some((item) => !(typeof item === "string" ? item.trim() !== "" : isSourceReference(item)))) {
    throw new TypeError(`${typeName}.styles must contain asset paths or template/site source references`);
  }

  const declaredVendorStyles = mergeArrayOption(definition, options, "vendorStyles", typeName);
  const vendorStyles = [...missingLayoutAssets(contract.vendorStyles, declaredVendorStyles), ...declaredVendorStyles];
  if (vendorStyles.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`${typeName}.vendorStyles must be an array of versioned vendor asset paths`);
  }

  // Scripts are always paths already published under site/assets/, never sources
  // in src/**: unlike page CSS, site/assets/js/ is versioned source rather than
  // build output, so there is nothing to copy into assets/js/generated/.
  const declaredVendorScripts = mergeArrayOption(definition, options, "vendorScripts", typeName);
  const vendorScripts = [
    ...missingLayoutAssets(contract.vendorScripts, declaredVendorScripts),
    ...declaredVendorScripts,
  ];
  const declaredScripts = mergeArrayOption(definition, options, "scripts", typeName);
  const scripts = [...missingLayoutAssets(contract.scripts, declaredScripts), ...declaredScripts];
  for (const [field, list] of [
    ["vendorScripts", vendorScripts],
    ["scripts", scripts],
  ]) {
    if (list.some((item) => typeof item !== "string" || item.trim() === "")) {
      throw new TypeError(`${typeName}.${field} must be an array of asset paths`);
    }
  }

  const seo = { ...(definition.seo || {}), ...(options.seo || {}) };
  for (const field of ["h1", "title", "description"]) {
    if (typeof seo[field] !== "string" || seo[field].trim() === "") {
      throw new TypeError(`${typeName}.seo.${field} is required`);
    }
  }

  for (const field of ["bodyAttrs", "kicker", "docModalTitle"]) {
    const value = optionValue(definition, options, field);
    if (value !== undefined && typeof value !== "string") {
      throw new TypeError(`${typeName}.${field} must be a string`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(options, "indexable") && typeof options.indexable !== "boolean") {
    throw new TypeError(
      `${typeName}.indexable must be a boolean (false removes the page from sitemap.xml and emits noindex)`
    );
  }

  for (const [field, rule] of Object.entries(contract.required)) {
    if (!rule.test(optionValue(definition, options, field))) {
      throw new TypeError(`${typeName}.${field} is required by the "${layout}" layout: expected ${rule.expectation}`);
    }
  }

  const baseNav = definition.nav;
  let nav;
  if (options.nav !== false && options.nav !== null && (baseNav || options.nav)) {
    nav = { ...(baseNav || {}), ...(options.nav || {}) };
  }
  const result = {
    ...definition,
    ...options,
    source,
    append: [...append],
    vendorStyles: [...vendorStyles],
    styles: [...styles],
    vendorScripts: [...vendorScripts],
    scripts: [...scripts],
    seo,
  };
  delete result.requiresSiteSource;
  delete result.nav;
  if (nav) result.nav = nav;
  return result;
}

function page(type, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(PAGE_TYPES, type)) {
    throw new TypeError(`Unknown page type: ${type}`);
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${type} options must be an object`);
  }
  for (const field of STRUCTURAL_OPTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(options, field)) {
      throw new TypeError(
        `${type}: ${field} comes from the page type and cannot be overridden ` +
          `(${STRUCTURAL_OPTION_KEYS.join(", ")} are fixed); use customPage() for a route outside the catalog`
      );
    }
  }
  assertKnownOptions(options, PAGE_OPTION_KEYS, type);
  return finalizePage(PAGE_TYPES[type], options, type);
}

function customPage(options = {}) {
  assertKnownOptions(options, CUSTOM_PAGE_OPTION_KEYS, "customPage");
  for (const field of STRUCTURAL_OPTION_KEYS) {
    if (typeof options[field] !== "string" || options[field].trim() === "") {
      throw new TypeError(`customPage.${field} is required`);
    }
  }
  if (RESERVED_PAGE_IDS.includes(options.id)) {
    throw new TypeError(
      `customPage.id: ${JSON.stringify(options.id)} is reserved; declare it with page(${JSON.stringify(options.id)}, ...)`
    );
  }
  return finalizePage({ append: [] }, options, `custom page ${options.id}`);
}

module.exports = {
  PAGE_TYPES,
  PAGE_OPTION_KEYS,
  CUSTOM_PAGE_OPTION_KEYS,
  LAYOUT_CONTRACTS,
  // Reused by other closed key sets (the dataset `model` block, in
  // scripts/site-builder/validate.js) so a typo gets the same suggestion there.
  closestKey,
  templateSource,
  siteSource,
  page,
  customPage,
};
