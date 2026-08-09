#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { defaultPublication, discoverPublications } = require("./site-builder/publications.js");
const { finishWithFailure, installSignalRestore } = require("./site-builder/cli.js");
const { allOperationalPaths } = require("./site-builder/operational-paths.js");
const publications = discoverPublications(root);
const defaultSite = defaultPublication(publications);
const buildScript = path.join(root, "scripts", "build-site.mjs");
const cli = path.join(root, "node_modules", "linkinator", "build", "src", "cli.js");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --check-css follows url() into all.min.css, which declares .ttf fallbacks and
// fa-v4compatibility.* that this repo deliberately does not distribute (see
// scripts/subset-fontawesome.md). Only those two shapes are skipped, so a
// missing .woff2 — the format browsers actually fetch — still fails the check.
const FONTAWESOME_UNSHIPPED = String.raw`/assets/vendor/fontawesome/webfonts/(?:[^/]+\.ttf|fa-v4compatibility\.[^/]+)$`;

// O rastreador varre site/, que guarda os diretórios de dados de TODAS as publicações
// (nada os apaga entre uma build e a seguinte), então a lista a pular é a união — não
// o que a publicação corrente declara. Enumerar os campos à mão aqui já tinha
// divergido: `monitoring` ficou de fora e só não quebrou o portão porque a página
// alcança o payload por atributo de dado, que o linkinator não segue.
const { directories: OPERATIONAL_DIRECTORIES, files: OPERATIONAL_FILES } = allOperationalPaths(publications, {
  includeGraphs: false,
});

function skipPattern() {
  const operationalRules = [
    ...OPERATIONAL_DIRECTORIES.map((directory) => `/${escapeRegex(directory)}/`),
    ...[...OPERATIONAL_FILES].map((file) => `/${escapeRegex(file)}(?:[?#]|$)`),
  ];
  return [
    String.raw`^https?://(?!localhost|127\.0\.0\.1)`,
    "^mailto:",
    "^tel:",
    "^data:",
    FONTAWESOME_UNSHIPPED,
    ...operationalRules,
  ].join("|");
}

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} failed`);
}

// Publication currently rendered into site/, so the restore step knows whether
// it still has work to do after a failure.
let siteHolds;

function checkPublication(publication) {
  console.log(`\ncheck-links: building and crawling ${publication.id}`);
  siteHolds = undefined;
  run([buildScript, `--site=${publication.id}`], `build ${publication.id}`);
  siteHolds = publication.id;
  // --check-fragments resolves the `href="#main"` skip links against the ids the
  // layouts actually render; --check-css follows url() references so a purged or
  // renamed asset that only CSS points at cannot slip through.
  run(
    [cli, "/", "--server-root", "site", "--recurse", "--check-fragments", "--check-css", "--skip", skipPattern()],
    `link check ${publication.id}`
  );
}

/**
 * Put site/ back on the default publication. See scripts/build-all.mjs: a
 * Ctrl-C reaches the whole process group, so the first attempt is often killed
 * along with the build it replaces; retry once.
 */
function restoreDefault() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [buildScript, `--site=${defaultSite.id}`], {
      cwd: root,
      stdio: "inherit",
    });
    if (!result.error && result.status === 0) {
      siteHolds = defaultSite.id;
      return true;
    }
    if (!result.signal) break;
  }
  console.error(`check-links: could not restore site/; run: npm run build -- --site=${defaultSite.id}`);
  return false;
}

installSignalRestore(restoreDefault, { label: "check-links", defaultId: defaultSite.id });

let failure;
try {
  for (const publication of publications) checkPublication(publication);
} catch (error) {
  failure = error;
} finally {
  if (siteHolds !== defaultSite.id && !restoreDefault()) {
    failure ||= new Error(`could not restore site/ to ${defaultSite.id}`);
  }
}

if (failure) finishWithFailure(failure, "check-links");
console.log(`\ncheck-links: crawled ${publications.length} publications; site/ restored to ${defaultSite.id}`);
