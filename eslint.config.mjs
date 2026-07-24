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
      sourceType: "module",
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
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
]);
