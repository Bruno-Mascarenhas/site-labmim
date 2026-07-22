"use strict";

const fs = require("fs");
const path = require("path");
const { inspectPublicationThemeCss } = require("./theme-contract");

const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const GEOJSON_CODE_PROPERTIES = ["SIGLA", "sigla", "UF", "uf", "stateCode", "code", "PK_sigla"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addRequiredString(errors, value, field) {
  if (!isNonEmptyString(value)) {
    errors.push(`${field}: expected a non-empty string`);
    return false;
  }
  if (value !== value.trim()) {
    errors.push(`${field}: must not contain leading or trailing whitespace`);
    return false;
  }
  return true;
}

function addRequiredObject(errors, value, field) {
  if (!isObject(value)) {
    errors.push(`${field}: expected an object`);
    return false;
  }
  return true;
}

function resolveFromRoot(root, configuredPath) {
  if (!isNonEmptyString(configuredPath)) return null;
  return path.isAbsolute(configuredPath) ? path.resolve(configuredPath) : path.resolve(root, configuredPath);
}

function pathIsInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function realPathIsInside(base, candidate) {
  try {
    return pathIsInside(fs.realpathSync(base), fs.realpathSync(candidate));
  } catch {
    return pathIsInside(base, candidate);
  }
}

function validateDirectory(errors, directory, field) {
  if (!directory) {
    errors.push(`${field}: expected a directory path`);
    return false;
  }
  if (!fs.existsSync(directory)) {
    errors.push(`${field}: directory does not exist: ${directory}`);
    return false;
  }
  if (!fs.statSync(directory).isDirectory()) {
    errors.push(`${field}: path is not a directory: ${directory}`);
    return false;
  }
  return true;
}

function isSafeRelativeFilePath(value) {
  if (!isNonEmptyString(value) || value.includes("\\") || value.includes("\0")) return false;
  if (value.includes("?") || value.includes("#") || path.isAbsolute(value)) return false;
  if (value.split("/").some((segment) => segment === "." || segment === "..")) return false;
  const normalized = path.posix.normalize(value);
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.startsWith("/");
}

function validateConfinedFile(errors, base, relativePath, field, options = {}) {
  if (!isNonEmptyString(base)) return null;
  if (!addRequiredString(errors, relativePath, field)) return null;
  if (!isSafeRelativeFilePath(relativePath)) {
    errors.push(`${field}: expected a safe relative file path`);
    return null;
  }

  const resolved = path.resolve(base, relativePath);
  if (!pathIsInside(base, resolved)) {
    errors.push(`${field}: path escapes its allowed directory`);
    return null;
  }
  if (!fs.existsSync(resolved)) {
    errors.push(`${field}: file does not exist: ${resolved}`);
    return null;
  }
  if (!fs.statSync(resolved).isFile()) {
    errors.push(`${field}: path is not a file: ${resolved}`);
    return null;
  }
  if (!realPathIsInside(base, resolved)) {
    errors.push(`${field}: resolved file escapes its allowed directory`);
    return null;
  }
  if (options.nonEmpty && fs.statSync(resolved).size === 0) {
    errors.push(`${field}: source file must not be empty`);
  }
  return resolved;
}

function validateHttpUrl(errors, value, field, { origin = false } = {}) {
  if (!addRequiredString(errors, value, field)) return null;
  if (origin && value.endsWith("/")) {
    errors.push(`${field}: origin must not have a trailing slash`);
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      errors.push(`${field}: URL protocol must be http or https`);
    }
    if (!parsed.hostname) errors.push(`${field}: URL must include a hostname`);
    if (parsed.username || parsed.password) errors.push(`${field}: URL must not include credentials`);
    if (origin && (parsed.search || parsed.hash)) {
      errors.push(`${field}: origin must not include a query string or fragment`);
    }
    if (origin && parsed.pathname !== "/") {
      errors.push(`${field}: origin must not include a path; deployments use root-relative asset URLs`);
    }
    return parsed;
  } catch {
    errors.push(`${field}: invalid URL`);
    return null;
  }
}

