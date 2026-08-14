"use strict";

// Operational data paths: what the deploy delivers and git never sees. Bundling and
// sweeping `site/` must go through `allOperationalPaths`, never the current publication's
// own declaration: `site/` is rebuilt in place and the data directories are NOT deleted
// between builds, so the previous publication's `site/Climatologia/` is still on disk
// while the next one is bundled — a narrower exclusion ships one laboratory's sensor
// archive inside another institution's release.

// Station plots: PNGs rewritten in place by the weather station itself, with the
// laboratory's watermark burnt into the image.
const DEFAULT_GRAPHS_DIRECTORY = "assets/graphs";

// Bundling excludes the station plots, or one laboratory's bundle ships the other's
// watermark. The link check needs to see them: the PNGs are versioned, so a typo in a
// `dataset.observations` src must break the gate instead of passing as deploy-delivered data.
function publicationOperationalPaths(publication, { includeGraphs = true } = {}) {
  const {
    manifest,
    values,
    grids,
    climatology,
    monitoring,
    sky,
    graphs = DEFAULT_GRAPHS_DIRECTORY,
  } = publication.dataset.paths;
  return {
    directories: [
      ...new Set([values, grids, climatology, monitoring, sky, includeGraphs ? graphs : null].filter(Boolean)),
    ],
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
