"use strict";

/**
 * The single source of truth for how the build reads asset references out of the
 * generated HTML and CSS. Two guards depend on agreeing about what counts as a
 * reference — scripts/build-all.mjs narrows each bundle to the assets a page can
 * reach, and scripts/check-publications.mjs fails when a page references a file that
 * does not exist. When the two disagree (they used to drift on `??` vs `||`), an
 * asset can be dropped from a bundle yet pass the local-reference check, so the
 * grammar lives here and both import it.
 */

/**
 * Every asset reference an HTML page makes through href/src/srcset. Only srcset is
 * comma-separated; splitting other attributes on commas would shred a data: URI or a
 * query string that legitimately contains commas (the favicon SVG, a Maps embed).
 */
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

/** Every asset reference a stylesheet makes through url(...). */
function cssReferences(css) {
  const references = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) references.push(match[2]);
  return references;
}

/**
 * True when a reference points off-site: another origin, a scheme (data:, mailto:,
 * tel:, https: to a foreign host), a protocol-relative URL, or a fragment. A path on
 * this publication's own origin is treated as first-party.
 */
function isExternalReference(reference, originPrefix) {
  if (!reference) return true;
  if (originPrefix && reference.startsWith(originPrefix)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//") || reference.startsWith("#");
}

/**
 * Normalize any first-party HTML/CSS reference to the `assets/...`-rooted key used
 * for lookups: strips an absolute-URL origin, the query/hash, and a leading slash so
 * `/assets/x.png`, `assets/x.png` and `https://origin/assets/x.png?v=1` all collapse
 * to `assets/x.png`.
 */
function assetKey(reference, originPrefix) {
  let clean = reference.split(/[?#]/, 1)[0].trim();
  if (originPrefix && clean.startsWith(originPrefix)) clean = clean.slice(originPrefix.length);
  const marker = clean.indexOf("assets/");
  return marker >= 0 ? clean.slice(marker) : clean.replace(/^\//, "");
}

module.exports = { htmlReferences, cssReferences, isExternalReference, assetKey };