function validateCoordinate(errors, value, field) {
  if (!Array.isArray(value) || value.length !== 2) {
    errors.push(`${field}: expected [latitude, longitude]`);
    return false;
  }
  const [latitude, longitude] = value;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.push(`${field}[0]: latitude must be a finite number between -90 and 90`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.push(`${field}[1]: longitude must be a finite number between -180 and 180`);
  }
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function validateZoom(errors, value, field) {
  if (!Number.isFinite(value) || value < 0 || value > 24) {
    errors.push(`${field}: expected a finite zoom between 0 and 24`);
    return false;
  }
  return true;
}

function positionsEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left[0] === right[0] && left[1] === right[1];
}

function inspectRing(ring, field, errors, bounds) {
  if (!Array.isArray(ring) || ring.length < 4) {
    errors.push(`${field}: a GeoJSON linear ring must contain at least four positions`);
    return;
  }

  for (let index = 0; index < ring.length; index += 1) {
    const position = ring[index];
    if (!Array.isArray(position) || position.length < 2) {
      errors.push(`${field}[${index}]: expected a GeoJSON [longitude, latitude] position`);
      continue;
    }
    const [longitude, latitude] = position;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      errors.push(`${field}[${index}][0]: longitude must be between -180 and 180`);
      continue;
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      errors.push(`${field}[${index}][1]: latitude must be between -90 and 90`);
      continue;
    }
    bounds.minLongitude = Math.min(bounds.minLongitude, longitude);
    bounds.maxLongitude = Math.max(bounds.maxLongitude, longitude);
    bounds.minLatitude = Math.min(bounds.minLatitude, latitude);
    bounds.maxLatitude = Math.max(bounds.maxLatitude, latitude);
  }

  if (!positionsEqual(ring[0], ring.at(-1))) {
    errors.push(`${field}: GeoJSON linear ring must be closed`);
  }
}

function inspectPolygon(coordinates, field, errors, bounds) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    errors.push(`${field}: Polygon coordinates must contain at least one linear ring`);
    return;
  }
  coordinates.forEach((ring, index) => inspectRing(ring, `${field}[${index}]`, errors, bounds));
}

function inspectBoundaryGeoJson(geojson, expectedCode, errors, field) {
  const bounds = {
    minLongitude: Infinity,
    maxLongitude: -Infinity,
    minLatitude: Infinity,
    maxLatitude: -Infinity,
  };

  if (!isObject(geojson) || geojson.type !== "FeatureCollection") {
    errors.push(`${field}: expected a GeoJSON FeatureCollection`);
    return null;
  }
  if (!Array.isArray(geojson.features) || geojson.features.length === 0) {
    errors.push(`${field}.features: expected at least one feature`);
    return null;
  }

  const boundaryCodes = [];
  geojson.features.forEach((feature, featureIndex) => {
    const featureField = `${field}.features[${featureIndex}]`;
    if (!isObject(feature) || feature.type !== "Feature") {
      errors.push(`${featureField}: expected a GeoJSON Feature`);
      return;
    }

    const geometry = feature.geometry;
    if (!isObject(geometry) || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
      errors.push(`${featureField}.geometry: expected Polygon or MultiPolygon`);
      return;
    }
    if (geometry.type === "Polygon") {
      inspectPolygon(geometry.coordinates, `${featureField}.geometry.coordinates`, errors, bounds);
    } else if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      errors.push(`${featureField}.geometry.coordinates: MultiPolygon must contain at least one polygon`);
    } else {
      geometry.coordinates.forEach((polygon, polygonIndex) =>
        inspectPolygon(polygon, `${featureField}.geometry.coordinates[${polygonIndex}]`, errors, bounds)
      );
    }

    const properties = isObject(feature.properties) ? feature.properties : {};
    for (const property of GEOJSON_CODE_PROPERTIES) {
      if (isNonEmptyString(properties[property])) {
        boundaryCodes.push({ field: `${featureField}.properties.${property}`, value: properties[property] });
        break;
      }
    }
  });

  if (isNonEmptyString(expectedCode)) {
    if (boundaryCodes.length === 0) {
      errors.push(`${field}: no state code/sigla property was found in its features`);
    } else {
      for (const entry of boundaryCodes) {
        if (entry.value.toUpperCase() !== expectedCode.toUpperCase()) {
          errors.push(`${entry.field}: expected territory code ${expectedCode}, received ${entry.value}`);
        }
      }
    }
  }

  if (![bounds.minLongitude, bounds.maxLongitude, bounds.minLatitude, bounds.maxLatitude].every(Number.isFinite)) {
    errors.push(`${field}: boundary does not contain valid positions`);
    return null;
  }

  // Leaflet-compatible [south-west, north-east] bounds. GeoJSON positions are
  // longitude-first; map coordinates are latitude-first.
  return [
    [bounds.minLatitude, bounds.minLongitude],
    [bounds.maxLatitude, bounds.maxLongitude],
  ];
}

