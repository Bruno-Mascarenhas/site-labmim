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

/**
 * Busca por título no Crossref, para registros sem DOI conferido.
 *
 * A rota É `/search/works`, e o `from_ui=yes` faz parte dela. O endereço curto
 * `search.crossref.org/?q=…` responde 200 e parece certo, mas a interface atual
 * do Crossref ignora o parâmetro ali: a página abre com o campo de busca VAZIO e
 * nenhum resultado. Medido — pelo caminho antigo o campo volta `""`; por este ele
 * volta preenchido com o título e a lista de resultados aparece. Como o status
 * HTTP é 200 nos dois, nenhum verificador de links acusa a diferença; só abrir a
 * página no navegador acusa.
 */
function search(title) {
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
    // Única exceção à política acima, e a razão é que as duas outras rotas não
    // existem para este registro. O artigo não tem DOI (confirmado na OpenAlex,
    // que devolve `doi: null`) e a revista não está no Crossref (a consulta a
    // /journals por "Korean Meteorological Society" volta vazia), então a busca
    // que este arquivo usa como padrão NÃO pode achá-lo: medida no navegador,
    // ela responde 200, roda e devolve 1,9 milhão de resultados cujos três
    // primeiros são outros artigos que apenas citam o WSM6 — o leitor cai no
    // trabalho errado, que é justamente o que a política quer evitar. O endereço
    // abaixo é o registro permanente do Semantic Scholar, cuja identidade foi
    // conferida na API em 2026-08-09: título, autores (Hong, Lim) e ano batem, e
    // o identificador MAG 1909100498 é o mesmo que a OpenAlex atribui ao artigo.
    url: "https://www.semanticscholar.org/paper/f6014c7853ea15270114b4f1bfec2e64559e63dd",
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
    // DOI conferido na API do Crossref em 2026-08-09: o registro devolve este
    // título, Niu/Yang/Mitchell e 2011, exatamente o que a citação afirma.
    // Aqui a busca por título não servia: medida no navegador, ela devolve como
    // primeiro resultado um artigo de outros autores sobre neve no Noah-MP, e o
    // artigo citado (a Parte 1) nem aparece entre os três primeiros — o terceiro
    // é a Parte 2, que é outro trabalho. Como a página de destino abre certa e o
    // status é 200, só olhar o resultado da busca acusa a troca.
    url: "https://doi.org/10.1029/2010JD015139",
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
