import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

export default defineConfig([
  globalIgnores([
    "node_modules/",
    ".venv/",
    "site/JSON/",
    "site/GeoJSON/",
    "site/assets/vendor/",
    "site/assets/data/",
    "**/*.json",
    "**/*.geojson",
  ]),
  {
    files: ["site/assets/js/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      // Classic `<script src>` everywhere, workers included. Parsed as modules, a
      // top-level `import`/`export`/`await` would lint clean and break the browser.
      sourceType: "script",
      globals: {
        ...globals.browser,
        L: "readonly",
        Chart: "readonly",
        VARIABLES_CONFIG: "readonly",
        VARIABLE_CONTEXTS: "readonly",
        LabmimDataService: "readonly",
        MeteoMapManager: "readonly",
        ChartsManager: "readonly",
        chartsManager: "writable",
        app: "writable",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],
      "no-useless-escape": "warn",
      "no-empty": "warn",
      // In script scope top-level declarations land in the global scope and clash with
      // the names under `globals`, listed there precisely because they share it.
      "no-redeclare": ["error", { builtinGlobals: false }],
    },
  },
  {
    files: ["build.js", "scripts/**/*.js", "scripts/**/*.cjs", "src/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // Browser globals alongside Node's: the reachability check ships functions that
      // Playwright serialises and runs inside the page, where `document` is the point.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
]);
