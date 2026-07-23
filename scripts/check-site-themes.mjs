#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { discoverPublications } = require("./site-builder/publications.js");
const {
  REQUIRED_THEME_PROPERTIES,
  OPTIONAL_THEME_PROPERTIES,
  inspectPublicationThemeCss,
} = require("./site-builder/theme-contract.js");

const cssRoot = path.join(root, "site", "assets", "css");
const jsRoot = path.join(root, "site", "assets", "js");

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

function collectScripts(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectScripts(candidate);
      return entry.isFile() && entry.name.endsWith(".js") ? [candidate] : [];
    })
    .sort();
}

/** Casa `var(--token)` e `var(--token, fallback)` sem casar `var(--token-suffix)`. */
function consumesCssToken(css, property) {
  return new RegExp(`var\\(\\s*--${property}\\s*[,)]`).test(css);
}

/**
 * Casa apenas `var(--token, <fallback>)` com pelo menos um caractere de fallback.
 * O `[^)\s]` após a vírgula aceita valores de função (rgba(...), gradientes) sem
 * tentar casar o valor inteiro — basta provar que o fallback existe.
 */
function consumesCssTokenWithFallback(css, property) {
  return new RegExp(`var\\(\\s*--${property}\\s*,\\s*[^)\\s]`).test(css);
}

/** Casa a leitura do token pelo JS (getPropertyValue("--token")). */
function consumesJsToken(js, property) {
  return new RegExp(`--${property}(?![\\w-])`).test(js);
}

const sharedStylesheets = collectStylesheets(cssRoot);
const sharedScripts = collectScripts(jsRoot);

const publications = discoverPublications(root);
const errors = [];
const sharedCss = sharedStylesheets.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const sharedJs = sharedScripts.map((file) => fs.readFileSync(file, "utf8")).join("\n");

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

for (const property of REQUIRED_THEME_PROPERTIES) {
  if (!consumesCssToken(sharedCss, property)) {
    errors.push(`required theme token --${property} is not consumed by shared CSS; use var(--${property}) or drop it`);
  }

  // Um token obrigatório não tem fallback: se o CSS compartilhado o definisse
  // com um literal, a identidade da publicação deixaria de valer.
  const declarations = sharedCss.matchAll(new RegExp(`--${property}\\s*:\\s*([^;}]+)[;}]`, "g"));
  for (const declaration of declarations) {
    if (!declaration[1].trim().startsWith("var(")) {
      errors.push(`shared CSS must not assign a literal value to required theme token --${property}`);
    }
  }
}

// Tokens opcionais podem (e devem) ter fallback no lugar onde são lidos: um
// literal em `var(--token, literal)` no CSS, ou um literal no JS que faz o
// getComputedStyle. Aqui só verificamos que o token realmente é lido em algum
// lugar — caso contrário declará-lo num theme.css não teria efeito nenhum.
for (const { property, consumedBy } of OPTIONAL_THEME_PROPERTIES) {
  if (consumedBy === "js") {
    if (!consumesJsToken(sharedJs, property)) {
      errors.push(
        `optional theme token --${property} is declared as JS-consumed but no script in site/assets/js reads it`
      );
    }
    continue;
  }

  if (!consumesCssTokenWithFallback(sharedCss, property)) {
    errors.push(
      `optional theme token --${property} must be consumed as var(--${property}, <valor de hoje>) with a fallback so publications that do not declare it keep the current look; a bare var(--${property}) would render empty`
    );
  }
}

if (errors.length > 0) {
  throw new Error(`Invalid CSS publication boundary:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
}

const optionalCssTokens = OPTIONAL_THEME_PROPERTIES.filter((entry) => entry.consumedBy === "css").length;
const optionalJsTokens = OPTIONAL_THEME_PROPERTIES.length - optionalCssTokens;

console.log(
  [
    `theme-check: ${publications.length} publication themes declare the ${REQUIRED_THEME_PROPERTIES.length} required identity tokens`,
    `and may opt into ${OPTIONAL_THEME_PROPERTIES.length} optional ones (${optionalCssTokens} read via var() in shared CSS, ${optionalJsTokens} read at runtime from site/assets/js).`,
    "Checked: theme files hold a single :root of contract tokens with matching #hex/RGB pairs;",
    "shared CSS carries no [data-publication]/[data-territory] branch and no literal assignment to a required token;",
    "every contract token is actually consumed; the head template keeps the documented CSS cascade order",
    "and layouts link no stylesheet outside the head slots.",
  ].join(" ")
);
