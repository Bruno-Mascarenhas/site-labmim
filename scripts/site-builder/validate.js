"use strict";

const fs = require("fs");
const path = require("path");
const { inspectPublicationThemeCss } = require("./theme-contract");
const { observationModalId, DEFAULT_MODEL } = require("./renderer");
const { DEFAULT_GRAPHS_DIRECTORY } = require("./operational-paths");
const { closestKey, LAYOUT_CONTRACTS } = require("../../src/template/page-types");

const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const GEOJSON_CODE_PROPERTIES = ["SIGLA", "sigla", "UF", "uf", "stateCode", "code", "PK_sigla"];

// Output names owned by buildStaticFiles(). A page claiming one of them would be
// written and then silently overwritten while still being listed in the sitemap.
const RESERVED_PAGE_OUTPUTS = new Set(["404.html", ".htaccess", "sitemap.xml", "robots.txt"]);

// Redirects are interpolated verbatim into an Apache `Redirect <status> <from> <to>`
// directive, so only an allowlist is safe: whitespace would add a fourth argument to a
// TAKE23 directive (HTTP 500 for the whole directory), a newline would inject an
// arbitrary directive, and a bare "/" would prefix-match every request.
const SAFE_REDIRECT_PATH = /^\/[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~%-]+)*$/;

// `{{bodyAttrs}}` lands unescaped inside `<body{{bodyAttrs}}>`: accept only a run of
// space-separated `name="value"` pairs with no quote/tag/entity characters in the value.
// The attribute name is an allowlist, not a shape: `[a-z-]+` would happily match
// `onload`, so a page definition could attach an event handler to every rendered body.
const SAFE_BODY_ATTR_NAME = /^(?:data-[a-z][a-z0-9-]*|class|id|lang|dir|itemscope|itemtype)$/;
const SAFE_BODY_ATTRS = /^(?: [a-z][a-z0-9-]*="[^"<>&]*")+$/;
const BODY_ATTR_PAIR = / ([a-z][a-z0-9-]*)="([^"<>&]*)"/g;

function unsafeBodyAttrNames(value) {
  return [...value.matchAll(BODY_ATTR_PAIR)].map(([, name]) => name).filter((name) => !SAFE_BODY_ATTR_NAME.test(name));
}

// A legitimate viewport centre may sit slightly outside the boundary polygon, but a
// swapped [longitude, latitude] pair lands far away. Degrees.
const VIEWPORT_CENTER_TOLERANCE = 2;

// Same guard for each domain centre, which the map uses as the flyTo target when the
// user switches domains, with far more slack: the outer domains are synoptic, so one of
// them may legitimately be centred far from the state. The slack does not police the
// framing — it only catches a swapped pair, which lands whole tens of degrees away.
// Degrees.
const DOMAIN_CENTER_TOLERANCE = 15;

// Declared logo width/height only have to reproduce the intrinsic aspect ratio: the
// browser uses them to reserve the box, and publications legitimately declare a scaled
// pair for a shared source file. Relative tolerance on the ratio.
const IMAGE_ASPECT_TOLERANCE = 0.02;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  const latitudeValid = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
  const longitudeValid = Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (!latitudeValid) {
    errors.push(`${field}[0]: latitude must be a finite number between -90 and 90`);
  }
  if (!longitudeValid) {
    errors.push(`${field}[1]: longitude must be a finite number between -180 and 180`);
  }
  return latitudeValid && longitudeValid;
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

function validateAsset(errors, base, value, field, options = {}) {
  return validateConfinedFile(errors, base, value, field, options);
}

function validateTheme(errors, publicationDirectory, value) {
  const themePath = validateConfinedFile(errors, publicationDirectory, value, "theme", { nonEmpty: true });
  if (!themePath) return;
  const content = fs.readFileSync(themePath, "utf8");
  for (const error of inspectPublicationThemeCss(content)) {
    errors.push(`theme: ${error}`);
  }
}

