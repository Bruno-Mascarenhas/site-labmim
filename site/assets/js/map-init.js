let app;
let chartsManager;

// The daily job replaces the fixed-name data files in place, so a session left
// open across a regeneration would otherwise mix two forecast runs.
const MANIFEST_RECHECK_INTERVAL_MS = 15 * 60 * 1000;
const MANIFEST_RECHECK_MIN_GAP_MS = 5 * 60 * 1000;
const MANIFEST_FIRST_LOAD_WAIT_MS = 3000;

function fetchManifest() {
  return fetch(window.SITE_RUNTIME_CONFIG.data.manifestPath, { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : null))
    .then((manifest) => (typeof manifest?.version === "string" && manifest.version ? manifest : null))
    .catch(() => null);
}

// Kicked off at parse time, ahead of DOMContentLoaded, so it overlaps document
// loading. A v2 manifest carries the run version for cacheable ?v= URLs plus the
// timeline contract (step range, per-variable availability, artifact
// descriptors); on any failure the app falls back to plain URLs and the built-in
// timeline defaults.
const manifestFetch = fetchManifest();
const manifestPromise = Promise.race([
  manifestFetch,
  new Promise((resolve) => setTimeout(() => resolve(null), MANIFEST_FIRST_LOAD_WAIT_MS)),
]);

document.addEventListener("DOMContentLoaded", () => {
  // Construct before the manifest resolves: map, controls and UI must be live
  // the moment the DOM is ready, however slow the manifest response is.
  app = new MeteoMapManager();
  chartsManager = new ChartsManager(app);
  app.chartsManager = chartsManager;
  app.setupVariableOverview(chartsManager);

  const originalShowSidebar = app.showSidebar.bind(app);
  app.showSidebar = function (options) {
    originalShowSidebar(options);

    if (!app.state.selectedCell) return;

    // Only a real map click opens the modal; programmatic refreshes (slider,
    // variable, wind height) refresh the charts, and only when already open.
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

  // Waiting here buys the ?v= version and the availability contract for the very
  // first fetches; without it every first-frame file would be fetched twice.
  manifestPromise.then((manifest) => {
    if (manifest) app.applyManifest(manifest);
    app.applyMapChanges().then((values) => {
      // Values or an anchor, never "did the manifest arrive": a partial FTP
      // upload can leave the manifest as the only file online, and a v1 manifest
      // carries no `start_local`, hence no anchor at all.
      if (values || app.state.initialDateTime) {
        app.startInitialPlayback();
        return;
      }

      // The grid breaks the tie between "nothing is published" and "this frame is
      // missing": it depends on neither variable nor step. If it loads, only that
      // step was absent (shortwave overnight, say) and the timelapse walks on.
      app.loadGridLayer(app.state.domain).then((grid) => {
        if (grid) {
          app.startInitialPlayback();
          return;
        }
        // No grid either: the output directory is not on this server. Playback
        // would retry the failed requests every 800 ms under a frozen notice.
        app.showNoPublishedDataNotice();
      });
    });
    if (!manifest) {
      // A manifest that lost the race is adopted in place whenever it lands, so
      // the recheck below cannot misread the session's first manifest as a new
      // pipeline run and wipe every cache mid-playback.
      manifestFetch.then((late) => {
        if (late && !app.dataVersion) app.handleManifestUpdate(late, chartsManager);
      });
    }
  });

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
