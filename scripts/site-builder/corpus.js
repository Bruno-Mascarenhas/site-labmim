"use strict";

const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Shared file enumeration for the vendor-subset guards (check-fa-subset.mjs and
 * check-bootstrap-purge.mjs). Both build the same corpus — every generated HTML
 * plus first-party CSS/JS across site/ and, when present, each dist/<id> bundle —
 * so the walkers live here instead of being copied byte-for-byte into each check.
 */

/** Recursively list files under `dir` with one of `exts`, skipping vendor/node_modules. Paths are relative to `root`. */
function collectFiles(root, dir, exts, out = []) {
  if (!existsSync(join(root, dir))) return out;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "vendor" || entry.name === "node_modules") continue;
      collectFiles(root, rel, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(rel);
    }
  }
  return out;
}

/** Non-recursive list of `.html` files directly inside `dir`, relative to `root`. */
function htmlFilesIn(root, dir) {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".html"))
    .map((name) => join(dir, name));
}

/**
 * `dist/<id>` for every bundle produced by `npm run build:all`, or [] when the
 * bundles are absent. site/ only ever holds one publication; the bundles are how a
 * check covers every publication at once.
 */
function bundleDirs(root) {
  if (!existsSync(join(root, "dist"))) return [];
  return readdirSync(join(root, "dist"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("dist", entry.name));
}

module.exports = { collectFiles, htmlFilesIn, bundleDirs };