/**
 * Intrinsic pixel size of a raster asset, or null when the format is not one this
 * build understands (SVG, GIF, JPEG, ...). Only the file header is inspected.
 */
function readImageSize(filePath) {
  let header;
  try {
    header = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  if (header.length < 32) return null;

  if (header.subarray(0, 8).equals(PNG_SIGNATURE) && header.subarray(12, 16).toString("latin1") === "IHDR") {
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  }

  if (header.subarray(0, 4).toString("latin1") === "RIFF" && header.subarray(8, 12).toString("latin1") === "WEBP") {
    const chunk = header.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") {
      return { width: header.readUIntLE(24, 3) + 1, height: header.readUIntLE(27, 3) + 1 };
    }
    if (chunk === "VP8L" && header[20] === 0x2f) {
      const bits = header.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && header[23] === 0x9d && header[24] === 0x01 && header[25] === 0x2a) {
      return { width: header.readUInt16LE(26) & 0x3fff, height: header.readUInt16LE(28) & 0x3fff };
    }
  }

  return null;
}

function validateDeclaredImageSize(errors, filePath, width, height, field) {
  if (!filePath) return;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return;
  const size = readImageSize(filePath);
  if (!size || !(size.width > 0) || !(size.height > 0)) {
    // A declared PNG/WebP the header parser cannot read is truncated or corrupt —
    // exactly the broken image the dimension check exists to catch. Other formats
    // (SVG, GIF, JPEG) have no header parser here and are legitimately skipped.
    if (/\.(png|webp)$/i.test(filePath)) {
      errors.push(
        `${field}: ${path.basename(filePath)} is declared PNG/WebP but its header could not be read (truncated or corrupt)`
      );
    }
    return;
  }

  const declaredRatio = width / height;
  const intrinsicRatio = size.width / size.height;
  if (Math.abs(declaredRatio - intrinsicRatio) > intrinsicRatio * IMAGE_ASPECT_TOLERANCE) {
    errors.push(
      `${field}: declared ${width}x${height} does not match the ${size.width}x${size.height} intrinsic size of ` +
        `${path.basename(filePath)}; the aspect ratio must be preserved or the published page shifts on load`
    );
  }
}

// Shared contract for a declared raster asset (logo or image affiliation): a
// non-empty src, an optional non-empty webp companion, positive declared width and
// height, and both files' intrinsic aspect ratio matching the declaration. Resolved
// against the publication's own module directory (see validateBrand).
function validateImageAsset(errors, publicationDirectory, spec, field) {
  const srcPath = validateAsset(errors, publicationDirectory, spec.src, `${field}.src`, { nonEmpty: true });
  let webpPath = null;
  if (spec.webp !== undefined && spec.webp !== null) {
    webpPath = validateAsset(errors, publicationDirectory, spec.webp, `${field}.webp`, { nonEmpty: true });
  }
  for (const dimension of ["width", "height"]) {
    if (!Number.isFinite(spec[dimension]) || spec[dimension] <= 0) {
      errors.push(`${field}.${dimension}: expected a positive number`);
    }
  }
  validateDeclaredImageSize(errors, srcPath, spec.width, spec.height, `${field}.src`);
  validateDeclaredImageSize(errors, webpPath, spec.width, spec.height, `${field}.webp`);
}

function validateLogo(errors, publicationDirectory, logo, field) {
  if (!addRequiredObject(errors, logo, field)) return;
  validateImageAsset(errors, publicationDirectory, logo, field);
}

