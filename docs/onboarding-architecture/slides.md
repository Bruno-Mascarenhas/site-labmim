---
theme: seriph
title: Publicações meteorológicas — Onboarding técnico
info: |
  Arquitetura modular e fluxo de manutenção do site-labmim.
  Todo o conteúdo é derivado do código real do repositório.
highlighter: shiki
lineNumbers: false
drawings:
  persist: false
transition: slide-left
layout: two-cols
layoutClass: gap-8
---

# Sites LabMiM / LEAL

## Onboarding da plataforma estática multi-publicação

**Objetivo**

Uma aplicação compartilhada para publicações meteorológicas de diferentes instituições, estados e produtos WRF.

**Hoje**

- LabMiM / UFBA — Bahia
- LEAL / UFES — Espírito Santo
- Estrutura pronta para novas publicações

::right::

<div class="pt-16"></div>

| Camada   | Escolha                      |
| -------- | ---------------------------- |
| Build    | Node 24 + gerador próprio    |
| Saída    | HTML, CSS e JS puros         |
| Mapa     | Leaflet 1.9.4                |
| Gráficos | Chart.js 3.9.1               |
| Dados    | JSON, GeoJSON e binários WRF |

<div class="border-l-4 border-emerald-600 pl-3 py-2 mt-4 text-sm">

**Node só existe no build.** O servidor continua inteiramente estático.

</div>

<!--
Abra alinhando a expectativa: este não é um SPA, não há backend e não há Node em produção. O projeto é
um gerador estático multi-publicação. A mesma aplicação é combinada com identidade, conteúdo, geografia e
dataset diferentes antes do deploy.

O salto arquitetural em relação ao site original é justamente separar o que antes era um site UFBA único.
Hoje UFBA e UFES já exercitam o contrato, e uma terceira publicação entra sem cadastrar ID em `build.js`.

As bibliotecas de runtime continuam vendorizadas em `site/assets/vendor/`. O pipeline meteorológico é
externo; o build escolhe e monta o frontend, mas não converte dados WRF.
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

`site/` — uma publicação · `dist/<id>/` — todas

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
-->

---

# CSS desacoplado por responsabilidade

<div class="flex justify-center pt-1">
  <img src="/diagrams/css-layers.svg" class="w-full max-w-5xl" alt="Tema exclusivo selecionado alimentando módulos CSS estruturais compartilhados" />
</div>

<div class="grid grid-cols-3 gap-3 text-sm pt-2">
<div class="border rounded-lg p-2">

**Identidade**

`src/sites/<id>/theme.css` — 19 tokens, nenhum seletor.

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

Cada publicação implementa um contrato estrito de 19 custom properties. O validador e `lint:themes`
recusam tema incompleto, seletor estrutural e hex/RGB divergentes. O build copia somente o arquivo da
publicação ativa para `site/assets/css/site-theme.css`.

Os módulos compartilhados consomem tokens como `--brand-primary`, `--accent-rgb` e `--map-accent`; não
carregam paleta institucional. Alterar `theme.css` de um site muda só aquele site. Alterar
`base/layout/components/theme` muda todos e exige validar todas as publicações.

CSS específico de uma página entra pelo manifesto `page.styles`. O tipo WebGIS declara `maps.css`; o
layout não decide isso implicitamente. Uma fonte `templateSource("styles/x.css")` ou
`siteSource("styles/x.css")` é copiada para seu namespace gerado. CSS de bibliotecas locais usa
`page.vendorStyles` — hoje Leaflet nos tipos WebGIS. A cascata protegida é vendor da página → base →
site-theme → layout → components → styles da página → theme.
-->

---

# Onde colocar uma mudança de estilo?

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

### Sempre carregado

- marca → `src/sites/<id>/theme.css`
- reset/utilitário → `base.css`
- navbar/footer → `layout.css`
- cards/blocos → `components.css`
- dark mode → `theme.css`

</div>
<div>

### Declarado por página

- WebGIS → `maps.css` em `styles`
- asset comum → `"assets/css/…"`
- fonte compartilhada → `templateSource("styles/…")`
- fonte exclusiva → `siteSource("styles/…")`
- biblioteca local → `vendorStyles`

</div>
</div>

<div class="border-l-4 border-amber-500 pl-3 py-2 mt-4 text-sm">

Não duplique estrutura num tema e não adicione seletor por ID no CSS comum.

</div>

<!--
Use a tabela como decisão operacional durante revisão.

