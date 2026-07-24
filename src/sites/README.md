# Guia de publicações

Cada pasta `src/sites/<id>/` é um módulo editorial independente. O build encontra automaticamente toda pasta que contenha `site.js`; não existe uma lista de IDs para atualizar.

O resultado continua sendo um site estático. Node valida e monta os arquivos antes do deploy, mas o servidor entrega apenas HTML, CSS, JavaScript e assets.

> **Primeira contribuição?** Este arquivo é a receita de edição; o processo em volta dela está em dois PDFs:
> [Como contribuir no site-labmim](../../docs/onboarding-architecture/assets/guia-contribuicao-site.pdf)
> (issue → branch → alteração → testes → pull request → revisão → merge na `main`) e
> [Arquitetura multi-publicação](../../docs/onboarding-architecture/assets/labmim-onboarding.pdf)
> (o deck que explica a composição `publicação + template + território + dataset`).

## Fronteiras

| Se algo descreve...                     | Coloque em...                           |
| --------------------------------------- | --------------------------------------- |
| Marca, instituição, origem ou redirect  | `src/sites/<id>/identity.js`            |
| Quais páginas existem, SEO ou navegação | `src/sites/<id>/pages.js`               |
| Texto/HTML exclusivo                    | `src/sites/<id>/pages/` ou `fragments/` |
| Logos e imagens da publicação           | `src/sites/<id>/assets/`                |
| Paleta da publicação                    | `src/sites/<id>/theme.css`              |
| Estrutura ou conteúdo comum             | `src/template/`                         |
| Estado, contorno ou viewport            | `src/territories/`                      |
| Caminhos, timeline ou domínios WRF      | `src/datasets/`                         |

Evite condicionais por ID no template, renderer ou JavaScript do navegador. Uma diferença editorial pertence à publicação; uma capacidade reutilizável deve entrar no contrato comum.

## Criar Uma Publicação

Use `ufba/` ou `ufes/` como referência e crie:

```text
src/sites/exemplo/
├── site.js
├── identity.js
├── pages.js
├── theme.css
├── assets/             # opcional: img/, publicado sob site/assets/
├── pages/
├── styles/             # opcional: CSS de página exclusivo
└── fragments/          # opcional
```

O ID deve usar minúsculas, números ou hífen e ser igual ao nome da pasta. A origem deve ser única e não terminar com `/`. Exatamente uma publicação do repositório deve ter `isDefault: true`.

### 1. Identidade

`identity.js` concentra marca, instituição, origem, logos e redirects.

Coloque as imagens da publicação em `src/sites/<id>/assets/` — a fonte da verdade fica no módulo. O build publica essa árvore sob `site/assets/` com o mesmo layout, então `src/sites/exemplo/assets/img/logo.png` vira `assets/img/logo.png`, que é exatamente o caminho a escrever no `identity.js`. Não pode publicar sob `assets/css`, `assets/js`, `assets/vendor`, `assets/data` ou `assets/graphs` (namespaces do build e do pipeline). Todo caminho publicado precisa de uma única fonte: se duas publicações fornecerem `assets/img/logo.png`, o build falha pedindo que uma seja renomeada. Os `logos`/`ogImage`/afiliações do `identity.js` são validados contra o próprio módulo, então declarar o arquivo de outra publicação como marca própria falha.

`site/assets/img/` é uma saída versionada do build — como `site/*.html`. Você **edita** os originais no módulo e roda o build, que republica a união de todas as publicações lá (idêntica em todo `--site`, então sem churn ao trocar). Não edite `site/assets/img/` à mão; `git add` junto com o resto de `site/` após buildar.

`npm run build:all` monta cada bundle levando só o que aquela publicação referencia (por HTML **e** por `url()` do CSS), mais os logos declarados e o contorno do seu território; um passe de integridade falha o build se um bundle referenciar algo que não embarca. Uma publicação que exibe a marca de outra como parceira funciona — o arquivo entra por ser referenciado na página — mas passa a depender do módulo vizinho continuar no repositório; trazer a própria cópia (com outro nome) deixa a publicação autossuficiente.

```js
"use strict";

module.exports = {
  schemaVersion: 1,
  id: "exemplo",
  isDefault: false,
  origin: "https://exemplo.edu.br",
  brand: {
    name: "LAB",
    fullName: "Laboratório Exemplo",
    copyrightName: "LAB",
    ogImage: "assets/img/logo-exemplo.png",
    logos: {
      nav: { src: "assets/img/logo-exemplo.png", width: 180, height: 80 },
      footer: { src: "assets/img/logo-exemplo.png", width: 180, height: 80 },
      sidebar: { src: "assets/img/logo-exemplo.png", width: 520, height: 230 },
    },
    affiliations: [],
  },
  institution: { name: "Universidade Exemplo", acronym: "UE" },
  location: { cityName: "Cidade" },
  theme: "theme.css",
  redirects: [{ from: "/previsao.html", to: "/mapas_interativos.html", status: 301 }],
};
```

Uma afiliação aceita `kind: "image"` com `src`, dimensões e `webp` opcional, ou `kind: "text"` com `institution`. Ambas exigem `name` e `href`.

