"use strict";

module.exports = {
  schemaVersion: 1,
  id: "ufba",
  isDefault: true,
  origin: "https://labmim.if.ufba.br",
  brand: {
    name: "LabMiM",
    fullName: "Laboratório de Micrometeorologia e Modelagem",
    copyrightName: "LabMiM",
    ogImage: "assets/img/logonova1.png",
    logos: {
      nav: {
        src: "assets/img/logonova1-nav.png",
        webp: "assets/img/logonova1-nav.webp",
        width: 250,
        height: 80,
      },
      footer: {
        src: "assets/img/logonova1-nav.png",
        webp: "assets/img/logonova1-nav.webp",
        width: 250,
        height: 80,
      },
      sidebar: {
        src: "assets/img/logonova1-sidebar.png",
        webp: "assets/img/logonova1-sidebar.webp",
        width: 720,
        height: 230,
      },
    },
    affiliations: [
      {
        kind: "image",
        href: "https://www.cienam.ufba.br",
        name: "CIEnAm",
        src: "assets/img/logo_cienam-nav.png",
        webp: "assets/img/logo_cienam-nav.webp",
        width: 230,
        height: 80,
      },
    ],
  },
  institution: {
    name: "Universidade Federal da Bahia",
    acronym: "UFBA",
  },
  location: {
    cityName: "Salvador",
  },
  theme: "theme.css",
  redirects: [{ from: "/mapas_meteorologicos.html", to: "/mapas_interativos.html", status: 301 }],
};
