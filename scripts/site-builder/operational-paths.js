"use strict";

/**
 * Operational data paths: what the deploy delivers and git never sees.
 *
 * Two different questions live here.
 *
 * `publicationOperationalPaths` answers "what does THIS publication declare". It
 * serves validation and description — a publication's robots.txt must not announce
 * a directory its own deploy never receives.
 *
 * `allOperationalPaths` answers "what is operational data anywhere in THIS tree".
 * That is the one that governs bundling and sweeping `site/`, because `site/` is
 * rebuilt in place for every publication and the data directories are NOT deleted
 * between one build and the next: the previous publication's `site/Climatologia/` is
 * still on disk while the next one is bundled. Deriving the exclusion from the
 * current publication's dataset alone lets a bundle carry another laboratory's
 * climatology and monitoring — sensor-archive data that is not public — inside a
 * different institution's release.
 */

// Station plots: PNGs rewritten in place by the weather station itself, with the
// laboratory's watermark burnt into the image. They are versioned for the default
// publication, so shipping them inside another publication's bundle would publish the
// wrong laboratory's mark.
const DEFAULT_GRAPHS_DIRECTORY = "assets/graphs";

/**
 * `includeGraphs` separates two uses that do not coincide. Bundling excludes the
 * station plots, otherwise one laboratory's bundle ships the other's watermark. The
 * link check needs to see them: the PNGs are versioned, so a typo in a
 * `dataset.observations` src must break the gate instead of being waved through as
 * "data the deploy delivers".
 */
function publicationOperationalPaths(publication, { includeGraphs = true } = {}) {
  const {
    manifest,
    values,
    grids,
    climatology,
    monitoring,
    graphs = DEFAULT_GRAPHS_DIRECTORY,
  } = publication.dataset.paths;
  return {
    // `climatology` and `monitoring` are optional: only a publication that publishes
    // its own station's record declares them.
    directories: [...new Set([values, grids, climatology, monitoring, includeGraphs ? graphs : null].filter(Boolean))],
    files: new Set([manifest].filter(Boolean)),
  };
}

function allOperationalPaths(publications, options) {
  const directories = new Set();
  const files = new Set();
  for (const publication of publications) {
    const declared = publicationOperationalPaths(publication, options);
    declared.directories.forEach((directory) => directories.add(directory));
    declared.files.forEach((file) => files.add(file));
  }
  return { directories: [...directories], files };
}

function isOperationalPath(relativePath, { directories, files }) {
  const normalized = String(relativePath).split("\\").join("/");
  if (files.has(normalized)) return true;
  return directories.some((directory) => normalized === directory || normalized.startsWith(`${directory}/`));
}

module.exports = {
  DEFAULT_GRAPHS_DIRECTORY,
  publicationOperationalPaths,
  allOperationalPaths,
  isOperationalPath,
};
