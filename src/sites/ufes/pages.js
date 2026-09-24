"use strict";

const { page, siteSource, templateSource } = require("../../template/page-types");

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
  page("team", {
    source: siteSource("pages/team.html"),
    seo: {
      title: "LEAL — Equipe · UFES",
      description:
        "LEAL — Equipe do Laboratório de Energias Alternativas da UFES: pesquisadores, colaboradores e estudantes.",
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
  page("annual-means", {
    indexable: false,
    seo: {
      title: "LEAL — Médias Anuais · UFES",
      description: "LEAL — Médias Anuais: médias anuais das saídas do modelo WRF para o Espírito Santo, em preparação.",
    },
  }),
  page("climatology", {
    source: templateSource("pages/climatologia.html"),
    vendorScripts: ["assets/vendor/chartjs/chart.min.js?v=3.9.1"],
    scripts: ["assets/js/chart-page.js", "assets/js/climatologia.js"],
    seo: {
      title: "LEAL — Climatologia · UFES",
      description:
        "LEAL — Climatologia: distribuições estatísticas do registro observado da estação micrometeorológica do LEAL em Vitória, com as densidades teóricas da literatura. Laboratório de Energias Alternativas, UFES.",
    },
  }),
  page("monitoring", {
    // Interactive variant, reading the hourly payload from
    // `dataset.paths.monitoring`; pages/monitoring.html is the static one.
    source: templateSource("pages/monitoring-live.html"),
    // Chart.js is declared per page: loading it from the institutional layout
    // would cost 200 KB on the routes that draw nothing.
    vendorScripts: ["assets/vendor/chartjs/chart.min.js?v=3.9.1"],
    scripts: ["assets/js/chart-page.js", "assets/js/monitoramento.js"],
    seo: {
      title: "LEAL — Monitoramento Ambiental · UFES",
      description:
        "LEAL — Monitoramento Ambiental: variáveis meteorológicas da última semana registrada por estações micrometeorológicas em Vitória, Espírito Santo.",
    },
  }),
];