// Brand assets are validated against the publication's OWN module directory, not
// the merged site/ output where writePublicationAssets has already published every
// publication's assets. Resolving against the module means declaring a neighbour's
// file as your own logo fails: a site's identity must be provided by its own module.
// (A partner mark shown in page content is a page reference, not a brand asset, and
// is validated separately against the shared output.)
function validateBrand(errors, publication, publicationDirectory) {
  if (!addRequiredObject(errors, publication.brand, "brand")) return;
  const brand = publication.brand;
  for (const field of ["name", "fullName", "copyrightName"]) {
    addRequiredString(errors, brand[field], `brand.${field}`);
  }
  validateAsset(errors, publicationDirectory, brand.ogImage, "brand.ogImage", { nonEmpty: true });

  if (addRequiredObject(errors, brand.logos, "brand.logos")) {
    for (const role of ["nav", "footer", "sidebar"]) {
      validateLogo(errors, publicationDirectory, brand.logos[role], `brand.logos.${role}`);
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
        validateImageAsset(errors, publicationDirectory, affiliation, field);
      } else if (affiliation.kind === "text") {
        addRequiredString(errors, affiliation.institution, `${field}.institution`);
      } else if (isNonEmptyString(affiliation.kind)) {
        errors.push(`${field}.kind: expected "image" or "text"`);
      }
    });
  }
}

/**
 * Guard against a centre that opens the map somewhere other than the territory —
 * most often a [longitude, latitude] pair written in map order. Shared by the
 * territory viewport and by each domain centre, which use different tolerances.
 */
function validateViewportCenter(errors, center, bounds, field, tolerance = VIEWPORT_CENTER_TOLERANCE) {
  if (!Array.isArray(bounds)) return;
  const [[south, west], [north, east]] = bounds;
  const [latitude, longitude] = center;
  const outside =
    latitude < south - tolerance ||
    latitude > north + tolerance ||
    longitude < west - tolerance ||
    longitude > east + tolerance;
  if (!outside) return;
  const format = (value) => Number(value.toFixed(4));
  errors.push(
    `${field}: [${latitude}, ${longitude}] is more than ${tolerance}° outside the boundary bounds ` +
      `[[${format(south)}, ${format(west)}], [${format(north)}, ${format(east)}]]; expected [latitude, longitude]`
  );
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
    let parsed = false;
    try {
      geojson = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
      parsed = true;
    } catch (error) {
      errors.push(`territory.boundaryAsset: invalid JSON: ${error.message}`);
    }
    // Gate on parse success, not truthiness: a boundary that parses to null/false/0 is
    // not a FeatureCollection and must be reported, which a truthiness check would skip.
    if (parsed) {
      bounds = inspectBoundaryGeoJson(geojson, territory.code, errors, "territory.boundaryAsset");
    }
  }

  if (addRequiredObject(errors, territory.viewport, "territory.viewport")) {
    const viewport = territory.viewport;
    if (validateCoordinate(errors, viewport.center, "territory.viewport.center")) {
      validateViewportCenter(errors, viewport.center, bounds, "territory.viewport.center");
    }
    validateZoom(errors, viewport.zoom, "territory.viewport.zoom");
    if (typeof viewport.fitBoundary !== "boolean") {
      errors.push("territory.viewport.fitBoundary: expected a boolean");
    }
    validateZoom(errors, viewport.fitMaxZoom, "territory.viewport.fitMaxZoom");
  }

  return bounds;
}

function validateDatasetPath(
  errors,
  warnings,
  siteDirectory,
  value,
  field,
  { directory = false, allowAssets = false } = {}
) {
  if (!addRequiredString(errors, value, field)) return;
  if (!isSafeRelativeFilePath(value)) {
    errors.push(`${field}: expected a safe relative output path`);
    return;
  }
  if (/[{}]/.test(value)) {
    errors.push(`${field}: expected a concrete path, not a placeholder pattern`);
  }
  if (directory && (value.endsWith("/") || path.posix.extname(value))) {
    errors.push(`${field}: expected a relative base directory without trailing slash`);
  }

  // Model output (values, grids, manifest) is written by the external pipeline into its
  // own top-level directories; assets/ is the build's namespace. Station plots are the
  // documented exception: they are published under assets/graphs by the laboratories.
  const normalized = path.posix.normalize(value);
  if (!allowAssets && (normalized === "assets" || normalized.startsWith("assets/"))) {
    errors.push(`${field}: dataset artifacts must not live under assets/, which the build owns`);
  }

  if (!isNonEmptyString(siteDirectory)) return;
  const resolved = path.resolve(siteDirectory, value);
  if (!pathIsInside(siteDirectory, resolved)) {
    errors.push(`${field}: path escapes the site output directory`);
    return;
  }
  // The runtime data artifacts are produced by a separate pipeline and are gitignored,
  // so a missing directory is normal in CI and must never fail the build. Only a path
  // that exists and is the wrong kind of node, or that resolves outside site/, is fatal.
  if (!directory) return;
  if (!fs.existsSync(resolved)) {
    warnings.push(`${field}: ${resolved} does not exist yet; the data pipeline has not published this directory`);
    return;
  }
  if (!fs.statSync(resolved).isDirectory()) {
    errors.push(`${field}: path is not a directory: ${resolved}`);
    return;
  }
  if (!realPathIsInside(siteDirectory, resolved)) {
    errors.push(`${field}: resolved directory escapes the site output directory`);
  }
}

