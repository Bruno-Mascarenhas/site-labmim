#!/usr/bin/env node
/**
 * build.js — dependency-free static-site assembler for the LabMiM site.
 *
 * Expands the page sources in src/pages/ into full, plain HTML files in site/,
 * pulling the shared <head>, navbar, footer and script tags from src/partials/
 * so those blocks live in exactly one place. The deployed site stays 100% static
 * plain files — this only runs locally / in CI, never on the host.
 *
 * Usage:  node build.js            (writes site/*.html, then run prettier)
 * Uses only Node's standard library (fs, path). No npm dependencies.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const SITE = path.join(ROOT, "site");

// Production origin (no trailing slash). Absolute URLs for SEO are derived from this.
const PROD = "https://labmim.if.ufba.br";
const OG_IMAGE = `${PROD}/assets/img/logonova1.png`;

// --- Single source of truth for the navigation (order matters) ---------------
const NAV = [
  { key: "mapas", href: "mapas_interativos.html", label: "Previsões", id: "nav-mapas", ficon: "fa-map" },
  {
    key: "potenciais",
    href: "potenciais_energeticos.html",
    label: "Potenciais Energéticos",
    id: "nav-potenciais",
    ficon: "fa-bolt",
  },
  { key: "monitoring", href: "monitoring.html", label: "Monitoramento", id: "nav-monitoring", ficon: "fa-chart-line" },
  {
    key: "climatologia",
    href: "climatologia.html",
    label: "Climatologia",
    id: "nav-climatologia",
    ficon: "fa-cloud-sun",
  },
  { key: "team", href: "team.html", label: "Equipe", id: "nav-team", ficon: "fa-users" },
];

// --- Page manifest: each page's metadata (content lives in src/pages/) --------
const PAGES = [
  {
    file: "index.html",
    layout: "institutional",
    active: "", // homepage is not a nav target
    h1: "LabMiM — Laboratório de Micrometeorologia e Modelagem",
    title: "LabMiM — Laboratório de Micrometeorologia e Modelagem · UFBA",
    description:
      "LabMiM - Laboratório de Micrometeorologia e Modelagem da UFBA. Previsão numérica do tempo, monitoramento ambiental e pesquisa atmosférica em Salvador e Bahia.",
  },
  {
    file: "monitoring.html",
    layout: "institutional",
    active: "monitoring",
    h1: "Monitoramento Ambiental",
    title: "LabMiM — Monitoramento Ambiental · UFBA",
    description:
      "LabMiM — Monitoramento Ambiental: variáveis meteorológicas medidas em tempo quase real por estações micrometeorológicas em Salvador, Bahia.",
  },
  {
    file: "team.html",
    layout: "institutional",
    active: "team",
    h1: "Equipe",
    title: "LabMiM — Equipe · UFBA",
    description:
      "LabMiM — Equipe de pesquisadores do Laboratório de Micrometeorologia e Modelagem da UFBA: professores, doutorandos, mestrandos e colaboradores.",
  },
  {
    file: "climatologia.html",
    layout: "institutional",
    active: "climatologia",
    h1: "Climatologia",
    title: "LabMiM — Climatologia · UFBA",
    description:
      "LabMiM — Climatologia: análise climática da Região Metropolitana de Salvador e Bahia. Laboratório de Micrometeorologia e Modelagem, UFBA.",
  },
  {
    file: "mapas_interativos.html",
    layout: "webgis",
    active: "mapas",
    bodyAttrs: ' data-map-context="forecast"',
    h1: "Mapas Interativos WRF",
    title: "LabMiM — Mapas Interativos WRF · UFBA",
    description:
      "LabMiM — Mapas Interativos WRF: visualização interativa de dados de previsão numérica do modelo WRF para Bahia. Laboratório de Micrometeorologia e Modelagem, UFBA.",
  },
  {
    file: "potenciais_energeticos.html",
    layout: "webgis",
    active: "potenciais",
    bodyAttrs: ' data-map-context="energy"',
    h1: "Potenciais Energéticos",
    title: "LabMiM — Potenciais Energéticos · UFBA",
    description:
      "LabMiM — Potenciais Energéticos: mapas interativos de potencial fotovoltaico, potencial eólico e densidade eólica derivados do modelo WRF para Bahia.",
  },
];

// --- Tiny template engine ----------------------------------------------------
const read = (p) => fs.readFileSync(p, "utf8");
// literal (non-regex) replace-all, safe against $ and other special chars
const sub = (text, token, value) => text.split(token).join(value);

// Escape a value for use inside an HTML double-quoted attribute.
const attr = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Absolute canonical URL for a page file (homepage collapses to the origin root).
function absUrl(file) {
  return PROD + (file === "index.html" ? "/" : "/" + file);
}

// Per-page SEO block: canonical + Open Graph + Twitter. Values come straight from
// the page manifest so the meta tags stay in lockstep with <title>/<description>.
function seoHead(page) {
  const url = absUrl(page.file);
  const t = attr(page.title);
  const d = attr(page.description);
  const img = attr(OG_IMAGE);
  return [
    `    <link rel="canonical" href="${attr(url)}" />`,
    ``,
    `    <!-- Open Graph -->`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="LabMiM" />`,
    `    <meta property="og:title" content="${t}" />`,
    `    <meta property="og:description" content="${d}" />`,
    `    <meta property="og:url" content="${attr(url)}" />`,
    `    <meta property="og:image" content="${img}" />`,
    ``,
    `    <!-- Twitter -->`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${t}" />`,
    `    <meta name="twitter:description" content="${d}" />`,
    `    <meta name="twitter:image" content="${img}" />`,
  ].join("\n");
}

const partials = {
  head: read(path.join(SRC, "partials", "head.html")),
  nav: read(path.join(SRC, "partials", "nav.html")),
  footer: read(path.join(SRC, "partials", "footer.html")),
  scripts: read(path.join(SRC, "partials", "scripts.html")),
};

function navItems(active) {
  return NAV.map((n) => {
    const on = n.key === active;
    const cls = "btn btn-outline-lab" + (on ? " active" : "");
    const aria = on ? ' aria-current="page"' : "";
    return `            <li class="nav-item me-2"><a class="${cls}" href="${n.href}" id="${n.id}"${aria}>${n.label}</a></li>`;
  }).join("\n");
}

function footerNav() {
  return NAV.map((n) => `            <a href="${n.href}"><i class="fas ${n.ficon} me-1"></i> ${n.label}</a>`).join(
    "\n"
  );
}

function expandPartials(layout) {
  let out = layout;
  for (const name of Object.keys(partials)) {
    out = sub(out, `{{> ${name}}}`, partials[name]);
  }
  return out;
}

// --- Cache-busting por hash de conteúdo ---------------------------------------
// CSS/JS próprios (assets/css/, assets/js/ — vendor fica de fora, já versionado
// por release) recebem ?v=<hash md5 curto do conteúdo>. O .htaccess serve
// URLs versionadas com cache longo; qualquer edição no arquivo muda o token
// em todas as páginas no próximo build. Os Web Workers não passam por aqui:
// são carregados pelo map-manager.js via WORKER_CACHE_VERSION.
// O bootstrap.purged.min.css TAMBÉM entra no hash: apesar de morar em vendor/,
// seu conteúdo é função do HTML/JS do site (PurgeCSS) — um token fixo de
// release deixaria visitantes recorrentes com o CSS antigo após um re-purge.
const HASHED_VENDOR_ASSETS = new Set(["assets/vendor/bootstrap/bootstrap.purged.min.css"]);
const assetHashCache = new Map();
function assetHash(relPath) {
  if (!assetHashCache.has(relPath)) {
    const content = fs.readFileSync(path.join(SITE, relPath));
    assetHashCache.set(relPath, crypto.createHash("md5").update(content).digest("hex").slice(0, 8));
  }
  return assetHashCache.get(relPath);
}

// Os Web Workers não aparecem em href/src no HTML (são carregados pelo
// map-manager.js), então recebem seus hashes via meta labmim-asset-hashes —
// editar um worker passa a invalidar o cache sem bump manual de constante.
function workerHashes() {
  const workersDir = path.join(SITE, "assets", "js", "workers");
  if (!fs.existsSync(workersDir)) return "";
  return fs
    .readdirSync(workersDir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => `${name}:${assetHash(path.posix.join("assets/js/workers", name))}`)
    .join(";");
}

function stampAssetVersions(html) {
  return html.replace(
    /(href|src)="(assets\/[^"?]+)(\?v=[^"]*)?"/g,
    (match, attrName, relPath) => {
      const firstParty = /^assets\/(?:css|js)\//.test(relPath);
      if (!firstParty && !HASHED_VENDOR_ASSETS.has(relPath)) return match;
      return `${attrName}="${relPath}?v=${assetHash(relPath)}"`;
    }
  );
}

function buildPage(page) {
  const layout = read(path.join(SRC, "layouts", `${page.layout}.html`));
  const content = read(path.join(SRC, "pages", page.file)).replace(/\n$/, "");

  let html = expandPartials(layout);
  html = sub(html, "{{NAV_ITEMS}}", navItems(page.active || ""));
  html = sub(html, "{{FOOTER_NAV}}", footerNav());
  html = sub(html, "{{WORKER_HASHES}}", workerHashes());
  html = sub(html, "{{seoHead}}", seoHead(page));
  html = sub(html, "{{title}}", attr(page.title));
  html = sub(html, "{{description}}", attr(page.description));
  html = sub(html, "{{bodyAttrs}}", page.bodyAttrs || "");
  html = sub(html, "{{content}}", content);
  html = sub(html, "{{h1}}", attr(page.h1 || page.title)); // resolved after content so it works in either

  const leftover = html.match(/\{\{[^}]+\}\}/g);
  if (leftover) throw new Error(`${page.file}: unresolved tokens ${leftover.join(", ")}`);

  html = stampAssetVersions(html);

  fs.writeFileSync(path.join(SITE, page.file), html);
  return page.file;
}

const written = PAGES.map(buildPage);
console.log(`build.js: wrote ${written.length} pages -> ${written.join(", ")}`);
console.log("Run prettier on site/*.html to format (npm run build does this).");
