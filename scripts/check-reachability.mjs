#!/usr/bin/env node

/**
 * Every control on every built page, at every viewport, must be REACHABLE — not merely
 * present. The bug this exists for was a domain button that rendered at the right size
 * with the right label and still took no clicks, because the time bar was painted over
 * it below a certain window height. Nothing that checks for existence would have caught
 * it; `elementFromPoint` at the control's own centre does.
 *
 * Viewports are what the page GETS, not what the panel reports: a 1366x768 laptop leaves
 * about 625px once the browser's own chrome is out, and that is the band the bug lived in.
 *
 * Playwright is a devDependency but its BROWSER is a separate download, so a fresh clone
 * has the package and no chromium. The check says which command supplies it rather than
 * failing on a stack trace.
 */

import http from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const siteRoot = path.join(root, "site");

const { chromium } = require("playwright");

const VIEWPORTS = [
  { w: 1920, h: 937, name: "1080p maximizado" },
  { w: 1536, h: 721, name: "1536x864 a 125%" },
  { w: 1440, h: 757, name: "MacBook 1440" },
  { w: 1366, h: 625, name: "notebook 14 pol" },
  { w: 1366, h: 560, name: "1366 janela baixa" },
  { w: 1280, h: 550, name: "1280 janela baixa" },
  { w: 1024, h: 640, name: "tablet paisagem" },
  { w: 820, h: 1180, name: "tablet retrato" },
  { w: 768, h: 1024, name: "tablet 768" },
  { w: 414, h: 896, name: "celular grande" },
  { w: 390, h: 844, name: "celular comum" },
  { w: 360, h: 740, name: "celular estreito" },
  { w: 320, h: 568, name: "celular minimo" },
];

const WEBGIS_WIDTHS = [320, 360, 390, 768, 800, 960, 1024, 1280];
const WEBGIS_HEIGHTS = [600, 720, 800, 900];
const WEBGIS_VIEWPORTS = WEBGIS_WIDTHS.flatMap((w) => WEBGIS_HEIGHTS.map((h) => ({ w, h, name: `${w}x${h}` })));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function serve() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const target = path.join(siteRoot, decodeURIComponent(url.pathname));
    if (!target.startsWith(siteRoot) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Controls that exist only once asked for. A chip that becomes unreachable the moment it
// appears is still unreachable, so the audit opens what it can before measuring.
async function reveal(page) {
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("[data-ui-toggle]")) {
      const target = document.getElementById(button.dataset.uiToggle);
      if (target && target.hidden) button.click();
    }
    for (const group of ["#ceuCamadas", "#ceuCurva"]) {
      for (const button of document.querySelectorAll(`${group} button`)) {
        if (button.getAttribute("aria-pressed") !== "true") button.click();
      }
    }
    for (const id of ["#heightSelector", "#windLayerToggle", "#accumSelector"]) {
      document.querySelector(id)?.classList.add("active");
    }
  });
  await page.waitForTimeout(700);
}

const SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([type=hidden]):not([disabled])",
  "select:not([disabled])",
  "[role='button']:not([aria-disabled='true'])",
].join(",");