/**
 * A FILE inside the directory: not the directory itself, and not a path with an empty
 * segment. The value goes straight into the `src` of the card and modal `<img>`, and
 * `fs.existsSync` of a directory is true — no downstream gate would notice the dead
 * image.
 */
function isFileUnder(value, directoryPrefix) {
  return value.startsWith(directoryPrefix) && value.slice(directoryPrefix.length).split("/").every(Boolean);
}

/**
 * Optional: the station plots the monitoring page renders. Absent means the
 * publication has no station of its own; an empty or malformed list would render
 * an empty section with no other symptom, which is why the shape is checked here.
 */
function validateObservations(errors, observations, graphsDirectory) {
  if (observations === undefined || observations === null) return;
  if (!addRequiredObject(errors, observations, "dataset.observations")) return;

  if (!Array.isArray(observations.charts)) {
    errors.push("dataset.observations.charts: expected an array");
    return;
  }
  if (observations.charts.length === 0) {
    errors.push("dataset.observations.charts: must not be empty; omit dataset.observations instead");
    return;
  }

  const graphsPrefix = `${graphsDirectory}/`;
  const ids = new Map();
  observations.charts.forEach((chart, index) => {
    const field = `dataset.observations.charts[${index}]`;
    if (!addRequiredObject(errors, chart, field)) return;
    for (const key of ["id", "title", "src"]) {
      addRequiredString(errors, chart[key], `${field}.${key}`);
    }
    if (isNonEmptyString(chart.id)) {
      // The id becomes the modal's HTML id and the aria-controls that points at it,
      // so it must start with a letter and carry no whitespace. Underscores are fine.
      if (!/^[a-z][a-z0-9_-]*$/.test(chart.id)) {
        errors.push(`${field}.id: expected a lowercase slug (letters, digits, "-" or "_") starting with a letter`);
      }
      // Dedupe on the exact DOM id the renderer will emit: "ab-cd" and "ab_cd" both
      // become modalAbCd (a real collision), while "ab-cd" and "abc-d" stay distinct.
      const modalId = observationModalId(chart.id);
      if (ids.has(modalId)) {
        errors.push(
          `${field}.id: "${chart.id}" collides with "${ids.get(modalId)}" — both render as <${modalId}>; make them distinct`
        );
      } else {
        ids.set(modalId, chart.id);
      }
    }
    // Station plots are rewritten in place by the laboratory, so a missing file is a
    // deployment state rather than a configuration error — but the path must be safe
    // AND under dataset.paths.graphs, the directory build-all excludes from other
    // publications' bundles. Otherwise a lab reusing another's chart list would ship
    // the neighbour's watermarked plots (paths.graphs would exclude the wrong dir).
    if (isNonEmptyString(chart.src)) {
      if (!isSafeRelativeFilePath(chart.src)) {
        errors.push(`${field}.src: expected a safe relative output path`);
      } else if (!isFileUnder(chart.src, graphsPrefix)) {
        errors.push(`${field}.src: must be a file under dataset.paths.graphs (${graphsDirectory}/), not ${chart.src}`);
      }
    }
    for (const dimension of ["width", "height"]) {
      const value = chart[dimension];
      if (value !== undefined && value !== null && (!Number.isFinite(value) || value <= 0)) {
        errors.push(`${field}.${dimension}: expected a positive number`);
      }
    }
  });
}

