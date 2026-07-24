# Apresentação de onboarding — arquitetura multi-publicação

Deck técnico em Slidev + Mermaid para integrar pessoas ao gerador estático de publicações meteorológicas
do repositório `site-labmim`.

## Objetivo

Em aproximadamente 25 minutos, a apresentação fornece o modelo mental e as receitas necessárias para:

- entender a composição `publicação + template + território + dataset`;
- distinguir código compartilhado de identidade e conteúdo próprios;
- avaliar o desacoplamento dos temas e do CSS de página;
- criar uma publicação sem editar o builder;
- adicionar uma página compartilhada ou exclusiva;
- atualizar conteúdo, SEO, navegação, tema, território e dataset;
- construir e validar uma ou todas as publicações;
- localizar o runtime e os contratos de dados do WebGIS.

As afirmações dos slides estão lastreadas em
[`architecture-evidence.md`](./architecture-evidence.md), com caminhos e símbolos reais do repositório.

## Conteúdo

```text
docs/onboarding-architecture/
├── slides.md                     # deck Slidev com speaker notes
├── architecture-evidence.md      # base factual da apresentação
├── README.md                     # este arquivo
├── package.json                  # ambiente isolado do Slidev
├── regen-diagrams.sh             # diagrams/*.mmd → public/diagrams/*.svg
├── preview-themes.sh             # comparação visual de temas do deck
├── render-svg.mjs                # rasteriza um SVG autoral para PNG (preview)
├── global-top.vue                # contador de slides
├── diagrams/                     # fontes .mmd (Mermaid → SVG via regen-diagrams.sh)
│   ├── repository-overview.mmd
│   ├── app-architecture.mmd
│   ├── publication-flow.mmd
│   ├── page-flow.mmd
│   ├── css-layers.mmd
│   ├── component-dependencies.mmd
│   └── chart-data-flow.mmd
├── public/diagrams/              # SVGs (gerados dos .mmd + posters autorais)
│   ├── arquitetura-poster.svg           # autoral — site: fonte→navegador
│   ├── micrometeorology-overview.svg    # autoral — o pacote de pipeline
│   └── add-wrf-variable.svg             # autoral — adicionar variável aos mapas
└── assets/
    ├── labmim-onboarding.pdf                          # export do Slidev (npm run export:pdf)
    ├── labmim-onboarding.pptx                         # idem, editável (git-ignored)
    ├── onboarding-plataforma-estatica-labmim-leal.pdf # mesmo deck, renderização distribuída
    ├── guia-contribuicao-site.pdf                     # guia de contribuição (ver abaixo)
    └── dist/                     # build estático opcional do deck
```

Os dois PDFs de onboarding são **o mesmo deck de 30 slides**, na mesma versão da arquitetura, em
renderizações diferentes: `labmim-onboarding.pdf` é a saída direta do Slidev com o tema `seriph`
(reproduzível por `npm run export:pdf`), e `onboarding-plataforma-estatica-labmim-leal.pdf` é a
renderização mais elaborada usada para distribuição — é ela que o [`README.md`](../../README.md), o
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) e o [`src/sites/README.md`](../../src/sites/README.md)
referenciam. Ao alterar `slides.md`, atualize as duas.

## Guia de contribuição

Ao lado do deck, [`assets/guia-contribuicao-site.pdf`](./assets/guia-contribuicao-site.pdf) documenta o
**processo** de contribuir com o repositório, enquanto o deck documenta a **arquitetura**: abrir a issue,
criar a branch a partir da `main`, alterar o lugar certo, validar com `make build`/`make ci`/`make serve`,
fazer commits pequenos, abrir o pull request, responder à revisão e mergear — mais o padrão de nomes de
branch, o formato das mensagens de commit, a configuração recomendada de proteção da `main` e um checklist
final. É o material indicado para quem chega ao laboratório antes de tocar no código.

Diferente do deck, este PDF não é gerado pelo Slidev deste diretório; ele é versionado como artefato
distribuível. Ele foi escrito enquanto a modularização em `src/sites/<id>/` ainda era um PR aberto, então
os exemplos que citam `src/pages/` refletem a estrutura anterior — o fluxo de trabalho segue válido, e a
árvore de arquivos atual está no deck e em [`src/sites/README.md`](../../src/sites/README.md).

O resumo do mesmo processo, em Markdown e sempre à mão de quem abre uma issue ou um PR, está em
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Fonte de verdade arquitetural

O deck acompanha a estrutura final do projeto:

