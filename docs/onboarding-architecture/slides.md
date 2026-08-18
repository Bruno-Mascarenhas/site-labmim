---
theme: seriph
title: Publicações meteorológicas  -  Onboarding técnico
info: |
  Arquitetura modular e fluxo de manutenção do site-labmim.
  Todo o conteúdo é derivado do código real do repositório.
highlighter: shiki
lineNumbers: false
drawings:
  persist: false
transition: slide-left
layout: two-cols
layoutClass: gap-8 deck-cover
---

# Sites LabMiM / LEAL

## Onboarding da plataforma estática e do pipeline de dados

**Objetivo**

Uma aplicação compartilhada para publicações meteorológicas, conectada por contratos versionados a um produtor Python independente.

**Hoje**

- LabMiM / UFBA  -  Bahia
- LEAL / UFES  -  Espírito Santo
- Consumidor: `site-labmim`
- Produtor: `micrometeorology/src/micrometeorology`

::right::

<div class="pt-16"></div>

| Camada   | Escolha                      |
| -------- | ---------------------------- |
| Build    | Node 24 + gerador próprio    |
| Produtor | Python 3.14 + CLIs Typer     |
| Saída    | HTML, CSS e JS puros         |
| Mapa     | Leaflet 1.9.4                |
| Gráficos | Chart.js 3.9.1               |
| Dados    | JSON, GeoJSON, binários e imagens |

<div class="border-l-4 border-emerald-600 pl-3 py-2 mt-4 text-sm">

**Node e Python ficam fora do servidor web.** A publicação entregue continua inteiramente estática.

</div>

<!--
Abra alinhando a expectativa: este não é um SPA, não há backend e não há Node em produção. O projeto é
um gerador estático multi-publicação. A mesma aplicação é combinada com identidade, conteúdo, geografia e
dataset diferentes antes do deploy; o pacote Python produz os artefatos operacionais que o navegador lê.

O salto arquitetural em relação ao site original é justamente separar o que antes era um site UFBA único.
Hoje UFBA e UFES já exercitam o contrato, e uma terceira publicação entra sem cadastrar ID em `build.js`.

As bibliotecas de runtime continuam vendorizadas em `site/assets/vendor/`. O pipeline meteorológico é
externo; o build escolhe e monta o frontend, mas não converte dados WRF.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Mapa do repositório

<div class="flex justify-center pt-2">
  <img src="/diagrams/repository-overview.svg" class="w-full max-w-5xl object-contain" style="height: 330px" alt="Módulos de publicação, template, território e dataset convergindo para as saídas estáticas" />
</div>

<div class="grid grid-cols-2 gap-4 text-sm pt-3">
<div>

**Fontes editáveis**

`src/template/` · `src/sites/` · `src/territories/` · `src/datasets/`

</div>
<div>

**Saídas geradas**

`site/`  -  uma publicação · `dist/<id>/`  -  todas

</div>
</div>

<!--
A regra principal continua sendo: edite fontes, nunca HTML gerado. A diferença é que `src/` agora possui
fronteiras explícitas.

Leia o desenho da esquerda para a direita. Uma publicação seleciona identidade, páginas e tema; o
`site.js` compõe também um território e um dataset; o builder valida tudo e combina com o template comum.

`site/` preserva o fluxo de deploy histórico: contém uma publicação por vez. `build:all` materializa um
bundle por ID em `dist/`, sem duplicar os grandes diretórios operacionais JSON/GeoJSON.

Os dados e os gráficos de monitoramento continuam vindo do repositório `micrometeorology`. Eles são
acoplados ao bundle no deploy, não produzidos pelo gerador de páginas.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# O modelo mental: quatro módulos

| Módulo         | Pergunta que responde                                | Local              |
| -------------- | ---------------------------------------------------- | ------------------ |
| **Publicação** | Quem publica? Qual conteúdo, SEO, navegação e marca? | `src/sites/<id>/`  |
| **Template**   | O que funciona igual em todos os sites?              | `src/template/`    |
| **Território** | Qual estado, contorno e enquadramento do mapa?       | `src/territories/` |
| **Dataset**    | Onde estão os dados, quais domínios e timeline?      | `src/datasets/`    |

<div class="grid grid-cols-2 gap-5 text-sm pt-4">
<div class="border-l-4 border-emerald-600 pl-3">

Um território e um dataset podem ser reutilizados por mais de uma publicação.

</div>
<div class="border-l-4 border-red-500 pl-3">

Evite `if (site === "ufba")` no template, no renderer, no CSS e no runtime.

</div>
</div>

<!--
Este é o slide mais importante para decidir onde uma mudança deve morar.

Publicação é editorial e institucional. Template é capacidade reutilizável. Território descreve a
geografia, sem saber quem publica. Dataset descreve o contrato do produto WRF, sem saber qual universidade
o usa.

Essa separação permite combinações futuras: duas instituições podem usar o mesmo território; uma
instituição pode trocar de produto WRF sem copiar seu conteúdo; páginas comuns evoluem uma vez.

Condicionais por ID são o principal cheiro de arquitetura. Se a diferença for editorial, declare-a no
módulo da publicação. Se for capacidade comum, aumente o contrato compartilhado.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Como o build compõe uma publicação

<div class="flex justify-center pt-1">
  <img src="/diagrams/app-architecture.svg" class="w-full max-w-5xl" alt="Descoberta, validação, renderização e configuração do runtime" />
</div>

<div class="grid grid-cols-3 gap-3 text-sm pt-3">
<div>

**1 · Descobrir**

`src/sites/*/site.js`

</div>
<div>

**2 · Validar**

schema, fontes, assets, GeoJSON, páginas e redirects

</div>
<div>

**3 · Renderizar**

HTML, tema, SEO, sitemap, robots e `.htaccess`

</div>
</div>

<!--
O sistema de arquivos é o registro. `discoverPublications()` percorre `src/sites/<id>/site.js`, exige que
o ID seja igual ao nome da pasta, origens únicas e exatamente uma publicação padrão.

Antes de escrever a saída, `validatePublication()` coleta erros de contrato e de referências. Isso evita
o ciclo lento de descobrir um campo inválido por build.

