"use strict";

const fs = require("fs");
const path = require("path");

function publicationLabel(publication, fallback = "<unknown>") {
  return publication && typeof publication.id === "string" && publication.id ? publication.id : fallback;
}

function normalizeOrigin(origin) {
  if (typeof origin !== "string") return origin;
  try {
    const url = new URL(origin);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return origin.toLowerCase();
  }
}

/**
 * Discover publication manifests in src/sites/<id>/site.js.
 *
 * The filesystem is the registry: adding a valid directory is enough for the
 * build and CI to see it. Manifests are returned in stable id order and carry
 * their absolute source directory in `directory`.
 */
function discoverPublications(root) {
  const workspaceRoot = path.resolve(root || process.cwd());
  const sitesRoot = path.join(workspaceRoot, "src", "sites");

  if (!fs.existsSync(sitesRoot)) {
    throw new Error(`Publication directory does not exist: ${sitesRoot}`);
  }
  if (!fs.statSync(sitesRoot).isDirectory()) {
    throw new Error(`Publication path is not a directory: ${sitesRoot}`);
  }

  const errors = [];
  const publications = [];

  const directories = fs
    .readdirSync(sitesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of directories) {
    const directory = path.join(sitesRoot, entry.name);
    const manifestPath = path.join(directory, "site.js");
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) continue;

    let loaded;
    try {
      const resolvedManifest = require.resolve(manifestPath);
      delete require.cache[resolvedManifest];
      loaded = require(resolvedManifest);
    } catch (error) {
      errors.push(`${entry.name}: could not load ${manifestPath}: ${error.message}`);
      continue;
    }

    const publication =
      loaded && typeof loaded === "object" && loaded.default && typeof loaded.default === "object"
        ? loaded.default
        : loaded;

    if (!publication || typeof publication !== "object" || Array.isArray(publication)) {
      errors.push(`${entry.name}: site.js must export a publication object`);
      continue;
    }
    if (publication.id !== entry.name) {
      errors.push(
        `${entry.name}: publication id must match its directory name (received ${JSON.stringify(publication.id)})`
      );
    }
    if (typeof publication.origin !== "string" || publication.origin.trim() === "") {
      errors.push(`${entry.name}: publication origin must be a non-empty string`);
    }
    if (typeof publication.isDefault !== "boolean") {
      errors.push(`${entry.name}: publication isDefault must be a boolean`);
    }

    publications.push({ ...publication, directory });
  }

  if (publications.length === 0) {
    errors.push(`no publication manifests found under ${sitesRoot}`);
  }

  const ids = new Map();
  const origins = new Map();
  for (const publication of publications) {
    const label = publicationLabel(publication);
    if (typeof publication.id === "string" && publication.id) {
      if (ids.has(publication.id)) {
        errors.push(`${label}: duplicate publication id (also used by ${ids.get(publication.id)})`);
      } else {
        ids.set(publication.id, label);
      }
    }

    if (typeof publication.origin === "string" && publication.origin.trim()) {
      const origin = normalizeOrigin(publication.origin.trim());
      if (origins.has(origin)) {
        errors.push(`${label}: duplicate publication origin (also used by ${origins.get(origin)})`);
      } else {
        origins.set(origin, label);
      }
    }
  }

  const defaults = publications.filter((publication) => publication.isDefault === true);
  if (defaults.length !== 1) {
    const found = defaults.length ? defaults.map((publication) => publicationLabel(publication)).join(", ") : "none";
    errors.push(`expected exactly one default publication; found ${defaults.length} (${found})`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid publication registry:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }

  return publications.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function defaultPublication(publications) {
  if (!Array.isArray(publications)) {
    throw new TypeError("publications must be an array");
  }
  const defaults = publications.filter((publication) => publication?.isDefault === true);
  if (defaults.length !== 1) {
    throw new Error(`Expected exactly one default publication, found ${defaults.length}`);
  }
  return defaults[0];
}

function selectPublication(publications, id) {
  if (!Array.isArray(publications)) {
    throw new TypeError("publications must be an array");
  }
  if (id === undefined || id === null || id === "") return defaultPublication(publications);

  const publication = publications.find((candidate) => candidate?.id === id);
  if (publication) return publication;

  const available = publications
    .map((candidate) => publicationLabel(candidate))
    .sort((left, right) => left.localeCompare(right, "en"));
  throw new Error(
    `Unknown publication ${JSON.stringify(id)}. Available publications: ${available.join(", ") || "none"}`
  );
}

module.exports = {
  defaultPublication,
  discoverPublications,
  selectPublication,
};
