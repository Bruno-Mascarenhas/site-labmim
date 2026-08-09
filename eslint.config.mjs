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
      // The pages load these files through a classic `<script src>` — no tag carries
      // `type="module"` and the workers are instantiated without `{ type: "module" }`.
      // Parsed as modules, a top-level `import`/`export`/`await` would lint clean and
      // then break the browser, where the whole file fails to evaluate.
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
      // In script scope the top-level declarations land in the global scope and clash
      // with the very names listed under `globals`, which are listed there precisely
      // because these files share that scope.
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
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
]);
