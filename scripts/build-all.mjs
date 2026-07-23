#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { defaultPublication, discoverPublications } = require("./site-builder/publications.js");
const { publicationAssetSources } = require("./site-builder/assets.js");
const publications = discoverPublications(root);
const providedAssets = new Set(publicationAssetSources(publications).keys());
const defaultSite = defaultPublication(publications);
const siteDir = path.join(root, "site");
const distDir = path.join(root, "dist");

// Station plots are rewritten in place by each laboratory's own weather station
// (same file names, served with no-cache). They are committed for the default
// publication only, so shipping them inside another publication's bundle would
// silently deploy the wrong laboratory's watermarked images. Treated as
// operational data so a missing plot is a visibly broken image instead.
const DEFAULT_GRAPHS_DIRECTORY = "assets/graphs";

function buildOnce(id) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-site.mjs"), `--site=${id}`], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return { ok: result.status === 0, signal: result.signal };
}

function runBuild(id) {
  const { ok, signal } = buildOnce(id);
  if (ok) return;
  throw new Error(
    signal ? `Build for publication ${id} was terminated by ${signal}` : `Build failed for publication ${id}`
  );
}

/**
 * Put site/ back on the default publication. A Ctrl-C reaches the whole process
 * group, so the first restore attempt is often killed together with the build
 * it is replacing; retry once, since the signal is not delivered to a process
 * spawned afterwards.
 */
function restoreDefault() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { ok, signal } = buildOnce(defaultSite.id);
    if (ok) return true;
    if (!signal) break;
  }
  console.error(`build-all: could not restore site/; run: npm run build -- --site=${defaultSite.id}`);
  return false;
}