function readBoundaryInput(input) {
  if (typeof input !== "string") return input;
  const text = fs.readFileSync(input, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse boundary GeoJSON ${input}: ${error.message}`, { cause: error });
  }
}

/**
 * Compute Leaflet-compatible bounds from a Polygon/MultiPolygon
 * FeatureCollection. A path may be supplied instead of the parsed object.
 */
function boundaryBounds(geojsonOrPath, expectedCode) {
  const errors = [];
  const geojson = readBoundaryInput(geojsonOrPath);
  const bounds = inspectBoundaryGeoJson(geojson, expectedCode, errors, "boundary");
  if (errors.length > 0) {
    throw new Error(`Invalid boundary GeoJSON:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  return bounds;
}

function validateAsset(errors, siteDirectory, value, field) {
  return validateConfinedFile(errors, siteDirectory, value, field);
}

function validateTheme(errors, publicationDirectory, value) {
  const themePath = validateConfinedFile(errors, publicationDirectory, value, "theme", { nonEmpty: true });
  if (!themePath) return;
  const content = fs.readFileSync(themePath, "utf8");
  for (const error of inspectPublicationThemeCss(content)) {
    errors.push(`theme: ${error}`);
  }
}

function validateLogo(errors, siteDirectory, logo, field) {
  if (!addRequiredObject(errors, logo, field)) return;
  validateAsset(errors, siteDirectory, logo.src, `${field}.src`);
  if (logo.webp !== undefined && logo.webp !== null) {
    validateAsset(errors, siteDirectory, logo.webp, `${field}.webp`);
  }
  for (const dimension of ["width", "height"]) {
    if (!Number.isFinite(logo[dimension]) || logo[dimension] <= 0) {
      errors.push(`${field}.${dimension}: expected a positive number`);
    }
  }
}

function validateBrand(errors, publication, siteDirectory) {
  if (!addRequiredObject(errors, publication.brand, "brand")) return;
  const brand = publication.brand;
  for (const field of ["name", "fullName", "copyrightName"]) {
    addRequiredString(errors, brand[field], `brand.${field}`);
  }
  validateAsset(errors, siteDirectory, brand.ogImage, "brand.ogImage");

  if (addRequiredObject(errors, brand.logos, "brand.logos")) {
    for (const role of ["nav", "footer", "sidebar"]) {
      validateLogo(errors, siteDirectory, brand.logos[role], `brand.logos.${role}`);
    }
  }

  if (!Array.isArray(brand.affiliations)) {
    errors.push("brand.affiliations: expected an array");
  } else {
    brand.affiliations.forEach((affiliation, index) => {
      const field = `brand.affiliations[${index}]`;
      if (!addRequiredObject(errors, affiliation, field)) return;
      addRequiredString(errors, affiliation.kind, `${field}.kind`);
      addRequiredString(errors, affiliation.name, `${field}.name`);
      validateHttpUrl(errors, affiliation.href, `${field}.href`);
      if (affiliation.kind === "image") {
        validateAsset(errors, siteDirectory, affiliation.src, `${field}.src`);
        if (affiliation.webp !== undefined && affiliation.webp !== null) {
          validateAsset(errors, siteDirectory, affiliation.webp, `${field}.webp`);
        }
        for (const dimension of ["width", "height"]) {
          if (!Number.isFinite(affiliation[dimension]) || affiliation[dimension] <= 0) {
            errors.push(`${field}.${dimension}: expected a positive number`);
          }
        }
      } else if (affiliation.kind === "text") {
        addRequiredString(errors, affiliation.institution, `${field}.institution`);
      } else if (isNonEmptyString(affiliation.kind)) {
        errors.push(`${field}.kind: expected "image" or "text"`);
      }
    });
  }
}

function validateTerritory(errors, territory, siteDirectory) {
  if (!addRequiredObject(errors, territory, "territory")) return null;
  for (const field of ["id", "kind", "code", "name", "regionPhrase", "terrainExample"]) {
    addRequiredString(errors, territory[field], `territory.${field}`);
  }
  if (isNonEmptyString(territory.code) && !/^[A-Z]{2}$/.test(territory.code)) {
    errors.push("territory.code: expected a two-letter uppercase state code");
  }
  if (territory.kind !== "state") {
    errors.push('territory.kind: expected "state"');
  }
  if (isNonEmptyString(territory.id) && isNonEmptyString(territory.code)) {
    const idParts = territory.id.toLowerCase().split(/[-_]/);
    if (!idParts.includes(territory.code.toLowerCase())) {
      errors.push(`territory.id: ${territory.id} is not compatible with code ${territory.code}`);
    }
  }

  let bounds = null;
  const boundaryPath = validateAsset(errors, siteDirectory, territory.boundaryAsset, "territory.boundaryAsset");
  if (boundaryPath) {
    let geojson;
    try {
      geojson = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
    } catch (error) {
      errors.push(`territory.boundaryAsset: invalid JSON: ${error.message}`);
    }
    if (geojson) {
      bounds = inspectBoundaryGeoJson(geojson, territory.code, errors, "territory.boundaryAsset");
    }
  }

  if (addRequiredObject(errors, territory.viewport, "territory.viewport")) {
    const viewport = territory.viewport;
    validateCoordinate(errors, viewport.center, "territory.viewport.center");
    validateZoom(errors, viewport.zoom, "territory.viewport.zoom");
    if (typeof viewport.fitBoundary !== "boolean") {
      errors.push("territory.viewport.fitBoundary: expected a boolean");
    }
    validateZoom(errors, viewport.fitMaxZoom, "territory.viewport.fitMaxZoom");
  }

  return bounds;
}

function validateDatasetPath(errors, value, field, { directory = false } = {}) {
  if (!addRequiredString(errors, value, field)) return;
  if (!isSafeRelativeFilePath(value)) {
    errors.push(`${field}: expected a safe relative output path`);
  }
  if (/[{}]/.test(value)) {
    errors.push(`${field}: expected a concrete path, not a placeholder pattern`);
  }
  if (directory && (value.endsWith("/") || path.posix.extname(value))) {
    errors.push(`${field}: expected a relative base directory without trailing slash`);
  }
}

function validateDataset(errors, dataset) {
  if (!addRequiredObject(errors, dataset, "dataset")) return;
  addRequiredString(errors, dataset.id, "dataset.id");
  addRequiredString(errors, dataset.attribution, "dataset.attribution");

  if (addRequiredObject(errors, dataset.paths, "dataset.paths")) {
    validateDatasetPath(errors, dataset.paths.manifest, "dataset.paths.manifest");
    validateDatasetPath(errors, dataset.paths.values, "dataset.paths.values", { directory: true });
    validateDatasetPath(errors, dataset.paths.grids, "dataset.paths.grids", { directory: true });
  }

  if (addRequiredObject(errors, dataset.timeline, "dataset.timeline")) {
    const timeline = dataset.timeline;
    if (!Number.isInteger(timeline.defaultMaxLayer) || timeline.defaultMaxLayer < 1) {
      errors.push("dataset.timeline.defaultMaxLayer: expected a positive integer");
    }
    if (!Number.isInteger(timeline.initialIndex) || timeline.initialIndex < 1) {
      errors.push("dataset.timeline.initialIndex: expected a positive integer");
    } else if (Number.isInteger(timeline.defaultMaxLayer) && timeline.initialIndex > timeline.defaultMaxLayer) {
      errors.push("dataset.timeline.initialIndex: must not exceed defaultMaxLayer");
    }
    if (!Number.isFinite(timeline.stepHours) || timeline.stepHours <= 0) {
      errors.push("dataset.timeline.stepHours: expected a positive number");
    }
    addRequiredString(errors, timeline.label, "dataset.timeline.label");
  }

  addRequiredString(errors, dataset.defaultDomain, "dataset.defaultDomain");
  if (!Array.isArray(dataset.domains) || dataset.domains.length === 0) {
    errors.push("dataset.domains: expected a non-empty array");
    return;
  }

  const domainIds = new Map();
  dataset.domains.forEach((domain, index) => {
    const field = `dataset.domains[${index}]`;
    if (!addRequiredObject(errors, domain, field)) return;
    for (const property of ["id", "label", "longLabel", "resolution", "description"]) {
      addRequiredString(errors, domain[property], `${field}.${property}`);
    }
    if (isNonEmptyString(domain.id)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(domain.id)) {
        errors.push(`${field}.id: expected a filesystem-safe domain id`);
      }
      if (domainIds.has(domain.id)) {
        errors.push(`${field}.id: duplicate domain id also used at dataset.domains[${domainIds.get(domain.id)}]`);
      } else {
        domainIds.set(domain.id, index);
      }
    }
    validateCoordinate(errors, domain.center, `${field}.center`);
    validateZoom(errors, domain.zoom, `${field}.zoom`);
    if (typeof domain.cumulusParameterized !== "boolean") {
      errors.push(`${field}.cumulusParameterized: expected a boolean`);
    }
  });

  if (isNonEmptyString(dataset.defaultDomain) && !domainIds.has(dataset.defaultDomain)) {
    errors.push(`dataset.defaultDomain: no matching domain with id ${dataset.defaultDomain}`);
  }
}

