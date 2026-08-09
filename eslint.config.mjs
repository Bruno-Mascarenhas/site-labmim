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
      // As páginas carregam estes arquivos com `<script src>` clássico — nenhuma tag
      // tem `type="module"`, e os workers são instanciados sem `{ type: "module" }`.
      // Analisá-los como módulo deixava `import`/`export`/`await` de topo passarem
      // limpos no lint e explodirem no navegador, onde o arquivo inteiro não avalia.
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
      // Em escopo de script as declarações de topo caem no escopo global e colidem
      // com os mesmos nomes listados em `globals` — que existem justamente porque
      // estes arquivos compartilham o escopo global. Sem isto, o código atual
      // acusaria sete redeclarações inexistentes.
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
