#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { defaultPublication, discoverPublications } = require("./site-builder/publications.js");
const publication = defaultPublication(discoverPublications(root));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const { manifest, values, grids } = publication.dataset.paths;
const operationalRules = [
  ...new Set([values, grids].map((directory) => `/${escapeRegex(directory)}/`)),
  `/${escapeRegex(manifest)}(?:[?#]|$)`,
];
const skip = [
  String.raw`^https?://(?!localhost|127\.0\.0\.1)`,
  "^mailto:",
  "^tel:",
  "^data:",
  ...operationalRules,
].join("|");

const cli = path.join(root, "node_modules", "linkinator", "build", "src", "cli.js");
const result = spawnSync(process.execPath, [cli, "/", "--server-root", "site", "--recurse", "--skip", skip], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