function probeInPage(sel) {
  const MIN_TARGET = 24;
  const OVERLAP_TOLERANCE_PX = 1;
  const SCROLL_ALIGNMENTS = ["center", "start", "end"];
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyOverflowGoesToViewport = rootStyle.overflowX === "visible" && rootStyle.overflowY === "visible";
  const viewportOverflowOwner = bodyOverflowGoesToViewport ? document.body : document.documentElement;
  const viewportOverflow = getComputedStyle(viewportOverflowOwner).overflowY;
  const viewportScrolls = viewportOverflow !== "hidden" && viewportOverflow !== "clip";
  const results = [];

  const describe = (node) =>
    node ? `${node.tagName.toLowerCase()}.${(node.className || "").toString().split(" ")[0]}` : "nada";

  const transparent = (color) => color === "transparent" || /[,/]\s*0(\.0+)?\)$/.test(color);
  const painted = (node) => {
    if ([HTMLImageElement, HTMLVideoElement, HTMLCanvasElement].some((kind) => node instanceof kind)) return true;
    const style = getComputedStyle(node);
    return !transparent(style.backgroundColor) || style.backgroundImage !== "none";
  };
  const shown = (node) =>
    node.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !node.closest("[hidden]");
  const painters = [...document.body.querySelectorAll("*")].filter(painted);
  const inkWithin = (canvas, box, area) => {
    const context = canvas.getContext("2d");
    if (!context) return true;
    const scaleX = canvas.width / box.width;
    const scaleY = canvas.height / box.height;
    const { data } = context.getImageData(
      Math.floor((area.left - box.left) * scaleX),
      Math.floor((area.top - box.top) * scaleY),
      Math.max(1, Math.ceil((area.right - area.left) * scaleX)),
      Math.max(1, Math.ceil((area.bottom - area.top) * scaleY))
    );
    for (let alpha = 3; alpha < data.length; alpha += 4) if (data[alpha] > 0) return true;
    return false;
  };

  const paintedOver = (element, target, proxy) => {
    const own = (node) => element.contains(node) || Boolean(proxy?.contains(node));
    const width = document.documentElement.clientWidth;
    for (const painter of painters) {
      if (painter.contains(element) || own(painter)) continue;
      const box = painter.getBoundingClientRect();
      const left = Math.max(box.left, target.left, 0);
      const right = Math.min(box.right, target.right, width);
      const top = Math.max(box.top, target.top, 0);
      const bottom = Math.min(box.bottom, target.bottom, window.innerHeight);
      if (right - left < OVERLAP_TOLERANCE_PX || bottom - top < OVERLAP_TOLERANCE_PX || !shown(painter)) continue;
      if (painter instanceof HTMLCanvasElement && !inkWithin(painter, box, { left, right, top, bottom })) continue;
      const inlineStyle = painter.getAttribute("style");
      painter.style.setProperty("pointer-events", "auto", "important");
      const stack = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2);
      if (inlineStyle === null) painter.removeAttribute("style");
      else painter.setAttribute("style", inlineStyle);
      const painterDepth = stack.indexOf(painter);
      const ownDepth = stack.findIndex(own);
      if (painterDepth >= 0 && ownDepth >= 0 && painterDepth < ownDepth) return painter;
    }
    return null;
  };

  const clippingAncestors = (element) => {
    const clippers = [];
    for (let node = element.parentElement; node && node !== viewportOverflowOwner; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const scrollsByUser = [style.overflowX, style.overflowY].some((value) => value === "auto" || value === "scroll");
      clippers.push({ node, scrollsByUser });
    }
    return clippers;
  };

  const cornerInset = (element, box) => {
    const style = getComputedStyle(element);
    const shortSide = Math.min(box.width, box.height);
    const radius = Math.max(
      ...[
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomLeftRadius,
        style.borderBottomRightRadius,
      ].map((value) => (value.endsWith("%") ? (parseFloat(value) / 100) * shortSide : parseFloat(value) || 0))
    );
    return Math.max(2, Math.ceil(Math.min(radius, shortSide / 2) * (1 - Math.SQRT1_2)) + 1);
  };

  const locate = (element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return null;
    if (element.closest("[hidden]")) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const parkedAboveThePage = rect.bottom + window.scrollY <= 0;
    if (parkedAboveThePage) return null;

    // An inline link that wraps has one box per LINE, and the centre of the box enclosing
    // them falls in the gap between lines — on the paragraph, not on the link.
    const rects = element.getClientRects();
    const box = rects.length > 1 ? rects[0] : rect;

    // A visually-hidden input is driven by its label by design and is always "covered".
    const proxy = element.classList.contains("visually-hidden") ? element.closest("label") : null;
    const target = proxy ? proxy.getBoundingClientRect() : box;
    return { style, rect, proxy, target, shape: proxy || element };
  };

  const obstruction = (element, { target, proxy, shape }) => {
    const inset = cornerInset(shape, target);
    const width = document.documentElement.clientWidth;
    const points = [
      [target.x + target.width / 2, target.y + target.height / 2],
      [target.left + inset, target.top + inset],
      [target.right - inset, target.top + inset],
      [target.left + inset, target.bottom - inset],
      [target.right - inset, target.bottom - inset],
    ];
    const clippers = clippingAncestors(shape);
    for (const [rawX, y] of points) {
      const x = Math.min(Math.max(rawX, 1), width - 1);
      if (y < 0 || y >= window.innerHeight) return { pending: true };
      const clipper = clippers.find(({ node }) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const border = {
          left: parseFloat(style.borderLeftWidth),
          right: parseFloat(style.borderRightWidth),
          top: parseFloat(style.borderTopWidth),
          bottom: parseFloat(style.borderBottomWidth),
        };
        const verticalScrollbar = Math.max(
          0,
          node.offsetWidth - node.clientWidth - Math.round(border.left + border.right)
        );
        const horizontalScrollbar = Math.max(
          0,
          node.offsetHeight - node.clientHeight - Math.round(border.top + border.bottom)
        );
        return (
          x < box.left + border.left ||
          x > box.right - border.right - verticalScrollbar ||
          y < box.top + border.top ||
          y > box.bottom - border.bottom - horizontalScrollbar
        );
      });
      if (clipper) return { pending: true, clippedBy: describe(clipper.node) };
      const top = document.elementFromPoint(x, y);
      if (!top) return { pending: true };
      const owns = top === element || element.contains(top) || top.contains(element) || proxy?.contains(top);
      if (!owns) return { covered: describe(top) };
    }
    const painter = paintedOver(element, target, proxy);
    return painter ? { covered: `${describe(painter)}, pintado por cima` } : {};
  };

  const settle = (element, located) => {
    let verdict = obstruction(element, located);
    if (!verdict.pending) return verdict;
    const scrollers = clippingAncestors(element).map((clipper) => ({
      ...clipper,
      top: clipper.node.scrollTop,
      left: clipper.node.scrollLeft,
    }));
    const origin = { left: window.scrollX, top: window.scrollY };
    for (const block of SCROLL_ALIGNMENTS) {
      element.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
      const viewportForced = !viewportScrolls && (window.scrollX !== origin.left || window.scrollY !== origin.top);
      const clipperForced = scrollers.some(
        ({ node, scrollsByUser, top, left }) => !scrollsByUser && (node.scrollTop !== top || node.scrollLeft !== left)
      );
      const relocated = locate(element);
      if (viewportForced || clipperForced) verdict = { covered: "só alcançável por rolagem programática" };
      else verdict = relocated ? obstruction(element, relocated) : { covered: "sumiu ao rolar" };
      for (const { node, top, left } of scrollers) {
        node.scrollTop = top;
        node.scrollLeft = left;
      }
      window.scrollTo({ ...origin, behavior: "instant" });
      if (!verdict.pending && !verdict.covered) return verdict;
    }
    if (!verdict.pending) return verdict;
    return { covered: verdict.clippedBy ? `recortado por ${verdict.clippedBy}` : "fora do alcance da rolagem" };
  };

  for (const element of document.querySelectorAll(sel)) {
    const located = locate(element);
    if (!located) continue;
    const { style, rect, target } = located;

    // WCAG 2.2 exempts a link inside a sentence: it is sized by the text around it.
    const inlineLink = element.tagName === "A" && style.display.startsWith("inline");

    results.push({
      what: element.id
        ? `#${element.id}`
        : `${element.tagName.toLowerCase()}.${(element.className || "").toString().split(" ")[0]}`,
      label: (element.getAttribute("aria-label") || element.textContent || element.name || "").trim().slice(0, 34),
      size: `${Math.round(target.width)}x${Math.round(target.height)}`,
      small: !inlineLink && (target.width < MIN_TARGET || target.height < MIN_TARGET),
      offscreen: rect.right > document.documentElement.clientWidth + 1 || rect.left < -1,
      covered: settle(element, located).covered || null,
    });
  }
  return { controls: results, hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}

