/**
 * VARIABLES_CONFIG.js
 *
 * Centralized configuration of meteorological variables.
 * Add new variables here to expand system functionality.
 *
 * Each variable contains:
 * - id: File identifier (e.g., SWDOWN, POT_EOLICO_100M)
 * - label: Name displayed in the UI
 * - unit: Measurement unit
 * - colormap: Color palette type
 * - colors: Array of hex colors for the gradient
 * - specificInfo: Function returning variable-specific details
 *   * Signature: (value, allValues = {})
 *   * value: Current variable value
 *   * allValues: Object containing values for ALL variables at the same cell/date
 *     Example: { temperature: { value: 25, label: '...', unit: '°C' }, ... }
 *   * Enables multivariate calculations (e.g., solar production with temp adjustments)
 */

/**
 * Helper to retrieve custom parameters or fallback to default
 * @param {string} variableType - Variable type (e.g., solar, eolico)
 * @param {string} paramName - Parameter name
 * @param {number} defaultValue - Default value if not customized
 * @returns {number} Custom or default value
 */
function getParameter(variableType, paramName, defaultValue) {
  if (typeof app === "undefined" || !app || !app.getCustomParameter) {
    return defaultValue;
  }

  try {
    const customValue = app.getCustomParameter(variableType, paramName);
    if (customValue !== null && customValue !== undefined) {
      return customValue;
    }
  } catch (e) {
    console.warn(`Error getting parameter: ${e.message}`);
  }

  return defaultValue;
}

const TEMPERATURE_COLORS = ["#0000ff", "#00ffff", "#00ff00", "#ffff00", "#ff0000"];
const HUMIDITY_COLORS = ["#f7fbff", "#deebf7", "#c6dbef", "#6baed6", "#2171b5", "#08306b"];
const RADIATION_COLORS = ["#1d1d1d", "#4a3366", "#8d4f8a", "#d67a59", "#f0b35a", "#fff2a8"];
const PRESSURE_COLORS = [
  "#a50026",
  "#d73027",
  "#f46d43",
  "#fdae61",
  "#fee090",
  "#e0f3f8",
  "#abd9e9",
  "#74add1",
  "#4575b4",
  "#313695",
];

const VARIABLE_CONTEXTS = {
  forecast: {
    label: "Previsões",
    optionGroupLabel: "Variáveis meteorológicas e radiativas",
    defaultVariable: "wind",
    variables: [
      "wind",
      "temperature",
      "skinTemperature",
      "pressure",
      "humidity",
      "relativeHumidity",
      "rain",
      "globalRadiation",
      "longwave",
      "hfx",
      "lh",
    ],
  },
  energy: {
    label: "Potenciais Energéticos",
    optionGroupLabel: "Potenciais energéticos",
    defaultVariable: "solar",
    variables: ["solar", "eolico", "windPowerDensity"],
  },
};

