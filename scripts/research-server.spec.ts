import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test as base } from "playwright/test";

const publicFiles = [
  "Monitoramento/monitoring.json",
  "Climatologia/manifest.json",
  "Climatologia/air_temperature.json",
  "Ceu/ktkd.json",
  "Ceu/ktkd_sample.json",
  "Ceu/kt_cumulative.json",
  "Ceu/timeline.json",
  "Ceu/frame.json",
  "Ceu/model.json",
  "Ceu/allsky.jpg",
  "Ceu/input.jpg",
  "Ceu/attribution.png",
] as const;

const blockedFiles = [
  "Ceu/backup.csv",
  "Ceu/ktkd_points.json",
  "Ceu/research/ktkd_points.json",
  "Ceu/research/ktkd.json",
  "Ceu/research/kt_cumulative.json",
  "Climatologia/research/manifest.json",
  "Climatologia/research/air_temperature.json",
  "Ceu/backup.json",
  "Ceu/ktkd.json.bak",
  "Ceu/.ktkd.json.tmp-1",
  "Monitoramento/archive.parquet",
] as const;

const wrfFiles = ["JSON/manifest.json", "JSON/D01_TEMP.series.bin", "GeoJSON/D01.grid.json"] as const;

function chartHeaders(origin: string): Record<string, string> {
  return {
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    Referer: `${origin}/ceu.html`,
  };
}

const test = base.extend<object, { readonly serverOrigin: string }>({
  serverOrigin: [
    async ({}, use): Promise<void> => {
      const directory = mkdtempSync(path.join(tmpdir(), "labmim-apache-test-"));
      const container = path.basename(directory).toLowerCase();
      const docker = (args: readonly string[]): string =>
        execFileSync("docker", [...args], { encoding: "utf8" }).trim();
      try {
        const root = path.join(directory, "htdocs");
        for (const file of [...publicFiles, ...blockedFiles, ...wrfFiles]) {
          const target = path.join(root, file);
          mkdirSync(path.dirname(target), { recursive: true });
          writeFileSync(target, "synthetic fixture");
        }
        writeFileSync(path.join(root, "index.html"), "local fixture");
        writeFileSync(
          path.join(root, ".htaccess"),
          readFileSync(path.resolve(process.env.SITE_TEST_ROOT ?? "site", ".htaccess"))
        );
        const config = docker(["run", "--rm", "httpd:2.4", "cat", "/usr/local/apache2/conf/httpd.conf"])
          .replace("#LoadModule rewrite_module", "LoadModule rewrite_module")
          .replaceAll("AllowOverride None", "AllowOverride FileInfo Options=Indexes,MultiViews");
        writeFileSync(path.join(directory, "httpd.conf"), `${config}\nServerName localhost\n`);
        docker([
          "run",
          "-d",
          "--rm",
          "--name",
          container,
          "-p",
          "127.0.0.1::80",
          "-v",
          `${root}:/usr/local/apache2/htdocs:ro`,
          "-v",
          `${directory}/httpd.conf:/usr/local/apache2/conf/httpd.conf:ro`,
          "httpd:2.4",
        ]);
        const address = docker(["port", container, "80"]);
        if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error("Apache precisa escutar somente em localhost");
        await use(`http://${address}`);
      } finally {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
        rmSync(directory, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
});

for (const file of blockedFiles) {
  test(`servidor bloqueia arquivo fora da lista pública: ${file}`, async ({ request, serverOrigin }) => {
    const response = await request.get(`${serverOrigin}/${file}?research=1`, { headers: chartHeaders(serverOrigin) });
    expect(response.status()).toBe(403);
  });
}

for (const directory of ["Ceu", "Monitoramento", "Climatologia", "JSON", "GeoJSON"]) {
  test(`servidor não lista o diretório ${directory}`, async ({ request, serverOrigin }) => {
    const response = await request.get(`${serverOrigin}/${directory}/`);
    expect(response.status()).toBe(403);
  });
}

for (const headers of [
  { "Sec-Fetch-Site": "cross-site" },
  { "Sec-Fetch-Site": "same-site" },
  { "Sec-Fetch-Site": "" },
  { "Sec-Fetch-Mode": "navigate" },
  { "Sec-Fetch-Dest": "document" },
  { Referer: "" },
  { Referer: "https://unrelated.test/ceu.html" },
  { Referer: "http://127.0.0.1/ceu.html" },
  { Referer: "https://unrelated.test/?origin=research.test/ceu.html" },
  { Range: "bytes=0-8" },
]) {
  test(`servidor recusa pesquisa com ${JSON.stringify(headers)}`, async ({ request, serverOrigin }) => {
    const response = await request.get(`${serverOrigin}/Ceu/ktkd.json`, {
      headers: { ...chartHeaders(serverOrigin), ...headers },
    });
    expect(response.status()).toBe(403);
  });
}

test("requisições dos gráficos continuam funcionando sem cache público", async ({ request, serverOrigin }) => {
  for (const file of publicFiles) {
    const response = await request.get(`${serverOrigin}/${file}?v=fixture`, {
      headers: chartHeaders(serverOrigin),
    });
    expect(response.status(), file).toBe(200);
    expect(response.headers()["cache-control"], file).toBe("no-store");
  }
});

test("servidor recusa cliente sem cabeçalhos de navegação", async ({ request, serverOrigin }) => {
  const response = await request.get(`${serverOrigin}/Monitoramento/monitoring.json`);
  expect(response.status()).toBe(403);
});

test("WRF mantém consultas parciais de séries binárias", async ({ request, serverOrigin }) => {
  const response = await request.get(`${serverOrigin}/JSON/D01_TEMP.series.bin`, { headers: { Range: "bytes=0-8" } });
  expect(response.status()).toBe(206);
});