function probe(page) {
  return page.evaluate(probeInPage, SELECTOR);
}

const ACCEPT_MISSING_DATA_FLAG = "--sem-dados";
const acceptsMissingData = process.argv.slice(2).includes(ACCEPT_MISSING_DATA_FLAG);

const STATE_SETTLE_MS = 450;
const WIND_PAINT_TIMEOUT_MS = 10000;
const WIND_PAINT_POLL_MS = 200;
const WIND_VARIABLES = ["wind", "eolico"];
const PREVIEW_TIMEOUT_MS = 10000;
const CELL_TIMEOUT_MS = 8000;
const MAP_CLICK_FRACTIONS = [
  [0.5, 0.5],
  [0.35, 0.5],
  [0.5, 0.35],
  [0.35, 0.35],
  [0.5, 0.65],
];

async function openOverview(page) {
  await page.evaluate(() => {
    const toggle = document.getElementById("variableOverviewToggle");
    if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
  });
  const settled = await page
    .waitForFunction(
      () => !/Carregando/.test(document.getElementById("variablePreviewStats")?.textContent ?? ""),
      null,
      {
        timeout: PREVIEW_TIMEOUT_MS,
      }
    )
    .then(
      () => true,
      () => false
    );
  await page.waitForTimeout(STATE_SETTLE_MS);
  return settled && page.evaluate(() => !document.querySelector("#variablePreviewStats .variable-preview-empty"));
}

