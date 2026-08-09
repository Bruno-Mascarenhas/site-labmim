"use strict";

module.exports = {
  id: "labmim-wrf",
  attribution: "LabMiM-UFBA",
  // Actual name of the Python CLI that turns the WRF NetCDF into the served
  // JSON/GeoJSON; it is not derived from the dataset id.
  generator: "labmim-wrf-geojson",
  // The WRF namelist comes from DEFAULT_MODEL (renderer); declare `model` here
  // only for the fields where this simulation diverges from that default.
  paths: {
    manifest: "JSON/manifest.json",
    values: "JSON",
    grids: "GeoJSON",
    // Rolling 7-day window, rewritten hourly by the deploy. Produced by
    // `labmim-monitoring` over the laboratory's sensor archive, which is not
    // public, so it reaches the site through the deploy and stays out of git.
    monitoring: "Monitoramento",
    // Pre-computed observed distributions, produced by `labmim-climatology` in
    // the micrometeorology repository. Same non-public sensor archive and same
    // deploy-only route as the monitoring window above.
    climatology: "Climatologia",
  },
  timeline: {
    // Fallback ceiling for when the manifest does not arrive: it mirrors the
    // `index_max` the published run declares (files `_000`..`_075`).
    defaultMaxLayer: 75,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC−03)",
  },
  defaultDomain: "D01",
  // The extent quoted in each `description` is the published grid's
  // (`shape × metadata.resolucao_m` from `GeoJSON/*.grid.json`): 1863, 891, 297
  // and 84 km. The build cannot derive it — the `grid.json` files are deploy
  // data and never live in the repository — so review it by hand whenever the
  // namelist changes the grid.
  domains: [
    {
      id: "D01",
      label: "BA/NE",
      longLabel: "Bahia/Nordeste",
      center: [-12.97, -38.5],
      zoom: 5.5,
      resolution: "27 km",
      description:
        "Escala sinótica/regional. Cobre o Sul-Nordeste do Brasil (~1860×1860 km). Captura frentes, ciclones e massas de ar.",
      cumulusParameterized: true,
    },
    {
      id: "D02",
      label: "BA",
      longLabel: "Bahia",
      center: [-12.97, -38.5],
      zoom: 7,
      resolution: "9 km",
      description:
        "Escala intermediária. Cobre a Bahia (~890×890 km). Resolve convecção organizada e brisas de escala meso-α.",
      cumulusParameterized: true,
    },
    {
      id: "D03",
      label: "RMS",
      longLabel: "Região Metropolitana de Salvador",
      center: [-12.97, -38.5],
      zoom: 9,
      resolution: "3 km",
      description:
        "Escala local. Cobre a Região Metropolitana de Salvador e o Recôncavo (~300×300 km). Resolução suficiente para resolver convecção profunda explicitamente (sem parametrização de cumulus).",
      cumulusParameterized: false,
    },
    {
      id: "D04",
      label: "SSA",
      longLabel: "Salvador",
      center: [-12.97, -38.5],
      zoom: 12,
      resolution: "1 km",
      description:
        "Alta resolução. Cobre Salvador e Região Metropolitana (~85×85 km). Captura efeitos topográficos, brisa marítima e ilha de calor urbana.",
      cumulusParameterized: false,
    },
  ],
};
