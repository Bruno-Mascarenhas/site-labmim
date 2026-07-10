/**
 * APPLICATION INITIALIZATION
 */
let app;
let chartsManager;

// Kicked off at script-parse time so it overlaps document loading (deferred
// scripts run before DOMContentLoaded). The manifest carries the pipeline
// run version used to build long-cacheable versioned data URLs; on any
// failure (older pipeline, offline) the app just uses plain URLs, which keep
// the previous revalidate-every-use behavior. The timeout keeps a stalled
// manifest response from delaying map initialization — versioning is an
// optimization, never a dependency.
const dataVersionPromise = Promise.race([
  fetch("JSON/manifest.json", { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : null))
    .then((manifest) => (typeof manifest?.version === "string" && manifest.version ? manifest.version : null)),
  new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
]).catch(() => null);

document.addEventListener("DOMContentLoaded", async () => {
  const dataVersion = await dataVersionPromise;
  app = new MeteoMapManager({ dataVersion });
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
        if (loadingOverlay) loadingOverlay.style.display = "none";
      })
      .catch((err) => {
        console.error("Error loading and rendering charts:", err);
        if (loadingOverlay) loadingOverlay.style.display = "none";
      });
  };

  app.applyMapChanges().then(() => {
    app.startInitialPlayback();
  });
});