async function collapseOverview(page) {
  await page.evaluate(() => {
    const toggle = document.getElementById("variableOverviewToggle");
    if (toggle.getAttribute("aria-expanded") === "true") toggle.click();
  });
  await page.waitForTimeout(STATE_SETTLE_MS);
  return true;
}

async function openCell(page) {
  const point = await page.evaluate((fractions) => {
    const map = document.getElementById("map");
    const box = map.getBoundingClientRect();
    for (const [fx, fy] of fractions) {
      const x = box.left + box.width * fx;
      const y = box.top + box.height * fy;
      if (y <= 0 || y >= window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && map.contains(hit) && !hit.closest(".leaflet-control-container")) return { x, y };
    }
    return null;
  }, MAP_CLICK_FRACTIONS);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  const opened = await page
    .waitForFunction(() => document.getElementById("sidebar")?.classList.contains("active"), null, {
      timeout: CELL_TIMEOUT_MS,
    })
    .then(
      () => true,
      () => false
    );
  if (!opened) return false;
  await page.evaluate(() => {
    if (document.getElementById("timeSeriesModal")?.style.display === "flex") {
      document.getElementById("timeSeriesCloseBtn").click();
    }
  });
  await page.waitForTimeout(STATE_SETTLE_MS);
  return true;
}

async function openParameters(page) {
  const present = await page.evaluate(() => {
    const toggle = document.querySelector("#sidebar.active .parameters-toggle");
    const list = document.querySelector("#sidebar.active .parameters-list");
    if (!toggle || !list) return false;
    if (!list.classList.contains("active")) toggle.click();
    return true;
  });
  if (present) await page.waitForTimeout(STATE_SETTLE_MS);
  return present;
}

async function openMenu(page) {
  const present = await page.evaluate(() => {
    const toggler = document.querySelector("[data-navbar-toggle]");
    if (!toggler || getComputedStyle(toggler).display === "none") return false;
    if (toggler.getAttribute("aria-expanded") !== "true") toggler.click();
    return true;
  });
  if (present) await page.waitForTimeout(STATE_SETTLE_MS);
  return present;
}

async function openWind(page) {
  const windVariable = await page.evaluate((variables) => {
    const options = [...(document.getElementById("variableSelect")?.options ?? [])];
    const option = options.find(({ value }) => variables.includes(value));
    if (!option || !document.getElementById("windLayerCheckbox")) return null;
    if (document.getElementById("sidebar")?.classList.contains("active")) {
      document.getElementById("closeSidebarBtn").click();
    }
    return option.value;
  }, WIND_VARIABLES);
  if (!windVariable) return false;
  await page.waitForTimeout(STATE_SETTLE_MS);
  await page.evaluate((variable) => {
    const select = document.getElementById("variableSelect");
    const checkbox = document.getElementById("windLayerCheckbox");
    if (select.value !== variable) {
      select.value = variable;
      select.dispatchEvent(new Event("change"));
    }
    if (!checkbox.checked) checkbox.click();
  }, windVariable);
  const painted = await page
    .waitForFunction(
      () => {
        const canvas = document.getElementById("windVectorCanvas");
        if (!canvas?.width || !canvas.height) return false;
        const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
        for (let alpha = 3; alpha < data.length; alpha += 4) if (data[alpha] > 0) return true;
        return false;
      },
      null,
      { timeout: WIND_PAINT_TIMEOUT_MS, polling: WIND_PAINT_POLL_MS }
    )
    .then(
      () => true,
      () => false
    );
  if (painted) await page.waitForTimeout(STATE_SETTLE_MS);
  return painted;
}

