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
  // Sem página de monitoramento, pelo mesmo motivo da climatologia abaixo: a
  // única lista de gráficos de estação que existe é a do LabMiM, e ela sai de
  // `assets/graphs/` — caminho operacional que as DUAS publicações resolvem
  // (nenhuma declara `dataset.paths.graphs`), então o build exclui o diretório
  // de todo bundle e os nove PNG respondem 404 em `dist/ufes/`. Mesmo se
  // chegassem, trazem a marca d'água "LabMiM ... UFBA" gravada na imagem e
  // medem a estação de Salvador, enquanto o SEO desta rota prometia dados
  // "medidos em tempo quase real no Espírito Santo". Reative `page("monitoring",
  // …)` quando o LEAL tiver a própria estação publicada, declarando
  // `dataset.paths.graphs` e `dataset.observations.charts` próprios em
  // `src/datasets/leal-wrf.js`.
  page("team", {
    source: siteSource("pages/team.html"),
    seo: {
      title: "LEAL — Equipe · UFES",
      description:
        "LEAL — Equipe do Laboratório de Energias Alternativas da UFES: pesquisadores, colaboradores e estudantes.",
    },
  }),
  // Sem página de climatologia: os únicos dados de distribuição publicados hoje
  // são os da estação do LabMiM em Salvador, e o SEO desta publicação promete
  // Espírito Santo. Reative `page("climatology", …)` quando o LEAL tiver o
  // próprio registro observado publicado no diretório do dataset.
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
