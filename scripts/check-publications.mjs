#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { defaultPublication, discoverPublications } = require("./site-builder/publications.js");
const { htmlReferences, isExternalReference, assetKey } = require("./site-builder/references.js");
const publications = discoverPublications(root);
const defaultSite = defaultPublication(publications);
const buildScript = path.join(root, "scripts", "build-site.mjs");
const htmlValidate = path.join(root, "node_modules", "html-validate", "bin", "html-validate.mjs");
const purgeCheck = path.join(root, "scripts", "check-bootstrap-purge.mjs");
const iconCheck = path.join(root, "scripts", "check-fa-subset.mjs");

const DRIFT_PREVIEW_LINES = 40;

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} failed`);
}

/**
 * Model output only. Station plots (assets/graphs) are deliberately NOT listed here:
 * they are committed, so both this check and scripts/check-links.mjs must verify that
 * every referenced plot exists. scripts/build-all.mjs keeps them out of dist/ bundles
 * instead, which is a packaging concern rather than a validation one — exempting them
 * here as well would let a typo in dataset.observations reach production unnoticed.
 */
function operationalDirectories(publication) {
  const { values, grids } = publication.dataset.paths;
  return [...new Set([values, grids])];
}

function isOperationalDataPath(publication, relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return (
    normalized === publication.dataset.paths.manifest ||
    operationalDirectories(publication).some(
      (directory) => normalized === directory || normalized.startsWith(`${directory}/`)
    )
  );
}

// Placeholders that legitimately keep an otherwise-ignored directory in git.
const OPERATIONAL_PLACEHOLDERS = new Set([".keep", ".gitkeep"]);

/**
 * Pipeline output must stay out of git. Rather than reason about .gitignore glob
 * coverage — where `site/JSON/*.json` looks like it covers the directory while a
 * `.csv` or `.bin` sibling slips through — assert the actual tracked state: no file
 * under a declared operational directory may be committed, except a bare placeholder.
 */
