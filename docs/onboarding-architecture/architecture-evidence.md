# Evidências arquiteturais — plataforma estática multi-publicação

Documento-base da apresentação de onboarding. As afirmações abaixo foram verificadas no código atual do
repositório `site-labmim`. O nível `Confirmado` significa leitura direta do arquivo/símbolo citado;
`Operacional` significa que a prática depende também do ambiente de deploy.

Repositórios envolvidos:

- `site-labmim` — gerador e frontend estático multi-publicação.
- `micrometeorology` — pipeline externo que produz JSON, GeoJSON, binários e PNGs de monitoramento.

---

## 1. Natureza do projeto

Responsabilidade:
Gerar sites institucionais e WebGIS estáticos para diferentes publicações meteorológicas. O servidor de
produção recebe HTML, CSS, JavaScript e assets; não executa Node nem possui backend deste projeto.

Arquivos:

- `package.json`
- `build.js`
- `README.md`
- `Architecture.md`
- `site/.htaccess`

Evidências:

- `package.json` não possui `dependencies` de runtime; ferramentas aparecem em `devDependencies`.
- Bibliotecas do navegador ficam em `site/assets/vendor/`.
- Cada rota publicada é um arquivo HTML.
- `build.js` descreve explicitamente que nada do build é necessário no runtime do site.

Confiança: **Confirmado**

Consequência:
Não há framework SPA, router do cliente ou backend a estender. A abstração principal é a composição de
uma publicação no build.

---

## 2. Modelo modular

Responsabilidade:
Separar decisões institucionais, estrutura reutilizável, geografia e produto meteorológico.

| Módulo     | Responsabilidade                                                       | Caminho            |
| ---------- | ---------------------------------------------------------------------- | ------------------ |
| Publicação | marca, instituição, origem, conteúdo, SEO, navegação, redirects e tema | `src/sites/<id>/`  |
| Template   | layouts, partials, páginas e tipos compartilhados                      | `src/template/`    |
| Território | estado, linguagem geográfica, contorno e viewport                      | `src/territories/` |
| Dataset    | paths de dados, timeline e domínios WRF                                | `src/datasets/`    |

Arquivos representativos:

- `src/sites/ufba/site.js`, `src/sites/ufes/site.js`
- `src/template/page-types.js`
- `src/territories/ba.js`, `src/territories/es.js`
- `src/datasets/labmim-wrf.js`, `src/datasets/leal-wrf.js`

Confiança: **Confirmado**

Observação:
Território e dataset não importam identidade de site; podem ser reutilizados. O template usa tokens e
referências declarativas, não condicionais por `ufba`/`ufes`.

---

## 3. Descoberta automática de publicações

Responsabilidade:
Usar o sistema de arquivos como registro, eliminando lista global de IDs.

Arquivos e símbolos:

- `scripts/site-builder/publications.js`
  - `discoverPublications(root)`
  - `defaultPublication(publications)`
  - `selectPublication(publications, id)`
- `src/sites/<id>/site.js`

Invariantes verificadas por `discoverPublications()`:

- a pasta precisa conter `site.js`;
- `publication.id` deve ser igual ao nome da pasta;
- IDs e `origin` devem ser únicos;
- `isDefault` deve ser booleano;
- deve existir exatamente uma publicação padrão;
- a lista retornada tem ordem estável por ID.

Confiança: **Confirmado**

Consequência:
Adicionar uma publicação válida não exige editar `build.js`, `package.json`, uma enum ou lista central.
`sites:list`, `build:all` e `build:check` enxergam o novo módulo automaticamente.

---

## 4. Composição em `site.js`

Responsabilidade:
Montar o objeto final consumido pelo validador e renderer.

Exemplo real:

```js
// src/sites/ufes/site.js
const identity = require("./identity");
const pages = require("./pages");
const dataset = require("../../datasets/leal-wrf");
const territory = require("../../territories/es");

module.exports = { ...identity, territory, dataset, pages };
```

Confiança: **Confirmado**

Observação:
`site.js` deliberadamente não contém lógica de renderização. Ele expressa a combinação editorial,
geográfica e operacional da publicação.

---

## 5. Identidade da publicação

Responsabilidade:
Concentrar informações que respondem “quem publica?”.

Arquivos:

- `src/sites/ufba/identity.js`
- `src/sites/ufes/identity.js`

Campos confirmados:

- `schemaVersion`, `id`, `isDefault`, `origin`;
- `brand.name`, `fullName`, `copyrightName`, `ogImage`;
- logos para `nav`, `footer` e `sidebar`;
- `brand.affiliations` com variantes `image` e `text`;
- `institution`, `location`, `theme` e `redirects`.

Consumidores:

- `scripts/site-builder/validate.js` — valida schema, URLs e assets.
- `scripts/site-builder/renderer.js` — navbar, footer, SEO, JSON-LD e redirects.

Confiança: **Confirmado**

Observações:

- Assets de identidade são caminhos locais sob `site/assets/` e precisam existir.
- Um redirect só pode apontar para output declarado na própria publicação.
- A origem é usada para canonical, Open Graph, sitemap e robots.

---

## 6. Territórios

Responsabilidade:
Descrever a geografia sem acoplá-la a uma instituição.

Arquivos:

- `src/territories/ba.js`
- `src/territories/es.js`
- `site/assets/data/br_ba.json`
- `site/assets/data/br_es.json`

Contrato:

```js
{
  id, kind: "state", code, name,
  regionPhrase, terrainExample, boundaryAsset,
  viewport: { center, zoom, fitBoundary, fitMaxZoom }
}
```

Validação em `validateTerritory()`:

- código de duas letras maiúsculas e compatível com o ID;
- `FeatureCollection` com `Polygon`/`MultiPolygon` válido;
- sigla esperada nas propriedades do GeoJSON;
- coordenadas, zooms e booleano de `fitBoundary` válidos;
- cálculo de bounds do contorno.

Uso em runtime:
`renderer.runtimeConfig()` serializa estado, centro/zoom, contorno e bounds na meta `site-config`.

Confiança: **Confirmado**

---

## 7. Datasets

Responsabilidade:
Descrever o contrato do produto meteorológico consumido pelo frontend.

Arquivos:

- `src/datasets/labmim-wrf.js`
- `src/datasets/leal-wrf.js`

Contrato:

```js
{
  id,
  attribution,
  paths: { manifest, values, grids },
  timeline: { defaultMaxLayer, initialIndex, stepHours, label },
  defaultDomain,
  domains: [{ id, label, longLabel, center, zoom,
              resolution, description, cumulusParameterized }]
}
```

Validação em `validateDataset()`:

- paths relativos seguros e concretos;
- timeline inteira e coerente, incluindo `stepHours > 0` para derivar frequência e horizonte;
- IDs de domínio únicos;
- `defaultDomain` presente no array;
- centros, zooms, labels, resolução e descrição válidos.

Confiança: **Confirmado**

Observação:
IDs como `D01` fazem parte do contrato de arquivos, cache e estado do WebGIS. Labels podem variar por
publicação; IDs técnicos não devem ser alterados apenas por apresentação.

---

## 8. Catálogo de páginas e manifesto editorial

Responsabilidade:
Declarar, por publicação, as rotas, fontes, layout, estilos, SEO e navegação.

Arquivos:

- `src/template/page-types.js`
- `src/sites/ufba/pages.js`
- `src/sites/ufes/pages.js`

Símbolos:

- `PAGE_TYPES`
- `page(type, options)`
- `customPage(options)`
- `templateSource(path)`
- `siteSource(path)`

Tipos atuais:
`home`, `monitoring`, `team`, `climatology`, `forecast` e `energy`.

Campos finais de página:

- `id`, `file`, `layout`, `source`, `append`, `styles`, `vendorStyles`;
- `seo.h1`, `seo.title`, `seo.description`;
- `nav` opcional (`label`, `icon`, `order`, `elementId`);
- campos WebGIS (`bodyAttrs`, `kicker`, `docModalTitle`);
- `indexable` opcional.

Confiança: **Confirmado**

Observações:

- Home e equipe exigem `siteSource()` por definição do catálogo.
- Forecast e energy trazem `assets/css/maps.css` em `styles` e o CSS vendorizado do Leaflet em
  `vendorStyles` pelo tipo de página.
- Cada `pages.js` é a fonte da verdade editorial do respectivo site.
- Navbar, rodapé e sitemap são derivados do mesmo array.

---

## 9. Fontes compartilhadas, exclusivas e anexos

Responsabilidade:
Permitir reuso de conteúdo sem apagar diferenças editoriais.

Regras:

