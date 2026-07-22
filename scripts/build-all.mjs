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
const siteDir = path.join(root, "site");
const distDir = path.join(root, "dist");

function runBuild(id) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-site.mjs"), `--site=${id}`], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build failed for publication ${id}`);
}

function bundleTarget(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Unsafe publication id: ${id}`);
  const target = path.join(distDir, id);
  if (path.dirname(target) !== distDir) throw new Error(`Unsafe bundle target: ${target}`);
  return target;
}

function operationalDataPaths(publication) {
  const { manifest, values, grids } = publication.dataset.paths;
  return {
    files: new Set([manifest]),
    directories: [values, grids],
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

function copyBundle(publication) {
  const target = bundleTarget(publication.id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(siteDir, target, {
    recursive: true,
    filter(source) {
      const relative = path.relative(siteDir, source);
      if (!relative) return true;
      return !isOperationalData(relative, publication);
    },
  });
  console.log(`build-all: bundled ${publication.id} -> ${path.relative(root, target)}/`);
}

let failure;
try {
  fs.mkdirSync(distDir, { recursive: true });
  for (const publication of publications) {
    runBuild(publication.id);
    copyBundle(publication);
  }
} catch (error) {
  failure = error;
} finally {
  try {
    runBuild(defaultSite.id);
  } catch (restoreError) {
    failure ||= restoreError;
  }
}

if (failure) throw failure;
console.log(
  `build-all: ${publications.length} static publication bundles generated; site/ restored to ${defaultSite.id}`
);