O destino de cada redirect deve ser uma página declarada na própria publicação. Para redirecionar a uma âncora, use `hash: "secao"` sem `#`.

### 2. Território

Reutilize um módulo existente quando o estado for o mesmo. Para um estado novo, adicione o contorno em `site/assets/data/br_<uf>.json` e crie `src/territories/<uf>.js`.

O contorno fica em `site/assets/data/` — e não dentro da publicação — porque um território é reutilizável: duas publicações no mesmo estado compartilham o mesmo arquivo. Ainda assim, cada bundle leva apenas o contorno do seu próprio território.

```js
"use strict";

module.exports = {
  id: "pe",
  kind: "state",
  code: "PE",
  name: "Pernambuco",
  regionPhrase: "região de Pernambuco e entorno",
  terrainExample: "o Planalto da Borborema",
  boundaryAsset: "assets/data/br_pe.json",
  viewport: {
    center: [-8.3, -37.8],
    zoom: 6,
    fitBoundary: true,
    fitMaxZoom: 7,
  },
};
```

O contorno deve ser um `FeatureCollection` com `Polygon` ou `MultiPolygon` válido e a sigla do estado nas propriedades. O build valida a geometria e calcula seus limites.

### 3. Dataset

Crie ou reutilize `src/datasets/<produto>.js`. Esse módulo não descreve a instituição: ele descreve o contrato dos dados consumidos.

```js
"use strict";

module.exports = {
  id: "exemplo-wrf",
  attribution: "LAB-UE",
  paths: {
    manifest: "JSON/manifest.json",
    values: "JSON",
    grids: "GeoJSON",
  },
  timeline: {
    defaultMaxLayer: 73,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC−03)",
  },
  defaultDomain: "D01",
  domains: [
    {
      id: "D01",
      label: "PE/NE",
      longLabel: "Pernambuco/Nordeste",
      center: [-8.3, -37.8],
      zoom: 5.5,
      resolution: "27 km",
      description: "Escala sinótica e regional.",
      cumulusParameterized: true,
    },
  ],
};
```

`defaultDomain` deve existir em `domains`. Os IDs são parte dos nomes dos arquivos operacionais e não devem ser usados apenas como labels de interface.

Campos opcionais do dataset: `generator` (nome da CLI que produz os dados), `model` (o namelist WRF descrito na documentação do WebGIS) e `observations`, que alimenta a página de monitoramento:

```js
observations: {
  charts: [{ id: "temperatura", title: "Temperatura", src: "assets/graphs/temperatura.png" }],
},
```

Sem `observations`, a página `monitoring` renderiza sem cards de estação — declare o bloco ou não ofereça essa página. Os PNGs são reescritos no lugar pela estação de cada laboratório e ficam fora dos bundles: associe-os no deploy, como os diretórios de `dataset.paths`.

### 4. Páginas

O catálogo em `src/template/page-types.js` contém os tipos `home`, `monitoring`, `team`, `climatology`, `forecast` e `energy`. `page()` preenche arquivo, layout e fonte comum quando disponíveis. `home` e `team` exigem conteúdo próprio da publicação.

```js
"use strict";

const { page, siteSource } = require("../../template/page-types");

module.exports = [
  page("home", {
    source: siteSource("pages/index.html"),
    seo: {
      h1: "LAB — Laboratório Exemplo",
      title: "LAB — Laboratório Exemplo · UE",
      description: "Pesquisa e previsão meteorológica da Universidade Exemplo.",
    },
  }),
  page("forecast", {
    seo: {
      title: "LAB — Mapas Interativos WRF · UE",
      description: "Previsões meteorológicas interativas para Pernambuco.",
    },
  }),
];
```

O array é a fonte da verdade para HTMLs, navbar, rodapé e sitemap dessa publicação. Para ocultar uma página do menu sem removê-la, passe `nav: false`. Para personalizar uma entrada, informe `nav: { label, icon, order, elementId }`; ordem e IDs precisam ser únicos.

Um fragmento exclusivo pode ser anexado a uma página comum:

```js
page("monitoring", {
  append: [siteSource("fragments/funding.html")],
  seo: {
    title: "LAB — Monitoramento Ambiental · UE",
    description: "Monitoramento ambiental em tempo quase real.",
  },
});
```

### 5. Tema E Composição

Copie um `theme.css` existente e substitua todos os tokens de identidade, inclusive os accents do modo escuro. Esse arquivo aceita somente um bloco `:root` com custom properties do contrato em `scripts/site-builder/theme-contract.js`; estilos estruturais pertencem ao CSS compartilhado. O build publica apenas o tema selecionado como `site/assets/css/site-theme.css`; não coloque seletores condicionais por publicação no CSS comum.

O contrato tem duas metades. Os tokens **obrigatórios** toda publicação declara. Os **opcionais** cada publicação declara se quiser: quem não declara herda o fallback embutido no CSS compartilhado, então adotar uma cor própria não obriga as outras publicações a mudar nada. É por aí que se ajusta a rampa de superfície do WebGIS e as cores dos gráficos, sem tocar em `maps.css`.

