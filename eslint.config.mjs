import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ignores: [
      "node_modules/",
      ".venv/",
      "site/JSON/",
      "site/GeoJSON/",
      "site/assets/json/",
      "**/*.json",
      "**/*.geojson"
    ]
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.jquery,
        L: "readonly",
        turf: "readonly",
        Chart: "readonly",
        VARIABLES_CONFIG: "readonly",
        MeteoMapManager: "readonly",
        ChartsManager: "readonly",
        chartsManager: "writable",
        app: "writable",
        module: "writable"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": ["warn", { "allow": ["warn", "error", "info", "debug"] }],
      "no-useless-escape": "warn",
      "no-empty": "warn"
    }
  }
];
