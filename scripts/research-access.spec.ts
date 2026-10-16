import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "playwright/test";

const siteRoot = path.resolve(process.env.SITE_TEST_ROOT ?? "site");
const origin = "http://research.test";
const observed = { n: 3, counts: [1, 2], density: [0.33333, 0.66667], stats: {}, below: 0, above: 0 };
const model = { n: 3, counts: [2, 1], density: [0.66667, 0.33333], stats: {}, below: 0, above: 0 };
const fixtures = {
  "/Monitoramento/monitoring.json": {
    format: "labmim-monitoring-v1",
    version: "fixture",
    window: { start: "2026-01-01T00:00:00", end: "2026-01-02T00:00:00" },
    charts: [
      {
        id: "temperatura",
        title: "Temperatura artificial",
        unit: "°C",
        kind: "line",
        series: [{ id: "t", label: "Temperatura", hue: "net", direction: "down" }],
        layers: {
          raw: {
            axis: { start: "2026-01-01T12:00:00", step_minutes: 5, count: 3 },
            series: { t: [22, 24, 23] },
          },
          hourly: null,
          wrf: null,
        },
        caveats: [],
      },
    ],
  },
  "/Climatologia/manifest.json": {
    version: "fixture",
    selector: ["observed_all", "wrf_all"],
    subsets: [
      { id: "observed_all", source: "station", label: "Observações" },
      { id: "wrf_all", source: "wrf", label: "WRF" },
    ],
    variables: [{ id: "air_temperature", label: "Temperatura artificial", file: "air_temperature.json" }],
  },
  "/Climatologia/air_temperature.json": {
    id: "air_temperature",
    label: "Temperatura artificial",
    unit: "°C",
    chart: "histogram",
    edges: [20, 21, 22],
    subsets: { observed_all: observed, wrf_all: model },
  },
  "/Ceu/ktkd.json": {
    schema: "labmim-ktkd-v1",
    version: "fixture",
    points: [
      [0.2, 0.8, "2026-01-01T12:00:00"],
      [0.6, 0.4, "2026-01-01T13:00:00"],
    ],
    points_format: ["kt", "kd", "t"],
    models: [],
    caveats: [],
  },
} satisfies Record<string, unknown>;

async function openPage(page: Page, name: string): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const fixture = (fixtures as Readonly<Record<string, unknown>>)[url.pathname];
    if (fixture) return route.fulfill({ json: fixture });
    if (/^\/(Monitoramento|Climatologia|Ceu)\//.test(url.pathname)) return route.fulfill({ status: 404 });
    const file = path.resolve(siteRoot, `.${url.pathname}`);
    if (!file.startsWith(`${siteRoot}${path.sep}`)) return route.abort();
    await route.fulfill({ path: file });
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(`${origin}/${name}`);
}

test("monitoramento mantém ampliação e desabilita CSV mesmo após trocar o período", async ({ page }) => {
  await openPage(page, "monitoring.html");
  const card = page.locator("#monitor-card-temperatura");
  await expect(card.locator("canvas")).toBeVisible();
  await expect(card.getByRole("button", { name: /CSV/ })).toBeDisabled();
  await page.getByRole("button", { name: "24 horas", exact: true }).click();
  await expect(card.getByRole("button", { name: /CSV/ })).toBeDisabled();
  await card.getByRole("button", { name: /Ampliar/ }).click();
  await expect(page.locator("dialog canvas")).toBeVisible();
});

test("Kt × Kd mantém os pontos interativos sem habilitar CSV", async ({ page }) => {
  await openPage(page, "ceu.html");
  await expect(page.locator("#ceuAmpliar")).toBeEnabled();
  await expect(page.locator("#ceuExport")).toBeDisabled();
  const points = page.locator("#ceuCamadas").getByRole("button", { name: "Pontos", exact: true });
  await points.click();
  await points.click();
  await expect(page.locator("#ceuExport")).toBeDisabled();
  await page.locator("#ceuAmpliar").click();
  await expect(page.locator("dialog canvas")).toBeVisible();
});

test("climatologia permite CSV somente do recorte WRF", async ({ page }) => {
  await openPage(page, "climatologia.html");
  await expect(page.locator("#climaTitulo")).toContainText("Observações");
  await expect(page.locator("#climaExport")).toBeDisabled();
  await page.getByRole("button", { name: "WRF", exact: true }).click();
  await expect(page.locator("#climaExport")).toBeEnabled();
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#climaExport").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("climatologia_air_temperature_wrf_all.csv");
  const downloaded = await download.path();
  if (!downloaded) throw new Error("CSV não foi gravado");
  expect(await readFile(downloaded, "utf8")).toContain("20 – 21;2;0,66667");
  await page.getByRole("button", { name: "Observações", exact: true }).click();
  await expect(page.locator("#climaExport")).toBeDisabled();
});

test("reativar o botão na página não exporta observações da climatologia", async ({ page }) => {
  await openPage(page, "climatologia.html");
  await expect(page.locator("#climaTitulo")).toContainText("Observações");
  await page.evaluate(() => {
    URL.createObjectURL = (): string => {
      throw new Error("Exportação de observações foi acionada");
    };
    const button = document.querySelector<HTMLButtonElement>("#climaExport");
    if (!button) throw new Error("Botão CSV ausente");
    button.disabled = false;
    button.click();
  });
});
