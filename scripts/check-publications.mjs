#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { defaultPublication, discoverPublications } = require("./site-builder/publications.js");
const publications = discoverPublications(root);
const defaultSite = defaultPublication(publications);
const buildScript = path.join(root, "scripts", "build-site.mjs");
const htmlValidate = path.join(root, "node_modules", "html-validate", "bin", "html-validate.mjs");
const purgeCheck = path.join(root, "scripts", "check-bootstrap-purge.mjs");

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed`);
}

function isOperationalDataPath(publication, relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const { manifest, values, grids } = publication.dataset.paths;
  return (
    normalized === manifest ||
    [values, grids].some((directory) => normalized === directory || normalized.startsWith(`${directory}/`))
  );
}

function assertLocalReferences(publication) {
  const siteRoot = path.join(root, "site");
  const pages = [...publication.pages.map((page) => page.file), "404.html"];
  const missing = [];

  for (const pageFile of pages) {
    const html = fs.readFileSync(path.join(siteRoot, pageFile), "utf8");
    for (const match of html.matchAll(/\b(href|src|srcset)=(?:"([^"]+)"|'([^']+)')/g)) {
      const attribute = match[1];
      const value = match[2] || match[3];
      const rawValues =
        attribute === "srcset" ? value.split(",").map((entry) => entry.trim().split(/\s+/, 1)[0]) : [value];
      for (const rawValue of rawValues) {
        if (
          !rawValue ||
          rawValue.startsWith("#") ||
          rawValue.startsWith("//") ||
          /^[a-z][a-z0-9+.-]*:/i.test(rawValue)
        ) {
          continue;
        }
        const cleanValue = rawValue.split(/[?#]/, 1)[0];
        if (!cleanValue) continue;
        const relative = cleanValue.startsWith("/")
          ? cleanValue.slice(1)
          : path.posix.join(path.posix.dirname(pageFile), cleanValue);
        if (isOperationalDataPath(publication, relative)) continue;
        const candidate = path.resolve(siteRoot, relative);
        if (!candidate.startsWith(`${siteRoot}${path.sep}`) || !fs.existsSync(candidate)) {
          missing.push(`${pageFile}: ${rawValue}`);
        }
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

function buildAndValidate(publication) {
  run(process.execPath, [buildScript, `--site=${publication.id}`], `build ${publication.id}`);
  const htmlFiles = [...publication.pages.map((page) => path.join("site", page.file)), path.join("site", "404.html")];
  run(process.execPath, [htmlValidate, ...htmlFiles], `HTML validation ${publication.id}`);
  run(process.execPath, [purgeCheck], `Bootstrap/PurgeCSS validation ${publication.id}`);

  const index = fs.readFileSync(path.join(root, "site", "index.html"), "utf8");
  if (!index.includes(`data-publication="${publication.id}"`)) {
    throw new Error(`Generated index does not identify publication ${publication.id}`);
  }
  if (/\{\{[^}]+\}\}/.test(index)) throw new Error(`Generated index for ${publication.id} contains unresolved tokens`);
  assertLocalReferences(publication);
}

let failure;
try {
  for (const publication of publications) buildAndValidate(publication);
} catch (error) {
  failure = error;
} finally {
  try {
    run(process.execPath, [buildScript, `--site=${defaultSite.id}`], `restore ${defaultSite.id}`);
  } catch (restoreError) {
    failure ||= restoreError;
  }
}

if (failure) throw failure;
if (!process.argv.includes("--skip-drift")) {
  run("git", ["diff", "--exit-code", "--", "site"], "generated output drift check");
  assertNoUntrackedOutput(defaultSite);
}
console.log(`build-check: validated ${publications.length} publications; site/ restored to ${defaultSite.id}`);
