#!/usr/bin/env node

/**
 * Regenera assets/vendor/bootstrap/bootstrap.purged.min.css.
 *
 * Existe como script porque o comando manual equivalente é destrutivo: o
 * PurgeCSS nomeia a saída com o basename da entrada, então apontar --output
 * para o diretório do vendor sobrescreve o próprio bootstrap.min.css completo
 * que serve de fonte. Aqui a saída vai para um diretório temporário e só o
 * arquivo purgado é movido para o lugar.
 *
 * Roda build:all antes: o arquivo purgado é UM só, compartilhado por todas as
 * publicações, mas site/ contém uma publicação por vez. O corpus analisado
 * inclui dist/<id>/*.html justamente para não remover classes usadas apenas
 * por outra publicação.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(root, "site", "assets", "vendor", "bootstrap");
const source = path.join(vendorDir, "bootstrap.min.css");
const target = path.join(vendorDir, "bootstrap.purged.min.css");

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} failed`);
}

function main() {
  if (!fs.existsSync(source)) {
    throw new Error(`missing vendored source: ${path.relative(root, source)}`);
  }

  console.log("purge-bootstrap: building every publication so the corpus covers all of them");
  run(process.execPath, [path.join(root, "scripts", "build-all.mjs")], "build:all");

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "purge-bootstrap-"));
  try {
    const cli = path.join(root, "node_modules", "purgecss", "bin", "purgecss.js");
    run(
      process.execPath,
      [cli, "--config", path.join(root, "scripts", "purgecss.config.cjs"), "--output", scratch],
      "purgecss"
    );

    const produced = path.join(scratch, path.basename(source));
    if (!fs.existsSync(produced)) {
      throw new Error(`purgecss did not write ${path.basename(source)} into ${scratch}`);
    }

    const before = fs.existsSync(target) ? fs.statSync(target).size : 0;
    fs.copyFileSync(produced, target);
    const after = fs.statSync(target).size;
    const full = fs.statSync(source).size;

    console.log(
      `purge-bootstrap: wrote ${path.relative(root, target)} ` +
        `(${after} bytes, was ${before}; full bundle is ${full} bytes)`
    );
    console.log("purge-bootstrap: run `npm run lint:purge` and commit site/ — the ?v= hash changed for every page.");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`✗ purge-bootstrap: ${error.message}`);
  process.exit(1);
}
