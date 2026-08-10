"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HASHED_VENDOR_ASSETS = new Set(["assets/vendor/bootstrap/bootstrap.purged.min.css"]);

// Published verbatim under site/assets/: the layout is identical on both sides, so a
// page's URL is the path the file already has and nothing gets rewritten.
const PUBLICATION_ASSETS_DIR = "assets";

// Roots the build or the data pipeline owns. Publications may not publish into them, so
// the prune below can wipe the roots they DO own without touching committed data
// (territory outlines under assets/data, station plots under assets/graphs).
const RESERVED_ASSET_ROOTS = new Set(["css", "js", "vendor", "data", "graphs"]);

function collectFiles(directory, prefix = "") {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return collectFiles(path.join(directory, entry.name), relative);
      return entry.isFile() ? [relative] : [];
    });
}

// Two publications may reference the same asset — the labs show each other's mark as a
// partner — but only one may provide it, or build order decides which bytes win.
function publicationAssetSources(publications) {
  const sources = new Map();
  const collisions = [];
  const reserved = [];

  for (const publication of publications) {
    const assetsRoot = path.join(publication.directory, PUBLICATION_ASSETS_DIR);
    if (!fs.existsSync(assetsRoot) || !fs.statSync(assetsRoot).isDirectory()) continue;

    for (const relative of collectFiles(assetsRoot)) {
      const root = relative.split("/", 1)[0];
      if (RESERVED_ASSET_ROOTS.has(root)) {
        reserved.push(`${publication.id}: assets/${relative} lands under the build-owned assets/${root}/`);
        continue;
      }
      const output = path.posix.join("assets", relative);
      const existing = sources.get(output);
      if (existing) {
        collisions.push(`${output}: provided by both ${existing.publicationId} and ${publication.id}`);
        continue;
      }
      sources.set(output, { publicationId: publication.id, absolute: path.join(assetsRoot, relative) });
    }
  }

  const problems = [...reserved.map((item) => `  - ${item}`), ...collisions.map((item) => `  - ${item}`)];
  if (problems.length > 0) {
    throw new Error(
      `Invalid publication assets:\n${problems.join("\n")}\n` +
        `Publication assets must sit outside ${[...RESERVED_ASSET_ROOTS].map((r) => `assets/${r}`).join(", ")}, ` +
        "and every published path must have a single source of truth."
    );
  }
  return sources;
}

function publicationAssetRoots(sources) {
  const roots = new Set();
  for (const output of sources.keys()) roots.add(output.split("/")[1]);
  return roots;
}

// EVERY publication's assets, not just the one being built: the output directory is
// committed, so copying only the selected one would add and delete binaries on each
// `--site` switch. The union is identical for every `--site` and therefore drift-free;
// scripts/build-all.mjs narrows each bundle down again. Owned roots are wiped first so a
// renamed or removed source asset cannot linger and ship in every bundle.
function writePublicationAssets(publications, outputDir) {
  const sources = publicationAssetSources(publications);
  for (const root of publicationAssetRoots(sources)) {
    fs.rmSync(path.join(outputDir, "assets", root), { recursive: true, force: true });
  }
  for (const [output, source] of sources) {
    const destination = path.join(outputDir, ...output.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source.absolute, destination);
  }
  return sources;
}

function writePublicationTheme(publication, outputDir) {
  const source = path.join(publication.directory, publication.theme);
  const destination = path.join(outputDir, "assets", "css", "site-theme.css");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return "assets/css/site-theme.css";
}

function createAssetPipeline(outputDir) {
  const cache = new Map();

  function assetHash(relativePath) {
    if (!cache.has(relativePath)) {
      const content = fs.readFileSync(path.join(outputDir, relativePath));
      cache.set(relativePath, crypto.createHash("md5").update(content).digest("hex").slice(0, 8));
    }
    return cache.get(relativePath);
  }

  function workerHashes() {
    const workersDir = path.join(outputDir, "assets", "js", "workers");
    if (!fs.existsSync(workersDir)) return "";
    return fs
      .readdirSync(workersDir)
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map((name) => `${name}:${assetHash(path.posix.join("assets/js/workers", name))}`)
      .join(";");
  }

  function stampAssetVersions(html) {
    return html.replace(
      /(href|src)="(\/)?(assets\/[^"?]+)(\?v=[^"]*)?"/g,
      (match, attributeName, rootPrefix = "", relativePath) => {
        const firstParty = /^assets\/(?:css|js)\//.test(relativePath);
        if (!firstParty && !HASHED_VENDOR_ASSETS.has(relativePath)) return match;
        return `${attributeName}="${rootPrefix}${relativePath}?v=${assetHash(relativePath)}"`;
      }
    );
  }

  return { assetHash, stampAssetVersions, workerHashes };
}

module.exports = { createAssetPipeline, publicationAssetSources, writePublicationAssets, writePublicationTheme };
