"use strict";

/**
 * Bibliografia do site.
 *
 * Uma citação que diz só "(Fulano, 2019)" não serve a quem ainda não conhece a
 * área: não dá o título, não dá onde procurar e não dá o que ler. Aqui cada
 * referência carrega o registro completo e um endereço, e as páginas citam por
 * marcador `[[chave]]` em vez de escrever o nome à mão — assim uma citação nunca
 * aparece em duas grafias diferentes e nenhuma fica sem destino.
 *
 * POLÍTICA DE LINK, que é o que impede este arquivo de envelhecer mal: um
 * `doi.org` só entra quando o identificador foi conferido; nos demais casos o
 * destino é uma BUSCA pelo título no Crossref. Uma busca sempre leva o leitor ao
 * lugar certo, enquanto um DOI decorado de memória pode levar ao artigo errado —
 * que é pior do que não ter link nenhum numa página científica.
 *
 * A página de climatologia acrescenta em runtime a bibliografia que vem no
 * manifesto publicado pelo `labmim-climatology` (as famílias de distribuição).
 * Esta lista é a do site em si: o modelo, seus esquemas e as constantes.
 */

/** Busca por título no Crossref, para registros sem DOI conferido. */
function search(title) {
  return `https://search.crossref.org/?q=${encodeURIComponent(title)}`;
}

const SITE_REFERENCES = Object.freeze({
  wrf: {
    short: "Skamarock et al., 2019",
    citation:
      "Skamarock, W. C. et al. (2019). A Description of the Advanced Research WRF Model Version 4. " +
      "NCAR Technical Note NCAR/TN-556+STR. Documentação oficial do modelo usado nestas previsões.",
    url: "https://www2.mmm.ucar.edu/wrf/users/docs/user_guide_v4/v4.0/contents.html",
  },
  gfs: {
    short: "GFS/NCEP",
    citation:
      "Global Forecast System (GFS), National Centers for Environmental Prediction, NOAA. " +
      "Modelo global que fornece as condições iniciais e de contorno destas simulações.",
    url: "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast",
  },
  rrtmg: {
    short: "Iacono et al., 2008",
    citation:
      "Iacono, M. J., Delamere, J. S., Mlawer, E. J., Shephard, M. W., Clough, S. A. & Collins, W. D. " +
      "(2008). Radiative forcing by long-lived greenhouse gases: calculations with the AER radiative " +
      "transfer models. Journal of Geophysical Research 113, D13103. O esquema RRTMG.",
    url: search("Radiative forcing by long-lived greenhouse gases AER radiative transfer models"),
  },
  thompson: {
    short: "Thompson et al., 2008",
    citation:
      "Thompson, G., Field, P. R., Rasmussen, R. M. & Hall, W. D. (2008). Explicit forecasts of winter " +
      "precipitation using an improved bulk microphysics scheme. Part II: implementation of a new snow " +
      "parameterization. Monthly Weather Review 136(12), 5095-5115.",
    url: search("Explicit forecasts of winter precipitation improved bulk microphysics scheme Part II"),
  },
  wsm6: {
    short: "Hong e Lim, 2006",
    citation:
      "Hong, S.-Y. & Lim, J.-O. J. (2006). The WRF single-moment 6-class microphysics scheme (WSM6). " +
      "Journal of the Korean Meteorological Society 42(2), 129-151.",
    url: search("WRF single-moment 6-class microphysics scheme WSM6"),
  },
  ysu: {
    short: "Hong, Noh e Dudhia, 2006",
    citation:
      "Hong, S.-Y., Noh, Y. & Dudhia, J. (2006). A new vertical diffusion package with an explicit " +
      "treatment of entrainment processes. Monthly Weather Review 134(9), 2318-2341. O esquema YSU.",
    url: search("A new vertical diffusion package with an explicit treatment of entrainment processes"),
  },
  myj: {
    short: "Janjic, 1994",
    citation:
      "Janjic, Z. I. (1994). The step-mountain eta coordinate model: further developments of the " +
      "convection, viscous sublayer, and turbulence closure schemes. Monthly Weather Review 122(5), " +
      "927-945. O esquema MYJ de camada limite.",
    url: search("step-mountain eta coordinate model further developments convection viscous sublayer"),
  },
  noahmp: {
    short: "Niu et al., 2011",
    citation:
      "Niu, G.-Y. et al. (2011). The community Noah land surface model with multiparameterization " +
      "options (Noah-MP): 1. Model description and evaluation with local-scale measurements. " +
      "Journal of Geophysical Research 116, D12109.",
    url: search("community Noah land surface model with multiparameterization options Noah-MP"),
  },
  kainfritsch: {
    short: "Kain, 2004",
    citation:
      "Kain, J. S. (2004). The Kain-Fritsch convective parameterization: an update. " +
      "Journal of Applied Meteorology 43(1), 170-181.",
    url: search("The Kain-Fritsch convective parameterization an update"),
  },
  codata2018: {
    short: "CODATA 2018",
    citation:
      "CODATA Internationally Recommended Values of the Fundamental Physical Constants (ajuste de 2018), " +
      "NIST. Fonte da constante de Stefan-Boltzmann usada nas derivações desta página.",
    url: "https://physics.nist.gov/cuu/Constants/",
  },
});

module.exports = { SITE_REFERENCES };
