# LabMiM Site Architecture

Este documento descreve a arquitetura atual do site LabMiM com base no estado real do repositório. Ele deve ser usado como referência para manutenção, evolução do WebGIS e prevenção de regressões.

## Visão Geral

O projeto é um site estático em `site/`, composto por HTML, CSS modular e JavaScript sem framework frontend. As páginas HTML são **geradas** a partir de fontes em `src/` por um passo de build local/CI (`build.js`, apenas stdlib do Node) que expande _partials_ compartilhados, gera o bloco de SEO por página e carimba hashes de conteúdo nos assets — o deploy continua sendo de arquivos estáticos puros, sem build no servidor. O WebGIS usa Leaflet com renderização em Canvas para exibir grades meteorológicas e potenciais energéticos, carregando dados WRF a partir de arquivos gerados em `GeoJSON/` e `JSON/`.

Não há backend de aplicação neste repositório. Os dados são gerados pelo pipeline do repositório irmão [micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) (CLI `labmim-wrf-geojson`) e publicados de forma desacoplada do site; por isso todo contrato de dados tem fallback no cliente.

## Páginas HTML

| Arquivo                            | Função                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| `site/index.html`                  | Página inicial institucional                                          |
| `site/monitoring.html`             | Monitoramento ambiental com gráficos PNG e modais Bootstrap           |
| `site/team.html`                   | Equipe, links e localização incorporada (iframe Google My Maps)       |
| `site/climatologia.html`           | Página de climatologia em construção                                  |
| `site/mapas_interativos.html`      | WebGIS de previsões meteorológicas                                    |
| `site/potenciais_energeticos.html` | WebGIS de potencial fotovoltaico, potencial eólico e densidade eólica |
| `site/mapas_meteorologicos.html`   | Redirect de compatibilidade (301 no `.htaccess` + meta-refresh)       |
| `site/404.html`                    | Página de erro standalone (caminhos absolutos, `ErrorDocument 404`)   |

As seis primeiras são geradas por `build.js`; `mapas_meteorologicos.html` e `404.html` são mantidas à mão (o 404 usa caminhos absolutos `/assets/...` para resolver em qualquer profundidade de URL, por isso não passa pelo build — e carrega o `bootstrap.min.css` completo, não o purgado).

