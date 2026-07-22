"use strict";

/**
 * Catálogo estrutural de páginas.
 *
 * Referências de fonte são lógicas: `template` aponta para src/template e
 * `site` aponta para src/sites/<id>. O build que consumir este módulo é quem
 * resolve os caminhos físicos.
 */

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
    vendorStyles: Object.freeze(["assets/vendor/leaflet/leaflet.css?v=1.9.4"]),
    styles: Object.freeze(["assets/css/maps.css"]),
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
    vendorStyles: Object.freeze(["assets/vendor/leaflet/leaflet.css?v=1.9.4"]),
    styles: Object.freeze(["assets/css/maps.css"]),
    seo: Object.freeze({ h1: "Potenciais Energéticos" }),
    nav: Object.freeze({ label: "Potenciais Energéticos", icon: "fa-bolt", order: 20, elementId: "nav-potenciais" }),
    bodyAttrs: ' data-map-context="energy"',
    kicker: "Potenciais Energéticos",
    docModalTitle: "Documentação - Potenciais Energéticos",
  }),
});

function isSourceReference(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.scope === "template" || value.scope === "site") &&
    typeof value.path === "string" &&
    value.path.trim() !== ""
  );
}

function finalizePage(definition, options, typeName) {
  const source = options.source ?? definition.source;
  if (!isSourceReference(source)) {
    throw new TypeError(`${typeName} requires a source created with templateSource() or siteSource()`);
  }
  if (definition.requiresSiteSource && source.scope !== "site") {
    throw new TypeError(`${typeName} must use a site source`);
  }

  const append = options.append ?? definition.append ?? [];
  if (!Array.isArray(append) || append.some((item) => !isSourceReference(item))) {
    throw new TypeError(`${typeName}.append must be an array of source references`);
  }

  const styles = [...(definition.styles ?? []), ...(options.styles ?? [])];
  if (
    !Array.isArray(styles) ||
    styles.some((item) => !(typeof item === "string" ? item.trim() !== "" : isSourceReference(item)))
  ) {
    throw new TypeError(`${typeName}.styles must contain asset paths or template/site source references`);
  }

  const vendorStyles = [...(definition.vendorStyles ?? []), ...(options.vendorStyles ?? [])];
  if (!Array.isArray(vendorStyles) || vendorStyles.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`${typeName}.vendorStyles must be an array of versioned vendor asset paths`);
  }

  const seo = { ...(definition.seo || {}), ...(options.seo || {}) };
  for (const field of ["h1", "title", "description"]) {
    if (typeof seo[field] !== "string" || seo[field].trim() === "") {
      throw new TypeError(`${typeName}.seo.${field} is required`);
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
  return finalizePage(PAGE_TYPES[type], options, type);
}

function customPage(options = {}) {
  for (const field of ["id", "file", "layout"]) {
    if (typeof options[field] !== "string" || options[field].trim() === "") {
      throw new TypeError(`customPage.${field} is required`);
    }
  }
  return finalizePage({ append: [] }, options, `custom page ${options.id}`);
}

module.exports = { PAGE_TYPES, templateSource, siteSource, page, customPage };
