#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { discoverPublications } = require("./site-builder/publications.js");
const { PUBLICATION_THEME_PROPERTIES, inspectPublicationThemeCss } = require("./site-builder/theme-contract.js");

const cssRoot = path.join(root, "site", "assets", "css");

function collectStylesheets(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name === "generated") return [];
      if (entry.isDirectory()) return collectStylesheets(candidate);
      return entry.isFile() && entry.name.endsWith(".css") && entry.name !== "site-theme.css" ? [candidate] : [];
    })
    .sort();
}

const sharedStylesheets = collectStylesheets(cssRoot);

const publications = discoverPublications(root);
const errors = [];
const sharedCss = sharedStylesheets.map((file) => fs.readFileSync(file, "utf8")).join("\n");

for (const publication of publications) {
  const themePath = path.join(publication.directory, publication.theme);
  const content = fs.readFileSync(themePath, "utf8");
  for (const error of inspectPublicationThemeCss(content)) {
    errors.push(`${path.relative(root, themePath)}: ${error}`);
  }
}

if (/\[\s*data-(?:publication|territory)\b/i.test(sharedCss)) {
  errors.push("shared CSS must not branch on data-publication or data-territory selectors");
}

const headTemplate = fs.readFileSync(path.join(root, "src", "template", "partials", "head.html"), "utf8");
const cascadeMarkers = [
  "{{pageVendorStyles}}",
  "assets/css/base.css",
  "assets/css/site-theme.css",
  "assets/css/layout.css",
  "assets/css/components.css",
  "{{pageStyles}}",
  "assets/css/theme.css",
];
let previousIndex = -1;
for (const marker of cascadeMarkers) {
  const markerIndex = headTemplate.indexOf(marker);
  if (markerIndex < 0) {
    errors.push(`head template is missing CSS cascade marker ${marker}`);
  } else if (markerIndex <= previousIndex) {
    errors.push(`CSS cascade order must be ${cascadeMarkers.join(" -> ")}`);
  }
  previousIndex = markerIndex;
}

const layoutsDirectory = path.join(root, "src", "template", "layouts");
for (const layout of fs.readdirSync(layoutsDirectory).filter((name) => name.endsWith(".html"))) {
  const content = fs.readFileSync(path.join(layoutsDirectory, layout), "utf8");
  if (/<link\b[^>]*\brel=["']stylesheet["']/i.test(content)) {
    errors.push(`${layout}: stylesheets must use the head slots so color-mode CSS stays last`);
  }
}

for (const property of PUBLICATION_THEME_PROPERTIES) {
  if (!sharedCss.includes(`var(--${property})`)) {
    errors.push(`theme contract property --${property} is not consumed by shared CSS`);
  }

  const declarations = sharedCss.matchAll(new RegExp(`--${property}\\s*:\\s*([^;}]+)[;}]`, "g"));
  for (const declaration of declarations) {
    if (!declaration[1].trim().startsWith("var(")) {
      errors.push(`shared CSS must not assign a literal value to publication token --${property}`);
    }
  }
}

if (errors.length > 0) {
  throw new Error(`Invalid CSS publication boundary:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
}

console.log(
  `theme-check: ${publications.length} publication themes implement ${PUBLICATION_THEME_PROPERTIES.length} identity tokens; shared CSS is publication-agnostic`
);
