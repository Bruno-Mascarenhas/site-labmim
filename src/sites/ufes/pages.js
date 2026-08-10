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
  // No monitoring page: the only station charts that exist are LabMiM's, they
  // measure Salvador under a "LabMiM ... UFBA" watermark, and both publications
  // resolve the same default `assets/graphs/` path. Restore `page("monitoring")`
  // once LEAL declares `paths.graphs` and `observations.charts` of its own.
  page("team", {
    source: siteSource("pages/team.html"),
    seo: {
      title: "LEAL — Equipe · UFES",
      description:
        "LEAL — Equipe do Laboratório de Energias Alternativas da UFES: pesquisadores, colaboradores e estudantes.",
    },
  }),
  // No climatology page, for the same reason: the only published distributions
  // are the Salvador station's, while this route's SEO promises Espírito Santo.
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