const WEBGIS_STATES = [
  { name: "visão geral aberta", enter: openOverview, needsData: true },
  { name: "célula aberta", enter: openCell, needsData: true },
  { name: "parâmetros abertos", enter: openParameters },
  { name: "visão geral recolhida", enter: collapseOverview },
  { name: "menu aberto", enter: openMenu },
  { name: "vento ligado", enter: openWind, needsData: true },
];

const pages = fs
  .readdirSync(siteRoot)
  .filter((entry) => entry.endsWith(".html"))
  .sort();

if (!pages.length) {
  console.error("check-reachability: site/ não tem páginas construídas — rode `npm run build` antes.");
  process.exit(1);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  server.close();
  console.error("check-reachability: chromium não instalado — rode `npx playwright install chromium`.");
  console.error(String(error).slice(0, 160));
  process.exit(1);
}
const failures = [];
const unexercised = new Map();
let checked = 0;
let states = 0;

function record(name, viewport, state, result) {
  states += 1;
  checked += result.controls.length;
  if (result.hScroll > 1) failures.push([name, viewport.name, state, "rolagem horizontal", `+${result.hScroll}px`]);
  for (const control of result.controls) {
    const where = `${control.what} "${control.label}"`;
    if (control.covered) failures.push([name, viewport.name, state, "coberto", `${where} por ${control.covered}`]);
    if (control.offscreen) failures.push([name, viewport.name, state, "fora da tela", where]);
    if (control.small) failures.push([name, viewport.name, state, "alvo pequeno", `${where} ${control.size}`]);
  }
}

let measuredViewports = 0;
for (const name of pages) {
  const webgis = fs.readFileSync(path.join(siteRoot, name), "utf8").includes('id="variableOverviewToggle"');
  const viewports = webgis ? [...VIEWPORTS, ...WEBGIS_VIEWPORTS] : VIEWPORTS;
  measuredViewports += viewports.length;
  const page = await browser.newPage();
  page.on("pageerror", (error) => failures.push([name, "-", "-", "erro de página", String(error).slice(0, 90)]));
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.w, height: viewport.h });
    await page.goto(`${base}/${name}`, { waitUntil: "load" });
    await page.waitForTimeout(name.includes("mapas") || name.includes("potenciais") ? 3000 : 1500);
    await reveal(page);
    record(name, viewport, "inicial", await probe(page));
    if (!webgis) continue;
    for (const state of WEBGIS_STATES) {
      if (await state.enter(page)) {
        record(name, viewport, state.name, await probe(page));
      } else if (state.needsData) {
        unexercised.set(`${name} [${state.name}]`, (unexercised.get(`${name} [${state.name}]`) || 0) + 1);
      }
    }
  }
  await page.close();
  process.stdout.write(`${name} `);
}

await browser.close();
server.close();

console.log(
  `\n\ncheck-reachability: ${checked} controles em ${pages.length} páginas, ${measuredViewports} cargas de viewport, ${states} estados`
);
const missingDataFails = unexercised.size > 0 && !acceptsMissingData;
for (const [where, count] of unexercised) {
  const message = `não exercitado: ${where} em ${count} viewport(s): o estado não carregou (sem dados servidos em site/?)`;
  if (missingDataFails) console.error(`✗ ${message}`);
  else console.warn(`! ${message}`);
}
if (missingDataFails) {
  console.error(
    `    sirva os dados em site/ ou aceite a execução parcial com \`npm run check:reach -- ${ACCEPT_MISSING_DATA_FLAG}\``
  );
}
if (!failures.length && !missingDataFails) {
  console.log("✓ todos alcançáveis");
  process.exit(0);
}

const grouped = new Map();
for (const [page, viewport, state, kind, detail] of failures) {
  const key = `${kind}|${page}|${state}|${detail}`;
  if (!grouped.has(key)) grouped.set(key, { page, state, kind, detail, viewports: [] });
  grouped.get(key).viewports.push(viewport);
}
for (const { page, state, kind, detail, viewports } of grouped.values()) {
  console.error(`✗ ${kind}: ${page} [${state}] :: ${detail}`);
  console.error(
    `    em ${viewports.length} viewport(s): ${viewports.slice(0, 4).join(", ")}${viewports.length > 4 ? " …" : ""}`
  );
}
process.exit(1);
