# Arquitetura das publicações estáticas

Este documento descreve o frontend estático compartilhado hoje por LabMiM/UFBA e LEAL/UFES e sua fronteira de extensão para futuras publicações brasileiras. Ele deve ser usado como referência para manutenção, evolução do WebGIS e prevenção de regressões.

## Visão Geral

O projeto gera uma publicação por vez em `site/`, composta por HTML, CSS modular e JavaScript sem framework frontend. `build.js` descobre `src/sites/<id>/site.js`, valida o contrato completo, expande o template compartilhado, aplica conteúdo e tema próprios, gera SEO/404/robots/sitemap e carimba hashes de conteúdo nos assets. O deploy recebe arquivos estáticos puros; Node participa apenas do build local/CI.

Não há backend de aplicação neste repositório. Os dados são gerados pelo pipeline do repositório irmão [micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) (CLI `labmim-wrf-geojson`) e publicados de forma desacoplada do site; por isso todo contrato de dados tem fallback no cliente.

## Modelo Modular

A unidade de build é uma **publicação**, composta em `src/sites/<id>/site.js`. Ela referencia módulos menores em vez de concentrar todo o produto em uma configuração global:

| Conceito      | Local                       | Responsabilidade                                                           |
| ------------- | --------------------------- | -------------------------------------------------------------------------- |
| Template      | `src/template/`             | Layouts, partials, páginas e estáticos neutros quanto a instituição/estado |
| Publicação    | `src/sites/<id>/`           | Identidade, manifesto de páginas, conteúdo editorial próprio e paleta      |
| Território    | `src/territories/<uf>.js`   | Estado, sigla, contorno, centro, zoom e política de `fitBounds`            |
| Dataset       | `src/datasets/<produto>.js` | Atribuição, caminhos operacionais, timeline e domínios WRF                 |
| Assets comuns | `site/assets/`              | Runtime JS, CSS estrutural, imagens e bibliotecas vendorizadas             |

Essa composição evita três acoplamentos: uma publicação não é sinônimo de estado, um estado não determina os domínios WRF e uma página compartilhada não pertence implicitamente à publicação padrão. Toda fonte de página declara explicitamente `scope: "template"` ou `scope: "site"` por meio de `templateSource()` e `siteSource()`.

O diretório `src/sites/` é o registro. A descoberta ordena os diretórios que contêm `site.js`, exige que o `id` seja igual ao nome da pasta, rejeita IDs/origens duplicados e exige exatamente um `isDefault: true`. Assim, uma nova publicação válida não requer alteração em `build.js`, `package.json` ou em uma lista central.

## Páginas HTML

| Arquivo                            | Função                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| `site/index.html`                  | Página inicial institucional                                          |
| `site/monitoring.html`             | Monitoramento ambiental com gráficos PNG e modais Bootstrap           |
| `site/team.html`                   | Equipe, links e localização incorporada (iframe Google My Maps)       |
| `site/climatologia.html`           | Página de climatologia em construção                                  |
| `site/mapas_interativos.html`      | WebGIS de previsões meteorológicas                                    |
| `site/potenciais_energeticos.html` | WebGIS de potencial fotovoltaico, potencial eólico e densidade eólica |
| `site/404.html`                    | Página de erro standalone (caminhos absolutos, `ErrorDocument 404`)   |

Todas são declaradas no array de `src/sites/<id>/pages.js` e geradas por `build.js`. A fonte de `404.html` fica em `src/template/static/404.html` e mantém caminhos absolutos `/assets/...` para resolver em qualquer profundidade.

