#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { GLYPH_RULE, glyphCodepoints } = require("./site-builder/fontawesome-glyphs.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontAwesomeDir = path.join(root, "site", "assets", "vendor", "fontawesome");
const source = path.join(fontAwesomeDir, "css", "all.min.css");
const target = path.join(fontAwesomeDir, "css", "fa.subset.min.css");
const manifestPath = path.join(fontAwesomeDir, "subset-glyphs.json");

const LICENSE_BANNER = /^\/\*![\s\S]*?\*\//;
const SUBSET_FONT_FACE_FAMILY = 'font-family:"Font Awesome 6 Free"';
const SUBSET_FONT_FACE_WEIGHT = "font-weight:900";

function topLevelRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    if (css[index] === "{") depth++;
    if (css[index] !== "}") continue;
    depth--;
    if (depth < 0) throw new Error(`unbalanced "}" at offset ${index} of ${path.relative(root, source)}`);
    if (depth === 0) {
      rules.push(css.slice(start, index + 1).trim());
      start = index + 1;
    }
  }
  if (depth !== 0 || css.slice(start).trim()) {
    throw new Error(`${path.relative(root, source)} ends inside a rule`);
  }
  return rules;
}

function isSubsetFontFace(rule) {
  return rule.includes(SUBSET_FONT_FACE_FAMILY) && rule.includes(SUBSET_FONT_FACE_WEIGHT);
}

function manifestGlyphRules(manifest, codepoints) {
  const problems = [];
  const rules = Object.entries(manifest.glyphs)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, code]) => {
      const expected = codepoints.get(name);
      if (!expected) problems.push(`${name}: no :before rule in all.min.css`);
      else if (expected !== code.toLowerCase())
        problems.push(`${name}: manifest says ${code}, all.min.css says ${expected}`);
      return `.${name}:before{content:"\\${expected}"}`;
    });
  if (problems.length > 0) {
    throw new Error(
      `subset-glyphs.json disagrees with all.min.css:\n${problems.map((item) => `  - ${item}`).join("\n")}`
    );
  }
  return rules;
}

function subsetCss(fullCss, manifest) {
  const banner = LICENSE_BANNER.exec(fullCss);
  if (!banner) throw new Error(`${path.relative(root, source)} lost its /*! license banner`);
  const rules = topLevelRules(fullCss.slice(banner[0].length));
  const topLevelGlyphRules = rules.filter((rule) => GLYPH_RULE.test(rule)).join("");
  const glyphRules = manifestGlyphRules(manifest, glyphCodepoints(topLevelGlyphRules));

  const kept = [];
  let glyphsPlaced = false;
  for (const rule of rules) {
    if (GLYPH_RULE.test(rule)) {
      if (!glyphsPlaced) kept.push(...glyphRules);
      glyphsPlaced = true;
      continue;
    }
    if (rule.startsWith("@font-face") && !isSubsetFontFace(rule)) continue;
    kept.push(rule);
  }

  const fontFaces = kept.filter((rule) => rule.startsWith("@font-face"));
  if (fontFaces.length !== 1) {
    throw new Error(`expected exactly one solid 900 @font-face in all.min.css, found ${fontFaces.length}`);
  }
  return `${banner[0]}\n${kept.join("")}\n`;
}

function main() {
  const fullCss = fs.readFileSync(source, "utf8");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const before = fs.existsSync(target) ? fs.statSync(target).size : 0;
  fs.writeFileSync(target, subsetCss(fullCss, manifest));
  const after = fs.statSync(target).size;

  console.log(
    `subset-fontawesome-css: wrote ${path.relative(root, target)} ` +
      `(${after} bytes, was ${before}; all.min.css is ${Buffer.byteLength(fullCss)} bytes, ` +
      `${Object.keys(manifest.glyphs).length} glyphs)`
  );
  console.log(
    "subset-fontawesome-css: run `npm run lint:icons` and commit site/ — the ?v= hash changed for every page."
  );
}

try {
  main();
} catch (error) {
  console.error(`✗ subset-fontawesome-css: ${error.message}`);
  process.exit(1);
}
