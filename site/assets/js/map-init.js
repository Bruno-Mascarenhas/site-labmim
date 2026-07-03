/**
 * APPLICATION INITIALIZATION
 */
let app;
let chartsManager;

document.addEventListener("DOMContentLoaded", () => {
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