`renderPublication()` deriva navegação e rodapé das páginas, gera SEO e JSON-LD, sitemap e robots, aplica
redirects ao template de `.htaccess`, serializa território/dataset na meta `site-config` e carimba hashes
de conteúdo nos assets.

A configuração na meta é o elo com o WebGIS: o JavaScript do navegador não escolhe UFBA ou UFES; ele lê a
configuração gerada.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Descoberta: `site.js` é a composição

```js
// src/sites/ufes/site.js
"use strict";

const identity = require("./identity");
const pages = require("./pages");
const dataset = require("../../datasets/leal-wrf");
const territory = require("../../territories/es");

module.exports = { ...identity, territory, dataset, pages };
```

<div class="grid grid-cols-2 gap-5 text-sm pt-4">
<div>

**Registro automático**

- uma pasta válida é o registro
- `sites:list` confirma descoberta
- `build:all` e `build:check` usam a mesma lista

</div>
<div>

**Invariantes**

- ID igual à pasta
- `origin` única, sem `/` final
- exatamente um `isDefault: true`
- `schemaVersion: 1`

</div>
</div>

<!--
O arquivo é pequeno de propósito: composição, não conteúdo. Identidade e páginas ficam em arquivos
próprios; território e dataset são módulos reutilizáveis.

Adicionar `src/sites/novo/site.js` válido já torna o site visível para `sites:list`, `build:all` e
`build:check`. Não se edita `build.js`, `package.json` nem uma enumeração central.

A publicação padrão só resolve a seleção do build. Território, dataset e runtime continuam explícitos; uma
configuração incompleta falha antes de publicar o mapa no estado errado.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# CSS desacoplado por responsabilidade

<div class="flex justify-center pt-1">
  <img src="/diagrams/css-layers.svg" class="w-full max-w-5xl" alt="Tema exclusivo selecionado alimentando módulos CSS estruturais compartilhados" />
</div>

<div class="grid grid-cols-3 gap-3 text-sm pt-2">
<div class="border rounded-lg p-2">

**Identidade**

`src/sites/<id>/theme.css`  -  19 tokens obrigatórios + opcionais, nenhum seletor.

</div>
<div class="border rounded-lg p-2">

**Estrutura comum**

`base` · `layout` · `components` · `theme`

</div>
<div class="border rounded-lg p-2">

**Por página**

`vendorStyles` + `styles`; WebGIS declara Leaflet e `maps.css`.

</div>
</div>

<!--
O CSS está desacoplado em dois eixos: identidade versus estrutura, e estrutura global versus estilo de
página.

Cada publicação implementa 19 custom properties obrigatórias; tokens opcionais de superfície, texto e
gráficos possuem fallback no CSS/JS compartilhado. O validador e `lint:themes` recusam tema incompleto,
seletor estrutural e pares hex/RGB divergentes. O build copia somente o tema da publicação ativa para
`site/assets/css/site-theme.css`.

Os módulos compartilhados consomem tokens como `--brand-primary`, `--accent-rgb` e `--map-accent`; não
carregam paleta institucional. Alterar `theme.css` de um site muda só aquele site. Alterar
`base/layout/components/theme` muda todos e exige validar todas as publicações.

CSS específico de uma página entra pelo manifesto `page.styles`. O tipo WebGIS declara `maps.css`; o
layout não decide isso implicitamente. Uma fonte `templateSource("styles/x.css")` ou
`siteSource("styles/x.css")` é copiada para seu namespace gerado. CSS de bibliotecas locais usa
`page.vendorStyles`  -  hoje Leaflet nos tipos WebGIS. A cascata protegida é vendor da página -> base ->
site-theme -> layout -> components -> styles da página -> theme.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Onde colocar uma mudança de estilo?

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

### Sempre carregado

- marca -> `src/sites/<id>/theme.css`
- reset/utilitário -> `base.css`
- navbar/footer -> `layout.css`
- cards/blocos -> `components.css`
- dark mode -> `theme.css`

</div>
<div>

### Declarado por página

- WebGIS -> `maps.css` em `styles`
- asset comum -> `"assets/css/…"`
- fonte compartilhada -> `templateSource("styles/…")`
- fonte exclusiva -> `siteSource("styles/…")`
- biblioteca local -> `vendorStyles`

</div>
</div>

<div class="border-l-4 border-amber-500 pl-3 py-2 mt-4 text-sm">

Não duplique estrutura num tema e não adicione seletor por ID no CSS comum.

</div>

<!--
Use a tabela como decisão operacional durante revisão.

Tema é somente implementação dos tokens de identidade. Ele não deve redefinir seletores de componente.
`page.styles` controla **onde um CSS estrutural carrega**; não transforma esse CSS em paleta institucional.
Fontes autorais podem pertencer ao template ou ao site, mas diferenças de marca continuam nos tokens obrigatórios e opcionais do tema.

`page.styles` também elimina carregamento global desnecessário. Estilos do tipo e extras da página são
**mesclados**, então personalizar forecast não remove `maps.css`. O namespace `assets/css/generated/` é
limpo a cada build e recebe apenas fontes usadas pela publicação ativa.

Depois de qualquer alteração comum, rode `build:check`: é a forma de provar que UFBA, UFES e futuras
publicações continuam válidas.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Comandos e saídas

```bash
npm run sites:list
npm run build                         # publicação padrão -> site/
npm run build -- --site=ufes          # publicação escolhida -> site/
npm run build:all                     # todas -> dist/<id>/
npm run build:check                   # valida todas; restaura a padrão
npm run lint:themes                   # contrato e isolamento dos temas
```

<div class="grid grid-cols-2 gap-5 text-sm pt-4">
<div class="border rounded-lg p-3">

### `site/`

- uma publicação por vez
- fluxo compatível com deploy atual
- preserva os paths operacionais do dataset
- remove HTMLs órfãos de outro site

</div>
<div class="border rounded-lg p-3">

### `dist/<id>/`

- um frontend por publicação
- pronto para associação aos dados corretos
- omite os paths operacionais configurados
- `dist/` é git-ignored

</div>
</div>

