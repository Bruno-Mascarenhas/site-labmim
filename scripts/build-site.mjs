#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  // Morte por sinal não é falha de configuração, e quem orquestra decide pelo sinal:
  // build-all.mjs e check-publications.mjs distinguem "was terminated by" de "failed",
  // e o restore de site-builder/cli.js só repete a tentativa quando o build anterior
  // morreu por sinal. Traduzir sinal para `exit 1` apagava essa diferença — este é o
  // processo que todos eles de fato spawnam. Repropagar devolve o sinal ao pai.
  if (result.signal) {
    process.kill(process.pid, result.signal);
    // Sinal ignorado pela disposição atual (SIGPIPE, por exemplo): o kill acima
    // retorna e a execução seguiria para o passo do Prettier sobre uma saída pela
    // metade. Sair com 128+n mantém pelo menos o sinal legível no código de saída.
    process.exit(128 + (constants.signals[result.signal] ?? 0));
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, [path.join(root, "build.js"), ...process.argv.slice(2)]);

const prettier = path.join(root, "node_modules", "prettier", "bin", "prettier.cjs");
if (!fs.existsSync(prettier)) {
  throw new Error("Prettier is not installed. Run npm install before npm run build.");
}
run(process.execPath, [prettier, "--write", "site/**/*.html"]);
