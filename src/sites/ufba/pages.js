"use strict";

const { page, siteSource } = require("../../template/page-types");

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
    append: [siteSource("fragments/funding.html")],
    seo: {
      title: "LabMiM — Monitoramento Ambiental · UFBA",
      description:
        "LabMiM — Monitoramento Ambiental: variáveis meteorológicas medidas em tempo quase real por estações micrometeorológicas em Salvador, Bahia.",
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
  page("climatology", {
    // Chart.js só aqui: carregá-lo no layout institucional custaria 200 KB nas
    // páginas de início, equipe e monitoramento, que não desenham nada.
    vendorScripts: ["assets/vendor/chartjs/chart.min.js?v=3.9.1"],
    scripts: ["assets/js/climatologia.js"],
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
