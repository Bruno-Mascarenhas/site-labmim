"use strict";

/**
 * Station plots for `dataset.observations.charts` on the static monitoring page.
 *
 * The LabMiM micrometeorological station writes these PNGs with a
 * "LabMiM ... UFBA" watermark burned into the image, so the list belongs to this
 * publication alone and no other laboratory can point at it.
 *
 * `id` is the modal id suffix (`radiacao_difusa` -> `#modalRadiacaoDifusa`).
 * Optional fields fall back to `alt: title`, `modalSize: "modal-lg"` and
 * 800x400 intrinsic dimensions.
 */
const LABMIM_STATION_CHARTS = [
  {
    id: "temperatura",
    title: "Temperatura do ar",
    src: "assets/graphs/temperatura.png",
    alt: "Temperatura do ar",
  },
  {
    id: "umidade",
    title: "Umidade do Ar",
    src: "assets/graphs/umidade.png",
    alt: "Umidade do Ar",
  },
  {
    id: "pressao",
    title: "Pressão atmosférica",
    src: "assets/graphs/pressao.png",
    alt: "Pressão atmosférica",
  },
  {
    id: "precipitacao",
    title: "Precipitação",
    src: "assets/graphs/precipitacao.png",
    alt: "Precipitação",
  },
  {
    id: "velocidade",
    title: "Velocidade do Vento",
    src: "assets/graphs/velocidade.png",
    alt: "Velocidade do Vento",
  },
  {
    id: "direcao",
    title: "Direção do Vento",
    src: "assets/graphs/direcao.png",
    alt: "Direção do Vento",
  },
  {
    id: "balanco",
    title: "Balanço de Radiação",
    src: "assets/graphs/balanco.png",
    alt: "Balanço de Radiação",
    modalSize: "modal-xl",
  },
  {
    id: "radiacao_difusa",
    title: "Radiação Difusa",
    src: "assets/graphs/radiacao_difusa.png",
    alt: "Radiação Difusa",
  },
  {
    id: "radiacao_par",
    title: "Radiação PAR",
    src: "assets/graphs/radiacao_par.png",
    alt: "Radiação PAR",
  },
];

module.exports = { LABMIM_STATION_CHARTS };
