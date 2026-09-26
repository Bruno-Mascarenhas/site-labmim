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

A rota `monitoring.html` tem duas fontes possíveis, escolhidas por `source:` na declaração da página: a variante viva (`src/template/pages/monitoring-live.html` + `assets/js/monitoramento.js`), para publicações que declaram `dataset.paths.monitoring`, e a variante estática (`src/template/pages/monitoring.html`), que desenha os PNGs de `dataset.observations` e é a fonte padrão do tipo `monitoring` em `page-types.js`. Hoje nenhuma publicação usa a estática: o LabMiM e o LEAL sobrescrevem o `source:` pela variante viva, cada um com o `paths.monitoring` do próprio dataset. Os PNGs em `assets/graphs/` trazem a marca d'água do LabMiM e não servem ao LEAL. O catálogo de gráficos que preencheria `dataset.observations.charts` existe em `src/datasets/labmim-station-charts.js`, mas nenhum dataset o importa. O mesmo vale para `climatologia.html`, que só faz sentido com `dataset.paths.climatology` declarado. `ceu.html` tem fonte única e a mesma dependência: declará-la sem `dataset.paths.sky` falha o build (o diretório ainda ausente na árvore é só um aviso, o normal em CI), e hoje só o LabMiM a oferece, porque a câmera all-sky é dele.

