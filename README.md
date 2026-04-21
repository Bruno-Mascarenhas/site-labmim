# LabMiM WebGIS Interactive Frontend

This directory contains the source code for the LabMiM static website and interactive meteorological maps. It is designed to be a high-performance, completely serverless Single Page Application (SPA) that reads output directly from the `labmim-wrf-geojson` data pipeline.

## Serving Locally

Because the interactive maps rely on loading external `JSON` and `GeoJSON` files, they cannot be opened directly from the filesystem (`file://` protocol) due to browser CORS restrictions. 

To run the site locally for development, start a basic HTTP server:

```bash
cd site/
python -m http.server 8000
```
Then navigate to [http://localhost:8000](http://localhost:8000).

## Architecture

The frontend is built with:
*   **Vanilla JS (ES6+)**: Zero dependencies on jQuery or heavyweight frameworks.
*   **Leaflet.js & Canvas**: Used for high-speed rendering of grid cells and map tiles.
*   **Web Workers**: Offloads JSON parsing and color interpolations to prevent UI freezing.
*   **Bootstrap 5**: Core UI templating.

> 📘 **For in-depth technical details on the rendering pipeline, layer caching, clipping logic, and file schemas, read [ARCHITECTURE.md](site/ARCHITECTURE.md).**

## Development and Code Quality

The repository uses modern frontend tooling to enforce code quality and formatting. Node.js is required.

1. Install dependencies from the root directory:
   ```bash
   npm ci
   ```
2. Run ESLint (Flat Config) for JavaScript analysis:
   ```bash
   npm run lint:js
   ```
3. Run Stylelint for CSS validation:
   ```bash
   npm run lint:css
   ```
4. Format all code files automatically with Prettier:
   ```bash
   npm run format
   ```

A GitHub Actions CI workflow automatically runs these validation checks on every push and pull request.
