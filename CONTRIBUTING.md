# Como contribuir

Este repositório gera sites estáticos para publicações meteorológicas (hoje LabMiM/UFBA e LEAL/UFES). Toda contribuição passa por issue, branch, pull request e revisão — a `main` é a linha estável e ninguém commita direto nela.

## Leia primeiro

Os dois materiais estão em [`docs/onboarding-architecture/assets/`](docs/onboarding-architecture/):

- **[Onboarding da plataforma estática multi-publicação](docs/onboarding-architecture/assets/onboarding-plataforma-estatica-labmim-leal.pdf)** — a documentação de arquitetura vigente (30 slides): o modelo mental `publicação + template + território + dataset`, como o build descobre e valida cada `src/sites/<id>/site.js`, onde colocar uma mudança de estilo, as receitas de página compartilhada e exclusiva, o que `build:check` protege, o runtime do WebGIS e o contrato com o pipeline `micrometeorology`.
- **[Como contribuir no site-labmim](docs/onboarding-architecture/assets/guia-contribuicao-site.pdf)** — o passo a passo do processo, com exemplos reais de issues, branches e pull requests do repositório.

## Ambiente

```bash
nvm install && nvm use     # Node 24, fixado em .nvmrc
npm ci
```

## O fluxo

1. **Abra uma issue** descrevendo o problema, o resultado esperado e os critérios de aceite.
2. **Crie a branch a partir da `main` atualizada** — nunca trabalhe direto nela:

   ```bash
   git switch main && git pull --ff-only origin main
   git switch -c feat/<issue>-<descricao-curta>
   ```

   Prefixos em uso: `feat/`, `fix/`, `docs/`, `chore/`.

3. **Altere a fonte, não a saída.** Edite `src/`; `site/` é resultado do build e o próximo `npm run build` sobrescreve qualquer edição manual. Veja [o que é gerado](#o-que-não-se-edita-à-mão).
4. **Gere e valide** antes de subir:

   ```bash
   npm run build:check   # valida todas as publicações e restaura a padrão em site/
   npm run lint:all      # ESLint, Stylelint, temas, ícones, PurgeCSS, HTML e links
   npm run format:check
   make serve            # inspeção visual em http://localhost:8000
   ```

   `make ci` roda o conjunto que o CI executa. Nenhum PR deve chegar à revisão com esses checks vermelhos.

5. **Commite em passos pequenos**, no formato `tipo(escopo): descrição no imperativo` — o mesmo padrão do histórico (`feat(site): manifest-driven timeline and consolidated data ingest`). Commite a saída de `site/` junto com a fonte que a gerou: `build:check` falha quando `src/` e `site/` divergem.
6. **Abra o pull request para a `main`**, explicando o que muda, por quê, o impacto e como validar; ligue a issue com `Closes #<n>` e peça revisão.
7. **Responda à revisão na mesma branch** — novos commits atualizam o PR automaticamente; não abra outra branch para corrigir comentários.
8. **Merge** só com CI verde e aprovação de outra pessoa. O merge é sempre _squash_ (única opção habilitada no repositório) e a branch é apagada automaticamente depois.

## O que não se edita à mão

| Caminho                                                           | Por quê                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `site/*.html`, `site/.htaccess`, `site/sitemap.xml`, `robots.txt` | gerados pelo build a partir de `src/`                                         |
| `site/assets/css/site-theme.css`                                  | tema da publicação selecionada, republicado a cada build                      |
| `site/assets/img/`                                                | união dos assets declarados em `src/sites/<id>/assets/`                       |
| `site/JSON/`, `site/GeoJSON/`, `site/assets/graphs/`              | dados operacionais do pipeline [micrometeorology][micro]; o deploy os fornece |

`site/assets/css/` (exceto `site-theme.css`), `site/assets/js/` e `site/assets/vendor/` **são** fonte: edite-os normalmente.

## Onde mexer

A receita detalhada — criar uma publicação, adicionar página compartilhada ou exclusiva, mudar tema, território ou dataset — está em [`src/sites/README.md`](src/sites/README.md). A visão completa da arquitetura está em [`Architecture.md`](Architecture.md) e no [`README.md`](README.md).

Evite condicionais por ID de publicação no template, no renderer ou no JavaScript do navegador: uma diferença editorial pertence ao módulo da publicação; uma capacidade reutilizável pertence ao contrato comum.

## Licença

Ao contribuir, você concorda em licenciar sua contribuição sob a [Licença MIT](LICENSE) do projeto.

[micro]: https://github.com/Bruno-Mascarenhas/micrometeorology
