#!/usr/bin/env node
/**
 * Verifica que todo glifo Font Awesome usado no site está presente no subset
 * de fa-solid-900.woff2 (ver assets/vendor/fontawesome/subset-glyphs.json).
 *
 * A fonte vendorizada foi reduzida de ~150KB para ~6KB mantendo apenas os
 * glifos usados. Se este check falhar, um ícone novo foi adicionado e o
 * subset precisa ser regenerado — instruções em scripts/subset-fontawesome.md.
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

// site/ only ever holds one publication at a time. dist/<id>/ (npm run
// build:all) holds all of them, so the check covers every publication whenever
// the bundles are around; when they are not, this falls back to site/ + src/.
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

// CSS próprio pode consumir glifos por codepoint direto
// (ex.: maps.css content: "\f078" com font-family "Font Awesome 6 Free").
// Inclui o CSS por publicação em src/ (temas e estilos que só entram no site
// gerado da publicação não-padrão) e os bundles em dist/, quando existirem.
const cssDirs = ["site/assets/css", "src", ...bundles.map((dir) => join(dir, "assets/css"))];
const usedCodepoints = new Set();
for (const file of cssDirs.flatMap((dir) => collectFiles(root, dir, [".css"]))) {
  const text = readFileSync(join(root, file), "utf8");
  for (const match of text.matchAll(/content:\s*"\\([0-9a-fA-F]{4,6})"/g)) {
    usedCodepoints.add(match[1].toLowerCase());
  }
}

// Só nomes que são glifos de verdade (têm regra :before{content:"\f..."} no
// CSS do Font Awesome); classes utilitárias (fa-2x, fa-fw, ...) não têm.
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