const LIVE_MONITORING_TEMPLATE = "pages/monitoring-live.html";

/**
 * Compares the resolved FILE, not the configured string: `pages//monitoring-live.html`
 * passes `isSafeRelativeFilePath` and opens the same file (`path.resolve` collapses the
 * double slash), but a textual equality would push it down the static branch — the
 * interactive page would ship without a data directory, or the publication would be
 * told to declare station PNGs on a page that only draws JSON.
 */
function isLiveMonitoring(page, templateDirectory, publicationDirectory) {
  const source = page?.source;
  if (!isObject(source) || !isNonEmptyString(source.path) || !isNonEmptyString(templateDirectory)) return false;
  const base = source.scope === "template" ? templateDirectory : publicationDirectory;
  if (!isNonEmptyString(base)) return false;
  return path.resolve(base, source.path) === path.resolve(templateDirectory, LIVE_MONITORING_TEMPLATE);
}

/**
 * The `monitoring.html` route has two implementations, each depending on a different
 * data source:
 *
 * - `pages/monitoring.html` (static) draws the PNGs listed in `dataset.observations`;
 * - `pages/monitoring-live.html` (interactive) fetches the hourly payload from
 *   `dataset.paths.monitoring`.
 *
 * Requiring the wrong source is worse than requiring nothing: the static publication
 * would be refused for not declaring a directory it does not use, and the interactive
 * one would pass without the directory it depends on, shipping an empty page whose only
 * symptom is a console 404. That is why the check looks at which template the page
 * resolved to, not at the route id — which is `monitoring` in both cases.
 */
function validateMonitoringHasData(errors, publication, templateDirectory, publicationDirectory) {
  if (!Array.isArray(publication.pages)) return;
  const monitoring = publication.pages.find(
    (page) => page && (page.id === "monitoring" || page.file === "monitoring.html")
  );
  if (!monitoring) return;

  if (isLiveMonitoring(monitoring, templateDirectory, publicationDirectory)) {
    if (!isNonEmptyString(publication.dataset?.paths?.monitoring)) {
      errors.push(
        "dataset.paths.monitoring: the interactive monitoring page requires a data directory; declare it or use the static pages/monitoring.html source"
      );
    }
    return;
  }

  const charts = publication.dataset?.observations?.charts;
  if (!Array.isArray(charts) || charts.length === 0) {
    errors.push(
      "dataset.observations: the static monitoring page requires at least one chart; declare dataset.observations.charts or drop the monitoring page"
    );
  }
}

/**
 * The climatology page fetches its histograms from `dataset.paths.climatology`.
 * A publication that offers the page without declaring the directory ships a
 * permanently empty page whose only symptom is a console 404, so require the two
 * to travel together — the same contract `validateMonitoringHasData`
 * enforces between the monitoring page and its station plots.
 */
function validateClimatologyHasData(errors, publication) {
  if (!Array.isArray(publication.pages)) return;
  const hasClimatology = publication.pages.some(
    (page) => page && (page.id === "climatology" || page.file === "climatologia.html")
  );
  if (!hasClimatology) return;
  if (!isNonEmptyString(publication.dataset?.paths?.climatology)) {
    errors.push(
      "dataset.paths.climatology: the climatology page requires a data directory; declare it or drop the page"
    );
  }
}

/**
 * Optional: the WRF namelist block. Every field carries the citation of the scheme it
 * names, and the renderer layers the block over DEFAULT_MODEL — so an unknown key is
 * inert rather than noisy: the page keeps publishing the default scheme and crediting
 * its paper, which is exactly the failure the block exists to prevent. Hence the closed
 * key list, with the same typo suggestion `page()` gives for its options.
 *
 * The value of a known field is required for the same reason: an empty string publishes
 * an empty parenthesis where the scheme belongs, and an explicit `undefined` wipes the
 * default (the renderer's spread copies it) and would publish the word "undefined".
 */