<!--
Sem `--site`, o builder usa a única publicação marcada como padrão. `SITE_ID=ufes npm run build` é a forma
equivalente por ambiente; `--variant` existe apenas por compatibilidade.

`build:all` percorre a descoberta automática, gera e copia cada frontend, e restaura a publicação padrão
em `site/` mesmo ao final. Os dados WRF não são duplicados em `dist`: manifest, values e grids excluídos
são derivados de `dataset.paths`, não de nomes hardcoded.

`build:check` constrói todas as publicações, valida HTML, cobertura do Bootstrap purgado e referências
locais, procura tokens não resolvidos e volta ao site padrão antes de conferir drift do output gerado.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Criar uma publicação nova: fluxo completo

<div class="flex justify-center pt-1">
  <img src="/diagrams/publication-flow.svg" class="w-full max-w-5xl" alt="Passos para criar e descobrir uma nova publicação" />
</div>

<div class="grid grid-cols-2 gap-5 text-sm pt-3">
<div>

**Criar**

```text
src/sites/exemplo/
├── site.js
├── identity.js
├── pages.js
├── theme.css
├── assets/          # imagens e logos próprios, opcional
├── pages/
├── styles/          # CSS estrutural exclusivo, opcional
└── fragments/       # opcional
```

</div>
<div>

**Não editar**

- `build.js`
- `package.json`
- outputs derivados do manifesto
- template para trocar nomes de instituição
- CSS comum para trocar paleta

</div>
</div>

<!--
Use `ufba/` ou `ufes/` como ponto de partida, mas preserve as fronteiras: copiar a pasta não significa
copiar território, dataset ou conteúdo comum.

O registro acontece pela existência de `site.js`. `sites:list` é a primeira prova de que descoberta e
invariantes globais estão corretas.

O sitemap e a navegação vêm do manifesto de páginas; editar os arquivos gerados à mão é ao mesmo tempo
desnecessário e frágil. Nomes de instituição devem chegar pelos tokens da identidade, nunca por duplicação
de layout.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Passo 1: identidade

```js
// src/sites/exemplo/identity.js
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
    logos: { nav: {/* src + dimensões */}, footer: {/* ... */}, sidebar: {/* ... */} },
    affiliations: [],
  },
  institution: { name: "Universidade Exemplo", acronym: "UE" },
  location: { cityName: "Cidade" },
  theme: "theme.css",
  redirects: [],
};
```

<div class="text-sm pt-3">

Assets nascem em `src/sites/<id>/assets/` e são publicados em `site/assets/`; redirects só podem chegar a páginas declaradas no próprio site.

</div>

<!--
`identity.js` concentra tudo que responde "quem publica": origem canônica, marca, logos, afiliações,
instituição, cidade, tema e compatibilidade de URLs antigas.

O validador abre cada asset referenciado, verifica ownership, colisões de caminho, dimensões positivas,
URLs HTTP(S), tipos de afiliação e destinos de redirect. Para uma afiliação, há duas representações: imagem
ou texto institucional.

Não escreva marca ou sigla diretamente em partials. O renderer já oferece tokens para navbar, footer,
sidebar, SEO e JSON-LD.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Passo 2: território e dataset

<div class="grid grid-cols-2 gap-5 text-sm">
<div>

### `src/territories/pe.js`

```js
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

</div>
<div>

### `src/datasets/exemplo-wrf.js`

```js
module.exports = {
  id: "exemplo-wrf",
  attribution: "LAB-UE",
  paths: {
    manifest: "JSON/manifest.json",
    values: "JSON",
    grids: "GeoJSON",
    monitoring: "Monitoramento", // opcional
    climatology: "Climatologia", // opcional
    sky: "Ceu",                  // opcional
  },
  timeline: {
    defaultMaxLayer: 75,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC-03)",
  },
  defaultDomain: "D01",
  domains: [/* id, label, centro, zoom, resolução */],
};
```

</div>
</div>

<!--
Território e dataset são decisões separadas. O primeiro controla estado, linguagem territorial, contorno,
centro e `fitBounds`. O segundo controla contrato de dados, timeline e domínios técnicos.

Para um estado novo, adicione o GeoJSON local em `site/assets/data/br_<uf>.json`. O build valida
FeatureCollection, Polygon/MultiPolygon, sigla nas propriedades e calcula limites; isso evita publicar um
contorno de outro estado por engano.

No dataset, `defaultDomain` precisa existir no array. Os IDs D01 etc. fazem parte dos nomes dos arquivos e
não são apenas labels. `monitoring`, `climatology` e `sky` só devem existir quando a publicação oferece as
páginas correspondentes; o build valida esses pares. Reutilize módulos existentes quando o produto ou
território for realmente o mesmo. `stepHours` torna a frequência explícita; horizonte e quantidade textual de passos são derivados, não
hardcoded no template.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Montar o site

```js
// src/sites/exemplo/pages.js
const { page, siteSource } = require("../../template/page-types");

