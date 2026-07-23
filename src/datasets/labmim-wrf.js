"use strict";

const { LABMIM_STATION_CHARTS } = require("./labmim-station-charts");

module.exports = {
  id: "labmim-wrf",
  attribution: "LabMiM-UFBA",
  // Nome real da CLI Python que converte o NetCDF do WRF no JSON/GeoJSON servido.
  generator: "labmim-wrf-geojson",
  // Configuração da simulação (namelist) documentada na aba "Dados WRF".
  model: {
    initialConditions: "GFS (Global Forecast System) da NOAA, resolução 0.25°, atualizações a cada 6h.",
    verticalLevels: "~40 níveis sigma, com maior concentração na camada limite planetária (CLP).",
    radiation: "RRTMG",
    microphysics: "Thompson/WSM6",
    planetaryBoundaryLayer: "YSU/MYJ",
    landSurface: "Noah-MP",
    cumulus: "Kain-Fritsch",
  },
  observations: {
    charts: LABMIM_STATION_CHARTS,
  },
  paths: {
    manifest: "JSON/manifest.json",
    values: "JSON",
    grids: "GeoJSON",
  },
  timeline: {
    defaultMaxLayer: 73,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC−03)",
  },
  defaultDomain: "D01",
  domains: [
    {
      id: "D01",
      label: "BA/NE",
      longLabel: "Bahia/Nordeste",
      center: [-12.97, -38.5],
      zoom: 5.5,
      resolution: "27 km",
      description:
        "Escala sinótica/regional. Cobre o Sul-Nordeste do Brasil (~2500×2500 km). Captura frentes, ciclones e massas de ar.",
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
        "Escala intermediária. Cobre o Nordeste (~800×800 km). Resolve convecção organizada e brisas de escala meso-α.",
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
        "Escala local. Cobre a Bahia (~270×270 km). Resolução suficiente para resolver convecção profunda explicitamente (sem parametrização de cumulus).",
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
        "Alta resolução. Cobre Salvador e Região Metropolitana (~90×90 km). Captura efeitos topográficos, brisa marítima e ilha de calor urbana.",
      cumulusParameterized: false,
    },
  ],
};
