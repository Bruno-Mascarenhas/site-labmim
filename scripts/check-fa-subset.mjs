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

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const collectFiles = (dir, exts, out = []) => {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "vendor" || entry.name === "node_modules") continue;
      collectFiles(rel, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(rel);
    }
  }
  return out;
};

const sources = [
  ...collectFiles("src", [".html"]),
  ...collectFiles("site/assets/js", [".js"]),
  ...readdirSync(join(root, "site"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => join("site", name)),
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
const usedCodepoints = new Set();
for (const file of collectFiles("site/assets/css", [".css"])) {
  const text = readFileSync(join(root, file), "utf8");
  for (const match of text.matchAll(/content:\s*"\\([0-9a-fA-F]{4,6})"/g)) {
    usedCodepoints.add(match[1].toLowerCase());
  }
}

// Só nomes que são glifos de verdade (têm regra :before{content:"\f..."} no
// CSS do Font Awesome); classes utilitárias (fa-2x, fa-fw, ...) não têm.
const faCss = readFileSync(
  join(root, "site/assets/vendor/fontawesome/css/all.min.css"),
  "utf8"
);
const glyphNames = new Set();
for (const match of faCss.matchAll(/((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"\\[0-9a-f]+"\}/g)) {
  for (const name of match[1].matchAll(/\.(fa-[a-z0-9-]+):before/g)) {
    glyphNames.add(name[1]);
  }
}

const manifest = JSON.parse(
  readFileSync(join(root, "site/assets/vendor/fontawesome/subset-glyphs.json"), "utf8")
);
const subsetted = new Set(Object.keys(manifest.glyphs));

const subsettedCodepoints = new Set(
  Object.values(manifest.glyphs).map((code) => code.toLowerCase())
);

const missing = [...usedNames]
  .filter((name) => glyphNames.has(name) && !subsetted.has(name))
  .sort();
for (const code of usedCodepoints) {
  if (!subsettedCodepoints.has(code)) missing.push(`(codepoint em CSS) \\${code}`);
}

if (missing.length > 0) {
  console.error(
    "✗ Ícones usados no site mas AUSENTES do subset de fa-solid-900.woff2 " +
      "(renderizariam como caixas vazias):"
  );
  for (const name of missing) console.error(`  - ${name}`);
  console.error("\nRegenere o subset: ver scripts/subset-fontawesome.md");
  process.exit(1);
}

console.log(`✓ Subset Font Awesome cobre todos os ${subsetted.size} glifos usados`);