function validateModel(errors, model) {
  if (model === undefined || model === null) return;
  if (!addRequiredObject(errors, model, "dataset.model")) return;
  const fields = Object.keys(DEFAULT_MODEL);
  for (const key of Object.keys(model)) {
    if (fields.includes(key)) {
      addRequiredString(errors, model[key], `dataset.model.${key}`);
      continue;
    }
    const suggestion = closestKey(key, fields);
    errors.push(
      `dataset.model.${key}: unknown field${suggestion ? `; did you mean "${suggestion}"?` : "."} ` +
        `Valid fields: ${fields.join(", ")}`
    );
  }
}

function validateDataset(errors, warnings, dataset, siteDirectory, boundaryBounds) {
  if (!addRequiredObject(errors, dataset, "dataset")) return;
  addRequiredString(errors, dataset.id, "dataset.id");
  addRequiredString(errors, dataset.attribution, "dataset.attribution");
  // Optional: the name of the CLI that generates the data. The renderer falls back with
  // `??`, which does not catch an empty string — declared that way, the documentation
  // would publish an empty <code> where the pipeline name belongs.
  if (dataset.generator !== undefined && dataset.generator !== null) {
    addRequiredString(errors, dataset.generator, "dataset.generator");
  }
  validateModel(errors, dataset.model);

  if (addRequiredObject(errors, dataset.paths, "dataset.paths")) {
    validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.manifest, "dataset.paths.manifest");
    validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.values, "dataset.paths.values", {
      directory: true,
    });
    validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.grids, "dataset.paths.grids", {
      directory: true,
    });
    // Optional: station plots are rewritten in place by each laboratory's weather
    // station and default to assets/graphs (see site-builder/operational-paths.js), the
    // one dataset directory that legitimately lives inside the build's assets/ namespace.
    if (dataset.paths.graphs !== undefined && dataset.paths.graphs !== null) {
      validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.graphs, "dataset.paths.graphs", {
        directory: true,
        allowAssets: true,
      });
    }
    // Optional: the precomputed observed-distribution artifacts the climatology
    // page reads. Derived from the laboratory's own sensor archive, which is not
    // public — so, like the model output, it is deploy-supplied and gitignored
    // rather than committed alongside the pages.
    if (dataset.paths.climatology !== undefined && dataset.paths.climatology !== null) {
      validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.climatology, "dataset.paths.climatology", {
        directory: true,
      });
    }
    // Optional, and operational for the same reason: the rolling seven-day window
    // the interactive monitoring page draws, rewritten hourly by the deploy from
    // the same non-public sensor archive.
    if (dataset.paths.monitoring !== undefined && dataset.paths.monitoring !== null) {
      validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.monitoring, "dataset.paths.monitoring", {
        directory: true,
      });
    }

    const seen = new Map();
    for (const key of ["manifest", "values", "grids", "graphs", "climatology", "monitoring"]) {
      const value = dataset.paths[key];
      if (!isNonEmptyString(value)) continue;
      const normalized = path.posix.normalize(value);
      if (seen.has(normalized)) {
        errors.push(`dataset.paths.${key}: must differ from dataset.paths.${seen.get(normalized)}`);
      } else {
        seen.set(normalized, key);
      }
    }
  }

  validateObservations(errors, dataset.observations, dataset.paths?.graphs ?? DEFAULT_GRAPHS_DIRECTORY);

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
    // The domain centre is not decorative: map-manager.js flies to it when the user
    // switches domains, so a swapped pair takes the map somewhere else entirely.
    if (validateCoordinate(errors, domain.center, `${field}.center`)) {
      validateViewportCenter(errors, domain.center, boundaryBounds, `${field}.center`, DOMAIN_CENTER_TOLERANCE);
    }
    validateZoom(errors, domain.zoom, `${field}.zoom`);
    if (typeof domain.cumulusParameterized !== "boolean") {
      errors.push(`${field}.cumulusParameterized: expected a boolean`);
    }
  });

  if (isNonEmptyString(dataset.defaultDomain) && !domainIds.has(dataset.defaultDomain)) {
    errors.push(`dataset.defaultDomain: no matching domain with id ${dataset.defaultDomain}`);
  }

  // The WebGIS documentation contrasts the coarse (cumulus-parameterized) domains
  // against the fine (convection-resolving) ones. If every domain shares the same
  // value one side of that sentence renders empty; warn rather than fail, since a
  // uniform grid is a legitimate (if undocumented) dataset choice.
  if (Array.isArray(dataset.domains) && dataset.domains.length > 0) {
    const flags = dataset.domains.map((domain) => domain?.cumulusParameterized === true);
    if (flags.every(Boolean) || !flags.some(Boolean)) {
      warnings.push(
        "dataset.domains: every domain has the same cumulusParameterized value; the WebGIS cumulus sentence will list one side as empty"
      );
    }
  }
}

