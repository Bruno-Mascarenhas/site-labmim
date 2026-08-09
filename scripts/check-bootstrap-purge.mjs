#!/usr/bin/env node
/**
 * Verifies that bootstrap.purged.min.css still covers every selector of the full
 * bootstrap.min.css that CAN apply to the site: a selector whose classes are all
 * present in the generated HTML / first-party JS (or in the list of classes the
 * Bootstrap plugins toggle at runtime) has to survive in the purged file. A failure
 * means the purge needs regenerating (scripts/purgecss.config.cjs).
 *
 * Node stdlib only, like build.js.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { collectFiles, htmlFilesIn, bundleDirs } = require("./site-builder/corpus.js");

const read = (rel) => readFileSync(join(root, rel), "utf8");

// Seeded with the classes Bootstrap toggles at runtime (collapse, modal, and generic
// states): they never show up in a class="..." attribute of the generated HTML. The
// scan below adds the classes the HTML and the first-party JS do carry.
const usedClasses = new Set([
  "collapsing",
  "collapse-horizontal",
  "show",
  "fade",
  "modal-open",
  "modal-backdrop",
  "modal-static",
  "active",
  "disabled",
]);

const usedTags = new Set(["html", "body", "*"]);

// site/ only ever holds one publication at a time. dist/<id>/ (npm run
// build:all) holds all of them, so when the bundles exist the corpus covers
// every publication instead of just the one currently rendered.
const htmlFiles = [...htmlFilesIn(root, "site"), ...bundleDirs(root).flatMap((dir) => htmlFilesIn(root, dir))];

const corpusParts = [];
for (const file of htmlFiles) {
  const text = read(file);
  corpusParts.push(text);
  for (const match of text.matchAll(/class="([^"]*)"/g)) {
    for (const cls of match[1].split(/\s+/)) if (cls) usedClasses.add(cls);
  }
  for (const match of text.matchAll(/<([a-z][a-z0-9]*)/g)) usedTags.add(match[1]);
}
for (const file of collectFiles(root, "site/assets/js", [".js"])) {
  const text = read(file);
  corpusParts.push(text);
  for (const match of text.matchAll(/["'`]([\w\s-]+)["'`]/g)) {
    for (const cls of match[1].split(/\s+/)) if (cls) usedClasses.add(cls);
  }
}
const corpusText = corpusParts.join("\n");

// Selectors of a minified stylesheet: whatever precedes each '{' without being an
// at-rule, split on the commas of a selector list.
const parseSelectors = (cssText) => {
  const selectors = new Set();
  for (const match of cssText.matchAll(/(?:^|[{};])\s*([^{};@]+)\{/g)) {
    for (const selector of match[1].split(",")) {
      const trimmed = selector.trim();
      if (trimmed) selectors.add(trimmed);
    }
  }
  return selectors;
};

const classTokens = (selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

// Bare tags of the selector (outside [attr], with no . # : - prefix).
const tagTokens = (selector) =>
  [...selector.replace(/\[[^\]]*\]/g, "").matchAll(/(?:^|[\s>+~(])([a-z][a-z0-9]*)\b/g)]
    .map((m) => m[1])
    .filter((tag) => !["not", "hover", "focus", "active", "disabled", "checked"].includes(tag));

// Attribute names of the selector ([data-bs-theme=dark] and the like).
const attrTokens = (selector) => [...selector.matchAll(/\[([a-zA-Z-]+)/g)].map((m) => m[1]);

const originalSelectors = parseSelectors(read("site/assets/vendor/bootstrap/bootstrap.min.css"));
const purgedSelectors = parseSelectors(read("site/assets/vendor/bootstrap/bootstrap.purged.min.css"));

const missing = [];
for (const selector of originalSelectors) {
  const classes = classTokens(selector);
  if (classes.length === 0) continue; // element/attr-only: PurgeCSS keeps it
  if (!classes.every((cls) => usedClasses.has(cls))) continue; // can never apply
  // Constrained to a tag or attribute the site never produces => can never apply
  // (e.g. fieldset:disabled .btn, .navbar[data-bs-theme=dark]).
  if (!tagTokens(selector).every((tag) => usedTags.has(tag))) continue;
  if (!attrTokens(selector).every((attr) => corpusText.includes(attr))) continue;
  if (!purgedSelectors.has(selector)) missing.push(selector);
}

if (missing.length > 0) {
  console.error("✗ Seletores Bootstrap aplicáveis ao site mas ausentes do bootstrap.purged.min.css:");
  for (const selector of missing.sort()) console.error(`  - ${selector}`);
  console.error("\nRegenere o purge: ver scripts/purgecss.config.cjs");
  process.exit(1);
}

console.log(
  `✓ Bootstrap purgado cobre os seletores aplicáveis ` +
    `(${purgedSelectors.size}/${originalSelectors.size} seletores mantidos)`
);
