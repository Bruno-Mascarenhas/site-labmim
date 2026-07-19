# LabMiM Site

Site estático do LabMiM - Laboratório de Micrometeorologia e Modelagem da UFBA. O projeto reúne páginas institucionais, visualização de gráficos de monitoramento ambiental e WebGIS para previsões meteorológicas e potenciais energéticos derivados de saídas do modelo WRF.

O site é servido como frontend estático: HTML, CSS e JavaScript no navegador, sem backend próprio neste repositório. As páginas em `site/` são **geradas** a partir de fontes em `src/` por um passo de build local/CI sem dependências de runtime (`build.js`, apenas a biblioteca padrão do Node), que expande _partials_ compartilhados (head, navbar, footer, scripts), gera o bloco de SEO por página (canonical, Open Graph, Twitter card) e **carimba hashes de conteúdo (`?v=<md5-8>`) nos assets próprios** para invalidação automática de cache. O host continua servindo somente arquivos estáticos — não há build no servidor.

Os dados dos mapas interativos (`site/JSON/` e `site/GeoJSON/`) **não são gerados aqui**: eles vêm do pipeline WRF do repositório irmão **[micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology)** — ver [Dados do WebGIS (pipeline externo)](#dados-do-webgis-pipeline-externo).

## Funcionalidades

- Página inicial institucional com resumo do LabMiM e parceiros.
- Página de monitoramento com gráficos PNG em cards e modais Bootstrap.
- Página de equipe com links de pesquisadores e localização incorporada.
- Página de climatologia atualmente em construção.
- WebGIS de previsões em `mapas_interativos.html` com variáveis meteorológicas.
- WebGIS de potenciais energéticos em `potenciais_energeticos.html` com potencial fotovoltaico, potencial eólico e densidade eólica.
- Leaflet com renderização em Canvas, domínios WRF, palhetas por variável, animação temporal, recorte por estado, camada de vento e séries temporais em modal.
- **Linha do tempo dirigida por manifest**: `JSON/manifest.json` (v2) define o intervalo de passos do slider, a âncora de data/hora e a disponibilidade por variável; o site re-checa o manifest a cada 15 min e ressincroniza sozinho quando o pipeline publica uma rodada nova.
- **Artefatos consolidados**: série temporal de uma célula lida de `{D}_{VAR}.series.bin` com uma única requisição HTTP Range (~300 B) e resumo de domínio (média/mín/máx por passo) lido de `{D}_{VAR}.summary.json` — com fallback transparente para a varredura hora-a-hora legada.
- Camada de dados compartilhada (`data-service.js`) com cache LRU em memória, deduplicação de requisições em voo, cache negativo e parsing em Web Worker.
- Dark mode persistente em `localStorage`, com sincronização para gráficos via evento `labmim-theme-change`.

## Estrutura Do Repositório

```text
.
├── README.md
├── Architecture.md            # documentação técnica detalhada
├── package.json / package-lock.json
├── .nvmrc                     # Node 24 LTS (24.18.0) usado pelo projeto e pelo CI
├── eslint.config.mjs
├── .stylelintrc.json
├── .htmlvalidate.json         # regras do lint:html (html-validate)
├── .prettierrc / .prettierignore
├── .editorconfig
├── .github/
│   ├── workflows/ci.yml       # build-check, lints (js/css/icons/purge), format-check, html, links, audit
│   └── dependabot.yml         # atualizações npm e GitHub Actions (semanais, agrupadas)
├── Makefile
├── build.js                   # gerador estático (src/ -> site/*.html), só stdlib do Node
├── scripts/
│   ├── check-fa-subset.mjs        # lint:icons — cobertura do subset do Font Awesome
│   ├── check-bootstrap-purge.mjs  # lint:purge — cobertura do Bootstrap purgado
│   ├── purgecss.config.cjs        # config para regenerar bootstrap.purged.min.css
│   └── subset-fontawesome.md      # como regenerar o subset de fontes
├── src/                       # FONTE das páginas — edite AQUI, nunca em site/*.html
│   ├── layouts/
│   │   ├── institutional.html # index, monitoring, team, climatologia
│   │   └── webgis.html        # mapas_interativos, potenciais_energeticos
│   ├── partials/
│   │   ├── head.html          # <head> compartilhado (meta, CSS, tema, hashes dos workers)
│   │   ├── nav.html           # navbar (itens gerados do array NAV em build.js)
│   │   ├── footer.html        # rodapé compartilhado
│   │   ├── scripts.html       # Bootstrap bundle (fim do body)
│   │   ├── webgis-doc-features.html  # aba compartilhada da documentação
│   │   └── webgis-doc-wrf.html       # aba compartilhada da documentação
│   └── pages/                 # conteúdo único de cada página (sem head/nav/footer)
│       ├── index.html
│       ├── monitoring.html
│       ├── team.html
│       ├── climatologia.html
│       ├── mapas_interativos.html
│       └── potenciais_energeticos.html
└── site/                      # SAÍDA publicada (HTML gerado + assets estáticos)
    ├── .htaccess              # MIME, compressão (deflate+brotli), cache, segurança/CSP, 404, 301
    ├── robots.txt             # regras de crawl (bloqueia /JSON/, /GeoJSON/)
    ├── sitemap.xml            # 6 URLs canônicas
    ├── 404.html               # página de erro (standalone, caminhos absolutos — não gerada)
    ├── index.html             # ┐
    ├── monitoring.html        # │ gerados por build.js a partir de src/
    ├── team.html              # │ (não edite à mão — serão sobrescritos)
    ├── climatologia.html      # │
    ├── mapas_interativos.html # │
    ├── potenciais_energeticos.html  # ┘
    ├── GeoJSON/               # grades geradas pelo pipeline (git-ignored)
    ├── JSON/                  # valores, séries, resumos e manifest (git-ignored)
    └── assets/
        ├── css/
        │   ├── base.css       # tokens e fundamentos
        │   ├── layout.css
        │   ├── components.css
        │   ├── theme.css      # dark mode
        │   └── maps.css       # exclusivo do WebGIS
        ├── js/
        │   ├── theme-boot.js
        │   ├── theme-toggle.js
        │   ├── ui-shell.js            # toggles genéricos [data-ui-toggle]
        │   ├── variables-config.js
        │   ├── data-service.js        # LabmimDataService (fetch/cache/worker)
        │   ├── charts-manager.js
        │   ├── map-manager.js
        │   ├── map-init.js
        │   └── workers/
        │       ├── color-calc.worker.js
        │       └── json-parser.worker.js
        ├── vendor/            # bibliotecas vendorizadas localmente
        │   ├── bootstrap/     # 5.3.8 — bootstrap.purged.min.css (servido, ~27KB),
        │   │                  #   bootstrap.min.css (fonte do purge + 404.html), bundle JS
        │   ├── fontawesome/   # 6.4.0 — all.min.css + fa-solid-900.woff2 (subset ~6KB),
        │   │                  #   fa-solid-900.full.woff2 (original), brands/regular
        │   │                  #   completas (nunca baixadas), subset-glyphs.json
        │   ├── leaflet/       # Leaflet 1.9.4 (js, css, images)
        │   └── chartjs/       # Chart.js 3.9.1
        ├── data/
        │   └── br_ba.json     # contorno da Bahia (recorte por estado)
        ├── graphs/            # PNGs do monitoramento (regenerados pela estação)
        └── img/
```

## Dados Do WebGIS (Pipeline Externo)

`site/JSON/` e `site/GeoJSON/` são dados gerados e ficam fora do controle de versão (ver `.gitignore`). Quem os gera é o repositório irmão **[micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology)**, pela CLI `labmim-wrf-geojson` (entry point `micrometeorology.cli.export_wrf_geojson`; escrita dos artefatos em `wrf/jobs.py` e `wrf/geojson.py`). Invocação típica a partir de saídas `wrfout_d0X_*` do WRF:

```bash
labmim-wrf-geojson --wrf-dir <dir com wrfout> --date YYYYMMDD -D 1,2,3,4 \
  -o site/JSON -g site/GeoJSON --workers 14
```

O fuso do produto é fixado por `LABMIM_TIMEZONE` (default `America/Bahia`); `--no-site-artifacts` desliga a escrita dos artefatos consolidados. O contrato de integração é documentado no próprio repositório do pipeline (`docs/micrometeorology.md`, seção "Front-end integration (site-labmim)").

Artefatos que o site consome:

| Arquivo | Formato | Uso no site |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------------------- |
| `JSON/manifest.json` | `labmim-data-manifest-v2` | Versão da rodada (`?v=` nos dados), intervalo do slider, âncora de data, disponibilidade por variável, descritores dos artefatos consolidados |
| `GeoJSON/{D}.grid.json` | `grid-edges-v1` (ou `grid-bounds-v1`) | Grade compacta (~2 KB) expandida no cliente; preferida |
| `GeoJSON/{D}.geojson` | FeatureCollection | Grade legada (1,2–2,6 MB); fallback quando não há `grid.json` |
| `JSON/{D}_{VAR}_{NNN}.json` | valores por passo | Cores do mapa (`values[]` indexado por `linear_index`) |
| `JSON/{D}_WIND_VECTORS_{NNN}.json` | vetores por passo | Setas de vento da variável `wind` (o `eolico` embute vetores em `metadata.wind`) |
| `JSON/{D}_{VAR}.series.bin` | `cell-series-int32-le-v1` | Série temporal de uma célula via HTTP Range (~300 B por leitura) |
| `JSON/{D}_{VAR}.summary.json` | `domain-summary-v1` | Média/mín/máx do domínio por passo (painel "Sobre as variáveis") |

O site **degrada graciosamente**: sem manifest (ou com manifest v1) ele usa o intervalo padrão de 73 passos e a heurística solar legada; sem `grid.json` cai no `.geojson`; sem `series.bin`/`summary.json` volta à varredura hora-a-hora. Isso permite publicar site e dados em qualquer ordem (site primeiro é o preferido).

Não abra, formate ou reprocesse `/data`, `site/JSON/` ou `site/GeoJSON/` durante manutenção comum; esses diretórios contêm dados grandes gerados pelo pipeline externo.

## Como Executar Localmente

Não abra as páginas direto por `file://`. Os mapas e workers dependem de `fetch`, então use um servidor HTTP local.

Se editou algo em `src/` (partials, layouts ou conteúdo de página), gere o HTML antes de servir/publicar:

```bash
make build            # expande src/ -> site/*.html e roda o Prettier
```

```bash
make serve            # serve site/ em http://localhost:8000
```

Ou diretamente:

```bash
cd site
python3 -m http.server 8000
```

Acesse:

- `http://localhost:8000/`
- `http://localhost:8000/mapas_interativos.html`
- `http://localhost:8000/potenciais_energeticos.html`

Se a porta 8000 estiver ocupada, use outra (ex.: `python3 -m http.server 8100`).

Nota: o `http.server` do Python ignora cabeçalhos `Range` (responde 200 com o corpo inteiro); o leitor de `series.bin` detecta isso e fatia localmente, então as séries funcionam igual em dev — apenas com mais bytes no fio do que em produção (Apache responde 206).

## Deploy (Produção)

O deploy é manual (FTP) para `labmim.if.ufba.br` (Apache 2.4 CloudLinux); código e dados são publicados de forma desacoplada. Regras aprendidas em produção:

- **Publicar o site completo junto com o `.htaccess`** — nunca subir o `.htaccess` sozinho sobre uma versão antiga do site: a CSP `script-src 'self'` quebra páginas que ainda usem CDN/scripts inline.
- **Ordem segura para mudanças de formato de dados**: (1) publicar o site novo, (2) conferir em produção, (3) atualizar o pipeline no servidor de operação e regenerar os dados — o cliente tem fallback para todos os contratos, então site novo + dados velhos funciona; o inverso não é garantido.
- **Rollback do pipeline**: se voltar a uma versão que não escreve `manifest.json`, deletar o manifest órfão do servidor junto (um manifest órfão congela o `?v=` enquanto os bytes mudam por baixo; o `.htaccess` limita o estrago a 24 h). Os artefatos `series.bin`/`summary.json` devem ir e vir junto com o manifest que os anuncia.
- Após publicar, conferir os cabeçalhos servidos: `curl -sI -H 'Accept-Encoding: gzip' https://labmim.if.ufba.br/GeoJSON/D01.geojson` (compressão e `Cache-Control` dependem do `.htaccess` estar ativo no host).

## Dependências Externas Em Runtime

Todo o site usa **uma única versão do Bootstrap — 5.3.8 — vendorizada localmente** em `assets/vendor/bootstrap/`. As páginas carregam o CSS **purgado** (`bootstrap.purged.min.css`, ~27 KB via PurgeCSS; o `bootstrap.min.css` completo fica como fonte do purge e para o `404.html`). **Não há jQuery no projeto.** O Font Awesome 6.4.0 usa um **subset de fonte** (`fa-solid-900.woff2` com só os glifos usados, ~6 KB; ver `scripts/subset-fontawesome.md`). Bootstrap, Font Awesome, Leaflet 1.9.4, Chart.js 3.9.1 e o contorno da Bahia são todos carregados **localmente** (`assets/vendor/` e `assets/data/`) — não há CDN no caminho crítico de renderização. `leaflet.js` é carregado com `defer`. O antigo Turf.js foi removido — a máscara de recorte por estado usa um _point-in-polygon_ local em `map-manager.js`.

Origens externas restantes:

- Tiles do mapa base via OpenStreetMap (apenas nas páginas WebGIS).
- Iframe do Google My Maps na página de equipe (`team.html`; liberado no CSP via `frame-src https://www.google.com`).

## Desenvolvimento

O projeto usa a versão de Node fixada em `.nvmrc` (Node 24 LTS). Com `nvm`:

```bash
nvm install    # instala a versão do .nvmrc, se necessário
nvm use
npm ci
```

Scripts npm:

```bash
npm run build         # gera site/*.html a partir de src/ (+ Prettier na saída)
npm run build:check   # gera e falha se site/*.html estiver desatualizado (usado no CI)
npm run lint          # lint:js + lint:css + lint:icons + lint:purge
npm run lint:all      # lint + lint:html + lint:links
npm run lint:js       # ESLint em site/assets/js/
npm run lint:css      # Stylelint em site/assets/css/
npm run lint:icons    # cobertura do subset Font Awesome (scripts/check-fa-subset.mjs)
npm run lint:purge    # cobertura do Bootstrap purgado (scripts/check-bootstrap-purge.mjs)
npm run lint:html     # html-validate nas páginas geradas
npm run lint:links    # linkinator (links internos; ignora externos e /JSON//GeoJSON/)
npm run format        # Prettier --write em site/**/*.{html,css,js}
npm run format:check
```

Também há atalhos no `Makefile`:

```bash
make build         # gera as páginas a partir de src/
make build-check   # gera e verifica se site/*.html está atualizado
make lint          # ESLint + Stylelint + checks de assets (ícones/purge)
make lint-html     # html-validate
make lint-links    # linkinator
make format-check  # Prettier (somente verifica)
make fix           # aplica Prettier + correções dos linters
make audit         # npm audit --audit-level=high
make serve         # python3 -m http.server 8000 --directory site
make ci            # build-check + format-check + lint + lint-html + lint-links + audit
```

`make ci` roda os mesmos checks do CI do GitHub (o alvo `lint` inclui `lint:icons` e `lint:purge`); o CI valida, além disso, o lockfile e a versão do Node via `npm ci` + `.nvmrc`.

As ferramentas de desenvolvimento (ESLint, Stylelint, Prettier, html-validate, linkinator) são `devDependencies` em `package.json`. Não há dependências de runtime instaladas via npm — o site é estático e `build.js` usa apenas a biblioteca padrão do Node (o PurgeCSS é devDependency e roda só na regeneração do CSS purgado). O CI (`.github/workflows/ci.yml`) roda, nesta ordem: `build:check`, `lint:js`, `lint:css`, `lint:icons`, `lint:purge`, `format:check`, `lint:html`, `lint:links` e `npm audit --audit-level=high`; o Dependabot (`.github/dependabot.yml`) acompanha npm e GitHub Actions semanalmente, com PRs agrupados.

## Páginas Principais

- `site/index.html`: página inicial.
- `site/monitoring.html`: monitoramento ambiental com gráficos e financiadores.
- `site/team.html`: equipe e localização.
- `site/climatologia.html`: página em construção.
- `site/mapas_interativos.html`: WebGIS de previsões meteorológicas.
- `site/potenciais_energeticos.html`: WebGIS de potenciais fotovoltaico, eólico e densidade eólica.
- `site/404.html`: página de erro standalone (caminhos absolutos, servida via `ErrorDocument`).

## Mapas Interativos

O WebGIS é inicializado por `map-init.js`, que busca o manifest, cria `MeteoMapManager` e `ChartsManager`.

Navbar principal: Previsões, Potenciais Energéticos, Monitoramento, Climatologia e Equipe.

Principais recursos:

- Domínios com labels públicos `BA/NE`, `BA`, `RMS` e `SSA`; os IDs técnicos continuam `D01`, `D02`, `D03` e `D04` para arquivos, cache e estado interno.
- Variáveis de Previsões configuradas em `VARIABLE_CONTEXTS.forecast`: `wind`, `temperature`, `skinTemperature`, `pressure`, `humidity`, `relativeHumidity`, `rain`, `globalRadiation`, `longwave`, `hfx` e `lh`.
- Variáveis de Potenciais Energéticos configuradas em `VARIABLE_CONTEXTS.energy`: `solar`, `eolico` e `windPowerDensity`.
- `humidity` representa Vapor d'Água / razão de mistura em `g/kg`; `relativeHumidity` representa RH2 em `%`.
- `SWDOWN` aparece em dois contextos: `globalRadiation` como Radiação Global em Previsões, e `solar` como Potencial Fotovoltaico em Potenciais Energéticos.
- O `<select id="variableSelect">` é populado em runtime por `configureVariableSelect()` a partir de `VARIABLES_CONFIG`/`VARIABLE_CONTEXTS` (o HTML traz só um placeholder "Carregando…").
- Palhetas e escalas ficam em `VARIABLES_CONFIG`; as variáveis usam limites fixos (`scaleMin`/`scaleMax`) para manter cores comparáveis entre horários.
- Slider temporal com animação play/pause (autoplay no primeiro carregamento; intervalo de 800 ms). O intervalo do slider vem de `index_min`/`index_max` do manifest, com o mínimo clampado a ≥ 1 no cliente (73 passos é só o fallback sem manifest).
- Disponibilidade por variável vem de `availability` do manifest (ex.: `SWDOWN` só nos passos diurnos); a janela solar 6h–18h derivada da âncora é apenas o fallback legado. Passos indisponíveis são pulados na animação.
- `windLayerToggle` visível apenas para variáveis de vento (`wind` e `eolico`).
- Séries temporais no modal `timeSeriesModal`, com exportação CSV e parâmetros customizáveis (solar/eólico) persistidos em `localStorage`.
- O painel "Sobre as variáveis" inicia minimizado; a prévia usa o `summary.json` do domínio quando disponível.
- A aba "Variáveis" da documentação dos mapas usa seções expansíveis com fórmulas e limitações por variável.

## Camada De Dados E Performance

O carregamento de JSON do WebGIS passa por `LabmimDataService` (`data-service.js`), exposto em `window.LabmimDataService` e instanciado por `MeteoMapManager` como `this.dataService`. `MeteoMapManager._cachedFetch()` e `ChartsManager._fetchHourJson()` delegam a ele. O serviço oferece:

- **Cache LRU em memória** (limite base 400 entradas; cresce com o tamanho da rodada via `ensureCacheLimit`).
- **Deduplicação de requisições em voo**: chamadas concorrentes à mesma URL compartilham um único `fetch` + parse.
- **Cache negativo**: 60 s para ausência determinística (404/403/410 — ex.: horas noturnas de `SWDOWN`) e apenas 4 s para falhas transitórias (rede/5xx), que podem se recuperar rápido.
- **Parsing em Web Worker** (`json-parser.worker.js`) com _fallback_ transparente para a thread principal caso o worker falhe.
- **Distinção 404 vs falha transitória**: um 404 determinístico é lacuna esperada; apenas falhas transitórias impedem o cache de séries.

Ciclo de vida do manifest (`map-init.js` + `map-manager.js`):

- `JSON/manifest.json` é buscado no parse do script com corrida de 3 s (um manifest lento não atrasa o primeiro paint) e adotado tardiamente se perder a corrida.
- Re-checagem a cada **15 min** e ao voltar o foco da aba (gap mínimo de 5 min). Quando a versão muda (rodada nova publicada nos mesmos nomes de arquivo), `handleManifestUpdate()` limpa o cache de dados e de gráficos, refaz as grades e reancora a linha do tempo — sem recarregar a página.
- `dataUrl()` anexa `?v=<versão da rodada>` a toda URL de dados; o `.htaccess` dá 24 h de cache a dados versionados (vs `no-cache` sem versão).

Outras otimizações da camada de mapa:

- A grade preferida é `GeoJSON/{D}.grid.json` (compacta, ~2 KB, expandida no cliente); o `.geojson` de 1,2–2,6 MB é só fallback. A grade fica em cache por domínio e **não** é descartada ao trocar de variável ou altura.
- Valores e grade são buscados em paralelo (`Promise.all`), com chaves de staleness por (versão, domínio, variável, passo) — o mapa nunca pinta dados velhos sob um rótulo novo.
- **Prefetch** dos próximos 2 passos reproduzíveis durante a animação (desligado sob `navigator.connection.saveData`).
- A interpolação de cores roda em `color-calc.worker.js`, com _fallback_ para a thread principal e descarte de respostas obsoletas por `requestId`.
- A série de uma célula é lida de `series.bin` com **uma requisição Range** em vez de até 76 fetches; o resumo do domínio vem de um único `summary.json`.

Cache busting dos assets (build):

- CSS/JS próprios: `?v=<hash md5-8 do conteúdo>` estampado por `build.js` em todo `href`/`src` (regra `immutable` de 1 ano no `.htaccess` para URLs versionadas).
- Web Workers: hashes publicados na `<meta name="labmim-asset-hashes">` e lidos por `workerScriptUrl()` (sem a meta, a URL sai sem `?v=` e cai no cache curto).
- Vendor: tokens manuais de release (`?v=1.9.4`, `?v=3.9.1`, `?v=5.3.8`, `?v=6.4.0`) + cache `immutable` de 1 ano — **exceto** `bootstrap.purged.min.css`, que é content-hashed pelo build (o conteúdo depende do HTML do site), e as webfonts do Font Awesome, que ficam na regra de 7 dias (o subset regenera no mesmo nome).

## Dark Mode

O dark mode é dividido em dois passos:

- `theme-boot.js` roda cedo e aplica `.dark-theme` antes do carregamento completo, reduzindo flash visual.
- `theme-toggle.js` controla os botões de tema, persiste `labmim-theme` em `localStorage` e emite `labmim-theme-change`.

`charts-manager.js` escuta `labmim-theme-change` para atualizar cores dos gráficos sem recriar toda a UI.

## Manutenção

- **Navbar, rodapé, `<head>` e blocos de script são compartilhados**: edite-os em `src/partials/` e rode `make build`. Nunca edite header/footer diretamente em `site/*.html` — esses arquivos são gerados por `build.js` e serão sobrescritos. A ordem e os rótulos da navegação vêm do array `NAV` em `build.js` (fonte única para navbar e footer); o estado ativo vem do campo `active` de cada página em `PAGES`.
- Para adicionar uma página: crie `src/pages/<nome>.html` (apenas o conteúdo único), adicione uma entrada em `PAGES` no `build.js` (`file`, `layout`, `active`, `h1`, `title`, `description` e, para mapas, `bodyAttrs`) e, se for destino de navegação, uma entrada em `NAV`. Rode `make build` e commite o HTML gerado.
- Para alterar cores, espaçamentos globais e tokens, comece por `assets/css/base.css`. Use `--brand-primary`/`--brand-secondary` para a marca navy (fixa entre temas) e `--map-accent*` para o accent roxo do WebGIS.
- Para navbar, footer e estrutura de página, use `assets/css/layout.css`; cards e blocos reutilizáveis em `components.css`; dark mode em `theme.css`; WebGIS em `maps.css`.
- Para adicionar uma variável ao mapa, atualize `variables-config.js` e o contexto em `VARIABLE_CONTEXTS` — o `<select>` é montado em runtime, não há lista no HTML para sincronizar. Garanta que o pipeline exporte os arquivos da variável.
- Para lógica de mapa, prefira métodos em `MeteoMapManager` e preserve a API global exposta em `window.MeteoMapManager`.
- Para busca/cache de dados, use `LabmimDataService` em vez de `fetch` direto; mantenha a API de `data-service.js` estável para os consumidores.
- Para gráficos temporais, altere `ChartsManager` e preserve os IDs usados no modal.
- Ao atualizar uma biblioteca vendorizada (Leaflet, Chart.js, Bootstrap bundle, FA css), substitua o arquivo em `assets/vendor/` e atualize o `?v=` manual correspondente em `src/partials/`/`src/layouts/`, depois rode `make build`. CSS/JS próprios, `bootstrap.purged.min.css` e os workers **não** precisam de token manual — o hash é automático no build.
- O CSP do `.htaccess` é `script-src 'self'` (sem scripts inline). Qualquer script novo precisa ser um arquivo próprio; JSON-LD (`application/ld+json`) é permitido por não ser executável.

## Checklist Manual Rápido

Antes de publicar:

- Abrir `index.html`, `monitoring.html`, `team.html` e `climatologia.html` em light e dark mode.
- Abrir `mapas_interativos.html` e verificar se o mapa renderiza apenas variáveis meteorológicas/radiativas, incluindo Radiação Global.
- Abrir `potenciais_energeticos.html` e verificar se o mapa renderiza apenas Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Testar troca de variável (a grade não deve piscar/recarregar do zero).
- Testar botões de domínio `BA/NE`, `BA`, `RMS` e `SSA`, confirmando que as requisições continuam usando IDs técnicos `D01-D04`.
- Testar play/pause do slider temporal e conferir que o rótulo de data/hora segue o manifest (não deve haver passos "sem dados" em loop com manifest presente).
- Confirmar que `windLayerToggle` aparece em `wind`/`eolico` e não aparece nas demais variáveis.
- Clicar em uma célula do mapa e verificar sidebar e modal de série temporal (a série deve carregar quase instantânea via `series.bin` quando o manifest anuncia `features.cell_series`).
- Alternar dark mode com modal aberto e verificar gráficos/títulos.
- Conferir responsividade em largura mobile.
- Verificar console do navegador sem erros.

## Notas Para Futuros Desenvolvedores

- Este repositório não contém o pipeline que gera os dados WRF; ele apenas consome os arquivos publicados em `site/GeoJSON/` e `site/JSON/`. O pipeline vive em [micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) (CLI `labmim-wrf-geojson`).
- Não abra, varra, formate ou reprocesse `/data`; evite também ler conteúdo de `site/JSON/` e `site/GeoJSON/` fora de depuração estritamente necessária.
- Evite estilos inline em HTML. Use os módulos CSS existentes.
- Evite adicionar dependências de build para o runtime do site; hoje ele funciona como site estático.
- Mudanças no formato dos dados devem ser **aditivas e com fallback no cliente** — site e dados são publicados de forma desacoplada em produção.
- A documentação técnica detalhada fica em [Architecture.md](Architecture.md).
