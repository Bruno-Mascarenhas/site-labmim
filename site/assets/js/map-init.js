/**
 * APPLICATION INITIALIZATION
 */
let app;
let chartsManager;

// How often a long-lived session re-checks the manifest for a new pipeline
// run (the daily job replaces the fixed-name data files in place, so a page
// left open across the regeneration would otherwise mix two forecast runs).
const MANIFEST_RECHECK_INTERVAL_MS = 15 * 60 * 1000;
const MANIFEST_RECHECK_MIN_GAP_MS = 5 * 60 * 1000;

function fetchManifest() {
  return fetch(window.SITE_RUNTIME_CONFIG.data.manifestPath, { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : null))
    .then((manifest) => (typeof manifest?.version === "string" && manifest.version ? manifest : null))
    .catch(() => null);
}

// Kicked off at script-parse time so it overlaps document loading (deferred
// scripts run before DOMContentLoaded). The manifest carries the pipeline
// run version used to build long-cacheable versioned data URLs, plus the
// timeline contract (step range, per-variable availability, consolidated
// artifact descriptors) when produced by a v2 pipeline. On any failure
// (older pipeline, offline) the app falls back to plain URLs and the
// built-in timeline defaults. The timeout keeps a stalled manifest response
// from delaying the FIRST DATA LOAD — map construction and all control
// listeners never wait for it (see below).
const manifestFetch = fetchManifest();
const manifestPromise = Promise.race([manifestFetch, new Promise((resolve) => setTimeout(() => resolve(null), 3000))]);

document.addEventListener("DOMContentLoaded", () => {
  // Construct immediately: the map, Play/slider/domain/variable listeners
  // and the UI must be live the moment the DOM is ready — a slow manifest
  // response must never leave the page inert.
  app = new MeteoMapManager();
  chartsManager = new ChartsManager(app);
  app.chartsManager = chartsManager;
  app.setupVariableOverview(chartsManager);

  const originalShowSidebar = app.showSidebar.bind(app);
  app.showSidebar = function (options) {
    originalShowSidebar(options);

    if (!app.state.selectedCell) return;

    // Only a real user click on the map may open the modal. Programmatic
    // refreshes (slider drags, variable switches, wind-height changes) just
    // update the charts silently — and only if the modal is already visible.
    const userInitiated = options?.userInitiated === true;
    if (userInitiated) {
      chartsManager.openModal();
    } else if (!chartsManager.isModalOpen()) {
      return;
    }

    const loadingOverlay = chartsManager.ui.loadingOverlay;
    if (loadingOverlay) loadingOverlay.style.display = "flex";

    chartsManager
      .loadTimeSeriesData(app.state.selectedCell, app.state.domain, app.state.type)
      .then((data) => {
        if (Object.keys(data).length > 0) {
          chartsManager.renderChartsForVariable(app.state.type);
        }
      })
      .catch((err) => {
        console.error("Error loading and rendering charts:", err);
      })
      .finally(() => {
        if (loadingOverlay) loadingOverlay.style.display = "none";
      });
  };

  // The first data load still waits (bounded by the 3s race) for the
  // manifest so the very first fetches already carry the ?v= version and
  // the timeline/availability contract — otherwise every first-frame file
  // would be fetched twice (plain, then versioned).
  manifestPromise.then((manifest) => {
    if (manifest) app.applyManifest(manifest);
    app.applyMapChanges().then(() => {
      app.startInitialPlayback();
    });
    if (!manifest) {
      // The manifest lost the 3s race but is not discarded: adopt it in
      // place whenever it lands (handleManifestUpdate's unversioned path),
      // so the session gains versioned URLs and the timeline contract — and
      // the 15-minute recheck won't misread "first manifest of the session"
      // as a new pipeline run and needlessly wipe every cache mid-playback.
      manifestFetch.then((late) => {
        if (late && !app.dataVersion) app.handleManifestUpdate(late, chartsManager);
      });
    }
  });

  // Detect a new pipeline run during long sessions and resynchronize
  // (caches, ?v= version, timeline anchor) instead of silently mixing two
  // forecast runs under one timeline.
  let lastCheckAt = Date.now();
  const recheckManifest = () => {
    lastCheckAt = Date.now();
    fetchManifest().then((manifest) => {
      if (manifest) app.handleManifestUpdate(manifest, chartsManager);
    });
  };
  setInterval(recheckManifest, MANIFEST_RECHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastCheckAt > MANIFEST_RECHECK_MIN_GAP_MS) {
      recheckManifest();
    }
  });
});
