#!/usr/bin/env node
/**
 * The vendored fa-solid-900.woff2 carries only the glyphs the site uses, so a failure
 * here means a new icon arrived and the subset has to be regenerated.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { collectFiles, htmlFilesIn, bundleDirs } = require("./site-builder/corpus.js");

// site/ holds one publication at a time; dist/<id>/ (npm run build:all) holds all of
// them, so the check covers every publication whenever the bundles are around.
const bundles = bundleDirs(root);

const sources = [
  ...collectFiles(root, "src", [".html", ".js"]),
  ...collectFiles(root, "site/assets/js", [".js"]),
  ...htmlFilesIn(root, "site"),
  ...bundles.flatMap((dir) => htmlFilesIn(root, dir)),
];

const usedNames = new Set();
for (const file of sources) {
  const text = readFileSync(join(root, file), "utf8");
  for (const match of text.matchAll(/\bfa-[a-z0-9-]+/g)) {
    usedNames.add(match[0]);
  }
}

// First-party CSS can consume a glyph by raw codepoint (maps.css uses content: "\f078"
// with font-family "Font Awesome 6 Free"). src/ covers the per-publication CSS that
// only ever reaches the generated site of a non-default publication.
const cssDirs = ["site/assets/css", "src", ...bundles.map((dir) => join(dir, "assets/css"))];
const usedCodepoints = new Set();
// Every escape of the whole declaration, rather than one expected spelling: an escape
// may be terminated by a space (Font Awesome's own idiom, `content: "\f078 "`), the
// value may use single quotes, and one declaration may carry two glyphs. Miss any and
// the browser renders an empty box.
for (const file of cssDirs.flatMap((dir) => collectFiles(root, dir, [".css"]))) {
  const text = readFileSync(join(root, file), "utf8");
  for (const declaration of text.matchAll(/(?:^|[\s;{}])content\s*:\s*([^;}]+)/g)) {
    for (const escaped of declaration[1].matchAll(/\\([0-9a-fA-F]{4,6})/g)) {
      usedCodepoints.add(escaped[1].toLowerCase());
    }
  }
}

// A real glyph has a :before{content:"\f..."} rule; utility classes (fa-2x, fa-fw)
// match the fa- scan above but have none.
const faCss = readFileSync(join(root, "site/assets/vendor/fontawesome/css/all.min.css"), "utf8");
const glyphNames = new Set();
for (const match of faCss.matchAll(/((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"\\[0-9a-f]+"\}/g)) {
  for (const name of match[1].matchAll(/\.(fa-[a-z0-9-]+):before/g)) {
    glyphNames.add(name[1]);
  }
}

const manifest = JSON.parse(readFileSync(join(root, "site/assets/vendor/fontawesome/subset-glyphs.json"), "utf8"));
const subsetted = new Set(Object.keys(manifest.glyphs));

const subsettedCodepoints = new Set(Object.values(manifest.glyphs).map((code) => code.toLowerCase()));

const missing = [...usedNames].filter((name) => glyphNames.has(name) && !subsetted.has(name)).sort();
for (const code of usedCodepoints) {
  if (!subsettedCodepoints.has(code)) missing.push(`(codepoint em CSS) \\${code}`);
}

if (missing.length > 0) {
  console.error(
    "✗ Ícones usados no site mas AUSENTES do subset de fa-solid-900.woff2 " + "(renderizariam como caixas vazias):"
  );
  for (const name of missing) console.error(`  - ${name}`);
  console.error("\nRegenere o subset: ver scripts/subset-fontawesome.md");
  process.exit(1);
}

console.log(`✓ Subset Font Awesome cobre todos os ${subsetted.size} glifos usados`);
