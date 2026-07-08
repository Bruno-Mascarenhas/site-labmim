# LabMiM Site Architecture

Este documento descreve a arquitetura atual do site LabMiM com base no estado real do repositório. Ele deve ser usado como referência para manutenção, evolução do WebGIS e prevenção de regressões.

## Visão Geral

O projeto é um site estático em `site/`, composto por HTML, CSS modular e JavaScript sem framework frontend. As páginas HTML são **geradas** a partir de fontes em `src/` por um passo de build local/CI (`build.js`, apenas stdlib do Node) que expande _partials_ compartilhados (head, navbar, footer, scripts) — o deploy continua sendo de arquivos estáticos puros, sem build no servidor. O WebGIS usa Leaflet com renderização em Canvas para exibir grades meteorológicas e potenciais energéticos, carregando dados WRF a partir de arquivos gerados em `GeoJSON/` e `JSON/`.

Não há backend de aplicação neste repositório. Qualquer atualização de dados depende de pipeline externo que gere os arquivos consumidos pelo frontend.

## Páginas HTML

| Arquivo                            | Função                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| `site/index.html`                  | Página inicial institucional                                |
| `site/monitoring.html`             | Monitoramento ambiental com gráficos PNG e modais Bootstrap |
| `site/team.html`                   | Equipe, links e localização incorporada                     |
| `site/climatologia.html`           | Página de climatologia em construção                        |
| `site/mapas_interativos.html`      | WebGIS de previsões meteorológicas                          |
| `site/potenciais_energeticos.html` | WebGIS de potencial fotovoltaico, potencial eólico e densidade eólica |
| `site/mapas_meteorologicos.html`   | Redirect de compatibilidade para `mapas_interativos.html`   |