| Assunto                           | Onde confirmar                                                    |
| --------------------------------- | ----------------------------------------------------------------- |
| descoberta de sites               | `scripts/site-builder/publications.js`                            |
| contrato e validação              | `scripts/site-builder/validate.js`                                |
| renderização e outputs            | `scripts/site-builder/renderer.js`, `assets.js`                   |
| tipos, fontes e estilos de página | `src/template/page-types.js`                                      |
| identidade e catálogo editorial   | `src/sites/<id>/identity.js`, `pages.js`                          |
| temas por publicação              | `src/sites/<id>/theme.css`, `scripts/check-site-themes.mjs`       |
| geografia                         | `src/territories/*.js`                                            |
| produtos WRF                      | `src/datasets/*.js`                                               |
| receita de manutenção             | `src/sites/README.md`                                             |
| runtime WebGIS                    | `site/assets/js/map-*.js`, `charts-manager.js`, `data-service.js` |
| visão completa                    | `Architecture.md`, `README.md` na raiz                            |

Use sempre os módulos e caminhos atuais; não misture no material convenções da arquitetura anterior.

## Tema do deck

O deck usa `seriph` e um contador próprio em `global-top.vue`. Há também o tema `default` instalado para
comparação:

```bash
./preview-themes.sh
./preview-themes.sh default
```

Temas com menos área útil podem cortar conteúdo silenciosamente durante o export. Depois de trocar o tema,
inspecione o PDF página por página.

## Diagramas

Os `.mmd` em `diagrams/` são a fonte. Os slides usam os SVGs pré-renderizados em `public/diagrams/` para
que dev, PDF e PPTX sejam determinísticos.

Depois de editar qualquer diagrama:

```bash
./regen-diagrams.sh
```

Evite labels Mermaid muito longos, `?` junto de `=` e `<br/>` dentro de losangos. Prefira no máximo cerca
de dez nós por diagrama.

### Posters autorais

Alguns diagramas são **SVGs escritos à mão** (não gerados pelo `regen-diagrams.sh`), no estilo poster com
raias coloridas e ícones. Edite o próprio `.svg`:

- `arquitetura-poster.svg` — o site da fonte ao navegador (legado; o deck não o usa).
- `micrometeorology-overview.svg` — as camadas do pacote de pipeline e as 7 CLIs `labmim-*`.
- `add-wrf-variable.svg` — o fluxo de dois repositórios para adicionar uma variável aos mapas interativos.

Os dois últimos aparecem na seção **“Pipeline de dados”** do deck (`slides.md`). Ao editar um poster, confira
o visual sem exportar o deck inteiro:

```bash
node render-svg.mjs public/diagrams/add-wrf-variable.svg /tmp/preview.png 1680 1000
```

Todo poster precisa ser **XML válido** para carregar via `<img>` no Slidev — valide com
`xmllint --noout public/diagrams/<arquivo>.svg` (um `</tspan>` órfão passa no preview inline mas quebra o export).

## Instalação

Requer Node 24, igual ao projeto principal.

```bash
cd docs/onboarding-architecture
npm install
```

Para export, o Playwright precisa do Chromium:

```bash
npx playwright install chromium
```

## Desenvolvimento e export

```bash
npm run dev
npm run build
npm run export:pdf
npm run export:pptx
```

Saídas:

- `assets/dist/` — versão estática do deck;
- `assets/labmim-onboarding.pdf`;
- `assets/labmim-onboarding.pptx`.

O PPTX usa imagens de página inteira; o PDF preserva texto selecionável e é preferível para distribuição.

## Como atualizar após mudança de arquitetura

1. Confirmar a mudança no código real.
2. Atualizar primeiro `architecture-evidence.md`.
3. Atualizar slides e speaker notes, com uma ideia principal por slide.
4. Atualizar os `.mmd` afetados e rodar `./regen-diagrams.sh`.
5. Exportar PDF e PPTX.
6. Inspecionar o PDF página por página, procurando corte, sobreposição e diagramas ilegíveis.
7. Buscar caminhos inexistentes e comparar todas as receitas com `src/sites/README.md`.

## Escopo e versionamento

Esta pasta é isolada do site e possui `package.json` próprio. Ela não participa do build do frontend.

`docs/` é versionado: entram a fonte do deck, os diagramas e os PDFs distribuíveis. Ficam fora do commit
os artefatos pesados ou regeneráveis — `node_modules/`, `assets/dist/`, `assets/theme-previews/` e os
`.pptx` (ver `.gitignore`).
