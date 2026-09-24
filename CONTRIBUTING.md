# Como contribuir

Este repositório gera sites estáticos para publicações meteorológicas (hoje LabMiM/UFBA e LEAL/UFES). Toda contribuição passa por issue, branch, pull request e revisão — a `main` é a linha estável e ninguém commita direto nela.

## Leia primeiro

Os dois materiais estão em [`docs/onboarding-architecture/assets/`](docs/onboarding-architecture/assets/):

- **[Onboarding da plataforma estática multi-publicação](docs/onboarding-architecture/assets/onboarding-plataforma-estatica-labmim-leal.pdf)** — a documentação de arquitetura vigente (36 slides): o modelo mental `publicação + template + território + dataset`, como o build descobre e valida cada `src/sites/<id>/site.js`, onde colocar uma mudança de estilo, as receitas de página compartilhada e exclusiva, o que `build:check` protege, o runtime do WebGIS e o contrato com o pipeline `micrometeorology`.
- **[Como contribuir no site-labmim](docs/onboarding-architecture/assets/guia-contribuicao-site.pdf)** — o passo a passo atualizado, incluindo as fronteiras do consumidor e o contrato com o produtor `micrometeorology`.

Os dois PDFs foram revisados em 18/08/2026 contra a arquitetura modular vigente e contra o contrato do produtor `micrometeorology/src/micrometeorology`. A fonte dos slides e as instruções de regeneração estão em [`docs/onboarding-architecture/README.md`](docs/onboarding-architecture/README.md).

## Ambiente

```bash
nvm install && nvm use     # Node 24, fixado em .nvmrc
npm ci
```

## Comandos

Scripts npm:

```bash
npm run sites:list           # lista src/sites/<id>/site.js descobertos e marca o padrão
npm run build                # gera a publicação padrão em site/ (+ Prettier na saída)
npm run build -- --site=ufes # gera uma publicação específica em site/
npm run build:all            # gera todos os bundles em dist/<id>/, sem dados operacionais
npm run build:check          # gera/valida todas as publicações e restaura a padrão em site/
npm run lint                 # JS/CSS + contrato de temas + checks de ícones/purge
npm run lint:all             # lint + lint:html + lint:links
npm run lint:js              # ESLint no runtime, build e módulos de configuração
npm run lint:css             # Stylelint no CSS compartilhado e nos temas dos sites
npm run lint:themes          # contrato token-only, isolamento e ordem da cascata CSS
npm run lint:icons           # cobertura do subset Font Awesome (scripts/check-fa-subset.mjs)
npm run lint:purge           # cobertura do Bootstrap purgado (scripts/check-bootstrap-purge.mjs)
npm run lint:html            # html-validate nas páginas geradas
npm run lint:links           # linkinator em todas as publicações (ignora externos e os caminhos operacionais de todos os datasets)
npm run format               # Prettier no output e nos módulos JS/CSS do gerador
npm run format:check
npm run purge:bootstrap      # regenera o Bootstrap purgado quando entra classe nova
npm run check:reach          # alcançabilidade dos controles, também com os painéis do WebGIS abertos
```

Os dois últimos ficam fora do ciclo diário e têm regras próprias:

- **`purge:bootstrap`** só é necessário quando uma página passa a usar uma classe do Bootstrap que ainda não estava no CSS purgado. Regenerá-lo reescreve um arquivo carimbado por hash de conteúdo: o `?v=` muda e o HTML commitado de **todas** as publicações muda junto — é esperado, e tudo vai no mesmo commit. O detalhe está em [`src/sites/README.md`](src/sites/README.md).
- **`check:reach`** é a única checagem automatizada de navegador do projeto: dirige o Chromium em treze viewports (320 a 1920 px) e confere se cada controle das páginas construídas é alcançável. O centro e os quatro cantos internos de cada controle precisam receber o clique, e só conta a rolagem que o usuário consegue fazer. Nas duas páginas do WebGIS ele mede também a grade de 320 a 1280 px por 600 a 900 px e repete a medida com a visão geral das variáveis aberta, uma célula selecionada, os parâmetros customizados abertos, a visão geral recolhida, o menu da navbar aberto e, por último, a variável de vento com os vetores desenhados. Sem os dados em `site/`, a prévia da visão geral, a célula e os vetores de vento não carregam, e a checagem falha em vez de medir esses estados pela metade; para aceitar de propósito uma execução parcial, rode `npm run check:reach -- --sem-dados`, que só avisa quais estados ficaram de fora. Ele **não** roda no CI — rode-o à mão antes do merge; leva cerca de 13 minutos. O tema escuro, a troca de domínio, o slider e o modal de série continuam exigindo inspeção manual.

Atalhos no `Makefile`:

| Atalho              | O que roda                                                                              |
| ------------------- | --------------------------------------------------------------------------------------- |
| `make help`         | lista os comandos disponíveis (é o alvo padrão)                                         |
| `make install`      | `npm install`                                                                           |
| `make build`        | gera a publicação estática selecionada a partir de `src/`                               |
| `make build-all`    | gera todas as publicações em `dist/<id>/` e restaura a padrão                           |
| `make build-check`  | valida todas as publicações e a saída padrão                                            |
| `make lint`         | `lint-js`, `lint-css`, `lint-themes`, `lint-icons` e `lint-purge`                       |
| `make lint-js`      | apenas o linter de JS                                                                   |
| `make lint-css`     | apenas o linter de CSS                                                                  |
| `make lint-themes`  | contrato e isolamento dos temas por publicação                                          |
| `make lint-icons`   | cobertura do subset do Font Awesome                                                     |
| `make lint-purge`   | cobertura do Bootstrap purgado                                                          |
| `make lint-html`    | valida o HTML gerado (html-validate)                                                    |
| `make lint-links`   | verifica links/assets internos (linkinator)                                             |
| `make format`       | formata o código fonte com o Prettier (altera os arquivos)                              |
| `make format-check` | verifica a formatação sem alterar arquivos                                              |
| `make fix`          | Prettier + `lint:js --fix` + `lint:css --fix`                                           |
| `make audit`        | `npm audit --audit-level=high`                                                          |
| `make serve`        | `python3 -m http.server 8000 --directory site`                                          |
| `make ci`           | `build-check`, `build-all`, `format-check`, `lint`, `lint-html`, `lint-links` e `audit` |

