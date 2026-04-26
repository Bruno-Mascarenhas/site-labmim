# LabMiM Site

Site estático do LabMiM - Laboratório de Micrometeorologia e Modelagem da UFBA. O projeto reúne páginas institucionais, visualização de gráficos de monitoramento ambiental e um WebGIS para previsões meteorológicas geradas a partir de saídas do modelo WRF.

O site é servido como frontend estático: HTML, CSS e JavaScript no navegador, sem backend próprio neste repositório. Os mapas interativos carregam arquivos `GeoJSON/` e `JSON/` gerados por pipeline externo.

## Funcionalidades

- Página inicial institucional com resumo do LabMiM e parceiros.
- Página de monitoramento com gráficos PNG em cards e modais Bootstrap.
- Página de equipe com links de pesquisadores e localização incorporada.
- Página de climatologia atualmente em construção.
- WebGIS em `mapas_interativos.html` com Leaflet, domínios WRF, palhetas por variável, animação temporal, recorte por estado quando disponível, camada de vento e séries temporais em modal.
- Dark mode persistente em `localStorage`, com sincronização para gráficos via evento `labmim-theme-change`.

## Estrutura Do Repositório

```text
.
├── README.md
├── Architecture.md
├── package.json
├── eslint.config.mjs
├── Makefile
└── site/
    ├── index.html
    ├── monitoring.html
    ├── team.html
    ├── climatologia.html
    ├── mapas_interativos.html
    ├── mapas_meteorologicos.html
    ├── ARCHITECTURE.md
    ├── GeoJSON/
    ├── JSON/
    └── assets/
        ├── css/
        │   ├── base.css
        │   ├── layout.css
        │   ├── components.css
        │   ├── theme.css
        │   └── maps.css
        ├── js/
        │   ├── theme-boot.js
        │   ├── theme-toggle.js
        │   ├── ui-shell.js
        │   ├── variables-config.js
        │   ├── charts-manager.js
        │   ├── map-manager.js
        │   ├── map-init.js
        │   └── workers/
        ├── graphs/
        ├── icon/
        ├── img/
        └── json/
```

`site/GeoJSON/` e `site/JSON/` são dados gerados. O código atual busca principalmente `GeoJSON/{domain}.geojson`, `JSON/{domain}_{variableId}_{hour}.json` e `JSON/{domain}_WIND_VECTORS_{hour}.json`.

## Como Executar Localmente

Não abra as páginas direto por `file://`. Os mapas e workers dependem de `fetch`, então use um servidor HTTP local.

```bash
cd site
python -m http.server 8000
```

Acesse:

- `http://localhost:8000/`
- `http://localhost:8000/mapas_interativos.html`

Se a porta 8000 estiver ocupada:

```bash
python -m http.server 8100
```

## Dependências Externas Em Runtime

As páginas carregam bibliotecas por CDN:

- Bootstrap 4.1.3 nas páginas institucionais.
- Bootstrap 5.3.0 em `mapas_interativos.html`.
- Font Awesome 6.4.0.
- Leaflet 1.9.4 no WebGIS.
- Turf 6 no WebGIS, usado por lógica geográfica.
- Chart.js 3.9.1 para séries temporais em modal.

As ferramentas de desenvolvimento são Node.js, ESLint, Stylelint e Prettier, declaradas em `package.json`.

## Desenvolvimento

Instale as dependências:

```bash
npm ci
```

Comandos úteis:

```bash
npm run lint:js
npm run lint:css
npm run format:check
npm run format
```

Também há atalhos no `Makefile`:

```bash
make lint
make format-check
make ci
```

## Páginas Principais

- `site/index.html`: página inicial.
- `site/monitoring.html`: monitoramento ambiental com gráficos e financiadores.
- `site/team.html`: equipe e localização.
- `site/climatologia.html`: página em construção.
- `site/mapas_interativos.html`: WebGIS principal.
- `site/mapas_meteorologicos.html`: compatibilidade, redireciona para `mapas_interativos.html`.

## Mapas Interativos

O WebGIS é inicializado por `map-init.js`, que cria `MeteoMapManager` e `ChartsManager`.

Principais recursos:

- Domínios `D01`, `D02`, `D03` e `D04`.
- Variáveis configuradas em `VARIABLES_CONFIG`: `solar`, `eolico`, `temperature`, `pressure`, `humidity`, `rain`, `wind`, `hfx` e `lh`.
- Palhetas de cores por variável e escala dinâmica para variáveis configuradas com `useDynamicScale`.
- Slider temporal com animação play/pause.
- Tratamento especial para `SWDOWN`, pulando horários noturnos na animação.
- `windLayerToggle` visível apenas para variáveis de vento (`wind` e `eolico`).
- Séries temporais no modal `timeSeriesModal`, com exportação CSV.

## Dark Mode

O dark mode é dividido em dois passos:

- `theme-boot.js` roda cedo e aplica `.dark-theme` antes do carregamento completo, reduzindo flash visual.
- `theme-toggle.js` controla os botões de tema, persiste `labmim-theme` em `localStorage` e emite `labmim-theme-change`.

`charts-manager.js` escuta `labmim-theme-change` para atualizar cores dos gráficos sem recriar toda a UI.

## Manutenção

- Para alterar cores, espaçamentos globais e tokens, comece por `assets/css/base.css`.
- Para navbar, footer e estrutura de página, use `assets/css/layout.css`.
- Para cards, parceiros, financiadores, modais e blocos reutilizáveis, use `assets/css/components.css`.
- Para dark mode e variações de tema, use `assets/css/theme.css`.
- Para estilos exclusivos do WebGIS, use `assets/css/maps.css`.
- Para adicionar uma variável ao mapa, atualize `variables-config.js` e o `<select id="variableSelect">` em `mapas_interativos.html`.
- Para lógica de mapa, prefira métodos em `MeteoMapManager` e preserve a API global exposta em `window.MeteoMapManager`.
- Para gráficos temporais, altere `ChartsManager` e preserve os IDs usados no modal.

## Checklist Manual Rápido

Antes de publicar:

- Abrir `index.html`, `monitoring.html`, `team.html` e `climatologia.html` em light e dark mode.
- Abrir `mapas_interativos.html` e verificar se o mapa Leaflet renderiza.
- Testar troca de variável.
- Testar botões de domínio `D01-D04`.
- Testar play/pause do slider temporal.
- Confirmar que `windLayerToggle` aparece em `wind`/`eolico` e não aparece nas demais variáveis.
- Clicar em uma célula do mapa e verificar sidebar e modal de série temporal.
- Alternar dark mode com modal aberto e verificar gráficos/títulos.
- Conferir responsividade em largura mobile.
- Verificar console do navegador sem erros.

## Notas Para Futuros Desenvolvedores

- Este repositório não contém o pipeline que gera os dados WRF; ele apenas consome os arquivos já publicados em `site/GeoJSON/` e `site/JSON/`.
- Evite estilos inline em HTML. Use os módulos CSS existentes.
- Evite adicionar dependências de build para o runtime do site; hoje ele funciona como site estático.
- A documentação técnica detalhada fica em [Architecture.md](Architecture.md).
