# LabMiM Site

Site estático do LabMiM - Laboratório de Micrometeorologia e Modelagem da UFBA. O projeto reúne páginas institucionais, visualização de gráficos de monitoramento ambiental e WebGIS para previsões meteorológicas e potenciais energéticos derivados de saídas do modelo WRF.

O site é servido como frontend estático: HTML, CSS e JavaScript no navegador, sem backend próprio neste repositório. As páginas em `site/` são **geradas** a partir de fontes em `src/` por um passo de build local/CI sem dependências de runtime (`build.js`, apenas a biblioteca padrão do Node), que expande _partials_ compartilhados (head, navbar, footer, scripts) em HTML estático puro. O host continua servindo somente arquivos estáticos — não há build no servidor. Os mapas interativos carregam arquivos `GeoJSON/` e `JSON/` gerados por pipeline externo.

## Funcionalidades

- Página inicial institucional com resumo do LabMiM e parceiros.
- Página de monitoramento com gráficos PNG em cards e modais Bootstrap.
- Página de equipe com links de pesquisadores e localização incorporada.
- Página de climatologia atualmente em construção.
- WebGIS de previsões em `mapas_interativos.html` com variáveis meteorológicas.
- WebGIS de potenciais energéticos em `potenciais_energeticos.html` com potencial fotovoltaico, potencial eólico e densidade eólica.
- Leaflet com renderização em Canvas, domínios WRF, palhetas por variável, animação temporal, recorte por estado, camada de vento e séries temporais em modal.
- Camada de dados compartilhada (`data-service.js`) com cache em memória, deduplicação de requisições em voo, cache negativo e parsing em Web Worker.
- Dark mode persistente em `localStorage`, com sincronização para gráficos via evento `labmim-theme-change`.

## Estrutura Do Repositório

```text
.
├── README.md
├── Architecture.md
├── package.json
├── package-lock.json
├── .nvmrc                     # Node LTS usado pelo projeto e pelo CI
├── eslint.config.mjs
├── .stylelintrc.json
├── .prettierrc / .prettierignore
├── .editorconfig
├── .github/
│   ├── workflows/ci.yml       # build-check + lint + format-check + audit
│   └── dependabot.yml         # atualizações npm e GitHub Actions
├── Makefile
├── build.js                   # gerador estático (src/ -> site/*.html), só stdlib do Node
├── src/                       # FONTE das páginas — edite AQUI, nunca em site/*.html
│   ├── layouts/
│   │   ├── institutional.html # index, monitoring, team, climatologia
│   │   └── webgis.html        # mapas_interativos, potenciais_energeticos
│   ├── partials/
│   │   ├── head.html          # <head> compartilhado (meta, CSS, scripts de tema)
│   │   ├── nav.html           # navbar (itens gerados do array NAV em build.js)
│   │   ├── footer.html        # rodapé compartilhado
│   │   └── scripts.html       # Bootstrap bundle (fim do body)
│   └── pages/                 # conteúdo único de cada página (sem head/nav/footer)
│       ├── index.html
│       ├── monitoring.html
│       ├── team.html
│       ├── climatologia.html
│       ├── mapas_interativos.html
│       └── potenciais_energeticos.html
└── site/                      # SAÍDA publicada (HTML gerado + assets estáticos)
    ├── .htaccess              # charset, MIME, compressão, cache, cabeçalhos de segurança, 404, 301
    ├── robots.txt             # regras de crawl (bloqueia /JSON/, /GeoJSON/, /figuras/)
    ├── 404.html               # página de erro (standalone, caminhos absolutos)
    ├── index.html             # ┐
    ├── monitoring.html        # │ gerados por build.js a partir de src/
    ├── team.html              # │ (não edite à mão — serão sobrescritos)
    ├── climatologia.html      # │
    ├── mapas_interativos.html # │
    ├── potenciais_energeticos.html  # ┘
    ├── mapas_meteorologicos.html   # redirect de compatibilidade (mantido à mão)
    ├── GeoJSON/               # grades geradas (git-ignored)
    ├── JSON/                  # valores gerados (git-ignored)
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
        │   ├── data-service.js      # LabmimDataService (fetch/cache/worker)
        │   ├── charts-manager.js
        │   ├── map-manager.js
        │   ├── map-init.js
        │   └── workers/
        │       ├── color-calc.worker.js
        │       └── json-parser.worker.js
        ├── vendor/            # bibliotecas vendorizadas localmente
        │   ├── bootstrap/     # Bootstrap 5.3.8 (min css + bundle js)
        │   ├── fontawesome/   # Font Awesome 6.4.0 (css + webfonts)
        │   ├── leaflet/       # Leaflet 1.9.4 (js, css, images)
        │   └── chartjs/       # Chart.js 3.9.1
        ├── data/
        │   └── br_ba.json     # contorno da Bahia (recorte por estado)
        ├── graphs/
        ├── icon/
        ├── img/
        └── json/              # reservado (apenas .gitkeep)
```

