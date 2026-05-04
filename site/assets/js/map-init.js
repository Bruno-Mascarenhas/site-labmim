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
  app.showSidebar = function () {
    originalShowSidebar();

    if (app.state.selectedCell) {
      chartsManager.openModal();
      const loadingOverlay = chartsManager.ui.loadingOverlay;
      if (loadingOverlay) loadingOverlay.style.display = "flex";

      chartsManager
        .loadTimeSeriesData(app.state.selectedCell, app.state.domain, app.state.type)
        .then((data) => {
          if (Object.keys(data).length > 0) {
            chartsManager.renderChartsForVariable(app.state.type, app.state.selectedCell);
          }
          if (loadingOverlay) loadingOverlay.style.display = "none";
        })
        .catch((err) => {
          console.error("Error loading and rendering charts:", err);
          if (loadingOverlay) loadingOverlay.style.display = "none";
        });
    }
  };

  app.applyMapChanges().then(() => {
    app.startInitialPlayback();
  });
});
