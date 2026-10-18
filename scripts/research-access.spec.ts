import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "playwright/test";

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
    period: { n: 40 },
    density: {
      kt_edges: [0, 0.5, 1],
      kd_edges: [0, 0.5, 1],
      counts: [
        [0, 20],
        [20, 0],
      ],
      max_count: 20,
      n_outside: 0,
    },
    points_file: { name: "ktkd_sample.json", n: 2, population_n: 40, sampling: "stable-hash-v1" },
    models: [],
    caveats: [],
  },
  "/Ceu/ktkd_sample.json": {
    schema: "labmim-ktkd-sample-v1",
    version: "fixture",
    population_n: 40,
    sampling: "stable-hash-v1",
    points_format: ["kt", "kd", "condition"],
    points: [
      [0.2, 0.8, 1],
      [0.6, 0.4, 3],
    ],
  },
} satisfies Record<string, unknown>;

const researchFixtures = {
  "/Ceu/research/ktkd.json": {
    ...fixtures["/Ceu/ktkd.json"],
    points_file: { name: "ktkd_points.json", n: 40, population_n: 40, sampling: "complete" },
  },
  "/Ceu/research/ktkd_points.json": {
    schema: "labmim-ktkd-research-v1",
    version: "fixture",
    population_n: 40,
    sampling: "complete",
    points_format: ["kt", "kd", "t", "condition"],
    points: Array.from({ length: 40 }, (_, index) => [
      0.2 + index * 0.001,
      0.8 - index * 0.001,
      new Date(Date.UTC(2026, 0, 1, index)).toISOString().replace(".000Z", ""),
      1,
    ]),
  },
  "/Climatologia/research/manifest.json": {
    ...fixtures["/Climatologia/manifest.json"],
    selector: ["observed_all", "wrf_all", "wrf_djf"],
    subsets: [
      ...fixtures["/Climatologia/manifest.json"].subsets,
      { id: "wrf_djf", source: "wrf", label: "WRF — verão" },
    ],
  },
  "/Climatologia/research/air_temperature.json": {
    ...fixtures["/Climatologia/air_temperature.json"],
    subsets: { observed_all: observed, wrf_all: model, wrf_djf: model },
  },
} satisfies Record<string, unknown>;

