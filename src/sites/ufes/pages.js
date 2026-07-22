"use strict";

const { page, siteSource } = require("../../template/page-types");

module.exports = [
  page("home", {
    source: siteSource("pages/index.html"),
    seo: {
      h1: "LEAL — Laboratório de Energias Alternativas",
      title: "LEAL — Laboratório de Energias Alternativas · UFES",
      description:
        "LEAL - Laboratório de Energias Alternativas da UFES. Pesquisa, monitoramento ambiental e previsão de disponibilidade de energias eólica e solar em Vitória e Espírito Santo.",
    },
  }),
  page("monitoring", {
    seo: {
      title: "LEAL — Monitoramento Ambiental · UFES",
      description:
        "LEAL — Monitoramento Ambiental: variáveis meteorológicas e dados de radiação medidos em tempo quase real no Espírito Santo.",
    },
  }),
  page("team", {
    source: siteSource("pages/team.html"),
    seo: {
      title: "LEAL — Equipe · UFES",
      description:
        "LEAL — Equipe do Laboratório de Energias Alternativas da UFES: pesquisadores, colaboradores e estudantes.",
    },
  }),
  page("climatology", {
    seo: {
      title: "LEAL — Climatologia · UFES",
      description:
        "LEAL — Climatologia e análise ambiental do Espírito Santo. Laboratório de Energias Alternativas, UFES.",
    },
  }),
  page("forecast", {
    seo: {
      title: "LEAL — Mapas Interativos WRF · UFES",
      description:
        "LEAL — Mapas Interativos WRF: visualização interativa de previsões meteorológicas do modelo WRF para o Espírito Santo.",
    },
  }),
  page("energy", {
    seo: {
      title: "LEAL — Potenciais Energéticos · UFES",
      description:
        "LEAL — Potenciais Energéticos: mapas interativos de potencial fotovoltaico, potencial eólico e densidade eólica para o Espírito Santo.",
    },
  }),
];
