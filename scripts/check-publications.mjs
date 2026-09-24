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
const { finishWithFailure, makeRestore, installSignalRestore } = require("./site-builder/cli.js");
const { publicationOperationalPaths, isOperationalPath } = require("./site-builder/operational-paths.js");
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

// Model output only. Station plots (assets/graphs) are committed, so this check and
// check-links.mjs must verify every referenced plot exists; exempting them here too
// would let a typo in dataset.observations reach production unnoticed. build-all.mjs
// still keeps them out of dist/, which is packaging rather than validation.
const OPERATIONAL_OPTIONS = Object.freeze({ includeGraphs: false });

function operationalDirectories(publication) {
  return publicationOperationalPaths(publication, OPERATIONAL_OPTIONS).directories;
}

function isOperationalDataPath(publication, relativePath) {
  const declared = publicationOperationalPaths(publication, OPERATIONAL_OPTIONS);
  return isOperationalPath(relativePath.split(path.sep).join("/"), declared);
}

const OPERATIONAL_PLACEHOLDERS = new Set([".keep", ".gitkeep"]);

// Asserts the tracked state rather than reasoning about .gitignore glob coverage,
// where `site/JSON/*.json` looks like it covers the directory while a `.csv` or `.bin`
// sibling slips through.
function assertOperationalDataIgnored() {
  const leaked = [];
  for (const publication of publications) {
    for (const directory of operationalDirectories(publication)) {
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
      // Empty originPrefix: only root- and page-relative paths resolve here, so a
      // same-origin absolute URL to this publication's own host counts as external.
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

function readableText(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function assertRunNotesStayWithTheirDataset(publication) {
  const pages = [...publication.pages.map((page) => page.file), "404.html"].map((pageFile) => ({
    pageFile,
    text: readableText(fs.readFileSync(path.join(root, "site", pageFile), "utf8")),
  }));
  const ownNotes = Object.entries(publication.dataset.runNotes ?? {}).map(([key, note]) => [key, readableText(note)]);
  const ownTexts = new Set(ownNotes.map(([, text]) => text));
  const problems = [];

  for (const [key, text] of ownNotes) {
    if (!pages.some((page) => page.text.includes(text))) {
      problems.push(`dataset ${publication.dataset.id} runNotes.${key} appears on no page`);
    }
  }
  for (const other of publications) {
    if (other.dataset.id === publication.dataset.id) continue;
    for (const [key, note] of Object.entries(other.dataset.runNotes ?? {})) {
      const text = readableText(note);
      if (ownTexts.has(text)) continue;
      for (const page of pages.filter((candidate) => candidate.text.includes(text))) {
        problems.push(`${page.pageFile}: carries runNotes.${key} of dataset ${other.dataset.id}`);
      }
    }
  }

  if (problems.length) {
    throw new Error(
      `Run notes of ${publication.id} do not match its dataset (${publication.dataset.id}):\n` +
        problems.map((item) => `  - ${item}`).join("\n") +
        "\nRun-specific text belongs in dataset.runNotes, rendered through a RUN_NOTE_* slot, never in a shared template."
    );
  }
}

const FORECAST_HORIZON_STATEMENT =
  /(?:antecedência de|horizonte de(?: previsão de)?) (\d+(?:,\d+)?) horas|até \+(\d+(?:,\d+)?) h de previsão/g;

function assertForecastHorizonMatchesPublishedRun(publication) {
  const manifestPath = publication.dataset.paths.manifest;
  const manifestFile = path.join(root, "site", manifestPath);
  if (!fs.existsSync(manifestFile)) {
    console.log(`build-check: forecast horizon of ${publication.id} not checked; site/${manifestPath} is absent`);
    return;
  }
  const { index_max: indexMax } = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (!Number.isInteger(indexMax)) {
    console.log(
      `build-check: forecast horizon of ${publication.id} not checked; site/${manifestPath} has no index_max`
    );
    return;
  }

  const { defaultMaxLayer, stepHours } = publication.dataset.timeline;
  const expectedHours = String(indexMax * stepHours).replace(".", ",");
  const problems = [];
  if (defaultMaxLayer !== indexMax) {
    problems.push(
      `dataset ${publication.dataset.id} timeline.defaultMaxLayer is ${defaultMaxLayer}, but the run in site/${manifestPath} declares index_max ${indexMax}`
    );
  }
  let statementCount = 0;
  for (const pageFile of publication.pages.map((page) => page.file)) {
    const text = readableText(fs.readFileSync(path.join(root, "site", pageFile), "utf8"));
    for (const statement of text.matchAll(FORECAST_HORIZON_STATEMENT)) {
      statementCount += 1;
      const statedHours = statement[1] ?? statement[2];
      if (statedHours !== expectedHours) problems.push(`${pageFile}: "${statement[0]}" instead of ${expectedHours} h`);
    }
  }
  if (statementCount === 0) problems.push("no page states the forecast horizon");

  if (problems.length) {
    throw new Error(
      `Forecast horizon of ${publication.id} does not match the published run (index_max ${indexMax}, step ${stepHours} h):\n` +
        problems.map((item) => `  - ${item}`).join("\n")
    );
  }
}

const APACHE_REDIRECT_TARGET = /^\s*Redirect\s+\d+\s+"[^"]*"\s+"([^"]*)"/;

function assertFragmentRedirectsStopQueryAppend(publication) {
  const htaccess = fs.readFileSync(path.join(root, "site", ".htaccess"), "utf8");
  const exposed = htaccess
    .split(/\r?\n/)
    .filter((line) => {
      const target = line.match(APACHE_REDIRECT_TARGET)?.[1];
      return target?.includes("#") && !target.split("#", 1)[0].includes("?");
    })
    .map((line) => line.trim());

  if (exposed.length > 0) {
    throw new Error(
      `.htaccess of ${publication.id} redirects to a fragment without a "?" before the "#":\n${exposed
        .map((line) => `  - ${line}`)
        .join("\n")}\nmod_alias appends the request query to any target without "?", after the fragment, ` +
        `where the browser reads it as part of the anchor. End the path in "?" before "#".`
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

  const untracked = result.stdout.split(/\r?\n/).filter(Boolean);
  const unignoredOperational = untracked.filter((file) =>
    isOperationalDataPath(publication, file.replace(/^site\//, ""))
  );
  if (unignoredOperational.length > 0) {
    throw new Error(
      `Operational data directory holds files .gitignore does not cover:\n${unignoredOperational
        .map((file) => `  - ${file}`)
        .join("\n")}\nIgnore it by directory: "site/<directory>/*" plus "!site/<directory>/.keep".`
    );
  }
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
  // time, so a page introducing a new icon only fails while its own publication is
  // rendered — hence per publication, inside build:check, not once later in CI.
  run(process.execPath, [iconCheck], `Font Awesome subset validation ${publication.id}`);

  const index = fs.readFileSync(path.join(root, "site", "index.html"), "utf8");
  if (!index.includes(`data-publication="${publication.id}"`)) {
    throw new Error(`Generated index does not identify publication ${publication.id}`);
  }
  if (/\{\{[^}]+\}\}/.test(index)) throw new Error(`Generated index for ${publication.id} contains unresolved tokens`);
  assertLocalReferences(publication);
  assertRunNotesStayWithTheirDataset(publication);
  if (publication.id === defaultSite.id) assertForecastHorizonMatchesPublishedRun(publication);
  assertFragmentRedirectsStopQueryAppend(publication);
}

const restoreDefault = makeRestore({
  execPath: process.execPath,
  buildScript,
  defaultId: defaultSite.id,
  label: "build-check",
  cwd: root,
});
installSignalRestore(restoreDefault, { label: "build-check", defaultId: defaultSite.id });

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

if (failure) finishWithFailure(failure, "build-check");
console.log(`build-check: validated ${publications.length} publications; site/ restored to ${defaultSite.id}`);