Tema é somente implementação dos tokens de identidade. Ele não deve redefinir seletores de componente.
`page.styles` controla **onde um CSS estrutural carrega**; não transforma esse CSS em paleta institucional.
Fontes autorais podem pertencer ao template ou ao site, mas diferenças de marca continuam nos 19 tokens.

`page.styles` também elimina carregamento global desnecessário. Estilos do tipo e extras da página são
**mesclados**, então personalizar forecast não remove `maps.css`. O namespace `assets/css/generated/` é
limpo a cada build e recebe apenas fontes usadas pela publicação ativa.

Depois de qualquer alteração comum, rode `build:check`: é a forma de provar que UFBA, UFES e futuras
publicações continuam válidas.
-->

---

# Comandos e saídas

```bash
npm run sites:list
npm run build                         # publicação padrão → site/
npm run build -- --site=ufes          # publicação escolhida → site/
npm run build:all                     # todas → dist/<id>/
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

Assets apontam para `site/assets/`; redirects só podem chegar a páginas declaradas no próprio site.

</div>

<!--
`identity.js` concentra tudo que responde "quem publica": origem canônica, marca, logos, afiliações,
instituição, cidade, tema e compatibilidade de URLs antigas.

O validador abre cada asset referenciado, verifica dimensões positivas, URLs HTTP(S), tipos de afiliação e
destinos de redirect. Para uma afiliação, há duas representações: imagem ou texto institucional.

Não escreva marca ou sigla diretamente em partials. O renderer já oferece tokens para navbar, footer,
sidebar, SEO e JSON-LD.
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
  },
  timeline: {
    defaultMaxLayer: 73,
    initialIndex: 7,
    stepHours: 1,
    label: "Horário local (UTC−03)",
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
não são apenas labels. Reutilize módulos existentes quando o produto ou território for realmente o mesmo.
`stepHours` torna a frequência explícita; horizonte e quantidade textual de passos são derivados, não
hardcoded no template.
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
      h1: "LAB — Laboratório Exemplo",
      title: "LAB — Laboratório Exemplo · UE",
      description: "Pesquisa meteorológica da Universidade Exemplo.",
    },
  }),
  page("forecast", {
    seo: { title: "LAB — Previsões WRF · UE", description: "Previsões para Pernambuco." },
  }),
];
```

<div class="grid grid-cols-2 gap-5 text-sm pt-3">
<div>

Implemente os 19 tokens em `theme.css`.

</div>
<div>

Componha tudo no pequeno `site.js`.

</div>
</div>

<!--
O catálogo `page-types.js` traz os tipos home, monitoring, team, climatology, forecast e energy. Ele
preenche arquivo, layout, fonte comum, navegação e estilos padrão quando cabível.

Home e equipe exigem fonte própria da publicação. Os demais tipos já apontam para conteúdo comum, mas SEO
continua obrigatório e editorial para cada site.

Copie um tema existente e substitua todos os tokens; não copie seletores estruturais. O validator mostra
de uma vez quais propriedades estão ausentes.

Por fim, `site.js` importa identidade, páginas, território e dataset. Rode `sites:list`, o build individual
e depois `build:check`.
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
-->

---

# Atualizar uma página existente: mapa de impacto

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

### Conteúdo e catálogo

- comum → `src/template/pages/*.html`
- exclusivo → `src/sites/<id>/pages/*.html`
- anexo → `src/sites/<id>/fragments/*.html`
- SEO/H1 → `src/sites/<id>/pages.js`
- menu/ordem → `page.nav` em `pages.js`

</div>
<div>

### Estrutura e identidade

- head/navbar/footer → `src/template/partials/`
- shell de página → `src/template/layouts/`
- CSS compartilhado → `site/assets/css/`
- CSS autoral → `templateSource`/`siteSource`
- paleta → `src/sites/<id>/theme.css`

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
-->

---

# Território e dataset chegam ao runtime

