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
  const results = [];
  for (const element of document.querySelectorAll(sel)) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    if (element.closest("[hidden]")) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    // An inline link that wraps has one box per LINE, and the centre of the box enclosing
    // them falls in the gap between lines — on the paragraph, not on the link.
    const rects = element.getClientRects();
    const box = rects.length > 1 ? rects[0] : rect;

    // A visually-hidden input is driven by its label by design and is always "covered".
    const proxy = element.classList.contains("visually-hidden") ? element.closest("label") : null;
    const target = proxy ? proxy.getBoundingClientRect() : box;

    // WCAG 2.2 exempts a link inside a sentence: it is sized by the text around it.
    const inlineLink = element.tagName === "A" && style.display.startsWith("inline");

    const x = Math.min(Math.max(target.x + target.width / 2, 1), document.documentElement.clientWidth - 1);
    const y = target.y + target.height / 2;
    let covered = null;
    if (y >= 0 && y <= window.innerHeight) {
      const top = document.elementFromPoint(x, y);
      const owns = top && (top === element || element.contains(top) || top.contains(element) || proxy?.contains(top));
      if (top && !owns) covered = `${top.tagName.toLowerCase()}.${(top.className || "").toString().split(" ")[0]}`;
    } else {
      covered = "PENDENTE";
    }

    results.push({
      what: element.id
        ? `#${element.id}`
        : `${element.tagName.toLowerCase()}.${(element.className || "").toString().split(" ")[0]}`,
      label: (element.getAttribute("aria-label") || element.textContent || element.name || "").trim().slice(0, 34),
      size: `${Math.round(target.width)}x${Math.round(target.height)}`,
      small: !inlineLink && (target.width < MIN_TARGET || target.height < MIN_TARGET),
      offscreen: rect.right > document.documentElement.clientWidth + 1 || rect.left < -1,
      covered,
      top: Math.round(rect.y + window.scrollY),
    });
  }
  return { controls: results, hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}

// Anything below the fold reports PENDENTE, so each band is scrolled into view and
// measured where the control actually sits.
async function probe(page) {
  const first = await page.evaluate(probeInPage, SELECTOR);
  const pending = first.controls.filter((control) => control.covered === "PENDENTE");
  if (!pending.length) return first;
  const resolved = new Map();
  const bands = [...new Set(pending.map((control) => Math.floor(control.top / 400) * 400))].sort((a, b) => a - b);
  for (const band of bands) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, band - 100));
    await page.waitForTimeout(160);
    const pass = await page.evaluate(probeInPage, SELECTOR);
    for (const control of pass.controls) {
      if (control.covered !== "PENDENTE") resolved.set(`${control.what}|${control.label}|${control.top}`, control);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return {
    ...first,
    controls: first.controls.map((c) => resolved.get(`${c.what}|${c.label}|${c.top}`) || c),
  };
}

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
let checked = 0;

for (const name of pages) {
  const page = await browser.newPage();
  page.on("pageerror", (error) => failures.push([name, "-", "erro de página", String(error).slice(0, 90)]));
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.w, height: viewport.h });
    await page.goto(`${base}/${name}`, { waitUntil: "load" });
    await page.waitForTimeout(name.includes("mapas") || name.includes("potenciais") ? 3000 : 1500);
    await reveal(page);
    const result = await probe(page);
    checked += result.controls.length;
    if (result.hScroll > 1) failures.push([name, viewport.name, "rolagem horizontal", `+${result.hScroll}px`]);
    for (const control of result.controls) {
      const where = `${control.what} "${control.label}"`;
      if (control.covered && control.covered !== "PENDENTE") {
        failures.push([name, viewport.name, "coberto", `${where} por ${control.covered}`]);
      }
      if (control.offscreen) failures.push([name, viewport.name, "fora da tela", where]);
      if (control.small) failures.push([name, viewport.name, "alvo pequeno", `${where} ${control.size}`]);
    }
  }
  await page.close();
  process.stdout.write(`${name} `);
}

await browser.close();
server.close();

console.log(`\n\ncheck-reachability: ${checked} controles em ${pages.length} páginas x ${VIEWPORTS.length} viewports`);
if (!failures.length) {
  console.log("✓ todos alcançáveis");
  process.exit(0);
}

const grouped = new Map();
for (const [page, viewport, kind, detail] of failures) {
  const key = `${kind}|${page}|${detail}`;
  if (!grouped.has(key)) grouped.set(key, { page, kind, detail, viewports: [] });
  grouped.get(key).viewports.push(viewport);
}
for (const { page, kind, detail, viewports } of grouped.values()) {
  console.error(`✗ ${kind}: ${page} :: ${detail}`);
  console.error(
    `    em ${viewports.length} viewport(s): ${viewports.slice(0, 4).join(", ")}${viewports.length > 4 ? " …" : ""}`
  );
}
process.exit(1);