- `templateSource("pages/x.html")` resolve somente em `src/template/`;
- `siteSource("pages/x.html")` resolve somente em `src/sites/<id>/`;
- `append` concatena fontes adicionais depois da fonte principal;
- o validator confina todos os caminhos ao root lógico correspondente.

Exemplo real:
`src/sites/ufba/pages.js` usa a fonte compartilhada de monitoramento e anexa
`siteSource("fragments/funding.html")`; UFES usa apenas a fonte comum.

Confiança: **Confirmado**

Consequências de manutenção:

- editar `src/template/pages/*.html` afeta todas as publicações que referenciam a fonte;
- editar `src/sites/<id>/pages/*.html` afeta somente aquela publicação;
- uma variação pequena pode usar `append`, sem copiar a página inteira.

---

## 10. Renderização e arquivos derivados

Responsabilidade:
Combinar template e manifesto em uma saída estática completa.

Arquivos e símbolos:

- `scripts/site-builder/renderer.js`
  - `renderPublication()`
  - `runtimeConfig()`
  - `seoHead()`
  - `structuredData()`
  - `navItems()` e `footerNavigation()`
  - `pageContent()` e `buildPage()`
  - `buildStaticFiles()`
- `scripts/site-builder/assets.js`
  - `writePublicationTheme()`
  - `createAssetPipeline()`

Outputs derivados:

- todos os HTMLs de `publication.pages`;
- `site/assets/css/site-theme.css`;
- `404.html`, `.htaccess`, `sitemap.xml`, `robots.txt`;
- canonical, Open Graph, Twitter e JSON-LD da home;
- hashes de conteúdo nos assets próprios e workers.

Confiança: **Confirmado**

Observações:

- Partials são descobertos em `src/template/partials/*.html`.
- Tokens não resolvidos interrompem o build.
- HTMLs raiz ausentes no manifesto selecionado são removidos depois de um build bem-sucedido.
- `site/JSON/` e `site/GeoJSON/` não são apagados pelo build individual.
- Sitemap e robots não são mantidos à mão.

---

## 11. CSS: contrato entre identidade e estrutura

Responsabilidade:
Permitir identidade diferente sem duplicar componentes e sem seletores condicionais por site.

Arquivos:

- `src/sites/ufba/theme.css`
- `src/sites/ufes/theme.css`
- `site/assets/css/base.css`
- `site/assets/css/layout.css`
- `site/assets/css/components.css`
- `site/assets/css/theme.css`
- `site/assets/css/maps.css`
- `scripts/check-site-themes.mjs`
- `scripts/site-builder/assets.js`

Fronteira confirmada:

- cada `src/sites/<id>/theme.css` é **token-only** e implementa 19 custom properties institucionais;
- `base.css` contém aliases estruturais comuns, incluindo `--primary-color` e `--secondary-color`;
- tokens de dark accent (`--dark-accent`, hover e RGB) pertencem à publicação;
- aliases redundantes de identidade e `--primary-dark` não fazem parte do tema;
- pares de cor/RGB para brand primary/secondary, accent, map accent e dark accent devem representar
  exatamente a mesma cor;
- não há seletor `data-publication` ou bloco UFBA/UFES nos módulos comuns;
- o build copia apenas o tema selecionado para `site/assets/css/site-theme.css`;
- `npm run lint:themes` verifica o contrato e a fronteira token-only.

Responsabilidades compartilhadas:

| Arquivo          | Escopo                                                 |
| ---------------- | ------------------------------------------------------ |
| `base.css`       | reset, tipografia, utilitários e aliases estruturais   |
| `layout.css`     | navbar, seções, headers e footer                       |
| `components.css` | cards, parceiros, monitoramento e blocos reutilizáveis |
| `theme.css`      | comportamento comum de dark mode e overrides           |
| `maps.css`       | shell e componentes do WebGIS                          |

Confiança: **Confirmado**

---

## 12. CSS específico de página (`page.styles`)

Responsabilidade:
Carregar folhas apenas onde são necessárias e retirar do layout a decisão sobre estilos de feature.

Contrato:

- `page.styles` aceita caminhos estáticos sob `assets/css/` e referências criadas com
  `templateSource("styles/x.css")` ou `siteSource("styles/x.css")`;
- uma referência autoral deve apontar para CSS abaixo de `styles/` no root lógico correspondente;
- estilos definidos no tipo e extras informados pela página são concatenados, não substituídos;
- fontes autorais são copiadas para `assets/css/generated/template/` ou
  `assets/css/generated/<publication.id>/`;
