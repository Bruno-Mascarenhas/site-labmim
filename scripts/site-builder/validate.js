"use strict";

const fs = require("fs");
const path = require("path");
const { inspectPublicationThemeCss } = require("./theme-contract");

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

function validateLogo(errors, publicationDirectory, logo, field) {
  if (!addRequiredObject(errors, logo, field)) return;
  const srcPath = validateAsset(errors, publicationDirectory, logo.src, `${field}.src`, { nonEmpty: true });
  let webpPath = null;
  if (logo.webp !== undefined && logo.webp !== null) {
    webpPath = validateAsset(errors, publicationDirectory, logo.webp, `${field}.webp`, { nonEmpty: true });
  }
  for (const dimension of ["width", "height"]) {
    if (!Number.isFinite(logo[dimension]) || logo[dimension] <= 0) {
      errors.push(`${field}.${dimension}: expected a positive number`);
    }
  }
  validateDeclaredImageSize(errors, srcPath, logo.width, logo.height, `${field}.src`);
  validateDeclaredImageSize(errors, webpPath, logo.width, logo.height, `${field}.webp`);
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
        const srcPath = validateAsset(errors, publicationDirectory, affiliation.src, `${field}.src`, {
          nonEmpty: true,
        });
        let webpPath = null;
        if (affiliation.webp !== undefined && affiliation.webp !== null) {
          webpPath = validateAsset(errors, publicationDirectory, affiliation.webp, `${field}.webp`, { nonEmpty: true });
        }
        for (const dimension of ["width", "height"]) {
          if (!Number.isFinite(affiliation[dimension]) || affiliation[dimension] <= 0) {
            errors.push(`${field}.${dimension}: expected a positive number`);
          }
        }
        validateDeclaredImageSize(errors, srcPath, affiliation.width, affiliation.height, `${field}.src`);
        validateDeclaredImageSize(errors, webpPath, affiliation.width, affiliation.height, `${field}.webp`);
      } else if (affiliation.kind === "text") {
        addRequiredString(errors, affiliation.institution, `${field}.institution`);
      } else if (isNonEmptyString(affiliation.kind)) {
        errors.push(`${field}.kind: expected "image" or "text"`);
      }
    });
  }
}

/**
 * Guard against a viewport centre that opens the map somewhere other than the
 * territory — most often a [longitude, latitude] pair written in map order.
 */
function validateViewportCenter(errors, center, bounds, field) {
  if (!Array.isArray(bounds)) return;
  const [[south, west], [north, east]] = bounds;
  const [latitude, longitude] = center;
  const outside =
    latitude < south - VIEWPORT_CENTER_TOLERANCE ||
    latitude > north + VIEWPORT_CENTER_TOLERANCE ||
    longitude < west - VIEWPORT_CENTER_TOLERANCE ||
    longitude > east + VIEWPORT_CENTER_TOLERANCE;
  if (!outside) return;
  const format = (value) => Number(value.toFixed(4));
  errors.push(
    `${field}: [${latitude}, ${longitude}] is more than ${VIEWPORT_CENTER_TOLERANCE}° outside the boundary bounds ` +
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
 * Optional: the station plots the monitoring page renders. Absent means the
 * publication has no station of its own; an empty or malformed list would render
 * an empty section with no other symptom, which is why the shape is checked here.
 */
function validateObservations(errors, siteDirectory, observations) {
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
      // The renderer collapses every non-alphanumeric run when it derives the modal
      // DOM id, so "radiacao-difusa" and "radiacao_difusa" would produce the same id
      // and both cards would open the same modal. Dedupe on the collapsed form.
      const modalKey = chart.id.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (ids.has(modalKey)) {
        errors.push(
          `${field}.id: "${chart.id}" collides with "${ids.get(modalKey)}" once reduced to a modal id; make them distinct beyond -/_`
        );
      } else {
        ids.set(modalKey, chart.id);
      }
    }
    // Station plots are rewritten in place by the laboratory, so a missing file is
    // a deployment state rather than a configuration error — but a path that points
    // outside the output directory never is.
    if (isNonEmptyString(chart.src) && !isSafeRelativeFilePath(chart.src)) {
      errors.push(`${field}.src: expected a safe relative output path`);
    }
    for (const dimension of ["width", "height"]) {
      const value = chart[dimension];
      if (value !== undefined && value !== null && (!Number.isFinite(value) || value <= 0)) {
        errors.push(`${field}.${dimension}: expected a positive number`);
      }
    }
  });
}

/**
 * The monitoring page renders a station-plot section from dataset.observations. A
 * publication that offers the page but declares no observations ships that section
 * with a header and explanation above an empty grid — a silent gap. Require the two
 * to travel together (or neither).
 */
function validateMonitoringHasObservations(errors, publication) {
  if (!Array.isArray(publication.pages)) return;
  const hasMonitoring = publication.pages.some(
    (page) => page && (page.id === "monitoring" || page.file === "monitoring.html")
  );
  if (!hasMonitoring) return;
  const charts = publication.dataset?.observations?.charts;
  if (!Array.isArray(charts) || charts.length === 0) {
    errors.push(
      "dataset.observations: the monitoring page requires at least one chart; declare dataset.observations.charts or drop the monitoring page"
    );
  }
}

function validateDataset(errors, warnings, dataset, siteDirectory) {
  if (!addRequiredObject(errors, dataset, "dataset")) return;
  addRequiredString(errors, dataset.id, "dataset.id");
  addRequiredString(errors, dataset.attribution, "dataset.attribution");

  if (addRequiredObject(errors, dataset.paths, "dataset.paths")) {
    validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.manifest, "dataset.paths.manifest");
    validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.values, "dataset.paths.values", {
      directory: true,
    });
    validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.grids, "dataset.paths.grids", {
      directory: true,
    });
    // Optional: station plots are rewritten in place by each laboratory's weather
    // station and default to assets/graphs (see scripts/build-all.mjs), the one
    // dataset directory that legitimately lives inside the build's assets/ namespace.
    if (dataset.paths.graphs !== undefined && dataset.paths.graphs !== null) {
      validateDatasetPath(errors, warnings, siteDirectory, dataset.paths.graphs, "dataset.paths.graphs", {
        directory: true,
        allowAssets: true,
      });
    }

    const seen = new Map();
    for (const key of ["manifest", "values", "grids", "graphs"]) {
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

  validateObservations(errors, siteDirectory, dataset.observations);

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

    validateRawPageSlots(errors, page, field);
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
  validateDataset(errors, warnings, publication.dataset, siteDirectory);
  validateMonitoringHasObservations(errors, publication);
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
  boundaryBounds,
  validatePublication,
};