Todas as páginas usam **Bootstrap 5.3.8 vendorizado localmente** (`assets/vendor/bootstrap/`); não há mais Bootstrap 4 nem jQuery no projeto. Leaflet e Chart.js também são carregados localmente (ver [Dependências Externas](#dependências-externas)).

A navbar principal segue a ordem: Previsões, Potenciais Energéticos, Monitoramento, Climatologia e Equipe. Essa ordem é definida **uma única vez** no array `NAV` de `build.js`, que gera tanto a navbar quanto o menu do rodapé; o item ativo vem do campo `active` da página em `PAGES`. Editar navbar/rodapé/`<head>` significa editar `src/partials/`, não `site/*.html`.

## Organização De Pastas

```text
build.js                            # gerador estático (src/ -> site/*.html), só stdlib do Node
src/                                # FONTE das páginas — edite aqui, nunca em site/*.html
├── layouts/
│   ├── institutional.html          # index, monitoring, team, climatologia
│   └── webgis.html                 # mapas_interativos, potenciais_energeticos
├── partials/
│   ├── head.html                   # <head> compartilhado
│   ├── nav.html                    # navbar (itens gerados do array NAV em build.js)
│   ├── footer.html                 # rodapé compartilhado
│   └── scripts.html                # Bootstrap bundle (fim do body)
└── pages/                          # conteúdo único de cada página (sem head/nav/footer)

site/                               # SAÍDA publicada (HTML gerado por build.js + assets)
├── .htaccess                       # charset, MIME, compressão e cache (Apache)
├── *.html                          # gerados por build.js (exceto mapas_meteorologicos.html)
├── assets/
│   ├── css/
│   │   ├── base.css
│   │   ├── layout.css
│   │   ├── components.css
│   │   ├── theme.css
│   │   └── maps.css
│   ├── js/
│   │   ├── theme-boot.js
│   │   ├── theme-toggle.js
│   │   ├── ui-shell.js
│   │   ├── variables-config.js
│   │   ├── data-service.js
│   │   ├── charts-manager.js
│   │   ├── map-manager.js
│   │   ├── map-init.js
│   │   └── workers/
│   │       ├── color-calc.worker.js
│   │       └── json-parser.worker.js
│   ├── vendor/                     # bibliotecas vendorizadas localmente
│   │   ├── bootstrap/              # Bootstrap 5.3.8 (min css + bundle js)
│   │   ├── leaflet/                # Leaflet 1.9.4 (js, css, images/)
│   │   └── chartjs/                # Chart.js 3.9.1
│   ├── data/
│   │   └── br_ba.json              # contorno da Bahia (recorte por estado)
│   ├── graphs/
│   ├── icon/
│   ├── img/
│   └── json/
├── GeoJSON/
└── JSON/
```

Observações:

- `assets/graphs/` contém PNGs usados em `monitoring.html`.
- `assets/img/` contém logos e imagens institucionais.
- `assets/icon/` contém ícones raster usados em menus.
- `assets/vendor/` contém bibliotecas de terceiros servidas localmente (Leaflet e Chart.js), evitando dependência de CDN no caminho crítico.
- `assets/data/br_ba.json` é o contorno da Bahia usado pelo recorte por estado; antes era buscado por CDN.
- `assets/json/` está reservado para manifestos opcionais; atualmente há apenas marcador de pasta.
- `GeoJSON/` e `JSON/` contêm dados gerados e ficam fora do controle de versão (`.gitignore`). O código atual carrega `GeoJSON/{domain}.geojson`.
- Não abra, varra, formate ou reprocesse `/data`; evite ler conteúdo de `GeoJSON/` e `JSON/` fora de depuração estritamente necessária, porque esses diretórios podem conter artefatos grandes do pipeline externo.

## CSS

### Responsabilidades

| Arquivo          | Responsabilidade                                                                    |
| ---------------- | ----------------------------------------------------------------------------------- |
| `base.css`       | Tokens CSS, reset, tipografia, utilitários pequenos, logos e cores base             |
| `layout.css`     | Navbar, seções de página, footer e estrutura compartilhada                          |
| `components.css` | Cards, parceiros, financiadores, blocos de explicação, monitoramento, modal helpers |
| `theme.css`      | Dark mode, overrides de tema, estados de controles, ajustes globais de contraste    |
| `maps.css`       | Layout e componentes exclusivos do WebGIS                                           |

### Padrões

- Use variáveis CSS em `:root` para cores, sombras, bordas e espaçamentos globais.
- Dark mode é controlado pela classe `.dark-theme` no elemento `<html>`.
- `maps.css` é carregado depois de `theme.css` nas páginas WebGIS; quando um estilo escuro precisa vencer regras do mapa, o override deve estar em `maps.css` ou ter especificidade compatível.
- Evite estilos inline. Crie classes reutilizáveis em `components.css` ou `maps.css`, conforme o escopo.
- Mantenha responsividade com media queries já existentes; não use escala tipográfica baseada diretamente em viewport.

## JavaScript

### Módulos Gerais

| Arquivo           | Responsabilidade                                                                       |
| ----------------- | -------------------------------------------------------------------------------------- |
| `theme-boot.js`   | Aplica `.dark-theme` cedo com base em `localStorage` ou preferência do sistema         |
| `theme-toggle.js` | Controla botões de tema, ícones, `aria-*`, persistência e evento `labmim-theme-change` |
| `ui-shell.js`     | Toggle genérico para pequenos blocos de UI em páginas institucionais                   |

### Módulos Do WebGIS

| Arquivo                         | Responsabilidade                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `variables-config.js`           | Define `VARIABLES_CONFIG`, `VARIABLE_CONTEXTS`, IDs de arquivo, unidades, palhetas e `specificInfo()` por variável |
| `data-service.js`               | Classe `LabmimDataService`; fetch/cache de JSON, dedup em voo, cache negativo e parsing em worker                  |
| `map-manager.js`                | Classe `MeteoMapManager`; estado do mapa, domínio, dados, renderização, controles e vento                          |
| `charts-manager.js`             | Classe `ChartsManager`; séries temporais, Chart.js, modal, cache e CSV                                             |
| `map-init.js`                   | Bootstrap do WebGIS; cria `MeteoMapManager`, cria `ChartsManager` e conecta sidebar/modal                          |
| `workers/color-calc.worker.js`  | Interpolação de cores fora da thread principal                                                                     |
| `workers/json-parser.worker.js` | Fetch/parse JSON em worker quando disponível                                                                       |

`MeteoMapManager`, `ChartsManager` e `LabmimDataService` são expostos em `window` para preservar compatibilidade do bootstrap atual.

### Ordem De Carregamento (páginas WebGIS)

No `<head>`: `theme-boot.js` (síncrono, para reduzir flash), `theme-toggle.js` e `ui-shell.js` (`defer`). Antes de `</body>`, todos com `defer` e nesta ordem: Bootstrap 5 (vendorizado), Chart.js (vendorizado), `variables-config.js`, `data-service.js`, `charts-manager.js`, `map-manager.js`, `map-init.js`. `leaflet.js` (vendorizado) também é carregado com `defer` no `<head>`. Scripts de aplicação usam versionamento por query (`?v=`).

## Dark Mode

Fluxo atual:

1. `theme-boot.js` roda no `<head>`.
2. Ele lê `localStorage.getItem("labmim-theme")`.
3. Se o valor for `dark`, ou se não houver valor e o sistema preferir dark, aplica `.dark-theme`.
4. `theme-toggle.js` inicializa no `DOMContentLoaded`, atualiza ícones e atributos acessíveis.
5. Ao alternar tema, `theme-toggle.js` salva `labmim-theme` e dispara `labmim-theme-change`.
6. `ChartsManager` escuta esse evento e chama `refreshChartTheme()`.

Cuidados:

- Não remova `theme-boot.js`; ele reduz flash visual antes do carregamento do JS deferido.
- Se criar novos componentes com fundo próprio em `maps.css`, crie também o equivalente para `.dark-theme` quando necessário.
- Valide títulos de modal/sidebar em dark mode, porque `maps.css` é carregado por último na página de mapas.

## Camada De Dados (`LabmimDataService`)

`data-service.js` centraliza todo o acesso a JSON do WebGIS. `MeteoMapManager` cria a instância em `this.dataService` e `MeteoMapManager._cachedFetch()` delega a ela; `ChartsManager._fetchHourJson()` também usa `app._cachedFetch`. O método público é `fetchJson(url, options)` (aceita `options.signal` para abort por chamador).

Responsabilidades:

- **Cache em memória** limitado por `DATA_SERVICE_CACHE_LIMIT` (evicção por ordem de inserção).
- **Deduplicação de requisições em voo**: chamadas concorrentes à mesma URL compartilham um único `fetch` + parse; um `signal` abortado afeta apenas aquele chamador, não o fetch compartilhado.
- **Cache negativo** por `DATA_SERVICE_FAILURE_TTL_MS` (60 s): uma URL que falhou não é re-requisitada dentro da janela — evita tempestade de requisições a cada tick de animação.
- **Parsing em Web Worker** (`json-parser.worker.js`) com _fallback_ transparente para a thread principal se o worker falhar ao carregar/rodar (o worker falha de forma assíncrona; o serviço trata `onerror`/`onmessageerror`, rejeita as chamadas pendentes e reencaminha para a main thread).
- **Distinção 404 vs falha transitória**: erros carregam `status`/`notFound`. Um recurso deterministicamente ausente (404/403/410) é sinalizado como `notFound` e tratado como lacuna esperada pelos consumidores; falhas transitórias (rede/5xx) são propagadas para que o cache de séries não seja preenchido com resultado incompleto. O worker repassa o `status` HTTP para a main thread.

## Arquitetura Dos Mapas Interativos

### Inicialização

`map-init.js` roda após `DOMContentLoaded`:

```js
app = new MeteoMapManager();
chartsManager = new ChartsManager(app);
app.chartsManager = chartsManager;
app.setupVariableOverview(chartsManager);
```

Depois ele envolve `app.showSidebar()`. O wrapper só abre o modal de séries temporais em **clique real** do usuário (`options.userInitiated === true`); refreshes programáticos (slider, troca de variável/altura/domínio) apenas atualizam os gráficos silenciosamente se o modal já estiver aberto (`chartsManager.isModalOpen()`), evitando reabrir o modal e disparar novas buscas.

### Estado Principal

`MeteoMapManager` lê `data-map-context` no `<body>` para separar os contextos `forecast` e `energy`. `mapas_interativos.html` inicia apenas com variáveis meteorológicas/radiativas; `potenciais_energeticos.html` inicia apenas com produtos energéticos.

`MeteoMapManager` mantém estado em `this.state`:

- `type`, `domain`, `index`, `maxLayer`
- `isPlaying`, `hasUserControlledPlayback`, `intervalId`
- `isClippedToState`, `stateAbbr`
- `initialDateTime`, `initialIndex`, `dateTimePattern`
- `selectedCell`

Campos de instância relevantes fora de `this.state`: `windHeight` (50/100/150), `currentValueData` e `_currentValueKey` (dados atuais e a chave `(domínio, variável, hora)` que eles representam), `_currentApply` (carga em voo), `gridLayers` (cache de grade por domínio) e `dataService`. Elementos de DOM usados com frequência são cacheados em `this.ui`.

O painel resumido "Sobre as variáveis" é controlado por `setupVariableOverview()`. Ele inicia com a classe `is-collapsed` para não ocupar a área do mapa no primeiro acesso, e só carrega a prévia visual quando o usuário expande o painel.

### Domínios

`DOMAIN_CONFIG` separa o ID técnico do label exibido. Os IDs técnicos continuam sendo usados nos nomes de arquivos, cache e estado:

- `D01` -> label `BA/NE`
- `D02` -> label `BA`
- `D03` -> label `RMS`
- `D04` -> label `SSA`

Os botões `.domain-btn` atualizam `this.state.domain` e recarregam dados. O cache de grade **não** é limpo na troca de domínio (nem de variável ou altura): a grade depende só do domínio, então `gridLayers` é reaproveitado. O domínio não troca automaticamente por zoom; a troca é manual.

### Carregamento De Dados

O fluxo principal é:

1. `applyMapChanges()` — trata a regra solar/noturna do `SWDOWN` e define `_currentApply`.
2. `loadValueData(index, type)`.
3. `getVariableId(type)` resolve o ID (para `eolico`, depende de `windHeight`).
4. `Promise.all([_cachedFetch(JSON/...), loadGridLayer(domain)])` — valor e grade em **paralelo**.
5. `_precomputeStateMask(gridLayer)` (dentro de `try/catch`; falha da máscara não apaga o mapa).
6. `applyValuesToGrid(gridLayer, valueData)` — cores via `color-calc.worker.js`.
7. `showGeoJsonLayer(gridLayer)` e `updateUIFromMetadata(metadata)`.

`_cachedFetch()` delega a `this.dataService.fetchJson()`; `loadGridLayer()` também busca a grade pelo `dataService` e mantém cache por domínio (`gridLayers`) com dedup de promessas em voo (`_gridLayerPromises`). Em falha de carga, `_clearCurrentData()` remove camada, dados e vetores de vento juntos, para o mapa nunca mostrar um frame anterior sob um rótulo de hora avançado.

Ao ler o valor de uma célula, `handleMapClick()` usa `currentValueData` (fonte da verdade) e verifica `_currentValueKey` contra a visão atual, aguardando a carga em voo correspondente quando necessário — assim a sidebar nunca mostra o valor de uma variável/hora sob o rótulo de outra durante trocas rápidas.

### Recorte Por Estado

`loadStateGeoJson(stateCode)` busca `assets/data/br_{state}.json` (local). `_precomputeStateMask()` marca cada célula com um _point-in-polygon_ local (`pointInGeoJsonFeature`, ray casting sobre Polygon/MultiPolygon) — o antigo Turf.js foi removido. O botão de recorte só aparece quando o contorno carrega; se falhar, o mapa renderiza sem recorte.

### Contratos De Dados

#### Grade

```text
GeoJSON/{domain}.geojson
```

```json
{
  "type": "FeatureCollection",
  "metadata": {},
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [] },
      "properties": { "linear_index": 0 }
    }
  ]
}
```

`linear_index` alinha célula e valor. `loadGridLayer()` monta um mapa `linear_index -> camada` (`_layersByLinearIndex`) usado por cores, clique e vetores de vento.

#### Valores

```text
JSON/{domain}_{variableId}_{hour:03d}.json
```

```json
{
  "metadata": {
    "scale_values": [0, 1, 2],
    "date_time": "01/01/2024 12:00:00"
  },
  "values": [0.5, 1.2, null]
}
```

`values[i]` é indexado por `linear_index`. Um valor `null` é legítimo (ex.: célula sem dado). `date_time` traz os **dígitos de horário local** (as saídas WRF já convertidas para UTC−03:00); `parseDateTime()` armazena esses dígitos nos campos UTC de um `Date`, de modo que são exibidos sem deslocamento e o rótulo do mapa/os gráficos os apresentam como horário local (UTC−03:00).

#### Vetores De Vento

```text
JSON/{domain}_WIND_VECTORS_{hour:03d}.json
```

Campos esperados: `downsampled_angles`, `downsampled_magnitudes`, `downsampled_linear_indices`. As setas são posicionadas resolvendo cada `linear_index` via `_layersByLinearIndex` (não por posição no array).

### Variáveis E Palhetas

As variáveis ficam em `VARIABLES_CONFIG`:

| Chave                | ID principal                | Observação                                             |
| -------------------- | --------------------------- | ------------------------------------------------------ |
| `globalRadiation`    | `SWDOWN`                    | Radiação Global no contexto de Previsões               |
| `solar`              | `SWDOWN`                    | Potencial Fotovoltaico no contexto energético          |
| `eolico`             | `POT_EOLICO_50M`            | Também define `id_100m`, `id_150m` e seletor de altura |
| `temperature`        | `TEMP`                      | Informações térmicas                                   |
| `skinTemperature`    | `TSK`                       | Temperatura de superfície                              |
| `pressure`           | `PRES`                      | Pressão atmosférica                                    |
| `humidity`           | `VAPOR`                     | Vapor d'Água / razão de mistura em `g/kg`              |
| `relativeHumidity`   | `RH2`                       | Umidade relativa em `%`                                |
| `rain`               | `RAIN`                      | Precipitação                                           |
| `wind`               | `WIND`                      | Vento a 10m                                            |
| `longwave`           | `GLW`                       | Radiação de onda longa incidente                       |
| `hfx`                | `HFX`                       | Calor sensível                                         |
| `lh`                 | `LH`                        | Calor latente                                          |
| `windPowerDensity`   | `WIND_POWER_DENSITY_10M`    | Densidade de potência eólica a 10m                     |

Cada entrada define ao menos `id`, `label`, `unit`, `colors` e `specificInfo(value, allValues)`. Algumas têm campos adicionais como `useDynamicScale`, `normalValue`, `scaleMin`/`scaleMax`, `id_100m` e `id_150m`.

> Nota sobre `specificInfo()`: quantidades físicas que podem valer `0` (temperatura, vento, radiação) usam guardas `Number.isFinite` em vez de `||`, para que um `0` legítimo não seja substituído por um valor padrão.

## Play/Pause E Loop Temporal

O controle principal é `#playPauseBtn`.

Fluxo:

- Clique chama `togglePlayPause()`.
- `setPlaybackState(true)` chama `startAnimation()`.
- `startAnimation()` cria `setInterval()` com `PLAYBACK_INTERVAL_MS`.
- A cada tick, incrementa `#layerSlider`, dispara evento `input` e carrega o novo horário.
- Ao passar de `maxLayer`, volta para `1`.
- Para `SWDOWN`, a lógica pula horários fora do intervalo solar e reinicia em `7`.

Não existe botão de loop separado na UI atual; o comportamento de loop é integrado à animação.

## Wind Layer Toggle

`windLayerToggle` é controlado por `updateWindLayerToggleVisibility(variableType)`:

- Visível quando `variableType === "eolico"` ou `variableType === "wind"`.
- Oculto nas demais variáveis.
- O checkbox `#windLayerCheckbox` chama `toggleWindLayer(isEnabled)`.
- Quando ativo, `renderWindVectors()` busca `JSON/{domain}_WIND_VECTORS_{hour}.json` e desenha setas no canvas `#windVectorCanvas`.

Cuidados:

- Não exibir a camada de vento para variáveis que não sejam vento/eólico sem revisar UX e performance.
- `clearWindVectors()` também invalida requisições pendentes por `_windRequestKey`.
- Em payload de vento vazio, o canvas é limpo (não deixa setas do horário anterior).

## Sidebar E Modal De Séries Temporais

Ao clicar em uma célula:

1. `handleMapClick(e, { userInitiated })` identifica a célula Leaflet e lê o valor de `currentValueData`.
2. Carrega valores auxiliares via `loadAllVariableValuesForCell()`.
3. Atualiza `this.state.selectedCell`.
4. Chama `showSidebar({ userInitiated })`.
5. `map-init.js` intercepta `showSidebar()` e, apenas em clique real, abre o modal persistente de séries temporais.

`ChartsManager`:

- Carrega a série por lotes (`_collectHourlySeries`, `BATCH_SIZE` 8 no resumo de domínio e 12 na série da célula).
- Usa `AbortController` para cancelar carregamentos anteriores.
- Mantém `timeSeriesCache` e `domainSummaryCache`, gravando apenas quando não houve falha **transitória** (um 404 estrutural, como horas noturnas de `SWDOWN`, não bloqueia o cache).
- Reutiliza instâncias Chart.js com `.update("none")`.
- Formata rótulos e CSV com `timeZone: "UTC"` para **preservar os dígitos de horário local** (UTC−03:00) das saídas WRF, consistente com o rótulo do mapa; datas de metadados são parseadas por `parseDateTime` do `MeteoMapManager` (seguro no Safari/WebKit).
- Exporta CSV com data, hora, latitude, longitude, domínio, variável e valores.

Para `solar` e `eolico`, o modal também exibe uma série derivada de energia.

## Componentes Compartilhados

- Navbar e footer: `layout.css`.
- Cards e seções institucionais: `components.css`.
- Parceiros e financiadores: classes `.partners-section`, `.partners-grid`, `.partner-logo`, `.sponsors-strip`.
- Toggle de explicação em `monitoring.html`: `ui-shell.js` via atributos `data-ui-toggle`.

## `.htaccess`

`site/.htaccess` configura o Apache com diretivas protegidas por `<IfModule>` (o site nunca deve retornar 500 se um módulo faltar):

- **MIME**: `application/json` para `.json` e `application/geo+json` para `.geojson`.
- **Compressão** (`mod_deflate` + `mod_filter`): HTML, CSS, JS, JSON, GeoJSON e SVG — o maior ganho de transferência, dado o tamanho dos payloads.
- **Cache-Control**:
  - `.json`/`.geojson` -> `no-cache` (armazenar, mas sempre revalidar): os nomes de arquivo de previsão são reutilizados a cada rodada do pipeline, então cópias antigas nunca podem ser servidas sem revalidação (304 barato via ETag/Last-Modified).
  - `.html` -> `no-cache`.
  - `.css`/`.js` -> cache curto com `stale-while-revalidate` (o app usa `?v=` para invalidação imediata).
  - imagens e fontes -> cache de 7 dias.

## Dependências Externas

Vendorizadas localmente (sem CDN no caminho crítico):

- Bootstrap 5.3.8 — `assets/vendor/bootstrap/` (`bootstrap.min.css` + `bootstrap.bundle.min.js` com `defer`), usado por **todas** as páginas.
- Font Awesome 6.4.0 — `assets/vendor/fontawesome/` (`css/all.min.css` + `webfonts/`).
- Leaflet 1.9.4 — `assets/vendor/leaflet/` (`leaflet.js` com `defer`).
- Chart.js 3.9.1 — `assets/vendor/chartjs/`.
- Contorno da Bahia — `assets/data/br_ba.json`.

Origem externa (fora do caminho crítico de CSS/JS):

- Tiles do mapa base via OpenStreetMap (dados do mapa, apenas nas páginas WebGIS).

> O Bootstrap foi **unificado em uma única versão vendorizada (5.3.8)**; Bootstrap 4, jQuery e Popper foram **removidos**. O Turf.js também já havia sido removido (máscara de recorte por estado substituída por _point-in-polygon_ local).

Dev tooling (em `package.json`, ver também `.nvmrc` = Node 24 LTS):

- ESLint 10.
- Stylelint 17 (+ `stylelint-config-standard` 40).
- Prettier 3.9.
- `build.js` — gerador estático de páginas (sem dependências; só a stdlib do Node).
- CI em `.github/workflows/ci.yml` (`build:check` + lint + format-check + `npm audit`); Dependabot em `.github/dependabot.yml`.

## Decisões Da Refatoração

- Header, footer, `<head>` e blocos de script foram extraídos para `src/partials/` e passaram a ser montados por `build.js`, eliminando a duplicação (e a divergência) entre páginas.
- O Bootstrap foi unificado em uma única versão vendorizada (5.3.8); as páginas institucionais migraram de Bootstrap 4 + jQuery para Bootstrap 5 (navbar `data-bs-*`, utilitários `ms/me/ps/pe`, badges `text-bg-*`, modais `btn-close`/`data-bs-*`).
- CSS antigo (`template.css`, `style.css`, `modern.css`, `custom-themes.css`) foi substituído por módulos menores e explícitos.
- Código legado de vídeos (`script-mapas.js`, `video.js`, `assets/video/`) foi removido.
- `mapas_meteorologicos.html` foi preservado como redirect de compatibilidade.
- Dark mode foi separado em bootstrap inicial (`theme-boot.js`) e controle interativo (`theme-toggle.js`).
- WebGIS mantém classes globais (`window.MeteoMapManager`, `window.ChartsManager`, `window.LabmimDataService`) para compatibilidade com o bootstrap atual.
- O acesso a dados foi extraído para `LabmimDataService` (cache, dedup em voo, cache negativo, worker com _fallback_) — primeiro passo da modularização de `map-manager.js`.
- Leaflet, Chart.js e o contorno da Bahia foram vendorizados; Turf.js foi removido em favor de _point-in-polygon_ local.
- O mapa usa Canvas renderer do Leaflet para reduzir custo de renderização de grades.
- A interpolação de cores pode rodar em worker e ignora respostas obsoletas por `requestId`, com _fallback_ para a thread principal.
- `site/.htaccess` adiciona compressão e política de cache adequada a dados que reusam nomes de arquivo.

## Pontos De Extensão

### Adicionar Página

1. Criar `src/pages/<nome>.html` com apenas o conteúdo único (sem head/nav/footer).
2. Adicionar uma entrada em `PAGES` no `build.js` (`file`, `layout`, `active`, `title`, `description` e, para mapas, `bodyAttrs`).
3. Se a página for um destino de navegação, adicionar uma entrada em `NAV` (aparece automaticamente na navbar e no rodapé de todas as páginas).
4. Rodar `make build` e commitar o `site/<nome>.html` gerado.

### Adicionar Variável

1. Garantir arquivos em `JSON/{domain}_{variableId}_{hour}.json`.
2. Adicionar entrada em `VARIABLES_CONFIG`.
3. Associar a variável ao contexto correto em `VARIABLE_CONTEXTS`.
4. Atualizar o fallback do `<select id="variableSelect">` nas páginas WebGIS, se necessário.
5. Definir palheta, unidade e `specificInfo()` (use `Number.isFinite` para quantidades que podem valer 0).
6. Validar sidebar, colorbar, séries temporais e dark mode.

### Alterar Palheta

Atualize `colors` da variável em `variables-config.js`. Para escalas comparáveis entre horários, prefira `scaleMin`/`scaleMax`; `metadata.scale_values` fica como fallback para variáveis sem escala fixa. Se a variável usa escala dinâmica, revise também `normalValue` e `useDynamicScale`.

### Alterar Layout Institucional

Use os módulos CSS compartilhados. Evite criar regras específicas no HTML.

### Evoluir O WebGIS

`map-manager.js` ainda concentra estado, eventos, cache de grade, renderização e sidebar. A extração de `data-service.js` foi o primeiro passo de modularização; os próximos candidatos naturais são separar a renderização da grade/vento e o controle de UI/sidebar em módulos próprios. Faça isso com testes manuais cuidadosos.

## Cuidados Para Evitar Regressões

- Preserve os IDs usados pelo JS nas páginas WebGIS: `map`, `layerSlider`, `playPauseBtn`, `variableSelect`, `windLayerToggle`, `windLayerCheckbox`, `windVectorCanvas`, `sidebar`, `sidebarContent`, `timeSeriesModal`, `chartCanvasValue`, `chartCanvasEnergy`.
- Não altere nomes de chaves em `VARIABLES_CONFIG` sem revisar dados, select HTML, gráficos e sidebar.
- Não renomeie os IDs técnicos `D01-D04`; eles fazem parte do contrato dos arquivos. Altere apenas labels públicos quando necessário.
- A variável `humidity` deve aparecer como Vapor d'Água / razão de mistura e usar unidade `g/kg`; `relativeHumidity` é a umidade relativa em `%`.
- Não remova `theme-boot.js` do `<head>`.
- Use `LabmimDataService` para buscar JSON; não introduza `fetch` direto que ignore cache/dedup/cache negativo.
- Ao atualizar uma biblioteca vendorizada, substitua o arquivo em `assets/vendor/` e incremente o `?v=` correspondente.
- Ao mexer em `maps.css`, valide light e dark mode.
- Ao mexer em `map-manager.js`, valide play/pause, troca de domínio, troca de variável, clique em célula e wind layer.
- Ao mexer em `charts-manager.js`, valide carregamento, cancelamento, troca de tema e exportação CSV.
- Não documente dados ou endpoints que não existam no código. Se um novo pipeline mudar contratos de arquivo, atualize este documento junto.

## Checklist De Validação

Use antes de merge/publicação:

- `make ci` (ou `npm run format:check`, `npm run lint:css`, `npm run lint:js`, `npm audit`).
- Servir `site/` por HTTP local (`make serve`).
- Abrir páginas institucionais em desktop e mobile.
- Alternar dark mode em cada página.
- Abrir `mapas_interativos.html` e confirmar que Potencial Fotovoltaico não aparece como previsão; `SWDOWN` deve aparecer como Radiação Global.
- Abrir `potenciais_energeticos.html` e confirmar que só aparecem Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Verificar se Leaflet renderiza (a partir do bundle local) e se não há erros no console.
- Trocar variáveis e domínios (a grade não deve recarregar do zero).
- Confirmar labels de domínio `BA/NE`, `BA`, `RMS` e `SSA` na UI, mantendo requisições internas com `D01-D04`.
- Testar play/pause até passar do final da escala temporal.
- Confirmar regra solar para horários noturnos.
- Ativar `windLayerToggle` em `wind` e `eolico`; confirmar que fica oculto nas demais variáveis.
- Clicar em uma célula e validar sidebar.
- Validar modal de séries temporais e exportação CSV.
```