module.exports = [
  page("home", {
    source: siteSource("pages/index.html"),
    seo: {
      h1: "LAB  -  Laboratório Exemplo",
      title: "LAB  -  Laboratório Exemplo · UE",
      description: "Pesquisa meteorológica da Universidade Exemplo.",
    },
  }),
  page("forecast", {
    seo: { title: "LAB  -  Previsões WRF · UE", description: "Previsões para Pernambuco." },
  }),
];
```

<div class="grid grid-cols-2 gap-5 text-sm pt-3">
<div>

Implemente os 19 tokens obrigatórios e só os opcionais necessários em `theme.css`.

</div>
<div>

Componha tudo no pequeno `site.js`.

</div>
</div>

<!--
O catálogo `page-types.js` traz os tipos home, monitoring, sky, team, climatology, forecast e energy. Ele
preenche arquivo, layout, fonte comum, navegação e estilos padrão quando cabível.

Home e equipe exigem fonte própria da publicação. Os demais tipos já apontam para conteúdo comum, mas SEO
continua obrigatório e editorial para cada site.

Copie um tema existente e substitua todos os tokens; não copie seletores estruturais. O validator mostra
de uma vez quais propriedades estão ausentes.

Por fim, `site.js` importa identidade, páginas, território e dataset. Rode `sites:list`, o build individual
e depois `build:check`.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Adicionar uma página: primeiro decida o alcance

<div class="flex justify-center pt-1">
  <img src="/diagrams/page-flow.svg" class="w-full max-w-5xl" alt="Decisão entre página compartilhada e exclusiva até o build e validação" />
</div>

<div class="grid grid-cols-2 gap-5 text-sm pt-3">
<div class="border-l-4 border-blue-500 pl-3">

**Compartilhada**

Uma fonte em `src/template/pages/`; cada publicação opta por incluí-la.

</div>
<div class="border-l-4 border-violet-500 pl-3">

**Exclusiva**

Fonte em `src/sites/<id>/pages/`; só aquele manifesto referencia.

</div>
</div>

<!--
Não comece criando arquivo: comece decidindo alcance.

`templateSource()` só resolve sob `src/template/`; `siteSource()` só resolve sob a pasta da publicação.
O validador confina os caminhos e impede traversal. Essa referência explícita é o que torna a fronteira
auditável.

Mesmo conteúdo compartilhado não significa rota global obrigatória. Cada `pages.js` é a fonte de verdade
do próprio site, então a publicação opta por incluir ou omitir a página. Isso permite catálogos editoriais
diferentes sem `if` no renderer.

O build deriva HTML, navbar, rodapé e sitemap. Não existe passo de manutenção manual desses artefatos.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Receita: página compartilhada

```js
// em src/sites/<id>/pages.js
const { customPage, templateSource } = require("../../template/page-types");

customPage({
  id: "about-project",
  file: "projeto.html",
  layout: "institutional",
  source: templateSource("pages/projeto.html"),
  seo: {
    h1: "Sobre o projeto",
    title: "Sobre o projeto · LAB",
    description: "Objetivos, metodologia e resultados.",
  },
  nav: {
    label: "Projeto",
    icon: "fa-circle-info",
    order: 60,
    elementId: "nav-projeto",
  },
  styles: [templateSource("styles/projeto.css")],
});
```

<div class="text-sm pt-2">

Crie `src/template/pages/projeto.html` sem `<html>`, `<head>`, navbar ou footer.

</div>

<!--
Use `customPage()` para uma rota isolada. Se o mesmo formato estrutural começar a aparecer em várias
publicações, transforme-o em tipo do catálogo `PAGE_TYPES` para centralizar defaults.

SEO continua por publicação porque título e descrição normalmente carregam marca e contexto territorial.
A navegação é opcional: `nav: false` mantém a página acessível e indexável sem menu.

Se houver CSS autoral compartilhado, salve-o em `src/template/styles/` e declare a referência em `styles`;
não coloque `<link>` na fonte HTML. O builder valida, copia para `assets/css/generated/template/` e injeta
a folha antes do tema comum de dark mode.

Para oferecer a página em UFBA e UFES, adicione a declaração a ambos os `pages.js`. A fonte HTML continua
única.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Receita: página exclusiva ou variação editorial

```js
const { customPage, siteSource } = require("../../template/page-types");

