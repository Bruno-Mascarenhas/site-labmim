#!/usr/bin/env node
/**
 * Static publication builder.
 *
 * Discovers src/sites/<id>/site.js, validates the selected publication and
 * renders plain HTML/CSS plus Apache metadata into site/. Nothing from this
 * build system is required by the deployed site at runtime.
 *
 * Usage:
 *   node build.js --site=ufba
 *   node build.js --site=ufes
 *   SITE_ID=ufes node build.js
 *   node build.js --list-sites
 */
"use strict";

const path = require("path");
const { execSync } = require("child_process");
const { defaultPublication, discoverPublications, selectPublication } = require("./scripts/site-builder/publications");
const { renderPublication } = require("./scripts/site-builder/renderer");
const { validatePublication } = require("./scripts/site-builder/validate");

const ROOT = __dirname;
const OUTPUT_DIR = path.join(ROOT, "site");
const TEMPLATE_ROOT = path.join(ROOT, "src", "template");

function readOption(argv, names, allowedValues) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    for (const name of names) {
      if (argument === name) {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(`${name} requires a value (${allowedValues.join(" or ")})`);
        }
        return value;
      }
      if (argument.startsWith(`${name}=`)) {
        const value = argument.slice(name.length + 1);
        if (!value) throw new Error(`${name} requires a value (${allowedValues.join(" or ")})`);
        return value;
      }
    }
  }
  return undefined;
}

function buildYear() {
  try {
    return execSync("git log -1 --format=%cs", { cwd: ROOT, encoding: "utf8" }).slice(0, 4);
  } catch {
    return String(new Date().getFullYear());
  }
}

const publications = discoverPublications(ROOT);
const publicationIds = publications.map((publication) => publication.id);

if (process.argv.includes("--list-sites")) {
  for (const publication of publications) {
    console.log(`${publication.id}${publication.isDefault ? " (default)" : ""}`);
  }
  process.exit(0);
}

const cliSite = readOption(process.argv.slice(2), ["--site", "--variant"], publicationIds);
const requestedId = cliSite ?? process.env.SITE_ID ?? process.env.SITE_VARIANT;
const publication = requestedId ? selectPublication(publications, requestedId) : defaultPublication(publications);

const validation = validatePublication({
  root: ROOT,
  templateRoot: TEMPLATE_ROOT,
  siteDir: OUTPUT_DIR,
  publication,
});
const result = renderPublication({
  root: ROOT,
  outputDir: OUTPUT_DIR,
  publication,
  validation,
  year: buildYear(),
});

console.log(
  `build.js: site=${publication.id}; wrote ${result.pagesWritten.length} pages -> ${result.pagesWritten.join(", ")}`
);
console.log(`build.js: wrote static files -> ${result.staticWritten.join(", ")}`);
console.log(`build.js: wrote publication theme -> ${result.themeWritten}`);