- o namespace gerado é limpo no início de cada build, evitando vazamento entre publicações;
- o renderer injeta CSS vendorizado da página antes de `base.css` e `styles` depois de `components.css` e
  antes de `theme.css`;
- `PAGE_TYPES.forecast` e `PAGE_TYPES.energy` declaram `assets/css/maps.css`.
- esses mesmos tipos declaram `assets/vendor/leaflet/leaflet.css?v=1.9.4` em `vendorStyles`;
- layouts não podem conter `<link rel="stylesheet">`; a ordem pertence ao head/manifesto.

Arquivos:

- `src/template/page-types.js`
- `scripts/site-builder/validate.js`
- `scripts/site-builder/renderer.js`
- `src/template/partials/head.html`

Confiança: **Confirmado**

Consequência:
Um stylesheet novo pode ser fonte do template/site ou asset comum já existente, mas sempre deve ser
declarado em `styles`; não deve ser colocado diretamente no layout nem carregado globalmente sem
necessidade.

Fronteira de ownership:
`page.styles` controla inclusão por página, não identidade institucional. Uma fonte pode ser compartilhada
ou pertencer a um site, mas deve conter estrutura da página; diferenças de marca pertencem aos 19 tokens
do tema.

---

## 13. Validação de publicação

Responsabilidade:
Falhar cedo e apresentar múltiplos problemas de configuração de uma vez.

Arquivo:
`scripts/site-builder/validate.js`

Símbolos principais:

- `validatePublication()`
- `validateBrand()`
- `validateTerritory()`
- `validateDataset()`
- `validatePages()`
- `validateRedirects()`
- `boundaryBounds()`

Categorias validadas:

- schema, ID, origem e diretório da publicação;
- logos, afiliações, assets e tema;
- GeoJSON, viewport e estado;
- paths, timeline e domínios do dataset;
- outputs, fontes, layouts, styles, SEO e navegação;
- redirects internos e hashes seguros.

Confiança: **Confirmado**

---

## 14. Comandos de build

Arquivos:

- `scripts/build-site.mjs`
- `scripts/build-all.mjs`
- `scripts/check-publications.mjs`
- `package.json`

| Comando                        | Resultado                                                |
| ------------------------------ | -------------------------------------------------------- |
| `npm run sites:list`           | lista publicações descobertas e marca a padrão           |
| `npm run build`                | publicação padrão em `site/`                             |
| `npm run build -- --site=<id>` | publicação selecionada em `site/`                        |
| `npm run build:all`            | bundles em `dist/<id>/`, sem JSON/GeoJSON                |
| `npm run build:check`          | constrói/valida todas, restaura a padrão e confere drift |
| `npm run lint:themes`          | valida o contrato e isolamento dos temas                 |

Detalhes de `build:check`:

- executa build de cada publicação descoberta;
- roda html-validate nos outputs daquele manifesto;
- verifica cobertura do Bootstrap purgado;
- confere `data-publication` e tokens restantes;
- verifica referências locais;
- restaura a publicação padrão no `finally`;
- compara `site/` com o output versionado, salvo quando solicitado `--skip-drift`.

Confiança: **Confirmado**

---

## 15. Outputs e natureza estática

### `site/`

- contém uma publicação por vez;
- preserva o fluxo de deploy existente;
- mantém dados operacionais já presentes;
- substitui HTMLs conforme o manifesto ativo.

### `dist/<id>/`

- criado por `build:all` para cada publicação descoberta;
- copia o frontend estático completo;
- omite manifest, values e grids derivados de `publication.dataset.paths`;
- fica ignorado pelo Git.

Confiança: **Confirmado**

Observação operacional:
O bundle escolhe o frontend, não os dados. Cada deploy ainda precisa receber a rodada WRF e os gráficos de
monitoramento corretos para a publicação.

---

## 16. Configuração gerada para o WebGIS

Responsabilidade:
Fazer o runtime operar sobre contrato genérico, sem fallback institucional.

Fluxo:

```text
publication.territory + publication.dataset
  → renderer.runtimeConfig()
  → <meta name="site-config">
  → map-init.js / map-manager.js / charts-manager.js
```

Configuração serializada:

- ID e nome da publicação;
- estado, sigla e nome do território;
- path do manifest, bases de values/grids e timeline;
- centro/zoom, bounds, contorno e atribuição;
- domínio padrão e mapa de domínios.