customPage({
  id: "projeto-local",
  file: "projeto-local.html",
  layout: "institutional",
  source: siteSource("pages/projeto-local.html"),
  styles: [siteSource("styles/projeto-local.css")],
  seo: {
    h1: "Projeto local",
    title: "Projeto local · LEAL/UFES",
    description: "Iniciativa exclusiva no Espírito Santo.",
  },
  nav: false,
});
```

<div class="grid grid-cols-2 gap-5 text-sm pt-4">
<div>

**Anexar um trecho próprio**

`append: [siteSource("fragments/funding.html")]`

</div>
<div>

**Personalizar um tipo comum**

sobrescreva `source`, `nav`, `styles` ou campos de SEO

</div>
</div>

<!--
Página exclusiva usa a mesma infraestrutura, mas sua fonte mora dentro da publicação. Isso deixa evidente
que a manutenção não deve afetar outros sites.

`append` resolve o caso intermediário: a página de monitoramento pode ser comum, mas UFBA acrescenta um
fragmento de financiamento. Não é necessário copiar a página inteira.

Os tipos de catálogo são defaults extensíveis. Pode-se trocar a fonte de uma página para uma redação
local, ocultá-la do menu, personalizar rótulo/ordem ou anexar um stylesheet sem alterar o template. Uma
fonte CSS do site sai em `assets/css/generated/<id>/`; o próximo build limpa estilos do site anterior.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Atualizar uma página existente: mapa de impacto

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

### Conteúdo e catálogo

- comum -> `src/template/pages/*.html`
- exclusivo -> `src/sites/<id>/pages/*.html`
- anexo -> `src/sites/<id>/fragments/*.html`
- SEO/H1 -> `src/sites/<id>/pages.js`
- menu/ordem -> `page.nav` em `pages.js`

</div>
<div>

### Estrutura e identidade

- head/navbar/footer -> `src/template/partials/`
- shell de página -> `src/template/layouts/`
- CSS compartilhado -> `site/assets/css/`
- CSS autoral -> `templateSource`/`siteSource`
- paleta -> `src/sites/<id>/theme.css`

</div>
</div>

<div class="border-l-4 border-amber-500 pl-3 py-2 mt-3 text-sm">

Antes de editar algo compartilhado, procure os consumidores com `rg` e valide todas as publicações.

</div>

<!--
Este slide é o guia para manutenção diária.

Uma fonte template pode ser compartilhada por algumas publicações, não necessariamente todas. Procure
`templateSource("pages/nome.html")` nos manifests para saber o impacto real.

Layouts e partials têm alcance ainda maior. A navbar, o footer, o head e os scripts são expandidos em todas
as páginas; uma mudança neles pede build e inspeção das duas publicações atuais.

Não edite `site/*.html`, `site/sitemap.xml`, `site/robots.txt` ou `site/.htaccess`: são derivados. Ao final,
gere a publicação padrão para que o output canônico do repositório fique coerente.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# `pages.js`: uma fonte de verdade por site

Cada entrada governa:

`arquivo` · `layout` · `fonte` · `fragmentos` · `styles/vendorStyles` · `SEO` · `navegação` · `indexação`

<div class="grid grid-cols-2 gap-5 text-sm pt-4">
<div>

**Derivado automaticamente**

- HTML completo
- item ativo da navbar
- links do rodapé
- canonical, Open Graph e Twitter
- sitemap e robots
- JSON-LD da home

</div>
<div>

**Regras validadas**

- IDs e outputs únicos
- uma home em `index.html`
- SEO completo
- ordem/ID/label de nav únicos
- fonte e layout existentes
- stylesheet seguro e existente

</div>
</div>

<!--
O array da publicação é o contrato editorial completo para rotas, navegação e indexação.

O renderer ordena somente páginas com `nav` e usa a mesma coleção para navbar e rodapé. `nav: false`
remove menu e footer, mas não remove a página nem sua URL do sitemap. Para excluir indexação, use
`indexable: false`.

SEO deve ser explícito em toda página. Isso evita herdar título ou descrição de outra instituição. A home
também recebe JSON-LD `ResearchOrganization` derivado da identidade.

Quando uma página some do manifesto, o build remove o HTML órfão de `site/`, evitando vazamento de rotas
entre publicações com catálogos diferentes.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Território e dataset chegam ao runtime

```text
territory + dataset
  -> renderer.runtimeConfig()
  -> <meta name="site-config" content="…">
  -> map-init.js / MeteoMapManager
```

<div class="grid grid-cols-2 gap-5 text-sm pt-4">
<div>

**Território controla**

- estado e sigla
- contorno local
- centro/zoom inicial
- `fitBounds` e zoom máximo
- textos geográficos do template

</div>
<div>

**Dataset controla**

- manifest, values e grids
- timeline fallback
- domínio padrão
- labels, centros e zooms
- documentação e atribuição

</div>
</div>

<!--
O runtime não contém uma escolha `ufba`/`ufes`. Ele lê a configuração serializada pelo build e trabalha
com território e dataset genéricos.

No ES, por exemplo, `fitBoundary: true` faz o renderer usar os limites calculados do GeoJSON. Na BA, a
configuração atual usa centro e zoom explícitos. Trocar esse comportamento é edição de território, não de
`map-manager.js`.

Os caminhos também deixaram de ser uma suposição institucional: manifest, valores e grades vêm do dataset.
O cliente falha claramente se a meta de configuração estiver ausente ou inválida, em vez de cair
silenciosamente para Bahia.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# WebGIS compartilhado

<div class="flex justify-center pt-1">
  <img src="/diagrams/component-dependencies.svg" class="w-full max-w-5xl" alt="Configuração do site alimentando os módulos compartilhados do WebGIS" />
</div>

<div class="text-sm pt-3">

`forecast` e `energy` reutilizam o layout WebGIS; contexto, conteúdo, estilos e SEO vêm da declaração da página.

</div>

<!--
O shell do mapa vive em `src/template/layouts/webgis.html`; as abas de documentação comuns ficam em
`src/template/pages/` e `src/template/partials/`. O tipo de página declara `maps.css` em `page.styles`, por
isso o layout se mantém estrutural.

`map-init.js` cria `MeteoMapManager` e `ChartsManager`. Ambos trabalham com a mesma configuração de site e
com a instância compartilhada de `LabmimDataService`, que oferece cache, deduplicação e parsing em worker.

`VARIABLE_CONTEXTS` ainda separa variáveis de previsão e energia. Alterar uma variável é uma extensão do
produto WebGIS, diferente de cadastrar território ou publicação.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Quatro famílias de dados chegam ao frontend

<div class="grid grid-cols-2 gap-4 text-sm">
<div class="border rounded-lg p-3">

### WebGIS WRF

- manifest v2 + JSON/GeoJSON
- `series.bin` via HTTP Range
- `summary.json` para prévia
- overlays `WIND_VECTORS` e `ISOBARS`

</div>
<div class="border rounded-lg p-3">

### Monitoramento

- variante interativa `labmim-monitoring-v1`
- bruto + média horária + WRF
- variante estática: 9 PNGs fixos

</div>
<div class="border rounded-lg p-3">

### Climatologia

- `labmim-climatology-v1`
- histogramas, ajustes e rosa dos ventos
- bibliografia e cobertura do registro

</div>
<div class="border rounded-lg p-3">

### Condição do céu

- imagem all-sky + máscara
- Kt x Kd + modelos empíricos
- acumulada do índice de claridade

</div>
</div>

<div class="border-l-4 border-emerald-600 pl-3 py-2 mt-4 text-sm">

Todos chegam no deploy pelos caminhos de `dataset.paths`; `dist/<id>` não leva dados operacionais.

</div>

<!--
O frontend hoje possui quatro consumidores independentes. O WebGIS usa a rodada WRF e seus fallbacks. O
monitoramento da UFBA escolhe a fonte `monitoring-live.html`, busca um payload de sete dias e sobrepõe
amostras de 5 minutos, médias horárias e a série operacional WRF; a fonte estática continua disponível para
publicações que declarem `dataset.observations.charts`.

A climatologia consome distribuições pré-calculadas do acervo da estação. A condição do céu possui cadências
separadas para o quadro da câmera, o plano Kt x Kd e a acumulada de Kt. Nenhum desses artefatos é gerado pelo
build Node nem versionado no site.

No WebGIS, o manifest anuncia versão, disponibilidade, `cell_series`, `domain_summary` e o overlay de
isóbaras. Sem binário, o cliente coleta passos JSON; sem grade compacta, usa o GeoJSON legado. Essa evolução
aditiva permite publicar frontend e dados separadamente.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# O que `build:check` protege

<div class="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
<div>

- **Registro**  -  ID/pasta, origem, padrão
- **Identidade**  -  ownership de assets, URLs, redirects
- **Tema**  -  tokens, seletores, pares hex/RGB
- **Território**  -  GeoJSON, sigla, viewport

</div>
<div>

- **Dataset**  -  paths, páginas de dados, timeline, domínios
- **Páginas**  -  fonte, layout, style, vendor, SEO/nav
- **Saída**  -  tokens, HTML, referências locais
- **CSS/vendor**  -  Bootstrap purgado e ícones
- **Bundles**  -  cada `dist/<id>` inclui só assets referenciados

</div>
</div>

<div class="text-sm pt-3">

Complementar: `npm run lint:all` · `npm run format:check` · inspeção manual em light/dark e mobile.

</div>

<!--
O validador de publicação roda antes do renderer escrever. `build:check` vai além: constrói cada publicação,
valida os HTMLs específicos, referências locais, PurgeCSS e identidade do output, restaura a publicação
padrão e confere drift dos arquivos gerados. O CI também executa `build:all` e publica os bundles como
artefato revisável, incluindo o `.htaccess` de cada site.

O wrapper de links também deriva do dataset os paths operacionais que o Linkinator deve ignorar; um site
novo não exige acrescentar regex de `JSON/`/`GeoJSON/` manualmente.

Ainda não há testes de navegador automatizados. Por isso inspeção manual continua necessária, sobretudo
para dark mode, responsividade, mapa, troca de domínio, slider e modal de série.

Quando uma mudança mexe em CSS comum ou template, validar apenas o site que motivou a alteração é
insuficiente. O contrato multi-publicação só é real se todas forem exercitadas.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Riscos de regressão

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

- editar `site/*.html` -> mudança perdida
- identidade no template/CSS -> marca vaza
- copiar página comum -> conteúdo diverge
- `siteSource()` para capacidade comum -> duplicação

</div>
<div>

- esquecer manifesto consumidor -> catálogo desigual
- CSS sem `page.styles` -> estilo ausente
- testar CSS comum em um site -> regressão temática
- hardcode de estado/path -> mapa ou dados errados

</div>
</div>

<div class="border-l-4 border-emerald-600 pl-3 py-2 mt-4 text-sm">

Prevenção: fronteiras declarativas + `build:check` + inspeção das publicações afetadas.

</div>

<!--
Os riscos agora são principalmente erros de fronteira.

Duplicar é tentador no primeiro site novo, mas cria forks editoriais difíceis de manter. Por outro lado,
forçar tudo a ser compartilhado também é erro: conteúdo institucional genuinamente distinto deve ficar no
módulo da publicação.

Em revisão, pergunte sempre: este arquivo pertence a quem? O manifesto deixa o alcance visível? Há um `if`
por ID escondendo uma decisão que deveria ser declarativa?

O `rg` é útil para localizar consumidores de fontes, layouts e tokens antes de alterar módulos comuns.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Checklists operacionais

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

### Nova publicação

- [ ] `identity.js`, `pages.js`, `theme.css`
- [ ] assets próprios no módulo da publicação
- [ ] páginas/fragments exclusivos
- [ ] território + contorno, se novo
- [ ] dataset, se novo
- [ ] composição em `site.js`
- [ ] `sites:list` e build individual
- [ ] `build:check` e `build:all`
- [ ] dados operacionais corretos no deploy

</div>
<div>

### Página ou atualização

- [ ] decidir comum versus exclusiva
- [ ] editar fonte, não output
- [ ] atualizar SEO/nav em `pages.js`
- [ ] declarar `styles`, se houver
- [ ] verificar consumidores compartilhados
- [ ] build da publicação afetada
- [ ] `build:check` + `lint:all`
- [ ] light/dark, mobile e links
- [ ] contrato produtor/consumidor, se afetado

</div>
</div>

<!--
Use essas listas em descrição de PR enquanto o fluxo ainda não for automático para o time.

Para nova publicação, o build valida frontend; ele não verifica se a rodada meteorológica correta foi
implantada naquele host. Essa associação continua sendo uma etapa operacional.

Para uma atualização, a pergunta "comum ou exclusiva?" deve vir antes do caminho de arquivo. Depois,
declare metadados no manifesto e valide o conjunto, não só o HTML alterado.

Se o CSS for compartilhado, teste ao menos uma página institucional e uma WebGIS de cada publicação em
light e dark mode.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Dois repositórios, um contrato de publicação

<div class="grid grid-cols-2 gap-8 pt-2">
<div>

O `site-labmim` **não produz dados meteorológicos**. Ele monta HTML e associa, no deploy, os artefatos gerados por um pipeline Python separado:

- **`micrometeorology`** - lê a saída do modelo **WRF** e a estação, e exporta os artefatos que as páginas do site consomem.

Os dois repositórios se ligam por **contratos versionados**: manifest, grade, valores, overlays, séries, monitoramento, climatologia e céu.

<div class="border-l-4 border-emerald-600 pl-3 py-2 mt-4 text-sm">

Uma mudança de formato exige PRs coordenados. O consumidor compatível deve chegar antes do produtor novo.

</div>
</div>
<div>

### As 12 CLIs `labmim-*`

<div class="text-sm leading-relaxed">

**Publicação no site**

`labmim-wrf-geojson` · `labmim-monitoring` · `labmim-climatology` · `labmim-sky` · `labmim-site-graphs`

**Base operacional**

`labmim-wrf-series` · `labmim-archive` · `labmim-sensor-process`

**Figuras e análise**

`labmim-wrf-figures` · `labmim-station-graphs` · `labmim-metrics` · `labmim-comparison`

</div>

<div class="text-sm mt-3 opacity-70">

`labmim-wrf-geojson` alimenta o WebGIS; as outras rotas do site possuem produtores próprios.

</div>
</div>
</div>

<!--
Ponto de virada do deck: até aqui, tudo era o gerador estático. Agora entra o repositório irmão que produz
os dados. A mensagem central: o site não calcula campos meteorológicos; ele apresenta artefatos cujo schema
e nome são contratos entre dois históricos Git independentes.

O pacote passou de sete para doze CLIs. Além do WebGIS, há produtores explícitos para monitoramento,
climatologia, condição do céu e para `series_operacional.dat`, a camada WRF usada pelos produtos de estação.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Organização do pipeline produtor

<div class="grid grid-cols-2 gap-4 text-sm">
<div class="border-l-4 border-blue-500 pl-3 py-2">

### `wrf/`

Leitura NetCDF, variáveis, `value_source`, jobs, grades, séries, isóbaras e segurança de escrita.

</div>
<div class="border-l-4 border-emerald-600 pl-3 py-2">

### `sensors/`

Ingestão, controle de qualidade, calibração, agregação, vento, arquivo e catálogo do monitoramento.

</div>
<div class="border-l-4 border-violet-500 pl-3 py-2">

### `stats/`

Climatologia, distribuições, radiação, Kt x Kd, comparação e métricas.

</div>
<div class="border-l-4 border-orange-500 pl-3 py-2">

### `cli/` + `common/`

Entrypoints, configuração, logging, paths, tipos compartilhados e política de tempo local.

</div>
</div>

<div class="grid grid-cols-3 gap-4 text-sm pt-5">
<div>

**Entradas**

`wrfout_d0X_*` · `.dat`/Parquet da estação · câmera all-sky

</div>
<div>

**Processamento**

Python 3.14 · NumPy/xarray/pandas · processos paralelos · escrita atômica

</div>
<div>

**Saídas do site**

WebGIS · monitoramento · climatologia · céu · PNGs

</div>
</div>

<!--
O pacote Python não é uma pasta única de scripts. `common/` mantém os contratos transversais; `wrf/` contém
a física e os writers do modelo; `sensors/` transforma o acervo observado; `stats/` produz análises; `cli/`
expõe cada fluxo operacional sem duplicar a implementação.

A série operacional é o elo entre WRF e os produtos de estação: `labmim-wrf-series` acrescenta a primeira
janela horária de cada rodada ao arquivo histórico; monitoramento, climatologia e PNGs podem então exibir a
camada modelada ao lado da observação.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Classifique o produto antes de expandir o WebGIS

<div class="grid grid-cols-3 gap-4 text-sm pt-2">
<div class="border rounded-lg p-3">

### Campo cru

Já existe como escalar 2-D no `wrfout`.

`DEFAULT_VARS` + entrada no site.

</div>
<div class="border rounded-lg p-3">

### Campo derivado

Exige fórmula, conversão ou vários campos.

`variables.py` + `value_source.py` + tipo/id + defaults.

</div>
<div class="border rounded-lg p-3">

### Overlay

Geometria desenhada sobre um campo.

Work unit próprio + descriptor em `manifest.features`.

</div>
</div>

<div class="text-center text-sm pt-6">

`produtor` -> `{D}_{ID}_{NNN}.json` + `manifest.json` -> `consumidor`

</div>

<div class="grid grid-cols-2 gap-5 text-sm pt-5">
<div class="border-l-4 border-orange-500 pl-3">

Campos sombreados entram em `VARIABLES_CONFIG` e em `VARIABLE_CONTEXTS`.

</div>
<div class="border-l-4 border-emerald-600 pl-3">

Overlays como `ISOBARS` ficam fora do catálogo de base e são descobertos em `features`.

</div>
</div>

<!--
A decisão inicial agora possui três ramos. Campos crus caem no passthrough genérico de `value_source.py`.
Campos derivados centralizam a fórmula em `variables.py`, o dispatch e a escala em `value_source.py`, o id
publicado em `common/types.py` e a ativação em `DEFAULT_VARS`.

Isóbaras e vetores de vento não são valores de célula: não produzem `series.bin` nem `summary.json` e não
entram em `VARIABLES_CONFIG`. O manifest anuncia o formato, o nome do arquivo e, no caso das isóbaras, sobre
quais campos o overlay pode aparecer.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Receita A - campo escalar cru (2 edições)

<div class="grid grid-cols-2 gap-6 text-sm pt-1">
<div>

**Pipeline** · `cli/export_wrf_geojson.py`

```python
DEFAULT_VARS = [
    "temperature", "wind", "rain",
    # exemplo: campo escalar que o wrfout já carrega
    "UST",      # velocidade de fricção
]
# O ramo genérico em value_source.py já cobre:
#   ds.has_variable("UST") -> extract_scalar
#   id de saída = "UST".upper()
```

```bash
$ labmim-wrf-geojson -v UST \
    -o site/JSON -g site/GeoJSON -D 1,4
# -> D01_UST_007.json, D01_UST.series.bin
```

</div>
<div>

**Site** · `site/assets/js/variables-config.js`

```js
frictionVelocity: {
  id: "UST", sourceId: "UST", // == {VAR}
  label: "Velocidade de fricção", unit: "m/s",
  faIcon: "wind",
  colors: ["#f7fbff", /* rampa editorial */ "#08306b"],
  scaleMin: 0, scaleMax: 2, // validar com dados reais
  summary: "Escala turbulenta próxima à superfície.",
  specificInfo: (v) => v == null
    ? unavailableInfo("Velocidade de fricção") : { /* … */ },
},
// e expor a chave "frictionVelocity" no array
// VARIABLE_CONTEXTS.forecast.variables
```

</div>
</div>

<!--
O caminho barato. Campos que o WRF já grava como escalar 2-D não exigem código novo no pipeline: o else de
`build_value_frame_source` chama `has_variable` + `extract_scalar` e usa o nome em maiúsculas como id de saída.
Basta o nome em DEFAULT_VARS (ou passá-lo em -v) e a entrada no config do site.

No config, o par id/sourceId é o contrato; colors é a rampa; scaleMin/scaleMax fixam a escala do mapa (não
os bounds por-passo do export). Não esqueça de incluir a chave no array de VARIABLE_CONTEXTS do contexto certo.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Receita B - variável derivada em quatro camadas

<div class="grid grid-cols-2 gap-6 text-sm pt-1">
<div>

**1 · Extractor** · `wrf/variables.py`

```python
def extract_relative_humidity(ds):
    q2   = ds.get_variable("Q2")    # kg/kg
    t2   = ds.get_variable("T2")    # K
    psfc = ds.get_variable("PSFC")  # Pa
    rh = compute_relative_humidity(q2, t2, psfc)
    lo, hi = percentile_scale_bounds(rh)
    return rh, lo, hi            # (vals3d, vmin, vmax)
