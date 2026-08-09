"use strict";

/**
 * Site bibliography.
 *
 * A bare "(Author, 2019)" gives a newcomer no title, no place to look and
 * nothing to read, so every entry here carries the full record and an address.
 * Pages cite by `[[key]]` marker instead of spelling the name out, which keeps
 * one spelling per citation and leaves none without a destination.
 *
 * LINK POLICY, and it is what keeps this file from ageing badly: a `doi.org`
 * address only when the identifier has been checked; otherwise the target is a
 * Crossref SEARCH by title. A search always lands the reader in the right
 * place, while a DOI recalled from memory can lead to the wrong paper — worse
 * than no link at all on a scientific page.
 *
 * The climatology page appends, at runtime, the bibliography shipped in the
 * manifest published by `labmim-climatology` (the distribution families). This
 * list is the site's own: the model, its schemes and the constants.
 */

/**
 * The route IS `/search/works`, and `from_ui=yes` is part of it. The short
 * `search.crossref.org/?q=…` address answers 200 and looks right, but the
 * current Crossref interface ignores the parameter there and opens with an
 * EMPTY search box and no results. Both answer 200, so no link checker can tell
 * them apart — only opening the page in a browser does.
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
    // The one exception to the policy above, because neither of the other two
    // routes exists for this record: the paper has no DOI and the journal is
    // not in Crossref, so the default title search CANNOT reach it and returns
    // papers that merely cite WSM6 — the wrong work, which is what the policy
    // is there to prevent. This is the verified permanent Semantic Scholar
    // record for it.
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
    // Verified DOI, deliberately: a title search puts a paper by other authors
    // first and the cited Part 1 does not even reach the top three results.
    url: "https://doi.org/10.1029/2010JD015139",
  },
  kainfritsch: {
    short: "Kain, 2004",
    citation:
      "Kain, J. S. (2004). The Kain-Fritsch convective parameterization: an update. " +
      "Journal of Applied Meteorology 43(1), 170-181.",
    url: crossrefTitleSearch("The Kain-Fritsch convective parameterization an update"),
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
