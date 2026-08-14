"use strict";

/**
 * Site bibliography: the model, its schemes and the constants. Pages cite by
 * `[[key]]` marker, and the climatology page appends at runtime the
 * bibliography shipped in the `labmim-climatology` manifest.
 *
 * LINK POLICY: a `doi.org` address only when the identifier has been checked;
 * otherwise a Crossref search by title. A DOI recalled from memory can lead to
 * the wrong paper — worse than no link at all on a scientific page.
 */

/**
 * The route IS `/search/works`, and `from_ui=yes` is part of it. The short
 * `search.crossref.org/?q=…` address answers 200 but ignores the parameter and
 * opens an EMPTY search box, so no link checker can tell the two apart.
 */
function crossrefTitleSearch(title) {
  return `https://search.crossref.org/search/works?q=${encodeURIComponent(title)}&from_ui=yes`;
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
    url: crossrefTitleSearch("Radiative forcing by long-lived greenhouse gases AER radiative transfer models"),
  },
  thompson: {
    short: "Thompson et al., 2008",
    citation:
      "Thompson, G., Field, P. R., Rasmussen, R. M. & Hall, W. D. (2008). Explicit forecasts of winter " +
      "precipitation using an improved bulk microphysics scheme. Part II: implementation of a new snow " +
      "parameterization. Monthly Weather Review 136(12), 5095-5115.",
    url: crossrefTitleSearch("Explicit forecasts of winter precipitation improved bulk microphysics scheme Part II"),
  },
  wsm6: {
    short: "Hong e Lim, 2006",
    citation:
      "Hong, S.-Y. & Lim, J.-O. J. (2006). The WRF single-moment 6-class microphysics scheme (WSM6). " +
      "Journal of the Korean Meteorological Society 42(2), 129-151.",
    // The exception to the policy above: no DOI, and the journal is not in
    // Crossref, so a title search returns papers that merely cite WSM6. Verified
    // permanent Semantic Scholar record.
    url: "https://www.semanticscholar.org/paper/f6014c7853ea15270114b4f1bfec2e64559e63dd",
  },
  ysu: {
    short: "Hong, Noh e Dudhia, 2006",
    citation:
      "Hong, S.-Y., Noh, Y. & Dudhia, J. (2006). A new vertical diffusion package with an explicit " +
      "treatment of entrainment processes. Monthly Weather Review 134(9), 2318-2341. O esquema YSU.",
    url: crossrefTitleSearch("A new vertical diffusion package with an explicit treatment of entrainment processes"),
  },
  myj: {
    short: "Janjic, 1994",
    citation:
      "Janjic, Z. I. (1994). The step-mountain eta coordinate model: further developments of the " +
      "convection, viscous sublayer, and turbulence closure schemes. Monthly Weather Review 122(5), " +
      "927-945. O esquema MYJ de camada limite.",
    url: crossrefTitleSearch("step-mountain eta coordinate model further developments convection viscous sublayer"),
  },
  noahmp: {
    short: "Niu et al., 2011",
    citation:
      "Niu, G.-Y. et al. (2011). The community Noah land surface model with multiparameterization " +
      "options (Noah-MP): 1. Model description and evaluation with local-scale measurements. " +
      "Journal of Geophysical Research 116, D12109.",
    // Verified DOI: a title search puts another paper first and the cited Part 1
    // does not reach the top three results.
    url: "https://doi.org/10.1029/2010JD015139",
  },
  kainfritsch: {
    short: "Kain, 2004",
    citation:
      "Kain, J. S. (2004). The Kain-Fritsch convective parameterization: an update. " +
      "Journal of Applied Meteorology 43(1), 170-181.",
    url: crossrefTitleSearch("The Kain-Fritsch convective parameterization an update"),
  },
  escobedo: {
    short: "Escobedo et al., 2009",
    citation:
      "Escobedo, J. F., Gomes, E. N., Oliveira, A. P. & Soares, J. (2009). Modeling hourly and daily fractions " +
      "of UV, PAR and NIR to global solar radiation under various sky conditions at Botucatu, Brazil. " +
      "Applied Energy 86(3), 299-309. Define as quatro condições de céu por faixas do índice de claridade.",
    url: "https://doi.org/10.1016/j.apenergy.2008.04.013",
  },
  teramoto: {
    short: "Teramoto e Escobedo, 2012",
    citation:
      "Teramoto, E. T. & Escobedo, J. F. (2012). Análise da frequência anual das condições de céu em Botucatu, " +
      "São Paulo. Revista Brasileira de Engenharia Agrícola e Ambiental 16(9), 985-992. Fonte da nomenclatura " +
      "em português das quatro condições de céu.",
    url: "https://doi.org/10.1590/S1415-43662012000900009",
  },
  marquesfilho: {
    short: "Marques Filho et al., 2016",
    citation:
      "Marques Filho, E. P., Oliveira, A. P., Vita, W. A., Mesquita, F. L. L., Codato, G., Escobedo, J. F., " +
      "Cassol, M. & França, J. R. A. (2016). Global, diffuse and direct solar radiation at the surface in the " +
      "city of Rio de Janeiro: observational characterization and empirical modeling. Renewable Energy 91, 64-74. " +
      "A sigmoide ajustada a médias horárias no Rio de Janeiro, função apenas do índice de claridade.",
    url: "https://doi.org/10.1016/j.renene.2016.01.040",
  },
  lemos: {
    short: "Lemos et al., 2017",
    citation:
      "Lemos, L. F. L., Starke, A. R., Boland, J., Cardemil, J. M., Machado, R. D. & Colle, S. (2017). " +
      "Assessment of solar radiation components in Brazil using the BRL model. Renewable Energy 108, 569-580. " +
      "O reajuste brasileiro do modelo BRL sobre nove estações do SONDA/INPE; a página usa os coeficientes " +
      "horários da Tabela 4.",
    url: "https://doi.org/10.1016/j.renene.2017.02.077",
  },
  ridley: {
    short: "Ridley, Boland e Lauret, 2010",
    citation:
      "Ridley, B., Boland, J. & Lauret, P. (2010). Modelling of diffuse solar fraction with multiple predictors. " +
      "Renewable Energy 35(2), 478-483. O modelo BRL original: logística no índice de claridade horário, hora " +
      "solar aparente, elevação solar, índice de claridade diário e persistência.",
    url: "https://doi.org/10.1016/j.renene.2009.07.018",
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
