"use strict";

module.exports = {
  id: "labmim-wrf",
  attribution: "LabMiM-UFBA",
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
