/**
 * Fields beyond the self-evident ones (id, label, unit, colors, scaleMin/Max):
 * - relatedVariables: companions fetched only on a cell click, never per frame.
 * - chartCompanions: extra SERIES the time-series modal loads with the variable.
 * - hideBelow: values strictly below stay unpainted instead of taking the
 *   palette's first color.
 * - accumulation: the pipeline publishes one file per timestep, so windows
 *   longer than a step are summed in the frontend over the N steps ending at
 *   the selected time.
 * - specificInfo(value, allValues): allValues holds the variable plus its
 *   relatedVariables, each as { value, label, unit }.
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

/**
 * The EFFECTIVE window behind the painted field, not the selected one: the
 * first steps of a run have no earlier steps to close the window with, so the
 * sum falls short and dividing it by the selected 3h would overstate intensity.
 */
function getAccumulationHours(variableType, defaultHours = 1) {
  if (typeof app === "undefined" || !app || !app.getAccumulatedSteps) {
    return defaultHours;
  }

  try {
    return app.getAccumulatedSteps(variableType) ?? defaultHours;
  } catch (e) {
    console.warn(`Error getting accumulation window: ${e.message}`);
    return defaultHours;
  }
}

/**
 * Blue-to-red across a gold centre, lightness monotonic on each arm. Replaces `jet`, whose
 * lightness rises and falls twice and so draws bands the field does not have.
 *
 * The centre sits ON this region's usual temperatures, so it is the one stop that must not
 * be pale: RdYlBu's `#ffffbf` composited to 3.6 OKLab units over the basemap and washed the
 * common case out. The gold here clears 8, and 25 degC gets no hard edge it has not earned.
 */
const THERMAL_COLORS = [
  "#10197e",
  "#084f95",
  "#1c7cb2",
  "#45a9cd",
  "#75d5e8",
  "#fdcd62",
  "#f0b87f",
  "#e9772a",
  "#c2452a",
  "#950d27",
  "#560d20",
];

/**
 * A signed flux needs its neutral ON zero, and zero rarely sits mid-scale: sensible heat
 * runs -200..600, where a symmetric ramp would neutralise 200 W/m² and paint a real
 * downward flux like a real upward one. The bar spaces stops evenly, so they are
 * generated to land the neutral where zero actually falls.
 *
 * The neutral is a grey, not a white: at `fillOpacity` 0.45 white composites to 1.2 OKLab
 * units over the light basemap, so the sign change — the one feature the field exists to
 * show — was the least visible point on the map. Its lightness is the one that clears both
 * basemaps, the light tiles and the darkened ones under `.dark-theme`; a grey tuned to
 * either alone lands on top of the other. It clears 8 on both.
 */
