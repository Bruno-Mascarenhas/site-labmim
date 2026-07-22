"use strict";

module.exports = {
  schemaVersion: 1,
  id: "ufes",
  isDefault: false,
  origin: "https://www.lealufes.org",
  brand: {
    name: "LEAL",
    fullName: "Laboratório de Energias Alternativas",
    copyrightName: "LEAL",
    ogImage: "assets/img/logo_leal.png",
    logos: {
      nav: { src: "assets/img/logo_leal.png", width: 176, height: 80 },
      footer: { src: "assets/img/logo_leal.png", width: 176, height: 80 },
      sidebar: { src: "assets/img/logo_leal.png", width: 505, height: 230 },
    },
    affiliations: [
      {
        kind: "text",
        href: "https://ct.ufes.br",
        name: "Centro Tecnológico",
        institution: "UFES",
      },
    ],
  },
  institution: {
    name: "Universidade Federal do Espírito Santo",
    acronym: "UFES",
  },
  location: {
    cityName: "Vitória",
  },
  theme: "theme.css",
  redirects: [
    { from: "/mapas_eolicos.html", to: "/potenciais_energeticos.html", status: 301 },
    { from: "/mapas_solares.html", to: "/potenciais_energeticos.html", status: 301 },
    { from: "/monitoramento.html", to: "/monitoring.html", status: 301 },
    { from: "/equipe.html", to: "/team.html", status: 301 },
    { from: "/contato.html", to: "/team.html", hash: "contato", status: 301 },
  ],
};
