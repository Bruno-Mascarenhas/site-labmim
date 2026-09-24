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
const {
  I_TAG,
  glyphCodepoints,
  hasFontAwesomeClass,
  manifestDisagreements,
} = require("./site-builder/fontawesome-glyphs.js");

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function fail(header, entries, hint) {
  console.error(header);
  for (const entry of entries) console.error(`  - ${entry}`);
  console.error(`\n${hint}`);
  process.exit(1);
}

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
const templatedIconClasses = [];
const unprefixedFaIcons = [];
for (const file of sources) {
  const text = readFileSync(join(root, file), "utf8");
  for (const match of text.matchAll(/\bfa-[a-z0-9-]+/g)) {
    usedNames.add(match[0]);
  }
  for (const match of text.matchAll(/\bfa-[a-z0-9-]*\$\{/g)) {
    templatedIconClasses.push(`${file}:${lineOf(text, match.index)}: ${match[0]}`);
  }
  for (const match of text.matchAll(/\bfaIcon\s*:\s*["'`](?!fa-)[^"'`]*["'`]/g)) {
    unprefixedFaIcons.push(`${file}:${lineOf(text, match.index)}: ${match[0]}`);
  }
}

if (templatedIconClasses.length > 0) {
  fail(
    "✗ Classe Font Awesome montada por template string " +
      "(o nome do glifo não aparece no código, e o subset pode ficar sem ele):",
    templatedIconClasses,
    'Guarde o nome completo na configuração ("fa-fan", não "fan") e interpole a classe inteira: ' +
      'class="fas ${icone}".'
  );
}

if (unprefixedFaIcons.length > 0) {
  fail(
    "✗ faIcon sem o prefixo fa- (a classe do título do modal não casaria com glifo nenhum, " +
      "e o check não veria o nome para conferir o subset):",
    unprefixedFaIcons,
    'Escreva o nome completo do glifo: faIcon: "fa-fan", não "fan".'
  );
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
const glyphNames = new Set(glyphCodepoints(faCss).keys());

const manifest = JSON.parse(readFileSync(join(root, "site/assets/vendor/fontawesome/subset-glyphs.json"), "utf8"));
const subsetted = new Set(Object.keys(manifest.glyphs));

const subsettedCodepoints = new Set(Object.values(manifest.glyphs).map((code) => code.toLowerCase()));

const missing = [...usedNames].filter((name) => glyphNames.has(name) && !subsetted.has(name)).sort();
for (const code of usedCodepoints) {
  if (!subsettedCodepoints.has(code)) missing.push(`(codepoint em CSS) \\${code}`);
}

if (missing.length > 0) {
  fail(
    "✗ Ícones usados no site mas AUSENTES do subset de fa-solid-900.woff2 " + "(renderizariam como caixas vazias):",
    missing,
    "Regenere o subset: ver scripts/subset-fontawesome.md"
  );
}

const subsetCssPath = "site/assets/vendor/fontawesome/css/fa.subset.min.css";
const subsetCssCodepoints = glyphCodepoints(readFileSync(join(root, subsetCssPath), "utf8"));

const staleSubsetCss = manifestDisagreements(manifest, subsetCssCodepoints).map(
  ({ name, declared }) => `${name} (\\${declared})`
);
for (const name of subsetCssCodepoints.keys()) {
  if (!subsetted.has(name)) staleSubsetCss.push(`${name} (fora do manifesto)`);
}

if (staleSubsetCss.length > 0) {
  fail(
    `✗ ${subsetCssPath} não acompanha subset-glyphs.json (o ícone não teria regra :before):`,
    staleSubsetCss.sort(),
    "Regenere o CSS: npm run subset:icons-css (ver scripts/subset-fontawesome.md)"
  );
}

let scriptIconCount = 0;
const scriptIconsWithoutAriaHidden = [];
for (const file of collectFiles(root, "site/assets/js", [".js"])) {
  const text = readFileSync(join(root, file), "utf8");
  for (const tag of text.matchAll(I_TAG)) {
    if (!hasFontAwesomeClass(tag[1])) continue;
    scriptIconCount += 1;
    if (/(?<![\w-])aria-hidden\s*=\s*["']true["']/.test(tag[1])) continue;
    scriptIconsWithoutAriaHidden.push(`${file}:${lineOf(text, tag.index)}: ${tag[0].replace(/\s+/g, " ")}`);
  }
}

if (scriptIconsWithoutAriaHidden.length > 0) {
  fail(
    '✗ Ícones Font Awesome montados em JS sem aria-hidden="true" ' +
      "(o leitor de tela anunciaria o glifo de uso privado no nome do controle):",
    scriptIconsWithoutAriaHidden,
    'Acrescente aria-hidden="true" ao <i>. Se o ícone for o único conteúdo do controle, dê aria-label ao controle.'
  );
}

console.log(`✓ Subset Font Awesome cobre todos os ${subsetted.size} glifos usados`);
console.log(`✓ Os ${scriptIconCount} ícones montados por string HTML em site/assets/js têm aria-hidden="true"`);
