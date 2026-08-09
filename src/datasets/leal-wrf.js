"use strict";

module.exports = {
  id: "leal-wrf",
  attribution: "LEAL-UFES",
  // Nome real da CLI Python que gera os dados das duas publicações; não é
  // derivado do id do dataset porque "leal-wrf-geojson" não existe.
  generator: "labmim-wrf-geojson",
  // Namelist WRF: herda DEFAULT_MODEL (renderer); declare `model` só para divergir.
  // Sem `observations`: o LEAL não tem estação publicada. Reaproveitar a lista
  // do LabMiM apontava para `assets/graphs/`, caminho operacional comum às duas
  // publicações, que o build exclui de todo bundle — os PNG davam 404 — e as
  // imagens ainda trazem a marca d'água "LabMiM ... UFBA" e medem Salvador.
  // Ao publicar a estação do LEAL, declare aqui `paths.graphs` próprio (para o
  // build separar os diretórios) junto de `observations.charts`.
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
      label: "S/SE/NE",
      longLabel: "Sul–Sudeste–Nordeste",
      center: [-20.3, -40.3],
      zoom: 5.5,
      resolution: "27 km",
      description:
        "Escala sinótica/regional. Cobre uma ampla faixa das regiões Sul, Sudeste e Nordeste e representa frentes, ciclones e massas de ar.",
      cumulusParameterized: true,
    },
    {
      id: "D02",
      label: "Sudeste",
      longLabel: "Sudeste",
      center: [-20.3, -40.3],
      zoom: 7,
      resolution: "9 km",
      description:
        "Escala intermediária sobre a Região Sudeste. Resolve sistemas de mesoescala, convecção organizada e circulações costeiras.",
      cumulusParameterized: true,
    },
    {
      id: "D03",
      label: "ES",
      longLabel: "Espírito Santo",
      center: [-20.3, -40.3],
      zoom: 9,
      resolution: "3 km",
      description:
        "Escala estadual de alta resolução. Cobre o Espírito Santo e permite resolver convecção profunda explicitamente (sem parametrização de cumulus).",
      cumulusParameterized: false,
    },
    {
      id: "D04",
      label: "Grande Vitória",
      longLabel: "Região Metropolitana da Grande Vitória",
      center: [-20.3, -40.3],
      zoom: 12,
      resolution: "1 km",
      description:
        "Maior detalhe espacial sobre a Grande Vitória. Captura efeitos costeiros, topográficos, brisa marítima e influências urbanas.",
      cumulusParameterized: false,
    },
  ],
};
