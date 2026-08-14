"use strict";

module.exports = {
  id: "labmim-wrf",
  attribution: "LabMiM-UFBA",
  // Name of the Python CLI, not derived from the dataset id.
  generator: "labmim-wrf-geojson",
  // No `model` block: the WRF namelist comes from DEFAULT_MODEL (renderer), and
  // this simulation diverges from it in no field.
  paths: {
    manifest: "JSON/manifest.json",
    values: "JSON",
    grids: "GeoJSON",
    // Rolling 7-day window rewritten hourly by `labmim-monitoring`, over the
    // laboratory's non-public sensor archive: it reaches the site through the
    // deploy and stays out of git.
    monitoring: "Monitoramento",
    // Observed distributions from `labmim-climatology`; same archive, same
    // deploy-only route.
    climatology: "Climatologia",
    // All-sky camera frame, the segmentation mask the classifier predicts over it
    // and the radiation payload behind the Kt × Kd chart. The frames are rewritten
    // in place under fixed names, so the page cache-busts by query string.
    sky: "Ceu",
  },
  timeline: {
    // Used only when the manifest does not arrive; mirrors the `index_max` the
    // published run declares (files `_000`..`_075`).
    defaultMaxLayer: 75,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC−03)",
  },
  defaultDomain: "D01",
  // The extent in each `description` is `shape × metadata.resolucao_m` from
  // `GeoJSON/*.grid.json` (1863, 891, 297, 84 km). Those files are deploy data
  // and never live here, so review this by hand whenever the namelist changes
  // the grid.
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
