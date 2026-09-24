# Regenerando o subset do Font Awesome

`assets/vendor/fontawesome/webfonts/fa-solid-900.woff2` é um **subset** com
apenas os glifos solid usados pelo site (~6KB em vez de ~150KB). A fonte
completa original está preservada ao lado como `fa-solid-900.full.woff2`.
(Os únicos arquivos em `webfonts/` são esses dois + `fa-brands-400.woff2` e
`fa-regular-400.woff2`; os `.ttf` e `fa-v4compatibility.*` referenciados
pelo `all.min.css` não são distribuídos — um glifo de alias v4 daria 404.)

O CSS segue o mesmo corte. As páginas carregam
`assets/vendor/fontawesome/css/fa.subset.min.css` (~16 KB), gerado por
`npm run subset:icons-css` (`scripts/subset-fontawesome-css.mjs`) a partir do
`all.min.css` completo (~102 KB, 1.856 regras de glifo) e do manifesto: ficam
o cabeçalho de licença, as regras base (`.fa`, `.fas`, tamanhos, animações,
`.fa-sr-only`), só o `@font-face` do solid 900 e uma regra
`.fa-<nome>:before` por entrada de `subset-glyphs.json`. O `all.min.css` e o
`fa-solid-900.full.woff2` continuam no repositório como insumo dos geradores e
do check (o CSS completo alimenta o `subset:icons-css` e o `lint:icons`; a
fonte completa, o pyftsubset). O `fa-brands-400.woff2` e o
`fa-regular-400.woff2` não são insumo de nada: são fontes não usadas, já que
nenhuma página usa `fab`/`far`. Nenhum dos quatro é carregado por página, e o
`npm run build:all` os deixa fora de `dist/<id>/` (`buildInputAssets`, em
`scripts/build-all.mjs`).

## O check

