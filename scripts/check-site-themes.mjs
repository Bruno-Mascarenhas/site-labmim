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
  parseHexColor,
} = require("./site-builder/theme-contract.js");

const WCAG_AA_BODY_TEXT_CONTRAST = 4.5;
const FOCUS_RING_MIN_CONTRAST_WITH_WHITE = 9;
const WCAG_CONTRAST_FLARE = 0.05;
const WCAG_LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722];
const SRGB_CHANNEL_MAX = 255;
const SRGB_LINEAR_SEGMENT_LIMIT = 0.04045;
const SRGB_LINEAR_SEGMENT_SLOPE = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_SCALE = 1.055;
const SRGB_GAMMA_EXPONENT = 2.4;
const WHITE_RELATIVE_LUMINANCE = 1;
const TONES_CHECKED_AGAINST_WHITE = Object.freeze([
  {
    property: "map-accent-strong",
    fallbackProperty: null,
    minContrast: WCAG_AA_BODY_TEXT_CONTRAST,
    requirement: `the WCAG AA ${WCAG_AA_BODY_TEXT_CONTRAST}:1 for white body text on it`,
  },
  {
    property: "brand-secondary-strong",
    fallbackProperty: "brand-secondary",
    minContrast: WCAG_AA_BODY_TEXT_CONTRAST,
    requirement: `the WCAG AA ${WCAG_AA_BODY_TEXT_CONTRAST}:1 for white body text on it`,
  },
  {
    property: "brand-primary-strong",
    fallbackProperty: "brand-primary",
    minContrast: FOCUS_RING_MIN_CONTRAST_WITH_WHITE,
    requirement: `the ${FOCUS_RING_MIN_CONTRAST_WITH_WHITE}:1 the focus ring and its white band need to reach 3:1 on any map background`,
  },
]);

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

function relativeLuminance(channels) {
  return channels.reduce((sum, channel, index) => {
    const unit = channel / SRGB_CHANNEL_MAX;
    const linear =
      unit <= SRGB_LINEAR_SEGMENT_LIMIT
        ? unit / SRGB_LINEAR_SEGMENT_SLOPE
        : ((unit + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_SCALE) ** SRGB_GAMMA_EXPONENT;
    return sum + WCAG_LUMINANCE_WEIGHTS[index] * linear;
  }, 0);
}

function contrastWithWhite(channels) {
  return (WHITE_RELATIVE_LUMINANCE + WCAG_CONTRAST_FLARE) / (relativeLuminance(channels) + WCAG_CONTRAST_FLARE);
}

function declaredThemeValue(themeCss, property) {
  return themeCss.match(new RegExp(`(?<![\\w-])--${property}\\s*:\\s*([^;}]+)`))?.[1].trim();
}

/** Matches `var(--token)` and `var(--token, fallback)` but never `var(--token-suffix)`. */
function consumesCssToken(css, property) {
  return new RegExp(`var\\(\\s*--${property}\\s*[,)]`).test(css);
}

/**
 * The `[^)\s]` after the comma accepts function values (rgba(...), gradients) without
 * trying to match the whole value — proving a fallback exists is enough.
 */
function consumesCssTokenWithFallback(css, property) {
  return new RegExp(`var\\(\\s*--${property}\\s*,\\s*[^)\\s]`).test(css);
}

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

  const declarations = content.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const { property, fallbackProperty, minContrast, requirement } of TONES_CHECKED_AGAINST_WHITE) {
    const resolvedProperty =
      declaredThemeValue(declarations, property) === undefined && fallbackProperty ? fallbackProperty : property;
    const value = declaredThemeValue(declarations, resolvedProperty);
    const channels = value && parseHexColor(value);
    if (!channels) {
      errors.push(
        `${path.relative(root, themePath)}: --${resolvedProperty} must be #rgb or #rrggbb so its contrast with white can be checked`
      );
      continue;
    }
    const contrast = contrastWithWhite(channels);
    if (contrast < minContrast) {
      errors.push(
        `${path.relative(root, themePath)}: --${property} (${resolvedProperty === property ? value : `${value} from --${resolvedProperty}`}) reaches ${contrast.toFixed(2)}:1 against white, below ${requirement}`
      );
    }
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
    // Leave previousIndex on the last marker that WAS found: index -1 would reset the
    // baseline and hide an ordering error in the markers that follow.
    continue;
  }
  if (markerIndex <= previousIndex) {
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

  // A required token has no fallback: a literal assigned in shared CSS would take the
  // colour away from the publication's own identity.
  const declarations = sharedCss.matchAll(new RegExp(`--${property}\\s*:\\s*([^;}]+)[;}]`, "g"));
  for (const declaration of declarations) {
    if (!declaration[1].trim().startsWith("var(")) {
      errors.push(`shared CSS must not assign a literal value to required theme token --${property}`);
    }
  }
}

// An optional token carries its fallback where it is read, so all that is checked here
// is that it IS read somewhere — otherwise declaring it in a theme.css does nothing.
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
    `every contract token is actually consumed; white text on --map-accent-strong and --brand-secondary-strong reaches ${WCAG_AA_BODY_TEXT_CONTRAST}:1 and the focus ring tone reaches ${FOCUS_RING_MIN_CONTRAST_WITH_WHITE}:1 against white;`,
    "the head template keeps the documented CSS cascade order",
    "and layouts link no stylesheet outside the head slots.",
  ].join(" ")
);