function validatePageOutputPath(errors, value, field) {
  if (!addRequiredString(errors, value, field)) return false;
  if (!isSafeRelativeFilePath(value) || !value.endsWith(".html") || value.includes("/")) {
    errors.push(`${field}: expected a root-level .html filename without directories`);
    return false;
  }
  return true;
}

function validateSourceReference(errors, reference, field, templateDirectory, publicationDirectory, options = {}) {
  if (!addRequiredObject(errors, reference, field)) return null;
  if (reference.scope !== "template" && reference.scope !== "site") {
    errors.push(`${field}.scope: expected "template" or "site"`);
    return null;
  }
  const base = reference.scope === "template" ? templateDirectory : publicationDirectory;
  return validateConfinedFile(errors, base, reference.path, `${field}.path`, options);
}

function validateLayout(errors, layout, templateDirectory, field) {
  if (!addRequiredString(errors, layout, field)) return;
  if (!/^[a-z][a-z0-9_-]*$/.test(layout)) {
    errors.push(`${field}: expected a layout id containing lowercase letters, digits, _ or -`);
    return;
  }
  if (!isNonEmptyString(templateDirectory)) return;
  const candidate = path.join(templateDirectory, "layouts", `${layout}.html`);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    errors.push(`${field}: layout file does not exist: ${candidate}`);
  } else if (!realPathIsInside(templateDirectory, candidate)) {
    errors.push(`${field}: layout file escapes templateRoot`);
  }
}

