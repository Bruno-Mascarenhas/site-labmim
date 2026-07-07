import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

export default defineConfig([
  globalIgnores([
    "node_modules/",
    ".venv/",
    "site/JSON/",
    "site/GeoJSON/",
    "site/assets/json/",
    "site/assets/vendor/",
    "site/assets/data/",
    "**/*.json",
    "**/*.geojson",
  ]),
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.jquery,
        L: "readonly",
        Chart: "readonly",
        VARIABLES_CONFIG: "readonly",
        VARIABLE_CONTEXTS: "readonly",
        LabmimDataService: "readonly",
        MeteoMapManager: "readonly",
        ChartsManager: "readonly",
        chartsManager: "writable",
        app: "writable",
        module: "writable",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],
      "no-useless-escape": "warn",
      "no-empty": "warn",
    },
  },
]);
