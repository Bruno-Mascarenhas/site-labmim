# LabMiM Site

Site estático do LabMiM - Laboratório de Micrometeorologia e Modelagem da UFBA. O projeto reúne páginas institucionais, visualização de gráficos de monitoramento ambiental e WebGIS para previsões meteorológicas e potenciais energéticos derivados de saídas do modelo WRF.

O site é servido como frontend estático: HTML, CSS e JavaScript no navegador, sem backend próprio neste repositório. Os mapas interativos carregam arquivos `GeoJSON/` e `JSON/` gerados por pipeline externo.

## Funcionalidades

- Página inicial institucional com resumo do LabMiM e parceiros.
- Página de monitoramento com gráficos PNG em cards e modais Bootstrap.
- Página de equipe com links de pesquisadores e localização incorporada.
- Página de climatologia atualmente em construção.
- WebGIS de previsões em `mapas_interativos.html` com variáveis meteorológicas.
- WebGIS de potenciais energéticos em `potenciais_energeticos.html` com potencial fotovoltaico, potencial eólico e densidade eólica.
- Leaflet, domínios WRF, palhetas por variável, animação temporal, recorte por estado quando disponível, camada de vento e séries temporais em modal.
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
    ├── potenciais_energeticos.html
    ├── mapas_meteorologicos.html
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

`site/GeoJSON/` e `site/JSON/` são dados gerados. O código atual busca principalmente `GeoJSON/{domain}.geojson`, `JSON/{domain}_{variableId}_{hour}.json` e `JSON/{domain}_WIND_VECTORS_{hour}.json`. Não abra, formate ou reprocesse `/data`, `site/JSON/` ou `site/GeoJSON/` durante manutenção comum; esses diretórios podem conter dados grandes gerados por pipeline externo.

## Como Executar Localmente

Não abra as páginas direto por `file://`. Os mapas e workers dependem de `fetch`, então use um servidor HTTP local.

```bash
cd site
python -m http.server 8000
```

Acesse:

- `http://localhost:8000/`
- `http://localhost:8000/mapas_interativos.html`
- `http://localhost:8000/potenciais_energeticos.html`

Se a porta 8000 estiver ocupada:

```bash
python -m http.server 8100
```

## Dependências Externas Em Runtime

As páginas carregam bibliotecas por CDN:

- Bootstrap 4.1.3 nas páginas institucionais.
- Bootstrap 5.3.0 em `mapas_interativos.html` e `potenciais_energeticos.html`.
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
- `site/mapas_interativos.html`: WebGIS de previsões meteorológicas.
- `site/potenciais_energeticos.html`: WebGIS de potenciais fotovoltaico, eólico e densidade eólica.
- `site/mapas_meteorologicos.html`: compatibilidade, redireciona para `mapas_interativos.html`.

## Mapas Interativos

O WebGIS é inicializado por `map-init.js`, que cria `MeteoMapManager` e `ChartsManager`.

Navbar principal: Previsões, Potenciais Energéticos, Monitoramento, Climatologia e Equipe.

Principais recursos:

- Domínios com labels públicos `BA/NE`, `BA`, `RMS` e `SSA`; os IDs técnicos continuam `D01`, `D02`, `D03` e `D04` para arquivos, cache e estado interno.
- Variáveis de Previsões configuradas em `VARIABLE_CONTEXTS.forecast`: `wind`, `temperature`, `skinTemperature`, `pressure`, `humidity`, `relativeHumidity`, `rain`, `globalRadiation`, `longwave`, `hfx` e `lh`.
- Variáveis de Potenciais Energéticos configuradas em `VARIABLE_CONTEXTS.energy`: `solar`, `eolico` e `windPowerDensity`.
- `humidity` representa Vapor d'Água / razão de mistura em `g/kg`; `relativeHumidity` representa RH2 em `%`.
- `SWDOWN` aparece em dois contextos: `globalRadiation` como Radiação Global em Previsões, e `solar` como Potencial Fotovoltaico em Potenciais Energéticos.
- Palhetas e escalas ficam em `VARIABLES_CONFIG`; as variáveis principais usam limites fixos (`scaleMin`/`scaleMax`) para manter cores comparáveis entre horários.
- Slider temporal com animação play/pause.
- Tratamento especial para `SWDOWN`, pulando horários noturnos na animação quando não há produto solar disponível.
- `windLayerToggle` visível apenas para variáveis de vento (`wind` e `eolico`).
- Séries temporais no modal `timeSeriesModal`, com exportação CSV.
- O painel "Sobre as variáveis" inicia minimizado e pode ser expandido pelo usuário para ver cards e prévias leves.
- A aba "Variáveis" da documentação dos mapas usa seções expansíveis com fórmulas e limitações por variável.

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
- Para adicionar uma variável ao mapa, atualize `variables-config.js`, o contexto em `VARIABLE_CONTEXTS` e o fallback do `<select id="variableSelect">` nas páginas WebGIS.
- Para lógica de mapa, prefira métodos em `MeteoMapManager` e preserve a API global exposta em `window.MeteoMapManager`.
- Para gráficos temporais, altere `ChartsManager` e preserve os IDs usados no modal.

## Checklist Manual Rápido

Antes de publicar:

- Abrir `index.html`, `monitoring.html`, `team.html` e `climatologia.html` em light e dark mode.
- Abrir `mapas_interativos.html` e verificar se o mapa Leaflet renderiza apenas variáveis meteorológicas/radiativas, incluindo Radiação Global.
- Abrir `potenciais_energeticos.html` e verificar se o mapa renderiza apenas Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Testar troca de variável.
- Testar botões de domínio `BA/NE`, `BA`, `RMS` e `SSA`, confirmando que as requisições continuam usando IDs técnicos `D01-D04`.
- Testar play/pause do slider temporal.
- Confirmar que `windLayerToggle` aparece em `wind`/`eolico` e não aparece nas demais variáveis.
- Clicar em uma célula do mapa e verificar sidebar e modal de série temporal.
- Alternar dark mode com modal aberto e verificar gráficos/títulos.
- Conferir responsividade em largura mobile.
- Verificar console do navegador sem erros.

## Notas Para Futuros Desenvolvedores

- Este repositório não contém o pipeline que gera os dados WRF; ele apenas consome os arquivos já publicados em `site/GeoJSON/` e `site/JSON/`.
- Não abra, varra, formate ou reprocesse `/data`; evite também ler conteúdo de `site/JSON/` e `site/GeoJSON/` fora de depuração estritamente necessária.
- Evite estilos inline em HTML. Use os módulos CSS existentes.
- Evite adicionar dependências de build para o runtime do site; hoje ele funciona como site estático.
- A documentação técnica detalhada fica em [Architecture.md](Architecture.md).