function validatePageStyles(
  errors,
  stylesheets,
  field,
  siteDirectory,
  templateDirectory,
  publicationDirectory,
  { vendor = false } = {}
) {
  if (!Array.isArray(stylesheets)) {
    errors.push(`${field}: expected an array`);
    return;
  }

  const seen = new Set();
  stylesheets.forEach((stylesheet, index) => {
    const styleField = `${field}[${index}]`;
    if (!vendor && isObject(stylesheet)) {
      const key = `${stylesheet.scope}:${stylesheet.path}`;
      validateSourceReference(errors, stylesheet, styleField, templateDirectory, publicationDirectory, {
        nonEmpty: true,
      });
      if (
        !isNonEmptyString(stylesheet.path) ||
        !stylesheet.path.startsWith("styles/") ||
        !stylesheet.path.endsWith(".css")
      ) {
        errors.push(`${styleField}.path: authored page styles must be CSS files below styles/`);
      }
      if (seen.has(key)) errors.push(`${styleField}: duplicate stylesheet ${key}`);
      seen.add(key);
      return;
    }
    if (!addRequiredString(errors, stylesheet, styleField)) return;

    const [assetPath, suffix = ""] = stylesheet.split(/(?=[?#])/, 2);
    const expectedRoot = vendor ? "assets/vendor/" : "assets/css/";
    if (!assetPath.startsWith(expectedRoot) || !assetPath.endsWith(".css")) {
      errors.push(`${styleField}: expected a CSS asset below ${expectedRoot}`);
      return;
    }
    if (vendor ? suffix && !/^\?v=[A-Za-z0-9._-]+$/.test(suffix) : suffix) {
      errors.push(
        `${styleField}: ${vendor ? "expected only an optional ?v=<version> suffix" : "first-party CSS is versioned by the build"}`
      );
      return;
    }

    validateConfinedFile(errors, siteDirectory, assetPath, styleField, { nonEmpty: true });
    if (seen.has(stylesheet)) errors.push(`${styleField}: duplicate stylesheet ${stylesheet}`);
    seen.add(stylesheet);
  });
}

function validatePages(errors, pages, templateDirectory, publicationDirectory, siteDirectory) {
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push("pages: expected a non-empty array");
    return new Set();
  }

  const ids = new Map();
  const outputs = new Map();
  const navOrders = new Map();
  const navLabels = new Map();
  const navElementIds = new Map();

  pages.forEach((page, index) => {
    const field = `pages[${index}]`;
    if (!addRequiredObject(errors, page, field)) return;

    if (addRequiredString(errors, page.id, `${field}.id`)) {
      if (!/^[a-z][a-z0-9_-]*$/.test(page.id)) {
        errors.push(`${field}.id: expected a lowercase page id`);
      }
      if (ids.has(page.id)) {
        errors.push(`${field}.id: duplicate page id also used at pages[${ids.get(page.id)}]`);
      } else {
        ids.set(page.id, index);
      }
    }

    if (validatePageOutputPath(errors, page.file, `${field}.file`)) {
      if (outputs.has(page.file)) {
        errors.push(`${field}.file: duplicate output also used at pages[${outputs.get(page.file)}]`);
      } else {
        outputs.set(page.file, index);
      }
    }

    validateLayout(errors, page.layout, templateDirectory, `${field}.layout`);
    validateSourceReference(errors, page.source, `${field}.source`, templateDirectory, publicationDirectory, {
      nonEmpty: true,
    });

    if (!Array.isArray(page.append)) {
      errors.push(`${field}.append: expected an array`);
    } else {
      page.append.forEach((reference, appendIndex) =>
        validateSourceReference(
          errors,
          reference,
          `${field}.append[${appendIndex}]`,
          templateDirectory,
          publicationDirectory
        )
      );
    }

    validatePageStyles(
      errors,
      page.vendorStyles,
      `${field}.vendorStyles`,
      siteDirectory,
      templateDirectory,
      publicationDirectory,
      { vendor: true }
    );
    validatePageStyles(errors, page.styles, `${field}.styles`, siteDirectory, templateDirectory, publicationDirectory);

    if (addRequiredObject(errors, page.seo, `${field}.seo`)) {
      for (const property of ["h1", "title", "description"]) {
        addRequiredString(errors, page.seo[property], `${field}.seo.${property}`);
      }
    }

    if (page.nav !== undefined && page.nav !== null) {
      if (addRequiredObject(errors, page.nav, `${field}.nav`)) {
        addRequiredString(errors, page.nav.label, `${field}.nav.label`);
        addRequiredString(errors, page.nav.icon, `${field}.nav.icon`);
        if (addRequiredString(errors, page.nav.elementId, `${field}.nav.elementId`)) {
          if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(page.nav.elementId)) {
            errors.push(`${field}.nav.elementId: expected a valid HTML id`);
          }
          if (navElementIds.has(page.nav.elementId)) {
            errors.push(
              `${field}.nav.elementId: duplicate id also used at pages[${navElementIds.get(page.nav.elementId)}].nav`
            );
          } else {
            navElementIds.set(page.nav.elementId, index);
          }
        }
        if (!Number.isInteger(page.nav.order)) {
          errors.push(`${field}.nav.order: expected an integer`);
        } else if (navOrders.has(page.nav.order)) {
          errors.push(`${field}.nav.order: duplicate order also used at pages[${navOrders.get(page.nav.order)}].nav`);
        } else {
          navOrders.set(page.nav.order, index);
        }
        if (isNonEmptyString(page.nav.label)) {
          if (navLabels.has(page.nav.label)) {
            errors.push(`${field}.nav.label: duplicate label also used at pages[${navLabels.get(page.nav.label)}].nav`);
          } else {
            navLabels.set(page.nav.label, index);
          }
        }
      }
    }
  });

  const homeIndex = ids.get("home");
  if (homeIndex === undefined) {
    errors.push('pages: expected one page with id "home"');
  } else if (pages[homeIndex]?.file !== "index.html") {
    errors.push(`pages[${homeIndex}].file: the home page must output index.html`);
  }
  if (!outputs.has("index.html")) {
    errors.push("pages: expected an index.html output");
  }

  return new Set(outputs.keys());
}

function decodedPathSegments(value) {
  try {
    return decodeURIComponent(value).split("/");
  } catch {
    return null;
  }
}

function isSafeRedirectPath(value) {
  if (!isNonEmptyString(value) || !value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("//") || value.includes("\\") || value.includes("\0") || value.includes("://")) return false;
  if (value.includes("?") || value.includes("#")) return false;

  const segments = decodedPathSegments(value);
  if (!segments || segments.some((segment) => segment === "." || segment === "..")) return false;
  return true;
}

function redirectTargetOutput(target) {
  if (target === "/") return "index.html";
  return target.slice(1);
}

function validateRedirects(errors, redirects, pageOutputs) {
  if (!Array.isArray(redirects)) {
    errors.push("redirects: expected an array");
    return;
  }
  const sources = new Map();
  redirects.forEach((redirect, index) => {
    const field = `redirects[${index}]`;
    if (!addRequiredObject(errors, redirect, field)) return;

    if (!addRequiredString(errors, redirect.from, `${field}.from`) || !isSafeRedirectPath(redirect.from)) {
      if (isNonEmptyString(redirect.from)) errors.push(`${field}.from: expected a safe absolute site path`);
    } else if (sources.has(redirect.from)) {
      errors.push(`${field}.from: duplicate redirect source also used at redirects[${sources.get(redirect.from)}]`);
    } else {
      sources.set(redirect.from, index);
    }

    if (!addRequiredString(errors, redirect.to, `${field}.to`) || !isSafeRedirectPath(redirect.to)) {
      if (isNonEmptyString(redirect.to)) errors.push(`${field}.to: expected a safe internal destination path`);
    } else {
      const target = redirectTargetOutput(redirect.to);
      if (!pageOutputs.has(target)) {
        errors.push(`${field}.to: destination does not match a configured page output (${target})`);
      }
      if (redirect.from === redirect.to) errors.push(`${field}: redirect source and destination must differ`);
    }

    if (redirect.hash !== undefined && redirect.hash !== null) {
      if (!addRequiredString(errors, redirect.hash, `${field}.hash`)) {
        // addRequiredString supplies the actionable message.
      } else if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(redirect.hash)) {
        errors.push(`${field}.hash: expected a safe fragment slug without #`);
      }
    }

    if (!REDIRECT_STATUSES.has(redirect.status)) {
      errors.push(`${field}.status: expected one of ${[...REDIRECT_STATUSES].join(", ")}`);
    }
  });
}

