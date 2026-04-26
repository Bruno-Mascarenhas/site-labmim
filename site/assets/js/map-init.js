/**
 * APPLICATION INITIALIZATION
 */
let app;
let chartsManager;

document.addEventListener("DOMContentLoaded", () => {
  app = new MeteoMapManager();

  // Initialize charts manager
  chartsManager = new ChartsManager(app);

  // Attach chartsManager to the app instance for use in handleMapClick
  app.chartsManager = chartsManager;

  // Intercept the showSidebar method to render charts as well
  const originalShowSidebar = app.showSidebar.bind(app);
  app.showSidebar = function () {
    originalShowSidebar();

    if (app.state.selectedCell) {
      // Open modal and show overlay
      chartsManager.openModal();
      const loadingOverlay = document.getElementById("timeSeriesLoadingOverlay");
      if (loadingOverlay) loadingOverlay.style.display = "flex";

      chartsManager
        .loadTimeSeriesData(
          app.state.selectedCell,
          app.getDomainFromZoom(app.map.getZoom()) || app.state.domain,
          app.state.type
        )
        .then((data) => {
          // If it returned an empty object, the request might have been aborted
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