`site/GeoJSON/` e `site/JSON/` são dados gerados e ficam fora do controle de versão (ver `.gitignore`). O código atual busca `GeoJSON/{domain}.geojson`, `JSON/{domain}_{variableId}_{hour}.json` e `JSON/{domain}_WIND_VECTORS_{hour}.json`. Não abra, formate ou reprocesse `/data`, `site/JSON/` ou `site/GeoJSON/` durante manutenção comum; esses diretórios podem conter dados grandes gerados por pipeline externo.

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

## Dependências Externas Em Runtime

Todo o site usa **uma única versão do Bootstrap — 5.3.8 — vendorizada localmente** em `assets/vendor/bootstrap/`. As páginas institucionais deixaram de usar Bootstrap 4 + jQuery + Popper; **não há mais jQuery no projeto** (os componentes usados — colapso da navbar e modais do monitoramento — funcionam apenas com o bundle do Bootstrap 5). Bootstrap, **Font Awesome 6.4.0**, Leaflet, Chart.js e o contorno da Bahia são todos carregados **localmente** (`assets/vendor/` e `assets/data/`) — **não há mais CDN no caminho crítico de renderização** (CSS/JS). `leaflet.js` é carregado com `defer` para não bloquear o primeiro paint. O antigo Turf.js foi removido — a máscara de recorte por estado agora usa um _point-in-polygon_ local em `map-manager.js`.

A única origem externa restante é a base cartográfica:

- Tiles do mapa base via OpenStreetMap (dados do mapa, apenas nas páginas WebGIS).

## Desenvolvimento

O projeto usa a versão de Node fixada em `.nvmrc` (Node 24 LTS). Com `nvm`:

```bash
nvm install    # instala a versão do .nvmrc, se necessário
nvm use
npm ci
```

Comandos úteis:

```bash
npm run build         # gera site/*.html a partir de src/
npm run build:check   # gera e falha se site/*.html estiver desatualizado (usado no CI)
npm run lint:js
npm run lint:css
npm run format:check
npm run format
```

Também há atalhos no `Makefile`:

```bash
make build         # gera as páginas a partir de src/
make build-check   # gera e verifica se site/*.html está atualizado
make lint          # ESLint + Stylelint (somente verifica)
make format-check  # Prettier (somente verifica)
make fix           # aplica Prettier + correções dos linters
make audit         # npm audit --audit-level=high
make ci            # build-check + format-check + lint + audit (espelha o CI)
```

As ferramentas de desenvolvimento (ESLint, Stylelint, Prettier, `stylelint-config-standard`) são declaradas em `package.json` como `devDependencies`. Não há dependências de runtime instaladas via npm — o site é estático e `build.js` usa apenas a biblioteca padrão do Node. O CI (`.github/workflows/ci.yml`) roda o `build:check` (garante que `site/*.html` está em sincronia com `src/`), lint, format-check e `npm audit`; o Dependabot (`.github/dependabot.yml`) acompanha atualizações de npm e GitHub Actions.

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

## Camada De Dados E Performance

O carregamento de dados do WebGIS passa por `LabmimDataService` (`data-service.js`), exposto em `window.LabmimDataService` e instanciado por `MeteoMapManager` como `this.dataService`. `MeteoMapManager._cachedFetch()` e `ChartsManager._fetchHourJson()` delegam a ele. O serviço oferece:

- **Cache em memória** com limite de tamanho, evitando re-download do mesmo JSON ao trocar variável ou horário.
- **Deduplicação de requisições em voo**: chamadas concorrentes à mesma URL compartilham um único `fetch` + parse.
- **Cache negativo** (60 s): um arquivo ausente não é re-requisitado a cada tick da animação.
- **Parsing em Web Worker** (`json-parser.worker.js`) com _fallback_ transparente para a thread principal caso o worker falhe ao carregar.
- **Distinção 404 vs falha transitória**: um `404` determinístico (ex.: horas noturnas de `SWDOWN`, que o pipeline não exporta) é tratado como lacuna esperada; apenas falhas transitórias (rede/5xx) impedem o cache de séries.

Outras otimizações da camada de mapa:

