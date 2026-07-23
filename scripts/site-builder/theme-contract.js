"use strict";

/**
 * Contrato de tema das publicações.
 *
 * REQUIRED: toda publicação DEVE declarar. São os tokens sem os quais o CSS
 * compartilhado não consegue se pintar (não há fallback literal para eles).
 *
 * OPTIONAL: qualquer publicação PODE declarar; nenhuma é obrigada. Quando o
 * token não é declarado, o CSS compartilhado (ou o JS) usa o valor de fallback
 * documentado em `fallback` — que é exatamente o literal em vigor hoje. Por
 * isso adicionar um token opcional nunca muda a aparência de quem não o declara
 * e nunca acopla uma publicação à outra.
 *
 * `consumedBy` diz onde o token é lido, e portanto onde o checador procura por
 * consumo:
 *   "css" -> precisa aparecer como var(--token) / var(--token, fallback) no CSS
 *            compartilhado de site/assets/css/**;
 *   "js"  -> é lido em runtime via getComputedStyle em site/assets/js/**, onde
 *            `var()` não existe e o fallback mora no próprio JS.
 */

const REQUIRED_THEME_PROPERTIES = Object.freeze([
  "accent-color",
  "brand-primary",
  "brand-secondary",
  "brand-primary-rgb",
  "brand-secondary-rgb",
  "accent-rgb",
  "monitoring-overlay",
  "map-accent",
  "map-accent-2",
  "map-accent-rgb",
  "lab-header-bg",
  "lab-header-dark-bg",
  "lab-footer-bg",
  "lab-footer-dark-bg",
  "maps-header-bg",
  "maps-header-dark-bg",
  "dark-accent",
  "dark-accent-hover",
  "dark-accent-rgb",
]);

const OPTIONAL_THEME_PROPERTIES = Object.freeze(
  [
    // Rampa de tinta (texto) sobre superfícies claras dos painéis de mapa/doc.
    {
      property: "ink-strong",
      consumedBy: "css",
      fallback: "#172033",
      describes: "títulos e valores fortes dos painéis de variável e da documentação",
    },
    {
      property: "ink-deep",
      consumedBy: "css",
      fallback: "#0d2b4d",
      describes: "rótulos de ação (botões de painel) e a mensagem de carregamento de gráficos",
    },
    {
      property: "ink-body",
      consumedBy: "css",
      fallback: "#31445a",
      describes: "texto de chips/badges dos cartões de variável",
    },
    {
      property: "ink-soft",
      consumedBy: "css",
      fallback: "#46576c",
      describes: "resumo descritivo dos cartões de variável",
    },
    {
      property: "ink-muted",
      consumedBy: "css",
      fallback: "#506176",
      describes: "kickers, legendas e rótulos secundários dos painéis",
    },
    // Tintas claras usadas SOBRE superfícies de marca (rodapé, navbar escura).
    {
      property: "ink-on-brand",
      consumedBy: "css",
      fallback: "#f4f8ff",
      describes: "links e texto do rodapé, que fica sobre --lab-footer-bg",
    },
    {
      property: "ink-on-dark",
      consumedBy: "css",
      fallback: "#f8fbff",
      describes: "texto dos botões outline da navbar no tema escuro",
    },
    {
      property: "ink-on-dark-muted",
      consumedBy: "css",
      fallback: "#d8dee9",
      describes: "parágrafos secundários de cards/explicações no tema escuro",
    },
    // Rampa de superfícies claras tingidas.
    {
      property: "surface-raised",
      consumedBy: "css",
      fallback: "#f8fbff",
      describes: "fundo do botão de ação dos cartões de variável",
    },
    {
      property: "surface-code",
      consumedBy: "css",
      fallback: "#f6f8fb",
      describes: "fundo dos blocos de fórmula da documentação",
    },
    {
      property: "surface-sunken",
      consumedBy: "css",
      fallback: "#f5f7fb",
      describes: "fundo das caixas de estatística e do estado vazio da prévia",
    },
    {
      property: "surface-chip",
      consumedBy: "css",
      fallback: "#eef4fb",
      describes: "fundo dos chips de metadado e do selo de domínio",
    },
    {
      property: "surface-hover",
      consumedBy: "css",
      fallback: "#ebebf5",
      describes: "fundo do hover das abas de documentação (vizinho da aba ativa)",
    },
    // Traços/hairlines dos painéis.
    {
      property: "hairline-rgb",
      consumedBy: "css",
      fallback: "13, 43, 77",
      describes: "canais RGB das bordas translúcidas dos painéis de variável",
    },
    {
      property: "hairline-strong",
      consumedBy: "css",
      fallback: "#d8e2ef",
      describes: "borda sólida dos blocos de fórmula da documentação",
    },
    // Contraparte escura dos tokens de gráfico (espelha --lab-header-dark-bg).
    {
      property: "chart-legend-dark-color",
      consumedBy: "css",
      fallback: "#fff",
      describes: "cor da legenda dos gráficos no tema escuro",
    },
    {
      property: "chart-grid-dark-color",
      consumedBy: "css",
      fallback: "rgba(255, 255, 255, 0.12)",
      describes: "cor da grade dos gráficos no tema escuro",
    },
    // Lidos em runtime por site/assets/js/charts-manager.js (_getThemeColors).
    {
      property: "chart-legend-color",
      consumedBy: "js",
      fallback: "#666",
      describes: "cor da legenda dos gráficos no tema claro",
    },
    {
      property: "chart-grid-color",
      consumedBy: "js",
      fallback: "#f0f0f0",
      describes: "cor da grade dos gráficos no tema claro",
    },
    {
      property: "tooltip-bg",
      consumedBy: "js",
      fallback: "rgba(18, 18, 18, 0.96)",
      describes: "fundo do tooltip dos gráficos",
    },
    {
      property: "tooltip-text",
      consumedBy: "js",
      fallback: "#fff",
      describes: "texto do tooltip dos gráficos",
    },
  ].map((entry) => Object.freeze(entry))
);