function validatePageOutputPath(errors, value, field) {
  if (!addRequiredString(errors, value, field)) return false;
  if (!isSafeRelativeFilePath(value) || !value.endsWith(".html") || value.includes("/")) {
    errors.push(`${field}: expected a root-level .html filename without directories`);
    return false;
  }
  if (RESERVED_PAGE_OUTPUTS.has(value)) {
    errors.push(
      `${field}: ${value} is reserved by the static-file step; a page written there is overwritten but still indexed`
    );
    return false;
  }
  return true;
}

/**
 * `bodyAttrs`, `kicker` and `docModalTitle` are the only layout slots the renderer
 * interpolates without escaping, so their shape is constrained here.
 */
function validateRawPageSlots(errors, page, field) {
  if (page.bodyAttrs !== undefined && page.bodyAttrs !== null && page.bodyAttrs !== "") {
    if (typeof page.bodyAttrs !== "string") {
      errors.push(`${field}.bodyAttrs: expected a string`);
    } else if (!SAFE_BODY_ATTRS.test(page.bodyAttrs)) {
      errors.push(`${field}.bodyAttrs: expected a run of ' name="value"' HTML attributes, each starting with a space`);
    } else {
      const rejected = unsafeBodyAttrNames(page.bodyAttrs);
      if (rejected.length > 0) {
        errors.push(
          `${field}.bodyAttrs: attribute ${rejected.map((name) => `"${name}"`).join(", ")} is not allowed on <body>; ` +
            "use data-* (or class, id, lang, dir, itemscope, itemtype)"
        );
      }
    }
  }

  for (const slot of ["kicker", "docModalTitle"]) {
    const value = page[slot];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      errors.push(`${field}.${slot}: expected a string`);
    } else if (/[<>]/.test(value)) {
      // The renderer escapes both slots, so this is defence in depth rather than the
      // only guard: markup here is always an authoring mistake, never an intent.
      errors.push(`${field}.${slot}: expected plain text without < or >`);
    }
  }
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

/**
 * Re-asserts the layout contract on the ALREADY RESOLVED page. `page()` applies the
 * same contract at authoring time, but only there: a pages.js that builds or
 * post-processes raw objects (`BASE.map((p) => ({ ...p, seo }))`) hands the build a
 * webgis page with no `data-map-context`, and the map silently falls back to the
 * "forecast" context — with the wrong variable set on the potentials page. This is the
 * gate the final manifest passes through, so the check lives here too.
 */