```

**2 · Tipo + id** · `common/types.py`

```python
class WRFVariable(StrEnum):
    RELATIVE_HUMIDITY = "relative_humidity"

VARIABLE_NETCDF_MAP = {
    WRFVariable.RELATIVE_HUMIDITY: "RH2",  # -> {VAR}
}
```

</div>
<div>

**3 · Dispatch compartilhado** · `wrf/value_source.py`

```python
elif variable_name == WRFVariable.RELATIVE_HUMIDITY:
    values, lo, hi = \
        variables.extract_relative_humidity(dataset)

return ValueFrameSource(
    frame_for_step=lambda i: variables.materialize_2d(
        values[i : i + 1]
    ),
    scale_min=lo, scale_max=hi,
)
```

**4 · Habilitar** · `cli/export_wrf_geojson.py`

```python
DEFAULT_VARS = [ ..., "relative_humidity" ]
```

Depois, no site: entrada em `VARIABLES_CONFIG` com `sourceId: "RH2"` (igual ao `{VAR}` do arquivo).

</div>
</div>

<!--
O caminho completo, uma edição por camada. O extractor concentra a física e a unidade num só lugar
(docstring obrigatório); a escala usa `percentile_scale_bounds`, a convenção compartilhada dos produtos.

O enum + VARIABLE_NETCDF_MAP definem o id de saída {VAR} = "RH2"; é ele que nomeia o arquivo e que o site
precisa repetir em sourceId. `value_source.py` liga o nome ao extractor e serve a mesma leitura e escala aos
JSONs e às figuras. `jobs.py` fica responsável pelos work units e writers; DEFAULT_VARS entra a variável na rodada padrão.

Vento é o caso especial: U/V viram velocidade e vetores, com caminho próprio (stream_wind_at_heights). Use os
extractores existentes como modelo  -  relative_humidity e wind_power_density_10m são os dois melhores exemplos
de variável derivada.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# IDs, overlays e escolhas editoriais

<div class="grid grid-cols-3 gap-4 text-sm pt-2">
<div class="border-l-4 border-amber-500 pl-3">

**O contrato de id**

O `{VAR}` de `{D}_{VAR}_{NNN}.json` vem de `VARIABLE_NETCDF_MAP[nome]` (ou `nome.upper()`).

O `sourceId` no site **tem** de ser esse `{VAR}`. Confira em `JSON/manifest.json`.

</div>
<div class="border-l-4 border-rose-500 pl-3">

**Base x overlay**

`WIND_VECTORS` e `ISOBARS` são descobertos em `manifest.features`; não entram em `VARIABLES_CONFIG` nem geram série de célula.

`sourceId` errado -> 404 + cache negativo; a base fica muda sem erro visual explícito.

</div>
<div class="border-l-4 border-emerald-600 pl-3">

**Escala, paleta e ícone**

`colors[]` é uma rampa; a cor por célula interpola entre `scaleMin` e `scaleMax` fixos no site.

Isso é **decisão editorial**. Ícone novo exige regenerar o subset Font Awesome.

</div>
</div>

<div class="text-sm pt-4 opacity-80">

**Fontes:** `wrf/variables.py` · `wrf/value_source.py` · `wrf/jobs.py` · `wrf/isobars.py` · `common/types.py` · `site/assets/js/variables-config.js`

</div>

<!--
Fecho da seção do pipeline. O contrato de id cola os campos sombreados entre os repos e o manifest é a fonte
de verdade do nome final. Overlays possuem outro contrato: o descriptor informa o formato, o template e os
campos sobre os quais podem aparecer. Uma incompatibilidade de id não estoura erro: o DataService trata 404
com cache negativo e a variável simplesmente não aparece.

Sugestão de exercício: adicionar um campo cru de teste pelo caminho rápido, rodar o export num wrfout,
conferir o nome no manifest e só então declarar `sourceId`, escala, paleta e texto no site.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->

---

# Referências rápidas

<div class="grid grid-cols-2 gap-8">
<div>

### Comandos  -  site

```bash
npm run sites:list
npm run build -- --site=<id>
npm run build:all
npm run build:check
npm run lint:all
```

### Comandos  -  pipeline de dados

```bash
labmim-wrf-geojson -v <var> \
  -o site/JSON -g site/GeoJSON -D 1,4