Todas as páginas usam **Bootstrap 5.3.8 vendorizado localmente**; as páginas geradas carregam o **CSS purgado** (`bootstrap.purged.min.css`, ~27 KB). Não há Bootstrap 4 nem jQuery no projeto. Leaflet e Chart.js também são carregados localmente (ver [Dependências Externas](#dependências-externas)).

A navbar e o rodapé são derivados das entradas `nav` do manifesto da publicação, ordenadas por `nav.order`. A página pode existir sem aparecer na navegação omitindo `nav`. Editar a estrutura da navbar/rodapé/`<head>` significa editar `src/template/partials/`, não `site/*.html`.

## Organização De Pastas

```text
build.js                              # orquestrador de descoberta, validação e renderização
scripts/
├── site-builder/
│   ├── publications.js              # descoberta/seleção automática
│   ├── validate.js                  # valida configuração, arquivos e GeoJSON do estado
│   ├── renderer.js                  # HTML, SEO, runtime config e estáticos
│   └── assets.js                    # tema da publicação e hashes de conteúdo
├── build-site.mjs                   # build individual + formatação
├── build-all.mjs                    # bundles dist/<id>/
└── check-publications.mjs           # build/lints de todas + restauração da padrão
src/
├── template/
│   ├── page-types.js                # catálogo page() e customPage()
│   ├── layouts/                     # institutional.html e webgis.html
│   ├── partials/                    # head, nav, footer, scripts e docs WebGIS
│   ├── pages/                       # conteúdo reutilizado por publicações
│   └── static/                      # 404 e htaccess.template
├── sites/
│   ├── README.md                    # guia de extensão
│   ├── ufba/
│   │   ├── site.js                  # composição identity + territory + dataset + pages
│   │   ├── identity.js              # marca, instituição, origem e redirects
│   │   ├── pages.js                 # páginas, SEO e navegação
│   │   ├── theme.css                # tokens de marca
│   │   ├── pages/                   # conteúdo exclusivo
│   │   └── fragments/               # trechos exclusivos anexáveis
│   └── ufes/                        # mesma interface
├── territories/                     # ba.js, es.js e futuros estados
└── datasets/                        # labmim-wrf.js, leal-wrf.js e futuros produtos

site/                                 # saída compatível; uma publicação por vez
├── .htaccess, robots.txt, sitemap.xml
├── 404.html e *.html
├── assets/
│   ├── css/
│   │   ├── base.css
│   │   ├── site-theme.css           # gerado do src/sites/<id>/theme.css
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
│   │   ├── br_ba.json              # contorno da Bahia
│   │   └── br_es.json              # contorno do Espírito Santo
│   ├── graphs/                     # PNGs do monitoramento (regenerados pela estação)
│   └── img/
├── GeoJSON/                        # grades geradas pelo pipeline (git-ignored)
└── JSON/                           # valores, séries, resumos, manifest (git-ignored)

dist/<id>/                           # bundles de frontend gerados em lote
└── ...                              # não inclui JSON/ nem GeoJSON/ operacionais
```

Observações:

- `assets/graphs/` contém PNGs usados em `monitoring.html`, regenerados pela estação **nos mesmos nomes de arquivo** (por isso o `.htaccess` os serve com `no-cache`).
- `assets/img/` contém logos e imagens institucionais (WebP + fallback PNG via `<picture>` para as versões redimensionadas).
- `assets/vendor/` contém bibliotecas de terceiros servidas localmente, evitando dependência de CDN no caminho crítico.
- `assets/data/br_ba.json` e `br_es.json` são os contornos referenciados pelos módulos de território atuais.
- O manifest real fica em `site/JSON/manifest.json` (gerado pelo pipeline).
- `GeoJSON/` e `JSON/` contêm dados gerados e ficam fora do controle de versão (`.gitignore` cobre `site/JSON/*.json`, `site/JSON/*.series.bin`, `site/GeoJSON/*.geojson` e `site/GeoJSON/*.json`).
- Não abra, varra, formate ou reprocesse `/data`; evite ler conteúdo de `GeoJSON/` e `JSON/` fora de depuração estritamente necessária, porque esses diretórios contêm artefatos grandes do pipeline externo.

## Build, Validação E Cache Busting

O fluxo de um build é:

1. `publications.js` descobre todos os `src/sites/<id>/site.js` e seleciona `--site`, `SITE_ID` ou a publicação padrão.
2. `validate.js` acumula erros de identidade, páginas, fontes confinadas, redirects, tema, território, contorno GeoJSON, dataset e domínios antes de escrever a saída.
3. `renderer.js` resolve cada fonte explicitamente no template ou na publicação, expande partials/tokens e rejeita qualquer `{{...}}` não resolvido.
4. O renderer gera canonical, Open Graph, Twitter card, JSON-LD, `<meta name="site-config">`, `404.html`, `.htaccess`, `robots.txt` e `sitemap.xml` a partir do manifesto selecionado.
5. `assets.js` publica `src/sites/<id>/assets/**` sob `site/assets/**` — de todas as publicações, com o mesmo layout, para que a URL escrita na página seja o caminho que o arquivo já tem — grava `site/assets/css/site-theme.css` usando somente o tema selecionado e acrescenta `?v=<md5-8>` aos CSS/JS próprios. Os hashes dos workers são publicados em `labmim-asset-hashes`, no layout WebGIS.
6. Após sucesso, HTMLs raiz que não pertencem à publicação atual são removidos; os diretórios configurados em `dataset.paths` e demais dados operacionais não são tocados.
7. `build-all.mjs` estreita cada bundle por **alcançabilidade**: leva os assets que as páginas daquela publicação de fato referenciam, mais os assets de identidade declarados e o contorno do seu território. Posse não serve como critério porque os laboratórios exibem a marca um do outro como parceiro.

`npm run sites:list` mostra o registro descoberto. `npm run build -- --site=<id>` escreve uma publicação em `site/`; `npm run build:all` cria `dist/<id>/` para todas, omitindo o manifest e os diretórios operacionais declarados por cada `dataset.paths`; `npm run build:check` gera e valida todas as publicações, rejeita saída nova não versionada e sempre restaura a padrão em `site/`. Não existem atalhos por ID: o registro é o filesystem, então um site novo já é reconhecido por `--site=<id>` sem editar o `package.json`.

O build muda somente o frontend. Os diretórios configurados em `dataset.paths` precisam receber uma rodada WRF compatível com os domínios da publicação escolhida; `assets/graphs/` também é substituído pela estação de cada deploy.

## CSS

### Responsabilidades

| Arquivo          | Responsabilidade                                                                    |
| ---------------- | ----------------------------------------------------------------------------------- |
| `base.css`       | Tokens estruturais neutros, reset, tipografia, utilitários pequenos e logos         |
| `site-theme.css` | Paleta da publicação selecionada; arquivo gerado, não editar diretamente            |
| `layout.css`     | Navbar, seções de página, footer e estrutura compartilhada                          |
| `components.css` | Cards, parceiros, financiadores, blocos de explicação, monitoramento, modal helpers |
| `theme.css`      | Dark mode, overrides de tema, estados de controles, ajustes globais de contraste    |
| `maps.css`       | Layout e componentes exclusivos do WebGIS (inclui escada de z-index documentada)    |

### Padrões

- Tokens de identidade (`--brand-*`, `--map-accent*`, `--dark-accent*`, `--accent-color` e fundos de header/footer) pertencem a `src/sites/<id>/theme.css` e são copiados para `site-theme.css`. Aliases como `--primary-color` e tokens estruturais comuns permanecem em `base.css`/`theme.css`.
- Nunca selecione paleta por ID (`html[data-publication="..."]`) no CSS comum. Uma saída contém apenas o tema da publicação selecionada.
- Dark mode é controlado pela classe `.dark-theme` no elemento `<html>`.
- A cascata é `vendor da página → base → site-theme → layout → components → page.styles → theme`; o color mode fica por último. CSS exclusivo de página deve ser declarado no array `styles` de `pages.js`, nunca inserido diretamente no layout. Referências `siteSource("styles/...")` e `templateSource("styles/...")` são copiadas sob `assets/css/generated/` conforme o ownership e apenas para a publicação ativa.
- `npm run lint:themes` exige um único `:root` token-only em cada tema, compara o contrato entre publicações, proíbe branching por publicação no CSS comum e protege essa ordem de cascata.
- Evite estilos inline. Crie classes reutilizáveis em `components.css` ou um stylesheet de página declarado em `page.styles`, conforme o escopo.
- Mantenha responsividade com media queries já existentes; não use escala tipográfica baseada diretamente em viewport.

## JavaScript

### Módulos Gerais

| Arquivo           | Responsabilidade                                                                       |
| ----------------- | -------------------------------------------------------------------------------------- |
| `theme-boot.js`   | Aplica `.dark-theme` cedo com base em `localStorage` ou preferência do sistema         |
| `theme-toggle.js` | Controla botões de tema, ícones, `aria-*`, persistência e evento `labmim-theme-change` |
| `ui-shell.js`     | Toggle genérico `[data-ui-toggle]` (hidden + aria-expanded + chevron + label)          |

### Módulos Do WebGIS

| Arquivo                         | Responsabilidade                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `variables-config.js`           | Define `VARIABLES_CONFIG`, `VARIABLE_CONTEXTS`, IDs de arquivo, unidades, palhetas e `specificInfo()` por variável                                                 |
| `data-service.js`               | Classe `LabmimDataService`; fetch/cache LRU de JSON, dedup em voo, cache negativo e parsing em worker                                                              |
| `map-manager.js`                | Classe `MeteoMapManager`; estado do mapa, manifest/linha do tempo, domínio, dados, renderização, controles e vento                                                 |
| `charts-manager.js`             | Classe `ChartsManager`; séries temporais (series.bin/varredura), resumo de domínio (summary.json), modal, CSV                                                      |
| `map-init.js`                   | Bootstrap do WebGIS; busca o manifest (corrida de 3 s + re-checagem), cria `MeteoMapManager` e `ChartsManager`                                                     |
| `workers/color-calc.worker.js`  | Interpolação de cores fora da thread principal (memoização por valor; ecoa `requestId` — o descarte de respostas obsoletas fica no consumidor em `map-manager.js`) |
| `workers/json-parser.worker.js` | Fetch/parse JSON em worker quando disponível (repassa o status HTTP para a main thread)                                                                            |

`MeteoMapManager`, `ChartsManager` e `LabmimDataService` são expostos em `window` para preservar compatibilidade do bootstrap atual.

### Ordem De Carregamento (páginas WebGIS)

No `<head>`: `theme-boot.js` (síncrono, para reduzir flash), `theme-toggle.js` e `ui-shell.js` (`defer`); `leaflet.js` (vendorizado) com `defer`. Antes de `</body>`, todos com `defer` e nesta ordem: Bootstrap 5 (vendorizado), Chart.js (vendorizado), `variables-config.js`, `data-service.js`, `charts-manager.js`, `map-manager.js`, `map-init.js`. Todo CSS/JS próprio carrega com `?v=<hash de conteúdo>` estampado pelo build.

## Dark Mode

Fluxo atual:

1. `theme-boot.js` roda no `<head>`.
2. Ele lê `localStorage.getItem("labmim-theme")`.
3. Se o valor for `dark`, ou se não houver valor e o sistema preferir dark, aplica `.dark-theme`.
4. `theme-toggle.js` inicializa no `DOMContentLoaded`, atualiza ícones e atributos acessíveis (os dois toggles — navbar e footer — usam os atributos `[data-theme-toggle]`/`[data-theme-icon]`).
5. Ao alternar tema, `theme-toggle.js` salva `labmim-theme` e dispara `labmim-theme-change`; sem valor salvo, segue mudanças do SO via `matchMedia`.
6. `ChartsManager` escuta esse evento e chama `refreshChartTheme()`.

Cuidados:

- Não remova `theme-boot.js`; ele reduz flash visual antes do carregamento do JS deferido.
- Se criar novos componentes com fundo próprio em `maps.css`, crie também o equivalente para `.dark-theme` quando necessário.
- Valide títulos de modal/sidebar em dark mode; `theme.css` é carregado após o CSS específico da página para manter os overrides de color mode previsíveis.

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

| Campo                     | Uso                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                 | Versão da rodada → `this.dataVersion`; `dataUrl()` anexa `?v=<version>` a **toda** URL de dados                                                           |
| `index_min`/`index_max`   | Intervalo da linha do tempo → máximo do slider, `state.maxLayer` (`indexMin` clampado a ≥ 1)                                                              |
| `start_local`             | Data/hora local do **índice 0** dos arquivos (nunca de `index_min`) → âncora dos rótulos                                                                  |
| `timezone`                | Informativo (`America/Bahia`; o site exibe os dígitos de hora local como recebidos)                                                                       |
| `availability`            | Mapa `variableId → [[início, fim], ...]` (inclusivo) → passos exibíveis/puláveis por variável                                                             |
| `features.domain_summary` | Descritor `{format: "domain-summary-v1", template}` → habilita o resumo consolidado                                                                       |
| `features.cell_series`    | Descritor `{format: "cell-series-int32-le-v1", template, dtype, byte_order, scale, missing, index_min, index_max}` → habilita a leitura binária de séries |

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

`dataset.domains` separa o ID técnico do label exibido e é serializado no `site-config` consumido pelo runtime. Cada domínio declara `id`, labels curto/longo, centro, zoom, resolução, descrição e se usa parametrização de cumulus. O dataset também declara `defaultDomain`.

Os produtos atuais usam IDs técnicos `D01`–`D04`, mas apresentam labels geográficos próprios: LabMiM usa `BA/NE`, `BA`, `RMS` e `SSA`; LEAL usa `S/SE/NE`, `Sudeste`, `ES` e `Grande Vitória`. O ID técnico continua nos nomes dos arquivos, cache e estado e não deve ser inferido do label.

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
| `relativeHumidity` | `RH2`                    | Umidade relativa em `%`                                |
| `rain`             | `RAIN`                   | Precipitação                                           |
| `wind`             | `WIND`                   | Vento a 10m                                            |
| `longwave`         | `GLW`                    | Radiação de onda longa incidente                       |
| `hfx`              | `HFX`                    | Calor sensível                                         |
| `lh`               | `LH`                     | Calor latente                                          |
| `windPowerDensity` | `WIND_POWER_DENSITY_10M` | Densidade de potência eólica a 10m                     |

Cada entrada define ao menos `id`, `label`, `unit`, `colors`, `scaleMin`/`scaleMax` e `specificInfo(value, allValues)`. Campos opcionais: `relatedVariables` (variáveis auxiliares buscadas para a sidebar), `chartCompanions` (séries companheiras carregadas para os gráficos — ex.: temperatura para `solar`/`eolico`), `id_100m`/`id_150m` (eólico), `optionLabel`, `icon`/`faIcon`, `sourceId`, `summary`, e `scaleTicks`/`scaleTickCount` (ticks explícitos da colorbar). A ordem de resolução da escala em `getScaleValues()` é: `scaleTicks` → rampa linear de `scaleMin`/`scaleMax` (`scaleTickCount`, padrão 10) → `metadata.scale_values` do arquivo. (Os antigos `useDynamicScale`/`normalValue` não existem mais.)

Parâmetros dos modelos de energia do frontend (editáveis na sidebar, persistidos em `localStorage` `meteoMapCustomParameters`): solar — `panelEfficiency` 18%, `inversorEfficiency` 95%, `noct` 45 °C, `ptc` −0,38%/°C; eólico — `airDensity` 1,225 kg/m³, `rotorDiameter` 40 m, `Cp` 0,4. `specificInfo()` emite itens estruturados com `energyValue`, consumidos pelo gráfico de energia e pelo CSV (nunca por parsing de texto formatado).

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
- Acessibilidade do modal: ao abrir, o foco vai ao botão de fechar; Tab/Shift+Tab ficam presos dentro do modal (focus trap); Escape fecha; ao fechar, o foco volta ao elemento de origem.

Para `solar` e `eolico`, o modal também exibe uma série derivada de energia (canvas `chartCanvasEnergy`), calculada por `specificInfo()` com os parâmetros customizáveis.

## Componentes Compartilhados

- Navbar e footer: `layout.css`.
- Cards e seções institucionais: `components.css`.
- Parceiros e financiadores: classes `.partners-section`, `.partners-grid`, `.partner-logo`, `.sponsors-strip`.
- Toggle de explicação em `monitoring.html`: `ui-shell.js` via atributos `data-ui-toggle`.

## `.htaccess`

`site/.htaccess` configura o Apache com diretivas protegidas por `<IfModule>` (o site nunca deve retornar 500 se um módulo faltar):

- **Charset/erros/redirects**: `AddDefaultCharset UTF-8`; `ErrorDocument 404 /404.html`; somente os redirects declarados em `src/sites/<id>/identity.js` para a publicação selecionada são emitidos.
- **MIME**: `application/json` para `.json` e `application/geo+json` para `.geojson`.
- **Compressão**: `mod_deflate` (dentro de `mod_filter`) para HTML, CSS, JS, JSON, GeoJSON e SVG, com bloco paralelo `mod_brotli` para clientes que suportam.
- **Segurança**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (geolocation/camera/microphone desligados) e **CSP** com `script-src 'self'` (sem scripts inline; JSON-LD permitido por não ser executável), `style-src 'self' 'unsafe-inline'` (atributos style do Leaflet), `img-src` liberando tiles OSM e `data:`, `frame-src https://www.google.com` (mapa da equipe) e `upgrade-insecure-requests`.
- **Cache-Control** (cascata; blocos `<If>` aplicam por último e vencem os `FilesMatch`):
  - `.json`/`.geojson`/`.bin` **sem** `?v=` → `no-cache` (nomes reutilizados a cada rodada; revalidação 304 barata).
  - `.json`/`.geojson`/`.bin` **com** `?v=` → `public, max-age=86400` (24 h, não 1 ano: teto de estrago para um manifest órfão após rollback do pipeline).
  - `.html` → `no-cache`.
  - `.css`/`.js` sem `?v=` → cache curto com `stale-while-revalidate`.
  - `.css`/`.js` **com** `?v=` (hash de conteúdo do build) → `immutable` de 1 ano — inclui os workers (também content-hashed; o HTML publicado é sempre o gerado).
  - `assets/vendor/**` → `immutable` de 1 ano — exceto `fontawesome/webfonts/` (o subset regenera no mesmo nome; regra de 7 dias).
  - imagens e fontes → 7 dias; `assets/graphs/` → `no-cache` (estação regenera nos mesmos nomes).

Nota: `.series.bin` fica deliberadamente **fora** das listas de compressão: o `mod_deflate` não comprime respostas 206, e comprimir o corpo inteiro anularia as leituras parciais (Range, ~300 B) que o site faz nesses arquivos. As leituras Range de produção dependem do suporte nativo do Apache (206).

## Dependências Externas

Vendorizadas localmente (sem CDN no caminho crítico):

- Bootstrap 5.3.8 — `assets/vendor/bootstrap/` (`bootstrap.purged.min.css` servido às páginas + `bootstrap.bundle.min.js` com `defer`; `bootstrap.min.css` completo mantido como fonte do purge e para o `404.html`).
- Font Awesome 6.4.0 — `assets/vendor/fontawesome/` (`css/all.min.css` + subset `fa-solid-900.woff2` com preload; original em `fa-solid-900.full.woff2`; manifesto `subset-glyphs.json`).
- Leaflet 1.9.4 — `assets/vendor/leaflet/` (`leaflet.js` com `defer`).
- Chart.js 3.9.1 — `assets/vendor/chartjs/`.
- Contornos da Bahia e do Espírito Santo — `assets/data/br_ba.json` e `assets/data/br_es.json`.

Origens externas (fora do caminho crítico de CSS/JS):

- Tiles do mapa base via OpenStreetMap (apenas páginas WebGIS; host `tile.openstreetmap.org`, com preconnect no layout webgis).
- Iframe Google My Maps em `team.html` (liberado no CSP).

> O Bootstrap foi **unificado em uma única versão vendorizada (5.3.8)**; Bootstrap 4, jQuery e Popper foram **removidos**. O Turf.js também foi removido (máscara de recorte por _point-in-polygon_ local).

Dev tooling (em `package.json`, ver também `.nvmrc` = Node 24 LTS):

- ESLint 10 (flat config em `eslint.config.mjs`, com globals do projeto).
- Stylelint 17 (+ `stylelint-config-standard` 40).
- Prettier 3.9 (também roda dentro de `npm run build`; os templates HTML em `src/` ficam fora por conterem tokens `{{...}}`).
- html-validate 10 (`lint:html`, config em `.htmlvalidate.json`) e linkinator (`lint:links`, só links internos).
- Guards de arquitetura/assets: `scripts/check-site-themes.mjs` (`lint:themes`), `scripts/check-fa-subset.mjs` (`lint:icons`) e `scripts/check-bootstrap-purge.mjs` (`lint:purge`); PurgeCSS (devDependency) regenera o CSS purgado com `scripts/purgecss.config.cjs`.
- CI em `.github/workflows/ci.yml`: `build:check`, `lint:js`, `lint:css`, `lint:themes`, `lint:icons`, `lint:purge`, `format:check`, `lint:html`, `lint:links`, `npm audit --audit-level=high`. Dependabot em `.github/dependabot.yml` (npm + GitHub Actions, semanal, PRs agrupados).

`make ci` roda os mesmos checks do CI do GitHub (`make lint` inclui `lint:themes`, `lint:icons` e `lint:purge`); o CI valida, além disso, o lockfile e a versão do Node via `npm ci` + `.nvmrc`.

## Decisões Da Refatoração

Rodada 2026-06 (overhaul estático):

- Header, footer, `<head>` e blocos de script foram extraídos para partials compartilhados (hoje em `src/template/partials/`) e montados por `build.js`, eliminando duplicação entre páginas.
- O Bootstrap foi unificado em uma única versão vendorizada (5.3.8); as páginas institucionais migraram de Bootstrap 4 + jQuery para Bootstrap 5.
- CSS antigo (`template.css`, `style.css`, `modern.css`, `custom-themes.css`) foi substituído por módulos menores e explícitos.
- Código legado de vídeos (`script-mapas.js`, `video.js`, `assets/video/`) foi removido.
- `mapas_meteorologicos.html` foi preservado como redirect de compatibilidade (stub removido em 2026-07; hoje só o 301 do `.htaccess` atende a URL legada).
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
- Acessibilidade: padrão ARIA de abas completo na documentação do WebGIS (roles, roving tabindex, setas/Home/End), focus trap + devolução de foco no modal de séries, `<span>` no título do seletor de altura (era um `<label>` órfão).
- Hover da grade delegado ao grupo Leaflet (`e.propagatedFrom`) em vez de 2 closures por célula; tiles OSM movidos para `tile.openstreetmap.org` (host canônico); regras de cache do `.htaccess` estendidas aos `.series.bin`; ano do rodapé gerado no build (`{{YEAR}}`, derivado da data do último commit).
- Varredura de código morto (2026-07-19): stub de redirect, diretórios reservados, logos originais órfãos, ~500 linhas de CSS/JS/HTML sem referência e campos de config não lidos removidos; toggles de tema unificados nos atributos `[data-theme-toggle]`; fallback manual de versão dos workers eliminado (URL sem `?v=` quando não há build).

Rodada 2026-07-22 (publicações modulares):

- O perfil monolítico e os overrides implícitos deram lugar à descoberta automática de `src/sites/<id>/site.js`.
- Identidade, páginas e tema ficaram isolados por publicação; território e dataset viraram módulos reutilizáveis e independentes.
- Layouts, partials, páginas compartilhadas e estáticos foram reunidos sob `src/template/`, com referências de fonte explícitas.
- Navegação, sitemap e conjunto de HTMLs passaram a derivar do manifesto de páginas de cada publicação.
- A validação passou a verificar esquema, colisões, confinamento de caminhos, assets, redirects e geometria do contorno antes da renderização.
- `build:all` passou a produzir bundles por ID, enquanto `site/` preserva o contrato de saída única usado pelo deploy existente.

## Pontos De Extensão

### Adicionar Página

Para uma página baseada no catálogo, use `page("<tipo>", { seo: ... })` em `src/sites/<id>/pages.js`; os tipos atuais e seus layouts/fontes padrão ficam em `src/template/page-types.js`.

Para conteúdo compartilhado novo:

1. Criar `src/template/pages/<nome>.html` apenas com o conteúdo da página.
2. Declarar uma `customPage()` em cada publicação que a oferece, usando `source: templateSource("pages/<nome>.html")`.
3. Informar `id`, `file`, `layout`, SEO completo e, se aparecer na navegação, `nav` com `label`, `icon`, `order` e `elementId` únicos.

Para conteúdo exclusivo, salvar o HTML em `src/sites/<id>/pages/` e usar `siteSource()`. Fragmentos adicionais podem ser anexados com `append: [siteSource(...)]`. A receita completa, incluindo nova publicação/território/dataset, fica em [`src/sites/README.md`](src/sites/README.md).

### Adicionar Publicação

1. Criar `src/sites/<id>/identity.js`, `pages.js`, `site.js`, `theme.css` e os conteúdos próprios necessários.
2. Referenciar ou criar um módulo em `src/territories/` e outro em `src/datasets/`.
3. Manter apenas uma publicação com `isDefault: true` e usar o mesmo ID minúsculo no diretório e em `identity.js`.
4. Rodar `npm run sites:list`, `npm run build -- --site=<id>` e `npm run build:check`.

Não adicione condicionais `if (id === ...)` ao renderer, template ou runtime para personalização editorial. Se surgir uma capacidade estrutural reutilizável, modele-a no contrato comum; se for apenas conteúdo/identidade, mantenha-a no módulo da publicação.

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
- Não renomeie IDs técnicos de domínio sem coordenar o pipeline; eles fazem parte do contrato dos arquivos. Altere apenas os labels públicos quando a grade subjacente for a mesma.
- Não mude os formatos anunciados no manifest (`labmim-data-manifest-v2`, `grid-edges-v1`, `grid-bounds-v1`, `domain-summary-v1`, `cell-series-int32-le-v1`) sem versionar um formato novo **e** manter o fallback — site e dados são publicados de forma desacoplada.
- `start_local` ancora o **índice 0** dos arquivos, nunca `index_min` — não "corrija" isso ao mexer em `applyManifest`.
- A variável `humidity` deve aparecer como Vapor d'Água / razão de mistura em `g/kg`; `relativeHumidity` é a umidade relativa em `%`.
- Não remova `theme-boot.js` do `<head>`.
- Use `LabmimDataService` para buscar JSON; não introduza `fetch` direto que ignore cache/dedup/cache negativo (exceções conscientes existentes: manifest com `cache: "no-cache"`, leitura Range do `series.bin` e o contorno estático da publicação).
- Ao atualizar uma biblioteca vendorizada, substitua o arquivo e atualize o token `?v=` manual no layout/partial de `src/template/`; CSS/JS próprios, `bootstrap.purged.min.css` e workers são hasheados automaticamente pelo build.
- Ao mexer em `maps.css`, valide light e dark mode.
- Ao mexer em `map-manager.js`, valide play/pause (incl. autoplay e pulos por disponibilidade), troca de domínio, troca de variável, troca de rodada (regenerar o manifest local), clique em célula e wind layer.
- Ao mexer em `charts-manager.js`, valide carregamento via `series.bin` E via fallback (sem manifest), cancelamento, troca de tema e exportação CSV.
- Não documente dados ou endpoints que não existam no código. Se um novo pipeline mudar contratos de arquivo, atualize este documento junto.

## Checklist De Validação

Use antes de merge/publicação:

- `npm run sites:list`, `npm run build:check`, `npm run lint`, `npm run format:check` (ou `npm run lint:all` para incluir HTML e links), `npm audit`.
- Servir `site/` por HTTP local (`make serve`).
- Abrir páginas institucionais em desktop e mobile; alternar dark mode em cada página.
- Abrir `mapas_interativos.html` e confirmar que Potencial Fotovoltaico não aparece como previsão; `SWDOWN` deve aparecer como Radiação Global.
- Abrir `potenciais_energeticos.html` e confirmar que só aparecem Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Verificar se Leaflet renderiza (bundle local) e se não há erros no console.
- Trocar variáveis e domínios (a grade não deve recarregar do zero).
- Confirmar os labels de domínio configurados para cada publicação na UI, mantendo as requisições internas nos IDs técnicos do respectivo dataset.
- Testar play/pause até passar do final da escala temporal (deve dar a volta para o primeiro passo disponível) e confirmar que passos indisponíveis são pulados.
- Com dados + manifest locais presentes, conferir que o slider vai até `index_max` do manifest e que o rótulo de data bate com `start_local`.
- Ativar `windLayerToggle` em `wind` e `eolico`; confirmar que fica oculto nas demais variáveis.
- Clicar em uma célula e validar sidebar; validar modal de séries temporais (rápido via `series.bin`) e exportação CSV.