function validateLayoutContract(errors, page, field) {
  if (!isNonEmptyString(page.layout)) return;
  if (!Object.prototype.hasOwnProperty.call(LAYOUT_CONTRACTS, page.layout)) return;
  for (const [slot, rule] of Object.entries(LAYOUT_CONTRACTS[page.layout].required ?? {})) {
    if (!rule.test(page[slot])) {
      errors.push(`${field}.${slot}: required by the "${page.layout}" layout: expected ${rule.expectation}`);
    }
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

/**
 * Page scripts are always already-published paths under site/assets/, never
 * `src/**` sources: site/assets/js/ is versioned source rather than build output,
 * so unlike page CSS there is nothing to copy into a generated/ tree. First-party
 * entries are content-hashed by the build (assets.js stampAssetVersions), which
 * is why they must NOT carry a hand-written `?v=` — vendor entries may, because
 * the stamper deliberately leaves assets/vendor/ alone.
 */
function validatePageScripts(errors, scripts, field, siteDirectory, { vendor = false } = {}) {
  if (!Array.isArray(scripts)) {
    errors.push(`${field}: expected an array`);
    return;
  }

  const seen = new Set();
  scripts.forEach((script, index) => {
    const scriptField = `${field}[${index}]`;
    if (!addRequiredString(errors, script, scriptField)) return;

    const [assetPath, suffix = ""] = script.split(/(?=[?#])/, 2);
    const expectedRoot = vendor ? "assets/vendor/" : "assets/js/";
    if (!assetPath.startsWith(expectedRoot) || !assetPath.endsWith(".js")) {
      errors.push(`${scriptField}: expected a JavaScript asset below ${expectedRoot}`);
      return;
    }
    if (vendor ? suffix && !/^\?v=[A-Za-z0-9._-]+$/.test(suffix) : suffix) {
      errors.push(
        `${scriptField}: ${vendor ? "expected only an optional ?v=<version> suffix" : "first-party JavaScript is versioned by the build"}`
      );
      return;
    }

    validateConfinedFile(errors, siteDirectory, assetPath, scriptField, { nonEmpty: true });
    if (seen.has(script)) errors.push(`${scriptField}: duplicate script ${script}`);
    seen.add(script);
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

    validateRawPageSlots(errors, page, field);
    validateLayout(errors, page.layout, templateDirectory, `${field}.layout`);
    validateLayoutContract(errors, page, field);
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
    validatePageScripts(errors, page.vendorScripts, `${field}.vendorScripts`, siteDirectory, { vendor: true });
    validatePageScripts(errors, page.scripts, `${field}.scripts`, siteDirectory);

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
  if (typeof value !== "string" || !SAFE_REDIRECT_PATH.test(value)) return false;

  // The allowlist admits percent-escapes; make sure none of them decodes into a
  // traversal segment, an extra separator, or whitespace that would split the directive.
  const segments = decodedPathSegments(value);
  if (!segments) return false;
  return segments.every((segment, index) =>
    index === 0 ? segment === "" : segment !== "." && segment !== ".." && /^[A-Za-z0-9._~-]+$/.test(segment)
  );
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
      const shadowed = redirectTargetOutput(redirect.from);
      if (pageOutputs.has(shadowed)) {
        errors.push(`${field}.from: would shadow the page published at ${shadowed}`);
      }
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
      if (
        addRequiredString(errors, redirect.hash, `${field}.hash`) &&
        !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(redirect.hash)
      ) {
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
  const warnings = [];
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

  validateBrand(errors, publication, publicationDirectory);
  if (addRequiredObject(errors, publication.institution, "institution")) {
    addRequiredString(errors, publication.institution.name, "institution.name");
    addRequiredString(errors, publication.institution.acronym, "institution.acronym");
  }
  if (addRequiredObject(errors, publication.location, "location")) {
    addRequiredString(errors, publication.location.cityName, "location.cityName");
  }

  validateTheme(errors, publicationDirectory, publication.theme);
  const computedBoundaryBounds = validateTerritory(errors, publication.territory, siteDirectory);
  validateDataset(errors, warnings, publication.dataset, siteDirectory, computedBoundaryBounds);
  validateMonitoringHasData(errors, publication, templateDirectory, publicationDirectory);
  validateClimatologyHasData(errors, publication);
  const pageOutputs = validatePages(errors, publication.pages, templateDirectory, publicationDirectory, siteDirectory);
  validateRedirects(errors, publication.redirects, pageOutputs);

  for (const warning of warnings) {
    console.warn(`validate: warning: ${warning}`);
  }

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
  validatePublication,
};