`medias_anuais.html` (tipo `annual-means`) é um terceiro WebGIS, publicado hoje só pelo LEAL e fora do sitemap. Ele mostra a média de cada hora local do dia sobre um ano de rodadas do WRF e lê um diretório próprio, `dataset.paths.annualMeans`, com manifesto e grades próprios; declarar a página sem esse caminho falha o build. O contrato está em [Médias Anuais](#médias-anuais).

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
├── Ceu/                            # câmera all-sky, frame/timeline/model.json e imagens (git-ignored)
└── MediasAnuais/                   # médias por hora local do WRF, manifest e grades próprios (git-ignored)

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

`MeteoMapManager` lê `data-map-context` no `<body>` para separar os contextos `forecast`, `energy` e `annual-means`. `mapas_interativos.html` inicia apenas com variáveis meteorológicas/radiativas; `potenciais_energeticos.html` apenas com produtos energéticos; `medias_anuais.html` com as médias por hora local. O contexto `annual-means` declara `timeAxis: "hour-of-day"` em `VARIABLE_CONTEXTS`, e `usesHourOfDayAxis()` troca o comportamento de data pelo de hora do dia: o passo é uma média e não um instante (ver [Médias Anuais](#médias-anuais)). O `<select id="variableSelect">` é montado em runtime por `configureVariableSelect()` (o HTML traz só um placeholder desabilitado).

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

Salvo indicação em contrário, os arquivos abaixo são gerados pelo pipeline [micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) e publicados em `site/JSON/` e `site/GeoJSON/` (gitignored). Com manifest presente, toda URL recebe `?v=<versão da rodada>`.

### Produtor Dos Dados

A CLI é `mm-wrf-geojson` (entry point `micrometeorology.cli.export_wrf_geojson`; a escrita dos artefatos fica em `wrf/jobs.py` e `wrf/geojson.py`) e a entrada são as saídas `wrfout_d0X_*` do WRF. Invocação típica:

```bash
mm-wrf-geojson --wrf-dir <dir com wrfout> --date YYYYMMDD -D 1,2,3,4 \
  -o site/JSON -g site/GeoJSON --workers 14
```

O fuso do produto é fixado pela variável de ambiente `LABMIM_TIMEZONE` (default `America/Bahia`): dela saem o campo `timezone` do manifest, o `start_local` e os dígitos de `date_time` de cada arquivo de valores — o site exibe esses dígitos como recebidos, sem reconverter. `--no-site-artifacts` desliga a escrita dos artefatos consolidados (`series.bin`, `summary.json` e os campos de manifest que os anunciam), e o cliente volta à varredura hora-a-hora descrita adiante. O contrato de integração completo mora no repositório do pipeline, em `docs/micrometeorology.md`, seção "Front-end integration (site-labmim)".

As subseções seguintes descrevem os formatos que essa invocação produz e que este repositório apenas consome.

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

Campos: `downsampled_angles`, `downsampled_magnitudes`, `downsampled_linear_indices` (amostragem com stride sobre a grade). Buscado apenas para a variável `wind` (10 m) — `eolico` usa os vetores embutidos nos próprios valores. As setas são posicionadas resolvendo cada `linear_index` via `_layersByLinearIndex` (não por posição no array). `WIND_VECTORS` e `ISOBARS` são as "variáveis" por passo sem `series.bin`/`summary.json`: nenhuma das duas é um campo escalar por célula que renda série ou resumo.

### Série Binária Por Célula

```text
JSON/{domain}_{variableId}.series.bin
```

Formato `cell-series-int32-le-v1` (anunciado em `features.cell_series` do manifest): matriz **células × passos** de int32 little-endian, sem cabeçalho; `valor = raw * scale` (0.01), sentinela de ausência `missing` (INT32_MIN). O cliente decodifica como `raw / (1 / scale)`: `1 / 0.01` dá 100 exato, e a divisão devolve o mesmo número do JSON do passo, o que `raw * 0.01` não garante (o `raw` 35 vira 0,35000000000000003). `ChartsManager._loadCellSeriesFromBinary()` lê a série de UMA célula com `Range: bytes=celula*passos*4 ...` (~300 B): trata resposta `206` (validando o total do `Content-Range` contra `células × passos × 4` — rejeita artefato órfão de rodada anterior) e também `200` sem suporte a Range (é o caso do `python3 -m http.server` em dev; o Apache de produção responde 206). Qualquer problema retorna `null`. Há dois consumidores. O modal aceita o `200`, baixa o corpo inteiro e fatia localmente; com `null`, cai na varredura hora-a-hora legada (lotes de 12; resumo de domínio em lotes de 8). O painel lateral (`loadAllVariableValuesForCell()`, com `rangeReadOnly`) só aceita o `206` com o total do `Content-Range` presente e igual a `células × passos × 4`, o que exige o grid do domínio já carregado: cancela o corpo do `200` e, em qualquer outro caso, lê o valor no JSON do passo. A janela válida sem nenhum valor (célula sem dado na rodada inteira, como o KSTAR sobre a área do domínio interno em D01–D03) volta para o painel como série vazia, e não `null`: a variável fica sem valor sem baixar o JSON do passo. A série vazia fica no cache do `ChartsManager`, com a mesma chave que o modal usa, mas hoje nenhum modal a lê: o modal lê só a variável do mapa e as `chartCompanions`, o KSTAR não é companheira de nenhuma variável e o modal do próprio `clearSkyIndex` só abre numa célula com valor. As marcas valem por versão da rodada, domínio e variável. O tamanho errado marca o arquivo como inutilizável para os dois consumidores. O `200`, de qualquer um deles, e o `404` recebido pelo painel marcam o arquivo só para o painel, que não o pede mais; o modal continua a pedi-lo, e no `404` tenta de novo a cada clique. `clearCaches()` apaga as marcas quando a rodada muda. A requisição Range é um `fetch` cru (fora do `LabmimDataService`); o cache fica no nível do `ChartsManager`, com chave que embute a versão da rodada.

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

### Médias Anuais

```text
MediasAnuais/manifest.json
MediasAnuais/{ano}/{D}_{VAR}_{NNN}.json
MediasAnuais/{ano}/GeoJSON/{D}.grid.json   (+ {D}.geojson)
```

Produzidos pelo `mm-wrf-means` do micrometeorology. O renderer dá à página do contexto `annual-means` um `site-config` próprio: `manifestPath` é `<paths.annualMeans>/manifest.json`, o slider vai de 0 a 24 e começa em 24, e os botões de domínio saem com o ID técnico, nunca com os labels do dataset, porque as médias podem vir de rodadas de outra região. Os demais arquivos são resolvidos pelo manifesto (formato `wrf-means-v1`, validado por `annualMeansFromManifest()` em `map-manager.js`; um manifesto inválido cai no aviso de dados não publicados e registra o motivo no console):

| Campo                           | Uso                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `version`                       | Versão → `?v=` de todas as URLs de dados, como na previsão                                                               |
| `steps.labels`                  | Um rótulo por passo (`"00h"` … `"23h"`, `"Todas as horas"`); o tamanho precisa ser `steps.count`                         |
| `templates.values/grid/geojson` | Caminhos relativos ao diretório do manifesto, com `{year}`, `{domain}`, `{variable}` e `{step}` (este com `step_digits`) |
| `years.<ano>`                   | O site mostra o ano mais recente                                                                                         |
| `years.<ano>.source`            | Texto obrigatório com a origem e a região das rodadas, exibido no painel de cobertura                                    |
| `years.<ano>.domain_labels`     | Rótulos dos botões de domínio; ausente, o botão mostra o ID                                                              |
| `years.<ano>.domains/variables` | Domínios exibidos (os outros botões somem) e variáveis publicadas nos 25 passos                                          |
| `years.<ano>.complete`          | `false` → aviso "ano incompleto" no painel de cobertura                                                                  |
| `years.<ano>.coverage.<D>`      | `runs`, `days`, `day_count`, `full_day_count` e `hours_per_step` (25 contagens) do domínio exibido                       |

Os passos 0 a 23 são a média de cada hora local do dia e o 24 é a média de todas as horas. O arquivo de valores tem o formato de `JSON/`, sem `date_time`: nenhum rótulo vira data. No contexto, o painel da célula mostra a hora e as horas da média, sem o `specificInfo` (sensação térmica, rajada ou produção de energia calculadas sobre uma média não descrevem nenhum instante), o modal de séries e a prévia do domínio não abrem, os vetores de vento e o recorte por estado somem, não há autoplay e o mapa se enquadra na grade de cada domínio no primeiro desenho.

### Condição Do Céu

```text
Ceu/allsky.jpg          quadro bruto da câmera, nome fixo
Ceu/attribution.png     mapa de sensibilidade à oclusão, nome fixo (cache por hash em frame.json)
Ceu/ktkd.json           labmim-ktkd-v1 — densidade, modelos, eixos e a contagem dos pontos horários
Ceu/ktkd_points.json    labmim-ktkd-points-v1 — pontos horários, buscados só ao ligar Pontos ou baixar o CSV
Ceu/kt_cumulative.json  labmim-kt-cumulative-v1 — acumulada de Kt e horas por condição
Ceu/frame.json          labmim-allsky-frame-v2 — quadro pontuado atual, previsão, contrafactuais, sensibilidade
Ceu/timeline.json       labmim-allsky-timeline-v1 — blocos de 5 min dos últimos dias contra o céu claro
Ceu/model.json          labmim-allsky-model-v1 — cartão do modelo servido: teste contra controles e referências
Ceu/allsky.jpg          quadro da câmera, nome fixo (cache por hash em frame.json)
Ceu/input.jpg           exatamente a entrada da rede, nome fixo
```

Este é o contrato que **não** vem do pipeline WRF. São documentos separados porque as cadências são diferentes: `frame.json` é reescrito a cada captura, `ktkd.json` e `kt_cumulative.json` a cada reconstrução do acervo. A página busca os três em paralelo e qualquer um pode faltar sem derrubar os outros.

`ktkd.json` traz, além de `station`, `period`, `timescale` e `sources`, os blocos abaixo. `timescale` e `period` montam a nota sob o título do gráfico: `"hourly"` vira "Médias horárias", seguem as datas de `period.start` e `period.end` e a contagem `period.n`, em horas. Um `timescale` que a página não conheça sai da nota, e a contagem passa a dizer registros.

- `density` — o histograma bidimensional: `kt_edges` e `kd_edges` (arestas, `n+1` valores) e `counts`, **linhas = faixas de Kd, colunas = faixas de Kt**, de modo que `counts[i][j]` cobre `kd_edges[i]..kd_edges[i+1]` por `kt_edges[j]..kt_edges[j+1]`. `max_count` evita varrer a matriz para escalar a cor e é o número de horas que a explicação e a entrada Densidade do guia citam para a célula mais cheia; sem ele, as duas dizem "muitas horas". `color_scale_hint` (`"log"` ou `"linear"`) diz qual escala o exportador pretende — a página assume log na falta dele. O renderizador recusa uma matriz cuja altura não case com `kd_edges`: transposta, ela ainda desenharia, espelhando a figura na diagonal em silêncio. Recusa também uma matriz com contagem que não seja número finito, em vez de pintar a célula como vazia. `n_outside` (micrometeorology #47) conta as horas do portão que a grade não alcança, de modo que a soma de `counts` mais `n_outside` fecha com `period.n`. Com `n_outside` acima de zero, a página deixa de chamar densidade e pontos de "mesma amostra": a explicação e a entrada Pontos do guia dizem quantas horas a densidade conta e quantas ficam fora da grade, com a faixa lida das arestas, e a explicação só manda o leitor à camada Pontos enquanto ela está disponível. Sem o campo, ou com zero, o texto fica como está.
- `models[]` — cada um com `id`, `kind`, `rmse`, `mbe`, `mae` e `n` medidos contra o Kd observado nesse mesmo período, mais `label` (nome curto, o que a página escreve no botão e ao lado das métricas) e `reference` (citação completa, para a bibliografia). O nome curto é **escolha do produtor**: sem `label` a página cai no `id` com underscores virando espaço, e nunca deriva nome da citação — cortar `reference` para achar um rótulo transformaria edição de bibliografia em gráfico relabelado, falha silenciosa e distante da causa. `kind: "curve"` traz `kt`/`kd` e vira linha; `kind: "band"` traz `kt`, `median`, `p10`, `p90`, `n_per_bin` e `min_samples_per_bin`, e vira envelope sombreado com a mediana por cima. **Nunca desenhe uma banda como linha única**: ela afirmaria um determinismo que o modelo não tem. `median`/`p10`/`p90` são `null` onde a faixa tem menos amostras que `min_samples_per_bin`; **decida por `median === null`, nunca por `n_per_bin === 0`**, porque `n_per_bin` conta as amostras da faixa tenha ela sido resumida ou não — uma faixa suprimida quase sempre tem contagem diferente de zero. Isso não é advertência abstrata: no registro publicado — 23.795 horas, `min_samples_per_bin = 30` — **7 das 9 faixas suprimidas têm `n_per_bin` diferente de zero**, nos dois modelos de banda. Quem decidisse pela contagem desenharia sete faixas que deveriam estar vazias. Faixas suprimidas não são interpoladas nem atribuídas à faixa cheia vizinha: o tooltip diz quantas horas havia ali e quantas o resumo exigia.
- `sky_conditions` — `kt_upper_bounds`, a citação e as quatro classes com `condition` (1–4), `id` (`i`..`iv`), `name`, `name_pt` e `kt_range`. O Kt × Kd e a acumulada leem os limites de `conditions`, e a cópia embutida em `ceu.js` só vale quando a lista falta. Os extremos `null` de `kt_range` nas condições I e IV não pesam: o rótulo usa só a borda interna, e a última condição fica aberta acima. O nome longo que acompanha o chip vem da cópia embutida pelo `id`, com a grafia de Teramoto & Escobedo (2012); o `name_pt` do produtor só entra para um `id` que ela não conheça.
- `axes` — `{"x": {"range": [0, 1.2]}, "y": {"range": [0, 1.2]}}`, o portão de Kt e Kd do produtor. Com o eixo declarado, o gráfico usa o limite como está; sem ele, cai em `[0, 1]` e soma 0,1 de folga ao topo de Kd.
- `points_file` — `{"name": "ktkd_points.json", "n": <horas>}`. Declara que os pontos moram no arquivo irmão, fora do payload inicial: 98% do `ktkd.json` antigo eram pontos que a vista padrão (só densidade) não desenha. O chip Pontos, o botão CSV e a entrada do guia aparecem pela contagem declarada; o arquivo é buscado uma vez por visita, com `cache: "no-cache"`, quando o leitor liga Pontos ou pede o CSV, ou logo depois do `ktkd.json` quando não há densidade e o Pontos já nasce ligado. `ktkd_points.json` traz `schema` (`labmim-ktkd-points-v1`), `version`, `points_format` e `points`, com as mesmas linhas do `points[]` inline. A página recusa o arquivo se o `schema` for outro ou se a `version` diferir da do `ktkd.json` — sinal de `Ceu/` atualizado pela metade — e, nesse caso ou se o arquivo faltar, desliga e desabilita o chip, desabilita o CSV e diz o motivo sob o gráfico: nunca desenha pontos de uma versão sobre a densidade de outra.
- `points[]` — forma antiga, opcional. Se vier junto com `points_file`, os pontos inline têm precedência e o arquivo irmão não é buscado nem conferido; o produtor nunca emite os dois. Uma entrada por hora. É a camada de sobreposição, desligada por padrão, e o que sustenta a coloração por condição de céu, o tooltip por observação e a exportação CSV. Sem ela a página desenha só a densidade e o tooltip passa a descrever a célula sob o cursor. Aceita `{t, kt, kd}` ou, preferido, **linha posicional** — sobre dezenas de milhares de horas as três chaves repetidas são a maior parte do arquivo, e o host serve JSON sem compressão (23.795 horas: 848 KB posicional contra ~2 MB com dicionários). A ordem da linha vem declarada em `points_format` (`["kt","kd","t","condition"]` no `ktkd_points.json` a partir do micrometeorology 800fd3e, `["kt","kd","t"]` antes) e é **lida de lá**, não presumida: `kt` e `kd` trocados espelhariam a figura na diagonal e ainda pareceriam uma dispersão plausível — o mesmo modo de falha que o teste de altura da densidade existe para pegar. Sem `points_format` vale a ordem histórica `[kt, kd, t]`; uma declaração que não nomeie as duas coordenadas faz a camada **não ser desenhada**, porque cair em posições não declaradas seria adivinhar. `condition` é a condição de céu (1–4) de `sky_conditions.conditions[].condition`, classificada pelo produtor a partir do Kt sem arredondar, e a cor, o tooltip e a coluna `condicao` do CSV a usam em vez de reclassificar o `kt` publicado: com três casas, uma hora até 0,0005 acima de um limite sai impressa no limite e cairia uma classe abaixo (0,3504 vira 0,35, que é condição I, e a hora é II). Com o campo, as linhas somam os `count` de `sky_conditions`. Sem o campo declarado, a página volta a classificar pelo `kt` publicado e aceita essa janela; com o campo declarado, um valor que não seja uma condição da lista deixa a hora sem classe — fora da dispersão e com `condicao` vazia no CSV —, nunca reclassificada pelo `kt`.
- `filters[]` — os critérios de seleção e as convenções de cálculo das horas, em frases escritas pelo produtor. A página as imprime como vêm, separadas por ponto e vírgula, na nota da explicação do Kt × Kd, no lugar da prosa fixa do template, mas só quando o `ktkd.json` também declara `points_file`, que marca o formato do micrometeorology #47. O `ktkd.json` anterior traz as mesmas frases sem acento, com ponto decimal e sem dizer que as horas de chuva não são excluídas, e para ele a prosa diz o mesmo melhor. Dentro do #47, as frases só saem em português e com a chuva a partir do commit 26ec327: um `Ceu/` publicado de um commit anterior do PR imprimiria as frases antigas. A prosa também fica quando `filters` falta, não é lista ou não traz nenhuma frase: ela descreve os critérios do produtor de set/2026 e envelhece se ele mudar um portão. O texto não é corrigido nem traduzido aqui; acento e vírgula decimal são do produtor.
- `caveats[]` — renderizados sob o gráfico como estão.

`kt_cumulative.json` é a distribuição acumulada de Kt, e responde o que a dispersão não responde: não como Kd se comporta num dado Kt, mas **quanto do registro está em cada condição de céu**. Traz `edges` (as mesmas do histograma de Kt da climatologia) e `subsets`, um objeto cujas chaves são os recortes. Como aqui não há manifesto de onde tirar rótulo, **cada subset carrega o seu `label`**; a ordem de inserção é a ordem dos chips, o primeiro é o padrão, e com um recorte só o seletor não aparece. Cada subset traz `n`, `counts`, `cumulative`, `below`, `above` e `sky_conditions` — este último com `kt_upper_bounds`, a citação, e as quatro classes com `condition`, `id`, `name_pt`, `kt_range`, `count` e `fraction` **já calculada**: a página não deriva fração de uma F interpolada, que seria um segundo caminho numérico livre para discordar do exportador.

`cumulative[i]` é F na aresta **superior** do bin `i` — cinquenta valores para cinquenta e uma arestas. É desenhada como **função escada** sobre eixo x linear, constante entre arestas, com âncora em `(edges[0], 0)`. Um eixo de centros de bin deslocaria a curva meio bin dos números a que ela se refere, e uma linha suavizada afirmaria valores intermediários que uma escada não tem. **A página não assume se `below`/`above` entram no denominador**: desenha o publicado, limita o eixo em 1 e nomeia as horas fora das bordas ao lado. Com o produtor atual elas entram, então F para pouco antes de 1 quando há massa fora — o que é informação, não defeito.

Atenção a um `n` que não bate de propósito: a acumulada é gateada só no canal global, o `ktkd.json` exige também medida difusa. São populações diferentes com o mesmo nome de campo, e está nos `caveats` de cada um.

`frame.json` traz `status`, `captured_at`, `image`/`input`/`attribution` (cada um com `sha256_12` para o `?v=`), `solar`, `prediction`, `counterfactuals` e `members`. Leia a condição por `prediction.sky.condition` (1–4) ou por `.id`, **nunca** por um inteiro solto: a classe interna do exportador é 0-based e a literatura numera de I a IV, então um índice cru atravessando essa fronteira é um erro de um a cada vez esperando para acontecer. O produtor e o contrato completo estão em `micrometeorology/docs/allsky-site.md`.

`timeline.json` traz `label_scale` (`"raw"` ou `"corrected"`, micrometeorology #47), a escala de `series.dhi_w_m2`; `measured_dhi_w_m2` e `live` saem sempre corrigidos. Sem o campo, a página lê `model.json → dataset.label_scale`, e qualquer outro valor conta como ausente. Se os dois divergirem, vale o do `timeline.json`, que é o documento que carrega a série desenhada. Sem nenhum dos dois, a prevista é tratada como escala crua: diante da medida ou do bloco ao vivo, ela ganha a marca "(escala crua)" e as métricas ao vivo avisam que incluem a diferença de escala.

Os dois quadros mantêm nomes **fixos** e são reescritos no lugar, como os PNGs de `assets/graphs/`. A página anexa `?t=` derivado de `frame.captured_at` (na falta dele, um balde de 5 min), que é o que vence a regra de cache aplicada a imagens no `.htaccess` — e `captured_at` é lido do carimbo que a câmera grava no quadro, não do `Last-Modified` do host, que é balanceado e já reportou hora local rotulada como GMT.

Os três JSON são buscados direto com `cache: "no-cache"`, fora do `LabmimDataService` (que atende ao WebGIS). Sem `ktkd.json`, sem `frame.json` **e** com os dois quadros ausentes — o estado de um checkout de desenvolvimento e do CI — a página avisa que os dados chegam pelo deploy, em vez de exibir gráfico vazio; a acumulada pode faltar sozinha, e nesse caso só o painel dela some.

Sobre o conteúdo: `kt` é o índice de claridade (global medida na horizontal sobre a irradiação no topo da atmosfera) e `kd` é a **fração difusa** `Hd/H` — difusa sobre global, não sobre a extraterrestre. As quatro condições de céu, por faixas de Kt [Escobedo et al., 2009; nomenclatura de Teramoto e Escobedo, 2012]: I nebuloso (Kt ≤ 0,35); II parcialmente nebuloso com dominância para o difuso (0,35 < Kt ≤ 0,55); III parcialmente nebuloso com dominância para o claro (0,55 < Kt ≤ 0,65); IV claro (Kt > 0,65). Os três modelos são ajustados a médias **horárias**, e só o de Marques Filho et al. (2016) é função de `Kt` sozinho; Lemos et al. (2017) e o BRL de Ridley, Boland e Lauret (2010) dependem também da hora solar aparente, da altitude solar, do Kt diário e da persistência, o que é exatamente a razão de chegarem resumidos em banda.

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

`site/.htaccess` configura o Apache com diretivas protegidas por `<IfModule>` (o site nunca deve retornar 500 se um módulo faltar):

- **Charset/erros/redirects**: `AddDefaultCharset UTF-8`; `ErrorDocument 404 /404.html`; somente os redirects declarados em `src/sites/<id>/identity.js` para a publicação selecionada são emitidos.
- **MIME**: `application/json` para `.json` e `application/geo+json` para `.geojson`.
- **Compressão**: `mod_deflate` (dentro de `mod_filter`) para HTML, CSS, JS, JSON, GeoJSON e SVG, com bloco paralelo `mod_brotli` para clientes que suportam.
- **Segurança**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (geolocation/camera/microphone desligados) e **CSP** com `script-src 'self'` (sem scripts inline; JSON-LD em `<script type="application/ld+json">` é permitido por não ser executável), `style-src 'self' 'unsafe-inline'` (atributos style do Leaflet), `img-src` liberando tiles OSM e `data:`, `frame-src https://www.google.com` (mapa da equipe) e `upgrade-insecure-requests`.
- **Cache-Control** (cascata; blocos `<If>` aplicam por último e vencem os `FilesMatch`):
  - `.json`/`.geojson`/`.bin` **sem** `?v=` → `no-cache` (nomes reutilizados a cada rodada; revalidação 304 barata).
  - `.json`/`.geojson`/`.bin` **com** `?v=` → `public, max-age=86400` (24 h, não 1 ano: teto de estrago para um manifest órfão após rollback do pipeline).
  - `.html` → `no-cache`.
  - `.css`/`.js` sem `?v=` → cache curto com `stale-while-revalidate`.
  - `.css`/`.js` sob `assets/` **com** `?v=` no formato do carimbo de `stampAssetVersions` (8 dígitos hex do MD5 do conteúdo, que só o build escreve: CSS/JS próprios, workers e os vendors de `HASHED_VENDOR_ASSETS`) → `public, max-age=86400`, sem `immutable`. O hash vive só na query string e o servidor entrega o que houver no caminho: se o HTML novo chegar antes do asset, o `?v=` novo passa a guardar os bytes antigos (ver a ordem do upload em [Deploy Em Produção](#deploy-em-produção)). O teto de 24 h limita esse estrago; tirar só o `immutable` não bastaria, porque quem prende os bytes no cache é o `max-age`. A regra casa pelo formato do carimbo, não por uma lista: um arquivo novo em `HASHED_VENDOR_ASSETS` (`scripts/site-builder/assets.js`) entra nela sem mexer no template. Um token manual de vendor com 8 caracteres hex (uma data como `?v=20260923`) cairia nela e perderia o `immutable`; mantenha os tokens com ponto, como os de hoje.
  - `assets/vendor/**` → `immutable` de 1 ano — exceto `fontawesome/webfonts/` (o subset `fa-solid-900.woff2` regenera no mesmo nome e vai com `no-cache`; as outras fontes de lá, que nenhuma página carrega, ficam na regra de 7 dias) e os vendors de `HASHED_VENDOR_ASSETS`, carimbados por hash (regra de 24 h acima). As bibliotecas com token manual (`leaflet.js?v=1.9.4`) seguem imutáveis: só mudam numa troca de versão, que sobe na mesma ordem.
  - imagens e fontes → 7 dias; `assets/graphs/` → `no-cache` (estação regenera nos mesmos nomes).

Nota: `.series.bin` fica deliberadamente **fora** das listas de compressão: o `mod_deflate` não comprime respostas 206, e comprimir o corpo inteiro anularia as leituras parciais (Range, ~300 B) que o site faz nesses arquivos. As leituras Range de produção dependem do suporte nativo do Apache (206).

## Deploy Em Produção

O deploy é manual e desacoplado: código e dados sobem separadamente. O que se publica é a saída de `npm run build -- --site=<id>` em `site/` ou o bundle correspondente em `dist/<id>/`. Regras aprendidas em produção:

- **Publique o site completo junto do `.htaccess`.** Nunca suba o `.htaccess` sozinho sobre uma versão antiga do site: a CSP `script-src 'self'` quebra qualquer página que ainda carregue CDN ou script inline.
- **Ordem do upload FTP: `assets/` primeiro, `*.html` por último.** É o HTML que traz os `?v=` novos, e o hash de conteúdo está só na query string, não no nome do arquivo. Se uma página nova chegar antes do seu JS ou CSS, o visitante pede `map-manager.js?v=<novo>`, recebe os bytes antigos, e o navegador pode reutilizá-los sob a URL nova por até 24 h (1 ano, num vendor com token manual). Nesta ordem, a janela do upload só expõe HTML antigo com asset novo, e isso se desfaz na primeira navegação depois que o HTML sobe, porque o HTML é `no-cache` e a URL do asset muda com ele.
- **Ordem segura para mudança de formato de dados**: publicar o site novo, conferir em produção e só então atualizar o pipeline no servidor de operação e regenerar os dados. Site novo com dados velhos funciona, porque o cliente tem fallback para todos os contratos; o inverso não é garantido.
- **Rollback do pipeline**: ao voltar para uma versão que não escreve `manifest.json`, delete o manifest órfão do servidor junto — ele congela o `?v=` enquanto os bytes mudam por baixo, e o teto de 24 h do `.htaccess` limita o estrago sem evitá-lo. Pelo mesmo motivo, `series.bin` e `summary.json` vão e voltam junto com o manifest que os anuncia.
- **O host roda `mod_pagespeed` e reescreve o HTML servido.** Hoje (`Server: Apache/2.4.6 (CloudLinux)`, `X-Mod-Pagespeed: 1.13.35.2-0`) toda resposta HTML volta com dois `<script>` **inline** injetados pelo módulo — `window.mod_pagespeed_start` e o beacon com `data-pagespeed-no-defer` — que não existem em arquivo nenhum deste repositório. Como a CSP publicada é `script-src 'self'`, sem `'unsafe-inline'` e sem nonce, assim que o `.htaccess` entrar o navegador bloqueia os dois blocos e registra a violação em toda página. O estrago hoje é cosmético (é telemetria do módulo), mas os filtros do PageSpeed que embutem ou combinam JS transformariam os nossos próprios scripts em inline — e aí a página para de funcionar. Antes de confiar na CSP em produção, desligue a reescrita dentro de `<IfModule pagespeed_module>`, para não arriscar 500 num host sem o módulo (`src/template/static/htaccess.template` ainda não traz esse bloco), e confirme com `curl -ks https://labmim.if.ufba.br/ | grep -c mod_pagespeed_start` — o esperado é `0`.
- **Confira se o `.htaccess` realmente entrou**: `curl -ksI https://labmim.if.ufba.br/ | grep -i content-security-policy`. O `-k` é necessário enquanto a cadeia TLS do host estiver quebrada — sem ele o `curl` sai com 60 e não imprime nada. Não use a compressão como sinal: o `mod_deflate` do host comprime por conta própria, então `Content-Encoding: gzip` aparece mesmo com o `.htaccess` ausente. A CSP, ao contrário, só existe se o arquivo estiver ativo.

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
- CI em `.github/workflows/ci.yml`: `build:check`, `lint:js`, `lint:css`, `lint:themes`, `lint:icons`, `lint:purge`, `format:check`, `lint:html`, `lint:links`, `npm audit --audit-level=high`. Dependabot em `.github/dependabot.yml` (npm + GitHub Actions, mensal, PRs agrupados num único grupo multi-ecossistema).

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
- Não documente dados ou endpoints que não existam no código. Se um novo pipeline mudar contratos de arquivo, atualize este documento junto.

## Checklist De Validação

Use antes de merge/publicação:

- `npm run sites:list`, `npm run build:check`, `npm run lint`, `npm run format:check` (ou `npm run lint:all` para incluir HTML e links), `npm audit`.
- Servir `site/` por HTTP local (`make serve`).
- Abrir páginas institucionais em desktop e mobile; alternar dark mode em cada página.
- Abrir `ceu.html` com e sem `site/Ceu/` populado: quadros, slider de opacidade do mapa de sensibilidade, cartão da previsão, linha do tempo, cartão do modelo, alternância das quatro condições, curva de referência, ampliação e CSV; sem dados, deve aparecer o aviso de que eles chegam pelo deploy.
- Abrir `mapas_interativos.html` e confirmar que Potencial Fotovoltaico não aparece como previsão; `SWDOWN` deve aparecer como Radiação Global.
- Abrir `potenciais_energeticos.html` e confirmar que só aparecem Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Verificar se Leaflet renderiza (bundle local) e se não há erros no console.
- Trocar variáveis e domínios (a grade não deve recarregar do zero).
- Confirmar os labels de domínio configurados para cada publicação na UI, mantendo as requisições internas nos IDs técnicos do respectivo dataset.
- Testar play/pause até passar do final da escala temporal (deve dar a volta para o primeiro passo disponível) e confirmar que passos indisponíveis são pulados.
- Com dados + manifest locais presentes, conferir que o slider vai até `index_max` do manifest e que o rótulo de data bate com `start_local`.
- Ativar `windLayerToggle` em `wind` e `eolico`; confirmar que fica oculto nas demais variáveis.
- Clicar em uma célula e validar sidebar; validar modal de séries temporais (rápido via `series.bin`) e exportação CSV.