function mixHex(from, to, t) {
  const channel = (offset) => {
    const a = parseInt(from.slice(offset, offset + 2), 16);
    const b = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function sampleRamp(ramp, t) {
  const clamped = Math.min(1, Math.max(0, t));
  const position = clamped * (ramp.length - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, ramp.length - 1);
  return mixHex(ramp[low], ramp[high], position - low);
}

const FLUX_NEUTRAL = "#b3b1ad";
const FLUX_NEGATIVE_RAMP = ["#012571", "#074b81", "#1f6e96", "#4890a7", FLUX_NEUTRAL];
const FLUX_POSITIVE_RAMP = [FLUX_NEUTRAL, "#c37155", "#be402b", "#a11e26", "#7d0224", "#53071f"];

/**
 * Stops are interpolated, so unless one lands exactly on zero the neutral is blended
 * away and the sign change stops being visible. Smallest count that lands it; nearest
 * fit when the ratio has none.
 */
function stepsLandingOnZero(zeroFraction, minSteps = 11, maxSteps = 41) {
  let best = minSteps;
  let bestError = Infinity;
  for (let steps = minSteps; steps <= maxSteps; steps += 1) {
    const exact = zeroFraction * (steps - 1);
    const error = Math.abs(exact - Math.round(exact));
    if (error < bestError - 1e-9) {
      best = steps;
      bestError = error;
      if (error < 1e-9) break;
    }
  }
  return best;
}

function fluxColorsAroundZero(scaleMin, scaleMax) {
  const span = scaleMax - scaleMin;
  const steps = stepsLandingOnZero(-scaleMin / span);
  const stops = [];
  for (let index = 0; index < steps; index += 1) {
    const value = scaleMin + (span * index) / (steps - 1);
    stops.push(
      value < 0
        ? sampleRamp(FLUX_NEGATIVE_RAMP, 1 - value / scaleMin)
        : sampleRamp(FLUX_POSITIVE_RAMP, value / scaleMax)
    );
  }
  return stops;
}

// Rain reads as water: it replaces the temperature ramp, which painted the heaviest
// rainfall in the red every other layer here uses for hot. Violet at the top is the
// rainfall convention, and is what keeps this from being one blue getting darker.
const RAIN_COLORS = ["#66e6f8", "#46cded", "#38b3dd", "#2d99cd", "#227fbe", "#1965b1", "#204b9f", "#243188", "#241570"];

/**
 * Three constraints hold for every ramp below.
 *
 * LIGHTNESS IS MONOTONIC — what separates these from a rainbow, and what keeps the map
 * readable in greyscale and under colour-blindness. Diverging ramps hold it per arm.
 *
 * THE LOW END IS LIGHT WITHOUT BEING PALE — the field paints at `fillOpacity` 0.45, which
 * leaves lightness a third of its range once composited over the basemap. A white low end
 * lands within 2 OKLab units of bare terrain, so the quietest values read as unpainted; a
 * dark one hazes the map, which is how viridis failed here for wind. Every ramp starts at
 * the palest its hue can be and still clear 6 units.
 *
 * CHROMA CARRIES THE SCALE — with lightness compressed, hue and saturation do most of the
 * separating, so the stops walk an OKLCH arc instead of resting on one hue.
 *
 * plasma, kept as-is for clearness: Smith & van der Walt (2015), matplotlib.
 */

// Shared by specific and relative humidity: they measure the same thing.
const MOISTURE_COLORS = [
  "#dbf363",
  "#99e36c",
  "#52ce7d",
  "#41b08f",
  "#31938c",
  "#237783",
  "#155d77",
  "#0f426a",
  "#07157d",
];

// Calm stays light, not blank; warm-at-high is the wind convention.
const WIND_COLORS = ["#fdd75c", "#f7b625", "#e7971f", "#d8770f", "#c95502", "#b23712", "#99151b", "#77091f", "#53081d"];

// Violet because no neighbouring field claims it; higher emission is the anomaly.
const EMISSIVITY_COLORS = [
  "#d5befa",
  "#cd9df6",
  "#c47fe2",
  "#b668c3",
  "#a651a5",
  "#963a88",
  "#84226b",
  "#6b184e",
  "#501035",
];

// Overcast dark, full sun bright — the ramp reads as the sky it describes.
const CLEARNESS_COLORS = [
  "#0d0887",
  "#4c02a1",
  "#7e03a8",
  "#a92395",
  "#cc4778",
  "#e66c5c",
  "#f89441",
  "#fdc328",
  "#f0f921",
];
// Shared by the four shortwave layers: comparing incoming against reflected only works
// if the same value wears the same colour in both.
const SHORTWAVE_COLORS = [
  "#fddc5a",
  "#f5bb26",
  "#e69b1a",
  "#d77903",
  "#c65800",
  "#b53100",
  "#990a16",
  "#720d1f",
  "#4e0b1a",
];

// Its own ramp so thermal emission is never read as sunlight at a glance: warm like
// shortwave, but the chroma tapers so it runs to brown rather than to red.
const LONGWAVE_COLORS = [
  "#fde15f",
  "#ecc440",
  "#d8a92c",
  "#c18f29",
  "#a97726",
  "#8e6123",
  "#744c1f",
  "#5a3919",
  "#412712",
];

/**
 * Sequential, NOT diverging: the field is PSFC over terrain, unreduced to sea level, so a
 * midpoint would separate altitudes rather than weather. Cool so it never competes with the
 * thermal reading, where blue-to-red means cold-hot.
 */
const PRESSURE_COLORS = [
  "#61f4f8",
  "#4edbd6",
  "#3cc2b5",
  "#31a996",
  "#269179",
  "#1d795d",
  "#156143",
  "#104a2c",
  "#0a3518",
];

const VARIABLE_CONTEXTS = {
  forecast: {
    optionGroupLabel: "Variáveis meteorológicas e radiativas",
    defaultVariable: "temperature",
    // Ordered by the energy balance, not by name: shortwave, longwave, the net
    // radiation that sums them (Rn = H + LE + G, hence right before hfx/lh),
    // then the two dimensionless sky diagnostics, which are not balance terms.
    variables: [
      "temperature",
      "skinTemperature",
      "rain",
      "humidity",
      "relativeHumidity",
      "pressure",
      "wind",
      "globalRadiation",
      "shortwaveUp",
      "netShortwave",
      "longwave",
      "longwaveUp",
      "netLongwave",
      "netRadiation",
      "hfx",
      "lh",
      "skyEmissivity",
      "clearnessIndex",
    ],
  },
  energy: {
    optionGroupLabel: "Potenciais energéticos",
    defaultVariable: "solar",
    variables: ["solar", "eolico", "windPowerDensity"],
  },
};

function unavailableInfo(title) {
  return {
    title,
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

const VARIABLES_CONFIG = {
  solar: {
    id: "SWDOWN",
    relatedVariables: ["temperature"],
    chartCompanions: ["temperature"],
    label: "Radiação Solar",
    optionLabel: "Potencial Fotovoltaico",
    icon: "☀️",
    faIcon: "sun",
    unit: "W/m²",
    sourceId: "SWDOWN",
    summary:
      "Radiação solar incidente na superfície. A produção fotovoltaica exibida é uma estimativa calculada no frontend.",
    scaleMin: 0,
    scaleMax: 1200,
    colors: SHORTWAVE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined) {
        return unavailableInfo("Geração Fotovoltaica");
      }

      const airTemp = Number.isFinite(allValues.temperature?.value) ? allValues.temperature.value : 25;
      const panelEfficiency = getParameter("solar", "panelEfficiency", 18) / 100;
      const inversorEfficiency = getParameter("solar", "inversorEfficiency", 95) / 100;
      const ptc = getParameter("solar", "ptc", -0.38);
      const noct = getParameter("solar", "noct", 45);

      const nominalCellTemp = 25;
      const cellTemp = airTemp + ((noct - 20) * value) / 800;
      const energyGen =
        (value / 1000) * panelEfficiency * inversorEfficiency * (1 + (ptc * (cellTemp - nominalCellTemp)) / 100);

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
            value: (energyGen * 1000).toFixed(2),
            unit: "Wh/m²",
            icon: "fa-solar-panel",
            // Raw number for charts/CSV; `value` above is display-only.
            energyValue: energyGen * 1000,
          },
        ],
      };
    },
  },

  eolico: {
    id: "POT_EOLICO_50M",
    relatedVariables: ["temperature"],
    chartCompanions: ["temperature"],
    id_100m: "POT_EOLICO_100M",
    id_150m: "POT_EOLICO_150M",
    label: "Velocidade do Vento",
    optionLabel: "Potencial Eólico",
    icon: "💨",
    faIcon: "wind",
    unit: "m/s",
    sourceId: "POT_EOLICO_50M / POT_EOLICO_100M / POT_EOLICO_150M",
    summary:
      "Velocidade do vento interpolada para alturas de hub. A produção eólica é estimada no frontend a partir de parâmetros da turbina.",
    scaleMin: 0,
    scaleMax: 20,
    colors: WIND_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.eolico?.ausente) {
        return unavailableInfo("Geração Eólica");
      }

      const tempValue = Number.isFinite(allValues.temperature?.value) ? allValues.temperature.value : 15;

      const airDensity = getParameter("eolico", "airDensity", 1.225);
      const rotorDiameter = getParameter("eolico", "rotorDiameter", 40);
      const Cp = getParameter("eolico", "Cp", getParameter("eolico", "powerCoefficient", 0.4));

      const airDensityAtTemp = airDensity * (288 / (273 + tempValue));
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
            value: (0.5 * airDensityAtTemp * Math.pow(value, 3)).toFixed(0),
            unit: "W/m²",
            icon: "fa-fan",
          },
          {
            label: `Produção Energética Acumulada (1h)`,
            value: ((0.5 * airDensityAtTemp * Math.pow(value, 3) * rotorArea * Cp) / 1000).toFixed(1),
            unit: "kWh",
            icon: "fa-wind",
            // Raw number for charts/CSV; `value` above is display-only.
            energyValue: (0.5 * airDensityAtTemp * Math.pow(value, 3) * rotorArea * Cp) / 1000,
          },
        ],
      };
    },
  },

  temperature: {
    id: "TEMP",
    // Feels-like only knows how to use RELATIVE humidity.
    relatedVariables: ["relativeHumidity", "wind"],
    label: "Temperatura (2m)",
    optionLabel: "Temperatura",
    icon: "🌡️",
    faIcon: "thermometer",
    unit: "°C",
    sourceId: "TEMP",
    summary: "Temperatura do ar a 2 metros usada como referência meteorológica de superfície.",
    scaleMin: 10,
    scaleMax: 40,
    colors: THERMAL_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.temperature?.ausente) {
        return unavailableInfo("Informações Térmicas");
      }

      const humidityValue = Number.isFinite(allValues.relativeHumidity?.value)
        ? allValues.relativeHumidity.value
        : null;
      const windValue = Number.isFinite(allValues.wind?.value) ? allValues.wind.value : 2;

      const feelsLike = humidityValue === null ? value : getTemperatureFeelsLike(value, humidityValue, windValue);

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
        ],
      };
    },
  },

  skinTemperature: {
    id: "TSK",
    relatedVariables: ["temperature"],
    label: "Temperatura de Superfície",
    optionLabel: "Temperatura de Superfície",
    icon: "🌡️",
    faIcon: "temperature-high",
    unit: "°C",
    sourceId: "TSK",
    summary: "Temperatura da superfície do modelo, útil para contraste com a temperatura do ar a 2 metros.",
    scaleMin: 10,
    scaleMax: 50,
    colors: THERMAL_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.skinTemperature?.ausente) {
        return unavailableInfo("Temperatura de Superfície");
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
    faIcon: "cloud",
    unit: "hPa",
    sourceId: "PRES",
    summary: "Pressão atmosférica na superfície, exibida em hectopascal para leitura operacional.",
    // No scaleMin/scaleMax on purpose: the field is PSFC, over the terrain and
    // not reduced to sea level, so it drops to ~860 hPa on the Bahia plateau.
    // The scale comes from the per-domain `metadata.scale_values` the pipeline
    // publishes, constant across steps so the color bar does not wobble.
    colors: PRESSURE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.pressure?.ausente) {
        return unavailableInfo("Condições Atmosféricas");
      }

      // Nothing compares against 1013.25 hPa: that is sea level, so at a 1300 m
      // point the "departure" would be -130 hPa of altimetry and a high/low
      // classification would be a terrain detector.
      return {
        title: "Condições Atmosféricas",
        items: [
          {
            label: "Pressão na Superfície",
            value: value.toFixed(1),
            unit: "hPa",
            icon: "fa-cloud",
          },
          {
            label: "Referência",
            value: "Nível do terreno (PSFC)",
            // A ruler, not a mountain: the reference HEIGHT of the reading, and
            // no new glyph in the font subset (scripts/subset-fontawesome.md).
            icon: "fa-ruler-vertical",
          },
        ],
      };
    },
  },

  humidity: {
    id: "VAPOR",
    label: "Umidade Específica (2m)",
    optionLabel: "Umidade Específica",
    icon: "💧",
    faIcon: "droplet",
    unit: "g/kg",
    sourceId: "VAPOR",
    summary: "Conteúdo de vapor d'água do ar próximo à superfície, expresso em g/kg (derivado de Q2 do WRF).",
    scaleMin: 0,
    scaleMax: 25,
    colors: MOISTURE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.humidity?.ausente) {
        return unavailableInfo("Condições de Umidade");
      }

      return {
        title: "Umidade Específica",
        items: [
          {
            label: "Classificação",
            value: value > 18 ? "Alta" : value < 8 ? "Baixa" : "Moderada",
            icon: "fa-droplet",
          },
          {
            label: "Umidade Específica",
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
    faIcon: "droplet",
    unit: "%",
    sourceId: "RH2",
    summary:
      "Percentual de saturação do ar próximo à superfície, estimado a partir de temperatura, pressão e vapor d'água.",
    scaleMin: 0,
    scaleMax: 100,
    colors: MOISTURE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.relativeHumidity?.ausente) {
        return unavailableInfo("Umidade Relativa");
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
    faIcon: "cloud-rain",
    unit: "mm",
    sourceId: "RAIN",
    summary:
      "Precipitação acumulada no timestep do modelo, somada na janela escolhida (1h ou 3h). Células sem chuva (< 0,01 mm) não são pintadas.",
    scaleMin: 0,
    scaleMax: 30,
    // Below 0.01 mm WRF writes zeros over almost the whole grid.
    hideBelow: 0.01,
    accumulation: {
      title: "Acumulado:",
      defaultHours: 1,
      options: [
        {
          hours: 1,
          label: "1h",
          scaleMax: 30,
          variableLabel: "Precipitação (1h)",
        },
        {
          hours: 3,
          label: "3h",
          scaleMax: 60,
          variableLabel: "Precipitação acumulada (3h)",
        },
      ],
    },
    colors: RAIN_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.rain?.ausente) {
        return unavailableInfo("Previsão de Precipitação");
      }

      // The intensity bands are hourly, but the painted value is a window total.
      const hours = getAccumulationHours("rain", 1);
      const hourlyRate = value / hours;

      return {
        title: "Previsão de Precipitação",
        items: [
          {
            label: "Intensidade",
            value: hourlyRate < 0.01 ? "Sem chuva" : hourlyRate < 2.5 ? "Leve" : hourlyRate < 10 ? "Moderada" : "Forte",
            icon: "fa-cloud-rain",
          },
          {
            label: `Volume Acumulado (${hours}h)`,
            value: value.toFixed(2),
            unit: "mm",
            icon: "fa-water",
          },
          {
            // 5 mm is a VOLUME threshold, not a rate: hence the window in the label.
            label: `Impacto Agrícola (${hours}h)`,
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
    faIcon: "wind",
    unit: "m/s",
    sourceId: "WIND",
    summary: "Velocidade do vento a 10 metros calculada a partir das componentes U10 e V10.",
    scaleMin: 0,
    scaleMax: 15,
    colors: WIND_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.wind?.ausente) {
        return unavailableInfo("Informações do Vento");
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
    faIcon: "sun",
    unit: "W/m²",
    sourceId: "SWDOWN",
    summary: "Radiação solar de onda curta incidente na superfície. Não inclui cálculo fotovoltaico nesta página.",
    scaleMin: 0,
    scaleMax: 1200,
    colors: SHORTWAVE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.globalRadiation?.ausente) {
        return unavailableInfo("Radiação Global");
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
    faIcon: "moon",
    unit: "W/m²",
    sourceId: "GLW",
    summary: "Radiação de onda longa incidente na superfície, usada no balanço radiativo.",
    scaleMin: 250,
    scaleMax: 500,
    colors: LONGWAVE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.longwave?.ausente) {
        return unavailableInfo("Radiação de Onda Longa");
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

  // The upwelling fluxes are derived: LWUPB exists in no grid of the operational
  // run (RRTMG's bottom-of-atmosphere diagnostics are off), so the pipeline
  // rebuilds them from EMISS, TSK, ALBEDO and COSZEN.

  shortwaveUp: {
    id: "SWUP",
    label: "Onda Curta Refletida",
    optionLabel: "Onda Curta Refletida",
    icon: "🪞",
    faIcon: "arrow-up",
    unit: "W/m²",
    sourceId: "SWUP",
    summary: "Radiação solar refletida pela superfície (albedo x radiação incidente).",
    scaleMin: 0,
    scaleMax: 250,
    colors: SHORTWAVE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.shortwaveUp?.ausente) {
        return unavailableInfo("Onda Curta Refletida");
      }

      return {
        title: "Onda Curta Refletida",
        items: [
          {
            label: "Fluxo Refletido",
            value: value.toFixed(0),
            unit: "W/m²",
            icon: "fa-arrow-up",
          },
          {
            label: "Origem",
            value: "Albedo x onda curta incidente",
            icon: "fa-sun",
          },
        ],
      };
    },
  },

  netShortwave: {
    id: "SWNET",
    label: "Onda Curta Líquida",
    optionLabel: "Onda Curta Líquida",
    icon: "☀️",
    faIcon: "sun",
    unit: "W/m²",
    sourceId: "SWNET",
    summary: "Radiação solar efetivamente absorvida pela superfície.",
    scaleMin: 0,
    scaleMax: 900,
    colors: SHORTWAVE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.netShortwave?.ausente) {
        return unavailableInfo("Onda Curta Líquida");
      }

      return {
        title: "Onda Curta Líquida",
        items: [
          {
            label: "Fluxo Absorvido",
            value: value.toFixed(0),
            unit: "W/m²",
            icon: "fa-sun",
          },
          {
            label: "Convenção",
            value: "Positivo para baixo",
            icon: "fa-arrow-down",
          },
        ],
      };
    },
  },

  longwaveUp: {
    id: "LWUP",
    label: "Onda Longa Emitida",
    optionLabel: "Onda Longa Emitida",
    icon: "🌡️",
    faIcon: "arrow-up",
    unit: "W/m²",
    sourceId: "LWUP",
    summary: "Onda longa que deixa a superfície: emissão de corpo cinza mais a fração do céu refletida.",
    scaleMin: 300,
    scaleMax: 650,
    colors: LONGWAVE_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.longwaveUp?.ausente) {
        return unavailableInfo("Onda Longa Emitida");
      }

      return {
        title: "Onda Longa Emitida",
        items: [
          {
            label: "Fluxo Emergente",
            value: value.toFixed(0),
            unit: "W/m²",
            icon: "fa-arrow-up",
          },
          {
            label: "Origem",
            value: "ε·σ·T⁴ + (1−ε)·incidente",
            icon: "fa-flask",
          },
          {
            label: "Superfície",
            value: value > 500 ? "Muito aquecida" : value < 400 ? "Mais fria" : "Intermediária",
            icon: "fa-temperature-high",
          },
        ],
      };
    },
  },

  netLongwave: {
    id: "LWNET",
    label: "Onda Longa Líquida",
    optionLabel: "Onda Longa Líquida",
    icon: "🌙",
    faIcon: "moon",
    unit: "W/m²",
    sourceId: "LWNET",
    summary: "Saldo de onda longa na superfície; quase sempre negativo, pois a superfície perde mais do que recebe.",
    scaleMin: -200,
    scaleMax: 25,
    colors: fluxColorsAroundZero(-200, 25),
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.netLongwave?.ausente) {
        return unavailableInfo("Onda Longa Líquida");
      }

      return {
        title: "Onda Longa Líquida",
        items: [
          {
            label: "Saldo",
            value: value.toFixed(0),
            unit: "W/m²",
            icon: "fa-moon",
          },
          {
            label: "Balanço",
            value: value < 0 ? "Perda radiativa" : "Ganho radiativo",
            icon: "fa-scale-balanced",
          },
        ],
      };
    },
  },

  netRadiation: {
    id: "RNET",
    label: "Saldo de Radiação",
    optionLabel: "Saldo de Radiação",
    icon: "⚖️",
    faIcon: "scale-balanced",
    unit: "W/m²",
    sourceId: "RNET",
    summary:
      "Saldo de radiação de todas as ondas: a energia disponível para os fluxos de calor sensível, latente e no solo.",
    scaleMin: -150,
    scaleMax: 800,
    colors: fluxColorsAroundZero(-150, 800),
    relatedVariables: ["hfx", "lh"],
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.netRadiation?.ausente) {
        return unavailableInfo("Saldo de Radiação");
      }

      const items = [
        {
          label: "Saldo",
          value: value.toFixed(0),
          unit: "W/m²",
          icon: "fa-scale-balanced",
        },
        {
          label: "Período",
          value: value > 0 ? "Ganho (diurno)" : "Perda (noturno)",
          icon: value > 0 ? "fa-sun" : "fa-moon",
        },
      ];

      // Rn = H + LE + G: with H and LE shown, the soil/storage share is readable.
      const sensible = allValues.hfx?.value;
      const latent = allValues.lh?.value;
      if (typeof sensible === "number" && typeof latent === "number" && Math.abs(value) > 1) {
        items.push({
          label: "Repartição",
          value: `H ${sensible.toFixed(0)} · LE ${latent.toFixed(0)}`,
          unit: "W/m²",
          icon: "fa-fire",
        });
      }

      return { title: "Saldo de Radiação", items };
    },
  },

  skyEmissivity: {
    id: "EPS_SKY",
    label: "Emissividade do Céu",
    optionLabel: "Emissividade do Céu",
    icon: "☁️",
    faIcon: "cloud",
    unit: "",
    sourceId: "EPS_SKY",
    summary: "Emissividade efetiva do céu; sobe com umidade e nebulosidade, servindo de indicador de cobertura.",
    scaleMin: 0.6,
    scaleMax: 1,
    colors: EMISSIVITY_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.skyEmissivity?.ausente) {
        return unavailableInfo("Emissividade do Céu");
      }

      return {
        title: "Emissividade do Céu",
        items: [
          {
            label: "Emissividade",
            value: value.toFixed(2),
            unit: "",
            icon: "fa-cloud",
          },
          {
            label: "Céu",
            value: value > 0.9 ? "Encoberto/úmido" : value < 0.8 ? "Mais limpo" : "Intermediário",
            icon: "fa-cloud-sun",
          },
        ],
      };
    },
  },

  clearnessIndex: {
    id: "KT",
    label: "Índice de Transparência",
    optionLabel: "Índice de Transparência (kt)",
    icon: "🌤️",
    faIcon: "cloud-sun",
    unit: "",
    sourceId: "KT",
    summary:
      "Fração da radiação no topo da atmosfera que chega à superfície. Publicado apenas com o sol acima de 10° de elevação.",
    scaleMin: 0,
    scaleMax: 0.85,
    colors: CLEARNESS_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.clearnessIndex?.ausente) {
        return unavailableInfo("Índice de Transparência");
      }

      return {
        title: "Índice de Transparência",
        items: [
          {
            label: "kt",
            value: value.toFixed(2),
            unit: "",
            icon: "fa-cloud-sun",
          },
          {
            label: "Céu",
            value: value > 0.65 ? "Limpo" : value < 0.35 ? "Encoberto" : "Parcialmente nublado",
            icon: "fa-sun",
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
    faIcon: "fire",
    unit: "W/m²",
    sourceId: "HFX",
    summary: "Fluxo turbulento de calor sensível entre superfície e atmosfera.",
    scaleMin: -200,
    scaleMax: 600,
    colors: fluxColorsAroundZero(-200, 600),
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.hfx?.ausente) {
        return unavailableInfo("Fluxo de Calor Sensível");
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
    faIcon: "water",
    unit: "W/m²",
    sourceId: "LH",
    summary: "Fluxo turbulento de calor latente associado a evaporação e condensação.",
    scaleMin: -100,
    scaleMax: 700,
    colors: fluxColorsAroundZero(-100, 700),
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.lh?.ausente) {
        return unavailableInfo("Fluxo de Calor Latente");
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
    relatedVariables: ["wind"],
    chartCompanions: ["wind"],
    label: "Densidade de Potência Eólica (10m)",
    optionLabel: "Densidade Eólica 10m",
    icon: "💨",
    faIcon: "fan",
    unit: "W/m²",
    sourceId: "WIND_POWER_DENSITY_10M",
    summary: "Densidade de potência disponível no vento a 10 metros. Não é geração real de turbina.",
    scaleMin: 0,
    scaleMax: 1500,
    colors: WIND_COLORS,
    specificInfo: (value, allValues = {}) => {
      if (value === null || value === undefined || allValues.windPowerDensity?.ausente) {
        return unavailableInfo("Densidade de Potência Eólica");
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

function getTemperatureFeelsLike(temperatureC, humidity, windSpeedMs) {
  if (humidity >= 40) {
    const T = (temperatureC * 9) / 5 + 32;
    const RH = humidity;

    // The NWS pretest, not a fixed °C threshold, decides whether the Rothfusz
    // regression applies: it is only valid above ~80 °F.
    const simpleHI_F = 0.5 * (T + 61 + (T - 68) * 1.2 + RH * 0.094);

    if ((simpleHI_F + T) / 2 >= 80) {
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
  }

  if (temperatureC <= 10 && windSpeedMs >= 1.34) {
    // The wind-chill regression is stated in km/h.
    const windKmh = windSpeedMs * 3.6;

    return (
      13.12 + 0.6215 * temperatureC - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * temperatureC * Math.pow(windKmh, 0.16)
    );
  }

  return temperatureC;
}

window.VARIABLES_CONFIG = VARIABLES_CONFIG;
window.VARIABLE_CONTEXTS = VARIABLE_CONTEXTS;