async function openPage(
  page: Page,
  name: string,
  overrides: Readonly<Record<string, unknown>> = {},
  pageOrigin: string = origin
): Promise<readonly string[]> {
  const pageFixtures: Readonly<Record<string, unknown>> = { ...fixtures, ...overrides };
  const requested: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requested.push(url.pathname);
    if (url.origin !== pageOrigin) return route.abort();
    const fixture = pageFixtures[url.pathname];
    if (fixture) return route.fulfill({ json: fixture });
    if (/^\/(Monitoramento|Climatologia|Ceu)\//.test(url.pathname)) return route.fulfill({ status: 404 });
    const file = path.resolve(siteRoot, `.${url.pathname}`);
    if (!file.startsWith(`${siteRoot}${path.sep}`)) return route.abort();
    await route.fulfill({ path: file });
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(`${pageOrigin}/${name}`);
  return requested;
}

function samplePoints(page: Page): Locator {
  return page.getByRole("button", { name: "Pontos (amostra)", exact: true });
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

test("Kt × Kd mantém a amostra interativa sem habilitar CSV", async ({ page }) => {
  await openPage(page, "ceu.html");
  await expect(page.locator("#ceuAmpliar")).toBeEnabled();
  await expect(page.locator("#ceuExport")).toBeDisabled();
  await samplePoints(page).click();
  await samplePoints(page).click();
  await expect(page.locator("#ceuExport")).toBeDisabled();
  await page.locator("#ceuAmpliar").click();
  await expect(page.locator("dialog canvas")).toBeVisible();
});

test("Kt × Kd distingue o tamanho da amostra do registro completo", async ({ page }) => {
  await openPage(page, "ceu.html");

  await expect(page.locator("#ceuPontosNota")).toContainText("amostra de 2 das 40 horas");
});

test("Kt × Kd aceita cinco mil pontos quando representam um quarto do registro", async ({ page }) => {
  await openPage(page, "ceu.html", {
    "/Ceu/ktkd.json": {
      ...fixtures["/Ceu/ktkd.json"],
      period: { n: 20000 },
      points_file: { name: "ktkd_sample.json", n: 5000, population_n: 20000, sampling: "stable-hash-v1" },
    },
    "/Ceu/ktkd_sample.json": {
      ...fixtures["/Ceu/ktkd_sample.json"],
      population_n: 20000,
      points: Array.from({ length: 5000 }, () => [0.2, 0.8, 1]),
    },
  });

  await samplePoints(page).click();

  await expect(page.locator("#ceuStatus")).toContainText("A linha horizontal marca Kd = 0,5");
  await expect(page.locator("#ceuPontosNota")).toContainText("amostra de 5.000 das 20.000 horas");
});

for (const { title, population, pointsFile } of [
  {
    title: "recusa amostras acima de cinco mil pontos",
    population: 24000,
    pointsFile: { name: "ktkd_sample.json", n: 5001, population_n: 24000, sampling: "stable-hash-v1" },
  },
  {
    title: "recusa amostras acima de um quarto do registro",
    population: 40,
    pointsFile: { name: "ktkd_sample.json", n: 11, population_n: 40, sampling: "stable-hash-v1" },
  },
  {
    title: "mantém a densidade sem buscar o antigo arquivo completo",
    population: 40,
    pointsFile: { name: "ktkd_points.json", n: 40 },
  },
]) {
  test(`Kt × Kd ${title}`, async ({ page }) => {
    const requested = await openPage(page, "ceu.html", {
      "/Ceu/ktkd.json": { ...fixtures["/Ceu/ktkd.json"], period: { n: population }, points_file: pointsFile },
    });

    await expect(page.locator("#ceuAmpliar")).toBeEnabled();
    await expect(samplePoints(page)).toHaveCount(0);
    expect(requested).not.toContain(`/Ceu/${pointsFile.name}`);
  });
}

test("Kt × Kd carrega somente a amostra ao ativar os pontos", async ({ page }) => {
  await openPage(page, "ceu.html");
  const response = page.waitForResponse(`${origin}/Ceu/ktkd_sample.json`);

  await samplePoints(page).click();

  expect((await response).ok()).toBe(true);
});

test("Kt × Kd rejeita uma amostra de outra versão preservando a densidade", async ({ page }) => {
  await openPage(page, "ceu.html", {
    "/Ceu/ktkd_sample.json": { ...fixtures["/Ceu/ktkd_sample.json"], version: "previous" },
  });

  await samplePoints(page).click();

  await expect(page.locator("#ceuStatus")).toContainText("outra versão");
  await expect(page.locator("#ceuAmpliar")).toBeEnabled();
});

test("Kt × Kd rejeita observações com datas dentro da amostra pública", async ({ page }) => {
  await openPage(page, "ceu.html", {
    "/Ceu/ktkd_sample.json": {
      ...fixtures["/Ceu/ktkd_sample.json"],
      points_format: ["kt", "kd", "t", "condition"],
      points: [
        [0.2, 0.8, "2026-01-01T12:00:00", 1],
        [0.6, 0.4, "2026-01-01T13:00:00", 3],
      ],
    },
  });

  await samplePoints(page).click();

  await expect(page.locator("#ceuStatus")).toContainText("não contém pontos compatíveis");
});

test("pesquisa local desenha todos os pontos sem acionar a amostra pública", async ({ page }) => {
  const requested = await openPage(page, "ceu.html?research=1", researchFixtures, "http://127.0.0.1");

  await expect(page.locator("#ceuCanvas")).toBeVisible();
  await expect(page.locator("#ceuPontosNota")).toContainText("todas as 40 horas");
  await expect(page.getByRole("button", { name: "Pontos (completos)", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.locator("#ceuAmpliar")).toBeEnabled();
  expect(requested).toContain("/Ceu/research/ktkd_points.json");
  expect(requested).not.toContain("/Ceu/ktkd_sample.json");
});

test("pesquisa local não substitui dados completos ausentes pela amostra", async ({ page }) => {
  await openPage(
    page,
    "ceu.html?research=1",
    { ...researchFixtures, "/Ceu/research/ktkd_points.json": null },
    "http://127.0.0.1"
  );

  await expect(page.locator("#ceuStatus")).toContainText("não pôde ser baixado");
  await expect(samplePoints(page)).toHaveCount(0);
});

test("parâmetro de pesquisa no site remoto mantém a visualização pública", async ({ page }) => {
  const requested = await openPage(page, "ceu.html?research=1", researchFixtures);

  await expect(page.locator("#ceuPontosNota")).toContainText("amostra de 2 das 40 horas");
  expect(requested.some((pathname) => pathname.includes("/research/"))).toBe(false);
});

test("climatologia local oferece os recortes sazonais completos", async ({ page }) => {
  await openPage(page, "climatologia.html?research=1", researchFixtures, "http://127.0.0.1");

  await page.getByRole("button", { name: "WRF — verão", exact: true }).click();

  await expect(page.locator("#climaTitulo")).toContainText("WRF — verão");
  await expect(page.locator("#climaPeriodo")).toContainText("Pesquisa local: todos os recortes");
});

test("parâmetro de pesquisa não abre os recortes privados na climatologia remota", async ({ page }) => {
  await openPage(page, "climatologia.html?research=1", researchFixtures);

  await expect(page.locator("#climaTitulo")).toContainText("Observações");
  await expect(page.getByRole("button", { name: "WRF — verão", exact: true })).toHaveCount(0);
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
