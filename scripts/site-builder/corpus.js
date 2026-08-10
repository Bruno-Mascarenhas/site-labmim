"use strict";

const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

// Shared file enumeration for the vendor-subset guards (check-fa-subset.mjs and
// check-bootstrap-purge.mjs), which must walk the exact same corpus to agree.
// Paths are relative to `root`.

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

function htmlFilesIn(root, dir) {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".html"))
    .map((name) => join(dir, name));
}

// site/ only ever holds one publication; the dist/<id> bundles from `npm run build:all`
// are how a check covers every publication at once. [] when they have not been built.
function bundleDirs(root) {
  if (!existsSync(join(root, "dist"))) return [];
  return readdirSync(join(root, "dist"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("dist", entry.name));
}

module.exports = { collectFiles, htmlFilesIn, bundleDirs };