Confiança: **Confirmado**

Observações:

- Ausência/configuração inválida falha claramente no cliente; não cai silenciosamente em BA.
- `map-manager.js` usa paths do dataset para valores e grades.
- `charts-manager.js` usa o helper de grade da aplicação.
- `map-init.js` usa o path de manifest configurado.

---

## 17. Arquitetura compartilhada do WebGIS

Arquivos:

- `src/template/layouts/webgis.html`
- `site/assets/js/map-init.js`
- `site/assets/js/map-manager.js`
- `site/assets/js/charts-manager.js`
- `site/assets/js/data-service.js`
- `site/assets/js/variables-config.js`
- `site/assets/css/maps.css`

Responsabilidades:

- `map-init.js` — bootstrap, manifest e integração mapa/gráficos;
- `MeteoMapManager` — estado, mapa, grade, valores, timeline e sidebar;
- `ChartsManager` — obtenção, transformação, configuração e renderização de séries;
- `LabmimDataService` — cache LRU, deduplicação, cache negativo e parse em worker;
- `VARIABLES_CONFIG`/`VARIABLE_CONTEXTS` — variáveis, paletas, unidades e contextos.

Confiança: **Confirmado**

Observação:
As páginas `forecast` e `energy` compartilham o shell. O contexto vem de `bodyAttrs`, o conteúdo de
documentação da fonte da página e o CSS de `page.styles`.

---

## 18. Contratos de dados do WebGIS

Todos os caminhos abaixo são relativos às bases declaradas pelo dataset.

| Artefato                      | Formato                   | Uso                                          |
| ----------------------------- | ------------------------- | -------------------------------------------- |
| `manifest.json`               | `labmim-data-manifest-v2` | versão, timeline, disponibilidade e features |
| `{D}_{VAR}_{NNN}.json`        | valores por passo         | cores da grade                               |
| `{D}_WIND_VECTORS_{NNN}.json` | vetores                   | camada de vento                              |
| `{D}.grid.json`               | `grid-edges-v1`           | grade compacta preferida                     |
| `{D}.geojson`                 | FeatureCollection         | fallback de grade                            |
| `{D}_{VAR}.series.bin`        | `cell-series-int32-le-v1` | série de célula via Range                    |
| `{D}_{VAR}.summary.json`      | `domain-summary-v1`       | resumo do domínio                            |

Confiança: **Confirmado**

Observação:
Formatos possuem fallbacks no cliente porque frontend e dados são publicados separadamente. Evolução de
contrato deve ser aditiva.

---

## 19. Os dois tipos de gráfico

### Monitoramento

- fonte HTML comum: `src/template/pages/monitoring.html`;
- nove imagens de nome fixo em `site/assets/graphs/`;
- cards/modais Bootstrap;
- geradas externamente por `labmim-site-graphs`;
- não usa Chart.js.

### WebGIS

- controlado por `site/assets/js/charts-manager.js`;
- Chart.js 3.9.1 vendorizado;
- série preferida em `series.bin`, fallback hora a hora;
- prévia preferida em `summary.json`;
- transformação, configuração e renderização separadas.

Confiança: **Confirmado**

---

## 20. Como criar uma publicação

Sequência confirmada:

1. Criar `src/sites/<id>/identity.js`, `pages.js`, `theme.css`, `site.js` e conteúdo/estilos próprios.
2. Reutilizar ou criar território; para estado novo, adicionar `site/assets/data/br_<uf>.json`.
3. Reutilizar ou criar dataset.
4. Implementar o contrato completo de 19 tokens no tema.
5. Compor identidade, páginas, território e dataset em `site.js`.
6. Rodar `npm run sites:list`.
7. Rodar `npm run build -- --site=<id>`.
8. Rodar `npm run build:check`, `npm run lint:themes` e `npm run build:all`.

Fonte operacional:
`src/sites/README.md`

Confiança: **Confirmado**

---

## 21. Como adicionar ou atualizar uma página

### Página compartilhada

1. Criar conteúdo em `src/template/pages/<nome>.html`.
2. Declarar com `templateSource()` nos `pages.js` que devem oferecê-la.
3. Usar `customPage()` para rota isolada ou criar tipo no catálogo se o padrão for recorrente.

### Página exclusiva

1. Criar conteúdo em `src/sites/<id>/pages/<nome>.html`.
2. Declarar com `siteSource()` apenas naquela publicação.

