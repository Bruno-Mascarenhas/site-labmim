# Regenerando o subset do Font Awesome

`assets/vendor/fontawesome/webfonts/fa-solid-900.woff2` é um **subset** com
apenas os glifos solid usados pelo site (~6KB em vez de ~150KB). A fonte
completa original está preservada ao lado como `fa-solid-900.full.woff2`.

O check `npm run lint:icons` (scripts/check-fa-subset.mjs) falha quando um
ícone novo é usado sem estar no subset. Para regenerar:

1. Instale as ferramentas (qualquer Python 3): `pip install fonttools brotli`
2. Colete os nomes usados e os codepoints (o check já lista os que faltam;
   os codepoints de cada `fa-<nome>` estão em
   `assets/vendor/fontawesome/css/all.min.css`, regras `.fa-<nome>:before{content:"\fXXX"}`).
3. Rode o pyftsubset a partir da fonte completa:

   ```bash
   cd site/assets/vendor/fontawesome/webfonts
   pyftsubset fa-solid-900.full.woff2 \
     --unicodes=U+F00D,U+F019,...  `# todos os codepoints usados` \
     --flavor=woff2 \
     --output-file=fa-solid-900.woff2
   ```

4. Atualize `assets/vendor/fontawesome/subset-glyphs.json` com o mapa
   `nome -> codepoint` dos glifos incluídos (é o manifesto que o
   `lint:icons` usa).
5. Rode `npm run lint:icons` para confirmar.

Cache: a URL da fonte não muda quando o subset muda, por isso o `.htaccess`
serve `assets/vendor/fontawesome/webfonts/` com a regra de 7 dias das fontes
(e NÃO com o `immutable` de 1 ano do resto do vendor). Após um resubset,
visitantes recorrentes pegam a fonte nova em até 7 dias. Não mover as
webfonts de volta para a regra imutável sem também versionar a URL da fonte
(preload no `head.html` + `url()` dentro do `all.min.css`).

Observação: brands (`fab`) e regular (`far`) não são usados no site; as
fontes `fa-brands-400.woff2` / `fa-regular-400.woff2` permanecem completas
mas nunca são baixadas (carregamento de fonte é lazy por glifo renderizado).
