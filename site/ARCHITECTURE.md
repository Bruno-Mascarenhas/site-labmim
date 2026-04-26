# LabMiM — Site Architecture

## Folder Structure

```
site/
├── index.html                    ← Homepage
├── mapas_interativos.html        ← Interactive maps (Leaflet + Canvas) — PRIMARY
├── mapas_meteorologicos.html     ← Compatibility redirect to interactive maps
├── monitoring.html               ← Environmental monitoring
├── climatologia.html             ← Climatology
├── team.html                     ← Team page
│
├── assets/                       ← All static resources
│   ├── css/
│   │   ├── base.css              ← Variables, reset, utilities, base typography
│   │   ├── layout.css            ← Navbar, page shells, footer
│   │   ├── components.css        ← Cards, partners, monitoring, modal helpers
│   │   ├── theme.css             ← Light/dark theme overrides and variable accents
│   │   └── maps.css              ← Interactive maps styles
│   ├── js/
│   │   ├── map-manager.js        ← MeteoMapManager class
│   │   ├── map-init.js           ← Map bootstrapping
│   │   ├── variables-config.js   ← Variable definitions & calculations
│   │   ├── charts-manager.js     ← Time-series chart rendering
│   │   ├── theme-boot.js         ← Early theme class bootstrap
│   │   ├── theme-toggle.js       ← Theme button/controller
│   │   ├── ui-shell.js           ← Small page-level UI interactions
│   │   └── workers/
│   │       ├── color-calc.worker.js   ← Web Worker: color interpolation
│   │       └── json-parser.worker.js  ← Web Worker: JSON fetch+parse
│   ├── img/                      ← Logos, covers, partner images
│   ├── icon/                     ← Variable icons
│   ├── graphs/                   ← PNGs (monitoring)
│   └── json/                     ← Optional generated manifests
│
├── GeoJSON/                      ← Pipeline-generated grid geometry
│   ├── D01.geojson
│   ├── D02.geojson
│   ├── D03.geojson
│   └── D04.geojson
│
└── JSON/                         ← Pipeline-generated value data
    ├── D01_TEMP_001.json
    ├── D01_WIND_VECTORS_001.json ← Standalone wind arrow overlays
    └── ...
```

## Data Flow

```
WRF Model (NetCDF)
    │
    ├─ labmim-wrf-geojson  (Python CLI) ── PRIMARY
    │   ├─ GeoJSON/D0X.geojson           ← 1 per domain (grid geometry)
    │   ├─ JSON/D0X_VAR_NNN.json         ← 1 per domain×variable×timestep
    │   └─ JSON/D0X_WIND_VECTORS_NNN.json ← 1 per domain×timestep (wind arrows)
    │
    └─ labmim-wrf-figures  (Python CLI) ── retired frontend path
        └─ static video animations are no longer shipped by this site
```

## Data Contract

### GeoJSON (`GeoJSON/{domain}.geojson`)

