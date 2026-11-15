"use strict";

const { page, siteSource, templateSource } = require("../../template/page-types");

module.exports = [
  page("home", {
    source: siteSource("pages/index.html"),
    seo: {
      h1: "LabMiM — Laboratório de Micrometeorologia e Modelagem",
      title: "LabMiM — Laboratório de Micrometeorologia e Modelagem · UFBA",
      description:
        "LabMiM - Laboratório de Micrometeorologia e Modelagem da UFBA. Previsão numérica do tempo, monitoramento ambiental e pesquisa atmosférica em Salvador e Bahia.",
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
    append: [siteSource("fragments/funding.html")],
    seo: {
      title: "LabMiM — Monitoramento Ambiental · UFBA",
      description:
        "LabMiM — Monitoramento Ambiental: variáveis meteorológicas da última semana registrada por estações micrometeorológicas em Salvador, Bahia.",
    },
  }),
  page("team", {
    source: siteSource("pages/team.html"),
    seo: {
      title: "LabMiM — Equipe · UFBA",
      description:
        "LabMiM — Equipe de pesquisadores do Laboratório de Micrometeorologia e Modelagem da UFBA: professores, doutorandos, mestrandos e colaboradores.",
    },
  }),
  page("sky", {
    vendorScripts: ["assets/vendor/chartjs/chart.min.js?v=3.9.1"],
    scripts: ["assets/js/chart-page.js", "assets/js/ceu.js"],
    seo: {
      title: "LabMiM — Condição do Céu · UFBA",
      description:
        "Acompanhe as imagens da câmera all-sky fornecidas pelo Planetário da UFBA, com estimativas do modelo LabMiM, histórico de irradiância e condições do céu em Salvador.",
    },
  }),
  page("climatology", {
    vendorScripts: ["assets/vendor/chartjs/chart.min.js?v=3.9.1"],
    scripts: ["assets/js/chart-page.js", "assets/js/climatologia.js"],
    seo: {
      title: "LabMiM — Climatologia · UFBA",
      description:
        "LabMiM — Climatologia: distribuições estatísticas do registro observado da estação micrometeorológica do LabMiM em Salvador, com as densidades teóricas da literatura. Laboratório de Micrometeorologia e Modelagem, UFBA.",
    },
  }),
  page("forecast", {
    seo: {
      title: "LabMiM — Mapas Interativos WRF · UFBA",
      description:
        "LabMiM — Mapas Interativos WRF: visualização interativa de dados de previsão numérica do modelo WRF para Bahia. Laboratório de Micrometeorologia e Modelagem, UFBA.",
    },
  }),
  page("energy", {
    seo: {
      title: "LabMiM — Potenciais Energéticos · UFBA",
      description:
        "LabMiM — Potenciais Energéticos: mapas interativos de potencial fotovoltaico, potencial eólico e densidade eólica derivados do modelo WRF para Bahia.",
    },
  }),
];
