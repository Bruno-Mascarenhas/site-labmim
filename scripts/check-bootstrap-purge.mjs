#!/usr/bin/env node
/**
 * Verifica que o bootstrap.purged.min.css cobre todo seletor do
 * bootstrap.min.css completo que PODE se aplicar ao site: um seletor cujas
 * classes estão todas presentes no HTML gerado / JS próprio (ou na lista de
 * classes que os plugins do Bootstrap alternam em runtime) precisa continuar
 * existindo no arquivo purgado. Falha => regenerar o purge
 * (scripts/purgecss.config.cjs).
 *
 * Apenas stdlib do Node, como o build.js.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { collectFiles, htmlFilesIn, bundleDirs } = require("./site-builder/corpus.js");

const read = (rel) => readFileSync(join(root, rel), "utf8");

// ---------------------------------------------------------------------------
// Classes usadas: atributos class="..." do HTML gerado + strings no JS próprio
// + classes que os plugins do Bootstrap em uso (collapse, modal) alternam.
// ---------------------------------------------------------------------------
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

const htmlCorpus = [];
for (const file of htmlFiles) {
  const text = read(file);
  htmlCorpus.push(text);
  for (const match of text.matchAll(/class="([^"]*)"/g)) {
    for (const cls of match[1].split(/\s+/)) if (cls) usedClasses.add(cls);
  }
  for (const match of text.matchAll(/<([a-z][a-z0-9]*)/g)) usedTags.add(match[1]);
}
for (const file of collectFiles(root, "site/assets/js", [".js"])) {
  const text = read(file);
  htmlCorpus.push(text);
  for (const match of text.matchAll(/["'`]([\w\s-]+)["'`]/g)) {
    for (const cls of match[1].split(/\s+/)) if (cls) usedClasses.add(cls);
  }
}
const corpusText = htmlCorpus.join("\n");

// ---------------------------------------------------------------------------
// Seletores de um CSS minificado: texto antes de cada '{' que não seja
// at-rule; cada seletor individual (separado por vírgula) é normalizado.
// ---------------------------------------------------------------------------
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

// Tags "puras" do seletor (fora de [attr], sem prefixo . # : -).
const tagTokens = (selector) =>
  [...selector.replace(/\[[^\]]*\]/g, "").matchAll(/(?:^|[\s>+~(])([a-z][a-z0-9]*)\b/g)]
    .map((m) => m[1])
    .filter((tag) => !["not", "hover", "focus", "active", "disabled", "checked"].includes(tag));

// Nomes de atributo do seletor ([data-bs-theme=dark] etc.).
const attrTokens = (selector) => [...selector.matchAll(/\[([a-zA-Z-]+)/g)].map((m) => m[1]);

const originalSelectors = parseSelectors(read("site/assets/vendor/bootstrap/bootstrap.min.css"));
const purgedSelectors = parseSelectors(read("site/assets/vendor/bootstrap/bootstrap.purged.min.css"));

const missing = [];
for (const selector of originalSelectors) {
  const classes = classTokens(selector);
  if (classes.length === 0) continue; // element/attr-only: PurgeCSS mantém
  if (!classes.every((cls) => usedClasses.has(cls))) continue; // nunca se aplica
  // Constrangido a uma tag ou atributo que o site nunca produz => nunca se
  // aplica (ex.: fieldset:disabled .btn, .navbar[data-bs-theme=dark]).
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