```text
territory + dataset
  → renderer.runtimeConfig()
  → <meta name="site-config" content="…">
  → map-init.js / MeteoMapManager
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
-->

---

# Dados e gráficos: o build não os produz

<div class="grid grid-cols-2 gap-5 text-sm">
<div class="border rounded-lg p-3">

### Monitoring

- 9 PNGs de nome fixo
- gerados por `labmim-site-graphs`
- cards e modais Bootstrap
- nenhuma instância Chart.js

</div>
<div class="border rounded-lg p-3">

### WebGIS

- manifest + JSON/GeoJSON
- `series.bin` via HTTP Range
- `summary.json` para prévia
- Chart.js controlado por `ChartsManager`

</div>
</div>

<div class="flex justify-center pt-4">
  <img src="/diagrams/chart-data-flow.svg" class="w-full max-w-5xl" alt="Fluxo da série temporal do dataset até Chart.js" />
</div>

<!--
Essa distinção continua essencial. Os PNGs do monitoramento são gerados fora deste repositório pelo pipeline
de estação. Já as séries do WebGIS são interativas e usam os artefatos WRF configurados no dataset.

O manifest anuncia versão, disponibilidade e formatos consolidados. Se `series.bin` estiver ausente, o
cliente volta à coleta hora a hora; se a grade compacta não existir, cai no GeoJSON legado. Essa política
permite publicar frontend e dados separadamente.

Um bundle em `dist/<id>` não inclui esses dados. Antes do deploy, associe a rodada e os gráficos corretos
da instituição aos caminhos declarados no dataset.
-->

---

# O que `build:check` protege

<div class="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
<div>

- **Registro** — ID/pasta, origem, padrão
- **Identidade** — logos, URLs, redirects
- **Tema** — tokens, seletores, pares hex/RGB
- **Território** — GeoJSON, sigla, viewport

</div>
<div>

- **Dataset** — paths, timeline, domínios
- **Páginas** — fonte, layout, style, vendor, SEO/nav
- **Saída** — tokens, HTML, referências locais
- **CSS/vendor** — Bootstrap purgado e ícones

</div>
</div>

<div class="text-sm pt-3">

Complementar: `npm run lint:all` · `npm run format:check` · inspeção manual em light/dark e mobile.

</div>

<!--
O validador de publicação roda antes do renderer escrever. `build:check` vai além: constrói cada publicação,
valida os HTMLs específicos, referências locais, PurgeCSS e identidade do output, restaura a publicação
padrão e confere drift dos arquivos gerados.

O wrapper de links também deriva do dataset os paths operacionais que o Linkinator deve ignorar; um site
novo não exige acrescentar regex de `JSON/`/`GeoJSON/` manualmente.

Ainda não há testes de navegador automatizados. Por isso inspeção manual continua necessária, sobretudo
para dark mode, responsividade, mapa, troca de domínio, slider e modal de série.

Quando uma mudança mexe em CSS comum ou template, validar apenas o site que motivou a alteração é
insuficiente. O contrato multi-publicação só é real se todas forem exercitadas.
-->

---

# Riscos de regressão

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

- editar `site/*.html` → mudança perdida
- identidade no template/CSS → marca vaza
- copiar página comum → conteúdo diverge
- `siteSource()` para capacidade comum → duplicação

</div>
<div>

- esquecer manifesto consumidor → catálogo desigual
- CSS sem `page.styles` → estilo ausente
- testar CSS comum em um site → regressão temática
- hardcode de estado/path → mapa ou dados errados

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
-->

---

# Checklists operacionais

<div class="grid grid-cols-2 gap-6 text-sm">
<div>

### Nova publicação

- [ ] `identity.js`, `pages.js`, `theme.css`
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
-->

---

# De onde vêm os dados: o repositório irmão

<div class="grid grid-cols-2 gap-8 pt-2">
<div>

O `site-labmim` **não produz dados**. Ele monta HTML e associa, no deploy, os artefatos gerados por um pipeline Python separado:

- **`micrometeorology`** — lê a saída do modelo **WRF** e a estação, e exporta as grades, valores e figuras que o WebGIS consome.

Os dois repositórios se ligam por **contratos versionados** (manifest, grade, série por célula) e por um **contrato de id de variável**.

<div class="border-l-4 border-emerald-600 pl-3 py-2 mt-4 text-sm">

Para **expandir as variáveis dos mapas interativos**, o trabalho começa aqui, no pacote Python — e termina numa entrada de config no site.

</div>
</div>
<div>

### As 7 CLIs `labmim-*`

<div class="text-sm leading-relaxed">

**Dados do WebGIS** ★

`labmim-wrf-geojson` — grades, valores, `series.bin`, manifest

**Figuras**

`labmim-site-graphs` (9 PNGs do monitoring) · `labmim-wrf-figures` · `labmim-station-graphs`

**Sensores e análise**

`labmim-sensor-process` · `labmim-metrics` · `labmim-comparison`

</div>

<div class="text-sm mt-3 opacity-70">

Só `labmim-wrf-geojson` alimenta os mapas interativos.

</div>
</div>
</div>

<!--
Ponto de virada do deck: até aqui, tudo era o gerador estático. Agora entra o repositório irmão que produz
os dados. A mensagem central: o site não calcula nada — ele publica o que o pipeline gerou e sabe ler os
formatos por causa de contratos versionados.

`labmim-wrf-geojson` é a única CLI que alimenta os mapas interativos diretamente; as demais produzem figuras
e relatórios. É a CLI relevante para quem vai adicionar variáveis.
-->

---
layout: center
class: px-4
---

<div class="flex justify-center items-center h-full">
  <img src="/diagrams/micrometeorology-overview.svg" class="object-contain flex-shrink-0" style="height: 520px; max-width: 100%" alt="Entradas WRF e estação, as camadas common/wrf/sensors/stats/cli do pacote Python, as CLIs labmim-* e os artefatos consumidos pelo site" />
</div>

<!--
Poster de orientação. As quatro camadas: common/ é transversal (config, types, logging, paths); wrf/ é o
processamento espacial do WRF (onde vivem as variáveis); sensors/ trata a estação; stats/ é análise.

Para adicionar uma variável, só quatro arquivos importam, todos destacados: wrf/variables.py (o extractor),
common/types.py (o enum e o mapa de id de saída), wrf/jobs.py (o dispatch) e cli/export_wrf_geojson.py
(a lista DEFAULT_VARS). Um campo escalar cru dispensa os três primeiros.
-->

---
layout: center
class: px-4
---

<div class="flex justify-center items-center h-full">
  <img src="/diagrams/add-wrf-variable.svg" class="object-contain flex-shrink-0" style="height: 520px; max-width: 100%" alt="Fluxo entre os dois repositórios: decisão campo cru vs derivado, export, o contrato de id, e o registro no VARIABLES_CONFIG do site" />
</div>

<!--
O fluxo completo, ponta a ponta. Primeira decisão: a variável já está no wrfout como campo escalar 2-D
(HFX, LH, SWDOWN, GLW)? Se sim, caminho rápido — nenhum código Python novo, só o nome em DEFAULT_VARS.
Se é derivada (fórmula, conversão, vários campos), são quatro edições, uma por camada.

O centro é o contrato de id: o {VAR} do arquivo {D}_{VAR}_{NNN}.json vem de VARIABLE_NETCDF_MAP (ou do nome
em maiúsculas) e precisa ser exatamente o sourceId no VARIABLES_CONFIG do site. Errar esse id é a falha mais
comum — vira 404 e cache negativo, e a variável fica muda sem erro visível.
-->

---

# Receita A — campo escalar cru (2 edições)

<div class="grid grid-cols-2 gap-6 text-sm pt-1">
<div>

**Pipeline** · `cli/export_wrf_geojson.py`

```python
DEFAULT_VARS = [
    "temperature", "wind", "rain",
    # ... adicione o nome NetCDF:
    "SWDOWN",   # radiação de onda curta
]
# O ramo genérico em jobs.py já cobre:
#   ds.has_variable("SWDOWN") → extract_scalar
#   id de saída = "SWDOWN".upper()
```

```bash
$ labmim-wrf-geojson -v SWDOWN \
    -o site/JSON -g site/GeoJSON -D 1,4
# → D01_SWDOWN_007.json, D01_SWDOWN.series.bin
```

</div>
<div>

**Site** · `site/assets/js/variables-config.js`

```js
globalRadiation: {
  id: "SWDOWN", sourceId: "SWDOWN", // == {VAR}
  label: "Radiação Global", unit: "W/m²",
  faIcon: "sun",
  colors: ["#fff", "#ffd700", /* … */ "#7a0000"],
  scaleMin: 0, scaleMax: 1200,
  summary: "Onda curta incidente na superfície.",
  specificInfo: (v) => v == null
    ? unavailableInfo("Radiação") : { /* … */ },
},
// e expor a chave "globalRadiation" no array
// VARIABLE_CONTEXTS.forecast.variables
```

</div>
</div>

<!--
O caminho barato. Campos que o WRF já grava como escalar 2-D não exigem código novo no pipeline: o else de
_build_value_frame_source chama has_variable + extract_scalar e usa o nome em maiúsculas como id de saída.
Basta o nome em DEFAULT_VARS (ou passá-lo em -v) e a entrada no config do site.

No config, o par id/sourceId é o contrato; colors é a rampa; scaleMin/scaleMax fixam a escala do mapa (não
os bounds por-passo do export). Não esqueça de incluir a chave no array de VARIABLE_CONTEXTS do contexto certo.
-->

---

# Receita B — variável derivada (uma edição por camada)

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
    WRFVariable.RELATIVE_HUMIDITY: "RH2",  # → {VAR}
}
```

