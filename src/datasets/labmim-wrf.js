"use strict";

module.exports = {
  id: "labmim-wrf",
  attribution: "LabMiM-UFBA",
  // Nome real da CLI Python que converte o NetCDF do WRF no JSON/GeoJSON servido.
  generator: "labmim-wrf-geojson",
  // O namelist WRF vem de DEFAULT_MODEL (renderer); só declare `model` aqui para
  // sobrescrever campos quando esta simulação divergir da configuração padrão.
  paths: {
    manifest: "JSON/manifest.json",
    values: "JSON",
    grids: "GeoJSON",
    // Janela móvel de 7 dias que a página de monitoramento desenha, reescrita a
    // cada hora pelo deploy. Mesma procedência e mesma restrição da climatologia
    // abaixo: sai de `labmim-monitoring` sobre o acervo de sensores do
    // laboratório, que não é público.
    monitoring: "Monitoramento",
    // Distribuições observadas pré-calculadas que a página de climatologia lê.
    // Derivadas do acervo de sensores do laboratório, que NÃO é público: como as
    // saídas do WRF, chegam pelo deploy e ficam fora do git (.gitignore).
    // Produzidas por `labmim-climatology` no repositório micrometeorology.
    climatology: "Climatologia",
  },
  timeline: {
    // Teto de reserva para quando o manifesto não chega: espelha o `index_max`
    // que a rodada publicada declara (arquivos `_000`..`_075`). Abaixo disso o
    // slider estático perde os últimos passos e a documentação renderizada
    // anuncia menos timesteps do que o pipeline entrega.
    defaultMaxLayer: 75,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC−03)",
  },
  defaultDomain: "D01",
  // A extensão citada em cada `description` é a da grade publicada
  // (`shape × metadata.resolucao_m` dos `GeoJSON/*.grid.json`): 1863, 891, 297
  // e 84 km. Não dá para derivá-la no build — os `grid.json` são dados de
  // deploy e não estão no repositório —, então ela é revista à mão sempre que
  // o namelist mudar a grade.
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
