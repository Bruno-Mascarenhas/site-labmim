/**
 * PurgeCSS configuration that generates
 * assets/vendor/bootstrap/bootstrap.purged.min.css from the full bootstrap.min.css
 * (which stays vendored alongside it).
 *
 * To regenerate (after changing Bootstrap classes in the HTML/JS):
 *   npm run purge:bootstrap
 *
 * Use the script, not the CLI directly: PurgeCSS names its output after the basename
 * of the input, so `--output site/assets/vendor/bootstrap/` overwrites the very full
 * bootstrap.min.css that serves as its source.
 *
 * The purged file is a SINGLE file shared by every publication, but `site/` holds one
 * publication at a time. That is why the analysed content includes `dist/<id>/*.html`
 * (the output of `npm run build:all`): regenerating from `site/` alone would strip
 * classes used only by the other publications.
 *
 * The `npm run lint:purge` check (scripts/check-bootstrap-purge.mjs) fails when a new
 * Bootstrap class reaches the site without a rule in the purged file.
 *
 * The safelist covers the classes Bootstrap's JS plugins toggle at runtime (only
 * collapse and modal are used on the site) plus generic states.
 */
module.exports = {
  content: ["site/*.html", "dist/*/*.html", "site/assets/js/**/*.js"],
  css: ["site/assets/vendor/bootstrap/bootstrap.min.css"],
  // Keep the --bs-* variables and the @keyframes (spinner-border drives the loading
  // overlays of the maps).
  variables: false,
  keyframes: false,
  fontFace: false,
  safelist: {
    standard: [
      // Bootstrap Collapse (navbar)
      "collapse",
      "collapsing",
      "collapse-horizontal",
      "show",
      "showing",
      "hiding",
      "fade",
      // Bootstrap Modal (monitoring page)
      "modal-open",
      "modal-backdrop",
      "modal-static",
      // Generic states toggled at runtime
      "active",
      "disabled",
    ],
    deep: [],
    greedy: [],
  },
};