Todas as páginas usam **Bootstrap 5.3.8 vendorizado localmente**; as páginas geradas carregam o **CSS purgado** (`bootstrap.purged.min.css`, ~27 KB). Não há Bootstrap 4 nem jQuery no projeto. Leaflet e Chart.js também são carregados localmente (ver [Dependências Externas](#dependências-externas)).

A navbar principal segue a ordem: Previsões, Potenciais Energéticos, Monitoramento, Climatologia e Equipe. Essa ordem é definida **uma única vez** no array `NAV` de `build.js`, que gera tanto a navbar quanto o menu do rodapé; o item ativo vem do campo `active` da página em `PAGES`. Editar navbar/rodapé/`<head>` significa editar `src/partials/`, não `site/*.html`.

## Organização De Pastas

```text
build.js                            # gerador estático (src/ -> site/*.html), só stdlib do Node
scripts/                            # guards de assets + guia de regeneração
├── check-fa-subset.mjs             # lint:icons
├── check-bootstrap-purge.mjs       # lint:purge
├── purgecss.config.cjs             # regeneração do bootstrap.purged.min.css
└── subset-fontawesome.md           # regeneração do subset de fontes
src/                                # FONTE das páginas — edite aqui, nunca em site/*.html
├── layouts/
│   ├── institutional.html          # index, monitoring, team, climatologia
│   └── webgis.html                 # mapas_interativos, potenciais_energeticos
├── partials/
│   ├── head.html                   # <head> compartilhado (inclui meta labmim-asset-hashes)
│   ├── nav.html                    # navbar (itens gerados do array NAV em build.js)
│   ├── footer.html                 # rodapé compartilhado
│   └── scripts.html                # Bootstrap bundle (fim do body)
└── pages/                          # conteúdo único de cada página (sem head/nav/footer)

site/                               # SAÍDA publicada (HTML gerado por build.js + assets)
├── .htaccess                       # MIME, compressão, cache, segurança/CSP, 404, 301 (Apache)
├── robots.txt                      # bloqueia /JSON/, /GeoJSON/, /figuras/
├── sitemap.xml                     # 6 URLs canônicas
├── 404.html                        # standalone (não gerado)
├── *.html                          # gerados por build.js (exceto mapas_meteorologicos.html e 404.html)
├── figuras/                        # reservado (placeholder)
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
│   │   ├── bootstrap/              # 5.3.8: bootstrap.purged.min.css (servido),
│   │   │                           #   bootstrap.min.css (fonte do purge + 404), bundle js
│   │   ├── fontawesome/            # 6.4.0: all.min.css, subset-glyphs.json, webfonts/
│   │   │                           #   (fa-solid-900.woff2 = subset; .full.woff2 = original)
│   │   ├── leaflet/                # 1.9.4 (js, css, images/)
│   │   └── chartjs/                # 3.9.1
│   ├── data/
│   │   └── br_ba.json              # contorno da Bahia (recorte por estado)
│   ├── graphs/                     # PNGs do monitoramento (regenerados pela estação)
│   ├── img/
│   └── json/                       # reservado (apenas .gitkeep)
├── GeoJSON/                        # grades geradas pelo pipeline (git-ignored)
└── JSON/                           # valores, séries, resumos, manifest (git-ignored)
```

Observações:

- `assets/graphs/` contém PNGs usados em `monitoring.html`, regenerados pela estação **nos mesmos nomes de arquivo** (por isso o `.htaccess` os serve com `no-cache`).
- `assets/img/` contém logos e imagens institucionais (WebP + fallback PNG via `<picture>` para as versões redimensionadas).
- `assets/vendor/` contém bibliotecas de terceiros servidas localmente, evitando dependência de CDN no caminho crítico.
- `assets/data/br_ba.json` é o contorno da Bahia usado pelo recorte por estado.
- `assets/json/` está reservado; há apenas marcador de pasta. O manifest real fica em `site/JSON/manifest.json` (gerado pelo pipeline).
- `GeoJSON/` e `JSON/` contêm dados gerados e ficam fora do controle de versão (`.gitignore` cobre `site/JSON/*.json`, `site/JSON/*.series.bin`, `site/GeoJSON/*.geojson` e `site/GeoJSON/*.json`).
- Não abra, varra, formate ou reprocesse `/data`; evite ler conteúdo de `GeoJSON/` e `JSON/` fora de depuração estritamente necessária, porque esses diretórios contêm artefatos grandes do pipeline externo.

## Build E Cache Busting (`build.js`)

`build.js` (stdlib do Node: `crypto`, `fs`, `path`) monta cada página assim:

1. Carrega o layout (`institutional` ou `webgis`), que inclui partials via `{{> head}}`, `{{> nav}}`, `{{> footer}}`, `{{> scripts}}`.
2. Injeta o conteúdo da página (`{{content}}` de `src/pages/`), e resolve os tokens `{{NAV_ITEMS}}`, `{{FOOTER_NAV}}`, `{{WORKER_HASHES}}`, `{{seoHead}}`, `{{title}}`, `{{description}}`, `{{bodyAttrs}}` e `{{h1}}` (resolvido por último, com fallback para `title`). Substituição é literal (split/join); qualquer token `{{...}}` não resolvido **quebra o build**.
3. `seoHead(page)` gera canonical + Open Graph + Twitter card a partir de `PROD = https://labmim.if.ufba.br` (`index.html` colapsa para a raiz).
4. `stampAssetVersions()` reescreve todo `href`/`src` de `assets/css/` e `assets/js/` acrescentando `?v=<primeiros 8 hex do md5 do conteúdo>`. Vendor mantém tokens manuais de release, **exceto** os listados em `HASHED_VENDOR_ASSETS` (hoje só `bootstrap.purged.min.css`, cujo conteúdo depende do HTML do site).
5. `workerHashes()` calcula o hash de cada `assets/js/workers/*.js` e o publica na `<meta name="labmim-asset-hashes" content="nome:hash;nome:hash">` (workers não aparecem em `href`/`src`, então o HTML não pode versioná-los diretamente). Em runtime, `workerScriptUrl()` em `map-manager.js` lê essa meta e monta `assets/js/workers/<arquivo>?v=<hash>`; `WORKER_CACHE_VERSION` é apenas o fallback quando a página não passou pelo build.

`PAGES` define as 6 páginas (`file`, `layout`, `active`, `h1`, `title`, `description` e, nos mapas, `bodyAttrs` com `data-map-context="forecast|energy"`). `npm run build` roda `node build.js` + Prettier na saída; `npm run build:check` falha se o `site/*.html` commitado divergir do regenerado (**as páginas geradas são artefatos commitados** — toda mudança em `src/`, `build.js` ou no conteúdo de um asset hasheado exige regenerar e commitar o HTML).

## CSS

### Responsabilidades

| Arquivo          | Responsabilidade                                                                    |
| ---------------- | ----------------------------------------------------------------------------------- |
| `base.css`       | Tokens CSS, reset, tipografia, utilitários pequenos, logos e cores base             |
| `layout.css`     | Navbar, seções de página, footer e estrutura compartilhada                          |
| `components.css` | Cards, parceiros, financiadores, blocos de explicação, monitoramento, modal helpers |
| `theme.css`      | Dark mode, overrides de tema, estados de controles, ajustes globais de contraste    |
| `maps.css`       | Layout e componentes exclusivos do WebGIS (inclui escada de z-index documentada)    |

### Padrões

- Use variáveis CSS em `:root` para cores, sombras, bordas e espaçamentos globais. `--primary-color` e `--brand-primary`/`--brand-secondary` são a marca navy, consistente entre temas (`theme.css` deliberadamente **não** reatribui `--primary-color`); o que muda no dark mode são os tokens de fundo/texto (`--bg-*`, `--text-*`) e a família `--dark-accent`. `--map-accent*` é o accent roxo do WebGIS.
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
| `ui-shell.js`     | Toggle genérico `[data-ui-toggle]` (hidden + aria-expanded + chevron + label)          |

### Módulos Do WebGIS

| Arquivo                         | Responsabilidade                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `variables-config.js`           | Define `VARIABLES_CONFIG`, `VARIABLE_CONTEXTS`, IDs de arquivo, unidades, palhetas e `specificInfo()` por variável  |
| `data-service.js`               | Classe `LabmimDataService`; fetch/cache LRU de JSON, dedup em voo, cache negativo e parsing em worker               |
| `map-manager.js`                | Classe `MeteoMapManager`; estado do mapa, manifest/linha do tempo, domínio, dados, renderização, controles e vento  |
| `charts-manager.js`             | Classe `ChartsManager`; séries temporais (series.bin/varredura), resumo de domínio (summary.json), modal, CSV       |
| `map-init.js`                   | Bootstrap do WebGIS; busca o manifest (corrida de 3 s + re-checagem), cria `MeteoMapManager` e `ChartsManager`      |
| `workers/color-calc.worker.js`  | Interpolação de cores fora da thread principal (memoização por valor; ecoa `requestId` — o descarte de respostas obsoletas fica no consumidor em `map-manager.js`) |
| `workers/json-parser.worker.js` | Fetch/parse JSON em worker quando disponível (repassa o status HTTP para a main thread)                             |

`MeteoMapManager`, `ChartsManager` e `LabmimDataService` são expostos em `window` para preservar compatibilidade do bootstrap atual.

### Ordem De Carregamento (páginas WebGIS)

No `<head>`: `theme-boot.js` (síncrono, para reduzir flash), `theme-toggle.js` e `ui-shell.js` (`defer`); `leaflet.js` (vendorizado) com `defer`. Antes de `</body>`, todos com `defer` e nesta ordem: Bootstrap 5 (vendorizado), Chart.js (vendorizado), `variables-config.js`, `data-service.js`, `charts-manager.js`, `map-manager.js`, `map-init.js`. Todo CSS/JS próprio carrega com `?v=<hash de conteúdo>` estampado pelo build.

## Dark Mode

Fluxo atual:

1. `theme-boot.js` roda no `<head>`.
2. Ele lê `localStorage.getItem("labmim-theme")`.
3. Se o valor for `dark`, ou se não houver valor e o sistema preferir dark, aplica `.dark-theme`.
4. `theme-toggle.js` inicializa no `DOMContentLoaded`, atualiza ícones e atributos acessíveis (há dois toggles: navbar por id `#themeToggleBtn`, footer por atributos `[data-theme-toggle]`).
5. Ao alternar tema, `theme-toggle.js` salva `labmim-theme` e dispara `labmim-theme-change`; sem valor salvo, segue mudanças do SO via `matchMedia`.
6. `ChartsManager` escuta esse evento e chama `refreshChartTheme()`.

Cuidados:

- Não remova `theme-boot.js`; ele reduz flash visual antes do carregamento do JS deferido.
- Se criar novos componentes com fundo próprio em `maps.css`, crie também o equivalente para `.dark-theme` quando necessário.
- Valide títulos de modal/sidebar em dark mode, porque `maps.css` é carregado por último na página de mapas.

## Camada De Dados (`LabmimDataService`)

`data-service.js` centraliza o acesso a JSON do WebGIS. `MeteoMapManager` cria a instância em `this.dataService`; `MeteoMapManager._cachedFetch()` e `ChartsManager._fetchHourJson()` delegam a ela. O método público é `fetchJson(url, options)` (aceita `options.signal` para abort por chamador). É um serviço **genérico** — a lógica de manifest/série/resumo vive nos consumidores (`map-init.js`, `map-manager.js`, `charts-manager.js`).

Responsabilidades:

- **Cache LRU em memória**: limite base `DATA_SERVICE_CACHE_LIMIT` (400 entradas), recência renovada a cada hit; `ensureCacheLimit()` **cresce** o limite (nunca encolhe) quando o manifest anuncia uma rodada mais longa (`ceil(index_max * 5.5)`), para o loop de playback + vento + modal aberto caberem residentes.
- **Deduplicação de requisições em voo**: chamadas concorrentes à mesma URL compartilham um único `fetch` + parse; um `signal` abortado afeta apenas aquele chamador, não o fetch compartilhado.
- **Cache negativo em dois níveis**: `DATA_SERVICE_FAILURE_TTL_MS` (60 s) para ausência determinística (`notFound`: 404/403/410) e `DATA_SERVICE_TRANSIENT_FAILURE_TTL_MS` (4 s) para falhas transitórias (rede/5xx), que podem se recuperar rápido.
- **Parsing em Web Worker** (`json-parser.worker.js`) com _fallback_ transparente para a thread principal se o worker falhar (o serviço trata `onerror`/`onmessageerror`, rejeita as chamadas pendentes e as reencaminha; o worker repassa o `status` HTTP).
- **Distinção 404 vs falha transitória**: erros carregam `status`/`notFound`. Um recurso deterministicamente ausente é lacuna esperada; falhas transitórias são propagadas para que caches de séries não sejam preenchidos com resultado incompleto.
- **`clear()`**: esvazia cache e cache negativo — chamado quando uma rodada nova do pipeline é detectada.

## Manifest De Dados E Ciclo De Vida Da Rodada

O pipeline publica `JSON/manifest.json` (formato `labmim-data-manifest-v2`) junto com os dados. Campos consumidos pelo site (`applyManifest` em `map-manager.js`):

| Campo | Uso |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `version` | Versão da rodada → `this.dataVersion`; `dataUrl()` anexa `?v=<version>` a **toda** URL de dados |
| `index_min`/`index_max` | Intervalo da linha do tempo → máximo do slider, `state.maxLayer` (`indexMin` clampado a ≥ 1) |
| `start_local` | Data/hora local do **índice 0** dos arquivos (nunca de `index_min`) → âncora dos rótulos |
| `timezone` | Informativo (`America/Bahia`; o site exibe os dígitos de hora local como recebidos) |
| `availability` | Mapa `variableId → [[início, fim], ...]` (inclusivo) → passos exibíveis/puláveis por variável |
| `features.domain_summary` | Descritor `{format: "domain-summary-v1", template}` → habilita o resumo consolidado |
| `features.cell_series` | Descritor `{format: "cell-series-int32-le-v1", template, dtype, byte_order, scale, missing, index_min, index_max}` → habilita a leitura binária de séries |

Ciclo de vida (`map-init.js`):

- O manifest é buscado **no parse do script** com `fetch(..., {cache: "no-cache"})` e corrido contra um timeout de 3 s — um manifest lento nunca atrasa o primeiro paint. Se perder a corrida, é adotado tardiamente (sem limpar caches) enquanto `dataVersion` ainda for nula.
- Re-checagem a cada 15 min (`MANIFEST_RECHECK_INTERVAL_MS`) e ao voltar o foco da aba (gap mínimo de 5 min), porque o pipeline regenera diariamente **nos mesmos nomes de arquivo**.
- Em versão nova, `handleManifestUpdate()`: `dataService.clear()`, `chartsManager.clearCaches()` + fecha modal/sidebar, descarta `gridLayers` (com token `_gridGeneration` que impede um fetch de grade em voo da rodada velha de repopular o cache), reancora a linha do tempo, ajusta `state.index` se o passo atual deixou de existir e repinta.
- **Degradação**: manifest v1 (sem `index_max`) reseta a linha do tempo para o padrão; sem manifest algum, o site usa `DEFAULT_MAX_LAYER = 73`, URLs sem `?v=` e a heurística solar legada — nada quebra, apenas perde as otimizações.

A versão da rodada participa de todas as chaves de staleness (`_loadKey`, `_windRequestKey`, chaves de cache do `ChartsManager`).

## Arquitetura Dos Mapas Interativos

### Inicialização

`map-init.js` roda após `DOMContentLoaded`:

```js
app = new MeteoMapManager();
chartsManager = new ChartsManager(app);
app.chartsManager = chartsManager;
app.setupVariableOverview(chartsManager);
```

O primeiro carregamento espera a corrida do manifest e então `applyManifest` → `applyMapChanges` → `startInitialPlayback()` (autoplay, a menos que o usuário já tenha tocado no play/pause — `hasUserControlledPlayback`).

`map-init.js` também envolve `app.showSidebar()`: o modal de séries temporais só abre em **clique real** do usuário (`options.userInitiated === true`); refreshes programáticos (slider, troca de variável/altura/domínio) apenas atualizam os gráficos silenciosamente se o modal já estiver aberto (`chartsManager.isModalOpen()`).

### Estado Principal

`MeteoMapManager` lê `data-map-context` no `<body>` para separar os contextos `forecast` e `energy`. `mapas_interativos.html` inicia apenas com variáveis meteorológicas/radiativas; `potenciais_energeticos.html` apenas com produtos energéticos. O `<select id="variableSelect">` é montado em runtime por `configureVariableSelect()` (o HTML traz só um placeholder desabilitado).

`MeteoMapManager` mantém estado em `this.state`:

- `type`, `domain`, `index`, `maxLayer`
- `isPlaying`, `hasUserControlledPlayback`, `intervalId`
- `isClippedToState`, `stateAbbr`
- `initialDateTime`, `initialIndex`
- `selectedCell`

Campos de instância relevantes fora de `this.state`: `dataVersion` e `timeline` (`indexMin`/`indexMax`/`availability`/`features`/`startLocal` — o contrato vindo do manifest), `windHeight` (50/100/150), `currentValueData` e `_currentValueKey` (dados atuais e a chave `(versão, domínio, variável, hora)` que eles representam), `_currentApply` (carga em voo), `gridLayers` (cache de grade por domínio) e `dataService`. Elementos de DOM usados com frequência são cacheados em `this.ui`.

O painel "Sobre as variáveis" é controlado por `setupVariableOverview()`; inicia com `is-collapsed` e só carrega a prévia visual quando expandido (prévia usa o resumo de domínio, com refresh debounced de 250 ms).

### Domínios

`DOMAIN_CONFIG` separa o ID técnico do label exibido. Os IDs técnicos continuam nos nomes de arquivos, cache e estado:

- `D01` → label `BA/NE` (grade 69×69, 27 km)
- `D02` → label `BA` (99×99, 9 km)
- `D03` → label `RMS` (99×99, 3 km)
- `D04` → label `SSA` (84×84, 1 km)

Os botões `.domain-btn` atualizam `this.state.domain` e recarregam dados. O cache de grade **não** é limpo na troca de domínio/variável/altura — a grade depende só do domínio (só `handleManifestUpdate` descarta grades, na troca de rodada). O domínio não troca automaticamente por zoom.

### Carregamento De Dados

O fluxo principal é:

1. `applyMapChanges()` — verifica disponibilidade do passo (`isIndexAvailable`) e define `_currentApply` com a chave da visão.
2. `loadValueData(index, type)`.
3. `getVariableId(type)` resolve o ID (para `eolico`, depende de `windHeight`).
4. `Promise.all([_cachedFetch(JSON/...), loadGridLayer(domain)])` — valor e grade em **paralelo**.
5. `applyValuesToGrid(gridLayer, valueData)` — cores via `color-calc.worker.js`.
6. `showGeoJsonLayer(gridLayer)` e `updateUIFromMetadata(metadata)`.
7. `_prefetchUpcoming()` aquece os próximos 2 passos reproduzíveis (`PREFETCH_AHEAD_STEPS`; pulado sob `navigator.connection.saveData`; inclui `WIND_VECTORS` quando a camada de vento está ligada em `wind`).

A máscara de recorte por estado é computada **preguiçosamente**, apenas quando o recorte está ativo (custa centenas de ms em mobile) e memoizada por grade.

Resultados de carga são descartados se a chave (`_loadKey` = versão:domínio:variável:passo) já não corresponde à visão atual — o mapa nunca pinta dados velhos sob um rótulo novo. Em falha de carga, `_clearCurrentData()` remove camada, dados e vetores de vento juntos. `handleMapClick()` usa `currentValueData` (fonte da verdade), confere `_currentValueKey` e aguarda a carga em voo quando necessário.

### Disponibilidade E Playback

`isIndexAvailable(index, type)`:

1. Com manifest v2, índices fora de `[indexMin, indexMax]` são indisponíveis.
2. Se `availability` traz faixas para o ID resolvido da variável, o índice precisa cair em alguma faixa (vale para qualquer variável, não só `SWDOWN`).
3. Fallback legado: apenas `SWDOWN` é gatado à janela 6h–18h **derivada da âncora de data** (`calculateTargetDateFromIndex`) — não existe mais a heurística `(index-1)%24`; sem âncora, o índice é permitido de forma otimista.

`nextPlayableIndex()` avança pulando passos indisponíveis e dá a volta para `timeline.indexMin`. A animação (`startAnimation`, tick de 800 ms) usa esse mecanismo; durante o playback, um 404 inesperado dispara `_maybeFastSkipEmptyFrame` (pulo em 50 ms, com guarda de streak para o modo degradado sem manifest).

### Recorte Por Estado

`loadStateGeoJson(stateCode)` busca `assets/data/br_{state}.json` (local, fetch direto). `_precomputeStateMask()` marca cada célula com um _point-in-polygon_ local (ray casting sobre Polygon/MultiPolygon) — o antigo Turf.js foi removido. O botão de recorte só aparece quando o contorno carrega; se falhar, o mapa renderiza sem recorte.

## Contratos De Dados

Todos os arquivos abaixo são gerados pelo pipeline [micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) e publicados em `site/JSON/` e `site/GeoJSON/` (gitignored). Com manifest presente, toda URL recebe `?v=<versão da rodada>`.

### Grade Compacta (preferida)

```text
GeoJSON/{domain}.grid.json
```

Formato `grid-edges-v1`: `{format, metadata: {resolucao_m}, shape: [nRows, nCols], lon_edges (nCols+1), lat_edges (nRows+1)}` (~2 KB). Há também a variante `grid-bounds-v1` (`bounds` com `[left, bottom, right, top]` por célula, para grades curvilíneas). `_featureCollectionFromCompactGrid()` reconstrói no cliente uma FeatureCollection de polígonos retangulares com `properties.linear_index` (row-major, `k = i*nCols + j`). Payload malformado lança erro e cai no fallback abaixo.

### Grade Legada (fallback)

```text
GeoJSON/{domain}.geojson
```

FeatureCollection completa (1,2–2,6 MB) com um Polygon por célula e `properties.linear_index`. Usada apenas quando `grid.json` não existe (pipeline antigo). `loadGridLayer()` monta em ambos os casos um mapa `linear_index → camada` (`_layersByLinearIndex`) usado por cores, clique e vetores de vento.

### Valores Por Passo

```text
JSON/{domain}_{variableId}_{index:03d}.json
```

```json
{
  "metadata": {
    "scale_values": [16.72, 19.45, 22.19, 24.93, 27.67, 30.4],
    "date_time": "02/05/2026 21:00:00"
  },
  "values": [22.82, 22.86, null]
}
```

`values[i]` é indexado por `linear_index`; `null` é legítimo (célula sem dado). Índices vão de `000` até `index_max` (a rodada atual exporta 000–075; `SWDOWN` só nos passos diurnos). `date_time` traz os **dígitos de horário local** (saídas WRF já convertidas para o fuso do produto); `parseDateTime()` armazena esses dígitos nos campos UTC de um `Date`, de modo que são exibidos sem deslocamento (por isso gráficos/CSV formatam com `timeZone: "UTC"`). Os arquivos de `eolico` (`POT_EOLICO_*M`) **embutem os vetores de vento** em `metadata.wind`.

### Vetores De Vento

```text
JSON/{domain}_WIND_VECTORS_{index:03d}.json
```

Campos: `downsampled_angles`, `downsampled_magnitudes`, `downsampled_linear_indices` (amostragem com stride sobre a grade). Buscado apenas para a variável `wind` (10 m) — `eolico` usa os vetores embutidos nos próprios valores. As setas são posicionadas resolvendo cada `linear_index` via `_layersByLinearIndex` (não por posição no array). `WIND_VECTORS` é a única "variável" por passo sem `series.bin`/`summary.json`.

### Série Binária Por Célula

```text
JSON/{domain}_{variableId}.series.bin
```

Formato `cell-series-int32-le-v1` (anunciado em `features.cell_series` do manifest): matriz **células × passos** de int32 little-endian, sem cabeçalho; `valor = raw * scale` (0.01), sentinela de ausência `missing` (INT32_MIN). `ChartsManager._loadCellSeriesFromBinary()` lê a série de UMA célula com `Range: bytes=celula*passos*4 ...` (~300 B): trata resposta `206` (validando o total do `Content-Range` contra `células × passos × 4` — rejeita artefato órfão de rodada anterior) e também `200` sem suporte a Range (baixa o corpo inteiro e fatia localmente — é o caso do `python3 -m http.server` em dev; o Apache de produção responde 206). Qualquer problema retorna `null` e o consumidor cai na varredura hora-a-hora legada (lotes de 12; resumo de domínio em lotes de 8). A requisição Range é um `fetch` cru (fora do `LabmimDataService`); o cache fica no nível do `ChartsManager`, com chave que embute a versão da rodada.

### Resumo De Domínio

```text
JSON/{domain}_{variableId}.summary.json
```

Formato `domain-summary-v1` (anunciado em `features.domain_summary`): `{format, domain, variable, indices[], date_times[], mean[], min[], max[]}` (~3–4 KB). Alimenta a prévia do painel "Sobre as variáveis" (`_loadSummaryArtifactSeries`), substituindo a varredura de dezenas de arquivos completos; a varredura permanece como fallback.

### Manifest

```text
JSON/manifest.json
```

Ver [Manifest De Dados](#manifest-de-dados-e-ciclo-de-vida-da-rodada). Exemplo real: `{"version": "20260719T013159Z", "generated_utc": "...", "domains": ["D01".."D04"], "files": 4844, "format": "labmim-data-manifest-v2", "timezone": "America/Bahia", "index_min": 0, "index_max": 75, "start_local": "02/05/2026 21:00:00", "availability": {"SWDOWN": [[9,21],[33,45],[57,69]]}, "features": {...}}`. Sempre buscado com `cache: "no-cache"` e nunca versionado com `?v=` (ele **é** a fonte da versão).

## Variáveis E Palhetas

As variáveis ficam em `VARIABLES_CONFIG` (14 chaves):

| Chave              | ID principal             | Observação                                             |
| ------------------ | ------------------------ | ------------------------------------------------------ |
| `globalRadiation`  | `SWDOWN`                 | Radiação Global no contexto de Previsões               |
| `solar`            | `SWDOWN`                 | Potencial Fotovoltaico no contexto energético          |
| `eolico`           | `POT_EOLICO_50M`         | Também define `id_100m`, `id_150m` e seletor de altura |
| `temperature`      | `TEMP`                   | Informações térmicas                                   |
| `skinTemperature`  | `TSK`                    | Temperatura de superfície                              |
| `pressure`         | `PRES`                   | Pressão atmosférica                                    |
| `humidity`         | `VAPOR`                  | Vapor d'Água / razão de mistura em `g/kg`              |
| `relativeHumidity` | `RH2`                    | Umidade relativa em `%`                                 |
| `rain`             | `RAIN`                   | Precipitação                                           |
| `wind`             | `WIND`                   | Vento a 10m                                            |
| `longwave`         | `GLW`                    | Radiação de onda longa incidente                       |
| `hfx`              | `HFX`                    | Calor sensível                                         |
| `lh`               | `LH`                     | Calor latente                                          |
| `windPowerDensity` | `WIND_POWER_DENSITY_10M` | Densidade de potência eólica a 10m                     |

Cada entrada define ao menos `id`, `label`, `unit`, `colors`, `scaleMin`/`scaleMax` e `specificInfo(value, allValues)`. Campos opcionais: `relatedVariables` (variáveis auxiliares buscadas para a sidebar), `chartCompanions` (séries companheiras carregadas para os gráficos — ex.: temperatura para `solar`/`eolico`), `id_100m`/`id_150m` + `defaultHeight` (eólico), `optionLabel`, `icon`/`faIcon`, `category`, `sourceId`, `summary`, e `scaleTicks`/`scaleTickCount` (ticks explícitos da colorbar). A ordem de resolução da escala em `getScaleValues()` é: `scaleTicks` → rampa linear de `scaleMin`/`scaleMax` (`scaleTickCount`, padrão 10) → `metadata.scale_values` do arquivo. (Os antigos `useDynamicScale`/`normalValue` não existem mais.)

Parâmetros dos modelos de energia do frontend (editáveis na sidebar, persistidos em `localStorage` `meteoMapCustomParameters`): solar — `panelEfficiency` 18%, `inversorEfficiency` 95%, `noct` 45 °C, `ptc` −0,38%/°C; eólico — `airDensity` 1,225 kg/m³, `rotorDiameter` 40 m, `Cp` 0,4. `specificInfo()` emite itens estruturados com `energyValue`/`energyUnit`, consumidos pelo gráfico de energia e pelo CSV (nunca por parsing de texto formatado).

> Nota sobre `specificInfo()`: quantidades físicas que podem valer `0` (temperatura, vento, radiação) usam guardas `Number.isFinite` em vez de `||`, para que um `0` legítimo não seja substituído por um valor padrão.

## Play/Pause E Loop Temporal

O controle principal é `#playPauseBtn`.

Fluxo:

- No primeiro carregamento, `startInitialPlayback()` inicia a animação automaticamente (a menos que o usuário já tenha interagido com o play/pause).
- Clique chama `togglePlayPause()` (marca `hasUserControlledPlayback` e fecha a sidebar ao dar play).
- `startAnimation()` cria `setInterval()` com `PLAYBACK_INTERVAL_MS` (800 ms).
- A cada tick, avança para `nextPlayableIndex(slider + 1)` — pulando passos indisponíveis (manifest `availability`/limites) e dando a volta para `timeline.indexMin`.
- Um 404 inesperado durante o playback aciona `_maybeFastSkipEmptyFrame` (pulo rápido, modo degradado sem manifest).

Não existe botão de loop separado; o comportamento de loop é integrado à animação. O slider também dispara um apply debounced (100 ms) e, quando pausado, re-seleciona a célula clicada.

## Wind Layer Toggle

`windLayerToggle` é controlado por `updateWindLayerToggleVisibility(variableType)`:

- Visível quando `variableType === "eolico"` ou `variableType === "wind"`.
- Oculto nas demais variáveis (checkbox desmarcado à força e canvas limpo).
- O checkbox `#windLayerCheckbox` chama `toggleWindLayer(isEnabled)`.
- Quando ativo, `renderWindVectors()` usa os vetores **embutidos** em `metadata.wind` (eolico) ou busca `JSON/{domain}_WIND_VECTORS_{hour}.json` (wind), desenhando setas no canvas `#windVectorCanvas` (canvas HTML próprio, redimensionado/redesenhado via rAF em move/zoom/resize).

Cuidados:

- Não exibir a camada de vento para variáveis que não sejam vento/eólico sem revisar UX e performance.
- Requisições pendentes são invalidadas por `_windRequestKey` (versão:domínio:passo); células recortadas pelo estado são puladas.
- Em payload de vento vazio, o canvas é limpo (não deixa setas do horário anterior).

## Sidebar E Modal De Séries Temporais

Ao clicar em uma célula:

1. `handleMapClick(e, { userInitiated })` identifica a célula Leaflet e lê o valor de `currentValueData` (aguardando a carga em voo correspondente se necessário).
2. Carrega valores auxiliares via `loadAllVariableValuesForCell()` (apenas a variável ativa + suas `relatedVariables`).
3. Atualiza `this.state.selectedCell` e solta um marcador de "ping".
4. Chama `showSidebar({ userInitiated })`.
5. `map-init.js` intercepta `showSidebar()` e, apenas em clique real, abre o modal persistente de séries temporais.

`ChartsManager`:

- **Preferência**: série da célula via `series.bin` (uma requisição Range) e resumo do domínio via `summary.json` — ambos habilitados pelos descritores `features` do manifest.
- **Fallback**: varredura hora-a-hora (`_collectHourlySeries`, lotes de 12 para série de célula e 8 para resumo de domínio), com `AbortController` para cancelar carregamentos anteriores.
- Mantém `timeSeriesCache` e `domainSummaryCache` com chaves que embutem a **versão da rodada**; grava apenas quando não houve falha transitória (um 404 estrutural, como horas noturnas de `SWDOWN`, não bloqueia o cache). `clearCaches()` é chamado na troca de rodada.
- Reutiliza instâncias Chart.js com `.update("none")`; todos os gráficos são de linha (Chart.js 3.9.1).
- Formata rótulos e CSV com `timeZone: "UTC"` para **preservar os dígitos de horário local** das saídas WRF, consistente com o rótulo do mapa; datas de metadados são parseadas por `parseDateTime`/`_parseMetadataDate` (seguro no Safari/WebKit).
- Exporta CSV com data, hora, latitude, longitude, domínio, variável e valores (+ coluna de produção para `solar`/`eolico`).

Para `solar` e `eolico`, o modal também exibe uma série derivada de energia (canvas `chartCanvasEnergy`), calculada por `specificInfo()` com os parâmetros customizáveis.

## Componentes Compartilhados

- Navbar e footer: `layout.css`.
- Cards e seções institucionais: `components.css`.
- Parceiros e financiadores: classes `.partners-section`, `.partners-grid`, `.partner-logo`, `.sponsors-strip`.
- Toggle de explicação em `monitoring.html`: `ui-shell.js` via atributos `data-ui-toggle`.

## `.htaccess`

`site/.htaccess` configura o Apache com diretivas protegidas por `<IfModule>` (o site nunca deve retornar 500 se um módulo faltar):

- **Charset/erros/redirects**: `AddDefaultCharset UTF-8`; `ErrorDocument 404 /404.html`; `Redirect 301 /mapas_meteorologicos.html → /mapas_interativos.html` (o arquivo legado permanece como fallback meta-refresh se `mod_alias` faltar).
- **MIME**: `application/json` para `.json` e `application/geo+json` para `.geojson`.
- **Compressão**: `mod_deflate` (dentro de `mod_filter`) para HTML, CSS, JS, JSON, GeoJSON e SVG, com bloco paralelo `mod_brotli` para clientes que suportam.
- **Segurança**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (geolocation/camera/microphone desligados) e **CSP** com `script-src 'self'` (sem scripts inline; JSON-LD permitido por não ser executável), `style-src 'self' 'unsafe-inline'` (atributos style do Leaflet), `img-src` liberando tiles OSM e `data:`, `frame-src https://www.google.com` (mapa da equipe) e `upgrade-insecure-requests`.
- **Cache-Control** (cascata; blocos `<If>` aplicam por último e vencem os `FilesMatch`):
  - `.json`/`.geojson` **sem** `?v=` → `no-cache` (nomes reutilizados a cada rodada; revalidação 304 barata).
  - `.json`/`.geojson` **com** `?v=` → `public, max-age=86400` (24 h, não 1 ano: teto de estrago para um manifest órfão após rollback do pipeline).
  - `.html` → `no-cache`.
  - `.css`/`.js` sem `?v=` → cache curto com `stale-while-revalidate`.
  - `.css`/`.js` **com** `?v=` (hash de conteúdo do build) → `immutable` de 1 ano — exceto `assets/js/workers/`, mantidos fora enquanto existir o fallback manual `WORKER_CACHE_VERSION`.
  - `assets/vendor/**` → `immutable` de 1 ano — exceto `fontawesome/webfonts/` (o subset regenera no mesmo nome; regra de 7 dias).
  - imagens e fontes → 7 dias; `assets/graphs/` → `no-cache` (estação regenera nos mesmos nomes).

Nota: `.series.bin` não casa com nenhuma regra de compressão/cache explícita (extensão `.bin`) — fica nos defaults do Apache. As leituras Range de produção dependem do suporte nativo do Apache a `Range` (206).

## Dependências Externas

Vendorizadas localmente (sem CDN no caminho crítico):

- Bootstrap 5.3.8 — `assets/vendor/bootstrap/` (`bootstrap.purged.min.css` servido às páginas + `bootstrap.bundle.min.js` com `defer`; `bootstrap.min.css` completo mantido como fonte do purge e para o `404.html`).
- Font Awesome 6.4.0 — `assets/vendor/fontawesome/` (`css/all.min.css` + subset `fa-solid-900.woff2` com preload; original em `fa-solid-900.full.woff2`; manifesto `subset-glyphs.json`).
- Leaflet 1.9.4 — `assets/vendor/leaflet/` (`leaflet.js` com `defer`).
- Chart.js 3.9.1 — `assets/vendor/chartjs/`.
- Contorno da Bahia — `assets/data/br_ba.json`.

Origens externas (fora do caminho crítico de CSS/JS):

- Tiles do mapa base via OpenStreetMap (apenas páginas WebGIS; preconnect para `a/b/c.tile.osm.org`).
- Iframe Google My Maps em `team.html` (liberado no CSP).

> O Bootstrap foi **unificado em uma única versão vendorizada (5.3.8)**; Bootstrap 4, jQuery e Popper foram **removidos**. O Turf.js também foi removido (máscara de recorte por _point-in-polygon_ local).

Dev tooling (em `package.json`, ver também `.nvmrc` = Node 24 LTS):

- ESLint 10 (flat config em `eslint.config.mjs`, com globals do projeto).
- Stylelint 17 (+ `stylelint-config-standard` 40).
- Prettier 3.9 (também roda dentro de `npm run build`; `src/` fica fora — os templates contêm tokens `{{...}}`).
- html-validate 10 (`lint:html`, config em `.htmlvalidate.json`) e linkinator (`lint:links`, só links internos).
- Guards de assets: `scripts/check-fa-subset.mjs` (`lint:icons`) e `scripts/check-bootstrap-purge.mjs` (`lint:purge`); PurgeCSS roda ad-hoc via `npx` com `scripts/purgecss.config.cjs`.
- CI em `.github/workflows/ci.yml`: `build:check`, `lint:js`, `lint:css`, `lint:icons`, `lint:purge`, `format:check`, `lint:html`, `lint:links`, `npm audit --audit-level=high`. Dependabot em `.github/dependabot.yml` (npm + GitHub Actions, semanal, PRs agrupados).

Atenção: `make lint`/`make ci` **não** rodam `lint:icons`/`lint:purge` (o CI do GitHub roda) — use `npm run lint`/`lint:all` como espelho fiel.

## Decisões Da Refatoração

Rodada 2026-06 (overhaul estático):

- Header, footer, `<head>` e blocos de script foram extraídos para `src/partials/` e montados por `build.js`, eliminando duplicação entre páginas.
- O Bootstrap foi unificado em uma única versão vendorizada (5.3.8); as páginas institucionais migraram de Bootstrap 4 + jQuery para Bootstrap 5.
- CSS antigo (`template.css`, `style.css`, `modern.css`, `custom-themes.css`) foi substituído por módulos menores e explícitos.
- Código legado de vídeos (`script-mapas.js`, `video.js`, `assets/video/`) foi removido.
- `mapas_meteorologicos.html` foi preservado como redirect de compatibilidade.
- Dark mode separado em bootstrap inicial (`theme-boot.js`) e controle interativo (`theme-toggle.js`).
- Acesso a dados extraído para `LabmimDataService`; Canvas renderer no mapa; interpolação de cores em worker.
- `site/.htaccess` com compressão, segurança e política de cache adequada a dados que reusam nomes de arquivo.

Rodada 2026-07-09/10 (dieta de assets — `perf/site-assets-and-map-runtime`):

- Bootstrap purgado (~27 KB) com guard de cobertura; subset do Font Awesome (~6 KB) com guard e guia de regeneração; imagens WebP com `<picture>`.
- Grade compacta `grid.json` preferida sobre o `.geojson`; manifest de versão de dados; prefetch de playback; cache LRU com TTLs de falha separados.

Rodada 2026-07-18/19 (linha do tempo por manifest — `feat/manifest-timeline-ingest`):

- Manifest v2 passou a dirigir o slider (`index_min`/`index_max`), a âncora de data (`start_local`) e a disponibilidade por variável (`availability`) — os hardcodes de 73 passos e a heurística solar `(index-1)%24` foram removidos.
- Re-checagem do manifest em sessão (15 min + foco da aba) com ressincronização completa na troca de rodada.
- Ingestão dos artefatos consolidados: `series.bin` (série de célula via HTTP Range) e `summary.json` (resumo de domínio), com fallback para a varredura legada.
- Cache busting por hash de conteúdo nos assets próprios e nos workers (meta `labmim-asset-hashes`), com regras `immutable` correspondentes no `.htaccess`.

## Pontos De Extensão

### Adicionar Página

1. Criar `src/pages/<nome>.html` com apenas o conteúdo único (sem head/nav/footer).
2. Adicionar uma entrada em `PAGES` no `build.js` (`file`, `layout`, `active`, `h1`, `title`, `description` e, para mapas, `bodyAttrs`).
3. Se a página for um destino de navegação, adicionar uma entrada em `NAV` (aparece automaticamente na navbar e no rodapé).
4. Rodar `make build` e commitar o `site/<nome>.html` gerado. Lembrar do CSP: nada de script inline.

### Adicionar Variável

1. Garantir que o pipeline exporte `JSON/{domain}_{variableId}_{index}.json` (e idealmente `series.bin`/`summary.json` + entrada em `availability` quando parcial).
2. Adicionar entrada em `VARIABLES_CONFIG` e associá-la ao contexto correto em `VARIABLE_CONTEXTS` — o `<select>` é montado em runtime, não há lista no HTML para sincronizar.
3. Definir palheta, unidade, `scaleMin`/`scaleMax` e `specificInfo()` (use `Number.isFinite` para quantidades que podem valer 0); avaliar `relatedVariables`/`chartCompanions`.
4. Validar sidebar, colorbar, séries temporais e dark mode.

### Alterar Palheta

Atualize `colors` da variável em `variables-config.js`. Para escalas comparáveis entre horários, use `scaleMin`/`scaleMax` (ou `scaleTicks` explícitos); `metadata.scale_values` fica como último fallback.

### Alterar Layout Institucional

Use os módulos CSS compartilhados. Evite criar regras específicas no HTML.

### Evoluir O WebGIS

`map-manager.js` (~2.400 linhas) ainda concentra estado, manifest/linha do tempo, eventos, cache de grade, renderização e sidebar. As extrações de `data-service.js` e dos consumidores de artefatos consolidados em `charts-manager.js` foram os primeiros passos; os próximos candidatos naturais são separar a renderização da grade/vento e o controle de UI/sidebar em módulos próprios. Faça isso com testes manuais cuidadosos.

## Cuidados Para Evitar Regressões

- Preserve os IDs usados pelo JS nas páginas WebGIS: `map`, `layerSlider`, `playPauseBtn`, `variableSelect`, `windLayerToggle`, `windLayerCheckbox`, `windVectorCanvas`, `sidebar`, `sidebarContent`, `timeSeriesModal`, `chartCanvasValue`, `chartCanvasEnergy`, `variableOverviewPanel`.
- Não altere nomes de chaves em `VARIABLES_CONFIG` sem revisar dados, gráficos e sidebar.
- Não renomeie os IDs técnicos `D01-D04`; eles fazem parte do contrato dos arquivos. Altere apenas labels públicos.
- Não mude os formatos anunciados no manifest (`labmim-data-manifest-v2`, `grid-edges-v1`, `grid-bounds-v1`, `domain-summary-v1`, `cell-series-int32-le-v1`) sem versionar um formato novo **e** manter o fallback — site e dados são publicados de forma desacoplada.
- `start_local` ancora o **índice 0** dos arquivos, nunca `index_min` — não "corrija" isso ao mexer em `applyManifest`.
- A variável `humidity` deve aparecer como Vapor d'Água / razão de mistura em `g/kg`; `relativeHumidity` é a umidade relativa em `%`.
- Não remova `theme-boot.js` do `<head>`.
- Use `LabmimDataService` para buscar JSON; não introduza `fetch` direto que ignore cache/dedup/cache negativo (exceções conscientes existentes: manifest com `cache: "no-cache"`, leitura Range do `series.bin` e o contorno estático da Bahia).
- Ao atualizar uma biblioteca vendorizada, substitua o arquivo e atualize o token `?v=` manual em `src/`; CSS/JS próprios, `bootstrap.purged.min.css` e workers são hasheados automaticamente pelo build — basta `make build` + commit do HTML.
- Ao mexer em `maps.css`, valide light e dark mode.
- Ao mexer em `map-manager.js`, valide play/pause (incl. autoplay e pulos por disponibilidade), troca de domínio, troca de variável, troca de rodada (regenerar o manifest local), clique em célula e wind layer.
- Ao mexer em `charts-manager.js`, valide carregamento via `series.bin` E via fallback (sem manifest), cancelamento, troca de tema e exportação CSV.
- Não documente dados ou endpoints que não existam no código. Se um novo pipeline mudar contratos de arquivo, atualize este documento junto.

## Checklist De Validação

Use antes de merge/publicação:

- `npm run build:check`, `npm run lint`, `npm run format:check` (ou `npm run lint:all` para incluir HTML e links), `npm audit`.
- Servir `site/` por HTTP local (`make serve`).
- Abrir páginas institucionais em desktop e mobile; alternar dark mode em cada página.
- Abrir `mapas_interativos.html` e confirmar que Potencial Fotovoltaico não aparece como previsão; `SWDOWN` deve aparecer como Radiação Global.
- Abrir `potenciais_energeticos.html` e confirmar que só aparecem Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Verificar se Leaflet renderiza (bundle local) e se não há erros no console.
- Trocar variáveis e domínios (a grade não deve recarregar do zero).
- Confirmar labels de domínio `BA/NE`, `BA`, `RMS` e `SSA` na UI, mantendo requisições internas com `D01-D04`.
- Testar play/pause até passar do final da escala temporal (deve dar a volta para o primeiro passo disponível) e confirmar que passos indisponíveis são pulados.
- Com dados + manifest locais presentes, conferir que o slider vai até `index_max` do manifest e que o rótulo de data bate com `start_local`.
- Ativar `windLayerToggle` em `wind` e `eolico`; confirmar que fica oculto nas demais variáveis.
- Clicar em uma célula e validar sidebar; validar modal de séries temporais (rápido via `series.bin`) e exportação CSV.