labmim-monitoring -i <archive> -o site/Monitoramento \
  -w data/series_operacional.dat
```

**Guias:** `src/sites/README.md` · `micrometeorology/docs/micrometeorology.md`

</div>
<div>

### Documentação técnica

- `Architecture.md`
- `README.md`
- `docs/onboarding-architecture/architecture-evidence.md`

**Código do gerador**

- `scripts/site-builder/{publications,validate,renderer}.js`
- `src/template/page-types.js`

**Pipeline de dados** (`micrometeorology`)

- `wrf/variables.py` · `wrf/value_source.py` · `wrf/jobs.py`
- `wrf/isobars.py` · `wrf/operational_series.py`
- `common/types.py` · `cli/export_wrf_geojson.py`

<div class="border-l-4 border-emerald-600 pl-3 py-2 mt-4 text-sm">

Primeira mudança recomendada: editar conteúdo ou SEO de uma publicação e acompanhar o output gerado.

</div>
</div>
</div>

<!--
Feche voltando ao modelo de quatro módulos. `src/sites/README.md` é a receita curta para trabalho diário;
`Architecture.md` descreve o runtime e os contratos de dados em profundidade; o documento de evidências
registra o lastro factual deste deck.

Para onboarding prático, sugira: listar publicações, construir UFES, comparar o `site-theme.css` e a meta
`site-config`, construir UFBA e observar a restauração do frontend sem tocar os dados operacionais.

Depois faça uma mudança editorial pequena em `pages.js` ou numa fonte exclusiva. É a forma mais rápida de
entender composição, geração e drift antes de mexer no WebGIS compartilhado ou em um contrato entre repos.

[Sources]
- site-labmim, checkout local de 18-08-2026: README.md, Architecture.md, src/sites/README.md e arquivos citados neste slide.
- micrometeorology, checkout local de 18-08-2026: docs/micrometeorology.md, pyproject.toml e arquivos citados neste slide.
-->
