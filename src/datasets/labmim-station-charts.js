"use strict";

/**
 * Gráficos publicados na página de monitoramento.
 *
 * ATENÇÃO: estes PNG são gerados pela estação micrometeorológica do LabMiM e
 * trazem a marca d'água "LabMiM ... UFBA" gravada na imagem. A lista existe
 * aqui para que cada publicação declare explicitamente o que exibe, em vez de
 * a página compartilhada apontar para arquivos fixos.
 *
 * Campos de cada gráfico:
 *   id        — sufixo do id do modal (`radiacao_difusa` -> `#modalRadiacaoDifusa`)
 *   title     — texto do botão e do cabeçalho do modal
 *   src       — caminho do PNG relativo à raiz publicada
 *   alt       — texto alternativo (default: `title`)
 *   modalSize — classe de tamanho do modal Bootstrap (default: `modal-lg`)
 *   width/height — dimensões intrínsecas do PNG (default: 800x400)
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