const OPTIONAL_THEME_PROPERTY_NAMES = Object.freeze(OPTIONAL_THEME_PROPERTIES.map((entry) => entry.property));

/** Retrocompatibilidade: o nome antigo sempre significou "obrigatórios". */
const PUBLICATION_THEME_PROPERTIES = REQUIRED_THEME_PROPERTIES;

const COLOR_RGB_PAIRS = Object.freeze([
  ["brand-primary", "brand-primary-rgb"],
  ["brand-secondary", "brand-secondary-rgb"],
  ["accent-color", "accent-rgb"],
  ["map-accent", "map-accent-rgb"],
  ["dark-accent", "dark-accent-rgb"],
]);

const PAIRED_RGB_PROPERTIES = new Set(COLOR_RGB_PAIRS.map(([, rgbProperty]) => rgbProperty));

function parseHexColor(value) {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit.repeat(2)).join("") : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
}

function parseRgbChannels(value) {
  const match = value.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (!match) return null;
  const channels = match.slice(1).map(Number);
  return channels.every((channel) => channel <= 255) ? channels : null;
}

function inspectPublicationThemeCss(content) {
  const errors = [];
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  // `[^{}]` impede que o bloco engula a regra seguinte quando a última
  // declaração vem sem ';'; `@` barra at-rules que não usam chaves (@import,
  // @charset) e que também escapariam do contrato.
  const root = withoutComments.match(/^:root\s*\{([^{}@]*)\}\s*$/);

  if (!root) {
    return ["must contain exactly one :root block and no publication-specific selectors"];
  }

  const declarations = root[1]
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  const seen = new Set();
  const values = new Map();

  for (const declaration of declarations) {
    const match = declaration.match(/^--([a-z0-9-]+)\s*:\s*([^;{}]+)$/);
    if (!match) {
      errors.push(`only custom-property declarations are allowed (found ${JSON.stringify(declaration)})`);
      continue;
    }

    const property = match[1];
    if (seen.has(property)) errors.push(`duplicate custom property --${property}`);
    seen.add(property);
    values.set(property, match[2].trim());
    if (!REQUIRED_THEME_PROPERTIES.includes(property) && !OPTIONAL_THEME_PROPERTY_NAMES.includes(property)) {
      errors.push(
        `unexpected custom property --${property}; declare it first in scripts/site-builder/theme-contract.js ` +
          `(REQUIRED_THEME_PROPERTIES if every publication must ship it, OPTIONAL_THEME_PROPERTIES if it is opt-in ` +
          `and the shared CSS/JS already carries a fallback)`
      );
    }
  }

  for (const property of REQUIRED_THEME_PROPERTIES) {
    if (!seen.has(property)) {
      errors.push(
        `missing required custom property --${property}; declare it, or move it to OPTIONAL_THEME_PROPERTIES in ` +
          `scripts/site-builder/theme-contract.js if the shared CSS/JS can fall back without it`
      );
    }
  }

  for (const [colorProperty, rgbProperty] of COLOR_RGB_PAIRS) {
    if (!values.has(colorProperty) || !values.has(rgbProperty)) continue;
    const color = parseHexColor(values.get(colorProperty));
    const channels = parseRgbChannels(values.get(rgbProperty));
    if (!color) {
      errors.push(`--${colorProperty} must use #rgb or #rrggbb so its RGB companion can be verified`);
    } else if (!channels) {
      errors.push(`--${rgbProperty} must contain three channels between 0 and 255`);
    } else if (color.some((channel, index) => channel !== channels[index])) {
      errors.push(`--${rgbProperty} must match --${colorProperty} (${color.join(", ")})`);
    }
  }

  for (const [property, value] of values) {
    if (!property.endsWith("-rgb") || PAIRED_RGB_PROPERTIES.has(property)) continue;
    if (!parseRgbChannels(value)) {
      errors.push(`--${property} must contain three channels between 0 and 255 so rgba(var(--${property}), a) works`);
    }
  }

  return errors;
}

module.exports = {
  PUBLICATION_THEME_PROPERTIES,
  REQUIRED_THEME_PROPERTIES,
  OPTIONAL_THEME_PROPERTIES,
  OPTIONAL_THEME_PROPERTY_NAMES,
  inspectPublicationThemeCss,
};
