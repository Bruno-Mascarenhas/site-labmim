"use strict";

const { spawnSync } = require("node:child_process");

/**
 * The signal-safe scaffolding the publication orchestrators share
 * (build-all.mjs, check-publications.mjs, check-links.mjs). Each switches site/
 * between publications and must put it back on the default afterwards — including
 * on Ctrl-C — and each classifies a configuration failure the same way. The
 * per-script specifics (check-links's siteHolds skip, build-all's dist rebuild and
 * drift check) stay in those scripts; only the identical mechanics live here.
 */

/** A failure raised on purpose by the build (plain Error, no `code`), not a crashing bug. */
function isExpectedFailure(error) {
  return error instanceof Error && error.constructor === Error && error.code === undefined;
}

/** Print an expected failure cleanly and exit 1; re-throw an unexpected one with its stack. */
function finishWithFailure(failure, label) {
  if (!isExpectedFailure(failure)) throw failure;
  console.error(`✗ ${label}: ${failure.message}`);
  process.exit(1);
}

/**
 * A restore() that rebuilds site/ for the default publication, retrying once: a
 * Ctrl-C reaches the whole process group, so the first attempt is often killed
 * along with the build it replaces, while a build spawned afterwards is not.
 */
function makeRestore({ execPath, buildScript, defaultId, label, cwd }) {
  return function restore() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync(execPath, [buildScript, `--site=${defaultId}`], { cwd, stdio: "inherit" });
      if (!result.error && result.status === 0) return true;
      if (!result.signal) break;
    }
    console.error(`${label}: could not restore site/; run: npm run build -- --site=${defaultId}`);
    return false;
  };
}

/**
 * Keep the process alive on SIGINT/SIGTERM so the caller's finally can restore
 * site/. Without a handler the default disposition kills the process outright,
 * leaving site/ on whichever publication was mid-build. The handler only runs when
 * the signal lands while no child is blocking the event loop; a second signal exits
 * immediately.
 */
function installSignalRestore(restore, { label, defaultId }) {
  let interrupted = false;
  const onSignal = (signal) => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.error(`\n${label}: ${signal} received; restoring site/ to ${defaultId}`);
    restore();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => onSignal(signal));
}

module.exports = { isExpectedFailure, finishWithFailure, makeRestore, installSignalRestore };
