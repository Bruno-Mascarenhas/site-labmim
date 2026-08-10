"use strict";

// Shared by scripts/build-all.mjs (narrows each bundle to the reachable assets) and
// scripts/check-publications.mjs (fails on a reference to a missing file). If the two
// disagreed, an asset could be dropped from a bundle yet pass the reference check.

// Only srcset is comma-separated; splitting the other attributes on commas would shred
// a data: URI or a query string that legitimately contains them (favicon SVG, Maps embed).
function htmlReferences(html) {
  const references = [];
  for (const match of html.matchAll(/\b(href|src|srcset)=(?:"([^"]+)"|'([^']+)')/g)) {
    const attribute = match[1];
    const value = match[2] ?? match[3];
    if (attribute === "srcset") {
      references.push(...value.split(",").map((entry) => entry.trim().split(/\s+/, 1)[0]));
    } else {
      references.push(value);
    }
  }
  return references;
}

function cssReferences(css) {
  const references = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) references.push(match[2]);
  return references;
}

function isExternalReference(reference, originPrefix) {
  if (!reference) return true;
  if (originPrefix && reference.startsWith(originPrefix)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//") || reference.startsWith("#");
}

// Normalize the WHOLE reference, never the tail starting at the first `assets/` it
// happens to contain: cutting there rewrites `/vendor/assets/x.png` to `assets/x.png`,
// and both gates would then vouch for a different file from the one the page fetches.
function assetKey(reference, originPrefix) {
  let clean = reference.split(/[?#]/, 1)[0].trim();
  if (originPrefix && clean.startsWith(originPrefix)) clean = clean.slice(originPrefix.length);
  return clean.replace(/^\//, "");
}

module.exports = { htmlReferences, cssReferences, isExternalReference, assetKey };
