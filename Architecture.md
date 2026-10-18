# Arquitetura das publicações estáticas

Este documento descreve o frontend estático compartilhado hoje por LabMiM/UFBA e LEAL/UFES e sua fronteira de extensão para futuras publicações brasileiras. Ele deve ser usado como referência para manutenção, evolução do WebGIS e prevenção de regressões.

## Visão Geral

O projeto gera uma publicação por vez em `site/`, composta por HTML, CSS modular e JavaScript sem framework frontend. `build.js` descobre `src/sites/<id>/site.js`, valida o contrato completo, expande o template compartilhado, aplica conteúdo e tema próprios, gera SEO/404/robots/sitemap e carimba hashes de conteúdo nos assets. O deploy recebe arquivos estáticos puros; Node participa apenas do build local/CI.

Não há backend de aplicação neste repositório. Os dados são gerados pelo pipeline do repositório irmão [micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) (CLI `mm-wrf-geojson`) e publicados de forma desacoplada do site; por isso todo contrato de dados tem fallback no cliente.

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
| `site/monitoring.html`             | Monitoramento ambiental: gráficos interativos ou PNGs (ver abaixo)    |
| `site/team.html`                   | Equipe, links e localização incorporada (iframe Google My Maps)       |
| `site/climatologia.html`           | Distribuições observadas da estação, lidas de `Climatologia/`         |
| `site/ceu.html`                    | Câmera all-sky, sensibilidade à oclusão, cartão do modelo e dispersão Kt × Kd, de `Ceu/` |
| `site/mapas_interativos.html`      | WebGIS de previsões meteorológicas                                    |
| `site/potenciais_energeticos.html` | WebGIS de potencial fotovoltaico, potencial eólico e densidade eólica |
| `site/404.html`                    | Página de erro standalone (caminhos absolutos, `ErrorDocument 404`)   |

A rota `monitoring.html` tem duas fontes possíveis, escolhidas por `source:` na declaração da página: a variante viva (`src/template/pages/monitoring-live.html` + `assets/js/monitoramento.js`), para publicações que declaram `dataset.paths.monitoring`, e a variante estática (`src/template/pages/monitoring.html`), que desenha os PNGs de `dataset.observations` e é a fonte padrão do tipo `monitoring` em `page-types.js`. Hoje nenhuma publicação usa a estática: o LabMiM sobrescreve o `source:` pela variante viva e o LEAL não declara a página, porque não tem estação própria — os PNGs em `assets/graphs/` trazem a marca d'água do LabMiM. O catálogo de gráficos que preencheria `dataset.observations.charts` existe em `src/datasets/labmim-station-charts.js`, mas nenhum dataset o importa. O mesmo vale para `climatologia.html`, que só faz sentido com `dataset.paths.climatology` declarado. `ceu.html` tem fonte única e a mesma dependência: declará-la sem `dataset.paths.sky` falha o build (o diretório ainda ausente na árvore é só um aviso, o normal em CI), e hoje só o LabMiM a oferece, porque a câmera all-sky é dele.

Todas são declaradas no array de `src/sites/<id>/pages.js` e geradas por `build.js`. A fonte de `404.html` fica em `src/template/static/404.html` e mantém caminhos absolutos `/assets/...` para resolver em qualquer profundidade.

