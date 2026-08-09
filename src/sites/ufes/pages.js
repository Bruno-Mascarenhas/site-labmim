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
  // No monitoring page, for the same reason as the climatology one below: the
  // only station chart list that exists is LabMiM's, and it measures Salvador
  // under a "LabMiM ... UFBA" watermark, while this route's SEO promises data
  // from Espírito Santo. Both publications also resolve the same default
  // `assets/graphs/` operational path, which the build excludes from every
  // bundle. Add `page("monitoring", …)` back once LEAL publishes a station of
  // its own, declaring its `dataset.paths.graphs` and
  // `dataset.observations.charts` in `src/datasets/leal-wrf.js`.
  page("team", {
    source: siteSource("pages/team.html"),
    seo: {
      title: "LEAL — Equipe · UFES",
      description:
        "LEAL — Equipe do Laboratório de Energias Alternativas da UFES: pesquisadores, colaboradores e estudantes.",
    },
  }),
  // No climatology page: the only published distributions are those of the
  // LabMiM station in Salvador, and this publication's SEO promises Espírito
  // Santo. Add `page("climatology", …)` back once LEAL publishes its own
  // observed record in the dataset directory.
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
