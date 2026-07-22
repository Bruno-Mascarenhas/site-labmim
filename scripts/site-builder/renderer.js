"use strict";

const fs = require("fs");
const path = require("path");
const { createAssetPipeline, writePublicationTheme } = require("./assets");

const read = (filePath) => fs.readFileSync(filePath, "utf8");
const replaceAll = (text, token, value) => text.split(token).join(value);
const escapeAttribute = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

  function affiliationMarkup(affiliation, extraClass = "") {
    const classes = ["site-affiliation", extraClass].filter(Boolean).join(" ");
    if (affiliation.kind === "image") {
      const image = `<img loading="lazy" src="${escapeAttribute(affiliation.src)}" alt="${escapeAttribute(affiliation.name)}" width="${affiliation.width}" height="${affiliation.height}" class="brand-logo-sm" />`;
      const picture = affiliation.webp
        ? `<picture><source srcset="${escapeAttribute(affiliation.webp)}" type="image/webp" />${image}</picture>`
        : image;
      return `<a href="${escapeAttribute(affiliation.href)}" target="_blank" rel="noopener" class="${classes}">${picture}</a>`;
    }
    return `<a href="${escapeAttribute(affiliation.href)}" target="_blank" rel="noopener" class="${classes} site-affiliation-text"><span>${escapeAttribute(affiliation.name)}</span><small>${escapeAttribute(affiliation.institution)}</small></a>`;
  }

  function affiliationsMarkup(extraClass = "") {
    return brand.affiliations.map((affiliation) => affiliationMarkup(affiliation, extraClass)).join("\n");
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
    AFFILIATIONS_NAV: affiliationsMarkup("me-3"),
    AFFILIATIONS_FOOTER: affiliationsMarkup(),
    COPYRIGHT_NAME: escapeAttribute(brand.copyrightName),
    INSTITUTION_NAME: escapeAttribute(institution.name),
    INSTITUTION_ACRONYM: escapeAttribute(institution.acronym),
    STATE_NAME: escapeAttribute(territory.name),
    STATE_CODE: escapeAttribute(territory.code),
    CITY_NAME: escapeAttribute(location.cityName),
    REGION_PHRASE: escapeAttribute(territory.regionPhrase),
    TERRAIN_EXAMPLE: escapeAttribute(territory.terrainExample),
    WEBGIS_BRAND: escapeAttribute(`${brand.name} / ${institution.acronym}`),
    DOMAIN_BUTTONS: domainButtons(),
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

  function assertResolved(file, html) {
    const leftover = html.match(/\{\{[^}]+\}\}/g);
    if (leftover) throw new Error(`${file}: unresolved tokens ${leftover.join(", ")}`);
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
    html = replaceAll(html, "{{bodyAttrs}}", page.bodyAttrs || "");
    html = replaceAll(html, "{{kicker}}", page.kicker || "");
    html = replaceAll(html, "{{docModalTitle}}", page.docModalTitle || "");
    html = replaceAll(html, "{{pageVendorStyles}}", stylesheetLinks(page.vendorStyles));
    html = replaceAll(html, "{{pageStyles}}", stylesheetLinks(page.styles));
    html = replaceAll(html, "{{content}}", pageContent(page));
    html = replaceAll(html, "{{h1}}", escapeAttribute(page.seo.h1));
    html = applySiteTokens(html);
    assertResolved(page.file, html);
    html = assetPipeline.stampAssetVersions(html);
    fs.writeFileSync(path.join(outputDir, page.file), html);
    return page.file;
  }

  function legacyRedirects() {
    return publication.redirects
      .map(
        (redirect) =>
          `  Redirect ${redirect.status} ${redirect.from} ${redirect.to}${redirect.hash ? `#${redirect.hash}` : ""}`
      )
      .join("\n");
  }

  function buildStaticFiles() {
    const staticDir = path.join(templateRoot, "static");
    let notFound = applySiteTokens(read(path.join(staticDir, "404.html")));
    assertResolved("404.html", notFound);
    notFound = assetPipeline.stampAssetVersions(notFound);
    fs.writeFileSync(path.join(outputDir, "404.html"), notFound);

    let htaccess = replaceAll(
      read(path.join(staticDir, "htaccess.template")),
      "{{LEGACY_REDIRECTS}}",
      legacyRedirects()
    );
    assertResolved(".htaccess", htaccess);
    fs.writeFileSync(path.join(outputDir, ".htaccess"), htaccess);

    const sitemapEntries = publication.pages
      .filter((page) => page.indexable !== false)
      .map((page) => `  <url>\n    <loc>${escapeAttribute(absoluteUrl(page.file))}</loc>\n  </url>`)
      .join("\n");
    fs.writeFileSync(
      path.join(outputDir, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>\n`
    );
    fs.writeFileSync(
      path.join(outputDir, "robots.txt"),
      `User-agent: *\nAllow: /\n\nSitemap: ${productionOrigin}/sitemap.xml\n\n# Dados gerados pelo pipeline externo — sem valor de SEO e potencialmente grandes.\n${[
        dataset.paths.values,
        dataset.paths.grids,
      ]
        .map((directory) => `Disallow: /${directory}/`)
        .join("\n")}\n`
    );
    return ["404.html", ".htaccess", "sitemap.xml", "robots.txt"];
  }

  const pagesWritten = publication.pages.map(buildPage);
  const staticWritten = buildStaticFiles();
  const expectedHtml = new Set([...pagesWritten, "404.html"]);
  for (const name of fs.readdirSync(outputDir)) {
    if (name.endsWith(".html") && !expectedHtml.has(name)) fs.unlinkSync(path.join(outputDir, name));
  }

  return { pagesWritten, staticWritten, themeWritten: "assets/css/site-theme.css" };
}

module.exports = { renderPublication };
