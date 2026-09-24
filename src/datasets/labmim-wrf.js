"use strict";

module.exports = {
  id: "labmim-wrf",
  attribution: "LabMiM-UFBA",
  // Name of the Python CLI, not derived from the dataset id.
  generator: "labmim-wrf-geojson",
  model: {
    verticalLevels:
      "30 níveis em coordenada híbrida sigma-pressão, com topo em 50 hPa; metade deles no primeiro quilômetro acima do solo, para resolver a camada limite planetária (CLP).",
    radiation: "RRTM [[rrtm]] na onda longa e RRTMG [[rrtmg]] na onda curta",
    microphysics: "WSM3 [[wsm3]]",
    planetaryBoundaryLayer: "YSU [[ysu]]",
    landSurface: "Noah [[noah]]",
    cumulus: "Betts-Miller-Janjić [[bmj]]",
  },
  runNotes: {
    isobarsResidual:
      "<p>Essa estimativa é uma ficção abaixo do solo e, sobre terreno alto, deixa um resíduo com ciclo diário: medida no domínio de 9 km, a diferença de pressão entre a serra e o litoral oscila cerca de <strong>2,0 hPa</strong> entre a madrugada e a tarde. A diferença média diária entre serra e litoral, essa é real.</p>",
    isobarsMassField:
      "Na rodada de 3 de maio de 2026, que é a publicada aqui, a pressão média do domínio muda cerca de <strong>2,8 hPa por hora</strong>, contra 0,20 hPa/h de uma rodada de controle e 0,59 hPa/h do barômetro da estação. O deslocamento é espacialmente uniforme, aparece nos quatro domínios com a mesma fase e já está na massa de ar seca prognóstica do modelo: entra pelas condições de contorno, e não pela redução ao nível do mar, que responde por no máximo 1,4% do salto horário.",
    presMassField:
      "Na rodada publicada aqui, de 3 de maio de 2026, essa série é dominada pelo deslocamento do campo de massa descrito na aba Funcionalidades, cerca de 2,8 hPa por hora na média do domínio contra 0,59 hPa/h do barômetro da estação, e não deve ser lida como tendência local.",
    swupMissingDiagnostics:
      "Nas rodadas operacionais de agosto de 2026, posteriores à publicada aqui, com RRTMG na onda curta e RRTM na onda longa, o <code>SWUPB</code> existe nos quatro domínios e o <code>LWUPB</code> em nenhum.",
    swupNestFeedback:
      "Na rodada operacional de 8 de agosto de 2026, posterior à publicada aqui, com <code>SWINT_OPT = 0</code>, <code>RADT</code> = 30 min e <code>FEEDBACK = 1</code> nos quatro domínios, a diferença entre <code>ALBEDO · SWDOWN</code> e <code>SWUPB</code> fica abaixo de 0,001 W/m² fora da área dos ninhos e chega, dentro dela, a 126 W/m² no D01, 176 W/m² no D02 e 222 W/m² no D03.",
    swupAlbedoRange: "Nesta rodada os valores implícitos ficam entre 0,08 e 0,28, dentro dessa faixa.",
    lwupReflectedTerm: "Nesta rodada, a abertura seria de cerca de 22 W/m².",
    lwnetLandCells:
      "Nesta rodada o saldo é negativo em 99,5% a 99,9% das células de terra, com magnitude mediana de 53 a 61 W/m², abaixo dessa faixa.",
    rnetClosure:
      "Nesta rodada o WRF grava o <code>GRDFLX</code> positivo para cima, então <code>G = −GRDFLX</code>. Mediado sobre três dias inteiros nas células de terra, o resíduo <code>RNET − H − LE − G</code> fica entre −0,6 e −1,4 W/m² nos quatro domínios.",
    ktHighValues: "A rodada confirma: apenas 0,19% a 3,4% das células passam desse valor.",
    epsSkyClearCells:
      "Nesta rodada, conforme o domínio, 71% a 93% das células que o <code>kt</code> classifica como céu limpo ficam entre 0,80 e 0,90.",
  },
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
    // All-sky camera frame, the network's prediction for it with its
    // occlusion-sensitivity map, the block timeline, the model card and the
    // radiation payload behind the Kt × Kd chart. The images are rewritten in
    // place under fixed names, so the page cache-busts by query string.
    sky: "Ceu",
  },
  timeline: {
    // Used only when the manifest does not arrive; mirrors the `index_max` the
    // published run declares (files `_000`..`_075`).
    defaultMaxLayer: 75,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC−03)",
    utcOffsetHours: -3,
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
      longLabel: "Centro-leste da Bahia",
      center: [-12.97, -38.5],
      zoom: 7,
      resolution: "9 km",
      description:
        "Escala intermediária. Cobre o centro-leste da Bahia e parte dos estados vizinhos (~890×890 km). Cerca de um quarto do estado fica de fora: o Oeste Baiano, a oeste de ~43,6°W, e o extremo sul, ao sul de ~16,7°S. Para o estado inteiro, use o domínio de 27 km (BA/NE). Resolve convecção organizada e brisas de escala meso-α.",
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
        "Escala local. Cobre a Região Metropolitana de Salvador e o Recôncavo (~300×300 km). A grade já resolve parte da convecção profunda, e a parametrização de cumulus continua ativa.",
      cumulusParameterized: true,
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
      cumulusParameterized: true,
    },
  ],
};