One file per WRF domain. Contains the grid geometry (identical across all variables).

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "resolucao_m": [27000, 27000]
  },
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[lon1,lat1], [lon2,lat2], ...]]
      },
      "properties": {
        "linear_index": 0
      }
    }
  ]
}
```

**Key decisions:**
- Coordinates use **10 decimal places** (~0.01 mm precision)
- `colormap` was removed — it's now in `VARIABLES_CONFIG` (frontend)
- Compact JSON (no whitespace/indent)

### Values JSON (`JSON/{domain}_{variable}_{timestep:03d}.json`)

One file per domain × variable × timestep. Contains flat array of values indexed by `linear_index`.

```json
{
  "metadata": {
    "scale_values": [20.0, 22.0, 24.0, 26.0, 28.0, 30.0],
    "date_time": "01/01/2024 12:00:00",
    "wind": { ... }  // optional, only for eolico variables
  },
  "values": [23.45, 24.12, null, ...]
}
```

**Key decisions:**
- Values rounded to **2 decimal places**
- Compact JSON (no whitespace/indent)
- `null` for missing data

### Wind Vectors JSON (`JSON/{domain}_WIND_VECTORS_{timestep:03d}.json`)

One file per domain × timestep. Standalone wind arrow overlay usable with **any** variable.

```json
{
  "metadata": {"date_time": "01/01/2024 12:00:00"},
  "downsampled_angles": [258.1, 239.7, ...],
  "downsampled_magnitudes": [3.45, 4.12, ...],
  "downsampled_linear_indices": [0, 4, 8, ...]
}
```

**Key decisions:**
- Uses surface U10/V10 (10m wind), always available
- Downsampled with stride=4 for visual clarity
- Angles rounded to 1 decimal, magnitudes to 2 decimals
- Separate from variable JSONs to avoid payload bloat

## Interactive Variables

| Key | Variable ID | Label | Wind Arrows |
|---|---|---|---|
| `solar` | `SWDOWN` | Potencial Fotovoltaico | via WIND_VECTORS |
| `eolico` | `POT_EOLICO_*M` | Potencial Eólico | embedded + height-interpolated |
| `wind` | `WIND` | Vento (10m) | via WIND_VECTORS |
| `temperature` | `TEMP` | Temperatura | via WIND_VECTORS |
| `pressure` | `PRES` | Pressão Atmosférica | via WIND_VECTORS |
| `humidity` | `VAPOR` | Umidade Relativa | via WIND_VECTORS |
| `rain` | `RAIN` | Precipitação | via WIND_VECTORS |
| `hfx` | `HFX` | Calor Sensível | via WIND_VECTORS |
| `lh` | `LH` | Calor Latente | via WIND_VECTORS |

## Module Map

| File | Purpose | Size |
|---|---|---|
| `mapas_interativos.html` | Interactive map structure and data UI | ~22 KB |
| `assets/css/base.css` | Variables, reset, shared utilities and base typography | ~3 KB |
| `assets/css/layout.css` | Navbar, page shell and shared footer layout | ~3 KB |
| `assets/css/components.css` | Reusable cards, partner blocks, monitoring helpers and chart modal helpers | ~9 KB |
| `assets/css/theme.css` | Light/dark theme overrides and variable accents | ~10 KB |
| `assets/css/maps.css` | All map-specific styles | ~36 KB |
| `assets/js/map-manager.js` | `MeteoMapManager` class — core map logic | ~55 KB |
| `assets/js/map-init.js` | Bootstrap code — creates app + charts manager | ~2 KB |
| `assets/js/variables-config.js` | `VARIABLES_CONFIG` — variable definitions, scales, calculations | ~17 KB |
| `assets/js/charts-manager.js` | `ChartsManager` — Persistent modal time-series charts | ~20 KB |
| `assets/js/theme-boot.js` | Early theme class bootstrap to avoid dark-mode flash | <1 KB |
| `assets/js/theme-toggle.js` | Theme toggle controller and theme-change event dispatch | ~2 KB |
| `assets/js/ui-shell.js` | Generic small UI toggles used by content pages | ~1 KB |
| `assets/js/workers/color-calc.worker.js` | Web Worker — offloads color interpolation | ~2 KB |
| `assets/js/workers/json-parser.worker.js` | Web Worker — offloads JSON fetch+parse | ~1 KB |

> Note: Legacy scripts (`script.js`, `script-leal.js`, `script-mapas.js`, and `video.js`) were removed to eliminate unused jQuery-era paths and static video dependencies.

## Performance Optimizations

### Backend (Python pipeline)
1. **1 GeoJSON per domain** — eliminates 32 duplicate files (36 → 4)
2. **10 decimal precision** — reduced coordinate size
3. **Compact JSON** — no indent/whitespace (~40% smaller)
4. **Vectorized value serialization** — `np.round().ravel().tolist()` instead of Python for-loops
5. **`np.hypot`** — C-optimized wind speed computation
6. **Standalone wind vectors** — avoid duplicating wind data across all variable files

### Frontend
1. **O(1) Generic State Masking** — The map precomputes a `_inStateMask` boolean the moment a Domain loads. Toggling the clipping mask updates `opacity: 0` in single-digit milliseconds instead of running heavy `turf.js` intersection arrays.
2. **Global DOM Cache (`this.ui`)** — Repetitive `document.getElementById` queries are cached on initialization, freeing the animation loops from garbage collection pauses.
3. **Manual domain switching** — user clicks D01/D02/D03/D04 buttons; zoom doesn't auto-switch
4. **In-memory JSON cache** (`_jsonCache`) — avoids re-downloading on variable switch
5. **Slider debounce** (100ms) — prevents avalanche of requests during drag
6. **Domain-only grid caching** — shared across all variables
7. **Robust Time-Series Modal** — `ChartsManager` uses `AbortController` to cancel stale requests and persists `Chart.js` instances via `.update()` instead of `.destroy()`.
8. **Web Workers** — offload color computation and JSON parsing to separate threads
9. **`<script defer>`** for CDNs — unblocks HTML parser
10. **`requestAnimationFrame` batching** — prevents DOM thrashing during grid updates
11. **Canvas renderer** — Leaflet uses `<canvas>` instead of SVG for grid
12. **Retired static video payloads** — removes ~9 MB of unused `.webm` assets from the active site.

## Adding a New Variable

### 1. Python pipeline

In `src/labmim_micrometeorology/common/types.py`:
- Add entry to `WRFVariable` enum
- Add entry to `VARIABLE_COLORMAPS`
- Add entry to `VARIABLE_NETCDF_MAP`

In `src/labmim_micrometeorology/cli/process_wrf_geojson.py`:
- Add handling in `_build_json_tasks_for_domain()` (or use the generic `else` branch)
- No GeoJSON changes needed — grid is shared

### 2. Frontend

In `assets/js/variables-config.js`:
- Add entry to `VARIABLES_CONFIG` with: `id`, `colors`, `unit`, `label`, `specificInfo()`

In `mapas_interativos.html`:
- Add `<option>` to the variable selector dropdown

### 3. Shell pipeline

No changes needed to `processa_wrf_04_python.sh` — just pass the new variable name with `-v`.

## Code Quality Standards

The frontend enforces strict quality standards through a modern Node.js tooling chain (defined in the root directory, outside of `site/`):
- **ESLint 9 (Flat Config):** Static analysis for JavaScript, enforcing strict globals (`Chart`, `L`, `turf`).
- **Stylelint:** Enforces CSS formatting, preventing duplicate properties and invalid syntax.
- **Prettier:** Automated formatting for all HTML, CSS, and JS files.
- **GitHub Actions:** CI pipeline runs all linting checks automatically on every commit.

Internal identifiers and development comments strictly use professional English, while user-facing UI labels and locale-specific metadata use Portuguese.
