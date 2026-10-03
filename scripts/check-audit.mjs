#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = "scripts/audit-allowlist.json";
const blockingSeverities = new Set(["high", "critical"]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function fail(header, entries, hint) {
  console.error(header);
  for (const entry of entries) console.error(`  - ${entry}`);
  console.error(`\n${hint}`);
  process.exit(1);
}

function readAllowlist() {
  const entries = JSON.parse(readFileSync(join(root, allowlistPath), "utf8"));
  const malformed = entries.filter(
    (entry) => !entry.advisory || !entry.package || !entry.reason || !isoDate.test(entry.reviewBy ?? "")
  );
  if (malformed.length > 0) {
    fail(
      `✗ Entrada de ${allowlistPath} incompleta`,
      malformed.map((entry) => JSON.stringify(entry)),
      "Toda entrada precisa de advisory (GHSA), package, reason e reviewBy no formato AAAA-MM-DD."
    );
  }
  return entries;
}

function runAudit() {
  const result = spawnSync("npm", ["audit", "--json"], { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  const report = JSON.parse(result.stdout);
  if (report.error || !report.vulnerabilities) {
    fail("✗ npm audit não produziu relatório", [JSON.stringify(report.error ?? report)], "Rode npm audit à mão.");
  }
  return report;
}

function blockingAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via) {
      if (typeof via === "object" && blockingSeverities.has(via.severity)) {
        advisories.set(via.url.split("/").pop(), via);
      }
    }
  }
  return advisories;
}

const describe = (via) => `${via.name} ${via.range} (${via.severity}): ${via.title} — ${via.url}`;

const allowlist = readAllowlist();
const advisories = blockingAdvisories(runAudit());
const today = new Date().toISOString().slice(0, 10);
const isTolerated = (id, via) => allowlist.some((entry) => entry.advisory === id && entry.package === via.name);

const unlisted = [...advisories].filter(([id, via]) => !isTolerated(id, via)).map(([, via]) => describe(via));
if (unlisted.length > 0) {
  fail(
    "✗ npm audit encontrou vulnerabilidade high ou critical",
    unlisted,
    `Atualize a dependência (npm audit fix). Só quando não houver versão corrigida, registre o advisory em ${allowlistPath} com o motivo e uma data de revisão.`
  );
}

const expired = allowlist.filter((entry) => entry.reviewBy < today);
if (expired.length > 0) {
  fail(
    `✗ Entrada de ${allowlistPath} passou da data de revisão`,
    expired.map((entry) => `${entry.package} ${entry.advisory}: revisar até ${entry.reviewBy}`),
    "Veja se já saiu versão corrigida (npm audit fix). Se não saiu, reavalie o motivo e adie a data."
  );
}

const stale = allowlist.filter((entry) => !advisories.has(entry.advisory));
if (stale.length > 0) {
  fail(
    `✗ Entrada de ${allowlistPath} não corresponde mais a nenhum advisory`,
    stale.map((entry) => `${entry.package} ${entry.advisory}`),
    "Remova a entrada: o advisory foi corrigido ou retirado."
  );
}

console.log(
  `✓ npm audit sem vulnerabilidade high ou critical fora de ${allowlistPath}` +
    (allowlist.length > 0
      ? ` (toleradas: ${allowlist.map((entry) => `${entry.package} ${entry.advisory} até ${entry.reviewBy}`).join(", ")})`
      : "")
);