const VARIABLES_CONFIG = {
  solar: {
    id: "SWDOWN",
    label: "Radiação Solar",
    optionLabel: "Potencial Fotovoltaico",
    icon: "☀️",
    category: "energy",
    unit: "W/m²",
    sourceId: "SWDOWN",
    summary:
      "Radiação solar incidente na superfície. A produção fotovoltaica exibida é uma estimativa calculada no frontend.",
    scaleMin: 0,
    scaleMax: 1200,
    colormap: "hot_r",
    colors: [
      "#ffffff",
      "#fff0a0",
      "#ffd700",
      "#ffaa00",
      "#ff6600",
      "#ff2200",
      "#dd0000",
      "#aa0000",
      "#7a0000",
      "#691009",
    ],
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined) {
        return {
          title: "Geração Fotovoltaica",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      const air_temp = allValues.temperature?.value || 25;
      const panelEfficiency = getParameter("solar", "panelEfficiency", 18) / 100;
      const inversorEfficiency = getParameter("solar", "inversorEfficiency", 95) / 100;
      const ptc = getParameter("solar", "ptc", -0.38);
      const noct = getParameter("solar", "noct", 45);

      const nominal_params_temp = 25;
      const foto_cell_temp = air_temp + ((noct - 20) * value) / 800;
      const energy_gen =
        (value / 1000) *
        panelEfficiency *
        inversorEfficiency *
        (1 + (ptc * (foto_cell_temp - nominal_params_temp)) / 100);

      return {
        title: "Geração Fotovoltaica",
        items: [
          {
            label: "Radiação Incidente Acumulada (1h)",
            value: (value * 3.6).toFixed(2),
            unit: "kJ/m²",
            icon: "fa-sun",
          },
          {
            label: "Produção Energética Acumulada (1h)",
            value: (energy_gen * 1000).toFixed(2),
            unit: "Wh/m²",
            icon: "fa-solar-panel",
          },
        ],
      };
    },
  },

  eolico: {
    id: "POT_EOLICO_50M",
    id_100m: "POT_EOLICO_100M",
    id_150m: "POT_EOLICO_150M",
    defaultHeight: 50,
    label: "Velocidade do Vento",
    optionLabel: "Potencial Eólico",
    icon: "💨",
    category: "energy",
    unit: "m/s",
    sourceId: "POT_EOLICO_50M / POT_EOLICO_100M / POT_EOLICO_150M",
    summary:
      "Velocidade do vento interpolada para alturas de hub. A produção eólica é estimada no frontend a partir de parâmetros da turbina.",
    scaleMin: 0,
    scaleMax: 20,
    colormap: "Blues",
    colors: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.eolico?.ausente) {
        return {
          title: "Geração Eólica",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      const tempValue = allValues.temperature?.value || 15;

      const airDensity = getParameter("eolico", "airDensity", 1.225);
      const rotorDiameter = getParameter("eolico", "rotorDiameter", 40);
      const Cp = getParameter("eolico", "Cp", getParameter("eolico", "powerCoefficient", 0.4));

      const densityOfAir = airDensity * (288 / (273 + tempValue));
      const rotorArea = Math.PI * Math.pow(rotorDiameter / 2, 2);

      return {
        title: "Geração Eólica",
        items: [
          {
            label: "Categoria do Vento",
            value: getWindCategory(value),
            icon: "fa-wind",
          },
          {
            label: "Densidade de Potência",
            value: (0.5 * densityOfAir * Math.pow(value, 3)).toFixed(0),
            unit: "W/m²",
            icon: "fa-fan",
          },
          {
            label: `Produção Energética Acumulada (1h)`,
            value: ((0.5 * densityOfAir * Math.pow(value, 3) * rotorArea * Cp) / 1000).toFixed(1),
            unit: "kWh",
            icon: "fa-wind",
          },
        ],
      };
    },
  },

  temperature: {
    id: "TEMP",
    label: "Temperatura (2m)",
    optionLabel: "Temperatura",
    icon: "🌡️",
    category: "forecast",
    unit: "°C",
    sourceId: "TEMP",
    summary: "Temperatura do ar a 2 metros usada como referência meteorológica de superfície.",
    scaleMin: 10,
    scaleMax: 40,
    colormap: "hot_r",
    colors: TEMPERATURE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.temperature?.ausente) {
        return {
          title: "Informações Térmicas",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      const humidityValue =
        allValues.relativeHumidity?.value ?? (allValues.humidity?.unit === "%" ? allValues.humidity.value : null);
      const windValue = allValues.wind?.value || 2;

      const feelsLike = humidityValue === null ? value : getTemperatureFeelsLike(value, humidityValue, windValue);
      const heatIndex = humidityValue === null ? null : getHeatIndex(value, humidityValue);

      return {
        title: "Informações Térmicas",
        items: [
          {
            label: "Sensação Térmica",
            value: feelsLike.toFixed(1),
            unit: "°C",
            icon: "fa-thermometer",
          },
          {
            label: "Classificação",
            value: value > 25 ? "Quente" : value < 15 ? "Frio" : "Moderado",
            icon: "fa-info-circle",
          },
          {
            label: "Índice de Calor",
            value: heatIndex === null ? "N/D" : heatIndex.toFixed(1),
            unit: heatIndex === null ? "" : "°C",
            icon: "fa-fire",
          },
        ],
      };
    },
  },

  skinTemperature: {
    id: "TSK",
    label: "Temperatura de Superfície",
    optionLabel: "Temperatura de Superfície",
    icon: "🌡️",
    category: "forecast",
    unit: "°C",
    sourceId: "TSK",
    summary: "Temperatura da superfície do modelo, útil para contraste com a temperatura do ar a 2 metros.",
    scaleMin: 10,
    scaleMax: 50,
    colormap: "hot_r",
    colors: TEMPERATURE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.skinTemperature?.ausente) {
        return {
          title: "Temperatura de Superfície",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      const airTemp = allValues.temperature?.value;
      const delta = airTemp === null || airTemp === undefined ? null : value - airTemp;

      return {
        title: "Temperatura de Superfície",
        items: [
          {
            label: "Temperatura da Pele",
            value: value.toFixed(1),
            unit: "°C",
            icon: "fa-temperature-high",
          },
          {
            label: "Diferença para 2m",
            value: delta === null ? "N/D" : delta.toFixed(1),
            unit: delta === null ? "" : "°C",
            icon: "fa-layer-group",
          },
          {
            label: "Condição",
            value: value > 32 ? "Superfície quente" : value < 18 ? "Superfície fria" : "Moderada",
            icon: "fa-info-circle",
          },
        ],
      };
    },
  },

  pressure: {
    id: "PRES",
    label: "Pressão Atmosférica",
    optionLabel: "Pressão Atmosférica",
    icon: "🎯",
    category: "forecast",
    unit: "hPa",
    sourceId: "PRES",
    summary: "Pressão atmosférica na superfície, exibida em hectopascal para leitura operacional.",
    scaleMin: 950,
    scaleMax: 1030,
    colormap: "RdBu_r",
    colors: PRESSURE_COLORS,
    useDynamicScale: true,
    normalValue: 1013,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.pressure?.ausente) {
        return {
          title: "Condições Atmosféricas",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Condições Atmosféricas",
        items: [
          {
            label: "Classificação",
            value: value > 1013 ? "Alta Pressão" : "Baixa Pressão",
            icon: "fa-cloud",
          },
          {
            label: "Tendência",
            value: "Estável",
            icon: "fa-chart-line",
          },
          {
            label: "Desvio Normal",
            value: (value - 1013).toFixed(1),
            unit: "hPa",
            icon: "fa-arrow-up",
          },
        ],
      };
    },
  },

  humidity: {
    id: "VAPOR",
    label: "Vapor d'Água (2m)",
    optionLabel: "Vapor d'Água",
    icon: "💧",
    category: "forecast",
    unit: "g/kg",
    sourceId: "VAPOR",
    summary: "Razão de mistura de vapor d'água próximo à superfície, expressa em g/kg.",
    scaleMin: 0,
    scaleMax: 25,
    colormap: "RdBu_r",
    colors: HUMIDITY_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.humidity?.ausente) {
        return {
          title: "Condições de Umidade",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Conteúdo de Vapor d'Água",
        items: [
          {
            label: "Classificação",
            value: value > 18 ? "Alta" : value < 8 ? "Baixa" : "Moderada",
            icon: "fa-droplet",
          },
          {
            label: "Razão de Mistura",
            value: value.toFixed(2),
            unit: "g/kg",
            icon: "fa-water",
          },
          {
            label: "Uso Atmosférico",
            value: "Transporte de umidade",
            icon: "fa-cloud-sun",
          },
        ],
      };
    },
  },

  relativeHumidity: {
    id: "RH2",
    label: "Umidade Relativa (2m)",
    optionLabel: "Umidade Relativa",
    icon: "💧",
    category: "forecast",
    unit: "%",
    sourceId: "RH2",
    summary:
      "Percentual de saturação do ar próximo à superfície, estimado a partir de temperatura, pressão e vapor d'água.",
    scaleMin: 0,
    scaleMax: 100,
    colormap: "YlGnBu",
    colors: HUMIDITY_COLORS,
    useDynamicScale: true,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.relativeHumidity?.ausente) {
        return {
          title: "Umidade Relativa",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Umidade Relativa",
        items: [
          {
            label: "Classificação",
            value: value >= 80 ? "Úmida" : value <= 40 ? "Seca" : "Moderada",
            icon: "fa-droplet",
          },
          {
            label: "Umidade Relativa",
            value: value.toFixed(0),
            unit: "%",
            icon: "fa-water",
          },
          {
            label: "Conforto",
            value: value < 30 ? "Muito seco" : value > 85 ? "Muito úmido" : "Aceitável",
            icon: "fa-cloud-sun",
          },
        ],
      };
    },
  },

  rain: {
    id: "RAIN",
    label: "Precipitação",
    optionLabel: "Precipitação",
    icon: "🌧️",
    category: "forecast",
    unit: "mm",
    sourceId: "RAIN",
    summary: "Precipitação horária acumulada no timestep do modelo.",
    scaleMin: 0,
    scaleMax: 30,
    colormap: "hot_r",
    colors: TEMPERATURE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.rain?.ausente) {
        return {
          title: "Previsão de Precipitação",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Previsão de Precipitação",
        items: [
          {
            label: "Intensidade",
            value: value < 2.5 ? "Leve" : value < 10 ? "Moderada" : "Forte",
            icon: "fa-cloud-rain",
          },
          {
            label: "Volume Esperado",
            value: (value * 0.95).toFixed(1),
            unit: "mm",
            icon: "fa-water",
          },
          {
            label: "Impacto Agrícola",
            value: value > 5 ? "Benéfico" : "Insuficiente",
            icon: "fa-leaf",
          },
        ],
      };
    },
  },

  wind: {
    id: "WIND",
    label: "Velocidade do Vento (10m)",
    optionLabel: "Vento (10m)",
    icon: "🌬️",
    category: "forecast",
    unit: "m/s",
    sourceId: "WIND",
    summary: "Velocidade do vento a 10 metros calculada a partir das componentes U10 e V10.",
    scaleMin: 0,
    scaleMax: 15,
    colormap: "PuBu",
    colors: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.wind?.ausente) {
        return {
          title: "Informações do Vento",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Informações do Vento",
        items: [
          {
            label: "Categoria do Vento",
            value: getWindCategory(value),
            icon: "fa-wind",
          },
          {
            label: "Direção",
            value: "Variável",
            icon: "fa-compass",
          },
          {
            label: "Rajadas (est.)",
            value: (value * 1.3).toFixed(1),
            unit: "m/s",
            icon: "fa-wind",
          },
        ],
      };
    },
  },

  globalRadiation: {
    id: "SWDOWN",
    label: "Radiação Global",
    optionLabel: "Radiação Global",
    icon: "☀️",
    category: "forecast",
    unit: "W/m²",
    sourceId: "SWDOWN",
    summary: "Radiação solar de onda curta incidente na superfície. Não inclui cálculo fotovoltaico nesta página.",
    scaleMin: 0,
    scaleMax: 1200,
    colormap: "hot_r",
    colors: [
      "#ffffff",
      "#fff0a0",
      "#ffd700",
      "#ffaa00",
      "#ff6600",
      "#ff2200",
      "#dd0000",
      "#aa0000",
      "#7a0000",
      "#691009",
    ],
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.globalRadiation?.ausente) {
        return {
          title: "Radiação Global",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Radiação Global",
        items: [
          {
            label: "Fluxo Incidente",
            value: value.toFixed(0),
            unit: "W/m²",
            icon: "fa-sun",
          },
          {
            label: "Acumulado Estimado (1h)",
            value: (value * 3.6).toFixed(1),
            unit: "kJ/m²",
            icon: "fa-chart-area",
          },
          {
            label: "Condição",
            value: value >= 800 ? "Alta radiação" : value >= 300 ? "Radiação moderada" : "Baixa radiação",
            icon: "fa-circle-info",
          },
        ],
      };
    },
  },

  longwave: {
    id: "GLW",
    label: "Radiação de Onda Longa",
    optionLabel: "Onda Longa Incidente",
    icon: "🌙",
    category: "forecast",
    unit: "W/m²",
    sourceId: "GLW",
    summary: "Radiação de onda longa incidente na superfície, usada no balanço radiativo.",
    scaleMin: 250,
    scaleMax: 500,
    colormap: "magma",
    colors: RADIATION_COLORS,
    useDynamicScale: true,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.longwave?.ausente) {
        return {
          title: "Radiação de Onda Longa",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Radiação de Onda Longa",
        items: [
          {
            label: "Fluxo Incidente",
            value: value.toFixed(0),
            unit: "W/m²",
            icon: "fa-moon",
          },
          {
            label: "Uso",
            value: "Balanço radiativo",
            icon: "fa-scale-balanced",
          },
          {
            label: "Condição",
            value: value > 420 ? "Atmosfera úmida/nublada" : value < 330 ? "Céu mais limpo" : "Intermediária",
            icon: "fa-cloud",
          },
        ],
      };
    },
  },

  hfx: {
    id: "HFX",
    label: "Calor Sensível",
    optionLabel: "Calor Sensível",
    icon: "🔥",
    category: "forecast",
    unit: "W/m²",
    sourceId: "HFX",
    summary: "Fluxo turbulento de calor sensível entre superfície e atmosfera.",
    scaleMin: -200,
    scaleMax: 600,
    colormap: "hot_r",
    colors: TEMPERATURE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.hfx?.ausente) {
        return {
          title: "Fluxo de Calor Sensível",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Fluxo de Calor Sensível",
        items: [
          {
            label: "Intensidade",
            value: Math.abs(value).toFixed(0),
            unit: "W/m²",
            icon: "fa-fire",
          },
          {
            label: "Tipo",
            value: value > 0 ? "Aquecimento" : "Resfriamento",
            icon: value > 0 ? "fa-arrow-up" : "fa-arrow-down",
          },
          {
            label: "Magnitude",
            value: Math.abs(value) > 300 ? "Forte" : Math.abs(value) > 100 ? "Moderada" : "Fraca",
            icon: "fa-thermometer",
          },
        ],
      };
    },
  },

  lh: {
    id: "LH",
    label: "Calor Latente",
    optionLabel: "Calor Latente",
    icon: "💧",
    category: "forecast",
    unit: "W/m²",
    sourceId: "LH",
    summary: "Fluxo turbulento de calor latente associado a evaporação e condensação.",
    scaleMin: -100,
    scaleMax: 700,
    colormap: "hot",
    colors: [...TEMPERATURE_COLORS].reverse(),
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.lh?.ausente) {
        return {
          title: "Fluxo de Calor Latente",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      return {
        title: "Fluxo de Calor Latente",
        items: [
          {
            label: "Intensidade",
            value: Math.abs(value).toFixed(0),
            unit: "W/m²",
            icon: "fa-cloud",
          },
          {
            label: "Tipo",
            value: value > 0 ? "Evaporação" : "Condensação",
            icon: value > 0 ? "fa-arrow-up" : "fa-arrow-down",
          },
          {
            label: "Atividade Convectiva",
            value: Math.abs(value) > 300 ? "Intensa" : Math.abs(value) > 100 ? "Moderada" : "Fraca",
            icon: "fa-water",
          },
        ],
      };
    },
  },

  windPowerDensity: {
    id: "WIND_POWER_DENSITY_10M",
    label: "Densidade de Potência Eólica (10m)",
    optionLabel: "Densidade Eólica 10m",
    icon: "💨",
    category: "energy",
    unit: "W/m²",
    sourceId: "WIND_POWER_DENSITY_10M",
    summary: "Densidade de potência disponível no vento a 10 metros. Não é geração real de turbina.",
    scaleMin: 0,
    scaleMax: 1500,
    colormap: "YlOrRd",
    colors: ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#e31a1c", "#800026"],
    useDynamicScale: true,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.windPowerDensity?.ausente) {
        return {
          title: "Densidade de Potência Eólica",
          items: [
            {
              label: "Status",
              value: "⚠ Dados Indisponíveis",
              unit: "",
              icon: "fa-exclamation-triangle",
            },
          ],
        };
      }

      const windValue = allValues.wind?.value;

      return {
        title: "Densidade de Potência Eólica",
        items: [
          {
            label: "Potência Disponível",
            value: value.toFixed(0),
            unit: "W/m²",
            icon: "fa-fan",
          },
          {
            label: "Altura",
            value: "10",
            unit: "m",
            icon: "fa-ruler-vertical",
          },
          {
            label: "Vento 10m",
            value: windValue === null || windValue === undefined ? "N/D" : windValue.toFixed(1),
            unit: windValue === null || windValue === undefined ? "" : "m/s",
            icon: "fa-wind",
          },
        ],
      };
    },
  },
};

