# Regenerando o subset do Font Awesome

`assets/vendor/fontawesome/webfonts/fa-solid-900.woff2` é um **subset** com
apenas os glifos solid usados pelo site (~6KB em vez de ~150KB). A fonte
completa original está preservada ao lado como `fa-solid-900.full.woff2`.
(Os únicos arquivos em `webfonts/` são esses dois + `fa-brands-400.woff2` e
`fa-regular-400.woff2`; os `.ttf` e `fa-v4compatibility.*` referenciados
pelo `all.min.css` não são distribuídos — um glifo de alias v4 daria 404.)

## O check

`npm run lint:icons` (scripts/check-fa-subset.mjs) falha quando um ícone é
usado sem estar no subset. Ele roda no CI (step "Check Font Awesome subset
coverage") e dentro de `npm run lint`/`lint:all` — um glifo faltante
bloqueia PRs. O que o check varre:

- Classes `fa-<nome>` em `src/**/*.html`, `site/*.html` **e**
  `site/assets/js/**/*.js` (ícones injetados por strings de JS contam!),
  ignorando `vendor/` e `node_modules/`. Nomes que não são glifos reais
  (utilitários como `fa-2x`/`fa-fw`) são filtrados via `all.min.css`.
- Codepoints usados direto em CSS: regras `content: "\fXXX"` em
  `site/assets/css/**/*.css` (ex.: maps.css usa `\f078`). Ao coletar a
  lista para o pyftsubset, não esqueça desses — só olhar classes HTML
  deixaria codepoints de CSS fora do subset.

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
5. Rode `npm run lint:icons` para confirmar.

## Cache (por que a URL da fonte não tem `?v=`)

A URL da fonte não muda quando o subset muda: o `build.js` estampa hash só
em atributos `href`/`src` do HTML — ele não consegue reescrever o
`url(../webfonts/fa-solid-900.woff2)` **dentro** do `all.min.css` (que, por
sua vez, tem token manual `?v=6.4.0` e cache immutable de 1 ano). Por isso
o `.htaccess` serve `assets/vendor/fontawesome/webfonts/` com a regra de
7 dias das fontes (e NÃO com o `immutable` de 1 ano do resto do vendor).
Após um resubset, visitantes recorrentes pegam a fonte nova em até 7 dias.

Não mover as webfonts de volta para a regra imutável sem também versionar a
URL da fonte nos DOIS lugares: o preload no `src/template/partials/head.html`
(`rel=preload as=font crossorigin` — o `crossorigin` é obrigatório mesmo
same-origin, senão a fonte baixa duas vezes) e o `url()` dentro do
`all.min.css` (que exigiria bump manual do `?v=` dele).

Observação: brands (`fab`) e regular (`far`) não são usados no site; as
fontes `fa-brands-400.woff2` / `fa-regular-400.woff2` permanecem completas
mas nunca são baixadas — o navegador só baixa uma `@font-face` quando algum
conteúdo renderizado a usa, nada no site usa `fab`/`far` e elas não têm
preload. (Um único glifo `fab`/`far` renderizado baixaria a fonte inteira.)
