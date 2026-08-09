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
  // Death by signal is not a configuration failure, and the orchestrators branch on
  // the difference: build-all.mjs and check-publications.mjs tell "was terminated by"
  // apart from "failed", and the restore in site-builder/cli.js retries only when the
  // previous build died from a signal. This is the process they all actually spawn, so
  // it re-raises the signal to the parent rather than collapsing it into `exit 1`.
  if (result.signal) {
    process.kill(process.pid, result.signal);
    // Signal ignored by the current disposition (SIGPIPE, say): the kill above returns
    // and execution would fall through to the Prettier step over half-written output.
    // Exiting with 128+n at least keeps the signal readable in the exit code.
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
