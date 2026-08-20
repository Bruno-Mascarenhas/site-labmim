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
- reconhecer as páginas e os produtos científicos disponíveis hoje;
- construir e validar uma ou todas as publicações;
- localizar o runtime e os contratos de dados do WebGIS.

As afirmações dos slides estão lastreadas em
[`architecture-evidence.md`](./architecture-evidence.md), com caminhos e símbolos reais do repositório.

## Conteúdo

```text
docs/onboarding-architecture/
├── slides.md                     # deck Slidev com speaker notes
├── architecture-evidence.md      # base factual da apresentação
├── generate-contribution-guide.py # fonte do guia PDF
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
├── public/module-tour/           # capturas do tour das páginas (git-ignored)
└── assets/
    ├── labmim-onboarding.pdf                          # export do Slidev (npm run export:pdf)
    ├── labmim-onboarding.pptx                         # idem, editável (git-ignored)
    ├── onboarding-plataforma-estatica-labmim-leal.pdf # deck distribuído
    ├── guia-contribuicao-site.pdf                     # guia de contribuição (ver abaixo)
    └── dist/                     # build estático opcional do deck
```

`onboarding-plataforma-estatica-labmim-leal.pdf` é o deck distribuído e referenciado pelo
[`README.md`](../../README.md), pelo [`CONTRIBUTING.md`](../../CONTRIBUTING.md) e pelo
[`src/sites/README.md`](../../src/sites/README.md). Ele é a saída de `npm run export:distribution`.
`labmim-onboarding.pdf` é o nome auxiliar usado em previews históricos; não o compartilhe como fonte de
verdade sem regenerá-lo a partir do mesmo `slides.md`.

O deck distribuído possui 36 slides. A seção **Tour dos módulos** usa capturas do build local da publicação
UFBA para apresentar início, equipe, previsões WRF, potenciais energéticos, monitoramento, climatologia e
condição do céu. As imagens ficam em `public/module-tour/`, fora do git como os demais gerados: recapture-as
a partir do build local antes de reexportar o PDF sempre que a interface ou os contratos visuais mudarem.

## Guia de contribuição

Ao lado do deck, [`assets/guia-contribuicao-site.pdf`](./assets/guia-contribuicao-site.pdf) documenta o
**processo** de contribuir com o repositório, enquanto o deck documenta a **arquitetura**: abrir a issue,
criar a branch a partir da `main`, alterar o lugar certo, validar com `make build`/`make ci`/`make serve`,
fazer commits pequenos, abrir o pull request, responder à revisão e mergear — mais o padrão de nomes de
branch, o formato das mensagens de commit, as fronteiras entre consumidor e produtor, a ordem segura de
deploy e um checklist final. É o material indicado para quem chega ao laboratório antes de tocar no código.

O guia é gerado por [`generate-contribution-guide.py`](./generate-contribution-guide.py), reconstruído em
18/08/2026 porque a fonte editável original não havia sido versionada. O conteúdo acompanha
[`CONTRIBUTING.md`](../../CONTRIBUTING.md), a arquitetura vigente em `src/sites/<id>/` e o contrato com o
produtor `micrometeorology/src/micrometeorology`.

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
- `micrometeorology-overview.svg` — pôster histórico do pipeline; não é usado no deck vigente.
- `add-wrf-variable.svg` — pôster histórico do fluxo de variáveis; não é usado no deck vigente.

Os dois últimos foram substituídos por slides textuais atualizados em 18/08/2026. Se forem retomados, confira
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
npm run export:distribution
npm run export:pptx

# Guia de contribuição (a partir deste diretório)
python generate-contribution-guide.py
```

Saídas:

- `assets/dist/` — versão estática do deck;
- `assets/labmim-onboarding.pdf` (preview auxiliar);
- `assets/onboarding-plataforma-estatica-labmim-leal.pdf` (distribuição);
- `assets/labmim-onboarding.pptx`.

O PPTX usa imagens de página inteira; o PDF preserva texto selecionável e é preferível para distribuição.

## Como atualizar após mudança de arquitetura

1. Confirmar a mudança no código real.
2. Atualizar primeiro `architecture-evidence.md`.
3. Atualizar slides e speaker notes, com uma ideia principal por slide.
4. Atualizar os `.mmd` afetados e rodar `./regen-diagrams.sh`.
5. Exportar o PDF distribuído com `npm run export:distribution` e o guia com o gerador Python.
6. Inspecionar o PDF página por página, procurando corte, sobreposição e diagramas ilegíveis.
7. Buscar caminhos inexistentes e comparar todas as receitas com `src/sites/README.md`.

## Escopo e versionamento

Esta pasta é isolada do site e possui `package.json` próprio. Ela não participa do build do frontend.

`docs/` é versionado: entram a fonte do deck, os diagramas e os PDFs distribuíveis. Ficam fora do commit
os artefatos pesados ou regeneráveis — `node_modules/`, `assets/dist/`, `assets/theme-previews/` e os
`.pptx` (ver `.gitignore`).
