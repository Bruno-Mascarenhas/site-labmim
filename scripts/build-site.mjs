#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, [path.join(root, "build.js"), ...process.argv.slice(2)]);

const prettier = path.join(root, "node_modules", "prettier", "bin", "prettier.cjs");
if (!fs.existsSync(prettier)) {
  throw new Error("Prettier is not installed. Run npm install before npm run build.");
}
run(process.execPath, [prettier, "--write", "site/**/*.html"]);
