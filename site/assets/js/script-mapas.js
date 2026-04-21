/**
 * SCRIPT-MAPAS.JS — Variable control for Meteorological Maps
 */

(function () {
  "use strict";
  let filesCache = null;

  /**
   * Loads files.json only on the first call; returns
   * the cached version on subsequent calls.
   */
  function getFiles() {
    if (filesCache) return Promise.resolve(filesCache);
    return fetch("assets/json/files.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load files.json");
        return res.json();
      })
      .then((data) => {
        filesCache = data;
        return data;
      });
  }

  /**
   * Updates all three videos with the sources of the selected variable.
   * @param {string} variableKey — key of the video object (e.g., 'wind')
   * @param {string} label — text displayed in the #actual element
   */
  function setVariable(variableKey, label) {
    document.getElementById("actual").textContent = label;

    getFiles()
      .then((data) => {
        const videos = data.videos;
        for (let i = 0; i < videos.length; i++) {
          const j = i + 1;
          const sourceEl = document.getElementById("video" + j);
          const videoEl = document.getElementById("vid" + j);
          if (!sourceEl || !videoEl) continue;
          sourceEl.src = videos[i][variableKey];
          videoEl.style.maxWidth = "420px";
          videoEl.load();
          videoEl.play();
        }
      })
      .catch((err) => {
        console.error("[script-mapas] Error loading videos:", err);
      });
  }

  // Register listeners after the DOM is fully loaded
  document.addEventListener("DOMContentLoaded", function () {
    const mapLabels = {
      wind: "Velocidade do vento a 10 m de altura",
      humidity: "Umidade específica na superfície",
      temperature: "Temperatura do ar e Pressão atmosférica na superfície",
      radiation: "Radiação solar na superfície",
      rain: "Precipitação na superfície",
    };

    Object.keys(mapLabels).forEach(function (key) {
      const el = document.getElementById(key);
      if (el) {
        el.addEventListener("click", function (e) {
          e.preventDefault();
          setVariable(key, mapLabels[key]);
        });
      }
    });

    // Preload the JSON silently when opening the page
    getFiles().catch(() => {});
  });
})();