Todas as páginas usam **Bootstrap 5.3.8 vendorizado localmente**; as páginas geradas carregam o **CSS purgado** (`bootstrap.purged.min.css`, ~29 KB). Não há Bootstrap 4 nem jQuery no projeto. Leaflet e Chart.js também são carregados localmente (ver [Dependências Externas](#dependências-externas)).

A navbar e o rodapé são derivados das entradas `nav` do manifesto da publicação, ordenadas por `nav.order`. A página pode existir sem aparecer na navegação omitindo `nav`. Editar a estrutura da navbar/rodapé/`<head>` significa editar `src/template/partials/`, não `site/*.html`.

A lista concreta é consequência dessa regra, não uma regra à parte: na publicação da UFBA as entradas resolvem para Previsões, Potenciais Energéticos, Monitoramento, Céu, Climatologia e Equipe, nessa ordem — `nav.order` 10, 20, 30, 35, 40 e 50, declarados nos tipos correspondentes de `src/template/page-types.js`. A página inicial não declara `nav` e por isso não aparece na barra. Outra publicação monta outra barra a partir do próprio `pages.js`.

## Organização De Pastas

```text
build.js                              # orquestrador de descoberta, validação e renderização
scripts/
├── site-builder/
│   ├── publications.js              # descoberta/seleção automática
│   ├── validate.js                  # valida configuração, arquivos e GeoJSON do estado
│   ├── renderer.js                  # HTML, SEO, runtime config e estáticos
│   ├── assets.js                    # tema da publicação e hashes de conteúdo
│   ├── operational-paths.js         # o que é dado de deploy: por publicação x na árvore
│   ├── corpus.js                    # corpus de HTML/CSS/JS que os checks de asset varrem
│   ├── fontawesome-glyphs.js        # regras :before do Font Awesome, lidas pelo subset e pelo lint:icons
│   ├── references.js                # extração de href/src/url() usada pelos checks
│   ├── theme-contract.js            # tokens obrigatórios e limites do tema por publicação
│   └── cli.js                       # restauração da publicação padrão e saída de erro
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
└── datasets/                        # labmim-wrf.js, leal-wrf.js, labmim-station-charts.js

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
│   │   ├── references.js
│   │   ├── chart-page.js
│   │   ├── monitoramento.js
│   │   ├── climatologia.js
│   │   ├── ceu.js
│   │   ├── variables-config.js
│   │   ├── data-service.js
│   │   ├── charts-manager.js
│   │   ├── map-manager.js
│   │   ├── map-init.js
│   │   └── workers/
│   │       ├── color-calc.worker.js
│   │       └── json-parser.worker.js
│   ├── vendor/                     # bibliotecas vendorizadas localmente
│   │   ├── bootstrap/              # 5.3.8: bootstrap.purged.min.css (servido, inclusive no 404),
│   │   │                           #   bootstrap.min.css (só fonte do purge), bundle js
│   │   ├── fontawesome/            # 6.4.0: fa.subset.min.css (servido), all.min.css (só fonte do subset),
│   │   │                           #   subset-glyphs.json, webfonts/ (fa-solid-900.woff2 = subset; .full.woff2 = original)
│   │   ├── leaflet/                # 1.9.4 (js, css, images/)
│   │   └── chartjs/                # 3.9.1
│   ├── data/
│   │   ├── br_ba.json              # contorno da Bahia
│   │   └── br_es.json              # contorno do Espírito Santo
│   ├── graphs/                     # PNGs do monitoramento (regenerados pela estação)
│   └── img/
├── GeoJSON/                        # grades geradas pelo pipeline (git-ignored)
├── JSON/                           # valores, séries, resumos, manifest (git-ignored)
├── Climatologia/                   # distribuições observadas da estação (git-ignored)
├── Monitoramento/                  # janela móvel de 7 dias da estação (git-ignored)
└── Ceu/                            # câmera all-sky, frame/timeline/model.json e imagens (git-ignored)

dist/<id>/                           # bundles de frontend gerados em lote
└── ...                              # não inclui os diretórios de dados de dataset.paths
```

Observações:

- `assets/graphs/` contém os PNGs da estação que a variante estática de `monitoring.html` desenharia — hoje nenhuma página gerada os referencia —, regenerados pela estação **nos mesmos nomes de arquivo** (por isso o `.htaccess` os serve com `no-cache`).
- `assets/img/` contém logos e imagens institucionais (WebP + fallback PNG via `<picture>` para as versões redimensionadas).
- `assets/vendor/` contém bibliotecas de terceiros servidas localmente, evitando dependência de CDN no caminho crítico.
- `assets/data/br_ba.json` e `br_es.json` são os contornos referenciados pelos módulos de território atuais.
- O manifest real fica em `site/JSON/manifest.json` (gerado pelo pipeline).
- `GeoJSON/`, `JSON/`, `Climatologia/`, `Monitoramento/` e `Ceu/` contêm dados gerados e ficam fora do controle de versão. O `.gitignore` ignora os cinco **por diretório** — `site/JSON/*` com a exceção `!site/JSON/.keep`, e o mesmo para os outros quatro —, e não por extensão: além de JSON, chegam ali `.series.bin`, imagens do céu e os temporários `.{nome}.tmp-{pid}` que o pipeline grava no próprio diretório de destino antes de renomeá-los, e que uma exportação interrompida deixa para trás.
- Não abra, varra, formate ou reprocesse `/data`; evite ler conteúdo de `GeoJSON/` e `JSON/` fora de depuração estritamente necessária, porque esses diretórios contêm artefatos grandes do pipeline externo.

## Build, Validação E Cache Busting

O fluxo de um build é:

1. `publications.js` descobre todos os `src/sites/<id>/site.js` e seleciona `--site`, `SITE_ID` ou a publicação padrão; `--variant` e `SITE_VARIANT` continuam aceitos como aliases legados (`build.js`).
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

| Arquivo          | Responsabilidade                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `base.css`       | Tokens estruturais neutros, reset, tipografia, utilitários pequenos e logos                            |
| `site-theme.css` | Paleta da publicação selecionada; arquivo gerado, não editar diretamente                               |
| `layout.css`     | Navbar, seções de página, footer e estrutura compartilhada                                             |
| `components.css` | Cards, parceiros, financiadores, blocos de explicação, monitoramento, climatologia, céu, modal helpers |
| `theme.css`      | Dark mode, overrides de tema, estados de controles, ajustes globais de contraste                       |
| `maps.css`       | Layout e componentes exclusivos do WebGIS (inclui escada de z-index documentada)                       |

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

| Arquivo           | Responsabilidade                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme-boot.js`   | Aplica `.dark-theme` cedo com base em `localStorage` ou preferência do sistema                                                                  |
| `theme-toggle.js` | Controla botões de tema, ícones, `aria-*`, persistência e evento `labmim-theme-change`                                                          |
| `ui-shell.js`     | Toggle genérico `[data-ui-toggle]` (hidden + aria-expanded + chevron + label) e menu da navbar `[data-navbar-toggle]` (`.show` + aria-expanded) |
| `references.js`   | Expande os marcadores `[[chave]]` das páginas em links com o registro bibliográfico                                                             |

### Módulos De Página

Carregados só onde a página os declara em `scripts:` (ver [Adicionar Página](#adicionar-página)); nenhum deles calcula ciência — o número desenhado é o que o exportador Python publicou. As únicas derivações nesses módulos são a faixa de Kt que colore cada ponto em `ceu.js` e as curvas de referência que ele pode sobrepor, traçadas a partir das equações dos artigos, nunca ajustadas aos dados da página.

| Arquivo            | Responsabilidade                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart-page.js`    | Utilitários compartilhados pelas três páginas de gráfico (`window.labmimChartPage`): formatação pt-BR, carimbos de hora da estação e exportação CSV; carregado antes do módulo de cada página |
| `monitoramento.js` | Página de monitoramento viva: lê `labmim-monitoring-v1` de `dataset.paths.monitoring` e desenha bruto + horário + WRF                                                                         |
| `climatologia.js`  | Página de climatologia: lê `labmim-climatology-v1` de `dataset.paths.climatology`, distribuição medida + teórica                                                                              |
| `ceu.js`           | Página de condição do céu: lê `labmim-ktkd-v1` (e, sob demanda, `labmim-ktkd-points-v1`), `labmim-kt-cumulative-v1`, `labmim-allsky-frame-v2`, `labmim-allsky-timeline-v1` e `labmim-allsky-model-v1` de `dataset.paths.sky`                         |

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

No `<head>`: `theme-boot.js` (síncrono, para reduzir flash), `theme-toggle.js` e `ui-shell.js` (`defer`); `leaflet.js` (vendorizado) com `defer`. Antes de `</body>`, todos com `defer` e nesta ordem: `references.js`, `variables-config.js`, `data-service.js`, `charts-manager.js`, `map-manager.js`, `map-init.js`. O Chart.js (vendorizado) fica fora dessa lista: `ChartsManager.ensureChartJs()` injeta o script quando o modal de série da célula abre ou a prévia do domínio começa a carregar, em paralelo com o download dos dados, para que os 200 KB não atrasem o `DOMContentLoaded` que constrói o mapa. Todo CSS/JS próprio carrega com `?v=<hash de conteúdo>` estampado pelo build.

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

- **Cache LRU em memória**: limite base `DATA_SERVICE_CACHE_LIMIT` (400 entradas), recência renovada a cada hit; `ensureCacheLimit()` **cresce** o limite (nunca encolhe) quando o manifest anuncia uma rodada mais longa (`ceil(index_max * 5.5)`), para o loop de playback + vento + modal aberto caberem residentes. Além do teto de entradas, o cache despeja pelo LRU enquanto a soma estimada passar de `DATA_SERVICE_CACHE_BUDGET_BYTES` (32 MiB), a `RETAINED_BYTES_PER_JSON_NUMBER` (16 B, custo retido medido após o parse no worker) por número do payload; a entrada que acabou de entrar fica, mesmo que sozinha passe do orçamento. O orçamento em bytes não cresce com `ensureCacheLimit()`.
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
| `domain_availability`     | Mapa `domínio → variableId → [[início, fim], ...]`, só com as variáveis cuja faixa no domínio não é a cheia → vence `availability` no domínio exibido; domínio ou variável ausente → `availability` |
| `features.domain_summary` | Descritor `{format: "domain-summary-v1", template}` → habilita o resumo consolidado                                                                       |
| `features.cell_series`    | Descritor `{format: "cell-series-int32-le-v1", template, dtype, byte_order, scale, missing, index_min, index_max}` → habilita a leitura binária de séries |
| `features.isobar_overlay` | Descritor `{format: "isobars-v1", variable: "ISOBARS", draw_over[]}` → habilita a camada de isóbaras ao nível do mar sobre as variáveis de `draw_over`    |
| `radiation_instant`       | `{format: "radiation-instant-v1", variables[], offset_minutes{domínio: [min \| null por índice]}}` → minutos do rótulo do passo ao sol dos campos de onda curta; nas variáveis de `variables`, o painel da célula mostra "Cálculo da radiação" e o aviso de sol baixo do `KT` usa a elevação desse instante; ausente, com outro `format`, sem o domínio ou `null` no índice → só o rótulo |
| `step_seconds`            | `{format: "step-seconds-v1", seconds{domínio: [s \| null por índice]}}` → duração real do passo, em segundos inteiros, da saída anterior do wrfout até a deste índice (a mesma do `metadata.step_seconds` do `SW_IRRAD`); com ela, o painel da célula lê o `SW_IRRAD` no `.series.bin`; ausente, com outro `format`, sem o domínio ou `null` no índice → o painel lê o JSON do passo |

Ciclo de vida (`map-init.js`):

- O manifest é buscado **no parse do script** com `fetch(..., {cache: "no-cache"})` e corrido contra um timeout de 3 s — um manifest lento nunca atrasa o primeiro paint. Se perder a corrida, é adotado tardiamente (sem limpar caches) enquanto `dataVersion` ainda for nula.
- Re-checagem a cada 15 min (`MANIFEST_RECHECK_INTERVAL_MS`) e ao voltar o foco da aba (gap mínimo de 5 min), porque o pipeline regenera diariamente **nos mesmos nomes de arquivo**.
- Em versão nova, `handleManifestUpdate()`: `dataService.clear()`, `chartsManager.clearCaches()` + fecha modal/sidebar, descarta `gridLayers` (com token `_gridGeneration` que impede um fetch de grade em voo da rodada velha de repopular o cache), reancora a linha do tempo, ajusta `state.index` se o passo atual deixou de existir e repinta.
- **Degradação**: manifest v1 (sem `index_max`) reseta a linha do tempo para o padrão; sem manifest algum, o site usa o `timeline.defaultMaxLayer` do dataset (75 no LabMiM, 72 no LEAL), URLs sem `?v=` e a heurística solar legada — nada quebra, apenas perde as otimizações.

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

- `type`, `domain`, `index`, `accumHours`, `maxLayer`
- `isPlaying`, `hasUserControlledPlayback`, `intervalId`
- `isClippedToState`, `stateAbbr`
- `initialDateTime`, `initialIndex`
- `selectedCell`

Campos de instância relevantes fora de `this.state`: `dataVersion` e `timeline` (`indexMin`/`indexMax`/`availability`/`domainAvailability`/`features`/`startLocal`/`radiationInstant` — o contrato vindo do manifest), `windHeight` (50/100/150), `currentValueData` e `_currentValueKey` (dados atuais e a chave `(versão, domínio, variável, hora)` que eles representam), `_currentApply` (carga em voo), `gridLayers` (cache de grade por domínio) e `dataService`. Elementos de DOM usados com frequência são cacheados em `this.ui`.

O painel "Sobre as variáveis" é controlado por `setupVariableOverview()`; inicia com `is-collapsed` e só carrega a prévia visual quando expandido (prévia usa o resumo de domínio, com refresh debounced de 250 ms).

### Domínios

`dataset.domains` separa o ID técnico do label exibido e é serializado no `site-config` consumido pelo runtime. Cada domínio declara `id`, labels curto/longo, centro, zoom, resolução, descrição e se usa parametrização de cumulus. O dataset também declara `defaultDomain`.

Os produtos atuais usam IDs técnicos `D01`–`D04`, mas apresentam labels geográficos próprios: LabMiM usa `BA/NE`, `BA`, `RMS` e `SSA`; LEAL usa `S/SE/NE`, `Sudeste`, `ES` e `Grande Vitória`. O ID técnico continua nos nomes dos arquivos, cache e estado e não deve ser inferido do label.

Os botões `.domain-btn` atualizam `this.state.domain` e recarregam dados. Se o passo exibido existia no domínio anterior e não existe no novo (faixas próprias do `domain_availability`), ele avança para o próximo passo publicado, como na troca de variável. O cache de grade **não** é limpo na troca de domínio/variável/altura — a grade depende só do domínio (só `handleManifestUpdate` descarta grades, na troca de rodada). O domínio não troca automaticamente por zoom.

### Carregamento De Dados

O fluxo principal é:

1. `applyMapChanges()` — verifica disponibilidade do passo (`isIndexAvailable`) e define `_currentApply` com a chave da visão.
2. `loadValueData(index, type)`.
3. `getVariableId(type)` resolve o ID (para `eolico`, depende de `windHeight`).
4. `Promise.all([_cachedFetch(JSON/...), loadGridLayer(domain)])` — valor e grade em **paralelo**.
5. `applyValuesToGrid(gridLayer, valueData)` — cores via `color-calc.worker.js`.
6. `showGeoJsonLayer(gridLayer)` e `updateUIFromMetadata(metadata)`.
7. `_prefetchUpcoming()` aquece os próximos 2 passos reproduzíveis (`PREFETCH_AHEAD_STEPS`; pulado sob `navigator.connection.saveData`; inclui `WIND_VECTORS` quando a camada de vento está ligada em `wind`, e o arquivo de `features.isobar_overlay.variable` (`ISOBARS`) quando as isóbaras estão ligadas e a variável está em `draw_over`). Ligar a camada de isóbaras já dispara o aquecimento.

A máscara de recorte por estado é computada **preguiçosamente**, apenas quando o recorte está ativo (custa centenas de ms em mobile) e memoizada por grade.

Resultados de carga são descartados se a chave (`_loadKey` = versão:domínio:variável:passo) já não corresponde à visão atual — o mapa nunca pinta dados velhos sob um rótulo novo. Em falha de carga, `_clearCurrentData()` remove camada, dados e vetores de vento juntos. `handleMapClick()` usa `currentValueData` (fonte da verdade), confere `_currentValueKey` e aguarda a carga em voo quando necessário.

### Disponibilidade E Playback

`isIndexAvailable(index, type, domain)` (domínio padrão: o exibido):

1. Com manifest v2, índices fora de `[indexMin, indexMax]` são indisponíveis.
2. `availabilityRanges(variableId, domain)` devolve as faixas de `domain_availability[domínio][variableId]` e, na falta delas, as de `availability[variableId]`. Se há faixas para o ID resolvido da variável, o índice precisa cair em alguma (vale para qualquer variável, não só `SWDOWN`). `availability` é a interseção dos domínios; as faixas por domínio liberam os passos que só aquele domínio escreveu (o `KT` do D01 às 06 h e às 17 h na rodada de 08/08/2026). O rótulo "Média diurna" da prévia e o filtro de variáveis sem passo do modal e da prévia (`hasPublishedSteps(type, domain)`) leem as mesmas faixas do domínio.
   Variáveis com `publishedSteps: "listed"` (hoje `shortwaveIrradiation`, id `SW_IRRAD`, e `clearSkyIndex`, id `KSTAR`) param aqui: sem faixas no domínio nem no `availability`, seja por manifesto antigo, por falta de manifesto v2 ou por rodada sem RRTMG, ficam indisponíveis em todos os passos. `hasPublishedSteps()` as tira do seletor e dos cartões, e nenhum arquivo delas é pedido, nem como variável auxiliar do painel (`loadAllVariableValuesForCell()` pula o passo indisponível) nem como série do modal ou da prévia. Isso exige que o produtor liste as duas em `availability` sempre que a rodada as publica, mesmo quando a faixa é a cheia `[index_min, index_max]`, e escreva `[]` quando não há passo, que o site já lê como indisponível. Pela regra geral, que omite a faixa cheia, uma rodada com `index_min` ≥ 1 tiraria o `SW_IRRAD` do `availability`, e a Radiação Global e o solar voltariam à estimativa pelo fluxo × 1 h com os arquivos no disco; hoje ele só aparece porque `index_min` é 0.
3. Fallback legado: só as variáveis com `publishedSteps: "daylight"` ou `"daylight-zero-night"` (`solar` e `globalRadiation`, ambas `SWDOWN`, `shortwaveUp` e `netShortwave` com `"daylight-zero-night"`; `clearnessIndex` com `"daylight"`; o subconjunto de `DAYLIGHT_ONLY_VARIABLES` de `value_source.py` no pipeline sem o `KSTAR`, que é `"listed"` pelo item 2) são gatadas à janela 6h–18h **derivada da âncora de data** (`calculateTargetDateFromIndex`) — não existe mais a heurística `(index-1)%24`; sem âncora, o índice é permitido de forma otimista. As demais não declaram `publishedSteps` e valem `"all"` (é o que `publishedStepsOf()`, em `variables-config.js`, devolve para a omissão), todo passo da linha do tempo. Qualquer outro valor lança erro no carregamento de `variables-config.js`.

O rótulo "Média diurna" da prévia (`_meanCoversDaylightOnly()`, em `charts-manager.js`) exige `publishedSteps: "daylight-zero-night"`, que só os fluxos de onda curta declaram: a noite que falta na média é fluxo zero, e a média dos passos publicados fica acima da do período. O `KT` e o `KSTAR` são índices, sem valor à noite, e mantêm "Média".

`nextPlayableIndex()` avança pulando passos indisponíveis e dá a volta para `timeline.indexMin`. A animação (`startAnimation`, tick de 800 ms) usa esse mecanismo; durante o playback, um 404 inesperado dispara `_maybeFastSkipEmptyFrame` (pulo em 50 ms, com guarda de streak para o modo degradado sem manifest).

### Recorte Por Estado

`loadStateGeoJson()` busca o `boundaryAsset` declarado pelo território da publicação (`assets/data/br_ba.json` ou `br_es.json`, local, fetch direto), nunca um caminho montado a partir do código do estado — o estreitamento por alcançabilidade do `build:all` só varre HTML e CSS, e um caminho montado daria 404. `_precomputeStateMask()` marca cada célula com um _point-in-polygon_ local (ray casting sobre Polygon/MultiPolygon) — o antigo Turf.js foi removido. O botão de recorte só aparece quando o contorno carrega; se falhar, o mapa renderiza sem recorte.

## Contratos De Dados

### Produtor Dos Dados

O frontend consome produtos preparados pelo `micrometeorology`; o build não
executa o processamento científico. Versões de contrato, contagens e valores
finitos são validados antes da renderização. Mudanças devem preservar a
compatibilidade entre os dois projetos e ser verificadas com fixtures artificiais.

### Produtos apresentados

Os WebGIS combinam geometria, campos meteorológicos e séries temporais. Céu e
Climatologia apresentam distribuições e métricas calculadas no produtor. O
Monitoramento conserva a resolução necessária ao diagnóstico dos sensores.

O frontend distingue a população científica da amostra visual de Kt × Kd, limitada
a 5.000 pontos e 25% do conjunto. A ausência ou inconsistência da amostra não
impede a apresentação dos agregados válidos. As exportações completas para
artigos são uma atividade local dos pesquisadores com seu próprio acervo.

A documentação pública não enumera rotas de observações nem procedimentos de
extração. Detalhes operacionais, acesso a fontes e configuração da hospedagem
ficam fora dos repositórios. Para desenvolvimento, use dados próprios autorizados
ou as fixtures artificiais dos testes.

## Variáveis E Palhetas

As variáveis ficam em `VARIABLES_CONFIG` (23 chaves):

| Chave              | ID principal             | Observação                                             |
| ------------------ | ------------------------ | ------------------------------------------------------ |
| `globalRadiation`  | `SWDOWN`                 | Radiação Global no contexto de Previsões               |
| `shortwaveIrradiation` | `SW_IRRAD`           | Energia do passo pela diferença do `ACSWDNB`, em kJ/m² |
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
| `shortwaveUp`      | `SWUP`                   | Onda curta refletida pela superfície                   |
| `netShortwave`     | `SWNET`                  | Saldo de onda curta                                    |
| `longwaveUp`       | `LWUP`                   | Onda longa emitida pela superfície                     |
| `netLongwave`      | `LWNET`                  | Saldo de onda longa                                    |
| `netRadiation`     | `RNET`                   | Saldo de radiação                                      |
| `skyEmissivity`    | `EPS_SKY`                | Emissividade do céu, adimensional                      |
| `clearnessIndex`   | `KT`                     | Publicado só com o sol acima de 10° de elevação        |
| `clearSkyIndex`    | `KSTAR`                  | `SWDOWN / SWDNBC`; dá a classe Céu do painel do `KT`   |
| `hfx`              | `HFX`                    | Calor sensível                                         |
| `lh`               | `LH`                     | Calor latente                                          |
| `windPowerDensity` | `WIND_POWER_DENSITY_10M` | Densidade de potência eólica a 10m                     |

As sete entre `shortwaveUp` e `clearnessIndex` são derivadas do balanço de radiação à superfície e chegam prontas do pipeline, como as demais. `clearnessIndex` e `clearSkyIndex` são as únicas que produzem ausência em volume: os quocientes ficam sem valor abaixo do corte de elevação solar (e o `k*` também sobre a área de um domínio interno), então os passos de crepúsculo vêm com `null` em parte das células — e, em rodadas geradas antes do portão que os suprime, com `null` em **todas**. Um passo inteiramente vazio é estado possível, não anomalia: a página desenha o mapa sem células e não deve tratá-lo como falha de carregamento.

A ordem da tabela acima é editorial e não é a que o usuário vê. `VARIABLE_CONTEXTS.forecast` declara as variáveis de Previsões na ordem do balanço de energia, não por nome — `temperature`, `skinTemperature`, `rain`, `humidity`, `relativeHumidity`, `pressure`, `wind`, `globalRadiation`, `shortwaveIrradiation`, `shortwaveUp`, `netShortwave`, `longwave`, `longwaveUp`, `netLongwave`, `netRadiation`, `hfx`, `lh`, `skyEmissivity`, `clearnessIndex` e `clearSkyIndex` —, e `VARIABLE_CONTEXTS.energy` declara as três de Potenciais Energéticos: `solar`, `eolico` e `windPowerDensity`. É essa ordem que `configureVariableSelect()` reproduz ao montar o `<select>` em runtime. Reordenar a tabela deste documento não muda nada; mexer nos arrays de `variables-config.js` muda a interface.

Cada entrada define ao menos `id`, `label`, `unit`, `colors` e `specificInfo(value, allValues)`. `scaleMin`/`scaleMax` são o caso normal, mas não obrigatórios: `pressure` os omite de propósito (o campo é PSFC, sobre o terreno) e cai no `metadata.scale_values` do arquivo. `allValues` traz, por variável, `value`, `label`, `unit`, `stepSeconds` e `ausente: true` quando ela não pôde ser carregada. `stepSeconds` é a duração real do passo, resolvida uma vez por `stepSecondsFor()` em `map-manager.js`: o `step_seconds` do manifest, senão o `metadata.step_seconds` do JSON do `SW_IRRAD` daquele passo já em cache, senão `null`. Com `cell_series` no manifest, as auxiliares saem do `.series.bin` (ver [Série Binária Por Célula](#série-binária-por-célula)), menos as que declaram `panelNeedsStepMetadata`, que só saem dele quando `stepSecondsFor()` já conhece a duração do passo; senão vêm do JSON do passo, que a traz. É assim que o painel mostra a duração real do passo do `SW_IRRAD`, e por isso `shortwaveIrradiation` declara a flag. Campos opcionais: `relatedVariables` (variáveis auxiliares buscadas para a sidebar), `chartCompanions` (séries companheiras carregadas para os gráficos — ex.: temperatura para `solar`; temperatura, pressão e vapor para `eolico`), `id_100m`/`id_150m` (eólico), `publishedSteps` (`"all"` quando omitido, `"daylight"`, `"daylight-zero-night"` ou `"listed"`; ver [Disponibilidade E Playback](#disponibilidade-e-playback)), `panelNeedsStepMetadata` (a auxiliar do painel sai do JSON do passo, e não do `.series.bin`, enquanto `stepSecondsFor()` não conhecer a duração daquele passo), `stepTotal` (o valor é o total do passo que termina no rótulo, como em `RAIN` e `SW_IRRAD`, e o modal e a prévia o desenham em degraus: ver `ChartsManager` em [Sidebar E Modal De Séries Temporais](#sidebar-e-modal-de-séries-temporais)), `optionLabel`, `icon`/`faIcon`, `sourceId` e `summary`. A ordem de resolução da escala em `getScaleValues()` (em `map-manager.js`, não em `variables-config.js`) é: paradas explícitas de `scaleStops` → rampa linear de `scaleMin`/`scaleMax` com `SCALE_TICK_COUNT` (10, constante do módulo) → `metadata.scale_values` do arquivo. `scaleStops` serve ao campo concentrado nos valores baixos: a precipitação usa 0,1 / 0,5 / 1 / 2,5 / 5 / 10 / 20 / 30 / 50 mm por hora, e `getVariableConfig()` multiplica essas paradas pelas horas de fato somadas na janela de `accumulation`: o triplo no acumulado de 3h e o dobro no quadro "(2h de 3h)" do início da rodada, para a mesma intensidade horária receber a mesma cor. A barra de cores espaça as paradas por igual e as rotula como estão escritas, sem o arredondamento comum de `colorbarDecimals()`, então cada rótulo fica na cor que o valor dele recebe. (Os antigos `useDynamicScale`/`normalValue`, e também `scaleTicks`/`scaleTickCount`, não existem mais.)

Parâmetros dos modelos de energia do frontend (editáveis na sidebar, persistidos em `localStorage` `meteoMapCustomParameters`): solar — `panelEfficiency` 18%, `inversorEfficiency` 95%, `noct` 45 °C, `ptc` −0,38%/°C; eólico — `rotorDiameter` 40 m, `Cp` 0,4. A densidade do ar do eólico não é parâmetro: sai da própria célula, `PSFC / (287,05 · T2 · (1 + 0,61 · Q2))`, com `pressure`, `temperature` e `humidity`, e sem qualquer um dos três a densidade, a potência e a produção ficam N/D. O solar tira a energia do passo do `SW_IRRAD` (kJ/m² ÷ 3,6 = Wh/m²) e o fluxo médio da correção térmica de `SW_IRRAD · 1000 / step_seconds`; o gráfico e o CSV leem o `.series.bin`, que não traz `step_seconds`, e tomam a duração de cada passo de `stepSecondsFor()`; quando ela não é conhecida (manifest sem `step_seconds` e JSON do passo fora do cache), usam 1 h (`NOMINAL_STEP_SECONDS`), o que muda a produção em menos de 0,01 Wh/m² no D04 e em até cerca de 0,4 Wh/m² com os passos de 3.520 e 3.680 s do D01. Sem `SW_IRRAD`, o painel, o gráfico e o CSV voltam à estimativa pelo fluxo instantâneo × 1 h e a rotulam assim; com a série do `SW_IRRAD` carregada, a hora que não a tem fica sem produção em vez de misturar os dois métodos sob um só rótulo. `specificInfo()` emite itens estruturados com `energyValue`, consumidos pelo gráfico de energia e pelo CSV (nunca por parsing de texto formatado).

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

## Toggle Da Camada De Vento

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
- Reutiliza instâncias Chart.js e as atualiza no modo `instantRefresh`, uma transição de duração zero declarada em `_buildChartConfig`, e não com `.update("none")`: nos modos `"none"` e `"reset"` o Chart.js 3.9.1 não recalcula as opções compartilhadas dos pontos, e a cor e o raio ficariam os da primeira variável aberta. Todos os gráficos são de linha (Chart.js 3.9.1).
- Totais de passo saem em degraus, não em curva suavizada: as variáveis com `stepTotal` e a energia do `solar` calculada pelo `SW_IRRAD`. Cada total ocupa o intervalo que termina no seu rótulo, com `stepped: "after"` e eixo a partir de zero, e a altura do degrau sobre cada hora é o total dela. No Chart.js 3.9.1 é o `"after"` que põe o valor do ponto sobre o intervalo que termina nele; o `"before"` o empurra para a hora seguinte. O tooltip acompanha o degrau pelo modo de interação `stepEndingAtCursor`, registrado em `Chart.Interaction.modes`: ele escolhe o primeiro rótulo sob o cursor ou à direita dele, o que fecha o degrau sob o cursor, enquanto o modo `"index"` escolheria o rótulo mais próximo e mostraria a hora anterior na metade esquerda de cada degrau. Como a instância é reaproveitada, a forma e o modo são reatribuídos a cada troca de variável. O `"after"` só desenha o degrau de um ponto a partir do ponto anterior, e o primeiro passo de cada trecho, o da rodada e o primeiro depois de uma lacuna, não tem esse ponto. `_withOpeningStepAnchors()` cria uma âncora no rótulo que abre o intervalo, com o mesmo valor do passo: o nulo da lacuna ou, quando o trecho começa no primeiro rótulo, um rótulo a mais na hora anterior, acrescentado ao eixo. A âncora não tem marcador, o `stepEndingAtCursor` a ignora, e ela não chega ao CSV nem às estatísticas da prévia, que leem a série original, nem ao `aria-label` do modal nem ao da prévia, que começam no primeiro rótulo da série. No modal do `solar`, o gráfico do `SWDOWN` ganha o mesmo rótulo a mais, sem valor, para que os dois gráficos empilhados dividam o eixo de tempo e marquem as mesmas horas. Uma lacuna de uma única hora fica sem âncora: o rótulo nulo fecha essa hora sem valor, e repetir nele o valor seguinte ligaria o trecho anterior e desenharia sobre essa hora um degrau inventado. Ali o passo seguinte continua sem degrau: no modal fica só o ponto do rótulo, e na prévia, que só marca os pontos de cobertura parcial, ele não aparece. A energia solar estimada pelo fluxo × 1 h continua em curva, como o próprio `SWDOWN`, e a do `eolico` também: ela é a potência do vento instantâneo do rótulo × 1 h, não o total da hora, e o painel, o gráfico e o CSV a rotulam como estimativa: "Produção Energética Estimada (potência × 1h)", "Produção Estimada (potência × 1h)" e "Produção em 1h estimada pela potência instantânea".
- Formata rótulos e CSV com `timeZone: "UTC"` para **preservar os dígitos de horário local** das saídas WRF, consistente com o rótulo do mapa; datas de metadados são parseadas por `parseDateTime`/`_parseMetadataDate` (seguro no Safari/WebKit).
- Exporta CSV com data, hora, latitude, longitude, domínio, variável e valores (+ coluna de produção para `solar`/`eolico`).
- Acessibilidade do modal: ao abrir, o foco vai ao botão de fechar; Tab/Shift+Tab ficam presos dentro do modal (focus trap); Escape fecha; ao fechar, o foco volta ao elemento de origem.

Para `solar` e `eolico`, o modal também exibe uma série derivada de energia (canvas `chartCanvasEnergy`), calculada por `specificInfo()` com os parâmetros customizáveis.

## Componentes Compartilhados

- Navbar e footer: `layout.css`.
- Cards e seções institucionais: `components.css`.
- Parceiros e financiadores: classes `.partners-section`, `.partners-grid`, `.partner-logo`, `.sponsors-strip`.
- Toggle de explicação em `monitoring.html`, `climatologia.html` e `ceu.html`: `ui-shell.js` via atributos `data-ui-toggle`.

## `.htaccess`

As regras são geradas pelo build para cada publicação e fazem parte do bundle.
Configuram redirecionamentos, tipos de conteúdo, cache e restrições de acesso.
A configuração da hospedagem deve aplicar as regras e ser validada pelos
mantenedores; os testes usam Apache local e fixtures artificiais.

## Exportação e acesso aos dados

Hover, seletores e ampliação permanecem disponíveis nos gráficos de pesquisa.
Céu e Monitoramento não oferecem CSV; na climatologia a exportação é
permitida apenas para recortes WRF. Os WebGIS mantêm suas exportações.

O produtor limita as observações disponibilizadas para a visualização pública.
As figuras completas de pesquisa são geradas localmente a partir do acervo
autorizado e não integram a publicação. O Monitoramento conserva as séries de
5 minutos para diagnóstico dos sensores. A câmera conserva suas interações.

A configuração pública e o publicador devem evoluir juntos. Os testes de
servidor verificam as restrições; os testes de interface conferem os controles,
a ausência de exportação de observações e a apresentação dos modos locais.

## Deploy Em Produção

A publicação usa o bundle gerado para a instituição e é responsabilidade dos
mantenedores. Mudanças de formato exigem coordenar frontend e produtor e validar
a compatibilidade antes da atualização. Credenciais, rotinas de aquisição,
particularidades da hospedagem e procedimentos de publicação ou recuperação
pertencem à documentação interna, mantida fora dos repositórios.

## Dependências Externas

Vendorizadas localmente (sem CDN no caminho crítico):

- Bootstrap 5.3.8 — `assets/vendor/bootstrap/` (`bootstrap.purged.min.css` servido às páginas + `bootstrap.bundle.min.js` com `defer` só na variante estática de `monitoring.html`, declarado pela publicação que a usa, para os modais das observações; `bootstrap.min.css` completo mantido apenas como fonte do purge). O menu da navbar abre por `ui-shell.js`, sem o JavaScript do Bootstrap.
- Font Awesome 6.4.0 — `assets/vendor/fontawesome/` (`css/fa.subset.min.css` servido às páginas + subset `fa-solid-900.woff2` com preload; `css/all.min.css` e `fa-solid-900.full.woff2` completos mantidos apenas como fonte do subset; manifesto `subset-glyphs.json`).
- Leaflet 1.9.4 — `assets/vendor/leaflet/` (`leaflet.js` com `defer`).
- Chart.js 3.9.1 — `assets/vendor/chartjs/`.
- Contornos da Bahia e do Espírito Santo — `assets/data/br_ba.json` e `assets/data/br_es.json`.

Origens externas (fora do caminho crítico de CSS/JS):

- Tiles do mapa base via OpenStreetMap (apenas páginas WebGIS; host `tile.openstreetmap.org`, com preconnect no layout webgis).
- Iframe Google My Maps em `team.html` (liberado no CSP).

> O Bootstrap foi **unificado em uma única versão vendorizada (5.3.8)**; Bootstrap 4, jQuery e Popper foram **removidos**. O Turf.js também foi removido (máscara de recorte por _point-in-polygon_ local).

Ferramentas de desenvolvimento (em `package.json`, ver também `.nvmrc` = Node 24 LTS):

- ESLint 10 (flat config em `eslint.config.mjs`, com globals do projeto).
- Stylelint 17 (+ `stylelint-config-standard` 40).
- Prettier 3.9 (também roda dentro de `npm run build`; os templates HTML em `src/` ficam fora por conterem tokens `{{...}}`).
- html-validate 11 (`lint:html`, config em `.htmlvalidate.json`) e linkinator (`lint:links`, só links internos).
- Guards de arquitetura/assets: `scripts/check-site-themes.mjs` (`lint:themes`), `scripts/check-fa-subset.mjs` (`lint:icons`) e `scripts/check-bootstrap-purge.mjs` (`lint:purge`); PurgeCSS (devDependency) regenera o CSS purgado com `scripts/purgecss.config.cjs`.
- CI em `.github/workflows/ci.yml`: `build:check`, `lint:js`, `lint:css`, `lint:themes`, `lint:icons`, `lint:purge`, `format:check`, `lint:html`, `lint:links`, `npm run check:audit` (`npm audit` que reprova em high ou critical, salvo advisory sem correção registrado com motivo e data de revisão em `scripts/audit-allowlist.json`). Dependabot em `.github/dependabot.yml` (npm + GitHub Actions, mensal, PRs agrupados num único grupo multi-ecossistema).

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

- Bootstrap purgado (~29 KB) com guard de cobertura; subset do Font Awesome (~6 KB) com guard e guia de regeneração; imagens WebP com `<picture>`.
- Grade compacta `grid.json` preferida sobre o `.geojson`; manifest de versão de dados; prefetch de playback; cache LRU com TTLs de falha separados.

Rodada 2026-07-18/19 (linha do tempo por manifest — `feat/manifest-timeline-ingest`):

- Manifest v2 passou a dirigir o slider (`index_min`/`index_max`), a âncora de data (`start_local`) e a disponibilidade por variável (`availability`) — os hardcodes de 73 passos e a heurística solar `(index-1)%24` foram removidos.
- Re-checagem do manifest em sessão (15 min + foco da aba) com ressincronização completa na troca de rodada.
- Ingestão dos artefatos consolidados: `series.bin` (série de célula via HTTP Range) e `summary.json` (resumo de domínio), com fallback para a varredura legada.
- Cache busting por hash de conteúdo nos assets próprios e nos workers (meta `labmim-asset-hashes`), com regras `immutable` correspondentes no `.htaccess`.
- Acessibilidade: padrão ARIA de abas completo na documentação do WebGIS (roles, roving tabindex, setas/Home/End), focus trap + devolução de foco no modal de séries, `<span>` no título do seletor de altura (era um `<label>` órfão).
- Hover da grade delegado ao grupo Leaflet (`e.propagatedFrom`) em vez de 2 closures por célula; tiles OSM movidos para `tile.openstreetmap.org` (host canônico); regras de cache do `.htaccess` estendidas aos `.series.bin`; ano do rodapé gerado no build (`{{YEAR}}`, resolvido do conteúdo do repositório: `BUILD_YEAR` → ano do © já gravado em `site/index.html` → data do último commit, nessa ordem, para que uma reconstrução não divirja da saída commitada).
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

Uma página carrega JS/CSS próprios pelos slots `scripts`, `vendorScripts`, `styles` e `vendorStyles` da declaração — o que o layout já traz é somado sem duplicar, então declare apenas o que é daquela página (`scripts: ["assets/js/climatologia.js"]`). É por isso que o Chart.js e os controladores de página só entram onde alguém desenha.

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
4. Acrescentar o card da variável na aba **Variáveis** da documentação do WebGIS — `src/template/pages/mapas_interativos.html` ou `src/template/pages/potenciais_energeticos.html`, conforme o contexto. Cada variável tem ali um `<details>` com unidade, id do JSON, fonte no WRF, fórmula e limitações; sem ele a variável entra no mapa sem documentação física.
5. Validar sidebar, colorbar, séries temporais e dark mode.

### Alterar Palheta

Atualize `colors` da variável em `variables-config.js`. Para escalas comparáveis entre horários, use `scaleMin`/`scaleMax`; `metadata.scale_values` fica como último fallback.

### Alterar Layout Institucional

Use os módulos CSS compartilhados. Evite criar regras específicas no HTML.

### Evoluir O WebGIS

`map-manager.js` (~2.900 linhas) ainda concentra estado, manifest/linha do tempo, eventos, cache de grade, renderização, isóbaras e sidebar. As extrações de `data-service.js` e dos consumidores de artefatos consolidados em `charts-manager.js` foram os primeiros passos; os próximos candidatos naturais são separar a renderização da grade/vento e o controle de UI/sidebar em módulos próprios. Faça isso com testes manuais cuidadosos.

## Cuidados Para Evitar Regressões

- Preserve os IDs usados pelo JS nas páginas WebGIS: `map`, `layerSlider`, `playPauseBtn`, `variableSelect`, `windLayerToggle`, `windLayerCheckbox`, `windVectorCanvas`, `sidebar`, `sidebarContent`, `timeSeriesModal`, `chartCanvasValue`, `chartCanvasEnergy`, `variableOverviewPanel`.
- Não altere nomes de chaves em `VARIABLES_CONFIG` sem revisar dados, gráficos e sidebar.
- Não renomeie IDs técnicos de domínio sem coordenar o pipeline; eles fazem parte do contrato dos arquivos. Altere apenas os labels públicos quando a grade subjacente for a mesma.
- Não mude os formatos anunciados no manifest (`labmim-data-manifest-v2`, `grid-edges-v1`, `grid-bounds-v1`, `domain-summary-v1`, `cell-series-int32-le-v1`, `isobars-v1`) sem versionar um formato novo **e** manter o fallback — site e dados são publicados de forma desacoplada.
- `start_local` ancora o **índice 0** dos arquivos, nunca `index_min` — não "corrija" isso ao mexer em `applyManifest`.
- A variável `humidity` deve aparecer como Vapor d'Água / razão de mistura em `g/kg`; `relativeHumidity` é a umidade relativa em `%`.
- Não remova `theme-boot.js` do `<head>`.
- Preserve os nomes globais que os módulos publicam: `window.MeteoMapManager` (`map-manager.js`), `window.ChartsManager` (`charts-manager.js`) e `window.LabmimDataService` (`data-service.js`). Não há bundler nem `import` no runtime do navegador — é por esses nomes que `map-init.js` instancia o mapa e os gráficos e que `MeteoMapManager` cria o serviço de dados —, então renomeá-los quebra a inicialização do WebGIS.
- Use `LabmimDataService` para buscar JSON; não introduza `fetch` direto que ignore cache/dedup/cache negativo (exceções conscientes existentes: manifest com `cache: "no-cache"`, leitura Range do `series.bin` e o contorno estático da publicação).
- Ao atualizar uma biblioteca vendorizada, substitua o arquivo e atualize o token `?v=` manual no layout/partial de `src/template/`; CSS/JS próprios, `bootstrap.purged.min.css`, `fa.subset.min.css` e workers são hasheados automaticamente pelo build.
- Ao mexer em `maps.css`, valide light e dark mode.
- Ao mexer em `map-manager.js`, valide play/pause (incl. autoplay e pulos por disponibilidade), troca de domínio, troca de variável, troca de rodada (regenerar o manifest local), clique em célula e camada de vento.
- Ao mexer em `charts-manager.js`, valide carregamento via `series.bin` E via fallback (sem manifest), cancelamento, troca de tema e exportação CSV.
- As imagens de `Ceu/` (`allsky.jpg`, `input.jpg`, `attribution.png`) reusam os mesmos nomes a cada publicação: o `?v=` vem do `sha256_12` que `frame.json` publica para cada uma; não troque os nomes fixos por nomes versionados sem coordenar o pipeline.
- Documente o comportamento e os limites públicos. Mantenha procedimentos de acesso, aquisição e recuperação fora dos repositórios.

## Checklist De Validação

Use antes de merge/publicação:

- `npm run sites:list`, `npm run build:check`, `npm run lint`, `npm run format:check` (ou `npm run lint:all` para incluir HTML e links), `npm run check:audit`.
- Servir `site/` por HTTP local (`make serve`).
- Abrir páginas institucionais em desktop e mobile; alternar dark mode em cada página.
- Abrir `ceu.html` com e sem `site/Ceu/` populado: quadros, slider de opacidade do mapa de sensibilidade, cartão da previsão, linha do tempo, cartão do modelo, alternância das quatro condições, curva de referência, ampliação e ausência do botão CSV; sem dados, deve aparecer o aviso de que eles chegam pelo deploy.
- Abrir `mapas_interativos.html` e confirmar que Potencial Fotovoltaico não aparece como previsão; `SWDOWN` deve aparecer como Radiação Global.
- Abrir `potenciais_energeticos.html` e confirmar que só aparecem Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Verificar se Leaflet renderiza (bundle local) e se não há erros no console.
- Trocar variáveis e domínios (a grade não deve recarregar do zero).
- Confirmar os labels de domínio configurados para cada publicação na UI, mantendo as requisições internas nos IDs técnicos do respectivo dataset.
- Testar play/pause até passar do final da escala temporal (deve dar a volta para o primeiro passo disponível) e confirmar que passos indisponíveis são pulados.
- Com dados + manifest locais presentes, conferir que o slider vai até `index_max` do manifest e que o rótulo de data bate com `start_local`.
- Ativar `windLayerToggle` em `wind` e `eolico`; confirmar que fica oculto nas demais variáveis.
- Clicar em uma célula e validar sidebar; validar modal de séries temporais (rápido via `series.bin`) e exportação CSV.