/**
 * Validate one fully resolved publication manifest and its local references.
 * All problems are collected so onboarding a new publication does not become
 * a slow one-error-per-build loop.
 */
function validatePublication({ root, templateRoot, siteDir, publication } = {}) {
  const errors = [];
  let workspaceRoot;
  if (root === undefined || root === null || root === "") {
    workspaceRoot = process.cwd();
  } else if (typeof root !== "string") {
    errors.push("root: expected a directory path string");
    workspaceRoot = process.cwd();
  } else {
    workspaceRoot = path.resolve(root);
  }
  const templateDirectory = resolveFromRoot(workspaceRoot, templateRoot);
  const siteDirectory = resolveFromRoot(workspaceRoot, siteDir);

  validateDirectory(errors, workspaceRoot, "root");
  validateDirectory(errors, templateDirectory, "templateRoot");
  validateDirectory(errors, siteDirectory, "siteDir");

  if (!addRequiredObject(errors, publication, "publication")) {
    throw new Error(`Invalid publication:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }

  const publicationDirectory = resolveFromRoot(workspaceRoot, publication.directory);
  validateDirectory(errors, publicationDirectory, "publication.directory");

  if (publication.schemaVersion !== 1) {
    errors.push(`schemaVersion: expected 1, received ${JSON.stringify(publication.schemaVersion)}`);
  }
  if (addRequiredString(errors, publication.id, "id") && !/^[a-z0-9][a-z0-9-]*$/.test(publication.id)) {
    errors.push("id: expected a lowercase filesystem-safe publication id");
  }
  if (typeof publication.isDefault !== "boolean") {
    errors.push("isDefault: expected a boolean");
  }
  validateHttpUrl(errors, publication.origin, "origin", { origin: true });

  validateBrand(errors, publication, siteDirectory);
  if (addRequiredObject(errors, publication.institution, "institution")) {
    addRequiredString(errors, publication.institution.name, "institution.name");
    addRequiredString(errors, publication.institution.acronym, "institution.acronym");
  }
  if (addRequiredObject(errors, publication.location, "location")) {
    addRequiredString(errors, publication.location.cityName, "location.cityName");
  }

  validateTheme(errors, publicationDirectory, publication.theme);
  const computedBoundaryBounds = validateTerritory(errors, publication.territory, siteDirectory);
  validateDataset(errors, publication.dataset);
  const pageOutputs = validatePages(errors, publication.pages, templateDirectory, publicationDirectory, siteDirectory);
  validateRedirects(errors, publication.redirects, pageOutputs);

  if (errors.length > 0) {
    const label = isNonEmptyString(publication.id) ? ` ${JSON.stringify(publication.id)}` : "";
    throw new Error(
      `Invalid publication${label} (${errors.length} ${errors.length === 1 ? "error" : "errors"}):\n` +
        errors.map((error) => `  - ${error}`).join("\n")
    );
  }

  return { boundaryBounds: computedBoundaryBounds };
}

module.exports = {
  boundaryBounds,
  validatePublication,
};