`make ci` roda os mesmos checks do CI do GitHub — com `make lint` incluindo `lint:themes`, `lint:icons` e `lint:purge`. O CI valida, além disso, o lockfile e a versão do Node via `npm ci` + `.nvmrc`, e publica os bundles de `dist/` como artefato do build.

ESLint, Stylelint, Prettier, html-validate, linkinator, PurgeCSS e o Playwright que o `check:reach` usa para dirigir o Chromium são `devDependencies` em `package.json`. Não há nenhuma dependência de runtime instalada via npm: o servidor recebe somente os arquivos estáticos gerados. Mantenha essa fronteira: uma ferramenta de build não deve virar dependência do site em produção, que continua sendo estático.

## O fluxo

1. **Abra uma issue** descrevendo o problema, o resultado esperado e os critérios de aceite.
2. **Crie a branch a partir da `main` atualizada** — nunca trabalhe direto nela:

   ```bash
   git switch main && git pull --ff-only origin main
   git switch -c feat/<issue>-<descricao-curta>
   ```

   Prefixos em uso: `feat/`, `fix/`, `docs/`, `refactor/`, `perf/`.

   O guia de contribuição em PDF ainda lista `feat/`, `fix/`, `docs/` e `chore/`. Os prefixos efetivamente em uso são os cinco acima: vale esta lista até o guia ser reexportado.

3. **Altere a fonte, não a saída.** Edite `src/`; `site/` é resultado do build e o próximo `npm run build` sobrescreve qualquer edição manual. Veja [o que é gerado](#o-que-não-se-edita-à-mão).
4. **Gere e valide** antes de subir: `npm run build:check`, `npm run lint:all` e `npm run format:check`, ou `make ci` de uma vez, que roda o conjunto que o CI executa. Depois `make serve`, para a inspeção visual em `http://localhost:8000`. Cada comando está descrito em [Comandos](#comandos). Nenhum PR deve chegar à revisão com esses checks vermelhos; `npm run check:reach` fica de fora do CI e é rodado à mão antes do merge.
5. **Commite em passos pequenos**, no formato `tipo: descrição no imperativo` — o mesmo padrão do histórico (`feat: desenha isóbaras ao nível do mar sobre os campos do WebGIS`). Commite a saída de `site/` junto com a fonte que a gerou: `build:check` falha quando `src/` e `site/` divergem.
6. **Abra o pull request para a `main`**, explicando o que muda, por quê, o impacto e como validar; ligue a issue com `Closes #<n>` e peça revisão.
7. **Responda à revisão na mesma branch** — novos commits atualizam o PR automaticamente; não abra outra branch para corrigir comentários.
8. **Merge** só com CI verde e aprovação de outra pessoa. O merge é sempre _squash_ (única opção habilitada no repositório) e a branch é apagada automaticamente depois.

## O que não se edita à mão

| Caminho                                                                | Por quê                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `site/*.html`, `site/.htaccess`, `site/sitemap.xml`, `site/robots.txt` | gerados pelo build a partir de `src/`                                                                         |
| `site/assets/css/site-theme.css`                                       | tema da publicação selecionada, republicado a cada build                                                      |
| `site/assets/img/`                                                     | união dos assets declarados em `src/sites/<id>/assets/`                                                       |
| `site/JSON/`, `site/GeoJSON/`                                          | campos do WRF gerados pelo pipeline [micrometeorology][micro]; o deploy os fornece e o git nunca os vê        |
| `site/Ceu/`, `site/Climatologia/`, `site/Monitoramento/`               | acervo da câmera all-sky e dos sensores do laboratório; o deploy os fornece e o git nunca os vê               |
| `site/assets/graphs/`                                                  | PNGs reescritos pela própria estação, com a marca d'água do laboratório; versionados, mas não se editam à mão |

`site/assets/css/` (exceto `site-theme.css` e `generated/`), `site/assets/js/` e `site/assets/vendor/` **são** fonte: edite-os normalmente.

## Onde mexer

A receita detalhada — criar uma publicação, adicionar página compartilhada ou exclusiva, mudar tema, território ou dataset — está em [`src/sites/README.md`](src/sites/README.md). A visão completa da arquitetura está em [`Architecture.md`](Architecture.md); o [`README.md`](README.md) é o ponto de partida — o que é o projeto, como ele se parece e como rodá-lo.

Evite condicionais por ID de publicação no template, no renderer ou no JavaScript do navegador: uma diferença editorial pertence ao módulo da publicação; uma capacidade reutilizável pertence ao contrato comum.

## Licença

Ao contribuir, você concorda em licenciar sua contribuição sob a [Licença MIT](LICENSE) do projeto.

[micro]: https://github.com/Bruno-Mascarenhas/micrometeorology
