"use strict";

const fs = require("fs");
const path = require("path");
const { createAssetPipeline, writePublicationTheme } = require("./assets");
const { publicationOperationalPaths } = require("./operational-paths");
const { SITE_REFERENCES } = require("../../src/template/references");

const read = (filePath) => fs.readFileSync(filePath, "utf8");
const replaceAll = (text, token, value) => text.split(token).join(value);

// A page that gets deleted and recreated lands at the umask default, which would show
// up as a mode-only diff in the committed site/ tree.
const GENERATED_FILE_MODE = 0o644;
const writeOutput = (filePath, content) => {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, GENERATED_FILE_MODE);
};
const escapeAttribute = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Ignored by assertResolved, then expanded right after it, so a page can document the
// template syntax itself without failing the unresolved-token check.
const LITERAL_BRACES = Object.freeze({ "{{LITERAL_OPEN}}": "{{", "{{LITERAL_CLOSE}}": "}}" });

const DEFAULT_FAVICON_EMOJI = "🌦️";

// WRF namelist defaults, overridable per dataset through an optional `model` block.
// The `[[key]]` markers are citations, expanded in the browser by assets/js/references.js.
// They sit beside the scheme name so a laboratory that runs MYNN instead of YSU changes
// one string and its paper travels with it, instead of the page crediting the wrong one.
const DEFAULT_MODEL = Object.freeze({
  initialConditions: "GFS (Global Forecast System) da NOAA [[gfs]], resolução 0.25°, atualizações a cada 6h.",
  verticalLevels: "~40 níveis sigma, com maior concentração na camada limite planetária (CLP).",
  radiation: "RRTMG [[rrtmg]]",
  microphysics: "Thompson [[thompson]] / WSM6 [[wsm6]]",
  planetaryBoundaryLayer: "YSU [[ysu]] / MYJ [[myj]]",
  landSurface: "Noah-MP [[noahmp]]",
  cumulus: "Kain-Fritsch [[kainfritsch]]",
});

// A spread COPIES an explicitly `undefined` value and wipes the default underneath it;
// the token would then render the word "undefined", crediting a scheme that does not exist.
const declaredFields = (block) =>
  Object.fromEntries(Object.entries(block || {}).filter(([, value]) => value !== undefined));

const DEFAULT_DATA_PIPELINE = "labmim-wrf-geojson";

const OBSERVATION_CHART_WIDTH = 800;
const OBSERVATION_CHART_HEIGHT = 400;

function faviconHref(emoji) {
  const glyph = escapeAttribute(emoji);
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${glyph}</text></svg>`;
}

function observationModalId(chartId) {
  const suffix = String(chartId)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `modal${suffix}`;
}

function naturalList(values, conjunction = "ou") {
  if (values.length < 2) return values[0] || "";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} ${conjunction} ${values.at(-1)}`;
}

function resolveSource(publication, templateRoot, source) {
  const base = source.scope === "site" ? publication.directory : templateRoot;
  return path.resolve(base, source.path);
}

function loadPartials(templateRoot) {
  const partialsDir = path.join(templateRoot, "partials");
  return Object.fromEntries(
    fs
      .readdirSync(partialsDir)
      .filter((name) => name.endsWith(".html"))
      .sort()
      .map((name) => [path.basename(name, ".html"), read(path.join(partialsDir, name))])
  );
}

function expandPartials(html, partials) {
  return html.replace(/\{\{>\s*([a-z0-9-]+)\s*\}\}/gi, (match, name) => partials[name] ?? match);
}

