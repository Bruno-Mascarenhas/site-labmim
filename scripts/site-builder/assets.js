"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HASHED_VENDOR_ASSETS = new Set(["assets/vendor/bootstrap/bootstrap.purged.min.css"]);

function writePublicationTheme(publication, outputDir) {
  const source = path.join(publication.directory, publication.theme);
  const destination = path.join(outputDir, "assets", "css", "site-theme.css");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return "assets/css/site-theme.css";
}

function createAssetPipeline(outputDir) {
  const cache = new Map();

  function assetHash(relativePath) {
    if (!cache.has(relativePath)) {
      const content = fs.readFileSync(path.join(outputDir, relativePath));
      cache.set(relativePath, crypto.createHash("md5").update(content).digest("hex").slice(0, 8));
    }
    return cache.get(relativePath);
  }

  function workerHashes() {
    const workersDir = path.join(outputDir, "assets", "js", "workers");
    if (!fs.existsSync(workersDir)) return "";
    return fs
      .readdirSync(workersDir)
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map((name) => `${name}:${assetHash(path.posix.join("assets/js/workers", name))}`)
      .join(";");
  }

  function stampAssetVersions(html) {
    return html.replace(
      /(href|src)="(\/)?(assets\/[^"?]+)(\?v=[^"]*)?"/g,
      (match, attributeName, rootPrefix = "", relativePath) => {
        const firstParty = /^assets\/(?:css|js)\//.test(relativePath);
        if (!firstParty && !HASHED_VENDOR_ASSETS.has(relativePath)) return match;
        return `${attributeName}="${rootPrefix}${relativePath}?v=${assetHash(relativePath)}"`;
      }
    );
  }

  return { assetHash, stampAssetVersions, workerHashes };
}

module.exports = { createAssetPipeline, writePublicationTheme };
