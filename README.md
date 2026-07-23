# Sites LabMiM / LEAL

Gerador de sites estáticos para publicações meteorológicas, atualmente **LabMiM/UFBA** e **LEAL/UFES**, preparado para incorporar outros estados e instituições sem duplicar a aplicação. O projeto reúne páginas institucionais, monitoramento ambiental e WebGIS para previsões meteorológicas e potenciais energéticos derivados de saídas do modelo WRF.

O resultado continua sendo HTML, CSS e JavaScript puros, sem backend e sem Node no servidor. O build local/CI descobre automaticamente cada `src/sites/<id>/site.js`, valida sua configuração, combina conteúdo próprio com o template comum, gera SEO/404/robots/sitemap e **carimba hashes de conteúdo (`?v=<md5-8>`) nos assets próprios** para invalidação automática de cache.

Os dados dos mapas interativos (`site/JSON/` e `site/GeoJSON/`) **não são gerados aqui**: eles vêm do pipeline WRF do repositório irmão **[micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology)** — ver [Dados do WebGIS (pipeline externo)](#dados-do-webgis-pipeline-externo).

## Funcionalidades

- Página inicial institucional, equipe, identidade e SEO próprios de cada publicação.
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
├── build.js                       # seleciona, valida e renderiza uma publicação
├── scripts/
│   ├── site-builder/              # descoberta, validação, renderização e assets
│   ├── build-site.mjs             # wrapper de um build + formatação da saída
│   ├── build-all.mjs              # cria um bundle por publicação em dist/
│   └── check-publications.mjs     # valida todas e restaura a publicação padrão
├── src/
│   ├── template/                  # aplicação compartilhada, sem identidade institucional
│   │   ├── layouts/               # esqueletos institutional e webgis
│   │   ├── partials/              # head, navbar, footer, scripts e documentação
│   │   ├── pages/                 # conteúdos realmente comuns
│   │   ├── static/                # 404 e template de .htaccess
│   │   └── page-types.js          # catálogo e helpers page/customPage
│   ├── sites/
│   │   ├── README.md              # receita operacional para nova publicação
│   │   ├── ufba/
│   │   │   ├── site.js            # composição da publicação
│   │   │   ├── identity.js        # marca, instituição, origem e redirects
│   │   │   ├── pages.js           # manifesto de páginas, SEO e navegação
│   │   │   ├── theme.css          # paleta exclusiva
│   │   │   ├── pages/             # conteúdos exclusivos
│   │   │   └── fragments/         # trechos exclusivos anexáveis
│   │   └── ufes/                  # mesma fronteira de módulo
│   ├── territories/               # estado, contorno e viewport (ba.js, es.js, ...)
│   └── datasets/                  # caminhos, timeline e domínios WRF por produto
├── site/                           # saída compatível: uma publicação por vez
│   ├── *.html, .htaccess, robots.txt, sitemap.xml
│   ├── assets/                     # CSS/JS/imagens/vendor compartilhados
│   ├── JSON/                       # dados operacionais externos, não gerados no build
│   └── GeoJSON/                    # grades operacionais externas, não geradas no build
└── dist/<id>/                      # bundles estáticos de build:all, sem JSON/GeoJSON
```

As fronteiras são intencionais:

- `src/template/` deve permanecer neutro quanto a instituição e estado.
- `src/sites/<id>/` contém somente o que pertence à publicação.
- `src/territories/` descreve a geografia; `src/datasets/` descreve o produto de dados. Ambos podem ser reutilizados por mais de uma publicação.
- `site/` e `dist/` são saídas geradas. Edite sempre `src/` ou os assets-fonte existentes em `site/assets/`, nunca os HTMLs gerados.

## Dados Do WebGIS (Pipeline Externo)

`site/JSON/` e `site/GeoJSON/` são os caminhos operacionais das publicações atuais e ficam fora do controle de versão (ver `.gitignore`). Novos datasets podem declarar outros caminhos em `dataset.paths`; nesse caso, inclua-os também no `.gitignore`. Quem gera os dados atuais é o repositório irmão **[micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology)**, pela CLI `labmim-wrf-geojson` (entry point `micrometeorology.cli.export_wrf_geojson`; escrita dos artefatos em `wrf/jobs.py` e `wrf/geojson.py`). Invocação típica a partir de saídas `wrfout_d0X_*` do WRF:

```bash
labmim-wrf-geojson --wrf-dir <dir com wrfout> --date YYYYMMDD -D 1,2,3,4 \
  -o site/JSON -g site/GeoJSON --workers 14
```

O fuso do produto é fixado por `LABMIM_TIMEZONE` (default `America/Bahia`); `--no-site-artifacts` desliga a escrita dos artefatos consolidados. O contrato de integração é documentado no próprio repositório do pipeline (`docs/micrometeorology.md`, seção "Front-end integration (site-labmim)").

Artefatos que o site consome:

| Arquivo                            | Formato                               | Uso no site                                                                                                                                   |
| ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `JSON/manifest.json`               | `labmim-data-manifest-v2`             | Versão da rodada (`?v=` nos dados), intervalo do slider, âncora de data, disponibilidade por variável, descritores dos artefatos consolidados |
| `GeoJSON/{D}.grid.json`            | `grid-edges-v1` (ou `grid-bounds-v1`) | Grade compacta (~2 KB) expandida no cliente; preferida                                                                                        |
| `GeoJSON/{D}.geojson`              | FeatureCollection                     | Grade legada (1,2–2,6 MB); fallback quando não há `grid.json`                                                                                 |
| `JSON/{D}_{VAR}_{NNN}.json`        | valores por passo                     | Cores do mapa (`values[]` indexado por `linear_index`)                                                                                        |
| `JSON/{D}_WIND_VECTORS_{NNN}.json` | vetores por passo                     | Setas de vento da variável `wind` (o `eolico` embute vetores em `metadata.wind`)                                                              |
| `JSON/{D}_{VAR}.series.bin`        | `cell-series-int32-le-v1`             | Série temporal de uma célula via HTTP Range (~300 B por leitura)                                                                              |
| `JSON/{D}_{VAR}.summary.json`      | `domain-summary-v1`                   | Média/mín/máx do domínio por passo (painel "Sobre as variáveis")                                                                              |

O site **degrada graciosamente**: sem manifest (ou com manifest v1) ele usa o intervalo padrão de 73 passos e a heurística solar legada; sem `grid.json` cai no `.geojson`; sem `series.bin`/`summary.json` volta à varredura hora-a-hora. Isso permite publicar site e dados em qualquer ordem (site primeiro é o preferido).

Não abra, formate ou reprocesse `/data`, `site/JSON/` ou `site/GeoJSON/` durante manutenção comum; esses diretórios contêm dados grandes gerados pelo pipeline externo.

## Como Executar Localmente

Não abra as páginas direto por `file://`. Os mapas e workers dependem de `fetch`, então use um servidor HTTP local.

Liste as publicações descobertas e gere a desejada antes de servir/publicar:

```bash
npm run sites:list
npm run build -- --site=ufba
npm run build -- --site=ufes
```

Sem `--site`, o build usa a única publicação marcada com `isDefault: true`. `SITE_ID` é a forma equivalente por variável de ambiente; `--variant` e `SITE_VARIANT` permanecem somente como compatibilidade.

```bash
SITE_ID=ufes npm run build
npm run build                 # publicação padrão
npm run build:all             # todos os bundles em dist/<id>/
npm run build:check           # valida todas e restaura a padrão em site/
```

O build individual sempre escreve em `site/`, preservando o fluxo de deploy existente. `build:all` materializa uma cópia autocontida do frontend em `dist/<id>/` para cada publicação; esses bundles omitem o manifest e os diretórios declarados em `dataset.paths`, pois os dados operacionais pertencem ao pipeline externo. O build também remove HTMLs antigos que não façam parte do manifesto selecionado, evitando vazamento de páginas entre publicações.

> A publicação seleciona o **frontend**; ela não converte os dados operacionais. Cada deploy precisa receber, nos caminhos configurados pelo respectivo dataset, a rodada WRF e os gráficos de monitoramento produzidos para aquela instituição.

Para adicionar um estado, uma publicação ou uma página, siga a receita em [`src/sites/README.md`](src/sites/README.md). Não é necessário registrar o novo ID em `build.js` ou em `package.json`: a existência de um `src/sites/<id>/site.js` válido é o registro.

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

O deploy é manual e deve ser precedido por `npm run build -- --site=<id>` (ou pela seleção do bundle correspondente em `dist/<id>/`). Código e dados são publicados de forma desacoplada. Regras aprendidas em produção:

- **Publicar o site completo junto com o `.htaccess`** — nunca subir o `.htaccess` sozinho sobre uma versão antiga do site: a CSP `script-src 'self'` quebra páginas que ainda usem CDN/scripts inline.
- **Ordem segura para mudanças de formato de dados**: (1) publicar o site novo, (2) conferir em produção, (3) atualizar o pipeline no servidor de operação e regenerar os dados — o cliente tem fallback para todos os contratos, então site novo + dados velhos funciona; o inverso não é garantido.
- **Rollback do pipeline**: se voltar a uma versão que não escreve `manifest.json`, deletar o manifest órfão do servidor junto (um manifest órfão congela o `?v=` enquanto os bytes mudam por baixo; o `.htaccess` limita o estrago a 24 h). Os artefatos `series.bin`/`summary.json` devem ir e vir junto com o manifest que os anuncia.
- Após publicar, conferir os cabeçalhos servidos: `curl -sI -H 'Accept-Encoding: gzip' https://labmim.if.ufba.br/GeoJSON/D01.geojson` (compressão e `Cache-Control` dependem do `.htaccess` estar ativo no host).

## Dependências Externas Em Runtime

Todo o site usa **uma única versão do Bootstrap — 5.3.8 — vendorizada localmente** em `assets/vendor/bootstrap/`. As páginas carregam o CSS **purgado** (`bootstrap.purged.min.css`, ~27 KB via PurgeCSS; o `bootstrap.min.css` completo fica como fonte do purge e para o `404.html`). **Não há jQuery no projeto.** O Font Awesome 6.4.0 usa um **subset de fonte** (`fa-solid-900.woff2` com só os glifos usados, ~6 KB; ver `scripts/subset-fontawesome.md`). Bootstrap, Font Awesome, Leaflet 1.9.4, Chart.js 3.9.1 e os contornos de BA/ES são carregados **localmente** (`assets/vendor/` e `assets/data/`) — não há CDN no caminho crítico de renderização. `leaflet.js` é carregado com `defer`. O antigo Turf.js foi removido — a máscara de recorte por estado usa um _point-in-polygon_ local em `map-manager.js`.

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
npm run sites:list    # lista src/sites/<id>/site.js descobertos e marca o padrão
npm run build         # gera a publicação padrão em site/ (+ Prettier na saída)
npm run build -- --site=ufes # gera uma publicação específica em site/
npm run build:all     # gera todos os bundles em dist/<id>/, sem dados operacionais
npm run build:check   # gera/valida todas as publicações e restaura a padrão
npm run lint          # JS/CSS + contrato de temas + checks de ícones/purge
npm run lint:all      # lint + lint:html + lint:links
npm run lint:js       # ESLint no runtime, build e módulos de configuração
npm run lint:css      # Stylelint no CSS compartilhado e nos temas dos sites
npm run lint:themes   # contrato token-only, isolamento e ordem da cascata CSS
npm run lint:icons    # cobertura do subset Font Awesome (scripts/check-fa-subset.mjs)
npm run lint:purge    # cobertura do Bootstrap purgado (scripts/check-bootstrap-purge.mjs)
npm run lint:html     # html-validate nas páginas geradas
npm run lint:links    # linkinator (ignora externos e os caminhos do dataset padrão)
npm run format        # Prettier no output e nos módulos JS/CSS do gerador
npm run format:check
```

Também há atalhos no `Makefile`:

```bash
make build         # gera as páginas a partir de src/
make build-check   # valida todas as publicações e a saída padrão
make lint          # ESLint + Stylelint + contrato de temas + checks de assets
make lint-html     # html-validate
make lint-links    # linkinator
make format-check  # Prettier (somente verifica)
make fix           # aplica Prettier + correções dos linters
make audit         # npm audit --audit-level=high
make serve         # python3 -m http.server 8000 --directory site
make ci            # build-check + format-check + lint + lint-html + lint-links + audit
```

`make ci` roda os mesmos checks do CI do GitHub (o alvo `lint` inclui `lint:icons` e `lint:purge`); o CI valida, além disso, o lockfile e a versão do Node via `npm ci` + `.nvmrc`.

As ferramentas de desenvolvimento (ESLint, Stylelint, Prettier, html-validate, linkinator) são `devDependencies` em `package.json`. Não há dependências de runtime instaladas via npm: o servidor recebe somente os arquivos estáticos gerados. O PurgeCSS é uma dependência exclusiva de desenvolvimento.

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

- Domínios, labels, centros e resoluções definidos no módulo de dataset da publicação; os IDs técnicos (como `D01`–`D04`) continuam nos arquivos, cache e estado interno.
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

- **Navbar, rodapé, `<head>` e blocos de script são compartilhados**: edite-os em `src/template/partials/`. Layouts ficam em `src/template/layouts/`; não edite `site/*.html`.
- Para conteúdo compartilhado, crie o fragmento em `src/template/pages/` e referencie-o com `templateSource()`. Para conteúdo próprio, use `src/sites/<id>/pages/` e `siteSource()`.
- Páginas, SEO e navegação são declarados em `src/sites/<id>/pages.js`; `page()` reutiliza um tipo do catálogo e `customPage()` cria uma rota fora dele.
- Identidade, instituição, origem e redirects ficam em `identity.js`; a paleta fica no `theme.css` da publicação. Cores estruturais comuns permanecem em `site/assets/css/`.
- Estado, contorno e viewport pertencem a `src/territories/`; caminhos, timeline e domínios WRF pertencem a `src/datasets/`.
- Para navbar, footer e estrutura de página, use `assets/css/layout.css`; cards e blocos reutilizáveis em `components.css`; dark mode em `theme.css`; WebGIS em `maps.css`.
- Para adicionar uma variável ao mapa, atualize `variables-config.js` e o contexto em `VARIABLE_CONTEXTS` — o `<select>` é montado em runtime, não há lista no HTML para sincronizar. Garanta que o pipeline exporte os arquivos da variável.
- Para lógica de mapa, prefira métodos em `MeteoMapManager` e preserve a API global exposta em `window.MeteoMapManager`.
- Para busca/cache de dados, use `LabmimDataService` em vez de `fetch` direto; mantenha a API de `data-service.js` estável para os consumidores.
- Para gráficos temporais, altere `ChartsManager` e preserve os IDs usados no modal.
- Ao atualizar uma biblioteca vendorizada (Leaflet, Chart.js, Bootstrap bundle, FA css), substitua o arquivo em `assets/vendor/` e atualize o `?v=` manual correspondente em `src/template/partials/` ou `src/template/layouts/`, depois rode o build. CSS/JS próprios, `bootstrap.purged.min.css` e os workers **não** precisam de token manual — o hash é automático.
- O CSP do `.htaccess` é `script-src 'self'` (sem scripts inline). Qualquer script novo precisa ser um arquivo próprio; JSON-LD (`application/ld+json`) é permitido por não ser executável.

## Checklist Manual Rápido

Antes de publicar:

- Abrir `index.html`, `monitoring.html`, `team.html` e `climatologia.html` em light e dark mode.
- Abrir `mapas_interativos.html` e verificar se o mapa renderiza apenas variáveis meteorológicas/radiativas, incluindo Radiação Global.
- Abrir `potenciais_energeticos.html` e verificar se o mapa renderiza apenas Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Testar troca de variável (a grade não deve piscar/recarregar do zero).
- Testar todos os botões de domínio da publicação selecionada, confirmando que as requisições usam os IDs técnicos configurados no dataset.
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
