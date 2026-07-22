"use strict";

const PUBLICATION_THEME_PROPERTIES = Object.freeze([
  "accent-color",
  "brand-primary",
  "brand-secondary",
  "brand-primary-rgb",
  "brand-secondary-rgb",
  "accent-rgb",
  "monitoring-overlay",
  "map-accent",
  "map-accent-2",
  "map-accent-rgb",
  "lab-header-bg",
  "lab-header-dark-bg",
  "lab-footer-bg",
  "lab-footer-dark-bg",
  "maps-header-bg",
  "maps-header-dark-bg",
  "dark-accent",
  "dark-accent-hover",
  "dark-accent-rgb",
]);

const COLOR_RGB_PAIRS = Object.freeze([
  ["brand-primary", "brand-primary-rgb"],
  ["brand-secondary", "brand-secondary-rgb"],
  ["accent-color", "accent-rgb"],
  ["map-accent", "map-accent-rgb"],
  ["dark-accent", "dark-accent-rgb"],
]);

function parseHexColor(value) {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit.repeat(2)).join("") : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
}

function parseRgbChannels(value) {
  const match = value.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (!match) return null;
  const channels = match.slice(1).map(Number);
  return channels.every((channel) => channel <= 255) ? channels : null;
}

function inspectPublicationThemeCss(content) {
  const errors = [];
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const root = withoutComments.match(/^:root\s*\{([\s\S]*)\}\s*$/);

  if (!root) {
    return ["must contain exactly one :root block and no publication-specific selectors"];
  }

  const declarations = root[1]
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  const seen = new Set();
  const values = new Map();

  for (const declaration of declarations) {
    const match = declaration.match(/^--([a-z0-9-]+)\s*:\s*(.+)$/s);
    if (!match) {
      errors.push(`only custom-property declarations are allowed (found ${JSON.stringify(declaration)})`);
      continue;
    }

    const property = match[1];
    if (seen.has(property)) errors.push(`duplicate custom property --${property}`);
    seen.add(property);
    values.set(property, match[2].trim());
    if (!PUBLICATION_THEME_PROPERTIES.includes(property)) {
      errors.push(`unexpected custom property --${property}; add shared capabilities to the theme contract first`);
    }
  }

  for (const property of PUBLICATION_THEME_PROPERTIES) {
    if (!seen.has(property)) errors.push(`missing required custom property --${property}`);
  }

  for (const [colorProperty, rgbProperty] of COLOR_RGB_PAIRS) {
    if (!values.has(colorProperty) || !values.has(rgbProperty)) continue;
    const color = parseHexColor(values.get(colorProperty));
    const channels = parseRgbChannels(values.get(rgbProperty));
    if (!color) {
      errors.push(`--${colorProperty} must use #rgb or #rrggbb so its RGB companion can be verified`);
    } else if (!channels) {
      errors.push(`--${rgbProperty} must contain three channels between 0 and 255`);
    } else if (color.some((channel, index) => channel !== channels[index])) {
      errors.push(`--${rgbProperty} must match --${colorProperty} (${color.join(", ")})`);
    }
  }

  return errors;
}

module.exports = { PUBLICATION_THEME_PROPERTIES, inspectPublicationThemeCss };