### Variação pequena

Usar `append: [siteSource("fragments/x.html")]` sobre uma fonte comum.

### Estilo próprio

- compartilhado: criar `src/template/styles/<nome>.css` e usar `templateSource()`;
- exclusivo: criar `src/sites/<id>/styles/<nome>.css` e usar `siteSource()`;
- asset comum já existente: declarar o caminho `assets/css/<nome>.css`.

CSS de biblioteca vendorizada é uma exceção explícita e deve usar `page.vendorStyles`.

### Atualização

- HTML comum: fonte em `src/template/pages/`;
- HTML exclusivo: fonte em `src/sites/<id>/pages/`;
- SEO/nav: `src/sites/<id>/pages.js`;
- marca/redirect: `identity.js`;
- paleta: tema daquela publicação;
- estrutura: layouts/partials/CSS comuns, com validação de todos os sites.

Confiança: **Confirmado**

---

## 22. Tooling e rede de segurança

Arquivos:

- `package.json`
- `.github/workflows/ci.yml`
- `scripts/check-publications.mjs`
- `scripts/check-site-themes.mjs`
- `scripts/check-bootstrap-purge.mjs`
- `scripts/check-fa-subset.mjs`

Checks:

- descoberta/validação/renderização de todas as publicações;
- drift da saída canônica;
- ESLint, Stylelint e Prettier;
- contrato de temas;
- html-validate e links locais;
- wrapper do Linkinator deriva do dataset os paths operacionais ignorados;
- cobertura de Bootstrap purgado e Font Awesome subset;
- `npm audit` no CI.

Confiança: **Confirmado**

Observação:
Não há suíte de navegador automatizada. Light/dark, mobile e interações do WebGIS ainda exigem inspeção
manual.

---

## 23. Deploy

Responsabilidade:
Publicar a saída estática da publicação correta junto de seus dados operacionais.

Evidências em `README.md`:

- build individual em `site/` ou seleção de `dist/<id>/`;
- deploy manual;
- frontend e dados publicados separadamente;
- `.htaccess` deve acompanhar o site completo;
- mudanças de formato devem publicar primeiro o cliente compatível e depois o pipeline;
- manifest e artefatos anunciados precisam permanecer coerentes.

Confiança: **Operacional / documentado**

Observação:
Credenciais, destino e automação de cada nova publicação não fazem parte do contrato do gerador.

---

## 24. Riscos de regressão

| Risco                                          | Sintoma                                | Mitigação                         |
| ---------------------------------------------- | -------------------------------------- | --------------------------------- |
| editar HTML/static gerado                      | mudança sobrescrita ou drift           | editar fontes e rebuildar         |
| identidade em template/CSS comum               | marca vaza entre sites                 | tokens e módulo da publicação     |
| tema com seletores                             | fork estrutural difícil de manter      | tema token-only + `lint:themes`   |
| CSS de feature ou vendor no layout             | carregamento/acoplamento implícito     | `page.styles` / `vendorStyles`    |
| copiar página comum                            | versões editoriais divergem            | `templateSource()`                |
| transformar diferença editorial em `if` por ID | builder/runtime cresce por exceções    | declarar em `pages.js`/identity   |
| hardcodar estado ou path no JS                 | publicação usa geografia/dados errados | território/dataset/runtime config |
| alterar template/CSS comum e testar um site    | regressão em outra publicação          | `build:check` + inspeção de todas |
| esquecer dados do bundle                       | WebGIS sem rodada                      | associar pipeline no deploy       |

Confiança: **Confirmado**

---

## 25. Convenções finais

1. Editar `src/` ou assets-fonte, nunca `site/*.html` e metadados gerados.
2. Começar toda página decidindo se o conteúdo é comum ou exclusivo.
3. Manter uma fonte de verdade por site em `pages.js`.
4. Não editar sitemap, robots, navbar ou footer gerados para cadastrar rota.
5. Colocar identidade somente em `identity.js` e nos 19 tokens do tema.
6. Declarar CSS específico em `page.styles`.
7. Colocar estado/contorno/viewport em território e contrato WRF em dataset.
8. Evitar condicionais por ID em template, renderer, CSS e runtime.
9. Rodar build individual durante desenvolvimento e `build:check` antes do PR.
10. Validar visualmente light/dark, mobile e WebGIS das publicações afetadas.

Confiança: **Confirmado**