function getWindCategory(speed) {
  if (speed < 2) return "Muito Fraco";
  if (speed < 4) return "Fraco";
  if (speed < 6) return "Moderado";
  if (speed < 8) return "Forte";
  if (speed < 10) return "Muito Forte";
  return "Extremo";
}

function getWindDirection(angle) {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const index = Math.round((angle % 360) / 22.5);
  return directions[index % 16];
}

function getTemperatureFeelsLike(temperatureC, humidity, windSpeedMs) {
  if (temperatureC >= 26.7 && humidity >= 40) {
    const T = (temperatureC * 9) / 5 + 32;
    const RH = humidity;

    const HI_F =
      -42.379 +
      2.04901523 * T +
      10.14333127 * RH -
      0.22475541 * T * RH -
      0.00683783 * T * T -
      0.05481717 * RH * RH +
      0.00122874 * T * T * RH +
      0.00085282 * T * RH * RH -
      0.00000199 * T * T * RH * RH;

    return ((HI_F - 32) * 5) / 9;
  }

  if (temperatureC <= 10 && windSpeedMs >= 1.34) {
    const v = windSpeedMs * 3.6;

    return 13.12 + 0.6215 * temperatureC - 11.37 * Math.pow(v, 0.16) + 0.3965 * temperatureC * Math.pow(v, 0.16);
  }

  return temperatureC;
}

function getHeatIndex(temperatureC, humidity) {
  if (temperatureC < 26 || humidity < 40) {
    return temperatureC;
  }

  const e = (humidity / 100) * 6.105 * Math.exp((17.27 * temperatureC) / (237.7 + temperatureC));

  const heatIndex = temperatureC + 0.33 * e - 0.7;

  return heatIndex;
}

function estimateSolarGeneration(irradiance, panelArea = 10, efficiency = 0.18) {
  return (irradiance * panelArea * efficiency) / 1000;
}

function estimateWindGeneration(powerDensity, turbineArea = 500) {
  return (powerDensity * turbineArea) / 1000;
}

/**
 * Export all configurations
 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    VARIABLE_CONTEXTS,
    VARIABLES_CONFIG,
    getWindCategory,
    getWindDirection,
    getTemperatureFeelsLike,
    estimateSolarGeneration,
    estimateWindGeneration,
  };
}
