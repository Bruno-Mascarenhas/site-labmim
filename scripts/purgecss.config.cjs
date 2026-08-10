/**
 * Generates bootstrap.purged.min.css from the full bootstrap.min.css vendored beside
 * it. Regenerate with `npm run purge:bootstrap`, never the purgecss CLI directly —
 * see scripts/purge-bootstrap.mjs.
 */
module.exports = {
  // One purged file serves every publication while site/ holds one at a time, so the
  // corpus includes dist/<id>/*.html (npm run build:all); site/ alone would strip the
  // classes only another publication uses.
  content: ["site/*.html", "dist/*/*.html", "site/assets/js/**/*.js"],
  css: ["site/assets/vendor/bootstrap/bootstrap.min.css"],
  // false = do not purge: keeps the --bs-* variables and @keyframes (spinner-border
  // drives the loading overlays of the maps).
  variables: false,
  keyframes: false,
  fontFace: false,
  safelist: {
    // Toggled at runtime by Bootstrap's JS (collapse on the navbar, modal on
    // monitoring) or by ours, so they are kept whatever the corpus happens to show.
    standard: [
      "collapse",
      "collapsing",
      "collapse-horizontal",
      "show",
      "showing",
      "hiding",
      "fade",
      "modal-open",
      "modal-backdrop",
      "modal-static",
      "active",
      "disabled",
    ],
    deep: [],
    greedy: [],
  },
};