function assertOperationalDataIgnored() {
  const leaked = [];
  for (const publication of publications) {
    const { values, grids } = publication.dataset.paths;
    for (const directory of new Set([values, grids])) {
      const result = spawnSync("git", ["ls-files", "-z", "--", `site/${directory}`], { cwd: root, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`could not inspect tracked files under site/${directory}`);
      for (const tracked of result.stdout.split("\0").filter(Boolean)) {
        if (!OPERATIONAL_PLACEHOLDERS.has(path.posix.basename(tracked))) {
          leaked.push(`${publication.id} (dataset ${publication.dataset.id}): ${tracked}`);
        }
      }
    }
  }

  if (leaked.length > 0) {
    throw new Error(
      `Operational pipeline output is committed to git:\n${leaked
        .map((item) => `  - ${item}`)
        .join("\n")}\nAdd a rule such as "site/<directory>/*" to .gitignore and git rm --cached the files above.`
    );
  }
}

function assertLocalReferences(publication) {
  const siteRoot = path.join(root, "site");
  const pages = [...publication.pages.map((page) => page.file), "404.html"];
  const missing = [];

  for (const pageFile of pages) {
    const html = fs.readFileSync(path.join(siteRoot, pageFile), "utf8");
    for (const rawValue of htmlReferences(html)) {
      // No originPrefix: a same-origin absolute URL to this publication's own host is
      // external here (the reference check only resolves root- and page-relative paths).
      if (isExternalReference(rawValue, "")) continue;
      const cleanValue = rawValue.split(/[?#]/, 1)[0];
      if (!cleanValue) continue;
      const relative = cleanValue.startsWith("/")
        ? assetKey(cleanValue, "")
        : path.posix.join(path.posix.dirname(pageFile), cleanValue);
      if (isOperationalDataPath(publication, relative)) continue;
      const candidate = path.resolve(siteRoot, relative);
      if (!candidate.startsWith(`${siteRoot}${path.sep}`) || !fs.existsSync(candidate)) {
        missing.push(`${pageFile}: ${rawValue}`);
      }
    }
  }

  if (missing.length) {
    throw new Error(
      `Missing local references for ${publication.id}:\n${missing.map((item) => `  - ${item}`).join("\n")}`
    );
  }
}

function assertNoUntrackedOutput(publication) {
  const result = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "--", "site"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("could not inspect untracked generated output");

  const untracked = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => !isOperationalDataPath(publication, file.replace(/^site\//, "")));
  if (untracked.length > 0) {
    throw new Error(
      `Generated output is untracked; add it to the change or ignore operational data:\n${untracked
        .map((file) => `  - ${file}`)
        .join("\n")}`
    );
  }
}

function assertNoGeneratedDrift(publication) {
  const changed = spawnSync("git", ["diff", "--quiet", "--", "site"], { cwd: root, stdio: "ignore" });
  if (changed.error) throw changed.error;
  if (changed.status === 0) return;
  if (changed.status !== 1) throw new Error("could not compare the generated output with the committed one");

  const stat = spawnSync("git", ["diff", "--stat", "--", "site"], { cwd: root, encoding: "utf8" });
  const diff = spawnSync("git", ["diff", "--", "site"], { cwd: root, encoding: "utf8" });
  const diffLines = (diff.stdout ?? "").split(/\r?\n/);
  const preview = diffLines.slice(0, DRIFT_PREVIEW_LINES);
  const remaining = diffLines.length - preview.length;

  throw new Error(
    [
      `Committed output in site/ does not match a fresh build of the default publication (${publication.id}).`,
      "",
      (stat.stdout ?? "").trimEnd(),
      "",
      ...preview,
      remaining > 0 ? `  [... ${remaining} more diff lines; run \`git diff -- site\` to see the whole diff]` : "",
      "",
      `Fix: npm run build -- --site=${publication.id}   then commit the resulting site/ changes.`,
    ]
      .filter((line, index, all) => line !== "" || all[index - 1] !== "")
      .join("\n")
  );
}

function buildAndValidate(publication) {
  run(process.execPath, [buildScript, `--site=${publication.id}`], `build ${publication.id}`);
  const htmlFiles = [...publication.pages.map((page) => path.join("site", page.file)), path.join("site", "404.html")];
  run(process.execPath, [htmlValidate, ...htmlFiles], `HTML validation ${publication.id}`);
  run(process.execPath, [purgeCheck], `Bootstrap/PurgeCSS validation ${publication.id}`);
  // Both vendor subsets are shared by every publication while site/ holds one at a
  // time, so a page that introduces a new icon only fails while its own publication
  // is rendered. Running the check here means `npm run build:check` — the command the
  // guide points a new maintainer at — catches it instead of the CI three steps later.
  run(process.execPath, [iconCheck], `Font Awesome subset validation ${publication.id}`);

  const index = fs.readFileSync(path.join(root, "site", "index.html"), "utf8");
  if (!index.includes(`data-publication="${publication.id}"`)) {
    throw new Error(`Generated index does not identify publication ${publication.id}`);
  }
  if (/\{\{[^}]+\}\}/.test(index)) throw new Error(`Generated index for ${publication.id} contains unresolved tokens`);
  assertLocalReferences(publication);
}

/**
 * Put site/ back on the default publication. A Ctrl-C reaches the whole process
 * group, so the first restore attempt is often killed together with the build
 * it is replacing; retry once, since the signal is not delivered to a process
 * spawned afterwards.
 */
function restoreDefault() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [buildScript, `--site=${defaultSite.id}`], {
      cwd: root,
      stdio: "inherit",
    });
    if (!result.error && result.status === 0) return true;
    if (!result.signal) break;
  }
  console.error(`build-check: could not restore site/; run: npm run build -- --site=${defaultSite.id}`);
  return false;
}

// Without a handler the default disposition of SIGINT kills this process
// outright, leaving site/ on whichever publication was being validated.
// Registering one keeps the process alive so the finally below can restore the
// default publication.
let interrupted = false;
function restoreOnSignal(signal) {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.error(`\nbuild-check: ${signal} received; restoring site/ to ${defaultSite.id}`);
  restoreDefault();
  process.exit(signal === "SIGINT" ? 130 : 143);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => restoreOnSignal(signal));

let failure;
try {
  assertOperationalDataIgnored();
  for (const publication of publications) buildAndValidate(publication);
} catch (error) {
  failure = error;
} finally {
  if (!restoreDefault()) failure ||= new Error(`could not restore site/ to ${defaultSite.id}`);
}

if (!failure && !process.argv.includes("--skip-drift")) {
  try {
    assertNoGeneratedDrift(defaultSite);
    assertNoUntrackedOutput(defaultSite);
  } catch (error) {
    failure = error;
  }
}

if (failure) {
  if (!(failure instanceof Error) || failure.constructor !== Error || failure.code !== undefined) throw failure;
  console.error(`✗ build-check: ${failure.message}`);
  process.exit(1);
}
console.log(`build-check: validated ${publications.length} publications; site/ restored to ${defaultSite.id}`);
