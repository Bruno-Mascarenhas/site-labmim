#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { defaultPublication, discoverPublications } = require("./site-builder/publications.js");
const publications = discoverPublications(root);
const defaultSite = defaultPublication(publications);
const buildScript = path.join(root, "scripts", "build-site.mjs");
const cli = path.join(root, "node_modules", "linkinator", "build", "src", "cli.js");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skipPattern(publication) {
  const { manifest, values, grids } = publication.dataset.paths;
  const operationalRules = [
    ...new Set([values, grids].map((directory) => `/${escapeRegex(directory)}/`)),
    `/${escapeRegex(manifest)}(?:[?#]|$)`,
  ];
  return [String.raw`^https?://(?!localhost|127\.0\.0\.1)`, "^mailto:", "^tel:", "^data:", ...operationalRules].join(
    "|"
  );
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
  run(
    [cli, "/", "--server-root", "site", "--recurse", "--skip", skipPattern(publication)],
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

// Without a handler the default disposition of SIGINT kills this process
// outright, leaving site/ on whichever publication was being crawled.
// Registering one keeps the process alive so the finally below can restore it.
let interrupted = false;
function restoreOnSignal(signal) {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.error(`\ncheck-links: ${signal} received; restoring site/ to ${defaultSite.id}`);
  restoreDefault();
  process.exit(signal === "SIGINT" ? 130 : 143);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => restoreOnSignal(signal));

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

if (failure) {
  if (!(failure instanceof Error) || failure.constructor !== Error || failure.code !== undefined) throw failure;
  console.error(`✗ check-links: ${failure.message}`);
  process.exit(1);
}
console.log(`\ncheck-links: crawled ${publications.length} publications; site/ restored to ${defaultSite.id}`);