function renderPublication({ root, outputDir, publication, validation, year }) {
  const templateRoot = path.join(root, "src", "template");
  const { brand, dataset, institution, location, territory } = publication;
  const productionOrigin = publication.origin;
  const ogImage = `${productionOrigin}/${brand.ogImage}`;
  const partials = loadPartials(templateRoot);

  const generatedStylesRoot = path.join(outputDir, "assets", "css", "generated");
  fs.rmSync(generatedStylesRoot, { recursive: true, force: true });

  writePublicationTheme(publication, outputDir);
  const assetPipeline = createAssetPipeline(outputDir);

  const domains = dataset.domains;
  const model = { ...DEFAULT_MODEL, ...declaredFields(dataset.model) };
  const observationCharts = dataset.observations?.charts ?? [];
  const defaultDomain = domains.find((domain) => domain.id === dataset.defaultDomain);
  const forecastHorizonHours = (dataset.timeline.defaultMaxLayer - 1) * dataset.timeline.stepHours;
  const timelineFrequency =
    dataset.timeline.stepHours === 1
      ? "horárias"
      : `a cada ${String(dataset.timeline.stepHours).replace(".", ",")} horas`;
  const navigation = publication.pages
    .filter((page) => page.nav)
    .sort((left, right) => left.nav.order - right.nav.order || left.file.localeCompare(right.file));

  function brandPicture(logo, { loading = "lazy", className = "brand-logo site-brand-logo" } = {}) {
    const image = `<img loading="${loading}" src="${escapeAttribute(logo.src)}" alt="${escapeAttribute(`${brand.name} Logo`)}" width="${logo.width}" height="${logo.height}" class="${className}" />`;
    if (!logo.webp) return image;
    return `<picture><source srcset="${escapeAttribute(logo.webp)}" type="image/webp" />${image}</picture>`;
  }

  // The `kind: "text"` variant takes no per-slot class on purpose: its footer treatment
  // is a contextual rule (`.modern-footer .site-affiliation-text` in assets/css/base.css).
  function affiliationMarkup(affiliation, extraClass = "", { imageClass = "brand-logo-sm" } = {}) {
    const classes = ["site-affiliation", extraClass].filter(Boolean).join(" ");
    if (affiliation.kind === "image") {
      const image = `<img loading="lazy" src="${escapeAttribute(affiliation.src)}" alt="${escapeAttribute(affiliation.name)}" width="${affiliation.width}" height="${affiliation.height}" class="${escapeAttribute(imageClass)}" />`;
      const picture = affiliation.webp
        ? `<picture><source srcset="${escapeAttribute(affiliation.webp)}" type="image/webp" />${image}</picture>`
        : image;
      return `<a href="${escapeAttribute(affiliation.href)}" target="_blank" rel="noopener" class="${classes}">${picture}</a>`;
    }
    return `<a href="${escapeAttribute(affiliation.href)}" target="_blank" rel="noopener" class="${classes} site-affiliation-text"><span>${escapeAttribute(affiliation.name)}</span><small>${escapeAttribute(affiliation.institution)}</small></a>`;
  }

  function affiliationsMarkup(extraClass = "", options = {}) {
    return brand.affiliations.map((affiliation) => affiliationMarkup(affiliation, extraClass, options)).join("\n");
  }

  function observationImage(chart) {
    const width = chart.width ?? OBSERVATION_CHART_WIDTH;
    const height = chart.height ?? OBSERVATION_CHART_HEIGHT;
    return `<img loading="lazy" class="d-block w-100" src="${escapeAttribute(chart.src)}" width="${width}" height="${height}" alt="${escapeAttribute(chart.alt ?? chart.title)}" />`;
  }

  function observationChartCards() {
    return observationCharts
      .map(
        (chart) => `<div class="col-sm-4 mb-3">
  <div class="container-overlay">
    ${observationImage(chart)}
    <button type="button" class="btn btn-primary overlay" data-bs-toggle="modal" data-bs-target="#${escapeAttribute(observationModalId(chart.id))}">
      <span class="text">${escapeAttribute(chart.title)}</span>
    </button>
  </div>
</div>`
      )
      .join("\n");
  }

  function observationChartModals() {
    return observationCharts
      .map((chart) => {
        const modalId = observationModalId(chart.id);
        const labelId = `${modalId}Label`;
        return `<div class="modal fade" id="${escapeAttribute(modalId)}" tabindex="-1" aria-labelledby="${escapeAttribute(labelId)}">
  <div class="modal-dialog ${escapeAttribute(chart.modalSize ?? "modal-lg")}">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="${escapeAttribute(labelId)}">${escapeAttribute(chart.title)}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
      </div>
      <div class="modal-body">
        ${observationImage(chart)}
      </div>
    </div>
  </div>
</div>`;
      })
      .join("\n\n");
  }

  function runtimeConfig() {
    const viewport = territory.viewport;
    return {
      publicationId: publication.id,
      brandName: brand.name,
      territory: { id: territory.id, code: territory.code, name: territory.name },
      data: {
        manifestPath: dataset.paths.manifest,
        valuesBase: dataset.paths.values,
        gridsBase: dataset.paths.grids,
        timeline: dataset.timeline,
      },
      map: {
        initialCenter: viewport.center,
        initialZoom: viewport.zoom,
        fitBounds: viewport.fitBoundary ? validation.boundaryBounds : null,
        fitMaxZoom: viewport.fitMaxZoom,
        stateCode: territory.code,
        stateName: territory.name,
        boundaryAsset: territory.boundaryAsset,
        attribution: dataset.attribution,
        defaultDomain: dataset.defaultDomain,
        domains: Object.fromEntries(
          domains.map((domain) => [domain.id, { label: domain.label, center: domain.center, zoom: domain.zoom }])
        ),
      },
    };
  }

  function domainButtons() {
    return domains
      .map((domain) => {
        const active = domain.id === dataset.defaultDomain ? " active" : "";
        return `<button type="button" class="domain-btn${active}" aria-pressed="${domain.id === dataset.defaultDomain}" data-domain="${escapeAttribute(domain.id)}" data-zoom="${domain.zoom}">${escapeAttribute(domain.label)}</button>`;
      })
      .join("\n");
  }

  function domainDocumentation() {
    return domains
      .map(
        (domain) =>
          `<li><strong>${escapeAttribute(domain.longLabel)} — ${escapeAttribute(domain.resolution)}:</strong> ${escapeAttribute(domain.description)}</li>`
      )
      .join("\n");
  }

  const siteTokens = {
    PUBLICATION_ID: escapeAttribute(publication.id),
    TERRITORY_ID: escapeAttribute(territory.id),
    SITE_CONFIG: escapeAttribute(JSON.stringify(runtimeConfig())),
    BRAND_NAME: escapeAttribute(brand.name),
    BRAND_FULL_NAME: escapeAttribute(brand.fullName),
    BRAND_NAV_PICTURE: brandPicture(brand.logos.nav, { loading: "eager" }),
    BRAND_FOOTER_PICTURE: brandPicture(brand.logos.footer, {
      className: "brand-logo brand-logo-bright site-brand-logo",
    }),
    BRAND_SIDEBAR_PICTURE: brandPicture(brand.logos.sidebar),
    // Raw on purpose: faviconHref escapes the glyph, and its `<svg>` is literal markup.
    FAVICON: faviconHref(brand.favicon ?? DEFAULT_FAVICON_EMOJI),
    AFFILIATIONS_NAV: affiliationsMarkup("me-3"),
    AFFILIATIONS_FOOTER: affiliationsMarkup("", { imageClass: "brand-logo brand-logo-bright" }),
    COPYRIGHT_NAME: escapeAttribute(brand.copyrightName),
    INSTITUTION_ACRONYM: escapeAttribute(institution.acronym),
    REGION_PHRASE: escapeAttribute(territory.regionPhrase),
    TERRAIN_EXAMPLE: escapeAttribute(territory.terrainExample),
    WEBGIS_BRAND: escapeAttribute(`${brand.name} / ${institution.acronym}`),
    DOMAIN_BUTTONS: domainButtons(),
    DOMAIN_COUNT: String(domains.length),
    DEFAULT_DOMAIN_LABEL: escapeAttribute(defaultDomain.label),
    DOMAIN_LABELS: escapeAttribute(naturalList(domains.map((domain) => domain.label))),
    COARSE_DOMAIN_LABELS: escapeAttribute(
      naturalList(
        domains.filter((domain) => domain.cumulusParameterized).map((domain) => domain.label),
        "e"
      )
    ),
    FINE_DOMAIN_LABELS: escapeAttribute(
      naturalList(
        domains.filter((domain) => !domain.cumulusParameterized).map((domain) => domain.label),
        "e"
      )
    ),
    DOMAIN_DOCUMENTATION: domainDocumentation(),
    TIMELINE_MAX: String(dataset.timeline.defaultMaxLayer),
    TIMELINE_INITIAL_INDEX: String(dataset.timeline.initialIndex),
    TIMELINE_STEP_COUNT: String(dataset.timeline.defaultMaxLayer),
    FORECAST_HORIZON_HOURS: String(forecastHorizonHours).replace(".", ","),
    TIMELINE_OUTPUT_FREQUENCY: timelineFrequency,
    TIMEZONE_LABEL: escapeAttribute(dataset.timeline.label),
    DATA_PIPELINE_NAME: escapeAttribute(dataset.generator ?? DEFAULT_DATA_PIPELINE),
    MODEL_INITIAL_CONDITIONS: escapeAttribute(model.initialConditions),
    MODEL_VERTICAL_LEVELS: escapeAttribute(model.verticalLevels),
    MODEL_RADIATION: escapeAttribute(model.radiation),
    MODEL_MICROPHYSICS: escapeAttribute(model.microphysics),
    MODEL_PBL: escapeAttribute(model.planetaryBoundaryLayer),
    MODEL_LAND_SURFACE: escapeAttribute(model.landSurface),
    MODEL_CUMULUS: escapeAttribute(model.cumulus),
    OBSERVATION_CHART_CARDS: observationChartCards(),
    OBSERVATION_CHART_MODALS: observationChartModals(),
    // CLIMATOLOGY_BASE, MONITORING_BASE and SKY_BASE ship as `data-`, never href/src:
    // their directories arrive only with the deploy, so a reference the link and bundle
    // checkers could see would fail the build on every machine without the data.
    CLIMATOLOGY_BASE: escapeAttribute(dataset.paths.climatology ?? ""),
    // `<` is escaped because `</script` is the only sequence able to close the embedding
    // <script type="application/json"> early, and it can appear inside a paper title.
    SITE_REFERENCES: JSON.stringify(SITE_REFERENCES).replace(/</g, "\\u003c"),
    MONITORING_BASE: escapeAttribute(dataset.paths.monitoring ?? ""),
    SKY_BASE: escapeAttribute(dataset.paths.sky ?? ""),
  };

  function applySiteTokens(html) {
    let output = html;
    for (const [name, value] of Object.entries(siteTokens)) {
      output = replaceAll(output, `{{${name}}}`, value);
    }
    return output;
  }

  function absoluteUrl(file) {
    return productionOrigin + (file === "index.html" ? "/" : `/${file}`);
  }

  function seoHead(page) {
    const { title, description } = page.seo;
    const url = absoluteUrl(page.file);
    return [
      // Leaving the page out of the sitemap only withdraws a suggestion; one inbound link
      // elsewhere still indexes it. "follow" keeps the value of the links it hands out.
      ...(page.indexable === false ? ['    <meta name="robots" content="noindex, follow" />', ""] : []),
      `    <link rel="canonical" href="${escapeAttribute(url)}" />`,
      "",
      "    <!-- Open Graph -->",
      '    <meta property="og:type" content="website" />',
      `    <meta property="og:site_name" content="${escapeAttribute(brand.name)}" />`,
      `    <meta property="og:title" content="${escapeAttribute(title)}" />`,
      `    <meta property="og:description" content="${escapeAttribute(description)}" />`,
      `    <meta property="og:url" content="${escapeAttribute(url)}" />`,
      `    <meta property="og:image" content="${escapeAttribute(ogImage)}" />`,
      "",
      "    <!-- Twitter -->",
      '    <meta name="twitter:card" content="summary_large_image" />',
      `    <meta name="twitter:title" content="${escapeAttribute(title)}" />`,
      `    <meta name="twitter:description" content="${escapeAttribute(description)}" />`,
      `    <meta name="twitter:image" content="${escapeAttribute(ogImage)}" />`,
    ].join("\n");
  }

  function structuredData(page) {
    if (page.id !== "home") return "";
    const data = {
      "@context": "https://schema.org",
      "@type": "ResearchOrganization",
      name: `${brand.name} — ${brand.fullName}`,
      alternateName: brand.name,
      url: `${productionOrigin}/`,
      logo: ogImage,
      description: page.seo.description,
      parentOrganization: {
        "@type": "CollegeOrUniversity",
        name: institution.name,
        alternateName: institution.acronym,
      },
      areaServed: `${location.cityName} e ${territory.name}, Brasil`,
    };
    const serialized = JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
    return `<script type="application/ld+json">\n${serialized}\n</script>`;
  }

  function navItems(activePageId) {
    return navigation
      .map((page) => {
        const active = page.id === activePageId;
        const classes = `btn btn-outline-lab${active ? " active" : ""}`;
        const current = active ? ' aria-current="page"' : "";
        return `            <li class="nav-item me-2"><a class="${classes}" href="${escapeAttribute(page.file)}" id="${escapeAttribute(page.nav.elementId)}"${current}>${escapeAttribute(page.nav.label)}</a></li>`;
      })
      .join("\n");
  }

  function footerNavigation() {
    return navigation
      .map(
        (page) =>
          `            <a href="${escapeAttribute(page.file)}"><i class="fas ${escapeAttribute(page.nav.icon)} me-1"></i> ${escapeAttribute(page.nav.label)}</a>`
      )
      .join("\n");
  }

  function pageContent(page) {
    const pieces = [page.source, ...page.append];
    return pieces
      .map((source) =>
        expandPartials(read(resolveSource(publication, templateRoot, source)), partials).replace(/\n$/, "")
      )
      .filter(Boolean)
      .join("\n\n");
  }

  function stylesheetHref(stylesheet) {
    if (typeof stylesheet === "string") return stylesheet;

    const relativeSource = stylesheet.path.slice("styles/".length);
    const owner = stylesheet.scope === "site" ? publication.id : "template";
    const href = path.posix.join("assets", "css", "generated", owner, relativeSource);
    const destination = path.join(outputDir, ...href.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(resolveSource(publication, templateRoot, stylesheet), destination);
    return href;
  }

  function stylesheetLinks(stylesheets) {
    return stylesheets
      .map((stylesheet) => `<link rel="stylesheet" href="${escapeAttribute(stylesheetHref(stylesheet))}" />`)
      .join("\n");
  }

  // `defer` scripts run in document order, so vendor-first is what guarantees `Chart` is
  // defined when the page module runs. The `{{pageScripts}}` slot sits after `{{> scripts}}`
  // in the layout for the same reason: the Bootstrap bundle must exist before the page JS.
  function scriptTags(page) {
    return [...page.vendorScripts, ...page.scripts]
      .map((source) => `    <script defer src="${escapeAttribute(source)}"></script>`)
      .join("\n");
  }

  // The slot regex swallows the preceding newline so a page without scripts leaves no
  // blank line before `</body>`: site/ is committed and that line would be diff churn.
  function applyPageScripts(page, html) {
    const tags = scriptTags(page);
    const slot = /\n[ \t]*\{\{pageScripts\}\}/;
    if (!slot.test(html)) {
      if (tags) {
        throw new Error(
          `${page.file}: the "${page.layout}" layout has no {{pageScripts}} slot, but the page declares ` +
            `${page.vendorScripts.length + page.scripts.length} script(s). Add the slot to ` +
            `src/template/layouts/${page.layout}.html (after {{> scripts}}) or drop the declaration.`
        );
      }
      return html;
    }
    return html.replace(slot, tags ? `\n${tags}` : "");
  }

  // `replaceAll` is split/join: in a layout without the token the substitution is a silent
  // no-op and the declared value evaporates — the page ships with a bare `<body>` (the map
  // falls back to the "forecast" context) or an untitled modal, and still looks finished.
  function applyRawSlot(page, html, token, value) {
    if (value !== "" && !html.includes(token)) {
      throw new Error(
        `${page.file}: the "${page.layout}" layout has no ${token} slot, but the page declares one. ` +
          `Add the slot to src/template/layouts/${page.layout}.html or drop the declaration.`
      );
    }
    return replaceAll(html, token, value);
  }

  function assertResolved(file, html) {
    const leftover = (html.match(/\{\{[^}]+\}\}/g) || []).filter((token) => !(token in LITERAL_BRACES));
    if (leftover.length === 0) return;
    const unique = [...new Set(leftover)];
    throw new Error(
      [
        `${file}: ${unique.length} unresolved template ${unique.length === 1 ? "token" : "tokens"}: ${unique.join(", ")}`,
        "  Layout, partial and page-body tokens are substituted BEFORE this check runs, so a surviving token is either",
        "  misspelled or not published by scripts/site-builder/renderer.js (siteTokens / buildPage).",
        `  To print literal braces in a page, write ${Object.keys(LITERAL_BRACES).join(" / ")} instead.`,
      ].join("\n")
    );
  }

  function resolveLiteralBraces(html) {
    let output = html;
    for (const [token, value] of Object.entries(LITERAL_BRACES)) output = replaceAll(output, token, value);
    return output;
  }

  function buildPage(page) {
    let html = expandPartials(read(path.join(templateRoot, "layouts", `${page.layout}.html`)), partials);
    html = replaceAll(html, "{{NAV_ITEMS}}", navItems(page.id));
    html = replaceAll(html, "{{FOOTER_NAV}}", footerNavigation());
    html = replaceAll(html, "{{YEAR}}", year);
    html = replaceAll(html, "{{WORKER_HASHES}}", assetPipeline.workerHashes());
    html = replaceAll(html, "{{seoHead}}", seoHead(page));
    html = replaceAll(html, "{{structuredData}}", structuredData(page));
    html = replaceAll(html, "{{title}}", escapeAttribute(page.seo.title));
    html = replaceAll(html, "{{description}}", escapeAttribute(page.seo.description));
    // bodyAttrs is attribute markup by design; kicker and docModalTitle are text.
    html = applyRawSlot(page, html, "{{bodyAttrs}}", page.bodyAttrs || "");
    html = applyRawSlot(page, html, "{{kicker}}", escapeAttribute(page.kicker || ""));
    html = applyRawSlot(page, html, "{{docModalTitle}}", escapeAttribute(page.docModalTitle || ""));
    html = replaceAll(html, "{{pageVendorStyles}}", stylesheetLinks(page.vendorStyles));
    html = replaceAll(html, "{{pageStyles}}", stylesheetLinks(page.styles));
    html = applyPageScripts(page, html);
    html = replaceAll(html, "{{content}}", pageContent(page));
    html = replaceAll(html, "{{h1}}", escapeAttribute(page.seo.h1));
    html = applySiteTokens(html);
    assertResolved(page.file, html);
    html = resolveLiteralBraces(html);
    html = assetPipeline.stampAssetVersions(html);
    writeOutput(path.join(outputDir, page.file), html);
    return page.file;
  }

  // mod_alias splits its arguments on whitespace; quoting survives a path with a space.
  function legacyRedirects() {
    return publication.redirects
      .map(
        (redirect) =>
          `  Redirect ${redirect.status} "${redirect.from}" "${redirect.to}${redirect.hash ? `#${redirect.hash}` : ""}"`
      )
      .join("\n");
  }

  function buildStaticFiles() {
    const staticDir = path.join(templateRoot, "static");
    let notFound = applySiteTokens(read(path.join(staticDir, "404.html")));
    assertResolved("404.html", notFound);
    notFound = resolveLiteralBraces(notFound);
    notFound = assetPipeline.stampAssetVersions(notFound);
    writeOutput(path.join(outputDir, "404.html"), notFound);

    let htaccess = replaceAll(
      read(path.join(staticDir, "htaccess.template")),
      "{{LEGACY_REDIRECTS}}",
      legacyRedirects()
    );
    assertResolved(".htaccess", htaccess);
    htaccess = resolveLiteralBraces(htaccess);
    writeOutput(path.join(outputDir, ".htaccess"), htaccess);

    const sitemapEntries = publication.pages
      .filter((page) => page.indexable !== false)
      .map((page) => `  <url>\n    <loc>${escapeAttribute(absoluteUrl(page.file))}</loc>\n  </url>`)
      .join("\n");
    writeOutput(
      path.join(outputDir, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>\n`
    );
    writeOutput(
      path.join(outputDir, "robots.txt"),
      // This host's own declared paths, not the union across the tree. `assets/graphs` is
      // left out on purpose: the station PNGs are figure landing pages with SEO value.
      `User-agent: *\nAllow: /\n\nSitemap: ${productionOrigin}/sitemap.xml\n\n# Dados gerados pelo pipeline externo — sem valor de SEO e potencialmente grandes.\n${publicationOperationalPaths(
        publication,
        { includeGraphs: false }
      )
        .directories.map((directory) => `Disallow: /${directory}/`)
        .join("\n")}\n`
    );
    return ["404.html", ".htaccess", "sitemap.xml", "robots.txt"];
  }

  const pagesWritten = publication.pages.map(buildPage);
  const staticWritten = buildStaticFiles();
  const expectedHtml = new Set([...pagesWritten, "404.html"]);
  for (const name of fs.readdirSync(outputDir)) {
    if (!name.endsWith(".html") || expectedHtml.has(name)) continue;
    fs.unlinkSync(path.join(outputDir, name));
    console.log(`build.js: removed stale page not owned by ${publication.id} -> ${name}`);
  }

  return { pagesWritten, staticWritten, themeWritten: "assets/css/site-theme.css" };
}

// observationModalId and DEFAULT_MODEL travel to validate.js so it checks chart-id
// collisions and unknown `dataset.model` keys against exactly what this file emits.
module.exports = { renderPublication, observationModalId, DEFAULT_MODEL };
