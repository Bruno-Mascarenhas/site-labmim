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
 *   BUILD_YEAR=2026 node build.js   # builds without a git checkout
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { defaultPublication, discoverPublications, selectPublication } = require("./scripts/site-builder/publications");
const { writePublicationAssets } = require("./scripts/site-builder/assets");
const { renderPublication } = require("./scripts/site-builder/renderer");
const { validatePublication } = require("./scripts/site-builder/validate");
const { isExpectedFailure } = require("./scripts/site-builder/cli");

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

function yearFromGit() {
  try {
    const stamp = execSync("git log -1 --format=%cs", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^\d{4}/.test(stamp) ? stamp.slice(0, 4) : undefined;
  } catch {
    return undefined;
  }
}

function yearFromGeneratedOutput() {
  try {
    const html = fs.readFileSync(path.join(OUTPUT_DIR, "index.html"), "utf8");
    const match = html.match(/&copy;\s*(\d{4})/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copyright year stamped into the generated pages.
 *
 * Resolved from repository content only, never from the wall clock: an
 * explicit BUILD_YEAR wins, then the date of the checked out commit, then the
 * year already present in the committed site/index.html (tarballs without
 * .git). Guessing `new Date().getFullYear()` used to make the same source tree
 * render differently depending on when it was built, which is exactly what the
 * generated-output drift check exists to catch.
 */
function buildYear() {
  const override = (process.env.BUILD_YEAR ?? "").trim();
  if (override) {
    if (!/^\d{4}$/.test(override)) {
      throw new Error(`BUILD_YEAR must be a four-digit year (received ${JSON.stringify(process.env.BUILD_YEAR)})`);
    }
    return override;
  }
  const year = yearFromGit() ?? yearFromGeneratedOutput();
  if (year) return year;
  throw new Error(
    "could not resolve the copyright year: this is not a git checkout and site/index.html carries no © year.\n" +
      "Set BUILD_YEAR=<year> to build from a source tarball."
  );
}

function main() {
  const publications = discoverPublications(ROOT);
  const publicationIds = publications.map((publication) => publication.id);

  if (process.argv.includes("--list-sites")) {
    for (const publication of publications) {
      console.log(`${publication.id}${publication.isDefault ? " (default)" : ""}`);
    }
    return;
  }

  const cliSite = readOption(process.argv.slice(2), ["--site", "--variant"], publicationIds);
  const requestedId = cliSite ?? process.env.SITE_ID ?? process.env.SITE_VARIANT;
  const publication = requestedId ? selectPublication(publications, requestedId) : defaultPublication(publications);

  // Publish every publication's own assets before validating: a publication keeps
  // its logos inside its module, and validatePublication resolves brand.logos and
  // brand.ogImage against the output directory they land in.
  const assetSources = writePublicationAssets(publications, OUTPUT_DIR);

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
  console.log(`build.js: published ${assetSources.size} publication assets under assets/`);
}

try {
  main();
} catch (error) {
  if (!isExpectedFailure(error)) throw error;
  console.error(`✗ build.js: ${error.message}`);
  process.exit(1);
}