`npm run lint:icons` (scripts/check-fa-subset.mjs) falha quando um ícone é
usado sem estar no subset. Ele roda no CI (step "Check Font Awesome subset
coverage") e dentro de `npm run lint`/`lint:all` — um glifo faltante
bloqueia PRs. O que o check varre:

- Classes `fa-<nome>` em `src/**/*.html` e `src/**/*.js`, `site/*.html` e
  `site/assets/js/**/*.js` (ícones injetados por strings de JS contam!) —
  e, quando os bundles de `npm run build:all` estão no disco, também os
  `dist/<id>/*.html`, ignorando `vendor/` e `node_modules/`. Nomes que não
  são glifos reais (utilitários como `fa-2x`/`fa-fw`) são filtrados via
  `all.min.css`.
- Classe montada por template string nesses mesmos arquivos (`fa-${nome}`,
  `fa-arrow-${lado}`): o check falha, porque o nome do glifo não aparece
  no código e ficaria fora do subset. Guarde o nome completo na
  configuração (`faIcon: "fa-fan"`) e interpole a classe inteira
  (`class="fas ${icone}"`).
- `faIcon` com valor literal sem o prefixo `fa-` (`faIcon: "snowflake"`):
  o check falha, porque a classe interpolada no título do modal não casaria
  com glifo nenhum e o nome não entraria na conferência do subset.
- Codepoints usados direto em CSS: regras `content: "\fXXX"` em
  `site/assets/css/**/*.css`, em `src/**/*.css` (o CSS por publicação) e
  nos bundles `dist/<id>/assets/css/**/*.css` (ex.: maps.css usa `\f078`).
  Ao coletar a lista para o pyftsubset, não esqueça desses — só olhar
  classes HTML deixaria codepoints de CSS fora do subset.
- O CSS servido: cada entrada do manifesto precisa de uma regra
  `.fa-<nome>:before` com o mesmo codepoint em `fa.subset.min.css`, e o CSS
  não pode ter regra de glifo fora do manifesto. Manifesto atualizado sem
  `npm run subset:icons-css` falha aqui — sem a regra, o ícone não aparece
  mesmo com o glifo na fonte.

O check compara o uso contra o manifesto `subset-glyphs.json`, **não**
contra o binário woff2 — nada verifica que a fonte realmente contém os
glifos listados. Por isso, **fonte e manifesto devem ser regenerados
juntos**, sempre.

## Regeneração

1. Instale as ferramentas (Python ≥ 3.9): `pip install fonttools brotli`
2. Colete os nomes usados e os codepoints (o check já lista os que faltam;
   os codepoints de cada `fa-<nome>` estão em
   `assets/vendor/fontawesome/css/all.min.css`, regras
   `.fa-<nome>:before{content:"\fXXX"}`). Inclua os codepoints usados
   direto em CSS. Aliases (ex.: `fa-info-circle`/`fa-circle-info` → `f05a`)
   entram como nomes separados no manifesto, mas o codepoint é deduplicado
   na lista do pyftsubset.
3. Rode o pyftsubset a partir da fonte completa:

   ```bash
   cd site/assets/vendor/fontawesome/webfonts
   pyftsubset fa-solid-900.full.woff2 \
     --unicodes=U+F00D,U+F019,...  `# todos os codepoints usados, deduplicados` \
     --flavor=woff2 \
     --output-file=fa-solid-900.woff2
   ```

4. Atualize `assets/vendor/fontawesome/subset-glyphs.json`. O schema é
   `{"comment": "...", "glyphs": {"fa-<nome>": "<codepoint>"}}` — o check lê
   a chave `glyphs`; um objeto plano `nome -> codepoint` na raiz quebraria
   o `lint:icons`.

   **A chave leva o prefixo `fa-`**, exatamente como a classe escrita no HTML:
   `"fa-mountain-sun": "e52f"`, não `"mountain-sun"`. Sem o prefixo o
   `lint:icons` continua acusando o ícone como ausente, porque a comparação é
   feita contra o nome da classe.
5. Regenere o CSS: `npm run subset:icons-css`. O script falha se um nome do
   manifesto não existir no `all.min.css` ou tiver outro codepoint lá. O
   `fa.subset.min.css` leva hash de conteúdo no `?v=`, então rode
   `npm run build` e commite `site/` junto: o HTML de todas as publicações
   muda.
6. Rode `npm run lint:icons` para confirmar.

## Cache (por que a fonte vai com `no-cache`)

A URL da fonte não muda quando o subset muda: a estampagem de hash
(`stampAssetVersions`, em `scripts/site-builder/assets.js`, aplicada pelo
`renderer.js`) só reescreve atributos `href`/`src` do HTML cujo caminho seja
`assets/css/` ou `assets/js/` de primeira parte — mais os vendors de
`HASHED_VENDOR_ASSETS` (`bootstrap.purged.min.css` e `fa.subset.min.css`).
A webfont fica de fora nos dois pontos: o `href` do preload não recebe `?v=`,
e o `url(../webfonts/fa-solid-900.woff2)` **dentro** do `fa.subset.min.css`
(que, por sua vez, recebe `?v=` de hash e a regra de 24 h do `.htaccess`
para URLs carimbadas) nem sequer é alcançável por esse regex. Com a regra
de 7 dias das fontes, um resubset chegaria ao visitante recorrente com o
HTML e o CSS novos sobre a fonte antiga do cache, e todo ícone
recém-adicionado ficaria sem glifo por até 7 dias. Por isso o `.htaccess` serve
`fa-solid-900.woff2` com `no-cache`: o navegador revalida a fonte a cada
navegação e recebe a nova assim que ela sobe. O custo é uma requisição
condicional por página, respondida com 304 sem corpo, num arquivo de ~5,5 KB.
As demais fontes de `webfonts/`, que nenhuma página carrega, seguem na regra
de 7 dias; nenhuma entra no `immutable` de 1 ano do resto do vendor.

Não trocar o `no-cache` por cache longo, nem mover as webfonts para a regra
imutável, sem também versionar a URL da fonte nos DOIS lugares: o preload
no `src/template/partials/head.html` (`rel=preload as=font crossorigin` —
o `crossorigin` é obrigatório mesmo same-origin, senão a fonte baixa duas
vezes) e o `url()` dentro do
`fa.subset.min.css` (que o gerador teria de reescrever).

Observação: brands (`fab`) e regular (`far`) não são usados no site. O
`fa.subset.min.css` não declara o `@font-face` deles, e as fontes
`fa-brands-400.woff2` / `fa-regular-400.woff2` ficam fora dos bundles. Um
ícone `fab`/`far` exigiria incluir a `@font-face` correspondente no gerador
e tirar a fonte de `buildInputAssets`.