function bundleTarget(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Unsafe publication id: ${id}`);
  const target = path.join(distDir, id);
  if (path.dirname(target) !== distDir) throw new Error(`Unsafe bundle target: ${target}`);
  return target;
}

function operationalDataPaths(publication) {
  const { manifest, values, grids, graphs = DEFAULT_GRAPHS_DIRECTORY } = publication.dataset.paths;
  return {
    files: new Set([manifest]),
    directories: [...new Set([values, grids, graphs])],
  };
}

function isOperationalData(relativePath, publication) {
  const normalized = relativePath.split(path.sep).join("/");
  const { files, directories } = operationalDataPaths(publication);
  return (
    files.has(normalized) ||
    directories.some((directory) => normalized === directory || normalized.startsWith(`${directory}/`))
  );
}

function declaredIdentityAssets(publication) {
  const { brand } = publication;
  return [
    brand.ogImage,
    publication.territory?.boundaryAsset,
    ...Object.values(brand.logos ?? {}).flatMap((logo) => [logo?.src, logo?.webp]),
    ...(brand.affiliations ?? []).flatMap((affiliation) => [affiliation?.src, affiliation?.webp]),
  ].filter((value) => typeof value === "string" && value);
}

/** Normalize any HTML/CSS reference to the `assets/...`-rooted key used for lookups. */
function assetKey(reference) {
  const clean = reference.split(/[?#]/, 1)[0].trim();
  const marker = clean.indexOf("assets/");
  return marker >= 0 ? clean.slice(marker) : clean.replace(/^\//, "");
}

function collectFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(full, predicate);
    return entry.isFile() && predicate(entry.name) ? [full] : [];
  });
}

/**
 * Every asset reference an HTML page makes through href/src/srcset. Only srcset is
 * comma-separated; splitting other attributes on commas would shred a data: URI or a
 * query string that legitimately contains commas (the favicon SVG, a Maps embed).
 */
function htmlReferences(html) {
  const refs = [];
  for (const match of html.matchAll(/\b(href|src|srcset)=(?:"([^"]+)"|'([^']+)')/g)) {
    const attribute = match[1];
    const value = match[2] ?? match[3];
    if (attribute === "srcset") {
      refs.push(...value.split(",").map((entry) => entry.trim().split(/\s+/, 1)[0]));
    } else {
      refs.push(value);
    }
  }
  return refs;
}

/** Every asset reference a stylesheet makes through url(...). */
function cssReferences(css) {
  const refs = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) refs.push(match[2]);
  return refs;
}

function isExternalReference(reference, originPrefix) {
  if (!reference) return true;
  if (reference.startsWith(originPrefix)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//") || reference.startsWith("#");
}

/**
 * Files that a bundle may legitimately be narrowed down to. Publication modules
 * provide their own assets, and territory outlines are shared source files that
 * still belong to exactly one publication's map — the Bahia outline is 170 KB of
 * dead weight in the Espírito Santo bundle.
 */
function narrowableAssets(allPublications, provided) {
  return new Set([
    ...provided,
    ...allPublications
      .map((item) => item.territory?.boundaryAsset)
      .filter((value) => typeof value === "string" && value),
  ]);
}

/**
 * A bundle is narrowed by REACHABILITY rather than by who provides a file: the two
 * labs display each other's mark as a partner, so "provided by ufba" and "needed by
 * ufes" are both true of the same PNG. Whatever a publication's own pages never
 * reference — through HTML attributes OR the CSS the bundle ships — is another
 * publication's identity and stays out of its bundle. Called while site/ still
 * holds this publication's freshly built output.
 */
function reachablePublicationAssets(publication, providedAssets) {
  const reachable = new Set();
  const consider = (reference) => {
    const key = assetKey(reference);
    if (providedAssets.has(key)) reachable.add(key);
  };

  // brand.ogImage only ever appears as an absolute same-origin URL, in og:image,
  // twitter:image and the JSON-LD logo — none of which the scans below look at.
  for (const asset of declaredIdentityAssets(publication)) {
    if (providedAssets.has(asset)) reachable.add(asset);
  }

  for (const pageFile of [...publication.pages.map((page) => page.file), "404.html"]) {
    const pagePath = path.join(siteDir, pageFile);
    if (fs.existsSync(pagePath)) htmlReferences(fs.readFileSync(pagePath, "utf8")).forEach(consider);
  }
  // A page can reach an asset only through its stylesheet (background: url(...)),
  // which the HTML scan never sees; drop those and the bundle ships a 404.
  for (const cssFile of collectFiles(path.join(siteDir, "assets", "css"), (name) => name.endsWith(".css"))) {
    cssReferences(fs.readFileSync(cssFile, "utf8")).forEach(consider);
  }
  return reachable;
}

/**
 * Fail if the bundle references a first-party asset it does not contain. The
 * bundle is the artifact CI publishes and reviewers download, so the reachability
 * narrowing above must be verifiable, not trusted. Operational data (values,
 * grids, manifest, station plots) is intentionally deploy-supplied and exempt.
 */
function assertBundleIntegrity(publication, target) {
  const originPrefix = `${publication.origin}/`;
  const missing = new Set();

  const check = (reference, fromFile) => {
    if (isExternalReference(reference, originPrefix)) return;
    const relative = reference.startsWith(originPrefix) ? reference.slice(originPrefix.length) : reference;
    const key = relative.split(/[?#]/, 1)[0].replace(/^\//, "");
    if (!key || isOperationalData(key, publication)) return;
    if (!fs.existsSync(path.join(target, ...key.split("/")))) missing.add(`${key} (referenced by ${fromFile})`);
  };

  for (const htmlFile of collectFiles(target, (name) => name.endsWith(".html"))) {
    const rel = path.relative(target, htmlFile).split(path.sep).join("/");
    htmlReferences(fs.readFileSync(htmlFile, "utf8")).forEach((reference) => check(reference, rel));
  }
  for (const cssFile of collectFiles(path.join(target, "assets", "css"), (name) => name.endsWith(".css"))) {
    const rel = path.relative(target, cssFile).split(path.sep).join("/");
    cssReferences(fs.readFileSync(cssFile, "utf8")).forEach((reference) => check(reference, rel));
  }

  if (missing.size > 0) {
    throw new Error(
      `Bundle ${publication.id} references assets it does not ship:\n` +
        [...missing].map((item) => `  - ${item}`).join("\n") +
        "\nAn asset reached only through CSS url() or JS is dropped by reachability narrowing; " +
        "reference it from the page HTML, or add its directory to the operational exclusions if the deploy supplies it."
    );
  }
}

function copyBundle(publication, providedAssets) {
  const target = bundleTarget(publication.id);
  const reachable = reachablePublicationAssets(publication, providedAssets);
  const foreign = new Set([...providedAssets].filter((asset) => !reachable.has(asset)));

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(siteDir, target, {
    recursive: true,
    filter(source) {
      const relative = path.relative(siteDir, source);
      if (!relative) return true;
      const normalized = relative.split(path.sep).join("/");
      if (isOperationalData(relative, publication)) return false;
      return !foreign.has(normalized);
    },
  });
  assertBundleIntegrity(publication, target);
  const excluded = operationalDataPaths(publication).directories.join(", ");
  console.log(
    `build-all: bundled ${publication.id} -> ${path.relative(root, target)}/ ` +
      `(without ${excluded}; ${foreign.size} unreferenced publication assets dropped)`
  );
}

// Without a handler the default disposition of SIGINT kills this process
// outright, leaving site/ on whichever publication was mid-build. Registering
// one keeps the process alive so the finally below can restore the default;
// the handler itself only gets to run when the signal lands while no child is
// blocking the event loop.
let interrupted = false;
function restoreOnSignal(signal) {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.error(`\nbuild-all: ${signal} received; restoring site/ to ${defaultSite.id}`);
  restoreDefault();
  process.exit(signal === "SIGINT" ? 130 : 143);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => restoreOnSignal(signal));

let failure;
try {
  // Rebuild dist/ from scratch: copyBundle only clears its own target, so a bundle
  // left behind by a publication that has since been removed would keep feeding the
  // corpus that scripts/purgecss.config.cjs and the asset-subset checks read.
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  for (const publication of publications) {
    runBuild(publication.id);
    copyBundle(publication, narrowableAssets(publications, providedAssets));
  }
} catch (error) {
  failure = error;
} finally {
  if (!restoreDefault()) failure ||= new Error(`could not restore site/ to ${defaultSite.id}`);
}

if (failure) {
  if (!(failure instanceof Error) || failure.constructor !== Error || failure.code !== undefined) throw failure;
  console.error(`✗ build-all: ${failure.message}`);
  process.exit(1);
}
console.log(
  `build-all: ${publications.length} static publication bundles generated; site/ restored to ${defaultSite.id}`
);