</div>
<div>

**3 · Dispatch** · `wrf/jobs.py`

```python
if variable_name == WRFVariable.RELATIVE_HUMIDITY:
    rh, vmin, vmax = \
        variables.extract_relative_humidity(dataset)
    return _ValueFrameSource(
        frame_for_step=lambda i:
            variables.materialize_2d(rh[i : i + 1]),
        scale_min=vmin, scale_max=vmax,
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
O caminho completo, uma edição por camada, na ordem de baixo para cima. O extractor concentra a física e a
unidade num só lugar (docstring obrigatório); a escala usa percentile_scale_bounds, a convenção do site
(pula o spin-up, corta no percentil 98).

O enum + VARIABLE_NETCDF_MAP definem o id de saída {VAR} = "RH2"; é ele que nomeia o arquivo e que o site
precisa repetir em sourceId. O branch em jobs.py liga o nome ao extractor e materializa o frame 2-D por passo.
DEFAULT_VARS entra a variável na rodada padrão.

Vento é o caso especial: U/V viram velocidade e vetores, com caminho próprio (stream_wind_at_heights). Use os
extractores existentes como modelo — relative_humidity e wind_power_density_10m são os dois melhores exemplos
de variável derivada.
-->

---

# Contrato e armadilhas ao expandir variáveis

<div class="grid grid-cols-3 gap-4 text-sm pt-2">
<div class="border-l-4 border-amber-500 pl-3">

**O contrato de id**

O `{VAR}` de `{D}_{VAR}_{NNN}.json` vem de `VARIABLE_NETCDF_MAP[nome]` (ou `nome.upper()`).

O `sourceId` no site **tem** de ser esse `{VAR}`. Confira em `JSON/manifest.json`.

</div>
<div class="border-l-4 border-rose-500 pl-3">

**404 silencioso**

`sourceId` errado → o cliente pede um JSON que não existe, cai em **cache negativo** e a variável fica muda, sem erro visível.

**Ícone novo** → regenere o subset Font Awesome (`scripts/subset-fontawesome.md`), senão vira caixa vazia.

</div>
<div class="border-l-4 border-emerald-600 pl-3">

**Escala e paleta**

`colors[]` é uma rampa; a cor por célula interpola entre `scaleMin` e `scaleMax` fixos no site.

Isso é **decisão editorial** — diferente dos bounds por-passo (percentil 98) que o export calcula.

</div>
</div>

<div class="text-sm pt-4 opacity-80">

**Fontes:** `wrf/variables.py` · `wrf/jobs.py` · `common/types.py` · `cli/export_wrf_geojson.py` · `site/assets/js/variables-config.js`

</div>

<!--
Fecho da seção do pipeline. Três pontos de atenção. Primeiro, o contrato de id é a única cola entre os repos;
o manifest é a fonte de verdade do nome final. Segundo, uma incompatibilidade de id não estoura erro — o
DataService trata 404 com cache negativo, então a variável simplesmente não aparece; e um faIcon fora do
subset vira caixa vazia até regenerar. Terceiro, escala e paleta no site são editoriais e independem dos
bounds que o export usa para renderizar cada passo.

Sugestão de exercício: adicionar SWDOWN pelo caminho rápido, rodar o export num wrfout de teste, conferir o
nome no manifest e ver a variável surgir no seletor do mapa.
-->

---

# Referências rápidas

<div class="grid grid-cols-2 gap-8">
<div>

### Comandos — site

```bash
npm run sites:list
npm run build -- --site=<id>
npm run build:all
npm run build:check
npm run lint:all
```

### Comandos — pipeline de dados

```bash
labmim-wrf-geojson -v <var> \
  -o site/JSON -g site/GeoJSON -D 1,4
```

**Guias:** `src/sites/README.md` · `micrometeorology/README.md`

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

- `wrf/variables.py` · `wrf/jobs.py`
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
entender composição, geração e drift antes de mexer no WebGIS compartilhado.
-->