Duas armadilhas conhecidas: os tokens de gráfico são lidos em runtime por `assets/js/charts-manager.js`, não por CSS; e o modo escuro tem especificidade maior que `:root`, então para re-skinar um gráfico nos dois modos é preciso declarar o par claro **e** escuro (por exemplo `--chart-legend-color` e `--chart-legend-dark-color`).

`--primary-color` e `--secondary-color` são aliases estruturais de `--brand-primary` e `--brand-secondary`, portanto não devem ser repetidos no tema. As cores com companheiro `*-rgb` usam hexadecimal simples e o guard confirma que os canais correspondem. `npm run lint:themes` valida todos os temas, procura acoplamento por publicação no CSS comum e protege a ordem da cascata.

`site.js` apenas compõe os módulos:

```js
"use strict";

const identity = require("./identity");
const pages = require("./pages");
const dataset = require("../../datasets/exemplo-wrf");
const territory = require("../../territories/pe");

module.exports = { ...identity, territory, dataset, pages };
```

### 6. Validar

```bash
npm run sites:list
npm run build -- --site=exemplo
npm run format                   # o format:check do CI cobre src/**/*.{css,js,html}
npm run lint:themes
git add src/sites/exemplo site   # o build:check recusa saída gerada não versionada (inclui site/assets/img)
make ci                          # o que o GitHub Actions roda
```

`sites:list` confirma a descoberta. O build individual grava em `site/`; `build:check` percorre todas as publicações, valida o HTML e os dois subsets vendor de cada uma, e restaura a padrão em `site/` ao final. `make ci` é o conjunto completo — `build:check`, `format:check`, os cinco linters, `lint:html` e `lint:links` em todas as publicações, e `npm audit`.

O `git add` não é detalhe: `build:check` recusa saída gerada não versionada e compara `site/` com um build limpo da publicação padrão. Commite `site/` junto com a publicação nova.

### Bootstrap e Font Awesome são subsets compartilhados

O CSS do Bootstrap é purgado e a fonte do Font Awesome é um subset — os dois cobrem exatamente o que as publicações existentes usam. Uma página nova com uma classe Bootstrap ou um ícone inédito exige regenerar:

```bash
npm run purge:bootstrap                  # classe Bootstrap nova
# ícone novo: siga scripts/subset-fontawesome.md (precisa de Python + fonttools + brotli)
```

Regenerar reescreve um arquivo compartilhado, e o `?v=` é hash de conteúdo — então o HTML commitado de **todas** as publicações muda junto. É esperado; commite tudo no mesmo passo. Se preferir evitar, reutilize as classes e os ícones já presentes: `npm run build:check` acusa cada ausência com o nome exato.

## Criar Uma Página Compartilhada

Salve o conteúdo sem `<html>`, `<head>`, navbar ou footer em `src/template/pages/<nome>.html`. Depois declare a página nas publicações que devem oferecê-la:

```js
const { customPage, templateSource, siteSource } = require("../../template/page-types");

customPage({
  id: "about-project",
  file: "projeto.html",
  layout: "institutional",
  source: templateSource("pages/projeto.html"),
  styles: [siteSource("styles/projeto.css")],
  seo: {
    h1: "Sobre o projeto",
    title: "Sobre o projeto · LAB",
    description: "Objetivos, metodologia e resultados do projeto.",
  },
  nav: {
    label: "Projeto",
    icon: "fa-circle-info",
    order: 60,
    elementId: "nav-projeto",
  },
});
```

Use `siteSource("pages/projeto.html")` no lugar de `templateSource()` quando a página for exclusiva ou tiver redação diferente. Se o mesmo formato estrutural passar a ser usado por muitas publicações, adicione um tipo ao catálogo `PAGE_TYPES`; para uma rota isolada, prefira `customPage()`.

`styles` é opcional. Use `siteSource("styles/arquivo.css")` para CSS pertencente apenas à publicação, `templateSource("styles/arquivo.css")` para uma fonte compartilhada, ou um caminho existente sob `site/assets/css/` para um módulo estático comum. Fontes de `src/` são copiadas para `assets/css/generated/` somente quando a página selecionada as usa; assim, CSS da UFES não vaza para o bundle UFBA. Componentes reutilizáveis continuam em `components.css`. O renderer insere esses arquivos antes de `theme.css`, preservando os overrides de light/dark mode. O layout `webgis` já declara o Leaflet e o `maps.css` por conta própria, então uma `customPage()` com esse layout não nasce sem o CSS de mapa.

## Saídas

- `site/`: saída compatível e implantável de uma publicação por vez. Os HTMLs são substituídos conforme `pages.js`; dados operacionais já presentes não são apagados.
- `dist/<id>/`: bundles criados por `npm run build:all`. Contêm o frontend estático de cada publicação, mas omitem o manifest e os diretórios operacionais configurados em `dataset.paths` para não duplicar rodadas WRF grandes.

Antes do deploy, associe ao bundle os dados e gráficos operacionais produzidos para a publicação. O build escolhe o frontend; ele não transforma nem transfere dados meteorológicos.