- A grade (`GeoJSON/{domain}.geojson`) fica em cache por domínio e **não** é descartada ao trocar de variável ou altura — só muda quando o domínio muda.
- Valores e grade são buscados em paralelo (`Promise.all`), não em sequência.
- A interpolação de cores roda em `color-calc.worker.js`, com _fallback_ para a thread principal e descarte de respostas obsoletas por `requestId`.
- As bibliotecas vendorizadas usam versionamento por query (`?v=<versão da lib>`) para invalidação de cache no deploy — necessário porque `assets/vendor/` recebe cache `immutable` de 1 ano no `.htaccess`.

## Dark Mode

O dark mode é dividido em dois passos:

- `theme-boot.js` roda cedo e aplica `.dark-theme` antes do carregamento completo, reduzindo flash visual.
- `theme-toggle.js` controla os botões de tema, persiste `labmim-theme` em `localStorage` e emite `labmim-theme-change`.

`charts-manager.js` escuta `labmim-theme-change` para atualizar cores dos gráficos sem recriar toda a UI.

## Manutenção

- **Navbar, rodapé, `<head>` e blocos de script são compartilhados**: edite-os em `src/partials/` e rode `make build`. Nunca edite header/footer diretamente em `site/*.html` — esses arquivos são gerados por `build.js` e serão sobrescritos. A ordem e os rótulos da navegação vêm do array `NAV` em `build.js` (fonte única para navbar e footer); o estado ativo do menu é derivado do campo `active` de cada página em `PAGES`.
- Para adicionar uma página: crie `src/pages/<nome>.html` (apenas o conteúdo único, sem head/nav/footer), adicione uma entrada em `PAGES` no `build.js` e, se for um destino de navegação, uma entrada em `NAV`. Rode `make build`.
- Para alterar cores, espaçamentos globais e tokens, comece por `assets/css/base.css`. Use `--brand-primary`/`--brand-secondary` para a marca navy (fixa entre temas, diferente de `--primary-color`, que muda no dark mode) e `--map-accent*` para o accent roxo do WebGIS.
- Para navbar, footer e estrutura de página, use `assets/css/layout.css`.
- Para cards, parceiros, financiadores, modais e blocos reutilizáveis, use `assets/css/components.css`.
- Para dark mode e variações de tema, use `assets/css/theme.css`.
- Para estilos exclusivos do WebGIS, use `assets/css/maps.css`.
- Para adicionar uma variável ao mapa, atualize `variables-config.js`, o contexto em `VARIABLE_CONTEXTS` e o fallback do `<select id="variableSelect">` nas páginas WebGIS.
- Para lógica de mapa, prefira métodos em `MeteoMapManager` e preserve a API global exposta em `window.MeteoMapManager`.
- Para busca/cache de dados, use `LabmimDataService` em vez de `fetch` direto; mantenha a API de `data-service.js` estável para os consumidores.
- Para gráficos temporais, altere `ChartsManager` e preserve os IDs usados no modal.
- Ao atualizar uma biblioteca vendorizada, substitua o arquivo em `assets/vendor/` e atualize o `?v=` correspondente em `src/partials/`/`src/layouts/` (depois rode `make build`).

## Checklist Manual Rápido

Antes de publicar:

- Abrir `index.html`, `monitoring.html`, `team.html` e `climatologia.html` em light e dark mode.
- Abrir `mapas_interativos.html` e verificar se o mapa Leaflet renderiza apenas variáveis meteorológicas/radiativas, incluindo Radiação Global.
- Abrir `potenciais_energeticos.html` e verificar se o mapa renderiza apenas Potencial Fotovoltaico, Potencial Eólico e Densidade Eólica 10m.
- Testar troca de variável (a grade não deve piscar/recarregar do zero).
- Testar botões de domínio `BA/NE`, `BA`, `RMS` e `SSA`, confirmando que as requisições continuam usando IDs técnicos `D01-D04`.
- Testar play/pause do slider temporal.
- Confirmar que `windLayerToggle` aparece em `wind`/`eolico` e não aparece nas demais variáveis.
- Clicar em uma célula do mapa e verificar sidebar e modal de série temporal.
- Alternar dark mode com modal aberto e verificar gráficos/títulos.
- Conferir responsividade em largura mobile.
- Verificar console do navegador sem erros.

## Notas Para Futuros Desenvolvedores

- Este repositório não contém o pipeline que gera os dados WRF; ele apenas consome os arquivos publicados em `site/GeoJSON/` e `site/JSON/`.
- Não abra, varra, formate ou reprocesse `/data`; evite também ler conteúdo de `site/JSON/` e `site/GeoJSON/` fora de depuração estritamente necessária.
- Evite estilos inline em HTML. Use os módulos CSS existentes.
- Evite adicionar dependências de build para o runtime do site; hoje ele funciona como site estático.
- A documentação técnica detalhada fica em [Architecture.md](Architecture.md).
```
